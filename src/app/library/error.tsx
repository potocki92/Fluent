"use client";

import Link from "next/link";
import { useEffect } from "react";

/**
 * The reader's error boundary.
 *
 * A learner never sees a Postgres message. Missing content, a chapter that
 * failed to process and a private book someone else owns all surface as one
 * Polish sentence and a way back — the technical detail goes to the console and
 * the server logs, which is where it is useful.
 */
export default function LibraryError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[fluent:library]", error);
  }, [error]);

  return (
    <div className="mx-auto flex min-h-[60svh] max-w-md flex-col items-center justify-center gap-3 px-6 text-center">
      <p className="text-lg font-semibold text-main">
        Nie udało się otworzyć tej treści
      </p>
      <p className="text-sm text-muted2">
        Spróbuj ponownie za chwilę — Twój postęp w czytaniu jest bezpieczny.
      </p>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={reset}
          className="rounded-lg bg-gold px-4 py-2 text-sm font-semibold text-[#1a202c]"
        >
          Spróbuj ponownie
        </button>
        <Link
          href="/library"
          className="rounded-lg border border-border px-4 py-2 text-sm text-muted2"
        >
          Biblioteka
        </Link>
      </div>
    </div>
  );
}
