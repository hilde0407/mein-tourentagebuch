'use strict';
/* 2.18.0: Komoot-Paket – eine ZIP-Datei zum Selbst-Hochladen bei Komoot (Tourseite → Aktionen → „Komoot-Paket …“). Unabhängig von Meine Touren: auch ohne
   „Mit Meine Touren zusammenarbeiten“ da, denn es ist nur ein Export. Es geht nichts an Komoot, die App lädt nichts hoch.
   Inhalt: <Tour>.gpx (Spur, Pins als <wpt>, Notiz als <desc>), notiz.txt, README.txt (Anleitung, Sichtbarkeit, Rechte), manifest.json und – nur wenn einzeln
   angekreuzt – Fotos: höchstens 60, auf höchstens 2000 Pixel verkleinert, Aufnahmezeit im EXIF, Ort nur mit „Ort im Foto behalten“ (Vorgabe aus).
   Fotos mit erkannten Gesichtern sind nie vorgewählt (es ist gar nichts vorgewählt) und tragen den Hinweis „Gesicht erkannt – Rechte der Personen beachten“.
   Gebaut wird im WebView (Verkleinern über canvas, ZIP mit fflate, EXIF mit KomootCalc), gespeichert in Download/Tourentagebuch wie PDF und Bild; danach „Teilen …“.
   Speicher: höchstens 60 Fotos zu etwa 0,3–1 MB – das ZIP liegt einmal ganz im Speicher (wie beim PDF), dann stückweise im Zwischenspeicher der Hülle. */
