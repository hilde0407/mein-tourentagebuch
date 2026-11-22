'use strict';
/* 2.11.0: Rechenlogik ohne Oberfläche für Offline-Karten. Welche Kacheln (256 × 256 px, Web-Mercator, Schema z/x/y) ein Rechteck oder eine Strecke
   mit Rand in den Zoomstufen zmin … zmax braucht, wie viele es sind, wie groß das etwa wird, welche Grenzen gelten und wie die Dateinamen lauten.
   Das Gegenstück in der Hülle ist TilePlan.java (gleiche Rechnung, gleiche Grenzen; die Hülle rechnet selbst und vertraut der Oberfläche nicht).
   Quellen: nur aus der festen Liste QUELLEN. Laden dürfen wir nur, wo der Betreiber Offline-Nutzung nicht verbietet:
   – OpenStreetMap-Standardkarte (tile.openstreetmap.org): die Nutzungsregeln verbieten Offline-Nutzung und jedes Vorausladen ausdrücklich → offline: false.
   – Wanderkarte (OpenTopoMap): kleine Mengen für den Eigenbedarf, sparsam (harte Grenzen unten) → offline: true.
   Läuft im Browser (globales `OfflineCalc`) und in Node. */
(function (root) {
  const node = typeof module !== 'undefined' && module.exports;
  const MAXLAT = 85.0511287798, RAD = Math.PI / 180, M_GRAD = 111320;
  const MB = 1048576;
  const QUELLEN = {
    osm: { name: 'Straßenkarte (OpenStreetMap)', url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', offline: false, kb: 20, attr: '© OpenStreetMap-Mitwirkende' },
    topo: { name: 'Wanderkarte (OpenTopoMap)', url: 'https://tile.opentopomap.org/{z}/{x}/{y}.png', offline: true, kb: 25, attr: '© OpenStreetMap-Mitwirkende, SRTM | © OpenTopoMap (CC-BY-SA)' },
  };
  const MAX_KACHELN = 2000;            // je Ausschnitt, hart (auch in TilePlan.java)
  const ZMIN = 10, ZMAX = 16;          // Zoomstufen: ab 10 (Übersicht), höchstens 16 (hart)
  const MAX_GESAMT = 400 * MB;         // alle geladenen Offline-Karten zusammen
  const RAND_M = 2000;                 // Rand um eine Strecke
  const ABDECKUNG_Z = 12;              // grobes Raster, um zu prüfen, ob ein Ort offline abgedeckt ist
  const ZAEHL_GRENZE = 60000;          // Zählen hört hier auf (Schätzung „mehr als …“), damit nichts hängt
  const MERKEN_MAX = 7500;             // gesehene Kacheln (Zwischenspeicher der Oberfläche), ≈ 150 MB
  const STUFEN = [['grob', 'Grob', 13], ['normal', 'Normal', 15], ['fein', 'Fein', 16]];

  const stufe = id => (STUFEN.find(s => s[0] === id) || STUFEN[1]);
  const zmaxVon = id => stufe(id)[2];
  const ganz = v => typeof v === 'number' && isFinite(v) && Math.floor(v) === v;

  /** Kachel (x, y) eines Punkts in Zoomstufe z; Breiten jenseits ±85,05° und Längen am Rand werden begrenzt. */
  function kachelXY(lat, lon, z) {
    const n = Math.pow(2, z), la = Math.max(-MAXLAT, Math.min(MAXLAT, lat)) * RAD;
    let x = Math.floor((lon + 180) / 360 * n), y = Math.floor((1 - Math.log(Math.tan(la) + 1 / Math.cos(la)) / Math.PI) / 2 * n);
    x = Math.max(0, Math.min(n - 1, x)); y = Math.max(0, Math.min(n - 1, y));
    return [x, y];
  }
  const schluessel = (z, x, y) => z * 1099511627776 + x * 1048576 + y;      // z·2^40 + x·2^20 + y (bis Zoom 20 eindeutig)
  const ausSchluessel = k => { const z = Math.floor(k / 1099511627776), r = k - z * 1099511627776; return [z, Math.floor(r / 1048576), r % 1048576]; };

  /** Zoomstufen prüfen und begrenzen: [zmin, zmax] oder null. */
  function zooms(zmin, zmax) {
    if (!ganz(zmin) || !ganz(zmax)) return null;
    const a = Math.max(0, zmin), b = Math.min(ZMAX, zmax);
    return a <= b ? [a, b] : null;
  }

  /** Anzahl der Kacheln für ein Rechteck b = { s, w, n, e } (Grad) in zmin … zmax – ohne die Liste zu bauen. */
  function zaehleRechteck(b, zmin, zmax) {
    const zz = zooms(zmin, zmax); if (!zz || !b) return 0;
    let n = 0;
    for (let z = zz[0]; z <= zz[1]; z++) {
      const [x0, y0] = kachelXY(b.n, b.w, z), [x1, y1] = kachelXY(b.s, b.e, z);
      n += Math.max(0, x1 - x0 + 1) * Math.max(0, y1 - y0 + 1);
    }
    return n;
  }
  /** Kachelliste für ein Rechteck: [[z, x, y], …] nach z, x, y sortiert; null, wenn es mehr als max sind. */
  function rechteck(b, zmin, zmax, max) {
    const lim = max == null ? MAX_KACHELN : max;
    if (zaehleRechteck(b, zmin, zmax) > lim) return null;
    const zz = zooms(zmin, zmax), out = [];
    if (!zz) return out;
    for (let z = zz[0]; z <= zz[1]; z++) {
      const [x0, y0] = kachelXY(b.n, b.w, z), [x1, y1] = kachelXY(b.s, b.e, z);
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.push([z, x, y]);
    }
    return out;
  }

  /** Stützpunkte entlang der Strecke: Abstand höchstens schritt Meter (Anfang, dann gleichmäßig je Abschnitt). pts: [[lat, lon], …]. */
  function stuetzen(pts, schritt) {
    const v = (pts || []).filter(p => p && isFinite(p[0]) && isFinite(p[1]) && Math.abs(p[0]) <= 90 && Math.abs(p[1]) <= 180);
    const out = [];
    for (let i = 0; i < v.length; i++) {
      const a = v[i];
      if (!i) { out.push([a[0], a[1]]); continue; }
      const b = v[i - 1], dy = (a[0] - b[0]) * M_GRAD, dx = (a[1] - b[1]) * M_GRAD * Math.cos((a[0] + b[0]) / 2 * RAD);
      const k = Math.ceil(Math.sqrt(dx * dx + dy * dy) / schritt);
      for (let j = 1; j <= k; j++) { const t = j / k; out.push([b[0] + (a[0] - b[0]) * t, b[1] + (a[1] - b[1]) * t]); }
    }
    return out;
  }
  /** Kacheln für eine Strecke mit Rand (Meter) in zmin … zmax. Um jeden Stützpunkt ein Quadrat mit halber Kantenlänge rand.
      Gibt { anzahl, kacheln: [[z, x, y], …] | null, mehr } zurück; kacheln = null, wenn es mehr als max sind (anzahl zählt bis ZAEHL_GRENZE, mehr = abgeschnitten). */
  function korridor(pts, rand, zmin, zmax, max) {
    const lim = max == null ? MAX_KACHELN : max, zz = zooms(zmin, zmax), m = Math.max(0, +rand || 0);
    const set = new Set();
    let mehr = false;
    if (zz) {
      const st = stuetzen(pts, Math.max(100, m));
      outer: for (let z = zz[0]; z <= zz[1]; z++) {
        for (const s of st) {
          const dla = m / M_GRAD, dlo = m / (M_GRAD * Math.max(0.01, Math.cos(s[0] * RAD)));
          const [x0, y0] = kachelXY(s[0] + dla, s[1] - dlo, z), [x1, y1] = kachelXY(s[0] - dla, s[1] + dlo, z);
          for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
            set.add(schluessel(z, x, y));
            if (set.size >= ZAEHL_GRENZE) { mehr = true; break outer; }
          }
        }
      }
    }
    const anzahl = set.size;
    if (anzahl > lim) return { anzahl, kacheln: null, mehr };
    return { anzahl, kacheln: [...set].sort((a, b) => a - b).map(ausSchluessel), mehr };
  }
  /** Umgebendes Rechteck einer Strecke mit Rand: { s, w, n, e } oder null. */
  function rahmen(pts, rand) {
    const v = (pts || []).filter(p => p && isFinite(p[0]) && isFinite(p[1]));
    if (!v.length) return null;
    let s = 90, w = 180, n = -90, e = -180;
    v.forEach(p => { s = Math.min(s, p[0]); n = Math.max(n, p[0]); w = Math.min(w, p[1]); e = Math.max(e, p[1]); });
    const m = Math.max(0, +rand || 0), dla = m / M_GRAD, dlo = m / (M_GRAD * Math.max(0.01, Math.cos((s + n) / 2 * RAD)));
    return { s: Math.max(-MAXLAT, s - dla), w: Math.max(-180, w - dlo), n: Math.min(MAXLAT, n + dla), e: Math.min(180, e + dlo) };
  }

  /** Grobes Raster (Zoom 12) der Kacheln: „x/y“, sortiert – reicht, um zu prüfen, ob ein Ort im Ausschnitt liegt. */
  function abdeckung(kacheln) {
    const set = new Set();
    (kacheln || []).forEach(([z, x, y]) => { if (z >= ABDECKUNG_Z) { const d = Math.pow(2, z - ABDECKUNG_Z); set.add(Math.floor(x / d) + '/' + Math.floor(y / d)); } });
    return [...set].sort();
  }
  /** Liegt der Ort (lat, lon) in einer der Offline-Karten? gebiete: [{ cover?: ['x/y'], bbox?: [s, w, n, e], src }]; quelle optional. */
  function abgedeckt(gebiete, lat, lon, quelle) {
    if (!isFinite(lat) || !isFinite(lon)) return false;
    const [x, y] = kachelXY(lat, lon, ABDECKUNG_Z), k = x + '/' + y;
    return (gebiete || []).some(g => {
      if (!g || (quelle && g.src !== quelle)) return false;
      if (Array.isArray(g.cover) && g.cover.length) return g.cover.indexOf(k) >= 0;
      const b = g.bbox; return Array.isArray(b) && lat >= b[0] && lat <= b[2] && lon >= b[1] && lon <= b[3];
    });
  }

  /** Geschätzte Größe in Bytes für n Kacheln dieser Quelle. */
  const schaetzung = (src, n) => Math.round((QUELLEN[src] ? QUELLEN[src].kb : 25) * 1024 * Math.max(0, n || 0));
  /** „12 MB“, „0,4 MB“, „1,2 GB“ (ohne ≈). */
  function mb(b) {
    b = Math.max(0, +b || 0);
    if (b >= 1024 * MB) return (b / 1024 / MB).toFixed(1).replace('.', ',') + ' GB';
    if (b >= 10 * MB) return Math.round(b / MB) + ' MB';
    if (b >= 0.05 * MB) return (b / MB).toFixed(1).replace('.', ',') + ' MB';
    return b > 0 ? '0,1 MB' : '0 MB';
  }
  const tausend = n => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  /** „≈ 1.234 Kacheln, ≈ 31 MB“. */
  const umfang = (src, n, mehr) => (mehr ? 'mehr als ' : '≈ ') + tausend(n) + (n === 1 ? ' Kachel' : ' Kacheln') + ', ≈ ' + mb(schaetzung(src, n));
  /** Darf geladen werden? { ok, grund, text }. belegt = Bytes aller Offline-Karten. */
  function pruefen(src, n, belegt) {
    const q = QUELLEN[src];
    if (!q) return { ok: false, grund: 'quelle', text: 'Unbekannte Kartenquelle.' };
    if (!q.offline) return { ok: false, grund: 'quelle', text: 'Diese Karte darf nicht offline gespeichert werden (Nutzungsregeln des Betreibers). Offline gibt es die Wanderkarte.' };
    if (!(n > 0)) return { ok: false, grund: 'leer', text: 'Kein Ausschnitt gewählt.' };
    if (n > MAX_KACHELN) return { ok: false, grund: 'zuviel', text: 'Zu groß: höchstens ' + tausend(MAX_KACHELN) + ' Kacheln je Ausschnitt. Bitte kleineren Ausschnitt oder „Grob“ wählen.' };
    if ((+belegt || 0) + schaetzung(src, n) > MAX_GESAMT) return { ok: false, grund: 'speicher', text: 'Zu wenig Platz: Offline-Karten dürfen zusammen höchstens ' + mb(MAX_GESAMT) + ' belegen. Bitte erst eine alte Karte löschen.' };
    return { ok: true, grund: '', text: '' };
  }

  /** Relativer Dateiname „topo/15/17440/11416.png“ oder null (Quelle nicht in der Liste, keine ganzen Zahlen, außerhalb des Rasters). */
  function pfad(src, z, x, y) {
    if (!Object.prototype.hasOwnProperty.call(QUELLEN, src)) return null;
    if (!ganz(z) || !ganz(x) || !ganz(y) || z < 0 || z > 19) return null;
    const n = Math.pow(2, z);
    if (x < 0 || y < 0 || x >= n || y >= n) return null;
    return src + '/' + z + '/' + x + '/' + y + '.png';
  }
  /** Adresse der gespeicherten Kachel beim virtuellen Server der Hülle (relativ) oder null. */
  const lokal = (src, z, x, y) => { const p = pfad(src, z, x, y); return p ? '/tiles/' + p : null; };
  /** Name eines Ausschnitts: ohne Steuerzeichen, höchstens 60 Zeichen, nie leer. */
  const name = (s, fb) => (String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60)) || fb || 'Offline-Karte';

  const api = { QUELLEN, MAX_KACHELN, ZMIN, ZMAX, MAX_GESAMT, RAND_M, ABDECKUNG_Z, ZAEHL_GRENZE, MERKEN_MAX, STUFEN, stufe, zmaxVon, kachelXY, zaehleRechteck, rechteck, stuetzen, korridor, rahmen,
    abdeckung, abgedeckt, schaetzung, mb, tausend, umfang, pruefen, pfad, lokal, name };
  if (node) module.exports = api; else root.OfflineCalc = api;
})(typeof window !== 'undefined' ? window : globalThis);
