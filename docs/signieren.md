# Signierschlüssel

Die veröffentlichten APKs werden mit einem **geheimen Schlüssel** signiert. Er liegt nicht im Repository, sondern als vier *Repository secrets* bei GitHub (Settings → Secrets and variables → Actions):

| Secret | Inhalt |
|---|---|
| `MT_KEYSTORE_B64` | die Schlüsseldatei (`.jks`), Base64-kodiert (`base64 -w0 datei.jks`) |
| `MT_STORE_PASS` | Passwort der Schlüsseldatei |
| `MT_KEY_PASS` | Passwort des Schlüssels |
| `MT_KEY_ALIAS` | Name des Schlüssels (`tourentagebuch`) |

- Der Workflow „Veröffentlichen“ bricht mit einer Fehlermeldung ab, wenn eines fehlt (damit nie eine falsch signierte APK entsteht).
- Normale Testbauten (Push) und Eigenbauten aus dem Quellcode benutzen den normalen Android-Testschlüssel; solche APKs lassen sich nicht über eine veröffentlichte Version installieren (andere Signatur) – vorher deinstallieren oder Daten sichern.
- **Schlüsseldatei und Passwörter gut sichern.** Geht der Schlüssel verloren, lässt sich keine spätere Version mehr über die installierte App legen.
- Einen neuen Schlüssel erzeugen: `keytool -genkeypair -keystore mein.jks -storetype PKCS12 -alias tourentagebuch -keyalg RSA -keysize 4096 -validity 36500`
