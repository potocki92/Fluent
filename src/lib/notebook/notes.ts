/**
 * The small rules a note has to obey, in one place.
 *
 * Normalisation and staleness look like trivia and are not. "Save" with a
 * textarea full of spaces must not create a note (§102), or the notebook fills
 * with entries that render as nothing and count towards a chapter summary; and a
 * note taken against text that has since been reprocessed must be VISIBLY a note
 * about the old text rather than quietly shown against the new (§37).
 *
 * Pure, and shared by the Server Actions and the UI, so the button that is
 * disabled and the action that refuses agree by construction rather than by
 * both being written carefully.
 */

import { CONTENT_PROCESSOR_VERSION } from "@/lib/content/version";

/**
 * Trim a learner's text, or decide there isn't any.
 *
 * Returns `null` for whitespace-only input — the same value the database stores
 * for "no translation" — so "nothing was typed" and "the field was cleared" are
 * one case with one behaviour rather than two that drift apart.
 */
export function normalizeNoteText(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed.length === 0 ? null : trimmed;
}

/** Whether a learner's text fits, once normalised. Length is in code points. */
export function fitsLimit(value: string | null | undefined, max: number): boolean {
  const text = normalizeNoteText(value);
  return text === null || [...text].length <= max;
}

/**
 * Has the text this note was taken against moved?
 *
 * Two independent signals, and both matter. The processor VERSION changing means
 * sentence boundaries or token positions may have shifted, so the anchor could
 * now point at a different span even when the sentence reads the same; the
 * SNAPSHOT differing from the live text means it demonstrably does.
 *
 * A stale note is never hidden and never silently repointed. The notebook shows
 * the German it was taken against — which is the text the learner actually
 * translated — and marks it, so "my translation does not match this sentence" is
 * something they can see rather than something they have to work out.
 */
export function isNoteStale(input: {
  snapshot: string;
  contentVersion: string;
  /** The sentence as the chapter has it NOW, or null when it is gone. */
  liveText: string | null;
}): boolean {
  if (input.contentVersion !== CONTENT_PROCESSOR_VERSION) return true;
  if (input.liveText === null) return false;
  return input.liveText !== input.snapshot;
}
