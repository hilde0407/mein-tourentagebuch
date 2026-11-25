'use strict';
/* Rechenlogik ohne Oberfläche (2.14.0): doppelte Fotos und Videos finden, eine Auswahl vorschlagen und Angaben auf das behaltene Foto übertragen.
   Drei Stufen, von sicher zu wahrscheinlich:
     „datei“: gleicher Abdruck – dieselbe Originaldatei (fp, beim Import berechnet) oder dieselbe gespeicherte Datei (fpd, auch nachträglich aus photos/).
              Abdruck = Größe + zwei Prüfwerte über Anfang, Mitte und Ende (je 64 KB), siehe MediaPrint.java; hier dieselbe Rechnung (abdruck).
     „name“:  gleicher Dateiname (ohne Endung, ohne „ (1)“ / „ - Kopie“), gleiche Aufnahmezeit (± 2 s) und gleiche Bildgröße.
     „bild“:  fast gleiches Vorschaubild (Grauraster 8 × 8, mittlere Abweichung höchstens 6 von 255), gleiches Seitenverhältnis und gleiche Aufnahmezeit
              (± 2 s oder um ganze halbe Stunden versetzt, bis 14 h – Zeitzone einer Quelle). Fängt neu gespeicherte oder anders verkleinerte Kopien.
   Nicht erkannt: bearbeitete oder zugeschnittene Fotos, Fotos ohne Aufnahmezeit, die nicht byte-gleich sind, Serienbilder mit sichtbar anderem Bild.
   Entschieden wird nie von selbst: Die Funktionen liefern Vorschläge; gelöscht wird erst nach Rückfrage in js/v-fotodoppelt.js.
   Läuft im Browser (globales `FotoDoppeltCalc`) und in Node. */
