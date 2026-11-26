'use strict';
/* 2.19.0: Rechenlogik ohne Oberfläche für die „Statistik-Gruppen“ – Sportarten, die die Statistik zusammengefasst führt (z. B. Wandern + Bergsteigen).
   Eine Gruppe ist {id, name, sports: [Sportart-Schlüssel aus Sports.list]}; die Liste steht in der Einstellung „statGruppen“ (Set_, kv „settings“) und
   reist mit der Sicherung. Grenzen: höchstens 8 Gruppen, Name 1–30 Zeichen, mindestens 2 Sportarten je Gruppe, jede Sportart höchstens in einer Gruppe,
   nur bekannte Sportarten. Vorgabe: leer – jede Sportart steht für sich (es gibt keine festen Zusammenfassungen mehr; jeder entscheidet selbst).
   Ein-Klick-Vorschläge (Wandern + Bergsteigen + Schneeschuh, alle Rad-Arten, alle Ski-Arten) legen nur auf Wunsch eine Gruppe an.
   Die Touren selbst ändern sich nie – nur die Auswertung fasst zusammen. Eine Tour mit einem Schlüssel, der nicht im Katalog steht (z. B. aus einem
   Zwischenstand von 2.19.0), zählt überall als ihre Rückfall-Sportart (Sports.anzeige: Gassigehen → Spazieren / Gehen, sonst „Sonstiges“); solche
   Schlüssel in gespeicherten Gruppen fallen beim Bereinigen still weg.
   Kennung einer Gruppe in Filtern und Zielen: 'sgrp:<id>' (neben den festen Gruppen 'grp:ski', 'grp:bike' …). Eine gelöschte Gruppe passt auf keine Tour
   und heißt „Gelöschte Statistik-Gruppe“ – nie ein Fehler.
   Alle Stellen (Statistik, Bestwerte je Sportart, Auswertung, Jahresrückblick, Ziele, Startseite) rechnen hiermit (Jahresrückblick: rueckblick()).
   Läuft im Browser (globales `StatGruppen`) und in Node (tests/test_calc.js). */
