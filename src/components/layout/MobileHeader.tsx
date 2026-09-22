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
 *
 * 68px, AND THE NUMBER IS NOT ARBITRARY. It is `--app-header-h` in
 * `globals.css` — a 38px avatar with 15px of air above and below — and it is
 * declared there rather than here because `.app-screen` subtracts it. A header
 * that grew by a class nobody else could see would silently push the review
 * ratings off the bottom of the phone (§4).
 *
 * THE HAIRLINE IS PART OF THAT 68, hence the `- 1px`: `Header` draws a
 * `border-b`, and a token meaning "68 plus whatever the border turns out to be"
 * would leave every full-height screen one pixel long — which is not a rounding
 * error, it is a scrollbar.
 */
export function MobileHeader() {
  return (
    <div className="flex h-[calc(var(--app-header-h)-1px)] items-center justify-between gap-3 px-4">
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
