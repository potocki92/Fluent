#!/usr/bin/env node
/**
 * seed-texts.mjs — standalone seeder (NOT part of the Next.js app).
 *
 * Inserts the 3 demo reading texts (original German, not from DTZ) and their
 * comprehension questions. Question difficulty is taken from ITEM_DIFFICULTY,
 * anchored on the same CEFR→Elo scale the app uses (src/lib/cefr.ts).
 * Idempotent: a text whose title already exists is skipped.
 *
 * Usage:
 *   export SUPABASE_URL=...
 *   export SUPABASE_SERVICE_KEY=...
 *   node import/seed-texts.mjs
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("✗ SUPABASE_URL and SUPABASE_SERVICE_KEY are required.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
});

// CEFR→Elo anchors (mirror of src/lib/cefr.ts CEFR_DIFFICULTY).
const CEFR_DIFFICULTY = { A1: 1100, A2: 1300, B1: 1500, B2: 1700 };

/** Per-level item difficulty: medium = band anchor, easy/hard = ±100. */
const ITEM_DIFFICULTY = Object.fromEntries(
  Object.entries(CEFR_DIFFICULTY).map(([cefr, base]) => [
    cefr,
    { easy: base - 100, medium: base, hard: base + 100 },
  ]),
);

const TEXTS = [
  {
    title: "Im Supermarkt",
    cefr: "A1",
    body:
      'Anna geht in den <mark data-lemma="Supermarkt">Supermarkt</mark>. ' +
      'Sie <mark data-lemma="kaufen">kauft</mark> <mark data-lemma="Brot">Brot</mark>, ' +
      'einen <mark data-lemma="Apfel">Apfel</mark> und <mark data-lemma="Wasser">Wasser</mark>. ' +
      "An der Kasse bezahlt sie mit Karte. Dann geht sie nach Hause.",
    questions: [
      {
        prompt: "Dokąd idzie Anna?",
        options: ["Do szkoły", "Do supermarketu", "Do lekarza", "Do pracy"],
        correct_idx: 1,
        level: "easy",
      },
      {
        prompt: "Co kupuje Anna?",
        options: ["Mleko i ser", "Tylko chleb", "Chleb, jabłko i wodę", "Owoce i warzywa"],
        correct_idx: 2,
        level: "medium",
      },
      {
        prompt: "Jak Anna płaci?",
        options: ["Gotówką", "Kartą", "Telefonem", "Nie płaci"],
        correct_idx: 1,
        level: "hard",
      },
    ],
  },
  {
    title: "Beim Arzt",
    cefr: "A2",
    body:
      'Herr Müller fühlt sich nicht <mark data-lemma="gut">gut</mark>. ' +
      'Er hat Kopfschmerzen und geht zum <mark data-lemma="Arzt">Arzt</mark>. ' +
      'Der Arzt untersucht ihn und sagt: „Sie haben eine Erkältung." ' +
      'Herr Müller bekommt ein Rezept und soll viel <mark data-lemma="Wasser">Wasser</mark> trinken.',
    questions: [
      {
        prompt: "Jak się czuje pan Müller?",
        options: ["Źle", "Bardzo dobrze", "Świetnie", "Wspaniale"],
        correct_idx: 0,
        level: "easy",
      },
      {
        prompt: "Co mu dolega?",
        options: ["Ból brzucha", "Ból głowy", "Ból nogi", "Ból zęba"],
        correct_idx: 1,
        level: "medium",
      },
      {
        prompt: "Co radzi lekarz?",
        options: ["Więcej pracować", "Jeść słodycze", "Pić dużo wody", "Biegać codziennie"],
        correct_idx: 2,
        level: "hard",
      },
    ],
  },
  {
    title: "Umzug",
    cefr: "B1",
    body:
      'Familie Schmidt zieht in eine andere <mark data-lemma="Stadt">Stadt</mark> um. ' +
      'Der Vater hat dort eine neue <mark data-lemma="Arbeit">Arbeit</mark> gefunden. ' +
      "Die Kinder sind traurig, weil sie ihre Freunde verlassen müssen. " +
      'Die neue Wohnung ist größer und liegt in einer ruhigen <mark data-lemma="Straße">Straße</mark>. ' +
      "Nach einigen Wochen fühlen sich alle wohl.",
    questions: [
      {
        prompt: "Dlaczego rodzina się przeprowadza?",
        options: [
          "Chcą mniejsze mieszkanie",
          "Ojciec znalazł nową pracę",
          "Dzieci tego chcą",
          "Z powodu pogody",
        ],
        correct_idx: 1,
        level: "easy",
      },
      {
        prompt: "Dlaczego dzieci są smutne?",
        options: [
          "Muszą zostawić przyjaciół",
          "Nie lubią nowego domu",
          "Nie chcą nowej szkoły",
          "Boją się miasta",
        ],
        correct_idx: 0,
        level: "medium",
      },
      {
        prompt: "Jaka jest nowa ulica?",
        options: ["Hałaśliwa", "Wąska", "Spokojna", "Daleko od centrum"],
        correct_idx: 2,
        level: "hard",
      },
    ],
  },

  // ── A1 ──────────────────────────────────────────────────────────────────
  {
    title: "Meine Familie",
    cefr: "A1",
    body:
      "Ich heiße Tom. Meine <mark data-lemma=\"Familie\">Familie</mark> ist nicht groß. " +
      "Mein <mark data-lemma=\"Vater\">Vater</mark> heißt Peter und meine " +
      "<mark data-lemma=\"Mutter\">Mutter</mark> heißt Sabine. Ich habe eine Schwester. " +
      "Wir <mark data-lemma=\"wohnen\">wohnen</mark> zusammen in einer " +
      "<mark data-lemma=\"Wohnung\">Wohnung</mark> in Berlin.",
    questions: [
      {
        prompt: "Jak ma na imię autor?",
        options: ["Peter", "Tom", "Sabine", "Max"],
        correct_idx: 1,
        level: "easy",
      },
      {
        prompt: "Kim jest Sabine?",
        options: ["Siostrą", "Matką", "Babcią", "Sąsiadką"],
        correct_idx: 1,
        level: "medium",
      },
      {
        prompt: "Gdzie mieszka rodzina?",
        options: ["W domu pod Berlinem", "W mieszkaniu w Berlinie", "W Monachium", "Na wsi"],
        correct_idx: 1,
        level: "hard",
      },
    ],
  },
  {
    title: "Mein Frühstück",
    cefr: "A1",
    body:
      "Am Morgen habe ich Hunger. Ich <mark data-lemma=\"essen\">esse</mark> ein " +
      "<mark data-lemma=\"Brot\">Brot</mark> mit Käse und einen " +
      "<mark data-lemma=\"Apfel\">Apfel</mark>. Ich trinke gern " +
      "<mark data-lemma=\"Kaffee\">Kaffee</mark>. Meine Tochter trinkt lieber Milch.",
    questions: [
      {
        prompt: "Co je autor na śniadanie?",
        options: ["Chleb z serem i jabłko", "Zupę", "Tylko owoce", "Ciasto"],
        correct_idx: 0,
        level: "easy",
      },
      {
        prompt: "Co pije autor najchętniej?",
        options: ["Mleko", "Herbatę", "Kawę", "Wodę"],
        correct_idx: 2,
        level: "medium",
      },
      {
        prompt: "Co woli pić córka?",
        options: ["Kawę", "Mleko", "Sok", "Herbatę"],
        correct_idx: 1,
        level: "hard",
      },
    ],
  },
  {
    title: "Das Wetter",
    cefr: "A1",
    body:
      "Heute ist das <mark data-lemma=\"Wetter\">Wetter</mark> schön. Die " +
      "<mark data-lemma=\"Sonne\">Sonne</mark> scheint und es ist " +
      "<mark data-lemma=\"warm\">warm</mark>. Morgen kommt der " +
      "<mark data-lemma=\"Regen\">Regen</mark> und es wird " +
      "<mark data-lemma=\"kalt\">kalt</mark>. Ich nehme dann eine Jacke mit.",
    questions: [
      {
        prompt: "Jaka jest dziś pogoda?",
        options: ["Pada deszcz", "Jest ładnie", "Jest zimno", "Jest mgła"],
        correct_idx: 1,
        level: "easy",
      },
      {
        prompt: "Co będzie jutro?",
        options: ["Słońce", "Śnieg", "Deszcz", "Wiatr"],
        correct_idx: 2,
        level: "medium",
      },
      {
        prompt: "Co autor weźmie jutro?",
        options: ["Parasol", "Kurtkę", "Czapkę", "Okulary"],
        correct_idx: 1,
        level: "hard",
      },
    ],
  },
  {
    title: "Im Park",
    cefr: "A1",
    body:
      "Am Samstag gehe ich in den Park. Ich <mark data-lemma=\"spielen\">spiele</mark> " +
      "mit meinem <mark data-lemma=\"Kind\">Kind</mark>. Wir sehen einen " +
      "<mark data-lemma=\"Hund\">Hund</mark> und viele " +
      "<mark data-lemma=\"Blume\">Blumen</mark>. Danach essen wir ein Eis.",
    questions: [
      {
        prompt: "Kiedy autor idzie do parku?",
        options: ["W niedzielę", "W sobotę", "W piątek", "W poniedziałek"],
        correct_idx: 1,
        level: "easy",
      },
      {
        prompt: "Z kim się bawi?",
        options: ["Z psem", "Z dzieckiem", "Z przyjacielem", "Sam"],
        correct_idx: 1,
        level: "medium",
      },
      {
        prompt: "Co jedzą na końcu?",
        options: ["Ciasto", "Lody", "Owoce", "Kanapkę"],
        correct_idx: 1,
        level: "hard",
      },
    ],
  },

  // ── A2 ──────────────────────────────────────────────────────────────────
  {
    title: "Die neue Wohnung",
    cefr: "A2",
    body:
      "Familie Koch sucht eine neue <mark data-lemma=\"Wohnung\">Wohnung</mark>. Die " +
      "<mark data-lemma=\"Miete\">Miete</mark> soll nicht zu hoch sein. Sie finden eine " +
      "Wohnung mit drei <mark data-lemma=\"Zimmer\">Zimmern</mark> und einem " +
      "<mark data-lemma=\"Balkon\">Balkon</mark>. Der " +
      "<mark data-lemma=\"Vermieter\">Vermieter</mark> ist freundlich. Nächste Woche " +
      "unterschreiben sie den Vertrag.",
    questions: [
      {
        prompt: "Czego szuka rodzina Koch?",
        options: ["Pracy", "Nowego mieszkania", "Samochodu", "Szkoły"],
        correct_idx: 1,
        level: "easy",
      },
      {
        prompt: "Co ma mieszkanie?",
        options: ["Ogród", "Garaż", "Balkon", "Basen"],
        correct_idx: 2,
        level: "medium",
      },
      {
        prompt: "Co zrobią w przyszłym tygodniu?",
        options: ["Przeprowadzą się", "Podpiszą umowę", "Zapłacą kaucję", "Pomalują ściany"],
        correct_idx: 1,
        level: "hard",
      },
    ],
  },
  {
    title: "Ein Termin beim Zahnarzt",
    cefr: "A2",
    body:
      "Frau Weber hat Zahnschmerzen. Sie ruft die Praxis an und macht einen " +
      "<mark data-lemma=\"Termin\">Termin</mark>. Am Dienstag muss sie lange im " +
      "Wartezimmer <mark data-lemma=\"warten\">warten</mark>. Der " +
      "<mark data-lemma=\"Arzt\">Arzt</mark> sagt, sie braucht ein " +
      "<mark data-lemma=\"Medikament\">Medikament</mark> gegen die Schmerzen.",
    questions: [
      {
        prompt: "Co dolega pani Weber?",
        options: ["Ból głowy", "Ból zęba", "Ból brzucha", "Gorączka"],
        correct_idx: 1,
        level: "easy",
      },
      {
        prompt: "Co robi w poczekalni?",
        options: ["Czyta", "Długo czeka", "Rozmawia", "Śpi"],
        correct_idx: 1,
        level: "medium",
      },
      {
        prompt: "Czego potrzebuje?",
        options: ["Operacji", "Leku przeciwbólowego", "Okularów", "Zwolnienia"],
        correct_idx: 1,
        level: "hard",
      },
    ],
  },
  {
    title: "Einkaufen im Kaufhaus",
    cefr: "A2",
    body:
      "Lena braucht neue <mark data-lemma=\"Kleidung\">Kleidung</mark> für den Sommer. Im " +
      "<mark data-lemma=\"Kaufhaus\">Kaufhaus</mark> probiert sie ein Kleid an. Es ist " +
      "schön, aber sehr <mark data-lemma=\"teuer\">teuer</mark>. Sie sucht etwas " +
      "<mark data-lemma=\"billig\">Billigeres</mark> und " +
      "<mark data-lemma=\"bezahlen\">bezahlt</mark> an der " +
      "<mark data-lemma=\"Kasse\">Kasse</mark> mit Karte.",
    questions: [
      {
        prompt: "Czego potrzebuje Lena?",
        options: ["Butów", "Ubrań", "Torebki", "Perfum"],
        correct_idx: 1,
        level: "easy",
      },
      {
        prompt: "Jaka jest pierwsza sukienka?",
        options: ["Tania", "Brzydka", "Droga", "Za mała"],
        correct_idx: 2,
        level: "medium",
      },
      {
        prompt: "Jak płaci Lena?",
        options: ["Gotówką", "Kartą", "Telefonem", "Czekiem"],
        correct_idx: 1,
        level: "hard",
      },
    ],
  },
  {
    title: "Mit dem Zug nach Hamburg",
    cefr: "A2",
    body:
      "Herr Braun fährt mit dem <mark data-lemma=\"Zug\">Zug</mark> nach Hamburg. Am " +
      "<mark data-lemma=\"Bahnhof\">Bahnhof</mark> kauft er eine " +
      "<mark data-lemma=\"Fahrkarte\">Fahrkarte</mark>. Der Zug hat zehn Minuten " +
      "<mark data-lemma=\"Verspätung\">Verspätung</mark>. Trotzdem kommt er " +
      "<mark data-lemma=\"pünktlich\">pünktlich</mark> zu seinem Termin.",
    questions: [
      {
        prompt: "Dokąd jedzie pan Braun?",
        options: ["Do Berlina", "Do Hamburga", "Do Monachium", "Do Kolonii"],
        correct_idx: 1,
        level: "easy",
      },
      {
        prompt: "Co kupuje na dworcu?",
        options: ["Kawę", "Gazetę", "Bilet", "Kanapkę"],
        correct_idx: 2,
        level: "medium",
      },
      {
        prompt: "Co jest prawdą o jego spotkaniu?",
        options: ["Spóźnił się", "Zdążył na czas", "Odwołał je", "Przełożył je"],
        correct_idx: 1,
        level: "hard",
      },
    ],
  },

  // ── B1 ──────────────────────────────────────────────────────────────────
  {
    title: "Die Bewerbung",
    cefr: "B1",
    body:
      "Nach dem Kurs sucht Amir eine neue <mark data-lemma=\"Stelle\">Stelle</mark>. Er " +
      "<mark data-lemma=\"schreiben\">schreibt</mark> eine " +
      "<mark data-lemma=\"Bewerbung\">Bewerbung</mark> und schickt seinen Lebenslauf an " +
      "die <mark data-lemma=\"Firma\">Firma</mark>. Eine Woche später wird er zu einem " +
      "Vorstellungsgespräch eingeladen. Er ist nervös, aber gut vorbereitet.",
    questions: [
      {
        prompt: "Czego szuka Amir?",
        options: ["Mieszkania", "Nowej posady", "Kursu", "Przyjaciół"],
        correct_idx: 1,
        level: "easy",
      },
      {
        prompt: "Co wysyła do firmy?",
        options: ["Tylko podanie", "Podanie i CV", "Tylko CV", "Referencje"],
        correct_idx: 1,
        level: "medium",
      },
      {
        prompt: "Jak się czuje przed rozmową?",
        options: ["Spokojny", "Zdenerwowany, ale przygotowany", "Pewny siebie", "Obojętny"],
        correct_idx: 1,
        level: "hard",
      },
    ],
  },
  {
    title: "Beschwerde im Restaurant",
    cefr: "B1",
    body:
      "Im <mark data-lemma=\"Restaurant\">Restaurant</mark> " +
      "<mark data-lemma=\"bestellen\">bestellt</mark> Frau Klein eine Suppe. Das Essen " +
      "kommt sehr spät und ist <mark data-lemma=\"kalt\">kalt</mark>. Sie " +
      "<mark data-lemma=\"beschweren\">beschwert</mark> sich beim Kellner. Er " +
      "entschuldigt sich und bringt eine neue Suppe. Auf der " +
      "<mark data-lemma=\"Rechnung\">Rechnung</mark> fehlt am Ende der Preis für das Getränk.",
    questions: [
      {
        prompt: "Co zamawia pani Klein?",
        options: ["Sałatkę", "Zupę", "Pizzę", "Stek"],
        correct_idx: 1,
        level: "easy",
      },
      {
        prompt: "Jaki jest problem z jedzeniem?",
        options: ["Za ostre", "Zimne i podane późno", "Za małe", "Za drogie"],
        correct_idx: 1,
        level: "medium",
      },
      {
        prompt: "Co jest nie tak z rachunkiem?",
        options: ["Jest za wysoki", "Brakuje ceny napoju", "Policzono dwa razy", "Zgubiono go"],
        correct_idx: 1,
        level: "hard",
      },
    ],
  },
  {
    title: "Müll richtig trennen",
    cefr: "B1",
    body:
      "In Deutschland ist die Mülltrennung wichtig für die " +
      "<mark data-lemma=\"Umwelt\">Umwelt</mark>. Man muss den " +
      "<mark data-lemma=\"Müll\">Müll</mark> richtig " +
      "<mark data-lemma=\"trennen\">trennen</mark>: Papier, Glas und Plastik kommen in " +
      "verschiedene Tonnen. Der neue <mark data-lemma=\"Nachbar\">Nachbar</mark> kennt die " +
      "Regeln noch nicht, deshalb erklärt man ihm die Hausordnung.",
    questions: [
      {
        prompt: "Co jest ważne dla środowiska?",
        options: ["Oszczędzanie wody", "Segregacja śmieci", "Jazda rowerem", "Cisza"],
        correct_idx: 1,
        level: "easy",
      },
      {
        prompt: "Co trafia do różnych pojemników?",
        options: ["Papier, szkło i plastik", "Tylko papier", "Jedzenie", "Ubrania"],
        correct_idx: 0,
        level: "medium",
      },
      {
        prompt: "Dlaczego sąsiad popełnia błędy?",
        options: ["Nie chce segregować", "Nie zna jeszcze zasad", "Nie ma pojemników", "Jest leniwy"],
        correct_idx: 1,
        level: "hard",
      },
    ],
  },
  {
    title: "Der Integrationskurs",
    cefr: "B1",
    body:
      "Maria besucht einen <mark data-lemma=\"Integrationskurs\">Integrationskurs</mark>. " +
      "Dort <mark data-lemma=\"lernen\">lernt</mark> sie nicht nur die deutsche " +
      "<mark data-lemma=\"Sprache\">Sprache</mark>, sondern auch viel über das Leben in " +
      "Deutschland. Am Ende des Kurses gibt es eine " +
      "<mark data-lemma=\"Prüfung\">Prüfung</mark>. Maria übt jeden Tag und hofft, dass " +
      "sie sie besteht.",
    questions: [
      {
        prompt: "Co robi Maria?",
        options: ["Pracuje", "Chodzi na kurs integracyjny", "Studiuje", "Podróżuje"],
        correct_idx: 1,
        level: "easy",
      },
      {
        prompt: "Czego się uczy oprócz języka?",
        options: ["Gotowania", "O życiu w Niemczech", "Historii", "Matematyki"],
        correct_idx: 1,
        level: "medium",
      },
      {
        prompt: "Co jest na końcu kursu?",
        options: ["Wycieczka", "Egzamin", "Dyplom od razu", "Impreza"],
        correct_idx: 1,
        level: "hard",
      },
    ],
  },

  // ── B2 ──────────────────────────────────────────────────────────────────
  {
    title: "Arbeiten im Homeoffice",
    cefr: "B2",
    body:
      "Seit der Pandemie arbeiten viele Menschen im Homeoffice. Das hat " +
      "<mark data-lemma=\"Vorteil\">Vorteile</mark>: Man spart Zeit für den Weg zur " +
      "<mark data-lemma=\"Arbeit\">Arbeit</mark> und kann flexibler planen. Es gibt aber " +
      "auch <mark data-lemma=\"Nachteil\">Nachteile</mark>. Der Kontakt zu den " +
      "<mark data-lemma=\"Kollege\">Kollegen</mark> fehlt, und die Grenze zwischen Beruf " +
      "und Privatleben wird unklar. Wichtig ist deshalb eine gute Selbstdisziplin.",
    questions: [
      {
        prompt: "Od kiedy wielu ludzi pracuje zdalnie?",
        options: ["Od pandemii", "Od zawsze", "Od roku", "Od lata"],
        correct_idx: 0,
        level: "easy",
      },
      {
        prompt: "Jaka jest zaleta pracy zdalnej?",
        options: ["Wyższa pensja", "Oszczędność czasu na dojazd", "Więcej kontaktów", "Mniej pracy"],
        correct_idx: 1,
        level: "medium",
      },
      {
        prompt: "Co jest wadą według tekstu?",
        options: ["Brak komputera", "Brak kontaktu z kolegami", "Niższa pensja", "Za dużo spotkań"],
        correct_idx: 1,
        level: "hard",
      },
    ],
  },
  {
    title: "Gesunde Ernährung",
    cefr: "B2",
    body:
      "Eine gesunde <mark data-lemma=\"Ernährung\">Ernährung</mark> ist die Grundlage für " +
      "ein langes Leben. Wer viel <mark data-lemma=\"Gemüse\">Gemüse</mark> und Obst isst " +
      "und wenig Zucker zu sich nimmt, bleibt länger " +
      "<mark data-lemma=\"gesund\">gesund</mark>. Auch regelmäßiger " +
      "<mark data-lemma=\"Sport\">Sport</mark> spielt eine große Rolle. Vielen Menschen " +
      "fällt es trotzdem schwer, alte Gewohnheiten zu ändern.",
    questions: [
      {
        prompt: "Co jest podstawą długiego życia?",
        options: ["Sen", "Zdrowe odżywianie", "Praca", "Podróże"],
        correct_idx: 1,
        level: "easy",
      },
      {
        prompt: "Co służy zdrowiu według tekstu?",
        options: ["Dużo cukru", "Warzywa i owoce", "Fast food", "Kawa"],
        correct_idx: 1,
        level: "medium",
      },
      {
        prompt: "Dlaczego ludziom jest trudno?",
        options: ["Brak wiedzy", "Trudno zmienić stare nawyki", "Brak pieniędzy", "Brak czasu"],
        correct_idx: 1,
        level: "hard",
      },
    ],
  },
  {
    title: "Ehrenamtliche Arbeit",
    cefr: "B2",
    body:
      "Immer mehr Menschen engagieren sich <mark data-lemma=\"freiwillig\">freiwillig</mark> " +
      "in einem <mark data-lemma=\"Verein\">Verein</mark>. Sie " +
      "<mark data-lemma=\"helfen\">helfen</mark> zum Beispiel älteren Nachbarn, geben " +
      "Sprachunterricht oder organisieren Feste. Diese Arbeit wird nicht " +
      "<mark data-lemma=\"bezahlen\">bezahlt</mark>, bringt aber viel " +
      "<mark data-lemma=\"Erfahrung\">Erfahrung</mark> und neue Kontakte. Für die " +
      "<mark data-lemma=\"Gesellschaft\">Gesellschaft</mark> ist dieses Engagement sehr wertvoll.",
    questions: [
      {
        prompt: "Gdzie angażują się ludzie?",
        options: ["W firmie", "W stowarzyszeniu", "W szkole", "W urzędzie"],
        correct_idx: 1,
        level: "easy",
      },
      {
        prompt: "Jak opłacana jest ta praca?",
        options: ["Dobrze", "Wcale", "Słabo", "Zależnie od godzin"],
        correct_idx: 1,
        level: "medium",
      },
      {
        prompt: "Co daje ta praca według tekstu?",
        options: ["Pieniądze", "Doświadczenie i kontakty", "Sławę", "Awans"],
        correct_idx: 1,
        level: "hard",
      },
    ],
  },
  {
    title: "Verkehr und Umwelt",
    cefr: "B2",
    body:
      "Der wachsende <mark data-lemma=\"Verkehr\">Verkehr</mark> in den Städten belastet " +
      "die <mark data-lemma=\"Umwelt\">Umwelt</mark>. Viele Menschen lassen deshalb das " +
      "<mark data-lemma=\"Auto\">Auto</mark> stehen und fahren mit dem " +
      "<mark data-lemma=\"Fahrrad\">Fahrrad</mark> oder nutzen öffentliche " +
      "Verkehrsmittel. Die Städte bauen mehr Radwege aus und verbessern so die " +
      "<mark data-lemma=\"Luft\">Luft</mark>. Trotzdem bleibt der Umstieg für viele eine " +
      "Herausforderung.",
    questions: [
      {
        prompt: "Co obciąża środowisko w miastach?",
        options: ["Hałas", "Rosnący ruch", "Śmieci", "Turyści"],
        correct_idx: 1,
        level: "easy",
      },
      {
        prompt: "Jak ludzie przemieszczają się zamiast autem?",
        options: ["Pieszo", "Rowerem lub komunikacją", "Taksówką", "Pociągiem dalekobieżnym"],
        correct_idx: 1,
        level: "medium",
      },
      {
        prompt: "Co robią miasta?",
        options: ["Budują parkingi", "Rozbudowują ścieżki rowerowe", "Zakazują aut", "Podnoszą podatki"],
        correct_idx: 1,
        level: "hard",
      },
    ],
  },
  {
    title: "Energie sparen zu Hause",
    cefr: "B2",
    body:
      "Die Preise für <mark data-lemma=\"Energie\">Energie</mark> sind stark gestiegen. " +
      "Viele Haushalte versuchen deshalb, <mark data-lemma=\"Strom\">Strom</mark> und " +
      "Heizkosten zu <mark data-lemma=\"sparen\">sparen</mark>. Man kann zum Beispiel die " +
      "<mark data-lemma=\"Heizung\">Heizung</mark> niedriger stellen, Lampen mit LED " +
      "nutzen und Geräte ganz ausschalten. Solche Maßnahmen schonen nicht nur den " +
      "Geldbeutel, sondern auch das <mark data-lemma=\"Klima\">Klima</mark>.",
    questions: [
      {
        prompt: "Co wzrosło według tekstu?",
        options: ["Czynsze", "Ceny energii", "Podatki", "Pensje"],
        correct_idx: 1,
        level: "easy",
      },
      {
        prompt: "Jak można oszczędzać?",
        options: ["Mocniej grzać", "Niżej ustawić ogrzewanie", "Włączyć więcej urządzeń", "Dłużej świecić"],
        correct_idx: 1,
        level: "medium",
      },
      {
        prompt: "Co chronią te działania?",
        options: ["Tylko portfel", "Portfel i klimat", "Tylko klimat", "Zdrowie"],
        correct_idx: 1,
        level: "hard",
      },
    ],
  },
];

