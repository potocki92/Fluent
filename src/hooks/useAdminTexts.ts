import { useQuery } from "@tanstack/react-query";

import { createClientSupabaseClient } from "@/lib/supabase/client";
import type { Text } from "@/types";

/** A text row for the admin list, with its question count attached. */
export type AdminTextRow = Text & { questionCount: number };

/**
 * Fetch all reading passages for the admin list (drafts included — admin RLS
 * returns them), newest first, with each text's question count via an embedded
 * aggregate. Distinct query key from the learner `["texts"]` cache.
 */
export function useAdminTexts() {
  return useQuery({
    queryKey: ["adminTexts"],
    queryFn: async (): Promise<AdminTextRow[]> => {
      const supabase = createClientSupabaseClient();
      const { data, error } = await supabase
        .from("texts")
        .select("*, questions(count)")
        .order("created_at", { ascending: false });

      if (error) throw error;

      const rows = (data ?? []) as unknown as (Text & {
        questions: { count: number }[];
      })[];
      return rows.map(({ questions, ...text }) => ({
        ...text,
        questionCount: questions[0]?.count ?? 0,
      }));
    },
  });
}

/**
 * A passage as the edit form needs it: the row, plus the artwork of the library
 * item it maps to.
 *
 * The cover lives on `library_items`, reached through `legacy_text_id`
 * (`src/lib/library/covers.ts`), and the form needs both in one go — a second
 * round trip for one nullable URL would make the image flash in after the rest
 * of the form had already rendered. PostgREST embeds it through the foreign key,
 * so this is still one request.
 */
export type AdminTextDetail = Text & {
  libraryItemId: string | null;
  coverUrl: string | null;
};

/** Fetch a single passage by id for the edit form (drafts included). */
export function useAdminText(textId: number) {
  return useQuery({
    queryKey: ["adminText", textId],
    queryFn: async (): Promise<AdminTextDetail | null> => {
      const supabase = createClientSupabaseClient();
      const { data, error } = await supabase
        .from("texts")
        .select("*, library_items(id, cover_url)")
        .eq("id", textId)
        .maybeSingle();

      if (error) throw error;
      if (!data) return null;

      // `legacy_text_id` is unique, so the embed is a one-element array at most —
      // and empty for a passage the library has not caught up with yet.
      const { library_items: items, ...text } = data as unknown as Text & {
        library_items: { id: string; cover_url: string | null }[] | null;
      };
      const item = items?.[0] ?? null;

      return { ...text, libraryItemId: item?.id ?? null, coverUrl: item?.cover_url ?? null };
    },
    enabled: Number.isFinite(textId),
  });
}
