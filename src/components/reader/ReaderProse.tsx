import { isFunctionWord } from "@/lib/content/dictionary-match";
import { normalizeToken } from "@/lib/content/tokenize";
import type { ReaderParagraph, ReaderSentence } from "@/lib/library/queries";

/**
 * The chapter's text, rendered on the SERVER.
 *
 * THIS IS THE REPLACEMENT FOR `BodyContent`. The old reader shipped an HTML blob
 * to the browser and rebuilt it into React nodes with `DOMParser` on every
 * render — which meant the text was not in the document until hydration, a
 * plain-text fallback had to be rendered first to avoid a mismatch, and the
 * cost grew with the length of the passage. For a book that is not a tradeoff,
 * it is a wall.
 *
 * Here the structure is already structured, so the same markup is produced on
 * the server and on the client, the prose is real document text before any
 * JavaScript runs, and the client adds behaviour rather than content.
 *
 * NO PER-WORD COMPONENT. An interactive word is a `<span>` carrying data
 * attributes, not a React component: a 15 000-word chapter would otherwise mean
 * thousands of components to mount and diff for something that never re-renders.
 * `ReaderShell` handles every one of them with a single delegated listener. That
 * is what makes "every lexical token is interactive" affordable at all — the cost
 * of the change is spans, not components, and one listener either way.
 *
 * ACCESSIBILITY. The words are NOT buttons. `role="button"` on every glossable
 * word would make a screen reader announce "button" a thousand times a chapter
 * and turn continuous prose into a list of controls — so the markup stays text,
 * and keyboard users reach a word by tabbing to it. The tradeoff (many tab
 * stops) is documented in `docs/architecture/reader-story-engine.md`; the
 * alternative broke reading itself.
 */
export function ReaderProse({
  paragraphs,
}: {
  paragraphs: readonly ReaderParagraph[];
}) {
  return (
    <div className="reader-prose" data-reader-content>
      {paragraphs.map((paragraph) => (
        <Paragraph key={paragraph.id} paragraph={paragraph} />
      ))}
    </div>
  );
}

function Paragraph({ paragraph }: { paragraph: ReaderParagraph }) {
  const content =
    paragraph.sentences.length > 0 ? (
      paragraph.sentences.map((sentence, index) => (
        <Sentence
          key={sentence.id}
          sentence={sentence}
          separator={index < paragraph.sentences.length - 1}
        />
      ))
    ) : (
      // A paragraph that produced no sentences still shows its text: never lose
      // content to a parsing decision.
      <>{paragraph.text}</>
    );

  // `data-paragraph-position` is what the progress observer reads. It is the
  // POSITION, not the row id, because that is what reading progress stores —
  // reprocessing a chapter replaces the rows but never moves position 43.
  const props = {
    "data-paragraph-position": paragraph.position,
    id: `p-${paragraph.position}`,
  };

  if (paragraph.kind === "heading") {
    return <h2 {...props}>{content}</h2>;
  }
  if (paragraph.kind === "list_item") {
    return <li {...props}>{content}</li>;
  }
  return <p {...props}>{content}</p>;
}

function Sentence({
  sentence,
  separator,
}: {
  sentence: ReaderSentence;
  separator: boolean;
}) {
  return (
    <>
      <span
        className="reader-sentence"
        data-sentence-id={sentence.id}
        // The sentence's position within the CHAPTER, which is what a reading
        // anchor is addressed by — unique per chapter, stable across a
        // reprocess, and the row id is neither. The reading line turns a DOM hit
        // into a bookmark by reading exactly this attribute.
        data-sentence-position={sentence.chapterPosition}
      >
        {renderSentence(sentence)}
      </span>
      {separator ? " " : null}
    </>
  );
}

/**
 * Split a sentence into plain text and interactive words.
 *
 * The occurrences carry character spans, so this is a single pass over the
 * sentence with no searching and no ambiguity about WHICH "sein" was matched.
 * An occurrence whose span does not line up (only possible if the rows and the
 * text ever diverged) is skipped rather than allowed to corrupt the text.
 *
 * EVERY LEXICAL TOKEN ARRIVES HERE, including the ones no dictionary knows. The
 * reader no longer asks "did this word match when the book was imported?" — a
 * question about the past that a learner tapping a word today does not care
 * about — it asks what is under the finger, and finds out what it means
 * afterwards.
 */
function renderSentence(sentence: ReaderSentence) {
  const nodes: React.ReactNode[] = [];
  let cursor = 0;

  for (const occurrence of sentence.occurrences) {
    if (occurrence.charStart < cursor || occurrence.charEnd > sentence.text.length) {
      continue;
    }
    if (occurrence.charStart > cursor) {
      nodes.push(sentence.text.slice(cursor, occurrence.charStart));
    }

    nodes.push(
      <span
        // Keyed on the POSITION, not the row id: a token the chapter has no
        // occurrence row for yet is rendered from the tokenizer and has no id,
        // and `(sentence, position)` identifies it just as uniquely.
        key={`${sentence.id}-${occurrence.position}`}
        className="reader-word"
        tabIndex={0}
        data-occurrence-id={occurrence.id ?? ""}
        data-word-id={occurrence.wordId ?? ""}
        data-sentence-id={sentence.id}
        // The token's index among the sentence's LEXICAL tokens — the durable
        // address a personal note is anchored on, and what lets a saved phrase
        // be marked without re-tokenizing the chapter in the browser.
        data-position={occurrence.position}
        data-lemma={occurrence.lemma}
        // LOUDNESS IS DECIDED HERE, not by refusing to resolve the word. A
        // closed-class token is glossable like any other — tapping *wir* must
        // answer *my* — but it carries no dotted underline, because underlining
        // every *der* is how a page turns into a Christmas tree. On a touch
        // device the reader draws no underlines at all, so this changes nothing
        // there and the tap works either way.
        data-function-word={isFunctionWord(normalizeToken(occurrence.surface)) || undefined}
        // EVERY TOKEN IS TAPPABLE; NOT EVERY TOKEN IS ADVERTISED. Now that a row
        // exists for words the dictionary has never heard of, the dotted
        // underline would land under most of a page of fiction — which says
        // nothing and reads as damage. So "unknown" is marked the same way a
        // closed-class word is: no underline, full interactivity. The two
        // questions the old reader conflated stay apart — whether a word can be
        // tapped, and whether the page should point at it.
        data-unknown={occurrence.wordId === null || undefined}
      >
        {sentence.text.slice(occurrence.charStart, occurrence.charEnd)}
      </span>,
    );
    cursor = occurrence.charEnd;
  }

  if (cursor < sentence.text.length) nodes.push(sentence.text.slice(cursor));
  return nodes;
}
