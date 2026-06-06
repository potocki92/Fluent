-- Fluent: 40 czytanek (A1–B2) z pytaniami zrozumienia.
-- Wygenerowane do wklejenia w Supabase SQL Editor.
-- Idempotentne: ponowne uruchomienie nie tworzy duplikatów (guard po title).
-- difficulty tekstu = kotwica CEFR (src/lib/cefr.ts); difficulty pytań = easy/medium/hard (±100).

-- Mein Morgen (A1, 29 słów, 3 pytań)
with t as (
  insert into public.texts (title, cefr, body, word_count, difficulty, status)
  select 'Mein Morgen', 'A1', 'Ich <mark data-lemma="aufstehen">stehe</mark> um sieben Uhr <mark data-lemma="aufstehen">auf</mark>. Zuerst <mark data-lemma="trinken">trinke</mark> ich einen <mark data-lemma="Tee">Tee</mark>. Dann <mark data-lemma="duschen">dusche</mark> ich und <mark data-lemma="anziehen">ziehe</mark> mich <mark data-lemma="anziehen">an</mark>. Um acht Uhr <mark data-lemma="gehen">gehe</mark> ich zur <mark data-lemma="Arbeit">Arbeit</mark>.', 29, 1100, 'published'
  where not exists (select 1 from public.texts where title = 'Mein Morgen')
  returning id
)
insert into public.questions (text_id, prompt, options, correct_idx, difficulty)
select t.id, q.prompt, q.options, q.correct_idx, q.difficulty
from t, (values
  ('O której autor wstaje?', array['O szóstej', 'O siódmej', 'O ósmej', 'O dziewiątej'], 1, 1000),
  ('Co pije najpierw?', array['Kawę', 'Wodę', 'Herbatę', 'Sok'], 2, 1100),
  ('Dokąd idzie o ósmej?', array['Do szkoły', 'Do pracy', 'Na zakupy', 'Do parku'], 1, 1200)
) as q(prompt, options, correct_idx, difficulty);

-- Auf dem Markt (A1, 26 słów, 4 pytań)
with t as (
  insert into public.texts (title, cefr, body, word_count, difficulty, status)
  select 'Auf dem Markt', 'A1', 'Am Samstag <mark data-lemma="gehen">gehe</mark> ich auf den <mark data-lemma="Markt">Markt</mark>. Ich <mark data-lemma="kaufen">kaufe</mark> <mark data-lemma="Tomate">Tomaten</mark>, <mark data-lemma="Käse">Käse</mark> und <mark data-lemma="Ei">Eier</mark>. Das <mark data-lemma="Obst">Obst</mark> ist heute <mark data-lemma="billig">billig</mark>. Ich bezahle zehn Euro.', 26, 1100, 'published'
  where not exists (select 1 from public.texts where title = 'Auf dem Markt')
  returning id
)
insert into public.questions (text_id, prompt, options, correct_idx, difficulty)
select t.id, q.prompt, q.options, q.correct_idx, q.difficulty
from t, (values
  ('Kiedy autor idzie na targ?', array['W piątek', 'W sobotę', 'W niedzielę', 'W środę'], 1, 1000),
  ('Czego NIE kupuje?', array['Pomidorów', 'Sera', 'Jajek', 'Chleba'], 3, 1100),
  ('Jakie jest dziś owoce w cenie?', array['Drogie', 'Tanie', 'Zepsute', 'Wyprzedane'], 1, 1200),
  ('Ile płaci autor?', array['Pięć euro', 'Dziesięć euro', 'Dwadzieścia euro', 'Jedno euro'], 1, 1100)
) as q(prompt, options, correct_idx, difficulty);

-- Mein Zimmer (A1, 29 słów, 3 pytań)
with t as (
  insert into public.texts (title, cefr, body, word_count, difficulty, status)
  select 'Mein Zimmer', 'A1', 'Mein <mark data-lemma="Zimmer">Zimmer</mark> ist klein, aber schön. Es gibt ein <mark data-lemma="Bett">Bett</mark>, einen <mark data-lemma="Tisch">Tisch</mark> und einen <mark data-lemma="Stuhl">Stuhl</mark>. Am <mark data-lemma="Fenster">Fenster</mark> steht eine grüne <mark data-lemma="Pflanze">Pflanze</mark>. Ich lese hier gern Bücher.', 29, 1100, 'published'
  where not exists (select 1 from public.texts where title = 'Mein Zimmer')
  returning id
)
insert into public.questions (text_id, prompt, options, correct_idx, difficulty)
select t.id, q.prompt, q.options, q.correct_idx, q.difficulty
from t, (values
  ('Jaki jest pokój?', array['Duży i ciemny', 'Mały, ale ładny', 'Brzydki', 'Pusty'], 1, 1000),
  ('Czego nie ma w pokoju?', array['Łóżka', 'Stołu', 'Szafy', 'Krzesła'], 2, 1100),
  ('Co stoi przy oknie?', array['Lampa', 'Roślina', 'Telewizor', 'Kot'], 1, 1200)
) as q(prompt, options, correct_idx, difficulty);

-- Meine Katze (A1, 24 słów, 3 pytań)
with t as (
  insert into public.texts (title, cefr, body, word_count, difficulty, status)
  select 'Meine Katze', 'A1', 'Ich habe eine <mark data-lemma="Katze">Katze</mark>. Sie <mark data-lemma="heißen">heißt</mark> Mimi. Mimi <mark data-lemma="schlafen">schläft</mark> viel und <mark data-lemma="spielen">spielt</mark> gern mit einem <mark data-lemma="Ball">Ball</mark>. Am <mark data-lemma="Abend">Abend</mark> <mark data-lemma="essen">frisst</mark> sie <mark data-lemma="Fisch">Fisch</mark>.', 24, 1100, 'published'
  where not exists (select 1 from public.texts where title = 'Meine Katze')
  returning id
)
insert into public.questions (text_id, prompt, options, correct_idx, difficulty)
select t.id, q.prompt, q.options, q.correct_idx, q.difficulty
from t, (values
  ('Jak ma na imię kot?', array['Mimi', 'Lulu', 'Max', 'Bella'], 0, 1000),
  ('Czym lubi się bawić?', array['Sznurkiem', 'Piłką', 'Myszką', 'Kością'], 1, 1100),
  ('Co je wieczorem?', array['Mięso', 'Rybę', 'Mleko', 'Chleb'], 1, 1200)
) as q(prompt, options, correct_idx, difficulty);

-- Am Wochenende (A1, 23 słów, 3 pytań)
with t as (
  insert into public.texts (title, cefr, body, word_count, difficulty, status)
  select 'Am Wochenende', 'A1', 'Am <mark data-lemma="Wochenende">Wochenende</mark> <mark data-lemma="schlafen">schlafe</mark> ich lange. Dann <mark data-lemma="treffen">treffe</mark> ich meine <mark data-lemma="Freund">Freunde</mark>. Wir <mark data-lemma="gehen">gehen</mark> ins <mark data-lemma="Kino">Kino</mark> oder in ein <mark data-lemma="Café">Café</mark>. Das macht Spaß.', 23, 1100, 'published'
  where not exists (select 1 from public.texts where title = 'Am Wochenende')
  returning id
)
insert into public.questions (text_id, prompt, options, correct_idx, difficulty)
select t.id, q.prompt, q.options, q.correct_idx, q.difficulty
from t, (values
  ('Jak autor zaczyna weekend?', array['Wcześnie wstaje', 'Długo śpi', 'Sprząta', 'Pracuje'], 1, 1000),
  ('Kogo spotyka?', array['Rodzinę', 'Przyjaciół', 'Sąsiadów', 'Kolegów z pracy'], 1, 1100),
  ('Dokąd chodzą?', array['Do teatru', 'Do kina lub kawiarni', 'Na basen', 'Do muzeum'], 1, 1200)
) as q(prompt, options, correct_idx, difficulty);

-- Neue Kleidung (A1, 25 słów, 3 pytań)
with t as (
  insert into public.texts (title, cefr, body, word_count, difficulty, status)
  select 'Neue Kleidung', 'A1', 'Heute <mark data-lemma="kaufen">kaufe</mark> ich neue <mark data-lemma="Kleidung">Kleidung</mark>. Ich <mark data-lemma="brauchen">brauche</mark> eine <mark data-lemma="Hose">Hose</mark> und ein <mark data-lemma="Hemd">Hemd</mark>. Die <mark data-lemma="Farbe">Farbe</mark> <mark data-lemma="blau">blau</mark> gefällt mir gut. Die Schuhe sind zu teuer.', 25, 1100, 'published'
  where not exists (select 1 from public.texts where title = 'Neue Kleidung')
  returning id
)
insert into public.questions (text_id, prompt, options, correct_idx, difficulty)
select t.id, q.prompt, q.options, q.correct_idx, q.difficulty
from t, (values
  ('Czego potrzebuje autor?', array['Kurtki i czapki', 'Spodni i koszuli', 'Sukienki', 'Płaszcza'], 1, 1000),
  ('Jaki kolor lubi?', array['Czerwony', 'Zielony', 'Niebieski', 'Czarny'], 2, 1100),
  ('Co jest za drogie?', array['Spodnie', 'Buty', 'Koszula', 'Czapka'], 1, 1200)
) as q(prompt, options, correct_idx, difficulty);

