import type { Database } from "./database";

export type { Database, Json } from "./database";

/** CEFR levels surfaced in the UI. `A1+` is a derived band (not stored). */
export type CefrLevel = "A1" | "A1+" | "A2" | "B1" | "B2";

export type WordType = "noun" | "verb" | "other";

/** Verb auxiliary used to form the perfect tense. */
export type WordAux = "haben" | "sein";

/** DTZ thematic categories a dictionary word can belong to. */
export type WordTopic =
  | "praca"
  | "zdrowie"
  | "urzad"
  | "mieszkanie"
  | "zakupy"
  | "rodzina"
  | "edukacja"
  | "podroze"
  | "czas-wolny"
  | "jedzenie";

type Tables = Database["public"]["Tables"];

/** A dictionary entry. */
export type Word = Tables["words"]["Row"];

/** A reading passage. */
export type Text = Tables["texts"]["Row"];

/** Publication state of a reading passage. Drafts are admin-only. */
export type TextStatus = "draft" | "published";

/** The stored CEFR levels (the narrow set used by texts/questions, no `A1+`). */
export type StoredCefrLevel = "A1" | "A2" | "B1" | "B2";

/** Payload for creating/updating a text from the admin panel. */
export interface TextInput {
  title: string;
  cefr: StoredCefrLevel;
  body: string;
  status: TextStatus;
  word_count?: number | null;
}

/** Payload for creating/updating a question from the admin panel. */
export interface QuestionInput {
  prompt: string;
  options: string[];
  correct_idx: number;
}

/** Full question row including the answer key (server-only). */
export type QuestionWithAnswer = Tables["questions"]["Row"] & {
  options: string[];
};

/**
 * A standalone placement-test item as sent to the client — the row of the
 * answer-free `calibration_questions_public` view, so `correct_idx` is not
 * merely omitted here, it is absent from the read surface. The key is revealed
 * only by `answer_calibration_question`, for an item in the caller's own
 * placement session, once their answer to it is committed.
 *
 * Reading-test questions have no equivalent type here — they reach the client
 * only as part of a session, typed by `TestSessionQuestion` in
 * `@/actions/start-test-session`.
 */
export type CalibrationQuestion =
  Database["public"]["Views"]["calibration_questions_public"]["Row"];

/** A learner profile holding the Elo ability estimate. */
export type Profile = Tables["profiles"]["Row"];

/** Where a learner's displayed level came from — claimed, placed, or earned. */
export type LevelSource = Profile["level_source"];

/** An immutable record of a single answered question. */
export type Attempt = Tables["attempts"]["Row"];

/** One graded reading test, from `in_progress` to its immutable result. */
export type TestSession = Tables["test_sessions"]["Row"];

/** A single question inside a test session, holding at most one answer. */
export type TestSessionItem = Tables["test_session_items"]["Row"];

/** A saved dictionary word together with its SM-2 scheduling state. */
export type SavedWord = Tables["saved_words"]["Row"];

/** The learner's latest result for a single reading passage. */
export type TextCompletion = Tables["text_completions"]["Row"];

/** Payload for creating/updating a dictionary word from the admin panel. */
export interface WordInput {
  lemma: string;
  display: string;
  article: "der" | "die" | "das" | null;
  word_type: WordType;
  gender: "m" | "f" | "n" | null;
  translation_pl: string | null;
  example_de: string | null;
  example_pl: string | null;
  cefr: StoredCefrLevel | null;
  source: string | null;
  topic: WordTopic | null;
  plural: string | null;
  aux: WordAux | null;
  synonyms: string[] | null;
  ipa: string | null;
}

/** A learner-submitted dictionary correction awaiting admin review. */
export type WordSuggestion = Tables["word_suggestions"]["Row"];

/** Which word field a suggestion targets. */
export type SuggestionField = WordSuggestion["field"];

/** Review state of a word suggestion. */
export type SuggestionStatus = WordSuggestion["status"];

/** The learner's current ability snapshot used across the UI. */
export interface AbilityState {
  ability: number;
  rd: number;
  answered: number;
  cefrEstimate: CefrLevel | null;
}
