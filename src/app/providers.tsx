"use client";

import { AuthProvider } from "@/components/auth/AuthProvider";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { FluentUser } from "@/lib/auth/identity";

/**
 * The browser-side provider tree.
 *
 * The QueryClient used to be created here and live for the whole browser
 * session. It now belongs to `AuthProvider`, because its lifetime is the
 * lifetime of an IDENTITY, not of a tab — see `src/lib/auth/client-state.ts`.
 */
export function Providers({
  initialUser,
  children,
}: {
  initialUser: FluentUser | null;
  children: React.ReactNode;
}) {
  return (
    <AuthProvider initialUser={initialUser}>
      <TooltipProvider delayDuration={200}>{children}</TooltipProvider>
    </AuthProvider>
  );
}
