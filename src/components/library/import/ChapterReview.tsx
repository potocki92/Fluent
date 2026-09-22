"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  Merge,
  Pencil,
  Scissors,
  X,
} from "lucide-react";

import { editImportChapter } from "@/actions/book-import";
import { settleAction } from "@/lib/errors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CONFIDENCE_LABELS } from "@/lib/import/state";
import type { ImportChapterPreview } from "@/lib/import/queries";
import { cn } from "@/lib/utils";

/**
 * The screen the whole importer exists for.
 *
 * A chapter detector is a heuristic, and the learner is looking at their own
 * book — so the only honest design is one where the machine proposes and the
 * person disposes. Everything here is a correction: rename, include, exclude,
 * split, merge, reorder. Nothing else about the text is editable, deliberately:
 * a 300 000-word textarea is not an editor, it is a way to lose a book.
 *
 * CONFIDENCE IS A BADGE, NOT A NUMBER. "Sprawdź" points at the two boundaries
 * worth looking at in a seventy-chapter novel. `0.84371` would point at nothing
 * and invite the learner to treat the detector's arithmetic as a measurement.
 *
 * USABLE ON A PHONE, because that is where a lot of this will happen. Each
 * chapter is one row with a snippet; the controls appear when a row is opened.
 * Seventy accordions each holding twenty pages of text would be unusable on any
 * screen and unloadable on a small one — which is why the server sends a snippet
 * and the full text never leaves the database.
 */
export function ChapterReview({
  importId,
  chapters,
  disabled,
}: {
  importId: string;
  chapters: readonly ImportChapterPreview[];
  disabled?: boolean;
}) {
  const included = chapters.filter((chapter) => chapter.included);

  return (
    <section className="space-y-2">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted2">
          Rozdziały
        </h2>
        <p className="text-xs text-muted2">
          {included.length} z {chapters.length} zostanie zaimportowanych
        </p>
      </div>

      <ol className="space-y-1.5">
        {chapters.map((chapter, index) => (
          <li key={chapter.id}>
            <ChapterRow
              importId={importId}
              chapter={chapter}
              isFirst={index === 0}
              isLast={index === chapters.length - 1}
              disabled={disabled}
            />
          </li>
        ))}
      </ol>
    </section>
  );
}

