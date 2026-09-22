"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useRef, useState, type DragEvent } from "react";
import { BookUp, FileText, Loader2, Lock, Upload } from "lucide-react";

import { startBookImport } from "@/actions/book-import";
import { settleAction } from "@/lib/errors";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { MAX_BOOK_IMPORT_BYTES, MAX_BOOK_IMPORT_MB } from "@/lib/import/constants";
import { sha256Hex } from "@/lib/import/hash";
import { IMPORT_ERROR_MESSAGES } from "@/lib/import/state";
import {
  FILE_INPUT_ACCEPT,
  MAGIC_BYTE_WINDOW,
  validateBookFile,
} from "@/lib/import/validate";
import { cn } from "@/lib/utils";

/**
 * Choosing a file, and getting it to Storage.
 *
 * THE FILE DOES NOT GO THROUGH THIS APP'S SERVER. The action mints a signed
 * upload URL and the browser PUTs straight to Supabase Storage, which is what
 * makes a 30 MB novel possible at all (a Server Action body is capped around a
 * megabyte) and what makes the progress bar below real rather than decorative —
 * `XMLHttpRequest` reports upload progress and `fetch` does not.
 *
 * VALIDATION HAPPENS TWICE, ON PURPOSE. Here, so that nobody waits three minutes
 * to upload a file Fluent was always going to refuse; and again on the server,
 * because a check in a browser is a courtesy to the user, not a control. Both
 * call the SAME function on the same magic bytes, so they cannot disagree.
 *
 * MOBILE FIRST. A drag-and-drop target is an enhancement layered over a plain
 * `<input type="file">` — the input is what works on a phone, where "drag a file"
 * is not a gesture that exists, and where the picker hands over a file with an
 * empty MIME type that only the byte sniffing recognises.
 */

type Phase = "idle" | "checking" | "uploading" | "starting" | "duplicate";

/** An import that has been minted but whose file has not gone up yet. */
interface PendingUpload {
  file: File;
  importId: string;
  signedUrl: string;
}

