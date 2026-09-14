import Link from "next/link";
import { Library, Settings } from "lucide-react";

import { AuthButton } from "@/components/auth/AuthButton";
import { AdminNavLink } from "@/components/layout/AdminNavLink";
import { LevelSummary } from "@/components/level/LevelSummary";

export function Header() {
  return (
    <header className="sticky top-0 z-40 border-b border-[#374151] bg-[#1a202c]/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-2xl items-center justify-between px-4">
        <Link href="/today" className="flex items-center gap-2">
          <span className="bg-gradient-to-r from-gold to-blue bg-clip-text text-lg font-bold tracking-tight text-transparent">
            Fluent
          </span>
          <span className="text-xs text-muted2">DE · PL</span>
        </Link>
        <div className="flex items-center gap-3">
          <AdminNavLink />
          <LevelSummary size="header" />
          {/* Dictionary moved off the bottom bar when Today took its place —
              still one tap away, just no longer one of the daily four. */}
          <Link
            href="/browse"
            aria-label="Słownik"
            className="flex items-center text-muted2 transition-colors hover:text-main"
          >
            <Library className="size-5" />
          </Link>
          <Link
            href="/settings"
            aria-label="Ustawienia"
            className="flex items-center text-muted2 transition-colors hover:text-main"
          >
            <Settings className="size-5" />
          </Link>
          <AuthButton />
        </div>
      </div>
    </header>
  );
}
