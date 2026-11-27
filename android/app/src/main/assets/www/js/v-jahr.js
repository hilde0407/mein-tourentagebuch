'use strict';
/* Jahresrückblick (2.3.0): `#/jahr` und `#/jahr/<Jahr>`. Rechnung: js/calc-jahr.js (global `Jahr`), hier nur die Seite und die Bildkarte zum Teilen.
   Alles aus den Touren im Gerät; was es nicht gibt (Vorjahr, Regionen, Fotos, Bewertung), steht nicht da. */
const JahrUI = {
  /** Zahlen mit Vorzeichen für den Vergleich: „+6“, „−120 km“, „gleich“. fmt formt den Betrag. */
  delta(d, fmt) { const a = Math.abs(d); if (!(a > 0)) return 'gleich'; return (d > 0 ? '+' : '−') + (fmt ? fmt(a) : a); },
  /** „12 Touren“ / „1 Tour“ */
  touren: n => n + (n === 1 ? ' Tour' : ' Touren'),
  /** Anteil in Prozent; unter einem halben Prozent „unter 1 %“, damit nie „0 %“ bei vorhandenen Touren steht. */
  pct: a => (a > 0 && a < 0.005 ? 'unter 1 %' : Math.round(a * 100) + ' %'),
  /** Balkendiagramm der Monate als Inline-SVG: Balken in Teilfarbe, der stärkste in Tinte (Farben aus den Variablen, so passt es in Hell und Dunkel). */
  chart(monate, key, label) {
    const vals = monate.map(m => m[key]), mx = Math.max(...vals, 1), top = vals.indexOf(Math.max(...vals));
    const fmt = v => key === 'dist' ? F.km(v) : key === 'up' ? F.m(v) : JahrUI.touren(v);
    const text = label + ' je Monat: ' + monate.map((m, i) => m.name + ' ' + fmt(vals[i])).join(', ') + '.';
    const bars = vals.map((v, i) => { const hh = v > 0 ? Math.max(3, v / mx * 92) : 1.5; return `<rect x="${i * 10 + 1.5}" y="${(100 - hh).toFixed(2)}" width="7" height="${hh.toFixed(2)}" fill="${i === top && v > 0 ? 'var(--ink)' : 'var(--mark)'}"/>`; }).join('');
    const svg = `<svg class="jchart" viewBox="0 0 120 100" preserveAspectRatio="none" role="img" aria-label="${esc(text)}"><line x1="0" x2="120" y1="100" y2="100" stroke="var(--edge)" stroke-width="1" vector-effect="non-scaling-stroke"/>${bars}</svg>`;
    return h('div', { class: 'jcw' }, h('div', { html: svg }), h('div', { class: 'jlet', 'aria-hidden': 'true' }, monate.map((m, i) => h('small', { class: i === top && vals[i] > 0 ? 'top' : '' }, m.name[0]))));
  },
};

