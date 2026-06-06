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
          topic: string | null;
          plural: string | null;
          aux: "haben" | "sein" | null;
          synonyms: string[] | null;
          ipa: string | null;
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
          topic?: string | null;
          plural?: string | null;
          aux?: "haben" | "sein" | null;
          synonyms?: string[] | null;
          ipa?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["words"]["Insert"]>;
        Relationships: [];
      };
      word_suggestions: {
        Row: {
          id: number;
          word_id: number;
          user_id: string;
          field: "translation_pl" | "example_de" | "example_pl" | "other";
          suggestion: string;
          note: string | null;
          status: "pending" | "approved" | "rejected";
          created_at: string;
          reviewed_at: string | null;
          reviewed_by: string | null;
        };
        Insert: {
          id?: number;
          word_id: number;
          user_id: string;
          field: "translation_pl" | "example_de" | "example_pl" | "other";
          suggestion: string;
          note?: string | null;
          status?: "pending" | "approved" | "rejected";
          created_at?: string;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
        };
        Update: Partial<
          Database["public"]["Tables"]["word_suggestions"]["Insert"]
        >;
        Relationships: [
          {
            foreignKeyName: "word_suggestions_word_id_fkey";
            columns: ["word_id"];
            referencedRelation: "words";
            referencedColumns: ["id"];
          },
        ];
      };
      texts: {
        Row: {
          id: number;
          title: string;
          cefr: "A1" | "A2" | "B1" | "B2";
          body: string;
          word_count: number | null;
          difficulty: number;
          status: "draft" | "published";
          created_at: string;
        };
        Insert: {
          id?: number;
          title: string;
          cefr: "A1" | "A2" | "B1" | "B2";
          body: string;
          word_count?: number | null;
          difficulty?: number;
          status?: "draft" | "published";
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
          options: string[];
          correct_idx: number;
          difficulty: number;
          created_at: string;
        };
        Insert: {
          id?: number;
          text_id: number;
          prompt: string;
          options: string[];
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
      calibration_questions: {
        Row: {
          id: number;
          prompt: string;
          options: string[];
          correct_idx: number;
          difficulty: number;
          cefr: "A1" | "A2" | "B1" | "B2";
          skill: "vocab" | "grammar" | null;
          created_at: string;
        };
        Insert: {
          id?: number;
          prompt: string;
          options: string[];
          correct_idx: number;
          difficulty: number;
          cefr: "A1" | "A2" | "B1" | "B2";
          skill?: "vocab" | "grammar" | null;
          created_at?: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["calibration_questions"]["Insert"]
        >;
        Relationships: [];
      };
      profiles: {
        Row: {
          id: string;
          display_name: string | null;
          role: "user" | "admin";
          ability: number;
          rd: number;
          answered: number;
          cefr_estimate: string | null;
          streak_days: number;
          last_active: string | null;
          daily_word_goal: number;
          word_streak_days: number;
          words_reviewed_today: number;
          last_word_review: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          display_name?: string | null;
          role?: "user" | "admin";
          ability?: number;
          rd?: number;
          answered?: number;
          cefr_estimate?: string | null;
          streak_days?: number;
          last_active?: string | null;
          daily_word_goal?: number;
          word_streak_days?: number;
          words_reviewed_today?: number;
          last_word_review?: string | null;
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
          response_ms: number | null;
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
          response_ms?: number | null;
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
      text_completions: {
        Row: {
          user_id: string;
          text_id: number;
          passed: boolean;
          correct: number;
          total: number;
          completed_at: string;
        };
        Insert: {
          user_id: string;
          text_id: number;
          passed: boolean;
          correct: number;
          total: number;
          completed_at?: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["text_completions"]["Insert"]
        >;
        Relationships: [
          {
            foreignKeyName: "text_completions_text_id_fkey";
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
    Views: {
      questions_public: {
        Row: {
          id: number;
          text_id: number;
          prompt: string;
          options: string[];
          difficulty: number;
          created_at: string;
        };
        Relationships: [
          {
            foreignKeyName: "questions_text_id_fkey";
            columns: ["text_id"];
            referencedRelation: "texts";
            referencedColumns: ["id"];
          },
        ];
      };
      calibration_questions_public: {
        Row: {
          id: number;
          prompt: string;
          options: string[];
          difficulty: number;
          cefr: "A1" | "A2" | "B1" | "B2";
          skill: "vocab" | "grammar" | null;
          created_at: string;
        };
        Relationships: [];
      };
    };
    Functions: {
      update_streak: {
        Args: { p_user_id: string };
        Returns: undefined;
      };
      bump_word_review: {
        Args: { p_user_id: string };
        Returns: number;
      };
      grade_question: {
        Args: { p_question_id: number; p_selected_idx: number };
        Returns: { is_correct: boolean; correct_idx: number }[];
      };
      grade_calibration: {
        Args: { p_question_id: number; p_selected_idx: number };
        Returns: {
          is_correct: boolean;
          correct_idx: number;
          difficulty: number;
        }[];
      };
      grade_test: {
        Args: {
          p_text_id: number;
          p_question_ids: number[];
          p_selected_idxs: number[];
        };
        Returns: {
          question_id: number;
          is_correct: boolean;
          difficulty: number;
        }[];
      };
    };
    Enums: Record<never, never>;
    CompositeTypes: Record<never, never>;
  };
};