export function ImportUploader() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  const [phase, setPhase] = useState<Phase>("idle");
  const [percent, setPercent] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [duplicate, setDuplicate] = useState<{
    title: string | null;
    importId: string;
  } | null>(null);
  const [pending, setPending] = useState<PendingUpload | null>(null);

  /**
   * Send the bytes, then hand over to the review screen.
   *
   * Split out from {@link handleFile} because the duplicate warning sits between
   * the two: the import row and the signed URL already exist, and the learner is
   * deciding whether to spend their data allowance on a book they may already
   * have.
   */
  const upload = useCallback(
    async (next: PendingUpload) => {
      setPhase("uploading");
      setPercent(0);
      try {
        await putWithProgress(next.signedUrl, next.file, setPercent);
      } catch {
        setPhase("idle");
        setError(IMPORT_ERROR_MESSAGES.upload_failed);
        return;
      }

      // The review screen owns everything from here: it starts the analysis, it
      // survives a reload, and it is a real URL the learner can come back to.
      router.push(`/library/import/${next.importId}`);
    },
    [router],
  );

  const handleFile = useCallback(
    async (file: File) => {
      setError(null);
      setDuplicate(null);
      setPending(null);
      setFileName(file.name);
      setPhase("checking");
      setPercent(0);

      if (file.size > MAX_BOOK_IMPORT_BYTES) {
        setPhase("idle");
        setError(
          `${IMPORT_ERROR_MESSAGES.file_too_large} Maksymalnie ${MAX_BOOK_IMPORT_MB} MB.`,
        );
        return;
      }

      // The head is read on its own so a 30 MB file is not pulled into memory
      // twice just to look at five bytes.
      const head = new Uint8Array(
        await file.slice(0, MAGIC_BYTE_WINDOW).arrayBuffer(),
      );
      const check = validateBookFile({
        fileName: file.name,
        mimeType: file.type || null,
        size: file.size,
        head,
      });
      if (!check.ok) {
        setPhase("idle");
        setError(IMPORT_ERROR_MESSAGES[check.code]);
        return;
      }

      // The whole file, once, to hash it. `crypto.subtle.digest` has no
      // streaming form, so this is a second copy of up to 40 MB held briefly
      // alongside the File — fine at that cap, and the reason the cap is not
      // higher. The server recomputes the hash over the stored bytes anyway;
      // this one only drives the duplicate warning, before the upload starts.
      const bytes = new Uint8Array(await file.arrayBuffer());
      const fileHash = await sha256Hex(bytes);

      setPhase("starting");
      // Settled: a rejected action left `phase` on "starting" for good — a
      // picker the learner could not use and a spinner that never resolved.
      const started = await settleAction(
        () =>
          startBookImport({
            fileName: file.name,
            fileType: check.identity.format,
            fileSize: file.size,
            fileHash,
          }),
        `startBookImport ${file.name}`,
      );
      if (!started.ok) {
        setPhase("idle");
        setError(started.message);
        return;
      }

      const next: PendingUpload = {
        file,
        importId: started.importId,
        signedUrl: started.signedUrl,
      };

      // A WARNING, NOT A REFUSAL. Wanting a second copy is legitimate, and a
      // hash is not a policy — but neither is uploading 30 MB of a book they
      // already have without mentioning it. Asked before the bytes go, because
      // that is the only moment the answer saves anybody anything.
      if (started.duplicate) {
        setPending(next);
        setDuplicate(started.duplicate);
        setPhase("duplicate");
        return;
      }

      await upload(next);
    },
    [upload],
  );

  // Waiting on the duplicate question is not "busy": the learner may reasonably
  // want to pick a different file instead of answering it, and a disabled picker
  // would leave them with no way to.
  const deciding = phase === "duplicate";
  const busy = phase !== "idle" && !deciding;

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file && !busy) void handleFile(file);
  };

  return (
    <div className="space-y-3">
      <div
        onDragOver={(event) => {
          event.preventDefault();
          if (!busy) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          "rounded-xl border-2 border-dashed p-6 text-center transition-colors",
          dragging ? "border-gold bg-gold/5" : "border-border",
          busy && "opacity-70",
        )}
      >
        <BookUp className="mx-auto mb-3 size-8 text-muted2" />
        <p className="font-medium text-main">Dodaj własną książkę</p>
        <p className="mx-auto mt-1 max-w-sm text-sm text-muted2">
          Prześlij książkę, którą chcesz czytać po niemiecku. Fluent sam wykryje
          rozdziały i przygotuje je do nauki.
        </p>

        <div className="mt-3 flex flex-wrap items-center justify-center gap-1.5 text-xs text-muted2">
          <Format label="PDF" />
          <Format label="EPUB" />
          <Format label="TXT" />
          <span>· do {MAX_BOOK_IMPORT_MB} MB</span>
        </div>

        <input
          ref={inputRef}
          type="file"
          accept={FILE_INPUT_ACCEPT}
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0];
            // Cleared so that choosing the same file twice in a row still fires.
            event.target.value = "";
            if (file) void handleFile(file);
          }}
        />

        <Button
          className="mt-4"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
        >
          {busy ? (
            <>
              <Loader2 className="size-4 animate-spin" /> {PHASE_LABELS[phase]}
            </>
          ) : (
            <>
              <Upload className="size-4" /> Wybierz plik
            </>
          )}
        </Button>

        {fileName && busy && (
          <div className="mx-auto mt-4 max-w-sm space-y-1.5 text-left">
            <p className="flex items-center gap-1.5 truncate text-xs text-muted2">
              <FileText className="size-3 shrink-0" />
              <span className="truncate">{fileName}</span>
            </p>
            {/* An indeterminate bar during hashing, a real one during upload:
                pretending to know a percentage nobody is measuring is exactly
                the kind of small lie that makes a progress bar useless. */}
            {phase === "uploading" ? (
              <Progress value={percent} />
            ) : (
              <div className="h-2 w-full overflow-hidden rounded-full bg-primary/20">
                <div className="h-full w-1/3 animate-pulse rounded-full bg-primary" />
              </div>
            )}
          </div>
        )}
      </div>

      {duplicate && pending && (
        <div className="space-y-2 rounded-xl border border-gold/40 bg-gold/5 p-3">
          <p className="text-sm text-main">
            Ta książka wygląda na już zaimportowaną
            {duplicate.title ? ` — „${duplicate.title}”` : ""}.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" asChild>
              <Link href={`/library/import/${duplicate.importId}`}>
                Otwórz tamten import
              </Link>
            </Button>
            <Button
              size="sm"
              onClick={() => {
                setDuplicate(null);
                void upload(pending);
              }}
            >
              Importuj mimo to
            </Button>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm text-red">
          {error}
        </p>
      )}

      <p className="flex items-center justify-center gap-1.5 text-xs text-muted2">
        <Lock className="size-3" />
        Twoje importy są prywatne — widzisz je tylko Ty.
      </p>
    </div>
  );
}

const PHASE_LABELS: Record<Phase, string> = {
  idle: "",
  checking: "Sprawdzam plik…",
  starting: "Przygotowuję…",
  uploading: "Przesyłam…",
  duplicate: "Czeka na decyzję",
};

function Format({ label }: { label: string }) {
  return (
    <span className="rounded-md bg-[#374151] px-2 py-0.5 font-medium text-main">
      {label}
    </span>
  );
}

/**
 * Upload with a real progress bar.
 *
 * `XMLHttpRequest` rather than `fetch` for one reason: it reports how many bytes
 * have actually gone, and on a phone uploading 20 MB over mobile data that is
 * the difference between a screen that is working and a screen that has frozen.
 *
 * The body mirrors exactly what the Supabase client sends for a Blob — a
 * multipart form with `cacheControl` and the file — so the signed-upload
 * endpoint sees a request it already understands.
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
    request.setRequestHeader("x-upsert", "true");

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
