'use strict';
/* Rechenlogik ohne Oberfläche für den Schalter „Mit Meine Touren zusammenarbeiten“ (2.15.0). Zustand und Oberfläche stehen in js/mt.js.
   Einstellungen: mtAktiv (true/false, Vorgabe aus) und mtWahl: '' = noch nicht geprüft (erster Start dieser Version), 'offen' = Frage zeigen,
   'auto' = Bestandsnutzer, beim Update automatisch eingeschaltet, 'ja' / 'nein' = vom Nutzer entschieden.
   Bestandsnutzer ist, wer die Verbindung schon eingerichtet hatte (kv „mt“ mit Adresse, auch nach „Verbindung trennen“) oder Touren hat, die von dort stammen
   oder dorthin gesendet wurden. Bei Aus gilt für Aufstieg und Strecke die eigene Rechnung; die Werte aus Meine Touren bleiben gespeichert.
   Läuft im Browser (globales `MTCalc`) und in Node (tests/test_calc.js). */
(function (root) {
  /** Besteht eine Sitzung (angemeldet oder Server ohne Benutzer)? */
  const verbunden = acc => !!(acc && (acc.token || acc.open));
  /** Wurde die Verbindung je eingerichtet? (Nach „Verbindung trennen“ bleiben Adresse und Name.) */
  const eingerichtet = acc => !!(acc && (acc.base || acc.token || acc.open));
  const MT_ID = /^mt:/;
  /** Hat diese Tour etwas mit Meine Touren zu tun (von dort geholt, verknüpft, angeglichen oder dorthin gesendet)? */
  function beruehrt(t) {
    if (!t) return false;
    return t.src === 'mt' || !!t.mtId || !!t.zMt || !!t.mtSent || MT_ID.test(t.srcId || '') || (Array.isArray(t.alias) && t.alias.some(a => MT_ID.test(a || '')));
  }
  /** Entscheidung beim ersten Start von 2.15.0. Gibt { aktiv, wahl, frage } zurück. */
  function entscheidung(acc, tours) {
    const bestand = eingerichtet(acc) || (tours || []).some(beruehrt);
    return bestand ? { aktiv: true, wahl: 'auto', frage: false } : { aktiv: false, wahl: 'offen', frage: true };
  }
  /** Soll die Frage gezeigt werden? */
  const frage = wahl => wahl === 'offen';
  /** Gelten Aufstieg und Strecke aus Meine Touren für diese Tour? Nur bei An und solange die Tour angeglichen ist. */
  const zahlenGelten = (t, an) => !!(an && t && t.zMt);

  /* ---- Texte: bei Aus ohne Nennung von Meine Touren ---- */
  const importSub = an => an ? 'Dateien, Meine Touren, Komoot, Strava, Zepp, Garmin' : 'Dateien, Komoot, Strava, Zepp, Garmin';
  const keineQuelle = an => 'Es ist noch keine Quelle verbunden. Unter „Touren importieren“ lässt sich ' + (an ? 'Meine Touren, Komoot oder Zepp' : 'Komoot oder Zepp') + ' verbinden.';
  const aufstiegNeu = (n, an) => 'Aufstieg neu berechnet' + (an ? ' – gleiche Rechnung wie in Meine Touren' : '') + '. ' + n + (n === 1 ? ' Tour' : ' Touren') + ' geändert.';
  const skiNeu = (n, an) => n + (n === 1 ? ' Ski-Tour steht' : ' Ski-Touren stehen') + ' jetzt als „Ski (allgemein)“: Ski alpin, Skitour und Langlauf sind getrennte Sportarten. '
    + (an ? 'Beim nächsten Abgleich mit Meine Touren bekommen sie ihre genaue Art; Schneeschuh-Touren bekommen dabei die Sportart Schneeschuh.' : 'Die genaue Art kannst du auf der Tourseite wählen.');
  const sterneZusatz = (t, an) => (an && t && !t.starsMan && t.starsMt ? ' · aus Meine Touren' : '');
  const umschaltText = an => an ? 'Zusammenarbeit mit Meine Touren ist eingeschaltet.' : 'Mein Tourentagebuch arbeitet jetzt ganz für sich.';
  /** Reihenfolge bei „Alles abgleichen“: bei Aus ohne Meine Touren (Zepp → Komoot bleibt). */
  const reihenfolge = (alle, an) => (alle || []).filter(id => an || id !== 'mt');

  /** Fehlertext für „Wanderführer aus Meine Touren holen“ nach dem HTTP-Status (401 behandelt der Aufrufer: Anmeldung abgelaufen). */
  function fuehrerFehler(status) {
    if (status === 403 || status === 404) return 'Dafür braucht es Meine Touren ab Version 3.56.0. Bitte den Server aktualisieren.';
    if (status >= 500) return 'Meine Touren hat einen Fehler gemeldet (HTTP ' + status + ').';
    return 'Meine Touren hat die Wanderführer nicht geliefert (HTTP ' + status + ').';
  }
  /** Adresse für den Wanderführer-Export des Servers. */
  const fuehrerPfad = mitCover => '/api/guides/export' + (mitCover ? '?cover=1' : '');

  const api = { verbunden, eingerichtet, beruehrt, entscheidung, frage, zahlenGelten, importSub, keineQuelle, aufstiegNeu, skiNeu, sterneZusatz, umschaltText, reihenfolge, fuehrerFehler, fuehrerPfad };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.MTCalc = api;
})(typeof window !== 'undefined' ? window : globalThis);
