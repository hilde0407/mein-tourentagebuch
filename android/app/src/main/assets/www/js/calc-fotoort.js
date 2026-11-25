'use strict';
/* 2.12.0: Rechenlogik ohne Oberfläche für „Orte aus der Tour ergänzen“: Fotos und Videos ohne eigenen GPS-Ort bekommen den Ort der Tourspur
   zu ihrer Aufnahmezeit (linear zwischen zwei Spurpunkten; in einer Pause/Lücke zwischen zwei Abschnitten der letzte Punkt davor).
   Zeiten sind überall Millisekunden seit 1970 (UTC): die Hülle rechnet die EXIF-Aufnahmezeit mit „OffsetTimeOriginal“ um, ohne diese Angabe in der
   Zeitzone des Handys samt Sommerzeit-Regel des Aufnahmetags (Photos.java); GPX-Zeiten sind UTC. Was dann noch nicht passt (Kamera-Uhr falsch
   gestellt, Winterzeit vergessen, Kamera in anderer Zeitzone), gleicht die „Uhrzeit-Verschiebung“ aus.
   Läuft im Browser (globales `FotoOrtCalc`) und in Node (tests/test_calc.js). */
(function (root) {
  const node = typeof module !== 'undefined' && module.exports;
  const MIN = 60000, STD = 3600000;
  /** Toleranz um das Zeitfenster der Tour (Minuten) zur Auswahl; Vorgabe 10. */
  const TOLERANZEN = [0, 5, 10, 20, 30, 60], TOL_VORGABE = 10;
  /** Unzugeordnete Fotos ohne Ort werden bis zu so weit vor/nach der Tour angeboten (Kamera-Uhr kann um bis zu einen Tag falsch gehen). */
  const SPANNE_MS = 26 * STD;

  const R = 6371000;
  function dist(a, b) {
    const r = x => x * Math.PI / 180, dLa = r(b.lat - a.lat), dLo = r(b.lon - a.lon);
    const s = Math.sin(dLa / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLo / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
  }

  /** Verschiebung in ms aus Vorzeichen ('+' oder '-'), Stunden (0…48) und Minuten (0…59). Ungültiges zählt als 0. */
  function versatz(vz, std, min) {
    const hh = Math.max(0, Math.min(48, Math.floor(Math.abs(+std) || 0))), mm = Math.max(0, Math.min(59, Math.floor(Math.abs(+min) || 0)));
    const v = (hh * 60 + mm) * MIN;
    return v ? (vz === '-' || vz === '−' ? -v : v) : 0;
  }

  /** „+1 Std. 30 Min.“, „−45 Min.“, „keine“. */
  function versatzText(ms) {
    ms = Math.round((+ms || 0) / MIN) * MIN;
    if (!ms) return 'keine';
    const a = Math.abs(ms), hh = Math.floor(a / STD), mm = Math.round((a % STD) / MIN);
    return (ms < 0 ? '−' : '+') + [hh ? hh + ' Std.' : '', mm ? mm + ' Min.' : ''].filter(Boolean).join(' ');
  }

  /** Spur vorbereiten: nur Punkte mit Zeit, zeitlich sortiert, mit kumulierter Strecke (m). Lücken (newSeg) zählen nicht zur Strecke. */
  function spur(pts) {
    const p = (pts || []).filter(q => q && +q.t > 0 && Number.isFinite(+q.lat) && Number.isFinite(+q.lon) && !q.skip)
      .map(q => ({ lat: +q.lat, lon: +q.lon, t: +q.t, seg: !!q.newSeg })).sort((a, b) => a.t - b.t);
    const km = [0];
    for (let i = 1; i < p.length; i++) km.push(km[i - 1] + (p[i].seg ? 0 : dist(p[i - 1], p[i])));
    return { p, m: km, t0: p.length ? p[0].t : 0, t1: p.length ? p[p.length - 1].t : 0 };
  }

  /** Ort zur Zeit t: {lat, lon, m (Strecke bis dahin), rand ('vor'/'nach'/null)} oder null außerhalb der Spur ± tolMs. */
  function ortBei(s, t, tolMs) {
    const p = s.p, n = p.length;
    if (!n || !(t > 0)) return null;
    tolMs = Math.max(0, +tolMs || 0);
    if (t < s.t0 - tolMs || t > s.t1 + tolMs) return null;
    if (t <= s.t0) return { lat: p[0].lat, lon: p[0].lon, m: 0, rand: t < s.t0 ? 'vor' : null };
    if (t >= s.t1) return { lat: p[n - 1].lat, lon: p[n - 1].lon, m: s.m[n - 1], rand: t > s.t1 ? 'nach' : null };
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (p[mid].t <= t) lo = mid; else hi = mid; }
    const a = p[lo], b = p[hi];
    if (b.seg) return { lat: a.lat, lon: a.lon, m: s.m[lo], rand: null };      // Pause/Lücke: man stand am letzten Punkt davor
    const f = b.t > a.t ? (t - a.t) / (b.t - a.t) : 0;
    return { lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f, m: s.m[lo] + (s.m[hi] - s.m[lo]) * f, rand: null };
  }

  /** Hat das Foto einen eigenen Ort (EXIF-GPS oder beim Aufnehmen in der App gesetzt)? Berechnete Orte zählen nicht als eigene. */
  const eigenerOrt = p => p.lat != null && p.lon != null && !['track', 'start', 'zeit', 'none'].includes(p.pos || 'exif');

  /**
   * Welche Fotos kommen in Frage? Alle dieser Tour ohne eigenen Ort, dazu unzugeordnete ohne eigenen Ort, deren Zeit bis zu SPANNE_MS
   * vor dem Start oder nach dem Ende liegt (dort steckt oft eine falsche Kamera-Uhr dahinter). Zeitlich sortiert.
   */
  function kandidaten(fotos, tour, spanneMs) {
    const sp = spanneMs == null ? SPANNE_MS : spanneMs, a = +tour.start || 0, e = +tour.end || a;
    return (fotos || []).filter(p => p && !eigenerOrt(p) && (p.tour === tour.id || (!p.tour && +p.ts > 0 && p.ts >= a - sp && p.ts <= e + sp)))
      .sort((x, y) => (x.ts || 0) - (y.ts || 0));
  }

  /**
   * Vorschau: für jedes Foto Zeit + Verschiebung → Ort auf der Spur. opt: { versatz (ms), tolMin (Minuten, Vorgabe 10) }.
   * Ergebnis: { treffer: [{id, ts, zeit, lat, lon, km, rand}], ausserhalb: [{id, ts, zeit, min, seite}], ohneZeit: [id], spur: bool }.
   * ausserhalb.min = Abstand zum Zeitfenster der Spur in Minuten (gerundet), seite 'vor' oder 'nach'.
   */
  function vorschlag(fotos, pts, opt) {
    opt = opt || {};
    const s = pts && pts.p ? pts : spur(pts), v = +opt.versatz || 0;
    const tol = (opt.tolMin == null ? TOL_VORGABE : Math.max(0, +opt.tolMin || 0)) * MIN;
    const out = { treffer: [], ausserhalb: [], ohneZeit: [], spur: s.p.length >= 2 };
    for (const f of fotos || []) {
      if (!(+f.ts > 0)) { out.ohneZeit.push(f.id); continue; }
      const z = +f.ts + v;
      const o = out.spur ? ortBei(s, z, tol) : null;
      if (o) out.treffer.push({ id: f.id, ts: +f.ts, zeit: z, lat: o.lat, lon: o.lon, km: o.m / 1000, rand: o.rand });
      else {
        const seite = !out.spur || z < s.t0 ? 'vor' : 'nach';
        out.ausserhalb.push({ id: f.id, ts: +f.ts, zeit: z, seite, min: out.spur ? Math.round((seite === 'vor' ? s.t0 - z : z - s.t1) / MIN) : null });
      }
    }
    return out;
  }

  const kmText = km => (Math.round((+km || 0) * 10) / 10).toFixed(1).replace('.', ',');

  /** „Foto 1 liegt dann bei km 3,2“ (Video: „Video 1 …“). */
  function beispiel(nr, km, video) { return (video ? 'Video ' : 'Foto ') + nr + ' liegt dann bei km ' + kmText(km); }

  /** Abstand außerhalb: „12 Min. nach dem Ende“, „2 Std. 5 Min. vor dem Start“ (2.20.0: Einheiten wie F.dur). */
  function abstandText(a) {
    if (a.min == null) return 'keine Spur mit Zeiten';
    const m = Math.max(0, a.min), t = m >= 60 ? Math.floor(m / 60) + ' Std.' + (m % 60 ? ' ' + (m % 60) + ' Min.' : '') : m + ' Min.';
    return t + (a.seite === 'vor' ? ' vor dem Start' : ' nach dem Ende');
  }

  /** Zusammenfassung: „5 Fotos bekommen einen Ort · 2 liegen außerhalb“. */
  function zusammenfassung(v) {
    const n = v.treffer.length, a = v.ausserhalb.length + v.ohneZeit.length;
    return (n === 1 ? '1 Foto bekommt einen Ort' : n + ' Fotos bekommen einen Ort') + (a ? ' · ' + a + (a === 1 ? ' liegt' : ' liegen') + ' außerhalb' : '');
  }

  /** Alte Werte merken (für „Rückgängig“, ein Schritt). */
  function sichern(fotos) {
    return (fotos || []).map(p => ({ id: p.id, lat: p.lat == null ? null : p.lat, lon: p.lon == null ? null : p.lon, pos: p.pos || 'none', tour: p.tour || '', camShift: p.camShift == null ? null : p.camShift }));
  }

  /** Übernahme auf ein Foto anwenden (gibt eine Kopie zurück). */
  function anwenden(p, t, tourId, versatzMs) {
    const q = Object.assign({}, p, { lat: t.lat, lon: t.lon, pos: 'zeit', tour: tourId });
    if (versatzMs) q.camShift = versatzMs; else delete q.camShift;
    return q;
  }

  /** Gemerkte Werte zurückschreiben (gibt eine Kopie zurück). */
  function zurueck(p, alt) {
    const q = Object.assign({}, p, { lat: alt.lat, lon: alt.lon, pos: alt.pos, tour: alt.tour });
    if (alt.camShift == null) delete q.camShift; else q.camShift = alt.camShift;
    return q;
  }

  const api = { TOLERANZEN, TOL_VORGABE, SPANNE_MS, versatz, versatzText, spur, ortBei, eigenerOrt, kandidaten, vorschlag, kmText, beispiel, abstandText, zusammenfassung, sichern, anwenden, zurueck };
  if (node) module.exports = api; else root.FotoOrtCalc = api;
})(typeof window !== 'undefined' ? window : globalThis);
