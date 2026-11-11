'use strict';
/* Einlesen von GPX, TCX, FIT (auch aus ZIP/GZ). Ergebnis: [{name, sport, pts:[{lat,lon,ele,t,newSeg}], srcId?}] */
const Sports = {
  list: [
    ['hike', 'Wandern', '🥾'], ['walk', 'Spazieren', '🚶'], ['mtb', 'Mountainbike', '🚵'], ['bike', 'Tourenrad', '🚴'],
    ['racebike', 'Rennrad', '🚴'], ['ebike', 'E-Bike', '⚡'], ['run', 'Laufen', '🏃'], ['ski', 'Ski & Schnee', '⛷️'],
    ['mountaineering', 'Bergsteigen', '🧗'], ['other', 'Sonstiges', '📍'],
  ],
  label: id => (Sports.list.find(s => s[0] === id) || Sports.list[9])[1],
  icon: id => (Sports.list.find(s => s[0] === id) || Sports.list[9])[2],
  /** Verschiedene Bezeichnungen (Komoot, Strava, Garmin, Bosch, GPX-Typ) auf unsere Sportarten abbilden. */
  norm(s) {
    s = String(s || '').toLowerCase().replace(/[\s_-]+/g, '');
    if (!s) return 'other';
    if (s.includes('race') || s.includes('roadbik') || s === 'road') return 'racebike';
    if (/^e(touring|mountain|mtb|bike|bicycle|ride|gravel|racebike)/.test(s) || s.includes('ebike') || s.includes('emtb') || s.includes('pedelec')) return 'ebike';
    if (s.includes('mtb') || s.includes('mountainbik') || s.includes('gravel')) return 'mtb';
    if (s.includes('bic') || s.includes('bik') || s.includes('ride') || s.includes('cycl')) return 'bike';
    if (s.includes('run') || s.includes('jog') || s.includes('trail')) return 'run';
    if (s.includes('mountaineer') || s.includes('climb')) return 'mountaineering';
    if (s.includes('ski') || s.includes('snow') || s.includes('nordic')) return 'ski';
    if (s.includes('hik') || s.includes('wander') || s.includes('trek')) return 'hike';
    if (s.includes('walk') || s.includes('spazier')) return 'walk';
    return 'other';
  },
};

