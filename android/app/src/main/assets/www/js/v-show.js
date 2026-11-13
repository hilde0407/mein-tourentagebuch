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
    const prv = h('button', { class: 'ico', id: 'sh-prv', 'aria-label': 'Vorheriges Foto' }, '‹'), nxb = h('button', { class: 'ico', id: 'sh-nxt', 'aria-label': 'Nächstes Foto' }, '›');
    const shr = opts.tour ? h('button', { class: 'ico', id: 'sh-shr', 'aria-label': 'Diashow teilen' }, '📤') : null;
    const ctl = h('div', { class: 'sh-ctl off' }, prv, nxb, pp, spd, shr, h('button', { class: 'ico', id: 'sh-x', 'aria-label': 'Schließen' }, '✕'));
    const prog = h('div', { class: 'sh-prog' }, h('i'));   // bleibt auch bei ausgeblendeter Bedienleiste sichtbar
    const el = h('div', { class: 'sh', role: 'dialog', 'aria-label': 'Diashow' }, ...layers, cap, prog, ctl);
    const poke = () => { ctl.classList.remove('off'); clearTimeout(hideT); hideT = setTimeout(() => ctl.classList.add('off'), 3000); };
    const loop = () => { clearTimeout(timer); if (!paused) timer = setTimeout(() => { show(i + 1); loop(); }, sec * 1000); };
    function show(n) {
      i = (n + list.length) % list.length;
      prog.firstChild.style.width = ((i + 1) / list.length * 100) + '%';
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
    function close() { clearTimeout(timer); clearTimeout(hideT); document.removeEventListener('keydown', key); el.remove(); window.__show = null;
      try { Native.call('fullscreen', { on: false }).catch(() => {}); } catch (e) { /* ohne Hülle egal */ }
      try { if (window.MTApp && MTApp.keepScreenOn) MTApp.keepScreenOn(false); } catch (e) { /* egal */ } }
    const key = e => { if (e.key === 'Escape') close(); else if (e.key === ' ') { pp.click(); } else if (e.key === 'ArrowRight') { show(i + 1); loop(); } else if (e.key === 'ArrowLeft') { show(i - 1); loop(); } };
    prv.onclick = e => { e.stopPropagation(); show(i - 1); loop(); poke(); };
    nxb.onclick = e => { e.stopPropagation(); show(i + 1); loop(); poke(); };
    if (shr) shr.onclick = e => { e.stopPropagation(); if (!paused) pp.click(); Show.share(opts.tour, opts.pts, list); };
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
    try { Native.call('fullscreen', { on: true }).catch(() => {}); } catch (e) { /* ohne Hülle egal */ }
    poke(); show(opts.start || 0); loop();
  },
  /** Eigenständige HTML-Diashow (alles eingebettet, läuft offline) als String. items: [{s: Bild als dataURL, c: Zeit, n: Notiz}]. */
  html(t, pts, items) {
    const stats = [[F.km(t.dist), 'Strecke'], [F.m(t.up), 'Aufstieg'], [t.dur ? F.dur(t.dur) : '–', 'Dauer']].map(x => `<div><b>${esc(x[0])}</b><small>${x[1]}</small></div>`).join('');
    const svg = pts && pts.length > 1 ? previewSvg(pts, '#f2c230', { w: 640, h: 280, pad: 24, sw: 3, ends: 5, endsA: '#0e2a2b' }) : '';
    // "<" und Zeilentrenner maskieren, damit die Daten das Skript nicht vorzeitig beenden
    const data = JSON.stringify(items).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
    return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(t.name)}</title><style>
