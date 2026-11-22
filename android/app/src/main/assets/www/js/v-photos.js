'use strict';
/* Fotos: Raster, Vollbild-Ansicht mit Diashow, Quellen (Galerie, Ordner, SMB, WebDAV/Nextcloud, Kamera). */
const Lightbox = {
  open(list0, idx) {
    if (window.__lightbox) window.__lightbox.close();
    // 2.14.0: eigene Kopie der Liste – Löschen in der Lightbox verändert nicht mehr heimlich die Liste der Ansicht dahinter (die lädt nach „photos-changed“ neu)
    const list = (list0 || []).slice();
    let i = Math.min(Math.max(0, idx | 0), Math.max(0, list.length - 1)), timer = null;
    const img = h('img', { alt: '', class: 'lb-img' });
    // 2.8.0: Panoramen (breiter als 2,2 : 1) füllen die Höhe und lassen sich quer schieben; „Ganz anzeigen“ zeigt das ganze Bild auf Breite
    const pan = h('div', { class: 'lb-pan', id: 'lb-pan' }, img);
    let panoFit = true;
    const pb = h('button', { class: 'lb-pb', id: 'lb-pano', hidden: true, onclick: () => { panoFit = !panoFit; setPano(true); } });
    const vid = h('video', { class: 'lb-img', controls: true, playsinline: true, preload: 'metadata' });
    vid.hidden = true;
    // 2.9.0: In der App spielt ein eigener Vollbild-Player (Android, Datei direkt) das Video. Hier steht nur das Vorschaubild mit großem Abspiel-Symbol und Dauer.
    // Das <video>-Element ist der Rückfall: ohne Hülle (Browser) oder wenn der Player meldet, dass er das Video nicht abspielen kann.
    const native = !!window.MTApp;
    const vpImg = h('img', { alt: '' }), vpDur = h('span', { class: 'lb-vp-d', id: 'lb-dur' });
    const vp = h('button', { class: 'lb-vp', id: 'lb-play', 'aria-label': 'Video abspielen', hidden: true, onclick: () => playNative() }, vpImg, h('span', { class: 'lb-vp-i', html: Ico.svg('play', 46) }), vpDur);
    const viaView = new Set();      // Videos, bei denen der Player gescheitert ist: hier im <video>-Element versuchen
    let playAt = 0;
    const info = h('div', { class: 'lb-info' });
    const err = h('div', { class: 'lb-err', id: 'lb-err', role: 'status', hidden: true });      // 2.7.1: Meldung mit „Jetzt umwandeln“ statt nur einer kurzen Einblendung
    const cnt = h('span', { class: 'lb-cnt' });
    const el = h('div', { class: 'lb', role: 'dialog', 'aria-label': 'Foto' },
      h('div', { class: 'lb-top' }, cnt, h('span', { class: 'sp' }), pb,
        h('button', { class: 'ico', id: 'lb-app', 'aria-label': 'Mit Video-App öffnen', title: 'Mit Video-App öffnen', hidden: true, onclick: extern }, h('span', null, '⤴')),
        h('button', { class: 'ico', 'aria-label': 'Diashow', onclick: toggle }, h('span', { id: 'lbp' }, '▶')),
        h('button', { class: 'ico', 'aria-label': 'Details', onclick: details }, 'ⓘ'),
        h('button', { class: 'ico', 'aria-label': 'Schließen', onclick: close }, '✕')),
      pan, vid, vp, err, h('button', { class: 'lb-nav l', 'aria-label': 'Vorheriges', onclick: () => step(-1) }, '‹'), h('button', { class: 'lb-nav r', 'aria-label': 'Nächstes', onclick: () => step(1) }, '›'), info);
    let x0 = null;
    el.addEventListener('touchstart', e => { x0 = e.touches[0].clientX; }, { passive: true });
    el.addEventListener('touchend', e => { if (x0 == null) return; if (el.classList.contains('panofit') && e.target.closest && e.target.closest('.lb-pan')) { x0 = null; return; } const d = e.changedTouches[0].clientX - x0; x0 = null; if (Math.abs(d) > 50) step(d < 0 ? 1 : -1); });
    const appB = el.querySelector('#lb-app');
    async function extern() { try { vid.pause(); await Native.call('openVideo', { id: list[i].id }); } catch (e) { toast('Video lässt sich nicht öffnen.'); } }
    /** 2.9.0: eigener Player der App (Native 'playVideo'). Die Antwort kommt beim Schließen: { ok } oder { ok: false, what, extra } – dann Rückfall hier. */
    async function playNative() {
      const p = list[i]; if (!p || !p.video) return;
      if (Date.now() - playAt < 1500) return;      // Doppeltipp startet nicht zwei Player
      playAt = Date.now();
      if (timer) toggle();      // Diashow anhalten, solange das Video läuft
      let r;
      try { r = await Native.json('playVideo', { id: p.id }); } catch (e) { r = { ok: false, msg: e.message }; }
      if (r && r.ok) return;
      viaView.add(p.id);
      if (list[i] !== p) return;
      const code = r && r.what != null ? ' (Fehler ' + r.what + (r.extra ? '/' + r.extra : '') + ')' : '';
      toast('Der Player der App kann dieses Video nicht abspielen' + code + '. Es wird hier versucht.', 6000);
      show();
      try { const pr = vid.play(); if (pr && pr.catch) pr.catch(() => {}); } catch (e) { /* Fehler meldet das error-Ereignis */ }
    }
    // 2.6.4: Spielt das eingebaute Video nicht (z. B. HEVC), sagt die Ansicht es und bietet die Video-App an.
    // 2.7.1: bei Fehler 4 (Format nicht unterstützt, meist HEVC) zusätzlich „Jetzt umwandeln“ (in H.264, auf dem Handy)
    let errCode = null, errMsg = '';
    // 2.7.3: Fehler 4 trotz normalem H.264-Video (Volker, 21.11.): Die Auslieferung über den internen Server (Bereichsabfragen) nimmt das WebView nicht an.
    // Rückfall: die Datei ganz laden und als Blob abspielen (bis 250 MB); erst wenn auch das scheitert, kommt die Fehlermeldung.
    let blobUrl = null, blobFor = null;
    const freeBlob = () => { if (blobUrl) { try { URL.revokeObjectURL(blobUrl); } catch (e) { /* egal */ } blobUrl = null; } };
    async function viaBlob(p) {
      blobFor = p.id;
      try {
        const r = await fetch(Photos.url(p.id)), n = +r.headers.get('content-length') || 0;
        if (!r.ok || n > 250 * 1048576) return false;
        const b = await r.blob();
        if (list[i] !== p) return true;
        freeBlob(); blobUrl = URL.createObjectURL(new Blob([b], { type: 'video/mp4' })); vid.src = blobUrl;
        return true;
      } catch (e) { return false; }
    }
    vid.addEventListener('error', async () => {
      const p = list[i]; if (!p || !p.video || !vid.getAttribute('src')) return;
      if (blobFor !== p.id && !(blobUrl && vid.getAttribute('src') === blobUrl) && await viaBlob(p)) return;
      if (list[i] !== p) return;
      errCode = vid.error ? vid.error.code : '?'; showErr(p); zeigeInfo(p);
    });
    /** Panorama-Darstellung: on = aktuelles Bild ist ein Panorama; panoFit = auf Höhe (quer schiebbar), sonst ganz auf Breite. */
    function setPano(on) {
      el.classList.toggle('panofit', !!on && panoFit);
      pb.hidden = !on;
      pb.innerHTML = Ico.svg(panoFit ? 'pano' : 'swap', 18) + '<span>' + (panoFit ? 'Ganz anzeigen' : 'Auf Höhe') + '</span>';
      pb.setAttribute('aria-label', panoFit ? 'Panorama ganz anzeigen' : 'Panorama auf Bildschirmhöhe zeigen (quer schieben)');
      if (on && panoFit) mitte();
    }
    function mitte() { requestAnimationFrame(() => { if (el.classList.contains('panofit')) pan.scrollLeft = Math.max(0, (pan.scrollWidth - pan.clientWidth) / 2); }); }
    img.addEventListener('load', () => {
      const p = list[i]; if (!p || p.video) return;
      const on = PanoCalc.ist(p) || PanoCalc.ist(img.naturalWidth, img.naturalHeight);      // ohne gespeicherte Größe: nach dem echten Bild
      if (on !== !pb.hidden) setPano(on); else if (on) mitte();
    });
    function busyFor(p) { const st = Videos.state; return !!(st && st.running && st.id === p.id); }
    function showErr(p, msg) {
      if (msg !== undefined) errMsg = msg;
      err.innerHTML = ''; err.hidden = false;
      const busy = busyFor(p), st = Videos.state;
      if (busy) {
        err.append(h('p', null, 'Video wird umgewandelt …' + (st.pct ? ' ' + st.pct + ' %' : '')),
          h('div', { class: 'row' }, h('button', { class: 'btn sm', id: 'lb-stop', onclick: async e => { e.currentTarget.disabled = true; try { await Native.call('videoCancel'); } catch (x) { /* egal */ } } }, 'Abbrechen')));
        return;
      }
      err.append(h('p', null, errMsg || 'Video lässt sich hier nicht abspielen (Fehler ' + errCode + ').'),
        h('div', { class: 'row' },
          errCode === 4 ? h('button', { class: 'btn sm pri', id: 'lb-conv', onclick: () => convertNow(p) }, 'Jetzt umwandeln') : null,
          h('button', { class: 'btn sm', id: 'lb-ext', onclick: extern }, 'In Video-App öffnen')));
    }
    /** 2.7.2: technische Angaben (Codec, Größe, Datenrate …) unter die Fehlermeldung, damit sich die Ursache finden lässt */
    async function zeigeInfo(p) {
      try {
        const o = await Native.json('videoInfo', { id: p.id });
        const tr = (o.tracks || []).map(t => [t.mime, t.width && t.height ? t.width + '×' + t.height : '', t['frame-rate'] ? Math.round(t['frame-rate']) + ' B/s' : '', t.bitrate ? Math.round(t.bitrate / 1e5) / 10 + ' Mbit/s' : '', t.profile != null ? 'Profil ' + t.profile : '', t['rotation-degrees'] ? 'Drehung ' + t['rotation-degrees'] : '', t['color-transfer'] != null ? 'Farbe ' + t['color-transfer'] : ''].filter(Boolean).join(' · '));
        const q = h('p', { class: 'muted small', id: 'lb-info2' }, 'Technik: ' + [o.brand, Math.round(o.size / 1048576 * 10) / 10 + ' MB'].concat(tr, o.fehler ? ['Fehler ' + o.fehler] : []).join(' | '));
        err.querySelector('#lb-info2') && err.querySelector('#lb-info2').remove(); err.append(q);
      } catch (e) { /* egal */ }
    }
    async function convertNow(p) {
      let r;
      try { r = await Native.json('videoConvert', { ids: [p.id] }); } catch (e) { toast('Umwandeln nicht möglich: ' + e.message, 6000); return; }
      if (!r.hevc) { toast('Dieses Video ist kein HEVC – Umwandeln hilft hier nicht. „In Video-App öffnen“ geht trotzdem.', 7000); await zeigeInfo(p); return; }
      errMsg = '';
      await Videos.poll();
      if (list[i] === p) showErr(p);
    }
    const onState = () => { const p = list[i]; if (p && p.video && !err.hidden) showErr(p); };      // 2.9.0: auch wenn die Umwandlung aus „Details“ gestartet wurde (ohne Fehler)
    const onDone = e => {
      const p = list[i]; if (!p || !p.video) return;
      const d = (e.detail || []).find(x => x.id === p.id); if (!d) return;
      if (d.ok) {
        blobFor = null; Object.assign(p, { w: d.w || p.w, h: d.h || p.h, dur: d.dur || p.dur }); err.hidden = true; errCode = null; errMsg = '';
        if (useView(p)) { vid.src = Photos.url(p.id) + '?c=' + Date.now(); vid.poster = Photos.thumb(p.id) + '?c=' + Date.now(); }
        else { vpImg.src = Photos.thumb(p.id) + '?c=' + Date.now(); vpDur.textContent = VideoCalc.dauer(p.dur); vpDur.hidden = !vpDur.textContent; }
      }
      else if (!err.hidden) showErr(p, d.cancel ? 'Umwandlung abgebrochen – das Original ist unverändert.' : 'Umwandeln hat nicht geklappt (' + (d.msg || 'Fehler') + '). Das Original bleibt erhalten.');
    };
    window.addEventListener('video-state', onState); window.addEventListener('video-converted', onDone);
    /** <video>-Element statt eigenem Player: ohne Hülle oder nach einem Fehler des Players */
    function useView(p) { return !native || viaView.has(p.id); }
    function show() {
      const p = list[i];
      err.hidden = true; errCode = null; errMsg = ''; blobFor = null; freeBlob();
      appB.hidden = !p.video;
      const view = p.video && useView(p);
      vp.hidden = !(p.video && !view);
      if (p.video) { img.hidden = true; pan.hidden = true; img.removeAttribute('src'); }
      if (view) { vid.hidden = false; vid.src = Photos.url(p.id); vid.poster = Photos.thumb(p.id); }
      else { try { vid.pause(); } catch (e) { /* egal */ } vid.hidden = true; vid.removeAttribute('src'); }
      if (p.video && !view) {
        vpImg.src = Photos.thumb(p.id); vpDur.textContent = VideoCalc.dauer(p.dur); vpDur.hidden = !vpDur.textContent;
        vp.setAttribute('aria-label', 'Video abspielen' + (vpDur.textContent ? ' (' + vpDur.textContent + ')' : ''));
      }
      if (!p.video) { img.hidden = false; pan.hidden = false; img.src = Photos.url(p.id); }
      setPano(!p.video && PanoCalc.ist(p));
      cnt.textContent = (i + 1) + ' / ' + list.length;
      info.textContent = (p.ts ? F.date(p.ts) + ' · ' + F.time(p.ts) : '') + (p.tourName ? ' · ' + p.tourName : '');
      [list[(i + 1) % list.length], list[(i + list.length - 1) % list.length]].filter(q => !q.video).forEach(q => { const pre = new Image(); pre.src = Photos.url(q.id); });
    }
    function step(d) { i = (i + d + list.length) % list.length; show(); }
    function toggle() { if (timer) { clearInterval(timer); timer = null; $('#lbp').textContent = '▶'; } else { timer = setInterval(() => { if (!(list[i].video && !vid.paused && !vid.ended)) step(1); }, 4000); $('#lbp').textContent = '❚❚'; } }
    function close() { freeBlob(); if (timer) clearInterval(timer); try { vid.pause(); } catch (e) { /* egal */ } window.removeEventListener('video-state', onState); window.removeEventListener('video-converted', onDone); el.remove(); window.__lightbox = null; }
    async function details() {
      const p = list[i], tour = p.tour ? await DB.get('tours', p.tour) : null, V = !!p.video;
      const s = sheet(V ? 'Video' : 'Foto', h('div', null,
        h('p', null, h('b', null, p.name || (V ? 'Video' : 'Foto')), h('br'), p.ts ? F.date(p.ts) + ' · ' + F.time(p.ts) : 'Aufnahmezeit unbekannt',
          V && VideoCalc.dauer(p.dur) ? ' · ' + VideoCalc.dauer(p.dur) + ' min' : null),
        // 2.9.0: Wege für Videos gesammelt: eigener Player, Video-App, Umwandeln (nur HEVC; sonst sagt die App es)
        V && native ? h('div', { class: 'row wrap', id: 'lb-vwege' },
          h('button', { class: 'btn sm', id: 'lb-dplay', onclick: () => { s.close(); playNative(); } }, '▶ Abspielen'),
          h('button', { class: 'btn sm', id: 'lb-dext', onclick: () => { s.close(); extern(); } }, '⤴ In Video-App öffnen'),
          h('button', { class: 'btn sm', id: 'lb-dconv', onclick: () => { s.close(); convertNow(p); } }, 'Umwandeln (HEVC → H.264)'),
          h('button', { class: 'btn sm', id: 'lb-dtrim', onclick: () => { s.close(); VideoTrim.open(p, nachSchnitt); } }, '✂ Zuschneiden')) : null,
        PanoCalc.ist(p) ? h('p', { id: 'lb-panotag' }, h('span', { class: 'tag-pano', html: Ico.svg('pano', 18) + '<span>Panorama</span>' }), ' ' + p.w + ' × ' + p.h + ' Pixel') : null,
        h('p', null, p.lat != null ? `📍 ${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}` + (p.pos === 'track' ? ' (aus der Tour berechnet)' : p.pos === 'zeit' ? ' (aus der Tourzeit ergänzt' + (p.camShift ? ', Uhrzeit ' + FotoOrtCalc.versatzText(p.camShift) : '') + ')' : p.pos === 'start' ? ' (Standort beim Öffnen der Kamera)' : '') : '📍 Keine Position'),
        tour ? h('p', null, '🥾 ', h('a', { href: '#/tour/' + tour.id, onclick: () => { s.close(); close(); } }, tour.name)) : h('p', null, 'Keiner Tour zugeordnet'),
        h('div', { class: 'row' },
          h('button', { class: 'btn sm', onclick: async () => { s.close(); const t = await pickTour(); if (t !== undefined) { p.tour = t ? t.id : ''; await DB.put('photos', p); toast('Zugeordnet'); window.dispatchEvent(new Event('photos-changed')); } } }, 'Tour wählen'),
          p.lat != null ? h('button', { class: 'btn sm', onclick: () => { s.close(); close(); sessionStorage.setItem('mapFocus', JSON.stringify([p.lat, p.lon])); Nav.go('/map'); } }, 'Auf Karte') : null,
          h('button', { class: 'btn sm danger', id: 'lb-del', onclick: async () => { if (await (V ? confirmBox('Video löschen?', 'Das Video wird aus dem Tourentagebuch gelöscht: Datei, Vorschaubild und Eintrag. Eine Kopie in der Galerie bleibt, falls es eine gibt.', 'Löschen') : confirmBox('Foto löschen?', 'Das Foto wird aus dem Tourentagebuch entfernt (das Original bleibt unberührt).', 'Löschen'))) { await Photos.remove(p.id); list.splice(i, 1); s.close(); if (!list.length) close(); else { i = Math.min(i, list.length - 1); show(); } window.dispatchEvent(new Event('photos-changed')); } } }, 'Löschen'))));
    }
    /** 2.12.0: nach dem Zuschneiden – neues Video gleich dahinter zeigen bzw. das ersetzte neu laden */
    function nachSchnitt(r, neu) {
      if (!el.isConnected) return;
      if (neu) { list.splice(i + 1, 0, neu); i++; show(); return; }
      const p = list[i]; if (!p || p.id !== r.id) return;
      Object.assign(p, { w: r.w || p.w, h: r.h || p.h, dur: r.dur || p.dur, ts: r.ts || p.ts });
      show(); vpImg.src = Photos.thumb(p.id) + '?c=' + Date.now();
    }
    document.body.append(el); window.__lightbox = { close }; show();
  },
};
/* 2.8.0: Panorama aufnehmen. Ein Standard-Intent kann den Panorama-Modus der Kamera nicht direkt starten; darum öffnet die Hülle die Kamera-App normal
   (MTApp.takePano, ohne Ausgabedatei) und merkt sich Zeit und letzte Position (pend_pano_*, übersteht auch ein Prozessende). Kommt man zurück
   (Ereignis mtresume oder Neustart), fragt die App „Panorama übernehmen?“ und öffnet die Fotoauswahl. Der offene Start verfällt nach 12 Stunden
   (PanoCalc.FRIST) oder sobald er bedient/abgelehnt ist. Fotos ohne Aufnahmezeit bekommen Zeit und Ort des Kamera-Starts (PanoCalc.rueckfall). */
