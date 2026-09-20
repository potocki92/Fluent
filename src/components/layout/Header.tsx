"use client";

import { DesktopHeader } from "@/components/layout/DesktopHeader";
import { MobileHeader } from "@/components/layout/MobileHeader";

/**
 * One sticky bar, two layouts.
 *
 * The phone and the desktop do not share a header in this design — they share a
 * strip of chrome. A phone gets the brand and the account; a desktop gets the
 * whole navigation, because it has both the width for it and no tab bar at the
 * bottom of the screen. Trying to express that as one component with six
 * `md:hidden` branches is how a header ends up with controls that are visible at
 * exactly one viewport width and broken at every other.
 *
 * The breakpoint is `md` and it is the SAME `md` the tab bar and the content
 * column use: above it, the top bar navigates and the tab bar is gone; below it,
 * the tab bar navigates and the top bar is a brand line. There is no width where
 * both are doing the job.
 */
export function Header() {
  return (
    <header className="app-chrome sticky top-0 z-40 border-b border-border/60">
      <div className="md:hidden">
        <MobileHeader />
      </div>
      <div className="hidden md:block">
        <DesktopHeader />
      </div>
    </header>
  );
}
