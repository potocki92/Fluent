/**
 * WHICH SECTION AM I IN — asked once, answered once.
 *
 * Fluent has two navigation surfaces (the desktop top bar and the phone's tab
 * bar) plus a "Więcej" screen, and before this existed each of them carried its
 * own copy of the link list AND its own idea of what "active" means. That is two
 * places to forget that `/learn` belongs to „Czytaj", and two places for the
 * highlight to disagree about a book chapter.
 *
 * So the matching lives here, pure: no router, no React, no icons. The surfaces
 * pass a pathname and a route, and they all get the same answer.
 */

export interface NavRoute {
  /** Where the tab goes. */
  href: string;
  /**
   * Extra path roots this tab also owns.
   *
   * `/learn` is the graded passages and their tests — a different route tree
   * from the library, but the same activity as far as a learner is concerned, so
   * it lights up „Czytaj" rather than nothing at all.
   */
  also?: readonly string[];
}

/**
 * Is `pathname` inside `route`?
 *
 * A tab owns its href AND everything under it, which is what makes
 * `/library/<slug>/<chapter>` highlight „Czytaj" without the chapter route
 * having to know that a tab bar exists.
 */
export function isRouteActive(pathname: string, route: NavRoute): boolean {
  const path = normalize(pathname);
  return [route.href, ...(route.also ?? [])].some(
    (base) => path === base || path.startsWith(`${base}/`),
  );
}

/** The first route in `routes` that owns `pathname`, if any. */
export function activeRoute<T extends NavRoute>(
  pathname: string,
  routes: readonly T[],
): T | null {
  return routes.find((route) => isRouteActive(pathname, route)) ?? null;
}

/** Trailing slashes are the same route; an empty path is the root. */
function normalize(pathname: string): string {
  if (!pathname) return "/";
  if (pathname.length > 1 && pathname.endsWith("/")) return pathname.slice(0, -1);
  return pathname;
}
