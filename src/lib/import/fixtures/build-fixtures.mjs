/**
 * Build the importer's test fixtures.
 *
 *   node src/lib/import/fixtures/build-fixtures.mjs
 *
 * WHY SYNTHETIC, AND WHY COMMITTED. The integration tests need real files — a
 * PDF that pdf.js parses, an EPUB with a spine and a navigation document — and a
 * real book cannot be one of them: shipping somebody's copyrighted novel in a
 * repository to test an importer would be exactly the thing the private-import
 * model exists to avoid. So the fixtures are written here, from scratch, by a
 * script that is itself checked in. The files are a few kilobytes; the script is
 * how they are audited and regenerated.
 *
 * WHAT THE PDF IS BUILT TO EXERCISE. It is not a pretty document; every page is
 * a trap for one part of the pipeline:
 *
 *   - a running head on all five pages            → head removal
 *   - a folio at the foot of each                 → page-number removal
 *   - `Kran-` / `kenhaus` across a line break     → de-hyphenation
 *   - `deutsch-polnischen` inside a line          → hyphen preservation
 *   - full-measure lines and short ones           → wrap vs paragraph
 *   - `Kapitel 1`, `Kapitel 2` alone on a line    → chapter detection
 *   - a title page before the first heading       → front matter
 *   - ä ö ü ß throughout                          → encoding
 *
 * The PDF is written by hand rather than with a library: it is one page tree,
 * five content streams and a base-14 font, which is a hundred lines of
 * deterministic byte-shuffling and one less dependency to justify.
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { zipSync, strToU8 } from "fflate";

const HERE = dirname(fileURLToPath(import.meta.url));

// ─────────────────────────────────────────────────────────────────────────────
// The book
// ─────────────────────────────────────────────────────────────────────────────

const RUNNING_HEAD = "DIE REISE NACH NORDEN";

/** Each page as its printed lines, folio included. */
const PAGES = [
  [
    RUNNING_HEAD,
    "",
    "Die Reise nach Norden",
    "Eine kurze Geschichte",
    "",
    "Hans Beispiel",
    "",
    "",
    "1",
  ],
  [
    RUNNING_HEAD,
    "",
    "Kapitel 1",
    "",
    "Jemand hatte am Morgen die Tür offen gelassen, und der kalte",
    "Wind zog durch das ganze Haus bis in die Küche hinein, wo Anna",
    "gerade ihren Kaffee trank und dabei aus dem Fenster auf die",
    "grauen Dächer der schlafenden Stadt hinunterschaute.",
    "",
    "Sie stellte die Tasse ab, zog den Mantel über und ging zu Fuß",
    "durch den nassen Schnee bis zum großen alten Kran-",
    "kenhaus am Rand der Stadt.",
    "2",
  ],
  [
    RUNNING_HEAD,
    "",
    "Der Arzt sagte ihr, es sei nichts Ernstes, aber Anna glaubte",
    "ihm nicht ganz. Sie kannte diesen ruhigen Ton schon lange.",
    "",
    "„Kommen Sie morgen wieder“, sagte er freundlich.",
    "",
    "Sie nickte und ging.",
    "3",
  ],
  [
    RUNNING_HEAD,
    "",
    "Kapitel 2",
    "",
    "Am nächsten Morgen fuhr sie mit dem deutsch-polnischen Zug",
    "nach Osten, und der halb leere Wagen roch nach kaltem Kaffee",
    "und nassen Mänteln.",
    "",
    "Draußen wurde das Land flacher und weißer.",
    "4",
  ],
  [
    RUNNING_HEAD,
    "",
    "In Stettin stieg eine alte Frau ein, setzte sich ihr gegenüber",
    "und sagte kein einziges Wort bis zur letzten Station.",
    "",
    "Anna schloss die Augen und schlief.",
    "5",
  ],
];

// ─────────────────────────────────────────────────────────────────────────────
// PDF
// ─────────────────────────────────────────────────────────────────────────────

/**
 * WinAnsi bytes for the characters this fixture uses that are not ASCII.
 *
 * Latin-1 and WinAnsiEncoding agree on the umlauts and ß; they differ on the
 * German quotation marks, which live in the 0x80 block in WinAnsi and nowhere in
 * Latin-1. Mapping them explicitly is what makes „…“ survive the round trip.
 */
const WINANSI = new Map([
  ["„", 0x84],
  ["“", 0x93],
  ["”", 0x94],
  ["–", 0x96],
  ["—", 0x97],
  ["…", 0x85],
]);

function pdfString(text) {
  let out = "";
  for (const char of text) {
    const mapped = WINANSI.get(char);
    const code = mapped ?? char.codePointAt(0);
    if (char === "(" || char === ")" || char === "\\") out += `\\${char}`;
    else if (code < 32 || code > 126) out += `\\${code.toString(8).padStart(3, "0")}`;
    else out += char;
  }
  return `(${out})`;
}

function contentStream(lines) {
  const body = lines
    .map((line) => (line ? `${pdfString(line)} Tj T*` : "T*"))
    .join("\n");
  return `BT\n/F1 11 Tf\n16 TL\n1 0 0 1 60 780 Tm\n${body}\nET\n`;
}

