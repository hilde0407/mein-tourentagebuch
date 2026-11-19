'use strict';
/* Startseite: die letzte Tour groß, die drei Hauptaktionen, das laufende Jahr, die letzten Touren.
   Die Seite besteht aus Bausteinen. Ein weiterer Baustein (Ziele, Serie, Fitness …) wird so angemeldet:
     Home.add('serie', 30, async ctx => UI.section('Serie', …));      // ctx: { all, now, year }
   Die Zahl bestimmt die Reihenfolge (Aufmacher 0, Aktionen 10, Dieses Jahr 20, Letzte Touren 40, An diesem Tag 50).
   Gibt ein Baustein null zurück, erscheint er nicht. */
const Home = {
  blocks: [],
  add(id, order, fn) { Home.blocks = Home.blocks.filter(b => b.id !== id); Home.blocks.push({ id, order, fn }); Home.blocks.sort((a, b) => a.order - b.order); },

  /** Läuft gerade eine Aufzeichnung (oder ist sie pausiert)? */
  live() { try { const st = window.MTApp ? JSON.parse(MTApp.status()) : {}; return st.state === 'recording' || st.state === 'paused'; } catch (e) { return false; } },
  /** Höhenprofil als Fläche (für den Aufmacher ohne Foto und Karte). */
  eleSvg(pts) {
    const src = pts.filter(p => p.ele != null && !isNaN(p.ele));
    if (src.length < 4) return '';
    const N = 90, v = [];
    for (let i = 0; i < N; i++) v.push(src[Math.round(i * (src.length - 1) / (N - 1))].ele);
    const mn = Math.min(...v), span = Math.max(Math.max(...v) - mn, 30);
    const d = v.map((e, i) => (i ? 'L' : 'M') + (i / (N - 1) * 100).toFixed(2) + ' ' + (14 - (e - mn) / span * 12).toFixed(2)).join('');
    return `<svg class="hero-ele" viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true"><path d="${d}L100 40L0 40Z"/></svg>`;
  },
  /** Kartenbild der letzten Tour; einmal erzeugt und gemerkt (kv „heroMap“), damit die Startseite sofort steht. */
  async heroMap(t, pts) {
    const memo = await DB.kvGet('heroMap', null);
    if (memo && memo.id === t.id && memo.n === pts.length && memo.data) return memo.data;
    const data = await tileMapImage(t, pts, { w: 800, h: 900, pad: 80, padTop: 130, padBottom: 390, dim: .06 });
    DB.kvSet('heroMap', { id: t.id, n: pts.length, data }).catch(() => {});
    return data;
  },
};

/* ---- Aufmacher: die letzte Tour, randlos bis an den oberen Rand ---- */
Home.add('hero', 0, async ({ all }) => {
  const t = all[0], pts = await Tours.points(t.id);
  const hero = h('a', { class: 'hero', id: 'hero', href: '#/tour/' + t.id, 'aria-label': 'Letzte Tour öffnen: ' + t.name });
  const drawn = () => {      // ohne Foto und ohne Karte: echte Daten der Tour – Strecke in Gelb über ihrem Höhenprofil
    hero.classList.remove('pic');
    hero.querySelectorAll('.hero-img').forEach(e => e.remove());
    if (!hero.querySelector('.hero-route') && pts.length > 1) {
      hero.insertAdjacentHTML('afterbegin', Home.eleSvg(pts) + '<div class="hero-route">' +
        previewSvg(pts, '#f2c230', { w: 360, h: 170, pad: 24, sw: 3.2, ends: 5, endsA: '#114042' }).replace('width="360" height="170"', 'preserveAspectRatio="xMidYMid meet"') + '</div>');
    }
  };
  const picture = (src, next) => {
    const img = h('img', { class: 'hero-img', alt: '', src });
    img.onerror = () => { img.remove(); next(); };
    hero.classList.add('pic'); hero.prepend(img);
  };
  const map = () => { drawn(); if (pts.length > 1) Home.heroMap(t, pts).then(d => { if (hero.isConnected) { hero.querySelectorAll('.hero-route,.hero-ele').forEach(e => e.remove()); picture(d, drawn); } }).catch(() => {}); };
  const ph = await pickPhoto(t.id).catch(() => null);
  if (ph) picture(Photos.url(ph.id), map); else map();
  hero.append(
    h('span', { class: 'brand', html: Ico.svg('peak', 26) + '<span>Tourentagebuch</span>' }),
    h('span', { class: 'hero-t' },
      h('small', null, 'Zuletzt: ' + F.date(t.start) + ' · ' + Sports.label(t.sport)),
      h('h2', null, t.name),
      h('span', { class: 'hero-k' }, UI.num(F.km(t.dist)), UI.num('↑ ' + F.m(t.up)), t.dur ? UI.num(F.dur(t.dur)) : null)));
  return hero;
});

