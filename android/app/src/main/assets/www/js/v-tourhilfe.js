'use strict';
/* Abschnitte der Tourseite, die aus „Meine Touren“ kommen:
   – gelaufene Tour: „Wie ist es gelaufen?“ (Einordnung gegen die eigenen Touren) oder, mit verknüpftem Plan, „Plan und Ergebnis“
   – geplante Tour: „Passt die Tour zu mir?“ (Form und Tageslicht) und „Notizen & Quellen“ (Notiz, Herkunft, bis 20 Links)
   Gerechnet wird in js/calc-*.js. Notizen und Links einer Planung liegen in kv „pn:<Tour-Kennung>“ (damit sie das Neu-Speichern im Planer überstehen und in der Sicherung mitgehen).
   Links werden nie automatisch abgerufen; sie öffnen erst auf Tipp, in der Android-App über MTApp.openUrl. */
const PlanMeta = {
  async get(id) { const m = await DB.kvGet('pn:' + id, null); return m && typeof m === 'object' ? m : {}; },
  async patch(id, p) { const m = Object.assign(await PlanMeta.get(id), p); await DB.kvSet('pn:' + id, m); return m; },
};

const TourHelp = {
  hm: min => String(Math.floor(min / 60) % 24).padStart(2, '0') + ':' + String(Math.round(min % 60)).padStart(2, '0'),
  kmh: v => v.toFixed(1).replace('.', ',') + ' km/h',
  /** Öffnet eine gespeicherte Adresse – nur auf Tipp, nur http/https. In der Android-App im Browser des Handys. */
  openLink(e, url) { try { Planhilfe.pruefeUrl(url); } catch (er) { e.preventDefault(); toastFehler('Link öffnen', er); return; } if (window.MTApp && MTApp.openUrl) { e.preventDefault(); MTApp.openUrl(url); } },
  linkRow(l, onremove) {
    return h('div', { class: 'li lnk' }, h('a', { class: 'li-t', href: l.url, target: '_blank', rel: 'noopener noreferrer', onclick: e => TourHelp.openLink(e, l.url) },
      h('b', null, l.titel), h('small', null, new URL(l.url).hostname + ' · ' + (Planhilfe.LINK_ARTEN.find(a => a[0] === l.art) || [0, 'Sonstiges'])[1])),
      onremove ? h('button', { class: 'ico', 'aria-label': 'Link entfernen: ' + l.titel, onclick: onremove }, h('span', { html: Ico.svg('trash', 22) })) : null);
  },

  /* ---------- gelaufene Tour ---------- */
  /** „Wie ist es gelaufen?“ – nur mit mindestens 5 Vergleichstouren, sonst null (kein Platzhalter). */
  rueckblick(t, all) {
    const r = Rueckblick.rueckblick(t, all);
    if (r.status !== 'ok') return null;
    const W = { dauer: ['Dauer', { unter: 'kürzer als üblich', aehnlich: 'ähnlich wie üblich', ueber: 'länger als üblich' }, v => F.dur(v * 3600)],
      strecke: ['Strecke', { unter: 'kürzer als üblich', aehnlich: 'ähnlich wie üblich', ueber: 'länger als üblich' }, v => F.km(v * 1000)],
      auf: ['Aufstieg', { unter: 'weniger als üblich', aehnlich: 'ähnlich wie üblich', ueber: 'mehr als üblich' }, v => F.m(v)],
      tempo: ['Tempo', { unter: 'langsamer als üblich', aehnlich: 'ähnlich wie üblich', ueber: 'schneller als üblich' }, v => TourHelp.kmh(v)] };
    const rows = ['dauer', 'strecke', 'auf', 'tempo'].filter(k => r.kennzahlen[k]).map(k => {
      const x = r.kennzahlen[k], w = W[k];
      return UI.row({ title: w[0] + ': ' + w[1][x.einordnung], sub: w[2](x.wert) + ' gegen ' + w[2](x.median) + ' im Mittel (' + x.verhaeltnis_median_pct + ' %)' });
    });
    return UI.section('Wie ist es gelaufen?', [UI.list(rows),
      h('p', { class: 'muted small' }, 'Verglichen mit deinen ' + r.n + ' Touren derselben Art aus den 12 Monaten davor. „Im Mittel“ ist der mittlere Wert (Median). Unter 80 % gilt als weniger, über 125 % als mehr.')], { id: 'rueckblick' });
  },
  /** „Plan und Ergebnis“: geplant gegen gelaufen. null, wenn die geplante Tour nicht mehr da ist. */
  async ergebnis(t) {
    const p = t.plan ? await DB.get('tours', t.plan) : null;
    if (!p) return null;
    const estH = p.dur ? p.dur / 3600 : Planhilfe.schaetzDauer(p.sport, p.dist / 1000, p.up), gelH = t.dur ? t.dur / 3600 : null;
    const diff = (g, pl, fmt, unit) => { if (g == null || pl == null) return ''; const d = g - pl; if (Math.abs(d) < Math.max(pl * 0.01, 1e-9)) return ' · wie geplant'; return ' · ' + fmt(Math.abs(d)) + (d > 0 ? ' mehr' : ' weniger'); };
    const rows = [
      UI.row({ title: 'Strecke', trail: h('b', null, F.km(t.dist)), sub: 'geplant ' + F.km(p.dist) + diff(t.dist, p.dist, F.km) }),
      p.up != null && t.up != null ? UI.row({ title: 'Aufstieg', trail: h('b', null, F.m(t.up)), sub: 'geplant ' + F.m(p.up) + diff(t.up, p.up, F.m) }) : null,
      gelH != null ? UI.row({ title: 'Dauer', trail: h('b', null, F.dur(gelH * 3600)), sub: 'geschätzt ' + F.dur(estH * 3600) + diff(gelH, estH, v => F.dur(v * 3600)) }) : null].filter(Boolean);
    return UI.section('Planung und Ergebnis', [UI.list(rows), h('div', { class: 'row wrap' }, h('a', { class: 'btn sm', href: '#/tour/' + p.id }, 'Zur Planung „' + p.name + '“'),
      h('button', { class: 'btn sm', id: 'unlinkplan', onclick: async () => { const x = await DB.get('tours', t.id); delete x.plan; await Tours.save(x); delete t.plan; toast('Verknüpfung gelöst'); Nav.render(); } }, 'Verknüpfung lösen'))], { id: 'planergebnis' });
  },
  /** Blatt: geplante Tour derselben Sportgruppe wählen und verknüpfen („Mit Plan vergleichen“). */
  async linkSheet(t) {
    const cand = (await Tours.list()).filter(p => p.status === 'planned' && Planhilfe.gleicheGruppe(p.sport, t.sport));
    if (!cand.length) { toast('Es gibt keine geplante Tour dieser Sportart.'); return; }
    const s = sheet('Mit Planung vergleichen', h('div', null, h('p', { class: 'muted' }, 'Welche Planung gehörte zu dieser Tour?'), UI.list(cand.map(p => UI.row({ icon: 'route', title: p.name, sub: F.km(p.dist) + (p.up ? ' · ↑ ' + F.m(p.up) : ''),
      onclick: async () => { const x = await DB.get('tours', t.id); x.plan = p.id; await Tours.save(x); s.close(); toast('Mit der Planung verknüpft'); Nav.render(); } })), { cls: 'menu' })));
  },
  /** Aufzeichnung aus einer Planung: beim Start der Route merken, beim Aufzeichnen festhalten, beim Speichern verknüpfen. */
  armPlan(t) { return DB.kvSet('recPlan', { id: t.id, name: t.name, ts: Date.now() }).catch(() => {}); },
  disarmPlan() { return DB.kvSet('recPlan', null).catch(() => {}); },
  /** Beim Start der Aufzeichnung: gilt die geplante Route noch (gleicher Name wie die aktive Route)? */
  async lockPlan() {
    try {
      const rp = await DB.kvGet('recPlan', null); let info = {};
      try { info = JSON.parse(window.MTApp ? MTApp.routeInfo() || '{}' : '{}'); } catch (e) { /* ohne Hülle */ }
      await DB.kvSet('recPlanRun', rp && info.name && info.name === rp.name && Date.now() - rp.ts < 3 * 86400000 ? rp.id : null);
    } catch (e) { /* die Aufzeichnung geht vor */ }
  },
  /** Beim Speichern der aufgezeichneten Tour: mit der Planung verknüpfen, wenn die Aufzeichnung aus ihr gestartet wurde. */
  async attachPlan(tour) {
    try {
      const id = await DB.kvGet('recPlanRun', null); if (!id) return;
      await DB.kvSet('recPlanRun', null);
      const p = await DB.get('tours', id);
      if (p && p.status === 'planned') { tour.plan = id; await Tours.save(tour); }
    } catch (e) { /* Verknüpfen ist nur eine Zugabe */ }
  },

  /* ---------- geplante Tour ---------- */
  /** „Passt die Tour zu mir?“: Form gegen die eigenen Touren, Tageslicht am Startpunkt. */
  async passt(t, all, meta) {
    const km = t.dist / 1000, up = t.up > 0 ? t.up : null, estH = t.dur ? t.dur / 3600 : Planhilfe.schaetzDauer(t.sport, km, up);
    const tours = all.map(x => ({ sport: x.sport, start: x.start, dist: x.dist, dur: x.dur, up: x.up }));
    const f = Planhilfe.form(km, up, estH, t.sport, tours, Date.now());
    const sec = h('div', { id: 'passt' });
    // Form
    const form = h('div', { id: 'passt-form' }), sport = Sports.label(t.sport);
    if (f.status !== 'ok') {
      form.append(h('p', { class: 'muted' }, 'Für einen Vergleich fehlen noch Touren: Es gibt ' + (f.n === 1 ? 'erst 1 Tour' : 'erst ' + f.n + ' Touren') + ' dieser Art in den letzten 12 Monaten, nötig sind ' + f.min_n + '.'));
    } else {
      const W = { km: ['Strecke', { unter: 'kürzer als üblich', aehnlich: 'ähnlich wie üblich', ueber: 'länger als üblich' }, v => F.km(v * 1000)],
        up: ['Aufstieg', { unter: 'weniger als üblich', aehnlich: 'ähnlich wie üblich', ueber: 'mehr als üblich' }, v => F.m(v)],
        dauer: ['Dauer (geschätzt)', { unter: 'kürzer als üblich', aehnlich: 'ähnlich wie üblich', ueber: 'länger als üblich' }, v => F.dur(v * 3600)] };
      const rows = ['km', 'up', 'dauer'].filter(k => f[k]).map(k => { const x = f[k], w = W[k]; return UI.row({ title: w[0] + ': ' + w[1][x.einordnung], sub: w[2](x.wert) + ', üblich ' + w[2](x.median) + ' (' + x.verhaeltnis_median_pct + ' %)' + ' · ' + x.perzentil + ' % deiner Touren sind kleiner' }); });
      form.append(UI.list(rows));
      const mx = ['km', 'up'].filter(k => f[k]).map(k => (k === 'km' ? 'Strecke' : 'Aufstieg') + ' ' + f[k].vs_max_pct + ' %');
      if (mx.length) form.append(h('p', { class: 'muted small' }, 'Im Vergleich zu deiner längsten bzw. höchsten Tour der letzten 12 Monate: ' + mx.join(', ') + '.'));
      if (f.deutlich_ueber.length) form.append(UI.banner([h('b', null, 'Mehr als sonst: '), (f.deutlich_ueber.filter(k => k !== 'dauer').map(k => k === 'km' ? 'die Strecke' : 'der Aufstieg').join(' und ') || 'die Dauer').replace(/^./, c => c.toUpperCase()) + ' liegt deutlich über allem, was du in den letzten 12 Monaten gemacht hast (über 120 %). Plane mehr Zeit und Reserven ein.']));
      form.append(h('p', { class: 'muted small' }, 'Basis: ' + f.n + ' deiner Touren (' + sport + ' und verwandte Sportarten) aus den letzten 12 Monaten. Unter 80 % gilt als weniger, über 125 % als mehr.'));
    }
    // Tageslicht
    const today = new Date(), iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    const dIn = h('input', { type: 'date', id: 'tl-date', value: meta.datum || iso(today), 'aria-label': 'Datum' }), sIn = h('input', { type: 'time', id: 'tl-start', value: meta.start || Planhilfe.START_STANDARD, 'aria-label': 'Startzeit' }),
      pIn = h('input', { type: 'number', id: 'tl-puffer', inputmode: 'numeric', min: 0, max: 100, step: 1, value: meta.puffer == null ? Planhilfe.PUFFER_STANDARD : meta.puffer, 'aria-label': 'Pausenpuffer in Prozent' });
    const out = h('div', { id: 'tl-out', 'aria-live': 'polite' });
    const calc = async save => {
      let datum, start, puffer;
      try { datum = Planhilfe.pruefeDatum(dIn.value); start = Planhilfe.pruefeStart(sIn.value); puffer = Planhilfe.pruefePuffer(pIn.value); }
      catch (e) { out.innerHTML = ''; out.append(h('p', { class: 'err' }, e.message)); return; }
      if (save) await PlanMeta.patch(t.id, { datum: datum === iso(today) ? null : datum, start: start === Planhilfe.START_STANDARD ? null : start, puffer: puffer === Planhilfe.PUFFER_STANDARD ? null : puffer });
      const r = Planhilfe.tageslicht(t.lat, t.lon, datum, start, estH, puffer, today);
      out.innerHTML = '';
      if (r.status === 'keine_position') { out.append(h('p', { class: 'muted' }, 'Für diese Tour ist kein Startpunkt bekannt.')); return; }
      if (r.status === 'keine_dauer') { out.append(h('p', { class: 'muted' }, 'Ohne Strecke lässt sich die Dauer nicht schätzen.')); return; }
      const back = TourHelp.hm(r.rueckkehr_min) + (r.rueckkehr_tag_plus > 0 ? ' (am Folgetag)' : '');
      const facts = [['Start', TourHelp.hm(r.start_min)], ['Dauer geschätzt', F.dur(r.dauer_min * 60)], ['Pausenpuffer', F.dur(r.puffer_min * 60)], ['Rückkehr', back]];
      let say, cls = '';
      if (r.status === 'polar_tag') say = 'Polartag: Die Sonne geht an diesem Tag nicht unter.';
      else if (r.status === 'polar_nacht') say = 'Polarnacht: Die Sonne geht an diesem Tag nicht auf.';
      else {
        facts.unshift(['Sonnenaufgang', TourHelp.hm(r.aufgang_min)], ['Sonnenuntergang', TourHelp.hm(r.untergang_min)]);
        if (r.ampel === 'reserve') say = 'Rückkehr vor Sonnenuntergang mit ' + F.dur(r.reserve_min * 60) + ' Reserve.';
        else if (r.ampel === 'knapp') say = 'Knapp: Rückkehr nur ' + F.dur(r.reserve_min * 60) + ' vor Sonnenuntergang.';
        else say = 'Rückkehr nach Sonnenuntergang (' + F.dur(-r.reserve_min * 60) + ' danach).';
        cls = ' ' + r.ampel;
        if (r.start_vor_aufgang) say += ' Der Start liegt vor Sonnenaufgang.';
        if (r.start_nach_untergang) say += ' Der Start liegt nach Sonnenuntergang.';
      }
      out.append(h('p', { class: 'tl-say' + cls, id: 'tl-say' }, say), UI.facts(facts), h('p', { class: 'muted small' }, 'Uhrzeiten in der Zeitzone dieses Handys, gerechnet für den Startpunkt der Tour.'));
    };
    const ch = () => calc(true);
    [dIn, sIn, pIn].forEach(e => e.addEventListener('change', ch));
    await calc(false);
    const wetter = Planhilfe.ladeLinks(meta.links).filter(l => l.art === 'wetter');
    sec.append(UI.section('Passt die Tour zu mir?', [
      h('h3', { class: 'sub' }, 'Form'), form,
      h('h3', { class: 'sub' }, 'Tageslicht'),
      h('div', { class: 'tl-in' }, h('label', { class: 'fld' }, 'Datum', dIn), h('label', { class: 'fld' }, 'Start', sIn), h('label', { class: 'fld' }, 'Puffer in %', pIn)), out,
      wetter.length ? h('h3', { class: 'sub' }, 'Wetter, Lawinenbericht') : null, wetter.length ? h('div', { class: 'list' }, wetter.map(l => TourHelp.linkRow(l))) : null,
      h('p', { class: 'muted small tl-note' }, 'Orientierung, keine Sicherheitsgarantie. Wetter, Lawinenlage und Gelände selbst prüfen.')], { id: 'passt-sec' }));
    return sec;
  },
  /** „Notizen & Quellen“: Notiz, Herkunft, Links. Alles wird beim Ändern gespeichert. */
  notizen(t, meta) {
    const box = h('div', { id: 'pnotes' }), P = Planhilfe;
    let links = P.ladeLinks(meta.links);
    const note = h('textarea', { rows: 4, id: 'pn-note', maxlength: P.MAX_NOTIZ, 'aria-label': 'Notiz zur Planung', placeholder: 'Zustieg, Einkehr, Alternativen, Dinge, die du nicht vergessen willst …',
      onchange: async e => { await PlanMeta.patch(t.id, { note: e.target.value }); toast('Notiz gespeichert'); } }, meta.note || '');
    const q = meta.quelle || {};
    const qs = h('select', { id: 'pn-qart', 'aria-label': 'Herkunft der Planung', onchange: () => saveQ() }, h('option', { value: '' }, 'Nicht angegeben'), P.QUELLEN.map(([k, l]) => h('option', { value: k, selected: q.art === k }, l)));
    const qt = h('input', { type: 'text', id: 'pn-qtext', maxlength: P.MAX_QTEXT, 'aria-label': 'Herkunft, Freitext', placeholder: 'z. B. Titel der Tour oder des Buchs', value: q.text || '', onchange: () => saveQ() });
    const saveQ = async () => { try { const r = P.pruefeQuelle(qs.value, qt.value); await PlanMeta.patch(t.id, { quelle: r }); toast('Herkunft gespeichert'); } catch (e) { toastFehler('Herkunft speichern', e); } };
    const list = h('div', { class: 'list', id: 'pn-links' });
    const draw = () => {
      list.innerHTML = '';
      links.forEach((l, i) => list.append(TourHelp.linkRow(l, async () => { links = links.filter((_, k) => k !== i); await PlanMeta.patch(t.id, { links }); draw(); toast('Link entfernt'); })));
      list.hidden = !links.length; add.disabled = links.length >= P.MAX_LINKS; add.textContent = links.length >= P.MAX_LINKS ? 'Höchstens ' + P.MAX_LINKS + ' Links' : 'Link hinzufügen';
    };
    const add = h('button', { class: 'btn sm', id: 'pn-addlink', onclick: () => {
      const ti = h('input', { type: 'text', id: 'lk-titel', maxlength: P.MAX_TITEL, placeholder: 'z. B. Wanderführer Seite 84' }), ad = h('input', { type: 'url', id: 'lk-url', placeholder: 'https://…', autocapitalize: 'off', autocomplete: 'off', inputmode: 'url' }),
        ar = h('select', { id: 'lk-art', 'aria-label': 'Art des Links' }, P.LINK_ARTEN.map(([k, l]) => h('option', { value: k }, l))), err = h('p', { class: 'err small', role: 'alert' });
      const s = sheet('Link hinzufügen', h('div', null, h('label', { class: 'fld' }, 'Titel (optional)', ti), h('label', { class: 'fld' }, 'Adresse', ad), h('label', { class: 'fld' }, 'Art', ar),
        h('p', { class: 'muted small' }, 'Nur Adressen mit http:// oder https://. Die Seite wird nicht automatisch geladen, sondern erst, wenn du den Link antippst.'), err,
        h('div', { class: 'row end' }, h('button', { class: 'btn pri', id: 'lk-save', onclick: async () => {
          try { const l = P.pruefeLinks(links.concat([{ titel: ti.value, url: ad.value, art: ar.value }])); links = l; }
          catch (e) { err.textContent = e.message.replace(/^Link \d+: /, ''); return; }
          await PlanMeta.patch(t.id, { links }); s.close(); draw(); toast('Link gespeichert');
        } }, 'Speichern'))));
      setTimeout(() => ad.focus(), 250);
    } }, 'Link hinzufügen');
    draw();
    box.append(UI.section('Notizen & Quellen', [UI.autoHoehe(note), h('div', { class: 'fld' }, 'Herkunft', qs, qt), h('h3', { class: 'sub' }, 'Links'), list, h('div', { class: 'row' }, add)], { id: 'pnotes-sec' }));
    return box;
  },
};
