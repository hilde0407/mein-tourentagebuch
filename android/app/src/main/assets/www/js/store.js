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
    // Speichern nacheinander (nie gleichzeitig), sonst entstehen bei zwei parallelen Aufrufen doppelte Touren
    const p = (Tours._q || Promise.resolve()).then(() => Tours._add(o));
    Tours._q = p.catch(() => {});
    return p;
  },
  async _add(o) {
    const pts = o.pts.filter(p => isFinite(p.lat) && isFinite(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180);
    if (pts.length < 2) throw new Error('Zu wenige Punkte');
    const st = Geo.stats(pts);
    const all = await Tours.list();
    if (o.srcId) { const e = all.find(t => t.srcId === o.srcId || (t.alias && t.alias.includes(o.srcId))); if (e) return { tour: e, dup: true }; }      // alias: Kennungen zusammengeführter Doppelter (2.1.0)
    if (st.start && !o.force) {
      const e = all.find(t => t.status !== 'planned' && t.start && Math.abs(t.start - st.start) < 90000 && Math.abs(t.dist - st.dist) < Math.max(100, st.dist * 0.03));
      if (e) return { tour: e, dup: true };
    }
    const id = o.id || uid();
    const bb = Geo.bbox(pts);
    const t = {
      id, name: (o.name && o.name.trim()) || Tours.autoName(o.sport, st.start), sport: o.sport || 'other', status: o.status || 'done',
      start: st.start || o.start || Date.now(), end: st.end, dur: st.dur, moving: st.moving, dist: o.dist || st.dist,
      up: st.up, down: st.down, calcV: Tours.CALC,
      maxAlt: st.maxAlt, minAlt: st.minAlt, lat: pts[0].lat, lon: pts[0].lon, bbox: bb, src: o.src || 'file', srcId: o.srcId || '',
      note: o.note || '', fav: false, hidden: false, timed: !!st.start, created: Date.now(),
    };
    if (Array.isArray(o.tags) && o.tags.length) t.tags = [...new Set(o.tags.map(String).filter(Boolean))];      // z. B. „Schneeschuh“ (2.2.0)
    if (isFinite(o.up) && o.up != null) { t.upKomoot = o.up; t.downKomoot = isFinite(o.down) && o.down != null ? o.down : null; }      // Komoots Wert: nur Zusatzangabe
    Tours.applyHoehe(t, st);
    Object.assign(t, Tours.hrSummary(pts));
    if (o.status === 'planned' && !st.start) t.start = o.start || Date.now();
    await DB.put('tours', t);
    const trk = { id, lat: pts.map(p => p.lat), lon: pts.map(p => p.lon), ele: pts.map(p => p.ele), t: pts.map(p => p.t), seg: pts.map(p => p.newSeg ? 1 : 0) };
    if (pts.some(p => p.skip)) trk.skip = pts.map(p => p.skip ? 1 : 0);
    if (t.hrAvg) trk.hr = pts.map(p => (p.hr == null ? 0 : p.hr));      // 0 = kein Messwert an dieser Stelle
    await DB.put('tracks', trk);
    Tours.invalidate();
    return { tour: t, dup: false };
  },
  /** Woher eine Tour stammt (Tour.src) – Beschriftung für Tourseite und Listen. */
  QUELLE: { komoot: 'Komoot', strava: 'Strava', zepp: 'Zepp', rec: 'Aufzeichnung', plan: 'Planer', link: 'Link', mt: 'Meine Touren', file: 'Datei' },
  CALC: 2,      // Version der Aufstiegsrechnung (Tour.calcV und kv „calcVer“)
  /** Aufstieg/Abstieg (und Strecke) der Tour setzen. Rangfolge ab 2.1.0:
      1. Wert aus „Meine Touren“ (upMt/downMt/distMt), solange die Tour angeglichen ist (zMt = 1; setzt der Abgleich, löscht eine Korrektur der Spur von Hand),
      2. die eigene Rechnung (wie „Meine Touren“), sofern die Spur mehr als 5 Höhenpunkte hat,
      3. ersatzweise der aufbewahrte Komoot-Wert (upSrc 'komoot'), sonst die (leere) eigene Rechnung.
      st = Geo.stats(Punkte). Die Strecke setzt der Aufrufer aus st.dist; hier wird sie nur durch den Wert aus Meine Touren ersetzt. */
  applyHoehe(t, st) {
    if (t.zMt && t.upMt != null) { t.up = t.upMt; t.down = t.downMt != null ? t.downMt : st.down; t.upSrc = 'mt'; }
    else if (Hoehe.brauchbar(st.nEle)) { t.up = st.up; t.down = st.down; delete t.upSrc; }
    else if (t.upKomoot != null) { t.up = t.upKomoot; t.down = t.downKomoot != null ? t.downKomoot : st.down; t.upSrc = 'komoot'; }
    else { t.up = st.up; t.down = st.down; delete t.upSrc; }
    if (t.zMt && t.distMt) t.dist = t.distMt;
    return t;
  },
  /** Einmalige Neuberechnung bestehender Touren (Aufstieg wie in Meine Touren; Zepp „Spazieren“ → Wandern). In kleinen Portionen, wiederaufnehmbar
      (Tour.calcV = 2 nach der Bearbeitung), idempotent; ein Fehler bei einer Tour bricht den Rest nicht ab. Gibt {up, sport, n} zurück oder null, wenn nichts zu tun war. */
  async migrate(opts) {
    opts = opts || {};
    const pos = await Tours.repairPos().catch(e => { console.error('Spur-Reparatur', e); return 0; });
    const ski = await Tours.skiZaehlen().catch(e => { console.error('Ski-Zählung', e); return 0; });
    if ((await DB.kvGet('calcVer', 0)) >= Tours.CALC) return pos || ski ? { up: 0, sport: 0, n: 0, fail: 0, pos, ski } : null;
    const ids = (await DB.all('tours')).filter(t => (t.calcV || 0) < Tours.CALC).map(t => t.id);
    const res = { up: 0, sport: 0, n: ids.length, fail: 0 };
    for (let i = 0; i < ids.length; i += (opts.batch || 8)) {
      for (const id of ids.slice(i, i + (opts.batch || 8))) {
        try {
          const trk = await DB.get('tracks', id);
          let st = null;
          if (trk && trk.lat && trk.lat.length > 1) {
            const pts = trk.lat.map((la, k) => ({ lat: la, lon: trk.lon[k], ele: trk.ele ? trk.ele[k] : null, t: trk.t ? trk.t[k] : null, skip: !!(trk.skip && trk.skip[k]) }));
            st = Geo.stats(pts);
          }
          const t = await DB.get('tours', id);       // frisch lesen: zwischenzeitliche Änderungen der Oberfläche gehen nicht verloren
          if (!t) continue;
          if (t.upSrc === 'komoot' && t.upKomoot == null) { t.upKomoot = t.up; t.downKomoot = t.down; }      // alter Komoot-Wert bleibt als Zusatzangabe
          const o = { up: t.up, down: t.down };
          if (st && Hoehe.brauchbar(st.nEle)) {
            Tours.applyHoehe(t, st);
            if (Math.abs((t.up || 0) - (o.up || 0)) >= 1 || Math.abs((t.down || 0) - (o.down || 0)) >= 1) { if (t.upAlt === undefined) { t.upAlt = o.up; t.downAlt = o.down; } res.up++; }
            else { t.up = o.up; t.down = o.down; delete t.upSrc; if (o.up == null) { t.up = st.up; t.down = st.down; } }      // unter 1 m Unterschied: Wert unverändert lassen
          }
          if (t.sport === 'walk' && !t.sportMan && (t.src === 'zepp' || /^zepp:/.test(t.srcId || ''))) { t.sportAlt = t.sportAlt || 'walk'; t.sport = 'hike'; res.sport++; }
          t.calcV = Tours.CALC;
          await DB.put('tours', t);
        } catch (e) { res.fail++; console.error('Neuberechnung', id, e); }
      }
      Tours.invalidate();
      await new Promise(r => setTimeout(r, 0));
    }
    await DB.kvSet('calcVer', Tours.CALC);
    if (res.up || res.sport) await DB.kvSet('calcNote', Object.assign({}, await DB.kvGet('calcNote', null), { up: res.up, sport: res.sport }));
    Tours.invalidate();
    res.pos = pos; res.ski = ski;
    return res;
  },
  SKI: 1,       // Version der Ski-Zählung (kv „skiVer“)
  /** 2.2.0: „Ski & Schnee“ ist in Ski alpin, Skitour und Langlauf getrennt (Schneeschuh zählt als Wandern). Touren mit der alten Sammel-Sportart `ski` bleiben unverändert –
      die App speichert nicht, welche Art es war. Die genaue Art liefert der nächste Abgleich mit Meine Touren (außer bei von Hand gewählter Sportart). Hier wird nur einmal
      gezählt, damit die Startseite es sagen kann. Gibt die Zahl der noch unbestimmten Touren zurück. */
  async skiZaehlen() {
    if ((await DB.kvGet('skiVer', 0)) >= Tours.SKI) return 0;
    const n = Abgleich.skiOffen(await DB.all('tours'));
    if (n) await DB.kvSet('calcNote', Object.assign({}, await DB.kvGet('calcNote', null), { ski: n }));
    await DB.kvSet('skiVer', Tours.SKI);
    return n;
  },
  POS: 1,       // Version der Spur-Reparatur (kv „posVer“)
  /** 2.0.2: Spuren aus FIT-Dateien berichtigen. Bis 2.0.1 las der FIT-Leser Breite/Länge ohne Vorzeichen: westliche Längen (z. B. Kanaren −15,6°)
      standen als 344,4° in der Spur, Punkte ohne Position als 180°/180° (das ergab Sprünge von tausenden Kilometern). Betroffene Touren erkennt man
      an der gespeicherten Lage (lon > 180 oder lat > 90); nur deren Spuren werden gelesen. Gibt die Zahl berichtigter Touren zurück. */
  async repairPos() {
    if ((await DB.kvGet('posVer', 0)) >= Tours.POS) return 0;
    const bad = (await DB.all('tours')).filter(t => t.lon > 180 || t.lat > 90 || (t.bbox && (t.bbox[3] > 180 || t.bbox[2] > 90)));
    let n = 0;
    for (const t0 of bad) {
      try {
        const trk = await DB.get('tracks', t0.id);
        if (!trk || !trk.lat || !trk.lat.length) continue;
        const len = trk.lat.length, keep = [];
        for (let k = 0; k < len; k++) if (Math.abs(trk.lat[k]) <= 90 && trk.lon[k] <= 360 && !(trk.lat[k] === 180 || trk.lon[k] === 180)) keep.push(k);
        if (keep.length < 2) continue;
        const cut = o => { for (const key of Object.keys(o)) { const a = o[key]; if (Array.isArray(a) && a.length === len) o[key] = keep.map(k => a[k]); else if (a && typeof a === 'object' && !Array.isArray(a)) cut(a); } };
        if (keep.length < len) cut(trk);
        const west = o => { for (const key of Object.keys(o)) { const a = o[key]; if (key === 'lon' && Array.isArray(a)) o[key] = a.map(x => (x > 180 ? x - 360 : x)); else if (a && typeof a === 'object' && !Array.isArray(a)) west(a); } };
        west(trk);
        await DB.put('tracks', trk);
        const t = await DB.get('tours', t0.id), pts = await Tours.points(t0.id), st = Geo.stats(pts);
        if (!t) continue;
        Object.assign(t, { dist: st.dist, dur: st.dur, moving: st.moving, maxAlt: st.maxAlt, minAlt: st.minAlt, lat: pts[0].lat, lon: pts[0].lon, bbox: Geo.bbox(pts) }, Tours.hrSummary(pts));
        Tours.applyHoehe(t, st);
        await DB.put('tours', t); n++;
      } catch (e) { console.error('Spur-Reparatur', t0.id, e); }
    }
    await DB.kvSet('posVer', Tours.POS);
    if (n) { await DB.kvSet('calcNote', Object.assign({}, await DB.kvGet('calcNote', null), { pos: n })); Tours.invalidate(); }
    return n;
  },
  async points(id) {
    const r = await DB.get('tracks', id);
    if (!r) return [];
    return r.lat.map((la, i) => ({ lat: la, lon: r.lon[i], ele: r.ele[i], t: r.t[i], hr: (r.hr && r.hr[i]) || null, newSeg: !!(r.seg && r.seg[i]), skip: !!(r.skip && r.skip[i]) }));
  },
  /** Kennzahlen zum Puls: Mittel, Höchst- und Tiefstwert sowie die Zeit in den fünf Pulszonen. */
  hrSummary(pts) {
    const v = [];
    let prev = null, zone = [0, 0, 0, 0, 0];
    const hmax = Set_.get ? (parseInt(Set_.get('hrMax'), 10) || 0) : 0;
    const hm = hmax >= 120 && hmax <= 230 ? hmax : 190;
    for (const p of pts) {
      if (p.hr == null || !(p.hr >= 30 && p.hr <= 240)) { prev = p; continue; }
      v.push(p.hr);
      if (prev && prev.hr && p.t && prev.t) {
        const dt = (p.t - prev.t) / 1000;
        if (dt > 0 && dt < 120) zone[Tours.hrZone(p.hr, hm)] += dt;
      }
      prev = p;
    }
    if (v.length < 5) return { hrAvg: null, hrMax: null, hrMin: null, hrZones: null };
    return {
      hrAvg: Math.round(v.reduce((a, b) => a + b, 0) / v.length), hrMax: Math.max(...v), hrMin: Math.min(...v),
      hrZones: zone.map(x => Math.round(x)),
    };
  },
  /** Pulszone 0–4 (entspricht Zone 1–5) nach Anteil am Maximalpuls. */
  hrZone(bpm, hmax) { const q = bpm / hmax; return q < 0.6 ? 0 : q < 0.7 ? 1 : q < 0.8 ? 2 : q < 0.9 ? 3 : 4; },
  async save(t) { await DB.put('tours', t); Tours.invalidate(); },
  /** Puls nachtragen (z. B. bei Touren, die vor der Pulsunterstützung importiert wurden): Werte nach Zeit auf die gespeicherten Punkte legen. */
  async fillHr(id, hrPts, srcStart) {
    const trk = await DB.get('tracks', id), t = await DB.get('tours', id);
    if (!trk || !t) return false;
    const src = hrPts.filter(p => p.hr != null && p.t != null).sort((a, b) => a.t - b.t);
    t.zhr = 1;                                                    // Versuch vermerken, damit nicht bei jedem Import neu geladen wird
    if (src.length < 5) { await DB.put('tours', t); Tours.invalidate(); return false; }
    // Zeitversatz zwischen Quelle und Tour (z. B. Zeitzone/Sommerzeit bei Komoot-Touren): Werte nach Zeit seit Start zuordnen
    const t0 = trk.t.find(x => x != null);
    if (t0 == null) { await DB.put('tours', t); Tours.invalidate(); return false; }
    const shift = srcStart != null ? t0 - srcStart : 0;
    let j = 0;
    trk.hr = trk.t.map(tm => {
      if (tm == null) return 0;
      const q = tm - shift;
      while (j + 1 < src.length && src[j + 1].t <= q) j++;
      return Math.abs(src[j].t - q) <= 30000 ? src[j].hr : 0;
    });
    const pts = trk.lat.map((la, i) => ({ t: trk.t[i], hr: trk.hr[i] || null }));
    Object.assign(t, Tours.hrSummary(pts));
    if (!t.hrAvg) { delete trk.hr; await DB.put('tours', t); Tours.invalidate(); return false; }
    await DB.put('tracks', trk); await DB.put('tours', t); Tours.invalidate();
    return true;
  },
  async remove(id) {
    const ph = await DB.byIndex('photos', 'tour', id);
    for (const p of ph) { p.tour = ''; await DB.put('photos', p); }
    await DB.del('tours', id); await DB.del('tracks', id); Tours.invalidate();
  },
  /** Kennzahlen aus der Spur neu rechnen. opts.eigen = true: Die Spur wurde von Hand korrigiert (Geländemodell, Uhr-Höhen, Abschnitt ausgeschlossen,
      Original wiederhergestellt, „Kennzahlen neu berechnen“) – dann gilt wieder die eigene Rechnung, bis der nächste Abgleich mit Meine Touren die Zahlen neu setzt. */
  async recalc(id, opts) {
    const t = await DB.get('tours', id), pts = await Tours.points(id);
    const st = Geo.stats(pts);
    if (opts && opts.eigen) delete t.zMt;
    Object.assign(t, { dist: st.dist, dur: st.dur, moving: st.moving, maxAlt: st.maxAlt, minAlt: st.minAlt }, Tours.hrSummary(pts));
    Tours.applyHoehe(t, st);      // Rangfolge: Meine Touren (solange angeglichen) > eigene Rechnung > Komoot-Wert als Ersatz ohne Höhen
    await Tours.save(t); return t;
  },
};