Views['/jahr'] = async (root, [param]) => {
  const now = new Date(), all = (await Tours.list()).filter(Jahr.zaehlt), year = Jahr.waehle(param, all, now);
  const cells = await DB.kvGet('regionCells', {}).catch(() => ({}));      // schon bestimmte Regionen (kein Netzabruf hier)
  const d = Jahr.berechne(all, year, now, { regionen: t => { try { return Reisen.regionOf(t, cells || {}); } catch (e) { return ''; } } });
  const body = h('div', { class: 'pad jahr', id: 'jahr' });
  root.append(topbar('Jahresrückblick', { back: true }), body);

  // Jahr wählen: die Jahre mit Touren, dazu das gewählte
  const years = [...new Set(Jahr.jahre(all).concat([year]))].sort((a, b) => b - a);
  const pick = y => { history.replaceState(null, '', '#/jahr/' + y); Nav.render(); };
  body.append(h('div', { id: 'jahr-jahre', role: 'group', 'aria-label': 'Jahr wählen' }, UI.chips(years.map(y => UI.chip(String(y), y === year, () => pick(y), { id: 'jahr-' + y })))));
  body.append(h('h2', { class: 'jahr-t', id: 'jahr-titel' }, String(year)),
    h('p', { class: 'muted jahr-s' }, year === now.getFullYear() ? 'Dein Tourenjahr bis heute, ' + UI.day(now.getTime()) : 'Dein Tourenjahr'));

  // Leerzustand
  if (d.leer) {
    const frueher = Jahr.jahre(all).filter(y => y < year)[0] || Jahr.jahre(all)[0];
    body.append(UI.empty({ icon: 'chart', cls: 'jahr-leer', title: all.length ? 'Im Jahr ' + year + ' steht noch keine Tour im Tagebuch' : 'Noch keine Touren im Tagebuch',
      text: all.length ? 'Sobald du eine Tour aufzeichnest oder importierst, erscheint hier dein Jahresrückblick. Du kannst oben auch ein anderes Jahr wählen.' : 'Zeichne die erste Tour auf oder hol die bisherigen herein – dann gibt es hier einen Jahresrückblick.',
      actions: all.length && frueher ? [h('a', { class: 'btn', id: 'jahr-frueher', href: '#/jahr/' + frueher }, 'Jahr ' + frueher + ' ansehen')] : [h('a', { class: 'btn', href: '#/import', html: Ico.svg('download') + '<span>Touren importieren</span>' }), h('a', { class: 'btn', href: '#/rec', html: Ico.svg('rec') + '<span>Tour aufzeichnen</span>' })] }));
    return;
  }

  // Überblick: die große Zahl ist die Strecke
  const k = d.kennzahlen;
  body.append(UI.figs([[F.km(k.dist), 'Strecke']], { big: true, cls: 'jahr-hero', id: 'jahr-km' }),
    UI.figs([[String(k.n), k.n === 1 ? 'Tour' : 'Touren'], [F.m(k.up), 'Aufstieg'], [F.dur(k.zeit), 'Dauer'], [String(k.tage), k.tage === 1 ? 'Aktiver Tag' : 'Aktive Tage']], { big: true, cols: 2, id: 'jahr-zahlen' }));
  if (d.vorjahr) {
    const v = d.vorjahr, df = v.diff;
    body.append(UI.section('Gegenüber ' + v.year, UI.facts([
      ['Touren', JahrUI.delta(df.n)], ['Strecke', JahrUI.delta(df.dist, F.km)], ['Aufstieg', JahrUI.delta(df.up, F.m)], ['Dauer', JahrUI.delta(df.zeit, F.dur)], ['Aktive Tage', JahrUI.delta(df.tage)]]),
      { id: 'jahr-vorjahr', cls: 'jahr-vj', sub: v.bisHeute ? v.year + ' bis zum gleichen Tag, ' + JahrUI.touren(v.kennzahlen.n) + ' und ' + F.km(v.kennzahlen.dist) + '.' : v.year + ': ' + JahrUI.touren(v.kennzahlen.n) + ' und ' + F.km(v.kennzahlen.dist) + '.' }));
  }

  // Nach Sportart
  const spr = d.sportarten.map(g => h('div', { class: 'jsp', 'data-sport': g.key, title: StatGruppen.titel(g.key, StatGruppen.aktuell()) || null },
    h('div', { class: 'jsp-h' }, h('b', null, g.label), h('span', null, JahrUI.pct(g.anteil))),
    h('div', { class: 'jsp-b', 'aria-hidden': 'true' }, h('i', { style: { width: Math.max(1.5, g.anteil * 100) + '%' } })),
    h('small', null, [JahrUI.touren(g.n), g.dist ? F.km(g.dist) : null, g.up ? '↑ ' + F.m(g.up) : null].filter(Boolean).join(' · '))));
  body.append(UI.section('Nach Sportart', h('div', { class: 'jsports' }, spr), { id: 'jahr-sport', sub: 'Anteil an der Strecke. ' + (StatGruppen.aktuell().length ? 'Nach deinen Statistik-Gruppen (Mehr → Einstellungen → Sportarten → Statistik-Gruppen).' : 'Jede Sportart für sich – zusammenfassen lässt sich unter Mehr → Einstellungen → Sportarten → Statistik-Gruppen.') }));

  // Höhepunkte
  const hp = d.hoehepunkte, rows = [];
  const tr = (label, icon, t, trail) => UI.row({ icon, title: label, sub: t.name + ' · ' + UI.day(t.start), trail, href: '#/tour/' + t.id });
  if (hp.laengste) rows.push(tr('Längste Tour', 'route', hp.laengste, F.km(hp.laengste.dist)));
  if (hp.aufstieg) rows.push(tr('Höchster Aufstieg', 'up', hp.aufstieg, '↑ ' + F.m(hp.aufstieg.up)));
  if (hp.hoechster) rows.push(tr('Höchster Punkt', 'peak', hp.hoechster, F.m(hp.hoechster.maxAlt)));
  if (hp.serieWochen > 1) rows.push(UI.row({ icon: 'flame', title: 'Längste Serie', sub: 'Wochen in Folge mit mindestens einer Tour', trail: hp.serieWochen + ' Wochen' }));
  if (hp.monat) rows.push(UI.row({ icon: 'calendar', title: 'Aktivster Monat', sub: hp.monat.name + ' ' + year + ' · ' + JahrUI.touren(hp.monat.n) + (hp.monat.dist ? ' · ' + F.km(hp.monat.dist) : ''), trail: hp.monat.dist ? F.km(hp.monat.dist) : JahrUI.touren(hp.monat.n) }));
  if (hp.schoenste) rows.push(UI.row({ icon: 'star', title: 'Schönste Tour', sub: hp.schoenste.tour.name + ' · ' + UI.day(hp.schoenste.tour.start) + (hp.schoenste.gleiche > 1 ? ' (eine von ' + hp.schoenste.gleiche + ' mit ' + hp.schoenste.sterne + ' Sternen)' : ''), trail: hp.schoenste.sterne + ' Sterne', href: '#/tour/' + hp.schoenste.tour.id }));
  if (rows.length) body.append(UI.section('Höhepunkte', UI.list(rows, { id: 'jahr-hoehe' }), { id: 'jahr-hp', sub: hp.schoenste ? 'Die schönste Tour nach deiner eigenen Bewertung.' : null }));

  // Monate im Vergleich
  let met = 'dist';
  const chartBox = h('div', { id: 'jahr-chart' }), segBox = h('div');
  const MET = { dist: 'Strecke', n: 'Touren', up: 'Aufstieg' };
  const drawChart = () => {
    chartBox.innerHTML = ''; segBox.innerHTML = '';
    segBox.append(UI.seg(Object.entries(MET), met, m => { met = m; drawChart(); }, { label: 'Monatswert wählen' }));
    chartBox.append(JahrUI.chart(d.monate, met, MET[met]));
  };
  drawChart();
  const top = Jahr.aktivsterMonat(d.monate);
  const mrows = d.monate.map(m => h('tr', null, h('th', { scope: 'row' }, m.name), h('td', null, String(m.n)), h('td', null, m.dist ? F.km(m.dist) : '–'), h('td', null, m.up ? F.m(m.up) : '–')));
  body.append(UI.section('Monate im Vergleich', [segBox, chartBox,
    h('details', { class: 'jdet', id: 'jahr-zahlenliste' }, h('summary', null, 'Zahlen je Monat'),
      h('table', { class: 'jmon' }, h('thead', null, h('tr', null, h('th', null, 'Monat'), h('th', null, 'Touren'), h('th', null, 'Strecke'), h('th', null, 'Aufstieg'))), h('tbody', null, mrows)))],
    { id: 'jahr-monate', sub: top ? 'Am meisten los war im ' + top.name + ' (dunkler Balken, bei „Strecke“).' : null }));

  // Regionen (nur, wenn schon Orte bekannt sind – nichts erfinden)
  if (d.regionen.length) {
    const nb = d.regionen.reduce((a, r) => a + r.n, 0), alle = d.regionen.length >= 5 ? null : nb;
    body.append(UI.section('Orte und Regionen', UI.list(d.regionen.slice(0, 5).map(r => UI.row({ icon: 'pin', title: r.name, sub: r.dist ? F.km(r.dist) : null, trail: JahrUI.touren(r.n) })), { id: 'jahr-regionen' }),
      { id: 'jahr-orte', sub: 'Die häufigsten Regionen, soweit sie bestimmt sind (Touren → Filter → Region).' + (alle != null && alle < d.n ? ' Für ' + alle + ' von ' + d.n + ' Touren ist die Region bekannt.' : '') }));
  }

  // Fotos: Anzahl und bis zu drei als Collage – nur, wenn es sie auf dem Gerät gibt
  const fotoBox = h('div', { id: 'jahr-fotos-box' });
  body.append(fotoBox);
  (async () => {
    try {
      const ids = new Set(d.ids), ph = (await DB.all('photos')).filter(p => p.tour && ids.has(p.tour) && !p.video);
      if (!ph.length || !fotoBox.isConnected) return;
      const nT = new Set(ph.map(p => p.tour)).size, per = {}; ph.forEach(p => { per[p.tour] = (per[p.tour] || 0) + 1; });
      const tours = all.filter(t => per[t.id]).sort((a, b) => per[b.id] - per[a.id] || a.start - b.start).slice(0, 6);
      const picks = []; for (const t of tours) { if (picks.length >= 3) break; const p = await pickPhoto(t.id).catch(() => null); if (p) picks.push({ p, t }); }
      const grid = h('div', { class: 'jcol', id: 'jahr-collage', hidden: true });
      let ok = 0;
      picks.forEach(({ p, t }) => { const img = h('img', { alt: 'Foto von ' + t.name, src: Photos.thumb(p.id) }); img.onload = () => { ok++; grid.hidden = false; grid.style.gridTemplateColumns = 'repeat(' + ok + ', minmax(0, 1fr))'; }; img.onerror = () => img.remove(); grid.append(img); });
      fotoBox.append(UI.section('Fotos', [h('p', { id: 'jahr-fotozahl' }, h('b', null, String(ph.length)), ph.length === 1 ? ' Foto' : ' Fotos', ' zu ' + JahrUI.touren(nT)), grid], { id: 'jahr-fotos' }));
    } catch (e) { console.error('Jahr: Fotos', e); }
  })();

  // Teilen: die Hauptaktion der Seite
  const btn = h('button', { class: 'btn pri', id: 'jahr-teilen', html: Ico.svg('share') + '<span>Als Bild teilen</span>' });
  btn.onclick = async () => {
    const label = btn.querySelector('span'); btn.disabled = true; label.textContent = 'Bild wird erstellt …';
    try { const cv = await JahrKarte.render(d, { now }); await JahrKarte.teilen(cv, year); }
    catch (e) { console.error('Jahr: Teilen', e); toastFehler('Bild erstellen', e, 6000); }
    finally { btn.disabled = false; label.textContent = 'Als Bild teilen'; }
  };
  // 2.5.0: das ganze Jahr als PDF (Deckblatt, eine Zeile je Tour); die Fotos je Tour sind abschaltbar, weil sie die Datei groß machen
  let pdfFotos = false;
  const pdfBtn = h('button', { class: 'btn', id: 'jahr-pdf', html: Ico.svg('file') + '<span>Als PDF exportieren</span>' });
  pdfBtn.onclick = async () => { pdfBtn.disabled = true; try { await PdfUI.jahr(d, all, { mitFotos: pdfFotos }); } finally { pdfBtn.disabled = false; } };
  body.append(UI.section('Teilen', [h('p', { class: 'muted' }, 'Eine Karte mit den wichtigsten Zahlen deines Jahres als Bild – ohne Tournamen und Orte.'), btn,
    h('p', { class: 'muted jahr-pdf-t' }, 'Oder das ganze Jahr als PDF zum Aufheben: ein Deckblatt mit den Zahlen, dann eine Zeile je Tour mit Datum, Name, Strecke und Aufstieg.'), pdfBtn,
    UI.toggle('Mit Foto je Tour (größere Datei)', false, v => { pdfFotos = !!v; }, { id: 'jahr-pdf-fotos' })], { id: 'jahr-teilen-sec', cls: 'jahr-share' }));
};

