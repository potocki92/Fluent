import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Finalizing a weakness drill, end to end against a fake Supabase.
 *
 * WHY AT THIS LEVEL. `commit-evidence.test.ts` proves the helper refuses. What
 * it cannot prove is the thing that actually broke a learner's data: that the
 * refusal reaches the RPC — that `finalize_practice_session` is NOT called, so
 * the drill stays `in_progress` and the retry is a real retry rather than an
 * `already_finalized` no-op returning a stored result with nothing behind it.
 *
 * That ordering is invisible from either side alone, which is why this test
 * asserts on the calls the service-role client received, not on a return value.
 */

const mocks = vi.hoisted(() => ({
  createServer: vi.fn(),
  createService: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: mocks.createServer,
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceRoleSupabaseClient: mocks.createService,
}));

const { finalizePracticeSession } = await import("@/actions/finalize-practice-session");

const SESSION = "aaaaaaaa-1111-4111-8111-111111111111";
const USER = "bbbbbbbb-2222-4222-8222-222222222222";
const UNREACHABLE = { code: "08006", message: "connection failure" };

/** Which tables this run should answer with an error instead of rows. */
type Broken = string | null;

interface World {
  broken: Broken;
  /** Every table the action read, in order. */
  reads: string[];
  /** Every RPC the service role was asked to run. */
  commits: { name: string; args: Record<string, unknown> }[];
  /** True once the drill has been sealed, as the real table would record. */
  sealed: boolean;
}

const ROWS: Record<string, unknown[]> = {
  practice_sessions: [
    {
      id: SESSION,
      concept_code: "case_dative",
      status: "in_progress",
      correct: 2,
      total: 3,
    },
  ],
  practice_session_items: [
    {
      question_id: 10,
      is_correct: true,
      answered_at: "2026-03-01T10:00:00.000Z",
      response_ms: 3000,
    },
    {
      question_id: 11,
      is_correct: false,
      answered_at: "2026-03-01T10:01:00.000Z",
      response_ms: 9000,
    },
    {
      question_id: 12,
      is_correct: true,
      answered_at: "2026-03-01T10:02:00.000Z",
      response_ms: 5000,
    },
  ],
  questions_public: [
    { id: 10, text_id: 4, skill_code: "grammar", tested_word_id: null, concepts: ["case_dative"] },
    { id: 11, text_id: 4, skill_code: "grammar", tested_word_id: null, concepts: ["case_dative"] },
    { id: 12, text_id: 4, skill_code: "grammar", tested_word_id: 77, concepts: [] },
  ],
  user_skill_state: [],
  user_concept_state: [],
  user_word_knowledge: [],
};

function world(broken: Broken = null): World {
  const state: World = { broken, reads: [], commits: [], sealed: false };

  const table = (name: string) => {
    const result =
      name === state.broken
        ? { data: null, error: UNREACHABLE }
        : { data: ROWS[name] ?? [], error: null };

    const chain = {
      select: () => chain,
      eq: () => chain,
      in: () => chain,
      maybeSingle: async () => ({
        data: result.data ? ((result.data as unknown[])[0] ?? null) : null,
        error: result.error,
      }),
      then: (resolve: (value: typeof result) => unknown) =>
        Promise.resolve(result).then(resolve),
    };
    return chain;
  };

  const supabase = {
    auth: { getUser: async () => ({ data: { user: { id: USER } }, error: null }) },
    from(name: string) {
      state.reads.push(name);
      return table(name);
    },
  };

  const service = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      state.commits.push({ name, args });
      const alreadyFinalized = state.sealed;
      state.sealed = true;
      return {
        data: [
          {
            correct_count: 2,
            total_count: 3,
            already_finalized: alreadyFinalized,
          },
        ],
        error: null,
      };
    },
  };

  mocks.createServer.mockResolvedValue(supabase);
  mocks.createService.mockReturnValue(service);
  return state;
}

/** The payload as the RPC received it: `{ events, skills, concepts, words }`. */
function committedEvidence(state: World, index = 0) {
  return state.commits[index].args.p_evidence as {
    events: unknown[];
    skills: unknown[];
    concepts: unknown[];
    words: unknown[];
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("finalizePracticeSession", () => {
  it("seals the drill with the knowledge the answers proved", async () => {
    const state = world();

    const result = await finalizePracticeSession(SESSION);

    expect(result.ok).toBe(true);
    expect(state.commits).toHaveLength(1);
    const evidence = committedEvidence(state);
    expect(evidence.events).toHaveLength(3);
    expect(evidence.skills).toHaveLength(1);
    expect(evidence.concepts).toHaveLength(1);
    expect(evidence.words).toHaveLength(1);
  });

  it.each([
    ["the knowledge snapshot", "user_concept_state"],
    ["the item tags", "questions_public"],
  ])("does not seal the drill when %s cannot be read", async (_label, broken) => {
    const state = world(broken);

    const result = await finalizePracticeSession(SESSION);

    // THE REGRESSION, stated as the learner experiences it: the drill is not
    // finished, so it can be finished again. Before the fix this returned
    // `ok: true` with `p_evidence` an empty payload, and the three answers
    // never reached the knowledge model.
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("database_error");
    expect(state.commits).toEqual([]);
    expect(state.sealed).toBe(false);
  });

  it("applies the whole update on the retry that follows a failed read", async () => {
    const down = world("user_skill_state");
    expect((await finalizePracticeSession(SESSION)).ok).toBe(false);
    expect(down.sealed).toBe(false);

    // Same session id, same committed answers, database back: the retry is the
    // ENTIRE finalization, re-read and re-folded.
    const up = world();
    const result = await finalizePracticeSession(SESSION);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.alreadyFinalized).toBe(false);
    expect(committedEvidence(up).events).toHaveLength(3);
  });

  it("stays idempotent for a drill that really was already sealed", async () => {
    const state = world();
    await finalizePracticeSession(SESSION);
    const second = await finalizePracticeSession(SESSION);

    expect(second.ok).toBe(true);
    if (!second.ok) return;
    // Two taps, two tabs: the second commit is the RPC's own no-op, not a
    // second application of the same evidence.
    expect(second.alreadyFinalized).toBe(true);
    expect(state.commits).toHaveLength(2);
  });
});
