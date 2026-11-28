'use strict';
/* Rechenlogik ohne Oberfläche (2.1.0): doppelte Touren finden und zwei Einträge zu einem zusammenlegen.
   Ein Paar gilt als möglicherweise doppelt, wenn die Länge ähnlich ist (± 10 %, mindestens 300 m Spielraum) und
     „start“:   die Startzeiten höchstens 5 Minuten auseinanderliegen, oder
     „zeit“:    sich die Zeitspannen stark überlappen (mindestens 80 % der kürzeren Tour), oder
     „versatz“: Länge (± 1 %) und Dauer (± 60 s) gleich sind und der Start bis zu 3 Stunden daneben liegt (Zeitzonen-Versatz einer Quelle).
   Geplante, ausgeblendete und Touren ohne Zeit bleiben außen vor. Entschieden wird nie von selbst: Die Funktionen liefern nur Vorschläge.
   Läuft im Browser (globales `Doppelt`) und in Node. */
(function (root) {
  const MIN5 = 300000, H3 = 3 * 3600000;
  const ende = t => (t.end && t.end > t.start ? t.end : t.start + (t.dur || 0) * 1000);
  const key = (a, b) => [String(a), String(b)].sort().join('|');
  const zaehlt = t => !!t && t.status !== 'planned' && !t.hidden && t.timed !== false && typeof t.start === 'number' && isFinite(t.start) && t.start > 0;
  const laenge = (a, b, anteil, mind) => a.dist > 0 && b.dist > 0 && Math.abs(a.dist - b.dist) <= Math.max(mind, anteil * Math.max(a.dist, b.dist));

  /** Warum könnten a und b dieselbe Tour sein? 'start' | 'zeit' | 'versatz' | null. */
  function grund(a, b) {
    if (!zaehlt(a) || !zaehlt(b) || a.id === b.id || !laenge(a, b, 0.1, 300)) return null;
    const d = Math.abs(a.start - b.start);
    if (d <= MIN5) return 'start';
    const ea = ende(a), eb = ende(b), ueber = Math.min(ea, eb) - Math.max(a.start, b.start), kurz = Math.min(ea - a.start, eb - b.start);
    if (kurz >= MIN5 && ueber >= 0.8 * kurz) return 'zeit';
    if (d <= H3 && laenge(a, b, 0.01, 0) && a.dur > 0 && b.dur > 0 && Math.abs(a.dur - b.dur) <= 60) return 'versatz';
    return null;
  }

  /** Wie viel hängt an einer Tour? Mehr Punkte = eher behalten. info: { fotos: Anzahl, hand: Name von Hand vergeben }. */
  function wert(t, info) {
    info = info || {};
    return (t.hrAvg ? 3 : 0) + (info.fotos > 0 ? 3 : 0) + (String(t.note || '').trim() ? 2 : 0) + (info.hand ? 2 : 0)
      + ((t.pins || []).length ? 1 : 0) + ((t.tags || []).length ? 1 : 0) + (t.fav ? 1 : 0) + (t.plan ? 1 : 0) + (t.elevFix || t.elevSrc ? 1 : 0);
  }

  /** Was eine Tour mitbringt – in Worten, für die Anzeige („Puls“, „3 Fotos“, „Notiz“ …). */
  function hat(t, info) {
    info = info || {};
    const o = [];
    if (t.hrAvg) o.push('Puls');
    if (info.fotos > 0) o.push(info.fotos === 1 ? '1 Foto' : info.fotos + ' Fotos');
    if (String(t.note || '').trim()) o.push('Notiz');
    if (info.hand) o.push('von Hand benannt');
    if ((t.pins || []).length) o.push(t.pins.length === 1 ? '1 Pin' : t.pins.length + ' Pins');
    if ((t.tags || []).length) o.push('Schlagwörter');
    if (t.fav) o.push('Lieblingstour');
    return o;
  }

  /** Alle möglichen Paare. opts: ignore (Set oder Liste von Schlüsseln „idA|idB“ – als „keine Doppelten“ gemerkt), fotos ({ id: Anzahl }), hand (Tour → Name von Hand?).
      Gibt [{ keep, drop, grund, key, wk, wd }] zurück, neueste zuerst; keep ist der Vorschlag, welche Tour bleibt (die mit mehr Daten, bei Gleichstand die früher angelegte). */
  function paare(tours, opts) {
    opts = opts || {};
    const ign = opts.ignore instanceof Set ? opts.ignore : new Set(opts.ignore || []);
    const info = t => ({ fotos: (opts.fotos || {})[t.id] || 0, hand: opts.hand ? !!opts.hand(t) : false });
    const l = (tours || []).filter(zaehlt).sort((a, b) => a.start - b.start), out = [];
    for (let i = 0; i < l.length; i++) {
      const a = l[i], bis = Math.max(ende(a), a.start + H3);
      for (let j = i + 1; j < l.length && l[j].start <= bis; j++) {
        const b = l[j], g = grund(a, b), k = key(a.id, b.id);
        if (!g || ign.has(k)) continue;
        const wa = wert(a, info(a)), wb = wert(b, info(b));
        const aBleibt = wa !== wb ? wa > wb : (a.created || 0) !== (b.created || 0) ? (a.created || 0) < (b.created || 0) : String(a.id) < String(b.id);
        out.push(aBleibt ? { keep: a, drop: b, grund: g, key: k, wk: wa, wd: wb } : { keep: b, drop: a, grund: g, key: k, wk: wb, wd: wa });
      }
    }
    return out.sort((x, y) => y.keep.start - x.keep.start);
  }

  /** Zwei Einträge zusammenlegen: gibt die bleibende Tour als neues Objekt zurück (Spur, Zahlen und Sportart von keep).
      Von drop kommen dazu: Notiz, Pins, Schlagworte, Favorit, Plan-Verknüpfung, der von Hand vergebene Name (wenn keep nur einen erzeugten hat)
      und die Zuordnungen (Kennungen der Quellen als alias, Komoot-Nummer, Meine-Touren-Kennung mit ihren Werten) – damit ein späterer Import die gelöschte
      Tour nicht wieder anlegt. opts: handKeep / handDrop (Name von Hand vergeben?), mt (false = Meine Touren ausgeschaltet, 2.15.0). Fotos und Puls bewegt der Aufrufer. */
  const AB = () => (typeof module !== 'undefined' && module.exports ? require('./calc-abgleich.js') : root.Abgleich);
  function zusammen(keep, drop, opts) {
    opts = opts || {};
    const t = Object.assign({}, keep);
    if (!opts.handKeep && opts.handDrop && String(drop.name || '').trim()) t.name = drop.name;
    const nk = String(keep.note || '').trim(), nd = String(drop.note || '').trim();
    t.note = !nd || nk.includes(nd) ? (keep.note || '') : nk ? nk + '\n\n' + nd : nd;
    const pk = keep.pins || [], pins = pk.concat((drop.pins || []).filter(p => !pk.some(q => (q.id && q.id === p.id) || (q.ts === p.ts && q.text === p.text)))).sort((a, b) => (a.ts || 0) - (b.ts || 0));
    if (pins.length) t.pins = pins;
    const tags = [...new Set([...(keep.tags || []), ...(drop.tags || [])])];
    if (tags.length) t.tags = tags;
    t.fav = !!(keep.fav || drop.fav);
    if (!t.plan && drop.plan) t.plan = drop.plan;
    const alias = [...new Set([...(keep.alias || []), drop.srcId, ...(drop.alias || [])].filter(x => x && x !== keep.srcId))];
    if (alias.length) t.alias = alias;
    const abd = [...new Set([...(keep.abdruck || []), ...(drop.abdruck || [])])];      // 2.24.1: Strecken-Abdrücke beider (Doppelt-Prüfung beim Import)
    if (abd.length) t.abdruck = abd;
    const nr = (x, re) => { for (const s of x) { const m = re.exec(s || ''); if (m) return m[1]; } return null; };
    if (!t.komootId && !/^komoot:/.test(keep.srcId || '')) { const k = drop.komootId || nr([drop.srcId].concat(drop.alias || []), /^komoot:(.+)$/); if (k) t.komootId = String(k); }
    if (t.upKomoot == null && drop.upKomoot != null) { t.upKomoot = drop.upKomoot; t.downKomoot = drop.downKomoot != null ? drop.downKomoot : null; }
    if (t.nameKomoot == null && drop.nameKomoot != null) t.nameKomoot = drop.nameKomoot;
    if (!t.mtId && !/^mt:/.test(keep.srcId || '')) {
      const m = drop.mtId || nr([drop.srcId].concat(drop.alias || []), /^mt:(.+)$/);
      if (m) {
        t.mtId = String(m);
        for (const k of ['upMt', 'downMt', 'distMt', 'nameMt', 'noteMt', 'tagsMt', 'starsMt', 'zMt']) if (t[k] == null && drop[k] != null) t[k] = drop[k];
        if (t.zMt && opts.mt !== false) {      // die Zahlen aus Meine Touren gelten weiter – jetzt an der bleibenden Tour (2.15.0: nur bei „Mit Meine Touren zusammenarbeiten“; opts.mt = false: die eigene Rechnung bleibt)
          if (t.upMt != null) { t.up = t.upMt; if (t.downMt != null) t.down = t.downMt; t.upSrc = 'mt'; }
          if (t.distMt) t.dist = t.distMt;
        }
      }
    }
    if (t.starsMt == null && drop.starsMt != null) t.starsMt = drop.starsMt;
    if (t.sportMt == null && drop.sportMt != null && t.mtId) t.sportMt = drop.sportMt;
    return AB().sterneZusammen(keep, drop, t);      // eigene Bewertung (2.2.0): von Hand gesetzte gilt, sonst die vorhandene
  }

  /** Gruppen (2.23.0): Paare, die eine Tour gemeinsam haben, gehören zu einer Gruppe – dieselbe Tour kann drei- oder mehrmals vorliegen (Uhr, Komoot, Strava).
      Eine Gruppe mit zwei Touren sieht aus wie ein Paar. Gibt [{ keep, drops, members, grund, key, keys, id }] zurück, neueste zuerst:
        keep = Vorschlag, welche Tour bleibt (dieselbe Regel wie bei Paaren: mehr Daten, sonst früher angelegt), drops = alle übrigen, nach Start sortiert,
        keys = die Paar-Schlüssel innerhalb der Gruppe (für „keine Doppelten“), key = Schlüssel des Paars keep + erstes drop (sonst der erste), id = Kennung der Gruppe (alle Tour-Kennungen, sortiert),
        grund = Grund dieser Verbindung. opts wie bei paare. */
  function gruppen(tours, opts) {
    opts = opts || {};
    const ps = paare(tours, opts), mem = new Map(), eltern = new Map();
    const finde = x => { while (eltern.get(x) !== x) { eltern.set(x, eltern.get(eltern.get(x))); x = eltern.get(x); } return x; };
    for (const p of ps) for (const t of [p.keep, p.drop]) if (!eltern.has(t.id)) { eltern.set(t.id, t.id); mem.set(t.id, t); }
    for (const p of ps) { const a = finde(p.keep.id), b = finde(p.drop.id); if (a !== b) eltern.set(a, b); }
    const teile = new Map();
    for (const p of ps) { const w = finde(p.keep.id); if (!teile.has(w)) teile.set(w, { ps: [], ids: new Set() }); const g = teile.get(w); g.ps.push(p); g.ids.add(p.keep.id); g.ids.add(p.drop.id); }
    const info = t => ({ fotos: (opts.fotos || {})[t.id] || 0, hand: opts.hand ? !!opts.hand(t) : false });
    const out = [];
    for (const g of teile.values()) {
      const members = [...g.ids].map(id => mem.get(id)), w = new Map(members.map(t => [t.id, wert(t, info(t))]));
      members.sort((a, b) => w.get(a.id) !== w.get(b.id) ? w.get(b.id) - w.get(a.id) : (a.created || 0) !== (b.created || 0) ? (a.created || 0) - (b.created || 0) : String(a.id) < String(b.id) ? -1 : 1);
      const keep = members[0], drops = members.slice(1).sort((a, b) => a.start - b.start), kp = g.ps.find(p => p.key === key(keep.id, drops[0].id)) || g.ps[0];
      out.push({ keep, drops, members: members.slice().sort((a, b) => a.start - b.start), grund: kp.grund, key: kp.key, keys: g.ps.map(p => p.key), id: [...g.ids].sort().join('|') });
    }
    return out.sort((x, y) => y.keep.start - x.keep.start || (x.id < y.id ? -1 : 1));
  }

  /** Gruppen mit mindestens einer neuen Tour (angelegt nach basis, ms) – so wird nach einem Import auf mögliche Doppelte hingewiesen. */
  const mitNeuen = (gs, basis) => (gs || []).filter(g => g.members.some(t => (t.created || 0) > (basis || 0)));
  /** Ohne die Gruppen, die mit „Später“ schon verworfen wurden (gleiche Kennung = gleiche Touren; kommt eine Tour dazu, ist es eine neue Gruppe). */
  const offen = (gs, spaeter) => { const s = new Set(spaeter || []); return (gs || []).filter(g => !s.has(g.id)); };
  /** „3 mögliche doppelte Touren“ – gezählt wird je Gruppe eine Tour, die mehrfach vorliegt (auch bei drei oder mehr Einträgen). Zahl und Wort mit geschütztem Leerzeichen. */
  const text = n => n + '\u00a0' + (n === 1 ? 'mögliche doppelte Tour' : 'mögliche doppelte Touren');
  /** Stand in Worten für Hinweis, Liste und Seite: { n, gross, text („Keine doppelten Touren“ oder text(n)), extra („davon 1 mit drei oder mehr Einträgen“) }. */
  const stand = gs => {
    const n = (gs || []).length, gross = (gs || []).filter(g => g.members.length > 2).length;
    return { n, gross, text: n ? text(n) : 'Keine doppelten Touren', extra: gross ? 'davon ' + gross + '\u00a0mit drei oder mehr Einträgen' : '' };
  };

  const api = { grund, wert, hat, paare, zusammen, key, ende, gruppen, mitNeuen, offen, text, stand };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Doppelt = api;
})(typeof window !== 'undefined' ? window : globalThis);
