'use strict';
/* „Als PDF“ (2.5.0): eine Tour (1–2 Seiten) oder ein Jahr (Deckblatt und eine Zeile je Tour) als PDF zum Aufheben, Verschenken und Teilen.
   Ohne Bibliothek, ohne Server, ohne Netz: Jede Seite wird als Canvas gezeichnet (A4 hoch, 1240 × 1754 px ≈ 150 dpi, hell, wie die Jahresbildkarte),
   als JPEG (Qualität 0,85) kodiert und von js/calc-pdf.js in ein kleines PDF-1.4 geschrieben. Die Seiten entstehen nacheinander mit Pausen dazwischen
   (die Oberfläche bleibt bedienbar), mit Fortschritt und „Abbrechen“. Karten-Kacheln gibt es bewusst nicht: Die Skizze steht auf ruhigem Grund,
   damit das PDF ohne Netz und ohne Canvas-Taint gelingt. Fotos kommen als Vorschaubilder (480 px) aus der lokalen Foto-Ablage. */
const PdfUI = {
  W: 1240, H: 1754, M: 90, IW: 1060, TOP: 150, BOT: 1754 - 130,
  C: { paper: '#fbfcf8', ink: '#0c2526', muted: '#4d615e', line: '#d3dad0', mark: '#5c8a84', soft: '#e4e9e0', petrol: '#0c2526', onPetrol: '#fbfcf8', onPetrol2: '#b4c8c3', acc: '#0f5a55', fill: '#cdd8d2' },
  jpegQ: 0.85,

  /** Neue leere Seite mit Kopfband (Petrol, Wortmarke); right = Text rechts im Band. */
  page(right) {
    const { W, H, C } = PdfUI, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = C.paper; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = C.petrol; ctx.fillRect(0, 0, W, 96);
    ctx.save(); ctx.translate(PdfUI.M, 24); ctx.scale(2, 2); ctx.strokeStyle = C.onPetrol; ctx.lineWidth = 1.9; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.stroke(new Path2D('M3 19l6-11 4 7 2-3 6 7z')); ctx.restore();
    ctx.textBaseline = 'alphabetic'; ctx.fillStyle = C.onPetrol; ctx.font = `600 40px ${JahrKarte.D}`; ctx.fillText('Tourentagebuch', PdfUI.M + 64, 66);
    if (right) { ctx.textAlign = 'right'; ctx.fillStyle = C.onPetrol2; ctx.font = `500 30px ${JahrKarte.B}`; ctx.fillText(right, W - PdfUI.M, 64); ctx.textAlign = 'left'; }
    return { cv, ctx };
  },
  /** Fußzeile: „Mein Tourentagebuch · 20.11.2026“ links, „Seite 1 von 2“ rechts. */
  fuss(ctx, i, n, datum) {
    const { W, H, M, C } = PdfUI;
    ctx.fillStyle = C.line; ctx.fillRect(M, H - 104, PdfUI.IW, 2);
    ctx.textBaseline = 'alphabetic'; ctx.fillStyle = C.muted; ctx.font = `500 26px ${JahrKarte.B}`;
    ctx.textAlign = 'left'; ctx.fillText('Mein Tourentagebuch · ' + datum, M, H - 58);
    ctx.textAlign = 'right'; ctx.fillText('Seite ' + (i + 1) + ' von ' + n, W - M, H - 58); ctx.textAlign = 'left';
  },
  font: (w, px, fam) => `${w} ${px}px ${fam === 'D' ? JahrKarte.D : JahrKarte.B}`,
  txt(ctx, s, x, y, font, color, align) { ctx.font = font; ctx.fillStyle = color || PdfUI.C.ink; ctx.textAlign = align || 'left'; ctx.fillText(s, x, y); ctx.textAlign = 'left'; },
  measure: (ctx, font) => { ctx.font = font; return s => ctx.measureText(s).width; },
  /** Stern (Fläche = bewertet, Rahmen = nicht) mit Mittelpunkt cx, cy und Radius r. */
  stern(ctx, cx, cy, r, an) {
    ctx.beginPath();
    for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + k * Math.PI / 5, rr = k % 2 ? r * 0.45 : r; ctx[k ? 'lineTo' : 'moveTo'](cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); }
    ctx.closePath(); ctx.lineJoin = 'round';
    if (an) { ctx.fillStyle = PdfUI.C.ink; ctx.fill(); } else { ctx.lineWidth = 3; ctx.strokeStyle = PdfUI.C.mark; ctx.stroke(); }
  },
  /** Bild laden; null bei Fehler oder nach ms. Nie ein Fehler: ein fehlendes Foto lässt nur die Zelle weg. */
  bild(url, ms) {
    return new Promise(ok => {
      const im = new Image(); let fertig = false;
      const ende = v => { if (fertig) return; fertig = true; clearTimeout(tm); ok(v); };
      const tm = setTimeout(() => ende(null), ms || 8000);
      im.onload = () => ende(im.naturalWidth > 0 ? im : null); im.onerror = () => ende(null);
      im.src = url;
    });
  },
  /** Canvas → JPEG-Bytes. */
  async jpeg(cv) {
    const blob = await new Promise((ok, no) => cv.toBlob(b => b ? ok(b) : no(new Error('Seite konnte nicht erzeugt werden')), 'image/jpeg', PdfUI.jpegQ));
    return new Uint8Array(await blob.arrayBuffer());
  },
  /** Foto in eine Zelle, ohne Verzerrung zugeschnitten, mit leicht gerundeten Ecken. */
  foto(ctx, im, x, y, w, hh, r) {
    const z = Pdf.zuschnitt(im.naturalWidth, im.naturalHeight, w, hh);
    ctx.save(); JahrKarte.rr(ctx, x, y, w, hh, r == null ? 8 : r); ctx.clip(); ctx.drawImage(im, z.sx, z.sy, z.sw, z.sh, x, y, w, hh); ctx.restore();
  },
  /** Streckenskizze auf stillem Grund in der Fläche (x, y, w, h). */
  skizze(ctx, pts, x, y, w, hh) {
    const { C } = PdfUI;
    ctx.fillStyle = C.soft; JahrKarte.rr(ctx, x, y, w, hh, 8); ctx.fill();
    const sk = Pdf.skizze(pts, w, hh, 56);
    if (!sk.punkte.length) { PdfUI.txt(ctx, 'Keine Strecke vorhanden', x + w / 2, y + hh / 2, PdfUI.font(500, 30), C.muted, 'center'); return; }
    ctx.save(); ctx.translate(x, y); ctx.lineCap = ctx.lineJoin = 'round';
    const linie = (lw, st) => { ctx.beginPath(); sk.punkte.forEach((p, i) => { if (i && !p[2]) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); }); ctx.lineWidth = lw; ctx.strokeStyle = st; ctx.stroke(); };
    linie(14, C.soft === '#e4e9e0' ? '#fbfcf8' : '#fff'); linie(7, C.petrol);
    const punkt = (p, f, s) => { ctx.beginPath(); ctx.arc(p[0], p[1], 14, 0, 7); ctx.fillStyle = f; ctx.fill(); ctx.lineWidth = 6; ctx.strokeStyle = s; ctx.stroke(); };
    punkt(sk.start, C.paper, C.petrol); punkt(sk.ziel, C.petrol, C.paper);
    ctx.restore();
    PdfUI.txt(ctx, 'Start ○   Ziel ●', x + w - 24, y + hh - 22, PdfUI.font(500, 24), C.muted, 'right');
  },
  /** Höhenprofil in der Fläche (x, y, w, h) mit Höhenangaben links und Strecke darunter. Gibt false zurück, wenn es keine Höhen gibt. */
  profil(ctx, pts, x, y, w, hh) {
    const { C } = PdfUI, pr = Pdf.profil(pts, w, hh);
    if (!pr) return false;
    ctx.fillStyle = C.soft; JahrKarte.rr(ctx, x, y, w, hh, 8); ctx.fill();
    ctx.save(); ctx.translate(x, y); JahrKarte.rr(ctx, 0, 0, w, hh, 8); ctx.clip();
    ctx.beginPath(); pr.punkte.forEach((p, i) => ctx[i ? 'lineTo' : 'moveTo'](p[0], p[1])); ctx.lineTo(w, hh); ctx.lineTo(0, hh); ctx.closePath(); ctx.fillStyle = C.fill; ctx.fill();
    ctx.beginPath(); pr.punkte.forEach((p, i) => ctx[i ? 'lineTo' : 'moveTo'](p[0], p[1])); ctx.lineWidth = 5; ctx.lineJoin = 'round'; ctx.strokeStyle = C.acc; ctx.stroke();
    ctx.restore();
    PdfUI.txt(ctx, F.m(pr.max), x + 18, y + 38, PdfUI.font(600, 26), C.ink);
    PdfUI.txt(ctx, F.m(pr.min), x + 18, y + hh - 16, PdfUI.font(600, 26), C.ink);
    PdfUI.txt(ctx, '0 km', x, y + hh + 34, PdfUI.font(500, 24), C.muted);
    PdfUI.txt(ctx, F.km(pr.dist), x + w, y + hh + 34, PdfUI.font(500, 24), C.muted, 'right');
    return true;
  },

  /* ---------------------------------------------------------------- Tour ---------------------------------------------------------------- */
  /** Alles, was das PDF einer Tour braucht: Punkte und geladene Fotos (höchstens 9, gleichmäßig über die Tour verteilt; nicht lesbare entfallen). */
  async tourDaten(t, opts) {
    opts = opts || {};
    const pts = await Tours.points(t.id);
    const ps = (await DB.byIndex('photos', 'tour', t.id)).filter(p => !p.video && !/v$/.test(p.id)).sort((a, b) => a.ts - b.ts);
    const pick = ps.length <= 9 ? ps : Array.from({ length: 9 }, (_, i) => ps[Math.round(i * (ps.length - 1) / 8)]);
    const bilder = [];
    for (const p of pick) {
      if (opts.stop && opts.stop()) break;
      const im = await PdfUI.bild(Photos.thumb(p.id)); if (im) bilder.push(im);
    }
    return { pts, bilder, nFotos: ps.length };
  },
  /** Seite 1: Titel, Datum, Sterne, Kennzahlen, Skizze, Profil, Anfang der Notiz. Gibt { cv, ctx, rest: übrige Notizzeilen } zurück. */
  tourSeite1(t, d, now) {
    const { W, M, IW, C } = PdfUI, { cv, ctx } = PdfUI.page('Tour · ' + now.getFullYear());
    let y = 190;
    // Titel: höchstens zwei Zeilen
    const tf = PdfUI.font(700, 76, 'D'), ti = Pdf.umbruch(t.name || 'Tour', IW, PdfUI.measure(ctx, tf), 2).lines;
    ti.forEach((l, i) => PdfUI.txt(ctx, l, M, y + i * 84, tf, C.ink));
    y += (ti.length - 1) * 84 + 54;
    const sub = F.date(t.start) + (t.timed ? ' · ' + F.time(t.start) + '–' + F.time(t.end) : '') + ' · ' + Sports.label(t.sport);
    PdfUI.txt(ctx, Pdf.kuerzen(sub, IW, PdfUI.measure(ctx, PdfUI.font(500, 34))), M, y, PdfUI.font(500, 34), C.muted);
    const n = Abgleich.sterne(t);
    if (n) { y += 46; for (let i = 1; i <= 5; i++) PdfUI.stern(ctx, M + 18 + (i - 1) * 46, y - 8, 19, i <= n); PdfUI.txt(ctx, n + ' von 5 Sternen', M + 5 * 46 + 12, y, PdfUI.font(500, 28), C.muted); }
    // Kennzahlen: Strecke, Aufstieg, Dauer
    y += 150;
    const cw = IW / 3;
    [[F.km(t.dist), 'Strecke'], ['↑ ' + F.m(t.up), 'Aufstieg'], [t.dur ? F.dur(t.dur) : '–', 'Dauer']].forEach(([v, l], i) => {
      const x = M + i * cw, arrow = v.startsWith('↑ ');
      if (arrow) { PdfUI.txt(ctx, '↑', x, y, PdfUI.font(600, 56, 'D'), C.muted); JahrKarte.num(ctx, v.slice(2), x + 48, y, 100, cw - 70); }
      else JahrKarte.num(ctx, v, x, y, 100, cw - 24);
      PdfUI.txt(ctx, l, x, y + 44, PdfUI.font(500, 28), C.muted);
    });
    // weitere Angaben: bis zu sechs in zwei Reihen
    const fa = [['Abstieg', t.down != null ? F.m(t.down) : null], ['In Bewegung', t.moving ? F.dur(t.moving) : null], ['Ø Tempo', t.moving ? F.speed(t.dist, t.moving) : null],
      ['Höchster Punkt', t.maxAlt != null ? F.m(t.maxAlt) : null], ['Tiefster Punkt', t.minAlt != null ? F.m(t.minAlt) : null], ['Ø Puls', t.hrAvg ? t.hrAvg + ' bpm' : null], ['Höchster Puls', t.hrMax ? t.hrMax + ' bpm' : null]]
      .filter(x => x[1] && x[1] !== '–').slice(0, 6);
    ctx.fillStyle = C.line; ctx.fillRect(M, y + 84, IW, 2);
    y += 150;
    fa.forEach(([l, v], i) => {
      const x = M + (i % 3) * cw, yy = y + Math.floor(i / 3) * 96;
      PdfUI.txt(ctx, l, x, yy, PdfUI.font(500, 26), C.muted); PdfUI.txt(ctx, v, x, yy + 40, PdfUI.font(600, 38, 'D'), C.ink);
    });
    y += Math.ceil(fa.length / 3) * 96 - 20;
    // Skizze und Profil teilen sich den Rest; für eine Notiz bleibt Platz, wenn es eine gibt
    const note = String(d.note || t.note || '').trim(), hasPr = !!Pdf.profil(d.pts, 100, 100);
    const profH = hasPr ? 230 : 0, profT = hasPr ? 116 : 0, noteMin = note ? 250 : 0, frei = PdfUI.BOT - y - 20;
    const skH = Math.max(300, Math.min(560, frei - profH - profT - noteMin - 40));
    PdfUI.skizze(ctx, d.pts, M, y, IW, skH); y += skH + 34;
    if (hasPr) { PdfUI.txt(ctx, 'Höhenprofil', M, y + 30, PdfUI.font(600, 38, 'D'), C.ink); y += 52; PdfUI.profil(ctx, d.pts, M, y, IW, profH); y += profH + 80; }
    // Notiz: so viele Zeilen wie passen, der Rest geht auf Seite 2
    let rest = [];
    if (note) {
      const nf = PdfUI.font(400, 32), all = Pdf.umbruch(note, IW, PdfUI.measure(ctx, nf)).lines, fit = Math.floor((PdfUI.BOT - y - 60) / 46);
      if (fit >= 2) {
        PdfUI.txt(ctx, 'Notiz', M, y + 30, PdfUI.font(600, 38, 'D'), C.ink); y += 76;
        const take = all.slice(0, fit); take.forEach((l, i) => PdfUI.txt(ctx, l, M, y + i * 46, nf, C.ink)); rest = all.slice(fit);
      } else rest = all;
    }
    return { cv, ctx, rest, W };
  },
  /** Seite 2: Rest der Notiz und das Fotoraster. */
  tourSeite2(t, d, rest, now) {
    const { M, IW, C } = PdfUI, { cv, ctx } = PdfUI.page('Tour · ' + now.getFullYear());
    let y = 190;
    PdfUI.txt(ctx, Pdf.kuerzen(t.name || 'Tour', IW, PdfUI.measure(ctx, PdfUI.font(600, 40, 'D'))), M, y, PdfUI.font(600, 40, 'D'), C.ink); y += 40;
    PdfUI.txt(ctx, F.date(t.start), M, y, PdfUI.font(500, 28), C.muted); y += 70;
    if (rest.length) {
      const nf = PdfUI.font(400, 32), nl = rest.slice(0, 16);
      if (rest.length > 16) nl[15] = Pdf.kuerzen(nl[15] + ' …', IW, PdfUI.measure(ctx, nf));
      PdfUI.txt(ctx, 'Notiz', M, y + 30, PdfUI.font(600, 38, 'D'), C.ink); y += 76;
      nl.forEach((l, i) => PdfUI.txt(ctx, l, M, y + i * 46, nf, C.ink)); y += nl.length * 46 + 50;
    }
    if (d.bilder.length) {
      PdfUI.txt(ctx, 'Fotos', M, y + 30, PdfUI.font(600, 38, 'D'), C.ink);
      PdfUI.txt(ctx, d.nFotos === 1 ? '1 Foto' : d.nFotos > d.bilder.length ? d.bilder.length + ' von ' + d.nFotos + ' Fotos' : d.nFotos + ' Fotos', M + IW, y + 30, PdfUI.font(500, 28), C.muted, 'right'); y += 64;
      Pdf.fotoRaster(d.bilder.length, IW, 20, PdfUI.BOT - y - 10).forEach((r, i) => PdfUI.foto(ctx, d.bilder[i], M + r.x, y + r.y, r.w, r.h));
    }
    return { cv, ctx };
  },
  /** Das ganze Tour-PDF in den Schreiber w. ctl: { upd(i, n, text), stop() }. Gibt die Seitenzahl zurück (0 bei Abbruch). */
  async tourPdf(w, t, ctl) {
    const now = new Date(), datum = Pdf.datum(now);
    await JahrKarte.fonts();
    ctl.upd(0, 3, 'Fotos laden');
    const d = await PdfUI.tourDaten(t, ctl);
    if (ctl.stop()) return 0;
    ctl.upd(1, 3, 'Seite 1');
    const s1 = PdfUI.tourSeite1(t, d, now), zwei = d.bilder.length > 0 || s1.rest.length > 0, n = zwei ? 2 : 1;
    PdfUI.fuss(s1.ctx, 0, n, datum); w.addPage(await PdfUI.jpeg(s1.cv)); s1.cv.width = s1.cv.height = 0;
    await sleep(0);
    if (zwei) {
      if (ctl.stop()) return 0;
      ctl.upd(2, 3, 'Seite 2');
      const s2 = PdfUI.tourSeite2(t, d, s1.rest, now);
      PdfUI.fuss(s2.ctx, 1, n, datum); w.addPage(await PdfUI.jpeg(s2.cv)); s2.cv.width = s2.cv.height = 0;
    }
    ctl.upd(3, 3, '');
    return n;
  },

  /* ---------------------------------------------------------------- Jahr ---------------------------------------------------------------- */
  ROW: 66, ROWF: 140, HEAD: 92,
  /** Deckblatt: Jahr, Kennzahlen, Sportarten, Kilometer je Monat. d = Ergebnis von Jahr.berechne (nicht leer). */
  jahrDeckblatt(d, now) {
    const { W, H, M, IW, C } = PdfUI, { cv, ctx } = PdfUI.page('Jahresrückblick');
    PdfUI.txt(ctx, String(d.year), M - 8, 420, PdfUI.font(700, 280, 'D'), C.ink);
    PdfUI.txt(ctx, d.year === now.getFullYear() ? 'Mein Tourenjahr bis heute, ' + now.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }) : 'Mein Tourenjahr', M, 482, PdfUI.font(500, 40), C.muted);
    const k = d.kennzahlen;
    JahrKarte.num(ctx, F.km(k.dist), M, 700, 190, IW);
    PdfUI.txt(ctx, 'Kilometer', M, 748, PdfUI.font(500, 34), C.muted);
    const cols = [[String(k.n), k.n === 1 ? 'Tour' : 'Touren'], [F.m(k.up), 'Höhenmeter'], [F.dur(k.zeit), 'Stunden unterwegs'], [String(k.tage), k.tage === 1 ? 'Tag mit Tour' : 'Tage mit Tour']], cw = (IW - 3 * 24) / 4;
    cols.forEach(([v, l], i) => { const x = M + i * (cw + 24); JahrKarte.num(ctx, v, x, 878, 66, cw - 8); PdfUI.txt(ctx, Pdf.kuerzen(l, cw, PdfUI.measure(ctx, PdfUI.font(500, 26))), x, 918, PdfUI.font(500, 26), C.muted); });
    ctx.fillStyle = C.line; ctx.fillRect(M, 970, IW, 2);
    PdfUI.txt(ctx, 'Sportarten', M, 1036, PdfUI.font(600, 42, 'D'), C.ink);
    const sp = d.sportarten, gap = 4, tot = sp.reduce((a, g) => a + g.anteil, 0) || 1, avail = IW - gap * (sp.length - 1); let x = M;
    sp.forEach((g, i) => { const bw = Math.max(8, g.anteil / tot * avail); ctx.fillStyle = JahrKarte.SHADES[Math.min(i, 4)]; JahrKarte.rr(ctx, x, 1060, bw, 36, 6); ctx.fill(); x += bw + gap; });
    sp.forEach((g, i) => {
      const lx = M + (i % 2) * (IW / 2), ly = 1150 + Math.floor(i / 2) * 48;
      ctx.fillStyle = JahrKarte.SHADES[Math.min(i, 4)]; JahrKarte.rr(ctx, lx, ly - 22, 24, 24, 5); ctx.fill();
      PdfUI.txt(ctx, g.label, lx + 38, ly, PdfUI.font(600, 32), C.ink); ctx.font = PdfUI.font(600, 32);
      PdfUI.txt(ctx, JahrUI.pct(g.anteil) + ' · ' + JahrUI.touren(g.n), lx + 38 + ctx.measureText(g.label).width + 14, ly, PdfUI.font(500, 30), C.muted);
    });
    const ly2 = 1150 + Math.ceil(sp.length / 2) * 48;
    ctx.fillStyle = C.line; ctx.fillRect(M, ly2 + 8, IW, 2);
    const my = ly2 + 76;
    PdfUI.txt(ctx, 'Kilometer je Monat', M, my, PdfUI.font(600, 42, 'D'), C.ink);
    const base = H - 190, top = my + 40, ch = Math.max(80, base - top), mv = d.monate.map(m => m.dist), mx = Math.max(...mv, 1), best = mv.indexOf(Math.max(...mv)), bw = IW / 12;
    d.monate.forEach((m, i) => {
      const bh = mv[i] > 0 ? Math.max(6, mv[i] / mx * ch) : 3, on = i === best && mv[i] > 0;
      ctx.fillStyle = on ? C.ink : C.mark; JahrKarte.rr(ctx, M + i * bw + 7, base - bh, bw - 14, bh, 4); ctx.fill();
      PdfUI.txt(ctx, m.name[0], M + i * bw + bw / 2, base + 40, PdfUI.font(on ? 600 : 500, 28), on ? C.ink : C.muted, 'center');
    });
    ctx.fillStyle = C.line; ctx.fillRect(M, base + 2, IW, 2);
    void W;
    return { cv, ctx };
  },
  /** Eine Seite der Tourenliste. zeilen: Einträge aus Pdf.zeilenPlan; fotos: Map Tour-ID → Bild (oder leer); mitFotos: größere Zeilen mit Vorschaubild. */
  jahrListe(zeilen, d, fotos, mitFotos) {
    const { M, IW, C } = PdfUI, { cv, ctx } = PdfUI.page('Jahr ' + d.year + ' · Touren');
    const rowH = mitFotos ? PdfUI.ROWF : PdfUI.ROW; let y = PdfUI.TOP;
    const mf = PdfUI.measure(ctx, PdfUI.font(600, 31));
    zeilen.forEach(z => {
      if (z.art === 'monat') {
        PdfUI.txt(ctx, z.text + (z.fort ? ' (Fortsetzung)' : ''), M, y + 52, PdfUI.font(600, 44, 'D'), C.ink);
        ctx.fillStyle = C.ink; ctx.fillRect(M, y + 70, IW, 3); y += PdfUI.HEAD; return;
      }
      const t = z.tour, up = t.up ? '↑ ' + F.m(t.up) : '', dt = new Date(t.start), dd = String(dt.getDate()).padStart(2, '0') + '.' + String(dt.getMonth() + 1).padStart(2, '0') + '.';
      const xt = mitFotos ? M + 134 : M + 128, maxN = M + IW - 330 - xt;
      if (mitFotos) {
        const im = fotos && fotos.get(t.id);
        if (im) PdfUI.foto(ctx, im, M, y + 16, 108, 108, 8); else { ctx.fillStyle = C.soft; JahrKarte.rr(ctx, M, y + 16, 108, 108, 8); ctx.fill(); }
        PdfUI.txt(ctx, Pdf.kuerzen(t.name, maxN, mf), xt, y + 62, PdfUI.font(600, 31), C.ink);
        PdfUI.txt(ctx, [dd + dt.getFullYear(), Sports.label(t.sport), t.dur ? F.dur(t.dur) : null].filter(Boolean).join(' · '), xt, y + 104, PdfUI.font(500, 26), C.muted);
        PdfUI.txt(ctx, F.km(t.dist), M + IW, y + 62, PdfUI.font(600, 31), C.ink, 'right'); if (up) PdfUI.txt(ctx, up, M + IW, y + 104, PdfUI.font(500, 28), C.muted, 'right');
      } else {
        PdfUI.txt(ctx, dd, M, y + 44, PdfUI.font(500, 30), C.muted);
        PdfUI.txt(ctx, Pdf.kuerzen(t.name, maxN, mf), xt, y + 44, PdfUI.font(600, 31), C.ink);
        PdfUI.txt(ctx, F.km(t.dist), M + IW - 190, y + 44, PdfUI.font(600, 31), C.ink, 'right'); if (up) PdfUI.txt(ctx, up, M + IW, y + 44, PdfUI.font(500, 30), C.muted, 'right');
      }
      ctx.fillStyle = C.line; ctx.fillRect(M, y + rowH - 3, IW, 1.5); y += rowH;
    });
    return { cv, ctx };
  },
  /** Das ganze Jahres-PDF: Deckblatt, dann die Tourenliste Seite für Seite. opts.mitFotos: Vorschaubild je Tour. ctl: { upd(i, n, text), stop() }. Gibt die Seitenzahl zurück (0 bei Abbruch). */
  async jahrPdf(w, d, tours, opts, ctl) {
    const now = new Date(), datum = Pdf.datum(now), mitFotos = !!opts.mitFotos;
    await JahrKarte.fonts();
    const plan = Pdf.zeilenPlan(tours, mitFotos ? PdfUI.ROWF : PdfUI.ROW, PdfUI.HEAD, PdfUI.BOT - PdfUI.TOP), n = 1 + plan.length;
    ctl.upd(0, n, 'Deckblatt');
    const c = PdfUI.jahrDeckblatt(d, now);
    PdfUI.fuss(c.ctx, 0, n, datum); w.addPage(await PdfUI.jpeg(c.cv)); c.cv.width = c.cv.height = 0;
    await sleep(0);
    for (let i = 0; i < plan.length; i++) {
      if (ctl.stop()) return 0;
      ctl.upd(i + 1, n, 'Seite ' + (i + 2) + ' von ' + n);
      let fotos = null;
      if (mitFotos) {      // Vorschaubilder dieser Seite laden (eines je Tour; ohne Foto bleibt die Fläche still)
        fotos = new Map();
        for (const z of plan[i]) {
          if (z.art !== 'tour') continue;
          if (ctl.stop()) return 0;
          const p = await pickPhoto(z.tour.id).catch(() => null);
          if (p) { const im = await PdfUI.bild(Photos.thumb(p.id), 6000); if (im) fotos.set(z.tour.id, im); }
        }
      }
      const s = PdfUI.jahrListe(plan[i], d, fotos, mitFotos);
      PdfUI.fuss(s.ctx, i + 1, n, datum); w.addPage(await PdfUI.jpeg(s.cv)); s.cv.width = s.cv.height = 0;
      await sleep(0);
    }
    ctl.upd(n, n, '');
    return n;
  },

  /* ---------------------------------------------------------------- Ablauf und Ausgabe ---------------------------------------------------------------- */
  busy: false,
  /** Fortschrittsblatt mit „Abbrechen“, dann Ausgabe. make(writer, ctl) schreibt die Seiten und gibt die Seitenzahl zurück (0 = abgebrochen). Gibt { name, bytes, pages } oder null zurück. */
  async run(title, name, docTitle, make) {
    if (PdfUI.busy) { toast('Es wird schon ein PDF erstellt.'); return null; }
    PdfUI.busy = true;
    let halt = false, res = null;
    try {
      res = await PhotoSources.progress(title, async upd => {
        const w = Pdf.writer({ title: docTitle, creator: 'Mein Tourentagebuch ' + (window.MTApp ? MTApp.version() : ''), created: new Date() });
        const ctl = { stop: () => halt, upd: (i, n, text) => upd(Math.min(i, n), n, null, text || 'Wird erstellt …') };
        const pages = await make(w, ctl);
        if (halt || !pages) return null;
        return { pages, bytes: w.finish() };
      }, { cancel: () => { halt = true; }, note: 'Das Tagebuch zeichnet die Seiten nacheinander und setzt sie zu einem PDF zusammen. Bitte die App so lange geöffnet lassen.' });
    } catch (e) { console.error('PDF', e); toast('Das PDF konnte nicht erstellt werden: ' + (e && e.message || e), 7000); return null; }
    finally { PdfUI.busy = false; }
    if (!res) { toast('Abgebrochen – es wurde nichts gespeichert.', 4000); return null; }
    try { await PdfUI.ausgeben(res.bytes, name, title, res.pages); } catch (e) { console.error('PDF speichern', e); toast('Das PDF konnte nicht gespeichert werden: ' + (e && e.message || e), 7000); return null; }
    return { name, bytes: res.bytes, pages: res.pages };
  },
  /** Datei in den Zwischenspeicher der Hülle legen (stückweise, Base64). */
  async zwischenspeichern(bytes, name) {
    const CH = 512 * 1024;
    for (let o = 0; o < bytes.length; o += CH) {
      let bin = ''; const part = bytes.subarray(o, o + CH);
      for (let q = 0; q < part.length; q += 8192) bin += String.fromCharCode.apply(null, part.subarray(q, q + 8192));
      await Native.json('appendCache', { name, b64: btoa(bin), reset: o === 0 });
    }
  },
  /** In der App: in den Ordner „Download/Tourentagebuch“ speichern (richtiger Dateityp application/pdf) und zum Teilen anbieten; im Browser: Download. */
  async ausgeben(bytes, name, title, pages) {
    const info = pages + (pages === 1 ? ' Seite · ' : ' Seiten · ') + F.size(bytes.length);
    if (!Native.available()) {
      const a = h('a', { href: URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' })), download: name }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 60000);
      toast('PDF gespeichert: ' + name + ' (' + info + ')', 6000); return;
    }
    await PdfUI.zwischenspeichern(bytes, name);
    const ort = await Native.json('saveFile', { name, mime: 'application/pdf', path: name });
    const s = sheet('PDF gespeichert', h('div', { id: 'pdf-fertig' },
      h('p', { id: 'pdf-ort' }, 'Gespeichert: ' + ort), h('p', { class: 'muted small' }, info + '. Du findest die Datei in der Dateien-App unter „Download“ und kannst sie von dort verschicken oder drucken.'),
      h('div', { class: 'row end wrap' },
        h('button', { class: 'btn', id: 'pdf-teilen', onclick: async e => {
          const b = e.currentTarget; b.disabled = true;
          try { await PdfUI.zwischenspeichern(bytes, name); await Native.call('shareCache', { name, mime: 'application/pdf', title: title + ' teilen' }); s.close(); }
          catch (err) { toast('Teilen nicht möglich: ' + (err && err.message || err), 6000); b.disabled = false; }
        } }, 'Teilen …'),
        h('button', { class: 'btn pri', id: 'pdf-ok', onclick: () => s.close() }, 'Fertig'))));
  },

  /** Tourseite → „Als PDF“. */
  async tour(t) {
    if (!t || (!t.dist && !t.start)) { toast('Diese Tour hat keine Daten für ein PDF.'); return null; }
    return PdfUI.run('Tour als PDF', Pdf.dateiname(t.name, 'Tour', 'pdf'), t.name, (w, ctl) => PdfUI.tourPdf(w, t, ctl));
  },
  /** Jahresrückblick → „Als PDF“. d = Ergebnis von Jahr.berechne; all = alle Touren. */
  async jahr(d, all, opts) {
    if (!d || d.leer) { toast('In diesem Jahr gibt es noch keine Touren.'); return null; }
    const ids = new Set(d.ids), tours = all.filter(t => ids.has(t.id));
    return PdfUI.run('Jahr als PDF', Pdf.dateiname('Jahr ' + d.year, 'Tourentagebuch', 'pdf'), 'Mein Tourenjahr ' + d.year, (w, ctl) => PdfUI.jahrPdf(w, d, tours, opts || {}, ctl));
  },
};
