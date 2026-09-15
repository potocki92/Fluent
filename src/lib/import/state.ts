/**
 * The import's state machine, and the Polish the learner reads.
 *
 * TWO AXES, NOT ONE. `status` is where the import is in its life — is it waiting
 * for me, is it working, is it finished, did it break. `stage` is what the work
 * is *doing* right now. They are separate because they answer separate
 * questions: the status decides which screen renders, the stage decides what
 * that screen says. Collapsed into one field, the UI would have to show
 * "Processing…" for two minutes, which tells a learner nothing about whether
 * anything is happening.
 *
 *     uploaded ──▶ extracting ──▶ analyzing ──▶ awaiting_review
 *                      │              │               │
 *                      └──────────────┴──▶ failed     ▼
 *                                                 importing
 *                                                     │
 *                                                     ▼
 *                                                 processing ──▶ ready
 *
 * `cancelled` is reachable from anything before `importing`. After that the
 * import has become a book, and a book is deleted through the library, not
 * cancelled through the importer.
 *
 * Pure: types, transitions, and copy. The database enforces the same set through
 * a CHECK constraint, and the two are kept in step by hand — which is why the
 * transition table is here, in one readable place, rather than implied by
 * fifteen `update` calls.
 */

import type { ImportErrorCode } from "@/lib/import/types";

/** Where the import is in its life. */
export type ImportStatus =
  | "uploaded"
  | "extracting"
  | "analyzing"
  | "awaiting_review"
  | "importing"
  | "processing"
  | "ready"
  | "failed"
  | "cancelled";

/** What the work is doing. Null when the import is not working. */
export type ImportStage =
  | "extract_text"
  | "detect_metadata"
  | "detect_chapters"
  | "persist_content"
  | "process_chapters";

/** Statuses from which nothing further happens on its own. */
export const TERMINAL_STATUSES: readonly ImportStatus[] = [
  "ready",
  "failed",
  "cancelled",
];

/** Statuses where the import is waiting for the learner, not for a server. */
export const WAITING_STATUSES: readonly ImportStatus[] = ["awaiting_review"];

/**
 * Which statuses may follow which.
 *
 * Written down rather than implied so that "can this import be cancelled?" and
 * "can this import be finalised?" have one answer each, checked identically in
 * the server action and in the UI that enables the button.
 */
const TRANSITIONS: Readonly<Record<ImportStatus, readonly ImportStatus[]>> = {
  uploaded: ["extracting", "failed", "cancelled"],
  extracting: ["analyzing", "failed", "cancelled"],
  analyzing: ["awaiting_review", "failed", "cancelled"],
  awaiting_review: ["importing", "failed", "cancelled"],
  // `importing` never goes back: once a library item exists, the import has
  // produced a book and cancelling would orphan it.
  importing: ["processing", "failed"],
  processing: ["ready", "failed"],
  ready: [],
  failed: ["extracting", "importing", "processing", "cancelled"],
  cancelled: [],
};

export function canTransition(from: ImportStatus, to: ImportStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** The import has produced (or is producing) a book. Cancel is no longer it. */
export function hasBecomeBook(status: ImportStatus): boolean {
  return status === "importing" || status === "processing" || status === "ready";
}

/** Is there server work left that a worker call would advance? */
export function isWorkable(status: ImportStatus): boolean {
  return (
    status === "uploaded" ||
    status === "extracting" ||
    status === "analyzing" ||
    status === "importing" ||
    status === "processing"
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Copy
// ─────────────────────────────────────────────────────────────────────────────

/** What the learner sees while an import works. Specific, never "Processing…". */
export const STAGE_LABELS: Readonly<Record<ImportStage, string>> = {
  extract_text: "Odczytuję tekst z pliku…",
  detect_metadata: "Sprawdzam tytuł i język…",
  detect_chapters: "Wykrywam rozdziały…",
  persist_content: "Zapisuję książkę…",
  process_chapters: "Przygotowuję rozdziały do czytania…",
};

export const STATUS_LABELS: Readonly<Record<ImportStatus, string>> = {
  uploaded: "Plik przesłany",
  extracting: "Odczytywanie tekstu",
  analyzing: "Analiza książki",
  awaiting_review: "Czeka na Twoje potwierdzenie",
  importing: "Tworzenie książki",
  processing: "Przygotowywanie rozdziałów",
  ready: "Gotowe",
  failed: "Nie udało się",
  cancelled: "Anulowane",
};

/**
 * Why it stopped, in Polish, said usefully.
 *
 * "Import failed" is a dead end. "This PDF looks like a scan — if you have the
 * EPUB, it usually reads better" is the same fact and a next step, which is the
 * difference between an error message and help. Every string here names what
 * happened and, where there is one, what to try.
 */
export const IMPORT_ERROR_MESSAGES: Readonly<Record<ImportErrorCode, string>> = {
  upload_failed: "Nie udało się przesłać pliku. Sprawdź połączenie i spróbuj ponownie.",
  unsupported_format:
    "Fluent nie rozpoznaje tego pliku. Obsługujemy PDF, EPUB i TXT.",
  file_too_large: "Ten plik jest za duży.",
  extract_failed:
    "Nie udało się odczytać tekstu z tego pliku. Może być uszkodzony lub zabezpieczony hasłem.",
  ocr_required:
    "Ten PDF wygląda na skan — nie zawiera warstwy tekstowej, więc nie ma z czego czytać. Jeśli masz wersję EPUB, zwykle daje dużo lepszy tekst.",
  chapter_detection_failed:
    "Nie znaleźliśmy w tym pliku żadnego tekstu do podziału na rozdziały.",
  storage_failed: "Nie udało się zapisać pliku. Spróbuj ponownie za chwilę.",
  persist_failed: "Nie udało się utworzyć książki. Spróbuj ponownie.",
  processing_failed:
    "Część rozdziałów nie została przygotowana. Możesz spróbować ponownie.",
};

/** The one-line hint under an error, when there is something better to suggest. */
export const IMPORT_ERROR_HINTS: Partial<Record<ImportErrorCode, string>> = {
  ocr_required: "Rozpoznawanie tekstu ze skanów (OCR) planujemy na później.",
  file_too_large: "Spróbuj wersji EPUB — zwykle waży kilkanaście razy mniej.",
  extract_failed: "Jeśli plik jest chroniony hasłem, usuń zabezpieczenie i spróbuj ponownie.",
};

/** Confidence, as the preview labels it. Never a raw number. */
export const CONFIDENCE_LABELS = {
  high: "Pewne",
  medium: "Prawdopodobne",
  low: "Sprawdź",
} as const;
