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
      <ul className="mx-auto flex max-w-2xl items-stretch justify-around px-2">
        {MOBILE_NAV.map((item) => {
          const active = isRouteActive(pathname, item);
          const Icon = item.icon;
          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  // 44px is the floor for a touch target, and this row is the
                  // one place in the app where every pixel of it is load-bearing.
                  "flex min-h-[3.25rem] flex-col items-center justify-center gap-1 py-1.5 text-[0.6875rem] font-medium transition-colors",
                  "outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                  active ? "text-gold" : "text-muted2 hover:text-main",
                )}
              >
                <span
                  className={cn(
                    "flex items-center justify-center rounded-full px-4 py-1 transition-colors",
                    active && "bg-gold/12",
                  )}
                  aria-hidden
                >
                  <Icon className="size-5" />
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
