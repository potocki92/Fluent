import { describe, expect, it } from "vitest";

import { CONTENT_PROCESSOR_VERSION } from "@/lib/content/version";
import { fitsLimit, isNoteStale, normalizeNoteText } from "@/lib/notebook/notes";

describe("normalizeNoteText", () => {
  it("treats whitespace as nothing at all", () => {
    expect(normalizeNoteText("   ")).toBeNull();
    expect(normalizeNoteText("\n\t ")).toBeNull();
    expect(normalizeNoteText("")).toBeNull();
    expect(normalizeNoteText(null)).toBeNull();
    expect(normalizeNoteText(undefined)).toBeNull();
  });

  it("keeps the text, trimmed", () => {
    expect(normalizeNoteText("  Powinniśmy zawrócić.  ")).toBe("Powinniśmy zawrócić.");
  });
});

describe("fitsLimit", () => {
  it("measures code points, not UTF-16 units", () => {
    expect(fitsLimit("ąęółśżźćń", 9)).toBe(true);
    expect(fitsLimit("ąęółśżźćń", 8)).toBe(false);
  });

  it("lets an empty note through — it will simply not be saved", () => {
    expect(fitsLimit("   ", 1)).toBe(true);
  });
});

describe("isNoteStale", () => {
  const snapshot = "Wir sollten umkehren.";

  it("is not stale when the text still matches", () => {
    expect(
      isNoteStale({
        snapshot,
        contentVersion: CONTENT_PROCESSOR_VERSION,
        liveText: snapshot,
      }),
    ).toBe(false);
  });

  it("is stale when the sentence at the anchor now reads differently", () => {
    expect(
      isNoteStale({
        snapshot,
        contentVersion: CONTENT_PROCESSOR_VERSION,
        liveText: "Wir sollten umkehren, drängte Gared.",
      }),
    ).toBe(true);
  });

  it("is stale when a different processor produced the current text", () => {
    expect(
      isNoteStale({ snapshot, contentVersion: "content_v0", liveText: snapshot }),
    ).toBe(true);
  });

  it("is not stale merely because the chapter is gone", () => {
    // A note in the notebook whose book was deleted still says what it said; it
    // is unreachable, not wrong.
    expect(
      isNoteStale({
        snapshot,
        contentVersion: CONTENT_PROCESSOR_VERSION,
        liveText: null,
      }),
    ).toBe(false);
  });
});
