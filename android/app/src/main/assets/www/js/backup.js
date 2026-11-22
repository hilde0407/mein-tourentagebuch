'use strict';
/* Datensicherung (.mtl): speichern, einspielen, und merken, wann zuletzt gesichert wurde (für den ruhigen Hinweis auf der Startseite).
   Eine Sicherung enthält Touren, Spuren, Foto-Einträge und die Merkliste (kv) ohne Zugangsdaten und ohne Zwischenspeicher.
   Beim Einspielen kommen auch die eigenen Angaben zurück: Ziele, Notizen und Links der Planung, Einstellungen (Geburtsjahr, Startseite …), Namen von Reisen.
   2.4.0: auch die Wanderführer (Bücher, Buchstrecken, Titelbilder; kv „guides“, „guidepts:…“, „guidecover:…“) – ohne den Zwischenspeicher des Abgleichs („guideMatch“).
   Ältere Sicherungen ohne diese Angaben laden unverändert. */
const Backup = {
  /** Nicht in die Sicherung: Zugangsdaten (auch die Sitzung bei „Meine Touren“, kv „mt“) und Zwischenspeicher. */
  SKIP: ['komoot', 'strava', 'zepp', 'mt', 'smb', 'webdav', 'heroMap', 'tilebg', 'lastBackup', 'backupSnooze', 'calcVer', 'calcNote', 'posVer', 'skiVer', 'abgleich', 'guideMatch', 'mtOffen', 'recRoute', 'autoBackupDay'],
  /** Diese Einträge werden beim Einspielen zurückgeholt, wenn es sie auf dem Gerät noch nicht gibt (Planung und Notizen einer Tour: die Sicherung gilt). */
  RESTORE_KEYS: ['goals', 'goals2', 'comments', 'places', 'tripHidden', 'tripNames', 'tripPeriod', 'tripRegion', 'tripSet', 'dupIgnore'],
  RESTORE_PREFIX: ['plan:', 'pn:'],
  /** Einstellungen, die zum Gerät gehören und beim Einspielen nie übernommen werden: automatische Sicherung (braucht den Ordner dieses Geräts, 2.10.0)
      und die Entscheidung „Mit Meine Touren zusammenarbeiten“ (2.15.0: ein frisches Gerät fragt selbst; eine eigene Entscheidung bleibt). */
  GERAET: ['backupAuto', 'mtAktiv', 'mtWahl', 'flugStufe', 'flugVideo'],      // 2.16.0: flugStufe hängt vom Handy ab; 2.17.0: flugVideo (Auflösung je nach Kodierer) ebenso

  /** Inhalt der Sicherung (reines Objekt, noch nicht gepackt). */
  async collect() {
    return { app: 'tourentagebuch', v: 1, date: Date.now(), tours: await DB.all('tours'), tracks: await DB.all('tracks'), photos: await DB.all('photos'),
      kv: (await DB.all('kv')).filter(k => !Backup.SKIP.includes(k.k)) };
  },
  /** Gepackte Sicherung als Base64 (für die Hülle). */
  async packB64() {
    const gz = fflate.gzipSync(new TextEncoder().encode(JSON.stringify(await Backup.collect())));
    let bin = ''; for (let i = 0; i < gz.length; i += 0x8000) bin += String.fromCharCode.apply(null, gz.subarray(i, i + 0x8000));
    return { gz, b64: btoa(bin) };
  },
  /** 2.10.0: „Automatisch in Ordner sichern“ – beim Start höchstens einmal am Tag eine neue .mtl in den Sicherungsordner (die Hülle behält die neuesten 5).
      Still: Erfolg ohne Meldung (zählt als Sicherung für die Erinnerung), ein Fehler nur einmal am Tag kurz. */
  async auto() {
    try {
      if (!window.MTApp || !Set_.get('backupAuto')) return null;
      const jetzt = Date.now(), tag = await DB.kvGet('autoBackupDay', '');
      if (!SicherungCalc.autoFaellig(true, true, tag, jetzt)) return null;
      if (!(await DB.count('tours'))) return null;
      await DB.kvSet('autoBackupDay', SicherungCalc.tagKey(jetzt));      // auch bei Fehler: heute nicht noch einmal versuchen
      const f = await Native.json('mediaFolder');
      if (!f || !f.tree || !f.ok) { toast('Automatische Sicherung: kein Zugriff auf den Sicherungsordner. Bitte unter Einstellungen → Datensicherung neu wählen.', 7000); return null; }
      const { b64 } = await Backup.packB64();
      const r = await Native.json('autoBackup', { name: SicherungCalc.autoName(jetzt), b64, keep: 5 });
      await DB.kvSet('lastBackup', Date.now()); await DB.kvSet('backupSnooze', 0);
      return r;
    } catch (e) { console.error('Automatische Sicherung', e); toast('Automatische Sicherung nicht möglich: ' + e.message, 7000); return null; }
  },
  /** Sicherung speichern; merkt bei Erfolg den Zeitpunkt. Gibt den Speicherort (Text) zurück. */
  async save() {
    const { gz, b64 } = await Backup.packB64();
    const name = 'Tourentagebuch-Sicherung-' + new Date().toISOString().slice(0, 10) + '.mtl';
    let where;
    try { where = await Native.json('saveFile', { name, mime: 'application/octet-stream', b64 }); toast('Gespeichert: ' + where, 6000); }
    catch (e) { const a = h('a', { href: URL.createObjectURL(new Blob([gz])), download: name }); document.body.append(a); a.click(); a.remove(); where = name; }
    await DB.kvSet('lastBackup', Date.now()); await DB.kvSet('backupSnooze', 0);
    return where;
  },
  /** Gepackte Sicherung lesen und prüfen. */
  parse(buf) {
    const data = JSON.parse(new TextDecoder().decode(fflate.gunzipSync(buf)));
    if (data.app !== 'tourentagebuch') throw new Error('Das ist keine Sicherung von Mein Tourentagebuch.');
    return data;
  },
  /** Eigene Angaben aus einer Sicherung zurückholen. Nichts Vorhandenes geht verloren: Einstellungen füllen nur, was auf dem Gerät noch Vorgabe ist; Ziele werden ergänzt. */
  async restoreKv(list) {
    let n = 0;
    for (const e of Array.isArray(list) ? list : []) {
      if (!e || typeof e.k !== 'string' || Backup.SKIP.includes(e.k)) continue;
      try {
        if (e.k === 'settings' && e.v && typeof e.v === 'object') {
          let ch = 0;
          for (const k of Object.keys(e.v)) {
            if (!(k in Set_.defaults) || Backup.GERAET.includes(k)) continue;      // 2.10.0/2.15.0: Entscheidungen dieses Geräts – nicht mitnehmen
            if (JSON.stringify(Set_.v[k]) === JSON.stringify(Set_.defaults[k]) && JSON.stringify(e.v[k]) !== JSON.stringify(Set_.defaults[k])) { Set_.v[k] = e.v[k]; ch++; }
          }
          if (ch) { await DB.kvSet('settings', Set_.v); n++; }
        } else if (e.k === 'goals' || e.k === 'goals2') {
          if (await Goals.mergeFrom(e.k, e.v)) n++;
        } else if (e.k === 'guides') { if (await Buecher.mergeFrom(e.v)) n++; }      // 2.4.0: Wanderführer: neue Bücher kommen dazu, vorhandene bleiben
        else if (e.k.startsWith('guidepts:') || e.k.startsWith('guidecover:')) { if ((await DB.get('kv', e.k)) === undefined) { await DB.kvSet(e.k, e.v); n++; } }
        else if (Backup.RESTORE_PREFIX.some(p => e.k.startsWith(p))) { await DB.kvSet(e.k, e.v); n++; }
        else if (Backup.RESTORE_KEYS.includes(e.k) && (await DB.get('kv', e.k)) === undefined) { await DB.kvSet(e.k, e.v); n++; }
      } catch (err) { console.error('Sicherung, Eintrag ' + e.k, err); }
    }
    return n;
  },
  /** Datei wählen und einspielen (mit Rückfrage). */
  async restore() {
    try {
      const f = await Native.json('pickFiles'); if (!f.length) return;
      const data = Backup.parse(await Import.fetchBuf(f[0].url));
      const nb = ((data.kv || []).find(k => k && k.k === 'guides') || { v: [] }).v.length;
      if (!await confirmBox('Sicherung einspielen?', `${data.tours.length} Touren und ${data.photos.length} Foto-Einträge${nb ? ' sowie ' + nb + (nb === 1 ? ' Wanderführer (Buch)' : ' Wanderführer (Bücher)') : ''} werden hinzugefügt. Vorhandene Daten bleiben erhalten. (Die Foto- und Videodateien selbst sind nicht Teil dieser Sicherung – sie kommen über „Fotos und Videos wiederherstellen“ zurück.)`, 'Einspielen')) return;
      await Backup.apply(data);
      toast('Sicherung eingespielt'); Nav.render();
    } catch (e) { toast(e.message, 7000); }
  },
  async apply(data) {
    await DB.putMany('tours', data.tours); await DB.putMany('tracks', data.tracks || []); await DB.putMany('photos', data.photos || []);
    await Backup.restoreKv(data.kv);
    Tours.invalidate();
    await DB.kvSet('calcVer', 0); await DB.kvSet('posVer', 0); await DB.kvSet('skiVer', 0);      // alte Sicherungen: Aufstieg nach dem Einspielen neu rechnen (Touren mit calcV 2 werden übersprungen)
    Tours.migrate().then(r => { if (r && (r.up || r.sport || r.pos || r.ski)) Nav.render(); }).catch(() => {});
  },
};

