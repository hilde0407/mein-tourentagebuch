'use strict';
/* Doppelte Touren prüfen (2.1.0): Paare zeigen, auf Wunsch zusammenführen oder als „keine Doppelten“ merken. Nie von selbst.
   Die Erkennung und das Zusammenlegen der Angaben stehen ohne Oberfläche in js/calc-doppelt.js. */
const Dup = {
  hand: t => !Import.Komoot.autoNamed(t),
  /** Mögliche Doppelte (Gruppen aus zwei oder mehr Touren) samt Foto-Anzahl je Tour. */
  async find() {
    const all = await Tours.list(), ign = (await DB.kvGet('dupIgnore', [])) || [], fotos = {};
    (await DB.all('photos')).forEach(p => { if (p.tour) fotos[p.tour] = (fotos[p.tour] || 0) + 1; });
    return { gruppen: Doppelt.gruppen(all, { ignore: ign, fotos, hand: Dup.hand }), fotos, ign };
  },
  /** Stand ohne Fotos (billig): alle offenen Gruppen. Für „Mehr → Import → Aufräumen“. */
  async stand() {
    const all = await Tours.list(), ign = (await DB.kvGet('dupIgnore', [])) || [];
    return Doppelt.stand(Doppelt.gruppen(all, { ignore: ign, hand: Dup.hand }));
  },
  /** Zeitpunkt, ab dem Touren als „neu“ gelten (2.23.0): beim ersten Start mit dieser Funktion festgehalten, damit alte Bestände nicht als Neuzugang gemeldet werden. */
  async basis() {
    let b = await DB.kvGet('dupBasis', null);
    if (!(b > 0)) { b = Date.now(); await DB.kvSet('dupBasis', b); }
    return b;
  },
  /** Der Hinweis nach Importen: offene Gruppen mit mindestens einer neuen Tour, ohne die mit „Später“ verworfenen. null, wenn nichts offen ist. Bei jedem Aufruf neu bewertet. */
  async hinweis(all) {
    all = all || await Tours.list();
    const ign = (await DB.kvGet('dupIgnore', [])) || [], b = await Dup.basis();
    const gs = Doppelt.offen(Doppelt.mitNeuen(Doppelt.gruppen(all, { ignore: ign, hand: Dup.hand }), b), (await DB.kvGet('dupSpaeter', [])) || []);
    return gs.length ? Object.assign({ gruppen: gs }, Doppelt.stand(gs)) : null;
  },
  /** Ein Satz für die Abschlussmeldung eines Imports („ · 2 mögliche doppelte Touren – Hinweis auf der Startseite“), sonst ''. Stört nie. */
  async satz() {
    try { Tours.invalidate(); const h = await Dup.hinweis(); return h ? ' · ' + h.text + ' – Hinweis auf der Startseite' : ''; } catch (e) { return ''; }
  },
  /** „Später“: diese Gruppen nicht mehr melden (bis eine Tour dazukommt, dann ist es eine andere Gruppe). */
  async spaeter(gruppen) {
    const l = ((await DB.kvGet('dupSpaeter', [])) || []).concat(gruppen.map(g => g.id));
    await DB.kvSet('dupSpaeter', [...new Set(l)].slice(-300));
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
    await Tours.remove(dropId, { stein: false });      // 2.24.1: die Kennungen sind schon als alias in der bleibenden Tour; kein Stein nötig
    const ign = ((await DB.kvGet('dupIgnore', [])) || []).filter(k => !k.split('|').includes(dropId));
    await DB.kvSet('dupIgnore', ign);
    return { tour: t, fotos: ph.length };
  },
  /** Eine Gruppe: alle anderen gehen nacheinander in keep auf. */
  async mergeAlle(keepId, dropIds) {
    let fotos = 0, tour = null;
    for (const id of dropIds) { const r = await Dup.merge(keepId, id); fotos += r.fotos; tour = r.tour; }
    return { tour, fotos };
  },
  async ignore(key) { const l = (await DB.kvGet('dupIgnore', [])) || []; for (const k of [].concat(key)) if (!l.includes(k)) l.push(k); await DB.kvSet('dupIgnore', l); },
  GRUND: { start: 'gleiche Startzeit', zeit: 'gleiche Zeitspanne', versatz: 'gleiche Strecke und Dauer, Uhrzeit versetzt' },
};