(function (root) {
  const SEK = 2000, HALB = 1800000, H14 = 14 * 3600000, BILD_MAX = 6, C = 65536;
  const RANG = { datei: 3, name: 2, bild: 1 };

  /* ---------- Abdruck (gleiche Rechnung wie MediaPrint.java und die Empfangsseite des WLAN-Imports) ---------- */
  /** Abschnitte [von, bis) einer Datei der Größe n: bis 192 KB die ganze Datei, sonst Anfang, Mitte und Ende mit je 64 KB. */
  function abschnitte(n) { return n <= 3 * C ? [[0, n]] : [[0, C], [Math.floor(n / 2) - C / 2, Math.floor(n / 2) + C / 2], [n - C, n]]; }
  function mix(h) { h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16; return ('0000000' + (h >>> 0).toString(16)).slice(-8); }
  /** Abdruck aus den gelesenen Abschnitten (Uint8Arrays in der Reihenfolge von abschnitte) und der Dateigröße n: „p1:n:16 Hex-Zeichen“. */
  function abdruck(teile, n) {
    let a = 0x811c9dc5 | 0, b = 0x050c5d1f, k = 0;
    for (const u of teile) for (let i = 0; i < u.length; i++) { const c = u[i]; a = Math.imul(a ^ c, 16777619); b = Math.imul(b ^ ((c + k) & 255), 16777619); k++; }
    return 'p1:' + n + ':' + mix(a) + mix(b);
  }
  const abdruckVon = bytes => abdruck(abschnitte(bytes.length).map(([x, y]) => bytes.subarray(x, y)), bytes.length);

  /* ---------- Vorschaubild-Vergleich (Grauraster) ---------- */
  /** Grauraster aus 8 × 8 Grauwerten (0…255, zeilenweise) als 128 Hex-Zeichen. */
  function raster(grau) { let s = ''; for (let i = 0; i < 64; i++) s += ('0' + Math.max(0, Math.min(255, Math.round(grau[i] || 0))).toString(16)).slice(-2); return s; }
  /** Unterschied zweier Grauraster: mittlere Abweichung je Feld (0…255), nachdem jedes Raster um seine mittlere Helligkeit bereinigt ist. Infinity, wenn eines fehlt.
      Neu gespeicherte oder anders verkleinerte Kopien liegen meist unter 3, verschiedene Motive weit über 10. */
  function abstand(r1, r2) {
    if (!r1 || !r2 || r1.length !== 128 || r2.length !== 128) return Infinity;
    const a = [], b = [];
    for (let i = 0; i < 128; i += 2) { a.push(parseInt(r1.substr(i, 2), 16)); b.push(parseInt(r2.substr(i, 2), 16)); }
    const ma = a.reduce((x, y) => x + y, 0) / 64, mb_ = b.reduce((x, y) => x + y, 0) / 64;
    let d = 0; for (let i = 0; i < 64; i++) d += Math.abs((a[i] - ma) - (b[i] - mb_));
    return Math.round(d / 64 * 10) / 10;
  }

  /* ---------- Paare ---------- */
  const ALLGEMEIN = new Set(['kamera', 'video', 'image', 'bild', 'photo', 'foto', 'panorama', 'screenshot', 'datei', 'unbenannt']);
  /** Dateiname ohne Ordner, Endung und Kopie-Zusatz, klein geschrieben; '' bei allgemeinen Namen („Kamera.jpg“, „Video.mp4“, Kennung als Name). */
  function grundName(name, id) {
    let s = String(name || '').replace(/^.*[\\/]/, '').replace(/\.[a-z0-9]{2,5}$/i, '').trim().toLowerCase();
    s = s.replace(/(\s*\(\d+\)|\s*-\s*kopie(\s*\(\d+\))?|\s+copy(\s+\d+)?|_copy)$/i, '').trim();
    if (!s || ALLGEMEIN.has(s) || (id && s === String(id).toLowerCase())) return '';
    return s;
  }
  const istVideo = p => !!p.video;
  const hatZeit = p => typeof p.ts === 'number' && isFinite(p.ts) && p.ts > 0;
  /** Gleiche Größe (± 2 px); unbekannte Größe zählt nicht dagegen. */
  function groesseGleich(a, b) { return !(a.w > 0 && a.h > 0 && b.w > 0 && b.h > 0) || (Math.abs(a.w - b.w) <= 2 && Math.abs(a.h - b.h) <= 2); }
  /** Gleiches Seitenverhältnis (± 3 %, gleiche Ausrichtung); unbekannt zählt nicht dagegen. */
  function formGleich(a, b) { if (!(a.w > 0 && a.h > 0 && b.w > 0 && b.h > 0)) return true; const ra = a.w / a.h, rb = b.w / b.h; return Math.abs(ra - rb) <= 0.03 * Math.max(ra, rb); }
  function dauerGleich(a, b) { return !istVideo(a) || !(a.dur > 0 && b.dur > 0) || Math.abs(a.dur - b.dur) <= 1500; }
  /** Zeitabstand passt zu „gleiche Aufnahme“: ± 2 s oder (nur mit Bildvergleich) um ganze halbe Stunden bis 14 h versetzt. */
  function zeitVersetzt(d) { if (d > H14) return false; const r = d % HALB; return r <= SEK || HALB - r <= SEK; }
  function abdruckGleich(a, b) { return !!((a.fp && (a.fp === b.fp || a.fp === b.fpd)) || (a.fpd && (a.fpd === b.fpd || a.fpd === b.fp))); }

  /** Warum könnten a und b dasselbe Foto/Video sein? 'datei' | 'name' | 'bild' | null. */
  function gleich(a, b) {
    if (!a || !b || a.id === b.id || istVideo(a) !== istVideo(b)) return null;
    if (abdruckGleich(a, b)) return 'datei';
    if (!hatZeit(a) || !hatZeit(b)) return null;
    const d = Math.abs(a.ts - b.ts);
    if (!dauerGleich(a, b)) return null;
    if (d <= SEK) { const n = grundName(a.name, a.id); if (n && n === grundName(b.name, b.id) && groesseGleich(a, b)) return 'name'; }
    if ((d <= SEK || zeitVersetzt(d)) && formGleich(a, b) && abstand(a.gr, b.gr) <= BILD_MAX) return 'bild';
    return null;
  }

  /** Gruppen gleicher Fotos/Videos. Gibt [{ ids: [...], grund }] zurück (ids nach Aufnahmezeit, Gruppen nach Zeit der ersten Aufnahme). */
  function gruppen(photos) {
    const ps = (photos || []).filter(p => p && p.id), par = new Map(), grund = new Map();
    const find = x => { while (par.get(x) !== x) { par.set(x, par.get(par.get(x))); x = par.get(x); } return x; };
    const verbinde = (a, b, g) => {
      const ra = find(a), rb = find(b);
      const best = [grund.get(ra), grund.get(rb), g].filter(Boolean).sort((x, y) => RANG[y] - RANG[x])[0];
      if (ra !== rb) par.set(rb, ra);
      grund.set(ra, best);
    };
    ps.forEach(p => par.set(p.id, p.id));
    // gleicher Abdruck: über Fächer, unabhängig von der Zeit
    const fach = new Map();
    ps.forEach(p => [p.fp, p.fpd].filter(Boolean).forEach(k => { k = (istVideo(p) ? 'v' : 'f') + k; if (fach.has(k)) verbinde(fach.get(k), p.id, 'datei'); else fach.set(k, p.id); }));
    // gleiche Aufnahme: nach Zeit sortiert, Fenster bis 14 h (weiter als ± 2 s nur mit Bildvergleich)
    const z = ps.filter(hatZeit).sort((a, b) => a.ts - b.ts);
    for (let i = 0; i < z.length; i++) {
      const a = z[i];
      for (let j = i + 1; j < z.length; j++) {
        const b = z[j], d = b.ts - a.ts;
        if (d > H14) break;
        if (d > SEK && (!a.gr || !b.gr || !zeitVersetzt(d))) continue;
        const g = gleich(a, b);
        if (g) verbinde(a.id, b.id, g);
      }
    }
    const byId = new Map(ps.map(p => [p.id, p])), out = new Map();
    ps.forEach(p => { const r = find(p.id); if (!out.has(r)) out.set(r, []); out.get(r).push(p); });
    return [...out.entries()].filter(([, l]) => l.length > 1).map(([r, l]) => {
      l.sort((a, b) => (a.ts || 0) - (b.ts || 0) || (a.id < b.id ? -1 : 1));
      return { ids: l.map(p => p.id), grund: grund.get(r) || 'bild' };
    }).sort((a, b) => (byId.get(a.ids[0]).ts || 0) - (byId.get(b.ids[0]).ts || 0));
  }

  /** Welche Fotos brauchen einen Bildvergleich (gr fehlt), weil ein anderes zur selben Zeit (± 2 s oder Zeitzonen-Versatz) mit gleichem Seitenverhältnis da ist? */
  function brauchtBild(photos) {
    const z = (photos || []).filter(p => p && p.id && hatZeit(p)).sort((a, b) => a.ts - b.ts), need = new Set();
    for (let i = 0; i < z.length; i++) for (let j = i + 1; j < z.length; j++) {
      const a = z[i], b = z[j], d = b.ts - a.ts;
      if (d > H14) break;
      if ((d <= SEK || zeitVersetzt(d)) && istVideo(a) === istVideo(b) && formGleich(a, b) && dauerGleich(a, b)) { if (!a.gr) need.add(a.id); if (!b.gr) need.add(b.id); }
    }
    return z.filter(p => need.has(p.id)).map(p => p.id);
  }

  /* ---------- Auswahl ---------- */
  /** Wie viel hängt an einem Foto? ctx: { titel: Set der Titelfoto-Kennungen, kommentare: { id: Anzahl } }. */
  function wert(p, ctx) {
    ctx = ctx || {};
    return (p.lat != null ? (p.pos === 'exif' ? 5 : 4) : 0) + (p.tour ? 3 : 0) + (ctx.titel && ctx.titel.has(p.id) ? 3 : 0)
      + (String(p.note || '').trim() ? 1 : 0) + (ctx.kommentare && ctx.kommentare[p.id] ? 1 : 0);
  }
  /** Das Foto, das bleiben soll: mit Ort, Tour, Titelfoto-Wahl, Notiz; bei Gleichstand das größere Bild, eines nicht aus dem Browser verkleinert, dann die kleinere Kennung (feste Wahl). */
  function behalten(fotos, ctx) {
    return fotos.slice().sort((a, b) => wert(b, ctx) - wert(a, ctx) || ((b.w || 0) * (b.h || 0)) - ((a.w || 0) * (a.h || 0))
      || ((a.src === 'rechner') - (b.src === 'rechner')) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0];
  }
  /** Vorschlag je Gruppe: { ids, grund, keep, drop: [ids] }. byId: Map oder Objekt id → Foto. */
  function vorschlag(gr, byId, ctx) {
    const get = id => (byId instanceof Map ? byId.get(id) : byId[id]);
    return gr.map(g => { const k = behalten(g.ids.map(get).filter(Boolean), ctx); return Object.assign({}, g, { keep: k.id, drop: g.ids.filter(id => id !== k.id) }); });
  }

  /* ---------- Übernahme ---------- */
  const leer = v => v == null || (typeof v === 'string' && !v.trim());
  /** Angaben der gelöschten Fotos auf das behaltene übertragen, wo es selbst nichts hat. Gibt { foto (neu), felder: ['Ort', 'Tour', 'Notiz', …] } zurück.
      Die Abdrücke der gelöschten wandern in fpx mit, damit ein späterer Import derselben Datei als „schon vorhanden“ gilt. */
  function uebernehmen(keep, drops) {
    const f = Object.assign({}, keep), felder = [];
    for (const d of drops) {
      if (f.lat == null && d.lat != null) { f.lat = d.lat; f.lon = d.lon; f.pos = d.pos || 'exif'; if (d.camShift != null) f.camShift = d.camShift; if (d.tzOff != null) f.tzOff = d.tzOff; if (!felder.includes('Ort')) felder.push('Ort'); }
      if (!f.tour && d.tour) { f.tour = d.tour; felder.push('Tour'); }
      for (const [k, l] of [['note', 'Notiz'], ['caption', 'Bildunterschrift'], ['stars', 'Bewertung']]) if (leer(f[k]) && !leer(d[k])) { f[k] = d[k]; felder.push(l); }
    }
    const fpx = new Set(f.fpx || []);
    drops.forEach(d => [d.fp, d.fpd].concat(d.fpx || []).forEach(x => { if (x && x !== f.fp && x !== f.fpd) fpx.add(x); }));
    if (fpx.size) f.fpx = [...fpx].slice(0, 20);
    return { foto: f, felder };
  }
  /** Verweise auf gelöschte Fotos umhängen: Kommentare (kv „comments“: { id: [..] }) und Titelfoto der Tourkachel (kv „tilebg“: { tourId: { kind, ph } }).
      Zeigte ein Titelfoto auf ein gelöschtes Foto, zeigt es danach auf das behaltene (gleiche Tour) oder wird neu gewählt. Gibt Kopien zurück. */
  function verweise(keep, dropIds, comments, tilebg) {
    const c = Object.assign({}, comments || {}), t = Object.assign({}, tilebg || {}), drop = new Set(dropIds);
    let n = 0;
    dropIds.forEach(id => { if (c[id] && c[id].length) { c[keep.id] = (c[keep.id] || []).concat(c[id]).sort((a, b) => (a.ts || 0) - (b.ts || 0)); n++; } delete c[id]; });
    Object.keys(t).forEach(tid => { const e = t[tid]; if (e && e.kind === 'photo' && drop.has(e.ph)) { if (keep.tour === tid) t[tid] = Object.assign({}, e, { ph: keep.id }); else delete t[tid]; n++; } });
    return { comments: c, tilebg: t, n };
  }

  /* ---------- Zahlen und Texte ---------- */
  /** groessen: { id: Bytes }. wahl: [{ ids, drop }]. → { fotos (zu löschen), gruppen (mit mindestens einem), bytes } */
  function summe(wahl, groessen) {
    let n = 0, m = 0, bytes = 0;
    (wahl || []).forEach(g => { const d = g.drop || []; if (d.length) { m++; n += d.length; d.forEach(id => { bytes += (groessen && groessen[id]) || 0; }); } });
    return { fotos: n, gruppen: m, bytes };
  }
  const mb = b => (b >= 1048576 * 10 ? Math.round(b / 1048576) : Math.round(b / 1048576 * 10) / 10).toString().replace('.', ',') + ' MB';
  function summeText(s) {
    if (!s.fotos) return 'Nichts zum Löschen ausgewählt';
    return (s.fotos === 1 ? '1 Foto' : s.fotos + ' Fotos') + ' in ' + (s.gruppen === 1 ? '1 Gruppe' : s.gruppen + ' Gruppen') + (s.bytes ? ' · ' + mb(s.bytes) + ' frei' : '');
  }
  const GRUND = { datei: 'Gleiche Datei', name: 'Gleicher Name, gleiche Zeit und Größe', bild: 'Gleiche Zeit, fast gleiches Bild – bitte vergleichen' };

  /* ---------- Import ---------- */
  const nameKey = (p, s) => grundName(p.name, p.id) + '|' + s + '|' + (p.w || 0) + 'x' + (p.h || 0) + '|' + (istVideo(p) ? 'v' : 'f');
  /** Verzeichnis der vorhandenen Fotos für den Import: Kennungen, Abdrücke (fp, fpd, fpx) und Name+Zeit+Größe. */
  function index(photos) { const ix = { ids: new Set(), fp: new Set(), nz: new Set() }; (photos || []).forEach(p => merke(ix, p)); return ix; }
  function merke(ix, p) {
    ix.ids.add(p.id);
    [p.fp, p.fpd].concat(p.fpx || []).forEach(x => { if (x) ix.fp.add((istVideo(p) ? 'v' : 'f') + x); });
    if (hatZeit(p) && grundName(p.name, p.id)) ix.nz.add(nameKey(p, Math.round(p.ts / 1000)));
  }
  /** Ist das neue Foto (Antwort der Hülle) schon da? 'gleich' (gleiche Kennung) | 'datei' | 'name' | null. */
  function bekannt(ix, m) {
    if (ix.ids.has(m.id)) return 'gleich';
    const v = istVideo(m) ? 'v' : 'f';
    if ((m.fp && ix.fp.has(v + m.fp)) || (m.fpd && ix.fp.has(v + m.fpd))) return 'datei';
    if (hatZeit(m) && grundName(m.name, m.id)) { const s = Math.round(m.ts / 1000); for (const k of [s - 1, s, s + 1]) if (ix.nz.has(nameKey(m, k))) return 'name'; }
    return null;
  }
  /** „3 Fotos hinzugefügt · 2 schon vorhanden, übersprungen“ (2.20.0: Mehrzahl ausgeschrieben) */
  function importText(n, skip, wort) {
    return n + (n === 1 ? ' Foto ' : ' Fotos ') + (wort || 'hinzugefügt') + (skip ? ' · ' + skip + ' schon vorhanden, übersprungen' : '');
  }

  const api = { SEK, HALB, H14, BILD_MAX, GRUND, abschnitte, abdruck, abdruckVon, raster, abstand, grundName, gleich, gruppen, brauchtBild, wert, behalten, vorschlag, uebernehmen, verweise, summe, summeText, mb, index, merke, bekannt, importText };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.FotoDoppeltCalc = api;
})(typeof window !== 'undefined' ? window : globalThis);
