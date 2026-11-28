'use strict';
/* Rechenlogik ohne Oberfläche (2.24.1): Doppelt-Prüfung VOR dem Anlegen einer Tour – für alle Wege, die Touren anlegen (Dateien, Link, Ordner, Teilen,
   Komoot, Strava, Zepp, Meine Touren). Zwei Fragen:
   1. „Gibt es die Tour schon?“ (vorhanden) – dann wird sie übersprungen und gezählt. Reihenfolge der Prüfung:
        „kennung“  – gleiche Quell-Kennung (srcId, alias, Komoot-Nummer, Meine-Touren-Nummer),
        „abdruck“  – gleicher Strecken-Abdruck (derselbe Streckenverlauf mit denselben Punkten, z. B. dieselbe Datei zweimal),
        „zeit“     – beide mit Zeit: Start höchstens 5 Minuten auseinander und Strecke ähnlich (± 10 %, mindestens 300 m), Startpunkte nicht über 5 km auseinander,
        „versatz“  – beide mit Zeit: Strecke (± 1 %) und Dauer (± 60 s) gleich, Start bis 3 Stunden daneben (Zeitzonen-Versatz einer Quelle), Startpunkte nicht über 5 km auseinander,
        „form“     – beide ohne Zeit (geplante Tour oder Strecke ohne Zeitstempel): gleiche Umgrenzung (± 100 m) und gleiche Länge (± 2 %).
   2. „Wurde sie bewusst gelöscht?“ (geloescht) – beim Löschen merkt sich die App einen Stein (Kennungen, Abdruck, Start, Länge, Umgrenzung), damit eine
      gelöschte Tour nicht beim nächsten Holen still wiederkommt. Dieselben Regeln wie oben, gegen die Steine.
   Entschieden wird hier nichts: Die Funktionen liefern nur Treffer; was damit geschieht (überspringen, nachfragen), steht in js/store.js und js/import.js.
   Läuft im Browser (globales `ImportDup`) und in Node. */
