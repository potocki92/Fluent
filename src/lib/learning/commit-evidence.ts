/**
 * Preparing the evidence payload a commit will carry — or refusing to commit.
 *
 * WHAT WAS WRONG HERE. Every write that closes a learning loop (a sealed test,
 * a finished drill, a graded card, a completed preparation) used to read the
 * learner's knowledge like this:
 *
 * ```ts
 * const snapshot = await loadKnowledgeSnapshot(...).catch(() => null);
 * const folded = snapshot ? foldEvidence(snapshot, evidence) : null;
 * await service.rpc("finalize_…", {
 *   p_evidence: evidenceJson(folded?.payload ?? EMPTY_EVIDENCE_PAYLOAD),
 * });
 * ```
 *
 * The comment above each `catch` said "reported, never swallowed" — and the log
 * line was real — but the next three lines swallowed it anyway. A failed read
 * became `null`, `null` became an EMPTY payload, and an empty payload is a
 * perfectly valid argument: the RPC sealed the session, marked the plan item
 * done and applied no knowledge at all. The session is now `completed`, so the
 * retry that would have fixed it returns `already_finalized: true` and applies
 * nothing either. The five answers the learner just gave are gone from the
 * knowledge model for good, and the only trace is a console line.
 *
 * THE RULE THIS MODULE ENFORCES. An empty payload is sent when, and only when,
 * there was genuinely nothing to record. If evidence exists but the state it
 * must be folded against cannot be read, nothing is committed and the caller
 * returns a failure. The session stays `in_progress`, so the SAME finalization
 * can simply be run again — the whole read→compute→commit, against fresh data.
 * That is the safe retry: the work is re-derived from the committed answers,
 * which are already durable, rather than half-applied from a stale read.
 *
 * WHAT IT DOES NOT DO. It does not reject operations that legitimately produce
 * no evidence. Grading a notebook sentence carries no word, a lookup carries no
 * concept, a preparation with nothing to pre-teach carries nothing at all —
 * those commit with an empty payload and always did. `count === 0` is a normal
 * outcome, not a degraded one.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { fail, type ActionResult } from "@/lib/errors";
import {
  EMPTY_EVIDENCE_PAYLOAD,
  evidenceJson,
  foldEvidence,
  type EvidencePayload,
} from "@/lib/learning/aggregate";
import type { LearningEvidence } from "@/lib/learning/evidence";
import { loadKnowledgeSnapshot } from "@/lib/learning/snapshot";
import type { Database, Json } from "@/types/database";

type Client = SupabaseClient<Database>;

/** Everything a commit needs to hand its RPC, and nothing the RPC cannot take. */
export interface PreparedEvidence {
  payload: EvidencePayload;
  /** The same payload as the RPC parameter type. Saves every caller a cast. */
  json: Json;
  /**
   * How many observations this commit carries. Zero is legitimate — it means
   * the operation genuinely proved nothing about the learner's knowledge.
   */
  count: number;
}

/** The "nothing happened, and that is fine" result. */
const NOTHING_TO_RECORD: PreparedEvidence = {
  payload: EMPTY_EVIDENCE_PAYLOAD,
  json: evidenceJson(EMPTY_EVIDENCE_PAYLOAD),
  count: 0,
};

/**
 * Read the state this evidence touches and fold it, or fail loudly.
 *
 * Runs on the learner's own cookie-bound client: RLS still scopes every row
 * read here to them, exactly as {@link loadKnowledgeSnapshot} requires.
 *
 * @param context A log prefix — never shown to the learner.
 */
export async function prepareEvidence(
  supabase: Client,
  userId: string,
  evidence: readonly LearningEvidence[],
  context: string,
): Promise<ActionResult<PreparedEvidence>> {
  if (evidence.length === 0) return { ok: true, ...NOTHING_TO_RECORD };

  let snapshot;
  try {
    snapshot = await loadKnowledgeSnapshot(supabase, userId, evidence);
  } catch (error) {
    // The one place the old `?? EMPTY_EVIDENCE_PAYLOAD` used to be reached.
    // Refusing here is what makes the retry safe: the answers are committed,
    // the session is not sealed, and running the finalization again re-reads
    // and re-folds from scratch.
    return fail(
      "database_error",
      `${context}: knowledge snapshot unavailable, refusing to commit ${evidence.length} observation(s) as empty`,
      error,
    );
  }

  const folded = foldEvidence(snapshot, evidence);
  return {
    ok: true,
    payload: folded.payload,
    json: evidenceJson(folded.payload),
    count: evidence.length,
  };
}

/**
 * The same guarantee for the OTHER read every evidence build depends on: the
 * tags that say what an item exercises.
 *
 * Losing them is quieter than losing the snapshot and just as damaging. An
 * answer with no `skillCode`, no concepts and no tested word is, to
 * {@link foldEvidence}, an answer that proves nothing — so a failed tag read
 * used to seal the session with a payload full of observations that moved no
 * state. Same shape of loss, same fix: surface it and let the caller refuse.
 */
export async function loadTagsForEvidence<T>(
  load: () => Promise<T>,
  context: string,
): Promise<ActionResult<{ tags: T }>> {
  try {
    return { ok: true, tags: await load() };
  } catch (error) {
    return fail("database_error", `${context}: item tags unavailable`, error);
  }
}
