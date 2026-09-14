/**
 * The Story Engine's read layer — the only file under `src/lib/story/` that
 * touches Supabase.
 *
 * Everything else in this directory is pure and unit-tested; this assembles the
 * rows those functions need. The split is the same one `src/lib/learning/` and
 * `src/lib/reading/` already use, and it is what lets the coverage estimate, the
 * preparation ranking and the question selection be tested without a database.
 *
 * BOUNDED, ALWAYS. Every query here is scoped to one chapter or one learner, and
 * the vocabulary reads are capped the same way `getChapterCoverage` caps its:
 * the book page can list forty chapters, and a per-chapter unbounded scan would
 * make opening a shelf quadratic in the size of the library.
 *
 * ONE DEFINITION OF COVERAGE. The percentage comes from `estimateCoverage` in
 * `src/lib/reading/coverage.ts` — the same function the reader and the book page
 * already call — because coverage computed three slightly different ways in
 * three screens is three numbers a learner will eventually watch disagree.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { estimateCoverage, type CoverageEstimate } from "@/lib/reading/coverage";
import { analyseChapter, lookupRate, type ChapterAnalysis } from "@/lib/story/analysis";
import { STORY_ENGINE_VERSION } from "@/lib/story/constants";
import type { WordEvidence } from "@/lib/story/knowledge";
import type { PreteachCandidate } from "@/lib/story/preparation";
import type { SelectableQuestion } from "@/lib/story/selection";
import type { QuestionKind } from "@/lib/story/constants";
import type { Database } from "@/types/database";
import type { StoredCefrLevel } from "@/types";

type Client = SupabaseClient<Database>;

/**
 * How many of a chapter's distinct words the analysis is judged on.
 *
 * The same cap `getChapterCoverage` uses, and it must stay the same: the tail of
 * a chapter's vocabulary is words that appear once, and slicing the two sides of
 * the ratio differently would silently depress every estimate.
 */
export const ANALYSIS_WORD_LIMIT = 500;

/** How many chapters of a book count towards the reading-history signal. */
const HISTORY_CHAPTER_LIMIT = 30;

export interface ChapterFacts {
  id: string;
  libraryItemId: string;
  position: number;
  title: string | null;
  slug: string;
  itemTitle: string;
  wordCount: number;
  paragraphCount: number;
  estimatedMinutes: number;
  cefr: StoredCefrLevel | null;
  contentHash: string | null;
  status: "draft" | "processing" | "ready" | "failed";
  isPrivate: boolean;
}

