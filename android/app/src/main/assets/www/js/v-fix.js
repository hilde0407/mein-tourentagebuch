'use strict';
/* Tour verbessern: Höhen aus dem Geländemodell (Terrarium-Kacheln) und GPS-Track korrigieren.
   Die Originalwerte bleiben erhalten (trk.origEle / trk.orig) und lassen sich wiederherstellen. */

const Fix = {
  Z: 12,
  tileUrl: (x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${Fix.Z}/${x}/${y}.png`,
  _tiles: {},
  /** Eine Kachel als Pixelfeld (RGBA) laden. Im Handy über die Hülle (kein CORS), im Browser direkt. */
  async tile(x, y) {
    const k = x + '/' + y;
    if (!Fix._tiles[k]) Fix._tiles[k] = (async () => {
      let src = Fix.tileUrl(x, y);
      if (window.MTApp) {
        const r = await Native.http({ url: src, bin: true });
        if (r.status >= 400) throw new Error('Geländedaten: HTTP ' + r.status);
        src = 'data:image/png;base64,' + r.b64;
      }
      const img = await new Promise((ok, no) => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => ok(i); i.onerror = () => no(new Error('Geländedaten nicht ladbar')); i.src = src; });
      const c = document.createElement('canvas'); c.width = c.height = 256;
      const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0);
      return g.getImageData(0, 0, 256, 256).data;
    })();
    return Fix._tiles[k];
  },
  /** Geländehöhe (m) für [{lat,lon}], bilinear zwischen den vier nächsten Bildpunkten. */
  async terrain(pts) {
    const n = 2 ** Fix.Z, out = [];
    for (const p of pts) {
      const fx = ((p.lon + 180) / 360 * n) * 256 - 0.5;
      const la = p.lat * Math.PI / 180;
      const fy = ((1 - Math.log(Math.tan(la) + 1 / Math.cos(la)) / Math.PI) / 2 * n) * 256 - 0.5;
      const x0 = Math.floor(fx), y0 = Math.floor(fy), wx = fx - x0, wy = fy - y0;
      const hh = async (ix, iy) => {
        const d = await Fix.tile(Math.floor(ix / 256), Math.floor(iy / 256));
        const o = ((iy % 256 + 256) % 256 * 256 + (ix % 256 + 256) % 256) * 4;
        return d[o] * 256 + d[o + 1] + d[o + 2] / 256 - 32768;
      };
      const [a, b, c, d] = await Promise.all([hh(x0, y0), hh(x0 + 1, y0), hh(x0, y0 + 1), hh(x0 + 1, y0 + 1)]);
      out.push(a * (1 - wx) * (1 - wy) + b * wx * (1 - wy) + c * (1 - wx) * wy + d * wx * wy);
    }
    return out;
  },
  /** Höhen der Tour durch Geländehöhen ersetzen. Bei langen Touren werden Stützpunkte gerechnet und dazwischen verbunden. */
  async demFix(t, onProgress) {
    const trk = await DB.get('tracks', t.id);
    if (!trk || trk.lat.length < 5) throw new Error('Keine Streckenpunkte vorhanden');
    const n = trk.lat.length, step = Math.max(1, Math.ceil(n / 600)), idx = [];
    for (let i = 0; i < n; i += step) idx.push(i);
    if (idx[idx.length - 1] !== n - 1) idx.push(n - 1);
    const hs = [];
    for (let k = 0; k < idx.length; k++) { hs.push((await Fix.terrain([{ lat: trk.lat[idx[k]], lon: trk.lon[idx[k]] }]))[0]); if (onProgress && k % 40 === 0) onProgress(k / idx.length); }
    const ele = new Array(n); let j = 0;
    for (let i = 0; i < n; i++) {
      while (j < idx.length - 2 && idx[j + 1] < i) j++;
      const a = idx[j], b = idx[j + 1], f = b === a ? 0 : (i - a) / (b - a);
      ele[i] = Math.round((hs[j] + (hs[j + 1] - hs[j]) * f) * 10) / 10;
    }
    if (!trk.origEle) { trk.origEle = trk.ele.slice(); t.origUp = t.up; t.origDown = t.down; }
    trk.ele = ele;
    await DB.put('tracks', trk);
    t.elevFix = 1;
    return Tours.recalc(t.id).then(r => { r.elevFix = 1; delete r.elevSrc; r.origUp = t.origUp; r.origDown = t.origDown; return Tours.save(r).then(() => r); });
  },
  async restoreEle(t) {
    const trk = await DB.get('tracks', t.id);
    if (trk && trk.origEle) { trk.ele = trk.origEle; delete trk.origEle; await DB.put('tracks', trk); }
    const o = { up: t.origUp, down: t.origDown };
    const r = await Tours.recalc(t.id);
    delete r.elevFix; delete r.elevSrc; delete r.origUp; delete r.origDown;
    if (o.up != null && t.src === 'komoot') { r.up = o.up; r.down = o.down; r.upSrc = 'komoot'; }
    await Tours.save(r); return r;
  },
  /** Höhen aus der Uhr (Zepp, Barometer) übernehmen. Zuordnung Training ↔ Tour wie beim Puls-Nachtrag (Import.Zepp.match), Originalhöhen
      landen wie bei demFix in trk.origEle und kommen über restoreEle zurück. Gibt die neue Tour zurück. */
  async zeppEle(t) {
    const Z = Import.Zepp, acc = await DB.kvGet('zepp', null);
    if (!acc || !acc.token) throw new Error('Zepp-Zugang fehlt – bitte unter Einstellungen → Import einrichten');
    const trk = await DB.get('tracks', t.id);
    if (!trk || trk.lat.length < 5) throw new Error('Keine Streckenpunkte vorhanden');
    let sum = null, nxt = null;
    for (;;) {
      const j = await Z.req(acc, '/v1/sport/run/history.json', nxt != null ? { trackid: nxt } : {});
      sum = (j.data.summary || []).find(s => Z.match(s, [t]));
      nxt = j.data.next; if (sum || nxt == null || nxt === -1) break;
    }
    if (!sum) throw new Error('Kein passendes Zepp-Training zu dieser Tour gefunden');
    const dj = await Z.req(acc, '/v1/sport/run/detail.json', { trackid: sum.trackid, source: sum.source || '' });
    const t0 = trk.t.find(x => x != null);
    // Nur ganze Halbstunden ausgleichen (Zeitzonen-Versatz, z. B. bei Komoot-Zeiten); ein paar Minuten Startunterschied zwischen Uhr und Handy sind echte Zeit und dürfen die Höhenreihe nicht verschieben
    const shift = t0 != null ? Math.round((t0 - parseInt(sum.trackid, 10) * 1000) / 1800000) * 1800000 : 0;
    const zp = Z.decode(sum, dj.data).filter(p => p.ele != null).map(p => ({ t: p.t + shift, alt: p.ele }));
    const ele = Geo.alignAlt(trk.lat.map((_, i) => ({ t: trk.t[i], ele: trk.ele[i] })), zp);
    if (!ele) throw new Error('Zepp-Training hat keine brauchbaren Höhendaten');
    if (!trk.origEle) { trk.origEle = trk.ele.slice(); t.origUp = t.up; t.origDown = t.down; }
    trk.ele = ele;
    await DB.put('tracks', trk);
    const r = await Tours.recalc(t.id);
    r.elevSrc = 'zepp'; delete r.elevFix; r.origUp = t.origUp; r.origDown = t.origDown;
    await Tours.save(r); return r;
  },
  /** Höhenangabe wirkt unglaubwürdig (mehr als 120 Höhenmeter je km und über 400 m). */
  suspicious: t => (t.dist || 0) > 500 && (t.up || 0) > 120 * (t.dist / 1000) && (t.up || 0) > 400,
  /** Schwellen für „zu schnell“ je Sportart (km/h). */
  maxSpeed: s => ({ hike: 9, walk: 9, mountaineering: 9, run: 20, bike: 45, mtb: 45, racebike: 60, ebike: 45 }[s] || 80),
  /** Ausreißer (einzelne Punkte, die wegspringen) und zu schnelle Abschnitte finden. */
  detect(pts, sport) {
    const spike = [], fast = [];
    const lim = Fix.maxSpeed(sport) / 3.6;
    for (let i = 1; i < pts.length - 1; i++) {
      const a = pts[i - 1], b = pts[i], c = pts[i + 1];
      if (b.newSeg || c.newSeg || b.skip) continue;
      const d1 = Geo.dist(a.lat, a.lon, b.lat, b.lon), d2 = Geo.dist(b.lat, b.lon, c.lat, c.lon), d0 = Geo.dist(a.lat, a.lon, c.lat, c.lon);
      if (d1 > 50 && d2 > 50 && d1 + d2 > 3 * Math.max(d0, 10)) spike.push(i);
    }
    const bad = new Set(spike);
    let run = null;
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i], q = pts[i - 1];
      const dt = p.t && q.t ? (p.t - q.t) / 1000 : 0;
      const isFast = !p.newSeg && !bad.has(i) && !bad.has(i - 1) && !p.skip && dt > 0 && Geo.dist(q.lat, q.lon, p.lat, p.lon) / dt > lim;
      if (isFast) { if (!run) { run = { from: i - 1, to: i }; fast.push(run); } else run.to = i; } else run = null;
    }
    return { spike, fast };
  },
  async backup(trk) {
    if (!trk.orig) trk.orig = { lat: trk.lat.slice(), lon: trk.lon.slice(), ele: trk.ele.slice(), t: trk.t.slice(), seg: (trk.seg || []).slice(), hr: trk.hr ? trk.hr.slice() : null, skip: trk.skip ? trk.skip.slice() : null };
  },
  async removePoints(id, drop) {
    const trk = await DB.get('tracks', id); await Fix.backup(trk);
    const keep = trk.lat.map((_, i) => !drop.has(i));
    for (const k of ['lat', 'lon', 'ele', 't', 'seg', 'hr', 'skip']) if (trk[k]) trk[k] = trk[k].filter((_, i) => keep[i]);
    await DB.put('tracks', trk);
  },
  async excludeRuns(id, runs) {
    const trk = await DB.get('tracks', id); await Fix.backup(trk);
    const sk = trk.skip || trk.lat.map(() => 0);
    runs.forEach(r => { for (let i = r.from + 1; i <= r.to; i++) sk[i] = 1; });
    trk.skip = sk; await DB.put('tracks', trk);
  },
  async restoreTrack(id) {
    const trk = await DB.get('tracks', id);
    if (!trk || !trk.orig) return false;
    const o = trk.orig, ke = trk.origEle;
    Object.assign(trk, { lat: o.lat, lon: o.lon, ele: ke || o.ele, t: o.t, seg: o.seg });
    if (o.hr) trk.hr = o.hr; else delete trk.hr;
    if (o.skip) trk.skip = o.skip; else delete trk.skip;
    delete trk.orig; await DB.put('tracks', trk); return true;
  },
};

Views['/fix'] = async (root, [id]) => {
  const t = await DB.get('tours', id);
  if (!t) { root.append(topbar('Track korrigieren', { back: true }), h('div', { class: 'empty' }, h('p', null, 'Diese Tour gibt es nicht mehr.'))); return; }
  const pts = await Tours.points(id);
  const trk = await DB.get('tracks', id);
  const found = Fix.detect(pts, t.sport);
  const skipped = pts.filter(p => p.skip).length;
  const mapEl = h('div', { class: 'map fixmap' });
  const info = h('div', { class: 'pad' });
  root.append(topbar('Track korrigieren', { back: true }), mapEl, info);
  const map = MapKit.create(mapEl);
  const layer = MapKit.line(pts, MapKit.routeColor(t.sport, '#2e7d32'), 4).addTo(map);
  if (pts.length) map.fitBounds(layer.getBounds(), { padding: [20, 20] });
  found.spike.forEach(i => L.circleMarker([pts[i].lat, pts[i].lon], { radius: 6, color: '#fff', weight: 2, fillColor: '#c62828', fillOpacity: 1 }).addTo(map));
  found.fast.forEach(r => L.polyline(pts.slice(r.from, r.to + 1).map(p => [p.lat, p.lon]), { color: '#ef6c00', weight: 7, opacity: 0.95 }).addTo(map));
  pts.forEach((p, i) => { if (p.skip && i && !pts[i - 1].newSeg) L.polyline([[pts[i - 1].lat, pts[i - 1].lon], [p.lat, p.lon]], { color: '#757575', weight: 6, dashArray: '2 8', opacity: 0.9 }).addTo(map); });
  setTimeout(() => { try { if (map.getContainer().isConnected) map.invalidateSize(); } catch (e) { /* Ansicht schon verlassen */ } }, 200);

  const done = async msg => { await Tours.recalc(id); toast(msg); Nav.render(); };
  info.append(
    h('p', { class: 'muted' }, 'Rote Punkte sind Ausreißer, orange Abschnitte sind für diese Sportart zu schnell (zum Beispiel Auto, Seilbahn oder GPS-Sprung). Grau gestrichelt ist bereits ausgeschlossen.'),
    h('div', { class: 'card' }, h('div', { id: 'fx-sum' }, `${found.spike.length} Ausreißer · ${found.fast.length} schnelle Abschnitte` + (skipped ? ` · ${skipped} ausgeschlossene Punkte` : ''))),
    h('div', { class: 'col' },
      h('button', { class: 'btn pri', id: 'fx-spike', disabled: !found.spike.length, onclick: async () => { await Fix.removePoints(id, new Set(found.spike)); await done(found.spike.length + ' Ausreißer entfernt'); } }, 'Ausreißer entfernen'),
      h('button', { class: 'btn pri', id: 'fx-fast', disabled: !found.fast.length, onclick: async () => { await Fix.excludeRuns(id, found.fast); await done('Schnelle Abschnitte ausgeschlossen'); } }, 'Schnelle Abschnitte ausschließen'),
      trk && trk.orig ? h('button', { class: 'btn', id: 'fx-restore', onclick: async () => { if (await confirmBox('Original wiederherstellen?', 'Der Track wird wieder so, wie er importiert oder aufgezeichnet wurde.', 'Wiederherstellen')) { await Fix.restoreTrack(id); await done('Original wiederhergestellt'); } } }, 'Original wiederherstellen') : null));
};

/* Namensvorschläge: Orte (Start, Ziel, weitester Punkt) und Gipfel in der Nähe des höchsten Punkts. */
const Suggest = {
  sportName: { hike: 'Wanderung', walk: 'Spaziergang', mtb: 'MTB-Tour', bike: 'Radtour', racebike: 'Rennradtour', ebike: 'E-Bike-Tour', run: 'Lauf', ski: 'Skitour', mountaineering: 'Bergtour' },
  async peak(lat, lon) {
    const q = `[out:json][timeout:10];(node(around:350,${lat},${lon})["natural"~"peak|saddle"]["name"];node(around:350,${lat},${lon})["tourism"="alpine_hut"]["name"];);out;`;
    const r = await Native.http({ url: 'https://overpass-api.de/api/interpreter?data=' + encodeURIComponent(q), headers: { 'User-Agent': 'MeinTourentagebuch/1.0' } });
    if (r.status !== 200) throw new Error('Overpass: HTTP ' + r.status);
    const els = (JSON.parse(r.body).elements || []).filter(e => e.tags && e.tags.name);
    els.sort((a, b) => Geo.dist(lat, lon, a.lat, a.lon) - Geo.dist(lat, lon, b.lat, b.lon));
    return els.length ? els[0].tags.name : null;
  },
  /** Liste von Namensvorschlägen (ohne den aktuellen Namen), höchstens 6. */
  async names(t, pts) {
    if (!pts.length) throw new Error('Keine Streckenpunkte vorhanden');
    const sp = Suggest.sportName[t.sport] || 'Tour', s = pts[0], e = pts[pts.length - 1];
    const far = pts.reduce((m, p) => Geo.dist(s.lat, s.lon, p.lat, p.lon) > Geo.dist(s.lat, s.lon, m.lat, m.lon) ? p : m, s);
    const hi = pts.reduce((m, p) => p.ele != null && (m == null || p.ele > m.ele) ? p : m, null);
    const loop = Geo.dist(s.lat, s.lon, e.lat, e.lon) < Math.max(500, 0.15 * (t.dist || 0));
    const errs = []; const safe = async f => { try { return await f(); } catch (x) { errs.push(x.message); return null; } };
    const a = await safe(() => Places.name(s.lat, s.lon));
    const b = loop ? null : await safe(() => Places.name(e.lat, e.lon));
    const f = loop && Geo.dist(s.lat, s.lon, far.lat, far.lon) > 2500 ? await safe(() => Places.name(far.lat, far.lon)) : null;
    const wantPeak = hi && s.ele != null && hi.ele - s.ele >= 150 && ['hike', 'mountaineering', 'ski'].includes(t.sport);
    const pk = wantPeak ? await safe(() => Suggest.peak(hi.lat, hi.lon)) : null;
    const out = [];
    if (!loop && a && b && a !== b) out.push(`${sp} von ${a} nach ${b}`);
    if (pk) out.push(a ? `${sp} ${a} – ${pk}` : `${sp} zum ${pk}`);
    if (a) out.push(`${sp} bei ${a}`);
    if (f && a && f !== a) out.push(`${sp} ${a} – ${f}`);
    if (loop && a) out.push(t.sport === 'hike' || t.sport === 'run' ? `Runde um ${a}` : `${sp}-Runde ${a}`);
    const res = [...new Set(out)].filter(x => x !== t.name).slice(0, 6);
    if (!res.length && errs.length) throw new Error(errs[0]);
    return res;
  },
};
