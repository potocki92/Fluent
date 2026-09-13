/**
 * Folding evidence into the aggregated knowledge state.
 *
 * This is the bridge between {@link LearningEvidence} (what happened) and the
 * three state tables (what we now believe). It is deliberately pure: it takes a
 * snapshot of the rows as they were read, a batch of observations, and returns
 * both the next states and the exact JSON payload the database will be asked to
 * commit. No Supabase client, no clock of its own, no I/O — so the whole
 * knowledge pipeline can be tested without a database.
 *
 * WHY A BATCH. One finished test produces five observations that all land on the
 * same skill row. Folding them here, once, means the database sees a single
 * write per row rather than five read-modify-writes racing each other.
 *
 * WHY `expectedVersion` TRAVELS WITH THE PAYLOAD. The caller read these rows a
 * moment ago and computed from them. Sending the version it read lets
 * `apply_learning_evidence` refuse the write if anything moved in between,
 * instead of silently overwriting a concurrent update. That is the same
 * optimistic-concurrency guard `finalize_test_session` uses for the profile.
 */

import type { ConceptCode } from "@/lib/learning/concepts";
import type { LearningEvidence, SourceKind } from "@/lib/learning/evidence";
import {
  applyEvidence,
  EMPTY_KNOWLEDGE_STATE,
  KNOWLEDGE_MODEL_VERSION,
  type KnowledgeState,
} from "@/lib/learning/knowledge-model";
import type { SkillCode } from "@/lib/learning/skills";
import type { Json } from "@/types/database";

/** One `user_skill_state` row as the domain sees it. */
export interface SkillStateEntry {
  skillCode: SkillCode;
  version: number;
  state: KnowledgeState;
}

/** One `user_concept_state` row. Carries the last outcome timestamps the UI shows. */
export interface ConceptStateEntry {
  conceptCode: ConceptCode;
  version: number;
  state: KnowledgeState;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
}

/**
 * One `user_word_knowledge` row.
 *
 * The two channels are independent states, not two views of one number. Nothing
 * in this module ever copies evidence from one into the other.
 */
export interface WordKnowledgeEntry {
  wordId: number;
  version: number;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  exposureCount: number;
  successfulRetrievals: number;
  failedRetrievals: number;
  receptive: KnowledgeState;
  active: KnowledgeState;
  sourceKinds: readonly string[];
}

/** The rows a caller read before computing. Anything missing is treated as empty. */
export interface KnowledgeSnapshot {
  skills: ReadonlyMap<SkillCode, SkillStateEntry>;
  concepts: ReadonlyMap<ConceptCode, ConceptStateEntry>;
  words: ReadonlyMap<number, WordKnowledgeEntry>;
}

export const EMPTY_SNAPSHOT: KnowledgeSnapshot = {
  skills: new Map(),
  concepts: new Map(),
  words: new Map(),
};

/**
 * The jsonb envelope `apply_learning_evidence` unpacks. Snake_case because every
 * key maps straight onto a column; this is transport, never storage.
 */
export interface EvidencePayload {
  events: readonly Record<string, unknown>[];
  skills: readonly Record<string, unknown>[];
  concepts: readonly Record<string, unknown>[];
  words: readonly Record<string, unknown>[];
}

export const EMPTY_EVIDENCE_PAYLOAD: EvidencePayload = {
  events: [],
  skills: [],
  concepts: [],
  words: [],
};

/**
 * Hand the payload to an RPC parameter typed as `Json`.
 *
 * Every value in it is a string, number, boolean, null or an array of those — it
 * is JSON by construction — but TypeScript cannot see that through
 * `Record<string, unknown>`. The single cast lives here so no call site has to
 * repeat it, and so changing the payload shape breaks one place, not five.
 */
export function evidenceJson(payload: EvidencePayload): Json {
  return payload as unknown as Json;
}

/** The next states, plus the payload that persists them. */
export interface FoldResult {
  payload: EvidencePayload;
  skills: readonly SkillStateEntry[];
  concepts: readonly ConceptStateEntry[];
  words: readonly WordKnowledgeEntry[];
}

