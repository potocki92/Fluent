/**
 * Lightweight rule-based German de-inflection, used to match a word form found in
 * a text against the dictionary's base forms (`words.lemma`).
 *
 * It covers productive / regular inflection (plural and case endings, weak-verb
 * conjugation, adjective and article agreement, genitive `-s`) plus umlaut
 * folding, which catches the bulk of the forms found in A1–B2 texts — and, since
 * the reader started resolving words against the CURRENT dictionary at read time,
 * a finite table of STRONG and irregular forms as well.
 *
 * WHY THE TABLE EXISTS. Rules cannot reach *zog* from *ziehen*: the vowel changes
 * rather than an ending. Before this existed the answer was "mark it by hand in
 * the parse preview", which is workable for a curated A2 passage and hopeless for
 * a novel — German fiction runs on exactly these verbs, and every one of them was
 * dead text on the page. The table is deliberately finite and deliberately about
 * high-frequency verbs; it is not a lexicon and is not trying to become one.
 *
 * IT CANNOT HIJACK A REAL WORD. `matchToken` tries the surface form against the
 * dictionary FIRST, so *Band*, *Stand*, *Tat* and *Ritt* resolve to their own
 * entries when those exist, and only fall through to *binden*, *stehen*, *tun*
 * and *reiten* when they do not. Within the candidates, a table hit is ranked
 * ahead of the speculative suffix-stripped stems, so *dachte* reaches *denken*
 * rather than *Dach*.
 *
 * Pure and testable — see the colocated `*.test.ts`. Matching is always done
 * against the finite, known dictionary, so over-generated candidates simply never
 * match.
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
 * Strong and irregular verb forms → their infinitive.
 *
 * WHAT IS IN IT. The preterite stem (*zog*, *ging*, *fand*) and, where the
 * participle's vowel differs from both the infinitive and the preterite
 * (*genommen*, *gesprochen*, *gefunden*), the `ge-`-stripped participle stem as
 * well. The regular rules already reach the rest: *gekommen* → *kommen* and
 * *sollte* → *sollen* need no table.
 *
 * WHAT IS NOT. Anything ambiguous with a common word in its own right. *kann* is
 * absent — mapping it to *kennen* would answer "to know" for the modal every
 * German text is full of — while *kannte* is present, because nothing else is
 * spelled that way. Where a noun happens to share a spelling (*Band*, *Stand*,
 * *Tat*, *Ritt*, *Schuf*), the dictionary's own entry wins anyway: `matchToken`
 * tries the surface form before it asks for candidates.
 *
 * WHY A TABLE AND NOT RULES. Ablaut is not productive — there is no rule that
 * turns *ziehen* into *zog*, which is exactly why a rule-based de-inflector
 * cannot do it and why these verbs stayed dead in the reader. It is finite by
 * design: a hundred or so verbs that carry German fiction, matched against a
 * known dictionary, so anything over-generated simply never resolves.
 */
const IRREGULAR_VERB_FORMS = new Map<string, string>([
  // movement and position
  ["ging", "gehen"], ["gangen", "gehen"],
  ["kam", "kommen"],
  ["lief", "laufen"],
  ["fuhr", "fahren"],
  ["flog", "fliegen"],
  ["fiel", "fallen"],
  ["stieg", "steigen"],
  ["sprang", "springen"], ["sprungen", "springen"],
  ["ritt", "reiten"],
  ["zog", "ziehen"],
  ["trug", "tragen"],
  ["schob", "schieben"],
  ["stieß", "stoßen"], ["stiess", "stoßen"],
  ["trieb", "treiben"],
  ["wich", "weichen"],
  ["verschwand", "verschwinden"],
  // standing, sitting, lying
  ["stand", "stehen"], ["standen", "stehen"],
  ["saß", "sitzen"], ["sass", "sitzen"], ["sessen", "sitzen"],
  ["lag", "liegen"],
  ["hing", "hängen"],
  ["hielt", "halten"],
  // perception and speech
  ["sah", "sehen"],
  ["sprach", "sprechen"], ["sprochen", "sprechen"],
  ["rief", "rufen"],
  ["schrie", "schreien"],
  ["hieß", "heißen"], ["hiess", "heißen"],
  ["schwieg", "schweigen"],
  ["roch", "riechen"],
  ["las", "lesen"],
  ["schrieb", "schreiben"],
  // having, giving, taking
  ["gab", "geben"],
  ["nahm", "nehmen"], ["nommen", "nehmen"],
  ["hob", "heben"],
  ["ließ", "lassen"], ["liess", "lassen"],
  ["bot", "bieten"],
  ["bat", "bitten"],
  ["lieh", "leihen"],
  ["verlor", "verlieren"],
  ["fand", "finden"], ["funden", "finden"],
  ["lud", "laden"],
  // `hielt` above reaches only the bare verb; the prefixed one needs its own
  // row, and its participle is spelled like the infinitive so step 1 has it.
  ["erhielt", "erhalten"],
  // doing, making, striking
  ["tat", "tun"],
  ["schuf", "schaffen"],
  ["schlug", "schlagen"],
  ["warf", "werfen"], ["worfen", "werfen"],
  ["traf", "treffen"], ["troffen", "treffen"],
  ["brach", "brechen"], ["brochen", "brechen"],
  ["schnitt", "schneiden"],
  ["stritt", "streiten"],
  ["griff", "greifen"],
  ["half", "helfen"], ["holfen", "helfen"],
  ["zwang", "zwingen"], ["zwungen", "zwingen"],
  ["band", "binden"], ["bunden", "binden"],
  ["hielt", "halten"],
  ["trat", "treten"],
  ["fing", "fangen"],
  ["wusch", "waschen"],
  ["wuchs", "wachsen"],
  ["gewann", "gewinnen"], ["gewonnen", "gewinnen"],
  // eating, drinking, living, dying
  ["aß", "essen"], ["ass", "essen"], ["gessen", "essen"],
  ["trank", "trinken"], ["trunken", "trinken"],
  ["starb", "sterben"], ["storben", "sterben"],
  ["blieb", "bleiben"],
  ["schlief", "schlafen"],
  ["sang", "singen"], ["sungen", "singen"],
  ["sank", "sinken"], ["sunken", "sinken"],
  ["schien", "scheinen"],
  ["schloss", "schließen"], ["schloß", "schließen"], ["schlossen", "schließen"],
  ["schoss", "schießen"], ["schoß", "schießen"],
  ["floss", "fließen"], ["floß", "fließen"],
  ["genoss", "genießen"], ["genoß", "genießen"],
  ["biss", "beißen"], ["biß", "beißen"],
  ["log", "lügen"],
  ["wog", "wiegen"],
  ["mied", "meiden"],
  ["wies", "weisen"],
  ["vergaß", "vergessen"], ["vergass", "vergessen"],
  // mixed (weak verbs with a vowel change) — the full form, never the stem
  ["dachte", "denken"], ["dacht", "denken"],
  ["brachte", "bringen"], ["bracht", "bringen"],
  ["kannte", "kennen"], ["kannt", "kennen"],
  ["nannte", "nennen"], ["nannt", "nennen"],
  ["rannte", "rennen"], ["rannt", "rennen"],
  ["brannte", "brennen"], ["brannt", "brennen"],
  ["sandte", "senden"], ["wandte", "wenden"],
  ["wusste", "wissen"], ["wußte", "wissen"], ["weiß", "wissen"], ["weiss", "wissen"],
  ["mochte", "mögen"],
  ["durfte", "dürfen"],
]);

