'use strict';
/* Aufzeichnen: GPS-Spur im Hintergrund (Vordergrunddienst der Hülle), Fotos unterwegs, Sprachansagen auf geplanter Route. */
Views['/rec'] = async root => {
  const box = h('div', { class: 'rec' }), head = topbar('Aufzeichnen');      // der Titel wechselt während der Aufzeichnung zu „Aufzeichnung läuft“ / „Pause“
  root.append(head, box);
  if (!window.MTApp) { box.append(UI.empty({ icon: 'rec', title: 'Nur in der Android-App', text: 'Die GPS-Aufzeichnung läuft im Hintergrund und braucht die installierte App.' })); return; }
  let timer = null, map = null, line = null, me = null, lastPts = 0;
  const stat = () => { try { return JSON.parse(MTApp.status()); } catch (e) { return { state: 'idle' }; } };
  let stop_ = () => { clearInterval(timer); timer = null; if (map) { map.remove(); map = null; } };

  async function idle(st) {
    stop_(); box.innerHTML = '';
    if (st.state === 'finished' || (st.unsent && st.state === 'idle')) return unsaved(st);
    let sport = sessionStorage.getItem('recSport') || 'hike';
    const name = h('input', { type: 'text', placeholder: 'z. B. Hüttenrunde', value: sessionStorage.getItem('recName') || '' });
    const chips = h('div', { class: 'chips wrap' });
    const drawChips = () => { chips.innerHTML = ''; Sports.list.filter(s => s[0] !== 'mountaineering' && (s[0] !== 'ski' || sport === 'ski')).forEach(s => chips.append(h('button', { class: 'chip' + (sport === s[0] ? ' on' : ''), onclick: () => { sport = s[0]; drawChips(); } }, s[2] + ' ' + s[1]))); };
    drawChips();
    const ri = (() => { try { return JSON.parse(MTApp.routeInfo() || '{}'); } catch (e) { return {}; } })();
    const planned = (await Tours.list()).filter(t => t.status === 'planned');
    const routeBox = h('div', { class: 'routebox' });
    const drawRoute = () => {
      routeBox.innerHTML = '';
      const info = (() => { try { return JSON.parse(MTApp.routeInfo() || '{}'); } catch (e) { return {}; } })();
      if (info.name || info.points) routeBox.append(UI.list([UI.row({ icon: 'compass', title: info.name || 'Geplante Route', sub: 'Die App sagt Abbiegungen an und warnt, wenn du vom Weg abkommst.',
          trail: h('button', { class: 'btn sm', onclick: () => { MTApp.clearRoute(); TourHelp.disarmPlan(); drawRoute(); } }, 'Entfernen') })]),
        h('div', { class: 'row' }, UI.toggle('Wege ansagen', Set_.get('guide') !== false, async on => { await Set_.set('guide', on); MTApp.setGuide(on); }), h('span', { class: 'sp' }), h('button', { class: 'btn sm', onclick: () => MTApp.guideTest() }, '🔊 Ansage testen')));
      else routeBox.append(h('p', { class: 'muted' }, 'Mit einer Route sagt die App Abbiegungen an und warnt, wenn du vom Weg abkommst.'),
        h('div', { class: 'col' }, h('button', { class: 'btn', id: 'gpxroute', onclick: pickGpx }, '📂 GPX-Datei vom Handy wählen'),
          planned.length ? h('select', { 'aria-label': 'Geplante Tour als Route', onchange: async e => { const t = planned.find(x => x.id === e.target.value); if (t) { startWith0(t); } } }, h('option', { value: '' }, 'Geplante Tour wählen …'), planned.map(t => h('option', { value: t.id }, t.name + ' · ' + F.km(t.dist))))
            : h('p', { class: 'muted small' }, 'Noch keine geplante Tour. Unter „Tour planen“ lässt sich eine zeichnen.')));
    };
    /** Schnell: GPX-Datei vom Handy direkt als Route mit Ansagen verwenden (ohne sie erst zu importieren). */
    async function pickGpx() {
      try {
        const f = await Native.json('pickFiles'); if (!f || !f.length) return;
        const acts = await Parse.any(f[0].name, await Import.fetchBuf(f[0].url));
        try { await Native.call('clearCache'); } catch (e) { /* egal */ }
        const a = acts.find(x => x.pts && x.pts.length > 1);
        if (!a) throw new Error('In der Datei ist keine Strecke zu finden.');
        const sp = Geo.simplify(a.pts, 3), nm = (a.name || f[0].name || 'Route').replace(/\.(gpx|tcx|fit)$/i, '');
        MTApp.setRoute(sp.map(p => p.lat.toFixed(6) + ',' + p.lon.toFixed(6)).join(';'), nm); Junctions.load(sp); TourHelp.disarmPlan();
        if (a.sport) sport = a.sport; name.value = nm; drawChips(); drawRoute();
        toast('Route „' + nm + '“ ist aktiv – Ansagen eingeschaltet');
      } catch (e) { toast(e.message, 6000); }
    }
    async function startWith0(t) { TourHelp.armPlan(t); const pts = await Tours.points(t.id); const sp = Geo.simplify(pts, 3); MTApp.setRoute(sp.map(p => p.lat.toFixed(6) + ',' + p.lon.toFixed(6)).join(';'), t.name); Junctions.load(sp); sport = t.sport; name.value = t.name; drawChips(); drawRoute(); }
    void ri;
    drawRoute();
    const warn = h('div');
    const check = () => {
      warn.innerHTML = '';
      if (!MTApp.hasPermission()) warn.append(UI.banner('Für die Aufzeichnung braucht die App den Standort.', [h('button', { class: 'btn sm pri', onclick: () => MTApp.requestPermission() }, 'Standort erlauben')]));
      else if (!st.gps) warn.append(UI.banner('GPS ist ausgeschaltet. Bitte im Android-Schnellmenü einschalten.'));
    };
    check(); window.addEventListener('mtperm', check, { once: true });
    box.append(h('div', { class: 'pad' }, warn, UI.section('Sportart', chips), h('label', { class: 'fld' }, 'Name der Tour (optional)', name),
      UI.sign('Aufzeichnung starten', { cls: 'bigstart', onclick: () => {
        if (!MTApp.hasPermission()) { MTApp.requestPermission(); return; }
        MTApp.setGuide(Set_.get('guide') !== false);
        DB.kvSet('recPins', []);
        MTApp.startRecording(sport, name.value.trim());
        TourHelp.lockPlan();
        sessionStorage.removeItem('recSport'); sessionStorage.removeItem('recName');
        setTimeout(() => Nav.render(), 400);
      } }),
      h('p', { class: 'muted small' }, 'Die Aufzeichnung läuft auch bei ausgeschaltetem Bildschirm weiter.'),
      UI.section('Route mit Ansagen', routeBox),
      UI.section('Außerdem', UI.list([
        UI.row({ icon: 'route', title: 'Tour planen', sub: 'Route zeichnen und mit Ansagen nachgehen', href: '#/plan', id: 'goplan' }),
        UI.row({ icon: 'save', title: 'Gesicherte Aufzeichnungen', sub: 'Die letzten zehn Aufzeichnungen zurückholen', onclick: backups, id: 'baks' }),
        UI.row({ icon: 'battery', title: 'Akku-Einstellungen', sub: 'Für lange Touren die Akku-Optimierung dieser App ausschalten', onclick: () => MTApp.openBatterySettings() })]))));
  }

  /** Die letzten Aufzeichnungen liegen als Sicherung auf dem Handy – hier lassen sie sich als Tour zurückholen. */
  function backups() {
    let list = [];
    try { list = JSON.parse(MTApp.backups() || '[]'); } catch (e) { /* leer */ }
    const body = h('div', { class: 'list menu' });
    let sh = null;
    if (!list.length) body.append(h('p', { class: 'muted' }, 'Keine Sicherungen vorhanden. Beendete Aufzeichnungen werden automatisch gesichert (die letzten 10).'));
    list.forEach(b => body.append(h('button', { class: 'li', onclick: async () => {
      if (!await confirmBox('Als Tour wiederherstellen?', 'Die Aufzeichnung vom ' + F.date(b.ts) + ' (' + F.time(b.ts) + ' Uhr) wird als neue Tour gespeichert. Passende Fotos werden wieder zugeordnet.', 'Wiederherstellen')) return;
      if (sh) sh.close();
      try {
        const gpx = MTApp.backupGpx(b.file);
        const a = Parse.gpx(gpx)[0];
        if (!a || a.pts.length < 2) throw new Error('Datei enthält keine Spur');
        const r = await Tours.add({ name: '', sport: Sports.norm(a.rawSport) || 'hike', pts: a.pts, src: 'rec', force: true });
        await Photos.assignAll();
        toast(r.dup ? 'Diese Tour gibt es schon.' : 'Tour wiederhergestellt ✓');
        Nav.go('/tour/' + r.tour.id);
      } catch (e) { toast('Wiederherstellen fehlgeschlagen: ' + e.message, 6000); }
    } }, h('span', { class: 'li-i', html: Ico.svg('save', 22) }), h('span', { class: 'li-t' }, h('b', null, F.date(b.ts) + ' · ' + F.time(b.ts) + ' Uhr'), h('small', null, F.size(b.size))))));
    sh = sheet('Gesicherte Aufzeichnungen', body);
  }

  /** Pin: Ort mit Kommentar (optional mit Foto) – wird mit der Tour gespeichert. */
  async function addPin(st, withPhoto) {
    const txt = await askText(withPhoto ? 'Foto mit Kommentar' : 'Pin setzen', 'Kommentar', '', withPhoto ? 'Foto aufnehmen' : 'Speichern');
    if (txt == null) return;
    const pins = (await DB.kvGet('recPins', [])) || [];
    const s = stat();
    pins.push({ id: uid(), ts: Date.now(), lat: s.lat != null ? s.lat : null, lon: s.lon != null ? s.lon : null, text: txt.trim() });
    await DB.kvSet('recPins', pins);
    window.dispatchEvent(new Event('pins-changed'));
    if (withPhoto) { try { sessionStorage.setItem('pinNote', JSON.stringify({ t: Date.now(), text: txt.trim() })); } catch (e) { /* egal */ } MTApp.takePhoto(); }
    else toast('Pin gesetzt');
  }

  async function active(st) {
    box.innerHTML = '';
    const mapEl = h('div', { class: 'map rmap' });
    const state = h('span', { class: 'rec-state', role: 'status' }, h('i'), h('span'));
    head.querySelector('h1').replaceChildren(state);      // der Seitentitel sagt, was gerade läuft
    const big = h('div', { class: 'bigtime', 'aria-label': 'Dauer' }), grid = h('div'), gps = h('p', { class: 'rec-gps' });
    let shown = '';
    const pause = h('button', { class: 'rbtn pause', id: 'rpause', onclick: () => { st.state === 'paused' ? MTApp.resumeRecording() : MTApp.pauseRecording(); setTimeout(tick, 300); } });
    const ib = (cls, id, ico, label, fn) => h('button', { class: cls, id, onclick: fn }, h('span', { html: Ico.svg(ico, 30) }), label);
    const photoBtn = ib('rbtn', 'rphoto', 'camera', 'Foto', () => { MTApp.takePhoto(); });
    const pinBtn = ib('rbtn sm', 'rpin', 'pin', 'Pin setzen', () => addPin(st, false));
    const pinPhBtn = ib('rbtn sm', 'rpinph', 'chat', 'Foto mit Text', () => addPin(st, true));
    const vidBtn = ib('rbtn', 'rvideo', 'video', 'Video', () => { if (MTApp.takeVideo) MTApp.takeVideo(); else toast('Video braucht die neueste App-Version.'); });
    // Beenden: steht allein und reagiert nur, wenn man es gedrückt hält (Ring füllt sich)
    const ring = h('i', { class: 'holdring' });
    const stopBtn = h('button', { class: 'holdstop', id: 'rstop', 'aria-label': 'Beenden – gedrückt halten' }, ring, h('span', { class: 'ht' }, h('b', { html: Ico.svg('stop', 22) + '<span>Aufzeichnung beenden</span>' }), h('small', null, 'gedrückt halten')));
    let hold = null, holdT = 0;
    const HOLD_MS = 1500;
    const holdStop = () => { if (hold) { cancelAnimationFrame(hold); hold = null; } ring.style.transform = 'scaleX(0)'; stopBtn.classList.remove('on'); };
    const holdStart = e => {
      e.preventDefault(); if (hold) return;
      holdT = performance.now(); stopBtn.classList.add('on');
      const step = () => { const f = Math.min(1, (performance.now() - holdT) / HOLD_MS); ring.style.transform = 'scaleX(' + f + ')'; if (f >= 1) { hold = null; stopBtn.classList.remove('on'); finish(); } else hold = requestAnimationFrame(step); };
      hold = requestAnimationFrame(step);
    };
    ['pointerdown'].forEach(ev => stopBtn.addEventListener(ev, holdStart));
    ['pointerup', 'pointercancel', 'pointerleave', 'contextmenu'].forEach(ev => stopBtn.addEventListener(ev, e => { if (ev === 'contextmenu') e.preventDefault(); holdStop(); }));
    stopBtn.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) { holdStart(e); } });
    stopBtn.addEventListener('keyup', holdStop);
    box.append(mapEl, h('div', { class: 'pad' }, big, grid, gps,
      h('div', { class: 'rbtns main' }, pause, photoBtn, vidBtn),
      h('div', { class: 'rbtns sub' }, pinBtn, pinPhBtn),
      h('div', { class: 'stopgap' }), stopBtn));
    map = MapKit.create(mapEl, { zoom: 16 });
    line = L.polyline([], { color: '#e65100', weight: 5 }).addTo(map);
    me = L.circleMarker([0, 0], { radius: 8, color: '#fff', weight: 3, fillColor: '#1565c0', fillOpacity: 1 });
    // Orte, an denen Fotos gemacht wurden, und Pins sind schon während der Aufzeichnung auf der Karte zu sehen
    const marks = L.layerGroup().addTo(map);
    const drawMarks = async () => {
      if (!map) return;
      marks.clearLayers();
      const since = (st.start || 0) - 60000;
      const ph = (await Photos.all()).filter(p => p.lat != null && p.ts >= since);
      ph.forEach(p => MapKit.photoMarker(p, () => Lightbox.open(ph, ph.indexOf(p))).addTo(marks));
      ((await DB.kvGet('recPins', [])) || []).filter(p => p.lat != null).forEach(p => MapKit.pin(p).addTo(marks));
    };
    const onMarks = () => { drawMarks().catch(() => {}); };
    window.addEventListener('photos-changed', onMarks); window.addEventListener('pins-changed', onMarks);
    const prevStop = stop_;
    stop_ = () => { window.removeEventListener('photos-changed', onMarks); window.removeEventListener('pins-changed', onMarks); holdStop(); prevStop(); };
    drawMarks().catch(() => {});
    let first = true;
    const ri = (() => { try { return JSON.parse(MTApp.routePoints() || '[]'); } catch (e) { return []; } })();
    if (ri.length) { const rp = ri.map(p => Array.isArray(p) ? p : [p.lat, p.lon]); L.polyline(rp, { color: '#1565c0', weight: 4, opacity: .6, dashArray: '2 8' }).addTo(map); map.fitBounds(L.latLngBounds(rp)); first = false; }
    async function tick() {
      const s = stat();
      if (s.state === 'idle') return Nav.render();
      if (s.state === 'finished') return Nav.render();
      st = s;
      big.textContent = F.clock(s.active_s);
      grid.innerHTML = '';
      grid.append(UI.figs([[F.km(s.dist_m), 'Strecke'], ['↑ ' + F.m(s.up_m), 'Aufstieg'], [s.alt_m != null ? F.m(s.alt_m) : '–', 'Höhe'], [s.speed_ms ? (s.speed_ms * 3.6).toFixed(1).replace('.', ',') + ' km/h' : '–', 'Tempo']], { big: true, cols: 2 }));
      const sig = s.fix_age_s >= 0 && s.fix_age_s < 20;
      gps.textContent = s.state === 'paused' ? 'Pausiert – es wird nichts mitgeschrieben.' : (sig ? 'GPS-Signal gut' + (s.fix_acc_m > 0 ? ', auf ' + s.fix_acc_m + ' m genau' : '') : 'GPS-Signal wird gesucht …');
      if (shown !== s.state) {      // nur bei Wechsel neu aufbauen, sonst flackert die Taste im Sekundentakt
        shown = s.state;
        const p = s.state === 'paused';
        state.classList.toggle('paused', p); state.lastChild.textContent = p ? 'Pause' : 'Aufzeichnung läuft';
        pause.innerHTML = ''; pause.append(h('span', { html: Ico.svg(p ? 'play' : 'pause', 30) }), p ? 'Weiter' : 'Pause');
      }
      if (s.count !== lastPts && s.lat != null) {
        lastPts = s.count;
        try { const ps = JSON.parse(MTApp.points(800)); line.setLatLngs(ps); } catch (e) { /* ignorieren */ }
        me.setLatLng([s.lat, s.lon]).addTo(map);
        if (first) { map.setView([s.lat, s.lon], 16); first = false; } else if (!map.getBounds().pad(-0.2).contains([s.lat, s.lon])) map.panTo([s.lat, s.lon]);
      }
    }
    await tick();
    timer = setInterval(tick, 1000);
    async function finish() {
      if (window.__saving) return;
      const nm = st.name || '';
      MTApp.stopRecording(nm);
      stop_();
      setTimeout(() => saveFinished(), 500);
    }
  }

  async function saveFinished() {
    if (window.__saving) return;
    window.__saving = true;
    try {
      const st = stat();
      const gpx = MTApp.takeFinished();
      if (!gpx || gpx.length < 100) { MTApp.discardRecording(); toast('Zu wenige Punkte – nichts gespeichert.'); return Nav.render(); }
      try {
        const acts = Parse.gpx(gpx);
        if (!acts.length || acts[0].pts.length < 2) throw new Error('Zu wenige Punkte');
        const a = acts[0];
        const sport = Sports.norm(st.sport || a.rawSport) === 'other' && st.sport ? st.sport : Sports.norm(st.sport || a.rawSport);
        const r = await Tours.add({ name: st.name || a.name, sport, pts: a.pts, src: 'rec' });
        if (r.dup) {
          // Gleiche Spur gibt es schon: nichts doppelt anlegen, die Aufzeichnung bleibt als Sicherung erhalten
          await handlePhotoQueue(); await Photos.assignAll();
          MTApp.discardRecording();
          toast('Diese Tour war schon gespeichert.');
          return Nav.go('/tour/' + r.tour.id);
        }
        await TourHelp.attachPlan(r.tour);
        const pins = (await DB.kvGet('recPins', [])) || [];
        if (pins.length) { r.tour.pins = pins; await Tours.save(r.tour); await DB.kvSet('recPins', []); }
        await handlePhotoQueue();
        await Photos.assignAll();
        MTApp.discardRecording();
        toast('Tour gespeichert ✓');
        Nav.go('/tour/' + r.tour.id);
      } catch (e) {
        toast('Speichern fehlgeschlagen: ' + e.message + ' – die Aufzeichnung bleibt erhalten.', 7000);
        Nav.render();
      }
    } finally { window.__saving = false; }
  }

  function unsaved(st) {
    void st;
    box.append(h('div', { class: 'pad' }, UI.empty({ icon: 'save', title: 'Aufzeichnung noch nicht gespeichert', text: 'Eine beendete Aufzeichnung liegt noch auf dem Handy. Speichere sie als Tour oder verwirf sie.', actions: [
      h('button', { class: 'btn pri', onclick: () => saveFinished() }, 'Als Tour speichern'),
      h('button', { class: 'btn danger', onclick: async () => { if (await confirmBox('Aufzeichnung verwerfen?', 'Sie wird gelöscht (eine Sicherungskopie bleibt auf dem Handy).', 'Verwerfen')) { MTApp.discardRecording(); Nav.render(); } } }, 'Verwerfen')] })));
  }

  const st = stat();
  if (st.state === 'recording' || st.state === 'paused') await active(st); else await idle(st);
  return stop_;
};
