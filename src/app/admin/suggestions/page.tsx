import type { Metadata } from "next";

import { SuggestionList } from "@/components/admin/SuggestionList";

export const metadata: Metadata = {
  title: "Zgłoszenia — panel administratora — Fluent",
};

export default function AdminSuggestionsPage() {
  return <SuggestionList />;
}
