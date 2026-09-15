"use client";

import { useId, useRef, useState } from "react";

import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useKeyboardInset } from "@/hooks/useKeyboardInset";
import { cn } from "@/lib/utils";

/**
 * THE note editor. One component, every note.
 *
 * §27 IS THE POINT OF THIS FILE. A translation can be started from the word
 * sheet or from tapping the sentence, and a meaning can be started from a word
 * or from a selection — four entry points. Written as four forms they would
 * drift apart within a month: one would autosave and one would not, one would
 * trim whitespace, one would lose the draft on a rotate. So there is one form,
 * and the callers differ only in what they put in it.
 *
 * WHAT THIS SOLVES ON A PHONE, which is where every note is actually written:
 *
 *  - THE KEYBOARD. iOS Safari does not shrink the layout viewport when the
 *    keyboard opens, so a bottom-anchored sheet ends up underneath it. The inset
 *    from {@link useKeyboardInset} is added as bottom padding, which lifts the
 *    textarea AND the save button back into the visible strip (§90).
 *  - HEIGHT. `svh`, never `vh`: with the address bar showing, `100vh` is taller
 *    than the screen and the bottom of the sheet is unreachable (§91).
 *  - THE DRAFT. The text is never thrown away by a re-render, a rotation or the
 *    sheet animating; it is seeded once per opening and kept until the sheet is
 *    actually closed (§11).
 *  - READING POSITION. The sheet is a Radix dialog: it does not scroll the
 *    document, and closing it returns focus to the element that opened it, so
 *    the learner is still where they were in the chapter (§92, §144).
 *
 * AND WHAT IT DELIBERATELY DOES NOT DO: autosave. A note is saved when the
 * learner says so. Debouncing a write into a book someone is reading means their
 * half-typed thought gets stored, and "why is there a note that says *powin*"
 * is a worse failure than pressing a button.
 */
