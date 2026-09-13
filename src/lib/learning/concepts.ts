/**
 * The concept catalog — Fluent's weakness taxonomy.
 *
 * A concept is the smallest thing the app is willing to tell a learner they are
 * struggling with. "Masz 64% poprawnych odpowiedzi" is a statistic; "Największy
 * problem masz z Dativem po przyimkach" is something someone can act on, and it
 * only becomes possible if every item carries stable codes for what it exercises.
 *
 * Two rules govern this list:
 *
 *  1. **Stable codes, translated once.** The `code` never changes; `labelPl`
 *     lives here so the eventual weakness UI reads one translation instead of
 *     hardcoding ten copies of "Przypadek po przyimku".
 *  2. **Short and actionable.** This is not a linguistics ontology. Every entry
 *     has to be something a learner could practise on purpose; splitting German
 *     grammar into 200 codes would make the weakness engine precise about
 *     nothing.
 *
 * Mirrors the `public.concepts` reference table.
 */

import type { SkillCode } from "@/lib/learning/skills";

/** Stable, machine-readable identifier of a concept. */
export type ConceptCode =
  // Grammar
  | "article_gender"
  | "case_nominative"
  | "case_accusative"
  | "case_dative"
  | "case_genitive"
  | "preposition_case"
  | "adjective_ending"
  | "verb_conjugation"
  | "verb_position"
  | "separable_prefix"
  | "modal_verb"
  | "past_tense"
  | "perfect_tense"
  | "word_order"
  | "relative_clause"
  | "plural_form"
  // Vocabulary
  | "lexical_recognition"
  | "lexical_recall"
  | "false_friend"
  | "collocation"
  | "word_gender"
  | "compound_word"
  // Reading
  | "main_idea"
  | "detail"
  | "inference"
  | "sequence"
  | "reference_resolution"
  // Listening (catalogued, not yet produced)
  | "listening_discrimination"
  | "connected_speech"
  | "numbers_dates";

/** Coarse grouping used to section the future weakness UI. */
export type ConceptCategory = "grammar" | "vocabulary" | "reading" | "listening";

export interface ConceptDefinition {
  code: ConceptCode;
  skillCode: SkillCode;
  category: ConceptCategory;
  labelPl: string;
  descriptionPl: string;
  sortOrder: number;
}

function concept(
  code: ConceptCode,
  skillCode: SkillCode,
  category: ConceptCategory,
  labelPl: string,
  descriptionPl: string,
  sortOrder: number,
): ConceptDefinition {
  return { code, skillCode, category, labelPl, descriptionPl, sortOrder };
}

