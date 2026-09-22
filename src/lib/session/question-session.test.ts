import { describe, expect, it } from "vitest";

import {
  initialSessionState,
  isBusy,
  isLastQuestion,
  isSettled,
  sessionReducer,
  storedIndex,
  displayedIndex,
  type SessionEvent,
  type SessionState,
} from "@/lib/session/question-session";

/**
 * The session machine, as the sequence of things a learner does.
 *
 * Every test here names a failure the two hand-rolled runners actually had.
 * They were six `useState`s each, updated from three async callbacks, and the
 * bugs were all the same bug: nothing said which combinations were legal or
 * which reply still mattered.
 */

interface Q {
  questionId: number;
  options: string[];
}
interface R {
  correct: number;
  total: number;
}

type State = SessionState<Q, R>;

const QUESTIONS: Q[] = [
  { questionId: 10, options: ["a", "b", "c"] },
  { questionId: 11, options: ["d", "e", "f"] },
  { questionId: 12, options: ["g", "h", "i"] },
];

/** A deterministic shuffle: displayed 0,1,2 map to stored 2,0,1. */
const SHUFFLED = QUESTIONS.map(() => ({
  items: ["x", "y", "z"],
  order: [2, 0, 1],
}));

function run(events: SessionEvent<Q, R>[], from = initialSessionState<Q, R>()): State {
  return events.reduce(sessionReducer<Q, R>, from);
}

/** The state after the session has opened and question 0 is on screen. */
function opened(resumeAt = 0): State {
  return run([
    {
      type: "started",
      generation: 0,
      sessionId: "s-1",
      questions: QUESTIONS,
      shuffled: SHUFFLED,
      resumeAt,
    },
  ]);
}

describe("opening a session", () => {
  it("starts on the first unanswered question", () => {
    const state = opened(1);
    expect(state.phase).toBe("answering");
    expect(state.index).toBe(1);
    expect(state.sessionId).toBe("s-1");
  });

  it("goes straight to finishing when everything was already answered", () => {
    // A resumed session whose items are all answered never got sealed: the tab
    // closed, or the finalize failed. Showing a test with nothing left to
    // answer is the one outcome that helps nobody.
    const state = opened(3);
    expect(state.phase).toBe("finishing");
  });
});

describe("answering", () => {
  it("runs answer → verdict → next question", () => {
    const state = run(
      [
        { type: "choose", generation: 0, displayedIdx: 1 },
        {
          type: "answered",
          generation: 0,
          verdict: { isCorrect: true, correctIdx: 0 },
        },
        { type: "advance", generation: 0 },
      ],
      opened(),
    );

    expect(state.index).toBe(1);
    expect(state.phase).toBe("answering");
    // The next question starts clean — a verdict left over from the previous
    // one would paint the wrong option green.
    expect(state.selected).toBeNull();
    expect(state.feedback).toBeNull();
  });

  it("ignores a second tap while an answer is in flight", () => {
    const first = run([{ type: "choose", generation: 0, displayedIdx: 1 }], opened());
    const second = sessionReducer(first, {
      type: "choose",
      generation: 0,
      displayedIdx: 2,
    });

    // Two taps in one frame both used to pass `if (pending) return` — a state
    // read, not a lock. Here the phase IS the lock.
    expect(second).toBe(first);
    expect(second.selected).toBe(1);
  });

  it("ignores a tap during the verdict reveal", () => {
    const shown = run(
      [
        { type: "choose", generation: 0, displayedIdx: 0 },
        {
          type: "answered",
          generation: 0,
          verdict: { isCorrect: false, correctIdx: 2 },
        },
      ],
      opened(),
    );

    expect(sessionReducer(shown, { type: "choose", generation: 0, displayedIdx: 1 }))
      .toBe(shown);
  });

  it("maps displayed options to stored ones in both directions", () => {
    const state = opened();
    expect(storedIndex(state, 0)).toBe(2);
    expect(displayedIndex(state, 2)).toBe(0);
    expect(displayedIndex(state, storedIndex(state, 1))).toBe(1);
  });
});

