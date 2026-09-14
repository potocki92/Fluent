/**
 * Step 2: plain text → paragraph blocks.
 *
 * A paragraph is the unit the reader renders, the unit reading progress is
 * measured in, and the unit a resume position points at. It is therefore the
 * first structural decision the pipeline makes, and it has to be stable: the
 * same source must always produce the same paragraph at the same position, or
 * every stored reading position silently moves.
 *
 * THE RULE is the one every prose format already agrees on — a blank line ends a
 * paragraph. Single newlines inside a block are soft wraps and are joined, which
 * is what makes hard-wrapped source files (very common in public-domain texts)
 * come out as real paragraphs rather than one paragraph per line.
 */

import { normalizeText } from "@/lib/content/normalize";

/**
 * What a block IS, semantically.
 *
 * Kept to the three that change how a block is READ. There is no `list` vs
 * `quote` vs `figure` taxonomy here because the reader renders them the same
 * way, and a distinction the UI cannot honour is a distinction that will drift.
 */
export type ParagraphKind = "paragraph" | "heading" | "list_item";

export interface ParagraphBlock {
  /** 0-based, stable for a given source. */
  position: number;
  kind: ParagraphKind;
  text: string;
}

const HEADING_RE = /^#{1,6}\s+(.*)$/;
const LIST_RE = /^[-*•]\s+(.*)$/;

/**
 * Split normalised text into paragraph blocks.
 *
 * Markdown-ish markers (`##`, `- `) are recognised because that is what the
 * admin composer already writes, but nothing else about Markdown is honoured:
 * inline emphasis stays as literal characters in the text, because the reader
 * renders structured text and not arbitrary markup.
 */
export function splitParagraphs(source: string): ParagraphBlock[] {
  const blocks: ParagraphBlock[] = [];

  for (const rawBlock of normalizeText(source).split(/\n{2,}/)) {
    const lines = rawBlock
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length === 0) continue;

    // A run of list items is several blocks, not one: each is read on its own
    // line and each deserves its own position.
    if (lines.every((line) => LIST_RE.test(line))) {
      for (const line of lines) {
        push(blocks, "list_item", line.replace(LIST_RE, "$1"));
      }
      continue;
    }

    if (lines.length === 1) {
      const heading = lines[0].match(HEADING_RE);
      if (heading) {
        push(blocks, "heading", heading[1]);
        continue;
      }
    }

    push(blocks, "paragraph", lines.join(" "));
  }

  return blocks;
}

function push(blocks: ParagraphBlock[], kind: ParagraphKind, text: string): void {
  const trimmed = text.trim();
  if (!trimmed) return;
  blocks.push({ position: blocks.length, kind, text: trimmed });
}

/** Words in a block, by the same definition the whole pipeline uses. */
export function countWords(text: string): number {
  return (text.match(/\p{L}[\p{L}\p{M}'’-]*/gu) ?? []).length;
}
