/**
 * Reading the learner's current knowledge state before folding new evidence.
 *
 * Only the rows an interaction actually touches are read — the skills, concepts
 * and words named by the evidence about to be applied — never the learner's
 * whole profile and never the event log. A review of one card reads at most
 * three rows; a five-question test reads a handful. That is the difference
 * between a model that scales to a long history and one that gets slower every
 * month a learner uses it.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { KnowledgeSnapshot } from "@/lib/learning/aggregate";
import type { ConceptCode } from "@/lib/learning/concepts";
import type { LearningEvidence } from "@/lib/learning/evidence";
import type { SkillCode } from "@/lib/learning/skills";
import {
  conceptEntries,
  skillEntries,
  wordEntries,
  CONCEPT_STATE_COLUMNS,
  SKILL_STATE_COLUMNS,
  WORD_KNOWLEDGE_COLUMNS,
  type ConceptStateRow,
  type SkillStateRow,
  type WordKnowledgeRow,
} from "@/lib/learning/state-mapper";
import type { Database } from "@/types/database";

type Client = SupabaseClient<Database>;

/**
 * Load exactly the state rows `evidence` will update.
 *
 * Runs on the learner's own cookie-bound client, so RLS still scopes every row
 * to them: there is no path here that could read someone else's knowledge.
 */
export async function loadKnowledgeSnapshot(
  supabase: Client,
  userId: string,
  evidence: readonly LearningEvidence[],
): Promise<KnowledgeSnapshot> {
  const skillCodes = new Set<SkillCode>();
  const conceptCodes = new Set<ConceptCode>();
  const wordIds = new Set<number>();

  for (const item of evidence) {
    if (item.skillCode) skillCodes.add(item.skillCode);
    for (const code of item.conceptCodes) conceptCodes.add(code);
    if (item.wordId !== null && item.vocabularyChannel !== null) wordIds.add(item.wordId);
  }

  const [skills, concepts, words] = await Promise.all([
    skillCodes.size === 0
      ? null
      : supabase
          .from("user_skill_state")
          .select(SKILL_STATE_COLUMNS)
          .eq("user_id", userId)
          .in("skill_code", [...skillCodes])
          .then(unwrap<SkillStateRow>),
    conceptCodes.size === 0
      ? null
      : supabase
          .from("user_concept_state")
          .select(CONCEPT_STATE_COLUMNS)
          .eq("user_id", userId)
          .in("concept_code", [...conceptCodes])
          .then(unwrap<ConceptStateRow>),
    wordIds.size === 0
      ? null
      : supabase
          .from("user_word_knowledge")
          .select(WORD_KNOWLEDGE_COLUMNS)
          .eq("user_id", userId)
          .in("word_id", [...wordIds])
          .then(unwrap<WordKnowledgeRow>),
  ]);

  return {
    skills: skillEntries(skills),
    concepts: conceptEntries(concepts),
    words: wordEntries(words),
  };
}

/**
 * A missing row is not an error: it simply means this learner has no evidence
 * for that skill yet, which {@link foldEvidence} already treats as an empty
 * state. A failed query is different and must not be silently read as "empty",
 * so it throws and the caller reports it.
 */
function unwrap<T>({ data, error }: { data: unknown; error: unknown }): T[] {
  if (error) throw error;
  return (data ?? []) as T[];
}
