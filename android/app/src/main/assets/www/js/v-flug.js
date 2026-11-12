'use strict';
/* 3D-Flug: die Tour als Kameraflug über das Gelände (MapLibre GL mit Höhendaten). Kamera folgt der Strecke, weicht Bergen aus,
   Tempo/Neigung/Karte wählbar, Fotos tauchen beim Vorbeifliegen auf. */
const Flug = {
  loadLib: () => window.maplibregl ? Promise.resolve() : new Promise((ok, no) => {
    const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = 'vendor/maplibre-gl.css'; document.head.appendChild(l);
    const s = document.createElement('script'); s.src = 'vendor/maplibre-gl.js'; s.onload = ok; s.onerror = () => no(new Error('3D-Bibliothek konnte nicht geladen werden')); document.head.appendChild(s);
  }),
  hav: (a, b) => Geo.dist(a[0], a[1], b[0], b[1]),
  brg(a, b) {
    const r = Math.PI / 180, y = Math.sin((b[1] - a[1]) * r) * Math.cos(b[0] * r), x = Math.cos(a[0] * r) * Math.sin(b[0] * r) - Math.sin(a[0] * r) * Math.cos(b[0] * r) * Math.cos((b[1] - a[1]) * r);
    return (Math.atan2(y, x) / r + 360) % 360;
  },
  /** Berge im Weg: steilster Neigungswinkel (≤ base), bei dem die Sicht von der Kamera zum Streckenpunkt frei ist. */
  clearPitch(elev, lng, lat, bearing, base, D, floor = 28) {
    const br = bearing * Math.PI / 180, kx = 111320 * Math.cos(lat * Math.PI / 180), ky = 110540, aim = 25;
    for (let th = base; th >= floor; th -= 4) {
      const a = th * Math.PI / 180, dh = D * Math.sin(a), hz = D * Math.cos(a);
      let ok = true;
      for (let k = 1; k <= 14 && ok; k++) {
        const f = k / 15, e = elev(lng - Math.sin(br) * dh * (1 - f) / kx, lat - Math.cos(br) * dh * (1 - f) / ky);
        if (e != null && e > aim + (hz - aim) * (1 - f) - 25) ok = false;
      }
      if (ok) return th;
    }
    return floor;
  },
  /** Gleichmäßig nach Strecke abtasten, Höhe auffüllen, Kamerapfad glätten. raw = [[lat, lon, ele, t(ms), hr], …] */
  path(raw, cap = 900) {
    const cum = [0];
    for (let i = 1; i < raw.length; i++) cum.push(cum[i - 1] + Flug.hav(raw[i - 1], raw[i]));
    const total = cum[cum.length - 1] || 1, N = Math.max(60, Math.min(cap, Math.round(total / 8))), P = [];
    let la = raw.find(p => p[2] != null) ? raw.find(p => p[2] != null)[2] : 0;
    const alt = raw.map(p => (la = p[2] != null ? p[2] : la));
    for (let k = 0, j = 0; k < N; k++) {
      const d = total * k / (N - 1);
      while (j < raw.length - 2 && cum[j + 1] < d) j++;
      const f = (d - cum[j]) / (cum[j + 1] - cum[j] || 1);
      P.push({ lat: raw[j][0] + (raw[j + 1][0] - raw[j][0]) * f, lng: raw[j][1] + (raw[j + 1][1] - raw[j][1]) * f, alt: alt[j] + (alt[j + 1] - alt[j]) * f, d, hr: raw[j][4] || null,
        t: raw[j][3] != null && raw[j + 1][3] != null && raw[0][3] != null ? (raw[j][3] + (raw[j + 1][3] - raw[j][3]) * f - raw[0][3]) / 1000 : null });
    }
    const w = Math.max(3, Math.round(N / 80));
    const S = P.map((p, i) => { let a = 0, b = 0, c = 0; for (let k = Math.max(0, i - w); k <= Math.min(N - 1, i + w); k++) { a += P[k].lat; b += P[k].lng; c++; } return { lat: a / c, lng: b / c }; });
    let up = 0;
    P.forEach((p, i) => { if (i && p.alt - P[i - 1].alt > 0.3) up += p.alt - P[i - 1].alt; p.up = up; });
    return { P, S, total, cum };
  },
};

