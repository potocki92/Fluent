"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Wand2 } from "lucide-react";

import { AuthField } from "@/components/auth/AuthField";
import { AuthNotice } from "@/components/auth/AuthNotice";
import { AuthSubmit } from "@/components/auth/AuthSubmit";
import type { EmailSent } from "@/components/auth/EmailSentCard";
import { PasswordField } from "@/components/auth/PasswordField";
import { Button } from "@/components/ui/button";
import { describeAuthError, type AuthFailure } from "@/lib/auth/errors";
import {
  hasErrors,
  isValidEmail,
  normalizeEmail,
  validateCredentials,
  type FieldErrors,
} from "@/lib/auth/form";
import { createClientSupabaseClient } from "@/lib/supabase/client";

/**
 * Signing in.
 *
 * The flow after a successful call is the important part:
 *
 *   session established → `SIGNED_IN` reaches `AuthProvider`, which swaps in a
 *   fresh QueryClient and resets the user-scoped stores → `router.replace(next)`
 *   → the server re-renders the destination for the identity that now exists.
 *
 * So the first thing the new learner sees is fetched for them. There is no
 * moment where the previous account's cache is still in memory under the new
 * name (§13, §94).
 *
 * `next` arrives already sanitised from the server component — this file does
 * not parse it and must not.
 */
export function LoginForm({
  email,
  onEmailChange,
  next,
  onSwitchToRegister,
  onEmailSent,
}: {
  email: string;
  onEmailChange: (value: string) => void;
  next: string;
  onSwitchToRegister: () => void;
  /** Raises the "sprawdź skrzynkę" screen, which replaces this whole card. */
  onEmailSent: (sent: EmailSent) => void;
}) {
  const router = useRouter();

  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState<AuthFailure | null>(null);
  const [pending, setPending] = useState(false);
  const [magicLinkPending, setMagicLinkPending] = useState(false);

  const busy = pending || magicLinkPending;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    // Double-submit guard (§50, §109). The button is disabled too, but a form
    // can also be submitted with Return, and the two can race.
    if (busy) return;

    const errors = validateCredentials({ email, password });
    setFieldErrors(errors);
    setFailure(null);
    if (hasErrors(errors)) return;

    setPending(true);
    const supabase = createClientSupabaseClient();
    const { error } = await supabase.auth.signInWithPassword({
      email: normalizeEmail(email),
      password,
    });

    if (error) {
      setPending(false);
      setFailure(describeAuthError(error));
      return;
    }

    // The password is dropped the moment it is no longer needed; nothing else in
    // this app ever holds one (§60, §121).
    setPassword("");
    router.replace(next);
    router.refresh();
  }

  async function sendMagicLink(address: string): Promise<AuthFailure | null> {
    const supabase = createClientSupabaseClient();
    const { error } = await supabase.auth.signInWithOtp({
      email: address,
      options: { emailRedirectTo: magicLinkRedirect(next) },
    });
    return describeAuthError(error);
  }

  async function handleMagicLink() {
    if (busy) return;

    if (!isValidEmail(email)) {
      setFieldErrors({ email: "Podaj adres e-mail, żeby dostać link." });
      setFailure(null);
      return;
    }

    setFieldErrors({});
    setFailure(null);
    setMagicLinkPending(true);

    const address = normalizeEmail(email);
    const result = await sendMagicLink(address);

    setMagicLinkPending(false);
    if (result) {
      setFailure(result);
      return;
    }

    onEmailSent({
      title: "Link jest w drodze",
      description:
        "Otwórz wiadomość na tym urządzeniu — link zaloguje Cię bez hasła.",
      email: address,
      resend: () => sendMagicLink(address),
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      {failure ? <AuthNotice>{failure.message}</AuthNotice> : null}

      <AuthField
        id="login-email"
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
        disabled={busy}
      />

      <PasswordField
        id="login-password"
        label="Hasło"
        autoComplete="current-password"
        placeholder="Twoje hasło"
        value={password}
        onValueChange={setPassword}
        error={fieldErrors.password}
        disabled={busy}
      />

      <div className="flex justify-end">
        <Link
          href="/auth/forgot-password"
          className="text-sm font-medium text-gold underline-offset-4 hover:underline"
        >
          Nie pamiętasz hasła?
        </Link>
      </div>

      <AuthSubmit pending={pending} pendingLabel="Logowanie…">
        Zaloguj się
      </AuthSubmit>

      {/* Magic link stays, as a SECONDARY method (§35). It is genuinely useful
          on a phone where typing a password is the slow part, and it is the
          fallback for somebody whose password manager is on another device —
          but it does not get to dominate the screen. */}
      <div className="flex items-center gap-3 text-xs text-muted2">
        <span className="h-px flex-1 bg-border" />
        lub
        <span className="h-px flex-1 bg-border" />
      </div>

      <Button
        type="button"
        variant="outline"
        onClick={() => void handleMagicLink()}
        disabled={busy}
        aria-busy={magicLinkPending}
        className="h-11 w-full rounded-xl disabled:opacity-70"
      >
        {magicLinkPending ? (
          <>
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Wysyłanie…
          </>
        ) : (
          <>
            <Wand2 aria-hidden />
            Wyślij link logowania
          </>
        )}
      </Button>

      <p className="text-center text-sm text-muted2">
        Nie masz konta?{" "}
        <button
          type="button"
          onClick={onSwitchToRegister}
          className="font-medium text-gold underline-offset-4 hover:underline"
        >
          Załóż je w minutę
        </button>
      </p>
    </form>
  );
}

/**
 * Where the emailed link comes back to. The destination rides along as `next`
 * and is re-sanitised by the callback before it is used — this side of the
 * round trip is not trusted either.
 */
function magicLinkRedirect(next: string): string {
  const url = new URL("/auth/callback", window.location.origin);
  url.searchParams.set("next", next);
  return url.toString();
}
