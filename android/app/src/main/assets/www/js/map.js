'use strict';
/* Karten (Leaflet): Kartenquellen, Offline-Kacheln, Spuren, Foto-Marker, Höhenprofil. */
/* Leaflet-Absicherung: Wird eine Karte entfernt, während noch eine Zoom-/Schwenk-Animation läuft, rufen Zeitgeber später Funktionen
   einer schon abgebauten Karte auf und lösen einen Fehler aus. Diese Aufrufe werden dann übersprungen. */
['_onZoomTransitionEnd', '_animateZoom', '_tryAnimatedPan', '_catchTransitionEnd'].forEach(n => {
  const o = L.Map.prototype[n]; if (!o) return;
  L.Map.prototype[n] = function () { return this._mapPane ? o.apply(this, arguments) : undefined; };
});
const MapKit = {
  providers: {
    osm: { name: 'Straßenkarte (OpenStreetMap)', url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', max: 19, attr: '© OpenStreetMap-Mitwirkende' },
    topo: { name: 'Wanderkarte (OpenTopoMap)', url: 'https://tile.opentopomap.org/{z}/{x}/{y}.png', max: 17, attr: '© OpenStreetMap-Mitwirkende, SRTM | © OpenTopoMap (CC-BY-SA)' },
    custom: { name: 'Eigener Kartenserver', url: '', max: 19, attr: 'Kartendaten: siehe Anbieter' },
  },
  sportColor: { hike: '#2e7d32', walk: '#2e7d32', mtb: '#e65100', bike: '#1565c0', racebike: '#6a1b9a', ebike: '#00838f', run: '#c62828', ski: '#37474f', mountaineering: '#4e342e', other: '#546e7a' },
  /** Streckenfarbe: eigene Wahl (Einstellungen) oder die Farbe der Sportart. */
  routeColor(sport, fb) { const c = Set_.get('routeColor'); return /^#[0-9a-f]{6}$/i.test(c || '') ? c : (MapKit.sportColor[sport] || fb || '#2e7d32'); },
  cacheName: 'tiles-v1',

  layer() {
    const id = Set_.get('tiles') || 'osm';
    let p = MapKit.providers[id] || MapKit.providers.osm;
    let url = p.url;
    if (id === 'custom') url = (Set_.get('tileUrl') || '').replace('{key}', Set_.get('tileKey') || '') || MapKit.providers.osm.url;
    return new MapKit.CachedTiles(url, { maxZoom: p.max, attribution: p.attr, crossOrigin: true });
  },
  _tileLayerClass: null,
  init() {
    if (MapKit.CachedTiles) return;
    MapKit.CachedTiles = L.TileLayer.extend({
      createTile(coords, done) {
        const img = document.createElement('img');
        img.alt = ''; img.setAttribute('role', 'presentation');
        const url = this.getTileUrl(coords);
        const fin = (err) => done(err, img);
        const useBlob = b => { const u = URL.createObjectURL(b); img.onload = () => { URL.revokeObjectURL(u); fin(null); }; img.onerror = () => fin(null); img.src = u; };
        (async () => {
          try {
            if (!window.caches) throw 0;
            const c = await caches.open(MapKit.cacheName);
            let r = await c.match(url);
            if (!r) { r = await fetch(url, { mode: 'cors' }); if (!r.ok) throw 0; c.put(url, r.clone()).catch(() => {}); }
            useBlob(await r.blob());
          } catch (e) { img.onload = () => fin(null); img.onerror = () => fin(null); img.src = url; }
        })();
        return img;
      },
    });
  },
  create(el, opts) {
    MapKit.init();
    const m = L.map(el, { zoomControl: false, attributionControl: true, preferCanvas: true }).setView([47.5, 11.2], opts && opts.zoom || 8);
    MapKit.layer().addTo(m);
    L.control.zoom({ position: 'topright' }).addTo(m);
    return m;
  },
  tileXY(lat, lon, z) { const n = 2 ** z; return [Math.floor((lon + 180) / 360 * n), Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * n)]; },
  tileUrls(b, zmin, zmax) {
    const tpl = MapKit.layer()._url, out = [];
    for (let z = zmin; z <= zmax; z++) {
      const [x0, y1] = MapKit.tileXY(b.getSouth(), b.getWest(), z), [x1, y0] = MapKit.tileXY(b.getNorth(), b.getEast(), z);
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.push(tpl.replace('{z}', z).replace('{x}', x).replace('{y}', y));
    }
    return out;
  },
  async downloadArea(bounds, zmin, zmax, onProgress, signal) {
    const urls = MapKit.tileUrls(bounds, zmin, zmax);
    if (urls.length > 6000) throw new Error('Zu viele Kacheln (' + urls.length + '). Bitte kleineren Ausschnitt oder niedrigere Zoomstufe wählen.');
    const c = await caches.open(MapKit.cacheName);
    let done = 0;
    const work = async () => {
      while (urls.length && !(signal && signal.stop)) {
        const u = urls.pop();
        try { if (!(await c.match(u))) { const r = await fetch(u, { mode: 'cors' }); if (r.ok) await c.put(u, r); } } catch (e) { /* Kachel übersprungen */ }
        done++; if (onProgress && done % 10 === 0) onProgress(done);
      }
    };
    await Promise.all([work(), work(), work(), work()]);
    return done;
  },
  async cacheCount() { try { return (await (await caches.open(MapKit.cacheName)).keys()).length; } catch (e) { return 0; } },
  async clearCache() { try { await caches.delete(MapKit.cacheName); } catch (e) { /* egal */ } },

  line(pts, color, w) {
    const segs = []; let cur = [];
    pts.forEach((p, i) => { if (p.newSeg && cur.length) { segs.push(cur); cur = []; } cur.push([p.lat, p.lon]); });
    if (cur.length) segs.push(cur);
    return L.polyline(segs, { color, weight: w || 5, opacity: 0.9, lineJoin: 'round' });
  },
  /** Pulszonen: Farben und Namen (Zone 1 = ruhig … Zone 5 = maximal). */
  hrColor: ['#4fc3f7', '#66bb6a', '#ffca28', '#fb8c00', '#e53935'],
  hrName: ['Zone 1 · ruhig', 'Zone 2 · locker', 'Zone 3 · fordernd', 'Zone 4 · hart', 'Zone 5 · maximal'],
  hrMax() { const v = parseInt(Set_.get('hrMax'), 10); return v >= 120 && v <= 230 ? v : 190; },
  /** Strecke in Pulszonen-Farben. Abschnitte ohne Messwert bleiben grau. */
  lineHr(pts, w) {
    const hm = MapKit.hrMax(), g = L.layerGroup();
    let cur = [], z = -2;
    const flush = () => {
      if (cur.length > 1) g.addLayer(L.polyline(cur, { color: z < 0 ? '#9e9e9e' : MapKit.hrColor[z], weight: w || 5, opacity: 0.9, lineJoin: 'round' }));
      cur = cur.length ? [cur[cur.length - 1]] : [];
    };
    pts.forEach(p => {
      const nz = p.hr ? Tours.hrZone(p.hr, hm) : -1;
      if (p.newSeg) { flush(); cur = []; }
      if (nz !== z) { flush(); z = nz; }
      cur.push([p.lat, p.lon]);
    });
    flush();
    return g;
  },
  dot(lat, lon, color, label) {
    return L.marker([lat, lon], { icon: L.divIcon({ className: 'mk', html: `<span style="background:${color}">${label || ''}</span>`, iconSize: [26, 26], iconAnchor: [13, 13] }) });
  },
  photoMarker(p, onclick) {
    const m = L.marker([p.lat, p.lon], { icon: L.divIcon({ className: 'pmk', html: `<img src="${Photos.thumb(p.id)}" alt="" loading="lazy" class="${p.pos === 'track' ? 'est' : ''}">`, iconSize: [38, 38], iconAnchor: [19, 19] }) });
    m.on('click', () => onclick(p));
    return m;
  },

  /** Höhenprofil auf ein Canvas zeichnen. onMove(index|null) wird beim Berühren aufgerufen. */
  profile(canvas, pts, onMove) {
    const dpr = window.devicePixelRatio || 1, W = canvas.clientWidth, H = canvas.clientHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    const g = canvas.getContext('2d'); g.scale(dpr, dpr);
    const cs = getComputedStyle(document.documentElement);
    const ink = cs.getPropertyValue('--muted').trim() || '#666', acc = cs.getPropertyValue('--acc').trim() || '#2e7d32';
    const xs = [0]; for (let i = 1; i < pts.length; i++) xs.push(xs[i - 1] + (pts[i].newSeg ? 0 : Geo.dist(pts[i - 1].lat, pts[i - 1].lon, pts[i].lat, pts[i].lon)));
    const el = Geo.smooth(pts.map(p => p.ele), 3);
    const vals = el.filter(v => v != null);
    g.clearRect(0, 0, W, H);
    if (vals.length < 2) { g.fillStyle = ink; g.font = '13px sans-serif'; g.fillText('Keine Höhendaten', 12, H / 2); return null; }
    let mn = Math.min(...vals), mx = Math.max(...vals); if (mx - mn < 20) { mx = mn + 20; }
    const L_ = 38, B = 18, T = 6, tot = xs[xs.length - 1] || 1;
    const X = d => L_ + d / tot * (W - L_ - 6), Y = v => T + (1 - (v - mn) / (mx - mn)) * (H - T - B);
    g.strokeStyle = 'rgba(128,128,128,.25)'; g.fillStyle = ink; g.font = '11px sans-serif'; g.lineWidth = 1;
    for (let k = 0; k <= 3; k++) { const v = mn + (mx - mn) * k / 3, y = Y(v); g.beginPath(); g.moveTo(L_, y); g.lineTo(W - 6, y); g.stroke(); g.fillText(Math.round(v), 2, y + 4); }
    g.fillText((tot / 1000).toFixed(1).replace('.', ',') + ' km', W - 52, H - 3);
    g.beginPath(); let first = true, lastX = L_;
    el.forEach((v, i) => { if (v == null) return; const x = X(xs[i]), y = Y(v); if (first) { g.moveTo(x, y); first = false; } else g.lineTo(x, y); lastX = x; });
    g.strokeStyle = acc; g.lineWidth = 2; g.stroke();
    g.lineTo(lastX, H - B); g.lineTo(L_, H - B); g.closePath(); g.fillStyle = acc + '33'; g.fill();
    const hrs = pts.map(p => p.hr || null), hv = hrs.filter(Boolean);
    if (hv.length > 4) {                                          // Pulskurve über das Profil legen
      const hmn = Math.min(...hv), hmx = Math.max(...hv), hr0 = hmx - hmn < 10 ? hmn - 5 : hmn, hr1 = hmx - hmn < 10 ? hmx + 5 : hmx;
      g.beginPath();
      let st = true;
      hrs.forEach((v, i) => {
        if (!v) { st = true; return; }
        const x = X(xs[i]), y = T + (1 - (v - hr0) / (hr1 - hr0)) * (H - T - B);
        if (st) { g.moveTo(x, y); st = false; } else g.lineTo(x, y);
      });
      g.strokeStyle = '#e53935'; g.lineWidth = 1.6; g.stroke();
      g.fillStyle = '#e53935'; g.font = '11px sans-serif'; g.fillText(hmn + '–' + hmx + ' bpm', L_ + 4, T + 11);
    }
    let cur = null;
    const idxAt = ev => { const r = canvas.getBoundingClientRect(), x = (ev.touches ? ev.touches[0].clientX : ev.clientX) - r.left; const d = Math.max(0, Math.min(tot, (x - L_) / (W - L_ - 6) * tot)); let lo = 0, hi = xs.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (xs[m] < d) lo = m; else hi = m; } return lo; };
    const mv = ev => { const i = idxAt(ev); if (onMove) onMove(i, { dist: xs[i], ele: pts[i].ele, hr: pts[i].hr || null }); };
    canvas.onpointermove = mv; canvas.onpointerdown = mv; canvas.onpointerleave = () => onMove && onMove(null);
    return xs;
  },
};
