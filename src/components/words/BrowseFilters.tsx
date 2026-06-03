"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, SlidersHorizontal } from "lucide-react";

import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useSavedWords } from "@/hooks/useSavedWords";
import { cn } from "@/lib/utils";

type CefrValue = "A1" | "A2" | "B1";
type TypeValue = "noun" | "verb" | "other";

const CEFR_CHIPS: { label: string; value?: CefrValue }[] = [
  { label: "Wszystkie" },
  { label: "A1", value: "A1" },
  { label: "A2", value: "A2" },
  { label: "B1", value: "B1" },
];

const TYPE_CHIPS: { label: string; value?: TypeValue }[] = [
  { label: "Wszystkie" },
  { label: "Rzeczowniki", value: "noun" },
  { label: "Czasowniki", value: "verb" },
  { label: "Inne", value: "other" },
];

function chipClass(active: boolean) {
  return cn(
    "rounded-lg px-3 py-1.5 text-sm transition-colors",
    active
      ? "bg-gold font-semibold text-dark"
      : "bg-secondary text-muted-foreground hover:text-foreground",
  );
}

export function BrowseFilters({
  cefr,
  type,
  q,
}: {
  cefr?: string;
  type?: string;
  q?: string;
}) {
  const router = useRouter();
  const { data: saved } = useSavedWords();
  const savedCount = saved?.length ?? 0;
  const [searchValue, setSearchValue] = useState(q ?? "");
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Number of active (non-default) filters, shown as a badge on the button.
  const activeFilters = (cefr ? 1 : 0) + (type ? 1 : 0);

  // Keep the input in sync if the URL query changes externally (e.g. back nav),
  // using React's "adjust state during render" pattern instead of an effect.
  const [prevQ, setPrevQ] = useState(q);
  if (q !== prevQ) {
    setPrevQ(q);
    setSearchValue(q ?? "");
  }

  const pushParams = useCallback(
    (next: { cefr?: string; type?: string; q?: string }) => {
      const params = new URLSearchParams();
      const merged = { cefr, type, q, ...next };
      if (merged.q) params.set("q", merged.q);
      if (merged.cefr) params.set("cefr", merged.cefr);
      if (merged.type) params.set("type", merged.type);
      const query = params.toString();
      router.replace(query ? `/browse?${query}` : "/browse", {
        scroll: false,
      });
    },
    [router, cefr, type, q],
  );

  const handleSearchChange = useCallback(
    (value: string) => {
      setSearchValue(value);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => {
        pushParams({ q: value.trim() || undefined });
      }, 300);
    },
    [pushParams],
  );

  useEffect(() => () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
  }, []);

  return (
    <div className="flex items-center gap-4 sm:gap-2">
      <div className="relative flex-1">
        <Search className="absolute left-4 top-1/2 size-6 -translate-y-1/2 text-muted-foreground sm:left-3 sm:size-4" />
        <Input
          value={searchValue}
          onChange={(e) => handleSearchChange(e.target.value)}
          placeholder="Szukaj po niem. lub polsku…"
          className="h-12 rounded-xl border-border bg-card pl-12 text-xl text-foreground placeholder:text-muted-foreground sm:h-9 sm:rounded-lg sm:pl-9 sm:text-base md:text-sm"
        />
      </div>

      <Sheet>
        <SheetTrigger
          className="relative flex size-12 shrink-0 items-center justify-center rounded-xl border border-border bg-card text-gold transition-colors hover:bg-secondary sm:size-10 sm:rounded-lg"
          aria-label="Filtry"
        >
          <SlidersHorizontal className="size-6 sm:size-5" />
          {activeFilters > 0 && (
            <span className="absolute -right-1 -top-1 flex size-5 items-center justify-center rounded-full bg-gold text-xs font-semibold text-dark sm:size-4 sm:text-[10px]">
              {activeFilters}
            </span>
          )}
        </SheetTrigger>
        <SheetContent
          side="bottom"
          className="mx-auto rounded-t-2xl border-border sm:max-w-lg"
        >
          <SheetHeader>
            <SheetTitle>Filtry</SheetTitle>
          </SheetHeader>

          <div className="space-y-5 px-4 pb-6">
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Poziom CEFR
              </p>
              <div className="flex flex-wrap gap-2">
                {CEFR_CHIPS.map((chip) => (
                  <button
                    key={chip.label}
                    type="button"
                    onClick={() => pushParams({ cefr: chip.value })}
                    className={chipClass((cefr ?? undefined) === chip.value)}
                  >
                    {chip.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Typ słowa
              </p>
              <div className="flex flex-wrap gap-2">
                {TYPE_CHIPS.map((chip) => (
                  <button
                    key={chip.label}
                    type="button"
                    onClick={() => pushParams({ type: chip.value })}
                    className={chipClass((type ?? undefined) === chip.value)}
                  >
                    {chip.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <div className="shrink-0 text-right">
        <p className="text-2xl font-bold leading-none text-gold sm:text-lg">
          {savedCount}
        </p>
        <p className="text-base leading-tight text-muted-foreground sm:text-xs">
          {savedCount === 1 ? "słowo" : "słów"}
          <br />w nauce
        </p>
      </div>
    </div>
  );
}
