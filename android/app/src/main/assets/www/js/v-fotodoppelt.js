'use strict';
/* Doppelte Fotos (2.14.0): gleiche Fotos und Videos finden, Gruppen nebeneinander zeigen, Auswahl ändern, nach Rückfrage löschen.
   Vor dem Löschen gehen Ort, Tour, Notiz, Kommentare und die Titelfoto-Wahl auf das behaltene Foto über (wo dort nichts steht).
   Die Regeln stehen ohne Oberfläche in js/calc-fotodoppelt.js; der Abdruck gespeicherter Dateien kommt aus der Hülle (photoPrints, MediaPrint.java). */
const FotoDup = {
  /** Grauraster des Vorschaubilds (für „fast gleiches Bild“): auf 64 × 64 weich verkleinert, je 8 × 8 Punkte gemittelt → 8 × 8 Grauwerte. null, wenn es nicht lädt. */
  raster(id) {
    return new Promise(res => {
      const img = new Image();
      let fertig = false;
      const ende = v => { if (!fertig) { fertig = true; clearTimeout(t); res(v); } };
      const t = setTimeout(() => ende(null), 10000);
      img.onload = () => {
        try {
          const cv = document.createElement('canvas'); cv.width = 64; cv.height = 64;
          const g = cv.getContext('2d', { willReadFrequently: true }); g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
          g.drawImage(img, 0, 0, 64, 64);
          const d = g.getImageData(0, 0, 64, 64).data, grau = new Array(64).fill(0);
          for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) { const k = (y * 64 + x) * 4; grau[(y >> 3) * 8 + (x >> 3)] += (0.299 * d[k] + 0.587 * d[k + 1] + 0.114 * d[k + 2]) / 64; }
          ende(FotoDoppeltCalc.raster(grau));
        } catch (e) { ende(null); }
      };
      img.onerror = () => ende(null);
      img.src = Photos.thumb(id);
    });
  },
  /** Nur wenn sich ein Feld geändert hat: frisch lesen und zurückschreiben (nichts Zwischenzeitliches überschreiben). */
  async setze(id, felder) { const p = await DB.get('photos', id); if (p) { Object.assign(p, felder); await DB.put('photos', p); } return p; },
  /** Suchen. tid: nur Gruppen, in denen ein Foto dieser Tour ist. upd(i, n, text); stop(): true = abbrechen.
      Gibt { gruppen (mit keep/drop), byId, groessen, tour } zurück oder { abgebrochen: true }. */
  async suche(tid, upd, stop) {
    let all = await DB.all('photos');
    let menge = all, tourIds = null;
    if (tid) {
      const eigene = all.filter(p => p.tour === tid);
      tourIds = new Set(eigene.map(p => p.id));
      const zeiten = eigene.map(p => p.ts).filter(x => x > 0), fps = new Set(eigene.flatMap(p => [p.fp, p.fpd]).filter(Boolean));
      const von = zeiten.length ? Math.min(...zeiten) - FotoDoppeltCalc.H14 : Infinity, bis = zeiten.length ? Math.max(...zeiten) + FotoDoppeltCalc.H14 : -Infinity;
      menge = all.filter(p => tourIds.has(p.id) || (p.ts >= von && p.ts <= bis) || fps.has(p.fp) || fps.has(p.fpd));
    }
    // 1. Abdruck und Größe gespeicherter Dateien nachtragen (Fotos von vor 2.14.0); die Hülle liest je Datei höchstens 3 × 64 KB
    const ohne = menge.filter(p => !p.fpd || !(p.size > 0));
    if (ohne.length && window.MTApp) {
      for (let i = 0; i < ohne.length; i += 25) {
        if (stop()) return { abgebrochen: true };
        upd(Math.min(i + 25, ohne.length), ohne.length, 'Abdrücke berechnen');
        let r = [];
        try { r = await Native.json('photoPrints', { ids: ohne.slice(i, i + 25).map(p => p.id) }); } catch (e) { r = []; }
        for (const x of r) if (x && x.fpd) { const p = await FotoDup.setze(x.id, { fpd: x.fpd, size: x.size || 0 }); const m = menge.find(q => q.id === x.id); if (m && p) Object.assign(m, { fpd: x.fpd, size: x.size || 0 }); }
      }
    }
    if (tid) {      // jetzt bekannte Abdrücke der Tourfotos: Fotos anderer Zeit mit gleicher Datei gehören auch dazu (gleiche Objekte wie in all)
      const eigene = all.filter(p => tourIds.has(p.id)), fps = new Set(eigene.flatMap(p => [p.fp, p.fpd]).filter(Boolean));
      const zeiten = eigene.map(p => p.ts).filter(x => x > 0), von = zeiten.length ? Math.min(...zeiten) - FotoDoppeltCalc.H14 : Infinity, bis = zeiten.length ? Math.max(...zeiten) + FotoDoppeltCalc.H14 : -Infinity;
      menge = all.filter(p => tourIds.has(p.id) || (p.ts >= von && p.ts <= bis) || fps.has(p.fp) || fps.has(p.fpd));
    }
    // 2. Vorschaubilder vergleichen – nur wo zur selben Zeit ein zweites Foto liegt
    const brauch = FotoDoppeltCalc.brauchtBild(menge);
    for (let i = 0; i < brauch.length; i++) {
      if (stop()) return { abgebrochen: true };
      if (i % 4 === 0) upd(i + 1, brauch.length, 'Vorschaubilder vergleichen');
      const gr = await FotoDup.raster(brauch[i]);
      if (gr) { await FotoDup.setze(brauch[i], { gr }); const m = menge.find(q => q.id === brauch[i]); if (m) m.gr = gr; }
    }
    upd(1, 1, 'Gruppen bilden');
    let gr = FotoDoppeltCalc.gruppen(menge);
    if (tourIds) gr = gr.filter(g => g.ids.some(id => tourIds.has(id)));
    const tilebg = (await DB.kvGet('tilebg', {})) || {}, comments = (await DB.kvGet('comments', {})) || {};
    const titel = new Set(Object.values(tilebg).filter(e => e && e.kind === 'photo').map(e => e.ph)), kommentare = {};
    Object.keys(comments).forEach(id => { kommentare[id] = (comments[id] || []).length; });
    const byId = new Map(menge.map(p => [p.id, p])), groessen = {};
    menge.forEach(p => { groessen[p.id] = p.size || 0; });
    return { gruppen: FotoDoppeltCalc.vorschlag(gr, byId, { titel, kommentare }), byId, groessen, titel };
  },
  /** Löschen nach Wahl: je Gruppe Angaben übernehmen, Verweise umhängen, dann die übrigen löschen (Datei, Vorschaubild, Eintrag). */
  async loeschen(wahl, groessen, upd, stop) {
    let comments = (await DB.kvGet('comments', {})) || {}, tilebg = (await DB.kvGet('tilebg', {})) || {}, n = 0, bytes = 0, felder = 0, verweis = 0, abgebrochen = false;
    const liste = wahl.filter(g => g.drop.length);
    for (let i = 0; i < liste.length; i++) {
      if (stop()) { abgebrochen = true; break; }
      const g = liste[i];
      upd(i + 1, liste.length);
      const keep = await DB.get('photos', g.keep);
      const drops = (await Promise.all(g.drop.map(id => DB.get('photos', id)))).filter(Boolean);
      if (!keep || !drops.length) continue;
      const u = FotoDoppeltCalc.uebernehmen(keep, drops);
      await DB.put('photos', u.foto);
      felder += u.felder.length;
      const v = FotoDoppeltCalc.verweise(u.foto, drops.map(d => d.id), comments, tilebg);
      comments = v.comments; tilebg = v.tilebg; verweis += v.n;
      for (const d of drops) { await Photos.remove(d.id); n++; bytes += groessen[d.id] || d.size || 0; }
    }
    await DB.kvSet('comments', comments); await DB.kvSet('tilebg', tilebg);
    return { n, bytes, felder, verweis, abgebrochen };
  },
};

