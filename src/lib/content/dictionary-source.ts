/**
 * Loading the dictionary for a processing run.
 *
 * The pipeline in `process.ts` is pure and takes its dictionary as an argument;
 * this is the one place that fetches it. Two things matter here and nowhere
 * else:
 *
 *  - **Order.** The index resolves key collisions by "first entry wins", so the
 *    rows must arrive in a stable order (`id`) or the same source could produce
 *    different occurrences on two runs — and the pipeline's determinism is what
 *    protects every stored reading position.
 *  - **Pagination.** PostgREST caps a single select at 1000 rows and the
 *    dictionary is larger, so a naive query would silently truncate and quietly
 *    stop glossing a third of the alphabet.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { DictionaryEntry } from "@/lib/content/dictionary-match";
import type { Database } from "@/types/database";

const PAGE_SIZE = 1000;

export async function loadDictionaryEntries(
  supabase: SupabaseClient<Database>,
): Promise<DictionaryEntry[]> {
  const entries: DictionaryEntry[] = [];

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("words")
      .select("id, lemma, display")
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;

    entries.push(...data);
    if (data.length < PAGE_SIZE) break;
  }

  return entries;
}

/**
 * The dictionary's revision number — "has `words` changed since I last looked?"
 *
 * ONE ROW, ONE READ, WHATEVER THE DICTIONARY'S SIZE. A statement-level trigger on
 * `words` bumps this counter on every insert, update and delete, so the question
 * costs a primary-key lookup rather than a `count(*)` that grows with the
 * dictionary — and, unlike a `max(updated_at)` heuristic, a DELETE moves it too.
 *
 * It is the stamp that lets a chapter say which dictionary its stored `word_id`s
 * were resolved against (`chapters.dictionary_revision`), which is what makes the
 * reconciliation pass a no-op when nothing has changed.
 */
export async function loadDictionaryRevision(
  supabase: SupabaseClient<Database>,
): Promise<number> {
  const { data, error } = await supabase
    .from("dictionary_revision")
    .select("revision")
    .eq("id", true)
    .maybeSingle();
  if (error) throw error;

  // A database that predates the trigger has no row. Revision 0 means "unknown",
  // which every chapter's stamp differs from — the safe answer, because it
  // resolves rather than skips.
  return Number(data?.revision ?? 0);
}
