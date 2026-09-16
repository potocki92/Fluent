"use client";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * One labelled control, wired for screen readers.
 *
 * Every auth input goes through here so that the accessibility work is done
 * once and cannot drift: a real `<label for>`, `aria-invalid` when the field is
 * wrong, and `aria-describedby` pointing at the hint AND the error, so the error
 * is announced with the field rather than floating somewhere above the form
 * (§56).
 *
 * `endSlot` is how `PasswordField` adds its visibility toggle without a second
 * copy of any of this.
 */
export function AuthField({
  id,
  label,
  hint,
  error,
  endSlot,
  className,
  ...props
}: React.ComponentProps<typeof Input> & {
  id: string;
  label: string;
  hint?: React.ReactNode;
  error?: string | null;
  endSlot?: React.ReactNode;
}) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-main">
        {label}
      </label>

      <div className="relative">
        <Input
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(
            // 16px on phones so iOS Safari does not zoom the viewport when the
            // field takes focus, and 44px tall so it is a real touch target.
            "h-11 rounded-xl bg-dark/40 text-base md:text-base",
            endSlot && "pr-11",
            className,
          )}
          {...props}
        />
        {endSlot ? (
          <div className="absolute inset-y-0 right-1 flex items-center">
            {endSlot}
          </div>
        ) : null}
      </div>

      {hint ? (
        <p id={hintId} className="text-xs text-muted2">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="text-xs font-medium text-red">
          {error}
        </p>
      ) : null}
    </div>
  );
}
