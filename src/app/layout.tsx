import type { Metadata } from "next";
import { Inter } from "next/font/google";

import "./globals.css";
import { Providers } from "./providers";
import { Header } from "@/components/layout/Header";
import { BottomNav } from "@/components/layout/BottomNav";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Fluent — niemiecki słownik",
  description:
    "Ucz się niemieckiego słownictwa przez czytanie, fiszki i adaptacyjne testy.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="pl"
      className={`dark ${inter.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full bg-[#1a202c] text-[#e2e8f0] flex flex-col">
        <Providers>
          <Header />
          <main className="flex-1 w-full max-w-2xl mx-auto px-6 pb-36 pt-7 sm:px-4 sm:pb-24 sm:pt-4">
            {children}
          </main>
          <BottomNav />
        </Providers>
      </body>
    </html>
  );
}
