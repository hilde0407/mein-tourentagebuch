'use strict';
/* Datensicherung (.mtl): speichern, einspielen, und merken, wann zuletzt gesichert wurde (für den ruhigen Hinweis auf der Startseite).
   Eine Sicherung enthält Touren, Spuren, Foto-Einträge und die Merkliste (kv) ohne Zugangsdaten und ohne Zwischenspeicher.
   Beim Einspielen kommen auch die eigenen Angaben zurück: Ziele, Notizen und Links der Planung, Einstellungen (Geburtsjahr, Startseite …), Namen von Reisen.
   Ältere Sicherungen ohne diese Angaben laden unverändert. */
const Backup = {
  /** Nicht in die Sicherung: Zugangsdaten und Zwischenspeicher. */
  SKIP: ['komoot', 'strava', 'zepp', 'smb', 'webdav', 'heroMap', 'tilebg', 'lastBackup', 'backupSnooze', 'calcVer', 'calcNote'],
  /** Diese Einträge werden beim Einspielen zurückgeholt, wenn es sie auf dem Gerät noch nicht gibt (Planung und Notizen einer Tour: die Sicherung gilt). */
  RESTORE_KEYS: ['goals', 'goals2', 'comments', 'places', 'tripHidden', 'tripNames', 'tripPeriod', 'tripRegion', 'tripSet'],
  RESTORE_PREFIX: ['plan:', 'pn:'],

  /** Inhalt der Sicherung (reines Objekt, noch nicht gepackt). */
  async collect() {
    return { app: 'tourentagebuch', v: 1, date: Date.now(), tours: await DB.all('tours'), tracks: await DB.all('tracks'), photos: await DB.all('photos'),
      kv: (await DB.all('kv')).filter(k => !Backup.SKIP.includes(k.k)) };
  },
  /** Sicherung speichern; merkt bei Erfolg den Zeitpunkt. Gibt den Speicherort (Text) zurück. */
  async save() {
    const data = await Backup.collect();
    const gz = fflate.gzipSync(new TextEncoder().encode(JSON.stringify(data)));
    let bin = ''; gz.forEach(b => bin += String.fromCharCode(b));
    const name = 'Tourentagebuch-Sicherung-' + new Date().toISOString().slice(0, 10) + '.mtl';
    let where;
    try { where = await Native.json('saveFile', { name, mime: 'application/octet-stream', b64: btoa(bin) }); toast('Gespeichert: ' + where, 6000); }
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
            if (!(k in Set_.defaults)) continue;
            if (JSON.stringify(Set_.v[k]) === JSON.stringify(Set_.defaults[k]) && JSON.stringify(e.v[k]) !== JSON.stringify(Set_.defaults[k])) { Set_.v[k] = e.v[k]; ch++; }
          }
          if (ch) { await DB.kvSet('settings', Set_.v); n++; }
        } else if (e.k === 'goals' || e.k === 'goals2') {
          if (await Goals.mergeFrom(e.k, e.v)) n++;
        } else if (Backup.RESTORE_PREFIX.some(p => e.k.startsWith(p))) { await DB.kvSet(e.k, e.v); n++; }
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
      if (!await confirmBox('Sicherung einspielen?', `${data.tours.length} Touren und ${data.photos.length} Foto-Einträge werden hinzugefügt. Vorhandene Daten bleiben erhalten. (Die Foto-Dateien selbst sind nicht Teil der Sicherung.)`, 'Einspielen')) return;
      await Backup.apply(data);
      toast('Sicherung eingespielt'); Nav.render();
    } catch (e) { toast(e.message, 7000); }
  },
  async apply(data) {
    await DB.putMany('tours', data.tours); await DB.putMany('tracks', data.tracks || []); await DB.putMany('photos', data.photos || []);
    await Backup.restoreKv(data.kv);
    Tours.invalidate();
    await DB.kvSet('calcVer', 0);      // alte Sicherungen: Aufstieg nach dem Einspielen neu rechnen (Touren mit calcV 2 werden übersprungen)
    Tours.migrate().then(r => { if (r && (r.up || r.sport)) Nav.render(); }).catch(() => {});
  },
};
