"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";

import { AuthField } from "@/components/auth/AuthField";

/**
 * A password input with a visibility toggle and a Caps Lock warning.
 *
 * ONE COPY (§77). Login, registration, "powtórz hasło" and the recovery screen
 * all use this; the toggle logic existing four times is how three of them end up
 * with a different `aria-label`.
 *
 * The toggle sits inside the field's own right padding, so switching between
 * dots and text moves nothing (§51 applied to inputs). It is a real `<button>`
 * with `aria-pressed`, announced as the control it is, and `tabIndex={-1}` so
 * tabbing still goes password → submit, the order a password manager expects.
 */
export function PasswordField({
  id,
  label,
  autoComplete,
  hint,
  error,
  value,
  onValueChange,
  ...props
}: Omit<React.ComponentProps<typeof AuthField>, "onChange" | "endSlot" | "type"> & {
  id: string;
  label: string;
  autoComplete: "current-password" | "new-password";
  value: string;
  onValueChange: (value: string) => void;
}) {
  const [visible, setVisible] = useState(false);
  const [capsLock, setCapsLock] = useState(false);

  return (
    <AuthField
      {...props}
      id={id}
      label={label}
      type={visible ? "text" : "password"}
      autoComplete={autoComplete}
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
      onKeyUp={(event) => setCapsLock(event.getModifierState?.("CapsLock") ?? false)}
      onKeyDown={(event) =>
        setCapsLock(event.getModifierState?.("CapsLock") ?? false)
      }
      onBlur={() => setCapsLock(false)}
      error={error}
      hint={
        capsLock ? (
          <span className="text-gold">Caps Lock jest włączony.</span>
        ) : (
          hint
        )
      }
      endSlot={
        <button
          type="button"
          tabIndex={-1}
          aria-pressed={visible}
          aria-label={visible ? "Ukryj hasło" : "Pokaż hasło"}
          onClick={() => setVisible((previous) => !previous)}
          className="flex size-9 items-center justify-center rounded-lg text-muted2 transition-colors outline-none hover:text-main focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          {visible ? (
            <EyeOff className="size-4" aria-hidden />
          ) : (
            <Eye className="size-4" aria-hidden />
          )}
        </button>
      }
    />
  );
}
