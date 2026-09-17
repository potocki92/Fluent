/**
 * The content pipeline, end to end.
 *
 *     raw source
 *        ↓ normalize      strip markup, fix invisible characters
 *        ↓ paragraphs     blank line = paragraph, stable positions
 *        ↓ sentences      German-aware splitting
 *        ↓ tokenize       words, not `split(" ")`
 *        ↓ dictionary     token → word_id, via the shared de-inflection rules
 *        = ProcessedChapter
 *
 * TWO LAYERS, AND THE SECOND ONE MOVES ON ITS OWN. Everything above the
 * dictionary line is STRUCTURE — paragraphs, sentences, tokens, positions — and
 * it depends only on the source text. The dictionary line is KNOWLEDGE, and it
 * is the only part of the output that depends on what `words` happens to contain
 * today. They are deliberately not fused: every lexical token gets an
 * occurrence, and `wordId` is simply null when Fluent cannot gloss it yet.
 *
 * That is the invariant this file exists to protect:
 *
 *     Every lexical token gets an occurrence. Dictionary resolution is
 *     OPTIONAL and may evolve independently of the immutable reading structure.
 *
 * It used to be the opposite — a token only became a row if it matched — which
 * made the structure of a book a function of the dictionary as it stood on the
 * day it was imported. Adding *ziehen* a month later could then only reach an
 * existing book by REPROCESSING it: rewriting paragraphs, sentences and
 * occurrences to change one nullable column. Now the rows are already there and
 * resolution is a separate, cheap, idempotent pass
 * (`src/lib/content/dictionary-sync.ts`).
 *
 * PURE. No Supabase, no clock, no randomness, no I/O — persisting the result is
 * `src/actions/admin-library.ts`'s job, and the split is what lets the whole
 * pipeline be unit-tested on a fixture instead of against a database.
 *
 * DETERMINISTIC. The same source and the same dictionary always produce the same
 * structure, down to every position. That is not a nicety: paragraph and
 * sentence positions are stored, reading progress points at them, and
 * reprocessing a chapter must not move a learner's bookmark. The guarantee is
 * asserted directly in `process.test.ts`.
 *
 * WHAT IT DOES NOT DO. No translation, no simplification, no grammar analysis,
 * no AI of any kind. Those columns exist on `sentences` and stay null until
 * there is a workflow worth spending on them.
 */

import {
  buildDictionaryIndex,
  isReportableGap,
  matchToken,
  type DictionaryEntry,
  type DictionaryIndex,
} from "@/lib/content/dictionary-match";
import { toSourceText } from "@/lib/content/normalize";
import {
  countWords,
  splitParagraphs,
  type ParagraphKind,
} from "@/lib/content/paragraphs";
import { splitSentences } from "@/lib/content/sentences";
import { tokenize } from "@/lib/content/tokenize";
import { CONTENT_PROCESSOR_VERSION } from "@/lib/content/version";

/**
 * One interactive word inside a sentence — EVERY lexical token gets one.
 *
 * `surface` is the token exactly as the page shows it (*Bücher*, *zog*, *E-Mail*)
 * and is what the reader renders; `normalized` is the lookup key — lowercased
 * with the apostrophe variants folded, umlauts intact — and is what dictionary
 * resolution is keyed on, now and in every later pass.
 *
 * `wordId` is the CURRENT dictionary's answer, and `null` is a legitimate one: it
 * says "no entry today", never "this is not a word". `lemma` is then PROVISIONAL
 * — the normalized surface standing in for a headword nobody has curated yet —
 * and both fields are replaced, in place, the moment the dictionary learns the
 * word (`src/lib/content/dictionary-sync.ts`). Nothing else about the occurrence
 * ever changes: its position, its offsets and its row id are structure.
 */
