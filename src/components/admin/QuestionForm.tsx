"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { createQuestion, updateQuestion } from "@/actions/admin-questions";
import type { QuestionInput, QuestionWithAnswer } from "@/types";
import { adminKeys } from "@/lib/query-keys";

type Props = { textId: number } & (
  | { mode: "create"; onDone?: () => void }
  | { mode: "edit"; question: QuestionWithAnswer; onDone: () => void }
);

const MAX_OPTIONS = 6;

function initialOptions(props: Props): string[] {
  if (props.mode === "edit") return [...props.question.options];
  return ["", "", "", ""];
}

export function QuestionForm(props: Props) {
  const queryClient = useQueryClient();

  const [prompt, setPrompt] = useState(
    props.mode === "edit" ? props.question.prompt : "",
  );
  const [options, setOptions] = useState<string[]>(() => initialOptions(props));
  const [correctIdx, setCorrectIdx] = useState(
    props.mode === "edit" ? props.question.correct_idx : 0,
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function setOption(idx: number, value: string) {
    setOptions((prev) => prev.map((o, i) => (i === idx ? value : o)));
  }

  function addOption() {
    setOptions((prev) =>
      prev.length >= MAX_OPTIONS ? prev : [...prev, ""],
    );
  }

  function removeOption(idx: number) {
    setOptions((prev) => {
      if (prev.length <= 2) return prev;
      return prev.filter((_, i) => i !== idx);
    });
    // Keep the correct answer pointing at the right option after a removal.
    setCorrectIdx((prev) => {
      if (idx === prev) return 0;
      return idx < prev ? prev - 1 : prev;
    });
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;

    // Client-side pre-check for UX; the server action is authoritative.
    const filled = options.map((o) => o.trim()).filter(Boolean);
    if (!prompt.trim()) {
      setError("Pytanie jest wymagane.");
      return;
    }
    if (filled.length < 2) {
      setError("Podaj co najmniej 2 odpowiedzi.");
      return;
    }
    if (!options[correctIdx]?.trim()) {
      setError("Poprawna odpowiedź nie może być pusta.");
      return;
    }

    setPending(true);
    setError(null);
    const input: QuestionInput = { prompt, options, correct_idx: correctIdx };
    try {
      if (props.mode === "edit") {
        await updateQuestion(props.question.id, input);
      } else {
        await createQuestion(props.textId, input);
      }
      await queryClient.invalidateQueries({
        queryKey: adminKeys.questions(props.textId),
      });
      await queryClient.invalidateQueries({ queryKey: adminKeys.texts() });

      if (props.mode === "create") {
        setPrompt("");
        setOptions(["", "", "", ""]);
        setCorrectIdx(0);
        props.onDone?.();
      } else {
        props.onDone();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Coś poszło nie tak.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-3 rounded-lg border border-border bg-card p-3"
    >
      <div className="space-y-1.5">
        <label htmlFor="q-prompt" className="block text-sm font-medium text-main">
          Pytanie
        </label>
        <Textarea
          id="q-prompt"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Treść pytania"
          className="min-h-16"
        />
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium text-main">
          Odpowiedzi (zaznacz poprawną)
        </p>
        {options.map((option, idx) => (
          <div key={idx} className="flex items-center gap-2">
            <input
              type="radio"
              name="correct"
              checked={correctIdx === idx}
              onChange={() => setCorrectIdx(idx)}
              className="size-4 accent-gold"
              aria-label={`Poprawna odpowiedź ${idx + 1}`}
            />
            <Input
              value={option}
              onChange={(e) => setOption(idx, e.target.value)}
              placeholder={`Odpowiedź ${idx + 1}`}
            />
            {options.length > 2 && (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Usuń odpowiedź"
                onClick={() => removeOption(idx)}
              >
                <X className="size-4" />
              </Button>
            )}
          </div>
        ))}
        {options.length < MAX_OPTIONS && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={addOption}
          >
            <Plus className="size-4" />
            Dodaj odpowiedź
          </Button>
        )}
      </div>

      {error && <p className="text-sm text-red">{error}</p>}

      <div className="flex gap-2">
        <Button
          type="submit"
          disabled={pending}
          size="sm"
          className="bg-gold text-[#1a202c] hover:bg-gold-dark"
        >
          {pending
            ? "Zapisywanie…"
            : props.mode === "edit"
              ? "Zapisz pytanie"
              : "Dodaj pytanie"}
        </Button>
        {props.mode === "edit" && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => props.onDone()}
          >
            Anuluj
          </Button>
        )}
      </div>
    </form>
  );
}
