'use strict';
/* Diashow im Vollbild: weiche Überblendung, langsamer Zoom, Titel mit Tour und Datum, Wischen/Tippen, Pause, Tempo. */
const Show = {
  open(list, opts) {
    list = list.filter(p => p && p.id);
    if (!list.length) { toast('Keine Fotos vorhanden'); return; }
    if (window.__show) window.__show.close();
    opts = opts || {};
    if (opts.shuffle) list = list.slice().sort(() => Math.random() - 0.5);
    let i = -1, cur = 0, paused = false, timer = null, sec = Math.min(20, Math.max(2, parseInt(Set_.get('showSec'), 10) || 6)), hideT;
    const layers = [h('div', { class: 'sh-s' }), h('div', { class: 'sh-s' })];
    const cap = h('div', { class: 'sh-cap' });
    const pp = h('button', { class: 'ico', id: 'sh-pp', 'aria-label': 'Pause' }, '❚❚');
    const spd = h('button', { class: 'ico', id: 'sh-spd', 'aria-label': 'Tempo' }, sec + ' s');
    const ctl = h('div', { class: 'sh-ctl off' }, pp, spd, h('button', { class: 'ico', id: 'sh-x', 'aria-label': 'Schließen' }, '✕'));
    const el = h('div', { class: 'sh', role: 'dialog', 'aria-label': 'Diashow' }, ...layers, cap, ctl);
    const poke = () => { ctl.classList.remove('off'); clearTimeout(hideT); hideT = setTimeout(() => ctl.classList.add('off'), 3000); };
    const loop = () => { clearTimeout(timer); if (!paused) timer = setTimeout(() => { show(i + 1); loop(); }, sec * 1000); };
    function show(n) {
      i = (n + list.length) % list.length;
      const p = list[i], nxt = layers[1 - cur], old = layers[cur];
      const img = new Image();
      img.onload = () => {
        nxt.style.backgroundImage = `url("${img.src}")`;
        nxt.style.animationDuration = (sec + 2) + 's';
        nxt.classList.remove('on'); void nxt.offsetWidth; nxt.classList.add('on'); old.classList.remove('on'); cur = 1 - cur;
      };
      img.src = Photos.url(p.id);
      const when = p.ts ? new Date(p.ts).toLocaleString('de-DE', { dateStyle: 'long', timeStyle: 'short' }) : '';
      cap.innerHTML = '';
      if (p.tourName) cap.append(h('b', null, p.tourName));
      cap.append(h('span', null, when + (list.length > 1 ? '  ·  ' + (i + 1) + ' / ' + list.length : '')));
      const pre = new Image(); pre.src = Photos.url(list[(i + 1) % list.length].id);
    }
    function close() { clearTimeout(timer); clearTimeout(hideT); document.removeEventListener('keydown', key); el.remove(); window.__show = null; }
    const key = e => { if (e.key === 'Escape') close(); else if (e.key === ' ') { pp.click(); } else if (e.key === 'ArrowRight') { show(i + 1); loop(); } else if (e.key === 'ArrowLeft') { show(i - 1); loop(); } };
    pp.onclick = e => { e.stopPropagation(); paused = !paused; pp.textContent = paused ? '▶' : '❚❚'; loop(); poke(); };
    spd.onclick = async e => { e.stopPropagation(); const order = [3, 6, 10, 15]; sec = order[(order.indexOf(sec) + 1) % order.length]; spd.textContent = sec + ' s'; await Set_.set('showSec', sec); loop(); poke(); };
    ctl.querySelector('#sh-x').onclick = e => { e.stopPropagation(); close(); };
    let x0 = null, y0 = null, swiped = 0;
    el.addEventListener('touchstart', e => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
    el.addEventListener('touchend', e => { if (x0 == null) return; const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0; x0 = null; if (Math.abs(dx) > 50 && Math.abs(dx) > 1.5 * Math.abs(dy)) { swiped = Date.now(); show(dx < 0 ? i + 1 : i - 1); loop(); poke(); } });
    el.addEventListener('click', e => {
      if (Date.now() - swiped < 500 || e.target.closest('.sh-ctl')) return;
      const x = e.clientX / innerWidth;
      if (x > 1 / 3 && x < 2 / 3) { poke(); return; }
      show(x < 1 / 3 ? i - 1 : i + 1); loop(); poke();
    });
    document.addEventListener('keydown', key);
    document.body.append(el); window.__show = { close };
    try { if (window.MTApp && MTApp.keepScreenOn) MTApp.keepScreenOn(true); } catch (e) { /* egal */ }
    poke(); show(opts.start || 0); loop();
  },
  /** Fotos zu einer Liste von Touren (mit Tourname), nach Zeit sortiert. */
  async forTours(tours) {
    const out = [];
    for (const t of tours) (await DB.byIndex('photos', 'tour', t.id)).forEach(p => out.push(Object.assign({ tourName: t.name }, p)));
    return out.sort((a, b) => (a.ts || 0) - (b.ts || 0));
  },
};