function ChapterRow({
  importId,
  chapter,
  isFirst,
  isLast,
  disabled,
}: {
  importId: string;
  chapter: ImportChapterPreview;
  isFirst: boolean;
  isLast: boolean;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(chapter.title ?? "");
  const [error, setError] = useState<string | null>(null);

  const busy = pending || disabled;

  const run = (edit: Parameters<typeof editImportChapter>[1]) => {
    setError(null);
    startTransition(async () => {
      const result = await settleAction(
        () => editImportChapter(importId, edit),
        `editImportChapter ${importId}`,
      );
      if (!result.ok) setError(result.message);
      else router.refresh();
    });
  };

  const label = chapter.title ?? chapter.detectedTitle ?? `Rozdział ${chapter.position}`;
  const uncertain = chapter.confidence === "low";

  return (
    <div
      className={cn(
        "rounded-xl border bg-card transition-opacity",
        uncertain ? "border-gold/40" : "border-border",
        !chapter.included && "opacity-55",
      )}
    >
      <div className="flex items-start gap-2 p-3">
        {/* Include / exclude. A checkbox rather than a delete button: nothing
            the detector found is ever destroyed, it is only left out. */}
        <button
          type="button"
          disabled={busy}
          aria-label={chapter.included ? "Wyłącz z importu" : "Dołącz do importu"}
          onClick={() =>
            run({ op: "include", chapterId: chapter.id, included: !chapter.included })
          }
          className={cn(
            "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded border transition-colors",
            chapter.included
              ? "border-gold bg-gold text-[#1a202c]"
              : "border-border text-transparent hover:border-muted2",
          )}
        >
          <Check className="size-3.5" />
        </button>

        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="min-w-0 flex-1 text-left"
          aria-expanded={open}
        >
          <div className="flex items-center gap-2">
            <span className="shrink-0 text-xs tabular-nums text-muted2">
              {chapter.position}.
            </span>
            <span className="truncate text-sm font-medium text-main">{label}</span>
            {uncertain && (
              <span className="flex shrink-0 items-center gap-1 rounded-full bg-gold/15 px-1.5 py-0.5 text-[10px] font-medium text-gold">
                <AlertTriangle className="size-2.5" />
                {CONFIDENCE_LABELS.low}
              </span>
            )}
            {chapter.isFrontMatter && (
              <span className="shrink-0 rounded-full bg-[#374151] px-1.5 py-0.5 text-[10px] text-muted2">
                Strona tytułowa
              </span>
            )}
          </div>
          <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted2">
            {chapter.snippet}
          </p>
          <p className="mt-1 text-[11px] text-muted2">
            {chapter.wordCount.toLocaleString("pl-PL")} słów
            {chapter.pageStart !== null &&
              ` · strony ${chapter.pageStart}–${chapter.pageEnd ?? chapter.pageStart}`}
          </p>
        </button>

        <ChevronDown
          className={cn(
            "mt-0.5 size-4 shrink-0 text-muted2 transition-transform",
            open && "rotate-180",
          )}
        />
      </div>

      {open && (
        <div className="border-t border-border p-3">
          {renaming ? (
            <form
              className="flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                setRenaming(false);
                run({ op: "rename", chapterId: chapter.id, title });
              }}
            >
              <Input
                value={title}
                autoFocus
                maxLength={200}
                placeholder="Tytuł rozdziału"
                onChange={(event) => setTitle(event.target.value)}
              />
              <Button type="submit" size="sm" disabled={busy}>
                Zapisz
              </Button>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                onClick={() => {
                  setRenaming(false);
                  setTitle(chapter.title ?? "");
                }}
              >
                <X className="size-4" />
              </Button>
            </form>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              <Button size="sm" variant="outline" disabled={busy} onClick={() => setRenaming(true)}>
                <Pencil className="size-3.5" /> Zmień tytuł
              </Button>

              <Button
                size="sm"
                variant="outline"
                disabled={busy || isFirst}
                onClick={() => run({ op: "merge_up", chapterId: chapter.id })}
              >
                <Merge className="size-3.5" /> Scal z poprzednim
              </Button>

              {/* Splitting is offered at a paragraph boundary, because that is
                  the only cut that cannot land inside a sentence — and because
                  the paragraph positions are what reading progress points at. */}
              {chapter.paragraphCount > 1 && (
                <SplitControl
                  paragraphCount={chapter.paragraphCount}
                  disabled={busy}
                  onSplit={(paragraph) => run({ op: "split", chapterId: chapter.id, paragraph })}
                />
              )}

              <Button
                size="icon-sm"
                variant="outline"
                aria-label="Przenieś wyżej"
                disabled={busy || isFirst}
                onClick={() => run({ op: "move", chapterId: chapter.id, direction: "up" })}
              >
                <ArrowUp className="size-3.5" />
              </Button>
              <Button
                size="icon-sm"
                variant="outline"
                aria-label="Przenieś niżej"
                disabled={busy || isLast}
                onClick={() => run({ op: "move", chapterId: chapter.id, direction: "down" })}
              >
                <ArrowDown className="size-3.5" />
              </Button>
            </div>
          )}

          {error && (
            <p role="alert" className="mt-2 text-xs text-red">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Where to cut.
 *
 * A number, not a text editor. The learner picks the paragraph the next chapter
 * starts at; the server slices on the same blank-line boundary the content
 * pipeline uses, so the cut can never land inside a sentence.
 */
function SplitControl({
  paragraphCount,
  disabled,
  onSplit,
}: {
  paragraphCount: number;
  disabled?: boolean;
  onSplit: (paragraph: number) => void;
}) {
  const [value, setValue] = useState(Math.max(1, Math.floor(paragraphCount / 2)));
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <Button size="sm" variant="outline" disabled={disabled} onClick={() => setOpen(true)}>
        <Scissors className="size-3.5" /> Podziel
      </Button>
    );
  }

  return (
    <div className="flex w-full items-center gap-2">
      <label className="text-xs text-muted2" htmlFor="split-at">
        Podziel po akapicie
      </label>
      <Input
        id="split-at"
        type="number"
        min={1}
        max={paragraphCount - 1}
        value={value}
        className="h-8 w-20"
        onChange={(event) => setValue(Number(event.target.value))}
      />
      <span className="text-xs text-muted2">z {paragraphCount}</span>
      <Button
        size="sm"
        disabled={disabled || value < 1 || value >= paragraphCount}
        onClick={() => {
          setOpen(false);
          onSplit(value);
        }}
      >
        Podziel
      </Button>
      <Button size="icon-sm" variant="ghost" onClick={() => setOpen(false)}>
        <X className="size-4" />
      </Button>
    </div>
  );
}