const DEFINITIONS: readonly ConceptDefinition[] = [
  concept("article_gender", "grammar", "grammar", "Rodzajnik określony",
    "Dobór der/die/das do rzeczownika w zdaniu.", 10),
  concept("case_nominative", "grammar", "grammar", "Mianownik (Nominativ)",
    "Forma podmiotu i orzecznika.", 20),
  concept("case_accusative", "grammar", "grammar", "Biernik (Akkusativ)",
    "Forma dopełnienia bliższego.", 30),
  concept("case_dative", "grammar", "grammar", "Celownik (Dativ)",
    "Forma dopełnienia dalszego.", 40),
  concept("case_genitive", "grammar", "grammar", "Dopełniacz (Genitiv)",
    "Forma przynależności.", 50),
  concept("preposition_case", "grammar", "grammar", "Przypadek po przyimku",
    "Dobór Akkusativ/Dativ po niemieckich przyimkach.", 60),
  concept("adjective_ending", "grammar", "grammar", "Końcówki przymiotnika",
    "Odmiana przymiotnika zależnie od rodzajnika, rodzaju i przypadku.", 70),
  concept("verb_conjugation", "grammar", "grammar", "Odmiana czasownika",
    "Formy osobowe czasownika, w tym czasowniki nieregularne.", 80),
  concept("verb_position", "grammar", "grammar", "Pozycja czasownika",
    "Miejsce czasownika w zdaniu oznajmującym, pytającym i podrzędnym.", 90),
  concept("separable_prefix", "grammar", "grammar", "Czasowniki rozdzielnie złożone",
    "Odłączanie przedrostka i jego pozycja w zdaniu.", 100),
  concept("modal_verb", "grammar", "grammar", "Czasowniki modalne",
    "Znaczenie i składnia können, müssen, dürfen, sollen, wollen, mögen.", 110),
  concept("past_tense", "grammar", "grammar", "Czas przeszły Präteritum",
    "Formy prostego czasu przeszłego.", 120),
  concept("perfect_tense", "grammar", "grammar", "Czas przeszły Perfekt",
    "Dobór haben/sein oraz forma Partizip II.", 130),
  concept("word_order", "grammar", "grammar", "Szyk zdania",
    "Kolejność części zdania, w tym zasada TeKaMoLo.", 140),
  concept("relative_clause", "grammar", "grammar", "Zdania względne",
    "Zaimek względny i szyk w zdaniu podrzędnym.", 150),
  concept("plural_form", "grammar", "grammar", "Liczba mnoga",
    "Tworzenie liczby mnogiej rzeczownika.", 160),

  concept("lexical_recognition", "receptive_vocabulary", "vocabulary",
    "Rozpoznawanie słowa", "Rozumienie niemieckiego słowa, gdy się je widzi.", 200),
  concept("lexical_recall", "active_vocabulary", "vocabulary",
    "Przywoływanie słowa",
    "Samodzielne podanie niemieckiego słowa dla danego znaczenia.", 210),
  concept("false_friend", "receptive_vocabulary", "vocabulary", "Fałszywi przyjaciele",
    "Słowa podobne do polskich, ale o innym znaczeniu.", 220),
  concept("collocation", "active_vocabulary", "vocabulary", "Kolokacje",
    "Naturalne połączenia wyrazowe (np. eine Entscheidung treffen).", 230),
  concept("word_gender", "receptive_vocabulary", "vocabulary", "Rodzaj rzeczownika",
    "Znajomość rodzaju rzeczownika jako cechy słownikowej.", 240),
  concept("compound_word", "receptive_vocabulary", "vocabulary", "Rzeczowniki złożone",
    "Odczytywanie znaczenia złożeń (Handschuh, Krankenhaus).", 250),

  concept("main_idea", "reading_comprehension", "reading", "Główna myśl",
    "Uchwycenie sensu całego tekstu lub akapitu.", 300),
  concept("detail", "reading_comprehension", "reading", "Szczegół w tekście",
    "Odnalezienie konkretnej informacji.", 310),
  concept("inference", "reading_comprehension", "reading", "Wnioskowanie",
    "Wyciąganie wniosków, które nie są w tekście wprost.", 320),
  concept("sequence", "reading_comprehension", "reading", "Kolejność zdarzeń",
    "Ustalenie, co wydarzyło się wcześniej, a co później.", 330),
  concept("reference_resolution", "reading_comprehension", "reading",
    "Odniesienia w tekście",
    "Rozpoznanie, do czego odnosi się zaimek lub określenie.", 340),

  concept("listening_discrimination", "listening", "listening",
    "Rozróżnianie dźwięków", "Odróżnianie podobnie brzmiących słów i form.", 400),
  concept("connected_speech", "listening", "listening", "Mowa łączona",
    "Rozumienie szybkiej, naturalnie łączonej wymowy.", 410),
  concept("numbers_dates", "listening", "listening", "Liczby i daty",
    "Wychwytywanie liczb, godzin i dat ze słuchu.", 420),
];

export const CONCEPT_CATALOG: Readonly<Record<ConceptCode, ConceptDefinition>> =
  Object.fromEntries(DEFINITIONS.map((entry) => [entry.code, entry])) as Record<
    ConceptCode,
    ConceptDefinition
  >;

/** Every concept, in display order. */
export const CONCEPTS: readonly ConceptDefinition[] = DEFINITIONS;

/** Narrow an untrusted string (a database row, an admin form) to a concept code. */
export function isConceptCode(
  value: string | null | undefined,
): value is ConceptCode {
  return value != null && value in CONCEPT_CATALOG;
}
