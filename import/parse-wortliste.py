#!/usr/bin/env python3
"""
parse-wortliste.py — standalone seed builder (NOT part of the Next.js app).

Parses the official DTZ / Goethe-ÖSD B1 "Alphabetische Wortliste" PDF into the
headword seed consumed by `translate-import.mjs`, i.e. an array of:

    { "id", "lemma", "display", "article", "word_type", "gender" }

It does NOT produce translations or examples — those are added later by
`translate-import.mjs` (which calls the Claude API). The app works fine with
`translation_pl = null` until then.

How it works
------------
The PDF lays out two entry-columns per page; each entry-column has an inner
headword sub-column and an inner example sub-column. We read words with their
coordinates and keep only the two headword sub-columns (by x-range), then:

  - noun   : line starts with der/die/das/(das) + capitalised lemma
             → article + gender (m/f/n) derived from the article
  - verb   : line is immediately followed by a conjugation-continuation line
             (one containing the auxiliary hat/ist/war/wurde)
  - other  : everything else (adjectives, adverbs, particles, …)

Reflexive/object markers (sich, etwas, jdn, …) and variant notations
(gern/gerne, (he)runterladen) are normalised away to a single clean lemma.

Requirements
------------
    pip install pymupdf

Usage
-----
    python import/parse-wortliste.py [input.pdf] [output.json]

Defaults: import/dtz_wortliste.pdf → import/dtz_words_seed.json
Re-running is safe; it overwrites the output deterministically.
"""

import json
import re
import sys
from collections import Counter
from pathlib import Path

import fitz  # PyMuPDF

HERE = Path(__file__).resolve().parent
PDF = Path(sys.argv[1]) if len(sys.argv) > 1 else HERE / "dtz_wortliste.pdf"
OUT = Path(sys.argv[2]) if len(sys.argv) > 2 else HERE / "dtz_words_seed.json"

LET = r"A-Za-zÄÖÜäöüß"
ART = {"der": ("der", "m"), "die": ("die", "f"), "das": ("das", "n")}
SKIP = re.compile(r"^[A-ZÄÖÜ]$|WORTLISTE|ALPHABETISCH|Goethe|^\d+$")
MARKERS = {
    "sich", "etwas", "etw", "etw.", "jemanden", "jemandem",
    "jemand", "jdn", "jdm", "jdn.", "jdm.",
}


def has_aux(line: str) -> bool:
    """A verb's conjugation line carries an auxiliary (hat/ist/war/wurde)."""
    return re.search(r"\b(hat|ist|war|wurde)\b", line) is not None


def normalize(tok: str) -> str:
    """Strip parens, variant slashes and punctuation to a bare lemma."""
    tok = tok.replace("(", "").replace(")", "")        # (he)runterladen → herunterladen
    tok = re.split(r"[/,]", tok)[0]                     # gern/gerne → gern
    tok = tok.strip().strip("„\"").strip()           # surrounding quotes
    tok = re.sub(rf"[^{LET}\-].*$", "", tok)            # keep letters + internal hyphen
    if tok.startswith("-"):                             # suffix marker (-en, -zeug, …)
        return ""
    return tok.strip("-")                               # all- → all, but keep E-Mail


def head_lemma(tokens: list[str]) -> str:
    """First content token after skipping reflexive/object markers."""
    for t in tokens:
        c = normalize(t)
        if c and c.lower() not in MARKERS:
            return c
    return ""


def is_infinitive(word: str) -> bool:
    """A lowercase headword ending in -n is an infinitive candidate."""
    return len(word) >= 3 and word[:1].islower() and word.endswith("n")


def is_conjugation_row(line: str) -> bool:
    """A finite-form row that continues a verb's conjugation, e.g. 'druckt aus,'
    or 'druckte aus,' — lowercase, comma-terminated, not a new infinitive and
    not an article-led noun headword."""
    toks = line.split()
    if not toks or toks[0].strip("()") in ART:
        return False
    return line[:1].islower() and line.endswith(",") and not is_infinitive(head_lemma(toks))


