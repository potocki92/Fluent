import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { ImportHistory } from "@/components/library/import/ImportHistory";
import { ImportStepper } from "@/components/library/import/ImportStepper";
import { ImportUploader } from "@/components/library/import/ImportUploader";
import { listBookImports } from "@/lib/import/queries";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Dodaj własną książkę — Fluent",
  description:
    "Zaimportuj własny plik PDF, EPUB lub TXT i czytaj go w Fluent po niemiecku.",
};

/**
 * The importer's front door.
 *
 * Deliberately one screen with one control on it. Everything the feature can do
 * — extraction, cleanup, chapter detection, processing — happens after this
 * page, and putting any of it here would turn "wybierz plik" into a form.
 *
 * `maxDuration` is raised for the whole segment because the Server Actions
 * started from these pages read and parse a book. Next applies a page's
 * `maxDuration` to the Server Actions invoked from it, which is the supported
 * way to give the PDF parser the time a 400-page file needs. Platforms cap this
 * at their own plan limit; the batched processing below exists precisely so that
 * nothing depends on getting the whole book done in one call.
 */
export const maxDuration = 300;

export default async function ImportPage() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // An import belongs to somebody. There is no anonymous half-state worth
  // building: the file, the preview and the book are all owner-scoped.
  if (!user) redirect("/auth?next=/library/import");

  const imports = await listBookImports(supabase);

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Link
          href="/library"
          className="inline-flex items-center gap-1 text-sm text-muted2 transition-colors hover:text-main"
        >
          <ArrowLeft className="size-4" /> Biblioteka
        </Link>
        <ImportStepper current="file" />
      </div>

      <ImportUploader />

      <ImportHistory imports={imports} />
    </div>
  );
}
