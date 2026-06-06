"use client";

import { useMemo, useState } from "react";
import { BookmarkPlus, Check, Loader2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

import { saveTextWords } from "@/actions/save-text-words";
import { extractLemmas } from "@/lib/lemmas";
import { Button } from "@/components/ui/button";

export function SaveTextWordsButton({
  textId,
  body,
}: {
  textId: number;
  body: string;
}) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<"idle" | "saving" | "done">("idle");
  const [savedCount, setSavedCount] = useState(0);

  const lemmaCount = useMemo(() => extractLemmas(body).length, [body]);
  if (lemmaCount === 0) return null;

  async function handleSave() {
    if (status !== "idle") return;
    setStatus("saving");
    try {
      const { saved } = await saveTextWords(textId);
      setSavedCount(saved);
      setStatus("done");
      await queryClient.invalidateQueries({ queryKey: ["saved_words"] });
    } catch {
      setStatus("idle");
    }
  }

  if (status === "done") {
    return (
      <div className="flex items-center gap-2 rounded-xl bg-[#48bb78]/15 px-4 py-2.5 text-sm font-semibold text-[#48bb78]">
        <Check className="size-4 shrink-0" />
        Dodano {savedCount} słówek do nauki
      </div>
    );
  }

  return (
    <Button
      type="button"
      onClick={handleSave}
      disabled={status === "saving"}
      variant="outline"
      className="w-full border-[#374151] bg-transparent text-[#e2e8f0] hover:bg-[#374151]"
    >
      {status === "saving" ? (
        <Loader2 className="mr-2 size-4 animate-spin" />
      ) : (
        <BookmarkPlus className="mr-2 size-4" />
      )}
      Dodaj słówka z tekstu ({lemmaCount})
    </Button>
  );
}
