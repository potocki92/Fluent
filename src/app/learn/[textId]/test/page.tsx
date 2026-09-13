import { notFound } from "next/navigation";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { TestRunner } from "@/components/texts/TestRunner";

/**
 * The test screen only validates that the passage exists and is published, then
 * hands over to {@link TestRunner}.
 *
 * It deliberately does NOT fetch the questions any more. Which questions count
 * toward a result is now decided when the session is opened (`startTestSession`)
 * and snapshotted in the database, so that the client cannot influence the set —
 * a page that pre-loaded a list would just be a second, unauthoritative copy.
 */
export default async function TestPage({
  params,
}: {
  params: Promise<{ textId: string }>;
}) {
  const { textId } = await params;
  const id = Number(textId);
  if (!Number.isInteger(id)) notFound();

  const supabase = await createServerSupabaseClient();

  // Only published passages are testable by learners (drafts are admin-only).
  const { data: text } = await supabase
    .from("texts")
    .select("id")
    .eq("id", id)
    .eq("status", "published")
    .maybeSingle();
  if (!text) notFound();

  return <TestRunner textId={id} />;
}
