"use server";

import { createServerSupabaseClient } from "@/lib/supabase/server";

/**
 * Save a dictionary word to the current user's review deck. The SM-2 columns
 * default to a fresh card (due now). Idempotent via upsert on (user_id, word_id).
 */
export async function saveWord(wordId: number): Promise<{ saved: boolean }> {
  const supabase = await createServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { error } = await supabase
    .from("saved_words")
    .upsert(
      { user_id: user.id, word_id: wordId },
      { onConflict: "user_id,word_id", ignoreDuplicates: true },
    );
  if (error) throw error;

  return { saved: true };
}

/** Remove a word from the user's review deck. */
export async function unsaveWord(wordId: number): Promise<{ saved: boolean }> {
  const supabase = await createServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { error } = await supabase
    .from("saved_words")
    .delete()
    .eq("user_id", user.id)
    .eq("word_id", wordId);
  if (error) throw error;

  return { saved: false };
}
