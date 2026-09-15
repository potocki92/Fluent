"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  HelpCircle,
  NotebookPen,
  Plus,
  Settings2,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type KeyboardEvent,
} from "react";

import {
  completeChapter,
  endReadingSession,
  recordWordLookup,
  reportReadingProgress,
  startReadingSession,
  type ChapterSummary,
} from "@/actions/reading";
import { markChapterReading } from "@/actions/chapter-analysis";
import { updateReaderPreferences } from "@/actions/update-reader-preferences";
import { AnnotationSheet, type AnnotationTarget } from "@/components/notebook/AnnotationSheet";
import { ChapterNotebookSummary } from "@/components/notebook/ChapterNotebookSummary";
import { SentenceNoteSheet } from "@/components/notebook/SentenceNoteSheet";
import { ChapterCompleteCard } from "@/components/reader/ChapterCompleteCard";
import {
  ReaderActionBar,
  type ReaderAction,
} from "@/components/reader/ReaderActionBar";
import {
  glossTargetFrom,
  isUsableSelection,
  readerBarPlan,
  resolveReaderIntent,
  type GlossTarget,
  type ReaderWordHit,
} from "@/components/reader/reader-interaction";
import {
  clearSelection,
  observeReaderSelection,
  pointerInsideRect,
  readerHitAt,
  readerWordHit,
  readReaderSelection,
  type ReaderSelection,
  type ReaderSelectionObserver,
} from "@/components/reader/sentence-selection";
import { ReaderSettingsSheet } from "@/components/reader/ReaderSettingsSheet";
import { WordGlossSheet } from "@/components/reader/WordGlossSheet";
import { useActiveReadingClock } from "@/hooks/useActiveReadingClock";
import { useChapterNotebook } from "@/hooks/useChapterNotebook";
import { useVisibleParagraph } from "@/hooks/useVisibleParagraph";
import { newInteractionId } from "@/lib/interaction-id";
import { EMPTY_SUMMARY, summarizeNotebook } from "@/lib/notebook/summary";
import {
  CHAPTER_COMPLETION_RATIO,
  PROGRESS_FLUSH_MS,
  PROGRESS_FLUSH_PARAGRAPHS,
} from "@/lib/reading/constants";
import {
  readerStyleVars,
  type ReaderPreferences,
} from "@/lib/reading/preferences";
import { cn } from "@/lib/utils";

export interface ReaderChapterMeta {
  id: string;
  position: number;
  title: string | null;
  paragraphCount: number;
  wordCount: number;
  estimatedMinutes: number;
  itemId: string;
  itemSlug: string;
  itemTitle: string;
  previousPosition: number | null;
  nextPosition: number | null;
  /** Set when this chapter is a migrated `texts` passage — its test still exists. */
  legacyTextId: number | null;
  /** True when a validated question bank can fill a Chapter Challenge. */
  hasChallenge: boolean;
}

/**
 * What the contextual action bar is currently about.
 *
 * TWO MODES, NEVER ONE SHAPE. A selection and a tapped sentence used to share
 * one state, with a tapped sentence faked as a zero-width selection — which is
 * how a word tap could end up rendering the SENTENCE's actions. They are
 * different subjects and they are now different variants, so no offer can be
 * attributed to a gesture that did not ask for it.
 */
type ReaderBar =
  | { mode: "selection"; selection: ReaderSelection }
  | { mode: "sentence"; sentenceId: number; sentenceText: string; rect: DOMRect };

/**
 * The reader's behaviour. The TEXT is not here — it arrives as `children`,
 * rendered on the server by `ReaderProse`.
 *
 * That split is the whole performance and accessibility story of Phase 4. The
 * old reader parsed an HTML blob in the browser with `DOMParser` and rebuilt it
 * as React nodes, so the prose did not exist until hydration and the cost grew
 * with the length of the passage. Here the chapter is real document text in the
 * first response, and this component adds four behaviours on top of it:
 *
 *   1. ONE delegated listener for every interactive word — not a component per
 *      word, which for a 15 000-word chapter would be thousands of mounts;
 *   2. progress, observed from what was actually on screen and flushed on a
 *      timer rather than per scroll event;
 *   3. an active-reading clock that stops when the reader does;
 *   4. typography and theme, applied as CSS custom properties so changing them
 *      re-renders nothing.
 */
