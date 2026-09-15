import { describe, expect, it } from "vitest";

import { detectChapters } from "@/lib/import/chapters/detect";
import { dominantShape, headingShape } from "@/lib/import/chapters/structural";
import type { CleanBlock } from "@/lib/import/cleanup";

/**
 * Two things have to be true of a chapter detector, and they pull against each
 * other: it must find the chapters a book announces however it announces them,
 * and it must not cut a book at every short line. Every test here is one or the
 * other, and the named-chapter cases are the ones that justify the whole
 * structural-pattern apparatus.
 */

/**
 * A paragraph of body text.
 *
 * Long enough never to be mistaken for a heading, and — deliberately — longer
 * than `CHAPTER_MIN_WORDS`, so that a chapter built from one of these is judged
 * on its heading's score rather than flagged for being suspiciously short.
 */
function body(page = 1): CleanBlock {
  return {
    text:
      "Jemand musste Josef K. verleumdet haben, denn ohne dass er etwas Böses " +
      "getan hätte, wurde er eines Morgens verhaftet und in ein kleines Zimmer " +
      "geführt, in dem seit vielen Jahren niemand mehr gewohnt hatte und in dem " +
      "es nach kaltem Rauch und nassem Papier roch.",
    page,
    isPageStart: false,
    isolated: false,
    lineCount: 4,
  };
}

/** A short line standing alone — the shape every heading candidate has. */
function heading(text: string, page = 1, isPageStart = true): CleanBlock {
  return { text, page, isPageStart, isolated: true, lineCount: 1 };
}

describe("explicit headings", () => {
  it("finds numbered chapters", () => {
    const { chapters } = detectChapters([
      heading("Kapitel 1", 1),
      body(1),
      heading("Kapitel 2", 2),
      body(2),
    ]);

    expect(chapters.map((chapter) => chapter.title)).toEqual(["Kapitel 1", "Kapitel 2"]);
    expect(chapters.every((chapter) => chapter.confidence === "high")).toBe(true);
  });

  it("finds Roman numerals", () => {
    const { chapters } = detectChapters([
      heading("Kapitel IV", 1),
      body(1),
      heading("Kapitel V", 2),
      body(2),
    ]);

    expect(chapters.map((chapter) => chapter.title)).toEqual(["Kapitel IV", "Kapitel V"]);
  });

  it("finds spelled-out ordinals on either side of the word", () => {
    const { chapters } = detectChapters([
      heading("Kapitel Eins", 1),
      body(1),
      heading("Drittes Kapitel", 2),
      body(2),
    ]);

    expect(chapters.map((chapter) => chapter.title)).toEqual([
      "Kapitel Eins",
      "Drittes Kapitel",
    ]);
  });

  it("finds Prolog and Epilog", () => {
    const { chapters } = detectChapters([
      heading("Prolog", 1),
      body(1),
      heading("Kapitel 1", 2),
      body(2),
      heading("Epilog", 3),
      body(3),
    ]);

    expect(chapters.map((chapter) => chapter.title)).toEqual([
      "Prolog",
      "Kapitel 1",
      "Epilog",
    ]);
  });

  it("keeps a subtitle in the heading it was printed with", () => {
    const { chapters } = detectChapters([
      heading("Kapitel 3 — Der lange Weg", 1),
      body(1),
    ]);

    expect(chapters[0].title).toBe("Kapitel 3 — Der lange Weg");
  });
});

describe("named chapters", () => {
  /** Five point-of-view chapters, named after nobody the detector knows. */
  const NAMES = ["BRAN", "CATELYN", "DAENERYS", "EDDARD", "JON", "ARYA"];

  it("detects repeated isolated headings with no chapter word at all", () => {
    const blocks: CleanBlock[] = [];
    NAMES.forEach((name, index) => {
      blocks.push(heading(name, index + 1));
      blocks.push(body(index + 1));
    });

    const { chapters, structuralPattern } = detectChapters(blocks);

    expect(structuralPattern).toBe("caps:1");
    expect(chapters.map((chapter) => chapter.title)).toEqual(NAMES);
  });

  it("learns the shape, not the names", () => {
    // Different names entirely; the same convention.
    const others = ["HALINA", "MARZENA", "TOBIAS", "GERTRUD", "WILHELM", "ANNA"];
    const blocks: CleanBlock[] = [];
    others.forEach((name, index) => {
      blocks.push(heading(name, index + 1));
      blocks.push(body(index + 1));
    });

    expect(detectChapters(blocks).chapters).toHaveLength(others.length);
  });

  it("ignores a one-off shouted word", () => {
    const { chapters } = detectChapters([
      heading("Kapitel 1", 1),
      body(1),
      heading("NEIN", 1, false),
      body(1),
    ]);

    expect(chapters).toHaveLength(1);
    expect(chapters[0].text).toContain("NEIN");
  });

  it("does not make a pattern out of ordinary short paragraphs", () => {
    const blocks: CleanBlock[] = [];
    for (let i = 0; i < 8; i += 1) {
      blocks.push(heading("Er schwieg.", i + 1, false));
      blocks.push(body(i + 1));
    }

    expect(detectChapters(blocks).structuralPattern).toBeNull();
    expect(detectChapters(blocks).chapters).toHaveLength(1);
  });
});

