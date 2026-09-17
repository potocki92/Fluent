/**
 * Bringing a chapter's occurrence rows up to date with TODAY's dictionary —
 * without touching a single character of its text.
 *
 * WHAT THIS REPLACES. "Odśwież słownictwo" used to re-run the whole pipeline
 * with `force: true` so that a word added last week could be tapped in a book
 * imported last month. That worked by rewriting the chapter: paragraphs deleted
 * and re-inserted, sentences and occurrences cascading with them, every row id in
 * the chapter replaced — an enormous, risky write whose only actual purpose was
 * to change one nullable column. And it had to be triggered by hand, so a
 * learner's own answer to "why is this word dead?" was a button labelled
 * *rebuild my book*.
 *
 * WHAT HAPPENS INSTEAD. Two operations, both additive, both idempotent, neither
 * of which moves a position:
 *
 *   1. FILL THE GAPS. A chapter processed before this phase only has rows for
 *      tokens that matched. Re-tokenizing its STORED sentence text — with the
 *      same `tokenize()`, which is deterministic and has not changed — says
 *      exactly which token positions are missing, and they are inserted.
 *   2. RESOLVE. Every occurrence with no `word_id` is offered to the dictionary
 *      again, through the same {@link resolveNormalizedForms} the processor uses.
 *      What resolves gets its `word_id` and its real headword; what does not is
 *      left exactly as it is.
 *
 * WHAT IT NEVER DOES. It does not delete an occurrence, re-number a position,
 * touch a paragraph or a sentence, or change any text. Reading progress, notebook
 * notes, saved words and reading history are anchored on positions and ids that
 * this pass preserves by construction — which is why it is safe to run on a book
 * someone is in the middle of, and why running it twice is a no-op.
 *
 * PURE. The planning lives here and is unit-tested on fixtures; the I/O lives in
 * `src/lib/content/reconciler.ts`. That split is what makes "does a second run
 * insert anything?" a test rather than a hope.
 */

import {
  resolveNormalizedForms,
  type DictionaryIndex,
} from "@/lib/content/dictionary-match";
import { tokenize } from "@/lib/content/tokenize";

/** A stored sentence, as the planner needs it. */
export interface StoredSentence {
  id: number;
  text: string;
}

/** A stored occurrence, as the planner needs it. */
export interface StoredOccurrence {
  sentenceId: number;
  position: number;
  normalized: string;
  wordId: number | null;
}

/** An occurrence row that should exist and does not. */
export interface MissingOccurrence {
  sentenceId: number;
  position: number;
  surface: string;
  normalized: string;
  lemma: string;
  wordId: number | null;
  charStart: number;
  charEnd: number;
}

/** "Every occurrence of this form in this chapter is that dictionary word." */
export interface FormResolution {
  normalized: string;
  wordId: number;
  lemma: string;
}

export interface DictionarySyncPlan {
  missing: MissingOccurrence[];
  resolutions: FormResolution[];
}

/** Nothing to do — shared so callers can compare against a stable shape. */
export const EMPTY_SYNC_PLAN: DictionarySyncPlan = { missing: [], resolutions: [] };

/**
 * Work out what one batch of sentences needs.
 *
 * `occurrences` must be the rows belonging to exactly these sentences; anything
 * else is ignored, since the plan is keyed on `(sentenceId, position)` — the same
 * pair the database has a unique index on, which is what makes the insert safe
 * to retry.
 */
export function planDictionarySync(input: {
  sentences: readonly StoredSentence[];
  occurrences: readonly StoredOccurrence[];
  index: DictionaryIndex;
}): DictionarySyncPlan {
  const stored = new Map<string, StoredOccurrence>();
  for (const occurrence of input.occurrences) {
    stored.set(keyOf(occurrence.sentenceId, occurrence.position), occurrence);
  }

  const missing: MissingOccurrence[] = [];
  // Every form that currently has no answer — from a gap we are about to fill or
  // from a row stored with `word_id = null` — asked about exactly once.
  const unresolved = new Set<string>();

  for (const sentence of input.sentences) {
    for (const token of tokenize(sentence.text)) {
      const existing = stored.get(keyOf(sentence.id, token.position));

      if (!existing) {
        missing.push({
          sentenceId: sentence.id,
          position: token.position,
          surface: token.surface,
          normalized: token.normalized,
          // Provisional until the resolution below says otherwise, and left
          // provisional if it does not.
          lemma: token.normalized,
          wordId: null,
          charStart: token.charStart,
          charEnd: token.charEnd,
        });
        unresolved.add(token.normalized);
        continue;
      }

      if (existing.wordId === null) unresolved.add(existing.normalized);
    }
  }

  const resolved = resolveNormalizedForms(unresolved, input.index);

  // A row that is about to be inserted is inserted ALREADY RESOLVED: a legacy
  // chapter reconciled today should not need a second pass to gloss the words
  // the dictionary already knows.
  for (const row of missing) {
    const hit = resolved.get(row.normalized);
    if (hit) {
      row.wordId = hit.wordId;
      row.lemma = hit.lemma;
    }
  }

  return {
    missing,
    // Sorted so the payload — and therefore the SQL — is deterministic, which is
    // what makes two runs of the same plan comparable in a test.
    resolutions: [...resolved.entries()]
      .map(([normalized, hit]) => ({
        normalized,
        wordId: hit.wordId,
        lemma: hit.lemma,
      }))
      .sort((a, b) => a.normalized.localeCompare(b.normalized)),
  };
}

/** True when running this plan would write nothing. */
export function isEmptySyncPlan(plan: DictionarySyncPlan): boolean {
  return plan.missing.length === 0 && plan.resolutions.length === 0;
}

function keyOf(sentenceId: number, position: number): string {
  return `${sentenceId}:${position}`;
}
