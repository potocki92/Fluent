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
