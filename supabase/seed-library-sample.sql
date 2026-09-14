-- Fluent — a sample multi-chapter story for the reader.
--
-- WHY THIS FILE EXISTS. The Book Engine is only testable against something that
-- is actually shaped like a book: several chapters, real paragraphs, dialogue,
-- numbers, abbreviations and long compounds — the things that break a naive
-- sentence splitter. Fluent's existing passages are 150-word A1 texts and would
-- have proved nothing.
--
-- RIGHTS. "Der Schlüssel" is an ORIGINAL text written for this repository:
-- `rights = 'first_party'`, safe to publish, safe to keep in version control.
-- Do not replace it with a copyrighted novel — the content-rights model exists
-- precisely so that the answer to "can we ship this?" is a column and not a
-- guess (see `docs/architecture/reader-story-engine.md`).
--
-- Run it after `schema.sql`, then process the chapters in `/admin/library` (or
-- with the "Przetwórz oczekujące" button). The chapters are inserted as `draft`
-- on purpose: the paragraph/sentence/occurrence structure is produced by the
-- TypeScript pipeline in `src/lib/content/`, never by SQL, so that Fluent has
-- exactly one tokenizer.
--
-- Idempotent: re-running it changes nothing.

do $$
declare
  v_item uuid;
begin
  select id into v_item from public.library_items where slug = 'der-schluessel';

  if v_item is null then
    insert into public.library_items (
      slug, title, subtitle, author, description,
      content_type, rights, status, cefr_estimate, source_type
    ) values (
      'der-schluessel',
      'Der Schlüssel',
      'Eine kurze Geschichte in drei Kapiteln',
      'Fluent',
      'Lena findet einen alten Schlüssel im Keller. Er passt in kein Schloss im Haus — noch nicht.',
      'story',
      'first_party',
      'draft',
      'A2',
      'fluent_original'
    )
    returning id into v_item;
  end if;

  insert into public.chapters (library_item_id, position, title, source_text, status)
  select v_item, 1, 'Der Keller', $chapter$
Der Keller roch nach altem Papier und nassem Stein. Lena stand auf der letzten Stufe und suchte den Lichtschalter. Sie fand ihn nicht.

»Ist da unten jemand?«, rief ihre Mutter von oben.

"Nur ich", antwortete Lena. Sie ging weiter, langsam, eine Hand an der kalten Wand.

Zwischen zwei Kisten lag ein kleiner Karton. Darin lagen Briefe, eine kaputte Uhr und ein Schlüssel aus Messing. Der Schlüssel war schwer und sehr alt. Auf dem Griff standen drei Buchstaben: A. W. M.

Lena drehte ihn im Licht ihres Telefons. Am 3. Mai 1961 hatte jemand diesen Schlüssel zum letzten Mal benutzt — das stand auf einem Zettel, der am Ring hing. Der Zettel war klein, kaum größer als eine Briefmarke, und die Schrift war braun geworden.

Sie steckte den Schlüssel in die Tasche und ging nach oben.
$chapter$, 'draft'
  where not exists (
    select 1 from public.chapters c where c.library_item_id = v_item and c.position = 1
  );

  insert into public.chapters (library_item_id, position, title, source_text, status)
  select v_item, 2, 'Die Türen', $chapter$
Am nächsten Morgen probierte Lena jede Tür im Haus.

Die Haustür: nein. Die Kellertür: nein. Der alte Schrank im Flur, den niemand mehr öffnete: auch nicht. Der Schlüssel passte nirgends, aber er passte auch zu keinem modernen Schloss. Er war zu groß, zu schwer, aus einer anderen Zeit.

»Das ist kein Hausschlüssel«, sagte ihr Großvater beim Frühstück. Er trank seinen Kaffee sehr langsam, wie immer. »So einen hatten früher die Schließfächer im Bahnhof. Oder die Werkstätten. Z. B. die von deinem Urgroßvater.«

"Urgroßvater?", fragte Lena.

Ihr Großvater stellte die Tasse ab. Er sah lange aus dem Fenster, bevor er antwortete.

»Albert Wilhelm Möller«, sagte er. »A. W. M. Er hatte eine Werkstatt in der Bahnhofstraße. Nr. 14. Sie steht noch.«

Lena sah auf den Schlüssel in ihrer Hand. Die drei Buchstaben waren jetzt keine Buchstaben mehr, sondern ein Name.
$chapter$, 'draft'
  where not exists (
    select 1 from public.chapters c where c.library_item_id = v_item and c.position = 2
  );

  insert into public.chapters (library_item_id, position, title, source_text, status)
  select v_item, 3, 'Bahnhofstraße 14', $chapter$
Die Werkstatt war jetzt ein Fahrradladen. Der Mann hinter dem Tresen war etwa vierzig und trug eine Brille mit dickem Rahmen.

»Entschuldigung«, sagte Lena. »Gibt es hier noch alte Schränke? Aus der Zeit vor dem Laden?«

Der Mann lachte. »Alte Schränke? Wir haben einen Keller voll davon. Die Krankenversicherung würde mich umbringen, wenn jemand da runtergeht.« Dann sah er den Schlüssel in ihrer Hand und wurde still.

»Der ist von hier«, sagte er langsam. »Komm mit.«

Im Keller standen sechs schmale Metallschränke an der Wand. Fünf waren offen und leer. Der sechste war zu. Lena steckte den Schlüssel ins Schloss. Er drehte sich schwer, aber er drehte sich.

Im Schrank lag ein Bündel Briefe, mit einer Schnur zusammengebunden. Auf dem obersten stand ein Name in derselben braunen Schrift: *Für Anna, wenn sie alt genug ist.*

Lena setzte sich auf den kalten Boden und begann zu lesen.
$chapter$, 'draft'
  where not exists (
    select 1 from public.chapters c where c.library_item_id = v_item and c.position = 3
  );

  update public.library_items i
     set chapter_count = (select count(*) from public.chapters c where c.library_item_id = i.id)
   where i.id = v_item;
end $$;
