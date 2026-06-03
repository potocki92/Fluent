import type { Metadata } from "next";

import { AdminTextList } from "@/components/admin/AdminTextList";

export const metadata: Metadata = {
  title: "Panel administratora — Fluent",
};

export default function AdminPage() {
  return <AdminTextList />;
}
