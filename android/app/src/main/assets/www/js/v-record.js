'use strict';
/* Aufzeichnen: GPS-Spur im Hintergrund (Vordergrunddienst der Hülle), Fotos unterwegs, Sprachansagen auf geplanter Route. */
Views['/rec'] = async root => {
  const box = h('div', { class: 'rec' });
  root.append(topbar('Aufzeichnen'), box);
  if (!window.MTApp) { box.append(h('div', { class: 'empty hero' }, h('div', { class: 'big' }, '●'), h('h2', null, 'Nur in der Android-App'), h('p', null, 'Die GPS-Aufzeichnung läuft im Hintergrund und braucht die installierte App.'))); return; }
  let timer = null, map = null, line = null, me = null, lastPts = 0;
  const stat = () => { try { return JSON.parse(MTApp.status()); } catch (e) { return { state: 'idle' }; } };
  const stop_ = () => { clearInterval(timer); timer = null; if (map) { map.remove(); map = null; } };

  async function idle(st) {
    stop_(); box.innerHTML = '';
    if (st.state === 'finished' || (st.unsent && st.state === 'idle')) return unsaved(st);
    let sport = sessionStorage.getItem('recSport') || 'hike';
    const name = h('input', { type: 'text', placeholder: 'Name (optional)', value: sessionStorage.getItem('recName') || '' });
    const chips = h('div', { class: 'chips wrap' });
    const drawChips = () => { chips.innerHTML = ''; Sports.list.filter(s => s[0] !== 'mountaineering').forEach(s => chips.append(h('button', { class: 'chip' + (sport === s[0] ? ' on' : ''), onclick: () => { sport = s[0]; drawChips(); } }, s[2] + ' ' + s[1]))); };
    drawChips();
    const ri = (() => { try { return JSON.parse(MTApp.routeInfo() || '{}'); } catch (e) { return {}; } })();
    const planned = (await Tours.list()).filter(t => t.status === 'planned');
    const routeBox = h('div', { class: 'card pad' });
    const drawRoute = () => {
      routeBox.innerHTML = '';
      const info = (() => { try { return JSON.parse(MTApp.routeInfo() || '{}'); } catch (e) { return {}; } })();
      if (info.name || info.points) routeBox.append(h('div', { class: 'row' }, h('div', { style: { flex: 1 } }, h('b', null, '🧭 ' + (info.name || 'Geplante Route')), h('small', { class: 'muted' }, ' Sprachansagen sind aktiv')),
        h('button', { class: 'btn sm', onclick: () => { MTApp.clearRoute(); drawRoute(); } }, 'Entfernen')),
        h('div', { class: 'row' }, h('label', { class: 'sw' }, h('input', { type: 'checkbox', checked: Set_.get('guide') !== false, onchange: async e => { await Set_.set('guide', e.target.checked); MTApp.setGuide(e.target.checked); } }), ' Wege ansagen'), h('button', { class: 'btn sm', onclick: () => MTApp.guideTest() }, '🔊 Test')));
      else routeBox.append(h('b', null, '🧭 Route mit Ansagen'), h('p', { class: 'muted' }, 'Wähle eine geplante Tour: Die App sagt dann Abbiegungen an und warnt, wenn du vom Weg abkommst.'),
        planned.length ? h('select', { onchange: async e => { const t = planned.find(x => x.id === e.target.value); if (t) { startWith0(t); } } }, h('option', { value: '' }, 'Route wählen …'), planned.map(t => h('option', { value: t.id }, t.name + ' · ' + F.km(t.dist)))) : h('small', { class: 'muted' }, 'Noch keine geplante Tour. Im Reiter „Planen“ eine erstellen.'));
    };
    async function startWith0(t) { const pts = await Tours.points(t.id); const sp = Geo.simplify(pts, 3); MTApp.setRoute(sp.map(p => p.lat.toFixed(6) + ',' + p.lon.toFixed(6)).join(';'), t.name); sport = t.sport; name.value = t.name; drawChips(); drawRoute(); }
    void ri;
    drawRoute();
    const warn = h('div');
    const check = () => {
      warn.innerHTML = '';
      if (!MTApp.hasPermission()) warn.append(h('div', { class: 'banner' }, '📍 Für die Aufzeichnung braucht die App den Standort.', h('button', { class: 'btn sm pri', onclick: () => MTApp.requestPermission() }, 'Standort erlauben')));
      else if (!st.gps) warn.append(h('div', { class: 'banner' }, '📡 GPS ist ausgeschaltet. Bitte in den Android-Schnellmenü einschalten.'));
    };
    check(); window.addEventListener('mtperm', check, { once: true });
    box.append(h('div', { class: 'pad' }, warn, h('h3', null, 'Sportart'), chips, h('label', { class: 'fld' }, 'Name', name), routeBox,
      h('button', { class: 'bigstart', onclick: () => {
        if (!MTApp.hasPermission()) { MTApp.requestPermission(); return; }
        MTApp.setGuide(Set_.get('guide') !== false);
        MTApp.startRecording(sport, name.value.trim());
        sessionStorage.removeItem('recSport'); sessionStorage.removeItem('recName');
        setTimeout(() => Nav.render(), 400);
      } }, h('span', null, '●'), 'Aufzeichnung starten'),
      h('p', { class: 'muted small' }, 'Die Aufzeichnung läuft auch bei ausgeschaltetem Bildschirm weiter. Für lange Touren: Akku-Optimierung für diese App ausschalten.'),
      h('button', { class: 'btn sm', onclick: () => MTApp.openBatterySettings() }, '🔋 Akku-Einstellungen')));
  }

  async function active(st) {
    box.innerHTML = '';
    const mapEl = h('div', { class: 'map rmap' });
    const big = h('div', { class: 'bigtime' }), grid = h('div', { class: 'stats' });
    const pause = h('button', { class: 'rbtn', onclick: () => { st.state === 'paused' ? MTApp.resumeRecording() : MTApp.pauseRecording(); setTimeout(tick, 300); } });
    const photoN = h('span');
    box.append(mapEl, h('div', { class: 'pad' }, big, grid,
      h('div', { class: 'rbtns' }, pause, h('button', { class: 'rbtn', onclick: () => { MTApp.takePhoto(); } }, h('span', null, '📷'), 'Foto', photoN), h('button', { class: 'rbtn stop', onclick: finish }, h('span', null, '■'), 'Beenden'))));
    map = MapKit.create(mapEl, { zoom: 16 });
    line = L.polyline([], { color: '#e65100', weight: 5 }).addTo(map);
    me = L.circleMarker([0, 0], { radius: 8, color: '#fff', weight: 3, fillColor: '#1565c0', fillOpacity: 1 });
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
      const c = (v, l) => grid.append(h('div', null, h('b', null, v), h('small', null, l)));
      c(F.km(s.dist_m), 'Strecke'); c('↑ ' + F.m(s.up_m), 'Aufstieg'); c(s.alt_m != null ? F.m(s.alt_m) : '–', 'Höhe'); c(s.speed_ms ? (s.speed_ms * 3.6).toFixed(1).replace('.', ',') + ' km/h' : '–', 'Tempo');
      c(s.fix_acc_m > 0 ? '±' + s.fix_acc_m + ' m' : '–', 'GPS-Genauigkeit'); c(s.state === 'paused' ? 'Pause' : (s.fix_age_s >= 0 && s.fix_age_s < 20 ? 'ok' : 'Suche …'), 'Signal');
      pause.innerHTML = ''; pause.append(h('span', null, s.state === 'paused' ? '▶' : '❚❚'), s.state === 'paused' ? 'Weiter' : 'Pause');
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
      if (!await confirmBox('Aufzeichnung beenden?', 'Die Tour wird gespeichert und die Fotos werden zugeordnet.', 'Beenden')) return;
      const nm = st.name || '';
      MTApp.stopRecording(nm);
      stop_();
      setTimeout(() => saveFinished(), 500);
    }
  }

  async function saveFinished() {
    const st = stat();
    const gpx = MTApp.takeFinished();
    if (!gpx || gpx.length < 100) { MTApp.discardRecording(); toast('Zu wenige Punkte – nichts gespeichert.'); return Nav.render(); }
    try {
      const acts = Parse.gpx(gpx);
      if (!acts.length || acts[0].pts.length < 2) throw new Error('Zu wenige Punkte');
      const a = acts[0];
      const sport = Sports.norm(st.sport || a.rawSport) === 'other' && st.sport ? st.sport : Sports.norm(st.sport || a.rawSport);
      const r = await Tours.add({ name: st.name || a.name, sport, pts: a.pts, src: 'rec' });
      await handlePhotoQueue();
      await Photos.assignAll();
      MTApp.discardRecording();
      toast(r.dup ? 'Diese Tour war schon gespeichert.' : 'Tour gespeichert ✓');
      Nav.go('/tour/' + r.tour.id);
    } catch (e) {
      toast('Speichern fehlgeschlagen: ' + e.message + ' – die Aufzeichnung bleibt erhalten.', 7000);
      Nav.render();
    }
  }

  function unsaved(st) {
    box.append(h('div', { class: 'pad' }, h('div', { class: 'banner' }, '💾 Es liegt eine beendete Aufzeichnung vor, die noch nicht gespeichert wurde.'),
      h('button', { class: 'btn pri', onclick: () => saveFinished() }, 'Jetzt als Tour speichern'),
      h('button', { class: 'btn danger', onclick: async () => { if (await confirmBox('Aufzeichnung verwerfen?', 'Sie wird gelöscht (eine Sicherungskopie bleibt auf dem Handy).', 'Verwerfen')) { MTApp.discardRecording(); Nav.render(); } } }, 'Verwerfen')));
  }

  const st = stat();
  if (st.state === 'recording' || st.state === 'paused') await active(st); else await idle(st);
  return stop_;
};
