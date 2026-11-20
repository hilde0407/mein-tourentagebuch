# Gestaltung 2.0

Plan und Regeln für die Oberfläche ab Version 2.0.0. Wer eine Ansicht baut oder ändert, hält sich an dieses Blatt
und nimmt die Bausteine aus `js/ui.js` (Liste am Ende).

## Worum es geht

Ein persönliches Tourentagebuch auf dem Handy: Wandern, Rad, Ski. Benutzt wird es draußen, einhändig und bei Sonne –
und abends auf dem Sofa zum Nachlesen und Fotos ansehen. Vier Dinge stehen vorn:

1. Tour aufzeichnen
2. Touren ansehen und wiederfinden
3. Tour planen
4. Fotos ansehen, erinnern

Import, Statistik, Reisen und Einstellungen sind zweite Reihe.

## Grundsätze

1. **Tagebuchseite statt Kartenstapel.** Inhalte stehen direkt auf dem Papier, getrennt durch Weißraum und feine Linien.
   Keine Kästchen mit Schatten. Eine eigene Fläche bekommt nur, was wirklich über der Seite liegt: Eingabefeld, Blatt
   (Dialog), Meldung, Leiste.
2. **Zahlen wie auf dem Wegweiser.** Strecke, Aufstieg und Dauer sind der Inhalt einer Tour. Sie stehen groß, fett und
   schmal (Barlow Semi Condensed), die Einheit klein dahinter. Wo die Einheit alles sagt („3,7 km“, „↑ 168 m“), gibt es
   kein zusätzliches Etikett.
3. **Gelb heißt: los.** Wegweiser-Gelb trägt genau eine Bedeutung – die wichtigste Handlung der Seite („Aufzeichnung
   starten“, „Speichern“) und die Marke am aktiven Reiter. Gelb steht immer als Fläche mit dunkler Schrift oder auf Petrol,
   nie als Schrift oder dünne Linie auf Papier (dort wäre es in der Sonne unsichtbar). Rot heißt: Aufzeichnung läuft,
   Beenden, Löschen. Sonst ist die Seite Papier und Tinte; in Diagrammen ist der laufende Monat tintenschwarz.
4. **Lesbar in der Sonne, bedienbar mit dem Daumen.** Tinte auf Papier (14 : 1), keine grauen Flächen als Träger von
   Information, Tippflächen mindestens 44 px, die Hauptknöpfe unten.

## Farben

Sechs benannte Werte je Schema; der Rest (leiser Text, Linien, stille Flächen) ist daraus abgeleitet.

| Name        | Rolle                                              | Hell      | Dunkel    |
|-------------|----------------------------------------------------|-----------|-----------|
| Papier      | Seitengrund `--bg`                                 | `#f2f4ee` | `#081415` |
| Blatt       | Eingabefelder, Dialoge `--card`                    | `#fbfcf8` | `#0f2224` |
| Tinte       | Text, Ziffern, Symbole `--ink`                     | `#0c2526` | `#e6eeea` |
| Petrol      | Untere Leiste, Aufmacher ohne Foto `--petrol`      | `#0c2526` / `#114042` | `#0c1d1e` / `#12383a` |
| Signalgelb  | Hauptaktion, „hier“ `--yellow` (Schrift `#241d00`) | `#f2c230` | `#f2c230` |
| Glut        | Aufzeichnung läuft, Beenden, Löschen `--danger`    | `#b3261e` | `#ff9d94` (Fläche `#c43a31`) |

Abgeleitet: leiser Text `--muted` `#4d615e` / `#93aaa6`, Linie `--line` `#d3dad0` / `#1f3736`, Kante von Feldern und
Knöpfen `--edge` `#7f8f88` / `#5f7f7a` (mindestens 3 : 1), stille Fläche `--soft` `#e4e9e0` / `#17302f`,
Verweis/Diagramm `--acc` `#0f5a55` / `#7cc4b3`.

Verwandtschaft zu „Meine Touren“: derselbe Petrol-Grundton, dasselbe Gelb, dieselbe Schriftfamilie. Eigen ist das
hellere Papier, der Verzicht auf die dunkle Kopfleiste und auf Karten mit Rahmen.

## Schrift

Nur die mitgelieferten Schnitte (kein Netzabruf): **Barlow** 400/500/600 und **Barlow Semi Condensed** 600/700.

