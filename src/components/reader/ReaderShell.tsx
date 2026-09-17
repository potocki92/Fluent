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
  type PointerEvent,
} from "react";

import {
  completeChapter,
  endReadingSession,
  recordWordLookup,
  reportReadingProgress,
  startReadingSession,
  syncChapterDictionary,
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
  isDragGesture,
  isUsableSelection,
  readerBarPlan,
  resolveReaderIntent,
  type GlossTarget,
  type PointerTrack,
  type ReaderWordHit,
} from "@/components/reader/reader-interaction";
import {
  clearSelection,
  observeReaderSelection,
  readerHitAt,
  readerWordHit,
  type ReaderSelection,
} from "@/components/reader/sentence-selection";
import { ReaderSettingsSheet } from "@/components/reader/ReaderSettingsSheet";
import { WordGlossSheet } from "@/components/reader/WordGlossSheet";
import { useActiveReadingClock } from "@/hooks/useActiveReadingClock";
import { useReaderWord } from "@/hooks/useReaderWord";
import { useChapterNotebook } from "@/hooks/useChapterNotebook";
import { useVisibleParagraph } from "@/hooks/useVisibleParagraph";
import { newInteractionId } from "@/lib/interaction-id";
import { EMPTY_SUMMARY, summarizeNotebook } from "@/lib/notebook/summary";
import {
  CHAPTER_COMPLETION_RATIO,
  CLICK_PAIRING_MS,
  DICTIONARY_SYNC_MAX_CALLS,
  PROGRESS_FLUSH_MS,
  PROGRESS_FLUSH_PARAGRAPHS,
  TAP_SLOP_PX,
  WORD_TAP_SNAP_PX,
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
  /**
   * The stored rows are behind the current dictionary, and the page was rendered
   * from the dictionary rather than from them.
   *
   * Nothing on screen waits for this: the words are already resolved. It only
   * asks the reader to have the same conclusion WRITTEN DOWN, so the views built
   * on the stored rows — coverage, preparation, the question bank — agree with
   * what the learner can see.
   */
  needsDictionarySync: boolean;
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
  // THE TAP, NOT JUST THE WORD. The interaction id is minted when the sheet
  // opens and travels with it, because the lookup can only be recorded once the
  // dictionary has answered — which is later, and possibly after a refetch. One
  // id per tap is what makes "record it when we know what it is" and "never
  // count one tap twice" the same statement.
  const [gloss, setGloss] = useState<{
    target: GlossTarget;
    interactionId: string;
  } | null>(null);
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

  // ── the dictionary, written down ──────────────────────────────────────────
  // THIS IS NOT WHAT MAKES THE WORDS WORK. The page was rendered against the
  // current dictionary, so every word on it is already tappable and already
  // glossed — that happens on the server, in `getReaderChapter`, and it is why
  // adding a word to the dictionary needs no refresh, no reprocessing and no
  // button.
  //
  // What this does is persist the same conclusion, so the things that read the
  // STORED rows rather than the page agree with it: vocabulary coverage, chapter
  // preparation, the question bank. Without it the reader would say *zog =
  // ziehen* while preparation insisted the chapter has no *ziehen* in it.
  //
  // Fire and forget, batched, idempotent, and deliberately silent: nothing on
  // screen changes when it finishes, so there is nothing to wait for and nothing
  // to refresh.
  useEffect(() => {
    if (!chapter.needsDictionarySync) return;
    let cancelled = false;

    void (async () => {
      let cursor = 0;
      for (let call = 0; call < DICTIONARY_SYNC_MAX_CALLS; call += 1) {
        const result = await syncChapterDictionary({
          chapterId: chapter.id,
          afterPosition: cursor,
        });
        // A failure is not worth telling the learner about: the chapter they are
        // reading is correct either way, and the next open tries again.
        if (cancelled || !result.ok || result.done) return;
        cursor = result.cursor;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [chapter.id, chapter.needsDictionarySync]);

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
  // THE TAPPED WORD IS HIGHLIGHTED WHILE ITS SHEET IS OPEN, and only while.
  // On a phone there is no resting underline any more (§45 as rewritten: a book
  // is not a page of hyperlinks), so this is the only feedback that says "yes,
  // THAT word" — and a mark left behind after the sheet closes would become a
  // fourth permanent state in the prose, which is exactly what this work removed.
  const activeWordRef = useRef<HTMLElement | null>(null);

  const setActiveWord = useCallback((element: HTMLElement | null) => {
    if (activeWordRef.current && activeWordRef.current !== element) {
      delete activeWordRef.current.dataset.active;
    }
    activeWordRef.current = element;
    if (element) element.dataset.active = "true";
  }, []);

  const closeGloss = useCallback(() => {
    setGloss(null);
    setActiveWord(null);
  }, [setActiveWord]);

  const openGloss = useCallback(
    (word: ReaderWordHit, element: HTMLElement | null) => {
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
      // The lookup is NOT recorded here any more. Which dictionary entry this
      // word is may not be known yet — the occurrence can have been stored
      // before the entry existed — so it is recorded once the dictionary has
      // answered, against the id it actually gave. See the effect below.
      setGloss({ target, interactionId: newInteractionId() });
      setActiveWord(element);
    },
    [setActiveWord],
  );

  // ── what the dictionary says about the tapped word, TODAY ─────────────────
  // Resolved here rather than inside the sheet because three things need the same
  // answer and must not disagree: what the sheet shows, what "Dodaj do powtórek"
  // saves, and what the lookup is recorded against.
  const glossTarget = gloss?.target ?? null;
  const dictionary = useReaderWord(glossTarget);

  // A LOOKUP IS NOT A FAILED TEST — the weight of this evidence is decided in
  // `readingLookupEvidence`, not here. What changed is WHEN it can be recorded:
  // an occurrence stored with no `word_id` may still be a word Fluent knows now,
  // and a lookup recorded against nothing would lose exactly the evidence the
  // learner just generated. So it waits for the answer, and fires against the id
  // that came back.
  //
  // ONE TAP, ONE LOOKUP. The id is minted when the sheet opens, and the ref
  // remembers which tap has already been recorded, so a refetch, a re-render or
  // React re-running the effect cannot produce a second one — and even if a
  // retry does reach the server, `apply_reading_lookup` settles the same
  // interaction id rather than counting the word unknown twice.
  const recordedLookupRef = useRef<string | null>(null);
  useEffect(() => {
    if (!gloss || dictionary.wordId === null) return;
    if (recordedLookupRef.current === gloss.interactionId) return;
    recordedLookupRef.current = gloss.interactionId;

    void recordWordLookup({
      interactionId: gloss.interactionId,
      chapterId: chapter.id,
      libraryItemId: chapter.itemId,
      wordId: dictionary.wordId,
      sentenceId: gloss.target.sentenceId,
      occurrenceId: gloss.target.occurrenceId,
      readingSessionId: sessionRef.current,
    });
  }, [chapter.id, chapter.itemId, dictionary.wordId, gloss]);

  // ── the native selection, observed rather than discovered ─────────────────
  // A SELECTION IS NEVER HIJACKED (§30) AND NEVER INFERRED FROM A TAP. The
  // browser owns dragging; this watches what it produced and opens the bar when
  // it settles. On iOS that is the only thing that works — a long-press
  // selection emits no click — and it is what lets a tap on a word stay a tap on
  // a word.
  // A ref rather than a dependency: the observer subscribes once for the life of
  // the chapter and must not be torn down and rebuilt every time a sheet opens.
  const glossOpenRef = useRef(false);
  useEffect(() => {
    glossOpenRef.current = gloss !== null;
  }, [gloss]);

  useEffect(() => {
    const observer = observeReaderSelection(
      () => contentRef.current,
      (selected) => {
        // A bar behind an open word sheet is a control nobody can reach and an
        // offer nobody asked for — and on a phone the sheet is modal anyway.
        if (glossOpenRef.current) return;

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
    return () => observer.stop();
  }, []);

  // ── the tap channel ───────────────────────────────────────────────────────
  // IT DOES NOT LOOK AT THE SELECTION. That is the whole fix, and the reason
  // this is the third attempt: every previous version tried to teach the tap
  // which selections to ignore, and on iOS there is no test that separates "a
  // drag that just ended here" from "a range Safari is still holding" reliably
  // enough to bet a word tap on it. What IS reliable is how far the pointer
  // moved — so that is what is tracked, and nothing else.
  const trackRef = useRef<PointerTrack | null>(null);

  const onContentPointerDown = useCallback((event: PointerEvent<HTMLDivElement>) => {
    trackRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      endX: null,
      endY: null,
      endedAt: null,
      pointerType: event.pointerType,
    };
  }, []);

  const onContentPointerUp = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const track = trackRef.current;
    if (!track) return;
    track.endX = event.clientX;
    track.endY = event.clientY;
    track.endedAt = Date.now();
  }, []);

  const onContentClick = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      const track = trackRef.current;
      // Consumed here: a gesture answers exactly one click, so a pointerdown
      // whose click never came (a scroll, a drag out of the prose) can never be
      // paired with a later one that arrived without a pointerdown of its own.
      trackRef.current = null;

      const hit = readerHitAt(
        contentRef.current,
        event,
        // A finger gets the snap; a mouse is precise and keeps the gap between
        // two words as a place it can deliberately click.
        isCoarse(track) ? WORD_TAP_SNAP_PX : 0,
      );

      const intent = resolveReaderIntent({
        word: hit.word ? readerWordHit(hit.word) : null,
        sentenceId: hit.sentenceId,
        isDrag: isDragGesture(track, Date.now(), TAP_SLOP_PX, CLICK_PAIRING_MS),
      });

      if (intent.kind === "ignore") {
        // The trailing click of a drag. The selection channel already owns this
        // gesture — and the selection is left exactly as the learner made it.
        return;
      }

      if (intent.kind === "word") {
        // RULE 2, AND IT IS ABSOLUTE. A tap on a word opens the word sheet.
        setBar(null);
        openGloss(intent.word, hit.word);
        return;
      }

      if (intent.kind === "sentence" && hit.sentence) {
        // Tapping the SENTENCE and nothing nearer — offers what can be done with
        // a whole sentence (§9, §97). Deliberately the fallback: it never takes
        // a word tap over.
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

  // TWO WAYS THE BAR GOES AWAY, AND THEY ARE NOT THE SAME EVENT. Choosing an
  // action finishes with the selection, so it is released. The bar merely being
  // dismissed — a scroll, a tap elsewhere — says nothing about the selection, and
  // a learner who selected a passage to copy it out of the book would lose it to
  // a toolbar tidying up after itself (§30).
  const finishAction = useCallback(() => {
    setBar(null);
    clearSelection();
  }, []);

  const dismissActionBar = useCallback(() => setBar(null), []);

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
          finishAction();
        },
      });
    }

    actions.push({
      id: "translate",
      // NOT "Przetłumacz". The bar can be about a word, a phrase or a sentence,
      // and the three are different notes in different tables (§3) — a label
      // that does not say which one it means is a label that gets the learner
      // the wrong note. This action is always about the sentence.
      label: "Przetłumacz zdanie",
      icon: <NotebookPen className="size-3.5" />,
      onSelect: () => {
        setNoteTarget({
          sentenceId: plan.sentenceId,
          sentenceText: plan.sentenceText,
        });
        finishAction();
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
          finishAction();
        },
      });
    }
  }

  // ── marking what has been written down ────────────────────────────────────
  // FOUR MARKS, AND EACH ONE SAYS A DIFFERENT THING (§45, §48). The rewrite of
  // this phase was about the language, not the mechanism:
  //
  //   a word you gave your own meaning   a thin accent underline
  //   a phrase you saved                 a faint band across the whole span
  //   a sentence you translated          a small ✓ after it
  //   a sentence you flagged             a small ? after it
  //
  // NO TWO OF THEM ARE A LINE UNDER A LINE. The old scheme underlined every
  // interactive word AND underlined a translated sentence, so a rule under
  // *sollten* could mean "tappable", "you wrote something here", or "you
  // translated this sentence" — three claims, one mark, on a phone where the
  // resting underline was on a quarter of the page. Underlining is now reserved
  // for one thing: a note on THESE tokens. Whole-sentence facts are markers at
  // the end of the sentence, where they cannot be confused with the words.
  //
  // Applied as data attributes to elements the server already rendered, in one
  // pass over the marks rather than per word, so a chapter with four hundred
  // notes costs four hundred attribute writes and not four hundred thousand.
  // Nothing here inserts a node into the prose: `.reader-sentence` textContent is
  // byte-for-byte `sentences.text`, which is what makes a DOM offset convertible
  // into the character offset a note is anchored on (§4). The ✓ is a
  // pseudo-element for exactly that reason.
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
        if (!Number.isFinite(position)) continue;

        const covering = spans.filter(
          (span) => position >= span.start && position <= span.end,
        );
        if (covering.length === 0) continue;

        // The two are independent facts and a token can carry both: *machen* in
        // a saved *Angst machen* may also have its own contextual meaning.
        if (covering.some((span) => span.kind === "word")) {
          word.dataset.noted = "true";
        }

        const phrase = covering.find((span) => span.kind === "phrase");
        if (phrase) {
          // Where the band is rounded off. Without this a phrase reads as a
          // string of separate highlights rather than one saved unit.
          const first = position === phrase.start;
          const last = position === phrase.end;
          word.dataset.phrase =
            first && last ? "only" : first ? "start" : last ? "end" : "inner";
        }

        touched.push(word);
      }
    }

    return () => {
      for (const element of touched) {
        delete element.dataset.noteTranslated;
        delete element.dataset.noteUnclear;
        delete element.dataset.noted;
        delete element.dataset.phrase;
      }
    };
  }, [marks]);

  const onContentKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      const word = (event.target as HTMLElement).closest<HTMLElement>(".reader-word");
      if (!word) return;
      event.preventDefault();
      openGloss(readerWordHit(word), word);
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
          onPointerDown={onContentPointerDown}
          onPointerUp={onContentPointerUp}
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
        onDismiss={dismissActionBar}
      />

      <WordGlossSheet
        target={glossTarget}
        // The sheet RENDERS the dictionary's answer; it does not go and get it.
        // One resolution per tap, shared by the sheet, the save and the lookup.
        dictionary={dictionary}
        readingSessionId={sessionId}
        onClose={closeGloss}
        // Both editors are opened from here, and both are the SAME component the
        // selection bar opens. The word sheet closes first so the two sheets
        // never stack — on a phone that is a dialog inside a dialog, and the
        // learner cannot tell which one Escape will close.
        onAddMeaning={(target) => {
          if (target.sentenceId === null || target.tokenPosition === null) return;
          closeGloss();
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
          closeGloss();
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
 * Was this gesture made with a finger?
 *
 * Asked of the gesture itself rather than of the device, because a tablet with a
 * keyboard and a laptop with a touchscreen are both, and the answer that matters
 * is which one is touching the text right now. Only when the gesture cannot say
 * — a click with no pointer behind it — does the device get asked, and then
 * `(pointer: coarse)` is exactly the question the reader's own CSS asks.
 */
function isCoarse(track: PointerTrack | null): boolean {
  if (track) return track.pointerType !== "mouse";
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(pointer: coarse)").matches
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
