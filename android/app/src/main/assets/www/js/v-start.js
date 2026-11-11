'use strict';
/* Startseite: zuletzt unterwegs, das laufende Jahr, die letzten Touren und Erinnerungen.
   Gleicher Aufbau wie die Startseite von „Meine Touren“, nur für das Hochformat des Handys. */

Views['/start'] = async root => {
  const all = (await Tours.list()).filter(t => t.status !== 'planned' && !t.hidden);
  const body = h('div', { class: 'pad home' });
  root.append(topbar('Mein Tourentagebuch'), body);
  if (!all.length) {
    body.append(h('div', { class: 'empty hero' }, h('div', { class: 'big' }, '⛰'), h('h2', null, 'Willkommen im Tourentagebuch'),
      h('p', null, 'Alle Touren und Fotos bleiben auf deinem Handy. Hol deine bisherigen Touren herein oder starte gleich eine neue.'),
      h('div', { class: 'col' }, h('a', { class: 'btn pri', href: '#/import' }, 'Touren importieren'),
        h('a', { class: 'btn', href: '#/rec' }, 'Aufzeichnung starten'), h('a', { class: 'btn', href: '#/plan' }, 'Tour planen'))));
    return;
  }

  // ---- Aufmacher: die zuletzt gegangene Tour, blätterbar
  let at = 0;
  const hero = h('div', { class: 'card hero' });
  const drawHero = async () => {
    const t = all[at];
    const pts = await Tours.points(t.id);
    const ph = (await DB.byIndex('photos', 'tour', t.id))[0];
    const col = MapKit.sportColor[t.sport] || '#17494a';
    hero.innerHTML = '';
    const pic = h('div', { class: 'heropic' });
    if (ph) pic.append(h('img', { src: Photos.thumb(ph.id), alt: '', loading: 'lazy' }));
    else if (pts.length > 1) pic.innerHTML = previewSvg(pts, col, { w: 360, h: 170, pad: 18, sw: 2.6 }).replace('width="360" height="170"', 'width="100%" height="100%"');
    const met = (v, l) => h('div', { class: 'hm' }, h('b', null, v), h('small', null, l));
    hero.append(pic, h('div', { class: 'herob' },
      h('div', { class: 'sub' }, 'Zuletzt unterwegs · ' + Sports.label(t.sport)),
      h('h2', null, t.name),
      h('div', { class: 'sub' }, F.date(t.start) + (t.timed ? ' · ' + F.time(t.start) : '')),
      h('div', { class: 'hmets' }, met(F.km(t.dist), 'Strecke'), met(F.m(t.up), 'Aufstieg'), met(t.dur ? F.dur(t.dur) : '–', 'Dauer'),
        t.hrAvg ? met(t.hrAvg + ' bpm', 'Ø Puls') : null),
      h('div', { class: 'row' }, h('a', { class: 'btn pri sm', href: '#/tour/' + t.id }, 'Tour ansehen'),
        h('span', { class: 'sp' }),
        h('button', { class: 'ico', 'aria-label': 'Vorherige', onclick: () => { at = (at + 1) % all.length; drawHero(); } }, '‹'),
        h('small', { class: 'muted' }, (at + 1) + ' / ' + all.length),
        h('button', { class: 'ico', 'aria-label': 'Nächste', onclick: () => { at = (at - 1 + all.length) % all.length; drawHero(); } }, '›'))));
  };
  body.append(hero);
  await drawHero();

  // ---- Dein Jahr: Zahlen bis heute, im Vergleich zum Vorjahr, dazu die Monate als Balken
  const now = new Date(), yr = now.getFullYear();
  const cut = new Date(yr, now.getMonth(), now.getDate(), 23, 59, 59).getTime();
  const inYear = (t, y) => new Date(t.start).getFullYear() === y;
  const tillToday = (t, y) => inYear(t, y) && t.start <= cut - (yr - y) * 0 && new Date(t.start) <= new Date(y, now.getMonth(), now.getDate(), 23, 59, 59);
  const cur = all.filter(t => inYear(t, yr)), prev = all.filter(t => tillToday(t, yr - 1));
  const sum = (ts, k) => ts.reduce((a, t) => a + (t[k] || 0), 0);
  const cmp = (a, b) => {
    if (!b) return null;
    const d = Math.round((a - b) / b * 100);
    return h('small', { class: 'hcmp ' + (d >= 0 ? 'up' : 'down') }, (d >= 0 ? '+' : '') + d + ' % ggü. ' + (yr - 1));
  };
  const mon = Array(12).fill(0);
  cur.forEach(t => { mon[new Date(t.start).getMonth()] += t.dist; });
  const mx = Math.max(...mon, 1);
  body.append(h('h3', null, 'Dein Jahr ' + yr),
    h('div', { class: 'card pad' },
      h('div', { class: 'kpis' },
        h('div', { class: 'kpi' }, h('b', null, cur.length), h('small', null, 'Touren')),
        h('div', { class: 'kpi' }, h('b', null, F.km(sum(cur, 'dist'))), h('small', null, 'Strecke')),
        h('div', { class: 'kpi' }, h('b', null, F.m(sum(cur, 'up'))), h('small', null, 'Aufstieg'))),
      cmp(sum(cur, 'dist'), sum(prev, 'dist')),
      h('div', { class: 'bars mt8' }, mon.map((v, i) => h('div', { class: 'bar' },
        h('i', { style: { height: (v / mx * 100) + '%' }, title: F.km(v) }), h('small', null, 'JFMAMJJASOND'[i]))))));

  // ---- Die letzten Touren als Karten
  const grid = h('div', { class: 'hgrid' });
  const io = new IntersectionObserver(es => es.forEach(async e => {
    if (!e.isIntersecting) return; io.unobserve(e.target);
    const pts = await Tours.points(e.target.__t.id);
    if (pts.length > 1) e.target.innerHTML = previewSvg(pts, MapKit.sportColor[e.target.__t.sport] || '#17494a', { w: 160, h: 76, pad: 10, sw: 2.2 }).replace('width="160" height="76"', 'width="100%" height="100%"');
  }), { rootMargin: '200px' });
  all.slice(0, 6).forEach(t => {
    const pv = h('div', { class: 'pv' }); pv.__t = t; io.observe(pv);
    grid.append(h('a', { class: 'card hcard', href: '#/tour/' + t.id }, pv,
      h('div', { class: 'tb' }, h('b', null, t.name), h('small', null, F.dshort(t.start) + ' · ' + F.km(t.dist) + (t.hrAvg ? ' · ♥ ' + t.hrAvg : '')))));
  });
  body.append(h('div', { class: 'row' }, h('h3', { class: 'grow' }, 'Letzte Touren'), h('a', { class: 'small', href: '#/' }, 'Alle ' + all.length)), grid);

  // ---- An diesem Tag: Touren vom gleichen Kalendertag früherer Jahre
  const dd = now.getDate(), mm = now.getMonth();
  const memo = all.filter(t => { const d = new Date(t.start); return d.getDate() === dd && d.getMonth() === mm && d.getFullYear() < yr; });
  if (memo.length) {
    body.append(h('h3', null, 'An diesem Tag'), h('div', { class: 'list' }, memo.slice(0, 5).map(t =>
      h('a', { class: 'li', href: '#/tour/' + t.id }, h('span', { class: 'li-i' }, Sports.icon(t.sport)),
        h('span', { class: 'li-t' }, h('b', null, t.name), h('small', null, new Date(t.start).getFullYear() + ' · ' + F.km(t.dist)))))));
  }
  return () => io.disconnect();
};
