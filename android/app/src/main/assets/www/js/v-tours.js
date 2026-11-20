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

/** Erstes Foto der Tour ohne erkanntes Gesicht (höchstens 4 prüfen; -1 = unbekannt zählt als brauchbar). Null, wenn keins taugt. */
async function pickPhoto(tid) {
  const ps = (await DB.byIndex('photos', 'tour', tid)).filter(p => !p.video).sort((a, b) => a.ts - b.ts);
  for (const p of ps.slice(0, 4)) {
    let n = p.faces;
    if (n == null) {
      try {
        n = parseInt(await Native.call('photoFaces', { id: p.id }), 10);
        if (isNaN(n)) n = -1;
        const cur = await DB.get('photos', p.id);   // frisch lesen, damit keine zwischenzeitliche Änderung überschrieben wird
        if (cur) { cur.faces = n; await DB.put('photos', cur); }
      } catch (e) { n = -1; }                        // keine Hülle / Fehler: nicht merken, später neu versuchen
    }
    if (!(n >= 1)) return p;
  }
  return null;
}

/** Kartenausschnitt mit Track als JPEG-dataURL; wirft bei jedem Problem (offline, fehlende Kachel), dann bleibt es bei der Zeichnung.
    o: { w, h, pad, padTop, padBottom } – mit größerem unteren Rand rückt die Strecke nach oben (Platz für Schrift auf dem Bild). */
