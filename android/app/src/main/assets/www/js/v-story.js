'use strict';
/* Erzählung: die Tour als Zeitleiste (Start, Fotogruppen, Ziel) mit Ortsnamen, Fotostandorten auf der Karte und Kommentaren zu Fotos. */
const Comments = {
  async all() { return DB.kvGet('comments', {}); },
  async add(pid, text) {
    const all = await Comments.all(), l = all[pid] || (all[pid] = []);
    if (l.length >= 200) throw new Error('Zu viele Kommentare zu diesem Foto');
    l.push({ id: Date.now() + '' + l.length, ts: Date.now(), text });
    await DB.kvSet('comments', all); return l;
  },
  async remove(pid, cid) {
    const all = await Comments.all(); all[pid] = (all[pid] || []).filter(c => c.id !== cid);
    if (!all[pid].length) delete all[pid];
    await DB.kvSet('comments', all); return all[pid] || [];
  },
};
const Places = {
  last: 0,
  async name(lat, lon) {
    const key = lat.toFixed(3) + ',' + lon.toFixed(3), cache = await DB.kvGet('places', {});
    if (key in cache) return cache[key] || null;
    const wait = 1100 - (Date.now() - Places.last); if (wait > 0) await new Promise(r => setTimeout(r, wait));
    Places.last = Date.now();
    const r = await Native.http({ url: `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=14&addressdetails=1&accept-language=de&lat=${lat}&lon=${lon}`, headers: { 'User-Agent': 'MeinTourentagebuch/1.0' } });
    if (r.status !== 200) throw new Error('Ortssuche: HTTP ' + r.status);
    const a = (JSON.parse(r.body).address) || {};
    const n = ['hamlet', 'village', 'suburb', 'town', 'city_district', 'city', 'municipality', 'county'].map(k => a[k]).find(Boolean) || '';
    const c2 = await DB.kvGet('places', {}); c2[key] = n; await DB.kvSet('places', c2);
    return n || null;
  },
};
Views['/story'] = async (root, [id]) => {
  const t = await DB.get('tours', id);
  if (!t) { root.append(topbar('Erzählung', { back: true }), h('div', { class: 'empty' }, h('p', null, 'Diese Tour gibt es nicht mehr.'))); return; }
  const pts = await Tours.points(id);
  const photos = (await DB.byIndex('photos', 'tour', id)).sort((a, b) => a.ts - b.ts);
  let CM = await Comments.all();
  const ev = [{ ts: t.start, kind: 'start', txt: 'Start', pos: pts.length ? [pts[0].lat, pts[0].lon] : null }];
  let grp = null;
  photos.forEach(p => {
    if (grp && p.ts - grp.last < 600000) { grp.ph.push(p); grp.last = p.ts; if (!grp.pos && p.lat != null) grp.pos = [p.lat, p.lon]; return; }
    grp = { ts: p.ts, last: p.ts, kind: 'ph', ph: [p], pos: p.lat != null ? [p.lat, p.lon] : null };
    ev.push(grp);
  });
  ev.push({ ts: t.end || t.start, kind: 'end', txt: 'Ziel', pos: pts.length ? [pts[pts.length - 1].lat, pts[pts.length - 1].lon] : null });
  ev.sort((a, b) => a.ts - b.ts);
  const icon = k => ({ start: '🏁', end: '🎯', ph: '📷' })[k];
  const rel = ts => { const m = Math.max(0, Math.round((ts - t.start) / 60000)); return `+${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')} h`; };
  const mapEl = h('div', { class: 'map tmap' });
  const tl = h('div', { class: 'stl pad' });
  const cmText = e => e.ph.flatMap(p => CM[p.id] || []).map(c => h('div', { class: 'scm' }, '💬 ' + c.text));
  const draw = () => {
    tl.innerHTML = '';
    ev.forEach((e, i) => {
      const body = h('div', { class: 'sbody' }, h('div', { class: 'stt' }, icon(e.kind) + ' ' + (e.kind === 'ph' ? e.ph.length + (e.ph.length > 1 ? ' Fotos' : ' Foto') : e.txt)), h('div', { class: 'splc muted' }, e.place ? '📌 ' + e.place : ''));
      if (e.kind === 'ph') {
        body.append(h('div', { class: 'sph-row' }, e.ph.slice(0, 8).map(p => h('button', { class: 'sph', 'aria-label': 'Foto öffnen', onclick: ev2 => { ev2.stopPropagation(); openPhoto(p); } },
          h('img', { src: Photos.thumb(p.id), alt: '', loading: 'lazy' }), (CM[p.id] || []).length ? h('b', null, '💬 ' + CM[p.id].length) : null)), e.ph.length > 8 ? h('span', { class: 'muted' }, '+' + (e.ph.length - 8)) : null), ...cmText(e));
      }
      const row = h('div', { class: 'stev', 'data-e': i, onclick: () => { if (e.pos) { map.setView(e.pos, 16); mapEl.scrollIntoView({ behavior: 'smooth', block: 'center' }); } } },
        h('div', { class: 'stm' }, h('b', null, F.time(e.ts)), h('small', { class: 'muted' }, rel(e.ts))), body);
      tl.append(row);
    });
  };
  function openPhoto(p) {
    const list = h('div'), inp = h('input', { type: 'text', maxlength: 1000, placeholder: 'Kommentar schreiben …' });
    const fill = () => {
      list.innerHTML = '';
      const l = CM[p.id] || [];
      if (!l.length) list.append(h('p', { class: 'muted' }, 'Noch keine Kommentare.'));
      l.forEach(c => list.append(h('div', { class: 'scm2' }, h('small', { class: 'muted' }, F.date(c.ts) + ' ' + F.time(c.ts) + ' '), h('button', { class: 'ico', 'aria-label': 'Löschen', onclick: async () => { await Comments.remove(p.id, c.id); CM = await Comments.all(); fill(); draw(); } }, '🗑'), h('div', null, c.text))));
    };
    const send = async () => {
      const v = inp.value.trim(); if (!v) return;
      try { await Comments.add(p.id, v); CM = await Comments.all(); inp.value = ''; fill(); draw(); } catch (e) { toast(String(e.message || e)); }
    };
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') send(); });
    sheet('📷 Foto', h('div', null, h('img', { src: Photos.url(p.id), alt: '', style: { width: '100%', maxHeight: '45vh', objectFit: 'contain', borderRadius: '8px' } }), list,
      h('div', { class: 'row' }, inp, h('button', { class: 'btn pri sm', onclick: send }, 'Senden'))));
    fill();
  }
  root.append(h('header', { class: 'top' }, h('button', { class: 'ico', 'aria-label': 'Zurück', onclick: () => Nav.back() }, '←'), h('h1', null, t.name), h('span', { class: 'sp' })), mapEl,
    h('div', { class: 'pad' }, h('div', { class: 'sub' }, `${F.date(t.start)} · ${F.km(t.dist)} · ↑ ${F.m(t.up)}${t.dur ? ' · ' + F.dur(t.dur) : ''}`)), tl);
  const map = MapKit.create(mapEl);
  if (pts.length) { const ln = MapKit.line(pts, MapKit.routeColor(t.sport, '#2e7d32'), 5).addTo(map); map.fitBounds(ln.getBounds(), { padding: [24, 24] }); }
  ev.forEach(e => { if (e.pos && e.kind !== 'ph') MapKit.dot(e.pos[0], e.pos[1], e.kind === 'start' ? '#2e7d32' : '#c62828', e.kind === 'start' ? 'S' : 'Z').addTo(map); });
  photos.filter(p => p.lat != null).forEach(p => MapKit.photoMarker(p, () => openPhoto(p)).addTo(map));
  setTimeout(() => { try { if (map.getContainer().isConnected) map.invalidateSize(); } catch (e) { /* Ansicht schon verlassen */ } }, 200);
  draw();
  let alive = true;
  (async () => {      // Ortsnamen der Stationen nachladen (zwischengespeichert; ohne Internet bleibt die Zeile leer)
    for (let i = 0; i < ev.length && alive; i++) {
      const e = ev[i]; if (!e.pos) continue;
      try { const n = await Places.name(e.pos[0], e.pos[1]); if (n && alive) { e.place = n; const box = tl.querySelector(`.stev[data-e="${i}"] .splc`); if (box) box.textContent = '📌 ' + n; } } catch (er) { return; }
    }
  })();
  return () => { alive = false; };
};
