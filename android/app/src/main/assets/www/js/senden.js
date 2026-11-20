'use strict';
/* Touren an Meine Touren senden (2.5.0). Nur auf ausdrücklichen Wunsch: Tourseite → „An Meine Touren senden“, Meine Touren → „Touren senden …“ (Auswahl) und – wenn eingeschaltet
   (Vorgabe aus) – nach dem Ende einer Aufzeichnung. Der Weg ist derselbe wie bei der Android-App von Meine Touren: POST /api/record/upload mit JSON { gpx, name, sport }.
   Der Server legt die Tour an und erkennt Doppelte am Start (Kennung g<Startzeit>); das Tagebuch fragt vorher die Tourenliste ab und erkennt zusätzlich Touren, die dort aus
   einer anderen Quelle (Zepp, Komoot …) stammen (gleicher Start ± 5 Minuten, ähnliche Länge). Notiz und Sterne gehen danach mit POST /api/tours/<id>/note und /rating – nur bei neu
   angelegten Touren, damit nichts am Server überschrieben wird. Fotos werden nicht gesendet. Gemerkt wird die Kennung (Tour.mtId), dann findet „Aus Meine Touren holen“ die Tour
   wieder und legt sie nicht doppelt an. Ein Konto „nur ansehen“ (Betrachter) darf nicht schreiben: die App sagt das, bevor sie etwas sendet. Das Passwort wird nirgends gespeichert. */
