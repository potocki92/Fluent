"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import {
  AlertTriangle,
  BookOpen,
  Check,
  Globe,
  Loader2,
  RefreshCw,
  Trash2,
} from "lucide-react";

import {
  analyzeBookImport,
  cancelBookImport,
  confirmBookImport,
  processImportBatch,
  updateImportMetadata,
} from "@/actions/book-import";
import { ChapterReview } from "@/components/library/import/ChapterReview";
import { ImportStepper, type ImportStep } from "@/components/library/import/ImportStepper";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { TARGET_LANGUAGE } from "@/lib/import/constants";
import type { BookImportDetail } from "@/lib/import/queries";
import {
  IMPORT_ERROR_HINTS,
  IMPORT_ERROR_MESSAGES,
  STAGE_LABELS,
} from "@/lib/import/state";
import { settleAction } from "@/lib/errors";

/**
 * One import, from "uploaded" to "ready".
 *
 * THE SERVER ROW IS THE TRUTH. Every screen below is a rendering of
 * `book_imports.status`; this component holds no state that would be lost on a
 * reload, which is what makes closing the tab mid-import harmless and the URL
 * worth bookmarking. React state here is for one thing only: not firing the same
 * server call twice.
 *
 * IT DRIVES THE WORK BECAUSE NOTHING ELSE CAN. Fluent has no job queue and no
 * cron, so while this screen is open it asks the server to do the next piece:
 * analyse the file, then process chapters a few at a time. That is stated
 * plainly in the UI ("możesz zamknąć tę stronę") rather than dressed up as a
 * background job, because the honest version is also the one that does not
 * confuse anybody when they come back to a half-processed book — the work simply
 * continues from where it stopped.
 */
export function ImportWorkbench({ detail }: { detail: BookImportDetail }) {
  const step = stepFor(detail);

  return (
    <div className="space-y-6">
      <ImportStepper current={step} />

      {(detail.status === "uploaded" ||
        detail.status === "extracting" ||
        detail.status === "analyzing") && <Analyzing detail={detail} />}

      {detail.status === "awaiting_review" && <Review detail={detail} />}

      {(detail.status === "importing" || detail.status === "processing") && (
        <Processing detail={detail} />
      )}

      {detail.status === "ready" && <Ready detail={detail} />}

      {detail.status === "failed" && <Failed detail={detail} />}

      {detail.status === "cancelled" && (
        <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted2">
          Ten import został anulowany.
        </p>
      )}
    </div>
  );
}

function stepFor(detail: BookImportDetail): ImportStep {
  if (detail.status === "awaiting_review") return "chapters";
  if (
    detail.status === "importing" ||
    detail.status === "processing" ||
    detail.status === "ready"
  ) {
    return "import";
  }
  return "file";
}

// ─────────────────────────────────────────────────────────────────────────────
// Analysing
// ─────────────────────────────────────────────────────────────────────────────

