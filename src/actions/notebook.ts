"use server";

import {
  EMPTY_SNAPSHOT,
  evidenceJson,
  foldEvidence,
} from "@/lib/learning/aggregate";
import {
  notebookNoteEvidence,
  sentenceUnclearEvidence,
} from "@/lib/learning/evidence";
import { fail, failFrom, type ActionResult } from "@/lib/errors";
import {
  MAX_LEMMA_LENGTH,
  MAX_MEANING_LENGTH,
  MAX_PHRASE_TOKENS,
  MAX_TRANSLATION_LENGTH,
} from "@/lib/notebook/constants";
import { fitsLimit, normalizeNoteText } from "@/lib/notebook/notes";
import { spanFromTokenPositions } from "@/lib/notebook/selection";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { AnnotationKind } from "@/types";

/**
 * The personal notebook's write paths.
 *
 * WHAT THESE ACTIONS OWN, AND WHAT SQL OWNS. Every one of them is the same three
 * steps as the rest of Fluent: establish the learner from the cookie-bound
 * client, compute in TypeScript, commit in one `SECURITY DEFINER` transaction.
 * The linguistics — snapping a selection to whole tokens, deciding what a span's
 * surface and offsets are — happen HERE, using the content pipeline's own
 * tokenizer, because that is where they are pure and unit-tested. The database
 * decides who the caller is, whether they may read the sentence at all, and
 * whether the span really is the text it claims to be.
 *
 * NOTHING HERE WRITES TO `public.words`. That is the invariant the whole phase
 * rests on: "sollten here means powinniśmy" is a statement about one place in
 * one book by one learner, and the shared dictionary is not the place for it.
 *
 * Expected failures are RETURNED as {@link ActionResult}, never thrown — Next
 * redacts thrown Server Action errors in production, so the UI could not branch
 * on one.
 */

/** The sentence a note is about, as the learner is allowed to see it. */
interface SentenceContext {
  id: number;
  chapterId: string;
  libraryItemId: string;
  text: string;
}

/**
 * Load the sentence, through the learner's OWN client.
 *
 * RLS does the authorisation: a sentence in somebody else's private import is
 * not filtered out here, it is invisible, so this returns `null` and the action
 * reports "not found" without ever revealing that the row exists. The RPC checks
 * again with `chapter_is_readable` — this read exists to get the TEXT, not to be
 * the security boundary.
 */
async function loadSentence(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  sentenceId: number,
): Promise<SentenceContext | null> {
  const { data } = await supabase
    .from("sentences")
    .select("id, text, chapter_id, chapters(library_item_id)")
    .eq("id", sentenceId)
    .maybeSingle();

  const item = (data?.chapters as { library_item_id: string } | null)?.library_item_id;
  if (!data || !item) return null;

  return {
    id: data.id,
    chapterId: data.chapter_id,
    libraryItemId: item,
    text: data.text,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SENTENCE TRANSLATIONS
// ─────────────────────────────────────────────────────────────────────────────

export interface SentenceTranslationResult {
  noteId: number;
  wasNew: boolean;
  translation: string;
}

/**
 * Save the learner's own Polish for one sentence.
 *
 * IT IS THEIRS, NOT THE TRUTH (§77). A learner may write "Musimy iść do sklepu."
 * under "Wir sollten umkehren." and Fluent stores it, labels it *Twoje
 * tłumaczenie* everywhere it appears, and never presents it as a translation of
 * the sentence. Checking it is a Phase 6 question; pretending to have checked it
 * would be worse than not offering the feature.
 */
export async function saveSentenceTranslation(input: {
  sentenceId: number;
  translation: string;
}): Promise<ActionResult<SentenceTranslationResult>> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("unauthorized", "saveSentenceTranslation: no session");

  const translation = normalizeNoteText(input.translation);
  if (translation === null) {
    return fail("invalid_input", "saveSentenceTranslation: empty translation");
  }
  if (!fitsLimit(translation, MAX_TRANSLATION_LENGTH)) {
    return fail("invalid_input", "saveSentenceTranslation: translation too long");
  }

  const sentence = await loadSentence(supabase, input.sentenceId);
  if (!sentence) {
    return fail("not_found", `saveSentenceTranslation: ${input.sentenceId}`);
  }

  const evidence = notebookNoteEvidence({
    event: "sentence_translation_created",
    libraryItemId: sentence.libraryItemId,
    chapterId: sentence.chapterId,
    sentenceId: sentence.id,
    startPosition: null,
    wordId: null,
    occurrenceId: null,
    occurredAt: new Date().toISOString(),
  });

  const { data, error } = await supabase.rpc("save_sentence_translation", {
    p_sentence_id: input.sentenceId,
    p_translation: translation,
    // No snapshot is loaded: the event carries no skill, no concept and no word
    // channel, so the fold moves nothing and there is nothing to be stale about.
    p_evidence: evidenceJson(foldEvidence(EMPTY_SNAPSHOT, [evidence]).payload),
  });
  if (error) return failFrom(error, `saveSentenceTranslation: ${input.sentenceId}`);

  const row = data?.[0];
  if (!row) return fail("database_error", "saveSentenceTranslation: empty result");

  return {
    ok: true,
    noteId: row.note_id,
    wasNew: row.was_new,
    translation: row.translation ?? translation,
  };
}

/** Remove the learner's translation. §13: the sentence itself is untouched. */
export async function deleteSentenceTranslation(
  sentenceId: number,
): Promise<ActionResult<{ noteDeleted: boolean }>> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("unauthorized", "deleteSentenceTranslation: no session");

  const { data, error } = await supabase.rpc("delete_sentence_translation", {
    p_sentence_id: sentenceId,
  });
  if (error) return failFrom(error, `deleteSentenceTranslation: ${sentenceId}`);

  return { ok: true, noteDeleted: data?.[0]?.deleted ?? false };
}

