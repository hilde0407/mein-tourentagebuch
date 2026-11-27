'use strict';
/* 2.17.0: 3D-Flug als Video – „Video erzeugen“ Bild für Bild, unabhängig davon, wie schnell das Handy live zeichnet.
   Für jedes Bild: Kamera genau auf die Zeit stellen (Flug.aktiv.stelleZeit), warten bis Karte und Gelände geladen sind (idle, mit Zeitlimit und
   Wiederholung), das fertige Kartenbild im render-Ereignis abgreifen, Einblendungen darüber (Flug.zeichne), an den Kodierer geben.
   Kodierer: WebCodecs (VideoEncoder) im WebView, wenn er die Größe mit Hardware schafft – dann bleibt jedes Bild im WebView und nur die fertige,
   kleine MP4 (js/calc-mp4.js) geht stückweise an die Hülle. Sonst „über Android“: jedes Bild als JPEG an FlugVideo.java (MediaCodec).
   Die Karte wird dafür in einem eigenen Feld (720 CSS-Pixel kurze Seite) mit passendem pixelRatio gezeichnet – genau in Videogröße.
   Plan und Grenzen: FlugCalc.video (js/calc-flug.js). Kein Ton. */
const FlugVideo = {
  /** Zeitlimit je Versuch (ms) und Versuche, bis ein Bild auch mit fehlenden Kacheln genommen wird; Takt von Vorschau und Benachrichtigung. */
  GRENZEN: { zeitlimit: 8000, versuche: 2, vorschauMs: 700, dienstMs: 2000, jpeg: 0.92 },
  /** Prüfhaken für Tests: { protokoll: [] } – je Bild Zeit und Kamera der Karte. */
  test: null,
  laeuft: null,
};

FlugVideo.b64 = u8 => { let s = ''; for (let k = 0; k < u8.length; k += 8192) s += String.fromCharCode.apply(null, u8.subarray(k, k + 8192)); return btoa(s); };

