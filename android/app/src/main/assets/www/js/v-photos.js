'use strict';
/* Fotos: Raster, Vollbild-Ansicht mit Diashow, Quellen (Galerie, Ordner, SMB, WebDAV/Nextcloud, Kamera). */
const Lightbox = {
  open(list, idx) {
    if (window.__lightbox) window.__lightbox.close();
    let i = idx, timer = null;
    const img = h('img', { alt: '', class: 'lb-img' });
    const vid = h('video', { class: 'lb-img', controls: true, playsinline: true, preload: 'metadata' });
    vid.hidden = true;
    const info = h('div', { class: 'lb-info' });
    const cnt = h('span', { class: 'lb-cnt' });
    const el = h('div', { class: 'lb', role: 'dialog', 'aria-label': 'Foto' },
      h('div', { class: 'lb-top' }, cnt, h('span', { class: 'sp' }),
        h('button', { class: 'ico', 'aria-label': 'Diashow', onclick: toggle }, h('span', { id: 'lbp' }, '▶')),
        h('button', { class: 'ico', 'aria-label': 'Details', onclick: details }, 'ⓘ'),
        h('button', { class: 'ico', 'aria-label': 'Schließen', onclick: close }, '✕')),
      img, vid, h('button', { class: 'lb-nav l', 'aria-label': 'Vorheriges', onclick: () => step(-1) }, '‹'), h('button', { class: 'lb-nav r', 'aria-label': 'Nächstes', onclick: () => step(1) }, '›'), info);
    let x0 = null;
    el.addEventListener('touchstart', e => { x0 = e.touches[0].clientX; }, { passive: true });
    el.addEventListener('touchend', e => { if (x0 == null) return; const d = e.changedTouches[0].clientX - x0; x0 = null; if (Math.abs(d) > 50) step(d < 0 ? 1 : -1); });
    function show() {
      const p = list[i];
      if (p.video) { img.hidden = true; img.removeAttribute('src'); vid.hidden = false; vid.src = Photos.url(p.id); vid.poster = Photos.thumb(p.id); }
      else { vid.pause(); vid.hidden = true; vid.removeAttribute('src'); img.hidden = false; img.src = Photos.url(p.id); }
      cnt.textContent = (i + 1) + ' / ' + list.length;
      info.textContent = (p.ts ? F.date(p.ts) + ' · ' + F.time(p.ts) : '') + (p.tourName ? ' · ' + p.tourName : '');
      [list[(i + 1) % list.length], list[(i + list.length - 1) % list.length]].filter(q => !q.video).forEach(q => { const pre = new Image(); pre.src = Photos.url(q.id); });
    }
    function step(d) { i = (i + d + list.length) % list.length; show(); }
    function toggle() { if (timer) { clearInterval(timer); timer = null; $('#lbp').textContent = '▶'; } else { timer = setInterval(() => { if (!(list[i].video && !vid.paused && !vid.ended)) step(1); }, 4000); $('#lbp').textContent = '❚❚'; } }
    function close() { if (timer) clearInterval(timer); try { vid.pause(); } catch (e) { /* egal */ } el.remove(); window.__lightbox = null; }
    async function details() {
      const p = list[i], tour = p.tour ? await DB.get('tours', p.tour) : null;
      const s = sheet('Foto', h('div', null,
        h('p', null, h('b', null, p.name || 'Foto'), h('br'), p.ts ? F.date(p.ts) + ' · ' + F.time(p.ts) : 'Aufnahmezeit unbekannt'),
        h('p', null, p.lat != null ? `📍 ${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}` + (p.pos === 'track' ? ' (aus der Tour berechnet)' : '') : '📍 Keine Position'),
        tour ? h('p', null, '🥾 ', h('a', { href: '#/tour/' + tour.id, onclick: () => { s.close(); close(); } }, tour.name)) : h('p', null, 'Keiner Tour zugeordnet'),
        h('div', { class: 'row' },
          h('button', { class: 'btn sm', onclick: async () => { s.close(); const t = await pickTour(); if (t !== undefined) { p.tour = t ? t.id : ''; await DB.put('photos', p); toast('Zugeordnet'); } } }, 'Tour wählen'),
          p.lat != null ? h('button', { class: 'btn sm', onclick: () => { s.close(); close(); sessionStorage.setItem('mapFocus', JSON.stringify([p.lat, p.lon])); Nav.go('/map'); } }, 'Auf Karte') : null,
          h('button', { class: 'btn sm danger', onclick: async () => { if (await confirmBox('Foto löschen?', 'Das Foto wird aus dem Tourentagebuch entfernt (das Original bleibt unberührt).', 'Löschen')) { await Photos.remove(p.id); list.splice(i, 1); s.close(); if (!list.length) close(); else { i = Math.min(i, list.length - 1); show(); } window.dispatchEvent(new Event('photos-changed')); } } }, 'Löschen'))));
    }
    document.body.append(el); window.__lightbox = { close }; show();
  },
};
async function pickTour() {
  const ts = (await Tours.list()).filter(t => t.status !== 'planned');
  return new Promise(res => {
    let done = false;
    const s = sheet('Tour wählen', h('div', { class: 'list' }, h('button', { class: 'li', onclick: () => { done = true; s.close(); res(null); } }, h('span', { class: 'li-t' }, h('b', null, 'Keine Tour'))),
      ts.slice(0, 120).map(t => h('button', { class: 'li', onclick: () => { done = true; s.close(); res(t); } }, h('span', { class: 'li-i' }, Sports.icon(t.sport)), h('span', { class: 'li-t' }, h('b', null, t.name), h('small', null, F.date(t.start)))))), { onclose: () => { if (!done) res(undefined); } });
  });
}

