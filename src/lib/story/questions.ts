/**
 * The chapter question bank: what a question IS, and what makes one admissible.
 *
 * THE PREMISE. Questions for arbitrary books cannot be hand-written — a
 * 40-chapter novel is 40 question sets, and there is no editorial team. So they
 * are generated. The moment that is true, the interesting problem stops being
 * "how do we make questions?" and becomes "how do we refuse the bad ones?",
 * because a generated question that is ambiguous, ungrammatical, or has two
 * correct answers does not merely waste thirty seconds: it writes FALSE evidence
 * into the knowledge model, and Fluent then plans a learner's week around a
 * weakness that never existed.
 *
 * Hence the shape of this module:
 *
 *     candidate  →  structural validation  →  grounding validation  →  question
 *
 * Nothing reaches a learner without passing both. A model's output is a
 * CANDIDATE — never a fact, never a source of truth — and every rejection is
 * recorded with a reason so a bad prompt shows up as a pattern rather than as a
 * learner complaint.
 *
 * SOURCE GROUNDING is the other half. Every question carries the sentence ids it
 * was written from, which is what makes it possible to check that a question
 * about "the letter Anna burned" corresponds to a sentence in which Anna burned
 * a letter — the cheapest defence there is against a model inventing chapter
 * content. It is also what lets a wrong answer be explained later, and what tells
 * a reprocessed chapter which questions no longer have anything to stand on.
 *
 * Pure: no Supabase, no network, no clock.
 */

import { isConceptCode, type ConceptCode } from "@/lib/learning/concepts";
import { isSkillCode, type SkillCode } from "@/lib/learning/skills";
import {
  MAX_MCQ_OPTIONS,
  MAX_OPTION_LENGTH,
  MAX_PROMPT_LENGTH,
  MAX_SEQUENCE_ELEMENTS,
  MIN_MCQ_OPTIONS,
  MIN_SEQUENCE_ELEMENTS,
  QUESTION_KINDS,
  type QuestionKind,
} from "@/lib/story/constants";

export type { QuestionKind };

/**
 * How a question is answered.
 *
 * The schema knows six; Phase 5 GRADES four — `multiple_choice`, `true_false`,
 * `cloze` and `sequence` — because those are the four a database function can
 * grade unambiguously with no model in the loop. `multi_select` and free
 * `typed_answer` are catalogued so the column and the generator contract do not
 * have to change when partial credit and fuzzy grading are built; nothing
 * produces them and {@link validateQuestion} refuses them, which is the honest
 * state rather than a half-built one.
 */
export type QuestionType =
  | "multiple_choice"
  | "true_false"
  | "cloze"
  | "sequence"
  | "multi_select"
  | "typed_answer";

/** Answer mechanics Phase 5 can actually grade. */
export const GRADABLE_QUESTION_TYPES: readonly QuestionType[] = [
  "multiple_choice",
  "true_false",
  "cloze",
  "sequence",
];

/**
 * Whether a question was written from one passage of the chapter or from the
 * chapter as a whole.
 *
 * A long chapter is generated in chunks, and "co wydarzyło się najpierw?" cannot
 * be asked of a chunk containing only the middle. Keeping the distinction lets
 * the pipeline run local generation per chunk and synthesis once, without either
 * pretending to be the other.
 */
export type QuestionScope = "local" | "chapter";

/** Where a question came from. `manual` is an admin; `ai` is a model candidate. */
export type GenerationSource = "manual" | "ai" | "template";

/** A proposed question, before anything has been checked. */
export interface QuestionCandidate {
  kind: QuestionKind;
  type: QuestionType;
  scope: QuestionScope;
  prompt: string;
  /** Present for `multiple_choice` and `true_false`. */
  options?: readonly string[] | null;
  correctIdx?: number | null;
  /** Present for `cloze`: every spelling that counts as right. */
  acceptedAnswers?: readonly string[] | null;
  /** Present for `sequence`: the events, IN THE CORRECT ORDER. */
  sequenceItems?: readonly string[] | null;
  skillCode: string;
  conceptCodes?: readonly string[] | null;
  /** The dictionary word this question tests, when it genuinely tests one. */
  wordId?: number | null;
  difficulty?: number | null;
  /** Sentences the question was written from. See the module comment. */
  sourceSentenceIds?: readonly number[] | null;
  explanationPl?: string | null;
}