/** Was kann dieses Gerät? WebCodecs, Hülle (Kodierer, freier Speicher, Arbeitsspeicher), WebGL-Grenzen. */
FlugVideo.faehig = async () => {
  const r = { webcodecs: typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined', nativ: null, glMax: null, freiMB: null, ramGB: null, galerie: '' };
  try {
    const c = document.createElement('canvas'), gl = c.getContext('webgl2') || c.getContext('webgl');
    if (gl) {
      const vp = gl.getParameter(gl.MAX_VIEWPORT_DIMS);
      r.glMax = Math.min(gl.getParameter(gl.MAX_RENDERBUFFER_SIZE), gl.getParameter(gl.MAX_TEXTURE_SIZE), vp ? Math.min(vp[0], vp[1]) : Infinity);
      const lo = gl.getExtension('WEBGL_lose_context'); if (lo) lo.loseContext();
    }
  } catch (e) { /* ohne Angabe */ }
  if (window.MTApp) {
    try {
      const i = await Native.json('flugVideoInfo', {});
      if (i && typeof i === 'object' && !Array.isArray(i)) { r.nativ = i; r.freiMB = i.freiMB != null ? i.freiMB : null; r.ramGB = i.ramGB || null; r.galerie = i.galerie || ''; }
    } catch (e) { /* alte Hülle */ }
  } else r.ramGB = navigator.deviceMemory || null;
  return r;
};

/** Grenzen für FlugCalc.video.pruefe aus den Fähigkeiten. */
FlugVideo.grenzen = (f, codec) => {
  const k = f.nativ && f.nativ[codec];
  return { encLang: k ? k.encLang || null : null, encKurz: k ? k.encKurz || null : null, glMax: f.glMax, freiMB: f.freiMB, ramGB: f.ramGB };
};

/** Kodierweg wählen: WebCodecs mit Hardware → über Android (MediaCodec) → WebCodecs ohne Hardware-Zusage. o = { w, h, fps, bitrate, codec, weg: 'auto' | 'android' }. */
FlugVideo.weg = async (o, f) => {
  const V = FlugCalc.video;
  const suche = async hw => {
    if (!f.webcodecs || o.weg === 'android') return null;
    const liste = o.codec === 'hevc' ? [V.hevcCodec(o.w, o.h, o.fps)] : ['high', 'main', 'base'].map(p => V.avcCodec(o.w, o.h, o.fps, o.bitrate, p));
    for (const codec of liste) {
      const c = { codec, width: o.w, height: o.h, bitrate: o.bitrate, framerate: o.fps, hardwareAcceleration: hw, latencyMode: 'quality', bitrateMode: 'variable' };
      if (o.codec === 'hevc') c.hevc = { format: 'hevc' }; else c.avc = { format: 'avc' };
      try { const r = await VideoEncoder.isConfigSupported(c); if (r && r.supported) return c; } catch (e) { /* nächste Kennung */ }
    }
    return null;
  };
  let c = await suche('prefer-hardware');
  if (c) return { art: 'webcodecs', cfg: c, hw: true };
  const k = window.MTApp && f.nativ && f.nativ[o.codec];
  if (k) return { art: 'android', hw: !!k.hw, name: k.name || '' };
  c = await suche('no-preference');
  if (c) return { art: 'webcodecs', cfg: c, hw: false };
  return null;
};

/** Ziel der fertigen MP4-Bytes: in der App stückweise (≤ 1 MB) in den Zwischenspeicher der Hülle, im Browser im Speicher. */
FlugVideo.senke = tmp => {
  const nativ = !!window.MTApp, teile = [];
  let kette = Promise.resolve(), erst = true, offen = [], offenN = 0, wartend = 0, fehler = null;
  const flush = () => {
    if (!offenN) return;
    const buf = new Uint8Array(offenN); let k = 0; for (const p of offen) { buf.set(p, k); k += p.length; }
    offen = []; offenN = 0; wartend += buf.length;
    const reset = erst; erst = false;
    kette = kette.then(() => Native.json('appendCache', { name: tmp, b64: FlugVideo.b64(buf), reset })).then(() => { wartend -= buf.length; }, e => { fehler = fehler || e; });
  };
  return {
    teile,
    /** Reihenfolge = Aufrufreihenfolge (das Einreihen geschieht sofort, nur das Warten bei vollem Puffer ist asynchron). */
    schreibe(b) {
      if (fehler) return Promise.reject(fehler);
      if (!nativ) { teile.push(b); return Promise.resolve(); }
      offen.push(b); offenN += b.length;
      if (offenN >= 1 << 20) flush();
      return wartend > 16 << 20 ? kette : Promise.resolve();
    },
    async fertig() { if (nativ) { flush(); await kette; } if (fehler) throw fehler; },
  };
};

/** Kodierer über WebCodecs + MP4-Verpackung in JS. */
FlugVideo.webKodierer = async (o, weg) => {
  const tmp = 'flugvideo-' + Date.now() + '.mp4', mx = Mp4.schreiber({ codec: o.codec, w: o.w, h: o.h, fps: o.fps }), s = FlugVideo.senke(tmp);
  let desc = null, err = null;
  await s.schreibe(mx.kopf());
  const enc = new VideoEncoder({
    output: (chunk, meta) => {
      try {
        const d = meta && meta.decoderConfig && meta.decoderConfig.description;
        if (d && !desc) desc = ArrayBuffer.isView(d) ? new Uint8Array(d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength)) : new Uint8Array(d.slice(0));
        const b = new Uint8Array(chunk.byteLength); chunk.copyTo(b);
        mx.probe(b.length, chunk.type === 'key', chunk.timestamp);
        s.schreibe(b).catch(e => { err = err || e; });
      } catch (e) { err = err || e; }
    },
    error: e => { err = err || e; },
  });
  enc.configure(weg.cfg);
  const keyAlle = o.fps * FlugCalc.video.VIDEO.KEY_S;
  return {
    art: 'webcodecs', hw: weg.hw, tmp, codec: weg.cfg.codec,
    async bild(canvas, i) {
      if (err) throw err;
      const f = new VideoFrame(canvas, { timestamp: FlugCalc.video.zeitUs(i, o.fps), duration: Math.round(1e6 / o.fps) });
      try { enc.encode(f, { keyFrame: i % keyAlle === 0 }); } finally { f.close(); }
      while (enc.encodeQueueSize > 2 && !err) await sleep(4);
      if (err) throw err;
    },
    async ende() {
      await enc.flush(); enc.close();
      if (err) throw err;
      const e = mx.ende(desc);
      await s.schreibe(e.moov); await s.fertig();
      if (window.MTApp) {
        const r = await Native.json('flugVideoSave', { tmp, name: o.name, patchAt: e.patchAt, patchB64: FlugVideo.b64(e.patch) });
        return Object.assign({ frames: e.bilder, dauerMs: e.dauerMs }, r);
      }
      s.teile[0] = s.teile[0].slice(); s.teile[0].set(e.patch, e.patchAt);
      const blob = new Blob(s.teile, { type: 'video/mp4' }); s.teile.length = 0;
      return { ok: true, name: o.name, bytes: blob.size, blob, frames: e.bilder, dauerMs: e.dauerMs };
    },
    async abbruch() {
      try { if (enc.state !== 'closed') enc.close(); } catch (e) { /* schon zu */ }
      s.teile.length = 0;
      if (window.MTApp) { try { await s.fertig(); } catch (e) { /* egal */ } try { await Native.call('flugVideoCancel', { tmp }); } catch (e) { /* egal */ } }
    },
  };
};

