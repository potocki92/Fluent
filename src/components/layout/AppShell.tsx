"use client";

import { usePathname } from "next/navigation";

import { BottomNav } from "@/components/layout/BottomNav";
import { Header } from "@/components/layout/Header";
import { isAuthPath } from "@/lib/auth/redirects";
import { cn } from "@/lib/utils";

/**
 * The app chrome — header, content column, bottom navigation — and the two
 * screens that opt out of it.
 *
 * WHY THE READER IS DIFFERENT. Every other screen in Fluent is a task: a list, a
 * test, a review queue. A chapter is not a task, it is a place you stay for
 * forty minutes, and the standard chrome actively fights that — a fixed
 * dashboard header, a four-item tab bar over the last line of every page, and a
 * 2xl content column sized for cards rather than for a 65-character measure.
 *
 * WHY AUTH IS DIFFERENT. A bottom tab bar linking to four screens you cannot
 * open, above a "Zaloguj się" button in the header of the page you are already
 * trying to log in on, is not chrome — it is noise around the only thing on the
 * screen that matters. `/auth` brings its own shell (`src/app/auth/layout.tsx`).
 *
 * The alternative would have been route groups (`(reader)/…`, `(auth)/…`), which
 * the project deliberately does not use — routing here is flat. One pathname
 * check in one client component is a smaller, more obvious thing than a parallel
 * layout tree, and it keeps the root layout a server component.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  if (isReaderRoute(pathname) || isAuthPath(pathname)) return <>{children}</>;

  return (
    <div className="app-ambient flex flex-1 flex-col">
      <Header />
      {/* THE PADDING IS THE SAME ARITHMETIC `.app-screen` DOES, AND THAT IS THE
          POINT. The bottom padding clears the fixed tab bar and the safe-area
          inset the bar carries, and it clears them by exactly `--app-tabbar-h`
          — the bar's real height — rather than by a 6rem guess that left 32px
          of dead space under every screen. A screen that then asks for the
          visible height back gets a number that adds up (§6, §10).

          Above `md` the bar is gone, `--app-tabbar-h` is 0, and the tokens
          widen the gutter instead. */}
      <main
        className={cn(
          "mx-auto w-full flex-1 px-4 pt-[var(--app-main-pt)] md:px-6",
          "pb-[calc(var(--app-main-pb)+var(--app-tabbar-h)+env(safe-area-inset-bottom))]",
          isDashboardRoute(pathname) ? "max-w-5xl" : "max-w-2xl",
        )}
      >
        {children}
      </main>
      <BottomNav />
    </div>
  );
}

/**
 * The screens that are laid out as a DASHBOARD rather than as a column.
 *
 * Every other screen in Fluent is a single list — a review queue, a chapter
 * list, a settings form — and `max-w-2xl` is the measure they were designed for;
 * stretching them to fill a 27" display would leave a settings toggle with a
 * metre of whitespace after it. Today is the exception: it is a grid of cards,
 * and a grid needs the width to be a grid at all. One route, named here, rather
 * than a `wide` prop threaded through every page.
 */
function isDashboardRoute(pathname: string): boolean {
  return pathname === "/today" || pathname === "/today/";
}

/** `/library/<slug>/<chapter>` — the reader itself, not the library or a book. */
export function isReaderRoute(pathname: string): boolean {
  return /^\/library\/[^/]+\/[^/]+\/?$/.test(pathname);
}
