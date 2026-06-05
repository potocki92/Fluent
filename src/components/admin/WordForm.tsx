"use client";

import { useState } from "react";
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
import { createWord, updateWord } from "@/actions/admin-words";
import { WORD_TOPICS } from "@/lib/word-topics";
import type {
  StoredCefrLevel,
  Word,
  WordAux,
  WordInput,
  WordTopic,
  WordType,
} from "@/types";

/** Sentinel for the "no value" option in nullable Selects (Radix forbids ""). */
const NONE = "none";

const labelClass = "block text-sm font-medium text-main";

/** Read a Select value, mapping the {@link NONE} sentinel back to null. */
function fromSelect<T extends string>(value: string): T | null {
  return value === NONE ? null : (value as T);
}

type Props = { word?: Word; onDone: () => void };

/**
 * Create/edit form for a dictionary entry, rendered inside a Dialog by
 * {@link AdminWordList}. Mirrors the controlled-state + Server Action pattern of
 * {@link TextForm}: on submit it calls createWord/updateWord and invalidates the
 * admin and learner word caches.
 */
export function WordForm({ word, onDone }: Props) {
  const queryClient = useQueryClient();
  const isEdit = word !== undefined;

  const [lemma, setLemma] = useState(word?.lemma ?? "");
  const [display, setDisplay] = useState(word?.display ?? "");
  const [translation, setTranslation] = useState(word?.translation_pl ?? "");
  const [wordType, setWordType] = useState<WordType>(word?.word_type ?? "noun");
  const [cefr, setCefr] = useState<StoredCefrLevel | null>(word?.cefr ?? null);
  const [article, setArticle] = useState<Word["article"]>(word?.article ?? null);
  const [gender, setGender] = useState<Word["gender"]>(word?.gender ?? null);
  const [topic, setTopic] = useState<WordTopic | null>(
    (word?.topic as WordTopic | null) ?? null,
  );
  const [aux, setAux] = useState<WordAux | null>(word?.aux ?? null);
  const [plural, setPlural] = useState(word?.plural ?? "");
  const [ipa, setIpa] = useState(word?.ipa ?? "");
  const [synonyms, setSynonyms] = useState((word?.synonyms ?? []).join(", "));
  const [exampleDe, setExampleDe] = useState(word?.example_de ?? "");
  const [examplePl, setExamplePl] = useState(word?.example_pl ?? "");
  const [source, setSource] = useState(word?.source ?? "");

  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);

    const input: WordInput = {
      lemma,
      display,
      article,
      word_type: wordType,
      gender,
      translation_pl: translation,
      example_de: exampleDe,
      example_pl: examplePl,
      cefr,
      source,
      topic,
      plural,
      aux,
      synonyms: synonyms
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      ipa,
    };

    try {
      if (isEdit) {
        await updateWord(word.id, input);
      } else {
        await createWord(input);
      }
      await queryClient.invalidateQueries({ queryKey: ["adminWords"] });
      await queryClient.invalidateQueries({ queryKey: ["words"] });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Coś poszło nie tak.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="word-display" className={labelClass}>
            Forma wyświetlana
          </label>
          <Input
            id="word-display"
            value={display}
            onChange={(e) => setDisplay(e.target.value)}
            placeholder="die Autobahn"
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="word-lemma" className={labelClass}>
            Lemat
          </label>
          <Input
            id="word-lemma"
            value={lemma}
            onChange={(e) => setLemma(e.target.value)}
            placeholder="Autobahn"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="word-translation" className={labelClass}>
          Tłumaczenie (PL)
        </label>
        <Input
          id="word-translation"
          value={translation}
          onChange={(e) => setTranslation(e.target.value)}
          placeholder="autostrada"
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <label className={labelClass}>Typ</label>
          <Select value={wordType} onValueChange={(v) => setWordType(v as WordType)}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="noun">rzeczownik</SelectItem>
              <SelectItem value="verb">czasownik</SelectItem>
              <SelectItem value="other">inne</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <label className={labelClass}>Poziom CEFR</label>
          <Select
            value={cefr ?? NONE}
            onValueChange={(v) => setCefr(fromSelect<StoredCefrLevel>(v))}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>—</SelectItem>
              <SelectItem value="A1">A1</SelectItem>
              <SelectItem value="A2">A2</SelectItem>
              <SelectItem value="B1">B1</SelectItem>
              <SelectItem value="B2">B2</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <label className={labelClass}>Temat</label>
          <Select
            value={topic ?? NONE}
            onValueChange={(v) => setTopic(fromSelect<WordTopic>(v))}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>—</SelectItem>
              {WORD_TOPICS.map((t) => (
                <SelectItem key={t.value} value={t.value}>
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <label className={labelClass}>Rodzajnik</label>
          <Select
            value={article ?? NONE}
            onValueChange={(v) => setArticle(fromSelect<"der" | "die" | "das">(v))}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>—</SelectItem>
              <SelectItem value="der">der</SelectItem>
              <SelectItem value="die">die</SelectItem>
              <SelectItem value="das">das</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <label className={labelClass}>Rodzaj</label>
          <Select
            value={gender ?? NONE}
            onValueChange={(v) => setGender(fromSelect<"m" | "f" | "n">(v))}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>—</SelectItem>
              <SelectItem value="m">m</SelectItem>
              <SelectItem value="f">f</SelectItem>
              <SelectItem value="n">n</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <label className={labelClass}>Posiłkowy (czasownik)</label>
          <Select
            value={aux ?? NONE}
            onValueChange={(v) => setAux(fromSelect<WordAux>(v))}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>—</SelectItem>
              <SelectItem value="haben">haben</SelectItem>
              <SelectItem value="sein">sein</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <label htmlFor="word-plural" className={labelClass}>
            Liczba mnoga
          </label>
          <Input
            id="word-plural"
            value={plural}
            onChange={(e) => setPlural(e.target.value)}
            placeholder="die Autobahnen"
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="word-ipa" className={labelClass}>
            Wymowa (IPA)
          </label>
          <Input
            id="word-ipa"
            value={ipa}
            onChange={(e) => setIpa(e.target.value)}
            placeholder="ˈʔaʊtoˌbaːn"
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="word-source" className={labelClass}>
            Źródło
          </label>
          <Input
            id="word-source"
            value={source}
            onChange={(e) => setSource(e.target.value)}
            placeholder="DTZ"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="word-synonyms" className={labelClass}>
          Synonimy (oddzielone przecinkami)
        </label>
        <Input
          id="word-synonyms"
          value={synonyms}
          onChange={(e) => setSynonyms(e.target.value)}
          placeholder="die Schnellstraße, die Fernstraße"
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="word-example-de" className={labelClass}>
          Przykład (DE)
        </label>
        <Textarea
          id="word-example-de"
          value={exampleDe}
          onChange={(e) => setExampleDe(e.target.value)}
          className="min-h-16"
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="word-example-pl" className={labelClass}>
          Przykład (PL)
        </label>
        <Textarea
          id="word-example-pl"
          value={examplePl}
          onChange={(e) => setExamplePl(e.target.value)}
          className="min-h-16"
        />
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
        <Button type="button" variant="outline" onClick={onDone}>
          Anuluj
        </Button>
      </div>
    </form>
  );
}