/* ---- Bildkarte zum Teilen: 1080 × 1350, hell, ruhig (Papier, Tinte, Petrol). Zeichnet auf ein Canvas, keine Bibliothek. ---- */
const JahrKarte = {
  W: 1080, H: 1350,
  C: { paper: '#f2f4ee', ink: '#0c2526', muted: '#4d615e', line: '#d3dad0', mark: '#5c8a84', soft: '#e4e9e0', petrol: '#0c2526', onPetrol: '#fbfcf8', onPetrol2: '#b4c8c3' },
  SHADES: ['#0c2526', '#0f5a55', '#5c8a84', '#9db9b3', '#cdd8d2'],
  D: '"Barlow Semi Condensed", "Barlow", system-ui, sans-serif', B: '"Barlow", system-ui, sans-serif',
  /** „812 km“ → ['812', 'km'] */
  split(s) { const m = String(s).match(/^([\d.,:]*\d)\s*(.*)$/); return m ? [m[1], m[2]] : [String(s), '']; },
  async fonts() {
    try { await Promise.all(['700 100px "Barlow Semi Condensed"', '600 100px "Barlow Semi Condensed"', '500 100px "Barlow"', '400 100px "Barlow"'].map(f => document.fonts.load(f, '0123456789 Aä'))); } catch (e) { /* Ersatzschrift */ }
  },
  /** Zahl mit kleiner Einheit; schrumpft, bis alles in maxW passt. Gibt die Breite zurück. */
  num(ctx, s, x, y, size, maxW) {
    const [n, u] = JahrKarte.split(s), C = JahrKarte.C;
    let sz = size, w;
    for (;;) { ctx.font = `700 ${sz}px ${JahrKarte.D}`; const wn = ctx.measureText(n).width; ctx.font = `600 ${Math.round(sz * .5)}px ${JahrKarte.B}`; const wu = u ? ctx.measureText(u).width + sz * .12 : 0; w = wn + wu; if (w <= maxW || sz < 24) break; sz -= 2; }
    ctx.fillStyle = C.ink; ctx.textBaseline = 'alphabetic'; ctx.font = `700 ${sz}px ${JahrKarte.D}`; ctx.fillText(n, x, y); const wn = ctx.measureText(n).width;
    if (u) { ctx.font = `600 ${Math.round(sz * .5)}px ${JahrKarte.B}`; ctx.fillText(u, x + wn + sz * .12, y); }
    return w;
  },
  rr(ctx, x, y, w, hh, r) { r = Math.min(r, w / 2, hh / 2); ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + hh, r); ctx.arcTo(x + w, y + hh, x, y + hh, r); ctx.arcTo(x, y + hh, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); },
  /** d: Ergebnis von Jahr.berechne (nicht leer). Gibt das Canvas zurück. */
  async render(d, opts) {
    opts = opts || {};
    if (!d || d.leer) throw new Error('Keine Touren in diesem Jahr');
    await JahrKarte.fonts();
    const { W, H, C } = JahrKarte, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d'), M = 72, IW = W - 2 * M, now = opts.now || new Date();
    ctx.fillStyle = C.paper; ctx.fillRect(0, 0, W, H);
    // Kopf: Petrol mit Wortmarke
    ctx.fillStyle = C.petrol; ctx.fillRect(0, 0, W, 132);
    ctx.save(); ctx.translate(M, 38); ctx.scale(2.4, 2.4); ctx.strokeStyle = C.onPetrol; ctx.lineWidth = 1.9; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.stroke(new Path2D('M3 19l6-11 4 7 2-3 6 7z')); ctx.restore();
    ctx.textBaseline = 'alphabetic'; ctx.fillStyle = C.onPetrol; ctx.font = `600 44px ${JahrKarte.D}`; ctx.fillText('Tourentagebuch', M + 76, 82);
    ctx.textAlign = 'right'; ctx.fillStyle = C.onPetrol2; ctx.font = `500 34px ${JahrKarte.B}`; ctx.fillText('Jahresrückblick', W - M, 80); ctx.textAlign = 'left';
    // Jahr
    ctx.fillStyle = C.ink; ctx.font = `700 250px ${JahrKarte.D}`; ctx.fillText(String(d.year), M - 6, 378);
    ctx.fillStyle = C.muted; ctx.font = `500 38px ${JahrKarte.B}`;
    ctx.fillText(d.year === now.getFullYear() ? 'Mein Tourenjahr bis heute, ' + now.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }) : 'Mein Tourenjahr', M, 438);
    // Kernzahlen: die Strecke groß, vier weitere in einer Reihe
    const k = d.kennzahlen;
    JahrKarte.num(ctx, F.km(k.dist), M, 590, 160, IW);
    ctx.fillStyle = C.muted; ctx.font = `500 32px ${JahrKarte.B}`; ctx.fillText('Strecke', M, 636);
    const cols = [[String(k.n), k.n === 1 ? 'Tour' : 'Touren'], [F.m(k.up), 'Aufstieg'], [F.dur(k.zeit), 'Dauer'], [String(k.tage), k.tage === 1 ? 'Aktiver Tag' : 'Aktive Tage']], cw = (IW - 3 * 24) / 4;
    cols.forEach(([v, l], i) => {
      const x = M + i * (cw + 24); JahrKarte.num(ctx, v, x, 748, 62, cw - 8);
      ctx.fillStyle = C.muted; ctx.font = `500 25px ${JahrKarte.B}`; let t = l; while (ctx.measureText(t).width > cw && t.length > 4) t = t.slice(0, -2) + '…'; ctx.fillText(t, x, 786);
    });
    ctx.fillStyle = C.line; ctx.fillRect(M, 830, IW, 2);
    // Sportarten: ein geteilter Balken (Anteil an der Strecke), darunter die Anteile in Worten
    ctx.fillStyle = C.ink; ctx.font = `600 40px ${JahrKarte.D}`; ctx.fillText('Sportarten', M, 892);
    const sp = d.sportarten, gap = 4; let x = M; const tot = sp.reduce((a, g) => a + g.anteil, 0) || 1, avail = IW - gap * (sp.length - 1);
    sp.forEach((g, i) => { const w = Math.max(8, g.anteil / tot * avail); ctx.fillStyle = JahrKarte.SHADES[Math.min(i, 4)]; JahrKarte.rr(ctx, x, 916, w, 36, 6); ctx.fill(); x += w + gap; });
    sp.forEach((g, i) => {
      const col = i % 2, row = Math.floor(i / 2), lx = M + col * (IW / 2), ly = 1006 + row * 48;
      ctx.fillStyle = JahrKarte.SHADES[Math.min(i, 4)]; JahrKarte.rr(ctx, lx, ly - 22, 24, 24, 5); ctx.fill();
      ctx.font = `500 32px ${JahrKarte.B}`; const pw = ctx.measureText(JahrUI.pct(g.anteil)).width;
      ctx.fillStyle = C.ink; ctx.font = `600 32px ${JahrKarte.B}`;
      let lab = g.label; while (ctx.measureText(lab).width > IW / 2 - 38 - 14 - pw - 12 && lab.length > 4) lab = lab.slice(0, -2) + '…';      // 2.19.0: eigene Gruppennamen bis 30 Zeichen
      ctx.fillText(lab, lx + 38, ly); const wl = ctx.measureText(lab).width;
      ctx.fillStyle = C.muted; ctx.font = `500 32px ${JahrKarte.B}`; ctx.fillText(JahrUI.pct(g.anteil), lx + 38 + wl + 14, ly);
    });
    const ly2 = 1006 + Math.ceil(sp.length / 2) * 48;
    ctx.fillStyle = C.line; ctx.fillRect(M, ly2 + 6, IW, 2);
    // Monate: Strecke je Monat; der stärkste Monat in Tinte
    const my = ly2 + 66;
    ctx.fillStyle = C.ink; ctx.font = `600 40px ${JahrKarte.D}`; ctx.fillText('Strecke je Monat', M, my);
    const base = H - 92, top = my + 36, ch = base - top, mv = d.monate.map(m => m.dist), mx = Math.max(...mv, 1), best = mv.indexOf(Math.max(...mv)), bw = IW / 12;
    d.monate.forEach((m, i) => {
      const bh = mv[i] > 0 ? Math.max(6, mv[i] / mx * ch) : 3;
      ctx.fillStyle = i === best && mv[i] > 0 ? C.ink : C.mark; JahrKarte.rr(ctx, M + i * bw + 7, base - bh, bw - 14, bh, 4); ctx.fill();
      ctx.fillStyle = i === best && mv[i] > 0 ? C.ink : C.muted; ctx.font = `${i === best && mv[i] > 0 ? 600 : 500} 28px ${JahrKarte.B}`; ctx.textAlign = 'center'; ctx.fillText(m.name[0], M + i * bw + bw / 2, base + 40); ctx.textAlign = 'left';
    });
    ctx.fillStyle = C.line; ctx.fillRect(M, base + 2, IW, 2);
    return cv;
  },
  /** Bild über den Teilen-Weg der App weitergeben (wie die Diashow: in den Zwischenspeicher, dann das Teilen-Menü); im Browser als Download. Gibt den Dateinamen zurück. */
  async teilen(cv, year) {
    const blob = await new Promise((ok, no) => cv.toBlob(b => b ? ok(b) : no(new Error('Bild nicht möglich')), 'image/jpeg', 0.95));      // JPEG: so meldet es der Teilen-Anbieter der App (image/jpeg)
    const name = 'Tourentagebuch-Jahr-' + year + '.jpg';
    if (!Native.available()) {
      const a = h('a', { href: URL.createObjectURL(blob), download: name }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 60000);
      toast('Bild gespeichert: ' + name, 5000); return name;
    }
    const buf = new Uint8Array(await blob.arrayBuffer()), CH = 512 * 1024;
    for (let o = 0; o < buf.length; o += CH) {
      let bin = ''; const part = buf.subarray(o, o + CH);
      for (let q = 0; q < part.length; q += 8192) bin += String.fromCharCode.apply(null, part.subarray(q, q + 8192));
      await Native.json('appendCache', { name, b64: btoa(bin), reset: o === 0 });
    }
    await Native.call('shareCache', { name, mime: 'image/jpeg', title: 'Jahresrückblick ' + year + ' teilen' });
    return name;
  },
};

