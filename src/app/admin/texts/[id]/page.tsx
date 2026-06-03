import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Eye } from "lucide-react";

import { Button } from "@/components/ui/button";
import { TextForm } from "@/components/admin/TextForm";
import { QuestionManager } from "@/components/admin/QuestionManager";

export const metadata: Metadata = {
  title: "Edycja tekstu — Fluent",
};

export default async function EditTextPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const textId = Number(id);
  if (!Number.isFinite(textId)) notFound();

  return (
    <div className="space-y-8">
      <header className="flex items-center gap-3">
        <Link
          href="/admin"
          className="flex size-8 shrink-0 items-center justify-center rounded-md bg-[#374151] text-muted2 transition-colors hover:text-main"
          aria-label="Powrót do panelu"
        >
          <ArrowLeft className="size-4" />
        </Link>
        <h1 className="min-w-0 flex-1 text-xl font-bold">Edycja tekstu</h1>
        <Button asChild variant="outline" size="sm">
          <Link href={`/admin/texts/${textId}/preview`}>
            <Eye className="size-4" />
            Podgląd
          </Link>
        </Button>
      </header>

      <TextForm mode="edit" textId={textId} />

      <QuestionManager textId={textId} />
    </div>
  );
}
