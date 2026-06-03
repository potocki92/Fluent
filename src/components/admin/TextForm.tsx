"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createText, updateText } from "@/actions/admin-texts";
import { useAdminText } from "@/hooks/useAdminTexts";
import type { StoredCefrLevel, TextInput, TextStatus } from "@/types";

const CEFR_OPTIONS: StoredCefrLevel[] = ["A1", "A2", "B1", "B2"];

type Props = { mode: "create" } | { mode: "edit"; textId: number };

const labelClass =
  "block text-sm font-medium text-main";

export function TextForm(props: Props) {
  const router = useRouter();
  const queryClient = useQueryClient();

  const textId = props.mode === "edit" ? props.textId : null;
  const { data: existing } = useAdminText(textId ?? Number.NaN);

  const [title, setTitle] = useState("");
  const [cefr, setCefr] = useState<StoredCefrLevel>("A1");
  const [body, setBody] = useState("");
  const [status, setStatus] = useState<TextStatus>("draft");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Seed the form once from the loaded row (edit mode). The ref guard prevents a
  // background refetch from clobbering in-progress edits — same approach as
  // `useProfile`'s hydration.
  const seededRef = useRef(false);
  useEffect(() => {
    if (!existing || seededRef.current) return;
    setTitle(existing.title);
    setCefr(existing.cefr);
    setBody(existing.body);
    setStatus(existing.status);
    seededRef.current = true;
  }, [existing]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);

    const input: TextInput = { title, cefr, body, status };
    try {
      if (props.mode === "edit") {
        await updateText(props.textId, input);
        await queryClient.invalidateQueries({ queryKey: ["adminText", props.textId] });
      } else {
        await createText(input);
      }
      await queryClient.invalidateQueries({ queryKey: ["adminTexts"] });
      await queryClient.invalidateQueries({ queryKey: ["texts"] });
      if (props.mode === "create") router.push("/admin");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Coś poszło nie tak.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <label htmlFor="text-title" className={labelClass}>
          Tytuł
        </label>
        <Input
          id="text-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Tytuł tekstu"
        />
      </div>

      <div className="flex gap-3">
        <div className="space-y-1.5">
          <label className={labelClass}>Poziom CEFR</label>
          <Select
            value={cefr}
            onValueChange={(v) => setCefr(v as StoredCefrLevel)}
          >
            <SelectTrigger className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CEFR_OPTIONS.map((level) => (
                <SelectItem key={level} value={level}>
                  {level}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <label className={labelClass}>Status</label>
          <Select
            value={status}
            onValueChange={(v) => setStatus(v as TextStatus)}
          >
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="draft">Szkic</SelectItem>
              <SelectItem value="published">Opublikowany</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="text-body" className={labelClass}>
          Treść
        </label>
        <Textarea
          id="text-body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Treść tekstu (HTML dozwolony: p, h2, h3, strong, em, ul, ol, li, mark)"
          className="min-h-64"
        />
        <p className="text-xs text-muted2">
          Słownictwo oznaczasz tagiem{" "}
          <code>&lt;mark data-lemma=&quot;lemat&quot;&gt;…&lt;/mark&gt;</code>.
          Liczba słów liczy się automatycznie.
        </p>
      </div>

      {error && <p className="text-sm text-red">{error}</p>}

      <div className="flex gap-3">
        <Button
          type="submit"
          disabled={pending}
          className="bg-gold text-[#1a202c] hover:bg-gold-dark"
        >
          {pending ? "Zapisywanie…" : "Zapisz"}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => router.push("/admin")}
        >
          Anuluj
        </Button>
      </div>
    </form>
  );
}
