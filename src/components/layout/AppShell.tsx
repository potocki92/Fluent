"use client";

import { usePathname } from "next/navigation";

import { BottomNav } from "@/components/layout/BottomNav";
import { Header } from "@/components/layout/Header";

/**
 * The app chrome — header, content column, bottom navigation — and the one
 * screen that opts out of it.
 *
 * WHY THE READER IS DIFFERENT. Every other screen in Fluent is a task: a list, a
 * test, a review queue. A chapter is not a task, it is a place you stay for
 * forty minutes, and the standard chrome actively fights that — a fixed
 * dashboard header, a four-item tab bar over the last line of every page, and a
 * 2xl content column sized for cards rather than for a 65-character measure.
 *
 * The alternative would have been a route group (`(reader)/…`) with its own
 * layout, which the project deliberately does not use — routing here is flat.
 * One pathname check in one client component is a smaller, more obvious thing
 * than a parallel layout tree, and it keeps the root layout a server component.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const immersive = isReaderRoute(pathname);

  if (immersive) return <>{children}</>;

  return (
    <>
      <Header />
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 pb-24 pt-4">
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
