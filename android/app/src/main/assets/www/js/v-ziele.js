'use strict';
/* Ziele: Jahres- und Wochenziele mit Balken und Prognose. Gepflegt wird an EINER Stelle: Statistik → Ziele.
   Angezeigt werden sie dort und auf der Startseite im Abschnitt „Dieses Jahr“. Gerechnet wird in js/calc-ziele.js.
   Gespeichert: kv „goals2“ = Liste {id, period: year|week, year, metric: km|up|count|hours, target, sport}.
   Ältere Jahresziele (kv „goals“ = {Jahr: {km, up, n}}) werden weiter gelesen und beim ersten Ändern in die neue Liste übernommen. */
const Goals = {
  nf: (v, dec) => v.toLocaleString('de-DE', { maximumFractionDigits: dec || 0, minimumFractionDigits: 0 }),
  /** Alle Ziele (neue Liste, sonst die älteren Jahresziele). */
  async list() {
    const g2 = await DB.kvGet('goals2', null);
    if (Array.isArray(g2)) return g2.map(Ziele.sauber).filter(Boolean);
    return Ziele.legacy(await DB.kvGet('goals', {}));
  },
  async save(list) { await DB.kvSet('goals2', list); },
  /** Ziele aus einer Sicherung ergänzen (key: 'goals' älteres Format, 'goals2' neues). true, wenn sich etwas geändert hat. */
  async mergeFrom(key, v) {
    const cur = await Goals.list(), merged = Ziele.zusammen(cur, key === 'goals' ? Ziele.legacy(v) : (Array.isArray(v) ? v : []));
    if (merged.length === cur.length) return false;
    await Goals.save(merged); return true;
  },
  sportName(s) { return !s ? '' : StatGruppen.istGruppe(s) ? StatGruppen.name(s, StatGruppen.aktuell()) + (StatGruppen.gueltig(s, StatGruppen.aktuell()) ? ' (zusammengefasst)' : '') : s === 'grp:bike' ? 'Rad (alle Arten)' : s === 'grp:foot' ? 'Wandern und Bergsteigen' : s === 'grp:ski' || s === 'ski' ? 'Ski (alle Arten)' : s === 'grp:run' ? 'Laufen (alle Arten)' : Sports.label(s); },
  name(g) { const m = Ziele.METRIKEN.find(x => x[0] === g.metric); return m[1] + (g.period === 'week' ? ' pro Woche' : '') + ' · ' + (g.sport ? Goals.sportName(g.sport) : 'Alle Sportarten'); },
  /** Zahl mit Einheit: „740 km“, „12.400 m“, „8 Touren“, „6,5 h“. */
  dec: g => (g.metric === 'hours' || (g.metric === 'km' && g.target < 50) ? 1 : 0),
  fmt(v, g) {
    return Goals.nf(v, Goals.dec(g)) + ({ km: ' km', up: ' m', count: Math.round(v) === 1 ? ' Tour' : ' Touren', hours: ' h' }[g.metric]);
  },
  /** Satz zum Stand: in Worten, nie nur Farbe. */
  text(g, s) {
    const f = v => Goals.fmt(v, g);
    if (s.status === 'erreicht') return 'Ziel erreicht' + (s.ist > g.target ? ' · ' + f(s.ist - g.target) + ' darüber' : '');
    if (g.period === 'week') return s.restTage === 0 ? 'Heute ist der letzte Tag der Woche.' : 'Noch ' + f(g.target - s.ist) + ' in ' + (s.restTage === 1 ? '1 Tag' : s.restTage + ' Tagen');
    if (s.status === 'verfehlt') return 'Nicht erreicht · es fehlten ' + f(g.target - s.ist);
    if (s.status === 'offen') return g.year > new Date().getFullYear() ? 'Dieses Jahr hat noch nicht begonnen.' : 'Prognose ab dem 14. Tag des Jahres';
    const w = { im_plan: 'Im Plan', knapp: 'Knapp', dahinter: 'Dahinter' }[s.status];
    return w + ' · Prognose zum Jahresende: ' + f(s.prognose);
  },
  /** Zeile mit Name, „740 / 800 km“, Balken und Satz. opts.onclick macht sie antippbar (Ändern). */
  row(g, tours, now, opts) {
    const s = Ziele.stand(g, tours, now);
    const kids = [h('span', null, Goals.name(g)), h('em', null, Goals.nf(s.ist, Goals.dec(g)) + ' / ' + Goals.fmt(g.target, g)),
      UI.bar(s.anteil, g.period === 'year' && g.year === now.getFullYear() && s.soll != null ? { mark: s.soll / g.target, title: 'Soll heute' } : null), h('small', null, Goals.text(g, s))];
    return opts && opts.onclick ? h('button', { class: 'ygoal tap', 'aria-label': Goals.name(g) + ' ändern', onclick: opts.onclick }, kids) : h('div', { class: 'ygoal' }, kids);
  },
  /** Blatt zum Anlegen oder Ändern. goal = null: neues Ziel mit den Vorgaben `pre` ({period, year}). done() nach dem Speichern oder Löschen. */
  edit(goal, pre, done) {
    const nowY = new Date().getFullYear(), g = Object.assign({ period: 'year', year: nowY, metric: 'km', target: '', sport: '' }, pre || {}, goal || {});
    if (g.sport === 'ski') g.sport = 'grp:ski';      // altes Ziel „Ski“ (vor 2.2.0): Gruppe aller Skiarten
    const err = h('p', { class: 'err small', role: 'alert' }), val = h('input', { type: 'text', inputmode: 'decimal', id: 'goalval', 'aria-label': 'Zielwert', value: g.target === '' ? '' : String(g.target).replace('.', ','), placeholder: 'z. B. 800' });
    const unit = h('span', { class: 'muted' }), yearSel = h('select', { id: 'goalyear', 'aria-label': 'Jahr', onchange: e => { g.year = +e.target.value; } }, [nowY - 1, nowY, nowY + 1].map(y => h('option', { value: y, selected: y === g.year }, y)));
    const segBox = h('div'), metBox = h('div'), yearBox = h('label', { class: 'fld' }, 'Jahr', yearSel);
    const draw = () => {
      segBox.innerHTML = ''; metBox.innerHTML = '';
      segBox.append(UI.seg([['year', 'Jahresziel'], ['week', 'Wochenziel']], g.period, k => { g.period = k; draw(); }, { label: 'Zeitraum' }));
      metBox.append(UI.chips(Ziele.METRIKEN.map(m => UI.chip(m[1], g.metric === m[0], () => { g.metric = m[0]; draw(); })), { wrap: true, id: 'goalmetric' }));
      yearBox.hidden = g.period === 'week';
      unit.textContent = ({ km: 'km', up: 'Meter Aufstieg', count: 'Touren', hours: 'Stunden' }[g.metric]) + (g.period === 'week' ? ' pro Woche' : ' im Jahr');
    };
    const opt = ([v, l]) => h('option', { value: v, selected: v === g.sport }, l), gr = StatGruppen.aktuell();
    const sportSel = h('select', { id: 'goalsport', 'aria-label': 'Sportart', onchange: e => { g.sport = e.target.value; } }, opt(['', 'Alle Sportarten']),
      // 2.19.0: feste Gruppen nur noch für vorhandene Ziele; eigene Statistik-Gruppen; ein Ziel mit gelöschter Gruppe bleibt sichtbar (zählt keine Tour); jede Aktivität nach Kategorien
      [['grp:bike', 'Rad (alle Arten)'], ['grp:foot', 'Wandern und Bergsteigen'], ['grp:ski', 'Ski (alle Arten)'], ['grp:run', 'Laufen (alle Arten)']].filter(([v]) => v === g.sport).map(opt),
      gr.length || (StatGruppen.istGruppe(g.sport) && !StatGruppen.gueltig(g.sport, gr)) ? h('optgroup', { label: 'Zusammengefasst' }, StatGruppen.auswahl(gr).map(opt),
        StatGruppen.istGruppe(g.sport) && !StatGruppen.gueltig(g.sport, gr) ? opt([g.sport, 'Gelöschte Gruppe']) : null) : null,
      Sports.kategorien().map(([kid, knm, list]) => h('optgroup', { label: knm }, list.map(s => opt([s[0], s[1]])))));
    draw();
    const s = sheet(goal ? 'Ziel ändern' : 'Neues Ziel', h('div', null, segBox, yearBox, h('div', { class: 'fld' }, 'Messgröße', metBox), h('label', { class: 'fld' }, 'Sportart', sportSel),
      h('label', { class: 'fld' }, 'Zielwert', val), h('p', { class: 'muted small', style: { marginTop: '-8px' } }, unit), err,
      h('div', { class: 'row end wrap' },
        goal ? h('button', { class: 'btn danger', id: 'goaldel', onclick: async () => {
          if (!await confirmBox('Ziel löschen?', Goals.name(goal) + (goal.period === 'year' ? ' ' + goal.year : '') + ' wird gelöscht. Deine Touren bleiben.', 'Löschen')) return;
          await Goals.save((await Goals.list()).filter(x => x.id !== goal.id)); s.close(); toast('Ziel gelöscht'); done && done();
        } }, 'Löschen') : null,
        h('button', { class: 'btn pri', id: 'goalsave', onclick: async () => {
          const t = parseFloat(String(val.value).replace(/\./g, '').replace(',', '.').trim());
          const ng = Ziele.sauber({ id: goal ? goal.id : 'g' + uid(), period: g.period, year: g.period === 'week' ? 0 : g.year, metric: g.metric, target: t, sport: g.sport });
          if (!ng || !(t > 0)) { err.textContent = 'Bitte einen Zielwert über 0 eingeben (zum Beispiel 800).'; val.focus(); return; }
          const list = await Goals.list(), same = list.find(x => x.id !== ng.id && x.period === ng.period && x.year === ng.year && x.metric === ng.metric && x.sport === ng.sport);
          if (same) ng.id = same.id;      // dasselbe Ziel gibt es schon: es wird geändert, nicht doppelt angelegt
          const out = list.filter(x => x.id !== ng.id && x.id !== (goal && goal.id)); out.push(ng);
          await Goals.save(out); s.close(); toast(same ? 'Das Ziel gab es schon – es wurde geändert.' : 'Ziel gespeichert'); done && done();
        } }, 'Speichern'))));
    setTimeout(() => val.focus(), 250);
    return s;
  },
};

