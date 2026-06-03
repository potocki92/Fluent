import Link from "next/link";

import { AuthButton } from "@/components/auth/AuthButton";
import { AdminNavLink } from "@/components/layout/AdminNavLink";
import { CurrentLevelRing } from "@/components/level/CurrentLevelRing";

export function Header() {
  return (
    <header className="sticky top-0 z-40 border-b border-[#374151] bg-[#1a202c]/90 backdrop-blur">
      <div className="mx-auto flex h-20 max-w-2xl items-center justify-between px-6 sm:h-14 sm:px-4">
        <Link href="/learn" className="flex items-center gap-3 sm:gap-2">
          <span className="bg-gradient-to-r from-gold to-blue bg-clip-text text-2xl font-bold tracking-tight text-transparent sm:text-lg">
            Fluent
          </span>
          <span className="text-base text-muted2 sm:text-xs">DE · PL</span>
        </Link>
        <div className="flex items-center gap-5 sm:gap-3">
          <AdminNavLink />
          <CurrentLevelRing />
          <AuthButton />
        </div>
      </div>
    </header>
  );
}