/* ---- Startseite: ruhiger Eintrag; im Dezember und Januar hervorgehoben („Dein Jahr 2026“) ---- */
Home.add('jahr', 45, async ({ all, now }) => {
  const v = Jahr.vorschlag(all, now);
  if (v.hervor) return null;
  return UI.section('Jahresrückblick', UI.list([UI.row({ icon: 'chart', title: 'Dein Jahr ' + v.year + ' im Rückblick', sub: v.n ? JahrUI.touren(v.n) + ' · Zahlen, Höhepunkte, Bild zum Teilen' : 'Zahlen, Höhepunkte, Bild zum Teilen', href: '#/jahr' + (v.n ? '/' + v.year : ''), id: 'jahr-eintrag' })]), { id: 'jahr-ruhig' });
}, { label: 'Jahresrückblick', sub: 'Eintrag zum Rückblick; im Dezember und Januar groß', def: true });
Home.add('jahrhoch', 21, async ({ all, now }) => {
  const v = Jahr.vorschlag(all, now), b = Home.blocks.find(x => x.id === 'jahr');
  if (!v.hervor || (b && !Home.shown(b))) return null;
  const ts = all.filter(t => Jahr.zaehlt(t) && new Date(t.start).getFullYear() === v.year), k = Jahr.kennzahlen(ts);
  return UI.section('Dein Jahr ' + v.year, [UI.figs([[F.km(k.dist), 'Strecke'], [String(k.n), k.n === 1 ? 'Tour' : 'Touren'], ['↑ ' + F.m(k.up), 'Aufstieg']], { big: true }),
    h('a', { class: 'btn', id: 'jahr-hoch', href: '#/jahr/' + v.year }, 'Jahresrückblick ansehen')], { id: 'jahr-gross', cls: 'jahr-hoch' });
});
