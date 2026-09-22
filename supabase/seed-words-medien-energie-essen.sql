-- Fluent: słówka z trzech tekstów — „Desinformation", „Erneuerbare Energien"
-- oraz „Esskultur".
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
-- Tak samo jak seed-words-arbeit-klima-ki.sql: prawdziwy `matchToken`
-- (src/lib/content/dictionary-match.ts) po wszystkich tokenach, przeciwko
-- słownikowi z 298 lematów z seed-texts-40.sql plus trzech wcześniejszych
-- seedów. Wzięte to, czego NIE rozwiązał — 23 hasła z ~90 tokenów treściowych.
--
-- Dlatego nie ma tu m.in.: Desinformation, Internet, Nachricht, Behauptung,
-- Quelle, Medienkompetenz, Fähigkeit, verbreiten, teilen, prüfen, schützen,
-- Energie, Sonne, Wind, Energieversorgung, Treibhausgas, Speicherung, Problem,
-- günstig, verursachen, gelten, bleiben, Esskultur, Jahrzehnt, Lebensmittel,
-- Mensch, Zeit, Kochen, achten, regional, nachhaltig, verändern, fehlen,
-- gleichzeitig, kaum — wszystkie rozwiązują się do haseł, które słownik ma.
--
-- Wyrazy funkcyjne (`GERMAN_FUNCTION_WORDS`) pominięte jak wcześniej:
-- `matchToken` rozwiązuje je normalnie, ta lista steruje tylko prezentacją
-- (`data-function-word` w ReaderProse) i raportowaniem luk.
--
-- `mnemonic` zostaje puste: to pole pisze redaktor przez `saveMnemonic`.
--
-- POPRAWKA DO WCZEŚNIEJSZEGO SEEDU. `sehen` jest tu, choć pochodzi z tekstu
-- o Esskultur (`gesehen`), bo przy seed-words-der-schluessel.sql ZAŁOŻYŁEM, że
-- słownik już je ma, i pominąłem je przy zdaniu „Er sah lange aus dem Fenster".
-- Nie ma go wśród 298 lematów. Dodane tutaj naprawia oba teksty naraz: tabela
-- `IRREGULAR_VERB_FORMS` zna `sah` i `sieht`, więc brakowało tylko hasła.