export function NoteSheet({
  open,
  title,
  /** The German this note is about. Rendered as TEXT — never markup (§104). */
  source,
  sourceLabel,
  label,
  placeholder,
  initialValue,
  maxLength,
  /** An optional second field, used for a personal headword. */
  secondary,
  seedKey,
  saving,
  error,
  canDelete,
  saveLabel = "Zapisz",
  onSave,
  onDelete,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  source: string | null;
  sourceLabel?: string;
  label: string;
  placeholder?: string;
  initialValue: string;
  maxLength: number;
  secondary?: {
    label: string;
    placeholder?: string;
    initialValue: string;
    maxLength: number;
  };
  /**
   * Changes when the fields should be re-seeded from `initialValue`.
   *
   * The caller decides, and it decides conservatively: opening the sheet for a
   * different note re-seeds; anything else that happens WHILE it is open — a
   * refetch, an "nie rozumiem" toggle that creates the underlying row — does
   * not, because the learner may be halfway through a sentence and losing it to
   * a background query is the one failure this editor must not have (§11).
   */
  seedKey: string;
  saving: boolean;
  error: string | null;
  canDelete: boolean;
  saveLabel?: string;
  onSave: (value: string, secondaryValue: string) => void;
  onDelete?: () => void;
  onClose: () => void;
  /** Extra controls under the buttons — "Nie rozumiem", "Dodaj do powtórek". */
  children?: React.ReactNode;
}) {
  const fieldId = useId();
  const secondaryId = useId();
  const [value, setValue] = useState(initialValue);
  const [secondaryValue, setSecondaryValue] = useState(
    secondary?.initialValue ?? "",
  );
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const keyboardInset = useKeyboardInset(open);

  // Re-seeding, done during render rather than in an effect — React's own
  // "adjusting state when a prop changes" pattern. An effect would render the
  // previous note's text for one frame before replacing it, which on a sheet
  // that is animating in is visible.
  const [seed, setSeed] = useState(seedKey);
  if (seed !== seedKey) {
    setSeed(seedKey);
    setValue(initialValue);
    setSecondaryValue(secondary?.initialValue ?? "");
  }

  const trimmed = value.trim();
  const tooLong = [...trimmed].length > maxLength;
  const canSave = trimmed.length > 0 && !tooLong && !saving;

  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent
        side="bottom"
        showCloseButton={false}
        onOpenAutoFocus={(event) => {
          // Focus the field, not the sheet: one tap to start writing. Done here
          // rather than with `autoFocus` so the sheet's open animation is not
          // interrupted by the keyboard appearing mid-slide.
          event.preventDefault();
          textareaRef.current?.focus();
        }}
        className="max-h-[85svh] gap-0 overflow-y-auto rounded-t-2xl border-t border-[#374151] bg-[#2d3748] px-5 pt-3 text-main"
        style={{
          paddingBottom: `calc(1.25rem + env(safe-area-inset-bottom, 0px) + ${keyboardInset}px)`,
        }}
      >
        <div
          aria-hidden
          className="mx-auto mb-3 h-1 w-10 shrink-0 rounded-full bg-[#4b5563]"
        />
        <SheetTitle className="text-base font-semibold text-main">
          {title}
        </SheetTitle>

        {source && (
          <blockquote className="mt-3 rounded-lg border-l-2 border-gold/50 bg-[#374151]/60 px-3 py-2 text-sm italic leading-relaxed text-main">
            {sourceLabel && (
              <span className="mb-1 block text-[0.7rem] font-semibold not-italic uppercase tracking-wide text-muted2">
                {sourceLabel}
              </span>
            )}
            {source}
          </blockquote>
        )}

        <label
          htmlFor={fieldId}
          className="mt-4 block text-xs font-semibold uppercase tracking-wide text-muted2"
        >
          {label}
        </label>
        <textarea
          id={fieldId}
          ref={textareaRef}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder={placeholder}
          rows={3}
          // 16px minimum: anything smaller makes iOS Safari zoom the page on
          // focus, which throws the reader's scroll position away.
          className="mt-1.5 w-full resize-none rounded-lg border border-[#4b5563] bg-[#1f2733] px-3 py-2 text-base leading-relaxed text-main outline-none placeholder:text-muted2/70 focus-visible:border-gold focus-visible:ring-2 focus-visible:ring-gold/40"
        />

        <div className="mt-1 flex items-center justify-between text-xs">
          <span className={cn("text-muted2", tooLong && "text-red")}>
            {[...trimmed].length}/{maxLength}
          </span>
        </div>

        {secondary && (
          <>
            <label
              htmlFor={secondaryId}
              className="mt-3 block text-xs font-semibold uppercase tracking-wide text-muted2"
            >
              {secondary.label}
            </label>
            <input
              id={secondaryId}
              value={secondaryValue}
              onChange={(event) => setSecondaryValue(event.target.value)}
              placeholder={secondary.placeholder}
              maxLength={secondary.maxLength}
              className="mt-1.5 w-full rounded-lg border border-[#4b5563] bg-[#1f2733] px-3 py-2 text-base text-main outline-none placeholder:text-muted2/70 focus-visible:border-gold focus-visible:ring-2 focus-visible:ring-gold/40"
            />
          </>
        )}

        {/* §101: the learner never sees a Postgres code, and always sees a way
            forward. The action already turned the failure into Polish. */}
        {error && (
          <p
            role="alert"
            className="mt-3 rounded-lg border border-red/40 bg-red/10 px-3 py-2 text-sm text-red"
          >
            {error}
          </p>
        )}

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={() => onSave(trimmed, secondaryValue.trim())}
            disabled={!canSave}
            className="h-11 flex-1 rounded-xl bg-gold text-sm font-semibold text-[#1a202c] transition-colors hover:bg-gold-dark disabled:opacity-50"
          >
            {saving ? "Zapisujemy…" : saveLabel}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="h-11 rounded-xl border border-[#4b5563] px-4 text-sm font-medium text-muted2 transition-colors hover:text-main"
          >
            Anuluj
          </button>
        </div>

        {canDelete && onDelete && (
          <button
            type="button"
            onClick={onDelete}
            disabled={saving}
            className="mt-2 h-10 w-full rounded-xl text-sm font-medium text-red transition-opacity hover:opacity-80 disabled:opacity-50"
          >
            Usuń notatkę
          </button>
        )}

        {children}
      </SheetContent>
    </Sheet>
  );
}