/* 2.10.0: Sicherung der Foto- und Videodateien. Die Hülle schreibt ZIP-Dateien (ohne Kompression, Teile bis 1,5 GB) in einen einmal gewählten Ordner
   und merkt sich, was schon gesichert ist – beim nächsten Mal kommt nur Neues in eine weitere Datei „Medien_<Datum>.zip“. Wiederherstellen aus einer
   oder mehreren dieser Dateien; vorhandene Fotos bleiben unverändert. Läufe laufen in der Hülle (Vordergrunddienst), die Oberfläche fragt den Stand ab. */
const Medien = {
  /** Stand von der Hülle: { anzahl, bytes, neu, neuBytes, teile, last?, folder? } oder null (Browser, alte Hülle). */
  async status() {
    if (!window.MTApp) return null;
    try { const s = await Native.json('mediaStatus'); return s && typeof s.neu === 'number' ? s : null; } catch (e) { return null; }
  },
  /** Sicherungsordner: gemerkten nehmen, sonst (oder mit neu = true) wählen lassen. Gibt { tree, name } oder null zurück. */
  async ordner(neu) {
    let f = null;
    if (!neu) { try { f = await Native.json('mediaFolder'); } catch (e) { f = null; } }
    if (f && f.tree && f.ok) return f;
    if (!neu && f && f.tree && !f.ok) toast('Kein Zugriff mehr auf den Sicherungsordner – bitte neu wählen.', 5000);
    try { f = await Native.json('mediaFolder', { pick: true }); } catch (e) { toast(e.message, 6000); return null; }
    if (!f || !f.tree) return null;
    if (!f.ok) { toast('Dieser Ordner erlaubt kein dauerhaftes Schreiben. Bitte einen anderen wählen.', 7000); return null; }
    return f;
  },
  async sichern() {
    if (!window.MTApp) { toast('Nur in der Android-App verfügbar.'); return null; }
    const st = await Medien.status();
    if (!st) { toast('Diese App-Version kann Fotos und Videos noch nicht sichern.', 5000); return null; }
    if (st.running) return Medien.follow();
    if (!st.neu) { toast(st.anzahl ? 'Alles gesichert – keine neuen Fotos oder Videos.' : 'Keine Fotos oder Videos vorhanden.', 5000); return null; }
    const f = await Medien.ordner(false); if (!f) return null;
    const txt = SicherungCalc.neuZeile(st.neu, st.neuBytes, st.last) + '. Sie werden als ' + (st.teile > 1 ? st.teile + ' ZIP-Dateien (je höchstens 1,5 GB)' : 'ZIP-Datei')
      + ' im Ordner „' + f.name + '“ gespeichert. Bei vielen Videos dauert das einige Minuten; die App muss dafür nicht offen bleiben.';
    if (!await confirmBox('Fotos und Videos sichern?', txt, 'Sichern')) return null;
    let r;
    try { r = await Native.json('mediaBackup', { tree: f.tree }); } catch (e) { toast('Sichern nicht möglich: ' + e.message, 7000); return null; }
    if (r && r.started === false) toast('Es läuft schon eine Sicherung.', 4000);
    return Medien.follow();
  },
  async wiederherstellen() {
    if (!window.MTApp) { toast('Nur in der Android-App verfügbar.'); return null; }
    const st = await Medien.status();
    if (st && st.running) return Medien.follow();
    let l;
    try { l = await Native.json('mediaPickZips'); } catch (e) { toast(e.message, 6000); return null; }
    if (!Array.isArray(l) || !l.length) return null;
    const gross = l.reduce((s, x) => s + (+x.size || 0), 0);
    const txt = (l.length === 1 ? '1 Datei' : l.length + ' Dateien') + (gross ? ' (' + SicherungCalc.groesse(gross) + ')' : '') + ' werden gelesen. '
      + 'Fotos und Videos, die es auf dem Handy schon gibt, bleiben unverändert. Die Einträge (Zeit, Ort, Tour) kommen aus der normalen Sicherung (.mtl).';
    if (!await confirmBox('Fotos und Videos wiederherstellen?', txt, 'Wiederherstellen')) return null;
    let r;
    try { r = await Native.json('mediaRestore', { uris: l.map(x => x.uri) }); } catch (e) { toast('Wiederherstellen nicht möglich: ' + e.message, 7000); return null; }
    if (r && r.started === false) toast('Es läuft schon eine Sicherung.', 4000);
    return Medien.follow();
  },
  /** Fortschrittsblatt mit „Abbrechen“, bis der Lauf der Hülle fertig ist; danach eine Zusammenfassung. Schließen bricht nicht ab. */
  follow() {
    if (Medien._s) return Medien._p;
    const bar = h('div', { class: 'prog', id: 'md-prog' }, h('i')), txt = h('p', { id: 'md-txt' }, 'Wird gestartet …');
    const stop = h('button', { class: 'btn', id: 'md-stop', onclick: async e => { e.currentTarget.disabled = true; e.currentTarget.textContent = 'Wird abgebrochen …'; try { await Native.call('mediaCancel'); } catch (x) { /* egal */ } } }, 'Abbrechen');
    let timer = null, fertig = false, titel = 'Fotos und Videos sichern';
    Medien._p = new Promise(res => {
      const aus = () => { fertig = true; clearInterval(timer); Medien._s = null; };
      const s = Medien._s = sheet(titel, h('div', null, txt, bar,
        h('p', { class: 'muted small' }, 'Läuft im Hintergrund weiter, auch bei ausgeschaltetem Bildschirm (siehe Benachrichtigung). Schließen bricht nicht ab.'),
        h('div', { class: 'row end' }, stop)), { onclose: () => { if (!fertig) { aus(); res(null); } } });
      const poll = async () => {
        let j; try { j = await Native.json('mediaJob'); } catch (e) { return; }
        if (fertig || !j) return;
        if (j.kind === 'restore' && titel !== 'Fotos und Videos wiederherstellen') { titel = 'Fotos und Videos wiederherstellen'; const b = s.el.querySelector('.sheet-h b'); if (b) b.textContent = titel; s.el.setAttribute('aria-label', titel); }
        if (!j.running) {
          aus(); s.close();
          toast(SicherungCalc.ergebnis(j), 8000);
          if (j.kind === 'restore' && j.result && j.result.restored) window.dispatchEvent(new Event('photos-changed'));
          if (Medien.refresh) Medien.refresh().catch(() => {});
          res(j); return;
        }
        const p = SicherungCalc.fortschritt(j);
        txt.textContent = p.text; bar.firstChild.style.width = Math.round(p.anteil * 100) + '%';
      };
      timer = setInterval(poll, 700); poll();
    });
    return Medien._p;
  },
};