Views['/doppelt'] = async root => {
  const body = h('div', { class: 'pad' });
  root.append(topbar('Doppelte Touren prüfen', { back: true }), body);
  const { gruppen, fotos, ign } = await Dup.find();
  body.append(h('p', { class: 'muted' }, 'Dieselbe Tour aus mehreren Quellen, etwa Komoot und Uhr. Du entscheidest selbst; von allein wird nichts zusammengeführt.'));
  const reset = ign.length ? h('button', { class: 'btn', id: 'dup-reset', onclick: async () => { await DB.kvSet('dupIgnore', []); Nav.render(); } }, 'Gemerkte Paare wieder zeigen') : null;
  if (!gruppen.length) {
    body.append(UI.empty({ icon: 'check', title: 'Keine doppelten Touren gefunden',
      text: ign.length ? (ign.length === 1 ? 'Ein Paar hast du als „keine Doppelten“ gemerkt.' : ign.length + ' Paare hast du als „keine Doppelten“ gemerkt.') : 'Jede Tour steht nur einmal im Tagebuch.', actions: reset ? [reset] : null }));
    return;
  }
  const st = Doppelt.stand(gruppen);
  body.append(h('p', { id: 'dup-n' }, h('b', null, st.text)));
  if (st.extra) body.append(h('p', { class: 'muted small', id: 'dup-n2' }, st.extra));
  const eintrag = (t, rolle) => {
    const quelle = Tours.QUELLE[t.src] || t.src || 'Datei', was = Doppelt.hat(t, { fotos: fotos[t.id] || 0, hand: Dup.hand(t) });
    return h('div', { class: 'dup-e' }, UI.tourRow(t, { year: true, photos: fotos[t.id] || 0 }),
      h('p', { class: 'dup-m small' }, h('b', null, rolle), ' · ', h('span', { class: 'quelle' }, 'Quelle ' + quelle), (was.length ? ' · ' + was.join(', ') : ' · keine weiteren Angaben')));
  };
  gruppen.forEach(g => {
    let keep = g.keep, drops = g.drops;
    const gross = g.members.length > 2, box = h('section', { class: 'sec dup' + (gross ? ' dup-gruppe' : ''), 'data-key': g.key, 'data-n': g.members.length });
    const draw = () => {
      box.innerHTML = '';
      box.append(h('div', { class: 'sec-h' }, h('h3', null, F.date(keep.start))),
        h('p', { class: 'muted small sec-s' }, gross ? 'Dieselbe Tour liegt ' + g.members.length + '\u00a0Mal vor · Grund: ' + Dup.GRUND[g.grund] : 'Grund: ' + Dup.GRUND[g.grund]),
        h('div', { class: 'dup-l' }, eintrag(keep, 'Bleibt'), drops.map(d => eintrag(d, 'Wird gelöscht'))),
        h('div', { class: 'row wrap dup-a' },
          h('button', { class: 'btn pri', 'data-a': 'merge', onclick: async () => {
            const wer = drops.length === 1 ? `„${drops[0].name}“` : drops.slice(0, -1).map(d => `„${d.name}“`).join(', ') + ` und „${drops[drops.length - 1].name}“`;
            if (!await confirmBox('Touren zusammenführen?', `„${keep.name}“ bleibt. Fotos, Notiz, Pins und Zuordnungen von ${wer} wandern dorthin, dann ${drops.length === 1 ? `wird ${wer}` : `werden ${drops.length}\u00a0Touren`} gelöscht. Das lässt sich nicht rückgängig machen.`, 'Zusammenführen', { gefahr: true })) return;
            try { const r = await Dup.mergeAlle(keep.id, drops.map(d => d.id)); toast('Touren zusammengeführt' + (r.fotos ? ' · ' + r.fotos + (r.fotos === 1 ? ' Foto' : ' Fotos') + ' übernommen' : ''), 5000); } catch (e) { toastFehler('Zusammenführen', e, 6000); }
            Nav.render();
          } }, 'Zusammenführen'),
          h('button', { class: 'btn', 'data-a': 'swap', onclick: () => { const alle = [keep].concat(drops); keep = alle[1]; drops = alle.slice(2).concat(alle[0]); draw(); } }, 'Andere behalten'),
          h('button', { class: 'btn', 'data-a': 'keep', onclick: async () => { await Dup.ignore(g.keys); toast('Gemerkt: keine Doppelten'); Nav.render(); } }, 'Keine Doppelten')));
    };
    draw(); body.append(box);
  });
  if (reset) body.append(h('div', { class: 'row', style: { marginTop: '24px' } }, reset));
};

/* ---- Hinweis auf der Startseite (2.23.0): nach Importen mögliche Doppelte unter den neuen Touren – ruhig, ohne Dialog, bei jedem Aufbau neu bewertet ---- */
Home.add('doppelt', 13, async ({ all }) => {
  const st = await Dup.hinweis(all);
  if (!st) return null;
  const box = UI.banner([h('b', null, st.text + ' unter den neuen Touren'), h('div', { class: 'muted small' }, 'Von allein wird nichts zusammengeführt.' + (st.extra ? ' ' + st.extra.charAt(0).toUpperCase() + st.extra.slice(1) + '.' : ''))], [
    h('button', { class: 'btn sm pri', id: 'dup-banner-go', onclick: () => { location.hash = '#/doppelt'; } }, 'Prüfen'),
    h('button', { class: 'btn sm', id: 'dup-banner-later', onclick: async () => { await Dup.spaeter(st.gruppen); box.remove(); } }, 'Später')], { id: 'dupnote' });
  return box;
});
