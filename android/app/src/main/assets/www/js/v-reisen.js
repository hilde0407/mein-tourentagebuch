'use strict';
/* Reisen (automatisch erkannt) und Alben (Schlagworte/Tags an Touren) – wie in „Meine Touren“.
   Reise: Touren weit weg von zu Hause (Regeln wie „Meine Touren“). */
const Reisen = {
  DEF: { days: 4 },
  async settings() { return Object.assign({}, Reisen.DEF, await DB.kvGet('tripSet', {})); },
  dayNo: ms => { const d = new Date(ms); return Math.round(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() / 86400000); },
  /** Orte, an denen man sich ständig aufhält (wie „Meine Touren“): Gebiete von ca. 30 km mit sehr vielen Tourstarts in vielen Monaten. Ein von Hand eingetragener Heimatort gilt stattdessen. */
  homes(all) {
    const la = parseFloat(Set_.get('homeLat')), lo = parseFloat(Set_.get('homeLon'));
    if (isFinite(la) && isFinite(lo) && (la || lo)) return [[la, lo]];
    const ts = all.filter(t => t.lat != null && t.start);
    if (!ts.length) return [];
    const cl = [];
    ts.forEach(t => {
      const d = new Date(t.start), mo = d.getFullYear() + '-' + d.getMonth(), c = cl.find(c => Geo.dist(c[0], c[1], t.lat, t.lon) <= 30000);
      if (c) { c[0] += (t.lat - c[0]) / (c[2] + 1); c[1] += (t.lon - c[1]) / (c[2] + 1); c[2]++; c[3].add(mo); } else cl.push([t.lat, t.lon, 1, new Set([mo])]);
    });
    const need = Math.max(8, Math.floor(ts.length / 10)), hs = cl.filter(c => c[2] >= need && c[3].size >= 8).map(c => [c[0], c[1]]);
    if (hs.length) return hs;
    const med = a => { const b = a.slice().sort((x, y) => x - y), m = b.length >> 1; return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2; };
    return [[med(ts.map(t => t.lat)), med(ts.map(t => t.lon))]];
  },
  /** Reisen wie in „Meine Touren“: Touren, die von allen Heimatorten mehr als 60 km entfernt sind; eine Tour zu Hause beendet die Reise.
      Mehr als 1 Tag Pause beginnt eine neue Reise, außer es sind höchstens 7 Tage und die Tour liegt höchstens 150 km von einer Tour der Reise entfernt. */
  detect(all, homes, cfg) {
    const ts = all.filter(t => t.status !== 'planned' && !t.hidden && t.lat != null && t.start).sort((a, b) => a.start - b.start);
    if (ts.length < 3 || !homes || !homes.length) return [];
    const out = []; let cur = [];
    const flush = () => {
      if (cur.length) { const days = new Set(cur.map(t => Reisen.dayNo(t.start))); if (days.size >= 2) out.push(Reisen.sum(cur, days.size)); }
      cur = [];
    };
    ts.forEach(t => {
      const far = Math.min(...homes.map(h => Geo.dist(h[0], h[1], t.lat, t.lon))) > 60000;
      if (!far) { flush(); return; }
      if (cur.length) {
        const gap = Reisen.dayNo(t.start) - Reisen.dayNo(cur[cur.length - 1].start);
        const close = cur.some(q => Geo.dist(q.lat, q.lon, t.lat, t.lon) <= 150000);
        if (gap > 1 && !(gap <= 7 && close)) flush();
      }
      cur.push(t);
    });
    flush();
    return out.filter(r => r.days >= Math.max(2, cfg.days)).reverse();
  },
  SER_RE: /^(.*?)[\s\-–—:,.]*\b(?:Tag|Etappe|Day|Stage|Jour|Étape|Día|Etapa)\s*0?(\d{1,2})\b/i,
  /** Mehrtagestouren wie in „Meine Touren“: Touren mit gleichem Namensanfang und Nummer („Alpenüberquerung – Tag 3“, „… Etappe 2“); mindestens zwei verschiedene Nummern. */
  async multiday(all) {
    const g = {};
    all.filter(t => t.status !== 'planned' && !t.hidden && t.start).forEach(t => {
      const m = Reisen.SER_RE.exec((t.name || '').trim());
      if (!m || !m[1].trim()) return;
      const k = m[1].trim().toLowerCase();
      (g[k] = g[k] || { name: m[1].trim(), items: [] }).items.push({ t, n: +m[2] });
    });
    const out = [];
    Object.values(g).forEach(v => {
      v.items.sort((a, b) => a.n - b.n || a.t.start - b.t.start);
      if (v.items.length < 2 || new Set(v.items.map(x => x.n)).size < 2) return;
      const r = Reisen.sum(v.items.map(x => x.t)); r.id = 'm:' + v.items[0].t.id; r.multi = true; r.name = v.name; r.nums = {};
      v.items.forEach(x => { r.nums[x.t.id] = x.n; });
      r.first = Math.min(...r.tours.map(t => t.start)); r.last = Math.max(...r.tours.map(t => t.start));
      r.days = new Set(r.tours.map(t => Reisen.dayNo(t.start))).size;
      out.push(r);
    });
    return out.sort((a, b) => b.first - a.first);
  },
  sum(ts, days) {
    const s = k => ts.reduce((a, t) => a + (t[k] || 0), 0);
    return { id: ts[0].id, tours: ts, days: days || new Set(ts.map(t => Reisen.dayNo(t.start))).size, first: ts[0].start, last: ts[ts.length - 1].start, km: s('dist'), up: s('up'), dur: s('moving') || s('dur') };
  },
  /** „Juni 2026“ bzw. „Juni–Juli 2026“. */
  monthYear(a, b) {
    const A = new Date(a), B = new Date(b), m = d => d.toLocaleDateString('de-DE', { month: 'long' });
    if (A.getFullYear() === B.getFullYear() && A.getMonth() === B.getMonth()) return m(A) + ' ' + A.getFullYear();
    if (A.getFullYear() === B.getFullYear()) return m(A) + '–' + m(B) + ' ' + A.getFullYear();
    return m(A) + ' ' + A.getFullYear() + ' – ' + m(B) + ' ' + B.getFullYear();
  },
  /** Anzeigename: eigener Name, sonst „Ort Monat Jahr“ (z. B. La Réunion Juni 2026), sonst der Zeitraum. */
  title(r, names, places) {
    if (names[r.id]) return names[r.id];
    if (r.multi) return r.name;
    return places[r.id] ? places[r.id] + ' ' + Reisen.monthYear(r.first, r.last) : 'Reise ' + Reisen.range(r.first, r.last);
  },
  /** Ort der Reise per Ortssuche (Land, in D/A/CH das Bundesland) – einmal ermitteln und merken. */
  async place(r) {
    const places = await DB.kvGet('tripPlace', {});
    if (r.id in places) return places[r.id];
    const t = r.tours[Math.floor(r.tours.length / 2)];
    const x = await Native.http({ url: `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=5&addressdetails=1&accept-language=de&lat=${t.lat}&lon=${t.lon}`, headers: { 'User-Agent': 'MeinTourentagebuch/1.0' } });
    if (x.status !== 200) throw new Error('HTTP ' + x.status);
    const a = (JSON.parse(x.body).address) || {};
    const n = (['de', 'at', 'ch', 'it'].includes(a.country_code) && a.state) || a.country || a.state || '';
    const c2 = await DB.kvGet('tripPlace', {}); c2[r.id] = n; await DB.kvSet('tripPlace', c2);
    return n;
  },
  /** „Tag 2 · Etappe 2/5“ für eine Tour innerhalb einer Mehrtagestour. */
  stage(r, t) {
    const i = r.tours.findIndex(x => x.id === t.id);
    return 'Tag ' + ((r.nums && r.nums[t.id]) || (Reisen.dayNo(t.start) - Reisen.dayNo(r.first) + 1)) + ' · Etappe ' + (i + 1) + '/' + r.tours.length;
  },
  range(a, b) {
    const A = new Date(a), B = new Date(b), m = d => d.toLocaleDateString('de-DE', { month: 'long' });
    if (A.getFullYear() === B.getFullYear() && A.getMonth() === B.getMonth()) return A.getDate() + '.–' + B.getDate() + '. ' + m(A) + ' ' + A.getFullYear();
    if (A.getFullYear() === B.getFullYear()) return A.getDate() + '. ' + m(A) + ' – ' + B.getDate() + '. ' + m(B) + ' ' + A.getFullYear();
    return F.dshort(a) + ' – ' + F.dshort(b);
  },
  tags: all => { const m = new Map(); all.filter(t => !t.hidden).forEach(t => (t.tags || []).forEach(g => { const a = m.get(g) || []; a.push(t); m.set(g, a); })); return m; },

  /** Tags einer Tour bearbeiten (Sheet). */
  editTags(t, done) {
    let tags = (t.tags || []).slice();
    const box = h('div'), inp = h('input', { type: 'text', placeholder: 'Neues Schlagwort, z. B. Urlaub Südtirol 2026', autocapitalize: 'sentences' });
    let known = [];
    const draw = () => {
      box.innerHTML = '';
      box.append(h('div', { class: 'chips wrap' }, tags.map(g => h('button', { class: 'chip on', 'aria-label': g + ' entfernen', onclick: () => { tags = tags.filter(x => x !== g); draw(); } }, g + ' ✕'))));
      const rest = known.filter(g => !tags.includes(g));
      if (rest.length) box.append(h('p', { class: 'muted small' }, 'Vorhandene Alben:'), h('div', { class: 'chips wrap' }, rest.map(g => h('button', { class: 'chip', onclick: () => { tags.push(g); draw(); } }, g))));
    };
    const add = () => { const v = inp.value.trim(); if (v && !tags.includes(v)) { tags.push(v); } inp.value = ''; draw(); };
    const s = sheet('Tags & Alben', h('div', null, box,
      h('div', { class: 'row' }, inp, h('button', { class: 'btn', onclick: add }, 'Hinzufügen')),
      h('div', { class: 'row end' }, h('button', { class: 'btn pri', onclick: async () => { add(); t.tags = tags; await Tours.save(t); s.close(); if (done) done(); } }, 'Speichern'))));
    Tours.list().then(all => { known = [...Reisen.tags(all).keys()].sort((a, b) => a.localeCompare(b, 'de')); draw(); });
    draw();
  },
};

