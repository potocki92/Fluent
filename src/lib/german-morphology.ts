/**
 * Lightweight rule-based German de-inflection, used to match free-typed word
 * forms in a passage against the dictionary's base forms (`words.lemma`).
 *
 * It is deliberately heuristic: it covers productive / regular inflection
 * (plural and case endings, weak-verb conjugation, adjective and article
 * agreement, genitive `-s`) plus umlaut folding, which catches the bulk of the
 * forms found in A1–B2 texts. Irregularity is handled by table rather than by
 * rule, and only where the table has to exist: {@link IRREGULAR_BASE_FORMS}
 * covers the auxiliaries and modals. Strong verbs (`ging` → `gehen`, `sah` →
 * `sehen`) are still unresolved and left for the admin to mark by hand in the
 * parse preview. Pure and testable — see the colocated
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
 * Common German closed-class words — articles, determiners, pronouns,
 * conjunctions, particles and prepositions.
 *
 * A PRESENTATION LIST, AND A DELIBERATELY NARROW ONE. It decides how loudly the
 * reader marks a token and what counts as a dictionary gap worth chasing. It
 * does NOT decide whether a token means something; `matchToken` resolves
 * everything.
 *
 * VERBS ARE NOT ON IT. It used to carry *haben*, *sein*, *werden*, *können*,
 * *müssen*, *sollen*, *wollen* and their finite forms, which made a modal verb
 * — the word a German sentence often turns on — the one thing a learner could
 * not look up. A verb form is a content word in every one of its forms, so it
 * is marked like one; the irregular ones resolve through
 * {@link IRREGULAR_BASE_FORMS} rather than being hidden here.
 */
export const GERMAN_FUNCTION_WORDS = new Set<string>([
  // articles & determiners
  "der", "die", "das", "den", "dem", "des",
  "ein", "eine", "einen", "einem", "einer", "eines",
  "kein", "keine", "keinen", "keinem", "keiner", "keines",
  // pronouns
  "ich", "du", "er", "sie", "es", "wir", "ihr",
  "mich", "dich", "sich", "uns", "euch", "ihn", "ihm", "ihnen",
  // "sein" is absent on purpose: the token is also the infinitive *to be*, and
  // silencing the possessive would silence the verb with it.
  "mein", "dein", "unser", "euer",
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
]);

/**
 * Forms whose base cannot be reached by stripping an ending.
 *
 * THE SUFFIX RULES ARE NOT WRONG HERE, THEY ARE BLIND. *ist*, *war* and *hat*
 * share no stem with *sein* and *haben*, so no amount of ending-stripping gets
 * there — and worse, the rules confidently land somewhere else: *waren* loses
 * its `-n` and becomes *Ware* (towar), *bist* loses its `-t` and becomes *bis*.
 * While these forms were in {@link GERMAN_FUNCTION_WORDS} the matcher never got
 * far enough to be wrong; taking them out without this table would have started
 * glossing *waren* as a commodity.
 *
 * Scope: the auxiliaries and the modals — a closed set of about seventy forms
 * that every German page is built from, and the only verbs the function-word
 * list ever claimed. The strong verbs (*sah*, *saß*, *trug*, *begann*) are the
 * same class of problem and are NOT covered here; that is a larger table and a
 * separate decision.
 *
 * Keys are `normalizeToken` output — lowercase, umlauts intact.
 */
export const IRREGULAR_BASE_FORMS = new Map<string, string>([
  // sein
  ["bin", "sein"], ["bist", "sein"], ["ist", "sein"], ["sind", "sein"],
  ["seid", "sein"], ["war", "sein"], ["warst", "sein"], ["waren", "sein"],
  ["wart", "sein"], ["wäre", "sein"], ["wärst", "sein"], ["wären", "sein"],
  ["gewesen", "sein"],
  // haben
  ["habe", "haben"], ["hast", "haben"], ["hat", "haben"], ["habt", "haben"],
  ["hatte", "haben"], ["hattest", "haben"], ["hatten", "haben"],
  ["hattet", "haben"], ["hätte", "haben"], ["hätten", "haben"],
  ["hättest", "haben"], ["gehabt", "haben"],
  // werden
  ["werde", "werden"], ["wirst", "werden"], ["wird", "werden"],
  ["werdet", "werden"], ["wurde", "werden"], ["wurdest", "werden"],
  ["wurden", "werden"], ["wurdet", "werden"], ["würde", "werden"],
  ["würdest", "werden"], ["würden", "werden"], ["worden", "werden"],
  ["geworden", "werden"],
  // können
  ["kann", "können"], ["kannst", "können"], ["könnt", "können"],
  ["konnte", "können"], ["konntest", "können"], ["konnten", "können"],
  ["könnte", "können"], ["könnten", "können"], ["gekonnt", "können"],
  // müssen
  ["muss", "müssen"], ["musst", "müssen"], ["müsst", "müssen"],
  ["musste", "müssen"], ["mussten", "müssen"], ["müsste", "müssen"],
  ["müssten", "müssen"], ["gemusst", "müssen"],
  // sollen
  ["soll", "sollen"], ["sollst", "sollen"], ["sollt", "sollen"],
  ["sollte", "sollen"], ["solltest", "sollen"], ["sollten", "sollen"],
  ["gesollt", "sollen"],
  // wollen
  ["will", "wollen"], ["willst", "wollen"], ["wollt", "wollen"],
  ["wollte", "wollen"], ["wolltest", "wollen"], ["wollten", "wollen"],
  ["gewollt", "wollen"],
  // dürfen
  ["darf", "dürfen"], ["darfst", "dürfen"], ["dürft", "dürfen"],
  ["durfte", "dürfen"], ["durften", "dürfen"], ["dürfte", "dürfen"],
  ["dürften", "dürfen"], ["gedurft", "dürfen"],
  // mögen
  ["mag", "mögen"], ["magst", "mögen"], ["mögt", "mögen"],
  ["mochte", "mögen"], ["mochten", "mögen"], ["möchte", "mögen"],
  ["möchtest", "mögen"], ["möchten", "mögen"], ["gemocht", "mögen"],
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

  // FIRST, ALWAYS. The order of this Set is the ranking `matchToken` walks, and
  // a known irregular base has to beat a stem the suffix rules happen to
  // produce — otherwise *waren* resolves to *Ware* before anyone asks *sein*.
  const irregular = IRREGULAR_BASE_FORMS.get(lower);
  if (irregular) candidates.add(irregular);

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
