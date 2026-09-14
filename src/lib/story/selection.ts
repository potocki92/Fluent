/**
 * Choosing which questions THIS learner answers about THIS chapter.
 *
 * The bank is shared; the Challenge is not. A chapter's questions are generated
 * once, validated once and reused by everyone who reads it — personalisation is
 * SELECTION, not generation. That is the decision this module implements, and it
 * is what makes a question bank reviewable at all: forty questions an admin can
 * inspect, rather than six per learner that nobody will ever see again.
 *
 * ANTI-MEMORISATION IS THE FIRST SIGNAL, not a tie-break. A learner who re-reads
 * a chapter and gets the same six questions in the same order learns where the
 * right button is. So an unseen question always outranks a seen one, a seen one
 * recovers value as it ages, and a question answered in the last week is held
 * back entirely — unless the bank has nothing else, in which case the least
 * recently answered is served rather than the Challenge failing. A shorter
 * Challenge beats no Challenge; a repeat beats a blank screen.
 *
 * Pure: it takes rows and returns an ordering.
 */

import {
  QUESTION_COOLDOWN_DAYS,
  QUESTION_DIFFICULTY_SWEET_SPOT,
  QUESTION_DIFFICULTY_TOLERANCE,
  QUESTION_KINDS,
  QUESTION_STALENESS_DAYS,
  SELECTION_WEIGHTS,
  type QuestionKind,
  type SelectionSignalName,
} from "@/lib/story/constants";
import type { Blueprint } from "@/lib/story/blueprint";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** One question of the bank, as far as selection is concerned. */
export interface SelectableQuestion {
  id: number;
  kind: QuestionKind;
  difficulty: number;
  conceptCodes: readonly string[];
  /** The dictionary word it tests, when it tests one. */
  wordId: number | null;
  /** When this learner last answered it, or null if never. */
  lastAnsweredAt: string | null;
}

export type SelectionSignals = Partial<Record<SelectionSignalName, number>>;

export interface ScoredQuestion extends SelectableQuestion {
  score: number;
  signals: SelectionSignals;
}

export interface SelectionInput {
  questions: readonly SelectableQuestion[];
  blueprint: Blueprint;
  /** The learner's Elo ability, or null when they have never been placed. */
  ability: number | null;
  /** Concept codes the learner is currently failing, with 0–1 severity. */
  weakConcepts?: ReadonlyMap<string, number>;
  /**
   * Words this learner actually met in this chapter — looked up, saved, or
   * pre-taught. A question about one of those is a question about their reading,
   * not about a word drawn at random from a chapter they handled fine.
   */
  interactedWordIds?: ReadonlySet<number>;
  now?: Date;
}

export interface SelectionResult {
  /** The chosen questions, in the order they will be asked. */
  questions: ScoredQuestion[];
  /** What was actually filled per kind — may be short of the blueprint. */
  filled: Record<QuestionKind, number>;
  /** True when the cooldown had to be relaxed to fill the Challenge. */
  reusedRecent: boolean;
}

/** Score every question, then take the best of each kind the blueprint asks for. */
export function selectChallengeQuestions(input: SelectionInput): SelectionResult {
  const now = input.now ?? new Date();
  const scored = input.questions.map((question) => scoreQuestion(question, input, now));

  const byKind = new Map<QuestionKind, ScoredQuestion[]>();
  for (const kind of QUESTION_KINDS) byKind.set(kind, []);
  for (const question of scored) byKind.get(question.kind)?.push(question);

  for (const list of byKind.values()) {
    // Ties broken by id so that two runs over an unchanged bank agree.
    list.sort((a, b) => b.score - a.score || a.id - b.id);
  }

  const filled = {} as Record<QuestionKind, number>;
  const chosen: ScoredQuestion[] = [];
  let reusedRecent = false;

  for (const kind of QUESTION_KINDS) {
    const wanted = input.blueprint[kind] ?? 0;
    const pool = byKind.get(kind) ?? [];

    // Fresh first: everything outside the cooldown window, best score first.
    const fresh = pool.filter((question) => !inCooldown(question, now));
    const take = fresh.slice(0, wanted);

    // Only if the bank cannot fill the kind does a recently answered question
    // come back — and then the LEAST recently answered, never the best-scoring,
    // because "how long since they saw it" is the whole point of the fallback.
    if (take.length < wanted) {
      const recent = pool
        .filter((question) => inCooldown(question, now))
        .sort(
          (a, b) =>
            answeredAt(a.lastAnsweredAt) - answeredAt(b.lastAnsweredAt) || a.id - b.id,
        );
      const extra = recent.slice(0, wanted - take.length);
      if (extra.length > 0) reusedRecent = true;
      take.push(...extra);
    }

    filled[kind] = take.length;
    chosen.push(...take);
  }

  return { questions: orderForFlow(chosen), filled, reusedRecent };
}

