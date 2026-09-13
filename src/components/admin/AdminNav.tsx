"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/admin", label: "Teksty" },
  { href: "/admin/words", label: "Słownik" },
  { href: "/admin/suggestions", label: "Zgłoszenia" },
  { href: "/admin/learning", label: "Model wiedzy" },
  { href: "/admin/planner", label: "Planner" },
];

/** Detect the active section. `/admin` matches only itself (not sub-routes). */
function isActive(pathname: string, href: string): boolean {
  if (href === "/admin") return pathname === "/admin";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Section tabs shared across the admin panel. */
export function AdminNav() {
  const pathname = usePathname();

  return (
    <nav className="flex gap-1 border-b border-border">
      {LINKS.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className={cn(
            "border-b-2 px-3 py-2 text-sm transition-colors",
            isActive(pathname, link.href)
              ? "border-gold font-semibold text-main"
              : "border-transparent text-muted2 hover:text-main",
          )}
        >
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
