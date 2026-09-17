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
 * Create a new dictionary entry. Admin only. `words.id` is a plain bigint (not
 * an identity column), so we derive the next id from the current maximum.
 */
export async function createWord(
  input: WordInput,
): Promise<WordActionResult<Word>> {
  try {
    const { supabase } = await requireAdmin();

    const { data: top, error: maxError } = await supabase
      .from("words")
      .select("id")
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (maxError) throw maxError;

    const nextId = (top?.id ?? 0) + 1;

    const { data, error } = await supabase
      .from("words")
      .insert({ id: nextId, ...normaliseWord(input) })
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
): Promise<{ id: number; status: SuggestionStatus }> {
  const { supabase, user } = await requireAdmin();

  const { data: suggestion, error: loadError } = await supabase
    .from("word_suggestions")
    .select("word_id, field, suggestion, status")
    .eq("id", id)
    .single();
  if (loadError) throw loadError;
  if (suggestion.status !== "pending") {
    throw new Error("To zgłoszenie zostało już rozpatrzone.");
  }

  if (decision === "approved" && suggestion.field !== "other") {
    const value = suggestion.suggestion.trim();
    // Explicit per-field mapping keeps the update strongly typed (a computed
    // key would widen to a string index signature Supabase rejects).
    const patch: Partial<Word> =
      suggestion.field === "translation_pl"
        ? { translation_pl: value }
        : suggestion.field === "example_de"
          ? { example_de: value }
          : { example_pl: value };

    const { error: applyError } = await supabase
      .from("words")
      .update(patch)
      .eq("id", suggestion.word_id);
    if (applyError) throw applyError;

    invalidateDictionarySnapshot();
  }

  const { error: markError } = await supabase
    .from("word_suggestions")
    .update({
      status: decision,
      reviewed_at: new Date().toISOString(),
      reviewed_by: user.id,
    })
    .eq("id", id);
  if (markError) throw markError;

  return { id, status: decision };
}
