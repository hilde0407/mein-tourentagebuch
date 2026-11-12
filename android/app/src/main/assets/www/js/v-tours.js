'use strict';
const TourUI = { filter: { q: '', sport: '', fav: false, planned: false, year: '', region: '' } };

/** Umriss der Strecke als kleines Bild. `box` setzt die Größe (Vorgabe: Kachel in der Liste). */
function previewSvg(pts, color, box) {
  const W = (box && box.w) || 84, H = (box && box.h) || 64, pad = (box && box.pad) || 8, sw = (box && box.sw) || 2.4;
  const sp = Geo.simplify(pts, Math.max(5, Geo.dist(pts[0].lat, pts[0].lon, pts[pts.length - 1].lat, pts[pts.length - 1].lon) / 200 || 5));
  const b = Geo.bbox(sp), k = Math.cos((b[0] + b[2]) / 2 * Math.PI / 180);
  const w = (b[3] - b[1]) * k || 1e-5, hh = (b[2] - b[0]) || 1e-5, s = Math.min((W - pad * 2) / w, (H - pad * 2) / hh);
  const ox = (W - w * s) / 2, oy = (H - hh * s) / 2;
  const d = sp.map((p, i) => (i && !p.newSeg ? 'L' : 'M') + (ox + (p.lon - b[1]) * k * s).toFixed(1) + ' ' + (oy + (b[2] - p.lat) * s).toFixed(1)).join('');
  let ends = '';
  if (box && box.ends) {
    const at = p => [ox + (p.lon - b[1]) * k * s, oy + (b[2] - p.lat) * s], a = at(sp[0]), z = at(sp[sp.length - 1]), r = box.ends;
    ends = `<circle cx="${a[0].toFixed(1)}" cy="${a[1].toFixed(1)}" r="${r}" fill="${box.endsA || '#fff'}" stroke="${color}" stroke-width="${(r / 2.2).toFixed(1)}"/><circle cx="${z[0].toFixed(1)}" cy="${z[1].toFixed(1)}" r="${r}" fill="${color}" stroke="${box.endsA || '#fff'}" stroke-width="${(r / 2.2).toFixed(1)}"/>`;
  }
  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true"><path d="${d}" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"/>${ends}</svg>`;
}

Views['/'] = async root => {
  const F_ = TourUI.filter;
  const all = (await Tours.list()).filter(t => !t.hidden);
  const photos = await DB.all('photos');
  const pc = {}; photos.forEach(p => { if (p.tour) pc[p.tour] = (pc[p.tour] || 0) + 1; });
  const years = [...new Set(all.map(t => new Date(t.start).getFullYear()))].sort((a, b) => b - a);
  const cells = await DB.kvGet('regionCells', {});
  const stageOf = {};      // Tour-ID → „Tag 2 · Etappe 2/5“ (kommt etwas später, weil die Zielpunkte erst gelesen werden)
  const list = h('div', { class: 'cards' }), sum = h('div', { class: 'sumline' });
  const chips = h('div', { class: 'chips' });
  const io = new IntersectionObserver(es => es.forEach(async e => {
    if (!e.isIntersecting) return; io.unobserve(e.target);
    const t = e.target.__t, pts = await Tours.points(t.id);
    if (pts.length > 1) e.target.innerHTML = previewSvg(pts, MapKit.routeColor(t.sport, '#2e7d32'));
  }), { rootMargin: '200px' });
  const q = h('input', { type: 'search', placeholder: 'Touren suchen …', value: F_.q, 'aria-label': 'Suchen', oninput: e => { F_.q = e.target.value; draw(); } });
  const yearSel = h('select', { 'aria-label': 'Jahr', onchange: e => { F_.year = e.target.value; draw(); } }, h('option', { value: '' }, 'Alle Jahre'), years.map(y => h('option', { value: y, selected: String(y) === String(F_.year) }, y)));
  const regSel = h('select', { 'aria-label': 'Region', onchange: e => { F_.region = e.target.value; draw(); } });
  const fillRegions = () => {
    const n = {}; all.forEach(t => { const r = Reisen.regionOf(t, cells); if (r) n[r] = (n[r] || 0) + 1; });
    regSel.innerHTML = ''; regSel.append(h('option', { value: '' }, 'Alle Regionen'), ...Object.keys(n).sort((a, b) => a.localeCompare(b, 'de')).map(r => h('option', { value: r, selected: r === F_.region }, r + ' (' + n[r] + ')')));
    regSel.hidden = Object.keys(n).length < 2;
  };
  const draw = () => {
    chips.innerHTML = '';
    const chip = (label, on, fn) => chips.append(h('button', { class: 'chip' + (on ? ' on' : ''), onclick: fn }, label));
    chip('Alle', !F_.sport && !F_.fav && !F_.planned, () => { Object.assign(F_, { sport: '', fav: false, planned: false }); draw(); });
    chip('★ Favoriten', F_.fav, () => { F_.fav = !F_.fav; draw(); });
    chip('✏️ Geplant', F_.planned, () => { F_.planned = !F_.planned; draw(); });
    const used = [...new Set(all.map(t => t.sport))];
    Sports.list.filter(s => used.includes(s[0])).forEach(s => chip(s[2] + ' ' + s[1], F_.sport === s[0], () => { F_.sport = F_.sport === s[0] ? '' : s[0]; draw(); }));
    const ql = F_.q.trim().toLowerCase();
    const ts = all.filter(t => (F_.planned ? t.status === 'planned' : t.status !== 'planned') && (!F_.sport || t.sport === F_.sport) && (!F_.fav || t.fav)
      && (!F_.year || String(new Date(t.start).getFullYear()) === String(F_.year)) && (!F_.region || Reisen.regionOf(t, cells) === F_.region) && (!ql || (t.name + ' ' + (t.note || '') + ' ' + Sports.label(t.sport)).toLowerCase().includes(ql)));
    list.innerHTML = '';
    const d = ts.reduce((a, t) => a + t.dist, 0), u = ts.reduce((a, t) => a + (t.up || 0), 0);
    sum.textContent = ts.length ? `${ts.length} ${ts.length === 1 ? 'Tour' : 'Touren'} · ${F.km(d)} · ${F.m(u)} Aufstieg` : '';
    if (!ts.length) {
      list.append(all.length ? h('div', { class: 'empty' }, h('p', null, 'Keine Tour passt zu diesem Filter.')) :
        h('div', { class: 'empty hero' }, h('div', { class: 'big' }, '⛰️'), h('h2', null, 'Willkommen im Tourentagebuch'), h('p', null, 'Alle Touren und Fotos bleiben auf deinem Handy. Hol deine bisherigen Touren herein oder starte gleich eine neue.'),
          h('div', { class: 'col' }, h('a', { class: 'btn pri', href: '#/import' }, '📥 Touren importieren'), h('a', { class: 'btn', href: '#/rec' }, '● Aufzeichnung starten'), h('a', { class: 'btn', href: '#/plan' }, '✏️ Tour planen'))));
      return;
    }
    let lastMonth = '';
    ts.forEach(t => {
      const mo = new Date(t.start).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
      if (mo !== lastMonth) { lastMonth = mo; list.append(h('h3', { class: 'month' }, mo)); }
      const pv = h('div', { class: 'pv' }); pv.__t = t; io.observe(pv);
      list.append(h('a', { class: 'card tour', href: '#/tour/' + t.id },
        pv, h('div', { class: 'tb' }, h('b', null, (t.fav ? '★ ' : '') + t.name),
          h('small', null, Sports.label(t.sport) + ' · ' + F.date(t.start) + (t.timed ? ' · ' + F.time(t.start) : '')),
          stageOf[t.id] ? h('small', { class: 'stage' }, '🥾 ' + stageOf[t.id]) : null,
          h('div', { class: 'met' }, h('span', null, F.km(t.dist)), t.up ? h('span', null, '↑ ' + F.m(t.up)) : null, t.dur ? h('span', null, '⏱ ' + F.dur(t.dur)) : null,
            pc[t.id] ? h('span', null, '🖼 ' + pc[t.id]) : null, t.hrAvg ? h('span', { class: 'hrt', title: 'Pulsdaten vorhanden' }, '♥ ' + t.hrAvg) : null))));
    });
  };
  root.append(topbar('Tourentagebuch'), h('div', { class: 'filters' }, h('div', { class: 'row' }, q, yearSel), h('div', { class: 'row' }, regSel), chips, sum), list,
    h('a', { class: 'fab', href: '#/import', 'aria-label': 'Touren importieren' }, '＋'));
  fillRegions(); draw();
  let gone = false;
  Reisen.resolveRegions(all, cells, () => { if (!gone) { fillRegions(); if (F_.region) draw(); } }, () => gone);
  Reisen.multiday(all).then(ms => { if (gone || !ms.length) return; ms.forEach(r => r.tours.forEach(q => { stageOf[q.id] = Reisen.stage(r, q); })); draw(); }).catch(() => {});
  return () => { gone = true; io.disconnect(); };
};

Views['/tour'] = async (root, [id]) => {
  const t = await DB.get('tours', id);
  if (!t) { root.append(topbar('Tour', { back: true }), h('div', { class: 'empty' }, h('p', null, 'Diese Tour gibt es nicht mehr.'))); return; }
  const pts = await Tours.points(id);
  let photos = (await DB.byIndex('photos', 'tour', id)).sort((a, b) => a.ts - b.ts);
  const mapEl = h('div', { class: 'map tmap' });
  const body = h('div', { class: 'pad' });
  const title = h('h1', { onclick: rename }, t.name);
  root.append(h('header', { class: 'top' }, h('button', { class: 'ico', 'aria-label': 'Zurück', onclick: () => Nav.back() }, '←'), title, h('span', { class: 'sp' }),
    h('button', { class: 'ico', 'aria-label': 'Favorit', onclick: async () => { t.fav = !t.fav; await Tours.save(t); fav.textContent = t.fav ? '★' : '☆'; } }, h('span', { id: 'fav' }, t.fav ? '★' : '☆')),
    h('button', { class: 'ico', 'aria-label': 'Aktionen', onclick: actions }, '⋮')), mapEl, body);
  const fav = $('#fav');
  async function rename() { const n = await askText('Name der Tour', 'Name', t.name, 'Speichern'); if (n && n.trim()) { t.name = n.trim(); await Tours.save(t); title.textContent = t.name; } }

  const map = MapKit.create(mapEl);
  const layer = MapKit.line(pts, MapKit.routeColor(t.sport, '#2e7d32'), 5).addTo(map);
  if (pts.length) {
    MapKit.dot(pts[0].lat, pts[0].lon, '#2e7d32', 'S').addTo(map); MapKit.dot(pts[pts.length - 1].lat, pts[pts.length - 1].lon, '#c62828', 'Z').addTo(map);
    map.fitBounds(layer.getBounds(), { padding: [24, 24] });
  }
  const cursor = L.circleMarker([0, 0], { radius: 7, color: '#fff', weight: 2, fillColor: '#1565c0', fillOpacity: 1 });
  const pm = L.layerGroup().addTo(map);
  const drawPhotos = () => { pm.clearLayers(); photos.filter(p => p.lat != null).forEach(p => MapKit.photoMarker(p, () => Lightbox.open(photos, photos.indexOf(p))).addTo(pm)); };
  drawPhotos();
  setTimeout(() => { try { if (map.getContainer().isConnected) map.invalidateSize(); } catch (e) { /* Ansicht schon verlassen */ } }, 200);

  const grid = h('div', { class: 'stats' });
  const st = (v, l) => h('div', null, h('b', null, v), h('small', null, l));
  grid.append(st(F.km(t.dist), 'Strecke'), st(t.dur ? F.dur(t.dur) : '–', 'Dauer'), st(t.moving ? F.dur(t.moving) : '–', 'In Bewegung'),
    st(F.m(t.up), 'Aufstieg'), st(F.m(t.down), 'Abstieg'), st(t.maxAlt != null ? F.m(t.maxAlt) : '–', 'Höchster Punkt'),
    st(t.moving ? F.speed(t.dist, t.moving) : '–', 'Ø Tempo'), st(t.minAlt != null ? F.m(t.minAlt) : '–', 'Tiefster Punkt'));
  if (t.hrAvg) grid.append(st(t.hrAvg + ' bpm', 'Ø Puls'), st(t.hrMax + ' bpm', 'Höchster Puls'));
  const prof = h('canvas', { class: 'prof', 'aria-label': 'Höhenprofil' });
  const profInfo = h('small', { class: 'muted' }, 'Profil berühren, um die Stelle auf der Karte zu sehen.');
  const strip = h('div', { class: 'strip' });
  const drawStrip = () => {
    strip.innerHTML = '';
    photos.forEach((p, i) => strip.append(h('button', { class: 'th', 'aria-label': 'Foto ' + (i + 1), onclick: () => Lightbox.open(photos, i) }, h('img', { src: Photos.thumb(p.id), alt: '', loading: 'lazy' }))));
  };
  const stageBox = h('div');
  Tours.list().then(all => Reisen.multiday(all)).then(ms => {      // Teil einer Mehrtagestour? Dann „Tag 2 · Etappe 2/5“ mit Link zur Gruppe
    const r = ms.find(x => x.tours.some(q => q.id === t.id));
    if (r) stageBox.append(h('a', { class: 'banner stagechip', id: 'stage', href: '#/reise/' + r.id }, '🥾 ' + Reisen.stage(r, t) + ' · Mehrtagestour ' + Reisen.range(r.first, r.last)));
  }).catch(() => {});
  const note = h('textarea', { rows: 3, placeholder: 'Notizen zur Tour …', onchange: async e => { t.note = e.target.value; await Tours.save(t); } }, t.note || '');
  const photoHead = h('div', { class: 'row' }, h('h3', { style: { flex: 1 } }, 'Fotos'), h('button', { class: 'btn sm', id: 'tshow', onclick: () => Show.open(photos.map(p => Object.assign({ tourName: t.name }, p))) }, '▶ Diashow'), h('button', { class: 'btn sm', onclick: addPhotos }, '＋ Fotos'));
  body.append(...[stageBox, Fix.suspicious(t) && !t.elevFix ? h('div', { class: 'banner' }, '⛰️ Der Aufstieg wirkt zu hoch (' + F.m(t.up) + ' auf ' + F.km(t.dist) + ').', h('div', { class: 'row' }, h('button', { class: 'btn pri sm', id: 'fixbanner', onclick: fixEle }, 'Höhen korrigieren'))) : null,
    t.status === 'planned' ? h('div', { class: 'banner' }, '✏️ Geplante Tour', h('div', { class: 'row' }, h('a', { class: 'btn pri sm', href: '#/plan/' + t.id }, 'Im Planer öffnen'), h('button', { class: 'btn sm', onclick: () => startWith(t, pts) }, '● Mit Ansagen starten'))) : null,
    h('div', { class: 'sub' }, Sports.icon(t.sport) + ' ' + Sports.label(t.sport) + ' · ' + F.date(t.start) + (t.timed ? ' · ' + F.time(t.start) + '–' + F.time(t.end) : '') + (t.src && t.src !== 'file' ? ' · ' + ({ komoot: 'Komoot', strava: 'Strava', zepp: 'Zepp', rec: 'Aufzeichnung', plan: 'Planer', link: 'Link' }[t.src] || t.src) : '')),
    (t.tags || []).length ? h('div', { class: 'chips wrap' }, t.tags.map(g => h('a', { class: 'chip', href: '#/album/' + encodeURIComponent(g) }, g))) : null,
    grid, h('h3', null, 'Höhenprofil'), prof, profInfo, t.hrAvg ? pulsBlock() : null, photoHead, strip, h('h3', null, 'Notizen'), note].filter(Boolean));
  drawStrip();
  const xs = MapKit.profile(prof, pts, (i, o) => {
    if (i == null) { map.removeLayer(cursor); profInfo.textContent = ''; return; }
    cursor.setLatLng([pts[i].lat, pts[i].lon]).addTo(map);
    profInfo.textContent = `${F.km(o.dist)} · ${o.ele != null ? Math.round(o.ele) + ' m' : '–'}` + (pts[i].t ? ' · ' + F.time(pts[i].t) : '') + (o.hr ? ' · ♥ ' + o.hr + ' bpm' : '');
  });
  const onresize = () => MapKit.profile(prof, pts, null); void onresize;

  /** „Zeit in den Pulszonen“ und ein Schalter, der die Strecke nach Puls einfärbt. */
  function pulsBlock() {
    const bars = h('div', { class: 'hbars' });
    const tot = (t.hrZones || []).reduce((a, b) => a + b, 0) || 1;
    (t.hrZones || []).forEach((sec, i) => {
      if (!sec) return;
      bars.append(h('div', { class: 'hb' }, h('span', null, MapKit.hrName[i]),
        h('div', null, h('i', { style: { width: (sec / tot * 100).toFixed(1) + '%', background: MapKit.hrColor[i] } })), h('span', null, F.dur(sec))));
    });
    let hrLayer = null;
    const sw = h('label', { class: 'sw' }, h('input', {
      type: 'checkbox', onchange: e => {
        if (e.target.checked) { map.removeLayer(layer); hrLayer = MapKit.lineHr(pts, 5).addTo(map); }
        else { if (hrLayer) map.removeLayer(hrLayer); layer.addTo(map); }
      },
    }), 'Strecke nach Puls einfärben');
    return h('div', null, h('h3', null, 'Puls'),
      h('div', { class: 'sub' }, `Ø ${t.hrAvg} · höchstens ${t.hrMax} · mindestens ${t.hrMin} bpm`), bars, h('div', { class: 'row' }, sw));
  }

  async function addPhotos() { PhotoSources.sheet(t, async () => { photos = (await DB.byIndex('photos', 'tour', id)).sort((a, b) => a.ts - b.ts); drawStrip(); drawPhotos(); }); }
  function actions() {
    const it = (ico, tx, fn) => h('button', { class: 'li', onclick: () => { s.close(); fn(); } }, h('span', { class: 'li-i' }, ico), h('span', { class: 'li-t' }, h('b', null, tx)));
    const s = sheet('Tour', h('div', { class: 'list' },
      it('✏️', 'Umbenennen', rename),
      it('🚁', '3D-Flug über die Tour', () => Nav.go('/flug/' + id)),
      it('📖', 'Erzählung', () => Nav.go('/story/' + id)),
      it('💡', 'Namensvorschläge', suggestNames),
      it('🏷️', 'Sportart ändern', changeSport),
      it('🧳', 'Tags & Alben', () => Reisen.editTags(t, () => Nav.render())),
      it('📤', 'Als GPX speichern', exportGpx),
      it('🔗', 'Zusammenfassung teilen', () => { const txt = `${t.name}\n${F.date(t.start)} · ${F.km(t.dist)} · ↑ ${F.m(t.up)} · ${F.dur(t.dur)}`; if (window.MTApp) MTApp.shareText(txt); else navigator.clipboard && navigator.clipboard.writeText(txt); }),
      it('🧭', 'Als Route nachgehen (mit Ansagen)', () => startWith(t, pts)),
      it('📷', 'Fotos aus der Galerie suchen', async () => { const n = await PhotoSources.galleryForTours([t]); toast(n + ' Foto(s) gefunden'); photos = (await DB.byIndex('photos', 'tour', id)).sort((a, b) => a.ts - b.ts); drawStrip(); drawPhotos(); }),
      it('⛰️', t.elevFix ? 'Höhen neu aus Gelände berechnen' : 'Höhen korrigieren (Geländemodell)', fixEle),
      it('🛠️', 'GPS-Track korrigieren', () => Nav.go('/fix/' + id)),
      t.elevFix ? it('↩️', 'Originalhöhen wiederherstellen', async () => { Object.assign(t, await Fix.restoreEle(t)); toast('Originalhöhen wiederhergestellt'); Nav.render(); }) : null,
      it('🔄', 'Kennzahlen neu berechnen', async () => { Object.assign(t, await Tours.recalc(id)); toast('Neu berechnet'); Nav.render(); }),
      it('🗑️', 'Löschen', async () => { if (await confirmBox('Tour löschen?', `„${t.name}“ wird von diesem Handy gelöscht. Die Fotos bleiben erhalten.`, 'Löschen')) { await Tours.remove(id); Nav.go('/'); } })));
  }
  async function suggestNames() {
    const box = h('div', { class: 'list' }, h('p', { class: 'muted' }, 'Orte werden gesucht …'));
    const s = sheet('Namensvorschläge', box);
    try {
      const l = await Suggest.names(t, pts);
      box.innerHTML = '';
      if (!l.length) box.append(h('p', { class: 'muted' }, 'Keine Vorschläge gefunden.'));
      l.forEach(n => box.append(h('button', { class: 'li sugg', onclick: async () => { t.name = n; await Tours.save(t); s.close(); Nav.render(); toast('Umbenannt'); } }, h('span', { class: 'li-t' }, h('b', null, n)))));
    } catch (e) { box.innerHTML = ''; box.append(h('p', { class: 'muted' }, 'Nicht möglich: ' + e.message + ' (Internet nötig).')); }
  }
  async function fixEle() {
    toast('Höhen werden aus dem Gelände berechnet …');
    try { const o = t.up; Object.assign(t, await Fix.demFix(t)); toast(`Aufstieg ${F.m(o)} → ${F.m(t.up)}`); Nav.render(); }
    catch (e) { toast('Nicht möglich: ' + e.message); }
  }
  async function changeSport() {
    const s = sheet('Sportart', h('div', { class: 'list' }, Sports.list.map(sp => h('button', { class: 'li', onclick: async () => { t.sport = sp[0]; await Tours.save(t); s.close(); Nav.render(); } }, h('span', { class: 'li-i' }, sp[2]), h('span', { class: 'li-t' }, h('b', null, sp[1]))))));
  }
  async function exportGpx() {
    const wp = photos.filter(p => p.lat != null).map(p => ({ lat: p.lat, lon: p.lon, name: p.name }));
    const name = t.name.replace(/[^\wäöüÄÖÜß -]/g, '_') + '.gpx';
    try { const r = await Native.json('saveFile', { name, mime: 'application/gpx+xml', text: Geo.gpx(t.name, t.sport, pts, wp) }); toast('Gespeichert: ' + r); }
    catch (e) { const a = h('a', { href: URL.createObjectURL(new Blob([Geo.gpx(t.name, t.sport, pts)], { type: 'application/gpx+xml' })), download: name }); document.body.append(a); a.click(); a.remove(); }
  }
};

/** Route an die Hülle geben (Sprachansagen) und zur Aufzeichnung wechseln. */
function startWith(t, pts) {
  if (!window.MTApp) { toast('Ansagen gibt es nur in der Android-App'); Nav.go('/rec'); return; }
  const sp = Geo.simplify(pts, 3);
  MTApp.setRoute(sp.map(p => p.lat.toFixed(6) + ',' + p.lon.toFixed(6)).join(';'), t.name);
  sessionStorage.setItem('recSport', t.sport); sessionStorage.setItem('recName', t.name);
  Nav.go('/rec');
}
