'use strict';
/* Rechenlogik ohne Oberfläche: Aufstieg und Abstieg aus einer Höhenreihe – dieselbe Rechnung wie in „Meine Touren“ (app/elev.py):
   1. unmögliche Höhen (außerhalb −500 … 9000 m, z. B. der Platzhalter −20000) durch den nächsten gültigen Nachbarn ersetzen (clean),
   2. Median über 3 Werte, dann Mittelwert über 3 Werte (smooth; an den Rändern mit verkürztem Fenster),
   3. Schwelle (Hysterese) 4 m, Startwert = erster Wert (ascent).
   Nur Punkte MIT Höhe gehen ein. Läuft im Browser (globales `Hoehe`) und in Node. */
(function (root) {
  const LO = -500, HI = 9000, HYST = 4, MIN_PUNKTE = 6;
  const gueltig = x => typeof x === 'number' && isFinite(x);

  /** Unmögliche Werte durch den nächsten gültigen ersetzen (erst der Vorgänger, sonst der Nachfolger). Ohne einen gültigen Wert: lauter 0. */
  function clean(v, lo, hi) {
    lo = lo === undefined ? LO : lo; hi = hi === undefined ? HI : hi;
    const ok = v.map(x => x !== null && x !== undefined && x >= lo && x <= hi);
    if (!ok.some(Boolean)) return v.map(() => 0);
    const out = v.slice(); let last = null;
    for (let i = 0; i < v.length; i++) { if (ok[i]) last = v[i]; else if (last !== null) out[i] = last; }
    let nxt = null;
    for (let i = v.length - 1; i >= 0; i--) {
      if (ok[i]) nxt = v[i];
      else if (out[i] === null || out[i] === undefined || !(out[i] >= lo && out[i] <= hi)) out[i] = nxt;
    }
    return out;
  }

  /** Gleitender Median (Fenster med), danach gleitender Mittelwert (Fenster avg); Fenster an den Rändern verkürzt. */
  function smooth(v, med, avg) {
    med = med === undefined ? 3 : med; avg = avg === undefined ? 3 : avg;
    const n = v.length, hm = med >> 1, ha = avg >> 1, m = new Array(n), o = new Array(n);
    for (let i = 0; i < n; i++) { const w = v.slice(Math.max(0, i - hm), i + hm + 1).sort((a, b) => a - b); m[i] = w[w.length >> 1]; }
    for (let i = 0; i < n; i++) { const w = m.slice(Math.max(0, i - ha), i + ha + 1); o[i] = w.reduce((a, b) => a + b, 0) / w.length; }
    return o;
  }

  /** Auf-/Abstieg mit Schwelle: Schwankungen unter hyst zählen nicht. Gibt [auf, ab] (m). */
  function ascent(v, hyst) {
    hyst = hyst === undefined ? HYST : hyst;
    let up = 0, down = 0;
    if (!v.length) return [0, 0];
    let ref = v[0];
    for (let i = 1; i < v.length; i++) {
      const h = v[i];
      if (h - ref >= hyst) { up += h - ref; ref = h; }
      else if (ref - h >= hyst) { down += ref - h; ref = h; }
    }
    return [up, down];
  }

  /** Eine Höhenreihe (Einträge dürfen null sein: Punkt ohne Höhe) → [auf, ab] in m. */
  function lauf(ele) {
    const v = ele.filter(gueltig);
    return v.length ? ascent(smooth(clean(v), 3, 3), HYST) : [0, 0];
  }

  /** Mehrere Läufe (z. B. durch ausgeschlossene Abschnitte getrennt): jeder für sich gerechnet, dann addiert.
      Gibt {up, down, n}; n = Zahl der Punkte mit Höhe. */
  function aufstieg(laeufe) {
    let up = 0, down = 0, n = 0;
    for (const r of laeufe) { const [u, d] = lauf(r); up += u; down += d; n += r.filter(gueltig).length; }
    return { up, down, n };
  }

  /** Reicht die Spur für eine eigene Rechnung? (Wie in „Meine Touren“: mehr als 5 Punkte mit Höhe.) */
  const brauchbar = n => n >= MIN_PUNKTE;

  const api = { clean, smooth, ascent, lauf, aufstieg, brauchbar, MIN_PUNKTE, HYST };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Hoehe = api;
})(typeof window !== 'undefined' ? window : globalThis);
