'use strict';
/* Tourenkarte. 2.8.1: Jede Tour hat einen Startpunkt-Marker in Sportfarbe; bei weitem Zoom werden nahe Marker zu Gruppen mit Anzahl
   zusammengefasst (Raster, KartenPunkte in js/calc-kartenpunkte.js). Linien erst ab KartenPunkte.linienAb(…) (meist Zoom 9) und nur im Ausschnitt. */
Views['/map'] = async root => {
  const KP = KartenPunkte;
  const mapEl = h('div', { class: 'map full' });
  const all = (await Tours.list()).filter(t => t.status !== 'planned' && !t.hidden);
  const years = [...new Set(all.map(t => new Date(t.start).getFullYear()))].sort((a, b) => b - a);
  let year = '', showPhotos = false;
  const yearSel = h('select', { 'aria-label': 'Jahr', onchange: e => { year = e.target.value; draw(); } }, h('option', { value: '' }, 'Alle Jahre'), years.map(y => h('option', { value: y }, y)));
  const phBtn = UI.chip('🖼 Fotos zeigen', false, () => { showPhotos = !showPhotos; phBtn.classList.toggle('on', showPhotos); phBtn.setAttribute('aria-pressed', showPhotos ? 'true' : 'false'); draw(); });
  // Die Karte ist die zweite Ansicht der Tourenliste: oben rechts geht es zurück zur Liste
  root.append(topbar('Karte', { actions: h('a', { class: 'btn sm hbtn', id: 'tolist', href: '#/', html: Ico.svg('list') + '<span>Liste</span>' }) }),
    h('div', { class: 'maptools' }, yearSel, phBtn, h('button', { class: 'chip', id: 'tooffline', onclick: offline }, '⬇ Offline-Karte')), mapEl);
  const map = MapKit.create(mapEl);
  const g = L.layerGroup().addTo(map);            // Fotos
  const linien = L.layerGroup().addTo(map);       // Strecken (nur nah genug und im Ausschnitt)
  const punkte = L.layerGroup().addTo(map);       // Startpunkte bzw. Gruppen
  const cache = {}, lines = {};
  const fc = JSON.parse(sessionStorage.getItem('mapFocus') || 'null');
  let token = 0, ltoken = 0, fitted = false;

  // Startpunkte: gespeicherte Lage, sonst der erste Punkt der Spur (nur für diese Touren wird die Spur gleich geladen)
  const start = {};
  for (const t of all) {
    let s = KP.startpunkt(t, null);
    if (!s) { try { cache[t.id] = Geo.simplify(await Tours.points(t.id), 30); s = KP.startpunkt(null, cache[t.id]); } catch (e) { s = null; } }
    if (s) start[t.id] = s;
  }
  const sichtbar = () => KP.jahrFilter(all, year).filter(t => start[t.id]);
  const color = t => MapKit.routeColor(t.sport, '#2e7d32');
  const popupHtml = t => `<b>${esc(t.name)}</b><br>${F.dshort(t.start)} · ${F.km(t.dist)}<br><a href="#/tour/${t.id}">Öffnen</a>`;
  const popup = t => L.popup().setLatLng([start[t.id].lat, start[t.id].lon]).setContent(popupHtml(t)).openOn(map);
  const allBounds = ts => L.latLngBounds(ts.map(t => [start[t.id].lat, start[t.id].lon]));

  // Erster Ausschnitt wie bisher: alle Startpunkte. Daraus folgt, ab welchem Zoom Linien erscheinen (weit verteilt: erst ab Zoom 9).
  const st0 = all.filter(t => start[t.id]);
  if (fc) { map.setView(fc, 15); sessionStorage.removeItem('mapFocus'); }
  else if (st0.length) { map.fitBounds(allBounds(st0), { padding: [30, 30], maxZoom: 13 }); fitted = true; }
  else {      // ohne Touren: Standort versuchen, still zurück auf Europa (Leaflet zoomt bei einem Fehler sonst auf die ganze Welt)
    map.setView([50, 10], 5);
    map.once('locationerror', () => map.setView([50, 10], 5));
    map.locate({ setView: true, maxZoom: 11 });
  }
  const linienAb = KP.linienAb(KP.spanneKm(st0.map(t => start[t.id])), fc ? NaN : map.getZoom());
  mapEl.dataset.linienAb = linienAb;
  mapEl.__karte = { map, linien, punkte };      // für die Tests (Ebenen zählen; Kartenbilder gibt es dort nicht)

  const info = L.control({ position: 'bottomleft' });
  const infoEl = h('div', { class: 'mapinfo', id: 'mapinfo' });
  info.onAdd = () => infoEl; info.addTo(map);
  const ctl = (pos, el) => { const c = L.control({ position: pos }); c.onAdd = () => { L.DomEvent.disableClickPropagation(el); return el; }; c.addTo(map); };
  ctl('topright', h('button', { class: 'mapbtn', 'aria-label': 'Mein Standort', html: Ico.svg('locate', 24), onclick: () => map.locate({ setView: true, maxZoom: 15 }) }));
  ctl('topleft', h('button', { class: 'mapbtn wide', id: 'alletouren', html: Ico.svg('map', 20) + '<span>Alle Touren</span>', onclick: alleTouren }));
  map.on('locationfound', e => L.circleMarker(e.latlng, { radius: 8, color: '#fff', weight: 3, fillColor: '#1565c0', fillOpacity: 1 }).addTo(map));

  function alleTouren() {
    const ts = sichtbar();
    if (!ts.length) { toast('Keine Touren mit Position'); return; }
    if (ts.length === 1) map.setView([start[ts[0].id].lat, start[ts[0].id].lon], 13);
    else map.fitBounds(allBounds(ts), { padding: [30, 30], maxZoom: 13 });
  }
  const ausschnitt = (pad) => { const b = map.getBounds().pad(pad || 0); return { s: b.getSouth(), w: b.getWest(), n: b.getNorth(), e: b.getEast() }; };

  /** Startpunkte bzw. Gruppen neu bilden (bei jedem Zoomen und Verschieben). Nur Gruppen nahe dem Ausschnitt werden als Marker angelegt. */
  function gruppen() {
    punkte.clearLayers();
    const ts = sichtbar(), z = map.getZoom(), v = ausschnitt(0.5);
    const pts = ts.map(t => ({ lat: start[t.id].lat, lon: start[t.id].lon, t }));
    infoEl.textContent = KP.anzahlText(KP.zaehlen(pts, ausschnitt()));
    for (const gr of KP.gruppieren(pts, z, KP.ZELLE)) {
      if (!KP.imAusschnitt([gr.sued, gr.west, gr.nord, gr.ost], v)) continue;
      if (gr.n === 1) {
        const t = gr.punkte[0].t, c = color(t);
        const m = L.marker([gr.lat, gr.lon], { title: t.name + ', ' + F.dshort(t.start), alt: t.name, riseOnHover: true,
          icon: L.divIcon({ className: 'tmk', html: `<span style="background:${c}"></span>`, iconSize: [34, 34], iconAnchor: [17, 17] }) });
        m.on('click', () => popup(t));
        m.addTo(punkte);
      } else {
        const c = color({ sport: KP.haeufigste(gr.punkte.map(p => p.t.sport)) }), s = KP.groesse(gr.n);
        const m = L.marker([gr.lat, gr.lon], { title: KP.anzahlText(gr.n) + ' – hineinzoomen', alt: KP.anzahlText(gr.n), riseOnHover: true, zIndexOffset: 500 + gr.n,
          icon: L.divIcon({ className: 'tgrp', html: `<span style="background:${c};color:${KP.textFarbe(c)};width:${s}px;height:${s}px">${gr.n}</span>`, iconSize: [s + 6, s + 6], iconAnchor: [(s + 6) / 2, (s + 6) / 2] }) });
        m.on('click', () => {
          const b = L.latLngBounds([gr.sued, gr.west], [gr.nord, gr.ost]);
          // Weiter hineinzoomen geht nicht (alle am selben Ort oder höchste Stufe): Liste der Touren statt Zoom
          if (map.getBoundsZoom(b, false, L.point(60, 60)) <= z || z >= map.getMaxZoom() || KP.gruppieren(gr.punkte, map.getMaxZoom(), KP.ZELLE).length === 1) {
            const list = gr.punkte.map(p => p.t).sort((a, b2) => b2.start - a.start);
            L.popup({ maxHeight: 260 }).setLatLng([gr.lat, gr.lon]).setContent(`<b>${KP.anzahlText(gr.n)}</b>` + list.map(t => `<br><a href="#/tour/${t.id}">${esc(t.name)}</a> · ${F.dshort(t.start)} · ${F.km(t.dist)}`).join('')).openOn(map);
          } else map.fitBounds(b, { padding: [60, 60] });
        });
        m.addTo(punkte);
      }
    }
  }

  /** Strecken im Ausschnitt zeichnen, sobald nah genug gezoomt ist; weiter weg werden sie ausgeblendet. Spuren werden nur bei Bedarf geladen. */
  async function zeichneLinien() {
    const my = ++ltoken;
    if (map.getZoom() < linienAb) { linien.clearLayers(); return; }
    const v = ausschnitt(0.25), ts = sichtbar();
    const inView = ts.filter(t => KP.imAusschnitt(t.bbox || [start[t.id].lat, start[t.id].lon, start[t.id].lat, start[t.id].lon], v));
    const want = new Set(inView.map(t => t.id));
    linien.eachLayer(l => { if (!want.has(l._tid)) linien.removeLayer(l); });
    for (let i = 0; i < inView.length; i++) {
      const t = inView[i];
      if (!cache[t.id]) { cache[t.id] = Geo.simplify(await Tours.points(t.id), 30); if (my !== ltoken) return; }
      const pts = cache[t.id]; if (pts.length < 2) continue;
      if (!lines[t.id]) {
        const pl = MapKit.line(pts, color(t), 3); pl._tid = t.id;
        pl.on('click', () => L.popup().setLatLng([pts[0].lat, pts[0].lon]).setContent(popupHtml(t)).openOn(map));
        lines[t.id] = pl;
      }
      if (!linien.hasLayer(lines[t.id])) linien.addLayer(lines[t.id]);
      if (i % 20 === 19) { await sleep(0); if (my !== ltoken) return; }
    }
  }

  function neu() { gruppen(); zeichneLinien(); }
  map.on('moveend', neu);       // kommt auch nach jedem Zoomen (Leaflet: zoomend, dann moveend)

  async function draw() {
    const my = ++token; g.clearLayers();
    neu();
    if (showPhotos) {
      const list = await Photos.all(); if (my !== token) return;
      const ph = list.filter(p => p.lat != null && (!year || (p.ts && String(new Date(p.ts).getFullYear()) === year)));
      const bounds = [];
      ph.forEach(p => { MapKit.photoMarker(p, () => Lightbox.open(list, list.indexOf(p))).addTo(g); bounds.push([p.lat, p.lon]); });
      if (!fitted && !fc && bounds.length) { map.fitBounds(L.latLngBounds(bounds), { padding: [30, 30] }); fitted = true; }
    }
  }
  /** 2.11.0: sichtbaren Ausschnitt an „Offline-Karten“ übergeben (dort Schätzung, Bestätigung, Laden in der Hülle). */
  function offline() {
    const b = map.getBounds();
    try { sessionStorage.setItem('offBounds', JSON.stringify({ s: b.getSouth(), w: b.getWest(), n: b.getNorth(), e: b.getEast() })); sessionStorage.setItem('offArt', 'karte'); } catch (e) { /* egal */ }
    Nav.go('/offline');
  }
  await draw();
  return () => { token++; ltoken++; map.remove(); };
};