-- In der Schule (A1, 24 słów, 3 pytań)
with t as (
  insert into public.texts (title, cefr, body, word_count, difficulty, status)
  select 'In der Schule', 'A1', 'Lena <mark data-lemma="gehen">geht</mark> in die <mark data-lemma="Schule">Schule</mark>. Ihr <mark data-lemma="Lehrer">Lehrer</mark> <mark data-lemma="heißen">heißt</mark> Herr Wolf. Heute <mark data-lemma="lernen">lernen</mark> die Kinder <mark data-lemma="rechnen">rechnen</mark>. In der <mark data-lemma="Pause">Pause</mark> essen sie ein Brot.', 24, 1100, 'published'
  where not exists (select 1 from public.texts where title = 'In der Schule')
  returning id
)
insert into public.questions (text_id, prompt, options, correct_idx, difficulty)
select t.id, q.prompt, q.options, q.correct_idx, q.difficulty
from t, (values
  ('Jak nazywa się nauczyciel?', array['Pan Wolf', 'Pan Berg', 'Pan Klein', 'Pan Stein'], 0, 1000),
  ('Czego uczą się dzieci?', array['Czytania', 'Liczenia', 'Pisania', 'Śpiewu'], 1, 1100),
  ('Co robią na przerwie?', array['Grają', 'Jedzą chleb', 'Śpią', 'Czytają'], 1, 1200)
) as q(prompt, options, correct_idx, difficulty);

-- Wie spät ist es? (A1, 23 słów, 3 pytań)
with t as (
  insert into public.texts (title, cefr, body, word_count, difficulty, status)
  select 'Wie spät ist es?', 'A1', 'Es ist acht <mark data-lemma="Uhr">Uhr</mark>. Der <mark data-lemma="Bus">Bus</mark> <mark data-lemma="kommen">kommt</mark> bald. Ich habe nur zehn <mark data-lemma="Minute">Minuten</mark> <mark data-lemma="Zeit">Zeit</mark>. Schnell! Ich darf nicht zu <mark data-lemma="spät">spät</mark> kommen.', 23, 1100, 'published'
  where not exists (select 1 from public.texts where title = 'Wie spät ist es?')
  returning id
)
insert into public.questions (text_id, prompt, options, correct_idx, difficulty)
select t.id, q.prompt, q.options, q.correct_idx, q.difficulty
from t, (values
  ('Która jest godzina?', array['Siódma', 'Ósma', 'Dziewiąta', 'Dziesiąta'], 1, 1000),
  ('Co wkrótce przyjedzie?', array['Pociąg', 'Autobus', 'Tramwaj', 'Taksówka'], 1, 1100),
  ('Ile autor ma czasu?', array['Pięć minut', 'Dziesięć minut', 'Godzinę', 'Dwie minuty'], 1, 1200)
) as q(prompt, options, correct_idx, difficulty);

-- Der Weg zur Arbeit (A1, 22 słów, 3 pytań)
with t as (
  insert into public.texts (title, cefr, body, word_count, difficulty, status)
  select 'Der Weg zur Arbeit', 'A1', 'Jeden <mark data-lemma="Tag">Tag</mark> <mark data-lemma="fahren">fahre</mark> ich mit dem <mark data-lemma="Rad">Rad</mark> zur <mark data-lemma="Arbeit">Arbeit</mark>. Der <mark data-lemma="Weg">Weg</mark> ist nicht weit. Bei <mark data-lemma="Regen">Regen</mark> <mark data-lemma="nehmen">nehme</mark> ich den <mark data-lemma="Bus">Bus</mark>.', 22, 1100, 'published'
  where not exists (select 1 from public.texts where title = 'Der Weg zur Arbeit')
  returning id
)
insert into public.questions (text_id, prompt, options, correct_idx, difficulty)
select t.id, q.prompt, q.options, q.correct_idx, q.difficulty
from t, (values
  ('Czym autor jeździ do pracy?', array['Samochodem', 'Rowerem', 'Pieszo', 'Pociągiem'], 1, 1000),
  ('Jaka jest droga?', array['Daleka', 'Niedaleka', 'Niebezpieczna', 'Długa'], 1, 1100),
  ('Co robi, gdy pada deszcz?', array['Zostaje w domu', 'Jedzie autobusem', 'Idzie pieszo', 'Bierze taksówkę'], 1, 1200)
) as q(prompt, options, correct_idx, difficulty);

-- Ein Anruf (A1, 25 słów, 3 pytań)
with t as (
  insert into public.texts (title, cefr, body, word_count, difficulty, status)
  select 'Ein Anruf', 'A1', 'Das <mark data-lemma="Telefon">Telefon</mark> <mark data-lemma="klingeln">klingelt</mark>. Es ist meine <mark data-lemma="Freundin">Freundin</mark> Sara. Sie <mark data-lemma="fragen">fragt</mark>: „Hast du heute <mark data-lemma="Zeit">Zeit</mark>?" Ich <mark data-lemma="sagen">sage</mark> ja. Wir <mark data-lemma="treffen">treffen</mark> uns um vier.', 25, 1100, 'published'
  where not exists (select 1 from public.texts where title = 'Ein Anruf')
  returning id
)
insert into public.questions (text_id, prompt, options, correct_idx, difficulty)
select t.id, q.prompt, q.options, q.correct_idx, q.difficulty
from t, (values
  ('Kto dzwoni?', array['Mama', 'Sara', 'Szef', 'Brat'], 1, 1000),
  ('O co pyta Sara?', array['O pogodę', 'Czy autor ma czas', 'O adres', 'O pieniądze'], 1, 1100),
  ('O której się spotkają?', array['O trzeciej', 'O czwartej', 'O piątej', 'O szóstej'], 1, 1200)
) as q(prompt, options, correct_idx, difficulty);

-- Ein Zimmer reservieren (A2, 29 słów, 4 pytań)
with t as (
  insert into public.texts (title, cefr, body, word_count, difficulty, status)
  select 'Ein Zimmer reservieren', 'A2', 'Herr Lang <mark data-lemma="reservieren">reserviert</mark> ein <mark data-lemma="Zimmer">Zimmer</mark> im <mark data-lemma="Hotel">Hotel</mark>. Er <mark data-lemma="bleiben">bleibt</mark> drei <mark data-lemma="Nacht">Nächte</mark> in München. Das <mark data-lemma="Frühstück">Frühstück</mark> ist im Preis <mark data-lemma="enthalten">enthalten</mark>. An der <mark data-lemma="Rezeption">Rezeption</mark> bekommt er den <mark data-lemma="Schlüssel">Schlüssel</mark>.', 29, 1300, 'published'
  where not exists (select 1 from public.texts where title = 'Ein Zimmer reservieren')
  returning id
)
insert into public.questions (text_id, prompt, options, correct_idx, difficulty)
select t.id, q.prompt, q.options, q.correct_idx, q.difficulty
from t, (values
  ('Co rezerwuje pan Lang?', array['Stolik', 'Pokój w hotelu', 'Bilet', 'Samochód'], 1, 1200),
  ('Ile nocy zostaje?', array['Jedną', 'Dwie', 'Trzy', 'Cztery'], 2, 1300),
  ('Co jest wliczone w cenę?', array['Parking', 'Śniadanie', 'Obiad', 'Basen'], 1, 1400),
  ('Co dostaje w recepcji?', array['Mapę', 'Klucz', 'Ręcznik', 'Gazetę'], 1, 1300)
) as q(prompt, options, correct_idx, difficulty);

-- Auf der Post (A2, 33 słów, 4 pytań)
with t as (
  insert into public.texts (title, cefr, body, word_count, difficulty, status)
  select 'Auf der Post', 'A2', 'Frau Bauer <mark data-lemma="schicken">schickt</mark> ein <mark data-lemma="Paket">Paket</mark> an ihre <mark data-lemma="Tochter">Tochter</mark>. Sie <mark data-lemma="kaufen">kauft</mark> eine <mark data-lemma="Briefmarke">Briefmarke</mark> und <mark data-lemma="wiegen">wiegt</mark> das Paket. Es ist schwer, also <mark data-lemma="kosten">kostet</mark> der <mark data-lemma="Versand">Versand</mark> mehr. Das Paket <mark data-lemma="ankommen">kommt</mark> in zwei Tagen <mark data-lemma="ankommen">an</mark>.', 33, 1300, 'published'
  where not exists (select 1 from public.texts where title = 'Auf der Post')
  returning id
)
insert into public.questions (text_id, prompt, options, correct_idx, difficulty)
select t.id, q.prompt, q.options, q.correct_idx, q.difficulty
from t, (values
  ('Co wysyła pani Bauer?', array['List', 'Paczkę', 'Kartkę', 'Pieniądze'], 1, 1200),
  ('Do kogo wysyła?', array['Do syna', 'Do córki', 'Do siostry', 'Do męża'], 1, 1300),
  ('Dlaczego wysyłka kosztuje więcej?', array['Jest pilna', 'Paczka jest ciężka', 'Idzie za granicę', 'Jest krucha'], 1, 1400),
  ('Kiedy dojdzie paczka?', array['Za dzień', 'Za dwa dni', 'Za tydzień', 'Za godzinę'], 1, 1300)
) as q(prompt, options, correct_idx, difficulty);

