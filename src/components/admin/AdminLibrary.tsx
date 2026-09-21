"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Eye,
  ImageIcon,
  Loader2,
  RefreshCw,
} from "lucide-react";

import {
  createChapter,
  createLibraryItem,
  processChapter,
  processPendingChapters,
  setLibraryItemStatus,
  type AdminChapterRow,
  type AdminLibraryItemRow,
} from "@/actions/admin-library";
import { MaterialCoverField } from "@/components/admin/MaterialCoverField";
import { MaterialCover } from "@/components/library/MaterialCover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useMaterialCover, type CoverTarget } from "@/hooks/useMaterialCover";
import { cn } from "@/lib/utils";

/**
 * The library content inspector.
 *
 * THE NUMBERS ARE THE POINT. `dictionary_match_rate` and the unmatched sample
 * turn "is this text any good for learners?" into something you can look at: a
 * chapter Fluent can gloss 92% of is usable, one at 40% would leave a reader
 * stranded, and the sample names the words the dictionary is missing so the gap
 * is a task rather than a mood.
 *
 * AND THE PICTURE IS PART OF THE MATERIAL. Every public item is edited here,
 * whether it began as a legacy passage or was authored straight into the library
 * with chapters and no `texts` row — the second kind previously had no screen
 * that could give it artwork at all. The control is the same
 * `MaterialCoverField` the text form uses, driven by the same
 * `useMaterialCover`, and it is COLLAPSED by default: a shelf of ten books must
 * stay a list you can scan, not ten upload forms stacked on a phone.
 */
