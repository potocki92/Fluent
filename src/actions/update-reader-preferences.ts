"use server";

import {
  parseReaderPreferences,
  type ReaderPreferences,
} from "@/lib/reading/preferences";
import { fail, failFrom, type ActionResult } from "@/lib/errors";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { toJson } from "@/lib/json";

/**
 * Persist the reader's typography and theme.
 *
 * An ordinary learner-editable profile column, like `daily_word_goal`: it says
 * what someone WANTS, not what they have proved, so the progress guard leaves it
 * alone and the write goes through the learner's own client under RLS.
 *
 * The value is validated before it is stored as well as after it is read.
 * Storing only known keys is what keeps the column from slowly becoming a
 * junk drawer that the reader then has to defend against.
 */
export async function updateReaderPreferences(
  input: Partial<ReaderPreferences>,
): Promise<ActionResult<{ preferences: ReaderPreferences }>> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("unauthorized", "updateReaderPreferences: no session");

  const { data: profile, error: loadError } = await supabase
    .from("profiles")
    .select("reader_preferences")
    .eq("id", user.id)
    .maybeSingle();
  if (loadError) return failFrom(loadError, `updateReaderPreferences: ${user.id}`);

  const next = parseReaderPreferences({
    ...parseReaderPreferences(profile?.reader_preferences),
    ...input,
  });

  const { error } = await supabase
    .from("profiles")
    .update({ reader_preferences: toJson(next) })
    .eq("id", user.id);
  if (error) return failFrom(error, `updateReaderPreferences: save ${user.id}`);

  return { ok: true, preferences: next };
}
