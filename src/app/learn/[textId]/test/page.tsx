import { notFound } from "next/navigation";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { TestRunner } from "@/components/texts/TestRunner";
import type { Question } from "@/types";

export default async function TestPage({
  params,
}: {
  params: Promise<{ textId: string }>;
}) {
  const { textId } = await params;
  const id = Number(textId);
  if (!Number.isFinite(id)) notFound();

  const supabase = await createServerSupabaseClient();

  // Only published passages are testable by learners (drafts are admin-only).
  const { data: text } = await supabase
    .from("texts")
    .select("id")
    .eq("id", id)
    .eq("status", "published")
    .maybeSingle();
  if (!text) notFound();

  // `correct_idx` is intentionally never selected — the answer key stays
  // server-side inside the `submit-answer` Server Action.
  const { data } = await supabase
    .from("questions")
    .select("id, text_id, prompt, options, difficulty")
    .eq("text_id", id)
    .order("id", { ascending: true });

  const questions = (data ?? []) as unknown as Question[];

  if (questions.length === 0) {
    return (
      <p className="text-sm text-muted2">Brak pytań do tego tekstu.</p>
    );
  }

  return <TestRunner questions={questions} textId={id} />;
}
