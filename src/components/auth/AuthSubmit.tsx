"use client";

import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * The primary action of an auth form.
 *
 * Full width, so swapping the label for a spinner cannot resize it (§51), and
 * `disabled:opacity-70` rather than the default 50 so a disabled button is still
 * readable rather than a grey smudge (§123). `aria-busy` is what tells a screen
 * reader the form is working — a spinning icon says nothing at all (§56).
 */
export function AuthSubmit({
  pending,
  pendingLabel,
  children,
}: {
  pending: boolean;
  pendingLabel: string;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className="h-11 w-full rounded-xl bg-gold text-base font-semibold text-dark hover:bg-gold-dark disabled:opacity-70"
    >
      {pending ? (
        <>
          <Loader2 className="size-4 animate-spin" aria-hidden />
          {pendingLabel}
        </>
      ) : (
        children
      )}
    </Button>
  );
}
