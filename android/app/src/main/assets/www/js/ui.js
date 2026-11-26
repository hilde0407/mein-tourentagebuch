'use strict';
/* Bausteine der Oberfläche (Gestaltung 2.0, siehe docs/gestaltung-2.0.md).
   Jede Ansicht baut ihre Abschnitte, Kennzahlen, Listen, Chips, Schalter und leeren Zustände hiermit –
   so sehen alle Seiten gleich aus, und neue Bausteine (Ziele, Serie, Fitness …) brauchen kein eigenes CSS. */
const UI = {
  /** 2.16.0: Textfeld wächst mit dem Inhalt (Notizen werden ganz angezeigt). Rasterkniff: ein unsichtbarer Zwilling mit demselben Text liegt
   *  in derselben Rasterzelle und bestimmt die Höhe – so passt es auch nach Breiten- und Schriftgrößenwechsel ohne Nachrechnen.
   *  Kein Höchstmaß (die Seite rollt). Gibt die Hülle zurück (statt des Felds einhängen). */
  autoHoehe(ta) {
    const w = h('div', { class: 'ah' }), sync = () => { w.dataset.wert = ta.value; };
    ta.classList.add('ah-t'); ta.addEventListener('input', sync); sync(); w.append(ta);
    return w;
  },
  /** Zahl und Einheit getrennt setzen: „3,7 km“ → 3,7 groß, km klein; „↑ 168 m“ → Pfeil klein davor. */
  num(v) {
    const s = String(v == null ? '–' : v);
    const m = s.match(/^([↑↓±Ø]\s?)?([\d.,:+−–-]*\d)\s*(.*)$/);
    if (!m) return h('b', null, s);
    return h('b', null, m[1] ? h('span', { class: 'pre' }, m[1].trim()) : null, m[2], m[3] ? h('span', { class: 'u' }, m[3]) : null);
  },
  /** Eine Kennzahl: Wert (mit Einheit) und Etikett darunter. */
  fig(value, label) { return h('div', { class: 'kpi' }, UI.num(value), label ? h('small', null, label) : null); },
  /** Kennzahlenzeile. values: [[wert, etikett], …]; opts.big = große Ziffern, opts.cols = feste Spaltenzahl, opts.id. */
  figs(values, opts) {
    opts = opts || {};
    return h('div', { class: 'kpis' + (opts.big ? ' big' : '') + (opts.cols ? ' c' + opts.cols : '') + (opts.cls ? ' ' + opts.cls : ''), id: opts.id },
      values.filter(Boolean).map(v => UI.fig(v[0], v[1])));
  },
  /** Leise Wertetabelle „Etikett … Wert“ für nachrangige Angaben. pairs: [[etikett, wert], …]. */
  facts(pairs) { return h('dl', { class: 'facts' }, pairs.filter(Boolean).map(p => h('div', null, h('dt', null, p[0]), h('dd', null, p[1])))); },
  /** Abschnitt mit Überschrift. opts: id, sub (Erklärzeile), link + linkText (Verweis rechts), linkId, action (Element rechts). */
  section(title, content, opts) {
    opts = opts || {};
    const right = opts.action || (opts.link ? h('a', { class: 'sec-l', href: opts.link, id: opts.linkId }, opts.linkText || 'Alle') : null);
    return h('section', { class: 'sec' + (opts.cls ? ' ' + opts.cls : ''), id: opts.id },
      h('div', { class: 'sec-h' }, h('h3', null, title), right),
      opts.sub ? h('p', { class: 'muted small sec-s' }, opts.sub) : null, content);
  },
  /** Linierte Liste aus Zeilen (UI.row oder eigene .li-Elemente). */
  list(rows, opts) { return h('div', { class: 'list' + (opts && opts.cls ? ' ' + opts.cls : ''), id: opts && opts.id }, rows); },
  /** Listenzeile. opts: icon (Name/Zeichen) oder img (Bildadresse), title, sub, href oder onclick, trail (Element/Text rechts), id. */
  row(opts) {
    const lead = opts.img ? h('span', { class: 'li-i cov' }, h('img', { src: opts.img, alt: '', loading: 'lazy' }))
      : opts.icon ? h('span', { class: 'li-i', html: Ico.svg(opts.icon, 22) || esc(opts.icon) }) : null;
    const kids = [lead, h('span', { class: 'li-t' }, h('b', null, opts.title), opts.sub ? h('small', null, opts.sub) : null),
      opts.trail != null ? h('span', { class: 'li-r' }, opts.trail) : null];
    if (opts.href) return h('a', { class: 'li', href: opts.href, id: opts.id }, kids);
    if (opts.onclick) return h('button', { class: 'li', id: opts.id, onclick: opts.onclick }, kids);
    return h('div', { class: 'li', id: opts.id }, kids);
  },
  /** Chip (Filter, Auswahl). on = gewählt. */
  chip(label, on, onclick, opts) {
    return h('button', { class: 'chip' + (on ? ' on' : ''), 'aria-pressed': on ? 'true' : 'false', id: opts && opts.id, onclick }, label);
  },
  /** 2.19.1: Sportart-Chips aus StatGruppen.chipAuswahl – DAS Muster „Sportart filtern“ (Leitfaden Regel 6; Karte, Tourenliste, Statistik, Startseite):
      zuerst „Alle Sportarten“ (2.20.0), dann die Statistik-Gruppen, dann je Kategorie eine kleine Überschrift und die Sportarten mit Touren,
      jeder Chip mit dem Farbpunkt seiner Kartenfarbe (Gruppe: die Punkte ihrer Mitglieder, höchstens 3). sel: gewählter Schlüssel; onpick(key) – nochmal tippen hebt auf,
      „Alle Sportarten“ liefert ''. Gibt eine Liste von Elementen zurück (zum Einhängen in eine .chips-Leiste). */
  sportChips(auswahl, sel, onpick) {
    const dot = k => h('i', { class: 'sdot', 'aria-hidden': 'true', style: { background: MapKit.routeColor(k, '#2e7d32') } });
    const chip = (key, label, dots, ti) => h('button', { class: 'chip schip' + (sel === key ? ' on' : ''), 'aria-pressed': sel === key ? 'true' : 'false', 'data-sport': key, title: ti || null, 'aria-label': ti || null,
      onclick: () => onpick(sel === key ? '' : key) }, dots, label);
    const out = [h('button', { class: 'chip salle', 'aria-pressed': sel ? 'false' : 'true', onclick: () => onpick('') }, 'Alle Sportarten')];
    if (!sel) out[0].classList.add('on');
    if (auswahl.gruppen.length) out.push(h('span', { class: 'skat' }, 'Statistik-Gruppen'), ...auswahl.gruppen.map(g => chip(g.key, g.label, g.sports.slice(0, 3).map(dot), g.titel)));
    auswahl.kategorien.forEach(k => out.push(h('span', { class: 'skat', 'data-kat': k.id }, k.name), ...k.items.map(it => chip(it.key, it.label, [dot(it.key)]))));
    return out;
  },
  /** 2.20.0: DAS Muster „Sportart zuweisen“ (Leitfaden Regel 6; Aufzeichnen, Tour bearbeiten, Ziel, Planung): die Favoriten-Sportarten als Chips
      (die gewählte steht – falls kein Favorit – vorn dabei), dann „Mehr …“ mit allen Sportarten nach Kategorien. Rückgabe: Element mit .wert() und .setze(k).
      opts: extra – [[schlüssel, text, titel], …] vor den Favoriten (z. B. „Alle Sportarten“ und Statistik-Gruppen bei Zielen);
            nur – erlaubte Schlüssel (Planung); idp – Präfix der IDs (idp-mehr, idp-alle, idp-akt-<k>); onpick(k) – nach jeder Wahl. */
  sportWahl(sel, opts) {
    opts = opts || {};
    const idp = opts.idp || 'sw', extra = opts.extra || [], erlaubt = k => !opts.nur || opts.nur.includes(k);
    let wert = sel;
    const box = h('div', { class: 'chips wrap swahl', id: idp + '-wahl', role: 'group', 'aria-label': opts.label || 'Sportart' });
    const istSport = k => !!k && !extra.some(e => e[0] === k);
    const chip = (k, text, ti) => h('button', { class: 'chip' + (wert === k ? ' on' : ''), 'aria-pressed': wert === k ? 'true' : 'false', 'data-sport': k, title: ti || null, 'aria-label': ti || null, onclick: () => setze(k) }, text);
    const draw = () => {
      box.innerHTML = '';
      extra.forEach(([k, l, ti]) => box.append(chip(k, l, ti)));
      const favs = Aktiv.favoriten(Set_.get('favAkt')).filter(erlaubt);
      const liste = istSport(wert) && !favs.includes(wert) ? [wert].concat(favs) : favs;
      liste.forEach(k => box.append(chip(k, Sports.icon(k) + ' ' + Sports.label(k))));
      box.append(h('button', { class: 'chip', id: idp + '-mehr', onclick: mehr }, 'Mehr …'));
    };
    const setze = k => { wert = k; draw(); if (opts.onpick) opts.onpick(k); };
    const mehr = () => {
      const s = sheet('Sportart wählen', h('div', { id: idp + '-alle' },
        Sports.kategorien(wert).map(([id, nm, list]) => { const l = list.filter(x => erlaubt(x[0])); return l.length ? [h('h3', { class: 'sub' }, nm),
          UI.list(l.map(([k, lb, ic]) => UI.row({ icon: ic, title: lb, trail: k === wert ? 'gewählt' : null, id: idp + '-akt-' + k, onclick: () => { s.close(); setze(k); } })), { cls: 'menu' })] : []; }).flat(),
        h('p', { class: 'muted small' }, 'Welche Sportarten vorn als Knöpfe stehen, stellst du unter Mehr → Einstellungen → Sportarten → Favoriten-Sportarten ein.')));
    };
    draw();
    box.wert = () => wert; box.setze = setze;
    return box;
  },
  chips(kids, opts) { return h('div', { class: 'chips' + (opts && opts.wrap ? ' wrap' : ''), id: opts && opts.id }, kids); },
  /** Umschalter mit zwei bis vier Segmenten. options: [[schlüssel, text, href?], …]. */
  seg(options, active, onpick, opts) {
    return h('div', { class: 'seg' + (opts && opts.cls ? ' ' + opts.cls : ''), role: 'group', 'aria-label': opts && opts.label },
      options.map(o => o[2] ? h('a', { class: o[0] === active ? 'on' : '', href: o[2], 'aria-current': o[0] === active ? 'page' : null }, o[1])
        : h('button', { class: o[0] === active ? 'on' : '', 'aria-pressed': o[0] === active ? 'true' : 'false', onclick: () => onpick && onpick(o[0]) }, o[1])));
  },
  /** Schalter mit Beschriftung. onchange(an, ereignis). */
  toggle(label, on, onchange, opts) {
    return h('label', { class: 'sw', id: opts && opts.id }, h('input', { type: 'checkbox', checked: !!on, onchange: e => onchange && onchange(e.target.checked, e) }), h('span', null, label));
  },
  /** Fortschrittsbalken. frac 0…1; opts.mark = Soll-Marke 0…1, opts.title. */
  bar(frac, opts) {
    return h('div', { class: 'gbar' }, h('i', { style: { width: Math.max(0, Math.min(100, frac * 100)) + '%' } }),
      opts && opts.mark != null ? h('u', { style: { left: Math.max(0, Math.min(100, opts.mark * 100)) + '%' }, title: opts.title || 'Soll heute' }) : null);
  },
  /** Leerer Zustand: sagt, was fehlt, und bietet die nächste Handlung an. actions: Elemente (Knöpfe/Verweise). */
  empty(opts) {
    return h('div', { class: 'empty' + (opts.cls ? ' ' + opts.cls : '') }, opts.icon ? h('div', { class: 'empty-i', html: Ico.svg(opts.icon, 34) }) : null,
      opts.title ? h('h2', null, opts.title) : null, opts.text ? h('p', null, opts.text) : null,
      opts.actions ? h('div', { class: 'col' }, opts.actions) : null);
  },
  /** Hinweis mit Handlung. */
  banner(content, actions, opts) { return h('div', { class: 'banner', id: opts && opts.id }, h('div', null, content), actions ? h('div', { class: 'row wrap' }, actions) : null); },
  /** Gelbes Wegweiserschild – nur für „Aufzeichnung starten“. opts: href oder onclick, id, cls, icon. */
  sign(text, opts) {
    opts = opts || {};
    const kids = [h('span', { class: 'sign-i', html: Ico.svg(opts.icon || 'rec', 26) }), h('span', { class: 'sign-t' }, text)];
    return opts.href ? h('a', { class: 'sign ' + (opts.cls || ''), href: opts.href, id: opts.id }, kids)
      : h('button', { class: 'sign ' + (opts.cls || ''), id: opts.id, onclick: opts.onclick }, kids);
  },
  /** Blatt mit Aktionsliste. items: [symbol, text, fn, unterzeile, id] oder null. Gibt das Blatt zurück. */
  menu(title, items) {
    const s = sheet(title, UI.list(items.filter(Boolean).map(it => UI.row({ icon: it[0], title: it[1], sub: it[3], id: it[4], onclick: () => { s.close(); it[2](); } })), { cls: 'menu' }));
    return s;
  },
  /** 2.9.0: Kennzeichen eines Videos auf seiner Kachel (Fotoraster, Fotoleiste der Tour und der Reise): Abspiel-Symbol und Dauer „m:ss“.
      Dunkle Unterlage mit weißer Schrift – lesbar auf jedem Vorschaubild. Für Fotos null. */
  vidMark(p) {
    if (!p || !p.video) return null;
    const d = VideoCalc.dauer(p.dur);
    return h('span', { class: 'vmark', 'aria-hidden': 'true' }, h('span', { class: 'vmark-i', html: Ico.svg('play', 13) }), d ? h('span', null, d) : null);
  },
  /** „Mo., 21.09.“ – im Tagebuch steht das Jahr in der Monatsüberschrift. */
  day: ms => ms ? new Date(ms).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' }) : '–',

  /** Miniatur einer Tour füllen: Foto, sonst die Strecke in der Farbe der Sportart. Merkt sich das Ergebnis in `memo` (kv „tilebg“). */
  async thumb(pv, t, memo, save) {
    const pts = await Tours.points(t.id);
    const svg = () => { pv.innerHTML = pts.length > 1 ? previewSvg(pts, MapKit.routeColor(t.sport, '#2e7d32'), { w: 72, h: 72, pad: 11, sw: 2.8 }) : ''; };
    let en = memo && memo[t.id];
    // „map“ stammt aus älteren Versionen (Kartenbild als Kachelhintergrund); „svg“ gilt nur, solange sich die Zahl der Fotos nicht geändert hat
    // (Fotos kommen oft erst nach dem Import dazu, und eine einmal gemerkte Zeichnung blieb sonst für immer stehen)
    const nPh = (!en || en.kind !== 'photo') ? (await DB.byIndex('photos', 'tour', t.id)).filter(p => !p.video).length : 0;
    if (!en || en.kind === 'map' || (en.kind === 'svg' && en.n !== nPh)) {
      const ph = nPh ? await pickPhoto(t.id) : null;
      en = ph ? { kind: 'photo', ph: ph.id } : { kind: 'svg', n: nPh };
      if (memo) { memo[t.id] = en; if (save) save(); }
    }
    if (en.kind !== 'photo') return svg();
    const img = h('img', { alt: '', loading: 'lazy', src: Photos.thumb(en.ph) });
    img.onerror = () => { if (memo) { delete memo[t.id]; if (save) save(); } svg(); };      // Bild nicht ladbar: Zeichnung zeigen, beim nächsten Mal neu wählen
    pv.innerHTML = ''; pv.append(img);
  },
  /** Zeile einer Tour: Miniatur, Titel, „Datum · Sportart“, Kennzahlen. opts: photos (Anzahl), stage (Etappentext), year (Jahr im Datum zeigen), io (IntersectionObserver für die Miniatur). */
  tourRow(t, opts) {
    opts = opts || {};
    const pv = h('span', { class: 'tr-pv' }); pv.__t = t;
    if (opts.io) opts.io.observe(pv); else UI.thumb(pv, t, opts.memo, opts.save).catch(() => {});
    const k = h('span', { class: 'met' }, h('span', null, F.km(t.dist)), t.up ? h('span', null, '↑ ' + F.m(t.up)) : null, t.dur ? h('span', null, F.dur(t.dur)) : null,
      t.hrAvg ? h('span', { class: 'hr', title: 'Ø Puls' }, h('span', { html: Ico.svg('heart', 13) }), t.hrAvg) : null,
      opts.photos ? h('span', { class: 'ph', title: 'Fotos' }, h('span', { html: Ico.svg('photo', 14) }), opts.photos) : null);
    return h('a', { class: 'tour', href: '#/tour/' + t.id },
      pv, h('span', { class: 'tb' },
        h('b', null, t.name, t.fav ? h('span', { class: 'favm', title: 'Lieblingstour', html: Ico.svg('star', 15) }) : null),
        h('small', null, (opts.year ? F.date(t.start) : UI.day(t.start)) + ' · ' + Sports.label(t.sport) + (t.status === 'planned' ? ' · geplant' : '') + (Abgleich.sterne(t) ? ' · ★ ' + Abgleich.sterne(t) : '')),
        opts.stage ? h('small', { class: 'stage' }, opts.stage) : null, k));
  },
};
