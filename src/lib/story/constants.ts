/**
 * Every number the Story Learning Engine uses, in one file.
 *
 * The same rule as `src/lib/learning/planner/constants.ts` and
 * `src/lib/reading/constants.ts`, for the same reason: a `* 0.35` buried in a
 * ranking function cannot be tuned and cannot be explained. When an admin asks
 * "why did this learner get exactly these five words?", the answer is a weighted
 * sum of named signals whose weights are all visible here.
 *
 * WHAT STORY V1 IS. A deterministic ranking, not a model. Nothing here has been
 * fitted to anything, and no part of it is AI: the AI boundary starts at
 * question *candidate* generation and stops at validation. Every plan this file
 * produces is stamped with {@link STORY_ENGINE_VERSION} so a later version can
 * tell which analyses, preparations and assessments it inherited.
 */

/** Stamped on every analysis, preparation and assessment this engine writes. */
export const STORY_ENGINE_VERSION = "story_v1";

// ─────────────────────────────────────────────────────────────────────────────
// KNOWLEDGE CONFIDENCE
// ─────────────────────────────────────────────────────────────────────────────
// "We have no evidence about this word" and "we measured this word and the
// learner does not know it" are different statements, and collapsing them is how
// a preparation list fills with words the learner has known for months. The
// bands below are the vocabulary of that distinction; see
// `knowledge-confidence.ts`.

/** At or above this receptive score, and confident enough, a word is known. */
export const WORD_KNOWN_SCORE = 0.75;
/** …and if the score is there but the confidence is not, it is only *likely*. */
export const WORD_LIKELY_KNOWN_SCORE = 0.6;
/** Below this score the word is treated as probably not known. */
export const WORD_LIKELY_UNKNOWN_SCORE = 0.45;

/** Confidence at which the model is prepared to call a word either way. */
export const WORD_VERDICT_CONFIDENCE = 0.4;
/** Below this there is evidence, but not enough to say anything but "uncertain". */
export const WORD_WEAK_CONFIDENCE = 0.15;

/**
 * Unknown probability assigned to a word Fluent has NEVER observed.
 *
 * Not 1.0. A learner meeting a chapter for the first time has met most German
 * words somewhere, and treating every unobserved word as certainly unknown would
 * make the preparation list a frequency list — which is what it must not be.
 * High enough that an unseen word outranks a measured-known one, low enough that
 * a word we have actually watched the learner fail outranks it.
 */
export const UNSEEN_WORD_UNKNOWN_PROBABILITY = 0.65;

// ─────────────────────────────────────────────────────────────────────────────
// COVERAGE CONFIDENCE
// ─────────────────────────────────────────────────────────────────────────────
// `estimateCoverage` already refuses to quote a figure it cannot support. What
// this adds is the honesty band ABOVE that floor: an estimate resting on 30
// observed words out of 400 is a real estimate and a shaky one, and the UI is
// told which it is holding rather than rendering both as "84%".

/** Observed share of the chapter's vocabulary for a `high`-confidence estimate. */
export const COVERAGE_HIGH_SHARE = 0.55;
/** …and the absolute number of observed words it also takes. */
export const COVERAGE_HIGH_OBSERVATIONS = 120;

/** Observed share for a `medium`-confidence estimate. */
export const COVERAGE_MEDIUM_SHARE = 0.35;
export const COVERAGE_MEDIUM_OBSERVATIONS = 60;

/**
 * Coverage is reported to the nearest whole percent and never finer.
 *
 * "Szacowana znajomość słownictwa: 91,374%" is an estimate pretending to be a
 * measurement. One percent is already more precision than the input supports;
 * the confidence band is what carries the rest of the truth.
 */
export const COVERAGE_DISPLAY_STEP = 1;

// ─────────────────────────────────────────────────────────────────────────────
// PERSONAL DIFFICULTY
// ─────────────────────────────────────────────────────────────────────────────
// PERSONAL DIFFICULTY IS NOT CEFR. A chapter is globally B1 because of the
// language in it; it is "bardzo wymagający" for THIS learner because of the gap
// between that language and what they have shown they know. The two numbers
// answer different questions and are stored in different places — `cefr_estimate`
// on the chapter, `difficulty_score` on the per-learner analysis.
//
// The score is 0 (trivial) → 1 (out of reach) and is a weighted sum of signals
// that are each independently defensible. Signals with no data are ABSENT, not
// guessed, and the weights of the present ones are renormalised — which is what
// stops a learner with no history from being told a chapter is hard because we
// know nothing about them.

