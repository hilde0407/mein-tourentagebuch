'use strict';
/* 2.18.0: Notizen, Fotos und (auf Wunsch) Videos mit Meine Touren abgleichen – in beide Richtungen, nur auf Knopfdruck, mit Vorschau „was ist neu“.
   Tourseite → Aktionen → „Mit Meine Touren abgleichen …“ (eine Tour) und Touren importieren → Meine Touren → „Notizen und Fotos abgleichen …“ (alle verbundenen Touren).
   Server: Meine Touren ab 3.57.0 (GET /api/tours/{id}/tagebuch, GET /api/tagebuch/uebersicht, GET …/tagebuch/photo|video, POST …/notiz|photo|video).
   Regeln und Rechnung: js/calc-abgleich-medien.js (MedienCalc). Übertragung: seit 2.18.1 als Auftrag in der Hülle (MtAbgleich.java im Vordergrunddienst
   MtAbgleichService, Schritte in MtMedien.java / MtTransfer.java) – läuft auch bei ausgeschaltetem Bildschirm weiter.
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
        plan.videosZuGross.length ? h('p', { class: 'muted small', id: 'ab-v-gross' }, anz(plan.videosZuGross.length, 'Video ist', 'Videos sind') + ' zu groß (über 200 MB je Video oder 1 GB je Tour) – sie bleiben, wo sie sind.') : null);
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
    if (plan.dortGeloescht.length) box.append(h('p', { class: 'muted small', id: 'ab-f-dortweg' }, anz(plan.dortGeloescht.length, 'Foto', 'Fotos') + ' gibt es in Meine Touren nicht mehr – sie bleiben hier und werden nicht erneut gesendet.'));
    box.append(vid); zeig();
    return { el: box, st, auswahl: () => MedienCalc.auswahl(plan, st.wahl, st) };
  },
  hinweisBetrachter() { return h('p', { class: 'warn small', id: 'ab-viewer' }, 'Dieses Konto darf nur ansehen. Holen geht, Senden nicht. Zum Senden brauchst du ein Konto mit Schreibrechten.'); },

  /* ---------------------------------------------------------------- Eine Tour ---------------------------------------------------------------- */
  async tour(t, after) {
    if (!MT.aktiv()) return null;
    if (MedienAbgleich._busy) { toast('Abgleich läuft schon'); return null; }
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
    if (!darf) body.append(MedienAbgleich.hinweisBetrachter());      // 2.18.1: append(null) schrieb „null“ ins Blatt
    body.append(nt.el, ft.el, wlan,
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
    if (nn) teile.push(nn === 1 && items.length === 1 ? 'Notiz: ' + { holen: 'holen', senden: 'senden', beides: 'in beide Richtungen' }[items[0].notiz] : anz(nn, 'Notiz', 'Notizen'));
    if (nh) teile.push(anz(nh, 'Foto', 'Fotos') + ' holen');
    if (ns) teile.push(anz(ns, 'Foto', 'Fotos') + ' senden');
    if (vids.length) teile.push(MedienCalc.videoFrage(vids));
    return confirmBox(vids.length ? 'Auch Videos übertragen?' : 'Jetzt abgleichen?', teile.join(' · ') + (mb ? ' – etwa ' + MedienCalc.mb(mb) + '.' : '.'), vids.length ? 'Ja, mit Videos' : 'Abgleichen');
  },

  /* ---------------------------------------------------------------- Ausführen ----------------------------------------------------------------
     2.18.1: Die Schleife über alle Schritte läuft als Auftrag in der Hülle (MtAbgleich.java, Vordergrunddienst mit Wake-Lock und WLAN-Sperre) – auch bei
     ausgeschaltetem Bildschirm, wenn die WebView angehalten ist. Die Oberfläche baut den Plan (MedienCalc.auftrag), startet ihn (mtAbgleichStart) und übernimmt
     die Ergebnisse in die Datenbank, sobald sie läuft (mtAbgleichStand mit „ab“ = schon übernommene Zeilen; gemerkt in kv LAUF). Die Übernahme ist
     wiederholbar ohne Schaden (gleiche Kennungen werden verknüpft, nicht doppelt angelegt). Unterbrochen (Dienst vom System beendet) → „Abgleich fortsetzen?“. */
  LAUF: 'mtAbgleichLauf',
  _ix: null, _frage: false,
  neuRes: () => ({ notiz: null, konflikt: false, holen: 0, uebersprungen: 0, gesendet: null, videos: 0, fehler: [], stopped: false }),
  async mitFortschritt(acc, items, after) {
    if (MedienAbgleich._busy) { toast('Abgleich läuft schon'); return null; }
    if (!MT.aktiv()) return null;
    if (items.some(i => i.a.wlan) && Set_.get('mtWlan') !== false) {
      let wifi = true; try { wifi = !!(await Native.json('mtNetz')).wifi; } catch (e) { wifi = true; }      // ohne Hülle (Browser) keine Prüfung
      if (!wifi) { toast('Kein WLAN. Für große Mengen und Videos bitte mit einem WLAN verbinden – oder „Nur über WLAN“ ausschalten (Videos nur im WLAN).', 9000); return null; }
    }
    MedienAbgleich._busy = true;
    const res = MedienAbgleich.neuRes();
    let job;
    try {
      for (const it of items) {      // Notiz holen braucht kein Netz: gleich hier (dann ist sie auch bei einem Abbruch schon da)
        const t = (await DB.get('tours', it.t.id)) || it.t;
        const leerHier = it.notiz === 'beides' && !MedienCalc.norm(t.note) && it.r.notiz && it.r.notiz.text;      // ein leerer Text löscht nie: dann holen
        if (it.notiz === 'holen' || leerHier) {
          const st = await MedienAbgleich.notizHolen(it);
          if (st) { res.notiz = st.status; if (st.status === 'zusammengefuehrt') res.konflikt = true; }
          it.notiz = 'nichts'; it.stand = true;
        }
        it.t = (await DB.get('tours', it.t.id)) || it.t;
      }
      job = { jobId: 'ab' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7), titel: 'Mit Meine Touren abgleichen', wifiOnly: Set_.get('mtWlan') !== false,
        wlanFotos: items.some(i => i.a.wlan), tasks: MedienCalc.auftrag(items, acc.base) };
    } catch (e) { MedienAbgleich._busy = false; toast('Abgleich nicht möglich: ' + e.message, 8000); if (after) after(); return null; }
    await DB.kvSet(MedienAbgleich.LAUF, { jobId: job.jobId, ab: 0, res });
    let st;
    try { st = await Native.json('mtAbgleichStart', Object.assign({ cookie: MedienAbgleich.cookie(acc) }, job)); } catch (e) { st = { started: false, error: e.message }; }
    if (!st || !st.started) {
      MedienAbgleich._busy = false; await DB.del('kv', MedienAbgleich.LAUF);
      toast('Abgleich nicht möglich: ' + ((st && st.error) || 'unbekannter Fehler'), 9000); if (after) after(); return null;
    }
    return MedienAbgleich.verfolgen(acc, after);
  },
  /** Hinweis beim Start: Akku-Optimierung ausnehmen (nur wenn die Hülle sagt, dass sie an ist). Keine Berechtigung nötig – nur Einstellungen öffnen. */
  akkuHinweis() {
    let frei = null; try { if (window.MTApp && MTApp.batteryUnrestricted) frei = !!MTApp.batteryUnrestricted(); } catch (e) { frei = null; }
    if (frei !== false) return null;
    return h('div', { id: 'ab-akku' }, h('p', { class: 'small' }, 'Für lange Übertragungen bei gesperrtem Bildschirm: die Akku-Optimierung für diese App ausschalten. Bei Xiaomi/HyperOS zusätzlich in den App-Einstellungen „Autostart“ einschalten und unter Akku/Energiesparen „Keine Einschränkungen“ wählen.'),
      h('div', { class: 'row wrap' }, h('button', { class: 'btn', id: 'ab-akku-opt', onclick: () => MTApp.openBatterySettings() }, 'Akku-Optimierung'),
        MTApp.openAppDetails ? h('button', { class: 'btn', id: 'ab-akku-app', onclick: () => MTApp.openAppDetails() }, 'App-Einstellungen') : null));
  },
  /** Fortschritt zeigen und Ergebnisse übernehmen, bis der Auftrag in der Hülle nicht mehr läuft. Das Blatt darf man schließen – übernommen wird trotzdem. */
  async verfolgen(acc, after) {
    MedienAbgleich._busy = true; MedienAbgleich._ix = null;
    const bar = h('div', { class: 'prog' }, h('i')), txt = h('p', { id: 'ab-p-text' }, 'Wird gestartet …');
    const stop = h('button', { class: 'btn', id: 'ab-p-stop', onclick: e => { e.currentTarget.disabled = true; e.currentTarget.textContent = 'Wird abgebrochen …'; Native.call('mtAbgleichCancel').catch(() => {}); } }, 'Abbrechen');
    const akku = MedienAbgleich.akkuHinweis();
    const s = sheet('Mit Meine Touren abgleichen', h('div', { id: 'ab-lauf' }, txt, bar,
      h('p', { class: 'muted small' }, 'Du kannst das Handy sperren oder die App verlassen – der Abgleich läuft im Hintergrund weiter (siehe Benachrichtigung).'), akku, h('div', { class: 'row end' }, stop)));
    let st = null, err = null;
    try {
      for (;;) {
        st = await MedienAbgleich.abholen();
        if (!st || !st.da) break;
        const n = +st.n || 1, f = Math.min(+st.fertig || 0, n);
        bar.firstChild.style.width = (st.bytesTotal > 0 ? (f + st.bytesDone / st.bytesTotal) / n * 100 : f / n * 100) + '%';
        txt.textContent = st.running ? (st.text || (f + ' von ' + n)) + (st.bytesTotal > 0 ? ' · ' + MedienCalc.mb(st.bytesDone) + ' von ' + MedienCalc.mb(st.bytesTotal) : '') : f + ' von ' + n + ' erledigt';
        if (akku && akku.isConnected) { try { if (MTApp.batteryUnrestricted()) akku.remove(); } catch (e) { /* bleibt */ } }
        if (!st.running) break;
        await sleep(1000);
      }
    } catch (e) { err = e; }
    finally { s.close(); MedienAbgleich._busy = false; }
    if (err) { toast('Abgleich nicht möglich: ' + err.message, 9000); if (after) after(); return null; }
    return MedienAbgleich.abschluss(acc, st, after);
  },
  /** Neue Ergebnisse aus der Hülle holen und übernehmen. Gibt den Stand zurück (st.lauf = { jobId, ab, res }). */
  async abholen() {
    let lauf = await DB.kvGet(MedienAbgleich.LAUF, null), st;
    for (;;) {
      const ab = lauf && lauf.ab || 0;
      st = await Native.json('mtAbgleichStand', { ab });
      if (!st || !st.da) { if (lauf) await DB.del('kv', MedienAbgleich.LAUF); return st; }
      if (!lauf || lauf.jobId !== st.jobId) { lauf = { jobId: st.jobId, ab: 0, res: MedienAbgleich.neuRes() }; await DB.kvSet(MedienAbgleich.LAUF, lauf); if (ab) continue; }
      const erg = st.ergebnisse || [];
      if (erg.length && !MedienAbgleich._ix) MedienAbgleich._ix = FotoDoppeltCalc.index(await DB.all('photos'));
      for (const e of erg) {
        try { await MedienAbgleich.uebernehmen(e, lauf.res, MedienAbgleich._ix); } catch (x) { lauf.res.fehler.push(x.message); }
        lauf.ab++; await DB.kvSet(MedienAbgleich.LAUF, lauf);
      }
      if (!st.mehr || !erg.length) { st.lauf = lauf; return st; }
    }
  },
  /** Ein Ergebnis der Hülle in die Datenbank übernehmen (wie bis 2.18.0 direkt nach jedem Aufruf). e: { status, body, id …, fehler?, uebersprungen?, a: Schritt }. */
  async uebernehmen(e, res, ix) {
    const a = e.a || {}, art = a.art;
    if (e.uebersprungen) { res.gesendet = MedienCalc.zaehle(res.gesendet, { status: 'vorhanden' }); return; }      // eben beim Holen als dasselbe Foto erkannt
    if (e.fehler) { if (art !== 'stand') res.fehler.push(e.fehler); return; }
    if (e.status === 401 || e.status === 403) return;      // beendet den Auftrag; Meldung in abschluss()
    if (e.status !== 200) {
      if (art === 'stand') return;      // Stand bleibt alt: beim nächsten Mal wird die Tour eben gelesen
      try { MedienAbgleich.pruefe({ status: e.status || 500, body: e.body || '' }, { notiz: 'Notiz senden', 'foto-holen': 'Foto holen', 'foto-senden': 'Foto senden' }[art] || 'Video'); }
      catch (x) { res.fehler.push(x.message); }
      return;
    }
    if (art === 'notiz') {
      const t = await DB.get('tours', a.tour); if (!t) return;
      const j = JSON.parse(e.body || '{}'), srv = (j && j.notiz) || {};
      if (MedienCalc.norm(t.note) === a.L) {      // hier seither nicht geändert
        if (a.beides && srv.text) { t.note = srv.text; t.noteMt = MedienCalc.norm(srv.text); } else t.noteMt = a.L;
        t.mtNotizBasis = srv.geaendert != null ? srv.geaendert : null;
      } else t.noteMt = a.L;      // inzwischen hier weitergeschrieben: Basis bleibt, beim nächsten Abgleich wird zusammengeführt statt überschrieben
      await Tours.save(t);
      res.notiz = j.status; if (j.status === 'zusammengefuehrt') res.konflikt = true;
      return;
    }
    if (art === 'stand') {
      const j = JSON.parse(e.body || '{}'), t = await DB.get('tours', a.tour);
      if (t && j && j[a.mt]) { t.mtStand = j[a.mt].stand; await Tours.save(t); }
      return;
    }
    if (art === 'foto-holen') {
      if (!e.id) { res.fehler.push('Foto nicht übernommen.'); return; }
      if (await MedienAbgleich.fotoUebernehmen(e, a, ix)) res.holen++; else res.uebersprungen++;
      return;
    }
    if (art === 'foto-senden') {
      const j = JSON.parse(e.body || '{}'), q = await DB.get('photos', a.id);
      if (q) {
        if ((j.status === 'neu' || j.status === 'vorhanden') && j.id != null && (!j.tour_id || String(j.tour_id) === String(a.mt))) { q.mtPid = j.id; delete q.mtGeloescht; }
        if (j.status === 'geloescht') q.mtGeloescht = true;
        await DB.put('photos', q);
      }
      res.gesendet = MedienCalc.zaehle(res.gesendet, j);
      return;
    }
    if (art === 'video-holen') {
      const m = e.result; if (!m || !m.id) { res.fehler.push('Video nicht übernommen.'); return; }
      const old = await DB.get('photos', m.id);
      if (old) { if (old.mtPid == null) { old.mtPid = a.pid; await DB.put('photos', old); } return; }
      await DB.put('photos', { id: m.id, name: m.name || 'Video.mp4', ts: m.ts || 0, lat: m.lat != null ? m.lat : null, lon: m.lon != null ? m.lon : null, w: m.w, h: m.h, src: 'meinetouren', video: true,
        dur: m.dur || 0, tour: a.tour, pos: m.lat != null ? 'exif' : 'none', note: '', mtPid: a.pid, fp: m.fp, fpd: m.fpd, size: m.size });
      res.videos++;
      return;
    }
    if (art === 'video-senden') {
      const b = JSON.parse(e.body || '{}'), q = await DB.get('photos', a.id);
      if (q && b.id != null) { q.mtPid = b.id; await DB.put('photos', q); }
      if (b.status === 'neu') res.videos++;
    }
  },
  /** Geholtes Foto (Metadaten m aus der Hülle, Datei schon gespeichert) der Tour zuordnen. true = neu, false = schon vorhanden (verknüpft oder Duplikat). */
  async fotoUebernehmen(m, a, ix) {
    const old = await DB.get('photos', m.id);
    if (old) { if (old.mtPid == null) { old.mtPid = a.pid; if (!old.tour) old.tour = a.tour; await DB.put('photos', old); } return false; }
    if (FotoDoppeltCalc.bekannt(ix, m)) { try { await Native.call('deletePhoto', { id: m.id }); } catch (e) { /* ohne Hülle */ } return false; }
    const t = await DB.get('tours', a.tour);
    const p = { id: m.id, name: m.name, ts: m.ts || a.taken || 0, lat: m.lat != null ? m.lat : null, lon: m.lon != null ? m.lon : null, w: m.w, h: m.h, src: 'meinetouren',
      video: !!m.video, dur: m.dur || 0, tour: a.tour, pos: m.lat != null ? 'exif' : 'none', note: '', mtPid: a.pid };
    if (m.fp) p.fp = m.fp; if (m.fpd) p.fpd = m.fpd; if (m.size) p.size = m.size;
    if (p.lat == null && p.ts && t && t.timed) { const g = Geo.at(await Tours.points(t.id), p.ts, (+Set_.get('photoMargin') || 20) * 60000); if (g) { p.lat = g.lat; p.lon = g.lon; p.pos = 'track'; } }
    await DB.put('photos', p); FotoDoppeltCalc.merke(ix, p);
    return true;
  },
  /** Auftrag zu Ende (oder unterbrochen): fortsetzen anbieten, sonst Plan löschen und Ergebnis zeigen. */
  async abschluss(acc, st, after) {
    Tours.invalidate(); window.dispatchEvent(new Event('photos-changed'));
    if (!st || !st.da) return null;
    const res = (st.lauf && st.lauf.res) || MedienAbgleich.neuRes();
    if (MedienCalc.fortsetzbar(st)) return MedienAbgleich.fortsetzenFragen(acc, st, after);
    try { await Native.json('mtAbgleichVerwerfen'); } catch (e) { /* bleibt liegen, wird beim nächsten Start neu angelegt */ }
    await DB.del('kv', MedienAbgleich.LAUF);
    if (st.ende === 'relogin') { const e = acc ? await Import.MT.expired(acc) : new Error('Die Anmeldung bei Meine Touren ist abgelaufen. Bitte neu anmelden.'); toast('Abgleich nicht möglich: ' + e.message, 9000); if (after) after(); return null; }
    if (st.ende === 'verboten') { toast('Abgleich nicht möglich: Dieses Konto darf nur ansehen, Senden geht damit nicht.', 9000); if (after) after(); return null; }
    if (st.ende === 'abgebrochen') res.stopped = true;
    return MedienAbgleich.ergebnis(res, after);
  },
  ergebnis(res, after) {
    const s = sheet(res.stopped ? 'Abgleich abgebrochen' : 'Abgeglichen', h('div', { id: 'ab-ergebnis' }, h('p', { id: 'ab-ergebnis-t' }, MedienCalc.ergebnisText(res)),
      res.konflikt ? h('p', { class: 'muted small', id: 'ab-konflikt' }, 'Die Notiz war an beiden Stellen geändert. Beide Fassungen sind erhalten – getrennt durch eine Zeile mit Datum.') : null,
      h('div', { class: 'row end' }, h('button', { class: 'btn pri', id: 'ab-fertig', onclick: () => s.close() }, 'Fertig'))), { onclose: () => { if (after) after(); } });
    return res;
  },
  /** „Abgleich fortsetzen?“ – Fortsetzen, nicht fortsetzen (Plan verwerfen) oder Blatt schließen (später: beim nächsten Öffnen wieder fragen). */
  async fortsetzenFragen(acc, st, after) {
    if (MedienAbgleich._frage) return null;
    MedienAbgleich._frage = true;
    const wahl = await new Promise(ok => {
      let done = false;
      const w = v => () => { done = true; s.close(); ok(v); };
      const s = sheet('Abgleich fortsetzen?', h('div', { id: 'ab-weiter' },
        h('p', { id: 'ab-weiter-t' }, 'Der Abgleich mit Meine Touren wurde unterbrochen' + (st.ende === 'wlan' ? ' – zu lange kein WLAN' : ' – vermutlich hat Android die App im Hintergrund beendet') + '. '
          + st.fertig + ' von ' + st.n + ' Schritten sind erledigt und übernommen. Der Rest kann jetzt weiterlaufen.'),
        MedienAbgleich.akkuHinweis(),
        h('div', { class: 'row end wrap' }, h('button', { class: 'btn', id: 'ab-weiter-nein', onclick: w('nein') }, 'Nicht fortsetzen'), h('button', { class: 'btn pri', id: 'ab-weiter-ja', onclick: w('ja') }, 'Fortsetzen'))),
        { onclose: () => { if (!done) ok('spaeter'); } });
    });
    MedienAbgleich._frage = false;
    if (wahl === 'spaeter') return null;
    if (wahl === 'nein') {
      try { await Native.json('mtAbgleichVerwerfen'); } catch (e) { /* egal */ }
      await DB.del('kv', MedienAbgleich.LAUF);
      const res = (st.lauf && st.lauf.res) || MedienAbgleich.neuRes(); res.stopped = true;
      return MedienAbgleich.ergebnis(res, after);
    }
    acc = acc || await MT.konto();
    if (!acc) { toast('Es besteht keine Verbindung zu Meine Touren. Bitte erst wieder anmelden – der Abgleich bleibt vorgemerkt.', 8000); return null; }
    let r; try { r = await Native.json('mtAbgleichFortsetzen', { cookie: MedienAbgleich.cookie(acc), wifiOnly: Set_.get('mtWlan') !== false }); } catch (e) { r = { started: false, error: e.message }; }
    if (!r || !r.started) { toast('Abgleich fortsetzen nicht möglich: ' + ((r && r.error) || 'unbekannter Fehler'), 8000); return null; }
    return MedienAbgleich.verfolgen(acc, after);
  },
  /** Beim Öffnen und beim Zurückkehren in die App: läuft ein Auftrag noch (Fortschritt zeigen), liegen Ergebnisse bereit (übernehmen) oder wurde er unterbrochen (fragen)? */
  async pruefeOffen() {
    if (!MT.aktiv() || !Native.available() || MedienAbgleich._busy || MedienAbgleich._frage) return null;
    MedienAbgleich._busy = true; MedienAbgleich._ix = null;
    let st;
    try { st = await MedienAbgleich.abholen(); } catch (e) { st = null; console.error('Abgleich prüfen', e); }
    finally { MedienAbgleich._busy = false; }
    if (!st || !st.da) return null;
    const acc = await MT.konto();
    if (st.running) return MedienAbgleich.verfolgen(acc, null);
    return MedienAbgleich.abschluss(acc, st, null);
  },
  /** Notiz holen (nur hier, ohne Netz). Gibt { status } zurück. */
  async notizHolen(it) {
    const t = (await DB.get('tours', it.t.id)) || it.t, L = MedienCalc.norm(t.note);
    const neu = MedienCalc.holenMerge(L, it.r.notiz && it.r.notiz.text, t.noteMt != null && MedienCalc.norm(t.noteMt) === L);
    if (MedienCalc.laenge(neu.text) > MedienCalc.NOTIZ_MAX) throw MedienAbgleich.fehler('Zusammen wäre die Notiz zu lang.');
    t.note = neu.text; t.noteMt = neu.text; t.mtNotizBasis = it.r.notiz ? it.r.notiz.geaendert : null;
    await Tours.save(t); Object.assign(it.t, { note: t.note, noteMt: t.noteMt, mtNotizBasis: t.mtNotizBasis });
    return neu.status === 'uebernommen' || neu.status === 'zusammengefuehrt' ? { status: neu.status === 'uebernommen' ? 'geholt' : 'zusammengefuehrt' } : neu;
  },

  /* ---------------------------------------------------------------- Alle verbundenen Touren ---------------------------------------------------------------- */
  async alle(after) {
    if (!MT.aktiv()) return null;
    if (MedienAbgleich._busy) { toast('Abgleich läuft schon'); return null; }
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
      sum.textContent = n || l.some(i => i.notiz !== 'nichts') ? 'Bei dieser Wahl: ' + anz(l.filter(i => i.notiz !== 'nichts').length, 'Notiz', 'Notizen') + ', ' + anz(n, 'Datei', 'Dateien') + ', etwa ' + MedienCalc.mb(mb) + '.' : 'Bei dieser Wahl wird nichts übertragen.';
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
