import type { NextRequest } from "next/server";

import { updateSession } from "@/lib/supabase/middleware";

/**
 * Next.js 16 renamed the `middleware` convention to `proxy`. This runs on
 * every request (except static assets/API below) and refreshes the Supabase
 * session via updateSession().
 */
export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico, sitemap.xml, robots.txt, manifest.webmanifest
     * - api routes
     * - common image/static file extensions
     *
     * The manifest belongs in that list for the same reason robots.txt does: it
     * is metadata about the app, not a screen inside it. `routeAccess` defaults
     * an unlisted path to "account", so without this the browser asking for the
     * manifest is answered with a 307 to /auth — and an install prompt that
     * parses a sign-in page as JSON falls back to the <title> and a scaled
     * favicon, which is exactly the branding this file exists to replace.
     */
    "/((?!_next/static|_next/image|api|favicon.ico|sitemap.xml|robots.txt|manifest.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
