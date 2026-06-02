/**
 * Supabase database types.
 *
 * In a real project this file is generated with:
 *   npx supabase gen types typescript --project-id <REF> > src/types/database.ts
 *
 * It is hand-maintained here to mirror the schema in `supabase/schema.sql`
 * so the app type-checks without a live project connection.
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      words: {
        Row: {
          id: number;
          lemma: string;
          display: string;
          article: "der" | "die" | "das" | null;
          word_type: "noun" | "verb" | "other";
          gender: "m" | "f" | "n" | null;
          translation_pl: string | null;
          example_de: string | null;
          example_pl: string | null;
          cefr: "A1" | "A2" | "B1" | "B2" | null;
          source: string | null;
          created_at: string;
        };
        Insert: {
          id: number;
          lemma: string;
          display: string;
          article?: "der" | "die" | "das" | null;
          word_type: "noun" | "verb" | "other";
          gender?: "m" | "f" | "n" | null;
          translation_pl?: string | null;
          example_de?: string | null;
          example_pl?: string | null;
          cefr?: "A1" | "A2" | "B1" | "B2" | null;
          source?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["words"]["Insert"]>;
        Relationships: [];
      };
      texts: {
        Row: {
          id: number;
          title: string;
          cefr: "A1" | "A2" | "B1" | "B2";
          body: string;
          word_count: number | null;
          difficulty: number;
          created_at: string;
        };
        Insert: {
          id?: number;
          title: string;
          cefr: "A1" | "A2" | "B1" | "B2";
          body: string;
          word_count?: number | null;
          difficulty?: number;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["texts"]["Insert"]>;
        Relationships: [];
      };
      questions: {
        Row: {
          id: number;
          text_id: number;
          prompt: string;
          options: Json;
          correct_idx: number;
          difficulty: number;
          created_at: string;
        };
        Insert: {
          id?: number;
          text_id: number;
          prompt: string;
          options: Json;
          correct_idx: number;
          difficulty?: number;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["questions"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "questions_text_id_fkey";
            columns: ["text_id"];
            referencedRelation: "texts";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          id: string;
          display_name: string | null;
          ability: number;
          rd: number;
          answered: number;
          cefr_estimate: string | null;
          streak_days: number;
          last_active: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          display_name?: string | null;
          ability?: number;
          rd?: number;
          answered?: number;
          cefr_estimate?: string | null;
          streak_days?: number;
          last_active?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["profiles"]["Insert"]>;
        Relationships: [];
      };
      attempts: {
        Row: {
          id: number;
          user_id: string;
          question_id: number;
          text_id: number;
          is_correct: boolean;
          ability_before: number;
          ability_after: number;
          created_at: string;
        };
        Insert: {
          id?: number;
          user_id: string;
          question_id: number;
          text_id: number;
          is_correct: boolean;
          ability_before: number;
          ability_after: number;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["attempts"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "attempts_question_id_fkey";
            columns: ["question_id"];
            referencedRelation: "questions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "attempts_text_id_fkey";
            columns: ["text_id"];
            referencedRelation: "texts";
            referencedColumns: ["id"];
          },
        ];
      };
      saved_words: {
        Row: {
          user_id: string;
          word_id: number;
          interval: number;
          repetitions: number;
          ease_factor: number;
          due_at: string;
          is_mastered: boolean;
          saved_at: string;
        };
        Insert: {
          user_id: string;
          word_id: number;
          interval?: number;
          repetitions?: number;
          ease_factor?: number;
          due_at?: string;
          is_mastered?: boolean;
          saved_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["saved_words"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "saved_words_word_id_fkey";
            columns: ["word_id"];
            referencedRelation: "words";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: Record<never, never>;
    Functions: {
      update_streak: {
        Args: { p_user_id: string };
        Returns: undefined;
      };
    };
    Enums: Record<never, never>;
    CompositeTypes: Record<never, never>;
  };
};
