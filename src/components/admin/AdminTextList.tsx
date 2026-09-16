"use client";

import { useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { Eye, Pencil, Plus, Trash2 } from "lucide-react";

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

export function AdminTextList() {
  const { data: texts, isLoading, error } = useAdminTexts();
  const queryClient = useQueryClient();

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

      {isLoading && <p className="text-sm text-muted2">Ładowanie…</p>}
      {error && (
        <p className="text-sm text-red">Nie udało się wczytać tekstów.</p>
      )}

      {texts && texts.length === 0 && (
        <p className="text-sm text-muted2">
          Brak tekstów. Dodaj pierwszy tekst, aby zacząć.
        </p>
      )}

      {texts && texts.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-border bg-background">
          {texts.map((text) => (
            <div
              key={text.id}
              className="flex flex-col gap-2 border-b border-border p-3 last:border-b-0 sm:flex-row sm:items-center sm:justify-between sm:gap-3"
            >
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
                  <span>{text.word_count ?? 0} słów</span>
                  <span>·</span>
                  <span>{text.questionCount} pytań</span>
                  <span>·</span>
                  <span>
                    {new Date(text.created_at).toLocaleDateString("pl-PL")}
                  </span>
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
