'use strict';
/* Rechenlogik ohne Oberfläche für das Komoot-Paket (2.18.0) und für Pins/Notiz in der GPX, die an Meine Touren geht.
   Komoot-Paket = ZIP zum Selbst-Hochladen: <Tour>.gpx (Spur, Pins als <wpt>, Notiz als <desc>), notiz.txt, README.txt, manifest.json und – nur wenn einzeln
   angekreuzt – Fotos (höchstens 60, höchstens 2000 Pixel, Aufnahmezeit im EXIF, Ort nur auf Wunsch). Nichts geht an Komoot, die App lädt nichts hoch.
   Hier nur, was sich ohne Oberfläche prüfen lässt: Texte säubern und maskieren, GPX bauen, Pins verorten, Dateinamen, README, Manifest und das EXIF der Fotos
   (alle EXIF-/XMP-/IPTC-Blöcke entfernen, dann nur Aufnahmezeit und – falls gewünscht – Ort neu eintragen). Oberfläche und ZIP: js/v-komoot.js.
   Der bestehende Export „Als GPX speichern“ (Geo.gpx) bleibt unverändert: dort stehen Fotos mit Ort als Wegpunkte, keine Pins, keine Notiz.
   Läuft im Browser (globales `KomootCalc`) und in Node. */
