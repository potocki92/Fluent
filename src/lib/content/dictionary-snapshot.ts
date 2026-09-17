/**
 * The dictionary, as of right now — loaded once per server instance and checked
 * cheaply.
 *
 * WHY A CACHE AT ALL. Resolution is a map lookup, but BUILDING the map means
 * reading every row of `words`. That is fine once per import run and absurd once
 * per chapter render, which is exactly what the reader needs it for now that a
 * token's `word_id` can be filled in at read time.
 *
 * WHY THE CACHE CANNOT GO STALE. The whole point of this phase is that a word
 * added today works in an existing book today, so a cache that answers with
 * yesterday's dictionary would reintroduce the bug one layer down. Two things
 * prevent it:
 *
 *   1. A REVISION, not a timer. `dictionary_revision` is bumped by a trigger on
 *      `words` for every insert, update and delete. The cached index is only
 *      reused while the revision it was built from is still current, and that is
 *      one primary-key read — not a `count(*)`, which would grow with the
 *      dictionary and still miss an in-place UPDATE.
 *   2. A DIRECT INVALIDATION. The Server Actions that write `words` call
 *      {@link invalidateDictionarySnapshot}, so the instance that accepted the
 *      change never even waits for the check.
 *
 * The revision read itself is throttled by `DICTIONARY_REVISION_TTL_MS`, so a
 * burst of page views costs one small query rather than one per render. That TTL
 * is the ONLY staleness window in the system, it is measured in seconds, and it
 * is a deliberate, documented number rather than "until the next deploy".
 *
 * SERVER-ONLY. It takes a Supabase client as a parameter and is imported by
 * server components, server actions and the processor. There is nothing secret
 * in it — `words` is public-read — but a browser has no business holding the
 * whole dictionary in memory, which is why resolution for a single tapped word
 * goes through a Server Action instead.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { DICTIONARY_REVISION_TTL_MS } from "@/lib/content/constants";
import { buildDictionaryIndex, type DictionaryIndex } from "@/lib/content/dictionary-match";
import {
  loadDictionaryEntries,
  loadDictionaryRevision,
} from "@/lib/content/dictionary-source";
import type { Database } from "@/types/database";

type Client = SupabaseClient<Database>;

/** The dictionary at one point in time, and the stamp that identifies it. */
export interface DictionarySnapshot {
  /** `dictionary_revision.revision` when the index was built. */
  revision: number;
  index: DictionaryIndex;
}

interface CacheEntry extends DictionarySnapshot {
  /** When the revision was last confirmed — not when the index was built. */
  checkedAt: number;
}

let cache: CacheEntry | null = null;

/**
 * The current dictionary index.
 *
 * Callers that process or reconcile a whole book should take this ONCE and pass
 * it down: forty chapters must not mean forty dictionary loads for an identical
 * result.
 */
export async function getDictionarySnapshot(
  supabase: Client,
  now: number = Date.now(),
): Promise<DictionarySnapshot> {
  const cached = cache;
  if (cached && now - cached.checkedAt < DICTIONARY_REVISION_TTL_MS) {
    return { revision: cached.revision, index: cached.index };
  }

  const revision = await loadDictionaryRevision(supabase);
  if (cached && cached.revision === revision) {
    cached.checkedAt = now;
    return { revision: cached.revision, index: cached.index };
  }

  const index = buildDictionaryIndex(await loadDictionaryEntries(supabase));
  cache = { revision, index, checkedAt: now };
  return { revision, index };
}

/**
 * Forget the cached dictionary.
 *
 * Called by every path that writes `words` — creating, editing or deleting an
 * entry, and accepting a suggestion. Best effort by nature: it clears THIS
 * instance, and the revision check clears the others within
 * `DICTIONARY_REVISION_TTL_MS`. Neither is load-bearing for correctness; both
 * exist so "I just added the word" and "the word works" are the same moment.
 */
export function invalidateDictionarySnapshot(): void {
  cache = null;
}