const Senden = {
  _busy: false,
  host(base) { try { return new URL(base).host; } catch (e) { return base; } },
  /** Ein Fehler mit Merkmalen: status (HTTP), wieder (Wiederholen lohnt), verboten (403), relogin (Sitzung abgelaufen), dauerhaft. */
  fehler(msg, o) { const e = new Error(msg); return Object.assign(e, o || {}); },
  /** POST mit Sitzung. Netzfehler → wieder; 401 → abgelaufen (Schlüssel wird vergessen). */
  async post(acc, path, json) {
    let r;
    try { r = await Import.MT.http(acc.base, path, { method: 'POST', json, token: acc.token }); }
    catch (e) { throw Senden.fehler(e.message, { wieder: true }); }
    if (r.status === 401) throw await Import.MT.expired(acc);
    return r;
  },

  /** Eine Tour senden. o: { liste (Tourenliste des Servers), lokal (Touren der App), upd(text) }. Gibt { status: 'gesendet' | 'vorhanden', id } zurück oder wirft (Merkmale siehe fehler()). */
  async eine(acc, t, o) {
    o = o || {}; const M = Import.MT, upd = o.upd || (() => {});
    const g = SendenCalc.pruefen(t, acc);
    if (!g.ok) throw Senden.fehler(g.grund, { code: g.code, dauerhaft: true, verboten: g.code === 'betrachter' });
    const pts = await Tours.points(t.id);
    if (pts.length < 2) throw Senden.fehler('Die Strecke dieser Tour ist leer.', { dauerhaft: true });
    upd('Prüfen, ob die Tour schon in Meine Touren ist …');
    let liste = o.liste;
    if (!liste) { try { liste = await M.tours(acc); } catch (e) { if (!e.relogin && !e.status) e.wieder = true; throw e; } }
    const lokal = o.lokal || await Tours.list();
    const m = SendenCalc.passend(t, liste);
    let id, neu = false, warn = null;
    if (m) id = String(m.id);
    else {
      upd('Tour wird gesendet …');
      const sp = SendenCalc.sport(t), body = { gpx: Geo.gpx(t.name, sp || '', pts), name: t.name };
      if (sp) body.sport = sp;
      const r = await Senden.post(acc, '/api/record/upload', body);
      if (r.status !== 200) { const d = M.detail(r, ''); throw Senden.fehler(SendenCalc.fehlerText(r.status, d), { status: r.status, wieder: SendenCalc.WIEDER(r.status), verboten: r.status === 403 }); }
      let j; try { j = JSON.parse(r.body); } catch (e) { j = null; }
      if (!j || j.id == null) throw Senden.fehler('Meine Touren hat die Tour angenommen, aber keine Kennung zurückgegeben.', { dauerhaft: true });
      id = String(j.id); neu = !j.dup;
      if (liste) liste.push({ id, start_ts: Math.round(t.start / 1000), dist_m: t.dist });      // für die nächsten Touren einer Auswahl
    }
    if (neu) {      // Notiz und Sterne: nur bei einer neu angelegten Tour; ein Fehler hier stört das Ergebnis nicht
      const note = String(t.note || '').trim(), st = Abgleich.sterne(t);
      try {
        if (note) { upd('Notiz wird gesendet …'); const r = await Senden.post(acc, '/api/tours/' + encodeURIComponent(id) + '/note', { note }); if (r.status !== 200) warn = 'Die Notiz ist nicht angekommen.'; }
        if (st) { const r = await Senden.post(acc, '/api/tours/' + encodeURIComponent(id) + '/rating', { stars: st }); if (r.status !== 200) warn = 'Die Sterne sind nicht angekommen.'; }
      } catch (e) { if (e.relogin) throw e; warn = 'Notiz und Sterne sind nicht angekommen.'; }
    }
    // Kennung merken (auch an dem Objekt der Seite, damit ein späteres Speichern sie nicht überschreibt); gehört sie schon einer anderen Tour der App, wird nicht verknüpft
    const frei = !lokal.some(x => x.id !== t.id && (String(x.mtId || '') === id || x.srcId === 'mt:' + id));
    const cur = (await DB.get('tours', t.id)) || t;
    for (const x of cur === t ? [t] : [cur, t]) { if (frei) x.mtId = id; x.mtSent = Date.now(); }
    await Tours.save(cur);
    return { status: neu ? 'gesendet' : 'vorhanden', id, warn };
  },
  /** Mehrere nacheinander. o: { stop(), onProgress(i, n, text) }. Rechte- und Anmeldefehler brechen alles ab (sie gälten für jede Tour), ebenso ein nicht erreichbarer Server. */
  async mehrere(acc, tours, o) {
    o = o || {};
    const res = { gesendet: 0, vorhanden: 0, fehler: [], stopped: false, abbruch: null };
    const liste = await Import.MT.tours(acc), lokal = await Tours.list();
    for (let i = 0; i < tours.length; i++) {
      if (o.stop && o.stop()) { res.stopped = true; break; }
      const t = tours[i];
      if (o.onProgress) o.onProgress(i, tours.length, t.name);
      try {
        const r = await Senden.eine(acc, t, { liste, lokal });
        if (r.status === 'gesendet') res.gesendet++; else res.vorhanden++;
        if (r.warn) res.fehler.push({ name: t.name, text: r.warn });
      } catch (e) {
        if (e.relogin || e.verboten) throw e;
        res.fehler.push({ name: t.name, text: e.message });
        if (e.wieder && !e.status) { res.abbruch = e.message; break; }      // Server nicht erreichbar: die übrigen würden ebenso scheitern
      }
    }
    Tours.invalidate();
    return res;
  },

  /* ---------------------------------------------------------------- Oberfläche ---------------------------------------------------------------- */
  /** Ja/Nein-Blatt mit Kennungen (send-ja, send-nein). Gibt true bei „ja“ zurück. */
  frage(title, inhalt, ja) {
    return new Promise(res => {
      let done = false;
      const s = sheet(title, h('div', { id: 'send-frage' }, inhalt,
        h('div', { class: 'row end' }, h('button', { class: 'btn', id: 'send-nein', onclick: () => { done = true; s.close(); res(false); } }, 'Abbrechen'),
          h('button', { class: 'btn pri', id: 'send-ja', onclick: () => { done = true; s.close(); res(true); } }, ja))), { onclose: () => { if (!done) res(false); } });
    });
  },
  /** Warum es nicht geht (Konto „nur ansehen“, keine Verbindung, geplante Tour …) – ruhig und in Worten. */
  erklaeren(g) {
    const s = sheet(g.code === 'betrachter' ? 'Dafür brauchst du ein Konto mit Schreibrechten' : 'Senden nicht möglich', h('div', { id: 'send-grund' },
      h('p', { id: 'send-grund-t' }, g.grund),
      h('div', { class: 'row end wrap' },
        g.code === 'betrachter' || g.code === 'verbindung' ? h('a', { class: 'btn', id: 'send-zu-mt', href: '#/import', onclick: () => s.close() }, 'Zu „Touren importieren“') : null,
        h('button', { class: 'btn pri', id: 'send-ok', onclick: () => s.close() }, 'OK'))));
  },
  /** Gemeinsame Vorabprüfung der Verbindung: gibt das Konto zurück oder null (dann wurde schon erklärt). */
  async konto(t) {
    const acc = await DB.kvGet('mt', null);
    const g = t ? SendenCalc.pruefen(t, acc) : (SendenCalc.pruefen({ timed: true, start: 1, status: 'done' }, acc));
    if (!g.ok) { Senden.erklaeren(g); return null; }
    return acc;
  },
  /** http außerhalb des eigenen Netzes: dieselbe Rückfrage wie beim Verbinden. */
  async httpOk(acc) {
    if (!/^http:/.test(acc.base) || Import.MT.privat(acc.base)) return true;
    return Senden.frage('Unverschlüsselt senden?', h('p', null, 'Die Adresse von Meine Touren beginnt mit http. Die Tour geht dann unverschlüsselt durch das Netz und kann mitgelesen werden. Sicherer ist eine Adresse mit https.'), 'Trotzdem senden');
  },
  /** Tourseite: eine Tour senden – mit Rückfrage, Fortschritt und Ergebnis. after(): danach (z. B. Seite neu zeichnen). */
  async dialog(t, after) {
    if (Senden._busy) { toast('Es läuft schon ein Senden.'); return null; }
    const acc = await Senden.konto(t); if (!acc) return null;
    if (!await Senden.httpOk(acc)) return null;
    const bits = [F.date(t.start), F.km(t.dist), t.up ? '↑ ' + F.m(t.up) : null].filter(Boolean).join(' · ');
    if (!await Senden.frage('An Meine Touren senden?', h('div', null,
      h('p', { id: 'send-name' }, h('b', null, t.name)), h('p', { class: 'muted', id: 'send-info' }, bits),
      h('p', null, 'Die Tour wird an ', h('b', null, Senden.host(acc.base)), ' gesendet' + (acc.name ? ' (Konto ' + acc.name + ')' : '') + '.'),
      h('p', { class: 'muted small' }, 'Name, Sportart, Strecke mit Zeiten und Höhen, Notiz und Sterne gehen mit. Fotos nicht. Ist die Tour dort schon vorhanden, wird nichts doppelt angelegt.')), 'Senden')) return null;
    Senden._busy = true; let r = null, err = null;
    try {
      r = await PhotoSources.progress('An Meine Touren senden', async upd => { let k = 0; return Senden.eine(acc, t, { upd: text => upd(Math.min(++k, 3), 4, null, text) }); }, { note: 'Bitte die App geöffnet lassen, bis das Senden fertig ist.' });
    } catch (e) { err = e; }
    finally { Senden._busy = false; }
    if (err) { toast('Nicht gesendet: ' + err.message, 9000); if (err.relogin && Nav.cur === '/import') Nav.render(); return null; }
    toast(r.status === 'gesendet' ? '„' + t.name + '“ wurde an Meine Touren gesendet.' + (r.warn ? ' ' + r.warn : '') : '„' + t.name + '“ war schon in Meine Touren – nichts doppelt angelegt.', 7000);
    Tours.invalidate(); if (after) after();
    return r;
  },
  /** Meine Touren → „Touren senden …“: Auswahl aus den noch nicht gesendeten Touren (neueste zuerst; nichts ist vorgewählt). */
  async auswahl(after) {
    const acc0 = await DB.kvGet('mt', null);
    const g = SendenCalc.pruefen({ timed: true, start: 1, status: 'done' }, acc0);
    if (!g.ok) { Senden.erklaeren(g); return; }
    const kand = SendenCalc.kandidaten(await Tours.list(), acc0), pick = new Set();
    if (!kand.length) { toast('Es gibt keine Touren zu senden: Alle sind schon in Meine Touren (oder haben keine Zeitstempel).', 7000); return; }
    let shown = 40;
    const list = h('div', { class: 'list', id: 'send-liste' }), more = h('button', { class: 'btn sm', id: 'send-mehr' }, 'Weitere anzeigen');
    const go = h('button', { class: 'btn pri', id: 'send-los', disabled: true }, 'Senden'), cnt = h('p', { class: 'muted small', id: 'send-zahl', 'aria-live': 'polite' });
    const upd = () => { go.disabled = !pick.size; go.textContent = pick.size ? pick.size + (pick.size === 1 ? ' Tour senden' : ' Touren senden') : 'Senden'; cnt.textContent = pick.size + ' von ' + kand.length + ' ausgewählt'; };
    const draw = () => {
      list.innerHTML = '';
      kand.slice(0, shown).forEach(t => list.append(h('label', { class: 'li send-row', 'data-id': t.id },
        h('input', { type: 'checkbox', checked: pick.has(t.id), onchange: e => { if (e.target.checked) pick.add(t.id); else pick.delete(t.id); upd(); } }),
        h('span', { class: 'li-t' }, h('b', null, t.name), h('small', null, [F.date(t.start), F.km(t.dist), Sports.label(t.sport)].join(' · '))))));
      more.hidden = shown >= kand.length; upd();
    };
    more.onclick = () => { shown += 40; draw(); };
    const s = sheet('Touren an Meine Touren senden', h('div', { id: 'send-auswahl' },
      h('p', { class: 'muted' }, 'Wähle die Touren, die an ' + Senden.host(acc0.base) + ' gesendet werden sollen. Was dort schon vorhanden ist, wird nicht doppelt angelegt. Fotos werden nicht gesendet.'),
      h('div', { class: 'row wrap' },
        h('button', { class: 'btn sm', id: 'send-alle', onclick: () => { kand.forEach(t => pick.add(t.id)); draw(); } }, 'Alle ' + kand.length + ' markieren'),
        h('button', { class: 'btn sm', id: 'send-keine', onclick: () => { pick.clear(); draw(); } }, 'Keine')), cnt, list, more,
      h('div', { class: 'row end' }, go)));
    go.onclick = async () => {
      const ts = kand.filter(t => pick.has(t.id));
      if (!ts.length) return;
      if (!await Senden.httpOk(acc0)) return;
      if (!await Senden.frage('Wirklich senden?', h('p', null, ts.length + (ts.length === 1 ? ' Tour wird' : ' Touren werden') + ' an ' + Senden.host(acc0.base) + ' gesendet (Konto ' + (acc0.name || '–') + ').'), 'Senden')) return;
      s.close(); await Senden.mitFortschritt(acc0, ts, after);
    };
    draw();
  },
  /** Auswahl senden: Fortschrittsblatt mit „Abbrechen“, dann eine Zusammenfassung in Worten. */
  async mitFortschritt(acc, ts, after) {
    if (Senden._busy) { toast('Es läuft schon ein Senden.'); return null; }
    Senden._busy = true; let halt = false, r = null, err = null;
    try {
      r = await PhotoSources.progress('An Meine Touren senden', upd => Senden.mehrere(acc, ts, { stop: () => halt, onProgress: (i, n, name) => upd(i, n, name) }),
        { cancel: () => { halt = true; }, note: 'Bitte die App geöffnet lassen, bis das Senden fertig ist.' });
    } catch (e) { err = e; }
    finally { Senden._busy = false; }
    Tours.invalidate();
    if (err) { toast('Nicht gesendet: ' + err.message, 9000); if (after) after(); return null; }
    const s = sheet(r.stopped ? 'Senden abgebrochen' : 'Gesendet', h('div', { id: 'send-ergebnis' }, h('p', { id: 'send-ergebnis-t' }, SendenCalc.zusammen(r)),
      r.fehler.length > 1 ? UI.list(r.fehler.slice(0, 8).map(f => UI.row({ title: f.name, sub: f.text }))) : null,
      h('div', { class: 'row end' }, h('button', { class: 'btn pri', id: 'send-fertig', onclick: () => s.close() }, 'Fertig'))), { onclose: () => { if (after) after(); } });
    return r;
  },

  /* ---------------------------------------------------------------- Automatisch nach der Aufzeichnung (Vorgabe aus) ---------------------------------------------------------------- */
  /** Nach dem Speichern einer Aufzeichnung: vormerken und senden. Still: nur eine kurze Meldung; schlägt es fehl, bleibt die Tour vorgemerkt und wird später erneut versucht
      (beim nächsten Start der App und nach der nächsten Aufzeichnung, höchstens fünfmal). Ohne Einschalten, Verbindung oder Schreibrechte geschieht nichts. */
  async auto(t) {
    try {
      if (!Set_.get('mtAuto') || !t) return;
      const acc = await DB.kvGet('mt', null);
      if (!SendenCalc.pruefen(t, acc).ok) return;
      await DB.kvSet('mtOffen', SendenCalc.queueAdd(await DB.kvGet('mtOffen', []), t.id));      // zuerst vormerken: stirbt die App mittendrin, geht es beim nächsten Start weiter
      await Senden.nachholen();
    } catch (e) { console.error('Automatisch senden', e); }
  },
  /** Vorgemerkte Touren senden (leise). Dauerhafte Fehler (Rechte, Anmeldung, leere Strecke) streichen die Tour aus der Warteschlange; Netzfehler und Serverfehler zählen mit. */
  async nachholen() {
    if (Senden._busy) return;
    Senden._busy = true;
    try {
      let q = await DB.kvGet('mtOffen', []);
      if (!Array.isArray(q) || !q.length) return;
      const acc = await DB.kvGet('mt', null);
      if (!Set_.get('mtAuto') || !(acc && (acc.token || acc.open)) || acc.role === 'viewer') return;
      let ok = 0, vorh = 0, bad = null;
      for (const e of q.slice()) {
        const t = await DB.get('tours', e.id);
        if (!t || t.mtId) { q = SendenCalc.queueNach(q, e.id, { ok: true }); continue; }
        try {
          const r = await Senden.eine(acc, t);
          if (r.status === 'gesendet') ok++; else vorh++;
          q = SendenCalc.queueNach(q, e.id, { ok: true });
        } catch (err) {
          bad = err; q = SendenCalc.queueNach(q, e.id, { ok: false, wieder: !!err.wieder && !err.relogin });
          if (err.wieder || err.relogin) break;      // Server nicht erreichbar oder Sitzung abgelaufen: der Rest scheitert ebenso
        }
      }
      await DB.kvSet('mtOffen', q);
      if (ok || vorh) { toast(ok ? 'Tour an Meine Touren gesendet.' : 'Die Tour war schon in Meine Touren.', 4000); Tours.invalidate(); }
      else if (bad) toast(bad.wieder ? 'Senden an Meine Touren hat nicht geklappt – wird später noch einmal versucht.' : 'Nicht an Meine Touren gesendet: ' + bad.message, 8000);
    } finally { Senden._busy = false; }
  },
};
