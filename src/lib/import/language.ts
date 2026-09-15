/**
 * What language is this book in?
 *
 * DETERMINISTIC, AND DELIBERATELY SO. Asking a language model to read three
 * hundred pages in order to answer "German?" would cost money and a privacy
 * surface to learn something a hundred function words already answer. Common
 * words are the strongest signal any language has: `der/die/das/und/nicht`
 * occur in every German paragraph ever written and in no Polish one.
 *
 * WHAT IT IS FOR. A warning, not a gate. Fluent teaches German, so a Polish
 * novel is a book the learner will get nothing out of — but it is THEIR book,
 * the detector can be wrong, and refusing an import on a guess would be worse
 * than importing a book nobody reads. The preview says what it found and lets
 * them proceed.
 *
 * SAMPLED, NOT SCANNED. The first {@link LANGUAGE_SAMPLE_CHARS} characters of
 * running text settle it; reading a whole book to raise the confidence from 0.4
 * to 0.41 is work nobody benefits from.
 *
 * Pure.
 */

import {
  LANGUAGE_MIN_CONFIDENCE,
  LANGUAGE_SAMPLE_CHARS,
} from "@/lib/import/constants";
import type { LanguageGuess } from "@/lib/import/types";

/**
 * Function words, by language.
 *
 * Function words rather than content words because they cannot be avoided: a
 * text can be about anything, but German prose cannot proceed without `und`,
 * `die` and `nicht`. The lists are short on purpose — a longer list adds
 * vocabulary that overlaps between languages and blurs the margin the confidence
 * is computed from.
 *
 * The set of languages is the set Fluent has an opinion about: German because it
 * is the target, Polish and English because those are what a Polish learner's
 * own files are otherwise in.
 */
const MARKERS: Readonly<Record<string, readonly string[]>> = {
  de: [
    "der", "die", "das", "und", "nicht", "ist", "sich", "mit", "den", "von",
    "auf", "für", "ein", "eine", "einen", "einem", "einer", "dem", "des", "aber",
    "auch", "wenn", "war", "waren", "hatte", "hatten", "wurde", "durch", "über",
    "noch", "schon", "immer", "dass", "sie", "ihm", "ihr", "ihn", "wir", "zum",
  ],
  pl: [
    "nie", "się", "jest", "tego", "który", "która", "które", "tylko", "przez",
    "jako", "była", "był", "było", "byli", "ale", "jeszcze", "bardzo", "już",
    "tym", "tak", "gdy", "czy", "oraz", "albo", "wszystko", "można", "jego",
    "jej", "ich", "nas", "was", "dla", "przed", "pod", "nad", "między", "kiedy",
    "żeby", "tutaj",
  ],
  en: [
    "the", "and", "was", "that", "with", "his", "her", "for", "had", "but",
    "not", "you", "this", "they", "from", "have", "were", "what", "when",
    "which", "there", "would", "could", "about", "into", "than", "then", "them",
    "been", "will", "your", "said", "who", "she", "him", "are", "all", "out",
    "their", "some",
  ],
};

/**
 * Letters that only one of the candidate languages uses.
 *
 * A tie-breaker, not a decision. `ß` alone is conclusive; `ä` appears in
 * loanwords everywhere. Weighted low enough that a paragraph of German quoted in
 * a Polish book cannot flip the result.
 */
const DIACRITIC_HINTS: Readonly<Record<string, RegExp>> = {
  de: /[äöüßÄÖÜ]/g,
  pl: /[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/g,
};

/** How much a diacritic hit is worth against one function-word hit. */
const DIACRITIC_WEIGHT = 0.15;

/**
 * Guess the language of a body of text.
 *
 * `confidence` is the MARGIN over the runner-up, normalised — not a probability,
 * and not presented as one. Below {@link LANGUAGE_MIN_CONFIDENCE} the answer is
 * null: a book of dialogue in two languages, or a fifty-word fragment, is a case
 * where "I don't know" is the true answer and a guess would be a lie the UI
 * would then repeat to the learner.
 */
export function detectLanguage(text: string): LanguageGuess {
  const sample = text.slice(0, LANGUAGE_SAMPLE_CHARS).toLowerCase();
  const tokens = sample.match(/\p{L}+/gu) ?? [];
  if (tokens.length < 20) return { language: null, confidence: 0 };

  const counted = new Set(Object.keys(MARKERS));
  const scores = new Map<string, number>([...counted].map((code) => [code, 0]));

  const membership = new Map<string, string[]>();
  for (const [code, words] of Object.entries(MARKERS)) {
    for (const word of words) {
      const owners = membership.get(word) ?? [];
      owners.push(code);
      membership.set(word, owners);
    }
  }

  for (const token of tokens) {
    const owners = membership.get(token);
    if (!owners) continue;
    // A word shared by two languages is evidence for neither in particular, so
    // its weight is split rather than counted twice.
    const share = 1 / owners.length;
    for (const code of owners) scores.set(code, (scores.get(code) ?? 0) + share);
  }

  for (const [code, pattern] of Object.entries(DIACRITIC_HINTS)) {
    const hits = sample.match(pattern)?.length ?? 0;
    scores.set(code, (scores.get(code) ?? 0) + hits * DIACRITIC_WEIGHT);
  }

  const ranked = [...scores.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  );
  const [top, runnerUp] = ranked;
  if (!top || top[1] === 0) return { language: null, confidence: 0 };

  const margin = (top[1] - (runnerUp?.[1] ?? 0)) / tokens.length;
  if (margin < LANGUAGE_MIN_CONFIDENCE) {
    return { language: null, confidence: round(margin) };
  }

  return { language: top[0], confidence: round(Math.min(margin, 1)) };
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
