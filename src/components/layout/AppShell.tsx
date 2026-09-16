"use client";

import { usePathname } from "next/navigation";

import { BottomNav } from "@/components/layout/BottomNav";
import { Header } from "@/components/layout/Header";
import { isAuthPath } from "@/lib/auth/redirects";

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
    <>
      <Header />
      {/* The bottom padding clears the fixed tab bar, so it has to clear the
          safe-area inset the bar now carries too — otherwise the last row of a
          list sits under the home indicator. */}
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-4">
        {children}
      </main>
      <BottomNav />
    </>
  );
}

/** `/library/<slug>/<chapter>` — the reader itself, not the library or a book. */
export function isReaderRoute(pathname: string): boolean {
  return /^\/library\/[^/]+\/[^/]+\/?$/.test(pathname);
}