-- Ein Geburtstag (A2, 27 słów, 4 pytań)
with t as (
  insert into public.texts (title, cefr, body, word_count, difficulty, status)
  select 'Ein Geburtstag', 'A2', 'Morgen <mark data-lemma="feiern">feiert</mark> Tom seinen <mark data-lemma="Geburtstag">Geburtstag</mark>. Er <mark data-lemma="einladen">lädt</mark> zehn <mark data-lemma="Gast">Gäste</mark> <mark data-lemma="einladen">ein</mark>. Seine Mutter <mark data-lemma="backen">backt</mark> einen <mark data-lemma="Kuchen">Kuchen</mark>. Tom <mark data-lemma="hoffen">hofft</mark> auf ein neues <mark data-lemma="Fahrrad">Fahrrad</mark> als <mark data-lemma="Geschenk">Geschenk</mark>.', 27, 1300, 'published'
  where not exists (select 1 from public.texts where title = 'Ein Geburtstag')
  returning id
)
insert into public.questions (text_id, prompt, options, correct_idx, difficulty)
select t.id, q.prompt, q.options, q.correct_idx, q.difficulty
from t, (values
  ('Co świętuje Tom?', array['Imieniny', 'Urodziny', 'Ślub', 'Awans'], 1, 1200),
  ('Ilu gości zaprasza?', array['Pięciu', 'Dziesięciu', 'Dwudziestu', 'Trzech'], 1, 1300),
  ('Co piecze mama?', array['Chleb', 'Ciasto', 'Pizzę', 'Bułki'], 1, 1400),
  ('Jakiego prezentu się spodziewa?', array['Książki', 'Roweru', 'Gry', 'Telefonu'], 1, 1300)
) as q(prompt, options, correct_idx, difficulty);

-- Ein Ferienjob (A2, 34 słów, 4 pytań)
with t as (
  insert into public.texts (title, cefr, body, word_count, difficulty, status)
  select 'Ein Ferienjob', 'A2', 'In den <mark data-lemma="Ferien">Ferien</mark> <mark data-lemma="suchen">sucht</mark> Nina einen <mark data-lemma="Job">Job</mark>. Sie <mark data-lemma="arbeiten">arbeitet</mark> in einem <mark data-lemma="Café">Café</mark> als <mark data-lemma="Kellnerin">Kellnerin</mark>. Die <mark data-lemma="Arbeit">Arbeit</mark> ist <mark data-lemma="anstrengend">anstrengend</mark>, aber sie <mark data-lemma="verdienen">verdient</mark> gutes Geld. Mit dem Geld will sie eine Reise machen.', 34, 1300, 'published'
  where not exists (select 1 from public.texts where title = 'Ein Ferienjob')
  returning id
)
insert into public.questions (text_id, prompt, options, correct_idx, difficulty)
select t.id, q.prompt, q.options, q.correct_idx, q.difficulty
from t, (values
  ('Czego szuka Nina na wakacje?', array['Mieszkania', 'Pracy', 'Kursu', 'Przyjaciół'], 1, 1200),
  ('Jako kto pracuje?', array['Sprzedawczyni', 'Kelnerka', 'Kucharka', 'Opiekunka'], 1, 1300),
  ('Jaka jest praca?', array['Łatwa', 'Męcząca', 'Nudna', 'Niebezpieczna'], 1, 1400),
  ('Na co chce wydać pieniądze?', array['Na ubrania', 'Na podróż', 'Na telefon', 'Na samochód'], 1, 1300)
) as q(prompt, options, correct_idx, difficulty);

-- Eine Radtour (A2, 32 słów, 3 pytań)
with t as (
  insert into public.texts (title, cefr, body, word_count, difficulty, status)
  select 'Eine Radtour', 'A2', 'Am Sonntag <mark data-lemma="machen">machen</mark> wir eine <mark data-lemma="Radtour">Radtour</mark> an den <mark data-lemma="See">See</mark>. Das <mark data-lemma="Wetter">Wetter</mark> ist <mark data-lemma="sonnig">sonnig</mark> und warm. Unterwegs <mark data-lemma="halten">halten</mark> wir an und <mark data-lemma="essen">essen</mark> ein <mark data-lemma="Picknick">Picknick</mark>. Am <mark data-lemma="Abend">Abend</mark> sind alle müde, aber glücklich.', 32, 1300, 'published'
  where not exists (select 1 from public.texts where title = 'Eine Radtour')
  returning id
)
insert into public.questions (text_id, prompt, options, correct_idx, difficulty)
select t.id, q.prompt, q.options, q.correct_idx, q.difficulty
from t, (values
  ('Dokąd jadą rowerami?', array['Do lasu', 'Nad jezioro', 'W góry', 'Do miasta'], 1, 1200),
  ('Jaka jest pogoda?', array['Deszczowa', 'Słoneczna i ciepła', 'Zimna', 'Wietrzna'], 1, 1300),
  ('Co robią po drodze?', array['Robią piknik', 'Pływają', 'Śpią', 'Robią zakupy'], 0, 1400)
) as q(prompt, options, correct_idx, difficulty);

-- Beim Friseur (A2, 29 słów, 3 pytań)
with t as (
  insert into public.texts (title, cefr, body, word_count, difficulty, status)
  select 'Beim Friseur', 'A2', 'Herr Roth <mark data-lemma="gehen">geht</mark> zum <mark data-lemma="Friseur">Friseur</mark>. Seine <mark data-lemma="Haar">Haare</mark> sind zu lang. Der Friseur <mark data-lemma="schneiden">schneidet</mark> sie kurz und <mark data-lemma="waschen">wäscht</mark> sie. Am <mark data-lemma="Ende">Ende</mark> <mark data-lemma="gefallen">gefällt</mark> Herrn Roth die neue <mark data-lemma="Frisur">Frisur</mark> sehr gut.', 29, 1300, 'published'
  where not exists (select 1 from public.texts where title = 'Beim Friseur')
  returning id
)
insert into public.questions (text_id, prompt, options, correct_idx, difficulty)
select t.id, q.prompt, q.options, q.correct_idx, q.difficulty
from t, (values
  ('Dokąd idzie pan Roth?', array['Do lekarza', 'Do fryzjera', 'Do sklepu', 'Na pocztę'], 1, 1200),
  ('Jakie ma włosy?', array['Za krótkie', 'Za długie', 'Siwe', 'Mokre'], 1, 1300),
  ('Jak mu się podoba fryzura?', array['Wcale', 'Bardzo', 'Trochę', 'Nie wie'], 1, 1400)
) as q(prompt, options, correct_idx, difficulty);

-- Das Fahrrad ist kaputt (A2, 26 słów, 3 pytań)
with t as (
  insert into public.texts (title, cefr, body, word_count, difficulty, status)
  select 'Das Fahrrad ist kaputt', 'A2', 'Pauls <mark data-lemma="Fahrrad">Fahrrad</mark> ist <mark data-lemma="kaputt">kaputt</mark>. Der <mark data-lemma="Reifen">Reifen</mark> hat ein <mark data-lemma="Loch">Loch</mark>. Er <mark data-lemma="bringen">bringt</mark> es in die <mark data-lemma="Werkstatt">Werkstatt</mark>. Der <mark data-lemma="Mechaniker">Mechaniker</mark> <mark data-lemma="reparieren">repariert</mark> es in einer <mark data-lemma="Stunde">Stunde</mark>.', 26, 1300, 'published'
  where not exists (select 1 from public.texts where title = 'Das Fahrrad ist kaputt')
  returning id
)
insert into public.questions (text_id, prompt, options, correct_idx, difficulty)
select t.id, q.prompt, q.options, q.correct_idx, q.difficulty
from t, (values
  ('Co jest zepsute?', array['Samochód', 'Rower', 'Telefon', 'Zegarek'], 1, 1200),
  ('Co jest nie tak?', array['Hamulec', 'Dziura w oponie', 'Łańcuch', 'Siodełko'], 1, 1300),
  ('Jak długo trwa naprawa?', array['Dzień', 'Godzinę', 'Tydzień', 'Pięć minut'], 1, 1400)
) as q(prompt, options, correct_idx, difficulty);

