import Link from "next/link";
import { notFound } from "next/navigation";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

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
    .maybeSingle();

  if (!text) notFound();

  return (
    <article className="space-y-6">
      <header className="space-y-2">
        <div className="flex items-center gap-2">
          <Badge className="bg-gold text-[#1a202c]">{text.cefr}</Badge>
          <span className="text-xs text-muted2">{text.word_count ?? "—"} słów</span>
        </div>
        <h1 className="text-2xl font-bold">{text.title}</h1>
      </header>

      {/* Body is trusted HTML with <mark data-lemma="…"> annotations. */}
      <div
        className="prose-reading space-y-4 text-[15px] leading-7 text-main [&_mark]:rounded [&_mark]:bg-gold/15 [&_mark]:px-0.5 [&_mark]:text-gold"
        dangerouslySetInnerHTML={{ __html: text.body }}
      />

      <div className="sticky bottom-20 pt-4">
        <Button
          asChild
          className="w-full bg-gold text-[#1a202c] hover:bg-gold-dark"
        >
          <Link href={`/learn/${text.id}/test`}>Rozpocznij test ze zrozumienia</Link>
        </Button>
      </div>
    </article>
  );
}
