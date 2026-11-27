'use strict';
/* 2.21.0: Rechenlogik ohne Oberfläche für „Auf neue Version prüfen“: Versionsnummern lesen und vergleichen, die Antwort von
   GitHub (Release „latest“) auswerten, entscheiden, wann wieder geprüft wird und ob der Hinweis gezeigt wird.
   Alles ist gegen Schrott abgesichert: Vorabversionen (2.21.0-rc1), fremde Formate, fehlende Felder und Fehlerantworten
   ergeben „nichts Neues“, nie einen Fehler. Läuft im Browser (globales `UpdateCalc`) und in Node (tests/test_calc.js). */
(function (root) {
  const REPO = 'hilde0407/mein-tourentagebuch';
  const API = 'https://api.github.com/repos/' + REPO + '/releases/latest';
  const SEITE = 'https://github.com/' + REPO + '/releases/';
  const ABSTAND = 12 * 3600 * 1000;

  /** „v2.20.2“ oder „2.20.2“ → [2, 20, 2]; „2.21“ → [2, 21, 0]. Alles andere (Vorabversion, Text, leer) → null. */
  function lesen(v) {
    if (typeof v !== 'string') return null;
    const m = /^\s*[vV]?(\d{1,4})\.(\d{1,4})(?:\.(\d{1,4}))?\s*$/.exec(v);
    return m ? [+m[1], +m[2], +(m[3] || 0)] : null;
  }
  /** -1, 0 oder 1; null, wenn eine Seite keine Versionsnummer ist. */
  function vergleich(a, b) {
    const x = lesen(a), y = lesen(b);
    if (!x || !y) return null;
    for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
    return 0;
  }
  /** Schöne Schreibweise „2.21.0“. */
  function text(v) { const x = lesen(v); return x ? x.join('.') : ''; }
  /** Ist `neu` echt neuer als `installiert`? Unlesbare Nummer auf einer Seite: nein. */
  function neuer(installiert, neu) { return vergleich(installiert, neu) === -1; }

  /** Verweis auf die Release-Seite: nur https://github.com/hilde0407/mein-tourentagebuch/…, sonst die Seite aller Releases. */
  function seite(url, tag) {
    if (typeof url === 'string' && url.indexOf(SEITE) === 0 && url.length < 300 && !/\s/.test(url)) return url;
    return lesen(tag) ? SEITE + 'tag/v' + text(tag) : SEITE + 'latest';
  }
  /** Erste Zeilen des Release-Textes (Markdown-Zeichen entfernt), höchstens n Zeichen. */
  function aenderungen(body, n) {
    if (typeof body !== 'string') return '';
    const z = body.replace(/\r/g, '').split('\n').map(s => s.replace(/^\s*(#{1,6}|[-*+>])\s*/, '').replace(/[*_`]/g, '').trim()).filter(Boolean);
    let s = z.slice(0, 6).join('\n');
    if (s.length > (n || 400)) s = s.slice(0, (n || 400)).replace(/\s+\S*$/, '') + ' …';
    return s;
  }
  /** Antwort der Brücke {status, body} → {ok, latest, url, notes}. ok=false: nichts auszuwerten (Rate-Limit, Fehler, Entwurf, Vorabversion, Schrott). */
  function auswerten(r) {
    try {
      if (!r || r.status !== 200 || typeof r.body !== 'string') return { ok: false, grund: 'status ' + (r && r.status) };
      const j = JSON.parse(r.body);
      if (!j || typeof j !== 'object' || j.draft === true || j.prerelease === true) return { ok: false, grund: 'kein Release' };
      if (!lesen(j.tag_name)) return { ok: false, grund: 'Nummer' };
      return { ok: true, latest: text(j.tag_name), url: seite(j.html_url, j.tag_name), notes: aenderungen(j.body) };
    } catch (e) { return { ok: false, grund: 'Antwort' }; }
  }
  /** Ist wieder eine Abfrage fällig? Letzte Zeit in der Zukunft (falsche Uhr) zählt als fällig. */
  function faellig(letzte, jetzt, abstand) {
    if (!(letzte > 0)) return true;
    const d = jetzt - letzte;
    return d < 0 || d >= (abstand || ABSTAND);
  }
  /** Soll der Hinweis auf der Startseite stehen? st: gemerktes Ergebnis {latest}; spaeter: Version, für die „Später“ getippt wurde. */
  function zeigen(installiert, st, spaeter) {
    if (!st || !neuer(installiert, st.latest)) return false;
    return !(lesen(spaeter) && vergleich(st.latest, spaeter) <= 0);      // erst eine noch neuere Version bringt den Hinweis zurück
  }
  const api = { REPO, API, SEITE, ABSTAND, lesen, vergleich, text, neuer, seite, aenderungen, auswerten, faellig, zeigen };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.UpdateCalc = api;
})(typeof self !== 'undefined' ? self : this);
