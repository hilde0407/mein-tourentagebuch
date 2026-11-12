'use strict';
/* Planen: Wegpunkte auf der Karte setzen, Routing über BRouter (konfigurierbar), Profil, Speichern/Export/Ansagen. */
const Router = {
  profileFor: s => ({ hike: 'hiking-mountain', walk: 'hiking-mountain', mountaineering: 'hiking-mountain', run: 'hiking-mountain', mtb: 'mtb', bike: 'trekking', ebike: 'trekking', racebike: 'fastbike', ski: 'hiking-mountain' }[s] || 'trekking'),
  /** Strecke zwischen zwei Punkten; bei Fehler gerade Linie (geradeaus = true). */
  async leg(a, b, profile) {
    const base = (Set_.get('routeUrl') || 'https://brouter.de/brouter').replace(/\/$/, '');
    const prof = Set_.get('routeProfile') || profile;
    const url = `${base}?lonlats=${a.lon},${a.lat}|${b.lon},${b.lat}&profile=${encodeURIComponent(prof)}&alternativeidx=0&format=geojson`;
    try {
      const r = await Native.http({ url });
      if (r.status !== 200) throw new Error('HTTP ' + r.status);
      const j = JSON.parse(r.body);
      const c = j.features[0].geometry.coordinates;
      return { pts: c.map(x => ({ lat: x[1], lon: x[0], ele: x[2] != null ? +x[2] : null })), straight: false };
    } catch (e) {
      return { pts: [{ lat: a.lat, lon: a.lon, ele: null }, { lat: b.lat, lon: b.lon, ele: null }], straight: true, err: e.message };
    }
  },
};

