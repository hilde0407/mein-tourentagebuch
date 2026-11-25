'use strict';
/* 2.19.0: Rechenlogik ohne Oberfläche für die „Statistik-Gruppen“ – Sportarten, die die Statistik zusammengefasst führt (z. B. Wandern + Bergsteigen).
   Eine Gruppe ist {id, name, sports: [Sportart-Schlüssel aus Sports.list]}; die Liste steht in der Einstellung „statGruppen“ (Set_, kv „settings“) und
   reist mit der Sicherung. Grenzen: höchstens 8 Gruppen, Name 1–30 Zeichen, mindestens 2 Sportarten je Gruppe, jede Sportart höchstens in einer Gruppe,
   nur bekannte Sportarten. Vorgabe: leer – jede Aktivität steht für sich (es gibt keine festen Zusammenfassungen mehr; jeder entscheidet selbst).
   Ein-Klick-Vorschläge (Wandern + Bergsteigen + Schneeschuh, alle Rad-Arten, alle Ski-Arten) legen nur auf Wunsch eine Gruppe an.
   Die Touren selbst ändern sich nie – nur die Auswertung fasst zusammen.
   Kennung einer Gruppe in Filtern und Zielen: 'sgrp:<id>' (neben den festen Gruppen 'grp:ski', 'grp:bike' …). Eine gelöschte Gruppe passt auf keine Tour
   und heißt „Gelöschte Gruppe“ – nie ein Fehler.
   Alle Stellen (Statistik, Bestwerte je Sportart, Auswertung, Jahresrückblick, Ziele, Startseite) rechnen hiermit (Jahresrückblick: rueckblick()).
   Läuft im Browser (globales `StatGruppen`) und in Node (tests/test_calc.js). */