const Pano = {
  _open: false, _busy: false,
  async start() {
    if (!window.MTApp || !MTApp.takePano) { toast('Panorama braucht die neueste App-Version.', 5000); return; }
    if (!Set_.get('panoHinweisAus')) {
      const go = await new Promise(res => {
        let done = false;
        const cb = h('input', { type: 'checkbox', id: 'pano-nie' });
        const s = sheet('Panorama aufnehmen', h('div', null,
          h('p', null, 'Wähle in der Kamera den Modus Panorama. Danach hierher zurückkehren.'),
          h('p', { class: 'muted small' }, 'Die App fragt dann, ob sie das Panorama übernehmen soll. Die Aufzeichnung läuft währenddessen weiter.'),
          h('label', { class: 'sw' }, cb, h('span', null, 'Nicht mehr zeigen')),
          h('div', { class: 'row end' }, h('button', { class: 'btn', onclick: () => { done = true; s.close(); res(false); } }, 'Abbrechen'),
            h('button', { class: 'btn pri', id: 'pano-go', onclick: async () => { done = true; if (cb.checked) await Set_.set('panoHinweisAus', true); s.close(); res(true); } }, 'Kamera öffnen'))),
          { onclose: () => { if (!done) res(false); } });
      });
      if (!go) return;
    }
    let ok = false;
    try { ok = MTApp.takePano(); } catch (e) { ok = false; }
    if (!ok) toast('Keine Kamera-App gefunden.', 5000);
  },
  pend() { try { return JSON.parse((window.MTApp && MTApp.panoPending && MTApp.panoPending()) || '{}') || {}; } catch (e) { return {}; } },
  clear() { try { if (window.MTApp && MTApp.panoClear) MTApp.panoClear(); } catch (e) { /* egal */ } },
  /** Beim Zurückkehren: offener Start → Rückfrage. „Später“ (oder Schließen) fragt beim nächsten Zurückkehren wieder, „Nein“ verwirft. */
  async check() {
    if (Pano._open || Pano._busy || !window.MTApp || !MTApp.panoPending) return;
    const p = Pano.pend();
    if (!PanoCalc.offen(p)) { if (PanoCalc.verfallen(p)) Pano.clear(); return; }
    Pano._open = true;
    const wahl = await new Promise(res => {
      let done = false;
      const pick = v => () => { done = true; s.close(); res(v); };
      const s = sheet('Panorama übernehmen?', h('div', null,
        h('p', null, 'Hast du in der Kamera ein Panorama aufgenommen? Wähle es aus, dann kommt es zur Tour.'),
        h('p', { class: 'muted small' }, 'Kamera geöffnet um ' + F.time(p.ts) + ' Uhr. Du kannst auch mehrere Fotos wählen.'),
        h('div', { class: 'row end wrap' }, h('button', { class: 'btn', id: 'pano-nein', onclick: pick('nein') }, 'Nein'),
          h('button', { class: 'btn', id: 'pano-spaeter', onclick: pick('spaeter') }, 'Später'),
          h('button', { class: 'btn pri', id: 'pano-pick', onclick: pick('pick') }, 'Foto auswählen'))), { onclose: () => { if (!done) res('spaeter'); } });
    });
    Pano._open = false;
    if (wahl === 'spaeter') return;
    Pano.clear();
    if (wahl === 'pick') await Pano.pick(p);
  },
  /** Fotoauswahl der Hülle (System-Fotoauswahl, mehrere erlaubt); übernommen wie Galerie-Fotos (Zeit aus dem Bild → Tour, Position aus der Spur). */
  async pick(p) {
    Pano._busy = true;
    try {
      const m = await Native.json('pickPhotos', { picker: true });
      if (!m || !m.length) { toast('Kein Foto gewählt.'); return 0; }
      const n = await Photos.addMeta(PanoCalc.rueckfall(m, p));
      window.dispatchEvent(new Event('photos-changed'));
      const panos = m.filter(x => PanoCalc.ist(x)).length;
      toast(!n ? 'Schon vorhanden' : n === 1 ? (panos ? 'Panorama übernommen' : 'Foto übernommen') : n + ' Fotos übernommen', 4000);
      return n;
    } catch (e) { toast(e.message, 6000); return 0; }
    finally { Pano._busy = false; }
  },
};
/* 2.7.1: HEVC-Videos (H.265) in H.264 umwandeln – die eigentliche Arbeit macht die Android-Hülle (VideoService).
   Hier: Zustand abholen (Native 'videoStatus'), fertige Videos in der Datenbank nachtragen, Meldungen, Sammelumwandlung. */
