# The private book import engine

**Read this before touching** `src/lib/import/**`, `src/actions/book-import.ts`,
`src/lib/content/processor.ts`, the `book_imports` / `book_import_chapters`
tables, the `private-book-imports` Storage bucket, or anything under
`/library/import`.

---

## 1. What problem this solves

Before Phase 5.5 there was exactly one way for text to reach the library: an
admin pasting it into `/admin/library`, one chapter at a time. That is a
reasonable way to publish forty graded passages. It is not a way to read a novel.

Nobody is going to paste seventy-three chapters of *Der Prozess* into a form, and
if they did, the result would be wrong in a second way: it would be first-party
content owned by Fluent rather than a private file owned by whoever uploaded it.

So this phase builds the other door:

```
a learner's own file
   ↓  private Storage             the original, in a bucket nobody else can read
   ↓  deterministic extraction    PDF / EPUB / TXT → pages of text
   ↓  cleanup                     running heads, folios, line wraps, hyphens
   ↓  chapter detection           with a confidence the learner can act on
   ↓  the learner's review        rename, exclude, split, merge, reorder
   ↓  library_items               rights = private_import, owner = them
   ↓  chapters
   ↓  THE EXISTING content pipeline
   ↓  the reader, the Story engine, the learning engine
```

Everything from `chapters` down is Phase 4 and Phase 5, unchanged. The importer's
whole job is to be a safe gate into them.

**The product test:** can someone who knows no SQL upload their own German PDF
and start reading it in Fluent a few minutes later? If they are still copying
forty chapters into an admin panel, this phase was not done.

---

## 2. What was already there (the audit)

| Already existed | Consequence for this phase |
| --- | --- |
| `library_items.rights = 'private_import'` and `owner_user_id`, with a CHECK tying them together | The data model for a private book existed before the feature. Nothing about visibility had to be retrofitted. |
| `library_item_readable(status, archived_at, owner)` — owner-only for owned items, **including for admins** | Privacy was already a single function. The importer adds no new visibility rule. |
| `library_item_writable(owner)` — admins, and never an owned item | An admin cannot edit a private book either. That held before and still holds. |
| `chapters` → `paragraphs` → `sentences` → `word_occurrences`, plain text, positions as the bookmark | The importer's output target. It produces `chapters.source_text` and stops. |
| `replace_chapter_content` (service role, one transaction), `fail_chapter_processing` | The only write path for structure. Reused verbatim. |
| `src/lib/content/` — normalize, paragraphs, sentences, tokenize, dictionary-match, `CONTENT_PROCESSOR_VERSION` | One content pipeline. The importer does **not** get a second one. |
| `processChapter` in `src/actions/admin-library.ts`, behind `requireAdmin()` | Had to be split: the *work* is shared, the *authority* is not. See §8. |
| `getChapterStoryState`, preparation, Challenge — all keyed on `chapter_id`, all RLS-scoped | An imported chapter is a chapter. No Story-engine changes at all. |
| `src/lib/story/generation/provider.ts` — one AI seam, with `isPrivateContent` and a fail-closed check | The AI boundary already existed and already knew about private content. The importer adds no second AI client, and in V1 no AI at all. |

---

## 3. Upload: the file never passes through Next

A Server Action body is capped around a megabyte by default. Raising that would
mean streaming a 30 MB novel through a serverless function in order to hand it
straight to Storage — more hops, more memory, and a limit to fight forever.

```
browser                       Next server                    Supabase Storage
   │  startBookImport() ─────────▶│
   │                              │ create_book_import()  ──▶ book_imports row
   │                              │ createSignedUploadUrl ──▶ signed, short-lived
   │  ◀── { importId, signedUrl } │
   │                                                            │
   │  XHR PUT (with progress) ──────────────────────────────────▶│
   │                                                            │
   │  analyzeBookImport() ───────▶│ download (service role) ◀────│
```

Why each piece is the way it is:

- **The path is minted server-side.** `create_book_import` builds
  `<user_id>/<import_id>/original.<ext>` from `auth.uid()`. The client never
  supplies it, which is what makes the bucket policy's prefix check a guarantee
  rather than a convention.