/**
 * Fold a batch of observations into the snapshot.
 *
 * Untagged evidence updates nothing it was not told about: an observation with
 * no `skillCode` moves no skill, one with no `conceptCodes` moves no concept,
 * and one with no `vocabularyChannel` moves no word knowledge. That is the rule
 * that keeps the model from inventing weaknesses — a wrong answer on an untagged
 * question is recorded as history and attributed to nothing, because we do not
 * know what went wrong.
 */
export function foldEvidence(
  snapshot: KnowledgeSnapshot,
  evidence: readonly LearningEvidence[],
): FoldResult {
  const skills = new Map<SkillCode, SkillStateEntry>(snapshot.skills);
  const concepts = new Map<ConceptCode, ConceptStateEntry>(snapshot.concepts);
  const words = new Map<number, WordKnowledgeEntry>(snapshot.words);

  // Versions must reflect what was READ, not what this fold produced, or a
  // second observation for the same row would send a version that never existed.
  const baseVersions = {
    skills: versionsOf(snapshot.skills),
    concepts: versionsOf(snapshot.concepts),
    words: versionsOf(snapshot.words),
  };

  const touched = {
    skills: new Set<SkillCode>(),
    concepts: new Set<ConceptCode>(),
    words: new Set<number>(),
  };

  for (const item of evidence) {
    const observation = {
      isCorrect: item.isCorrect,
      weight: item.weight,
      sourceKind: item.sourceKind,
      occurredAt: item.occurredAt,
    };

    if (item.skillCode) {
      const current =
        skills.get(item.skillCode) ??
        { skillCode: item.skillCode, version: 0, state: EMPTY_KNOWLEDGE_STATE };
      skills.set(item.skillCode, {
        ...current,
        state: applyEvidence(current.state, observation),
      });
      touched.skills.add(item.skillCode);
    }

    for (const conceptCode of item.conceptCodes) {
      const current =
        concepts.get(conceptCode) ??
        {
          conceptCode,
          version: 0,
          state: EMPTY_KNOWLEDGE_STATE,
          lastSuccessAt: null,
          lastFailureAt: null,
        };
      concepts.set(conceptCode, {
        ...current,
        state: applyEvidence(current.state, observation),
        lastSuccessAt: item.isCorrect ? item.occurredAt : current.lastSuccessAt,
        lastFailureAt: item.isCorrect ? current.lastFailureAt : item.occurredAt,
      });
      touched.concepts.add(conceptCode);
    }

    if (item.wordId !== null && item.vocabularyChannel !== null) {
      const current = words.get(item.wordId) ?? emptyWordEntry(item.wordId);
      const channel = item.vocabularyChannel;
      words.set(item.wordId, {
        ...current,
        firstSeenAt: current.firstSeenAt ?? item.occurredAt,
        lastSeenAt: item.occurredAt,
        lastSuccessAt: item.isCorrect ? item.occurredAt : current.lastSuccessAt,
        lastFailureAt: item.isCorrect ? current.lastFailureAt : item.occurredAt,
        exposureCount: current.exposureCount + 1,
        successfulRetrievals: current.successfulRetrievals + (item.isCorrect ? 1 : 0),
        failedRetrievals: current.failedRetrievals + (item.isCorrect ? 0 : 1),
        // Only the channel the exercise actually tested is touched.
        receptive:
          channel === "receptive"
            ? applyEvidence(current.receptive, observation)
            : current.receptive,
        active:
          channel === "active"
            ? applyEvidence(current.active, observation)
            : current.active,
        sourceKinds: withSource(current.sourceKinds, item.sourceKind),
      });
      touched.words.add(item.wordId);
    }
  }

  const nextSkills = [...touched.skills].map((code) => skills.get(code)!);
  const nextConcepts = [...touched.concepts].map((code) => concepts.get(code)!);
  const nextWords = [...touched.words].map((id) => words.get(id)!);

  return {
    skills: nextSkills,
    concepts: nextConcepts,
    words: nextWords,
    payload: {
      events: evidence.map(eventRow),
      skills: nextSkills.map((entry) =>
        skillRow(entry, baseVersions.skills.get(entry.skillCode) ?? 0),
      ),
      concepts: nextConcepts.map((entry) =>
        conceptRow(entry, baseVersions.concepts.get(entry.conceptCode) ?? 0),
      ),
      words: nextWords.map((entry) =>
        wordRow(entry, baseVersions.words.get(entry.wordId) ?? 0),
      ),
    },
  };
}

