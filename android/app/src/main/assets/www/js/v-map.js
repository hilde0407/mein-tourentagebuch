'use strict';
Views['/map'] = async root => {
  const mapEl = h('div', { class: 'map full' });
  const all = (await Tours.list()).filter(t => t.status !== 'planned' && !t.hidden);
  const years = [...new Set(all.map(t => new Date(t.start).getFullYear()))].sort((a, b) => b - a);
  let year = '', showPhotos = false;
  const yearSel = h('select', { 'aria-label': 'Jahr', onchange: e => { year = e.target.value; draw(); } }, h('option', { value: '' }, 'Alle Jahre'), years.map(y => h('option', { value: y }, y)));
  const phBtn = h('button', { class: 'chip', onclick: () => { showPhotos = !showPhotos; phBtn.classList.toggle('on', showPhotos); draw(); } }, '🖼 Fotos');
  root.append(topbar('Karte', { actions: h('div', { class: 'row' }, yearSel) }), h('div', { class: 'maptools' }, phBtn,
    h('button', { class: 'chip', onclick: offline }, '⬇ Offline-Karte')), mapEl);
  const map = MapKit.create(mapEl);
  const g = L.layerGroup().addTo(map);
  const cache = {};
  const fc = JSON.parse(sessionStorage.getItem('mapFocus') || 'null');
  let token = 0, fitted = false;
  async function draw() {
    const my = ++token; g.clearLayers();
    const ts = all.filter(t => !year || String(new Date(t.start).getFullYear()) === year);
    const bounds = [];
    for (let i = 0; i < ts.length; i++) {
      if (my !== token) return;
      const t = ts[i];
      if (!cache[t.id]) cache[t.id] = Geo.simplify(await Tours.points(t.id), 30);
      const pts = cache[t.id]; if (pts.length < 2) continue;
      const pl = MapKit.line(pts, MapKit.routeColor(t.sport, '#2e7d32'), 3).addTo(g);
      pl.on('click', () => L.popup().setLatLng([pts[0].lat, pts[0].lon]).setContent(`<b>${esc(t.name)}</b><br>${F.dshort(t.start)} · ${F.km(t.dist)}<br><a href="#/tour/${t.id}">Öffnen</a>`).openOn(map));
      bounds.push([t.lat, t.lon]);
      if (i % 20 === 19) await sleep(0);
    }
    if (showPhotos) {
      const ph = (await Photos.all()).filter(p => p.lat != null && (!year || (p.ts && String(new Date(p.ts).getFullYear()) === year)));
      const list = await Photos.all();
      ph.forEach(p => { MapKit.photoMarker(p, () => Lightbox.open(list, list.indexOf(p))).addTo(g); bounds.push([p.lat, p.lon]); });
    }
    if (!fitted && !fc && bounds.length) { map.fitBounds(L.latLngBounds(bounds), { padding: [30, 30] }); fitted = true; }
  }
  if (fc) { map.setView(fc, 15); sessionStorage.removeItem('mapFocus'); }
  else if (all.some(t => t.lat != null)) { map.fitBounds(L.latLngBounds(all.filter(t => t.lat != null).map(t => [t.lat, t.lon])), { padding: [30, 30], maxZoom: 13 }); fitted = true; }   // sofort auf die Startpunkte, Spuren laden später
  else {      // ohne Touren: Standort versuchen, still zurück auf Europa (Leaflet zoomt bei einem Fehler sonst auf die ganze Welt)
    map.setView([50, 10], 5);
    map.once('locationerror', () => map.setView([50, 10], 5));
    map.locate({ setView: true, maxZoom: 11 });
  }
  const loc = L.control({ position: 'topright' });
  loc.onAdd = () => { const b = h('button', { class: 'mapbtn', 'aria-label': 'Mein Standort', onclick: () => map.locate({ setView: true, maxZoom: 15 }) }, '◎'); L.DomEvent.disableClickPropagation(b); return b; };
  loc.addTo(map);
  map.on('locationfound', e => L.circleMarker(e.latlng, { radius: 8, color: '#fff', weight: 3, fillColor: '#1565c0', fillOpacity: 1 }).addTo(map));
  async function offline() {
    const b = map.getBounds(), z = map.getZoom();
    const zmax = Math.min(16, z + 3);
    const n = MapKit.tileUrls(b, z, zmax).length;
    if (!await confirmBox('Karte offline speichern', `Der sichtbare Ausschnitt wird für die Zoomstufen ${z}–${zmax} gespeichert (ca. ${n} Kacheln, etwa ${Math.round(n * 0.02)} MB). Bitte nur im WLAN.`, 'Herunterladen')) return;
    try { await PhotoSources.progress('Karte laden', async (upd) => { const sig = {}; await MapKit.downloadArea(b, z, zmax, d => upd(Math.min(d, n), n), sig); }); toast('Karte gespeichert ✓'); }
    catch (e) { toast(e.message, 6000); }
  }
  await draw();
  return () => map.remove();
};
