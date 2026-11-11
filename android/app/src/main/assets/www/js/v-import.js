'use strict';
Views['/import'] = async root => {
  const body = h('div', { class: 'pad' });
  root.append(topbar('Touren importieren', { back: true, noMenu: true }), body);
  const run = async (title, fn) => {
    try {
      const r = await PhotoSources.progress(title, (upd, txt) => fn(upd, txt));
      const msg = r && r.added != null ? Import.describe(r) + (r.limit ? ' – ' + r.limit : '') : String(r);
      Tours.invalidate(); toast(msg, 7000);
    } catch (e) { toast(e.message, 8000); }
  };
  const card = (ico, t, sub, fn) => h('button', { class: 'li big', onclick: fn }, h('span', { class: 'li-i' }, ico), h('span', { class: 'li-t' }, h('b', null, t), h('small', null, sub)));
  body.append(h('p', { class: 'muted' }, 'Importierte Touren werden auf diesem Handy gespeichert. Doppelte Touren werden erkannt und übersprungen – du kannst jeden Import beliebig oft wiederholen.'),
    h('div', { class: 'list' },
      card('📄', 'Dateien (GPX, FIT, TCX, ZIP)', 'Auch ganze Exporte von Strava, Garmin, Suunto, Polar, Wahoo …', () => run('Import', upd => Import.pickFiles(upd))),
      card('🟢', 'Komoot', 'Alle aufgezeichneten (und geplanten) Touren', komoot),
      card('🟠', 'Strava', 'Aktivitäten über die Strava-Schnittstelle', strava),
      card('⌚', 'Zepp / Amazfit', 'Aktivitäten mit GPS direkt aus der Zepp-Cloud', zepp),
      card('🚲', 'Bosch eBike Flow', 'Fahrten aus der Flow-App', bosch),
      card('🧭', 'Garmin, Suunto, Polar, Wahoo, Coros …', 'Per Export, Teilen-Menü oder überwachtem Ordner', others),
      card('🔗', 'Link auf eine GPX-Datei', 'z. B. von Outdooractive, Wikiloc, RideWithGPS, Gipfelbuch', link)));

  async function komoot() {
    const c = await DB.kvGet('komoot', null);
    const em = h('input', { type: 'email', value: c ? c.email : '', autocomplete: 'off', placeholder: 'E-Mail' }), pw = h('input', { type: 'password', placeholder: 'Passwort', autocomplete: 'off' });
    const pl = h('input', { type: 'checkbox' });
    const s = sheet('Komoot', h('div', null,
      h('p', { class: 'muted' }, 'Es wird dein Komoot-Zugang genutzt, um deine eigenen Touren zu laden. Das Passwort wird nicht gespeichert, nur ein Zugriffsschlüssel auf diesem Handy.'),
      c ? h('p', null, '✓ Angemeldet als ' + c.email) : null,
      c ? null : h('label', { class: 'fld' }, 'E-Mail', em), c ? null : h('label', { class: 'fld' }, 'Passwort', pw),
      h('label', { class: 'sw' }, pl, ' auch geplante Touren laden'),
      h('div', { class: 'row end' }, c ? h('button', { class: 'btn', onclick: async () => { await DB.del('kv', 'komoot'); s.close(); komoot(); } }, 'Abmelden') : null,
        h('button', { class: 'btn pri', onclick: async () => {
          s.close();
          await run('Komoot', async (upd, txt) => {
            let acc = c; if (!acc) { txt.textContent = 'Anmelden …'; acc = await Import.Komoot.login(em.value.trim(), pw.value); }
            txt.textContent = 'Tourenliste laden …';
            return Import.Komoot.importAll(acc, { planned: pl.checked }, upd);
          });
        } }, 'Touren laden'))));
  }
  async function strava() {
    const c = await DB.kvGet('strava', null), id = h('input', { inputmode: 'numeric', value: c ? c.id : Set_.get('stravaId') || '', placeholder: 'Client-ID' }), sec = h('input', { type: 'password', placeholder: 'Client-Secret', value: c ? c.secret : '' });
    const code = h('input', { placeholder: 'Adresse oder Code einfügen' });
    const s = sheet('Strava', h('div', null,
      c ? h('div', null, h('p', null, '✓ Verbunden' + (c.name ? ' als ' + c.name : '')), h('div', { class: 'row end' }, h('button', { class: 'btn', onclick: async () => { await DB.del('kv', 'strava'); s.close(); strava(); } }, 'Trennen'),
        h('button', { class: 'btn pri', onclick: () => { s.close(); run('Strava', upd => Import.Strava.importAll(c, upd)); } }, 'Aktivitäten laden'))) :
      h('div', null,
        h('ol', { class: 'steps' }, h('li', null, 'Auf strava.com/settings/api eine eigene Anwendung anlegen (Domain für die Weiterleitung: ', h('code', null, 'localhost'), ').'), h('li', null, 'Client-ID und Client-Secret hier eintragen.'), h('li', null, '„Bei Strava erlauben“ tippen und zustimmen. Die Seite danach lässt sich nicht öffnen – das ist normal.'), h('li', null, 'Die Adresse dieser Seite (enthält code=…) hier einfügen.')),
        h('label', { class: 'fld' }, 'Client-ID', id), h('label', { class: 'fld' }, 'Client-Secret', sec),
        h('button', { class: 'btn', onclick: async () => { if (!id.value.trim()) { toast('Bitte Client-ID eintragen'); return; } await Set_.set('stravaId', id.value.trim()); Native.available() ? MTApp.openUrl(Import.Strava.authUrl(id.value.trim())) : window.open(Import.Strava.authUrl(id.value.trim())); } }, 'Bei Strava erlauben'),
        h('label', { class: 'fld' }, 'Adresse / Code', code),
        h('div', { class: 'row end' }, h('button', { class: 'btn pri', onclick: async () => { try { const acc = await Import.Strava.exchange(id.value.trim(), sec.value.trim(), Import.Strava.parseCode(code.value)); s.close(); run('Strava', upd => Import.Strava.importAll(acc, upd)); } catch (e) { toast(e.message, 7000); } } }, 'Verbinden & laden'))),
      h('p', { class: 'muted small' }, 'Tipp: Strava erlaubt 100 Abfragen je 15 Minuten. Bei sehr vielen Aktivitäten einfach später erneut starten. Alternativ den kompletten Strava-Export (ZIP) über „Dateien“ importieren.')));
  }
  async function zepp() {
    const c = await DB.kvGet('zepp', null);
    const em = h('input', { type: 'email', placeholder: 'E-Mail', autocomplete: 'off' }), pw = h('input', { type: 'password', placeholder: 'Passwort', autocomplete: 'off' });
    const s = sheet('Zepp / Amazfit', h('div', null,
      h('p', { class: 'muted' }, 'Funktioniert für Konten mit E-Mail und Passwort. Bei Anmeldung über Google, Apple oder Mi gibt es kein Passwort – dann in der Zepp-App Aktivitäten teilen/exportieren und per „Dateien“ importieren.'),
      c ? h('p', null, '✓ Angemeldet') : h('div', null, h('label', { class: 'fld' }, 'E-Mail', em), h('label', { class: 'fld' }, 'Passwort', pw)),
      h('div', { class: 'row end' }, c ? h('button', { class: 'btn', onclick: async () => { await DB.del('kv', 'zepp'); s.close(); zepp(); } }, 'Abmelden') : null,
        h('button', { class: 'btn pri', onclick: () => { s.close(); run('Zepp', async (upd, txt) => { let acc = c; if (!acc) { txt.textContent = 'Anmelden …'; acc = await Import.Zepp.login(em.value.trim(), pw.value); } txt.textContent = 'Aktivitäten laden …'; return Import.Zepp.importAll(acc, upd); }); } }, 'Aktivitäten laden'))));
  }
  function bosch() {
    const s = sheet('Bosch eBike Flow', h('div', null,
      h('p', null, 'Bosch bietet keine öffentliche Schnittstelle für Fahrten. So kommen sie trotzdem in die App:'),
      h('ol', { class: 'steps' }, h('li', null, 'In der Flow-App die Fahrt öffnen.'), h('li', null, 'Teilen/Exportieren wählen (GPX-Datei).'), h('li', null, 'Als Ziel „Mein Tourentagebuch“ wählen – die Fahrt wird sofort übernommen.')),
      h('p', { class: 'muted' }, 'Oder die exportierten Dateien hier auswählen. Alternativ in den Flow-Einstellungen die Verbindung zu Komoot/Strava nutzen und von dort importieren.'),
      h('div', { class: 'row end' }, h('button', { class: 'btn pri', onclick: () => { s.close(); run('Import', upd => Import.pickFiles(upd)); } }, 'Dateien wählen'))));
  }
  async function others() {
    const folders = await DB.kvGet('trackFolders', []);
    const s = sheet('Weitere Dienste', h('div', null,
      h('p', null, h('b', null, 'Teilen-Menü: '), 'In Garmin Connect, Suunto, Polar Flow, Wahoo, Coros, Outdooractive, Gipfelbuch … die Aktivität als GPX/FIT teilen und „Mein Tourentagebuch“ wählen.'),
      h('p', null, h('b', null, 'Datenexport: '), 'Vollständige Exporte (ZIP) über „Dateien“ importieren. Alle Aktivitäten darin werden übernommen.'),
      h('p', null, h('b', null, 'Überwachter Ordner: '), 'Ein Ordner, in den z. B. Syncthing, ein Cloud-Dienst oder die Garmin-Sync-App neue Dateien legt. Neue GPX/FIT/TCX-Dateien werden bei jedem Einlesen importiert.'),
      folders.length ? h('div', { class: 'list' }, folders.map((f, i) => h('div', { class: 'li' }, h('span', { class: 'li-i' }, '📁'), h('span', { class: 'li-t' }, h('b', null, decodeURIComponent(f.name))), h('button', { class: 'ico', 'aria-label': 'Entfernen', onclick: async () => { folders.splice(i, 1); await DB.kvSet('trackFolders', folders); s.close(); others(); } }, '✕')))) : null,
      h('div', { class: 'row end wrap' }, h('button', { class: 'btn', onclick: async () => { const f = await Native.json('pickFolder'); if (!f.tree) return; folders.push({ tree: f.tree, name: f.name, since: 0 }); await DB.kvSet('trackFolders', folders); s.close(); others(); } }, 'Ordner hinzufügen'),
        folders.length ? h('button', { class: 'btn pri', onclick: () => { s.close(); run('Ordner einlesen', upd => Import.scanFolders(upd)); } }, 'Jetzt einlesen') : null)));
  }
  function link() {
    const u = h('input', { type: 'url', placeholder: 'https://…', autocapitalize: 'off' });
    const s = sheet('Link importieren', h('div', null, h('label', { class: 'fld' }, 'Adresse der GPX-Datei', u), h('div', { class: 'row end' }, h('button', { class: 'btn pri', onclick: () => { s.close(); run('Link', async () => Import.fromUrl(u.value.trim())); } }, 'Laden'))));
  }
};

