'use strict';
/* Hilfsfunktionen: DOM, Formate, Dialoge, Brücke zur Android-Hülle */
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const k in (attrs || {})) {
    const v = attrs[k];
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'html') e.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c)));
  return e;
}
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const sleep = ms => new Promise(r => setTimeout(r, ms));

const F = {
  km: m => m == null ? '–' : (m < 1000 ? Math.round(m) + ' m' : (m / 1000).toFixed(m < 100000 ? 1 : 0).replace('.', ',') + ' km'),
  km2: m => m == null ? '–' : (m / 1000).toFixed(1).replace('.', ','),
  m: m => m == null || isNaN(m) ? '–' : Math.round(m).toLocaleString('de-DE') + ' m',
  dur: s => { if (s == null || isNaN(s)) return '–'; s = Math.round(s); const hh = Math.floor(s / 3600), mm = Math.floor(s % 3600 / 60); return hh ? hh + ':' + String(mm).padStart(2, '0') + ' h' : mm + ' min'; },
  clock: s => { s = Math.round(s || 0); const hh = Math.floor(s / 3600), mm = Math.floor(s % 3600 / 60), ss = s % 60; return (hh ? hh + ':' : '') + String(mm).padStart(2, '0') + ':' + String(ss).padStart(2, '0'); },
  date: ms => ms ? new Date(ms).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' }) : '–',
  dshort: ms => ms ? new Date(ms).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '–',
  time: ms => ms ? new Date(ms).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : '–',
  speed: (m, s) => s > 0 ? (m / s * 3.6).toFixed(1).replace('.', ',') + ' km/h' : '–',
  size: b => b > 1048576 ? (b / 1048576).toFixed(1).replace('.', ',') + ' MB' : Math.round(b / 1024) + ' KB',
};

function toast(msg, ms) {
  let t = $('#toast');
  if (!t) { t = h('div', { id: 'toast', role: 'status' }); document.body.append(t); }
  t.textContent = msg; t.classList.add('on');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('on'), ms || 3200);
}

/** Unterer Dialog („Sheet“). Gibt {el, close} zurück. */
function sheet(title, content, opts) {
  const back = h('div', { class: 'sheet-back', onclick: e => { if (e.target === back) close(); } });
  const box = h('div', { class: 'sheet', role: 'dialog', 'aria-label': title },
    h('div', { class: 'sheet-h' }, h('b', null, title), h('button', { class: 'ico', 'aria-label': 'Schließen', onclick: () => close() }, '✕')),
    h('div', { class: 'sheet-b' }, content));
  back.append(box); document.body.append(back);
  requestAnimationFrame(() => back.classList.add('on'));
  function close() { back.classList.remove('on'); setTimeout(() => back.remove(), 180); sheet.stack = sheet.stack.filter(x => x !== api); if (opts && opts.onclose) opts.onclose(); }
  const api = { el: box, close };
  (sheet.stack = sheet.stack || []).push(api);
  return api;
}
function confirmBox(title, text, okLabel) {
  return new Promise(res => {
    let done = false;
    const s = sheet(title, h('div', null, h('p', null, text),
      h('div', { class: 'row end' }, h('button', { class: 'btn', onclick: () => { done = true; s.close(); res(false); } }, 'Abbrechen'),
        h('button', { class: 'btn pri', onclick: () => { done = true; s.close(); res(true); } }, okLabel || 'OK'))), { onclose: () => { if (!done) res(false); } });
  });
}
function askText(title, label, value, okLabel) {
  return new Promise(res => {
    let done = false;
    const inp = h('input', { type: 'text', value: value || '', placeholder: label });
    const s = sheet(title, h('div', null, h('label', { class: 'fld' }, label, inp),
      h('div', { class: 'row end' }, h('button', { class: 'btn', onclick: () => { done = true; s.close(); res(null); } }, 'Abbrechen'),
        h('button', { class: 'btn pri', onclick: () => { done = true; s.close(); res(inp.value); } }, okLabel || 'OK'))), { onclose: () => { if (!done) res(null); } });
    setTimeout(() => inp.focus(), 250);
  });
}

/** Leerzustand ohne Touren – auf Start- und Tourenseite derselbe. */
function welcomeHero() {
  return h('div', { class: 'empty hero' }, h('div', { class: 'big' }, '⛰️'), h('h2', null, 'Willkommen im Tourentagebuch'),
    h('p', null, 'Alle Touren und Fotos bleiben auf deinem Handy. Hol deine bisherigen Touren herein oder starte gleich eine neue.'),
    h('div', { class: 'col' }, h('a', { class: 'btn pri', href: '#/import' }, '📥 Touren importieren'),
      h('a', { class: 'btn', href: '#/rec' }, '● Aufzeichnung starten'), h('a', { class: 'btn', href: '#/plan' }, '✏️ Tour planen')));
}

/* ---- Brücke zur Android-Hülle (Promise-Wrapper um MTApp.call) ---- */
const Native = {
  _id: 0, _cbs: {},
  available: () => !!window.MTApp,
  call(method, args) {
    return new Promise((ok, fail) => {
      if (!window.MTApp) return fail(new Error('Nur in der Android-App verfügbar'));
      const id = ++Native._id;
      Native._cbs[id] = [ok, fail];
      try { window.MTApp.call(String(id), method, JSON.stringify(args || {})); } catch (e) { delete Native._cbs[id]; fail(e); }
    });
  },
  async json(method, args) { const r = await Native.call(method, args); return typeof r === 'string' ? JSON.parse(r) : r; },
  /** HTTP über die Hülle (kein CORS). Ohne Hülle (Browser-Test) über fetch. */
  async http(o) {
    if (window.MTApp) return Native.json('http', o);
    const r = await fetch(o.url, { method: o.method || 'GET', headers: o.headers, body: o.body });
    const hd = {}; r.headers.forEach((v, k) => hd[k] = v);
    return { status: r.status, headers: hd, body: await r.text() };
  },
};
window.__mtcb = (id, ok, json) => {
  const c = Native._cbs[id]; if (!c) return; delete Native._cbs[id];
  if (ok) { try { c[0](json); } catch (e) { c[1](e); } } else c[1](new Error(json));
};
const App = window.MTApp ? window.MTApp : null;
function appSync(fn, ...a) { try { return App && App[fn] ? App[fn](...a) : null; } catch (e) { return null; } }
