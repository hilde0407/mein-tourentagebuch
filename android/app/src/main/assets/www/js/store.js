'use strict';
/* Touren und Fotos speichern, Duplikate erkennen, Fotos den Touren zuordnen. */
const Tours = {
  cache: null,
  async list() { if (!Tours.cache) Tours.cache = (await DB.all('tours')).sort((a, b) => (b.start || 0) - (a.start || 0)); return Tours.cache; },
  invalidate() { Tours.cache = null; },
  autoName(sport, start) {
    if (!start) return Sports.label(sport);
    const hh = new Date(start).getHours();
    const part = hh < 11 ? 'am Morgen' : hh < 14 ? 'am Mittag' : hh < 18 ? 'am Nachmittag' : 'am Abend';
    return Sports.label(sport) + ' ' + part + ' · ' + F.dshort(start);
  },
  /** Spur speichern. Gibt {tour, dup} zurück; dup=true, wenn es die Tour schon gab. */
  async add(o) {
    const pts = o.pts.filter(p => isFinite(p.lat) && isFinite(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180);
    if (pts.length < 2) throw new Error('Zu wenige Punkte');
    const st = Geo.stats(pts);
    const all = await Tours.list();
    if (o.srcId) { const e = all.find(t => t.srcId === o.srcId); if (e) return { tour: e, dup: true }; }
    if (st.start) {
      const e = all.find(t => t.status !== 'planned' && t.start && Math.abs(t.start - st.start) < 90000 && Math.abs(t.dist - st.dist) < Math.max(100, st.dist * 0.03));
      if (e) return { tour: e, dup: true };
    }
    const id = o.id || uid();
    const bb = Geo.bbox(pts);
    const t = {
      id, name: (o.name && o.name.trim()) || Tours.autoName(o.sport, st.start), sport: o.sport || 'other', status: o.status || 'done',
      start: st.start || o.start || Date.now(), end: st.end, dur: st.dur, moving: st.moving, dist: o.dist || st.dist, up: st.up, down: st.down,
      maxAlt: st.maxAlt, minAlt: st.minAlt, lat: pts[0].lat, lon: pts[0].lon, bbox: bb, src: o.src || 'file', srcId: o.srcId || '',
      note: o.note || '', fav: false, hidden: false, timed: !!st.start, created: Date.now(),
    };
    if (o.status === 'planned' && !st.start) t.start = o.start || Date.now();
    await DB.put('tours', t);
    await DB.put('tracks', { id, lat: pts.map(p => p.lat), lon: pts.map(p => p.lon), ele: pts.map(p => p.ele), t: pts.map(p => p.t), seg: pts.map(p => p.newSeg ? 1 : 0) });
    Tours.invalidate();
    return { tour: t, dup: false };
  },
  async points(id) {
    const r = await DB.get('tracks', id);
    if (!r) return [];
    return r.lat.map((la, i) => ({ lat: la, lon: r.lon[i], ele: r.ele[i], t: r.t[i], newSeg: !!(r.seg && r.seg[i]) }));
  },
  async save(t) { await DB.put('tours', t); Tours.invalidate(); },
  async remove(id) {
    const ph = await DB.byIndex('photos', 'tour', id);
    for (const p of ph) { p.tour = ''; await DB.put('photos', p); }
    await DB.del('tours', id); await DB.del('tracks', id); Tours.invalidate();
  },
  async recalc(id) {
    const t = await DB.get('tours', id), pts = await Tours.points(id);
    const st = Geo.stats(pts);
    Object.assign(t, { dist: st.dist, dur: st.dur, moving: st.moving, up: st.up, down: st.down, maxAlt: st.maxAlt, minAlt: st.minAlt });
    await Tours.save(t); return t;
  },
};

const Photos = {
  async all() { return (await DB.all('photos')).sort((a, b) => (a.ts || 0) - (b.ts || 0)); },
  url: id => '/photo/' + id + '.jpg',
  thumb: id => '/thumb/' + id + '.jpg',
  /** Meta-Daten aus der Hülle speichern und zuordnen (Zeit + Position). */
  async addMeta(list) {
    let n = 0;
    for (const m of list) {
      const old = await DB.get('photos', m.id);
      if (old) continue;
      await DB.put('photos', { id: m.id, name: m.name, ts: m.ts || 0, lat: m.lat != null ? m.lat : null, lon: m.lon != null ? m.lon : null, w: m.w, h: m.h, src: m.src || '', tour: '', pos: m.lat != null ? 'exif' : 'none', note: '' });
      n++;
    }
    await Photos.assignAll();
    return n;
  },
  /** Jedes Foto ohne Tour der Tour zuordnen, in deren Zeitfenster es fällt; fehlende Position aus der Spur berechnen. */
  async assignAll(force) {
    const tours = (await Tours.list()).filter(t => t.status !== 'planned' && t.timed && t.end);
    const margin = (+Set_.get('photoMargin') || 20) * 60000;
    const cams = (+Set_.get('camOffset') || 0) * 3600000;
    const ph = await DB.all('photos');
    const changed = [];
    const tcache = {};
    for (const p of ph) {
      if (!p.ts || (p.tour && !force)) continue;
      const ts = p.ts + cams * (p.src === 'kamera' ? 0 : 0);
      const cands = tours.filter(t => ts >= t.start - margin && ts <= t.end + margin);
      if (!cands.length) continue;
      cands.sort((a, b) => Math.abs((a.start + a.end) / 2 - ts) - Math.abs((b.start + b.end) / 2 - ts));
      const t = cands.find(c => ts >= c.start && ts <= c.end) || cands[0];
      p.tour = t.id;
      if (p.lat == null || p.pos === 'track') {
        const pts = tcache[t.id] || (tcache[t.id] = await Tours.points(t.id));
        const g = Geo.at(pts, ts, margin);
        if (g) { p.lat = g.lat; p.lon = g.lon; p.pos = 'track'; }
      }
      changed.push(p);
    }
    if (changed.length) await DB.putMany('photos', changed);
    return changed.length;
  },
  async remove(id) { await DB.del('photos', id); try { await Native.call('deletePhoto', { id }); } catch (e) { /* ohne Hülle */ } },
};
