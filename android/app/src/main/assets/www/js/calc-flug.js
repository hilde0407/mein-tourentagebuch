'use strict';
/* 2.16.0: Rechenlogik ohne Oberfläche für den 3D-Flug (js/v-flug.js). Läuft im Browser (globales `FlugCalc`) und in Node (tests/test_calc.js).
   - Darstellungsstufen „Flüssig / Normal / Schön“ (Auflösung, Gelände, Takt der Anzeigen)
   - Ausdünnen der Routenlinie (Douglas-Peucker in Metern)
   - Anpassung im Flug: zu langsame Bilder → eine Stufe herunter, mit Hysterese (kein Hin und Her)
   - Kamera als reine Funktion der Flugposition u (0…1): gleiche Position → gleiche Kamera, unabhängig davon, wie viele Bilder
     vorher gezeichnet wurden. Damit lässt sich der Flug später Bild für Bild abfahren (Video-Export, 2.17.0). */
(function (root) {
  const node = typeof module !== 'undefined' && module.exports;

  /** Stufen. pr = höchstes pixelRatio der Karte (Zeichenfläche); dem = höchste Zoomstufe der Höhenkacheln (weniger = weniger Kacheln);
   *  ueber = Überhöhung des Geländes; neig = Grundneigung der Kamera (flacher = weniger Kacheln bis zum Horizont);
   *  hud/spur = kürzester Abstand (ms) zwischen zwei Aktualisierungen der Kopfzeile bzw. der gelben „schon geflogen“-Linie;
   *  tol = Toleranz (m) beim Ausdünnen der Linie; schatten = Geländeschattierung (Hillshade). */
  const STUFEN = {
    fluessig: { name: 'Flüssig', pr: 1, dem: 12, ueber: 1.3, neig: 60, hud: 200, spur: 250, tol: 5, schatten: false },
    normal: { name: 'Normal', pr: 1.5, dem: 13, ueber: 1.4, neig: 64, hud: 150, spur: 160, tol: 3, schatten: false },
    schoen: { name: 'Schön', pr: 2.5, dem: 14, ueber: 1.5, neig: 68, hud: 100, spur: 100, tol: 1.5, schatten: true },
  };
  const FOLGE = ['schoen', 'normal', 'fluessig'];
  const WAHL = [['fluessig', 'Flüssig (empfohlen)'], ['normal', 'Normal'], ['schoen', 'Schön (braucht ein starkes Handy)']];

  /** Gültige Stufe; leer/unbekannt → Vorgabe: auf Handys (App-Hülle oder Fingerbedienung) „Flüssig“, sonst „Normal“. */
  function stufe(v, handy) { return STUFEN[v] ? v : (handy ? 'fluessig' : 'normal'); }

  /** pixelRatio der Karte: nie über dem des Geräts und nie über der Grenze der Stufe. */
  function pixelRatio(st, dpr) {
    const d = +dpr > 0 ? +dpr : 1;
    return Math.min(d, (STUFEN[st] || STUFEN.fluessig).pr);
  }

  /** Nächst einfachere Stufe oder null. */
  function tiefer(st) { const i = FOLGE.indexOf(st); return i >= 0 && i < FOLGE.length - 1 ? FOLGE[i + 1] : null; }

  /** Douglas-Peucker auf Punkten [lng, lat] (Toleranz in Metern, örtlich flach gerechnet). Liefert die Indizes der behaltenen Punkte
   *  (aufsteigend, erster und letzter immer dabei). Ohne Rekursion, damit lange Spuren den Stapel nicht sprengen. */
  function duenneIdx(pts, tol) {
    const n = pts.length;
    if (n <= 2) return pts.map((_, i) => i);
    const lat0 = pts[0][1] * Math.PI / 180, kx = 111320 * Math.cos(lat0), ky = 110540;
    const X = new Float64Array(n), Y = new Float64Array(n);
    for (let i = 0; i < n; i++) { X[i] = pts[i][0] * kx; Y[i] = pts[i][1] * ky; }
    const keep = new Uint8Array(n); keep[0] = keep[n - 1] = 1;
    const st = [0, n - 1], t2 = tol * tol;
    while (st.length) {
      const b = st.pop(), a = st.pop();
      const dx = X[b] - X[a], dy = Y[b] - Y[a], L = dx * dx + dy * dy;
      let best = -1, bi = -1;
      for (let i = a + 1; i < b; i++) {
        let d;
        if (L === 0) d = (X[i] - X[a]) ** 2 + (Y[i] - Y[a]) ** 2;
        else { const c = (dx * (Y[a] - Y[i]) - dy * (X[a] - X[i])); d = c * c / L; }
        if (d > best) { best = d; bi = i; }
      }
      if (bi > 0 && best > t2) { keep[bi] = 1; st.push(a, bi, bi, b); }
    }
    const out = [];
    for (let i = 0; i < n; i++) if (keep[i]) out.push(i);
    return out;
  }
  function duenne(pts, tol) { return duenneIdx(pts, tol).map(i => pts[i]); }

  /** Fälligkeit einer gedrosselten Aktualisierung (Kopfzeile, Linie). */
  function faellig(letzte, jetzt, ms) { return letzte == null || jetzt - letzte >= ms; }

  /* ---------- Anpassung im Flug (Hysterese) ----------
     Fenster aus 30 Bildzeiten; ist der Schnitt über 40 ms (unter 25 Bildern je Sekunde), geht es eine Stufe herunter. Danach werden
     60 Bilder lang keine Zeiten gezählt (Karte stellt sich um, Kacheln laden neu), und ein neues volles Fenster ist nötig.
     Hochgeschaltet wird im laufenden Flug nie – so kann es nicht zwischen zwei Stufen hin und her springen.
     Einzelne sehr lange Abstände (> 1 s: App im Hintergrund, Laden) zählen nicht; in der Pause wird nicht gezählt. */
  const ADAPT = { fenster: 30, grenze: 40, ruhe: 60, ausreisser: 1000 };
  function adaptiv(st) { return { stufe: stufe(st, true), buf: [], ruhe: 0 }; }
  /** Eine Bildzeit verbuchen. Rückgabe: neue Stufe, wenn heruntergeschaltet wurde, sonst null. Ändert den Zustand a. */
  function adaptivSchritt(a, ms) {
    if (!(ms > 0) || ms > ADAPT.ausreisser) return null;
    if (a.ruhe > 0) { a.ruhe--; return null; }
    a.buf.push(ms); if (a.buf.length > ADAPT.fenster) a.buf.shift();
    if (a.buf.length < ADAPT.fenster) return null;
    const m = a.buf.reduce((x, y) => x + y, 0) / a.buf.length;
    const t = m > ADAPT.grenze ? tiefer(a.stufe) : null;
    if (!t) return null;
    a.stufe = t; a.buf = []; a.ruhe = ADAPT.ruhe;
    return t;
  }

  /* ---------- Kamera als Funktion der Position ---------- */
  function peil(a, b) {
    const r = Math.PI / 180, y = Math.sin((b.lng - a.lng) * r) * Math.cos(b.lat * r), x = Math.cos(a.lat * r) * Math.sin(b.lat * r) - Math.sin(a.lat * r) * Math.cos(b.lat * r) * Math.cos((b.lng - a.lng) * r);
    return (Math.atan2(y, x) / r + 360) % 360;
  }
  /** Blickrichtung je Punkt: zum Punkt `vor` Schritte weiter, dann über ±w Punkte gemittelt (als Einheitsvektoren, damit 359°/1° stimmt).
   *  Ersetzt die frühere Glättung „pro Bild in Echtzeit“: das Ergebnis hängt nur von der Strecke ab. */
  function peilungen(S, vor, w) {
    const N = S.length, raw = new Float64Array(N), out = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      const j = Math.min(N - 1, i + vor);
      raw[i] = j > i ? peil(S[i], S[j]) : (i > 0 ? raw[i - 1] : 0);
    }
    const cx = new Float64Array(N + 1), cy = new Float64Array(N + 1);
    for (let i = 0; i < N; i++) { cx[i + 1] = cx[i] + Math.sin(raw[i] * Math.PI / 180); cy[i + 1] = cy[i] + Math.cos(raw[i] * Math.PI / 180); }
    for (let i = 0; i < N; i++) {
      const a = Math.max(0, i - w), b = Math.min(N - 1, i + w);
      const sx = cx[b + 1] - cx[a], sy = cy[b + 1] - cy[a];
      out[i] = sx === 0 && sy === 0 ? raw[i] : (Math.atan2(sx, sy) * 180 / Math.PI + 360) % 360;
    }
    return out;
  }
  function winkelLerp(a, b, f) { const d = ((b - a + 540) % 360) - 180; return (a + d * f + 360) % 360; }

  /** Neigungstabelle: Stützstellen alle `schritt` Punkte; Wert null = noch nicht berechnet (dann Grundneigung). */
  function neigTabelle(N, schritt) { return { schritt: Math.max(1, schritt), w: new Array(Math.ceil(N / Math.max(1, schritt)) + 1).fill(null) }; }
  /** Neigung an der Stelle f (Punktindex, gebrochen): je Stützstelle das Minimum aus ihr und den zwei folgenden (Berge früh
   *  vorwegnehmen), dazwischen linear. */
  function neigBei(T, f, basis) {
    if (!T) return basis;
    const v = k => { let m = basis; for (let j = k - 1; j <= k + 2; j++) { const x = T.w[Math.max(0, Math.min(T.w.length - 1, j))]; if (x != null && x < m) m = x; } return m; };
    const q = f / T.schritt, k = Math.floor(q), r = q - k;
    return v(k) + (v(k + 1) - v(k)) * r;
  }

  /** Kamera bei Flugposition u (0…1). B = { S (geglättete Mitte), P (Pfad mit trans/tq für Reiseflüge), brg (peilungen), neig (Tabelle) };
   *  o = { zBase, neigung: 'auto' | Zahl, basis (Grundneigung der Stufe), set (Reiseflug), rec (Aufnahme) }.
   *  zoom ist null, wenn der Flug den Zoom dem Menschen überlässt (Einzelflug ohne Aufnahme). Reine Funktion. */
  function kamera(u, B, o) {
    const N = B.S.length, f = Math.max(0, Math.min(1, u)) * (N - 1), i = Math.min(N - 2, Math.floor(f)), r = f - i;
    const a = B.S[i], b = B.S[i + 1] || a, p = B.P[Math.min(N - 1, Math.round(f))];
    const out = { center: [a.lng + (b.lng - a.lng) * r, a.lat + (b.lat - a.lat) * r], bearing: winkelLerp(B.brg[i], B.brg[Math.min(N - 1, i + 1)], r), pitch: null, zoom: null };
    if (o.neigung === 'auto') {
      let pi = neigBei(B.neig, f, o.basis);
      if (o.set && p && p.trans) pi = Math.min(pi, o.basis - 22 * Math.sin(Math.PI * p.tq));
      out.pitch = pi;
    }
    if (o.set || o.rec) out.zoom = o.zBase + (o.rec ? 0.9 : 0) - (o.set && p && p.trans ? 4 * Math.sin(Math.PI * p.tq) : 0);
    return out;
  }

  /** Steilster Neigungswinkel (≤ base), bei dem die Sicht von der Kamera zum Punkt frei ist. elev(lng, lat) → Meter oder null.
   *  voll = false, wenn Höhendaten fehlten (dann später noch einmal rechnen). */
  function freieNeigung(elev, lng, lat, bearing, base, D, floor) {
    floor = floor == null ? 28 : floor;
    const br = bearing * Math.PI / 180, kx = 111320 * Math.cos(lat * Math.PI / 180), ky = 110540, aim = 25;
    let voll = true;
    for (let th = base; th >= floor; th -= 4) {
      const al = th * Math.PI / 180, dh = D * Math.sin(al), hz = D * Math.cos(al);
      let ok = true;
      for (let k = 1; k <= 14 && ok; k++) {
        const f = k / 15, e = elev(lng - Math.sin(br) * dh * (1 - f) / kx, lat - Math.cos(br) * dh * (1 - f) / ky);
        if (e == null) voll = false;
        else if (e > aim + (hz - aim) * (1 - f) - 25) ok = false;
      }
      if (ok) return { th, voll };
    }
    return { th: floor, voll };
  }

  /** Mindestabstand zwischen zwei gezeichneten Bildern (ms). Bei 120/144-Hz-Bildschirmen wird so nur jedes zweite Bild gezeichnet
   *  (60/72 je Sekunde), bei 60 und 90 Hz jedes. */
  const BILD_MIN_MS = 10;

  /* ---------- 2.17.0: Video-Export Bild für Bild (Plan ohne Oberfläche; dieselben Werte stehen in VideoExportPlan.java) ----------
     Auflösung = kurze Seite (720/1080/1440/2160), Format quer 16:9 / hoch 9:16 / quadratisch 1:1. Die Karte wird in einem Feld mit 720 CSS-Pixeln
     kurzer Seite gezeichnet (so sieht der Ausschnitt bei jeder Auflösung gleich aus), die Schärfe kommt über das pixelRatio (kurz / 720). */
  const VIDEO = {
    AUFL: [[720, '720p (HD)'], [1080, '1080p (Full HD)'], [1440, '1440p (2K)'], [2160, '2160p (4K)']],
    FORMATE: [['quer', 'Quer 16:9'], ['hoch', 'Hoch 9:16'], ['quadrat', 'Quadratisch 1:1']],
    DAUERN: [[30, '30 Sekunden'], [60, '1 Minute'], [100, '100 Sekunden (wie der Flug)'], [120, '2 Minuten'], [180, '3 Minuten'], [300, '5 Minuten']],
    FPS: [30, 60],
    /** Datenrate (Mbit/s) bei 30 Bildern/s und 16:9, H.264. */
    MBIT: { 720: 8, 1080: 18, 1440: 30, 2160: 50 },
    MAX_BILDER: 9000,          // 30 Bilder/s × 5 Minuten
    MIN_DAUER: 5,
    MAX_DAUER: 300,
    NACHLAUF: 1,               // Sekunden Standbild am Ende
    FOTO_S: 4.5,               // so lange steht ein Foto im Video
    MIN_FREI_MB: 500,          // so viel muss nach dem Export noch frei sein
    CSS_KURZ: 720,
    KEY_S: 2,                  // alle 2 s ein Schlüsselbild
  };
  function videoGroesse(kurz, format) {
    const k = Math.round(+kurz / 2) * 2, l = Math.round(k * 16 / 9 / 2) * 2;
    return format === 'hoch' ? { w: k, h: l } : format === 'quadrat' ? { w: k, h: k } : { w: l, h: k };
  }
  /** Feld der Karte in CSS-Pixeln und pixelRatio: Zeichenfläche = genau w × h. */
  function videoFeld(w, h) {
    const pr = Math.min(w, h) / VIDEO.CSS_KURZ, r = Math.max(0.25, pr);
    return { pr: r, cw: Math.round(w / r), ch: Math.round(h / r) };
  }
  /** Datenrate in bit/s: Tabelle nach kurzer Seite, mit der Bildpunktzahl (quadratisch weniger), 60 Bilder/s × 1,5, HEVC × 0,65. Auf 0,5 Mbit/s gerundet. */
  function videoBitrate(w, h, fps, codec) {
    const kurz = Math.min(w, h), lang = Math.max(w, h);
    const basis = VIDEO.MBIT[kurz] || 18 * kurz * kurz / (1080 * 1080);      // Zwischengrößen (nur Tests) nach Bildpunkten wie 1080p
    const flaeche = Math.min(1, lang / (kurz * 16 / 9));                       // quadratisch: 56 % der Bildpunkte von 16:9
    const mbit = basis * flaeche * (fps > 30 ? 1.5 : 1) * (codec === 'hevc' ? 0.65 : 1);
    return Math.max(1, Math.round(mbit * 2) / 2) * 1e6;
  }
  /** Bildzahl: Flug (dauer s) plus Standbild am Ende. */
  function videoBilder(dauer, fps) { return Math.round(dauer * fps) + Math.round(VIDEO.NACHLAUF * fps); }
  /** Zeitstempel von Bild i in Mikrosekunden (ganzzahlig, gleichmäßig). */
  function videoZeitUs(i, fps) { return Math.round(i * 1e6 / fps); }
  /** Flugzeit (Sekunden bei Tempo 1×, wie Flug.aktiv.stelleZeit) für Bild i: Videozeit i/fps, auf die Flugdauer gestreckt; danach Standbild. */
  function videoFlugZeit(i, fps, dauer, ttot) { return Math.min(ttot, (i / fps) * ttot / dauer); }
  /** Erwartete Dateigröße in MB (Datenrate × Länge, 2 % Verpackung). */
  function videoMB(bitrate, sekunden) { return bitrate * sekunden / 8 / 1e6 * 1.02; }
  /** Platzbedarf: Datei im Zwischenspeicher + Kopie in der Galerie + Reserve. */
  function videoBedarfMB(mb) { return Math.ceil(mb * 2 + VIDEO.MIN_FREI_MB); }
  /** Rechenzeit (s): bekannt → aus gemessenen ms je Bild; sonst grobe Annahme je Auflösung (Karte schon geladen; ohne Offline-Karte eher länger). */
  function videoRechenzeit(n, msProBild, kurz) {
    const ms = msProBild > 0 ? msProBild : ({ 720: 250, 1080: 400, 1440: 650, 2160: 1200 }[kurz] || 400);
    return n * ms / 1000;
  }
  /** Prüfung vor dem Start. o = { kurz, format, fps, dauer, codec, w?, h? }; g = { encLang, encKurz (größte Seiten des Kodierers), glMax, freiMB, ramGB }.
   *  Rückgabe { w, h, n, bitrate, mb, bedarf, fehler: [], warn: [] }. Fehlende Grenzen (null) werden nicht geprüft. */
  function videoPruefe(o, g) {
    g = g || {};
    const s = o.w && o.h ? { w: o.w, h: o.h } : videoGroesse(o.kurz, o.format), fps = +o.fps || 30, dauer = +o.dauer || 0;
    const n = videoBilder(dauer, fps), bitrate = videoBitrate(s.w, s.h, fps, o.codec), sek = n / fps, mb = videoMB(bitrate, sek), bedarf = videoBedarfMB(mb);
    const fehler = [], warn = [], lang = Math.max(s.w, s.h), kurz = Math.min(s.w, s.h);
    if (!(dauer >= VIDEO.MIN_DAUER)) fehler.push('Das Video muss mindestens ' + VIDEO.MIN_DAUER + ' Sekunden lang sein.');
    if (dauer > VIDEO.MAX_DAUER) fehler.push('Höchstens ' + VIDEO.MAX_DAUER / 60 + ' Minuten.');
    if (n > VIDEO.MAX_BILDER) fehler.push('Zu viele Bilder (' + n + '): höchstens ' + VIDEO.MAX_BILDER + ' – also 5 Minuten bei 30 oder 2½ Minuten bei 60 Bildern je Sekunde.');
    if (g.encLang && g.encKurz && (lang > g.encLang || kurz > g.encKurz)) fehler.push('Der Video-Kodierer dieses Handys schafft höchstens ' + g.encLang + ' × ' + g.encKurz + '.');
    if (g.glMax && lang > g.glMax) fehler.push('Die Grafik dieses Handys kann höchstens ' + g.glMax + ' Bildpunkte breit zeichnen.');
    if (g.freiMB != null && g.freiMB < bedarf) fehler.push('Zu wenig freier Speicher: etwa ' + bedarf + ' MB nötig, ' + Math.floor(g.freiMB) + ' MB frei.');
    if (g.ramGB && g.ramGB < 8 && kurz > 1440) warn.push('4K braucht viel Arbeitsspeicher; auf Handys unter 8 GB kann es abbrechen. 1440p ist sicherer.');
    if (n > 3000 && kurz >= 1440) warn.push('Lang und groß: das dauert sehr lange.');
    return { w: s.w, h: s.h, n, bitrate, mb, bedarf, fehler, warn };
  }
  /** Welche Auflösungen sind möglich? [{ kurz, name, ok, grund }]. */
  function videoAngebot(format, g) {
    return VIDEO.AUFL.map(([kurz, name]) => {
      const s = videoGroesse(kurz, format), lang = Math.max(s.w, s.h), k = Math.min(s.w, s.h);
      const grund = g && g.encLang && g.encKurz && (lang > g.encLang || k > g.encKurz) ? 'Kodierer zu klein' : g && g.glMax && lang > g.glMax ? 'Grafik zu klein' : '';
      return { kurz, name, ok: !grund, grund };
    });
  }
  /** Dateiname „Flug_<Tourname>_<JJJJ-MM-TT>.mp4“: Umlaute umschreiben, nur Buchstaben, Ziffern, _ und -; Name höchstens 60 Zeichen. */
  function videoName(tour, ms) {
    const um = { ä: 'ae', ö: 'oe', ü: 'ue', Ä: 'Ae', Ö: 'Oe', Ü: 'Ue', ß: 'ss' };
    let n = String(tour || '').replace(/[äöüÄÖÜß]/g, c => um[c]).normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^A-Za-z0-9_-]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '').slice(0, 60).replace(/_$/, '');
    const d = new Date(ms > 0 ? ms : Date.now()), p = x => String(x).padStart(2, '0');
    return 'Flug_' + (n || 'Tour') + '_' + d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + '.mp4';
  }
  /** Welches Foto steht zur Videozeit tv (s) im Bild? fotoU = Flugpositionen (0…1) der Fotos, aufsteigend. Ein Foto erscheint, wenn der Flug
   *  daran vorbeikommt, und bleibt FOTO_S Sekunden (das nächste löst ab). -1 = keines. */
  function videoFotoBei(fotoU, tv, dauer, zeig) {
    zeig = zeig == null ? VIDEO.FOTO_S : zeig;
    let best = -1;
    for (let k = 0; k < fotoU.length; k++) { const tp = fotoU[k] * dauer; if (tp <= tv + 1e-9 && tv - tp < zeig) best = k; }
    return best;
  }
  /** Kartenquelle für die Einblendung (immer im Video). */
  function videoQuelle(stil) {
    const k = { osm: '© OpenStreetMap-Mitwirkende', topo: '© OpenTopoMap (CC-BY-SA), © OpenStreetMap-Mitwirkende', sat: 'Bild: Esri, Maxar, Earthstar Geographics' }[stil] || '© OpenStreetMap-Mitwirkende';
    return k + ' · Höhen: Mapzen/AWS Terrain Tiles';
  }
  /* Codec-Kennungen für WebCodecs mit passender Stufe (Level): H.264 nach Makroblöcken je Sekunde und Datenrate (High-Profil), HEVC nach Bildpunkten. */
  const AVC_LEVEL = [[31, 108000, 3600, 17500], [32, 216000, 5120, 25000], [40, 245760, 8192, 25000], [41, 245760, 8192, 62500], [42, 522240, 8704, 62500],
    [50, 589824, 22080, 168750], [51, 983040, 36864, 300000], [52, 2073600, 36864, 300000], [60, 4177920, 139264, 300000]];
  function avcLevel(w, h, fps, bitrate) {
    const fs = Math.ceil(w / 16) * Math.ceil(h / 16), mbps = fs * fps, kb = (bitrate || 0) / 1000;
    const l = AVC_LEVEL.find(([, mb, f, br]) => mbps <= mb && fs <= f && kb <= br);
    return l ? l[0] : 62;
  }
  function avcCodec(w, h, fps, bitrate, profil) {
    const p = { high: '6400', main: '4D40', base: '42E0' }[profil || 'high'];
    return 'avc1.' + p + avcLevel(w, h, fps, bitrate).toString(16).toUpperCase().padStart(2, '0');
  }
  const HEVC_LEVEL = [[93, 983040, 33177600], [120, 2228224, 66846720], [123, 2228224, 133693440], [150, 8912896, 267386880], [153, 8912896, 534773760], [156, 8912896, 1069547520]];
  function hevcCodec(w, h, fps) {
    const ps = w * h, rate = ps * fps, l = HEVC_LEVEL.find(([, p, r]) => ps <= p && rate <= r);
    return 'hvc1.1.6.L' + (l ? l[0] : 186) + '.B0';
  }
  const video = { VIDEO, groesse: videoGroesse, feld: videoFeld, bitrate: videoBitrate, bilder: videoBilder, zeitUs: videoZeitUs, flugZeit: videoFlugZeit,
    mb: videoMB, bedarfMB: videoBedarfMB, rechenzeit: videoRechenzeit, pruefe: videoPruefe, angebot: videoAngebot, name: videoName, fotoBei: videoFotoBei,
    quelle: videoQuelle, avcLevel, avcCodec, hevcCodec };

  const api = { STUFEN, FOLGE, WAHL, ADAPT, BILD_MIN_MS, stufe, pixelRatio, tiefer, duenneIdx, duenne, faellig, adaptiv, adaptivSchritt, peil, peilungen, winkelLerp, neigTabelle, neigBei, kamera, freieNeigung, video };
  if (node) module.exports = api; else root.FlugCalc = api;
})(typeof window !== 'undefined' ? window : this);
