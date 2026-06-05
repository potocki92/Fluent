"use server";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { SuggestionField } from "@/types";

const FIELD_VALUES: SuggestionField[] = [
  "translation_pl",
  "example_de",
  "example_pl",
  "other",
];

export interface SuggestWordInput {
  wordId: number;
  field: SuggestionField;
  suggestion: string;
  note?: string | null;
}

/**
 * Submit a correction for a dictionary word. Any signed-in learner may propose
 * a better translation/example; it lands in the admin review queue as
 * `pending`. The word itself is only changed once an admin approves
 * (see `reviewSuggestion` in `admin-words.ts`).
 */
export async function suggestWord(
  input: SuggestWordInput,
): Promise<{ submitted: boolean }> {
  const supabase = await createServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  if (!FIELD_VALUES.includes(input.field)) {
    throw new Error("Nieprawidłowe pole zgłoszenia.");
  }
  const suggestion = input.suggestion.trim();
  if (!suggestion) throw new Error("Treść propozycji jest wymagana.");

  const { error } = await supabase.from("word_suggestions").insert({
    word_id: input.wordId,
    user_id: user.id,
    field: input.field,
    suggestion,
    note: input.note?.trim() || null,
  });
  if (error) throw error;

  return { submitted: true };
}
