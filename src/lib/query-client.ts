import { cache } from "react";
import { QueryClient } from "@tanstack/react-query";

/**
 * Per-request QueryClient for Server Components. `cache()` ties the singleton to
 * the React request scope, so prefetch state cannot leak between requests in the
 * App Router (a module-level singleton would). The client-side provider in
 * `src/app/providers.tsx` owns the browser QueryClient that hydrates this state.
 */
export const getQueryClient = cache(
  () =>
    new QueryClient({
      defaultOptions: {
        queries: {
          staleTime: 5 * 60 * 1000, // 5 minutes
        },
      },
    }),
);
