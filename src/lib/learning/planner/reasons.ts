/**
 * "Dlaczego to mi pokazujesz?"
 *
 * Every plan activity has to be able to answer that, and the answer is stored
 * STRUCTURALLY — a stable code plus its data — never as a finished Polish
 * sentence. Three things follow from that:
 *
 *  1. The copy can be reworded, or translated, without a migration and without
 *     rewriting history.
 *  2. The reason stays queryable: "how often does the planner pick something
 *     because of overdue reviews?" is a `group by reason_code`, not a text
 *     search.
 *  3. Yesterday's plan still says what it said yesterday, because the numbers in
 *     `reason_data` were snapshotted when the plan was built rather than
 *     recomputed from today's state.
 *
 * The rendering below is the UI's half of that contract. It lives here, not in a
 * component, so that the plan list, the reward screen and the weakness detail
 * all say the same thing.
 */

/** Why an activity is in today's plan. Stored in `daily_plan_items.reason_code`. */
export type PlanReasonCode =
  | "no_level_yet"
  | "overdue_reviews"
  | "study_ahead"
  | "recurring_mistakes"
  | "weak_concept"
  | "text_started"
  | "text_unfinished"
  | "level_match"
  | "chapter_started"
  | "chapter_next"
  | "chapter_first"
  | "chapter_challenge_pending"
  | "chapter_preparation"
  | "new_words";

/** Numbers and labels the copy needs. Snapshotted, never re-derived. */
export interface PlanReasonData {
  /** Overdue cards, failures, questions — whatever the code counts. */
  count?: number;
  /** Answers seen for a concept, when the reason quotes a ratio. */
  outOf?: number;
  /** Polish concept label, snapshotted so old plans survive a catalog rename. */
  conceptLabel?: string;
  /** Passage title, likewise. */
  textTitle?: string;
  /** Book or story title, snapshotted so a rename cannot rewrite history. */
  itemTitle?: string;
  /** Chapter number, for "Rozdział 4". */
  chapterPosition?: number;
  /** Days the review queue is behind. */
  days?: number;
}

export interface PlanReason {
  code: PlanReasonCode;
  data: PlanReasonData;
}

export function reason(code: PlanReasonCode, data: PlanReasonData = {}): PlanReason {
  return { code, data };
}

/**
 * The one-line "why" shown under a plan activity.
 *
 * Written in the second person and in plain Polish. A learner never sees
 * `concept_score = 0.423`; they see what it means.
 */
export function renderReason({ code, data }: PlanReason): string {
  switch (code) {
    case "no_level_yet":
      return "Najpierw sprawdźmy Twój poziom — bez tego plan byłby zgadywaniem.";
    case "overdue_reviews":
      return data.count && data.count > 0
        ? `Masz ${data.count} ${pluralCards(data.count)} do powtórzenia`
        : "Masz zaległe powtórki";
    case "study_ahead":
      return "Brak zaległości — uczysz się do przodu";
    case "recurring_mistakes":
      return data.count && data.outOf
        ? `Ostatnio ${data.count} z ${data.outOf} odpowiedzi było błędnych`
        : "To zagadnienie wraca w Twoich błędach";
    case "weak_concept":
      return data.conceptLabel
        ? `${data.conceptLabel} — to zagadnienie wymaga uwagi`
        : "To zagadnienie wymaga uwagi";
    case "text_started":
      return "Ten tekst jest już rozpoczęty";
    case "text_unfinished":
      return "Ten test jeszcze się nie udał — spróbuj ponownie";
    case "level_match":
      return "Tekst dopasowany do Twojego poziomu";
    case "chapter_started":
      return data.itemTitle
        ? `Czytasz „${data.itemTitle}” — wróć do rozdziału`
        : "Masz rozpoczęty rozdział";
    case "chapter_next":
      return data.chapterPosition
        ? `Kolejny rozdział (${data.chapterPosition}) czeka`
        : "Kolejny rozdział czeka";
    case "chapter_first":
      return data.itemTitle
        ? `„${data.itemTitle}” pasuje do Twojego poziomu`
        : "Coś nowego do czytania na Twoim poziomie";
    case "chapter_challenge_pending":
      return data.itemTitle
        ? `Rozdział „${data.itemTitle}” przeczytany — sprawdźmy, co zostało`
        : "Przeczytany rozdział czeka na sprawdzenie";
    case "chapter_preparation":
      return data.count && data.count > 0
        ? `${data.count} ${pluralWords(data.count)} może utrudnić ten rozdział`
        : "Kilka słów warto poznać przed rozdziałem";
    case "new_words":
      return data.count && data.count > 0
        ? `${data.count} ${pluralWords(data.count)}, których jeszcze nie znasz`
        : "Nowe słownictwo na Twoim poziomie";
  }
}

