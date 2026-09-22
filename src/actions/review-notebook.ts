"use server";

import { EMPTY_EVIDENCE_PAYLOAD, evidenceJson } from "@/lib/learning/aggregate";
import {
  notebookReviewEvidence,
  type ReviewDirection,
  type ReviewMode,
} from "@/lib/learning/evidence";
import { prepareEvidence } from "@/lib/learning/commit-evidence";
import { fail, failFrom, type ActionResult } from "@/lib/errors";
import { sanitizeResponseMs } from "@/lib/response-time";
import { DEFAULT_EASE_FACTOR, GRADE_QUALITY, review } from "@/lib/sm2";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service";
import type { ReviewGrade } from "@/actions/update-srs";

/**
 * Grading one notebook card.
 *
 * THE SAME SCHEDULER, A DIFFERENT ITEM (§70, §88). The intervals come from
 * `src/lib/sm2.ts` — the same module, the same `review()` call, the same
 * `GRADE_QUALITY` mapping that `updateSrs` uses for a word card. Nothing in this
 * file re-implements an interval, and the database does not either: it is handed
 * the numbers and owns the transaction. A phrase is scheduled in a different
 * TABLE only because `saved_words` is keyed `(user_id, word_id)` and a phrase has
 * no word.
 *
 * IDEMPOTENT, and by a database constraint rather than a UI guard: one
 * `interactionId` per card presentation, unique on `review_events`, so a double
 * tap or a retried request settles the same review instead of pushing the
 * interval out twice.
 *
 * WHAT THE CLIENT MAY SAY. The grade, the timing, and which card it was looking
 * at. Everything the evidence is attributed to — which word, which chapter,
 * which sentence — is READ BACK from the learner's own note, because a caller
 * that could name the word would be a caller that could credit itself with
 * knowing any word in the dictionary.
 */

/** Which kind of note is being graded. Decides the card and the evidence. */
export type NotebookItemType = "word_meaning" | "phrase" | "sentence_translation";

export interface NotebookReviewOutcome {
  dueAt: string;
  isMastered: boolean;
  alreadyApplied: boolean;
}

/** A stale scheduling read is recomputed before giving up. */
const MAX_ATTEMPTS = 3;

