/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ActionResult } from "@/lib/errors";
import { useQuestionSession } from "@/hooks/useQuestionSession";
import { deferred } from "@/lib/testing/deferred";
import { renderHook, settle } from "@/lib/testing/render-hook";

/**
 * The parts of a session the reducer cannot hold: effects, timers and cleanup.
 *
 * `question-session.test.ts` proves what each event does to the state. What it
 * cannot prove is the half that actually broke: that a REJECTED Server Action
 * does not freeze the screen, that the reveal timer is cancelled when the
 * learner leaves, and that a reply arriving after unmount does not set state on
 * a tree that is gone. All three need a real render.
 */

interface Q {
  questionId: number;
  options: string[];
}
interface S {
  sessionId: string;
  questions: Q[];
  resumeAt: number;
}
interface A {
  isCorrect: boolean;
  correctIdx: number;
}
interface R {
  correct: number;
  total: number;
}

const QUESTIONS: Q[] = [
  { questionId: 1, options: ["a", "b"] },
  { questionId: 2, options: ["c", "d"] },
];

const REVEAL_MS = 1500;

/** A recording set of ports, with each call individually controllable. */
function ports(overrides: Partial<Parameters<typeof useQuestionSession<Q, S, A, R>>[0]> = {}) {
  const calls = { start: 0, answer: 0, finalize: 0, finalized: 0 };

  return {
    calls,
    value: {
      start: async (): Promise<ActionResult<S>> => {
        calls.start += 1;
        return { ok: true, sessionId: "s-1", questions: QUESTIONS, resumeAt: 0 };
      },
      readStarted: (started: S) => ({
        sessionId: started.sessionId,
        questions: started.questions,
        resumeAt: started.resumeAt,
      }),
      optionsOf: (question: Q) => question.options,
      answer: async (): Promise<ActionResult<A>> => {
        calls.answer += 1;
        return { ok: true, isCorrect: true, correctIdx: 0 };
      },
      readVerdict: (answered: A) => ({
        isCorrect: answered.isCorrect,
        correctIdx: answered.correctIdx,
      }),
      finalize: async (): Promise<ActionResult<R>> => {
        calls.finalize += 1;
        return { ok: true, correct: 2, total: 2 };
      },
      onFinalized: () => {
        calls.finalized += 1;
      },
      revealMs: REVEAL_MS,
      ...overrides,
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("a transport that rejects", () => {
  it("does not leave the screen stuck on a spinner", async () => {
    const p = ports({
      start: async () => {
        throw new Error("network down");
      },
    });
    const harness = renderHook(() => useQuestionSession<Q, S, A, R>(p.value));
    await settle();

    // THE REGRESSION. `await startTestSession(…)` was unwrapped, so a rejected
    // action threw out of the effect and the screen sat on "Przygotowujemy
    // test…" for ever, with no error and no way back.
    expect(harness.current.state.phase).toBe("failed");
    expect(harness.current.state.error).toBe(
      "Coś poszło nie tak. Spróbuj ponownie za chwilę.",
    );
    expect(harness.current.state.retry).toBe("start");
    harness.unmount();
  });

  it("does not leave the options disabled when an ANSWER rejects", async () => {
    const p = ports({
      answer: async () => {
        throw new Error("network down");
      },
    });
    const harness = renderHook(() => useQuestionSession<Q, S, A, R>(p.value));
    await settle();

    act(() => harness.current.choose(0));
    await settle();

    // `pending` used to stay true here: every option disabled, no message, a
    // test that would not accept an answer.
    expect(harness.current.state.phase).toBe("answering");
    expect(harness.current.state.selected).toBeNull();
    expect(harness.current.state.error).not.toBeNull();
    harness.unmount();
  });

  it("retries the start on demand, and succeeds", async () => {
    let failNext = true;
    const p = ports({
      start: async (): Promise<ActionResult<S>> => {
        if (failNext) {
          failNext = false;
          throw new Error("network down");
        }
        return { ok: true, sessionId: "s-1", questions: QUESTIONS, resumeAt: 0 };
      },
    });
    const harness = renderHook(() => useQuestionSession<Q, S, A, R>(p.value));
    await settle();
    expect(harness.current.state.phase).toBe("failed");

    act(() => harness.current.retry());
    await settle();

    expect(harness.current.state.phase).toBe("answering");
    expect(harness.current.state.error).toBeNull();
    expect(harness.current.state.questions).toHaveLength(2);
    harness.unmount();
  });
});

describe("timers", () => {
  it("advances to the next question after the reveal", async () => {
    const p = ports();
    const harness = renderHook(() => useQuestionSession<Q, S, A, R>(p.value));
    await settle();

    act(() => harness.current.choose(0));
    await settle();
    expect(harness.current.state.phase).toBe("feedback");

    await act(async () => {
      vi.advanceTimersByTime(REVEAL_MS);
    });
    expect(harness.current.state.phase).toBe("answering");
    expect(harness.current.state.index).toBe(1);
    harness.unmount();
  });

  it("does not finalize a session the learner walked away from", async () => {
    const p = ports();
    const harness = renderHook(() => useQuestionSession<Q, S, A, R>(p.value));
    await settle();

    // Answer the last question, so the pending reveal ends in a finalize.
    act(() => harness.current.choose(0));
    await settle();
    await act(async () => {
      vi.advanceTimersByTime(REVEAL_MS);
    });
    act(() => harness.current.choose(0));
    await settle();
    expect(harness.current.state.phase).toBe("feedback");

    // THE REGRESSION. `window.setTimeout(() => void finalize(…))` kept no
    // handle, so leaving during the 1.5s reveal still sealed the session — and
    // still set state on an unmounted tree.
    harness.unmount();
    await act(async () => {
      vi.advanceTimersByTime(REVEAL_MS * 4);
    });

    expect(p.calls.finalize).toBe(0);
    expect(p.calls.finalized).toBe(0);
  });

  it("cancels a pending reveal when the session is retried", async () => {
    const p = ports();
    const harness = renderHook(() => useQuestionSession<Q, S, A, R>(p.value));
    await settle();

    act(() => harness.current.choose(0));
    await settle();
    act(() => harness.current.retry());
    await settle();

    await act(async () => {
      vi.advanceTimersByTime(REVEAL_MS * 4);
    });

    // The reveal belonged to the abandoned attempt: it must not advance the
    // fresh one past its first question.
    expect(harness.current.state.index).toBe(0);
    harness.unmount();
  });
});

describe("a reply that arrives too late", () => {
  it("is ignored once the hook has unmounted", async () => {
    const blocked = deferred<ActionResult<A>>();
    const p = ports({ answer: () => blocked.promise });
    const harness = renderHook(() => useQuestionSession<Q, S, A, R>(p.value));
    await settle();

    act(() => harness.current.choose(0));
    expect(harness.current.state.phase).toBe("submitting");

    const rendersAtUnmount = harness.renders;
    harness.unmount();

    // Resolving after unmount must dispatch nothing at all. A render count
    // that did not move is the direct evidence: React 18 stopped warning about
    // a state update on an unmounted tree, so an assertion on the console
    // would prove nothing either way.
    blocked.resolve({ ok: true, isCorrect: true, correctIdx: 0 });
    await act(async () => {
      await Promise.resolve();
    });

    expect(harness.renders).toBe(rendersAtUnmount);
  });

  it("is ignored when it belongs to a superseded attempt", async () => {
    const blocked = deferred<ActionResult<A>>();
    let useBlocked = true;
    const p = ports({
      answer: async (): Promise<ActionResult<A>> => {
        if (useBlocked) {
          useBlocked = false;
          return blocked.promise;
        }
        return { ok: true, isCorrect: false, correctIdx: 1 };
      },
    });
    const harness = renderHook(() => useQuestionSession<Q, S, A, R>(p.value));
    await settle();

    act(() => harness.current.choose(0));
    act(() => harness.current.retry());
    await settle();

    // The abandoned attempt's answer lands now.
    blocked.resolve({ ok: true, isCorrect: true, correctIdx: 0 });
    await settle();

    // It must not paint a verdict over the question the learner is now looking
    // at — which is exactly what `setFeedback` did, unconditionally.
    expect(harness.current.state.phase).toBe("answering");
    expect(harness.current.state.feedback).toBeNull();
    harness.unmount();
  });
});

describe("finishing", () => {
  it("seals a resumed session that was already complete", async () => {
    const p = ports({
      start: async (): Promise<ActionResult<S>> => ({
        ok: true,
        sessionId: "s-1",
        questions: QUESTIONS,
        resumeAt: QUESTIONS.length,
      }),
    });
    const harness = renderHook(() => useQuestionSession<Q, S, A, R>(p.value));
    await settle();

    expect(p.calls.finalize).toBe(1);
    expect(harness.current.state.phase).toBe("finished");
    expect(harness.current.state.result).toMatchObject({ correct: 2, total: 2 });
    harness.unmount();
  });

  it("retries a failed finalize against the same session", async () => {
    let failNext = true;
    let starts = 0;
    const p = ports({
      start: async (): Promise<ActionResult<S>> => {
        starts += 1;
        return {
          ok: true,
          sessionId: "s-1",
          questions: QUESTIONS,
          resumeAt: QUESTIONS.length,
        };
      },
      finalize: async (): Promise<ActionResult<R>> => {
        if (failNext) {
          failNext = false;
          throw new Error("network down");
        }
        return { ok: true, correct: 2, total: 2 };
      },
    });
    const harness = renderHook(() => useQuestionSession<Q, S, A, R>(p.value));
    await settle();
    expect(harness.current.state.phase).toBe("failed");
    expect(harness.current.state.retry).toBe("finalize");

    act(() => harness.current.retry());
    await settle();

    // Finalizing is idempotent, so the retry returns the stored result rather
    // than scoring twice — and it must be the SAME session, not a new test.
    expect(harness.current.state.phase).toBe("finished");
    expect(harness.current.state.sessionId).toBe("s-1");
    expect(starts).toBe(1);
    harness.unmount();
  });

  it("opens the session exactly once per attempt", async () => {
    const p = ports();
    const harness = renderHook(() => useQuestionSession<Q, S, A, R>(p.value));
    await settle();
    harness.rerender();
    harness.rerender();
    await settle();

    // The ports object is rebuilt on every render of the caller; the hook must
    // key its effects on the session's lifecycle, not on that.
    expect(p.calls.start).toBe(1);
    harness.unmount();
  });
});
