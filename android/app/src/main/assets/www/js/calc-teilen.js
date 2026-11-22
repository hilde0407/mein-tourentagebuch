'use strict';
/* Rechenlogik ohne Oberfläche: „Tour als Bild teilen“ (2.13.0). Maße der Bildkarte (Hochformat 1080 × 1350 oder Quadrat 1080 × 1080), Titel in eine oder zwei Zeilen
   setzen (erst kleiner, dann kürzen), die Fotoauswahl (wie das Titelfoto der App: ohne erkanntes Gesicht zuerst, dann über die Tour verteilt) und die drei Kennzahlen.
   Zeichnen übernimmt js/v-teilen.js. Läuft im Browser (globales `TeilenCalc`) und in Node. */
(function (root) {
  const node = typeof module !== 'undefined' && module.exports;
  const P = node ? require('./calc-pdf.js') : root.Pdf;

  const FORMATE = { hoch: { w: 1080, h: 1350, label: 'Hochformat' }, quadrat: { w: 1080, h: 1080, label: 'Quadrat' } };
  const MAX_FOTOS = 3;
  /** Schriftgrößen des Titels (px), größte zuerst, und höchstens so viele Zeilen. */
  const TITEL = { hoch: { sizes: [72, 62, 54], zeilen: 2 }, quadrat: { sizes: [62, 54, 46], zeilen: 1 } };

  /** Titel setzen: die größte Schrift, bei der der Name ohne Kürzen in die erlaubten Zeilen passt; sonst die kleinste, gekürzt mit „…“.
      measureAt(size) gibt eine Messfunktion text → Breite zurück. → { size, lines, cut } */
  function titel(text, maxW, measureAt, format) {
    const T = TITEL[format] || TITEL.hoch, s = String(text == null ? '' : text).replace(/\s+/g, ' ').trim() || 'Tour';
    for (const size of T.sizes) {
      const u = P.umbruch(s, maxW, measureAt(size), T.zeilen);
      if (!u.cut) return { size, lines: u.lines, cut: false };
    }
    const size = T.sizes[T.sizes.length - 1], u = P.umbruch(s, maxW, measureAt(size), T.zeilen);
    return { size, lines: u.lines, cut: true };
  }

  /** Rechtecke der Bildkarte. o: { zeilen (Titelzeilen, 1–2), titelSize, fotos (0–3), profil (bool) }.
      Gibt { W, H, M, IW, kopf, titel: { y: [Grundlinien], size }, unter, zahlen: { y, ly, cols: [{ x, w }] }, karte, profil, fotos: [{ x, y, w, h }], fuss } zurück.
      Alle Flächen liegen innerhalb des Bildes, mit Rand M; die Karte ist nie niedriger als 260 px (Quadrat: 220). */
  function layout(format, o) {
    o = o || {};
    const f = FORMATE[format] ? format : 'hoch', { w: W, h: H } = FORMATE[f], q = f === 'quadrat';
    const M = 64, IW = W - 2 * M, kopf = q ? 104 : 120, gap = q ? 18 : 24;
    const size = o.titelSize || TITEL[f].sizes[0], zeilen = Math.max(1, Math.min(TITEL[f].zeilen, o.zeilen || 1)), lh = Math.round(size * 1.08);
    const t0 = kopf + (q ? 34 : 44) + size * 0.8, ty = Array.from({ length: zeilen }, (_, i) => Math.round(t0 + i * lh));
    const unter = Math.round(ty[ty.length - 1] + (q ? 46 : 54));
    const zy = Math.round(unter + (q ? 82 : 100)), zly = zy + (q ? 34 : 40), cg = 24, cw = (IW - 2 * cg) / 3;
    const cols = [0, 1, 2].map(i => ({ x: Math.round(M + i * (cw + cg)), w: Math.floor(cw) }));
    const fussH = q ? 44 : 52, unten = H - fussH;
    const nF = Math.max(0, Math.min(MAX_FOTOS, o.fotos || 0)), fH = nF ? (q ? 196 : 258) : 0, pH = o.profil ? (q ? 84 : 112) : 0;
    let y = zly + (q ? 28 : 36);
    const rest = unten - y - (fH ? fH + gap : 0) - (pH ? pH + gap : 0);
    const karte = { x: M, y, w: IW, h: Math.max(q ? 220 : 260, rest) };
    y += karte.h + gap;
    const profil = pH ? { x: M, y, w: IW, h: pH } : null; if (pH) y += pH + gap;
    const fotos = nF ? zellen(nF, M, y, IW, fH, 16) : [];
    return { W, H, M, IW, format: f, kopf, titel: { y: ty, size }, unter, zahlen: { y: zy, ly: zly, cols }, karte, profil, fotos, fuss: H - Math.round(fussH * 0.42) };
  }
  /** n gleich breite Zellen nebeneinander in (x, y, w, h) mit Abstand gap. */
  function zellen(n, x, y, w, h, gap) {
    if (!(n > 0)) return [];
    const cw = (w - gap * (n - 1)) / n;
    return Array.from({ length: n }, (_, i) => ({ x: Math.round(x + i * (cw + gap)), y, w: Math.floor(cw), h }));
  }

  /** Brauchbar fürs Bild: Foto (kein Video), mit Kennung. */
  const istFoto = p => !!p && !p.video && typeof p.id === 'string' && !/v$/.test(p.id);
  /** Ohne erkanntes Gesicht (unbekannt, -1 oder 0 zählen als brauchbar – wie beim Titelfoto der Kacheln). */
  const ohneGesicht = p => !(p.faces >= 1);
  /** Bis zu n Fotos der Tour. Fotos haben in der App keine eigene Bewertung; darum gilt die Regel des Titelfotos (pickPhoto): titelId (falls angegeben) zuerst,
      dann Fotos ohne erkanntes Gesicht, gleichmäßig über die Tour verteilt; erst wenn die fehlen, Personenfotos. Ergebnis in Aufnahmereihenfolge. */
  function fotoAuswahl(photos, n, titelId) {
    n = n == null ? MAX_FOTOS : Math.max(0, Math.min(MAX_FOTOS, n));
    const ps = (photos || []).filter(istFoto).slice().sort((a, b) => (a.ts || 0) - (b.ts || 0) || (a.id < b.id ? -1 : 1));
    if (!n || !ps.length) return [];
    const out = [], titelFoto = titelId ? ps.find(p => p.id === titelId) : null;
    if (titelFoto) out.push(titelFoto);
    const verteilt = (arr, k) => { if (k <= 0 || !arr.length) return []; if (arr.length <= k) return arr.slice(); return Array.from({ length: k }, (_, i) => arr[Math.round(i * (arr.length - 1) / Math.max(1, k - 1))]).filter((p, i, a) => a.indexOf(p) === i); };
    const gut = ps.filter(p => p !== titelFoto && ohneGesicht(p)), rest = ps.filter(p => p !== titelFoto && !ohneGesicht(p));
    out.push(...verteilt(gut, n - out.length));
    if (out.length < n) out.push(...verteilt(rest, n - out.length));
    return out.slice(0, n).sort((a, b) => ps.indexOf(a) - ps.indexOf(b));
  }

  /** Die drei Kennzahlen des Bildes (Rohwerte, null = fehlt): Strecke (m), Aufstieg (m), Zeit (s; Dauer, sonst Zeit in Bewegung – wie die Tourseite). */
  function kennzahlen(t) {
    t = t || {};
    const num = v => (typeof v === 'number' && isFinite(v) && v > 0 ? v : null);
    return { dist: num(t.dist), up: typeof t.up === 'number' && isFinite(t.up) && t.up >= 0 ? t.up : null, zeit: num(t.dur) || num(t.moving) };
  }
  /** Dateiname für die Hülle (nur A–Z, 0–9, . _ -). */
  const dateiname = (name, format) => P.dateiname(name, 'Tourentagebuch-Tour', 'jpg').replace(/\.jpg$/, format === 'quadrat' ? '-quadrat.jpg' : '.jpg');

  const api = { FORMATE, MAX_FOTOS, TITEL, titel, layout, zellen, istFoto, ohneGesicht, fotoAuswahl, kennzahlen, dateiname };
  if (node) module.exports = api; else root.TeilenCalc = api;
})(typeof window !== 'undefined' ? window : globalThis);
