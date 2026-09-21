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
import {
  commitTextCoverUpload,
  prepareTextCoverUpload,
  removeTextCover,
} from "@/actions/admin-covers";
import { compileText } from "@/actions/admin-compile";
import { useAdminText } from "@/hooks/useAdminTexts";
import { BodyContent } from "@/components/texts/BodyContent";
import { TextCoverField } from "@/components/admin/TextCoverField";
import { settleAction } from "@/lib/errors";
import { COVER_ERROR_MESSAGES } from "@/lib/library/covers";
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

  // Artwork. `coverUrl` is what is saved on the library item; `coverFile` is a
  // local choice that has not cost anything yet. Both can be set at once — that
  // is "zmień obraz" — and the saved one is only replaced once the new upload
  // has actually succeeded.
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const [coverPercent, setCoverPercent] = useState(0);
  const [coverUploading, setCoverUploading] = useState(false);
  const [coverRemoving, setCoverRemoving] = useState(false);
  const [coverError, setCoverError] = useState<string | null>(null);
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
    setCoverUrl(existing.coverUrl);
    seededRef.current = true;
  }, [existing]);

  /**
   * Choose (or unchoose) the image, and own its preview.
   *
   * `URL.createObjectURL` shows the file the instant it is picked, and the
   * previous one is released in the same breath — an admin trying five photos
   * must not leave five blobs pinned for the life of the page. The URL is made
   * here, in the handler, rather than in an effect: an effect that calls
   * `setState` to mirror a prop is a cascading render, and the lifecycle is
   * perfectly expressible where the change actually happens.
   */
  function chooseCover(file: File | null) {
    setCoverError(null);
    setNotice(null);

    if (coverPreviewRef.current) URL.revokeObjectURL(coverPreviewRef.current);
    const preview = file ? URL.createObjectURL(file) : null;
    coverPreviewRef.current = preview;

    setCoverPreview(preview);
    setCoverFile(file);
  }

  // The live blob URL, mirrored into a ref so the unmount cleanup releases the
  // CURRENT one rather than whatever existed when the form mounted.
  const coverPreviewRef = useRef<string | null>(null);
  useEffect(() => {
    return () => {
      if (coverPreviewRef.current) URL.revokeObjectURL(coverPreviewRef.current);
    };
  }, []);

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
   * Get one chosen image onto the material.
   *
   * THREE STEPS, IN THIS ORDER, and the order is the whole safety story: ask the
   * server for a path it chose, PUT the bytes straight to Storage, and only then
   * record the result. The previous image is deleted by the commit, after the
   * new URL is saved — so a failed upload leaves the material with the picture it
   * already had rather than with none.
   *
   * Returns the saved URL, or `null` when something went wrong; the caller
   * decides what that means, because it means different things in create mode
   * (the text is saved, the image is not) and in edit mode (nothing changed).
   */
  async function uploadCover(id: number, file: File): Promise<string | null> {
    setCoverUploading(true);
    setCoverPercent(0);
    setCoverError(null);
    try {
      const prepared = await settleAction(
        () =>
          prepareTextCoverUpload({
            textId: id,
            fileName: file.name,
            mimeType: file.type || null,
            fileSize: file.size,
          }),
        "prepareTextCoverUpload",
      );
      if (!prepared.ok) {
        setCoverError(prepared.message);
        return null;
      }

      try {
        await putWithProgress(prepared.signedUrl, file, setCoverPercent);
      } catch {
        setCoverError(COVER_ERROR_MESSAGES.upload_failed);
        return null;
      }

      const committed = await settleAction(
        () =>
          commitTextCoverUpload({ textId: id, storagePath: prepared.storagePath }),
        "commitTextCoverUpload",
      );
      if (!committed.ok) {
        setCoverError(committed.message);
        return null;
      }

      return committed.coverUrl;
    } finally {
      setCoverUploading(false);
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
    if (coverFile) {
      // A saved cover stays saved: clearing a pending choice is "nie ten obraz",
      // not "usuń ten, który jest".
      chooseCover(null);
      return;
    }

    setCoverError(null);
    setNotice(null);

    if (props.mode !== "edit" || !coverUrl) {
      setCoverUrl(null);
      return;
    }

    setCoverRemoving(true);
    const result = await settleAction(
      () => removeTextCover(props.textId),
      "removeTextCover",
    );
    setCoverRemoving(false);

    if (!result.ok) {
      setCoverError(result.message);
      return;
    }
    setCoverUrl(null);
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
    if (pending || coverUploading || coverRemoving) return;
    setPending(true);
    setError(null);
    setNotice(null);

    const input: TextInput = { title, cefr, body, status };
    try {
      if (props.mode === "edit") {
        await updateText(props.textId, input);

        if (coverFile) {
          const saved = await uploadCover(props.textId, coverFile);
          if (saved) {
            setCoverUrl(saved);
            chooseCover(null);
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
        if (coverFile) {
          const saved = await uploadCover(created.id, coverFile);
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
      <TextCoverField
        coverUrl={coverUrl}
        localUrl={coverPreview}
        onSelect={chooseCover}
        onRemove={onRemoveCover}
        uploading={coverUploading}
        percent={coverPercent}
        removing={coverRemoving}
        error={coverError}
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
          disabled={pending || coverUploading || coverRemoving}
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

/**
 * PUT the bytes with a real progress bar.
 *
 * `XMLHttpRequest` rather than `fetch` for the same reason the book importer
 * uses it: it reports how many bytes have actually gone, and "Przesyłanie… 63%"
 * is the difference between a screen that is working and a screen that has
 * frozen. The body mirrors what the Supabase client sends for a Blob, so the
 * signed-upload endpoint sees a request it already understands.
 */
function putWithProgress(
  signedUrl: string,
  file: File,
  onProgress: (percent: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const body = new FormData();
    body.append("cacheControl", "3600");
    body.append("", file);

    const request = new XMLHttpRequest();
    request.open("PUT", signedUrl);

    request.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      onProgress(Math.round((event.loaded / event.total) * 100));
    };
    request.onload = () =>
      request.status >= 200 && request.status < 300
        ? resolve()
        : reject(new Error(`upload failed: ${request.status}`));
    request.onerror = () => reject(new Error("upload failed"));
    request.onabort = () => reject(new Error("upload aborted"));

    request.send(body);
  });
}