/** Bild als JPEG (Base64) – für den Weg über Android. */
FlugVideo.jpeg = (c, q) => new Promise((ok, no) => c.toBlob(b => {
  if (!b) return no(new Error('Bild ließ sich nicht lesen'));
  const fr = new FileReader(); fr.onload = () => ok(String(fr.result).split(',')[1]); fr.onerror = () => no(fr.error || new Error('Bild ließ sich nicht lesen')); fr.readAsDataURL(b);
}, 'image/jpeg', q));

/** Kodierer in der Hülle (MediaCodec). */
FlugVideo.androidKodierer = async (o, weg) => {
  const r = await Native.json('flugVideoStart', { w: o.w, h: o.h, fps: o.fps, bitrate: o.bitrate, codec: o.codec, name: o.name, frames: o.n, tour: o.titel });
  if (!r || r.ok === false) throw new Error((r && r.msg) || 'Der Video-Kodierer ließ sich nicht starten');
  return {
    art: 'android', hw: r.hw != null ? !!r.hw : weg.hw, codec: r.encoder || weg.name,
    async bild(canvas, i) { const b64 = await FlugVideo.jpeg(canvas, FlugVideo.GRENZEN.jpeg); await Native.json('flugVideoFrame', { i, b64 }); },
    ende: () => Native.json('flugVideoFinish', {}),
    async abbruch() { try { await Native.call('flugVideoCancel', {}); } catch (e) { /* egal */ } },
  };
};

/** Warten, bis die Karte fertig ist: idle (oder geladen nach Ablauf), je Versuch höchstens ms. false = mit Lücken weiter. */
FlugVideo.warte = async (m, ms, versuche) => {
  for (let k = 0; k < versuche; k++) {
    const ok = await new Promise(res => {
      let fertig = false, tm = null;
      const fin = v => { if (fertig) return; fertig = true; clearTimeout(tm); m.off('idle', beiIdle); res(v); };
      const beiIdle = () => fin(true);
      tm = setTimeout(() => { let v = false; try { v = m.loaded() && m.areTilesLoaded(); } catch (e) { /* nein */ } fin(v); }, ms);
      m.once('idle', beiIdle); m.triggerRepaint();
    });
    if (ok) return true;
  }
  return false;
};

/** Kartenbild abgreifen: im render-Ereignis ist die Zeichenfläche noch gefüllt (ohne preserveDrawingBuffer). */
FlugVideo.abgreifen = (m, x, W, H) => new Promise(ok => {
  let fertig = false;
  const f = () => { if (fertig) return; fertig = true; m.off('render', f); try { x.drawImage(m.getCanvas(), 0, 0, W, H); } catch (e) { /* bleibt leer */ } ok(); };
  m.on('render', f); m.triggerRepaint();
  setTimeout(f, 3000);
});

FlugVideo.ladeBild = (src, ms) => new Promise(ok => {
  const i = new Image(); let fertig = false; const f = () => { if (!fertig) { fertig = true; ok(i); } };
  i.onload = f; i.onerror = f; setTimeout(f, ms || 4000); i.src = src;
});

const fvMin = s => s < 90 ? Math.max(1, Math.round(s)) + ' s' : Math.round(s / 60) + ' min';

