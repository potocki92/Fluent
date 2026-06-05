import type { WordTopic } from "@/types";

/**
 * DTZ thematic categories for dictionary words, with their Polish labels.
 * Shared by the admin word editor (a Select) and the `/browse` topic filter so
 * the option set stays in one place.
 */
export const WORD_TOPICS: { value: WordTopic; label: string }[] = [
  { value: "praca", label: "Praca" },
  { value: "zdrowie", label: "Zdrowie" },
  { value: "urzad", label: "Urząd" },
  { value: "mieszkanie", label: "Mieszkanie" },
  { value: "zakupy", label: "Zakupy" },
  { value: "rodzina", label: "Rodzina" },
  { value: "edukacja", label: "Edukacja" },
  { value: "podroze", label: "Podróże" },
  { value: "czas-wolny", label: "Czas wolny" },
  { value: "jedzenie", label: "Jedzenie" },
];

const TOPIC_VALUES = new Set<WordTopic>(WORD_TOPICS.map((t) => t.value));

/** Narrow an arbitrary string to a {@link WordTopic}, or `undefined`. */
export function toTopic(value?: string | null): WordTopic | undefined {
  return value && TOPIC_VALUES.has(value as WordTopic)
    ? (value as WordTopic)
    : undefined;
}

/** Polish label for a topic value (falls back to the raw value). */
export function topicLabel(value: string): string {
  return WORD_TOPICS.find((t) => t.value === value)?.label ?? value;
}