Views['/settings'] = async root => {
  const body = h('div', { class: 'pad' });
  root.append(topbar('Einstellungen', { back: true, noMenu: true }), body);
  const sel = (label, key, opts) => h('label', { class: 'fld' }, label, h('select', { onchange: async e => { await Set_.set(key, e.target.value); } }, opts.map(([v, l]) => h('option', { value: v, selected: String(Set_.get(key)) === String(v) }, l))));
  const homeBox = () => {      // Heimatort suchen und übernehmen (Kartenmitte der Planung, Wetter, Vorschläge)
    const q = h('input', { type: 'text', placeholder: 'Ort oder Adresse suchen …', value: Set_.get('homeName') || '', autocapitalize: 'off' }),
      res = h('div'), st = h('p', { class: 'muted small' });
    const show = () => { st.textContent = Set_.get('homeLat') ? `📍 ${Set_.get('homeName') || ''} (${(+Set_.get('homeLat')).toFixed(3)}, ${(+Set_.get('homeLon')).toFixed(3)})` : 'Noch kein Heimatort eingetragen.'; };
    const search = async () => {
      const t = q.value.trim(); if (t.length < 2) return;
      res.textContent = 'Suche …';
      try {
        const r = await Native.http({ url: 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&accept-language=de&q=' + encodeURIComponent(t), headers: { 'User-Agent': 'MeinTourentagebuch/1.0' } });
        if (r.status !== 200) throw new Error('Ortssuche: HTTP ' + r.status);
        const l = JSON.parse(r.body); res.innerHTML = '';
        if (!l.length) { res.textContent = 'Nichts gefunden.'; return; }
        l.forEach(e => res.append(h('div', null, h('button', { class: 'btn sm', style: { margin: '2px 0', textAlign: 'left' }, onclick: async () => {
          const name = e.display_name.split(',').slice(0, 2).join(',').trim();
          await Set_.set('homeName', name); await Set_.set('homeLat', (+e.lat).toFixed(5)); await Set_.set('homeLon', (+e.lon).toFixed(5));
          q.value = name; res.innerHTML = ''; show(); toast('Heimatort gespeichert');
        } }, '📍 ' + e.display_name))));
      } catch (er) { res.textContent = String(er.message || er); }
    };
    q.addEventListener('keydown', e => { if (e.key === 'Enter') search(); });
    show();
    return h('div', null, h('div', { class: 'row' }, q, h('button', { class: 'btn sm', onclick: search }, 'Suchen'),
      h('button', { class: 'btn sm', 'aria-label': 'Heimatort entfernen', onclick: async () => { for (const k of ['homeName', 'homeLat', 'homeLon']) await Set_.set(k, ''); q.value = ''; res.innerHTML = ''; show(); } }, '✕')), res, st);
  };
  const inp = (label, key, ph, type) => h('label', { class: 'fld' }, label, h('input', { type: type || 'text', value: Set_.get(key) || '', placeholder: ph || '', autocapitalize: 'off', onchange: async e => { await Set_.set(key, e.target.value.trim()); } }));
  const cnt = h('small', { class: 'muted' }, '');
  MapKit.cacheCount().then(n => cnt.textContent = n + ' Kacheln gespeichert');
  const nT = await DB.count('tours'), nP = await DB.count('photos');
  body.append(
    h('h3', null, 'Karte'), sel('Kartenquelle', 'tiles', Object.entries(MapKit.providers).map(([k, v]) => [k, v.name])),
    inp('Eigene Kachel-Adresse', 'tileUrl', 'https://…/{z}/{x}/{y}.png?key={key}'), inp('Schlüssel (für {key})', 'tileKey', ''),
    h('div', { class: 'row' }, cnt, h('span', { class: 'sp' }), h('button', { class: 'btn sm', onclick: async () => { await MapKit.clearCache(); cnt.textContent = '0 Kacheln gespeichert'; } }, 'Offline-Karten löschen')),
    h('p', { class: 'muted small' }, 'Hinweis: Die öffentlichen OpenStreetMap-Kartenserver sind nur für leichte, private Nutzung gedacht. Für intensiven Einsatz bitte einen eigenen Anbieter eintragen.'),
    h('h3', null, 'Routing'), inp('Routing-Server (BRouter)', 'routeUrl', 'https://brouter.de/brouter'), inp('Profil überschreiben (optional)', 'routeProfile', 'z. B. trekking'),
    h('h3', null, 'Fotos'), sel('Zeitfenster um die Tour', 'photoMargin', [[0, 'genau'], [10, '10 Minuten'], [20, '20 Minuten'], [45, '45 Minuten'], [90, '90 Minuten']]),
    h('button', { class: 'btn', onclick: async () => toast((await Photos.assignAll(true)) + ' Foto(s) neu zugeordnet') }, 'Alle Fotos neu zuordnen'),
    h('h3', null, 'Heimatort'), homeBox(),
    h('h3', null, 'Puls'), inp('Maximalpuls (bpm)', 'hrMax', 'z. B. 185', 'number'),
    h('p', { class: 'muted small' }, 'Danach richten sich die fünf Pulszonen. Ohne Angabe wird mit 190 bpm gerechnet. Die Pulswerte selbst kommen aus den importierten Dateien (GPX, TCX, FIT) oder von Zepp.'),
    h('h3', null, 'Datensicherung'), h('p', { class: 'muted' }, `${nT} Touren · ${nP} Fotos. Alle Daten liegen nur auf diesem Handy. Mach regelmäßig eine Sicherung und speichere sie außerhalb des Handys.`),
    h('div', { class: 'row wrap' }, h('button', { class: 'btn pri', onclick: backup }, '💾 Sicherung speichern'), h('button', { class: 'btn', onclick: restore }, '↩ Sicherung einspielen')),
    h('h3', null, 'Über'), h('p', { class: 'muted small' }, 'Mein Tourentagebuch ' + (window.MTApp ? MTApp.version() : '(Browser)') + ' · Kartendaten © OpenStreetMap-Mitwirkende · Leaflet (BSD-2), fflate (MIT), OkHttp (Apache-2.0), smbj (Apache-2.0)'),
    h('div', { class: 'row wrap' }, window.MTApp ? h('button', { class: 'btn sm', onclick: () => { const s = sheet('Protokoll', h('pre', { class: 'log' }, MTApp.logText() || '(leer)')); void s; } }, 'Protokoll') : null,
      h('button', { class: 'btn sm danger', onclick: wipe }, 'Alle Daten löschen')));

  async function backup() {
    const data = { app: 'tourentagebuch', v: 1, date: Date.now(), tours: await DB.all('tours'), tracks: await DB.all('tracks'), photos: await DB.all('photos'),
      kv: (await DB.all('kv')).filter(k => !['komoot', 'strava', 'zepp', 'smb', 'webdav'].includes(k.k)) };
    const gz = fflate.gzipSync(new TextEncoder().encode(JSON.stringify(data)));
    let bin = ''; gz.forEach(b => bin += String.fromCharCode(b));
    const name = 'Tourentagebuch-Sicherung-' + new Date().toISOString().slice(0, 10) + '.mtl';
    try { toast('Gespeichert: ' + await Native.json('saveFile', { name, mime: 'application/octet-stream', b64: btoa(bin) }), 6000); }
    catch (e) { const a = h('a', { href: URL.createObjectURL(new Blob([gz])), download: name }); document.body.append(a); a.click(); a.remove(); }
  }
  async function restore() {
    try {
      const f = await Native.json('pickFiles'); if (!f.length) return;
      const buf = await Import.fetchBuf(f[0].url);
      const data = JSON.parse(new TextDecoder().decode(fflate.gunzipSync(buf)));
      if (data.app !== 'tourentagebuch') throw new Error('Das ist keine Sicherung von Mein Tourentagebuch.');
      if (!await confirmBox('Sicherung einspielen?', `${data.tours.length} Touren und ${data.photos.length} Foto-Einträge werden hinzugefügt. Vorhandene Daten bleiben erhalten. (Die Foto-Dateien selbst sind nicht Teil der Sicherung.)`, 'Einspielen')) return;
      await DB.putMany('tours', data.tours); await DB.putMany('tracks', data.tracks); await DB.putMany('photos', data.photos);
      Tours.invalidate(); toast('Sicherung eingespielt ✓'); Nav.render();
    } catch (e) { toast(e.message, 7000); }
  }
  async function wipe() {
    if (!await confirmBox('Alle Daten löschen?', 'Touren, Spuren und Foto-Einträge werden unwiderruflich von diesem Handy gelöscht.', 'Alles löschen')) return;
    for (const s of ['tours', 'tracks', 'photos']) await DB.clear(s);
    Tours.invalidate(); toast('Gelöscht'); Nav.render();
  }
};
