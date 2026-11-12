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
    hero.innerHTML = '';
    // Mit Foto: das Foto. Ohne Foto: die Strecke in Gelb über Höhenlinien auf Tannengrün.
    const pic = h('div', { class: 'heropic' + (ph ? ' foto' : '') });
    if (ph) pic.append(h('img', { src: Photos.thumb(ph.id), alt: '', loading: 'lazy' }));
    else if (pts.length > 1) pic.innerHTML = previewSvg(pts, '#f2c230', { w: 360, h: 140, pad: 22, sw: 3.4, ends: 5.5, endsA: '#0e2a2b' }).replace('width="360" height="140"', 'width="100%" height="100%"');
    pic.append(h('div', { class: 'herotit' },
      h('span', { class: 'herotag' }, 'Zuletzt unterwegs'),
      h('h2', null, t.name),
      h('div', { class: 'herosub' }, Sports.icon(t.sport) + ' ' + Sports.label(t.sport) + ' · ' + F.date(t.start) + (t.timed ? ' · ' + F.time(t.start) : ''))));
    const met = (v, l) => h('div', { class: 'hm' }, h('b', null, v), h('small', null, l));
    hero.append(pic, h('div', { class: 'herob' },
      h('div', { class: 'hmets' }, met(F.km(t.dist), 'Strecke'), met(F.m(t.up), 'Aufstieg'), met(t.dur ? F.dur(t.dur) : '–', 'Dauer'),
        t.hrAvg ? met(t.hrAvg + ' bpm', 'Ø Puls') : null),
      h('div', { class: 'row heronav' }, h('a', { class: 'btn pri', href: '#/tour/' + t.id }, 'Tour ansehen'),
        h('span', { class: 'sp' }),
        h('button', { class: 'ico', 'aria-label': 'Vorherige', onclick: () => { at = (at + 1) % all.length; drawHero(); } }, '‹'),
        h('small', { class: 'muted' }, (at + 1) + ' / ' + all.length),
        h('button', { class: 'ico', 'aria-label': 'Nächste', onclick: () => { at = (at - 1 + all.length) % all.length; drawHero(); } }, '›'))));
  };
  body.append(hero);
  await drawHero();
  body.append(h('div', { class: 'row wrap', style: { marginTop: '10px' } }, h('a', { class: 'btn', id: 'startplan', href: '#/plan' }, '✏️ Tour planen'), h('a', { class: 'btn', href: '#/rec' }, '● Aufzeichnung starten')));

  // ---- Dein Jahr: eine große Zahl, Vergleich zum Vorjahr, Monate als Balken
  const now = new Date(), yr = now.getFullYear();
  const inYear = (t, y) => new Date(t.start).getFullYear() === y;
  const tillToday = (t, y) => inYear(t, y) && new Date(t.start) <= new Date(y, now.getMonth(), now.getDate(), 23, 59, 59);
  const cur = all.filter(t => inYear(t, yr)), prev = all.filter(t => tillToday(t, yr - 1));
  const sum = (ts, k) => ts.reduce((a, t) => a + (t[k] || 0), 0);
  const cmp = (a, b) => {
    if (!b) return null;
    const d = Math.round((a - b) / b * 100);
    return h('span', { class: 'hcmp ' + (d >= 0 ? 'up' : 'down') }, (d >= 0 ? '▲ +' : '▼ ') + d + ' % ggü. ' + (yr - 1));
  };
  const mon = Array(12).fill(0);
  cur.forEach(t => { mon[new Date(t.start).getMonth()] += t.dist; });
  const mx = Math.max(...mon, 1), nowM = now.getMonth();
  body.append(h('h3', null, 'Dein Jahr ' + yr),
    h('div', { class: 'card year' },
      h('div', { class: 'ybig' }, h('b', null, (sum(cur, 'dist') / 1000).toFixed(sum(cur, 'dist') < 1e5 ? 1 : 0).replace('.', ',')), h('span', null, 'km'), cmp(sum(cur, 'dist'), sum(prev, 'dist'))),
      h('div', { class: 'ysm' }, h('div', null, h('b', null, cur.length), h('small', null, cur.length === 1 ? 'Tour' : 'Touren')), h('div', null, h('b', null, F.m(sum(cur, 'up'))), h('small', null, 'Aufstieg')), h('div', null, h('b', null, F.dur(sum(cur, 'moving') || sum(cur, 'dur'))), h('small', null, 'unterwegs'))),
      h('div', { class: 'bars mt8' }, mon.map((v, i) => h('div', { class: 'bar' + (i === nowM ? ' now' : '') },
        h('i', { style: { height: Math.max(v ? 6 : 2, v / mx * 100) + '%' }, title: F.km(v) }), h('small', null, 'JFMAMJJASOND'[i]))))));

  // ---- Die letzten Touren: volle Zeilen mit Streckenzeichnung, Name darf umbrechen
  const rows = h('div', { class: 'recent' });
  all.slice(0, 8).forEach(t => {
    const col = MapKit.routeColor(t.sport, '#17494a');
    const pv = h('div', { class: 'rpv' });
    rows.append(h('a', { class: 'rrow', href: '#/tour/' + t.id, style: { '--sc': col } }, pv,
      h('div', { class: 'rtx' }, h('b', null, t.name), h('small', null, Sports.icon(t.sport) + ' ' + Sports.label(t.sport) + ' · ' + F.date(t.start)),
        h('div', { class: 'rchips' }, h('span', null, F.km(t.dist)), h('span', null, '↑ ' + F.m(t.up)), t.dur ? h('span', null, F.dur(t.dur)) : null, t.hrAvg ? h('span', { class: 'hrt' }, '♥ ' + t.hrAvg) : null))));
    Tours.points(t.id).then(pts => { if (pts.length > 1) pv.innerHTML = previewSvg(pts, col, { w: 96, h: 80, pad: 10, sw: 2.6, ends: 3, endsA: '#fff' }).replace('width="96" height="80"', 'width="100%" height="100%"'); });
  });
  body.append(h('div', { class: 'row' }, h('h3', { class: 'grow' }, 'Letzte Touren'), h('a', { class: 'small', href: '#/' }, 'Alle ' + all.length + ' ›')), rows);

  // ---- An diesem Tag: Touren vom gleichen Kalendertag früherer Jahre
  const dd = now.getDate(), mm = now.getMonth();
  const memo = all.filter(t => { const d = new Date(t.start); return d.getDate() === dd && d.getMonth() === mm && d.getFullYear() < yr; });
  if (memo.length) {
    body.append(h('h3', null, 'An diesem Tag'), h('div', { class: 'list' }, memo.slice(0, 5).map(t =>
      h('a', { class: 'li', href: '#/tour/' + t.id }, h('span', { class: 'li-i' }, Sports.icon(t.sport)),
        h('span', { class: 'li-t' }, h('b', null, t.name), h('small', null, new Date(t.start).getFullYear() + ' · ' + F.km(t.dist)))))));
  }
};
