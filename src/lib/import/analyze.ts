/**
 * The analysis pipeline, end to end.
 *
 *     bytes
 *        ↓ validate     magic bytes, size, format
 *        ↓ extract      PDF / EPUB / TXT → pages
 *        ↓ assess       is there usable text here at all?
 *        ↓ clean        running heads, folios, line wraps, hyphens
 *        ↓ detect       chapters, with confidence
 *        ↓ language     German? and how sure
 *        = AnalyzedBook
 *
 * PURE APART FROM THE EXTRACTORS. No Supabase, no clock, no randomness — the
 * caller persists what comes back, which is what lets the whole pipeline be
 * exercised on a fixture file in a unit test rather than against a database.
 *
 * NO AI. Every stage above is arithmetic over the file's own bytes. Importing a
 * digital book costs Fluent nothing but CPU, which is the point: a learner who
 * imports forty books should cost forty times zero.
 *
 * DETERMINISTIC, and stamped {@link IMPORT_PIPELINE_VERSION} so that a future
 * change to cleanup can be told from an old import that predates it.
 */

import { detectChapters } from "@/lib/import/chapters/detect";
import { cleanExtractedPages } from "@/lib/import/cleanup";
import { IMPORT_PIPELINE_VERSION } from "@/lib/import/constants";
import { selectExtractor } from "@/lib/import/extract";
import { detectLanguage } from "@/lib/import/language";
import { assessExtraction } from "@/lib/import/quality";
import { MAGIC_BYTE_WINDOW, validateBookFile } from "@/lib/import/validate";
import type { AnalyzedBook, ImportErrorCode } from "@/lib/import/types";

export interface AnalyzeInput {
  bytes: Uint8Array;
  fileName: string;
  mimeType: string | null;
}

export type AnalyzeResult =
  | { ok: true; book: AnalyzedBook }
  | { ok: false; code: ImportErrorCode; detail: string };

/** Run every stage. Returns a classified failure rather than throwing. */
export async function analyzeBook(input: AnalyzeInput): Promise<AnalyzeResult> {
  const validation = validateBookFile({
    fileName: input.fileName,
    mimeType: input.mimeType,
    size: input.bytes.length,
    head: input.bytes.subarray(0, MAGIC_BYTE_WINDOW),
  });
  if (!validation.ok) return validation;

  const extractor = selectExtractor(validation.identity);
  if (!extractor) {
    return { ok: false, code: "unsupported_format", detail: validation.identity.format };
  }

  let extracted;
  try {
    extracted = await extractor.extract(input.bytes);
  } catch (cause) {
    return {
      ok: false,
      code: "extract_failed",
      // The message, never the content: an extractor error can quote a fragment
      // of the file, and a learner's book must not end up in a log line.
      detail: cause instanceof Error ? cause.name : "extract threw",
    };
  }

  const quality = assessExtraction(extracted.pages);
  if (quality.looksScanned) {
    return {
      ok: false,
      code: "ocr_required",
      detail: `${quality.sparsePages}/${quality.totalPages} pages without a text layer`,
    };
  }

  const cleaned = cleanExtractedPages(extracted.pages);
  const detection = detectChapters(cleaned.blocks, {
    declared: extracted.declaredChapters,
    fallbackTitle: extracted.metadata.title,
  });

  if (detection.chapters.length === 0) {
    return { ok: false, code: "chapter_detection_failed", detail: "no content blocks" };
  }

  const wordCount = detection.chapters.reduce(
    (sum, chapter) => sum + chapter.wordCount,
    0,
  );

  return {
    ok: true,
    book: {
      format: extracted.format,
      metadata: extracted.metadata,
      pageCount: extracted.pageCount,
      wordCount,
      // Sampled from the book's own prose rather than from the raw pages, so
      // running heads and folios cannot vote on what language it is in.
      language: detectLanguage(
        detection.chapters
          .filter((chapter) => !chapter.isFrontMatter)
          .map((chapter) => chapter.text)
          .join("\n"),
      ),
      quality,
      detection,
      pipelineVersion: IMPORT_PIPELINE_VERSION,
    },
  };
}