-- Urlaub planen (A2, 27 słów, 4 pytań)
with t as (
  insert into public.texts (title, cefr, body, word_count, difficulty, status)
  select 'Urlaub planen', 'A2', 'Familie Weber <mark data-lemma="planen">plant</mark> den <mark data-lemma="Urlaub">Urlaub</mark>. Sie <mark data-lemma="möchten">möchten</mark> ans <mark data-lemma="Meer">Meer</mark> fahren. Im <mark data-lemma="Internet">Internet</mark> <mark data-lemma="suchen">suchen</mark> sie ein günstiges <mark data-lemma="Hotel">Hotel</mark>. Die Kinder <mark data-lemma="freuen">freuen</mark> sich auf den <mark data-lemma="Strand">Strand</mark>.', 27, 1300, 'published'
  where not exists (select 1 from public.texts where title = 'Urlaub planen')
  returning id
)
insert into public.questions (text_id, prompt, options, correct_idx, difficulty)
select t.id, q.prompt, q.options, q.correct_idx, q.difficulty
from t, (values
  ('Co planuje rodzina Weber?', array['Przeprowadzkę', 'Urlop', 'Remont', 'Przyjęcie'], 1, 1200),
  ('Dokąd chcą jechać?', array['W góry', 'Nad morze', 'Do miasta', 'Na wieś'], 1, 1300),
  ('Gdzie szukają hotelu?', array['W gazecie', 'W internecie', 'W biurze podróży', 'U znajomych'], 1, 1400),
  ('Na co cieszą się dzieci?', array['Na plażę', 'Na góry', 'Na muzeum', 'Na zoo'], 0, 1300)
) as q(prompt, options, correct_idx, difficulty);

-- Ein Konto eröffnen (A2, 30 słów, 3 pytań)
with t as (
  insert into public.texts (title, cefr, body, word_count, difficulty, status)
  select 'Ein Konto eröffnen', 'A2', 'Yusuf <mark data-lemma="möchten">möchte</mark> ein <mark data-lemma="Konto">Konto</mark> bei der <mark data-lemma="Bank">Bank</mark> <mark data-lemma="eröffnen">eröffnen</mark>. Er <mark data-lemma="brauchen">braucht</mark> seinen <mark data-lemma="Pass">Pass</mark> und eine <mark data-lemma="Adresse">Adresse</mark>. Die <mark data-lemma="Mitarbeiterin">Mitarbeiterin</mark> <mark data-lemma="erklären">erklärt</mark> alles genau. Nach einer <mark data-lemma="Woche">Woche</mark> bekommt er seine <mark data-lemma="Karte">Karte</mark>.', 30, 1300, 'published'
  where not exists (select 1 from public.texts where title = 'Ein Konto eröffnen')
  returning id
)
insert into public.questions (text_id, prompt, options, correct_idx, difficulty)
select t.id, q.prompt, q.options, q.correct_idx, q.difficulty
from t, (values
  ('Co chce zrobić Yusuf?', array['Wziąć kredyt', 'Otworzyć konto', 'Wymienić walutę', 'Zamknąć konto'], 1, 1200),
  ('Czego potrzebuje?', array['Tylko adresu', 'Paszportu i adresu', 'Tylko zdjęcia', 'Pieniędzy w gotówce'], 1, 1300),
  ('Kiedy dostaje kartę?', array['Od razu', 'Po tygodniu', 'Po miesiącu', 'Następnego dnia'], 1, 1400)
) as q(prompt, options, correct_idx, difficulty);

-- Die neuen Nachbarn (A2, 29 słów, 3 pytań)
with t as (
  insert into public.texts (title, cefr, body, word_count, difficulty, status)
  select 'Die neuen Nachbarn', 'A2', 'In unser <mark data-lemma="Haus">Haus</mark> sind neue <mark data-lemma="Nachbar">Nachbarn</mark> <mark data-lemma="einziehen">eingezogen</mark>. Sie <mark data-lemma="kommen">kommen</mark> aus <mark data-lemma="Spanien">Spanien</mark>. Gestern haben wir uns <mark data-lemma="vorstellen">vorgestellt</mark> und <mark data-lemma="Kaffee">Kaffee</mark> getrunken. Sie sind sehr <mark data-lemma="freundlich">freundlich</mark> und haben zwei Kinder.', 29, 1300, 'published'
  where not exists (select 1 from public.texts where title = 'Die neuen Nachbarn')
  returning id
)
insert into public.questions (text_id, prompt, options, correct_idx, difficulty)
select t.id, q.prompt, q.options, q.correct_idx, q.difficulty
from t, (values
  ('Kto wprowadził się do domu?', array['Nowi sąsiedzi', 'Rodzina autora', 'Goście', 'Studenci'], 0, 1200),
  ('Skąd pochodzą?', array['Z Włoch', 'Z Hiszpanii', 'Z Francji', 'Z Portugalii'], 1, 1300),
  ('Jacy są sąsiedzi?', array['Cisi', 'Przyjaźni', 'Niemili', 'Starsi'], 1, 1400)
) as q(prompt, options, correct_idx, difficulty);

-- Soziale Medien im Alltag (B1, 36 słów, 3 pytań)
with t as (
  insert into public.texts (title, cefr, body, word_count, difficulty, status)
  select 'Soziale Medien im Alltag', 'B1', 'Viele Menschen <mark data-lemma="nutzen">nutzen</mark> täglich <mark data-lemma="sozial">soziale</mark> <mark data-lemma="Medium">Medien</mark>. Man <mark data-lemma="bleiben">bleibt</mark> mit <mark data-lemma="Freund">Freunden</mark> in <mark data-lemma="Kontakt">Kontakt</mark> und <mark data-lemma="teilen">teilt</mark> Fotos. Allerdings <mark data-lemma="verbringen">verbringen</mark> manche zu viel <mark data-lemma="Zeit">Zeit</mark> am <mark data-lemma="Handy">Handy</mark>. Experten raten, das Telefon abends auszuschalten und mehr Pausen zu machen.', 36, 1500, 'published'
  where not exists (select 1 from public.texts where title = 'Soziale Medien im Alltag')
  returning id
)
insert into public.questions (text_id, prompt, options, correct_idx, difficulty)
select t.id, q.prompt, q.options, q.correct_idx, q.difficulty
from t, (values
  ('Co ludzie robią codziennie?', array['Czytają książki', 'Używają mediów społecznościowych', 'Uprawiają sport', 'Gotują'], 1, 1400),
  ('Jaka jest zaleta według tekstu?', array['Zarabianie', 'Kontakt z przyjaciółmi', 'Nauka języków', 'Lepszy sen'], 1, 1500),
  ('Co radzą eksperci?', array['Kupić nowy telefon', 'Wyłączać telefon wieczorem', 'Częściej publikować', 'Usunąć konta'], 1, 1600)
) as q(prompt, options, correct_idx, difficulty);

-- Freiwillig im Tierheim (B1, 41 słów, 4 pytań)
with t as (
  insert into public.texts (title, cefr, body, word_count, difficulty, status)
  select 'Freiwillig im Tierheim', 'B1', 'Jonas <mark data-lemma="engagieren">engagiert</mark> sich <mark data-lemma="freiwillig">freiwillig</mark> in einem <mark data-lemma="Tierheim">Tierheim</mark>. Jeden Samstag <mark data-lemma="kümmern">kümmert</mark> er sich um die <mark data-lemma="Hund">Hunde</mark> und geht mit ihnen <mark data-lemma="spazieren">spazieren</mark>. Die <mark data-lemma="Arbeit">Arbeit</mark> wird nicht <mark data-lemma="bezahlen">bezahlt</mark>, aber sie <mark data-lemma="geben">gibt</mark> ihm viel <mark data-lemma="Freude">Freude</mark>. Außerdem lernt er Verantwortung zu übernehmen.', 41, 1500, 'published'
  where not exists (select 1 from public.texts where title = 'Freiwillig im Tierheim')
  returning id
)
insert into public.questions (text_id, prompt, options, correct_idx, difficulty)
select t.id, q.prompt, q.options, q.correct_idx, q.difficulty
from t, (values
  ('Gdzie udziela się Jonas?', array['W szpitalu', 'W schronisku dla zwierząt', 'W szkole', 'W bibliotece'], 1, 1400),
  ('Co robi w soboty?', array['Sprząta', 'Opiekuje się psami', 'Gotuje', 'Zbiera pieniądze'], 1, 1500),
  ('Czego się dodatkowo uczy?', array['Cierpliwości', 'Odpowiedzialności', 'Gotowania', 'Języka'], 1, 1600),
  ('Czy praca jest płatna?', array['Tak, dobrze', 'Nie', 'Tylko czasem', 'Zależy od pogody'], 1, 1500)
) as q(prompt, options, correct_idx, difficulty);