const Videos = {
  state: null, _said: false, bulk: null,
  /** 2.9.0: Einstellungen, die die Hülle selbst braucht (Aufnahmelänge, Galerie-Kopie, automatische Umwandlung) – beim Start und nach jeder Änderung. */
  async prefs() {
    if (!window.MTApp) return null;
    try { return await Native.json('videoPrefs', { limit: String(Set_.get('videoLimit') == null ? VideoCalc.VORGABE : Set_.get('videoLimit')), gallery: Set_.get('videoGallery') !== false, auto: !!Set_.get('videoAuto') }); }
    catch (e) { return null; }
  },
  async poll() {
    if (!window.MTApp) return null;
    let st;
    try { st = await Native.json('videoStatus'); } catch (e) { return null; }
    Videos.state = st;
    const done = st.done || [];
    for (const d of done) {
      if (!d.ok) continue;
      const p = await DB.get('photos', d.id);
      if (p) { if (d.w) p.w = d.w; if (d.h) p.h = d.h; if (d.dur) p.dur = d.dur; p.h264 = true; await DB.put('photos', p); }
    }
    if (done.length) {
      window.dispatchEvent(new CustomEvent('video-converted', { detail: done }));
      if (Videos.bulk) Videos.bulk.push(...done);
      else {
        const ok = done.filter(d => d.ok).length, bad = done.filter(d => !d.ok && !d.cancel && !d.skip);
        if (bad.length) toast('Video konnte nicht umgewandelt werden (' + (bad[0].msg || 'Fehler') + '). Es bleibt erhalten und lässt sich in der Video-App öffnen.', 7000);
        else if (ok) toast(ok === 1 ? 'Video fertig' : ok + ' Videos fertig', 4000);
        else if (done.some(d => d.cancel)) toast('Umwandlung abgebrochen – das Original ist unverändert.', 4000);
      }
      if (done.some(d => d.ok)) window.dispatchEvent(new Event('photos-changed'));
    }
    if (st.running && !Videos._said && !Videos.bulk) toast('Video wird umgewandelt …', 4000);
    Videos._said = !!st.running;
    window.dispatchEvent(new CustomEvent('video-state', { detail: st }));
    return st;
  },
  /** „Vorhandene Videos umwandeln“: zählen, nachfragen, nacheinander umwandeln (Fortschritt „2 von 5“, Abbrechen). */
  async alle() {
    let sc;
    try { sc = await Native.json('videoScan'); } catch (e) { toast(e.message, 5000); return; }
    if (!sc.n) { toast(sc.all ? 'Alle Videos spielen schon ab – nichts umzuwandeln.' : 'Keine Videos vorhanden.', 5000); return; }
    const txt = (sc.n === 1 ? '1 Video ist' : sc.n + ' Videos sind') + ' im Format HEVC gespeichert, das die Ansicht in der App oft nicht abspielt. '
      + 'Sie werden nacheinander auf dem Handy in H.264 umgewandelt. Das dauert je Video etwa so lange wie das Video selbst oder länger und braucht Akku – am besten am Ladegerät. '
      + 'Das Original wird erst ersetzt, wenn die Umwandlung geklappt hat.';
    if (!await confirmBox('Videos umwandeln?', txt, 'Umwandeln')) return;
    let r;
    try { r = await Native.json('videoConvert', { ids: sc.ids }); } catch (e) { toast('Umwandeln nicht möglich: ' + e.message, 6000); return; }
    if (!r.hevc) { toast('Nichts umzuwandeln.', 4000); return; }
    return Videos.follow();
  },
  /** Fortschrittsblatt, bis nichts mehr läuft; danach eine Zusammenfassung. Schließen des Blatts bricht nicht ab. */
  follow() {
    Videos.bulk = [];
    const bar = h('div', { class: 'prog' }, h('i')), txt = h('p', { id: 'vc-txt' }, 'Wird gestartet …');
    const stop = h('button', { class: 'btn', id: 'vc-stop', onclick: async e => { e.currentTarget.disabled = true; e.currentTarget.textContent = 'Wird abgebrochen …'; try { await Native.call('videoCancel'); } catch (x) { /* egal */ } Videos.poll(); } }, 'Abbrechen');
    let fertig = false, timer = null;
    return new Promise(res => {
      const ende = () => {
        if (fertig) return; fertig = true; clearInterval(timer); window.removeEventListener('video-state', upd);
        const l = Videos.bulk || []; Videos.bulk = null;
        const ok = l.filter(d => d.ok).length, bad = l.filter(d => !d.ok && !d.cancel && !d.skip).length, ab = l.some(d => d.cancel);
        if (l.length) toast((ok === 1 ? '1 Video umgewandelt' : ok + ' Videos umgewandelt') + (bad ? ' · ' + bad + ' nicht möglich (bleiben erhalten)' : '') + (ab ? ' · abgebrochen' : ''), 6000);
        res(l);
      };
      const s = sheet('Videos umwandeln', h('div', null, txt, bar,
        h('p', { class: 'muted small' }, 'Läuft im Hintergrund weiter, auch wenn du die App verlässt (siehe Benachrichtigung). Schließen bricht nicht ab.'),
        h('div', { class: 'row end' }, stop)), { onclose: () => { if (!fertig) { fertig = true; clearInterval(timer); window.removeEventListener('video-state', upd); Videos.bulk = null; res(null); } } });
      function upd(e) {
        const st = e.detail; if (fertig || !st) return;
        if (!st.running) { ende(); s.close(); return; }
        const n = Math.max(1, st.n || 1), i = Math.max(1, st.i || 1);
        txt.textContent = `${i} von ${n}` + (st.pct ? ' · ' + st.pct + ' %' : '');
        bar.firstChild.style.width = Math.min(100, ((i - 1) + (st.pct || 0) / 100) / n * 100) + '%';
      }
      window.addEventListener('video-state', upd);
      timer = setInterval(() => Videos.poll(), 1500);      // falls ein Ereignis der Hülle ausbleibt
      Videos.poll();
    });
  },
};
/* 2.12.0: Arbeiten an vorhandenen Videos in der Hülle (VideoJob: Zuschneiden, Galerie-Kopie) – Fortschrittsblatt, bis der Lauf fertig ist. */
const VideoJobUI = {
  /** Folgt dem Lauf (Native 'videoJob') in einem Blatt mit Balken und „Abbrechen“; gibt den Endstand zurück. text(j) → Zeile. Schließen bricht nicht ab. */
  follow(title, text) {
    const bar = h('div', { class: 'prog' }, h('i')), txt = h('p', { id: 'vj-txt' }, 'Wird gestartet …');
    const stop = h('button', { class: 'btn', id: 'vj-stop', onclick: async e => { e.currentTarget.disabled = true; e.currentTarget.textContent = 'Wird abgebrochen …'; try { await Native.call('videoJobCancel'); } catch (x) { /* egal */ } } }, 'Abbrechen');
    return new Promise(res => {
      let fertig = false, timer = null, offen = true;
      const s = sheet(title, h('div', null, txt, bar, h('p', { class: 'muted small' }, 'Läuft im Hintergrund weiter, auch wenn du die App verlässt (siehe Benachrichtigung). Schließen bricht nicht ab.'),
        h('div', { class: 'row end' }, stop)), { onclose: () => { offen = false; } });
      const tick = async () => {
        let j;
        try { j = await Native.json('videoJob'); } catch (e) { j = null; }
        if (fertig) return;
        if (!j || !j.running) { fertig = true; clearInterval(timer); if (offen) s.close(); res(j || { error: 'Kein Stand von der App' }); return; }
        txt.textContent = text(j);
        bar.firstChild.style.width = Math.max(0, Math.min(100, +j.pct || 0)) + '%';
      };
      timer = setInterval(tick, 700); tick();
    });
  },
  belegt: 'Es läuft gerade schon eine andere längere Arbeit (Medien-Sicherung, Offline-Karte oder ein Video). Bitte danach noch einmal.',
};