export function ReaderShell({
  chapter,
  initialPreferences,
  children,
}: {
  chapter: ReaderChapterMeta;
  initialPreferences: ReaderPreferences;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const contentRef = useRef<HTMLDivElement>(null);

  const [preferences, setPreferences] = useState(initialPreferences);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [gloss, setGloss] = useState<GlossTarget | null>(null);
  const [summary, setSummary] = useState<ChapterSummary | null>(null);
  const [ratio, setRatio] = useState(0);
  const [chromeHidden, setChromeHidden] = useState(false);
  const [completing, setCompleting] = useState(false);

  // ── the notebook ──────────────────────────────────────────────────────────
  // Three pieces of state, one for each thing a learner can be in the middle of:
  // the contextual action bar, the meaning editor, the translation editor. They
  // are held HERE rather than inside the word sheet so that each editor exists
  // exactly once — the word sheet and a selection open the SAME translation
  // editor, which is what §27 is about.
  const [bar, setBar] = useState<ReaderBar | null>(null);
  const [annotation, setAnnotation] = useState<AnnotationTarget | null>(null);
  const [noteTarget, setNoteTarget] = useState<
    { sentenceId: number; sentenceText: string } | null
  >(null);

  // The session id is kept in BOTH a ref and state, deliberately. The ref is
  // read by the progress flush, which runs from timers and `pagehide` handlers
  // and must see the latest value without re-subscribing; the state is what
  // render may look at, because reading a ref during render is how a component
  // ends up showing a value React never told it about.
  const sessionRef = useRef<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const flushedParagraphRef = useRef(-1);
  const lastFlushRef = useRef(0);

  const clock = useActiveReadingClock();
  const visibleParagraph = useVisibleParagraph(contentRef, chapter.paragraphCount);
  const { data: marks } = useChapterNotebook(chapter.id);

  // ── the session ───────────────────────────────────────────────────────────
  // Opening the chapter is also the authorisation check and the resume lookup:
  // one call, so the reader never has to decide either question for itself.
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const result = await startReadingSession(chapter.id);
      if (cancelled || !result.ok) return;

      sessionRef.current = result.sessionId;
      setSessionId(result.sessionId);
      setRatio(result.progressRatio);
      flushedParagraphRef.current = result.furthestParagraph;

      // The LEARNING lifecycle, which is a different fact from the reading
      // progress above: `reading_progress` says where they are, this says the
      // chapter has been entered. Best-effort — a failed transition costs a
      // marker on the book page, never the reading session.
      void markChapterReading(chapter.id, "started");

      // A DEEP LINK WINS OVER RESUME (§57, §58). Arriving from the notebook
      // means "take me to THIS sentence", which is a different request from
      // "take me back to where I stopped" — and doing both would land the
      // learner in the wrong place half the time. Read from the URL rather than
      // through `useSearchParams`, which would make this component require a
      // Suspense boundary for a value it only ever needs once.
      const deepLink = Number(
        new URLSearchParams(window.location.search).get("sentence"),
      );
      const linked = Number.isFinite(deepLink)
        ? document.querySelector<HTMLElement>(
            `.reader-sentence[data-sentence-id="${deepLink}"]`,
          )
        : null;

      if (linked) {
        linked.scrollIntoView({ block: "center" });
        // A moment of emphasis so the learner can see WHICH sentence they were
        // sent to; it fades on the next interaction rather than persisting as a
        // fourth permanent mark in the prose.
        linked.dataset.active = "true";
        window.setTimeout(() => delete linked.dataset.active, 2400);
        return;
      }

      // RESUME. Jump to where they stopped — the single feature that makes a
      // book, as opposed to a passage, usable at all.
      if (result.resumeParagraph > 0) {
        const target = document.getElementById(`p-${result.resumeParagraph}`);
        target?.scrollIntoView({ block: "start" });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [chapter.id]);

  // ── progress ──────────────────────────────────────────────────────────────
  const flush = useCallback(
    async (force = false) => {
      const sessionId = sessionRef.current;
      if (!sessionId) return;

      const seconds = clock.drain();
      const moved = visibleParagraph > flushedParagraphRef.current;
      if (!force && !moved && seconds === 0) return;

      flushedParagraphRef.current = Math.max(
        flushedParagraphRef.current,
        visibleParagraph,
      );
      lastFlushRef.current = Date.now();

      const result = await reportReadingProgress({
        sessionId,
        paragraphPosition: visibleParagraph,
        activeSeconds: seconds,
      });
      if (result.ok) setRatio(result.progressRatio);
    },
    [clock, visibleParagraph],
  );

  // A REQUEST PER SCROLL EVENT IS BOTH USELESS AND ABUSIVE. Progress is only
  // worth a round trip when the answer changed, so it is batched: at most one
  // write every PROGRESS_FLUSH_MS, plus an early one the first time the learner
  // has genuinely moved through the chapter.
  useEffect(() => {
    const sinceFlush = Date.now() - lastFlushRef.current;
    const jumped =
      visibleParagraph - flushedParagraphRef.current >= PROGRESS_FLUSH_PARAGRAPHS;

    if (jumped && sinceFlush > 2000) {
      void flush();
      return;
    }

    const timer = window.setTimeout(() => void flush(), PROGRESS_FLUSH_MS);
    return () => window.clearTimeout(timer);
  }, [flush, visibleParagraph]);

  // Leaving the page is the one moment progress MUST be written: `pagehide` and
  // a hidden document are the modern, mobile-safe replacements for `unload`,
  // which never fires reliably on a phone.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") void flush(true);
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onHide);
    };
  }, [flush]);

  useEffect(() => {
    return () => {
      const sessionId = sessionRef.current;
      if (sessionId) void endReadingSession({ sessionId, activeSeconds: clock.peek() });
    };
  }, [clock]);

  // ── immersive chrome ──────────────────────────────────────────────────────
  // Hidden while reading forward, back the moment the learner scrolls up. The
  // threshold matters: a header that reacts to every pixel is worse than one
  // that never moves.
  useEffect(() => {
    let last = window.scrollY;

    const onScroll = () => {
      const current = window.scrollY;
      const delta = current - last;
      if (Math.abs(delta) < 24) return;
      last = current;
      setChromeHidden(delta > 0 && current > 120);
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // ── words ─────────────────────────────────────────────────────────────────
  const openGloss = useCallback(
    (word: ReaderWordHit) => {
      // The sentence comes from the DOM rather than from props: it is already on
      // the page, and shipping every sentence twice would double the payload of
      // a chapter for a string that is only ever needed one at a time.
      const sentence =
        (word.sentenceId
          ? contentRef.current?.querySelector<HTMLElement>(
              `.reader-sentence[data-sentence-id="${word.sentenceId}"]`,
            )?.textContent
          : null) ?? "";

      const target = glossTargetFrom(word, sentence);
      if (!target) return;
      setGloss(target);

      // A LOOKUP IS NOT A FAILED TEST — the weight of this evidence is decided
      // in `readingLookupEvidence`, not here. Fire and forget: recording it must
      // never delay showing the translation, and the interaction id makes a
      // retry settle the same lookup rather than count the word unknown twice.
      if (target.wordId) {
        void recordWordLookup({
          interactionId: newInteractionId(),
          chapterId: chapter.id,
          libraryItemId: chapter.itemId,
          wordId: target.wordId,
          sentenceId: target.sentenceId,
          occurrenceId: target.occurrenceId,
          readingSessionId: sessionRef.current,
        });
      }
    },
    [chapter.id, chapter.itemId],
  );

  // ── the native selection, observed rather than discovered ─────────────────
  // A SELECTION IS NEVER HIJACKED (§30) AND NEVER INFERRED FROM A TAP. The
  // browser owns dragging; this watches what it produced and opens the bar when
  // it settles. On iOS that is the only thing that works — a long-press
  // selection emits no click — and it is what lets a tap on a word stay a tap on
  // a word.
  const selectionRef = useRef<ReaderSelectionObserver | null>(null);

  useEffect(() => {
    const observer = observeReaderSelection(
      () => contentRef.current,
      (selected) => {
        setBar((previous) => {
          if (selected && isUsableSelection(selected)) {
            return { mode: "selection", selection: selected };
          }
          // A selection going away closes the bar IT opened, and nothing else:
          // a tap collapses the selection, and that must not wipe the sentence
          // actions that same tap just asked for.
          return previous?.mode === "selection" ? null : previous;
        });
      },
    );
    selectionRef.current = observer;
    return () => {
      selectionRef.current = null;
      observer.stop();
    };
  }, []);

  const onContentClick = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      const root = contentRef.current;
      const hit = readerHitAt(root, event);
      const selection = readReaderSelection(root);

      const intent = resolveReaderIntent({
        word: hit.word ? readerWordHit(hit.word) : null,
        sentenceId: hit.sentenceId,
        selection,
        // THE STALE-SELECTION GUARD. A selection outranks this tap only while it
        // is still unshown AND the tap happened inside it. Safari's leftovers
        // fail both; a drag ending on a word passes both.
        selectionIsUncommitted: selectionRef.current?.isUncommitted() ?? false,
        pointerInsideSelection: pointerInsideRect(selection?.rect, event),
      });

      if (intent.kind === "selection") {
        // A drag that ended, not a tap. The observer already owns the bar for
        // it — and the selection is left exactly as the learner made it.
        return;
      }

      if (intent.kind === "word") {
        // RULE 1, AND IT IS ABSOLUTE. A tap on a word opens the word sheet.
        setBar(null);
        openGloss(intent.word);
        return;
      }

      if (intent.kind === "sentence" && hit.sentence) {
        // Tapping the SENTENCE — the space between the words, the punctuation —
        // offers what can be done with a whole sentence (§9, §97). Deliberately
        // the fallback: it never takes a word tap over.
        setBar({
          mode: "sentence",
          sentenceId: intent.sentenceId,
          sentenceText: hit.sentence.textContent ?? "",
          rect: hit.sentence.getBoundingClientRect(),
        });
        return;
      }

      setBar(null);
    },
    [openGloss],
  );

  // ── what the action bar offers ────────────────────────────────────────────
  // DECIDED IN `readerBarPlan`, RENDERED HERE. Which offers belong to which
  // subject is a rule, not a rendering detail, so it lives in a pure function
  // with the hierarchy it belongs to — and is unit tested there.
  const plan = bar ? readerBarPlan(bar) : null;

  const closeActionBar = useCallback(() => {
    setBar(null);
    clearSelection();
  }, []);

  const actions: ReaderAction[] = [];
  if (plan && !plan.note) {
    if (plan.span) {
      const { span, kind } = plan.span;
      const existing =
        marks?.entries.find(
          (entry) =>
            entry.sentence_id === plan.sentenceId &&
            entry.start_position === span.startPosition &&
            entry.end_position === span.endPosition,
        ) ?? null;

      actions.push({
        id: "annotate",
        // §43: one word goes to the word interaction's own vocabulary, not to a
        // one-word "phrase".
        label: kind === "phrase" ? "Zapisz zwrot" : "Zapisz znaczenie",
        icon: <Plus className="size-3.5" />,
        onSelect: () => {
          setAnnotation({
            sentenceId: plan.sentenceId,
            sentenceText: plan.sentenceText,
            startPosition: span.startPosition,
            endPosition: span.endPosition,
            surface: span.surface,
            kind,
            existing,
          });
          closeActionBar();
        },
      });
    }

    actions.push({
      id: "translate",
      label: "Przetłumacz",
      icon: <NotebookPen className="size-3.5" />,
      onSelect: () => {
        setNoteTarget({
          sentenceId: plan.sentenceId,
          sentenceText: plan.sentenceText,
        });
        closeActionBar();
      },
    });

    if (plan.offersUnclear) {
      actions.push({
        id: "unclear",
        label: "Nie rozumiem",
        icon: <HelpCircle className="size-3.5" />,
        onSelect: () => {
          setNoteTarget({
            sentenceId: plan.sentenceId,
            sentenceText: plan.sentenceText,
          });
          closeActionBar();
        },
      });
    }
  }

  // ── marking what has been written down ────────────────────────────────────
  // SUBTLE, AND ONLY WHERE THERE IS SOMETHING TO MARK (§45, §48). Three data
  // attributes, applied to elements the server already rendered, styled in
  // `globals.css` as a faint change of ink — not a highlighter. Done in one pass
  // over the marks rather than per word, so a chapter with four hundred notes
  // costs four hundred attribute writes and not four hundred thousand.
  useEffect(() => {
    const root = contentRef.current;
    if (!root || !marks) return;

    const touched: HTMLElement[] = [];

    for (const sentenceId of marks.translatedSentences) {
      const element = root.querySelector<HTMLElement>(
        `.reader-sentence[data-sentence-id="${sentenceId}"]`,
      );
      if (element) {
        element.dataset.noteTranslated = "true";
        touched.push(element);
      }
    }
    for (const sentenceId of marks.unclearSentences) {
      const element = root.querySelector<HTMLElement>(
        `.reader-sentence[data-sentence-id="${sentenceId}"]`,
      );
      if (element) {
        element.dataset.noteUnclear = "true";
        touched.push(element);
      }
    }
    for (const [sentenceId, spans] of marks.spans) {
      const words = root.querySelectorAll<HTMLElement>(
        `.reader-word[data-sentence-id="${sentenceId}"]`,
      );
      for (const word of words) {
        const position = Number(word.dataset.position);
        if (spans.some(([from, to]) => position >= from && position <= to)) {
          word.dataset.noted = "true";
          touched.push(word);
        }
      }
    }

    return () => {
      for (const element of touched) {
        delete element.dataset.noteTranslated;
        delete element.dataset.noteUnclear;
        delete element.dataset.noted;
      }
    };
  }, [marks]);

  const onContentKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      const word = (event.target as HTMLElement).closest<HTMLElement>(".reader-word");
      if (!word) return;
      event.preventDefault();
      openGloss(readerWordHit(word));
    },
    [openGloss],
  );

  // ── preferences ───────────────────────────────────────────────────────────
  const changePreferences = useCallback((patch: Partial<ReaderPreferences>) => {
    setPreferences((prev) => ({ ...prev, ...patch }));
    // Optimistic: typography must change under the learner's finger. A failed
    // save costs them re-picking a font size, not their place in the book.
    void updateReaderPreferences(patch);
  }, []);

  // ── completion ────────────────────────────────────────────────────────────
  const onComplete = useCallback(async () => {
    const sessionId = sessionRef.current;
    if (!sessionId || completing) return;
    setCompleting(true);
    await flush(true);
    const result = await completeChapter(sessionId);
    setCompleting(false);
    if (result.ok) {
      setSummary(result);
      // MEASURED, NEVER ASSERTED: `mark_chapter_reading_completed` refuses
      // unless `reading_progress` already says the chapter is finished, so this
      // records the transition rather than claiming it.
      void markChapterReading(chapter.id, "completed");
      // The plan reconciles itself from `reading_progress`; refreshing is how
      // Today learns this chapter is done without anything asserting it.
      router.refresh();
    }
  }, [chapter.id, completing, flush, router]);

  const percent = Math.round(ratio * 100);
  const canComplete = ratio >= CHAPTER_COMPLETION_RATIO;

  return (
    <div
      className="reader-surface min-h-svh"
      data-reader-theme={preferences.theme}
      style={readerStyleVars(preferences)}
    >
      <header
        className={cn(
          "sticky top-0 z-30 border-b backdrop-blur transition-transform duration-200",
          chromeHidden && "-translate-y-full",
        )}
        style={{
          borderColor: "var(--reader-rule)",
          backgroundColor: "color-mix(in srgb, var(--reader-bg) 92%, transparent)",
        }}
      >
        <div className="mx-auto flex max-w-3xl items-center gap-2 px-4 py-2">
          <Link
            href={`/library/${chapter.itemSlug}`}
            aria-label="Powrót do książki"
            className="flex size-11 shrink-0 items-center justify-center rounded-lg transition-opacity hover:opacity-70"
            style={{ color: "var(--reader-muted)" }}
          >
            <ArrowLeft className="size-5" />
          </Link>

          <div className="min-w-0 flex-1">
            <p
              className="truncate text-xs"
              style={{ color: "var(--reader-muted)" }}
            >
              {chapter.itemTitle}
            </p>
            <p className="truncate text-sm font-medium">
              {chapter.title ?? `Rozdział ${chapter.position}`}
            </p>
          </div>

          <span
            className="shrink-0 text-xs tabular-nums"
            style={{ color: "var(--reader-muted)" }}
          >
            {percent}%
          </span>

          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            aria-label="Ustawienia czytania"
            className="flex size-11 shrink-0 items-center justify-center rounded-lg transition-opacity hover:opacity-70"
            style={{ color: "var(--reader-muted)" }}
          >
            <Settings2 className="size-5" />
          </button>
        </div>

        <div
          className="h-0.5 w-full"
          style={{ backgroundColor: "var(--reader-rule)" }}
        >
          <div
            className="h-full transition-[width] duration-300"
            style={{
              width: `${percent}%`,
              backgroundColor: "var(--reader-accent)",
            }}
          />
        </div>
      </header>

      <main className="px-5 pb-24 pt-8">
        <div
          ref={contentRef}
          onClick={onContentClick}
          onKeyDown={onContentKeyDown}
          role="presentation"
        >
          {children}
        </div>

        <div className="mx-auto mt-12 max-w-[38rem] space-y-4">
          {/* What this chapter produced. Derived from the marks already loaded,
              so it costs nothing and cannot disagree with the notebook. */}
          <ChapterNotebookSummary
            summary={marks ? summarizeNotebook(marks.entries) : EMPTY_SUMMARY}
            libraryItemId={chapter.itemId}
          />

          {summary ? (
            <ChapterCompleteCard
              summary={summary}
              nextHref={
                chapter.nextPosition
                  ? `/library/${chapter.itemSlug}/${chapter.nextPosition}`
                  : `/library/${chapter.itemSlug}`
              }
              nextLabel={chapter.nextPosition ? "Następny rozdział" : "Wróć do książki"}
              testHref={
                chapter.legacyTextId ? `/learn/${chapter.legacyTextId}/test` : null
              }
              challengeHref={
                chapter.hasChallenge
                  ? `/library/${chapter.itemSlug}/${chapter.position}/wyzwanie`
                  : null
              }
              chapterId={chapter.id}
            />
          ) : (
            <CompletionPrompt
              canComplete={canComplete}
              completing={completing}
              onComplete={onComplete}
            />
          )}

          <nav className="flex items-center justify-between gap-3 pt-2 text-sm">
            {chapter.previousPosition ? (
              <Link
                href={`/library/${chapter.itemSlug}/${chapter.previousPosition}`}
                className="flex items-center gap-1 hover:opacity-70"
                style={{ color: "var(--reader-muted)" }}
                prefetch
              >
                <ChevronLeft className="size-4" /> Poprzedni
              </Link>
            ) : (
              <span />
            )}
            {chapter.nextPosition ? (
              <Link
                href={`/library/${chapter.itemSlug}/${chapter.nextPosition}`}
                className="flex items-center gap-1 hover:opacity-70"
                style={{ color: "var(--reader-muted)" }}
                // The NEXT chapter's route, not the whole book: prefetching a
                // library would be exactly the thing this phase exists to stop.
                prefetch
              >
                Następny <ChevronRight className="size-4" />
              </Link>
            ) : (
              <span />
            )}
          </nav>
        </div>
      </main>

      <ReaderActionBar
        rect={bar === null ? null : bar.mode === "selection" ? bar.selection.rect : bar.rect}
        actions={actions}
        note={plan?.note ?? null}
        onDismiss={closeActionBar}
      />

      <WordGlossSheet
        target={gloss}
        readingSessionId={sessionId}
        onClose={() => setGloss(null)}
        // Both editors are opened from here, and both are the SAME component the
        // selection bar opens. The word sheet closes first so the two sheets
        // never stack — on a phone that is a dialog inside a dialog, and the
        // learner cannot tell which one Escape will close.
        onAddMeaning={(target) => {
          if (target.sentenceId === null || target.tokenPosition === null) return;
          setGloss(null);
          setAnnotation({
            sentenceId: target.sentenceId,
            sentenceText: target.sentence,
            startPosition: target.tokenPosition,
            endPosition: target.tokenPosition,
            surface: target.surface,
            kind: "word",
            existing:
              marks?.entries.find(
                (entry) =>
                  entry.sentence_id === target.sentenceId &&
                  entry.entry_type === "word" &&
                  entry.start_position === target.tokenPosition,
              ) ?? null,
          });
        }}
        onTranslateSentence={(sentenceId, sentenceText) => {
          setGloss(null);
          setNoteTarget({ sentenceId, sentenceText });
        }}
      />

      <AnnotationSheet target={annotation} onClose={() => setAnnotation(null)} />

      <SentenceNoteSheet
        open={noteTarget !== null}
        sentenceId={noteTarget?.sentenceId ?? null}
        sentenceText={noteTarget?.sentenceText ?? ""}
        readingSessionId={sessionId}
        onClose={() => setNoteTarget(null)}
      />

      <ReaderSettingsSheet
        open={settingsOpen}
        preferences={preferences}
        onChange={changePreferences}
        onClose={() => setSettingsOpen(false)}
      />
    </div>
  );
}

/**
 * Finishing is an ACT, never a side effect of the last paragraph rendering.
 *
 * A sticky footer, a short final line or a layout shift can all put the end of a
 * chapter on screen without anyone having read it, so the button appears only
 * once the learner's furthest position genuinely reached the end — and the
 * database refuses below the same threshold regardless of what the button does.
 */
function CompletionPrompt({
  canComplete,
  completing,
  onComplete,
}: {
  canComplete: boolean;
  completing: boolean;
  onComplete: () => void;
}) {
  if (!canComplete) {
    return (
      <p className="text-center text-sm" style={{ color: "var(--reader-muted)" }}>
        Czytaj dalej — postęp zapisuje się sam.
      </p>
    );
  }

  return (
    <button
      type="button"
      onClick={onComplete}
      disabled={completing}
      className="w-full rounded-xl px-4 py-3 text-base font-semibold transition-opacity hover:opacity-90 disabled:opacity-60"
      style={{
        backgroundColor: "var(--reader-accent)",
        color: "var(--reader-bg)",
      }}
    >
      {completing ? "Zapisujemy…" : "Zakończ rozdział"}
    </button>
  );
}