- **The signed URL is narrow:** one PUT, one path, short expiry. It is a
  convenience, not the security model — the bucket policies below enforce the
  same rule underneath.
- **`XMLHttpRequest`, not `fetch`.** Real upload progress. On a phone uploading
  20 MB over mobile data, that is the difference between a screen that is working
  and a screen that has frozen. The body mirrors exactly what the Supabase client
  sends for a Blob, so the endpoint sees a request it already understands.
- **Validation happens twice**, in the browser and on the server, through the
  *same* function on the *same* magic bytes. The browser check saves someone from
  waiting three minutes to upload a file Fluent was always going to refuse; the
  server check is the one that counts.

### Storage security

Bucket `private-book-imports`, `public = false`, so no object has a public URL at
all. Four policies on `storage.objects`, all `to authenticated`, all of the form:

```sql
bucket_id = 'private-book-imports'
and split_part(name, '/', 1) = (select auth.uid())::text
```

`anon` gets nothing. User B cannot read, write, update or delete under user A's
prefix. Exercised in `supabase/tests/06_book_import_security.sql` (§I11) against
a minimal `storage` schema in the test shim.

---

## 4. The state machine

Two axes, deliberately. `status` is where the import is in its life and decides
which screen renders; `stage` is what the work is doing and decides what that
screen *says*. Collapsed into one column the UI can only show "przetwarzanie" for
two minutes, which tells a learner nothing about whether anything is happening.

```
uploaded ──▶ extracting ──▶ analyzing ──▶ awaiting_review ──▶ importing
                │               │               │                 │
                └───────────────┴──▶ failed     │                 ▼
                                      │         │             processing
                                      ▼         ▼                 │
                                  cancelled ◀───┘                 ▼
                                                                ready
```

`cancelled` is reachable from anything before `importing`. After that the import
has become a book, and a book is deleted through the library, not cancelled
through the importer (`cancel_book_import` raises `FL409`).

**Stages:** `extract_text` → `detect_metadata` → `detect_chapters` →
`persist_content` → `process_chapters`, each with Polish copy in
`src/lib/import/state.ts`.

The transition table lives in `src/lib/import/state.ts` and the same value set is
a CHECK constraint on the table. They are kept in step by hand, which is why the
table is written down in one readable place rather than implied by fifteen
`update` calls.

**Progress is counted, never estimated.** `processed_chapters / total_chapters`
is "17 z 42", a fact the learner can check. There is no percentage invented to
fill a bar — except the one derived *from* those counts, which is honest because
it is derived.

---

## 5. Extraction

One interface, three implementations, chosen by magic bytes:

```ts
interface BookExtractor {
  format: BookImportFormat;
  canHandle(identity: FileIdentity): boolean;
  extract(bytes: Uint8Array): Promise<ExtractedBook>;
}
```

A fourth format (DOCX is the obvious one) is a new file in `extract/` and one
entry in the registry array. Nothing downstream changes, because everything
downstream speaks `ExtractedBook` and has never heard of a PDF.

### PDF — `unpdf`

Chosen against the deployment, not from memory:

- It is Mozilla's **pdf.js**, the same engine every browser renders PDFs with,
  and the only JS PDF text extractor with a decade of real font, encoding and
  CMap handling behind it. German in an embedded subset font comes out as `ä`
  rather than a private-use code point, because pdf.js reads ToUnicode maps.
- It ships a build with the browser-only parts stripped (no canvas, no DOM, no
  worker file to serve), which is what makes it usable in a serverless Node
  function at all. `pdfjs-dist` itself needs a worker URL and a canvas polyfill;
  `pdf-parse` wraps a 2016 fork of pdf.js.
- Zero dependencies.

Imported lazily, so an EPUB import does not pay for the PDF engine.

**No Python service.** The tempting move with PDFs is `pdfminer`/`PyMuPDF` and a
second deployment. Nothing here justifies it: text extraction from a digital PDF
is exactly what pdf.js is good at, and a separate service would buy an
operational surface and nothing else.

Output is pages — `{ number, text }` — and nothing else. Font sizes and glyph
positions are available and deliberately not collected: their only use would be
heading detection, `cleanup/` already recovers the structural signals that
matter, and a richer model would mean a second, position-aware code path in the
detector that only PDFs could exercise.

