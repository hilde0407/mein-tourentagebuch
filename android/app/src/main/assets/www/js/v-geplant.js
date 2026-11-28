'use strict';
/* Geplante Touren (2.24.3): alle geplanten Touren an einem Ort – je Zeile „Löschen“ (gleiche Rückfrage wie auf der Tourseite), Mehrfachauswahl, mögliche Doppelte gekennzeichnet.
   Erreichbar unter Mehr → Geplante Touren (und aus der Planung). Die Erkennung der Doppelten steht in js/calc-doppelt.js (Grund „form“). */
Views['/geplant'] = async root => {
  const body = h('div', { class: 'pad' }), wahl = new Set();
  root.append(topbar('Geplante Touren', { back: true, actions: [h('a', { class: 'btn sm hbtn', id: 'gp-neu', href: '#/plan' }, 'Tour planen')] }), body);
  const all = await Tours.list(), ts = all.filter(t => t.status === 'planned').sort((a, b) => (b.created || b.start || 0) - (a.created || a.start || 0));
  if (!ts.length) { body.append(UI.empty({ icon: 'route', title: 'Noch keine geplante Tour', text: 'Zeichne eine Strecke auf der Karte oder öffne eine GPX-Datei von außen und wähle „Geplant“.', actions: [h('a', { class: 'btn pri', href: '#/plan' }, 'Tour planen')] })); return; }
  const ign = (await DB.kvGet('dupIgnore', [])) || [], dupIds = new Set();
  for (const g of Doppelt.gruppen(all, { ignore: ign })) if (g.keep.status === 'planned') g.members.forEach(t => dupIds.add(t.id));
  const nameN = {}; ts.forEach(t => { const k = (t.name || '').trim().toLowerCase(); nameN[k] = (nameN[k] || 0) + 1; });
  ts.forEach(t => { if (nameN[(t.name || '').trim().toLowerCase()] > 1) dupIds.add(t.id); });      // gleicher Name zählt auch als Hinweis
  const nDup = ts.filter(t => dupIds.has(t.id)).length;
  const kopf = h('p', { id: 'gp-n' }), leiste = h('div', { class: 'row wrap gp-bar' }), liste = h('div', { class: 'list', id: 'gp-list' });
  body.append(kopf, nDup ? h('p', { class: 'muted small', id: 'gp-dup' }, nDup + ' ' + (nDup === 1 ? 'Tour ist' : 'Touren sind') + ' als „mögliche doppelte Tour“ gekennzeichnet. Zusammenführen unter Mehr → Touren importieren → Doppelte Touren prüfen.') : null, leiste, liste);
  const zeichneLeiste = () => {
    leiste.innerHTML = '';
    const n = wahl.size;
    leiste.append(h('button', { class: 'btn sm', id: 'gp-alle', onclick: () => { ts.forEach(t => wahl.add(t.id)); sync(); } }, 'Alle'),
      h('button', { class: 'btn sm', id: 'gp-keine', disabled: !n, onclick: () => { wahl.clear(); sync(); } }, 'Keine'),
      h('button', { class: 'btn sm danger', id: 'gp-del-n', hidden: !n, onclick: loescheWahl }, n === 1 ? '1 Tour löschen …' : n + ' Touren löschen …'));
  };
  const sync = () => { liste.querySelectorAll('.trow').forEach(r => { r.querySelector('input').checked = wahl.has(r.dataset.id); }); zeichneLeiste(); };
  async function loescheWahl() {
    const l = ts.filter(t => wahl.has(t.id)); if (!l.length) return;
    const namen = l.slice(0, 5).map(t => '„' + t.name + '“').join(', ') + (l.length > 5 ? ' …' : '');
    if (l.length === 1) { if (await TourUI.loeschen(l[0])) Nav.render(); return; }
    if (!await confirmBox(l.length + ' geplante Touren löschen?', namen + '. Die geplanten Touren werden von diesem Handy gelöscht. Zurückholen lässt sie sich nur aus einer Sicherung.', 'Löschen')) return;
    try { for (const t of l) await Tours.loesche(t.id); } catch (e) { toastFehler('Löschen', e); Nav.render(); return; }
    toast(l.length + ' geplante Touren gelöscht'); Nav.render();
  }
  kopf.append(h('b', null, ts.length === 1 ? '1 geplante Tour' : ts.length + ' geplante Touren'));
  ts.forEach(t => {
    const dup = dupIds.has(t.id);
    const cb = h('input', { type: 'checkbox', 'aria-label': '„' + t.name + '“ auswählen', onchange: () => { if (cb.checked) wahl.add(t.id); else wahl.delete(t.id); zeichneLeiste(); } });
    liste.append(h('div', { class: 'trow gp-z' + (dup ? ' gp-dup' : ''), 'data-id': t.id },
      h('label', { class: 'ico gp-chk' }, cb), UI.tourRow(t, { year: true }),
      dup ? h('span', { class: 'gp-badge small' }, 'mögliche doppelte Tour') : null,
      h('button', { class: 'ico trow-del', 'data-a': 'del', 'aria-label': 'Geplante Tour „' + t.name + '“ löschen', title: 'Löschen', html: Ico.svg('trash'), onclick: async () => { if (await TourUI.loeschen(t)) Nav.render(); } })));
  });
  zeichneLeiste();
};
