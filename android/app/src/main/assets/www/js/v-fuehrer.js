'use strict';
/* Wanderführer (2.4.0): Bücher mit Buchtouren (je eine GPX-Datei), Fortschritt „x von y gewandert“, Titelbild, Startseiten-Zeile.
   Gespeichert wird in der Tabelle kv (das Datenbankschema bleibt unverändert, die Sicherung nimmt alles mit):
     guides           Liste der Bücher: {id, name, created, next, cover (0/1), touren: [{id, ord, title, km, up, la, lo, bb, n, f}]}   (ohne Punkte, klein)
     guidepts:<Buch>  Punkte aller Buchtouren des Buchs, platzsparend gepackt (Fuehrer.packe): {t0: {la, lo, e}, …}
     guidecover:<Buch> Titelbild als kleines JPEG (Daten-Adresse, ≈ 400 px Kante)
     guideMatch       Zwischenspeicher des Abgleichs (nicht Teil der Sicherung)
   Die Rechnung steht in js/calc-fuehrer.js. */
const Buecher = {
  KEY: 'guides', COVER_PX: 400,
  _q: Promise.resolve(), _run: null, _neu: false, _hoerer: new Set(), coverMem: {},
  ui: { filter: 'alle', suche: '', sort: 'buch', offen: new Set() },      // Zustand der Seite (nur im Speicher)

  /* ---------- Speicher ---------- */
  async liste() {
    const l = await DB.kvGet(Buecher.KEY, []);
    return (Array.isArray(l) ? l : []).filter(b => b && typeof b.id === 'string' && typeof b.name === 'string' && Array.isArray(b.touren));
  },
  /** Lesen–ändern–schreiben nacheinander (nie zwei Änderungen gleichzeitig). fn(liste) gibt die neue Liste zurück (oder undefined = unverändert). */
  async aendere(fn) {
    const p = Buecher._q.then(async () => { const l = await Buecher.liste(), r = await fn(l); if (r) await DB.kvSet(Buecher.KEY, r); Buecher.geaendert(); return r || l; });
    Buecher._q = p.catch(() => {}); return p;
  },
  /** Läuft gerade ein Abgleich, wird er abgebrochen und mit dem neuen Stand wiederholt. */
  geaendert() { if (Buecher._run) Buecher._neu = true; },
  async punkte(id) {      // → {buchtourId: [{lat, lon, ele}]}
    const o = await DB.kvGet('guidepts:' + id, {}), out = {};
    for (const k of Object.keys(o || {})) out[k] = Fuehrer.entpacke(o[k]);
    return out;
  },
  async cover(id) { if (id in Buecher.coverMem) return Buecher.coverMem[id]; const c = await DB.kvGet('guidecover:' + id, null); return (Buecher.coverMem[id] = typeof c === 'string' && c.startsWith('data:image/') ? c : null); },
  async setzeCover(id, dataUrl) {
    if (dataUrl) await DB.kvSet('guidecover:' + id, dataUrl); else await DB.del('kv', 'guidecover:' + id);
    Buecher.coverMem[id] = dataUrl || null;
    await Buecher.aendere(l => { const b = l.find(x => x.id === id); if (!b) return; b.cover = dataUrl ? 1 : 0; return l; });
  },
  async entferne(id) {
    await Buecher.aendere(l => l.filter(b => b.id !== id));
    await DB.del('kv', 'guidepts:' + id); await DB.del('kv', 'guidecover:' + id); delete Buecher.coverMem[id]; Buecher.ui.offen.delete(id);
  },
  async umbenenne(id, name) { await Buecher.aendere(l => { const b = l.find(x => x.id === id); if (!b) return; b.name = name.slice(0, 120); return l; }); },
  /** Aus einer Sicherung: Bücher, die es hier noch nicht gibt, kommen dazu (Vorhandenes bleibt). Gibt die Zahl der neuen Bücher zurück. */
  async mergeFrom(list) {
    if (!Array.isArray(list)) return 0;
    let n = 0;
    await Buecher.aendere(l => {
      const ids = new Set(l.map(b => b.id));
      for (const b of list) if (b && typeof b.id === 'string' && typeof b.name === 'string' && Array.isArray(b.touren) && !ids.has(b.id)) { l.push(b); ids.add(b.id); n++; }
      return n ? l : undefined;
    });
    return n;
  },

  /* ---------- Dateien ---------- */
  /** Dateiauswahl: in der Android-Hülle der Auswahldialog des Systems (mehrere Dateien), sonst ein Dateifeld des Browsers. Gibt [{name, url}] zurück. */
  async waehle(accept, mehrere) {
    if (window.MTApp) return (await Native.json('pickFiles')) || [];
    return new Promise(res => {
      const inp = h('input', { type: 'file', accept, multiple: !!mehrere, hidden: true, id: 'fu-datei' });
      inp.onchange = () => { const fs = [...inp.files].map(f => ({ name: f.name, url: URL.createObjectURL(f) })); inp.remove(); res(fs); };
      inp.addEventListener('cancel', () => { inp.remove(); res([]); });
      document.body.append(inp); inp.click();
    });
  },
  /** Dateien lesen: GPX direkt, ZIP-Dateien werden ausgepackt (alle .gpx darin). → [{name, text}] und die nicht lesbaren Namen. */
  async lese(files, fort) {
    const ok = [], bad = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i]; if (fort) fort(i + 1, files.length, f.name);
      try {
        const buf = await Import.fetchBuf(f.url), isZip = /\.zip$/i.test(f.name) || (buf[0] === 0x50 && buf[1] === 0x4b);
        if (isZip) {
          const z = fflate.unzipSync(buf); let n = 0;
          for (const k of Object.keys(z)) if (/\.gpx$/i.test(k) && !/(^|\/)(__MACOSX|\.)/.test(k)) { ok.push({ name: k, text: new TextDecoder('utf-8').decode(z[k]) }); n++; }
          if (!n) bad.push(f.name);
        } else ok.push({ name: f.name, text: new TextDecoder('utf-8').decode(buf) });
      } catch (e) { bad.push(f.name); }
      if (i % 5 === 4) await sleep(0);
    }
    return { ok, bad };
  },
  /** Buchtouren aus den gelesenen Dateien. Gibt {neu: [{meta, pts}], schon, bad: [Namen]} zurück; `vorhanden` = schon vorhandene Buchtouren (gleicher Titel und gleiche Länge zählen nicht doppelt). */
  baue(gelesen, vorhanden, ord0) {
    const out = { neu: [], schon: 0, bad: gelesen.bad.slice() };
    const l = gelesen.ok.slice().sort((a, b) => Fuehrer.natuerlich(a.name, b.name));
    let ord = ord0;
    for (const f of l) {
      try {
        const g = Fuehrer.lies(f.text, f.name);
        if (vorhanden.concat(out.neu.map(x => x.meta)).some(t => t.title === g.titel && Math.abs(t.km - g.km) < 0.05)) { out.schon++; continue; }
        out.neu.push(Fuehrer.buchtour(g, ord++, f.name));
      } catch (e) { out.bad.push(f.name); }
    }
    return out;
  },
  /** Neues Buch mit den Dateien anlegen (name leer: Buch `id` ergänzen). Gibt {buch, anzahl, schon, bad} zurück. */
  async speichere(id, name, gelesen) {
    const alt = id ? (await Buecher.liste()).find(b => b.id === id) : null;
    const bid = id || uid().slice(-9), b = Buecher.baue(gelesen, alt ? alt.touren : [], alt ? alt.next : 0);
    if (!b.neu.length) return { buch: alt, anzahl: 0, schon: b.schon, bad: b.bad };
    const pts = alt ? await DB.kvGet('guidepts:' + bid, {}) : {};
    for (const t of b.neu) pts[t.meta.id] = Fuehrer.packe(t.pts);
    await DB.kvSet('guidepts:' + bid, pts);
    let buch;
    await Buecher.aendere(l => {
      buch = l.find(x => x.id === bid);
      if (!buch) { buch = { id: bid, name: name.slice(0, 120), created: Date.now(), next: 0, cover: 0, touren: [] }; l.push(buch); }
      for (const t of b.neu) buch.touren.push(t.meta);
      buch.next = Math.max(buch.next || 0, ...buch.touren.map(t => t.ord + 1));
      return l;
    });
    return { buch, anzahl: b.neu.length, schon: b.schon, bad: b.bad };
  },

  /* ---------- Titelbild ---------- */
  /** Bild verkleinern (längste Kante höchstens px) und als kleines JPEG (Daten-Adresse) zurückgeben. Das Original wird nie gespeichert. */
  async verkleinere(url, px) {
    const blob = await (await fetch(url)).blob();
    let bmp;
    try { bmp = await createImageBitmap(blob); }
    catch (e) { bmp = await new Promise((ok, fail) => { const u = URL.createObjectURL(blob), im = new Image(); im.onload = () => { URL.revokeObjectURL(u); ok(im); }; im.onerror = () => { URL.revokeObjectURL(u); fail(new Error('Bild nicht lesbar')); }; im.src = u; }); }
    const w = bmp.width || bmp.naturalWidth, hh = bmp.height || bmp.naturalHeight; if (!w || !hh) throw new Error('Bild nicht lesbar');
    const s = Math.min(1, (px || Buecher.COVER_PX) / Math.max(w, hh)), cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round(w * s)); cv.height = Math.max(1, Math.round(hh * s));
    const g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height); g.drawImage(bmp, 0, 0, cv.width, cv.height);
    if (bmp.close) bmp.close();
    let q = .82, d = cv.toDataURL('image/jpeg', q);
    while (d.length > 90000 && q > .45) { q -= .12; d = cv.toDataURL('image/jpeg', q); }
    if (!d.startsWith('data:image/jpeg')) throw new Error('Bild nicht lesbar');
    return d;
  },
  async waehleCover(b, nachher) {
    try {
      const f = await Buecher.waehle('image/*', false); if (!f.length) return;
      toast('Titelbild wird verkleinert …');
      await Buecher.setzeCover(b.id, await Buecher.verkleinere(f[0].url, Buecher.COVER_PX));
      toast('Titelbild gespeichert'); if (nachher) nachher();
    } catch (e) { toast('Dieses Bild lässt sich nicht lesen (JPEG, PNG oder WebP).'); }
  },

  /* ---------- Abgleich ---------- */
  /** Gleicht alle Touren mit allen Buchtouren ab (nur das Fehlende, in Blöcken). Mehrere Aufrufer teilen sich einen Lauf; hoerer: {fortschritt(anteil), teil(stand), ende(stand)}. */
  sync(hoerer) {
    if (hoerer) Buecher._hoerer.add(hoerer);
    if (!Buecher._run) Buecher._run = Buecher._lauf().finally(() => { Buecher._run = null; Buecher._hoerer.clear(); });
    return Buecher._run;
  },
  async _lauf() {
    let st = null;
    do {
      Buecher._neu = false;
      const buecher = await Buecher.liste();
      const touren = await Tours.list(), cache = await DB.kvGet('guideMatch', null);
      const res = await Fuehrer.rechne({ buecher, touren, cache,
        ladePunkte: async id => { const r = await DB.get('tracks', id); return r && r.lat ? r.lat.map((la, i) => ({ lat: la, lon: r.lon[i] })) : []; },
        ladeBuch: id => Buecher.punkte(id), pause: () => new Promise(r => setTimeout(r, 0)), abbrechen: () => Buecher._neu,
        fortschritt: a => Buecher._hoerer.forEach(hh => { try { if (hh.fortschritt) hh.fortschritt(a); } catch (e) { /* s. u. */ } }),
        teil: s => Buecher._hoerer.forEach(hh => { try { if (hh.teil) hh.teil(s); } catch (e) { /* ein Zuhörer stört den Lauf nicht */ } }) });
      await DB.kvSet('guideMatch', res.cache); st = res.stand;
    } while (Buecher._neu);
    Buecher._hoerer.forEach(hh => { try { if (hh.ende) hh.ende(st); } catch (e) { /* ein Zuhörer stört den Lauf nicht */ } });
    return st;
  },
  /** Stand aus dem Zwischenspeicher, ohne zu rechnen. */
  async stand(buecher) { return Fuehrer.stand(buecher || await Buecher.liste(), await Tours.list(), await DB.kvGet('guideMatch', null)); },

  /** Welchen Buchtouren folgt diese Tour? (Tourseite, Namensvorschlag) → [{buchId, buch, id, title, km, up, wert}], höchstens zwei. */
  async fuerTour(t, pts) {
    const l = await Buecher.liste(); if (!l.length) return [];
    return Fuehrer.fuerTour(t, pts, l, id => Buecher.punkte(id), 2);
  },
  /** Ruhige Zeile auf der Tourseite: „Aus dem Buch: Titel (Buch)“. */
  async zeile(t, pts) {
    const m = await Buecher.fuerTour(t, pts); if (!m.length) return null;
    return h('p', { class: 'muted small', id: 'imbuch' }, 'Aus dem Buch: ' + m.map(x => x.title + ' (' + x.buch + ')').join(' · '));
  },

  /* ---------- Bausteine ---------- */
  /** Ringdiagramm: gewandert gegen offen, Prozent in der Mitte; lesbar auch ohne Farbe (Text im aria-label). */
  ring(fertig, gesamt) {
    const r = 23, c = 2 * Math.PI * r, p = gesamt > 0 ? Math.min(1, fertig / gesamt) : 0, pr = Fuehrer.prozent(fertig, gesamt);
    return `<svg class="fu-ring" viewBox="0 0 60 60" width="60" height="60" role="img" aria-label="${esc(fertig + ' von ' + gesamt + ' gewandert, ' + pr + ' Prozent')}">` +
      `<circle class="fu-track" cx="30" cy="30" r="${r}" fill="none" stroke-width="7"/>` +
      (p > 0 ? `<circle class="fu-arc" cx="30" cy="30" r="${r}" fill="none" stroke-width="7" stroke-dasharray="${(p * c).toFixed(2)} ${(c + 1).toFixed(2)}" transform="rotate(-90 30 30)"/>` : '') +
      `<text class="fu-pct" x="30" y="30" text-anchor="middle" dominant-baseline="central">${pr} %</text></svg>`;
  },
  datum: ms => F.dshort(ms),
  zahlen: bt => [F.km(bt.km * 1000), bt.up != null ? '↑ ' + F.m(bt.up) : null].filter(Boolean).map(x => x.replace(/ /g, '\u00a0')).join(' · '),      // Zahl und Einheit bleiben zusammen

  /** Blatt „Buch anlegen“ (id leer) bzw. „GPX-Dateien hinzufügen“ (id gesetzt). */
  anlegen(id, fertig) {
    const name = h('input', { type: 'text', id: 'fu-name', placeholder: 'z. B. Rother Wanderführer Gran Canaria', maxlength: 120, 'aria-label': 'Name des Buchs' }), err = h('p', { class: 'err', id: 'fu-err', role: 'alert' });
    const box = h('div');
    const s = sheet(id ? 'GPX-Dateien hinzufügen' : 'Buch anlegen', box);
    const hinweis = h('p', { class: 'muted small' }, 'Wähle die GPX-Dateien des Buchs (bei Rother im Download-Bereich zum Buch). Du kannst mehrere auf einmal wählen; eine ZIP-Datei mit GPX-Dateien geht auch.');
    const go = h('button', { class: 'btn pri', id: 'fu-go', onclick: async () => {
      const nm = name.value.trim();
      if (!id && !nm) { err.textContent = 'Bitte einen Namen für das Buch eingeben.'; name.focus(); return; }
      err.textContent = '';
      let files; try { files = await Buecher.waehle('.gpx,.zip,application/gpx+xml,application/zip,application/octet-stream', true); } catch (e) { err.textContent = e.message; return; }
      if (!files.length) return;
      const txt = h('p', { id: 'fu-lese', role: 'status', 'aria-live': 'polite' }, 'Dateien werden gelesen …'), bar = h('div', { class: 'prog' }, h('i'));
      box.innerHTML = ''; box.append(txt, bar);
      try {
        const g = await Buecher.lese(files, (i, n, f) => { txt.textContent = 'Datei ' + i + ' von ' + n + ' wird gelesen …'; bar.firstChild.style.width = (i / n * 100) + '%'; });
        txt.textContent = 'Buchtouren werden gespeichert …';
        const r = await Buecher.speichere(id || null, nm, g);
        s.close();
        const teile = [r.anzahl + (r.anzahl === 1 ? ' Buchtour' : ' Buchtouren') + (id ? ' hinzugefügt' : ' angelegt')];
        if (r.schon) teile.push(r.schon + ' schon vorhanden');
        if (r.bad.length) teile.push(r.bad.length + ' nicht lesbar (' + r.bad.slice(0, 2).join(', ') + (r.bad.length > 2 ? ' …' : '') + ')');
        toast(r.anzahl || id ? teile.join(' · ') : 'Keine Buchtour gefunden: ' + (r.bad.length ? r.bad.slice(0, 2).join(', ') + ' nicht lesbar' : 'die Dateien enthalten keine Strecke'), 6000);
        if (r.buch) Buecher.ui.offen.add(r.buch.id);
        if (fertig) fertig(r);
      } catch (e) { s.close(); toast((id ? 'GPX-Dateien hinzufügen' : 'Buch anlegen') + ' nicht möglich: ' + e.message, 6000); }
    } }, 'GPX-Dateien wählen');
    box.append(...(id ? [] : [h('label', { class: 'fld' }, 'Name des Buchs', name)]), hinweis, err,
      h('div', { class: 'row end' }, h('button', { class: 'btn', onclick: () => s.close() }, 'Abbrechen'), go));
    if (!id) setTimeout(() => name.focus(), 250);
    return s;
  },

  /* ---------- 2.13.0: als Datei übertragen (Rechnung in js/calc-fuehrer-datei.js) ---------- */
  /** Blatt „Wanderführer exportieren“: Schalter für die (selbst gewählten) Titelbilder, Vorgabe aus; dann JSON nach Download/Tourentagebuch. */
  exportBlatt() {
    let mitCover = false;
    const go = h('button', { class: 'btn pri', id: 'fu-ex-go', onclick: async () => {
      go.disabled = true;
      try { const r = await Buecher.exportieren({ mitCover }); s.close(); if (r) toast('Wanderführer exportiert: ' + r.ort + ' · ' + r.buecher + (r.buecher === 1 ? ' Buch' : ' Bücher'), 6000); }
      catch (e) { go.disabled = false; toastFehler('Export', e, 6000); }
    } }, 'Exportieren');
    const s = sheet('Wanderführer exportieren', h('div', { id: 'fu-ex' },
      h('p', null, 'Speichert deine Bücher mit allen Buchtouren (Titel, Strecke mit Linie auf der Karte, Aufstieg) als Datei – zum Übertragen auf ein anderes Gerät oder zum Aufheben. Dabei steht auch, welche Buchtouren du gewandert bist (Datum und Name der Tour).'),
      h('p', { class: 'muted small' }, 'Keine Spuren deiner Touren, keine Fotos, keine Zugangsdaten. Die Datei bleibt auf dem Handy (Download/Tourentagebuch); weitergegeben wird sie nur, wenn du sie selbst verschickst.'),
      UI.toggle('Titelbilder mitnehmen (deine eigenen Bilder, größere Datei)', false, v => { mitCover = !!v; }, { id: 'fu-ex-cover' }),
      h('div', { class: 'row end' }, h('button', { class: 'btn', onclick: () => s.close() }, 'Abbrechen'), go)));
    return s;
  },
  /** Exportdatei schreiben. Gibt { ort, buecher, bytes } zurück (null ohne Bücher). */
  async exportieren(o) {
    const buecher = await Buecher.liste();
    if (!buecher.length) { toast('Noch kein Buch angelegt.'); return null; }
    const pts = {}, covers = {}, gew = {}, st = await Buecher.stand(buecher), tm = Object.fromEntries((await Tours.list()).map(t => [t.id, t]));
    for (const b of buecher) {
      pts[b.id] = await DB.kvGet('guidepts:' + b.id, {});
      if (o && o.mitCover && b.cover) covers[b.id] = await Buecher.cover(b.id);
      const sb = (st.buecher[b.id] || { touren: {} }).touren; gew[b.id] = {};
      for (const k of Object.keys(sb)) gew[b.id][k] = (sb[k] || []).map(id => tm[id]).filter(Boolean).map(t => ({ start: t.start, name: t.name }));
    }
    const data = FuehrerDatei.exportiere(buecher, pts, covers, gew, { mitCover: !!(o && o.mitCover), app: 'Mein Tourentagebuch ' + (window.MTApp && MTApp.version ? MTApp.version() : '') });
    const text = JSON.stringify(data), name = FuehrerDatei.dateiname(Date.now());
    let ort;
    try { ort = await Native.json('saveFile', { name, mime: 'application/json', text }); }
    catch (e) { const a = h('a', { href: URL.createObjectURL(new Blob([text], { type: 'application/json' })), download: name }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 60000); ort = name; }
    return { ort, buecher: data.buecher.length, bytes: text.length };
  },
  /** „Wanderführer importieren“: Datei wählen, prüfen, Rückfrage mit Zusammenfassung und Konflikten, dann zusammenführen (nichts wird überschrieben). */
  async importieren(fertig) {
    let files; try { files = await Buecher.waehle('.json,application/json', false); } catch (e) { toastFehler('Datei wählen', e, 5000); return; }
    if (!files || !files.length) return;
    let d;
    try { d = FuehrerDatei.lies(new TextDecoder('utf-8').decode(await Import.fetchBuf(files[0].url))); }
    catch (e) { toastFehler('Wanderführer importieren', e, 7000); return; }
    return Buecher.zeigePlan(d, 'Wanderführer importieren', fertig);
  },
  /** 2.15.0: „Aus Meine Touren holen“ – nur bei „Mit Meine Touren zusammenarbeiten“ und bestehender Verbindung. Gleicher Netzweg wie „Aus Meine Touren holen“
      bei den Touren (Import.MT.get mit der Sitzung, auch ein Betrachter-Konto genügt): GET /api/guides/export (Meine Touren ab 3.56.0), Titelbilder nur auf Wunsch (?cover=1).
      Danach dieselbe Rückfrage mit Zusammenfassung und Unterschieden wie beim Dateiimport; erst „Übernehmen“ ändert etwas. */
  async ausMt(fertig) {
    const acc = await MT.konto();
    if (!acc) { toast('Es besteht keine Verbindung zu Meine Touren.'); return; }
    let mitCover = false;
    const go = h('button', { class: 'btn pri', id: 'fu-mt-go', onclick: async () => {
      go.disabled = true;
      let d;
      try { d = await Buecher.holeMt(acc, mitCover); }
      catch (e) { go.disabled = false; s.close(); toastFehler('Wanderführer holen', e, 7000); if (e.relogin) Nav.render(); return; }      // Sitzung abgelaufen: der Knopf verschwindet, bis man sich unter „Touren importieren“ neu anmeldet
      s.close();
      return Buecher.zeigePlan(d, 'Aus Meine Touren holen', fertig);
    } }, 'Holen');
    const s = sheet('Aus Meine Touren holen', h('div', { id: 'fu-mt-blatt' },
      h('p', null, 'Holt deine Wanderführer (Bücher mit Buchtouren) von deinem Server „Meine Touren“. Vor dem Übernehmen siehst du, was dazukommt.'),
      UI.toggle('Titelbilder mitholen (größere Datenmenge)', false, v => { mitCover = !!v; }, { id: 'fu-mt-cover' }),
      h('div', { class: 'row end' }, h('button', { class: 'btn', onclick: () => s.close() }, 'Abbrechen'), go)));
    return s;
  },
  /** Wanderführer vom Server laden und prüfen (FuehrerDatei.lies). Wirft mit verständlicher Meldung; 401 → Anmeldung abgelaufen (e.relogin). */
  async holeMt(acc, mitCover) {
    if (!MT.aktiv()) throw new Error('Die Zusammenarbeit mit Meine Touren ist ausgeschaltet.');      // Sicherung: kein Netzaufruf bei Aus
    const r = await Import.MT.get(acc, MTCalc.fuehrerPfad(mitCover));      // 401: Sitzung vergessen, Meldung „Anmeldung abgelaufen“ (wie bei den Touren)
    if (r.status !== 200) throw new Error(MTCalc.fuehrerFehler(r.status));
    return FuehrerDatei.lies(r.body);
  },
  /** Rückfrage mit Zusammenfassung und Unterschieden, dann zusammenführen (nichts wird überschrieben). d: Ergebnis von FuehrerDatei.lies. */
  async zeigePlan(d, titel, fertig) {
    const holen = /Meine Touren/.test(titel);
    const lokal = await Buecher.liste(), hat = {};
    for (const b of lokal) if (b.cover) hat[b.id] = true;
    const pl = FuehrerDatei.plane(lokal, d, hat, () => uid().slice(-9));
    const ok = h('button', { class: 'btn pri', id: 'fu-im-ok', disabled: !pl.nTouren && !pl.cover.length, onclick: async () => {
      ok.disabled = true;
      try { await Buecher.zusammenfuehren(pl); s.close(); toast((holen ? 'Geholt: ' : 'Importiert: ') + FuehrerDatei.zusammenfassung(pl), 6000); if (fertig) fertig(); }
      catch (e) { ok.disabled = false; toast((holen ? 'Holen' : 'Importieren') + ' nicht möglich: ' + (e && e.message || e), 6000); }
    } }, holen ? 'Holen' : 'Importieren');      // 2.20.0: die Hauptaktion nennt, was passiert (statt „Übernehmen“)
    const s = sheet(titel, h('div', { id: 'fu-im' },
      h('p', { id: 'fu-im-sum' }, FuehrerDatei.zusammenfassung(pl) + '.'),
      d.defekt ? h('p', { class: 'muted small', id: 'fu-im-defekt' }, d.defekt + (d.defekt === 1 ? ' Eintrag ist' : ' Einträge sind') + ' nicht lesbar und bleiben draußen.') : null,
      pl.konflikte.length ? h('div', { id: 'fu-im-konf' }, h('h3', { class: 'sub' }, pl.konflikte.length === 1 ? '1 Unterschied' : pl.konflikte.length + ' Unterschiede'), h('ul', { class: 'fu-konf' }, pl.konflikte.slice(0, 30).map(k => h('li', null, k))),
        pl.konflikte.length > 30 ? h('p', { class: 'muted small' }, '… und ' + (pl.konflikte.length - 30) + ' weitere.') : null) : null,
      h('p', { class: 'muted small' }, 'Vorhandenes bleibt, wie es ist: Es kommen nur neue Bücher und neue Buchtouren dazu. Welche Buchtouren gewandert sind, rechnet die App danach mit deinen Touren neu.'),
      h('div', { class: 'row end' }, h('button', { class: 'btn', onclick: () => s.close() }, 'Abbrechen'), ok)));
  },
  /** Plan aus FuehrerDatei.plane anwenden: Punkte zuerst, dann die Bücherliste (eine Änderung), dann Titelbilder. */
  async zusammenfuehren(pl) {
    for (const x of pl.neu) if ((await DB.get('kv', 'guidepts:' + x.buch.id)) === undefined) await DB.kvSet('guidepts:' + x.buch.id, x.pts);
    for (const e of pl.ergaenzen) { const p = await DB.kvGet('guidepts:' + e.id, {}); for (const k of Object.keys(e.pts)) if (!p[k]) p[k] = e.pts[k]; await DB.kvSet('guidepts:' + e.id, p); }
    await Buecher.aendere(l => {
      const ids = new Set(l.map(b => b.id));
      for (const x of pl.neu) if (!ids.has(x.buch.id)) { l.push(JSON.parse(JSON.stringify(x.buch))); ids.add(x.buch.id); }
      for (const e of pl.ergaenzen) {
        const b = l.find(y => y.id === e.id); if (!b) continue;
        const da = new Set(b.touren.map(t => t.id));
        for (const t of e.touren) if (!da.has(t.id)) b.touren.push(t);
        b.next = Math.max(b.next || 0, e.next, ...b.touren.map(t => t.ord + 1));
      }
      return l;
    });
    for (const c of pl.cover) await Buecher.setzeCover(c.id, c.data);
  },

  /** Karte einer Buchtour (Blatt) mit „Als Planung übernehmen“. */
  async karte(b, bt) {
    const pts = (await Buecher.punkte(b.id))[bt.id] || [];
    if (pts.length < 2) { toast('Die Strecke dieser Buchtour ist nicht gespeichert.'); return; }
    const mapEl = h('div', { class: 'map fu-map', id: 'fu-map' });
    let map = null;
    const plan = h('button', { class: 'btn pri', id: 'fu-plan', onclick: async () => {
      try {
        plan.disabled = true;
        // 2.24.1: eine Buchtour wird nur einmal zur Planung (Kennung „fuehrer:<Buch>:<Tour>“); wer sie gelöscht hat und erneut übernimmt, will sie (geloeschtOk)
        const r = await Tours.add({ name: bt.title, sport: 'hike', pts: pts.map(p => ({ lat: p.lat, lon: p.lon, ele: p.ele, t: null })), status: 'planned', src: 'plan', srcId: 'fuehrer:' + b.id + ':' + bt.id, geloeschtOk: true, stumm: true });
        if (r.dup) { s.close(); toast('Diese Buchtour ist schon eine geplante Tour'); Nav.go('/tour/' + r.tour.id); return; }
        await PlanMeta.patch(r.tour.id, { quelle: { art: 'fuehrer', text: (b.name + ' – ' + bt.title).slice(0, Planhilfe.MAX_QTEXT) } });
        s.close(); toast('Als Planung übernommen'); Nav.go('/tour/' + r.tour.id);
      } catch (e) { plan.disabled = false; toastFehler('Als Planung übernehmen', e, 5000); }
    } }, 'Als Planung übernehmen');
    const s = sheet(bt.title, h('div', { class: 'fu-kb' }, h('p', { class: 'muted small' }, 'Aus dem Buch: ' + b.name),
      UI.figs([[F.km(bt.km * 1000), 'Strecke'], bt.up != null ? ['↑ ' + F.m(bt.up), 'Aufstieg'] : null]), mapEl, h('div', { class: 'row end' }, plan)), { onclose: () => { try { if (map) map.remove(); } catch (e) { /* schon weg */ } } });
    try {
      map = MapKit.create(mapEl);
      const layer = MapKit.line(pts, '#1565c0', 5).addTo(map);
      MapKit.dot(pts[0].lat, pts[0].lon, '#2e7d32', 'S').addTo(map); MapKit.dot(pts[pts.length - 1].lat, pts[pts.length - 1].lon, '#c62828', 'Z').addTo(map);
      map.fitBounds(layer.getBounds(), { padding: [24, 24] });
      setTimeout(() => { try { if (map && map.getContainer().isConnected) { map.invalidateSize(); map.fitBounds(layer.getBounds(), { padding: [24, 24] }); } } catch (e) { /* Blatt schon zu */ } }, 300);
    } catch (e) { mapEl.append(h('p', { class: 'muted' }, 'Die Karte lässt sich nicht zeigen.')); }
  },
};

