import { notFound, redirect } from "next/navigation";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { TestResult } from "@/components/texts/TestResult";

export const metadata = { title: "Wynik testu · Fluent" };

/**
 * The result of one finished test, read from the session that produced it.
 *
 * The previous version took `correct`, `total`, `abilityBefore` and
 * `abilityAfter` from the query string, so editing the URL showed any result you
 * liked. The URL now carries only the session id — an unguessable uuid that
 * still has to pass three checks before anything is rendered:
 *
 *   1. RLS restricts `test_sessions` to `auth.uid() = user_id`, so another
 *      learner's session does not resolve at all;
 *   2. the session must belong to the text in the path;
 *   3. the session must be `completed`, i.e. actually scored by the atomic
 *      finalize — an in-progress session sends the learner back to the test
 *      rather than showing a half-finished score.
 *
 * Refreshing this page is therefore free: it re-reads an immutable row and
 * recomputes nothing.
 */
export default async function ResultsPage({
  params,
}: {
  params: Promise<{ textId: string; sessionId: string }>;
}) {
  const { textId, sessionId } = await params;
  const id = Number(textId);
  if (!Number.isInteger(id)) notFound();

  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth");

  const { data: session } = await supabase
    .from("test_sessions")
    .select("id, text_id, status, ability_before, ability_after, correct, total")
    .eq("id", sessionId)
    .eq("text_id", id)
    .maybeSingle();

  if (!session) notFound();
  if (session.status !== "completed") redirect(`/learn/${id}/test`);

  return (
    <TestResult
      correct={session.correct ?? 0}
      total={session.total ?? 0}
      abilityBefore={Number(session.ability_before)}
      abilityAfter={Number(session.ability_after ?? session.ability_before)}
    />
  );
}
