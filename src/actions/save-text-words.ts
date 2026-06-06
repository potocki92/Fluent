"use server";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { extractLemmas } from "@/lib/lemmas";

/**
 * Save all vocabulary-annotated words from a reading passage into the current
 * user's review deck. Words already saved are silently skipped (idempotent
 * upsert). Returns the number of words that matched dictionary entries.
 */
export async function saveTextWords(
  textId: number,
): Promise<{ saved: number }> {
  const supabase = await createServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  // Load the passage body (we only need the raw HTML for lemma extraction).
  const { data: text, error: tError } = await supabase
    .from("texts")
    .select("body")
    .eq("id", textId)
    .maybeSingle();
  if (tError) throw tError;
  if (!text) throw new Error("Tekst nie znaleziony");

  const lemmas = extractLemmas(text.body);
  if (lemmas.length === 0) return { saved: 0 };

  // Resolve lemmas to word ids — case-insensitive, ignore missing entries.
  const { data: words, error: wError } = await supabase
    .from("words")
    .select("id, lemma")
    .in("lemma", lemmas);
  if (wError) throw wError;

  const rows = (words ?? []).map((w) => ({
    user_id: user.id,
    word_id: w.id,
  }));
  if (rows.length === 0) return { saved: 0 };

  const { error: uError } = await supabase
    .from("saved_words")
    .upsert(rows, { onConflict: "user_id,word_id", ignoreDuplicates: true });
  if (uError) throw uError;

  return { saved: rows.length };
}