export const DIFFICULTY_WEIGHTS = {
  /**
   * The share of this chapter's words the learner probably does not know. By far
   * the strongest signal: vocabulary is what actually stops a reader mid-page.
   */
  vocabularyGap: 1,

  /**
   * How far above the learner's CEFR band the chapter sits. Coarse — a library
   * item carries a band, not an Elo rating — but it is the only signal that sees
   * syntax at all.
   */
  levelGap: 0.5,

  /**
   * How much of the chapter's grammar the learner is currently weak at, when the
   * chapter's concepts are known. Present only once a chapter has grammar
   * questions tagged against it.
   */
  weaknessPressure: 0.35,

  /**
   * How the learner has actually fared in this book so far — their lookup rate
   * against the rate that is comfortable. Measured, so it outranks every guess
   * once it exists.
   */
  readingHistory: 0.45,
} as const;

export type DifficultySignalName = keyof typeof DIFFICULTY_WEIGHTS;

/** CEFR bands above the learner's own at which `levelGap` saturates. */
export const LEVEL_GAP_SATURATION_BANDS = 2;

/**
 * Elo distance one CEFR band is worth, matching `CEFR_DIFFICULTY`.
 *
 * The level gap is measured on the Elo scale rather than by band index so a
 * learner at the top of A2 is not counted a whole band below a B1 chapter they
 * are nearly ready for.
 */
export const CEFR_BAND_ELO_WIDTH = 200;

/**
 * Lookups per hundred meaningful words that read as comfortable reading.
 *
 * Roughly one word in thirty-three. Below it a learner is reading; far above it
 * they are decoding. Used both for `readingHistory` and for the
 * learner-facing lookup-rate trend.
 */
export const COMFORTABLE_LOOKUP_RATE = 0.03;
/** Lookup rate at which `readingHistory` saturates at 1. Roughly one in eight. */
export const STRUGGLING_LOOKUP_RATE = 0.12;

/** Chapters of history needed before `readingHistory` is quoted at all. */
export const MIN_HISTORY_CHAPTERS = 2;

/** Difficulty score thresholds for the four learner-facing labels. */
export const DIFFICULTY_COMFORTABLE_MAX = 0.25;
export const DIFFICULTY_JUST_RIGHT_MAX = 0.45;
export const DIFFICULTY_CHALLENGING_MAX = 0.65;

// ─────────────────────────────────────────────────────────────────────────────
// PREPARATION — how many words, and which
// ─────────────────────────────────────────────────────────────────────────────
// THE POINT IS NOT TO TEACH THE CHAPTER'S VOCABULARY. A chapter with 142 words
// the learner does not know does not get 142 cards; it gets the handful that
// would otherwise stop them, and the rest they meet in context, which is the
// whole reason to read a book instead of a deck.

export const MIN_PRETEACH_WORDS = 3;
export const MAX_PRETEACH_WORDS = 8;

/**
 * Chapter words per preteach target, before clamping.
 *
 * A 600-word chapter gets three; a 4 000-word one gets eight. Length is the only
 * input here that is about the chapter rather than the learner — difficulty and
 * budget adjust it afterwards.
 */
export const WORDS_PER_PRETEACH_TARGET = 600;

/** Seconds a learner spends on one preparation item, prompt to feedback. */
export const PRETEACH_SECONDS_PER_WORD = 22;

/** Never advertise preparation as taking less than this. */
export const MIN_PREPARATION_MINUTES = 1;

/**
 * Share of the learner's daily budget preparation may claim.
 *
 * Preparation is the doorway, not the room. A learner with ten minutes should
 * not spend six of them on flashcards before the story starts.
 */
export const PREPARATION_BUDGET_SHARE = 0.3;

/**
 * Extra targets allowed when a chapter is personally very hard, and removed when
 * it is easy. One step in each direction — this is a nudge, not a second
 * algorithm.
 */
export const PRETEACH_DIFFICULTY_ADJUSTMENT = 1;

/**
 * Distractors shown beside the right translation in a preparation item.
 *
 * Four options total. Fewer makes guessing cheap; more turns a two-minute warm-up
 * into a reading exercise about the options.
 */
export const PRETEACH_DISTRACTORS = 3;

export const PRETEACH_WEIGHTS = {
  /** Does the learner probably not know it? The precondition, weighted highest. */
  unknownProbability: 1,
  /** Does it come back? A word met once is a word met in context. */
  frequency: 0.55,
  /**
   * Is it load-bearing for the chapter — early, and spread through it rather
   * than clustered in one paragraph? See `lexicalImportance`.
   */
  importance: 0.4,
  /** Is it worth knowing outside this chapter at all? From the CEFR band. */
  generalUsefulness: 0.35,
  /** Does it sit on a concept the learner is currently failing? */
  weaknessRelevance: 0.25,
} as const;

