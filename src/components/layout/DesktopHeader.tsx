"use client";

import Link from "next/link";

import { AccountMenu } from "@/components/auth/AccountMenu";
import { useAuthUser } from "@/components/auth/AuthProvider";
import { FluentLogo } from "@/components/brand/FluentLogo";
import { MainNavigation } from "@/components/layout/MainNavigation";
import { DICTIONARY } from "@/components/layout/navigation";
import { LevelChip } from "@/components/level/LevelChip";
import { isAccountUser } from "@/lib/auth/identity";

/**
 * The desktop bar: logo · four sections · słownik · poziom · konto.
 *
 * WHAT CAME OUT OF IT. This header used to carry six controls on the right, four
 * of them bare icons: a shield, a notebook, a cog, a library and a 52px progress
 * ring, all competing with a navigation that did not exist. The rule now is that
 * the top bar holds only what a learner reaches for on a normal day — the four
 * sections, the dictionary, their level, their account. Settings, the notebook
 * and the admin panel moved one click away, into the account menu, because that
 * is where a person looks for them and because none of them is a daily task.
 *
 * The dictionary keeps a label rather than an icon: „Słownik" is a place you go
 * on purpose, and a lone book glyph next to an avatar was indistinguishable from
 * „Czytaj". It stays visible to a signed-out visitor — the dictionary is public
 * content — while the level chip does not, because there is no level to show.
 *
 * The three-column grid is what actually centres the navigation: with the logo
 * and the controls in equal-width flex tracks, the pills sit on the middle of
 * the header rather than wherever the logo's width happens to leave them.
 */
export function DesktopHeader() {
  const user = useAuthUser();
  // Server-resolved identity (see the root layout), so this branch is already
  // right in the first HTML — nothing is rendered and then withdrawn.
  const hasAccount = isAccountUser(user);

  return (
    <div className="mx-auto flex h-[calc(var(--app-header-h)-1px)] max-w-6xl items-center gap-4 px-4 lg:px-6">
      <div className="flex flex-1 justify-start">
        <Link
          href="/today"
          className="flex shrink-0 items-center rounded-sm outline-ring/50 focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          <FluentLogo priority />
        </Link>
      </div>

      <MainNavigation />

      <div className="flex flex-1 items-center justify-end gap-2">
        <Link
          href={DICTIONARY.href}
          className="flex h-9 items-center rounded-full border border-border/70 px-4 text-sm font-medium text-main transition-colors hover:border-gold/40 hover:text-gold outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          {DICTIONARY.label}
        </Link>
        {hasAccount ? <LevelChip /> : null}
        <AccountMenu />
      </div>
    </div>
  );
}
