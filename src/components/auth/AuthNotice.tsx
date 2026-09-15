import { AlertCircle, CheckCircle2, Info } from "lucide-react";

import { cn } from "@/lib/utils";

type Tone = "error" | "success" | "info";

const TONE = {
  error: {
    icon: AlertCircle,
    className: "border-red/30 bg-red/10 text-red",
  },
  success: {
    icon: CheckCircle2,
    className: "border-green/30 bg-green/10 text-green",
  },
  info: {
    icon: Info,
    className: "border-blue/30 bg-blue/10 text-blue",
  },
} as const;

/**
 * A form-level message.
 *
 * Errors carry `role="alert"` so a screen reader announces them the moment they
 * appear, which for a failed sign-in is the entire feedback (§56). Successes are
 * `role="status"` — polite, because nothing has gone wrong and interrupting is
 * rude.
 */
export function AuthNotice({
  tone = "error",
  children,
  className,
}: {
  tone?: Tone;
  children: React.ReactNode;
  className?: string;
}) {
  const { icon: Icon, className: toneClassName } = TONE[tone];

  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "flex items-start gap-2 rounded-xl border px-3 py-2.5 text-sm",
        toneClassName,
        className,
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span className="text-pretty">{children}</span>
    </div>
  );
}
