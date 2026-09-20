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
      <header className="space-y-1">
        <h1 className="text-2xl font-bold">Więcej</h1>
        <p className="text-sm text-muted2">
          Wszystko, czego potrzebujesz, w jednym miejscu.
        </p>
      </header>

      <ul className="space-y-2">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                className="app-panel app-panel-link flex items-center gap-3 rounded-xl px-4 py-3.5 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <span
                  className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-secondary text-gold"
                  aria-hidden
                >
                  <Icon className="size-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold text-main">
                    {item.label}
                  </span>
                  <span className="block truncate text-xs text-muted2">
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