/** Reiseflug: Touren hintereinander, dazwischen Überflug (Kamera steigt auf und sinkt wieder). Lädt Touren und baut den gemeinsamen Pfad. */
Flug.build = async (tours, cap) => {
  const segs = [], P = [], S = [];
  let dOff = 0, upOff = 0;
  for (const t of tours) {
    const pts = (await Tours.points(t.id)).filter(p => !p.skip);
    if (pts.length < 2) continue;
    const raw = pts.map(p => [p.lat, p.lon, p.ele, p.t, p.hr]), r = Flug.path(raw, cap);
    if (P.length) {                                  // Übergang vom Ende der vorigen zum Anfang dieser Tour
      const a = P[P.length - 1], b = r.P[0], M = Math.max(12, Math.min(60, Math.round(Flug.hav([a.lat, a.lng], [b.lat, b.lng]) / 4000)));
      let dl = b.lng - a.lng; if (dl > 180) dl -= 360; if (dl < -180) dl += 360;
      for (let k = 1; k <= M; k++) {
        const f = k / (M + 1), q = { lat: a.lat + (b.lat - a.lat) * f, lng: a.lng + dl * f, alt: a.alt + (b.alt - a.alt) * f, d: a.d, hr: null, up: a.up, t: null, trans: true, tq: f, seg: segs.length };
        P.push(q); S.push({ lat: q.lat, lng: q.lng });
      }
    }
    const start = P.length;
    r.P.forEach((p, i) => { P.push(Object.assign({}, p, { d: p.d + dOff, up: p.up + upOff, seg: segs.length })); S.push(r.S[i]); });
    segs.push({ t, raw, cum: r.cum, total: r.total, start, n: r.P.length });
    dOff += r.total; upOff += r.P[r.P.length - 1].up;
  }
  return { P, S, segs, total: dOff };
};

