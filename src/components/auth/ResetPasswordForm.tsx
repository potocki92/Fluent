"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2 } from "lucide-react";

import { AuthCard } from "@/components/auth/AuthCard";
import { AuthNotice } from "@/components/auth/AuthNotice";
import { AuthSubmit } from "@/components/auth/AuthSubmit";
import { PasswordField } from "@/components/auth/PasswordField";
import { Button } from "@/components/ui/button";
import { describeAuthError, type AuthFailure } from "@/lib/auth/errors";
import {
  MIN_PASSWORD_LENGTH,
  confirmPasswordHint,
  hasErrors,
  validateNewPassword,
  type FieldErrors,
} from "@/lib/auth/form";
import { DEFAULT_SIGNED_IN_ROUTE } from "@/lib/auth/redirects";
import { createClientSupabaseClient } from "@/lib/supabase/client";

/**
 * Setting a new password from a recovery link.
 *
 * HOW THE SESSION GOT HERE. Supabase's current flow for a server-rendered app is
 * PKCE: the recovery email links back to `/auth/callback`, that route exchanges
 * the one-time code for a real session and writes the auth cookies, and only
 * then does this screen render. So by the time this form exists the learner IS
 * authenticated — `updateUser` needs nothing but the new password, and this
 * component never sees a token.
 *
 * The page above it establishes that the session exists (server-side). If it
 * does not — an expired link, a link opened in a different browser than the one
 * that requested it — the learner gets the "link wygasł" screen instead of this
 * form failing on submit.
 */
export function ResetPasswordForm() {
  const router = useRouter();

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState<AuthFailure | null>(null);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;

    const errors = validateNewPassword(password, confirmPassword);
    setFieldErrors(errors);
    setFailure(null);
    if (hasErrors(errors)) return;

    setPending(true);
    const supabase = createClientSupabaseClient();
    const { error } = await supabase.auth.updateUser({ password });

    setPending(false);

    if (error) {
      setFailure(describeAuthError(error));
      return;
    }

    // Nothing keeps a password around after it has been used (§121).
    setPassword("");
    setConfirmPassword("");
    setDone(true);
    router.refresh();
  }

  if (done) {
    return (
      <AuthCard
        title="Hasło zostało zmienione"
        description="Jesteś zalogowany — możesz wrócić do nauki."
      >
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-xl border border-green/30 bg-green/10 px-3 py-3 text-sm text-green">
            <CheckCircle2 className="mt-0.5 size-5 shrink-0" aria-hidden />
            <span>Od teraz loguj się nowym hasłem.</span>
          </div>
          <Button
            asChild
            className="h-11 w-full rounded-xl bg-gold text-base font-semibold text-dark hover:bg-gold-dark"
          >
            <Link href={DEFAULT_SIGNED_IN_ROUTE}>Przejdź do nauki</Link>
          </Button>
        </div>
      </AuthCard>
    );
  }

  const matchHint = confirmPasswordHint(password, confirmPassword);

  return (
    <AuthCard
      title="Ustaw nowe hasło"
      description="Wpisz hasło, którego będziesz używać od teraz."
    >
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        {failure ? <AuthNotice>{failure.message}</AuthNotice> : null}

        <PasswordField
          id="reset-password"
          label="Nowe hasło"
          autoComplete="new-password"
          placeholder="Wymyśl hasło"
          hint={`Minimum ${MIN_PASSWORD_LENGTH} znaków.`}
          value={password}
          onValueChange={setPassword}
          error={fieldErrors.password}
          disabled={pending}
        />

        <PasswordField
          id="reset-confirm"
          label="Powtórz hasło"
          autoComplete="new-password"
          placeholder="To samo hasło"
          value={confirmPassword}
          onValueChange={setConfirmPassword}
          error={fieldErrors.confirmPassword ?? matchHint ?? undefined}
          disabled={pending}
        />

        <AuthSubmit pending={pending} pendingLabel="Zapisywanie…">
          Ustaw nowe hasło
        </AuthSubmit>
      </form>
    </AuthCard>
  );
}
