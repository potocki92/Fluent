"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { User } from "@supabase/supabase-js";
import { LogOut } from "lucide-react";

import { createClientSupabaseClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

export function AuthButton() {
  const supabase = createClientSupabaseClient();
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data.user));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, [supabase]);

  const isAnonymous = user?.is_anonymous ?? false;
  const isEmailUser = !!user && !isAnonymous;

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
    <div className="flex items-center gap-2">
      <Button size="sm" variant="ghost" asChild className="hidden sm:inline-flex">
        <Link href="/auth">Zaloguj się</Link>
      </Button>
      <Button
        size="sm"
        asChild
        className="bg-gold text-[#1a202c] hover:bg-gold-dark"
      >
        <Link href="/auth?mode=register">Załóż konto</Link>
      </Button>
    </div>
  );
}