/** A candidate that passed every check, normalised and ready to store. */
export interface ValidatedQuestion {
  kind: QuestionKind;
  type: QuestionType;
  scope: QuestionScope;
  prompt: string;
  options: string[] | null;
  correctIdx: number | null;
  acceptedAnswers: string[] | null;
  sequenceItems: string[] | null;
  skillCode: SkillCode;
  conceptCodes: ConceptCode[];
  wordId: number | null;
  difficulty: number;
  sourceSentenceIds: number[];
  explanationPl: string | null;
  /** Stable identity of the question's content — see {@link questionFingerprint}. */
  fingerprint: string;
}

/** Why a candidate was refused. Stored on the generation job, shown to admins. */
export type ValidationErrorCode =
  | "prompt_missing"
  | "prompt_too_long"
  | "unknown_kind"
  | "unknown_type"
  | "ungradable_type"
  | "options_count"
  | "option_empty"
  | "option_too_long"
  | "duplicate_options"
  | "correct_index_out_of_range"
  | "cloze_no_blank"
  | "cloze_no_answer"
  | "sequence_count"
  | "duplicate_sequence_items"
  | "unknown_skill"
  | "unknown_concept"
  | "skill_kind_mismatch"
  | "missing_grounding"
  | "foreign_grounding"
  | "vocabulary_word_missing"
  | "foreign_word";

export interface ValidationError {
  code: ValidationErrorCode;
  detail?: string;
}

export type ValidationResult =
  | { ok: true; question: ValidatedQuestion }
  | { ok: false; errors: ValidationError[] };

/** Everything a candidate is checked AGAINST. All of it comes from the chapter. */
export interface GroundingContext {
  /** Every sentence id that belongs to this chapter. */
  sentenceIds: ReadonlySet<number>;
  /** Every dictionary word id that occurs in this chapter. */
  wordIds: ReadonlySet<number>;
}

/** The blank a cloze prompt must contain. Three underscores or more. */
const CLOZE_BLANK = /_{3,}/;

/** Default difficulty when a generator offers none: the Elo origin. */
export const DEFAULT_QUESTION_DIFFICULTY = 1200;
const MIN_QUESTION_DIFFICULTY = 600;
const MAX_QUESTION_DIFFICULTY = 2200;

/** Separator used when hashing a question's parts. Never displayed. */
const FIELD_SEPARATOR = "|::|";

/**
 * Which skills a kind of question may claim.
 *
 * This is not bookkeeping — it is the evidence map enforced at the point of
 * entry. A "comprehension" question tagged `grammar` would send a wrong answer
 * about the plot into the learner's grammar state, and the learning engine's
 * rule that evidence is never transferred between dimensions would then be
 * broken by a mislabelled row rather than by any code anyone could find.
 */
const KIND_SKILLS: Readonly<Record<QuestionKind, readonly SkillCode[]>> = {
  comprehension: ["reading_comprehension"],
  contextual_vocabulary: ["receptive_vocabulary", "active_vocabulary"],
  grammar: ["grammar"],
  // Transfer asks the same knowledge in a new context, so it is whichever
  // dimension it transfers — vocabulary or grammar, never comprehension.
  transfer: ["grammar", "receptive_vocabulary", "active_vocabulary"],
};

