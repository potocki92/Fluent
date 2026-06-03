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
import { compileText } from "@/actions/admin-compile";
import { useAdminText } from "@/hooks/useAdminTexts";
import { BodyContent } from "@/components/texts/BodyContent";
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
  const [source, setSource] = useState("");
  const [compiling, setCompiling] = useState(false);
  const [parseInfo, setParseInfo] = useState<string | null>(null);
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

  async function onParse() {
    if (compiling || !source.trim()) return;
    setCompiling(true);
    setError(null);
    try {
      const { html, matched, unmatched } = await compileText(source);
      setBody(html);
      setParseInfo(
        `Oznaczono ${matched.length} słów ze słownika • ${unmatched.length} nierozpoznanych`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nie udało się sparsować tekstu.");
    } finally {
      setCompiling(false);
    }
  }

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
        <label htmlFor="text-source" className={labelClass}>
          Tekst źródłowy (zwykły tekst / markdown)
        </label>
        <Textarea
          id="text-source"
          value={source}
          onChange={(e) => setSource(e.target.value)}
          placeholder="Wpisz tekst po niemiecku. Pusta linia = nowy akapit, ## nagłówek, **pogrubienie**, _kursywa_, - lista."
          className="min-h-40"
        />
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            onClick={onParse}
            disabled={compiling || !source.trim()}
            className="bg-gold text-[#1a202c] hover:bg-gold-dark"
          >
            {compiling ? "Parsowanie…" : "Parsuj do HTML"}
          </Button>
          {parseInfo && <p className="text-xs text-muted2">{parseInfo}</p>}
        </div>
        <p className="text-xs text-muted2">
          Parser zamienia tekst na HTML i automatycznie oznacza słowa ze
          słownika. Wynik trafia do pola „Treść” poniżej — możesz go poprawić
          przed zapisem.
        </p>
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

      {body.trim() && (
        <div className="space-y-1.5">
          <p className={labelClass}>Podgląd</p>
          <div className="rounded-lg border border-border bg-card p-4">
            <BodyContent body={body} />
          </div>
        </div>
      )}

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
