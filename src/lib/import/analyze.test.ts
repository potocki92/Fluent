import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { analyzeBook } from "@/lib/import/analyze";
import { detectLanguage } from "@/lib/import/language";
import { validateBookFile } from "@/lib/import/validate";
import { MAGIC_BYTE_WINDOW } from "@/lib/import/validate";

/**
 * The importer, end to end, against real files.
 *
 * These are integration tests in the only sense that matters here: the bytes are
 * a genuine PDF that Mozilla's parser opens and a genuine EPUB that a reader
 * would accept, not a fake of either. They are built by
 * `src/lib/import/fixtures/build-fixtures.mjs` — synthetic prose written for this
 * repository, because testing a book importer with somebody's copyrighted novel
 * would be the exact thing the private-import model exists to prevent.
 */

const FIXTURES = join(process.cwd(), "src/lib/import/fixtures");

function fixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(FIXTURES, name)));
}

describe("PDF", () => {
  it("extracts, cleans and splits a printed book", async () => {
    const result = await analyzeBook({
      bytes: fixture("synthetic-book.pdf"),
      fileName: "synthetic-book.pdf",
      mimeType: "application/pdf",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { book } = result;
    expect(book.format).toBe("pdf");
    expect(book.pageCount).toBe(5);
    expect(book.metadata.title).toBe("Die Reise nach Norden");
    expect(book.metadata.author).toBe("Hans Beispiel");

    const titles = book.detection.chapters.map((chapter) => chapter.title);
    expect(titles).toContain("Kapitel 1");
    expect(titles).toContain("Kapitel 2");
  });

  it("removes the running head and the folios from every chapter", async () => {
    const result = await analyzeBook({
      bytes: fixture("synthetic-book.pdf"),
      fileName: "synthetic-book.pdf",
      mimeType: "application/pdf",
    });
    if (!result.ok) throw new Error(result.code);

    const text = result.book.detection.chapters.map((c) => c.text).join("\n\n");
    expect(text).not.toContain("DIE REISE NACH NORDEN");
    // The folios ran 1..5 and were the only bare numerals in the book.
    expect(text.split(/\s+/).filter((token) => /^[1-5]$/.test(token))).toEqual([]);
  });

  it("repairs the line breaks without losing German characters", async () => {
    const result = await analyzeBook({
      bytes: fixture("synthetic-book.pdf"),
      fileName: "synthetic-book.pdf",
      mimeType: "application/pdf",
    });
    if (!result.ok) throw new Error(result.code);

    const text = result.book.detection.chapters.map((c) => c.text).join("\n\n");

    // Hyphenation resolved, real hyphen kept, umlauts and ß intact, dialogue
    // punctuation exactly as printed.
    expect(text).toContain("Krankenhaus am Rand der Stadt");
    expect(text).toContain("deutsch-polnischen");
    expect(text).toContain("zu Fuß");
    expect(text).toContain("Dächer");
    expect(text).toContain("„Kommen Sie morgen wieder“");

    // A wrapped sentence is one line again.
    expect(text).toContain(
      "Jemand hatte am Morgen die Tür offen gelassen, und der kalte Wind zog",
    );
  });

  it("offers the title page as front matter, switched off", async () => {
    const result = await analyzeBook({
      bytes: fixture("synthetic-book.pdf"),
      fileName: "synthetic-book.pdf",
      mimeType: "application/pdf",
    });
    if (!result.ok) throw new Error(result.code);

    const [first] = result.book.detection.chapters;
    expect(first.isFrontMatter).toBe(true);
    expect(first.text).toContain("Hans Beispiel");
  });

  it("recognises the book as German", async () => {
    const result = await analyzeBook({
      bytes: fixture("synthetic-book.pdf"),
      fileName: "synthetic-book.pdf",
      mimeType: "application/pdf",
    });
    if (!result.ok) throw new Error(result.code);

    expect(result.book.language.language).toBe("de");
  });
});

describe("EPUB", () => {
  it("reads the spine and the navigation document", async () => {
    const result = await analyzeBook({
      bytes: fixture("synthetic-book.epub"),
      fileName: "synthetic-book.epub",
      mimeType: "application/epub+zip",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.book.metadata).toEqual({
      title: "Die Reise nach Norden",
      author: "Hans Beispiel",
      language: "de",
    });
    // Declared chapters, in the order the navigation document lists them.
    expect(result.book.detection.chapters.map((c) => c.title)).toEqual([
      "Kapitel 1",
      "Kapitel 2",
    ]);
    // A PAGE COUNT WOULD BE A FICTION: an EPUB reflows.
    expect(result.book.pageCount).toBeNull();
  });

  it("never lets markup or scripts into the text", async () => {
    const result = await analyzeBook({
      bytes: fixture("synthetic-book.epub"),
      fileName: "synthetic-book.epub",
      mimeType: "application/epub+zip",
    });
    if (!result.ok) throw new Error(result.code);

    const text = result.book.detection.chapters.map((c) => c.text).join("\n\n");
    expect(text).not.toContain("<");
    expect(text).not.toContain("window.alert");
    expect(text).not.toContain("margin: 0");
    expect(text).toContain("Tür");
    expect(text).toContain("Fuß");
  });

  it("skips a spine item marked linear=no", async () => {
    const result = await analyzeBook({
      bytes: fixture("synthetic-book.epub"),
      fileName: "synthetic-book.epub",
      mimeType: "application/epub+zip",
    });
    if (!result.ok) throw new Error(result.code);

    const text = result.book.detection.chapters.map((c) => c.text).join("\n\n");
    expect(text).not.toContain("nicht Teil des Buches");
  });
});

describe("TXT", () => {
  it("keeps German characters and finds the chapters", async () => {
    const result = await analyzeBook({
      bytes: fixture("synthetic-book.txt"),
      fileName: "synthetic-book.txt",
      mimeType: "text/plain",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const text = result.book.detection.chapters.map((c) => c.text).join("\n\n");
    expect(text).toContain("Tür");
    expect(text).toContain("Fuß");
    expect(text).toContain("nächsten");
    expect(text).toContain("weißer");
    expect(text).toContain("deutsch-polnischen");

    expect(result.book.detection.chapters.map((c) => c.title)).toContain("Kapitel 1");
  });

  it("decodes a Windows-1252 file rather than mangling it", async () => {
    // Windows-1252 bytes, not UTF-8: `ü` is a single 0xFC and `ß` a single 0xDF.
    // Decoded as UTF-8 they are invalid sequences, which is exactly what the
    // strict-then-fall-back decode is there to notice.
    const paragraph = Buffer.from(
      "Die Tür war offen und draußen fiel seit dem frühen Morgen dichter Schnee " +
        "auf die stille Straße vor dem Haus, in dem seit vielen Jahren niemand " +
        "mehr gewohnt hatte.\n\n",
      "latin1",
    );
    const file = Buffer.concat([paragraph, paragraph, paragraph]);

    const result = await analyzeBook({
      bytes: new Uint8Array(file),
      fileName: "buch.txt",
      mimeType: "text/plain",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.book.detection.chapters[0].text).toContain("Tür");
    expect(result.book.detection.chapters[0].text).toContain("draußen");
    expect(result.book.detection.chapters[0].text).toContain("Straße");
    expect(result.book.detection.chapters[0].text).not.toContain("\ufffd");
  });
});

describe("refusals", () => {
  it("rejects a file that is not a book", async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    const result = await analyzeBook({
      bytes: new Uint8Array(Buffer.concat([Buffer.from(png), Buffer.alloc(200)])),
      fileName: "cover.png",
      mimeType: "image/png",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("unsupported_format");
  });

  it("rejects a renamed image even when the extension says txt", () => {
    const jpeg = new Uint8Array(MAGIC_BYTE_WINDOW);
    jpeg.set([0xff, 0xd8, 0xff, 0xe0, 0x00]);

    const result = validateBookFile({
      fileName: "buch.txt",
      mimeType: "text/plain",
      size: 4096,
      head: jpeg,
    });

    expect(result.ok).toBe(false);
  });

  it("rejects a zip that is not an EPUB", () => {
    const zip = new Uint8Array(MAGIC_BYTE_WINDOW);
    zip.set([0x50, 0x4b, 0x03, 0x04]);

    const result = validateBookFile({
      fileName: "buch.epub",
      mimeType: "application/epub+zip",
      size: 4096,
      head: zip,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("unsupported_format");
  });

  it("asks for OCR when a PDF has no text layer", async () => {
    // A structurally valid PDF whose pages carry no text at all.
    const empty = Buffer.from(
      "%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n" +
        "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n" +
        "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >>\nendobj\n" +
        "trailer\n<< /Size 4 /Root 1 0 R >>\n%%EOF\n",
      "latin1",
    );

    const result = await analyzeBook({
      bytes: new Uint8Array(empty),
      fileName: "scan.pdf",
      mimeType: "application/pdf",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(["ocr_required", "extract_failed"]).toContain(result.code);
  });

  it("refuses a file past the size limit before opening it", () => {
    const head = new Uint8Array(MAGIC_BYTE_WINDOW);
    head.set([0x25, 0x50, 0x44, 0x46, 0x2d]);

    const result = validateBookFile({
      fileName: "riesig.pdf",
      mimeType: "application/pdf",
      size: 200 * 1024 * 1024,
      head,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("file_too_large");
  });
});

describe("language detection", () => {
  const GERMAN =
    "Jemand musste Josef K. verleumdet haben, denn ohne dass er etwas Böses getan " +
    "hätte, wurde er eines Morgens verhaftet. Die Köchin der Frau Grubach, seiner " +
    "Zimmervermieterin, die ihm jeden Tag gegen acht Uhr früh das Frühstück brachte, " +
    "kam diesmal nicht. Das war noch niemals geschehen, und er wartete noch ein " +
    "Weilchen und sah von seinem Kopfkissen aus die alte Frau an, die ihm gegenüber " +
    "wohnte und die ihn mit einer an ihr ganz ungewöhnlichen Neugierde beobachtete.";

  const POLISH =
    "Ktoś musiał oczernić Józefa K., bo mimo że nie zrobił nic złego, został " +
    "pewnego ranka aresztowany. Kucharka pani Grubach, jego gospodyni, która " +
    "codziennie około ósmej rano przynosiła mu śniadanie, tym razem nie przyszła. " +
    "To jeszcze nigdy się nie zdarzyło, więc czekał jeszcze chwilę i patrzył z " +
    "poduszki na starą kobietę, która mieszkała naprzeciwko i która obserwowała go " +
    "z niezwykłą u niej ciekawością przez całe to długie poranne oczekiwanie.";

  it("recognises German", () => {
    const guess = detectLanguage(GERMAN);
    expect(guess.language).toBe("de");
    expect(guess.confidence).toBeGreaterThan(0);
  });

  it("recognises Polish, so the warning can be specific", () => {
    expect(detectLanguage(POLISH).language).toBe("pl");
  });

  it("says nothing rather than guessing at a fragment", () => {
    expect(detectLanguage("Hallo.").language).toBeNull();
  });
});
