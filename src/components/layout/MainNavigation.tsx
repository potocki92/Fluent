"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { PRIMARY_NAV } from "@/components/layout/navigation";
import { isRouteActive } from "@/lib/navigation";
import { cn } from "@/lib/utils";

/**
 * The four sections, as pills, in the middle of the desktop header.
 *
 * NO ICONS HERE, ON PURPOSE. Four Polish words are shorter to read than four
 * pictograms are to decode, and the icons that were in this header before said
 * nothing a learner could act on — an open book and a stack of cards are the
 * same promise. Icons survive where they carry meaning a label cannot: the phone
 * tab bar, where there is no room for the label to lead.
 *
 * ACTIVE IS A CAPSULE, NOT A COLOUR. A gold word next to three grey ones is a
 * difference you have to look for; a filled pill is one you see. The underline
 * beneath it is the second, quieter signal for anyone who cannot separate the
 * two by hue at all.
 */
export function MainNavigation({ className }: { className?: string }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Nawigacja główna" className={className}>
      <ul className="flex items-center gap-1">
        {PRIMARY_NAV.map((item) => {
          const active = isRouteActive(pathname, item);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex h-9 items-center rounded-full px-4 text-sm font-medium transition-colors",
                  "outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                  active
                    ? "bg-gold/12 text-gold"
                    : "text-muted2 hover:bg-secondary/60 hover:text-main",
                )}
              >
                {item.label}
                {active && (
                  <span
                    className="absolute inset-x-4 -bottom-0.5 h-0.5 rounded-full bg-gold"
                    aria-hidden
                  />
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
