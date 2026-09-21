-- Fluent: słówka z rozdziału „Der Schlüssel" (Lena / Urgroßvater).
-- Wygenerowane do wklejenia w Supabase SQL Editor.
--
-- IDEMPOTENTNE. `public.words.id` nie jest kolumną identity (patrz
-- `createWord` w src/actions/admin-words.ts — id pochodzi z max(id) + 1), więc
-- ten skrypt liczy id tak samo: `max(id)` + numer wiersza. Wstawiane są tylko
-- te lematy, których jeszcze NIE MA w słowniku (porównanie po `lower(lemma)`),
-- dlatego ponowne uruchomienie nie tworzy duplikatów i nie nadpisuje niczego,
-- co redaktor zdążył poprawić ręcznie.
--
-- Rewizja słownika (`dictionary_revision`) podbija się sama — na `public.words`
-- wisi wyzwalacz `words_bump_dictionary_revision` (statement-level), więc cały
-- INSERT kosztuje jedno podbicie, a czytnik odświeży swój indeks sam.
--
-- Pominięto świadomie:
--   * wyrazy funkcyjne, które i tak nigdy nie zostaną zglosowane w czytniku —
--     `GERMAN_FUNCTION_WORDS` w src/lib/german-morphology.ts wyklucza m.in.
--     aber, auch, noch, sehr, jetzt, immer, sondern, kein, war, hatte;
--   * rdzeń A1, który słownik już ma (sagen, fragen, trinken, sehen, stehen,
--     gehen, alt, groß) — a gdyby jednak go nie miał, guard i tak by zadziałał;
--   * nazwy własne (Lena, Albert Wilhelm Möller, Bahnhofstraße);
--   * `mnemonic` — to pole pisze człowiek w panelu (`saveMnemonic`), nie seed.

