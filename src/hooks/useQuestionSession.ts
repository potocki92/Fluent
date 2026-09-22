"use client";

import { useCallback, useEffect, useReducer, useRef } from "react";

import { settleAction, type ActionResult } from "@/lib/errors";
import {
  initialSessionState,
  sessionReducer,
  storedIndex,
  type AnswerVerdict,
  type SessionState,
  type ShuffledOptions,
} from "@/lib/session/question-session";
import { shuffleWithOrder } from "@/lib/shuffle";

/**
 * The imperative shell around {@link sessionReducer}.
 *
 * Everything that is a real effect lives here and nowhere else: calling the
 * Server Actions, measuring response time, holding the reveal timer, cancelling
 * both on unmount. The reducer decides what the state becomes; this decides
 * when something is allowed to happen.
 *
 * Three guarantees it adds over the hand-rolled version in each runner:
 *
 *  1. **Every action is settled.** A rejected Server Action becomes a
 *     classified failure with Polish copy instead of an unhandled rejection
 *     that leaves `pending` true and the screen frozen.
 *  2. **Every timer is owned.** The reveal timeout is stored and cleared on
 *     unmount and on retry, so leaving mid-reveal cannot finalize a session the
 *     learner walked away from.
 *  3. **Every reply is checked for relevance.** Each call captures the
 *     generation it was issued under; the reducer drops replies from older
 *     ones, so a slow answer landing after a retry cannot paint its verdict
 *     over the new question.
 */

/** What a runner must supply. These are the parts that differ per domain. */
export interface QuestionSessionPorts<Q, S, A, R> {
  /** Open or resume the session. Must be idempotent — it is called on mount. */
  start: () => Promise<ActionResult<S>>;
  /** How to read the opened session. Keeps the port free of a fixed shape. */
  readStarted: (started: S) => {
    sessionId: string;
    questions: readonly Q[];
    resumeAt: number;
  };
  /** The displayable options of one question, before shuffling. */
  optionsOf: (question: Q) => string[];
  /** Post one answer. `selectedIdx` is the STORED index. */
  answer: (input: {
    sessionId: string;
    question: Q;
    selectedIdx: number;
    responseMs: number;
  }) => Promise<ActionResult<A>>;
  readVerdict: (answered: A) => AnswerVerdict;
  /** Seal the session. Must be idempotent — a retry re-runs it. */
  finalize: (sessionId: string) => Promise<ActionResult<R>>;
  /** Called once, after the session is sealed. Navigation and cache live here. */
  onFinalized?: (result: R, sessionId: string) => void;
  /**
   * A chance to handle a failure the domain treats as something other than an
   * error — a session finalized in another tab, say. Return `true` to say it is
   * handled and suppress the error state. The session id is passed in rather
   * than read off the state, so a runner's ports never have to close over the
   * state the hook is producing.
   */
  onAnswerFailure?: (
    failure: { code: string; message: string },
    sessionId: string,
  ) => boolean;
  /** How long the verdict stays on screen before moving on. */
  revealMs: number;
}

export interface QuestionSession<Q, R> {
  state: SessionState<Q, R>;
  /** Tap an option, by its DISPLAYED index. */
  choose: (displayedIdx: number) => void;
  /** Re-run whatever failed. Only meaningful while `state.retry !== null`. */
  retry: () => void;
}

