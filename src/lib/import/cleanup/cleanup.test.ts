import { describe, expect, it } from "vitest";

import { cleanExtractedPages, cleanedText } from "@/lib/import/cleanup";
import type { ExtractedPage } from "@/lib/import/types";

/**
 * The cleanup pipeline is the part of the importer with the most opportunity to
 * quietly ruin a book: it deletes lines and joins others, and both are
 * irreversible by the time a learner sees the result. So the tests are written
 * as the two questions that matter — "did it remove the furniture?" and "did it
 * leave the prose alone?" — and every removal rule has a counter-example.
 */

/** A page of a book set to a ~60 character measure. */
function page(number: number, lines: string[]): ExtractedPage {
  return { number, text: lines.join("\n") };
}

const HEAD = "DER PROZESS";

/** Six pages of plausible prose, with the furniture a printed book carries. */
function printedBook(): ExtractedPage[] {
  return [
    page(1, [
      HEAD,
      "Jemand musste Josef K. verleumdet haben, denn ohne dass er",
      "etwas Böses getan hätte, wurde er eines Morgens verhaftet.",
      "12",
    ]),
    page(2, [
      HEAD,
      "Die Köchin der Frau Grubach, seiner Zimmervermieterin, die",
      "ihm jeden Tag gegen acht Uhr früh das Frühstück brachte,",
      "kam diesmal nicht.",
      "13",
    ]),
    page(3, [
      HEAD,
      "Das war noch niemals geschehen. K. wartete noch ein",
      "Weilchen, sah von seinem Kopfkissen aus die alte Frau an,",
      "die ihm gegenüber wohnte.",
      "14",
    ]),
    page(4, [
      HEAD,
      "Dann aber, gleichzeitig befremdet und hungrig, läutete er.",
      "Sofort klopfte es und ein Mann trat ein.",
      "15",
    ]),
    page(5, [
      HEAD,
      "Er war schlank und doch fest gebaut, er trug ein anliegendes",
      "schwarzes Kleid, das nach Art der Reiseanzüge mit ver-",
      "schiedenen Falten versehen war.",
      "16",
    ]),
    page(6, [
      HEAD,
      "„Wer sind Sie?“ fragte K. und sah sich im Zimmer um.",
      "Der Mann antwortete nicht.",
      "17",
    ]),
  ];
}

describe("running heads and feet", () => {
  it("removes a head that repeats on most pages", () => {
    const text = cleanedText(cleanExtractedPages(printedBook()).blocks);
    expect(text).not.toContain(HEAD);
  });

  it("keeps a short line that repeats only twice", () => {
    const pages = printedBook();
    pages[0].text = `${pages[0].text}\nSie schwieg.`;
    pages[1].text = `${pages[1].text}\nSie schwieg.`;

    const text = cleanedText(cleanExtractedPages(pages).blocks);
    expect(text).toContain("Sie schwieg.");
  });

  it("keeps a repeated line that is too long to be furniture", () => {
    const refrain =
      "Und immer wieder sagte sie denselben langen Satz zu ihm, jeden Abend aufs Neue.";
    const pages = printedBook().map((source) => ({
      ...source,
      text: `${source.text}\n${refrain}`,
    }));

    const text = cleanedText(cleanExtractedPages(pages).blocks);
    expect(text).toContain(refrain);
  });
});

describe("page numbers", () => {
  it("removes folios that follow the book's own numbering", () => {
    const text = cleanedText(cleanExtractedPages(printedBook()).blocks);
    // The folios run 12..17 against pages 1..6 — a constant offset of 11.
    for (const folio of ["12", "13", "14", "15", "16", "17"]) {
      expect(text.split(/\s+/)).not.toContain(folio);
    }
  });

  it("leaves a number that is not a folio alone", () => {
    const pages = printedBook();
    pages[2].text = pages[2].text.replace(
      "Das war noch niemals geschehen.",
      "Das war im Jahr 1914 noch niemals geschehen.",
    );

    const text = cleanedText(cleanExtractedPages(pages).blocks);
    expect(text).toContain("1914");
  });

  it("leaves standalone numbers alone when the book has no numbering", () => {
    const pages = printedBook().map((source) => ({
      ...source,
      // Strip every folio, then plant one stray numeral at a page edge.
      text: source.text.replace(/\n\d{2}$/, ""),
    }));
    pages[3].text = `${pages[3].text}\n1848`;

    const text = cleanedText(cleanExtractedPages(pages).blocks);
    expect(text).toContain("1848");
  });
});

