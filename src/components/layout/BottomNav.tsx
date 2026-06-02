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
      <ul className="mx-auto flex max-w-2xl items-stretch justify-around">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                className={cn(
                  "flex flex-col items-center gap-1 py-2.5 text-xs transition-colors",
                  active ? "text-gold" : "text-muted2 hover:text-main",
                )}
              >
                <Icon className="size-5" />
                <span>{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
