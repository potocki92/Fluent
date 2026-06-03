"use client";

import Link from "next/link";
import { Shield } from "lucide-react";

import { useIsAdmin } from "@/hooks/useIsAdmin";

/** Header shortcut to the admin panel, shown only to admins. */
export function AdminNavLink() {
  const { isAdmin } = useIsAdmin();
  if (!isAdmin) return null;

  return (
    <Link
      href="/admin"
      className="flex items-center gap-1 text-sm text-muted2 transition-colors hover:text-main"
    >
      <Shield className="size-4" />
      <span className="hidden sm:inline">Admin</span>
    </Link>
  );
}
