import { isAuthPath } from "@/lib/auth/redirects";

/**
 * THE ROUTE ACCESS MODEL — one table, consulted everywhere.
 *
 * Before this existed, every private screen decided for itself: `/today`
 * rendered a "zaloguj się" card, `/notebook` rendered a different one, `/stats`
 * quietly rendered zeroes, and `/settings`, `/calibration` and `/practice/*`
 * never checked at all — they were client components reading a store that still
 * held the previous learner's numbers. Fifteen copies of a redirect is fifteen
 * chances to forget one, and the ones that were forgotten are precisely how a
 * signed-out learner kept seeing their own data.
 *
 * So access is a property of the PATH, declared once, and the proxy enforces it
 * for every request. Pages no longer carry sign-in branches; by the time one
 * renders, the access level it requires has already been satisfied.
 *
 * This is a pure function on purpose: no Supabase, no request, no cookies. It
 * answers "what does this path require", never "who is asking".
 */
export type RouteAccess = "public" | "account" | "admin";

/**
 * Paths reachable without an account.
 *
 * The shelf and the dictionary are the shop window — a visitor can see what
 * Fluent contains. Everything that *does* something with their learning is
 * behind an account, because all of it writes to user-scoped tables.
 */
const PUBLIC_EXACT = new Set<string>([
  "/", // redirects to /today, which is gated in its own right
  "/browse", // the shared dictionary: global, admin-curated content
  "/library", // the shelf
  "/learn", // the graded-passage catalogue
  "/words", // the same dictionary, paginated
  // The phone's fourth tab. It is a MENU, not a screen with data on it: it
  // renders the destinations the caller can actually reach, which for a visitor
  // is the dictionary and the sign-in button. Gating it would mean the fourth
  // tab of a public shelf bounced a visitor to the login form.
  "/more",
]);

/** The admin panel, gated on a role the proxy deliberately does not read. */
const ADMIN_PREFIX = "/admin";

/**
 * `/library/<slug>` — a book's own page. Public like the shelf it sits on, so a
 * visitor can read the blurb and the chapter list before signing up.
 *
 * `/library/import` is NOT this: it is the private-book importer and is matched
 * out below before the shape test runs.
 */
const BOOK_PAGE = /^\/library\/[^/]+\/?$/;

/** The importer lives under `/library` but is as private as it gets. */
const IMPORT_PREFIX = "/library/import";

/**
 * What `pathname` requires of the caller.
 *
 * Unknown paths default to `"account"`. A new private screen is therefore
 * protected the moment it exists, and a new public one is a deliberate,
 * reviewable addition to the table above — the failure mode of forgetting is
 * "too strict", never "wide open".
 */
export function routeAccess(pathname: string): RouteAccess {
  const path = normalize(pathname);

  if (path === ADMIN_PREFIX || path.startsWith(`${ADMIN_PREFIX}/`)) return "admin";

  // The whole auth experience — the form, the callback, password recovery — has
  // to be reachable by definition.
  if (isAuthPath(path)) return "public";

  if (PUBLIC_EXACT.has(path)) return "public";

  // Order matters: the importer must not be mistaken for a book page.
  if (path === IMPORT_PREFIX || path.startsWith(`${IMPORT_PREFIX}/`)) return "account";
  if (BOOK_PAGE.test(path)) return "public";

  // A chapter — `/library/<slug>/<n>` and everything under it — is account-only.
  // The reader is not a web page with German on it: it records progress, logs
  // lookups, and writes the personal notebook, and a private imported book is
  // readable by exactly one person. A signed-out reader is a broken reader.
  return "account";
}

/** Convenience: does this path need a real Fluent account? */
export function requiresAccount(pathname: string): boolean {
  const access = routeAccess(pathname);
  return access === "account" || access === "admin";
}

/** Trailing slashes are the same route; an empty path is the root. */
function normalize(pathname: string): string {
  if (!pathname) return "/";
  if (pathname.length > 1 && pathname.endsWith("/")) {
    return pathname.slice(0, -1);
  }
  return pathname;
}
