# Hinweise für einen kommerziellen Vertrieb

Dies ist eine technische Checkliste, **keine Rechtsberatung**. Vor einem Verkauf (z. B. Google Play) bitte rechtlich prüfen lassen.

## 1. Eigene Rechte
- Der Quellcode dieses Projekts ist eigenständig und enthält keinen GPL-Code. Eine Lizenz für den Verkauf (z. B. „Alle Rechte vorbehalten“) muss noch festgelegt und als `LICENSE` ergänzt werden.
- Die Aufnahme- und Ansage-Logik stammt aus dem Schwesterprojekt „Meine Touren“ (gleicher Autor).

## 2. Bibliotheken (alle kommerziell nutzbar)
| Bibliothek | Lizenz | Pflicht |
|---|---|---|
| Leaflet | BSD-2-Clause | Lizenztext beilegen (`vendor/LEAFLET-LICENSE`) |
| fflate | MIT | Lizenzhinweis |
| OkHttp / Okio | Apache-2.0 | Lizenzhinweis |
| smbj | Apache-2.0 | Lizenzhinweis |
| BouncyCastle | MIT | Lizenzhinweis |
| SLF4J | MIT | Lizenzhinweis |

Bewusst **nicht** verwendet: jcifs-ng (LGPL), weil dessen Bedingungen für Apps schwer einzuhalten sind. In der App gibt es unter „Einstellungen → Über“ eine Lizenzzeile; für den Verkauf zusätzlich eine Seite „Open-Source-Lizenzen“ mit den vollständigen Texten ergänzen.

## 3. Kartenmaterial und Routing (wichtig!)
- Die öffentlichen Server von **OpenStreetMap** (tile.openstreetmap.org) und **OpenTopoMap** dürfen nicht für eine kommerzielle App mit vielen Nutzern verwendet werden. Für den Verkauf einen Anbieter mit passendem Vertrag einsetzen (z. B. MapTiler, Stadia Maps, Thunderforest, Mapbox) oder selbst Kacheln hosten. In der App ist dafür „Eigener Kartenserver“ vorbereitet; die Voreinstellung muss vor dem Verkauf geändert werden.
- Das Offline-Speichern von Kacheln ist bei vielen Anbietern nur mit entsprechendem Tarif erlaubt – Nutzungsbedingungen prüfen.
- Der öffentliche **BRouter-Server** (brouter.de) ist ein privates Angebot. Für den Verkauf einen eigenen BRouter-Server betreiben (Open Source) oder einen kommerziellen Routing-Dienst nutzen und die Adresse in den Einstellungen/Vorgaben ersetzen.
- Die Karte zeigt die Namensnennung „© OpenStreetMap-Mitwirkende“ (ODbL) – beibehalten.

## 4. Import aus Diensten (Komoot, Strava, Zepp, Bosch Flow)
- **Strava**: Offizielle API mit eigener Anwendung des Nutzers. Für eine veröffentlichte App gelten die Strava-API-Bedingungen (u. a. Freigabe der Anwendung, Markenregeln, Rate-Limits). Vor dem Verkauf mit Strava klären oder die Funktion auf den Datei-Import (Strava-Export-ZIP) beschränken.
- **Komoot** und **Zepp/Amazfit**: Es gibt keine öffentliche, freigegebene Schnittstelle für Dritte; der Import nutzt dieselben Schnittstellen wie deren Apps und ist nicht vom Hersteller genehmigt. Das kann gegen deren Nutzungsbedingungen verstoßen und jederzeit aufhören zu funktionieren. Für den Verkauf empfehlenswert: diese beiden Wege entfernen oder als „experimentell, auf eigenes Risiko des Nutzers“ kennzeichnen — oder eine Genehmigung/Partnerschaft einholen.
- **Bosch eBike Flow**, Garmin, Suunto, Polar, Wahoo, Coros: Nur Datei-Import/Teilen-Menü (GPX/FIT/TCX/ZIP) – unkritisch.
- Markennamen (Komoot, Strava, Garmin, Bosch, Zepp …) nur beschreibend verwenden („Import aus …“), keine Logos ohne Erlaubnis.

## 5. Datenschutz und Stores
- Alle Daten bleiben auf dem Gerät; es gibt keinen eigenen Server und keine Analyse/Werbung. Zugangsdaten (Komoot-/Strava-/Zepp-Token, SMB, WebDAV) liegen nur im privaten App-Speicher. Das reduziert den Aufwand, trotzdem ist eine **Datenschutzerklärung** nötig (Standort, Fotos, Netzwerkzugriffe auf Drittdienste).
- Google Play: Vordergrunddienst „Standort“ und Zugriff auf Fotos/Mediendaten müssen in der Play Console begründet werden; Hintergrundstandort wird nicht angefordert.
- Der Zugriff auf SMB/WebDAV erfolgt nur auf Servereingabe des Nutzers.

## 6. Technisches vor dem Verkauf
- **Signierschlüssel**: Der in `android/app/mt-debug.jks` liegende Schlüssel ist öffentlich und nur für Testversionen. Für den Verkauf einen eigenen Upload-/Release-Schlüssel erzeugen, **geheim halten** und sichern (Verlust = keine Updates mehr). Das App-Paket `de.meinetouren.lokal` ist nach der Veröffentlichung dauerhaft festgelegt.
- Als Android App Bundle (`bundleRelease`) bauen, `targetSdk` aktuell halten.
- Optional: Bezahlmodell (Einmalkauf/Abo) über Google Play Billing; die App hat dafür noch keine Funktion.
- App-Name „Meine Touren Lokal“ auf Markenkollisionen prüfen.
