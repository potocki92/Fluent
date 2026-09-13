import { describe, expect, it } from "vitest";

import {
  completedDayStreak,
  isValidTimeZone,
  learningDateFor,
  localHour,
  normalizeTimeZone,
  previousDay,
} from "@/lib/learning/planner/learning-day";

describe("learningDateFor", () => {
  it("uses the learner's day, not the server's", () => {
    // 23:30 UTC on 13 September is already 14 September in Warsaw (UTC+2).
    // A plan keyed on `current_date` in a UTC database would hand this learner
    // yesterday's plan — and, because one plan per learning day is a unique
    // constraint, make today's impossible to create at all.
    const instant = new Date("2026-09-13T23:30:00Z");
    expect(learningDateFor("Europe/Warsaw", instant)).toBe("2026-09-14");
    expect(learningDateFor("UTC", instant)).toBe("2026-09-13");
  });

  it("works the other way across the boundary too", () => {
    // 00:30 UTC on 14 September is still 13 September in New York (UTC−4).
    const instant = new Date("2026-09-14T00:30:00Z");
    expect(learningDateFor("America/New_York", instant)).toBe("2026-09-13");
    expect(learningDateFor("UTC", instant)).toBe("2026-09-14");
  });

  it("handles a zone far ahead of UTC", () => {
    const instant = new Date("2026-09-13T20:00:00Z");
    expect(learningDateFor("Pacific/Auckland", instant)).toBe("2026-09-14");
  });

  it("falls back to UTC rather than throwing on an unusable zone", () => {
    const instant = new Date("2026-09-13T23:30:00Z");
    expect(learningDateFor("Mars/Olympus_Mons", instant)).toBe("2026-09-13");
  });

  it("formats as ISO, which is what the date column expects", () => {
    expect(learningDateFor("Europe/Warsaw", new Date("2026-01-05T12:00:00Z"))).toBe(
      "2026-01-05",
    );
  });
});

describe("timezone validation", () => {
  it("accepts real IANA zones", () => {
    expect(isValidTimeZone("Europe/Warsaw")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
  });

  it("rejects nonsense", () => {
    expect(isValidTimeZone("Mars/Olympus_Mons")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
  });

  it("normalises a missing or broken zone to the app default", () => {
    expect(normalizeTimeZone(null)).toBe("Europe/Warsaw");
    expect(normalizeTimeZone("nonsense")).toBe("Europe/Warsaw");
    expect(normalizeTimeZone("America/New_York")).toBe("America/New_York");
  });
});

describe("localHour", () => {
  it("reads the hour in the learner's zone", () => {
    const instant = new Date("2026-09-13T21:00:00Z");
    expect(localHour("Europe/Warsaw", instant)).toBe(23);
    expect(localHour("UTC", instant)).toBe(21);
  });

  it("reports midnight as 0, not 24", () => {
    expect(localHour("UTC", new Date("2026-09-13T00:15:00Z"))).toBe(0);
  });
});

describe("previousDay", () => {
  it("steps back across a month boundary", () => {
    expect(previousDay("2026-09-01")).toBe("2026-08-31");
  });

  it("steps back across a year boundary", () => {
    expect(previousDay("2026-01-01")).toBe("2025-12-31");
  });

  it("handles a leap day", () => {
    expect(previousDay("2028-03-01")).toBe("2028-02-29");
  });
});

describe("completedDayStreak", () => {
  it("counts consecutive completed days ending today", () => {
    expect(
      completedDayStreak(["2026-09-14", "2026-09-13", "2026-09-12"], "2026-09-14"),
    ).toBe(3);
  });

  it("counts from yesterday while today is still unfinished", () => {
    // A streak that appears to reset at midnight and un-reset at lunchtime
    // punishes people for not having started yet.
    expect(completedDayStreak(["2026-09-13", "2026-09-12"], "2026-09-14")).toBe(2);
  });

  it("breaks on a missed day", () => {
    expect(
      completedDayStreak(["2026-09-14", "2026-09-12", "2026-09-11"], "2026-09-14"),
    ).toBe(1);
  });

  it("is zero when the learner has been away", () => {
    expect(completedDayStreak(["2026-08-01"], "2026-09-14")).toBe(0);
  });

  it("is zero with no history at all", () => {
    expect(completedDayStreak([], "2026-09-14")).toBe(0);
  });
});