| Rolle        | Schnitt                          | Größe            | Einsatz                                   |
|--------------|----------------------------------|------------------|-------------------------------------------|
| Zahl groß    | Semi Condensed 700, Tabellenziffern | 2.5–3.6rem    | Laufzeit der Aufzeichnung, Jahresstrecke  |
| Zahl         | Semi Condensed 700, Tabellenziffern | 1.75rem       | Kennzahlen der Tour, Aufmacher            |
| Titel        | Semi Condensed 700               | 1.75rem          | Seitentitel, Tourname                     |
| Abschnitt    | Semi Condensed 600               | 1.2rem           | Überschrift eines Abschnitts              |
| Text         | Barlow 400                       | 1rem / 1.5       | Fließtext, Listen                         |
| Zeilentitel  | Barlow 600                       | 1rem / 1.25      | Tourname in der Liste, Menüeintrag        |
| Klein        | Barlow 500                       | 0.84rem          | Datum · Sportart, Etiketten unter Zahlen  |

Keine Versalien, keine gesperrten Etiketten. Überschriften in normaler Schreibweise. Alles linksbündig; zentriert sind
nur die Reiter und die Laufzeit der Aufzeichnung.

## Raster und Abstände

- Einheit 4 px. Abstände: 4 · 8 · 12 · 16 · 24 · 32.
- Seitenrand 16 px. Abschnitt zu Abschnitt 28 px. Überschrift zu Inhalt 8 px.
- Tippfläche mindestens 44 px; Hauptknöpfe 52 px, „Aufzeichnung starten“ 64 px.
- Rundungen nach Rang, nicht überall dieselbe: Bilder und Balken 6 px, Knöpfe und Felder 12 px, Blatt oben 20 px,
  Chips ganz rund.
- Schatten nur unter dem, was schwebt (Kartenknöpfe, Blatt, Meldung).
- Bewegung nur als Antwort auf eine Handlung (Blatt fährt hoch, Meldung blendet ein, Haltebalken füllt sich);
  mit „Bewegung reduzieren“ entfällt sie.

## Navigation

Fünf Reiter in einer Petrol-Leiste, „Aufnehmen“ in der Mitte als gelbe Scheibe (rot, solange eine Aufzeichnung läuft):

| Reiter     | Adresse   | Enthält                                                                    |
|------------|-----------|----------------------------------------------------------------------------|
| Start      | `#/start` | Letzte Tour, Aufzeichnen · Planen · Importieren, Sicherungs-Hinweis (nur wenn fällig), Dieses Jahr mit Zielen, Letzte Touren, An diesem Tag |
| Touren     | `#/`      | Liste, oben rechts „Karte“ (`#/map`, dort „Liste“), Suche, Filter, ＋ (Planen, Importieren, Aufzeichnen) |
| Aufnehmen  | `#/rec`   | Aufzeichnung, Route mit Ansagen                                            |
| Fotos      | `#/photos`| Alle · Ohne Tour · Karte, Diashow, Fotos hinzufügen                         |
| Mehr       | `#/mehr`  | Tour planen, Reisen & Alben, Statistik, Importieren, Foto-Quellen, Einstellungen |

Unter „Mehr → Touren importieren“ stehen die Quellen (ab 2.1.0 auch „Meine Touren“) und der Abschnitt „Aufräumen“ mit „Doppelte Touren prüfen“ (`#/doppelt`).
Ab 2.2.0: oben auf der Import-Seite die Hauptaktion „Alles abgleichen“ (gelb); auf der Startseite nur als leise Zweitaktion (kein Gelb) mit Zeile „Zuletzt abgeglichen“. Sterne der eigenen Bewertung in Tinte (`--ink`), nicht gelb, je 44 px.
Ab 2.3.0: **Jahresrückblick** (`#/jahr`, `#/jahr/<Jahr>`; unter Mehr, Reiter „Mehr“ bleibt markiert, Leiste sichtbar). Aufbau wie die Tagebuchseite: Jahreschips, das Jahr als Titel (3,6rem), die Strecke als große Zahl (3,4rem), vier weitere Zahlen darunter, dann linierte Abschnitte (Vergleich, Sportarten mit Balken in `--acc`, Höhepunkte als Zeilen, Monate). Monatsdiagramm als Inline-SVG mit `var(--mark)`/`var(--ink)` (stärkster Monat in Tinte, wie der laufende Monat sonst), Buchstaben als HTML darunter, Zahlen als `aria-label` und als Tabelle hinter „Zahlen je Monat“. Gelb nur beim Knopf „Als Bild teilen“; der Startseiten-Eintrag ist ein ruhiger Listenpunkt, im Dezember/Januar „Dein Jahr 2026“ mit drei großen Zahlen und einem Knopf ohne Gelb. Die Bildkarte (Canvas 1080 × 1350) ist immer hell: Petrolband mit Wortmarke, Jahr 250 px, Strecke 160 px, Sportartenbalken in Petrol-Abstufungen mit Prozent im Text, Monatsbalken (stärkster in Tinte); kein Gelb, keine Namen, Orte oder Fotos.
Die Seite der Doppelten trägt bewusst kein Gelb: Zusammenführen ist keine Hauptaktion, sondern eine Entscheidung je Paar – welche Tour bleibt, steht in Worten daneben.

