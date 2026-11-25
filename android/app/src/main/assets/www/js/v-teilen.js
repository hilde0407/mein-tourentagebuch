'use strict';
/* „Als Bild teilen“ an der Tour (2.13.0): eine Bildkarte 1080 × 1350 (oder Quadrat 1080 × 1080) mit Titel, Datum, Sportart, Strecke, Aufstieg, Zeit, Karte mit Spur,
   kleinem Höhenprofil und bis zu drei Fotos. Gleicher Weg wie die Jahresbildkarte (js/v-jahr.js): Canvas → JPEG → Zwischenspeicher der Hülle → Teilen-Menü;
   ab Android 10 auch „In Galerie speichern“ (Bilder/Tourentagebuch, MediaStore ohne Berechtigung). Eine feste, helle Gestaltung (Papier, Tinte, Petrol), unabhängig
   vom Hell-/Dunkelmodus der App, damit das Bild überall gleich gut lesbar ist. Die Karte kommt wie im Tour-PDF zuerst aus den Offline-Kacheln (Wanderkarte),
   sonst von OpenStreetMap mit Quellenangabe (Schalter „Karte im PDF“ gilt auch hier); ohne Netz oder Kachel steht die Spur auf ruhigem Grund – ohne Fehler.
   Maße, Titel und Fotoauswahl: js/calc-teilen.js. */
