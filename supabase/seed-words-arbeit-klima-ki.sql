-- Fluent: słówka z trzech tekstów — „Work-Life-Balance", „Klimawandel"
-- oraz „Künstliche Intelligenz".
-- Wygenerowane do wklejenia w Supabase SQL Editor.
--
-- IDEMPOTENTNE, jak pozostałe seedy słownikowe. `public.words.id` nie jest
-- kolumną identity (patrz `createWord` w src/actions/admin-words.ts), więc id
-- liczymy tak samo: `max(id)` + numer wiersza. Wstawiane są WYŁĄCZNIE lematy,
-- których jeszcze nie ma (porównanie po `lower(lemma)`). `dictionary_revision`
-- podbija istniejący trigger statement-level.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- JAK POWSTAŁA TA LISTA
-- ─────────────────────────────────────────────────────────────────────────────
-- Te trzy teksty to warianty czytanek, które już są w seed-texts-40.sql, więc
-- większość słownictwa słownik ZNA. Zamiast zgadywać, puściłem prawdziwy
-- `matchToken` (src/lib/content/dictionary-match.ts) po wszystkich tokenach
-- przeciwko słownikowi złożonemu z 298 lematów z seed-texts-40.sql plus obu
-- wcześniejszych seedów, i wziąłem to, czego NIE rozwiązał.
--
-- Dlatego nie ma tu m.in.: Work-Life-Balance, Klimawandel, Herausforderung,
-- Konsum, Fleisch, Energie, Flugreise, Emission, Politik, Künstlich,
-- Intelligenz, Arbeitswelt, Arbeitsplatz, Mitarbeiter, Gesellschaft,
-- Gesundheit, Zeit, Leben, Schlüssel, zufrieden, erreichbar, produktiv,
-- flexibel, sozial, kreativ, erkennen, abschalten, argumentieren, betonen,
-- befürchten, automatisieren, verändern, verlieren, gehen — wszystkie te formy
-- rozwiązują się do haseł, które słownik już ma.
--
-- Wyrazy funkcyjne (`GERMAN_FUNCTION_WORDS`) pominięte tak jak wcześniej:
-- `matchToken` rozwiązuje je normalnie, ta lista steruje tylko prezentacją
-- (`data-function-word` w ReaderProse) i raportowaniem luk — pomijam je, bo
-- słownik DTZ i tak je ma.
--
-- `mnemonic` zostaje puste: to pole pisze redaktor przez `saveMnemonic`.
--
-- UWAGA: dwie formy z tych tekstów nie rozwiązywały się MIMO że ich hasła są
-- już w słowniku — to luki de-inflektora, nie słownika:
--   * `gilt` → `gelten` — naprawione w tym samym branchu (nowa klasa form
--     w `IRREGULAR_VERB_FORMS`: czas teraźniejszy z przegłosem e→i/ie);
--   * `Flexible` → `flexibel` — NIE naprawione. Przymiotniki na `-el`/`-er`
--     gubią `e` przy odmianie (flexibel → flexible, dunkel → dunkle), a to
--     wymaga nowej REGUŁY w `baseFormCandidates`, nie wiersza w tabeli.
--     Opisane w raporcie do zadania.