/** Short heading for a plan activity. */
export const PLAN_ITEM_TITLE_PL: Readonly<Record<string, string>> = {
  placement: "Test poziomujący",
  review_due: "Powtórki",
  weakness_practice: "Ćwiczenie gramatyczne",
  continue_text: "Dokończ tekst",
  new_text: "Czytanie",
  continue_chapter: "Czytaj dalej",
  new_chapter: "Nowy rozdział",
  chapter_preparation: "Przygotowanie do rozdziału",
  chapter_assessment: "Wyzwanie rozdziału",
  new_vocabulary: "Nowe słówka",
};

/**
 * The KIND of work an activity is, as a learner would name it.
 *
 * Distinct from {@link PLAN_ITEM_TITLE_PL}, which is the activity's own heading
 * ("Czytaj dalej", "Nowy rozdział"). The „Kontynuuj naukę" card shows both, in
 * the order a learner reads them: the category as a kicker, then the title of
 * the material itself. Several types collapse onto one category on purpose —
 * a new chapter and an unfinished one are both "Czytanie".
 */
export const PLAN_ITEM_CATEGORY_PL: Readonly<Record<string, string>> = {
  placement: "Test poziomujący",
  review_due: "Powtórki",
  weakness_practice: "Gramatyka",
  continue_text: "Czytanie",
  new_text: "Czytanie",
  continue_chapter: "Czytanie",
  new_chapter: "Czytanie",
  chapter_preparation: "Przygotowanie",
  chapter_assessment: "Wyzwanie",
  new_vocabulary: "Słownictwo",
};

/**
 * Polish plurals are three-way (1 / 2–4 / 5+), and getting them wrong is the
 * kind of thing that makes an app feel machine-translated. Both helpers below
 * implement the standard rule rather than guessing.
 */
function plural(n: number, one: string, few: string, many: string): string {
  const abs = Math.abs(n);
  if (abs === 1) return one;
  const mod10 = abs % 10;
  const mod100 = abs % 100;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

function pluralCards(n: number): string {
  return plural(n, "słówko", "słówka", "słówek");
}

function pluralWords(n: number): string {
  return plural(n, "słowo", "słowa", "słów");
}

/** "4 pytania", "8 słówek" — the count line under a plan activity. */
export function renderTargetCount(type: string, count: number): string | null {
  switch (type) {
    case "review_due":
      return `${count} ${pluralCards(count)}`;
    case "weakness_practice":
      return `${count} ${plural(count, "pytanie", "pytania", "pytań")}`;
    case "new_vocabulary":
      return `${count} ${pluralWords(count)}`;
    default:
      return null;
  }
}

/**
 * "1 zadanie pominięte" · "2 zadania pominięte" · "5 zadań pominiętych".
 *
 * The adjective agrees as well as the noun — a plan holds up to five activities,
 * so the 5+ form is reachable and "5 zadania pominięte" would be visible Polish.
 */
export function renderSkippedTasks(count: number): string {
  return `${count} ${plural(count, "zadanie pominięte", "zadania pominięte", "zadań pominiętych")}`;
}

/**
 * "Szacowany czas: ok. 12 min".
 *
 * THE LABEL IS THE POINT. Fluent does not measure how long anyone studied
 * (`today-engine.md` §14), so every minutes figure it shows is the planner's
 * estimate and has to read as one. "12 min nauki" would be a statistic — and a
 * false one for the learner who finished the plan in five minutes, or in thirty.
 */
export function renderEstimatedTime(minutes: number): string {
  return `Szacowany czas: ok. ${renderMinutes(minutes)}`;
}

/** "około 12 min" — never a false precision like "11 min 40 s". */
export function renderMinutes(minutes: number): string {
  return `${Math.max(1, Math.round(minutes))} min`;
}
