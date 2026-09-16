"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";

import { refreshBookVocabulary } from "@/actions/book-import";
import { Button } from "@/components/ui/button";

/**
 * "The word is in the dictionary but dead in the book" — the button that fixes it.
 *
 * A chapter's tappable words are rows written when the chapter was processed,
 * against the dictionary as it stood THEN. Adding entries later cannot reach
 * back into a chapter that is already ready, and nothing in the chapter's hash
 * describes the dictionary, so nothing notices on its own. This re-runs the
 * pipeline over the owner's own book with the dictionary as it is now.
 *
 * The loop is the client's and the batch is the server's, exactly as in the
 * importer: a serverless function cannot hold a whole novel, and a progress
 * number that the browser accumulated would drift the moment a call is retried,
 * so every count comes back from the chapter rows themselves.
 */
export function RefreshBookVocabulary({ itemId }: { itemId: string }) {
  const router = useRouter();
  const [state, setState] = useState<
    | { kind: "idle" }
    | { kind: "running"; refreshed: number; total: number }
    | { kind: "done"; total: number }
    | { kind: "error"; message: string }
  >({ kind: "idle" });
  const running = useRef(false);

  async function run() {
    if (running.current) return;
    running.current = true;
    setState({ kind: "running", refreshed: 0, total: 0 });

    try {
      let after = 0;
      for (;;) {
        const result = await refreshBookVocabulary({
          libraryItemId: itemId,
          afterPosition: after,
        });
        if (!result.ok) {
          setState({ kind: "error", message: result.message });
          return;
        }

        setState({
          kind: "running",
          refreshed: result.refreshed,
          total: result.total,
        });
        if (result.done) {
          setState({ kind: "done", total: result.total });
          return;
        }
        after = result.afterPosition;
      }
    } finally {
      running.current = false;
      router.refresh();
    }
  }

  if (state.kind === "running") {
    return (
      <p className="flex items-center gap-2 text-xs text-muted2">
        <Loader2 className="size-4 animate-spin" />
        Przeliczam rozdziały…
        {state.total > 0 && ` ${state.refreshed}/${state.total}`}
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <Button variant="ghost" size="sm" className="text-muted2" onClick={run}>
        <RefreshCw className="size-4" /> Odśwież słownictwo
      </Button>
      {state.kind === "done" && (
        <p className="text-xs text-muted2">
          Gotowe — {state.total}{" "}
          {state.total === 1 ? "rozdział przeliczony" : "rozdziałów przeliczonych"}.
          Nowe słowa ze słownika można już klikać w tekście.
        </p>
      )}
      {state.kind === "error" && (
        <p role="alert" className="text-xs text-red">
          {state.message}
        </p>
      )}
      {state.kind === "idle" && (
        <p className="text-xs text-muted2">
          Po dodaniu słów do słownika rozdziały trzeba przeliczyć — dopiero wtedy
          nowe słowa stają się klikalne w tekście. Twój postęp i notatki zostają.
        </p>
      )}
    </div>
  );
}
