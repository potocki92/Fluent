/**
 * Reading the tags that say what an item exercises.
 *
 * Tags live on the answer-free public views (`questions_public`,
 * `calibration_questions_public`), which is why a learner's own client can read
 * them: a concept code is not an answer key. `questions` itself stays unreadable
 * from a browser, as it has been since the test-session migration.
 *
 * UNTAGGED ITEMS ARE NOT GUESSED AT. A question with no concepts produces
 * evidence for its skill and for nothing else. Attributing a wrong answer to
 * "probably adjective endings" because that felt likely would put fiction into
 * the weakness model, and a weakness model nobody can trust is worse than one
 * that says "za mało danych".
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { isConceptCode, type ConceptCode } from "@/lib/learning/concepts";
import { isSkillCode, type SkillCode } from "@/lib/learning/skills";
import type { Database } from "@/types/database";

type Client = SupabaseClient<Database>;

/** What one item exercises. */
export interface ItemTags {
  skillCode: SkillCode | null;
  conceptCodes: readonly ConceptCode[];
  /** Non-null only when the item genuinely tests this dictionary word. */
  testedWordId: number | null;
  /** The passage the item hangs off, when it has one. Placement items do not. */
  textId: number | null;
}

/**
 * Every comprehension question hangs off a passage and asks about it, so this is
 * the honest fallback when a row cannot be read — not an assumption, the same
 * value the column itself defaults to.
 */
export const DEFAULT_TEST_TAGS: ItemTags = {
  skillCode: "reading_comprehension",
  conceptCodes: [],
  testedWordId: null,
  textId: null,
};

/** A placement item whose tags are unknown is attributed to no skill at all. */
export const UNTAGGED: ItemTags = {
  skillCode: null,
  conceptCodes: [],
  testedWordId: null,
  textId: null,
};

interface TagRow {
  id: number;
  skill_code: string | null;
  tested_word_id: number | null;
  concepts: string[] | null;
  text_id?: number | null;
}

function toTags(row: TagRow): ItemTags {
  return {
    skillCode: isSkillCode(row.skill_code) ? row.skill_code : null,
    conceptCodes: (row.concepts ?? []).filter(isConceptCode),
    testedWordId: row.tested_word_id,
    textId: row.text_id ?? null,
  };
}

/** Tags for a set of reading-test questions, indexed by question id. */
export async function loadQuestionTags(
  supabase: Client,
  questionIds: readonly number[],
): Promise<Map<number, ItemTags>> {
  if (questionIds.length === 0) return new Map();
  const { data, error } = await supabase
    .from("questions_public")
    .select("id, text_id, skill_code, tested_word_id, concepts")
    .in("id", [...questionIds]);
  if (error) throw error;
  return new Map((data ?? []).map((row) => [row.id, toTags(row as TagRow)]));
}

/** Tags for a set of placement items, indexed by item id. */
export async function loadCalibrationTags(
  supabase: Client,
  questionIds: readonly number[],
): Promise<Map<number, ItemTags>> {
  if (questionIds.length === 0) return new Map();
  const { data, error } = await supabase
    .from("calibration_questions_public")
    .select("id, skill_code, tested_word_id, concepts")
    .in("id", [...questionIds]);
  if (error) throw error;
  return new Map((data ?? []).map((row) => [row.id, toTags(row as TagRow)]));
}