### EPUB — `fflate` + a 40-line XML scanner

EPUB is the format that already knows what it is: `container.xml` → the package
document → `<metadata>`, `<manifest>`, `<spine>`, and a navigation document
(EPUB 3 `nav`, or EPUB 2 `toc.ncx`). All of it authored, none of it guessed.

- **The spine is the reading order**; `linear="no"` items are skipped.
- **The navigation document is the chapter list.** When a file declares its
  chapters, the heuristics never run (§6).
- **No XML library.** Three files are read and asked two questions each. A
  general parser brings a DOM, entity handling and an *external entity resolver*
  — and the only defence against XXE is not having one. A scanner that cannot
  resolve an external reference cannot be tricked into fetching one.
- **Content is untrusted.** Documents go through `htmlToPlainText` (Phase 4,
  already in `src/lib/content/normalize.ts`), which discards `<script>`,
  `<style>` and `<template>` bodies and re-emits no tag of any kind. There is no
  `dangerouslySetInnerHTML` anywhere in this feature and there must never be one.
- **Paths are untrusted.** An href is resolved against the package document and
  then *looked up in the archive's own entry list*. A manifest pointing at
  `../../etc/passwd` resolves to nothing and is skipped. No filesystem is touched
  — `fflate` unpacks into memory.

`pageCount` is null for EPUB. It reflows; inventing a number from a character
count would be a fiction the UI would then display.

### TXT

Decoded **strictly as UTF-8** (`fatal: true`, which throws rather than
substituting), falling back to Windows-1252 only for a file that genuinely is
not UTF-8. Both silent failures — `ä` → `` and `ä` → `Ã¤` — destroy exactly the
characters Fluent exists to teach.

---

## 6. Cleanup

`src/lib/import/cleanup/` is a **separate pipeline from `src/lib/content/`**, and
that is deliberate. They solve opposite problems: `src/lib/content/` turns clean
prose into structure a reader can point at, and assumes its input is text
somebody wrote; cleanup turns a printed artefact back into prose somebody wrote,
and assumes nothing. Merging them would mean the sentence splitter had to know
about page numbers.

The handoff is a string: blank-line separated paragraphs, which is the one
convention `splitParagraphs` reads.

```
ExtractedPage[]
   ↓ sanitise    control chars; adjacent duplicate pages dropped
   ↓ lines       per-page lines that know their edges and their column width
   ↓ furniture   running heads, running feet, folios
   ↓ wrap        line breaks → paragraphs, hyphens resolved
 CleanBlock[]
```

### Running heads and feet

> A line is furniture when it is **short**, sits at the **edge** of its page, and
> repeats across **most pages** of the book.

All three conditions matter. Frequency alone would delete a refrain or a repeated
line of dialogue; position alone would delete the first sentence of every
chapter; length alone would delete every short sentence in the book. A page may
vote for a key only once per edge, so a poem that repeats a line four times on
one page cannot vote four times for its own deletion.

Comparison folds case, punctuation and **digits** — a running head very often
carries the folio (`DER PROZESS    147`), and comparing those literally would
find no repeats at all.

### Page numbers

A numeral alone on a line at a page edge is removed **only when the numbers
across the book agree**: when `value − pageIndex` is the same constant on at
least three pages, that constant is the book's front-matter offset and the line
is a folio. A stray `1914` alone on a line is left exactly where it is, and a
number inside a sentence is never even a candidate.

### Line wrapping — the highest-value thing the importer does

A PDF has no paragraphs. It has lines, because a typesetter broke them to fit a
column, and which breaks were the author's is exactly what the format threw away.
Joined wrongly, every sentence in the book ends where a line ended, and the
sentence splitter downstream produces one "sentence" per line.

Signals, in the order they are trusted:

1. A line ending in a hyphen is a word broken across the break. Always joined.
2. A deeper indent than the line above opens a paragraph — self-gating, since a
   document whose extractor dropped indentation never triggers it.
3. A line of speech (`„`, `»`, `—`) opening after a finished sentence is a new
   paragraph.
4. **A line that ends a sentence with room to spare is where the author
   stopped.** This is the load-bearing rule in a justified book.
