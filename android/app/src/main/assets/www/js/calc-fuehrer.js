'use strict';
/* Rechenlogik ohne Oberfläche: Wanderführer (2.4.0). Ein Buch besteht aus Buchtouren (je eine GPX-Datei); eine Buchtour gilt als gewandert, wenn eine eigene Tour
   (nicht geplant, nicht ausgeblendet) der Buchstrecke folgt. Die Regel ist die von „Meine Touren“ (app/more.py, api_guides_progress, mit app/wanderfuehrer.py):
     – mindestens 70 % der Buchstrecke liegen höchstens 120 m von der Tour entfernt (Stützpunkte: jeder step-te Punkt der Buchstrecke, step = Punkte ÷ 40), und
     – mindestens 40 % der Tour (40 gleichmäßig gewählte Punkte) liegen höchstens 80 m von der Buchstrecke entfernt.
   Die Richtung spielt keine Rolle (Rother-Touren werden auch rückwärts gegangen, wie in Meine Touren). Abweichungen vom Vorbild, alle nur genauer:
   Abstände werden mit dem Breitengrad der Strecke gerechnet (das Vorbild nimmt fest cos 50°), ein Raster ersetzt das Absuchen jeder Strecke, und die Länge einer Buchtour
   wird aus allen Punkten der GPX-Datei gerechnet (das Vorbild rechnet aus den auf 400 Punkte ausgedünnten).
   Läuft im Browser (globales `Fuehrer`) und in Node. Keine Oberfläche, kein DOM. */