describe("line wrapping", () => {
  it("joins a sentence broken across a line break", () => {
    const text = cleanedText(cleanExtractedPages(printedBook()).blocks);
    expect(text).toContain(
      "Jemand musste Josef K. verleumdet haben, denn ohne dass er etwas Böses getan hätte",
    );
  });

  it("keeps a paragraph boundary where a sentence ended mid-column", () => {
    const { blocks } = cleanExtractedPages(printedBook());
    const withKam = blocks.findIndex((block) => block.text.includes("kam diesmal nicht."));
    const withDasWar = blocks.findIndex((block) =>
      block.text.includes("Das war noch niemals geschehen."),
    );

    expect(withKam).toBeGreaterThanOrEqual(0);
    expect(withDasWar).toBeGreaterThan(withKam);
  });

  it("keeps a line of dialogue as its own paragraph", () => {
    const { blocks } = cleanExtractedPages(printedBook());
    const speech = blocks.find((block) => block.text.startsWith("„Wer sind Sie?“"));

    expect(speech).toBeDefined();
    expect(speech?.text).not.toContain("Der Mann antwortete");
  });
});

describe("hyphenation", () => {
  it("rejoins a word broken across a line", () => {
    const text = cleanedText(cleanExtractedPages(printedBook()).blocks);
    expect(text).toContain("verschiedenen Falten");
    expect(text).not.toContain("ver-\nschiedenen");
    expect(text).not.toContain("ver- schiedenen");
  });

  it("rejoins the classic case", () => {
    const pages = [
      page(1, [
        "Sie ging langsam durch den nassen Schnee bis zum Kran-",
        "kenhaus am Rand der kleinen Stadt und blieb dort stehen.",
      ]),
    ];

    expect(cleanedText(cleanExtractedPages(pages).blocks)).toContain("Krankenhaus");
  });

  it("keeps a real hyphen inside a line", () => {
    const pages = [
      page(1, [
        "Am nächsten Morgen fuhr sie mit dem deutsch-polnischen Zug",
        "nach Osten, und der Wagen war fast leer.",
      ]),
    ];

    expect(cleanedText(cleanExtractedPages(pages).blocks)).toContain("deutsch-polnischen");
  });

  it("keeps the hyphen when the continuation is a capitalised word", () => {
    const pages = [
      page(1, [
        "Der Zug fuhr durch das ganze Land und hielt erst in Nord-",
        "Amerika, wo niemand mehr auf ihn wartete an jenem Abend.",
      ]),
    ];

    expect(cleanedText(cleanExtractedPages(pages).blocks)).toContain("Nord-Amerika");
  });

  it("always resolves a soft hyphen", () => {
    const pages = [page(1, ["Kran\u00ad", "kenhaus"])];
    expect(cleanedText(cleanExtractedPages(pages).blocks)).toContain("Krankenhaus");
  });
});

describe("sanitising", () => {
  it("drops a page that repeats the one before it", () => {
    const pages = printedBook();
    pages.splice(3, 0, { number: 4, text: pages[2].text });

    const cleaned = cleanExtractedPages(pages);
    expect(cleaned.pageCount).toBe(printedBook().length);
  });

  it("removes control characters without touching German letters", () => {
    const pages = [page(1, ["Die Tür\u0007 war offen, und dr\u200baußen fiel Schnee."])];
    const text = cleanedText(cleanExtractedPages(pages).blocks);

    expect(text).toBe("Die Tür war offen, und draußen fiel Schnee.");
  });
});
