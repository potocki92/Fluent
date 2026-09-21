import { describe, expect, it } from "vitest";

import {
  PARALLAX_SETTLE_EPSILON,
  approach,
  pointerOffset,
  scrollProgress,
  settled,
} from "./parallax";

describe("pointerOffset", () => {
  it("maps the two edges and the middle of the box to -1, 0 and +1", () => {
    expect(pointerOffset(100, 100, 400)).toBe(-1);
    expect(pointerOffset(300, 100, 400)).toBe(0);
    expect(pointerOffset(500, 100, 400)).toBe(1);
  });

  it("clamps a pointer reported outside the box", () => {
    // A captured pointer keeps reporting after it leaves; an unclamped -3 here
    // would push a layer three times its declared travel and open an edge.
    expect(pointerOffset(-500, 100, 400)).toBe(-1);
    expect(pointerOffset(5000, 100, 400)).toBe(1);
  });

  it("answers 'centred' rather than NaN for a box with no size", () => {
    expect(pointerOffset(120, 0, 0)).toBe(0);
  });
});

describe("approach", () => {
  it("moves towards the target without overshooting it", () => {
    expect(approach(0, 1, 0.08)).toBeCloseTo(0.08, 10);
    expect(approach(1, 0, 0.08)).toBeCloseTo(0.92, 10);
  });

  it("converges on the target from either side", () => {
    let up = -1;
    let down = 1;
    for (let frame = 0; frame < 200; frame += 1) {
      up = approach(up, 0);
      down = approach(down, 0);
    }
    expect(Math.abs(up)).toBeLessThan(PARALLAX_SETTLE_EPSILON);
    expect(Math.abs(down)).toBeLessThan(PARALLAX_SETTLE_EPSILON);
  });

  it("stays put when it is already there", () => {
    expect(approach(0.5, 0.5)).toBe(0.5);
  });
});

describe("settled", () => {
  it("is false while the gap is still visible and true once it is not", () => {
    expect(settled(0, 1)).toBe(false);
    expect(settled(0, PARALLAX_SETTLE_EPSILON / 2)).toBe(true);
  });

  /**
   * The frame loop stops on this, so a case where it never becomes true is a
   * `requestAnimationFrame` running for the lifetime of the page.
   *
   * Two bounds, because they answer different questions. The first is what a
   * learner sees: from a full deflection, the scene is within a tenth of a
   * pixel of centre inside a second, which is what §11's "eases back" means.
   * The second is what the battery sees: the invisible tail that follows still
   * ends, and it ends in well under two seconds.
   */
  it("eases back to centre in under a second and parks shortly after", () => {
    let value = 1;
    let visiblyDone = 0;
    let frames = 0;

    while (!settled(value, 0) && frames < 600) {
      value = approach(value, 0);
      frames += 1;
      if (!visiblyDone && Math.abs(value) < 0.01) visiblyDone = frames;
    }

    expect(visiblyDone).toBeLessThanOrEqual(60);
    expect(settled(value, 0)).toBe(true);
    expect(frames).toBeLessThanOrEqual(120);
  });
});

describe("scrollProgress", () => {
  it("is 0 on an unscrolled page", () => {
    expect(scrollProgress(0, 200)).toBe(0);
  });

  /**
   * The bug this function was rewritten for. A phone hero rests 72px down the
   * page (56px of sticky header, 16px of padding) and is 148px tall, so it is
   * covered entirely by 164px of scroll. Driving the drift off the hero's
   * distance from the top of the viewport spent NOTHING over the first 72px
   * and better than a third of the travel after 164px, where it cannot be
   * seen. Measured from rest, every one of those first pixels moves the scene
   * and the travel is all but finished while the hero is still on screen.
   */
  it("starts moving on the first scrolled pixel", () => {
    expect(scrollProgress(1, 148)).toBeCloseTo(1 / 148, 10);
    expect(scrollProgress(36, 148)).toBeCloseTo(0.243, 3);
    expect(scrollProgress(72, 148)).toBeCloseTo(0.486, 3);
  });

  it("has spent the whole drift while a phone hero is still visible", () => {
    const HERO = 148;
    const COVERED_AT = 164; // sticky header (56) + padding (16) + hero height
    expect(scrollProgress(HERO, HERO)).toBe(1);
    expect(HERO).toBeLessThan(COVERED_AT);
  });

  it("never exceeds 1, however far the page is scrolled", () => {
    expect(scrollProgress(99999, 200)).toBe(1);
  });

  /** iOS rubber-banding reports a negative offset at the top of the page. */
  it("clamps an overscrolled page to 0 rather than driving the scene backwards", () => {
    expect(scrollProgress(-80, 200)).toBe(0);
  });

  it("answers 0 for a hero with no height", () => {
    expect(scrollProgress(50, 0)).toBe(0);
  });
});
