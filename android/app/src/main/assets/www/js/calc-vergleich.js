'use strict';
/* Rechenlogik ohne Oberfläche: Jahresvergleich der Statistik (2.13.0) – zwei Jahre Monat für Monat aufsummiert (Strecke, Aufstieg, Zeit, Touren) und die Differenz.
   Gleiche Filterregel wie Statistik und Jahresrückblick (Jahr.zaehlt). Ist eines der beiden Jahre das laufende, wird das andere nur bis zum gleichen Kalendertag gezählt
   (29. Februar → 28. Februar, wenn das andere Jahr kein Schaltjahr ist), und die Linie des laufenden Jahres endet im laufenden Monat.
   Zeit je Tour: Zeit in Bewegung, sonst Dauer (wie die Monatswerte des Jahresrückblicks). Läuft im Browser (globales `Vergleich`) und in Node. */
(function (root) {
  const node = typeof module !== 'undefined' && module.exports;
  const J = node ? require('./calc-jahr.js') : root.Jahr;
  const METRIKEN = [['dist', 'Strecke'], ['up', 'Aufstieg'], ['zeit', 'Zeit'], ['n', 'Touren']];
  const KURZ = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];

  const tageImMonat = (y, m) => new Date(y, m + 1, 0).getDate();
  const wert = (t, k) => (k === 'n' ? 1 : k === 'zeit' ? (t.moving || t.dur || 0) : (t[k] || 0));

  /** Jahre mit Touren (neueste zuerst) für die Auswahl; das laufende Jahr ist immer dabei. sportFn(sport) → bool. */
  function jahre(all, now, sportFn) {
    now = now || new Date();
    const ys = new Set((all || []).filter(t => J.zaehlt(t) && (!sportFn || sportFn(t.sport))).map(t => new Date(t.start).getFullYear()));
    ys.add(now.getFullYear());
    return [...ys].sort((a, b) => b - a);
  }
  /** Vorgabe: das laufende Jahr gegen das Vorjahr. */
  function vorgabe(now) { const y = (now || new Date()).getFullYear(); return { a: y, b: y - 1 }; }

  /** Grenze (ms, einschließlich) für Jahr y, wenn bis zum Kalendertag von now verglichen wird. */
  function stichtag(y, now) {
    const m = now.getMonth(), d = Math.min(now.getDate(), tageImMonat(y, m));
    return new Date(y, m, d, 23, 59, 59, 999).getTime();
  }

  /** Ein Jahr: Monatswerte, aufsummiert, Summe im Vergleichszeitraum. bis = ms-Grenze (oder null), ende = letzter Monat der Linie (−1 = keine Linie). */
  function jahrWerte(ts, y, bis, ende) {
    const mon = Array.from({ length: 12 }, () => ({ n: 0, dist: 0, up: 0, zeit: 0 })), sum = { n: 0, dist: 0, up: 0, zeit: 0 };
    ts.forEach(t => {
      const d = new Date(t.start); if (d.getFullYear() !== y) return;
      const g = mon[d.getMonth()];
      METRIKEN.forEach(([k]) => { const v = wert(t, k); g[k] += v; if (bis == null || t.start <= bis) sum[k] += v; });
    });
    const kum = {};
    METRIKEN.forEach(([k]) => { let s = 0; kum[k] = mon.map((g, i) => { s += g[k]; return i <= ende ? s : null; }); });
    return { year: y, monate: mon, kum, summe: sum, ende, leer: sum.n === 0 && mon.every(g => g.n === 0) };
  }

  /** Differenz a gegen b: { a, b, abs, pct } – pct null, wenn b 0 ist (nichts zu vergleichen). */
  function diff(a, b) { return { a, b, abs: a - b, pct: b > 0 ? (a - b) / b : null }; }
  /** „+12 %“, „−5 %“, „±0 %“; „neu“, wenn b 0 und a größer; null, wenn beide 0. */
  function pctText(d) {
    if (!d) return null;
    if (d.pct == null) return d.a > 0 ? 'neu' : null;
    const p = Math.round(d.pct * 100);
    return p === 0 ? '±0 %' : (p > 0 ? '+' : '−') + Math.abs(p) + ' %';
  }

  /** Alles für den Vergleich: a, b = Jahre, now, sportFn. Gibt { a, b, diff: {dist, up, zeit, n}, bisHeute, stichtag, gleich } zurück. */
  function berechne(all, ya, yb, now, sportFn) {
    now = now || new Date();
    const ts = (all || []).filter(t => J.zaehlt(t) && (!sportFn || sportFn(t.sport)));
    const cy = now.getFullYear(), bisHeute = ya === cy || yb === cy;
    const endeVon = y => (y < cy ? 11 : y === cy ? now.getMonth() : -1);
    // Vergleichszeitraum: läuft eines der Jahre noch, zählen beide nur bis zum gleichen Kalendertag
    const A = jahrWerte(ts, ya, bisHeute ? stichtag(ya, now) : null, endeVon(ya)), B = jahrWerte(ts, yb, bisHeute ? stichtag(yb, now) : null, endeVon(yb));
    const df = {}; METRIKEN.forEach(([k]) => { df[k] = diff(A.summe[k], B.summe[k]); });
    return { a: A, b: B, diff: df, bisHeute, stichtag: bisHeute ? { tag: Math.min(now.getDate(), tageImMonat(ya === cy ? yb : ya, now.getMonth())), monat: now.getMonth() } : null, gleich: ya === yb };
  }

  const api = { METRIKEN, KURZ, tageImMonat, jahre, vorgabe, stichtag, jahrWerte, diff, pctText, berechne };
  if (node) module.exports = api; else root.Vergleich = api;
})(typeof window !== 'undefined' ? window : globalThis);