*{box-sizing:border-box}body{margin:0;background:#0e2a2b;color:#eef3f2;font:16px/1.4 system-ui,sans-serif}
header{padding:20px 16px 8px;max-width:900px;margin:0 auto}h1{margin:0 0 2px;font-size:26px}.d{opacity:.75}
.st{display:flex;gap:24px;margin-top:12px}.st b{display:block;font-size:20px}.st small{opacity:.7}
.map{max-width:900px;margin:0 auto;padding:0 16px;text-align:center}.map svg{max-width:100%;height:auto}
#sh{position:relative;max-width:900px;height:70vh;min-height:320px;margin:12px auto 0;background:#000;overflow:hidden;user-select:none;-webkit-user-select:none}
#sh img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;opacity:0;transition:opacity 1s}#sh img.on{opacity:1}
#cap{position:absolute;left:0;right:0;bottom:0;padding:28px 14px 12px;background:linear-gradient(transparent,rgba(0,0,0,.75));pointer-events:none;text-shadow:0 1px 4px #000}
#cap small{display:block;opacity:.85}#cnt{position:absolute;top:10px;right:12px;background:rgba(0,0,0,.55);padding:2px 10px;border-radius:12px;font-size:14px}
.ctl{position:absolute;top:10px;left:12px;display:flex;gap:6px}.ctl button{background:rgba(0,0,0,.55);color:#fff;border:0;border-radius:20px;min-width:40px;height:40px;font-size:18px}
footer{text-align:center;opacity:.6;font-size:13px;padding:16px}
</style></head><body>
<header><h1>${esc(t.name)}</h1><div class="d">${esc(F.date(t.start))}</div><div class="st">${stats}</div></header>
<div class="map">${svg}</div>
<div id="sh"><img id="a" alt=""><img id="b" alt=""><div id="cap"></div><div id="cnt"></div><div class="ctl"><button id="pv" aria-label="Zurück">‹</button><button id="pp" aria-label="Pause">❚❚</button><button id="nx" aria-label="Weiter">›</button></div></div>
<footer>Erstellt mit Mein Tourentagebuch</footer>
<script>
var D=${data},i=0,c=0,paused=false,tm=null,L=[document.getElementById('a'),document.getElementById('b')],sh=document.getElementById('sh'),pp=document.getElementById('pp');
function show(n){i=(n+D.length)%D.length;var nx=L[1-c],ol=L[c],d=D[i];nx.src=d.s;nx.className='on';ol.className='';c=1-c;
var cap=document.getElementById('cap');cap.textContent='';var a=document.createElement('span');a.textContent=d.c;cap.appendChild(a);
if(d.n){var b=document.createElement('small');b.textContent=d.n;cap.appendChild(b)}
document.getElementById('cnt').textContent=(i+1)+' / '+D.length}
function loop(){clearTimeout(tm);if(!paused&&D.length>1)tm=setTimeout(function(){show(i+1);loop()},5000)}
function toggle(){paused=!paused;pp.textContent=paused?'\u25B6':'\u275A\u275A';loop()}
function go(n){show(n);loop()}
document.getElementById('pv').onclick=function(e){e.stopPropagation();go(i-1)};
document.getElementById('nx').onclick=function(e){e.stopPropagation();go(i+1)};
pp.onclick=function(e){e.stopPropagation();toggle()};
sh.onclick=function(e){var r=sh.getBoundingClientRect(),x=(e.clientX-r.left)/r.width;if(x<.33)go(i-1);else if(x>.67)go(i+1);else toggle()};
document.onkeydown=function(e){if(e.key==='ArrowRight')go(i+1);else if(e.key==='ArrowLeft')go(i-1);else if(e.key===' '){e.preventDefault();toggle()}};
show(0);loop();
</script></body></html>`;
  },
  /** Baut die HTML-Diashow zur Tour und gibt sie über das Teilen-Menü der App weiter. */
  async share(t, pts, photos) {
    if (!Native.available()) { toast('Teilen geht nur in der App'); return; }
    const ps = (photos || []).filter(p => p && p.id && !p.video && !/v$/.test(p.id));
    if (!t || !ps.length) { toast('Keine Fotos vorhanden'); return; }
    try {
      await PhotoSources.progress('Diashow erstellen', async (upd) => {
        let lim = ps.length > 25 ? [1280, 0.72] : [1600, 0.8], tot = 0;
        const items = [], n = ps.length + 1;
        for (let k = 0; k < ps.length; k++) {
          upd(k, n);
          try {
            const img = await new Promise((ok, no) => { const im = new Image(); im.onload = () => ok(im); im.onerror = no; im.src = Photos.url(ps[k].id); });
            const sc = Math.min(1, lim[0] / Math.max(img.naturalWidth, img.naturalHeight)), cv = document.createElement('canvas');
            cv.width = Math.max(1, Math.round(img.naturalWidth * sc)); cv.height = Math.max(1, Math.round(img.naturalHeight * sc));
            cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
            const s = cv.toDataURL('image/jpeg', lim[1]); cv.width = cv.height = 0;
            tot += s.length;
            if (tot > 40e6) lim = [1280, 0.72];   // Datei sonst zu groß für Mail/Messenger: Rest kleiner
            items.push({ s, c: ps[k].ts ? new Date(ps[k].ts).toLocaleString('de-DE', { dateStyle: 'long', timeStyle: 'short' }) : '', n: ps[k].note || '' });
          } catch (e) { /* unlesbares Foto überspringen */ }
        }
        if (!items.length) throw new Error('Keine Fotos lesbar');
        upd(ps.length, n, 'Datei übergeben');
        const buf = new TextEncoder().encode(Show.html(t, pts, items)), CH = 512 * 1024;
        for (let o = 0; o < buf.length; o += CH) {
          let bin = ''; const part = buf.subarray(o, o + CH);
          for (let q = 0; q < part.length; q += 8192) bin += String.fromCharCode.apply(null, part.subarray(q, q + 8192));
          await Native.json('appendCache', { name: 'diashow.html', b64: btoa(bin), reset: o === 0 });
        }
        await Native.call('shareCache', { name: 'diashow.html', mime: 'text/html', title: 'Diashow teilen' });
      });
    } catch (e) { toast('Teilen fehlgeschlagen: ' + (e && e.message || e)); }
  },
  /** Fotos zu einer Liste von Touren (mit Tourname), nach Zeit sortiert. */
  async forTours(tours) {
    const out = [];
    for (const t of tours) (await DB.byIndex('photos', 'tour', t.id)).forEach(p => out.push(Object.assign({ tourName: t.name }, p)));
    return out.sort((a, b) => (a.ts || 0) - (b.ts || 0));
  },
};
