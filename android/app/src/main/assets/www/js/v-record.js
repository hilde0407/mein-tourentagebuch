'use strict';
/* Aufzeichnen: GPS-Spur im Hintergrund (Vordergrunddienst der Hülle), Fotos unterwegs, Sprachansagen auf geplanter Route. */

/** 2.7.0: Die gewählte Route (Spur zum Nachgehen) wird zusätzlich dauerhaft in der App gemerkt (kv „recRoute“).
    Die Hülle hält die Route in einer Datei und löscht sie beim Beenden JEDER Aufzeichnung (Navi.clear bei ACT_STOP) – auch dann, wenn die Route
    erst nach dem Start dieser Aufzeichnung gewählt wurde (z. B. „Mit Ansagen starten“, während noch eine alte Aufzeichnung lief). Dann war sie
    beim nächsten Start still verschwunden. Jetzt gilt: Die Auswahl bleibt, bis man sie entfernt oder eine Aufzeichnung, die NACH der Auswahl
    gestartet wurde, gespeichert bzw. verworfen ist. Fehlt sie in der Hülle, wird sie beim Öffnen der Aufnahme wieder geladen; gibt es die Tour
    nicht mehr, steht ein deutlicher Hinweis da. */
const RecRoute = {
  KEY: 'recRoute',
  /** Route an die Hülle geben und merken. sel: { kind: 'tour', id, name } oder { kind: 'gpx', name } (bei GPX wird die Spur selbst gemerkt). */
  async set(sel, text) {
    if (window.MTApp) MTApp.setRoute(text, sel.name || '');
    const o = Object.assign({ ts: Date.now() }, sel);
    if (sel.kind !== 'tour') o.text = text;
    await DB.kvSet(RecRoute.KEY, o).catch(() => {});
  },
  async clear() { if (window.MTApp) MTApp.clearRoute(); await DB.kvSet(RecRoute.KEY, null).catch(() => {}); },
  get() { return DB.kvGet(RecRoute.KEY, null).catch(() => null); },
  /** Was die Hülle gerade als Route hat (null = keine). */
  native() { try { const i = JSON.parse(MTApp.routeInfo() || '{}'); return i.has || i.name || i.points ? i : null; } catch (e) { return null; } },
  text(pts) { return Geo.simplify(pts, 3).map(p => p.lat.toFixed(6) + ',' + p.lon.toFixed(6)).join(';'); },
  /** Beim Öffnen der Aufnahme: Route in der Hülle sicherstellen. st = Status der Hülle.
      Gibt { sel, restored, gone } zurück: restored = eben wieder geladen, gone = die gewählte Tour gibt es nicht mehr. */
  async ensure(st) {
    const sel = await RecRoute.get();
    if (!sel || !window.MTApp) return { sel: null };
    const live = st && (st.state === 'recording' || st.state === 'paused');
    if (live && st.start && sel.ts > st.start + 1000) return { sel };      // erst während dieser Aufzeichnung gewählt: gilt für sie, wie die Hülle sie hat
    if (RecRoute.native()) return { sel };
    if (sel.kind === 'tour') {
      const t = await DB.get('tours', sel.id).catch(() => null);
      const pts = t ? await Tours.points(t.id).catch(() => []) : [];
      if (!t || pts.length < 2) return { sel, gone: true };
      MTApp.setRoute(RecRoute.text(pts), t.name || sel.name || '');
      if (!live) Junctions.load(Geo.simplify(pts, 3));
      return { sel, restored: true };
    }
    if (sel.text && sel.text.indexOf(';') > 0) { MTApp.setRoute(sel.text, sel.name || ''); return { sel, restored: true }; }
    return { sel, gone: true };
  },
  /** Aufzeichnung gespeichert oder verworfen: die Auswahl gilt als erledigt, wenn sie VOR dem Start dieser Aufzeichnung getroffen wurde. */
  async done(start) {
    const sel = await RecRoute.get();
    if (sel && (!start || sel.ts <= start + 1000)) await DB.kvSet(RecRoute.KEY, null).catch(() => {});
  },
  /** Hinweis, wenn die gewählte Route nicht mehr da ist (statt still zu verschwinden). */
  goneBanner(sel, after) {
    return h('div', { id: 'rroutegone' }, UI.banner([h('b', null, 'Route nicht mehr vorhanden: '), '„' + (sel.name || 'Route') + '“ gibt es nicht mehr (die Tour wurde gelöscht). Die Aufzeichnung läuft ohne Route und ohne Ansagen.'],
      [h('button', { class: 'btn sm', id: 'rroutegone-ok', onclick: async () => { await DB.kvSet(RecRoute.KEY, null).catch(() => {}); if (after) after(); } }, 'Verstanden')]));
  },
};

