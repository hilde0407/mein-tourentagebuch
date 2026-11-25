'use strict';
/* Doppelte Touren prüfen (2.1.0): Paare zeigen, auf Wunsch zusammenführen oder als „keine Doppelten“ merken. Nie von selbst.
   Die Erkennung und das Zusammenlegen der Angaben stehen ohne Oberfläche in js/calc-doppelt.js. */
const Dup = {
  hand: t => !Import.Komoot.autoNamed(t),
  /** Mögliche Paare samt Foto-Anzahl je Tour. */
  async find() {
    const all = await Tours.list(), ign = (await DB.kvGet('dupIgnore', [])) || [], fotos = {};
    (await DB.all('photos')).forEach(p => { if (p.tour) fotos[p.tour] = (fotos[p.tour] || 0) + 1; });
    return { pairs: Doppelt.paare(all, { ignore: ign, fotos, hand: Dup.hand }), fotos, ign };
  },
  /** drop geht in keep auf: Fotos, Notiz, Pins, Schlagworte, Name und Zuordnungen wandern mit, fehlender Puls wird nach Zeit übertragen; dann wird drop gelöscht. */
  async merge(keepId, dropId) {
    let keep = await DB.get('tours', keepId);
    const drop = await DB.get('tours', dropId);
    if (!keep || !drop || keepId === dropId) throw new Error('Eine der beiden Touren gibt es nicht mehr.');
    if (!keep.hrAvg && drop.hrAvg) {      // Puls der anderen Aufzeichnung nach Zeit auf die bleibende Spur legen; nur ganze halbe Stunden Versatz ausgleichen (Zeitzone)
      try { await Tours.fillHr(keepId, await Tours.points(dropId), keep.start - Math.round((keep.start - drop.start) / 1800000) * 1800000); } catch (e) { /* ohne Puls weiter */ }
      keep = await DB.get('tours', keepId);
    }
    const t = Doppelt.zusammen(keep, drop, { handKeep: Dup.hand(keep), handDrop: Dup.hand(drop), mt: MT.aktiv() });
    const ph = await DB.byIndex('photos', 'tour', dropId);
    ph.forEach(p => { p.tour = keepId; });
    if (ph.length) await DB.putMany('photos', ph);
    await Tours.save(t);
    await Tours.remove(dropId);
    const ign = ((await DB.kvGet('dupIgnore', [])) || []).filter(k => !k.split('|').includes(dropId));
    await DB.kvSet('dupIgnore', ign);
    return { tour: t, fotos: ph.length };
  },
  async ignore(key) { const l = (await DB.kvGet('dupIgnore', [])) || []; if (!l.includes(key)) l.push(key); await DB.kvSet('dupIgnore', l); },
  GRUND: { start: 'gleiche Startzeit', zeit: 'gleiche Zeitspanne', versatz: 'gleiche Strecke und Dauer, Uhrzeit versetzt' },
};

Views['/doppelt'] = async root => {
  const body = h('div', { class: 'pad' });
  root.append(topbar('Doppelte Touren prüfen', { back: true }), body);
  const { pairs, fotos, ign } = await Dup.find();
  body.append(h('p', { class: 'muted' }, 'Gesucht werden Touren mit gleicher Startzeit oder Zeitspanne und ähnlicher Strecke – zum Beispiel dieselbe Tour aus Komoot und von der Uhr. Du entscheidest bei jedem Paar selbst; von allein wird nichts zusammengeführt.'));
  const reset = ign.length ? h('button', { class: 'btn', id: 'dup-reset', onclick: async () => { await DB.kvSet('dupIgnore', []); Nav.render(); } }, 'Gemerkte Paare wieder zeigen') : null;
  if (!pairs.length) {
    body.append(UI.empty({ icon: 'check', title: 'Keine doppelten Touren gefunden',
      text: ign.length ? (ign.length === 1 ? 'Ein Paar hast du als „keine Doppelten“ gemerkt.' : ign.length + ' Paare hast du als „keine Doppelten“ gemerkt.') : 'Jede Tour steht nur einmal im Tagebuch.', actions: reset ? [reset] : null }));
    return;
  }
  body.append(h('p', { id: 'dup-n' }, h('b', null, pairs.length === 1 ? '1 mögliches Paar' : pairs.length + ' mögliche Paare')));
  const eintrag = (t, rolle) => {
    const quelle = Tours.QUELLE[t.src] || t.src || 'Datei', was = Doppelt.hat(t, { fotos: fotos[t.id] || 0, hand: Dup.hand(t) });
    return h('div', { class: 'dup-e' }, UI.tourRow(t, { year: true, photos: fotos[t.id] || 0 }),
      h('p', { class: 'dup-m small' }, h('b', null, rolle), ' · ', h('span', { class: 'quelle' }, 'Quelle ' + quelle), (was.length ? ' · ' + was.join(', ') : ' · keine weiteren Angaben')));
  };
  pairs.forEach(p => {
    let keep = p.keep, drop = p.drop;
    const box = h('section', { class: 'sec dup', 'data-key': p.key });
    const draw = () => {
      box.innerHTML = '';
      box.append(h('div', { class: 'sec-h' }, h('h3', null, F.date(keep.start))), h('p', { class: 'muted small sec-s' }, 'Grund: ' + Dup.GRUND[p.grund]),
        h('div', { class: 'dup-l' }, eintrag(keep, 'Bleibt'), eintrag(drop, 'Wird gelöscht')),
        h('div', { class: 'row wrap dup-a' },
          h('button', { class: 'btn', 'data-a': 'merge', onclick: async () => {
            if (!await confirmBox('Touren zusammenführen?', `„${keep.name}“ bleibt. Fotos, Notiz, Pins und Zuordnungen von „${drop.name}“ wandern dorthin, dann wird „${drop.name}“ gelöscht. Das lässt sich nicht rückgängig machen.`, 'Zusammenführen')) return;
            try { const r = await Dup.merge(keep.id, drop.id); toast('Zusammengeführt' + (r.fotos ? ' · ' + r.fotos + (r.fotos === 1 ? ' Foto' : ' Fotos') + ' übernommen' : ''), 5000); } catch (e) { toast(e.message, 6000); }
            Nav.render();
          } }, 'Zusammenführen'),
          h('button', { class: 'btn', 'data-a': 'swap', onclick: () => { const x = keep; keep = drop; drop = x; draw(); } }, 'Andere behalten'),
          h('button', { class: 'btn', 'data-a': 'keep', onclick: async () => { await Dup.ignore(p.key); toast('Gemerkt: keine Doppelten'); Nav.render(); } }, 'Keine Doppelten')));
    };
    draw(); body.append(box);
  });
  if (reset) body.append(h('div', { class: 'row', style: { marginTop: '24px' } }, reset));
};
