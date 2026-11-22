'use strict';
/* 2.15.0: „Mit Meine Touren zusammenarbeiten“ – ein Schalter für alle Berührungspunkte mit dem eigenen Server „Meine Touren“.
   Ist er aus, sind Import-Karte, Senden, Automatisch senden, Abgleich, Wanderführer-Holen, Hinweise und Texte mit Meine Touren nicht vorhanden,
   und kein Netzaufruf geht an eine Meine-Touren-Adresse (Import.MT.http prüft MT.aktiv() selbst als Sicherung).
   Vorhandene Daten bleiben unberührt (mtId, zMt, upMt …, die Sitzung kv „mt“); beim Einschalten kennt die App alles wieder.
   Entscheidung und Texte: js/calc-mt.js. Vorgabe für neue Installationen: aus, mit einer ruhigen Frage auf der Startseite.
   Bestandsnutzer (Verbindung eingerichtet oder Touren von dort) werden beim ersten Start dieser Version automatisch eingeschaltet, ohne Frage. */
const MT = {
  /** Zentrale Abfrage: arbeitet die App mit Meine Touren zusammen? */
  aktiv() { return Set_.get('mtAktiv') === true; },
  /** Sitzung bei Meine Touren, nur bei An und bestehender Verbindung; sonst null. */
  async konto() {
    if (!MT.aktiv()) return null;
    const acc = await DB.kvGet('mt', null);
    return MTCalc.verbunden(acc) ? acc : null;
  },
  /** Beim Start (einmal je Gerät): Bestandsnutzer einschalten, sonst die Frage vormerken. */
  async start() {
    if (Set_.get('mtWahl')) return;
    const e = MTCalc.entscheidung(await DB.kvGet('mt', null), await DB.all('tours'));
    if (e.aktiv) Set_.v.mtAktiv = true;
    await Set_.set('mtWahl', e.wahl);
  },
  frageOffen() { return MTCalc.frage(Set_.get('mtWahl')); },
  /** Umschalten im Betrieb: wirkt sofort (Ansicht neu, Zahlen umstellen), ohne Rückfrage nach Löschen. Die Sitzung bleibt. */
  async setzen(on) {
    on = !!on;
    const vorher = MT.aktiv();
    Set_.v.mtAktiv = on;
    await Set_.set('mtWahl', on ? 'ja' : 'nein');
    toast(MTCalc.umschaltText(on), 4000);
    if (vorher !== on) MT.zahlen().then(n => { if (n) Nav.render(); }).catch(e => console.error('Zahlen umstellen', e));
    Tours.invalidate();
    await Nav.render();
  },
  /** Touren, die mit Meine Touren angeglichen sind (zMt), neu rechnen: bei Aus gilt die eigene Rechnung, bei An wieder der Wert aus Meine Touren.
      Gibt die Zahl geänderter Touren zurück. */
  async zahlen() {
    const ids = (await DB.all('tours')).filter(t => t.zMt && (t.upMt != null || t.distMt)).map(t => t.id);
    let n = 0;
    for (let i = 0; i < ids.length; i++) {
      try { await Tours.recalc(ids[i]); n++; } catch (e) { console.error('Zahlen umstellen', ids[i], e); }
      if (i % 10 === 9) await new Promise(r => setTimeout(r, 0));
    }
    Tours.invalidate();
    return n;
  },
  /** Die ruhige Frage (Startseite, solange nicht entschieden). Keine Blockade: sie steht einfach da, bis man antwortet. */
  frageBox() {
    if (!MT.frageOffen()) return null;
    return UI.banner([h('b', null, 'Nutzt du auch „Meine Touren“ (eigener Server)?'),
      h('div', { class: 'muted small' }, 'Nur dann braucht das Tagebuch die Verbindung dorthin. Ändern kannst du das jederzeit unter Mehr → Einstellungen.')], [
      h('button', { class: 'btn sm', id: 'mt-frage-nein', onclick: () => MT.setzen(false) }, 'Nein, nur das Tagebuch'),
      h('button', { class: 'btn sm', id: 'mt-frage-ja', onclick: () => MT.setzen(true) }, 'Ja, mit Meine Touren')], { id: 'mt-frage' });
  },
  /** Abschnitt ganz oben in den Einstellungen. */
  einstellung() {
    return h('div', { id: 'set-mt-box' }, h('h3', { id: 'set-mt-h' }, 'Meine Touren'),
      UI.toggle('Mit Meine Touren zusammenarbeiten', MT.aktiv(), v => MT.setzen(v), { id: 'set-mt' }),
      h('p', { class: 'muted small' }, 'Nur nötig, wenn du den eigenen Server „Meine Touren“ nutzt. Ohne diese Option bleibt Mein Tourentagebuch ganz für sich.'));
  },
};
