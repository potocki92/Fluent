-- Fluent: słówka z dwóch tekstów — „Maria Skłodowska-Curie" (B1/B2)
-- oraz „Markus und seine App" (A1/A2).
-- Wygenerowane do wklejenia w Supabase SQL Editor.
--
-- IDEMPOTENTNE, tak jak seed-words-der-schluessel.sql. `public.words.id` nie
-- jest kolumną identity (patrz `createWord` w src/actions/admin-words.ts), więc
-- id liczymy tak samo: `max(id)` + numer wiersza. Wstawiane są WYŁĄCZNIE lematy,
-- których jeszcze nie ma w słowniku (porównanie po `lower(lemma)`), więc ponowne
-- uruchomienie nic nie duplikuje i nie nadpisuje ręcznych poprawek redaktora.
--
-- Rewizja słownika (`dictionary_revision`) podbija się sama — statement-level
-- trigger `words_bump_dictionary_revision` na `public.words`.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- CO ZOSTAŁO ODSIANE PRZED WYGENEROWANIEM TEJ LISTY
-- ─────────────────────────────────────────────────────────────────────────────
-- Lista była porównana z trzema źródłami, a nie tylko z guardem w SQL:
--
--  1. Lematy, do których odwołuje się supabase/seed-texts-40.sql (298 haseł) —
--     stąd NIE MA tu m.in.: Arbeit, Leben, Studium, App, Problem, Zeit, Tag,
--     Stunde, Abend, Farbe, Freund, blau, planen, machen, helfen, arbeiten,
--     trinken, bleiben, freuen, möchten, erfolgreich.
--  2. supabase/seed-words-der-schluessel.sql — stąd nie ma Morgen, Kaffee,
--     Frühstück, Fenster, Werkstatt.
--  3. `GERMAN_FUNCTION_WORDS` w src/lib/german-morphology.ts: als, auch, nach,
--     mit, für, aber, sehr, immer, kann, soll, wollen, da. UWAGA na powód:
--     `matchToken` rozwiązuje je normalnie, jak każdy inny token — ta lista NIE
--     blokuje dopasowania. Steruje tylko prezentacją (atrybut
--     `data-function-word` w ReaderProse wycisza podkreślenie) oraz tym, czy
--     niedopasowany token trafia do `unmatched_sample` jako luka do
--     uzupełnienia. Pomijam je, bo słownik DTZ i tak je ma.
--     (`dürfen` NIE jest na tej liście, dlatego zostaje jako pełne hasło.)
--
-- Świadomie pominięte poza tym:
--  * nazwy własne i symbole: Warschau, Paris, Berlin, Pierre Curie, Polonium,
--    Radium, Nobelpreis zostaje (to rzeczownik pospolity w słownikach DTZ);
--  * czasownik `leben` — słownik ma już rzeczownik `Leben`, a
--    `dictionaryKeysFor` sprowadza oba do tego samego klucza `leben`;
--    przy kolizji wygrywa wpis o NIŻSZYM id, więc druga pozycja byłaby
--    nierozwiązywalna dla `matchToken`. Znaczenie czasownikowe należy dopisać
--    do istniejącego hasła `Leben`, nie zakładać drugiego. To samo dotyczy pary
--    `Wissen` (dodane niżej) i czasownika `wissen`: jeden klucz, jedno hasło;
--  * `mnemonic` — to pole pisze redaktor przez `saveMnemonic`, nie seed.