/* 2.12.0: Video zuschneiden ohne Neu-Kodierung. Anfang immer an einem Schlüsselbild (ehrlich angezeigt), Ende genau; als neues Video (Vorgabe)
   oder anstelle des Originals (mit Rückfrage). Vorschau: Bild am wirklichen Schnitt und am Ende (Hülle: 'videoFrame'). Rechnung: VideoCalc. */
const VideoTrim = {
  async open(p, onDone) {
    if (!window.MTApp) { toast('Zuschneiden geht nur in der Android-App.'); return; }
    let k;
    try { k = await Native.json('videoKeys', { id: p.id }); } catch (e) { toast('Das Video lässt sich nicht lesen (' + e.message + ').', 6000); return; }
    const dur = +k.dur || +p.dur || 0, keys = (k.keys || []).map(Number).sort((a, b) => a - b);
    if (dur < 2000) { toast('Das Video ist zu kurz zum Zuschneiden.', 5000); return; }
    const st = { a: 0, e: dur, ersetzen: false };
    const rA = h('input', { type: 'range', id: 'vt-a', min: 0, max: dur, step: 100, value: 0, 'aria-label': 'Anfang' });
    const rE = h('input', { type: 'range', id: 'vt-e', min: 0, max: dur, step: 100, value: dur, 'aria-label': 'Ende' });
    const tA = h('input', { type: 'text', id: 'vt-at', inputmode: 'decimal', autocapitalize: 'off', value: VideoCalc.zeitText(0) });
    const tE = h('input', { type: 'text', id: 'vt-et', inputmode: 'decimal', autocapitalize: 'off', value: VideoCalc.zeitText(dur) });
    const fA = h('img', { alt: 'Bild am Schnitt', class: 'vt-f', id: 'vt-fa' }), fE = h('img', { alt: 'Bild am Ende', class: 'vt-f', id: 'vt-fe' });
    const info = h('p', { id: 'vt-info', role: 'status' }), warn = h('p', { class: 'err', id: 'vt-warn' });
    const art = h('div', { class: 'chips', id: 'vt-art' });
    const go = h('button', { class: 'btn pri', id: 'vt-go', onclick: () => los() }, 'Zuschneiden');
    let frameT = null;
    // Auswahl bleibt dieselben zwei Knöpfe (ein Neuaufbau während eines Tipps – z. B. durch „change“ beim Verlassen eines Zeitfelds – verschluckte sonst den Tipp)
    const cNeu = UI.chip('Als neues Video', true, () => { st.ersetzen = false; setArt(); }, { id: 'vt-neu' }), cErs = UI.chip('Original ersetzen', false, () => { st.ersetzen = true; setArt(); }, { id: 'vt-ers' });
    art.append(cNeu, cErs);
    function setArt() {
      cNeu.classList.toggle('on', !st.ersetzen); cNeu.setAttribute('aria-pressed', String(!st.ersetzen));
      cErs.classList.toggle('on', st.ersetzen); cErs.setAttribute('aria-pressed', String(st.ersetzen));
      go.textContent = st.ersetzen ? 'Zuschneiden und ersetzen' : 'Zuschneiden als neues Video';
    }
    const snapA = () => VideoCalc.schnittStart(keys, st.a), endE = () => VideoCalc.schnittEnde(dur, st.e);
    function bild(img, ms, exact) {
      Native.json('videoFrame', { id: p.id, ms, exact }).then(r => { if (r && r.url) img.src = r.url; }, () => { img.removeAttribute('src'); });
    }
    function zeichne(quelle) {
      const a = snapA(), e = endE(), okS = VideoCalc.schnittOk(a, e, dur);
      if (quelle !== 'a') tA.value = VideoCalc.zeitText(st.a);
      if (quelle !== 'e') tE.value = VideoCalc.zeitText(st.e);
      rA.value = st.a; rE.value = st.e;
      info.textContent = 'Schnitt bei ' + VideoCalc.zeitText(a) + (a !== st.a ? ' (nächstes Schlüsselbild davor)' : a ? ' (Schlüsselbild)' : ' (Anfang)') + ' · Ende bei ' + VideoCalc.zeitText(e) + ' · neue Länge ' + VideoCalc.zeitText(Math.max(0, e - a));
      warn.textContent = okS ? '' : e - a < VideoCalc.SCHNITT_MIN_MS || e <= a ? 'Der Ausschnitt muss mindestens 1 Sekunde lang sein.' : 'Nichts weggeschnitten – Anfang oder Ende verschieben.';
      go.disabled = !okS;
      setArt();
      clearTimeout(frameT);
      frameT = setTimeout(() => { bild(fA, a, false); bild(fE, Math.max(0, e - 50), true); }, 250);      // nicht bei jeder Reglerbewegung ein Bild holen
    }
    rA.oninput = () => { st.a = Math.min(+rA.value, dur); zeichne(); };
    rE.oninput = () => { st.e = Math.min(+rE.value, dur); zeichne(); };
    tA.onchange = () => { const v = VideoCalc.zeitLesen(tA.value); if (v == null) { toast('Zeit bitte als Minuten:Sekunden, z. B. 0:03,2'); tA.value = VideoCalc.zeitText(st.a); return; } st.a = Math.min(v, dur); zeichne(); };
    tE.onchange = () => { const v = VideoCalc.zeitLesen(tE.value); if (v == null) { toast('Zeit bitte als Minuten:Sekunden, z. B. 0:12,0'); tE.value = VideoCalc.zeitText(st.e); return; } st.e = Math.min(v, dur); zeichne(); };
    const s = sheet('Video zuschneiden', h('div', { class: 'vtrim' },
      h('div', { class: 'vt-fs' }, h('figure', null, fA, h('figcaption', null, 'Anfang')), h('figure', null, fE, h('figcaption', null, 'Ende'))),
      h('label', { class: 'fld' }, 'Anfang', rA), h('label', { class: 'fld' }, 'Ende', rE),
      h('div', { class: 'vt-ts' }, h('label', { class: 'fld' }, 'Anfang (m:ss,z)', tA), h('label', { class: 'fld' }, 'Ende (m:ss,z)', tE)),
      info, warn,
      h('p', { class: 'muted small' }, 'Ohne Neu-Kodierung: Bild und Ton bleiben in der Qualität des Originals, und es geht schnell. Dafür kann der Anfang nur an einem Schlüsselbild liegen (bei Handy-Videos meist alle ein bis zwei Sekunden) – die App nimmt das letzte davor. Das Ende ist genau.'),
      art, h('div', { class: 'row end wrap' }, h('button', { class: 'btn', onclick: () => s.close() }, 'Abbrechen'), go)));
    zeichne();
    async function los() {
      const a = snapA(), e = endE();
      if (!VideoCalc.schnittOk(a, e, dur)) return;
      if (st.ersetzen && !await confirmBox('Original ersetzen?', 'Das Video wird durch den Ausschnitt ' + VideoCalc.zeitText(a) + '–' + VideoCalc.zeitText(e) + ' ersetzt. Der Rest ist danach weg (eine Kopie in der Galerie bleibt, falls es eine gibt).', 'Ersetzen')) return;
      let r;
      try { r = await Native.json('videoTrim', { id: p.id, startMs: a, endMs: e, replace: st.ersetzen }); }
      catch (x) { toast('Zuschneiden nicht möglich: ' + x.message, 7000); return; }
      if (!r || !r.started) { toast(VideoJobUI.belegt, 6000); return; }
      s.close();
      const j = await VideoJobUI.follow('Video zuschneiden', q => 'Wird zugeschnitten … ' + (+q.pct || 0) + ' %');
      const res = j && j.result;
      if (j && j.cancelled) { toast('Zuschneiden abgebrochen – das Original ist unverändert.', 5000); return; }
      if (!res || !res.ok) { toast('Zuschneiden hat nicht geklappt (' + ((j && j.error) || 'Fehler') + '). Das Original ist unverändert.', 7000); return; }
      const orig = await DB.get('photos', p.id) || p;
      if (res.replaced) {
        Object.assign(orig, { w: res.w || orig.w, h: res.h || orig.h, dur: res.dur || orig.dur, ts: orig.ts ? orig.ts + (+res.startMs || 0) : orig.ts, trimmed: true });
        await DB.put('photos', orig);
        toast('Zugeschnitten ✓ – das Original ist ersetzt.', 4000);
        window.dispatchEvent(new Event('photos-changed'));
        if (onDone) onDone(Object.assign({}, res, { ts: orig.ts }));
        return;
      }
      if (await DB.get('photos', res.id)) { toast('Diesen Ausschnitt gibt es schon.', 5000); return; }
      const neu = Object.assign({}, orig, { id: res.id, name: 'Video (zugeschnitten).mp4', ts: orig.ts ? orig.ts + (+res.startMs || 0) : 0, w: res.w || orig.w, h: res.h || orig.h, dur: res.dur || 0, trimOf: p.id, note: '' });
      await DB.put('photos', neu);
      toast('Zugeschnitten ✓ – als neues Video gespeichert, das Original bleibt.', 5000);
      window.dispatchEvent(new Event('photos-changed'));
      if (onDone) onDone(res, neu);
    }
  },
};