function buildPdf() {
  const objects = [];
  const push = (body) => {
    objects.push(body);
    return objects.length; // 1-based object number
  };

  // Reserve 1 (catalog) and 2 (pages) so their ids are stable in the kids array.
  push("");
  push("");

  const fontId = push(
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
  );

  const pageIds = [];
  for (const lines of PAGES) {
    const stream = contentStream(lines);
    const contentId = push(
      `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}endstream`,
    );
    pageIds.push(
      push(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] ` +
          `/Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`,
      ),
    );
  }

  const infoId = push(
    `<< /Title ${pdfString("Die Reise nach Norden")} /Author ${pdfString("Hans Beispiel")} >>`,
  );

  objects[0] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[1] =
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;

  let pdf = "%PDF-1.4\n";
  const offsets = [];
  for (const [index, body] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  }

  const xrefOffset = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  pdf +=
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info ${infoId} 0 R >>\n` +
    `startxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(pdf, "latin1");
}

// ─────────────────────────────────────────────────────────────────────────────
// EPUB
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A minimal but genuinely valid EPUB 3.
 *
 * Built to exercise the things a hand-rolled reader gets wrong: a package
 * document in a subdirectory (so hrefs must be resolved, not concatenated),
 * namespace prefixes on `dc:` metadata, a spine with a `linear="no"` item that
 * must be skipped, a navigation document listing the chapters, and — the one
 * that matters for security — a `<script>` inside chapter markup that must never
 * reach the extracted text.
 */
function buildEpub() {
  const chapter = (title, paragraphs) =>
    `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>${title}</title>
<style>p { margin: 0 }</style>
<script>window.alert("dies darf nie im Text landen")</script>
</head><body>
<h2>${title}</h2>
${paragraphs.map((text) => `<p>${text}</p>`).join("\n")}
</body></html>`;

  const files = {
    // Stored first and uncompressed, as the specification requires.
    mimetype: strToU8("application/epub+zip"),

    "META-INF/container.xml": strToU8(
      `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`,
    ),

    "OEBPS/content.opf": strToU8(
      `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="id">urn:uuid:fluent-fixture</dc:identifier>
    <dc:title>Die Reise nach Norden</dc:title>
    <dc:creator>Hans Beispiel</dc:creator>
    <dc:language>de</dc:language>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="c1" href="text/kapitel-1.xhtml" media-type="application/xhtml+xml"/>
    <item id="c2" href="text/kapitel-2.xhtml" media-type="application/xhtml+xml"/>
    <item id="note" href="text/notiz.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="c1"/>
    <itemref idref="c2"/>
    <itemref idref="note" linear="no"/>
  </spine>
</package>`,
    ),

    "OEBPS/nav.xhtml": strToU8(
      `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<body><nav epub:type="toc"><ol>
  <li><a href="text/kapitel-1.xhtml">Kapitel 1</a></li>
  <li><a href="text/kapitel-2.xhtml">Kapitel 2</a></li>
</ol></nav></body></html>`,
    ),

    "OEBPS/text/kapitel-1.xhtml": strToU8(
      chapter("Kapitel 1", [
        "Jemand hatte am Morgen die T&#252;r offen gelassen, und der kalte Wind zog durch das ganze Haus.",
        "Sie stellte die Tasse ab und ging zu Fu&#223; durch den nassen Schnee zum Krankenhaus.",
      ]),
    ),

    "OEBPS/text/kapitel-2.xhtml": strToU8(
      chapter("Kapitel 2", [
        "Am n&#228;chsten Morgen fuhr sie mit dem deutsch-polnischen Zug nach Osten.",
        "Drau&#223;en wurde das Land flacher und wei&#223;er.",
      ]),
    ),

    "OEBPS/text/notiz.xhtml": strToU8(
      chapter("Notiz", ["Diese Seite ist nicht Teil des Buches."]),
    ),
  };

  return Buffer.from(
    zipSync(files, { level: 0, mtime: new Date("2026-01-01T00:00:00Z") }),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TXT
// ─────────────────────────────────────────────────────────────────────────────

function buildTxt() {
  return Buffer.from(
    [
      "Die Reise nach Norden",
      "",
      "Kapitel 1",
      "",
      "Jemand hatte am Morgen die Tür offen gelassen, und der kalte Wind zog",
      "durch das ganze Haus bis in die Küche hinein.",
      "",
      "Sie ging zu Fuß durch den nassen Schnee, vorbei an der deutsch-polnischen",
      "Grenze, bis zum Krankenhaus.",
      "",
      "Kapitel 2",
      "",
      "Am nächsten Morgen fuhr sie nach Osten. Draußen wurde das Land weißer.",
      "",
    ].join("\n"),
    "utf8",
  );
}

writeFileSync(join(HERE, "synthetic-book.pdf"), buildPdf());
writeFileSync(join(HERE, "synthetic-book.epub"), buildEpub());
writeFileSync(join(HERE, "synthetic-book.txt"), buildTxt());
console.log("fixtures written to src/lib/import/fixtures/");
