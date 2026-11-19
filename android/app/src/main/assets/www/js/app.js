'use strict';
/* Gerüst: Router, untere Leiste, Kopfzeile, Seite „Mehr“, Startablauf. Ansichten registrieren sich in Views[...]. */
const Views = {};
const Nav = {
  cleanup: null, cur: '',
  /* Fünf Reiter; „Aufnehmen“ sitzt in der Mitte. Was nicht hier steht, liegt unter „Mehr“ oder ist von Start/Touren aus erreichbar. */
  tabs: [['/start', 'Start', 'home'], ['/', 'Touren', 'tours'], ['/rec', 'Aufnehmen', 'rec'], ['/photos', 'Fotos', 'photo'], ['/mehr', 'Mehr', 'more']],
  /* Welcher Reiter ist auf welcher Seite markiert */
  home: { '/tour': '/', '/map': '/', '/story': '/', '/fix': '/', '/flug': '/',
    '/reisen': '/mehr', '/reise': '/mehr', '/album': '/mehr', '/stats': '/mehr', '/import': '/mehr', '/settings': '/mehr', '/sources': '/mehr', '/plan': '/mehr' },
  /* Seiten, auf denen man an einer Sache arbeitet: ohne untere Leiste, mit „Zurück“ */
  deep: ['/tour', '/story', '/settings', '/import', '/sources', '/reise', '/album', '/fix', '/flug', '/plan'],
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
    const root = $('#view'); root.innerHTML = ''; root.scrollTop = 0;
    Nav.cur = key;
    const tab = Nav.home[key] || key, deep = Nav.deep.includes(key);
    $$('#tabs a').forEach(a => { const on = a.dataset.p === tab; a.classList.toggle('on', on); if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    $('#tabs').classList.toggle('hide', deep); root.classList.toggle('notabs', deep);
    Nav.syncRec();
    try { Nav.cleanup = await route(root, parts.slice(1).map(decodeURIComponent)); }
    catch (e) { root.append(UI.empty({ title: 'Das hat nicht geklappt', text: String(e.message || e) })); console.error(e); }
  },
  /** Die Scheibe „Aufnehmen“ wird rot, solange eine Aufzeichnung läuft oder pausiert ist. */
  syncRec() {
    const a = $('#tabs a.rec'); if (!a) return;
    let live = false;
    try { const st = window.MTApp ? JSON.parse(MTApp.status()) : {}; live = st.state === 'recording' || st.state === 'paused'; } catch (e) { /* ohne Hülle */ }
    a.classList.toggle('live', live);
    a.setAttribute('aria-label', live ? 'Aufnehmen – Aufzeichnung läuft' : 'Aufnehmen');
    a.firstChild.innerHTML = Ico.svg(live ? 'stop' : 'rec', 26);
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
      UI.row({ icon: 'map', title: 'Karte aller Touren', sub: 'Alle Strecken auf einer Karte, Offline-Karten', href: '#/map', id: 'm-map' })])),
    UI.section('Rückblick', UI.list([
      UI.row({ icon: 'bag', title: 'Reisen & Alben', sub: 'Reisen automatisch erkannt, Alben aus Schlagworten', href: '#/reisen', id: 'm-reisen' }),
      UI.row({ icon: 'chart', title: 'Statistik', sub: 'Jahre, Sportarten, Rekorde, Kalender, Ziele', href: '#/stats', id: 'm-stats' })])),
    UI.section('Daten', UI.list([
      UI.row({ icon: 'download', title: 'Touren importieren', sub: 'Dateien, Komoot, Strava, Zepp, Bosch Flow, Garmin', href: '#/import', id: 'm-import' }),
      UI.row({ icon: 'photo', title: 'Foto-Quellen', sub: 'Galerie, Ordner, Netzwerkfreigabe, Nextcloud', href: '#/sources', id: 'm-sources' }),
      UI.row({ icon: 'gear', title: 'Einstellungen & Sicherung', sub: 'Karte, Routing, Heimatort, Puls, Datensicherung', href: '#/settings', id: 'm-settings' })])),
    h('p', { class: 'muted small', style: { marginTop: '20px' } }, `${nT} ${nT === 1 ? 'Tour' : 'Touren'} · ${nP} ${nP === 1 ? 'Foto' : 'Fotos'} · alles nur auf diesem Handy`)));
};
window.mtBack = function () {
  if (sheet.stack && sheet.stack.length) { sheet.stack[sheet.stack.length - 1].close(); return true; }
  if (window.__lightbox) { window.__lightbox.close(); return true; }
  if (window.__show) { window.__show.close(); return true; }
  if (Nav.deep.includes(Nav.cur) || ['/stats', '/reisen', '/map'].includes(Nav.cur)) { Nav.back(); return true; }
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
  Nav.tabs.forEach(([p, t, i]) => tabs.append(h('a', { href: '#' + p, 'data-p': p, class: p === '/rec' ? 'rec' : '' }, h('span', { class: 'ti', html: Ico.svg(i, 23) }), h('span', null, t))));
  if (!location.hash) history.replaceState(null, '', '#/start');      // ohne hashchange-Ereignis, sonst wird die Startseite doppelt aufgebaut
  window.addEventListener('hashchange', () => { Nav.depth++; Nav.render(); });
  window.addEventListener('mtshared', handleShared);
  window.addEventListener('mtphoto', handlePhotoQueue);
  await Nav.render();
  setTimeout(() => { handleShared(); handlePhotoQueue(); checkUnsaved(); }, 600);
}
async function handleShared() {
  if (!window.MTApp) return;
  try {
    const files = JSON.parse(MTApp.takeShared() || '[]');
    const txt = JSON.parse(MTApp.takeSharedText() || '[]');
    for (const t of txt) { const m = (t.text || '').match(/https?:\/\/\S+/); if (m && confirm_ok(m[0])) { toast('Link wird geladen …'); try { toast(Import.describe(await Import.fromUrl(m[0]))); } catch (e) { toast(e.message); } } }
    if (!files.length) return;
    const photos = files.filter(f => /\.(jpe?g|png|heic|webp)$/i.test(f.name)), tracks = files.filter(f => !photos.includes(f));
    if (tracks.length) { toast('Import läuft …'); const r = await Import.cacheFiles(tracks); toast(Import.describe(r), 5000); Tours.invalidate(); if (Nav.cur === '/' || Nav.cur === '/start') Nav.render(); }
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
    else if (st.state === 'recording' || st.state === 'paused') { if (Nav.cur !== '/rec') Nav.go('/rec'); }
  } catch (e) { /* ignorieren */ }
}
document.addEventListener('DOMContentLoaded', boot);
