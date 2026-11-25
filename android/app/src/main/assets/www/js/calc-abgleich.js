'use strict';
/* Rechenlogik ohne Oberfläche für 2.2.0: „Alles abgleichen“ (Reihenfolge, Zeilen, wann automatisch), eigene Bewertung (Sterne) und
   die Zählung der Ski-Touren nach der Trennung der Wintersportarten. Läuft im Browser (globales `Abgleich`) und in Node (tests/test_calc.js). */
(function (root) {
  const NAMEN = { zepp: 'Zepp', komoot: 'Komoot', mt: 'Meine Touren' };
  /** Reihenfolge bei „Alles abgleichen“: Zepp → Komoot → Meine Touren.
      Meine Touren zuletzt: Es ergänzt nur (Name, Sportart, Notiz, Zahlen) und liefert Strecken auf rund 1500 Punkte gekürzt – was Zepp oder Komoot schon
      in voller Auflösung mitbringen, ordnet es zu, statt es neu zu laden. Name (Meine Touren vor Komoot vor selbst erzeugt) und Zahlen (Meine Touren
      vor eigener Rechnung vor Komoot) richten sich nicht nach der Reihenfolge, sondern nach festen Rangfolgen und kommen so immer gleich heraus. */
  const REIHENFOLGE = ['zepp', 'komoot', 'mt'];
  const TAG = 86400000, STUNDE = 3600000;
  const MIN_ABSTAND = 24 * STUNDE, MIN_VERSUCH = 1 * STUNDE;
  const p2 = n => String(n).padStart(2, '0');

  /* ---- Bewertung (Sterne) ---- */
  /** Die Bewertung einer Tour (0 = keine): von Hand gesetzt, sonst die aus Meine Touren (starsMt). */
  function sterne(t) {
    const ok = v => (typeof v === 'number' && v >= 1 ? Math.min(5, Math.round(v)) : 0);
    if (!t) return 0;
    return t.starsMan ? ok(t.stars) : (ok(t.stars) || ok(t.starsMt));
  }
  /** Abgleich mit Meine Touren: Server-Sterne übernehmen, solange die Bewertung in der App nicht von Hand geändert wurde (starsMan). Gibt true zurück, wenn sich etwas geändert hat. */
  function sterneUebernehmen(e, serverSterne) {
    const v = typeof serverSterne === 'number' && serverSterne >= 1 ? Math.min(5, Math.round(serverSterne)) : 0;
    const vor = JSON.stringify([e.stars, e.starsMt]);
    if (v) e.starsMt = v; else delete e.starsMt;
    if (!e.starsMan) { if (v) e.stars = v; else delete e.stars; }
    return JSON.stringify([e.stars, e.starsMt]) !== vor;
  }
  /** Tippen auf einen Stern: derselbe Stern noch einmal nimmt die Bewertung zurück. Setzt das Merkzeichen „von Hand“. Gibt die neue Bewertung zurück. */
  function sterneSetzen(t, n) {
    n = Math.max(0, Math.min(5, Math.round(+n || 0)));
    const neu = sterne(t) === n ? 0 : n;
    if (neu) t.stars = neu; else delete t.stars;
    t.starsMan = 1;
    return neu;
  }
  /** Sterne einer zusammengeführten Tour: eine von Hand gesetzte Bewertung gilt (die der bleibenden zuerst); sonst die vorhandene. */
  function sterneZusammen(keep, drop, t) {
    if (keep.starsMan) return t;
    if (drop.starsMan && sterne(drop)) { t.stars = sterne(drop); t.starsMan = 1; }
    else if (!sterne(keep) && sterne(drop)) { t.stars = sterne(drop); if (drop.starsMt != null && t.starsMt == null) t.starsMt = drop.starsMt; }
    return t;
  }

  /* ---- 2.19.0: Schneeschuh als eigene Sportart ---- */
  /** 2.19.0: neue Sportarten → Sportart, unter der die App sie bis 2.18 führte. */
  const BIS_2_18 = { snowshoe: 'hike', nordicwalking: 'hike', emtb: 'ebike', gravel: 'mtb', trailrun: 'run', snowboard: 'skialpin', climbing: 'mountaineering' };
  /** Gleiche Sportart für den Abgleich mit Meine Touren? Eine neue Sportart und die, unter der sie bis 2.18 lief (z. B. Schneeschuh ↔ Wandern, E-Mountainbike ↔ E-Bike),
      gelten als gleich – so stellt ein Abgleich nie still um und zeigt keinen Unterschied. Umstellen geht nur auf Knopfdruck (Schneeschuh) oder von Hand. */
  function sportGleich(a, b) {
    if (a === b || BIS_2_18[a] === b || BIS_2_18[b] === a) return true;
    // Schlüssel außerhalb des Katalogs (z. B. Gassigehen aus einem Zwischenstand) gelten als gleich mit ihrer Rückfall-Aktivität – die Tour bleibt unverändert.
    const S = typeof module !== 'undefined' && module.exports ? require('./parse.js').Sports : (typeof Sports !== 'undefined' ? Sports : root.Sports);      // eslint-disable-line no-undef
    if (!S || !S.anzeige || (S.bekannt(a) && S.bekannt(b))) return false;
    const x = S.anzeige(a), y = S.anzeige(b);
    return x === y || BIS_2_18[x] === y || BIS_2_18[y] === x;
  }
  /** Touren, die „Schneeschuh umstellen“ ändern würde: Wandern mit dem Schlagwort „Schneeschuh“, Sportart nicht von Hand gewählt. */
  function schneeschuhKandidaten(tours) { return (tours || []).filter(t => t && t.sport === 'hike' && !t.sportMan && (t.tags || []).includes('Schneeschuh')); }
  /** Eine Tour umstellen (Kopie): Sportart snowshoe, Schlagwort bleibt, Merker ssUm = 1 für Rückgängig. */
  function schneeschuhUmstellen(t) { return Object.assign({}, t, { sport: 'snowshoe', ssUm: 1 }); }
  /** Rückgängig: nur umgestellte Touren, die noch Schneeschuh sind, werden wieder Wandern. */
  function schneeschuhZurueckKandidaten(tours) { return (tours || []).filter(t => t && t.ssUm === 1 && t.sport === 'snowshoe'); }
  function schneeschuhZurueck(t) { const c = Object.assign({}, t, { sport: 'hike' }); delete c.ssUm; return c; }

  /* ---- Ski (Trennung der Wintersportarten) ---- */
  /** Wie viele Touren stehen noch als „Ski (allgemein)“ (ohne von Hand gewählte Sportart)? Die genaue Art kennt nur der Abgleich mit Meine Touren. */
  function skiOffen(tours) { return (tours || []).filter(t => t && t.sport === 'ski' && !t.sportMan && t.status !== 'planned').length; }

  /* ---- Anzeige ---- */
  /** „heute 08:12“, „gestern 21:40“, sonst „19.11. 08:12“ (mit Jahr, wenn es nicht dieses ist). */
  function wann(ms, nowMs) {
    if (!ms) return '';
    const d = new Date(ms), n = new Date(nowMs == null ? Date.now() : nowMs);
    const tag = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const diff = Math.round((tag(n) - tag(d)) / TAG), hm = p2(d.getHours()) + ':' + p2(d.getMinutes());
    if (diff === 0) return 'heute ' + hm;
    if (diff === 1) return 'gestern ' + hm;
    return p2(d.getDate()) + '.' + p2(d.getMonth() + 1) + '.' + (d.getFullYear() === n.getFullYear() ? '' : d.getFullYear()) + ' ' + hm;
  }
  /** Zahl neuer Touren über alle Quellen. */
  function neue(items) { return (items || []).reduce((a, i) => a + ((i && i.res && i.res.added) || 0), 0); }
  /** Zeile auf der Startseite: „Zuletzt abgeglichen: heute 08:12 · 2 neue Touren“. last = { t, neu, fehler }. */
  function zeile(last, nowMs) {
    if (!last || !last.t) return '';
    const p = ['Zuletzt abgeglichen: ' + wann(last.t, nowMs), last.neu ? (last.neu === 1 ? '1 neue Tour' : last.neu + ' neue Touren') : 'nichts Neues'];
    if (last.fehler) p.push(last.fehler === 1 ? '1 Quelle mit Fehler' : last.fehler + ' Quellen mit Fehler');
    return p.join(' · ');
  }
  /** Fehler einer Quelle als ein Satz; bei abgelaufener Anmeldung steht dabei, wo man sich neu anmeldet. */
  function fehlerText(id, err) {
    const m = String((err && err.message) || err || 'Unbekannter Fehler');
    const abgelaufen = !!(err && err.relogin) || (id === 'komoot' && /HTTP 40[13]|abgelehnt/.test(m)) || (id === 'zepp' && /abgelaufen|Token/.test(m));
    const wo = 'Mehr → Touren importieren → ' + (NAMEN[id] || id);
    if (abgelaufen) return (id === 'mt' ? 'Die Anmeldung ist abgelaufen.' : 'Die Anmeldung ist abgelaufen oder wird nicht mehr akzeptiert.') + ' Bitte unter ' + wo + ' neu anmelden.';
    return m;
  }
  /** Eine Zeile je Quelle für die Zusammenfassung. describe = Import.describe. */
  function quellZeile(item, describe) {
    if (item.err) return fehlerText(item.id, item.err);
    if (item.skipped) return 'Nicht ausgeführt (abgebrochen)';
    const t = describe(item.res || {});
    return t === 'Nichts gefunden' ? 'Nichts Neues' : t;
  }
  /** Soll beim Öffnen der App still abgeglichen werden? Nur wenn eingeschaltet, mindestens eine Quelle verbunden, keine Aufzeichnung läuft,
      der letzte Abgleich mindestens 24 Stunden her ist und ein Fehlversuch mindestens eine Stunde. */
  function faellig(o) {
    if (!o || !o.an || !(o.quellen > 0) || o.live) return false;
    const now = o.now == null ? Date.now() : o.now;
    if (o.last && now - o.last < MIN_ABSTAND && now >= o.last) return false;
    if (o.lastTry && now - o.lastTry < MIN_VERSUCH && now >= o.lastTry) return false;
    return true;
  }

  const api = { NAMEN, REIHENFOLGE, MIN_ABSTAND, MIN_VERSUCH, sterne, sterneUebernehmen, sterneSetzen, sterneZusammen, skiOffen, BIS_2_18, sportGleich, schneeschuhKandidaten, schneeschuhUmstellen, schneeschuhZurueckKandidaten, schneeschuhZurueck, wann, neue, zeile, fehlerText, quellZeile, faellig };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Abgleich = api;
})(typeof window !== 'undefined' ? window : globalThis);
