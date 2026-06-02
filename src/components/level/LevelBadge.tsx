import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { CefrLevel } from "@/types";

export function LevelBadge({
  level,
  className,
}: {
  level: CefrLevel | null;
  className?: string;
}) {
  return (
    <Badge
      className={cn(
        "bg-gold text-[#1a202c] font-semibold hover:bg-gold-dark border-transparent",
        className,
      )}
    >
      {level ?? "—"}
    </Badge>
  );
}
