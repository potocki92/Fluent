"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { saveWord } from "@/actions/save-word";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { createClientSupabaseClient } from "@/lib/supabase/client";

interface TooltipWord {
  id: number;
  display: string;
  translation_pl: string | null;
  example_de: string | null;
  example_pl: string | null;
}

/**
 * Wraps an inline German word (e.g. inside a reading passage) and reveals its
 * Polish translation + example on hover (desktop) or tap (mobile). The word
 * details are fetched lazily the first time the tooltip opens.
 */
export function WordTooltip({
  lemma,
  children,
}: {
  lemma: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["word-tooltip", lemma],
    enabled: open,
    queryFn: async (): Promise<TooltipWord> => {
      const supabase = createClientSupabaseClient();
      const { data, error } = await supabase
        .from("words")
        .select("id,display,translation_pl,example_de,example_pl")
        .ilike("lemma", lemma)
        .limit(1)
        .single();
      if (error) throw error;
      return data;
    },
  });

  return (
    <Tooltip open={open} onOpenChange={setOpen}>
      <TooltipTrigger asChild>
        <mark className="cursor-help rounded bg-[#d4a574]/15 px-0.5 text-[#d4a574] underline decoration-dotted underline-offset-2">
          {children}
        </mark>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs space-y-2 border border-[#374151] bg-[#2d3748] text-left text-[#e2e8f0]">
        {isLoading || !data ? (
          <div className="space-y-2">
            <div className="h-4 w-24 animate-pulse rounded bg-[#374151]" />
            <div className="h-3 w-32 animate-pulse rounded bg-[#374151]" />
            <div className="h-3 w-28 animate-pulse rounded bg-[#374151]" />
          </div>
        ) : (
          <>
            <p className="font-semibold">{data.display}</p>
            {data.translation_pl && (
              <p className="text-[#a0aec0]">{data.translation_pl}</p>
            )}
            {data.example_de && (
              <p className="italic text-[#a0aec0]">{data.example_de}</p>
            )}
            <button
              type="button"
              onClick={() => saveWord(data.id)}
              className="rounded-lg bg-[#d4a574] px-2 py-1 text-xs font-semibold text-[#1a202c]"
            >
              + Dodaj do nauki
            </button>
          </>
        )}
      </TooltipContent>
    </Tooltip>
  );
}
