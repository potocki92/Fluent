/**
 * Every number the Today planner uses, in one file.
 *
 * WHY THEY ARE ALL HERE. A planner whose weights are sprinkled through the code
 * as `* 0.35` and `+ 1.28` cannot be tuned: nobody can see what the algorithm
 * currently believes, and changing one number means hunting for the other four
 * that were supposed to move with it. Every constant below is named, explained
 * and imported — there are no bare coefficients anywhere else in
 * `src/lib/learning/planner/`.
 *
 * WHAT THIS VERSION IS. Planner V1 is a deterministic weighted sum. It is not a
 * model, it has not been fitted to anything, and it makes no claim to be
 * optimal. It is readable, unit-testable and cheap to replace, and every plan it
 * produces is stamped with {@link PLANNER_VERSION} so a later version can tell
 * which plans it inherited.
 */

/** Stamped on every plan this planner writes. See `daily_plans.algorithm_version`. */
export const PLANNER_VERSION = "planner_v1";

// ─────────────────────────────────────────────────────────────────────────────
// THE DAILY BUDGET
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Default daily learning time, in minutes.
 *
 * `daily_word_goal` still exists and still drives the review screen — it answers
 * "how many cards do I want to do?". It is the wrong unit for a plan, because a
 * plan mixes reviews, drills and reading and the only thing those share is time.
 */
export const DEFAULT_DAILY_MINUTES = 12;

/** Presets offered in settings. */
export const DAILY_MINUTE_PRESETS = [5, 10, 15, 20, 30] as const;

export const MIN_DAILY_MINUTES = 5;
export const MAX_DAILY_MINUTES = 60;

/**
 * How far over the target a plan may go before an activity is refused.
 *
 * Activities come in indivisible chunks — you cannot read 0.4 of a passage — so
 * some overshoot is unavoidable. 20% keeps a "10 minut" plan somewhere between
 * 8 and 12 minutes, rather than the 28-minute plan a greedy fill would produce.
 */
export const BUDGET_TOLERANCE = 0.2;

// ─────────────────────────────────────────────────────────────────────────────
// TIME ESTIMATES PER ACTIVITY
// ─────────────────────────────────────────────────────────────────────────────
// These are deliberately coarse. Predicting to the second is impossible and
// pretending otherwise would show the learner a number that is always wrong; the
// point is that "około 12 min" is roughly true and that the budget arithmetic
// has something consistent to work with.

/** Flashcards a learner gets through in a minute, at a steady pace. */
export const REVIEW_CARDS_PER_MINUTE = 2.5;

/** Never propose a review batch smaller than this — it is not worth opening. */
export const MIN_REVIEW_BATCH = 4;

/**
 * Hard ceiling on one day's review batch.
 *
 * A learner returning to 300 overdue cards must not be shown a 300-card task.
 * The scheduler keeps the rest; today gets the most urgent slice. Telling
 * someone they are 300 behind is how they stop opening the app.
 */
export const MAX_REVIEW_BATCH = 12;

/** Share of the daily budget reviews may claim before other work is crowded out. */
export const REVIEW_BUDGET_SHARE = 0.45;

export const MIN_PRACTICE_QUESTIONS = 3;
export const MAX_PRACTICE_QUESTIONS = 5;
/** Reading a stem, weighing four options and seeing the feedback. */
export const PRACTICE_SECONDS_PER_QUESTION = 45;

/** Reading speed assumed for a learner working through a graded passage. */
export const READING_WORDS_PER_MINUTE = 55;
export const MIN_READING_MINUTES = 3;
export const MAX_READING_MINUTES = 8;
/** Fallback when a passage has no `word_count`. */
export const DEFAULT_READING_MINUTES = 5;

export const MIN_NEW_WORDS = 2;
export const MAX_NEW_WORDS = 6;
export const SECONDS_PER_NEW_WORD = 25;

/** The placement test, as offered to a learner who has no level yet. */
export const PLACEMENT_MINUTES = 5;

// ── READING A CHAPTER ────────────────────────────────────────────────────────
// A chapter of a book is not a graded passage and is not budgeted like one. A
// passage is read to answer questions about it and is finished in one sitting; a
// chapter can be 15 000 words, and "read the whole thing" is not a task that
// fits in a twelve-minute plan. So a reading activity is a SEGMENT — a slice of
// time — and the chapter is finished whenever the learner finishes it.

