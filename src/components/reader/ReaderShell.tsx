"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ChevronLeft, ChevronRight, Settings2 } from "lucide-react";
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
import { ChapterCompleteCard } from "@/components/reader/ChapterCompleteCard";
import { ReaderSettingsSheet } from "@/components/reader/ReaderSettingsSheet";
import {
  WordGlossSheet,
  type GlossTarget,
} from "@/components/reader/WordGlossSheet";
import { useActiveReadingClock } from "@/hooks/useActiveReadingClock";
import { useVisibleParagraph } from "@/hooks/useVisibleParagraph";
import { newInteractionId } from "@/lib/interaction-id";
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

  const sessionRef = useRef<string | null>(null);
  const flushedParagraphRef = useRef(-1);
  const lastFlushRef = useRef(0);

  const clock = useActiveReadingClock();
  const visibleParagraph = useVisibleParagraph(contentRef, chapter.paragraphCount);

  // ── the session ───────────────────────────────────────────────────────────
  // Opening the chapter is also the authorisation check and the resume lookup:
  // one call, so the reader never has to decide either question for itself.
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const result = await startReadingSession(chapter.id);
      if (cancelled || !result.ok) return;

      sessionRef.current = result.sessionId;
      setRatio(result.progressRatio);
      flushedParagraphRef.current = result.furthestParagraph;

      // The LEARNING lifecycle, which is a different fact from the reading
      // progress above: `reading_progress` says where they are, this says the
      // chapter has been entered. Best-effort — a failed transition costs a
      // marker on the book page, never the reading session.
      void markChapterReading(chapter.id, "started");

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
    (element: HTMLElement) => {
      const occurrenceId = Number(element.dataset.occurrenceId);
      if (!Number.isFinite(occurrenceId)) return;

      const wordId = element.dataset.wordId
        ? Number(element.dataset.wordId)
        : null;
      const sentenceId = element.dataset.sentenceId
        ? Number(element.dataset.sentenceId)
        : null;

      // The sentence comes from the DOM rather than from props: it is already on
      // the page, and shipping every sentence twice would double the payload of
      // a chapter for a string that is only ever needed one at a time.
      const sentence =
        (sentenceId
          ? contentRef.current?.querySelector<HTMLElement>(
              `.reader-sentence[data-sentence-id="${sentenceId}"]`,
            )?.textContent
          : null) ?? "";

      setGloss({
        occurrenceId,
        wordId,
        sentenceId,
        lemma: element.dataset.lemma ?? element.textContent ?? "",
        surface: element.textContent ?? "",
        sentence: sentence.trim(),
      });

      // A LOOKUP IS NOT A FAILED TEST — the weight of this evidence is decided
      // in `readingLookupEvidence`, not here. Fire and forget: recording it must
      // never delay showing the translation, and the interaction id makes a
      // retry settle the same lookup rather than count the word unknown twice.
      if (wordId) {
        void recordWordLookup({
          interactionId: newInteractionId(),
          chapterId: chapter.id,
          libraryItemId: chapter.itemId,
          wordId,
          sentenceId,
          occurrenceId,
          readingSessionId: sessionRef.current,
        });
      }
    },
    [chapter.id, chapter.itemId],
  );

  const onContentClick = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      // Never hijack a selection: the learner may be copying a phrase, and
      // phrase lookup is a feature this reader must not have blocked.
      if (window.getSelection()?.toString()) return;
      const word = (event.target as HTMLElement).closest<HTMLElement>(".reader-word");
      if (word) openGloss(word);
    },
    [openGloss],
  );

  const onContentKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      const word = (event.target as HTMLElement).closest<HTMLElement>(".reader-word");
      if (!word) return;
      event.preventDefault();
      openGloss(word);
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

      <WordGlossSheet target={gloss} onClose={() => setGloss(null)} />
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
