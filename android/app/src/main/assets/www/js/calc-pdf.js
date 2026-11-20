'use strict';
/* Rechenlogik ohne Oberfläche für „Als PDF“ (2.5.0): ein kleines PDF-1.4 ohne Bibliothek und ohne Server.
   Jede Seite ist ein Bild (JPEG, mit /DCTDecode eingebettet) in A4-Größe; das Zeichnen der Seiten übernimmt js/v-pdf.js (Canvas).
   Hier steht nur, was sich ohne Oberfläche rechnen und prüfen lässt:
   - Pdf.writer() / Pdf.build(): Objekte, Querverweistabelle (xref) mit den echten Byte-Abständen, Seitenbaum, ein Bild je Seite;
   - Pdf.jpegInfo(): Breite, Höhe und Farbkanäle aus dem JPEG (für den richtigen /ColorSpace);
   - Seitenaufteilung der Tourenliste (Monatsüberschriften, keine Überschrift allein am Seitenende), Fotoraster, Skizze und Höhenprofil als Punktlisten,
     Zeilenumbruch mit einer Messfunktion, Dateiname.
   Läuft im Browser (globales `Pdf`) und in Node. */
(function (root) {
  const node = typeof module !== 'undefined' && module.exports;

  /** A4 hoch in Punkten (1 pt = 1/72 Zoll) und die Seite als Bild bei 150 dpi: 1240 × 1754 Pixel. */
  const A4 = { w: 595.28, h: 841.89 }, SEITE = { w: 1240, h: 1754, dpi: 150 };

  const ascii = s => { const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 255; return b; };
  /** PDF-Textzeichenfolge in UTF-16BE (mit Byte-Reihenfolge-Marke) als Hex-Zeichenfolge – so stehen Umlaute und Sonderzeichen im Titel richtig. */
  function utf16hex(s) {
    let o = 'FEFF';
    for (let i = 0; i < s.length; i++) o += s.charCodeAt(i).toString(16).toUpperCase().padStart(4, '0');
    return '<' + o + '>';
  }
  const p2 = n => String(n).padStart(2, '0');
  /** PDF-Datum „D:20261120143000Z“ (UTC). */
  function pdfDatum(d) { return 'D:' + d.getUTCFullYear() + p2(d.getUTCMonth() + 1) + p2(d.getUTCDate()) + p2(d.getUTCHours()) + p2(d.getUTCMinutes()) + p2(d.getUTCSeconds()) + 'Z'; }
  const zahl = n => String(Math.round(n * 100) / 100);

  /** Größe und Kanäle eines JPEG (aus dem ersten SOF-Block). Wirft bei Dateien, die kein JPEG sind. */
  function jpegInfo(b) {
    if (!b || b.length < 4 || b[0] !== 0xFF || b[1] !== 0xD8) throw new Error('Kein JPEG');
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xFF) { i++; continue; }
      const m = b[i + 1];
      if (m === 0xFF) { i++; continue; }
      if (m === 0xD8 || m === 0x01 || (m >= 0xD0 && m <= 0xD7)) { i += 2; continue; }
      const len = (b[i + 2] << 8) | b[i + 3];
      if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) return { h: (b[i + 5] << 8) | b[i + 6], w: (b[i + 7] << 8) | b[i + 8], comps: b[i + 9] };
      i += 2 + len;
    }
    throw new Error('JPEG ohne Größenangabe');
  }

  /** Schreiber für ein PDF aus Bildseiten. addPage(jpeg) legt je Seite Seitenobjekt, Inhalt und Bild an; finish() liefert die fertigen Bytes.
      opts: title, author, creator, created (Date), dpi (Vorgabe 150: die Seite ist dann A4). */
  function writer(opts) {
    opts = opts || {};
    const chunks = [], offs = [];
    let pos = 0, pages = 0, done = false;
    const kids = [];
    const push = b => { chunks.push(b); pos += b.length; };
    const obj = (id, head, stream) => {
      offs[id] = pos;
      push(ascii(id + ' 0 obj\n' + head + '\n'));
      if (stream) { push(ascii('stream\n')); push(stream); push(ascii('\nendstream\n')); }
      push(ascii('endobj\n'));
    };
    push(ascii('%PDF-1.4\n')); push(new Uint8Array([0x25, 0xE2, 0xE3, 0xCF, 0xD3, 0x0A]));      // Kommentarzeile mit Bytes über 127: kennzeichnet die Datei als binär
    const dpi = opts.dpi || SEITE.dpi;
    return {
      get pages() { return pages; },
      get size() { return pos; },
      addPage(jpeg) {
        if (done) throw new Error('PDF ist schon fertig');
        const info = jpegInfo(jpeg), cs = info.comps === 1 ? '/DeviceGray' : info.comps === 4 ? '/DeviceCMYK' : '/DeviceRGB';
        const base = 4 + pages * 3, pw = info.w * 72 / dpi, ph = info.h * 72 / dpi;
        const content = ascii('q ' + zahl(pw) + ' 0 0 ' + zahl(ph) + ' 0 0 cm /Im0 Do Q\n');
        obj(base, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + zahl(pw) + ' ' + zahl(ph) + '] /Resources << /XObject << /Im0 ' + (base + 2) + ' 0 R >> /ProcSet [/PDF /ImageC] >> /Contents ' + (base + 1) + ' 0 R >>');
        obj(base + 1, '<< /Length ' + content.length + ' >>', content);
        obj(base + 2, '<< /Type /XObject /Subtype /Image /Width ' + info.w + ' /Height ' + info.h + ' /ColorSpace ' + cs + ' /BitsPerComponent 8 /Filter /DCTDecode /Length ' + jpeg.length + ' >>', jpeg);
        kids.push(base + ' 0 R'); pages++;
      },
      finish() {
        if (done) throw new Error('PDF ist schon fertig');
        if (!pages) throw new Error('Ein PDF braucht mindestens eine Seite');
        done = true;
        obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
        obj(2, '<< /Type /Pages /Kids [' + kids.join(' ') + '] /Count ' + pages + ' >>');
        const d = opts.created || new Date();
        obj(3, '<< ' + (opts.title ? '/Title ' + utf16hex(String(opts.title)) + ' ' : '') + (opts.author ? '/Author ' + utf16hex(String(opts.author)) + ' ' : '')
          + '/Creator ' + utf16hex(opts.creator || 'Mein Tourentagebuch') + ' /Producer ' + utf16hex('Mein Tourentagebuch') + ' /CreationDate (' + pdfDatum(d) + ') >>');
        const n = 4 + pages * 3, xref = pos;
        let x = 'xref\n0 ' + n + '\n0000000000 65535 f \n';
        for (let id = 1; id < n; id++) x += String(offs[id]).padStart(10, '0') + ' 00000 n \n';
        push(ascii(x + 'trailer\n<< /Size ' + n + ' /Root 1 0 R /Info 3 0 R >>\nstartxref\n' + xref + '\n%%EOF\n'));
        const out = new Uint8Array(pos); let o = 0;
        for (const c of chunks) { out.set(c, o); o += c.length; }
        chunks.length = 0;
        return out;
      },
    };
  }
  /** Alles auf einmal: jpegs = Liste von Uint8Array. */
  function build(jpegs, opts) { const w = writer(opts); jpegs.forEach(j => w.addPage(j)); return w.finish(); }

  /* ------------------------------------------------------------------ Seitenaufteilung der Tourenliste ------------------------------------------------------------------ */
  const MONATE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
  /** Verteilt Touren (nach Datum geordnet) auf Seiten mit Monatsüberschriften. rowH, headH: Höhen einer Tourenzeile und einer Überschrift; platz: Höhe, die eine Seite füllen darf.
      Eine Überschrift steht nie allein am Seitenende; setzt sich ein Monat auf der nächsten Seite fort, steht dort seine Überschrift noch einmal (fort = true).
      Gibt eine Liste von Seiten zurück; eine Seite ist eine Liste von { art: 'monat', text, fort } und { art: 'tour', tour }. */
  function zeilenPlan(touren, rowH, headH, platz) {
    const seiten = []; let cur = [], y = 0, monat = null;
    const neu = () => { seiten.push(cur); cur = []; y = 0; };
    const sorted = touren.slice().sort((a, b) => (a.start || 0) - (b.start || 0));
    for (const t of sorted) {
      const d = new Date(t.start || 0), key = d.getFullYear() * 12 + d.getMonth(), text = MONATE[d.getMonth()] + ' ' + d.getFullYear();
      if (key !== monat) {
        if (cur.length && y + headH + rowH > platz) neu();
        cur.push({ art: 'monat', text, fort: false }); y += headH; monat = key;
      } else if (y + rowH > platz) { neu(); cur.push({ art: 'monat', text, fort: true }); y += headH; }
      cur.push({ art: 'tour', tour: t }); y += rowH;
    }
    if (cur.length) seiten.push(cur);
    return seiten;
  }

  /* ------------------------------------------------------------------ Fotoraster ------------------------------------------------------------------ */
  /** Rechtecke für n Fotos (höchstens 9) in einer Fläche w × h: 1 groß, 2 nebeneinander, 3–4 in zwei Spalten, 5–6 in drei Spalten (zwei Reihen), 7–9 3 × 3.
      Zellen sind quadratisch bis querformatig, das letzte Reihenende bleibt leer (nicht gestreckt). Gibt [{x, y, w, h}] zurück (Lücke gap). */
  function fotoRaster(n, w, gap, maxH) {
    n = Math.max(0, Math.min(9, n | 0)); gap = gap == null ? 20 : gap;
    if (!n) return [];
    const cols = n === 1 ? 1 : n <= 4 ? 2 : 3, rows = Math.ceil(n / cols);
    let cw = (w - gap * (cols - 1)) / cols, ch = n === 1 ? cw * 0.66 : cw;        // ein einzelnes Foto bekommt ein Querformat
    if (maxH && rows * ch + (rows - 1) * gap > maxH) { ch = (maxH - (rows - 1) * gap) / rows; }
    const out = [];
    for (let i = 0; i < n; i++) out.push({ x: (i % cols) * (cw + gap), y: Math.floor(i / cols) * (ch + gap), w: cw, h: ch });
    return out;
  }
  /** Ausschnitt eines Fotos (iw × ih), der eine Zelle (w × h) ohne Verzerrung füllt: { sx, sy, sw, sh } (Mitte). */
  function zuschnitt(iw, ih, w, h) {
    const r = w / h; let sw = iw, sh = iw / r;
    if (sh > ih) { sh = ih; sw = ih * r; }
    return { sx: (iw - sw) / 2, sy: (ih - sh) / 2, sw, sh };
  }

  /* ------------------------------------------------------------------ Skizze und Höhenprofil ------------------------------------------------------------------ */
  const RAD = Math.PI / 180;
  const hav = (a, b, c, d) => { const p = (c - a) * RAD, l = (d - b) * RAD, x = Math.sin(p / 2) ** 2 + Math.cos(a * RAD) * Math.cos(c * RAD) * Math.sin(l / 2) ** 2; return 12742017.6 * Math.asin(Math.min(1, Math.sqrt(x))); };
  /** Höchstens max Punkte, gleichmäßig verteilt; erster und letzter bleiben, Segmentanfänge (newSeg) auch. */
  function ausduennen(pts, max) {
    if (pts.length <= max) return pts.slice();
    const out = [], st = (pts.length - 1) / (max - 1);
    let last = -1;
    for (let k = 0; k < max; k++) { const i = Math.round(k * st); if (i !== last) { out.push(pts[i]); last = i; } }
    return out;
  }
  /** Strecke als Linienzug in einer Fläche w × h mit Rand pad: seitentreu (Längengrad mit cos(Breite)), zentriert. Gibt { punkte: [[x, y, neuesStück]], start, ziel } zurück;
      leer, wenn es keine zwei Punkte gibt. Alle Punkte liegen innerhalb der Fläche. */
  function skizze(pts, w, h, pad) {
    pad = pad == null ? 24 : pad;
    const v = (pts || []).filter(p => p && isFinite(p.lat) && isFinite(p.lon));
    if (v.length < 2) return { punkte: [], start: null, ziel: null };
    const sp = ausduennen(v, 800);
    let a = 90, b = 180, c = -90, d = -180;
    for (const p of sp) { a = Math.min(a, p.lat); b = Math.min(b, p.lon); c = Math.max(c, p.lat); d = Math.max(d, p.lon); }
    const k = Math.cos((a + c) / 2 * RAD), bw = Math.max((d - b) * k, 1e-6), bh = Math.max(c - a, 1e-6);
    const s = Math.min((w - 2 * pad) / bw, (h - 2 * pad) / bh), ox = (w - bw * s) / 2, oy = (h - bh * s) / 2;
    const punkte = sp.map((p, i) => [ox + (p.lon - b) * k * s, oy + (c - p.lat) * s, i > 0 && !!p.newSeg]);
    return { punkte, start: punkte[0], ziel: punkte[punkte.length - 1] };
  }
  /** Höhenprofil: Höhe über Strecke in einer Fläche w × h. Gibt { punkte: [[x, y]], min, max, dist (m) } zurück oder null, wenn weniger als zwei Höhenwerte da sind.
      Die Höhen werden leicht geglättet (3 Punkte), damit GPS-Rauschen keine Zacken malt. */
  function profil(pts, w, h) {
    const v = (pts || []).filter(p => p && isFinite(p.lat) && isFinite(p.lon));
    let dist = 0; const xs = [], es = [];
    for (let i = 0; i < v.length; i++) {
      if (i && !v[i].newSeg && !v[i].skip) dist += hav(v[i - 1].lat, v[i - 1].lon, v[i].lat, v[i].lon);
      if (v[i].ele != null && isFinite(v[i].ele) && v[i].ele > -500 && v[i].ele < 9000) { xs.push(dist); es.push(v[i].ele); }
    }
    if (es.length < 2 || !(dist > 0)) return null;
    const idx = ausduennen(es.map((_, i) => i), 300);
    const gl = idx.map(i => { let s = 0, n = 0; for (let q = Math.max(0, i - 1); q <= Math.min(es.length - 1, i + 1); q++) { s += es[q]; n++; } return s / n; });
    let mn = Math.min(...gl), mx = Math.max(...gl);
    if (mx - mn < 20) { const m = (mx + mn) / 2; mn = m - 10; mx = m + 10; }      // fast flache Strecke: nicht auf die ganze Höhe aufblasen
    const punkte = idx.map((i, k) => [xs[i] / dist * w, h - (gl[k] - mn) / (mx - mn) * h]);
    return { punkte, min: Math.min(...es), max: Math.max(...es), dist };
  }

  /* ------------------------------------------------------------------ Text ------------------------------------------------------------------ */
  /** Bricht Text in Zeilen von höchstens maxW (gemessen mit measure(text) → Breite). Zu lange Wörter werden zeichenweise getrennt. Absätze (\n) bleiben.
      maxLines: überzählige Zeilen entfallen, die letzte endet dann mit „…“. Gibt { lines, cut } zurück. */
  function umbruch(text, maxW, measure, maxLines) {
    const lines = [];
    for (const para of String(text == null ? '' : text).replace(/\r/g, '').split('\n')) {
      if (!para.trim()) { lines.push(''); continue; }
      let cur = '';
      for (const word of para.split(/\s+/).filter(Boolean)) {
        const t = cur ? cur + ' ' + word : word;
        if (measure(t) <= maxW) { cur = t; continue; }
        if (cur) { lines.push(cur); cur = ''; }
        let w = word;
        while (measure(w) > maxW && w.length > 1) { let k = w.length - 1; while (k > 1 && measure(w.slice(0, k)) > maxW) k--; lines.push(w.slice(0, k)); w = w.slice(k); }
        cur = w;
      }
      if (cur) lines.push(cur);
    }
    while (lines.length && lines[lines.length - 1] === '') lines.pop();
    let cut = false;
    if (maxLines && lines.length > maxLines) {
      cut = true; lines.length = maxLines;
      let l = lines[maxLines - 1] + '…'; while (l.length > 1 && measure(l) > maxW) l = l.slice(0, -2) + '…';
      lines[maxLines - 1] = l;
    }
    return { lines, cut };
  }
  /** Einzeiler auf maxW kürzen (mit „…“). */
  function kuerzen(text, maxW, measure) {
    let t = String(text == null ? '' : text);
    if (measure(t) <= maxW) return t;
    while (t.length > 1 && measure(t + '…') > maxW) t = t.slice(0, -1);
    return t.trimEnd() + '…';
  }
  /** Dateiname aus einem Titel: Umlaute umgeschrieben, nur A–Z, 0–9, Bindestrich und Unterstrich (die Hülle erlaubt nur A–Z, 0–9, . _ -). */
  function dateiname(titel, prefix, ext) {
    const slug = String(titel || '').replace(/[äÄ]/g, 'ae').replace(/[öÖ]/g, 'oe').replace(/[üÜ]/g, 'ue').replace(/ß/g, 'ss')
      .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60);
    return (prefix || 'Tourentagebuch') + (slug ? '_' + slug : '') + '.' + (ext || 'pdf');
  }
  /** „2 Stunden 5 Minuten“-freie Kurzform für die Fußzeile: „20.11.2026“. */
  const datum = d => p2(d.getDate()) + '.' + p2(d.getMonth() + 1) + '.' + d.getFullYear();

  const api = { A4, SEITE, MONATE, utf16hex, pdfDatum, jpegInfo, writer, build, zeilenPlan, fotoRaster, zuschnitt, ausduennen, skizze, profil, umbruch, kuerzen, dateiname, datum };
  if (node) module.exports = api; else root.Pdf = api;
})(typeof window !== 'undefined' ? window : globalThis);
