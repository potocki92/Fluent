/**
 * The mechanics a question session shares, as a reducer.
 *
 * WHAT IS SHARED AND WHAT IS NOT. A reading test and a weakness drill run the
 * same machine — open a session, show a question, post one answer, show the
 * verdict, move on, seal it — and have DIFFERENT consequences: a test moves Elo,
 * CEFR and the promotion gate; a drill moves concept knowledge and today's plan
 * and must never touch a learner's level, because somebody practising their
 * worst area should not watch their band drop for it. That difference lives in
 * the actions each runner injects, not here. This module knows about phases,
 * ordering and staleness; it knows nothing about what an answer MEANS.
 *
 * WHY IT IS A REDUCER RATHER THAN SIX `useState`s. The two runners were 250
 * lines each of `session`, `index`, `selected`, `feedback`, `pending`, `error`
 * — six independent pieces of state encoding one machine, updated from three
 * async callbacks. Every defect below followed from that:
 *
 *  1. **A rejected action froze the screen.** `await answerTestQuestion(…)` was
 *     never wrapped: an action that REJECTS (a dropped connection, a redacted
 *     production error) threw out of an async event handler, so `pending` stayed
 *     `true` for ever, every option stayed disabled, and the learner sat looking
 *     at a test that would not accept an answer. `settleAction` existed for
 *     exactly this and was not used.
 *  2. **A failure had no way back.** The only affordance on an error was "Wróć
 *     do nauki". One flaky request ended the test.
 *  3. **Timers outlived the screen.** `window.setTimeout(() => finalize(…))`
 *     kept no handle, so leaving during the 1.5s reveal still finalized a
 *     session the learner had walked away from, and still set state on an
 *     unmounted tree.
 *  4. **A late response spoke for a session that was over.** Nothing tied a
 *     response to the attempt that asked for it, so a slow answer landing after
 *     a retry painted its verdict over the new question.
 *
 * The phases are named after what is on screen, so an impossible combination —
 * feedback showing while an answer is in flight — cannot be represented.
 */

/** Where the session is. The name is what the learner is looking at. */
export type SessionPhase =
  | "starting"
  | "answering"
  | "submitting"
  | "feedback"
  | "finishing"
  | "finished"
  | "failed";

/** What a retry would re-run. `null` means the failure is not retryable here. */
export type RetryTarget = "start" | "finalize" | null;

/** The graded outcome of one question, in STORED option indices. */
export interface AnswerVerdict {
  isCorrect: boolean;
  correctIdx: number;
}

/** A question's options as displayed, plus the map back to stored indices. */
export interface ShuffledOptions {
  items: string[];
  /** `order[displayed]` is the stored index. */
  order: number[];
}

export interface SessionState<Q, R> {
  phase: SessionPhase;
  sessionId: string | null;
  questions: readonly Q[];
  shuffled: readonly ShuffledOptions[];
  /** Which question is on screen. */
  index: number;
  /** The displayed option the learner tapped, or null. */
  selected: number | null;
  feedback: AnswerVerdict | null;
  result: R | null;
  /** Polish copy from the error taxonomy. Never a Postgres message. */
  error: string | null;
  retry: RetryTarget;
  /**
   * Which attempt this state belongs to.
   *
   * Bumped by `start` and by `retry`. Every async reply carries the generation
   * it was issued under, and one from an older generation is DROPPED — that is
   * the whole of "ignore a response for a session that is no longer active",
   * expressed once instead of in three callbacks.
   */
  generation: number;
}

export type SessionEvent<Q, R> =
  | { type: "start" }
  | {
      type: "started";
      generation: number;
      sessionId: string;
      questions: readonly Q[];
      shuffled: readonly ShuffledOptions[];
      /** The first unanswered item. `>= questions.length` means "already done". */
      resumeAt: number;
    }
  | { type: "choose"; generation: number; displayedIdx: number }
  | { type: "answered"; generation: number; verdict: AnswerVerdict }
  | { type: "advance"; generation: number }
  | { type: "finalize"; generation: number }
  | { type: "finalized"; generation: number; result: R }
  | {
      type: "failed";
      generation: number;
      message: string;
      retry: RetryTarget;
      /** True when the learner may simply answer again (the item is untouched). */
      resumable?: boolean;
    }
  | { type: "retry" };