with incoming (
  lemma, display, article, word_type, gender,
  translation_pl, example_de, example_pl,
  cefr, source, topic, plural, aux, synonyms, ipa
) as (
  values
  -- ═══════════════════════════════════════════════════════════════════════════
  -- TEKST 1 — Desinformation
  -- ═══════════════════════════════════════════════════════════════════════════
  ('Information'::text, 'die Information'::text, 'die'::text, 'noun'::text, 'f'::text,
   'informacja'::text,
   'Wer Informationen kritisch hinterfragt, schützt sich vor Manipulation.'::text,
   'Kto krytycznie kwestionuje informacje, chroni się przed manipulacją.'::text,
   'A2'::text, 'Story: Desinformation'::text, 'edukacja'::text, 'die Informationen'::text,
   null::text, array['die Auskunft']::text[], 'ɪnfɔʁmaˈt͡si̯oːn'::text),

  ('Manipulation', 'die Manipulation', 'die', 'noun', 'f',
   'manipulacja',
   'Kritisches Denken schützt vor Manipulation.',
   'Krytyczne myślenie chroni przed manipulacją.',
   'B2', 'Story: Desinformation', 'edukacja', 'die Manipulationen',
   null, null, 'manipulaˈt͡si̯oːn'),

  ('hinterfragen', 'hinterfragen', null, 'verb', null,
   'kwestionować, krytycznie analizować',
   'Wer Informationen kritisch hinterfragt, fällt nicht auf jede Behauptung herein.',
   'Kto krytycznie kwestionuje informacje, nie nabiera się na każde twierdzenie.',
   'B2', 'Story: Desinformation', 'edukacja', null,
   'haben', array['infrage stellen'], 'hɪntɐˈfʁaːɡn̩'),

  ('schnell', 'schnell', null, 'other', null,
   'szybki; szybko',
   'Desinformation verbreitet sich oft schneller als seriöse Nachrichten.',
   'Dezinformacja rozprzestrzenia się często szybciej niż rzetelne wiadomości.',
   'A1', 'Story: Desinformation', null, null,
   null, array['rasch'], 'ʃnɛl'),

  ('seriös', 'seriös', null, 'other', null,
   'rzetelny, poważny, wiarygodny',
   'Seriöse Nachrichten nennen immer ihre Quelle.',
   'Rzetelne wiadomości zawsze podają swoje źródło.',
   'B2', 'Story: Desinformation', null, null,
   null, array['glaubwürdig', 'zuverlässig'], 'zeˈʁi̯øːs'),

  ('falsch', 'falsch', null, 'other', null,
   'fałszywy, błędny; źle',
   'Falsche Behauptungen werden geteilt, ohne dass jemand die Quelle prüft.',
   'Fałszywe twierdzenia są udostępniane, a nikt nie sprawdza źródła.',
   'A2', 'Story: Desinformation', null, null,
   null, array['unrichtig'], 'falʃ'),

  ('jemand', 'jemand', null, 'other', null,
   'ktoś',
   'Sie werden geteilt, ohne dass jemand die Quelle prüft.',
   'Są udostępniane, a nikt (dosł. bez tego, żeby ktoś) nie sprawdza źródła.',
   'A2', 'Story: Desinformation', null, null,
   null, null, 'ˈjeːmant'),

  ('deshalb', 'deshalb', null, 'other', null,
   'dlatego',
   'Deshalb ist Medienkompetenz heute eine wichtige Fähigkeit.',
   'Dlatego kompetencja medialna jest dziś ważną umiejętnością.',
   'A2', 'Story: Desinformation', null, null,
   null, array['darum', 'daher'], 'dɛsˈhalp'),

  ('kritisch', 'kritisch', null, 'other', null,
   'krytyczny; krytycznie',
   'Wer Informationen kritisch hinterfragt, schützt sich.',
   'Kto krytycznie kwestionuje informacje, chroni się.',
   'B1', 'Story: Desinformation', 'edukacja', null,
   null, null, 'ˈkʁiːtɪʃ'),

  -- ═══════════════════════════════════════════════════════════════════════════
  -- TEKST 2 — Erneuerbare Energien
  -- ═══════════════════════════════════════════════════════════════════════════
  ('Zukunft', 'die Zukunft', 'die', 'noun', 'f',
   'przyszłość',
   'Erneuerbare Energien gelten als Zukunft der Energieversorgung.',
   'Odnawialne źródła energii uchodzą za przyszłość zaopatrzenia w energię.',
   'A2', 'Story: Erneuerbare Energien', null, null,
   null, null, 'ˈt͡suːkʊnft'),

  ('Batterie', 'die Batterie', 'die', 'noun', 'f',
   'bateria, akumulator',
   'Es wird intensiv an besseren Batterien geforscht.',
   'Intensywnie bada się lepsze akumulatory.',
   'A2', 'Story: Erneuerbare Energien', null, 'die Batterien',
   null, array['der Akku'], 'batəˈʁiː'),

  ('Stromnetz', 'das Stromnetz', 'das', 'noun', 'n',
   'sieć elektroenergetyczna',
   'An besseren Stromnetzen wird intensiv geforscht.',
   'Intensywnie bada się lepsze sieci elektroenergetyczne.',
   'B2', 'Story: Erneuerbare Energien', null, 'die Stromnetze',
   null, null, 'ˈʃtʁoːmˌnɛt͡s'),

  ('scheinen', 'scheinen', null, 'verb', null,
   'świecić; wydawać się',
   'Die Sonne scheint nicht immer.',
   'Słońce nie zawsze świeci.',
   'A2', 'Story: Erneuerbare Energien', null, null,
   'haben', array['leuchten', 'wirken'], 'ˈʃaɪ̯nən'),

  ('forschen', 'forschen', null, 'verb', null,
   'badać, prowadzić badania',
   'Es wird intensiv an besseren Batterien geforscht.',
   'Intensywnie prowadzi się badania nad lepszymi akumulatorami.',
   'B2', 'Story: Erneuerbare Energien', 'edukacja', null,
   'haben', array['untersuchen', 'erforschen'], 'ˈfɔʁʃn̩'),

  ('intensiv', 'intensiv', null, 'other', null,
   'intensywny; intensywnie',
   'Es wird intensiv an neuen Lösungen geforscht.',
   'Intensywnie prowadzi się badania nad nowymi rozwiązaniami.',
   'B1', 'Story: Erneuerbare Energien', null, null,
   null, null, 'ɪntɛnˈziːf'),

  -- Stopień wyższy od `gut` jest supletywny — żadna reguła nie prowadzi od
  -- `besser` do `gut`, więc to osobne hasło, nie forma fleksyjna.
  ('besser', 'besser', null, 'other', null,
   'lepszy, lepiej (stopień wyższy od gut)',
   'Es wird an besseren Batterien geforscht.',
   'Bada się lepsze akumulatory.',
   'A2', 'Story: Erneuerbare Energien', null, null,
   null, null, 'ˈbɛsɐ'),

  -- ═══════════════════════════════════════════════════════════════════════════
  -- TEKST 3 — Esskultur
  -- ═══════════════════════════════════════════════════════════════════════════
  ('Fertiggericht', 'das Fertiggericht', 'das', 'noun', 'n',
   'danie gotowe',
   'Fertiggerichte und Lieferdienste sind beliebter denn je.',
   'Dania gotowe i dostawy jedzenia są popularniejsze niż kiedykolwiek.',
   'B1', 'Story: Esskultur', 'jedzenie', 'die Fertiggerichte',
   null, null, 'ˈfɛʁtɪçɡəˌʁɪçt'),

  ('Lieferdienst', 'der Lieferdienst', 'der', 'noun', 'm',
   'dostawa do domu, firma dowożąca jedzenie',
   'Lieferdienste sind heute beliebter denn je.',
   'Dostawy jedzenia są dziś popularniejsze niż kiedykolwiek.',
   'B1', 'Story: Esskultur', 'jedzenie', 'die Lieferdienste',
   null, null, 'ˈliːfɐˌdiːnst'),

  -- Patrz nota o poprawce w nagłówku: hasła brakowało od pierwszego seedu.
  ('sehen', 'sehen', null, 'verb', null,
   'widzieć, patrzeć',
   'Das wird auch kritisch gesehen.',
   'Bywa to też oceniane krytycznie (dosł. widziane krytycznie).',
   'A1', 'Story: Esskultur', null, null,
   'haben', array['schauen', 'blicken'], 'ˈzeːən'),

  ('letzte', 'letzte', null, 'other', null,
   'ostatni; miniony',
   'Die Esskultur hat sich in den letzten Jahrzehnten stark verändert.',
   'Kultura jedzenia bardzo się zmieniła w ostatnich dziesięcioleciach.',
   'A2', 'Story: Esskultur', null, null,
   null, null, 'ˈlɛt͡stə'),

  ('stark', 'stark', null, 'other', null,
   'silny; mocno, bardzo',
   'Die Esskultur hat sich stark verändert.',
   'Kultura jedzenia bardzo się zmieniła.',
   'A2', 'Story: Esskultur', null, null,
   null, array['kräftig', 'sehr'], 'ʃtaʁk'),

  ('beliebt', 'beliebt', null, 'other', null,
   'lubiany, popularny',
   'Lieferdienste sind beliebter denn je.',
   'Dostawy jedzenia są popularniejsze niż kiedykolwiek.',
   'B1', 'Story: Esskultur', null, null,
   null, array['populär'], 'bəˈliːpt'),

  -- Dwuliterowe: `baseFormCandidates` zwraca [] dla tokenów krótszych niż 3
  -- znaki, ale `matchToken` sprawdza NAJPIERW samą formę powierzchniową, więc
  -- to hasło i tak jest osiągalne.
  ('je', 'je', null, 'other', null,
   'kiedykolwiek; (denn je) niż kiedykolwiek',
   'Fertiggerichte sind beliebter denn je.',
   'Dania gotowe są popularniejsze niż kiedykolwiek.',
   'B1', 'Story: Esskultur', null, null,
   null, null, 'jeː')
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