/** One chapter, plus the item it belongs to. Two joined rows, one query. */
export async function getChapterFacts(
  supabase: Client,
  chapterId: string,
): Promise<ChapterFacts | null> {
  const { data, error } = await supabase
    .from("chapters")
    .select(
      "id, library_item_id, position, title, word_count, paragraph_count, estimated_reading_minutes, cefr_estimate, content_hash, status, library_items(slug, title, cefr_estimate, rights)",
    )
    .eq("id", chapterId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  // PostgREST types an embedded one-to-one as an array in some versions and an
  // object in others; normalising here keeps the ambiguity out of every caller.
  const item = (Array.isArray(data.library_items)
    ? data.library_items[0]
    : data.library_items) as
    | { slug: string; title: string; cefr_estimate: StoredCefrLevel | null; rights: string }
    | null
    | undefined;

  return {
    id: data.id,
    libraryItemId: data.library_item_id,
    position: data.position,
    title: data.title,
    slug: item?.slug ?? "",
    itemTitle: item?.title ?? "",
    wordCount: data.word_count,
    paragraphCount: data.paragraph_count,
    estimatedMinutes: data.estimated_reading_minutes,
    // A chapter usually has no band of its own; the book's is the honest
    // fallback and is what the CEFR estimate was assigned to in the first place.
    cefr: data.cefr_estimate ?? item?.cefr_estimate ?? null,
    contentHash: data.content_hash,
    status: data.status,
    isPrivate: item?.rights === "private_import",
  };
}

export interface ChapterVocabularyEntry {
  wordId: number;
  occurrenceCount: number;
  firstParagraphPosition: number;
  firstSentencePosition: number;
}

/** The chapter's distinct words, most frequent first, capped. */
export async function getChapterVocabulary(
  supabase: Client,
  chapterId: string,
  limit = ANALYSIS_WORD_LIMIT,
): Promise<ChapterVocabularyEntry[]> {
  const { data, error } = await supabase
    .from("chapter_vocabulary")
    .select(
      "word_id, occurrence_count, first_paragraph_position, first_sentence_position",
    )
    .eq("chapter_id", chapterId)
    .order("occurrence_count", { ascending: false })
    .order("word_id", { ascending: true })
    .limit(limit);
  if (error) throw error;

  return (data ?? []).map((row) => ({
    wordId: row.word_id,
    occurrenceCount: row.occurrence_count,
    firstParagraphPosition: row.first_paragraph_position,
    firstSentencePosition: row.first_sentence_position,
  }));
}

/** What the knowledge model holds about exactly these words, receptively. */
export async function getWordKnowledge(
  supabase: Client,
  userId: string,
  wordIds: readonly number[],
): Promise<WordEvidence[]> {
  if (wordIds.length === 0) return [];

  const { data, error } = await supabase
    .from("user_word_knowledge")
    .select("word_id, receptive_score, receptive_confidence")
    .eq("user_id", userId)
    .in("word_id", [...wordIds]);
  if (error) throw error;

  return (data ?? []).map((row) => ({
    wordId: row.word_id,
    score: row.receptive_score === null ? null : Number(row.receptive_score),
    confidence: Number(row.receptive_confidence ?? 0),
  }));
}

export interface BookReadingHistory {
  chaptersCompleted: number;
  lookupRate: number | null;
}

/**
 * How this learner has actually fared in this book so far.
 *
 * The only MEASURED difficulty signal there is, which is why it outweighs the
 * CEFR guess in `personalDifficulty`. The denominator is progress-weighted —
 * words actually reached, not the chapters' full length — because dividing by
 * words nobody read would make every abandoned chapter look easy.
 */
export async function getBookReadingHistory(
  supabase: Client,
  userId: string,
  libraryItemId: string,
  excludeChapterId?: string,
): Promise<BookReadingHistory> {
  const { data, error } = await supabase
    .from("reading_progress")
    .select("chapter_id, completed_at, lookup_count, progress_ratio, chapters(word_count)")
    .eq("user_id", userId)
    .eq("library_item_id", libraryItemId)
    .limit(HISTORY_CHAPTER_LIMIT);
  if (error) throw error;

  let chaptersCompleted = 0;
  let lookups = 0;
  let wordsRead = 0;

  for (const row of data ?? []) {
    if (excludeChapterId && row.chapter_id === excludeChapterId) continue;
    if (row.completed_at) chaptersCompleted += 1;

    const chapter = (Array.isArray(row.chapters) ? row.chapters[0] : row.chapters) as
      | { word_count: number }
      | null
      | undefined;
    lookups += row.lookup_count;
    wordsRead += (chapter?.word_count ?? 0) * Number(row.progress_ratio ?? 0);
  }

  return {
    chaptersCompleted,
    lookupRate: lookupRate({ lookupCount: lookups, wordsRead: Math.round(wordsRead) }),
  };
}

/** One question of the bank, as far as ranking is concerned. */
export interface ChapterQuestionCandidate extends SelectableQuestion {
  kind: QuestionKind;
}

/**
 * The Challenge's candidate pool.
 *
 * Goes through the RPC rather than a table read, because `chapter_questions` has
 * no learner SELECT policy at all: the pool carries metadata and this learner's
 * answering history, and never a prompt, an option or a key. The whole
 * personalisation layer therefore runs on data that could be shown to a learner
 * without teaching them anything.
 */
export async function getChapterQuestionCandidates(
  supabase: Client,
  chapterId: string,
): Promise<ChapterQuestionCandidate[]> {
  const { data, error } = await supabase.rpc("get_chapter_question_candidates", {
    p_chapter_id: chapterId,
  });
  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: row.question_id,
    kind: row.kind as QuestionKind,
    difficulty: row.difficulty,
    conceptCodes: row.concept_codes ?? [],
    wordId: row.word_id,
    lastAnsweredAt: row.last_answered_at,
  }));
}

/**
 * How much of this chapter's grammar the learner is currently failing, 0–1.
 *
 * ABSENT RATHER THAN GUESSED when the chapter has no tagged questions, which is
 * every chapter until a bank exists. Returning 0 there would tell a new reader
 * that a chapter's grammar is comfortable on the strength of no evidence at all;
 * returning null keeps the signal out of the difficulty score entirely.
 */
