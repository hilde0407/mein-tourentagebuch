'use strict';
/* Gerüst: Router, untere Leiste, Kopfzeile, Seite „Mehr“, Startablauf. Ansichten registrieren sich in Views[...]. */
const Views = {};
const Nav = {
  cleanup: null, cur: '',
  /* Fünf Reiter; „Aufnehmen“ sitzt in der Mitte. Was nicht hier steht, liegt unter „Mehr“ oder ist von Start/Touren aus erreichbar. */
  tabs: [['/start', 'Start', 'home'], ['/', 'Touren', 'tours'], ['/rec', 'Aufnehmen', 'rec'], ['/photos', 'Fotos', 'photo'], ['/mehr', 'Mehr', 'more']],
  /* Welcher Reiter ist auf welcher Seite markiert */
  home: { '/tour': '/', '/map': '/', '/story': '/', '/fix': '/', '/flug': '/',
    '/reisen': '/mehr', '/reise': '/mehr', '/album': '/mehr', '/stats': '/mehr', '/jahr': '/mehr', '/import': '/mehr', '/doppelt': '/mehr', '/settings': '/mehr', '/sources': '/mehr', '/plan': '/mehr', '/fuehrer': '/mehr', '/offline': '/mehr' },
  /* Seiten, auf denen man an einer Sache arbeitet: ohne untere Leiste, mit „Zurück“ */
  deep: ['/tour', '/story', '/settings', '/import', '/doppelt', '/sources', '/reise', '/album', '/fix', '/flug', '/plan', '/offline'],
  go(path) { if (location.hash === '#' + path) Nav.render(); else location.hash = '#' + path; },
  back() { if (history.length > 1 && Nav.depth > 0) { history.back(); } else Nav.go(Nav.home[Nav.cur] || '/start'); },
  depth: 0,
  /** Rendert nie zweimal gleichzeitig: Ein laufender Aufbau wird zu Ende geführt, danach wird höchstens einmal neu gezeichnet. */
  async render() {
    if (Nav._busy) { Nav._again = true; return; }
    Nav._busy = true;
    try {
      do { Nav._again = false; await Nav._render1(); } while (Nav._again);
    } finally { Nav._busy = false; }
  },
  async _render1() {
    const raw = location.hash.slice(1) || '/start';
    const parts = raw.split('/').filter(Boolean);
    let key = '/' + (parts[0] || '');
    if (!Views[key]) key = '/';      // unbekannte Adresse: Tourenliste
    const route = Views[key];
    if (Nav.cleanup) { try { Nav.cleanup(); } catch (e) { /* weiter */ } Nav.cleanup = null; }
    const root = $('#view');
    /* Rollposition je Adresse merken: Wer aus der Tourenliste eine Tour öffnet und zurückgeht, steht wieder an derselben Stelle (2.0.3).
       „Zurück“ erkennt man daran, dass die neue Adresse die vorletzte im eigenen Verlauf ist. */
    if (Nav.raw) Nav.pos[Nav.raw] = root.scrollTop;
    const st = Nav.stack, isBack = st.length > 1 && st[st.length - 2] === raw;
    if (isBack) st.pop(); else if (st[st.length - 1] !== raw) { st.push(raw); if (st.length > 60) st.shift(); }
    Nav.raw = raw;
    root.innerHTML = ''; root.scrollTop = 0;
    Nav.cur = key;
    const tab = Nav.home[key] || key, deep = Nav.deep.includes(key);
    $$('#tabs a').forEach(a => { const on = a.dataset.p === tab; a.classList.toggle('on', on); if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    $('#tabs').classList.toggle('hide', deep); root.classList.toggle('notabs', deep);
    Nav.syncRec();
    try { Nav.cleanup = await route(root, parts.slice(1).map(decodeURIComponent)); }
    catch (e) { root.append(UI.empty({ title: 'Das hat nicht geklappt', text: String(e.message || e) })); console.error(e); }
    if (isBack && Nav.pos[raw] && Nav.raw === raw) root.scrollTop = Nav.pos[raw];
  },
  pos: {}, stack: [], raw: '',
  /** Die Scheibe „Aufnehmen“ wird rot, solange eine Aufzeichnung läuft oder pausiert ist. */
  syncRec() {
    const a = $('#tabs a.rec'); if (!a) return;
    let live = false;
    try { const st = window.MTApp ? JSON.parse(MTApp.status()) : {}; live = st.state === 'recording' || st.state === 'paused'; } catch (e) { /* ohne Hülle */ }
    a.classList.toggle('live', live);
    a.setAttribute('aria-label', live ? 'Aufnehmen – Aufzeichnung läuft' : 'Aufnehmen');
  },
};
/** Wegweiser-Zeichen – dasselbe Motiv wie bei „Meine Touren“. */
function logoMark() { return h('span', { class: 'logo', 'aria-hidden': 'true', html: Ico.svg('peak', 26) }); }
/** Kopfzeile. opts.back = Unterseite mit „Zurück“, opts.actions = Knöpfe rechts, opts.logo = Zeichen vor dem Titel. */
function topbar(title, opts) {
  opts = opts || {};
  return h('header', { class: 'top' },
    opts.back ? h('button', { class: 'ico', 'aria-label': 'Zurück', onclick: () => Nav.back() }, '←') : (opts.logo ? logoMark() : null),
    h('h1', null, title),
    h('span', { class: 'sp' }), opts.actions || null);
}
/* „Mehr“: alles aus der zweiten Reihe an einem Ort. */
Views['/mehr'] = async root => {
  const nT = (await Tours.list()).filter(t => !t.hidden && t.status !== 'planned').length, nP = await DB.count('photos');
  root.append(topbar('Mehr'), h('div', { class: 'pad' },
    UI.section('Unterwegs', UI.list([
      UI.row({ icon: 'route', title: 'Tour planen', sub: 'Wegpunkte setzen, Route auf Wegen, Höhenprofil', href: '#/plan', id: 'm-plan' }),
      UI.row({ icon: 'map', title: 'Karte aller Touren', sub: 'Alle Strecken auf einer Karte', href: '#/map', id: 'm-map' }),
      UI.row({ icon: 'download', title: 'Offline-Karten', sub: 'Kartenausschnitt vor der Tour laden – für unterwegs ohne Netz', href: '#/offline', id: 'm-offline' }),
      UI.row({ icon: 'book', title: 'Wanderführer', sub: 'Bücher mit GPX-Dateien: welche Touren du schon gewandert bist', href: '#/fuehrer', id: 'm-fuehrer' })])),
    UI.section('Rückblick', UI.list([
      UI.row({ icon: 'bag', title: 'Reisen & Alben', sub: 'Reisen automatisch erkannt, Alben aus Schlagworten', href: '#/reisen', id: 'm-reisen' }),
      UI.row({ icon: 'chart', title: 'Statistik', sub: 'Jahre, Sportarten, Rekorde, Kalender, Ziele', href: '#/stats', id: 'm-stats' }),
      UI.row({ icon: 'calendar', title: 'Jahresrückblick', sub: 'Dein Jahr in Zahlen, Höhepunkte, Bild zum Teilen', href: '#/jahr', id: 'm-jahr' })])),
    UI.section('Daten', UI.list([
      UI.row({ icon: 'download', title: 'Touren importieren', sub: 'Dateien, Meine Touren, Komoot, Strava, Zepp, Garmin', href: '#/import', id: 'm-import' }),
      UI.row({ icon: 'photo', title: 'Foto-Quellen', sub: 'Galerie, Ordner, Netzwerkfreigabe, Nextcloud', href: '#/sources', id: 'm-sources' }),
      UI.row({ icon: 'gear', title: 'Einstellungen & Sicherung', sub: 'Karte, Routing, Heimatort, Puls, Datensicherung', href: '#/settings', id: 'm-settings' })])),
    h('p', { class: 'muted small', style: { marginTop: '20px' } }, `${nT} ${nT === 1 ? 'Tour' : 'Touren'} · ${nP} ${nP === 1 ? 'Foto' : 'Fotos'} · alles nur auf diesem Handy`)));
};
window.mtBack = function () {
  sheet.stack = (sheet.stack || []).filter(x => x.el.isConnected);      // nur Blätter, die wirklich noch offen sind
  if (sheet.stack.length) { sheet.stack[sheet.stack.length - 1].close(); return true; }
  if (window.__lightbox) { window.__lightbox.close(); return true; }
  if (window.__show) { window.__show.close(); return true; }
  if (Nav.deep.includes(Nav.cur) || ['/stats', '/jahr', '/reisen', '/map', '/fuehrer'].includes(Nav.cur)) { Nav.back(); return true; }
  if (Nav.cur !== '/start' && Nav.cur !== '') { Nav.go('/start'); return true; }
  return false;
};

async function boot() {
  try {
    await DB.open(); await Set_.load();
  } catch (e) {
    document.body.innerHTML = '<div class="empty"><h2>Die Daten lassen sich nicht öffnen</h2><p>' + esc(e.message) + '</p><p>Bitte die App schließen und neu starten.</p></div>'; return;
  }
  const tabs = $('#tabs');
  Nav.tabs.forEach(([p, t, i]) => tabs.append(h('a', { href: '#' + p, 'data-p': p, class: p === '/rec' ? 'rec' : '', onclick: () => { if (location.hash === '#' + p) $('#view').scrollTop = 0; } },      // Tippen auf den schon offenen Reiter: zurück nach oben
     h('span', { class: 'ti', html: Ico.svg(i, 23) }), h('span', null, t))));
  if (!location.hash) history.replaceState(null, '', '#/start');      // ohne hashchange-Ereignis, sonst wird die Startseite doppelt aufgebaut
  window.addEventListener('hashchange', () => { Nav.depth++; Nav.render(); });
  window.addEventListener('mtshared', handleShared);
  window.addEventListener('mtphoto', handlePhotoQueue);
  window.addEventListener('mtvideo', () => Videos.poll());      // 2.7.1: Video-Umwandlung im Hintergrund meldet sich
  window.addEventListener('mtresume', () => Pano.check());      // 2.8.0: zurück aus der Kamera-App – Panorama übernehmen?
  window.addEventListener('mtresume', () => { const e = $('#set-akku-stand'), r = $('#rec-akku small'); if (e) e.textContent = RecRescue.akkuZeile(); if (r) r.textContent = RecRescue.akkuZeile(); });      // 2.12.0: zurück aus den Akku-Einstellungen
  await Nav.render();
  setTimeout(() => { Tours.migP = Tours.migrate().then(r => { if (r && (r.up || r.sport || r.pos || r.ski) && ['/', '/start', ''].includes(Nav.cur)) Nav.render(); }).catch(e => console.error('Neuberechnung', e)); }, 1500);
  setTimeout(autoAbgleich, 6000);
  setTimeout(() => Backup.auto().then(r => { if (r && Nav.cur === '/start' && $('#backupnote')) Nav.render(); }), 12000);      // 2.10.0: automatische Tagessicherung in den Ordner (nur wenn eingeschaltet)
  setTimeout(() => Medien.status().then(s => { if (s && s.running) Medien.follow(); }), 2500);      // 2.10.0: läuft noch eine Medien-Sicherung (Oberfläche neu geladen)? Fortschritt zeigen
  setTimeout(() => Senden.nachholen().catch(e => console.error('Senden', e)), 9000);      // 2.5.0: vorgemerkte Aufzeichnungen noch einmal versuchen (nur wenn eingeschaltet)      // 2.2.0: still im Hintergrund, nach dem Start und nach der Neuberechnung; nur wenn eingeschaltet
  setTimeout(() => { handleShared(); handlePhotoQueue(); checkUnsaved(); Videos.poll(); Videos.prefs(); Pano.check(); }, 600);      // Videos.prefs: 2.9.0 Einstellungen für Aufnahme und Galerie an die Hülle      // Pano.check: auch nach Prozessende während der Kamera      // Videos.poll: Ergebnisse, die fertig wurden, während die App zu war
}
/** „Beim Öffnen automatisch abgleichen“ (Vorgabe aus): bremst den Start nicht (6 s Abstand, wartet die Neuberechnung ab), stört keine Aufzeichnung, meldet nur Neues oder Fehler kurz. */
async function autoAbgleich() {
  try {
    if (!Set_.get('autoAbgleich')) return;
    if (Tours.migP) await Tours.migP.catch(() => {});
    const r = await Import.Alles.auto();
    if (!r) return;
    const last = await DB.kvGet('abgleich', null);
    const el = $('#lastsync'); if (el && last) el.textContent = Abgleich.zeile(last);
    const bad = r.items.filter(i => i.err);
    if (r.neu || bad.length) toast('Abgeglichen: ' + (r.neu ? (r.neu === 1 ? '1 neue Tour' : r.neu + ' neue Touren') : 'nichts Neues') + (bad.length ? ' · ' + bad.map(i => i.name).join(', ') + ': Fehler (Details unter „Alles abgleichen“)' : ''), 6000);
    if (r.neu && Nav.cur === '/start' && $('#view').scrollTop < 40) Nav.render();      // nicht mitten im Blättern
  } catch (e) { console.error('Automatischer Abgleich', e); }
}
async function handleShared() {
  if (!window.MTApp) return;
  try {
    const files = JSON.parse(MTApp.takeShared() || '[]');
    const txt = JSON.parse(MTApp.takeSharedText() || '[]');
    for (const t of txt) { const m = (t.text || '').match(/https?:\/\/\S+/); if (m && confirm_ok(m[0])) { toast('Link wird geladen …'); try { toast(Import.describe(await Import.fromUrl(m[0]))); } catch (e) { toast(e.message); } } }
    if (!files.length) return;
    const photos = files.filter(f => /\.(jpe?g|png|heic|webp)$/i.test(f.name)), tracks = files.filter(f => !photos.includes(f));
    if (tracks.length) {
      const was = await frageGemachtGeplant(tracks.length);      // 2.6.2: von außen geöffnete Strecken nicht blind als „gemacht“ speichern
      if (!was) { try { await Native.call('clearCache'); } catch (e) { /* egal */ } toast('Nicht übernommen'); }
      else { toast('Import läuft …'); const r = await Import.cacheFiles(tracks, null, was === 'planned' ? { status: 'planned', src: 'plan', ohneZeit: true } : null); toast(Import.describe(r), 5000); Tours.invalidate(); if (Nav.cur === '/' || Nav.cur === '/start') Nav.render(); }
    }
    if (photos.length) {
      const m = await Native.json('importFiles', { paths: photos.map(f => f.path), src: 'geteilt' });
      const n = await Photos.addMeta(m); toast(n + ' Foto(s) übernommen', 4000);
    }
  } catch (e) { toast('Teilen: ' + e.message); }
}
const confirm_ok = u => /^https?:\/\//.test(u);
async function handlePhotoQueue() {
  if (!window.MTApp) return;
  try { const q = JSON.parse(MTApp.takePhotoQueue() || '[]'); if (q.length) { await Photos.addMeta(q); await applyPinNote(q); window.dispatchEvent(new Event('photos-changed')); } } catch (e) { /* ignorieren */ }
}
/** Wurde das Foto über „Foto + Text“ aufgenommen, bekommt es den Kommentar als Notiz. */
async function applyPinNote(q) {
  try {
    const pn = JSON.parse(sessionStorage.getItem('pinNote') || 'null');
    if (!pn || Date.now() - pn.t > 10 * 60000) return;
    const m = q.find(x => !x.video) || q[0];
    const ph = m && await DB.get('photos', m.id);
    if (ph && pn.text) { ph.note = pn.text; await DB.put('photos', ph); }
    sessionStorage.removeItem('pinNote');
  } catch (e) { /* ignorieren */ }
}
async function checkUnsaved() {
  if (!window.MTApp || window.__saving) return;
  try {
    const st = JSON.parse(MTApp.status());
    if (st.state === 'finished' || (st.unsent && st.state === 'idle')) { if (Nav.cur !== '/rec') { toast('Es gibt eine noch nicht gespeicherte Aufzeichnung.', 6000); Nav.go('/rec'); } }
    else if (AufnahmeCalc.unterbrochen(st)) { if (Nav.cur !== '/rec' && Nav.cur !== '/start') toast('Eine Aufnahme wurde unterbrochen – Hinweis auf der Startseite.', 6000); }      // 2.12.0: nicht wegspringen; Startseite und Aufnahme zeigen den Hinweis
    else if (st.state === 'recording' || st.state === 'paused') { if (Nav.cur !== '/rec') Nav.go('/rec'); }
  } catch (e) { /* ignorieren */ }
}
document.addEventListener('DOMContentLoaded', boot);
