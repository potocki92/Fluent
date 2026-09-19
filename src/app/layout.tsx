import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";

import "./globals.css";
import { Providers } from "./providers";
import { AppShell } from "@/components/layout/AppShell";
import { getOptionalUser } from "@/lib/auth/server";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

/**
 * The icons are deliberately ABSENT from this object.
 *
 * `src/app/favicon.ico`, `icon.png`, `apple-icon.png` and `manifest.ts` are file
 * conventions: Next finds them and emits the `<link>` tags itself, with a
 * content hash that defeats the browser icon cache. Listing them here as well —
 * or hand-writing `<link rel="icon">` into the document head — would emit each
 * one twice and let the two copies drift apart.
 */
export const metadata: Metadata = {
  title: "Fluent — niemiecki słownik",
  description:
    "Ucz się niemieckiego słownictwa przez czytanie, fiszki i adaptacyjne testy.",
  applicationName: "Fluent",
  // The label under the icon on an iOS home screen. Without it iOS uses the
  // <title>, and "Fluent — niemiecki słownik" is truncated to "Fluent — ni…".
  appleWebApp: { title: "Fluent", statusBarStyle: "default" },
};

/** The browser chrome matches the app surface (`--background`, dark). */
export const viewport: Viewport = {
  themeColor: "#1a202c",
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
