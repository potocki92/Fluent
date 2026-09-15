import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { ImportWorkbench } from "@/components/library/import/ImportWorkbench";
import { getBookImport } from "@/lib/import/queries";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Import książki — Fluent",
};

/** See `src/app/library/import/page.tsx` — this segment parses books. */
export const maxDuration = 300;

/**
 * One import, at whatever stage it is at.
 *
 * A REAL URL, ON PURPOSE. The state lives in the database, so this page can be
 * bookmarked, reloaded, opened on a phone after being started on a laptop, and
 * come back to tomorrow — and it will show exactly where the import got to.
 * Building the preview in React state would have made every one of those a way
 * to lose an upload.
 *
 * A learner who is not the owner does not get a 403: `getBookImport` runs on
 * their own client, RLS returns nothing, and the import is simply not found.
 * That is the right answer — the existence of somebody else's import is not
 * information Fluent should confirm.
 */
export default async function ImportDetailPage({
  params,
}: {
  params: Promise<{ importId: string }>;
}) {
  const { importId } = await params;

  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/auth?next=/library/import/${importId}`);

  const detail = await getBookImport(supabase, importId);
  if (!detail) notFound();

  const title = detail.title ?? detail.detectedTitle ?? detail.fileName;

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <Link
          href="/library/import"
          className="inline-flex items-center gap-1 text-sm text-muted2 transition-colors hover:text-main"
        >
          <ArrowLeft className="size-4" /> Importy
        </Link>
        <h1 className="truncate text-xl font-bold text-main">{title}</h1>
      </header>

      <ImportWorkbench detail={detail} />
    </div>
  );
}
