import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { AdminPreview } from "@/components/admin/AdminPreview";
import type { QuestionWithAnswer, Text } from "@/types";

export const metadata: Metadata = {
  title: "Podgląd tekstu — Fluent",
};

export default async function PreviewTextPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const textId = Number(id);
  if (!Number.isFinite(textId)) notFound();

  // Server client + admin RLS returns drafts. The admin layout already gated
  // access, so a non-admin never reaches this fetch.
  const supabase = await createServerSupabaseClient();
  const { data: text } = await supabase
    .from("texts")
    .select("*")
    .eq("id", textId)
    .maybeSingle();
  if (!text) notFound();

  const { data: questionRows } = await supabase
    .from("questions")
    .select("*")
    .eq("text_id", textId)
    .order("id", { ascending: true });
  const questions = (questionRows ?? []) as unknown as QuestionWithAnswer[];

  return (
    <div className="space-y-5">
      <header className="flex items-center gap-3">
        <Link
          href={`/admin/texts/${textId}`}
          className="flex size-8 shrink-0 items-center justify-center rounded-md bg-[#374151] text-muted2 transition-colors hover:text-main"
          aria-label="Powrót do edycji"
        >
          <ArrowLeft className="size-4" />
        </Link>
        <p className="text-sm text-muted2">Podgląd</p>
      </header>

      <AdminPreview text={text as Text} questions={questions} />
    </div>
  );
}
