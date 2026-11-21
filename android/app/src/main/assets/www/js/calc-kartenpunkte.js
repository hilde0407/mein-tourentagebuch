'use strict';
/* Rechenlogik ohne Oberfläche für die Tourenkarte (2.8.1): Startpunkte, Jahresfilter, Raster-Gruppierung, Ausschnitt, Schriftfarbe.
   Die Gruppierung rechnet in Weltpixeln (Web-Mercator, 256 · 2^z wie Leaflet). Das Raster hängt an der Welt, nicht am Bildschirm:
   Beim Verschieben der Karte springen die Gruppen darum nicht, nur beim Zoomen werden sie neu gebildet.
   Linien: ab Zoom LINIEN_ZOOM (9). Dort ist ein Bildpunkt etwa 200–300 m groß, eine Tour von 10 km also 35–50 px lang – klar als Linie erkennbar.
   Bei Zoom 8 schrumpft eine kurze Runde zu einem Klecks von 10–20 px, der unter dem Startpunkt verschwindet; dann zeigen die Punkte mehr.
   Ausnahme (linienAb): Liegen alle Touren innerhalb von WEIT_KM (1000 km) und passt der erste Ausschnitt erst unter Zoom 9, bleiben die Linien
   ab diesem Anfangszoom sichtbar – so sieht die Karte für Touren in einer Gegend aus wie bisher.
   Läuft im Browser (globales `KartenPunkte`) und in Node. */
