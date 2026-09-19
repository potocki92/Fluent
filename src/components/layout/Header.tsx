"use client";

import Link from "next/link";
import { Library, NotebookPen, Settings } from "lucide-react";

import { AccountMenu } from "@/components/auth/AccountMenu";
import { useAuthUser } from "@/components/auth/AuthProvider";
import { FluentLogo } from "@/components/brand/FluentLogo";
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
        {/* The symbol and the name are one target, and one link to Today. The
            lockup stacks the tag line under the name, which makes it narrower
            than the wordmark-plus-tag-line row it replaces — so the controls on
            the right keep their width down to 320px and nothing has to be
            hidden at a breakpoint any more. */}
        <Link
          href="/today"
          className="flex shrink-0 items-center rounded-sm outline-ring/50 focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          <FluentLogo priority />
        </Link>
        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
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
