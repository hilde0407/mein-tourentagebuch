'use strict';
/* Einlesen von GPX, TCX, FIT (auch aus ZIP/GZ). Ergebnis: [{name, sport, pts:[{lat,lon,ele,t,newSeg}], srcId?}] */
/* 2.19.0: Aktivitäten-Katalog als Tabelle (Vorlage: aktivitaeten-katalog.md, Stand 25.11.2026, aus der Sportliste der Amazfit Balance 2) – jede Zeile ist eine
   eigene Sportart: [Kategorie, Schlüssel, Name, Zeichen (wird zum Symbol, js/icons.js), Kartenfarbe]. Weitere Aktivitäten: eine Zeile ergänzen (Symbol in
   ICON_CHARS, Zuordnung in Sports.norm, ggf. Senden in calc-senden.js). Die Schlüssel bis 2.18 bleiben (hike, walk, mtb, bike …).
   Zusammengefasst wird nur noch über selbst angelegte Statistik-Gruppen (calc-statgruppen.js). */
const KATEGORIEN = [['fuss', 'Zu Fuß'], ['rad', 'Rad'], ['winter', 'Winter'], ['wasser', 'Wasser'], ['sonst', 'Outdoor & Sonstige']];
const KATALOG = [
  ['fuss', 'hike', 'Wandern', '🥾', '#2e7d32'],
  ['fuss', 'walk', 'Spazieren', '🚶', '#43a047'],
  ['fuss', 'dogwalk', 'Gassigehen', '🐕', '#7cb342'],
  ['fuss', 'mountaineering', 'Bergsteigen', '🧗', '#4e342e'],
  ['fuss', 'climbing', 'Klettern', '🪨', '#795548'],
  ['fuss', 'nordicwalking', 'Nordic Walking', '🦯', '#558b2f'],
  ['fuss', 'snowshoe', 'Schneeschuh', '🌨️', '#0277bd'],
  ['fuss', 'run', 'Laufen', '🏃', '#c62828'],
  ['fuss', 'trailrun', 'Trailrunning', '🌲', '#ad2121'],
  ['fuss', 'orienteering', 'Orientierungslauf', '🧭', '#e57373'],
  ['rad', 'bike', 'Radtour', '🚴', '#1565c0'],
  ['rad', 'commute', 'Radpendeln', '🏙️', '#42a5f5'],
  ['rad', 'racebike', 'Rennrad', '🚴', '#6a1b9a'],
  ['rad', 'mtb', 'Mountainbike', '🚵', '#e65100'],
  ['rad', 'gravel', 'Gravelbike', '🚲', '#8d6e63'],
  ['rad', 'cyclocross', 'Cyclocross', '🚲', '#ff7043'],
  ['rad', 'bmx', 'BMX', '🛞', '#ef6c00'],
  ['rad', 'ebike', 'E-Bike', '⚡', '#00838f'],
  ['rad', 'emtb', 'E-Mountainbike', '🚵', '#00695c'],
  ['winter', 'skialpin', 'Ski alpin', '🏔️', '#3949ab'],
  ['winter', 'skitour', 'Skitour', '🎿', '#ad1457'],
  ['winter', 'nordic', 'Langlauf', '❄️', '#00796b'],
  ['winter', 'snowboard', 'Snowboard', '🏂', '#283593'],
  ['winter', 'sled', 'Rodeln / Bob', '🛷', '#5d4037'],
  ['winter', 'iceskate', 'Eislaufen', '⛸️', '#4fc3f7'],
  ['winter', 'snowmobile', 'Schneemobil', '🛻', '#455a64'],
  ['winter', 'ski', 'Ski (allgemein)', '⛷️', '#37474f'],      // 2.2.0: nur noch, wenn die genaue Art unbekannt ist (früher „Ski & Schnee“); in Auswahllisten nur, wenn schon gewählt
  ['wasser', 'swim', 'Freiwasserschwimmen', '🏊', '#0288d1'],
  ['wasser', 'snorkel', 'Schnorcheln', '🤿', '#039be5'],
  ['wasser', 'kayak', 'Kajak / Kanu', '🛶', '#00897b'],
  ['wasser', 'sup', 'Stand-up-Paddling', '🏄', '#26a69a'],
  ['wasser', 'rowing', 'Rudern', '🚣', '#006064'],
  ['wasser', 'dragonboat', 'Drachenboot', '🐉', '#00838f'],
  ['wasser', 'sailing', 'Segeln', '⛵', '#1976d2'],
  ['wasser', 'boat', 'Bootfahren', '🚤', '#0d47a1'],
  ['wasser', 'waterski', 'Wasserski', '🌊', '#4dd0e1'],
  ['wasser', 'surf', 'Wellenreiten', '🏄', '#0097a7'],
  ['wasser', 'kitesurf', 'Kitesurfen', '🪁', '#00acc1'],
  ['wasser', 'wakesurf', 'Wakesurfen', '🌊', '#26c6da'],
  ['sonst', 'skateboard', 'Skateboard', '🛹', '#fb8c00'],
  ['sonst', 'inline', 'Inlineskaten / Rollschuh', '🛼', '#f57c00'],
  ['sonst', 'horse', 'Reiten', '🐎', '#6d4c41'],
  ['sonst', 'fishing', 'Angeln', '🎣', '#5c6bc0'],
  ['sonst', 'hunting', 'Jagen', '🦌', '#827717'],
  ['sonst', 'archery', 'Bogenschießen', '🏹', '#9e9d24'],
  ['sonst', 'golf', 'Golf', '⛳', '#689f38'],
  ['sonst', 'atv', 'Quad / ATV', '🚙', '#8d6e63'],
  ['sonst', 'motorbike', 'Offroad-Motorrad', '🏍️', '#bf360c'],
  ['sonst', 'other', 'Sonstiges', '📍', '#546e7a'],
];
const Sports = {
  /** [Schlüssel, Name, Zeichen] je Sportart, in der Reihenfolge des Katalogs. */
  list: KATALOG.map(r => [r[1], r[2], r[3]]),
  /** Kategorien für Auswahllisten: [id, Name, [Schlüssel …]]. */
  KAT: KATEGORIEN.map(([id, name]) => [id, name, KATALOG.filter(r => r[0] === id).map(r => r[1])]),
  /** Kartenfarbe je Sportart (MapKit.sportColor). */
  farben: () => Object.fromEntries(KATALOG.map(r => [r[1], r[4]])),
  /** Nur noch für ältere Touren gedacht – in Auswahllisten nur, wenn die Tour sie schon hat. */
  ALT: ['ski'],
  /** Kategorien mit [Schlüssel, Name, Zeichen] der Sportarten; mit: Sportart, die trotz ALT erscheinen soll (die gerade gewählte). */
  kategorien(mit) { return Sports.KAT.map(([id, name, keys]) => [id, name, keys.filter(k => !Sports.ALT.includes(k) || k === mit).map(k => Sports.list.find(s => s[0] === k))]); },
  /** Die Skiarten (feste Auswahl „Ski (alle Arten)“ für ältere Ziele und Filter). */
  SKI: ['skialpin', 'skitour', 'nordic', 'ski'],
  SCHNEESCHUH: 'Schneeschuh',
  label: id => (Sports.list.find(s => s[0] === id) || Sports.list.find(s => s[0] === 'other'))[1],
  icon: id => (Sports.list.find(s => s[0] === id) || Sports.list.find(s => s[0] === 'other'))[2],
  /** Passt eine Tour dieser Sportart zur Auswahl in einem Filter? sel: '' (alle), 'grp:ski' (alle Skiarten), 'sgrp:<id>' (eigene Statistik-Gruppe, 2.19.0)
      oder eine Sportart. Gerechnet in calc-statgruppen.js; gruppen: Liste der Statistik-Gruppen (Vorgabe: die gespeicherten). */
  passt: (sel, sport, gruppen) => {
    const SG = typeof StatGruppen !== 'undefined' ? StatGruppen : require('./calc-statgruppen.js');      // eslint-disable-line no-undef
    return SG.passt(sel, sport, gruppen === undefined ? SG.aktuell() : gruppen);
  },
  /** Ist die angegebene Sportart Schneeschuhwandern (Meine Touren „snowshoe“, Komoot, Strava „Snowshoe“, GPX-Typ, FIT 35)? */
  isSnowshoe(s) { s = String(s || '').toLowerCase().replace(/[\s_-]+/g, ''); return s.includes('snowshoe') || s.includes('schneeschuh'); },
  /** Schlagworte, die eine Sportangabe mitbringt: Schneeschuh bekommt (wie seit 2.2.0) das Schlagwort „Schneeschuh“. */
  tags: s => (Sports.isSnowshoe(s) ? [Sports.SCHNEESCHUH] : []),
  /** Verschiedene Bezeichnungen (Komoot, Strava, Garmin, Bosch, GPX-Typ) auf unsere Sportarten abbilden. */
  norm(s) {
    s = String(s || '').toLowerCase().replace(/[\s_-]+/g, '');
    if (!s) return 'other';
    if (/motorbik|motorcycl|motocross|motorrad|dirtbike/.test(s)) return 'motorbike';      // vor „bik“/„cycl“
    if (/^atv$|quad/.test(s)) return 'atv';
    if (s.includes('cyclocross')) return 'cyclocross';
    if (s.includes('bmx')) return 'bmx';
    if (/commut|pendel/.test(s)) return 'commute';
    if (s.includes('race') || s.includes('roadbik') || s === 'road') return 'racebike';
    if (/^e(mountain|mtb)/.test(s) || s.includes('emtb')) return 'emtb';      // 2.19.0: E-Mountainbike eigene Sportart (Meine Touren „e_mtb“, Strava „EMountainBikeRide“)
    if (/^e(touring|bike|bicycle|ride|gravel|racebike)/.test(s) || s.includes('ebike') || s.includes('pedelec')) return 'ebike';
    if (s.includes('gravel')) return 'gravel';      // 2.19.0 (bis 2.18: Mountainbike)
    if (s.includes('mtb') || s.includes('mountainbik')) return 'mtb';
    if (s.includes('bic') || s.includes('bik') || s.includes('ride') || s.includes('cycl')) return 'bike';
    if (s.includes('trail')) return 'trailrun';      // 2.19.0 (bis 2.18: Laufen)
    if (/orienteer|orientierungslauf/.test(s)) return 'orienteering';
    if (s.includes('run') || s.includes('jog')) return 'run';
    if (/skitour|skimo|skimountaineer|backcountry|skitouring|touringski/.test(s)) return 'skitour';      // vor „mountaineer“: Skibergsteigen ist Skitour
    if (s.includes('mountaineer') || s.includes('bergsteig')) return 'mountaineering';
    if (/climb|kletter|viaferrata|boulder/.test(s)) return 'climbing';      // 2.19.0 (bis 2.18: Bergsteigen)
    if (s.includes('nordicwalk')) return 'nordicwalking';      // 2.19.0 eigene Sportart (bis 2.18: Wandern)
    if (Sports.isSnowshoe(s)) return 'snowshoe';      // 2.19.0: eigene Sportart (2.2.0–2.18: Wandern); Schlagwort „Schneeschuh“ weiter über Sports.tags
    if (/nordic|crosscountry|langlauf|skate?skiing|classicski/.test(s)) return 'nordic';
    if (/waterski|wasserski/.test(s)) return 'waterski';      // vor „ski“
    if (/snowmobil|schneemobil|motorschlitten/.test(s)) return 'snowmobile';
    if (s.includes('snowboard')) return 'snowboard';      // 2.19.0 (bis 2.18: Ski alpin)
    if (/sled|rodel|toboggan|schlitten/.test(s)) return 'sled';
    if (/iceskat|eislauf|eisschnell/.test(s)) return 'iceskate';
    if (/skialpin|alpineski|alpin|downhill|resort/.test(s)) return 'skialpin';
    if (s.includes('ski') || s.includes('snow')) return 'ski';      // Wintersport ohne genauere Angabe
    if (/kitesurf|kiteboard/.test(s)) return 'kitesurf';
    if (s.includes('wakesurf')) return 'wakesurf';
    if (/surf|wellenreit/.test(s)) return 'surf';
    if (/standup|paddleboard|^sup$/.test(s)) return 'sup';
    if (/dragonboat|drachenboot/.test(s)) return 'dragonboat';
    if (/snorkel|schnorchel/.test(s)) return 'snorkel';
    if (/kayak|canoe|kanu|paddl/.test(s)) return 'kayak';
    if (/rowing|rudern|^row$/.test(s)) return 'rowing';
    if (/sail|segel/.test(s)) return 'sailing';
    if (/swim|schwimm|openwater/.test(s)) return 'swim';
    if (/boat|boot/.test(s)) return 'boat';
    if (s.includes('skateboard')) return 'skateboard';
    if (/fish|angeln/.test(s)) return 'fishing';
    if (/hunt|jagd|jagen/.test(s)) return 'hunting';
    if (/archery|bogensch/.test(s)) return 'archery';
    if (/dogwalk|gassi/.test(s)) return 'dogwalk';
    if (/inline|rollerblad|rollerskat|rollschuh/.test(s)) return 'inline';
    if (/horse|reiten|equestrian/.test(s)) return 'horse';
    if (s.includes('golf')) return 'golf';
    if (s.includes('hik') || s.includes('wander') || s.includes('trek')) return 'hike';
    if (s.includes('walk') || s.includes('spazier') || s.includes('gehen')) return 'walk';
    return 'other';
  },
};