export function AdminLibrary({ items }: { items: AdminLibraryItemRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  const unprocessed = items.reduce(
    (sum, item) =>
      sum + item.chapters.filter((chapter) => chapter.status !== "ready").length,
    0,
  );

  function run(action: () => Promise<string>) {
    startTransition(async () => {
      setMessage(await action());
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Biblioteka</h1>
          <p className="text-sm text-muted2">
            {items.length} pozycji ·{" "}
            {unprocessed === 0
              ? "wszystkie rozdziały przetworzone"
              : `${unprocessed} rozdziałów czeka na przetworzenie`}
          </p>
        </div>
        <Button
          type="button"
          disabled={pending || unprocessed === 0}
          onClick={() =>
            run(async () => {
              const result = await processPendingChapters();
              if (!result.ok) return result.message;
              return `Przetworzono ${result.processed} rozdziałów (${result.failed} błędów).`;
            })
          }
          className="bg-gold text-[#1a202c] hover:bg-gold-dark"
        >
          {pending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <RefreshCw className="size-4" />
          )}
          Przetwórz oczekujące
        </Button>
      </header>

      {message && (
        <p className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-muted2">
          {message}
        </p>
      )}

      <NewItemForm onDone={(text) => run(async () => text)} />

      <div className="space-y-4">
        {items.map((item) => (
          <ItemCard key={item.id} item={item} pending={pending} run={run} />
        ))}
      </div>
    </div>
  );
}

function ItemCard({
  item,
  pending,
  run,
}: {
  item: AdminLibraryItemRow;
  pending: boolean;
  run: (action: () => Promise<string>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [artworkOpen, setArtworkOpen] = useState(false);

  /**
   * The material's artwork, owned HERE rather than inside the panel.
   *
   * The thumbnail in the header and the field in the panel are two views of one
   * fact, and the header must not keep showing yesterday's picture for the rest
   * of the transition while the server data catches up. One hook, one truth, and
   * the panel can be collapsed without the card forgetting what happened.
   */
  const cover = useMaterialCover(item.coverUrl);
  const target: CoverTarget = { kind: "material", libraryItemId: item.id };

  async function pickCover(file: File | null) {
    cover.setStatus(null);
    cover.choose(file);
    if (!file) return;

    // Picking IS the action: the material already exists, so there is nothing
    // for the image to wait for and no „Zapisz" on this screen to wait for it.
    const saved = await cover.upload(target, file);
    if (!saved) {
      // The choice and its preview survive a failure, so „Zmień obraz" retries
      // rather than starting from an empty field.
      cover.setStatus("Nie udało się zapisać. Wybierz obraz jeszcze raz.");
      return;
    }

    cover.setCoverUrl(saved);
    cover.choose(null);
    cover.setStatus("Obraz zapisany.");
    run(async () => `„${item.title}" — obraz zapisany.`);
  }

  async function removeCover() {
    if (cover.file) {
      // A saved cover stays saved: clearing a pending choice is "nie ten obraz",
      // not "usuń ten, który jest".
      cover.choose(null);
      return;
    }
    if (!cover.coverUrl) return;
    if (!(await cover.remove(target))) return;

    cover.setCoverUrl(null);
    cover.setStatus("Obraz usunięty.");
    run(async () => `„${item.title}" — obraz usunięty.`);
  }

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-start gap-3">
        {/* The current picture, and the way into changing it. A thumbnail that
            does nothing would be the one place on this screen that looks
            clickable and is not. */}
        <button
          type="button"
          onClick={() => setArtworkOpen((prev) => !prev)}
          aria-expanded={artworkOpen}
          aria-label={
            cover.coverUrl ? `Zmień obraz — ${item.title}` : `Dodaj obraz — ${item.title}`
          }
          className="shrink-0 rounded-lg focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <MaterialCover
            coverUrl={cover.coverUrl}
            sizes="80px"
            className="aspect-[4/3] w-16 rounded-lg border border-border sm:w-20"
            fallback={
              <span className="flex size-full items-center justify-center bg-[#374151]">
                <ImageIcon className="size-5 text-muted2" />
              </span>
            }
          />
        </button>

        <div className="min-w-0 flex-1">
          <h2 className="font-semibold text-main">{item.title}</h2>
          <p className="mt-0.5 text-xs break-words text-muted2">
            {[
              item.slug,
              item.contentType,
              item.rights,
              item.legacyTextId ? `z tekstu #${item.legacyTextId}` : null,
              `${item.chapters.length} rozdz.`,
              item.wordCount > 0 ? `${item.wordCount.toLocaleString("pl-PL")} słów` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <StatusPill status={item.status} />
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={cover.busy}
              aria-expanded={artworkOpen}
              onClick={() => setArtworkOpen((prev) => !prev)}
            >
              {cover.uploading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <ImageIcon className="size-4" />
              )}
              {artworkOpen ? "Zamknij obraz" : cover.coverUrl ? "Zmień obraz" : "Dodaj obraz"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={pending}
              onClick={() =>
                run(async () => {
                  const next = item.status === "published" ? "draft" : "published";
                  const result = await setLibraryItemStatus({
                    itemId: item.id,
                    status: next,
                  });
                  return result.ok
                    ? `„${item.title}" — ${next === "published" ? "opublikowano" : "wycofano"}.`
                    : result.message;
                })
              }
            >
              {item.status === "published" ? "Wycofaj" : "Opublikuj"}
            </Button>
          </div>
        </div>
      </div>

      {/* Only the artwork controls are disabled while an image is in flight —
          processing a chapter or publishing the item is unrelated work and
          blocking the whole card would be theatre. */}
      {artworkOpen && (
        <div className="mt-3">
          <MaterialCoverField
            compact
            label={null}
            coverUrl={cover.coverUrl}
            localUrl={cover.preview}
            onSelect={pickCover}
            onRemove={removeCover}
            uploading={cover.uploading}
            percent={cover.percent}
            removing={cover.removing}
            hint={cover.status}
            error={cover.error}
          />
        </div>
      )}

      <ul className="mt-3 space-y-2">
        {item.chapters.map((chapter) => (
          <li key={chapter.id}>
            <ChapterRow
              chapter={chapter}
              slug={item.slug}
              pending={pending}
              run={run}
            />
          </li>
        ))}
      </ul>

      <div className="mt-3">
        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          className="text-xs text-muted2 underline underline-offset-2 hover:text-main"
        >
          {open ? "Anuluj" : "+ Dodaj rozdział"}
        </button>
        {open && (
          <NewChapterForm
            itemId={item.id}
            onDone={(text) => {
              setOpen(false);
              run(async () => text);
            }}
          />
        )}
      </div>
    </section>
  );
}

function ChapterRow({
  chapter,
  slug,
  pending,
  run,
}: {
  chapter: AdminChapterRow;
  slug: string;
  pending: boolean;
  run: (action: () => Promise<string>) => void;
}) {
  const ready = chapter.status === "ready";
  const rate =
    chapter.matchRate === null ? null : Math.round(chapter.matchRate * 100);

  return (
    <div className="rounded-lg bg-[#374151]/50 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-main">
            {chapter.position}. {chapter.title ?? "Rozdział"}
          </p>
          <p className="mt-0.5 text-xs text-muted2">
            {ready
              ? `${chapter.paragraphCount} akapitów · ${chapter.sentenceCount} zdań · ${chapter.wordCount} słów · ${chapter.estimatedMinutes} min`
              : `${chapter.sourceLength} znaków źródła — nieprzetworzone`}
            {chapter.processorVersion ? ` · ${chapter.processorVersion}` : ""}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {rate !== null && (
            <span
              className={cn(
                "rounded px-2 py-0.5 text-xs font-medium tabular-nums",
                rate >= 85
                  ? "bg-green/15 text-green"
                  : rate >= 60
                    ? "bg-gold/15 text-gold"
                    : "bg-red/15 text-red",
              )}
              title="Udział słów, które Fluent potrafi objaśnić"
            >
              {rate}%
            </span>
          )}
          {ready && (
            <Link
              href={`/library/${slug}/${chapter.position}`}
              className="flex size-8 items-center justify-center rounded-md bg-[#2d3748] text-muted2 hover:text-main"
              aria-label="Podgląd rozdziału"
              title="Zobacz tak, jak widzi to uczeń"
            >
              <Eye className="size-4" />
            </Link>
          )}
          <Button
            type="button"
            variant="secondary"
            disabled={pending}
            onClick={() =>
              run(async () => {
                const result = await processChapter({
                  chapterId: chapter.id,
                  force: true,
                });
                if (!result.ok) return result.message;
                return `Rozdział ${chapter.position}: ${result.paragraphCount} akapitów, ${result.sentenceCount} zdań, ${Math.round(result.matchRate * 100)}% dopasowania.`;
              })
            }
          >
            Przetwórz
          </Button>
        </div>
      </div>

      {chapter.processingError && (
        <p className="mt-2 flex items-start gap-1.5 text-xs text-red">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          {chapter.processingError}
        </p>
      )}

      {/* The dictionary gap, named. This is what turns a bad match rate into
          something someone can actually fix. */}
      {chapter.unmatchedSample.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs text-muted2">
            Brakujące słowa ({chapter.unmatchedSample.length})
          </summary>
          <p className="mt-1 text-xs leading-relaxed text-muted2">
            {chapter.unmatchedSample
              .map((entry) => `${entry.token} (${entry.count})`)
              .join(", ")}
          </p>
        </details>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const published = status === "published";
  return (
    <span
      className={cn(
        "flex items-center gap-1 rounded px-2 py-0.5 text-xs",
        published ? "bg-green/15 text-green" : "bg-[#374151] text-muted2",
      )}
    >
      {published && <CheckCircle2 className="size-3" />}
      {published ? "Opublikowane" : "Szkic"}
    </span>
  );
}

function NewItemForm({ onDone }: { onDone: (message: string) => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [busy, setBusy] = useState(false);

  if (!open) {
    return (
      <Button
        type="button"
        variant="secondary"
        onClick={() => setOpen(true)}
        className="w-full"
      >
        + Nowa pozycja
      </Button>
    );
  }

  return (
    <form
      className="space-y-2 rounded-xl border border-border bg-card p-4"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        const result = await createLibraryItem({ title, author });
        setBusy(false);
        setOpen(false);
        setTitle("");
        setAuthor("");
        onDone(result.ok ? `Utworzono „${title}".` : result.message);
      }}
    >
      <Input
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        placeholder="Tytuł"
        required
      />
      <Input
        value={author}
        onChange={(event) => setAuthor(event.target.value)}
        placeholder="Autor (opcjonalnie)"
      />
      <div className="flex gap-2">
        <Button type="submit" disabled={busy || !title.trim()} className="flex-1">
          Utwórz
        </Button>
        <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
          Anuluj
        </Button>
      </div>
    </form>
  );
}

function NewChapterForm({
  itemId,
  onDone,
}: {
  itemId: string;
  onDone: (message: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [source, setSource] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <form
      className="mt-2 space-y-2"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        const created = await createChapter({
          libraryItemId: itemId,
          title,
          sourceText: source,
        });
        if (!created.ok) {
          setBusy(false);
          onDone(created.message);
          return;
        }
        // Create and process in one step: a chapter nobody processed is a
        // chapter no learner can open.
        const processed = await processChapter({ chapterId: created.id });
        setBusy(false);
        onDone(
          processed.ok
            ? `Dodano rozdział ${created.position} (${processed.sentenceCount} zdań).`
            : processed.message,
        );
      }}
    >
      <Input
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        placeholder="Tytuł rozdziału (opcjonalnie)"
      />
      <Textarea
        value={source}
        onChange={(event) => setSource(event.target.value)}
        placeholder="Tekst rozdziału — zwykły tekst, pusta linia oddziela akapity."
        rows={8}
        required
      />
      <Button type="submit" disabled={busy || !source.trim()} className="w-full">
        {busy ? "Przetwarzanie…" : "Dodaj i przetwórz"}
      </Button>
    </form>
  );
}
