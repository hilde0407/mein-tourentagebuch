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

Views['/flug'] = async (root, [id]) => {
  const t = await DB.get('tours', id);
  if (!t) { root.append(topbar('3D-Flug', { back: true }), h('div', { class: 'empty' }, h('p', null, 'Diese Tour gibt es nicht mehr.'))); return; }
  const pts = (await Tours.points(id)).filter(p => !p.skip);
  const msg = h('div', { class: 'fmsg' }, 'Lädt …');
  const mapEl = h('div', { class: 'fm' });
  const hud = h('div', { class: 'fhud' });
  const ph = h('div', { class: 'fph' }), phi = h('img', { alt: '' }), phc = h('small'); ph.append(phi, phc);
  const sel = (id, title, opts, val) => h('select', { id, title, 'aria-label': title, onchange: () => apply(id) }, opts.map(([v, l]) => h('option', { value: v, selected: String(v) === String(val) }, l)));
  const pp = h('button', { class: 'btn sm', id: 'fp' }, '❚❚ Pause'), slider = h('input', { type: 'range', id: 'fs', min: 0, max: 1000, value: 0, 'aria-label': 'Position' });
  let style = 'osm'; try { style = Set_.get('style3d') || (Set_.get('tiles') === 'topo' ? 'topo' : 'osm'); } catch (e) { /* egal */ }
  const ctl = h('div', { class: 'fctl' }, pp, slider,
    sel('fv', 'Tempo', [[0.5, '0,5×'], [1, '1×'], [2, '2×'], [4, '4×'], [8, '8×']], 1),
    sel('fc', 'Kamera', [['follow', 'Kamera folgt'], ['free', 'Kamera frei']], 'follow'),
    sel('fz', 'Flughöhe', [[16, 'nah'], [14.8, 'mittel'], [13.4, 'weit']], 14.8),
    sel('fpi', 'Neigung', [['auto', 'automatisch'], [55, 'flach'], [68, 'schräg'], [78, 'sehr schräg']], 'auto'),
    sel('fb', 'Karte', [['osm', 'Straßenkarte'], ['topo', 'Topografisch'], ['sat', 'Satellit']], style));
  root.append(h('div', { class: 'flight', id: 'fl' }, mapEl, h('div', { class: 'fbar' }, h('button', { class: 'ico', 'aria-label': 'Zurück', onclick: () => Nav.back() }, '←'), h('b', { class: 'ft' }, t.name)), hud, ph, ctl, msg));
  const $v = k => root.querySelector('#' + k).value;
  if (pts.length < 2) { msg.textContent = 'Für diese Tour liegt keine Strecke vor.'; return; }
  if (!document.createElement('canvas').getContext('webgl') && !document.createElement('canvas').getContext('experimental-webgl')) { msg.textContent = 'Dieses Gerät unterstützt kein WebGL, die 3D-Ansicht ist nicht möglich.'; return; }
  try { await Flug.loadLib(); } catch (e) { msg.textContent = e.message; return; }

  const photos = (await DB.byIndex('photos', 'tour', id)).filter(p => p.ts).sort((a, b) => a.ts - b.ts);   // vor dem Anlegen der Karte laden (style.load kommt sonst zu früh)
  const raw = pts.map(p => [p.lat, p.lon, p.ele, p.t, p.hr]);
  const { P, S, total, cum } = Flug.path(raw), N = P.length, ll = p => [p.lng, p.lat];
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
  const line = (a, b) => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: P.slice(a, b).map(ll) } });
  const col = MapKit.routeColor(t.sport, '#f2c230');
  let u = 0, playing = true, bear = m.getBearing(), last = 0, follow = true, lastDone = -1, pitchNow = 68, pitchAt = 0, pitchWant = 68, zBase = 14.8, ready = false, stopped = false;
  m.once('style.load', () => {
    m.setTerrain({ source: 'dem', exaggeration: 1.5 });
    m.addSource('full', { type: 'geojson', data: line(0, N) }); m.addSource('done', { type: 'geojson', data: line(0, 2) });
    m.addLayer({ id: 'full-c', type: 'line', source: 'full', paint: { 'line-color': '#fff', 'line-width': 7, 'line-opacity': 0.55 }, layout: { 'line-cap': 'round', 'line-join': 'round' } });
    m.addLayer({ id: 'full', type: 'line', source: 'full', paint: { 'line-color': col, 'line-width': 4 }, layout: { 'line-cap': 'round', 'line-join': 'round' } });
    m.addLayer({ id: 'done', type: 'line', source: 'done', paint: { 'line-color': '#f2c230', 'line-width': 5 }, layout: { 'line-cap': 'round', 'line-join': 'round' } });
    msg.style.display = 'none'; ready = true; last = performance.now(); requestAnimationFrame(tick);
  });
  const at = (A, f, key) => { const i = Math.min(N - 2, Math.floor(f)), r = f - i; return A[i][key] + (A[i + 1][key] - A[i][key]) * r; };
  // Fotos entlang der Strecke
  const dur = (t.end || 0) - (t.start || 0);
  photos.forEach(p => {
    const rel = p.ts - raw[0][3];
    let i = raw[0][3] != null ? raw.findIndex(q => (q[3] || 0) >= p.ts) : -1;
    if (i < 0) i = raw[0][3] != null && p.ts < raw[raw.length - 1][3] ? 0 : raw.length - 1;
    p.u = raw[0][3] != null ? cum[i] / total : Math.min(1, Math.max(0, (p.ts - t.start) / (dur || 1)));
    const k = P[Math.max(0, Math.min(N - 1, Math.round(p.u * (N - 1))))];
    new maplibregl.Marker({ element: h('div', { class: 'fcam', title: 'Foto' }) }).setLngLat([k.lng, k.lat]).addTo(m);
  });
  let phUntil = 0, prevU = 0;
  const showPh = p => { phi.src = Photos.thumb(p.id); phc.textContent = F.time(p.ts) + ' Uhr'; ph.classList.add('on'); phUntil = performance.now() + 4500; };
  const hrZ = typeof MapKit.hrMax === 'function' ? MapKit.hrMax() : 190;
  const tick = now => {
    if (stopped || !mapEl.isConnected) { stopped = true; try { m.remove(); } catch (e) { /* egal */ } window.__flug = null; return; }
    const dt = Math.max(0, Math.min(100, now - last)); last = now;
    if (playing) {
      u += dt / 1000 / 100 * +$v('fv');
      if (u >= 1) { u = 1; playing = false; pp.textContent = '↻ Nochmal'; }
      slider.value = Math.round(u * 1000);
    }
    const f = u * (N - 1), lat = at(S, f, 'lat'), lng = at(S, f, 'lng'), cur = [at(P, f, 'lng'), at(P, f, 'lat')];
    mk.setLngLat(cur);
    const i = Math.min(N - 1, Math.round(f));
    if (i !== lastDone && m.getSource('done')) { lastDone = i; m.getSource('done').setData(line(0, Math.max(2, i + 1))); }
    const lk = S[Math.min(N - 1, i + Math.max(6, Math.round(N / 60)))], tgt = Flug.brg([lat, lng], [lk.lat, lk.lng]);
    const p = P[i];
    hud.innerHTML = `<b>${F.km(p.d)}</b> / ${F.km(total)} · <b>${Math.round(p.alt)} m</b> · ↑ ${Math.round(p.up)} m` + (p.hr ? ` · <span style="color:${MapKit.hrColor[Tours.hrZone(p.hr, hrZ)]}">♥ ${p.hr}</span>` : '');
    if (playing) photos.forEach(q => { if (prevU < q.u && u >= q.u) showPh(q); });
    prevU = u;
    if (ph.classList.contains('on') && performance.now() > phUntil) ph.classList.remove('on');
    if (follow) {
      const d = (tgt - bear + 540) % 360 - 180; bear = (bear + d * Math.min(1, dt / 600) + 360) % 360;
      const o = { center: [lng, lat], bearing: bear };
      if ($v('fpi') === 'auto') {
        if (now - pitchAt > 130) {
          pitchAt = now;
          try { const pm = 512 * 2 ** m.getZoom() / (40075016.686 * Math.cos(lat * Math.PI / 180)), D = m.transform.cameraToCenterDistance / pm; pitchWant = isFinite(D) && D > 0 ? Flug.clearPitch((a, b) => m.queryTerrainElevation([a, b]), lng, lat, bear, 68, D) : 68; } catch (e) { pitchWant = 68; }
        }
        pitchNow += (pitchWant - pitchNow) * Math.min(1, dt / 700) * (pitchWant < pitchNow ? 1 : 0.35);
        o.pitch = pitchNow;
      }
      m.jumpTo(o);
    }
    requestAnimationFrame(tick);
  };
  pp.onclick = () => { if (u >= 1) { u = 0; playing = true; } else playing = !playing; pp.textContent = playing ? '❚❚ Pause' : '▶ Weiter'; if (playing) last = performance.now(); };
  slider.oninput = () => { u = +slider.value / 1000; };
  function apply(k) {
    if (k === 'fc') { follow = $v('fc') === 'follow'; if (follow) bear = m.getBearing(); }
    else if (k === 'fz') { zBase = +$v('fz'); m.setZoom(zBase); }
    else if (k === 'fpi') { if ($v('fpi') === 'auto') pitchNow = m.getPitch(); else m.setPitch(+$v('fpi')); }
    else if (k === 'fb') { ['osm', 'topo', 'sat'].forEach(x => m.setLayoutProperty(x, 'visibility', x === $v('fb') ? 'visible' : 'none')); Set_.set('style3d', $v('fb')); }
  }
  try { m.touchZoomRotate.enable(); m.touchZoomRotate.enableRotation(); m.touchPitch.enable(); m.dragRotate.enable(); } catch (e) { /* egal */ }
  ['dragstart', 'rotatestart', 'pitchstart', 'zoomstart'].forEach(n => m.on(n, ev => { if (follow && ev && ev.originalEvent) { follow = false; root.querySelector('#fc').value = 'free'; } }));
  m.on('error', e => {
    console.warn('3D:', e && e.error && e.error.message);
    if (e && e.error && /terrain|dem/i.test(String(e.error.message))) { msg.textContent = 'Höhendaten nicht erreichbar – Gelände wird flach dargestellt'; msg.style.display = ''; }
  });
};
