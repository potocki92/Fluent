import type { Metadata } from "next";

import { MoreScreen } from "@/components/layout/MoreScreen";

export const metadata: Metadata = { title: "Więcej · Fluent" };

/**
 * The phone's fourth tab.
 *
 * Thin by design — it is a menu, and the menu is assembled from the one
 * navigation config in `src/components/layout/navigation.ts`. There is no data
 * on this page and nothing to fetch; the only thing it decides is whether a
 * given row is reachable by the caller, and it asks the route table that.
 *
 * Desktop never lands here through the chrome (the top bar holds all of these),
 * but the URL stays valid and renders correctly at any width — a tab bar link
 * that 404s on a tablet is worse than a menu nobody opens.
 */
export default function MorePage() {
  return <MoreScreen />;
}