/** Validate one candidate against the chapter it claims to come from. */
export function validateQuestion(
  candidate: QuestionCandidate,
  grounding: GroundingContext,
): ValidationResult {
  const errors: ValidationError[] = [];

  const prompt = (candidate.prompt ?? "").trim();
  if (prompt.length === 0) errors.push({ code: "prompt_missing" });
  if (prompt.length > MAX_PROMPT_LENGTH) {
    errors.push({ code: "prompt_too_long", detail: String(prompt.length) });
  }

  if (!QUESTION_KINDS.includes(candidate.kind)) {
    errors.push({ code: "unknown_kind", detail: String(candidate.kind) });
  }

  if (!GRADABLE_QUESTION_TYPES.includes(candidate.type)) {
    errors.push({
      code: isQuestionType(candidate.type) ? "ungradable_type" : "unknown_type",
      detail: String(candidate.type),
    });
  }

  const options = normaliseList(candidate.options);
  const acceptedAnswers = normaliseList(candidate.acceptedAnswers);
  const sequenceItems = normaliseList(candidate.sequenceItems);

  if (candidate.type === "multiple_choice" || candidate.type === "true_false") {
    const min = candidate.type === "true_false" ? 2 : MIN_MCQ_OPTIONS;
    const max = candidate.type === "true_false" ? 2 : MAX_MCQ_OPTIONS;

    if (options.length < min || options.length > max) {
      errors.push({ code: "options_count", detail: String(options.length) });
    }
    if (options.some((option) => option.length === 0)) {
      errors.push({ code: "option_empty" });
    }
    if (options.some((option) => option.length > MAX_OPTION_LENGTH)) {
      errors.push({ code: "option_too_long" });
    }
    // TWO CORRECT ANSWERS IS THE CLASSIC GENERATED-QUESTION FAILURE, and
    // duplicate options are the version of it a structural check can catch: if
    // the same answer appears twice, one of the "wrong" choices is also right.
    if (new Set(options.map(foldForComparison)).size !== options.length) {
      errors.push({ code: "duplicate_options" });
    }
    if (
      candidate.correctIdx === null ||
      candidate.correctIdx === undefined ||
      !Number.isInteger(candidate.correctIdx) ||
      candidate.correctIdx < 0 ||
      candidate.correctIdx >= options.length
    ) {
      errors.push({
        code: "correct_index_out_of_range",
        detail: String(candidate.correctIdx),
      });
    }
  }

  if (candidate.type === "cloze") {
    if (!CLOZE_BLANK.test(prompt)) errors.push({ code: "cloze_no_blank" });
    if (acceptedAnswers.length === 0 || acceptedAnswers.every((a) => a.length === 0)) {
      errors.push({ code: "cloze_no_answer" });
    }
  }

  if (candidate.type === "sequence") {
    if (
      sequenceItems.length < MIN_SEQUENCE_ELEMENTS ||
      sequenceItems.length > MAX_SEQUENCE_ELEMENTS
    ) {
      errors.push({ code: "sequence_count", detail: String(sequenceItems.length) });
    }
    // Identical events have no unique ordering, so the question has no single
    // right answer even though it looks as if it does.
    if (new Set(sequenceItems.map(foldForComparison)).size !== sequenceItems.length) {
      errors.push({ code: "duplicate_sequence_items" });
    }
  }

  if (!isSkillCode(candidate.skillCode)) {
    errors.push({ code: "unknown_skill", detail: candidate.skillCode });
  } else if (
    QUESTION_KINDS.includes(candidate.kind) &&
    !KIND_SKILLS[candidate.kind].includes(candidate.skillCode)
  ) {
    errors.push({
      code: "skill_kind_mismatch",
      detail: `${candidate.kind}/${candidate.skillCode}`,
    });
  }

  const conceptCodes: ConceptCode[] = [];
  for (const code of candidate.conceptCodes ?? []) {
    if (isConceptCode(code)) conceptCodes.push(code);
    else errors.push({ code: "unknown_concept", detail: code });
  }

  // ── GROUNDING ─────────────────────────────────────────────────────────────
  const sourceSentenceIds = [...new Set(candidate.sourceSentenceIds ?? [])];
  const foreign = sourceSentenceIds.filter((id) => !grounding.sentenceIds.has(id));
  if (foreign.length > 0) {
    errors.push({ code: "foreign_grounding", detail: foreign.join(",") });
  }
  // A transfer question is asked in a NEW context on purpose, so it has no
  // chapter sentence to quote; it is grounded by the word it transfers instead.
  // Everything else must name where it came from.
  if (candidate.kind !== "transfer" && sourceSentenceIds.length === 0) {
    errors.push({ code: "missing_grounding" });
  }

  const wordId = candidate.wordId ?? null;
  if (wordId !== null && !grounding.wordIds.has(wordId)) {
    errors.push({ code: "foreign_word", detail: String(wordId) });
  }
  // A vocabulary question naming no word cannot write word knowledge, which
  // means it would silently be a comprehension question wearing the wrong label.
  if (candidate.kind === "contextual_vocabulary" && wordId === null) {
    errors.push({ code: "vocabulary_word_missing" });
  }
  if (
    candidate.kind === "transfer" &&
    wordId === null &&
    sourceSentenceIds.length === 0
  ) {
    errors.push({ code: "missing_grounding" });
  }

  if (errors.length > 0) return { ok: false, errors };

  const question: ValidatedQuestion = {
    kind: candidate.kind,
    type: candidate.type,
    scope: candidate.scope,
    prompt,
    options: options.length > 0 ? options : null,
    correctIdx: candidate.correctIdx ?? null,
    acceptedAnswers: acceptedAnswers.length > 0 ? acceptedAnswers : null,
    sequenceItems: sequenceItems.length > 0 ? sequenceItems : null,
    skillCode: candidate.skillCode as SkillCode,
    conceptCodes,
    wordId,
    difficulty: clampDifficulty(candidate.difficulty),
    sourceSentenceIds,
    explanationPl: candidate.explanationPl?.trim() || null,
    fingerprint: "",
  };

  return {
    ok: true,
    question: { ...question, fingerprint: questionFingerprint(question) },
  };
}

