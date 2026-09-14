/**
 * Step 1 of the content pipeline: get to clean, plain German text.
 *
 * Everything downstream — paragraph splitting, sentence splitting, tokenizing —
 * assumes ordinary Unicode text with `\n` line breaks and no markup. This module
 * is the only place allowed to make that assumption true, which is what keeps
 * "the tokenizer saw an `&nbsp;`" from becoming a class of bug.
 *
 * TWO INPUTS, ONE OUTPUT. Fluent already holds passages as sanitised HTML in
 * `texts.body` (the legacy reader's storage), and new content arrives as plain
 * text or lightweight Markdown. Both have to reach the pipeline as the same
 * thing, so {@link htmlToPlainText} recovers text from the former without ever
 * trusting the markup: tags are dropped, not rendered, and `<script>`/`<style>`
 * bodies are discarded rather than read as prose.
 */

/** Block-level tags whose boundaries are paragraph breaks in plain text. */
const BLOCK_TAGS =
  /<\/?(?:p|div|section|article|h[1-6]|ul|ol|li|blockquote|pre|table|tr|figure|figcaption)\b[^>]*>/gi;

/** Tags whose entire content is markup noise, never prose. */
const DROPPED_BLOCKS = /<(script|style|template)\b[^>]*>[\s\S]*?<\/\1>/gi;

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  shy: "",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  laquo: "«",
  raquo: "»",
  bdquo: "„",
  ldquo: "“",
  rdquo: "”",
  sbquo: "‚",
  lsquo: "‘",
  rsquo: "’",
  szlig: "ß",
  auml: "ä",
  ouml: "ö",
  uuml: "ü",
  Auml: "Ä",
  Ouml: "Ö",
  Uuml: "Ü",
};

/** Decode the character references that survive an HTML-escaped body. */
export function decodeEntities(value: string): string {
  return value.replace(
    /&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]*);/g,
    (match, entity: string) => {
      if (entity.startsWith("#x") || entity.startsWith("#X")) {
        const code = Number.parseInt(entity.slice(2), 16);
        return Number.isFinite(code) ? String.fromCodePoint(code) : match;
      }
      if (entity.startsWith("#")) {
        const code = Number.parseInt(entity.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : match;
      }
      return NAMED_ENTITIES[entity] ?? match;
    },
  );
}

/**
 * Recover plain text from a stored HTML body.
 *
 * This is a PARSER, not a renderer: no tag is ever re-emitted, so a body that
 * somehow contained hostile markup produces text, never an element. Block tags
 * become blank lines (so paragraph structure survives the round trip), `<br>`
 * becomes a single newline, and every other tag — including the legacy
 * `<mark data-lemma>` vocabulary annotations — is simply removed. The lemma
 * information in those marks is deliberately NOT read back: the pipeline
 * re-derives it from the dictionary, which is the single source of truth.
 */
export function htmlToPlainText(html: string): string {
  const text = html
    .replace(DROPPED_BLOCKS, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(BLOCK_TAGS, "\n\n")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[^>]*>/g, "");

  return normalizeText(decodeEntities(text));
}

/** True when the source looks like the HTML bodies `texts.body` stores. */
export function looksLikeHtml(source: string): boolean {
  return /<\/?(?:p|br|div|mark|h[1-6]|ul|ol|li)\b[^>]*>/i.test(source);
}

/**
 * Normalise whitespace and the punctuation that trips up sentence splitting.
 *
 * Deliberately conservative: it does NOT "fix" German typography. Curly quotes,
 * en dashes and ellipses stay as the author wrote them, because the reader shows
 * this text verbatim. What it removes is invisible: BOMs, soft hyphens, zero
 * width characters, non-breaking spaces and `\r`, each of which would otherwise
 * end up inside a token and stop a perfectly ordinary word matching the
 * dictionary.
 */
export function normalizeText(raw: string): string {
  return raw
    .replace(/^﻿/, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[­​‌‍⁠]/g, "")
    .replace(/[   ]/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Turn any accepted source into the pipeline's input.
 *
 * One entry point so that "where did this chapter's text come from?" never
 * changes what the rest of the pipeline sees.
 */
export function toSourceText(source: string): string {
  return looksLikeHtml(source)
    ? htmlToPlainText(source)
    : normalizeText(decodeEntities(source));
}
