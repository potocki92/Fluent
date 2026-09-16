import { cache } from "react";
import { QueryClient } from "@tanstack/react-query";

import { QUERY_DEFAULTS } from "@/lib/query-defaults";

/**
 * Per-request QueryClient for Server Components. `cache()` ties the singleton to
 * the React request scope, so prefetch state cannot leak between requests in the
 * App Router (a module-level singleton would). The client-side provider in
 * `src/components/auth/AuthProvider.tsx` owns the browser QueryClient — and
 * replaces it whenever the signed-in identity changes.
 */
export const getQueryClient = cache(
  () => new QueryClient({ defaultOptions: QUERY_DEFAULTS }),
);