const Parse = {
  decodeXml: s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&'),
  num: s => { const v = parseFloat(s); return isNaN(v) ? null : v; },
  /** Pulswert übernehmen, aber nur wenn er plausibel ist (Fühler liefern sonst 0 oder 255). */
  hr: v => { const n = parseInt(v, 10); return isFinite(n) && n >= 30 && n <= 240 ? n : null; },

  gpx(text) {
    const out = [];
    const trks = text.match(/<trk[\s>][\s\S]*?<\/trk>/g) || [];
    let list = trks.map(t => ({ xml: t, kind: 'trk' }));
    if (!list.length) (text.match(/<rte[\s>][\s\S]*?<\/rte>/g) || []).forEach(r => list.push({ xml: r, kind: 'rte' }));
    for (const it of list) {
      const nm = (it.xml.match(/<name>([\s\S]*?)<\/name>/) || [])[1];
      const ty = (it.xml.match(/<type>([\s\S]*?)<\/type>/) || [])[1];
      const pts = [];
      const segs = it.kind === 'trk' ? (it.xml.match(/<trkseg[\s>][\s\S]*?<\/trkseg>/g) || [it.xml]) : [it.xml];
      segs.forEach((sg, si) => {
        const re = /<(?:trkpt|rtept)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:trkpt|rtept)>)/g;
        let m, first = true;
        while ((m = re.exec(sg))) {
          const la = Parse.num((m[1].match(/lat="([^"]+)"/) || [])[1]), lo = Parse.num((m[1].match(/lon="([^"]+)"/) || [])[1]);
          if (la == null || lo == null) continue;
          const body = m[2] || '';
          const el = Parse.num((body.match(/<ele>([^<]*)<\/ele>/) || [])[1]);
          const tm = (body.match(/<time>([^<]*)<\/time>/) || [])[1];
          const t = tm ? Date.parse(tm) : null;
          pts.push({ lat: la, lon: lo, ele: el, t: isNaN(t) ? null : t, hr: Parse.hr((body.match(/<(?:\w+:)?hr>([^<]*)<\/(?:\w+:)?hr>/) || [])[1]), newSeg: first && si > 0 });
          first = false;
        }
      });
      if (pts.length) out.push({ name: nm ? Parse.decodeXml(nm.replace(/<!\[CDATA\[|\]\]>/g, '')).trim() : '', sport: Sports.norm(ty), rawSport: ty || '', pts });
    }
    return out;
  },

  tcx(text) {
    const out = [];
    (text.match(/<Activity\b[\s\S]*?<\/Activity>/g) || []).forEach(a => {
      const sp = (a.match(/<Activity[^>]*Sport="([^"]*)"/) || [])[1];
      const pts = [];
      const re = /<Trackpoint>([\s\S]*?)<\/Trackpoint>/g; let m;
      while ((m = re.exec(a))) {
        const b = m[1];
        const la = Parse.num((b.match(/<LatitudeDegrees>([^<]*)</) || [])[1]), lo = Parse.num((b.match(/<LongitudeDegrees>([^<]*)</) || [])[1]);
        if (la == null || lo == null) continue;
        const t = Date.parse((b.match(/<Time>([^<]*)</) || [])[1]);
        pts.push({ lat: la, lon: lo, ele: Parse.num((b.match(/<AltitudeMeters>([^<]*)</) || [])[1]), t: isNaN(t) ? null : t,
          hr: Parse.hr((b.match(/<HeartRateBpm[^>]*>\s*<Value>([^<]*)</) || [])[1]) });
      }
      if (pts.length) out.push({ name: '', sport: Sports.norm(sp), rawSport: sp || '', pts });
    });
    return out;
  },

  /** FIT-Dateien (Garmin, Wahoo, Bosch Flow, Suunto-Export …): liest „record“-Nachrichten und die Sportart. */
  fit(buf) {
    const dv = new DataView(buf.buffer || buf, buf.byteOffset || 0, buf.byteLength);
    const hdr = dv.getUint8(0);
    let pos = hdr, end = Math.min(dv.byteLength - 2, hdr + dv.getUint32(4, true));
    const defs = {}; const pts = []; let sport = '', subsport = '', lastTs = 0, nm = '';
    const FIT_EPOCH = 631065600000;
    while (pos < end) {
      const rh = dv.getUint8(pos++);
      let local, isDef = false, comp = false, hasDev = false;
      if (rh & 0x80) { comp = true; local = (rh >> 5) & 3; }
      else { local = rh & 15; isDef = !!(rh & 0x40); hasDev = !!(rh & 0x20); }
      if (isDef) {
        pos++; const le = dv.getUint8(pos++) === 0; const gm = dv.getUint16(pos, le); pos += 2;
        const nf = dv.getUint8(pos++); const fields = [];
        for (let i = 0; i < nf; i++) { fields.push({ n: dv.getUint8(pos), s: dv.getUint8(pos + 1), t: dv.getUint8(pos + 2) }); pos += 3; }
        let devSize = 0;
        if (hasDev) { const nd = dv.getUint8(pos++); for (let i = 0; i < nd; i++) { devSize += dv.getUint8(pos + 1); pos += 3; } }
        defs[local] = { gm, le, fields, devSize };
      } else {
        const d = defs[local]; if (!d) break;
        const v = {};
        for (const f of d.fields) {
          const o = pos; pos += f.s;
          if (d.gm === 20 || d.gm === 18 || d.gm === 12 || d.gm === 34) {
            const bt = f.t & 0x1f;
            if (f.s === 4 && (bt === 0x85 - 0x80 || bt === 5 || bt === 6 || bt === 12)) {
              if (bt === 5 || bt === 6) { const x = dv.getUint32(o, d.le); if (x !== 0xFFFFFFFF) v[f.n] = x; }
              else { const x = dv.getInt32(o, d.le); if (x !== 0x7FFFFFFF) v[f.n] = x; }
            } else if (f.s === 4) { const x = dv.getUint32(o, d.le); if (x !== 0xFFFFFFFF) v[f.n] = (f.t === 0x85 || f.t === 0x8B) ? dv.getInt32(o, d.le) : x; }
            else if (f.s === 2) { const x = dv.getUint16(o, d.le); if (x !== 0xFFFF) v[f.n] = x; }
            else if (f.s === 1) { const x = dv.getUint8(o); if (x !== 0xFF) v[f.n] = x; }
          }
        }
        pos += d.devSize;
        if (comp) { /* komprimierter Zeitstempel: nur für Folgepunkte */ }
        if (d.gm === 20) {
          if (v[253] != null) lastTs = v[253];
          if (v[0] != null && v[1] != null) {
            const alt = v[78] != null ? v[78] / 5 - 500 : (v[2] != null ? v[2] / 5 - 500 : null);
            pts.push({ lat: v[0] * 180 / 2147483648, lon: v[1] * 180 / 2147483648, ele: alt, t: lastTs ? FIT_EPOCH + lastTs * 1000 : null, hr: Parse.hr(v[3]) });
          }
        } else if (d.gm === 12 || d.gm === 18) {
          if (d.gm === 12 && v[0] != null) sport = sport || String(v[0]);
          if (d.gm === 18 && v[5] != null) sport = String(v[5]);
          if (d.gm === 18 && v[6] != null) subsport = String(v[6]);
        }
      }
    }
    const names = { 1: 'run', 2: 'bike', 11: 'walk', 17: 'hike', 13: 'ski', 5: 'other', 31: 'mountaineering', 15: 'other', 19: 'ski', 37: 'other' };
    let sp = names[sport] || 'other';
    if (sp === 'bike' && subsport === '8') sp = 'mtb'; else if (sp === 'bike' && subsport === '7') sp = 'racebike'; else if (sp === 'bike' && subsport === '28') sp = 'ebike';
    return pts.length ? [{ name: nm, sport: sp, rawSport: sport, pts }] : [];
  },

  /** Beliebige Datei (ArrayBuffer/Uint8Array) – erkennt Format am Inhalt, entpackt ZIP/GZ. */
  async any(name, data) {
    const u8 = data instanceof Uint8Array ? data : new Uint8Array(data);
    const l = (name || '').toLowerCase();
    if (u8.length > 3 && u8[0] === 0x1f && u8[1] === 0x8b) return Parse.any(l.replace(/\.gz$/, ''), fflate.gunzipSync(u8));
    if (u8.length > 3 && u8[0] === 0x50 && u8[1] === 0x4b) {          // ZIP
      const files = fflate.unzipSync(u8);
      let all = [];
      for (const fn of Object.keys(files)) {
        if (!/\.(gpx|tcx|fit)(\.gz)?$/i.test(fn)) continue;
        try { const r = await Parse.any(fn, files[fn]); r.forEach(x => { x.file = fn; }); all = all.concat(r); } catch (e) { /* nächste Datei */ }
      }
      return all;
    }
    if (u8.length > 12 && String.fromCharCode(u8[8], u8[9], u8[10], u8[11]) === '.FIT') return Parse.fit(u8);
    const text = new TextDecoder('utf-8').decode(u8);
    if (/<gpx[\s>]/i.test(text)) return Parse.gpx(text);
    if (/<TrainingCenterDatabase/i.test(text)) return Parse.tcx(text);
    if (/<kml[\s>]/i.test(text)) return Parse.kml(text);
    return [];
  },

  kml(text) {
    const out = [];
    (text.match(/<coordinates>[\s\S]*?<\/coordinates>/g) || []).forEach(c => {
      const pts = c.replace(/<\/?coordinates>/g, '').trim().split(/\s+/).map(s => s.split(',').map(Number)).filter(a => a.length >= 2 && !isNaN(a[0]))
        .map(a => ({ lat: a[1], lon: a[0], ele: a[2] || null, t: null }));
      if (pts.length > 1) out.push({ name: '', sport: 'other', pts });
    });
    return out;
  },
};
if (typeof module !== 'undefined') module.exports = { Parse, Sports };
