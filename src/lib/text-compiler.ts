/**
 * The passage "compiler": turns an admin-written plain-text / lightweight
 * Markdown source into the sanitised HTML the app stores in `texts.body`, and
 * auto-marks vocabulary that exists in the dictionary with
 * `<mark data-lemma="…">…</mark>` (the same annotation `BodyContent` renders as
 * a `WordTooltip`).
 *
 * Pure and testable — no I/O. The server action in `src/actions/admin-compile.ts`
 * loads the dictionary and calls {@link compilePassage}. Only the tags allowed
 * by `BodyContent` are ever emitted (`p, h2, h3, strong, em, ul, ol, li, br`),
 * and all source text is escaped, so this never injects raw admin HTML.
 */

import { dictionaryKeysFor } from "@/lib/content/dictionary-match";
import {
  baseFormCandidates,
  foldUmlauts,
  GERMAN_FUNCTION_WORDS,
} from "@/lib/german-morphology";

export interface DictEntry {
  lemma: string;
  display: string;
}

export interface CompiledPassage {
  html: string;
  /** Distinct dictionary lemmas that were marked. */
  matched: string[];
  /** Distinct content words (≥3 chars, non-function) with no dictionary hit. */
  unmatched: string[];
}

/** Matches a single word, including German umlauts and ß, plus inner hyphens. */
const WORD_RE = /\p{L}[\p{L}ß]*(?:-\p{L}[\p{L}ß]*)*/gu;

/** Splits HTML into tags, character entities, and the plain text between them. */
const TOKEN_SPLIT_RE = /(<[^>]+>|&(?:#\d+|#x[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);)/;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/"/g, "&quot;");
}

/** Render inline Markdown (**bold**, _italic_) within already-escaped text. */
function renderInline(text: string): string {
  return escapeHtml(text)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/_([^_]+)_/g, "<em>$1</em>");
}

/**
 * Convert lightweight Markdown to the allowed HTML subset:
 * blank line → new `<p>`, `##`/`###` → headings, `-`/`*` lines → `<ul>`,
 * single newlines inside a paragraph → `<br />`.
 */
export function markdownToHtml(raw: string): string {
  const blocks = raw.replace(/\r\n/g, "\n").split(/\n{2,}/);
  const out: string[] = [];

  for (const rawBlock of blocks) {
    const lines = rawBlock
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length === 0) continue;

    if (lines.every((line) => /^[-*]\s+/.test(line))) {
      const items = lines
        .map((line) => `<li>${renderInline(line.replace(/^[-*]\s+/, ""))}</li>`)
        .join("");
      out.push(`<ul>${items}</ul>`);
      continue;
    }

    if (lines.length === 1) {
      const h3 = lines[0].match(/^###\s+(.*)$/);
      if (h3) {
        out.push(`<h3>${renderInline(h3[1])}</h3>`);
        continue;
      }
      const h2 = lines[0].match(/^##\s+(.*)$/);
      if (h2) {
        out.push(`<h2>${renderInline(h2[1])}</h2>`);
        continue;
      }
    }

    out.push(`<p>${lines.map(renderInline).join("<br />")}</p>`);
  }

  return out.join("\n");
}

/**
 * Build a lookup from a normalised (lowercased, umlaut-folded) key to the
 * canonical lemma. The keys themselves come from
 * `@/lib/content/dictionary-match`, which is the single definition of "what is
 * this dictionary entry reachable by" — the reader pipeline resolves tokens with
 * exactly the same keys, so a word that is glossable in the reader is glossable
 * here too. Earlier entries win on collision, keeping the result deterministic.
 */
export function buildDictIndex(entries: DictEntry[]): Map<string, string> {
  const index = new Map<string, string>();

  for (const { lemma, display } of entries) {
    for (const key of dictionaryKeysFor(lemma, display)) {
      if (!index.has(key)) index.set(key, lemma);
    }
  }

  return index;
}

function lookupLemma(token: string, index: Map<string, string>): string | null {
  if (GERMAN_FUNCTION_WORDS.has(token.toLowerCase())) return null;
  for (const candidate of baseFormCandidates(token)) {
    const hit = index.get(foldUmlauts(candidate));
    if (hit) return hit;
  }
  return null;
}

/**
 * Wrap dictionary words in `<mark data-lemma="…">`. Only the plain text between
 * HTML tags is scanned — tags and character entities (e.g. `&amp;`) are left
 * intact so the regex never matches the "amp" inside an entity — and text
 * already inside a `<mark>` is left alone, so the pass is idempotent. Returns
 * the annotated HTML plus matched/unmatched word stats for the admin summary.
 */
export function annotateVocabulary(
  html: string,
  index: Map<string, string>,
): CompiledPassage {
  const matched = new Set<string>();
  const unmatched = new Set<string>();
  let inMark = false;

  const annotated = html
    .split(TOKEN_SPLIT_RE)
    .map((part) => {
      if (part.startsWith("<")) {
        const lower = part.toLowerCase();
        if (lower.startsWith("<mark")) inMark = true;
        else if (lower.startsWith("</mark")) inMark = false;
        return part;
      }
      // Leave HTML entities (&amp;, &#39;, …) untouched.
      if (part.startsWith("&")) return part;
      if (inMark) return part;

      return part.replace(WORD_RE, (token) => {
        const lemma = lookupLemma(token, index);
        if (lemma) {
          matched.add(lemma);
          return `<mark data-lemma="${escapeAttr(lemma)}">${token}</mark>`;
        }
        const lower = token.toLowerCase();
        if (token.length >= 3 && !GERMAN_FUNCTION_WORDS.has(lower)) {
          unmatched.add(lower);
        }
        return token;
      });
    })
    .join("");

  return { html: annotated, matched: [...matched], unmatched: [...unmatched] };
}

/** Compile a plain-text / Markdown source into annotated, sanitised HTML. */
export function compilePassage(raw: string, entries: DictEntry[]): CompiledPassage {
  if (!raw.trim()) return { html: "", matched: [], unmatched: [] };
  const index = buildDictIndex(entries);
  return annotateVocabulary(markdownToHtml(raw), index);
}