def headword_lines(doc: "fitz.Document") -> list[str]:
    """Reconstruct headword-sub-column lines across the wordlist pages."""
    stop = doc.page_count
    for i, page in enumerate(doc):
        if "ANHANG" in page.get_text():  # appendix begins → end of wordlist
            stop = i
            break

    lines: list[str] = []
    for pi in range(stop):
        words = doc[pi].get_text("words")  # (x0, y0, x1, y1, text, …)

        def column(predicate) -> list[str]:
            rows: dict[int, list[tuple[float, str]]] = {}
            for w in words:
                x0, y0, y1, txt = w[0], w[1], w[3], w[4]
                if y0 < 70 or y1 > 812 or not predicate(x0):
                    continue
                rows.setdefault(round(y0 / 2) * 2, []).append((x0, txt))
            return [
                " ".join(t for _, t in sorted(cells))
                for _, cells in sorted(rows.items())
            ]

        lines += column(lambda x: 30 <= x < 150)    # left entry-column headwords
        lines += column(lambda x: 295 <= x < 410)   # right entry-column headwords
    return lines


def parse(lines: list[str]) -> list[dict]:
    entries: list[dict] = []
    i, n = 0, len(lines)
    while i < n:
        line = lines[i].strip()
        i += 1
        if not line or SKIP.search(line):
            continue
        tokens = line.split()
        art = tokens[0].strip("()")

        # NOUN: "der/die/das/(das) Lemma, -plural"
        if art in ART and len(tokens) >= 2 and re.match(r"^[A-ZÄÖÜ]", tokens[1].lstrip("(")):
            article, gender = ART[art]
            lemma = normalize(tokens[1])
            if len(lemma) >= 2:
                entries.append({
                    "lemma": lemma, "display": f"{article} {lemma}",
                    "article": article, "word_type": "noun", "gender": gender,
                })
            continue

        lemma = head_lemma(tokens)

        # VERB: an infinitive headword whose conjugation table follows (it ends
        # with a comma, or already carries the auxiliary on the same line). The
        # table may wrap over several rows but always ends on the auxiliary
        # (hat/ist/…) line, so consume rows up to and including that line.
        if is_infinitive(lemma) and (line.rstrip().endswith(",") or has_aux(line)):
            entries.append({
                "lemma": lemma, "display": lemma,
                "article": None, "word_type": "verb", "gender": None,
            })
            for _ in range(4):  # cap: longest table is infinitive + 3 rows
                if i >= n:
                    break
                row = lines[i].strip()
                if has_aux(row):       # auxiliary line closes the table
                    i += 1
                    break
                if is_conjugation_row(row):
                    i += 1
                else:
                    break             # next headword (incl. 'gut, besser,')
            continue

        # Stray auxiliary line that never attached to an infinitive → ignore.
        if has_aux(line):
            continue

        # OTHER: adjectives, adverbs, particles, …
        if len(lemma) >= 2:
            entries.append({
                "lemma": lemma, "display": lemma,
                "article": None, "word_type": "other", "gender": None,
            })

    # Deduplicate on (lemma, word_type, article); the article keeps gender
    # homographs apart (der Leiter vs die Leiter, der Teil vs das Teil).
    seen: set[tuple[str, str, str | None]] = set()
    unique: list[dict] = []
    for e in entries:
        key = (e["lemma"].lower(), e["word_type"], e["article"])
        if key in seen:
            continue
        seen.add(key)
        unique.append({"id": len(unique) + 1, **e})
    return unique


def main() -> None:
    if not PDF.exists():
        sys.exit(f"✗ PDF not found: {PDF}")
    doc = fitz.open(PDF)
    words = parse(headword_lines(doc))
    OUT.write_text(json.dumps(words, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    by_type = dict(Counter(w["word_type"] for w in words))
    print(f"✓ {len(words)} headwords → {OUT}")
    print(f"  by type: {by_type}")


if __name__ == "__main__":
    main()
