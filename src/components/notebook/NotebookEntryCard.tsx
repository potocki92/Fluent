"use client";

import Link from "next/link";
import { AlertCircle, BookOpen, Layers, Quote, Type } from "lucide-react";

import type { NotebookEntry } from "@/hooks/useNotebook";
import { isNoteStale } from "@/lib/notebook/notes";
import { cn } from "@/lib/utils";

/**
 * One entry of the notebook.
 *
 * WHAT EVERY ENTRY SHOWS, whatever its kind: the German, the learner's own
 * Polish, the sentence it came from, and where in which book that was. That last
 * part is the difference between a notebook and a word list — "Angst machen" on
 * its own is a phrase, "Angst machen, from the Prologue of Gra o tron, in
 * *Machen euch die Toten Angst?*" is a memory.
 *
 * THE SOURCE IS A LINK, NOT A LABEL (§57). Every entry goes back to the exact
 * sentence it was taken from, through the reader's own route — no second reading
 * surface, no modal preview of a book. `?sentence=` is read by the chapter page,
 * and a deep link BEATS the bookmark: the reader scrolls there instead of
 * resuming, and does not overwrite the place the learner actually stopped at
 * unless they stay and read.
 *
 * STALE ENTRIES SAY SO (§37). When a chapter has been reprocessed under a
 * different tokenizer, the German shown here is the text the note was TAKEN
 * against, and the entry is marked. Silently re-pointing it at whatever now sits
 * at that position would be the one outcome worse than saying nothing.
 */
export function NotebookEntryCard({ entry }: { entry: NotebookEntry }) {
  const stale = isNoteStale({
    snapshot: entry.sentence_text,
    contentVersion: entry.content_version,
    // The live text is not fetched for a list — the version stamp alone is what
    // a listing can honestly check, and it is the cheap half of the test.
    liveText: null,
  });

  const href = `/library/${entry.item_slug}/${entry.chapter_position}${
    entry.sentence_id ? `?sentence=${entry.sentence_id}` : ""
  }`;

  return (
    <li className="rounded-xl border border-[#374151] bg-[#2d3748] p-4">
      <div className="flex items-start gap-3">
        <EntryIcon entry={entry} />

        <div className="min-w-0 flex-1 space-y-1.5">
          <Headline entry={entry} />

          {entry.meaning && (
            <p className="text-sm leading-relaxed text-gold">{entry.meaning}</p>
          )}

          {entry.is_unclear && !entry.meaning && (
            <p className="text-sm font-medium text-muted2">Nie rozumiem</p>
          )}

          {/* The sentence, unless the entry IS the sentence — in which case it
              is already the headline and repeating it would be noise. */}
          {entry.entry_type !== "sentence" && (
            <p className="text-xs italic leading-relaxed text-muted2">
              {entry.sentence_text}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pt-0.5 text-xs text-muted2">
            <Link
              href={href}
              className="inline-flex items-center gap-1 rounded transition-colors hover:text-main focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/50"
            >
              <BookOpen className="size-3" />
              <span className="truncate">
                {entry.item_title} · {entry.chapter_title ?? `Rozdział ${entry.chapter_position}`}
              </span>
            </Link>
            {entry.in_review && <Badge>w powtórkach</Badge>}
            {entry.is_unclear && entry.meaning && <Badge>do wyjaśnienia</Badge>}
            {stale && <Badge title="Rozdział został przetworzony na nowo">tekst się zmienił</Badge>}
          </div>
        </div>
      </div>
    </li>
  );
}

function Headline({ entry }: { entry: NotebookEntry }) {
  if (entry.entry_type === "sentence") {
    return (
      <p className="text-sm font-medium leading-relaxed">{entry.sentence_text}</p>
    );
  }
  return (
    <p className="text-base font-semibold leading-snug">
      {entry.surface}
      {entry.lemma && (
        <span className="ml-2 text-sm font-normal text-muted2">{entry.lemma}</span>
      )}
      {/* §83: a word Fluent's dictionary does not know is still a word the
          learner met, and the notebook says which is which rather than hiding
          the difference. */}
      {entry.entry_type === "word" && entry.word_id === null && (
        <span className="ml-2 text-xs font-normal text-muted2">własne słowo</span>
      )}
    </p>
  );
}

function EntryIcon({ entry }: { entry: NotebookEntry }) {
  const { icon: Icon, tone, label } = iconFor(entry);
  return (
    <span
      aria-label={label}
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-lg bg-[#374151]",
        tone,
      )}
    >
      <Icon className="size-4" />
    </span>
  );
}

function iconFor(entry: NotebookEntry) {
  if (entry.entry_type === "word") {
    return { icon: Type, tone: "text-gold", label: "Słowo" };
  }
  if (entry.entry_type === "phrase") {
    return { icon: Layers, tone: "text-blue", label: "Zwrot" };
  }
  if (entry.is_unclear) {
    return { icon: AlertCircle, tone: "text-red", label: "Do wyjaśnienia" };
  }
  return { icon: Quote, tone: "text-green", label: "Zdanie" };
}

function Badge({ children, title }: { children: React.ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className="rounded-full bg-[#374151] px-2 py-0.5 text-[0.65rem] font-medium text-muted2"
    >
      {children}
    </span>
  );
}
