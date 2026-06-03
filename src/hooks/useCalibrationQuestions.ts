import { useQuery } from "@tanstack/react-query";

import { createClientSupabaseClient } from "@/lib/supabase/client";
import type { CalibrationQuestion } from "@/types";

/**
 * Fetch the standalone placement-test item bank from the answer-free
 * `calibration_questions_public` view. `correct_idx` is not exposed there —
 * grading happens in the `grade-calibration` Server Action. Item selection only
 * needs `difficulty`.
 */
export function useCalibrationQuestions() {
  return useQuery({
    queryKey: ["calibration-questions"],
    queryFn: async (): Promise<CalibrationQuestion[]> => {
      const supabase = createClientSupabaseClient();
      const { data, error } = await supabase
        .from("calibration_questions_public")
        .select("id, prompt, options, difficulty, cefr, skill, created_at")
        .order("difficulty", { ascending: true });

      if (error) throw error;
      return (data ?? []) as unknown as CalibrationQuestion[];
    },
  });
}