(function (root) {
  const node = typeof module !== 'undefined' && module.exports;
  const PH = node ? require('./calc-planhilfe.js') : root.Planhilfe;
  const MAX = 8, NAME_MAX = 30, MIN_SPORTS = 2, PREFIX = 'sgrp:';
  /** Ein-Klick-Vorschläge in den Einstellungen – nur Vorschläge, nie automatisch. */
  const VORSCHLAEGE = [
    { id: 'berg', name: 'Wandern + Berg + Schneeschuh', knopf: 'Wandern + Bergsteigen + Schneeschuh', sports: ['hike', 'mountaineering', 'snowshoe'] },
    { id: 'rad', name: 'Rad', knopf: 'Alle Rad-Arten', sports: ['bike', 'commute', 'racebike', 'mtb', 'gravel', 'cyclocross', 'bmx', 'ebike', 'emtb'] },
    { id: 'ski', name: 'Ski', knopf: 'Alle Ski-Arten', sports: ['skialpin', 'skitour', 'nordic', 'snowboard', 'ski'] },
  ];

  /** Die Sportarten der App (Sports aus parse.js; erst beim Aufruf geholt, weil parse.js im Browser nach den calc-Dateien lädt). */
  function S() {
    if (node) return require('./parse.js').Sports;
    return typeof Sports !== 'undefined' ? Sports : root.Sports;      // eslint-disable-line no-undef
  }
  const bekannt = () => S().list.map(s => s[0]);

  /** Name säubern: Leerraum zusammenziehen, höchstens 30 Zeichen (nach Unicode-Zeichen, nicht nach UTF-16-Einheiten). */
  function nameSauber(n) {
    const s = String(n == null ? '' : n).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
    return Array.from(s).slice(0, NAME_MAX).join('').trim();
  }
  /** Ersatzname aus den Sportarten („Wandern + Bergsteigen“), gekürzt auf 30 Zeichen. */
  const ersatzName = sports => nameSauber(sports.map(s => S().label(s)).join(' + ')) || 'Gruppe';

  /** Freie Kennung „g1“, „g2“ … (kurz, nur Kleinbuchstaben und Ziffern). */
  function neueId(list, extra) {
    const ids = new Set((list || []).map(g => g && g.id).concat(extra || []));
    let i = 1; while (ids.has('g' + i)) i++;
    return 'g' + i;
  }

  /** Liste prüfen und bereinigen (beim Laden, Speichern, Wiederherstellen). Was nicht taugt, fällt weg; nie ein Fehler.
      Sportarten: nur bekannte, ohne Doppel, keine, die schon in einer früheren Gruppe steht; weniger als 2 → Gruppe fällt weg.
      Name leer → aus den Sportarten. Kennung ungültig oder doppelt → neu. Höchstens 8 Gruppen. */
  function sauber(list) {
    if (!Array.isArray(list)) return [];
    const ok = new Set(bekannt()), belegt = new Set(), out = [], ids = [];
    for (const g of list) {
      if (out.length >= MAX) break;
      if (!g || typeof g !== 'object' || !Array.isArray(g.sports)) continue;
      const sports = [];
      for (const s of g.sports) if (typeof s === 'string' && ok.has(s) && !belegt.has(s) && !sports.includes(s)) sports.push(s);
      if (sports.length < MIN_SPORTS) continue;
      let id = typeof g.id === 'string' && /^[a-z0-9]{1,16}$/.test(g.id) && !ids.includes(g.id) ? g.id : null;
      if (!id) id = neueId(list.filter(x => x && typeof x.id === 'string'), ids);
      ids.push(id); sports.forEach(s => belegt.add(s));
      out.push({ id, name: nameSauber(g.name) || ersatzName(sports), sports });
    }
    return out;
  }

  /** Prüfung für die Oberfläche: je Gruppe (in der Reihenfolge des Entwurfs) ein Hinweis oder ''. Ein Entwurf darf unfertige Gruppen haben;
      gespeichert wird nur, was sauber() übrig lässt. */
  function pruefe(list) {
    const belegt = new Set(), ok = new Set(bekannt());
    return (Array.isArray(list) ? list : []).map((g, i) => {
      if (i >= MAX) return 'Höchstens ' + MAX + ' Gruppen.';
      const sports = (g && Array.isArray(g.sports) ? g.sports : []).filter(s => ok.has(s) && !belegt.has(s));
      sports.forEach(s => belegt.add(s));
      if (!nameSauber(g && g.name)) return 'Bitte einen Namen eingeben (1 bis ' + NAME_MAX + ' Zeichen).';
      if (sports.length < MIN_SPORTS) return 'Mindestens ' + MIN_SPORTS + ' Sportarten wählen – vorher zählt die Gruppe nicht.';
      return '';
    });
  }

  /** Die Gruppe einer Sportart oder null. */
  function gruppeVon(sport, gruppen) { return (gruppen || []).find(g => g.sports.includes(sport)) || null; }
  /** Die Gruppe zu einer Kennung 'sgrp:<id>' oder null (auch bei gelöschter Gruppe). */
  function gruppe(key, gruppen) {
    if (typeof key !== 'string' || !key.startsWith(PREFIX)) return null;
    const id = key.slice(PREFIX.length);
    return (gruppen || []).find(g => g.id === id) || null;
  }
  const istGruppe = key => typeof key === 'string' && key.startsWith(PREFIX);
  /** Schlüssel, unter dem eine Sportart in Aufteilungen steht: 'sgrp:<id>' für Gruppenmitglieder, sonst die Sportart selbst. */
  function schluessel(sport, gruppen) { const g = gruppeVon(sport, gruppen); return g ? PREFIX + g.id : (sport || 'other'); }

  /** Name eines Schlüssels: Gruppe → ihr Name (gelöscht → „Gelöschte Gruppe“), sonst die Sportart. */
  function name(key, gruppen) {
    if (istGruppe(key)) { const g = gruppe(key, gruppen); return g ? g.name : 'Gelöschte Gruppe'; }
    return S().label(key);
  }
  /** Symbol eines Schlüssels: Gruppe → Symbol der ersten Sportart, sonst das der Sportart. */
  function icon(key, gruppen) {
    if (istGruppe(key)) { const g = gruppe(key, gruppen); return S().icon(g ? g.sports[0] : 'other'); }
    return S().icon(key);
  }
  /** Farbe (Schlüssel für MapKit.sportColor): Gruppe → Farbe der ersten Sportart. */
  function farbSport(key, gruppen) { if (istGruppe(key)) { const g = gruppe(key, gruppen); return g ? g.sports[0] : 'other'; } return key; }

  /** Passt eine Tour dieser Sportart zur Auswahl sel? '' = alle, 'sgrp:<id>' = eigene Gruppe (gelöscht: keine), 'grp:<x>' = feste Gruppe
      (grp:ski, grp:bike, grp:foot, grp:run wie in calc-planhilfe.js), sonst genau die Sportart. */
  function passt(sel, sport, gruppen) {
    if (!sel) return true;
    if (istGruppe(sel)) { const g = gruppe(sel, gruppen); return !!g && g.sports.includes(sport); }
    if (sel.startsWith('grp:')) return (PH.SPORT_GRP[sel.slice(4)] || []).includes(sport);
    return sel === sport;
  }
  /** Gibt es die Auswahl noch? (Für gespeicherte Filter: sonst zurück auf „Alle“.) */
  const gueltig = (sel, gruppen) => !istGruppe(sel) || !!gruppe(sel, gruppen);

  /** Einträge für Auswahllisten (Sportartfilter, Ziele): [['sgrp:g1', 'Wandern und Bergsteigen (zusammengefasst)'], …]. */
  function auswahl(gruppen) { return (gruppen || []).map(g => [PREFIX + g.id, g.name + ' (zusammengefasst)']); }

  /** Touren nach Schlüssel aufteilen (Gruppen zusammengefasst): Map Schlüssel → Touren, in der Reihenfolge des ersten Auftretens. */
  function aufteilen(ts, gruppen) {
    const by = new Map();
    (ts || []).forEach(t => { const k = schluessel(t.sport || 'other', gruppen); if (!by.has(k)) by.set(k, []); by.get(k).push(t); });
    return by;
  }

  /** Zeile des Jahresrückblicks für eine Sportart: [Schlüssel, Name]. Gruppe → ['sgrp:<id>', Name]; „Sonstiges“ und Unbekanntes → ['sonst', 'Sonstiges'];
      jede andere Sportart steht für sich (2.19.0: keine festen Gruppen mehr). */
  function rueckblickZeile(sport, gruppen) {
    const g = gruppeVon(sport, gruppen);
    if (g) return [PREFIX + g.id, g.name];
    if (!sport || sport === 'other' || !bekannt().includes(sport)) return ['sonst', 'Sonstiges'];
    return [sport, S().label(sport)];
  }

  /** Die Vorschläge, die gerade möglich sind: noch Platz, keine ihrer Sportarten schon in einer Gruppe. [{id (frei), name, knopf, sports}]. */
  function vorschlaege(gruppen) {
    gruppen = gruppen || [];
    if (gruppen.length >= MAX) return [];
    return VORSCHLAEGE.filter(v => !v.sports.some(s => gruppeVon(s, gruppen)))
      .map(v => ({ id: gruppen.some(g => g.id === v.id) ? neueId(gruppen) : v.id, name: v.name, knopf: v.knopf, sports: v.sports.slice() }));
  }

  /** Sicherung einspielen: Wie bei den übrigen Einstellungen gilt die eigene Einstellung des Geräts – sind hier schon Gruppen angelegt, bleiben sie;
      sonst kommen die (bereinigten) Gruppen aus der Sicherung. Eine Sicherung ohne den Schlüssel (vor 2.19.0) ändert nichts. */
  function einspielen(vorhanden, ausSicherung) {
    const hier = sauber(vorhanden);
    return hier.length ? hier : sauber(ausSicherung);
  }
  /** Die Gruppen aus der Merkliste einer Sicherung (data.kv: [{k, v}]; Eintrag „settings“ → statGruppen), bereinigt; fehlt etwas, leer. */
  function ausSicherung(kv) {
    const e = (Array.isArray(kv) ? kv : []).find(x => x && x.k === 'settings');
    return sauber(e && e.v && typeof e.v === 'object' ? e.v.statGruppen : undefined);
  }

  /** Die gespeicherten Gruppen (Einstellung „statGruppen“), bereinigt; ohne Einstellungen (Node) leer. Zwischengespeichert je gespeichertem Wert. */
  let cacheRoh = {}, cacheWert = [];
  function aktuell() {
    let roh;
    try { roh = typeof Set_ !== 'undefined' ? Set_.get('statGruppen') : undefined; } catch (e) { roh = undefined; }      // eslint-disable-line no-undef
    if (roh === cacheRoh) return cacheWert;
    cacheRoh = roh; cacheWert = sauber(roh);
    return cacheWert;
  }

  const api = { MAX, NAME_MAX, MIN_SPORTS, PREFIX, VORSCHLAEGE, nameSauber, neueId, sauber, pruefe, gruppeVon, gruppe, istGruppe, schluessel, name, icon, farbSport,
    passt, gueltig, auswahl, aufteilen, rueckblickZeile, vorschlaege, einspielen, ausSicherung, aktuell };
  if (node) module.exports = api; else root.StatGruppen = api;
})(typeof window !== 'undefined' ? window : globalThis);
