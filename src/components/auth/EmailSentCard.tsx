"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, MailCheck } from "lucide-react";

import { AuthCard } from "@/components/auth/AuthCard";
import { AuthNotice } from "@/components/auth/AuthNotice";
import { Button } from "@/components/ui/button";
import type { AuthFailure } from "@/lib/auth/errors";

/** How long before "wyślij ponownie" is offered again (§26). */
const RESEND_COOLDOWN_SECONDS = 45;

/** Everything a "sprawdź skrzynkę" screen needs, raised by whichever flow sent. */
export interface EmailSent {
  title: string;
  description: string;
  /** The address the message actually went to, already normalised. */
  email: string;
  /** Sending again. Returns a failure to display, or `null` on success. */
  resend?: () => Promise<AuthFailure | null>;
  backLabel?: string;
}

/**
 * "Sprawdź skrzynkę" — a screen, not a line of green text under a form.
 *
 * Three flows end here: a registration awaiting confirmation, a magic link, and
 * a password reset. They differ in a sentence, so they share one component
 * (§75). What they all need is the same: the address the message went to (so a
 * typo is visible), a way to send it again, and a way back.
 *
 * The cooldown is not decoration. Supabase rate-limits auth emails, and a
 * learner who taps "wyślij ponownie" four times gets locked out of the very flow
 * they are trying to finish (§137).
 */
export function EmailSentCard({
  sent,
  onBack,
}: {
  sent: EmailSent;
  onBack: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<AuthFailure | null>(null);
  const [resent, setResent] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  const { resend } = sent;

  /**
   * The countdown, one second at a time.
   *
   * Seeded by the resend handler and decremented from a timeout callback, so
   * the number is right on the frame the button is pressed and the component
   * itself stays a pure function of its state — no clock read during render.
   */
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setTimeout(
      () => setCooldown((value) => value - 1),
      1000,
    );
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  const handleResend = useCallback(async () => {
    if (!resend || pending || cooldown > 0) return;
    setPending(true);
    setFailure(null);

    const result = await resend();

    setPending(false);
    if (result) {
      setFailure(result);
      return;
    }
    setResent(true);
    setCooldown(RESEND_COOLDOWN_SECONDS);
  }, [cooldown, pending, resend]);

  return (
    <AuthCard title={sent.title} description={sent.description}>
      <div className="space-y-4">
        <div className="flex items-start gap-3 rounded-xl border border-border bg-dark/40 px-3 py-3">
          <MailCheck className="mt-0.5 size-5 shrink-0 text-gold" aria-hidden />
          <div className="min-w-0">
            <p className="text-xs text-muted2">Wysłaliśmy wiadomość na</p>
            <p className="truncate text-sm font-semibold text-main">{sent.email}</p>
          </div>
        </div>

        {failure ? <AuthNotice>{failure.message}</AuthNotice> : null}
        {resent && !failure ? (
          <AuthNotice tone="success">Wysłaliśmy wiadomość ponownie.</AuthNotice>
        ) : null}

        <div className="space-y-2">
          {resend ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => void handleResend()}
              disabled={pending || cooldown > 0}
              aria-busy={pending}
              className="h-11 w-full rounded-xl disabled:opacity-70"
            >
              {pending ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                  Wysyłanie…
                </>
              ) : cooldown > 0 ? (
                `Wyślij ponownie za ${cooldown} s`
              ) : (
                "Wyślij ponownie"
              )}
            </Button>
          ) : null}

          <Button
            type="button"
            variant="ghost"
            onClick={onBack}
            className="h-11 w-full rounded-xl"
          >
            {sent.backLabel ?? "Wróć do logowania"}
          </Button>
        </div>

        <p className="text-xs text-muted2">
          Nie ma wiadomości? Sprawdź folder spam — czasem ląduje tam pierwszy list
          od nas.
        </p>
      </div>
    </AuthCard>
  );
}