/**
 * The order the Challenge asks its questions in — NOT score order.
 *
 * Story first. A learner who has just closed a chapter is still in it, and
 * opening with "what happened?" reads as a continuation of the reading; opening
 * with a cloze on adjective endings reads as a test that happens to follow one.
 * Transfer questions go last because they are the ones that leave the chapter.
 */
function orderForFlow(questions: readonly ScoredQuestion[]): ScoredQuestion[] {
  const order: readonly QuestionKind[] = [
    "comprehension",
    "contextual_vocabulary",
    "grammar",
    "transfer",
  ];
  return [...questions].sort(
    (a, b) =>
      order.indexOf(a.kind) - order.indexOf(b.kind) || b.score - a.score || a.id - b.id,
  );
}

function scoreQuestion(
  question: SelectableQuestion,
  input: SelectionInput,
  now: Date,
): ScoredQuestion {
  const signals: SelectionSignals = {
    unseen: question.lastAnsweredAt === null ? 1 : 0,
    staleness: stalenessSignal(question.lastAnsweredAt, now),
    chapterInteraction:
      question.wordId !== null && input.interactedWordIds?.has(question.wordId) ? 1 : 0,
    weaknessRelevance: weaknessSignal(question.conceptCodes, input.weakConcepts),
    difficultyFit: difficultyFitSignal(question.difficulty, input.ability),
  };

  let score = 0;
  for (const [name, value] of Object.entries(signals) as [
    SelectionSignalName,
    number,
  ][]) {
    score += value * SELECTION_WEIGHTS[name];
  }

  return { ...question, signals, score: round(score) };
}

/** How much a previously answered question has recovered. Unseen scores 1. */
export function stalenessSignal(lastAnsweredAt: string | null, now: Date): number {
  if (!lastAnsweredAt) return 1;
  const days = (now.getTime() - Date.parse(lastAnsweredAt)) / MS_PER_DAY;
  if (!Number.isFinite(days) || days <= 0) return 0;
  return round(Math.min(1, days / QUESTION_STALENESS_DAYS));
}

/**
 * How much this question targets something the learner is failing.
 *
 * The MAXIMUM severity across the question's concepts, not the average: a
 * question that hits one badly-failing concept and one solid one is a good
 * question for that learner, and averaging would hide exactly the item worth
 * asking.
 */
export function weaknessSignal(
  conceptCodes: readonly string[],
  weakConcepts: ReadonlyMap<string, number> | undefined,
): number {
  if (!weakConcepts || weakConcepts.size === 0) return 0;
  let best = 0;
  for (const code of conceptCodes) {
    best = Math.max(best, weakConcepts.get(code) ?? 0);
  }
  return round(Math.min(1, best));
}

/**
 * How close a question sits to the sweet spot above the learner's ability.
 *
 * Returns 0 — not a penalty — when the learner has no ability estimate, so an
 * unplaced learner's Challenge is decided by the signals Fluent actually has
 * rather than by a difficulty comparison against a number it invented.
 */
export function difficultyFitSignal(
  difficulty: number,
  ability: number | null,
): number {
  if (ability === null) return 0;
  const target = ability + QUESTION_DIFFICULTY_SWEET_SPOT;
  const distance = Math.abs(difficulty - target);
  return round(Math.max(0, 1 - distance / QUESTION_DIFFICULTY_TOLERANCE));
}

function inCooldown(question: SelectableQuestion, now: Date): boolean {
  if (!question.lastAnsweredAt) return false;
  const days = (now.getTime() - Date.parse(question.lastAnsweredAt)) / MS_PER_DAY;
  return Number.isFinite(days) && days < QUESTION_COOLDOWN_DAYS;
}

function answeredAt(value: string | null): number {
  return value ? Date.parse(value) : 0;
}

/** How many questions of each kind the bank can offer this learner at all. */
export function availableByKind(
  questions: readonly SelectableQuestion[],
): Record<QuestionKind, number> {
  const counts = {} as Record<QuestionKind, number>;
  for (const kind of QUESTION_KINDS) counts[kind] = 0;
  for (const question of questions) {
    if (counts[question.kind] !== undefined) counts[question.kind] += 1;
  }
  return counts;
}

function round(value: number): number {
  return Math.round(value * 10000) / 10000;
}
