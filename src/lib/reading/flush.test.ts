import { beforeEach, describe, expect, it, vi } from "vitest";

import { fail, type FluentFailure } from "@/lib/errors";
import {
  abandonFlush,
  initialFlushState,
  isStaleSession,
  runFlush,
  type FlushPorts,
  type FlushState,
  type ProgressReport,
} from "@/lib/reading/flush";
import type { ReadingAnchor, ReadingPositionState } from "@/lib/reading/position";
import { deferred } from "@/lib/testing/deferred";

/**
 * Writing reading progress, as the two things that can go wrong with it.
 *
 * Neither is a crash. A learner who reads a chapter for twenty minutes over a
 * patchy connection finds it recorded as four (seconds dropped on a failed
 * write), or finds it recorded as forty (seconds counted twice by a retry) —
 * and there is nothing on screen, then or later, to say which happened.
 *
 * So every test here asserts on the REPORTS that reached the transport: how
 * many, carrying which seconds, under which receipt.
 */

function anchor(paragraph: number): ReadingAnchor {
  return { paragraphPosition: paragraph, sentencePosition: null, tokenPosition: null };
}

function positionAt(offset: number): ReadingPositionState {
  return {
    current: anchor(offset),
    currentOffset: offset,
    resume: anchor(offset),
    resumeOffset: offset,
    furthest: anchor(offset),
    furthestOffset: offset,
    origin: anchor(0),
    originOffset: 0,
  };
}

interface Harness {
  ports: FlushPorts;
  state: FlushState;
  /** Every report the transport was asked to send, in order. */
  sent: { sessionId: string; report: ProgressReport }[];
  /** Seconds the clock currently holds. */
  clock: () => number;
  /** Add seconds to the clock, as reading would. */
  read: (seconds: number) => void;
  /** Move the learner. */
  moveTo: (offset: number) => void;
  /** The ratios pushed to the screen, in order. */
  applied: number[];
  reopens: number;
  sessionIds: string[];
}

function harness(
  respond: (
    report: ProgressReport,
    attempt: number,
  ) => Promise<{ ok: true; progressRatio: number } | FluentFailure> = async () => ({
    ok: true,
    progressRatio: 0.5,
  }),
  options: {
    reopen?: () => Promise<
      { ok: true; sessionId: string; progressRatio: number } | FluentFailure
    >;
  } = {},
): Harness {
  const sent: Harness["sent"] = [];
  const applied: number[] = [];
  const sessionIds: string[] = [];
  let seconds = 0;
  let offset = 0;
  let ids = 0;
  let reopens = 0;

  const ports: FlushPorts = {
    sample: () => positionAt(offset),
    takeSeconds: () => {
      const whole = Math.floor(seconds);
      seconds -= whole;
      return whole;
    },
    refundSeconds: (value) => {
      seconds += value;
    },
    send: (sessionId, report) => {
      sent.push({ sessionId, report });
      return respond(report, sent.filter((s) => s.report.reportId === report.reportId).length);
    },
    reopen:
      options.reopen ??
      (async () => {
        reopens += 1;
        return { ok: true, sessionId: `session-${reopens + 1}`, progressRatio: 0.4 };
      }),
    onAccepted: (ratio) => applied.push(ratio),
    onSessionChanged: (id) => sessionIds.push(id),
    now: () => 1_000,
    newReportId: () => `report-${(ids += 1)}`,
  };

  return {
    ports,
    state: initialFlushState("session-1"),
    sent,
    applied,
    sessionIds,
    clock: () => seconds,
    read: (value) => {
      seconds += value;
    },
    moveTo: (value) => {
      offset = value;
    },
    get reopens() {
      return reopens;
    },
  };
}

