import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ActionResult } from "@/lib/errors";
import {
  loadTagsForEvidence,
  prepareEvidence,
  type PreparedEvidence,
} from "@/lib/learning/commit-evidence";
import { practiceAnswerEvidence, type LearningEvidence } from "@/lib/learning/evidence";
import type { Database } from "@/types/database";

/**
 * The guarantee this file holds: a commit either carries the knowledge update
 * it was supposed to carry, or it does not happen.
 *
 * The bug it pins down is not a crash. Every one of these paths used to
 * SUCCEED — session sealed, plan item moved, result shown to the learner — and
 * merely forget the five answers on the way. An assertion on "did it throw"
 * would have passed the whole time, so every test here asserts on the payload
 * that reaches the database instead.
 */

const SUPABASE_UNREACHABLE = { code: "08006", message: "connection failure" };

/** One answered drill item, as `finalizePracticeSession` would build it. */
function answer(questionId: number, isCorrect: boolean): LearningEvidence {
  return practiceAnswerEvidence({
    sessionId: "11111111-1111-4111-8111-111111111111",
    questionId,
    textId: null,
    skillCode: "grammar",
    conceptCodes: ["case_dative"],
    testedWordId: null,
    isCorrect,
    responseMs: 4_000,
    occurredAt: "2026-03-01T10:00:00.000Z",
  });
}

/**
 * The narrowest possible stand-in for the client `loadKnowledgeSnapshot` uses:
 * it answers the three `select…eq…in` reads and nothing else.
 */
function knowledgeClient(rows: {
  skills?: unknown[];
  concepts?: unknown[];
  words?: unknown[];
  failOn?: "user_skill_state" | "user_concept_state" | "user_word_knowledge";
}) {
  const reads: string[] = [];

  const builder = (table: string) => {
    const result =
      table === rows.failOn
        ? { data: null, error: SUPABASE_UNREACHABLE }
        : {
            data:
              table === "user_skill_state"
                ? (rows.skills ?? [])
                : table === "user_concept_state"
                  ? (rows.concepts ?? [])
                  : (rows.words ?? []),
            error: null,
          };

    const chain = {
      select: () => chain,
      eq: () => chain,
      in: () => chain,
      then: (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve),
    };
    return chain;
  };

  const client = {
    from(table: string) {
      reads.push(table);
      return builder(table);
    },
  };

  // One cast, here, with a reason: `loadKnowledgeSnapshot` calls exactly one
  // member of the client (`from`), and a double that satisfied the whole
  // `SupabaseClient` surface would be a hundred stubs that never run — and
  // would hide, rather than reveal, which reads this path actually performs.
  return { reads, client: client as unknown as SupabaseClient<Database> };
}

function expectPrepared(result: ActionResult<PreparedEvidence>): PreparedEvidence {
  if (!result.ok) throw new Error(`expected a prepared payload, got ${result.code}`);
  return result;
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("prepareEvidence", () => {
  it("folds the observations against the state it read", async () => {
    const { client } = knowledgeClient({});

    const prepared = expectPrepared(
      await prepareEvidence(client, "user-1", [answer(1, true), answer(2, false)], "ctx"),
    );

    expect(prepared.count).toBe(2);
    expect(prepared.payload.events).toHaveLength(2);
    // The two answers land on the one skill row and the one concept row rather
    // than racing each other — that is what the batch fold is for.
    expect(prepared.payload.skills).toHaveLength(1);
    expect(prepared.payload.concepts).toHaveLength(1);
  });

  it("commits an empty payload when there was genuinely nothing to record", async () => {
    const { client, reads } = knowledgeClient({});

    const prepared = expectPrepared(await prepareEvidence(client, "user-1", [], "ctx"));

    expect(prepared.count).toBe(0);
    expect(prepared.payload.events).toEqual([]);
    // An operation that proves nothing must not be punished with a database
    // round trip, and must not be refused either.
    expect(reads).toEqual([]);
  });

  it.each([
    ["user_skill_state" as const],
    ["user_concept_state" as const],
  ])("refuses to commit when %s cannot be read", async (failOn) => {
    const { client } = knowledgeClient({ failOn });

    const result = await prepareEvidence(client, "user-1", [answer(1, true)], "ctx");

    // THE REGRESSION. The old code turned this into `EMPTY_EVIDENCE_PAYLOAD`
    // and handed it to the finalize RPC, which sealed the session and applied
    // nothing — permanently, because the retry then short-circuits on
    // `already_finalized`.
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("database_error");
    expect(result.message).toBe("Coś poszło nie tak. Spróbuj ponownie za chwilę.");
  });

  it("carries the full update once the retry can read the state again", async () => {
    const evidence = [answer(1, true), answer(2, false)];

    const down = await prepareEvidence(
      knowledgeClient({ failOn: "user_concept_state" }).client,
      "user-1",
      evidence,
      "ctx",
    );
    expect(down.ok).toBe(false);

    // Nothing was consumed by the failed attempt: the answers are still
    // committed rows, so re-running the SAME finalization re-derives the whole
    // payload rather than a remainder.
    const recovered = expectPrepared(
      await prepareEvidence(knowledgeClient({}).client, "user-1", evidence, "ctx"),
    );
    expect(recovered.count).toBe(2);
    expect(recovered.payload.events).toHaveLength(2);
    expect(recovered.payload.skills).toHaveLength(1);
  });

  it("folds onto the version it read, so a concurrent write is refused rather than overwritten", async () => {
    const { client } = knowledgeClient({
      skills: [
        {
          skill_code: "grammar",
          version: 7,
          alpha: 3,
          beta: 2,
          observations: 5,
          last_evidence_at: "2026-02-01T00:00:00.000Z",
        },
      ],
    });

    const prepared = expectPrepared(
      await prepareEvidence(client, "user-1", [answer(1, true)], "ctx"),
    );

    expect(prepared.payload.skills[0]).toMatchObject({ expected_version: 7 });
  });
});

describe("loadTagsForEvidence", () => {
  it("passes the tags through when the read succeeds", async () => {
    const tags = new Map([[1, { skillCode: "grammar" }]]);

    const result = await loadTagsForEvidence(async () => tags, "ctx");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tags).toBe(tags);
  });

  it("refuses rather than reporting an item as untagged", async () => {
    const result = await loadTagsForEvidence(async () => {
      throw SUPABASE_UNREACHABLE;
    }, "ctx");

    // Untagged evidence moves no state, so "tags unavailable" degraded into
    // exactly the same silent loss as a missing snapshot.
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("database_error");
  });
});