/* 2.12.0: Vorhandene Videos in die Galerie kopieren (Movies/Tourentagebuch, wie seit 2.9.0 bei neuen Aufnahmen; jedes nur einmal – Merkliste der Hülle). */
const VideoGalerie = {
  async stand() { try { return await Native.json('videoGalleryScan'); } catch (e) { return null; } },
  zeile(sc) {
    if (!sc) return 'Diese App-Version kann das noch nicht.';
    if (!sc.supported) return 'Erst ab Android 10 möglich.';
    if (!sc.all) return 'Keine Videos vorhanden.';
    return sc.n ? (sc.n === 1 ? '1 Video noch nicht in der Galerie' : sc.n + ' Videos noch nicht in der Galerie') : 'Alle Videos sind schon in der Galerie.';
  },
  async kopieren(after) {
    const sc = await VideoGalerie.stand();
    if (!sc || !sc.supported || !sc.n) { toast(VideoGalerie.zeile(sc), 5000); return; }
    if (!await confirmBox('Videos in die Galerie kopieren?', (sc.n === 1 ? '1 Video wird' : sc.n + ' Videos werden') + ' in den Ordner „Movies/Tourentagebuch“ kopiert. Sie bleiben auch in der App. Schon kopierte werden übersprungen. Das braucht Speicherplatz in der Größe der Videos.', 'Kopieren')) return;
    const items = [];
    for (const id of sc.ids) { const p = await DB.get('photos', id).catch(() => null); items.push({ id, ts: p && p.ts ? p.ts : 0 }); }
    let r;
    try { r = await Native.json('videoGalleryCopy', { items }); } catch (e) { toast(e.message, 6000); return; }
    if (!r || !r.started) { toast(VideoJobUI.belegt, 6000); return; }
    const j = await VideoJobUI.follow('Videos in die Galerie', q => Math.min(q.total, (q.done || 0) + 1) + ' von ' + q.total);
    const res = (j && j.result) || {}, ok = +res.ok || 0, bad = +res.bad || 0;
    toast((ok === 1 ? '1 Video in die Galerie kopiert' : ok + ' Videos in die Galerie kopiert') + (bad ? ' · ' + bad + ' nicht möglich (' + (res.msg || 'Fehler') + ')' : '') + (j && (j.cancelled || res.cancelled) ? ' · abgebrochen' : '') + (j && j.error ? ' · ' + j.error : ''), 6000);
    if (after) after();
  },
};

