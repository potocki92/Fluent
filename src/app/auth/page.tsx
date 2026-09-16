import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AuthNotice } from "@/components/auth/AuthNotice";
import { AuthPanel, type AuthMode } from "@/components/auth/AuthPanel";
import { authErrorMessage, isAuthErrorCode } from "@/lib/auth/errors";
import { resolveSignedInDestination, sanitizeAuthRedirect } from "@/lib/auth/redirects";
import { getAccountUser } from "@/lib/auth/server";

type AuthSearchParams = Promise<{
  mode?: string;
  next?: string;
  error?: string;
}>;

export async function generateMetadata({
  searchParams,
}: {
  searchParams: AuthSearchParams;
}): Promise<Metadata> {
  const { mode } = await searchParams;

  return mode === "register"
    ? {
        title: "Załóż konto · Fluent",
        description:
          "Załóż darmowe konto Fluent i ucz się niemieckiego z prawdziwych historii.",
      }
    : {
        title: "Zaloguj się · Fluent",
        description:
          "Zaloguj się do Fluent i wróć do nauki niemieckiego tam, gdzie skończyłeś.",
      };
}

/**
 * `/auth` — the sign-in and sign-up screen.
 *
 * A SERVER COMPONENT THAT DECIDES BEFORE IT RENDERS (§10, §80). A signed-in
 * learner is redirected here, on the server, so the login form is never painted
 * for somebody who does not need it. The proxy already does this for the same
 * request; keeping the check is what makes the guarantee independent of the
 * matcher configuration rather than contingent on it.
 *
 * `next` is sanitised HERE and the sanitised value is what the forms receive.
 * No client component in this tree ever reads the raw parameter (§9, §23).
 */
export default async function AuthPage({
  searchParams,
}: {
  searchParams: AuthSearchParams;
}) {
  const { mode, next, error } = await searchParams;

  if (await getAccountUser()) redirect(resolveSignedInDestination(next));

  const defaultMode: AuthMode = mode === "register" ? "register" : "login";
  // Only a code from our own taxonomy renders — the URL cannot put arbitrary
  // text on the sign-in screen.
  const notice = isAuthErrorCode(error) ? authErrorMessage(error) : null;

  return (
    <div className="space-y-3">
      {notice ? <AuthNotice>{notice}</AuthNotice> : null}
      <AuthPanel defaultMode={defaultMode} next={sanitizeAuthRedirect(next)} />
    </div>
  );
}
