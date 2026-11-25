'use strict';
Views['/stats'] = async (root, [tab0]) => {
  const all = (await Tours.list()).filter(Jahr.zaehlt);      // gleiche Filterregel und Kennzahlen wie der Jahresrückblick (calc-jahr.js)
  const years = [...new Set(all.map(t => new Date(t.start).getFullYear()))].sort((a, b) => b - a);
  let year = years[0] || new Date().getFullYear(), sport = '', tab = ['ueber', 'rekorde', 'vergleich', 'kalender', 'auswertung', 'ziele', 'fitness'].includes(tab0) ? tab0 : tab0 === 'bestwerte' ? 'rekorde' : 'ueber';
  const gr = StatGruppen.aktuell();      // 2.19.0: eigene Statistik-Gruppen (Einstellungen → Sportarten → Statistik-Gruppen)
  const body = h('div', { class: 'pad' });
  root.append(topbar('Statistik', { back: true }), body);
  const draw = () => {
    body.innerHTML = '';
    const sel = h('select', { 'aria-label': 'Zeitraum', id: 'st-year', onchange: e => { year = e.target.value === 'all' ? 'all' : +e.target.value; draw(); } }, h('option', { value: 'all', selected: year === 'all' }, 'Gesamte Zeit'), years.map(y => h('option', { value: y, selected: y === year }, y)));
    // 2.19.0: jede Sportart einzeln (nach Kategorien), dazu die selbst angelegten Statistik-Gruppen; keine festen Gruppen mehr („Ski (alle Arten)“ entfällt)
    // 2.20.0: Chips statt Auswahlliste – dasselbe Muster „Sportart filtern“ wie Karte und Tourenliste (UI.sportChips), nur Sportarten mit Touren
    if (!StatGruppen.gueltig(sport, gr)) sport = '';
    const ss = UI.chips(UI.sportChips(StatGruppen.chipAuswahl(all.map(t => t.sport), gr), sport, k => { sport = k; draw(); }), { id: 'st-sport-f' });
    ss.setAttribute('role', 'group'); ss.setAttribute('aria-label', 'Sportart');
    if (tab === 'vergleich') body.append(ss);      // 2.13.0: der Vergleich wählt seine zwei Jahre selbst; die Sportart gilt
    else if (tab !== 'ziele' && tab !== 'fitness') body.append(h('div', { class: 'row' }, sel), ss);      // Zeitraum und Sportart gelten dort nicht: Ziele haben ihr eigenes Jahr und ihre eigene Sportart
    const ts = all.filter(t => (year === 'all' || new Date(t.start).getFullYear() === year) && Sports.passt(sport, t.sport, gr));
    body.append(UI.chips([['ueber', 'Übersicht'], ['rekorde', 'Bestwerte'], ['vergleich', 'Vergleich'], ['kalender', 'Kalender'], ['auswertung', 'Auswertung'], ['ziele', 'Ziele'], ['fitness', 'Fitness']].map(([k, l]) => UI.chip(l, tab === k, () => { tab = k; draw(); }))));
    const onChip = $('.chips .chip.on', body); if (onChip) onChip.parentNode.scrollLeft = Math.max(0, onChip.offsetLeft - 120);      // gewählten Reiter in Sicht holen
    if (tab !== 'ueber') { const r = Ausw[tab](body, ts, { all, year, sport }); return r; }
    if (!ts.length) { body.append(UI.empty({ icon: 'chart', title: 'Keine Touren in diesem Zeitraum', text: 'Wähle oben ein anderes Jahr oder eine andere Sportart.' })); return; }
    const k = Jahr.kennzahlen(ts);
    body.append(h('div', { class: 'kpis' },
      kpi(k.n, 'Touren'), kpi(F.km(k.dist), 'Strecke'), kpi(F.m(k.up), 'Aufstieg'), kpi(F.dur(k.zeit), 'Dauer'), kpi(k.tage, 'Aktive Tage'),
      kpi(F.km(k.dist / k.n), 'Ø pro Tour')));
    // Monatsbalken
    const mon = Array(12).fill(0); ts.forEach(t => { if (year !== 'all') mon[new Date(t.start).getMonth()] += t.dist; });
    if (year !== 'all') {
      const mx = Math.max(...mon, 1);
      body.append(h('h3', null, 'Strecke je Monat'), h('div', { class: 'bars' }, mon.map((v, i) => h('div', { class: 'bar' }, h('i', { style: { height: (v / mx * 100) + '%' }, title: F.km(v) }), h('small', null, 'JFMAMJJASOND'[i])))));
    } else {
      const by = {}; ts.forEach(t => { const y = new Date(t.start).getFullYear(); by[y] = (by[y] || 0) + t.dist; });
      const mx = Math.max(...Object.values(by), 1);
      body.append(h('h3', null, 'Strecke je Jahr'), h('div', { class: 'hbars' }, Object.keys(by).sort().reverse().map(y => h('div', { class: 'hb' }, h('span', null, y), h('div', null, h('i', { style: { width: (by[y] / mx * 100) + '%' } })), h('b', null, F.km(by[y]))))));
    }
    const bs = {}; ts.forEach(t => { const k = StatGruppen.schluessel(t.sport, gr); bs[k] = (bs[k] || 0) + t.dist; });      // 2.19.0: Gruppenmitglieder in einer Zeile
    const tot = Object.values(bs).reduce((a, b) => a + b, 0) || 1;
    body.append(h('h3', null, 'Sportarten'), h('div', { class: 'hbars', id: 'st-sport' }, Object.entries(bs).sort((a, b) => b[1] - a[1]).map(([k, v]) => h('div', { class: 'hb', 'data-sport': k, title: StatGruppen.titel(k, gr) || null }, h('span', null, StatGruppen.icon(k, gr) + ' ' + StatGruppen.beschriftung(k, gr)), h('div', null, h('i', { style: { width: (v / tot * 100) + '%', background: MapKit.sportColor[StatGruppen.farbSport(k, gr)] } })), h('b', null, F.km(v))))));
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
  };
  const kpi = (v, l) => UI.fig(v, l);
  draw();
};