/**
 * Generate ranked base-form candidates for a surface token.
 *
 * THE ORDER IS THE POINT, because `matchToken` takes the first candidate the
 * dictionary recognises:
 *
 *   1. the token itself and its umlaut-folded form, plus the `ge-` participle
 *      root — the things that might simply BE the headword;
 *   2. strong and irregular infinitives from {@link IRREGULAR_VERB_FORMS} — a
 *      table lookup, so a hit here is knowledge rather than a guess;
 *   3. stems produced by stripping productive endings, and the infinitives
 *      rebuilt from them — speculation, and it must come last: *dachte* stripped
 *      of `-te` is *dach*, and a dictionary containing *Dach* would otherwise
 *      answer "roof" for "thought".
 *
 * Tokens shorter than 3 characters yield nothing (too ambiguous).
 */
export function baseFormCandidates(token: string): string[] {
  const lower = token.toLowerCase();
  if (lower.length < 3) return [];

  const candidates = new Set<string>();
  const speculative = new Set<string>();
  const seeds = new Set<string>([lower, foldUmlauts(lower)]);
  const roots = new Set<string>();

  // 1. The forms that might already be the headword.
  for (const seed of seeds) {
    candidates.add(seed);
    roots.add(seed);
    // Weak-verb past participle prefix: gespielt → spielt, gemacht → macht,
    // and for a strong verb gezogen → zogen, which the table below knows.
    //
    // NOT WHEN THE TABLE ALREADY KNOWS THE WHOLE WORD. In *gewinnen* the `ge`
    // is part of the stem, so stripping it yields *wann* — a question word a
    // dictionary certainly has, ranked here ABOVE the table's answer, which
    // would make "sie gewann" read as "kiedy". A table hit is knowledge and a
    // stripped prefix is a guess, so the guess is not made at all when the form
    // is one we know (*gewann*, *gewonnen*, *genoss*).
    if (seed.startsWith("ge") && seed.length > 4 && !IRREGULAR_VERB_FORMS.has(seed)) {
      const root = seed.slice(2);
      candidates.add(root);
      roots.add(root);
    }
  }

  // 3. (collected now, added last) The speculative stems.
  for (const root of roots) {
    for (const suffix of SUFFIXES) {
      if (root.length > suffix.length + 1 && root.endsWith(suffix)) {
        const stem = root.slice(0, root.length - suffix.length);
        speculative.add(stem);
        // Reconstruct the likely verb infinitive (spielt → spiel → spielen).
        speculative.add(`${stem}en`);
        speculative.add(`${stem}n`);
      }
    }
  }

  // 2. The table, consulted for every form derived so far — the full word
  // (*dachte*), the participle root (*zogen*) and the stripped stem (*zog*).
  for (const form of [...roots, ...speculative]) {
    const infinitive = IRREGULAR_VERB_FORMS.get(form);
    if (infinitive) candidates.add(infinitive);
  }

  for (const form of speculative) candidates.add(form);

  candidates.delete("");
  return [...candidates];
}
