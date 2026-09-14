/**
 * Splitting a chapter into pieces a generator can hold.
 *
 * A 15 000-word chapter does not fit sensibly in one request, and the naive fix —
 * slicing at a character count — cuts through the middle of a sentence, which
 * produces questions about half a clause. So chunks are built from SENTENCES,
 * which the content pipeline has already identified correctly (abbreviations,
 * dialogue, ordinals and all); the boundary is always between two of them.
 *
 * TWO KINDS OF QUESTION, TWO KINDS OF REQUEST. Some questions are local — a
 * detail, a word in its sentence, a grammar pattern — and a chunk is all the
 * context they need. Others are about the chapter as a whole: what it was
 * mainly about, what happened in what order. Those cannot be written from a
 * chunk that contains only the middle, and a pipeline that pretended otherwise
 * would produce "main idea" questions about a scene. So the chapter is covered
 * twice: once in overlapping chunks for local questions, and once as a condensed
 * whole for synthesis.
 *
 * SPOILER BOUNDARY, for free. A chunk never contains anything from another
 * chapter, because chunks are built from one chapter's sentences and nothing
 * else is ever loaded. The generator for chapter 4 cannot leak chapter 5 because
 * it has never seen it — which is the foundation a real Spoiler Guard is built
 * on, not a substitute for one.
 *
 * Pure and deterministic: same sentences in, same chunks out, so re-running a
 * generation for an unchanged chapter asks the same questions of the model.
 */

import {
  GENERATION_CHUNK_OVERLAP_SENTENCES,
  GENERATION_CHUNK_SENTENCES,
} from "@/lib/story/constants";
import type { GenerationSentence } from "@/lib/story/generation/provider";

export interface GenerationChunk {
  index: number;
  sentences: GenerationSentence[];
  /** True for the chunk containing the chapter's first sentence. */
  isOpening: boolean;
  isClosing: boolean;
}

/**
 * Cut a chapter into overlapping runs of sentences.
 *
 * The overlap exists because a question about a moment that straddles a boundary
 * would otherwise be unaskable: without it, the last sentence of chunk one and
 * the first of chunk two never appear together in any request.
 */
export function chunkSentences(
  sentences: readonly GenerationSentence[],
  size = GENERATION_CHUNK_SENTENCES,
  overlap = GENERATION_CHUNK_OVERLAP_SENTENCES,
): GenerationChunk[] {
  if (sentences.length === 0) return [];

  const step = Math.max(1, size - Math.max(0, overlap));
  const chunks: GenerationChunk[] = [];

  for (let start = 0; start < sentences.length; start += step) {
    const slice = sentences.slice(start, start + size);
    if (slice.length === 0) break;

    chunks.push({
      index: chunks.length,
      sentences: slice,
      isOpening: start === 0,
      isClosing: start + size >= sentences.length,
    });

    if (start + size >= sentences.length) break;
  }

  return chunks;
}

/**
 * A condensed view of the whole chapter, for chapter-level questions.
 *
 * Takes an evenly spread sample rather than the first N sentences: "what
 * happened in what order" needs the shape of the chapter, and the opening third
 * of a chapter is not its shape. The sample keeps its sentence ids, so a
 * synthesis question is grounded in exactly the same way a local one is.
 */
export function chapterOutline(
  sentences: readonly GenerationSentence[],
  maxSentences = GENERATION_CHUNK_SENTENCES,
): GenerationSentence[] {
  if (sentences.length <= maxSentences) return [...sentences];

  const stride = sentences.length / maxSentences;
  const sampled: GenerationSentence[] = [];

  for (let i = 0; i < maxSentences; i += 1) {
    const index = Math.min(sentences.length - 1, Math.floor(i * stride));
    const sentence = sentences[index];
    if (sentence && sampled.at(-1)?.id !== sentence.id) sampled.push(sentence);
  }

  // The last sentence is always worth having: chapters end on the thing that
  // happened, and a sample that stops short of it cannot ask about the ending.
  const last = sentences[sentences.length - 1];
  if (last && sampled.at(-1)?.id !== last.id) sampled.push(last);

  return sampled;
}

/** Sentence ids in a chunk, for the grounding check the pipeline runs after. */
export function chunkSentenceIds(chunk: GenerationChunk): Set<number> {
  return new Set(chunk.sentences.map((sentence) => sentence.id));
}
