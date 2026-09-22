"use server";

import { invalidateDictionarySnapshot } from "@/lib/content/dictionary-snapshot";
import { requireAdmin } from "@/lib/auth/server";
import { toTopic } from "@/lib/word-topics";
import type { SuggestionStatus, Word, WordInput } from "@/types";

const CEFR_VALUES: NonNullable<WordInput["cefr"]>[] = ["A1", "A2", "B1", "B2"];
const TYPE_VALUES: WordInput["word_type"][] = ["noun", "verb", "other"];
const ARTICLE_VALUES: NonNullable<WordInput["article"]>[] = ["der", "die", "das"];
const GENDER_VALUES: NonNullable<WordInput["gender"]>[] = ["m", "f", "n"];
const AUX_VALUES: NonNullable<WordInput["aux"]>[] = ["haben", "sein"];

type WordActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

/** Trim a string field, collapsing empty input to null. */
function trimOrNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** Extract a safe message from expected Server Action failures. */
function actionErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  // Supabase zwraca PostgrestError jako zwykły obiekt { message, details, hint,
  // code }, który nie jest instancją Error — wyciągnij komunikat wprost, by nie
  // maskować prawdziwej przyczyny ogólnym "Coś poszło nie tak.".
  if (
    typeof err === "object" &&
    err !== null &&
    "message" in err &&
    typeof (err as { message: unknown }).message === "string"
  ) {
    return (err as { message: string }).message;
  }
  return "Coś poszło nie tak.";
}

/** Validate and normalise a word payload shared by create/update. */
function normaliseWord(input: WordInput) {
  const lemma = input.lemma.trim();
  if (!lemma) throw new Error("Lemat jest wymagany.");
  const display = input.display.trim();
  if (!display) throw new Error("Forma wyświetlana jest wymagana.");

  if (!TYPE_VALUES.includes(input.word_type)) {
    throw new Error("Nieprawidłowy typ słowa.");
  }
  if (input.cefr && !CEFR_VALUES.includes(input.cefr)) {
    throw new Error("Nieprawidłowy poziom CEFR.");
  }
  if (input.article && !ARTICLE_VALUES.includes(input.article)) {
    throw new Error("Nieprawidłowy rodzajnik.");
  }
  if (input.gender && !GENDER_VALUES.includes(input.gender)) {
    throw new Error("Nieprawidłowy rodzaj gramatyczny.");
  }
  if (input.aux && !AUX_VALUES.includes(input.aux)) {
    throw new Error("Nieprawidłowy czasownik posiłkowy.");
  }

  const synonyms = (input.synonyms ?? [])
    .map((s) => s.trim())
    .filter(Boolean);

  return {
    lemma,
    display,
    article: input.article ?? null,
    word_type: input.word_type,
    gender: input.gender ?? null,
    translation_pl: trimOrNull(input.translation_pl),
    example_de: trimOrNull(input.example_de),
    example_pl: trimOrNull(input.example_pl),
    cefr: input.cefr ?? null,
    source: trimOrNull(input.source),
    topic: toTopic(input.topic) ?? null,
    plural: trimOrNull(input.plural),
    aux: input.aux ?? null,
    synonyms: synonyms.length ? synonyms : null,
    ipa: trimOrNull(input.ipa),
  };
}

/**
 * Create a new dictionary entry. Admin only.
 *
 * THE ID IS THE DATABASE'S TO HAND OUT. This used to read `max(id)`, add one
 * and insert that — so two admins adding a word in the same moment both read
 * the same maximum, both tried the same id, and one lost to a primary-key
 * violation surfaced as a raw Postgres message. `words.id` is still a plain
 * bigint rather than an identity column, because the seeds and the wordlist
 * import name their own ids and those ids are referenced from half the schema;
 * what changed is that the column now DEFAULTS to a sequence, and a trigger
 * keeps that sequence ahead of every explicit id. See
 * `supabase/migrations/20260922120000_dictionary_write_integrity.sql`.
 */
export async function createWord(
  input: WordInput,
): Promise<WordActionResult<Word>> {
  try {
    const { supabase } = await requireAdmin();

    const { data, error } = await supabase
      .from("words")
      .insert(normaliseWord(input))
      .select()
      .single();
    if (error) throw error;

    // THE DICTIONARY JUST CHANGED, AND THE READER MUST NOT WAIT TO FIND OUT.
    // The cached index is keyed on `dictionary_revision`, which a trigger has
    // already bumped, so every instance notices within
    // `DICTIONARY_REVISION_TTL_MS`. This is the one that accepted the change
    // dropping its copy immediately: "I added the word" and "the word works"
    // should be the same moment.
    invalidateDictionarySnapshot();

    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: actionErrorMessage(err) };
  }
}

/** Update an existing dictionary entry. Admin only. */
export async function updateWord(
  id: number,
  input: WordInput,
): Promise<WordActionResult<Word>> {
  try {
    const { supabase } = await requireAdmin();

    const { data, error } = await supabase
      .from("words")
      .update(normaliseWord(input))
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;

    // An edited lemma or `display` changes what the index resolves, exactly as an
    // insert does.
    invalidateDictionarySnapshot();

    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: actionErrorMessage(err) };
  }
}

/**
 * Delete a dictionary entry. Admin only. Saved words and pending suggestions
 * referencing it cascade via their FKs.
 */
export async function deleteWord(id: number): Promise<{ id: number }> {
  const { supabase } = await requireAdmin();

  const { error } = await supabase.from("words").delete().eq("id", id);
  if (error) throw error;

  // A deletion matters as much as an insert: the occurrences that pointed here
  // are nulled by the foreign key, and the index must stop claiming the word.
  invalidateDictionarySnapshot();

  return { id };
}

/**
 * Review a learner-submitted suggestion. Admin only. Approving overwrites the
 * target word field with the suggested value; rejecting just records the
 * decision. The `field = 'other'` case is treated as a free-form note and never
 * overwrites a column.
 */
export async function reviewSuggestion(
  id: number,
  decision: Exclude<SuggestionStatus, "pending">,
): Promise<{ id: number; status: SuggestionStatus; applied: boolean }> {
  // The admin check stays here so an unauthorised caller never reaches the
  // database at all; the RPC checks `is_admin()` again from `auth.uid()`,
  // because a check in the application is a convenience and a check in the
  // function is the boundary.
  const { supabase } = await requireAdmin();

  const { data, error } = await supabase.rpc("review_word_suggestion", {
    p_suggestion_id: id,
    p_decision: decision,
  });
  if (error) throw error;

  const result = data?.[0];
  if (!result) throw new Error("Nie znaleźliśmy tego zgłoszenia.");

  // Only a call that actually wrote to `words` can have changed what the reader
  // resolves. An already-decided suggestion wrote nothing.
  if (result.updated_word_id !== null) invalidateDictionarySnapshot();

  return { id, status: result.status, applied: result.applied };
}
