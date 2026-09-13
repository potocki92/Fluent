/**
 * The read side of the learning engine.
 *
 * Everything the app is allowed to ask about a learner's knowledge goes through
 * these functions. That is a deliberate boundary: components must not grow their
 * own `select * from learning_events`, because the event log is the one table in
 * this system designed to get large — tens of thousands of rows per active
 * learner, and no upper bound. Every query here reads an AGGREGATE row instead,
 * indexed on `user_id`, so page render cost stays flat as history grows.
 *
 * The event log is still readable by its owner (RLS allows it), and a future
 * "why do you think that?" view will read it — for one word, over a bounded
 * window, never as the source for a summary.
 */

import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  CONCEPT_CATALOG,
  type ConceptCategory,
  type ConceptCode,
} from "@/lib/learning/concepts";
import {
  confidenceAt,
  verdictFor,
  weaknessPriority,
  type KnowledgeState,
  type KnowledgeVerdict,
} from "@/lib/learning/knowledge-model";
import { SKILLS, type SkillCode } from "@/lib/learning/skills";
import {
  conceptEntries,
  skillEntries,
  toWordEntry,
  CONCEPT_STATE_COLUMNS,
  SKILL_STATE_COLUMNS,
  WORD_KNOWLEDGE_COLUMNS,
  type ConceptStateRow,
  type SkillStateRow,
  type WordKnowledgeRow,
} from "@/lib/learning/state-mapper";

/** One dimension of the learner's skill profile, ready to render. */
export interface SkillProfileEntry {
  code: SkillCode;
  labelPl: string;
  descriptionPl: string;
  /** False when Fluent has no exercise for this skill yet. */
  isAssessed: boolean;
  score: number | null;
  /** Decayed to now, not the snapshot taken when the evidence arrived. */
  confidence: number;
  verdict: KnowledgeVerdict;
  evidenceCount: number;
  lastEvidenceAt: string | null;
}

/**
 * The learner's whole skill profile.
 *
 * EVERY catalog skill is returned, including the ones with no evidence — they
 * come back as `unknown`. Omitting them would let a caller infer a level for a
 * skill from the ones around it, which is precisely the inference this model
 * refuses to make.
 */
export async function getUserSkillProfile(): Promise<SkillProfileEntry[]> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return emptyProfile();

  const { data, error } = await supabase
    .from("user_skill_state")
    .select(SKILL_STATE_COLUMNS)
    .eq("user_id", user.id);
  if (error) throw error;

  const now = new Date();
  const states = skillEntries((data ?? []) as SkillStateRow[]);

  return SKILLS.map((skill) => {
    const entry = states.get(skill.code);
    return {
      code: skill.code,
      labelPl: skill.labelPl,
      descriptionPl: skill.descriptionPl,
      isAssessed: skill.isAssessed,
      score: entry?.state.score ?? null,
      confidence: entry ? confidenceAt(entry.state, now) : 0,
      verdict: verdictFor(entry?.state, now),
      evidenceCount: entry?.state.evidenceCount ?? 0,
      lastEvidenceAt: entry?.state.lastEvidenceAt ?? null,
    };
  });
}

/** A concept the learner keeps getting wrong, with the evidence behind it. */
export interface ConceptWeakness {
  code: ConceptCode;
  labelPl: string;
  descriptionPl: string;
  category: ConceptCategory;
  skillCode: SkillCode;
  score: number;
  confidence: number;
  evidenceCount: number;
  failureCount: number;
  lastFailureAt: string | null;
  /** 0–1 ranking key; see `weaknessPriority`. */
  priority: number;
}

/**
 * The learner's strongest recurring weaknesses, worst first.
 *
 * A single mistake never appears here. `weaknessPriority` requires a pattern —
 * several observations, more than one failure, and enough confidence to mean
 * something — so the list is short and, when it is empty, honestly empty.
 */
export async function getUserWeakestConcepts(
  limit = 5,
): Promise<ConceptWeakness[]> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  // Ordering by score in the database narrows the candidate set cheaply (the
  // partial index on (user_id, score) backs it); the pattern rules are then
  // applied in the domain, where they are unit-tested.
  const { data, error } = await supabase
    .from("user_concept_state")
    .select(CONCEPT_STATE_COLUMNS)
    .eq("user_id", user.id)
    .not("score", "is", null)
    .order("score", { ascending: true })
    .limit(Math.max(limit * 4, 20));
  if (error) throw error;

  const now = new Date();
  const entries = conceptEntries((data ?? []) as ConceptStateRow[]);

  return [...entries.values()]
    .map((entry) => ({ entry, priority: weaknessPriority(entry.state, now) }))
    .filter(({ priority }) => priority > 0)
    .sort((a, b) => b.priority - a.priority)
    .slice(0, limit)
    .map(({ entry, priority }) => {
      const definition = CONCEPT_CATALOG[entry.conceptCode];
      return {
        code: entry.conceptCode,
        labelPl: definition.labelPl,
        descriptionPl: definition.descriptionPl,
        category: definition.category,
        skillCode: definition.skillCode,
        // `weaknessPriority` already rejected a null score, so this is safe.
        score: entry.state.score as number,
        confidence: confidenceAt(entry.state, now),
        evidenceCount: entry.state.evidenceCount,
        failureCount: entry.state.failureCount,
        lastFailureAt: entry.lastFailureAt,
        priority,
      };
    });
}

/** What is known about one dictionary word, per channel. */
export interface WordKnowledgeSummary {
  wordId: number;
  receptive: ChannelSummary;
  active: ChannelSummary;
  exposureCount: number;
  successfulRetrievals: number;
  failedRetrievals: number;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
}

export interface ChannelSummary {
  score: number | null;
  confidence: number;
  verdict: KnowledgeVerdict;
  evidenceCount: number;
}

/**
 * Knowledge of a single word.
 *
 * Returns null when the learner has never been tested on it — which is NOT the
 * same as "does not know it", and must not be rendered as a zero. A word sitting
 * in the review deck with no reviews yet has a schedule (in `saved_words`) and
 * no knowledge (here); those are different facts about different things.
 */
export async function getUserWordKnowledge(
  wordId: number,
): Promise<WordKnowledgeSummary | null> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from("user_word_knowledge")
    .select(WORD_KNOWLEDGE_COLUMNS)
    .eq("user_id", user.id)
    .eq("word_id", wordId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const entry = toWordEntry(data as WordKnowledgeRow);
  const now = new Date();

  return {
    wordId: entry.wordId,
    receptive: channelSummary(entry.receptive, now),
    active: channelSummary(entry.active, now),
    exposureCount: entry.exposureCount,
    successfulRetrievals: entry.successfulRetrievals,
    failedRetrievals: entry.failedRetrievals,
    firstSeenAt: entry.firstSeenAt,
    lastSeenAt: entry.lastSeenAt,
  };
}

function channelSummary(state: KnowledgeState, now: Date): ChannelSummary {
  return {
    score: state.score,
    confidence: confidenceAt(state, now),
    verdict: verdictFor(state, now),
    evidenceCount: state.evidenceCount,
  };
}

function emptyProfile(): SkillProfileEntry[] {
  return SKILLS.map((skill) => ({
    code: skill.code,
    labelPl: skill.labelPl,
    descriptionPl: skill.descriptionPl,
    isAssessed: skill.isAssessed,
    score: null,
    confidence: 0,
    verdict: "unknown" as const,
    evidenceCount: 0,
    lastEvidenceAt: null,
  }));
}
