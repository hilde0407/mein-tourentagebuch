'use strict';
/* Rechenlogik ohne Oberfläche: Links, „Passt die Tour zu mir?“ (Form und Tageslicht), Sportgruppen, Einordnung gegen eigene Touren.
   Übertragen aus „Meine Touren“ (app/planhilfe.py, app/bausteine_daten.py, app/hinweise.py). Rechnet nur lokal auf den Touren im Gerät;
   Links werden nie abgerufen. Läuft im Browser (globales `Planhilfe`) und in Node (tests/test_calc.js).
   Orientierung, keine Sicherheitsgarantie: Dämmerung und Reserve sind Rechenwerte, keine Aussage über Wetter, Lawinenlage oder Gelände. */
(function (root) {
  const MIN_N = 5, MONATE = 12, UNTER = 0.80, UEBER = 1.25, DEUTLICH_UEBER_MAX = 1.20, ETWA_MAX = 0.95;
  const RESERVE_OK_MIN = 60, PUFFER_STANDARD = 20, START_STANDARD = '09:00';
  const LINK_ARTEN = [['fuehrer', 'Wanderführer'], ['karte', 'Karte, Route'], ['wetter', 'Wetter, Lawinenbericht'], ['huette', 'Hütte, Unterkunft'], ['sonstiges', 'Sonstiges']];
  const QUELLEN = [['eigen', 'Eigene Planung'], ['komoot', 'Komoot'], ['outdooractive', 'Outdooractive'], ['fuehrer', 'Wanderführer'], ['sonstiges', 'Sonstiges']];
  const MAX_LINKS = 20, MAX_URL = 500, MAX_TITEL = 120, MAX_QTEXT = 200, MAX_NOTIZ = 4000;
  const MS_MONAT = 30.4375 * 86400000;

  /* Python rundet halbe Werte zur geraden Zahl; dasselbe hier, damit Vergleichswerte aus den Vorbildern genau stimmen. */
  function pyRound(x) { const f = Math.floor(x), d = x - f; if (Math.abs(d - 0.5) < 1e-9) return f % 2 === 0 ? f : f + 1; return Math.round(x); }
  const round3 = x => Math.round(x * 1000) / 1000;
  function median(a) { const s = a.slice().sort((x, y) => x - y), n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; }

  /* ---- Sportgruppen (wie SPORT_GRP in hinweise.py, auf die Sportarten dieser App übertragen; 2.19.0: Schneeschuh zu Fuß, Tempo wie Wandern) ---- */
  const SPORT_GRP = { bike: ['mtb', 'bike', 'racebike', 'ebike', 'gravel', 'emtb', 'bikepacking'], ski: ['ski', 'skialpin', 'skitour', 'nordic', 'snowboard'], foot: ['hike', 'mountaineering', 'snowshoe', 'climbing', 'nordicwalking'], run: ['run', 'trailrun'] };
  /* 2.19.0: Die Gruppen dienen nur noch dem Vergleich ähnlicher Touren (Planungshilfe, „Wie ist es gelaufen?“) und älteren Zielen „grp:…“ – die Statistik fasst
     nichts mehr fest zusammen (eigene Statistik-Gruppen: calc-statgruppen.js). Neue Sportarten stehen bei der Gruppe, zu der sie bis 2.18 gezählt wurden. */
  /** Schlüssel außerhalb des Katalogs (z. B. Radpendeln aus einem Zwischenstand) wie ihre Rückfall-Aktivität (Sports.anzeige; ohne parse.js unverändert). */
  function anz(sport) {
    const S = typeof module !== 'undefined' && module.exports ? require('./parse.js').Sports : (typeof Sports !== 'undefined' ? Sports : root.Sports);      // eslint-disable-line no-undef
    return S && S.anzeige ? S.anzeige(sport) : sport;
  }
  function gruppe(sport) { sport = anz(sport); for (const k in SPORT_GRP) if (SPORT_GRP[k].includes(sport)) return k; return null; }
  function gleicheGruppe(a, b) { const g = gruppe(a); return g ? gruppe(b) === g : anz(a) === anz(b); }

  /* ---- Links ---- */
  /** Gültige http(s)-Adresse (bereinigt); sonst wirft die Funktion Error mit verständlicher Meldung. Kein javascript:, data:, file: …; keine Zugangsdaten in der Adresse. */
  function pruefeUrl(u) {
    if (typeof u !== 'string') throw new Error('Adresse fehlt');
    u = u.trim();
    if (!u) throw new Error('Adresse fehlt');
    if (u.length > MAX_URL) throw new Error('Adresse zu lang (höchstens ' + MAX_URL + ' Zeichen)');
    if (/[\s\x00-\x1f\x7f]/.test(u)) throw new Error('Adresse enthält Leerzeichen oder Steuerzeichen');
    const m = u.match(/^([A-Za-z][A-Za-z0-9+.-]*):/);
    if (!m || !/^https?$/i.test(m[1])) throw new Error('Nur Adressen mit http:// oder https:// sind erlaubt');
    let p;
    try { p = new URL(u); } catch (e) { throw new Error('Adresse ungültig'); }
    if (!/^https?:\/\/[^/?#]/i.test(u) || !/^https?:$/.test(p.protocol) || !p.hostname || p.username || p.password || /^https?:\/\/[^/?#]*@/i.test(u)) throw new Error('Adresse ungültig (Server fehlt oder Zugangsdaten in der Adresse)');
    return u;
  }
  /** Liste {titel, url, art} prüfen: höchstens 20, Titel höchstens 120 Zeichen (leer = Servername), Art aus der festen Liste (leer = sonstiges). */
  function pruefeLinks(raw) {
    if (raw == null || raw === '') return [];
    if (!Array.isArray(raw)) throw new Error('Links: Liste erwartet');
    if (raw.length > MAX_LINKS) throw new Error('Höchstens ' + MAX_LINKS + ' Links je Plan');
    return raw.map((x, i) => {
      if (!x || typeof x !== 'object') throw new Error('Link ' + (i + 1) + ': ungültig');
      let url;
      try { url = pruefeUrl(x.url); } catch (e) { throw new Error('Link ' + (i + 1) + ': ' + e.message); }
      let titel = x.titel == null ? '' : x.titel;
      if (typeof titel !== 'string') throw new Error('Link ' + (i + 1) + ': Titel muss Text sein');
      titel = titel.split(/\s+/).filter(Boolean).join(' ');
      if (titel.length > MAX_TITEL) throw new Error('Link ' + (i + 1) + ': Titel zu lang (höchstens ' + MAX_TITEL + ' Zeichen)');
      const art = x.art || 'sonstiges';
      if (!LINK_ARTEN.some(a => a[0] === art)) throw new Error('Link ' + (i + 1) + ': Art unbekannt');
      return { titel: titel || new URL(url).hostname, url, art };
    });
  }
  /** Gespeicherte Links lesen; ungültige Einträge (etwa aus einer fremden Sicherung) werden still ausgelassen. */
  function ladeLinks(raw) {
    const out = [];
    for (const x of Array.isArray(raw) ? raw : []) { try { out.push(...pruefeLinks([x])); } catch (e) { /* auslassen */ } }
    return out.slice(0, MAX_LINKS);
  }
  function pruefeQuelle(art, text) {
    art = art == null || art === '' ? null : art;
    if (art !== null && !QUELLEN.some(q => q[0] === art)) throw new Error('Herkunft unbekannt');
    if (text != null && typeof text !== 'string') throw new Error('Herkunft: Text erwartet');
    text = (text || '').split(/\s+/).filter(Boolean).join(' ');
    if (text.length > MAX_QTEXT) throw new Error('Herkunft: Text zu lang (höchstens ' + MAX_QTEXT + ' Zeichen)');
    return { art, text: text || null };
  }
  function pruefeNotiz(t) {
    if (t == null) return '';
    if (typeof t !== 'string') throw new Error('Notiz: Text erwartet');
    if (t.length > MAX_NOTIZ) throw new Error('Notiz zu lang (höchstens ' + MAX_NOTIZ + ' Zeichen)');
    return t;
  }
  const pruefeDatum = v => { if (v == null || v === '') return null; if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error('Datum: Format JJJJ-MM-TT erwartet'); const [y, m, d] = v.split('-').map(Number), t = new Date(Date.UTC(y, m - 1, d)); if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) throw new Error('Datum ungültig'); if (y < 2000 || y > 2100) throw new Error('Datum außerhalb 2000–2100'); return v; };
  const pruefeStart = v => { if (v == null || v === '') return null; if (typeof v !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) throw new Error('Startzeit: Format HH:MM erwartet'); return v; };
  const pruefePuffer = v => { if (v == null || v === '') return null; const x = typeof v === 'string' ? Number(v.replace(',', '.')) : v; if (typeof x !== 'number' || !isFinite(x) || x < 0 || x > 100 || x !== Math.floor(x)) throw new Error('Puffer: ganze Prozent von 0 bis 100'); return x; };

  /* ---- Form: Plan gegen die eigenen Touren ---- */
  /** Einordnung eines Planwertes gegen eigene Werte (mindestens MIN_N); null bei fehlendem Planwert oder zu wenig Vergleichswerten. */
  function metrik(wert, vals) {
    if (wert == null || wert < 0 || vals.length < MIN_N) return null;
    const med = median(vals), mx = Math.max(...vals);
    const ver = med > 0 ? round3(wert / med) : null;
    let ein;
    if (med > 0) ein = wert / med < UNTER ? 'unter' : wert / med > UEBER ? 'ueber' : 'aehnlich';
    else ein = wert <= 0 ? 'aehnlich' : 'ueber';
    const perz = pyRound(100 * (vals.filter(v => v < wert).length + 0.5 * vals.filter(v => v === wert).length) / vals.length);
    const f = mx > 0 ? wert / mx : (wert <= 0 ? 1 : Infinity);
    const stufe = f > DEUTLICH_UEBER_MAX ? 'deutlich_ueber' : f > 1.0 ? 'ueber' : f >= ETWA_MAX ? 'etwa' : 'unter';
    return { wert, median: med, max: mx, n: vals.length, verhaeltnis_median_pct: ver == null ? null : pyRound(ver * 100), einordnung: ein, perzentil: perz, vs_max_pct: isFinite(f) ? pyRound(f * 100) : null, max_stufe: stufe };
  }
  /** Plan-Werte (km, Aufstieg m, geschätzte Dauer h) gegen die Touren derselben Sportgruppe der letzten 12 Monate.
      tours: [{sport, start (ms), dist (m), dur (s), up (m)}]. Teilwerte sind null, wenn der Planwert fehlt oder weniger als 5 Vergleichswerte vorliegen. */
  function form(km, up, estH, sport, tours, nowMs) {
    const lo = nowMs - MONATE * MS_MONAT;
    const rows = tours.filter(t => t.start && t.start >= lo && t.start <= nowMs + 86400000 && (t.dist || 0) > 0 && gleicheGruppe(t.sport, sport));
    const out = { status: 'zu_wenig', n: rows.length, min_n: MIN_N, monate: MONATE, km: null, up: null, dauer: null, deutlich_ueber: [] };
    if (rows.length < MIN_N) return out;
    out.status = 'ok';
    out.km = metrik(km && km > 0 ? km : null, rows.map(t => t.dist / 1000));
    out.up = metrik(up == null ? null : up, rows.filter(t => t.up != null).map(t => t.up));
    out.dauer = metrik(estH && estH > 0 ? estH : null, rows.filter(t => (t.dur || 0) > 0).map(t => t.dur / 3600));
    out.deutlich_ueber = ['km', 'up', 'dauer'].filter(k => out[k] && out[k].max_stufe === 'deutlich_ueber');
    return out;
  }
  /* Annahmen: Tempo (km/h) und Aufstieg (m/h) je Sportart. Wie im Planer (v-plan.js). Skitour und „Ski (allgemein)“ wie bisher 5 km/h und 400 m/h; Langlauf zügiger,
     Ski alpin mit Liften: hohes Tempo, Aufstieg fast ohne Zeit (der Lift trägt). */
  const TEMPO = { snowshoe: 4.5, nordicwalking: 4.8, trailrun: 9, gravel: 16, emtb: 20, snowboard: 18, hike: 4.5, walk: 4.8, run: 9, mtb: 14, bike: 16, ebike: 20, racebike: 24, ski: 5, skitour: 5, nordic: 9, skialpin: 18 };
  const AUFSTIEG = { snowshoe: 500, nordicwalking: 500, trailrun: 700, snowboard: 3000, hike: 500, walk: 500, run: 700, ski: 400, skitour: 400, nordic: 600, skialpin: 3000 };
  /** Grobe Dauer eines Plans in Stunden (Tempo je Sportart plus Aufstieg) – dieselbe Schätzung wie im Planer. */
  function schaetzDauer(sport, km, up) {
    const v = TEMPO[sport] || 5, r = AUFSTIEG[sport] || 900;
    return km / v + (up || 0) / r;
  }

  /* ---- Tageslicht (NOAA-Näherung, etwa 2 Minuten genau) ---- */
  function eqtDec(y, m, d) {
    const n = Math.round((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 1)) / 864e5) + 1, g = 2 * Math.PI / 365 * (n - 1);
    const eqt = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
    const dec = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
    return [eqt, dec];
  }
  /** [Aufgang, Untergang] als Zeitpunkte (ms, UTC) für das Datum; null bei Polartag oder Polarnacht. */
  function sonne(y, m, d, lat, lng, zenit) {
    const [eqt, dec] = eqtDec(y, m, d), la = lat * Math.PI / 180, rad = x => x * Math.PI / 180;
    const c = (Math.cos(rad(zenit)) - Math.sin(la) * Math.sin(dec)) / (Math.cos(la) * Math.cos(dec));
    if (c >= 1 || c <= -1) return null;
    const ha = Math.acos(c) * 180 / Math.PI, base = Date.UTC(y, m - 1, d);
    return [base + (720 - 4 * (lng + ha) - eqt) * 60000, base + (720 - 4 * (lng - ha) - eqt) * 60000];
  }
  function polarArt(y, m, d, lat) { if (sonne(y, m, d, lat, 0, 90.833) !== null) return null; return lat * eqtDec(y, m, d)[1] > 0 ? 'tag' : 'nacht'; }
  const wall = ms => { const d = new Date(ms); return d.getHours() * 60 + d.getMinutes(); };
  const ymd = d => ({ y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() });
  /** Sonnenaufgang und -untergang am Startpunkt und geschätzte Rückkehr (Start + Dauer + Puffer).
      datum 'JJJJ-MM-TT' oder null (= heute), start 'HH:MM' oder null (= 09:00), puffer in Prozent oder null (= 20), heute: Date. Zeiten sind Minuten seit Mitternacht in Ortszeit des Geräts.
      Gerechnet wird mit absoluten Zeitpunkten (richtig auch an Tagen mit Zeitumstellung). status: ok | polar_tag | polar_nacht | keine_position | keine_dauer; ampel: reserve | knapp | nach_untergang. */
  function tageslicht(lat, lng, datum, start, dauerH, pufferPct, heute) {
    if (lat == null || lng == null || !(lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) || (lat === 0 && lng === 0)) return { status: 'keine_position' };
    const day = datum ? (([y, m, d]) => ({ y, m, d }))(datum.split('-').map(Number)) : ymd(heute || new Date());
    const st = start || START_STANDARD, pf = pufferPct == null ? PUFFER_STANDARD : pufferPct;
    const base = { datum: day.y + '-' + String(day.m).padStart(2, '0') + '-' + String(day.d).padStart(2, '0'), datum_gewaehlt: !!datum, start: st, start_gewaehlt: !!start, puffer_pct: pf, puffer_gewaehlt: pufferPct != null };
    if (!dauerH || dauerH <= 0) return Object.assign({}, base, { status: 'keine_dauer' });
    const hh = +st.slice(0, 2), mm = +st.slice(3);
    const startMs = new Date(day.y, day.m - 1, day.d, hh, mm).getTime();
    const dauerMin = dauerH * 60, pufferMin = dauerMin * pf / 100, retMs = startMs + (dauerMin + pufferMin) * 60000;
    const rd = new Date(retMs);
    const out = Object.assign({}, base, { start_min: hh * 60 + mm, dauer_min: Math.round(dauerMin), puffer_min: Math.round(pufferMin), rueckkehr_min: wall(retMs),
      rueckkehr_tag_plus: Math.round((Date.UTC(rd.getFullYear(), rd.getMonth(), rd.getDate()) - Date.UTC(day.y, day.m - 1, day.d)) / 864e5) });
    const sun = sonne(day.y, day.m, day.d, lat, lng, 90.833), civ = sonne(day.y, day.m, day.d, lat, lng, 96.0);
    if (!sun) { out.status = 'polar_' + (polarArt(day.y, day.m, day.d, lat) || 'nacht'); return out; }
    Object.assign(out, { status: 'ok', aufgang_min: wall(sun[0]), untergang_min: wall(sun[1]), daemm_bis_min: civ ? wall(civ[1]) : null });
    const reserve = Math.floor((sun[1] - retMs) / 60000);
    out.reserve_min = reserve;
    out.ampel = reserve >= RESERVE_OK_MIN ? 'reserve' : reserve >= 0 ? 'knapp' : 'nach_untergang';
    out.start_vor_aufgang = startMs < sun[0];
    out.start_nach_untergang = startMs >= sun[1];
    return out;
  }

  const api = { MIN_N, MONATE, LINK_ARTEN, QUELLEN, MAX_LINKS, MAX_URL, MAX_TITEL, MAX_QTEXT, MAX_NOTIZ, START_STANDARD, PUFFER_STANDARD, SPORT_GRP, TEMPO, AUFSTIEG,
    pyRound, median, gruppe, gleicheGruppe, pruefeUrl, pruefeLinks, ladeLinks, pruefeQuelle, pruefeNotiz, pruefeDatum, pruefeStart, pruefePuffer,
    metrik, form, schaetzDauer, eqtDec, sonne, polarArt, tageslicht };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Planhilfe = api;
})(typeof window !== 'undefined' ? window : globalThis);
