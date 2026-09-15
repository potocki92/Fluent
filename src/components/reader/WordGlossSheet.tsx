"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BookmarkCheck,
  BookmarkPlus,
  HelpCircle,
  Lightbulb,
  NotebookPen,
  Pencil,
  Plus,
  Volume2,
} from "lucide-react";
import { useState } from "react";

import { setSentenceUnclear } from "@/actions/notebook";
import { saveWordFromReader } from "@/actions/reading";
import type { GlossTarget } from "@/components/reader/reader-interaction";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import {
  occurrenceMeaning,
  phrasesCovering,
  sentenceNotebookKey,
  useSentenceNotebook,
} from "@/hooks/useSentenceNotebook";
import { newInteractionId } from "@/lib/interaction-id";
import { speakGerman } from "@/lib/speech";
import { createClientSupabaseClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

export type { GlossTarget };

interface GlossWord {
  id: number;
  display: string;
  article: string | null;
  word_type: string;
  translation_pl: string | null;
  example_de: string | null;
  example_pl: string | null;
  ipa: string | null;
  plural: string | null;
}

/**
 * The gloss — the word sheet, reordered around CONTEXT.
 *
 * WHAT CHANGED IN PHASE 5.6, AND WHY. The sheet used to lead with the dictionary:
 * headword, IPA, general translation, then the sentence underneath as supporting
 * detail. For a learner reading a novel that is backwards. Someone who taps
 * *sollten* in
 *
 *     „Wir sollten umkehren“, drängte Gared.
 *
 * is not asking what *sollen* means in general — they are asking what this word
 * is doing in this sentence. *powinien / mieć powinność* is a true answer to a
 * question nobody asked, and *powinniśmy* is the answer they needed.
 *
 * So the order is now: the word as written → what it means HERE → the sentence,
 * with the learner's own translation of it → the shared dictionary → an example →
 * the review action (§94). The dictionary has not been demoted, it has been put
 * where it belongs: as the general fact behind the specific one.
 *
 * TWO LEVELS, NEVER ONE LINE (§24). "W TYM MIEJSCU" and "SŁOWNIK" are separate,
 * labelled sections because they are different claims by different authors — one
 * the learner's, one the dictionary's. Merging them would be how a personal note
 * quietly becomes a dictionary entry.
 *
 * AND NOT TWICE (§96). When the learner's contextual meaning says the same thing
 * as the dictionary, the dictionary block is dropped rather than repeated: two
 * identical paragraphs half a screen apart is worse than one.
 *
 * NOTHING EMPTY TAKES UP ROOM (§25). With no contextual meaning there is no
 * empty section — there is one quiet line offering to add one.
 *
 * AND "NIE ROZUMIEM" IS HERE TOO. It used to live only on the sentence action
 * bar, which meant a learner stuck on a sentence had to close the word sheet and
 * then hit the few millimetres of space BETWEEN two words to admit it — on a
 * phone, a gesture that mostly reopens a word. The flag is about the sentence
 * already quoted on this sheet, so it belongs on this sheet. The action bar
 * keeps it as well: two ways in, one piece of state, and the same
 * `setSentenceUnclear` behind both.
 */
export function WordGlossSheet({
  target,
  readingSessionId,
  onClose,
  onAddMeaning,
  onTranslateSentence,
}: {
  target: GlossTarget | null;
  /** Attached to the "nie rozumiem" signal, so it lands in the right session. */
  readingSessionId?: string | null;
  onClose: () => void;
  /** Opens the shared annotation editor for this token. */
  onAddMeaning: (target: GlossTarget) => void;
  /** Opens the shared translation editor for this sentence. */
  onTranslateSentence: (sentenceId: number, sentenceText: string) => void;
}) {
  const queryClient = useQueryClient();
  // Which occurrence was saved, rather than a boolean reset by an effect: the
  // "W powtórkach" state belongs to ONE word, and deriving it means opening the
  // next word cannot briefly show the previous word's confirmation.
  const [savedOccurrence, setSavedOccurrence] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const saved = target !== null && savedOccurrence === target.occurrenceId;

  // THE DICTIONARY, cached by word — a lexeme's general translation is the same
  // everywhere it appears, so this cache is shared across the whole book.
  const { data, isLoading } = useQuery({
    queryKey: ["reader-gloss", target?.wordId ?? target?.lemma ?? ""],
    enabled: target !== null,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<GlossWord | null> => {
      if (!target) return null;
      const supabase = createClientSupabaseClient();
      const query = supabase
        .from("words")
        .select(
          "id, display, article, word_type, translation_pl, example_de, example_pl, ipa, plural",
        )
        .limit(1);

      const { data, error } = target.wordId
        ? await query.eq("id", target.wordId).maybeSingle()
        : await query.ilike("lemma", target.lemma).maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  // THE PERSONAL LAYER, cached by SENTENCE — never by word. *ziehen* means
  // different things in different sentences, and a cache keyed by word would
  // show one sentence's note under another (§110, §138).
  const { data: notebook } = useSentenceNotebook(target?.sentenceId ?? null);
  const contextMeaning = occurrenceMeaning(notebook, target?.tokenPosition ?? null);
  const phrases = phrasesCovering(notebook, target?.tokenPosition ?? null);
  const translation = notebook?.note?.meaning ?? null;
  const isUnclear = notebook?.note?.is_unclear ?? false;

  // "NIE ROZUMIEM" IS EVIDENCE, NOT A VERDICT, AND IT IS REVERSIBLE (§18, §19).
  // One interaction id per tap: the log keeps the sequence, the flag is current
  // state. Invalidating `["notebook"]` refreshes this sentence, the chapter's
  // marks in the prose and the notebook page from one key.
  const unclear = useMutation({
    mutationFn: async (next: boolean) => {
      if (target?.sentenceId == null) throw new Error("Brak zdania.");
      const result = await setSentenceUnclear({
        sentenceId: target.sentenceId,
        unclear: next,
        interactionId: newInteractionId(),
        readingSessionId,
      });
      if (!result.ok) throw new Error(result.message);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: sentenceNotebookKey(target?.sentenceId ?? null),
      });
      void queryClient.invalidateQueries({ queryKey: ["notebook"] });
    },
  });

  // §96: one claim, shown once.
  const dictionaryIsRedundant =
    contextMeaning?.meaning !== undefined &&
    contextMeaning?.meaning !== null &&
    normalize(contextMeaning.meaning) === normalize(data?.translation_pl ?? "");

  async function onSave() {
    if (!target?.wordId || saving) return;
    setSaving(true);
    const result = await saveWordFromReader({
      wordId: target.wordId,
      occurrenceId: target.occurrenceId,
    });
    setSaving(false);
    if (result.ok) setSavedOccurrence(target.occurrenceId);
  }

  return (
    <Sheet open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="bottom"
        // No close button: the built-in one sits top-right, exactly where the
        // pronunciation control belongs. A bottom sheet is dismissed by tapping
        // outside it or pressing Escape, and the handle below says so.
        showCloseButton={false}
        className="max-h-[80svh] gap-0 overflow-y-auto rounded-t-2xl border-t border-[#374151] bg-[#2d3748] px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-3 text-main"
      >
        <div
          aria-hidden
          className="mx-auto mb-3 h-1 w-10 shrink-0 rounded-full bg-[#4b5563]"
        />
        <SheetTitle className="sr-only">
          {target ? `Słowo: ${target.surface}` : "Słowo"}
        </SheetTitle>

        {target === null ? null : isLoading ? (
          <GlossSkeleton surface={target.surface} />
        ) : (
          <div className="space-y-4">
            {/* 1. THE WORD AS WRITTEN. The surface leads, because it is what is
                on the page; the headword follows it as the general form. */}
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xl font-semibold break-words">{target.surface}</p>
                <p className="mt-0.5 text-sm text-muted2">
                  {[
                    data && data.display !== target.surface ? data.display : null,
                    data?.ipa,
                    data?.plural ? `l.mn. ${data.plural}` : null,
                    !data ? "spoza słownika" : null,
                  ]
                    .filter(Boolean)
                    .join(" · ") || wordTypeLabel(data?.word_type ?? "")}
                </p>
              </div>
              <button
                type="button"
                onClick={() => speakGerman(data?.display ?? target.surface)}
                aria-label="Odsłuchaj wymowę"
                className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[#374151] text-muted2 transition-colors hover:text-main"
              >
                <Volume2 className="size-5" />
              </button>
            </div>

            {/* 2. WHAT IT MEANS HERE. */}
            <Section label="W tym miejscu">
              {contextMeaning?.meaning ? (
                <div className="flex items-start justify-between gap-2">
                  <p className="text-lg text-gold">{contextMeaning.meaning}</p>
                  <QuietButton
                    icon={<Pencil className="size-3.5" />}
                    label="Edytuj"
                    onClick={() => onAddMeaning(target)}
                  />
                </div>
              ) : (
                <QuietButton
                  icon={<Plus className="size-3.5" />}
                  label={
                    target.wordId
                      ? "Dodaj znaczenie w tym miejscu"
                      : "Dodaj do mojego słownika"
                  }
                  onClick={() => onAddMeaning(target)}
                />
              )}
              {contextMeaning?.lemma && (
                <p className="mt-1 text-xs text-muted2">
                  forma podstawowa: {contextMeaning.lemma}
                </p>
              )}
            </Section>

            {/* 3. THE SENTENCE, and the learner's own Polish for it. */}
            {target.sentence && target.sentenceId !== null && (
              <div className="space-y-2">
                <blockquote
                  className={cn(
                    "rounded-lg border-l-2 bg-[#374151]/60 px-3 py-2 text-sm italic leading-relaxed text-main",
                    isUnclear ? "border-gold" : "border-gold/50",
                  )}
                >
                  {target.sentence}
                </blockquote>

                {translation ? (
                  <div className="rounded-lg bg-[#374151]/40 px-3 py-2">
                    <p className="text-[0.7rem] font-semibold uppercase tracking-wide text-muted2">
                      Twoje tłumaczenie
                    </p>
                    <p className="mt-0.5 text-sm leading-relaxed">{translation}</p>
                    <QuietButton
                      icon={<Pencil className="size-3.5" />}
                      label="Edytuj tłumaczenie"
                      onClick={() =>
                        target.sentenceId !== null &&
                        onTranslateSentence(target.sentenceId, target.sentence)
                      }
                    />
                  </div>
                ) : (
                  <QuietButton
                    icon={<NotebookPen className="size-3.5" />}
                    label="Przetłumacz zdanie"
                    onClick={() =>
                      target.sentenceId !== null &&
                      onTranslateSentence(target.sentenceId, target.sentence)
                    }
                  />
                )}

                {/* §14: someone who cannot read a sentence cannot translate it,
                    so this must not require the editor above — and it must not
                    require closing this sheet to go hunting for the sentence
                    either. Reversible in the same place it was set (§18). */}
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

                {unclear.isError && (
                  <p className="text-center text-xs text-red">
                    Nie udało się zapisać. Spróbuj ponownie.
                  </p>
                )}
                {isUnclear && !unclear.isError && (
                  <p className="text-center text-xs text-muted2">
                    To zdanie trafi do sekcji „Do wyjaśnienia” w Twoim zeszycie.
                  </p>
                )}
              </div>
            )}

            {/* Phrases the learner has already saved around this word. Context,
                never this word's meaning (§4). */}
            {phrases.length > 0 && (
              <Section label="Zapisane zwroty">
                <ul className="space-y-1">
                  {phrases.map((phrase) => (
                    <li key={phrase.entry_id} className="text-sm">
                      <span className="font-medium">{phrase.surface}</span>
                      {phrase.meaning && (
                        <span className="text-muted2"> — {phrase.meaning}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            {/* 4. THE SHARED DICTIONARY. */}
            {data?.translation_pl && !dictionaryIsRedundant && (
              <Section label="Słownik">
                <p className="text-sm text-main">{data.translation_pl}</p>
              </Section>
            )}

            {/* 5. AN EXAMPLE. */}
            {data?.example_de && (
              <div className="space-y-0.5 text-sm">
                <p className="italic text-muted2">{data.example_de}</p>
                {data.example_pl && <p className="text-muted2">{data.example_pl}</p>}
              </div>
            )}

            {/* 6. THE REVIEW ACTION. A word Fluent's dictionary does not know
                 cannot enter the word deck — but it is not a dead end either:
                 the personal meaning above IS its notebook entry, and that can
                 be reviewed (§82, §86). */}
            {target.wordId ? (
              <Button
                type="button"
                onClick={onSave}
                disabled={saved || saving}
                className={cn(
                  "w-full",
                  saved
                    ? "bg-[#374151] text-muted2"
                    : "bg-gold text-[#1a202c] hover:bg-gold-dark",
                )}
              >
                {saved ? (
                  <>
                    <BookmarkCheck className="size-4" /> W powtórkach
                  </>
                ) : (
                  <>
                    <BookmarkPlus className="size-4" /> Dodaj do powtórek
                  </>
                )}
              </Button>
            ) : (
              <p className="text-center text-xs text-muted2">
                Tego słowa nie ma jeszcze w słowniku Fluent — zapisz własne
                znaczenie, a trafi do Twojego zeszytu.
              </p>
            )}
            {saved && (
              <p className="text-center text-xs text-muted2">
                Zdanie z książki zostało zapisane razem ze słowem.
              </p>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h3 className="text-[0.7rem] font-semibold uppercase tracking-wide text-muted2">
        {label}
      </h3>
      <div className="mt-1">{children}</div>
    </section>
  );
}

/**
 * A quiet, inline affordance rather than a button-shaped block.
 *
 * §25: an empty "W tym miejscu" section rendered as a full-width card would take
 * half the sheet to say nothing. One line of text with a plus on it says the same
 * thing and leaves the room to the sentence.
 */
function QuietButton({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="-mx-1 mt-1 flex min-h-9 items-center gap-1.5 rounded-lg px-1 text-sm font-medium text-gold transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/50"
    >
      {icon}
      {label}
    </button>
  );
}

function GlossSkeleton({ surface }: { surface: string }) {
  return (
    <div className="space-y-3">
      <p className="text-xl font-semibold">{surface}</p>
      <div className="h-4 w-32 animate-pulse rounded bg-[#374151]" />
      <div className="h-4 w-48 animate-pulse rounded bg-[#374151]" />
      <div className="h-10 w-full animate-pulse rounded bg-[#374151]" />
    </div>
  );
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function wordTypeLabel(type: string): string {
  if (type === "noun") return "rzeczownik";
  if (type === "verb") return "czasownik";
  return "";
}
