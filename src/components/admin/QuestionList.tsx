"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Pencil, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { QuestionForm } from "@/components/admin/QuestionForm";
import { deleteQuestion } from "@/actions/admin-questions";
import { cn } from "@/lib/utils";
import type { QuestionWithAnswer } from "@/types";
import { adminKeys } from "@/lib/query-keys";

export function QuestionList({
  textId,
  questions,
}: {
  textId: number;
  questions: QuestionWithAnswer[];
}) {
  const queryClient = useQueryClient();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [toDelete, setToDelete] = useState<QuestionWithAnswer | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function onConfirmDelete() {
    if (!toDelete || deleting) return;
    setDeleting(true);
    try {
      await deleteQuestion(toDelete.id);
      await queryClient.invalidateQueries({
        queryKey: adminKeys.questions(textId),
      });
      await queryClient.invalidateQueries({ queryKey: adminKeys.texts() });
      setToDelete(null);
    } catch {
      // Keep the dialog open so the admin can retry.
    } finally {
      setDeleting(false);
    }
  }

  if (questions.length === 0) {
    return (
      <p className="text-sm text-muted2">
        Brak pytań. Dodaj pierwsze pytanie poniżej.
      </p>
    );
  }

  return (
    <>
      <ol className="space-y-3">
        {questions.map((question, index) =>
          editingId === question.id ? (
            <li key={question.id}>
              <QuestionForm
                textId={textId}
                mode="edit"
                question={question}
                onDone={() => setEditingId(null)}
              />
            </li>
          ) : (
            <li
              key={question.id}
              className="rounded-lg border border-border bg-card p-3"
            >
              <div className="flex items-start justify-between gap-2">
                <p className="font-medium text-main">
                  {index + 1}. {question.prompt}
                </p>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="size-9 sm:size-8"
                    aria-label="Edytuj pytanie"
                    onClick={() => setEditingId(question.id)}
                  >
                    <Pencil className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Usuń pytanie"
                    className="size-9 text-red hover:text-red sm:size-8"
                    onClick={() => setToDelete(question)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </div>
              <ul className="mt-2 space-y-1">
                {question.options.map((option, idx) => {
                  const correct = idx === question.correct_idx;
                  return (
                    <li
                      key={idx}
                      className={cn(
                        "flex items-center gap-2 rounded-md px-2 py-1 text-sm",
                        correct
                          ? "bg-green-900/30 text-green-300"
                          : "text-muted2",
                      )}
                    >
                      {correct ? (
                        <Check className="size-4 shrink-0" />
                      ) : (
                        <span className="inline-block size-4 shrink-0" />
                      )}
                      <span>{option}</span>
                    </li>
                  );
                })}
              </ul>
            </li>
          ),
        )}
      </ol>

      <Dialog
        open={toDelete !== null}
        onOpenChange={(open) => !open && setToDelete(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Usunąć pytanie?</DialogTitle>
            <DialogDescription>
              Pytanie zostanie trwale usunięte. Tej operacji nie można cofnąć.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setToDelete(null)}>
              Anuluj
            </Button>
            <Button
              variant="destructive"
              onClick={onConfirmDelete}
              disabled={deleting}
            >
              {deleting ? "Usuwanie…" : "Usuń"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
