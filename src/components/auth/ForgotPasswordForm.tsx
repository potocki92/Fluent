"use client";

import { useState } from "react";
import Link from "next/link";

import { AuthCard } from "@/components/auth/AuthCard";
import { AuthField } from "@/components/auth/AuthField";
import { AuthNotice } from "@/components/auth/AuthNotice";
import { AuthSubmit } from "@/components/auth/AuthSubmit";
import { EmailSentCard, type EmailSent } from "@/components/auth/EmailSentCard";
import { describeAuthError, type AuthFailure } from "@/lib/auth/errors";
import { isValidEmail, normalizeEmail } from "@/lib/auth/form";
import { createClientSupabaseClient } from "@/lib/supabase/client";

/**
 * "Nie pamiętasz hasła?"
 *
 * NO ACCOUNT ENUMERATION (§54, §106). Whether or not the address belongs to an
 * account, this screen says the same thing: "jeśli konto istnieje, wysłaliśmy
 * wiadomość". Supabase behaves the same way — `resetPasswordForEmail` succeeds
 * for an unknown address on purpose — and the UI must not undo that by rendering
 * a different outcome for the two cases.
 *
 * The only failures worth showing are the ones that say nothing about the
 * account: rate limiting, a network failure, a provider outage. Anything else
 * still lands on the neutral success screen.
 */
export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [failure, setFailure] = useState<AuthFailure | null>(null);
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState<EmailSent | null>(null);

  async function requestReset(address: string): Promise<AuthFailure | null> {
    const supabase = createClientSupabaseClient();
    const { error } = await supabase.auth.resetPasswordForEmail(address, {
      redirectTo: recoveryRedirect(),
    });
    return describeAuthError(error);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;

    if (!isValidEmail(email)) {
      setFieldError("Podaj adres e-mail powiązany z Twoim kontem.");
      setFailure(null);
      return;
    }

    setFieldError(null);
    setFailure(null);
    setPending(true);

    const address = normalizeEmail(email);
    const result = await requestReset(address);

    setPending(false);

    // A failure that would reveal whether the account exists is swallowed; only
    // the account-agnostic ones are shown.
    if (result && isSafeToShow(result)) {
      setFailure(result);
      return;
    }

    setSent({
      title: "Sprawdź skrzynkę",
      description:
        "Jeśli konto z tym adresem istnieje, wysłaliśmy link do ustawienia nowego hasła.",
      email: address,
      resend: () => requestReset(address),
    });
  }

  if (sent) {
    return <EmailSentCard sent={sent} onBack={() => setSent(null)} />;
  }

  return (
    <AuthCard
      title="Ustaw nowe hasło"
      description="Podaj adres e-mail, a wyślemy Ci link do zmiany hasła."
    >
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        {failure ? <AuthNotice>{failure.message}</AuthNotice> : null}

        <AuthField
          id="forgot-email"
          label="E-mail"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder="ty@przyklad.pl"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          error={fieldError}
          disabled={pending}
        />

        <AuthSubmit pending={pending} pendingLabel="Wysyłanie…">
          Wyślij link
        </AuthSubmit>

        <p className="text-center text-sm text-muted2">
          <Link
            href="/auth"
            className="font-medium text-gold underline-offset-4 hover:underline"
          >
            Wróć do logowania
          </Link>
        </p>
      </form>
    </AuthCard>
  );
}

/** Failures that are true of the request, not of the account behind the address. */
function isSafeToShow(failure: AuthFailure): boolean {
  return (
    failure.code === "rate_limited" ||
    failure.code === "network" ||
    failure.code === "provider_error"
  );
}

/**
 * Where the recovery link lands.
 *
 * `flow=recovery` rather than `next=/auth/reset-password`: the destination is
 * inside `/auth`, which the redirect sanitiser refuses on purpose, and a flow
 * marker is the honest way to say "this is a recovery" without asking the
 * callback to trust a path off the URL.
 */
function recoveryRedirect(): string {
  const url = new URL("/auth/callback", window.location.origin);
  url.searchParams.set("flow", "recovery");
  return url.toString();
}