/* 2.12.0: „Orte aus der Tour ergänzen“ – Fotos/Videos ohne eigenen GPS-Ort (oder mit falscher Kamera-Uhr) bekommen den Ort der Tourspur zur
   Aufnahmezeit. Uhrzeit-Verschiebung mit Vorschau am Beispielfoto, Toleranz um das Zeitfenster (Vorgabe ±10 min, Einstellung „fotoOrtTol“),
   Übernahme erst nach Bestätigung, ein Schritt zurück (alte Werte in kv „fotoOrtUndo:<Tour>“). Rechnung: js/calc-fotoort.js. */
const FotoOrt = {
  undoKey: id => 'fotoOrtUndo:' + id,
  async kandidaten(t) { return FotoOrtCalc.kandidaten(await DB.all('photos'), t); },
  async open(t, pts, after) {
    const fotos = await FotoOrt.kandidaten(t), undo = await DB.kvGet(FotoOrt.undoKey(t.id), null);
    if (!fotos.length && !undo) { toast('Alle Fotos dieser Tour haben schon einen eigenen Ort.', 5000); return; }
    const sp = FotoOrtCalc.spur(pts);
    if (sp.p.length < 2) { toast('Die Spur dieser Tour hat keine Uhrzeiten – Orte lassen sich nicht aus der Zeit berechnen.', 6000); return; }
    const tol0 = Set_.get('fotoOrtTol'), st = { vz: '+', std: 0, min: 0, tol: tol0 == null || tol0 === '' ? FotoOrtCalc.TOL_VORGABE : +tol0, bsp: 0 };
    const vz = h('select', { id: 'fo-vz', 'aria-label': 'Richtung der Verschiebung' }, h('option', { value: '+' }, 'später (+)'), h('option', { value: '-' }, 'früher (−)'));
    const std = h('input', { type: 'number', id: 'fo-std', min: 0, max: 48, step: 1, value: 0, inputmode: 'numeric', 'aria-label': 'Stunden' });
    const min = h('input', { type: 'number', id: 'fo-min', min: 0, max: 59, step: 1, value: 0, inputmode: 'numeric', 'aria-label': 'Minuten' });
    const tol = h('select', { id: 'fo-tol' }, FotoOrtCalc.TOLERANZEN.map(m => h('option', { value: m, selected: m === st.tol }, m ? '± ' + m + ' Minuten' : 'genau (ohne Toleranz)')));
    const bspImg = h('img', { alt: '', class: 'fo-th' }), bspTxt = h('p', { id: 'fo-bsp', role: 'status' }), sum = h('p', { class: 'muted small', id: 'fo-sum' });
    const list = h('div', { class: 'list', id: 'fo-list' }), raus = h('div', { id: 'fo-raus' });
    const okB = h('button', { class: 'btn pri', id: 'fo-ok', onclick: () => uebernehmen() }, 'Übernehmen');
    const undoB = undo ? h('button', { class: 'btn', id: 'fo-undo', onclick: () => rueck() }, 'Rückgängig') : null;
    const versatz = () => FotoOrtCalc.versatz(st.vz, st.std, st.min);
    let v = null;
    const nr = p => fotos.indexOf(p) + 1, art = p => p.video ? 'Video' : 'Foto';
    const uhr = ms => F.time(ms) + ' Uhr';
    function rechne() {
      v = FotoOrtCalc.vorschlag(fotos, sp, { versatz: versatz(), tolMin: st.tol });
      const byId = Object.fromEntries(v.treffer.map(x => [x.id, x])), aus = Object.fromEntries(v.ausserhalb.map(x => [x.id, x]));
      const b = fotos[Math.min(st.bsp, fotos.length - 1)];
      if (b) {
        bspImg.src = Photos.thumb(b.id);
        const tr = byId[b.id], a = aus[b.id];
        bspTxt.textContent = tr ? FotoOrtCalc.beispiel(nr(b), tr.km, b.video) + ' (' + uhr(tr.zeit) + (tr.rand ? (tr.rand === 'vor' ? ', kurz vor dem Start' : ', kurz nach dem Ende') : '') + ')'
          : a ? art(b) + ' ' + nr(b) + ' liegt dann außerhalb der Tour (' + FotoOrtCalc.abstandText(a) + ')' : art(b) + ' ' + nr(b) + ' hat keine Aufnahmezeit';
      } else bspTxt.textContent = 'Keine Fotos ohne Ort mehr.';
      sum.textContent = fotos.length ? FotoOrtCalc.zusammenfassung(v) + (versatz() ? ' · Uhrzeit ' + FotoOrtCalc.versatzText(versatz()) : '') : '';
      list.innerHTML = '';
      fotos.forEach((p, i) => {
        const tr = byId[p.id], a = aus[p.id];
        list.append(h('button', { class: 'li' + (i === st.bsp ? ' on' : ''), 'aria-pressed': i === st.bsp ? 'true' : 'false', 'data-id': p.id, onclick: () => { st.bsp = i; rechne(); } },
          h('span', { class: 'li-i cov' }, h('img', { src: Photos.thumb(p.id), alt: '', loading: 'lazy' })),
          h('span', { class: 'li-t' }, h('b', null, art(p) + ' ' + (i + 1) + (p.ts ? ' · ' + F.time(p.ts) + ' Uhr' : '')),
            h('small', null, tr ? 'km ' + FotoOrtCalc.kmText(tr.km) + (p.lat != null ? ' (bisher berechnet)' : '') : a ? 'nicht zugeordnet: ' + FotoOrtCalc.abstandText(a) : 'ohne Aufnahmezeit'))));
      });
      okB.disabled = !v.treffer.length;
    }
    vz.onchange = () => { st.vz = vz.value; rechne(); };
    std.oninput = () => { st.std = std.value; rechne(); };
    min.oninput = () => { st.min = min.value; rechne(); };
    tol.onchange = async () => { st.tol = +tol.value; await Set_.set('fotoOrtTol', st.tol); rechne(); };
    const schnell = (txt, d) => h('button', { class: 'chip', onclick: () => {
      const cur = versatz() + d * 3600000, a = Math.abs(cur);
      st.vz = cur < 0 ? '-' : '+'; st.std = Math.floor(a / 3600000); st.min = Math.round((a % 3600000) / 60000);
      vz.value = st.vz; std.value = st.std; min.value = st.min; rechne();
    } }, txt);
    const s = sheet('Orte aus der Tour ergänzen', h('div', { class: 'fotoort' },
      h('p', { class: 'muted small' }, 'Für Fotos und Videos ohne eigenen GPS-Ort berechnet die App den Ort aus der Aufnahmezeit und der Spur dieser Tour. Fotos mit eigenem Ort bleiben, wie sie sind.'),
      h('div', { class: 'fld' }, 'Uhrzeit-Verschiebung (falls die Kamera-Uhr falsch ging)', h('div', { class: 'fo-vs' }, vz, h('label', { class: 'fo-n' }, std, h('span', null, 'Std.')), h('label', { class: 'fo-n' }, min, h('span', null, 'Min.')))),
      h('div', { class: 'chips wrap', id: 'fo-schnell' }, schnell('− 1 Stunde', -1), schnell('+ 1 Stunde', 1), h('button', { class: 'chip', onclick: () => { st.vz = '+'; st.std = 0; st.min = 0; vz.value = '+'; std.value = 0; min.value = 0; rechne(); } }, 'Keine')),
      h('p', { class: 'muted small' }, 'Tipp: Kamera noch auf Winterzeit? Dann „+ 1 Stunde“. Die Vorschau zeigt sofort, wo das Foto landet.'),
      h('label', { class: 'fld' }, 'Zeitfenster der Tour', tol),
      h('div', { class: 'fo-bsp' }, bspImg, bspTxt), sum, list, raus,
      h('p', { class: 'muted small' }, 'Fotos außerhalb des Zeitfensters werden nicht zugeordnet. Antippen wählt das Beispielfoto.'),
      h('div', { class: 'row end wrap' }, undoB, okB)));
    rechne();
    async function uebernehmen() {
      const n = v.treffer.length;
      if (!n) return;
      if (!await confirmBox('Orte übernehmen?', (n === 1 ? '1 Foto bekommt' : n + ' Fotos bekommen') + ' einen Ort aus der Tour' + (versatz() ? ' (Uhrzeit ' + FotoOrtCalc.versatzText(versatz()) + ')' : '') + '. Das lässt sich danach mit „Rückgängig“ in diesem Fenster zurücknehmen.', 'Übernehmen')) return;
      const byId = Object.fromEntries(fotos.map(p => [p.id, p])), alt = [], neu = [];
      for (const tr of v.treffer) { const p = await DB.get('photos', tr.id) || byId[tr.id]; alt.push(p); neu.push(FotoOrtCalc.anwenden(p, tr, t.id, versatz())); }
      await DB.kvSet(FotoOrt.undoKey(t.id), { ts: Date.now(), list: FotoOrtCalc.sichern(alt) });
      await DB.putMany('photos', neu);
      s.close();
      toast((n === 1 ? '1 Ort ergänzt' : n + ' Orte ergänzt') + ' – Rückgängig über „Orte aus der Tour ergänzen“.', 5000);
      window.dispatchEvent(new Event('photos-changed'));
      if (after) after();
    }
    async function rueck() {
      const u = await DB.kvGet(FotoOrt.undoKey(t.id), null);
      if (!u || !u.list) return;
      if (!await confirmBox('Rückgängig machen?', 'Die ' + (u.list.length === 1 ? 'eine ergänzte Position wird' : u.list.length + ' ergänzten Positionen werden') + ' zurückgenommen; die Fotos haben wieder ihre alten Werte.', 'Rückgängig')) return;
      const neu = [];
      for (const a of u.list) { const p = await DB.get('photos', a.id); if (p) neu.push(FotoOrtCalc.zurueck(p, a)); }
      if (neu.length) await DB.putMany('photos', neu);
      await DB.del('kv', FotoOrt.undoKey(t.id));
      s.close();
      toast('Zurückgenommen.', 4000);
      window.dispatchEvent(new Event('photos-changed'));
      if (after) after();
    }
  },
};
async function pickTour() {
  const ts = (await Tours.list()).filter(t => t.status !== 'planned');
  return new Promise(res => {
    let done = false;
    const s = sheet('Tour wählen', h('div', { class: 'list menu' }, h('button', { class: 'li', onclick: () => { done = true; s.close(); res(null); } }, h('span', { class: 'li-t' }, h('b', null, 'Keine Tour'))),
      ts.slice(0, 120).map(t => h('button', { class: 'li', onclick: () => { done = true; s.close(); res(t); } }, h('span', { class: 'li-i' }, Sports.icon(t.sport)), h('span', { class: 'li-t' }, h('b', null, t.name), h('small', null, F.date(t.start)))))), { onclose: () => { if (!done) res(undefined); } });
  });
}

