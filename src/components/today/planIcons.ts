import {
  BookMarked,
  BookOpen,
  ClipboardCheck,
  Layers,
  Sparkles,
  Target,
  type LucideIcon,
} from "lucide-react";

import type { TodayPlanItem } from "@/lib/learning/planner/contracts";

/**
 * One icon per activity kind, so the plan is scannable without reading it.
 *
 * Shared rather than duplicated: the plan list, the „Kontynuuj naukę" card and
 * the goal checklist all draw the same activity, and an icon that means
 * „Powtórki" in one card and something else in the next is worse than no icon.
 */
export const PLAN_ITEM_ICONS: Record<TodayPlanItem["type"], LucideIcon> = {
  placement: Target,
  review_due: Layers,
  weakness_practice: Target,
  continue_text: BookOpen,
  new_text: BookOpen,
  continue_chapter: BookMarked,
  new_chapter: BookMarked,
  chapter_preparation: Sparkles,
  chapter_assessment: ClipboardCheck,
  new_vocabulary: Sparkles,
};