5. A line that fills the measure was ended by the column, not the author.
6. A line starting in lower case continues a sentence — German capitalises
   sentence openings and every noun.
7. Otherwise, the paragraph ends.

The **measure** is the 90th percentile of a page's line lengths, not the median:
half of a typical page's lines are short (a heading, a paragraph's last line,
dialogue), so the median sits well below the column and every line above it looks
"full". Short pages borrow the book's measure, because column width is a property
of the book.

### Hyphenation

The only genuinely ambiguous call in the pipeline:

```
Kran-          →  Krankenhaus       the hyphen was the typesetter's
kenhaus

Nord-          →  Nord-Amerika      the hyphen is the author's
Amerika
```

German capitalises nouns, so a continuation starting in lower case is a word
half and one starting in upper case is the second element of a real compound.
Not a proof — `Nord-\nosten` exists — but right far more often than either
blanket rule, and the failure is a misspelled word rather than a lost
distinction. A soft hyphen is always resolved.

**A hyphen in the middle of a line is never touched**, which is what guarantees
`deutsch-polnisch` survives intact. Tested both ways.

---

## 7. Chapter detection

`src/lib/import/chapters/`, kept out of the extractors entirely.

A printed book marks its chapters typographically, and typography is what
extraction destroys. So the detector adds up several weak signals and then tells
the learner how sure it is — because the learner is looking at their own book and
can settle in one tap what no heuristic can settle at all.

| Signal | Weight | What it is |
| --- | --- | --- |
| `explicitChapterWord` | 5 | "Kapitel 7", "Chapter IV", "Drittes Kapitel", "Kapitel Eins" |
| `namedSection` | 5 | Prolog, Epilog, Vorwort, Nachwort, … |
| `structuralPattern` | 3 | the shape *this book* uses — see below |
| `tableOfContents` | 3 | the line is also an entry in the book's own contents page |
| `isolated` | 2 | the line is a paragraph of its own |
| `bareNumber` | 2 | a numeral or Roman numeral alone on a line |
| `pageStart` | 1 | the line opens a page |
| `headingCase` | 1 | ALL CAPS, or Title Case with no sentence punctuation |

Floor 4, medium 5, high 7. The floor is 4 because a short one-line paragraph in
Title Case scores exactly 3 (`isolated` + `headingCase`) — a book's dedication
line must not become a chapter.

### Named chapters, without knowing a single name

*A Song of Ice and Fire* names its chapters after whoever is telling them:

```
BRAN     CATELYN     DAENERYS     EDDARD     JON
```

There is no keyword to match and the names differ in every book. So the detector
stops looking for chapter headings and looks for **the shape this book uses**. A
line's *shape* is a fingerprint of its typography — how many words, what case,
whether it is a numeral — and nothing about which words. `caps:1`, `title:2`,
`arabic`, `roman`.

A shape that repeats at least five times across the book's candidate lines *is*
the book's convention, and every line matching it scores `structuralPattern`.
One isolated all-caps word means nothing; the same shape eleven times between
long runs of prose is a convention.

**Nothing is hardcoded.** There is no list of first names and there must never be
one: it would work for one novel, fail for every other, and hide the fact that
the detector had learned nothing. The tests prove this by running the same
assertion over a completely different set of names.

Shapes that are *not* eligible to become a pattern: anything ending in sentence
punctuation, and `mixed` — the shape of an ordinary short sentence. Letting that
become a book's "pattern" is how a novel full of one-line dialogue gets cut into
four hundred chapters.

### When the file already knows

An EPUB with a spine and a navigation document has *told* us where its chapters
are. `detectChapters` takes declared boundaries and uses them; the heuristics
never run. An EPUB whose headings are images still splits correctly.

### Nothing is ever dropped

- Front matter (title pages, contents, colophons, anything before the first
  heading) is **marked**, not deleted, and offered switched *off* in the preview.
- Two headings in a row are one boundary: a run of adjacent breaks keeps only its
  last, and the earlier headings stay as ordinary text in the section before.
  Without this, a dedication above chapter one would become a chapter with no
  body — and a chapter with no body is discarded, which would silently delete a
  line of somebody's book.
- A detector that finds more than `MAX_IMPORT_CHAPTERS` breaks has failed. Rather
  than refuse the import, the weakest breaks are dropped by score until the count
  is sane, then restored to reading order.
