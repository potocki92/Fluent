import type { Database } from "./database";

export type { Database, Json } from "./database";

/** CEFR levels surfaced in the UI. `A1+` is a derived band (not stored). */
export type CefrLevel = "A1" | "A1+" | "A2" | "B1" | "B2";

export type WordType = "noun" | "verb" | "other";

type Tables = Database["public"]["Tables"];

/** A dictionary entry. */
export type Word = Tables["words"]["Row"];

/** A reading passage. */
export type Text = Tables["texts"]["Row"];

/**
 * A comprehension question as sent to the client.
 * `correct_idx` is intentionally omitted — it is only known server-side and is
 * applied inside the `submit-answer` Server Action.
 */
export type Question = Omit<Tables["questions"]["Row"], "correct_idx"> & {
  options: string[];
};

/** Full question row including the answer key (server-only). */
export type QuestionWithAnswer = Tables["questions"]["Row"] & {
  options: string[];
};

/** A learner profile holding the Elo ability estimate. */
export type Profile = Tables["profiles"]["Row"];

/** An immutable record of a single answered question. */
export type Attempt = Tables["attempts"]["Row"];

/** A saved dictionary word together with its SM-2 scheduling state. */
export type SavedWord = Tables["saved_words"]["Row"];

/** The learner's current ability snapshot used across the UI. */
export interface AbilityState {
  ability: number;
  rd: number;
  answered: number;
  cefrEstimate: CefrLevel | null;
}

/** The outcome of grading a single answer. */
export interface TestResult {
  questionId: number;
  isCorrect: boolean;
  abilityBefore: number;
  abilityAfter: number;
}