/* ---- Statistik → Ziele: die eine Stelle zum Pflegen ---- */
Ausw.ziele = async function (body, ts, ctx) {
  const now = new Date(), nowY = now.getFullYear();
  let y = nowY;
  const wrap = h('div', { id: 'goals' }); body.append(wrap);
  const draw = async () => {
    wrap.innerHTML = '';
    wrap.append(UI.seg([nowY - 1, nowY, nowY + 1].map(v => [v, String(v)]), y, v => { y = v; draw(); }, { label: 'Jahr' }));
    const goals = await Goals.list(), mine = Ziele.fuerJahr(goals, y, nowY), yr = mine.filter(g => g.period === 'year'), wk = mine.filter(g => g.period === 'week');
    const edit = g => () => Goals.edit(g, { year: y }, draw);
    if (!mine.length) {
      wrap.append(UI.empty({ icon: 'target', title: 'Noch kein Ziel für ' + y, text: 'Setz dir zum Beispiel 800 km im Jahr oder 2 Touren pro Woche. Der Balken zeigt, wo du heute stehen müsstest.',
        actions: [h('button', { class: 'btn pri', id: 'goaladd', onclick: () => Goals.edit(null, { year: y }, draw) }, 'Ziel festlegen')] }));
      return;
    }
    if (yr.length) wrap.append(UI.section('Jahresziele ' + y, yr.map(g => Goals.row(g, ctx.all, now, { onclick: edit(g) })), { sub: 'Der Strich im Balken zeigt, wo du heute stehen müsstest.' }));
    if (wk.length) wrap.append(UI.section('Wochenziele', wk.map(g => Goals.row(g, ctx.all, now, { onclick: edit(g) })), { sub: 'Eine Woche geht von Montag bis Sonntag.' }));
    wrap.append(h('div', { class: 'row' }, h('button', { class: 'btn', id: 'goaladd', onclick: () => Goals.edit(null, { year: y }, draw) }, 'Ziel hinzufügen')));
  };
  await draw();
};