describe("false positives", () => {
  it("does not split on a short sentence", () => {
    const { chapters } = detectChapters([
      heading("Kapitel 1", 1),
      body(1),
      heading("Sie nickte und ging.", 1, false),
      body(1),
    ]);

    expect(chapters).toHaveLength(1);
  });

  it("does not split on a line of dialogue", () => {
    const { chapters } = detectChapters([
      heading("Kapitel 1", 1),
      body(1),
      heading("„Komm her“, sagte er.", 1, false),
      body(1),
    ]);

    expect(chapters).toHaveLength(1);
  });

  it("does not split on a dedication line", () => {
    const { chapters } = detectChapters([
      heading("Für Hans Beispiel", 1),
      heading("Kapitel 1", 2),
      body(2),
    ]);

    expect(chapters.map((chapter) => chapter.title)).toEqual([
      "Für Hans Beispiel",
      "Kapitel 1",
    ]);
    // The dedication survives as front matter, not as a chapter break.
    expect(chapters[0].isFrontMatter).toBe(true);
  });
});

describe("front matter", () => {
  it("marks everything before the first heading and offers it off", () => {
    const { chapters } = detectChapters([
      heading("Die Reise nach Norden", 1),
      heading("Hans Beispiel", 1, false),
      heading("Kapitel 1", 2),
      body(2),
    ]);

    expect(chapters[0].isFrontMatter).toBe(true);
    expect(chapters[1].isFrontMatter).toBe(false);
  });

  it("marks a contents heading as front matter", () => {
    const { chapters } = detectChapters([
      heading("Inhaltsverzeichnis", 1),
      body(1),
      heading("Kapitel 1", 2),
      body(2),
    ]);

    expect(chapters[0].isFrontMatter).toBe(true);
  });
});

describe("declared chapters", () => {
  it("uses the file's own table of contents and never guesses over it", () => {
    const blocks = [
      { ...body(1), text: "Erster Text." },
      { ...body(2), text: "Zweiter Text." },
      heading("Kapitel 99", 2, true),
    ];

    const { chapters, structuralPattern } = detectChapters(blocks, {
      declared: [
        { title: "Kapitel 1", startPage: 1 },
        { title: "Kapitel 2", startPage: 2 },
      ],
    });

    expect(structuralPattern).toBeNull();
    expect(chapters.map((chapter) => chapter.title)).toEqual(["Kapitel 1", "Kapitel 2"]);
    expect(chapters[1].text).toContain("Kapitel 99");
  });
});

describe("degenerate input", () => {
  it("makes one chapter out of a file with no structure", () => {
    const { chapters } = detectChapters([body(1), body(1)], {
      fallbackTitle: "Mein Buch",
    });

    expect(chapters).toHaveLength(1);
    expect(chapters[0].title).toBe("Mein Buch");
  });

  it("returns nothing for nothing", () => {
    expect(detectChapters([]).chapters).toEqual([]);
  });

  it("flags a suspiciously short chapter for review", () => {
    const { chapters } = detectChapters([
      heading("Kapitel 1", 1),
      { ...heading("Nur drei Wörter.", 1, false), isolated: false, lineCount: 2 },
      heading("Kapitel 2", 2),
      body(2),
    ]);

    expect(chapters[0].confidence).toBe("low");
    expect(chapters[1].confidence).toBe("high");
  });
});

describe("heading shapes", () => {
  it("fingerprints typography, not words", () => {
    expect(headingShape("BRAN")).toBe("caps:1");
    expect(headingShape("CATELYN")).toBe("caps:1");
    expect(headingShape("Der Besuch")).toBe("title:2");
    expect(headingShape("VII")).toBe("roman");
    expect(headingShape("7")).toBe("arabic");
    expect(headingShape("Er ging nach Hause.")).toBeNull();
  });

  it("needs a real repetition before calling something a pattern", () => {
    expect(dominantShape(["BRAN", "JON", "ARYA"])).toBeNull();
    expect(dominantShape(["BRAN", "JON", "ARYA", "BRAN", "JON"])).toBe("caps:1");
  });
});