-- Umzug ins Ausland (B1, 44 słów, 4 pytań)
with t as (
  insert into public.texts (title, cefr, body, word_count, difficulty, status)
  select 'Umzug ins Ausland', 'B1', 'Clara <mark data-lemma="ziehen">zieht</mark> für ihr <mark data-lemma="Studium">Studium</mark> ins <mark data-lemma="Ausland">Ausland</mark>. Sie muss eine <mark data-lemma="Wohnung">Wohnung</mark> finden und die <mark data-lemma="Sprache">Sprache</mark> lernen. Am Anfang <mark data-lemma="fühlen">fühlt</mark> sie sich oft <mark data-lemma="einsam">einsam</mark>, weil ihre <mark data-lemma="Familie">Familie</mark> weit weg ist. Nach einigen Monaten findet sie neue Freunde und gewöhnt sich an das Leben.', 44, 1500, 'published'
  where not exists (select 1 from public.texts where title = 'Umzug ins Ausland')
  returning id
)
insert into public.questions (text_id, prompt, options, correct_idx, difficulty)
select t.id, q.prompt, q.options, q.correct_idx, q.difficulty
from t, (values
  ('Dlaczego Clara wyjeżdża za granicę?', array['Do pracy', 'Na studia', 'Na wakacje', 'Z powodu rodziny'], 1, 1400),
  ('Co musi zrobić na początku?', array['Kupić samochód', 'Znaleźć mieszkanie i uczyć się języka', 'Założyć firmę', 'Zdać egzamin'], 1, 1500),
  ('Jak czuje się na początku?', array['Szczęśliwa', 'Samotna', 'Zła', 'Spokojna'], 1, 1600),
  ('Co dzieje się po kilku miesiącach?', array['Wraca do domu', 'Poznaje przyjaciół i przyzwyczaja się', 'Zmienia kierunek', 'Zostaje sama'], 1, 1500)
) as q(prompt, options, correct_idx, difficulty);

-- Eine Sprache online lernen (B1, 40 słów, 4 pytań)
with t as (
  insert into public.texts (title, cefr, body, word_count, difficulty, status)
  select 'Eine Sprache online lernen', 'B1', 'Immer mehr Menschen <mark data-lemma="lernen">lernen</mark> eine <mark data-lemma="Sprache">Sprache</mark> im <mark data-lemma="Internet">Internet</mark>. Mit <mark data-lemma="App">Apps</mark> kann man <mark data-lemma="flexibel">flexibel</mark> üben, wann man <mark data-lemma="wollen">will</mark>. Ein <mark data-lemma="Nachteil">Nachteil</mark> ist, dass das <mark data-lemma="Sprechen">Sprechen</mark> oft zu kurz kommt. Deshalb ist es sinnvoll, online und im echten Leben zu kombinieren.', 40, 1500, 'published'
  where not exists (select 1 from public.texts where title = 'Eine Sprache online lernen')
  returning id
)
insert into public.questions (text_id, prompt, options, correct_idx, difficulty)
select t.id, q.prompt, q.options, q.correct_idx, q.difficulty
from t, (values
  ('Gdzie coraz więcej ludzi uczy się języka?', array['W szkole', 'W internecie', 'Za granicą', 'W pracy'], 1, 1400),
  ('Jaka jest zaleta aplikacji?', array['Są darmowe', 'Elastyczna nauka', 'Lepsza wymowa', 'Mniej nauki'], 1, 1500),
  ('Jaka jest wada według tekstu?', array['Za drogo', 'Za mało mówienia', 'Brak gramatyki', 'Brak nauczyciela'], 1, 1600),
  ('Co jest sensowne?', array['Tylko aplikacje', 'Łączyć online i realne życie', 'Tylko kurs', 'Uczyć się samemu'], 1, 1500)
) as q(prompt, options, correct_idx, difficulty);

-- Gesund leben im Stress (B1, 37 słów, 3 pytań)
with t as (
  insert into public.texts (title, cefr, body, word_count, difficulty, status)
  select 'Gesund leben im Stress', 'B1', 'Im <mark data-lemma="Alltag">Alltag</mark> haben viele <mark data-lemma="Stress">Stress</mark> und wenig <mark data-lemma="Zeit">Zeit</mark>. Trotzdem ist es wichtig, sich <mark data-lemma="gesund">gesund</mark> zu <mark data-lemma="ernähren">ernähren</mark> und genug zu <mark data-lemma="schlafen">schlafen</mark>. Schon ein kurzer <mark data-lemma="Spaziergang">Spaziergang</mark> kann beim <mark data-lemma="Entspannen">Entspannen</mark> helfen. Wer Pausen macht, arbeitet danach oft konzentrierter.', 37, 1500, 'published'
  where not exists (select 1 from public.texts where title = 'Gesund leben im Stress')
  returning id
)
insert into public.questions (text_id, prompt, options, correct_idx, difficulty)
select t.id, q.prompt, q.options, q.correct_idx, q.difficulty
from t, (values
  ('Co ma wielu ludzi w codzienności?', array['Dużo czasu', 'Stres i mało czasu', 'Spokój', 'Dużo snu'], 1, 1400),
  ('Co jest ważne mimo to?', array['Więcej pracy', 'Zdrowe jedzenie i sen', 'Więcej kawy', 'Mniej snu'], 1, 1500),
  ('Co pomaga się zrelaksować?', array['Krótki spacer', 'Praca', 'Telewizja', 'Słodycze'], 0, 1600)
) as q(prompt, options, correct_idx, difficulty);

-- Geld sparen im Alltag (B1, 41 słów, 3 pytań)
with t as (
  insert into public.texts (title, cefr, body, word_count, difficulty, status)
  select 'Geld sparen im Alltag', 'B1', 'Viele Familien <mark data-lemma="versuchen">versuchen</mark>, im <mark data-lemma="Alltag">Alltag</mark> <mark data-lemma="Geld">Geld</mark> zu <mark data-lemma="sparen">sparen</mark>. Man kann zum Beispiel <mark data-lemma="Angebot">Angebote</mark> <mark data-lemma="vergleichen">vergleichen</mark> und weniger <mark data-lemma="wegwerfen">wegwerfen</mark>. Auch <mark data-lemma="selbst">selbst</mark> zu <mark data-lemma="kochen">kochen</mark> ist oft <mark data-lemma="billig">billiger</mark> als Essen zu bestellen. Kleine Schritte machen am Ende des Monats einen großen Unterschied.', 41, 1500, 'published'
  where not exists (select 1 from public.texts where title = 'Geld sparen im Alltag')
  returning id
)
insert into public.questions (text_id, prompt, options, correct_idx, difficulty)
select t.id, q.prompt, q.options, q.correct_idx, q.difficulty
from t, (values
  ('Co próbują robić rodziny?', array['Zarabiać więcej', 'Oszczędzać pieniądze', 'Wydawać więcej', 'Brać kredyty'], 1, 1400),
  ('Co można robić, by oszczędzać?', array['Porównywać oferty', 'Kupować markowe rzeczy', 'Jeść na mieście', 'Wyrzucać jedzenie'], 0, 1500),
  ('Co jest tańsze?', array['Zamawianie jedzenia', 'Gotowanie samemu', 'Jedzenie w restauracji', 'Kupowanie gotowych dań'], 1, 1600)
) as q(prompt, options, correct_idx, difficulty);

-- Streit im Büro (B1, 36 słów, 4 pytań)
with t as (
  insert into public.texts (title, cefr, body, word_count, difficulty, status)
  select 'Streit im Büro', 'B1', 'Im <mark data-lemma="Büro">Büro</mark> gibt es manchmal <mark data-lemma="Streit">Streit</mark> zwischen <mark data-lemma="Kollege">Kollegen</mark>. Oft <mark data-lemma="entstehen">entsteht</mark> ein <mark data-lemma="Konflikt">Konflikt</mark> durch schlechte <mark data-lemma="Kommunikation">Kommunikation</mark>. Es <mark data-lemma="helfen">hilft</mark>, ruhig zu bleiben und dem anderen <mark data-lemma="zuhören">zuzuhören</mark>. Wenn das nicht reicht, kann der Chef vermitteln.', 36, 1500, 'published'
  where not exists (select 1 from public.texts where title = 'Streit im Büro')
  returning id
)
insert into public.questions (text_id, prompt, options, correct_idx, difficulty)
select t.id, q.prompt, q.options, q.correct_idx, q.difficulty
from t, (values
  ('Gdzie dochodzi do sporów?', array['W domu', 'W biurze', 'W sklepie', 'W szkole'], 1, 1400),
  ('Przez co często powstaje konflikt?', array['Przez pieniądze', 'Przez złą komunikację', 'Przez pogodę', 'Przez czas'], 1, 1500),
  ('Co pomaga?', array['Krzyk', 'Zachować spokój i słuchać', 'Ignorować', 'Odejść z pracy'], 1, 1600),
  ('Co robić, gdy to nie wystarczy?', array['Szef może pośredniczyć', 'Zrezygnować', 'Milczeć', 'Zmienić biuro'], 0, 1500)
) as q(prompt, options, correct_idx, difficulty);

