import { describe, expect, it } from "vitest";

import { shuffleWithOrder } from "./shuffle";

describe("shuffleWithOrder", () => {
  it("returns order as a permutation of 0..n-1", () => {
    const { order } = shuffleWithOrder(["a", "b", "c", "d"]);
    expect([...order].sort((x, y) => x - y)).toEqual([0, 1, 2, 3]);
  });

  it("shuffled items map back to the original via order", () => {
    const input = ["a", "b", "c", "d"];
    const { items, order } = shuffleWithOrder(input);
    // items[displayedIdx] is the original item at order[displayedIdx]
    items.forEach((item, displayedIdx) => {
      expect(item).toBe(input[order[displayedIdx]]);
    });
  });

  it("displayed↔original index mapping is consistent in both directions", () => {
    const input = ["a", "b", "c", "d"];
    const { order } = shuffleWithOrder(input);
    // For every displayed index, mapping to original and back returns it.
    order.forEach((originalIdx, displayedIdx) => {
      expect(order.indexOf(originalIdx)).toBe(displayedIdx);
    });
  });

  it("handles empty and single-element arrays", () => {
    expect(shuffleWithOrder([])).toEqual({ items: [], order: [] });
    expect(shuffleWithOrder(["only"])).toEqual({ items: ["only"], order: [0] });
  });
});