- A chapter shorter than `CHAPTER_MIN_WORDS` is flagged `low`, not removed —
  which puts a "Sprawdź" badge on exactly the boundary worth looking at.

---

## 8. Processing: one pipeline, two authorities

`processChapter` used to live inside `src/actions/admin-library.ts`, behind
`requireAdmin()`. That was right while the only way content reached the library
was an admin pasting it in. It stops being right the moment a learner can import
their own book: the *work* is identical — same tokenizer, same transaction, same
idempotency — but the *authorisation* is completely different.

The wrong fix would have been to give importing learners admin rights. So:

```
src/lib/content/processor.ts        the work — server-only, not a "use server" module
        ▲                       ▲
        │                       │
requireAdmin()            owns the import
        │                       │
admin-library.ts          book-import.ts
```

`processChapterById` takes a *read* client (RLS applies) and a *service* client
(the only thing allowed to write structure). Importing it into a client component
would be a type error before it was a security problem, and it is not exposed as
an endpoint.

Inherited unchanged from Phase 4:

- **Idempotent, and cheaply so.** Identical source plus identical
  `CONTENT_PROCESSOR_VERSION` means the stored structure is already what this run
  would produce, so it writes nothing at all. Every rewrite replaces paragraph
  rows, and a reprocess that changed nothing but churned the table would be pure
  risk for zero gain.
- **One bad chapter is not a bad book.** A chapter whose pipeline throws is
  recorded `failed` with its error and skipped; a 42-chapter novel with a mangled
  chapter 17 is 41 readable chapters and one retry button.
- **No content in logs, ever.** Only the error's message, truncated. A pipeline
  error can quote a fragment of the source, and a private book must not end up in
  a log line or in a column an admin can read.

`processImportBatch` also **excludes private imports from the admin batch**
(`processPendingChapters` now filters to `owner_user_id is null`), so an admin
sweep never touches a learner's book.

---

## 9. Background work: what Fluent actually has

**Fluent deploys to Vercel. There is no job queue, no worker, and no cron.**
Rather than pretend otherwise, the design says so:

- **Analysis** is one Server Action call that does extract → clean → detect →
  persist. Splitting it across requests would mean storing the whole extracted
  book between them — a third full copy of a 300 000-word novel to save a few
  seconds. The hosting page sets `export const maxDuration = 300`, which Next
  applies to Server Actions invoked from it. Platforms clamp this to their own
  plan limit.
- **Processing is batched.** `processImportBatch` does
  `IMPORT_PROCESS_BATCH_SIZE` chapters per call and reports what is left; the
  review screen loops while it is open. A 42-chapter novel is 14 short calls, not
  one call that times out.
- **Nothing depends on the tab staying open.** Every stage reads its state from
  `book_imports` and writes it back, so the work resumes from wherever it
  stopped on the next visit to the import — or to the book. The UI says this
  plainly: *"Możesz zamknąć tę stronę — przetwarzanie ruszy dalej, gdy tu
  wrócisz."*
- **Partial readiness is a feature.** Chapters process in reading order, the item
  stays `processing` only while something is pending, and chapter 1 is readable
  long before chapter 42 is built.
- **Retry is opt-in.** By default a failed chapter is left alone, so a chapter
  that cannot be processed cannot put the client in an infinite loop. The retry
  button passes `retryFailed`.

**The honest limitation:** if a learner uploads a 70-chapter book and closes the
tab immediately after confirming, the remaining chapters wait until they open the
import or the book again. Making that truly autonomous needs a real trigger —
Supabase `pg_cron` calling an Edge Function, or a Vercel Cron route — and the
schema is ready for it: `book_imports` is a durable job row with a status, a
stage, and derived counts. That is the upgrade, and it is one file, not a
redesign.

---

## 10. Correctness guarantees

### Finalizing: atomic, idempotent, concurrent-safe, private

All four live in `finalize_book_import`, not in TypeScript.

- **Atomic** — the library item, its chapters and the import's receipt are one
  transaction. There is no state where a book exists without its chapters.
