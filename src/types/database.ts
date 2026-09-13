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
          mnemonic: string | null;
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
          mnemonic?: string | null;
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
          promotion_streak: number;
          /** Provenance of the displayed level — see `profiles_level_source_check`. */
          level_source: "default" | "manual" | "placement" | "test";
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
          promotion_streak?: number;
          level_source?: "default" | "manual" | "placement" | "test";
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
          /** Null on rows written before test sessions existed. */
          test_session_id: string | null;
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
          test_session_id?: string | null;
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
          test_session_id: string | null;
        };
        Insert: {
          user_id: string;
          text_id: number;
          passed: boolean;
          correct: number;
          total: number;
          completed_at?: string;
          test_session_id?: string | null;
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
      test_sessions: {
        Row: {
          id: string;
          user_id: string;
          text_id: number;
          status: "in_progress" | "completed" | "abandoned";
          started_at: string;
          completed_at: string | null;
          ability_before: number;
          rd_before: number;
          /** Written exactly once, by `finalize_test_session`. */
          ability_after: number | null;
          rd_after: number | null;
          correct: number | null;
          total: number | null;
          score_ratio: number | null;
          passed: boolean | null;
        };
        /**
         * Sessions are never written from the client — there is no RLS write
         * policy and every mutation goes through a SECURITY DEFINER function or
         * the service role. `Insert`/`Update` exist only so the generated shape
         * is complete.
         */
        Insert: {
          id?: string;
          user_id: string;
          text_id: number;
          status?: "in_progress" | "completed" | "abandoned";
          started_at?: string;
          completed_at?: string | null;
          ability_before: number;
          rd_before: number;
          ability_after?: number | null;
          rd_after?: number | null;
          correct?: number | null;
          total?: number | null;
          score_ratio?: number | null;
          passed?: boolean | null;
        };
        Update: Partial<Database["public"]["Tables"]["test_sessions"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "test_sessions_text_id_fkey";
            columns: ["text_id"];
            referencedRelation: "texts";
            referencedColumns: ["id"];
          },
        ];
      };
      test_session_items: {
        Row: {
          session_id: string;
          question_id: number;
          item_position: number;
          /** Snapshotted at start, so mid-test edits cannot change the score. */
          item_difficulty: number;
          selected_idx: number | null;
          is_correct: boolean | null;
          response_ms: number | null;
          /** Null until answered; set once and never cleared. */
          answered_at: string | null;
        };
        Insert: {
          session_id: string;
          question_id: number;
          item_position: number;
          item_difficulty: number;
          selected_idx?: number | null;
          is_correct?: boolean | null;
          response_ms?: number | null;
          answered_at?: string | null;
        };
        Update: Partial<
          Database["public"]["Tables"]["test_session_items"]["Insert"]
        >;
        Relationships: [
          {
            foreignKeyName: "test_session_items_session_id_fkey";
            columns: ["session_id"];
            referencedRelation: "test_sessions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "test_session_items_question_id_fkey";
            columns: ["question_id"];
            referencedRelation: "questions";
            referencedColumns: ["id"];
          },
        ];
      };
      calibration_sessions: {
        Row: {
          id: string;
          user_id: string;
          status: "in_progress" | "completed" | "abandoned";
          started_at: string;
          completed_at: string | null;
          ability_after: number | null;
          rd_after: number | null;
          items: number | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          status?: "in_progress" | "completed" | "abandoned";
          started_at?: string;
          completed_at?: string | null;
          ability_after?: number | null;
          rd_after?: number | null;
          items?: number | null;
        };
        Update: Partial<
          Database["public"]["Tables"]["calibration_sessions"]["Insert"]
        >;
        Relationships: [];
      };
      calibration_session_items: {
        Row: {
          session_id: string;
          question_id: number;
          item_position: number;
          item_difficulty: number;
          selected_idx: number;
          is_correct: boolean;
          response_ms: number | null;
          answered_at: string;
        };
        Insert: {
          session_id: string;
          question_id: number;
          item_position: number;
          item_difficulty: number;
          selected_idx: number;
          is_correct: boolean;
          response_ms?: number | null;
          answered_at?: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["calibration_session_items"]["Insert"]
        >;
        Relationships: [
          {
            foreignKeyName: "calibration_session_items_session_id_fkey";
            columns: ["session_id"];
            referencedRelation: "calibration_sessions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "calibration_session_items_question_id_fkey";
            columns: ["question_id"];
            referencedRelation: "calibration_questions";
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
      bump_word_review: {
        Args: Record<string, never>;
        Returns: number;
      };
      set_manual_level: {
        Args: { p_ability: number; p_rd: number };
        Returns: {
          ability: number;
          rd: number;
          answered: number;
          cefr_estimate: string | null;
        }[];
      };
      start_test_session: {
        Args: { p_text_id: number };
        Returns: string;
      };
      get_test_session: {
        Args: { p_session_id: string };
        Returns: {
          question_id: number;
          item_position: number;
          prompt: string;
          options: string[];
          item_difficulty: number;
          selected_idx: number | null;
          is_correct: boolean | null;
          answered_at: string | null;
        }[];
      };
      answer_test_question: {
        Args: {
          p_session_id: string;
          p_question_id: number;
          p_selected_idx: number;
          p_response_ms: number | null;
        };
        Returns: {
          is_answer_correct: boolean;
          answer_key_idx: number;
          already_answered: boolean;
        }[];
      };
      /** service_role only — EXECUTE is revoked from anon/authenticated. */
      finalize_test_session: {
        Args: {
          p_session_id: string;
          p_user_id: string;
          p_ability_before: number;
          p_ability_after: number;
          p_rd_after: number;
          p_cefr_estimate: string;
          p_promotion_streak: number;
          p_passed: boolean;
        };
        Returns: {
          correct_count: number;
          total_count: number;
          ability_start: number;
          ability_end: number;
          rd_end: number;
          test_passed: boolean;
          profile_answered: number;
          already_finalized: boolean;
        }[];
      };
      start_calibration_session: {
        Args: Record<string, never>;
        Returns: string;
      };
      answer_calibration_question: {
        Args: {
          p_session_id: string;
          p_question_id: number;
          p_selected_idx: number;
          p_response_ms: number | null;
        };
        Returns: {
          is_answer_correct: boolean;
          answer_key_idx: number;
          item_difficulty: number;
          already_answered: boolean;
        }[];
      };
      get_calibration_session_answers: {
        Args: { p_session_id: string };
        Returns: {
          question_id: number;
          item_position: number;
          item_difficulty: number;
          is_correct: boolean;
        }[];
      };
      /** service_role only — EXECUTE is revoked from anon/authenticated. */
      finalize_calibration_session: {
        Args: {
          p_session_id: string;
          p_user_id: string;
          p_ability: number;
          p_rd: number;
          p_cefr_estimate: string;
        };
        Returns: {
          ability_value: number;
          rd_value: number;
          profile_answered: number;
          cefr_value: string | null;
          item_count: number;
          already_finalized: boolean;
        }[];
      };
    };
    Enums: Record<never, never>;
    CompositeTypes: Record<never, never>;
  };
};
