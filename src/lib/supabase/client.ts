import { createBrowserClient } from "@supabase/ssr";

import type { Database } from "@/types/database";

type BrowserClient = ReturnType<typeof createBrowserClient<Database>>;

let client: BrowserClient | undefined;

/**
 * Browser Supabase client, returned as a singleton so the instance is not
 * re-created on every React re-render.
 */
export function createClientSupabaseClient() {
  if (client) return client;

  client = createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );

  return client;
}
