/**
 * The extractor registry.
 *
 * Three implementations of one interface, asked in order. A fourth format —
 * DOCX is the obvious next one — is a new file here and one entry in this
 * array; nothing downstream changes, because everything downstream speaks
 * {@link ExtractedBook} and has never heard of a PDF.
 *
 * ORDER MATTERS ONLY AS A TIE-BREAK. `FileIdentity.format` comes from the
 * file's magic bytes, so exactly one extractor claims any given file. The array
 * is ordered by how specific the claim is regardless, so that a future extractor
 * with a looser `canHandle` cannot quietly take a PDF.
 */

import { epubExtractor } from "@/lib/import/extract/epub";
import { pdfExtractor } from "@/lib/import/extract/pdf";
import { textExtractor } from "@/lib/import/extract/text";
import type { BookExtractor, FileIdentity } from "@/lib/import/types";

const EXTRACTORS: readonly BookExtractor[] = [
  pdfExtractor,
  epubExtractor,
  textExtractor,
];

/** The extractor for this file, or null when Fluent cannot read the format. */
export function selectExtractor(identity: FileIdentity): BookExtractor | null {
  return EXTRACTORS.find((extractor) => extractor.canHandle(identity)) ?? null;
}
