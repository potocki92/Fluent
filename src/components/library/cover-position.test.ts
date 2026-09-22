import { describe, expect, it } from "vitest";

import { cn } from "@/lib/utils";

/**
 * `MaterialCover`'s box is `relative` by default, because a filled image needs
 * something to fill. The shelf's illustrated card — and „Kontynuuj naukę" on
 * Today, which is built the same way — overrides that to `absolute inset-0` so
 * the picture BECOMES the card, and the override works only because `cn` merges
 * Tailwind conflicts rather than concatenating them.
 *
 * That is a silent dependency: if the classes were ever concatenated instead,
 * `relative` would win the cascade, the image would collapse to nothing and the
 * card would render as a gradient over an empty box — with no error anywhere.
 * These three lines are what make that a failing test rather than a bug report.
 */
describe("the cover box's position can be overridden", () => {
  it("turns into a full-bleed surface when a caller asks", () => {
    const out = cn("relative block shrink-0 overflow-hidden", "absolute inset-0");
    expect(out).toContain("absolute");
    expect(out.split(" ")).not.toContain("relative");
  });

  it("stays a positioned box when nothing is passed", () => {
    expect(cn("relative block shrink-0 overflow-hidden", undefined).split(" ")).toContain(
      "relative",
    );
  });

  it("lets a panel re-base the scrim without redeclaring its stops", () => {
    // `.cover-scrim-panel` only moves `--cover-scrim-surface`; both classes have
    // to survive onto the element or „Kontynuuj naukę" renders its artwork with
    // the shelf's grey, a shade off every panel beside it. They are different
    // classes rather than variants of one, so `cn` must keep both.
    const out = cn("cover-scrim", "cover-scrim-panel absolute inset-0").split(" ");
    expect(out).toContain("cover-scrim");
    expect(out).toContain("cover-scrim-panel");
  });

  it("keeps the cover crop while letting its anchor move", () => {
    // Different Tailwind groups — object-fit and object-position — so the card
    // can anchor the crop to the left without losing `object-cover`.
    const out = cn("object-cover", "object-left");
    expect(out).toContain("object-cover");
    expect(out).toContain("object-left");
  });
});
