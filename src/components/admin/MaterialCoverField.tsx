"use client";

import Image from "next/image";
import { useId, useState, type DragEvent } from "react";
import { ImagePlus, Loader2, Trash2, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  COVER_ERROR_MESSAGES,
  COVER_FILE_INPUT_ACCEPT,
  MAX_COVER_MB,
  MIN_USEFUL_COVER_HEIGHT,
  MIN_USEFUL_COVER_WIDTH,
  RECOMMENDED_COVER_HEIGHT,
  RECOMMENDED_COVER_WIDTH,
  validateCoverFile,
} from "@/lib/library/covers";
import { cn } from "@/lib/utils";

/**
 * Choosing a MATERIAL's artwork, in the admin panel.
 *
 * NOT A TEXT'S FIELD. It never was — the picture it chooses is recorded on
 * `library_items`, and a passage is only one of the things that has one. Naming
 * it after `texts` is what made it look like a control the library's own
 * materials could not have, so it is named after what it actually edits and is
 * used by both admin screens: the text form, and the library panel.
 *
 * A CONTROLLED FIELD, not a self-contained uploader. The parent owns when the
 * bytes actually go — in the text form's create mode there is no material to
 * attach them to until the text has been saved — so this component owns
 * choosing, previewing and validating, and nothing else. That split is what
 * makes the create flow possible without the field knowing anything about it,
 * and the choreography it pairs with lives in `useMaterialCover`.
 *
 * THE PREVIEW IS LOCAL AND IMMEDIATE, and it is the PARENT's object URL.
 * Nothing is uploaded because a file was selected: an admin gets to look at
 * their choice, and change it, before it costs anything.
 *
 * DRAG AND DROP IS AN ENHANCEMENT. The real control is a labelled
 * `<input type="file">`: it is what works with a keyboard, with a screen reader
 * and on a phone, where "drag a file" is not a gesture that exists.
 *
 * `compact` is for a panel that sits inside a list of materials rather than
 * alone in a form: the same control, a smaller crop and without the sizing
 * advice, because on a phone a full-width 4:3 preview per card turns a list of
 * ten books into a scroll of ten photographs.
 */
