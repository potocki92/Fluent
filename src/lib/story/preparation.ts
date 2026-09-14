/**
 * Chapter preparation — choosing the handful of words worth clearing first.
 *
 * THE RULE THAT DEFINES THIS MODULE: a chapter with 142 words the learner does
 * not know does not get 142 cards. It gets between three and eight — the ones
 * that would actually stop them — and everything else they meet in context,
 * which is the entire reason to read a book rather than a deck. A preparation
 * screen that front-loads a chapter's whole vocabulary has turned the story into
 * homework before the first sentence.
 *
 * WHY THE RANKING IS DETERMINISTIC. "Which five words?" has to be answerable six
 * months from now, by reading a weighted sum whose weights are all in
 * `constants.ts`. There is no AI here and there does not need to be: frequency,
 * dispersion, dictionary band and the learner's own knowledge are facts Fluent
 * already holds, and computing them is free. The place where a model would add
 * something — knowing that *Schwert* matters to the SCENE rather than to the
 * word count — is honestly absent rather than faked; see `lexicalImportance`.
 *
 * Pure. Selection only; persisting the snapshot is the server action's job.
 */

import {
  CEFR_USEFULNESS,
  MAX_PRETEACH_WORDS,
  MIN_PREPARATION_MINUTES,
  MIN_PRETEACH_WORDS,
  PREPARATION_BUDGET_SHARE,
  PRETEACH_DIFFICULTY_ADJUSTMENT,
  PRETEACH_FREQUENCY_SATURATION,
  PRETEACH_SECONDS_PER_WORD,
  PRETEACH_WEIGHTS,
  UNRATED_CEFR_USEFULNESS,
  WORDS_PER_PRETEACH_TARGET,
  type PreteachSignalName,
} from "@/lib/story/constants";
import { isAlreadyKnown, unknownProbability, wordVerdict, type WordEvidence } from "@/lib/story/knowledge";
import type { DifficultyLabel } from "@/lib/story/analysis";

/** One candidate word, as the chapter and the dictionary describe it. */
export interface PreteachCandidate {
  wordId: number;
  lemma: string;
  display: string;
  translationPl: string | null;
  cefr: string | null;
  /** Times the word occurs in this chapter. */
  occurrenceCount: number;
  /** Where it first appears — earlier words block earlier. */
  firstParagraphPosition: number;
  firstSentencePosition: number;
  /** The sentence it first appears in, when one is available. */
  contextSentence?: string | null;
  /** A neutral dictionary example, used when no safe chapter sentence exists. */
  dictionaryExample?: string | null;
  /** Concepts this word is associated with, e.g. `word_gender` for a noun. */
  conceptCodes?: readonly string[];
}

export type PreteachSignals = Partial<Record<PreteachSignalName, number>>;

/** A candidate with its score and the reasons behind it. */
export interface RankedPreteachWord extends PreteachCandidate {
  score: number;
  signals: PreteachSignals;
  /** The sentence actually chosen for this word, and where it came from. */
  context: PreteachContext;
}

/**
 * The example sentence shown with a pre-taught word.
 *
 * SPOILER SAFETY, V1. A chapter sentence is only used when it is the word's
 * FIRST occurrence and sits in the opening stretch of the chapter — the part the
 * learner is about to read anyway, so it can give nothing away that the next
 * ninety seconds would not. Anything later falls back to a neutral dictionary
 * example, and a word with neither gets no sentence at all rather than a random
 * line from the middle of the chapter.
 *
 * This is deliberately a cheap, conservative rule rather than a Spoiler Guard.
 * It cannot tell that the first paragraph contains a twist, and it does not
 * claim to; what it can guarantee is that preparation never quotes something the
 * learner has not nearly reached.
 */
export interface PreteachContext {
  sentence: string | null;
  source: "chapter_opening" | "dictionary" | "none";
}

/**
 * Share of the chapter within which quoting a sentence is considered safe.
 *
 * A word whose first appearance is inside the opening fifth is about to be read;
 * quoting it reveals nothing the learner would not see in a minute. Past that,
 * the dictionary example is used instead.
 */
export const SPOILER_SAFE_PARAGRAPH_SHARE = 0.2;

/**
 * How many words to pre-teach.
 *
 * NOT A CONSTANT FIVE. Length sets the base — a 600-word scene and a 4 000-word
 * chapter do not need the same warm-up — and the learner's daily budget and the
 * chapter's personal difficulty move it one step in each direction. The result
 * is clamped, so no combination of inputs ever produces a thirty-card
 * "preparation".
 */
export function preteachTargetCount(input: {
  chapterWordCount: number;
  difficulty: DifficultyLabel;
  /** The learner's whole daily budget, in minutes. */
  dailyMinutes: number;
}): number {
  const byLength = Math.round(input.chapterWordCount / WORDS_PER_PRETEACH_TARGET);

  const byDifficulty =
    byLength +
    (input.difficulty === "very_challenging" || input.difficulty === "challenging"
      ? PRETEACH_DIFFICULTY_ADJUSTMENT
      : input.difficulty === "easy"
        ? -PRETEACH_DIFFICULTY_ADJUSTMENT
        : 0);

  // Preparation is the doorway, not the room: it may never eat more than its
  // share of the day, however much vocabulary the chapter contains.
  const byBudget = Math.floor(
    (input.dailyMinutes * PREPARATION_BUDGET_SHARE * 60) / PRETEACH_SECONDS_PER_WORD,
  );

  return clamp(
    Math.min(byDifficulty, byBudget),
    MIN_PRETEACH_WORDS,
    MAX_PRETEACH_WORDS,
  );
}