-- Recycling zu Hause (B1, 37 słów, 3 pytań)
with t as (
  insert into public.texts (title, cefr, body, word_count, difficulty, status)
  select 'Recycling zu Hause', 'B1', '<mark data-lemma="Recycling">Recycling</mark> beginnt zu <mark data-lemma="Hause">Hause</mark>. Wer <mark data-lemma="Abfall">Abfall</mark> richtig <mark data-lemma="trennen">trennt</mark>, <mark data-lemma="schützen">schützt</mark> die <mark data-lemma="Umwelt">Umwelt</mark> und spart <mark data-lemma="Ressource">Ressourcen</mark>. Glas, Papier und <mark data-lemma="Plastik">Plastik</mark> gehören in verschiedene <mark data-lemma="Behälter">Behälter</mark>. Auch alte Geräte sollte man nicht einfach in den Müll werfen.', 37, 1500, 'published'
  where not exists (select 1 from public.texts where title = 'Recycling zu Hause')
  returning id
)
insert into public.questions (text_id, prompt, options, correct_idx, difficulty)
select t.id, q.prompt, q.options, q.correct_idx, q.difficulty
from t, (values
  ('Gdzie zaczyna się recykling?', array['W fabryce', 'W domu', 'W sklepie', 'W szkole'], 1, 1400),
  ('Co chroni segregacja odpadów?', array['Pieniądze', 'Środowisko', 'Czas', 'Zdrowie'], 1, 1500),
  ('Co NIE powinno trafiać po prostu do śmieci?', array['Papier', 'Stare urządzenia', 'Szkło', 'Plastik'], 1, 1600)
) as q(prompt, options, correct_idx, difficulty);

-- Vor- und Nachteile der Telearbeit (B1, 37 słów, 4 pytań)
with t as (
  insert into public.texts (title, cefr, body, word_count, difficulty, status)
  select 'Vor- und Nachteile der Telearbeit', 'B1', '<mark data-lemma="Telearbeit">Telearbeit</mark> ist heute weit <mark data-lemma="verbreitet">verbreitet</mark>. Viele <mark data-lemma="schätzen">schätzen</mark> die <mark data-lemma="Freiheit">Freiheit</mark>, sich die <mark data-lemma="Zeit">Zeit</mark> selbst einzuteilen. Doch wer zu Hause <mark data-lemma="arbeiten">arbeitet</mark>, muss sehr <mark data-lemma="diszipliniert">diszipliniert</mark> sein. Manche vermissen den Austausch mit den Kollegen und fühlen sich isoliert.', 37, 1500, 'published'
  where not exists (select 1 from public.texts where title = 'Vor- und Nachteile der Telearbeit')
  returning id
)
insert into public.questions (text_id, prompt, options, correct_idx, difficulty)
select t.id, q.prompt, q.options, q.correct_idx, q.difficulty
from t, (values
  ('Jaka jest dziś telepraca?', array['Rzadka', 'Szeroko rozpowszechniona', 'Zakazana', 'Droga'], 1, 1400),
  ('Co cenią ludzie?', array['Wyższą pensję', 'Wolność w planowaniu czasu', 'Więcej spotkań', 'Krótszy dzień'], 1, 1500),
  ('Jakiej cechy wymaga praca w domu?', array['Siły', 'Dyscypliny', 'Doświadczenia', 'Cierpliwości'], 1, 1600),
  ('Czego brakuje niektórym?', array['Pieniędzy', 'Kontaktu z kolegami', 'Komputera', 'Czasu'], 1, 1500)
) as q(prompt, options, correct_idx, difficulty);

-- Sport im Verein (B1, 34 słów, 3 pytań)
with t as (
  insert into public.texts (title, cefr, body, word_count, difficulty, status)
  select 'Sport im Verein', 'B1', 'Viele Deutsche <mark data-lemma="treiben">treiben</mark> <mark data-lemma="Sport">Sport</mark> in einem <mark data-lemma="Verein">Verein</mark>. Dort kann man <mark data-lemma="regelmäßig">regelmäßig</mark> <mark data-lemma="trainieren">trainieren</mark> und neue <mark data-lemma="Leute">Leute</mark> kennenlernen. Der <mark data-lemma="Mitgliedsbeitrag">Mitgliedsbeitrag</mark> ist meist <mark data-lemma="niedrig">niedrig</mark>. Besonders für Kinder ist der Sport im Verein eine gute Freizeitbeschäftigung.', 34, 1500, 'published'
  where not exists (select 1 from public.texts where title = 'Sport im Verein')
  returning id
)
insert into public.questions (text_id, prompt, options, correct_idx, difficulty)
select t.id, q.prompt, q.options, q.correct_idx, q.difficulty
from t, (values
  ('Gdzie wielu Niemców uprawia sport?', array['W domu', 'W klubie/stowarzyszeniu', 'Na siłowni', 'W parku'], 1, 1400),
  ('Co można tam robić?', array['Tylko oglądać', 'Trenować i poznawać ludzi', 'Tylko grać w karty', 'Pracować'], 1, 1500),
  ('Jaka jest składka członkowska?', array['Wysoka', 'Zwykle niska', 'Brak', 'Zmienna'], 1, 1600)
) as q(prompt, options, correct_idx, difficulty);

-- Künstliche Intelligenz am Arbeitsplatz (B2, 42 słów, 4 pytań)
with t as (
  insert into public.texts (title, cefr, body, word_count, difficulty, status)
  select 'Künstliche Intelligenz am Arbeitsplatz', 'B2', '<mark data-lemma="Künstlich">Künstliche</mark> <mark data-lemma="Intelligenz">Intelligenz</mark> verändert zunehmend die <mark data-lemma="Arbeitswelt">Arbeitswelt</mark>. Routineaufgaben werden <mark data-lemma="automatisieren">automatisiert</mark>, sodass <mark data-lemma="Mitarbeiter">Mitarbeiter</mark> mehr Zeit für <mark data-lemma="kreativ">kreative</mark> Tätigkeiten haben. Gleichzeitig <mark data-lemma="befürchten">befürchten</mark> viele, dass <mark data-lemma="Arbeitsplatz">Arbeitsplätze</mark> <mark data-lemma="verloren">verloren</mark> gehen. Entscheidend wird sein, ob die Gesellschaft die Beschäftigten rechtzeitig weiterbildet und den Wandel sozial gerecht gestaltet.', 42, 1700, 'published'
  where not exists (select 1 from public.texts where title = 'Künstliche Intelligenz am Arbeitsplatz')
  returning id
)
insert into public.questions (text_id, prompt, options, correct_idx, difficulty)
select t.id, q.prompt, q.options, q.correct_idx, q.difficulty
from t, (values
  ('Co zmienia sztuczna inteligencja?', array['Pogodę', 'Świat pracy', 'Ceny mieszkań', 'Szkolnictwo wyższe'], 1, 1600),
  ('Co się automatyzuje?', array['Zadania kreatywne', 'Zadania rutynowe', 'Spotkania', 'Urlopy'], 1, 1700),
  ('Czego obawia się wielu?', array['Wyższych podatków', 'Utraty miejsc pracy', 'Niższych pensji', 'Dłuższych godzin'], 1, 1800),
  ('Co będzie decydujące według tekstu?', array['Tania energia', 'Dokształcanie pracowników i sprawiedliwa zmiana', 'Nowe komputery', 'Więcej reklam'], 1, 1800)
) as q(prompt, options, correct_idx, difficulty);

-- Der Klimawandel und unser Konsum (B2, 44 słów, 4 pytań)
with t as (
  insert into public.texts (title, cefr, body, word_count, difficulty, status)
  select 'Der Klimawandel und unser Konsum', 'B2', 'Der <mark data-lemma="Klimawandel">Klimawandel</mark> ist eine der größten <mark data-lemma="Herausforderung">Herausforderungen</mark> unserer Zeit. Unser <mark data-lemma="Konsum">Konsum</mark> an <mark data-lemma="Fleisch">Fleisch</mark>, <mark data-lemma="Energie">Energie</mark> und <mark data-lemma="Flugreise">Flugreisen</mark> trägt erheblich zu den <mark data-lemma="Emission">Emissionen</mark> bei. Manche <mark data-lemma="argumentieren">argumentieren</mark>, dass nur die <mark data-lemma="Politik">Politik</mark> etwas ändern könne. Andere betonen, dass auch das Verhalten jedes Einzelnen einen Unterschied macht.', 44, 1700, 'published'
  where not exists (select 1 from public.texts where title = 'Der Klimawandel und unser Konsum')
  returning id
)
insert into public.questions (text_id, prompt, options, correct_idx, difficulty)
select t.id, q.prompt, q.options, q.correct_idx, q.difficulty
from t, (values
  ('Czym jest zmiana klimatu według tekstu?', array['Mitem', 'Jednym z największych wyzwań', 'Problemem przeszłości', 'Sprawą lokalną'], 1, 1600),
  ('Co przyczynia się do emisji?', array['Czytanie książek', 'Konsumpcja mięsa, energii i loty', 'Spacery', 'Recykling'], 1, 1700),
  ('Co twierdzą niektórzy?', array['Tylko polityka może coś zmienić', 'Nic nie da się zrobić', 'Klimat się nie zmienia', 'Liczy się tylko technologia'], 0, 1800),
  ('Co podkreślają inni?', array['Że zachowanie jednostki też ma znaczenie', 'Że to wina pogody', 'Że nauka się myli', 'Że to za drogie'], 0, 1800)
) as q(prompt, options, correct_idx, difficulty);

