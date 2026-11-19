# Mein Tourentagebuch

Eigenständige Android-App: Touren, Fotos, Aufzeichnung, Planung und Routing – **alles lokal auf dem Handy**, ohne Server.

![Startseite, Tourenliste, Tour und Aufzeichnung](docs/bilder/2.0/ueberblick.png)

## Bedienung
Fünf Reiter: **Start** (letzte Tour, Aufzeichnen · Planen · Importieren, das laufende Jahr), **Touren** (Liste und Karte), **Aufnehmen**, **Fotos**, **Mehr** (Tour planen, Reisen & Alben, Statistik, Import, Foto-Quellen, Einstellungen & Sicherung). Was sich mit 2.0 geändert hat: [docs/versionen/2.0.0.md](docs/versionen/2.0.0.md).

## Funktionen
- **Start**: die letzte Tour groß, die drei Hauptaktionen, „Dieses Jahr“ mit Jahreszielen, letzte Touren, „An diesem Tag“.
- **Touren**: Liste mit Miniatur (Foto oder Strecke), Suche, Chips (Favoriten, Geplant, Sportart), Filter (Jahr, Region), Detail mit Karte, Höhenprofil (berührbar), Kennzahlen, Notiz, GPX-Export.
- **Karte** (Touren → Karte): alle Touren nach Sportart gefärbt, Fotos als Marker, Offline-Kacheln für den sichtbaren Ausschnitt.
- **Fotos**: Raster nach Tag, Vollbild mit Wischen und Diashow, automatische Zuordnung zu Touren per Aufnahmezeit, Position aus der Spur berechnet, wenn das Foto keine hat.
  Quellen: Galerie (auch automatisch passend zu allen Touren), beliebige Ordner, **SMB-Freigaben** (NAS, Fritz!Box), **Nextcloud/WebDAV**, Teilen-Menü, Kamera während der Aufzeichnung.
- **Aufzeichnen**: GPS im Hintergrund (Vordergrunddienst), Pause, Foto, Sprachansagen auf geplanter Route (Abbiegen, Abweichung, Restkilometer), Sicherung bei Absturz.
- **Planen**: Wegpunkte setzen, Routing auf Wegen (BRouter) je Sportart, Rundtour, Umkehren, Höhenprofil, Zeitschätzung, Speichern, GPX, „Speichern & starten“ mit Ansagen.
- **Import**: Dateien (GPX/FIT/TCX/ZIP/GZ), Komoot, Strava, Zepp/Amazfit (E-Mail/Passwort oder Token für Google-, Apple- und Mi-Konten), Bosch eBike Flow (Datei/Teilen), Garmin/Suunto/Polar/Wahoo/Coros (Export, Teilen-Menü, überwachter Ordner), Link. Duplikate werden erkannt.
- **Heimatort** (Mehr → Einstellungen): Ort oder Adresse suchen und übernehmen; dient als Kartenmitte der Planung.
- **Erzählung** (Tour öffnen → ⋮ → „Erzählung“): die Tour als Zeitleiste mit Start, Fotogruppen und Ziel, Ortsnamen (OpenStreetMap, zwischengespeichert), Fotostandorten auf der Karte und **Kommentaren zu Fotos** (lokal auf dem Handy).
- **Reisen & Alben**, **Statistik** (Übersicht, Rekorde, Kalender, Auswertung, Ziele), **Sicherung/Wiederherstellung** (`.mtl`) – alle unter „Mehr“. Hell/Dunkel automatisch.

## Aufbau
- `android/` – Java-Hülle: WebView unter `https://app.local/`, Brücke `MTApp` (Netzwerk ohne CORS, Dateien, Fotos/EXIF, SMB, Aufnahmedienst, TTS).
- `android/app/src/main/assets/www/` – Oberfläche (HTML/CSS/JS ohne Framework und ohne Bauschritt), Daten in IndexedDB. `app.css` enthält das Gestaltungssystem, `js/ui.js` die Bausteine (Abschnitt, Kennzahl, Liste, Chip, Schalter, leerer Zustand …), `js/icons.js` die Symbole, `js/v-*.js` je eine Ansicht.
- `docs/gestaltung-2.0.md` – Gestaltungsregeln (Farben, Schrift, Abstände, Navigation) und die Liste der Bausteine.
- `tests/` – `test_parse.js` (Parser), `test_web.py` (Playwright mit simulierter Brücke: Abläufe, Navigation, Querrollen, Tippflächen), `audit_kontrast.py` (Kontrast in Hell und Dunkel), `android/*Check.java` (Aufnahme und Ansagen).

## Bauen
Per GitHub Actions (`.github/workflows/android.yml`) oder lokal mit Android SDK: `gradle -p android assembleDebug`.
Tests: `node tests/test_parse.js`, `python3 tests/test_web.py`, `python3 tests/audit_kontrast.py --fail`.

## Verkauf
Siehe [COMMERCIAL.md](COMMERCIAL.md) (Lizenzen, Kartenserver, Dienste, Schlüssel).

## Lizenz

MIT-Lizenz, siehe [LICENSE](LICENSE). Mitgelieferte Bibliotheken haben eigene Lizenzen (siehe [COMMERCIAL.md](COMMERCIAL.md)).

Signieren: Veröffentlichte APKs sind mit einem geheimen Schlüssel signiert (nicht im Repository). Wer selbst baut, bekommt den normalen Android-Testschlüssel; Anleitung in [docs/signieren.md](docs/signieren.md).
