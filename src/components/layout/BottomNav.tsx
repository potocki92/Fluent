"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { MOBILE_NAV } from "@/components/layout/navigation";
import { isRouteActive } from "@/lib/navigation";
import { cn } from "@/lib/utils";

/**
 * The phone's navigation: four tabs, and no fifth.
 *
 * WHY „POSTĘP" GAVE UP ITS SEAT. A tab bar is the only navigation a phone user
 * has, so what is in it is a statement about what the app is for: read, review,
 * and see what to do today. Statistics are something you check on a quiet
 * evening, not a daily activity — and putting them in the bar left no room for
 * the dictionary, the notebook or the settings, all of which were then stranded
 * as unlabelled icons in the header. „Więcej" is one tab that holds all four.
 *
 * It is a SCREEN, not a sheet. A drawer over the tab bar has no URL, cannot be
 * linked to, loses its place on rotation and puts a scrolling list under the
 * thumb that opened it. `/more` is a page like any other, so the back button
 * does the obvious thing.
 *
 * `md:hidden`, because above that width the top bar is the navigation — the two
 * are never on screen together.
 *
 * 64px OF UI, PLUS THE SAFE AREA, AND THE NUMBER LIVES IN `globals.css`. A tab
 * bar is the only chrome on a phone that is ALWAYS there, so its height is the
 * single biggest number a full-height screen has to subtract; `--app-tabbar-h`
 * is what `.app-screen` reads and what `AppShell` reserves. It used to be
 * whatever the content came to, reserved as "6rem, probably enough" (§5). The
 * `- 1px` is the top hairline: the token is the WHOLE bar, border included, or
 * every full-height screen ends up one pixel too long to fit.
 */
export function BottomNav() {
  const pathname = usePathname();

  return (
    // The bar is the last thing above the home indicator on a modern phone, so
    // it pays the safe-area inset itself — `env()` is 0 everywhere else.
    <nav
      aria-label="Nawigacja"
      className="app-chrome fixed inset-x-0 bottom-0 z-40 border-t border-border/60 pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      <ul className="mx-auto flex h-[calc(var(--app-tabbar-h)-1px)] max-w-2xl items-stretch justify-around px-2">
        {MOBILE_NAV.map((item) => {
          const active = isRouteActive(pathname, item);
          const Icon = item.icon;
          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  // The bar sets the height now, so the link simply fills it:
                  // at 64px every target clears the 44px floor with room to
                  // spare, and the icon and label stay optically centred in it.
                  "flex size-full flex-col items-center justify-center gap-0.5 text-[0.6875rem] font-medium leading-tight transition-colors",
                  "outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                  active ? "text-gold" : "text-muted2 hover:text-main",
                )}
              >
                <span
                  className={cn(
                    "flex items-center justify-center rounded-full px-3.5 py-0.5 transition-colors",
                    active && "bg-gold/12",
                  )}
                  aria-hidden
                >
                  <Icon className="size-[1.375rem]" />
                </span>
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