const UNREACHABLE: FluentFailure = {
  ok: false,
  code: "database_error",
  message: "Coś poszło nie tak. Spróbuj ponownie za chwilę.",
};

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("seconds survive a failed write", () => {
  it("keeps them inside the unconfirmed report", async () => {
    const h = harness(async () => UNREACHABLE);
    h.read(60);
    h.moveTo(10);

    const result = await runFlush(h.state, h.ports);

    expect(result.ok).toBe(false);
    // THE REGRESSION. `clock.drain()` ran before the request, so a failed
    // report took the minute with it — the clock no longer had it and no retry
    // carried it.
    expect(h.state.unconfirmed?.activeSeconds).toBe(60);
  });

  it("carries them, plus what accumulated since, on the retry", async () => {
    let down = true;
    const h = harness(async () => (down ? UNREACHABLE : { ok: true, progressRatio: 0.6 }));
    h.read(60);
    h.moveTo(10);
    await runFlush(h.state, h.ports);

    // The learner keeps reading while the connection is out.
    h.read(30);
    down = false;
    await runFlush(h.state, h.ports);

    // The retry is the SAME report: same seconds, same receipt. The 30 seconds
    // read since are still on the clock, for the next report to carry.
    expect(h.sent).toHaveLength(2);
    expect(h.sent[1].report.activeSeconds).toBe(60);
    expect(h.clock()).toBe(30);
    expect(h.state.unconfirmed).toBeNull();
  });

  it("retries under the SAME receipt, so the database can refuse a repeat", async () => {
    let attempts = 0;
    const h = harness(async () => {
      attempts += 1;
      return attempts === 1 ? UNREACHABLE : { ok: true, progressRatio: 0.6 };
    });
    h.read(45);
    await runFlush(h.state, h.ports);
    await runFlush(h.state, h.ports);

    // A request that REACHED the database and whose response was lost is
    // indistinguishable from one that never arrived. The receipt is what makes
    // sending it again safe rather than a second forty-five seconds.
    expect(h.sent[0].report.reportId).toBe(h.sent[1].report.reportId);
    expect(h.sent[0].report.seq).toBe(h.sent[1].report.seq);
  });

  it("reports seconds even when the learner has not moved", async () => {
    const h = harness();
    h.state.persisted = { resumeOffset: 0, furthestOffset: 0 };
    h.read(12);

    // Someone reading the same page slowly is still reading. Time alone is
    // worth a report; the caller's own interval decides how often to ask.
    await runFlush(h.state, h.ports);

    expect(h.sent).toHaveLength(1);
    expect(h.sent[0].report.activeSeconds).toBe(12);
  });

  it("gives the seconds back when it decides not to send after all", async () => {
    const h = harness();
    h.state.persisted = { resumeOffset: 0, furthestOffset: 0 };
    // A fraction of a second: the clock holds it, `takeSeconds` yields 0, and
    // there is genuinely nothing to report.
    h.read(0.4);

    await runFlush(h.state, h.ports);

    expect(h.sent).toHaveLength(0);
    expect(h.clock()).toBeCloseTo(0.4);
  });

  it("gives an abandoned report's seconds back to the clock", async () => {
    const h = harness(async () => UNREACHABLE);
    h.read(25);
    h.moveTo(5);
    await runFlush(h.state, h.ports);
    expect(h.clock()).toBe(0);

    // The reader is unmounting: this report will never be retried, so the time
    // belongs back where it was measured.
    abandonFlush(h.state, h.ports);
    expect(h.clock()).toBe(25);
    expect(h.state.unconfirmed).toBeNull();
  });
});

describe("one report at a time", () => {
  it("coalesces a flush that arrives while another is in flight", async () => {
    const blocked = deferred<{ ok: true; progressRatio: number }>();
    let first = true;
    const h = harness(async () => {
      if (first) {
        first = false;
        return blocked.promise;
      }
      return { ok: true, progressRatio: 0.7 };
    });
    h.read(10);
    h.moveTo(5);

    const inFlight = runFlush(h.state, h.ports);
    // The interval fires, and so does `pagehide`. Neither opens a second
    // request: two reports racing is how the resume bookmark ends up written
    // by whichever happened to finish second.
    await runFlush(h.state, h.ports);
    await runFlush(h.state, h.ports, { force: true });
    expect(h.sent).toHaveLength(1);

    h.read(5);
    h.moveTo(9);
    blocked.resolve({ ok: true, progressRatio: 0.7 });
    await inFlight;
    // Flushed once more for whatever arrived meanwhile, rather than twice.
    await Promise.resolve();

    expect(h.sent).toHaveLength(2);
    expect(h.sent[1].report.seq).toBeGreaterThan(h.sent[0].report.seq);
  });

  it("hands out a strictly increasing seq", async () => {
    const h = harness();
    h.read(1);
    h.moveTo(1);
    await runFlush(h.state, h.ports);
    h.read(1);
    h.moveTo(2);
    await runFlush(h.state, h.ports);
    h.read(1);
    h.moveTo(3);
    await runFlush(h.state, h.ports);

    expect(h.sent.map((s) => s.report.seq)).toEqual([1, 2, 3]);
  });
});