describe("a reply that no longer matters", () => {
  it("drops a verdict issued under an older generation", () => {
    const retried = run([{ type: "retry" }], opened());
    expect(retried.generation).toBe(1);

    // THE REGRESSION. A slow answer from the abandoned attempt landing after a
    // retry used to call `setFeedback` and paint its verdict over the new
    // question.
    const late = sessionReducer(retried, {
      type: "answered",
      generation: 0,
      verdict: { isCorrect: true, correctIdx: 0 },
    });
    expect(late).toBe(retried);
    expect(late.feedback).toBeNull();
  });

  it("drops a failure issued under an older generation", () => {
    const retried = run([{ type: "retry" }], opened());
    const late = sessionReducer(retried, {
      type: "failed",
      generation: 0,
      message: "Coś poszło nie tak.",
      retry: "start",
    });

    // A stale failure must not tear down a session that has already restarted.
    expect(late.phase).not.toBe("failed");
    expect(late.error).toBeNull();
  });

  it("drops a stale reveal that would advance the new attempt", () => {
    const retried = run([{ type: "retry" }], opened());
    expect(sessionReducer(retried, { type: "advance", generation: 0 })).toBe(retried);
  });
});

describe("failing, and getting back", () => {
  it("lets the learner simply answer again after a failed answer", () => {
    const state = run(
      [
        { type: "choose", generation: 0, displayedIdx: 1 },
        {
          type: "failed",
          generation: 0,
          message: "Coś poszło nie tak. Spróbuj ponownie za chwilę.",
          retry: null,
          resumable: true,
        },
      ],
      opened(),
    );

    // The item is untouched and the session is still open, so the recovery is
    // the same tap again — not a dead end with a link home, which is all the
    // old runners offered.
    expect(state.phase).toBe("answering");
    expect(state.selected).toBeNull();
    expect(state.error).not.toBeNull();
    expect(state.index).toBe(0);
    expect(isBusy(state.phase)).toBe(false);
  });

  it("offers a retry of the start, and re-runs it cleanly", () => {
    const failed = run([
      { type: "failed", generation: 0, message: "Nie udało się.", retry: "start" },
    ]);
    expect(failed.phase).toBe("failed");
    expect(failed.retry).toBe("start");

    const again = sessionReducer(failed, { type: "retry" });
    expect(again.phase).toBe("starting");
    expect(again.error).toBeNull();
    expect(again.generation).toBe(failed.generation + 1);
  });

  it("offers a retry of the finalize, and keeps the session it is sealing", () => {
    const answered = run(
      [
        { type: "choose", generation: 0, displayedIdx: 0 },
        {
          type: "answered",
          generation: 0,
          verdict: { isCorrect: true, correctIdx: 2 },
        },
        { type: "finalize", generation: 0 },
        {
          type: "failed",
          generation: 0,
          message: "Coś poszło nie tak.",
          retry: "finalize",
        },
      ],
      opened(2),
    );
    expect(answered.phase).toBe("failed");

    const again = sessionReducer(answered, { type: "retry" });
    // Retrying the finalize must not throw the session away and start a new
    // test: finalizing is idempotent, so re-running it returns the stored
    // result — but only if we still know which session to ask about.
    expect(again.phase).toBe("finishing");
    expect(again.sessionId).toBe("s-1");
    expect(again.questions).toHaveLength(3);
    expect(again.generation).toBe(answered.generation + 1);
  });
});

describe("finishing", () => {
  it("seals once and stays sealed", () => {
    const finished = run(
      [
        { type: "finalize", generation: 0 },
        { type: "finalized", generation: 0, result: { correct: 2, total: 3 } },
      ],
      opened(2),
    );

    expect(finished.phase).toBe("finished");
    expect(finished.result).toEqual({ correct: 2, total: 3 });
    expect(isSettled(finished.phase)).toBe(true);

    // A second finalize — a retried request, another tab — changes nothing.
    expect(sessionReducer(finished, { type: "finalize", generation: 0 })).toBe(
      finished,
    );
  });

  it("does not start a second finalize while one is in flight", () => {
    const finishing = run([{ type: "finalize", generation: 0 }], opened(2));
    expect(sessionReducer(finishing, { type: "finalize", generation: 0 })).toBe(
      finishing,
    );
  });

  it("knows which question is the last one", () => {
    expect(isLastQuestion(opened(0))).toBe(false);
    expect(isLastQuestion(opened(2))).toBe(true);
  });
});

describe("what the screen may do", () => {
  it("disables the options exactly while the transport is busy", () => {
    expect(isBusy("starting")).toBe(true);
    expect(isBusy("submitting")).toBe(true);
    expect(isBusy("finishing")).toBe(true);
    expect(isBusy("answering")).toBe(false);
    // During the reveal the card disables itself from `result`, not from
    // `pending` — the spinner belongs to the option being submitted.
    expect(isBusy("feedback")).toBe(false);
  });
});
