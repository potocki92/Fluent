import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Text } from "@/types";

/** Max difficulty used to scale the 5-dot indicator. */
const MAX_DIFFICULTY = 1800;

export function TextCard({ text }: { text: Text }) {
  const filled = Math.max(
    0,
    Math.min(5, Math.round((text.difficulty / MAX_DIFFICULTY) * 5)),
  );

  return (
    <Link href={`/learn/${text.id}`} className="block">
      <Card className="gap-2 bg-[#2d3748] p-3 transition-colors hover:bg-[#374151]">
        <div className="flex items-center justify-between gap-3">
          <Badge className="bg-gold text-[#1a202c]">{text.cefr}</Badge>
          <div className="flex items-center gap-1" aria-label="Poziom trudności">
            {Array.from({ length: 5 }).map((_, i) => (
              <span
                key={i}
                className={cn(
                  "size-1.5 rounded-full",
                  i < filled ? "bg-gold" : "bg-[#1a202c]",
                )}
              />
            ))}
          </div>
        </div>

        <p className="font-medium">{text.title}</p>

        <div className="flex items-center justify-between">
          <p className="text-xs text-muted2">
            {text.word_count ?? "—"} słów · trudność {text.difficulty}
          </p>
          <span className="flex items-center gap-1 text-sm font-medium text-gold">
            Czytaj
            <ArrowRight className="size-4" />
          </span>
        </div>
      </Card>
    </Link>
  );
}
