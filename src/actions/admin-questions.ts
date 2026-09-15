"use server";

import { requireAdmin } from "@/lib/auth/server";
import type { QuestionInput, QuestionWithAnswer } from "@/types";

/**
 * Validate and normalise a question payload. Empty options are dropped; the
 * correct answer must still point at a remaining option. Mirrored client-side
 * in the form for UX, but this is the authoritative check.
 */
function normaliseQuestion(input: QuestionInput) {
  const prompt = input.prompt.trim();
  if (!prompt) throw new Error("Pytanie jest wymagane.");

  // Track which original index the correct answer sat at so it survives the
  // filtering of empty options.
  const cleaned: { text: string; wasCorrect: boolean }[] = input.options
    .map((option, idx) => ({
      text: option.trim(),
      wasCorrect: idx === input.correct_idx,
    }))
    .filter((option) => option.text.length > 0);

  if (cleaned.length < 2) throw new Error("Podaj co najmniej 2 odpowiedzi.");

  const correctIdx = cleaned.findIndex((option) => option.wasCorrect);
  if (correctIdx < 0) throw new Error("Wskaż poprawną odpowiedź.");

  return {
    prompt,
    options: cleaned.map((option) => option.text),
    correct_idx: correctIdx,
  };
}

/** Add a comprehension question to a text. Admin only. */
export async function createQuestion(
  textId: number,
  input: QuestionInput,
): Promise<QuestionWithAnswer> {
  const { supabase } = await requireAdmin();

  const { data, error } = await supabase
    .from("questions")
    .insert({ text_id: textId, ...normaliseQuestion(input) })
    .select()
    .single();
  if (error) throw error;

  return data as unknown as QuestionWithAnswer;
}

/** Update an existing question. Admin only. */
export async function updateQuestion(
  id: number,
  input: QuestionInput,
): Promise<QuestionWithAnswer> {
  const { supabase } = await requireAdmin();

  const { data, error } = await supabase
    .from("questions")
    .update(normaliseQuestion(input))
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;

  return data as unknown as QuestionWithAnswer;
}

/** Delete a question. Admin only. */
export async function deleteQuestion(id: number): Promise<{ id: number }> {
  const { supabase } = await requireAdmin();

  const { error } = await supabase.from("questions").delete().eq("id", id);
  if (error) throw error;

  return { id };
}
