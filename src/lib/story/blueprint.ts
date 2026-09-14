/**
 * The Chapter Challenge blueprint — how many questions of each kind.
 *
 * TWO LEARNERS WHO READ THE SAME CHAPTER DO NOT GET THE SAME TEST. One who keeps
 * missing Dativ gets more grammar; one who keeps missing inference gets more
 * comprehension. That is the whole personalisation claim of the Challenge, and
 * it is deliberately made HERE — in the mix — rather than by generating
 * different questions per learner, because a per-learner bank cannot be reviewed,
 * cannot be validated once, and cannot be shared.
 *
 * THE FLOOR THAT PERSONALISATION MAY NOT CROSS. Whatever the learner's
 * weaknesses, {@link MIN_COMPREHENSION_SHARE} of the Challenge asks about the
 * story. A learner with terrible grammar who has just finished a chapter of a
 * novel is still owed the question "did you follow what happened?" — and a
 * Challenge that stopped asking it would lose the only measurement it exists to
 * make, which is reading comprehension against a real text. Six grammar
 * questions and no story questions is not a personalised assessment; it is a
 * worksheet that happened to appear after a book.
 *
 * A blueprint is a REQUEST, not a guarantee. The bank may not hold four
 * comprehension questions, in which case `fitBlueprint` reports what was actually
 * available and the Challenge is shorter — see `selection.ts`.
 *
 * Pure.
 */

import {
  BLUEPRINT_BASE_MIX,
  BLUEPRINT_WEAKNESS_TILT,
  DEFAULT_CHALLENGE_QUESTIONS,
  KIND_SHARE_BOUNDS,
  MAX_CHALLENGE_QUESTIONS,
  MIN_CHALLENGE_QUESTIONS,
  QUESTION_KINDS,
  type QuestionKind,
} from "@/lib/story/constants";

/** How many questions of each kind a Challenge should contain. */
export type Blueprint = Record<QuestionKind, number>;

/** What the learner is currently weak at, reduced to what the mix cares about. */
export interface BlueprintPressure {
  /** 0–1 severity of the learner's grammar weaknesses. */
  grammar: number;
  /** 0–1 severity of their vocabulary weaknesses. */
  vocabulary: number;
  /** 0–1 severity of their reading/comprehension weaknesses. */
  reading: number;
}

export const NO_PRESSURE: BlueprintPressure = {
  grammar: 0,
  vocabulary: 0,
  reading: 0,
};

export interface BlueprintInput {
  /** How many questions to ask in total, before availability is considered. */
  questionCount?: number;
  pressure?: BlueprintPressure;
  /**
   * Words the learner looked up, saved or was pre-taught in this chapter.
   *
   * A chapter someone read without checking a single word has little contextual
   * vocabulary worth asking about, and padding the Challenge with it would mean
   * testing words chosen at random from a chapter they clearly handled.
   */
  chapterInteractionCount?: number;
}

/**
 * How long a Challenge should be.
 *
 * Bounded tightly on purpose. A Challenge is the coda to a chapter, not a second
 * activity: at eight questions it stops being "sprawdźmy, co zostało" and starts
 * being an exam the learner will skip next time.
 */
export function challengeQuestionCount(requested?: number): number {
  if (requested === undefined || !Number.isFinite(requested)) {
    return DEFAULT_CHALLENGE_QUESTIONS;
  }
  return Math.min(
    MAX_CHALLENGE_QUESTIONS,
    Math.max(MIN_CHALLENGE_QUESTIONS, Math.round(requested)),
  );
}

/**
 * Build the requested mix.
 *
 * Shares are tilted by weakness pressure, clamped to each kind's bounds, then
 * renormalised and turned into whole questions by largest-remainder — which is
 * the only rounding rule that cannot lose or invent a question while still
 * honouring the floors.
 */
export function buildBlueprint(input: BlueprintInput = {}): Blueprint {
  const total = challengeQuestionCount(input.questionCount);
  const pressure = input.pressure ?? NO_PRESSURE;

  const shares: Record<QuestionKind, number> = {
    comprehension: BLUEPRINT_BASE_MIX.comprehension + pressure.reading * BLUEPRINT_WEAKNESS_TILT,
    contextual_vocabulary:
      BLUEPRINT_BASE_MIX.contextual_vocabulary +
      pressure.vocabulary * BLUEPRINT_WEAKNESS_TILT,
    grammar: BLUEPRINT_BASE_MIX.grammar + pressure.grammar * BLUEPRINT_WEAKNESS_TILT,
    transfer: BLUEPRINT_BASE_MIX.transfer,
  };

  // A chapter read without a single lookup, save or pre-taught word has no
  // "contextual vocabulary" worth the name. Asking anyway would mean picking
  // words at random out of a chapter the learner evidently handled, so the
  // share is halved and the slack goes to comprehension.
  if ((input.chapterInteractionCount ?? 0) === 0) {
    const moved = shares.contextual_vocabulary / 2;
    shares.contextual_vocabulary -= moved;
    shares.comprehension += moved;
  }

  for (const kind of QUESTION_KINDS) {
    const bounds = KIND_SHARE_BOUNDS[kind];
    shares[kind] = Math.min(bounds.max, Math.max(bounds.min, shares[kind]));
  }

  return allocate(shares, total);
}

