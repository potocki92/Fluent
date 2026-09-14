import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { markTextOpened } from "@/actions/today-plan";
import { getReaderRouteForText } from "@/lib/library/queries";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { ReadingText } from "@/components/texts/ReadingText";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";

/**
 * The compatibility seam between the old passage reader and the library.
 *
 * ONE READER, NOT TWO. Keeping a separate "passage reader" and "book reader"
 * that do the same job would mean every reading feature built from here on has
 * to be built twice, and one of the two would always be behind. So a passage
 * that has been processed into a chapter redirects INTO the reader, and the
 * `texts` row it came from keeps its id, its questions, its completions and its
 * place in today's plan (`library_items.legacy_text_id` is the mapping).
 *
 * The fallback below is what makes that safe to deploy. A project upgrading to
 * Phase 4 has passages whose structured content has not been built yet, and they
 * keep rendering exactly as they did — the legacy body, the legacy gate, the
 * legacy test button — until an admin processes them. No content freeze, and no
 * learner is blocked on a migration.
 */
export default async function ReadingPage({
  params,
}: {
  params: Promise<{ textId: string }>;
}) {
  const { textId } = await params;
  const id = Number(textId);
  if (!Number.isFinite(id)) notFound();

  const supabase = await createServerSupabaseClient();
  const { data: text } = await supabase
    .from("texts")
    .select("*")
    .eq("id", id)
    .eq("status", "published")
    .maybeSingle();

  if (!text) notFound();

  const readerRoute = await getReaderRouteForText(supabase, id);
  if (readerRoute) {
    // Recorded before the redirect: the planner's "continue what you started"
    // signal is about the passage, whichever screen renders it.
    await markTextOpened(id);
    redirect(`/library/${readerRoute.slug}/${readerRoute.position}`);
  }

  // The "continue what you started" signal. Nothing else in Fluent records that
  // a passage was READ rather than tested on, which is exactly the learner the
  // planner most needs to recognise. Best effort — failing to note it must never
  // stop someone reading.
  await markTextOpened(id);

  return (
    <article className="space-y-4">
      <header className="space-y-2">
        <div className="flex items-center gap-3">
          <Link
            href="/learn"
            className="flex size-8 shrink-0 items-center justify-center rounded-md bg-[#374151] text-muted2 transition-colors hover:text-main"
            aria-label="Powrót do listy tekstów"
          >
            <ArrowLeft className="size-4" />
          </Link>
          <h1 className="min-w-0 flex-1 truncate text-xl font-bold">
            {text.title}
          </h1>
          <Badge className="bg-gold text-[#1a202c]">{text.cefr}</Badge>
        </div>

        <div className="space-y-1.5">
          <Progress value={50} />
          <p className="text-xs text-muted2">Krok 1 z 2 — Czytanie</p>
        </div>
      </header>

      <ReadingText text={text} />
    </article>
  );
}
