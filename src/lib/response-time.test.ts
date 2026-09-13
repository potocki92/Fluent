import { describe, expect, it } from "vitest";

import { MAX_RESPONSE_MS, sanitizeResponseMs } from "@/lib/response-time";

describe("sanitizeResponseMs", () => {
  it("keeps a plausible measurement", () => {
    expect(sanitizeResponseMs(4200)).toBe(4200);
  });

  it("rounds to whole milliseconds", () => {
    expect(sanitizeResponseMs(4200.7)).toBe(4201);
  });

  it("drops a missing measurement", () => {
    expect(sanitizeResponseMs(undefined)).toBeNull();
    expect(sanitizeResponseMs(null)).toBeNull();
  });

  it("drops a negative value rather than storing nonsense", () => {
    // A client clock can run backwards, and a forged request can send anything.
    expect(sanitizeResponseMs(-1)).toBeNull();
  });

  it("drops non-finite values", () => {
    expect(sanitizeResponseMs(Number.NaN)).toBeNull();
    expect(sanitizeResponseMs(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("clamps an absurd value instead of discarding the answer", () => {
    // A tab left open for a day is still a real answer — just not a timed one.
    expect(sanitizeResponseMs(86_400_000)).toBe(MAX_RESPONSE_MS);
  });

  it("keeps zero, which is unusual but not impossible", () => {
    expect(sanitizeResponseMs(0)).toBe(0);
  });
});
