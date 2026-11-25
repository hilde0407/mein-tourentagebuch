'use strict';
/* Rechenlogik ohne Oberfläche: Ziele (Jahr und Woche, Prognose), Wochen-Serie, Bestwerte, Sicherungs-Erinnerung.
   Vorbild: „Meine Touren“ 3.45.0 (app/extras.py, app/hinweise.py, 52-bausteine-uebersicht.js). Alles rechnet auf den Touren im Gerät.
   Touren sind {id, name, sport, start (ms), dist (m), up (m), dur (s)}; Aufrufer reichen nur gelaufene, nicht ausgeblendete Touren herein.
   Läuft im Browser (globale `Ziele`, `Serie`, `Bestwerte`, `Sicherung`) und in Node (tests/test_calc.js). */
(function (root) {
  const PH = (typeof module !== 'undefined' && module.exports) ? require('./calc-planhilfe.js') : root.Planhilfe;
  const SG = (typeof module !== 'undefined' && module.exports) ? require('./calc-statgruppen.js') : root.StatGruppen;      // 2.19.0: Statistik-Gruppen
  const METRIKEN = [['km', 'Strecke', 'km'], ['up', 'Aufstieg', 'm'], ['count', 'Touren', 'Touren'], ['hours', 'Zeit', 'h']];
  const MIN_TAG_PROGNOSE = 14;      // Prognose zum Jahresende gibt es ab dem 14. Tag des Jahres (wie im Vorbild)
  const KNAPP = 0.90;               // Prognose ab 90 % des Ziels: „knapp“, darunter „dahinter“

  const dayNum = ms => { const d = new Date(ms); return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 864e5); };
  const weekIdx = ms => Math.floor((dayNum(ms) + 3) / 7);      // Montag bis Sonntag; der 1.1.1970 war ein Donnerstag

  /* ---- Ziele ---- */
  /** Sportauswahl eines Ziels: '' = alle, 'grp:bike' = feste Gruppe, 'sgrp:<id>' = eigene Statistik-Gruppe (2.19.0; gelöscht: zählt keine Tour), sonst eine Sportart.
      gruppen: Liste der Statistik-Gruppen (Vorgabe: die gespeicherten, in Node leer). */
  function sportPasst(goal, sport, gruppen) {
    const s = goal.sport || '';
    if (s === 'ski') return SG.passt('grp:ski', sport, []);      // ein Ziel „Ski“ aus der Zeit vor 2.2.0 zählt alle Skiarten
    return SG.passt(s, sport, gruppen === undefined ? SG.aktuell() : gruppen);
  }
  /** Ältere Jahresziele (kv „goals“: {Jahr: {km, up, n}}) als Liste neuer Ziele lesen. Die Kennungen sind fest, damit ein erneutes Einlesen nichts verdoppelt. */
  function legacy(old) {
    const out = [], map = { km: 'km', up: 'up', n: 'count' };
    for (const y of Object.keys(old || {})) {
      const g = old[y] || {};
      for (const k of Object.keys(map)) { const v = Number(g[k]); if (isFinite(v) && v > 0 && /^\d{4}$/.test(y)) out.push({ id: 'alt-' + y + '-' + k, period: 'year', year: +y, metric: map[k], target: v, sport: '' }); }
    }
    return out;
  }
  /** Ein Ziel prüfen und bereinigen (Werte aus Eingabe oder fremder Sicherung); null, wenn es nicht taugt. */
  function sauber(g) {
    if (!g || typeof g !== 'object') return null;
    const period = g.period === 'week' ? 'week' : 'year', metric = METRIKEN.some(m => m[0] === g.metric) ? g.metric : null, target = Number(g.target);
    if (!metric || !isFinite(target) || !(target > 0) || target > 1e7) return null;
    const year = period === 'week' ? 0 : Math.round(Number(g.year));
    if (period === 'year' && !(year >= 1970 && year <= 2200)) return null;
    return { id: String(g.id || ''), period, year, metric, target, sport: typeof g.sport === 'string' ? g.sport : '' };
  }
  /** Ziele aus der Sicherung zu den vorhandenen hinzufügen (nur Kennungen, die es noch nicht gibt). */
  function zusammen(vorhanden, neu) {
    const out = vorhanden.slice(), ids = new Set(vorhanden.map(g => g.id));
    for (const raw of neu) { const g = sauber(raw); if (g && g.id && !ids.has(g.id)) { out.push(g); ids.add(g.id); } }
    return out;
  }
  function wertEiner(goal, t) { return goal.metric === 'km' ? (t.dist || 0) / 1000 : goal.metric === 'up' ? (t.up || 0) : goal.metric === 'hours' ? (t.dur || 0) / 3600 : 1; }
  /** Stand eines Ziels zum Zeitpunkt now (Date). Rückgabe: {ist, target, anteil (0…), status, prognose, soll, restTage, text}.
      status Jahresziel: erreicht | im_plan | knapp | dahinter | offen (zu früh im Jahr oder Jahr noch nicht begonnen) | verfehlt (Jahr vorbei). Wochenziel: erreicht | offen. */
  function stand(goal, tours, now, gruppen) {
    now = now || new Date();
    const yr = now.getFullYear();
    let ts, soll = null, prognose = null, restTage = null, status;
    if (goal.period === 'week') {
      const wi = weekIdx(now.getTime()), until = dayNum(now.getTime());
      ts = tours.filter(t => t.start && weekIdx(t.start) === wi && dayNum(t.start) <= until && sportPasst(goal, t.sport, gruppen));
      restTage = 6 - ((now.getDay() + 6) % 7);
    } else {
      ts = tours.filter(t => t.start && new Date(t.start).getFullYear() === goal.year && sportPasst(goal, t.sport, gruppen));
    }
    const ist = ts.reduce((a, t) => a + wertEiner(goal, t), 0), anteil = ist / goal.target;
    if (ist >= goal.target) status = 'erreicht';
    else if (goal.period === 'week') status = 'offen';
    else if (goal.year < yr) status = 'verfehlt';
    else if (goal.year > yr) status = 'offen';
    else {
      const ylen = (goal.year % 4 === 0 && goal.year % 100 !== 0) || goal.year % 400 === 0 ? 366 : 365;
      const doy = Math.round((Date.UTC(yr, now.getMonth(), now.getDate()) - Date.UTC(yr, 0, 1)) / 864e5) + 1;
      soll = goal.target * doy / ylen;
      if (doy < MIN_TAG_PROGNOSE) status = 'offen';
      else { prognose = ist / (doy / ylen); status = prognose >= goal.target ? 'im_plan' : prognose >= goal.target * KNAPP ? 'knapp' : 'dahinter'; }
    }
    return { ist, target: goal.target, anteil, status, prognose, soll, restTage };
  }
  /** Ziele eines Jahres: die Jahresziele des Jahres und (nur für das laufende Jahr) die Wochenziele. */
  function fuerJahr(goals, year, nowYear) { return goals.filter(g => g.period === 'week' ? year === nowYear : g.year === year); }

  /* ---- Wochen-Serie ---- */
  /** aktuell: Wochen in Folge mit mindestens einer Tour (läuft weiter, solange diese Woche noch Zeit hat); rekord; wochenMit: Wochen mit Tour in den letzten 26; offen: diese Woche noch keine Tour, Serie > 0. */
  function serie(tours, now) {
    now = now || new Date();
    const set = new Set(tours.filter(t => t.start).map(t => weekIdx(t.start))), cur = weekIdx(now.getTime());
    let s = 0, w = set.has(cur) ? cur : cur - 1;
    while (set.has(w)) { s++; w--; }
    const all = [...set].sort((a, b) => a - b);
    let rekord = 0, run = 0;
    all.forEach((x, i) => { run = i && x === all[i - 1] + 1 ? run + 1 : 1; rekord = Math.max(rekord, run); });
    let mit = 0; for (let i = cur - 25; i <= cur; i++) if (set.has(i)) mit++;
    return { aktuell: s, rekord, wochenMit: mit, diese: set.has(cur), offen: !set.has(cur) && s > 0 };
  }

  /* ---- Bestwerte ---- */
  /** Die besten n Touren je Messgröße (nur Werte über 0; bei Gleichstand zuerst die frühere) und die stärksten n Monate nach Strecke. */
  function bestwerte(tours, n) {
    n = n === 3 ? 3 : 1;
    const top = f => tours.filter(t => f(t) > 0).sort((a, b) => f(b) - f(a) || (a.start || 0) - (b.start || 0)).slice(0, n);
    const by = new Map();
    tours.forEach(t => { if (!t.start) return; const d = new Date(t.start), k = d.getFullYear() * 12 + d.getMonth(); const g = by.get(k) || { y: d.getFullYear(), m: d.getMonth(), dist: 0, up: 0, n: 0 }; g.dist += t.dist || 0; g.up += t.up || 0; g.n++; by.set(k, g); });
    return { strecke: top(t => t.dist), aufstieg: top(t => t.up), dauer: top(t => t.dur), hoehe: top(t => t.maxAlt),
      monat: [...by.values()].filter(g => g.dist > 0).sort((a, b) => b.dist - a.dist || (a.y * 12 + a.m) - (b.y * 12 + b.m)).slice(0, n) };
  }

  /** 2.13.0: Bestwerte je Sportart (Rangliste): je Sportart mit mindestens min Touren (Vorgabe 2, nur Touren mit Strecke) die besten n (1 oder 3) für
      längste Strecke, größten Aufstieg, längste Dauer, höchsten Punkt und – wo sinnvoll – das schnellste Tempo. Tempo nur aus Zeit in Bewegung (über 10 min) und
      mindestens 1 km Strecke; bei Ski alpin und Ski allgemein nicht (Liftfahrten verfälschen das Tempo). Gleichstand: die frühere Tour zuerst.
      Gibt [{ sport, n, strecke, aufstieg, dauer, hoehe, tempo }] zurück, die Sportart mit den meisten Touren zuerst.
      2.19.0: gruppen (Statistik-Gruppen, Vorgabe: die gespeicherten) fasst Mitglieder zu einer Zeile zusammen; sport ist dann 'sgrp:<id>' und
      gruppe = true. Tempo gibt es dort nur, wenn keine Sportart der Gruppe ohne Tempo ist. */
  const OHNE_TEMPO = ['skialpin', 'ski'];
  const tempo = t => (t.moving > 600 && t.dist >= 1000 ? t.dist / t.moving : 0);
  function jeSportart(tours, n, min, gruppen) {
    n = n === 3 ? 3 : 1; min = min || 2;
    const gr = gruppen === undefined ? SG.aktuell() : gruppen;
    const real = (tours || []).filter(t => t && t.dist > 0), by = SG.aufteilen(real, gr);
    const top = (a, f) => a.filter(t => f(t) > 0).sort((x, y) => f(y) - f(x) || (x.start || 0) - (y.start || 0)).slice(0, n);
    const ohneTempo = k => { const g = SG.gruppe(k, gr); return g ? g.sports.some(s => OHNE_TEMPO.includes(s)) : OHNE_TEMPO.includes(k); };
    return [...by.entries()].filter(([, a]) => a.length >= min).map(([sport, a]) => Object.assign({ sport, n: a.length, strecke: top(a, t => t.dist), aufstieg: top(a, t => t.up || 0),
      dauer: top(a, t => t.dur || 0), hoehe: top(a, t => t.maxAlt || 0), tempo: ohneTempo(sport) ? [] : top(a, tempo) }, SG.istGruppe(sport) ? { gruppe: true } : {}))
      .sort((x, y) => y.n - x.n || (x.sport < y.sport ? -1 : 1));
  }

  /* ---- Sicherungs-Erinnerung ---- */
  const TAGE_AUSWAHL = [7, 14, 30, 0];      // 0 = aus
  /** Soll der Hinweis erscheinen? last = Zeitpunkt der letzten Sicherung (ms) oder null, tage = Schwelle (0 = aus), snooze = „Später“ bis (ms) oder null.
      Nur wenn es Touren gibt und die letzte Sicherung älter als die Schwelle ist (oder nie gemacht wurde). */
  function sicherungHinweis(nTouren, last, nowMs, tage, snooze) {
    tage = Number(tage);
    if (!(tage > 0) || !(nTouren > 0)) return { zeigen: false };
    if (snooze && nowMs < snooze) return { zeigen: false };
    if (!last) return { zeigen: true, nie: true, tage: null, text: 'Noch keine Sicherung gemacht' };
    const alt = nowMs - last;
    if (alt <= tage * 86400000) return { zeigen: false };
    const d = Math.floor(alt / 86400000);
    return { zeigen: true, nie: false, tage: d, text: 'Letzte Sicherung vor ' + d + (d === 1 ? ' Tag' : ' Tagen') };
  }

  const api = { METRIKEN, MIN_TAG_PROGNOSE, KNAPP, TAGE_AUSWAHL, weekIdx, dayNum, sportPasst, legacy, sauber, zusammen, wertEiner, stand, fuerJahr, serie, bestwerte, jeSportart, OHNE_TEMPO, tempo, sicherungHinweis };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else { root.Ziele = api; root.Serie = { berechne: serie }; root.Bestwerte = { berechne: bestwerte, jeSportart, tempo }; root.Sicherung = { hinweis: sicherungHinweis, TAGE_AUSWAHL }; }
})(typeof window !== 'undefined' ? window : globalThis);
