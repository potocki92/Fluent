/**
 * Candidate generators — "what could this learner usefully do right now?"
 *
 * WHY THESE ARE SEPARATE FROM THE RANKING. Each generator knows one corner of
 * the learner's data and nothing about the others: the review generator knows
 * SM-2 schedules, the weakness generator knows concept state, neither knows how
 * either compares to reading. They emit {@link PlanCandidate}s carrying their own
 * time estimate and their own normalised signals, and the priority engine
 * compares those. That seam is the reason a book-chapter generator can be added
 * later by writing one function, instead of by reopening the scoring.
 *
 * RULES EVERY GENERATOR FOLLOWS.
 *
 *  - **Never propose something the learner cannot do.** A weakness with no
 *    questions behind it produces no candidate. A dead task on the home screen
 *    is worse than a shorter plan.
 *  - **Never invent a signal.** If the data cannot support a factor, the factor
 *    is absent, not guessed. Fake personalisation is indistinguishable from real
 *    personalisation right up to the moment the learner notices.
 *  - **Read aggregates, bounded.** The Today page is the most-opened screen in
 *    the app. Every query here is indexed, limited, and independent of how long
 *    the learner has been using Fluent.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { abilityToCefr } from "@/lib/cefr";
import type { ConceptCode } from "@/lib/learning/concepts";
import {
  DEFAULT_READING_MINUTES,
  EVIDENCE_LEVEL_THRESHOLDS,
  KNOWN_WORD_CONFIDENCE,
  KNOWN_WORD_SCORE,
  MAX_NEW_WORDS,
  MAX_PRACTICE_QUESTIONS,
  MAX_READING_MINUTES,
  MAX_REVIEW_BATCH,
  MIN_NEW_WORDS,
  MIN_PRACTICE_QUESTIONS,
  MIN_READING_MINUTES,
  MIN_REVIEW_BATCH,
  PLACEMENT_MINUTES,
  PRACTICE_SECONDS_PER_QUESTION,
  READING_WORDS_PER_MINUTE,
  REVIEW_BUDGET_SHARE,
  REVIEW_CARDS_PER_MINUTE,
  SECONDS_PER_NEW_WORD,
} from "@/lib/learning/planner/constants";
import {
  continuationSignal,
  difficultyMatchSignal,
  dueUrgencySignal,
  signals,
  studyAheadSignal,
  vocabularyFitSignal,
  weaknessRecencySignal,
} from "@/lib/learning/planner/priority";
import { reason } from "@/lib/learning/planner/reasons";
import type { EvidenceLevel, PlanCandidate } from "@/lib/learning/planner/types";
import type { RankedWeakness } from "@/lib/learning/weakness";
import type { Database } from "@/types/database";
import type { StoredCefrLevel } from "@/types";

type Client = SupabaseClient<Database>;

/** Everything a generator may look at. Assembled once, shared by all of them. */
export interface PlannerContext {
  supabase: Client;
  userId: string;
  now: Date;
  targetMinutes: number;
  ability: number;
  /** 'default' means the learner has never been placed — see the onboarding path. */
  levelSource: "default" | "manual" | "placement" | "test";
}

/**
 * How many cards today's review batch should hold.
 *
 * THE 300-OVERDUE PROBLEM. A learner who has been away comes back to a queue
 * that is, in the scheduler's terms, entirely due. Showing them "300 kart do
 * zrobienia" is how they close the app and do not come back. So the batch is
 * sized by the TIME THEY ASKED FOR, capped, and the rest stays in the
 * scheduler — untouched, not lost, not forgiven, just not today's problem.
 */
export function reviewBatchSize(dueCount: number, targetMinutes: number): number {
  const affordable = Math.round(
    targetMinutes * REVIEW_BUDGET_SHARE * REVIEW_CARDS_PER_MINUTE,
  );
  const wanted = Math.max(MIN_REVIEW_BATCH, Math.min(MAX_REVIEW_BATCH, affordable));
  return Math.min(dueCount, wanted);
}