/**
 * Turn shares into whole questions, honouring the comprehension floor.
 *
 * Largest-remainder apportionment: the same rule used for allocating seats, and
 * for the same reason — naive rounding of four shares routinely produces five or
 * seven questions when six were asked for.
 */
function allocate(
  shares: Readonly<Record<QuestionKind, number>>,
  total: number,
): Blueprint {
  const sum = QUESTION_KINDS.reduce((acc, kind) => acc + shares[kind], 0);
  const exact = QUESTION_KINDS.map((kind) => ({
    kind,
    value: sum === 0 ? 0 : (shares[kind] / sum) * total,
  }));

  const blueprint = Object.fromEntries(
    exact.map((entry) => [entry.kind, Math.floor(entry.value)]),
  ) as Blueprint;

  let remaining = total - QUESTION_KINDS.reduce((acc, kind) => acc + blueprint[kind], 0);

  const byRemainder = [...exact].sort(
    (a, b) =>
      b.value - Math.floor(b.value) - (a.value - Math.floor(a.value)) ||
      QUESTION_KINDS.indexOf(a.kind) - QUESTION_KINDS.indexOf(b.kind),
  );

  for (const entry of byRemainder) {
    if (remaining <= 0) break;
    blueprint[entry.kind] += 1;
    remaining -= 1;
  }

  return enforceComprehensionFloor(blueprint, total);
}

/**
 * THE RULE §34 EXISTS FOR, applied after rounding rather than before.
 *
 * Shares can clear the floor and still round to zero comprehension questions in
 * a three-question Challenge. So the floor is re-checked on the integers, and
 * questions are taken from the largest other kind until it holds.
 */
export function enforceComprehensionFloor(
  blueprint: Blueprint,
  total: number,
): Blueprint {
  const required = Math.max(
    1,
    Math.ceil(total * KIND_SHARE_BOUNDS.comprehension.min),
  );
  const result: Blueprint = { ...blueprint };

  while (result.comprehension < required) {
    const donor = QUESTION_KINDS.filter((kind) => kind !== "comprehension")
      .filter((kind) => result[kind] > 0)
      .sort((a, b) => result[b] - result[a])[0];
    if (!donor) break;
    result[donor] -= 1;
    result.comprehension += 1;
  }

  return result;
}

/**
 * What the bank can actually deliver against a blueprint.
 *
 * When a kind is short, its unfilled slots are offered to the other kinds — in
 * an order that keeps comprehension as the last thing to be dropped, because a
 * Challenge without story questions is the one outcome that is worse than a
 * short Challenge.
 */
export function fitBlueprint(
  blueprint: Blueprint,
  available: Readonly<Record<QuestionKind, number>>,
): { fitted: Blueprint; total: number; short: number } {
  const fitted = {} as Blueprint;
  let deficit = 0;

  for (const kind of QUESTION_KINDS) {
    fitted[kind] = Math.min(blueprint[kind], available[kind] ?? 0);
    deficit += blueprint[kind] - fitted[kind];
  }

  // Redistribute in order of what a Challenge most needs when something is
  // missing: the story first, then the chapter's words, then language.
  const fallbackOrder: readonly QuestionKind[] = [
    "comprehension",
    "contextual_vocabulary",
    "grammar",
    "transfer",
  ];

  for (const kind of fallbackOrder) {
    if (deficit <= 0) break;
    const spare = (available[kind] ?? 0) - fitted[kind];
    if (spare <= 0) continue;
    const take = Math.min(spare, deficit);
    fitted[kind] += take;
    deficit -= take;
  }

  const total = QUESTION_KINDS.reduce((acc, kind) => acc + fitted[kind], 0);
  return { fitted, total, short: deficit };
}

/** Does the bank hold enough to run a Challenge at all? */
export function isChallengeViable(total: number): boolean {
  return total >= MIN_CHALLENGE_QUESTIONS;
}
