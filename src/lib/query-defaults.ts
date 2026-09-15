import { QueryClient } from "@tanstack/react-query";

/**
 * The one QueryClient configuration, shared by the browser and by the
 * per-request server client.
 *
 * It lives apart from `src/lib/query-client.ts` because that module calls
 * React's `cache()` at import time, which is a Server Component API — the
 * browser provider must be able to build a client without pulling it in.
 */
export const QUERY_DEFAULTS = {
  queries: {
    staleTime: 5 * 60 * 1000, // 5 minutes
    refetchOnWindowFocus: false,
  },
} as const;

/**
 * A fresh, empty QueryClient.
 *
 * Called once on first render and again on every identity change — see
 * `src/lib/auth/client-state.ts` for why a new client, rather than a selective
 * invalidation, is what makes account switching safe.
 */
export function createAppQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: QUERY_DEFAULTS });
}