export interface ProcessedOccurrence {
  /** Index among the sentence's lexical tokens — NOT among its matched ones. */
  position: number;
  surface: string;
  normalized: string;
  /** The dictionary headword, or the normalized surface while there is none. */
  lemma: string;
  /** Null until some dictionary knows this token. Never a reason to skip a row. */
  wordId: number | null;
  charStart: number;
  charEnd: number;
}

export interface ProcessedSentence {
  position: number;
  /** Position within the CHAPTER, so reading order needs no join. */
  chapterPosition: number;
  text: string;
  charStart: number;
  charEnd: number;
  wordCount: number;
  occurrences: ProcessedOccurrence[];
}

export interface ProcessedParagraph {
  position: number;
  kind: ParagraphKind;
  text: string;
  wordCount: number;
  sentences: ProcessedSentence[];
}

/**
 * What the pipeline learned about the chapter's vocabulary.
 *
 * `matchRate` is the content-quality metric: a chapter where Fluent can gloss
 * 92% of the content words is usable, one at 40% is a chapter the reader would
 * leave a learner stranded in. `unmatchedSample` is what makes that number
 * actionable — it names the words the dictionary is missing.
 */
export interface ChapterVocabularyStats {
  wordCount: number;
  uniqueWordCount: number;
  lexicalTokenCount: number;
  matchedTokenCount: number;
  unmatchedTokenCount: number;
  /** Distinct dictionary entries the chapter uses. */
  matchedWordCount: number;
  /** 0–1. Matched share of the tokens that could plausibly be matched. */
  matchRate: number;
  /** Most frequent unmatched content words, worst first. Bounded. */
  unmatchedSample: { token: string; count: number }[];
}

/** Distinct dictionary words used by the chapter, with their frequencies. */
export interface ChapterVocabularyEntry {
  wordId: number;
  lemma: string;
  occurrenceCount: number;
  /** Paragraph/sentence position of the first occurrence, for "show me where". */
  firstParagraphPosition: number;
  firstSentencePosition: number;
}

export interface ProcessedChapter {
  processorVersion: string;
  paragraphs: ProcessedParagraph[];
  vocabulary: ChapterVocabularyEntry[];
  stats: ChapterVocabularyStats;
  wordCount: number;
  paragraphCount: number;
  sentenceCount: number;
}

/** How many distinct unmatched words to keep. Enough to act on, not a dump. */
const UNMATCHED_SAMPLE_SIZE = 40;

/**
 * Run the pipeline.
 *
 * `entries` is the dictionary to match against, in a stable order — pass it
 * ordered by id, as `src/actions/admin-library.ts` does, or the index's
 * collision resolution (and therefore the output) becomes order-dependent.
 */
export function processChapterContent(
  source: string,
  entries: readonly DictionaryEntry[],
): ProcessedChapter {
  return processWithIndex(source, buildDictionaryIndex(entries));
}

