import type { Metadata } from "next";

import { listStoryChapters } from "@/actions/admin-story";
import { AdminStoryInspector } from "@/components/admin/AdminStoryInspector";

export const metadata: Metadata = {
  title: "Story Engine — panel administratora",
};

/**
 * The Story Engine inspector.
 *
 * Generated content needs a place where "why does this chapter have no
 * Challenge?" is answerable in one glance, and where a bad question is findable
 * before a hundred learners have answered it. That is this page: per-chapter
 * bank coverage, staleness, reports, and the last generation run's cost and
 * rejections.
 *
 * Private imports never appear here. An admin panel is a content tool, not a
 * reason to open somebody's personal library.
 */
export default async function AdminStoryPage() {
  const chapters = await listStoryChapters();
  return (
    <section className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-lg font-semibold">Story Engine</h1>
        <p className="text-sm text-muted2">
          Bank pytań, walidacja i koszty generowania — tylko treść publiczna.
        </p>
      </header>
      <AdminStoryInspector chapters={chapters} />
    </section>
  );
}