-- Work-Life-Balance (B2, 45 słów, 4 pytań)
with t as (
  insert into public.texts (title, cefr, body, word_count, difficulty, status)
  select 'Work-Life-Balance', 'B2', 'Eine ausgewogene <mark data-lemma="Work-Life-Balance">Work-Life-Balance</mark> gilt vielen als <mark data-lemma="Schlüssel">Schlüssel</mark> zu einem zufriedenen <mark data-lemma="Leben">Leben</mark>. Wer ständig <mark data-lemma="erreichbar">erreichbar</mark> ist und kaum <mark data-lemma="abschalten">abschaltet</mark>, riskiert auf Dauer seine <mark data-lemma="Gesundheit">Gesundheit</mark>. Unternehmen <mark data-lemma="erkennen">erkennen</mark> zunehmend, dass <mark data-lemma="zufrieden">zufriedene</mark> Mitarbeiter <mark data-lemma="produktiv">produktiver</mark> sind. Flexible Arbeitszeiten und das Recht auf Nichterreichbarkeit gewinnen daher an Bedeutung.', 45, 1700, 'published'
  where not exists (select 1 from public.texts where title = 'Work-Life-Balance')
  returning id
)
insert into public.questions (text_id, prompt, options, correct_idx, difficulty)
select t.id, q.prompt, q.options, q.correct_idx, q.difficulty
from t, (values
  ('Za co uchodzi równowaga praca–życie?', array['Za przeżytek', 'Za klucz do zadowolonego życia', 'Za luksus', 'Za modę'], 1, 1600),
  ('Co ryzykuje ktoś stale dostępny?', array['Awans', 'Swoje zdrowie', 'Pensję', 'Urlop'], 1, 1700),
  ('Co dostrzegają firmy?', array['Że zadowoleni pracownicy są bardziej produktywni', 'Że nadgodziny pomagają', 'Że kontrola jest najważniejsza', 'Że pensje są za wysokie'], 0, 1800),
  ('Co zyskuje na znaczeniu?', array['Dłuższe godziny pracy', 'Elastyczny czas pracy i prawo do niedostępności', 'Praca w weekendy', 'Stałe nadzorowanie'], 1, 1700)
) as q(prompt, options, correct_idx, difficulty);

-- Digitalisierung der Schulen (B2, 41 słów, 4 pytań)
with t as (
  insert into public.texts (title, cefr, body, word_count, difficulty, status)
  select 'Digitalisierung der Schulen', 'B2', 'Die <mark data-lemma="Digitalisierung">Digitalisierung</mark> der <mark data-lemma="Schule">Schulen</mark> schreitet voran. <mark data-lemma="Tablet">Tablets</mark> und <mark data-lemma="digital">digitale</mark> <mark data-lemma="Tafel">Tafeln</mark> <mark data-lemma="ersetzen">ersetzen</mark> oft das klassische Schulbuch. Befürworter <mark data-lemma="betonen">betonen</mark> die neuen <mark data-lemma="Möglichkeit">Möglichkeiten</mark>, Kritiker <mark data-lemma="warnen">warnen</mark> vor zu viel <mark data-lemma="Bildschirmzeit">Bildschirmzeit</mark>. Wichtig bleibt, dass die Technik den Unterricht unterstützt und nicht zum Selbstzweck wird.', 41, 1700, 'published'
  where not exists (select 1 from public.texts where title = 'Digitalisierung der Schulen')
  returning id
)
insert into public.questions (text_id, prompt, options, correct_idx, difficulty)
select t.id, q.prompt, q.options, q.correct_idx, q.difficulty
from t, (values
  ('Co postępuje w szkołach?', array['Cyfryzacja', 'Likwidacja', 'Prywatyzacja', 'Redukcja'], 0, 1600),
  ('Co często zastępuje podręcznik?', array['Zeszyty', 'Tablety i tablice cyfrowe', 'Nauczyciele', 'Biblioteki'], 1, 1700),
  ('Przed czym ostrzegają krytycy?', array['Przed kosztami', 'Przed zbyt długim czasem przed ekranem', 'Przed brakiem prądu', 'Przed hałasem'], 1, 1800),
  ('Co pozostaje ważne?', array['By technika wspierała lekcje, a nie była celem samym w sobie', 'By kupić więcej sprzętu', 'By zlikwidować książki', 'By skrócić lekcje'], 0, 1800)
) as q(prompt, options, correct_idx, difficulty);

-- Eine alternde Gesellschaft (B2, 39 słów, 4 pytań)
with t as (
  insert into public.texts (title, cefr, body, word_count, difficulty, status)
  select 'Eine alternde Gesellschaft', 'B2', 'Die <mark data-lemma="Gesellschaft">Gesellschaft</mark> in Deutschland <mark data-lemma="altern">altert</mark> zunehmend. Weil die <mark data-lemma="Geburtenrate">Geburtenrate</mark> niedrig ist und die Menschen <mark data-lemma="länger">länger</mark> leben, steigt der Anteil der <mark data-lemma="Rentner">Rentner</mark>. Das <mark data-lemma="stellen">stellt</mark> das <mark data-lemma="Rentensystem">Rentensystem</mark> vor große <mark data-lemma="Problem">Probleme</mark>. Zuwanderung und längere Lebensarbeitszeit werden als mögliche Lösungen diskutiert.', 39, 1700, 'published'
  where not exists (select 1 from public.texts where title = 'Eine alternde Gesellschaft')
  returning id
)
insert into public.questions (text_id, prompt, options, correct_idx, difficulty)
select t.id, q.prompt, q.options, q.correct_idx, q.difficulty
from t, (values
  ('Co dzieje się ze społeczeństwem?', array['Młodnieje', 'Starzeje się', 'Maleje liczbowo do zera', 'Nie zmienia się'], 1, 1600),
  ('Dlaczego rośnie udział emerytów?', array['Niska dzietność i dłuższe życie', 'Imigracja', 'Wyższe pensje', 'Lepsza pogoda'], 0, 1700),
  ('Co jest zagrożone?', array['System edukacji', 'System emerytalny', 'System transportu', 'System zdrowia'], 1, 1800),
  ('Jakie rozwiązania są dyskutowane?', array['Imigracja i dłuższa praca', 'Niższe podatki', 'Krótszy tydzień pracy', 'Zamknięcie granic'], 0, 1700)
) as q(prompt, options, correct_idx, difficulty);

-- Mobilität in der Großstadt (B2, 43 słów, 4 pytań)
with t as (
  insert into public.texts (title, cefr, body, word_count, difficulty, status)
  select 'Mobilität in der Großstadt', 'B2', 'In den <mark data-lemma="Großstadt">Großstädten</mark> wird die <mark data-lemma="Mobilität">Mobilität</mark> neu gedacht. Statt eigener <mark data-lemma="Auto">Autos</mark> <mark data-lemma="setzen">setzen</mark> viele auf <mark data-lemma="Carsharing">Carsharing</mark>, <mark data-lemma="Fahrrad">Fahrräder</mark> und den <mark data-lemma="Nahverkehr">Nahverkehr</mark>. Das <mark data-lemma="entlasten">entlastet</mark> die <mark data-lemma="Straße">Straßen</mark> und verbessert die <mark data-lemma="Luftqualität">Luftqualität</mark>. Damit der Umstieg gelingt, müssen Busse und Bahnen jedoch zuverlässig und bezahlbar sein.', 43, 1700, 'published'
  where not exists (select 1 from public.texts where title = 'Mobilität in der Großstadt')
  returning id
)
insert into public.questions (text_id, prompt, options, correct_idx, difficulty)
select t.id, q.prompt, q.options, q.correct_idx, q.difficulty
from t, (values
  ('Co jest na nowo przemyślane w wielkich miastach?', array['Architektura', 'Mobilność', 'Szkolnictwo', 'Handel'], 1, 1600),
  ('Na co stawia wielu zamiast własnego auta?', array['Na taksówki', 'Na carsharing, rowery i komunikację', 'Na motocykle', 'Na piesze wędrówki'], 1, 1700),
  ('Co to poprawia?', array['Ceny paliwa', 'Jakość powietrza', 'Liczbę aut', 'Hałas w domach'], 1, 1800),
  ('Co jest warunkiem udanej zmiany?', array['Niezawodna i przystępna cenowo komunikacja', 'Więcej parkingów', 'Wyższe podatki od aut', 'Zakaz rowerów'], 0, 1800)
) as q(prompt, options, correct_idx, difficulty);

