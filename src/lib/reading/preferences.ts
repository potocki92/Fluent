/**
 * Reader typography and theme.
 *
 * WHERE THESE LIVE AND WHY. On the profile, not in `localStorage`: a learner who
 * sets 20px serif on their phone should not meet 17px sans on their laptop, and
 * Fluent already keeps learner-owned preferences (`daily_word_goal`,
 * `timezone`, `daily_learning_minutes`) there. They are ordinary editable
 * columns — nothing here is progress, so the profile write guard leaves them
 * alone.
 *
 * Stored as one jsonb value rather than five columns because they are a single
 * preference object that will grow (margins, justification, a reading ruler) and
 * none of it is ever queried or constrained. That is exactly the case jsonb is
 * for — and the opposite of the rule in `learning_events`, where the columns
 * that matter are columns.
 *
 * Pure and validated here so the reader can render the chosen size on the FIRST
 * paint, server-side, with no flash of default type.
 */

export type ReaderFontSize = "small" | "medium" | "large" | "xlarge";
export type ReaderLineHeight = "tight" | "normal" | "relaxed";
export type ReaderTheme = "dark" | "light" | "sepia";
export type ReaderFontFamily = "sans" | "serif";

export interface ReaderPreferences {
  fontSize: ReaderFontSize;
  lineHeight: ReaderLineHeight;
  theme: ReaderTheme;
  fontFamily: ReaderFontFamily;
}

export const DEFAULT_READER_PREFERENCES: ReaderPreferences = {
  fontSize: "medium",
  lineHeight: "normal",
  // The app is dark; opening a book into a white page at night would be a
  // deliberate choice, not a default.
  theme: "dark",
  fontFamily: "serif",
};

/** rem values. Steps are ~12% apart — noticeable, never jarring. */
export const FONT_SIZE_REM: Readonly<Record<ReaderFontSize, string>> = {
  small: "0.9375rem",
  medium: "1.0625rem",
  large: "1.1875rem",
  xlarge: "1.375rem",
};

export const LINE_HEIGHT_VALUE: Readonly<Record<ReaderLineHeight, string>> = {
  tight: "1.55",
  normal: "1.75",
  relaxed: "1.95",
};

/**
 * NO WEBFONT IS DOWNLOADED FOR THIS. The serif stack is whatever the device
 * already has — Georgia, Times, a system UI serif — which is both instant and
 * the font the reader's own OS chose for long text. Shipping a 200 KB display
 * serif to make a reading screen prettier is a cost the learner pays on every
 * chapter.
 */
export const FONT_FAMILY_STACK: Readonly<Record<ReaderFontFamily, string>> = {
  sans: "var(--font-sans)",
  serif:
    'Charter, Georgia, "Iowan Old Style", "Palatino Linotype", "Book Antiqua", ui-serif, serif',
};

export const FONT_SIZE_LABEL_PL: Readonly<Record<ReaderFontSize, string>> = {
  small: "Mała",
  medium: "Średnia",
  large: "Duża",
  xlarge: "Bardzo duża",
};

export const LINE_HEIGHT_LABEL_PL: Readonly<Record<ReaderLineHeight, string>> = {
  tight: "Zwarta",
  normal: "Normalna",
  relaxed: "Luźna",
};

export const THEME_LABEL_PL: Readonly<Record<ReaderTheme, string>> = {
  dark: "Ciemny",
  light: "Jasny",
  sepia: "Sepia",
};

export const FONT_FAMILY_LABEL_PL: Readonly<Record<ReaderFontFamily, string>> = {
  sans: "Bezszeryfowa",
  serif: "Szeryfowa",
};

const FONT_SIZES = Object.keys(FONT_SIZE_REM) as ReaderFontSize[];
const LINE_HEIGHTS = Object.keys(LINE_HEIGHT_VALUE) as ReaderLineHeight[];
const THEMES = Object.keys(THEME_LABEL_PL) as ReaderTheme[];
const FONT_FAMILIES = Object.keys(FONT_FAMILY_STACK) as ReaderFontFamily[];

/**
 * Coerce whatever is in the column into valid preferences.
 *
 * jsonb has no schema, the value has been through at least one client, and a
 * reader that crashes on `{"fontSize": 42}` is a reader that crashes. Anything
 * unrecognised falls back to the default for that field alone, so one bad key
 * never discards the other three.
 */
export function parseReaderPreferences(value: unknown): ReaderPreferences {
  const raw = (value ?? {}) as Record<string, unknown>;
  return {
    fontSize: pick(raw.fontSize, FONT_SIZES, DEFAULT_READER_PREFERENCES.fontSize),
    lineHeight: pick(raw.lineHeight, LINE_HEIGHTS, DEFAULT_READER_PREFERENCES.lineHeight),
    theme: pick(raw.theme, THEMES, DEFAULT_READER_PREFERENCES.theme),
    fontFamily: pick(
      raw.fontFamily,
      FONT_FAMILIES,
      DEFAULT_READER_PREFERENCES.fontFamily,
    ),
  };
}

/** The inline custom properties the reader surface is rendered with. */
export function readerStyleVars(
  preferences: ReaderPreferences,
): Record<string, string> {
  return {
    "--reader-font-size": FONT_SIZE_REM[preferences.fontSize],
    "--reader-line-height": LINE_HEIGHT_VALUE[preferences.lineHeight],
    "--reader-font-family": FONT_FAMILY_STACK[preferences.fontFamily],
  };
}

function pick<T extends string>(value: unknown, allowed: T[], fallback: T): T {
  return typeof value === "string" && (allowed as string[]).includes(value)
    ? (value as T)
    : fallback;
}
