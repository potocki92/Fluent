"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { Eye, ImageOff, Pencil, Plus, Trash2 } from "lucide-react";

import { MaterialCover } from "@/components/library/MaterialCover";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { deleteText, setTextStatus } from "@/actions/admin-texts";
import { useAdminTexts, type AdminTextRow } from "@/hooks/useAdminTexts";
import { CEFR_COLORS } from "@/lib/cefr";
import { cn } from "@/lib/utils";

/** Rendered at 64px, 80px from `sm` — the thumbnail's real ceiling. */
const THUMB_SIZES = "80px";

/**
 * The admin list of reading passages.
 *
 * EVERY ROW SHOWS ITS PICTURE, and a row without one says so rather than saying
 * nothing. The shelf at `/library` is illustrated now, so "does this text have
 * artwork?" is a property of the text an admin has to be able to SEE — and the
 * answer used to live one edit screen per text away. The thumbnail is the same
 * {@link MaterialCover} the shelf and `/admin/library` render, so the picture
 * here is the picture the learner gets; a missing one is a dashed empty frame,
 * which reads as a slot to fill rather than as a loading state.
 *
 * AND THE COUNT IS THE POINT OF THE FILTER. Seeing which texts lack a picture is
 * only half of it — on a list of thirty, finding them means scrolling past the
 * twenty-seven that are fine. „Bez obrazu (N)" turns that into one tap, in the
 * same shape `/admin/words` already uses for „Do uzupełnienia".
 */