// ─────────────────────────────────────────────────────────────────────────────
// "NIE ROZUMIEM"
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Flag a sentence as not understood — or say it is understood now.
 *
 * BOTH DIRECTIONS ARE EVIDENCE, and both are recorded. The flag is current
 * state; the append-only log keeps the sequence, which is why the caller mints
 * one `interactionId` per tap rather than deriving a key from the sentence.
 * A learner who marks a sentence unclear in chapter three and understood a week
 * later has done two things, and a system that remembered only the first would
 * be carrying a failure they have already dealt with.
 */
export async function setSentenceUnclear(input: {
  sentenceId: number;
  unclear: boolean;
  interactionId: string;
  readingSessionId?: string | null;
}): Promise<ActionResult<{ isUnclear: boolean; noteDeleted: boolean }>> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("unauthorized", "setSentenceUnclear: no session");
  if (!input.interactionId) {
    return fail("invalid_input", "setSentenceUnclear: missing interaction id");
  }

  const sentence = await loadSentence(supabase, input.sentenceId);
  if (!sentence) return fail("not_found", `setSentenceUnclear: ${input.sentenceId}`);

  const evidence = sentenceUnclearEvidence({
    interactionId: input.interactionId,
    unclear: input.unclear,
    libraryItemId: sentence.libraryItemId,
    chapterId: sentence.chapterId,
    sentenceId: sentence.id,
    readingSessionId: input.readingSessionId ?? null,
    occurredAt: new Date().toISOString(),
  });

  const { data, error } = await supabase.rpc("set_sentence_unclear", {
    p_sentence_id: input.sentenceId,
    p_unclear: input.unclear,
    p_evidence: evidenceJson(foldEvidence(EMPTY_SNAPSHOT, [evidence]).payload),
  });
  if (error) return failFrom(error, `setSentenceUnclear: ${input.sentenceId}`);

  const row = data?.[0];
  return {
    ok: true,
    isUnclear: row?.is_unclear ?? input.unclear,
    noteDeleted: row?.deleted ?? false,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// WORD MEANINGS AND PHRASES
// ─────────────────────────────────────────────────────────────────────────────

export interface AnnotationResult {
  annotationId: number;
  wasNew: boolean;
  kind: AnnotationKind;
  surface: string;
  meaning: string | null;
  lemma: string | null;
  wordId: number | null;
}

/**
 * Save a contextual word meaning, a personal word, or a phrase.
 *
 * THE CALLER SENDS POSITIONS, NOT TEXT. The reader resolves its selection to
 * token positions (`src/lib/notebook/selection.ts`); this action re-derives the
 * surface and the character offsets from the sentence as the DATABASE has it,
 * and the RPC then refuses the write unless the two agree. So a crafted request
 * can annotate a book the learner may read, and cannot invent a phrase that book
 * does not contain — which matters, because these snapshots are what the
 * notebook and the review cards render.
 *
 * `kind` IS DERIVED FROM THE SPAN, never taken from the caller: one token is a
 * word, more is a phrase, and there is no third answer to disagree about.
 */
export async function saveAnnotation(input: {
  sentenceId: number;
  startPosition: number;
  endPosition: number;
  meaning?: string | null;
  lemma?: string | null;
}): Promise<ActionResult<AnnotationResult>> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("unauthorized", "saveAnnotation: no session");

  const meaning = normalizeNoteText(input.meaning);
  const lemma = normalizeNoteText(input.lemma);
  if (!fitsLimit(meaning, MAX_MEANING_LENGTH)) {
    return fail("invalid_input", "saveAnnotation: meaning too long");
  }
  if (!fitsLimit(lemma, MAX_LEMMA_LENGTH)) {
    return fail("invalid_input", "saveAnnotation: lemma too long");
  }

  const sentence = await loadSentence(supabase, input.sentenceId);
  if (!sentence) return fail("not_found", `saveAnnotation: ${input.sentenceId}`);

  const resolved = spanFromTokenPositions(
    sentence.text,
    input.startPosition,
    input.endPosition,
    MAX_PHRASE_TOKENS,
  );
  if (!resolved.ok) {
    return fail("invalid_input", `saveAnnotation: span ${resolved.reason}`);
  }

  const span = resolved.span;
  const kind: AnnotationKind = span.tokenCount > 1 ? "phrase" : "word";

  const evidence = notebookNoteEvidence({
    event: kind === "phrase" ? "phrase_saved" : "context_meaning_created",
    libraryItemId: sentence.libraryItemId,
    chapterId: sentence.chapterId,
    sentenceId: sentence.id,
    startPosition: span.startPosition,
    // The dictionary link is resolved inside the transaction, from the
    // occurrence the content pipeline actually matched — a learner must not be
    // able to attach their gloss to an arbitrary entry. The event is therefore
    // written without one; the annotation row carries it.
    wordId: null,
    occurrenceId: null,
    occurredAt: new Date().toISOString(),
  });

  const { data, error } = await supabase.rpc("save_text_annotation", {
    p_sentence_id: input.sentenceId,
    p_kind: kind,
    p_start_position: span.startPosition,
    p_end_position: span.endPosition,
    p_char_start: span.charStart,
    p_char_end: span.charEnd,
    p_surface: span.surface,
    p_meaning: meaning,
    p_lemma: lemma,
    p_max_tokens: MAX_PHRASE_TOKENS,
    p_evidence: evidenceJson(foldEvidence(EMPTY_SNAPSHOT, [evidence]).payload),
  });
  if (error) return failFrom(error, `saveAnnotation: ${input.sentenceId}`);

  const row = data?.[0];
  if (!row) return fail("database_error", "saveAnnotation: empty result");

  return {
    ok: true,
    annotationId: row.annotation_id,
    wasNew: row.was_new,
    kind,
    surface: row.surface,
    meaning: row.meaning,
    lemma: row.lemma,
    wordId: row.word_id,
  };
}

