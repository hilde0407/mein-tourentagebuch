'use strict';
/* Auswertung wie in „Meine Touren“: Bestwerte, Kalender, Leistung über die Jahre, Sportarten, Neuland, Wetter und Jahresziele.
   Jede Funktion bekommt das Element, die gefilterten Touren und {all, year, sport}. Alles rechnet auf dem Handy. */
const Ausw = {
  day: ms => { const d = new Date(ms); return Math.floor((ms - d.getTimezoneOffset() * -60000 * -1) / 86400000); },
  dkey: ms => { const d = new Date(ms); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); },
  monday: ms => { const d = new Date(ms); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - (d.getDay() + 6) % 7); return d; },
  kpi: (v, l) => UI.fig(v, l),
  link: (t, main, sub) => h('a', { class: 'li', href: '#/tour/' + t.id }, h('span', { class: 'li-i' }, Sports.icon(t.sport)), h('span', { class: 'li-t' }, h('b', null, main), h('small', null, sub))),
  /** 2.24.0: ein Leerzustand für „in diesem Zeitraum gibt es keine Touren“ (Übersicht, Bestwerte, Auswertung) – und einer für „es gibt noch gar keine Touren“. */
  leerZeitraum: () => UI.empty({ icon: 'chart', title: 'Keine Touren in diesem Zeitraum', text: 'Wähle oben ein anderes Jahr oder eine andere Sportart.' }),
  leerKeine: () => UI.empty({ icon: 'chart', cls: 'st-leer', title: 'Noch keine Touren', text: 'Sobald Touren im Tagebuch stehen, zeigt die Statistik hier Zahlen, Bestwerte und den Kalender.',
    actions: [UI.sign('Aufzeichnung starten', { href: '#/rec' }), h('a', { class: 'btn', href: '#/import', html: Ico.svg('download') + '<span>Touren importieren</span>' })] }),
  sec: (title, sub) => [h('h3', null, title), sub ? h('p', { class: 'muted small' }, sub) : null].filter(Boolean),

  /* ---------- Bestwerte (ein Abschnitt statt zweier Rekordlisten) und Wochen-Serie ---------- */
  wk: n => (n === 1 ? '1 Woche' : n + ' Wochen'),
  /** Abschnitt „Bestwerte“: längste Strecke, größter Aufstieg, längste Dauer, höchster Punkt, stärkster Monat; wählbar die besten 1 oder 3. */
  bestwerte(ts) {
    const box = h('div', { id: 'bestwerte' });
    const draw = () => {
      const n = +Set_.get('bestN') === 3 ? 3 : 1, b = Bestwerte.berechne(ts, n), list = h('div');
      const tr = (t, val) => ({ title: val, sub: t.name + ' · ' + F.dshort(t.start), href: '#/tour/' + t.id });
      const mo = g => ({ title: F.km(g.dist), sub: new Date(g.y, g.m, 1).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' }) + ' · ' + g.n + (g.n === 1 ? ' Tour' : ' Touren') });
      const groups = [['Längste Strecke', b.strecke.map(t => tr(t, F.km(t.dist)))], ['Größter Aufstieg', b.aufstieg.map(t => tr(t, F.m(t.up)))], ['Längste Dauer', b.dauer.map(t => tr(t, F.dur(t.dur)))],
        ['Höchster Punkt', b.hoehe.map(t => tr(t, F.m(t.maxAlt)))], ['Stärkster Monat', b.monat.map(mo)]].filter(g => g[1].length);
      if (!groups.length) list.append(h('p', { class: 'muted' }, 'Noch keine Touren mit diesen Werten.'));
      else if (n === 1) list.append(UI.list(groups.map(([lab, rows]) => UI.row({ icon: 'trophy', title: lab + ': ' + rows[0].title, sub: rows[0].sub, href: rows[0].href }))));
      else groups.forEach(([lab, rows]) => list.append(h('h3', { class: 'sub' }, lab), UI.list(rows.map((r, i) => UI.row({ icon: 'trophy', title: (i + 1) + '. ' + r.title, sub: r.sub, href: r.href })))));
      box.innerHTML = '';
      box.append(UI.section('Bestwerte', [UI.seg([[1, 'Beste'], [3, 'Beste drei']], n, async k => { await Set_.set('bestN', k); draw(); document.dispatchEvent(new Event('mt-bestN')); }, { label: 'Anzahl' }), list]));
    };
    draw();
    return box;
  },
  /** Abschnitt „Wochen-Serie“: Wochen in Folge mit mindestens einer Tour (Montag bis Sonntag). */
  serie(tours) {
    const s = Serie.berechne(tours, new Date());
    return UI.section('Wochen-Serie', [UI.figs([[Ausw.wk(s.aktuell), 'aktuelle Serie'], [Ausw.wk(s.rekord), 'Bestwert'], [s.wochenMit + ' von 26', 'Wochen mit Tour']]),
      h('p', { class: 'muted small' }, s.offen ? 'Diese Woche fehlt noch eine Tour, damit die Serie weiterläuft.' : 'Eine Woche zählt, wenn sie mindestens eine Tour enthält (Montag bis Sonntag).')], { id: 'serie-sec' });
  },

  /* ---------- Rekorde ---------- */
  rekorde(body, ts, ctx) {
    const real = ts.filter(t => t.dist > 0);
    if (!real.length) { body.append(Ausw.leerZeitraum()); return; }
    body.append(Ausw.bestwerte(ts), Ausw.serie(((ctx && ctx.all) || ts).filter(t => !(ctx && ctx.sport) || Sports.passt(ctx.sport, t.sport))));
    const group = keyFn => { const m = new Map(); real.forEach(t => { const k = keyFn(t.start); const g = m.get(k) || { k, dist: 0, up: 0, n: 0, first: t.start }; g.dist += t.dist; g.up += t.up || 0; g.n++; g.first = Math.min(g.first, t.start); m.set(k, g); }); return [...m.values()]; };
    const best = (arr, f) => arr.slice().sort((a, b) => f(b) - f(a))[0];
    const days = group(Ausw.dkey), weeks = group(ms => Ausw.monday(ms).getTime()), months = group(ms => { const d = new Date(ms); return d.getFullYear() + '-' + d.getMonth(); }), yrs = group(ms => new Date(ms).getFullYear());
    // Serie aufeinanderfolgender Tage mit Tour
    const ds = [...new Set(real.map(t => Math.round(new Date(new Date(t.start).toDateString()).getTime() / 86400000)))].sort((a, b) => a - b);
    let run = 0, bestRun = 0, runEnd = 0; ds.forEach((d, i) => { run = i && d - ds[i - 1] === 1 ? run + 1 : 1; if (run > bestRun) { bestRun = run; runEnd = d; } });
    const row = (ico, lab, val, sub, href) => h(href ? 'a' : 'div', href ? { class: 'li', href } : { class: 'li' }, h('span', { class: 'li-i', html: Ico.svg(ico, 22) }), h('span', { class: 'li-t' }, h('b', null, lab + ': ' + val), h('small', null, sub || '')));
    const fmtM = k => { const [y, m] = k.split('-'); return new Date(+y, +m, 1).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' }); };
    const d1 = best(days, g => g.dist), w1 = best(weeks, g => g.dist), m1 = best(months, g => g.dist), y1 = best(yrs, g => g.n), y2 = best(yrs, g => g.dist);
    body.append(...Ausw.sec('Zeiträume'), h('div', { class: 'list' },
      row('trophy', 'Bester Tag', F.km(d1.dist), d1.n + (d1.n === 1 ? ' Tour' : ' Touren') + ' am ' + F.date(d1.first)),
      row('trophy', 'Beste Woche', F.km(w1.dist), 'ab ' + F.date(w1.k) + ' · ' + w1.n + ' Touren · ' + F.m(w1.up) + ' Aufstieg'),
            row('trophy', 'Meiste Touren in einem Jahr', y1.n, y1.k + ' · ' + F.km(y1.dist)),
      row('trophy', 'Stärkstes Jahr', F.km(y2.dist), y2.k + ' · ' + y2.n + ' Touren · ' + F.m(y2.up) + ' Aufstieg'),
      row('flame', 'Längste Serie', bestRun + (bestRun === 1 ? ' Tag' : ' Tage') + ' in Folge', 'bis ' + F.date(runEnd * 86400000))));
    body.append(Ausw.jeSportart(real));
  },

  /** 2.13.0: „Bestwerte je Sportart“ als Rangliste (Rechnung: Bestwerte.jeSportart in calc-ziele.js). Folgt der Wahl „Beste / Beste drei“ oben;
      bei „Beste drei“ stehen Platz 2 und 3 leise unter dem Bestwert. Tempo nur, wo es sinnvoll ist (Zeit in Bewegung, nicht bei Ski alpin). */
  jeSportart(real) {
    const box = h('div', { id: 'bw-sport' });
    const neu = () => { if (!box.isConnected) { document.removeEventListener('mt-bestN', neu); return; } box.innerHTML = ''; Ausw.jeSportartFuellen(box, real); };
    document.addEventListener('mt-bestN', neu);
    Ausw.jeSportartFuellen(box, real);
    return box;
  },
  jeSportartFuellen(box, real) {
    const gr = StatGruppen.aktuell(), n = +Set_.get('bestN') === 3 ? 3 : 1, groups = Bestwerte.jeSportart(real, n, 2, gr);
    if (!groups.length) return box;
    const M = [['strecke', 'Längste', t => F.km(t.dist)], ['aufstieg', 'Größter Aufstieg', t => F.m(t.up)], ['dauer', 'Längste Dauer', t => F.dur(t.dur)],
      ['hoehe', 'Höchster Punkt', t => F.m(t.maxAlt)], ['tempo', 'Schnellste', t => F.speed(t.dist, t.moving)]];
    const kids = [];
    groups.forEach(g => {
      const rows = M.filter(([k]) => g[k].length).map(([k, lab, fm]) => {
        const [b, ...weitere] = g[k], mehr = weitere.map((t, i) => (i + 2) + '. ' + fm(t)).join(' · ');
        return h('a', { class: 'li', href: '#/tour/' + b.id, 'data-m': k }, h('span', { class: 'li-i', html: Ico.svg('trophy', 22) }),
          h('span', { class: 'li-t' }, h('b', null, lab + ': ' + fm(b)), h('small', null, b.name + ' · ' + F.dshort(b.start)), mehr ? h('small', { class: 'bw-mehr' }, mehr) : null));
      });
      kids.push(h('h3', { class: 'sub', 'data-sport': g.sport, title: StatGruppen.titel(g.sport, gr) || null }, StatGruppen.icon(g.sport, gr) + ' ' + StatGruppen.beschriftung(g.sport, gr) + ' · ' + g.n + ' Touren'), h('div', { class: 'list' }, rows));      // 2.19.0: Gruppe = eine Zeile mit ihrem Namen
    });
    box.append(...Ausw.sec('Bestwerte je Sportart', n === 3 ? 'Je Sportart der Bestwert, darunter Platz 2 und 3. Tempo aus der Bewegungszeit.' : 'Je Sportart der Bestwert (oben „Beste drei“ zeigt auch Platz 2 und 3). Tempo aus der Bewegungszeit.'), ...kids);
    return box;
  },

  /* ---------- 2.13.0 Jahresvergleich ---------- */
  vgl: { a: null, b: null, m: 'dist' },
  /** Wert einer Kennzahl als Text. */
  vfmt: (k, v) => (k === 'dist' ? F.km(v) : k === 'up' ? F.m(v) : k === 'zeit' ? F.dur(v) : (v === 1 ? '1 Tour' : Math.round(v) + ' Touren')),
  /** „+12 % Strecke“ und darunter die beiden Summen. */
  vergleich(body, ts, ctx) {
    const now = new Date(), sportFn = s => Sports.passt(ctx.sport, s), years = Vergleich.jahre(ctx.all, now), S = Ausw.vgl;      // Jahresauswahl ohne Sportart-Filter: der Filter soll die gewählten Jahre nicht verstellen
    const def = Vergleich.vorgabe(now);
    if (S.a == null || !years.includes(S.a)) S.a = def.a;
    if (S.b == null || !years.concat([S.a - 1]).includes(S.b)) S.b = years.includes(def.b) ? def.b : (years.find(y => y < S.a) || S.a - 1);
    const wrap = h('div', { id: 'vgl' }); body.append(wrap);
    const opts = (sel, extra) => [...new Set(years.concat(extra))].sort((a, b) => b - a).map(y => h('option', { value: y, selected: y === sel }, String(y)));
    const draw = () => {
      wrap.innerHTML = '';
      const r = Vergleich.berechne(ctx.all, S.a, S.b, now, sportFn), k = S.m, lab = Vergleich.METRIKEN.find(x => x[0] === k)[1];
      const selA = h('select', { id: 'vgl-a', onchange: e => { S.a = +e.target.value; draw(); } }, opts(S.a, [])), selB = h('select', { id: 'vgl-b', onchange: e => { S.b = +e.target.value; draw(); } }, opts(S.b, [S.a - 1]));
      wrap.append(h('div', { class: 'row vgl-jahre' }, h('label', { class: 'vgl-l' }, h('span', null, 'Jahr'), selA), h('label', { class: 'vgl-l' }, h('span', null, 'gegen'), selB)));
      wrap.append(UI.seg(Vergleich.METRIKEN, k, m => { S.m = m; draw(); }, { label: 'Kennzahl wählen' }));
      if (r.a.leer && r.b.leer) { wrap.append(UI.empty({ icon: 'chart', title: 'Keine Touren in ' + S.a + ' und ' + S.b, text: ctx.sport ? 'Wähle oben eine andere Sportart oder andere Jahre.' : 'Wähle andere Jahre.' })); return; }
      const bis = r.stichtag ? ' bis ' + r.stichtag.tag + '.' + (r.stichtag.monat + 1) + '.' : '';
      // Differenz-Zeile: die gewählte Kennzahl groß, alle vier leise darunter
      const d = r.diff[k], pt = Vergleich.pctText(d);
      const haupt = r.gleich ? 'Gleiches Jahr gewählt' : pt == null ? 'In beiden Jahren nichts' : pt === 'neu' ? lab + ': neu in ' + S.a : pt + ' ' + lab;
      wrap.append(h('div', { class: 'vgl-diff', id: 'vgl-diff' }, h('b', null, haupt), h('small', { class: 'muted' }, S.a + bis + ': ' + Ausw.vfmt(k, d.a) + ' · ' + S.b + bis + ': ' + Ausw.vfmt(k, d.b))));
      wrap.append(UI.facts(Vergleich.METRIKEN.map(([m, l]) => { const x = r.diff[m], p = Vergleich.pctText(x); return [l, (x.abs > 0 ? '+' : x.abs < 0 ? '−' : '±') + Ausw.vfmt(m, Math.abs(x.abs)) + (p && p !== 'neu' ? ' (' + p + ')' : '')]; })));
      wrap.append(Ausw.vChart(r, k, lab));
      if (r.bisHeute) wrap.append(h('p', { class: 'muted small' }, 'Das laufende Jahr zählt bis heute; das andere Jahr wird bis zum gleichen Kalendertag verglichen. Die Linien zeigen das ganze Jahr, soweit es vergangen ist.'));
      const mrow = i => h('tr', null, h('th', { scope: 'row' }, Jahr.MONATE[i]), h('td', null, r.a.kum[k][i] == null ? '–' : Ausw.vfmt(k, r.a.kum[k][i])), h('td', null, r.b.kum[k][i] == null ? '–' : Ausw.vfmt(k, r.b.kum[k][i])));
      wrap.append(h('details', { class: 'jdet', id: 'vgl-tabelle' }, h('summary', null, 'Zahlen je Monat (aufsummiert)'),
        h('table', { class: 'jmon' }, h('thead', null, h('tr', null, h('th', null, 'Monat'), h('th', null, String(S.a)), h('th', null, String(S.b)))), h('tbody', null, Array.from({ length: 12 }, (_, i) => mrow(i))))));
    };
    draw();
  },
  /** Liniendiagramm: zwei Jahre, Monat für Monat aufsummiert. Eine y-Achse mit runden Teilstrichen, Jahr A durchgezogen (Akzent), Jahr B gestrichelt (gedämpft),
      Beschriftung am Linienende und in der Legende (nie nur Farbe). Antippen eines Monats zeigt beide Werte. Farben aus den Variablen der App (hell und dunkel). */
  vChart(r, k, lab) {
    const W = 340, H = 206, L = 46, R = 40, T = 24, B = 26, pw = W - L - R, ph = H - T - B;
    const vals = r.a.kum[k].concat(r.b.kum[k]).filter(v => v != null), mx0 = Math.max(1, ...vals);
    const step = (() => { const raw = mx0 / 4, p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p; })();
    const mx = Math.ceil(mx0 / step) * step, X = i => L + i * pw / 11, Y = v => T + ph - v / mx * ph;
    const tick = v => (k === 'dist' ? Math.round(v / 1000).toLocaleString('de-DE') : k === 'zeit' ? Math.round(v / 3600).toLocaleString('de-DE') : Math.round(v).toLocaleString('de-DE'));
    const unit = k === 'dist' ? 'km' : k === 'up' ? 'm' : k === 'zeit' ? 'Std.' : '';
    let g = '';
    for (let v = 0; v <= mx + 1e-9; v += step) g += `<line x1="${L}" x2="${W - R}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" stroke="var(--line)" stroke-width="1"/><text x="${L - 6}" y="${(Y(v) + 4).toFixed(1)}" text-anchor="end" class="vt">${tick(v)}</text>`;
    g += `<text x="${L - 6}" y="${T - 12}" text-anchor="end" class="vt">${unit}</text>`;
    Vergleich.KURZ.forEach((m, i) => { if (i % 2 === 0) g += `<text x="${X(i).toFixed(1)}" y="${H - 8}" text-anchor="middle" class="vt">${m}</text>`; });
    g += `<line x1="${L}" x2="${W - R}" y1="${T + ph}" y2="${T + ph}" stroke="var(--edge)" stroke-width="1"/>`;
    const line = (arr, cls) => { const p = arr.map((v, i) => (v == null ? null : [X(i), Y(v)])).filter(Boolean); if (!p.length) return ''; return `<polyline class="${cls}" fill="none" points="${p.map(q => q[0].toFixed(1) + ',' + q[1].toFixed(1)).join(' ')}"/>`; };
    const ende = (arr, y, cls) => { let i = -1; arr.forEach((v, j) => { if (v != null) i = j; }); if (i < 0) return ''; return `<circle class="${cls}" cx="${X(i).toFixed(1)}" cy="${Y(arr[i]).toFixed(1)}" r="4"/><text x="${(X(i) + 7).toFixed(1)}" y="${(Y(arr[i]) + 4).toFixed(1)}" class="vy">${y}</text>`; };
    // Beschriftung am Ende: liegen beide Enden dicht beieinander, rückt das untere Etikett nach unten
    let lb = ende(r.b.kum[k], r.b.year, 'vb-e'), la = ende(r.a.kum[k], r.a.year, 'va-e');
    const ia = r.a.kum[k].filter(v => v != null).length - 1, ib = r.b.kum[k].filter(v => v != null).length - 1;
    if (ia === ib && ia >= 0 && Math.abs(Y(r.a.kum[k][ia]) - Y(r.b.kum[k][ib])) < 14) { const lower = Y(r.a.kum[k][ia]) >= Y(r.b.kum[k][ib]) ? 'a' : 'b'; const fix = s => s.replace(/(<text x="[\d.]+" y=")([\d.]+)/, (m0, a, y) => a + (+y + 12).toFixed(1)); if (lower === 'a') la = fix(la); else lb = fix(lb); }
    const hits = Vergleich.KURZ.map((m, i) => `<rect class="vh" data-i="${i}" x="${(X(i) - pw / 22).toFixed(1)}" y="${T}" width="${(pw / 11).toFixed(1)}" height="${ph}" fill="transparent"/>`).join('');
    const fmt = v => (v == null ? 'noch offen' : Ausw.vfmt(k, v));
    const text = lab + ' aufsummiert je Monat. ' + r.a.year + ': ' + Jahr.MONATE.map((m, i) => r.a.kum[k][i] == null ? null : m + ' ' + fmt(r.a.kum[k][i])).filter(Boolean).join(', ') + '. ' + r.b.year + ': ' + Jahr.MONATE.map((m, i) => r.b.kum[k][i] == null ? null : m + ' ' + fmt(r.b.kum[k][i])).filter(Boolean).join(', ') + '.';
    const svg = `<svg class="vchart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(text)}">${g}${line(r.b.kum[k], 'vb')}${line(r.a.kum[k], 'va')}${lb}${la}<line class="vcur" x1="0" x2="0" y1="${T}" y2="${T + ph}" visibility="hidden"/>${hits}</svg>`;
    const legend = h('div', { class: 'vleg', 'aria-hidden': 'true' }, h('span', null, h('i', { class: 'va-s' }), String(r.a.year)), h('span', null, h('i', { class: 'vb-s' }), String(r.b.year)));
    const read = h('p', { class: 'small vread', id: 'vgl-wert', 'aria-live': 'polite' }, 'Monat antippen für die Werte.');
    const box = h('div', { class: 'vcw', id: 'vgl-chart' }, legend, h('div', { html: svg }), read);
    const cur = () => box.querySelector('.vcur');
    const zeige = i => { const c = cur(); c.setAttribute('x1', X(i)); c.setAttribute('x2', X(i)); c.setAttribute('visibility', 'visible');
      read.textContent = Jahr.MONATE[i] + ': ' + r.a.year + ' ' + fmt(r.a.kum[k][i]) + ' · ' + r.b.year + ' ' + fmt(r.b.kum[k][i]); };
    box.querySelectorAll('.vh').forEach(el => { el.addEventListener('click', () => zeige(+el.dataset.i)); el.addEventListener('mouseenter', () => zeige(+el.dataset.i)); });
    return box;
  },

  /* ---------- Kalender ---------- */
  kalender(body, ts, ctx) {
    const all = ctx.all, years = [...new Set(all.map(t => new Date(t.start).getFullYear()))].sort((a, b) => b - a);
    let y = ctx.year === 'all' ? (years[0] || new Date().getFullYear()) : ctx.year;
    const wrap = h('div'); body.append(wrap);
    const draw = () => {
      wrap.innerHTML = '';
      const by = new Map(); all.filter(t => new Date(t.start).getFullYear() === y && Sports.passt(ctx.sport, t.sport)).forEach(t => { const k = Ausw.dkey(t.start); const a = by.get(k) || []; a.push(t); by.set(k, a); });
      const mx = Math.max(1, ...[...by.values()].map(a => a.reduce((s, t) => s + t.dist, 0)));
      const nav = h('div', { class: 'row' }, h('button', { class: 'btn sm', 'aria-label': 'Vorjahr', onclick: () => { y--; draw(); } }, '‹'), h('b', { class: 'calyear' }, String(y)), h('button', { class: 'btn sm', 'aria-label': 'Folgejahr', onclick: () => { y++; draw(); } }, '›'));
      wrap.append(nav, h('p', { class: 'muted small' }, (by.size === 1 ? '1 aktiver Tag' : by.size + ' aktive Tage') + '. Je dunkler, desto weiter. Tag antippen für die Touren.'));
      const grid = h('div', { class: 'cal' });
      for (let m = 0; m < 12; m++) {
        const first = new Date(y, m, 1), n = new Date(y, m + 1, 0).getDate(), off = (first.getDay() + 6) % 7;
        const cells = [];
        for (let i = 0; i < off; i++) cells.push(h('i', { class: 'cd none' }));
        for (let d = 1; d <= n; d++) {
          const k = y + '-' + String(m + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0'), a = by.get(k);
          const km = a ? a.reduce((s, t) => s + t.dist, 0) : 0, lv = a ? 1 + Math.min(3, Math.floor(km / mx * 4)) : 0;
          cells.push(h(a ? 'button' : 'i', a ? { class: 'cd l' + lv, 'aria-label': d + '.' + (m + 1) + '. ' + F.km(km), onclick: () => Ausw.dayList(k, a) } : { class: 'cd' }, String(d)));
        }
        grid.append(h('div', { class: 'cm' }, h('b', null, first.toLocaleDateString('de-DE', { month: 'long' })), h('div', { class: 'cg' }, cells)));
      }
      wrap.append(grid);
    };
    draw();
  },
  dayList(k, list) {
    const s = sheet(F.date(list[0].start), h('div', { class: 'list' }, list.map(t => h('a', { class: 'li', href: '#/tour/' + t.id, onclick: () => s.close() }, h('span', { class: 'li-i' }, Sports.icon(t.sport)), h('span', { class: 'li-t' }, h('b', null, t.name), h('small', null, F.km(t.dist) + ' · ' + F.m(t.up) + ' · ' + F.dur(t.moving || t.dur)))))));
  },

  /* ---------- Auswertung: Sportarten, Leistung, Neuland, Wetter ---------- */
  auswertung(body, ts, ctx) {
    if (!ts.length) { body.append(Ausw.leerZeitraum()); return; }
    // Statistik nach Sportart
    const gr = StatGruppen.aktuell();      // 2.19.0: Statistik-Gruppen als eine Zeile mit dem Gruppennamen
    const rows = [...StatGruppen.aufteilen(ts, gr).entries()].sort((a, b) => b[1].reduce((x, t) => x + t.dist, 0) - a[1].reduce((x, t) => x + t.dist, 0));
    const sm = (a, k) => a.reduce((x, t) => x + (t[k] || 0), 0);
    body.append(...Ausw.sec('Statistik nach Sportart'), h('div', { class: 'tblw' }, h('table', { class: 'cstat' },
      h('thead', null, h('tr', null, ['Sportart', 'Touren', 'km', 'Aufstieg m', 'Ø km', 'Bewegungszeit'].map(x => h('th', null, x)))),
      h('tbody', null, rows.map(([k, a]) => h('tr', { 'data-sport': k }, h('td', { title: StatGruppen.titel(k, gr) || null }, StatGruppen.icon(k, gr) + ' ' + StatGruppen.beschriftung(k, gr)), h('td', { 'data-l': 'Touren' }, String(a.length)), h('td', { 'data-l': 'km' }, Math.round(sm(a, 'dist') / 1000).toLocaleString('de-DE')), h('td', { 'data-l': 'Aufstieg m' }, Math.round(sm(a, 'up')).toLocaleString('de-DE')), h('td', { 'data-l': 'Ø km' }, (sm(a, 'dist') / a.length / 1000).toFixed(1).replace('.', ',')), h('td', { 'data-l': 'Bewegungszeit' }, F.dur(sm(a, 'moving') || sm(a, 'dur')))))))));
    // Leistung über die Jahre
    const all = ctx.all.filter(t => Sports.passt(ctx.sport, t.sport));
    const perf = [];
    [...new Set(all.map(t => Sports.anzeige(t.sport)))].forEach(s => {
      const byY = {}; all.filter(t => Sports.anzeige(t.sport) === s && t.moving > 300 && t.dist > 500).forEach(t => { (byY[new Date(t.start).getFullYear()] = byY[new Date(t.start).getFullYear()] || []).push(t); });
      const ys = Object.keys(byY).filter(y => byY[y].length >= 2).sort();
      if (ys.length < 2) return;
      const spd = ys.map(y => sm(byY[y], 'dist') / sm(byY[y], 'moving') * 3.6), climb = ys.map(y => sm(byY[y], 'up') / (sm(byY[y], 'moving') / 3600));
      const bar = (vals, unit, dec) => { const mx = Math.max(...vals, 1); return h('div', { class: 'hbars' }, ys.map((y, i) => h('div', { class: 'hb' }, h('span', null, y), h('div', null, h('i', { style: { width: (vals[i] / mx * 100) + '%' } })), h('b', null, vals[i].toFixed(dec).replace('.', ',') + ' ' + unit)))); };
      perf.push(h('h3', { class: 'sub' }, Sports.icon(s) + ' ' + Sports.label(s)), h('p', { class: 'muted small' }, 'Ø Tempo (in Bewegung)'), bar(spd, 'km/h', 1), !['bike', 'racebike', 'mtb', 'ebike', 'gravel', 'emtb', 'bikepacking'].includes(s) ? [h('p', { class: 'muted small' }, 'Aufstieg je Stunde'), bar(climb, 'm/h', 0)] : null);
    });
    if (perf.length) body.append(...Ausw.sec('Leistung über die Jahre', 'nur Jahre mit mindestens 2 Touren der Sportart'), ...perf.flat().filter(Boolean));
    // Neuland und Wetter
    const nl = h('div'), wx = h('div');
    body.append(...Ausw.sec('Neuland', 'Anteil der Strecke, der auf keiner früheren Tour lag (Raster von rund 200 m)'), nl, ...Ausw.sec('Wetter', 'Temperatur und Niederschlag am Tourtag (Open-Meteo, braucht Internet; wird einmal geladen)'), wx);
    Ausw.neuland(nl, ctx); Ausw.wetter(wx, ctx);
  },

  cellKey: (la, lo) => Math.round(la / 0.002) + ',' + Math.round(lo / 0.002),
  async neulandRechnen(onProgress) {
    const tours = (await Tours.list()).filter(t => t.status !== 'planned' && !t.hidden).slice().sort((a, b) => a.start - b.start);
    const seen = new Set(); let n = 0;
    for (const t of tours) {
      const r = await DB.get('tracks', t.id); const mine = new Set();
      if (r) for (let i = 0; i < r.lat.length; i++) mine.add(Ausw.cellKey(r.lat[i], r.lon[i]));
      let nw = 0; mine.forEach(c => { if (!seen.has(c)) nw++; });
      const pct = mine.size ? Math.round(nw / mine.size * 100) : 0;
      if (t.nlNew !== pct || t.nlCells !== mine.size) { t.nlNew = pct; t.nlCells = mine.size; await Tours.save(t); }
      mine.forEach(c => seen.add(c)); n++;
      if (onProgress && n % 5 === 0) { onProgress(n, tours.length); await new Promise(r => setTimeout(r, 0)); }
    }
    Tours.invalidate(); return { tours: n, cells: seen.size };
  },
  neuland(el, ctx) {
    const draw = () => {
      el.innerHTML = '';
      const ts = ctx.all.filter(t => t.nlCells != null);
      const todo = ctx.all.filter(t => t.nlCells == null).length;
      const btn = h('button', { class: 'btn' + (todo ? ' pri' : ''), onclick: async () => {
        btn.disabled = true; try { await Ausw.neulandRechnen((i, n) => { btn.textContent = 'Berechne ' + i + '/' + n + ' …'; }); } catch (e) { toastFehler('Berechnung', e, 6000); }
        const all2 = (await Tours.list()).filter(t => t.status !== 'planned' && !t.hidden); ctx.all.splice(0, ctx.all.length, ...all2); draw(); } }, todo ? 'Berechnen' + (ts.length ? ' (' + todo + ' neue)' : '') : 'Neu berechnen');
      if (!ts.length) { el.append(h('p', { class: 'muted' }, 'Noch nicht berechnet.'), btn); return; }
      const years = [...new Set(ts.map(t => new Date(t.start).getFullYear()))].sort();
      const avg = y => { const a = ts.filter(t => new Date(t.start).getFullYear() === y); return a.reduce((s, t) => s + t.nlNew * t.nlCells, 0) / (a.reduce((s, t) => s + t.nlCells, 0) || 1); };
      el.append(h('div', { class: 'hbars' }, years.map(y => h('div', { class: 'hb' }, h('span', null, String(y)), h('div', null, h('i', { style: { width: avg(y) + '%' } })), h('b', null, Math.round(avg(y)) + ' %')))));
      const tops = ts.filter(t => t.nlCells >= 10).sort((a, b) => b.nlNew * b.nlCells - a.nlNew * a.nlCells).slice(0, 5);
      el.append(h('h3', { class: 'sub' }, 'Größte Entdeckungen'), h('div', { class: 'list' }, tops.map(t => Ausw.link(t, t.name, t.nlNew + ' % neu · ' + F.km(t.dist) + ' · ' + F.dshort(t.start)))), btn);
    };
    draw();
  },

  wxRows: ts => ts.filter(t => t.wxT != null),
  async wetterLaden(tours, onProgress) {
    let ok = 0, fail = 0;
    for (let i = 0; i < tours.length; i++) {
      const t = tours[i]; if (onProgress) onProgress(i + 1, tours.length);
      try {
        const d = Ausw.dkey(t.start);
        const r = await Native.http({ url: `https://archive-api.open-meteo.com/v1/archive?latitude=${t.lat.toFixed(3)}&longitude=${t.lon.toFixed(3)}&start_date=${d}&end_date=${d}&daily=temperature_2m_mean,temperature_2m_max,precipitation_sum&timezone=auto` });
        if (r.status !== 200) throw new Error('HTTP ' + r.status);
        const j = JSON.parse(r.body).daily; if (!j || j.temperature_2m_mean == null || j.temperature_2m_mean[0] == null) throw new Error('keine Daten');
        t.wxT = Math.round(j.temperature_2m_mean[0] * 10) / 10; t.wxMax = j.temperature_2m_max[0]; t.wxP = Math.round((j.precipitation_sum[0] || 0) * 10) / 10;
        await Tours.save(t); ok++;
      } catch (e) { fail++; if (/HTTP 429/.test(e.message)) break; }
      await new Promise(r => setTimeout(r, 120));
    }
    Tours.invalidate(); return { ok, fail };
  },
  wetter(el, ctx) {
    const draw = () => {
      el.innerHTML = '';
      const have = Ausw.wxRows(ctx.all), todo = ctx.all.filter(t => t.wxT == null && t.start && t.lat != null && !t.wxFail);
      const btn = h('button', { class: 'btn' + (have.length ? '' : ' pri'), onclick: async () => {
        btn.disabled = true; const batch = todo.slice(0, 150);
        try { const r = await Ausw.wetterLaden(batch, (i, n) => { btn.textContent = 'Lade ' + i + '/' + n + ' …'; }); toast(r.ok + ' Touren mit Wetter' + (r.fail ? ' · ' + r.fail + ' ohne Daten' : '')); } catch (e) { toastFehler('Wetter holen', e, 6000); }
        const all2 = (await Tours.list()).filter(t => t.status !== 'planned' && !t.hidden); ctx.all.splice(0, ctx.all.length, ...all2); draw(); } }, todo.length ? (have.length ? 'Weitere holen (' + Math.min(150, todo.length) + ' von ' + todo.length + ')' : 'Wetter holen') : 'Alles geholt');
      if (!todo.length) btn.disabled = true;
      if (!have.length) { el.append(btn); return; }
      const buckets = [['unter 0 °', t => t.wxT < 0], ['0 – 10 °', t => t.wxT >= 0 && t.wxT < 10], ['10 – 20 °', t => t.wxT >= 10 && t.wxT < 20], ['20 – 30 °', t => t.wxT >= 20 && t.wxT < 30], ['über 30 °', t => t.wxT >= 30]];
      const counts = buckets.map(([l, f]) => [l, have.filter(f).length]), mx = Math.max(...counts.map(c => c[1]), 1);
      const rain = have.filter(t => t.wxP >= 1).length;
      el.append(h('p', { class: 'muted small' }, have.length + ' Touren mit Wetterdaten'), h('p', { class: 'muted small' }, 'Bei welcher Tagesmitteltemperatur bist du unterwegs?'),
        h('div', { class: 'hbars' }, counts.map(([l, c]) => h('div', { class: 'hb' }, h('span', null, l), h('div', null, h('i', { style: { width: (c / mx * 100) + '%' } })), h('b', null, String(c))))),
        h('div', { class: 'kpis' }, Ausw.kpi(Math.round(rain / have.length * 100) + ' %', 'an Regentagen (≥ 1 mm)'), Ausw.kpi(Math.min(...have.map(t => t.wxT)).toFixed(0) + ' °', 'kältester Tag'), Ausw.kpi(Math.max(...have.map(t => t.wxMax != null ? t.wxMax : t.wxT)).toFixed(0) + ' °', 'wärmster Tag')));
      const kalt = have.slice().sort((a, b) => a.wxT - b.wxT)[0], nass = have.slice().sort((a, b) => b.wxP - a.wxP)[0];
      el.append(h('div', { class: 'list' }, Ausw.link(kalt, 'Kälteste Tour: ' + kalt.wxT + ' °', kalt.name + ' · ' + F.dshort(kalt.start)), nass.wxP > 0 ? Ausw.link(nass, 'Nassester Tag: ' + nass.wxP + ' mm', nass.name + ' · ' + F.dshort(nass.start)) : null), btn);
    };
    draw();
  },
};