Alle bisherigen Adressen bleiben gültig. Die Leiste bleibt sichtbar, solange man blättert (Reiter, Karte, Reisen,
Statistik); sie verschwindet, wenn man an einer Sache arbeitet (Tour, Planung, Import, Einstellungen, Flug, Korrektur).
Unterseiten haben oben links „Zurück“.

## Skizzen

Startseite – die eine mutige Stelle: Die letzte Tour füllt den Kopf der Seite randlos bis nach oben, darunter liegt
„Aufzeichnung starten“ als gelbes Wegweiserschild.

```
┌──────────────────────────────┐
│▲ Tourentagebuch              │  Wortmarke auf dem Bild
│░░░░░░░░ Foto oder Karte ░░░░░│
│░░ (ohne beides: Strecke in ░░│
│░░ Gelb über dem Höhenprofil)░│
│ Mo., 21.09.2026 · Wandern    │
│ Hüttenrunde am Wank          │  Titel
│ 3,7 km   ↑ 168 m   0:29 h    │  Zahlen wie auf dem Wegweiser
├──────────────────────────────┤
│ ┌──────────────────────────╲ │
│ │ ● Aufzeichnung starten    ╲│  Schild, gelb
│ └──────────────────────────╱ │
│ [ Tour planen ] [ Importieren ]
│                              │
│ Dieses Jahr            Ziele ›
│ 34,5 km    5 Touren  ↑ 1.593 m
│ ▁ ▁ ▂ ▁ ▁ ▁ ▁ ▅ █ ▁ ▁ ▁      │  Monate, laufender in Tinte
│ ──────────────────────────── │
│ Letzte Touren          Alle ›│
│ ▢ Zweite Tour ins Tal        │
│   Sa., 12.09. · Wandern      │
│ ──────────────────────────── │
│ (einschaltbar: Wochen-Serie, Fitness – je ein Abschnitt)
├──────────────────────────────┤
│ Start  Touren  (●)  Fotos Mehr
└──────────────────────────────┘
```

Tourenliste – ruhig, eine Zeile je Tour, keine Kästen:

```
│ Touren            [Karte]  ＋ │
│ [ Suchen …            ] [Filter 1]
│ (Alle) (★ Favoriten) (Geplant) (Wandern) …
│ 5 Touren · 34,5 km · ↑ 1.593 m
│                              │
│ September 2026     3 Touren · 15,9 km
│ ┌──────┐ Hüttenrunde am Wank ★
│ │Strecke│ Mo., 21.09. · Wandern
│ │o. Foto│ 3,7 km  ↑ 168 m  0:29 h  ▣ 3
│ └──────┘─────────────────────│
│ ┌──────┐ Zweite Tour ins Tal │
```

Tourseite – Karte oben, darunter Titel und die drei Zahlen, alles Weitere leiser:

```
│(←)                   (☆)(⋮)  │  Knöpfe schweben auf der Karte
│            Karte             │
├──────────────────────────────┤
│ Hüttenrunde am Wank          │
│ Mo., 21.09.2026 · 16:13–16:42 · Wandern
│                              │
│ 3,7 km     ↑ 168 m    0:29 h │
│ Strecke    Aufstieg   Dauer  │
│ ──────────────────────────── │
│ Abstieg 0 m      In Bewegung 29 min
│ Ø Tempo 7,6 km/h Höchster Punkt 877 m
│                              │
│ Höhenprofil                  │
│ ▁▂▃▄▅▆▇                      │
│ Fotos          Diashow  ＋   │
│ ▢ ▢ ▢ ▢                      │
│ Notiz                        │
│ [                          ] │
```

Aufzeichnen (läuft): Karte, darunter die Laufzeit sehr groß, vier Werte groß in Tinte, große Tasten, „Beenden“
abgesetzt und nur durch Halten.

