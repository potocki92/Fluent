import Link from "next/link";
import { BookOpen, Sparkles } from "lucide-react";

import { FluentLogo } from "@/components/brand/FluentLogo";

/**
 * The frame every authentication screen sits in.
 *
 * MOBILE IS THE DESIGN, desktop is the variation. On a phone it is a single
 * column: wordmark, one line of positioning, the form. On a wide screen the
 * positioning moves to the left and the form keeps its own measure on the right,
 * because a 1440px-wide login form looks like a bug (§43, §44, §112, §116).
 *
 * The left column is not a landing page. Two signals, one sentence each — a
 * learner who reached this URL has already decided; the wall of benefits would
 * only be in the way (§115).
 */
export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="auth-ambient auth-screen flex flex-col">
      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center gap-10 lg:flex-row lg:items-center lg:gap-16">
        <section className="flex flex-col gap-5 lg:flex-1 lg:pb-10">
          <Link
            href="/"
            className="inline-flex self-start rounded-sm outline-ring/50 focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            <FluentLogo size="auth" priority />
          </Link>

          <div className="space-y-2">
            <h1 className="text-balance text-2xl font-bold leading-tight text-main sm:text-3xl">
              Czytaj. Rozumiej. Zapamiętuj.
            </h1>
            <p className="max-w-sm text-pretty text-sm text-muted2">
              Ucz się niemieckiego z prawdziwych historii — Fluent pilnuje, co
              powtórzyć i co przeczytać dalej.
            </p>
          </div>

          <ul className="hidden max-w-sm gap-3 lg:grid">
            <ValueSignal icon={BookOpen}>
              Czytaj książki po niemiecku i dotknij słowa, żeby je zrozumieć.
            </ValueSignal>
            <ValueSignal icon={Sparkles}>
              Twoje powtórki i postępy zapisują się na koncie — na każdym
              urządzeniu.
            </ValueSignal>
          </ul>
        </section>

        <main className="w-full lg:max-w-[27rem] lg:flex-none">{children}</main>
      </div>
    </div>
  );
}

function ValueSignal({
  icon: Icon,
  children,
}: {
  icon: typeof BookOpen;
  children: React.ReactNode;
}) {
  return (
    <li className="flex items-start gap-3 text-sm text-muted2">
      <Icon className="mt-0.5 size-4 shrink-0 text-gold" aria-hidden />
      <span className="text-pretty">{children}</span>
    </li>
  );
}
