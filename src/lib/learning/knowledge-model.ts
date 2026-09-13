/**
 * Knowledge model V1 — pure functions turning evidence into a knowledge state.
 *
 * WHAT THIS IS NOT. The numbers below are an internal, heuristic mastery
 * estimate. They are **not** a CEFR level, not a percentage of the language
 * known, and not something to show a learner as an official assessment. Mapping
 * them onto CEFR is a separate, deliberate piece of work; until then the global
 * Elo rating in `src/lib/elo.ts` remains the only thing that claims a level.
 *
 * THE SHAPE OF THE MODEL. Each (learner, thing) pair keeps two decayed
 * accumulators — total evidence weight and the weight of the successful part —
 * and derives everything else from them:
 *
 *     score      = (PRIOR·PRIOR_WEIGHT + successWeight) / (PRIOR_WEIGHT + weight)
 *     confidence = 1 − e^(−weight / CONFIDENCE_SCALE)
 *
 * Three properties matter more than the exact constants:
 *
 *  - **One answer is not knowledge.** Blending against a neutral prior means a
 *    single correct multiple-choice answer lands near 0.69, not 1.0, and
 *    confidence near 0.14, not certainty. There is no input that makes one event
 *    look like proof.
 *  - **Estimate and trust are separate.** `score` says how well the learner
 *    probably does; `confidence` says how much evidence stands behind that. A
 *    consumer that ignores confidence will confidently report nonsense, so
 *    {@link verdictFor} refuses to name a level below
 *    {@link MIN_CONFIDENCE_FOR_VERDICT}.
 *  - **Old evidence counts for less.** Answering correctly six months ago is not
 *    the same claim as answering correctly yesterday. The accumulators decay
 *    with a half-life, which lowers *confidence* over time without inventing a
 *    drop in *ability* — we do not know that the learner forgot, only that we
 *    are less sure.
 *
 * WHY NOT SOMETHING CLEVERER. A proper IRT or Bayesian-knowledge-tracing model
 * needs data to fit, and Fluent has none yet. This version is deterministic,
 * unit-tested and cheap to replace; `KNOWLEDGE_MODEL_VERSION` is stamped on every
 * state row so `knowledge_v2` can tell which rows it inherited.
 */

/** Stamped on every state row this module writes. */
export const KNOWLEDGE_MODEL_VERSION = "knowledge_v1";

/**
 * The neutral starting belief: "we have no idea, call it a coin flip". Blending
 * against it is what stops the first answer from producing a 0 or a 1.
 */
export const PRIOR_SCORE = 0.5;

/**
 * How much evidence the prior is worth. At 1.0 it is roughly "one perfect
 * answer", so a couple of real answers already outweigh it — strong enough to
 * damp the first event, weak enough not to flatten a real signal.
 */
export const PRIOR_WEIGHT = 1;

/**
 * Evidence weight at which confidence reaches 1 − 1/e ≈ 0.63. Chosen so that a
 * handful of answers reads as "we have some idea" and a full review session as
 * "we are fairly sure", without any single answer getting close to certainty.
 */
export const CONFIDENCE_SCALE = 4;

/**
 * Half-life of accumulated evidence. After this long, past evidence carries half
 * the weight it did — the estimate survives, the certainty fades.
 */
export const EVIDENCE_HALF_LIFE_DAYS = 120;

/**
 * Ceiling on confidence while every piece of evidence comes from a single kind
 * of exercise. A learner who has only ever clicked flashcards has shown us one
 * thing many times, not many things — that is worth a lot, but never certainty.
 */
export const SINGLE_SOURCE_CONFIDENCE_CAP = 0.85;

/**
 * Below this confidence the model refuses to name a level at all.
 *
 * Set so that NO single answer of any kind clears it — not even a typed one,
 * which is the strongest observation Fluent can make. In practice it takes about
 * three multiple-choice answers or two produced ones before the model will say
 * anything beyond "za mało danych".
 */