export async function getChapterWeaknessPressure(
  supabase: Client,
  userId: string,
  conceptCodes: readonly string[],
): Promise<number | null> {
  const codes = [...new Set(conceptCodes)];
  if (codes.length === 0) return null;

  const { data, error } = await supabase
    .from("user_concept_state")
    .select("concept_code, score, confidence")
    .eq("user_id", userId)
    .in("concept_code", codes);
  if (error) throw error;

  const observed = (data ?? []).filter(
    (row) => row.score !== null && Number(row.confidence ?? 0) > 0,
  );
  if (observed.length === 0) return null;

  // Averaged over the concepts we have evidence about, not over every concept
  // the chapter touches: an unmeasured concept is not a concept the learner
  // is fine at.
  const pressure =
    observed.reduce((acc, row) => acc + (1 - Number(row.score)), 0) / observed.length;
  return Math.min(1, Math.max(0, pressure));
}

/** Concepts the learner is currently failing, with 0–1 severity. */
export async function getWeakConceptSeverity(
  supabase: Client,
  userId: string,
): Promise<Map<string, number>> {
  const { data, error } = await supabase
    .from("user_concept_state")
    .select("concept_code, score, confidence")
    .eq("user_id", userId)
    .not("score", "is", null);
  if (error) throw error;

  const severity = new Map<string, number>();
  for (const row of data ?? []) {
    const score = Number(row.score);
    const confidence = Number(row.confidence ?? 0);
    if (!Number.isFinite(score) || confidence <= 0) continue;
    // Weighted by confidence, so a concept failed once does not outrank one
    // failed a dozen times.
    severity.set(row.concept_code, Math.min(1, Math.max(0, (1 - score) * confidence)));
  }
  return severity;
}

/**
 * The words of this chapter that could be pre-taught, with everything the
 * ranking needs to score them.
 *
 * Three bounded queries: the chapter's vocabulary, the dictionary rows for
 * exactly those words, and the sentences their first occurrences sit in. The
 * sentence read is limited to the chapter's OPENING, because that is the only
 * part the spoiler rule allows a preparation card to quote.
 */
export async function getPreteachCandidates(
  supabase: Client,
  chapterId: string,
  vocabulary: readonly ChapterVocabularyEntry[],
): Promise<PreteachCandidate[]> {
  if (vocabulary.length === 0) return [];

  const wordIds = vocabulary.map((entry) => entry.wordId);

  const [{ data: words, error: wordsError }, { data: sentences }] = await Promise.all([
    supabase
      .from("words")
      .select("id, lemma, display, translation_pl, cefr, example_de, word_type")
      .in("id", wordIds),
    supabase
      .from("sentences")
      .select("id, chapter_position, text")
      .eq("chapter_id", chapterId)
      .in(
        "chapter_position",
        [...new Set(vocabulary.map((entry) => entry.firstSentencePosition))].slice(0, 200),
      ),
  ]);
  if (wordsError) throw wordsError;

  const byWord = new Map((words ?? []).map((word) => [word.id, word]));
  const byPosition = new Map(
    (sentences ?? []).map((sentence) => [sentence.chapter_position, sentence]),
  );

  return vocabulary.flatMap((entry) => {
    const word = byWord.get(entry.wordId);
    if (!word) return [];

    const sentence = byPosition.get(entry.firstSentencePosition);

    return [
      {
        wordId: entry.wordId,
        lemma: word.lemma,
        display: word.display,
        translationPl: word.translation_pl,
        cefr: word.cefr,
        occurrenceCount: entry.occurrenceCount,
        firstParagraphPosition: entry.firstParagraphPosition,
        firstSentencePosition: entry.firstSentencePosition,
        contextSentence: sentence?.text ?? null,
        dictionaryExample: word.example_de,
        // A noun's gender is the one concept a dictionary row can honestly
        // claim a word exercises. Anything more would be guessing.
        conceptCodes: word.word_type === "noun" ? ["word_gender"] : [],
      },
    ];
  });
}