## Prüfung des Plans gegen den Auftrag

Der erste Entwurf hatte weiße Karten mit 12-px-Rundung auf getöntem Grund, eine dunkle Kopfleiste und unter jeder Zahl
ein Etikett. Das wäre jede beliebige Fitness-App gewesen. Geändert:

- **Karten gestrichen.** Listen sind linierte Zeilen, Kennzahlen stehen frei. Das ist ruhiger, in der Sonne besser
  lesbar (keine blassen Rahmen) und passt zum Tagebuch.
- **Etiketten gestrichen, wo die Einheit reicht** (Aufmacher, Liste). Auf der Tourseite bleiben sie, weil dort auch
  „In Bewegung“ und „Höchster Punkt“ stehen.
- **Kein Verlauf als Schmuck.** Der einzige Verlauf liegt unter Schrift auf Fotos, damit sie lesbar bleibt. Ohne Foto
  zeigt der Aufmacher echte Daten: die Strecke und das Höhenprofil der Tour.
- **Symbole gezeichnet**, keine Emojis (auch nicht in Menüs und Überschriften).
- **Mut an einer Stelle:** der Kopf der Startseite (randloser Aufmacher, Wegweiserschild). Das Schild kehrt nur dort
  wieder, wo dieselbe Handlung steht: auf der Seite „Aufnehmen“. Alles andere bleibt Papier, Tinte, Linie.
- **Rundungen und Schatten nach Rang** statt einer Rundung für alles.

## Bausteine für weitere Arbeit (`js/ui.js`, Klassen in `app.css`)

| Aufruf                                   | Ergebnis                                                              |
|------------------------------------------|-----------------------------------------------------------------------|
| `UI.section(titel, inhalt, opts)`        | Abschnitt mit Überschrift; `opts.link`/`linkText` (Verweis rechts), `opts.id`, `opts.sub` |
| `UI.figs(werte, opts)`                   | Kennzahlenzeile; Werte `[wert, etikett]`, `opts.big`, `opts.cols`      |
| `UI.fig(wert, etikett)`                  | Eine Kennzahl (`.kpi`)                                                |
| `UI.facts(paare)`                        | Leise Wertetabelle „Etikett … Wert“ (`.facts`)                        |
| `UI.list(zeilen)` / `UI.row(opts)`       | Linierte Liste; Zeile mit `icon`, `title`, `sub`, `href`/`onclick`, `trail` |
| `UI.tourRow(tour, opts)`                 | Tourzeile mit Miniatur, Meta und Kennzahlen (Start, Liste)            |
| `UI.chip(text, an, onclick)` / `UI.chips(…)` | Chip und Chip-Reihe                                               |
| `UI.seg(optionen, aktiv, onwahl)`        | Umschalter (zwei bis vier Segmente)                                   |
| `UI.toggle(text, an, onchange, opts)`    | Schalter mit Beschriftung                                             |
| `UI.bar(anteil, opts)`                   | Fortschrittsbalken mit optionaler Soll-Marke                          |
| `UI.empty(opts)`                         | Leerer Zustand: `icon`, `title`, `text`, `actions`                    |
| `UI.banner(inhalt, aktionen)`            | Hinweis mit Handlung                                                  |
| `UI.sign(text, opts)`                    | Gelbes Wegweiserschild (nur für „Aufzeichnung starten“)               |
| `UI.menu(titel, einträge)`               | Blatt mit Aktionsliste; Einträge `[symbol, text, fn, unterzeile]`     |
| `sheet(titel, inhalt)` · `confirmBox` · `askText` · `toast` | Blatt/Dialoge wie bisher (`js/util.js`)            |
| `Ico.svg(name)` / `Ico.el(name)`         | Gezeichnetes Symbol (Namen in `js/icons.js`)                          |
| `topbar(titel, opts)`                    | Kopfzeile; `opts.back` (Unterseite), `opts.actions`, `opts.logo`      |
| `Home.add(id, reihenfolge, fn, meta)`    | Baustein der Startseite anmelden (`js/v-start.js`); `fn(ctx)` liefert ein Element oder `null`, `ctx = { all, now, year }`. `meta = { label, sub, def }` (optional) macht ihn unter Einstellungen → Startseite schaltbar; `def` ist die Vorgabe |