export function useQuestionSession<Q, S, A, R>(
  ports: QuestionSessionPorts<Q, S, A, R>,
): QuestionSession<Q, R> {
  const [state, dispatch] = useReducer(
    sessionReducer<Q, R>,
    undefined,
    initialSessionState<Q, R>,
  );

  // Ports change identity on every render of the caller; reading them through a
  // ref keeps the effects below keyed on the session's own lifecycle rather
  // than on the caller's render count. Synced in an effect — declared FIRST, so
  // it commits before any effect below reads it — rather than during render,
  // which React 19 rightly refuses.
  const portsRef = useRef(ports);
  useEffect(() => {
    portsRef.current = ports;
  });

  // When the current question was first shown, for response time.
  const shownAt = useRef(0);
  // The reveal timer. Owned so it can be cancelled — the old code let it run.
  const revealTimer = useRef<number | null>(null);
  // Set on unmount so a reply that lands afterwards dispatches nothing.
  const alive = useRef(true);

  const clearReveal = useCallback(() => {
    if (revealTimer.current !== null) {
      window.clearTimeout(revealTimer.current);
      revealTimer.current = null;
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (revealTimer.current !== null) window.clearTimeout(revealTimer.current);
    };
  }, []);

  const runFinalize = useCallback(
    async (sessionId: string, generation: number) => {
      const result = await settleAction(
        () => portsRef.current.finalize(sessionId),
        `finalize ${sessionId}`,
      );
      if (!alive.current) return;
      if (!result.ok) {
        // Finalizing is idempotent server-side, so offering the retry is safe:
        // a second call returns the stored result rather than scoring twice.
        dispatch({
          type: "failed",
          generation,
          message: result.message,
          retry: "finalize",
        });
        return;
      }
      dispatch({ type: "finalized", generation, result });
      portsRef.current.onFinalized?.(result, sessionId);
    },
    [],
  );

  // Open (or resume) the session. Re-runs on `generation`, which is how a retry
  // starts over — including after an unmount/remount, since the effect's
  // cleanup marks everything in flight as stale.
  useEffect(() => {
    const generation = state.generation;
    if (state.phase !== "starting") return;

    void (async () => {
      const started = await settleAction(() => portsRef.current.start(), "start session");
      if (!alive.current) return;
      if (!started.ok) {
        dispatch({
          type: "failed",
          generation,
          message: started.message,
          retry: "start",
        });
        return;
      }

      const { sessionId, questions, resumeAt } = portsRef.current.readStarted(started);
      const shuffled: ShuffledOptions[] = questions.map((question) =>
        shuffleWithOrder(portsRef.current.optionsOf(question)),
      );
      dispatch({ type: "started", generation, sessionId, questions, shuffled, resumeAt });
    })();
  }, [state.phase, state.generation]);

  // Seal the session whenever the machine says it is time to — a finished run,
  // a resumed session that was already complete, or a retry of a failed
  // finalize. One place, so "finish it" cannot be forgotten on a path.
  useEffect(() => {
    if (state.phase !== "finishing" || !state.sessionId) return;
    void runFinalize(state.sessionId, state.generation);
  }, [state.phase, state.sessionId, state.generation, runFinalize]);

  // Restart the response clock whenever a new question appears.
  useEffect(() => {
    if (state.phase === "answering") shownAt.current = Date.now();
  }, [state.phase, state.index]);

  // Hold the verdict, then move on. The timer is owned by the ref above, so
  // unmounting during the reveal cancels it instead of finalizing a session the
  // learner has left.
  const { phase, index, generation, questions } = state;
  const total = questions.length;
  useEffect(() => {
    if (phase !== "feedback") return;
    const last = index === total - 1;

    revealTimer.current = window.setTimeout(() => {
      revealTimer.current = null;
      dispatch(last ? { type: "finalize", generation } : { type: "advance", generation });
    }, portsRef.current.revealMs);

    return clearReveal;
  }, [phase, index, total, generation, clearReveal]);

  const choose = useCallback(
    (displayedIdx: number) => {
      const { phase, sessionId, generation, questions, index } = state;
      if (phase !== "answering" || sessionId === null) return;

      const question = questions[index];
      const selectedIdx = storedIndex(state, displayedIdx);
      const responseMs = Date.now() - shownAt.current;

      dispatch({ type: "choose", generation, displayedIdx });

      void (async () => {
        const answered = await settleAction(
          () =>
            portsRef.current.answer({ sessionId, question, selectedIdx, responseMs }),
          `answer ${sessionId}`,
        );
        if (!alive.current) return;

        if (!answered.ok) {
          if (portsRef.current.onAnswerFailure?.(answered, sessionId)) return;
          // The item is untouched and the session is still open, so the way
          // back is to tap again — no retry button, no dead end.
          dispatch({
            type: "failed",
            generation,
            message: answered.message,
            retry: null,
            resumable: true,
          });
          return;
        }

        dispatch({
          type: "answered",
          generation,
          verdict: portsRef.current.readVerdict(answered),
        });
      })();
    },
    // Closes over the live state rather than reading a ref during render. The
    // identity changes each render, which costs nothing: `QuestionCard` is not
    // memoised, and the reducer refuses a `choose` from the wrong phase anyway.
    [state],
  );

  const retry = useCallback(() => {
    clearReveal();
    dispatch({ type: "retry" });
  }, [clearReveal]);

  return { state, choose, retry };
}
