import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { markTextOpened } from "@/actions/today-plan";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { ReadingText } from "@/components/texts/ReadingText";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";

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
