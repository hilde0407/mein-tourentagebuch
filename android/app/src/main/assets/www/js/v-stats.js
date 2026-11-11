'use strict';
Views['/stats'] = async root => {
  const all = (await Tours.list()).filter(t => t.status !== 'planned' && !t.hidden);
  const years = [...new Set(all.map(t => new Date(t.start).getFullYear()))].sort((a, b) => b - a);
  let year = years[0] || new Date().getFullYear(), sport = '';
  const body = h('div', { class: 'pad' });
  root.append(topbar('Statistik', { back: true, noMenu: true }), body);
  const draw = () => {
    body.innerHTML = '';
    const sel = h('select', { onchange: e => { year = e.target.value === 'all' ? 'all' : +e.target.value; draw(); } }, h('option', { value: 'all', selected: year === 'all' }, 'Gesamt'), years.map(y => h('option', { value: y, selected: y === year }, y)));
    const ss = h('select', { onchange: e => { sport = e.target.value; draw(); } }, h('option', { value: '' }, 'Alle Sportarten'), Sports.list.map(s => h('option', { value: s[0], selected: s[0] === sport }, s[2] + ' ' + s[1])));
    body.append(h('div', { class: 'row' }, sel, ss));
    const ts = all.filter(t => (year === 'all' || new Date(t.start).getFullYear() === year) && (!sport || t.sport === sport));
    if (!ts.length) { body.append(h('div', { class: 'empty' }, h('p', null, 'Keine Touren in diesem Zeitraum.'))); return; }
    const sum = k => ts.reduce((a, t) => a + (t[k] || 0), 0);
    const days = new Set(ts.map(t => new Date(t.start).toDateString())).size;
    body.append(h('div', { class: 'kpis' },
      kpi(ts.length, 'Touren'), kpi(F.km(sum('dist')), 'Strecke'), kpi(F.m(sum('up')), 'Aufstieg'), kpi(F.dur(sum('moving') || sum('dur')), 'Zeit unterwegs'), kpi(days, 'Aktive Tage'),
      kpi(F.km(sum('dist') / ts.length), 'Ø pro Tour')));
    // Monatsbalken
    const mon = Array(12).fill(0); ts.forEach(t => { if (year !== 'all') mon[new Date(t.start).getMonth()] += t.dist; });
    if (year !== 'all') {
      const mx = Math.max(...mon, 1);
      body.append(h('h3', null, 'Kilometer pro Monat'), h('div', { class: 'bars' }, mon.map((v, i) => h('div', { class: 'bar' }, h('i', { style: { height: (v / mx * 100) + '%' }, title: F.km(v) }), h('small', null, 'JFMAMJJASOND'[i])))));
    } else {
      const by = {}; ts.forEach(t => { const y = new Date(t.start).getFullYear(); by[y] = (by[y] || 0) + t.dist; });
      const mx = Math.max(...Object.values(by), 1);
      body.append(h('h3', null, 'Kilometer pro Jahr'), h('div', { class: 'hbars' }, Object.keys(by).sort().reverse().map(y => h('div', { class: 'hb' }, h('span', null, y), h('div', null, h('i', { style: { width: (by[y] / mx * 100) + '%' } })), h('b', null, F.km(by[y]))))));
    }
    const bs = {}; ts.forEach(t => { bs[t.sport] = (bs[t.sport] || 0) + t.dist; });
    const tot = Object.values(bs).reduce((a, b) => a + b, 0) || 1;
    body.append(h('h3', null, 'Sportarten'), h('div', { class: 'hbars' }, Object.entries(bs).sort((a, b) => b[1] - a[1]).map(([k, v]) => h('div', { class: 'hb' }, h('span', null, Sports.icon(k) + ' ' + Sports.label(k)), h('div', null, h('i', { style: { width: (v / tot * 100) + '%', background: MapKit.sportColor[k] } })), h('b', null, F.km(v))))));
    // Puls: Mittelwerte und die Zeit in den Pulszonen über alle Touren des Zeitraums
    const hts = ts.filter(t => t.hrAvg);
    if (hts.length) {
      const zone = [0, 0, 0, 0, 0];
      hts.forEach(t => (t.hrZones || []).forEach((v, i) => { zone[i] += v; }));
      const ztot = zone.reduce((a, b) => a + b, 0) || 1;
      body.append(h('h3', null, 'Puls'), h('div', { class: 'kpis' },
        kpi(Math.round(hts.reduce((a, t) => a + t.hrAvg, 0) / hts.length) + ' bpm', 'Ø Puls'),
        kpi(Math.max(...hts.map(t => t.hrMax)) + ' bpm', 'Höchster Puls'),
        kpi(hts.length, hts.length === 1 ? 'Tour mit Puls' : 'Touren mit Puls')));
      body.append(h('div', { class: 'hbars' }, zone.map((v, i) => (v ? h('div', { class: 'hb' },
        h('span', null, MapKit.hrName[i]), h('div', null, h('i', { style: { width: (v / ztot * 100) + '%', background: MapKit.hrColor[i] } })), h('b', null, F.dur(v))) : null))));
      const hard = hts.slice().sort((a, b) => b.hrAvg - a.hrAvg).slice(0, 3);
      body.append(h('div', { class: 'list' }, hard.map(t => h('a', { class: 'li', href: '#/tour/' + t.id },
        h('span', { class: 'li-i hrt' }, '♥'), h('span', { class: 'li-t' }, h('b', null, t.hrAvg + ' bpm im Schnitt'), h('small', null, t.name + ' · ' + F.dshort(t.start)))))));
    }
    const rec = (lab, fn, fmt) => { const b = ts.filter(t => fn(t) > 0).sort((a, c) => fn(c) - fn(a))[0]; return b ? h('a', { class: 'li', href: '#/tour/' + b.id }, h('span', { class: 'li-i' }, '🏆'), h('span', { class: 'li-t' }, h('b', null, lab + ': ' + fmt(b)), h('small', null, b.name + ' · ' + F.dshort(b.start)))) : null; };
    body.append(h('h3', null, 'Rekorde'), h('div', { class: 'list' },
      rec('Längste Tour', t => t.dist, t => F.km(t.dist)), rec('Meiste Höhenmeter', t => t.up, t => F.m(t.up)),
      rec('Höchster Punkt', t => t.maxAlt, t => F.m(t.maxAlt)), rec('Längste Dauer', t => t.dur, t => F.dur(t.dur)),
      rec('Schnellste Ø-Geschwindigkeit', t => t.moving ? t.dist / t.moving : 0, t => F.speed(t.dist, t.moving))));
  };
  const kpi = (v, l) => h('div', { class: 'kpi' }, h('b', null, v), h('small', null, l));
  draw();
};
