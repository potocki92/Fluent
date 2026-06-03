"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { createClientSupabaseClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type Mode = "login" | "register";

const MIN_PASSWORD = 8;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Tłumaczy najczęstsze komunikaty Supabase Auth na polski. */
function translateAuthError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("invalid login credentials"))
    return "Nieprawidłowy e-mail lub hasło.";
  if (m.includes("already registered") || m.includes("already been registered"))
    return "Konto z tym adresem e-mail już istnieje.";
  if (m.includes("email not confirmed"))
    return "Potwierdź adres e-mail, aby się zalogować.";
  if (m.includes("password should be at least"))
    return `Hasło musi mieć co najmniej ${MIN_PASSWORD} znaków.`;
  if (m.includes("rate limit") || m.includes("too many"))
    return "Zbyt wiele prób. Spróbuj ponownie za chwilę.";
  return message;
}

export function AuthForm({ defaultMode = "login" }: { defaultMode?: Mode }) {
  const supabase = createClientSupabaseClient();
  const router = useRouter();

  const [mode, setMode] = useState<Mode>(defaultMode);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [name, setName] = useState("");
  const [terms, setTerms] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Zalogowanego użytkownika kierujemy od razu do aplikacji.
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user && !data.user.is_anonymous) router.replace("/learn");
    });
  }, [supabase, router]);

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
    setInfo(null);
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);

    if (!EMAIL_RE.test(email)) {
      setError("Podaj poprawny adres e-mail.");
      return;
    }
    if (!password) {
      setError("Podaj hasło.");
      return;
    }

    setLoading(true);
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    setLoading(false);

    if (signInError) {
      setError(translateAuthError(signInError.message));
      return;
    }
    router.push("/learn");
    router.refresh();
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);

    if (!EMAIL_RE.test(email)) {
      setError("Podaj poprawny adres e-mail.");
      return;
    }
    if (password.length < MIN_PASSWORD) {
      setError(`Hasło musi mieć co najmniej ${MIN_PASSWORD} znaków.`);
      return;
    }
    if (password !== confirm) {
      setError("Hasła nie są takie same.");
      return;
    }
    if (!terms) {
      setError("Zaakceptuj regulamin, aby założyć konto.");
      return;
    }

    setLoading(true);
    const trimmedName = name.trim();
    const { data, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
        data: trimmedName ? { name: trimmedName } : undefined,
      },
    });
    setLoading(false);

    if (signUpError) {
      setError(translateAuthError(signUpError.message));
      return;
    }

    // Gdy potwierdzanie e-maila jest włączone, sesja jest pusta.
    if (data.session) {
      router.push("/learn");
      router.refresh();
      return;
    }
    setInfo("Sprawdź skrzynkę e-mail, aby potwierdzić konto.");
  }

  async function handleMagicLink() {
    setError(null);
    setInfo(null);

    if (!EMAIL_RE.test(email)) {
      setError("Podaj poprawny adres e-mail, aby otrzymać magiczny link.");
      return;
    }

    setLoading(true);
    const { error: otpError } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    setLoading(false);

    if (otpError) {
      setError(translateAuthError(otpError.message));
      return;
    }
    setInfo(`Sprawdź skrzynkę — wysłaliśmy link logowania na ${email}.`);
  }

  return (
    <Tabs
      value={mode}
      onValueChange={(value) => switchMode(value as Mode)}
      className="gap-6"
    >
      <TabsList className="w-full">
        <TabsTrigger value="login">Logowanie</TabsTrigger>
        <TabsTrigger value="register">Rejestracja</TabsTrigger>
      </TabsList>

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      {info ? <p className="text-sm text-green">{info}</p> : null}

      <TabsContent value="login">
        <form onSubmit={handleLogin} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="login-email" className="text-sm font-medium">
              E-mail
            </label>
            <Input
              id="login-email"
              type="email"
              autoComplete="email"
              placeholder="ty@przyklad.pl"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="login-password" className="text-sm font-medium">
              Hasło
            </label>
            <Input
              id="login-password"
              type="password"
              autoComplete="current-password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          <Button
            type="submit"
            disabled={loading}
            className="w-full bg-gold text-[#1a202c] hover:bg-gold-dark"
          >
            {loading ? <Loader2 className="size-4 animate-spin" /> : null}
            Zaloguj się
          </Button>

          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="h-px flex-1 bg-border" />
            lub
            <span className="h-px flex-1 bg-border" />
          </div>

          <Button
            type="button"
            variant="outline"
            disabled={loading}
            onClick={handleMagicLink}
            className="w-full"
          >
            Wyślij magiczny link
          </Button>

          <p className="text-center text-sm text-muted-foreground">
            Nie masz konta?{" "}
            <button
              type="button"
              onClick={() => switchMode("register")}
              className="font-medium text-gold hover:underline"
            >
              Zarejestruj się
            </button>
          </p>
        </form>
      </TabsContent>

      <TabsContent value="register">
        <form onSubmit={handleRegister} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="register-email" className="text-sm font-medium">
              E-mail
            </label>
            <Input
              id="register-email"
              type="email"
              autoComplete="email"
              placeholder="ty@przyklad.pl"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="register-name" className="text-sm font-medium">
              Nazwa użytkownika{" "}
              <span className="text-muted-foreground">(opcjonalnie)</span>
            </label>
            <Input
              id="register-name"
              type="text"
              autoComplete="nickname"
              placeholder="np. Mateusz"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="register-password" className="text-sm font-medium">
              Hasło
            </label>
            <Input
              id="register-password"
              type="password"
              autoComplete="new-password"
              placeholder="Min. 8 znaków"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="register-confirm" className="text-sm font-medium">
              Powtórz hasło
            </label>
            <Input
              id="register-confirm"
              type="password"
              autoComplete="new-password"
              placeholder="••••••••"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </div>

          <label
            htmlFor="register-terms"
            className="flex items-start gap-2 text-sm text-muted-foreground"
          >
            <Checkbox
              id="register-terms"
              checked={terms}
              onCheckedChange={(value) => setTerms(value === true)}
              className="mt-0.5"
            />
            <span>
              Akceptuję regulamin i politykę prywatności Fluent.
            </span>
          </label>

          <Button
            type="submit"
            disabled={loading}
            className="w-full bg-gold text-[#1a202c] hover:bg-gold-dark"
          >
            {loading ? <Loader2 className="size-4 animate-spin" /> : null}
            Załóż konto
          </Button>

          <p className="text-center text-sm text-muted-foreground">
            Masz już konto?{" "}
            <button
              type="button"
              onClick={() => switchMode("login")}
              className="font-medium text-gold hover:underline"
            >
              Zaloguj się
            </button>
          </p>
        </form>
      </TabsContent>
    </Tabs>
  );
}
