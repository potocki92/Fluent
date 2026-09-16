"use server";

import { requireAdmin } from "@/lib/auth/server";
import { compilePassage, type CompiledPassage, type DictEntry } from "@/lib/text-compiler";

/** Supabase caps a single select at 1000 rows; the dictionary is larger. */
const PAGE_SIZE = 1000;

/**
 * Compile an admin-written plain-text / Markdown source into the sanitised HTML
 * stored in `texts.body`, auto-marking words that exist in the dictionary.
 * Admin only. The whole dictionary (~2.6k rows) is loaded once, paginated past
 * the 1000-row cap, then matching runs in the pure `compilePassage` helper.
 */
export async function compileText(raw: string): Promise<CompiledPassage> {
  if (!raw.trim()) return { html: "", matched: [], unmatched: [] };

  const { supabase } = await requireAdmin();

  const entries: DictEntry[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("words")
      .select("lemma, display")
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;

    entries.push(...data);
    if (data.length < PAGE_SIZE) break;
  }

  return compilePassage(raw, entries);
}