export function MaterialCoverField({
  coverUrl,
  localUrl,
  onSelect,
  onRemove,
  uploading,
  percent,
  removing,
  hint,
  error,
  disabled,
  label = "Obraz materiału",
  compact = false,
}: {
  /** The artwork already saved on this material, if any. */
  coverUrl: string | null;
  /** A `blob:` preview of a file chosen but not yet uploaded. Wins over `coverUrl`. */
  localUrl: string | null;
  onSelect: (file: File | null) => void;
  /** Clears a chosen file, or deletes a saved cover — the parent decides which. */
  onRemove: () => void;
  uploading: boolean;
  percent: number;
  removing: boolean;
  /**
   * What the image is doing right now, in one line: saved, or waiting for the
   * text to be saved first. The parent owns it because only the parent knows
   * whether there is anything to attach the image to yet.
   */
  hint: string | null;
  /** A failure from the parent's upload or delete. Validation errors are local. */
  error: string | null;
  disabled?: boolean;
  /** The field's own heading. `null` for a panel that is already labelled. */
  label?: string | null;
  /** Smaller crop, no sizing advice — for a per-material panel in a list. */
  compact?: boolean;
}) {
  const [localError, setLocalError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  // Deleting an image is not undoable, so it takes two taps. A dialog would be
  // heavier than the decision deserves; the button simply asks first.
  const [confirming, setConfirming] = useState(false);
  // Unique per instance, because `/admin/library` renders one of these per
  // material and a duplicated `id` would point every label at the first input.
  const inputId = useId();

  const busy = uploading || removing || Boolean(disabled);
  const preview = localUrl ?? coverUrl;
  const message = error ?? localError;

  function accept(candidate: File | undefined) {
    if (!candidate || busy) return;
    setLocalError(null);

    // The SAME validation the Server Action runs, on the same three facts. A
    // check here saves an upload that was always going to be refused; the one on
    // the server is the control.
    const check = validateCoverFile({
      fileName: candidate.name,
      mimeType: candidate.type || null,
      size: candidate.size,
    });
    if (!check.ok) {
      // A rejected pick leaves whatever was already chosen alone: dropping a PDF
      // by accident must not also throw away the photo that was selected before.
      setLocalError(COVER_ERROR_MESSAGES[check.code]);
      return;
    }

    onSelect(candidate);
  }

  return (
    <div className="space-y-2">
      {label && <p className="block text-sm font-medium text-main">{label}</p>}

      <div
        onDragOver={(event: DragEvent<HTMLDivElement>) => {
          event.preventDefault();
          if (!busy) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event: DragEvent<HTMLDivElement>) => {
          event.preventDefault();
          setDragging(false);
          accept(event.dataTransfer.files?.[0]);
        }}
        className={cn(
          "rounded-xl border-2 border-dashed transition-colors",
          compact ? "p-3" : "p-4",
          dragging ? "border-gold bg-gold/5" : "border-border",
          busy && "opacity-70",
        )}
      >
        {preview ? (
          <div className="space-y-3">
            {/* THE CROP AN ADMIN IS ACTUALLY CHOOSING. Same 4:3 and same
                `object-cover` as „Kontynuuj naukę", so what they approve here is
                what a learner sees rather than a letterboxed version of it. */}
            <div
              className={cn(
                "relative mx-auto aspect-[4/3] w-full overflow-hidden rounded-xl border border-border",
                compact ? "max-w-[200px]" : "max-w-sm",
              )}
            >
              {/* A locally chosen file is a blob: URL, which the optimizer has
                  no business fetching — and could not, since it never left the
                  browser. A saved cover is a real remote image. */}
              {localUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- a blob: URL from the local picker, never a remote image
                <img
                  src={localUrl}
                  alt="Podgląd wybranego obrazu"
                  className="size-full object-cover"
                />
              ) : (
                <Image
                  src={preview}
                  alt="Obraz przypisany do materiału"
                  fill
                  sizes={compact ? "200px" : "(min-width: 640px) 384px, 100vw"}
                  className="object-cover"
                />
              )}
            </div>
            {!compact && (
              <p className="text-center text-xs text-muted2">
                Obraz będzie automatycznie kadrowany. Najważniejszy element trzymaj
                blisko środka.
              </p>
            )}
          </div>
        ) : (
          <div className={cn("text-center", compact ? "py-2" : "py-4")}>
            <ImagePlus
              className={cn("mx-auto mb-2 text-muted2", compact ? "size-6" : "size-8")}
            />
            <p className="text-sm font-medium text-main">
              Przeciągnij obraz lub wybierz plik
            </p>
            <p className="mt-1 text-xs text-muted2">
              JPG, PNG lub WebP · maks. {MAX_COVER_MB} MB
            </p>
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          <label
            htmlFor={inputId}
            className={cn(
              "inline-flex h-9 cursor-pointer items-center gap-2 rounded-md bg-secondary px-4 text-sm font-medium text-secondary-foreground transition-colors hover:bg-secondary/80",
              "focus-within:ring-[3px] focus-within:ring-ring/50",
              busy && "pointer-events-none opacity-50",
            )}
          >
            {uploading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Upload className="size-4" />
            )}
            {preview ? "Zmień obraz" : "Dodaj obraz"}
          </label>
          <input
            id={inputId}
            type="file"
            accept={COVER_FILE_INPUT_ACCEPT}
            className="sr-only"
            disabled={busy}
            onChange={(event) => {
              const chosen = event.target.files?.[0];
              // Cleared so that choosing the same file twice in a row still fires.
              event.target.value = "";
              accept(chosen);
            }}
          />

          {preview && !confirming && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => {
                setLocalError(null);
                setConfirming(true);
              }}
            >
              {removing ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Trash2 className="size-4" />
              )}
              Usuń
            </Button>
          )}

          {preview && confirming && (
            <>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={busy}
                onClick={() => {
                  setConfirming(false);
                  onRemove();
                }}
              >
                <Trash2 className="size-4" />
                Na pewno usuń
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setConfirming(false)}
              >
                Anuluj
              </Button>
            </>
          )}
        </div>

        {uploading && (
          <div className="mx-auto mt-3 max-w-sm space-y-1">
            <Progress value={percent} />
            <p className="text-center text-xs text-muted2">
              Przesyłanie… {percent}%
            </p>
          </div>
        )}

        {/* The one line that says where the image stands. Without it, an image
            that is waiting for the text to be created is indistinguishable from
            an image that has been saved — which reads as a control that does
            nothing. */}
        {!uploading && hint && (
          <p className="mt-3 text-center text-xs text-gold">{hint}</p>
        )}
      </div>

      {!compact && (
        <p className="text-xs text-muted2">
          Obraz jest opcjonalny. Zalecane {RECOMMENDED_COVER_WIDTH}×
          {RECOMMENDED_COVER_HEIGHT} px (minimum {MIN_USEFUL_COVER_WIDTH}×
          {MIN_USEFUL_COVER_HEIGHT} px), kadr poziomy 4:3.
        </p>
      )}

      {message && (
        <p role="alert" className="text-sm text-red">
          {message}
        </p>
      )}
    </div>
  );
}
