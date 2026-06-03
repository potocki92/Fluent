import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { TextForm } from "@/components/admin/TextForm";

export const metadata: Metadata = {
  title: "Nowy tekst — Fluent",
};

export default function NewTextPage() {
  return (
    <div className="space-y-5">
      <header className="flex items-center gap-3">
        <Link
          href="/admin"
          className="flex size-8 shrink-0 items-center justify-center rounded-md bg-[#374151] text-muted2 transition-colors hover:text-main"
          aria-label="Powrót do panelu"
        >
          <ArrowLeft className="size-4" />
        </Link>
        <h1 className="text-xl font-bold">Nowy tekst</h1>
      </header>

      <TextForm mode="create" />
    </div>
  );
}
