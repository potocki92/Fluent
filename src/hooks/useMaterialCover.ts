"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  commitMaterialCoverUpload,
  commitTextCoverUpload,
  prepareMaterialCoverUpload,
  prepareTextCoverUpload,
  removeMaterialCover,
  removeTextCover,
  type PreparedCoverUpload,
} from "@/actions/admin-covers";
import { settleAction, type ActionResult } from "@/lib/errors";
import { COVER_ERROR_MESSAGES } from "@/lib/library/covers";

/**
 * The browser half of material artwork: choosing a file, getting its bytes to
 * Storage, and saying what is happening while that runs.
 *
 * WHY THIS IS A HOOK AND NOT A COMPONENT. Two admin screens attach pictures —
 * `/admin/library` for every material, `/admin/texts/[id]` for a legacy passage
 * — and they place the control differently: the library shows a small panel per
 * card, the text form a field inside a larger form whose "save" it has to
 * co-ordinate with. What they share is not the markup, it is the CHOREOGRAPHY:
 * prepare, PUT with progress, commit, and the exact set of states that can
 * result. Duplicating that into a second screen is how one of them ends up
 * deleting the old image before the new one has landed. So the sequence lives
 * here, the markup lives in `MaterialCoverField`, and the arrangement is each
 * screen's own business.
 *
 * THE TARGET IS THE LIBRARY ITEM, with a legacy passage as an alternative
 * address for the same thing — see `src/actions/admin-covers.ts`. The hook does
 * not care which; it forwards to whichever pair of actions the target names, and
 * both end at one `library_items.cover_url`.
 *
 * NOTHING IS UPLOADED BECAUSE A FILE WAS CHOSEN. {@link MaterialCoverState.choose}
 * only makes a local preview, so an admin can look at their pick, and change it,
 * before it costs anything. When the upload happens is the caller's decision.
 */

export type CoverTarget =
  | { kind: "material"; libraryItemId: string }
  | { kind: "legacy"; textId: number };

export interface MaterialCoverState {
  /** The artwork saved on the material. `null` once removed, new URL once replaced. */
  coverUrl: string | null;
  setCoverUrl: (url: string | null) => void;
  /** A chosen-but-not-yet-uploaded file, and its `blob:` preview. */
  file: File | null;
  preview: string | null;
  /** Choose a file, or `null` to forget the choice. Owns the object URL. */
  choose: (file: File | null) => void;
  uploading: boolean;
  percent: number;
  removing: boolean;
  /** True while anything is in flight — what the field disables itself on. */
  busy: boolean;
  error: string | null;
  setError: (message: string | null) => void;
  /** One line about where the image stands: „Obraz zapisany." and the like. */
  status: string | null;
  setStatus: (message: string | null) => void;
  /** Prepare → PUT → commit. Resolves to the saved URL, or `null` on failure. */
  upload: (target: CoverTarget, file: File) => Promise<string | null>;
  /** Clear the column and delete the object we own. `true` when it happened. */
  remove: (target: CoverTarget) => Promise<boolean>;
}

export function useMaterialCover(initialCoverUrl: string | null = null): MaterialCoverState {
  const [coverUrl, setCoverUrl] = useState<string | null>(initialCoverUrl);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [percent, setPercent] = useState(0);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  // The live blob URL, mirrored into a ref so the unmount cleanup releases the
  // CURRENT one rather than whatever existed when the hook first ran.
  const previewRef = useRef<string | null>(null);
  useEffect(() => {
    return () => {
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    };
  }, []);

  /**
   * `URL.createObjectURL` shows the file the instant it is picked, and the
   * previous one is released in the same breath — an admin trying five photos
   * must not leave five blobs pinned for the life of the page. The URL is made
   * in the handler rather than in an effect: an effect that calls `setState` to
   * mirror a prop is a cascading render, and the lifecycle is perfectly
   * expressible where the change actually happens.
   */
  const choose = useCallback((next: File | null) => {
    setError(null);

    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    const url = next ? URL.createObjectURL(next) : null;
    previewRef.current = url;

    setPreview(url);
    setFile(next);
  }, []);

  /**
   * Get one chosen image onto the material.
   *
   * THREE STEPS, IN THIS ORDER, and the order is the whole safety story: ask the
   * server for a path it chose, PUT the bytes straight to Storage, and only then
   * record the result. The previous image is deleted by the commit, AFTER the
   * new URL is saved — so a failed upload leaves the material with the picture
   * it already had rather than with none.
   *
   * Returns the saved URL, or `null` when something went wrong; the caller
   * decides what that means, because it means different things on a material
   * that already exists and on one still being created.
   */
  const upload = useCallback(
    async (target: CoverTarget, chosen: File): Promise<string | null> => {
      setUploading(true);
      setPercent(0);
      setError(null);
      try {
        const prepared = await settleAction(
          () => prepareUpload(target, chosen),
          "prepareMaterialCoverUpload",
        );
        if (!prepared.ok) {
          setError(prepared.message);
          return null;
        }

        try {
          await putWithProgress(prepared.signedUrl, chosen, setPercent);
        } catch {
          setError(COVER_ERROR_MESSAGES.upload_failed);
          return null;
        }

        const committed = await settleAction(
          () => commitUpload(target, prepared.storagePath),
          "commitMaterialCoverUpload",
        );
        if (!committed.ok) {
          setError(committed.message);
          return null;
        }

        return committed.coverUrl;
      } finally {
        setUploading(false);
      }
    },
    [],
  );

  const remove = useCallback(async (target: CoverTarget): Promise<boolean> => {
    setError(null);
    setRemoving(true);
    try {
      const result = await settleAction(() => removeCover(target), "removeMaterialCover");
      if (!result.ok) {
        setError(result.message);
        return false;
      }
      return true;
    } finally {
      setRemoving(false);
    }
  }, []);

  return {
    coverUrl,
    setCoverUrl,
    file,
    preview,
    choose,
    uploading,
    percent,
    removing,
    busy: uploading || removing,
    error,
    setError,
    status,
    setStatus,
    upload,
    remove,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Which pair of actions a target speaks to
// ─────────────────────────────────────────────────────────────────────────────

function prepareUpload(
  target: CoverTarget,
  file: File,
): Promise<ActionResult<PreparedCoverUpload>> {
  const shape = { fileName: file.name, mimeType: file.type || null, fileSize: file.size };
  return target.kind === "material"
    ? prepareMaterialCoverUpload({ libraryItemId: target.libraryItemId, ...shape })
    : prepareTextCoverUpload({ textId: target.textId, ...shape });
}

function commitUpload(
  target: CoverTarget,
  storagePath: string,
): Promise<ActionResult<{ coverUrl: string }>> {
  return target.kind === "material"
    ? commitMaterialCoverUpload({ libraryItemId: target.libraryItemId, storagePath })
    : commitTextCoverUpload({ textId: target.textId, storagePath });
}

function removeCover(target: CoverTarget): Promise<ActionResult<unknown>> {
  return target.kind === "material"
    ? removeMaterialCover({ libraryItemId: target.libraryItemId })
    : removeTextCover(target.textId);
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
