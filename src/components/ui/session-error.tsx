"use client";

import Link from "next/link";
import { RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

/**
 * A session that could not continue, with a way out of it.
 *
 * WHAT THIS ADDS, BEYOND DEDUPLICATION. Both runners rendered a card with the
 * message and a link home — and nothing else. One flaky request therefore ended
 * a test the learner was halfway through: the only thing on screen was "Wróć do
 * nauki". Starting and finalizing are both idempotent server-side (they resume
 * and return the stored result), so a retry is not merely safe, it is the
 * correct first offer. The way back stays, as the second one.
 */
export function SessionError({
  message,
  onRetry,
  backHref,
  backLabel,
}: {
  message: string;
  /** Omitted when the failure is not retryable — then only the way back shows. */
  onRetry?: () => void;
  backHref: string;
  backLabel: string;
}) {
  return (
    <Card className="items-center gap-3 p-5 text-center" role="alert">
      <p className="text-sm text-red">{message}</p>
      <div className="flex flex-wrap items-center justify-center gap-2">
        {onRetry && (
          <Button onClick={onRetry}>
            <RotateCcw className="size-4" aria-hidden />
            Spróbuj ponownie
          </Button>
        )}
        <Button asChild variant="ghost">
          <Link href={backHref}>{backLabel}</Link>
        </Button>
      </div>
    </Card>
  );
}