Reihenfolge der Startseite: Aufmacher 0 · Aktionen 10 · Sicherungs-Hinweis 12 (nur wenn fällig) · Dieses Jahr mit Zielen 20 ·
Wochen-Serie 30 (Vorgabe aus) · Fitness 35 (Vorgabe aus) · Letzte Touren 40 · Wanderführer 45 (nur mit mindestens einem Buch; eine einzige Zeile) · An diesem Tag 50.

Die Startseite soll kein Stapel werden: Ein neuer Baustein ist in der Regel **aus** (`def: false`) und zeigt höchstens
eine Kennzahlenzeile und einen Satz; die Einzelheiten stehen auf einer eigenen Seite, zu der der Verweis rechts führt.
Aufmacher, Aktionen und Sicherungs-Hinweis haben kein `meta` und lassen sich nicht abschalten. Ein neuer Baustein sieht so aus:

```js
Home.add('serie', 30, async ctx => UI.section('Wochen-Serie', UI.figs([['4 Wochen', 'in Folge'], ['11 Wochen', 'Rekord']]), { id: 'serie', link: '#/stats/bestwerte', linkText: 'Bestwerte' }),
  { label: 'Wochen-Serie', sub: 'Wochen in Folge mit mindestens einer Tour', def: false });
```

Was der Mensch ein- und ausschaltet, steht in der Einstellung `homeShow` (`{ id: true | false }`); `Home.shown(baustein)` wertet sie aus.

Abschnitte, die eine Tour einordnen (Rückblick, Plan und Ergebnis, Passt die Tour zu mir?, Fitness), folgen einem Muster:
linierte Zeilen mit einem Satz als Titel („Strecke: länger als üblich“) und den Zahlen leise darunter – das Urteil steht
immer in Worten, nie nur als Farbe. Fehlen die Daten für ein Urteil, entfällt der Abschnitt oder sagt, was fehlt;
Platzhalterwerte gibt es nicht.

Neue Seite unter „Mehr“: `Views['/name'] = async root => { root.append(topbar('Titel', { back: true }), h('div', { class: 'pad' }, …)); }`,
dazu ein Eintrag in `Nav.home` (welcher Reiter markiert ist) und eine Zeile in `Views['/mehr']` (`js/app.js`).

## Wanderführer (2.4.0)

Eine Seite unter „Mehr“ (`#/fuehrer`, `js/v-fuehrer.js`), keine neue Ebene: ein Buch ist eine **eingeklappte Karte** (`.fu-book`), die Liste klappt beim Tippen auf. Die Karte hat vier Spalten:
Titelbild (52 × 72 px, ohne Bild das Buch-Symbol `Ico.svg('book')` auf `--soft`), Name und „x von y gewandert“, **Ring** und Pfeil. Der Ring (`Buecher.ring`) ist eine eingebettete SVG-Grafik in den Farben `--soft` (offen)
und `--acc` (gewandert), die Prozentzahl steht in der Mitte (15 px, `--ink`); sie ist mit `role="img"` und `aria-label` („12 von 60 gewandert, 20 Prozent“) zugänglich, der Text darunter sagt dasselbe. Einen zusätzlichen Fortschrittsbalken gibt es nicht.
Die Tourenzeilen sind `.li`-Zeilen: gewandert = Haken im `.li-i` (`--accbg`/`--acc`) und Datum, offen = leerer Kreis und „offen · Länge · Aufstieg“ – der Zustand steht immer auch als Wort. Gelb nur beim Hauptknopf des Blatts („GPX-Dateien wählen“, „Als Planung übernehmen“)
und im leeren Zustand („Buch anlegen“). Titelbilder wählt der Mensch selbst; es wird nichts aus dem Netz geladen.

## Prüfungen

- `node tests/test_calc.js` – Rechenlogik (Ziele, Rückblick, Planungshilfe, Fitness, Jahr, Wanderführer) gegen Werte aus den Vorbildern bzw. eigene Grenzfälle.
- `python3 tests/test_web.py` – Abläufe, dazu am Ende: kein Querrollen bei 360/390/430 px und mit 130 % Schrift, Tippflächen mindestens 44 px (per Treffertest) – auch für die neuen Abschnitte und Blätter (`neue_layout`).
- Neue Seiten und Blätter kommen in die Gestaltungsprüfung (`layout_21` als Muster) und in `audit_kontrast.py`.
- `python3 tests/audit_kontrast.py --fail` – Kontrast aller Knöpfe, Felder und Texte in Hell und Dunkel (4,5 : 1; große Schrift 3 : 1).
