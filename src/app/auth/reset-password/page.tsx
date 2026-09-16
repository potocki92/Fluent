import type { Metadata } from "next";
import Link from "next/link";

import { AuthCard } from "@/components/auth/AuthCard";
import { ResetPasswordForm } from "@/components/auth/ResetPasswordForm";
import { Button } from "@/components/ui/button";
import { getCurrentUser } from "@/lib/auth/server";

export const metadata: Metadata = {
  title: "Nowe hasło · Fluent",
  description: "Ustaw nowe hasło do swojego konta Fluent.",
};

/**
 * `/auth/reset-password` — the second half of password recovery.
 *
 * Reaching this screen means `/auth/callback` already turned the emailed
 * one-time code into a real session, so the question this page asks is simply
 * "is there a session?". If there is not, the link was expired, already used, or
 * opened in a different browser than the one that asked for it — and the learner
 * is told that here rather than discovering it when the form fails to submit
 * (§33, §149).
 */
export default async function ResetPasswordPage() {
  const user = await getCurrentUser();

  if (!user) {
    return (
      <AuthCard
        title="Link wygasł"
        description="Ten link do zmiany hasła jest już nieaktywny albo został otwarty w innej przeglądarce."
      >
        <div className="space-y-3">
          <Button
            asChild
            className="h-11 w-full rounded-xl bg-gold text-base font-semibold text-dark hover:bg-gold-dark"
          >
            <Link href="/auth/forgot-password">Wyślij nowy link</Link>
          </Button>
          <Button asChild variant="ghost" className="h-11 w-full rounded-xl">
            <Link href="/auth">Wróć do logowania</Link>
          </Button>
        </div>
      </AuthCard>
    );
  }

  return <ResetPasswordForm />;
}