Views['/reisen'] = async root => {
  const all = (await Tours.list()).filter(t => t.status !== 'planned' && !t.hidden);
  const cfg = await Reisen.settings(), names = await DB.kvGet('tripNames', {}), places = await DB.kvGet('tripPlace', {});
  const home = Reisen.homes(all);
  const body = h('div', { class: 'pad' });
  root.append(topbar('Reisen & Alben', { back: true, noMenu: true }), body);
  const multi = await Reisen.multiday(all);
  let tab = 'reisen';
  const draw = () => {
    body.innerHTML = '';
    body.append(h('div', { class: 'chips' }, [['reisen', 'Reisen'], ['alben', 'Alben']].map(([k, l]) => h('button', { class: 'chip' + (tab === k ? ' on' : ''), onclick: () => { tab = k; draw(); } }, l))));
    if (tab === 'reisen') {
      const trips = Reisen.detect(all, home, cfg);
      if (!Reisen._busy) { Reisen._busy = true; (async () => { let ch = false; for (const r of trips) { if (names[r.id] || r.id in places) continue; try { places[r.id] = await Reisen.place(r); ch = true; await new Promise(k => setTimeout(k, 1100)); } catch (e) { break; } } Reisen._busy = false; if (ch && tab === 'reisen' && body.isConnected) draw(); })(); }
      body.append(h('p', { class: 'muted small' }, `Als Reise gelten Touren mehr als 60 km von deinem Zuhause (automatisch erkannt, oder der Heimatort aus den Einstellungen) an mindestens ${Math.max(2, cfg.days)} Tagen; bis 7 Tage Pause im gleichen Gebiet gehören dazu.`));
      if (!trips.length) body.append(h('div', { class: 'empty' }, h('p', null, 'Keine Reisen gefunden.')));
      body.append(h('div', { class: 'list' }, trips.map(r => h('a', { class: 'li', href: '#/reise/' + r.id },
        h('span', { class: 'li-i' }, '🧳'), h('span', { class: 'li-t' }, h('b', null, Reisen.title(r, names, places)),
          h('small', null, `${Reisen.range(r.first, r.last)} · ${r.tours.length} Touren an ${r.days} Tagen · ${F.km(r.km)} · ↑ ${F.m(r.up)}`))))));
      if (multi.length) body.append(h('h3', null, 'Mehrtagestouren'), h('p', { class: 'muted small' }, 'Erkannt an Namen wie „… Tag 3“ oder „… Etappe 2“.'),
        h('div', { class: 'list' }, multi.map(r => h('a', { class: 'li', href: '#/reise/' + r.id }, h('span', { class: 'li-i' }, '🥾'), h('span', { class: 'li-t' }, h('b', null, Reisen.title(r, names, places)),
          h('small', null, `${r.tours.length} Etappen · ${Reisen.range(r.first, r.last)} · ${F.km(r.km)} · ↑ ${F.m(r.up)}`))))));
      const num = (k, lab, min) => h('label', { class: 'fld' }, lab, h('input', { type: 'number', min, value: cfg[k], onchange: async e => { const v = Math.max(min, parseInt(e.target.value, 10) || Reisen.DEF[k]); cfg[k] = v; await DB.kvSet('tripSet', cfg); draw(); } }));
      body.append(h('details', null, h('summary', null, 'Erkennung anpassen'), num('days', 'Mindestzahl Tage einer Reise', 2)));
    } else {
      const m = Reisen.tags(all), list = [...m.entries()].map(([g, ts]) => [g, Reisen.sum(ts.slice().sort((a, b) => a.start - b.start))]).sort((a, b) => b[1].last - a[1].last);
      body.append(h('p', { class: 'muted small' }, 'Alben entstehen aus Schlagworten, die du einer Tour gibst (Tour öffnen → ⋮ → „Tags & Alben“).'));
      if (!list.length) body.append(h('div', { class: 'empty' }, h('p', null, 'Noch keine Alben.')));
      body.append(h('div', { class: 'list' }, list.map(([g, r]) => h('a', { class: 'li', href: '#/album/' + encodeURIComponent(g) },
        h('span', { class: 'li-i' }, '🏷️'), h('span', { class: 'li-t' }, h('b', null, g), h('small', null, `${r.tours.length} Touren · ${F.km(r.km)} · ${Reisen.range(r.first, r.last)}`))))));
    }
  };
  draw();
};

