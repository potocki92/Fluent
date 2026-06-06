"use server";

import { createServerSupabaseClient } from "@/lib/supabase/server";

/**
 * Save (or clear) the keyword-method mnemonic shown on a word's flashcard. The
 * mnemonic lives on the shared dictionary row, so writes go through the same
 * "words admin update" RLS policy as the dictionary editor — only admins may
 * edit it; learners see it read-only.
 *
 * An empty string clears the mnemonic (stored as `null`).
 */
export async function saveMnemonic(
  wordId: number,
  text: string,
): Promise<{ mnemonic: string | null }> {
  const supabase = await createServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const mnemonic = text.trim() || null;

  // Ask for the row back so we can tell a real save from an RLS no-op: a
  // non-admin's update matches zero rows (no error, just nothing changed).
  const { data, error } = await supabase
    .from("words")
    .update({ mnemonic })
    .eq("id", wordId)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Forbidden");

  return { mnemonic };
}