/** §40: correcting a meaning, which is an edit and not a new observation. */
export async function updateAnnotation(input: {
  annotationId: number;
  meaning?: string | null;
  lemma?: string | null;
}): Promise<ActionResult<{ meaning: string | null; lemma: string | null }>> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("unauthorized", "updateAnnotation: no session");

  const meaning = normalizeNoteText(input.meaning);
  const lemma = normalizeNoteText(input.lemma);
  if (!fitsLimit(meaning, MAX_MEANING_LENGTH)) {
    return fail("invalid_input", "updateAnnotation: meaning too long");
  }
  if (!fitsLimit(lemma, MAX_LEMMA_LENGTH)) {
    return fail("invalid_input", "updateAnnotation: lemma too long");
  }

  const { data, error } = await supabase.rpc("update_text_annotation", {
    p_annotation_id: input.annotationId,
    p_meaning: meaning,
    p_lemma: lemma,
  });
  if (error) return failFrom(error, `updateAnnotation: ${input.annotationId}`);

  const row = data?.[0];
  return { ok: true, meaning: row?.meaning ?? null, lemma: row?.lemma ?? null };
}

/** §41: removing a note from the notebook, never from the book. */
export async function deleteAnnotation(
  annotationId: number,
): Promise<ActionResult<{ deleted: boolean }>> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("unauthorized", "deleteAnnotation: no session");

  const { data, error } = await supabase.rpc("delete_text_annotation", {
    p_annotation_id: annotationId,
  });
  if (error) return failFrom(error, `deleteAnnotation: ${annotationId}`);

  return { ok: true, deleted: data ?? false };
}

// ─────────────────────────────────────────────────────────────────────────────
// THE REVIEW QUEUE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Put a note into the review queue, or take it out.
 *
 * ALWAYS EXPLICIT (§72). Saving a translation schedules nothing. The alternative
 * — every translated sentence silently becoming a flashcard — punishes the most
 * valuable habit this phase is trying to build, and a learner who gets forty
 * unasked-for cards stops translating sentences.
 */
export async function setNotebookReview(input: {
  annotationId?: number | null;
  sentenceNoteId?: number | null;
  enabled: boolean;
}): Promise<ActionResult<{ enabled: boolean; dueAt: string | null }>> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("unauthorized", "setNotebookReview: no session");

  const annotationId = input.annotationId ?? null;
  const sentenceNoteId = input.sentenceNoteId ?? null;
  if ((annotationId === null) === (sentenceNoteId === null)) {
    return fail("invalid_input", "setNotebookReview: name exactly one note");
  }

  const { data, error } = await supabase.rpc("set_notebook_review", {
    p_annotation_id: annotationId,
    p_sentence_note_id: sentenceNoteId,
    p_enabled: input.enabled,
  });
  if (error) {
    return failFrom(error, `setNotebookReview: ${annotationId ?? sentenceNoteId}`);
  }

  const row = data?.[0];
  return { ok: true, enabled: row?.enabled ?? false, dueAt: row?.due_at ?? null };
}
