"use client";

import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { LogOut, Mail } from "lucide-react";

import { createClientSupabaseClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export function AuthButton() {
  const supabase = createClientSupabaseClient();
  const [user, setUser] = useState<User | null>(null);
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data.user));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, [supabase]);

  const isAnonymous = user?.is_anonymous ?? false;
  const isEmailUser = !!user && !isAnonymous;

  async function sendMagicLink(e: React.FormEvent) {
    e.preventDefault();
    if (!email) return;
    await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    setSent(true);
  }

  async function signOut() {
    await supabase.auth.signOut();
    setUser(null);
  }

  if (isEmailUser) {
    const initial =
      user?.user_metadata?.name?.[0] ?? user?.email?.[0] ?? "U";
    return (
      <div className="flex items-center gap-2">
        <span className="flex size-8 items-center justify-center rounded-full bg-gold text-sm font-semibold text-[#1a202c] uppercase">
          {initial}
        </span>
        <Button size="sm" variant="ghost" onClick={signOut}>
          <LogOut className="size-4" />
          Wyloguj
        </Button>
      </div>
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          size="sm"
          className="bg-gold text-[#1a202c] hover:bg-gold-dark"
        >
          <Mail className="size-4" />
          {isAnonymous ? "Zapisz postęp" : "Zaloguj się (e-mail)"}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {isAnonymous ? "Zapisz swój postęp" : "Zaloguj się"}
          </DialogTitle>
          <DialogDescription>
            {isAnonymous
              ? "Podaj e-mail, aby powiązać dotychczasowe postępy ze swoim kontem."
              : "Wyślemy magiczny link na Twój adres e-mail."}
          </DialogDescription>
        </DialogHeader>

        {sent ? (
          <p className="py-4 text-sm text-green">
            Sprawdź skrzynkę — wysłaliśmy link logowania na {email}.
          </p>
        ) : (
          <form onSubmit={sendMagicLink} className="space-y-4">
            <Input
              type="email"
              required
              placeholder="ty@przyklad.pl"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <DialogFooter>
              <Button
                type="submit"
                className="w-full bg-gold text-[#1a202c] hover:bg-gold-dark"
              >
                Wyślij magiczny link
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
