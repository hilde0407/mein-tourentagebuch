# Selbst bauen, prüfen und veröffentlichen (ohne Hilfe)

Diese Anleitung gilt für beide Projekte: **Mein Tourentagebuch** (Repo `hilde0407/mein-tourentagebuch`) und **Meine Touren** (Repo `hilde0407/meine-touren`). Alles läuft über GitHub Actions; auf dem eigenen Rechner ist nichts Besonderes nötig.

## 1. Das Wichtigste zuerst: Sicherungen, die nur du hast
Ohne diese Dinge kannst du keine Updates mehr veröffentlichen. Bewahre sie **nicht** im Repo auf, sondern an mindestens zwei Orten (Passwortmanager und verschlüsselter USB-Stick/Cloud-Tresor):

| Was | Wofür | Hinweis |
|---|---|---|
| Schlüsseldatei `mein-tourentagebuch.jks` | Signatur der Tagebuch-APK | Geht sie verloren, lässt sich keine App mehr über die installierte legen (Neuinstallation, Daten vorher sichern). |
| Passwörter der Schlüsseldatei und des Schlüssels, Alias `tourentagebuch` | Signieren | Stehen als Secrets bei GitHub, aber GitHub zeigt sie nicht wieder an. |
| Schlüssel von Meine Touren (Android-APK) | Signatur der Meine-Touren-APK | Eigene Secrets, siehe unten. |
| GitHub-Zugang (2-Faktor, Wiederherstellungscodes) | Zugriff auf beide Repos | Wiederherstellungscodes ausdrucken. |
| Eigene Datensicherungen (`.mtl`, Medien-Sicherung) | Deine Touren und Fotos | Gelegentlich auf einem zweiten Gerät testweise wiederherstellen. |

Diese Dateien nie veröffentlichen, per E-Mail senden oder in Chats einfügen.

## 2. Secrets bei GitHub
Repo → Settings → Secrets and variables → Actions.
- **Tagebuch:** `MT_KEYSTORE_B64` (die .jks, Base64: `base64 -w0 mein-tourentagebuch.jks`), `MT_STORE_PASS`, `MT_KEY_PASS`, `MT_KEY_ALIAS`. Einzelheiten: [signieren.md](signieren.md).
- **Meine Touren:** `ANDROID_KEYSTORE_BASE`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`.
Fehlt eines, bricht „Veröffentlichen" bewusst ab.

## 3. Der normale Ablauf einer neuen Version
1. Änderungen auf den Zweig `main` bringen (Push). Dabei laufen automatisch die Tests:
   - Tagebuch: Workflow **Android-App** (Java-Prüfungen, Browser-Tests, baut Test-APK). Dauert ~25–30 Minuten.
   - Meine Touren: Workflow **Tests** (schneller Kern).
2. Warten, bis der Lauf **grün** ist (Repo → Actions).
3. Versionsnummer vorher erhöhen: Tagebuch `android/app/build.gradle` (`versionCode` +1, `versionName`), Meine Touren `app/config.py` (`VERSION`) und die weiteren Stellen laut `docs/versionen`.
4. Actions → **Veröffentlichen** → „Run workflow" auf `main`. Das erstellt den Release `vX.Y.Z`, hängt die signierte `Tourentagebuch.apk` und die Prüfsumme `.sha256` an (Meine Touren: zusätzlich Docker-Image und APK; läuft dort erst die volle Testsuite, ~25 Minuten).
5. Unter Releases prüfen, dass die APK und die Prüfsumme dranhängen.

## 4. Wenn etwas schiefgeht
- **APK fehlt am Release** (Lauf nach dem Release gescheitert): Actions → **Android-App** → „Run workflow", Feld `tag` = `vX.Y.Z` eintragen. Das baut und hängt die APK nach.
- **Test rot, aber Code unverändert:** Ursache lesen (Lauf → fehlgeschlagener Schritt). Häufig Zeitzone (CI läuft in UTC, du in Berlin) oder ein sporadischer Browser-Fehler; einmal „Re-run failed jobs" ist erlaubt, wiederholtes Scheitern heißt echte Ursache.
- **Release lässt sich nicht löschen/ändern:** Ein falscher Release kann auf der Seite Releases manuell bearbeitet werden; besser eine neue Version nachschieben.
- **Handy lässt Update nicht zu:** Andere Signatur (Test-APK statt veröffentlichter APK). Daten sichern, deinstallieren, veröffentlichte APK installieren.
- Signatur prüfen: `apksigner verify --print-certs Tourentagebuch.apk`; Prüfsumme: `sha256sum Tourentagebuch.apk` und mit der `.sha256`-Datei vergleichen.

## 5. Kleine Änderungen selbst machen
- Texte und Einstellungen der Tagebuch-App liegen unter `android/app/src/main/assets/www/` (HTML/JS/CSS, keine Build-Kette nötig), Java unter `android/app/src/main/java/de/tourentagebuch/app/`.
- Lokal prüfen: `node tests/test_parse.js`, `node tests/test_calc.js` (schnell). Der volle Browser-Test `python3 tests/test_web.py` braucht Playwright und ~12 Minuten; die CI führt ihn ohnehin aus.
- Zeitabhängige Tests mit `TZ=UTC` ausführen, wie in der CI.

## 6. Regeln, die dich schützen
- Nie ohne grünen Lauf veröffentlichen.
- Karten: Offline-Laden nur bei Anbietern, die es erlauben (OSM-Standardkacheln nicht; OpenTopoMap-Bedingungen nachlesen).
- Komoot: Es wird nur **privat** hochgeladen; öffentlich machen nur du selbst in Komoot. Komoot-Passwort nirgends speichern oder weitergeben.
- Im Forum nur selbst posten.
