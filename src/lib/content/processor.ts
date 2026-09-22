/**
 * The trusted chapter processor — shared by the admin panel and the importer.
 *
 * WHY THIS FILE EXISTS. The pipeline used to live inside
 * `src/actions/admin-library.ts`, behind `requireAdmin()`. That was right when
 * the only way content reached the library was an admin pasting it in. It stops
 * being right the moment a learner can import their own book: the work is
 * identical — the same tokenizer, the same transaction, the same idempotency —
 * but the AUTHORISATION is completely different, and the wrong way to share the
 * code would have been to give importing learners admin rights.
 *
 * So the *authority* to process a chapter is decided by the caller, and the
 * *act* of processing lives here:
 *
 *   `admin-library.ts`  → after `requireAdmin()`, for first-party content
 *   `book-import.ts`    → after checking the caller owns the import, for theirs
 *
 * Neither path is reachable from a browser. This module is server-only — it
 * takes a service-role client as a parameter, so importing it into a client
 * component would be a type error before it was a security problem — and it is
 * not a `"use server"` module, so nothing here is exposed as an endpoint.
 *
 * IDEMPOTENT, AND CHEAPLY SO. Identical source plus identical processor version
 * means the stored structure is already exactly what this run would produce, so
 * it writes nothing at all. That is not an optimisation: every rewrite replaces
 * paragraph rows, and a reprocess that changed nothing but still churned the
 * table would be pure risk for zero gain.
 *
 * ONE BAD CHAPTER IS NOT A BAD BOOK. A chapter whose pipeline throws is recorded
 * as `failed` with its error and skipped; every other chapter stays readable.
 * That rule is older than the importer and the importer inherits it — a
 * 42-chapter novel where chapter 17 is a mangled page is 41 readable chapters
 * and one retry button.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  getDictionarySnapshot,
  type DictionarySnapshot,
} from "@/lib/content/dictionary-snapshot";
import { contentHash, processWithIndex, type ProcessedChapter } from "@/lib/content/process";
import { CONTENT_PROCESSOR_VERSION } from "@/lib/content/version";
import { estimatedChapterMinutes } from "@/lib/reading/progress";
import { fail, failFrom, type ActionResult } from "@/lib/errors";
import type { Database } from "@/types/database";
import { toJson } from "@/lib/json";

type Client = SupabaseClient<Database>;

/** The quality report one processing run produces. */
export interface ProcessingReport {
  chapterId: string;
  skipped: boolean;
  paragraphCount: number;
  sentenceCount: number;
  wordCount: number;
  matchRate: number;
  unmatchedTokenCount: number;
  distinctWordCount: number;
}

const SKIPPED: Omit<ProcessingReport, "chapterId"> = {
  skipped: true,
  paragraphCount: 0,
  sentenceCount: 0,
  wordCount: 0,
  matchRate: 0,
  unmatchedTokenCount: 0,
  distinctWordCount: 0,
};

/**
 * Take the dictionary once for a batch.
 *
 * Loading the dictionary is the expensive part of a processing run, and building
 * the index per chapter would make a 42-chapter book forty-two times slower for
 * an identical result. The snapshot also carries the REVISION it was built from,
 * which is stamped onto every chapter it processes — that is what later tells the
 * reconciler "this chapter already agrees with dictionary N, leave it alone".
 */
export async function loadDictionarySnapshot(
  supabase: Client,
): Promise<DictionarySnapshot> {
  return getDictionarySnapshot(supabase);
}

export interface ProcessChapterInput {
  /** A client that may READ the chapter. RLS still applies to it. */
  read: Client;
  /** A service-role client. The only thing allowed to write structure. */
  service: Client;
  chapterId: string;
  /** A pre-loaded dictionary, for batches. Loaded from `read` when absent. */
  snapshot?: DictionarySnapshot;
  /** Reprocess even when the hash and processor version say nothing changed. */
  force?: boolean;
}

