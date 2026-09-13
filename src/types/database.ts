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
          /** Which skill the item exercises. Defaults to reading comprehension. */
          skill_code: string;
          /** Set only when the item was written to test one dictionary word. */
          tested_word_id: number | null;
          created_at: string;
        };
        Insert: {
          id?: number;
          text_id: number;
          prompt: string;
          options: string[];
          correct_idx: number;
          difficulty?: number;
          skill_code?: string;
          tested_word_id?: number | null;
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
          /** Learning-engine skill code, backfilled from the coarse `skill`. */
          skill_code: string | null;
          tested_word_id: number | null;
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
          skill_code?: string | null;
          tested_word_id?: number | null;
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
          /** IANA zone deciding when the learner's day starts. See `learning_day`. */
          timezone: string;
          /** Daily learning budget in minutes — the unit a plan is built in. */
          daily_learning_minutes: number;
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
          timezone?: string;
          daily_learning_minutes?: number;
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
      // ─── Learning engine ───────────────────────────────────────────────
      skills: {
        Row: {
          code: string;
          label_pl: string;
          description: string;
          is_assessed: boolean;
          sort_order: number;
        };
        Insert: {
          code: string;
          label_pl: string;
          description: string;
          is_assessed?: boolean;
          sort_order?: number;
        };
        Update: Partial<Database["public"]["Tables"]["skills"]["Insert"]>;
        Relationships: [];
      };
      concepts: {
        Row: {
          code: string;
          skill_code: string;
          category: "grammar" | "vocabulary" | "reading" | "listening";
          label_pl: string;
          description: string;
          sort_order: number;
        };
        Insert: {
          code: string;
          skill_code: string;
          category: "grammar" | "vocabulary" | "reading" | "listening";
          label_pl: string;
          description: string;
          sort_order?: number;
        };
        Update: Partial<Database["public"]["Tables"]["concepts"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "concepts_skill_code_fkey";
            columns: ["skill_code"];
            referencedRelation: "skills";
            referencedColumns: ["code"];
          },
        ];
      };
      question_concepts: {
        Row: { question_id: number; concept_code: string };
        Insert: { question_id: number; concept_code: string };
        Update: Partial<
          Database["public"]["Tables"]["question_concepts"]["Insert"]
        >;
        Relationships: [
          {
            foreignKeyName: "question_concepts_question_id_fkey";
            columns: ["question_id"];
            referencedRelation: "questions";
            referencedColumns: ["id"];
          },
        ];
      };
      calibration_question_concepts: {
        Row: { question_id: number; concept_code: string };
        Insert: { question_id: number; concept_code: string };
        Update: Partial<
          Database["public"]["Tables"]["calibration_question_concepts"]["Insert"]
        >;
        Relationships: [
          {
            foreignKeyName: "calibration_question_concepts_question_id_fkey";
            columns: ["question_id"];
            referencedRelation: "calibration_questions";
            referencedColumns: ["id"];
          },
        ];
      };
      /**
       * Append-only evidence log. There is no RLS write policy: rows are
       * created only by the SECURITY DEFINER functions, so `Insert`/`Update`
       * exist here only to keep the generated shape complete.
       */
      learning_events: {
        Row: {
          id: number;
          user_id: string;
          event_key: string;
          event_type: string;
          occurred_at: string;
          skill_code: string | null;
          response_mode: string;
          retrieval_type: string;
          is_correct: boolean | null;
          response_ms: number | null;
          hints_used: number;
          source_kind: string;
          origin: "native" | "legacy_backfill" | "import";
          text_id: number | null;
          question_id: number | null;
          calibration_question_id: number | null;
          word_id: number | null;
          test_session_id: string | null;
          calibration_session_id: string | null;
          review_event_id: number | null;
          metadata: Json;
          created_at: string;
        };
        Insert: {
          id?: number;
          user_id: string;
          event_key: string;
          event_type: string;
          occurred_at?: string;
          skill_code?: string | null;
          response_mode: string;
          retrieval_type: string;
          is_correct?: boolean | null;
          response_ms?: number | null;
          hints_used?: number;
          source_kind: string;
          origin?: "native" | "legacy_backfill" | "import";
          text_id?: number | null;
          question_id?: number | null;
          calibration_question_id?: number | null;
          word_id?: number | null;
          test_session_id?: string | null;
          calibration_session_id?: string | null;
          review_event_id?: number | null;
          metadata?: Json;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["learning_events"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "learning_events_word_id_fkey";
            columns: ["word_id"];
            referencedRelation: "words";
            referencedColumns: ["id"];
          },
        ];
      };
      learning_event_concepts: {
        Row: { event_id: number; concept_code: string };
        Insert: { event_id: number; concept_code: string };
        Update: Partial<
          Database["public"]["Tables"]["learning_event_concepts"]["Insert"]
        >;
        Relationships: [
          {
            foreignKeyName: "learning_event_concepts_event_id_fkey";
            columns: ["event_id"];
            referencedRelation: "learning_events";
            referencedColumns: ["id"];
          },
        ];
      };
      /** Full spaced-repetition history: one row per graded card, before→after. */
      review_events: {
        Row: {
          id: number;
          user_id: string;
          word_id: number;
          reviewed_at: string;
          interaction_id: string;
          rating: "again" | "hard" | "good" | "easy";
          mode: "flashcard" | "quiz" | "typed_recall" | "listening";
          direction: "de_to_pl" | "pl_to_de";
          repetitions_before: number | null;
          interval_before: number | null;
          ease_before: number | null;
          due_before: string | null;
          repetitions_after: number;
          interval_after: number;
          ease_after: number;
          due_after: string;
          response_ms: number | null;
          source_kind: string;
          origin: "native" | "legacy_backfill" | "import";
        };
        Insert: {
          id?: number;
          user_id: string;
          word_id: number;
          reviewed_at?: string;
          interaction_id: string;
          rating: "again" | "hard" | "good" | "easy";
          mode: "flashcard" | "quiz" | "typed_recall" | "listening";
          direction: "de_to_pl" | "pl_to_de";
          repetitions_before?: number | null;
          interval_before?: number | null;
          ease_before?: number | null;
          due_before?: string | null;
          repetitions_after: number;
          interval_after: number;
          ease_after: number;
          due_after: string;
          response_ms?: number | null;
          source_kind?: string;
          origin?: "native" | "legacy_backfill" | "import";
        };
        Update: Partial<Database["public"]["Tables"]["review_events"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "review_events_word_id_fkey";
            columns: ["word_id"];
            referencedRelation: "words";
            referencedColumns: ["id"];
          },
        ];
      };
      user_skill_state: {
        Row: {
          user_id: string;
          skill_code: string;
          /** 0–1 heuristic estimate — NOT a CEFR level. Null means no evidence. */
          score: number | null;
          confidence: number;
          evidence_weight: number;
          success_weight: number;
          evidence_count: number;
          successful_evidence: number;
          failed_evidence: number;
          source_kinds: string[];
          first_evidence_at: string | null;
          last_evidence_at: string | null;
          model_version: string;
          /** Optimistic-concurrency token; see `apply_learning_evidence`. */
          version: number;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          skill_code: string;
          score?: number | null;
          confidence?: number;
          evidence_weight?: number;
          success_weight?: number;
          evidence_count?: number;
          successful_evidence?: number;
          failed_evidence?: number;
          source_kinds?: string[];
          first_evidence_at?: string | null;
          last_evidence_at?: string | null;
          model_version?: string;
          version?: number;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["user_skill_state"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "user_skill_state_skill_code_fkey";
            columns: ["skill_code"];
            referencedRelation: "skills";
            referencedColumns: ["code"];
          },
        ];
      };
      user_concept_state: {
        Row: {
          user_id: string;
          concept_code: string;
          score: number | null;
          confidence: number;
          evidence_weight: number;
          success_weight: number;
          evidence_count: number;
          successful_evidence: number;
          failed_evidence: number;
          source_kinds: string[];
          first_evidence_at: string | null;
          last_evidence_at: string | null;
          last_success_at: string | null;
          last_failure_at: string | null;
          model_version: string;
          version: number;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          concept_code: string;
          score?: number | null;
          confidence?: number;
          evidence_weight?: number;
          success_weight?: number;
          evidence_count?: number;
          successful_evidence?: number;
          failed_evidence?: number;
          source_kinds?: string[];
          first_evidence_at?: string | null;
          last_evidence_at?: string | null;
          last_success_at?: string | null;
          last_failure_at?: string | null;
          model_version?: string;
          version?: number;
          updated_at?: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["user_concept_state"]["Insert"]
        >;
        Relationships: [
          {
            foreignKeyName: "user_concept_state_concept_code_fkey";
            columns: ["concept_code"];
            referencedRelation: "concepts";
            referencedColumns: ["code"];
          },
        ];
      };
      /**
       * Knowledge of a word — separate from `saved_words`, which only schedules
       * it. The two channels never feed each other.
       */
      user_word_knowledge: {
        Row: {
          user_id: string;
          word_id: number;
          first_seen_at: string | null;
          last_seen_at: string | null;
          last_success_at: string | null;
          last_failure_at: string | null;
          exposure_count: number;
          successful_retrievals: number;
          failed_retrievals: number;
          receptive_score: number | null;
          receptive_confidence: number;
          receptive_evidence_weight: number;
          receptive_success_weight: number;
          receptive_evidence_count: number;
          receptive_last_at: string | null;
          active_score: number | null;
          active_confidence: number;
          active_evidence_weight: number;
          active_success_weight: number;
          active_evidence_count: number;
          active_last_at: string | null;
          source_kinds: string[];
          model_version: string;
          version: number;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          word_id: number;
          first_seen_at?: string | null;
          last_seen_at?: string | null;
          last_success_at?: string | null;
          last_failure_at?: string | null;
          exposure_count?: number;
          successful_retrievals?: number;
          failed_retrievals?: number;
          receptive_score?: number | null;
          receptive_confidence?: number;
          receptive_evidence_weight?: number;
          receptive_success_weight?: number;
          receptive_evidence_count?: number;
          receptive_last_at?: string | null;
          active_score?: number | null;
          active_confidence?: number;
          active_evidence_weight?: number;
          active_success_weight?: number;
          active_evidence_count?: number;
          active_last_at?: string | null;
          source_kinds?: string[];
          model_version?: string;
          version?: number;
          updated_at?: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["user_word_knowledge"]["Insert"]
        >;
        Relationships: [
          {
            foreignKeyName: "user_word_knowledge_word_id_fkey";
            columns: ["word_id"];
            referencedRelation: "words";
            referencedColumns: ["id"];
          },
        ];
      };
      /**
       * "This learner opened this passage" — the minimal reading state the Today
       * planner needs to recommend finishing something rather than starting
       * something. Not a reader session; see the Today engine migration.
       */
      text_progress: {
        Row: {
          user_id: string;
          text_id: number;
          first_opened_at: string;
          last_opened_at: string;
          open_count: number;
        };
        Insert: {
          user_id: string;
          text_id: number;
          first_opened_at?: string;
          last_opened_at?: string;
          open_count?: number;
        };
        Update: Partial<Database["public"]["Tables"]["text_progress"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "text_progress_text_id_fkey";
            columns: ["text_id"];
            referencedRelation: "texts";
            referencedColumns: ["id"];
          },
        ];
      };
      /** One learning day's plan. Unique per (user, learning_date). */
      daily_plans: {
        Row: {
          id: string;
          user_id: string;
          /** The LEARNER's date, from `profiles.timezone` — never `current_date`. */
          learning_date: string;
          timezone: string;
          status: "pending" | "in_progress" | "completed";
          target_minutes: number;
          estimated_minutes: number;
          algorithm_version: string;
          evidence_level: "none" | "low" | "medium" | "high";
          created_at: string;
          started_at: string | null;
          completed_at: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          learning_date: string;
          timezone: string;
          status?: "pending" | "in_progress" | "completed";
          target_minutes: number;
          estimated_minutes?: number;
          algorithm_version: string;
          evidence_level?: "none" | "low" | "medium" | "high";
          created_at?: string;
          started_at?: string | null;
          completed_at?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["daily_plans"]["Insert"]>;
        Relationships: [];
      };
      /** One activity of a plan, snapshotted with the reason it was chosen. */
      daily_plan_items: {
        Row: {
          id: string;
          plan_id: string;
          item_position: number;
          item_type:
            | "placement"
            | "review_due"
            | "weakness_practice"
            | "continue_text"
            | "new_text"
            | "new_vocabulary";
          status: "pending" | "in_progress" | "completed" | "skipped";
          estimated_minutes: number;
          priority_score: number;
          reason_code: string;
          reason_data: Json;
          signals: Json;
          target_count: number;
          completed_count: number;
          text_id: number | null;
          concept_code: string | null;
          word_ids: number[];
          payload: Json;
          started_at: string | null;
          completed_at: string | null;
        };
        Insert: {
          id?: string;
          plan_id: string;
          item_position: number;
          item_type: string;
          status?: "pending" | "in_progress" | "completed" | "skipped";
          estimated_minutes: number;
          priority_score?: number;
          reason_code: string;
          reason_data?: Json;
          signals?: Json;
          target_count?: number;
          completed_count?: number;
          text_id?: number | null;
          concept_code?: string | null;
          word_ids?: number[];
          payload?: Json;
          started_at?: string | null;
          completed_at?: string | null;
        };
        Update: Partial<
          Database["public"]["Tables"]["daily_plan_items"]["Insert"]
        >;
        Relationships: [
          {
            foreignKeyName: "daily_plan_items_plan_id_fkey";
            columns: ["plan_id"];
            referencedRelation: "daily_plans";
            referencedColumns: ["id"];
          },
        ];
      };
      /** One weakness drill, modelled on `test_sessions` but never Elo-scored. */
      practice_sessions: {
        Row: {
          id: string;
          user_id: string;
          concept_code: string;
          plan_item_id: string | null;
          status: "in_progress" | "completed" | "abandoned";
          started_at: string;
          completed_at: string | null;
          correct: number | null;
          total: number | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          concept_code: string;
          plan_item_id?: string | null;
          status?: "in_progress" | "completed" | "abandoned";
          started_at?: string;
          completed_at?: string | null;
          correct?: number | null;
          total?: number | null;
        };
        Update: Partial<
          Database["public"]["Tables"]["practice_sessions"]["Insert"]
        >;
        Relationships: [
          {
            foreignKeyName: "practice_sessions_plan_item_id_fkey";
            columns: ["plan_item_id"];
            referencedRelation: "daily_plan_items";
            referencedColumns: ["id"];
          },
        ];
      };
      practice_session_items: {
        Row: {
          session_id: string;
          question_id: number;
          item_position: number;
          item_difficulty: number;
          selected_idx: number | null;
          is_correct: boolean | null;
          response_ms: number | null;
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
          Database["public"]["Tables"]["practice_session_items"]["Insert"]
        >;
        Relationships: [
          {
            foreignKeyName: "practice_session_items_session_id_fkey";
            columns: ["session_id"];
            referencedRelation: "practice_sessions";
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
          skill_code: string;
          tested_word_id: number | null;
          /** Concept codes this item exercises; empty when untagged. */
          concepts: string[];
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
          skill_code: string | null;
          tested_word_id: number | null;
          concepts: string[];
        };
        Relationships: [];
      };
      /**
       * How many published questions exist per concept. The planner refuses to
       * propose a drill with nothing behind it; admins read the same view to see
       * where the item bank has holes.
       */
      concept_practice_pool: {
        Row: {
          concept_code: string;
          question_count: number;
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
          /** Learning evidence applied in the same transaction. */
          p_evidence: Json;
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
          response_ms: number | null;
          answered_at: string;
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
          p_evidence: Json;
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
      /**
       * One review interaction, applied atomically: review event, SM-2 schedule,
       * daily counter and learning evidence. service_role only — it takes a user
       * id, so a role a browser can hold must never reach it.
       */
      apply_review: {
        Args: {
          p_user_id: string;
          p_interaction_id: string;
          p_word_id: number;
          p_rating: "again" | "hard" | "good" | "easy";
          p_mode: "flashcard" | "quiz" | "typed_recall" | "listening";
          p_direction: "de_to_pl" | "pl_to_de";
          p_response_ms: number | null;
          p_srs: Json;
          p_evidence: Json;
        };
        Returns: {
          review_event_id: number;
          due_at: string;
          is_mastered: boolean;
          interval_days: number;
          repetitions: number;
          ease_factor: number;
          reviewed_today: number;
          already_applied: boolean;
        }[];
      };
      /** Records that the learner opened a passage. Derives the user from auth.uid(). */
      mark_text_opened: {
        Args: { p_text_id: number };
        Returns: undefined;
      };
      /**
       * Writes one learning day's plan. service_role only — it accepts computed
       * priorities, so a browser must never be able to reach it.
       */
      create_daily_plan: {
        Args: {
          p_user_id: string;
          p_learning_date: string;
          p_timezone: string;
          p_target_minutes: number;
          p_algorithm_version: string;
          p_evidence_level: string;
          p_items: Json;
          p_replace_onboarding?: boolean;
        };
        Returns: string;
      };
      /**
       * Recomputes every item's progress from the tables that recorded the
       * underlying activity. Idempotent by construction; there is no
       * "mark complete" write path anywhere in Fluent.
       */
      sync_daily_plan: {
        Args: { p_plan_id: string };
        Returns: {
          item_id: string;
          item_status: string;
          completed_count: number;
          plan_status: string;
        }[];
      };
      /** "Not today." Sets `skipped`, never `completed`. */
      skip_daily_plan_item: {
        Args: { p_item_id: string };
        Returns: string;
      };
      start_practice_session: {
        Args: {
          p_concept_code: string;
          p_plan_item_id: string | null;
          p_limit: number;
        };
        Returns: string;
      };
      get_practice_session: {
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
      answer_practice_question: {
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
      finalize_practice_session: {
        Args: {
          p_session_id: string;
          p_user_id: string;
          p_evidence: Json;
        };
        Returns: {
          correct_count: number;
          total_count: number;
          already_finalized: boolean;
        }[];
      };
    };
    Enums: Record<never, never>;
    CompositeTypes: Record<never, never>;
  };
};