/** Der Dialog „Video erzeugen“: Voreinstellungen, Schätzung, Grenzen. ctx = Flug.aktiv.video(). */
FlugVideo.dialog = async (ctx, fIn) => {
  const V = FlugCalc.video, f = fIn || await FlugVideo.faehig();
  const alt = Object.assign({ kurz: 1080, format: 'quer', dauer: 60, fps: 30, stufe: 'schoen', codec: 'avc', weg: 'auto', titel: true, datum: true, kennzahlen: true, profil: true, fotos: true }, Set_.get('flugVideo') || {});
  const opt = (id, label, opts, val, hilfe) => h('label', { class: 'fld' }, label, h('select', { id, 'aria-label': label, onchange: neu }, opts.map(([v, l, dis]) => h('option', { value: v, selected: String(v) === String(val), disabled: !!dis }, l))), hilfe ? h('small', { class: 'muted' }, hilfe) : null);
  const sw = (id, label, on) => UI.toggle(label, on, neu, { id });
  const box = h('div', { class: 'fvd' },
    h('p', null, 'Rechnet den Flug Bild für Bild – ruckelfrei und scharf, dauert aber länger als der Flug. Die Schnellaufnahme nimmt dagegen in Echtzeit auf und kann ruckeln.'),
    opt('fv-aufl', 'Auflösung', [], alt.kurz),
    opt('fv-format', 'Format', V.VIDEO.FORMATE, alt.format),
    opt('fv-dauer', 'Länge des Videos', V.VIDEO.DAUERN.map(([s, l]) => [s, l + (s === ctx.dauer && !/wie der Flug/.test(l) ? ' (wie der Flug)' : '')]), alt.dauer),
    opt('fv-fps', 'Bilder je Sekunde', [[30, '30 (empfohlen)'], [60, '60 (doppelte Rechenzeit)']], alt.fps),
    opt('fv-stufe', 'Darstellung der Karte', [['schoen', 'Schön (empfohlen)'], ['normal', 'Normal'], ['fluessig', 'Flüssig']], alt.stufe),
    h('div', { class: 'fv-sw' }, h('b', { class: 'small' }, 'Einblendungen'),
      sw('fv-titel', 'Titel', alt.titel), sw('fv-datum', 'Datum', alt.datum), sw('fv-zahlen', 'Strecke und Aufstieg', alt.kennzahlen),
      sw('fv-profil', 'Höhenprofil mit Marke', alt.profil), sw('fv-fotos', 'Fotos beim Vorbeiflug', alt.fotos),
      h('small', { class: 'muted' }, 'Die Quellenangabe der Karte steht immer klein am Rand. Das Video hat keinen Ton.')),
    h('details', { class: 'fv-mehr' }, h('summary', null, 'Erweitert'),
      opt('fv-codec', 'Videoformat', [['avc', 'H.264 (spielt überall)'], ['hevc', 'HEVC/H.265 (kleiner, nicht überall)', !(f.webcodecs || (f.nativ && f.nativ.hevc))]], alt.codec),
      opt('fv-weg', 'Kodierer', [['auto', 'Automatisch'], ['android', 'Über Android (MediaCodec)', !(window.MTApp && f.nativ)]], alt.weg, 'Nur ändern, wenn das Video fehlerhaft ist.')),
    h('div', { class: 'fv-sch', id: 'fv-schaetz', role: 'status' }),
    h('ul', { class: 'fv-warn', id: 'fv-warn' }),
    h('p', { class: 'muted small' }, 'Die App muss währenddessen geöffnet bleiben, der Bildschirm bleibt an. Mit einer Offline-Karte (Mehr → Offline-Karten) geht es schneller und ohne Lücken.'),
    h('div', { class: 'row end wrap' }, h('button', { class: 'btn', id: 'fv-abbr', onclick: () => s.close() }, 'Abbrechen'),
      h('button', { class: 'btn pri', id: 'fv-go', onclick: los }, 'Video erzeugen')));
  const s = sheet('Video erzeugen', box);
  const $ = id => box.querySelector('#' + id), an = id => !!$(id).querySelector('input').checked;
  function wahl() {
    return { kurz: +$('fv-aufl').value || alt.kurz, format: $('fv-format').value || 'quer', dauer: +$('fv-dauer').value, fps: +$('fv-fps').value, stufe: $('fv-stufe').value,
      codec: $('fv-codec').value, weg: $('fv-weg').value, titel: an('fv-titel'), datum: an('fv-datum'), kennzahlen: an('fv-zahlen'), profil: an('fv-profil'), fotos: an('fv-fotos') };
  }
  function neu() {
    const w = wahl(), g = FlugVideo.grenzen(f, w.codec), sel = $('fv-aufl');
    const ang = V.angebot(w.format, g);
    const vorher = +sel.value || w.kurz;
    sel.replaceChildren(...ang.map(a => h('option', { value: a.kurz, disabled: !a.ok, selected: a.kurz === vorher }, a.name + (a.ok ? '' : ' – ' + a.grund))));
    if (sel.selectedOptions[0] && sel.selectedOptions[0].disabled) { const b = ang.filter(a => a.ok).pop(); if (b) sel.value = b.kurz; }
    const w2 = wahl(), r = V.pruefe(w2, g);
    $('fv-schaetz').textContent = `${r.w} × ${r.h} · ≈ ${r.n.toLocaleString('de-DE')} Bilder · ≈ ${Math.round(r.mb).toLocaleString('de-DE')} MB · Rechenzeit grob ≈ ${fvMin(V.rechenzeit(r.n, 0, Math.min(r.w, r.h)))} (genauer nach den ersten Bildern)`;
    const liste = r.fehler.map(t => h('li', { class: 'err' }, t)).concat(r.warn.map(t => h('li', null, t)));
    if (f.freiMB != null && !r.fehler.length) liste.push(h('li', { class: 'muted' }, `Frei: ${Math.floor(f.freiMB).toLocaleString('de-DE')} MB, nötig etwa ${r.bedarf.toLocaleString('de-DE')} MB`));
    $('fv-warn').replaceChildren(...liste);
    $('fv-go').disabled = r.fehler.length > 0;
    return { w: w2, r };
  }
  async function los() {
    const { w, r } = neu();
    if (r.fehler.length) return;
    await Set_.set('flugVideo', w);
    const o = { w: r.w, h: r.h, fps: w.fps, bitrate: r.bitrate, codec: w.codec, weg: w.weg };
    const weg = await FlugVideo.weg(o, f);
    if (!weg) { toast('Dieses Gerät kann das Video in dieser Größe nicht erzeugen – bitte eine kleinere Auflösung wählen.', 6000); return; }
    s.close();
    FlugVideo.erzeuge(ctx, Object.assign({}, w, { w: r.w, h: r.h, n: r.n, bitrate: r.bitrate }), weg);
  }
  neu();
  return s;
};

