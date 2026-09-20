import Link from "next/link";

import { QUICK_ACTIONS } from "@/components/layout/navigation";
import { cn } from "@/lib/utils";

/**
 * „Szybkie akcje" — the four places a learner goes off-plan.
 *
 * NOT A SECOND NAVIGATION. The tiles deliberately repeat destinations that are
 * already in the chrome, and that is the point: the plan above answers "what
 * should I do", these answer "I want to do something else". A learner who came
 * to look a word up should not have to find the dictionary in a menu.
 *
 * They read from the same config the header and the tab bar read, so a renamed
 * section cannot be renamed in three places and missed in a fourth. Two columns
 * on a phone, four on a desktop; equal heights, one icon, one helper line.
 */
export function QuickActions({ className }: { className?: string }) {
  return (
    <section className={cn("space-y-3", className)} aria-labelledby="quick-actions">
      <h2 id="quick-actions" className="text-base font-bold">
        Szybkie akcje
      </h2>
      <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {QUICK_ACTIONS.map((item) => {
          const Icon = item.icon;
          return (
            <li key={item.label}>
              {/* Icon ABOVE the text on a phone. Side by side, a 170px tile
                  leaves "Zobacz postęp" about 90px and truncates both lines —
                  and a quick action nobody can read the name of is not one. */}
              <Link
                href={item.href}
                className="app-panel app-panel-link flex h-full flex-col gap-2.5 rounded-xl p-4 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:flex-row sm:items-center sm:gap-3"
              >
                <span
                  aria-hidden
                  className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-gold"
                >
                  <Icon className="size-5" />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-main">
                    {item.label}
                  </span>
                  <span className="block text-xs text-muted2">
                    {item.description}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
