"use client";

import { useMemo, useSyncExternalStore, type ReactNode } from "react";

import { WordTooltip } from "@/components/words/WordTooltip";
import { cn } from "@/lib/utils";

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

/**
 * Render a sanitised passage body with vocabulary tooltips. Shared by the
 * learner reading view and the admin preview. `DOMParser` is client-only, so a
 * plain-text fallback is rendered until hydration (keeps SSR and the first
 * client render in sync — no hydration mismatch).
 */
export function BodyContent({
  body,
  className,
}: {
  body: string;
  className?: string;
}) {
  const isClient = useIsClient();
  const content = useMemo(
    () => (isClient ? parseBody(body) : null),
    [isClient, body],
  );

  return (
    <div
      className={cn(
        "text-[1.1rem] leading-[1.85] text-main [&_h2]:mb-4 [&_h2]:text-2xl [&_h2]:font-bold [&_h3]:mb-3 [&_h3]:text-xl [&_h3]:font-semibold [&_li]:mb-1 [&_p]:mb-4 [&_ul]:mb-4 [&_ul]:list-disc [&_ul]:pl-5",
        className,
      )}
    >
      {content ?? (
        <p className="whitespace-pre-line">
          {body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()}
        </p>
      )}
    </div>
  );
}