/* ---- Die drei Hauptaktionen ---- */
Home.add('actions', 10, async () => h('div', { class: 'home-acts' },
  Home.live() ? UI.sign('Aufzeichnung läuft – öffnen', { href: '#/rec', id: 'startrec', cls: 'live' }) : UI.sign('Aufzeichnung starten', { href: '#/rec', id: 'startrec' }),
  h('div', { class: 'acts' },
    h('a', { class: 'btn', id: 'startplan', href: '#/plan', html: Ico.svg('route') + '<span>Tour planen</span>' }),
    h('a', { class: 'btn', id: 'startimport', href: '#/import', html: Ico.svg('download') + '<span>Importieren</span>' }))));

/* ---- Dieses Jahr: Strecke, Touren, Aufstieg; Monate als Balken; Jahresziele ---- */
Home.add('year', 20, async ({ all, now, year: yr }) => {
  const inYear = (t, y) => new Date(t.start).getFullYear() === y;
  const tillToday = (t, y) => inYear(t, y) && new Date(t.start) <= new Date(y, now.getMonth(), now.getDate(), 23, 59, 59);
  const goals = (await DB.kvGet('goals', {}))[yr] || {};
  const sum = (ts, k) => ts.reduce((a, t) => a + (t[k] || 0), 0);
  const cmp = (a, b) => {
    if (!a || !b) return null;      // leeres Jahr: kein „−100 %“ anzeigen
    const d = Math.round((a - b) / b * 100);
    return h('p', { class: 'hcmp ' + (d >= 0 ? 'up' : 'down') }, (d >= 0 ? d + ' % mehr' : -d + ' % weniger') + ' Strecke als ' + (yr - 1) + ' um diese Zeit');
  };
  // Zielfortschritt wie in der Statistik: Soll heute = Anteil des Jahres, der bis jetzt vergangen ist
  const frac = Math.min(1, Math.max(0, (Date.now() - new Date(yr, 0, 1)) / (new Date(yr + 1, 0, 1) - new Date(yr, 0, 1))));
  const nf = v => Math.round(v).toLocaleString('de-DE');
  const goalRow = (lab, c, goal, unit) => h('div', { class: 'ygoal' }, h('span', null, lab), h('em', null, Math.round(c / goal * 100) + ' %'),
    UI.bar(c / goal, { mark: frac }), h('small', null, nf(c) + ' von ' + nf(goal) + unit));
  const used = [...new Set(all.filter(t => inYear(t, yr)).map(t => t.sport))];
  let sport = '';      // nur Seitenzustand: filtert allein diesen Abschnitt
  const chips = UI.chips([]), box = h('div');
  const draw = () => {
    const ok = t => !sport || t.sport === sport;
    const cur = all.filter(t => inYear(t, yr) && ok(t)), prev = all.filter(t => tillToday(t, yr - 1) && ok(t));
    chips.innerHTML = ''; box.innerHTML = '';
    chips.hidden = used.length < 2;      // bei nur einer Sportart gäbe es nichts zu wählen
    if (used.length > 1) {
      chips.append(UI.chip('Alle', !sport, () => { sport = ''; draw(); }));
      Sports.list.filter(s => used.includes(s[0])).forEach(s => chips.append(UI.chip(s[1], sport === s[0], () => { sport = sport === s[0] ? '' : s[0]; draw(); })));
    }
    const mon = Array(12).fill(0);
    cur.forEach(t => { mon[new Date(t.start).getMonth()] += t.dist; });
    const mx = Math.max(...mon, 1), nowM = now.getMonth();
    const gl = [['km', 'Strecke', sum(cur, 'dist') / 1000, ' km'], ['up', 'Aufstieg', sum(cur, 'up'), ' m'], ['n', 'Touren', cur.length, '']].filter(g => goals[g[0]] > 0);
    box.append(UI.figs([[F.km(sum(cur, 'dist')), 'Strecke'], [cur.length, cur.length === 1 ? 'Tour' : 'Touren'], ['↑ ' + F.m(sum(cur, 'up')), 'Aufstieg']], { big: true }));
    if (cur.length) {
      const c = cmp(sum(cur, 'dist'), sum(prev, 'dist')); if (c) box.append(c);
      box.append(h('div', { class: 'bars', role: 'img', 'aria-label': 'Strecke je Monat' }, mon.map((v, i) => h('div', { class: 'bar' + (i === nowM ? ' now' : '') },
        h('i', { style: { height: Math.max(v ? 6 : 2, v / mx * 100) + '%' }, title: F.km(v) }), h('small', null, 'JFMAMJJASOND'[i])))));
    } else box.append(h('p', { class: 'muted' }, yr + ' steht noch keine Tour im Tagebuch.'));
    box.append(gl.length ? h('div', { class: 'ygoals' }, gl.map(g => goalRow(g[1], g[2], goals[g[0]], g[3])), h('a', { class: 'ylink', href: '#/stats/ziele' }, 'Ziele ändern'))
      : h('a', { class: 'ylink', id: 'yset', href: '#/stats/ziele' }, 'Ziele für ' + yr + ' festlegen'));
  };
  draw();
  return UI.section('Dieses Jahr', [chips, box], { cls: 'year', id: 'year', link: '#/stats', linkText: 'Statistik' });
});