export async function gradeNotebookCard(input: {
  annotationId?: number | null;
  sentenceNoteId?: number | null;
  grade: ReviewGrade;
  interactionId: string;
  mode: ReviewMode;
  direction: ReviewDirection;
  responseMs?: number;
}): Promise<ActionResult<NotebookReviewOutcome>> {
  const annotationId = input.annotationId ?? null;
  const sentenceNoteId = input.sentenceNoteId ?? null;

  if ((annotationId === null) === (sentenceNoteId === null)) {
    return fail("invalid_input", "gradeNotebookCard: name exactly one note");
  }
  if (!input.interactionId) {
    return fail("invalid_input", "gradeNotebookCard: missing interactionId");
  }

  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("unauthorized", "gradeNotebookCard: no session");

  // Provenance, from the learner's own row. RLS makes this the ownership check
  // as well: a note belonging to someone else simply is not here.
  let itemType: NotebookItemType;
  let wordId: number | null = null;
  let chapterId: string | null = null;
  let libraryItemId: string | null = null;
  let sentenceId: number | null = null;

  if (annotationId !== null) {
    const { data, error } = await supabase
      .from("user_text_annotations")
      .select("kind, word_id, chapter_id, library_item_id, sentence_id")
      .eq("id", annotationId)
      .maybeSingle();
    if (error) return failFrom(error, `gradeNotebookCard: load ${annotationId}`);
    if (!data) return fail("not_found", `gradeNotebookCard: ${annotationId}`);

    itemType = data.kind === "phrase" ? "phrase" : "word_meaning";
    // A PHRASE NEVER CREDITS ITS PARTS. Recalling *Angst machen* says nothing
    // about *Angst*, so only a single-token annotation carries its word.
    wordId = data.kind === "phrase" ? null : data.word_id;
    chapterId = data.chapter_id;
    libraryItemId = data.library_item_id;
    sentenceId = data.sentence_id;
  } else {
    const { data, error } = await supabase
      .from("user_sentence_notes")
      .select("chapter_id, library_item_id, sentence_id")
      .eq("id", sentenceNoteId!)
      .maybeSingle();
    if (error) return failFrom(error, `gradeNotebookCard: load ${sentenceNoteId}`);
    if (!data) return fail("not_found", `gradeNotebookCard: ${sentenceNoteId}`);

    itemType = "sentence_translation";
    chapterId = data.chapter_id;
    libraryItemId = data.library_item_id;
    sentenceId = data.sentence_id;
  }

  let service;
  try {
    service = createServiceRoleSupabaseClient();
  } catch (error) {
    return fail("config_error", "gradeNotebookCard: service role unavailable", error);
  }

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const { data: card, error: cardError } = await supabase
      .from("user_notebook_reviews")
      .select("interval, repetitions, ease_factor")
      .eq("user_id", user.id)
      .eq(
        annotationId !== null ? "annotation_id" : "sentence_note_id",
        (annotationId ?? sentenceNoteId)!,
      )
      .maybeSingle();
    if (cardError) return failFrom(cardError, "gradeNotebookCard: load schedule");
    if (!card) return fail("not_found", "gradeNotebookCard: not in review");

    const before = {
      interval: card.interval,
      repetitions: card.repetitions,
      easeFactor: Number(card.ease_factor ?? DEFAULT_EASE_FACTOR),
    };
    const now = new Date();
    const next = review(before, GRADE_QUALITY[input.grade], now);

    const evidence = [
      notebookReviewEvidence({
        interactionId: input.interactionId,
        mode: input.mode,
        direction: input.direction,
        rating: input.grade,
        wordId,
        libraryItemId,
        chapterId,
        sentenceId,
        responseMs: sanitizeResponseMs(input.responseMs),
        occurredAt: now.toISOString(),
      }),
    ];

    // Only a word-linked card moves knowledge, so only a word-linked card is
    // folded at all — a sentence card commits an empty payload by design, and
    // always has. What is NEW is that an unreadable knowledge state no longer
    // looks like the same thing: it refuses, and the retry (same interaction
    // id, so the same review) applies the update rather than losing it.
    const prepared =
      wordId === null
        ? null
        : await prepareEvidence(
            supabase,
            user.id,
            evidence,
            `reviewNotebookCard ${itemType} ${annotationId ?? sentenceNoteId}`,
          );
    if (prepared && !prepared.ok) return prepared;

    const { data, error } = await service.rpc("apply_notebook_review", {
      p_user_id: user.id,
      p_interaction_id: input.interactionId,
      p_annotation_id: annotationId,
      p_sentence_note_id: sentenceNoteId,
      p_item_type: itemType,
      p_rating: input.grade,
      p_mode: input.mode,
      p_direction: input.direction,
      p_response_ms: sanitizeResponseMs(input.responseMs),
      p_srs: {
        before: {
          interval: before.interval,
          repetitions: before.repetitions,
          ease_factor: before.easeFactor,
        },
        after: {
          interval: next.interval,
          repetitions: next.repetitions,
          ease_factor: next.easeFactor,
          due_at: next.dueAt,
          is_mastered: next.isMastered,
        },
      },
      p_evidence: prepared?.json ?? evidenceJson(EMPTY_EVIDENCE_PAYLOAD),
    });

    const row = data?.[0];
    if (!error && row) {
      return {
        ok: true,
        dueAt: row.due_at,
        isMastered: row.is_mastered,
        alreadyApplied: row.already_applied,
      };
    }

    // The schedule moved between the read and the commit (another tab, a queued
    // request). Recompute from fresh data rather than applying an interval
    // derived from a state that no longer exists.
    if (error?.code === "FL423" && attempt < MAX_ATTEMPTS) continue;

    return failFrom(error, "gradeNotebookCard: commit");
  }

  return fail("stale_state", "gradeNotebookCard: gave up retrying");
}
