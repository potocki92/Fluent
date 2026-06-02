"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { PartyPopper } from "lucide-react";

import { useDueWords } from "@/hooks/useSavedWords";
import { updateSrs, type ReviewGrade } from "@/actions/update-srs";
import { FlashCard } from "@/components/flashcard/FlashCard";
import { Card } from "@/components/ui/card";

export default function ReviewPage() {
  const { due, isLoading } = useDueWords();
  const queryClient = useQueryClient();
  const [index, setIndex] = useState(0);

  if (isLoading) return <p className="text-sm text-muted2">Ładowanie…</p>;

  const current = due[index];

  async function grade(g: ReviewGrade) {
    if (!current) return;
    await updateSrs(current.word_id, g);
    if (index + 1 >= due.length) {
      // Finished this batch — refresh the deck.
      await queryClient.invalidateQueries({ queryKey: ["saved_words"] });
      setIndex(0);
    } else {
      setIndex((i) => i + 1);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold">Powtórki</h1>
        <p className="text-sm text-muted2">
          {due.length > 0
            ? `${due.length} ${due.length === 1 ? "słowo" : "słów"} do powtórki`
            : "Wszystko powtórzone"}
        </p>
      </div>

      {current ? (
        <FlashCard word={current.word} onGrade={grade} />
      ) : (
        <Card className="items-center gap-3 bg-[#2d3748] p-8 text-center">
          <PartyPopper className="size-10 text-gold" />
          <p className="font-semibold">Brak słów do powtórki!</p>
          <p className="text-sm text-muted2">
            Zapisuj słowa w słowniku, aby pojawiły się tutaj.
          </p>
        </Card>
      )}
    </div>
  );
}
