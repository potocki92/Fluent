"use client";

import Link from "next/link";
import { Loader2, LogOut } from "lucide-react";

import { useAuthUser } from "@/components/auth/AuthProvider";
import { ACCOUNT_NAV, ADMIN } from "@/components/layout/navigation";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { useSignOut } from "@/hooks/useSignOut";
import { accountInitial, isAccountUser } from "@/lib/auth/identity";

/**
 * The account control, and the drawer behind it.
 *
 * It renders from `useAuthUser()`, whose first value came from the SERVER, so
 * there is no moment where a signed-in learner is shown "Załóż konto" or a
 * signed-out visitor is shown somebody's initial (§142). No `getUser()` call
 * happens here at all.
 *
 * `isAccountUser` rather than `user !== null`: a Supabase guest session is not a
 * Fluent account and must not be offered account controls.
 *
 * WHAT THIS MENU NOW HOLDS. The notebook, the settings and the admin panel used
 * to be three separate icons in the header, on every screen, for every learner.
 * They are all "things about me and my account" rather than "things I do today",
 * which is exactly what an avatar menu is for. The admin panel appears only for
 * an admin — and `useIsAdmin` is an AFFORDANCE, never a gate: `/admin` is
 * enforced by the route table, `requireAdmin()` and RLS, so a non-admin who
 * guesses the URL gets nowhere regardless of what this menu shows.
 */
export function AccountMenu() {
  const user = useAuthUser();
  const { isAdmin } = useIsAdmin();
  const { signOut, isPending } = useSignOut();

  if (!isAccountUser(user)) {
    return (
      <div className="flex items-center gap-1.5">
        <Button size="sm" variant="ghost" asChild className="hidden sm:inline-flex">
          <Link href="/auth">Zaloguj się</Link>
        </Button>
        <Button size="sm" asChild className="bg-gold text-dark hover:bg-gold-dark">
          <Link href="/auth?mode=register">Załóż konto</Link>
        </Button>
      </div>
    );
  }

  const name = user.displayName ?? user.email ?? "Twoje konto";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Menu konta"
          className="flex size-[2.375rem] shrink-0 items-center justify-center rounded-full bg-gold text-sm font-semibold uppercase text-dark transition-opacity outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-60"
          disabled={isPending}
        >
          {isPending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            accountInitial(user)
          )}
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="app-panel w-64">
        <div className="px-2 py-2">
          <p className="truncate text-sm font-semibold text-main">{name}</p>
          {user.email ? (
            <p className="truncate text-xs text-muted2">{user.email}</p>
          ) : null}
        </div>

        <DropdownMenuSeparator />

        {ACCOUNT_NAV.map((item) => {
          const Icon = item.icon;
          return (
            <DropdownMenuItem key={item.href} asChild>
              <Link href={item.href}>
                <Icon aria-hidden />
                {item.label}
              </Link>
            </DropdownMenuItem>
          );
        })}

        {isAdmin ? (
          <DropdownMenuItem asChild>
            <Link href={ADMIN.href}>
              <ADMIN.icon aria-hidden />
              {ADMIN.label}
            </Link>
          </DropdownMenuItem>
        ) : null}

        <DropdownMenuSeparator />

        <DropdownMenuItem
          disabled={isPending}
          className="text-red focus:bg-red/10 focus:text-red"
          // The menu must not close before the sign-out has been kicked off, and
          // must not be selectable a second time while it runs (§68, §141).
          onSelect={(event) => {
            event.preventDefault();
            void signOut();
          }}
        >
          {isPending ? (
            <Loader2 className="animate-spin" aria-hidden />
          ) : (
            <LogOut aria-hidden />
          )}
          {isPending ? "Wylogowywanie…" : "Wyloguj się"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
