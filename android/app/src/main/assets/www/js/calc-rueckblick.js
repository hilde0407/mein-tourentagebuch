'use strict';
/* Rechenlogik ohne Oberfläche: Rückblick „Wie ist es gelaufen?“ – Dauer, Strecke, Aufstieg und Tempo einer gelaufenen Tour gegen die eigenen Touren
   derselben Sportgruppe in den 12 Monaten davor. Vorbild: app/tourrueckblick.py (ohne „ähnliche Touren“: diese App erkennt keine Wiederholungen).
   Unter 5 Vergleichstouren gibt es keine Einordnung – nie einen Platzhalterwert oder eine 0. Läuft im Browser (globales `Rueckblick`) und in Node. */
(function (root) {
  const PH = (typeof module !== 'undefined' && module.exports) ? require('./calc-planhilfe.js') : root.Planhilfe;
  const MIN_DUR_S = 60, MIN_DIST_M = 1000, KEYS = ['dauer', 'strecke', 'auf', 'tempo'];
  const num = v => { const x = Number(v); return v == null || v === '' || !isFinite(x) ? null : x; };

  /** Dauer (h), Strecke (km), Aufstieg (m), Tempo (km/h) einer Tour; fehlende Werte sind null (nie 0). */
  function werte(t) {
    const dist = num(t.dist), dur = num(t.dur), up = num(t.up);
    const ok = !!(dist && dur && dist >= MIN_DIST_M && dur >= MIN_DUR_S);
    return { dauer: dur && dur >= MIN_DUR_S ? dur / 3600 : null, strecke: dist && dist > 0 ? dist / 1000 : null, auf: up != null && up >= 0 ? up : null, tempo: ok ? dist / dur * 3.6 : null };
  }
  /** Je Kennzahl die Einordnung (Median-Verhältnis, unter 80 % / über 125 %) oder null (fehlt der Wert der Tour oder gibt es unter 5 Vergleichswerte). */
  function einordnen(cur, rows) {
    const vs = rows.map(werte), out = {};
    for (const k of KEYS) {
      const vals = vs.map(v => v[k]).filter(v => v != null);
      const m = cur[k] != null ? PH.metrik(cur[k], vals) : null;
      out[k] = m === null ? null : { wert: cur[k], median: m.median, n: m.n, verhaeltnis_median_pct: m.verhaeltnis_median_pct, einordnung: m.einordnung, perzentil: m.perzentil };
    }
    return out;
  }
  /** t: die Tour; all: alle gelaufenen Touren. Rückgabe {status: 'ok' | 'zu_wenig' | 'hat_plan', n, monate, kennzahlen}. */
  function rueckblick(t, all) {
    if (t.plan) return { status: 'hat_plan' };
    const out = { status: 'zu_wenig', min_n: PH.MIN_N, monate: PH.MONATE, n: 0, kennzahlen: null };
    if (!t.start) return out;
    const lo = t.start - PH.MONATE * 30.4375 * 86400000;
    const rows = all.filter(r => r.id !== t.id && r.status !== 'planned' && r.start && r.start >= lo && r.start < t.start && PH.gleicheGruppe(r.sport, t.sport));
    out.n = rows.length;
    if (rows.length < PH.MIN_N) return out;
    const k = einordnen(werte(t), rows);
    if (!KEYS.some(x => k[x])) return out;
    return Object.assign(out, { status: 'ok', kennzahlen: k });
  }

  const api = { werte, einordnen, rueckblick };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Rueckblick = api;
})(typeof window !== 'undefined' ? window : globalThis);
