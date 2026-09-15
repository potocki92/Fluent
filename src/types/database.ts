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
          /** Reader typography and theme. Learner-owned, like `daily_word_goal`. */
          reader_preferences: Json;
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
          reader_preferences?: Json;
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
          /**
           * Where the card was met. Written once, by `save_word_from_reader`.
           * `origin_context` holds the SENTENCE TEXT, not a reference to it, so a
           * deleted book or a reprocessed chapter cannot empty the card.
           */
          origin_library_item_id: string | null;
          origin_chapter_id: string | null;
          origin_sentence_id: number | null;
          origin_occurrence_id: number | null;
          origin_context: string | null;
          origin_surface: string | null;
          /**
           * Where in `origin_context` the word stood. The contextual cloze cuts
           * at these rather than searching for the surface, which would blank the
           * wrong one whenever a sentence repeats it.
           */
          origin_char_start: number | null;
          origin_char_end: number | null;
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
          origin_library_item_id?: string | null;
          origin_chapter_id?: string | null;
          origin_sentence_id?: number | null;
          origin_occurrence_id?: number | null;
          origin_context?: string | null;
          origin_surface?: string | null;
          origin_char_start?: number | null;
          origin_char_end?: number | null;
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
      /**
       * One learner's own translation of, and difficulty flag on, one sentence.
       *
       * Anchored on `(chapter_id, sentence_position)` rather than on
       * `sentence_id`: reprocessing a chapter replaces every sentence row, and a
       * note must survive that. `sentence_text` is the German as it read when
       * the note was taken, which is what the notebook renders and what
       * `isNoteStale` compares against.
       */
      user_sentence_notes: {
        Row: {
          id: number;
          user_id: string;
          chapter_id: string;
          library_item_id: string;
          sentence_position: number;
          sentence_id: number | null;
          sentence_text: string;
          content_version: string;
          translation: string | null;
          is_unclear: boolean;
          unclear_at: string | null;
          resolved_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      /**
       * A span of tokens inside one sentence, with the learner's own meaning.
       *
       * One token is a contextual word meaning — a PERSONAL WORD when `word_id`
       * is null, i.e. one the shared dictionary does not know. Two or more is a
       * phrase. `word_id` is a reference to `words`, never a write path into it.
       */
      user_text_annotations: {
        Row: {
          id: number;
          user_id: string;
          kind: "word" | "phrase";
          chapter_id: string;
          library_item_id: string;
          sentence_position: number;
          sentence_id: number | null;
          start_position: number;
          end_position: number;
          start_occurrence_id: number | null;
          end_occurrence_id: number | null;
          char_start: number;
          char_end: number;
          surface: string;
          sentence_text: string;
          content_version: string;
          word_id: number | null;
          lemma: string | null;
          meaning: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [
          {
            foreignKeyName: "user_text_annotations_word_id_fkey";
            columns: ["word_id"];
            referencedRelation: "words";
            referencedColumns: ["id"];
          },
        ];
      };
      /**
       * The SM-2 schedule for a notebook item the learner opted into reviewing.
       * Same algorithm as `saved_words` (`src/lib/sm2.ts`), different item.
       */
      user_notebook_reviews: {
        Row: {
          id: number;
          user_id: string;
          annotation_id: number | null;
          sentence_note_id: number | null;
          interval: number;
          repetitions: number;
          ease_factor: number;
          due_at: string;
          is_mastered: boolean;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [
          {
            foreignKeyName: "user_notebook_reviews_annotation_id_fkey";
            columns: ["annotation_id"];
            referencedRelation: "user_text_annotations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "user_notebook_reviews_sentence_note_id_fkey";
            columns: ["sentence_note_id"];
            referencedRelation: "user_sentence_notes";
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
       * A readable thing: a story, a book, an article, or one of the graded
       * passages that existed before the library did (`legacy_text_id`).
       */
      library_items: {
        Row: {
          id: string;
          slug: string;
          title: string;
          subtitle: string | null;
          author: string | null;
          language: string;
          description: string | null;
          cover_url: string | null;
          content_type: "story" | "book" | "article" | "lesson";
          /** Decides who may see it at all. `private_import` is owner-only. */
          rights: "first_party" | "public_domain" | "licensed" | "private_import";
          rights_note: string | null;
          /** Set if and only if `rights = 'private_import'`. */
          owner_user_id: string | null;
          source_type: string | null;
          source_url: string | null;
          status: "draft" | "processing" | "ready" | "published" | "failed";
          cefr_estimate: "A1" | "A2" | "B1" | "B2" | null;
          word_count: number;
          chapter_count: number;
          /** Soft delete: withdrawn without destroying anyone's reading history. */
          archived_at: string | null;
          published_at: string | null;
          created_at: string;
          updated_at: string;
          /** The `texts` row this item was migrated from, if any. */
          legacy_text_id: number | null;
        };
        Insert: {
          id?: string;
          slug: string;
          title: string;
          subtitle?: string | null;
          author?: string | null;
          language?: string;
          description?: string | null;
          cover_url?: string | null;
          content_type?: "story" | "book" | "article" | "lesson";
          rights?: "first_party" | "public_domain" | "licensed" | "private_import";
          rights_note?: string | null;
          owner_user_id?: string | null;
          source_type?: string | null;
          source_url?: string | null;
          status?: "draft" | "processing" | "ready" | "published" | "failed";
          cefr_estimate?: "A1" | "A2" | "B1" | "B2" | null;
          word_count?: number;
          chapter_count?: number;
          archived_at?: string | null;
          published_at?: string | null;
          created_at?: string;
          updated_at?: string;
          legacy_text_id?: number | null;
        };
        Update: Partial<Database["public"]["Tables"]["library_items"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "library_items_legacy_text_id_fkey";
            columns: ["legacy_text_id"];
            referencedRelation: "texts";
            referencedColumns: ["id"];
          },
        ];
      };
      /** One chapter — the unit of reading, of loading, and of progress. */
      chapters: {
        Row: {
          id: string;
          library_item_id: string;
          /** 1-based, unique within the item, and part of the URL. */
          position: number;
          title: string | null;
          subtitle: string | null;
          /** The raw text this chapter was built from; reprocessing reads it. */
          source_text: string;
          word_count: number;
          paragraph_count: number;
          sentence_count: number;
          estimated_reading_minutes: number;
          cefr_estimate: "A1" | "A2" | "B1" | "B2" | null;
          status: "draft" | "processing" | "ready" | "failed";
          /** Which pipeline built the structure. See `CONTENT_PROCESSOR_VERSION`. */
          processor_version: string | null;
          content_hash: string | null;
          processed_at: string | null;
          processing_error: string | null;
          /** Share of content words the dictionary can gloss, 0–1. */
          dictionary_match_rate: number | null;
          unmatched_sample: Json;
          vocabulary_stats: Json;
          /** Set when the chapter came from a private book import. */
          import_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          library_item_id: string;
          position: number;
          title?: string | null;
          subtitle?: string | null;
          source_text?: string;
          word_count?: number;
          paragraph_count?: number;
          sentence_count?: number;
          estimated_reading_minutes?: number;
          cefr_estimate?: "A1" | "A2" | "B1" | "B2" | null;
          status?: "draft" | "processing" | "ready" | "failed";
          processor_version?: string | null;
          content_hash?: string | null;
          processed_at?: string | null;
          processing_error?: string | null;
          dictionary_match_rate?: number | null;
          unmatched_sample?: Json;
          vocabulary_stats?: Json;
          import_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["chapters"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "chapters_library_item_id_fkey";
            columns: ["library_item_id"];
            referencedRelation: "library_items";
            referencedColumns: ["id"];
          },
        ];
      };
      /**
       * One uploaded file on its way to becoming a private book.
       *
       * Owner-readable, and writable by nobody: every change goes through a
       * SECURITY DEFINER function that derives the owner from `auth.uid()`.
       */
      book_imports: {
        Row: {
          id: string;
          user_id: string;
          file_name: string;
          file_type: "pdf" | "epub" | "txt";
          file_size: number;
          /** SHA-256 of the original. Drives a duplicate warning, nothing more. */
          file_hash: string | null;
          /** `<user_id>/<import_id>/original.<ext>`; minted server-side. */
          storage_path: string;
          status:
            | "uploaded"
            | "extracting"
            | "analyzing"
            | "awaiting_review"
            | "importing"
            | "processing"
            | "ready"
            | "failed"
            | "cancelled";
          stage:
            | "extract_text"
            | "detect_metadata"
            | "detect_chapters"
            | "persist_content"
            | "process_chapters"
            | null;
          total_chapters: number;
          processed_chapters: number;
          failed_chapters: number;
          /** What the FILE claimed, kept apart from what the learner confirmed. */
          detected_title: string | null;
          detected_author: string | null;
          detected_language: string | null;
          language_confidence: number | null;
          title: string | null;
          author: string | null;
          page_count: number | null;
          word_count: number;
          chapter_count: number;
          quality: Json;
          pipeline_version: string | null;
          detector_version: string | null;
          /** The idempotency receipt: non-null means this is already a book. */
          final_library_item_id: string | null;
          error_code: string | null;
          error_message: string | null;
          created_at: string;
          updated_at: string;
          analyzed_at: string | null;
          finalized_at: string | null;
        };
        Insert: never;
        Update: never;
        Relationships: [
          {
            foreignKeyName: "book_imports_final_library_item_id_fkey";
            columns: ["final_library_item_id"];
            referencedRelation: "library_items";
            referencedColumns: ["id"];
          },
        ];
      };
      /** A proposed chapter, before the learner has confirmed the import. */
      book_import_chapters: {
        Row: {
          id: string;
          import_id: string;
          /** 1-based and contiguous; kept so by `edit_book_import_chapters`. */
          position: number;
          detected_title: string | null;
          title: string | null;
          source_text: string;
          word_count: number;
          source_page_start: number | null;
          source_page_end: number | null;
          source_href: string | null;
          confidence: "high" | "medium" | "low";
          signals: Json;
          is_front_matter: boolean;
          included: boolean;
          /** True once a learner renamed, split, merged or moved this chapter. */
          edited: boolean;
          chapter_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [
          {
            foreignKeyName: "book_import_chapters_import_id_fkey";
            columns: ["import_id"];
            referencedRelation: "book_imports";
            referencedColumns: ["id"];
          },
        ];
      };
      /** A paragraph of plain text. Positions are stable; progress points at them. */
      paragraphs: {
        Row: {
          id: number;
          chapter_id: string;
          position: number;
          kind: "paragraph" | "heading" | "list_item";
          text: string;
          word_count: number;
          metadata: Json;
        };
        Insert: {
          id?: number;
          chapter_id: string;
          position: number;
          kind?: "paragraph" | "heading" | "list_item";
          text: string;
          word_count?: number;
          metadata?: Json;
        };
        Update: Partial<Database["public"]["Tables"]["paragraphs"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "paragraphs_chapter_id_fkey";
            columns: ["chapter_id"];
            referencedRelation: "chapters";
            referencedColumns: ["id"];
          },
        ];
      };
      /**
       * One sentence. The anchor contextual help will attach to — translation,
       * simplification and grammar notes are reserved here and stay null.
       */
      sentences: {
        Row: {
          id: number;
          paragraph_id: number;
          chapter_id: string;
          position: number;
          chapter_position: number;
          text: string;
          char_start: number;
          char_end: number;
          word_count: number;
          translation_pl: string | null;
          simplified_de: string | null;
          grammar_notes: Json | null;
          metadata: Json;
        };
        Insert: {
          id?: number;
          paragraph_id: number;
          chapter_id: string;
          position: number;
          chapter_position: number;
          text: string;
          char_start?: number;
          char_end?: number;
          word_count?: number;
          translation_pl?: string | null;
          simplified_de?: string | null;
          grammar_notes?: Json | null;
          metadata?: Json;
        };
        Update: Partial<Database["public"]["Tables"]["sentences"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "sentences_paragraph_id_fkey";
            columns: ["paragraph_id"];
            referencedRelation: "paragraphs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "sentences_chapter_id_fkey";
            columns: ["chapter_id"];
            referencedRelation: "chapters";
            referencedColumns: ["id"];
          },
        ];
      };
      /** "This word, in this sentence, here." The datum behind the old `<mark>`. */
      word_occurrences: {
        Row: {
          id: number;
          sentence_id: number;
          chapter_id: string;
          position: number;
          surface: string;
          normalized: string;
          lemma: string;
          word_id: number | null;
          char_start: number;
          char_end: number;
          metadata: Json;
        };
        Insert: {
          id?: number;
          sentence_id: number;
          chapter_id: string;
          position: number;
          surface: string;
          normalized: string;
          lemma: string;
          word_id?: number | null;
          char_start?: number;
          char_end?: number;
          metadata?: Json;
        };
        Update: Partial<
          Database["public"]["Tables"]["word_occurrences"]["Insert"]
        >;
        Relationships: [
          {
            foreignKeyName: "word_occurrences_sentence_id_fkey";
            columns: ["sentence_id"];
            referencedRelation: "sentences";
            referencedColumns: ["id"];
          },
        ];
      };
      /** The chapter's distinct dictionary words, aggregated at processing time. */
      chapter_vocabulary: {
        Row: {
          chapter_id: string;
          word_id: number;
          occurrence_count: number;
          first_paragraph_position: number;
          first_sentence_position: number;
        };
        Insert: {
          chapter_id: string;
          word_id: number;
          occurrence_count?: number;
          first_paragraph_position?: number;
          first_sentence_position?: number;
        };
        Update: Partial<
          Database["public"]["Tables"]["chapter_vocabulary"]["Insert"]
        >;
        Relationships: [
          {
            foreignKeyName: "chapter_vocabulary_word_id_fkey";
            columns: ["word_id"];
            referencedRelation: "words";
            referencedColumns: ["id"];
          },
        ];
      };
      /**
       * Where a learner is in a chapter.
       *
       * `resume_*` follows them in both directions; `furthest_*` only ever
       * increases and is the only input to `progress_ratio` and completion.
       * Read-only to its owner — every write goes through a SECURITY DEFINER
       * function.
       */
      reading_progress: {
        Row: {
          user_id: string;
          chapter_id: string;
          library_item_id: string;
          started_at: string;
          last_read_at: string;
          completed_at: string | null;
          resume_paragraph_position: number;
          resume_sentence_position: number | null;
          furthest_paragraph_position: number;
          progress_ratio: number;
          active_seconds: number;
          lookup_count: number;
          session_count: number;
        };
        Insert: {
          user_id: string;
          chapter_id: string;
          library_item_id: string;
          started_at?: string;
          last_read_at?: string;
          completed_at?: string | null;
          resume_paragraph_position?: number;
          resume_sentence_position?: number | null;
          furthest_paragraph_position?: number;
          progress_ratio?: number;
          active_seconds?: number;
          lookup_count?: number;
          session_count?: number;
        };
        Update: Partial<
          Database["public"]["Tables"]["reading_progress"]["Insert"]
        >;
        Relationships: [
          {
            foreignKeyName: "reading_progress_chapter_id_fkey";
            columns: ["chapter_id"];
            referencedRelation: "chapters";
            referencedColumns: ["id"];
          },
        ];
      };
      /** One sitting with a chapter. `active_seconds` is active, not wall, time. */
      reading_sessions: {
        Row: {
          id: string;
          user_id: string;
          chapter_id: string;
          library_item_id: string;
          started_at: string;
          last_active_at: string;
          ended_at: string | null;
          status: "in_progress" | "ended";
          active_seconds: number;
          words_progressed: number;
          progress_before: number;
          progress_after: number;
          lookup_count: number;
          unique_lookup_count: number;
          sentence_help_count: number;
          saved_word_count: number;
        };
        Insert: {
          id?: string;
          user_id: string;
          chapter_id: string;
          library_item_id: string;
          started_at?: string;
          last_active_at?: string;
          ended_at?: string | null;
          status?: "in_progress" | "ended";
          active_seconds?: number;
          words_progressed?: number;
          progress_before?: number;
          progress_after?: number;
          lookup_count?: number;
          unique_lookup_count?: number;
          sentence_help_count?: number;
          saved_word_count?: number;
        };
        Update: Partial<
          Database["public"]["Tables"]["reading_sessions"]["Insert"]
        >;
        Relationships: [];
      };
      /** Which word, in which sentence, in which chapter, when. */
      reading_lookups: {
        Row: {
          id: number;
          user_id: string;
          chapter_id: string;
          library_item_id: string;
          session_id: string | null;
          sentence_id: number | null;
          occurrence_id: number | null;
          word_id: number;
          /** Minted per tap; the unique key that makes a retry a no-op. */
          interaction_id: string;
          looked_up_at: string;
        };
        Insert: {
          id?: number;
          user_id: string;
          chapter_id: string;
          library_item_id: string;
          session_id?: string | null;
          sentence_id?: number | null;
          occurrence_id?: number | null;
          word_id: number;
          interaction_id: string;
          looked_up_at?: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["reading_lookups"]["Insert"]
        >;
        Relationships: [
          {
            foreignKeyName: "reading_lookups_word_id_fkey";
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
            | "new_vocabulary"
            | "continue_chapter"
            | "new_chapter";
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
          library_item_id: string | null;
          chapter_id: string | null;
          /** Active reading seconds that satisfy this item. Written by the planner. */
          target_seconds: number | null;
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
          library_item_id?: string | null;
          chapter_id?: string | null;
          target_seconds?: number | null;
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
      // ── PHASE 5: THE STORY LEARNING ENGINE ─────────────────────────────────
      // None of these tables has a client write path. Every Row below is
      // readable by its owner (or, for content, by an admin) and writable only
      // through the SECURITY DEFINER functions in the Functions block.

      /**
       * Where a learner is in a chapter's LEARNING lifecycle — which is not the
       * same fact as where they are in reading it. Reading lives in
       * `reading_progress`; this records preparation, the Challenge, and whether
       * one is still outstanding.
       */
      user_chapter_learning_state: {
        Row: {
          user_id: string;
          chapter_id: string;
          library_item_id: string;
          status:
            | "not_started"
            | "prepared"
            | "reading"
            | "read"
            | "assessment_pending"
            | "completed";
          prepared_at: string | null;
          preparation_skipped_at: string | null;
          reading_started_at: string | null;
          reading_completed_at: string | null;
          assessment_deferred_at: string | null;
          assessment_completed_at: string | null;
          story_engine_version: string;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          chapter_id: string;
          library_item_id: string;
          status?: string;
          prepared_at?: string | null;
          preparation_skipped_at?: string | null;
          reading_started_at?: string | null;
          reading_completed_at?: string | null;
          assessment_deferred_at?: string | null;
          assessment_completed_at?: string | null;
          story_engine_version?: string;
          updated_at?: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["user_chapter_learning_state"]["Insert"]
        >;
        Relationships: [
          {
            foreignKeyName: "user_chapter_learning_state_chapter_id_fkey";
            columns: ["chapter_id"];
            referencedRelation: "chapters";
            referencedColumns: ["id"];
          },
        ];
      };

      /**
       * The cached personal analysis of one chapter for one learner.
       *
       * `coverage_status = 'insufficient_data'` is a first-class result, not an
       * error: below the evidence floor there is no honest percentage to show.
       */
      chapter_user_analysis: {
        Row: {
          user_id: string;
          chapter_id: string;
          library_item_id: string;
          coverage_status: "estimated" | "insufficient_data";
          coverage_ratio: number | null;
          coverage_confidence: "none" | "low" | "medium" | "high";
          observed_words: number;
          known_words: number;
          total_words: number;
          difficulty_score: number;
          difficulty_label:
            | "easy"
            | "just_right"
            | "challenging"
            | "very_challenging";
          difficulty_confidence: "none" | "low" | "medium" | "high";
          signals: Json;
          estimated_minutes: number;
          preteach_target_count: number;
          content_hash: string | null;
          story_engine_version: string;
          computed_at: string;
        };
        Insert: {
          user_id: string;
          chapter_id: string;
          library_item_id: string;
          coverage_status: string;
          coverage_ratio?: number | null;
          coverage_confidence?: string;
          observed_words?: number;
          known_words?: number;
          total_words?: number;
          difficulty_score?: number;
          difficulty_label?: string;
          difficulty_confidence?: string;
          signals?: Json;
          estimated_minutes?: number;
          preteach_target_count?: number;
          content_hash?: string | null;
          story_engine_version?: string;
          computed_at?: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["chapter_user_analysis"]["Insert"]
        >;
        Relationships: [
          {
            foreignKeyName: "chapter_user_analysis_chapter_id_fkey";
            columns: ["chapter_id"];
            referencedRelation: "chapters";
            referencedColumns: ["id"];
          },
        ];
      };

      /**
       * The chapter question bank.
       *
       * NOT READABLE FROM A BROWSER. There is no learner SELECT policy — the
       * Row type exists for the service-role and admin paths only, because
       * `correct_idx`, `accepted_answers` and `sequence_items` are the answer
       * key of every Challenge a reader is about to take.
       */
      chapter_questions: {
        Row: {
          id: number;
          chapter_id: string;
          library_item_id: string;
          owner_user_id: string | null;
          kind:
            | "comprehension"
            | "contextual_vocabulary"
            | "grammar"
            | "transfer";
          question_type:
            | "multiple_choice"
            | "true_false"
            | "cloze"
            | "sequence"
            | "multi_select"
            | "typed_answer";
          scope: "local" | "chapter";
          prompt: string;
          options: string[] | null;
          correct_idx: number | null;
          accepted_answers: string[] | null;
          sequence_items: string[] | null;
          skill_code: string;
          word_id: number | null;
          difficulty: number;
          source_sentence_ids: number[];
          explanation_pl: string | null;
          generation_source: "manual" | "ai" | "template";
          generator_version: string | null;
          provider: string | null;
          model: string | null;
          source_content_hash: string | null;
          fingerprint: string;
          status: "draft" | "needs_review" | "published" | "disabled" | "stale";
          validation_status: "valid" | "invalid";
          validation_errors: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          chapter_id: string;
          library_item_id: string;
          owner_user_id?: string | null;
          kind: string;
          question_type: string;
          scope?: string;
          prompt: string;
          options?: string[] | null;
          correct_idx?: number | null;
          accepted_answers?: string[] | null;
          sequence_items?: string[] | null;
          skill_code: string;
          word_id?: number | null;
          difficulty?: number;
          source_sentence_ids?: number[];
          explanation_pl?: string | null;
          generation_source?: string;
          generator_version?: string | null;
          provider?: string | null;
          model?: string | null;
          source_content_hash?: string | null;
          fingerprint: string;
          status?: string;
          validation_status?: string;
          validation_errors?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["chapter_questions"]["Insert"]
        >;
        Relationships: [
          {
            foreignKeyName: "chapter_questions_chapter_id_fkey";
            columns: ["chapter_id"];
            referencedRelation: "chapters";
            referencedColumns: ["id"];
          },
        ];
      };

      chapter_question_concepts: {
        Row: { question_id: number; concept_code: string };
        Insert: { question_id: number; concept_code: string };
        Update: Partial<
          Database["public"]["Tables"]["chapter_question_concepts"]["Insert"]
        >;
        Relationships: [
          {
            foreignKeyName: "chapter_question_concepts_question_id_fkey";
            columns: ["question_id"];
            referencedRelation: "chapter_questions";
            referencedColumns: ["id"];
          },
        ];
      };

      /** Aggregate answering data. Admin-readable; never shown to a learner. */
      chapter_question_stats: {
        Row: {
          question_id: number;
          answer_count: number;
          correct_count: number;
          response_ms_total: number;
          updated_at: string;
        };
        Insert: {
          question_id: number;
          answer_count?: number;
          correct_count?: number;
          response_ms_total?: number;
          updated_at?: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["chapter_question_stats"]["Insert"]
        >;
        Relationships: [
          {
            foreignKeyName: "chapter_question_stats_question_id_fkey";
            columns: ["question_id"];
            referencedRelation: "chapter_questions";
            referencedColumns: ["id"];
          },
        ];
      };

      /** "This question is wrong" — the human check on generated content. */
      chapter_question_reports: {
        Row: {
          id: number;
          question_id: number;
          user_id: string;
          reason:
            | "ambiguous"
            | "wrong_answer"
            | "not_in_chapter"
            | "unclear"
            | "other";
          note: string | null;
          created_at: string;
        };
        Insert: {
          question_id: number;
          user_id: string;
          reason: string;
          note?: string | null;
          created_at?: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["chapter_question_reports"]["Insert"]
        >;
        Relationships: [
          {
            foreignKeyName: "chapter_question_reports_question_id_fkey";
            columns: ["question_id"];
            referencedRelation: "chapter_questions";
            referencedColumns: ["id"];
          },
        ];
      };

      /** One generation run. Records cost and failure; never chapter content. */
      chapter_generation_jobs: {
        Row: {
          id: string;
          chapter_id: string;
          status: "queued" | "running" | "ready" | "failed" | "needs_review";
          generator_version: string;
          content_hash: string | null;
          attempts: number;
          last_attempt_at: string | null;
          error_code: string | null;
          error_message: string | null;
          provider: string | null;
          model: string | null;
          input_tokens: number | null;
          output_tokens: number | null;
          cost_usd: number | null;
          candidate_count: number;
          accepted_count: number;
          rejected_count: number;
          rejections: Json;
          created_at: string;
          updated_at: string;
          finished_at: string | null;
        };
        Insert: {
          chapter_id: string;
          status?: string;
          generator_version: string;
          content_hash?: string | null;
          attempts?: number;
          last_attempt_at?: string | null;
          error_code?: string | null;
          error_message?: string | null;
          provider?: string | null;
          model?: string | null;
          input_tokens?: number | null;
          output_tokens?: number | null;
          cost_usd?: number | null;
          candidate_count?: number;
          accepted_count?: number;
          rejected_count?: number;
          rejections?: Json;
          created_at?: string;
          updated_at?: string;
          finished_at?: string | null;
        };
        Update: Partial<
          Database["public"]["Tables"]["chapter_generation_jobs"]["Insert"]
        >;
        Relationships: [
          {
            foreignKeyName: "chapter_generation_jobs_chapter_id_fkey";
            columns: ["chapter_id"];
            referencedRelation: "chapters";
            referencedColumns: ["id"];
          },
        ];
      };

      chapter_preparation_sessions: {
        Row: {
          id: string;
          user_id: string;
          chapter_id: string;
          library_item_id: string;
          plan_item_id: string | null;
          status: "in_progress" | "completed" | "skipped" | "abandoned";
          started_at: string;
          completed_at: string | null;
          correct: number | null;
          total: number | null;
          story_engine_version: string;
          selection_signals: Json;
        };
        Insert: {
          user_id: string;
          chapter_id: string;
          library_item_id: string;
          plan_item_id?: string | null;
          status?: string;
          started_at?: string;
          completed_at?: string | null;
          correct?: number | null;
          total?: number | null;
          story_engine_version?: string;
          selection_signals?: Json;
        };
        Update: Partial<
          Database["public"]["Tables"]["chapter_preparation_sessions"]["Insert"]
        >;
        Relationships: [
          {
            foreignKeyName: "chapter_preparation_sessions_chapter_id_fkey";
            columns: ["chapter_id"];
            referencedRelation: "chapters";
            referencedColumns: ["id"];
          },
        ];
      };

      chapter_preparation_items: {
        Row: {
          session_id: string;
          word_id: number;
          item_position: number;
          lemma: string;
          display: string;
          translation: string;
          options: string[];
          correct_idx: number;
          context_sentence: string | null;
          context_source: "chapter_opening" | "dictionary" | "none";
          sentence_id: number | null;
          selected_idx: number | null;
          is_correct: boolean | null;
          response_ms: number | null;
          answered_at: string | null;
        };
        Insert: {
          session_id: string;
          word_id: number;
          item_position: number;
          lemma: string;
          display: string;
          translation: string;
          options: string[];
          correct_idx: number;
          context_sentence?: string | null;
          context_source?: string;
          sentence_id?: number | null;
          selected_idx?: number | null;
          is_correct?: boolean | null;
          response_ms?: number | null;
          answered_at?: string | null;
        };
        Update: Partial<
          Database["public"]["Tables"]["chapter_preparation_items"]["Insert"]
        >;
        Relationships: [
          {
            foreignKeyName: "chapter_preparation_items_session_id_fkey";
            columns: ["session_id"];
            referencedRelation: "chapter_preparation_sessions";
            referencedColumns: ["id"];
          },
        ];
      };

      chapter_assessment_sessions: {
        Row: {
          id: string;
          user_id: string;
          chapter_id: string;
          library_item_id: string;
          plan_item_id: string | null;
          status: "in_progress" | "completed" | "abandoned";
          started_at: string;
          completed_at: string | null;
          correct: number | null;
          total: number | null;
          comprehension_correct: number | null;
          comprehension_total: number | null;
          vocabulary_correct: number | null;
          vocabulary_total: number | null;
          grammar_correct: number | null;
          grammar_total: number | null;
          blueprint: Json;
          selection_signals: Json;
          story_engine_version: string;
        };
        Insert: {
          user_id: string;
          chapter_id: string;
          library_item_id: string;
          plan_item_id?: string | null;
          status?: string;
          started_at?: string;
          completed_at?: string | null;
          correct?: number | null;
          total?: number | null;
          comprehension_correct?: number | null;
          comprehension_total?: number | null;
          vocabulary_correct?: number | null;
          vocabulary_total?: number | null;
          grammar_correct?: number | null;
          grammar_total?: number | null;
          blueprint?: Json;
          selection_signals?: Json;
          story_engine_version?: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["chapter_assessment_sessions"]["Insert"]
        >;
        Relationships: [
          {
            foreignKeyName: "chapter_assessment_sessions_chapter_id_fkey";
            columns: ["chapter_id"];
            referencedRelation: "chapters";
            referencedColumns: ["id"];
          },
        ];
      };

      /**
       * One snapshotted Challenge question.
       *
       * `presented_order` is the shuffle a sequence question was shown in. It is
       * the reason the stored (correct) order never has to leave the database.
       */
      chapter_assessment_items: {
        Row: {
          session_id: string;
          question_id: number;
          item_position: number;
          kind: string;
          question_type: string;
          item_difficulty: number;
          presented_order: number[] | null;
          selected_idx: number | null;
          typed_answer: string | null;
          sequence_answer: number[] | null;
          is_correct: boolean | null;
          response_ms: number | null;
          answered_at: string | null;
        };
        Insert: {
          session_id: string;
          question_id: number;
          item_position: number;
          kind: string;
          question_type: string;
          item_difficulty?: number;
          presented_order?: number[] | null;
          selected_idx?: number | null;
          typed_answer?: string | null;
          sequence_answer?: number[] | null;
          is_correct?: boolean | null;
          response_ms?: number | null;
          answered_at?: string | null;
        };
        Update: Partial<
          Database["public"]["Tables"]["chapter_assessment_items"]["Insert"]
        >;
        Relationships: [
          {
            foreignKeyName: "chapter_assessment_items_session_id_fkey";
            columns: ["session_id"];
            referencedRelation: "chapter_assessment_sessions";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      /**
       * Every personal note of the calling learner, with its book and chapter,
       * as one list — so the notebook is one query rather than one per row.
       * `security_invoker`, so the own-row policies on the underlying tables are
       * what decides visibility.
       */
      notebook_entries: {
        Row: {
          /** `word` and `phrase` are annotations; `sentence` is a note. */
          entry_type: "word" | "phrase" | "sentence";
          entry_id: number;
          user_id: string;
          library_item_id: string;
          item_slug: string;
          item_title: string;
          chapter_id: string;
          chapter_position: number;
          chapter_title: string | null;
          sentence_position: number;
          sentence_id: number | null;
          /** Token span of an annotation; null for a sentence note. */
          start_position: number | null;
          end_position: number | null;
          surface: string | null;
          lemma: string | null;
          word_id: number | null;
          /** The annotation's meaning, or the sentence note's translation. */
          meaning: string | null;
          sentence_text: string;
          char_start: number | null;
          char_end: number | null;
          content_version: string;
          is_unclear: boolean;
          has_translation: boolean;
          in_review: boolean;
          created_at: string;
          updated_at: string;
        };
        Relationships: [];
      };
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
      /** Opens (or re-opens) a chapter and says where to resume. */
      start_reading_session: {
        Args: { p_chapter_id: string };
        Returns: {
          session_id: string;
          library_item_id: string;
          resume_paragraph: number;
          resume_sentence: number | null;
          furthest_paragraph: number;
          progress_ratio: number;
          completed_at: string | null;
          resumed: boolean;
        }[];
      };
      /**
       * Records where the learner is. `furthest` only ever increases;
       * `p_max_active_seconds` is the cap from `src/lib/reading/constants.ts`.
       */
      record_reading_progress: {
        Args: {
          p_session_id: string;
          p_paragraph_position: number;
          p_sentence_position: number | null;
          p_active_seconds: number;
          p_max_active_seconds: number;
        };
        Returns: {
          progress_ratio: number;
          furthest_paragraph: number;
          active_seconds: number;
          words_read: number;
        }[];
      };
      /** Finishes a chapter. Refuses below `p_min_ratio`; idempotent. */
      complete_reading_chapter: {
        Args: { p_session_id: string; p_min_ratio: number };
        Returns: {
          already_completed: boolean;
          words_read: number;
          active_seconds: number;
          lookup_count: number;
          unique_lookup_count: number;
          saved_word_count: number;
          chapter_id: string;
          library_item_id: string;
        }[];
      };
      /** Seals a session without finishing the chapter. */
      end_reading_session: {
        Args: {
          p_session_id: string;
          p_active_seconds: number;
          p_max_active_seconds: number;
        };
        Returns: undefined;
      };
      /** Saves a word with the sentence it was met in. Origin is derived, not passed. */
      /**
       * The personal notebook's write paths. Every one derives the learner from
       * `auth.uid()` and refuses a sentence they may not read, which is why they
       * are granted to `authenticated` rather than to the service role.
       */
      save_sentence_translation: {
        Args: { p_sentence_id: number; p_translation: string; p_evidence: Json };
        Returns: {
          note_id: number;
          was_new: boolean;
          translation: string | null;
          is_unclear: boolean;
        }[];
      };
      delete_sentence_translation: {
        Args: { p_sentence_id: number };
        Returns: { note_id: number | null; deleted: boolean }[];
      };
      set_sentence_unclear: {
        Args: { p_sentence_id: number; p_unclear: boolean; p_evidence: Json };
        Returns: {
          note_id: number | null;
          is_unclear: boolean;
          deleted: boolean;
        }[];
      };
      save_text_annotation: {
        Args: {
          p_sentence_id: number;
          p_kind: "word" | "phrase";
          p_start_position: number;
          p_end_position: number;
          p_char_start: number;
          p_char_end: number;
          p_surface: string;
          p_meaning: string | null;
          p_lemma: string | null;
          p_max_tokens: number;
          p_evidence: Json;
        };
        Returns: {
          annotation_id: number;
          was_new: boolean;
          word_id: number | null;
          surface: string;
          meaning: string | null;
          lemma: string | null;
        }[];
      };
      update_text_annotation: {
        Args: {
          p_annotation_id: number;
          p_meaning: string | null;
          p_lemma: string | null;
        };
        Returns: {
          annotation_id: number;
          meaning: string | null;
          lemma: string | null;
        }[];
      };
      delete_text_annotation: {
        Args: { p_annotation_id: number };
        Returns: boolean;
      };
      set_notebook_review: {
        Args: {
          p_annotation_id: number | null;
          p_sentence_note_id: number | null;
          p_enabled: boolean;
        };
        Returns: {
          review_id: number | null;
          enabled: boolean;
          due_at: string | null;
        }[];
      };
      /** service_role only — grades one notebook card in a single transaction. */
      apply_notebook_review: {
        Args: {
          p_user_id: string;
          p_interaction_id: string;
          p_annotation_id: number | null;
          p_sentence_note_id: number | null;
          p_item_type: "word_meaning" | "phrase" | "sentence_translation";
          p_rating: "again" | "hard" | "good" | "easy";
          p_mode: string;
          p_direction: string;
          p_response_ms: number | null;
          p_srs: Json;
          p_evidence: Json;
        };
        Returns: {
          review_event_id: number;
          due_at: string;
          is_mastered: boolean;
          already_applied: boolean;
        }[];
      };
      save_word_from_reader: {
        Args: { p_word_id: number; p_occurrence_id: number | null };
        Returns: { saved: boolean; was_new: boolean; context_de: string | null }[];
      };
      /** service_role only — writes a chapter's structure in one transaction. */
      replace_chapter_content: {
        Args: { p_chapter_id: string; p_payload: Json };
        Returns: Json;
      };
      /**
       * Mint an import for the caller. Owner and storage path are derived from
       * `auth.uid()`, never accepted from the client.
       */
      create_book_import: {
        Args: {
          p_file_name: string;
          p_file_type: string;
          p_file_size: number;
          p_file_hash?: string | null;
        };
        Returns: Database["public"]["Tables"]["book_imports"]["Row"];
      };
      /** service_role only — moves the import's state machine. */
      set_book_import_state: {
        Args: {
          p_import_id: string;
          p_status: string;
          p_stage?: string | null;
          p_error_code?: string | null;
          p_error_message?: string | null;
        };
        Returns: undefined;
      };
      /**
       * service_role only — one analysis run: metadata and the whole chapter
       * proposal, in one transaction. Refuses to overwrite manual corrections.
       */
      apply_book_import_analysis: {
        Args: { p_import_id: string; p_payload: Json };
        Returns: undefined;
      };
      /** The learner's own title and author for their import. */
      update_book_import_metadata: {
        Args: { p_import_id: string; p_title: string | null; p_author: string | null };
        Returns: undefined;
      };
      /** rename / include / merge_up / split / move, atomically renumbered. */
      edit_book_import_chapters: {
        Args: { p_import_id: string; p_op: string; p_payload: Json };
        Returns: undefined;
      };
      /**
       * Turn a reviewed import into a private library item. Idempotent: returns
       * the existing item id when the import has already been finalized.
       */
      finalize_book_import: {
        Args: { p_import_id: string };
        Returns: string;
      };
      /** Recompute processing progress from the chapter rows. Never asserted. */
      sync_book_import_processing: {
        Args: { p_import_id: string };
        Returns: Json;
      };
      /** Drop an unconfirmed import; returns its storage path for cleanup. */
      cancel_book_import: {
        Args: { p_import_id: string };
        Returns: string;
      };
      /** The owner's door out of their own private book. Returns storage paths. */
      delete_private_library_item: {
        Args: { p_item_id: string };
        Returns: string[];
      };
      /** service_role only — records why a chapter could not be processed. */
      fail_chapter_processing: {
        Args: { p_chapter_id: string; p_error: string };
        Returns: undefined;
      };
      /**
       * service_role only — one lookup: the reading record and the learning
       * evidence, together. Evidence is applied only for a genuinely new lookup.
       */
      apply_reading_lookup: {
        Args: {
          p_user_id: string;
          p_interaction_id: string;
          p_chapter_id: string;
          p_word_id: number;
          p_sentence_id: number | null;
          p_occurrence_id: number | null;
          p_session_id: string | null;
          p_evidence: Json;
        };
        Returns: {
          already_recorded: boolean;
          lookup_count: number;
          unique_lookup_count: number;
          word_lookup_total: number;
        }[];
      };
      /** service_role only — chapter started/finished, as history that scores nothing. */
      apply_reading_event: {
        Args: { p_user_id: string; p_evidence: Json };
        Returns: number;
      };
      /** service_role only — gives any passage without a library item one. */
      backfill_library_from_texts: {
        Args: Record<string, never>;
        Returns: number;
      };
      /** service_role only — re-publishes migrated passages once processed. */
      publish_processed_legacy_items: {
        Args: Record<string, never>;
        Returns: number;
      };
      /** URL-safe slug, umlaut-aware. */
      slugify: {
        Args: { p_value: string };
        Returns: string;
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

      // ── PHASE 5: THE STORY LEARNING ENGINE ────────────────────────────────

      /** Whether the caller may read this chapter, private imports included. */
      chapter_is_readable: {
        Args: { p_chapter_id: string };
        Returns: boolean;
      };

      /** The SQL twin of `foldTypedAnswer`. Folds case, spacing and articles. */
      fold_typed_answer: {
        Args: { p_value: string };
        Returns: string;
      };

      /**
       * service_role only — writes a validated question bank.
       *
       * Idempotent on `(chapter_id, fingerprint)`, and `owner_user_id` is
       * DERIVED from the library item rather than accepted from the caller.
       */
      upsert_chapter_questions: {
        Args: { p_chapter_id: string; p_questions: Json; p_meta?: Json };
        Returns: number;
      };

      /** service_role only — marks questions written from older content stale. */
      mark_stale_chapter_questions: {
        Args: { p_chapter_id: string };
        Returns: number;
      };

      /** Admin only — approve, reject or disable one public question. */
      set_chapter_question_status: {
        Args: { p_question_id: number; p_status: string };
        Returns: undefined;
      };

      /** "This question is wrong." One report per learner per question. */
      report_chapter_question: {
        Args: { p_question_id: number; p_reason: string; p_note?: string | null };
        Returns: undefined;
      };

      /** service_role only — starts or retries one generation run. */
      start_chapter_generation_job: {
        Args: { p_chapter_id: string; p_generator_version: string };
        Returns: string;
      };

      /** service_role only — records the outcome, the cost, and why it failed. */
      finish_chapter_generation_job: {
        Args: { p_job_id: string; p_status: string; p_result?: Json };
        Returns: undefined;
      };

      /** service_role only — caches a computed personal chapter analysis. */
      upsert_chapter_analysis: {
        Args: { p_user_id: string; p_chapter_id: string; p_analysis: Json };
        Returns: undefined;
      };

      /**
       * service_role only — snapshots a preparation from a computed selection.
       * Resumes rather than re-selecting when one is already open.
       */
      start_chapter_preparation: {
        Args: {
          p_user_id: string;
          p_chapter_id: string;
          p_items: Json;
          p_plan_item_id?: string | null;
          p_signals?: Json;
        };
        Returns: string;
      };

      /** The preparation snapshot — cards and options, never `correct_idx`. */
      get_chapter_preparation: {
        Args: { p_session_id: string };
        Returns: {
          word_id: number;
          item_position: number;
          lemma: string;
          display: string;
          translation: string;
          options: string[];
          context_sentence: string | null;
          context_source: string;
          selected_idx: number | null;
          is_correct: boolean | null;
          answered_at: string | null;
        }[];
      };

      answer_preparation_item: {
        Args: {
          p_session_id: string;
          p_word_id: number;
          p_selected_idx: number;
          p_response_ms: number | null;
        };
        Returns: {
          is_answer_correct: boolean;
          answer_key_idx: number;
          already_answered: boolean;
        }[];
      };

      /** service_role only — seals a preparation and applies its evidence once. */
      finalize_chapter_preparation: {
        Args: { p_session_id: string; p_user_id: string; p_evidence: Json };
        Returns: {
          correct_count: number;
          total_count: number;
          already_finalized: boolean;
        }[];
      };

      /** "Pomiń i czytaj." Recorded, never prevented. */
      skip_chapter_preparation: {
        Args: { p_chapter_id: string };
        Returns: string;
      };

      /**
       * What the Challenge's SELECTION needs: metadata and answering history.
       * No prompt, no options, no key — the ranking never reads a question.
       */
      get_chapter_question_candidates: {
        Args: { p_chapter_id: string };
        Returns: {
          question_id: number;
          kind: string;
          question_type: string;
          difficulty: number;
          word_id: number | null;
          concept_codes: string[];
          last_answered_at: string | null;
        }[];
      };

      /** service_role only — snapshots a Challenge from a computed selection. */
      start_chapter_assessment: {
        Args: {
          p_user_id: string;
          p_chapter_id: string;
          p_question_ids: number[];
          p_blueprint?: Json;
          p_signals?: Json;
          p_plan_item_id?: string | null;
        };
        Returns: string;
      };

      /** The Challenge snapshot. Sequence items come back SHUFFLED, as shown. */
      get_chapter_assessment: {
        Args: { p_session_id: string };
        Returns: {
          question_id: number;
          item_position: number;
          kind: string;
          question_type: string;
          prompt: string;
          options: string[] | null;
          sequence_items: string[] | null;
          explanation_pl: string | null;
          selected_idx: number | null;
          typed_answer: string | null;
          sequence_answer: number[] | null;
          is_correct: boolean | null;
          answered_at: string | null;
        }[];
      };

      /** Grades all four answerable types; the key arrives after the answer. */
      answer_chapter_assessment_question: {
        Args: {
          p_session_id: string;
          p_question_id: number;
          p_selected_idx?: number | null;
          p_typed_answer?: string | null;
          p_sequence_answer?: number[] | null;
          p_response_ms?: number | null;
        };
        Returns: {
          is_answer_correct: boolean;
          answer_key_idx: number | null;
          answer_key_text: string | null;
          /** The right order, in PRESENTED positions. */
          answer_key_order: number[] | null;
          explanation_pl: string | null;
          already_answered: boolean;
        }[];
      };

      /** service_role only — seals a Challenge and applies its evidence once. */
      finalize_chapter_assessment: {
        Args: {
          p_session_id: string;
          p_user_id: string;
          p_evidence: Json;
          p_scores?: Json;
        };
        Returns: {
          correct_count: number;
          total_count: number;
          already_finalized: boolean;
        }[];
      };

      /** "Później." The Challenge stays available; Today may remind them. */
      defer_chapter_assessment: {
        Args: { p_chapter_id: string };
        Returns: string;
      };

      /** service_role only — the lifecycle transition every act writes through. */
      touch_chapter_learning_state: {
        Args: { p_user_id: string; p_chapter_id: string; p_event: string };
        Returns: string;
      };

      mark_chapter_reading_started: {
        Args: { p_chapter_id: string };
        Returns: string;
      };

      /** Refuses unless `reading_progress` says the chapter was finished. */
      mark_chapter_reading_completed: {
        Args: { p_chapter_id: string };
        Returns: string;
      };
    };
    Enums: Record<never, never>;
    CompositeTypes: Record<never, never>;
  };
};