/** Gemeinsame Seite für Reise und Album: Karte, Summen, Fotos, Touren. */
async function groupPage(root, title, tours, opts) {
  const sorted = tours.slice().sort((a, b) => a.start - b.start), r = Reisen.sum(sorted);
  const mapEl = h('div', { class: 'map tmap' }), body = h('div', { class: 'pad' });
  const ttl = h('h1', null, title);
  root.append(h('header', { class: 'top' }, h('button', { class: 'ico', 'aria-label': 'Zurück', onclick: () => Nav.back() }, '←'), ttl, h('span', { class: 'sp' }),
    opts.rename ? h('button', { class: 'ico', 'aria-label': 'Umbenennen', onclick: opts.rename }, '✏️') : null), mapEl, body);
  const photos = [];
  for (const t of sorted) photos.push(...(await DB.byIndex('photos', 'tour', t.id)));
  photos.sort((a, b) => a.ts - b.ts);
  const kpi = (v, l) => h('div', { class: 'kpi' }, h('b', null, v), h('small', null, l));
  body.append(h('div', { class: 'sub' }, Reisen.range(r.first, r.last)),
    h('div', { class: 'kpis' }, kpi(sorted.length, 'Touren'), kpi(r.days, r.days === 1 ? 'Tag' : 'Tage'), kpi(F.km(r.km), 'Strecke'), kpi(F.m(r.up), 'Aufstieg'), kpi(F.dur(r.dur), 'Zeit unterwegs'), kpi(photos.length, 'Fotos')));
  if (photos.length) body.append(h('div', { class: 'row' }, h('h3', { class: 'grow' }, 'Fotos'), h('button', { class: 'btn sm', id: 'gshow', onclick: async () => Show.open(await Show.forTours(sorted)) }, '▶ Diashow')), h('div', { class: 'strip' }, photos.slice(0, 40).map((p, i) => h('button', { class: 'th', 'aria-label': 'Foto ' + (i + 1), onclick: () => Lightbox.open(photos, i) }, h('img', { src: Photos.thumb(p.id), alt: '', loading: 'lazy' })))));
  // Touren je Tag
  body.append(h('h3', null, 'Touren'), h('div', { class: 'list' }, sorted.map(t => h('a', { class: 'li', href: '#/tour/' + t.id },
    h('span', { class: 'li-i' }, Sports.icon(t.sport)), h('span', { class: 'li-t' }, h('b', null, t.name), opts.multi ? h('small', { class: 'stage' }, Reisen.stage(opts.multi, t)) : null, h('small', null, F.date(t.start) + ' · ' + F.km(t.dist) + ' · ↑ ' + F.m(t.up)))))));
  if (opts.extra) body.append(opts.extra);
  const map = MapKit.create(mapEl), bounds = [];
  for (const t of sorted) {
    const pts = await Tours.points(t.id); if (pts.length < 2) continue;
    MapKit.line(pts, MapKit.routeColor(t.sport, '#2e7d32'), 3).addTo(map).on('click', () => Nav.go('/tour/' + t.id));
    pts.forEach((p, i) => { if (i % 5 === 0) bounds.push([p.lat, p.lon]); });
  }
  if (bounds.length) map.fitBounds(L.latLngBounds(bounds), { padding: [24, 24] }); else mapEl.hidden = true;
  setTimeout(() => map.invalidateSize(), 200);
}

