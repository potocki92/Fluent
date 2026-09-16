"use client";

import Link from "next/link";
import { Library, NotebookPen, Settings } from "lucide-react";

import { AccountMenu } from "@/components/auth/AccountMenu";
import { useAuthUser } from "@/components/auth/AuthProvider";
import { AdminNavLink } from "@/components/layout/AdminNavLink";
import { LevelSummary } from "@/components/level/LevelSummary";
import { isAccountUser } from "@/lib/auth/identity";

export function Header() {
  const user = useAuthUser();

  // The identity behind this is server-resolved (see the root layout), so this
  // branch is already correct in the first HTML — the private shortcuts are not
  // rendered and then withdrawn.
  const hasAccount = isAccountUser(user);

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-2xl items-center justify-between px-4">
        <Link href="/today" className="flex items-center gap-2">
          <span className="bg-gradient-to-r from-gold to-blue bg-clip-text text-lg font-bold tracking-tight text-transparent">
            Fluent
          </span>
          <span className="text-xs text-muted2">DE · PL</span>
        </Link>
        <div className="flex items-center gap-3">
          {hasAccount ? (
            <>
              <AdminNavLink />
              <LevelSummary size="header" />
            </>
          ) : null}
          {/* Dictionary moved off the bottom bar when Today took its place —
              still one tap away, just no longer one of the daily four. It is
              public content, so it stays visible to a visitor. */}
          <Link
            href="/browse"
            aria-label="Słownik"
            className="flex items-center text-muted2 transition-colors hover:text-main"
          >
            <Library className="size-5" />
          </Link>
          {/* The personal notebook and the settings are account screens: showing
              them to a signed-out visitor is offering a door that only leads to
              the sign-in form. */}
          {hasAccount ? (
            <>
              <Link
                href="/notebook"
                aria-label="Mój zeszyt"
                className="flex items-center text-muted2 transition-colors hover:text-main"
              >
                <NotebookPen className="size-5" />
              </Link>
              <Link
                href="/settings"
                aria-label="Ustawienia"
                className="flex items-center text-muted2 transition-colors hover:text-main"
              >
                <Settings className="size-5" />
              </Link>
            </>
          ) : null}
          <AccountMenu />
        </div>
      </div>
    </header>
  );
}
