"use client";

import Link from "next/link";

import { AccountMenu } from "@/components/auth/AccountMenu";
import { FluentLogo } from "@/components/brand/FluentLogo";

/**
 * The phone's top bar: the logo, and the avatar. Nothing else.
 *
 * Everything that used to sit here — the dictionary, the notebook, the settings
 * cog, the admin shield, the level ring — is now one tap away on „Więcej" or in
 * the account menu. On a 360px screen those six controls left the brand about
 * 90px and gave the learner a row of glyphs with no labels; the navigation that
 * actually matters lives at the bottom of the screen, where a thumb is.
 */
export function MobileHeader() {
  return (
    <div className="flex h-14 items-center justify-between gap-3 px-4">
      <Link
        href="/today"
        className="flex shrink-0 items-center rounded-sm outline-ring/50 focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        <FluentLogo priority />
      </Link>
      <AccountMenu />
    </div>
  );
}
