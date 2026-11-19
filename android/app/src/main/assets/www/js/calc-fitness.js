'use strict';
/* Rechenlogik ohne Oberfläche: Fitness-Einordnung. Ordnet die Aktivität der letzten 12 Wochen in Relation zum Alter ein.
   ORIENTIERUNG, KEINE MEDIZINISCHE AUSSAGE. Formeln und Schwellen aus „Meine Touren“ 3.44.0 (app/fitness.py), dort ausführlich beschrieben:
   Umfang (Minuten je Woche gegen die WHO-Empfehlung 150–300), Regelmäßigkeit (Wochen mit Tour, Gleichmäßigkeit), Intensität (mit Puls: Anteil bei 60–90 % von
   HFmax = 208 − 0,7 × Alter nach Tanaka, Monahan und Seals 2001; ohne Puls: Aufstieg je Stunde gegen einen altersabhängigen Richtwert), Gesamt als Mittel der
   vorhandenen Teilwerte (mindestens zwei), Trend gegen die 12 Wochen davor. Kein Aufruf nach außen. Läuft im Browser (globales `Fitness`) und in Node.
   Touren: [{tag (Tageszahl, siehe Fitness.tag), dauer_s, up_m, hist ({bpm: Sekunden}) | null}]. */
(function (root) {
  const WEEKS = 12, ALTER_MIN = 10, ALTER_MAX = 110, WHO_MIN = 150, WHO_MAX = 300, PULS_MIN_S = 600, ZONE_LO = 0.60, ZONE_HI = 0.90;
  const REF_AUFSTIEG_H = 400, REF_ALTER = 30, K_MIN = 0.5, MIN_TEILE = 2, TREND_SCHWELLE = 5, BPM_MIN = 30, BPM_MAX = 240;
  const KLASSEN = [[80, 'sehr_aktiv'], [60, 'gut'], [40, 'solide'], [0, 'ausbaufaehig']];
  const pyRound = x => { const f = Math.floor(x), d = x - f; if (Math.abs(d - 0.5) < 1e-9) return f % 2 === 0 ? f : f + 1; return Math.round(x); };

  /** Tageszahl eines Zeitpunkts (Kalendertag in Ortszeit). */
  const tag = ms => { const d = new Date(ms); return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 864e5); };
  const iso = n => new Date(n * 864e5).toISOString().slice(0, 10);
  const alter = (geburtsjahr, jahr) => jahr - Number(geburtsjahr);
  /** Geschätzte maximale Herzfrequenz nach Tanaka (2001): 208 − 0,7 × Alter. */
  const hfmax = a => 208 - 0.7 * a;
  /** Geburtsjahr prüfen (ganze Zahl, Alter 10 bis 110): Zahl oder Error mit verständlicher Meldung. */
  function pruefeJahr(jahr, heuteJahr) {
    const s = String(jahr == null ? '' : jahr).trim();
    if (!/^\d{4}$/.test(s)) throw new Error('Bitte ein Geburtsjahr angeben (vier Ziffern).');
    const j = parseInt(s, 10);
    if (j < heuteJahr - ALTER_MAX || j > heuteJahr - ALTER_MIN) throw new Error('Das Geburtsjahr muss zwischen ' + (heuteJahr - ALTER_MAX) + ' und ' + (heuteJahr - ALTER_MIN) + ' liegen.');
    return j;
  }
  /** Minuten je Woche → 0…100 (0 = 0, 150 = 70, 300 und mehr = 100). */
  function teilwertUmfang(min) {
    if (min == null || !isFinite(min) || min < 0) return null;
    if (min <= WHO_MIN) return pyRound(70 * min / WHO_MIN);
    return pyRound(Math.min(100, 70 + 30 * (min - WHO_MIN) / (WHO_MAX - WHO_MIN)));
  }
  /** Touren je Woche (Liste mit 12 Zahlen) → 0…100; ohne Touren null. */
  function teilwertRegel(je) {
    const n = je.length, sum = je.reduce((a, b) => a + b, 0);
    if (!n || sum <= 0) return null;
    const anteil = je.filter(x => x > 0).length / n, mw = sum / n, sd = Math.sqrt(je.reduce((a, x) => a + (x - mw) ** 2, 0) / n), gleich = 1 - Math.min(1, sd / mw);
    return pyRound(100 * (0.7 * anteil + 0.3 * gleich));
  }
  /** hist = {bpm: Sekunden} (alle Touren des Zeitraums) → Teilwert mit Pulsdaten oder null (unter 10 Minuten). */
  function teilwertPuls(hist, a) {
    const h = {};
    for (const b of Object.keys(hist || {})) { const bpm = parseInt(b, 10), s = Number(hist[b]); if (bpm >= BPM_MIN && bpm <= BPM_MAX && s > 0) h[bpm] = s; }
    const tot = Object.values(h).reduce((x, y) => x + y, 0);
    if (tot < PULS_MIN_S) return null;
    const hm = hfmax(a);
    let zone = 0, sum = 0;
    for (const b of Object.keys(h)) { const bpm = +b; if (ZONE_LO * hm <= bpm && bpm <= ZONE_HI * hm) zone += h[b]; sum += bpm * h[b]; }
    const mean = sum / tot;
    return { wert: pyRound(100 * zone / tot), mittel_bpm: pyRound(mean), mittel_pct: pyRound(100 * mean / hm), zone_pct: pyRound(100 * zone / tot), hfmax: pyRound(hm), sekunden: pyRound(tot) };
  }
  const faktorAlter = a => Math.max(K_MIN, 1 - 0.01 * Math.max(0, a - REF_ALTER));
  /** Aufstieg je Stunde gegen den alterskorrigierten Richtwert; null ohne Aufstieg oder unter einer Stunde Dauer. */
  function teilwertAufstieg(up, dauerS, a) {
    if (!up || up <= 0 || !dauerS || dauerS < 3600) return null;
    const mh = up / (dauerS / 3600), ref = faktorAlter(a) * REF_AUFSTIEG_H;
    return { wert: pyRound(Math.min(100, 100 * mh / ref)), m_h: pyRound(mh), ref_m_h: pyRound(ref) };
  }
  const klasse = g => { for (const [ab, n] of KLASSEN) if (g >= ab) return n; return KLASSEN[KLASSEN.length - 1][1]; };

  function teile(touren, bis, a) {
    const von = bis - (WEEKS * 7 - 1), ts = touren.filter(t => t.tag >= von && t.tag <= bis);
    const out = { touren: ts.length, umfang: null, regel: null, intensitaet: null };
    if (!ts.length) return out;
    const je = Array(WEEKS).fill(0);
    ts.forEach(t => { je[Math.min(WEEKS - 1, Math.floor((bis - t.tag) / 7))]++; });
    const mitDauer = ts.filter(t => (t.dauer_s || 0) > 0);
    if (mitDauer.length) { const mw = mitDauer.reduce((x, t) => x + t.dauer_s, 0) / 60 / WEEKS; out.umfang = { wert: teilwertUmfang(mw), min_woche: Math.round(mw * 10) / 10, who_min: WHO_MIN, who_max: WHO_MAX, ohne_dauer: ts.length - mitDauer.length }; }
    out.regel = { wert: teilwertRegel(je), wochen_aktiv: je.filter(x => x > 0).length, wochen: WEEKS, touren: ts.length };
    const hist = {};
    ts.forEach(t => { for (const b of Object.keys(t.hist || {})) hist[b] = (hist[b] || 0) + t.hist[b]; });
    const p = teilwertPuls(hist, a);
    if (p) out.intensitaet = Object.assign({}, p, { quelle: 'puls' });
    else {
      const m = mitDauer.filter(t => (t.up_m || 0) > 0), u = teilwertAufstieg(m.reduce((x, t) => x + t.up_m, 0), m.reduce((x, t) => x + t.dauer_s, 0), a);
      if (u) out.intensitaet = Object.assign({}, u, { quelle: 'aufstieg' });
    }
    return out;
  }
  function gesamt(t) {
    const w = ['umfang', 'regel', 'intensitaet'].map(k => t[k] && t[k].wert).filter(v => v != null);
    return w.length >= MIN_TEILE ? pyRound(w.reduce((a, b) => a + b, 0) / w.length) : null;
  }
  const oderLeer = x => x ? x : { wert: null, status: 'keine_daten' };

  /** Einordnung aus den Touren und dem Geburtsjahr; heute: Date. Ohne Geburtsjahr nur {status: 'kein_geburtsjahr'} (nie Platzhalterwerte). */
  function berechne(touren, geburtsjahr, heute) {
    if (geburtsjahr == null || geburtsjahr === '') return { status: 'kein_geburtsjahr' };
    const a = alter(geburtsjahr, heute.getFullYear()), bis = tag(heute.getTime());
    const base = { geburtsjahr: Number(geburtsjahr), alter: a, wochen: WEEKS, von: iso(bis - (WEEKS * 7 - 1)), bis: iso(bis) };
    if (!touren.length) return Object.assign({}, base, { status: 'keine_touren' });
    const jetzt = teile(touren, bis, a);
    if (!jetzt.touren) return Object.assign({}, base, { status: 'keine_aktuellen' });
    const out = Object.assign({}, base, { touren: jetzt.touren, umfang: oderLeer(jetzt.umfang), regel: oderLeer(jetzt.regel), intensitaet: oderLeer(jetzt.intensitaet) });
    const g = gesamt(jetzt);
    if (g === null) return Object.assign(out, { status: 'zu_wenig' });
    const vor = gesamt(teile(touren, bis - WEEKS * 7, a));
    const trend = vor === null ? null : g - vor >= TREND_SCHWELLE ? 'up' : vor - g >= TREND_SCHWELLE ? 'down' : 'flat';
    return Object.assign(out, { status: 'ok', gesamt: g, einordnung: klasse(g), trend, vorher: vor });
  }
  /** Sekunden je Pulswert aus einer Spur (Punkte {t (ms), hr}); wie im Vorbild je Abschnitt höchstens 30 Sekunden. */
  function histAusSpur(pts) {
    const h = {};
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i], b = pts[i + 1];
      if (!(a.hr >= BPM_MIN && a.hr <= BPM_MAX) || a.t == null || b.t == null) continue;
      const dt = Math.min((b.t - a.t) / 1000, 30);
      if (dt > 0) h[a.hr] = (h[a.hr] || 0) + dt;
    }
    return Object.keys(h).length ? h : null;
  }

  const api = { WEEKS, ALTER_MIN, ALTER_MAX, tag, alter, hfmax, pruefeJahr, teilwertUmfang, teilwertRegel, teilwertPuls, teilwertAufstieg, faktorAlter, klasse, berechne, histAusSpur };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Fitness = api;
})(typeof window !== 'undefined' ? window : globalThis);