const PhotoSources = {
  /** Fortschrittsdialog. Läuft als Vordergrunddienst weiter, wenn die App in den Hintergrund geht.
      opts.cancel (Funktion): zeigt „Abbrechen“; der Vorgang hört dann an der nächsten passenden Stelle auf. */
  async progress(title, fn, opts) {
    const bar = h('div', { class: 'prog' }, h('i')), txt = h('p', null, 'Bitte warten …');
    const stopBtn = opts && opts.cancel ? h('button', { class: 'btn', id: 'prog-stop', onclick: e => { e.currentTarget.disabled = true; e.currentTarget.textContent = 'Wird abgebrochen …'; opts.cancel(); } }, 'Abbrechen') : null;
    const s = sheet(title, h('div', null, txt, bar, h('p', { class: 'muted small' }, opts && opts.note != null ? opts.note : 'Du kannst die App währenddessen verlassen – der Vorgang läuft im Hintergrund weiter (siehe Benachrichtigung).'),
      stopBtn ? h('div', { class: 'row end' }, stopBtn) : null));
    let last = 0, lastText = '';
    appSync('bgStart', title, 'Wird gestartet …', 0, 0);
    const upd = (i, n, t, full) => {      // full: fertiger Text (z. B. „Komoot · 3 von 40“ bei Alles abgleichen); i/n dann ein Anteil
      bar.firstChild.style.width = (i / n * 100) + '%'; lastText = full || `${i} von ${n}` + (t ? ' · ' + t : ''); txt.textContent = lastText;
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
    const run = async fn => { s.close(); try { const s0 = Photos.skipCount, n = await fn(); if (n != null) toast(FotoDoppeltCalc.importText(n, Photos.skipCount - s0), 4000); window.dispatchEvent(new Event('photos-changed')); if (done) await done(); } catch (e) { toast(e.message, 6000); } };
    const it = (ico, t, sub, fn) => h('button', { class: 'li', onclick: () => run(fn) }, h('span', { class: 'li-i' }, ico), h('span', { class: 'li-t' }, h('b', null, t), h('small', null, sub)));
    const s = sheet('Fotos hinzufügen', h('div', null, h('div', { class: 'list menu' },
      it('🖼️', 'Aus der Galerie wählen', 'Einzelne Fotos auswählen', async () => { const m = await Native.json('pickPhotos'); return Photos.addMeta(m); }),
      tour ? it('✨', 'Passende Fotos automatisch finden', 'Galerie nach Aufnahmezeit dieser Tour durchsuchen', () => PhotoSources.galleryForTours([tour])) : it('✨', 'Passende Fotos zu allen Touren finden', 'Galerie nach Aufnahmezeit durchsuchen', async () => PhotoSources.galleryForTours((await Tours.list()).filter(t => t.status !== 'planned' && t.timed))),
      it('📁', 'Ordner auf dem Handy', 'z. B. Kamera-Ordner, Syncthing, Cloud-Ordner', () => PhotoSources.folder()),
      it('💻', 'Vom Rechner im WLAN', 'Mac oder PC: Adresse im Browser öffnen, Fotos hineinziehen', () => { PhotoSources.receive(done); return null; }),
      it('🖧', 'Netzwerkfreigabe (SMB)', 'NAS, Fritz!Box, Windows-Freigabe', () => { PhotoSources.smb(); return null; }),
      it('☁️', 'Nextcloud / WebDAV', 'Fotos von deinem Server', () => { PhotoSources.webdav(); return null; })),
      // 2.14.0: gilt für alle Wege oben; gleiche Kennung (byte-gleiche Datei) wird immer übersprungen
      h('div', { class: 'ps-dup' }, UI.toggle('Schon vorhandene Fotos überspringen', Set_.get('fotoSkipDup') !== false, v => Set_.set('fotoSkipDup', !!v), { id: 'ps-skipdup' }),
        h('p', { class: 'muted small' }, 'Erkennt dieselbe Datei – auch von einem anderen Rechner oder Weg – und dasselbe Foto mit gleichem Namen, gleicher Aufnahmezeit und Größe.'))));
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
    const s0 = Photos.skipCount, skip = () => Photos.skipCount - s0;
    const cnt = h('p', { class: 'recvcnt' }, ''), box = h('div', null, h('p', { class: 'muted' }, 'Starte …'));
    const s = sheet('Vom Rechner empfangen', box, { onclose: async () => {
      closed = true; clearInterval(timer); try { await Native.json('uploadStop'); } catch (e) { /* egal */ }
      if (total || skip()) { toast(FotoDoppeltCalc.importText(total, skip()), 4000); window.dispatchEvent(new Event('photos-changed')); }
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
        cnt.textContent = total || skip() ? FotoDoppeltCalc.importText(total, skip(), 'empfangen') + (r.failed ? ' · ' + r.failed + ' nicht lesbar' : '') : (r.failed ? r.failed + ' Datei(en) nicht lesbar' : 'Wartet auf Fotos …');
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
      s.close(); let n = 0; const s0 = Photos.skipCount;
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
        toast(FotoDoppeltCalc.importText(n, Photos.skipCount - s0), 4000); window.dispatchEvent(new Event('photos-changed'));
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
    [['all', `Alle (${all.length})`], ['free', `Ohne Tour (${all.filter(p => !p.tour).length})`], ['map', 'Karte']].forEach(([k, l]) => seg.append(h('button', { class: mode === k ? 'on' : '', 'aria-pressed': mode === k ? 'true' : 'false', onclick: () => { mode = k; draw(); } }, l)));
    if (map) { map.remove(); map = null; }
    body.innerHTML = '';
    const list = (mode === 'free' ? all.filter(p => !p.tour) : all).slice().reverse();
    if (!all.length) { body.append(UI.empty({ icon: 'photo', title: 'Noch keine Fotos', text: 'Hol Fotos aus der Galerie, einem Ordner, vom NAS oder aus Nextcloud. Die App ordnet sie über die Aufnahmezeit der passenden Tour zu und zeigt sie auf der Karte.', actions: [h('button', { class: 'btn pri', onclick: () => PhotoSources.sheet(null, null) }, 'Fotos hinzufügen')] })); return; }
    if (mode === 'map') {
      const el = h('div', { class: 'map full' }); body.append(el);
      map = MapKit.create(el);
      const g = L.layerGroup().addTo(map), withPos = all.filter(p => p.lat != null);
      withPos.forEach(p => MapKit.photoMarker(p, () => Lightbox.open(all, all.indexOf(p))).addTo(g));
      if (withPos.length) map.fitBounds(L.latLngBounds(withPos.map(p => [p.lat, p.lon])), { padding: [30, 30], maxZoom: 14 });
      setTimeout(() => { try { if (map.getContainer().isConnected) map.invalidateSize(); } catch (e) { /* Ansicht schon verlassen */ } }, 150);
      return;
    }
    if (!list.length) { body.append(UI.empty({ icon: 'check', title: 'Alles zugeordnet', text: 'Jedes Foto gehört zu einer Tour.' })); return; }
    let last = '';
    let grid = null;
    list.forEach(p => {
      const day = p.ts ? F.date(p.ts) : 'Ohne Datum';
      if (day !== last) { last = day; body.append(h('h3', { class: 'month' }, day)); grid = h('div', { class: 'pgrid' }); body.append(grid); }
      const pano = PanoCalc.ist(p);
      grid.append(h('button', { class: 'pt', 'aria-label': p.video ? VideoCalc.dauerText(p.dur) + ' öffnen' : pano ? 'Panorama öffnen' : 'Foto öffnen', onclick: () => Lightbox.open(list, list.indexOf(p)) }, h('img', { src: Photos.thumb(p.id), alt: '', loading: 'lazy' }),
        pano ? h('b', { class: 'pt-pano', title: 'Panorama', html: Ico.svg('pano', 16) }) : null, UI.vidMark(p), p.lat != null ? null : h('i', { title: 'ohne Position' }, '∅')));
    });
  };
  const re = () => draw(); window.addEventListener('photos-changed', re);
  await draw();
  return () => { window.removeEventListener('photos-changed', re); if (map) map.remove(); };
};

Views['/sources'] = async root => {
  const body = h('div', { class: 'pad' });
  root.append(topbar('Foto-Quellen', { back: true }), body);
  const folders = await DB.kvGet('photoFolders', []);
  body.append(h('p', { class: 'muted' }, 'Fotos werden verkleinert (max. 2400 Pixel) in den privaten Speicher der App kopiert. Originale bleiben unverändert.'),
    h('div', { class: 'list' },
      h('button', { class: 'li', onclick: () => PhotoSources.sheet(null, null) }, h('span', { class: 'li-i' }, '＋'), h('span', { class: 'li-t' }, h('b', null, 'Fotos hinzufügen'), h('small', null, 'Galerie, Ordner, SMB, Nextcloud'))),
      h('button', { class: 'li', onclick: async () => { try { const s0 = Photos.skipCount, n = await PhotoSources.scanFolders(), sk = Photos.skipCount - s0; toast(n + ' neue Foto(s)' + (sk ? ' · ' + sk + ' schon vorhanden, übersprungen' : '')); } catch (e) { toast(e.message); } } }, h('span', { class: 'li-i' }, '🔄'), h('span', { class: 'li-t' }, h('b', null, 'Gemerkte Ordner jetzt einlesen'), h('small', null, folders.length ? folders.map(f => decodeURIComponent(f.name)).join(', ') : 'Noch keine Ordner gemerkt'))),
      h('a', { class: 'li', id: 'src-dup', href: '#/fotodoppelt' }, h('span', { class: 'li-i', html: Ico.svg('swap', 20) }), h('span', { class: 'li-t' }, h('b', null, 'Doppelte Fotos suchen'), h('small', null, 'Gleiche Fotos und Videos finden und aufräumen'))),
      window.MTApp ? h('button', { class: 'li', id: 'src-vconv', onclick: () => Videos.alle() }, h('span', { class: 'li-i' }, '🎬'), h('span', { class: 'li-t' }, h('b', null, 'Vorhandene Videos umwandeln'), h('small', null, 'HEVC-Videos in H.264, damit sie hier abspielen'))) : null));
  // 2.9.0: Speicher getrennt nach Fotos und Videos; darunter die Videos einzeln (antippen = ansehen, Papierkorb = löschen)
  const sto = VideoCalc.speicher(await Native.json('storage').catch(() => null));
  if (sto) body.append(h('div', { id: 'src-sto' }, UI.facts([['Fotos', sto.fotos + ' · ' + F.size(sto.fotoBytes)],
    sto.videos != null ? ['Videos', sto.videos + ' · ' + F.size(sto.videoBytes)] : null, ['Zusammen belegt', F.size(sto.bytes)]])));
  const vids = (await Photos.all()).filter(p => p.video).sort((a, b) => (b.ts || 0) - (a.ts || 0));
  if (vids.length) {
    const tours = Object.fromEntries((await Tours.list()).map(t => [t.id, t]));
    vids.forEach(p => { p.tourName = p.tour && tours[p.tour] ? tours[p.tour].name : ''; });
    const zeile = (p, k) => h('div', { class: 'li', id: 'src-v-' + p.id },
      h('button', { class: 'li-i cov vthumb', 'aria-label': VideoCalc.dauerText(p.dur) + ' ansehen', onclick: () => Lightbox.open(vids, k) }, h('img', { src: Photos.thumb(p.id), alt: '', loading: 'lazy' }), h('span', { class: 'vthumb-i', html: Ico.svg('play', 14) })),
      h('span', { class: 'li-t' }, h('b', null, p.ts ? F.date(p.ts) + ' · ' + F.time(p.ts) : 'Ohne Datum'),
        h('small', null, [VideoCalc.dauer(p.dur), sto && sto.vids[p.id] != null ? F.size(sto.vids[p.id]) : '', p.tourName].filter(Boolean).join(' · ') || 'Video')),
      h('button', { class: 'ico', 'aria-label': 'Video löschen', title: 'Video löschen', onclick: async () => {
        if (!await confirmBox('Video löschen?', 'Das Video wird aus dem Tourentagebuch gelöscht: Datei, Vorschaubild und Eintrag. Eine Kopie in der Galerie bleibt, falls es eine gibt.', 'Löschen')) return;
        await Photos.remove(p.id); toast('Video gelöscht'); window.dispatchEvent(new Event('photos-changed')); Nav.render();
      } }, h('span', { html: Ico.svg('trash', 20) })));
    body.append(h('h3', { id: 'src-vh' }, 'Videos (' + vids.length + ')'), h('div', { class: 'list', id: 'src-vlist' }, vids.slice(0, 200).map(zeile)),
      vids.length > 200 ? h('p', { class: 'muted small' }, 'Die ältesten ' + (vids.length - 200) + ' Videos stehen im Fotoraster.') : null);
  }
  if (folders.length) body.append(h('h3', null, 'Gemerkte Ordner'), h('div', { class: 'list' }, folders.map((f, i) => h('div', { class: 'li' }, h('span', { class: 'li-i' }, '📁'), h('span', { class: 'li-t' }, h('b', null, decodeURIComponent(f.name))), h('button', { class: 'ico', 'aria-label': 'Entfernen', onclick: async () => { folders.splice(i, 1); await DB.kvSet('photoFolders', folders); Nav.render(); } }, '✕')))));
};
