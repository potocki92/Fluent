"use client";

import Link from "next/link";
import { Loader2, LogOut, Settings } from "lucide-react";

import { useAuthUser } from "@/components/auth/AuthProvider";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useSignOut } from "@/hooks/useSignOut";
import { accountInitial, isAccountUser } from "@/lib/auth/identity";

/**
 * The account control in the header.
 *
 * It renders from `useAuthUser()`, whose first value came from the SERVER, so
 * there is no moment where a signed-in learner is shown "Załóż konto" or a
 * signed-out visitor is shown somebody's initial (§142). No `getUser()` call
 * happens here at all.
 *
 * `isAccountUser` rather than `user !== null`: a Supabase guest session is not a
 * Fluent account and must not be offered account controls.
 */
export function AccountMenu() {
  const user = useAuthUser();
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
          className="flex size-8 items-center justify-center rounded-full bg-gold text-sm font-semibold text-dark uppercase transition-opacity outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-60"
          disabled={isPending}
        >
          {isPending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            accountInitial(user)
          )}
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-60">
        <div className="px-2 py-2">
          <p className="truncate text-sm font-semibold text-main">{name}</p>
          {user.email ? (
            <p className="truncate text-xs text-muted2">{user.email}</p>
          ) : null}
        </div>

        <DropdownMenuSeparator />

        <DropdownMenuItem asChild>
          <Link href="/settings">
            <Settings aria-hidden />
            Ustawienia
          </Link>
        </DropdownMenuItem>

        <DropdownMenuItem
          disabled={isPending}
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