describe("a late result", () => {
  it("does not push the on-screen ratio backwards", async () => {
    const h = harness();
    h.read(1);
    h.moveTo(1);
    await runFlush(h.state, h.ports);
    expect(h.applied).toEqual([0.5]);

    // A reply for an OLDER report arriving after a newer one. Its seconds and
    // its furthest mark are committed; its ratio is history.
    h.state.appliedSeq = 9;
    h.read(1);
    h.moveTo(2);
    await runFlush(h.state, h.ports);

    expect(h.applied).toEqual([0.5]);
  });
});

describe("a sealed session", () => {
  it("is reopened and the SAME report is sent again", async () => {
    let sealed = true;
    const h = harness(async () => {
      if (sealed) {
        sealed = false;
        return fail("session_completed", "test");
      }
      return { ok: true, progressRatio: 0.8 };
    });
    h.read(20);
    h.moveTo(4);

    const result = await runFlush(h.state, h.ports);

    expect(result.ok).toBe(true);
    expect(h.sent).toHaveLength(2);
    expect(h.sent[0].sessionId).toBe("session-1");
    expect(h.sent[1].sessionId).toBe("session-2");
    // Unchanged, receipt included — so reopening cannot duplicate the twenty
    // seconds either.
    expect(h.sent[1].report).toEqual(h.sent[0].report);
    expect(h.sessionIds).toEqual(["session-2"]);
    expect(h.state.sessionId).toBe("session-2");
  });

  it("keeps the report for a later retry when the reopen itself fails", async () => {
    const h = harness(async () => fail("not_found", "test"), {
      reopen: async () => UNREACHABLE,
    });
    h.read(20);
    h.moveTo(4);

    const result = await runFlush(h.state, h.ports);

    expect(result.ok).toBe(false);
    expect(h.state.unconfirmed?.activeSeconds).toBe(20);
    expect(h.state.persisted).toBeNull();
  });

  it("does not reopen for a failure a new session cannot fix", async () => {
    const h = harness(async () => UNREACHABLE);
    h.read(5);
    h.moveTo(1);

    await runFlush(h.state, h.ports);

    // A refused position or a database error is not "your session is gone",
    // and retrying it into a fresh session would only hide it.
    expect(h.reopens).toBe(0);
    expect(h.sent).toHaveLength(1);
  });

  it("classifies exactly the two recoverable codes", () => {
    expect(isStaleSession("not_found")).toBe(true);
    expect(isStaleSession("session_completed")).toBe(true);
    expect(isStaleSession("database_error")).toBe(false);
    expect(isStaleSession("forbidden")).toBe(false);
    expect(isStaleSession("unauthorized")).toBe(false);
  });
});

describe("what is worth sending", () => {
  it("skips a flush with nothing new, and forces one anyway on demand", async () => {
    const h = harness();
    h.state.persisted = { resumeOffset: 0, furthestOffset: 0 };

    await runFlush(h.state, h.ports);
    expect(h.sent).toHaveLength(0);

    // `pagehide` forces: leaving is the one moment progress MUST be written,
    // even when nothing looks like it changed.
    await runFlush(h.state, h.ports, { force: true });
    expect(h.sent).toHaveLength(1);
  });

  it("does nothing at all without a session", async () => {
    const h = harness();
    h.state.sessionId = null;
    h.read(30);

    expect(await runFlush(h.state, h.ports)).toEqual({ ok: true });
    expect(h.sent).toHaveLength(0);
    // And the seconds are untouched, waiting for a session to report them.
    expect(h.clock()).toBe(30);
  });

  it("records what the server confirmed, and forgets it when one fails", async () => {
    let ok = true;
    const h = harness(async () =>
      ok ? { ok: true as const, progressRatio: 0.5 } : UNREACHABLE,
    );
    h.read(3);
    h.moveTo(7);
    await runFlush(h.state, h.ports);
    expect(h.state.persisted).toEqual({ resumeOffset: 7, furthestOffset: 7 });

    ok = false;
    h.read(3);
    h.moveTo(9);
    await runFlush(h.state, h.ports);
    // Nothing is assumed about what the server holds, so the next report
    // re-sends the position rather than believing one that never landed.
    expect(h.state.persisted).toBeNull();
  });
});