const Parse = {
  decodeXml: s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&'),
  num: s => { const v = parseFloat(s); return isNaN(v) ? null : v; },
  /** Pulswert übernehmen, aber nur wenn er plausibel ist (Fühler liefern sonst 0 oder 255). */
  /* Zepp-Token aus der Zwischenablage: erlaubt „apptoken=…“, Anführungszeichen, Leerraum, Prozent-Kodierung des „=“; null bei Unsinn */
  zeppToken: s => {
    let t = String(s == null ? '' : s).trim().replace(/^["'`]+|["'`]+$/g, '');
    const m = t.match(/(?:^|[;\s])apptoken\s*[=:]\s*([^;\s"']+)/i); if (m) t = m[1];
    t = t.replace(/^Bearer\s+/i, '').replace(/\s+/g, '');
    try { if (/%[0-9a-f]{2}/i.test(t)) t = decodeURIComponent(t); } catch (e) {}
    return /^[A-Za-z0-9_\-+/=.~*]{20,}$/.test(t) ? t : null;
  },
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
      if (pts.length) out.push({ name: nm ? Parse.decodeXml(nm.replace(/<!\[CDATA\[|\]\]>/g, '')).trim() : '', sport: Sports.norm(ty), rawSport: ty || '', tags: Sports.tags(ty), pts });
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
      if (pts.length) out.push({ name: '', sport: Sports.norm(sp), rawSport: sp || '', tags: Sports.tags(sp), pts });
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
            // Grundtypen: 5 = sint32 (Breite/Länge!), 6 = uint32, 12 = uint32z. Bis 2.0.1 wurde sint32 vorzeichenlos gelesen:
            // westliche Längen (z. B. Kanaren −15,6°) landeten bei 344°, „kein Wert“ (0x7FFFFFFF) bei 180°/180°.
            if (f.s === 4 && (bt === 5 || bt === 6 || bt === 12)) {
              if (bt === 6 || bt === 12) { const x = dv.getUint32(o, d.le); if (x !== 0xFFFFFFFF && !(bt === 12 && x === 0)) v[f.n] = x; }
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
          const la = v[0] != null ? v[0] * 180 / 2147483648 : null, lo = v[1] != null ? v[1] * 180 / 2147483648 : null;
          if (la != null && lo != null && Math.abs(la) <= 90 && Math.abs(lo) <= 180 && !(la === 0 && lo === 0)) {
            const alt = v[78] != null ? v[78] / 5 - 500 : (v[2] != null ? v[2] / 5 - 500 : null);
            pts.push({ lat: la, lon: lo, ele: alt, t: lastTs ? FIT_EPOCH + lastTs * 1000 : null, hr: Parse.hr(v[3]) });
          }
        } else if (d.gm === 12 || d.gm === 18) {
          if (d.gm === 12 && v[0] != null) sport = sport || String(v[0]);
          if (d.gm === 18 && v[5] != null) sport = String(v[5]);
          if (d.gm === 18 && v[6] != null) subsport = String(v[6]);
        }
      }
    }
    // FIT-Sportnummern (wie in Meine Touren, app/fitfile.py): 12 Langlauf, 13 Ski alpin, 14 Snowboard (bis 2.18 Ski alpin), 35 Schneeschuh (seit 2.19.0 eigene Sportart, mit Schlagwort);
    // Untersportart 37 = Backcountry: Skitour. 2.2.0: 19 (Paddeln) ist nicht mehr „Ski“.
    // 2.19.0: 14 Snowboard, 31 Klettern, 5 Schwimmen, 15 Rudern, 19 Paddeln, 25 Golf, 30 Inlineskaten, 32 Segeln, 33 Eislaufen, 37 Stand-up-Paddling, 41 Kajak – eigene Sportarten.
    const names = { 1: 'run', 2: 'bike', 11: 'walk', 17: 'hike', 12: 'nordic', 13: 'skialpin', 14: 'snowboard', 35: 'snowshoe', 5: 'swim', 31: 'climbing', 16: 'mountaineering', 15: 'rowing', 19: 'kayak', 37: 'sup',
      25: 'golf', 30: 'inline', 32: 'sailing', 33: 'iceskate', 41: 'kayak' };
    let sp = names[sport] || 'other';
    if (sport === '1' && subsport === '3') sp = 'trailrun';      // 2.19.0: Untersportart Trail
    if (sp === 'bike' && subsport === '8') sp = 'mtb'; else if (sp === 'bike' && subsport === '7') sp = 'racebike'; else if (sp === 'bike' && subsport === '28') sp = 'ebike';
    else if ((sport === '12' || sport === '13' || sport === '14') && subsport === '37') sp = 'skitour';
    return pts.length ? [{ name: nm, sport: sp, rawSport: sport, tags: sport === '35' ? [Sports.SCHNEESCHUH] : [], pts }] : [];
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
