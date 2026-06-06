"use client";

import { useState, type ReactNode } from "react";
import { Lightbulb } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { saveMnemonic } from "@/actions/save-mnemonic";

/**
 * The two halves of a keyword-method mnemonic are kept in one `words.mnemonic`
 * string as `🔑 {keyword} → {image}`. These helpers format and parse that shape
 * so the dialog can edit each half separately while storage stays a single column.
 */
const KEYWORD_PREFIX = "🔑 ";
const SEPARATOR = " → ";

export function formatMnemonic(keyword: string, image: string): string {
  const k = keyword.trim();
  const i = image.trim();
  if (k && i) return `${KEYWORD_PREFIX}${k}${SEPARATOR}${i}`;
  return k ? `${KEYWORD_PREFIX}${k}` : i;
}

function parseMnemonic(mnemonic: string | null): {
  keyword: string;
  image: string;
} {
  if (!mnemonic) return { keyword: "", image: "" };
  if (mnemonic.startsWith(KEYWORD_PREFIX)) {
    const rest = mnemonic.slice(KEYWORD_PREFIX.length);
    const at = rest.indexOf(SEPARATOR);
    if (at >= 0) {
      return { keyword: rest.slice(0, at), image: rest.slice(at + SEPARATOR.length) };
    }
    return { keyword: rest, image: "" };
  }
  return { keyword: "", image: mnemonic };
}

/**
 * Lets a learner create/edit the keyword-method mnemonic for a dictionary word.
 * Two guided fields — a sound-alike Polish keyword and a vivid, interactive
 * image — that combine into the shared `words.mnemonic`. Saving goes through the
 * admin-gated `saveMnemonic`; non-admins get a clear message instead.
 */
export function MnemonicDialog({
  wordId,
  display,
  mnemonic,
  onSaved,
  trigger,
}: {
  wordId: number;
  display: string;
  mnemonic: string | null;
  onSaved?: (mnemonic: string | null) => void;
  trigger?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const parsed = parseMnemonic(mnemonic);
  const [keyword, setKeyword] = useState(parsed.keyword);
  const [image, setImage] = useState(parsed.image);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function syncFromProp() {
    const next = parseMnemonic(mnemonic);
    setKeyword(next.keyword);
    setImage(next.image);
    setError(null);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const { mnemonic: saved } = await saveMnemonic(
        wordId,
        formatMnemonic(keyword, image),
      );
      onSaved?.(saved);
      setOpen(false);
    } catch (err) {
      const message =
        err instanceof Error && err.message === "Not authenticated"
          ? "Zaloguj się, aby dodać skojarzenie."
          : err instanceof Error && err.message === "Forbidden"
            ? "Tylko administrator może edytować skojarzenia."
            : "Nie udało się zapisać skojarzenia.";
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
        if (next) syncFromProp();
      }}
    >
      <DialogTrigger asChild>
        {trigger ?? (
          <button
            type="button"
            className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-secondary px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <Lightbulb className="size-4" />
            {mnemonic ? "Edytuj skojarzenie" : "Dodaj skojarzenie"}
          </button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Skojarzenie (metoda słowa-klucza)</DialogTitle>
          <DialogDescription>
            Dobierz polskie słowo brzmiące podobnie do{" "}
            <span className="font-semibold text-foreground">{display}</span>, a
            potem wyobraź sobie żywą, dynamiczną scenę łączącą je ze znaczeniem.
            Im bardziej wyrazisty i ruchomy obraz, tym lepiej zapada w pamięć.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label
              htmlFor="mnemonic-keyword"
              className="block text-sm font-medium text-foreground"
            >
              Słowo-klucz
            </label>
            <Input
              id="mnemonic-keyword"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="np. polskie słowo brzmiące podobnie…"
            />
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="mnemonic-image"
              className="block text-sm font-medium text-foreground"
            >
              Skojarzenie / obraz
            </label>
            <Textarea
              id="mnemonic-image"
              value={image}
              onChange={(e) => setImage(e.target.value)}
              className="min-h-24"
              placeholder="Opisz scenę łączącą słowo-klucz ze znaczeniem…"
            />
          </div>

          {error && <p className="text-sm text-red">{error}</p>}

          <Button
            type="submit"
            disabled={pending}
            className="bg-gold text-dark hover:bg-gold-dark"
          >
            {pending ? "Zapisywanie…" : "Zapisz skojarzenie"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
