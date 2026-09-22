import type { TodayPlan } from "@/lib/learning/planner/contracts";
import type { MaterialArtwork } from "@/lib/library/artwork";
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
  nextArtwork,
}: {
  plan: TodayPlan;
  improved: string | null;
  /**
   * Artwork for the activity „Kontynuuj naukę" is about, resolved by the page.
   *
   * It arrives as data rather than being fetched here for the same reason
   * everything else on this screen does: the dashboard composes, the server
   * decides. `nextPlanItem` is pure and cheap, so the page calling it to know
   * WHICH material to look up and this component calling it to know WHAT to
   * render cannot disagree.
   */
  nextArtwork?: MaterialArtwork | null;
}) {
  const isComplete = plan.status === "completed";
  const next = isComplete ? null : nextPlanItem(plan.items);

  return (
    <div className="space-y-5">
      {/* `grid-cols-1` is NOT decoration — it is the fix for a real overflow.
          A `display: grid` with no template puts its children in one IMPLICIT
          column sized `auto`, whose minimum is the child's min-content width, so
          a card wider than the phone pushed the whole document sideways
          (`scrollWidth` 447 on a 390px screen) instead of shrinking. Tailwind's
          `grid-cols-1` is `minmax(0, 1fr)`, which lets the track shrink and hands
          the truncation back to the card. Every `lg:` template already uses
          `minmax(0, …)` for the same reason.

          The level is the narrower of the two: it holds one number, the card
          next to it holds the day's primary action. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
        <LevelCard />
        <ContinueCard item={next} isComplete={isComplete} artwork={nextArtwork} />
      </div>

      <QuickActions />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <MotivationCard className="hidden lg:flex" />
        <DailyGoalCard items={plan.items} />
      </div>

      <TodayPlanView plan={plan} improved={improved} />
    </div>
  );
}