export function AdminTextList() {
  const { data: texts, isLoading, error } = useAdminTexts();
  const queryClient = useQueryClient();

  const [missingOnly, setMissingOnly] = useState(false);
  const [toggling, setToggling] = useState<number | null>(null);
  const [toDelete, setToDelete] = useState<AdminTextRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function onToggleStatus(text: AdminTextRow) {
    if (toggling) return;
    setToggling(text.id);
    const next = text.status === "published" ? "draft" : "published";
    try {
      await setTextStatus(text.id, next);
      await queryClient.invalidateQueries({ queryKey: ["adminTexts"] });
      await queryClient.invalidateQueries({ queryKey: ["texts"] });
    } catch {
      // Leave the list untouched; the next refetch reflects the true state.
    } finally {
      setToggling(null);
    }
  }

  async function onConfirmDelete() {
    if (!toDelete || deleting) return;
    setDeleting(true);
    try {
      await deleteText(toDelete.id);
      await queryClient.invalidateQueries({ queryKey: ["adminTexts"] });
      await queryClient.invalidateQueries({ queryKey: ["texts"] });
      setToDelete(null);
    } catch {
      // Keep the dialog open so the admin can retry.
    } finally {
      setDeleting(false);
    }
  }

  const missingCovers = useMemo(
    () => (texts ?? []).filter((text) => !text.coverUrl).length,
    [texts],
  );
  const visible = useMemo(
    () => (missingOnly ? (texts ?? []).filter((text) => !text.coverUrl) : texts ?? []),
    [texts, missingOnly],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold">Teksty</h1>
          <p className="text-sm text-muted2">
            Zarządzaj tekstami i pytaniami do nauki.
          </p>
        </div>
        <Button
          asChild
          className="bg-gold text-[#1a202c] hover:bg-gold-dark"
        >
          <Link href="/admin/texts/new">
            <Plus className="size-4" />
            Dodaj tekst
          </Link>
        </Button>
      </div>

      {texts && texts.length > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => setMissingOnly((prev) => !prev)}
            aria-pressed={missingOnly}
            className={cn(
              "h-9 rounded-lg px-3 text-sm transition-colors",
              missingOnly
                ? "bg-gold font-semibold text-dark"
                : "bg-secondary text-muted-foreground hover:text-foreground",
            )}
          >
            Bez obrazu ({missingCovers})
          </button>
          <p className="text-sm text-muted2">
            {missingCovers === 0
              ? "Wszystkie teksty mają obraz."
              : `${missingCovers} z ${texts.length} tekstów czeka na obraz.`}
          </p>
        </div>
      )}

      {isLoading && <p className="text-sm text-muted2">Ładowanie…</p>}
      {error && (
        <p className="text-sm text-red">Nie udało się wczytać tekstów.</p>
      )}

      {texts && texts.length === 0 && (
        <p className="text-sm text-muted2">
          Brak tekstów. Dodaj pierwszy tekst, aby zacząć.
        </p>
      )}

      {texts && texts.length > 0 && visible.length === 0 && (
        <p className="text-sm text-muted2">
          Każdy tekst ma już swój obraz.
        </p>
      )}

      {visible.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-border bg-background">
          {visible.map((text) => (
            <div
              key={text.id}
              className="flex flex-col gap-2 border-b border-border p-3 last:border-b-0 sm:flex-row sm:items-center sm:justify-between sm:gap-3"
            >
              <div className="flex min-w-0 items-start gap-3">
                {/* The way into changing the picture is the picture itself — a
                    thumbnail that did nothing would be the one thing on this row
                    that looks tappable and is not. It goes to the edit screen,
                    which is where a passage's cover is actually chosen. */}
                <Link
                  href={`/admin/texts/${text.id}`}
                  aria-label={
                    text.coverUrl
                      ? `Zmień obraz — ${text.title}`
                      : `Dodaj obraz — ${text.title}`
                  }
                  className="shrink-0 rounded-lg focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
                >
                  <MaterialCover
                    coverUrl={text.coverUrl}
                    sizes={THUMB_SIZES}
                    className={cn(
                      "aspect-[4/3] w-16 rounded-lg border sm:w-20",
                      // Dashed and empty, like „Dodaj własną książkę" on the
                      // shelf: an outline waiting to be filled, not a frame that
                      // failed to load something.
                      text.coverUrl ? "border-border" : "border-dashed border-border",
                    )}
                    fallback={
                      <span className="flex size-full items-center justify-center bg-[#374151]">
                        <ImageOff className="size-5 text-muted2" />
                      </span>
                    }
                  />
                </Link>

                <div className="min-w-0 space-y-1">
                  <p className="truncate font-medium text-main">{text.title}</p>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted2">
                    <Badge className={cn("border-0", CEFR_COLORS[text.cefr])}>
                      {text.cefr}
                    </Badge>
                    <Badge
                      className={cn(
                        "border-0",
                        text.status === "published"
                          ? "bg-gold text-[#1a202c]"
                          : "bg-secondary text-muted-foreground",
                      )}
                    >
                      {text.status === "published" ? "Opublikowany" : "Szkic"}
                    </Badge>
                    {/* Said in words as well as drawn, because „which of these
                        has no picture?" must survive a screen reader and a
                        colour-blind glance at a grey rectangle. */}
                    {!text.coverUrl && (
                      <Badge variant="outline" className="text-muted2">
                        <ImageOff className="size-3" />
                        Bez obrazu
                      </Badge>
                    )}
                    <span>{text.word_count ?? 0} słów</span>
                    <span>·</span>
                    <span>{text.questionCount} pytań</span>
                    <span>·</span>
                    <span>
                      {new Date(text.created_at).toLocaleDateString("pl-PL")}
                    </span>
                  </div>
                </div>
              </div>

              {/* A 32px icon is a comfortable desktop target and a miss on a
                  phone, so the row keeps its compact `sm` sizing and grows to
                  36px where the input is a thumb. */}
              <div className="-ml-3 flex shrink-0 items-center gap-1 sm:ml-0">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-9 sm:h-8"
                  onClick={() => onToggleStatus(text)}
                  disabled={toggling === text.id}
                >
                  {text.status === "published" ? "Cofnij" : "Publikuj"}
                </Button>
                <Button
                  asChild
                  variant="ghost"
                  size="icon-sm"
                  className="size-9 sm:size-8"
                  aria-label="Podgląd"
                >
                  <Link href={`/admin/texts/${text.id}/preview`}>
                    <Eye className="size-4" />
                  </Link>
                </Button>
                <Button
                  asChild
                  variant="ghost"
                  size="icon-sm"
                  className="size-9 sm:size-8"
                  aria-label="Edytuj"
                >
                  <Link href={`/admin/texts/${text.id}`}>
                    <Pencil className="size-4" />
                  </Link>
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Usuń"
                  className="size-9 text-red hover:text-red sm:size-8"
                  onClick={() => setToDelete(text)}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog
        open={toDelete !== null}
        onOpenChange={(open) => !open && setToDelete(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Usunąć tekst?</DialogTitle>
            <DialogDescription>
              Tekst „{toDelete?.title}” i wszystkie jego pytania zostaną trwale
              usunięte. Tej operacji nie można cofnąć.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setToDelete(null)}>
              Anuluj
            </Button>
            <Button
              variant="destructive"
              onClick={onConfirmDelete}
              disabled={deleting}
            >
              {deleting ? "Usuwanie…" : "Usuń"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
