import { READING_LINE_RATIO } from "@/lib/reading/constants";
import type { ReadingAnchor } from "@/lib/reading/position";

/**
 * Scrolls the chapter to the learner's place BEFORE the browser paints it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A SCRIPT TAG, OF ALL THINGS
 * ─────────────────────────────────────────────────────────────────────────────
 * On a full page load the prose is real HTML and the browser paints it as soon
 * as it has it — long before React hydrates and long before any effect can run.
 * Restoring after hydration therefore means the learner sees the top of the
 * chapter and is then thrown several screens down, which is the "nagły skok"
 * this engine exists to remove.
 *
 * Placed immediately AFTER the prose, this runs while the document is still
 * being parsed: the paragraphs exist, nothing has been painted, and the very
 * first frame is already at the right place. There is no other point in the page
 * lifecycle where that is possible.
 *
 * A client-side navigation into the chapter does not execute it (React never
 * runs the contents of an injected script) and does not need to — there
 * `useReadingRestore`'s layout effect runs before paint anyway.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NOTHING IS INTERPOLATED INTO THE SCRIPT
 * ─────────────────────────────────────────────────────────────────────────────
 * The body below is a FIXED string — no template literal, no server value inside
 * it. The anchor travels as a data attribute, which React escapes, and the
 * script reads it back through `document.currentScript` and coerces every field
 * with `Number`. So there is no path from stored data into executed code, which
 * is what makes `dangerouslySetInnerHTML` defensible here and nowhere near the
 * book's own text.
 */
const RESTORE_SCRIPT = `(function () {
  try {
    var tag = document.currentScript;
    if (!tag) return;
    var data = JSON.parse(tag.getAttribute("data-anchor") || "null");
    if (!data) return;

    var sentence = Number(data.s);
    var token = Number(data.t);
    var paragraph = Number(data.p);
    var ratio = Number(data.r);

    var target = null;
    if (Number.isSafeInteger(sentence) && sentence >= 0) {
      target = document.querySelector('[data-sentence-position="' + sentence + '"]');
      if (target && Number.isSafeInteger(token) && token >= 0) {
        var word = target.querySelector('[data-position="' + token + '"]');
        if (word) target = word;
      }
    }
    if (!target && Number.isSafeInteger(paragraph) && paragraph >= 0) {
      target = document.getElementById("p-" + paragraph);
    }
    if (!target) return;

    if ("scrollRestoration" in history) history.scrollRestoration = "manual";
    var top = target.getBoundingClientRect().top + window.pageYOffset;
    window.scrollTo(0, Math.max(0, top - window.innerHeight * ratio));
  } catch (error) {
    // Never break a chapter over a bookmark. Without this the learner simply
    // starts at the top, which is where they would have started anyway.
  }
})();`;

export function ReaderRestoreScript({ anchor }: { anchor: ReadingAnchor | null }) {
  if (!anchor) return null;
  if (
    anchor.paragraphPosition === 0 &&
    (anchor.sentencePosition ?? 0) === 0 &&
    (anchor.tokenPosition ?? 0) === 0
  ) {
    // The top of the chapter is where the browser already is.
    return null;
  }

  return (
    <script
      data-anchor={JSON.stringify({
        p: anchor.paragraphPosition,
        s: anchor.sentencePosition,
        t: anchor.tokenPosition,
        // The reading line, so the pre-hydration jump and every later one land
        // the anchor in the same place. `innerHeight` rather than
        // `visualViewport` because at parse time the toolbars have not settled.
        r: READING_LINE_RATIO,
      })}
      // See the note above: the executed string is a constant, and the only
      // server value reaches it as an escaped attribute that is parsed as JSON
      // and coerced to numbers.
      dangerouslySetInnerHTML={{ __html: RESTORE_SCRIPT }}
    />
  );
}