-- Desinformation in den Medien (B2, 38 słów, 4 pytań)
with t as (
  insert into public.texts (title, cefr, body, word_count, difficulty, status)
  select 'Desinformation in den Medien', 'B2', '<mark data-lemma="Desinformation">Desinformation</mark> <mark data-lemma="verbreiten">verbreitet</mark> sich im <mark data-lemma="Internet">Internet</mark> oft schneller als seriöse <mark data-lemma="Nachricht">Nachrichten</mark>. Falsche <mark data-lemma="Behauptung">Behauptungen</mark> werden geteilt, ohne dass jemand die <mark data-lemma="Quelle">Quelle</mark> <mark data-lemma="prüfen">prüft</mark>. Deshalb ist <mark data-lemma="Medienkompetenz">Medienkompetenz</mark> heute eine wichtige <mark data-lemma="Fähigkeit">Fähigkeit</mark>. Wer Informationen kritisch hinterfragt, schützt sich vor Manipulation.', 38, 1700, 'published'
  where not exists (select 1 from public.texts where title = 'Desinformation in den Medien')
  returning id
)
insert into public.questions (text_id, prompt, options, correct_idx, difficulty)
select t.id, q.prompt, q.options, q.correct_idx, q.difficulty
from t, (values
  ('Co rozprzestrzenia się szybciej w internecie?', array['Poważne wiadomości', 'Dezinformacja', 'Reklamy', 'Filmy'], 1, 1600),
  ('Czego brakuje przy udostępnianiu fałszywych twierdzeń?', array['Sprawdzenia źródła', 'Zdjęć', 'Tłumaczenia', 'Komentarzy'], 0, 1700),
  ('Co jest dziś ważną umiejętnością?', array['Pisanie na klawiaturze', 'Kompetencja medialna', 'Programowanie', 'Fotografia'], 1, 1800),
  ('Co chroni przed manipulacją?', array['Krytyczne kwestionowanie informacji', 'Szybkie udostępnianie', 'Ignorowanie wiadomości', 'Wiara wszystkim'], 0, 1800)
) as q(prompt, options, correct_idx, difficulty);

-- Erneuerbare Energien (B2, 43 słów, 4 pytań)
with t as (
  insert into public.texts (title, cefr, body, word_count, difficulty, status)
  select 'Erneuerbare Energien', 'B2', '<mark data-lemma="Erneuerbar">Erneuerbare</mark> <mark data-lemma="Energie">Energien</mark> wie <mark data-lemma="Sonne">Sonne</mark> und <mark data-lemma="Wind">Wind</mark> <mark data-lemma="gelten">gelten</mark> als Zukunft der <mark data-lemma="Energieversorgung">Energieversorgung</mark>. Sie <mark data-lemma="verursachen">verursachen</mark> kaum <mark data-lemma="Treibhausgas">Treibhausgase</mark> und werden immer <mark data-lemma="günstig">günstiger</mark>. Ein <mark data-lemma="Problem">Problem</mark> bleibt jedoch die <mark data-lemma="Speicherung">Speicherung</mark>, denn die Sonne scheint nicht immer. Deshalb wird intensiv an besseren Batterien und Stromnetzen geforscht.', 43, 1700, 'published'
  where not exists (select 1 from public.texts where title = 'Erneuerbare Energien')
  returning id
)
insert into public.questions (text_id, prompt, options, correct_idx, difficulty)
select t.id, q.prompt, q.options, q.correct_idx, q.difficulty
from t, (values
  ('Za co uchodzą energie odnawialne?', array['Za przeszłość', 'Za przyszłość zaopatrzenia w energię', 'Za drogie hobby', 'Za chwilową modę'], 1, 1600),
  ('Co je wyróżnia?', array['Powodują dużo emisji', 'Powodują mało gazów cieplarnianych', 'Są coraz droższe', 'Są niedostępne'], 1, 1700),
  ('Jaki problem pozostaje?', array['Magazynowanie energii', 'Brak słońca latem', 'Zbyt wysoka cena prądu', 'Brak wiatru zimą'], 0, 1800),
  ('Nad czym się intensywnie pracuje?', array['Nad lepszymi bateriami i sieciami', 'Nad nowymi elektrowniami węglowymi', 'Nad tańszą benzyną', 'Nad importem energii'], 0, 1800)
) as q(prompt, options, correct_idx, difficulty);

-- Esskultur im Wandel (B2, 43 słów, 4 pytań)
with t as (
  insert into public.texts (title, cefr, body, word_count, difficulty, status)
  select 'Esskultur im Wandel', 'B2', 'Die <mark data-lemma="Esskultur">Esskultur</mark> hat sich in den letzten <mark data-lemma="Jahrzehnt">Jahrzehnten</mark> stark <mark data-lemma="verändern">verändert</mark>. Viele Menschen <mark data-lemma="achten">achten</mark> heute auf <mark data-lemma="regional">regionale</mark> und <mark data-lemma="nachhaltig">nachhaltige</mark> <mark data-lemma="Lebensmittel">Lebensmittel</mark>. Gleichzeitig <mark data-lemma="fehlen">fehlt</mark> oft die <mark data-lemma="Zeit">Zeit</mark> zum gemeinsamen <mark data-lemma="Kochen">Kochen</mark>. Fertiggerichte und Lieferdienste sind deshalb beliebter denn je, was auch kritisch gesehen wird.', 43, 1700, 'published'
  where not exists (select 1 from public.texts where title = 'Esskultur im Wandel')
  returning id
)
insert into public.questions (text_id, prompt, options, correct_idx, difficulty)
select t.id, q.prompt, q.options, q.correct_idx, q.difficulty
from t, (values
  ('Co bardzo się zmieniło?', array['Kultura jedzenia', 'Kultura pracy', 'Architektura', 'Moda'], 0, 1600),
  ('Na co zwraca uwagę wielu ludzi?', array['Na regionalne i zrównoważone produkty', 'Na najtańsze jedzenie', 'Na egzotyczne dania', 'Na duże porcje'], 0, 1700),
  ('Czego często brakuje?', array['Pieniędzy', 'Czasu na wspólne gotowanie', 'Przepisów', 'Sklepów'], 1, 1800),
  ('Co jest popularniejsze niż kiedykolwiek?', array['Dania gotowe i dostawy', 'Restauracje gwiazdkowe', 'Domowe wypieki', 'Targi rolne'], 0, 1700)
) as q(prompt, options, correct_idx, difficulty);

-- Der Druck, erfolgreich zu sein (B2, 46 słów, 4 pytań)
with t as (
  insert into public.texts (title, cefr, body, word_count, difficulty, status)
  select 'Der Druck, erfolgreich zu sein', 'B2', 'Viele junge Menschen <mark data-lemma="spüren">spüren</mark> einen großen <mark data-lemma="Druck">Druck</mark>, <mark data-lemma="erfolgreich">erfolgreich</mark> zu sein. <mark data-lemma="Sozial">Soziale</mark> <mark data-lemma="Medium">Medien</mark> <mark data-lemma="verstärken">verstärken</mark> dieses Gefühl, weil dort nur <mark data-lemma="perfekt">perfekte</mark> <mark data-lemma="Leben">Leben</mark> gezeigt werden. Der ständige <mark data-lemma="Vergleich">Vergleich</mark> kann zu <mark data-lemma="Angst">Angst</mark> und <mark data-lemma="Unzufriedenheit">Unzufriedenheit</mark> führen. Experten raten, eigene Ziele zu setzen und sich nicht ständig mit anderen zu messen.', 46, 1700, 'published'
  where not exists (select 1 from public.texts where title = 'Der Druck, erfolgreich zu sein')
  returning id
)
insert into public.questions (text_id, prompt, options, correct_idx, difficulty)
select t.id, q.prompt, q.options, q.correct_idx, q.difficulty
from t, (values
  ('Co odczuwa wielu młodych ludzi?', array['Nudę', 'Dużą presję na sukces', 'Brak celów', 'Spokój'], 1, 1600),
  ('Co wzmacnia to uczucie?', array['Szkoła', 'Media społecznościowe', 'Rodzina', 'Praca'], 1, 1700),
  ('Do czego może prowadzić ciągłe porównywanie?', array['Do sukcesu', 'Do lęku i niezadowolenia', 'Do motywacji', 'Do bogactwa'], 1, 1800),
  ('Co radzą eksperci?', array['Wyznaczać własne cele', 'Częściej się porównywać', 'Pracować więcej', 'Usunąć media'], 0, 1800)
) as q(prompt, options, correct_idx, difficulty);