function emptyWordEntry(wordId: number): WordKnowledgeEntry {
  return {
    wordId,
    version: 0,
    firstSeenAt: null,
    lastSeenAt: null,
    lastSuccessAt: null,
    lastFailureAt: null,
    exposureCount: 0,
    successfulRetrievals: 0,
    failedRetrievals: 0,
    receptive: EMPTY_KNOWLEDGE_STATE,
    active: EMPTY_KNOWLEDGE_STATE,
    sourceKinds: [],
  };
}

function versionsOf<K, V extends { version: number }>(
  entries: ReadonlyMap<K, V>,
): Map<K, number> {
  return new Map([...entries].map(([key, value]) => [key, value.version]));
}

function withSource(
  sourceKinds: readonly string[],
  sourceKind: SourceKind,
): readonly string[] {
  return sourceKinds.includes(sourceKind) ? sourceKinds : [...sourceKinds, sourceKind];
}

function eventRow(item: LearningEvidence): Record<string, unknown> {
  return {
    event_key: item.eventKey,
    event_type: item.eventType,
    occurred_at: item.occurredAt,
    skill_code: item.skillCode,
    response_mode: item.responseMode,
    retrieval_type: item.retrievalType,
    is_correct: item.isCorrect,
    response_ms: item.responseMs,
    hints_used: item.hintsUsed,
    source_kind: item.sourceKind,
    origin: item.origin,
    text_id: item.textId,
    question_id: item.questionId,
    calibration_question_id: item.calibrationQuestionId,
    word_id: item.wordId,
    test_session_id: item.testSessionId,
    calibration_session_id: item.calibrationSessionId,
    concepts: item.conceptCodes,
  };
}

function stateColumns(state: KnowledgeState): Record<string, unknown> {
  return {
    score: state.score,
    confidence: state.confidence,
    evidence_weight: state.evidenceWeight,
    success_weight: state.successWeight,
    evidence_count: state.evidenceCount,
    successful_evidence: state.successCount,
    failed_evidence: state.failureCount,
    source_kinds: state.sourceKinds,
    first_evidence_at: state.firstEvidenceAt,
    last_evidence_at: state.lastEvidenceAt,
  };
}

function skillRow(entry: SkillStateEntry, expectedVersion: number) {
  return {
    skill_code: entry.skillCode,
    expected_version: expectedVersion,
    model_version: KNOWLEDGE_MODEL_VERSION,
    ...stateColumns(entry.state),
  };
}

function conceptRow(entry: ConceptStateEntry, expectedVersion: number) {
  return {
    concept_code: entry.conceptCode,
    expected_version: expectedVersion,
    model_version: KNOWLEDGE_MODEL_VERSION,
    last_success_at: entry.lastSuccessAt,
    last_failure_at: entry.lastFailureAt,
    ...stateColumns(entry.state),
  };
}

function channelColumns(state: KnowledgeState): Record<string, unknown> {
  return {
    score: state.score,
    confidence: state.confidence,
    evidence_weight: state.evidenceWeight,
    success_weight: state.successWeight,
    evidence_count: state.evidenceCount,
    last_evidence_at: state.lastEvidenceAt,
  };
}

function wordRow(entry: WordKnowledgeEntry, expectedVersion: number) {
  return {
    word_id: entry.wordId,
    expected_version: expectedVersion,
    model_version: KNOWLEDGE_MODEL_VERSION,
    first_seen_at: entry.firstSeenAt,
    last_seen_at: entry.lastSeenAt,
    last_success_at: entry.lastSuccessAt,
    last_failure_at: entry.lastFailureAt,
    exposure_count: entry.exposureCount,
    successful_retrievals: entry.successfulRetrievals,
    failed_retrievals: entry.failedRetrievals,
    receptive: channelColumns(entry.receptive),
    active: channelColumns(entry.active),
    source_kinds: entry.sourceKinds,
  };
}