/** Kurzes Rückmelde-Ruckeln (Hülle; ohne Berechtigung, über die Ansicht). Im Browser: nichts. */
function recHaptic() { try { if (window.MTApp && MTApp.haptic) MTApp.haptic(); } catch (e) { /* egal */ } }

/** 2.7.0: Bedienung mit Fingern, Handschuh, Tastatur und Bildschirmleser.
    Ursache der Unzuverlässigkeit von „gedrückt halten zum Beenden“ (1.8.7 bis 2.6.4): Android meldet nach etwa 0,4 bis 0,5 s ruhigen Haltens einen
    „langen Druck“ (Ereignis contextmenu). Der alte Knopf hat darauf das Halten ABGEBROCHEN – wer still hielt, kam nie über den halben Ring;
    nur wer den Finger dabei etwas bewegte (dann erkennt Android keinen langen Druck), kam durch. Hier wird der lange Druck nur unterdrückt
    (touchstart mit preventDefault, contextmenu verhindert), der Finger wird festgehalten (Pointer-Capture), und ein Neuaufbau der Anzeige im
    Sekundentakt berührt die Bedienelemente nicht. */
const RecGest = {
  /** Gemeinsame Grundlage: langen Druck/Markieren/Scrollen auf el verhindern. */
  quiet(el) {
    el.addEventListener('touchstart', e => { if (e.cancelable) e.preventDefault(); }, { passive: false });
    el.addEventListener('contextmenu', e => e.preventDefault());
  },
  /** Klick ohne vorangehenden Fingerdruck = Tastatur (Enter/Leertaste) oder Bildschirmleser (Doppeltippen). */
  keyClick(el, fn) {
    let last = -1e9;
    ['pointerdown', 'pointerup'].forEach(ev => el.addEventListener(ev, () => { last = performance.now(); }, true));
    el.addEventListener('click', e => { if (e.detail > 0 || performance.now() - last < 60) return; e.preventDefault(); fn(); });      // Maus: der Klick folgt im selben Takt auf das Loslassen
  },
  /** Gedrückt halten: fn nach ms. Fortschritt als CSS-Variable --hold (0…1) auf el.
      opt.tapMode(): true = statt Halten genügt ein Tipp (z. B. „Weiter“), dann opt.onTap() beim Loslassen auf dem Element. */
  hold(el, ms, fn, opt) {
    opt = opt || {};
    const tapMode = () => !!(opt.tapMode && opt.tapMode());
    let t0 = 0, raf = 0, pid = null, tapPid = null;
    const set = f => el.style.setProperty('--hold', String(f));
    const reset = () => { if (raf) cancelAnimationFrame(raf); raf = 0; pid = null; set(0); el.classList.remove('holding'); };
    RecGest.quiet(el);
    let x0 = 0, y0 = 0;
    el.addEventListener('pointerdown', e => {
      if (!e.isPrimary) { reset(); tapPid = null; return; }      // zweiter Finger/Handballen (z. B. in der Tasche): abbrechen
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      try { el.setPointerCapture(e.pointerId); } catch (x) { /* egal */ }
      if (tapMode()) { tapPid = e.pointerId; return; }
      if (raf) return;
      pid = e.pointerId; t0 = performance.now(); x0 = e.clientX; y0 = e.clientY; el.classList.add('holding');
      const step = () => { const f = Math.min(1, (performance.now() - t0) / ms); set(f); if (f >= 1) { reset(); recHaptic(); fn(); } else raf = requestAnimationFrame(step); };
      raf = requestAnimationFrame(step);
    });
    el.addEventListener('pointermove', e => { if (e.pointerId === pid && Math.hypot(e.clientX - x0, e.clientY - y0) > 28) reset(); });      // gewischt statt gehalten: zählt nicht
    el.addEventListener('pointerup', e => {
      if (tapPid !== null && e.pointerId === tapPid) {
        tapPid = null; const r = el.getBoundingClientRect();
        if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom && tapMode() && opt.onTap) opt.onTap();
        return;
      }
      if (e.pointerId === pid) reset();
    });
    ['pointercancel', 'lostpointercapture'].forEach(ev => el.addEventListener(ev, e => { if (e.pointerId === tapPid) tapPid = null; if (e.pointerId === pid) reset(); }));
    return { reset };
  },
  /** Zum Bestätigen schieben: Griff knob in der Leiste track; ab frac (0…1) des Wegs beim Loslassen fn, sonst federt er zurück. */
  slide(track, knob, frac, fn) {
    let pid = null, x0 = 0, dx = 0, max = 1, armed = false;
    const paint = () => { const f = Math.max(0, Math.min(1, dx / max)); track.style.setProperty('--slide', String(f)); knob.style.transform = 'translateX(' + Math.round(dx) + 'px)'; };
    const back = () => { pid = null; dx = 0; armed = false; track.classList.remove('dragging', 'armed'); paint(); };
    RecGest.quiet(knob);
    knob.addEventListener('pointerdown', e => {
      if (!e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0) || pid !== null) return;
      pid = e.pointerId; x0 = e.clientX; dx = 0;
      max = Math.max(1, track.clientWidth - knob.offsetWidth - 2 * knob.offsetLeft);
      try { knob.setPointerCapture(pid); } catch (x) { /* egal */ }
      track.classList.add('dragging');
    });
    knob.addEventListener('pointermove', e => {
      if (e.pointerId !== pid) return;
      dx = Math.max(0, Math.min(max, e.clientX - x0)); paint();
      const a = dx >= frac * max;
      if (a !== armed) { armed = a; track.classList.toggle('armed', a); if (a) recHaptic(); }
    });
    knob.addEventListener('pointerup', e => {
      if (e.pointerId !== pid) return;
      if (dx >= frac * max) { pid = null; dx = max; paint(); track.classList.remove('dragging'); track.classList.add('done'); fn(); }
      else back();
    });
    ['pointercancel', 'lostpointercapture'].forEach(ev => knob.addEventListener(ev, e => { if (e.pointerId === pid) back(); }));
    return { back };
  },
};

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
    const planned = (await Tours.list()).filter(t => t.status === 'planned');
    const routeBox = h('div', { class: 'routebox' });
    let rr = await RecRoute.ensure(st);      // gemerkte Route wieder in die Hülle laden (nach Neustart, nach dem Beenden einer älteren Aufzeichnung)
    if (rr.restored) toast('Route „' + (rr.sel.name || 'Route') + '“ ist wieder aktiv');
    const drawRoute = () => {
      routeBox.innerHTML = '';
      const info = RecRoute.native() || {};
      if (rr.gone && !info.has && !info.name) routeBox.append(RecRoute.goneBanner(rr.sel, () => { rr = {}; drawRoute(); }));
      if (info.has || info.name || info.points) routeBox.append(UI.list([UI.row({ icon: 'compass', title: info.name || 'Geplante Route', sub: 'Die App sagt Abbiegungen an und warnt, wenn du vom Weg abkommst.', id: 'rroutesel',
          trail: h('button', { class: 'btn sm', onclick: async () => { await RecRoute.clear(); TourHelp.disarmPlan(); rr = {}; drawRoute(); } }, 'Entfernen') })]),
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
        await RecRoute.set({ kind: 'gpx', name: nm }, RecRoute.text(a.pts)); Junctions.load(sp); TourHelp.disarmPlan(); rr = {};
        if (a.sport) sport = a.sport; name.value = nm; drawChips(); drawRoute();
        toast('Route „' + nm + '“ ist aktiv – Ansagen eingeschaltet');
      } catch (e) { toast(e.message, 6000); }
    }
    async function startWith0(t) { TourHelp.armPlan(t); const pts = await Tours.points(t.id); await RecRoute.set({ kind: 'tour', id: t.id, name: t.name }, RecRoute.text(pts)); Junctions.load(Geo.simplify(pts, 3)); rr = {}; sport = t.sport; name.value = t.name; drawChips(); drawRoute(); }
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
    // Pause: nur durch Halten (0,6 s, Balken füllt sich); Weiter: ein Tipp. Tastatur/Bildschirmleser: Rückfrage.
    const HOLD_PAUSE = 600;
    const pIco = h('span', { class: 'pi' }), pLbl = h('b', { class: 'pl' }), pHint = h('small', { class: 'ph' });
    const pause = h('button', { class: 'rbtn pause', id: 'rpause' }, h('i', { class: 'hfill', 'aria-hidden': 'true' }), pIco, pLbl, pHint);
    const doPause = () => { MTApp.pauseRecording(); setTimeout(tick, 300); };
    const doResume = () => { MTApp.resumeRecording(); setTimeout(tick, 300); };
    const isPaused = () => st.state === 'paused';
    const pauseHold = RecGest.hold(pause, HOLD_PAUSE, () => { if (!isPaused()) doPause(); }, { tapMode: isPaused, onTap: doResume });
    RecGest.keyClick(pause, async () => { if (isPaused()) doResume(); else if (await confirmBox('Aufzeichnung pausieren?', 'Während der Pause wird nichts mitgeschrieben. Mit „Weiter“ geht es weiter.', 'Pausieren')) doPause(); });
    const ib = (cls, id, ico, label, fn) => h('button', { class: cls, id, onclick: fn }, h('span', { html: Ico.svg(ico, 30) }), label);
    const photoBtn = ib('rbtn', 'rphoto', 'camera', 'Foto', () => { MTApp.takePhoto(); });
    const pinBtn = ib('rbtn sm', 'rpin', 'pin', 'Pin setzen', () => addPin(st, false));
    const pinPhBtn = ib('rbtn sm', 'rpinph', 'chat', 'Foto mit Text', () => addPin(st, true));
    const vidBtn = ib('rbtn', 'rvideo', 'video', 'Video', () => { if (MTApp.takeVideo) MTApp.takeVideo(); else toast('Video braucht die neueste App-Version.'); });
    // Beenden: Griff nach rechts schieben (ab 80 % des Wegs). Tastatur/Bildschirmleser: Enter bzw. Doppeltippen öffnet eine Rückfrage.
    const knob = h('button', { class: 'ss-knob', id: 'rstopknob', 'aria-label': 'Aufzeichnung beenden. Nach rechts schieben – oder mit Enter beziehungsweise Doppeltippen eine Rückfrage öffnen.', html: Ico.svg('stop', 24) + '<i aria-hidden="true">›</i>' });
    const stopBar = h('div', { class: 'slidestop', id: 'rstop' }, h('i', { class: 'ss-fill', 'aria-hidden': 'true' }), h('span', { class: 'ss-txt', 'aria-hidden': 'true' }, 'Zum Beenden schieben', h('i', null, '›››')), knob);
    RecGest.slide(stopBar, knob, 0.8, () => finish());
    RecGest.keyClick(knob, async () => { if (await confirmBox('Aufzeichnung beenden?', 'Die Aufzeichnung wird beendet und als Tour gespeichert.', 'Beenden')) finish(); });
    const routeLine = h('div', { class: 'rroute', id: 'rroute', hidden: true });
    box.append(mapEl, h('div', { class: 'pad' }, routeLine, big, grid, gps,
      h('div', { class: 'rbtns main' }, pause, photoBtn, vidBtn),
      h('div', { class: 'rbtns sub' }, pinBtn, pinPhBtn),
      h('div', { class: 'stopgap' }), stopBar));
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
    stop_ = () => { window.removeEventListener('photos-changed', onMarks); window.removeEventListener('pins-changed', onMarks); pauseHold.reset(); prevStop(); };
    drawMarks().catch(() => {});
    let first = true;
    // Route zum Nachgehen: gemerkte Auswahl sicherstellen, deutlich zeichnen (weiß umrandet, durchgezogen), Name und „Zeigen“ unter der Karte
    const rr = await RecRoute.ensure(st).catch(() => ({}));
    if (!map) return;
    const ri = (() => { try { return JSON.parse(MTApp.routePoints() || '[]'); } catch (e) { return []; } })();
    if (ri.length > 1) {
      const rp = ri.map(p => Array.isArray(p) ? p : [p.lat, p.lon]);
      L.polyline(rp, { color: '#fff', weight: 9, opacity: .9, interactive: false }).addTo(map);
      L.polyline(rp, { color: '#1565c0', weight: 5, opacity: .95, interactive: false }).addTo(map);
      line.bringToFront();
      mapEl.dataset.route = String(rp.length);
      const fit = () => { if (!map) return; map.invalidateSize(); const b = L.latLngBounds(rp); if (st.lat != null) b.extend([st.lat, st.lon]); map.fitBounds(b, { padding: [16, 16], maxZoom: 16 }); };
      fit(); if (!mapEl.clientHeight) setTimeout(fit, 300);      // Karte noch ohne Größe (Seite im Aufbau): später noch einmal einpassen
      first = false;
      const nm = (RecRoute.native() || {}).name || (rr.sel && rr.sel.name) || 'Route';
      routeLine.hidden = false;
      routeLine.append(h('span', { html: Ico.svg('compass', 18) }), h('span', { class: 'rr-n' }, 'Route: ' + nm), h('button', { class: 'btn sm', id: 'rroutefit', onclick: () => { fit(); } }, 'Ganze Route'));
      if (rr.restored) toast('Route „' + nm + '“ ist wieder aktiv');
    } else if (rr.gone) { routeLine.hidden = false; routeLine.append(RecRoute.goneBanner(rr.sel, () => { routeLine.hidden = true; routeLine.innerHTML = ''; })); }
    async function tick() {
      const s = stat();
      if (s.state === 'idle') return Nav.render();
      if (s.state === 'finished') return Nav.render();
      st = s;
      big.textContent = F.clock(s.active_s);
      grid.innerHTML = '';
      // Aufstieg und Abstieg nebeneinander (gleiche Rechnung in der Hülle: Mittel über 3 Höhen, Schwelle 3 m); Tempo steht klein in der Statuszeile
      grid.append(UI.figs([[F.km(s.dist_m), 'Strecke'], [s.alt_m != null ? F.m(s.alt_m) : '–', 'Höhe'], ['↑ ' + F.m(s.up_m), 'Aufstieg'], [s.down_m != null ? '↓ ' + F.m(s.down_m) : '↓ –', 'Abstieg']], { big: true, cols: 2 }));
      const sig = s.fix_age_s >= 0 && s.fix_age_s < 20;
      const tempo = s.state !== 'paused' && s.speed_ms ? (s.speed_ms * 3.6).toFixed(1).replace('.', ',') + ' km/h · ' : '';
      gps.textContent = s.state === 'paused' ? 'Pausiert – es wird nichts mitgeschrieben.' : tempo + (sig ? 'GPS-Signal gut' + (s.fix_acc_m > 0 ? ', auf ' + s.fix_acc_m + ' m genau' : '') : 'GPS-Signal wird gesucht …');
      if (shown !== s.state) {      // nur bei Wechsel neu beschriften – die Taste selbst bleibt dasselbe Element (sonst gingen Berührungen verloren)
        shown = s.state;
        const p = s.state === 'paused';
        state.classList.toggle('paused', p); state.lastChild.textContent = p ? 'Pause' : 'Aufzeichnung läuft';
        pauseHold.reset();
        pIco.innerHTML = Ico.svg(p ? 'play' : 'pause', 30); pLbl.textContent = p ? 'Weiter' : 'Pause'; pHint.textContent = p ? 'antippen' : 'halten';
        pause.classList.toggle('resume', p);
        pause.setAttribute('aria-label', p ? 'Weiter aufzeichnen' : 'Pause – gedrückt halten (Tastatur: Rückfrage)');
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
          await RecRoute.done(st.start);
          MTApp.discardRecording();
          toast('Diese Tour war schon gespeichert.');
          return Nav.go('/tour/' + r.tour.id);
        }
        await TourHelp.attachPlan(r.tour);
        await RecRoute.done(st.start);      // 2.7.0: die vor dem Start gewählte Route ist mit dieser Tour erledigt
        const pins = (await DB.kvGet('recPins', [])) || [];
        if (pins.length) { r.tour.pins = pins; await Tours.save(r.tour); await DB.kvSet('recPins', []); }
        await handlePhotoQueue();
        await Photos.assignAll();
        MTApp.discardRecording();
        toast('Tour gespeichert ✓');
        Nav.go('/tour/' + r.tour.id);
        Senden.auto(r.tour);      // 2.5.0: nur wenn „Neue Aufzeichnungen automatisch senden“ eingeschaltet ist; still, im Hintergrund
      } catch (e) {
        toast('Speichern fehlgeschlagen: ' + e.message + ' – die Aufzeichnung bleibt erhalten.', 7000);
        Nav.render();
      }
    } finally { window.__saving = false; }
  }

  function unsaved(st) {
    box.append(h('div', { class: 'pad' }, UI.empty({ icon: 'save', title: 'Aufzeichnung noch nicht gespeichert', text: 'Eine beendete Aufzeichnung liegt noch auf dem Handy. Speichere sie als Tour oder verwirf sie.', actions: [
      h('button', { class: 'btn pri', onclick: () => saveFinished() }, 'Als Tour speichern'),
      h('button', { class: 'btn danger', onclick: async () => { if (await confirmBox('Aufzeichnung verwerfen?', 'Sie wird gelöscht (eine Sicherungskopie bleibt auf dem Handy).', 'Verwerfen')) { await RecRoute.done(st.start); MTApp.discardRecording(); Nav.render(); } } }, 'Verwerfen')] })));
  }

  const st = stat();
  if (st.state === 'recording' || st.state === 'paused') await active(st); else await idle(st);
  return stop_;
};
