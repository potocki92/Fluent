import type { WordType } from "@/types";

/** Background/text tokens for the article (rodzaj) chip on a flashcard. */
export const ARTICLE_CHIP: Record<"der" | "die" | "das", string> = {
  der: "bg-blue-900/40 text-blue-300",
  die: "bg-pink-900/40 text-pink-300",
  das: "bg-purple-900/40 text-purple-300",
};

/** Polish labels for each grammatical word type. */
export const TYPE_LABEL: Record<WordType, string> = {
  noun: "rzeczownik",
  verb: "czasownik",
  other: "inne",
};
