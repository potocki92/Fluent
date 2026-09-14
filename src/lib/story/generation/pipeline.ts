/**
 * The generation pipeline: candidates in, an admissible bank out.
 *
 *     chapter structured content
 *        ↓  chunk                     never mid-sentence
 *     candidate generation            the ONLY step a model touches
 *        ↓  schema validation         shape, options, answer key
 *        ↓  grounding validation      the cited sentences exist, here
 *        ↓  quality checks            duplicates, balance, ceilings
 *     question bank
 *
 * WHAT THIS MODULE IS FOR. Everything after "candidate generation" is a refusal
 * mechanism, and refusing well is the whole value of the pipeline. A generated
 * question that is ambiguous or has two right answers does not waste thirty
 * seconds of a learner's time — it writes false evidence into the knowledge
 * model, and Fluent then plans their week around a weakness that never existed.
 * So a candidate is guilty until validated, and every rejection keeps its reason
 * so that a bad prompt shows up as a pattern in the admin panel instead of as a
 * complaint.
 *
 * IT RUNS WITHOUT A MODEL. `runPipeline` takes candidates from wherever — an AI
 * provider, an admin form, a template — which is what lets the validation, the
 * de-duplication and the ceilings be unit-tested with no network and no key, and
 * what lets an admin author a bank by hand on a deployment that has no provider
 * configured at all.
 *
 * Pure.
 */

import {
  MAX_QUESTIONS_PER_CHAPTER,
  QUESTION_KINDS,
  type QuestionKind,
} from "@/lib/story/constants";
import {
  validateQuestion,
  type GroundingContext,
  type QuestionCandidate,
  type ValidatedQuestion,
  type ValidationError,
} from "@/lib/story/questions";

/** A candidate that did not make it, and why. */
export interface RejectedCandidate {
  /** Trimmed prompt, so an admin can recognise it. Chapter text is never logged. */
  prompt: string;
  kind: string;
  errors: ValidationError[];
}

export interface PipelineResult {
  accepted: ValidatedQuestion[];
  rejected: RejectedCandidate[];
  /** Accepted, then dropped as a duplicate of something already accepted. */
  duplicates: number;
  /** Accepted, then dropped because the chapter's ceiling was reached. */
  overflow: number;
}

export interface PipelineInput {
  candidates: readonly QuestionCandidate[];
  grounding: GroundingContext;
  /**
   * Fingerprints already in the bank for this chapter.
   *
   * IDEMPOTENCY. Re-running generation for an unchanged chapter must not produce
   * a second copy of every question — that would quietly break the
   * anti-memorisation rule, since "an unseen question" would become the same
   * question with a new id.
   */
  existingFingerprints?: ReadonlySet<string>;
  /** Ceiling for the whole chapter, existing questions included. */
  maxQuestions?: number;
  /** How many the chapter already holds, counted against the ceiling. */
  existingCount?: number;
}

/** Validate, de-duplicate and cap a batch of candidates. */
export function runPipeline(input: PipelineInput): PipelineResult {
  const seen = new Set(input.existingFingerprints ?? []);
  const ceiling = input.maxQuestions ?? MAX_QUESTIONS_PER_CHAPTER;
  const budget = Math.max(0, ceiling - (input.existingCount ?? 0));

  const accepted: ValidatedQuestion[] = [];
  const rejected: RejectedCandidate[] = [];
  let duplicates = 0;
  let overflow = 0;

  for (const candidate of input.candidates) {
    const result = validateQuestion(candidate, input.grounding);

    if (!result.ok) {
      rejected.push({
        prompt: (candidate.prompt ?? "").trim().slice(0, 120),
        kind: String(candidate.kind),
        errors: result.errors,
      });
      continue;
    }

    if (seen.has(result.question.fingerprint)) {
      duplicates += 1;
      continue;
    }

    if (accepted.length >= budget) {
      overflow += 1;
      continue;
    }

    seen.add(result.question.fingerprint);
    accepted.push(result.question);
  }

  return { accepted, rejected, duplicates, overflow };
}

/**
 * Is what came out of the pipeline enough to build a Challenge from?
 *
 * A bank that is ten grammar questions and nothing else cannot produce a
 * Challenge that asks about the story, which the blueprint's comprehension floor
 * would then have to break. Better to mark the generation as needing review than
 * to publish a bank that can only ever produce a grammar test.
 */
export function bankCoverage(
  questions: readonly ValidatedQuestion[],
): Record<QuestionKind, number> {
  const counts = {} as Record<QuestionKind, number>;
  for (const kind of QUESTION_KINDS) counts[kind] = 0;
  for (const question of questions) counts[question.kind] += 1;
  return counts;
}

/** The smallest bank worth publishing: enough comprehension to satisfy the floor. */
export const MIN_BANK_COMPREHENSION = 2;
export const MIN_BANK_TOTAL = 4;

export function isBankPublishable(
  questions: readonly ValidatedQuestion[],
): boolean {
  const coverage = bankCoverage(questions);
  return (
    questions.length >= MIN_BANK_TOTAL &&
    coverage.comprehension >= MIN_BANK_COMPREHENSION
  );
}

/**
 * Merge the candidates from every chunk of one chapter.
 *
 * De-duplication has to happen ACROSS chunks, not within them: overlapping
 * chunks see the same sentences on purpose, so the same detail question is
 * proposed twice by construction. The fingerprint is what catches it, and
 * running the pipeline once over the concatenation is what lets it.
 */
export function mergeCandidates(
  batches: readonly (readonly QuestionCandidate[])[],
): QuestionCandidate[] {
  return batches.flat();
}