export const MIN_CONFIDENCE_FOR_VERDICT = 0.3;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * An aggregated estimate for one (learner, skill | concept | word channel).
 *
 * `score` is null only for {@link EMPTY_KNOWLEDGE_STATE} — a state with no
 * evidence behind it. That is the honest representation of "we have never
 * measured this", and it is deliberately not the number 0.
 */
export interface KnowledgeState {
  score: number | null;
  confidence: number;
  /** Decayed sum of evidence weights. Drives confidence. */
  evidenceWeight: number;
  /** Decayed sum of the weights of correct answers. Drives score. */
  successWeight: number;
  /** Lifetime counts — never decayed, so the UI can say "12 odpowiedzi". */
  evidenceCount: number;
  successCount: number;
  failureCount: number;
  /** Distinct exercise kinds seen, e.g. ["reading_test", "review"]. */
  sourceKinds: readonly string[];
  firstEvidenceAt: string | null;
  lastEvidenceAt: string | null;
}

export const EMPTY_KNOWLEDGE_STATE: KnowledgeState = {
  score: null,
  confidence: 0,
  evidenceWeight: 0,
  successWeight: 0,
  evidenceCount: 0,
  successCount: 0,
  failureCount: 0,
  sourceKinds: [],
  firstEvidenceAt: null,
  lastEvidenceAt: null,
};

/** One observation, already reduced to what the model needs. */
export interface KnowledgeEvidence {
  isCorrect: boolean;
  /**
   * How much this observation is worth, 0–1. Recognising the right option out of
   * four is not the same evidence as producing the word from memory; the weights
   * live in `evidence.ts`, which is the single place that decides them.
   */
  weight: number;
  /** Which kind of exercise produced it (see {@link SINGLE_SOURCE_CONFIDENCE_CAP}). */
  sourceKind: string;
  occurredAt: string;
}

/**
 * Fold one observation into a state.
 *
 * Deterministic and side-effect free: same inputs, same output, no clock and no
 * database. That is what lets the whole knowledge model be tested without a
 * Supabase project, and what lets a future version be validated by replaying
 * stored events through it.
 */
export function applyEvidence(
  previous: KnowledgeState,
  evidence: KnowledgeEvidence,
): KnowledgeState {
  const weight = clamp01(Number.isFinite(evidence.weight) ? evidence.weight : 0);
  const occurredAt = evidence.occurredAt;

  // Age the accumulators up to the moment of this observation, so that evidence
  // gathered years apart is not treated as one dense block of certainty.
  const decay = decayFactor(previous.lastEvidenceAt, occurredAt);
  const evidenceWeight = previous.evidenceWeight * decay + weight;
  const successWeight =
    previous.successWeight * decay + (evidence.isCorrect ? weight : 0);

  const sourceKinds = previous.sourceKinds.includes(evidence.sourceKind)
    ? previous.sourceKinds
    : [...previous.sourceKinds, evidence.sourceKind];

  return {
    score: round(
      (PRIOR_SCORE * PRIOR_WEIGHT + successWeight) / (PRIOR_WEIGHT + evidenceWeight),
    ),
    confidence: confidenceFrom(evidenceWeight, sourceKinds.length),
    evidenceWeight: round(evidenceWeight),
    successWeight: round(successWeight),
    evidenceCount: previous.evidenceCount + 1,
    successCount: previous.successCount + (evidence.isCorrect ? 1 : 0),
    failureCount: previous.failureCount + (evidence.isCorrect ? 0 : 1),
    sourceKinds,
    firstEvidenceAt: previous.firstEvidenceAt ?? occurredAt,
    lastEvidenceAt: laterOf(previous.lastEvidenceAt, occurredAt),
  };
}

/**
 * Confidence as of `now` rather than as of the last observation.
 *
 * Stored confidence is a snapshot taken when the evidence arrived. Read months
 * later it overstates how much we know, so anything displaying a state should
 * ask for the current value. This is the read-side half of the recency rule; the
 * write side is the decay inside {@link applyEvidence}.
 */