/* ---------- Seite „Wanderführer“ ---------- */
Views['/fuehrer'] = async root => {
  const U = Buecher.ui, body = h('div', { class: 'pad fu', id: 'fuehrer' });
  let gone = false, buecher = await Buecher.liste(), st = await Buecher.stand(buecher), prog = null, tmap = {}, tmSrc = null;
  root.append(topbar('Wanderführer', { back: true, actions: h('button', { class: 'btn sm hbtn', id: 'fu-add', html: Ico.svg('plus') + '<span>Buch</span>', onclick: () => Buecher.anlegen(null, reload) }) }), body);
  const sum = h('p', { class: 'muted', id: 'fu-sum' }), sync = h('div', { class: 'fu-sync', id: 'fu-sync', role: 'status', 'aria-live': 'polite', hidden: true }), list = h('div', { id: 'fu-list' });
  const ctl = h('div', { id: 'fu-ctl' });

  async function reload() { buecher = await Buecher.liste(); st = await Buecher.stand(buecher); if (gone) return; drawAll(); start(); }
  const tourMap = () => { if (Tours.cache && tmSrc !== Tours.cache) { tmSrc = Tours.cache; tmap = Object.fromEntries(tmSrc.map(t => [t.id, t])); } return tmap; };      // folgt dem Tourenspeicher (der sich bei Änderungen erneuert)

  function drawCtl() {
    ctl.innerHTML = '';
    if (!buecher.length) return;
    const q = h('input', { type: 'search', id: 'fu-q', placeholder: 'Tour oder Buch suchen', 'aria-label': 'Buchtouren suchen', value: U.suche, oninput: e => { U.suche = e.target.value; drawList(); } });
    ctl.append(h('div', { class: 'row fu-find' }, q),
      UI.chips([['alle', 'Alle'], ['offen', 'Offen'], ['gewandert', 'Gewandert']].map(([k, tx]) => UI.chip(tx, U.filter === k, () => { U.filter = k; drawCtl(); drawList(); }, { id: 'fu-f-' + k }))),
      UI.seg([['buch', 'Buchreihenfolge'], ['laenge', 'Nach Strecke']], U.sort, k => { U.sort = k; drawCtl(); drawList(); }, { label: 'Reihenfolge der Touren im Buch' }));
  }
  function drawSum() {
    const tot = buecher.length;
    sum.textContent = tot ? tot + (tot === 1 ? ' Buch' : ' Bücher') + ' · ' + st.fertig + ' von ' + st.gesamt + ' Buchtouren gewandert' : '';
    sum.hidden = !tot;
  }
  function drawSync() {
    sync.hidden = prog == null; sync.innerHTML = '';
    if (prog == null) return;
    sync.append(h('span', null, 'Buchtouren werden mit deinen Touren verglichen … ' + Math.round(prog * 100) + ' %'), h('div', { class: 'prog' }, h('i', { style: { width: Math.round(prog * 100) + '%' } })));
  }
  function row(b, bt) {
    const tm = tourMap(), hit = ((st.buecher[b.id] || { touren: {} }).touren[bt.id] || []).map(id => tm[id]).filter(Boolean).sort((x, y) => (y.start || 0) - (x.start || 0));
    if (hit.length) {
      const t = hit[0];
      return h('a', { class: 'li fu-t done', href: '#/tour/' + t.id, 'data-bt': bt.id },
        h('span', { class: 'li-i fu-ok', html: Ico.svg('check', 22) }),
        h('span', { class: 'li-t' }, h('b', null, bt.title), h('small', null, 'gewandert am ' + Buecher.datum(t.start) + ' · ' + Buecher.zahlen(bt) + (hit.length > 1 ? ' · +' + (hit.length - 1) + ' weitere' : ''))));
    }
    return h('button', { class: 'li fu-t open', 'data-bt': bt.id, onclick: () => Buecher.karte(b, bt) },
      h('span', { class: 'li-i' }, h('span', { class: 'fu-circ', 'aria-hidden': 'true' })),
      h('span', { class: 'li-t' }, h('b', null, bt.title), h('small', null, 'offen · ' + Buecher.zahlen(bt))));
  }
  function drawList() {
    list.innerHTML = '';
    if (!buecher.length) { list.append(UI.empty({ icon: 'book', title: 'Noch kein Wanderführer', text: 'Lege ein Buch an und wähle die GPX-Dateien dazu (bei Rother im Download-Bereich zum Buch). Danach siehst du, welche Touren aus dem Buch du schon gewandert bist.',
      actions: [h('button', { class: 'btn pri', id: 'fu-add2', onclick: () => Buecher.anlegen(null, reload) }, 'Buch anlegen')] })); return; }
    const v = Fuehrer.ansicht(buecher, st, { filter: U.filter, suche: U.suche, sort: U.sort }), suche = U.suche.trim() !== '';
    if (!v.length) list.append(h('p', { class: 'muted', id: 'fu-leer' }, suche ? 'Nichts gefunden.' : U.filter === 'offen' ? 'Alles gewandert: Es ist keine Buchtour mehr offen.' : 'Noch keine Buchtour gewandert.'));
    v.forEach(({ buch: b, touren, gesamt, fertig }) => {
      const open = suche || U.offen.has(b.id), cov = h('span', { class: 'fu-cov', html: Ico.svg('book', 28), 'aria-hidden': 'true' });
      if (b.cover) Buecher.cover(b.id).then(d => { if (d && cov.isConnected) { cov.innerHTML = ''; cov.append(h('img', { src: d, alt: '' })); } }).catch(() => {});
      const head = h('button', { class: 'fu-head', 'aria-expanded': open ? 'true' : 'false', 'aria-controls': 'fu-b-' + b.id, 'data-book': b.id, onclick: () => { if (U.offen.has(b.id)) U.offen.delete(b.id); else U.offen.add(b.id); drawList(); } },
        cov, h('span', { class: 'fu-tx' }, h('span', { class: 'fu-name' }, b.name), h('span', { class: 'fu-sub' }, fertig + ' von ' + gesamt + ' gewandert')),
        h('span', { class: 'fu-r', html: Buecher.ring(fertig, gesamt) }), h('span', { class: 'fu-chev', 'aria-hidden': 'true' }));
      const sec = h('section', { class: 'fu-book' + (open ? ' open' : ''), 'data-id': b.id }, head);
      if (open) {
        sec.append(h('div', { class: 'fu-body', id: 'fu-b-' + b.id },
          h('div', { class: 'fu-acts' },
            h('button', { class: 'btn sm', 'data-a': 'cover', onclick: () => Buecher.waehleCover(b, reload) }, b.cover ? 'Titelbild ändern' : 'Titelbild wählen'),
            h('button', { class: 'btn sm', 'data-a': 'manage', onclick: () => verwalten(b) }, 'Aktionen …')),
          UI.list(touren.map(bt => row(b, bt)))));
      }
      list.append(sec);
    });
  }
  function verwalten(b) {
    UI.menu(b.name, [
      ['pencil', 'Umbenennen …', async () => { const n = await askText('Name des Buchs', 'Name', b.name, 'Speichern'); if (n && n.trim()) { await Buecher.umbenenne(b.id, n.trim()); await reload(); } }, null, 'fu-m-ren'],
      ['photo', b.cover ? 'Titelbild ändern …' : 'Titelbild wählen …', () => Buecher.waehleCover(b, reload), 'Du wählst das Bild selbst aus deiner Galerie oder aus einer Datei.', 'fu-m-cov'],
      b.cover ? ['trash', 'Titelbild entfernen', async () => { await Buecher.setzeCover(b.id, null); await reload(); }, null, 'fu-m-covdel'] : null,
      ['plus', 'GPX-Dateien hinzufügen …', () => Buecher.anlegen(b.id, reload), null, 'fu-m-add'],
      ['trash', 'Buch löschen …', async () => {      // 2.20.0: ehrlich „löschen“ – das Buch ist danach weg (bis 2.19 „Buch entfernen“)
        if (await confirmBox('Buch „' + b.name + '“ löschen?', 'Das Buch mit ' + b.touren.length + (b.touren.length === 1 ? ' Buchtour' : ' Buchtouren') + ' wird von diesem Handy gelöscht. Deine Touren bleiben unverändert. Zurückholen lässt es sich aus einer Sicherung oder einer exportierten Wanderführer-Datei.', 'Löschen')) { await Buecher.entferne(b.id); toast('Buch gelöscht'); await reload(); }
      }, null, 'fu-m-del']]);
  }
  function drawAll() { drawCtl(); drawSum(); drawList(); }
  let letzte = 0;
  const hoerer = {
    fortschritt: a => { if (gone) return; prog = a; drawSync(); },
    teil: s => { if (gone || Date.now() - letzte < 900) return; letzte = Date.now(); st = s; drawSum(); drawList(); },
    ende: s => { if (gone) return; prog = null; st = s; drawSync(); drawSum(); drawList(); },
  };
  function start() {
    if (!buecher.length) { prog = null; drawSync(); return; }
    if (st.fehlendePaare) { prog = 0; drawSync(); } else prog = null;
    Buecher.sync(hoerer).catch(e => { console.error('Wanderführer-Abgleich', e); if (!gone) { prog = null; drawSync(); toastFehler('Vergleich mit deinen Touren', e, 5000); } });
  }
  // 2.13.0: Übertragen als Datei (zwischen Geräten). 2.15.0: „Aus Meine Touren holen“ nur bei „Mit Meine Touren zusammenarbeiten“ und bestehender Verbindung
  const mtKonto = await MT.konto();
  const xfer = UI.section('Übertragen', [h('p', { class: 'muted small' }, 'Bücher als Datei sichern oder auf ein anderes Gerät holen' + (mtKonto ? ', oder aus Meine Touren holen' : '') + '. Beim Importieren bleibt Vorhandenes unverändert.'),
    h('div', { class: 'row wrap' }, h('button', { class: 'btn', id: 'fu-export', onclick: () => Buecher.exportBlatt() }, 'Wanderführer exportieren'),
      h('button', { class: 'btn', id: 'fu-import', onclick: () => Buecher.importieren(reload) }, 'Wanderführer importieren'),
      mtKonto ? h('button', { class: 'btn', id: 'fu-mt', onclick: () => Buecher.ausMt(reload) }, 'Aus Meine Touren holen') : null)], { id: 'fu-xfer' });
  body.append(sum, sync, ctl, list, xfer);
  drawAll(); start();
  return () => { gone = true; Buecher._hoerer.delete(hoerer); };
};

/* ---------- Startseite: eine ruhige Zeile ---------- */
Home.add('fuehrer', 45, async () => {
  const buecher = await Buecher.liste(); if (!buecher.length) return null;
  const st = await Buecher.stand(buecher), nB = buecher.length;
  const titel = s => 'Wanderführer: ' + s.fertig + ' von ' + s.gesamt + ' gewandert';
  const t = h('b', null, titel(st)), row = h('a', { class: 'li', href: '#/fuehrer', id: 'fuehrer-home-row' }, h('span', { class: 'li-i', html: Ico.svg('book', 22) }), h('span', { class: 'li-t' }, t, h('small', null, nB + (nB === 1 ? ' Buch' : ' Bücher'))));
  const sec = h('section', { class: 'sec', id: 'fuehrer-home' }, UI.list([row]));
  if (st.fehlendePaare) Buecher.sync({ ende: s => { if (t.isConnected) t.textContent = titel(s); } }).catch(() => {});      // fehlt noch etwas, rechnet es im Hintergrund; die Zeile aktualisiert sich selbst
  return sec;
}, { label: 'Wanderführer', sub: 'Wie viele Buchtouren aus deinen Büchern du schon gewandert bist (nur mit mindestens einem Buch)', def: true });
