"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { BookmarkCheck, BookmarkPlus } from "lucide-react";
import { useState } from "react";

import {
  deleteAnnotation,
  saveAnnotation,
  setNotebookReview,
} from "@/actions/notebook";
import { NoteSheet } from "@/components/notebook/NoteSheet";
import type { NotebookEntry } from "@/hooks/useNotebook";
import { sentenceNotebookKey } from "@/hooks/useSentenceNotebook";
import {
  MAX_LEMMA_LENGTH,
  MAX_MEANING_LENGTH,
} from "@/lib/notebook/constants";
import { cn } from "@/lib/utils";

/** The span a meaning is being written for. */
export interface AnnotationTarget {
  sentenceId: number;
  sentenceText: string;
  startPosition: number;
  endPosition: number;
  surface: string;
  kind: "word" | "phrase";
  /** The existing note for this span, when the learner is editing one. */
  existing: NotebookEntry | null;
}

/**
 * "Znaczenie w tym miejscu" and "Zapisz jako zwrot" — one editor, two levels.
 *
 * WHY ONE COMPONENT FOR BOTH. A contextual word meaning and a phrase meaning are
 * the same act on a different span: the learner has decided what a piece of THIS
 * sentence means and is writing it down. What separates them is how many tokens
 * they selected, which is decided once, in `annotationKindForSpan`, and never
 * re-decided here or in the Server Action.
 *
 * WHAT THIS IS NOT ALLOWED TO DO, and the reason the whole phase has an
 * occurrence layer: it never touches `words.translation_pl`. The learner who
 * writes "sollten → powinniśmy" has said something true about one sentence in
 * one book. The shared dictionary still says *sollen → powinien / mieć
 * powinność*, for them and for everyone else, and there is no code path from
 * this sheet to it (§5, §84).
 *
 * THE LEMMA IS OPTIONAL (§85). A learner who already knows *sollten* is *sollen*
 * can say so; one who is still working out what the word even is must not be
 * blocked by a field they cannot fill.
 */
export function AnnotationSheet({
  target,
  onClose,
}: {
  target: AnnotationTarget | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const existing = target?.existing ?? null;
  const isPhrase = target?.kind === "phrase";

  function refresh() {
    void queryClient.invalidateQueries({
      queryKey: sentenceNotebookKey(target?.sentenceId ?? null),
    });
    void queryClient.invalidateQueries({ queryKey: ["notebook"] });
  }

  const save = useMutation({
    mutationFn: async ({ meaning, lemma }: { meaning: string; lemma: string }) => {
      if (!target) throw new Error("Brak zaznaczenia.");
      const result = await saveAnnotation({
        sentenceId: target.sentenceId,
        startPosition: target.startPosition,
        endPosition: target.endPosition,
        meaning,
        lemma: isPhrase ? null : lemma,
      });
      if (!result.ok) throw new Error(result.message);
    },
    onSuccess: () => {
      setError(null);
      refresh();
      onClose();
    },
    onError: (cause: Error) => setError(cause.message),
  });

  const remove = useMutation({
    mutationFn: async () => {
      if (!existing) throw new Error("Brak notatki.");
      const result = await deleteAnnotation(existing.entry_id);
      if (!result.ok) throw new Error(result.message);
    },
    onSuccess: () => {
      setError(null);
      refresh();
      onClose();
    },
    onError: (cause: Error) => setError(cause.message),
  });

  const review = useMutation({
    mutationFn: async (enabled: boolean) => {
      if (!existing) throw new Error("Brak notatki.");
      const result = await setNotebookReview({
        annotationId: existing.entry_id,
        enabled,
      });
      if (!result.ok) throw new Error(result.message);
    },
    onSuccess: () => {
      setError(null);
      refresh();
    },
    onError: (cause: Error) => setError(cause.message),
  });

  const inReview = existing?.in_review ?? false;

  return (
    <NoteSheet
      open={target !== null}
      // The span is the identity of the note, so opening a different one
      // re-seeds and toggling review on the same one does not.
      seedKey={`span:${target?.sentenceId ?? 0}:${target?.startPosition ?? 0}:${target?.endPosition ?? 0}`}
      title={isPhrase ? "Zapisz zwrot" : "Znaczenie w tym miejscu"}
      source={target?.surface ?? null}
      sourceLabel={isPhrase ? "Zwrot" : "Słowo"}
      label="Znaczenie"
      placeholder={isPhrase ? "straszyć / budzić strach" : "powinniśmy"}
      initialValue={existing?.meaning ?? ""}
      maxLength={MAX_MEANING_LENGTH}
      secondary={
        isPhrase
          ? undefined
          : {
              label: "Forma podstawowa (opcjonalnie)",
              placeholder: "sollen",
              initialValue: existing?.lemma ?? "",
              maxLength: MAX_LEMMA_LENGTH,
            }
      }
      saving={save.isPending || remove.isPending}
      error={error}
      canDelete={existing !== null}
      onSave={(meaning, lemma) => save.mutate({ meaning, lemma })}
      onDelete={() => remove.mutate()}
      onClose={onClose}
    >
      {/* §39: a phrase is worth saving even before you know what it means —
          "I want to come back to this" is a real reason, and refusing it sends
          the learner to a paper notebook. The primary button still asks for a
          meaning; this is the quiet way past it, and it is offered only for a
          phrase (a bare word with no meaning would say nothing at all). */}
      {isPhrase && !existing && (
        <button
          type="button"
          onClick={() => save.mutate({ meaning: "", lemma: "" })}
          disabled={save.isPending}
          className="mt-3 h-10 w-full rounded-xl text-sm font-medium text-muted2 transition-colors hover:text-main disabled:opacity-50"
        >
          Zapisz bez znaczenia
        </button>
      )}

      {target?.sentenceText && (
        <p className="mt-3 border-t border-[#4b5563]/60 pt-3 text-xs italic leading-relaxed text-muted2">
          {target.sentenceText}
        </p>
      )}

      {existing && (
        <button
          type="button"
          onClick={() => review.mutate(!inReview)}
          disabled={review.isPending}
          aria-pressed={inReview}
          className={cn(
            "mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-xl border text-sm font-medium transition-colors disabled:opacity-60",
            inReview
              ? "border-gold/50 bg-gold/10 text-gold"
              : "border-[#4b5563] text-muted2 hover:text-main",
          )}
        >
          {inReview ? (
            <>
              <BookmarkCheck className="size-4" /> W powtórkach
            </>
          ) : (
            <>
              <BookmarkPlus className="size-4" /> Dodaj do powtórek
            </>
          )}
        </button>
      )}
    </NoteSheet>
  );
}