const TourBild = {
  C: { paper: '#f2f4ee', ink: '#0c2526', muted: '#4d615e', line: '#d3dad0', petrol: '#0c2526', onPetrol: '#fbfcf8', onPetrol2: '#b4c8c3' },

  /** Was das Bild braucht: Punkte und die Fotoauswahl (Titelfoto der App zuerst). */
  async daten(t) {
    const pts = await Tours.points(t.id).catch(() => []);
    const ps = await DB.byIndex('photos', 'tour', t.id).catch(() => []);
    const titel = ps.some(TeilenCalc.istFoto) ? await pickPhoto(t.id).catch(() => null) : null;
    return { pts, fotos: TeilenCalc.fotoAuswahl(ps, TeilenCalc.MAX_FOTOS, titel && titel.id), bilder: new Map(), karten: new Map() };
  },
  /** Foto laden (kleine Zelle: Vorschaubild, große: Originalbild, Rückfall Vorschaubild); null, wenn nicht lesbar. */
  async foto(d, p, w) {
    const k = p.id + (w > 460 ? ':g' : ':k');
    if (d.bilder.has(k)) return d.bilder.get(k);
    let im = w > 460 ? await PdfUI.bild(Photos.url(p.id), 8000) : null;
    if (!im) im = await PdfUI.bild(Photos.thumb(p.id), 6000);
    d.bilder.set(k, im); return im;
  },
  /** Kartenausschnitt w × h (oder null): wie im Tour-PDF, Ergebnis gemerkt (je Größe einmal laden). */
  async karte(d, w, hh) {
    const k = w + 'x' + hh;
    if (!d.karten.has(k)) {
      const p = Set_.get('pdfKarte') === false || d.pts.length < 2 ? Promise.resolve(null)
        : PdfUI.kartenBild(d.pts, w, hh, { stop: () => false }).catch(e => { console.warn('Bild: Karte', e); return null; });
      d.karten.set(k, p);
    }
    return d.karten.get(k);
  },
  /** Bildkarte zeichnen. o: { format: 'hoch'|'quadrat', mitFotos, mitKarte (false = nur Spur auf ruhigem Grund, ohne zu laden) }. Gibt das Canvas zurück. */
  async render(t, d, o) {
    o = o || {};
    await JahrKarte.fonts();
    const C = TourBild.C, fmt = TeilenCalc.FORMATE[o.format] ? o.format : 'hoch', D = JahrKarte.D, B = JahrKarte.B;
    const probe = document.createElement('canvas').getContext('2d'), mAt = size => s => { probe.font = `700 ${size}px ${D}`; return probe.measureText(s).width; };
    const fotos = o.mitFotos ? d.fotos : [], prof = !!Pdf.profil(d.pts, 100, 50);
    const tt = TeilenCalc.titel(t.name, 1080 - 2 * 64, mAt, fmt);
    const L = TeilenCalc.layout(fmt, { zeilen: tt.lines.length, titelSize: tt.size, fotos: fotos.length, profil: prof });
    const cv = document.createElement('canvas'); cv.width = L.W; cv.height = L.H;
    const ctx = cv.getContext('2d'), M = L.M;
    ctx.fillStyle = C.paper; ctx.fillRect(0, 0, L.W, L.H);
    // Kopf: Petrol mit Wortmarke, rechts die Sportart
    ctx.fillStyle = C.petrol; ctx.fillRect(0, 0, L.W, L.kopf);
    const ky = L.kopf / 2;
    ctx.save(); ctx.translate(M, ky - 29); ctx.scale(2.4, 2.4); ctx.strokeStyle = C.onPetrol; ctx.lineWidth = 1.9; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.stroke(new Path2D('M3 19l6-11 4 7 2-3 6 7z')); ctx.restore();
    ctx.textBaseline = 'alphabetic'; ctx.fillStyle = C.onPetrol; ctx.font = `600 42px ${D}`; ctx.fillText('Tourentagebuch', M + 76, ky + 15);
    ctx.textAlign = 'right'; ctx.fillStyle = C.onPetrol2; ctx.font = `500 32px ${B}`; ctx.fillText(Pdf.kuerzen(Sports.label(t.sport), 330, s => ctx.measureText(s).width), L.W - M, ky + 12); ctx.textAlign = 'left';
    // Titel und Datum · Sportart
    ctx.fillStyle = C.ink; ctx.font = `700 ${tt.size}px ${D}`;
    tt.lines.forEach((l, i) => ctx.fillText(l, M - 2, L.titel.y[i]));
    ctx.fillStyle = C.muted; ctx.font = `500 ${fmt === 'quadrat' ? 30 : 34}px ${B}`;
    const datum = t.start ? F.date(t.start) : '';
    ctx.fillText(Pdf.kuerzen([datum, Sports.label(t.sport)].filter(Boolean).join(' · '), L.IW, s => ctx.measureText(s).width), M, L.unter);
    // Kennzahlen
    const k = TeilenCalc.kennzahlen(t), zs = fmt === 'quadrat' ? 64 : 76;
    [[k.dist != null ? F.km(k.dist) : '–', 'Strecke'], [k.up != null ? F.m(k.up) : '–', 'Aufstieg'], [k.zeit != null ? F.dur(k.zeit) : '–', 'Dauer']].forEach(([v, lab], i) => {
      const c = L.zahlen.cols[i]; JahrKarte.num(ctx, v, c.x, L.zahlen.y, zs, c.w);
      ctx.fillStyle = C.muted; ctx.font = `500 ${fmt === 'quadrat' ? 26 : 28}px ${B}`; ctx.fillText(lab, c.x, L.zahlen.ly);
    });
    // Karte (Kacheln) oder Spur auf ruhigem Grund
    const R = L.karte, km = o.mitKarte === false ? null : await TourBild.karte(d, R.w, R.h);
    if (km && km.cv) {
      ctx.save(); JahrKarte.rr(ctx, R.x, R.y, R.w, R.h, 10); ctx.clip(); ctx.drawImage(km.cv, R.x, R.y); ctx.restore();
      ctx.fillStyle = C.ink; ctx.font = `500 ${km.quelle.size}px ${B}`; ctx.textBaseline = 'alphabetic'; ctx.fillText(km.quelle.s, R.x + km.quelle.x, R.y + km.quelle.y);
    } else PdfUI.skizze(ctx, d.pts, R.x, R.y, R.w, R.h);
    // Höhenprofil (klein; Beschriftung unter der Fläche bleibt im Rechteck)
    if (L.profil) TourBild.profil(ctx, d.pts, L.profil, fmt === 'quadrat' ? 22 : 24);
    // Fotos
    for (let i = 0; i < L.fotos.length; i++) {
      const z = L.fotos[i], im = await TourBild.foto(d, fotos[i], z.w);
      if (im) PdfUI.foto(ctx, im, z.x, z.y, z.w, z.h, 10);
      else { ctx.fillStyle = '#e4e9e0'; JahrKarte.rr(ctx, z.x, z.y, z.w, z.h, 10); ctx.fill(); }
    }
    return cv;
  },
  /** Kleines Höhenprofil in R: Fläche mit Linie, darunter „0 km“, „höchster Punkt …“ und die Strecke (nichts liegt über der Linie). */
  profil(ctx, pts, R, fs) {
    const C = TourBild.C, ph = R.h - fs - 14, pr = Pdf.profil(pts, R.w, ph);
    if (!pr) return;
    ctx.save(); ctx.translate(R.x, R.y); JahrKarte.rr(ctx, 0, 0, R.w, ph, 8); ctx.clip();
    ctx.fillStyle = '#e4e9e0'; ctx.fillRect(0, 0, R.w, ph);
    ctx.beginPath(); pr.punkte.forEach((q, i) => ctx[i ? 'lineTo' : 'moveTo'](q[0], q[1] * 0.86 + ph * 0.1)); ctx.lineTo(R.w, ph); ctx.lineTo(0, ph); ctx.closePath(); ctx.fillStyle = '#cdd8d2'; ctx.fill();
    ctx.beginPath(); pr.punkte.forEach((q, i) => ctx[i ? 'lineTo' : 'moveTo'](q[0], q[1] * 0.86 + ph * 0.1)); ctx.lineWidth = 4; ctx.lineJoin = 'round'; ctx.strokeStyle = '#0f5a55'; ctx.stroke();
    ctx.restore();
    const y = R.y + R.h - 4; ctx.fillStyle = C.muted; ctx.font = `500 ${fs}px ${JahrKarte.B}`; ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left'; ctx.fillText('0 km', R.x, y);
    ctx.textAlign = 'center'; ctx.fillText('höchster Punkt ' + F.m(pr.max), R.x + R.w / 2, y);
    ctx.textAlign = 'right'; ctx.fillText(F.km(pr.dist), R.x + R.w, y); ctx.textAlign = 'left';
  },
  /** JPEG des Canvas. */
  blob: cv => new Promise((ok, no) => cv.toBlob(b => b ? ok(b) : no(new Error('Bild nicht möglich')), 'image/jpeg', 0.92)),
  /** Datei in den Zwischenspeicher der Hülle legen (stückweise, Base64). */
  async zwischen(blob, name) { await PdfUI.zwischenspeichern(new Uint8Array(await blob.arrayBuffer()), name); },
  /** Teilen: in der App über das Teilen-Menü, im Browser als Download. */
  async teilen(cv, name, titel) {
    const blob = await TourBild.blob(cv);
    if (!Native.available()) {
      const a = h('a', { href: URL.createObjectURL(blob), download: name }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 60000);
      toast('Bild gespeichert: ' + name, 5000); return;
    }
    await TourBild.zwischen(blob, name);
    await Native.call('shareCache', { name, mime: 'image/jpeg', title: titel + ' teilen' });
  },
  /** In die Galerie (Bilder/Tourentagebuch); nur in der App ab Android 10. Gibt den Ort zurück. */
  async galerie(cv, name) {
    const blob = await TourBild.blob(cv);
    await TourBild.zwischen(blob, name);
    return await Native.json('saveImage', { name, mime: 'image/jpeg' });
  },
  /** Kann die Hülle in die Galerie speichern? (Android 10+) */
  async galerieMoeglich() {
    if (!Native.available()) return false;
    try { const r = await Native.json('imageGallery'); return !!(r && r.supported); } catch (e) { return false; }
  },

  /** Tourmenü → „Als Bild teilen“: Blatt mit Vorschau, Format, Schalter „Fotos einbeziehen“, Teilen und Speichern. */
  async dialog(t) {
    let d;
    try { d = await TourBild.daten(t); } catch (e) { toast('Das Bild konnte nicht vorbereitet werden: ' + (e && e.message || e), 6000); return; }
    const st = { format: 'hoch', mitFotos: d.fotos.length > 0 }, img = h('img', { id: 'tb-bild', alt: '' });
    const vorschau = h('div', { class: 'tb-vor', id: 'tb-vor', 'aria-busy': 'true' }, img), info = h('p', { class: 'muted small', id: 'tb-info', 'aria-live': 'polite' }, 'Bild wird erstellt …');
    const ctl = h('div', { class: 'tb-ctl' }), btns = h('div', { class: 'row end wrap tb-btns' });
    let cv = null, nr = 0;
    const zeichne = async () => {
      const my = ++nr; vorschau.setAttribute('aria-busy', 'true'); info.textContent = 'Bild wird erstellt …'; btns.querySelectorAll('button').forEach(b => { b.disabled = true; });
      try {
        // erst sofort ohne Karte (Spur auf ruhigem Grund), dann mit Karte, sobald die Kacheln da sind (ohne Netz bleibt es bei der Spur)
        let c = await TourBild.render(t, d, Object.assign({}, st, { mitKarte: false }));
        if (my !== nr) return;
        img.src = c.toDataURL('image/jpeg', 0.8); cv = c; btns.querySelectorAll('button').forEach(b => { b.disabled = false; });
        if (Set_.get('pdfKarte') !== false && d.pts.length > 1) {
          info.textContent = 'Karte wird geladen …';
          c = await TourBild.render(t, d, st);
          if (my !== nr) return;
          img.src = c.toDataURL('image/jpeg', 0.8); cv = c;
        }
        const fmt = TeilenCalc.FORMATE[st.format];
        img.alt = 'Vorschau: ' + t.name + ', ' + fmt.label + ' ' + fmt.w + ' × ' + fmt.h + (st.mitFotos && d.fotos.length ? ', mit ' + d.fotos.length + (d.fotos.length === 1 ? ' Foto' : ' Fotos') : '');
        info.textContent = fmt.label + ' · ' + fmt.w + ' × ' + fmt.h + ' Pixel' + (st.mitFotos && d.fotos.length ? ' · ' + d.fotos.length + (d.fotos.length === 1 ? ' Foto' : ' Fotos') : '');
      } catch (e) { console.error('Bild', e); if (my === nr) info.textContent = 'Das Bild konnte nicht erstellt werden: ' + (e && e.message || e); }
      finally { if (my === nr) { vorschau.setAttribute('aria-busy', 'false'); btns.querySelectorAll('button').forEach(b => { b.disabled = !cv; }); } }
    };
    const drawCtl = () => {
      ctl.innerHTML = '';
      ctl.append(UI.seg(Object.entries(TeilenCalc.FORMATE).map(([k, f]) => [k, f.label]), st.format, k => { st.format = k; drawCtl(); zeichne(); }, { label: 'Format des Bildes' }));
      if (d.fotos.length) ctl.append(UI.toggle('Fotos einbeziehen', st.mitFotos, v => { st.mitFotos = !!v; zeichne(); }, { id: 'tb-fotos' }));
      else ctl.append(h('p', { class: 'muted small', id: 'tb-keine' }, 'Zu dieser Tour gibt es keine Fotos – das Bild zeigt Karte, Zahlen und Höhenprofil.'));
    };
    const name = () => TeilenCalc.dateiname(t.name, st.format);
    const teilen = h('button', { class: 'btn pri', id: 'tb-teilen', disabled: true, onclick: async e => {
      const b = e.currentTarget; b.disabled = true;
      try { await TourBild.teilen(cv, name(), t.name); } catch (err) { toast('Teilen nicht möglich: ' + (err && err.message || err), 6000); } finally { b.disabled = false; }
    }, html: Ico.svg('share') + '<span>Teilen …</span>' });
    btns.append(teilen);
    drawCtl();
    sheet('Als Bild teilen', h('div', { id: 'tb' }, vorschau, info, ctl, btns, h('p', { class: 'muted small', id: 'tb-hinweis' }, 'Das Bild zeigt Name, Datum, Karte und die gewählten Fotos dieser Tour. Es wird erst beim Teilen weitergegeben.')));
    if (await TourBild.galerieMoeglich()) {
      btns.prepend(h('button', { class: 'btn', id: 'tb-galerie', disabled: !cv, onclick: async e => {
        const b = e.currentTarget; b.disabled = true;
        try { const ort = await TourBild.galerie(cv, name()); toast('In der Galerie gespeichert: ' + ort, 5000); } catch (err) { toast('Speichern nicht möglich: ' + (err && err.message || err), 6000); } finally { b.disabled = false; }
      } }, 'In Galerie speichern'));
    }
    zeichne();
  },
};