const PhotoSources = {
  /** Fortschrittsdialog. Läuft als Vordergrunddienst weiter, wenn die App in den Hintergrund geht. */
  async progress(title, fn) {
    const bar = h('div', { class: 'prog' }, h('i')), txt = h('p', null, 'Bitte warten …');
    const s = sheet(title, h('div', null, txt, bar, h('p', { class: 'muted small' }, 'Du kannst die App währenddessen verlassen – der Vorgang läuft im Hintergrund weiter (siehe Benachrichtigung).')));
    let last = 0, lastText = '';
    appSync('bgStart', title, 'Wird gestartet …', 0, 0);
    const upd = (i, n, t) => {
      bar.firstChild.style.width = (i / n * 100) + '%'; lastText = `${i} von ${n}` + (t ? ' · ' + t : ''); txt.textContent = lastText;
      if (Date.now() - last > 1500) { last = Date.now(); appSync('bgStart', title, lastText, i, n); }
    };
    let ok = false;
    try { const r = await fn(upd, txt); ok = true; return r; }
    finally { appSync('bgStop', ok ? title + ' abgeschlossen' : ''); setTimeout(() => s.close(), 300); }
  },
  async needPerm() {
    const r = await Native.json('perm');
    if (!r.granted) throw new Error('Ohne Zugriff auf Fotos kann die Galerie nicht gelesen werden. Bitte in den Android-Einstellungen erlauben.');
  },
  /** Fotos aus der Galerie, die zeitlich zu den Touren passen. */
  async galleryForTours(tours) {
    await PhotoSources.needPerm();
    const margin = (+Set_.get('photoMargin') || 20) * 60000;
    let n = 0;
    await PhotoSources.progress('Galerie durchsuchen', async (upd) => {
      for (let k = 0; k < tours.length; k++) {
        const t = tours[k]; upd(k + 1, tours.length, t.name);
        if (!t.timed || !t.end) continue;
        const have = new Set((await DB.byIndex('photos', 'tour', t.id)).map(p => p.id));
        const found = await Native.json('galleryRange', { from: t.start - margin, to: t.end + margin });
        if (!found.length) continue;
        for (let i = 0; i < found.length; i += 8) {
          const metas = await Native.json('importUris', { uris: found.slice(i, i + 8).map(f => f.uri), src: 'galerie' });
          n += await Photos.addMeta(metas.filter(m => !have.has(m.id)));
        }
      }
    });
    return n;
  },
  sheet(tour, done) {
    const run = async fn => { s.close(); try { const n = await fn(); if (n != null) toast(n + ' Foto(s) hinzugefügt', 4000); window.dispatchEvent(new Event('photos-changed')); if (done) await done(); } catch (e) { toast(e.message, 6000); } };
    const it = (ico, t, sub, fn) => h('button', { class: 'li', onclick: () => run(fn) }, h('span', { class: 'li-i' }, ico), h('span', { class: 'li-t' }, h('b', null, t), h('small', null, sub)));
    const s = sheet('Fotos hinzufügen', h('div', { class: 'list' },
      it('🖼️', 'Aus der Galerie wählen', 'Einzelne Fotos auswählen', async () => { const m = await Native.json('pickPhotos'); return Photos.addMeta(m); }),
      tour ? it('✨', 'Passende Fotos automatisch finden', 'Galerie nach Aufnahmezeit dieser Tour durchsuchen', () => PhotoSources.galleryForTours([tour])) : it('✨', 'Passende Fotos zu allen Touren finden', 'Galerie nach Aufnahmezeit durchsuchen', async () => PhotoSources.galleryForTours((await Tours.list()).filter(t => t.status !== 'planned' && t.timed))),
      it('📁', 'Ordner auf dem Handy', 'z. B. Kamera-Ordner, Syncthing, Cloud-Ordner', () => PhotoSources.folder()),
      it('💻', 'Vom Rechner im WLAN', 'Mac oder PC: Adresse im Browser öffnen, Fotos hineinziehen', () => { PhotoSources.receive(done); return null; }),
      it('🖧', 'Netzwerkfreigabe (SMB)', 'NAS, Fritz!Box, Windows-Freigabe', () => { PhotoSources.smb(); return null; }),
      it('☁️', 'Nextcloud / WebDAV', 'Fotos von deinem Server', () => { PhotoSources.webdav(); return null; })));
  },
  async folder() {
    const f = await Native.json('pickFolder');
    if (!f.tree) return null;
    const list = await DB.kvGet('photoFolders', []);
    if (!list.find(x => x.tree === f.tree)) list.push({ tree: f.tree, name: f.name, since: 0 });
    await DB.kvSet('photoFolders', list);
    return PhotoSources.scanFolders();
  },
  async scanFolders() {
    await PhotoSources.needPerm().catch(() => {});
    const list = await DB.kvGet('photoFolders', []); let n = 0;
    await PhotoSources.progress('Ordner einlesen', async (upd) => {
      for (const f of list) {
        const items = (await Native.json('folderScan', { tree: f.tree, since: f.since || 0 })).filter(i => i.kind === 'photo');
        for (let i = 0; i < items.length; i += 6) {
          upd(Math.min(i + 6, items.length), items.length, f.name);
          const metas = await Native.json('importUris', { uris: items.slice(i, i + 6).map(x => x.uri), src: 'ordner' });
          n += await Photos.addMeta(metas);
        }
        f.since = Date.now();
      }
    });
    await DB.kvSet('photoFolders', list);
    return n;
  },
  /* ---- Vom Rechner empfangen: das Handy zeigt eine Adresse, der Rechner schickt Fotos über eine Webseite ---- */
  async receive(done) {
    let timer = null, total = 0, closed = false;
    const cnt = h('p', { class: 'recvcnt' }, ''), box = h('div', null, h('p', { class: 'muted' }, 'Starte …'));
    const s = sheet('Vom Rechner empfangen', box, { onclose: async () => {
      closed = true; clearInterval(timer); try { await Native.json('uploadStop'); } catch (e) { /* egal */ }
      if (total) { toast(total + ' Foto(s) hinzugefügt', 4000); window.dispatchEvent(new Event('photos-changed')); }
      if (done) { try { await done(); } catch (e) { /* egal */ } }
    } });
    let info;
    try { info = await Native.json('uploadStart'); } catch (e) { box.textContent = 'Der Empfang konnte nicht gestartet werden: ' + (e.message || e); return; }
    if (!info || !info.url) { box.innerHTML = ''; box.append(h('p', null, 'Kein WLAN gefunden. Verbinde das Handy mit dem gleichen Netzwerk wie den Rechner und versuche es noch einmal.')); return; }
    box.innerHTML = '';
    box.append(h('p', null, 'Öffne diese Adresse im Browser deines Macs oder PCs (im selben WLAN) und ziehe Fotos auf die Seite:'),
      h('p', { class: 'recvurl', id: 'recvurl' }, info.url),
      h('div', { class: 'row' }, h('button', { class: 'btn sm', onclick: () => { if (navigator.clipboard) navigator.clipboard.writeText(info.url).then(() => toast('Adresse kopiert')); } }, 'Adresse kopieren')),
      cnt, h('p', { class: 'muted small' }, 'Der Empfang läuft, solange dieses Fenster offen ist. Die Übertragung ist nicht verschlüsselt – nur im eigenen WLAN nutzen. Fotos werden den Touren nach Aufnahmezeit zugeordnet.'),
      h('p', { class: 'muted small' }, 'Meldet der Browser „nicht gefunden“: Tippfehler prüfen und die Adresse am besten mit „Adresse kopieren“ übernehmen, nicht abtippen.'));
    cnt.textContent = 'Wartet auf Fotos …';
    timer = setInterval(async () => {
      if (closed) return;
      try {
        const r = await Native.json('uploadPoll');
        if (r.photos && r.photos.length) { total += await Photos.addMeta(r.photos); window.dispatchEvent(new Event('photos-changed')); }
        cnt.textContent = total ? total + ' Foto(s) empfangen' + (r.failed ? ' · ' + r.failed + ' nicht lesbar' : '') : (r.failed ? r.failed + ' Datei(en) nicht lesbar' : 'Wartet auf Fotos …');
      } catch (e) { /* nächster Versuch */ }
    }, 1500);
  },
  /* ---- SMB ---- */
  smb() {
    DB.kvGet('smb', {}).then(c => {
      const f = {};
      const fld = (k, l, ph, type) => h('label', { class: 'fld' }, l, f[k] = h('input', { type: type || 'text', value: c[k] || '', placeholder: ph || '', autocapitalize: 'off', autocomplete: 'off' }));
      const s = sheet('Netzwerkfreigabe (SMB)', h('div', null,
        h('p', { class: 'muted' }, 'Verbindet sich direkt mit deinem NAS oder PC im WLAN. Die Zugangsdaten bleiben nur auf diesem Handy.'),
        fld('host', 'Server', 'z. B. 192.168.178.20 oder nas.local'), fld('share', 'Freigabe', 'z. B. Fotos'), fld('path', 'Ordner (optional)', 'z. B. Urlaub/2026'),
        fld('user', 'Benutzer', 'leer = Gast'), fld('pass', 'Passwort', '', 'password'), fld('domain', 'Domäne (optional)', ''),
        h('div', { class: 'row end' }, h('button', { class: 'btn pri', onclick: async () => {
          const a = {}; for (const k in f) a[k] = f[k].value.trim();
          await DB.kvSet('smb', a); s.close(); PhotoSources.browse({ kind: 'smb', a, path: a.path || '' });
        } }, 'Verbinden'))));
    });
  },
  /* ---- WebDAV (Nextcloud, ownCloud, Synology …) ---- */
  webdav() {
    DB.kvGet('webdav', {}).then(c => {
      const f = {};
      const fld = (k, l, ph, type) => h('label', { class: 'fld' }, l, f[k] = h('input', { type: type || 'text', value: c[k] || '', placeholder: ph || '', autocapitalize: 'off', autocomplete: 'off' }));
      const s = sheet('Nextcloud / WebDAV', h('div', null,
        h('p', { class: 'muted' }, 'Bei Nextcloud: https://dein-server/remote.php/dav/files/BENUTZER/ – am besten mit einem App-Passwort (Einstellungen → Sicherheit).'),
        fld('url', 'WebDAV-Adresse', 'https://…'), fld('user', 'Benutzer'), fld('pass', 'Passwort / App-Passwort', '', 'password'),
        h('div', { class: 'row end' }, h('button', { class: 'btn pri', onclick: async () => {
          const a = {}; for (const k in f) a[k] = f[k].value.trim(); if (!a.url.endsWith('/')) a.url += '/';
          await DB.kvSet('webdav', a); s.close(); PhotoSources.browse({ kind: 'dav', a, path: '' });
        } }, 'Verbinden'))));
    });
  },
  davAuth: a => ({ Authorization: 'Basic ' + btoa(unescape(encodeURIComponent(a.user + ':' + a.pass))) }),
  async davList(a, path) {
    const r = await Native.http({ method: 'PROPFIND', url: a.url + path, headers: Object.assign({ Depth: '1', 'Content-Type': 'application/xml' }, PhotoSources.davAuth(a)),
      body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:getlastmodified/><d:getcontentlength/><d:resourcetype/></d:prop></d:propfind>' });
    if (r.status === 401) throw new Error('Anmeldung abgelehnt (Benutzer/Passwort?)');
    if (r.status >= 400) throw new Error('Server antwortet mit HTTP ' + r.status);
    const doc = new DOMParser().parseFromString(r.body, 'application/xml');
    const base = new URL(a.url).pathname;
    const out = [];
    Array.from(doc.getElementsByTagNameNS('DAV:', 'response')).forEach(rs => {
      const href = decodeURIComponent((rs.getElementsByTagNameNS('DAV:', 'href')[0] || {}).textContent || '');
      const isDir = rs.getElementsByTagNameNS('DAV:', 'collection').length > 0;
      let rel = href.startsWith(base) ? href.slice(base.length) : href; rel = rel.replace(/^\/+/, '');
      if (!rel || rel.replace(/\/$/, '') === path.replace(/\/$/, '')) return;
      const lm = (rs.getElementsByTagNameNS('DAV:', 'getlastmodified')[0] || {}).textContent;
      const sz = +((rs.getElementsByTagNameNS('DAV:', 'getcontentlength')[0] || {}).textContent || 0);
      out.push({ name: rel.replace(/\/$/, '').split('/').pop(), path: rel, dir: isDir, size: sz, mtime: lm ? Date.parse(lm) : 0 });
    });
    return out;
  },
  /** Ordner-Browser für SMB und WebDAV. */
  browse(st) {
    const list = h('div', { class: 'list' }), sel = new Set();
    const head = h('div', { class: 'crumb' });
    const btn = h('button', { class: 'btn pri', onclick: importSel }, 'Importieren');
    const s = sheet(st.kind === 'smb' ? 'Netzwerkfreigabe' : 'Nextcloud / WebDAV', h('div', null, head, list, h('div', { class: 'row end sticky' }, h('button', { class: 'btn', onclick: allHere }, 'Alle Bilder hier'), btn)));
    let items = [];
    async function load(path) {
      st.path = path; sel.clear(); list.innerHTML = ''; list.append(h('p', { class: 'muted pad' }, 'Lade …'));
      try { items = st.kind === 'smb' ? await Native.json('smbList', Object.assign({}, st.a, { path })) : await PhotoSources.davList(st.a, path); }
      catch (e) { list.innerHTML = ''; list.append(h('p', { class: 'err pad' }, 'Verbindung fehlgeschlagen: ' + e.message)); return; }
      items.sort((x, y) => (y.dir - x.dir) || x.name.localeCompare(y.name, 'de'));
      draw();
    }
    function draw() {
      head.textContent = '/' + (st.path || ''); list.innerHTML = '';
      if (st.path) list.append(h('button', { class: 'li', onclick: () => load(st.path.replace(/\/?[^/]+\/?$/, '')) }, h('span', { class: 'li-i' }, '⬆️'), h('span', { class: 'li-t' }, h('b', null, 'Eine Ebene höher'))));
      items.forEach(it => {
        if (it.dir) list.append(h('button', { class: 'li', onclick: () => load(it.path) }, h('span', { class: 'li-i' }, '📁'), h('span', { class: 'li-t' }, h('b', null, it.name))));
        else if (/\.(jpe?g|png|heic|webp)$/i.test(it.name)) {
          const cb = h('input', { type: 'checkbox', onchange: e => { e.target.checked ? sel.add(it) : sel.delete(it); btn.textContent = sel.size ? sel.size + ' importieren' : 'Importieren'; } });
          list.append(h('label', { class: 'li' }, cb, h('span', { class: 'li-t' }, h('b', null, it.name), h('small', null, F.size(it.size) + (it.mtime ? ' · ' + F.dshort(it.mtime) : '')))));
        }
      });
      if (!items.length) list.append(h('p', { class: 'muted pad' }, 'Dieser Ordner ist leer.'));
    }
    function allHere() { $$('input[type=checkbox]', list).forEach(c => { if (!c.checked) c.click(); }); }
    async function importSel() {
      const files = Array.from(sel); if (!files.length) { toast('Bitte Fotos ankreuzen'); return; }
      s.close(); let n = 0;
      try {
        await PhotoSources.progress('Fotos laden', async (upd) => {
          for (let i = 0; i < files.length; i += (st.kind === 'smb' ? 4 : 1)) {
            const part = files.slice(i, i + (st.kind === 'smb' ? 4 : 1));
            upd(Math.min(i + part.length, files.length), files.length, part[0].name);
            let metas;
            if (st.kind === 'smb') metas = await Native.json('smbImport', Object.assign({}, st.a, { files: part.map(p => ({ path: p.path, mtime: p.mtime })) }));
            else {
              const d = await Native.json('download', { url: st.a.url + part[0].path.split('/').map(encodeURIComponent).join('/'), headers: PhotoSources.davAuth(st.a), name: part[0].name });
              metas = await Native.json('importFiles', { paths: [d.path], src: 'webdav' });
            }
            n += await Photos.addMeta(metas);
          }
        });
        toast(n + ' Foto(s) hinzugefügt', 4000); window.dispatchEvent(new Event('photos-changed'));
      } catch (e) { toast(e.message, 6000); }
    }
    load(st.path || '');
  },
};

Views['/photos'] = async root => {
  let mode = 'all';
  const body = h('div', { class: 'photos' });
  const seg = h('div', { class: 'seg' });
  root.append(topbar('Fotos', { actions: [h('button', { class: 'ico', id: 'pshow', 'aria-label': 'Diashow aller Fotos', onclick: async () => { const all = await Photos.all(), tours = Object.fromEntries((await Tours.list()).map(t => [t.id, t])); Show.open(all.map(p => Object.assign({ tourName: p.tour && tours[p.tour] ? tours[p.tour].name : '' }, p)), { shuffle: true }); } }, '▶'), h('button', { class: 'ico', 'aria-label': 'Fotos hinzufügen', onclick: () => PhotoSources.sheet(null, null) }, '＋')] }), seg, body);
  let map = null;
  const draw = async () => {
    const all = await Photos.all(); const tours = Object.fromEntries((await Tours.list()).map(t => [t.id, t]));
    all.forEach(p => { p.tourName = p.tour && tours[p.tour] ? tours[p.tour].name : ''; });
    seg.innerHTML = '';
    [['all', `Alle (${all.length})`], ['free', `Ohne Tour (${all.filter(p => !p.tour).length})`], ['map', 'Karte']].forEach(([k, l]) => seg.append(h('button', { class: mode === k ? 'on' : '', onclick: () => { mode = k; draw(); } }, l)));
    if (map) { map.remove(); map = null; }
    body.innerHTML = '';
    const list = (mode === 'free' ? all.filter(p => !p.tour) : all).slice().reverse();
    if (!all.length) { body.append(h('div', { class: 'empty hero' }, h('div', { class: 'big' }, '🖼️'), h('h2', null, 'Noch keine Fotos'), h('p', null, 'Hol Fotos aus der Galerie, von einem Ordner, deinem NAS oder Nextcloud. Sie werden über die Aufnahmezeit automatisch der passenden Tour zugeordnet und auf der Karte angezeigt.'), h('button', { class: 'btn pri', onclick: () => PhotoSources.sheet(null, null) }, 'Fotos hinzufügen'))); return; }
    if (mode === 'map') {
      const el = h('div', { class: 'map full' }); body.append(el);
      map = MapKit.create(el);
      const g = L.layerGroup().addTo(map), withPos = all.filter(p => p.lat != null);
      withPos.forEach(p => MapKit.photoMarker(p, () => Lightbox.open(all, all.indexOf(p))).addTo(g));
      if (withPos.length) map.fitBounds(L.latLngBounds(withPos.map(p => [p.lat, p.lon])), { padding: [30, 30], maxZoom: 14 });
      setTimeout(() => { try { if (map.getContainer().isConnected) map.invalidateSize(); } catch (e) { /* Ansicht schon verlassen */ } }, 150);
      return;
    }
    if (!list.length) { body.append(h('div', { class: 'empty' }, h('p', null, 'Alle Fotos sind einer Tour zugeordnet.'))); return; }
    let last = '';
    let grid = null;
    list.forEach(p => {
      const day = p.ts ? F.date(p.ts) : 'Ohne Datum';
      if (day !== last) { last = day; body.append(h('h3', { class: 'month' }, day)); grid = h('div', { class: 'pgrid' }); body.append(grid); }
      grid.append(h('button', { class: 'pt', 'aria-label': 'Foto öffnen', onclick: () => Lightbox.open(list, list.indexOf(p)) }, h('img', { src: Photos.thumb(p.id), alt: '', loading: 'lazy' }), p.lat != null ? null : h('i', { title: 'ohne Position' }, '∅')));
    });
  };
  const re = () => draw(); window.addEventListener('photos-changed', re);
  await draw();
  return () => { window.removeEventListener('photos-changed', re); if (map) map.remove(); };
};

Views['/sources'] = async root => {
  const body = h('div', { class: 'pad' });
  root.append(topbar('Foto-Quellen', { back: true, noMenu: true }), body);
  const folders = await DB.kvGet('photoFolders', []);
  body.append(h('p', { class: 'muted' }, 'Fotos werden verkleinert (max. 2400 Pixel) in den privaten Speicher der App kopiert. Originale bleiben unverändert.'),
    h('div', { class: 'list' },
      h('button', { class: 'li', onclick: () => PhotoSources.sheet(null, null) }, h('span', { class: 'li-i' }, '＋'), h('span', { class: 'li-t' }, h('b', null, 'Fotos hinzufügen'), h('small', null, 'Galerie, Ordner, SMB, Nextcloud'))),
      h('button', { class: 'li', onclick: async () => { try { toast((await PhotoSources.scanFolders()) + ' neue Foto(s)'); } catch (e) { toast(e.message); } } }, h('span', { class: 'li-i' }, '🔄'), h('span', { class: 'li-t' }, h('b', null, 'Gemerkte Ordner jetzt einlesen'), h('small', null, folders.length ? folders.map(f => decodeURIComponent(f.name)).join(', ') : 'Noch keine Ordner gemerkt')))));
  const sto = await Native.json('storage').catch(() => null);
  if (sto) body.append(h('p', { class: 'muted' }, `Belegt: ${sto.photos} Fotos · ${F.size(sto.bytes)}`));
  if (folders.length) body.append(h('h3', null, 'Gemerkte Ordner'), h('div', { class: 'list' }, folders.map((f, i) => h('div', { class: 'li' }, h('span', { class: 'li-i' }, '📁'), h('span', { class: 'li-t' }, h('b', null, decodeURIComponent(f.name))), h('button', { class: 'ico', 'aria-label': 'Entfernen', onclick: async () => { folders.splice(i, 1); await DB.kvSet('photoFolders', folders); Nav.render(); } }, '✕')))));
};
