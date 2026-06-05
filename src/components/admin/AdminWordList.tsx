"use client";

import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Search, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { WordForm } from "@/components/admin/WordForm";
import { deleteWord } from "@/actions/admin-words";
import {
  useAdminWords,
  useMissingWordsCount,
  type AdminWordFilters,
} from "@/hooks/useAdminWords";
import { CEFR_COLORS } from "@/lib/cefr";
import { WORD_TOPICS, topicLabel } from "@/lib/word-topics";
import { cn } from "@/lib/utils";
import type { Word, WordTopic } from "@/types";

const TOPIC_ALL = "all";

/** Editor target: `null` closed, `"new"` create, or a Word to edit. */
type Editing = Word | "new" | null;

export function AdminWordList() {
  const queryClient = useQueryClient();

  const [searchInput, setSearchInput] = useState("");
  const [filters, setFilters] = useState<AdminWordFilters>({});
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data, isLoading, error } = useAdminWords(filters);
  const { data: missingCount } = useMissingWordsCount();

  const [editing, setEditing] = useState<Editing>(null);
  const [toDelete, setToDelete] = useState<Word | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Debounce search so each keystroke doesn't refetch the dictionary.
  function onSearchChange(value: string) {
    setSearchInput(value);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      setFilters((f) => ({ ...f, search: value.trim() || undefined }));
    }, 300);
  }
  useEffect(
    () => () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    },
    [],
  );

  async function onConfirmDelete() {
    if (!toDelete || deleting) return;
    setDeleting(true);
    try {
      await deleteWord(toDelete.id);
      await queryClient.invalidateQueries({ queryKey: ["adminWords"] });
      await queryClient.invalidateQueries({ queryKey: ["words"] });
      setToDelete(null);
    } catch {
      // Keep the dialog open so the admin can retry.
    } finally {
      setDeleting(false);
    }
  }

  const words = data?.words ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Słownik</h1>
          <p className="text-sm text-muted2">
            Dodawaj i edytuj słowa, uzupełniaj tłumaczenia i przykłady.
          </p>
        </div>
        <Button
          className="bg-gold text-[#1a202c] hover:bg-gold-dark"
          onClick={() => setEditing("new")}
        >
          <Plus className="size-4" />
          Dodaj słowo
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchInput}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Szukaj po niem. lub polsku…"
            className="h-9 pl-9"
          />
        </div>

        <Select
          value={filters.topic ?? TOPIC_ALL}
          onValueChange={(v) =>
            setFilters((f) => ({
              ...f,
              topic: v === TOPIC_ALL ? undefined : (v as WordTopic),
            }))
          }
        >
          <SelectTrigger className="h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={TOPIC_ALL}>Wszystkie tematy</SelectItem>
            {WORD_TOPICS.map((t) => (
              <SelectItem key={t.value} value={t.value}>
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <button
          type="button"
          onClick={() =>
            setFilters((f) => ({ ...f, missingOnly: !f.missingOnly }))
          }
          aria-pressed={filters.missingOnly ?? false}
          className={cn(
            "h-9 rounded-lg px-3 text-sm transition-colors",
            filters.missingOnly
              ? "bg-gold font-semibold text-dark"
              : "bg-secondary text-muted-foreground hover:text-foreground",
          )}
        >
          Do uzupełnienia
          {typeof missingCount === "number" && ` (${missingCount})`}
        </button>
      </div>

      {isLoading && <p className="text-sm text-muted2">Ładowanie…</p>}
      {error && (
        <p className="text-sm text-red">Nie udało się wczytać słownika.</p>
      )}

      {data && words.length === 0 && (
        <p className="text-sm text-muted2">Brak słów dla tych filtrów.</p>
      )}

      {words.length > 0 && (
        <>
          <p className="text-sm text-muted2">
            Pokazano {words.length} z {data?.count ?? 0} słów
          </p>
          <div className="overflow-hidden rounded-xl border border-border bg-background">
            {words.map((word) => (
              <div
                key={word.id}
                className="flex flex-col gap-2 border-b border-border p-3 last:border-b-0 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0 space-y-1">
                  <p className="truncate font-medium text-main">
                    {word.article && (
                      <span className="mr-1 font-normal text-muted2">
                        {word.article}
                      </span>
                    )}
                    {word.display}
                  </p>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted2">
                    {word.cefr && (
                      <Badge className={cn("border-0", CEFR_COLORS[word.cefr])}>
                        {word.cefr}
                      </Badge>
                    )}
                    {word.topic && (
                      <Badge className="border-0 bg-secondary text-muted-foreground">
                        {topicLabel(word.topic)}
                      </Badge>
                    )}
                    <span className="truncate">
                      {word.translation_pl ?? "— brak tłumaczenia"}
                    </span>
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Edytuj"
                    onClick={() => setEditing(word)}
                  >
                    <Pencil className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Usuń"
                    className="text-red hover:text-red"
                    onClick={() => setToDelete(word)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <Dialog
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editing === "new" ? "Nowe słowo" : "Edytuj słowo"}
            </DialogTitle>
            <DialogDescription>
              Pola opcjonalne pozostaw puste, aby zapisać je jako brak.
            </DialogDescription>
          </DialogHeader>
          {editing !== null && (
            <WordForm
              key={editing === "new" ? "new" : editing.id}
              word={editing === "new" ? undefined : editing}
              onDone={() => setEditing(null)}
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={toDelete !== null}
        onOpenChange={(open) => !open && setToDelete(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Usunąć słowo?</DialogTitle>
            <DialogDescription>
              Słowo „{toDelete?.display}” zostanie trwale usunięte. Zniknie też z
              decków powtórek użytkowników. Tej operacji nie można cofnąć.
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
