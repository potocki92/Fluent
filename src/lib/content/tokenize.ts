/**
 * Step 4: a sentence → its tokens.
 *
 * WHY NOT `split(" ")`. Every one of these is a word the reader must be able to
 * tap, and none of them survives a space split intact:
 *
 *   Schwert.            trailing punctuation becomes part of the token
 *   »Warum?«            typographic quotes glued to both ends
 *   E-Mail-Adresse      inner hyphens are part of one German compound
 *   geht's              the apostrophe belongs to the word
 *   Fußgängerübergang   ß and umlauts must survive normalisation
 *
 * WHAT A TOKEN CARRIES. Its surface form (exactly as written, because the reader
 * shows it), its character span within the sentence (so an occurrence can be
 * anchored without re-scanning), and a normalised form for dictionary lookup.
 * Punctuation is not a token: it is the gap between them.
 */

/**
 * A lexical token: letters, plus the marks that live INSIDE German words.
 *
 * Inner hyphens and apostrophes are included but never leading or trailing ones,
 * so "E-Mail" is one token while an em-dash between clauses is not part of
 * either neighbour.
 */
const TOKEN_RE = /\p{L}[\p{L}\p{M}]*(?:[''’\-]\p{L}[\p{L}\p{M}]*)*/gu;

export interface Token {
  /** 0-based index among the LEXICAL tokens of the sentence. */
  position: number;
  /** Exactly as written, including capitalisation and inner punctuation. */
  surface: string;
  /** Lowercased, with typographic apostrophes folded. Umlauts are preserved. */
  normalized: string;
  /** Character offsets within the sentence text. */
  charStart: number;
  charEnd: number;
}

/**
 * Tokenize one sentence.
 *
 * Deterministic and allocation-light: one regex pass, no lookahead over the
 * whole document. A 300 000-word book is ~1.5 million calls to this, so it stays
 * boring on purpose.
 */
export function tokenize(sentence: string): Token[] {
  const tokens: Token[] = [];

  for (const match of sentence.matchAll(TOKEN_RE)) {
    const surface = match[0];
    const charStart = match.index ?? 0;
    tokens.push({
      position: tokens.length,
      surface,
      normalized: normalizeToken(surface),
      charStart,
      charEnd: charStart + surface.length,
    });
  }

  return tokens;
}

/** Lowercase and fold the apostrophe variants, keeping umlauts and ß intact. */
export function normalizeToken(surface: string): string {
  return surface.toLowerCase().replace(/[''’]/g, "'");
}

/** Total lexical tokens in a string — the pipeline's definition of "word". */
export function countTokens(text: string): number {
  return (text.match(TOKEN_RE) ?? []).length;
}
