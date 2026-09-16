import type { Metadata } from "next";

import { AuthNotice } from "@/components/auth/AuthNotice";
import { ForgotPasswordForm } from "@/components/auth/ForgotPasswordForm";
import { authErrorMessage, isAuthErrorCode } from "@/lib/auth/errors";

export const metadata: Metadata = {
  title: "Nie pamiętasz hasła? · Fluent",
  description: "Wyślij sobie link do ustawienia nowego hasła w Fluent.",
};

/**
 * `/auth/forgot-password` — where an expired recovery link also lands.
 *
 * That second job is the reason the error notice is here: "Link wygasł lub
 * został już użyty" is only useful directly above the control that sends a new
 * one (§74).
 */
export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const notice = isAuthErrorCode(error) ? authErrorMessage(error) : null;

  return (
    <div className="space-y-3">
      {notice ? <AuthNotice>{notice}</AuthNotice> : null}
      <ForgotPasswordForm />
    </div>
  );
}