/* ---- Letzte Touren (die allerletzte steht schon oben) ---- */
Home.add('recent', 40, async ({ all }) => {
  if (all.length < 2) return null;
  const memo = await DB.kvGet('tilebg', {});
  return UI.section('Letzte Touren', h('div', { class: 'recent' }, all.slice(1, 5).map(t => UI.tourRow(t, { year: true, memo }))),
    { id: 'recent', link: '#/', linkText: 'Alle ' + all.length });
});

/* ---- An diesem Tag: Touren vom gleichen Kalendertag früherer Jahre ---- */
Home.add('memo', 50, async ({ all, now, year }) => {
  const dd = now.getDate(), mm = now.getMonth();
  const memo = all.filter(t => { const d = new Date(t.start); return d.getDate() === dd && d.getMonth() === mm && d.getFullYear() < year; });
  if (!memo.length) return null;
  return UI.section('An diesem Tag', UI.list(memo.slice(0, 5).map(t => UI.row({ icon: Sports.icon(t.sport), title: t.name, sub: new Date(t.start).getFullYear() + ' · ' + F.km(t.dist), href: '#/tour/' + t.id }))), { id: 'memo' });
});

Views['/start'] = async root => {
  const all = (await Tours.list()).filter(t => t.status !== 'planned' && !t.hidden);
  if (!all.length) {      // noch nichts im Tagebuch: sagen, wie es losgeht
    root.append(topbar('Tourentagebuch', { logo: true }), h('div', { class: 'pad' }, welcomeHero()));
    return;
  }
  const body = h('div', { class: 'home' });
  root.append(body);
  const now = new Date(), ctx = { all, now, year: now.getFullYear() };
  for (const b of Home.blocks) {
    try { const el = await b.fn(ctx); if (el) body.append(el); }
    catch (e) { console.error('Baustein ' + b.id, e); }      // ein kaputter Baustein nimmt nicht die ganze Startseite mit
  }
};
