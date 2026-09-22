"use client";

import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { reviewSuggestion } from "@/actions/admin-words";
import {
  useAdminSuggestions,
  type AdminSuggestionRow,
} from "@/hooks/useAdminSuggestions";
import type { SuggestionField } from "@/types";

/** Polish label for the word field a suggestion targets. */
const FIELD_LABEL: Record<SuggestionField, string> = {
  translation_pl: "Tłumaczenie",
  example_de: "Przykład (DE)",
  example_pl: "Przykład (PL)",
  other: "Inne",
};

export function SuggestionList() {
  const { data: suggestions, isLoading, error } = useAdminSuggestions();
  const queryClient = useQueryClient();
  const [busyId, setBusyId] = useState<number | null>(null);
  const [failure, setFailure] = useState<number | null>(null);
  const gate = useRef(false);

  async function review(
    suggestion: AdminSuggestionRow,
    decision: "approved" | "rejected",
  ) {
    // A ref, not the state above: two clicks in the same frame both read
    // `busyId` as null. The RPC is idempotent either way, so the worst case is
    // a wasted round trip rather than a double-applied edit — but the second
    // click should still do nothing.
    if (gate.current) return;
    gate.current = true;
    setBusyId(suggestion.id);
    setFailure(null);
    try {
      const result = await reviewSuggestion(suggestion.id, decision);
      await queryClient.invalidateQueries({ queryKey: ["adminSuggestions"] });
      // Only a review that actually wrote to `words` changes the dictionary.
      // An already-decided suggestion — a second tab, a retried request —
      // reports `applied: false` and leaves the word exactly as it is.
      if (result.applied && decision === "approved") {
        await queryClient.invalidateQueries({ queryKey: ["adminWords"] });
        await queryClient.invalidateQueries({ queryKey: ["words"] });
      }
    } catch {
      // Never silent: an empty catch here stopped the spinner and left the row
      // in place, which reads as "the button is broken".
      setFailure(suggestion.id);
    } finally {
      gate.current = false;
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">Zgłoszenia</h1>
        <p className="text-sm text-muted2">
          Propozycje poprawek od użytkowników. Zaakceptowanie nadpisuje pole
          słowa.
        </p>
      </div>

      {isLoading && <p className="text-sm text-muted2">Ładowanie…</p>}
      {error && (
        <p className="text-sm text-red">Nie udało się wczytać zgłoszeń.</p>
      )}

      {suggestions && suggestions.length === 0 && (
        <p className="text-sm text-muted2">Brak oczekujących zgłoszeń.</p>
      )}

      {suggestions && suggestions.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-border bg-background">
          {suggestions.map((s) => (
            <div
              key={s.id}
              className="flex flex-col gap-2 border-b border-border p-3 last:border-b-0 sm:flex-row sm:items-center sm:justify-between sm:gap-3"
            >
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-main">
                    {s.word?.display ?? `#${s.word_id}`}
                  </span>
                  <Badge className="border-0 bg-secondary text-muted-foreground">
                    {FIELD_LABEL[s.field]}
                  </Badge>
                </div>
                <p className="text-sm text-foreground">{s.suggestion}</p>
                {s.note && (
                  <p className="text-xs text-muted2">Uwaga: {s.note}</p>
                )}
                {failure === s.id && (
                  <p className="text-xs text-red">
                    Nie udało się zapisać decyzji. Spróbuj ponownie.
                  </p>
                )}
              </div>

              <div className="-ml-2.5 flex shrink-0 items-center gap-1 sm:ml-0">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-9 text-green hover:text-green sm:h-8"
                  disabled={busyId === s.id}
                  onClick={() => review(s, "approved")}
                >
                  <Check className="size-4" />
                  Zaakceptuj
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-9 text-red hover:text-red sm:h-8"
                  disabled={busyId === s.id}
                  onClick={() => review(s, "rejected")}
                >
                  <X className="size-4" />
                  Odrzuć
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
