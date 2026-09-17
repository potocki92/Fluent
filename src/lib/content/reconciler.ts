/**
 * The reconciliation pass — the I/O half of `dictionary-sync.ts`.
 *
 * It is to the dictionary what `processor.ts` is to the source text, and the
 * contrast is the point:
 *
 *   `processor.ts`    the TEXT changed   → rewrite the chapter's structure
 *   `reconciler.ts`   the DICTIONARY     → fill in nullable columns, in place
 *                     changed
 *
 * Only the first is destructive, and only the first needs admin rights or
 * ownership of a private import. Reconciling touches nothing a learner owns and
 * invents nothing: the rows it writes are derived from the chapter's own stored
 * sentences and from `words`, so the caller contributes a chapter id and nothing
 * else. That is what makes it safe to run from the reader for ANY chapter the
 * caller is allowed to READ — which is the whole reason a learner never has to
 * press a button to make a newly added word work in a book they are reading.
 *
 * SERVER-ONLY. It takes a service-role client as a parameter, so importing it
 * into a client component is a type error before it is a security problem, and
 * it is not a `"use server"` module, so nothing here is an endpoint by itself.
 *
 * BATCHED AND RESUMABLE. One call works through a bounded number of sentences and
 * returns a cursor. Nothing is stamped until the last batch lands, so an
 * interrupted run simply happens again — and because the plan is idempotent,
 * "again" costs a read and writes nothing.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  DICTIONARY_SYNC_ROW_BATCH,
  DICTIONARY_SYNC_SENTENCE_BATCH,
} from "@/lib/content/constants";
import {
  getDictionarySnapshot,
  type DictionarySnapshot,
} from "@/lib/content/dictionary-snapshot";
import {
  isEmptySyncPlan,
  planDictionarySync,
  type StoredOccurrence,
  type StoredSentence,
} from "@/lib/content/dictionary-sync";
import { fail, failFrom, type ActionResult } from "@/lib/errors";
import type { Database, Json } from "@/types/database";

type Client = SupabaseClient<Database>;

/** What one reconciliation call did. */
export interface ReconcileReport {
  chapterId: string;
  /** True when the chapter was already stamped with the current revision. */
  skipped: boolean;
  /** Occurrence rows created for token positions that had none. */
  inserted: number;
  /** Distinct forms whose occurrences gained a `word_id`. */
  resolved: number;
  /** Cursor for the next call — a `sentences.chapter_position`. */
  cursor: number;
  done: boolean;
}

export interface ReconcileInput {
  /** A client that may READ the chapter. RLS is the authorisation. */
  read: Client;
  /** A service-role client. The only thing allowed to write occurrences. */
  service: Client;
  chapterId: string;
  /** Resume point: a `chapter_position`. Omit to start at the beginning. */
  afterPosition?: number;
  /** A pre-loaded dictionary, for batches. Loaded from `read` when absent. */
  snapshot?: DictionarySnapshot;
  /** Reconcile even when the chapter is already stamped at this revision. */
  force?: boolean;
}

/** How many rows one bounded read fetches per page. PostgREST caps responses. */
const PAGE_SIZE = 1000;

/**
 * Reconcile one batch of one chapter.
 *
 * Returns `done: true` when the chapter has been walked to its end — at which
 * point, and only then, `chapter_vocabulary` is recomputed and the chapter is
 * stamped with the dictionary revision it now agrees with.
 */
