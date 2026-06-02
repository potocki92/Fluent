import Link from "next/link";
import { ChevronRight, FileText } from "lucide-react";

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { Text } from "@/types";

export function TextCard({ text }: { text: Text }) {
  return (
    <Link href={`/learn/${text.id}`} className="block">
      <Card className="flex-row items-center gap-3 bg-[#2d3748] p-4 transition-colors hover:bg-[#374151]">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-[#374151] text-gold">
          <FileText className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{text.title}</p>
          <p className="text-xs text-muted2">
            {text.word_count ?? "—"} słów
          </p>
        </div>
        <Badge className="bg-gold text-[#1a202c]">{text.cefr}</Badge>
        <ChevronRight className="size-4 text-muted2" />
      </Card>
    </Link>
  );
}
