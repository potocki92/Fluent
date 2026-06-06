/**
 * Extract the distinct vocabulary lemmas annotated in a reading passage body.
 *
 * Passages mark glossary words with `<mark data-lemma="…">…</mark>` (see
 * `src/components/texts/BodyContent.tsx`). This helper reads those annotations
 * from the raw HTML. It is deliberately regex-based — it runs in server actions
 * where `DOMParser` is unavailable. When a `<mark>` has no `data-lemma`, its
 * text content is used as the lemma (mirroring the client tooltip fallback).
 */
const MARK_RE = /<mark\b([^>]*)>([\s\S]*?)<\/mark>/gi;
const LEMMA_ATTR_RE = /\bdata-lemma\s*=\s*"([^"]*)"/i;

export function extractLemmas(html: string): string[] {
  const seen = new Set<string>();
  const lemmas: string[] = [];

  for (const match of html.matchAll(MARK_RE)) {
    const attrs = match[1] ?? "";
    const inner = match[2] ?? "";
    const fromAttr = attrs.match(LEMMA_ATTR_RE)?.[1];
    // Strip any nested tags from the inner text for the fallback.
    const fallback = inner.replace(/<[^>]+>/g, "");
    const lemma = (fromAttr ?? fallback).trim();
    if (!lemma) continue;

    const key = lemma.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    lemmas.push(lemma);
  }

  return lemmas;
}