(function (root) {
  const VERSION = 1;                  // Version der Regel; ändert sie sich, wird der Zwischenspeicher verworfen
  const R_BUCH = 120, ANTEIL_BUCH = 0.7;       // Anteil der Buchstrecke, der von der Tour abgedeckt sein muss (Abstand in m)
  const R_TOUR = 80, ANTEIL_TOUR = 0.4;        // Anteil der Tour, der auf der Buchstrecke liegen muss (Abstand in m)
  const RAND_LA = 0.02, RAND_LO = 0.03;        // Vorfilter: Umrandungen näher als das (Grad)
  const MAX_BUCH = 400, MAX_TOUR = 800;        // Punkte je Strecke (ausgedünnt)
  const ZELLE = 250;                            // Rasterzelle in m (größer als jeder Abstand der Regel)
  const M = 111195;                             // Meter je Breitengrad

  /* ---------- GPX einer Buchtour lesen ---------- */
  const dec = s => String(s == null ? '' : s).replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&').trim();
  const dateiname = n => String(n || '').split(/[\\/]/).pop();
  const wieDatei = s => /^[\w\- ]*\.gpx$/i.test(s);

  /** Titel: erster Name in Metadaten, Track, Route, sonst irgendein Name (kein Dateiname) – sonst der Dateiname ohne „.gpx“. */
  function titel(text, name) {
    const first = rx => { for (const blk of text.match(rx) || []) { const m = /<name>([\s\S]*?)<\/name>/.exec(blk.replace(/<(?:trkpt|rtept|wpt)\b[\s\S]*?<\/(?:trkpt|rtept|wpt)>/g, '')); const v = m && dec(m[1]); if (v && !wieDatei(v)) return v; } return null; };
    const t = first(/<metadata[\s>][\s\S]*?<\/metadata>/g) || first(/<trk[\s>][\s\S]*?<\/trk>/g) || first(/<rte[\s>][\s\S]*?<\/rte>/g) || first(/<wpt\b[\s\S]*?<\/wpt>/g);
    return (t || dateiname(name).replace(/\.gpx$/i, '') || 'Tour').slice(0, 200);
  }
  /** Länge in m (Großkreis) aus Punkten {lat, lon}. */
  function laenge(p) {
    const r = Math.PI / 180; let s = 0;
    for (let i = 1; i < p.length; i++) {
      const a = p[i - 1], b = p[i], dp = (b.lat - a.lat) * r, dl = (b.lon - a.lon) * r;
      const x = Math.sin(dp / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dl / 2) ** 2;
      s += 2 * 6371008.8 * Math.asin(Math.min(1, Math.sqrt(x)));
    }
    return s;
  }
  /** Aufstieg in m aus den Höhenangaben (wie guide_stats in Meine Touren: Mittel über 5 Werte, Schwelle 3 m); null ohne Höhen (weniger als 3). */
  function aufstieg(ele) {
    if (ele.length < 3) return null;
    const sm = ele.map((_, i) => { const w = ele.slice(Math.max(0, i - 2), i + 3); return w.reduce((a, b) => a + b, 0) / w.length; });
    let up = 0, ref = sm[0];
    for (const v of sm.slice(1)) { if (v - ref >= 3) { up += v - ref; ref = v; } else if (ref - v >= 3) ref = v; }
    return Math.round(up);
  }
  /** GPX-Text einer Buchtour: {titel, pts: [{lat, lon, ele}], km, up}. Wirft bei weniger als 3 Streckenpunkten. */
  function lies(text, name) {
    text = String(text == null ? '' : text);
    const pts = [], re = /<(?:trkpt|rtept)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:trkpt|rtept)>)/g;
    let m;
    while ((m = re.exec(text))) {
      const la = parseFloat((/lat\s*=\s*["']([^"']+)["']/.exec(m[1]) || [])[1]), lo = parseFloat((/lon\s*=\s*["']([^"']+)["']/.exec(m[1]) || [])[1]);
      if (!isFinite(la) || !isFinite(lo) || Math.abs(la) > 90 || Math.abs(lo) > 180) continue;
      const e = parseFloat((/<ele>\s*([^<\s]*)\s*<\/ele>/.exec(m[2] || '') || [])[1]);
      pts.push({ lat: la, lon: lo, ele: isFinite(e) ? e : null });
    }
    if (pts.length < 3) throw new Error('keine Streckenpunkte');
    return { titel: titel(text, name), pts, km: Math.round(laenge(pts)) / 1000, up: aufstieg(pts.filter(p => p.ele != null).map(p => p.ele)) };
  }

  /* ---------- Punkte: ausdünnen, packen ---------- */
  /** Höchstens `max` Punkte (jeder step-te, der letzte bleibt). */
  function duenne(pts, max) {
    if (pts.length <= max) return pts;
    const step = Math.ceil(pts.length / max), out = pts.filter((_, i) => i % step === 0);
    if (out[out.length - 1] !== pts[pts.length - 1]) out.push(pts[pts.length - 1]);
    return out;
  }
  const delta = a => a.map((v, i) => i ? v - a[i - 1] : v), summe = a => { let s = 0; return a.map(v => (s += v)); };
  /** Platzsparend speichern: Koordinaten auf 5 Stellen (≈ 1 m) als ganze Zahlen, nur die Unterschiede zum Vorgänger; Höhen auf 1 m (fehlende werden zum Vorgänger). */
  function packe(pts) {
    const o = { la: delta(pts.map(p => Math.round(p.lat * 1e5))), lo: delta(pts.map(p => Math.round(p.lon * 1e5))) };
    if (pts.some(p => p.ele != null)) { let last = 0; const e = pts.map(p => (p.ele != null ? (last = Math.round(p.ele)) : last)); o.e = delta(e); }
    return o;
  }
  function entpacke(o) {
    if (!o || !Array.isArray(o.la) || !Array.isArray(o.lo) || o.la.length !== o.lo.length) return [];
    const la = summe(o.la), lo = summe(o.lo), e = Array.isArray(o.e) && o.e.length === la.length ? summe(o.e) : null;
    return la.map((v, i) => ({ lat: v / 1e5, lon: lo[i] / 1e5, ele: e ? e[i] : null }));
  }
  /** Umrandung [kleinste Breite, kleinste Länge, größte Breite, größte Länge] (wie Geo.bbox). */
  function umrandung(pts) {
    let a = 90, b = 180, c = -90, d = -180;
    for (const p of pts) { if (p.lat < a) a = p.lat; if (p.lat > c) c = p.lat; if (p.lon < b) b = p.lon; if (p.lon > d) d = p.lon; }
    return [a, b, c, d];
  }
  /** Eine Buchtour für das Buch: Kennzahlen ohne die Punkte (die liegen getrennt). */
  function buchtour(gelesen, ord, dateiname_) {
    const p = duenne(gelesen.pts, MAX_BUCH);
    return { meta: { id: 't' + ord, ord, title: gelesen.titel, km: gelesen.km, up: gelesen.up, la: gelesen.pts[0].lat, lo: gelesen.pts[0].lon, bb: umrandung(p), n: p.length, f: dateiname(dateiname_) }, pts: p };
  }
  const natuerlich = (a, b) => String(a).localeCompare(String(b), 'de', { numeric: true, sensitivity: 'base' });

  /* ---------- Abgleich ---------- */
  /** Streckenzug für schnelle Abstandsfragen: lokale Meter, Raster mit Zellen von 250 m. pts: [{lat, lon}]. */
  function vorbereiten(pts) {
    const n = pts.length, la0 = n ? pts[0].lat : 0, lo0 = n ? pts[0].lon : 0, k = Math.cos(la0 * Math.PI / 180) * M;
    const x = new Float64Array(n), y = new Float64Array(n);
    for (let i = 0; i < n; i++) { x[i] = (pts[i].lon - lo0) * k; y[i] = (pts[i].lat - la0) * M; }
    return { n, pts, la0, lo0, k, x, y, bb: n ? umrandung(pts) : null, raster: null };
  }
  const zk = (cx, cy) => cx * 100003 + cy;
  function raster(p) {
    if (p.raster) return p.raster;
    const g = new Map(), put = (cx, cy, i) => { const key = zk(cx, cy); let l = g.get(key); if (!l) g.set(key, l = []); if (l[l.length - 1] !== i) l.push(i); };
    for (let i = 0; i < p.n - 1; i++) {
      const dx = p.x[i + 1] - p.x[i], dy = p.y[i + 1] - p.y[i], len = Math.hypot(dx, dy), st = Math.min(2000, Math.max(1, Math.ceil(len / (ZELLE / 2))));
      for (let s = 0; s <= st; s++) put(Math.floor((p.x[i] + dx * s / st) / ZELLE), Math.floor((p.y[i] + dy * s / st) / ZELLE), i);
    }
    if (p.n === 1) put(Math.floor(p.x[0] / ZELLE), Math.floor(p.y[0] / ZELLE), 0);
    return (p.raster = g);
  }
  /** Liegt der Punkt (Breite, Länge) höchstens r Meter von der Strecke? */
  function nah(p, la, lo, r) {
    const px = (lo - p.lo0) * p.k, py = (la - p.la0) * M, g = raster(p), cx = Math.floor(px / ZELLE), cy = Math.floor(py / ZELLE), r2 = r * r;
    if (p.n === 1) return (px - p.x[0]) ** 2 + (py - p.y[0]) ** 2 <= r2;
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      const l = g.get(zk(cx + a, cy + b)); if (!l) continue;
      for (const i of l) {
        const ax = p.x[i], ay = p.y[i], dx = p.x[i + 1] - ax, dy = p.y[i + 1] - ay, L = dx * dx + dy * dy;
        const u = L === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L));
        if ((px - ax - u * dx) ** 2 + (py - ay - u * dy) ** 2 <= r2) return true;
      }
    }
    return false;
  }
  /** Anteil der Stützpunkte (Indizes in `von`), die höchstens r m von der Strecke `an` entfernt sind. */
  function abdeckung(von, idx, an, r) {
    if (!idx.length) return 0;
    let hit = 0;
    for (const i of idx) if (nah(an, von.pts[i].lat, von.pts[i].lon, r)) hit++;
    return hit / idx.length;
  }
  const stuetzBuch = n => { const step = Math.max(1, Math.floor(n / 40)), o = []; for (let i = 0; i < n; i += step) o.push(i); return o; };
  const stuetzTour = n => { const m = Math.min(40, n), o = []; for (let i = 0; i < m; i++) o.push(Math.floor(i * (n - 1) / Math.max(1, m - 1))); return o; };
  /** Vergleich einer Buchstrecke mit einer Tour (beide vorbereitet): {buch, tour, folgt, wert}.
      buch = Anteil der Buchstrecke, den die Tour abdeckt; tour = Anteil der Tour auf der Buchstrecke; wert = buch · tour (zum Ordnen). */
  function vergleiche(buch, tour) {
    const o = { buch: 0, tour: 0, folgt: false, wert: 0 };
    if (!buch || !tour || buch.n < 2 || tour.n < 6) return o;
    o.buch = abdeckung(buch, stuetzBuch(buch.n), tour, R_BUCH);
    if (o.buch < ANTEIL_BUCH) return o;                                   // billige Absage zuerst
    o.tour = abdeckung(tour, stuetzTour(tour.n), buch, R_TOUR);
    o.folgt = o.tour >= ANTEIL_TOUR; o.wert = o.buch * o.tour;
    return o;
  }
  /** Liegen die Umrandungen [la0, lo0, la1, lo1] nah genug beieinander, dass ein Vergleich möglich ist? */
  function nahe(a, b) { return !!a && !!b && !(a[0] - RAND_LA > b[2] || a[2] + RAND_LA < b[0] || a[1] - RAND_LO > b[3] || a[3] + RAND_LO < b[1]); }

  /** Gelaufene Tour, die für den Abgleich zählt: nicht geplant, nicht ausgeblendet, mit Umrandung. */
  const zaehlt = t => !!t && t.status !== 'planned' && !t.hidden && Array.isArray(t.bbox) && t.bbox.length === 4;
  /** Kennung des Spurstands einer Tour (ändert sich mit Strecke, Beginn und Umrandung): 32-Bit-Streuwert als Text. */
  function sig(t) {
    const s = Math.round(t.dist || 0) + '|' + (t.start || 0) + '|' + (t.bbox || []).map(v => Math.round(v * 1e4)).join(',');
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(36);
  }

  /* ---------- Zwischenspeicher: je Tour ein Text pro Buch, ein Zeichen je Buchtour (1 folgt, 0 folgt nicht, - nicht verglichen) ---------- */
  const leer = () => ({ v: VERSION, t: {} });
  const sauber = c => (c && c.v === VERSION && c.t && typeof c.t === 'object' ? c : leer());
  const zeichen = (c, tid, sg, buchId, ord) => { const e = c.t[tid]; if (!e || e.s !== sg) return '-'; const s = e.b && e.b[buchId]; return s && s[ord] ? s[ord] : '-'; };
  function setze(c, tid, sg, buchId, ord, z) {
    let e = c.t[tid]; if (!e || e.s !== sg) e = c.t[tid] = { s: sg, b: {} };
    let s = e.b[buchId] || '';
    if (s.length <= ord) s += '-'.repeat(ord - s.length + 1);
    e.b[buchId] = s.slice(0, ord) + z + s.slice(ord + 1);
  }
  /** Nicht mehr gebrauchte Einträge (gelöschte Touren und Bücher) entfernen. */
  function raeume(c, touren, buecher) {
    const ids = new Set(touren.map(t => t.id)), bids = new Set(buecher.map(b => b.id));
    for (const tid of Object.keys(c.t)) { if (!ids.has(tid)) { delete c.t[tid]; continue; } for (const b of Object.keys(c.t[tid].b)) if (!bids.has(b)) delete c.t[tid].b[b]; }
    return c;
  }

  /** Aus dem Zwischenspeicher: je Buch {gesamt, fertig, touren: {tourId: [Touren-Kennungen, jüngste zuerst]}} und wie viele Vergleiche noch fehlen.
      buecher: [{id, touren: [{id, ord, bb}]}]; touren: gelaufene Touren (nur die, die `zaehlt` erfüllen, werden verglichen). */
  function stand(buecher, touren, cache) {
    const c = sauber(cache), ts = (touren || []).filter(zaehlt).sort((a, b) => (b.start || 0) - (a.start || 0)), fehlt = { paare: 0, touren: new Set() };
    const out = {};
    for (const b of buecher || []) {
      const o = out[b.id] = { gesamt: b.touren.length, fertig: 0, touren: {} };
      for (const bt of b.touren) {
        const hit = [];
        for (const t of ts) {
          if (!nahe(bt.bb, t.bbox)) continue;
          const z = zeichen(c, t.id, sig(t), b.id, bt.ord);
          if (z === '1') hit.push(t.id); else if (z === '-') { fehlt.paare++; fehlt.touren.add(t.id); }
        }
        o.touren[bt.id] = hit; if (hit.length) o.fertig++;
      }
    }
    return { buecher: out, fehlendePaare: fehlt.paare, fehlendeTouren: fehlt.touren.size, gesamt: Object.values(out).reduce((a, b) => a + b.gesamt, 0), fertig: Object.values(out).reduce((a, b) => a + b.fertig, 0) };
  }

  const pause = () => new Promise(r => (typeof setImmediate === 'function' ? setImmediate(r) : setTimeout(r, 0)));
  /** Gleicht alle Touren mit allen Buchtouren ab – in Blöcken (nach ~12 ms wird dem Browser Luft gelassen), mit Fortschritt, abbrechbar, nur das Fehlende.
      o: {buecher, touren, cache, ladePunkte(tourId) → Promise<[{lat, lon}]>, ladeBuch(buchId) → Promise<{buchtourId: Punkte}>, fortschritt(anteil, schritt), teil(stand),
          abbrechen() → bool, pause(), ms}.
      Gibt {stand, cache, berechnet (Vergleiche), geladen (Touren), abgebrochen} zurück; der Zwischenspeicher o.cache wird dabei ergänzt (o.cache = sauber(o.cache) beim Aufrufer sichern). */
  async function rechne(o) {
    const buecher = o.buecher || [], cache = sauber(o.cache), ts = (o.touren || []).filter(zaehlt).sort((a, b) => (b.start || 0) - (a.start || 0));
    const ms = o.ms == null ? 12 : o.ms, warte = o.pause || pause, res = { berechnet: 0, geladen: 0, abgebrochen: false, cache };
    // Welche Tour braucht noch Vergleiche?
    const offen = [];
    for (const t of ts) {
      const sg = sig(t), todo = [];
      for (const b of buecher) for (const bt of b.touren) if (nahe(bt.bb, t.bbox) && zeichen(cache, t.id, sg, b.id, bt.ord) === '-') todo.push([b, bt]);
      if (todo.length) offen.push({ t, sg, todo });
    }
    const buchPunkte = new Map(), buchVorb = new Map();
    const vorb = async (b, bt) => {
      const key = b.id + ':' + bt.id; let v = buchVorb.get(key); if (v) return v;
      let alle = buchPunkte.get(b.id); if (!alle) buchPunkte.set(b.id, alle = (await o.ladeBuch(b.id)) || {});
      const p = alle[bt.id]; v = vorbereiten(Array.isArray(p) ? p : []); buchVorb.set(key, v); return v;
    };
    let t0 = Date.now(), nTeil = Date.now();
    for (let i = 0; i < offen.length; i++) {
      if (o.abbrechen && o.abbrechen()) { res.abgebrochen = true; break; }
      const { t, sg, todo } = offen[i];
      let pts = []; try { pts = await o.ladePunkte(t.id); } catch (e) { pts = []; }
      res.geladen++;
      const tv = vorbereiten(duenne(pts || [], MAX_TOUR));
      for (const [b, bt] of todo) {
        const bv = await vorb(b, bt);
        setze(cache, t.id, sg, b.id, bt.ord, vergleiche(bv, tv).folgt ? '1' : '0'); res.berechnet++;
        if (Date.now() - t0 > ms) { if (o.fortschritt) o.fortschritt(i / offen.length, i); await warte(); t0 = Date.now(); if (o.abbrechen && o.abbrechen()) { res.abgebrochen = true; break; } }
      }
      if (res.abgebrochen) break;
      if (o.teil && Date.now() - nTeil > 700) { nTeil = Date.now(); o.teil(stand(buecher, ts, cache)); }
      if (o.fortschritt && (i % 8 === 7 || i === offen.length - 1)) o.fortschritt((i + 1) / offen.length, i + 1);
    }
    raeume(cache, ts, buecher);
    res.stand = stand(buecher, ts, cache);
    return res;
  }

  /** Welchen Buchtouren folgt diese eine Tour? Für die Tourseite und den Namensvorschlag (ohne Zwischenspeicher, nur nahe Bücher werden geladen).
      Gibt höchstens `max` Treffer zurück: [{buchId, buch, id, title, km, up, wert}], die besten zuerst. */
  async function fuerTour(t, pts, buecher, ladeBuch, max) {
    if (!t || t.status === 'planned' || !pts || pts.length < 6) return [];
    const bb = umrandung(pts), tv = vorbereiten(duenne(pts, MAX_TOUR)), out = [];
    for (const b of buecher || []) {
      const nahe_ = b.touren.filter(bt => nahe(bt.bb, bb)); if (!nahe_.length) continue;
      const alle = (await ladeBuch(b.id)) || {};
      for (const bt of nahe_) {
        const r = vergleiche(vorbereiten(Array.isArray(alle[bt.id]) ? alle[bt.id] : []), tv);
        if (r.folgt) out.push({ buchId: b.id, buch: b.name, id: bt.id, title: bt.title, km: bt.km, up: bt.up, wert: r.wert });
      }
    }
    return out.sort((a, b) => b.wert - a.wert).slice(0, max || 2);
  }

  /* ---------- Anzeige: Filter, Suche, Reihenfolge ---------- */
  const klein = s => String(s == null ? '' : s).toLocaleLowerCase('de');
  /** Prozent gewandert, ganzzahlig (0 bei leerem Buch). */
  const prozent = (fertig, gesamt) => (gesamt > 0 ? Math.round(100 * fertig / gesamt) : 0);
  /** Was zeigt die Seite? buecher + stand + Auswahl {filter: 'alle' | 'offen' | 'gewandert', suche, sort: 'buch' | 'laenge'} → [{buch, touren: [Buchtour], gesamt, fertig, offen: bool}].
      Bücher ohne passende Buchtour entfallen, sobald Filter oder Suche etwas einschränken. Passt die Suche auf den Buchnamen, zeigt das Buch alle (gefilterten) Touren. */
  function ansicht(buecher, st, sel) {
    sel = sel || {}; const q = klein((sel.suche || '').trim()), f = sel.filter || 'alle', out = [];
    for (const b of buecher || []) {
      const s = st && st.buecher[b.id] || { gesamt: b.touren.length, fertig: 0, touren: {} }, nameTrifft = q && klein(b.name).includes(q);
      let l = b.touren.filter(bt => {
        const done = (s.touren[bt.id] || []).length > 0;
        if (f === 'offen' && done) return false; if (f === 'gewandert' && !done) return false;
        return !q || nameTrifft || klein(bt.title).includes(q);
      });
      l = l.slice().sort(sel.sort === 'laenge' ? (a, c) => (a.km - c.km) || (a.ord - c.ord) : (a, c) => a.ord - c.ord);
      if (!l.length && (q || f !== 'alle')) continue;
      out.push({ buch: b, touren: l, gesamt: s.gesamt, fertig: s.fertig });
    }
    return out;
  }

  const api = { VERSION, R_BUCH, ANTEIL_BUCH, R_TOUR, ANTEIL_TOUR, MAX_BUCH, MAX_TOUR, lies, titel, laenge, aufstieg, duenne, packe, entpacke, umrandung, buchtour, natuerlich, vorbereiten, nah, abdeckung,
    vergleiche, nahe, zaehlt, sig, leer, sauber, zeichen, setze, raeume, stand, rechne, fuerTour, prozent, ansicht };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Fuehrer = api;
})(typeof window !== 'undefined' ? window : globalThis);
