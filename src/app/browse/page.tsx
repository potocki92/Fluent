"use client";

import { useState } from "react";
import { Search } from "lucide-react";

import { useWords, type WordFilters } from "@/hooks/useWords";
import { WordCard } from "@/components/words/WordCard";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { WordType } from "@/types";

export default function BrowsePage() {
  const [search, setSearch] = useState("");
  const [type, setType] = useState<WordType | "all">("all");

  const filters: WordFilters = {
    search: search.trim() || undefined,
    type: type === "all" ? undefined : type,
  };
  const { data: words, isLoading } = useWords(filters);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">Słownik</h1>
        <p className="text-sm text-muted2">2588 słów ze słownika DTZ.</p>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted2" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Szukaj słowa…"
          className="pl-9"
        />
      </div>

      <Tabs value={type} onValueChange={(v) => setType(v as WordType | "all")}>
        <TabsList className="w-full">
          <TabsTrigger value="all" className="flex-1">
            Wszystkie
          </TabsTrigger>
          <TabsTrigger value="noun" className="flex-1">
            Rzeczowniki
          </TabsTrigger>
          <TabsTrigger value="verb" className="flex-1">
            Czasowniki
          </TabsTrigger>
          <TabsTrigger value="other" className="flex-1">
            Inne
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {isLoading && <p className="text-sm text-muted2">Ładowanie…</p>}

      <div className="space-y-3">
        {words?.map((word) => (
          <WordCard key={word.id} word={word} />
        ))}
        {words?.length === 0 && !isLoading && (
          <p className="text-sm text-muted2">Brak wyników.</p>
        )}
      </div>
    </div>
  );
}