Views['/plan'] = async (root, [editId]) => {
  const mapEl = h('div', { class: 'map pmap' });
  const panel = h('div', { class: 'ppanel' });
  let sport = 'hike', name = '', wps = [], legs = [], busy = false, snap = true, markers = [], editing = null;
  if (editId) {
    editing = await DB.get('tours', editId);
    if (editing) { sport = editing.sport; name = editing.name; const pts = await Tours.points(editId); const meta = (await DB.kvGet('plan:' + editId, null)); if (meta) { wps = meta.wps; } else { const sp = Geo.simplify(pts, 60); wps = [sp[0], sp[sp.length - 1]].map(p => ({ lat: p.lat, lon: p.lon })); } }
  }
  const info = h('div', { class: 'stats' }), chips = h('div', { class: 'chips' });
  const prof = h('canvas', { class: 'prof small' });
  root.append(topbar(editing ? 'Tour bearbeiten' : 'Tour planen', { actions: h('button', { class: 'ico', 'aria-label': 'Rückgängig', onclick: undo }, '↶') }), mapEl, panel);
  const map = MapKit.create(mapEl);
  const routeLayer = L.layerGroup().addTo(map), mk = L.layerGroup().addTo(map);
  const hereBtn = L.control({ position: 'topright' });
  hereBtn.onAdd = () => { const b = h('button', { class: 'mapbtn', 'aria-label': 'Mein Standort', onclick: () => map.locate({ setView: true, maxZoom: 15 }) }, '◎'); L.DomEvent.disableClickPropagation(b); return b; };
  hereBtn.addTo(map);
  const fc = JSON.parse(sessionStorage.getItem('mapFocus') || 'null');
  const hl = Set_.get('homeLat');
  map.setView(fc || (hl ? [+hl, +Set_.get('homeLon')] : [47.5, 11.2]), fc ? 14 : 9);
  map.locate({ setView: !editing && !fc && !hl, maxZoom: 14 });
  setTimeout(() => { try { if (map.getContainer().isConnected) map.invalidateSize(); } catch (e) { /* Ansicht schon verlassen */ } }, 200);

  const profileName = () => Set_.get('routeProfile') || Router.profileFor(sport);
  async function addWp(ll) {
    if (busy) return;
    wps.push({ lat: ll.lat, lon: ll.lng });
    if (wps.length > 1) await routeLeg(wps.length - 2);
    redraw();
  }
  async function routeLeg(i) {
    busy = true;
    const a = wps[i], b = wps[i + 1];
    const l = snap ? await Router.leg(a, b, Router.profileFor(sport)) : { pts: [{ lat: a.lat, lon: a.lon, ele: null }, { lat: b.lat, lon: b.lon, ele: null }], straight: true };
    legs[i] = l; busy = false;
    if (l.straight && snap) toast('Routing nicht erreichbar – gerade Linie eingezeichnet. (' + l.err + ')', 5000);
  }
  async function rebuild() { legs = []; for (let i = 0; i < wps.length - 1; i++) await routeLeg(i); redraw(); }
  function allPts() { const out = []; legs.forEach((l, i) => l.pts.forEach((p, k) => { if (i && !k) return; out.push(p); })); return out; }
  function redraw() {
    routeLayer.clearLayers(); mk.clearLayers();
    const pts = allPts();
    if (pts.length > 1) L.polyline(pts.map(p => [p.lat, p.lon]), { color: '#1565c0', weight: 5, opacity: .9 }).addTo(routeLayer);
    wps.forEach((w, i) => {
      const m = L.marker([w.lat, w.lon], { draggable: true, icon: L.divIcon({ className: 'mk', html: `<span style="background:${i === 0 ? '#2e7d32' : i === wps.length - 1 ? '#c62828' : '#1565c0'}">${i === 0 ? 'S' : i === wps.length - 1 ? 'Z' : i}</span>`, iconSize: [26, 26], iconAnchor: [13, 13] }) }).addTo(mk);
      m.on('dragend', async () => { const ll = m.getLatLng(); wps[i] = { lat: ll.lat, lon: ll.lng }; if (i > 0) await routeLeg(i - 1); if (i < wps.length - 1) await routeLeg(i); redraw(); });
      m.on('contextmenu', async () => { wps.splice(i, 1); await rebuild(); });
    });
    const st = Geo.stats(pts.map(p => ({ lat: p.lat, lon: p.lon, ele: p.ele, t: null })));
    const hrs = st.dist / 1000 / ({ hike: 4.5, walk: 4.8, run: 9, mtb: 14, bike: 16, ebike: 20, racebike: 24, ski: 5 }[sport] || 5) + st.up / ({ hike: 500, walk: 500, run: 700, ski: 400 }[sport] || 900);
    info.innerHTML = '';
    [[F.km(st.dist), 'Strecke'], ['↑ ' + F.m(st.up), 'Aufstieg'], ['↓ ' + F.m(st.down), 'Abstieg'], [F.dur(hrs * 3600), 'Geschätzte Zeit']].forEach(([v, l]) => info.append(h('div', null, h('b', null, v), h('small', null, l))));
    if (pts.length > 1) MapKit.profile(prof, pts, null); else prof.getContext('2d').clearRect(0, 0, prof.width, prof.height);
    hint.style.display = wps.length ? 'none' : '';
  }
  async function undo() { if (!wps.length) return; wps.pop(); legs.pop(); redraw(); }
  map.on('click', e => addWp(e.latlng));

  const hint = h('p', { class: 'muted' }, 'Tippe auf die Karte, um Start, Zwischenpunkte und Ziel zu setzen. Marker lassen sich verschieben, langes Drücken (Rechtsklick) löscht einen Punkt.');
  const sel = h('select', { 'aria-label': 'Sportart', onchange: async e => { sport = e.target.value; if (snap && wps.length > 1) await rebuild(); } }, Sports.list.filter(s => ['hike', 'walk', 'run', 'mtb', 'bike', 'ebike', 'racebike', 'ski'].includes(s[0])).map(s => h('option', { value: s[0], selected: s[0] === sport }, s[2] + ' ' + s[1])));
  const snapCb = h('input', { type: 'checkbox', checked: true, onchange: async e => { snap = e.target.checked; if (wps.length > 1) await rebuild(); } });
  panel.append(h('div', { class: 'row' }, sel, h('label', { class: 'sw' }, snapCb, ' Wegen folgen')), info, prof, hint,
    h('div', { class: 'row wrap' },
      h('button', { class: 'btn sm', onclick: async () => { if (wps.length > 1) { wps.push({ lat: wps[0].lat, lon: wps[0].lon }); await routeLeg(wps.length - 2); redraw(); } } }, '⟲ Rundtour'),
      h('button', { class: 'btn sm', onclick: async () => { wps.reverse(); await rebuild(); } }, '⇄ Umkehren'),
      h('button', { class: 'btn sm', onclick: async () => { if (await confirmBox('Alles löschen?', 'Die Planung wird zurückgesetzt.', 'Löschen')) { wps = []; legs = []; redraw(); } } }, '🗑 Leeren'),
      h('button', { class: 'btn sm', onclick: exportGpx }, '📤 GPX')),
    h('div', { class: 'row' }, h('button', { class: 'btn pri grow', onclick: save }, editing ? 'Änderungen speichern' : 'Tour speichern'), h('button', { class: 'btn grow', onclick: saveAndGo }, '● Speichern & starten')));
  void chips; void profileName;

  async function pointsOrWarn() { const p = allPts(); if (p.length < 2) { toast('Bitte mindestens zwei Punkte setzen.'); return null; } return p; }
  async function save(go) {
    const pts = await pointsOrWarn(); if (!pts) return null;
    const nm = await askText('Name der Tour', 'Name', name || (Sports.label(sport) + ' ' + F.dshort(Date.now())), 'Speichern'); if (!nm) return null;
    if (editing) await Tours.remove(editing.id);
    const r = await Tours.add({ id: editing && editing.id, name: nm.trim(), sport, pts: pts.map(p => ({ lat: p.lat, lon: p.lon, ele: p.ele, t: null })), status: 'planned', src: 'plan' });
    await DB.kvSet('plan:' + r.tour.id, { wps });
    toast('Gespeichert ✓');
    if (go === true) return r.tour; Nav.go('/tour/' + r.tour.id); return r.tour;
  }
  async function saveAndGo() { const t = await save(true); if (t) startWith(t, await Tours.points(t.id)); }
  async function exportGpx() {
    const pts = await pointsOrWarn(); if (!pts) return;
    const nm = (name || 'Planung ' + F.dshort(Date.now())).replace(/[^\wäöüÄÖÜß -]/g, '_') + '.gpx';
    try { toast('Gespeichert: ' + await Native.json('saveFile', { name: nm, mime: 'application/gpx+xml', text: Geo.gpx(name || 'Planung', sport, pts) })); } catch (e) { toast(e.message); }
  }
  if (wps.length > 1) await rebuild(); else redraw();
  if (editing && wps.length) map.fitBounds(L.latLngBounds(wps.map(w => [w.lat, w.lon])), { padding: [40, 40] });
  return () => map.remove();
};
