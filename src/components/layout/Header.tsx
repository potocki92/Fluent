import Link from "next/link";

import { AuthButton } from "@/components/auth/AuthButton";

export function Header() {
  return (
    <header className="sticky top-0 z-40 border-b border-[#374151] bg-[#1a202c]/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-2xl items-center justify-between px-4">
        <Link href="/learn" className="flex items-center gap-2">
          <span className="text-lg font-bold tracking-tight text-gold">
            Fluent
          </span>
          <span className="text-xs text-muted2">DE · PL</span>
        </Link>
        <AuthButton />
      </div>
    </header>
  );
}