export type PreteachSignalName = keyof typeof PRETEACH_WEIGHTS;

/** Occurrences at which the frequency signal saturates. */
export const PRETEACH_FREQUENCY_SATURATION = 6;

/**
 * Usefulness by CEFR band, for a word that has one.
 *
 * An A1 word the learner somehow does not know is worth far more than a B2 one:
 * they will meet it everywhere. A word with no band scores the middle rather
 * than zero — an unrated dictionary entry is missing metadata, not a useless word.
 */
export const CEFR_USEFULNESS: Readonly<Record<string, number>> = {
  A1: 1,
  A2: 0.85,
  B1: 0.6,
  B2: 0.4,
};
export const UNRATED_CEFR_USEFULNESS = 0.5;

/**
 * Evidence weight of a preparation answer, relative to a graded item.
 *
 * SEEING A WORD BEFORE A CHAPTER IS NOT KNOWING IT. A preparation item shows the
 * translation, then asks for it back seconds later; that is recognition under
 * the most generous possible conditions. Recording it at full multiple-choice
 * weight would let a learner "learn" forty words a week by clicking through
 * warm-ups, and the knowledge model would believe it.
 */
export const PREPARATION_EVIDENCE_DISCOUNT = 0.4;

// ─────────────────────────────────────────────────────────────────────────────
// CHAPTER CHALLENGE — the blueprint
// ─────────────────────────────────────────────────────────────────────────────
// Two learners who read the same chapter do not get the same test. What they DO
// both get is a test that still asks whether they understood the story, because
// the alternative — six Dativ questions after a chapter of a novel — is a grammar
// worksheet wearing a book's jacket.

export const MIN_CHALLENGE_QUESTIONS = 3;
export const DEFAULT_CHALLENGE_QUESTIONS = 6;
export const MAX_CHALLENGE_QUESTIONS = 8;

/** Seconds a learner spends on one challenge question, reading to feedback. */
export const CHALLENGE_SECONDS_PER_QUESTION = 40;

/**
 * The neutral mix, as shares of the question count.
 *
 * Personalisation moves these within the floors and ceilings below; it never
 * replaces them.
 */
export const BLUEPRINT_BASE_MIX = {
  comprehension: 0.4,
  contextual_vocabulary: 0.3,
  grammar: 0.15,
  transfer: 0.15,
} as const;

export type QuestionKind = keyof typeof BLUEPRINT_BASE_MIX;

export const QUESTION_KINDS = [
  "comprehension",
  "contextual_vocabulary",
  "grammar",
  "transfer",
] as const;

/**
 * THE FLOOR THAT PERSONALISATION MAY NOT CROSS.
 *
 * Whatever the learner's weaknesses, at least this share of a Chapter Challenge
 * asks about the story. A learner with terrible grammar who just read a chapter
 * is still owed the question "did you follow what happened?" — and a test that
 * stopped asking it would stop being able to tell reading comprehension from
 * grammar drilling, which is the one thing this assessment exists to measure.
 */
export const MIN_COMPREHENSION_SHARE = 0.3;
/** …and never more than this, or the Challenge stops testing language at all. */
export const MAX_COMPREHENSION_SHARE = 0.6;

/** Bounds on every other kind, as shares of the question count. */
export const KIND_SHARE_BOUNDS: Readonly<
  Record<QuestionKind, { min: number; max: number }>
> = {
  comprehension: { min: MIN_COMPREHENSION_SHARE, max: MAX_COMPREHENSION_SHARE },
  contextual_vocabulary: { min: 0.15, max: 0.5 },
  grammar: { min: 0, max: 0.35 },
  transfer: { min: 0, max: 0.3 },
};

/**
 * How far a weakness may tilt its kind's share, at full severity.
 *
 * A learner whose Dativ is failing badly gets roughly one extra grammar question
 * in a six-question Challenge — noticeably more grammar, not a grammar test.
 */
export const BLUEPRINT_WEAKNESS_TILT = 0.2;

// ─────────────────────────────────────────────────────────────────────────────
// CHAPTER CHALLENGE — selecting the questions
// ─────────────────────────────────────────────────────────────────────────────

export const SELECTION_WEIGHTS = {
  /** The learner has never answered this question. Anti-memorisation, weighted first. */
  unseen: 1,
  /** …and if they have, how long ago. A question from March is nearly new again. */
  staleness: 0.6,
  /** The question is about a word they looked up, saved, or were pre-taught. */
  chapterInteraction: 0.7,
  /** The question's concepts are ones the learner is currently failing. */
  weaknessRelevance: 0.55,
  /** The question sits near the learner's level rather than far from it. */
  difficultyFit: 0.35,
} as const;

export type SelectionSignalName = keyof typeof SELECTION_WEIGHTS;

