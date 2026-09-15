"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { AuthField } from "@/components/auth/AuthField";
import { AuthNotice } from "@/components/auth/AuthNotice";
import { AuthSubmit } from "@/components/auth/AuthSubmit";
import type { EmailSent } from "@/components/auth/EmailSentCard";
import { PasswordField } from "@/components/auth/PasswordField";
import { Checkbox } from "@/components/ui/checkbox";
import { describeAuthError, type AuthFailure } from "@/lib/auth/errors";
import {
  MIN_PASSWORD_LENGTH,
  confirmPasswordHint,
  hasErrors,
  normalizeDisplayName,
  normalizeEmail,
  validateRegistration,
  type FieldErrors,
} from "@/lib/auth/form";
import { createClientSupabaseClient } from "@/lib/supabase/client";

/**
 * Creating an account.
 *
 * BOTH SUPABASE CONFIGURATIONS ARE HANDLED (§25). Whether "Confirm email" is on
 * is a project setting this code cannot see, and it is not a detail worth
 * guessing at: `signUp` either returns a session (confirmation off — the learner
 * is in, and goes straight to the placement test) or it does not (confirmation
 * on — the learner gets the "sprawdź skrzynkę" screen with a resend). The branch
 * is one `if` on `data.session`.
 *
 * NO PROFILE IS CREATED HERE. `handle_new_user()` — an `AFTER INSERT` trigger on
 * `auth.users` — does that, inside the same transaction as the sign-up, using
 * the `name` passed below. A second, client-side insert would race it and could
 * only ever produce a duplicate or a permission error (§21).
 */
export function RegisterForm({
  email,
  onEmailChange,
  next,
  onSwitchToLogin,
  onEmailSent,
}: {
  email: string;
  onEmailChange: (value: string) => void;
  /** Where a learner lands once the account exists and a session is live. */
  next: string;
  onSwitchToLogin: () => void;
  /** Raises the "sprawdź skrzynkę" screen, which replaces this whole card. */
  onEmailSent: (sent: EmailSent) => void;
}) {
  const router = useRouter();

  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [acceptedTerms, setAcceptedTerms] = useState(false);

  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState<AuthFailure | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;

    const errors = validateRegistration({
      email,
      password,
      confirmPassword,
      acceptedTerms,
    });
    setFieldErrors(errors);
    setFailure(null);
    if (hasErrors(errors)) return;

    setPending(true);

    const address = normalizeEmail(email);
    const displayName = normalizeDisplayName(name);
    const supabase = createClientSupabaseClient();

    const { data, error } = await supabase.auth.signUp({
      email: address,
      password,
      options: {
        emailRedirectTo: confirmationRedirect(next),
        data: displayName ? { name: displayName } : undefined,
      },
    });

    if (error) {
      setPending(false);
      setFailure(describeAuthError(error));
      return;
    }

    setPassword("");
    setConfirmPassword("");

    if (data.session) {
      // Confirmation is disabled on this project: the learner is signed in
      // already. `AuthProvider` has the fresh cache; go start the placement test.
      router.replace(next);
      router.refresh();
      return;
    }

    setPending(false);
    onEmailSent({
      title: "Sprawdź skrzynkę",
      description:
        "Kliknij link potwierdzający, a Twoje konto Fluent będzie gotowe.",
      email: address,
      resend: () => resendConfirmation(address),
    });
  }

  async function resendConfirmation(address: string): Promise<AuthFailure | null> {
    const supabase = createClientSupabaseClient();
    const { error } = await supabase.auth.resend({
      type: "signup",
      email: address,
      options: { emailRedirectTo: confirmationRedirect(next) },
    });
    return describeAuthError(error);
  }

  const matchHint = confirmPasswordHint(password, confirmPassword);

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      {failure ? <AuthNotice>{failure.message}</AuthNotice> : null}

      {/* NOT "nazwa użytkownika" (§126): it is not unique, you never log in with
          it, and calling it a username promises a system Fluent does not have. */}
      <AuthField
        id="register-name"
        label="Imię"
        type="text"
        autoComplete="given-name"
        placeholder="np. Mateusz"
        hint="Tak będziemy się do Ciebie zwracać. Możesz pominąć."
        value={name}
        onChange={(event) => setName(event.target.value)}
        disabled={pending}
      />

      <AuthField
        id="register-email"
        label="E-mail"
        type="email"
        inputMode="email"
        autoComplete="email"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        placeholder="ty@przyklad.pl"
        value={email}
        onChange={(event) => onEmailChange(event.target.value)}
        error={fieldErrors.email}
        disabled={pending}
      />

      <PasswordField
        id="register-password"
        label="Hasło"
        autoComplete="new-password"
        placeholder="Wymyśl hasło"
        hint={`Minimum ${MIN_PASSWORD_LENGTH} znaków.`}
        value={password}
        onValueChange={setPassword}
        error={fieldErrors.password}
        disabled={pending}
      />

      <PasswordField
        id="register-confirm"
        label="Powtórz hasło"
        autoComplete="new-password"
        placeholder="To samo hasło"
        value={confirmPassword}
        onValueChange={setConfirmPassword}
        error={fieldErrors.confirmPassword ?? matchHint ?? undefined}
        disabled={pending}
      />

      <div className="space-y-1.5">
        <label
          htmlFor="register-terms"
          className="flex items-start gap-2.5 text-sm text-muted2"
        >
          <Checkbox
            id="register-terms"
            checked={acceptedTerms}
            onCheckedChange={(value) => setAcceptedTerms(value === true)}
            aria-describedby={fieldErrors.terms ? "register-terms-error" : undefined}
            aria-invalid={fieldErrors.terms ? true : undefined}
            disabled={pending}
            className="mt-0.5"
          />
          {/* No links: Fluent does not publish a regulamin or a polityka
              prywatności yet, and inventing two dead URLs is worse than saying
              plainly what the box means (§124). */}
          <span className="text-pretty">
            Akceptuję warunki korzystania z Fluent i zgadzam się na przechowywanie
            moich postępów w nauce.
          </span>
        </label>
        {fieldErrors.terms ? (
          <p id="register-terms-error" className="text-xs font-medium text-red">
            {fieldErrors.terms}
          </p>
        ) : null}
      </div>

      <AuthSubmit pending={pending} pendingLabel="Zakładanie konta…">
        Załóż konto
      </AuthSubmit>

      <p className="text-center text-sm text-muted2">
        Masz już konto?{" "}
        <button
          type="button"
          onClick={onSwitchToLogin}
          className="font-medium text-gold underline-offset-4 hover:underline"
        >
          Zaloguj się
        </button>
      </p>
    </form>
  );
}

/** Where the confirmation link returns to, carrying the destination with it. */
function confirmationRedirect(next: string): string {
  const url = new URL("/auth/callback", window.location.origin);
  url.searchParams.set("next", next);
  return url.toString();
}
