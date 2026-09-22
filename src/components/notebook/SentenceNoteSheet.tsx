"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { BookmarkCheck, BookmarkPlus, HelpCircle, Lightbulb } from "lucide-react";
import { useState } from "react";

import {
  deleteSentenceTranslation,
  saveSentenceTranslation,
  setNotebookReview,
  setSentenceUnclear,
} from "@/actions/notebook";
import { NoteSheet } from "@/components/notebook/NoteSheet";
import {
  sentenceNotebookKey,
  useSentenceNotebook,
} from "@/hooks/useSentenceNotebook";
import { newInteractionId } from "@/lib/interaction-id";
import { MAX_TRANSLATION_LENGTH } from "@/lib/notebook/constants";
import { cn } from "@/lib/utils";
import { notebookKeys } from "@/lib/query-keys";

/**
 * "Przetłumacz zdanie" — the one translation editor.
 *
 * Opened from the word sheet and from tapping a sentence; both mount THIS, so
 * there is one place where a translation is written, validated, saved, edited
 * and deleted (§27).
 *
 * TWO THINGS LIVE HERE, and they are two different acts. Writing a translation
 * is work: the learner has understood the sentence and is recording what they
 * understood. "Nie rozumiem" is the opposite admission, and it must not require
 * the first — someone who cannot read a sentence cannot translate it, and a UI
 * that only offered the editor would have nothing for the case that matters most
 * (§14). So the flag is a control of its own, available whether or not anything
 * has been typed, and reversible at any time (§18).
 *
 * "TWOJE TŁUMACZENIE", NEVER "TŁUMACZENIE" (§78). Every label says whose it is.
 * Fluent has not checked it and does not pretend to have.
 */
export function SentenceNoteSheet({
  open,
  sentenceId,
  sentenceText,
  readingSessionId,
  onClose,
}: {
  open: boolean;
  sentenceId: number | null;
  sentenceText: string;
  readingSessionId?: string | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading } = useSentenceNotebook(open ? sentenceId : null);
  const note = data?.note ?? null;

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: sentenceNotebookKey(sentenceId) });
    void queryClient.invalidateQueries({ queryKey: notebookKeys.all });
  }

  const save = useMutation({
    mutationFn: async (translation: string) => {
      if (sentenceId === null) throw new Error("Brak zdania.");
      const result = await saveSentenceTranslation({ sentenceId, translation });
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
      if (sentenceId === null) throw new Error("Brak zdania.");
      const result = await deleteSentenceTranslation(sentenceId);
      if (!result.ok) throw new Error(result.message);
    },
    onSuccess: () => {
      setError(null);
      refresh();
      onClose();
    },
    onError: (cause: Error) => setError(cause.message),
  });

  const unclear = useMutation({
    mutationFn: async (next: boolean) => {
      if (sentenceId === null) throw new Error("Brak zdania.");
      const result = await setSentenceUnclear({
        sentenceId,
        unclear: next,
        // One token per tap. The log keeps the sequence, so "nie rozumiem" in
        // chapter three and "już rozumiem" a week later are two rows of history
        // and one row of current state (§19).
        interactionId: newInteractionId(),
        readingSessionId,
      });
      if (!result.ok) throw new Error(result.message);
    },
    onSuccess: () => {
      setError(null);
      refresh();
    },
    onError: (cause: Error) => setError(cause.message),
  });

  const review = useMutation({
    mutationFn: async (enabled: boolean) => {
      if (!note) throw new Error("Brak notatki.");
      const result = await setNotebookReview({ sentenceNoteId: note.entry_id, enabled });
      if (!result.ok) throw new Error(result.message);
    },
    onSuccess: () => {
      setError(null);
      refresh();
    },
    onError: (cause: Error) => setError(cause.message),
  });

  const isUnclear = note?.is_unclear ?? false;
  const inReview = note?.in_review ?? false;

  return (
    <NoteSheet
      // Opened only once the note is known. Otherwise the fields would seed
      // from an empty result and the learner would watch their own translation
      // appear a beat later — or, worse, type over it.
      open={open && sentenceId !== null && !isLoading}
      seedKey={`sentence:${sentenceId}`}
      title={note?.meaning ? "Twoje tłumaczenie" : "Przetłumacz zdanie"}
      source={sentenceText}
      sourceLabel="Po niemiecku"
      label="Twoje tłumaczenie"
      placeholder="Powinniśmy zawrócić…"
      initialValue={note?.meaning ?? ""}
      maxLength={MAX_TRANSLATION_LENGTH}
      saving={save.isPending || remove.isPending}
      error={error}
      canDelete={Boolean(note?.meaning)}
      onSave={(value) => save.mutate(value)}
      onDelete={() => remove.mutate()}
      onClose={onClose}
    >
      <div className="mt-3 space-y-2 border-t border-[#4b5563]/60 pt-3">
        <button
          type="button"
          onClick={() => unclear.mutate(!isUnclear)}
          disabled={unclear.isPending}
          aria-pressed={isUnclear}
          className={cn(
            "flex h-11 w-full items-center justify-center gap-2 rounded-xl border text-sm font-medium transition-colors disabled:opacity-60",
            isUnclear
              ? "border-green/50 bg-green/10 text-green"
              : "border-[#4b5563] text-muted2 hover:text-main",
          )}
        >
          {isUnclear ? (
            <>
              <Lightbulb className="size-4" /> Już rozumiem
            </>
          ) : (
            <>
              <HelpCircle className="size-4" /> Nie rozumiem tego zdania
            </>
          )}
        </button>

        {/* §72: a translation is not automatically a flashcard. Reviewing it is
            a choice the learner makes, here, once there is something to review. */}
        {note?.meaning && (
          <button
            type="button"
            onClick={() => review.mutate(!inReview)}
            disabled={review.isPending}
            aria-pressed={inReview}
            className={cn(
              "flex h-11 w-full items-center justify-center gap-2 rounded-xl border text-sm font-medium transition-colors disabled:opacity-60",
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
                <BookmarkPlus className="size-4" /> Dodaj zdanie do powtórek
              </>
            )}
          </button>
        )}

        {isUnclear && (
          <p className="text-center text-xs text-muted2">
            To zdanie trafi do sekcji „Do wyjaśnienia” w Twoim zeszycie.
          </p>
        )}
      </div>
    </NoteSheet>
  );
}
