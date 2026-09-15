/**
 * Turning a saved note into a review card.
 *
 * THE POINT OF THE WHOLE PHASE IS HERE. A learner who met *sollten* in
 *
 *     „Wir sollten umkehren“, drängte Gared.
 *
 * and is later shown
 *
 *     sollen — powinien / mieć powinność
 *
 * has been handed a dictionary entry with the reading cut off it. The sentence
 * is what made the word mean anything, and every card below keeps it.
 *
 * A CARD IS A PRESENTATION, NOT A SECOND SCHEDULER (§69, §70). Nothing in this
 * module schedules, grades or stores. It takes an item the learner already
 * chose to review and decides what the front and the back of it say; the
 * interval comes from `src/lib/sm2.ts`, exactly as it does for a word card, and
 * the grading goes through the same `review_events` log. One item can be shown
 * several ways without becoming several items.
 *
 * NOTHING IS GENERATED (§67). Every card here is a deterministic rearrangement
 * of text the learner or the book already wrote: a cloze cut at stored offsets,
 * a phrase and its meaning, a translation and its original. Fluent does not
 * invent a comprehension question about a chapter it cannot read, and this phase
 * makes no model call at all.
 */

import { buildCloze, renderCloze, type Cloze } from "@/lib/notebook/cloze";
import type {
  ReviewDirection,
  ReviewMode,
  RetrievalType,
} from "@/lib/learning/evidence";

/** How a notebook item is being asked. */
export type NotebookCardKind =
  /** "Wir ______ umkehren." → produce the German form that was there. */
  | "context_cloze"
  /** "What does *sollten* mean HERE?" → recall the contextual meaning. */
  | "context_meaning"
  /** "Angst machen" → recall the phrase's meaning, with its sentence. */
  | "phrase"
  /** The learner's own Polish → recall the German sentence it came from. */
  | "sentence_translation";

/** The material a card is built from. Whatever stored it, this is the shape. */
export interface NotebookCardSource {
  /** The German span the card is about — a word, a phrase, or nothing. */
  surface: string | null;
  /** The sentence, as snapshotted when the note was taken. */
  sentenceText: string;
  /** Offsets of the span within {@link sentenceText}, when they are known. */
  charStart: number | null;
  charEnd: number | null;
  /** What the LEARNER wrote about this span, in Polish. */
  meaning: string | null;
  /** The learner's own Polish for the whole sentence. */
  translation: string | null;
  /** The shared dictionary's general translation of the lexeme, if any. */
  dictionaryTranslation: string | null;
}

/** A card, ready to render. Every string here is plain text, never markup. */
export interface NotebookCard {
  kind: NotebookCardKind;
  /** What the learner is shown first. */
  front: string;
  /** The answer. */
  back: string;
  /** Shown with the answer as the original context, when it adds anything. */
  context: string | null;
  /** The Polish question above the front, e.g. "Co znaczy tu to słowo?". */
  prompt: string;
  /** Present only for a cloze, so the UI can style the blank. */
  cloze: Cloze | null;
  /** What the grading of this card proves — see `src/lib/learning/evidence.ts`. */
  mode: ReviewMode;
  direction: ReviewDirection;
  retrieval: RetrievalType;
}

/**
 * Which way round a word annotation is best asked.
 *
 * A cloze is the stronger exercise by a distance — it makes the learner produce
 * the inflected German with nothing to choose from — so it is preferred whenever
 * the offsets make one possible. When they do not (a card saved before the
 * offsets existed, or a chapter reprocessed out from under it) the meaning
 * question still works, and a weaker honest card beats a cloze with the wrong
 * word blanked.
 */
export function wordCardKind(source: NotebookCardSource): NotebookCardKind {
  return buildCloze(source.sentenceText, source.charStart, source.charEnd)
    ? "context_cloze"
    : "context_meaning";
}

/** Build the card for a single-token (word or personal-word) annotation. */
export function buildWordCard(source: NotebookCardSource): NotebookCard {
  const cloze = buildCloze(source.sentenceText, source.charStart, source.charEnd);
  const gloss = source.meaning ?? source.dictionaryTranslation ?? "";

  if (cloze) {
    return {
      kind: "context_cloze",
      front: renderCloze(cloze),
      back: cloze.answer,
      // The meaning is the HINT that makes the blank answerable, so it belongs
      // on the front. Without it the exercise is "guess which German word I was
      // thinking of", which tests nothing.
      context: gloss || null,
      prompt: "Uzupełnij zdanie",
      cloze,
      // SELF-RATED, BECAUSE THAT IS WHAT THE UI ACTUALLY DOES. The learner
      // reveals the answer and grades themselves; nothing was typed and nothing
      // was checked, so recording it at the `typed` weight would be the evidence
      // map lying about its own exercise.
      mode: "flashcard",
      // …but the RETRIEVAL is still recall: the prompt is Polish and a sentence
      // frame, and the answer is German with nothing to pick from. That is what
      // `reviewRetrievalType('flashcard', 'pl_to_de')` already says, and it is
      // why this is the one notebook card that feeds ACTIVE vocabulary.
      direction: "pl_to_de",
      retrieval: "cued_recall",
    };
  }

  return {
    kind: "context_meaning",
    front: source.sentenceText,
    back: gloss,
    context: source.surface,
    prompt: source.surface
      ? `Co oznacza tutaj „${source.surface}”?`
      : "Co oznacza to słowo tutaj?",
    cloze: null,
    mode: "flashcard",
    direction: "de_to_pl",
    retrieval: "recognition",
  };
}

/** Build the card for a phrase. */
export function buildPhraseCard(source: NotebookCardSource): NotebookCard {
  return {
    kind: "phrase",
    front: source.surface ?? "",
    back: source.meaning ?? "",
    context: source.sentenceText,
    prompt: "Co oznacza ten zwrot?",
    cloze: null,
    mode: "flashcard",
    direction: "de_to_pl",
    retrieval: "recognition",
  };
}

/**
 * Build the card for a sentence translation.
 *
 * Polish on the front, German on the back (§63): the learner reconstructs the
 * sentence they once worked out, which is a production exercise. The reverse
 * would be a reading-comprehension card whose answer they wrote themselves, and
 * is therefore not a test of anything.
 */
export function buildTranslationCard(source: NotebookCardSource): NotebookCard {
  return {
    kind: "sentence_translation",
    front: source.translation ?? "",
    back: source.sentenceText,
    context: null,
    prompt: "Jak brzmiało to zdanie po niemiecku?",
    cloze: null,
    mode: "flashcard",
    direction: "pl_to_de",
    retrieval: "cued_recall",
  };
}