const KomootPaket = {
  QUALI: 0.88,
  /** Gesichter für Fotos ohne Angabe nachzählen (Hülle; im Browser nicht möglich). Speichert faces am Foto. */
  async gesichter(fotos) {
    if (!Native.available()) return;
    for (const p of fotos.filter(x => x.faces == null).slice(0, 120)) {
      try { const n = +(await Native.call('photoFaces', { id: p.id })); if (n >= 0) { p.faces = n; const q = await DB.get('photos', p.id); if (q) { q.faces = n; await DB.put('photos', q); } } } catch (e) { /* ohne Angabe */ }
    }
  },
  /** Ein Foto verkleinern (längste Seite höchstens 2000 px) und als JPEG-Bytes zurückgeben. canvas schreibt keine Metadaten. */
  async verkleinere(p) {
    const img = new Image();
    img.decoding = 'async';
    await new Promise((ok, no) => { img.onload = ok; img.onerror = () => no(new Error('Foto nicht lesbar: ' + (p.name || p.id))); img.src = Photos.url(p.id); });
    const [w, hh] = KomootCalc.ziel(img.naturalWidth, img.naturalHeight, KomootCalc.FOTO_PX);
    const cv = document.createElement('canvas'); cv.width = w; cv.height = hh;
    cv.getContext('2d').drawImage(img, 0, 0, w, hh);
    const blob = await new Promise((ok, no) => cv.toBlob(b => b ? ok(b) : no(new Error('Foto nicht möglich')), 'image/jpeg', KomootPaket.QUALI));
    cv.width = cv.height = 1;
    return new Uint8Array(await blob.arrayBuffer());
  },
  /** Paket bauen. o: { fotos: [ids in Reihenfolge], ort (Ort behalten), notiz (Notiz mitnehmen), upd(i, n) }. Gibt { bytes, name, manifest } zurück. */
  async bauen(t, o) {
    o = o || {};
    const pts = await Tours.points(t.id), alle = await DB.byIndex('photos', 'tour', t.id);
    const ids = (o.fotos || []).slice(0, KomootCalc.FOTO_MAX_N), fotos = ids.map(id => alle.find(p => p.id === id && !p.video)).filter(Boolean).sort((a, b) => (a.ts || 0) - (b.ts || 0));
    const note = o.notiz === false ? '' : (t.note || '');
    const w = KomootCalc.pinWpts(t.pins, pts, { nameMax: KomootCalc.NAME_MAX });
    const base = KomootCalc.dateiname(t.name, 'Tour'), gname = base + '.gpx', enc = new TextEncoder();
    const files = { [gname]: [enc.encode(KomootCalc.gpx({ name: t.name, sport: t.sport, pts, wpts: w.wpts, desc: note })), { level: 6 }] };
    const nt = KomootCalc.notizTxt(note);
    if (nt) files['notiz.txt'] = [enc.encode(nt), { level: 6 }];
    const liste = [];
    for (let i = 0; i < fotos.length; i++) {
      const p = fotos[i];
      if (o.upd) o.upd(i, fotos.length, p.name);
      const jpg = KomootCalc.fotoExif(await KomootPaket.verkleinere(p), { ts: p.ts, lat: p.lat, lon: p.lon, ort: !!o.ort });
      const fn = KomootCalc.fotoName(i + 1, p.ts);
      files[fn] = [jpg, { level: 0 }];
      liste.push({ datei: fn, id: p.id, zeit: p.ts || null, ort: !!o.ort && p.lat != null, gesicht: p.faces > 0 });
    }
    const info = { id: t.id, name: t.name, sport: t.sport, start: t.start, dist: t.dist, gpx: gname, wpts: w.wpts.length, notiz: !!nt, fotos: liste.length, fotoListe: liste, ort: !!o.ort, app: 'Mein Tourentagebuch' };
    files['README.txt'] = [enc.encode(KomootCalc.readme(info)), { level: 6 }];
    const manifest = KomootCalc.manifest(info);
    files['manifest.json'] = [enc.encode(manifest), { level: 6 }];
    return { bytes: fflate.zipSync(files), name: 'Komoot-Paket ' + base + '.zip', manifest: JSON.parse(manifest), ohneOrt: w.ohneOrt };
  },
  /** Dialog: Fotoauswahl mit Vorschaubildern, Zählung, Rechte-Hinweis, Schalter; dann bauen, speichern, teilen. */
  async dialog(t) {
    const fotos = (await DB.byIndex('photos', 'tour', t.id)).filter(p => !p.video).sort((a, b) => (a.ts || 0) - (b.ts || 0));
    const pick = new Set(KomootCalc.vorgabe(fotos).gewaehlt);
    const st = { ort: false, notiz: true };
    const zahl = h('p', { class: 'kp-zahl', id: 'kp-zahl', 'aria-live': 'polite' }), grid = h('div', { class: 'kp-grid', id: 'kp-fotos' });
    const go = h('button', { class: 'btn pri', id: 'kp-go' }, 'Paket erstellen');
    const upd = () => {
      zahl.textContent = fotos.length ? pick.size + ' von ' + fotos.length + ' Fotos gewählt (höchstens ' + KomootCalc.FOTO_MAX_N + ')' : 'Diese Tour hat keine Fotos.';
      grid.querySelectorAll('.kp-f').forEach(el => { const on = pick.has(el.dataset.id); el.classList.toggle('on', on); el.querySelector('input').checked = on; });
    };
    const kachel = p => {
      const cb = h('input', { type: 'checkbox', 'aria-label': 'Foto ' + (p.name || '') + ' ins Paket', onchange: e => {
        if (e.target.checked && pick.size >= KomootCalc.FOTO_MAX_N) { e.target.checked = false; toast('Höchstens ' + KomootCalc.FOTO_MAX_N + ' Fotos je Paket.'); return; }
        if (e.target.checked) pick.add(p.id); else pick.delete(p.id); upd(); } });
      return h('label', { class: 'kp-f', 'data-id': p.id }, cb, h('img', { src: Photos.thumb(p.id), alt: '', loading: 'lazy' }),
        h('small', null, p.ts ? F.time(p.ts) : 'ohne Zeit'), p.faces > 0 ? h('small', { class: 'kp-g' }, 'Gesicht erkannt – Rechte der Personen beachten') : null);
    };
    const zeichne = () => { grid.innerHTML = ''; fotos.forEach(p => grid.append(kachel(p))); upd(); };
    const s = sheet('Komoot-Paket', h('div', { id: 'kp-sheet' },
      h('p', { class: 'muted' }, 'Eine ZIP-Datei zum Selbst-Hochladen bei Komoot: Strecke mit Pins und Notiz, eine Anleitung und – nur wenn du sie ankreuzt – Fotos. Es geht nichts an Komoot.'),
      UI.toggle('Notiz mitnehmen', true, v => { st.notiz = !!v; }, { id: 'kp-notiz' }),
      fotos.length ? h('div', null,
        h('h3', { class: 'sub' }, 'Fotos'), zahl,
        h('div', { class: 'row wrap' },
          h('button', { class: 'btn sm', id: 'kp-alle', onclick: () => { pick.clear(); KomootCalc.ohneGesicht(fotos).forEach(id => pick.add(id)); upd(); } }, 'Alle ohne Gesicht wählen'),
          h('button', { class: 'btn sm', id: 'kp-keine', onclick: () => { pick.clear(); upd(); } }, 'Keine')),
        grid,
        UI.toggle('Ort im Foto behalten', false, v => { st.ort = !!v; }, { id: 'kp-ort' }),
        h('p', { class: 'muted small' }, 'Vorgabe: Der Aufnahmeort wird aus den Fotos entfernt, die Aufnahmezeit bleibt. Fotos werden auf höchstens ' + KomootCalc.FOTO_PX + ' Pixel verkleinert.')) : zahl,
      h('p', { class: 'small', id: 'kp-rechte' }, h('b', null, 'Rechte: '), 'Nimm nur Fotos, die du selbst gemacht hast. Sind Personen erkennbar, brauchst du für eine Veröffentlichung in der Regel ihre Einwilligung. Was einmal öffentlich war, lässt sich nicht zuverlässig zurückholen. Die Sichtbarkeit wählst du in Komoot selbst.'),
      h('div', { class: 'row end wrap' }, h('button', { class: 'btn', id: 'kp-abbr', onclick: () => s.close() }, 'Abbrechen'), go)));
    zeichne();
    KomootPaket.gesichter(fotos).then(() => { if (fotos.some(p => p.faces > 0)) zeichne(); });
    go.onclick = async () => {
      const ids = fotos.filter(p => pick.has(p.id)).map(p => p.id);
      s.close();
      let r;
      try {
        r = await PhotoSources.progress('Komoot-Paket', upd2 => KomootPaket.bauen(t, { fotos: ids, ort: st.ort, notiz: st.notiz, upd: (i, n, nm) => upd2(i + 1, n, nm) }), { note: 'Fotos werden verkleinert. Bitte die App geöffnet lassen.' });
      } catch (e) { toast('Komoot-Paket nicht möglich: ' + (e && e.message || e), 7000); return; }
      await KomootPaket.ausgeben(r, t);
    };
    return s;
  },
  /** Speichern (Download/Tourentagebuch) und „Teilen …“ anbieten; im Browser: Download. */
  async ausgeben(r, t) {
    const info = F.size(r.bytes.length) + (r.manifest.fotos.length ? ' · ' + r.manifest.fotos.length + ' Foto(s)' : ' · ohne Fotos') + (r.manifest.wegpunkte ? ' · ' + r.manifest.wegpunkte + ' Pin(s)' : '');
    if (!Native.available()) {
      const a = h('a', { href: URL.createObjectURL(new Blob([r.bytes], { type: 'application/zip' })), download: r.name }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 60000);
      toast('Gespeichert: ' + r.name + ' (' + info + ')', 6000); return;
    }
    const cache = 'komoot-paket-' + String(t.id).replace(/[^A-Za-z0-9_-]/g, '_') + '.zip';
    let ort;
    try { await PdfUI.zwischenspeichern(r.bytes, cache); ort = await Native.json('saveFile', { name: r.name, mime: 'application/zip', path: cache }); }
    catch (e) { toast('Das Paket konnte nicht gespeichert werden: ' + (e && e.message || e), 7000); return; }
    const s = sheet('Komoot-Paket gespeichert', h('div', { id: 'kp-fertig' },
      h('p', { id: 'kp-ort-t' }, 'Gespeichert: ' + ort), h('p', { class: 'muted small' }, info + '. In der README-Datei steht, wie du es in Komoot hochlädst. Die Sichtbarkeit wählst du dort selbst.'),
      r.ohneOrt ? h('p', { class: 'muted small' }, r.ohneOrt + ' Pin(s) ohne Ort sind nicht in der GPX-Datei.') : null,
      h('div', { class: 'row end wrap' },
        h('button', { class: 'btn', id: 'kp-teilen', onclick: async e => {
          const b = e.currentTarget; b.disabled = true;
          try { await PdfUI.zwischenspeichern(r.bytes, cache); await Native.call('shareCache', { name: cache, mime: 'application/zip', title: 'Komoot-Paket teilen' }); s.close(); }
          catch (err) { toast('Teilen nicht möglich: ' + (err && err.message || err), 6000); b.disabled = false; }
        } }, 'Teilen …'),
        h('button', { class: 'btn pri', id: 'kp-ok', onclick: () => s.close() }, 'Fertig'))));
  },
};
