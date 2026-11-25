'use strict';
/* Rechenlogik ohne Oberfläche: Jahresrückblick (2.3.0). Alles rechnet auf den Touren im Gerät; ein Tag und ein Jahr sind – wie in der Statistik –
   Kalendertag und Kalenderjahr in Ortszeit des Geräts (new Date(start)). Die Filterregel und die fünf Kennzahlen sind dieselben wie in der Jahresstatistik
   (js/v-stats.js benutzt `Jahr.zaehlt` und `Jahr.kennzahlen` selbst), damit beide Seiten nie voneinander abweichen.
   Touren sind {id, name, sport, start (ms), dist (m), up (m), dur (s), moving (s), maxAlt (m), stars …}. Läuft im Browser (globales `Jahr`) und in Node. */
(function (root) {
  const node = typeof module !== 'undefined' && module.exports;
  const SG = node ? require('./calc-statgruppen.js') : root.StatGruppen;      // 2.19.0: eigene Statistik-Gruppen ersetzen die festen für ihre Sportarten
  const Z = node ? require('./calc-ziele.js') : root.Ziele, PH = node ? require('./calc-planhilfe.js') : root.Planhilfe, AB = node ? require('./calc-abgleich.js') : root.Abgleich;

  /** Sportgruppen des Rückblicks bis 2.18 (nur noch zum Nachschlagen; seit 2.19.0 sind es die Standardgruppen in calc-statgruppen.js, änderbar unter Einstellungen). */
  const GRUPPEN = [
    ['wandern', 'Wandern', ['hike', 'walk'].concat(PH.SPORT_GRP.foot)],
    ['laufen', 'Laufen', PH.SPORT_GRP.run],
    ['rad', 'Rad', PH.SPORT_GRP.bike],
    ['ski', 'Ski', PH.SPORT_GRP.ski],
  ];
  const MONATE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

  /** Zählt die Tour in der Statistik? Gelaufen (nicht geplant), nicht ausgeblendet, mit Startzeit. (Touren ohne Uhrzeit zählen mit, wie in der Statistik.) */
  const zaehlt = t => !!t && t.status !== 'planned' && !t.hidden && typeof t.start === 'number' && isFinite(t.start);
  const jahrVon = t => new Date(t.start).getFullYear();
  const sum = (ts, k) => ts.reduce((a, t) => a + (t[k] || 0), 0);

  /** Die fünf Kennzahlen eines Zeitraums – genau wie die Übersicht der Jahresstatistik: Strecke, Aufstieg, Zeit (Zeit in Bewegung, sonst Dauer), aktive Tage. */
  function kennzahlen(ts) {
    return { n: ts.length, dist: sum(ts, 'dist'), up: sum(ts, 'up'), zeit: sum(ts, 'moving') || sum(ts, 'dur'), tage: new Set(ts.map(t => new Date(t.start).toDateString())).size };
  }
  /** Jahre mit mindestens einer gezählten Tour, neueste zuerst. */
  function jahre(all) { return [...new Set((all || []).filter(zaehlt).map(jahrVon))].sort((a, b) => b - a); }
  /** Welches Jahr zeigt die Seite ohne Angabe? Das laufende; im Januar das Vorjahr, wenn es Touren hat (der Rückblick ist dann gerade fertig). */
  function vorgabe(all, now) {
    now = now || new Date();
    const y = now.getFullYear(), js = jahre(all);
    return now.getMonth() === 0 && js.includes(y - 1) ? y - 1 : y;
  }
  /** Jahr aus der Adresse (`#/jahr/2025`): nur ein sinnvolles vierstelliges Jahr, sonst die Vorgabe. */
  function waehle(param, all, now) {
    const s = String(param == null ? '' : param).trim();
    if (/^\d{4}$/.test(s) && +s >= 1970 && +s <= 2200) return +s;
    return vorgabe(all, now);
  }

  /** Aufteilung nach Sportart. 2.19.0: nach den Statistik-Gruppen (calc-statgruppen.js; Vorgabe: die geltenden, ohne Änderung die Standardgruppen Wandern,
      Rad, Ski – dieselbe Aufteilung wie GRUPPEN bis 2.18). Sportarten ohne Gruppe stehen für sich, „Sonstiges“ wie gehabt. Schlüssel: 'sgrp:<id>', 'laufen',
      die Sportart oder 'sonst'. */
  function nachSportart(ts, gruppen) {
    const gr = gruppen === undefined ? SG.aktuell() : gruppen, by = new Map();
    ts.forEach(t => { const [key, label] = SG.rueckblickZeile(t.sport, gr); if (!by.has(key)) by.set(key, { key, label, ts: [] }); by.get(key).ts.push(t); });
    const total = sum(ts, 'dist');
    return [...by.values()].map(g => {
      const k = kennzahlen(g.ts);
      return { key: g.key, label: g.label, n: k.n, dist: k.dist, up: k.up, zeit: k.zeit, anteil: total > 0 ? k.dist / total : k.n / ts.length };
    }).sort((a, b) => b.anteil - a.anteil || b.n - a.n || (a.key < b.key ? -1 : 1));
  }
  function nachMonat(ts) {
    const m = Array.from({ length: 12 }, (_, i) => ({ m: i, name: MONATE[i], n: 0, dist: 0, up: 0, zeit: 0 }));
    ts.forEach(t => { const g = m[new Date(t.start).getMonth()]; g.n++; g.dist += t.dist || 0; g.up += t.up || 0; g.zeit += t.moving || t.dur || 0; });
    return m;
  }
  /** Die häufigsten Regionen. namen: Funktion Tour → Regionsname (leer = unbekannt); nur Touren mit bekanntem Namen zählen. Nichts wird erfunden. */
  function regionen(ts, namen, max) {
    const by = new Map();
    ts.forEach(t => { const r = namen ? namen(t) : ''; if (!r) return; const g = by.get(r) || { name: r, n: 0, dist: 0 }; g.n++; g.dist += t.dist || 0; by.set(r, g); });
    return [...by.values()].sort((a, b) => b.n - a.n || b.dist - a.dist || a.name.localeCompare(b.name, 'de')).slice(0, max || 5);
  }
  /** Die höchste Bewertung des Jahres (nur bewertete Touren). Gleiche Sterne: die längere Tour, dann die frühere. gleiche = Zahl der Touren mit denselben Sternen. */
  function schoenste(ts) {
    const rated = ts.map(t => ({ t, s: AB.sterne(t) })).filter(x => x.s > 0);
    if (!rated.length) return null;
    rated.sort((a, b) => b.s - a.s || (b.t.dist || 0) - (a.t.dist || 0) || a.t.start - b.t.start);
    return { tour: rated[0].t, sterne: rated[0].s, gleiche: rated.filter(x => x.s === rated[0].s).length };
  }
  function aktivsterMonat(monate) {
    const ok = monate.filter(g => g.n > 0).sort((a, b) => b.dist - a.dist || b.n - a.n || a.m - b.m);
    return ok.length ? ok[0] : null;
  }
  const diff = (a, b) => ({ n: a.n - b.n, dist: a.dist - b.dist, up: a.up - b.up, zeit: a.zeit - b.zeit, tage: a.tage - b.tage });

  /** Alles für die Seite und die Bildkarte. all: alle Touren (auch geplante und ausgeblendete – sie werden hier aussortiert), year, now, opts.regionen (Tour → Name),
      opts.gruppen (Statistik-Gruppen, Vorgabe: die gespeicherten).
      vorjahr gibt es nur, wenn das Vorjahr Touren hat; im laufenden Jahr wird bis zum gleichen Kalendertag des Vorjahres verglichen (bisHeute), sonst Jahr gegen Jahr. */
  function berechne(all, year, now, opts) {
    now = now || new Date(); opts = opts || {};
    const gz = (all || []).filter(zaehlt), ts = gz.filter(t => jahrVon(t) === year);
    if (!ts.length) return { year, leer: true, n: 0, kennzahlen: kennzahlen([]), vorjahr: null, sportarten: [], monate: nachMonat([]), hoehepunkte: null, regionen: [], ids: [] };
    const k = kennzahlen(ts), bw = Z.bestwerte(ts, 1), monate = nachMonat(ts);
    let vorjahr = null, pv = gz.filter(t => jahrVon(t) === year - 1);
    const bisHeute = year === now.getFullYear();
    if (bisHeute) { const d = now.getMonth() === 1 && now.getDate() === 29 ? 28 : now.getDate(), grenze = new Date(year - 1, now.getMonth(), d, 23, 59, 59, 999).getTime(); pv = pv.filter(t => t.start <= grenze); }
    if (pv.length) { const kv = kennzahlen(pv); vorjahr = { year: year - 1, bisHeute, kennzahlen: kv, diff: diff(k, kv) }; }
    return {
      year, leer: false, n: ts.length, kennzahlen: k, vorjahr, monate, sportarten: nachSportart(ts, opts.gruppen), regionen: regionen(ts, opts.regionen),
      hoehepunkte: { laengste: bw.strecke[0] || null, aufstieg: bw.aufstieg[0] || null, hoechster: bw.hoehe[0] || null,
        serieWochen: Z.serie(ts, new Date(year, 11, 31)).rekord, monat: aktivsterMonat(monate), schoenste: schoenste(ts) },
      ids: ts.map(t => t.id),
    };
  }
  /** Startseite: Eintrag „Dein Jahr …“. hervor = Dezember und Januar (und das Jahr hat Touren). */
  function vorschlag(all, now) {
    now = now || new Date();
    const year = vorgabe(all, now), n = (all || []).filter(t => zaehlt(t) && jahrVon(t) === year).length, m = now.getMonth();
    return { year, n, hervor: n > 0 && (m === 11 || m === 0) };
  }

  const api = { GRUPPEN, MONATE, zaehlt, kennzahlen, jahre, vorgabe, waehle, nachSportart, nachMonat, regionen, schoenste, aktivsterMonat, berechne, vorschlag };
  if (node) module.exports = api; else root.Jahr = api;
})(typeof window !== 'undefined' ? window : globalThis);
