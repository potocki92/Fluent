"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";

import { Input } from "@/components/ui/input";
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
      ? "bg-[#d4a574] font-semibold text-[#1a202c]"
      : "bg-[#374151] text-[#a0aec0] hover:text-[#e2e8f0]",
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
  const [searchValue, setSearchValue] = useState(q ?? "");
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    <div className="space-y-3">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#a0aec0]" />
        <Input
          value={searchValue}
          onChange={(e) => handleSearchChange(e.target.value)}
          placeholder="Szukaj po niem. lub polsku…"
          className="rounded-lg border-[#374151] bg-[#2d3748] pl-9 text-[#e2e8f0] placeholder:text-[#a0aec0]"
        />
      </div>

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
  );
}
