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


def is_continuation(line: str) -> bool:
    """A verb's second line carries the auxiliary (hat/ist/war/wurde)."""
    return re.search(r"\b(hat|ist|war|wurde)\b", line) is not None


def normalize(tok: str) -> str:
    """Strip parens, variant slashes and trailing punctuation to a bare lemma."""
    tok = tok.replace("(", "").replace(")", "")        # (he)runterladen → herunterladen
    tok = re.split(r"[/,]", tok)[0]                     # gern/gerne → gern
    tok = tok.strip().strip("-_„\"").strip()       # leading/trailing dashes, quotes
    return re.sub(rf"[^{LET}].*$", "", tok)             # cut at first non-letter


def head_lemma(tokens: list[str]) -> str:
    """First content token after skipping reflexive/object markers."""
    for t in tokens:
        c = normalize(t)
        if c and c.lower() not in MARKERS:
            return c
    return ""


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

        # Orphan conjugation line with no preceding infinitive → ignore.
        if is_continuation(line):
            continue

        # VERB: the next line is the conjugation continuation.
        nxt = lines[i].strip() if i < n else ""
        if nxt and is_continuation(nxt) and nxt.split()[0].strip("()") not in ART:
            i += 1
            lemma = head_lemma(tokens)
            if lemma.endswith("n") and len(lemma) >= 3:
                entries.append({
                    "lemma": lemma, "display": lemma,
                    "article": None, "word_type": "verb", "gender": None,
                })
            continue

        # OTHER: adjectives, adverbs, particles, …
        lemma = head_lemma(tokens)
        if len(lemma) >= 2:
            entries.append({
                "lemma": lemma, "display": lemma,
                "article": None, "word_type": "other", "gender": None,
            })

    # Deduplicate on (lemma, word_type); assign stable 1-based ids.
    seen: set[tuple[str, str]] = set()
    unique: list[dict] = []
    for e in entries:
        key = (e["lemma"].lower(), e["word_type"])
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
