# Mein Tourentagebuch

Eigenständige Android-App: Touren, Fotos, Aufzeichnung, Planung und Routing – **alles lokal auf dem Handy**, ohne Server.

## Funktionen
- **Touren**: Liste mit Vorschau, Suche, Filter (Sport, Jahr, Favoriten, Geplant), Detail mit Karte, Höhenprofil (berührbar), Kennzahlen, Notizen, GPX-Export.
- **Karte**: alle Touren nach Sportart gefärbt, Fotos als Marker, Offline-Kacheln für den sichtbaren Ausschnitt.
- **Fotos**: Raster nach Tag, Vollbild mit Wischen und Diashow, automatische Zuordnung zu Touren per Aufnahmezeit, Position aus der Spur berechnet, wenn das Foto keine hat.
  Quellen: Galerie (auch automatisch passend zu allen Touren), beliebige Ordner, **SMB-Freigaben** (NAS, Fritz!Box), **Nextcloud/WebDAV**, Teilen-Menü, Kamera während der Aufzeichnung.
- **Aufzeichnen**: GPS im Hintergrund (Vordergrunddienst), Pause, Foto, Sprachansagen auf geplanter Route (Abbiegen, Abweichung, Restkilometer), Sicherung bei Absturz.
- **Planen**: Wegpunkte setzen, Routing auf Wegen (BRouter) je Sportart, Rundtour, Umkehren, Höhenprofil, Zeitschätzung, Speichern, GPX, „Speichern & starten“ mit Ansagen.
- **Import**: Dateien (GPX/FIT/TCX/ZIP/GZ), Komoot, Strava, Zepp/Amazfit, Bosch eBike Flow (Datei/Teilen), Garmin/Suunto/Polar/Wahoo/Coros (Export, Teilen-Menü, überwachter Ordner), Link. Duplikate werden erkannt.
- **Erzählung** (Tour öffnen → ⋮ → „Erzählung“): die Tour als Zeitleiste mit Start, Fotogruppen und Ziel, Ortsnamen (OpenStreetMap, zwischengespeichert), Fotostandorten auf der Karte und **Kommentaren zu Fotos** (lokal auf dem Handy).
- **Statistik**, **Sicherung/Wiederherstellung** (`.mtl`), Hell/Dunkel automatisch.

## Aufbau
- `android/` – Java-Hülle: WebView unter `https://app.local/`, Brücke `MTApp` (Netzwerk ohne CORS, Dateien, Fotos/EXIF, SMB, Aufnahmedienst, TTS).
- `android/app/src/main/assets/www/` – Oberfläche (HTML/CSS/JS), Daten in IndexedDB.
- `tests/` – `test_parse.js` (Parser), `test_web.py` (Playwright mit simulierter Brücke), `android/*Check.java` (Aufnahme und Ansagen).

## Bauen
Per GitHub Actions (`.github/workflows/android.yml`) oder lokal mit Android SDK: `gradle -p android assembleDebug`.
Tests: `node tests/test_parse.js`, `python3 tests/test_web.py`.

## Verkauf
Siehe [COMMERCIAL.md](COMMERCIAL.md) (Lizenzen, Kartenserver, Dienste, Schlüssel).
