'use strict';
/* Einlesen von GPX, TCX, FIT (auch aus ZIP/GZ). Ergebnis: [{name, sport, pts:[{lat,lon,ele,t,newSeg}], srcId?}] */
/* 2.19.0: Sportarten-Katalog als Tabelle – die endgültige Auswahl (29 Sportarten in 5 Kategorien, gleich wie in „Meine Touren“). Jede Zeile ist eine
   eigene Sportart: [Kategorie, Schlüssel, Name, Zeichen (wird zum Symbol, js/icons.js), Kartenfarbe]. Weitere Sportarten: eine Zeile ergänzen (Symbol in
   ICON_CHARS, Zuordnung in Sports.norm, ggf. Senden in calc-senden.js). Die Schlüssel bis 2.18 bleiben (hike, walk, mtb, bike …).
   Zusammengefasst wird nur über selbst angelegte Statistik-Gruppen (calc-statgruppen.js).
   Schlüssel, die nicht (mehr) im Katalog stehen (aus einem Zwischenstand von 2.19.0, einer Sicherung oder einer anderen App), bleiben an der Tour unverändert;
   Anzeige, Filter, Statistik und Ziele nehmen dafür die Rückfall-Sportart (Sports.RUECKFALL, sonst „Sonstiges“) – siehe Sports.anzeige. */