/** Sentence ids the preparation snapshot may reference, keyed by position. */
export async function getSentenceIdsByPosition(
  supabase: Client,
  chapterId: string,
  positions: readonly number[],
): Promise<Map<number, number>> {
  if (positions.length === 0) return new Map();

  const { data, error } = await supabase
    .from("sentences")
    .select("id, chapter_position")
    .eq("chapter_id", chapterId)
    .in("chapter_position", [...new Set(positions)]);
  if (error) throw error;

  return new Map((data ?? []).map((row) => [row.chapter_position, row.id]));
}

/** The cached analysis, when there is one that still describes this chapter. */
export async function getCachedAnalysis(
  supabase: Client,
  userId: string,
  chapterId: string,
  contentHash: string | null,
): Promise<StoredChapterAnalysis | null> {
  const { data, error } = await supabase
    .from("chapter_user_analysis")
    .select("*")
    .eq("user_id", userId)
    .eq("chapter_id", chapterId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  // A cached analysis of content that has since changed describes a chapter that
  // no longer exists, and an analysis from an older engine was computed by rules
  // this version no longer holds. Both are recomputed rather than trusted.
  if (data.content_hash !== contentHash) return null;
  if (data.story_engine_version !== STORY_ENGINE_VERSION) return null;

  return {
    coverageStatus: data.coverage_status,
    coverageRatio: data.coverage_ratio === null ? null : Number(data.coverage_ratio),
    coverageConfidence: data.coverage_confidence,
    observedWords: data.observed_words,
    knownWords: data.known_words,
    totalWords: data.total_words,
    difficultyScore: Number(data.difficulty_score),
    difficultyLabel: data.difficulty_label,
    difficultyConfidence: data.difficulty_confidence,
    estimatedMinutes: data.estimated_minutes,
    preteachTargetCount: data.preteach_target_count,
    computedAt: data.computed_at,
  };
}

/** The cache row, in the shape the UI reads it. */
export interface StoredChapterAnalysis {
  coverageStatus: "estimated" | "insufficient_data";
  coverageRatio: number | null;
  coverageConfidence: "none" | "low" | "medium" | "high";
  observedWords: number;
  knownWords: number;
  totalWords: number;
  difficultyScore: number;
  difficultyLabel: "easy" | "just_right" | "challenging" | "very_challenging";
  difficultyConfidence: "none" | "low" | "medium" | "high";
  estimatedMinutes: number;
  preteachTargetCount: number;
  computedAt: string;
}

/**
 * Turn assembled rows into a chapter's personal analysis.
 *
 * Deliberately takes its inputs rather than fetching them: the caller already
 * needs the chapter's vocabulary and the learner's knowledge of it to build the
 * preparation shortlist, and reading the same rows twice would double the cost
 * of every chapter card on a book page. The arithmetic itself is
 * `analyseChapter`, which is pure and unit-tested.
 */
export function computeChapterAnalysis(input: {
  chapter: ChapterFacts;
  ability: number | null;
  vocabulary: readonly ChapterVocabularyEntry[];
  knowledge: readonly WordEvidence[];
  history: BookReadingHistory;
  weaknessPressure: number | null;
}): ChapterAnalysis & { coverage: CoverageEstimate } {
  const coverage = estimateCoverage(
    input.vocabulary.map((entry) => ({
      wordId: entry.wordId,
      occurrenceCount: entry.occurrenceCount,
    })),
    input.knowledge.map((row) => ({
      wordId: row.wordId,
      receptiveScore: row.score,
      receptiveConfidence: row.confidence,
    })),
  );

  return {
    ...analyseChapter({
      coverage,
      chapterCefr: input.chapter.cefr,
      ability: input.ability,
      weaknessPressure: input.weaknessPressure,
      history: input.history,
    }),
    coverage,
  };
}

/**
 * Weakness pressure from the concepts this chapter's questions are tagged with.
 *
 * ABSENT RATHER THAN GUESSED when the chapter has no bank yet — which is every
 * chapter until one is generated, and exactly the case where a zero would be a
 * lie. A chapter whose bank cannot be read is a chapter with no pressure signal,
 * not a chapter whose grammar is comfortable.
 */
export async function getChapterConceptPressure(
  supabase: Client,
  userId: string,
  chapterId: string,
): Promise<number | null> {
  try {
    const candidates = await getChapterQuestionCandidates(supabase, chapterId);
    const codes = candidates.flatMap((question) => question.conceptCodes);
    return await getChapterWeaknessPressure(supabase, userId, codes);
  } catch {
    return null;
  }
}
