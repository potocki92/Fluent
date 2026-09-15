import { AuthShell } from "@/components/auth/AuthShell";

/**
 * The authentication experience has its own chrome.
 *
 * `AppShell` steps aside for `/auth/**` (see the pathname check there), so this
 * layout is the whole frame: no dashboard header, no bottom tab bar linking to
 * four screens the visitor cannot open, no level ring for a learner who does not
 * exist yet (§37).
 *
 * A nested layout, not a route group. Routing in this project is flat and
 * `src/app/auth/layout.tsx` is simply the layout for the routes that already
 * live at `/auth` — no `(auth)` folder, no parallel tree (§38).
 */
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AuthShell>{children}</AuthShell>;
}