/** Days after which a previously answered question counts as fully stale again. */
export const QUESTION_STALENESS_DAYS = 45;

/** Elo-ish distance from the learner's ability at which `difficultyFit` hits zero. */
export const QUESTION_DIFFICULTY_TOLERANCE = 300;
/** How far above the learner's ability a Challenge question should ideally sit. */
export const QUESTION_DIFFICULTY_SWEET_SPOT = 50;

/**
 * A question answered within this many days is only used again if the bank is
 * exhausted.
 *
 * Re-asking the same six questions in the same order after a re-read teaches the
 * position of the right button. When the bank genuinely has nothing else, the
 * least recently answered question is served rather than the Challenge failing —
 * a shorter test beats no test.
 */
export const QUESTION_COOLDOWN_DAYS = 7;

// ─────────────────────────────────────────────────────────────────────────────
// FOLLOW-UP
// ─────────────────────────────────────────────────────────────────────────────
// After the Challenge the chapter is not finished teaching. What it leaves
// behind is a small, ranked set of targets the planner can pick up days later —
// which is where retention is actually measured.

export const MAX_FOLLOW_UP_WORDS = 3;
export const MAX_FOLLOW_UP_CONCEPTS = 2;

export const FOLLOW_UP_WEIGHTS = {
  /** Got it wrong in the Challenge. The strongest possible signal: we just measured it. */
  assessmentFailure: 1,
  /** Looked up more than once while reading — repeated, not incidental. */
  repeatedLookup: 0.7,
  /** Pre-taught and then still looked up or still missed. Preparation did not stick. */
  preteachNotRetained: 0.85,
  /** The knowledge model puts it in the uncertain band. */
  uncertainKnowledge: 0.4,
} as const;

export type FollowUpSignalName = keyof typeof FOLLOW_UP_WEIGHTS;

/**
 * Lookups of the same word in one chapter before it stops being incidental.
 *
 * Tapping a word once is curiosity or a guess being confirmed. Tapping it twice
 * in the same chapter means it did not stick the first time, which is a learning
 * target rather than a behaviour.
 */
export const REPEATED_LOOKUP_THRESHOLD = 2;

/**
 * How long a finished chapter's Challenge stays worth putting in today's plan.
 *
 * Long enough to survive a weekend, short enough that a chapter read in March
 * does not haunt the plan in May. After it, the Challenge is still available from
 * the library — it just stops being something Fluent asks for.
 */
export const ASSESSMENT_PROMPT_DAYS = 7;

/**
 * Days after a chapter before its retention is worth re-checking.
 *
 * The single most valuable future signal is "did they still know it later", and
 * the interval is deliberately in the same range SM-2 would pick for a young
 * card. Nothing here schedules anything — SM-2 does the scheduling; this only
 * says when a follow-up target becomes interesting.
 */
export const RETENTION_CHECK_DAYS = 3;

// ─────────────────────────────────────────────────────────────────────────────
// GENERATION
// ─────────────────────────────────────────────────────────────────────────────

/** Stamped on every generated question. Bump when prompts or validation change. */
export const QUESTION_GENERATOR_VERSION = "storygen_v1";

/** Hard ceiling on the bank for one chapter, whatever the generator proposes. */
export const MAX_QUESTIONS_PER_CHAPTER = 40;

/** Sentences per generation chunk. Never split mid-sentence — see `chunking.ts`. */
export const GENERATION_CHUNK_SENTENCES = 60;
/** Overlap between chunks, so a question about a scene boundary is still possible. */
export const GENERATION_CHUNK_OVERLAP_SENTENCES = 4;

/** Attempts a failed generation job gets before it stays failed. */
export const MAX_GENERATION_ATTEMPTS = 3;

/** Options a generated multiple-choice question must have. */
export const MIN_MCQ_OPTIONS = 3;
export const MAX_MCQ_OPTIONS = 5;

/** Elements a generated sequence question must have. */
export const MIN_SEQUENCE_ELEMENTS = 3;
export const MAX_SEQUENCE_ELEMENTS = 6;

/** Longest a question prompt may be, in characters. */
export const MAX_PROMPT_LENGTH = 400;
/** Longest one option may be. */
export const MAX_OPTION_LENGTH = 200;

/**
 * Answers a question needs before its stored difficulty may be recalibrated.
 *
 * TWO ANSWERS ARE NOT A DIFFICULTY. Until a question has been answered by this
 * many learners, the generator's estimate stands. Nothing in Phase 5 performs the
 * recalibration; the counter exists so that it can be done later from real data
 * rather than from the first two people who happened to open the chapter.
 */
export const MIN_ANSWERS_FOR_CALIBRATION = 30;