with incoming (
  lemma, display, article, word_type, gender,
  translation_pl, example_de, example_pl,
  cefr, source, topic, plural, aux, synonyms, ipa
) as (
  values
  -- ═══════════════════════════════════════════════════════════════════════════
  -- TEKST 1 — Work-Life-Balance
  -- ═══════════════════════════════════════════════════════════════════════════
  ('Unternehmen'::text, 'das Unternehmen'::text, 'das'::text, 'noun'::text, 'n'::text,
   'przedsiębiorstwo, firma'::text,
   'Unternehmen erkennen zunehmend, dass zufriedene Mitarbeiter produktiver sind.'::text,
   'Firmy coraz częściej dostrzegają, że zadowoleni pracownicy są bardziej produktywni.'::text,
   'B1'::text, 'Story: Work-Life-Balance'::text, 'praca'::text, 'die Unternehmen'::text,
   null::text, array['die Firma', 'der Betrieb']::text[], 'ʊntɐˈneːmən'::text),

  ('Arbeitszeit', 'die Arbeitszeit', 'die', 'noun', 'f',
   'czas pracy',
   'Flexible Arbeitszeiten gewinnen an Bedeutung.',
   'Elastyczny czas pracy zyskuje na znaczeniu.',
   'A2', 'Story: Work-Life-Balance', 'praca', 'die Arbeitszeiten',
   null, null, 'ˈaʁbaɪ̯t͡sˌt͡saɪ̯t'),

  ('Recht', 'das Recht', 'das', 'noun', 'n',
   'prawo',
   'Das Recht auf Nichterreichbarkeit gewinnt an Bedeutung.',
   'Prawo do bycia nieosiągalnym zyskuje na znaczeniu.',
   'A2', 'Story: Work-Life-Balance', 'urzad', 'die Rechte',
   null, null, 'ʁɛçt'),

  ('Nichterreichbarkeit', 'die Nichterreichbarkeit', 'die', 'noun', 'f',
   'nieosiągalność, prawo do bycia offline po pracy',
   'Das Recht auf Nichterreichbarkeit ist ein neues Thema.',
   'Prawo do bycia offline to nowy temat.',
   'B2', 'Story: Work-Life-Balance', 'praca', null,
   null, null, 'ˈnɪçtʔɛɐ̯ˌʁaɪ̯çbaːɐ̯kaɪ̯t'),

  ('Bedeutung', 'die Bedeutung', 'die', 'noun', 'f',
   'znaczenie',
   'Flexible Arbeitszeiten gewinnen an Bedeutung.',
   'Elastyczny czas pracy zyskuje na znaczeniu.',
   'B1', 'Story: Work-Life-Balance', null, 'die Bedeutungen',
   null, array['der Sinn'], 'bəˈdɔʏ̯tʊŋ'),

  ('Dauer', 'die Dauer', 'die', 'noun', 'f',
   'czas trwania; (auf Dauer) na dłuższą metę',
   'Wer kaum abschaltet, riskiert auf Dauer seine Gesundheit.',
   'Kto prawie nie odpoczywa, na dłuższą metę ryzykuje zdrowiem.',
   'B1', 'Story: Work-Life-Balance', null, null,
   null, null, 'ˈdaʊ̯ɐ'),

  ('riskieren', 'riskieren', null, 'verb', null,
   'ryzykować',
   'Er riskiert auf Dauer seine Gesundheit.',
   'Na dłuższą metę ryzykuje swoim zdrowiem.',
   'B1', 'Story: Work-Life-Balance', 'zdrowie', null,
   'haben', array['wagen'], 'ʁɪsˈkiːʁən'),

  ('ausgewogen', 'ausgewogen', null, 'other', null,
   'wyważony, zrównoważony',
   'Eine ausgewogene Work-Life-Balance gilt vielen als Schlüssel zum Glück.',
   'Wyważony balans między pracą a życiem uchodzi dla wielu za klucz do szczęścia.',
   'B2', 'Story: Work-Life-Balance', 'zdrowie', null,
   null, array['ausgeglichen', 'harmonisch'], 'ˈaʊ̯sɡəˌvoːɡn̩'),

  ('ständig', 'ständig', null, 'other', null,
   'ciągły; ciągle, bez przerwy',
   'Wer ständig erreichbar ist, schaltet kaum ab.',
   'Kto jest ciągle osiągalny, prawie nie odpoczywa.',
   'B1', 'Story: Work-Life-Balance', null, null,
   null, array['dauernd', 'permanent'], 'ˈʃtɛndɪç'),

  ('kaum', 'kaum', null, 'other', null,
   'ledwie, prawie nie',
   'Er schaltet kaum ab.',
   'Prawie nie odpoczywa.',
   'B1', 'Story: Work-Life-Balance', null, null,
   null, null, 'kaʊ̯m'),

  ('zunehmend', 'zunehmend', null, 'other', null,
   'coraz bardziej, rosnący',
   'Unternehmen erkennen zunehmend, dass Pausen wichtig sind.',
   'Firmy coraz częściej dostrzegają, że przerwy są ważne.',
   'B2', 'Story: Work-Life-Balance', null, null,
   null, array['immer mehr'], 'ˈt͡suːˌneːmn̩t'),

  ('daher', 'daher', null, 'other', null,
   'dlatego, stąd',
   'Flexible Arbeitszeiten gewinnen daher an Bedeutung.',
   'Dlatego elastyczny czas pracy zyskuje na znaczeniu.',
   'B1', 'Story: Work-Life-Balance', null, null,
   null, array['deshalb', 'darum'], 'daˈheːɐ̯'),

  -- ═══════════════════════════════════════════════════════════════════════════
  -- TEKST 2 — Klimawandel
  -- ═══════════════════════════════════════════════════════════════════════════
  ('Verhalten', 'das Verhalten', 'das', 'noun', 'n',
   'zachowanie, postępowanie',
   'Auch das Verhalten jedes Einzelnen macht einen Unterschied.',
   'Zachowanie każdej pojedynczej osoby też robi różnicę.',
   'B1', 'Story: Klimawandel', null, null,
   null, null, 'fɛɐ̯ˈhaltn̩'),

  ('Einzelne', 'der Einzelne', 'der', 'noun', 'm',
   'jednostka, pojedyncza osoba',
   'Das Verhalten jedes Einzelnen zählt.',
   'Liczy się zachowanie każdej pojedynczej osoby.',
   'B2', 'Story: Klimawandel', null, 'die Einzelnen',
   null, null, 'ˈaɪ̯nt͡səlnə'),

  ('Unterschied', 'der Unterschied', 'der', 'noun', 'm',
   'różnica',
   'Auch das Verhalten jedes Einzelnen macht einen Unterschied.',
   'Zachowanie każdej pojedynczej osoby też robi różnicę.',
   'A2', 'Story: Klimawandel', null, 'die Unterschiede',
   null, null, 'ˈʊntɐʃiːt'),

  ('tragen', 'tragen', null, 'verb', null,
   'nieść, nosić; ponosić',
   'Sie trägt schwere Taschen.',
   'Niesie ciężkie torby.',
   'A2', 'Story: Klimawandel', null, null,
   'haben', null, 'ˈtʁaːɡn̩'),

  ('beitragen', 'beitragen', null, 'verb', null,
   'przyczyniać się (zu etwas – do czegoś)',
   'Unser Konsum trägt erheblich zu den Emissionen bei.',
   'Nasza konsumpcja znacząco przyczynia się do emisji.',
   'B2', 'Story: Klimawandel', null, null,
   'haben', null, 'ˈbaɪ̯ˌtʁaːɡn̩'),

  ('ändern', 'ändern', null, 'verb', null,
   'zmieniać',
   'Manche argumentieren, dass nur die Politik etwas ändern könne.',
   'Niektórzy twierdzą, że tylko polityka może coś zmienić.',
   'A2', 'Story: Klimawandel', null, null,
   'haben', array['verändern', 'wechseln'], 'ˈɛndɐn'),

  ('groß', 'groß', null, 'other', null,
   'duży, wielki',
   'Der Klimawandel ist eine der größten Herausforderungen unserer Zeit.',
   'Zmiana klimatu to jedno z największych wyzwań naszych czasów.',
   'A1', 'Story: Klimawandel', null, null,
   null, null, 'ɡʁoːs'),

  ('erheblich', 'erheblich', null, 'other', null,
   'znaczny; znacząco',
   'Unser Konsum trägt erheblich zu den Emissionen bei.',
   'Nasza konsumpcja znacząco przyczynia się do emisji.',
   'B2', 'Story: Klimawandel', null, null,
   null, array['beträchtlich', 'deutlich'], 'ɛɐ̯ˈheːplɪç'),

  -- lemma ≠ display tak jak przy `jede`: `dictionaryKeysFor` indeksuje ORAZ
  -- lemat, ORAZ ostatni wyraz `display`, więc para (manche, mancher) trafia
  -- w manche/manchen/manches ORAZ mancher, a nagłówkiem zostaje forma słownikowa.
  ('manche', 'mancher', null, 'other', null,
   'niektórzy, niejeden',
   'Manche argumentieren, dass nur die Politik etwas ändern könne.',
   'Niektórzy twierdzą, że tylko polityka może coś zmienić.',
   'B1', 'Story: Klimawandel', null, null,
   null, array['einige'], 'ˈmançə'),

  -- ═══════════════════════════════════════════════════════════════════════════
  -- TEKST 3 — Künstliche Intelligenz
  -- ═══════════════════════════════════════════════════════════════════════════
  ('Routineaufgabe', 'die Routineaufgabe', 'die', 'noun', 'f',
   'rutynowe zadanie',
   'Routineaufgaben werden automatisiert.',
   'Rutynowe zadania są automatyzowane.',
   'B2', 'Story: Künstliche Intelligenz', 'praca', 'die Routineaufgaben',
   null, null, 'ʁuˈtiːnəˌʔaʊ̯fɡaːbə'),

  ('Tätigkeit', 'die Tätigkeit', 'die', 'noun', 'f',
   'czynność, zajęcie, działalność',
   'Mitarbeiter haben mehr Zeit für kreative Tätigkeiten.',
   'Pracownicy mają więcej czasu na kreatywne zajęcia.',
   'B1', 'Story: Künstliche Intelligenz', 'praca', 'die Tätigkeiten',
   null, array['die Beschäftigung', 'die Aufgabe'], 'ˈtɛːtɪçkaɪ̯t'),

  ('Beschäftigte', 'der Beschäftigte', 'der', 'noun', 'm',
   'zatrudniony, pracownik',
   'Die Gesellschaft muss die Beschäftigten rechtzeitig weiterbilden.',
   'Społeczeństwo musi w porę dokształcać zatrudnionych.',
   'B2', 'Story: Künstliche Intelligenz', 'praca', 'die Beschäftigten',
   null, array['der Arbeitnehmer'], 'bəˈʃɛftɪçtə'),

  ('Wandel', 'der Wandel', 'der', 'noun', 'm',
   'zmiana, przemiana',
   'Die Gesellschaft muss den Wandel sozial gerecht gestalten.',
   'Społeczeństwo musi kształtować tę przemianę w sposób sprawiedliwy społecznie.',
   'B2', 'Story: Künstliche Intelligenz', null, null,
   null, array['die Veränderung'], 'ˈvandl̩'),

  ('weiterbilden', 'weiterbilden', null, 'verb', null,
   'dokształcać, szkolić dalej',
   'Die Gesellschaft bildet die Beschäftigten rechtzeitig weiter.',
   'Społeczeństwo dokształca zatrudnionych w porę.',
   'B2', 'Story: Künstliche Intelligenz', 'edukacja', null,
   'haben', array['schulen', 'qualifizieren'], 'ˈvaɪ̯tɐˌbɪldn̩'),

  ('gestalten', 'gestalten', null, 'verb', null,
   'kształtować, urządzać, projektować',
   'Den Wandel sozial gerecht gestalten ist die Aufgabe.',
   'Zadaniem jest kształtować tę przemianę sprawiedliwie społecznie.',
   'B1', 'Story: Künstliche Intelligenz', null, null,
   'haben', array['formen', 'entwerfen'], 'ɡəˈʃtaltn̩'),

  ('gleichzeitig', 'gleichzeitig', null, 'other', null,
   'jednocześnie, równocześnie',
   'Gleichzeitig befürchten viele, dass Arbeitsplätze verloren gehen.',
   'Jednocześnie wielu obawia się, że miejsca pracy zostaną utracone.',
   'B1', 'Story: Künstliche Intelligenz', null, null,
   null, array['zugleich'], 'ˈɡlaɪ̯çˌt͡saɪ̯tɪç'),

  ('entscheidend', 'entscheidend', null, 'other', null,
   'decydujący, rozstrzygający',
   'Entscheidend wird sein, ob die Gesellschaft rechtzeitig reagiert.',
   'Decydujące będzie to, czy społeczeństwo zareaguje w porę.',
   'B2', 'Story: Künstliche Intelligenz', null, null,
   null, array['ausschlaggebend', 'wesentlich'], 'ɛntˈʃaɪ̯dn̩t'),

  ('rechtzeitig', 'rechtzeitig', null, 'other', null,
   'na czas, w porę',
   'Die Beschäftigten müssen rechtzeitig weitergebildet werden.',
   'Zatrudnieni muszą być dokształceni w porę.',
   'B1', 'Story: Künstliche Intelligenz', null, null,
   null, array['früh genug', 'pünktlich'], 'ˈʁɛçtˌt͡saɪ̯tɪç'),

  ('gerecht', 'gerecht', null, 'other', null,
   'sprawiedliwy',
   'Den Wandel sozial gerecht gestalten.',
   'Kształtować przemianę sprawiedliwie społecznie.',
   'B1', 'Story: Künstliche Intelligenz', null, null,
   null, array['fair'], 'ɡəˈʁɛçt'),

  ('sodass', 'sodass', null, 'other', null,
   'tak że, wskutek czego',
   'Routineaufgaben werden automatisiert, sodass mehr Zeit bleibt.',
   'Rutynowe zadania są automatyzowane, tak że zostaje więcej czasu.',
   'B1', 'Story: Künstliche Intelligenz', null, null,
   null, array['so dass'], 'zoˈdas')
),

-- Tylko lematy, których słownik jeszcze nie zna.
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
  m.cefr, m.source, m.topic, m.plural, m.aux, m.synonyms, m.ipa
from missing m
cross join base b;
