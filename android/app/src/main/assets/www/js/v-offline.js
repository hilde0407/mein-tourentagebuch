'use strict';
/* 2.11.0: Offline-Karten. Vor der Tour einen Kartenausschnitt (sichtbarer Ausschnitt oder Rahmen um eine Tour) laden; die Hülle (TileDownload.java)
   lädt die Kacheln im Hintergrund und liefert sie danach an Karte, Aufnahme, Tourenansicht und Tour-PDF aus. Rechnung und Grenzen: js/calc-offline.js.
   Offline gibt es nur die Wanderkarte (OpenTopoMap): Die Nutzungsregeln der OpenStreetMap-Standardkarte verbieten Offline-Nutzung und Vorausladen. */
const Offline = {
  KEY: 'offlineAreas',
  QUELLE: 'topo',
  gebiete: null,
  /** Zuletzt bekannte Ausschnitte (für Entscheidungen ohne Warten, z. B. welche Karte ohne Netz gezeigt wird). */
  _gemerkt() { try { return JSON.parse(localStorage.getItem(Offline.KEY) || '[]') || []; } catch (e) { return []; } },
  bekannt() { return Offline.gebiete || Offline._gemerkt(); },
  /** Ohne Netz und mit geladener Wanderkarte: die Karte zeigt die Wanderkarte statt der Straßenkarte. */
  lieberTopo() { return navigator.onLine === false && Offline.bekannt().some(g => g && g.src === 'topo' && g.have > 0); },
  /** Liste der Hülle: { areas, bytes, max, running, wifi } oder null (Browser, alte Hülle). */
  async liste() {
    if (!window.MTApp) return null;
    let l;
    try { l = await Native.json('tilesList'); } catch (e) { return null; }
    if (!l || !Array.isArray(l.areas)) return null;
    Offline.gebiete = l.areas;
    try { localStorage.setItem(Offline.KEY, JSON.stringify(l.areas.map(g => ({ id: g.id, src: g.src, have: g.have, bbox: g.bbox, cover: g.cover })))); } catch (e) { /* egal */ }
    return l;
  },
  /** Für die Aufnahme: ohne Netz und ohne Offline-Karte für diesen Ort → true (dann eine ruhige Hinweiszeile). */
  async fehltHier(lat, lon) {
    if (navigator.onLine !== false || lat == null || lon == null) return false;
    let g = Offline.gebiete;
    if (!g) { const l = await Offline.liste(); g = l ? l.areas : Offline._gemerkt(); }
    return !OfflineCalc.abgedeckt((g || []).filter(x => x && x.have > 0), lat, lon);
  },
  /** Fortschrittsblatt bis der Lauf der Hülle fertig ist; „Abbrechen“ bricht ab, Schließen nicht. */
  follow(nach) {
    if (Offline._s) return Offline._p;
    const bar = h('div', { class: 'prog', id: 'off-prog' }, h('i')), txt = h('p', { id: 'off-txt' }, 'Wird gestartet …');
    const stop = h('button', { class: 'btn', id: 'off-stop', onclick: async e => { e.currentTarget.disabled = true; e.currentTarget.textContent = 'Wird abgebrochen …'; try { await Native.call('tilesCancel'); } catch (x) { /* egal */ } } }, 'Abbrechen');
    let timer = null, fertig = false;
    Offline._p = new Promise(res => {
      const aus = () => { fertig = true; clearInterval(timer); Offline._s = null; };
      const s = Offline._s = sheet('Offline-Karte laden', h('div', null, txt, bar,
        h('p', { class: 'muted small' }, 'Läuft im Hintergrund weiter, auch bei ausgeschaltetem Bildschirm (siehe Benachrichtigung). Schließen bricht nicht ab.'),
        h('div', { class: 'row end' }, stop)), { onclose: () => { if (!fertig) { aus(); res(null); } } });
      const poll = async () => {
        let j; try { j = await Native.json('tilesJob'); } catch (e) { return; }
        if (fertig || !j) return;
        if (!j.running) {
          aus(); s.close();
          toast(OfflineCalc.ergebnis(j), 8000);
          await Offline.liste();
          if (nach) nach();
          res(j); return;
        }
        const p = OfflineCalc.fortschritt(j);
        txt.textContent = p.text; bar.firstChild.style.width = Math.round(p.anteil * 100) + '%';
      };
      timer = setInterval(poll, 700); poll();
    });
    return Offline._p;
  },
  async starten(args, n, nach) {
    const q = OfflineCalc.QUELLEN[args.src || Offline.QUELLE];
    const txt = OfflineCalc.umfang(args.src || Offline.QUELLE, n) + ' von ' + q.name + ', Zoom ' + OfflineCalc.ZMIN + '–' + (args.zmax || 15) + '. '
      + (args.wifiOnly ? 'Nur über WLAN. ' : 'Auch über mobile Daten. ')
      + 'Bitte sparsam laden: Der Kartenserver ist ein freies, spendenfinanziertes Angebot.';
    if (!await confirmBox('Offline-Karte laden?', txt, 'Herunterladen')) return null;
    let r;
    try { r = await Native.json('tilesStart', args); } catch (e) { toastFehler('Laden', e, 7000); return null; }
    if (r && r.started === false) { toast(r.error || 'Laden nicht möglich.', 7000); return null; }
    return Offline.follow(nach);
  },
};