/** Same as {@link processChapterContent} with a pre-built index — for batches. */
export function processWithIndex(
  source: string,
  index: DictionaryIndex,
): ProcessedChapter {
  const blocks = splitParagraphs(toSourceText(source));

  const paragraphs: ProcessedParagraph[] = [];
  const vocabulary = new Map<number, ChapterVocabularyEntry>();
  const unmatched = new Map<string, number>();
  const uniqueWords = new Set<string>();

  let chapterSentencePosition = 0;
  let wordCount = 0;
  let sentenceCount = 0;
  let lexicalTokens = 0;
  let matchedTokens = 0;
  let reportableTokens = 0;

  for (const block of blocks) {
    const sentences: ProcessedSentence[] = [];

    for (const sentence of splitSentences(block.text)) {
      const tokens = tokenize(sentence.text);
      const occurrences: ProcessedOccurrence[] = [];

      for (const token of tokens) {
        lexicalTokens += 1;
        uniqueWords.add(token.normalized);

        const hit = matchToken(token.surface, index);

        // THE ROW IS WRITTEN EITHER WAY. This single `push` outside the `if` is
        // the whole architectural change: what the dictionary knows decides what
        // the occurrence SAYS, never whether it exists.
        occurrences.push({
          position: token.position,
          surface: token.surface,
          normalized: token.normalized,
          lemma: hit?.lemma ?? token.normalized,
          wordId: hit?.wordId ?? null,
          charStart: token.charStart,
          charEnd: token.charEnd,
        });

        if (hit) {
          matchedTokens += 1;
          reportableTokens += 1;

          const known = vocabulary.get(hit.wordId);
          if (known) {
            known.occurrenceCount += 1;
          } else {
            vocabulary.set(hit.wordId, {
              wordId: hit.wordId,
              lemma: hit.lemma,
              occurrenceCount: 1,
              firstParagraphPosition: block.position,
              firstSentencePosition: chapterSentencePosition,
            });
          }
          continue;
        }

        // THE STATISTICS STILL MEAN WHAT THEY MEANT. `matchRate`,
        // `unmatchedSample` and `chapter_vocabulary` are about the DICTIONARY's
        // reach, not about how many rows were written, so they keep counting
        // real matches only — otherwise a chapter full of unknown words would
        // report a perfect match rate the day this changed.
        //
        // A gap worth reporting is a content word Fluent cannot gloss. Function
        // words and two-letter tokens are neither a gap nor a failure.
        if (isReportableGap(token.surface)) {
          reportableTokens += 1;
          unmatched.set(token.normalized, (unmatched.get(token.normalized) ?? 0) + 1);
        }
      }

      sentences.push({
        position: sentence.position,
        chapterPosition: chapterSentencePosition,
        text: sentence.text,
        charStart: sentence.charStart,
        charEnd: sentence.charEnd,
        wordCount: tokens.length,
        occurrences,
      });

      chapterSentencePosition += 1;
      sentenceCount += 1;
    }

    const blockWords = countWords(block.text);
    wordCount += blockWords;

    paragraphs.push({
      position: block.position,
      kind: block.kind,
      text: block.text,
      wordCount: blockWords,
      sentences,
    });
  }

  return {
    processorVersion: CONTENT_PROCESSOR_VERSION,
    paragraphs,
    // Sorted by frequency so "the words this chapter leans on" is the head of
    // the list — that is the order a pre-reading vocabulary set wants.
    vocabulary: [...vocabulary.values()].sort(
      (a, b) => b.occurrenceCount - a.occurrenceCount || a.wordId - b.wordId,
    ),
    stats: {
      wordCount,
      uniqueWordCount: uniqueWords.size,
      lexicalTokenCount: lexicalTokens,
      matchedTokenCount: matchedTokens,
      unmatchedTokenCount: reportableTokens - matchedTokens,
      matchedWordCount: vocabulary.size,
      matchRate: reportableTokens === 0 ? 0 : round(matchedTokens / reportableTokens),
      unmatchedSample: [...unmatched.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, UNMATCHED_SAMPLE_SIZE)
        .map(([token, count]) => ({ token, count })),
    },
    wordCount,
    paragraphCount: paragraphs.length,
    sentenceCount,
  };
}

/**
 * A stable fingerprint of the SOURCE, used to skip pointless reprocessing.
 *
 * Paired with {@link CONTENT_PROCESSOR_VERSION}: identical hash AND identical
 * processor means the stored structure is already exactly what this run would
 * produce, so the rows — and every reading position pointing at them — are left
 * alone. Not a security primitive; it only has to change when the text changes.
 */
export function contentHash(source: string): string {
  const normalized = toSourceText(source);
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;

  for (let i = 0; i < normalized.length; i += 1) {
    const code = normalized.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 0x01000193) >>> 0;
    h2 = Math.imul(h2 + code + i, 0x85ebca6b) >>> 0;
  }

  return `${h1.toString(16).padStart(8, "0")}${h2.toString(16).padStart(8, "0")}`;
}

function round(value: number): number {
  return Math.round(value * 10000) / 10000;
}