/** What a preparation session costs, in whole minutes. */
export function preparationMinutes(wordCount: number): number {
  return Math.max(
    MIN_PREPARATION_MINUTES,
    Math.round((wordCount * PRETEACH_SECONDS_PER_WORD) / 60),
  );
}

/**
 * How load-bearing a word is for the chapter, 0–1.
 *
 * WHAT THIS IS NOT: narrative importance. Fluent has no model of what happens in
 * a chapter, and scoring *Schwert* above *Tisch* because swords feel more
 * story-shaped would be the engine inventing a fact. What it can see is lexical
 * importance — a word that appears early and keeps appearing is load-bearing for
 * reading the chapter, whatever it means — and that is all this claims.
 *
 * Real narrative relevance is a genuine future use for a model, and it attaches
 * here without changing anything else.
 */
export function lexicalImportance(
  candidate: PreteachCandidate,
  chapterParagraphCount: number,
): number {
  const earliness =
    chapterParagraphCount <= 1
      ? 1
      : clamp01(1 - candidate.firstParagraphPosition / chapterParagraphCount);

  const recurrence = clamp01(
    (candidate.occurrenceCount - 1) / PRETEACH_FREQUENCY_SATURATION,
  );

  // Early matters more than often: a word that blocks paragraph two blocks the
  // whole chapter, and one that arrives on the last page blocks a page.
  return round(earliness * 0.6 + recurrence * 0.4);
}

/** Usefulness beyond this chapter, from the dictionary band. */
export function generalUsefulness(cefr: string | null): number {
  if (!cefr) return UNRATED_CEFR_USEFULNESS;
  return CEFR_USEFULNESS[cefr] ?? UNRATED_CEFR_USEFULNESS;
}

/** The example sentence to show, under the spoiler rule above. */
export function preteachContext(
  candidate: PreteachCandidate,
  chapterParagraphCount: number,
): PreteachContext {
  const safeUntil = Math.max(1, Math.ceil(chapterParagraphCount * SPOILER_SAFE_PARAGRAPH_SHARE));

  if (
    candidate.contextSentence &&
    candidate.firstParagraphPosition < safeUntil
  ) {
    return { sentence: candidate.contextSentence, source: "chapter_opening" };
  }
  if (candidate.dictionaryExample) {
    return { sentence: candidate.dictionaryExample, source: "dictionary" };
  }
  return { sentence: null, source: "none" };
}

export interface PreteachRankingInput {
  candidates: readonly PreteachCandidate[];
  knowledge: ReadonlyMap<number, WordEvidence>;
  chapterParagraphCount: number;
  /** Concept codes the learner is currently weak at, for `weaknessRelevance`. */
  weakConcepts?: ReadonlySet<string>;
}

/**
 * Rank the chapter's vocabulary by how much clearing it first would help.
 *
 * Words the model already calls known or likely known are DROPPED, not
 * down-weighted: a preparation list that spends a slot confirming *Haus* to a B1
 * reader has wasted a fifth of the learner's patience, and the cost of being
 * slightly wrong in the other direction is one word they meet in context anyway.
 * Words with no evidence stay in — never having watched someone meet a word is
 * exactly the case preparation is for.
 */
export function rankPreteachWords(
  input: PreteachRankingInput,
): RankedPreteachWord[] {
  const weak = input.weakConcepts ?? new Set<string>();

  return input.candidates
    .filter((candidate) => {
      if (!candidate.translationPl) return false; // nothing to teach
      return !isAlreadyKnown(wordVerdict(input.knowledge.get(candidate.wordId)));
    })
    .map((candidate) => {
      const signals: PreteachSignals = {
        unknownProbability: unknownProbability(input.knowledge.get(candidate.wordId)),
        frequency: clamp01(candidate.occurrenceCount / PRETEACH_FREQUENCY_SATURATION),
        importance: lexicalImportance(candidate, input.chapterParagraphCount),
        generalUsefulness: generalUsefulness(candidate.cefr),
        weaknessRelevance: (candidate.conceptCodes ?? []).some((code) => weak.has(code))
          ? 1
          : 0,
      };

      let score = 0;
      for (const [name, value] of Object.entries(signals) as [
        PreteachSignalName,
        number,
      ][]) {
        score += value * PRETEACH_WEIGHTS[name];
      }

      return {
        ...candidate,
        signals,
        score: round(score),
        context: preteachContext(candidate, input.chapterParagraphCount),
      };
    })
    // Ties broken by word id rather than left to sort stability, so the same
    // learner opening the same chapter twice sees the same list.
    .sort((a, b) => b.score - a.score || a.wordId - b.wordId);
}

/** The top `count` of a ranking, already de-duplicated by word. */
export function selectPreteachWords(
  ranked: readonly RankedPreteachWord[],
  count: number,
): RankedPreteachWord[] {
  const seen = new Set<number>();
  const chosen: RankedPreteachWord[] = [];

  for (const word of ranked) {
    if (seen.has(word.wordId)) continue;
    seen.add(word.wordId);
    chosen.push(word);
    if (chosen.length >= count) break;
  }

  return chosen;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function round(value: number): number {
  return Math.round(value * 10000) / 10000;
}
