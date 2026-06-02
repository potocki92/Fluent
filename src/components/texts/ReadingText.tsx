"use client";

import {
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { WordTooltip } from "@/components/words/WordTooltip";
import type { Text } from "@/types";

/**
 * Inline tags we are willing to render from the (server-authored) passage body.
 * Anything else is unwrapped to its text content, and `<script>`/`<style>` are
 * dropped entirely — this allowlist is the sanitisation step (we never use
 * `dangerouslySetInnerHTML`).
 */
const ALLOWED_TAGS = new Set([
  "p",
  "h2",
  "h3",
  "strong",
  "b",
  "em",
  "i",
  "br",
  "ul",
  "ol",
  "li",
]);

const DROPPED_TAGS = new Set(["script", "style", "iframe", "object", "embed"]);

function nodeToReact(node: ChildNode, key: number): ReactNode {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent;
  if (node.nodeType !== Node.ELEMENT_NODE) return null;

  const el = node as HTMLElement;
  const tag = el.tagName.toLowerCase();
  const children = Array.from(el.childNodes).map((child, i) =>
    nodeToReact(child, i),
  );

  // A vocabulary annotation: reveal the translation on hover/tap.
  if (tag === "mark") {
    const lemma = el.getAttribute("data-lemma") ?? el.textContent ?? "";
    return (
      <WordTooltip key={key} lemma={lemma}>
        {el.textContent}
      </WordTooltip>
    );
  }

  if (DROPPED_TAGS.has(tag)) return null;
  if (tag === "br") return <br key={key} />;
  if (!ALLOWED_TAGS.has(tag)) return <span key={key}>{children}</span>;

  const Tag = tag as keyof React.JSX.IntrinsicElements;
  return <Tag key={key}>{children}</Tag>;
}

function parseBody(html: string): ReactNode {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return Array.from(doc.body.childNodes).map((node, i) => nodeToReact(node, i));
}

const emptySubscribe = () => () => {};

/** False during SSR and the initial hydration pass, true on the client after. */
function useIsClient() {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
}

export function ReadingText({ text }: { text: Text }) {
  const [unlocked, setUnlocked] = useState(false);
  const isClient = useIsClient();

  // Build the interactive tree (with word tooltips) on the client only. Gating
  // on `isClient` keeps SSR and the first hydration render in sync (no setState
  // in an effect, no hydration mismatch).
  const content = useMemo(
    () => (isClient ? parseBody(text.body) : null),
    [isClient, text.body],
  );

  // Read gate: unlock the test after 5s or once the learner scrolls to the end.
  useEffect(() => {
    const timer = window.setTimeout(() => setUnlocked(true), 5000);

    const onScroll = () => {
      const reachedBottom =
        window.innerHeight + window.scrollY >=
        document.body.offsetHeight - 80;
      if (reachedBottom) setUnlocked(true);
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  return (
    <>
      <div className="text-[1.1rem] leading-[1.85] text-main [&_h2]:mb-4 [&_h2]:text-2xl [&_h2]:font-bold [&_h3]:mb-3 [&_h3]:text-xl [&_h3]:font-semibold [&_li]:mb-1 [&_p]:mb-4 [&_ul]:mb-4 [&_ul]:list-disc [&_ul]:pl-5">
        {/* Pre-hydration fallback: plain text so SSR has readable content; the
            interactive tree (with tooltips) replaces it after mount. */}
        {content ?? (
          <p className="whitespace-pre-line">
            {text.body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()}
          </p>
        )}
      </div>

      <div className="sticky bottom-20 pt-4">
        {unlocked ? (
          <Button
            asChild
            className="w-full bg-gold text-[#1a202c] hover:bg-gold-dark"
          >
            <Link href={`/learn/${text.id}/test`}>Przejdź do pytań →</Link>
          </Button>
        ) : (
          <Button
            disabled
            className="w-full bg-gold text-[#1a202c] hover:bg-gold-dark"
          >
            Czytaj uważnie…
          </Button>
        )}
      </div>
    </>
  );
}