(function (root) {
  const node = typeof module !== 'undefined' && module.exports;
  const TILE = 256, MAXLAT = 85.0511287798, RAD = Math.PI / 180;
  const LINIEN_ZOOM = 9, ZELLE = 40, WEIT_KM = 1000, LINIEN_MIN = 5;

  const gueltig = p => !!p && typeof p.lat === 'number' && typeof p.lon === 'number' && isFinite(p.lat) && isFinite(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180;

  /** Startpunkt einer Tour: gespeicherte Lage (t.lat/t.lon), sonst der erste Punkt mit Position aus pts, sonst null. */
  function startpunkt(t, pts) {
    if (t && gueltig(t)) return { lat: t.lat, lon: t.lon };
    for (const p of pts || []) if (gueltig(p)) return { lat: p.lat, lon: p.lon };
    return null;
  }
  /** Touren eines Jahres (Ortszeit des Starts); jahr leer/null = alle. */
  function jahrFilter(touren, jahr) {
    if (jahr === '' || jahr == null) return (touren || []).slice();
    return (touren || []).filter(t => t && t.start && String(new Date(t.start).getFullYear()) === String(jahr));
  }
  /** Weltpixel [x, y] in Zoomstufe z. */
  function welt(lat, lon, z) {
    const s = TILE * Math.pow(2, z), la = Math.max(-MAXLAT, Math.min(MAXLAT, lat)) * RAD;
    return [(lon + 180) / 360 * s, (1 - Math.log(Math.tan(la) + 1 / Math.cos(la)) / Math.PI) / 2 * s];
  }

  /** Punkte ({ lat, lon, … }) in Zoomstufe z zu Rasterzellen von zelle × zelle px zusammenfassen.
      Ergebnis: [{ lat, lon, n, punkte, sued, west, nord, ost }] – lat/lon ist der Mittelpunkt der Gruppe, die Ränder umfassen alle Punkte.
      Reihenfolge: wie die ersten Punkte der Gruppen in der Eingabe (stabil). Punkte ohne Position entfallen. */
  function gruppieren(punkte, z, zelle) {
    zelle = zelle > 0 ? zelle : ZELLE;
    const map = new Map(), out = [];
    for (const p of punkte || []) {
      if (!gueltig(p)) continue;
      const [x, y] = welt(p.lat, p.lon, z), key = Math.floor(x / zelle) + ':' + Math.floor(y / zelle);
      let g = map.get(key);
      if (!g) { g = { n: 0, punkte: [], sl: 0, so: 0, sued: 90, west: 180, nord: -90, ost: -180 }; map.set(key, g); out.push(g); }
      g.n++; g.punkte.push(p); g.sl += p.lat; g.so += p.lon;
      g.sued = Math.min(g.sued, p.lat); g.nord = Math.max(g.nord, p.lat); g.west = Math.min(g.west, p.lon); g.ost = Math.max(g.ost, p.lon);
    }
    return out.map(g => ({ lat: g.sl / g.n, lon: g.so / g.n, n: g.n, punkte: g.punkte, sued: g.sued, west: g.west, nord: g.nord, ost: g.ost }));
  }

  /** Entfernung in km (Haversine). */
  function km(a, b) {
    const d1 = (b.lat - a.lat) * RAD, d2 = (b.lon - a.lon) * RAD;
    const h = Math.sin(d1 / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(d2 / 2) ** 2;
    return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  /** Wie weit die Punkte verteilt sind: Diagonale ihres Rahmens in km (0 bei keinem oder einem Ort). */
  function spanneKm(punkte) {
    const v = (punkte || []).filter(gueltig);
    if (v.length < 2) return 0;
    let s = 90, w = 180, n = -90, o = -180;
    for (const p of v) { s = Math.min(s, p.lat); n = Math.max(n, p.lat); w = Math.min(w, p.lon); o = Math.max(o, p.lon); }
    return km({ lat: s, lon: w }, { lat: n, lon: o });
  }
  /** Ab welcher Zoomstufe Linien gezeichnet werden (siehe Kopf). startZoom: Zoom des ersten Ausschnitts (alle Touren). */
  function linienAb(spanne, startZoom) {
    if (spanne <= WEIT_KM && isFinite(startZoom) && startZoom < LINIEN_ZOOM) return Math.max(LINIEN_MIN, Math.floor(startZoom));
    return LINIEN_ZOOM;
  }
  /** Liegt der Rahmen [süd, west, nord, ost] (wie Tour.bbox) im Ausschnitt { s, w, n, e }? Berühren genügt. */
  function imAusschnitt(bb, v) {
    if (!bb || !v) return false;
    return !(bb[2] < v.s || bb[0] > v.n || bb[3] < v.w || bb[1] > v.e);
  }
  /** Zahl der Punkte im Ausschnitt { s, w, n, e }. */
  function zaehlen(punkte, v) { return (punkte || []).filter(p => gueltig(p) && imAusschnitt([p.lat, p.lon, p.lat, p.lon], v)).length; }
  /** „Keine Touren“, „1 Tour“, „12 Touren“. */
  const anzahlText = n => n === 0 ? 'Keine Touren' : n === 1 ? '1 Tour' : n.toLocaleString('de-DE') + ' Touren';

  /** Kontrast (WCAG) zweier Farben #rrggbb. */
  function kontrast(a, b) {
    const lum = h => { const c = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(v => v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
    const x = lum(a), y = lum(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  }
  /** Schriftfarbe auf einer Fläche: Weiß oder fast Schwarz, je nachdem, was besser lesbar ist. */
  const textFarbe = bg => /^#[0-9a-f]{6}$/i.test(bg || '') && kontrast(bg, '#ffffff') < kontrast(bg, '#0c2526') ? '#0c2526' : '#ffffff';
  /** Häufigste Sportart einer Gruppe (bei Gleichstand die zuerst genannte). */
  function haeufigste(arten) {
    const c = new Map(); let best = null, bn = 0;
    for (const a of arten || []) { const k = (c.get(a) || 0) + 1; c.set(a, k); if (k > bn) { bn = k; best = a; } }
    return best;
  }
  /** Durchmesser des Gruppenmarkers in px: 30 bei 2 Touren, wächst langsam, höchstens 46. */
  const groesse = n => Math.min(46, Math.round(30 + 4 * Math.log2(Math.max(1, n / 2))));

  const api = { LINIEN_ZOOM, ZELLE, WEIT_KM, startpunkt, jahrFilter, welt, gruppieren, km, spanneKm, linienAb, imAusschnitt, zaehlen, anzahlText, kontrast, textFarbe, haeufigste, groesse };
  if (node) module.exports = api; else root.KartenPunkte = api;
})(typeof window !== 'undefined' ? window : globalThis);
