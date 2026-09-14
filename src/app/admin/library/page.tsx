import type { Metadata } from "next";

import { AdminLibrary } from "@/components/admin/AdminLibrary";
import { listLibraryContent } from "@/actions/admin-library";

export const metadata: Metadata = {
  title: "Biblioteka — panel administratora",
};

/**
 * The content inspector.
 *
 * Not a CMS. It answers the three questions an admin actually has about reader
 * content — has this been processed, did the pipeline understand it, and does it
 * read correctly — and provides the one action that matters: run the pipeline.
 * Everything else (covers, ordering UI, rich editing) is deliberately absent
 * until there is content enough to need it.
 */
export default async function AdminLibraryPage() {
  const items = await listLibraryContent();
  return <AdminLibrary items={items} />;
}