- **Idempotent** — `final_library_item_id` is the receipt, checked under a row
  lock and *returned* if set. A double click, two tabs and two concurrent
  requests all end with one book, and the second caller gets the first one's id
  rather than an error, because "you already did this" is not a failure from the
  learner's side.
- **Concurrent-safe** — `select … for update` on the import row serialises two
  simultaneous finalizes. The loser blocks, then sees the receipt.
- **Private by construction** — `rights` is hardcoded to `private_import` and
  `owner_user_id` to `auth.uid()`. Neither is a parameter, so no request can ask
  for anything else. There is no code path anywhere that clears `owner_user_id`.
- **Positions are 1..N** with no gaps, renumbered from the included chapters.

### The client owns nothing systemic

Neither table has an INSERT, UPDATE or DELETE policy. That is the design, and it
is the same rule progress has followed since Phase 1. `user_id`, `storage_path`,
`status` and `final_library_item_id` have **no client write path at all**; every
write goes through a SECURITY DEFINER function that derives the owner from
`auth.uid()` instead of believing a column.

`set_book_import_state` and `apply_book_import_analysis` are **service_role
only**: a browser that could call them could declare an unread file a finished
book.

### Editing the preview

One function, `edit_book_import_chapters`, with five operations — rename,
include, merge_up, split, move. Renaming is one column and could have been a
policy; merging is a delete, a concatenation and a renumber, and splitting is an
insert and a renumber. Those must be atomic or the list ends up with a gap, and a
list with a gap becomes a book with chapter 7 missing. One entry point means one
place where `position` is kept contiguous and one place where ownership is
checked.

The unique constraint on `(import_id, position)` is **DEFERRABLE INITIALLY
DEFERRED**, so "move chapter 7 up" is two updates rather than a three-statement
shuffle through a sentinel.

Merging preserves the merged chapter's title as a `## …` heading paragraph — the
content pipeline reads that as a heading, so the words survive exactly where they
were. Merging must never lose characters from somebody's book.

### Manual corrections are protected

`book_import_chapters.edited` is set the moment a learner renames, splits, merges
or reorders. `apply_book_import_analysis` **refuses** (`FL423`) to replace a
chapter set containing edited rows, so re-running the detector cannot quietly
destroy twenty minutes of somebody's corrections. Likewise `book_imports.title`
and `.author` are separate from `detected_title` / `detected_author`: a
re-analysis fills an empty field and never overwrites a typed one.

### Progress is derived, never asserted

Same rule as `sync_daily_plan`. There is no "mark this chapter done" endpoint and
there must not be one. `sync_book_import_processing` recomputes the counts from
the `chapters` rows that recorded the work, which makes them idempotent (a
retried batch cannot double-count), unforgeable (a client cannot claim a chapter
is ready) and self-healing (a drifted count is corrected on the next call).

---

## 11. Privacy

| Actor | Sees a private import |
| --- | --- |
| Owner | Everything: the row, the preview, the book, the original file |
| Another learner | Nothing. Not the import, not the preview, not the book, not the chapters, not the sentences, not the original |
| **Admin** | **Nothing.** Same answer |
| `anon` | Nothing |

An admin is not an exception, and that is a deliberate continuation of Phase 4's
rule: a learner's own book is their document, and an admin panel is a content
tool, not a reason to read it. `listLibraryContent` filters
`owner_user_id is null` *and* RLS would refuse anyway.

Privacy-safe operational debugging is still possible — an admin can be shown
counts, formats, stages and failures without a word of the text — but no such
screen is built in this phase.

**Logging.** Ids, counts, formats and durations. Never content.
`console.log(bookText)` is the one thing this feature must never do; the
`[fluent:import]` log lines carry `importId`, `chapterId`, page and word counts,
the detected structural pattern and the language code, and nothing else.

---

## 12. Deleting a private book

`delete_private_library_item` is the owner's door. The library's DELETE policy is
admin-only and excludes owned items entirely, which is right for content and
wrong for somebody's own file — a learner is never locked out of their own data.

**What goes:** the book, its chapters, its structured content, its reading
progress, its sessions and lookups, and the uploaded original. All of it is
*about this text*.