with incoming (
  lemma, display, article, word_type, gender,
  translation_pl, example_de, example_pl,
  cefr, source, topic, plural, aux, synonyms, ipa
) as (
  values
  -- ═══════════════════════════════════════════════════════════════════════════
  -- TEKST 1 — Maria Skłodowska-Curie
  -- ═══════════════════════════════════════════════════════════════════════════

  -- ── Rzeczowniki ───────────────────────────────────────────────────────────
  ('Wissenschaftlerin'::text, 'die Wissenschaftlerin'::text, 'die'::text, 'noun'::text, 'f'::text,
   'naukowczyni, uczona'::text,
   'Sie war eine außergewöhnliche Wissenschaftlerin.'::text,
   'Była niezwykłą naukowczynią.'::text,
   'B1'::text, 'Story: Maria Skłodowska-Curie'::text, 'edukacja'::text, 'die Wissenschaftlerinnen'::text,
   null::text, array['die Forscherin']::text[], 'ˈvɪsn̩ʃaftləʁɪn'::text),

  ('Wissenschaftler', 'der Wissenschaftler', 'der', 'noun', 'm',
   'naukowiec, uczony',
   'Viele Wissenschaftler arbeiteten damals an der Radioaktivität.',
   'Wielu naukowców pracowało wtedy nad radioaktywnością.',
   'B1', 'Story: Maria Skłodowska-Curie', 'edukacja', 'die Wissenschaftler',
   null, array['der Forscher'], 'ˈvɪsn̩ʃaftlɐ'),

  ('Physik', 'die Physik', 'die', 'noun', 'f',
   'fizyka',
   'Sie prägte die Physik und die Chemie maßgeblich.',
   'Znacząco ukształtowała fizykę i chemię.',
   'A2', 'Story: Maria Skłodowska-Curie', 'edukacja', null,
   null, null, 'fyˈziːk'),

  ('Chemie', 'die Chemie', 'die', 'noun', 'f',
   'chemia',
   'In Chemie hatte sie immer die besten Noten.',
   'Z chemii zawsze miała najlepsze oceny.',
   'A2', 'Story: Maria Skłodowska-Curie', 'edukacja', null,
   null, null, 'çeˈmiː'),

  ('Universität', 'die Universität', 'die', 'noun', 'f',
   'uniwersytet',
   'Frauen durften damals in Polen nicht an Universitäten studieren.',
   'Kobiety nie mogły wtedy w Polsce studiować na uniwersytetach.',
   'A2', 'Story: Maria Skłodowska-Curie', 'edukacja', 'die Universitäten',
   null, array['die Hochschule'], 'ˌunivɛʁziˈtɛːt'),

  ('Frau', 'die Frau', 'die', 'noun', 'f',
   'kobieta; żona; pani',
   'Sie erhielt als erste Frau einen Nobelpreis.',
   'Jako pierwsza kobieta otrzymała Nagrodę Nobla.',
   'A1', 'Story: Maria Skłodowska-Curie', 'rodzina', 'die Frauen',
   null, null, 'fʁaʊ̯'),

  ('Ehemann', 'der Ehemann', 'der', 'noun', 'm',
   'mąż',
   'Gemeinsam mit ihrem Ehemann entdeckte sie zwei Elemente.',
   'Wspólnie z mężem odkryła dwa pierwiastki.',
   'A2', 'Story: Maria Skłodowska-Curie', 'rodzina', 'die Ehemänner',
   null, array['der Mann', 'der Gatte'], 'ˈeːəman'),

  ('Element', 'das Element', 'das', 'noun', 'n',
   'pierwiastek; element',
   'Sie entdeckte die chemischen Elemente Polonium und Radium.',
   'Odkryła pierwiastki chemiczne polon i rad.',
   'B1', 'Story: Maria Skłodowska-Curie', 'edukacja', 'die Elemente',
   null, null, 'eleˈmɛnt'),

  ('Gebiet', 'das Gebiet', 'das', 'noun', 'n',
   'dziedzina; obszar, teren',
   'Für ihre Arbeit auf dem Gebiet der Radioaktivität erhielt sie einen Preis.',
   'Za pracę w dziedzinie radioaktywności otrzymała nagrodę.',
   'B1', 'Story: Maria Skłodowska-Curie', 'praca', 'die Gebiete',
   null, array['der Bereich', 'die Region'], 'ɡəˈbiːt'),

  ('Radioaktivität', 'die Radioaktivität', 'die', 'noun', 'f',
   'radioaktywność, promieniotwórczość',
   'Ihre Arbeit auf dem Gebiet der Radioaktivität war bahnbrechend.',
   'Jej praca w dziedzinie radioaktywności była przełomowa.',
   'B2', 'Story: Maria Skłodowska-Curie', 'edukacja', null,
   null, null, 'ˌʁaːdioʔaktiviˈtɛːt'),

  ('Nobelpreis', 'der Nobelpreis', 'der', 'noun', 'm',
   'Nagroda Nobla',
   'Sie gewann Nobelpreise in zwei verschiedenen Disziplinen.',
   'Zdobyła Nagrody Nobla w dwóch różnych dyscyplinach.',
   'B1', 'Story: Maria Skłodowska-Curie', 'edukacja', 'die Nobelpreise',
   null, null, 'noˈbɛlpʁaɪ̯s'),

  ('Person', 'die Person', 'die', 'noun', 'f',
   'osoba',
   'Sie bleibt bis heute die einzige Person mit zwei solchen Preisen.',
   'Do dziś pozostaje jedyną osobą z dwiema takimi nagrodami.',
   'A2', 'Story: Maria Skłodowska-Curie', 'urzad', 'die Personen',
   null, null, 'pɛʁˈzoːn'),

  ('Disziplin', 'die Disziplin', 'die', 'noun', 'f',
   'dyscyplina, dziedzina nauki',
   'Sie gewann Nobelpreise in zwei wissenschaftlichen Disziplinen.',
   'Zdobyła Nagrody Nobla w dwóch dyscyplinach naukowych.',
   'B2', 'Story: Maria Skłodowska-Curie', 'edukacja', 'die Disziplinen',
   null, array['das Fach'], 'dɪst͡siˈpliːn'),

  ('Neugier', 'die Neugier', 'die', 'noun', 'f',
   'ciekawość',
   'Ihr Leben war von harter Arbeit und Neugier geprägt.',
   'Jej życie naznaczone było ciężką pracą i ciekawością.',
   'B2', 'Story: Maria Skłodowska-Curie', null, null,
   null, array['die Wissbegierde'], 'ˈnɔʏ̯ɡiːɐ̯'),

  ('Streben', 'das Streben', 'das', 'noun', 'n',
   'dążenie, pęd (do czegoś)',
   'Das unermüdliche Streben nach neuem Wissen trieb sie an.',
   'Niestrudzone dążenie do nowej wiedzy napędzało ją.',
   'B2', 'Story: Maria Skłodowska-Curie', null, null,
   null, null, 'ˈʃtʁeːbn̩'),

  ('Wissen', 'das Wissen', 'das', 'noun', 'n',
   'wiedza',
   'Sie strebte unermüdlich nach neuem Wissen.',
   'Niestrudzenie dążyła do nowej wiedzy.',
   'B1', 'Story: Maria Skłodowska-Curie', 'edukacja', null,
   null, array['die Kenntnis'], 'ˈvɪsn̩'),

  -- ── Czasowniki ────────────────────────────────────────────────────────────
  ('prägen', 'prägen', null, 'verb', null,
   'kształtować, odcisnąć piętno na czymś',
   'Sie prägte die Physik und die Chemie maßgeblich.',
   'Znacząco ukształtowała fizykę i chemię.',
   'B2', 'Story: Maria Skłodowska-Curie', null, null,
   'haben', array['beeinflussen', 'formen'], 'ˈpʁɛːɡn̩'),

  ('studieren', 'studieren', null, 'verb', null,
   'studiować',
   'Sie zog nach Paris, um dort zu studieren.',
   'Przeniosła się do Paryża, żeby tam studiować.',
   'A2', 'Story: Maria Skłodowska-Curie', 'edukacja', null,
   'haben', null, 'ʃtuˈdiːʁən'),

  ('dürfen', 'dürfen', null, 'verb', null,
   'móc, mieć pozwolenie',
   'Frauen durften in Polen nicht an Universitäten studieren.',
   'Kobiety nie mogły w Polsce studiować na uniwersytetach.',
   'A1', 'Story: Maria Skłodowska-Curie', null, null,
   'haben', null, 'ˈdʏʁfn̩'),

  ('entdecken', 'entdecken', null, 'verb', null,
   'odkryć',
   'Gemeinsam entdeckten sie Polonium und Radium.',
   'Wspólnie odkryli polon i rad.',
   'B1', 'Story: Maria Skłodowska-Curie', null, null,
   'haben', array['finden', 'herausfinden'], 'ɛntˈdɛkn̩'),

  ('erhalten', 'erhalten', null, 'verb', null,
   'otrzymać, dostać',
   'Sie erhielt als erste Frau einen Nobelpreis.',
   'Jako pierwsza kobieta otrzymała Nagrodę Nobla.',
   'B1', 'Story: Maria Skłodowska-Curie', 'urzad', null,
   'haben', array['bekommen', 'kriegen'], 'ɛɐ̯ˈhaltn̩'),

  ('gewinnen', 'gewinnen', null, 'verb', null,
   'wygrać, zdobyć',
   'Sie gewann Nobelpreise in zwei Disziplinen.',
   'Zdobyła Nagrody Nobla w dwóch dyscyplinach.',
   'B1', 'Story: Maria Skłodowska-Curie', 'czas-wolny', null,
   'haben', null, 'ɡəˈvɪnən'),

  -- ── Pozostałe ─────────────────────────────────────────────────────────────
  ('außergewöhnlich', 'außergewöhnlich', null, 'other', null,
   'niezwykły, wyjątkowy',
   'Sie war eine außergewöhnliche Wissenschaftlerin.',
   'Była niezwykłą naukowczynią.',
   'B2', 'Story: Maria Skłodowska-Curie', null, null,
   null, array['ungewöhnlich', 'besonders'], 'ˈaʊ̯sɐɡəˌvøːnlɪç'),

  ('maßgeblich', 'maßgeblich', null, 'other', null,
   'znacząco, decydująco; miarodajny',
   'Sie prägte die Physik maßgeblich.',
   'Znacząco ukształtowała fizykę.',
   'B2', 'Story: Maria Skłodowska-Curie', null, null,
   null, array['entscheidend', 'wesentlich'], 'ˈmaːsˌɡeːplɪç'),

  ('geboren', 'geboren', null, 'other', null,
   'urodzony (sie wurde geboren – urodziła się)',
   'Sie wurde 1867 in Warschau geboren.',
   'Urodziła się w 1867 roku w Warszawie.',
   'A2', 'Story: Maria Skłodowska-Curie', 'rodzina', null,
   null, null, 'ɡəˈboːʁən'),

  ('später', 'später', null, 'other', null,
   'później, potem',
   'Später zog sie für ihr Studium nach Paris.',
   'Później przeniosła się do Paryża na studia.',
   'A2', 'Story: Maria Skłodowska-Curie', null, null,
   null, null, 'ˈʃpɛːtɐ'),

  ('jedoch', 'jedoch', null, 'other', null,
   'jednak, jednakże',
   'Sie zog jedoch später nach Paris.',
   'Później jednak przeniosła się do Paryża.',
   'B1', 'Story: Maria Skłodowska-Curie', null, null,
   null, array['allerdings', 'dennoch'], 'jeˈdɔx'),

  ('gemeinsam', 'gemeinsam', null, 'other', null,
   'wspólnie, razem; wspólny',
   'Gemeinsam mit ihrem Ehemann entdeckte sie das Radium.',
   'Wspólnie z mężem odkryła rad.',
   'B1', 'Story: Maria Skłodowska-Curie', null, null,
   null, array['zusammen'], 'ɡəˈmaɪ̯nzaːm'),

  ('chemisch', 'chemisch', null, 'other', null,
   'chemiczny',
   'Sie entdeckte die chemischen Elemente Polonium und Radium.',
   'Odkryła pierwiastki chemiczne polon i rad.',
   'B1', 'Story: Maria Skłodowska-Curie', 'edukacja', null,
   null, null, 'ˈçeːmɪʃ'),

  ('bahnbrechend', 'bahnbrechend', null, 'other', null,
   'przełomowy, pionierski',
   'Für ihre bahnbrechende Arbeit erhielt sie einen Nobelpreis.',
   'Za swoją przełomową pracę otrzymała Nagrodę Nobla.',
   'B2', 'Story: Maria Skłodowska-Curie', null, null,
   null, array['wegweisend'], 'ˈbaːnˌbʁɛçn̩t'),

  ('erste', 'erste', null, 'other', null,
   'pierwszy',
   'Sie erhielt als erste Frau einen Nobelpreis.',
   'Jako pierwsza kobieta otrzymała Nagrodę Nobla.',
   'A1', 'Story: Maria Skłodowska-Curie', null, null,
   null, null, 'ˈeːɐ̯stə'),

  ('einzig', 'einzig', null, 'other', null,
   'jedyny',
   'Sie bleibt bis heute die einzige Person mit diesem Rekord.',
   'Do dziś pozostaje jedyną osobą z tym rekordem.',
   'B1', 'Story: Maria Skłodowska-Curie', null, null,
   null, null, 'ˈaɪ̯nt͡sɪç'),

  ('verschieden', 'verschieden', null, 'other', null,
   'różny, rozmaity',
   'Sie gewann Preise in zwei verschiedenen Disziplinen.',
   'Zdobyła nagrody w dwóch różnych dyscyplinach.',
   'B1', 'Story: Maria Skłodowska-Curie', null, null,
   null, array['unterschiedlich'], 'fɛɐ̯ˈʃiːdn̩'),

  ('wissenschaftlich', 'wissenschaftlich', null, 'other', null,
   'naukowy',
   'Sie arbeitete in zwei wissenschaftlichen Disziplinen.',
   'Pracowała w dwóch dyscyplinach naukowych.',
   'B2', 'Story: Maria Skłodowska-Curie', 'edukacja', null,
   null, null, 'ˈvɪsn̩ʃaftlɪç'),

  ('hart', 'hart', null, 'other', null,
   'ciężki, twardy; surowy',
   'Ihr Leben war von harter Arbeit geprägt.',
   'Jej życie naznaczone było ciężką pracą.',
   'B1', 'Story: Maria Skłodowska-Curie', 'praca', null,
   null, null, 'haʁt'),

  ('unermüdlich', 'unermüdlich', null, 'other', null,
   'niestrudzony, niezmordowany',
   'Ihr unermüdliches Streben nach Wissen war bekannt.',
   'Jej niestrudzone dążenie do wiedzy było znane.',
   'B2', 'Story: Maria Skłodowska-Curie', null, null,
   null, null, 'ʊnʔɛɐ̯ˈmyːtlɪç'),

  ('neu', 'neu', null, 'other', null,
   'nowy',
   'Sie strebte nach neuem Wissen.',
   'Dążyła do nowej wiedzy.',
   'A1', 'Story: Maria Skłodowska-Curie', null, null,
   null, null, 'nɔʏ̯'),

  ('heute', 'heute', null, 'other', null,
   'dziś, dzisiaj',
   'Sie bleibt bis heute die einzige Person mit diesem Rekord.',
   'Do dziś pozostaje jedyną osobą z tym rekordem.',
   'A1', 'Story: Maria Skłodowska-Curie', null, null,
   null, null, 'ˈhɔʏ̯tə'),

  -- ═══════════════════════════════════════════════════════════════════════════
  -- TEKST 2 — Markus und seine App
  -- ═══════════════════════════════════════════════════════════════════════════

  -- ── Rzeczowniki ───────────────────────────────────────────────────────────
  ('Programmierer', 'der Programmierer', 'der', 'noun', 'm',
   'programista',
   'Markus ist jung und arbeitet als Programmierer.',
   'Markus jest młody i pracuje jako programista.',
   'A2', 'Story: Markus und seine App', 'praca', 'die Programmierer',
   null, array['der Entwickler'], 'pʁoɡʁaˈmiːʁɐ'),

  ('Computer', 'der Computer', 'der', 'noun', 'm',
   'komputer',
   'Er arbeitet jeden Tag am Computer.',
   'Codziennie pracuje przy komputerze.',
   'A1', 'Story: Markus und seine App', 'praca', 'die Computer',
   null, array['der Rechner'], 'kɔmˈpjuːtɐ'),

  ('Idee', 'die Idee', 'die', 'noun', 'f',
   'pomysł, idea',
   'Markus hat eine Idee für eine neue App.',
   'Markus ma pomysł na nową aplikację.',
   'A2', 'Story: Markus und seine App', 'praca', 'die Ideen',
   null, array['der Einfall'], 'iˈdeː'),

  ('Mensch', 'der Mensch', 'der', 'noun', 'm',
   'człowiek',
   'Die App soll Menschen helfen.',
   'Aplikacja ma pomagać ludziom.',
   'A1', 'Story: Markus und seine App', 'rodzina', 'die Menschen',
   null, array['die Person'], 'mɛnʃ'),

  ('Termin', 'der Termin', 'der', 'noun', 'm',
   'termin, umówione spotkanie, wizyta',
   'Viele Menschen vergessen oft ihre Termine.',
   'Wiele osób często zapomina o swoich terminach.',
   'A2', 'Story: Markus und seine App', 'urzad', 'die Termine',
   null, array['die Verabredung'], 'tɛʁˈmiːn'),

  ('Code', 'der Code', 'der', 'noun', 'm',
   'kod (programu)',
   'Er schreibt einfachen Code und macht kleine Tests.',
   'Pisze prosty kod i robi małe testy.',
   'A2', 'Story: Markus und seine App', 'praca', 'die Codes',
   null, array['der Quellcode'], 'koːt'),

  ('Test', 'der Test', 'der', 'noun', 'm',
   'test, sprawdzian',
   'Er macht jeden Tag kleine Tests.',
   'Codziennie robi małe testy.',
   'A2', 'Story: Markus und seine App', 'praca', 'die Tests',
   null, array['die Prüfung'], 'tɛst'),

  ('Design', 'das Design', 'das', 'noun', 'n',
   'projekt, wygląd, design',
   'Zuerst malt Markus das Design der App auf Papier.',
   'Najpierw Markus rysuje wygląd aplikacji na papierze.',
   'B1', 'Story: Markus und seine App', 'praca', 'die Designs',
   null, array['die Gestaltung'], 'diˈzaɪ̯n'),

  ('Papier', 'das Papier', 'das', 'noun', 'n',
   'papier',
   'Er malt das Design zuerst auf Papier.',
   'Wygląd rysuje najpierw na papierze.',
   'A1', 'Story: Markus und seine App', 'edukacja', 'die Papiere',
   null, null, 'paˈpiːɐ̯'),

  ('Ding', 'das Ding', 'das', 'noun', 'n',
   'rzecz',
   'Man kann Termine schreiben und wichtige Dinge planen.',
   'Można zapisywać terminy i planować ważne rzeczy.',
   'A2', 'Story: Markus und seine App', null, 'die Dinge',
   null, array['die Sache'], 'dɪŋ'),

  ('Monat', 'der Monat', 'der', 'noun', 'm',
   'miesiąc',
   'Nach einigen Monaten ist die App fertig.',
   'Po kilku miesiącach aplikacja jest gotowa.',
   'A1', 'Story: Markus und seine App', null, 'die Monate',
   null, null, 'ˈmoːnat'),

  ('Erfolg', 'der Erfolg', 'der', 'noun', 'm',
   'sukces, powodzenie',
   'Markus freut sich sehr über seinen Erfolg.',
   'Markus bardzo cieszy się ze swojego sukcesu.',
   'B1', 'Story: Markus und seine App', 'praca', 'die Erfolge',
   null, null, 'ɛɐ̯ˈfɔlk'),

  -- ── Czasowniki ────────────────────────────────────────────────────────────
  ('vergessen', 'vergessen', null, 'verb', null,
   'zapomnieć',
   'Viele Menschen vergessen oft ihre Termine.',
   'Wiele osób często zapomina o swoich terminach.',
   'A2', 'Story: Markus und seine App', null, null,
   'haben', null, 'fɛɐ̯ˈɡɛsn̩'),

  ('lösen', 'lösen', null, 'verb', null,
   'rozwiązać (problem); rozpuścić',
   'Markus möchte das Problem lösen.',
   'Markus chce rozwiązać ten problem.',
   'B1', 'Story: Markus und seine App', null, null,
   'haben', null, 'ˈløːzn̩'),

  ('sitzen', 'sitzen', null, 'verb', null,
   'siedzieć',
   'Er sitzt viele Stunden am Computer.',
   'Siedzi wiele godzin przy komputerze.',
   'A1', 'Story: Markus und seine App', null, null,
   'haben', null, 'ˈzɪt͡sn̩'),

  ('schreiben', 'schreiben', null, 'verb', null,
   'pisać',
   'Er schreibt einfachen Code.',
   'Pisze prosty kod.',
   'A1', 'Story: Markus und seine App', 'edukacja', null,
   'haben', null, 'ˈʃʁaɪ̯bn̩'),

  ('weitermachen', 'weitermachen', null, 'verb', null,
   'kontynuować, robić dalej',
   'Das ist nicht immer leicht, aber Markus macht weiter.',
   'Nie zawsze jest to łatwe, ale Markus robi dalej.',
   'B1', 'Story: Markus und seine App', null, null,
   'haben', array['fortsetzen'], 'ˈvaɪ̯tɐˌmaxn̩'),

  ('malen', 'malen', null, 'verb', null,
   'malować, rysować',
   'Zuerst malt Markus das Design auf Papier.',
   'Najpierw Markus rysuje projekt na papierze.',
   'A2', 'Story: Markus und seine App', 'czas-wolny', null,
   'haben', array['zeichnen'], 'ˈmaːlən'),

  ('zeigen', 'zeigen', null, 'verb', null,
   'pokazywać',
   'Markus zeigt die App seinen Freunden.',
   'Markus pokazuje aplikację swoim przyjaciołom.',
   'A2', 'Story: Markus und seine App', null, null,
   'haben', null, 'ˈt͡saɪ̯ɡn̩'),

  ('finden', 'finden', null, 'verb', null,
   'znaleźć; uważać, sądzić',
   'Seine Freunde finden die App sehr gut.',
   'Jego przyjaciele uważają aplikację za bardzo dobrą.',
   'A2', 'Story: Markus und seine App', null, null,
   'haben', array['entdecken', 'meinen'], 'ˈfɪndn̩'),

  ('benutzen', 'benutzen', null, 'verb', null,
   'używać, korzystać z czegoś',
   'Heute benutzen viele Menschen die App jeden Tag.',
   'Dziś wiele osób używa tej aplikacji codziennie.',
   'A2', 'Story: Markus und seine App', null, null,
   'haben', array['verwenden', 'nutzen'], 'bəˈnʊt͡sn̩'),

  -- ── Pozostałe ─────────────────────────────────────────────────────────────
  ('jung', 'jung', null, 'other', null,
   'młody',
   'Markus ist jung und arbeitet als Programmierer.',
   'Markus jest młody i pracuje jako programista.',
   'A1', 'Story: Markus und seine App', null, null,
   null, null, 'jʊŋ'),

  ('viel', 'viel', null, 'other', null,
   'dużo, wiele',
   'Viele Menschen haben wenig Zeit.',
   'Wiele osób ma mało czasu.',
   'A1', 'Story: Markus und seine App', null, null,
   null, null, 'fiːl'),

  ('wenig', 'wenig', null, 'other', null,
   'mało, niewiele',
   'Viele Menschen haben wenig Zeit.',
   'Wiele osób ma mało czasu.',
   'A1', 'Story: Markus und seine App', null, null,
   null, null, 'ˈveːnɪç'),

  ('oft', 'oft', null, 'other', null,
   'często',
   'Sie vergessen oft ihre Termine.',
   'Często zapominają o swoich terminach.',
   'A1', 'Story: Markus und seine App', null, null,
   null, array['häufig'], 'ɔft'),

  ('manchmal', 'manchmal', null, 'other', null,
   'czasami',
   'Manchmal arbeitet er auch am Abend.',
   'Czasami pracuje też wieczorem.',
   'A2', 'Story: Markus und seine App', null, null,
   null, null, 'ˈmançmaːl'),

  ('einfach', 'einfach', null, 'other', null,
   'prosty, łatwy; po prostu',
   'Die App ist einfach und übersichtlich.',
   'Aplikacja jest prosta i przejrzysta.',
   'A2', 'Story: Markus und seine App', null, null,
   null, array['leicht', 'simpel'], 'ˈaɪ̯nfax'),

  ('klein', 'klein', null, 'other', null,
   'mały',
   'Er macht jeden Tag kleine Tests.',
   'Codziennie robi małe testy.',
   'A1', 'Story: Markus und seine App', null, null,
   null, null, 'klaɪ̯n'),

  ('leicht', 'leicht', null, 'other', null,
   'łatwy; lekki',
   'Das ist nicht immer leicht.',
   'Nie zawsze jest to łatwe.',
   'A2', 'Story: Markus und seine App', null, null,
   null, array['einfach'], 'laɪ̯çt'),

  ('zuerst', 'zuerst', null, 'other', null,
   'najpierw',
   'Zuerst malt Markus das Design auf Papier.',
   'Najpierw Markus rysuje projekt na papierze.',
   'A2', 'Story: Markus und seine App', null, null,
   null, null, 't͡suˈʔeːɐ̯st'),

  ('danach', 'danach', null, 'other', null,
   'potem, następnie',
   'Danach arbeitet er am Computer.',
   'Potem pracuje przy komputerze.',
   'A2', 'Story: Markus und seine App', null, null,
   null, array['anschließend'], 'daˈnaːx'),

  ('übersichtlich', 'übersichtlich', null, 'other', null,
   'przejrzysty, czytelny',
   'Die App ist einfach und übersichtlich.',
   'Aplikacja jest prosta i przejrzysta.',
   'B1', 'Story: Markus und seine App', null, null,
   null, array['klar', 'strukturiert'], 'ˈyːbɐˌzɪçtlɪç'),

  ('wichtig', 'wichtig', null, 'other', null,
   'ważny',
   'Man kann wichtige Dinge planen.',
   'Można planować ważne rzeczy.',
   'A1', 'Story: Markus und seine App', null, null,
   null, array['bedeutend'], 'ˈvɪçtɪç'),

  -- HOMOGRAF, i to taki, który `IRREGULAR_VERB_FORMS` już zna: `weiß` to zarówno
  -- kolor, jak i forma `wissen`. `matchToken` próbuje najpierw formy
  -- powierzchniowej, więc w czytniku wygra to hasło — dlatego oba znaczenia
  -- muszą być w nim opisane, inaczej „ich weiß" dostanie gloss „biały".
  ('weiß', 'weiß', null, 'other', null,
   'biały; (ich weiß) wiem – forma czasownika wissen',
   'Die Farben sind blau und weiß.',
   'Kolory to niebieski i biały.',
   'A1', 'Story: Markus und seine App', null, null,
   null, null, 'vaɪ̯s'),

  ('einige', 'einige', null, 'other', null,
   'kilka, niektóre',
   'Nach einigen Monaten ist die App fertig.',
   'Po kilku miesiącach aplikacja jest gotowa.',
   'A2', 'Story: Markus und seine App', null, null,
   null, array['mehrere'], 'ˈaɪ̯nɪɡə'),

  ('fertig', 'fertig', null, 'other', null,
   'gotowy, skończony',
   'Nach einigen Monaten ist die App fertig.',
   'Po kilku miesiącach aplikacja jest gotowa.',
   'A2', 'Story: Markus und seine App', null, null,
   null, null, 'ˈfɛʁtɪç'),

  ('gut', 'gut', null, 'other', null,
   'dobry, dobrze',
   'Seine Freunde finden die App sehr gut.',
   'Jego przyjaciele uważają aplikację za bardzo dobrą.',
   'A1', 'Story: Markus und seine App', null, null,
   null, null, 'ɡuːt'),

  ('praktisch', 'praktisch', null, 'other', null,
   'praktyczny, wygodny',
   '„Die App ist einfach und praktisch!"',
   '„Aplikacja jest prosta i praktyczna!"',
   'A2', 'Story: Markus und seine App', null, null,
   null, array['nützlich'], 'ˈpʁaktɪʃ'),

  ('glücklich', 'glücklich', null, 'other', null,
   'szczęśliwy',
   'Markus ist glücklich.',
   'Markus jest szczęśliwy.',
   'A2', 'Story: Markus und seine App', 'zdrowie', null,
   null, array['froh', 'zufrieden'], 'ˈɡlʏklɪç')
),

-- Tylko lematy, których słownik jeszcze nie zna. Porównanie po `lower()`, bo
-- rzeczowniki zapisujemy wielką literą, a czasowniki i przymiotniki małą.
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
