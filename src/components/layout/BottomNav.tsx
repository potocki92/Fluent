"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, Layers, BarChart3, Sun } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Four destinations, with Today first.
 *
 * Słownik moved to the header rather than disappearing: it is a place you go
 * deliberately to look something up, not one of the four things you do every
 * day, and five items in a phone-width bar leaves no room for a Polish label.
 */
const NAV = [
  { href: "/today", label: "Dzisiaj", icon: Sun, also: [] as string[] },
  // "Czytaj" is the LIBRARY now. `/learn` still exists — it is the graded
  // passages and their comprehension tests — but reading itself has one home,
  // and every published passage is in the library too (see `legacy_text_id`).
  { href: "/library", label: "Czytaj", icon: BookOpen, also: ["/learn"] },
  { href: "/review", label: "Powtórki", icon: Layers, also: [] as string[] },
  { href: "/stats", label: "Postęp", icon: BarChart3, also: [] as string[] },
];

function isActive(pathname: string, href: string, also: string[]): boolean {
  return [href, ...also].some(
    (base) => pathname === base || pathname.startsWith(`${base}/`),
  );
}

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed bottom-0 inset-x-0 z-40 border-t border-[#374151] bg-[#2d3748]/95 backdrop-blur">
      <ul className="mx-auto flex max-w-2xl items-stretch justify-around px-2">
        {NAV.map(({ href, label, icon: Icon, also }) => {
          const active = isActive(pathname, href, also);
          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                className={cn(
                  "flex flex-col items-center gap-1 py-2 text-xs transition-colors",
                  active ? "text-gold" : "text-muted2 hover:text-main",
                )}
              >
                <span
                  className={cn(
                    "flex items-center justify-center rounded-lg px-4 py-1 transition-colors",
                    active && "bg-[#374151]",
                  )}
                >
                  <Icon className="size-5" />
                </span>
                <span>{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