Views['/offline'] = async root => {
  const O = OfflineCalc, body = h('div', { class: 'pad offline' });
  root.append(topbar('Offline-Karten', { back: true }), body);
  const quelle = O.QUELLEN[Offline.QUELLE];
  const intro = h('p', { class: 'muted' }, 'Lade vor der Tour einen Kartenausschnitt. Dann zeigen Karte, Aufzeichnung und Tourenansicht die Karte auch ohne Netz. Offline gibt es die Wanderkarte (OpenTopoMap).');
  const merkenTeil = () => {
    const n = h('p', { class: 'muted small', id: 'off-merk-n' }, 'Wird gezählt …');
    const zaehle = () => MapKit.cacheCount().then(k => { n.textContent = O.tausend(k) + (k === 1 ? ' Kachel' : ' Kacheln') + ' gemerkt (höchstens ' + O.tausend(O.MERKEN_MAX) + ', etwa 150 MB)'; });
    zaehle();
    return UI.section('Gesehene Kacheln', h('div', null,
      UI.toggle('Gesehene Kacheln merken', MapKit.merken(), async v => { await Set_.set('tileMerken', !!v); }, { id: 'off-merken' }),
      n, h('div', { class: 'row wrap' }, h('button', { class: 'btn sm', id: 'off-leeren', onclick: async () => { await MapKit.clearCache(); zaehle(); toast('Gemerkte Kacheln gelöscht'); } }, 'Leeren'))),
      { sub: 'Kartenteile, die du dir mit Netz ansiehst, merkt sich die App – auch die der Straßenkarte. Die ältesten fallen heraus.' });
  };
  const hinweis = h('p', { class: 'muted small', id: 'off-quelle' }, 'Quelle: ' + quelle.attr + '. Die OpenStreetMap-Straßenkarte darf nach den Regeln ihres Betreibers nicht offline gespeichert werden; ohne Netz zeigt die Karte darum die gespeicherte Wanderkarte. '
    + 'Grenzen: höchstens ' + O.tausend(O.MAX_KACHELN) + ' Kacheln je Ausschnitt, Zoom bis ' + O.ZMAX + ', alle Offline-Karten zusammen höchstens ' + O.mb(O.MAX_GESAMT) + '. '
    + 'Offline-Karten gehören nicht zur Sicherung (.mtl) – sie lassen sich jederzeit neu laden.');
  if (!window.MTApp) { body.append(intro, UI.empty({ icon: 'map', title: 'Nur in der Android-App', text: 'Offline-Karten lädt die installierte App im Hintergrund.' }), merkenTeil(), hinweis); return; }

  // ---- Belegt ----
  const belegt = h('p', { class: 'small', id: 'off-belegt' }, 'Wird gezählt …'), belegtBar = h('div', { class: 'gbar', id: 'off-belegt-bar' }, h('i', { style: { width: '0%' } }));
  let stand = { areas: [], bytes: 0 };
  // ---- Neuer Ausschnitt ----
  let art = sessionStorage.getItem('offBounds') ? 'karte' : (sessionStorage.getItem('offArt') || 'karte'), stufe = Set_.get('offlineStufe') || 'normal', tour = null, tourPts = null, plan = { n: 0 };
  const artBox = h('div', { id: 'off-art' }), stufeBox = h('div', { id: 'off-stufe' }), est = h('p', { class: 'off-est', id: 'off-est', role: 'status' }, '');
  const mapEl = h('div', { class: 'map offmap', id: 'off-map' });
  const touren = (await Tours.list()).filter(t => !t.hidden).sort((a, b) => (b.status === 'planned') - (a.status === 'planned') || (b.start || 0) - (a.start || 0)).slice(0, 80);
  const tourSel = h('select', { id: 'off-tour', 'aria-label': 'Tour wählen', onchange: e => waehleTour(e.target.value) }, h('option', { value: '' }, 'Tour wählen …'),
    touren.map(t => h('option', { value: t.id }, (t.status === 'planned' ? 'Geplant: ' : '') + t.name + ' · ' + F.km(t.dist))));
  const tourBox = h('div', { class: 'fld', id: 'off-tourbox' }, tourSel, h('p', { class: 'muted small' }, 'Die Strecke mit etwa ' + (O.RAND_M / 1000) + ' km Rand.'));
  const nameIn = h('input', { type: 'text', id: 'off-name', maxlength: '60', placeholder: 'z. B. Karwendel' });
  const startBtn = h('button', { class: 'btn pri', id: 'off-start', onclick: starten }, 'Herunterladen');
  const listeBox = h('div', { id: 'off-liste' });

  body.append(intro, belegt, belegtBar,
    UI.section('Neuer Ausschnitt', h('div', null, artBox, mapEl, tourBox,
      h('div', { class: 'fld' }, 'Detail', stufeBox), est,
      h('label', { class: 'fld' }, 'Name', nameIn),
      UI.toggle('Nur über WLAN laden', Set_.get('offlineWifi') !== false, async v => { await Set_.set('offlineWifi', !!v); }, { id: 'off-wifi' }),
      h('div', { class: 'row wrap' }, startBtn))),
    UI.section('Meine Offline-Karten', listeBox),
    merkenTeil(), hinweis);

  MapKit.init();
  const map = L.map(mapEl, { zoomControl: false, attributionControl: true, preferCanvas: true });
  new MapKit.CachedTiles(quelle.url, { maxZoom: 17, attribution: quelle.attr, crossOrigin: true }).addTo(map);
  L.control.zoom({ position: 'topright' }).addTo(map);
  const deko = L.layerGroup().addTo(map);
  const ob = JSON.parse(sessionStorage.getItem('offBounds') || 'null'); sessionStorage.removeItem('offBounds');
  if (ob && isFinite(ob.s)) map.fitBounds([[ob.s, ob.w], [ob.n, ob.e]]);
  else if (Set_.get('homeLat')) map.setView([+Set_.get('homeLat'), +Set_.get('homeLon')], 12);
  else map.setView([47.4, 11.2], 11);
  mapEl.__karte = map;      // für die Tests

  const drawArt = () => {
    artBox.replaceChildren(UI.seg([['karte', 'Kartenausschnitt'], ['tour', 'Um eine Tour']], art, a => { art = a; try { sessionStorage.setItem('offArt', a); } catch (e) { /* egal */ } drawArt(); rechne(); }, { label: 'Ausschnitt' }));
    tourBox.hidden = art !== 'tour';
  };
  const drawStufe = () => stufeBox.replaceChildren(UI.seg(O.STUFEN.map(s => [s[0], s[1] + ' (bis ' + s[2] + ')']), stufe, async s => { stufe = s; await Set_.set('offlineStufe', s); drawStufe(); rechne(); }, { label: 'Detail' }));
  async function waehleTour(id) {
    tour = touren.find(t => t.id === id) || null; tourPts = null;
    if (tour) {
      const pts = await Tours.points(tour.id).catch(() => []);
      tourPts = Geo.simplify(pts, 20).filter(p => p.lat != null && p.lon != null).map(p => [+p.lat.toFixed(6), +p.lon.toFixed(6)]);
      if (!nameIn.value || nameIn.dataset.auto) { nameIn.value = O.name(tour.name); nameIn.dataset.auto = '1'; }
      const r = O.rahmen(tourPts, O.RAND_M);
      if (r) map.fitBounds([[r.s, r.w], [r.n, r.e]]);
    }
    rechne();
  }
  nameIn.addEventListener('input', () => { delete nameIn.dataset.auto; });

  /** Schätzung neu: Kachelzahl, Größe, Grenzen – und ob der Knopf geht. */
  function rechne() {
    deko.clearLayers();
    const zmax = O.zmaxVon(stufe);
    if (art === 'tour') {
      if (!tourPts || tourPts.length < 1) { plan = { n: 0 }; est.textContent = 'Bitte eine Tour wählen.'; est.className = 'off-est'; startBtn.disabled = true; return; }
      const k = O.korridor(tourPts, O.RAND_M, O.ZMIN, zmax);
      plan = { n: k.anzahl, mehr: k.mehr, args: { kind: 'route', pts: tourPts, rand: O.RAND_M } };
      L.polyline(tourPts, { color: '#1565c0', weight: 4, interactive: false }).addTo(deko);
      const r = O.rahmen(tourPts, O.RAND_M); if (r) L.rectangle([[r.s, r.w], [r.n, r.e]], { color: '#1565c0', weight: 1, fill: false, dashArray: '4 4', interactive: false }).addTo(deko);
    } else {
      const b = map.getBounds(), bb = { s: b.getSouth(), w: b.getWest(), n: b.getNorth(), e: b.getEast() };
      plan = { n: O.zaehleRechteck(bb, O.ZMIN, zmax), args: { kind: 'rect', bbox: [bb.s, bb.w, bb.n, bb.e] } };
    }
    const p = O.pruefen(Offline.QUELLE, plan.n, stand.bytes);
    est.textContent = O.umfang(Offline.QUELLE, plan.n, plan.mehr) + (p.ok ? '' : ' – ' + p.text);
    est.className = 'off-est' + (p.ok ? '' : ' warn');
    startBtn.disabled = !p.ok;
    if (!nameIn.value || nameIn.dataset.auto) { if (art === 'karte') { nameIn.value = 'Ausschnitt ' + F.dshort(Date.now()); nameIn.dataset.auto = '1'; } }
  }
  map.on('moveend', () => { if (art === 'karte' && MapKit.lebt(map)) rechne(); });

  async function starten() {
    if (!plan.args || startBtn.disabled) return;
    const args = Object.assign({ src: Offline.QUELLE, name: O.name(nameIn.value, art === 'tour' && tour ? tour.name : 'Offline-Karte'), zmax: O.zmaxVon(stufe), wifiOnly: Set_.get('offlineWifi') !== false }, plan.args);
    await Offline.starten(args, plan.n, zeige);
  }

  /** Liste „Meine Offline-Karten“ und „Belegt“. */
  async function zeige() {
    const l = await Offline.liste();
    if (!listeBox.isConnected) return;
    if (!l) { listeBox.replaceChildren(h('p', { class: 'muted' }, 'Diese App-Version kann noch keine Offline-Karten laden.')); startBtn.disabled = true; return; }
    stand = l;
    belegt.textContent = 'Belegt: ' + O.mb(l.bytes) + ' von ' + O.mb(l.max || O.MAX_GESAMT);
    belegtBar.firstChild.style.width = Math.min(100, Math.round((l.bytes || 0) / (l.max || O.MAX_GESAMT) * 100)) + '%';
    const datum = t => F.dshort(t);
    const rows = l.areas.slice().sort((a, b) => (b.date || 0) - (a.date || 0)).map(g => h('div', { class: 'li offli', 'data-id': g.id },
      h('span', { class: 'li-i', html: Ico.svg(g.kind === 'route' ? 'route' : 'map', 22) }),
      h('span', { class: 'li-t' }, h('b', null, g.name || 'Offline-Karte'),
        h('small', null, (O.QUELLEN[g.src] ? O.QUELLEN[g.src].name.replace(/ \(.*\)$/, '') : g.src) + ' · Zoom ' + g.zmin + '–' + g.zmax + ' · ' + O.tausend(g.have || 0) + (g.complete ? '' : ' von ' + O.tausend(g.tiles || 0)) + ' Kacheln · ' + O.mb(g.bytes) + ' · ' + datum(g.date)),
        g.complete ? null : h('small', { class: 'off-unv' }, 'Unvollständig – „Aktualisieren“ lädt den Rest.'),
        h('span', { class: 'row wrap off-acts' },
          h('button', { class: 'btn sm off-upd', onclick: () => aktualisieren(g) }, 'Aktualisieren'),
          h('button', { class: 'btn sm off-del', onclick: () => loeschen(g) }, 'Löschen')))));
    listeBox.replaceChildren(rows.length ? UI.list(rows) : h('p', { class: 'muted', id: 'off-leer' }, 'Noch keine Offline-Karte.'));
    rechne();
    if (l.running) Offline.follow(zeige);
  }
  async function aktualisieren(g) {
    const fehlt = Math.max(0, (g.tiles || 0) - (g.have || 0));
    const txt = 'Fehlende Kacheln ' + (fehlt ? '(' + O.tausend(fehlt) + ') ' : '') + 'und solche, die älter als eine Woche sind, werden neu geladen – höchstens ' + O.umfang(g.src, g.tiles || 0).replace('≈ ', '') + '. '
      + (Set_.get('offlineWifi') !== false ? 'Nur über WLAN.' : 'Auch über mobile Daten.');
    if (!await confirmBox('„' + (g.name || 'Offline-Karte') + '“ aktualisieren?', txt, 'Aktualisieren')) return;
    let r;
    try { r = await Native.json('tilesStart', { refresh: g.id, wifiOnly: Set_.get('offlineWifi') !== false }); } catch (e) { toastFehler('Aktualisieren', e, 7000); return; }
    if (r && r.started === false) { toast(r.error || 'Aktualisieren nicht möglich.', 7000); return; }
    await Offline.follow(zeige);
  }
  async function loeschen(g) {
    if (!await confirmBox('Offline-Karte „' + (g.name || 'Offline-Karte') + '“ löschen?', 'Die Offline-Karte (' + O.mb(g.bytes) + ') wird vom Handy gelöscht. Neu laden geht jederzeit. Kacheln, die eine andere Offline-Karte auch braucht, bleiben.', 'Löschen')) return;
    try { await Native.json('tilesDelete', { id: g.id }); toast('Offline-Karte gelöscht'); } catch (e) { toastFehler('Löschen', e, 6000); }
    zeige();
  }

  drawArt(); drawStufe();
  setTimeout(() => { map.invalidateSize(); rechne(); }, 50);
  await zeige();
  return () => { MapKit.abbauen(map); };
};
// Beim Start die Liste der Hülle einmal holen (für „ohne Netz die Wanderkarte zeigen“ und den Hinweis in der Aufnahme)
if (window.MTApp) setTimeout(() => { Offline.liste().catch(() => {}); }, 1500);