/** Process (or reprocess) one chapter. */
export async function processChapterById(
  input: ProcessChapterInput,
): Promise<ActionResult<ProcessingReport>> {
  const { data: chapter, error } = await input.read
    .from("chapters")
    .select("id, source_text, status, content_hash, processor_version")
    .eq("id", input.chapterId)
    .maybeSingle();
  if (error) return failFrom(error, `processChapter: load ${input.chapterId}`);
  if (!chapter) return fail("not_found", `processChapter: ${input.chapterId}`);

  const source = chapter.source_text ?? "";
  const hash = contentHash(source);
  const unchanged =
    chapter.status === "ready" &&
    chapter.content_hash === hash &&
    chapter.processor_version === CONTENT_PROCESSOR_VERSION;

  if (unchanged && !input.force) {
    return { ok: true, chapterId: chapter.id, ...SKIPPED };
  }

  let processed: ProcessedChapter;
  let snapshot: DictionarySnapshot;
  try {
    snapshot = input.snapshot ?? (await getDictionarySnapshot(input.read));
    processed = processWithIndex(source, snapshot.index);
  } catch (cause) {
    await recordFailure(input.service, input.chapterId, cause);
    return fail("database_error", `processChapter: pipeline ${input.chapterId}`, cause);
  }

  const { error: writeError } = await input.service.rpc("replace_chapter_content", {
    p_chapter_id: input.chapterId,
    p_payload: toJson(chapterPayload(processed, hash, snapshot.revision)),
  });
  if (writeError) {
    await recordFailure(input.service, input.chapterId, writeError);
    return failFrom(writeError, `processChapter: write ${input.chapterId}`);
  }

  return {
    ok: true,
    chapterId: input.chapterId,
    skipped: false,
    paragraphCount: processed.paragraphCount,
    sentenceCount: processed.sentenceCount,
    wordCount: processed.wordCount,
    matchRate: processed.stats.matchRate,
    unmatchedTokenCount: processed.stats.unmatchedTokenCount,
    distinctWordCount: processed.stats.matchedWordCount,
  };
}

/**
 * Record a chapter's failure without ever logging its content.
 *
 * The error's MESSAGE, never the text it was thrown about: a pipeline error can
 * quote a fragment of the source, and a private book must not end up in a log
 * line or in a column an admin can read.
 */
async function recordFailure(service: Client, chapterId: string, cause: unknown) {
  const message =
    cause instanceof Error
      ? cause.message
      : typeof cause === "object" && cause !== null && "message" in cause
        ? String((cause as { message: unknown }).message)
        : "processing failed";

  await service.rpc("fail_chapter_processing", {
    p_chapter_id: chapterId,
    p_error: message.slice(0, 500),
  });
}

/** The jsonb envelope `replace_chapter_content` unpacks. Transport, not storage. */
function chapterPayload(
  processed: ProcessedChapter,
  hash: string,
  dictionaryRevision: number,
) {
  return {
    processor_version: processed.processorVersion,
    content_hash: hash,
    // The third stamp: WHICH dictionary these `word_id`s came from. Without it
    // nothing could tell a chapter that is simply behind from one that is
    // up to date, and reconciliation would have to re-examine every chapter
    // every time.
    dictionary_revision: dictionaryRevision,
    word_count: processed.wordCount,
    paragraph_count: processed.paragraphCount,
    sentence_count: processed.sentenceCount,
    estimated_reading_minutes: estimatedChapterMinutes(processed.wordCount),
    dictionary_match_rate: processed.stats.matchRate,
    unmatched_sample: processed.stats.unmatchedSample,
    vocabulary_stats: {
      unique_word_count: processed.stats.uniqueWordCount,
      lexical_token_count: processed.stats.lexicalTokenCount,
      matched_token_count: processed.stats.matchedTokenCount,
      unmatched_token_count: processed.stats.unmatchedTokenCount,
      matched_word_count: processed.stats.matchedWordCount,
    },
    paragraphs: processed.paragraphs.map((paragraph) => ({
      position: paragraph.position,
      kind: paragraph.kind,
      text: paragraph.text,
      word_count: paragraph.wordCount,
      sentences: paragraph.sentences.map((sentence) => ({
        position: sentence.position,
        chapter_position: sentence.chapterPosition,
        text: sentence.text,
        char_start: sentence.charStart,
        char_end: sentence.charEnd,
        word_count: sentence.wordCount,
        occurrences: sentence.occurrences.map((occurrence) => ({
          position: occurrence.position,
          surface: occurrence.surface,
          normalized: occurrence.normalized,
          lemma: occurrence.lemma,
          word_id: occurrence.wordId,
          char_start: occurrence.charStart,
          char_end: occurrence.charEnd,
        })),
      })),
    })),
    vocabulary: processed.vocabulary.map((entry) => ({
      word_id: entry.wordId,
      occurrence_count: entry.occurrenceCount,
      first_paragraph_position: entry.firstParagraphPosition,
      first_sentence_position: entry.firstSentencePosition,
    })),
  };
}
