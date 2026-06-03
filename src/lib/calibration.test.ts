import { describe, expect, it } from "vitest";

import { calibrationSnapshot } from "./calibration";

describe("calibrationSnapshot", () => {
  it("sets a true beginner baseline without changing the answer count", () => {
    expect(calibrationSnapshot("green", 7)).toEqual({
      ability: 1000,
      rd: 350,
      answered: 7,
      cefrEstimate: "A1",
    });
  });
});