/** Rough word count from the body with HTML tags stripped. */
function countWords(body) {
  return body
    .replace(/<[^>]+>/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

async function main() {
  let inserted = 0;
  let skipped = 0;

  for (const t of TEXTS) {
    const { data: existing } = await supabase
      .from("texts")
      .select("id")
      .eq("title", t.title)
      .maybeSingle();

    if (existing) {
      console.log(`· "${t.title}" already exists — skipping`);
      skipped++;
      continue;
    }

    const { data: text, error: tErr } = await supabase
      .from("texts")
      .insert({
        title: t.title,
        cefr: t.cefr,
        body: t.body,
        word_count: countWords(t.body),
        difficulty: CEFR_DIFFICULTY[t.cefr],
      })
      .select("id")
      .single();
    if (tErr || !text) {
      console.error(`✗ failed to insert "${t.title}": ${tErr?.message}`);
      continue;
    }

    const rows = t.questions.map((q) => ({
      text_id: text.id,
      prompt: q.prompt,
      options: q.options,
      correct_idx: q.correct_idx,
      difficulty: ITEM_DIFFICULTY[t.cefr][q.level],
    }));

    const { error: qErr } = await supabase.from("questions").insert(rows);
    if (qErr) {
      console.error(`✗ failed to insert questions for "${t.title}": ${qErr.message}`);
      continue;
    }

    inserted++;
    console.log(`✓ "${t.title}" (${t.cefr}) + ${rows.length} questions`);
  }

  console.log(`\nDone. inserted: ${inserted} · skipped: ${skipped}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