(function (root) {
  const node = typeof module !== 'undefined' && module.exports;
  const PH = node ? require('./calc-planhilfe.js') : root.Planhilfe;
  const MAX = 8, NAME_MAX = 30, MIN_SPORTS = 2, PREFIX = 'sgrp:';
  /** Ein-Klick-Vorschläge in den Einstellungen – nur Vorschläge, nie automatisch. */
  const VORSCHLAEGE = [
    { id: 'berg', name: 'Wandern (gesamt)', knopf: 'Wandern + Bergsteigen + Schneeschuh', sports: ['hike', 'mountaineering', 'snowshoe'] },
    { id: 'rad', name: 'Rad', knopf: 'Alle Rad-Arten', sports: ['bike', 'racebike', 'mtb', 'gravel', 'ebike', 'emtb', 'bikepacking'] },
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
  /** 2.20.2: Kurzer Name zu einer Sportart-Liste: „<erste Sportart> (gesamt)“, z. B. „Wandern (gesamt)“ (höchstens 30 Zeichen; leer bei keiner Sportart).
      Das ist der Namensvorschlag im Editor und der Fallback von sauber(); nie eine Aufzählung. */
  const SUFFIX = ' (gesamt)';
  function kurzName(sports) {
    const erste = (Array.isArray(sports) ? sports : []).find(s => typeof s === 'string' && bekannt().includes(s));
    if (!erste) return '';
    return Array.from(S().label(erste)).slice(0, NAME_MAX - SUFFIX.length).join('').trim() + SUFFIX;
  }
  /** Die frühere Aufzählung „Wandern + Bergsteigen + Schneeschuhwandern“ (auf 30 Zeichen gekürzt), die bis 2.20.1 als Ersatzname diente. */
  const aufzaehlung = sports => nameSauber((sports || []).map(s => S().label(s)).join(' + '));
  /** Ist der Name der Gruppe nur die automatische Aufzählung der Sportarten (bis 2.20.1 als Ersatzname vergeben)? Dann false für leere Namen und echte Namen. */
  function nurAufzaehlung(g) {
    if (!g || !Array.isArray(g.sports) || g.sports.length < MIN_SPORTS) return false;
    const n = nameSauber(g.name);
    return !!n && n.includes(' + ') && vergleich(n) === vergleich(aufzaehlung(g.sports.filter(s => bekannt().includes(s))));
  }
  /** Der Namensvorschlag für eine Gruppe, wenn ihr Name nur eine Aufzählung ist (sonst ''). */
  const vorschlagName = g => nurAufzaehlung(g) ? kurzName(g.sports) : '';

  /** Freie Kennung „g1“, „g2“ … (kurz, nur Kleinbuchstaben und Ziffern). */
  function neueId(list, extra) {
    const ids = new Set((list || []).map(g => g && g.id).concat(extra || []));
    let i = 1; while (ids.has('g' + i)) i++;
    return 'g' + i;
  }

  /** Liste prüfen und bereinigen (beim Laden, Speichern, Wiederherstellen). Was nicht taugt, fällt weg; nie ein Fehler.
      Sportarten: nur bekannte, ohne Doppel, keine, die schon in einer früheren Gruppe steht; weniger als 2 → Gruppe fällt weg.
      Name leer (nur beschädigte/importierte Daten; der Editor verlangt einen Namen) → kurz „<Sportart> (gesamt)“. Kennung ungültig oder doppelt → neu. Höchstens 8 Gruppen. */
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
      out.push({ id, name: nameSauber(g.name) || kurzName(sports) || 'Gruppe', sports });
    }
    return out;
  }

  /* 2.19.1: Ein Gruppenname darf nicht wie eine Sportart des Katalogs heißen („Wandern (zusammengefasst)“ neben „Wandern“ war verwirrend).
     Verglichen wird ohne Groß-/Kleinschreibung und Leerzeichen. Bestehende Gruppen mit so einem Namen bleiben gültig (sauber() ändert und verwirft nichts,
     auch nicht beim Einspielen einer Sicherung); der Editor bittet ums Umbenennen und speichert einen neuen solchen Namen nicht (zumSpeichern). */
  const vergleich = n => String(n == null ? '' : n).toLowerCase().replace(/\s+/g, '');
  /** Name der Sportart, wie die der Gruppenname heißt, oder ''. */
  function nameWieAktivitaet(n) {
    const v = vergleich(nameSauber(n));
    if (!v) return '';
    const t = S().katalog.find(x => vergleich(x[1]) === v);
    return t ? t[1] : '';
  }
  /** Was gespeichert wird: der Entwurf, aber eine Gruppe mit einem Namen wie eine Sportart nur, wenn sie schon so gespeichert war
      (dann bleibt ihr bisheriger Name); eine neue oder so umbenannte Gruppe wird erst nach dem Umbenennen gespeichert (bis dahin: bisheriger Name). */
  function zumSpeichern(entwurf, gespeichert) {
    const alt = sauber(gespeichert);
    const out = [];
    for (const g of Array.isArray(entwurf) ? entwurf : []) {
      if (!g || typeof g !== 'object') continue;
      if (!nameWieAktivitaet(g.name)) { out.push(g); continue; }
      const vorher = alt.find(x => x.id === g.id);
      if (vorher) out.push(Object.assign({}, g, { name: vorher.name }));
    }
    return sauber(out);
  }

  /** Prüfung für die Oberfläche: je Gruppe (in der Reihenfolge des Entwurfs) ein Hinweis oder ''. Ein Entwurf darf unfertige Gruppen haben;
      gespeichert wird nur, was zumSpeichern()/sauber() übrig lässt. gespeichert (optional): die gespeicherten Gruppen – für den Hinweis bei älteren Namen. */
  function pruefe(list, gespeichert) {
    const belegt = new Set(), ok = new Set(bekannt()), alt = sauber(gespeichert);
    return (Array.isArray(list) ? list : []).map((g, i) => {
      if (i >= MAX) return 'Höchstens ' + MAX + ' Gruppen.';
      const sports = (g && Array.isArray(g.sports) ? g.sports : []).filter(s => ok.has(s) && !belegt.has(s));
      sports.forEach(s => belegt.add(s));
      if (!nameSauber(g && g.name)) return 'Bitte einen Namen eingeben (1 bis ' + NAME_MAX + ' Zeichen).';
      const wie = nameWieAktivitaet(g.name);
      if (wie) return 'Name wie eine Sportart („' + wie + '“) – bitte umbenennen, z. B. „' + wie + ' (alle)“. '
        + (alt.some(x => x.id === g.id) ? 'Bis dahin zählt die Gruppe weiter unter ihrem bisherigen Namen.' : 'Vorher wird die Gruppe nicht gespeichert.');
      if (sports.length < MIN_SPORTS) return 'Mindestens ' + MIN_SPORTS + ' Sportarten wählen – vorher zählt die Gruppe nicht.';
      return '';
    });
  }

  /** Die Gruppe einer Sportart oder null. */
  function gruppeVon(sport, gruppen) { const k = S().anzeige(sport); return (gruppen || []).find(g => g.sports.includes(k)) || null; }
  /** Die Gruppe zu einer Kennung 'sgrp:<id>' oder null (auch bei gelöschter Gruppe). */
  function gruppe(key, gruppen) {
    if (typeof key !== 'string' || !key.startsWith(PREFIX)) return null;
    const id = key.slice(PREFIX.length);
    return (gruppen || []).find(g => g.id === id) || null;
  }
  const istGruppe = key => typeof key === 'string' && key.startsWith(PREFIX);
  /** Schlüssel, unter dem eine Sportart in Aufteilungen steht: 'sgrp:<id>' für Gruppenmitglieder, sonst die Sportart selbst (nicht im Katalog: ihr Rückfall). */
  function schluessel(sport, gruppen) { const g = gruppeVon(sport, gruppen); return g ? PREFIX + g.id : S().anzeige(sport); }

  /** Name eines Schlüssels: Gruppe → ihr Name (gelöscht → „Gelöschte Statistik-Gruppe“), sonst die Sportart. */
  function name(key, gruppen) {
    if (istGruppe(key)) { const g = gruppe(key, gruppen); return g ? g.name : 'Gelöschte Statistik-Gruppe'; }
    return S().label(key);
  }
  /** 2.20.1: Beschriftung in Filtern, Zielen, Aufteilungen und Listen: Gruppe → nur ihr Name („Wandern (gesamt)“), gelöschte Gruppe →
      „Gelöschte Statistik-Gruppe“, sonst die Sportart. Die Zusammensetzung steht nur im title-/aria-Text (titel()) und im Editor der Gruppen. */
  function beschriftung(key, gruppen) {
    if (!istGruppe(key)) return S().label(key);
    const g = gruppe(key, gruppen);
    return g ? g.name : 'Gelöschte Statistik-Gruppe';
  }
  /** Die volle Schreibweise „Name = A + B + C“ (alle Mitglieder) für title/aria-label und den Editor; keine Gruppe oder gelöscht: ''. */
  function titel(key, gruppen) {
    const g = istGruppe(key) ? gruppe(key, gruppen) : null;
    return g ? g.name + ' = ' + g.sports.map(s => S().label(s)).join(' + ') : '';
  }
  /** Symbol eines Schlüssels: Gruppe → Symbol der ersten Sportart, sonst das der Sportart. */
  function icon(key, gruppen) {
    if (istGruppe(key)) { const g = gruppe(key, gruppen); return S().icon(g ? g.sports[0] : 'other'); }
    return S().icon(key);
  }
  /** Farbe (Schlüssel für MapKit.sportColor): Gruppe → Farbe der ersten Sportart. */
  function farbSport(key, gruppen) { if (istGruppe(key)) { const g = gruppe(key, gruppen); return g ? g.sports[0] : 'other'; } return S().anzeige(key); }

  /** Passt eine Tour dieser Sportart zur Auswahl sel? '' = alle, 'sgrp:<id>' = eigene Gruppe (gelöscht: keine), 'grp:<x>' = feste Gruppe
      (grp:ski, grp:bike, grp:foot, grp:run wie in calc-planhilfe.js), sonst genau die Sportart. Schlüssel außerhalb des Katalogs (an der Tour oder in der
      Auswahl, z. B. ein älteres Ziel) zählen als ihre Rückfall-Sportart. */
  function passt(sel, sport, gruppen) {
    if (!sel) return true;
    const k = S().anzeige(sport);
    if (istGruppe(sel)) { const g = gruppe(sel, gruppen); return !!g && g.sports.includes(k); }
    if (sel.startsWith('grp:')) return (PH.SPORT_GRP[sel.slice(4)] || []).includes(k);
    return S().anzeige(sel) === k;
  }
  /** Gibt es die Auswahl noch? (Für gespeicherte Filter: sonst zurück auf „Alle“.) */
  const gueltig = (sel, gruppen) => !istGruppe(sel) || !!gruppe(sel, gruppen);

  /** Einträge für Auswahllisten (Sportartfilter, Ziele): [['sgrp:g1', 'Bergtouren', 'Bergtouren = Wandern + Bergsteigen'], …] (2.20.1: nur der Name, die Zusammensetzung als Titel). */
  function auswahl(gruppen) { return (gruppen || []).map(g => [PREFIX + g.id, beschriftung(PREFIX + g.id, gruppen), titel(PREFIX + g.id, gruppen)]); }

  /** 2.19.1: Die eine Auswahl für Sportart-Chips (Karte, Tourenliste): nur Sportarten, die in den Touren vorkommen (Schlüssel außerhalb des Katalogs
      über ihren Rückfall), in Katalog-Reihenfolge nach Kategorien; davor die Statistik-Gruppen, von denen mindestens ein Mitglied vorkommt.
      sports: die Sportarten der Touren. Rückgabe { gruppen: [{ key, label, titel, sports }], kategorien: [{ id, name, items: [{ key, label, icon }] }] }.
      Gewählt wird mit passt(key, tour.sport, gruppen). */
  function chipAuswahl(sports, gruppen) {
    const da = new Set((sports || []).map(x => S().anzeige(x)));
    const gr = (gruppen || []).filter(g => g.sports.some(x => da.has(x)))
      .map(g => ({ key: PREFIX + g.id, label: beschriftung(PREFIX + g.id, gruppen), titel: titel(PREFIX + g.id, gruppen), sports: g.sports.slice() }));
    const kategorien = S().kategorien(da.has('ski') ? 'ski' : undefined).map(([id, name, list]) => ({ id, name, items: list.filter(x => da.has(x[0])).map(x => ({ key: x[0], label: x[1], icon: x[2] })) }))
      .filter(k => k.items.length);
    return { gruppen: gr, kategorien };
  }

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
    if (g) return [PREFIX + g.id, beschriftung(PREFIX + g.id, gruppen)];
    const k = S().anzeige(sport);
    if (k === 'other') return ['sonst', 'Sonstiges'];
    return [k, S().label(k)];
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

  const api = { MAX, NAME_MAX, MIN_SPORTS, PREFIX, VORSCHLAEGE, kurzName, nurAufzaehlung, vorschlagName, nameSauber, neueId, sauber, pruefe, nameWieAktivitaet, zumSpeichern, beschriftung, titel, chipAuswahl, gruppeVon, gruppe, istGruppe, schluessel, name, icon, farbSport,
    passt, gueltig, auswahl, aufteilen, rueckblickZeile, vorschlaege, einspielen, ausSicherung, aktuell };
  if (node) module.exports = api; else root.StatGruppen = api;
})(typeof window !== 'undefined' ? window : globalThis);
