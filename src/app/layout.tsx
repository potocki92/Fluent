import type { Metadata } from "next";
import { Inter } from "next/font/google";

import "./globals.css";
import { Providers } from "./providers";
import { AppShell } from "@/components/layout/AppShell";
import { getOptionalUser } from "@/lib/auth/server";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Fluent — niemiecki słownik",
  description:
    "Ucz się niemieckiego słownictwa przez czytanie, fiszki i adaptacyjne testy.",
};

/**
 * Identity is resolved HERE, once per request, and handed down.
 *
 * It costs one verified-claims read — no `profiles` query, no per-component
 * `getUser()` after hydration — and it buys the thing that was missing: the very
 * first HTML the browser receives already knows whether anybody is signed in. No
 * "Załóż konto" flashing at a signed-in learner, no greeting flashing at a
 * signed-out one, and no hydration mismatch between the two (§89, §90, §143).
 */
export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const user = await getOptionalUser();

  return (
    <html
      lang="pl"
      className={`dark ${inter.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="flex min-h-full flex-col bg-background text-foreground">
        <Providers initialUser={user}>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
