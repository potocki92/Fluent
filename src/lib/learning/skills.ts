/**
 * The skill catalog — the one source of truth for skill codes in TypeScript.
 *
 * A single `ability` number cannot describe what someone knows about a language.
 * Reading well says nothing about whether they can produce a sentence out loud,
 * and Fluent must never imply otherwise. So ability is decomposed into named
 * dimensions, each with its own evidence and its own confidence.
 *
 * `isAssessed` is the honesty flag. Speaking and listening are in the catalog so
 * that shipping them later needs an exercise and not a migration — but until
 * something actually measures them, the right answer for those skills is
 * "nie wiemy", never a number inferred from how well someone reads.
 *
 * This mirrors the `public.skills` reference table, which owns the same rows in
 * the database (so `skill_code` columns can carry a real foreign key). The two
 * are kept in step by hand; `skills.test.ts` pins the codes so a rename cannot
 * quietly desynchronise them.
 */

/** Stable, machine-readable identifier of a skill dimension. */
export type SkillCode =
  | "reading_comprehension"
  | "receptive_vocabulary"
  | "active_vocabulary"
  | "grammar"
  | "listening"
  | "writing"
  | "speaking"
  | "pronunciation";

export interface SkillDefinition {
  code: SkillCode;
  /** Polish label for the UI. Kept here so no component hardcodes a copy. */
  labelPl: string;
  descriptionPl: string;
  /** Does any current Fluent exercise produce evidence for this skill? */
  isAssessed: boolean;
  sortOrder: number;
}

export const SKILL_CATALOG: Readonly<Record<SkillCode, SkillDefinition>> = {
  reading_comprehension: {
    code: "reading_comprehension",
    labelPl: "Rozumienie tekstu",
    descriptionPl: "Rozumienie sensu i szczegółów niemieckiego tekstu pisanego.",
    isAssessed: true,
    sortOrder: 10,
  },
  receptive_vocabulary: {
    code: "receptive_vocabulary",
    labelPl: "Słownictwo bierne",
    descriptionPl:
      "Rozpoznawanie znaczenia niemieckiego słowa, gdy się je widzi lub słyszy.",
    isAssessed: true,
    sortOrder: 20,
  },
  active_vocabulary: {
    code: "active_vocabulary",
    labelPl: "Słownictwo czynne",
    descriptionPl:
      "Samodzielne przywołanie niemieckiego słowa na podstawie znaczenia.",
    isAssessed: false,
    sortOrder: 30,
  },
  grammar: {
    code: "grammar",
    labelPl: "Gramatyka",
    descriptionPl: "Formy i struktury: przypadki, rodzajniki, szyk zdania, czasy.",
    isAssessed: true,
    sortOrder: 40,
  },
  listening: {
    code: "listening",
    labelPl: "Rozumienie ze słuchu",
    descriptionPl: "Rozumienie mówionego niemieckiego.",
    isAssessed: false,
    sortOrder: 50,
  },
  writing: {
    code: "writing",
    labelPl: "Pisanie",
    descriptionPl: "Tworzenie poprawnego tekstu pisanego po niemiecku.",
    isAssessed: false,
    sortOrder: 60,
  },
  speaking: {
    code: "speaking",
    labelPl: "Mówienie",
    descriptionPl: "Swobodne wypowiadanie się po niemiecku.",
    isAssessed: false,
    sortOrder: 70,
  },
  pronunciation: {
    code: "pronunciation",
    labelPl: "Wymowa",
    descriptionPl: "Poprawna artykulacja i akcent.",
    isAssessed: false,
    sortOrder: 80,
  },
};

/** Every skill, in display order. */
export const SKILLS: readonly SkillDefinition[] = Object.values(SKILL_CATALOG).sort(
  (a, b) => a.sortOrder - b.sortOrder,
);

/** Narrow an untrusted string (a database row, a URL param) to a skill code. */
export function isSkillCode(value: string | null | undefined): value is SkillCode {
  return value != null && value in SKILL_CATALOG;
}