function Analyzing({ detail }: { detail: BookImportDetail }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    // Once per mount. Analysis replaces the whole proposal, so a second
    // concurrent run would be wasted work rather than corruption — but wasted
    // work on a 400-page PDF is a minute of someone's life.
    if (started.current) return;
    started.current = true;

    void analyzeBookImport(detail.id).then((result) => {
      if (!result.ok) setError(result.message);
      router.refresh();
    });
  }, [detail.id, router]);

  return (
    <div className="rounded-xl border border-border bg-card p-8 text-center">
      <Loader2 className="mx-auto mb-3 size-8 animate-spin text-gold" />
      <p className="font-medium text-main">Analizuję książkę…</p>
      <p className="mt-1 text-sm text-muted2">
        {detail.stage ? STAGE_LABELS[detail.stage] : STAGE_LABELS.extract_text}
      </p>
      <p className="mt-4 text-xs text-muted2">
        Przy dużym pliku może to potrwać chwilę. Nie zamykaj tej strony.
      </p>
      {error && (
        <p role="alert" className="mt-3 text-sm text-red">
          {error}
        </p>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Review
// ─────────────────────────────────────────────────────────────────────────────

function Review({ detail }: { detail: BookImportDetail }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [title, setTitle] = useState(detail.title ?? detail.detectedTitle ?? "");
  const [author, setAuthor] = useState(detail.author ?? detail.detectedAuthor ?? "");
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const included = detail.chapters.filter((chapter) => chapter.included);
  const includedWords = included.reduce((sum, chapter) => sum + chapter.wordCount, 0);
  const wrongLanguage = detail.language !== null && detail.language !== TARGET_LANGUAGE;

  const confirm = () => {
    // DOUBLE-CLICK SAFE TWICE OVER: the button disables itself, and
    // `finalize_book_import` is idempotent under a row lock, so even two tabs
    // produce one book.
    if (confirming) return;
    setConfirming(true);
    setError(null);

    startTransition(async () => {
      // Settled: a rejected action skipped every `setConfirming(false)` below
      // and left the button spinning on "Importuję…" for good.
      const saved = await settleAction(
        () => updateImportMetadata({ importId: detail.id, title, author }),
        `updateImportMetadata ${detail.id}`,
      );
      if (!saved.ok) {
        setError(saved.message);
        setConfirming(false);
        return;
      }

      const result = await settleAction(
        () => confirmBookImport(detail.id),
        `confirmBookImport ${detail.id}`,
      );
      if (!result.ok) {
        setError(result.message);
        setConfirming(false);
        return;
      }
      router.refresh();
    });
  };

  return (
    <div className="space-y-6">
      <section className="space-y-3 rounded-xl border border-border bg-card p-4">
        <div>
          <label className="text-xs font-medium text-muted2" htmlFor="import-title">
            Tytuł
          </label>
          <Input
            id="import-title"
            value={title}
            maxLength={200}
            placeholder="Tytuł książki"
            onChange={(event) => setTitle(event.target.value)}
          />
        </div>
        <div>
          <label className="text-xs font-medium text-muted2" htmlFor="import-author">
            Autor
          </label>
          <Input
            id="import-author"
            value={author}
            maxLength={200}
            placeholder="Autor (opcjonalnie)"
            onChange={(event) => setAuthor(event.target.value)}
          />
        </div>

        <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted2">
          <Stat label="Rozdziały" value={`${included.length}`} />
          <Stat label="Słowa" value={includedWords.toLocaleString("pl-PL")} />
          {detail.pageCount !== null && (
            <Stat label="Strony" value={`${detail.pageCount}`} />
          )}
          <Stat label="Język" value={languageLabel(detail.language)} />
        </dl>
      </section>

      {wrongLanguage && (
        <Notice tone="warning" icon={<Globe className="size-4" />}>
          Fluent jest obecnie przygotowany do nauki niemieckiego. Wykryty język:{" "}
          <strong>{languageLabel(detail.language)}</strong>. Możesz zaimportować tę
          książkę, ale słownik i ćwiczenia będą działać słabo.
        </Notice>
      )}

      {detail.quality?.looksGarbled && (
        <Notice tone="warning" icon={<AlertTriangle className="size-4" />}>
          Tekst z tego pliku może wymagać korekty. Sprawdź podgląd poniżej — jeśli
          wygląda źle, wersja EPUB zwykle daje dużo lepszą jakość.
        </Notice>
      )}

      {/* THE SAMPLE IS THE REAL QUALITY CHECK. Two sentences of their own book
          tell a learner more about whether extraction worked than any ratio. */}
      {detail.quality && detail.quality.samples.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted2">
            Podgląd tekstu
          </h2>
          {detail.quality.samples.map((sample) => (
            <p
              key={sample.slice(0, 40)}
              className="rounded-xl border border-border bg-card p-3 text-sm leading-relaxed text-muted2"
            >
              {sample}
            </p>
          ))}
        </section>
      )}

      <ChapterReview
        importId={detail.id}
        chapters={detail.chapters}
        disabled={pending}
      />

      <p className="text-xs text-muted2">
        Importujesz treść wyłącznie do prywatnego użytku w swoim koncie. Nikt inny
        nie zobaczy tej książki.
      </p>

      {error && (
        <p role="alert" className="text-sm text-red">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <Button
          className="flex-1"
          disabled={pending || confirming || included.length === 0}
          onClick={confirm}
        >
          {confirming ? (
            <>
              <Loader2 className="size-4 animate-spin" /> Importuję…
            </>
          ) : (
            <>
              <Check className="size-4" /> Importuj książkę
            </>
          )}
        </Button>
        <CancelButton importId={detail.id} disabled={pending || confirming} />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Processing
// ─────────────────────────────────────────────────────────────────────────────

function Processing({ detail }: { detail: BookImportDetail }) {
  const router = useRouter();
  const [progress, setProgress] = useState({
    total: detail.totalChapters,
    ready: detail.processedChapters,
    failed: detail.failedChapters,
  });
  const [stalled, setStalled] = useState<string | null>(null);
  const running = useRef(false);
  // Cleared when this screen goes away, so a batch still in flight stops
  // driving a loop — and stops writing state — for a page nobody is on.
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const pump = useCallback(
    async (retryFailed: boolean) => {
      if (running.current) return;
      running.current = true;
      setStalled(null);

      try {
        // One batch per turn of the loop, because a serverless function cannot
        // hold a 42-chapter book. The loop is the caller's; the batch size and
        // the ordering are the server's.
        for (;;) {
          // Settled: an unwrapped rejection used to escape this loop entirely.
          // The `finally` below still ran, so the spinner kept spinning at
          // whatever percentage it had reached, `stalled` was never set, and
          // the "Spróbuj ponownie" button below never appeared — an import
          // that looked like it was working and was not.
          const result = await settleAction(
            () => processImportBatch({ importId: detail.id, retryFailed }),
            `processImportBatch ${detail.id}`,
          );
          // The learner navigated away mid-batch. The work already committed
          // is durable and the next visit resumes from it; carrying on here
          // would only write state into a tree that is gone.
          if (!alive.current) return;

          if (!result.ok) {
            setStalled(result.message);
            break;
          }

          setProgress({
            total: result.total,
            ready: result.ready,
            failed: result.failed,
          });
          if (result.done) break;
          // Only the first pass may retry failures; after that a chapter that
          // keeps failing would spin forever.
          retryFailed = false;
        }
      } finally {
        running.current = false;
        if (alive.current) router.refresh();
      }
    },
    [detail.id, router],
  );

  useEffect(() => {
    void pump(false);
  }, [pump]);

  const percent =
    progress.total === 0
      ? 0
      : Math.round(((progress.ready + progress.failed) / progress.total) * 100);
  const readable = progress.ready > 0;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-card p-6 text-center">
        <Loader2 className="mx-auto mb-3 size-8 animate-spin text-gold" />
        <p className="font-medium text-main">Twoja książka jest przygotowywana</p>
        <p className="mt-1 text-sm text-muted2">
          {progress.ready} z {progress.total} rozdziałów gotowych
        </p>

        <div className="mx-auto mt-4 max-w-sm">
          <Progress value={percent} />
        </div>

        {progress.failed > 0 && (
          <p className="mt-3 text-xs text-red">
            {progress.failed}{" "}
            {progress.failed === 1 ? "rozdział" : "rozdziały"} nie zostały
            przetworzone.
          </p>
        )}

        <p className="mt-4 text-xs text-muted2">
          Możesz zamknąć tę stronę — przetwarzanie ruszy dalej, gdy tu wrócisz.
        </p>
      </div>

      {/* PARTIAL READINESS IS THE POINT: chapter 1 is readable long before
          chapter 42 is built, and making the learner wait would be a choice
          nobody benefits from. */}
      {readable && detail.finalSlug && (
        <Button asChild className="w-full">
          <Link href={`/library/${detail.finalSlug}`}>
            <BookOpen className="size-4" /> Zacznij od rozdziału 1
          </Link>
        </Button>
      )}

      {stalled && (
        <p className="text-center text-sm text-red" role="alert">
          {stalled}
        </p>
      )}

      {(stalled !== null || progress.failed > 0) && (
        <Button variant="outline" className="w-full" onClick={() => void pump(true)}>
          <RefreshCw className="size-4" /> Spróbuj ponownie
        </Button>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Ready and failed
// ─────────────────────────────────────────────────────────────────────────────

function Ready({ detail }: { detail: BookImportDetail }) {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-green/40 bg-card p-6 text-center">
        <Check className="mx-auto mb-3 size-8 text-green" />
        <p className="font-medium text-main">Książka gotowa</p>
        <p className="mt-1 text-sm text-muted2">
          {detail.totalChapters}{" "}
          {detail.totalChapters === 1 ? "rozdział" : "rozdziałów"} ·{" "}
          {detail.wordCount.toLocaleString("pl-PL")} słów
        </p>
        {detail.failedChapters > 0 && (
          <p className="mt-2 text-xs text-red">
            {detail.failedChapters} nie udało się przetworzyć — resztę możesz już
            czytać.
          </p>
        )}
      </div>

      {detail.finalSlug && (
        <Button asChild className="w-full">
          <Link href={`/library/${detail.finalSlug}`}>
            <BookOpen className="size-4" /> Otwórz książkę
          </Link>
        </Button>
      )}
    </div>
  );
}

function Failed({ detail }: { detail: BookImportDetail }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [retryError, setRetryError] = useState<string | null>(null);

  const code = detail.errorCode ?? "extract_failed";
  const hint = IMPORT_ERROR_HINTS[code];

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-red/40 bg-card p-6 text-center">
        <AlertTriangle className="mx-auto mb-3 size-8 text-red" />
        <p className="font-medium text-main">Nie udało się zaimportować</p>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted2">
          {IMPORT_ERROR_MESSAGES[code]}
        </p>
        {hint && <p className="mt-2 text-xs text-muted2">{hint}</p>}
        {retryError && (
          <p className="mt-2 text-xs text-red" role="alert">
            {retryError}
          </p>
        )}
      </div>

      <div className="flex gap-2">
        {/* Retrying is worth offering for a transient failure and harmless for
            a permanent one: the analysis is idempotent, so the second attempt
            either works or produces the same honest error. */}
        <Button
          variant="outline"
          className="flex-1"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await settleAction(
                () => analyzeBookImport(detail.id),
                `analyzeBookImport ${detail.id}`,
              );
              // A refused retry used to be indistinguishable from one that ran
              // and failed the same way again: both simply refreshed.
              if (!result.ok) setRetryError(result.message);
              router.refresh();
            })
          }
        >
          <RefreshCw className="size-4" /> Spróbuj ponownie
        </Button>
        <CancelButton importId={detail.id} disabled={pending} />
      </div>

      <Button asChild variant="ghost" className="w-full">
        <Link href="/library/import">Wybierz inny plik</Link>
      </Button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared
// ─────────────────────────────────────────────────────────────────────────────

function CancelButton({
  importId,
  disabled,
}: {
  importId: string;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [armed, setArmed] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  if (!armed) {
    return (
      <Button
        variant="ghost"
        disabled={disabled || pending}
        onClick={() => setArmed(true)}
      >
        <Trash2 className="size-4" /> Anuluj
      </Button>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      {failure && (
        <p className="text-xs text-red" role="alert">
          {failure}
        </p>
      )}
      <Button
        variant="destructive"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await settleAction(
              () => cancelBookImport(importId),
              `cancelBookImport ${importId}`,
            );
            // Navigating away regardless would tell the learner their file was
            // deleted when it is still sitting in the private bucket.
            if (!result.ok) {
              setFailure(result.message);
              return;
            }
            router.push("/library/import");
            router.refresh();
          })
        }
      >
        {pending ? <Loader2 className="size-4 animate-spin" /> : null}
        Na pewno usuń
      </Button>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-1">
      <dt>{label}:</dt>
      <dd className="font-medium text-main">{value}</dd>
    </div>
  );
}

function Notice({
  tone,
  icon,
  children,
}: {
  tone: "warning";
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <p
      className={
        tone === "warning"
          ? "flex gap-2 rounded-xl border border-gold/40 bg-gold/5 p-3 text-sm text-main"
          : ""
      }
    >
      <span className="mt-0.5 shrink-0 text-gold">{icon}</span>
      <span>{children}</span>
    </p>
  );
}

const LANGUAGE_NAMES: Record<string, string> = {
  de: "niemiecki",
  pl: "polski",
  en: "angielski",
};

function languageLabel(code: string | null): string {
  if (!code) return "nieznany";
  return LANGUAGE_NAMES[code] ?? code;
}
