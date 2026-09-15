/**
 * What a chapter heading looks like when it says so outright.
 *
 * This file holds the EXPLICIT half of chapter detection — the headings that
 * name themselves. "Kapitel 7" is not a guess. Everything ambiguous (a short
 * isolated line that might be a heading and might be a one-word paragraph) is
 * `structural.ts`'s problem, and the two are separate files because they fail
 * differently: a bad pattern here is a missed chapter, a bad pattern there is a
 * book cut into 400 pieces.
 *
 * GERMAN FIRST, and German puts the ordinal on either side: "Kapitel 3" and
 * "Drittes Kapitel" are the same heading. English and Polish forms are matched
 * too, because a learner's own library is not all German — the *content* has to
 * be German for Fluent to be useful, the *headings* do not have to be.
 *
 * Pure: strings in, matches out. No scoring, no decisions.
 */

/** The words a book uses to announce a division of itself. */
const DIVISION_WORDS = [
  "kapitel",
  "chapter",
  "rozdział",
  "rozdzial",
  "teil",
  "part",
  "buch",
  "book",
  "abschnitt",
  "szene",
  "scene",
] as const;

/**
 * Sections that are chapters without being numbered.
 *
 * Worth as much as an explicit "Kapitel 1" because they are just as
 * unambiguous: nothing in a novel is called "Prolog" except the prologue.
 */
const NAMED_SECTIONS = [
  "prolog",
  "prologue",
  "epilog",
  "epilogue",
  "vorwort",
  "nachwort",
  "vorbemerkung",
  "nachbemerkung",
  "einleitung",
  "einführung",
  "preface",
  "foreword",
  "afterword",
  "introduction",
  "przedmowa",
  "wstęp",
  "zakończenie",
] as const;

/**
 * Sections that are NOT part of the book's text.
 *
 * Detected so the preview can offer them switched off by default. Never deleted:
 * a learner who wants their book's dedication keeps it with one tap, and an
 * importer that silently drops pages is an importer nobody trusts.
 */
const FRONT_MATTER_WORDS = [
  "inhalt",
  "inhaltsverzeichnis",
  "impressum",
  "copyright",
  "urheberrecht",
  "widmung",
  "danksagung",
  "dedication",
  "acknowledgements",
  "acknowledgments",
  "contents",
  "table of contents",
  "spis treści",
  "spis tresci",
  "titelseite",
  "title page",
  "über den autor",
  "about the author",
  "anhang",
  "appendix",
  "glossar",
  "glossary",
  "register",
  "index",
  "bibliografie",
  "bibliography",
  "literaturverzeichnis",
] as const;

/**
 * German cardinals and ordinals up to twenty-odd, as they appear in headings.
 *
 * Bounded deliberately: past "Zwanzigstes Kapitel" every book in the world
 * switches to numerals, and a regex that tried to parse
 * "Siebenundvierzigstes" would match far more than it should.
 */
const GERMAN_NUMBER_WORDS =
  "(?:ein|eins|erste[rsn]?|zwei|zweite[rsn]?|drei|dritte[rsn]?|vier|vierte[rsn]?|f[üu]nf|f[üu]nfte[rsn]?|sechs|sechste[rsn]?|sieben|siebte[rsn]?|siebente[rsn]?|acht|achte[rsn]?|neun|neunte[rsn]?|zehn|zehnte[rsn]?|elf|elfte[rsn]?|zw[öo]lf|zw[öo]lfte[rsn]?|dreizehn|vierzehn|f[üu]nfzehn|sechzehn|siebzehn|achtzehn|neunzehn|zwanzig)(?:te[rsn]?)?";

const ROMAN = "(?:[ivxlcdm]{1,7})";
const ARABIC = "(?:\\d{1,4})";

const DIVISION = DIVISION_WORDS.join("|");

/** "Kapitel 7", "Chapter IV", "Kapitel Eins", optionally with a subtitle. */
const DIVISION_FIRST = new RegExp(
  `^(?:${DIVISION})(?:\\s+(${ARABIC}|${ROMAN}|${GERMAN_NUMBER_WORDS}))?\\s*(?:[.:–—-]\\s*(.*))?$`,
  "iu",
);

/** "Drittes Kapitel", "Erster Teil". */
const DIVISION_LAST = new RegExp(
  `^(${GERMAN_NUMBER_WORDS}|${ARABIC}|${ROMAN})\\s+(?:${DIVISION})\\s*(?:[.:–—-]\\s*(.*))?$`,
  "iu",
);

const NAMED_SECTION_RE = new RegExp(
  `^(?:${NAMED_SECTIONS.join("|")})\\b\\s*(?:[.:–—-]\\s*(.*))?$`,
  "iu",
);

const FRONT_MATTER_RE = new RegExp(`^(?:${FRONT_MATTER_WORDS.join("|")})\\b`, "iu");

/** A line that is nothing but a number: `7`, `VII.`, `— 7 —`. */
const BARE_ARABIC_RE = new RegExp(`^[\\s\\-–—[(]*${ARABIC}[.)\\]\\s]*$`, "u");
const BARE_ROMAN_RE = new RegExp(`^[\\s\\-–—[(]*${ROMAN}[.)\\]\\s]*$`, "iu");

/** A table-of-contents line: a title, a run of leaders, a page number. */
const TOC_ENTRY_RE = /^(.{2,60}?)[\s.·•–—_]{2,}(\d{1,4})$/u;

/** Strip the decoration a heading is printed with, without changing its words. */
export function headingText(line: string): string {
  return line.replace(/\s+/g, " ").trim();
}

/** The comparison form: case-folded, punctuation-free, for matching a TOC entry. */
export function headingKey(line: string): string {
  return headingText(line)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** `Kapitel 7 — Der Weg` → `{ label: "Kapitel 7", subtitle: "Der Weg" }`. */
export interface ExplicitHeading {
  kind: "division" | "named_section";
  subtitle: string | null;
}

/** Does this line announce itself as a chapter? */
export function matchExplicitHeading(line: string): ExplicitHeading | null {
  const text = headingText(line);
  if (!text) return null;

  const named = text.match(NAMED_SECTION_RE);
  if (named) return { kind: "named_section", subtitle: named[1]?.trim() || null };

  const first = text.match(DIVISION_FIRST);
  if (first) return { kind: "division", subtitle: first[2]?.trim() || null };

  const last = text.match(DIVISION_LAST);
  if (last) return { kind: "division", subtitle: last[2]?.trim() || null };

  return null;
}

/** Is this heading one of the parts of a book that is not the book? */
export function isFrontMatterHeading(line: string): boolean {
  return FRONT_MATTER_RE.test(headingText(line));
}

/** `7`, `VII`, `— 12 —`: a division marked by nothing but its number. */
export function matchBareNumber(line: string): "arabic" | "roman" | null {
  const text = headingText(line);
  if (!text) return null;
  if (BARE_ARABIC_RE.test(text)) return "arabic";
  // Checked second: `1` matches neither Roman pattern, but `I` and `V` would be
  // ambiguous if Roman were tried first on a numeral.
  if (BARE_ROMAN_RE.test(text)) return "roman";
  return null;
}

/** `Der Prozess .......... 147` — the shape of a contents line. */
export function matchTocEntry(line: string): { title: string; page: number } | null {
  const match = headingText(line).match(TOC_ENTRY_RE);
  if (!match) return null;
  return { title: match[1].trim(), page: Number(match[2]) };
}