Views['/fotodoppelt'] = async (root, [tid]) => {
  const tour = tid ? await DB.get('tours', tid) : null;
  const body = h('div', { class: 'pad fd' });
  root.append(topbar('Doppelte Fotos prüfen', { back: true }), body);
  body.append(h('p', { class: 'muted', id: 'fd-intro' }, (tour ? '„' + tour.name + '“: ' : '') +
    'Gesucht werden gleiche Dateien (auch von einem anderen Rechner oder Weg), gleiche Namen mit gleicher Aufnahmezeit und Größe sowie fast gleiche Bilder derselben Aufnahmezeit. ' +
    'Bearbeitete oder zugeschnittene Fotos gelten nicht als doppelt. Gelöscht wird nur, was du bestätigst.'));
  const bar = h('div', { class: 'prog' }, h('i')), ptxt = h('p', { id: 'fd-ptxt' }, 'Fotos werden geprüft …');
  let halt = false;
  const stopBtn = h('button', { class: 'btn', id: 'fd-stop', onclick: e => { halt = true; e.currentTarget.disabled = true; e.currentTarget.textContent = 'Wird abgebrochen …'; } }, 'Abbrechen');
  const prog = h('div', { id: 'fd-prog', class: 'fd-prog' }, ptxt, bar, h('div', { class: 'row end' }, stopBtn));
  body.append(prog);
  const gone = () => !body.isConnected;      // Ansicht verlassen: Suche hört auf
  const upd = (i, n, t) => { if (gone()) return; bar.firstChild.style.width = Math.min(100, i / Math.max(1, n) * 100) + '%'; ptxt.textContent = t + ' · ' + i + ' von ' + n; };
  let r;
  try { r = await FotoDup.suche(tid, upd, () => halt || gone()); }
  catch (e) { prog.remove(); body.append(h('p', { class: 'err' }, 'Suche nicht möglich: ' + e.message)); return; }
  if (gone()) return;
  prog.remove();
  const neu = () => h('button', { class: 'btn', id: 'fd-neu', onclick: () => Nav.render() }, 'Erneut suchen');
  if (r.abgebrochen) { body.append(UI.empty({ icon: 'photo', title: 'Suche abgebrochen', text: 'Schon berechnete Abdrücke und Bildvergleiche sind gespeichert – die nächste Suche geht schneller.', actions: [neu()] })); return; }
  if (!r.gruppen.length) { body.append(UI.empty({ icon: 'check', title: 'Keine doppelten Fotos gefunden', text: tour ? 'Jedes Foto dieser Tour ist nur einmal da.' : 'Jedes Foto und Video ist nur einmal da.' })); return; }
  const tours = Object.fromEntries((await Tours.list()).map(t => [t.id, t]));
  const sum = h('p', { id: 'fd-sum', class: 'fd-sum', 'aria-live': 'polite' });
  const go = h('button', { class: 'btn danger grow', id: 'fd-go', onclick: loeschen });
  const zeichneSumme = () => {
    const s = FotoDoppeltCalc.summe(r.gruppen, r.groessen), fotos = r.gruppen.reduce((a, g) => a + g.ids.length, 0);
    sum.textContent = (r.gruppen.length === 1 ? '1 Gruppe' : r.gruppen.length + ' Gruppen') + ' mit ' + fotos + ' Fotos. Zum Löschen gewählt: ' + FotoDoppeltCalc.summeText(s) + '.';
    go.disabled = !s.fotos; go.textContent = s.fotos ? (s.fotos === 1 ? '1 Foto löschen' : s.fotos + ' Fotos löschen') : 'Nichts gewählt';
  };
  body.append(sum);
  const karte = (g, p, idx, malen) => {
    const weg = g.drop.includes(p.id), t = p.tour && tours[p.tour];
    const cb = h('input', { type: 'checkbox', checked: weg, onchange: e => {
      if (e.target.checked && g.drop.length + 1 >= g.ids.length) { e.target.checked = false; toast('Mindestens ein Foto der Gruppe bleibt.'); return; }
      if (e.target.checked) { g.drop.push(p.id); if (g.keep === p.id) g.keep = g.ids.find(id => !g.drop.includes(id)); }
      else { g.drop = g.drop.filter(id => id !== p.id); if (!g.ids.includes(g.keep) || g.drop.includes(g.keep)) g.keep = p.id; }
      malen(); zeichneSumme();
    } });
    const quelle = { smb: 'Netzwerkfreigabe', rechner: 'vom Rechner', galerie: 'Galerie', ordner: 'Ordner', webdav: 'Nextcloud', kamera: 'Kamera', geteilt: 'geteilt' }[p.src] || p.src || '';
    return h('div', { class: 'fd-e' + (weg ? ' weg' : ''), 'data-id': p.id },
      h('button', { class: 'fd-th', 'aria-label': (p.video ? 'Video' : 'Foto') + ' ' + (idx + 1) + ' ansehen', onclick: () => Lightbox.open(g.ids.map(id => Object.assign({ tourName: t ? t.name : '' }, r.byId.get(id))), idx) },
        h('img', { src: Photos.thumb(p.id), alt: '', loading: 'lazy' }), UI.vidMark(p)),
      h('b', { class: 'fd-st' }, weg ? 'Wird gelöscht' : 'Bleibt'),
      h('small', null, p.ts ? F.date(p.ts) + ' · ' + F.time(p.ts) : 'Ohne Datum'),
      h('small', null, t ? t.name : 'Keiner Tour zugeordnet'),
      h('small', { class: 'fd-n' }, [p.size ? F.size(p.size) : '', p.w && p.h ? p.w + ' × ' + p.h : ''].filter(Boolean).join(' · ') || ' '),
      h('small', { class: 'fd-n' }, [p.name, quelle].filter(Boolean).join(' · ')),
      [p.lat != null ? 'mit Ort' : '', String(p.note || '').trim() ? 'mit Notiz' : '', r.titel.has(p.id) ? 'Titelfoto' : ''].some(Boolean)
        ? h('small', { class: 'fd-hat' }, [p.lat != null ? 'mit Ort' : '', String(p.note || '').trim() ? 'mit Notiz' : '', r.titel.has(p.id) ? 'Titelfoto' : ''].filter(Boolean).join(' · ')) : null,
      h('label', { class: 'sw fd-cb' }, cb, h('span', null, 'Löschen')));
  };
  r.gruppen.forEach(g => {
    const box = h('section', { class: 'sec fd-g', 'data-key': g.ids[0] }), first = r.byId.get(g.ids[0]);
    const malen = () => {
      box.innerHTML = '';
      box.append(h('div', { class: 'sec-h' }, h('h3', null, first.ts ? F.date(first.ts) + ' · ' + F.time(first.ts) : 'Ohne Datum')),
        h('p', { class: 'muted small sec-s' }, FotoDoppeltCalc.GRUND[g.grund] + ' · ' + g.ids.length + (first.video ? ' Videos' : ' Fotos')),
        h('div', { class: 'fd-l' }, g.ids.map((id, k) => karte(g, r.byId.get(id), k, malen))));
    };
    malen(); body.append(box);
  });
  body.append(h('div', { class: 'row sticky fd-a' }, go));
  zeichneSumme();

  async function loeschen() {
    const s = FotoDoppeltCalc.summe(r.gruppen, r.groessen);
    if (!s.fotos) return;
    if (!await confirmBox('Doppelte Fotos löschen?', FotoDoppeltCalc.summeText(s) + '. Gelöscht werden Datei, Vorschaubild und Eintrag im Tourentagebuch (Originale in Galerie, Ordner oder auf dem Rechner bleiben). '
      + 'Ort, Tour, Notiz, Kommentare und die Wahl als Titelfoto gehen vorher auf das behaltene Foto über, wo dort nichts steht. Das lässt sich nicht rückgängig machen.', 'Löschen')) return;
    let stopp = false, e;
    try { e = await PhotoSources.progress('Doppelte Fotos löschen', u => FotoDup.loeschen(r.gruppen, r.groessen, u, () => stopp), { cancel: () => { stopp = true; }, note: '' }); }
    catch (x) { toastFehler('Löschen', x, 6000); return; }
    window.dispatchEvent(new Event('photos-changed'));
    toast((e.n === 1 ? '1 Foto gelöscht' : e.n + ' Fotos gelöscht') + (e.bytes ? ' · ' + FotoDoppeltCalc.mb(e.bytes) + ' frei' : '') + (e.felder ? ' · Angaben übernommen' : '') + (e.abgebrochen ? ' · abgebrochen' : ''), 6000);
    Nav.render();
  }
};