const Photos = {
  async all() { return (await DB.all('photos')).sort((a, b) => (a.ts || 0) - (b.ts || 0)); },
  url: id => '/photo/' + id + (/v$/.test(id) ? '.mp4' : '.jpg'),
  thumb: id => '/thumb/' + id + '.jpg',
  /** Meta-Daten aus der Hülle speichern und zuordnen (Zeit + Position). */
  async addMeta(list) {
    let n = 0;
    for (const m of list) {
      const old = await DB.get('photos', m.id);
      if (old) continue;
      await DB.put('photos', { id: m.id, name: m.name, ts: m.ts || 0, lat: m.lat != null ? m.lat : null, lon: m.lon != null ? m.lon : null, w: m.w, h: m.h, src: m.src || '', video: !!m.video, dur: m.dur || 0, tour: '', pos: m.lat != null ? 'exif' : 'none', note: '' });
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
      const ts = p.ts + (p.src === 'kamera' ? 0 : cams);     // in der App aufgenommen: Gerätezeit stimmt, kein Kameraversatz
      let t, o = 0;
      const cands = tours.filter(t => ts >= t.start - margin && ts <= t.end + margin);
      if (cands.length) {
        cands.sort((a, b) => Math.abs((a.start + a.end) / 2 - ts) - Math.abs((b.start + b.end) / 2 - ts));
        t = cands.find(c => ts >= c.start && ts <= c.end) || cands[0];
      } else {
        // Rückfall: EXIF-Ortszeit ohne Zeitzone liegt evtl. um ganze/halbe Stunden neben den (korrekten) GPS-Zeiten.
        // Vorzeichen: o > 0 heißt, die Fotozeit geht o vor (Prüfzeit = ts − o). Streng im Fenster, damit nichts Falsches greift.
        let best = null;
        for (let k = 1; k <= 28; k++) for (const oo of [k * 1800000, -k * 1800000]) {
          const q = ts - oo;
          for (const c of tours) {
            if (q < c.start || q > c.end) continue;
            let d = Math.abs((c.start + c.end) / 2 - q);      // ohne GPS: Abstand zur Fenstermitte
            if (p.lat != null) {
              // mit GPS muss die Spur dem Foto nahe kommen; Spur zur Kostenbegrenzung vereinfachen
              const pts = tcache[c.id] || (tcache[c.id] = await Tours.points(c.id));
              const sp = tcache[c.id + 's'] || (tcache[c.id + 's'] = Geo.simplify(pts, 50));
              d = 1e12; for (const x of sp) d = Math.min(d, Geo.dist(p.lat, p.lon, x.lat, x.lon));
              if (d >= 1000) continue;
            }
            if (!best || Math.abs(oo) < Math.abs(best.o) || (Math.abs(oo) === Math.abs(best.o) && d < best.d)) best = { t: c, o: oo, d };
          }
        }
        if (!best) continue;
        t = best.t; o = best.o;
      }
      p.tour = t.id;
      if (o) p.tzOff = o; else delete p.tzOff;      // erkannte Zeitzonen-Abweichung, nur zur Nachvollziehbarkeit
      if (p.lat == null || p.pos === 'track') {
        const pts = tcache[t.id] || (tcache[t.id] = await Tours.points(t.id));
        const g = Geo.at(pts, ts - o, margin);
        if (g) { p.lat = g.lat; p.lon = g.lon; p.pos = 'track'; }
      }
      changed.push(p);
    }
    if (changed.length) await DB.putMany('photos', changed);
    return changed.length;
  },
  async remove(id) { await DB.del('photos', id); try { await Native.call('deletePhoto', { id }); } catch (e) { /* ohne Hülle */ } },
};