export function confidenceAt(state: KnowledgeState, now: Date = new Date()): number {
  if (state.evidenceCount === 0) return 0;
  const decayed = state.evidenceWeight * decayFactor(state.lastEvidenceAt, now.toISOString());
  return confidenceFrom(decayed, state.sourceKinds.length);
}

/**
 * What Fluent is prepared to SAY about a state.
 *
 * `unknown` means nothing was ever measured; `insufficient` means something was,
 * but not enough of it to call. Both exist so the UI never has to turn thin
 * evidence into a level to have something to render.
 */
export type KnowledgeVerdict =
  | "unknown"
  | "insufficient"
  | "weak"
  | "developing"
  | "solid"
  | "strong";

/** Polish copy for each verdict, so components do not each invent their own. */
export const VERDICT_LABEL_PL: Readonly<Record<KnowledgeVerdict, string>> = {
  unknown: "Brak danych",
  insufficient: "Za mało danych",
  weak: "Słabo",
  developing: "W trakcie",
  solid: "Dobrze",
  strong: "Bardzo dobrze",
};

/**
 * Classify a state into something sayable.
 *
 * The confidence gate comes first and is not negotiable: a high score built on
 * one lucky answer is reported as `insufficient`, because "speaking: B1, based
 * on nothing" is exactly the lie this model exists to prevent.
 */
export function verdictFor(
  state: KnowledgeState | null | undefined,
  now: Date = new Date(),
): KnowledgeVerdict {
  if (!state || state.evidenceCount === 0 || state.score === null) return "unknown";
  if (confidenceAt(state, now) < MIN_CONFIDENCE_FOR_VERDICT) return "insufficient";
  if (state.score < 0.45) return "weak";
  if (state.score < 0.65) return "developing";
  if (state.score < 0.82) return "solid";
  return "strong";
}

/** Minimum observations before a concept may be called a weakness at all. */
export const MIN_WEAKNESS_EVIDENCE = 3;
/** …of which at least this many must have been failures. */
export const MIN_WEAKNESS_FAILURES = 2;

/**
 * How urgently a concept deserves practice, 0–1; 0 means "not a weakness".
 *
 * ONE MISTAKE IS NOT A WEAKNESS. Someone who muddles Dativ once has not got a
 * Dativ problem — they had a bad moment, or misread the question. A weakness is
 * a pattern, so the thresholds above are checked before anything is ranked, and
 * the priority is then scaled by confidence: a repeated, well-evidenced failure
 * outranks a shakier one even at the same score.
 */
export function weaknessPriority(
  state: KnowledgeState,
  now: Date = new Date(),
): number {
  if (state.score === null) return 0;
  if (state.evidenceCount < MIN_WEAKNESS_EVIDENCE) return 0;
  if (state.failureCount < MIN_WEAKNESS_FAILURES) return 0;

  const confidence = confidenceAt(state, now);
  if (confidence < MIN_CONFIDENCE_FOR_VERDICT) return 0;

  return round((1 - state.score) * confidence);
}

/**
 * Multiplier applied to evidence accumulated at `from` when viewed at `to`.
 * Clamped at 1 so an out-of-order event (a retried request, a clock skew) can
 * never *amplify* history.
 */
function decayFactor(from: string | null, to: string): number {
  if (!from) return 1;
  const elapsedMs = Date.parse(to) - Date.parse(from);
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return 1;
  return Math.pow(0.5, elapsedMs / MS_PER_DAY / EVIDENCE_HALF_LIFE_DAYS);
}

function confidenceFrom(evidenceWeight: number, sourceCount: number): number {
  const base = 1 - Math.exp(-Math.max(0, evidenceWeight) / CONFIDENCE_SCALE);
  const cap = sourceCount >= 2 ? 1 : SINGLE_SOURCE_CONFIDENCE_CAP;
  return round(Math.min(base, cap));
}

function laterOf(a: string | null, b: string): string {
  if (!a) return b;
  return Date.parse(b) >= Date.parse(a) ? b : a;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** Four decimals: enough resolution for a 0–1 estimate, stable across reloads. */
function round(value: number): number {
  return Math.round(value * 10000) / 10000;
}