(function (root) {
  const MIN5 = 300000, H3 = 3 * 3600000, MAX_STEINE = 1000;
  const zeitlos = t => !t || t.status === 'planned' || t.timed === false || typeof t.start !== 'number' || !isFinite(t.start) || !(t.start > 0);
  const laenge = (a, b, anteil, mind) => a > 0 && b > 0 && Math.abs(a - b) <= Math.max(mind, anteil * Math.max(a, b));
  const bbNah = (a, b, tol) => Array.isArray(a) && Array.isArray(b) && a.length === 4 && b.length === 4 && a.every((x, i) => Math.abs(x - b[i]) <= tol);

  /** Kleiner, stabiler Hash (cyrb53) eines Textes → 14 Hexzeichen. */
  function hash(s) {
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
  }
  /** Strecken-Abdruck: Zahl der Punkte, Anfang, Ende und zehn gleichmäßig verteilte Punkte (auf 5 Nachkommastellen = etwa 1 m), dazu die Startzeit in Sekunden.
      Dieselbe Datei – oder derselbe Streckenverlauf – ergibt immer denselben Abdruck; verschiedene Touren praktisch nie. pts: [{ lat, lon, t }]. */
  function abdruck(pts) {
    if (!Array.isArray(pts) || pts.length < 2) return '';
    const n = pts.length, parts = [n];
    for (let k = 0; k <= 11; k++) { const p = pts[k === 11 ? n - 1 : Math.min(n - 1, Math.round(k * (n - 1) / 10))]; parts.push(Math.round(p.lat * 1e5) + ',' + Math.round(p.lon * 1e5)); }
    const t0 = pts.find(p => typeof p.t === 'number' && isFinite(p.t));
    parts.push(t0 ? Math.round(t0.t / 1000) : '');
    return 'spur:' + hash(parts.join(';'));
  }
  /** Alle Kennungen einer Tour: srcId, alias, Komoot- und Meine-Touren-Nummer. */
  function kennungen(t) {
    if (!t) return [];
    return [...new Set([t.srcId].concat(t.alias || [], t.komootId ? ['komoot:' + t.komootId] : [], t.mtId ? ['mt:' + t.mtId] : []).filter(Boolean).map(String))];
  }
  const teilt = (a, b) => { const s = new Set(a || []); return (b || []).some(x => s.has(x)); };

  /** Liegen beide Startpunkte weit auseinander (über 5 km)? Ohne Angabe: nein. Dieselbe Tour von Uhr und Handy beginnt am selben Ort; Startzeit und Länge allein sind kein Beweis. */
  const weitWeg = (a, b) => {
    if (![a.lat, a.lon, b.lat, b.lon].every(v => typeof v === 'number' && isFinite(v))) return false;
    const dy = (a.lat - b.lat) * 111.2, dx = (a.lon - b.lon) * 111.2 * Math.cos((a.lat + b.lat) / 2 * Math.PI / 180);
    return Math.hypot(dx, dy) > 5;
  };
  /** Zeit-/Formregeln zwischen einem Kandidaten und einer Tour (oder einem Stein). x: { zeit (bool), start, dist, dur, planned, bbox, lat, lon }. */
  function aehnlich(c, x) {
    if (c.zeit && x.zeit) {
      if (weitWeg(c, x)) return null;
      const d = Math.abs(c.start - x.start);
      if (d <= MIN5 && laenge(c.dist, x.dist, 0.1, 300)) return 'zeit';
      if (d <= H3 && laenge(c.dist, x.dist, 0.01, 0) && c.dur > 0 && x.dur > 0 && Math.abs(c.dur - x.dur) <= 60) return 'versatz';
      return null;
    }
    if (!c.zeit && !x.zeit && !!c.planned === !!x.planned && bbNah(c.bbox, x.bbox, 0.001) && laenge(c.dist, x.dist, 0.02, 50)) return 'form';
    return null;
  }
  const ansichtTour = t => ({ zeit: !zeitlos(t), start: t.start, dist: t.dist, dur: t.dur, planned: t.status === 'planned', bbox: t.bbox, lat: t.lat, lon: t.lon });
  const ansichtStein = s => ({ zeit: !!s.z, start: s.s, dist: s.d, dur: s.u, planned: !!s.p, bbox: s.bb, lat: s.la, lon: s.lo });

  /** Gibt es die Tour schon? c: { kennungen: [..], abdruck: [..], zeit (hat Zeitstempel), start, dist, dur, planned, bbox }. Gibt { tour, grund } oder null zurück.
      opts.nur: Liste der Regeln, die gelten (Vorgabe alle). */
  function vorhanden(c, tours, opts) {
    const nur = (opts && opts.nur) || null, an = g => !nur || nur.includes(g);
    const kk = (c.kennungen || []).filter(Boolean), ab = (c.abdruck || []).filter(Boolean);
    let best = null;
    const reihe = ['kennung', 'abdruck', 'zeit', 'versatz', 'form'];
    for (const t of tours || []) {
      if (!t) continue;
      let g = null;
      if (an('kennung') && kk.length && teilt(kk, kennungen(t))) g = 'kennung';
      else if (an('abdruck') && ab.length && teilt(ab, t.abdruck)) g = 'abdruck';
      else { const r = aehnlich(c, ansichtTour(t)); if (r && an(r)) g = r; }
      if (g && (!best || reihe.indexOf(g) < reihe.indexOf(best.grund))) { best = { tour: t, grund: g }; if (g === 'kennung') break; }
    }
    return best;
  }

  /** Stein einer gelöschten Tour (kv „geloescht“). */
  function stein(t, jetzt) {
    const z = !zeitlos(t);
    const s = { n: String(t.name || ''), k: kennungen(t), a: Array.isArray(t.abdruck) ? t.abdruck.slice() : [], z, s: z ? t.start : 0, d: t.dist || 0, u: t.dur || 0, p: t.status === 'planned', am: jetzt || Date.now() };
    if (Array.isArray(t.bbox)) s.bb = t.bbox.slice();
    if (typeof t.lat === 'number' && typeof t.lon === 'number') { s.la = t.lat; s.lo = t.lon; }
    if (!z) s.dt = t.start || 0;      // Datum der Tour (nur zur Anzeige)
    return s;
  }
  /** Steine ergänzen (neueste zuletzt, höchstens MAX_STEINE); ein schon vorhandener Stein derselben Tour wird ersetzt. */
  function ergaenze(steine, neu) {
    const l = (steine || []).filter(s => !(s && s.am === neu.am && s.n === neu.n));
    l.push(neu);
    return l.slice(-MAX_STEINE);
  }
  /** Wurde diese Tour bewusst gelöscht? Gibt den Stein oder null zurück (gleiche Regeln wie bei vorhanden, ohne „zeit“-Versatz bei fehlender Dauer). */
  function geloescht(c, steine) {
    const kk = (c.kennungen || []).filter(Boolean), ab = (c.abdruck || []).filter(Boolean);
    for (let i = (steine || []).length - 1; i >= 0; i--) {
      const s = steine[i];
      if (!s) continue;
      if ((kk.length && teilt(kk, s.k)) || (ab.length && teilt(ab, s.a)) || aehnlich(c, ansichtStein(s))) return s;
    }
    return null;
  }
  /** Steine ohne die angegebenen (nach Zeitpunkt und Namen verglichen) – wenn der Import trotzdem gewollt ist. */
  function freigeben(steine, frei) { return (steine || []).filter(s => !(frei || []).some(f => f && s && f.am === s.am && f.n === s.n)); }
  /** Beschriftung für Meldungen: „gleiche Quell-Kennung“ … */
  const GRUND = { kennung: 'gleiche Quelle', abdruck: 'gleiche Strecke', zeit: 'gleiche Startzeit', versatz: 'gleiche Strecke und Dauer, Uhrzeit versetzt', form: 'gleiche Strecke ohne Zeit' };

  /** Kandidat aus einer Tour, die angelegt werden soll (Punkte schon gefiltert). o: Angaben des Aufrufers (srcId, status, abdruck …), st: Kennzahlen der Punkte (Start, Länge, Dauer), bb: Umgrenzung. */
  function kandidat(o, st, bb, pts) {
    const ab = [abdruck(pts)].filter(Boolean).map(a => (o.status === 'planned' ? 'plan:' : '') + a).concat(o.abdruck || []);      // dieselbe Strecke als geplante und als gemachte Tour sind zwei Touren
    return { kennungen: [o.srcId].concat(o.kennungen || []).filter(Boolean), abdruck: ab, zeit: !!(st && st.start) && o.status !== 'planned', start: st && st.start, dist: (o && o.dist) || (st && st.dist), dur: st && st.dur, planned: o.status === 'planned', bbox: bb, lat: pts && pts[0] ? pts[0].lat : null, lon: pts && pts[0] ? pts[0].lon : null };
  }

  /** Satz für die Abschlussmeldung: „3 übersprungen, schon vorhanden“. */
  const textVorhanden = n => n + ' übersprungen, schon vorhanden';
  const textGeloescht = n => n + ' früher gelöscht, nicht wieder importiert';

  /** Eintrag der Liste „Beim Import übersprungen“ (kv „importSkip“, neueste zuerst, höchstens max). */
  function logEintrag(art, name, start, dist, mit, mitName, grund, quelle, jetzt) {
    return { art, n: String(name || ''), s: start || 0, d: dist || 0, mit: mit || '', mn: mitName || '', g: grund || '', q: quelle || '', am: jetzt || Date.now() };
  }
  /** Neue Einträge nach vorn (neueste zuerst); ein gleicher alter Eintrag (Art, Name, Start) wird ersetzt, damit wiederholte Läufe die Liste nicht füllen. */
  const logMit = (alt, neu, max) => { const n = neu || []; return n.slice().reverse().concat((alt || []).filter(x => !n.some(e => e.art === x.art && e.n === x.n && e.s === x.s))).slice(0, max || 100); };

  const api = { MAX_STEINE, hash, abdruck, kennungen, aehnlich, vorhanden, stein, ergaenze, geloescht, freigeben, kandidat, GRUND, textVorhanden, textGeloescht, logEintrag, logMit };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ImportDup = api;
})(typeof window !== 'undefined' ? window : globalThis);
