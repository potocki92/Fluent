"use client";

import { useCallback, useState } from "react";

import { AuthCard } from "@/components/auth/AuthCard";
import { EmailSentCard, type EmailSent } from "@/components/auth/EmailSentCard";
import { LoginForm } from "@/components/auth/LoginForm";
import { RegisterForm } from "@/components/auth/RegisterForm";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DEFAULT_SIGNED_IN_ROUTE } from "@/lib/auth/redirects";

export type AuthMode = "login" | "register";

/**
 * Where a brand-new account goes when nothing else was asked for.
 *
 * NOT `/today` (§71, §72). Today is a plan built from what a learner has already
 * done, and on day one that is nothing — the placement test is the screen that
 * turns a new account into a learner with a level, and every recommendation
 * after it depends on having one.
 */
const ONBOARDING_ROUTE = "/calibration";

const COPY: Record<AuthMode, { title: string; description: string }> = {
  login: {
    title: "Witaj ponownie",
    description: "Wróć do nauki dokładnie tam, gdzie skończyłeś.",
  },
  register: {
    title: "Zacznij uczyć się z Fluent",
    description:
      "Twoje książki, słowa i postępy zostaną zapisane na Twoim koncie.",
  },
};

/**
 * The login/registration surface.
 *
 * MODE LIVES IN THE URL (§48). `/auth?mode=register` is a real link that can be
 * shared and survives a refresh, and switching tabs keeps it true. The update
 * goes through `history.replaceState` rather than the router: the router would
 * round-trip to the server and re-render the card mid-typing, and the URL here
 * is a bookmark, not a navigation.
 *
 * THE EMAIL IS SHARED, THE PASSWORDS ARE NOT (§49). Somebody who typed their
 * address into the login form and then realised they need an account should not
 * type it again; nothing else crosses the boundary, and each form unmounts when
 * it loses the tab, so a stale error or a half-typed password cannot follow it
 * (§122).
 *
 * The "sprawdź skrzynkę" state lives HERE rather than inside the form that
 * triggered it, because it REPLACES the card — tabs and all. A success state
 * nested inside the form it succeeded at is how you end up with "Witaj ponownie"
 * above "wysłaliśmy link" (§75).
 */
export function AuthPanel({
  defaultMode,
  next,
}: {
  defaultMode: AuthMode;
  /** Sanitised on the server, or `null` when no destination was requested. */
  next: string | null;
}) {
  const [mode, setMode] = useState<AuthMode>(defaultMode);
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState<EmailSent | null>(null);

  const switchMode = useCallback((value: AuthMode) => {
    setMode(value);

    const url = new URL(window.location.href);
    if (value === "register") url.searchParams.set("mode", "register");
    else url.searchParams.delete("mode");
    window.history.replaceState(null, "", url);
  }, []);

  if (sent) {
    return (
      <EmailSentCard
        sent={sent}
        onBack={() => {
          setSent(null);
          switchMode("login");
        }}
      />
    );
  }

  const copy = COPY[mode];

  return (
    <AuthCard title={copy.title} description={copy.description}>
      <Tabs
        value={mode}
        onValueChange={(value) => switchMode(value as AuthMode)}
        className="gap-5"
      >
        <TabsList className="w-full">
          <TabsTrigger value="login">Logowanie</TabsTrigger>
          <TabsTrigger value="register">Rejestracja</TabsTrigger>
        </TabsList>

        <TabsContent value="login">
          <LoginForm
            email={email}
            onEmailChange={setEmail}
            next={next ?? DEFAULT_SIGNED_IN_ROUTE}
            onSwitchToRegister={() => switchMode("register")}
            onEmailSent={setSent}
          />
        </TabsContent>

        <TabsContent value="register">
          <RegisterForm
            email={email}
            onEmailChange={setEmail}
            next={next ?? ONBOARDING_ROUTE}
            onSwitchToLogin={() => switchMode("login")}
            onEmailSent={setSent}
          />
        </TabsContent>
      </Tabs>
    </AuthCard>
  );
}
