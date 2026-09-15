/**
 * Every tuning number the import engine has, in one file.
 *
 * Same rule the planner, the reader and the Story engine follow: a bare
 * `* 0.35` anywhere else in `src/lib/import/` is a bug. A detector threshold
 * that lives next to the code it tunes is a threshold nobody can compare
 * against its neighbours, and chapter detection is a system of thresholds that
 * only make sense together.
 *
 * Pure data. No imports, no environment, no Supabase — the UI reads the size
 * limit from here and so does the validator, so the two cannot disagree.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Versions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The import pipeline's version stamp — extraction and cleanup.
 *
 * Distinct from `CONTENT_PROCESSOR_VERSION`, which stamps what the *reader's*
 * pipeline made of a chapter's source text. This one stamps how that source text
 * was recovered from a PDF or an EPUB in the first place. Two different
 * questions: "would reprocessing move a sentence boundary?" and "would
 * re-importing the same file produce different text?".
 *
 * BUMP IT when extraction or cleanup could turn the same file into different
 * text: a new de-hyphenation rule, a changed header heuristic, a different PDF
 * page-text join.
 */
export const IMPORT_PIPELINE_VERSION = "import_v1";

/**
 * The chapter detector's version stamp.
 *
 * Separate from the pipeline version because it answers a separate question —
 * "would re-analysing the same extracted text find different chapters?" — and
 * because a detector improvement is the one change that would make re-running
 * an old import worthwhile. Recorded on the import so that a future
 * re-analysis can tell which imports predate the improvement.
 */
export const CHAPTER_DETECTOR_VERSION = "detector_v1";

// ─────────────────────────────────────────────────────────────────────────────
// Upload
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The largest file Fluent accepts, in megabytes.
 *
 * ONE definition, read by the browser (to reject before uploading 80 MB the
 * server will throw away) and by the server (because a browser check is a
 * courtesy, not a control). A limit written twice is a limit that drifts.
 *
 * 40 MB comfortably holds a full novel as a digital PDF or EPUB; what it does
 * not hold is a 700-page colour scan, which is the file Fluent cannot read
 * anyway.
 */
export const MAX_BOOK_IMPORT_MB = 40;

/**
 * The one place this number is duplicated is `create_book_import` in
 * `supabase/migrations/20260915120000_private_book_import.sql`, because a
 * PL/pgSQL function cannot import a TypeScript constant. Change both together.
 */

export const MAX_BOOK_IMPORT_BYTES = MAX_BOOK_IMPORT_MB * 1024 * 1024;

/** Smallest plausible book file. Below this the upload is an accident. */
export const MIN_BOOK_IMPORT_BYTES = 64;

/** The private Storage bucket originals live in. Never public. */
export const BOOK_IMPORT_BUCKET = "private-book-imports";

// ─────────────────────────────────────────────────────────────────────────────
// Extraction quality
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Characters per page below which a PDF is treated as a scan.
 *
 * A typeset novel page is 1 500–2 500 characters. A page with fewer than 120 is
 * a page whose words are pixels — a scan, a cover, or a plate. The signal is
 * only meaningful across the whole document (see
 * {@link OCR_SCANNED_PAGE_RATIO}), because a real book has blank pages too.
 */
export const OCR_MIN_CHARS_PER_PAGE = 120;

/**
 * Share of pages that must look like scans before the import is refused.
 *
 * Deliberately high. Refusing a readable book because its first ten pages are
 * plates would be worse than accepting a book with a bad chapter.
 */
export const OCR_SCANNED_PAGE_RATIO = 0.8;

/** Below this many extracted words, there is no book here at all. */
export const MIN_EXTRACTED_WORDS = 50;

/**
 * Share of characters that may be replacement/control junk before the text is
 * called suspect.
 *
 * Not a refusal — a warning shown next to a text sample, because the learner
 * looking at two sentences of their own book is a better judge of "is this
 * readable?" than any ratio.
 */
export const GARBAGE_CHAR_WARNING_RATIO = 0.02;

/** How many characters of a chapter the preview shows. Enough to judge a split. */
export const PREVIEW_SNIPPET_CHARS = 220;