/** Longest reading slice one plan may ask for. */
export const MAX_CHAPTER_SEGMENT_MINUTES = 15;
/** Shortest slice worth opening a book for. */
export const MIN_CHAPTER_SEGMENT_MINUTES = 4;
/** Share of the daily budget a single reading activity may claim. */
export const CHAPTER_BUDGET_SHARE = 0.6;

/**
 * How well a chapter's level matches the learner's, by CEFR band.
 *
 * Coarser than the Elo `difficultyMatch` used for graded passages, and honestly
 * so: a library item carries a CEFR estimate, not an Elo rating, because nobody
 * has calibrated a novel against an item bank. Three values rather than a curve,
 * because three is all the precision the input supports.
 */
// ── THE STORY ENGINE'S TWO ACTIVITIES ────────────────────────────────────────
// Preparation is the doorway to a chapter and the Challenge is its coda. Neither
// is a session in its own right, and both are budgeted as the small things they
// are — a plan that spent half its day on "przygotowanie" would have inverted
// the point of reading a book.

/**
 * Urgency of a Challenge the learner has not taken yet.
 *
 * High for a few days and then gone. A chapter finished this morning is fresh
 * enough that checking what stuck measures retention rather than archaeology; a
 * chapter finished in March is not, and a plan that kept asking about it for a
 * month would be nagging rather than teaching.
 */
export const ASSESSMENT_URGENCY_FRESH = 1;
export const ASSESSMENT_URGENCY_FADED = 0.35;

/** Hours after finishing a chapter that its Challenge still counts as fresh. */
export const ASSESSMENT_FRESH_HOURS = 36;

export const CHAPTER_LEVEL_MATCH = 1;
export const CHAPTER_LEVEL_NEAR = 0.6;
export const CHAPTER_LEVEL_FAR = 0.15;

// ─────────────────────────────────────────────────────────────────────────────
// PRIORITY WEIGHTS
// ─────────────────────────────────────────────────────────────────────────────
// Each signal is normalised to 0–1 by its generator; the final priority is the
// weighted sum. Reading the weights top to bottom is meant to read as a sentence
// about what Fluent believes matters:
//
//   getting to a level at all  ≫  memory that is slipping  >  a proven weakness
//   >  finishing what you started  >  the right next text  >  new words.

export const SIGNAL_WEIGHTS = {
  /**
   * The learner has no level yet. Outranks everything on purpose: a
   * "personalised" plan built with no data is a lie, and every other signal is
   * measured against an ability we do not have.
   */
  onboarding: 3,

  /**
   * How late the review queue is. The single strongest ordinary signal, because
   * a card reviewed on time is worth several reviewed late — this is the one
   * activity where delay actively destroys value.
   */
  dueUrgency: 1,

  /**
   * How badly, and how credibly, a concept is failing. Weighted just below
   * reviews: a weakness is real work, but a forgotten deck compounds faster.
   */
  weaknessSeverity: 0.85,

  /**
   * Whether those failures are RECENT. A Dativ problem from March that the
   * learner has since fixed should fade out of today's plan on its own, without
   * anyone marking it resolved.
   */
  weaknessRecency: 0.35,

  /**
   * Something already begun. Finishing beats starting — a half-read passage is
   * cheaper to finish than a new one is to start, and leaving things unfinished
   * is its own drag on motivation.
   */
  continuation: 0.6,

  /**
   * How well a passage matches the learner's ability. Slightly stretching, never
   * out of reach; see {@link DIFFICULTY_SWEET_SPOT}.
   */
  difficultyMatch: 0.45,

  /** How useful and how genuinely new a batch of vocabulary is. */
  vocabularyFit: 0.4,
} as const;

export type SignalName = keyof typeof SIGNAL_WEIGHTS;

/**
 * Small per-type nudge, applied on top of the signals.
 *
 * It only decides ties between candidates whose signals came out equal, so that
 * a plan with nothing to distinguish its options is still stable from one day to
 * the next instead of reshuffling at random.
 */