export async function reconcileChapterDictionary(
  input: ReconcileInput,
): Promise<ActionResult<ReconcileReport>> {
  const { data: chapter, error } = await input.read
    .from("chapters")
    .select("id, status, dictionary_revision")
    .eq("id", input.chapterId)
    .maybeSingle();
  if (error) return failFrom(error, `reconcileChapter: load ${input.chapterId}`);
  if (!chapter) return fail("not_found", `reconcileChapter: ${input.chapterId}`);

  let snapshot: DictionarySnapshot;
  try {
    snapshot = input.snapshot ?? (await getDictionarySnapshot(input.read));
  } catch (cause) {
    return fail("database_error", "reconcileChapter: dictionary", cause);
  }

  const cursor = input.afterPosition ?? 0;
  const upToDate =
    chapter.dictionary_revision !== null &&
    Number(chapter.dictionary_revision) === snapshot.revision;

  // THE CHEAP PATH, AND THE COMMON ONE. A chapter whose stored `word_id`s were
  // resolved against exactly this dictionary has nothing to gain from a pass
  // over it, and this is what keeps "open a chapter" at the cost it had before.
  if (upToDate && !input.force && cursor === 0) {
    return {
      ok: true,
      chapterId: chapter.id,
      skipped: true,
      inserted: 0,
      resolved: 0,
      cursor: 0,
      done: true,
    };
  }

  const { data: sentenceRows, error: sentenceError } = await input.read
    .from("sentences")
    .select("id, text, chapter_position")
    .eq("chapter_id", chapter.id)
    .gt("chapter_position", cursor === 0 ? -1 : cursor)
    .order("chapter_position", { ascending: true })
    .limit(DICTIONARY_SYNC_SENTENCE_BATCH);
  if (sentenceError) {
    return failFrom(sentenceError, `reconcileChapter: sentences ${chapter.id}`);
  }

  const batch = sentenceRows ?? [];
  const done = batch.length < DICTIONARY_SYNC_SENTENCE_BATCH;
  const nextCursor =
    batch.length > 0 ? batch[batch.length - 1].chapter_position : cursor;

  let inserted = 0;
  let resolved = 0;

  if (batch.length > 0) {
    const sentences: StoredSentence[] = batch.map((row) => ({
      id: row.id,
      text: row.text,
    }));
    const ids = sentences.map((sentence) => sentence.id);

    let occurrences: StoredOccurrence[];
    try {
      occurrences = await readOccurrences(input.read, chapter.id, ids);
    } catch (cause) {
      return fail("database_error", `reconcileChapter: occurrences ${chapter.id}`, cause);
    }

    const plan = planDictionarySync({ sentences, occurrences, index: snapshot.index });

    if (!isEmptySyncPlan(plan)) {
      // The resolutions ride with the FIRST chunk and the chunks carry the
      // occurrences: applying a resolution twice is a no-op, and applying it
      // early means the rows inserted afterwards are already correct.
      const chunks = chunk(plan.missing, DICTIONARY_SYNC_ROW_BATCH);
      const payloads = chunks.length > 0 ? chunks : [[]];

      for (const [chunkIndex, rows] of payloads.entries()) {
        const { data, error: writeError } = await input.service.rpc(
          "sync_chapter_dictionary",
          {
            p_chapter_id: chapter.id,
            p_occurrences: rows as unknown as Json,
            p_resolutions: (chunkIndex === 0 ? plan.resolutions : []) as unknown as Json,
            p_revision: null,
            p_finalize: false,
          },
        );
        if (writeError) {
          return failFrom(writeError, `reconcileChapter: write ${chapter.id}`);
        }

        const row = (data ?? {}) as { inserted?: number; resolved?: number };
        inserted += row.inserted ?? 0;
        resolved += row.resolved ?? 0;
      }
    }
  }

  if (done) {
    // THE STAMP IS THE LAST THING WRITTEN, and it means "every occurrence in this
    // chapter has been offered to revision N". Written only after the final
    // batch, so an interrupted run leaves the chapter unstamped and is simply
    // redone rather than silently half-finished.
    const { error: finalError } = await input.service.rpc("sync_chapter_dictionary", {
      p_chapter_id: chapter.id,
      p_occurrences: [] as unknown as Json,
      p_resolutions: [] as unknown as Json,
      p_revision: snapshot.revision,
      p_finalize: true,
    });
    if (finalError) {
      return failFrom(finalError, `reconcileChapter: finalize ${chapter.id}`);
    }
  }

  return {
    ok: true,
    chapterId: chapter.id,
    skipped: false,
    inserted,
    resolved,
    cursor: nextCursor,
    done,
  };
}

/**
 * Reconcile a whole chapter, looping the batches internally.
 *
 * Bounded by `maxBatches` so one request can never become unbounded work: a
 * chapter longer than that is finished by the next call, because the cursor is
 * derived from the rows rather than remembered in a client.
 */
export async function reconcileChapterFully(
  input: ReconcileInput & { maxBatches?: number },
): Promise<ActionResult<ReconcileReport>> {
  const limit = input.maxBatches ?? 12;
  let cursor = input.afterPosition ?? 0;
  let inserted = 0;
  let resolved = 0;
  let skipped = true;

  for (let batch = 0; batch < limit; batch += 1) {
    const result = await reconcileChapterDictionary({ ...input, afterPosition: cursor });
    if (!result.ok) return result;

    inserted += result.inserted;
    resolved += result.resolved;
    skipped = skipped && result.skipped;
    cursor = result.cursor;

    if (result.done) {
      return {
        ok: true,
        chapterId: input.chapterId,
        skipped,
        inserted,
        resolved,
        cursor,
        done: true,
      };
    }
  }

  return {
    ok: true,
    chapterId: input.chapterId,
    skipped: false,
    inserted,
    resolved,
    cursor,
    done: false,
  };
}

/** Every occurrence belonging to these sentences, paged. */
async function readOccurrences(
  supabase: Client,
  chapterId: string,
  sentenceIds: readonly number[],
): Promise<StoredOccurrence[]> {
  const rows: StoredOccurrence[] = [];

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("word_occurrences")
      .select("sentence_id, position, normalized, word_id")
      .eq("chapter_id", chapterId)
      .in("sentence_id", sentenceIds as number[])
      .order("sentence_id", { ascending: true })
      .order("position", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;

    for (const row of data) {
      rows.push({
        sentenceId: row.sentence_id,
        position: row.position,
        normalized: row.normalized,
        wordId: row.word_id,
      });
    }
    if (data.length < PAGE_SIZE) break;
  }

  return rows;
}

function chunk<T>(rows: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < rows.length; index += size) {
    chunks.push(rows.slice(index, index + size));
  }
  return chunks;
}