**What stays:** everything the learner learned. `user_word_knowledge`, skill and
concept state, review history, saved words and their SM-2 schedules. Reading
German from a book you later deleted is still reading German, and losing a month
of spaced repetition because somebody tidied their shelf would be indefensible.
The chapter-scoped foreign keys on `learning_events`, `saved_words` and
`daily_plan_items` are already `on delete set null`, so history survives with a
null reference.

**The one exception:** the private *text* those records carry.
`saved_words.origin_context` holds a copy of the sentence a word was saved from.
That is a fragment of a book its owner has asked Fluent to forget, so it is
nulled before the cascade — the word and its schedule survive, the sentence does
not.

Storage is not transactional with Postgres, which is why the function *returns*
the paths rather than deleting them: the database commits first, and a failed
object delete leaves a file with no row rather than a row with no file. Of the
two, the first is the one a cleanup pass can fix.

**What made it fail, and why it is an index problem.** `on delete set null` is
the right *semantics* and an expensive *mechanism*: Postgres implements it with
a per-row trigger, so deleting one `word_occurrences` row runs `update <child>
set <fk> = null where <fk> = $1` once for every column that points at an
occurrence. A 175-chapter book is ~25 000 occurrences; five referencing columns
make that ~125 000 statements, and each one that lacks an index on `<fk>` is a
sequential scan of the learner's entire history. Measured on a representative
book (175 chapters, 25 200 occurrences, 20 000 learning events, 3 000 saved
words): **92.8 s** without those indexes, **0.93 s** with them. PostgREST gives
`authenticated` eight seconds, so before
`20260917120000_content_delete_indexes.sql` the delete could not finish at all —
it was cancelled mid-statement, rolled back, and surfaced to the learner as the
taxonomy's generic "Coś poszło nie tak. Spróbuj ponownie za chwilę.", every
time.

The subtlety worth remembering: every one of those columns *was* indexed, as
`(user_id, chapter_id, …)` or `(user_id, sentence_id)`, because that is what the
screens read. A referential check knows only the content id, so a `user_id`-led
index is invisible to it. **Both indexes are needed, and they answer different
questions.** `supabase/tests/08_content_index_coverage.sql` asks the catalog
rather than a list, so a future table with a `chapter_id` indexed only for its
screen fails the suite instead of quietly making book deletion slower until one
day it stops working.

The same arithmetic governs `replace_chapter_content`, which deletes a chapter's
paragraphs wholesale before reinserting them — "Odśwież słownictwo" was walking
towards the identical wall from the other direction, and the same indexes fix
it.

Cancelling an unconfirmed import deletes the preview rows and the uploaded
original, and keeps the import row as history so the list can say "anulowane"
rather than show a hole.

---

## 13. AI

**V1 is fully deterministic. No model is called anywhere in this feature.**

Extraction, cleanup, chapter detection, language detection and word counting are
all arithmetic over the learner's own bytes. Importing a digital book costs
Fluent nothing but CPU, which is the point: a learner who imports forty books
should cost forty times zero.

Specifically **not** done:

- The whole book is never sent anywhere. Sending a PDF to a language model so
  that it can retype the PDF would be the most expensive possible way to do a
  free operation.
- No AI language detection. A hundred function words answer "German?" better than
  three hundred pages of tokens would.
- No question bank generated at import time. A 70-chapter book would be 70
  generation jobs for chapters nobody has opened. The Story engine already
  generates lazily, per chapter, and imported chapters use that path unchanged.
- No AI cover generation.

**Where AI would go if it ever does.** The heuristic detector reports confidence,
and low confidence currently routes to *the learner*, who fixes it in one tap.
That is the cheapest and most private fallback there is, and it is the V1
decision. If an AI fallback is ever added it belongs behind the existing
`StoryQuestionProvider`-style seam, sees only candidate headings with a line of
context either side (never the book), is capped at one or two calls per import,
and must honour the existing `isPrivateContent` fail-closed check before a single
line of somebody's private book leaves the server.

---

## 14. Versions

| Stamp | Answers | Bump when |
| --- | --- | --- |
| `CONTENT_PROCESSOR_VERSION` (Phase 4) | "would reprocessing move a sentence boundary?" | the reader pipeline's output for the same input could differ |
| `IMPORT_PIPELINE_VERSION` | "would re-importing the same file produce different text?" | extraction or cleanup changes |
| `CHAPTER_DETECTOR_VERSION` | "would re-analysing the same text find different chapters?" | detection weights or signals change |

