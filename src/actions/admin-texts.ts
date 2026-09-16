"use server";

import { requireAdmin } from "@/lib/auth/server";
import { CEFR_DIFFICULTY } from "@/lib/cefr";
import type { Text, TextInput, TextStatus } from "@/types";

const CEFR_VALUES: TextInput["cefr"][] = ["A1", "A2", "B1", "B2"];

/** Count words in a passage body, ignoring HTML tags. */
function countWords(body: string): number {
  const text = body
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text ? text.split(" ").length : 0;
}

/** Validate and normalise a text payload shared by create/update. */
function normaliseText(input: TextInput) {
  const title = input.title.trim();
  if (!title) throw new Error("Tytuł jest wymagany.");
  if (!CEFR_VALUES.includes(input.cefr)) {
    throw new Error("Nieprawidłowy poziom CEFR.");
  }
  const body = input.body.trim();
  if (!body) throw new Error("Treść nie może być pusta.");

  const status: TextStatus = input.status === "published" ? "published" : "draft";

  return {
    title,
    cefr: input.cefr,
    body,
    status,
    word_count: input.word_count ?? countWords(body),
    // Text Elo follows its CEFR band — the adaptive suggestion relies on it.
    difficulty: CEFR_DIFFICULTY[input.cefr],
  };
}

/** Create a new reading passage. Admin only. */
export async function createText(input: TextInput): Promise<Text> {
  const { supabase } = await requireAdmin();

  const { data, error } = await supabase
    .from("texts")
    .insert(normaliseText(input))
    .select()
    .single();
  if (error) throw error;

  return data;
}

/** Update an existing reading passage. Admin only. */
export async function updateText(id: number, input: TextInput): Promise<Text> {
  const { supabase } = await requireAdmin();

  const { data, error } = await supabase
    .from("texts")
    .update(normaliseText(input))
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;

  return data;
}

/** Delete a reading passage. Its questions cascade via the FK. Admin only. */
export async function deleteText(id: number): Promise<{ id: number }> {
  const { supabase } = await requireAdmin();

  const { error } = await supabase.from("texts").delete().eq("id", id);
  if (error) throw error;

  return { id };
}

/** Toggle a passage between draft and published. Admin only. */
export async function setTextStatus(
  id: number,
  status: TextStatus,
): Promise<{ id: number; status: TextStatus }> {
  const { supabase } = await requireAdmin();

  const next: TextStatus = status === "published" ? "published" : "draft";
  const { error } = await supabase
    .from("texts")
    .update({ status: next })
    .eq("id", id);
  if (error) throw error;

  return { id, status: next };
}