(function (root) {
  const FOTO_MAX_N = 60, FOTO_PX = 2000, DESC_MAX = 2000, NAME_MAX = 60, NAME_MAX_MT = 200, WPT_MAX = 200, NOTIZ_TXT_MAX = 20000;
  const FORMAT = 'mein-tourentagebuch-komoot-paket';

  const CTRL = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f￾￿]|[\ud800-\udbff](?![\udc00-\udfff])|(^|[^\ud800-\udbff])[\udc00-\udfff]/g;
  /** Text säubern: Steuerzeichen und kaputte Ersatzzeichen weg (Zeilenumbruch und Tabulator bleiben), Zeilenenden \n, höchstens drei Zeilen Abstand,
      höchstens n Zeichen (Codepunkte; Emoji werden nie halbiert), gekürzt mit „…“. Noch nicht XML-maskiert. */
  function clean(s, n) {
    s = String(s == null ? '' : s).replace(CTRL, '$1').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim().replace(/\n{3,}/g, '\n\n');
    const cp = Array.from(s);
    if (n == null || cp.length <= n) return s;
    return cp.slice(0, Math.max(0, n - 1)).join('').trimEnd() + '…';
  }
  /** XML-Maskierung für Text und Attribute. */
  const xml = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
  const iso = t => new Date(t).toISOString().replace(/\.\d+Z$/, 'Z');
  const zwei = n => (n < 10 ? '0' : '') + n;

  /** Ort zu einer Zeit aus der Spur: zwischen zwei Punkten linear, höchstens 10 Minuten neben der Spur; sonst null. */
  function ortZurZeit(pts, ts) {
    if (!(ts > 0) || !pts || !pts.length) return null;
    let lo = 0, hi = pts.length - 1;
    if (!(pts[0].t > 0)) return null;
    if (ts <= pts[0].t) return ts >= pts[0].t - 600000 ? { lat: pts[0].lat, lon: pts[0].lon, ele: pts[0].ele } : null;
    if (ts >= pts[hi].t) return ts <= pts[hi].t + 600000 ? { lat: pts[hi].lat, lon: pts[hi].lon, ele: pts[hi].ele } : null;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (pts[m].t <= ts) lo = m; else hi = m; }
    const a = pts[lo], b = pts[hi], f = b.t > a.t ? (ts - a.t) / (b.t - a.t) : 0;
    return { lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f, ele: a.ele != null && b.ele != null ? a.ele + (b.ele - a.ele) * f : null };
  }
  const zeitText = ts => { const d = new Date(ts); return zwei(d.getHours()) + ':' + zwei(d.getMinutes()); };
  /** Pins einer Tour als Wegpunkte. Pins ohne eigenen Ort bekommen den Ort der Spur zu ihrer Zeit; geht das nicht, fehlen sie (gezählt in ohneOrt).
      o.nameMax: Länge des Namens (Komoot 60; an Meine Touren 200, dort wird der Name die Pin-Notiz). Gibt { wpts, ohneOrt } zurück. */
  function pinWpts(pins, pts, o) {
    o = o || {};
    const nameMax = o.nameMax || NAME_MAX, out = [];
    let ohneOrt = 0;
    for (const p of (pins || []).slice().sort((a, b) => (a.ts || 0) - (b.ts || 0))) {
      let la = p.lat, lo = p.lon, ele = null;
      if (!(la != null && lo != null && isFinite(la) && isFinite(lo))) { const g = ortZurZeit(pts, p.ts); if (g) { la = g.lat; lo = g.lon; ele = g.ele; } else { ohneOrt++; continue; } }
      if (Math.abs(la) > 90 || Math.abs(lo) > 180 || (la === 0 && lo === 0)) { ohneOrt++; continue; }
      const voll = clean(p.text, DESC_MAX), name = clean(voll.replace(/\s*\n\s*/g, ' '), nameMax) || ('Pin ' + (p.ts ? zeitText(p.ts) : out.length + 1));
      out.push({ lat: +la, lon: +lo, ele, ts: p.ts || 0, name, desc: voll && voll !== name ? voll : '' });
      if (out.length >= WPT_MAX) break;
    }
    return { wpts: out, ohneOrt };
  }
  /** GPX 1.1 mit metadata (Name, Beschreibung, Zeit), Wegpunkten und Spur (gleiche Punkte wie Geo.gpx, mit Puls). o: { name, sport, pts, wpts, desc }. */
  function gpx(o) {
    const name = clean(o.name, 200), desc = clean(o.desc, DESC_MAX), pts = o.pts || [];
    let s = '<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Mein Tourentagebuch" xmlns="http://www.topografix.com/GPX/1/1"'
      + ' xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1">\n<metadata>' + (name ? '<name>' + xml(name) + '</name>' : '')
      + (desc ? '<desc>' + xml(desc) + '</desc>' : '') + (pts[0] && pts[0].t ? '<time>' + iso(pts[0].t) + '</time>' : '') + '</metadata>\n';
    for (const w of o.wpts || []) {
      s += '<wpt lat="' + (+w.lat).toFixed(7) + '" lon="' + (+w.lon).toFixed(7) + '">' + (w.ele != null && isFinite(w.ele) ? '<ele>' + (+w.ele).toFixed(1) + '</ele>' : '')
        + (w.ts ? '<time>' + iso(w.ts) + '</time>' : '') + '<name>' + xml(w.name) + '</name>' + (w.desc ? '<desc>' + xml(w.desc) + '</desc>' : '') + '</wpt>\n';
    }
    s += '<trk><name>' + xml(name) + '</name>' + (desc ? '<desc>' + xml(desc) + '</desc>' : '') + (o.sport ? '<type>' + xml(o.sport) + '</type>' : '') + '<trkseg>\n';
    pts.forEach((p, i) => {
      if (p.newSeg && i) s += '</trkseg><trkseg>\n';
      s += '<trkpt lat="' + (+p.lat).toFixed(6) + '" lon="' + (+p.lon).toFixed(6) + '">' + (p.ele != null ? '<ele>' + (+p.ele).toFixed(1) + '</ele>' : '') + (p.t ? '<time>' + iso(p.t) + '</time>' : '')
        + (p.hr ? '<extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>' + (p.hr | 0) + '</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions>' : '') + '</trkpt>\n';
    });
    return s + '</trkseg></trk></gpx>\n';
  }

  /* ---------------- Paket ---------------- */
  /** Sicherer Dateiname aus dem Tournamen (Umlaute bleiben). */
  function dateiname(name, fallback) {
    const s = String(name || '').replace(/[^\p{L}\p{N} ._-]+/gu, '_').replace(/^[ ._]+|[ ._]+$/g, '').slice(0, 80);
    return s || fallback || 'Tour';
  }
  function stempel(ts) { const d = new Date(ts); return d.getFullYear() + '-' + zwei(d.getMonth() + 1) + '-' + zwei(d.getDate()) + '_' + zwei(d.getHours()) + '-' + zwei(d.getMinutes()) + '-' + zwei(d.getSeconds()); }
  /** „fotos/01_2026-10-03_10-15-00.jpg“ */
  const fotoName = (i, ts) => 'fotos/' + zwei(i) + '_' + (ts > 0 ? stempel(ts) : 'ohne-zeit') + '.jpg';
  /** Vorauswahl: keine. Fotos mit erkannten Gesichtern bekommen einen Hinweis und werden auch von „Alle ohne Gesicht“ nicht gewählt. */
  function vorgabe(fotos) { return { gewaehlt: [], gesicht: (fotos || []).filter(p => p.faces > 0).map(p => p.id) }; }
  /** „Alle ohne Gesicht wählen“: höchstens 60, Gesichter nie. */
  const ohneGesicht = fotos => (fotos || []).filter(p => !p.video && !(p.faces > 0)).slice(0, FOTO_MAX_N).map(p => p.id);
  /** Zielgröße eines Fotos (längste Seite höchstens px; nie vergrößern). */
  function ziel(w, h, px) { px = px || FOTO_PX; if (!(w > 0 && h > 0)) return [0, 0]; const f = Math.min(1, px / Math.max(w, h)); return [Math.max(1, Math.round(w * f)), Math.max(1, Math.round(h * f))]; }

  function readme(o) {
    const d = ts => { const x = new Date(ts); return zwei(x.getDate()) + '.' + zwei(x.getMonth() + 1) + '.' + x.getFullYear() + ' ' + zwei(x.getHours()) + ':' + zwei(x.getMinutes()); };
    const L = ['Komoot-Paket aus Mein Tourentagebuch', '====================================', '', 'Tour: ' + clean(o.name, 200), 'Datum: ' + (o.start ? d(o.start) : 'unbekannt'), 'Erstellt: ' + d(o.jetzt || Date.now()), '',
      'Inhalt', '------',
      '- ' + o.gpx + ': die Strecke' + (o.wpts ? ' mit ' + o.wpts + (o.wpts === 1 ? ' Wegpunkt (Pin)' : ' Wegpunkten (Pins)') : '') + (o.notiz ? ' und deiner Notiz als Beschreibung' : '')];
    if (o.notiz) L.push('- notiz.txt: deine Notiz zum Einfügen in Komoot');
    L.push(o.fotos ? '- fotos/: ' + o.fotos + ' ausgewählte Fotos (höchstens ' + FOTO_PX + ' Pixel)' : '- keine Fotos (keine ausgewählt)');
    L.push('- manifest.json: Inhaltsverzeichnis für Programme (kannst du ignorieren)', '',
      'So lädst du die Tour selbst in Komoot hoch', '------------------------------------------',
      '1. ZIP-Datei entpacken (in der Dateien-App: antippen, „Entpacken“).',
      '2. In Komoot (Webseite komoot.com oder App) die GPX-Datei importieren.',
      '   Als abgeschlossene Aktivität speichern (nicht als geplante Route), Sportart und Datum prüfen.',
      '3. SICHTBARKEIT SELBST WÄHLEN: Komoot gibt einer neuen Tour zuerst die Standard-Sichtbarkeit deines Kontos',
      '   (Komoot: Einstellungen -> Privatsphäre). Steht sie auf „Jeder“, ist die Tour sofort öffentlich.',
      '   Wähle „Nur ich“ (privat), wenn die Tour nicht für alle sichtbar sein soll, und prüfe es danach in der Tour.',
      '4. Notiz: Ob Komoot die Beschreibung und die Wegpunkte aus der GPX-Datei übernimmt, ist nicht sicher.',
      '   Den Text aus notiz.txt kannst du in Komoot selbst einfügen.',
      '5. Fotos: in Komoot einzeln über „Foto hinzufügen“ an die Tour hängen.', '',
      'Wichtig zu Fotos und Rechten', '----------------------------',
      '- Du hast die Fotos selbst ausgewählt und verantwortest die Auswahl.',
      '- Sind Personen erkennbar, brauchst du für eine Veröffentlichung in der Regel ihre Einwilligung.',
      '  Kinder und Autokennzeichen besonders beachten. Die Gesichtserkennung des Tagebuchs ist nur ein Hinweis und findet nicht jedes Gesicht.',
      '- Lade nur Fotos hoch, die du selbst gemacht hast oder für die du die Rechte hast.',
      '- Was einmal öffentlich war, lässt sich nicht zuverlässig zurückholen (Kopien, Suchmaschinen).',
      '- Aufnahmeort in den Fotos: ' + (o.ort ? 'enthalten (GPS-Position in den Bilddaten)' : 'entfernt'), '',
      'Mein Tourentagebuch lädt nichts zu Komoot hoch. Es gibt keine Automatik.');
    return L.join('\r\n') + '\r\n';
  }
  function manifest(o) {
    return JSON.stringify({ format: FORMAT, version: 1, erstellt: Math.round((o.jetzt || Date.now()) / 1000), app: o.app || '',
      tour: { id: o.id, name: o.name, sport: o.sport || '', start: o.start || null, dist_m: o.dist != null ? Math.round(o.dist) : null },
      gpx: o.gpx, wegpunkte: o.wpts || 0, notiz: !!o.notiz, fotos: o.fotoListe || [], ort_entfernt: !o.ort,
      hinweis: 'Sichtbarkeit in Komoot selbst wählen; Fotos einzeln hochladen; Auswahl und Rechte verantwortet der Nutzer.' }, null, 1);
  }
  const notizTxt = note => { const s = clean(note, NOTIZ_TXT_MAX); return s ? s.replace(/\n/g, '\r\n') + '\r\n' : ''; };

  /* ---------------- EXIF ---------------- */
  /** JPEG ohne EXIF-, XMP- (APP1), IPTC- (APP13) und Kommentar-Blöcke. Wirft bei einer Datei, die kein JPEG ist. */
  function ohneExif(b) {
    if (!(b && b.length > 4 && b[0] === 0xff && b[1] === 0xd8)) throw new Error('kein JPEG');
    const out = [b.subarray(0, 2)];
    let i = 2;
    while (i + 4 <= b.length) {
      if (b[i] !== 0xff) throw new Error('JPEG beschädigt');
      const m = b[i + 1];
      if (m === 0xff) { i++; continue; }
      if (m === 0xda || m === 0xd9) { out.push(b.subarray(i)); i = b.length; break; }      // Bilddaten: Rest unverändert
      if ((m >= 0xd0 && m <= 0xd7) || m === 0x01) { out.push(b.subarray(i, i + 2)); i += 2; continue; }
      const len = (b[i + 2] << 8) | b[i + 3];
      if (len < 2 || i + 2 + len > b.length) throw new Error('JPEG beschädigt');
      if (m !== 0xe1 && m !== 0xed && m !== 0xfe) out.push(b.subarray(i, i + 2 + len));
      i += 2 + len;
    }
    if (i < b.length) out.push(b.subarray(i));
    const n = out.reduce((a, x) => a + x.length, 0), r = new Uint8Array(n);
    let o = 0; for (const x of out) { r.set(x, o); o += x.length; }
    return r;
  }
  /** Kleiner EXIF-Block (APP1, „MM“): DateTimeOriginal und OffsetTimeOriginal in der Zeitzone des Geräts, auf Wunsch GPS (Breite/Länge). */
  function exifBlock(ts, lat, lon) {
    const d = new Date(ts), m = -d.getTimezoneOffset(), a = Math.abs(m);
    const dt = d.getFullYear() + ':' + zwei(d.getMonth() + 1) + ':' + zwei(d.getDate()) + ' ' + zwei(d.getHours()) + ':' + zwei(d.getMinutes()) + ':' + zwei(d.getSeconds());
    const off = (m < 0 ? '-' : '+') + zwei(Math.floor(a / 60)) + ':' + zwei(a % 60);
    const gps = lat != null && lon != null && isFinite(lat) && isFinite(lon);
    // Aufbau: Kopf (8) | IFD0 | Exif-IFD | Daten Exif | GPS-IFD | Daten GPS
    const n0 = gps ? 2 : 1, ifd0 = 8, exif = ifd0 + 2 + n0 * 12 + 4, exData = exif + 2 + 2 * 12 + 4, gIfd = exData + 20 + 8, gData = gIfd + 2 + 5 * 12 + 4;
    const size = gps ? gData + 48 : exData + 28;
    const buf = new Uint8Array(size), v = new DataView(buf.buffer);
    let p = 0;
    const u16 = x => { v.setUint16(p, x); p += 2; }, u32 = x => { v.setUint32(p, x); p += 4; };
    const ent = (tag, type, cnt, val) => { u16(tag); u16(type); u32(cnt); u32(val); };
    const asc = (o, s, len) => { for (let k = 0; k < len; k++) buf[o + k] = k < s.length ? s.charCodeAt(k) : 0; };
    buf.set([0x4d, 0x4d, 0, 0x2a]); p = 4; u32(ifd0);
    u16(n0); ent(0x8769, 4, 1, exif); if (gps) ent(0x8825, 4, 1, gIfd); u32(0);
    u16(2); ent(0x9003, 2, 20, exData); ent(0x9011, 2, 7, exData + 20); u32(0);
    asc(exData, dt, 20); asc(exData + 20, off, 8);
    if (gps) {
      p = gIfd; u16(5);
      u16(0); u16(1); u32(4); buf.set([2, 3, 0, 0], p); p += 4;
      u16(1); u16(2); u32(2); buf.set([lat < 0 ? 0x53 : 0x4e, 0, 0, 0], p); p += 4;
      ent(2, 5, 3, gData);
      u16(3); u16(2); u32(2); buf.set([lon < 0 ? 0x57 : 0x45, 0, 0, 0], p); p += 4;
      ent(4, 5, 3, gData + 24); u32(0);
      const rat = (o, x) => { const z0 = Math.round(Math.abs(x) * 36000000), g = Math.floor(z0 / 36000000), mi = Math.floor((z0 % 36000000) / 600000), s = z0 % 600000;      // Zehntausendstel Sekunden, ganzzahlig: nie „60 Sekunden“
        [[g, 1], [mi, 1], [s, 10000]].forEach(([z, n], k) => { v.setUint32(o + k * 8, z); v.setUint32(o + k * 8 + 4, n); }); };
      rat(gData, lat); rat(gData + 24, lon);
    }
    const head = new Uint8Array(10 + size);
    head.set([0xff, 0xe1, ((size + 8) >> 8) & 255, (size + 8) & 255, 0x45, 0x78, 0x69, 0x66, 0, 0]); head.set(buf, 10);
    return head;
  }
  /** Foto fürs Paket: alle Metadaten entfernen, Aufnahmezeit (und nur mit ort=true den Ort) neu eintragen. o: { ts, lat, lon, ort }. */
  function fotoExif(jpeg, o) {
    const b = ohneExif(jpeg);
    if (!(o && o.ts > 0)) return b;
    const app1 = exifBlock(o.ts, o.ort ? o.lat : null, o.ort ? o.lon : null);
    let at = 2;
    if (b[2] === 0xff && b[3] === 0xe0) at = 4 + ((b[4] << 8) | b[5]);      // nach dem JFIF-Block
    const r = new Uint8Array(b.length + app1.length);
    r.set(b.subarray(0, at)); r.set(app1, at); r.set(b.subarray(at), at + app1.length);
    return r;
  }
  /** Zum Prüfen: EXIF eines JPEG lesen → { zeit, offset, lat, lon } (nur die Felder, die dieses Modul schreibt, plus GPS fremder Dateien). */
  function liesExif(b) {
    const r = { zeit: null, offset: null, lat: null, lon: null, bloecke: 0 };
    let i = 2;
    while (i + 4 <= b.length && b[i] === 0xff) {
      const m = b[i + 1]; if (m === 0xda || m === 0xd9) break;
      const len = (b[i + 2] << 8) | b[i + 3];
      if (m === 0xe1 && b[i + 4] === 0x45 && b[i + 5] === 0x78) {
        r.bloecke++;
        const t = i + 10, v = new DataView(b.buffer, b.byteOffset + t, len - 8), le = b[t] === 0x49;
        const g16 = o => v.getUint16(o, le), g32 = o => v.getUint32(o, le);
        const str = (o, n) => { let s = ''; for (let k = 0; k < n; k++) { const c = v.getUint8(o + k); if (!c) break; s += String.fromCharCode(c); } return s; };
        const ifd = (o, f) => { const n = g16(o); for (let k = 0; k < n; k++) { const e = o + 2 + k * 12; f(g16(e), g16(e + 2), g32(e + 4), e + 8); } };
        const ratv = o => { const x = []; for (let k = 0; k < 3; k++) x.push(g32(o + k * 8) / g32(o + k * 8 + 4)); return x[0] + x[1] / 60 + x[2] / 3600; };
        let latRef = 'N', lonRef = 'E';
        ifd(g32(4), (tag, type, cnt, vo) => {
          if (tag === 0x8769) ifd(g32(vo), (t2, ty2, c2, v2) => { if (t2 === 0x9003) r.zeit = str(g32(v2), 19); if (t2 === 0x9011) r.offset = str(c2 > 4 ? g32(v2) : v2, 6); });
          if (tag === 0x8825) ifd(g32(vo), (t2, ty2, c2, v2) => { if (t2 === 1) latRef = str(v2, 1); if (t2 === 3) lonRef = str(v2, 1); if (t2 === 2) r.lat = ratv(g32(v2)); if (t2 === 4) r.lon = ratv(g32(v2)); });
        });
        if (r.lat != null && latRef === 'S') r.lat = -r.lat;
        if (r.lon != null && lonRef === 'W') r.lon = -r.lon;
      }
      i += 2 + len;
    }
    return r;
  }

  const api = { FOTO_MAX_N, FOTO_PX, DESC_MAX, NAME_MAX, NAME_MAX_MT, WPT_MAX, FORMAT, clean, xml, ortZurZeit, pinWpts, gpx, dateiname, stempel, fotoName, vorgabe, ohneGesicht, ziel,
    readme, manifest, notizTxt, ohneExif, exifBlock, fotoExif, liesExif };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.KomootCalc = api;
})(typeof window !== 'undefined' ? window : globalThis);
