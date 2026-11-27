'use strict';
/* Fitness-Einordnung: Statistik → Fitness und (standardmäßig aus) ein Baustein der Startseite.
   Gerechnet wird in js/calc-fitness.js (Formeln und Schwellen aus „Meine Touren“ 3.44.0). ORIENTIERUNG, KEINE MEDIZINISCHE AUSSAGE.
   Das Geburtsjahr (nur das Jahr) liegt als Einstellung „birthYear“ auf diesem Handy. Es kommt in keine Diashow, keinen GPX-Export und keinen Teilen-Text;
   nur die eigene Sicherung (.mtl) nimmt die Einstellungen mit, damit sie nach einem Gerätewechsel wieder da sind. */
const FitUI = {
  _hist: new Map(),
  year() { const y = parseInt(Set_.get('birthYear'), 10); return y > 1800 ? y : null; },
  /** Touren der letzten 24 Wochen im Format von Fitness.berechne (Pulsverlauf nur für Touren mit Puls, gemerkt). */
  async input(all, now) {
    const lo = now.getTime() - (2 * Fitness.WEEKS * 7 + 2) * 86400000, out = [];
    for (const t of all) {
      if (!t.start || t.start < lo || t.status === 'planned') continue;
      let hist = null;
      if (t.hrAvg) {
        const k = t.id + ':' + t.hrAvg + ':' + (t.dist || 0);
        if (!FitUI._hist.has(k)) FitUI._hist.set(k, Fitness.histAusSpur(await Tours.points(t.id)));
        hist = FitUI._hist.get(k);
      }
      out.push({ tag: Fitness.tag(t.start), dauer_s: t.dur > 0 ? t.dur : null, up_m: t.up > 0 ? t.up : null, hist });
    }
    return out;
  },
  async compute(all, now) { const y = FitUI.year(); return y ? Fitness.berechne(await FitUI.input(all, now), y, now) : { status: 'kein_geburtsjahr' }; },
  /** Geburtsjahr prüfen und speichern; wirft eine verständliche Meldung. */
  async setYear(v) { const y = Fitness.pruefeJahr(v, new Date().getFullYear()); await Set_.set('birthYear', y); return y; },
  KLASSE: { sehr_aktiv: 'sehr aktiv', gut: 'gut', solide: 'solide', ausbaufaehig: 'ausbaufähig' },
  TREND: { up: 'steigend gegenüber den 12 Wochen davor', down: 'sinkend gegenüber den 12 Wochen davor', flat: 'gleichbleibend gegenüber den 12 Wochen davor' },
  /** Eingabe des Geburtsjahres (Statistik und Einstellungen). done() nach dem Speichern.
      2.20.0: opts.sofort (Einstellungen) – speichert wie der Maximalpuls darüber beim Verlassen des Felds, ohne eigene Knöpfe; leeres Feld = kein Geburtsjahr. */
  yearBox(done, opts) {
    const box = h('div', { id: 'fit-yearbox' });
    const sofort = !!(opts && opts.sofort);
    const after = () => { if (done) done(); else draw(); };      // ohne eigene Fortsetzung (Einstellungen) zeichnet sich das Feld selbst neu
    const draw = () => {
      const err = h('p', { class: 'err small', role: 'alert' }), inp = h('input', { type: 'text', inputmode: 'numeric', maxlength: 4, id: 'fit-year', placeholder: 'z. B. 1975', value: FitUI.year() || '', 'aria-label': 'Geburtsjahr',
        onkeydown: e => { if (e.key === 'Enter') { if (sofort) inp.blur(); else save(); } }, onchange: () => { if (sofort) save(); } });
      const save = async () => {
        if (sofort && !inp.value.trim()) { if (FitUI.year()) { await Set_.set('birthYear', ''); toast('Geburtsjahr gelöscht'); } err.textContent = ''; return; }
        try { await FitUI.setYear(inp.value); err.textContent = ''; toast('Geburtsjahr gespeichert'); if (!sofort) after(); } catch (e) { err.textContent = e.message; }
      };
      box.innerHTML = '';
      box.append(...[h('label', { class: 'fld' }, (opts && opts.label) || 'Geburtsjahr', inp), err,
        sofort ? null : h('div', { class: 'row' }, h('button', { class: 'btn pri', id: 'fit-save', onclick: save }, 'Speichern'),
          FitUI.year() ? h('button', { class: 'btn', id: 'fit-del', onclick: async () => { await Set_.set('birthYear', ''); toast('Geburtsjahr gelöscht'); after(); } }, 'Löschen') : null)].filter(Boolean));      // 2.24.0: append(null) schrieb „null“ in die Einstellungen
    };
    draw();
    return box;
  },
};

