'use strict';
/* Gerüst: Router, Tab-Leiste, Startablauf. Ansichten registrieren sich in Views[...]. */
const Views = {};
const Nav = {
  cleanup: null, cur: '',
  /* Gezeichnete Symbole statt Emojis – sehen auf jedem Gerät gleich aus. */
  tabs: [['/start', 'Start', '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/></svg>'], ['/', 'Touren', '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 19l6-10 4 6 2-3 6 7z"/><circle cx="17" cy="6" r="1.6"/></svg>'], ['/rec', 'Aufnehmen', '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="6" fill="currentColor" stroke="none"/></svg>'], ['/map', 'Karte', '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2-6-2z"/><path d="M9 4v14M15 6v14"/></svg>'], ['/photos', 'Fotos', '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M21 16l-5-5-8 8"/></svg>']],
  go(path) { if (location.hash === '#' + path) Nav.render(); else location.hash = '#' + path; },
  back() { if (history.length > 1 && Nav.depth > 0) { history.back(); } else Nav.go('/'); },
  depth: 0,
  async render() {
    const raw = location.hash.slice(1) || '/start';
    const parts = raw.split('/').filter(Boolean);
    const key = '/' + (parts[0] || '');
    const route = Views[key] || Views['/'];
    if (Nav.cleanup) { try { Nav.cleanup(); } catch (e) { /* weiter */ } Nav.cleanup = null; }
    const root = $('#view'); root.innerHTML = ''; root.scrollTop = 0;
    Nav.cur = key;
    $$('#tabs a').forEach(a => a.classList.toggle('on', a.dataset.p === key || (key === '/tour' && a.dataset.p === '/')));
    $('#tabs').classList.toggle('hide', ['/tour', '/story', '/settings', '/stats', '/import', '/sources'].includes(key));
    try { Nav.cleanup = await route(root, parts.slice(1).map(decodeURIComponent)); }
    catch (e) { root.append(h('div', { class: 'empty' }, h('h2', null, 'Das hat nicht geklappt'), h('p', null, String(e.message || e)))); console.error(e); }
  },
};
/** Wegweiser-Zeichen im Kopf – dasselbe Motiv wie bei „Meine Touren“. */
function logoMark() {
  const e = h('span', { class: 'logo', 'aria-hidden': 'true' });
  e.innerHTML = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 19l6-11 4 7 2-3 6 7z"/></svg>';
  return e;
}
function topbar(title, opts) {
  opts = opts || {};
  return h('header', { class: 'top' },
    opts.back ? h('button', { class: 'ico', 'aria-label': 'Zurück', onclick: () => Nav.back() }, '←') : logoMark(),
    h('h1', null, title),
    h('span', { class: 'sp' }), opts.actions || null,
    opts.noMenu ? null : h('button', { class: 'ico', 'aria-label': 'Menü', onclick: moreMenu }, '⋮'));
}
function moreMenu() {
  const item = (ico, t, sub, fn) => h('button', { class: 'li', onclick: () => { s.close(); fn(); } }, h('span', { class: 'li-i' }, ico), h('span', { class: 'li-t' }, h('b', null, t), sub ? h('small', null, sub) : null));
  const s = sheet('Mehr', h('div', { class: 'list' },
    item('📥', 'Touren importieren', 'Komoot, Strava, Zepp, Bosch Flow, Garmin, Dateien', () => Nav.go('/import')),
    item('📊', 'Statistik', 'Jahre, Sportarten, Rekorde', () => Nav.go('/stats')),
    item('🖼️', 'Foto-Quellen', 'Galerie, Ordner, Netzwerkfreigabe, Nextcloud', () => Nav.go('/sources')),
    item('⚙️', 'Einstellungen & Sicherung', 'Karten, Routing, Daten', () => Nav.go('/settings'))));
}
window.mtBack = function () {
  if (sheet.stack && sheet.stack.length) { sheet.stack[sheet.stack.length - 1].close(); return true; }
  if (window.__lightbox) { window.__lightbox.close(); return true; }
  if (['/tour', '/story', '/settings', '/stats', '/import', '/sources'].includes(Nav.cur)) { Nav.back(); return true; }
  if (Nav.cur !== '/start' && Nav.cur !== '') { Nav.go('/start'); return true; }
  return false;
};

async function boot() {
  try {
    await DB.open(); await Set_.load();
  } catch (e) {
    document.body.innerHTML = '<div class="empty"><h2>Datenbank nicht verfügbar</h2><p>' + esc(e.message) + '</p></div>'; return;
  }
  const tabs = $('#tabs');
  Nav.tabs.forEach(([p, t, i]) => { const a = h('a', { href: '#' + p, 'data-p': p, class: p === '/rec' ? 'rec' : '' }, h('span', { class: 'ti' }), h('span', null, t)); a.firstChild.innerHTML = i; tabs.append(a); });
  if (!location.hash) location.hash = '#/start';
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
    if (tracks.length) { toast('Import läuft …'); const r = await Import.cacheFiles(tracks); toast(Import.describe(r), 5000); Tours.invalidate(); if (Nav.cur === '/') Nav.render(); }
    if (photos.length) {
      const m = await Native.json('importFiles', { paths: photos.map(f => f.path), src: 'geteilt' });
      const n = await Photos.addMeta(m); toast(n + ' Foto(s) übernommen', 4000);
    }
  } catch (e) { toast('Teilen: ' + e.message); }
}
const confirm_ok = u => /^https?:\/\//.test(u);
async function handlePhotoQueue() {
  if (!window.MTApp) return;
  try { const q = JSON.parse(MTApp.takePhotoQueue() || '[]'); if (q.length) { await Photos.addMeta(q); window.dispatchEvent(new Event('photos-changed')); } } catch (e) { /* ignorieren */ }
}
async function checkUnsaved() {
  if (!window.MTApp) return;
  try {
    const st = JSON.parse(MTApp.status());
    if (st.state === 'finished' || (st.unsent && st.state === 'idle')) { if (Nav.cur !== '/rec') { toast('Es gibt eine noch nicht gespeicherte Aufzeichnung.', 6000); Nav.go('/rec'); } }
    else if (st.state === 'recording' || st.state === 'paused') { if (Nav.cur !== '/rec') Nav.go('/rec'); }
  } catch (e) { /* ignorieren */ }
}
document.addEventListener('DOMContentLoaded', boot);
