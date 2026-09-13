/**
 * Database rows ⇄ domain knowledge states.
 *
 * Kept separate from both the model (which must not know about Supabase) and the
 * actions (which must not grow a second, slightly different parser). Every
 * numeric column is coerced with `Number()` because PostgREST can hand back a
 * `numeric` as a string depending on its size, and a silently stringified score
 * would poison every calculation downstream.
 */

import type {
  ConceptStateEntry,
  SkillStateEntry,
  WordKnowledgeEntry,
} from "@/lib/learning/aggregate";
import { isConceptCode, type ConceptCode } from "@/lib/learning/concepts";
import { EMPTY_KNOWLEDGE_STATE, type KnowledgeState } from "@/lib/learning/knowledge-model";
import { isSkillCode, type SkillCode } from "@/lib/learning/skills";

/** The state columns shared by `user_skill_state` and `user_concept_state`. */
export interface KnowledgeStateRow {
  score: number | null;
  confidence: number;
  evidence_weight: number;
  success_weight: number;
  evidence_count: number;
  successful_evidence: number;
  failed_evidence: number;
  source_kinds: string[];
  first_evidence_at: string | null;
  last_evidence_at: string | null;
}

export interface SkillStateRow extends KnowledgeStateRow {
  skill_code: string;
  version: number;
}

export interface ConceptStateRow extends KnowledgeStateRow {
  concept_code: string;
  version: number;
  last_success_at: string | null;
  last_failure_at: string | null;
}

export interface WordKnowledgeRow {
  word_id: number;
  version: number;
  first_seen_at: string | null;
  last_seen_at: string | null;
  last_success_at: string | null;
  last_failure_at: string | null;
  exposure_count: number;
  successful_retrievals: number;
  failed_retrievals: number;
  receptive_score: number | null;
  receptive_confidence: number;
  receptive_evidence_weight: number;
  receptive_success_weight: number;
  receptive_evidence_count: number;
  receptive_last_at: string | null;
  active_score: number | null;
  active_confidence: number;
  active_evidence_weight: number;
  active_success_weight: number;
  active_evidence_count: number;
  active_last_at: string | null;
  source_kinds: string[];
}

// Column lists shared by the actions and the query layer. They are single string
// LITERALS on purpose: supabase-js infers the row type from the select string, so
// a concatenated one degrades the whole query to an untyped result.
export const SKILL_STATE_COLUMNS =
  "skill_code, version, score, confidence, evidence_weight, success_weight, evidence_count, successful_evidence, failed_evidence, source_kinds, first_evidence_at, last_evidence_at";

export const CONCEPT_STATE_COLUMNS =
  "concept_code, version, score, confidence, evidence_weight, success_weight, evidence_count, successful_evidence, failed_evidence, source_kinds, first_evidence_at, last_evidence_at, last_success_at, last_failure_at";

export const WORD_KNOWLEDGE_COLUMNS =
  "word_id, version, first_seen_at, last_seen_at, last_success_at, last_failure_at, exposure_count, successful_retrievals, failed_retrievals, receptive_score, receptive_confidence, receptive_evidence_weight, receptive_success_weight, receptive_evidence_count, receptive_last_at, active_score, active_confidence, active_evidence_weight, active_success_weight, active_evidence_count, active_last_at, source_kinds";

function toState(row: KnowledgeStateRow): KnowledgeState {
  return {
    score: row.score === null ? null : Number(row.score),
    confidence: Number(row.confidence),
    evidenceWeight: Number(row.evidence_weight),
    successWeight: Number(row.success_weight),
    evidenceCount: row.evidence_count,
    successCount: row.successful_evidence,
    failureCount: row.failed_evidence,
    sourceKinds: row.source_kinds ?? [],
    firstEvidenceAt: row.first_evidence_at,
    lastEvidenceAt: row.last_evidence_at,
  };
}

/**
 * Build a channel state from the flat `receptive_*` / `active_*` columns.
 * A channel with no evidence maps back to {@link EMPTY_KNOWLEDGE_STATE}, so
 * "never measured" survives the round trip instead of becoming a score of 0.
 */
function toChannel(
  score: number | null,
  confidence: number,
  evidenceWeight: number,
  successWeight: number,
  evidenceCount: number,
  lastEvidenceAt: string | null,
  sourceKinds: string[],
  firstSeenAt: string | null,
): KnowledgeState {
  if (evidenceCount === 0) return EMPTY_KNOWLEDGE_STATE;
  return {
    score: score === null ? null : Number(score),
    confidence: Number(confidence),
    evidenceWeight: Number(evidenceWeight),
    successWeight: Number(successWeight),
    evidenceCount,
    // Per-channel success/failure counts are not stored separately; the word row
    // keeps lifetime retrieval totals instead. Deriving them from the weights
    // would be a guess, so the channel reports the honest aggregate it has.
    successCount: 0,
    failureCount: 0,
    sourceKinds: sourceKinds ?? [],
    firstEvidenceAt: firstSeenAt,
    lastEvidenceAt,
  };
}

export function toSkillEntry(row: SkillStateRow): SkillStateEntry | null {
  if (!isSkillCode(row.skill_code)) return null;
  return { skillCode: row.skill_code, version: row.version, state: toState(row) };
}

export function toConceptEntry(row: ConceptStateRow): ConceptStateEntry | null {
  if (!isConceptCode(row.concept_code)) return null;
  return {
    conceptCode: row.concept_code,
    version: row.version,
    state: toState(row),
    lastSuccessAt: row.last_success_at,
    lastFailureAt: row.last_failure_at,
  };
}

export function toWordEntry(row: WordKnowledgeRow): WordKnowledgeEntry {
  return {
    wordId: row.word_id,
    version: row.version,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    lastSuccessAt: row.last_success_at,
    lastFailureAt: row.last_failure_at,
    exposureCount: row.exposure_count,
    successfulRetrievals: row.successful_retrievals,
    failedRetrievals: row.failed_retrievals,
    receptive: toChannel(
      row.receptive_score,
      row.receptive_confidence,
      row.receptive_evidence_weight,
      row.receptive_success_weight,
      row.receptive_evidence_count,
      row.receptive_last_at,
      row.source_kinds,
      row.first_seen_at,
    ),
    active: toChannel(
      row.active_score,
      row.active_confidence,
      row.active_evidence_weight,
      row.active_success_weight,
      row.active_evidence_count,
      row.active_last_at,
      row.source_kinds,
      row.first_seen_at,
    ),
    sourceKinds: row.source_kinds ?? [],
  };
}

/** Index a set of rows by their code, dropping anything the catalog lacks. */
export function skillEntries(
  rows: readonly SkillStateRow[] | null,
): Map<SkillCode, SkillStateEntry> {
  const map = new Map<SkillCode, SkillStateEntry>();
  for (const row of rows ?? []) {
    const entry = toSkillEntry(row);
    if (entry) map.set(entry.skillCode, entry);
  }
  return map;
}

export function conceptEntries(
  rows: readonly ConceptStateRow[] | null,
): Map<ConceptCode, ConceptStateEntry> {
  const map = new Map<ConceptCode, ConceptStateEntry>();
  for (const row of rows ?? []) {
    const entry = toConceptEntry(row);
    if (entry) map.set(entry.conceptCode, entry);
  }
  return map;
}

export function wordEntries(
  rows: readonly WordKnowledgeRow[] | null,
): Map<number, WordKnowledgeEntry> {
  return new Map((rows ?? []).map((row) => [row.word_id, toWordEntry(row)]));
}
