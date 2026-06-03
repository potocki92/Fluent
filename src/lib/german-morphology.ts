/**
 * Lightweight rule-based German de-inflection, used to match free-typed word
 * forms in a passage against the dictionary's base forms (`words.lemma`).
 *
 * It is deliberately heuristic: it covers productive / regular inflection
 * (plural and case endings, weak-verb conjugation, adjective and article
 * agreement, genitive `-s`) plus umlaut folding, which catches the bulk of the
 * forms found in A1–B2 texts. It does NOT resolve strong / irregular forms
 * (e.g. `ging` → `gehen`, `gegangen` → `gehen`); those are left for the admin to
 * mark by hand in the parse preview. Pure and testable — see the colocated
 * `*.test.ts`. Matching is always done against the finite, known dictionary, so
 * over-generated candidates simply never match.
 */

/** Replace German umlauts/ß with their plain ASCII expansion for comparison. */
export function foldUmlauts(value: string): string {
  return value
    .replace(/ä/g, "a")
    .replace(/ö/g, "o")
    .replace(/ü/g, "u")
    .replace(/ß/g, "ss");
}

/**
 * Common German closed-class words. These are skipped when auto-marking so the
 * passage isn't littered with highlights on articles, pronouns, prepositions
 * and auxiliaries (several of which also exist as dictionary rows).
 */
export const GERMAN_FUNCTION_WORDS = new Set<string>([
  // articles & determiners
  "der", "die", "das", "den", "dem", "des",
  "ein", "eine", "einen", "einem", "einer", "eines",
  "kein", "keine", "keinen", "keinem", "keiner", "keines",
  // pronouns
  "ich", "du", "er", "sie", "es", "wir", "ihr",
  "mich", "dich", "sich", "uns", "euch", "ihn", "ihm", "ihnen",
  "mein", "dein", "sein", "unser", "euer",
  "man", "wer", "was", "wo", "wann", "warum",
  // conjunctions & particles
  "und", "oder", "aber", "sondern", "denn", "sowie",
  "dass", "weil", "wenn", "ob", "als", "wie", "damit", "obwohl",
  "nicht", "auch", "noch", "schon", "nur", "sehr", "so",
  "da", "hier", "dort", "dann", "jetzt", "immer", "schon",
  // prepositions (+ common contractions)
  "in", "an", "auf", "aus", "bei", "mit", "nach", "seit", "von", "zu",
  "über", "unter", "vor", "hinter", "neben", "zwischen",
  "durch", "für", "gegen", "ohne", "um", "bis",
  "am", "im", "ins", "beim", "vom", "zur", "zum", "ans",
  // auxiliaries / very high-frequency verb forms
  "ist", "sind", "bin", "bist", "seid", "war", "waren", "wäre",
  "hat", "habe", "hast", "haben", "hatte", "hatten",
  "wird", "werden", "wurde", "wurden", "worden",
  "kann", "kannst", "können", "muss", "musst", "müssen",
  "will", "willst", "wollen", "soll", "sollst", "sollen",
]);

/**
 * Productive German suffixes, longest first so the most specific ending is
 * stripped before its shorter prefixes. Stripping a suffix yields a candidate
 * stem; verb infinitives are then reconstructed from that stem.
 */
const SUFFIXES = [
  "test", "ten", "tet", "end", "nd",
  "est", "em", "en", "er", "es", "te", "st", "et",
  "e", "n", "s", "t",
];

/**
 * Generate ranked base-form candidates for a surface token. The token itself
 * (and its umlaut-folded form) come first, followed by stems produced by
 * stripping productive endings, and likely verb infinitives rebuilt from those
 * stems. Tokens shorter than 3 characters yield nothing (too ambiguous).
 */
export function baseFormCandidates(token: string): string[] {
  const lower = token.toLowerCase();
  if (lower.length < 3) return [];

  const candidates = new Set<string>();
  const seeds = new Set<string>([lower, foldUmlauts(lower)]);

  for (const seed of seeds) {
    candidates.add(seed);

    // Weak-verb past participle prefix: gespielt → spielt, gemacht → macht.
    const roots =
      seed.startsWith("ge") && seed.length > 4 ? [seed, seed.slice(2)] : [seed];

    for (const root of roots) {
      candidates.add(root);
      for (const suffix of SUFFIXES) {
        if (root.length > suffix.length + 1 && root.endsWith(suffix)) {
          const stem = root.slice(0, root.length - suffix.length);
          candidates.add(stem);
          // Reconstruct the likely verb infinitive (spielt → spiel → spielen).
          candidates.add(`${stem}en`);
          candidates.add(`${stem}n`);
        }
      }
    }
  }

  candidates.delete("");
  return [...candidates];
}
