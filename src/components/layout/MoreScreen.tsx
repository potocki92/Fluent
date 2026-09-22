"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { useAuthUser } from "@/components/auth/AuthProvider";
import {
  ADMIN,
  MORE_NAV,
  navItemRequiresAccount,
  type NavItem,
} from "@/components/layout/navigation";
import { Button } from "@/components/ui/button";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { isAccountUser } from "@/lib/auth/identity";
import { cn } from "@/lib/utils";

/**
 * „Więcej" — the fourth tab.
 *
 * It exists because a phone has four tabs and Fluent has more than four places.
 * Everything that is not one of the daily three lands here: the dictionary, the
 * progress screen, the notebook, the settings, and — for an admin — the panel.
 * Each row is a labelled list item with a line of explanation, because the whole
 * point of this screen is that a learner should not have to recognise an icon to
 * find the thing they came for.
 *
 * A VISITOR SEES WHAT A VISITOR CAN USE. The route is public (it is a menu, not
 * data), so it filters itself against the ONE route table rather than carrying a
 * second opinion about what is private: a signed-out visitor gets the dictionary
 * and an invitation, not four rows that bounce them to the sign-in form.
 *
 * ONE SURFACE, FIVE ROWS (§36). Each destination used to be its own card with
 * its own border and its own 8px of air, which is how a menu of five links
 * became a 400px scroll: five boxes, four gaps, and a shadow under each one
 * saying "these are unrelated things". They are not unrelated — they are one
 * list — so they are drawn as one panel with hairlines between the rows, the
 * way every settings list on the phone already is. The rows are 60px, inside
 * iOS's own 56–64 and well past the 44px touch floor (§37).
 */
export function MoreScreen() {
  const user = useAuthUser();
  const hasAccount = isAccountUser(user);
  const { isAdmin } = useIsAdmin();

  const items: NavItem[] = [
    ...MORE_NAV.filter((item) => hasAccount || !navItemRequiresAccount(item)),
    ...(hasAccount && isAdmin ? [ADMIN] : []),
  ];

  return (
    <div className="space-y-5">
      <header className="space-y-0.5">
        <h1 className="text-[1.75rem] font-bold leading-tight">Więcej</h1>
        <p className="text-sm text-muted2">
          Wszystko, czego potrzebujesz, w jednym miejscu.
        </p>
      </header>

      <ul className="app-panel overflow-hidden rounded-2xl">
        {items.map((item, i) => {
          const Icon = item.icon;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                className={cn(
                  "app-panel-link flex min-h-[3.75rem] items-center gap-3 px-3.5 py-2 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                  // A hairline separates rows; it never closes the list.
                  i > 0 && "border-t border-border/60",
                )}
              >
                <span
                  className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-gold"
                  aria-hidden
                >
                  <Icon className="size-[1.125rem]" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[0.9375rem] font-semibold leading-tight text-main">
                    {item.label}
                  </span>
                  <span className="block truncate text-xs leading-tight text-muted2">
                    {item.description}
                  </span>
                </span>
                <ChevronRight className="size-5 shrink-0 text-muted2" aria-hidden />
              </Link>
            </li>
          );
        })}
      </ul>

      {!hasAccount && (
        <div className="app-panel space-y-3 rounded-xl p-5">
          <p className="text-sm font-semibold">Załóż konto, aby uczyć się z Fluent</p>
          <p className="text-sm text-muted2">
            Plan na dziś, powtórki, zeszyt i postępy czekają na Ciebie po
            zalogowaniu.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm" className="bg-gold text-dark hover:bg-gold-dark">
              <Link href="/auth?mode=register">Załóż konto</Link>
            </Button>
            <Button asChild size="sm" variant="secondary">
              <Link href="/auth">Zaloguj się</Link>
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