/** How many text samples the pre-import quality check shows. */
export const QUALITY_SAMPLE_COUNT = 2;

/** Characters per quality sample. */
export const QUALITY_SAMPLE_CHARS = 320;

// ─────────────────────────────────────────────────────────────────────────────
// Cleanup
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Share of pages a short line must repeat on before it counts as running head.
 *
 * The number is what separates "the book's title printed at the top of every
 * page" from "a sentence that happens to occur twice". At 0.5 a two-part novel
 * whose running head changes halfway through still loses both heads; at 0.9 it
 * would keep both.
 */
export const RUNNING_HEAD_PAGE_RATIO = 0.5;

/** Below this many pages, repetition means nothing — a 3-page file has no head. */
export const RUNNING_HEAD_MIN_PAGES = 4;

/**
 * Longest line length that may be deleted as a running head or foot.
 *
 * A running head is a title, an author, or a chapter name. It is short. Allowing
 * long lines to be deleted by frequency is how a refrain in a poem, or a
 * repeated line of dialogue, silently disappears from a book.
 */
export const RUNNING_HEAD_MAX_CHARS = 60;

/**
 * How many lines at each edge of a page are candidates for head/foot removal.
 *
 * Two, not one: a running head is often a title line plus a page number, and a
 * footer is often a page number plus a copyright line.
 */
export const PAGE_EDGE_LINES = 2;

/**
 * How close to the measure a line must come to count as "the column ended it".
 *
 * The slack is how much room is left at the end of a line that was still
 * wrapped — which is really "how long is the next word". German makes that
 * bigger than English does, so it scales with the measure rather than being a
 * fixed number of characters, with a floor for very narrow columns.
 *
 * MEASURED FROM THE TOP, NOT THE MIDDLE. The measure is the 90th percentile of a
 * page's line lengths, not the median: the median of a page that contains a
 * heading and a paragraph's short last line sits well below the column width,
 * and every line above it would then look "full".
 */
export const WRAP_MEASURE_SLACK_RATIO = 0.12;
export const WRAP_MEASURE_SLACK_MIN = 6;

/**
 * How close to the measure a SENTENCE-ENDING line must come to be a wrap.
 *
 * Much tighter, and this is the rule that recovers most paragraph breaks in a
 * justified book. A line ending in a full stop with room to spare is where the
 * author ended the paragraph; a line ending in a full stop that runs the whole
 * width happens to have finished a sentence exactly at the margin, and the
 * paragraph goes on. Two characters is "no room for anything".
 */
export const WRAP_SENTENCE_END_SLACK = 2;

/** A page needs this many lines before its own measure means anything. */
export const WRAP_MIN_LINES_FOR_MEASURE = 4;

/** Fallback measure, in characters, for pages too short to have one. */
export const WRAP_FALLBACK_MEASURE = 55;

// ─────────────────────────────────────────────────────────────────────────────
// Chapter detection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Longest a line can be and still be a heading.
 *
 * Headings are short. "Kapitel 14", "EDDARD", "Der Besuch". A 90-character line
 * is a sentence, whatever it is capitalised like.
 */
export const HEADING_MAX_CHARS = 64;

/** Most words a heading may have. "Kapitel 3 — Der lange Weg nach Hause" is 7. */
export const HEADING_MAX_WORDS = 10;

/**
 * Score a candidate must reach to be a chapter break at all.
 *
 * Below it the line is body text. The scale is defined entirely by the weights
 * below, so this number is only meaningful next to them — and the number that
 * fixes it is 4, because a short one-line paragraph in Title Case scores exactly
 * 3 (isolated + heading case) and a book's dedication line must not become a
 * chapter.
 */
export const HEADING_SCORE_FLOOR = 4;

/** At or above this, the detector is sure. Rendered as "pewne" in the preview. */
export const HEADING_SCORE_HIGH = 7;

/** At or above this, the detector is fairly sure. Below it, flagged for review. */
export const HEADING_SCORE_MEDIUM = 5;

