import { Check } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Three steps, because there are three.
 *
 * Plik → Rozdziały → Import. An eight-step wizard would be describing the
 * implementation (extract, detect metadata, detect chapters, persist, process)
 * rather than the task, and the implementation's stages are already shown where
 * they belong — in the line of text under the spinner while the work happens.
 */
export type ImportStep = "file" | "chapters" | "import";

const STEPS: { id: ImportStep; label: string }[] = [
  { id: "file", label: "Plik" },
  { id: "chapters", label: "Rozdziały" },
  { id: "import", label: "Import" },
];

export function ImportStepper({ current }: { current: ImportStep }) {
  const index = STEPS.findIndex((step) => step.id === current);

  return (
    <ol className="flex items-center gap-2">
      {STEPS.map((step, order) => {
        const done = order < index;
        const active = order === index;

        return (
          <li key={step.id} className="flex flex-1 items-center gap-2">
            <span
              className={cn(
                "flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                done && "bg-green/20 text-green",
                active && "bg-gold text-[#1a202c]",
                !done && !active && "bg-[#374151] text-muted2",
              )}
            >
              {done ? <Check className="size-3.5" /> : order + 1}
            </span>
            <span
              className={cn(
                "truncate text-xs",
                active ? "font-medium text-main" : "text-muted2",
              )}
            >
              {step.label}
            </span>
            {order < STEPS.length - 1 && (
              <span
                className={cn(
                  "h-px flex-1",
                  done ? "bg-green/40" : "bg-[#374151]",
                )}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}
