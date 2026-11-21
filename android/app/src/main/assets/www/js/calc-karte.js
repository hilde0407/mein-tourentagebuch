'use strict';
/* Rechenlogik ohne Oberfläche für die Karte im Tour-PDF (2.6.0).
   Welche OpenStreetMap-Kacheln (256 × 256 px, Web-Mercator) für eine Strecke nötig sind, welche Zoomstufe die Strecke mit Rand in das Kartenfeld bringt,
   wie Längen- und Breitengrad zu Bildpunkten werden und wie der Linienzug vereinfacht wird. Laden und Zeichnen übernimmt js/v-pdf.js.
   Grenzen: höchstens MAX_KACHELN (12) Kacheln, nie mehr als GRENZE (16); dafür werden die Kacheln im Feld etwas größer gezeichnet (Maßstab ≥ 1,5),
   so bleibt auch die Beschriftung der Karte im Druck lesbar. Über die Datumsgrenze hinweg wird nicht gerechnet (für Touren nicht nötig).
   Läuft im Browser (globales `Karte`) und in Node. */
(function (root) {
  const node = typeof module !== 'undefined' && module.exports;
  const TILE = 256, MAXLAT = 85.0511287798, RAD = Math.PI / 180;
  const MAX_KACHELN = 12, GRENZE = 16, ZMAX = 17, ZMIN = 1;
  const QUELLE = '© OpenStreetMap-Mitwirkende';

  /** Weltpixel (Web-Mercator) eines Punkts in Zoomstufe z: [x, y], 0 … 256 · 2^z. Breiten jenseits ±85,05° werden begrenzt. */
  function welt(lat, lon, z) {
    const s = TILE * Math.pow(2, z), la = Math.max(-MAXLAT, Math.min(MAXLAT, lat)) * RAD;
    return [(lon + 180) / 360 * s, (1 - Math.log(Math.tan(la) + 1 / Math.cos(la)) / Math.PI) / 2 * s];
  }
  /** Umkehrung von welt(): [lat, lon]. */
  function geo(x, y, z) {
    const s = TILE * Math.pow(2, z), n = Math.PI - 2 * Math.PI * y / s;
    return [Math.atan(Math.sinh(n)) / RAD, x / s * 360 - 180];
  }
  /** Nur Punkte mit gültiger Position (ohne GPS: keine). */
  const gueltig = pts => (pts || []).filter(p => p && isFinite(p.lat) && isFinite(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180 && p.lat !== null && p.lon !== null);

  /** Schlimmster Fall: so viele Kacheln braucht ein Feld w × h bei Maßstab k (Kachel im Feld 256·k px), je nach Lage der Kachelgrenzen. */
  const hoechstens = (w, h, k) => (Math.ceil(w / (TILE * k)) + 1) * (Math.ceil(h / (TILE * k)) + 1);
  /** Kleinster Maßstab ab 1,5 (in Schritten von 0,05), bei dem das Feld nie mehr als max Kacheln braucht. */
  function massstab(w, h, max) {
    let k = 1.5;
    while (hoechstens(w, h, k) > (max || MAX_KACHELN) && k < 20) k = Math.round((k + 0.05) * 100) / 100;
    return k;
  }

  /** Douglas-Peucker (ohne Rekursion) für [[x, y, …]]: Punkte, die weniger als tol vom Linienzug abweichen, entfallen. Erster und letzter bleiben. */
  function dp(p, tol) {
    if (p.length <= 2) return p.slice();
    const keep = new Uint8Array(p.length); keep[0] = keep[p.length - 1] = 1;
    const st = [[0, p.length - 1]], t2 = tol * tol;
    while (st.length) {
      const [a, b] = st.pop(); let best = -1, bi = -1;
      const ax = p[a][0], ay = p[a][1], dx = p[b][0] - ax, dy = p[b][1] - ay, l2 = dx * dx + dy * dy;
      for (let i = a + 1; i < b; i++) {
        let qx = p[i][0] - ax, qy = p[i][1] - ay;
        if (l2 > 0) { const t = Math.max(0, Math.min(1, (qx * dx + qy * dy) / l2)); qx -= t * dx; qy -= t * dy; }
        const d = qx * qx + qy * qy; if (d > best) { best = d; bi = i; }
      }
      if (best > t2) { keep[bi] = 1; st.push([a, bi], [bi, b]); }
    }
    return p.filter((_, i) => keep[i]);
  }
  /** Linienzug [[x, y, neuesStück]] vereinfachen; jedes Stück (neuesStück = true am Anfang) für sich, damit Lücken Lücken bleiben. */
  function vereinfachen(punkte, tol) {
    const out = []; let cur = [];
    const fertig = () => { if (cur.length) dp(cur, tol).forEach((q, i) => out.push([q[0], q[1], !!(i === 0 && out.length && q[2])])); cur = []; };
    punkte.forEach((q, i) => { if (i && q[2]) fertig(); cur.push(q); });
    fertig();
    return out;
  }

  /** Größte Zoomstufe (zmin … zmax), in der die Strecke (Weltpixel-Ausdehnung bw0 × bh0 bei z = 0) mit Maßstab k und Rand pad in w × h passt. */
  function zoom(bw0, bh0, w, h, k, pad, zmin, zmax) {
    for (let z = zmax; z > zmin; z--) { const f = Math.pow(2, z) * k; if (bw0 * f <= w - 2 * pad && bh0 * f <= h - 2 * pad) return z; }
    return zmin;
  }
  /** Kacheln, die ein Feld w × h um die Weltpixel-Mitte (cx, cy) bei Zoom z und Maßstab k bedecken: [{ z, x, y, dx, dy, s }] (dx, dy, s in Feldpixeln).
      Zeilen außerhalb der Welt entfallen, Spalten werden um die Welt herum gezählt. */
  function kacheln(cx, cy, z, w, h, k) {
    const n = Math.pow(2, z), vx = cx - w / (2 * k), vy = cy - h / (2 * k), out = [];
    const x0 = Math.floor(vx / TILE), x1 = Math.floor((vx + w / k - 1e-9) / TILE), y0 = Math.floor(vy / TILE), y1 = Math.floor((vy + h / k - 1e-9) / TILE);
    for (let ty = y0; ty <= y1; ty++) {
      if (ty < 0 || ty >= n) continue;
      for (let tx = x0; tx <= x1; tx++) out.push({ z, x: ((tx % n) + n) % n, y: ty, dx: (tx * TILE - vx) * k, dy: (ty * TILE - vy) * k, s: TILE * k });
    }
    return out;
  }

  /** Alles für die Karte einer Strecke in einem Feld w × h (Bildpunkte der PDF-Seite). opts: pad (Rand, Vorgabe 56), max (Kacheln, Vorgabe 12), zmax (17), zmin (1), tol (0,75 px).
      Gibt null zurück, wenn es keine zwei Punkte mit Position gibt (dann keine Karte), sonst
      { z, k, kacheln, punkte: [[x, y, neuesStück]], start, ziel, quelle }. Alle Punkte liegen im Feld (mit Rand), es sind nie mehr als 16 Kacheln. */
  function plan(pts, w, h, opts) {
    opts = opts || {};
    const v = gueltig(pts);
    if (v.length < 2 || !(w > 0) || !(h > 0)) return null;
    const pad = opts.pad == null ? 56 : opts.pad, max = Math.min(GRENZE, opts.max || MAX_KACHELN), zmax = opts.zmax || ZMAX, zmin = opts.zmin || ZMIN;
    const k = massstab(w, h, max);
    let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
    const w0 = v.map(p => { const q = welt(p.lat, p.lon, 0); a = Math.min(a, q[0]); b = Math.min(b, q[1]); c = Math.max(c, q[0]); d = Math.max(d, q[1]); return q; });
    const z = zoom(c - a, d - b, w, h, k, pad, zmin, zmax), f = Math.pow(2, z), cx = (a + c) / 2 * f, cy = (b + d) / 2 * f;
    const ks = kacheln(cx, cy, z, w, h, k);
    if (!ks.length || ks.length > GRENZE) return null;
    const vx = cx - w / (2 * k), vy = cy - h / (2 * k);
    const roh = w0.map((q, i) => [(q[0] * f - vx) * k, (q[1] * f - vy) * k, i > 0 && !!v[i].newSeg]);
    const punkte = vereinfachen(roh, opts.tol == null ? 0.75 : opts.tol);
    return { z, k, kacheln: ks, punkte, start: punkte[0], ziel: punkte[punkte.length - 1], quelle: QUELLE };
  }
  /** Adresse einer Kachel beim OpenStreetMap-Kachelserver. */
  const url = t => 'https://tile.openstreetmap.org/' + t.z + '/' + t.x + '/' + t.y + '.png';

  const api = { TILE, MAX_KACHELN, GRENZE, ZMAX, QUELLE, welt, geo, gueltig, hoechstens, massstab, dp, vereinfachen, zoom, kacheln, plan, url };
  if (node) module.exports = api; else root.Karte = api;
})(typeof window !== 'undefined' ? window : globalThis);