/** Whole minutes a review batch should take. */
export function reviewMinutes(cards: number): number {
  return Math.max(1, Math.ceil(cards / REVIEW_CARDS_PER_MINUTE));
}

/** Whole minutes a passage should take, from its length. */
export function readingMinutes(wordCount: number | null): number {
  if (!wordCount || wordCount <= 0) return DEFAULT_READING_MINUTES;
  const estimate = Math.ceil(wordCount / READING_WORDS_PER_MINUTE);
  return Math.min(MAX_READING_MINUTES, Math.max(MIN_READING_MINUTES, estimate));
}

/** How much evidence the planner is working from. See `daily_plans.evidence_level`. */
export function evidenceLevelFor(observations: number): EvidenceLevel {
  if (observations >= EVIDENCE_LEVEL_THRESHOLDS.high) return "high";
  if (observations >= EVIDENCE_LEVEL_THRESHOLDS.medium) return "medium";
  if (observations >= EVIDENCE_LEVEL_THRESHOLDS.low) return "low";
  return "none";
}

/**
 * Dictionary levels worth teaching a learner at `ability`.
 *
 * The current band plus the one below it: new vocabulary should be mostly
 * consolidating, and a learner at B1 who is handed only B1 words gets a much
 * harder session than the estimate promised.
 */
