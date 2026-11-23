'use strict';
/* 2.18.0: Notizen, Fotos und (auf Wunsch) Videos mit Meine Touren abgleichen – in beide Richtungen, nur auf Knopfdruck, mit Vorschau „was ist neu“.
   Tourseite → Aktionen → „Mit Meine Touren abgleichen …“ (eine Tour) und Touren importieren → Meine Touren → „Notizen und Fotos abgleichen …“ (alle verbundenen Touren).
   Server: Meine Touren ab 3.57.0 (GET /api/tours/{id}/tagebuch, GET /api/tagebuch/uebersicht, GET …/tagebuch/photo|video, POST …/notiz|photo|video).
   Regeln und Rechnung: js/calc-abgleich-medien.js (MedienCalc). Übertragung der Dateien: Hülle (MtMedien.java / MtTransfer.java).
   Bei Aus („Mit Meine Touren zusammenarbeiten“) gibt es nichts davon: kein Eintrag, kein Knopf, kein Netzaufruf (jede Funktion prüft MT.aktiv() zuerst). */
const MedienAbgleich = {
  _busy: false,
  /** Eintrag im Tourmenü? Nur bei An und wenn die Tour mit Meine Touren verbunden ist. */
  sichtbar(t, acc) { return MT.aktiv() && !!MedienCalc.mtId(t) && !!(acc && (acc.token || acc.open)) && t.status !== 'planned'; },
  cookie: acc => acc && acc.token ? Import.MT.COOKIE + '=' + acc.token : '',
  pfad: (id, rest) => '/api/tours/' + encodeURIComponent(id) + rest,
  fehler(msg, o) { return Object.assign(new Error(msg), o || {}); },
  /** Antwort mit Status → verständlicher Fehler. */
  pruefe(r, was) {
    if (r.status === 200) return;
    const d = Import.MT.detail(r, '');
    if (r.status === 403) throw MedienAbgleich.fehler('Dieses Konto darf nur ansehen. Senden ist damit nicht möglich.', { verboten: true });
    if (r.status === 404 && (!d || d === 'Not Found')) throw MedienAbgleich.fehler('Dafür braucht es Meine Touren ab Version 3.57.0. Bitte den Server aktualisieren.', { dauerhaft: true });
    if (r.status === 404) throw MedienAbgleich.fehler('Diese Tour gibt es in Meine Touren nicht (mehr).', { dauerhaft: true });
    if (r.status === 413) throw MedienAbgleich.fehler(d || 'Zu groß für Meine Touren.', { dauerhaft: true });
    throw MedienAbgleich.fehler((was || 'Meine Touren') + ': ' + (d || 'HTTP ' + r.status));
  },
  /** Stand einer Tour am Server (GET /tagebuch). */
  async lese(acc, id) {
    const r = await Import.MT.get(acc, MedienAbgleich.pfad(id, '/tagebuch'));
    MedienAbgleich.pruefe(r, 'Stand lesen');
    const j = JSON.parse(r.body);
    if (!j || !Array.isArray(j.fotos)) throw MedienAbgleich.fehler('Meine Touren hat eine unerwartete Antwort geschickt.');
    return j;
  },
  /** Übersicht für viele Touren (höchstens 500 je Aufruf). */
  async uebersicht(acc, ids) {
    const out = {};
    for (let i = 0; i < ids.length; i += 500) {
      const r = await Import.MT.get(acc, '/api/tagebuch/uebersicht?ids=' + ids.slice(i, i + 500).map(encodeURIComponent).join(','));
      MedienAbgleich.pruefe(r, 'Übersicht');
      Object.assign(out, JSON.parse(r.body) || {});
    }
    return out;
  },
  async lokal(tid) { return (await DB.byIndex('photos', 'tour', tid)).sort((a, b) => (a.ts || 0) - (b.ts || 0)); },
  async konto() {
    const acc = await MT.konto();
    if (!acc) { toast('Es besteht keine Verbindung zu Meine Touren. Unter „Touren importieren“ → „Meine Touren“ lässt sie sich herstellen.', 7000); return null; }
    return acc;
  },

  /* ---------------------------------------------------------------- Vorschau: Bausteine ---------------------------------------------------------------- */
  /** Abschnitt „Notiz“ mit Lage, beiden Fassungen, Wahl und Vorschau. Gibt { el, wahl() } zurück. */
  notizTeil(lage, darf, start) {
    let wahl = start;
    const box = h('div', { id: 'ab-notiz' }), vor = h('div', { class: 'ab-vor', id: 'ab-n-vorschau' }), segBox = h('div');
    const zeig = () => {
      vor.innerHTML = '';
      if (wahl === 'nichts' || lage.fall === 'gleich') { vor.append(h('p', { class: 'muted small' }, lage.fall === 'gleich' ? 'Die Notiz ist an beiden Stellen gleich.' : 'Die Notiz bleibt an beiden Stellen, wie sie ist.')); return; }
      const e = lage[wahl], lang = lage.zuLang.includes(wahl);
      if (lang) vor.append(h('p', { class: 'warn small', id: 'ab-n-lang' }, 'Zusammen wäre die Notiz länger als ' + MedienCalc.NOTIZ_MAX.toLocaleString('de-DE') + ' Zeichen. Bitte erst kürzen – so wird sie nicht übertragen.'));
      if (e.status === 'zusammengefuehrt') vor.append(h('p', { class: 'small', id: 'ab-n-zus' }, 'Beide Fassungen bleiben erhalten – mit einer Trennzeile und Datum dazwischen.'));
      vor.append(h('p', { class: 'muted small' }, 'So steht die Notiz danach ' + (wahl === 'holen' ? 'hier' : wahl === 'senden' ? 'in Meine Touren' : 'an beiden Stellen') + ':'),
        h('pre', { class: 'ab-text', id: 'ab-n-neu' }, (wahl === 'holen' ? e.hier : e.dort) || '(leer)'));
    };
    const seg = () => {
      segBox.innerHTML = '';
      const opts = [['holen', 'Holen'], ['senden', 'Senden'], ['beides', 'Beides'], ['nichts', 'Nichts']].filter(o => darf || (o[0] !== 'senden' && o[0] !== 'beides'));
      segBox.append(UI.seg(opts, wahl, k => { wahl = k; seg(); zeig(); }, { label: 'Notiz abgleichen', cls: 'ab-seg' }));
    };
    box.append(h('h3', { class: 'sub' }, 'Notiz'), h('p', { id: 'ab-n-lage' }, h('b', null, MedienCalc.notizText(lage))));
    if (lage.fall !== 'gleich') {
      box.append(h('details', { class: 'ab-det', id: 'ab-n-hier' }, h('summary', null, 'Hier (' + MedienCalc.laenge(lage.hier) + ' Zeichen)'), h('pre', { class: 'ab-text' }, lage.hier || '(leer)')),
        h('details', { class: 'ab-det', id: 'ab-n-dort' }, h('summary', null, 'In Meine Touren (' + MedienCalc.laenge(lage.dort) + ' Zeichen)'), h('pre', { class: 'ab-text' }, lage.dort || '(leer)')));
      seg();
      box.append(segBox);
    }
    box.append(vor); zeig();
    return { el: box, wahl: () => lage.fall === 'gleich' || lage.zuLang.includes(wahl) ? 'nichts' : wahl };
  },
  /** Abschnitt „Fotos“ (und Videos): Zahlen, Größen, Wahl, gelöschte, Videos-Schalter. o.change() bei jeder Änderung. */
  fotoTeil(plan, darf, o) {
    const st = { wahl: darf ? 'beides' : 'holen', force: false, videos: false };
    const box = h('div', { id: 'ab-fotos' }), info = h('p', { id: 'ab-f-zahl' }), groesse = h('p', { class: 'muted small', id: 'ab-f-mb' }), segBox = h('div'), vid = h('div', { id: 'ab-v-box' });
    const zeig = () => {
      const a = MedienCalc.auswahl(plan, st.wahl, st);
      info.textContent = MedienCalc.fotoText(plan);
      groesse.textContent = a.n ? 'Übertragen werden etwa ' + MedienCalc.mb(a.bytes + a.videoBytes) + ' (' + a.n + (a.n === 1 ? ' Datei' : ' Dateien') + ').' : 'Bei dieser Wahl wird nichts übertragen.';
      vid.innerHTML = '';
      const nv = plan.videosHolen.length + plan.videosSenden.length;
      if (nv || plan.videosZuGross.length) {
        vid.append(UI.toggle('Videos einbeziehen', st.videos, v => { st.videos = !!v; zeig(); }, { id: 'ab-videos' }));
        vid.append(h('p', { class: 'muted small', id: 'ab-v-info' }, st.videos
          ? (plan.videosHolen.length + ' dort neu (' + MedienCalc.mb(plan.videoBytesHolen) + ') · ' + plan.videosSenden.length + ' hier neu (' + MedienCalc.mb(plan.videoBytesSenden) + '). Nur im WLAN, höchstens 200 MB je Video.')
          : nv + (nv === 1 ? ' Video' : ' Videos') + ' nicht dabei. Videos werden nur übertragen, wenn du das einschaltest.'),
        plan.videosZuGross.length ? h('p', { class: 'muted small', id: 'ab-v-gross' }, plan.videosZuGross.length + ' Video(s) zu groß (über 200 MB je Video oder 1 GB je Tour) – bleiben, wo sie sind.') : null);
      }
      if (o && o.change) o.change();
    };
    const seg = () => {
      segBox.innerHTML = '';
      const opts = [['holen', 'Holen'], ['senden', 'Senden'], ['beides', 'Beides'], ['nichts', 'Nichts']].filter(x => darf || (x[0] !== 'senden' && x[0] !== 'beides'));
      segBox.append(UI.seg(opts, st.wahl, k => { st.wahl = k; seg(); zeig(); }, { label: 'Fotos abgleichen', cls: 'ab-seg' }));
    };
    box.append(h('h3', { class: 'sub' }, 'Fotos'), info, groesse);
    seg(); box.append(segBox);
    if (plan.geloescht.length && darf) box.append(UI.toggle('In Meine Touren gelöschte trotzdem senden (' + plan.geloescht.length + ')', false, v => { st.force = !!v; plan.senden = plan.senden.filter(p => !p.mtGeloescht).concat(v ? plan.geloescht : []); zeig(); }, { id: 'ab-force' }),
      h('p', { class: 'muted small' }, 'Diese Fotos wurden in Meine Touren gelöscht. Ohne diesen Schalter kommen sie nicht zurück.'));
    if (plan.dortGeloescht.length) box.append(h('p', { class: 'muted small', id: 'ab-f-dortweg' }, plan.dortGeloescht.length + ' Foto(s) gibt es in Meine Touren nicht mehr – sie bleiben hier und werden nicht erneut gesendet.'));
    box.append(vid); zeig();
    return { el: box, st, auswahl: () => MedienCalc.auswahl(plan, st.wahl, st) };
  },
  hinweisBetrachter() { return h('p', { class: 'warn small', id: 'ab-viewer' }, 'Dieses Konto darf nur ansehen. Holen geht, Senden nicht. Zum Senden brauchst du ein Konto mit Schreibrechten.'); },

  /* ---------------------------------------------------------------- Eine Tour ---------------------------------------------------------------- */
  async tour(t, after) {
    if (!MT.aktiv()) return null;
    if (MedienAbgleich._busy) { toast('Es läuft schon ein Abgleich.'); return null; }
    const id = MedienCalc.mtId(t); if (!id) return null;
    const acc = await MedienAbgleich.konto(); if (!acc) return null;
    const body = h('div', { id: 'ab-sheet' }, h('p', { class: 'muted', id: 'ab-laden' }, 'Stand in Meine Touren wird gelesen …'));
    const s = sheet('Mit Meine Touren abgleichen', body);
    let r, lokal;
    try { [r, lokal] = await Promise.all([MedienAbgleich.lese(acc, id), MedienAbgleich.lokal(t.id)]); }
    catch (e) { s.close(); toast('Abgleich nicht möglich: ' + e.message, 8000); if (e.relogin && after) after(); return null; }
    const cur = (await DB.get('tours', t.id)) || t;
    const darf = r.darf_schreiben !== false && acc.role !== 'viewer';
    const lage = MedienCalc.notizLage(cur, r.notiz || {}), plan = MedienCalc.fotoPlan(lokal, r, {});
    if (!darf) plan.darfSchreiben = false;
    const go = h('button', { class: 'btn pri', id: 'ab-go' }, 'Abgleichen');
    const nt = MedienAbgleich.notizTeil(lage, darf, darf ? lage.vorschlag : (lage.vorschlag === 'holen' || lage.vorschlag === 'beides' ? 'holen' : 'nichts'));
    const wlan = UI.toggle('Nur über WLAN (große Mengen und Videos)', Set_.get('mtWlan') !== false, v => Set_.set('mtWlan', !!v), { id: 'ab-wlan' });
    const ft = MedienAbgleich.fotoTeil(plan, darf, {});
    body.innerHTML = '';
    body.append(darf ? null : MedienAbgleich.hinweisBetrachter(), nt.el, ft.el, wlan,
      h('p', { class: 'muted small' }, 'Es wird nur übertragen, was du hier wählst – erst nach „Abgleichen“ und einer Rückfrage. Notizen werden zusammengeführt, nie überschrieben.'),
      h('div', { class: 'row end wrap' }, h('button', { class: 'btn', id: 'ab-abbr', onclick: () => s.close() }, 'Abbrechen'), go));
    go.onclick = async () => {
      const item = { t: cur, id, r, lage, notiz: nt.wahl(), a: ft.auswahl(), force: ft.st.force };
      if (item.notiz === 'nichts' && !item.a.n) { toast('Nichts zu tun – es ist nichts ausgewählt oder alles gleich.'); return; }
      if (!await MedienAbgleich.bestaetigen([item])) return;
      s.close();
      await MedienAbgleich.mitFortschritt(acc, [item], after);
    };
    return s;
  },

  /** Rückfrage vor dem Übertragen; bei Videos mit Größe und „nur im WLAN“. */
  async bestaetigen(items) {
    const nh = items.reduce((x, i) => x + i.a.holen.length, 0), ns = items.reduce((x, i) => x + i.a.senden.length, 0);
    const vids = items.flatMap(i => i.a.videosHolen.concat(i.a.videosSenden)), nn = items.filter(i => i.notiz !== 'nichts').length;
    const mb = items.reduce((x, i) => x + i.a.bytes + i.a.videoBytes, 0);
    const teile = [];
    if (nn) teile.push(nn === 1 && items.length === 1 ? 'Notiz: ' + { holen: 'holen', senden: 'senden', beides: 'in beide Richtungen' }[items[0].notiz] : nn + ' Notiz(en)');
    if (nh) teile.push(nh + ' Foto(s) holen');
    if (ns) teile.push(ns + ' Foto(s) senden');
    if (vids.length) teile.push(MedienCalc.videoFrage(vids));
    return confirmBox(vids.length ? 'Auch Videos übertragen?' : 'Jetzt abgleichen?', teile.join(' · ') + (mb ? ' – etwa ' + MedienCalc.mb(mb) + '.' : '.'), vids.length ? 'Ja, mit Videos' : 'Abgleichen');
  },

  /* ---------------------------------------------------------------- Ausführen ---------------------------------------------------------------- */
  async mitFortschritt(acc, items, after) {
    if (MedienAbgleich._busy) { toast('Es läuft schon ein Abgleich.'); return null; }
    if (items.some(i => i.a.wlan) && Set_.get('mtWlan') !== false) {
      let wifi = true; try { wifi = !!(await Native.json('mtNetz')).wifi; } catch (e) { wifi = true; }      // ohne Hülle (Browser) keine Prüfung
      if (!wifi) { toast('Kein WLAN. Für große Mengen und Videos bitte mit einem WLAN verbinden – oder „Nur über WLAN“ ausschalten (Videos nur im WLAN).', 9000); return null; }
    }
    MedienAbgleich._busy = true; let halt = false, res = null, err = null;
    try {
      res = await PhotoSources.progress('Mit Meine Touren abgleichen', upd => MedienAbgleich.ausfuehren(acc, items, { stop: () => halt, upd }),
        { cancel: () => { halt = true; Native.call('mtJobCancel').catch(() => {}); }, note: 'Bitte die App geöffnet lassen, bis der Abgleich fertig ist.' });
    } catch (e) { err = e; }
    finally { MedienAbgleich._busy = false; }
    Tours.invalidate(); window.dispatchEvent(new Event('photos-changed'));
    if (err) { toast('Abgleich nicht fertig: ' + err.message, 9000); if (after) after(); return null; }
    const s = sheet(res.stopped ? 'Abgleich abgebrochen' : 'Abgeglichen', h('div', { id: 'ab-ergebnis' }, h('p', { id: 'ab-ergebnis-t' }, MedienCalc.ergebnisText(res)),
      res.konflikt ? h('p', { class: 'muted small', id: 'ab-konflikt' }, 'Die Notiz war an beiden Stellen geändert. Beide Fassungen sind erhalten – getrennt durch eine Zeile mit Datum.') : null,
      h('div', { class: 'row end' }, h('button', { class: 'btn pri', id: 'ab-fertig', onclick: () => s.close() }, 'Fertig'))), { onclose: () => { if (after) after(); } });
    return res;
  },
  /** Alle gewählten Übertragungen nacheinander. Rechte- und Anmeldefehler brechen ab; einzelne Fotos dürfen scheitern (gezählt). */
  async ausfuehren(acc, items, o) {
    if (!MT.aktiv()) throw MedienAbgleich.fehler('Die Zusammenarbeit mit Meine Touren ist ausgeschaltet.');
    const res = { notiz: null, konflikt: false, holen: 0, uebersprungen: 0, gesendet: null, videos: 0, fehler: [], stopped: false };
    const total = items.reduce((x, i) => x + (i.notiz !== 'nichts' ? 1 : 0) + i.a.n, 0) || 1;
    let k = 0;
    const step = text => { k++; if (o.upd) o.upd(Math.min(k, total), total, text); };
    const ix = FotoDoppeltCalc.index(await DB.all('photos'));
    for (const it of items) {
      if (o.stop()) { res.stopped = true; break; }
      const name = it.t.name;
      if (it.notiz !== 'nichts') { step(name + ' · Notiz'); const st = await MedienAbgleich.notiz(acc, it); if (st) { res.notiz = st.status; if (st.status === 'zusammengefuehrt') res.konflikt = true; } }
      for (const x of it.a.holen) {
        if (o.stop()) { res.stopped = true; break; }
        step(name + ' · Foto holen');
        try { const n = await MedienAbgleich.fotoHolen(acc, it, x, ix); if (n) res.holen++; else res.uebersprungen++; }
        catch (e) { if (e.relogin || e.verboten) throw e; res.fehler.push(e.message); }
      }
      for (const p of it.a.senden) {
        if (o.stop()) { res.stopped = true; break; }
        step(name + ' · Foto senden');
        const q = await DB.get('photos', p.id);
        if (!q || q.mtPid != null) { res.gesendet = MedienCalc.zaehle(res.gesendet, { status: 'vorhanden' }); continue; }      // eben beim Holen als dasselbe Foto erkannt
        try { res.gesendet = MedienCalc.zaehle(res.gesendet, await MedienAbgleich.fotoSenden(acc, it, p)); }
        catch (e) { if (e.relogin || e.verboten) throw e; res.fehler.push(e.message); }
      }
      for (const v of it.a.videosHolen.map(x => ['holen', x]).concat(it.a.videosSenden.map(p => ['senden', p]))) {
        if (o.stop()) { res.stopped = true; break; }
        step(name + ' · Video ' + (v[0] === 'holen' ? 'holen' : 'senden'));
        try { if (await MedienAbgleich.video(acc, it, v[0], v[1], o)) res.videos++; }
        catch (e) { if (e.relogin || e.verboten) throw e; if (e.message === 'abgebrochen') { res.stopped = true; break; } res.fehler.push(e.message); }
      }
      if (res.stopped) break;
      try { const u = await MedienAbgleich.uebersicht(acc, [it.id]); const t = await DB.get('tours', it.t.id); if (t && u[it.id]) { t.mtStand = u[it.id].stand; await Tours.save(t); } }
      catch (e) { if (e.relogin) throw e; /* Stand bleibt alt: beim nächsten Mal wird die Tour eben gelesen */ }
    }
    return res;
  },
  /** Notiz nach Wahl übertragen. Gibt { status } zurück. */
  async notiz(acc, it) {
    const t = (await DB.get('tours', it.t.id)) || it.t, L = MedienCalc.norm(t.note);
    if (it.notiz === 'holen') {
      const neu = MedienCalc.holenMerge(L, it.r.notiz && it.r.notiz.text, t.noteMt != null && MedienCalc.norm(t.noteMt) === L);
      if (MedienCalc.laenge(neu.text) > MedienCalc.NOTIZ_MAX) throw MedienAbgleich.fehler('Zusammen wäre die Notiz zu lang.');
      t.note = neu.text; t.noteMt = neu.text; t.mtNotizBasis = it.r.notiz ? it.r.notiz.geaendert : null;
      await Tours.save(t); Object.assign(it.t, { note: t.note, noteMt: t.noteMt, mtNotizBasis: t.mtNotizBasis });
      return neu.status === 'uebernommen' || neu.status === 'zusammengefuehrt' ? { status: neu.status === 'uebernommen' ? 'geholt' : 'zusammengefuehrt' } : neu;
    }
    if (!L) { if (it.notiz === 'beides' && it.r.notiz && it.r.notiz.text) { it.notiz = 'holen'; return MedienAbgleich.notiz(acc, it); } return { status: 'leer' }; }      // ein leerer Text löscht nie
    const r = await Senden.post(acc, MedienAbgleich.pfad(it.id, '/notiz'), { text: L, basis: t.mtNotizBasis != null ? t.mtNotizBasis : null });
    MedienAbgleich.pruefe(r, 'Notiz senden');
    const j = JSON.parse(r.body), srv = (j && j.notiz) || {};
    if (it.notiz === 'beides' && srv.text) { t.note = srv.text; t.noteMt = MedienCalc.norm(srv.text); }
    else t.noteMt = L;
    t.mtNotizBasis = srv.geaendert != null ? srv.geaendert : null;
    await Tours.save(t); Object.assign(it.t, { note: t.note, noteMt: t.noteMt, mtNotizBasis: t.mtNotizBasis });
    return { status: j.status };
  },
  /** Ein Foto holen und dieser Tour zuordnen. Gibt true (neu) oder false (schon vorhanden) zurück. */
  async fotoHolen(acc, it, x, ix) {
    const m = await Native.json('mtFotoHolen', { url: acc.base + MedienAbgleich.pfad(it.id, '/tagebuch/photo/' + encodeURIComponent(x.id) + '?w=' + MedienCalc.HOLEN_PX + (x.v ? '&v=' + encodeURIComponent(x.v) : '')),
      cookie: MedienAbgleich.cookie(acc), name: x.name || ('MeineTouren_' + x.id + '.jpg'), taken: x.taken_ts ? x.taken_ts * 1000 : 0, lat: x.lat, lng: x.lng });
    if (m.status === 401) throw await Import.MT.expired(acc);
    if (m.status !== 200 || !m.id) MedienAbgleich.pruefe({ status: m.status || 500, body: m.body || '' }, 'Foto holen');
    const old = await DB.get('photos', m.id);
    if (old) { if (old.mtPid == null) { old.mtPid = x.id; if (!old.tour) old.tour = it.t.id; await DB.put('photos', old); } return false; }
    if (FotoDoppeltCalc.bekannt(ix, m)) { try { await Native.call('deletePhoto', { id: m.id }); } catch (e) { /* ohne Hülle */ } return false; }
    const p = { id: m.id, name: m.name, ts: m.ts || (x.taken_ts ? x.taken_ts * 1000 : 0), lat: m.lat != null ? m.lat : null, lon: m.lon != null ? m.lon : null, w: m.w, h: m.h, src: 'meinetouren',
      video: !!m.video, dur: m.dur || 0, tour: it.t.id, pos: m.lat != null ? 'exif' : 'none', note: '', mtPid: x.id };
    if (m.fp) p.fp = m.fp; if (m.fpd) p.fpd = m.fpd; if (m.size) p.size = m.size;
    if (p.lat == null && p.ts && it.t.timed) { const g = Geo.at(await Tours.points(it.t.id), p.ts, (+Set_.get('photoMargin') || 20) * 60000); if (g) { p.lat = g.lat; p.lon = g.lon; p.pos = 'track'; } }
    await DB.put('photos', p); FotoDoppeltCalc.merke(ix, p);
    return true;
  },
  /** Ein Foto senden. Gibt die Antwort des Servers ({ status: neu|vorhanden|geloescht, id }) zurück. */
  async fotoSenden(acc, it, p) {
    const r = await Native.json('mtFotoSenden', { url: acc.base + MedienAbgleich.pfad(it.id, '/photo'), cookie: MedienAbgleich.cookie(acc), id: p.id,
      fields: MedienCalc.sendeFelder(p, it.force && p.mtGeloescht), maxPx: MedienCalc.FOTO_PX });
    if (r.status === 401) throw await Import.MT.expired(acc);
    MedienAbgleich.pruefe({ status: r.status, body: r.body || '' }, 'Foto senden');
    const j = JSON.parse(r.body || '{}'), q = await DB.get('photos', p.id);
    if (q) {
      if ((j.status === 'neu' || j.status === 'vorhanden') && j.id != null && (!j.tour_id || String(j.tour_id) === String(it.id))) { q.mtPid = j.id; delete q.mtGeloescht; }
      if (j.status === 'geloescht') q.mtGeloescht = true;
      await DB.put('photos', q);
    }
    return j;
  },
  /** Ein Video senden oder holen – im Hintergrund der Hülle, mit Fortschritt. */
  async video(acc, it, richtung, x, o) {
    const a = { mode: richtung, cookie: MedienAbgleich.cookie(acc), wifiOnly: Set_.get('mtWlan') !== false };
    if (richtung === 'holen') Object.assign(a, { url: acc.base + MedienAbgleich.pfad(it.id, '/tagebuch/video/' + encodeURIComponent(x.id) + '?video=1'), key: it.id + '_' + x.id + '_' + (x.v || ''), name: x.name || 'Video.mp4', taken: x.taken_ts ? x.taken_ts * 1000 : 0, lat: x.lat, lng: x.lng, size: x.size || 0 });
    else Object.assign(a, { url: acc.base + MedienAbgleich.pfad(it.id, '/video'), id: x.id, fields: MedienCalc.sendeFelder(x, false), used: (it.r.videos || []).reduce((s, v) => s + (+v.size || 0), 0) });
    const st = await Native.json('mtVideoStart', a);
    if (!st.started) throw MedienAbgleich.fehler(st.error || 'Video nicht übertragen.');
    let j;
    for (;;) {
      await sleep(700);
      j = await Native.json('mtJob');
      if (o.upd && j.total > 0) o.upd(j.done, j.total, null, 'Video ' + (richtung === 'holen' ? 'holen' : 'senden') + ' · ' + MedienCalc.mb(j.done) + ' von ' + MedienCalc.mb(j.total));
      if (!j.running) break;
    }
    if (j.error) throw MedienAbgleich.fehler(j.error);
    if (j.status === 401) throw await Import.MT.expired(acc);
    MedienAbgleich.pruefe({ status: j.status, body: j.body || '' }, 'Video');
    if (richtung === 'holen') {
      const m = j.result; if (!m || !m.id) throw MedienAbgleich.fehler('Video nicht übernommen.');
      const old = await DB.get('photos', m.id);
      if (old) { if (old.mtPid == null) { old.mtPid = x.id; await DB.put('photos', old); } return false; }
      await DB.put('photos', { id: m.id, name: m.name || 'Video.mp4', ts: m.ts || 0, lat: m.lat != null ? m.lat : null, lon: m.lon != null ? m.lon : null, w: m.w, h: m.h, src: 'meinetouren', video: true,
        dur: m.dur || 0, tour: it.t.id, pos: m.lat != null ? 'exif' : 'none', note: '', mtPid: x.id, fp: m.fp, fpd: m.fpd, size: m.size });
      return true;
    }
    const b = JSON.parse(j.body || '{}'), q = await DB.get('photos', x.id);
    if (q && b.id != null) { q.mtPid = b.id; await DB.put('photos', q); }
    return b.status === 'neu';
  },

  /* ---------------------------------------------------------------- Alle verbundenen Touren ---------------------------------------------------------------- */
  async alle(after) {
    if (!MT.aktiv()) return null;
    if (MedienAbgleich._busy) { toast('Es läuft schon ein Abgleich.'); return null; }
    const acc = await MedienAbgleich.konto(); if (!acc) return null;
    const tours = (await Tours.list()).filter(t => MedienCalc.mtId(t) && t.status !== 'planned');
    if (!tours.length) { toast('Keine Tour ist mit Meine Touren verbunden. Hol oder sende zuerst Touren.', 7000); return null; }
    let items;
    try {
      items = await PhotoSources.progress('Was ist neu?', async upd => {
        const ueb = await MedienAbgleich.uebersicht(acc, tours.map(t => MedienCalc.mtId(t))), out = [];
        for (let i = 0; i < tours.length; i++) {
          const t = tours[i], id = MedienCalc.mtId(t), lokal = await MedienAbgleich.lokal(t.id);
          upd(i + 1, tours.length, t.name);
          if (!MedienCalc.brauchtAbruf(t, ueb[id], lokal, { videos: true })) continue;
          const r = await MedienAbgleich.lese(acc, id);
          const lage = MedienCalc.notizLage(t, r.notiz || {}), plan = MedienCalc.fotoPlan(lokal, r, {});
          if (r.darf_schreiben === false || acc.role === 'viewer') plan.darfSchreiben = false;
          const leer = lage.fall === 'gleich' && !plan.holen.length && !plan.senden.length && !plan.videosHolen.length && !plan.videosSenden.length;
          if (leer) { if (ueb[id]) { t.mtStand = ueb[id].stand; await Tours.save(t); } continue; }
          out.push({ t, id, r, lage, plan });
        }
        return out;
      }, { note: 'Es wird nur gelesen. Übertragen wird erst nach deiner Auswahl.' });
    } catch (e) { toast('Abgleich nicht möglich: ' + e.message, 8000); if (e.relogin && after) after(); return null; }
    if (!items.length) { toast('Alles ist gleich – nichts abzugleichen.', 5000); return null; }
    const darf = items.every(i => i.plan.darfSchreiben);
    const st = { wahl: darf ? 'beides' : 'holen', videos: false };
    const sum = h('p', { class: 'muted small', id: 'ab-a-mb' }), segBox = h('div'), vbox = h('div');
    const fuer = i => {
      const nw = st.wahl === 'beides' ? i.lage.vorschlag : st.wahl === 'holen' ? (['holen', 'beides'].includes(i.lage.vorschlag) || i.lage.fall === 'nurDort' ? 'holen' : 'nichts') : (['senden', 'beides'].includes(i.lage.vorschlag) || i.lage.fall === 'nurHier' ? 'senden' : 'nichts');
      return { t: i.t, id: i.id, r: i.r, lage: i.lage, notiz: i.lage.zuLang.includes(nw) || (!i.plan.darfSchreiben && nw !== 'holen') ? 'nichts' : nw, a: MedienCalc.auswahl(i.plan, st.wahl, st), force: false };
    };
    const zeig = () => {
      const l = items.map(fuer), n = l.reduce((x, i) => x + i.a.n, 0), mb = l.reduce((x, i) => x + i.a.bytes + i.a.videoBytes, 0);
      sum.textContent = n || l.some(i => i.notiz !== 'nichts') ? 'Bei dieser Wahl: ' + l.filter(i => i.notiz !== 'nichts').length + ' Notiz(en), ' + n + ' Datei(en), etwa ' + MedienCalc.mb(mb) + '.' : 'Bei dieser Wahl wird nichts übertragen.';
      segBox.innerHTML = '';
      segBox.append(UI.seg([['holen', 'Holen'], ['senden', 'Senden'], ['beides', 'Beides']].filter(x => darf || x[0] === 'holen'), st.wahl, k => { st.wahl = k; zeig(); }, { label: 'Richtung', cls: 'ab-seg' }));
      const nv = items.reduce((x, i) => x + i.plan.videosHolen.length + i.plan.videosSenden.length, 0);
      vbox.innerHTML = '';
      if (nv) vbox.append(UI.toggle('Videos einbeziehen (' + nv + ')', st.videos, v => { st.videos = !!v; zeig(); }, { id: 'ab-videos' }),
        h('p', { class: 'muted small' }, 'Vorgabe aus. Nur im WLAN, höchstens 200 MB je Video.'));
    };
    const liste = UI.list(items.map(i => UI.row({ title: i.t.name, sub: [F.dshort(i.t.start), MedienCalc.notizText(i.lage), MedienCalc.fotoText(i.plan)].filter(Boolean).join(' · ') })), { id: 'ab-a-liste' });
    const go = h('button', { class: 'btn pri', id: 'ab-a-go' }, 'Abgleichen');
    const s = sheet('Notizen und Fotos abgleichen', h('div', { id: 'ab-alle' },
      darf ? null : MedienAbgleich.hinweisBetrachter(),
      h('p', { id: 'ab-a-zahl' }, items.length + (items.length === 1 ? ' Tour hat' : ' Touren haben') + ' Neues.'), liste, segBox, sum, vbox,
      UI.toggle('Nur über WLAN (große Mengen und Videos)', Set_.get('mtWlan') !== false, v => Set_.set('mtWlan', !!v), { id: 'ab-wlan' }),
      h('p', { class: 'muted small' }, 'Bei „Beides“ gilt je Tour der Vorschlag der Vorschau. Notizen werden zusammengeführt, nie überschrieben. Einzelne Touren kannst du auch auf ihrer Tourseite abgleichen.'),
      h('div', { class: 'row end wrap' }, h('button', { class: 'btn', onclick: () => s.close() }, 'Abbrechen'), go)));
    go.onclick = async () => {
      const l = items.map(fuer).filter(i => i.notiz !== 'nichts' || i.a.n);
      if (!l.length) { toast('Bei dieser Wahl gibt es nichts zu übertragen.'); return; }
      if (!await MedienAbgleich.bestaetigen(l)) return;
      s.close(); await MedienAbgleich.mitFortschritt(acc, l, after);
    };
    zeig();
    return s;
  },
};