/** Der Export. w = Wahl (+ w, h, n, bitrate), weg = FlugVideo.weg(…). Gibt das Ergebnis zurück (oder null bei Abbruch/Fehler). */
FlugVideo.erzeuge = async (ctx, w, weg) => {
  if (FlugVideo.laeuft) return null;
  const V = FlugCalc.video, G = FlugVideo.GRENZEN, m = ctx.m, mapEl = ctx.mapEl;
  const o = { w: w.w, h: w.h, fps: w.fps, bitrate: w.bitrate, codec: w.codec, n: w.n || V.bilder(w.dauer, w.fps), name: V.name(ctx.titel, ctx.start), titel: ctx.titel };
  const st = { abbrechen: false, luecken: 0, i: 0, t0: 0, zeiten: [], fertig: false };
  FlugVideo.laeuft = st;
  const an = { titel: w.titel, datum: w.datum, kennzahlen: w.kennzahlen, profil: w.profil, fotos: w.fotos };
  // Fortschritt
  const vor = h('canvas', { id: 'fv-vor', class: 'fv-vor', width: 320, height: Math.round(320 * o.h / o.w), 'aria-label': 'Vorschau des letzten Bildes' });
  const bar = UI.bar(0), stand = h('p', { id: 'fv-stand', role: 'status' }, 'Vorbereitung …'), lu = h('p', { id: 'fv-luecken', class: 'muted small', hidden: true });
  const stop = h('button', { class: 'btn', id: 'fv-stop', onclick: () => abbrechen() }, 'Abbrechen');
  const ps = sheet('Video wird erzeugt', h('div', { class: 'fvp' }, vor, bar, stand, lu,
    h('p', { class: 'muted small' }, `${o.w} × ${o.h}, ${o.fps} Bilder/s, ${o.n.toLocaleString('de-DE')} Bilder · ${weg.art === 'webcodecs' ? 'WebCodecs' : 'über Android'}${weg.hw ? ' (Hardware)' : ''}. Bitte die App geöffnet lassen.`),
    h('div', { class: 'row end' }, stop)), { onclose: () => { if (!st.fertig) abbrechen(); } });
  const vx = vor.getContext('2d');
  function abbrechen() { if (st.fertig || st.abbrechen) return; st.abbrechen = true; stand.textContent = 'Wird abgebrochen …'; stop.disabled = true; }
  const dienst = (neu, text) => { if (window.MTApp) Native.call('flugVideoDienst', { an: true, neu, text, i: st.i, n: o.n }).catch(() => {}); };
  const altCss = mapEl.getAttribute('style'), altPr = m.getPixelRatio(), altStufe = ctx.stufe();
  let kod = null, ergebnis = null, fehler = null, urls = [];
  ctx.beginne(() => abbrechen());
  try {
    dienst(true, 'Vorbereitung …');
    if (w.stufe && w.stufe !== altStufe) ctx.setzeStufe(w.stufe);
    const fe = V.feld(o.w, o.h);
    mapEl.style.cssText = `position:fixed;left:0;top:0;width:${fe.cw}px;height:${fe.ch}px;z-index:0`;
    m.setPixelRatio(fe.pr); m.resize();
    stand.textContent = 'Karte wird geladen …';
    await ctx.vorwaermen(p => { stand.textContent = 'Karte wird geladen … ' + Math.round(p * 100) + ' %'; }, () => st.abbrechen);
    ctx.neigung();
    if (st.abbrechen) throw new Error('abgebrochen');
    kod = weg.art === 'webcodecs' ? await FlugVideo.webKodierer(o, weg) : await FlugVideo.androidKodierer(o, weg);
    const comp = document.createElement('canvas'); comp.width = o.w; comp.height = o.h;
    const x = comp.getContext('2d');
    const fotos = w.fotos ? await Promise.all(ctx.photos.map(p => FlugVideo.ladeBild(Photos.thumb(p.id)))) : [], fotoU = ctx.photos.map(p => p.u);
    let vorAt = 0, dienstAt = 0;
    st.t0 = performance.now();
    for (let i = 0; i < o.n; i++) {
      if (st.abbrechen || !ctx.aktiv()) throw new Error('abgebrochen');
      const t1 = performance.now(), sec = V.flugZeit(i, o.fps, w.dauer, ctx.dauer), uu = sec / ctx.dauer, e0 = ctx.fehler();
      ctx.stelleZeit(sec);
      const ok = await FlugVideo.warte(m, G.zeitlimit, G.versuche);
      if (!ok || ctx.fehler() > e0) st.luecken++;
      await FlugVideo.abgreifen(m, x, o.w, o.h);
      if (FlugVideo.test) FlugVideo.test.protokoll.push({ i, sec, ok, center: m.getCenter().toArray(), bearing: m.getBearing(), pitch: m.getPitch(), zoom: m.getZoom() });
      const fk = V.fotoBei(fotoU, i / o.fps, w.dauer);
      Flug.zeichne(x, o.w, o.h, ctx.einblendung(uu, an, fk >= 0 ? fotos[fk] : null));
      await kod.bild(comp, i);
      st.i = i + 1;
      st.zeiten.push(performance.now() - t1); if (st.zeiten.length > 30) st.zeiten.shift();
      const jetzt = performance.now();
      if (jetzt - vorAt > G.vorschauMs || st.i === o.n) { vorAt = jetzt; vx.drawImage(comp, 0, 0, vor.width, vor.height); }
      const msB = st.zeiten.reduce((a, b) => a + b, 0) / st.zeiten.length, rest = st.i >= 5 ? ' · noch etwa ' + fvMin((o.n - st.i) * msB / 1000) : '';
      stand.textContent = `Bild ${st.i.toLocaleString('de-DE')} von ${o.n.toLocaleString('de-DE')}${rest}`;
      bar.firstChild.style.width = (st.i / o.n * 100) + '%';
      if (st.luecken) { lu.hidden = false; lu.textContent = `${st.luecken} ${st.luecken === 1 ? 'Bild' : 'Bilder'} mit Lücken (Karte war nicht ganz geladen)`; }
      if (jetzt - dienstAt > G.dienstMs) { dienstAt = jetzt; dienst(false, `Bild ${st.i} von ${o.n}`); }
    }
    stand.textContent = 'Video wird abgeschlossen …';
    ergebnis = await kod.ende();
    if (!ergebnis || ergebnis.ok === false) throw new Error((ergebnis && ergebnis.msg) || 'Video konnte nicht gespeichert werden');
    ergebnis.luecken = st.luecken; ergebnis.ms = performance.now() - st.t0; ergebnis.w = o.w; ergebnis.h = o.h; ergebnis.fps = o.fps; ergebnis.art = kod.art; ergebnis.hw = kod.hw;
  } catch (e) {
    fehler = st.abbrechen || /abgebrochen/.test(String(e && e.message)) ? null : e;
    if (kod) await kod.abbruch();
    ergebnis = null;
  } finally {
    st.fertig = true;
    if (!altCss) mapEl.removeAttribute('style'); else mapEl.setAttribute('style', altCss);
    try { if (ctx.stufe() !== altStufe) ctx.setzeStufe(altStufe); } catch (e) { /* egal */ }
    ctx.ende();
    try { m.setPixelRatio(altPr); m.resize(); } catch (e) { /* Karte schon weg */ }
    if (window.MTApp) Native.call('flugVideoDienst', { an: false }).catch(() => {});
    FlugVideo.laeuft = null;
    ps.close();
  }
  if (fehler) { console.warn('Flugvideo:', fehler); toastFehler('Video erzeugen', fehler, 8000); return null; }
  if (!ergebnis) { toast('Abgebrochen – nichts gespeichert'); return null; }
  FlugVideo.fertig(ergebnis, urls);
  return ergebnis;
};

