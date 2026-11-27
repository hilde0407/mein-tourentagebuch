'use strict';
/* 2.21.0: „Auf neue Version prüfen“. Fragt (nur lesend, ohne Anmeldung, ohne eigene Daten) bei GitHub nach dem neuesten Release
   und merkt sich Ergebnis und Zeitpunkt (kv „update“). Beim Start höchstens alle 12 Stunden, abschaltbar (Einstellung updateCheck,
   Vorgabe an). Fehler, kein Netz und Rate-Limit (403/429) bleiben still: nichts wird gespeichert, der nächste Start versucht es erneut.
   Die Anzeige (Hinweis auf der Startseite, Zeile in den Einstellungen) ruft nie das Netz selbst auf. Rechenlogik: js/calc-update.js. */
const Update = {
  _lauf: null,
  installiert() { try { return window.MTApp && MTApp.version ? String(MTApp.version() || '') : ''; } catch (e) { return ''; } },
  an() { return Set_.get('updateCheck') !== false; },
  stand() { return DB.kvGet('update', null); },
  /** Ein Abruf. Gibt {ok, neu, latest, url, notes} oder {ok:false, grund} zurück; wirft nie. */
  abrufen() {
    if (Update._lauf) return Update._lauf;
    Update._lauf = (async () => {
      try {
        const inst = Update.installiert();
        if (!UpdateCalc.lesen(inst)) return { ok: false, grund: 'Version dieser App unbekannt' };
        const r = await Native.http({ url: UpdateCalc.API, headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'MeinTourentagebuch/' + inst + ' (update-check)' } });
        const a = UpdateCalc.auswerten(r);
        if (!a.ok) return { ok: false, grund: r && (r.status === 403 || r.status === 429) ? 'GitHub ist gerade nicht erreichbar (Anfragegrenze)' : 'keine Antwort von GitHub' };
        await DB.kvSet('update', { t: Date.now(), latest: a.latest, url: a.url, notes: a.notes });
        return Object.assign({ neu: UpdateCalc.neuer(inst, a.latest) }, a);
      } catch (e) { return { ok: false, grund: 'keine Verbindung' }; }
      finally { Update._lauf = null; }
    })();
    return Update._lauf;
  },
  /** Beim Start: nur wenn eingeschaltet und fällig; still. Zeigt den Hinweis nach, wenn die Startseite offen ist. */
  async start() {
    try {
      if (!Update.an() || !UpdateCalc.lesen(Update.installiert())) return;
      const st = await Update.stand();
      if (!UpdateCalc.faellig(st && st.t, Date.now())) return;
      const r = await Update.abrufen();
      if (r.ok && r.neu && Nav.cur === '/start' && !$('#updatenote') && $('#view') && $('#view').scrollTop < 40) Nav.render();
    } catch (e) { console.error('Update-Prüfung', e); }
  },
  oeffnen(url) { if (window.MTApp && MTApp.openUrl) MTApp.openUrl(url); else window.open(url, '_blank', 'noopener'); },
  /** Zeile für die Einstellungen: Zustand + Knopf „Jetzt prüfen“. */
  zeile() {
    const stat = h('div', { class: 'muted small', id: 'upd-stat', role: 'status' });
    const notes = h('pre', { class: 'muted small', id: 'upd-notes', style: { whiteSpace: 'pre-wrap', margin: '4px 0 0' } });
    const dl = h('button', { class: 'btn sm pri', id: 'upd-dl', hidden: true }, 'Herunterladen');
    const zeig = (st, geprueft) => {
      const inst = Update.installiert();
      if (st && UpdateCalc.neuer(inst, st.latest)) {
        stat.textContent = 'Neue Version ' + st.latest + ' verfügbar (installiert: ' + UpdateCalc.text(inst) + ')';
        notes.textContent = st.notes || ''; dl.hidden = false; dl.onclick = () => Update.oeffnen(st.url);
      } else if (st && geprueft) { stat.textContent = 'Du hast die neueste Version (' + (UpdateCalc.text(inst) || inst) + ')'; notes.textContent = ''; dl.hidden = true; }
      else if (st) { stat.textContent = 'Zuletzt geprüft: ' + F.date(st.t) + ' – du hast die neueste Version'; notes.textContent = ''; dl.hidden = true; }
      else { stat.textContent = 'Noch nicht geprüft'; dl.hidden = true; }
    };
    Update.stand().then(st => zeig(st, false)).catch(() => {});
    const knopf = h('button', { class: 'btn sm', id: 'upd-now', onclick: async () => {
      knopf.disabled = true; stat.textContent = 'Prüfe …';
      const r = await Update.abrufen();
      knopf.disabled = false;
      if (!r.ok) { stat.textContent = 'Prüfung nicht möglich: ' + r.grund; return; }
      zeig({ latest: r.latest, url: r.url, notes: r.notes, t: Date.now() }, true);
      if (r.neu) await DB.kvSet('updateSpaeter', '');      // wer ausdrücklich prüft, soll den Hinweis auch wieder sehen
    } }, 'Jetzt prüfen');
    return h('div', null, h('div', { class: 'row wrap' }, knopf, dl), stat, notes);
  },
};

/* ---- Hinweis auf der Startseite: ruhig, nicht blockierend; kein Netzzugriff beim Aufbau ---- */
Home.add('update', 9, async () => {
  if (!Update.an()) return null;
  const st = await Update.stand(), spaeter = await DB.kvGet('updateSpaeter', '');
  const inst = Update.installiert();
  if (!UpdateCalc.zeigen(inst, st, spaeter)) return null;
  const box = UI.banner([h('b', null, 'Neue Version ' + st.latest + ' verfügbar (installiert: ' + UpdateCalc.text(inst) + ')')], [
    h('button', { class: 'btn sm pri', id: 'upd-banner-dl', onclick: () => Update.oeffnen(st.url) }, 'Herunterladen'),
    h('button', { class: 'btn sm', id: 'upd-banner-later', onclick: async () => { await DB.kvSet('updateSpaeter', st.latest); box.remove(); } }, 'Später')], { id: 'updatenote' });
  return box;
});
