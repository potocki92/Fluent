/**
 * The shapes the import engine passes between its stages.
 *
 * One vocabulary for three very different file formats. A PDF is pages, an EPUB
 * is documents, a TXT is one stream — and every stage after extraction would
 * have to branch on which it was if they did not agree on a single output. They
 * do: {@link ExtractedBook}, a list of {@link ExtractedPage}s, where "page" means
 * "the unit the source came in" rather than anything about paper.
 *
 * Pure types. No Supabase row leaks in here; persistence shapes live in
 * `src/lib/import/queries.ts` and the migration.
 */

/** The file formats V1 accepts. */
export type BookImportFormat = "pdf" | "epub" | "txt";

/**
 * One unit of source, as the file delivered it.
 *
 * PDF   — a printed page. `number` is the page number, and head/foot cleanup
 *         depends on that being true.
 * EPUB  — one document from the spine. `href` records which, for traceability.
 * TXT   — the whole file, as a single page.
 *
 * Keeping the page boundary is what makes running-head removal, page-number
 * removal and "a heading near the top of a page" possible at all. Flattening to
 * one string first would throw away the only structural signal a PDF has.
 */
export interface ExtractedPage {
  /** 1-based. For EPUB this is the spine index, not a printed page. */
  number: number;
  text: string;
  /** EPUB only: the spine item this came from. Documentation, not a key. */
  href?: string;
}

/** What a file said about itself, before anything is inferred from its text. */
export interface ExtractedMetadata {
  title: string | null;
  author: string | null;
  /** The file's own language tag, when it has one (EPUB `dc:language`). */
  language: string | null;
}

/** What an extractor produces. Deliberately small — text and provenance. */
export interface ExtractedBook {
  format: BookImportFormat;
  pages: ExtractedPage[];
  metadata: ExtractedMetadata;
  /** Printed pages, for a PDF. Null for formats where the idea is meaningless. */
  pageCount: number | null;
  /**
   * Chapter boundaries the file declared itself.
   *
   * An EPUB with a table of contents already knows where its chapters are, and
   * guessing at what it has told us would be worse than reading it. Empty for
   * PDF and TXT, which have to be detected.
   */
  declaredChapters: DeclaredChapter[];
}

/** A chapter boundary the source file stated outright. */
export interface DeclaredChapter {
  title: string | null;
  /** Index into {@link ExtractedBook.pages} where this chapter starts. */
  startPage: number;
  /** Where it came from, for the import's provenance record. */
  href?: string;
}

/**
 * What a file has to be before it is worth opening.
 *
 * An extractor is chosen by this, never by the filename: `.pdf` is a claim the
 * uploader makes, and magic bytes are what the file actually is.
 */
export interface FileIdentity {
  format: BookImportFormat;
  /** True when the extension, the declared MIME type and the bytes all agree. */
  consistent: boolean;
}

/**
 * The extractor contract.
 *
 * Three implementations, one interface, chosen by {@link FileIdentity} rather
 * than by a `switch` spread across the pipeline. A fourth format (DOCX) is a new
 * file in `extract/`, and nothing else changes — which is the entire reason this
 * is an interface and not a function with three branches.
 */
export interface BookExtractor {
  format: BookImportFormat;
  /** Does this extractor handle that file? Asked of each in registration order. */
  canHandle(identity: FileIdentity): boolean;
  /**
   * Turn bytes into text.
   *
   * MAY THROW. Failure here is expected (an encrypted PDF, a corrupt zip) and is
   * classified into an {@link ImportErrorCode} by the caller — extractors do not
   * know about the import's state machine.
   */
  extract(bytes: Uint8Array): Promise<ExtractedBook>;
}

/** A detected chapter, before the learner has looked at it. */
export interface DetectedChapter {
  /** 1-based, contiguous, and the order the book is read in. */
  position: number;
  title: string | null;
  /** Inclusive page index range in the extracted source, for debugging a split. */
  startPage: number;
  endPage: number;
  /**
   * The EPUB spine document this chapter came from, when there was one.
   *
   * Provenance only — nothing reads it back. It exists so that "why did this
   * chapter come out like that?" can be answered against the original file,
   * which is the only way a detector or an extractor ever improves.
   */
  sourceHref: string | null;
  text: string;
  wordCount: number;
  confidence: ChapterConfidence;
  /**
   * Why the detector thinks this is a chapter.
   *
   * Never shown raw to a learner — the preview renders a confidence badge. It is
   * here so a bad detection can be diagnosed without re-running the detector
   * with a debugger attached.
   */
  signals: string[];
  /** True when the section looks like a title page, a contents page, a colophon. */
  isFrontMatter: boolean;
}

/**
 * How sure the detector is. Three bands, not a number.
 *
 * A learner cannot act on 0.84371, and showing it invites them to treat the
 * detector's arithmetic as a measurement. What they can act on is "check this
 * one", which is exactly what `low` means.
 */
export type ChapterConfidence = "high" | "medium" | "low";

/** The detector's whole output. */
export interface ChapterDetection {
  chapters: DetectedChapter[];
  /** The repeating heading shape the book uses, when it has one. */
  structuralPattern: string | null;
  detectorVersion: string;
}

/** What language detection concluded, and how firmly. */
export interface LanguageGuess {
  /** ISO 639-1, or null when the text was too short or too mixed to tell. */
  language: string | null;
  /** 0–1. The margin over the runner-up, not a probability. */
  confidence: number;
}

/**
 * Measured signals about how well extraction went.
 *
 * Deliberately not reduced to a single percentage. "72% quality" means nothing;
 * "two thirds of the pages have almost no text" means the file is a scan, and
 * those are different facts that lead to different screens.
 */
export interface ExtractionQuality {
  totalChars: number;
  wordCount: number;
  /** Pages whose text is too thin to be a typeset page. */
  sparsePages: number;
  totalPages: number;
  /** Share of characters that are replacement or control junk. */
  garbageRatio: number;
  /** True when the document looks like a scan with no usable text layer. */
  looksScanned: boolean;
  /** True when there is text, but enough of it is junk to be worth a warning. */
  looksGarbled: boolean;
  /** Short verbatim samples, so a human can judge what a ratio cannot. */
  samples: string[];
}

/**
 * Everything one analysis run learned. The import's whole reviewable state.
 */
export interface AnalyzedBook {
  format: BookImportFormat;
  metadata: ExtractedMetadata;
  pageCount: number | null;
  wordCount: number;
  language: LanguageGuess;
  quality: ExtractionQuality;
  detection: ChapterDetection;
  pipelineVersion: string;
}

/**
 * Why an import stopped.
 *
 * The taxonomy exists so the UI can say something true and specific — "this PDF
 * looks like a scan, try the EPUB" reads as help; "Import failed" reads as a
 * dead end. Mapped to Polish copy in `messages.ts`.
 */
export type ImportErrorCode =
  | "upload_failed"
  | "unsupported_format"
  | "file_too_large"
  | "extract_failed"
  | "ocr_required"
  | "chapter_detection_failed"
  | "storage_failed"
  | "persist_failed"
  | "processing_failed";