/** Statistik → Fitness. */
Ausw.fitness = async function (body, ts, ctx) {
  const wrap = h('div', { id: 'fitness' }); body.append(wrap);
  const draw = async () => {
    wrap.innerHTML = '';
    const now = new Date(), r = await FitUI.compute(ctx.all, now);
    const note = h('p', { class: 'muted small', id: 'fit-note' }, 'Orientierung, keine medizinische Aussage.');
    if (r.status === 'kein_geburtsjahr') {
      wrap.append(UI.section('Fitness-Einordnung', [h('p', null, 'Die Einordnung vergleicht deine letzten 12 Wochen mit dem, was für dein Alter üblich und empfohlen ist. Dafür brauche ich dein Geburtsjahr, nur das Jahr.'),
        FitUI.yearBox(draw), h('p', { class: 'muted small' }, 'Es bleibt auf diesem Handy und kommt in keine Diashow und keinen Export.')]), note);
      return;
    }
    const sec = [];
    const von = new Date(r.von + 'T12:00'), bis = new Date(r.bis + 'T12:00'), per = F.dshort(von.getTime()) + ' bis ' + F.dshort(bis.getTime());
    if (r.status === 'keine_touren' || r.status === 'keine_aktuellen') {
      sec.push(UI.empty({ icon: 'chart', title: 'Keine Touren in den letzten 12 Wochen', text: 'Sobald es Touren aus ' + per + ' gibt, steht hier die Einordnung.' }));
    } else {
      if (r.status === 'ok') {
        sec.push(UI.figs([[r.gesamt + ' von 100', 'Einordnung: ' + FitUI.KLASSE[r.einordnung]]], { big: true, id: 'fit-total' }),
          r.trend ? h('p', { class: 'muted', id: 'fit-trend' }, 'Trend: ' + FitUI.TREND[r.trend] + ' (' + r.vorher + ' → ' + r.gesamt + ').') : h('p', { class: 'muted' }, 'Für einen Trend fehlen Daten aus den 12 Wochen davor.'));
      } else sec.push(h('p', { id: 'fit-total' }, 'Für eine Gesamtbewertung fehlen Daten: Es braucht mindestens zwei Teilwerte. Die vorhandenen stehen unten.'));
      const rows = [], val = (x) => (x && x.wert != null ? h('b', null, x.wert) : 'keine Daten');
      const u = r.umfang, g = r.regel, i = r.intensitaet;
      rows.push([UI.row({ title: 'Umfang', trail: val(u), sub: u.wert != null ? Goals.nf(u.min_woche, 0) + ' Min. pro Woche · empfohlen sind ' + u.who_min + ' bis ' + u.who_max + ' Min.' + (u.ohne_dauer ? ' · ' + u.ohne_dauer + (u.ohne_dauer === 1 ? ' Tour' : ' Touren') + ' ohne Dauer nicht gezählt' : '') : 'Die Touren haben keine Dauer.' }), u.wert != null ? UI.bar(u.wert / 100) : null]);
      rows.push([UI.row({ title: 'Regelmäßigkeit', trail: val(g), sub: g.wert != null ? g.wochen_aktiv + ' von ' + g.wochen + ' Wochen mit mindestens einer Tour · ' + g.touren + (g.touren === 1 ? ' Tour' : ' Touren') : '' }), g.wert != null ? UI.bar(g.wert / 100) : null]);
      rows.push([UI.row({ title: 'Intensität', trail: val(i), sub: i.wert == null ? 'Weder Puls noch Aufstieg mit mindestens einer Stunde Dauer vorhanden.' : i.quelle === 'puls'
        ? 'Mit Puls: ' + i.zone_pct + ' % der Zeit bei 60 bis 90 % von HFmax ' + i.hfmax + ' · Ø Puls ' + i.mittel_bpm + ' (' + i.mittel_pct + ' %)' : 'Ohne Puls: ' + i.m_h + ' m Aufstieg pro Stunde · Richtwert für dein Alter ' + i.ref_m_h + ' m/h' }), i.wert != null ? UI.bar(i.wert / 100) : null]);
      sec.push(h('div', { class: 'fit-parts' }, rows.map(r2 => h('div', { class: 'fit-part' }, r2))));
      sec.push(h('p', { class: 'muted small' }, 'Grundlage: ' + r.touren + (r.touren === 1 ? ' Tour' : ' Touren') + ' aus den letzten 12 Wochen (' + per + '), Alter ' + r.alter + ' Jahre.'));
    }
    sec.push(h('details', { id: 'fit-how' }, h('summary', null, 'So wird gerechnet'), h('div', { class: 'how' },
      h('p', null, h('b', null, 'Umfang: '), 'Durchschnittliche Dauer deiner Touren pro Woche gegen die Empfehlung der Weltgesundheitsorganisation für Erwachsene: 150 bis 300 Minuten Bewegung mit mittlerer Intensität pro Woche (WHO-Leitlinien zu körperlicher Aktivität und sitzendem Verhalten, 2020; gilt auch ab 65 Jahren). 0 Minuten sind 0 Punkte, 150 Minuten 70, 300 Minuten und mehr 100.'),
      h('p', null, h('b', null, 'Regelmäßigkeit: '), '70 % zählt der Anteil der Wochen mit mindestens einer Tour, 30 % die Gleichmäßigkeit der Touren je Woche.'),
      h('p', null, h('b', null, 'Intensität: '), 'Mit Pulsdaten (mindestens 10 Minuten) der Anteil der Zeit zwischen 60 und 90 % deines geschätzten Maximalpulses. Der Maximalpuls wird nur aus dem Alter berechnet: 208 minus 0,7 mal Alter (Tanaka, Monahan und Seals, Journal of the American College of Cardiology, 2001); ein bei den Pulszonen eingestellter Maximalpuls wird hier nicht benutzt. Ohne Pulsdaten zählt der Aufstieg pro Stunde gegen einen Richtwert von 400 Metern pro Stunde bis 30 Jahre, der je Jahr darüber um 1 % sinkt (nicht unter die Hälfte). Das ist eine grobe Näherung, keine Norm; Gelände und Sportart beeinflussen den Wert stark. Das Tempo wird bewusst nicht herangezogen.'),
      h('p', null, h('b', null, 'Gesamt: '), 'Mittel der vorhandenen Teilwerte, mindestens zwei nötig. Ab 80 sehr aktiv, ab 60 gut, ab 40 solide, darunter ausbaufähig. Der Trend vergleicht mit den 12 Wochen davor (ab 5 Punkten Unterschied steigend oder sinkend). Die Schwellen sind frei gewählte Anhaltswerte.'),
      h('p', null, 'Alles wird auf deinem Handy aus deinen Touren gerechnet; nichts wird gesendet. Eine VO2max wird nicht geschätzt.'))));
    wrap.append(UI.section('Fitness-Einordnung', sec, { sub: 'Deine letzten 12 Wochen im Vergleich zu dem, was für dein Alter üblich und empfohlen ist.' }), note,
      h('div', { class: 'row wrap' }, h('span', { class: 'muted small' }, 'Geburtsjahr ' + r.geburtsjahr), h('button', { class: 'btn sm', id: 'fit-chg', onclick: () => { wrap.innerHTML = ''; wrap.append(UI.section('Geburtsjahr', FitUI.yearBox(draw))); } }, 'Ändern')));
  };
  await draw();
};

/* ---- Startseite: ein Satz zur Einordnung (standardmäßig aus; ohne Geburtsjahr erscheint nichts) ---- */
Home.add('fitness', 35, async ({ all, now }) => {
  if (!FitUI.year()) return null;
  const r = await FitUI.compute(all, now);
  if (r.status !== 'ok') return null;
  return UI.section('Fitness', [UI.figs([[r.gesamt + ' von 100', 'Einordnung: ' + FitUI.KLASSE[r.einordnung]]]), r.trend ? h('p', { class: 'muted small' }, 'Trend: ' + FitUI.TREND[r.trend] + '.') : null,
    h('p', { class: 'muted small' }, 'Orientierung, keine medizinische Aussage.')], { id: 'fitness-home', link: '#/stats/fitness', linkText: 'Details' });
}, { label: 'Fitness-Einordnung', sub: 'Nur mit Geburtsjahr; Orientierung, keine medizinische Aussage', def: false });
