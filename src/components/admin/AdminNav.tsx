"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/admin", label: "Teksty" },
  { href: "/admin/library", label: "Biblioteka" },
  { href: "/admin/story", label: "Story Engine" },
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

/**
 * Section tabs shared across the admin panel.
 *
 * Seven Polish labels never fit a phone. Squeezing them into the available
 * width is what broke the header: flex items shrink before they overflow, so
 * "Story Engine" and "Model wiedzy" folded onto two lines and every tab became
 * a two-character-wide tap target. A tab bar that does not fit should SCROLL,
 * so the strip bleeds to the screen edges (`-mx-4` against the shell's `px-4`)
 * and each label keeps its natural width — the same idiom the notebook filters
 * use.
 *
 * Desktop was quietly broken too — seven labels need 679px and the column is
 * 640px, so "Story Engine" and "Model wiedzy" wrapped there as well. Trimming
 * the tab padding to `px-2` buys the 39px that makes the row fit a full-width
 * column, and `min-w-full` keeps the rule spanning it.
 */
export function AdminNav() {
  const pathname = usePathname();
  const scroller = useRef<HTMLDivElement>(null);
  const activeTab = useRef<HTMLAnchorElement>(null);

  // A tab you cannot see cannot tell you where you are: on `/admin/planner` the
  // active tab starts off-screen. Centre it rather than calling
  // `scrollIntoView`, which would also move the page vertically.
  useEffect(() => {
    const container = scroller.current;
    const tab = activeTab.current;
    if (!container || !tab) return;
    container.scrollLeft =
      tab.offsetLeft - (container.clientWidth - tab.clientWidth) / 2;
  }, [pathname]);

  return (
    <div ref={scroller} className="-mx-4 overflow-x-auto px-4">
      <nav className="flex w-max min-w-full gap-1 border-b border-border">
        {LINKS.map((link) => {
          const active = isActive(pathname, link.href);
          return (
            <Link
              key={link.href}
              ref={active ? activeTab : undefined}
              href={link.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "shrink-0 whitespace-nowrap border-b-2 px-2 py-2.5 text-sm transition-colors",
                active
                  ? "border-gold font-semibold text-main"
                  : "border-transparent text-muted2 hover:text-main",
              )}
            >
              {link.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
