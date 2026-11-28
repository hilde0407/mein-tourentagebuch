# Leitfaden: Begriffe und Bedienlogik (Meine Touren und Mein Tourentagebuch)

Stand 28.11.2026 (Tagebuch 2.24.2; Kopie des bestätigten Leitfadens, an die Fassung aus Meine Touren 3.70.1 angeglichen). Gilt für beide Apps, für alle sichtbaren Texte (Knöpfe, Überschriften, Hinweise, Meldungen, Tooltips, aria-label), das Handbuch und die Versionsnotizen. Von Volker entschieden sind die mit ★ markierten Punkte; der Rest folgt dem, was in den Apps heute überwiegt (Inventur vom 25.11.2026). Regeln 15 bis 17 und Abschnitt 4 gelten nur im Tourentagebuch.

Interne Bezeichner (Dateinamen, Funktionen, Einstellungsschlüssel, API-Pfade, Element-IDs) bleiben unverändert. Begriffe fremder Dienste bleiben, wie der Dienst sie nennt (Strava „Aktivitäten“, Suunto „Workouts“ nur, wenn der Dienst genau so genannt wird).

## 1. Begriffe: ein Wort je Sache

| Sache | So heißt es | Nicht mehr |
| --- | --- | --- |
| Art der Tour ★ | Sportart, Sportarten | Aktivität, Sport |
| Tour per GPS mitschreiben ★ | aufzeichnen, Aufzeichnung („Tour aufzeichnen“, „Aufzeichnung läuft“) | aufnehmen, Aufnahme, Tracking (für GPS) |
| Foto oder Video machen | aufnehmen, Aufnahme | – |
| Stichwort an einer Tour ★ | Schlagwort, Schlagwörter („Schlagwörter & Alben“) | Tag, Tags, Label, Schlagworte |
| Beste Werte ★ | Bestwerte | Rekorde |
| Gegangene oder gefahrene Tour | Tour | Training, Workout, Aktivität (außer als Name eines Dienstes) |
| Linie auf der Karte, GPS-Daten | Strecke (die Linie), GPS-Track nur für die Datei bzw. das Korrigieren | Route für Gegangenes |
| Tour, die noch bevorsteht | geplante Tour; die Funktion heißt „Planung“ | Plan, Pläne (für die Tour selbst) |
| Soll bei Zielen | „im Soll“ | „im Plan“ |
| Messwert Länge | Strecke | Distanz, Länge |
| Messwert Höhe nach oben | Aufstieg | Höhenmeter, Anstieg, hm |
| Messwert Zeit gesamt | Dauer | Zeit, Gesamtzeit, Zeit unterwegs, Stunden unterwegs |
| Messwert Zeit ohne Pausen | Bewegungszeit | Zeit in Bewegung |
| Geschätzte Zeit einer geplanten Tour | Gehzeit (zu Fuß) bzw. Fahrzeit | – |
| Tage mit mindestens einer Tour | aktive Tage | Tage mit Tour |
| Bild aus der Kamera | Foto | Bild (außer „Titelbild“, „Bild teilen“ für erzeugte Grafiken) |
| Daten vom Portal oder von der Uhr | holen („Touren holen“) | laden, einlesen, abgleichen (dafür) |
| Daten aus einer Datei | importieren | laden, einlesen |
| Vorhandenes vergleichen und angleichen (Tagebuch ↔ Meine Touren, Komoot) | abgleichen, Abgleich | Sync, synchronisieren |
| Höhe einer Tour verbessern | „Höhe korrigieren“ (Quelle im Untertitel: „aus der Uhr“, „aus dem Geländemodell“) | „Höhe aus Uhr abgleichen“, „Höhen korrigieren“ |
| Datei erzeugen | exportieren („Als GPX exportieren“, „Als PDF exportieren“) | „Als GPX speichern“, „GPX-Datei laden“ |
| Kopie aller Daten | Sicherung, sichern, wiederherstellen | Backup, Datensicherung |
| Einstellungsbereich | Meine Touren: „Verwaltung“; Tagebuch: „Einstellungen“ (Seitentitel gleich dem Menüpunkt) | gemischte Titel |
| Teil einer Seite, den man anordnen kann | Baustein | Abschnitt, Kachel, Widget (für dasselbe) |
| Gespeicherte Anordnung einer Seite | Ansicht | Seitenlayout, Layout |
| Dieselbe Tour mehrfach vorhanden (2.23.0) | „mögliche doppelte Tour“ (Zählung: eine Gruppe = eine Tour, auch bei drei oder mehr Einträgen); Knopf „Keine Doppelten“; Seite „Doppelte Touren prüfen“ | „Duplikat“, „Dublette“ |
| Beim Import nicht angelegte Tour (2.24.1) | „übersprungen, schon vorhanden“ (Zähler in der Abschlussmeldung: „3 übersprungen, schon vorhanden“); war sie früher da und wurde gelöscht: „früher gelöscht, nicht wieder importiert“; Liste „Beim Import übersprungen“ (Mehr → Import → Aufräumen) | „Duplikat“, „doppelt importiert“, „ignoriert“, „abgelehnt“ |
| Zusammenfassung von Sportarten ★ | Statistik-Gruppe (Anzeige: nur der Name, z. B. „Wandern (gesamt)“; die Zusammensetzung „Name = A + B + C“ nur im Tooltip/title bzw. aria-label und in Verwaltung bzw. Einstellungen → Sportarten; der Name ist immer ein kurzer, echter Name – Vorschlag „<Sportart> (gesamt)“, nie eine Aufzählung „A + B + C“; ein alter Aufzählungsname wird nicht stillschweigend geändert, sondern mit „Vorschlag übernehmen“ angeboten) | „zusammengefasst“, „Gruppe“ ohne Zusatz, Aufzählung als Name |
| Baustein von der Seite nehmen (3.66.0) ★ | „Entfernen“ (Rückfrage „Baustein entfernen?“); zurückholen: „Baustein hinzufügen“ → „Wieder hinzufügen“. Intern speichert die App mitgelieferte Bausteine weiter als „ausgeblendet“ (Feld hidden), das ist nie Wortlaut der Oberfläche | „Ausblenden“, „Einblenden“, „ausgeblendet“ (für Bausteine); „Ausblenden“ bleibt für Hinweise (für N Tage) und Strecken-Anfang/Ende |
| Anordnung aller Seiten zurücksetzen (3.66.0) | „Alle Seiten auf Werkseinstellung zurücksetzen …“ (Ansichten-Dialog, Verwaltung → Allgemein → Seitenanordnung); eine Seite: „Standard wiederherstellen“ (mit eigener Standardansicht zusätzlich „Auf meine Standardansicht“ / „Auf die Werkseinstellung“) | „Alles zurücksetzen“, „Reset“ |
| Mehrere Bausteine unter einer Überschrift | Bausteingruppe | „Gruppe“ ohne Zusatz |
| Sportarten für die Aufzeichnung | Favoriten-Sportarten | „Favoriten“ ohne Zusatz |
| Tour mit Stern | Lieblingstour bzw. Bewertung (Sterne) | Favorit |
| Startbildschirm | Meine Touren: „Übersicht“; Tagebuch: „Start“ (Seitentitel gleich dem Reiter) | Dashboard |
| Erster Reiter der Verwaltung (Meine Touren) | „Allgemein“ | „Übersicht“ (doppelt belegt) |
| Jahresauswertung | Jahresrückblick | Rückblick ohne „Jahres“ (wenn das Jahr gemeint ist) |
| Gebirge, Tal, Insel, Küste, Landschaft einer Tour (eingebaute Tabelle) | Gebiet, Gebiete („Alle Gebiete“); Land und Bundesland bleiben „Region“ („Alle Regionen“) | „Gegend“, „Landschaft“ als Filtername |
| Von dir angelegtes Gebiet (Rechteck, Name, Typ) | „Eigenes Gebiet“, Kennzeichen „eigen“; Knöpfe „＋ Gebiet hinzufügen …“, „✎ Gebiet bearbeiten“, „Löschen“ | „Benutzerdefiniertes Gebiet“, „Custom“, „Zone“, „Bereich“ |
| Seite mit den Zahlen eines Gebiets (#/areas, #/area/…) | Menüpunkt und Seitentitel „Gebiete“; ein einzelnes Gebiet: „Gebiet“ | „Gegenden“, „Orte“ (Orte sind die Meistbesuchten Orte) |
| Zeitraum ohne Grenze | „Gesamte Zeit“ | „Alle Jahre“, „Gesamt“ |
| Alle Sportarten im Filter | „Alle Sportarten“ | „Alle“, „alle Sportarten“ |
| Verbindung zu einem Dienst beenden | „Verbindung trennen“; Zustand „Verbunden mit …“ | „Trennen“, „Abmelden“, „Angemeldet als“ |

## 2. Bedienlogik: eine Regel je Muster

1. **Dialogknöpfe:** links „Abbrechen“ (unauffällig), rechts die Hauptaktion (hervorgehoben, bei Gefahr rot). Die Hauptaktion nennt, was passiert: „Speichern“, „Löschen“, „Exportieren“, „Holen“. Nicht mehr: „OK“, „Übernehmen“, „Anwenden“. „Fertig“ nur zum Verlassen eines Modus ohne Speichern-Schritt (Filter, „Seite anpassen“). Jedes Bearbeiten-Blatt hat „Abbrechen“ und „Speichern“ (nicht nur ✕). Keine Browser-Fenster (`prompt`, `confirm`, `alert`), nur eigene Dialoge.
2. **Löschen und Entfernen:** „Löschen“ = Daten sind weg; „Entfernen“ = nur eine Zuordnung endet (Tour aus Album, Sportart aus Gruppe). Seit 3.66.0 gehört auch „Baustein von der Seite entfernen“ dazu; weil dabei Einstellungen verloren gehen können, fragt es nach („Baustein entfernen?“) – hinzugefügte Bausteine sind danach weg, mitgelieferte stehen im Katalog als „Wieder hinzufügen“. Löschen fragt immer nach: Titel als Frage mit Fragezeichen und dem Namen der Sache, Knopf „Löschen“ (rot). Der Text sagt, was verloren geht und ob es sich zurückholen lässt. Entfernen fragt nicht nach, bietet aber wo möglich „Rückgängig“ an.
3. **Zurücksetzen:** heißt überall „Standard wiederherstellen“, mit Rückfrage. Ausnahme ab 3.66.0: Bei „Alle Seiten“ heißt es „Alle Seiten auf Werkseinstellung zurücksetzen …“ (Auslassung, weil ein Dialog mit Kontrollkästchen folgt); Werkseinstellung = die mitgelieferte Anordnung, „Standard“ = die Standardansicht (mitgeliefert oder von dir festgelegt). Bei zwei Wegen stehen zwei benannte Knöpfe im selben Dialog (Abbrechen links, Hauptaktion rechts, Gefahr rot) statt einer Verschachtelung.
4. **Speichern in Einstellungen:** Schalter und Auswahlen speichern sofort; Texteingaben und Listen-Editoren (Gruppen, Favoriten, Ziele) haben „Speichern“. Innerhalb eines Bereichs nur ein Weg. Meine Touren behält die Leiste „Einstellungen speichern“ für die Formularfelder der Verwaltung; was sofort speichert, steht dort nicht in demselben Abschnitt wie Felder, die die Leiste brauchen, oder ist als „wird sofort gespeichert“ gekennzeichnet.
5. **Rückmeldungen:** Erfolg „<Sache> gespeichert“ (ohne ✓, ohne Punkt; ebenso „gelöscht“, „exportiert“, „geholt“, „wiederhergestellt“). Fehler „<Vorgang> nicht möglich: <Grund>“. Läuft schon: „<Vorgang> läuft schon“. Im Tagebuch als Toast, in Meine Touren als Meldung an der Stelle der Aktion.
6. **Sportart wählen ★, zwei feste Muster:** *Filtern* (Statistik, Karte, Tourenliste, Bausteine): Chips, zuerst „Alle Sportarten“, dann die Statistik-Gruppen, dann die Sportarten in Katalog-Reihenfolge mit Kategorie-Überschrift, nur Sportarten mit Touren, Farbpunkt = Streckenfarbe. *Zuweisen* (Tour, Ziel, Planung, Aufzeichnen): Favoriten-Sportarten zuerst, dann „Mehr …“ mit allen Sportarten nach Kategorien; die zuletzt benutzte ist vorgewählt. Je Muster eine gemeinsame Funktion.
7. **Zeitraum wählen:** überall dieselbe Liste und Reihenfolge: „Gesamte Zeit“, dann die Jahre absteigend (dazu, wo vorhanden, „Letzte 12 Monate“, „Letzte 90 Tage“, „Eigener Zeitraum“).
8. **Wiederkehrende Aktionen an einer Tour:** gleiche Namen und Reihenfolge in Knopfleiste und Menü: Bearbeiten, Schlagwörter & Alben, Teilen, Exportieren, Löschen (zuletzt, rot). Menüpunkte, die einen weiteren Dialog öffnen, enden auf „ …“.
9. **Wegangaben in Hinweisen:** „Verwaltung → <Reiter> → <Bereich>“ bzw. „Mehr → Einstellungen → <Bereich>“, mit genau den Namen, die dort stehen.
10. **Schreibweisen:** Auslassung „ …“ (mit Leerzeichen davor), Anführungszeichen „…“, Pfeil „→“. Knöpfe beginnen groß. Einheiten und Datum nur über die zentrale Formatfunktion: km, m, „Std.“ und „Min.“; Datum TT.MM.JJJJ, auch bei Eingaben. Mehrzahl ausschreiben statt „Foto(s)“. Symbole an Knöpfen: je App ein System (Tagebuch SVG-Symbole, keine Emoji in Knöpfen; Meine Touren wie bisher, aber dieselbe Aktion immer mit demselben Symbol).
11. **Gebiet wählen (Filter):** Auswahlfeld „Alle Gebiete“; es öffnet ein Blatt mit Suchfeld und Liste nach Typ (Gebirge, Täler, Inseln, Küsten, Landschaften) mit Anzahl Touren, nur Gebiete mit Touren; „Alle Gebiete“ hebt auf, Enter wählt den ersten Treffer. Eine gemeinsame Funktion (`gebietOpts`, `gebietSheetOpen`, `inGebiet`).
12. **Gebiet anlegen oder ändern (ab 3.65.0):** Der Knopf heißt „＋ Gebiet hinzufügen …“ (Auslassung, weil ein Fenster folgt), im Fenster „Suchen“, „Von Hand anlegen …“, „Kartenausschnitt übernehmen“, „Abbrechen“, „Speichern“; Löschen mit Rückfrage und benanntem Knopf „Löschen“ (danger). Eigene Gebiete stehen in Liste, Filter und Suche wie eingebaute und tragen das Kennzeichen „eigen“; die Quelle steht auf der Gebietsseite („Eigenes Gebiet“, „Eingebautes Gebiet“). Der Gebiet-Name in der Regionszeile ist immer ein Link auf die Tourenliste mit dem Filter (`regionHtml`, `01-grundlagen.js`).
13. **Touren für eine Reise wählen (ab 3.67.0):** Dialog „Reise erstellen“ / „Reise bearbeiten“: nichts vorgewählt; Touren nach Tag („Nach Tag“) oder Gebiet („Nach Gebiet“) gruppiert, neueste zuerst, je Zeile Datum, Name, Ort/Gebiet, Strecke; „Zeitraum markieren:“ mit Knopf „Markieren“ (nie automatisch beim Ändern der Daten); Gruppenkopf mit Kontrollkästchen (teilweise gewählt sichtbar); „Alle“/„Keine“ nur für die gefilterte Liste; Summenzeile „n Touren · Zeitraum · Gebiete“ immer sichtbar; Warnungen („wirklich eine Reise?“) nie blockierend; Kennzeichen „in Reise „X““ bzw. „in eigener Reise „X““ (Letzteres gesperrt). Dasselbe Muster gilt für künftige Auswahllisten von Touren (z. B. Mehrtagestour bilden, Album).
14. **Gebiet auf der Fotos-Seite, Hinweis, Rückblick (ab 3.68.0):** Auf der Fotos-Seite gilt derselbe Filter „Alle Gebiete“ wie in der Tourenliste (Blatt mit Suchfeld, Adresse `?g=`); Fotos ohne Tour haben kein Gebiet. Der Hinweis „Diese Reise liegt in n Gebieten/Ländern … Wirklich eine Reise?“ ist ruhig, sperrt nichts und führt über „Reise bearbeiten“ zur Änderung. Der Baustein heißt „Vor einem Jahr in dieser Gegend“ („Neu mischen“ wie bei Erinnerungen; leer = unsichtbar). Sammelknopf der Übersicht: „Alle Touren holen“.
15. **Einstellungen gliedern (Tagebuch, seit 2.22.0):** Übersicht mit einer Zeile je Gruppe (Titel + ein Satz zum aktuellen Stand, in Listen von Statistik-Gruppen nur der Name), die Gruppe als Unterseite mit Zurück-Pfeil; lange Listen (Katalog, Favoriten, Statistik-Gruppen) liegen eine Ebene tiefer oder sind einklappbar. Zurück und Android-Zurücktaste führen genau eine Ebene hoch. Wegangaben nennen die Gruppe: „Mehr → Einstellungen → Sicherung“.
16. **Hinweise nach Importen (Tagebuch, seit 2.23.0):** Nach einem Import weist die App ruhig auf Folgen hin (Startseite, Baustein mit „Prüfen“ und „Später“, bei jedem Aufbau neu bewertet, verschwindet von selbst), nie mit einem Dialog, der den Import unterbricht; die Abschlussmeldung darf einen Satz ergänzen. Zahl und Wort bleiben mit geschütztem Leerzeichen zusammen („3 mögliche doppelte Touren“).

17. **Doppelt-Prüfung beim Import (Tagebuch, seit 2.24.1):** Jeder Weg, der Touren anlegt, prüft vor dem Anlegen (`ImportDup`, `Tours.add`): gleiche Quell-Kennung, gleicher Strecken-Abdruck, gleiche Startzeit (± 5 Minuten) mit ähnlicher Strecke am selben Ort, bei Touren ohne Zeit die gleiche Form. Eine vorhandene Tour wird übersprungen und gezählt („3 übersprungen, schon vorhanden“), nie still doppelt angelegt und nie still überschrieben. Eine gelöschte Tour merkt sich die App (Stein); beim automatischen Holen bleibt sie gelöscht, bei einem Import von Hand fragt die App einmal für alle: „Diese Tour war schon vorhanden und wurde gelöscht – trotzdem importieren?“ (Abbrechen links, „Importieren“ rechts). Übersprungenes steht in der Liste „Beim Import übersprungen“. Löschen geplanter Touren: derselbe Knopf, dieselbe Rückfrage und Meldung wie bei gemachten Touren („Geplante Tour „…“ löschen?“, „Geplante Tour gelöscht“).

## 3. Regeln für künftige Änderungen
- Neue Texte prüfen: steht die Sache in Tabelle 1, gilt das Wort dort.
- Beide Apps bekommen für dieselbe Funktion denselben Namen und dasselbe Bedienmuster.
- Je App prüft ein Test die verbotenen Wörter aus Tabelle 1 in sichtbaren Texten (mit einer kurzen Ausnahmeliste für Dienstnamen).

## 4. Im Tourentagebuch
- Den Wächter für Tabelle 1 und die Bildzeichen an Knöpfen führt `tests/test_begriffe.js` (`node tests/test_begriffe.js`, mit `-v` auch die begründeten Ausnahmen). Neue Ausnahmen nur mit Grund in der Regel selbst.
- Gemeinsame Bausteine statt eigener Varianten: `UI.sportChips` (Sportart filtern), `UI.sportWahl` (Sportart zuweisen), `confirmBox` (Rückfrage; „Löschen“ rot), `F` und `anz` in `js/util.js` (Formate, Ein- und Mehrzahl).
- Was 2.20.0 umgestellt hat und was bewusst blieb: `docs/versionen/2.20.0.md`.
- Ergänzungen 2.24.0 (Prüfbericht vom 28.11.2026), nur im Tagebuch:
  - Regel 1: Die Hauptaktion eines Dialogs ist rot, wenn Daten verloren gehen: „Löschen“, „Verwerfen“, „Leeren“ automatisch, sonst `confirmBox(…, { gefahr: true })` („Zusammenführen“, „Ersetzen“, „Alle Fotos neu zuordnen“). Jedes Blatt mit Eingaben hat links „Abbrechen“; offene Blätter halten den Fokus (Seite dahinter `inert`, Tab bleibt im Blatt).
  - Regel 3: Suche und Filter (Tourenliste) heißen „Zurücksetzen“ und fragen nicht nach, weil dabei nichts verloren geht; „Standard wiederherstellen“ mit Rückfrage gilt für Einstellungen und Anordnungen.
  - Regel 4: Ausnahme für kurze Einzelfelder in den Einstellungen (Maximalpuls, Geburtsjahr, Kachel-Adresse, Schlüssel, Routing-Server, Profil): Sie speichern beim Verlassen des Felds, ohne eigenen Knopf (ein offenes Feld soll beim Zurückgehen nichts verlieren), und bestätigen es sichtbar mit einer Meldung („Maximalpuls gespeichert“, „… entfernt“); ungültige Werte werden abgelehnt („Maximalpuls speichern nicht möglich: …“). Listen-Editoren (Statistik-Gruppen, Favoriten-Sportarten, Ziele) behalten „Speichern“ bzw. speichern je Änderung mit Meldung.
  - Regel 5: Fehler laufen über `toastFehler('<Vorgang>', e)` bzw. `fehlerText(…)` in `js/util.js` – nie die rohe Systemmeldung allein, nie „✓“ in einer Meldung; `tests/test_begriffe.js` prüft beides.
  - Regel 10: Tippflächen mindestens 48 px (CSS-Variable `--tipp`, Chips 44 px sichtbar mit 48 px Trefferfläche); Zahlen mit Tausenderpunkt und Dezimalkomma (`F.km`, `F.m`), Koordinaten mit Komma und Himmelsrichtung (`F.koord`: „47,12300° N · 9,10000° O“), Tempo `F.kmh`.
  - Seitentitel: Start heißt für Hilfstechnik „Start“ (verborgene Überschrift über dem Aufmacher); die Statistik-Reiter sind echte Reiter (`UI.reiter`, role „tablist“/„tab“).
  - Die geschätzte Zeit einer geplanten Tour heißt „Geschätzte Gehzeit“ bzw. „Geschätzte Fahrzeit“ (`Planhilfe.zeitName`).