Views['/flug'] = async (root, [id]) => {
  const SET = id.startsWith('set:');
  const tours = [];
  for (const x of (SET ? id.slice(4).split(',') : [id])) { const q = await DB.get('tours', x); if (q) tours.push(q); }
  tours.sort((a, b) => a.start - b.start);
  if (!tours.length) { root.append(topbar('3D-Flug', { back: true }), h('div', { class: 'empty' }, h('p', null, 'Diese Tour gibt es nicht mehr.'))); return; }
  const t = SET ? { name: Flug.title || 'Reiseflug', sport: tours[0].sport } : tours[0];
  const msg = h('div', { class: 'fmsg' }, 'Lädt …');
  const mapEl = h('div', { class: 'fm' });
  const hud = h('div', { class: 'fhud' });
  const ph = h('div', { class: 'fph' }), phi = h('img', { alt: '' }), phc = h('small'); ph.append(phi, phc);
  const sel = (id, title, opts, val) => h('select', { id, title, 'aria-label': title, onchange: () => apply(id) }, opts.map(([v, l]) => h('option', { value: v, selected: String(v) === String(val) }, l)));
  const pp = h('button', { class: 'btn sm', id: 'fp' }, '❚❚ Pause'), slider = h('input', { type: 'range', id: 'fs', min: 0, max: 1000, value: 0, 'aria-label': 'Position' });
  const recB = h('button', { class: 'btn sm', id: 'frec', title: 'Flug als Video aufnehmen und speichern' }, '⏺ Video');
  let style = 'osm'; try { style = Set_.get('style3d') || (Set_.get('tiles') === 'topo' ? 'topo' : 'osm'); } catch (e) { /* egal */ }
  const ctl = h('div', { class: 'fctl' }, pp, slider,
    sel('fv', 'Tempo', [[0.5, '0,5×'], [1, '1×'], [2, '2×'], [4, '4×'], [8, '8×']], 1),
    sel('fc', 'Kamera', [['follow', 'Kamera folgt'], ['free', 'Kamera frei']], 'follow'),
    sel('fz', 'Flughöhe', [[16, 'nah'], [14.8, 'mittel'], [13.4, 'weit']], 14.8),
    sel('fpi', 'Neigung', [['auto', 'automatisch'], [55, 'flach'], [68, 'schräg'], [78, 'sehr schräg']], 'auto'),
    sel('fb', 'Karte', [['osm', 'Straßenkarte'], ['topo', 'Topografisch'], ['sat', 'Satellit']], style), sel('fq', 'Videoqualität', [[1280, 'Video: Standard'], [1600, 'Video: Hoch'], [1920, 'Video: Sehr hoch']], 1600), recB);
  root.append(h('div', { class: 'flight', id: 'fl' }, mapEl, h('div', { class: 'fbar' }, h('button', { class: 'ico', 'aria-label': 'Zurück', onclick: () => Nav.back() }, '←'), h('b', { class: 'ft' }, t.name)), hud, ph, ctl, msg));
  const $v = k => root.querySelector('#' + k).value;
  if (!document.createElement('canvas').getContext('webgl') && !document.createElement('canvas').getContext('experimental-webgl')) { msg.textContent = 'Dieses Gerät unterstützt kein WebGL, die 3D-Ansicht ist nicht möglich.'; return; }
  try { await Flug.loadLib(); } catch (e) { msg.textContent = e.message; return; }

  const B = await Flug.build(tours, SET ? 500 : 900), { P, S, segs, total } = B, N = P.length, ll = p => [p.lng, p.lat];
  if (N < 2) { msg.textContent = 'Für diese Tour liegt keine Strecke vor.'; return; }
  const photos = [];                                   // vor dem Anlegen der Karte laden (style.load kommt sonst zu früh)
  for (const sg of segs) {
    const ps = (await DB.byIndex('photos', 'tour', sg.t.id)).filter(p => p.ts).sort((a, b) => a.ts - b.ts), raw = sg.raw, dur = (sg.t.end || 0) - (sg.t.start || 0);
    ps.forEach(p => {
      let i = raw[0][3] != null ? raw.findIndex(q => (q[3] || 0) >= p.ts) : -1;
      if (i < 0) i = raw[0][3] != null && p.ts < raw[raw.length - 1][3] ? 0 : raw.length - 1;
      const fr = raw[0][3] != null ? sg.cum[i] / sg.total : Math.min(1, Math.max(0, (p.ts - sg.t.start) / (dur || 1)));
      p.gi = sg.start + Math.max(0, Math.min(sg.n - 1, Math.round(fr * (sg.n - 1)))); p.u = p.gi / (N - 1); photos.push(p);
    });
  }
  photos.sort((a, b) => a.u - b.u);
  const Ttot = SET ? Math.min(240, 60 + 25 * segs.length) : 100;
  const ras = (u, max, attr) => ({ type: 'raster', tiles: [u], tileSize: 256, maxzoom: max, attribution: attr });
  const SRC = { osm: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', topo: 'https://tile.opentopomap.org/{z}/{x}/{y}.png', sat: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}' };
  const m = new maplibregl.Map({
    container: mapEl, pitch: 68, bearing: Flug.brg([P[0].lat, P[0].lng], [S[Math.min(10, N - 1)].lat, S[Math.min(10, N - 1)].lng]), center: ll(P[0]), zoom: 14.8, maxPitch: 85,
    attributionControl: { compact: true }, fadeDuration: 0,
    style: { version: 8, sources: {
      osm: ras(SRC.osm, 19, '© OpenStreetMap'), topo: ras(SRC.topo, 17, '© OpenTopoMap, © OpenStreetMap'), sat: ras(SRC.sat, 19, 'Esri, Maxar, Earthstar Geographics'),
      dem: { type: 'raster-dem', tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'], tileSize: 256, maxzoom: 15, encoding: 'terrarium', attribution: 'Höhendaten: Mapzen/AWS Terrain Tiles' } },
    layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#cfd8d3' } }, ...['osm', 'topo', 'sat'].map(k => ({ id: k, type: 'raster', source: k, layout: { visibility: k === style ? 'visible' : 'none' } }))] },
  });
  window.__flug = m;
  const dot = h('div', { class: 'fdot' });
  const mk = new maplibregl.Marker({ element: dot }).setLngLat(ll(P[0])).addTo(m);
  const line = (a, b) => {                              // Übergänge werden nicht als Linie gezeichnet
    const parts = []; let cur = [];
    P.slice(a, b).forEach(p => { if (p.trans) { if (cur.length > 1) parts.push(cur); cur = []; } else cur.push(ll(p)); });
    if (cur.length > 1) parts.push(cur);
    return { type: 'Feature', geometry: { type: 'MultiLineString', coordinates: parts.length ? parts : [[ll(P[0]), ll(P[1])]] } };
  };
  const col = MapKit.routeColor(t.sport, '#f2c230');
  let u = 0, playing = true, bear = m.getBearing(), last = 0, follow = true, lastDone = -1, pitchNow = 68, pitchAt = 0, pitchWant = 68, zBase = 14.8, ready = false, stopped = false, rec = null;
  m.once('style.load', () => {
    m.setTerrain({ source: 'dem', exaggeration: 1.5 });
    m.addSource('full', { type: 'geojson', data: line(0, N) }); m.addSource('done', { type: 'geojson', data: line(0, 2) });
    m.addLayer({ id: 'full-c', type: 'line', source: 'full', paint: { 'line-color': '#fff', 'line-width': 7, 'line-opacity': 0.55 }, layout: { 'line-cap': 'round', 'line-join': 'round' } });
    m.addLayer({ id: 'full', type: 'line', source: 'full', paint: { 'line-color': col, 'line-width': 4 }, layout: { 'line-cap': 'round', 'line-join': 'round' } });
    m.addLayer({ id: 'done', type: 'line', source: 'done', paint: { 'line-color': '#f2c230', 'line-width': 5 }, layout: { 'line-cap': 'round', 'line-join': 'round' } });
    msg.style.display = 'none'; ready = true; last = performance.now(); requestAnimationFrame(tick);
  });
  const at = (A, f, key) => { const i = Math.min(N - 2, Math.floor(f)), r = f - i; return A[i][key] + (A[i + 1][key] - A[i][key]) * r; };
  photos.forEach(p => { const k = P[p.gi]; new maplibregl.Marker({ element: h('div', { class: 'fcam', title: 'Foto' }) }).setLngLat([k.lng, k.lat]).addTo(m); });
  let phUntil = 0, prevU = 0;
  const showPh = p => { ph.style.top = (hud.offsetTop + hud.offsetHeight + 8) + 'px'; phi.src = Photos.thumb(p.id); phc.textContent = F.time(p.ts) + ' Uhr'; ph.classList.add('on'); phUntil = performance.now() + 4500; };
  const hrZ = typeof MapKit.hrMax === 'function' ? MapKit.hrMax() : 190;
  const hudText = (p, f) => {
    const sg = segs[p.seg] || segs[0], nm = SET ? (p.trans ? 'Weiterflug …' : sg.t.name) + ' · ' : '';
    return `${nm}<b>${F.km(p.d)}</b> / ${F.km(total)} · <b>${Math.round(p.alt)} m</b> · ↑ ${Math.round(p.up)} m`;
  };
  // Video-Aufnahme: Karte + Kopfzeile + Fotos auf eine Zeichenfläche, per MediaRecorder; gespeichert wird in Stücken über die App
  const compose = () => {
    if (!rec) return;
    const c = m.getCanvas(), W = rec.c.width, H = rec.c.height, x = rec.x, f = u * (N - 1), p = P[Math.min(N - 1, Math.round(f))];
    x.drawImage(c, 0, 0, W, H);
    x.fillStyle = 'rgba(14,42,43,.8)'; x.fillRect(0, 0, W, 48); x.textBaseline = 'middle'; x.font = '600 24px sans-serif'; x.fillStyle = '#fff'; x.textAlign = 'left';
    x.fillText(SET ? (p.trans ? t.name : (segs[p.seg] || segs[0]).t.name) : t.name, 16, 25);
    x.textAlign = 'right'; x.fillStyle = '#f2c230'; x.fillText(`${F.km(p.d)} · ${Math.round(p.alt)} m`, W - 16, 25);
    x.fillRect(0, H - 6, W * u, 6);
    if (performance.now() < phUntil && phi.complete && phi.naturalWidth) {
      const w = Math.min(340, W * 0.32), hh = w * phi.naturalHeight / phi.naturalWidth;
      x.fillStyle = '#fff'; x.fillRect(14, 62, w + 4, hh + 4); x.drawImage(phi, 16, 64, w, hh);
    }
  };
  m.on('render', compose);
  const saveRec = async (blob, ext) => {
    const name = ((t.name || 'flug').replace(/[^\w\-äöüÄÖÜß ]+/g, '_').trim() || 'flug') + '.' + ext, tmp = 'flug-' + Date.now() + '.' + ext, buf = new Uint8Array(await blob.arrayBuffer());
    if (!window.MTApp) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 60000); return; }
    const CH = 1 << 20;
    for (let o = 0; o < buf.length; o += CH) {
      let bin = ''; const part = buf.subarray(o, o + CH); for (let k = 0; k < part.length; k += 8192) bin += String.fromCharCode.apply(null, part.subarray(k, k + 8192));
      await Native.json('appendCache', { name: tmp, b64: btoa(bin), reset: o === 0 });
    }
    toast('Video gespeichert: ' + await Native.json('saveFile', { name, mime: blob.type || 'video/mp4', path: tmp }), 7000);
  };
  const stopRec = () => { if (!rec) return; const r = rec; rec = null; r.mr.stop(); recB.textContent = '⏺ Video'; };
  /** Vor der Aufnahme die Strecke einmal im Schnelldurchlauf abfahren, damit alle Kartenkacheln und Höhendaten schon geladen sind (keine weißen Flächen im Video). */
  const prewarm = async (zoom) => {
    const steps = Math.min(40, Math.max(12, Math.round(N / 12))), t0 = performance.now(), e0 = mapErr;
    msg.classList.add('prog');
    for (let k = 0; k <= steps && !stopped; k++) {
      if (performance.now() - t0 > 60000 || mapErr - e0 >= 4) break;     // bei schlechter oder fehlender Verbindung nicht ewig warten
      const f = k / steps * (N - 1), i = Math.min(N - 1, Math.round(f)), p = P[i], lk = S[Math.min(N - 1, i + Math.max(6, Math.round(N / 60)))];
      const tr = SET && p.trans ? Math.sin(Math.PI * p.tq) : 0;
      m.jumpTo({ center: [at(S, f, 'lng'), at(S, f, 'lat')], bearing: Flug.brg([at(S, f, 'lat'), at(S, f, 'lng')], [lk.lat, lk.lng]), pitch: 62, zoom: zoom - 4 * tr });
      msg.textContent = 'Karte wird geladen … ' + Math.round(k / steps * 100) + ' %'; msg.style.display = '';
      await new Promise(ok => { let done = false; const fin = () => { if (!done) { done = true; ok(); } }; m.once('idle', fin); setTimeout(fin, 3000); m.triggerRepaint(); });
    }
    msg.style.display = 'none'; msg.classList.remove('prog');
  };
  let preparing = false, mapErr = 0;
  recB.onclick = async () => {
    if (rec) return stopRec();
    if (preparing) return;
    const mime = window.MediaRecorder && ['video/mp4;codecs=avc1.42E01E', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find(x => MediaRecorder.isTypeSupported(x));
    if (!mime) return toast('Dieses Gerät kann keine Videos aufnehmen.');
    preparing = true; recB.disabled = true; playing = false; follow = false;
    const zRec = zBase + 0.9, want = +$v('fq'), css = mapEl.clientWidth || 400, oldPR = m.getPixelRatio ? m.getPixelRatio() : window.devicePixelRatio;
    try {
      try { m.setPixelRatio(Math.min(3.5, Math.max(1, want / css))); } catch (e) { /* alte Auflösung */ }
      await prewarm(zRec);
    } finally { preparing = false; recB.disabled = false; }
    if (stopped) return;
    const c = m.getCanvas(), W = Math.min(c.width, want), oc = document.createElement('canvas'); oc.width = W; oc.height = Math.round(W * c.height / c.width);
    const mr = new MediaRecorder(oc.captureStream(30), { mimeType: mime, videoBitsPerSecond: want >= 1920 ? 12e6 : want >= 1600 ? 9e6 : 6e6 }), chunks = [];
    mr.ondataavailable = e => e.data.size && chunks.push(e.data);
    mr.onstop = () => { try { m.setPixelRatio(oldPR); } catch (e) { /* egal */ } saveRec(new Blob(chunks, { type: mime.split(';')[0] }), mime.includes('mp4') ? 'mp4' : 'webm').catch(e => toast('Speichern fehlgeschlagen: ' + e.message, 7000)); };
    rec = { c: oc, x: oc.getContext('2d'), mr, ending: false, stall: 0 };
    u = 0; prevU = 0; playing = true; follow = true; root.querySelector('#fc').value = 'follow'; bear = m.getBearing(); last = performance.now(); pp.textContent = '❚❚ Pause';
    mr.start(500); recB.textContent = '⏹ Aufnahme beenden';
  };
  window.__flugRec = () => rec;
  const tick = now => {
    if (stopped || !mapEl.isConnected) { stopped = true; if (rec) stopRec(); try { m.remove(); } catch (e) { /* egal */ } window.__flug = null; return; }
    let dt = Math.max(0, Math.min(100, now - last)); last = now;
    if (rec && !rec.ending && !m.areTilesLoaded() && rec.stall < 1500) { rec.stall += dt; dt = 0; } else if (rec && m.areTilesLoaded()) rec.stall = 0;   // bei der Aufnahme kurz warten, bis die Kacheln da sind
    if (playing) {
      u += dt / 1000 / Ttot * +$v('fv');
      if (u >= 1) { u = 1; playing = false; pp.textContent = '↻ Nochmal'; }
      slider.value = Math.round(u * 1000);
    }
    const f = u * (N - 1), lat = at(S, f, 'lat'), lng = at(S, f, 'lng'), cur = [at(P, f, 'lng'), at(P, f, 'lat')];
    mk.setLngLat(cur);
    const i = Math.min(N - 1, Math.round(f));
    if (i !== lastDone && m.getSource('done')) { lastDone = i; m.getSource('done').setData(line(0, Math.max(2, i + 1))); }
    const lk = S[Math.min(N - 1, i + Math.max(6, Math.round(N / 60)))], tgt = Flug.brg([lat, lng], [lk.lat, lk.lng]);
    const p = P[i];
    hud.innerHTML = hudText(p, f) + (p.hr ? ` · <span style="color:${MapKit.hrColor[Tours.hrZone(p.hr, hrZ)]}">♥ ${p.hr}</span>` : '');
    if (playing) photos.forEach(q => { if (prevU < q.u && u >= q.u) showPh(q); });
    prevU = u;
    if (ph.classList.contains('on') && performance.now() > phUntil) ph.classList.remove('on');
    if (rec && u >= 1 && !rec.ending) { rec.ending = true; setTimeout(stopRec, 1800); }
    if (follow) {
      const d = (tgt - bear + 540) % 360 - 180; bear = (bear + d * Math.min(1, dt / 600) + 360) % 360;
      const o = { center: [lng, lat], bearing: bear };
      if ($v('fpi') === 'auto') {
        if (now - pitchAt > 130) {
          pitchAt = now;
          try { const pm = 512 * 2 ** m.getZoom() / (40075016.686 * Math.cos(lat * Math.PI / 180)), D = m.transform.cameraToCenterDistance / pm; pitchWant = isFinite(D) && D > 0 ? Flug.clearPitch((a, b) => m.queryTerrainElevation([a, b]), lng, lat, bear, 68, D) : 68; } catch (e) { pitchWant = 68; }
        }
        if (SET && p.trans) pitchWant = Math.min(pitchWant, 68 - 22 * Math.sin(Math.PI * p.tq));
        pitchNow += (pitchWant - pitchNow) * Math.min(1, dt / 700) * (pitchWant < pitchNow ? 1 : 0.35);
        o.pitch = pitchNow;
      }
      if (SET || rec) o.zoom = zBase + (rec ? 0.9 : 0) - (SET && p.trans ? 4 * Math.sin(Math.PI * p.tq) : 0);   // Aufnahme etwas näher; im Übergang aufsteigen (herauszoomen) und danach wieder absinken
      m.jumpTo(o);
    }
    requestAnimationFrame(tick);
  };
  pp.onclick = () => { if (u >= 1) { u = 0; playing = true; } else playing = !playing; pp.textContent = playing ? '❚❚ Pause' : '▶ Weiter'; if (playing) last = performance.now(); };
  slider.oninput = () => { u = +slider.value / 1000; };
  // Bedienelemente blenden sich beim Abspielen nach ein paar Sekunden aus; ein Tipp auf die Karte bringt sie zurück
  const fl = root.querySelector('#fl'); let hideT = null;
  const wake = () => {
    fl.classList.remove('idle'); clearTimeout(hideT);
    hideT = setTimeout(function again() { if (stopped || !fl.isConnected) return; if (playing) fl.classList.add('idle'); else hideT = setTimeout(again, 2000); }, 4000);
  };
  ['pointerdown', 'pointermove', 'wheel', 'keydown'].forEach(ev => fl.addEventListener(ev, wake, { passive: true, capture: true }));
  wake();
  function apply(k) {
    if (k === 'fc') { follow = $v('fc') === 'follow'; if (follow) bear = m.getBearing(); }
    else if (k === 'fz') { zBase = +$v('fz'); m.setZoom(zBase); }
    else if (k === 'fpi') { if ($v('fpi') === 'auto') pitchNow = m.getPitch(); else m.setPitch(+$v('fpi')); }
    else if (k === 'fb') { ['osm', 'topo', 'sat'].forEach(x => m.setLayoutProperty(x, 'visibility', x === $v('fb') ? 'visible' : 'none')); Set_.set('style3d', $v('fb')); }
  }
  try { m.touchZoomRotate.enable(); m.touchZoomRotate.enableRotation(); m.touchPitch.enable(); m.dragRotate.enable(); } catch (e) { /* egal */ }
  ['dragstart', 'rotatestart', 'pitchstart', 'zoomstart'].forEach(n => m.on(n, ev => { if (follow && ev && ev.originalEvent) { follow = false; root.querySelector('#fc').value = 'free'; } }));
  m.on('error', e => {
    mapErr++;
    console.warn('3D:', e && e.error && e.error.message);
    if (e && e.error && /terrain|dem/i.test(String(e.error.message))) { msg.textContent = 'Höhendaten nicht erreichbar – Gelände wird flach dargestellt'; msg.style.display = ''; }
  });
};
