'use strict';
/* Geometrie und Kennzahlen einer Spur. Punkte: {lat, lon, ele, t} (t in ms, ele in m, beide evtl. null). */
const Geo = {
  R: 6371008.8,
  dist(a, b, c, d) {
    const r = Math.PI / 180, p = (c - a) * r, l = (d - b) * r;
    const x = Math.sin(p / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin(l / 2) ** 2;
    return 2 * Geo.R * Math.asin(Math.min(1, Math.sqrt(x)));
  },
  bearing(a, b, c, d) {
    const r = Math.PI / 180, y = Math.sin((d - b) * r) * Math.cos(c * r);
    const x = Math.cos(a * r) * Math.sin(c * r) - Math.sin(a * r) * Math.cos(c * r) * Math.cos((d - b) * r);
    return (Math.atan2(y, x) / r + 360) % 360;
  },
  /** Aufstieg/Abstieg mit Schwellwert (Hysterese), damit GPS-Rauschen nicht mitzählt. */
  climb(ele, thr) {
    thr = thr || 4;
    let up = 0, down = 0, ref = null;
    for (const e of ele) {
      if (e == null || isNaN(e)) continue;
      if (ref == null) { ref = e; continue; }
      if (e - ref >= thr) { up += e - ref; ref = e; }
      else if (ref - e >= thr) { down += ref - e; ref = e; }
    }
    return [up, down];
  },
  smooth(ele, n) {
    n = n || 2;
    return ele.map((_, i) => {
      let s = 0, c = 0;
      for (let k = Math.max(0, i - n); k <= Math.min(ele.length - 1, i + n); k++) if (ele[k] != null) { s += ele[k]; c++; }
      return c ? s / c : null;
    });
  },
  /** Kennzahlen aus Punktliste (Punkte dürfen newSeg haben: dann kein Abstand zum Vorgänger). */
  stats(pts) {
    const o = { dist: 0, dur: 0, moving: 0, up: 0, down: 0, maxAlt: null, minAlt: null, start: null, end: null, n: pts.length };
    if (!pts.length) return o;
    let ele = [];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      if (p.ele != null && !isNaN(p.ele)) { o.maxAlt = o.maxAlt == null ? p.ele : Math.max(o.maxAlt, p.ele); o.minAlt = o.minAlt == null ? p.ele : Math.min(o.minAlt, p.ele); }
      ele.push(p.ele == null ? null : p.ele);
      if (i && !p.newSeg) {
        const q = pts[i - 1], d = Geo.dist(q.lat, q.lon, p.lat, p.lon);
        o.dist += d;
        if (p.t && q.t) {
          const dt = (p.t - q.t) / 1000;
          if (dt > 0 && dt < 120 && d / dt > 0.25) o.moving += dt;
        }
      }
    }
    const ts = pts.map(p => p.t).filter(Boolean);
    if (ts.length > 1) { o.start = ts[0]; o.end = ts[ts.length - 1]; o.dur = (o.end - o.start) / 1000; }
    else if (ts.length) o.start = ts[0];
    [o.up, o.down] = Geo.climb(Geo.smooth(ele, 2), 4);
    return o;
  },
  bbox(pts) {
    let a = 90, b = 180, c = -90, d = -180;
    for (const p of pts) { a = Math.min(a, p.lat); b = Math.min(b, p.lon); c = Math.max(c, p.lat); d = Math.max(d, p.lon); }
    return [a, b, c, d];
  },
  /** Douglas-Peucker über Index-Liste (für die Anzeige auf der Karte). eps in Metern. */
  simplify(pts, eps) {
    if (pts.length < 3) return pts.slice();
    const k = Math.cos(pts[0].lat * Math.PI / 180) * 111320, m = 110540;
    const X = pts.map(p => p.lon * k), Y = pts.map(p => p.lat * m);
    const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
    const st = [[0, pts.length - 1]];
    while (st.length) {
      const [s, e] = st.pop();
      let mx = 0, mi = -1;
      const dx = X[e] - X[s], dy = Y[e] - Y[s], L = dx * dx + dy * dy;
      for (let i = s + 1; i < e; i++) {
        let d;
        if (L === 0) d = Math.hypot(X[i] - X[s], Y[i] - Y[s]);
        else { let t = ((X[i] - X[s]) * dx + (Y[i] - Y[s]) * dy) / L; t = Math.max(0, Math.min(1, t)); d = Math.hypot(X[i] - X[s] - t * dx, Y[i] - Y[s] - t * dy); }
        if (d > mx) { mx = d; mi = i; }
      }
      if (mx > eps && mi > 0) { keep[mi] = 1; st.push([s, mi], [mi, e]); }
    }
    return pts.filter((_, i) => keep[i]);
  },
  /** Position zu einer Zeit (ms) entlang der Spur; null, wenn außerhalb (± slackMs). */
  at(pts, t, slackMs) {
    slackMs = slackMs || 0;
    const n = pts.length;
    if (n < 1 || !pts[0].t || !pts[n - 1].t) return null;
    if (t < pts[0].t - slackMs || t > pts[n - 1].t + slackMs) return null;
    if (t <= pts[0].t) return { lat: pts[0].lat, lon: pts[0].lon, i: 0 };
    if (t >= pts[n - 1].t) return { lat: pts[n - 1].lat, lon: pts[n - 1].lon, i: n - 1 };
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (pts[mid].t <= t) lo = mid; else hi = mid; }
    const a = pts[lo], b = pts[hi], f = (b.t - a.t) ? (t - a.t) / (b.t - a.t) : 0;
    return { lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f, i: lo };
  },
  /** Kleinster Abstand (m) und Index eines Punktes zur Spur. */
  nearest(pts, lat, lon) {
    let best = 1e12, bi = -1;
    for (let i = 0; i < pts.length; i++) {
      const d = Geo.dist(lat, lon, pts[i].lat, pts[i].lon);
      if (d < best) { best = d; bi = i; }
    }
    return { d: best, i: bi };
  },
  gpx(name, sport, pts, wpts) {
    const x = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const iso = t => new Date(t).toISOString().replace(/\.\d+Z$/, 'Z');
    let o = '<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Mein Tourentagebuch" xmlns="http://www.topografix.com/GPX/1/1">\n';
    (wpts || []).forEach(w => { o += `<wpt lat="${w.lat}" lon="${w.lon}"><name>${x(w.name)}</name></wpt>\n`; });
    o += `<trk><name>${x(name)}</name><type>${x(sport)}</type><trkseg>\n`;
    pts.forEach((p, i) => {
      if (p.newSeg && i) o += '</trkseg><trkseg>\n';
      o += `<trkpt lat="${(+p.lat).toFixed(6)}" lon="${(+p.lon).toFixed(6)}">` + (p.ele != null ? `<ele>${(+p.ele).toFixed(1)}</ele>` : '') + (p.t ? `<time>${iso(p.t)}</time>` : '') + '</trkpt>\n';
    });
    return o + '</trkseg></trk></gpx>\n';
  },
};
if (typeof module !== 'undefined') module.exports = Geo;