Three stamps, three questions, and they improve on different schedules. The
importer reuses the Phase 4 content hashing and versioning wholesale — it does
not have a parallel hash model.

`book_imports` records the pipeline and detector versions of the run that
produced its proposal, which is what would make "re-analyse the imports that
predate the better detector" a query rather than a guess. The re-analysis path
itself exists (`apply_book_import_analysis`), is guarded against destroying
manual work, and has no UI in this phase.

---

## 15. What is deliberately not here

- **OCR.** A PDF with no usable text layer is detected (`ocr_required`) and
  refused with an explanation and a suggestion, rather than run through an OCR
  stack Fluent has nowhere to host. The architecture is ready for it: the refusal
  is one classified error code, and an OCR provider would slot in ahead of the
  extractor registry as another `BookExtractor` or a pre-step that produces
  pages. Nothing else would change.
- **DOCX.** One more file in `extract/`, one more registry entry. Not done,
  because nothing asked for it yet.
- **Cover extraction.** An EPUB cover is a private image, and displaying it would
  mean a signed URL on every render of the shelf. The placeholder is used. The
  trade-off is recorded rather than half-built.
- **Sharing, publishing, a marketplace.** A private import stays private. There
  is no mechanism by which an uploaded book becomes public, and adding one would
  be a product decision with copyright consequences, not a feature.
- **A source-text editor.** Corrections are limited to chapter title, inclusion,
  split, merge and order. A 300 000-word textarea is not an editor.
- **Automatic retention cleanup.** `IMPORT_DRAFT_RETENTION_DAYS` and the
  `book_imports_draft_age_idx` index exist so a cleanup job can be written
  without a migration. No job runs on a schedule today.

---

## 16. Phase 6 readiness (assessment only — nothing implemented)

An imported chapter is, to everything downstream, an ordinary chapter: same
table, same paragraphs, same sentences, same occurrences, same
`chapter_vocabulary`, same RLS. So a future Contextual AI Tutor gets the same
context object for a private book as for a first-party one, with three things
already true that it will need:

1. **A spoiler boundary exists for free.** Context is assembled per chapter and
   nothing else is ever loaded, so a tutor for chapter 4 cannot leak chapter 5
   because it has never seen it. That is the foundation a real Spoiler Guard is
   built on, not a substitute for one.
2. **The privacy flag is already plumbed.** `ChapterQuestionRequest.isPrivateContent`
   and the fail-closed `checkProvider` predicate exist and are exercised; a
   provider that cannot honour a no-retention guarantee must refuse rather than
   proceed.
3. **Imported text is untrusted data, and always was.** A book can contain
   "Ignore previous instructions". Nothing in this pipeline treats file content
   as an instruction — it is parsed, never executed, never rendered as markup,
   and never interpolated into a prompt by this phase. A tutor must keep that
   property: chapter text goes into a model as *data*, inside a clearly delimited
   context block, and never as part of the instruction.

---

## 17. Files

```
src/lib/import/
  constants.ts            every weight, threshold, budget and version
  types.ts                the vocabulary the stages share
  state.ts                status/stage machine + Polish copy
  validate.ts             magic bytes, MIME, extension, size
  hash.ts                 SHA-256, browser and server
  language.ts             deterministic language detection
  quality.ts              scan / garble detection and text samples
  analyze.ts              the whole pipeline, pure apart from the extractors
  queries.ts              the read layer (RLS does the authorisation)
  extract/
    index.ts              the registry
    pdf.ts  epub.ts  text.ts
    xml.ts                just enough XML to read an EPUB
  cleanup/
    index.ts  lines.ts  running-heads.ts  wrap.ts
  chapters/
    detect.ts  patterns.ts  structural.ts
  fixtures/               synthetic PDF/EPUB/TXT + the script that builds them

src/lib/content/processor.ts        the trusted shared chapter processor
src/actions/book-import.ts          every write path
src/app/library/import/             the two routes
src/components/library/import/      uploader, stepper, review, workbench, history
supabase/migrations/20260915120000_private_book_import.sql
supabase/tests/06_book_import_security.sql
```