async function tileMapImage(t, pts, o) {
  o = o || {};
  const W = o.w || 560, H = o.h || 224, pad = o.pad || 28, pT = o.padTop != null ? o.padTop : pad, pB = o.padBottom != null ? o.padBottom : pad, T = 256;
  MapKit.init();
  const lay = MapKit.layer(), tpl = lay._url, zmax = Math.min(15, lay.options.maxZoom || 15);
  if (!window.caches || /\{s\}/.test(tpl)) throw 0;
  const sp = Geo.simplify(pts, 5), b = Geo.bbox(sp);
  const wx = (lon, z) => (lon + 180) / 360 * T * 2 ** z;
  const wy = (lat, z) => (1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * T * 2 ** z;
  let z = zmax;
  while (z > 3 && (wx(b[3], z) - wx(b[1], z) > W - pad * 2 || wy(b[0], z) - wy(b[2], z) > H - pT - pB)) z--;
  const ox = (wx(b[1], z) + wx(b[3], z)) / 2 - W / 2, oy = (wy(b[0], z) + wy(b[2], z)) / 2 - (pT + (H - pT - pB) / 2), n = 2 ** z;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d'), c = await caches.open(MapKit.cacheName), jobs = [];
  for (let x = Math.floor(ox / T); x <= Math.floor((ox + W - 1) / T); x++) for (let y = Math.floor(oy / T); y <= Math.floor((oy + H - 1) / T); y++) {
    if (y < 0 || y >= n) continue;
    const url = tpl.replace('{z}', z).replace('{x}', ((x % n) + n) % n).replace('{y}', y);
    jobs.push((async () => {
      let r = await c.match(url);
      if (!r) { r = await fetch(url, { mode: 'cors' }); if (!r.ok) throw 0; c.put(url, r.clone()).catch(() => {}); }
      const bmp = await createImageBitmap(await r.blob());
      g.drawImage(bmp, Math.round(x * T - ox), Math.round(y * T - oy)); if (bmp.close) bmp.close();
    })());
  }
  await Promise.all(jobs);
  const at = p => [wx(p.lon, z) - ox, wy(p.lat, z) - oy], col = MapKit.routeColor(t.sport, '#2e7d32');
  g.fillStyle = 'rgba(10,30,31,' + (o.dim != null ? o.dim : .18) + ')'; g.fillRect(0, 0, W, H);
  g.lineCap = g.lineJoin = 'round';
  const line = (w, st) => { g.beginPath(); sp.forEach((p, i) => { const q = at(p); if (i && !p.newSeg) g.lineTo(q[0], q[1]); else g.moveTo(q[0], q[1]); }); g.lineWidth = w; g.strokeStyle = st; g.stroke(); };
  const lw = W / 560;      // Strichstärken wachsen mit dem Bild
  line(8 * lw, '#fff'); line(4.5 * lw, col);
  [[sp[0], '#fff', col], [sp[sp.length - 1], col, '#fff']].forEach(([p, f, s]) => { const q = at(p); g.beginPath(); g.arc(q[0], q[1], 7 * lw, 0, 7); g.fillStyle = f; g.fill(); g.lineWidth = 3 * lw; g.strokeStyle = s; g.stroke(); });
  return cv.toDataURL('image/jpeg', 0.72);
}

Views['/'] = async root => {
  const F_ = TourUI.filter;
  const all = (await Tours.list()).filter(t => !t.hidden);
  const photos = await DB.all('photos');
  const pc = {}; photos.forEach(p => { if (p.tour) pc[p.tour] = (pc[p.tour] || 0) + 1; });
  const years = [...new Set(all.map(t => new Date(t.start).getFullYear()))].sort((a, b) => b - a);
  const cells = await DB.kvGet('regionCells', {});
  const stageOf = {};      // Tour-ID → „Tag 2 · Etappe 2/5“ (kommt etwas später, weil die Zielpunkte erst gelesen werden)
  const list = h('div', { class: 'tours' }), sum = h('div', { class: 'sumline' });
  const chips = UI.chips([]);
  // Miniaturen: Foto, sonst die Strecke. Die Wahl je Tour wird gemerkt, damit die Liste beim nächsten Mal sofort steht.
  const tilebg = await DB.kvGet('tilebg', {});
  let saveT = 0;
  const saveBg = () => { if (!saveT) saveT = setTimeout(() => { saveT = 0; DB.kvSet('tilebg', tilebg).catch(() => {}); }, 1500); };
  const io = new IntersectionObserver(es => es.forEach(e => {
    if (!e.isIntersecting) return; io.unobserve(e.target);
    UI.thumb(e.target, e.target.__t, tilebg, saveBg).catch(() => { /* Zeile bleibt ohne Bild */ });
  }), { rootMargin: '300px' });
  const q = h('input', { type: 'search', placeholder: 'Touren suchen …', value: F_.q, 'aria-label': 'Touren suchen', oninput: e => { F_.q = e.target.value; draw(); } });
  // Selten gebraucht (Jahr, Region): hinter „Filter“, der Zähler zeigt, wie viele davon gesetzt sind
  const yearSel = h('select', { 'aria-label': 'Jahr', onchange: e => { F_.year = e.target.value; draw(); } }, h('option', { value: '' }, 'Alle Jahre'), years.map(y => h('option', { value: y, selected: String(y) === String(F_.year) }, y)));
  const regSel = h('select', { 'aria-label': 'Region', onchange: e => { F_.region = e.target.value; draw(); } });
  const regFld = h('label', { class: 'fld' }, 'Region', regSel);
  const fbtn = h('button', { class: 'btn sm fbtn', id: 'filterbtn', onclick: filterSheet });
  const fillRegions = () => {
    const n = {}; all.forEach(t => { const r = Reisen.regionOf(t, cells); if (r) n[r] = (n[r] || 0) + 1; });
    regSel.innerHTML = ''; regSel.append(h('option', { value: '' }, 'Alle Regionen'), ...Object.keys(n).sort((a, b) => a.localeCompare(b, 'de')).map(r => h('option', { value: r, selected: r === F_.region }, r + ' (' + n[r] + ')')));
    regSel.hidden = regFld.hidden = Object.keys(n).length < 2;
  };
  function filterSheet() {
    const s = sheet('Filter', h('div', null, h('label', { class: 'fld' }, 'Jahr', yearSel), regFld,
      regSel.hidden ? h('p', { class: 'muted small' }, 'Regionen erscheinen hier, sobald Touren in mindestens zwei Gebieten liegen.') : null,
      h('div', { class: 'row end' },
        h('button', { class: 'btn', onclick: () => { F_.year = ''; F_.region = ''; yearSel.value = ''; regSel.value = ''; draw(); } }, 'Zurücksetzen'),
        h('button', { class: 'btn pri', id: 'filterok', onclick: () => s.close() }, 'Fertig'))));
  }
  function addMenu() {
    UI.menu('Neue Tour', [
      ['route', 'Tour planen', () => Nav.go('/plan'), 'Route auf der Karte zeichnen', 'newplan'],
      ['download', 'Touren importieren', () => Nav.go('/import'), 'Dateien, Komoot, Strava, Zepp, Bosch Flow, Garmin', 'newimport'],
      ['rec', 'Aufzeichnung starten', () => Nav.go('/rec'), 'Mit GPS mitschreiben', 'newrec']]);
  }
  const draw = () => {
    chips.innerHTML = '';
    const chip = (label, on, fn) => chips.append(UI.chip(label, on, fn));
    chip('Alle', !F_.sport && !F_.fav && !F_.planned, () => { Object.assign(F_, { sport: '', fav: false, planned: false }); draw(); });
    chip('★ Favoriten', F_.fav, () => { F_.fav = !F_.fav; draw(); });
    chip('Geplant', F_.planned, () => { F_.planned = !F_.planned; draw(); });
    const used = [...new Set(all.map(t => t.sport))];
    Sports.list.filter(s => used.includes(s[0])).forEach(s => chip(s[1], F_.sport === s[0], () => { F_.sport = F_.sport === s[0] ? '' : s[0]; draw(); }));
    const nf = (F_.year ? 1 : 0) + (F_.region ? 1 : 0);
    fbtn.innerHTML = Ico.svg('filter') + '<span>Filter</span>' + (nf ? '<i>' + nf + '</i>' : '');
    fbtn.setAttribute('aria-label', nf ? 'Filter, ' + nf + ' gesetzt' : 'Filter');
    const ql = F_.q.trim().toLowerCase();
    const ts = all.filter(t => (F_.planned ? t.status === 'planned' : t.status !== 'planned') && (!F_.sport || t.sport === F_.sport) && (!F_.fav || t.fav)
      && (!F_.year || String(new Date(t.start).getFullYear()) === String(F_.year)) && (!F_.region || Reisen.regionOf(t, cells) === F_.region) && (!ql || (t.name + ' ' + (t.note || '') + ' ' + Sports.label(t.sport)).toLowerCase().includes(ql)));
    list.innerHTML = '';
    const d = ts.reduce((a, t) => a + t.dist, 0), u = ts.reduce((a, t) => a + (t.up || 0), 0);
    sum.textContent = ts.length ? `${ts.length} ${ts.length === 1 ? 'Tour' : 'Touren'} · ${F.km(d)} · ↑ ${F.m(u)}` : '';
    if (!ts.length) {
      if (!all.length) list.append(welcomeHero());
      else if (F_.planned && !ql && !F_.sport && !F_.fav && !nf) list.append(UI.empty({ icon: 'route', title: 'Noch keine geplante Tour', text: 'Zeichne eine Route auf der Karte. Sie lässt sich später mit Ansagen nachgehen.', actions: [h('a', { class: 'btn pri', href: '#/plan' }, 'Tour planen')] }));
      else list.append(UI.empty({ icon: 'search', title: 'Keine Tour gefunden', text: 'Zu dieser Suche und diesen Filtern passt keine Tour.',
        actions: [h('button', { class: 'btn', onclick: () => { Object.assign(F_, { q: '', sport: '', fav: false, planned: false, year: '', region: '' }); q.value = ''; yearSel.value = ''; regSel.value = ''; draw(); } }, 'Suche und Filter zurücksetzen')] }));
      return;
    }
    const groups = []; let g = null;
    ts.forEach(t => {
      const mo = t.start ? new Date(t.start).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' }) : 'Ohne Datum';
      if (!g || g.mo !== mo) groups.push(g = { mo, ts: [] });
      g.ts.push(t);
    });
    groups.forEach(g => {
      list.append(h('h3', { class: 'month' }, g.mo, h('small', null, (g.ts.length === 1 ? '1 Tour' : g.ts.length + ' Touren') + ' · ' + F.km(g.ts.reduce((a, t) => a + t.dist, 0)))));
      g.ts.forEach(t => list.append(UI.tourRow(t, { io, photos: pc[t.id], stage: stageOf[t.id] })));
    });
  };
  root.append(topbar('Touren', { actions: [h('a', { class: 'btn sm hbtn', id: 'tomap', href: '#/map', html: Ico.svg('map') + '<span>Karte</span>' }),
    h('button', { class: 'ico', id: 'touradd', 'aria-label': 'Neue Tour: planen, importieren oder aufzeichnen', onclick: addMenu }, '＋')] }),
    h('div', { class: 'filters' }, h('div', { class: 'row' }, q, fbtn), chips, sum), list);
  fillRegions(); draw();
  let gone = false;
  Reisen.resolveRegions(all, cells, () => { if (!gone) { fillRegions(); if (F_.region) draw(); } }, () => gone);
  Reisen.multiday(all).then(ms => { if (gone || !ms.length) return; ms.forEach(r => r.tours.forEach(q => { stageOf[q.id] = Reisen.stage(r, q); })); draw(); }).catch(() => {});
  return () => { gone = true; io.disconnect(); };
};

Views['/tour'] = async (root, [id]) => {
  const t = await DB.get('tours', id);
  if (!t) { root.append(topbar('Tour', { back: true }), UI.empty({ title: 'Diese Tour gibt es nicht mehr', actions: [h('a', { class: 'btn', href: '#/' }, 'Zur Tourenliste')] })); return; }
  const pts = await Tours.points(id);
  let photos = (await DB.byIndex('photos', 'tour', id)).sort((a, b) => a.ts - b.ts);
  const mapEl = h('div', { class: 'map tmap under' });
  const body = h('div', { class: 'tourp' });
  const title = h('h1', null, t.name);
  // Die Knöpfe schweben auf der Karte; der Titel steht darunter auf dem Papier
  root.append(h('header', { class: 'top over' }, h('button', { class: 'ico', 'aria-label': 'Zurück', onclick: () => Nav.back() }, '←'), h('span', { class: 'sp' }),
    h('button', { class: 'ico', 'aria-label': 'Favorit', 'aria-pressed': t.fav ? 'true' : 'false', onclick: async e => { t.fav = !t.fav; await Tours.save(t); fav.textContent = t.fav ? '★' : '☆'; e.currentTarget.setAttribute('aria-pressed', t.fav ? 'true' : 'false'); toast(t.fav ? 'Als Favorit gemerkt' : 'Kein Favorit mehr'); } }, h('span', { id: 'fav' }, t.fav ? '★' : '☆')),
    h('button', { class: 'ico', 'aria-label': 'Aktionen', onclick: actions }, '⋮')), mapEl, body);
  const fav = $('#fav');
  async function rename() { const n = await askText('Name der Tour', 'Name', t.name, 'Speichern'); if (n && n.trim()) { t.name = n.trim(); await Tours.save(t); title.textContent = t.name; } }

  const map = MapKit.create(mapEl);
  const layer = MapKit.line(pts, MapKit.routeColor(t.sport, '#2e7d32'), 5).addTo(map);
  if (pts.length) {
    MapKit.dot(pts[0].lat, pts[0].lon, '#2e7d32', 'S').addTo(map); MapKit.dot(pts[pts.length - 1].lat, pts[pts.length - 1].lon, '#c62828', 'Z').addTo(map);
    map.fitBounds(layer.getBounds(), { paddingTopLeft: [28, 64], paddingBottomRight: [60, 28] });
  }
  const cursor = L.circleMarker([0, 0], { radius: 7, color: '#fff', weight: 2, fillColor: '#1565c0', fillOpacity: 1 });
  const pm = L.layerGroup().addTo(map);
  const drawPhotos = () => { pm.clearLayers(); photos.filter(p => p.lat != null).forEach(p => MapKit.photoMarker(p, () => Lightbox.open(photos, photos.indexOf(p))).addTo(pm)); };
  drawPhotos();
  (t.pins || []).filter(p => p.lat != null).forEach(p => MapKit.pin(p).addTo(pm));
  setTimeout(() => { try { if (map.getContainer().isConnected) map.invalidateSize(); } catch (e) { /* Ansicht schon verlassen */ } }, 200);

  /** Zahlen aus „Meine Touren“ (2.1.0), als leiser Satz unter den Angaben: Sind sie maßgeblich, steht die eigene Rechnung aus der Spur daneben – sonst nur, was Meine Touren nennt. */
  function mtInfo() {
    if (t.upMt == null && t.distMt == null && !t.starsMt) return null;
    const z = (up, dist) => [dist ? F.km(dist) : null, up != null ? '↑ ' + F.m(up) : null].filter(Boolean).join(' · ');
    const st = t.zMt ? Geo.stats(pts) : null, o = [];
    if (t.zMt) o.push('Strecke und Aufstieg stammen aus Meine Touren. Eigene Rechnung aus der Spur: ' + (z(Hoehe.brauchbar(st.nEle) ? st.up : null, st.dist) || '–') + '.');
    else if (t.upMt != null || t.distMt) o.push('Meine Touren nennt ' + z(t.upMt, t.distMt) + '.');
    if (t.starsMt) o.push('Bewertung in Meine Touren: ' + t.starsMt + ' von 5 Sternen.');
    return h('p', { class: 'muted small', id: 'mtinfo' }, o.join(' '));
  }
  // Die drei wichtigsten Zahlen groß, alles Weitere leise darunter
  const main = UI.figs([[F.km(t.dist), 'Strecke'], ['↑ ' + F.m(t.up), 'Aufstieg'], [t.dur ? F.dur(t.dur) : '–', 'Dauer']], { big: true, cls: 'tmain' });
  const more = UI.facts([['Abstieg', F.m(t.down)], ['In Bewegung', t.moving ? F.dur(t.moving) : '–'], ['Ø Tempo', t.moving ? F.speed(t.dist, t.moving) : '–'],
    ['Höchster Punkt', t.maxAlt != null ? F.m(t.maxAlt) : '–'], ['Tiefster Punkt', t.minAlt != null ? F.m(t.minAlt) : '–'],
    t.hrAvg ? ['Ø Puls', t.hrAvg + ' bpm'] : null, t.hrAvg ? ['Höchster Puls', t.hrMax + ' bpm'] : null,
    t.upKomoot != null && t.upSrc !== 'komoot' ? ['Komoot nennt', F.m(t.upKomoot)] : null]);
  const prof = h('canvas', { class: 'prof', 'aria-label': 'Höhenprofil' });
  const profInfo = h('small', { class: 'muted' }, 'Profil berühren, um die Stelle auf der Karte zu sehen.');
  const strip = h('div', { class: 'strip' }), noPhotos = h('p', { class: 'muted' }, 'Noch keine Fotos zu dieser Tour.');
  const showBtn = h('button', { class: 'btn sm', id: 'tshow', onclick: () => Show.open(photos.map(p => Object.assign({ tourName: t.name }, p)), { tour: t, pts }) }, '▶ Diashow');
  const drawStrip = () => {
    strip.innerHTML = '';
    photos.forEach((p, i) => strip.append(h('button', { class: 'th', 'aria-label': 'Foto ' + (i + 1), onclick: () => Lightbox.open(photos, i) }, h('img', { src: Photos.thumb(p.id), alt: '', loading: 'lazy' }))));
    strip.hidden = showBtn.hidden = !photos.length; noPhotos.hidden = !!photos.length;
  };
  const pinList = () => (t.pins || []).length ? UI.section('Pins', (t.pins || []).map(p => h('div', { class: 'pinrow' }, h('b', null, F.time(p.ts)), h('span', null, p.text || '(ohne Text)'), p.lat != null ? h('button', { class: 'btn sm', onclick: () => { map.setView([p.lat, p.lon], 17); mapEl.scrollIntoView({ block: 'start' }); } }, 'Auf Karte') : null)), { id: 'pins' }) : null;
  const stageBox = h('div');
  Tours.list().then(all => Reisen.multiday(all)).then(ms => {      // Teil einer Mehrtagestour? Dann „Tag 2 · Etappe 2/5“ mit Link zur Gruppe
    const r = ms.find(x => x.tours.some(q => q.id === t.id));
    if (r) stageBox.append(h('a', { class: 'banner stagechip', id: 'stage', href: '#/reise/' + r.id }, Reisen.stage(r, t) + ' · Mehrtagestour ' + Reisen.range(r.first, r.last)));
  }).catch(() => {});
  const note = h('textarea', { rows: 3, 'aria-label': 'Notiz', placeholder: 'Was war besonders an dieser Tour?', onchange: async e => { t.note = e.target.value; await Tours.save(t); toast('Notiz gespeichert'); } }, t.note || '');
  const src = t.src && t.src !== 'file' ? (Tours.QUELLE[t.src] || t.src) : '';
  // Hilfen aus „Meine Touren“: gelaufene Tour → Rückblick bzw. Plan und Ergebnis; geplante Tour → Passt die Tour zu mir?, Notizen & Quellen
  const done = (await Tours.list()).filter(x => x.status !== 'planned' && !x.hidden), planned = t.status === 'planned';
  const ranBy = planned ? done.filter(x => x.plan === t.id).sort((a, b) => b.start - a.start)[0] : null;
  const helpDone = planned ? null : ((t.plan && await TourHelp.ergebnis(t)) || TourHelp.rueckblick(Object.assign({}, t, { plan: null }), done));
  const pmeta = planned ? await PlanMeta.get(t.id) : null;
  const helpPlan = planned ? [await TourHelp.passt(t, done, pmeta), TourHelp.notizen(t, pmeta)] : [];
  body.append(...[title,
    h('div', { class: 'sub' }, F.date(t.start) + (t.timed ? ' · ' + F.time(t.start) + '–' + F.time(t.end) : '') + ' · ' + Sports.label(t.sport) + (src ? ' · ' + src : '')),
    stageBox,
    Fix.suspicious(t) && !t.elevFix && !t.elevSrc ? UI.banner('Der Aufstieg wirkt zu hoch (' + F.m(t.up) + ' auf ' + F.km(t.dist) + ').', [h('button', { class: 'btn pri sm', id: 'fixbanner', onclick: fixEle }, 'Höhen korrigieren')]) : null,
    t.status === 'planned' ? UI.banner('Geplante Tour', [h('a', { class: 'btn pri sm', href: '#/plan/' + t.id }, 'Im Planer öffnen'), h('button', { class: 'btn sm', onclick: () => startWith(t, pts) }, '● Mit Ansagen starten')]) : null,
    (t.tags || []).length ? h('div', { class: 'chips wrap' }, t.tags.map(g => h('a', { class: 'chip', href: '#/album/' + encodeURIComponent(g) }, g))) : null,
    main, more, mtInfo(),
    ranBy ? h('a', { class: 'banner', id: 'ranby', href: '#/tour/' + ranBy.id }, 'Gelaufen am ' + F.date(ranBy.start) + ': ' + ranBy.name) : null,
    ...helpPlan,
    UI.section('Höhenprofil', [prof, profInfo]), t.hrAvg ? pulsBlock() : null,
    UI.section('Fotos', [strip, noPhotos], { id: 'tphotos', action: h('div', { class: 'row' }, showBtn, h('button', { class: 'btn sm', onclick: addPhotos }, '＋ Fotos')) }),
    pinList(), helpDone, UI.section('Notiz', note)].filter(Boolean));
  title.addEventListener('click', rename);
  drawStrip();
  const xs = MapKit.profile(prof, pts, (i, o) => {
    if (i == null) { map.removeLayer(cursor); profInfo.textContent = ''; return; }
    cursor.setLatLng([pts[i].lat, pts[i].lon]).addTo(map);
    profInfo.textContent = `${F.km(o.dist)} · ${o.ele != null ? Math.round(o.ele) + ' m' : '–'}` + (pts[i].t ? ' · ' + F.time(pts[i].t) : '') + (o.hr ? ' · Puls ' + o.hr + ' bpm' : '');
  });
  void xs;

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
    const sw = UI.toggle('Strecke nach Puls einfärben', false, on => {
      if (on) { map.removeLayer(layer); hrLayer = MapKit.lineHr(pts, 5).addTo(map); }
      else { if (hrLayer) map.removeLayer(hrLayer); layer.addTo(map); }
    });
    return UI.section('Puls', [bars, sw], { sub: `Ø ${t.hrAvg} · höchstens ${t.hrMax} · mindestens ${t.hrMin} bpm` });
  }

  async function addPhotos() { PhotoSources.sheet(t, async () => { photos = (await DB.byIndex('photos', 'tour', id)).sort((a, b) => a.ts - b.ts); drawStrip(); drawPhotos(); }); }
  function actions() {
    const it = (ico, tx, fn) => UI.row({ icon: ico, title: tx, onclick: () => { s.close(); fn(); } });
    const grp = (name, rows) => [h('h3', { class: 'sub' }, name), UI.list(rows.filter(Boolean), { cls: 'menu' })];
    const s = sheet(t.name, h('div', null,
      grp('Ansehen und teilen', [
        it('flight', '3D-Flug über die Tour', () => Nav.go('/flug/' + id)),
        it('book', 'Erzählung', () => Nav.go('/story/' + id)),
        photos.some(p => !p.video) ? it('film', 'Diashow teilen', () => Show.share(t, pts, photos)) : null,
        it('link', 'Zusammenfassung teilen', () => { const txt = `${t.name}\n${F.date(t.start)} · ${F.km(t.dist)} · ↑ ${F.m(t.up)} · ${F.dur(t.dur)}`; if (window.MTApp) MTApp.shareText(txt); else navigator.clipboard && navigator.clipboard.writeText(txt); }),
        it('compass', 'Als Route nachgehen (mit Ansagen)', () => startWith(t, pts)),
        it('share', 'Als GPX speichern', exportGpx)]),
      grp('Bearbeiten', [
        it('pencil', 'Umbenennen', rename),
        it('bulb', 'Namensvorschläge', suggestNames),
        it('tag', 'Sportart ändern', changeSport),
        t.status !== 'planned' && !t.plan ? it('route', 'Mit Plan vergleichen', () => TourHelp.linkSheet(t)) : null,
        it('bag', 'Tags & Alben', () => Reisen.editTags(t, () => Nav.render())),
        it('camera', 'Fotos aus der Galerie suchen', async () => { const n = await PhotoSources.galleryForTours([t]); toast(n + ' Foto(s) gefunden'); photos = (await DB.byIndex('photos', 'tour', id)).sort((a, b) => a.ts - b.ts); drawStrip(); drawPhotos(); })]),
      grp('Strecke und Höhen', [
        it('peak', t.elevFix ? 'Höhen neu aus Gelände berechnen' : 'Höhen korrigieren (Geländemodell)', fixEle),
        it('watch', t.elevSrc ? 'Höhe aus Uhr (bereits abgeglichen) – erneut abgleichen' : 'Höhe aus Uhr abgleichen (Zepp)', zeppEle),
        it('wrench', 'GPS-Track korrigieren', () => Nav.go('/fix/' + id)),
        t.elevFix || t.elevSrc ? it('undo', 'Originalhöhen wiederherstellen', async () => { Object.assign(t, await Fix.restoreEle(t)); toast('Originalhöhen wiederhergestellt'); Nav.render(); }) : null,
        it('refresh', 'Kennzahlen neu berechnen', async () => { Object.assign(t, await Tours.recalc(id, { eigen: true })); toast('Kennzahlen neu berechnet'); Nav.render(); })]),
      h('div', { class: 'row', style: { marginTop: '18px' } }, h('button', { class: 'btn danger grow', onclick: async () => { s.close(); if (await confirmBox('Tour löschen?', `„${t.name}“ wird von diesem Handy gelöscht. Die Fotos bleiben erhalten.`, 'Tour löschen')) { await Tours.remove(id); await DB.del('kv', 'pn:' + id).catch(() => {}); Nav.go('/'); } } }, '🗑️ Tour löschen'))));
  }
  async function suggestNames() {
    const box = h('div', { class: 'list menu' }, h('p', { class: 'muted' }, 'Orte werden gesucht …'));
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
  async function zeppEle() {
    toast('Höhen werden von der Uhr geholt …');
    try { const o = t.up; Object.assign(t, await Fix.zeppEle(t)); toast(`Höhe aus Zepp übernommen: ↑ ${F.m(t.up)} (vorher ${F.m(o)})`); Nav.render(); }
    catch (e) { toast(e.message); }
  }
  async function changeSport() {
    const s = sheet('Sportart', UI.list(Sports.list.map(sp => UI.row({ icon: sp[2], title: sp[1], trail: sp[0] === t.sport ? 'gewählt' : null, onclick: async () => { t.sport = sp[0]; t.sportMan = 1; await Tours.save(t); s.close(); Nav.render(); } })), { cls: 'menu' }));
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
  TourHelp.armPlan(t);
  if (!window.MTApp) { toast('Ansagen gibt es nur in der Android-App'); Nav.go('/rec'); return; }
  const sp = Geo.simplify(pts, 3);
  MTApp.setRoute(sp.map(p => p.lat.toFixed(6) + ',' + p.lon.toFixed(6)).join(';'), t.name);
  Junctions.load(sp);
  sessionStorage.setItem('recSport', t.sport); sessionStorage.setItem('recName', t.name);
  Nav.go('/rec');
}
