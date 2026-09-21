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
import { useMaterialCover, type CoverTarget } from "@/hooks/useMaterialCover";
import { BodyContent } from "@/components/texts/BodyContent";
import { MaterialCoverField } from "@/components/admin/MaterialCoverField";
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

  /**
   * Artwork, through the shared choreography.
   *
   * `cover.coverUrl` is what is saved on the library item; `cover.file` is a
   * local choice that has not cost anything yet. Both can be set at once — that
   * is „Zmień obraz" — and the saved one is only replaced once the new upload
   * has actually succeeded. A passage addresses the material by its `texts` id;
   * `useMaterialCover` translates that to the library item the picture belongs
   * to, which is the same one `/admin/library` edits directly.
   */
  const cover = useMaterialCover();
  const coverTarget: CoverTarget | null =
    props.mode === "edit" ? { kind: "legacy", textId: props.textId } : null;
  const [notice, setNotice] = useState<string | null>(null);

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
    cover.setCoverUrl(existing.coverUrl);
    seededRef.current = true;
    // `cover` is a stable hook handle; only the loaded row should retrigger this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existing]);

  /** Choose (or unchoose) the image, and say what that means in this mode. */
  function chooseCover(file: File | null) {
    setNotice(null);
    cover.choose(file);
    cover.setStatus(
      // In create mode the image genuinely does wait for the text, so the field
      // says so rather than leaving an admin to guess.
      file && props.mode === "create"
        ? "Obraz zostanie przesłany po zapisaniu tekstu."
        : null,
    );
  }

  /**
   * What happens the moment an image is picked — and it depends on the mode.
   *
   * IN EDIT MODE IT UPLOADS NOW. The text already exists, so the image has
   * nothing to wait for, and making it wait for a „Zapisz" button below a
   * full-height `Treść` field and its preview is how an upload control ends up
   * looking broken: you choose a file, you see it, and nothing in the section
   * says it has not been sent. Picking IS the action; the section then shows the
   * progress and, when it finishes, the saved image.
   *
   * IN CREATE MODE IT CANNOT, because there is no id to attach the image to yet.
   * So it stays a pending choice and the field SAYS so, and `onSubmit` uploads it
   * the moment the text has an id.
   */
  async function onPickCover(file: File | null) {
    chooseCover(file);
    if (!file || !coverTarget || props.mode !== "edit") return;

    const saved = await cover.upload(coverTarget, file);
    // A failure keeps the file AND its preview, so the next „Zapisz" retries it
    // and nothing the admin chose is silently dropped.
    if (!saved) {
      cover.setStatus("Wybierz obraz ponownie albo zapisz tekst, żeby spróbować jeszcze raz.");
      return;
    }

    cover.setCoverUrl(saved);
    cover.choose(null);
    cover.setStatus("Obraz zapisany.");
    await invalidateCover(props.textId);
  }

  async function onParse() {
    if (compiling || !source.trim()) return;
    setCompiling(true);
    setError(null);
    setParseInfo(null);
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

  /**
   * „Usuń".
   *
   * In create mode there is nothing to delete yet, so it only forgets the local
   * choice. In edit mode it is a real deletion — the column is cleared and the
   * object we own is removed — which is why the field asks for confirmation
   * before calling this.
   */
  async function onRemoveCover() {
    if (cover.file) {
      // A saved cover stays saved: clearing a pending choice is "nie ten obraz",
      // not "usuń ten, który jest".
      chooseCover(null);
      return;
    }

    setNotice(null);
    cover.setStatus(null);

    if (!coverTarget || props.mode !== "edit" || !cover.coverUrl) {
      cover.setCoverUrl(null);
      return;
    }

    if (!(await cover.remove(coverTarget))) return;

    cover.setCoverUrl(null);
    cover.setStatus("Obraz usunięty.");
    await invalidateCover(props.textId);
  }

  /**
   * What a cover change actually invalidates on the client.
   *
   * The one query that renders it. Not the whole cache: Today and the library
   * are server-rendered and are revalidated by the action itself, and the admin
   * list does not show artwork at all.
   */
  async function invalidateCover(id: number) {
    await queryClient.invalidateQueries({ queryKey: ["adminText", id] });
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (pending || cover.busy) return;
    setPending(true);
    setError(null);
    setNotice(null);

    const input: TextInput = { title, cefr, body, status };
    try {
      if (props.mode === "edit") {
        await updateText(props.textId, input);

        // Normally the image is already up — picking one uploads it immediately
        // in this mode. This is the RETRY path, for a pick whose upload failed.
        if (cover.file && coverTarget) {
          const saved = await cover.upload(coverTarget, cover.file);
          if (saved) {
            cover.setCoverUrl(saved);
            cover.choose(null);
            cover.setStatus("Obraz zapisany.");
          }
          // A failed image upload does not undo a saved text, and the form stays
          // where it is so the admin can simply try the image again.
        }

        await invalidateCover(props.textId);
        await queryClient.invalidateQueries({ queryKey: ["adminTexts"] });
        await queryClient.invalidateQueries({ queryKey: ["texts"] });
      } else {
        const created = await createText(input);

        await queryClient.invalidateQueries({ queryKey: ["adminTexts"] });
        await queryClient.invalidateQueries({ queryKey: ["texts"] });

        // THE TEXT IS SAVED BEFORE THE IMAGE IS, because the image needs an id
        // to belong to. If the upload then fails, the text is NOT rolled back —
        // deleting somebody's just-written passage because a JPEG did not go up
        // would be indefensible. The admin is sent to this text's edit screen,
        // where retrying the image cannot create a second copy of the text.
        if (cover.file) {
          const saved = await cover.upload(
            { kind: "legacy", textId: created.id },
            cover.file,
          );
          if (!saved) {
            setNotice(
              "Tekst został zapisany, ale nie udało się przesłać obrazu. Możesz spróbować ponownie.",
            );
            router.push(`/admin/texts/${created.id}`);
            return;
          }
          await invalidateCover(created.id);
        }

        router.push("/admin");
      }
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

      {/* After the identity of the material, before its content: the picture is
          part of what this text IS, not part of writing it. */}
      <MaterialCoverField
        label="Obraz tekstu"
        coverUrl={cover.coverUrl}
        localUrl={cover.preview}
        onSelect={onPickCover}
        onRemove={onRemoveCover}
        uploading={cover.uploading}
        percent={cover.percent}
        removing={cover.removing}
        hint={cover.status}
        error={cover.error}
        disabled={pending}
      />

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

      {notice && <p className="text-sm text-gold">{notice}</p>}
      {error && <p className="text-sm text-red">{error}</p>}

      <div className="flex gap-3">
        <Button
          type="submit"
          disabled={pending || cover.busy}
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
