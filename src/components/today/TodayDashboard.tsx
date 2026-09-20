import type { TodayPlan } from "@/actions/today-plan";
import { nextPlanItem } from "@/lib/learning/planner/routes";
import { ContinueCard } from "@/components/today/ContinueCard";
import { DailyGoalCard } from "@/components/today/DailyGoalCard";
import { MotivationCard } from "@/components/today/MotivationCard";
import { QuickActions } from "@/components/today/QuickActions";
import { TodayPlanView } from "@/components/today/TodayPlanView";
import { LevelCard } from "@/components/level/LevelCard";

/**
 * The Today dashboard.
 *
 * READING ORDER IS THE DESIGN. Top to bottom: who you are and how far you have
 * come (poziom), what to do right now (kontynuuj), where else you might go
 * (szybkie akcje), a moment of quiet, how the day stands (cel na dziś), and
 * finally the plan itself with its controls. A learner who opens the app to do
 * one thing never has to scroll past the answer.
 *
 * MOBILE IS NOT THE SAME GRID, NARROWER. The quiet card is the first thing to go
 * on a phone — it is the only surface here with no information on it, and a
 * phone screen is too short to spend on atmosphere. Everything else stacks in
 * the same order, and the plan is the natural bottom of the scroll.
 *
 * THIS COMPONENT HOLDS NO AUTHORITY, like everything else on this screen: the
 * plan, each item's status and the order all arrive from the server, which
 * derived them from what the learner actually did. There is no "mark done" here
 * because there is no "mark done" anywhere — see `sync_daily_plan`.
 */
export function TodayDashboard({
  plan,
  improved,
}: {
  plan: TodayPlan;
  improved: string | null;
}) {
  const isComplete = plan.status === "completed";
  const next = isComplete ? null : nextPlanItem(plan.items);

  return (
    <div className="space-y-5">
      {/* The level is the narrower of the two: it holds one number, the card
          next to it holds the day's primary action. */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
        <LevelCard />
        <ContinueCard item={next} isComplete={isComplete} />
      </div>

      <QuickActions />

      <div className="grid gap-4 lg:grid-cols-2">
        <MotivationCard className="hidden lg:flex" />
        <DailyGoalCard items={plan.items} />
      </div>

      <TodayPlanView plan={plan} improved={improved} />
    </div>
  );
}