Views['/reise'] = async (root, [id]) => {
  const all = (await Tours.list()).filter(t => t.status !== 'planned' && !t.hidden);
  const cfg = await Reisen.settings(), names = await DB.kvGet('tripNames', {}), places = await DB.kvGet('tripPlace', {});
  const home = Reisen.homes(all);
  const r = id.startsWith('m:') ? (await Reisen.multiday(all)).find(x => x.id === id) : Reisen.detect(all, home, cfg).find(x => x.id === id);
  if (!r) { root.append(topbar('Reise', { back: true, noMenu: true }), h('div', { class: 'empty' }, h('p', null, 'Diese Reise gibt es nicht mehr (Erkennung oder Heimatort geändert).'))); return; }
  if (!r.multi && !names[id] && !(id in places)) { try { places[id] = await Reisen.place(r); } catch (e) { /* offline: Zeitraum */ } }
  await groupPage(root, Reisen.title(r, names, places), r.tours, {
    multi: r.multi ? r : null,
    rename: async () => {
      const v = await askText('Name der Reise', 'Name', names[id] || '', 'Speichern'); if (v == null) return;
      if (v.trim()) names[id] = v.trim(); else delete names[id];
      await DB.kvSet('tripNames', names); Nav.render();
    },
    extra: h('div', { class: 'row end' }, h('button', { class: 'btn', onclick: async () => {
      const name = Reisen.title(r, names, places).trim();
      if (!await confirmBox('Als Album speichern', `Allen ${r.tours.length} Touren wird das Schlagwort „${name}“ gegeben.`, 'Speichern')) return;
      for (const t of r.tours) { t.tags = [...new Set([...(t.tags || []), name])]; await Tours.save(t); }
      toast('Album „' + name + '“ angelegt'); Nav.go('/album/' + encodeURIComponent(name));
    } }, '🏷️ Als Album speichern')),
  });
};

Views['/album'] = async (root, [tag0]) => {
  const tag = decodeURIComponent(tag0 || '');
  const ts = (await Tours.list()).filter(t => !t.hidden && (t.tags || []).includes(tag));
  if (!ts.length) { root.append(topbar('Album', { back: true, noMenu: true }), h('div', { class: 'empty' }, h('p', null, 'Dieses Album ist leer.'))); return; }
  await groupPage(root, tag, ts, {
    rename: async () => {
      const v = ((await askText('Name des Albums', 'Name', tag, 'Speichern')) || '').trim(); if (!v || v === tag) return;
      for (const t of ts) { t.tags = [...new Set(t.tags.map(g => g === tag ? v : g))]; await Tours.save(t); }
      location.replace('#/album/' + encodeURIComponent(v));
    },
  });
};
