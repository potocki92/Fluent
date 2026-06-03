"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, Library, Layers, BarChart3 } from "lucide-react";

import { cn } from "@/lib/utils";

const NAV = [
  { href: "/learn", label: "Czytaj", icon: BookOpen },
  { href: "/browse", label: "Słownik", icon: Library },
  { href: "/review", label: "Powtórki", icon: Layers },
  { href: "/stats", label: "Statystyki", icon: BarChart3 },
];

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed bottom-0 inset-x-0 z-40 border-t border-[#374151] bg-[#2d3748]/95 backdrop-blur">
      <ul className="mx-auto flex max-w-2xl items-stretch justify-around px-2">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                className={cn(
                  "flex flex-col items-center gap-2 py-3 text-lg transition-colors sm:gap-1 sm:py-2 sm:text-xs",
                  active ? "text-gold" : "text-muted2 hover:text-main",
                )}
              >
                <span
                  className={cn(
                    "flex items-center justify-center rounded-2xl px-5 py-2 transition-colors sm:rounded-lg sm:px-4 sm:py-1",
                    active && "bg-[#374151]",
                  )}
                >
                  <Icon className="size-7 sm:size-5" />
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