/**
 * Stable identity of a question's CONTENT.
 *
 * Two generation runs over the same chapter will propose the same question
 * worded slightly differently and, more often, worded identically. Without a
 * fingerprint the bank grows a hundred near-duplicates and the anti-memorisation
 * rule quietly stops working, because "an unseen question" becomes the same
 * question with a new id.
 *
 * Deliberately computed from the prompt and the answer only: difficulty,
 * explanation and concept tags can be corrected without the question becoming a
 * different question.
 */
export function questionFingerprint(
  question: Pick<
    ValidatedQuestion,
    | "kind"
    | "type"
    | "prompt"
    | "options"
    | "correctIdx"
    | "acceptedAnswers"
    | "sequenceItems"
  >,
): string {
  const answer =
    question.type === "cloze"
      ? (question.acceptedAnswers ?? []).map(foldForComparison).sort().join(FIELD_SEPARATOR)
      : question.type === "sequence"
        ? (question.sequenceItems ?? []).map(foldForComparison).join(FIELD_SEPARATOR)
        : foldForComparison((question.options ?? [])[question.correctIdx ?? 0] ?? "");

  return fnv1a(
    [
      question.kind,
      question.type,
      foldForComparison(question.prompt),
      answer,
    ].join(FIELD_SEPARATOR),
  );
}

/**
 * Is a stored question still answerable against the chapter as it stands now?
 *
 * Reprocessing a chapter replaces its sentence rows, so a question generated
 * before the change points at ids that no longer exist. Serving it anyway would
 * mean asking about a paragraph that may have been edited away — so a stale
 * question is EXCLUDED rather than silently reused, which is exactly what
 * `content_hash` exists to make checkable.
 */
export function isQuestionCurrent(input: {
  sourceContentHash: string | null;
  chapterContentHash: string | null;
}): boolean {
  if (!input.sourceContentHash || !input.chapterContentHash) return false;
  return input.sourceContentHash === input.chapterContentHash;
}

/**
 * Grade a typed answer.
 *
 * Case, surrounding whitespace and a leading German article are folded, because
 * a learner who types "schwert" for "das Schwert" knows the word, and marking
 * them wrong for a capital letter teaches nothing except that the app is
 * pedantic. Diacritics are NOT folded: *schon* and *schön* are different words,
 * and accepting either would be grading German by ignoring German.
 */
export function matchesTypedAnswer(
  submitted: string,
  accepted: readonly string[],
): boolean {
  const value = foldTypedAnswer(submitted);
  if (value.length === 0) return false;
  return accepted.some((answer) => foldTypedAnswer(answer) === value);
}

const LEADING_ARTICLE = /^(der|die|das|ein|eine|einen|einem|einer)\s+/;

export function foldTypedAnswer(value: string): string {
  return value
    .normalize("NFC")
    .trim()
    .toLocaleLowerCase("de-DE")
    .replace(/\s+/g, " ")
    .replace(LEADING_ARTICLE, "")
    .replace(/[.,!?;:]+$/, "");
}

/**
 * Did the learner put the events in the stored order?
 *
 * `sequence_items` is stored IN the correct order, so the answer key is the
 * identity permutation and there is no second column to keep in step with it.
 */
export function matchesSequence(
  submitted: readonly number[],
  itemCount: number,
): boolean {
  if (submitted.length !== itemCount) return false;
  return submitted.every((value, index) => value === index);
}

function isQuestionType(value: string): value is QuestionType {
  return (
    value === "multiple_choice" ||
    value === "true_false" ||
    value === "cloze" ||
    value === "sequence" ||
    value === "multi_select" ||
    value === "typed_answer"
  );
}

function normaliseList(values: readonly string[] | null | undefined): string[] {
  return (values ?? []).map((value) => (value ?? "").trim());
}

/** Fold for EQUALITY checks only — never for display, never for grading German. */
function foldForComparison(value: string): string {
  return value.normalize("NFC").trim().toLocaleLowerCase("de-DE").replace(/\s+/g, " ");
}

function clampDifficulty(value: number | null | undefined): number {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return DEFAULT_QUESTION_DIFFICULTY;
  }
  return Math.round(
    Math.min(MAX_QUESTION_DIFFICULTY, Math.max(MIN_QUESTION_DIFFICULTY, value)),
  );
}

/** FNV-1a, 32-bit, hex. Small, dependency-free, and stable across versions. */
function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}
