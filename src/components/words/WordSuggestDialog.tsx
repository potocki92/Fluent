"use client";

import { useState } from "react";
import { MessageSquarePlus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
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
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { suggestWord } from "@/actions/suggest-word";
import type { SuggestionField } from "@/types";

const FIELD_OPTIONS: { value: SuggestionField; label: string }[] = [
  { value: "translation_pl", label: "Tłumaczenie" },
  { value: "example_de", label: "Przykład (DE)" },
  { value: "example_pl", label: "Przykład (PL)" },
  { value: "other", label: "Inne" },
];

/**
 * Lets a signed-in learner propose a correction for a dictionary word. The
 * suggestion lands in the admin review queue; the word changes only once an
 * admin approves it.
 */
export function WordSuggestDialog({ wordId }: { wordId: number }) {
  const [open, setOpen] = useState(false);
  const [field, setField] = useState<SuggestionField>("translation_pl");
  const [suggestion, setSuggestion] = useState("");
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  function reset() {
    setField("translation_pl");
    setSuggestion("");
    setNote("");
    setError(null);
    setDone(false);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    if (!suggestion.trim()) {
      setError("Wpisz treść propozycji.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      await suggestWord({ wordId, field, suggestion, note: note || null });
      setDone(true);
    } catch (err) {
      const message =
        err instanceof Error && err.message === "Not authenticated"
          ? "Zaloguj się, aby zgłaszać poprawki."
          : "Nie udało się wysłać zgłoszenia.";
      setError(message);
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-secondary px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <MessageSquarePlus className="size-4" />
          Zaproponuj poprawkę
        </button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Zaproponuj poprawkę</DialogTitle>
          <DialogDescription>
            Twoja propozycja trafi do akceptacji administratora.
          </DialogDescription>
        </DialogHeader>

        {done ? (
          <div className="space-y-4">
            <p className="text-sm text-foreground">
              Dziękujemy! Zgłoszenie zostało wysłane.
            </p>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Zamknij
            </Button>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-foreground">
                Czego dotyczy?
              </label>
              <Select
                value={field}
                onValueChange={(v) => setField(v as SuggestionField)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FIELD_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="suggestion-text"
                className="block text-sm font-medium text-foreground"
              >
                Propozycja
              </label>
              <Textarea
                id="suggestion-text"
                value={suggestion}
                onChange={(e) => setSuggestion(e.target.value)}
                className="min-h-20"
                placeholder="Wpisz poprawną wartość…"
              />
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="suggestion-note"
                className="block text-sm font-medium text-foreground"
              >
                Uwaga (opcjonalnie)
              </label>
              <Textarea
                id="suggestion-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="min-h-16"
              />
            </div>

            {error && <p className="text-sm text-red">{error}</p>}

            <Button
              type="submit"
              disabled={pending}
              className="bg-gold text-[#1a202c] hover:bg-gold-dark"
            >
              {pending ? "Wysyłanie…" : "Wyślij zgłoszenie"}
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