export function initialSessionState<Q, R>(): SessionState<Q, R> {
  return {
    phase: "starting",
    sessionId: null,
    questions: [],
    shuffled: [],
    index: 0,
    selected: null,
    feedback: null,
    result: null,
    error: null,
    retry: null,
    generation: 0,
  };
}

/** True while the transport is busy and the options must not accept a tap. */
export function isBusy(phase: SessionPhase): boolean {
  return phase === "starting" || phase === "submitting" || phase === "finishing";
}

/** True once nothing more will happen without the learner doing something. */
export function isSettled(phase: SessionPhase): boolean {
  return phase === "finished" || phase === "failed";
}

export function sessionReducer<Q, R>(
  state: SessionState<Q, R>,
  event: SessionEvent<Q, R>,
): SessionState<Q, R> {
  // A reply from a superseded attempt is not an error and not a state change:
  // it is an answer to a question nobody is asking any more.
  if ("generation" in event && event.generation !== state.generation) {
    return state;
  }

  switch (event.type) {
    case "start":
    case "retry":
      return {
        ...initialSessionState<Q, R>(),
        // Anything still in flight from the previous attempt is now stale.
        generation: state.generation + 1,
        // A retry of the finalize keeps the session it is finalizing.
        ...(event.type === "retry" && state.retry === "finalize"
          ? {
              phase: "finishing" as const,
              sessionId: state.sessionId,
              questions: state.questions,
              shuffled: state.shuffled,
              index: state.index,
            }
          : {}),
      };

    case "started": {
      const complete = event.resumeAt >= event.questions.length;
      return {
        ...state,
        // A resumed session with every item answered never got sealed — the tab
        // closed, or the finalize failed. Finish it rather than showing a test
        // with nothing left to answer.
        phase: complete ? "finishing" : "answering",
        sessionId: event.sessionId,
        questions: event.questions,
        shuffled: event.shuffled,
        index: complete ? event.questions.length : event.resumeAt,
        error: null,
        retry: null,
      };
    }

    case "choose":
      // Only from `answering`: a second tap during the reveal, or while an
      // answer is already in flight, is the same double-submit the old
      // `if (pending || feedback) return;` guard caught — expressed once.
      if (state.phase !== "answering") return state;
      return { ...state, phase: "submitting", selected: event.displayedIdx };

    case "answered":
      if (state.phase !== "submitting") return state;
      return { ...state, phase: "feedback", feedback: event.verdict };

    case "advance":
      if (state.phase !== "feedback") return state;
      return {
        ...state,
        phase: "answering",
        index: state.index + 1,
        selected: null,
        feedback: null,
      };

    case "finalize":
      if (state.phase === "finished" || state.phase === "finishing") return state;
      return { ...state, phase: "finishing", error: null };

    case "finalized":
      return { ...state, phase: "finished", result: event.result, error: null };

    case "failed":
      // A failed ANSWER leaves the item untouched and the session open, so the
      // way back is simply to tap again — clearing the selection is the whole
      // recovery. A failed start or finalize needs an explicit retry.
      if (event.resumable) {
        return {
          ...state,
          phase: "answering",
          selected: null,
          feedback: null,
          error: event.message,
          retry: null,
        };
      }
      return {
        ...state,
        phase: "failed",
        selected: null,
        error: event.message,
        retry: event.retry,
      };
  }
}

/** The stored option index behind a displayed one. */
export function storedIndex<Q, R>(
  state: SessionState<Q, R>,
  displayedIdx: number,
): number {
  return state.shuffled[state.index].order[displayedIdx];
}

/** The displayed position of a stored index, for painting the correct answer. */
export function displayedIndex<Q, R>(
  state: SessionState<Q, R>,
  stored: number,
): number {
  return state.shuffled[state.index].order.indexOf(stored);
}

/** True when the question on screen is the last one. */
export function isLastQuestion<Q, R>(state: SessionState<Q, R>): boolean {
  return state.index === state.questions.length - 1;
}
