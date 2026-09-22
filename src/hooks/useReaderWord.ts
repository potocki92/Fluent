"use client";

import { useQuery } from "@tanstack/react-query";

import { resolveReaderWord } from "@/actions/reading";
import type { ReaderDictionaryWord } from "@/lib/reading/contracts";
import {
  resolveGlossWordId,
  type GlossTarget,
} from "@/components/reader/reader-interaction";
import { normalizeToken } from "@/lib/content/tokenize";
import { GLOSS_DICTIONARY_STALE_MS } from "@/lib/reading/constants";

/**
 * "What does Fluent's dictionary say about the word under this finger?" —
 * answered against the dictionary as it is RIGHT NOW.
 *
 * WHY THIS IS A HOOK AND NOT THREE LINES INSIDE THE SHEET. Three things need the
 * same answer and must never disagree: the sheet renders it, "Dodaj do powtórek"
 * saves it, and the lookup is recorded against it. Splitting that across
 * components is how `target.wordId ?? data?.id ?? null` ends up written four
 * slightly different ways.
 *
 * WHY IT CALLS A SERVER ACTION rather than the browser Supabase client, unlike
 * every other hook in this directory. Resolving *zog* to *ziehen* means running
 * the shared de-inflection rules against the whole dictionary, which lives on the
 * server. The alternative the reader used to have — `ilike("lemma", surface)`
 * from the browser — is a second, much weaker matcher that finds only the words
 * whose headword is spelled exactly like the token on the page, which for German
 * fiction is a minority of them.
 *
 * THE CACHE HAS AN ASYMMETRY, AND IT IS THE WHOLE POINT. A found entry is cached
 * for `GLOSS_DICTIONARY_STALE_MS` — the general translation of a lexeme is the
 * same everywhere, so this is shared across the book. A MISS is not cached at
 * all: "no entry" is true until somebody adds the word, and a learner who adds
 * *ziehen* and taps *zog* again must be told the new answer, not a five-minute-old
 * refusal. Re-tapping the same word therefore always re-asks.
 */
export interface ReaderWordState {
  /** The dictionary entry, or null once the dictionary has answered "none". */
  word: ReaderDictionaryWord | null;
  /** The entry every downstream action uses. See `resolveGlossWordId`. */
  wordId: number | null;
  isLoading: boolean;
}

export function useReaderWord(target: GlossTarget | null): ReaderWordState {
  const { data, isPending, isFetching } = useQuery({
    // Keyed on the SURFACE, not on the stored `word_id`: the surface is what is
    // actually being resolved, and two occurrences of *zog* — one stored with an
    // id and one without — are the same question with the same answer.
    queryKey: ["reader-word", target ? normalizeToken(target.surface) : ""],
    enabled: target !== null,
    staleTime: (query) => (query.state.data?.word ? GLOSS_DICTIONARY_STALE_MS : 0),
    queryFn: async (): Promise<{ word: ReaderDictionaryWord | null }> => {
      if (!target) return { word: null };
      const result = await resolveReaderWord({
        wordId: target.wordId,
        surface: target.surface,
      });
      if (!result.ok) throw new Error(result.message);
      return { word: result.word };
    },
  });

  const settled = target !== null && !isPending && !isFetching;

  return {
    word: data?.word ?? null,
    wordId: resolveGlossWordId({ target, word: data?.word, settled }),
    isLoading: target !== null && isPending,
  };
}