const KATEGORIEN = [['fuss', 'Zu Fuß'], ['rad', 'Rad'], ['winter', 'Winter'], ['wasser', 'Wasser'], ['sonst', 'Outdoor und Sonstige']];
const KATALOG = [
  ['fuss', 'hike', 'Wandern', '🥾', '#2e7d32'],
  ['fuss', 'walk', 'Spazieren / Gehen', '🚶', '#6b8e23'],
  ['fuss', 'mountaineering', 'Bergsteigen', '🧗', '#4e342e'],
  ['fuss', 'climbing', 'Klettern / Klettersteig', '🪨', '#7b3f00'],
  ['fuss', 'nordicwalking', 'Nordic Walking', '🦯', '#5e7a5a'],
  ['fuss', 'run', 'Laufen', '🏃', '#c62828'],
  ['fuss', 'trailrun', 'Trailrunning', '🌲', '#880e4f'],
  ['rad', 'bike', 'Radtour', '🚴', '#1565c0'],
  ['rad', 'racebike', 'Rennrad', '🚴', '#6a1b9a'],
  ['rad', 'mtb', 'Mountainbike', '🚵', '#d84315'],
  ['rad', 'gravel', 'Gravelbike', '🚲', '#8d6e00'],
  ['rad', 'ebike', 'E-Bike', '⚡', '#00838f'],
  ['rad', 'emtb', 'E-Mountainbike', '🚵', '#263238'],
  ['rad', 'bikepacking', 'Bikepacking', '🎒', '#a1665e'],
  ['winter', 'skialpin', 'Ski alpin', '🏔️', '#303f9f'],
  ['winter', 'skitour', 'Skitour', '🎿', '#ad1457'],
  ['winter', 'nordic', 'Langlauf', '❄️', '#00695c'],
  ['winter', 'snowboard', 'Snowboard', '🏂', '#8e6bbf'],
  ['winter', 'snowshoe', 'Schneeschuhwandern', '🌨️', '#0277bd'],
  ['wasser', 'kayak', 'Kajak / Kanu', '🛶', '#00897b'],
  ['wasser', 'rowing', 'Rudern', '🚣', '#1a237e'],
  ['wasser', 'dragonboat', 'Drachenboot', '🐉', '#9a3412'],
  ['wasser', 'rafting', 'Rafting', '🌊', '#2962ff'],
  ['wasser', 'boat', 'Bootfahren', '🚤', '#455a64'],
  ['sonst', 'skateboard', 'Skateboard', '🛹', '#b45309'],
  ['sonst', 'inline', 'Inlineskaten / Rollschuh', '🛼', '#9c27b0'],
  ['sonst', 'horse', 'Reiten', '🐎', '#795548'],
  ['sonst', 'paraglide', 'Gleitschirm', '🪂', '#e91e63'],
  ['sonst', 'other', 'Sonstiges', '📍', '#607d8b'],
];
/* Nur für ältere Touren (nicht im Katalog, in Auswahllisten nur, wenn die Tour sie schon hat): 2.2.0 „Ski (allgemein)“, wenn die genaue Art unbekannt ist. */
const ALTE = [['winter', 'ski', 'Ski (allgemein)', '⛷️', '#37474f']];
const Sports = {
  /** Der Katalog: [Schlüssel, Name, Zeichen] je Sportart, in seiner Reihenfolge (29). */
  katalog: KATALOG.map(r => [r[1], r[2], r[3]]),
  /** Katalog und Altschlüssel (für Namen, Symbole, Farben gespeicherter Touren). */
  list: KATALOG.concat(ALTE).map(r => [r[1], r[2], r[3]]),
  /** Kategorien für Auswahllisten: [id, Name, [Schlüssel …]] (nur Katalog). */
  KAT: KATEGORIEN.map(([id, name]) => [id, name, KATALOG.filter(r => r[0] === id).map(r => r[1])]),
  /** Kartenfarbe je Sportart (MapKit.sportColor), auch für Rückfall-Schlüssel. */
  farben: () => {
    const f = Object.fromEntries(KATALOG.concat(ALTE).map(r => [r[1], r[4]]));
    for (const k of Object.keys(Sports.RUECKFALL)) f[k] = f[Sports.RUECKFALL[k]];
    return f;
  },
  /** Nur noch für ältere Touren gedacht – in Auswahllisten nur, wenn die Tour sie schon hat. */
  ALT: ALTE.map(r => r[1]),
  /** Schlüssel, die nicht (mehr) im Katalog stehen → Sportart, als die sie zählen (Regeln der endgültigen Auswahl vom 25.11.2026). Alles andere: „Sonstiges“.
      Gilt beim Import (Sports.norm) und für Anzeige, Filter, Statistik, Ziele und Senden gespeicherter Touren (Sports.anzeige) – die Tour selbst bleibt unverändert. */
  RUECKFALL: { dogwalk: 'walk', orienteering: 'run', pilgrimage: 'hike', commute: 'bike', cyclocross: 'racebike', bmx: 'other', splitboard: 'skitour',
    snowmobile: 'other', sled: 'other', iceskate: 'other', sup: 'kayak', sailing: 'other', swim: 'other', snorkel: 'other', diving: 'other', surf: 'other',
    kitesurf: 'other', wakesurf: 'other', waterski: 'other', fishing: 'other', hunting: 'other', archery: 'other', golf: 'other', atv: 'other', motorbike: 'other' },
  /** Steht der Schlüssel im Katalog (oder ist er ein Altschlüssel wie „ski“)? */
  bekannt: id => KATALOG.some(r => r[1] === id) || ALTE.some(r => r[1] === id),
  /** Schlüssel für Anzeige, Filter, Statistik und Ziele: bekannte Sportart selbst, sonst ihr Rückfall, sonst „other“ (Sonstiges). */
  anzeige: id => (Sports.bekannt(id) ? id : Object.prototype.hasOwnProperty.call(Sports.RUECKFALL, id) ? Sports.RUECKFALL[id] : 'other'),
  /** Kategorien mit [Schlüssel, Name, Zeichen] der Sportarten; mit: Altschlüssel, der trotzdem erscheinen soll (die gerade gewählte Sportart). */
  kategorien(mit) {
    return KATEGORIEN.map(([id, name]) => [id, name, KATALOG.concat(ALTE).filter(r => r[0] === id && (!Sports.ALT.includes(r[1]) || r[1] === mit)).map(r => [r[1], r[2], r[3]])]);
  },
  /** Die Skiarten (feste Auswahl „Ski (alle Arten)“ für ältere Ziele und Filter). */
  SKI: ['skialpin', 'skitour', 'nordic', 'ski'],
  SCHNEESCHUH: 'Schneeschuh',
  label: id => Sports.list.find(s => s[0] === Sports.anzeige(id))[1],
  icon: id => Sports.list.find(s => s[0] === Sports.anzeige(id))[2],
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
  /** Verschiedene Bezeichnungen (Komoot, Strava, Garmin, Bosch, GPX-Typ, Meine Touren) auf die Aktivitäten des Katalogs abbilden. Ergebnis ist immer ein Katalog-Schlüssel;
      was die App nicht führt, bekommt die Rückfall-Sportart (Sports.RUECKFALL) oder „Sonstiges“. Reihenfolge: genauere Muster vor allgemeineren („bik“, „ski“, „boot“ …). */
  norm(s) {
    s = String(s || '').toLowerCase().replace(/[\s_-]+/g, '');
    if (!s) return 'other';
    if (KATALOG.some(r => r[1] === s)) return s;      // schon ein Schlüssel des Katalogs
    if (Object.prototype.hasOwnProperty.call(Sports.RUECKFALL, s)) return Sports.RUECKFALL[s];
    if (/motorbik|motorcycl|motocross|motorrad|dirtbike|^atv$|quad/.test(s)) return 'other';      // vor „bik“/„cycl“
    if (s.includes('cyclocross')) return 'racebike';      // Cyclocross → Rennrad
    if (s.includes('bmx')) return 'other';
    if (s.includes('bikepack')) return 'bikepacking';
    if (/commut|pendel/.test(s)) return 'bike';      // Radpendeln → Radtour
    if (/paraglid|gleitschirm|hangglid|drachenflieg|paragleit/.test(s)) return 'paraglide';
    if (s.includes('race') || s.includes('roadbik') || s === 'road') return 'racebike';
    if (/^e(mountain|mtb)/.test(s) || s.includes('emtb')) return 'emtb';      // 2.19.0: E-Mountainbike eigene Sportart (Meine Touren „e_mtb“, Strava „EMountainBikeRide“)
    if (/^e(touring|bike|bicycle|ride|gravel|racebike)/.test(s) || s.includes('ebike') || s.includes('pedelec')) return 'ebike';
    if (s.includes('gravel') || s === 'mtbeasy') return 'gravel';      // 2.19.0 (bis 2.18: Mountainbike); Meine Touren „mtb_easy“
    if (s.includes('mtb') || s.includes('mountainbik')) return 'mtb';
    if (s.includes('bic') || s.includes('bik') || s.includes('ride') || s.includes('cycl')) return 'bike';
    if (s.includes('trail')) return 'trailrun';      // 2.19.0 (bis 2.18: Laufen)
    if (/orienteer|orientierungslauf/.test(s)) return 'run';      // Orientierungslauf → Laufen
    if (s.includes('run') || s.includes('jog')) return 'run';
    if (s.includes('splitboard')) return 'skitour';      // Splitboard → Skitour
    if (/skitour|skimo|skimountaineer|backcountry|skitouring|touringski/.test(s)) return 'skitour';      // vor „mountaineer“: Skibergsteigen ist Skitour
    if (s.includes('mountaineer') || s.includes('bergsteig') || s === 'bergtour') return 'mountaineering';
    if (/climb|kletter|viaferrata|boulder/.test(s)) return 'climbing';      // 2.19.0 (bis 2.18: Bergsteigen)
    if (s.includes('nordicwalk')) return 'nordicwalking';      // 2.19.0 eigene Sportart (bis 2.18: Wandern)
    if (Sports.isSnowshoe(s)) return 'snowshoe';      // 2.19.0: eigene Sportart (2.2.0–2.18: Wandern); Schlagwort „Schneeschuh“ weiter über Sports.tags
    if (/nordic|crosscountry|langlauf|skate?skiing|classicski/.test(s)) return 'nordic';
    if (/waterski|wasserski|wakeboard|snowmobil|schneemobil|motorschlitten/.test(s)) return 'other';      // vor „ski“/„snow“
    if (s.includes('snowboard')) return 'snowboard';      // 2.19.0 (bis 2.18: Ski alpin)
    if (/sled|rodel|toboggan|schlitten|bobsle|iceskat|eislauf|eisschnell/.test(s)) return 'other';
    if (/skialpin|alpineski|alpin|downhill|resort/.test(s)) return 'skialpin';
    if (s.includes('ski') || s.includes('snow')) return 'skialpin';      // Wintersport ohne genauere Angabe (bis 2.19.0-Zwischenstand „Ski (allgemein)“)
    if (/raft/.test(s)) return 'rafting';
    if (/dragonboat|drachenboot/.test(s)) return 'dragonboat';
    if (/standup|paddleboard|^sup$/.test(s)) return 'kayak';      // SUP → Kajak / Kanu
    if (/surf|kiteboard|wellenreit|snorkel|schnorchel|diving|tauch|scuba/.test(s)) return 'other';      // vor „paddl“/„boot“
    if (/kayak|canoe|kanu|paddl/.test(s)) return 'kayak';
    if (/rowing|rudern|^row$/.test(s)) return 'rowing';
    if (/sail|segel|swim|schwimm|openwater/.test(s)) return 'other';
    if (/boat|boot/.test(s)) return 'boat';
    if (s.includes('skateboard')) return 'skateboard';
    if (/fish|angeln|hunt|jagd|jagen|archery|bogensch|golf/.test(s)) return 'other';
    if (/dogwalk|gassi/.test(s)) return 'walk';      // Gassigehen → Spazieren / Gehen
    if (/inline|rollerblad|rollerskat|rollschuh|^skaten$/.test(s)) return 'inline';      // Meine Touren „skaten“
    if (/horse|reiten|equestrian/.test(s)) return 'horse';
    if (/pilger|pilgrim/.test(s)) return 'hike';      // Pilgern → Wandern
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
    // 2.19.0: 14 Snowboard, 31 Klettern, 15 Rudern, 19 Paddeln, 41 Kajak, 37 Stand-up-Paddling (→ Kajak / Kanu), 42 Rafting, 23 Bootfahren, 26 Gleitschirm (Hängegleiten),
    // 27 Reiten, 30 Inlineskaten, 21 E-Bike – Sportarten des Katalogs; was die App nicht führt (Schwimmen, Golf, Segeln, Eislaufen …), wird „Sonstiges“.
    const names = { 1: 'run', 2: 'bike', 11: 'walk', 17: 'hike', 12: 'nordic', 13: 'skialpin', 14: 'snowboard', 35: 'snowshoe', 31: 'climbing', 16: 'mountaineering', 15: 'rowing', 19: 'kayak', 37: 'kayak',
      41: 'kayak', 42: 'rafting', 23: 'boat', 26: 'paraglide', 27: 'horse', 30: 'inline', 21: 'ebike' };
    let sp = names[sport] || 'other';
    if (sport === '1' && subsport === '3') sp = 'trailrun';      // 2.19.0: Untersportart Trail
    if (sp === 'bike' && subsport === '8') sp = 'mtb'; else if (sp === 'bike' && subsport === '7') sp = 'racebike'; else if (sp === 'bike' && subsport === '28') sp = 'ebike';
    else if (sp === 'bike' && subsport === '46') sp = 'gravel';      // 2.19.0: Untersportart Gravel
    else if (sp === 'ebike' && subsport === '8') sp = 'emtb';
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
