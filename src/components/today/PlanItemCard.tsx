"use client";

import Link from "next/link";
import { Check, Circle, Loader2, SkipForward } from "lucide-react";

import type { TodayPlanItem } from "@/lib/learning/planner/contracts";
import {
  PLAN_ITEM_TITLE_PL,
  renderMinutes,
  renderTargetCount,
} from "@/lib/learning/planner/reasons";
import { planItemHref } from "@/lib/learning/planner/routes";
import { PlanReason } from "@/components/today/PlanReason";
import { PLAN_ITEM_ICONS } from "@/components/today/planIcons";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * One activity of today's plan.
 *
 * ONE CARD FOR EVERY TYPE, deliberately. Six bespoke cards would drift apart
 * within a month and would make adding a seventh activity a design exercise
 * rather than a generator. Everything that varies — icon, title, subtitle, the
 * count line — is data.
 *
 * A real `<Link>` wraps the action and a real `<button>` skips, rather than a
 * clickable `<div>`: the row has to be reachable by keyboard, announce itself to
 * a screen reader, and open in a new tab if someone wants that.
 */
export function PlanItemCard({
  item,
  isNext,
  onSkip,
  skipping,
  skipDisabled,
  skipError,
}: {
  item: TodayPlanItem;
  isNext: boolean;
  onSkip: (itemId: string) => void;
  /** This task's own skip is in flight — the spinner belongs to it. */
  skipping: boolean;
  /** Some skip is in flight. One write at a time, whichever task it belongs to. */
  skipDisabled: boolean;
  /** Polish copy from the error taxonomy when skipping THIS task failed. */
  skipError: string | null;
}) {
  const Icon = PLAN_ITEM_ICONS[item.type];
  const done = item.status === "completed";
  const skipped = item.status === "skipped";
  const partial = item.status === "in_progress" && item.completedCount > 0;

  const subtitle =
    typeof item.payload.title === "string"
      ? item.payload.title
      : typeof item.payload.conceptLabel === "string"
        ? item.payload.conceptLabel
        : Array.isArray(item.payload.preview)
          ? (item.payload.preview as string[]).join(" · ")
          : null;

  const countLine = renderTargetCount(item.type, item.targetCount);

  return (
    <Card
      className={cn(
        "app-panel gap-2 p-4 transition-colors",
        isNext && "app-panel-active",
        (done || skipped) && "opacity-60",
      )}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full",
            done
              ? "bg-green/20 text-green"
              : partial
                ? "bg-gold/20 text-gold"
                : "bg-secondary text-muted2",
          )}
          aria-hidden
        >
          {done ? (
            <Check className="size-4" />
          ) : partial ? (
            <Circle className="size-3 fill-current" />
          ) : (
            <Icon className="size-4" />
          )}
        </span>

        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <Link
              href={planItemHref(item)}
              className={cn(
                "font-semibold transition-colors hover:text-gold",
                "rounded-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                (done || skipped) && "pointer-events-none",
              )}
              aria-disabled={done || skipped}
              tabIndex={done || skipped ? -1 : undefined}
            >
              {PLAN_ITEM_TITLE_PL[item.type]}
            </Link>
            <span className="text-xs text-muted2">
              {[countLine, renderMinutes(item.estimatedMinutes)]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </div>

          {/* Long Polish labels wrap rather than overflow on a phone. */}
          {subtitle && (
            <p className="truncate text-sm text-muted2" title={subtitle}>
              {subtitle}
            </p>
          )}

          {partial && (
            <p className="text-xs font-medium text-gold">
              {item.completedCount} / {item.targetCount}
            </p>
          )}

          {skipped ? (
            <p className="text-xs text-muted2">Pominięte na dziś</p>
          ) : (
            <PlanReason reason={{ code: item.reasonCode, data: item.reasonData }} />
          )}

          {/* A failed skip says so where the learner is looking, and the task is
              untouched — tapping again is the retry. */}
          {skipError && (
            <p role="alert" className="text-xs text-red">
              {skipError}
            </p>
          )}
        </div>

        {!done && !skipped && (
          <button
            type="button"
            onClick={() => onSkip(item.id)}
            disabled={skipping || skipDisabled}
            aria-label={`Pomiń na dziś: ${PLAN_ITEM_TITLE_PL[item.type]}`}
            className="rounded-md p-1.5 text-muted2 outline-none transition-colors hover:bg-secondary hover:text-main focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50"
          >
            {skipping ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <SkipForward className="size-4" />
            )}
          </button>
        )}
      </div>
    </Card>
  );
}
