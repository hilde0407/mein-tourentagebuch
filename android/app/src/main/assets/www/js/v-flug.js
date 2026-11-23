'use strict';
/* 3D-Flug: die Tour als Kameraflug über das Gelände (MapLibre GL mit Höhendaten). Kamera folgt der Strecke, weicht Bergen aus,
   Tempo/Neigung/Karte wählbar, Fotos tauchen beim Vorbeifliegen auf.
   2.16.0: Darstellungsstufen (Flüssig/Normal/Schön, js/calc-flug.js), Kamera als reine Funktion der Flugposition (FlugCalc.kamera),
   gedrosselte Kopfzeile und Linie, Fotos als Kartenebene statt HTML-Marker, Anpassung bei langsamen Bildern, Flug.aktiv.stelleZeit(t).
   2.17.0: „Video erzeugen“ Bild für Bild (js/v-flugvideo.js, Schnittstelle Flug.aktiv.video()); die Echtzeit-Aufnahme heißt jetzt „Schnellaufnahme“.
   Einblendungen (Titel, Datum, Kennzahlen, Höhenprofil, Foto, Kartenquelle) zeichnet Flug.zeichne für beide Wege. */
const Flug = {
  loadLib: () => window.maplibregl ? Promise.resolve() : new Promise((ok, no) => {
    const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = 'vendor/maplibre-gl.css'; document.head.appendChild(l);
    const s = document.createElement('script'); s.src = 'vendor/maplibre-gl.js'; s.onload = ok; s.onerror = () => no(new Error('3D-Bibliothek konnte nicht geladen werden')); document.head.appendChild(s);
  }),
  /** Handy? (App-Hülle oder Fingerbedienung) – dann ist „Flüssig“ die Vorgabe. */
  handy: () => !!window.MTApp || !!(window.matchMedia && matchMedia('(pointer: coarse)').matches),
  hav: (a, b) => Geo.dist(a[0], a[1], b[0], b[1]),
  brg(a, b) {
    const r = Math.PI / 180, y = Math.sin((b[1] - a[1]) * r) * Math.cos(b[0] * r), x = Math.cos(a[0] * r) * Math.sin(b[0] * r) - Math.sin(a[0] * r) * Math.cos(b[0] * r) * Math.cos((b[1] - a[1]) * r);
    return (Math.atan2(y, x) / r + 360) % 360;
  },
  /** Berge im Weg: steilster Neigungswinkel (≤ base), bei dem die Sicht von der Kamera zum Streckenpunkt frei ist (Rechnung in js/calc-flug.js). */
  clearPitch: (elev, lng, lat, bearing, base, D, floor = 28) => FlugCalc.freieNeigung(elev, lng, lat, bearing, base, D, floor).th,
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
  /** Einblendungen auf eine Zeichenfläche (Schnellaufnahme und Video-Export). Maße wachsen mit der kurzen Seite (720 px = 1).
   *  d = { an: { titel, datum, kennzahlen, profil, fotos }, titel, datum, kennzahl, kennzahl2, u (0…1), ud (Strecke 0…1), profil: [[x 0…1, y 0…1]], foto (Bild), quelle }.
   *  Die Kartenquelle steht immer da. */
  zeichne(x, W, H, d) {
    const s = Math.min(W, H) / 720, o = d.an || {}, px = v => Math.round(v * s);
    const kurz = (t, max) => { t = String(t || ''); if (x.measureText(t).width <= max) return t; while (t.length > 1 && x.measureText(t + '…').width > max) t = t.slice(0, -1); return t + '…'; };
    x.save(); x.textBaseline = 'middle';
    let oben = 0;
    if (o.titel || o.datum || o.kennzahlen) {
      const zwei = (o.titel && o.datum) || (o.kennzahlen && d.kennzahl2);
      oben = px(zwei ? 74 : 50);
      x.fillStyle = 'rgba(14,42,43,.8)'; x.fillRect(0, 0, W, oben);
      x.textAlign = 'right';
      let rechts = 0;
      if (o.kennzahlen && d.kennzahl) {
        x.font = '600 ' + px(24) + 'px sans-serif'; x.fillStyle = '#f2c230'; x.fillText(d.kennzahl, W - px(16), px(26)); rechts = x.measureText(d.kennzahl).width;
        if (d.kennzahl2) { x.font = '500 ' + px(18) + 'px sans-serif'; x.fillStyle = '#e8f0ee'; x.fillText(d.kennzahl2, W - px(16), px(55)); }
      }
      x.textAlign = 'left';
      const platz = W - px(48) - rechts;
      if (o.titel) { x.font = '600 ' + px(26) + 'px sans-serif'; x.fillStyle = '#fff'; x.fillText(kurz(d.titel, platz), px(16), px(26)); }
      if (o.datum && d.datum) { x.font = px(18) + 'px sans-serif'; x.fillStyle = '#cfe3e0'; x.fillText(kurz(d.datum, platz), px(16), px(o.titel ? 55 : 26)); }
    }
    if (o.fotos && d.foto && d.foto.complete && d.foto.naturalWidth) {
      const w = Math.min(px(340), W * 0.32), hh = w * d.foto.naturalHeight / d.foto.naturalWidth;
      x.fillStyle = '#fff'; x.fillRect(px(14), oben + px(14), w + px(4), hh + px(4)); x.drawImage(d.foto, px(16), oben + px(16), w, hh);
    }
    let unten = H;
    if (o.profil && d.profil && d.profil.length > 1) {
      const ph = px(86), y0 = H - ph, pad = px(16), pw = W - 2 * pad, t0 = y0 + px(12), hg = ph - px(24);
      x.fillStyle = 'rgba(14,42,43,.72)'; x.fillRect(0, y0, W, ph);
      x.beginPath(); d.profil.forEach(([fx, fy], i) => { const X = pad + fx * pw, Y = t0 + (1 - fy) * hg; if (i) x.lineTo(X, Y); else x.moveTo(X, Y); });
      x.strokeStyle = '#ffffff'; x.lineWidth = Math.max(1, px(2)); x.lineJoin = 'round'; x.stroke();
      x.lineTo(pad + d.profil[d.profil.length - 1][0] * pw, t0 + hg); x.lineTo(pad + d.profil[0][0] * pw, t0 + hg); x.closePath();
      x.fillStyle = 'rgba(255,255,255,.18)'; x.fill();
      const mx = pad + Math.max(0, Math.min(1, d.ud == null ? d.u : d.ud)) * pw;
      x.fillStyle = '#f2c230'; x.fillRect(mx - Math.max(1, px(1.5)), t0 - px(4), Math.max(2, px(3)), hg + px(8));
      unten = y0;
    } else {
      x.fillStyle = '#f2c230'; x.fillRect(0, H - px(6), W * Math.max(0, Math.min(1, d.u || 0)), px(6));
      unten = H - px(6);
    }
    if (d.quelle) {
      x.font = px(14) + 'px sans-serif'; x.textAlign = 'right';
      const tw = x.measureText(d.quelle).width, bh = px(22);
      x.fillStyle = 'rgba(0,0,0,.5)'; x.fillRect(W - tw - px(16), unten - bh - px(4), tw + px(12), bh);
      x.fillStyle = '#fff'; x.fillText(d.quelle, W - px(10), unten - px(4) - bh / 2);
    }
    x.restore();
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
  if (!tours.length) { root.append(topbar('3D-Flug', { back: true }), UI.empty({ title: 'Diese Tour gibt es nicht mehr' })); return; }
  const t = SET ? { name: Flug.title || 'Reiseflug', sport: tours[0].sport } : tours[0];
  const handy = Flug.handy();
  let st = FlugCalc.stufe(Set_.get('flugStufe'), handy), S_ = FlugCalc.STUFEN[st];      // 2.16.0: Darstellungsstufe (Einstellungen → Karte, oder hier im Flug)
  const msg = h('div', { class: 'fmsg' }, 'Lädt …');
  const mapEl = h('div', { class: 'fm' });
  const hud = h('div', { class: 'fhud' });
  const ph = h('div', { class: 'fph' }), phi = h('img', { alt: '' }), phc = h('small'); ph.append(phi, phc);
  const sel = (id, title, opts, val) => h('select', { id, title, 'aria-label': title, onchange: () => apply(id) }, opts.map(([v, l]) => h('option', { value: v, selected: String(v) === String(val) }, l)));
  const pp = h('button', { class: 'btn sm', id: 'fp' }, '❚❚ Pause'), slider = h('input', { type: 'range', id: 'fs', min: 0, max: 1000, value: 0, 'aria-label': 'Position' });
  const recB = h('button', { class: 'btn sm', id: 'frec', title: 'Schnellaufnahme: den Flug so aufnehmen, wie er gerade läuft (Echtzeit, kann ruckeln)' }, '⏺ Schnellaufnahme');
  const vidB = h('button', { class: 'btn sm', id: 'fvid', title: 'Video erzeugen: Bild für Bild, ruckelfrei und in hoher Auflösung' }, '🎬 Video erzeugen');
  let style = 'osm'; try { style = Set_.get('style3d') || (Set_.get('tiles') === 'topo' ? 'topo' : 'osm'); } catch (e) { /* egal */ }
  const ctl = h('div', { class: 'fctl' }, pp, slider,
    sel('fv', 'Tempo', [[0.5, '0,5×'], [1, '1×'], [2, '2×'], [4, '4×'], [8, '8×']], 1),
    sel('fc', 'Kamera', [['follow', 'Kamera folgt'], ['free', 'Kamera frei']], 'follow'),
    sel('fz', 'Flughöhe', [[16, 'nah'], [14.8, 'mittel'], [13.4, 'weit']], 14.8),
    sel('fpi', 'Neigung', [['auto', 'automatisch'], [55, 'flach'], [68, 'schräg'], [78, 'sehr schräg']], 'auto'),
    sel('fb', 'Karte', [['osm', 'Straßenkarte'], ['topo', 'Topografisch'], ['sat', 'Satellit']], style),
    sel('fst', 'Darstellung', FlugCalc.WAHL.map(([v, l]) => [v, 'Darstellung: ' + l.replace(/ \(.*\)$/, '')]), st),
    vidB, sel('fq', 'Qualität der Schnellaufnahme', [[1280, 'Schnell: Standard'], [1600, 'Schnell: Hoch'], [1920, 'Schnell: Sehr hoch']], 1600), recB);
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
  // Kamera-Bahn: Blickrichtung je Punkt einmal vorab (statt Glättung je Bild), Neigung aus einer Tabelle, die sich beim Fliegen füllt
  const look = Math.max(6, Math.round(N / 60)), bahn = { S, P, brg: FlugCalc.peilungen(S, look, Math.max(3, Math.round(N / 100))), neig: null };
  const neuTabelle = () => { bahn.neig = FlugCalc.neigTabelle(N, Math.max(1, Math.round(N / 120))); };
  neuTabelle();
  // Linie ausdünnen (je zusammenhängendem Stück ohne Überflug); behalten werden Indizes in P
  const keep = [];
  for (let a = 0; a < N;) {
    while (a < N && P[a].trans) a++;
    let b = a; while (b < N && !P[b].trans) b++;
    if (b - a >= 2) FlugCalc.duenneIdx(P.slice(a, b).map(ll), S_.tol).forEach(k => keep.push(a + k));
    a = b;
  }
  const line = upto => {                                // Linie bis Punkt upto (einschließlich, mit genauem Endpunkt); Übergänge werden nicht gezeichnet
    const parts = []; let cur = [], prev = -2;
    for (let j = 0; j < keep.length && keep[j] <= upto; j++) { const k = keep[j]; if (k !== prev + 1 && P.slice(prev + 1, k).some(p => p.trans)) { if (cur.length > 1) parts.push(cur); cur = []; } cur.push(ll(P[k])); prev = k; }
    if (upto < N && !P[upto].trans && prev !== upto && prev >= 0) cur.push(ll(P[upto]));
    if (cur.length > 1) parts.push(cur);
    return { type: 'Feature', geometry: { type: 'MultiLineString', coordinates: parts.length ? parts : [[ll(P[0]), ll(P[1])]] } };
  };
  const ras = (u, max, attr) => ({ type: 'raster', tiles: [u], tileSize: 256, maxzoom: max, attribution: attr });
  const SRC = { osm: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', topo: 'https://tile.opentopomap.org/{z}/{x}/{y}.png', sat: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}' };
  const DEM = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png', demSrc = mz => ({ type: 'raster-dem', tiles: [DEM], tileSize: 256, maxzoom: mz, encoding: 'terrarium', attribution: 'Höhendaten: Mapzen/AWS Terrain Tiles' });
  const dpr = () => window.devicePixelRatio || 1;
  const cam0 = FlugCalc.kamera(0, bahn, { neigung: 'auto', basis: S_.neig, zBase: 14.8, set: SET, rec: false });
  const m = new maplibregl.Map({
    container: mapEl, pitch: S_.neig, bearing: cam0.bearing, center: cam0.center, zoom: 14.8, maxPitch: 85,
    attributionControl: { compact: true }, fadeDuration: 0, antialias: false, refreshExpiredTiles: false, maxTileCacheSize: 400,
    pixelRatio: FlugCalc.pixelRatio(st, dpr()),
    style: { version: 8, sources: {
      osm: ras(SRC.osm, 19, '© OpenStreetMap'), topo: ras(SRC.topo, 17, '© OpenTopoMap, © OpenStreetMap'), sat: ras(SRC.sat, 19, 'Esri, Maxar, Earthstar Geographics'), dem: demSrc(S_.dem) },
    layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#cfd8d3' } }, ...['osm', 'topo', 'sat'].map(k => ({ id: k, type: 'raster', source: k, layout: { visibility: k === style ? 'visible' : 'none' } }))] },
  });
  window.__flug = m;
  const dot = h('div', { class: 'fdot' });
  const mk = new maplibregl.Marker({ element: dot }).setLngLat(ll(P[0]));
  // MapLibre prüft bei Gelände für jeden HTML-Marker alle 100 ms per gl.readPixels, ob er verdeckt ist – das hält die Grafik jedes Mal an.
  // Der Punkt liegt immer vor der Kamera, die Prüfung bringt nichts: abschalten (Fotos sind ab 2.16.0 eine Kartenebene, keine Marker).
  if (typeof mk._updateOpacity === 'function') mk._updateOpacity = () => { dot.style.opacity = '1'; };
  mk.addTo(m);
  const col = MapKit.routeColor(t.sport, '#f2c230');
  let demMz = S_.dem, exp = null;      // 2.17.0: exp = laufender Video-Export (tick zeichnet nicht, Neigungstabelle steht fest)
  const demNeu = mz => {      // Höhenkacheln mit anderer höchster Zoomstufe (Video-Export in „Schön“)
    if (mz === demMz) return;
    try { m.setTerrain(null); m.removeSource('dem'); m.addSource('dem', demSrc(mz)); m.setTerrain({ source: 'dem', exaggeration: S_.ueber }); demMz = mz; } catch (e) { console.warn('3D: Höhendaten', e && e.message); }
  };
  let u = 0, playing = false, last = 0, lastDraw = 0, follow = true, lastDone = -1, zBase = 14.8, stopped = false, rec = null, speed = 1, pitchMode = 'auto', blend = null;
  let hudAt = null, hudTxt = '', spurAt = null, neigAt = 0, ad = FlugCalc.adaptiv(st);
  const zahl = { bilder: 0, hud: 0, spur: 0, neig: 0, start: 0 };
  const schatten = () => {
    if (!S_.schatten || m.getLayer('schatten')) { if (m.getLayer('schatten')) m.setLayoutProperty('schatten', 'visibility', S_.schatten ? 'visible' : 'none'); return; }
    if (!m.getSource('demh')) m.addSource('demh', demSrc(Math.min(S_.dem, 13)));
    m.addLayer({ id: 'schatten', type: 'hillshade', source: 'demh', paint: { 'hillshade-exaggeration': 0.35, 'hillshade-shadow-color': '#28403c' } }, 'full-c');
  };
  m.once('style.load', async () => {
    m.setTerrain({ source: 'dem', exaggeration: S_.ueber });
    m.addSource('full', { type: 'geojson', data: line(N - 1) }); m.addSource('done', { type: 'geojson', data: line(1) });
    m.addSource('fotos', { type: 'geojson', data: { type: 'FeatureCollection', features: photos.map(p => ({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: ll(P[p.gi]) } })) } });
    m.addLayer({ id: 'full-c', type: 'line', source: 'full', paint: { 'line-color': '#fff', 'line-width': 7, 'line-opacity': 0.55 }, layout: { 'line-cap': 'round', 'line-join': 'round' } });
    m.addLayer({ id: 'full', type: 'line', source: 'full', paint: { 'line-color': col, 'line-width': 4 }, layout: { 'line-cap': 'round', 'line-join': 'round' } });
    m.addLayer({ id: 'done', type: 'line', source: 'done', paint: { 'line-color': '#f2c230', 'line-width': 5 }, layout: { 'line-cap': 'round', 'line-join': 'round' } });
    m.addLayer({ id: 'fotos', type: 'circle', source: 'fotos', paint: { 'circle-radius': 6, 'circle-color': '#fff', 'circle-stroke-color': '#1e88e5', 'circle-stroke-width': 3 } });
    // 2.17.0: Positionspunkt als Kartenebene – der HTML-Punkt landet nicht im Videobild; sichtbar nur bei Aufnahme und Export
    m.addSource('pos', { type: 'geojson', data: { type: 'Point', coordinates: ll(P[0]) } });
    m.addLayer({ id: 'pos', type: 'circle', source: 'pos', layout: { visibility: 'none' }, paint: { 'circle-radius': 8, 'circle-color': '#f2c230', 'circle-stroke-color': '#fff', 'circle-stroke-width': 3, 'circle-pitch-alignment': 'viewport' } });
    schatten();
    // Vorlauf: erst die Kacheln am Startpunkt laden (höchstens 4 s), dann losfliegen – sonst ruckeln die ersten Sekunden beim Nachladen
    msg.textContent = 'Karte wird geladen …';
    await new Promise(ok => { let done = false; const fin = () => { if (!done) { done = true; ok(); } }; m.once('idle', fin); setTimeout(fin, 4000); m.triggerRepaint(); });
    if (stopped || !mapEl.isConnected) return;
    msg.style.display = 'none'; playing = true; last = lastDraw = performance.now(); zahl.start = last; draw(last, true); requestAnimationFrame(tick);
  });
  let phUntil = 0, prevU = 0;
  const showPh = p => { ph.style.top = (hud.offsetTop + hud.offsetHeight + 8) + 'px'; phi.src = Photos.thumb(p.id); phc.textContent = F.time(p.ts) + ' Uhr'; ph.classList.add('on'); phUntil = performance.now() + 4500; };
  const hrZ = typeof MapKit.hrMax === 'function' ? MapKit.hrMax() : 190;
  const hudText = p => {
    const sg = segs[p.seg] || segs[0], nm = SET ? (p.trans ? 'Weiterflug …' : sg.t.name) + ' · ' : '';
    return `${nm}<b>${F.km(p.d)}</b> / ${F.km(total)} · <b>${Math.round(p.alt)} m</b> · ↑ ${Math.round(p.up)} m` + (p.hr ? ` · <span style="color:${MapKit.hrColor[Tours.hrZone(p.hr, hrZ)]}">♥ ${p.hr}</span>` : '');
  };
  // Video-Aufnahme: Karte + Kopfzeile + Fotos auf eine Zeichenfläche, per MediaRecorder; gespeichert wird in Stücken über die App
  const pAt = uu => P[Math.min(N - 1, Math.round(uu * (N - 1)))];
  const titelAt = p => SET ? (p.trans ? t.name : (segs[p.seg] || segs[0]).t.name) : t.name;
  const compose = () => {
    if (!rec) return;
    const p = pAt(u);
    rec.x.drawImage(m.getCanvas(), 0, 0, rec.c.width, rec.c.height);
    Flug.zeichne(rec.x, rec.c.width, rec.c.height, { an: { titel: true, kennzahlen: true, fotos: true }, titel: titelAt(p), kennzahl: `${F.km(p.d)} · ${Math.round(p.alt)} m`,
      u, foto: performance.now() < phUntil ? phi : null, quelle: FlugCalc.video.quelle($v('fb')) });
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
  const stopRec = () => { if (!rec) return; const r = rec; rec = null; r.mr.stop(); recB.textContent = '⏺ Schnellaufnahme'; try { m.setLayoutProperty('pos', 'visibility', 'none'); } catch (e) { /* egal */ } };
  /** Vor der Aufnahme die Strecke einmal im Schnelldurchlauf abfahren, damit alle Kartenkacheln und Höhendaten schon geladen sind (keine weißen Flächen im Video). */
  const prewarm = async (zoom, melde, halt) => {
    const steps = Math.min(40, Math.max(12, Math.round(N / 12))), t0 = performance.now(), e0 = mapErr;
    if (!melde) msg.classList.add('prog');
    for (let k = 0; k <= steps && !stopped; k++) {
      if (performance.now() - t0 > 60000 || mapErr - e0 >= 4 || (halt && halt())) break;     // bei schlechter oder fehlender Verbindung nicht ewig warten
      const c = FlugCalc.kamera(k / steps, bahn, { neigung: exp ? pitchMode : 'fest', basis: S_.neig, zBase: zoom, set: SET, rec: false });
      m.jumpTo({ center: c.center, bearing: c.bearing, pitch: exp && c.pitch != null ? c.pitch : 62, zoom: c.zoom != null ? c.zoom : zoom });
      if (melde) melde(k / steps); else { msg.textContent = 'Karte wird geladen … ' + Math.round(k / steps * 100) + ' %'; msg.style.display = ''; }
      await new Promise(ok => { let done = false; const fin = () => { if (!done) { done = true; ok(); } }; m.once('idle', fin); setTimeout(fin, 3000); m.triggerRepaint(); });
    }
    if (!melde) { msg.style.display = 'none'; msg.classList.remove('prog'); }
  };
  let preparing = false, mapErr = 0;
  recB.onclick = async () => {
    if (rec) return stopRec();
    if (preparing || exp) return;
    const mime = window.MediaRecorder && ['video/mp4;codecs=avc1.42E01E', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find(x => MediaRecorder.isTypeSupported(x));
    if (!mime) return toast('Dieses Gerät kann keine Videos aufnehmen.');
    preparing = true; recB.disabled = true; playing = false; follow = false;
    const zRec = zBase + 0.9, want = +$v('fq'), css = mapEl.clientWidth || 400;
    try {
      try { m.setPixelRatio(Math.min(3.5, Math.max(1, want / css))); } catch (e) { /* alte Auflösung */ }
      await prewarm(zRec);
    } finally { preparing = false; recB.disabled = false; }
    if (stopped) return;
    const c = m.getCanvas(), W = Math.min(c.width, want), oc = document.createElement('canvas'); oc.width = W; oc.height = Math.round(W * c.height / c.width);
    const mr = new MediaRecorder(oc.captureStream(30), { mimeType: mime, videoBitsPerSecond: want >= 1920 ? 12e6 : want >= 1600 ? 9e6 : 6e6 }), chunks = [];
    mr.ondataavailable = e => e.data.size && chunks.push(e.data);
    mr.onstop = () => { try { m.setPixelRatio(FlugCalc.pixelRatio(st, dpr())); } catch (e) { /* egal */ } saveRec(new Blob(chunks, { type: mime.split(';')[0] }), mime.includes('mp4') ? 'mp4' : 'webm').catch(e => toast('Speichern fehlgeschlagen: ' + e.message, 7000)); };
    rec = { c: oc, x: oc.getContext('2d'), mr, ending: false, stall: 0 };
    u = 0; prevU = 0; playing = true; follow = true; blend = null; root.querySelector('#fc').value = 'follow'; last = performance.now(); pp.textContent = '❚❚ Pause';
    try { m.setLayoutProperty('pos', 'visibility', 'visible'); } catch (e) { /* egal */ }
    mr.start(500); recB.textContent = '⏹ Aufnahme beenden';
  };
  window.__flugRec = () => rec;
  /** Neigungstabelle ein Stück vor der Kamera füllen (eine Stützstelle je Aufruf; jede wird nur einmal gerechnet, sobald Höhendaten da sind). */
  const fuelleNeig = (f, alle) => {
    const T = bahn.neig, k0 = Math.floor(f / T.schritt), k1 = alle ? T.w.length - 1 : Math.min(T.w.length - 1, k0 + 6);
    for (let k = k0; k <= k1; k++) {
      if (T.w[k] != null) continue;
      const i = Math.min(N - 1, k * T.schritt), s = S[i];
      try {
        const z = SET || rec || exp ? zBase : m.getZoom(), pm = 512 * 2 ** z / (40075016.686 * Math.cos(s.lat * Math.PI / 180)), D = m.transform.cameraToCenterDistance / pm;
        if (!(isFinite(D) && D > 0)) return;
        const r = FlugCalc.freieNeigung((a, b) => m.queryTerrainElevation([a, b]), s.lng, s.lat, bahn.brg[i], S_.neig, D);
        zahl.neig++;
        if (r.voll) T.w[k] = r.th;
      } catch (e) { return; }
      if (!alle) return;
    }
  };
  /** Ein Bild: Kamera, Punkt, Linie, Kopfzeile. force = sofort alles (stelleZeit, Start). */
  const draw = (now, force) => {
    const f = u * (N - 1), i = Math.min(N - 1, Math.round(f)), p = P[i];
    const a = Math.min(N - 2, Math.floor(f)), r = f - a;
    const pos = [P[a].lng + (P[a + 1].lng - P[a].lng) * r, P[a].lat + (P[a + 1].lat - P[a].lat) * r];
    mk.setLngLat(pos);
    if ((rec || exp) && m.getSource('pos')) m.getSource('pos').setData({ type: 'Point', coordinates: pos });
    if (i !== lastDone && (force || FlugCalc.faellig(spurAt, now, S_.spur)) && m.getSource('done')) { lastDone = i; spurAt = now; zahl.spur++; m.getSource('done').setData(line(Math.max(1, i))); }
    if (force || FlugCalc.faellig(hudAt, now, S_.hud)) {
      hudAt = now; const tx = hudText(p);
      if (tx !== hudTxt) { hudTxt = tx; hud.innerHTML = tx; zahl.hud++; }
      const sv = String(Math.round(u * 1000)); if (slider.value !== sv) slider.value = sv;
    }
    if (follow) {
      if (pitchMode === 'auto' && !exp && (force || now - neigAt > 100)) { neigAt = now; fuelleNeig(f, false); }
      const c = FlugCalc.kamera(u, bahn, { neigung: pitchMode, basis: S_.neig, zBase, set: SET, rec: !!rec || !!exp });
      const o = { center: c.center, bearing: c.bearing };
      if (c.pitch != null) o.pitch = c.pitch;
      if (c.zoom != null) o.zoom = c.zoom;
      if (blend) {                                       // nach „Kamera frei“ sanft zurück auf die Bahn (nur Anzeige, die Bahn selbst bleibt unverändert)
        const q = Math.min(1, (now - blend.t) / 800), e = q * q * (3 - 2 * q), A = blend.c;
        o.center = [A.center[0] + (o.center[0] - A.center[0]) * e, A.center[1] + (o.center[1] - A.center[1]) * e];
        o.bearing = FlugCalc.winkelLerp(A.bearing, o.bearing, e);
        if (o.pitch != null) o.pitch = A.pitch + (o.pitch - A.pitch) * e;
        if (o.zoom != null) o.zoom = A.zoom + (o.zoom - A.zoom) * e;
        if (q >= 1) blend = null;
      }
      m.jumpTo(o);
    }
  };
  /** Stufe wechseln: Auflösung, Überhöhung, Schattierung, Takte, Grundneigung sofort; die Höhenkacheln (Zoomstufe) ab dem nächsten Flug. */
  const setStufe = (neu, auto) => {
    st = neu; S_ = FlugCalc.STUFEN[st];
    if (!rec && !preparing && !exp) { try { m.setPixelRatio(FlugCalc.pixelRatio(st, dpr())); } catch (e) { /* egal */ } }
    try { m.setTerrain({ source: 'dem', exaggeration: S_.ueber }); schatten(); } catch (e) { /* Karte noch nicht fertig */ }
    neuTabelle();
    const s = root.querySelector('#fst'); if (s) s.value = st;
    if (!auto) { ad = FlugCalc.adaptiv(st); Set_.set('flugStufe', st); }
  };
  const tick = now => {
    if (stopped || !mapEl.isConnected) { stopped = true; if (rec) stopRec(); if (exp && exp.abbruch) exp.abbruch(); try { m.remove(); } catch (e) { /* egal */ } window.__flug = null; Flug.aktiv = null; return; }
    requestAnimationFrame(tick);
    if (exp) { last = lastDraw = now; return; }      // 2.17.0: Video-Export stellt die Kamera selbst (Bild für Bild)
    if (now - lastDraw < FlugCalc.BILD_MIN_MS) return;   // 120/144-Hz-Bildschirm: nur jedes zweite Bild zeichnen
    const frame = now - lastDraw; lastDraw = now; zahl.bilder++;
    let dt = Math.max(0, Math.min(100, now - last)); last = now;
    if (rec && !rec.ending && !m.areTilesLoaded() && rec.stall < 1500) { rec.stall += dt; dt = 0; } else if (rec && m.areTilesLoaded()) rec.stall = 0;   // bei der Aufnahme kurz warten, bis die Kacheln da sind
    if (playing) {
      u += dt / 1000 / Ttot * speed;
      if (u >= 1) { u = 1; playing = false; pp.textContent = '↻ Nochmal'; }
      if (!rec && !preparing) { const neu = FlugCalc.adaptivSchritt(ad, typeof Flug.bildzeit === 'function' ? Flug.bildzeit(frame) : frame); /* Flug.bildzeit: Prüfhaken für Tests */ if (neu) { setStufe(neu, true); toast('Flug vereinfacht', 4000); } }
    }
    draw(now, false);
    if (playing) photos.forEach(q => { if (prevU < q.u && u >= q.u) showPh(q); });
    prevU = u;
    if (ph.classList.contains('on') && now > phUntil) ph.classList.remove('on');
    if (rec && u >= 1 && !rec.ending) { rec.ending = true; setTimeout(stopRec, 1800); }
  };
  /* Schnittstelle für Tests und den späteren Video-Export (Bild für Bild): Zeit t (Sekunden bei Tempo 1×) → Position → Kamera. */
  Flug.aktiv = {
    dauer: Ttot,
    stelleZeit(sec) { playing = false; pp.textContent = '▶ Weiter'; u = Math.max(0, Math.min(1, sec / Ttot)); prevU = u; blend = null; if (exp) follow = true; draw(performance.now(), true); return FlugCalc.kamera(u, bahn, { neigung: pitchMode, basis: S_.neig, zBase, set: SET, rec: !!rec || !!exp }); },
    kameraBei: sec => FlugCalc.kamera(Math.max(0, Math.min(1, sec / Ttot)), bahn, { neigung: pitchMode, basis: S_.neig, zBase, set: SET, rec: !!rec || !!exp }),
    fuelleNeigung() { fuelleNeig(0, true); return bahn.neig.w.filter(x => x == null).length; },
    stufe: () => st,
    bildzeiten(l) { let r = null; l.forEach(ms => { const n = FlugCalc.adaptivSchritt(ad, ms); if (n) { r = n; setStufe(n, true); toast('Flug vereinfacht', 4000); } }); return r; },
    zahlen: () => Object.assign({ ms: performance.now() - zahl.start, linie: keep.length, punkte: N }, zahl),
    /** 2.17.0: alles, was der Video-Export (js/v-flugvideo.js) vom laufenden Flug braucht. */
    video: () => videoKontext,
  };
  const profil = (() => {      // Höhenprofil für die Einblendung: Strecke 0…1, Höhe 0…1 (Überflüge ausgelassen), höchstens 400 Punkte
    const q = P.filter(p => !p.trans), lo = Math.min(...q.map(p => p.alt)), hi = Math.max(...q.map(p => p.alt)), step = Math.max(1, Math.ceil(q.length / 400));
    return q.filter((p, i) => i % step === 0 || i === q.length - 1).map(p => [total ? p.d / total : 0, hi > lo ? (p.alt - lo) / (hi - lo) : 0.5]);
  })();
  const datum = (() => {
    const a = tours[0].start, b = tours[tours.length - 1].start;
    if (!a) return '';
    const ds = ms => new Date(ms).toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' });
    return SET && b && new Date(b).toDateString() !== new Date(a).toDateString() ? ds(a) + ' – ' + ds(b) : ds(a);
  })();
  const videoKontext = {
    m, mapEl, titel: t.name, start: tours[0].start, SET, dauer: Ttot, photos: photos.map(p => ({ id: p.id, u: p.u, ts: p.ts })),
    stil: () => $v('fb'), stufe: () => st, demZoom: () => demMz, fehler: () => mapErr,
    setzeStufe(neu) { setStufe(neu, true); demNeu(FlugCalc.STUFEN[neu].dem); },
    /** Export beginnt: Flug anhalten, Kamera folgt, Punkt als Kartenebene. abbruch() wird gerufen, wenn der Flug verlassen wird. */
    beginne(abbruch) {
      exp = { abbruch }; playing = false; follow = true; blend = null; pp.textContent = '▶ Weiter';
      const fc = root.querySelector('#fc'); if (fc) fc.value = 'follow';
      try { m.setLayoutProperty('pos', 'visibility', 'visible'); } catch (e) { /* egal */ }
      fl.classList.remove('idle');
    },
    vorwaermen: (melde, halt) => prewarm(zBase + 0.9, melde, halt),
    neigung() { fuelleNeig(0, true); return bahn.neig.w.filter(x => x == null).length; },
    stelleZeit: sec => Flug.aktiv.stelleZeit(sec),
    kameraBei: sec => Flug.aktiv.kameraBei(sec),
    /** Daten für Flug.zeichne an der Flugposition uu (0…1). */
    einblendung(uu, an, foto) {
      const p = pAt(uu);
      return { an, titel: titelAt(p), datum, u: uu, ud: total ? p.d / total : uu, profil, foto, quelle: FlugCalc.video.quelle($v('fb')),
        kennzahl: `${F.km(p.d)} · ↑ ${Math.round(p.up).toLocaleString('de-DE')} m`, kennzahl2: `${Math.round(p.alt).toLocaleString('de-DE')} m Höhe · ${F.km(total)} gesamt` };
    },
    ende() {
      exp = null;
      try { m.setLayoutProperty('pos', 'visibility', rec ? 'visible' : 'none'); } catch (e) { /* egal */ }
      try { m.setPixelRatio(FlugCalc.pixelRatio(st, dpr())); } catch (e) { /* egal */ }
    },
    aktiv: () => !stopped && mapEl.isConnected,
  };
  vidB.onclick = () => { if (rec || preparing || exp) return; FlugVideo.dialog(videoKontext); };
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
    if (k === 'fv') speed = +$v('fv');
    else if (k === 'fc') { follow = $v('fc') === 'follow'; if (follow) blend = { t: performance.now(), c: { center: m.getCenter().toArray(), bearing: m.getBearing(), pitch: m.getPitch(), zoom: m.getZoom() } }; }
    else if (k === 'fz') { zBase = +$v('fz'); m.setZoom(zBase); neuTabelle(); }
    else if (k === 'fpi') { pitchMode = $v('fpi') === 'auto' ? 'auto' : 'fest'; if (pitchMode !== 'auto') m.setPitch(+$v('fpi')); else blend = { t: performance.now(), c: { center: m.getCenter().toArray(), bearing: m.getBearing(), pitch: m.getPitch(), zoom: m.getZoom() } }; }
    else if (k === 'fb') { ['osm', 'topo', 'sat'].forEach(x => m.setLayoutProperty(x, 'visibility', x === $v('fb') ? 'visible' : 'none')); Set_.set('style3d', $v('fb')); }
    else if (k === 'fst') setStufe(FlugCalc.stufe($v('fst'), handy), false);
  }
  try { m.touchZoomRotate.enable(); m.touchZoomRotate.enableRotation(); m.touchPitch.enable(); m.dragRotate.enable(); } catch (e) { /* egal */ }
  ['dragstart', 'rotatestart', 'pitchstart', 'zoomstart'].forEach(n => m.on(n, ev => { if (follow && ev && ev.originalEvent) { follow = false; root.querySelector('#fc').value = 'free'; } }));
  m.on('error', e => {
    mapErr++;
    console.warn('3D:', e && e.error && e.error.message);
    if (e && e.error && /terrain|dem/i.test(String(e.error.message))) { msg.textContent = 'Höhendaten nicht erreichbar – Gelände wird flach dargestellt'; msg.style.display = ''; }
  });
};