export function vocabularyLevelsFor(ability: number): StoredCefrLevel[] {
  switch (abilityToCefr(ability)) {
    case "B2":
      return ["B1", "B2"];
    case "B1":
      return ["A2", "B1"];
    case "A2":
      return ["A1", "A2"];
    case "A1+":
      return ["A1", "A2"];
    default:
      return ["A1"];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. ONBOARDING
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The only candidate a learner with no level gets.
 *
 * A plan built for someone whose ability is the default 1000 is not personalised
 * — it is a guess wearing a personalised plan's clothes. Every other generator
 * below measures something against that ability, so until it means anything, the
 * honest recommendation is to go and find out.
 */
export function placementCandidates(ctx: PlannerContext): PlanCandidate[] {
  if (ctx.levelSource !== "default") return [];
  return [
    {
      type: "placement",
      estimatedMinutes: PLACEMENT_MINUTES,
      targetCount: 1,
      signals: signals({ onboarding: 1 }),
      reason: reason("no_level_yet"),
    },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. REVIEWS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Due cards, and — only when there are none — study-ahead work.
 *
 * One query does both halves of the urgency signal: `count` says how big the
 * queue is and the first row says how late its oldest card is. The partial index
 * on `(user_id, due_at)` backs it, so the cost is the same for a learner with
 * twelve cards and one with twelve thousand.
 */
export async function reviewCandidates(ctx: PlannerContext): Promise<PlanCandidate[]> {
  const nowIso = ctx.now.toISOString();

  const { data: due, count } = await ctx.supabase
    .from("saved_words")
    .select("word_id, due_at", { count: "exact" })
    .eq("user_id", ctx.userId)
    .eq("is_mastered", false)
    .lte("due_at", nowIso)
    .order("due_at", { ascending: true })
    .limit(MAX_REVIEW_BATCH);

  const dueCount = count ?? due?.length ?? 0;

  if (dueCount > 0) {
    const cards = reviewBatchSize(dueCount, ctx.targetMinutes);
    return [
      {
        type: "review_due",
        estimatedMinutes: reviewMinutes(cards),
        targetCount: cards,
        signals: signals({
          dueUrgency: dueUrgencySignal({
            dueCount,
            oldestDueAt: due?.[0]?.due_at ?? null,
            now: ctx.now,
          }),
        }),
        // The learner is told what today holds, not what the backlog totals.
        // "Masz 300 zaległych" is true, demotivating, and not actionable.
        reason: reason("overdue_reviews", { count: cards }),
        payload: { dueTotal: dueCount },
      },
    ];
  }

  // Nothing overdue. Study ahead is worth offering, but never at the price of
  // outranking real work — see STUDY_AHEAD_URGENCY.
  const { count: aheadCount } = await ctx.supabase
    .from("saved_words")
    .select("word_id", { count: "exact", head: true })
    .eq("user_id", ctx.userId)
    .eq("is_mastered", false)
    .gt("due_at", nowIso);

  const ahead = aheadCount ?? 0;
  if (ahead === 0) return [];

  const cards = reviewBatchSize(ahead, ctx.targetMinutes);
  return [
    {
      type: "review_due",
      estimatedMinutes: reviewMinutes(cards),
      targetCount: cards,
      signals: signals({ dueUrgency: studyAheadSignal(ahead) }),
      reason: reason("study_ahead", { count: cards }),
      payload: { studyAhead: true },
    },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. WEAKNESS PRACTICE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Drills for the concepts the learner keeps failing — but only where a drill
 * actually exists.
 *
 * CONTENT COVERAGE IS PART OF THE ALGORITHM. `relative_clause` can be a
 * learner's worst weakness and still produce no candidate, because the item bank
 * has nothing tagged with it. Showing the task anyway would put a button on the
 * home screen that leads to an error; the gap is reported to admins through
 * `concept_practice_pool` instead, where it is a content problem someone can fix.
 */
export async function weaknessCandidates(
  ctx: PlannerContext,
  weaknesses: readonly RankedWeakness[],
): Promise<PlanCandidate[]> {
  if (weaknesses.length === 0) return [];

  const { data: pool } = await ctx.supabase
    .from("concept_practice_pool")
    .select("concept_code, question_count")
    .in(
      "concept_code",
      weaknesses.map((weakness) => weakness.code),
    );

  const available = new Map(
    (pool ?? []).map((row) => [row.concept_code as ConceptCode, row.question_count]),
  );

  return weaknesses.flatMap((weakness): PlanCandidate[] => {
    const questionsAvailable = available.get(weakness.code) ?? 0;
    if (questionsAvailable < MIN_PRACTICE_QUESTIONS) return [];

    const questions = Math.min(questionsAvailable, MAX_PRACTICE_QUESTIONS);
    const minutes = Math.max(
      1,
      Math.ceil((questions * PRACTICE_SECONDS_PER_QUESTION) / 60),
    );

    // Recent failures deserve a concrete reason; an old, faded weakness gets the
    // general one, because "ostatnio 4 błędy" would be a lie about March.
    const isRecent = weakness.recency > 0.6 && weakness.failureCount >= 2;

    return [
      {
        type: "weakness_practice",
        estimatedMinutes: minutes,
        targetCount: questions,
        conceptCode: weakness.code,
        signals: signals({
          weaknessSeverity: weakness.priority,
          weaknessRecency: weaknessRecencySignal(weakness.lastFailureAt, ctx.now),
        }),
        reason: isRecent
          ? reason("recurring_mistakes", {
              count: weakness.failureCount,
              outOf: weakness.evidenceCount,
              conceptLabel: weakness.labelPl,
            })
          : reason("weak_concept", { conceptLabel: weakness.labelPl }),
        payload: {
          conceptLabel: weakness.labelPl,
          severity: weakness.severity,
          questionsAvailable,
        },
      },
    ];
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. READING
// ─────────────────────────────────────────────────────────────────────────────

interface TextRow {
  id: number;
  title: string;
  cefr: string;
  difficulty: number;
  word_count: number | null;
}

/**
 * Something to read: first whatever was started, then the best next passage.
 *
 * "STARTED" IS THREE DIFFERENT FACTS, in descending strength — a test left
 * mid-way (they were one screen from a result), a test that did not pass (they
 * finished and want another go), and a passage that was merely opened. The last
 * of those is why `text_progress` exists at all: nothing in Fluent previously
 * recorded that a learner had read something without testing on it, so "continue
 * what you started" had no data behind it for exactly the learners most likely
 * to need it.
 */
export async function readingCandidates(ctx: PlannerContext): Promise<PlanCandidate[]> {
  const [openTests, opened, completions] = await Promise.all([
    ctx.supabase
      .from("test_sessions")
      .select("text_id")
      .eq("user_id", ctx.userId)
      .eq("status", "in_progress")
      .limit(5),
    ctx.supabase
      .from("text_progress")
      .select("text_id, last_opened_at")
      .eq("user_id", ctx.userId)
      .order("last_opened_at", { ascending: false })
      .limit(10),
    ctx.supabase
      .from("text_completions")
      .select("text_id, passed, completed_at")
      .eq("user_id", ctx.userId)
      .order("completed_at", { ascending: false })
      .limit(200),
  ]);

  const passed = new Set(
    (completions.data ?? []).filter((row) => row.passed).map((row) => row.text_id),
  );
  const failed = new Set(
    (completions.data ?? []).filter((row) => !row.passed).map((row) => row.text_id),
  );
  const openTestTexts = new Set((openTests.data ?? []).map((row) => row.text_id));
  const openedAt = new Map(
    (opened.data ?? []).map((row) => [row.text_id, row.last_opened_at]),
  );

  // Anything with a claim to being "in progress", strongest first.
  const startedIds = [
    ...new Set([...openTestTexts, ...failed, ...openedAt.keys()]),
  ].filter((id) => !passed.has(id));

  const [startedTexts, pool] = await Promise.all([
    startedIds.length === 0
      ? Promise.resolve({ data: [] as TextRow[] })
      : ctx.supabase
          .from("texts")
          .select("id, title, cefr, difficulty, word_count")
          .in("id", startedIds.slice(0, 10))
          .eq("status", "published"),
    ctx.supabase
      .from("texts")
      .select("id, title, cefr, difficulty, word_count")
      .eq("status", "published")
      // Bounded around the learner's level rather than "all published texts":
      // a passage far outside it can never win, so fetching it is pure cost.
      .gte("difficulty", ctx.ability - 300)
      .lte("difficulty", ctx.ability + 300)
      .limit(40),
  ]);

  const candidates: PlanCandidate[] = [];

  for (const text of (startedTexts.data ?? []) as TextRow[]) {
    const hasOpenTest = openTestTexts.has(text.id);
    const continuation = continuationSignal({
      hasOpenTestSession: hasOpenTest,
      lastOpenedAt: openedAt.get(text.id) ?? null,
      now: ctx.now,
    });
    // A failed attempt is a standing invitation to retry even if the learner has
    // not opened the passage since.
    const strength = failed.has(text.id) ? Math.max(continuation, 0.7) : continuation;
    if (strength <= 0) continue;

    candidates.push({
      type: "continue_text",
      estimatedMinutes: readingMinutes(text.word_count),
      targetCount: 1,
      textId: text.id,
      signals: signals({
        continuation: strength,
        difficultyMatch: difficultyMatchSignal(text.difficulty, ctx.ability),
      }),
      reason: failed.has(text.id)
        ? reason("text_unfinished", { textTitle: text.title })
        : reason("text_started", { textTitle: text.title }),
      payload: { title: text.title, cefr: text.cefr },
    });
  }

  // A new passage, chosen for fit — and never one already passed, which is what
  // "nowy tekst" would otherwise quietly mean for a long-time learner.
  const startedSet = new Set(startedIds);
  const fresh = ((pool.data ?? []) as TextRow[])
    .filter((text) => !passed.has(text.id) && !startedSet.has(text.id))
    .map((text) => ({ text, fit: difficultyMatchSignal(text.difficulty, ctx.ability) }))
    .filter(({ fit }) => fit > 0)
    .sort((a, b) => b.fit - a.fit)[0];

  if (fresh) {
    candidates.push({
      type: "new_text",
      estimatedMinutes: readingMinutes(fresh.text.word_count),
      targetCount: 1,
      textId: fresh.text.id,
      signals: signals({ difficultyMatch: fresh.fit }),
      reason: reason("level_match", { textTitle: fresh.text.title }),
      payload: { title: fresh.text.title, cefr: fresh.text.cefr },
    });
  }

  return candidates;
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. NEW VOCABULARY
// ─────────────────────────────────────────────────────────────────────────────

/** How many dictionary rows to look at when assembling a batch. */
const VOCABULARY_SCAN_LIMIT = 200;
/** How many exclusion ids may be pushed into the query before filtering locally. */
const EXCLUSION_URL_LIMIT = 300;

/**
 * A small batch of words the learner genuinely does not know yet.
 *
 * WHAT THIS REPLACES. The review screen's "ucz się dalej" deck was
 * `order by cefr asc` — the alphabet of levels, with no reference to the learner
 * at all. It would happily teach someone a word they had already answered
 * correctly a dozen times, because enrolment (`saved_words`) and knowledge
 * (`user_word_knowledge`) are different tables and only the first was consulted.
 *
 * TWO EXCLUSIONS, FOR TWO DIFFERENT REASONS:
 *
 *  - **Already enrolled** — it is in the review deck; teaching it as new would
 *    duplicate the card.
 *  - **Already known receptively** — the learner recognises it with real
 *    confidence behind that. "Naucz się Schwert od początku" to someone who has
 *    recognised *Schwert* fifteen times is the fastest way to lose their trust in
 *    the recommendation.
 *
 * Note what the second exclusion does NOT do: a strong receptive score does not
 * mean the word is finished. It means the RIGHT exercise is active recall, and
 * Fluent has no active-recall exercise yet. The word is set aside rather than
 * re-taught, and it is waiting when that exercise ships.
 */
export async function vocabularyCandidates(
  ctx: PlannerContext,
): Promise<PlanCandidate[]> {
  const levels = vocabularyLevelsFor(ctx.ability);

  const [saved, known] = await Promise.all([
    ctx.supabase
      .from("saved_words")
      .select("word_id")
      .eq("user_id", ctx.userId)
      .limit(3000),
    ctx.supabase
      .from("user_word_knowledge")
      .select("word_id, receptive_score, receptive_confidence")
      .eq("user_id", ctx.userId)
      .gte("receptive_score", KNOWN_WORD_SCORE)
      .gte("receptive_confidence", KNOWN_WORD_CONFIDENCE)
      .limit(3000),
  ]);

  const excluded = new Set<number>([
    ...(saved.data ?? []).map((row) => row.word_id),
    ...(known.data ?? []).map((row) => row.word_id),
  ]);

  let query = ctx.supabase
    .from("words")
    .select("id, display, translation_pl, cefr")
    .in("cefr", levels)
    .order("id", { ascending: true })
    .limit(VOCABULARY_SCAN_LIMIT);

  // Push the exclusion into the query when it is small enough to fit in a URL;
  // otherwise scan a page and filter here. Either way the batch is correct — the
  // difference is only how many rows come back to be thrown away.
  if (excluded.size > 0 && excluded.size <= EXCLUSION_URL_LIMIT) {
    query = query.not("id", "in", `(${[...excluded].join(",")})`);
  }

  const { data: words } = await query;
  const batch = (words ?? [])
    .filter((word) => !excluded.has(word.id))
    .slice(0, MAX_NEW_WORDS);

  if (batch.length < MIN_NEW_WORDS) return [];

  const minutes = Math.max(
    1,
    Math.ceil((batch.length * SECONDS_PER_NEW_WORD) / 60),
  );

  return [
    {
      type: "new_vocabulary",
      estimatedMinutes: minutes,
      targetCount: batch.length,
      wordIds: batch.map((word) => word.id),
      signals: signals({
        vocabularyFit: vocabularyFitSignal({
          wordCount: batch.length,
          targetCount: MAX_NEW_WORDS,
          atLevelCount: batch.filter((word) =>
            levels.includes(word.cefr as StoredCefrLevel),
          ).length,
        }),
      }),
      reason: reason("new_words", { count: batch.length }),
      payload: {
        preview: batch.slice(0, 3).map((word) => word.display),
      },
    },
  ];
}
