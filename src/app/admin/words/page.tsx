import type { Metadata } from "next";

import { AdminWordList } from "@/components/admin/AdminWordList";

export const metadata: Metadata = {
  title: "Słownik — panel administratora — Fluent",
};

export default function AdminWordsPage() {
  return <AdminWordList />;
}