/** Ergebnis: wo gespeichert, wie groß; Abspielen und Teilen. */
FlugVideo.fertig = (r, urls) => {
  const dauer = r.dauerMs ? F.clock(r.dauerMs / 1000) : '', kb = r.bytes ? F.size(r.bytes) : '';
  const wo = r.shown ? 'Gespeichert in ' + r.shown.replace(/\/[^/]*$/, '') + '.' : r.blob ? 'Die Datei wird heruntergeladen.' : '';
  const knoepfe = [];
  if (window.MTApp) {
    knoepfe.push(h('button', { class: 'btn', id: 'fv-play', onclick: async () => { try { const x = await Native.json('playVideo', { file: r.name }); if (x && x.ok === false && x.what === -1) toast('Video nicht gefunden'); } catch (e) { toast('Abspielen nicht möglich'); } } }, '▶ Abspielen'));
    knoepfe.push(h('button', { class: 'btn pri', id: 'fv-share', onclick: () => Native.call('flugVideoShare', { name: r.name }).catch(e => toastFehler('Teilen', e)) }, 'Teilen'));
  } else if (r.blob) {
    const url = URL.createObjectURL(r.blob); urls.push(url);
    const a = h('a', { class: 'btn pri', id: 'fv-dl', href: url, download: r.name }, 'Herunterladen'); knoepfe.push(a);
    setTimeout(() => a.click(), 50);
  }
  const s = sheet('Video fertig', h('div', { class: 'fvf', id: 'fv-fertig' },
    h('p', null, h('b', null, r.name)),
    h('p', null, [r.w && r.h ? r.w + ' × ' + r.h : '', dauer, kb].filter(Boolean).join(' · ')),
    wo ? h('p', null, wo) : null,
    r.gallery === false && r.msg ? h('p', { class: 'muted small' }, 'In die Galerie ging es nicht (' + r.msg + '), Teilen geht trotzdem.') : null,
    r.luecken ? h('p', { class: 'muted small' }, `${r.luecken} ${r.luecken === 1 ? 'Bild hat' : 'Bilder haben'} Lücken in der Karte (nicht rechtzeitig geladen). Mit einer Offline-Karte passiert das nicht.`) : null,
    h('p', { class: 'muted small' }, `Rechenzeit ${fvMin((r.ms || 0) / 1000)} · ${r.art === 'android' ? 'kodiert über Android' : 'kodiert mit WebCodecs'}${r.hw ? ' (Hardware)' : ''}`),
    h('div', { class: 'row end wrap' }, h('button', { class: 'btn', id: 'fv-zu', onclick: () => s.close() }, 'Fertig'), ...knoepfe)),
    { onclose: () => { setTimeout(() => urls.forEach(u => URL.revokeObjectURL(u)), 60000); } });
  return s;
};