export const TYPE_TIEBREAK = {
  placement: 0.05,
  review_due: 0.04,
  weakness_practice: 0.03,
  continue_text: 0.02,
  continue_chapter: 0.02,
  // Just above a new chapter: finishing what a learner started with a book —
  // including the check at the end of it — beats opening the next one.
  chapter_assessment: 0.025,
  chapter_preparation: 0.015,
  new_text: 0.01,
  new_chapter: 0.01,
  new_vocabulary: 0,
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// SIGNAL SHAPES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Days overdue at which review urgency saturates.
 *
 * Past a week late the queue is simply "behind"; being 40 days late rather than
 * 30 does not make today's session more urgent, and letting it keep growing
 * would let one ancient card outrank a genuine weakness forever.
 */
export const DUE_URGENCY_SATURATION_DAYS = 7;

/**
 * Cards due at which the "there is a queue" part of urgency saturates,
 * independently of how late they are.
 */
export const DUE_COUNT_SATURATION = 20;

/**
 * Urgency floor for reviews that exist but are not yet late (study ahead).
 *
 * Non-zero so a learner with an empty overdue queue still gets vocabulary work,
 * low so that overdue cards always win when both exist.
 */
export const STUDY_AHEAD_URGENCY = 0.2;

/**
 * How far above the learner's ability a passage should ideally sit.
 *
 * Comfortably readable is not learning and far too hard is not either. Around
 * half a CEFR band above current ability is the band where a graded text is
 * still finishable but not free.
 */
export const DIFFICULTY_SWEET_SPOT = 75;

/** Elo distance from the sweet spot at which a passage scores nothing. */
export const DIFFICULTY_TOLERANCE = 250;

/** Half-life of a weakness's recency, in days. */
export const WEAKNESS_RECENCY_HALF_LIFE_DAYS = 30;

/**
 * Floor under the recency multiplier.
 *
 * An old weakness stops dominating the plan; it does not stop existing. A
 * concept the learner never revisited is still a concept they failed.
 */
export const MIN_WEAKNESS_RECENCY = 0.2;

/** Severity thresholds over the recency-adjusted weakness score. */
export const WEAKNESS_SEVERITY_HIGH = 0.4;
export const WEAKNESS_SEVERITY_MEDIUM = 0.2;

/** A word channel at or above this score counts as already known. */
export const KNOWN_WORD_SCORE = 0.75;
/** …and only if we are at least this sure of it. */
export const KNOWN_WORD_CONFIDENCE = 0.4;

// ─────────────────────────────────────────────────────────────────────────────
// PLAN SHAPE
// ─────────────────────────────────────────────────────────────────────────────

/** Most activities one plan may hold, whatever the budget. */
export const MAX_PLAN_ITEMS = 5;

/**
 * Most activities of one kind in a plan.
 *
 * Four review batches in a row is not a plan, it is a queue with extra steps.
 * Two drills are allowed because two different weaknesses are genuinely
 * different work.
 */
export const MAX_ITEMS_PER_TYPE: Readonly<Record<string, number>> = {
  placement: 1,
  review_due: 1,
  weakness_practice: 2,
  continue_text: 1,
  continue_chapter: 1,
  new_text: 1,
  new_chapter: 1,
  chapter_preparation: 1,
  chapter_assessment: 1,
  new_vocabulary: 1,
};

/** Most activities drawn from one category, so a plan keeps some variety. */
export const MAX_ITEMS_PER_CATEGORY = 2;

/**
 * The order activities are presented in, which is NOT priority order.
 *
 * A session reads better as warm-up → hard work → reading → new material than as
 * a descending list of scores, and priority has already done its job by the time
 * the plan is written: it decided what is in it.
 */
export const FLOW_ORDER: readonly string[] = [
  "placement",
  "review_due",
  "weakness_practice",
  // The Challenge comes BEFORE the next chapter: it closes the book the learner
  // was already in, and a plan that opened a new chapter first would leave them
  // answering questions about a story they had since moved on from.
  "chapter_assessment",
  "chapter_preparation",
  "continue_chapter",
  "continue_text",
  "new_chapter",
  "new_text",
  "new_vocabulary",
];

// ─────────────────────────────────────────────────────────────────────────────
// PERSONALISATION MATURITY
// ─────────────────────────────────────────────────────────────────────────────
// How much the planner actually had to work with. Stored on the plan so the
// product can be honest about the difference between a real recommendation and a
// reasonable guess — and so two plans built from wildly different amounts of
// evidence are not compared as if they were the same artefact.

export const EVIDENCE_LEVEL_THRESHOLDS = {
  low: 1,
  medium: 25,
  high: 120,
} as const;