with incoming (
  lemma, display, article, word_type, gender,
  translation_pl, example_de, example_pl,
  cefr, topic, plural, aux, synonyms, ipa
) as (
  values
  -- ── RZECZOWNIKI ───────────────────────────────────────────────────────────
  ('Morgen'::text, 'der Morgen'::text, 'der'::text, 'noun'::text, 'm'::text,
   'poranek, rano'::text,
   'Am nächsten Morgen probierte sie jede Tür im Haus.'::text,
   'Następnego ranka próbowała każdych drzwi w domu.'::text,
   'A1'::text, null::text, 'die Morgen'::text, null::text,
   array['der Vormittag']::text[], 'ˈmɔʁɡn̩'::text),

  ('Tür', 'die Tür', 'die', 'noun', 'f',
   'drzwi',
   'Bitte mach die Tür zu, es zieht.',
   'Zamknij proszę drzwi, wieje.',
   'A1', 'mieszkanie', 'die Türen', null, null, 'tyːɐ̯'),

  ('Haus', 'das Haus', 'das', 'noun', 'n',
   'dom',
   'Sie probierte jede Tür im Haus.',
   'Próbowała każdych drzwi w domu.',
   'A1', 'mieszkanie', 'die Häuser', null, array['das Gebäude'], 'haʊ̯s'),

  ('Haustür', 'die Haustür', 'die', 'noun', 'f',
   'drzwi wejściowe',
   'Die Haustür lässt sich nur mit dem großen Schlüssel öffnen.',
   'Drzwi wejściowe otwierają się tylko dużym kluczem.',
   'A2', 'mieszkanie', 'die Haustüren', null, array['die Eingangstür'], 'ˈhaʊ̯sˌtyːɐ̯'),

  ('Keller', 'der Keller', 'der', 'noun', 'm',
   'piwnica',
   'Die alten Koffer stehen unten im Keller.',
   'Stare walizki stoją na dole w piwnicy.',
   'A2', 'mieszkanie', 'die Keller', null, null, 'ˈkɛlɐ'),

  ('Kellertür', 'die Kellertür', 'die', 'noun', 'f',
   'drzwi do piwnicy',
   'Die Kellertür war abgeschlossen.',
   'Drzwi do piwnicy były zamknięte na klucz.',
   'B1', 'mieszkanie', 'die Kellertüren', null, null, 'ˈkɛlɐˌtyːɐ̯'),

  ('Schrank', 'der Schrank', 'der', 'noun', 'm',
   'szafa',
   'Der alte Schrank im Flur wurde seit Jahren nicht geöffnet.',
   'Stara szafa w przedpokoju nie była otwierana od lat.',
   'A2', 'mieszkanie', 'die Schränke', null, array['der Kleiderschrank'], 'ʃʁaŋk'),

  ('Flur', 'der Flur', 'der', 'noun', 'm',
   'korytarz, przedpokój',
   'Im Flur steht nur ein Schrank und eine Lampe.',
   'W przedpokoju stoi tylko szafa i lampa.',
   'A2', 'mieszkanie', 'die Flure', null, array['der Korridor', 'der Gang'], 'fluːɐ̯'),

  ('Schlüssel', 'der Schlüssel', 'der', 'noun', 'm',
   'klucz',
   'Der Schlüssel passte nirgends.',
   'Klucz nigdzie nie pasował.',
   'A1', 'mieszkanie', 'die Schlüssel', null, null, 'ˈʃlʏsl̩'),

  ('Hausschlüssel', 'der Hausschlüssel', 'der', 'noun', 'm',
   'klucz do domu',
   '»Das ist kein Hausschlüssel«, sagte ihr Großvater.',
   '„To nie jest klucz do domu" – powiedział jej dziadek.',
   'A2', 'mieszkanie', 'die Hausschlüssel', null, null, 'ˈhaʊ̯sˌʃlʏsl̩'),

  ('Schloss', 'das Schloss', 'das', 'noun', 'n',
   'zamek (w drzwiach); pałac',
   'Er passte zu keinem modernen Schloss.',
   'Nie pasował do żadnego nowoczesnego zamka.',
   'A2', 'mieszkanie', 'die Schlösser', null, null, 'ʃlɔs'),

  ('Zeit', 'die Zeit', 'die', 'noun', 'f',
   'czas',
   'Er war zu groß, zu schwer, aus einer anderen Zeit.',
   'Był za duży, za ciężki, z innych czasów.',
   'A1', null, 'die Zeiten', null, null, 't͡saɪ̯t'),

  ('Großvater', 'der Großvater', 'der', 'noun', 'm',
   'dziadek',
   'Ihr Großvater trank seinen Kaffee sehr langsam.',
   'Jej dziadek pił kawę bardzo powoli.',
   'A1', 'rodzina', 'die Großväter', null, array['der Opa'], 'ˈɡʁoːsˌfaːtɐ'),

  ('Urgroßvater', 'der Urgroßvater', 'der', 'noun', 'm',
   'pradziadek',
   'Die Werkstatt gehörte ihrem Urgroßvater.',
   'Warsztat należał do jej pradziadka.',
   'B1', 'rodzina', 'die Urgroßväter', null, null, 'ˈuːɐ̯ɡʁoːsˌfaːtɐ'),

  ('Frühstück', 'das Frühstück', 'das', 'noun', 'n',
   'śniadanie',
   'Beim Frühstück sprachen sie über den Schlüssel.',
   'Przy śniadaniu rozmawiali o kluczu.',
   'A1', 'jedzenie', 'die Frühstücke', null, null, 'ˈfʁyːʃtʏk'),

  ('Kaffee', 'der Kaffee', 'der', 'noun', 'm',
   'kawa',
   'Er trank seinen Kaffee sehr langsam, wie immer.',
   'Pił kawę bardzo powoli, jak zawsze.',
   'A1', 'jedzenie', 'die Kaffees', null, null, 'ˈkafe'),

  ('Tasse', 'die Tasse', 'die', 'noun', 'f',
   'filiżanka, kubek',
   'Ihr Großvater stellte die Tasse ab.',
   'Jej dziadek odstawił filiżankę.',
   'A1', 'jedzenie', 'die Tassen', null, array['der Becher'], 'ˈtasə'),

  ('Bahnhof', 'der Bahnhof', 'der', 'noun', 'm',
   'dworzec',
   'So einen Schlüssel hatten früher die Schließfächer im Bahnhof.',
   'Takie klucze miały kiedyś skrytki na dworcu.',
   'A1', 'podroze', 'die Bahnhöfe', null, null, 'ˈbaːnhoːf'),

  ('Schließfach', 'das Schließfach', 'das', 'noun', 'n',
   'skrytka, schowek (na dworcu)',
   'Am Bahnhof gibt es noch zwei freie Schließfächer.',
   'Na dworcu są jeszcze dwie wolne skrytki.',
   'B1', 'podroze', 'die Schließfächer', null, null, 'ˈʃliːsfax'),

  ('Werkstatt', 'die Werkstatt', 'die', 'noun', 'f',
   'warsztat',
   'Er hatte eine Werkstatt in der Bahnhofstraße.',
   'Miał warsztat na Bahnhofstraße.',
   'B1', 'praca', 'die Werkstätten', null, null, 'ˈvɛʁkʃtat'),

  ('Fenster', 'das Fenster', 'das', 'noun', 'n',
   'okno',
   'Er sah lange aus dem Fenster, bevor er antwortete.',
   'Długo patrzył przez okno, zanim odpowiedział.',
   'A1', 'mieszkanie', 'die Fenster', null, null, 'ˈfɛnstɐ'),

  ('Hand', 'die Hand', 'die', 'noun', 'f',
   'ręka, dłoń',
   'Lena sah auf den Schlüssel in ihrer Hand.',
   'Lena spojrzała na klucz w swojej dłoni.',
   'A1', 'zdrowie', 'die Hände', null, null, 'hant'),

  ('Buchstabe', 'der Buchstabe', 'der', 'noun', 'm',
   'litera',
   'Die drei Buchstaben waren jetzt ein Name.',
   'Te trzy litery były teraz imieniem.',
   'A2', 'edukacja', 'die Buchstaben', null, null, 'ˈbuːxˌʃtaːbə'),

  ('Name', 'der Name', 'der', 'noun', 'm',
   'imię, nazwisko, nazwa',
   'Schreiben Sie bitte Ihren Namen in das erste Feld.',
   'Proszę wpisać swoje nazwisko w pierwsze pole.',
   'A1', 'urzad', 'die Namen', null, null, 'ˈnaːmə'),

  ('Nummer', 'die Nummer', 'die', 'noun', 'f',
   'numer',
   'Die Werkstatt war in der Bahnhofstraße, Nummer 14.',
   'Warsztat był na Bahnhofstraße pod numerem 14.',
   'A1', 'urzad', 'die Nummern', null, null, 'ˈnʊmɐ'),

  ('Beispiel', 'das Beispiel', 'das', 'noun', 'n',
   'przykład',
   'Z. B. die Werkstatt von deinem Urgroßvater.',
   'Na przykład warsztat twojego pradziadka.',
   'A2', 'edukacja', 'die Beispiele', null, null, 'ˈbaɪ̯ʃpiːl'),

  -- ── CZASOWNIKI ────────────────────────────────────────────────────────────
  ('probieren', 'probieren', null, 'verb', null,
   'próbować, spróbować; przymierzać',
   'Am nächsten Morgen probierte Lena jede Tür im Haus.',
   'Następnego ranka Lena próbowała każdych drzwi w domu.',
   'A2', null, null, 'haben', array['versuchen', 'testen'], 'pʁoˈbiːʁən'),

  ('öffnen', 'öffnen', null, 'verb', null,
   'otwierać',
   'Den alten Schrank öffnete niemand mehr.',
   'Starej szafy nikt już nie otwierał.',
   'A1', null, null, 'haben', array['aufmachen'], 'ˈœfnən'),

  ('passen', 'passen', null, 'verb', null,
   'pasować',
   'Der Schlüssel passte zu keinem modernen Schloss.',
   'Klucz nie pasował do żadnego nowoczesnego zamka.',
   'A2', 'zakupy', null, 'haben', null, 'ˈpasn̩'),

  ('antworten', 'antworten', null, 'verb', null,
   'odpowiadać',
   'Er sah lange aus dem Fenster, bevor er antwortete.',
   'Długo patrzył przez okno, zanim odpowiedział.',
   'A1', null, null, 'haben', null, 'ˈantvɔʁtn̩'),

  ('stellen', 'stellen', null, 'verb', null,
   'stawiać, postawić',
   'Stell die Tasse bitte auf den Tisch.',
   'Postaw filiżankę proszę na stole.',
   'A2', null, null, 'haben', null, 'ˈʃtɛlən'),

  ('abstellen', 'abstellen', null, 'verb', null,
   'odstawić, postawić; wyłączyć',
   'Ihr Großvater stellte die Tasse ab.',
   'Jej dziadek odstawił filiżankę.',
   'B1', null, null, 'haben', null, 'ˈapˌʃtɛlən'),

  -- ── POZOSTAŁE (przymiotniki, przysłówki, spójniki) ────────────────────────
  ('nächste', 'nächste', null, 'other', null,
   'następny, najbliższy',
   'Am nächsten Morgen war alles anders.',
   'Następnego ranka wszystko było inaczej.',
   'A2', null, null, null, null, 'ˈnɛːçstə'),

  -- lemma ≠ display celowo: `dictionaryKeysFor` indeksuje ORAZ lemat, ORAZ
  -- ostatni wyraz `display`, więc para (jede, jeder) daje dwa klucze i trafia
  -- w jede/jeden/jedes ORAZ jeder — a nagłówkiem w UI zostaje forma słownikowa.
  ('jede', 'jeder', null, 'other', null,
   'każdy',
   'Sie probierte jede Tür im Haus.',
   'Próbowała każdych drzwi w domu.',
   'A1', null, null, null, null, 'ˈjeːdɐ'),

  ('niemand', 'niemand', null, 'other', null,
   'nikt',
   'Den Schrank öffnete niemand mehr.',
   'Szafy nikt już nie otwierał.',
   'A2', null, null, null, array['keiner'], 'ˈniːmant'),

  ('nirgends', 'nirgends', null, 'other', null,
   'nigdzie',
   'Der Schlüssel passte nirgends.',
   'Klucz nigdzie nie pasował.',
   'B1', null, null, null, array['nirgendwo'], 'ˈnɪʁɡn̩ts'),

  ('mehr', 'mehr', null, 'other', null,
   'więcej; (nicht mehr) już nie',
   'Den Schrank öffnete niemand mehr.',
   'Szafy nikt już nie otwierał.',
   'A1', null, null, null, null, 'meːɐ̯'),

  ('modern', 'modern', null, 'other', null,
   'nowoczesny',
   'Er passte zu keinem modernen Schloss.',
   'Nie pasował do żadnego nowoczesnego zamka.',
   'A2', null, null, null, array['zeitgemäß'], 'moˈdɛʁn'),

  ('schwer', 'schwer', null, 'other', null,
   'ciężki; trudny',
   'Der Schlüssel war zu groß und zu schwer.',
   'Klucz był za duży i za ciężki.',
   'A2', null, null, null, null, 'ʃveːɐ̯'),

  ('andere', 'andere', null, 'other', null,
   'inny',
   'Der Schlüssel war aus einer anderen Zeit.',
   'Klucz był z innych czasów.',
   'A2', null, null, null, null, 'ˈandəʁə'),

  ('langsam', 'langsam', null, 'other', null,
   'powolny; powoli',
   'Er trank seinen Kaffee sehr langsam.',
   'Pił kawę bardzo powoli.',
   'A1', null, null, null, null, 'ˈlaŋzaːm'),

  ('früher', 'früher', null, 'other', null,
   'dawniej, kiedyś; wcześniej',
   'So einen Schlüssel hatten früher die Schließfächer.',
   'Takie klucze miały kiedyś skrytki.',
   'A2', null, null, null, null, 'ˈfʁyːɐ'),

  ('lange', 'lange', null, 'other', null,
   'długo',
   'Er sah lange aus dem Fenster.',
   'Długo patrzył przez okno.',
   'A2', null, null, null, null, 'ˈlaŋə'),

  ('bevor', 'bevor', null, 'other', null,
   'zanim',
   'Er sah aus dem Fenster, bevor er antwortete.',
   'Patrzył przez okno, zanim odpowiedział.',
   'A2', null, null, null, null, 'bəˈfoːɐ̯')
),

-- Tylko te lematy, których słownik jeszcze nie zna. Porównanie po `lower()`,
-- bo rzeczowniki zapisujemy wielką literą, a czasowniki małą.
missing as (
  select i.*, row_number() over (order by i.lemma) as rn
  from incoming i
  where not exists (
    select 1 from public.words w where lower(w.lemma) = lower(i.lemma)
  )
),

-- `words.id` nie ma sekwencji — nowe id liczymy tak samo jak `createWord`.
base as (select coalesce(max(id), 0) as max_id from public.words)

insert into public.words (
  id, lemma, display, article, word_type, gender,
  translation_pl, example_de, example_pl,
  cefr, source, topic, plural, aux, synonyms, ipa
)
select
  b.max_id + m.rn,
  m.lemma, m.display, m.article, m.word_type, m.gender,
  m.translation_pl, m.example_de, m.example_pl,
  m.cefr, 'Story: Der Schlüssel', m.topic, m.plural, m.aux, m.synonyms, m.ipa
from missing m
cross join base b;