/**
 * What each signal is worth.
 *
 * An explicit "Kapitel 7" is worth a break on its own (5 ≥ floor). Nothing else
 * is: a one-line paragraph, an all-caps line or a page-opening line each needs
 * at least one more signal to count, which is what keeps a one-line paragraph of
 * dialogue from splitting a book.
 */
export const HEADING_WEIGHTS = {
  /** "Kapitel 7", "Chapter IV", "Rozdział 2", "Kapitel Eins". */
  explicitChapterWord: 5,
  /** "Prolog", "Epilog", "Vorwort", "Nachwort". */
  namedSection: 5,
  /** A bare numeral or Roman numeral alone on a line. */
  bareNumber: 2,
  /**
   * The line is a paragraph of its own.
   *
   * After `cleanup/`, "isolated" means exactly that: the wrap pass has already
   * folded every continuation line into its paragraph, so a paragraph left one
   * line long is a line that stood alone in the book. A blank-line test would be
   * useless here — PDF extraction does not emit blank lines at all.
   */
  isolated: 2,
  /** The line opens a page. */
  pageStart: 1,
  /** ALL CAPS, or Title Case with no sentence punctuation. */
  headingCase: 1,
  /** Matches the book's own dominant heading shape — see `structural.ts`. */
  structuralPattern: 3,
  /** The line is also an entry in the book's table of contents. */
  tableOfContents: 3,
} as const;

/**
 * How many times a heading shape must repeat before it is the book's pattern.
 *
 * Three "BRAN"-style headings could be three shouted words. Five is a
 * convention. This is the whole of the named-chapter detector's nerve: it never
 * learns names, it learns that this book puts a short isolated line in a
 * particular shape where chapters begin.
 */
export const STRUCTURAL_PATTERN_MIN_OCCURRENCES = 5;

/**
 * Shortest a chapter may be, in words, before the detector suspects the break.
 *
 * Real chapters run short — a one-page interlude is a chapter. But a 12-word
 * "chapter" is almost always a heading the detector split twice, so the break is
 * kept and flagged rather than dropped: the learner merges it in one tap, and
 * the detector never silently discards text.
 */
export const CHAPTER_MIN_WORDS = 40;

/** Front matter shorter than this, before the first heading, is offered off. */
export const FRONT_MATTER_MAX_WORDS = 600;

/**
 * Lines of a page that must look like "title …… 42" for it to be a contents
 * page.
 */
export const TOC_MIN_ENTRIES = 4;

/** How many pages from the start a table of contents may appear on. */
export const TOC_MAX_PAGE = 12;

// ─────────────────────────────────────────────────────────────────────────────
// Language detection
// ─────────────────────────────────────────────────────────────────────────────

/** The language Fluent teaches. Anything else earns a warning, not a refusal. */
export const TARGET_LANGUAGE = "de";

/** How many characters the language detector reads. Sampling, not scanning. */
export const LANGUAGE_SAMPLE_CHARS = 20000;

/** Below this score gap, the detector says it does not know. */
export const LANGUAGE_MIN_CONFIDENCE = 0.08;

// ─────────────────────────────────────────────────────────────────────────────
// Processing
// ─────────────────────────────────────────────────────────────────────────────

/**
 * How many chapters one processing call handles.
 *
 * The ceiling is a serverless function's wall clock, not a throughput
 * preference: a 42-chapter novel processed in one request would time out on
 * every deployment Fluent targets. Small enough that a batch always finishes,
 * large enough that a 42-chapter book is 14 calls and not 42.
 */
export const IMPORT_PROCESS_BATCH_SIZE = 3;

/**
 * How many chapters a finalised import may contain.
 *
 * A bound rather than a judgement. A "book" that detected 900 chapters is a
 * detector failure, and importing it would be 900 rows of garbage.
 */
export const MAX_IMPORT_CHAPTERS = 400;

/**
 * How long an unconfirmed import is kept before it is fair game for cleanup.
 *
 * Nothing deletes on this schedule today — the timestamps exist so that a
 * cleanup job can be written without a migration. Documented in
 * `docs/architecture/book-import-engine.md`.
 */
export const IMPORT_DRAFT_RETENTION_DAYS = 14;
