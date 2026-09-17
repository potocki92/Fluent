"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2, Trash2 } from "lucide-react";

import { deletePrivateBook } from "@/actions/book-import";
import { Button } from "@/components/ui/button";
import { settleAction } from "@/lib/errors";

/**
 * The owner's way out of their own book.
 *
 * A LEARNER IS NEVER LOCKED OUT OF THEIR OWN DATA. The library's delete policy is
 * admin-only and excludes owned items entirely, which is right for content and
 * wrong for somebody's own file — so this calls the one function that lets an
 * owner remove an owned item, and it refuses everything else.
 *
 * WHAT THE COPY HAS TO SAY, because this is destructive and the honest answer is
 * reassuring: the book and everything about this text goes, and the German the
 * learner picked up from it stays. Deleting a book should not cost anyone a
 * month of spaced repetition, and it does not.
 *
 * Two taps rather than a modal. A confirmation dialog for a single reversible-
 * in-principle action on a phone is more ceremony than the decision needs, and
 * the second tap is deliberately labelled with what it does.
 *
 * Through `settleAction`, because this action deletes a whole book: the one
 * failure mode a bare `await` cannot see is a REJECTION — a dropped connection
 * mid-delete, a redacted production error — after which the spinner stops and
 * nothing appears, which reads as "the button is broken". Both halves have to
 * end in the same Polish sentence.
 */
export function DeletePrivateBook({ itemId }: { itemId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [armed, setArmed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!armed) {
    return (
      <Button
        variant="ghost"
        size="sm"
        className="text-muted2"
        onClick={() => setArmed(true)}
      >
        <Trash2 className="size-4" /> Usuń książkę
      </Button>
    );
  }

  return (
    <div className="space-y-2 rounded-xl border border-red/40 bg-card p-3">
      <p className="text-sm text-main">Usunąć tę książkę?</p>
      <p className="text-xs text-muted2">
        Znikną: treść, Twój postęp w czytaniu i oryginalny plik. Zostaną: zapisane
        słówka i wszystko, czego się nauczyłeś.
      </p>
      {error && (
        <p role="alert" className="text-xs text-red">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button
          variant="destructive"
          size="sm"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await settleAction(
                () => deletePrivateBook(itemId),
                `deletePrivateBook ${itemId}`,
              );
              if (!result.ok) {
                setError(result.message);
                return;
              }
              router.push("/library");
              router.refresh();
            })
          }
        >
          {pending && <Loader2 className="size-4 animate-spin" />}
          Tak, usuń
        </Button>
        <Button variant="ghost" size="sm" disabled={pending} onClick={() => setArmed(false)}>
          Anuluj
        </Button>
      </div>
    </div>
  );
}
