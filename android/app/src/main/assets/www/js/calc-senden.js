'use strict';
/* Rechenlogik ohne Oberfläche für „An Meine Touren senden“ (2.5.0). Das Netz und die Oberfläche stehen in js/senden.js; hier nur, was sich prüfen lässt:
   Welche Touren dürfen gesendet werden und warum nicht, welche Sportart der Server kennt, wann eine Tour am Server schon da ist (gleicher Start und ähnliche Länge –
   dieselbe Regel wie beim Holen in js/import.js), wie ein Fehler des Servers in Worten ausgedrückt wird und wie die Warteschlange für das automatische Senden
   fortgeschrieben wird. Läuft im Browser (globales `SendenCalc`) und in Node. */
(function (root) {
  const node = typeof module !== 'undefined' && module.exports;

  /** Sportarten des Tagebuchs → Kennungen, die Meine Touren beim Hochladen (POST /api/record/upload) annimmt. Was der Server nicht kennt („Sonstiges“, „Ski allgemein“), wird nicht gesendet –
      dort gilt dann die Vorgabe-Sportart des Servers. */
  const SPORT = { hike: 'hike', walk: 'hike', mountaineering: 'mountaineering', run: 'jogging', bike: 'touringbicycle', ebike: 'e_touringbicycle', racebike: 'racebike', mtb: 'mtb',
    skialpin: 'skialpin', skitour: 'skitour', nordic: 'nordic' };
  /** Kennung für den Server; Schneeschuhwandern (Wandern mit dem Schlagwort „Schneeschuh“) geht als „snowshoe“. null = nicht mitsenden. */
  function sport(t) {
    const s = SPORT[t && t.sport] || null;
    if (s === 'hike' && (t.tags || []).includes('Schneeschuh')) return 'snowshoe';
    return s;
  }

  const AKTIV = acc => !!(acc && (acc.token || acc.open));
  const VIEWER = 'Dafür brauchst du ein Konto mit Schreibrechten. Dieses Konto darf in Meine Touren nur ansehen. Melde dich unter „Touren importieren“ → „Meine Touren“ mit deinem eigenen Konto an (Verbindung trennen, dann neu anmelden).';

  /** Darf diese Tour gesendet werden? Gibt { ok, grund, code } zurück. code: 'verbindung' | 'geplant' | 'zeit' | 'schon' | 'betrachter' | 'spur'.
      Geplante Touren bleiben im Tagebuch; ohne Zeitstempel in der Spur nimmt Meine Touren sie nicht an; stammt die Tour von dort (oder ist schon verknüpft), gibt es nichts zu senden. */
  function pruefen(t, acc) {
    if (!AKTIV(acc)) return { ok: false, code: 'verbindung', grund: 'Es besteht keine Verbindung zu Meine Touren. Unter „Touren importieren“ → „Meine Touren“ lässt sie sich herstellen.' };
    if (!t) return { ok: false, code: 'spur', grund: 'Diese Tour gibt es nicht mehr.' };
    if (t.status === 'planned') return { ok: false, code: 'geplant', grund: 'Geplante Touren bleiben im Tagebuch. Gesendet werden nur gelaufene oder gefahrene Touren.' };
    if (t.src === 'mt' || t.mtId || /^mt:/.test(t.srcId || '')) return { ok: false, code: 'schon', grund: 'Diese Tour stammt aus Meine Touren oder ist dort schon vorhanden.' };
    if (!t.timed || !(t.start > 0)) return { ok: false, code: 'zeit', grund: 'Die Strecke hat keine Zeitstempel. Meine Touren braucht sie, um die Tour einzuordnen.' };
    if (acc.role === 'viewer') return { ok: false, code: 'betrachter', grund: VIEWER };
    return { ok: true, code: '', grund: '' };
  }
  /** Zeigt die Tourseite den Eintrag „An Meine Touren senden“? Bei bestehender Verbindung für jede gelaufene Tour, die nicht von dort stammt – auch für ein Konto „nur ansehen“
      (dann erklärt die App beim Tippen, warum es nicht geht). */
  function sichtbar(t, acc) {
    if (!AKTIV(acc) || !t || t.status === 'planned') return false;
    return !(t.src === 'mt' || t.mtId || /^mt:/.test(t.srcId || ''));
  }
  /** Touren, die sich senden lassen, neueste zuerst (ausgeblendete und geplante nicht). */
  function kandidaten(tours, acc) {
    return (tours || []).filter(t => t && !t.hidden && pruefen(t, Object.assign({}, acc, { role: 'owner' })).ok).sort((a, b) => (b.start || 0) - (a.start || 0));
  }

  /** Gibt es die Tour am Server schon? Gleicher Start (± 5 Minuten) und, wo beide eine Länge haben, ähnliche Länge (± 10 %, mindestens 300 m) – wie beim Holen.
      liste: Antwort von GET /api/tours ({ id, start_ts (s), dist_m }). Gibt den nächstliegenden Eintrag oder null zurück. */
  function passend(t, liste) {
    const st = t.start, dist = +t.dist || 0;
    if (!(st > 0)) return null;
    let best = null, bd = Infinity;
    for (const e of liste || []) {
      if (!e || e.id == null || !(e.start_ts > 0)) continue;
      const d = Math.abs(e.start_ts * 1000 - st);
      if (d > 300000) continue;
      const ed = +e.dist_m || 0;
      if (dist && ed && Math.abs(ed - dist) > Math.max(300, 0.1 * Math.max(dist, ed))) continue;
      if (d < bd) { best = e; bd = d; }
    }
    return best;
  }

  /** Antwort des Servers auf das Hochladen → Text für den Menschen. status: HTTP-Status; detail: das „detail“ der Antwort (wenn vorhanden). */
  function fehlerText(status, detail) {
    if (status === 403) return VIEWER;
    if (status === 401) return 'Die Anmeldung bei Meine Touren ist abgelaufen. Bitte neu anmelden.';
    if (status === 413) return 'Die Strecke ist zu groß für Meine Touren.';
    if (status === 400) return 'Meine Touren hat die Strecke nicht angenommen' + (detail ? ': ' + detail : '') + '.';
    if (status === 404) return 'Auf diesem Server gibt es das Hochladen nicht. Ist Meine Touren auf dem neuesten Stand?';
    if (status === 409 || status === 429) return 'Meine Touren ist gerade beschäftigt. Bitte später noch einmal versuchen.';
    if (status >= 500) return 'Meine Touren hat einen Fehler gemeldet (HTTP ' + status + ')' + (detail ? ': ' + detail : '') + '.';
    return 'Senden fehlgeschlagen (HTTP ' + status + ')' + (detail ? ': ' + detail : '') + '.';
  }
  /** Lohnt ein neuer Versuch? Dauerhafte Gründe (Rechte, Anmeldung, die Strecke selbst) nicht; Netz und Serverfehler schon. */
  const WIEDER = status => status == null || status === 0 || status === 409 || status === 429 || status >= 500;

  /* ---- Warteschlange des automatischen Sendens: [{ id, n }] (n = bisherige Fehlversuche) ---- */
  const MAX_VERSUCHE = 5;
  function queueAdd(q, id) { q = Array.isArray(q) ? q.slice() : []; if (id && !q.some(e => e.id === id)) q.push({ id, n: 0 }); return q; }
  /** Nach einem Versuch: ok → raus; Fehler, der sich wiederholen lässt → n + 1 (nach MAX_VERSUCHE raus); dauerhafter Fehler → raus. */
  function queueNach(q, id, ergebnis) {
    return (q || []).flatMap(e => {
      if (e.id !== id) return [e];
      if (ergebnis.ok || !ergebnis.wieder) return [];
      return e.n + 1 >= MAX_VERSUCHE ? [] : [{ id: e.id, n: e.n + 1 }];
    });
  }

  /** Meldung nach dem Senden mehrerer Touren. r: { gesendet, vorhanden, fehler: [{ name, text }], stopped }. */
  function zusammen(r) {
    const p = [];
    if (r.gesendet) p.push(r.gesendet + (r.gesendet === 1 ? ' Tour gesendet' : ' Touren gesendet'));
    if (r.vorhanden) p.push(r.vorhanden + (r.vorhanden === 1 ? ' war schon vorhanden' : ' waren schon vorhanden'));
    if (r.fehler && r.fehler.length) p.push(r.fehler.length + (r.fehler.length === 1 ? ' nicht gesendet' : ' nicht gesendet') + ': ' + r.fehler[0].text);
    if (r.stopped) p.push('abgebrochen – der Rest bleibt unverändert');
    return p.join(' · ') || 'Nichts zu senden';
  }

  const api = { SPORT, VIEWER, sport, pruefen, sichtbar, kandidaten, passend, fehlerText, WIEDER, MAX_VERSUCHE, queueAdd, queueNach, zusammen };
  if (node) module.exports = api; else root.SendenCalc = api;
})(typeof window !== 'undefined' ? window : globalThis);
