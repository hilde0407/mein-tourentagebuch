'use strict';
/* 2.19.0: Rechenlogik ohne Oberfläche für die „Favoriten-Aktivitäten“: die Aktivitäten, die „Tour aufnehmen“ als Chips anbietet (alle übrigen unter „Mehr …“).
   Einstellung „favAkt“ (Set_, kv „settings“, mit der Sicherung): geordnete Liste von Sportart-Schlüsseln, höchstens 12, nur bekannte, ohne Doppel.
   Läuft im Browser (globales `Aktiv`) und in Node (tests/test_calc.js). Die Sportarten selbst stehen in parse.js (Sports.list, Sports.KAT). */
(function (root) {
  const node = typeof module !== 'undefined' && module.exports;
  const MAX = 12, STANDARD = ['hike', 'run', 'bike', 'skitour', 'mtb'];
  function S() {
    if (node) return require('./parse.js').Sports;
    return typeof Sports !== 'undefined' ? Sports : root.Sports;      // eslint-disable-line no-undef
  }

  /** Liste bereinigen: nur Aktivitäten des Katalogs (ohne die nur noch für alte Touren gedachten und ohne entfernte Schlüssel), ohne Doppel, höchstens 12. Kein Array → Standard. */
  function favoriten(list) {
    if (!Array.isArray(list)) return STANDARD.slice();
    const ok = new Set(S().katalog.map(s => s[0])), out = [];      // nur der Katalog: Altschlüssel („ski“) und entfernte Schlüssel fallen still weg
    for (const k of list) if (typeof k === 'string' && ok.has(k) && !out.includes(k) && out.length < MAX) out.push(k);
    return out;
  }
  /** Stern an/aus: hinten anhängen bzw. entfernen; bei 12 Favoriten kommt keiner mehr dazu (Rückgabe unverändert). */
  function umschalten(list, key) {
    const l = favoriten(list);
    if (l.includes(key)) return l.filter(k => k !== key);
    return l.length >= MAX ? l : favoriten(l.concat([key]));
  }
  /** Reihenfolge: Eintrag an Stelle i um d (−1 nach vorn, +1 nach hinten) verschieben; am Rand unverändert. */
  function verschiebe(list, i, d) {
    const l = favoriten(list), j = i + d;
    if (i < 0 || i >= l.length || j < 0 || j >= l.length) return l;
    [l[i], l[j]] = [l[j], l[i]];
    return l;
  }
  /** Was „Tour aufnehmen“ zeigt: die Favoriten als Chips; die zuletzt benutzte Aktivität ist vorgewählt und steht – falls sie kein Favorit ist – vorn dabei.
      Ohne gültige zuletzt benutzte: die erste der Favoriten (sonst Wandern). Rückgabe { chips: [Schlüssel], gewaehlt }. */
  function aufnahme(favs, zuletzt) {
    const f = favoriten(favs), bekannt = S().katalog.some(s => s[0] === zuletzt);
    const gewaehlt = bekannt ? zuletzt : (f[0] || 'hike');
    return { chips: f.includes(gewaehlt) ? f : [gewaehlt].concat(f), gewaehlt };
  }

  const api = { MAX, STANDARD, favoriten, umschalten, verschiebe, aufnahme };
  if (node) module.exports = api; else root.Aktiv = api;
})(typeof window !== 'undefined' ? window : globalThis);
