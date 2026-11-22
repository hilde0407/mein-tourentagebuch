/* Tests der Rechenlogik ohne Oberfläche (js/calc-*.js). Erwartete Werte stammen aus den Python-Vorbildern der Schwester-App „Meine Touren“
   (tests/data/calc-erwartet.json, erzeugt mit tests/data/calc-erwartet-erzeugen.py); die übrigen Fälle sind eigene Grenzfälle.
   Aufruf: node tests/test_calc.js (setzt die Zeitzone selbst auf Europe/Berlin, damit Zeitumstellung und Ortszeit reproduzierbar sind). */
process.env.TZ = 'Europe/Berlin';
const A = require('assert');
const W = __dirname + '/../android/app/src/main/assets/www/js/';
const PH = require(W + 'calc-planhilfe.js'), Z = require(W + 'calc-ziele.js'), R = require(W + 'calc-rueckblick.js'), F = require(W + 'calc-fitness.js');
const E = require(__dirname + '/data/calc-erwartet.json');
let n = 0;
const ok = (c, m) => { n++; A.ok(c, m); };
const close = (a, b, m) => { n++; if (a === null || b === null || a === undefined || b === undefined) A.strictEqual(a === undefined ? null : a, b === undefined ? null : b, m); else A.ok(Math.abs(a - b) < 1e-6, (m || '') + ': ' + a + ' ≠ ' + b); };
const day = (y, m, d, h) => new Date(y, m - 1, d, h || 12, 0).getTime();
const tour = (sport, start, dist, dur, up, extra) => Object.assign({ id: 't' + Math.random().toString(36).slice(2), sport, start, dist, dur, up }, extra);

/* ---------- Tageslicht gegen die Python-Werte (Zeitumstellung, Polartag, Mitternacht) ---------- */
for (const c of E.tageslicht) {
  const [lat, lng, datum, start, dauer, puffer] = c.in, o = c.out;
  const r = PH.tageslicht(lat, lng, datum, start, dauer, puffer, new Date(2026, 10, 20, 12));
  A.strictEqual(r.status, o.status, JSON.stringify(c.in));
  for (const k of ['aufgang_min', 'untergang_min', 'daemm_bis_min', 'rueckkehr_min', 'rueckkehr_tag_plus', 'reserve_min', 'start_min', 'dauer_min', 'puffer_min']) if (k in o) close(r[k], o[k], k + ' ' + JSON.stringify(c.in));
  for (const k of ['ampel', 'start_vor_aufgang', 'start_nach_untergang', 'datum', 'start', 'puffer_pct']) if (k in o) A.strictEqual(r[k], o[k], k + ' ' + JSON.stringify(c.in));
}
n += E.tageslicht.length;
// Zeitumstellung ausdrücklich: 29.03.2026 01:00 + 4 h = 06:00 (nicht 05:00); 25.10.2026 00:30 + 5 h = 04:30 (nicht 05:30)
ok(PH.tageslicht(47.5, 11.2, '2026-03-29', '01:00', 4, 0).rueckkehr_min === 360, 'Frühjahr: Uhr springt vor');
ok(PH.tageslicht(47.5, 11.2, '2026-10-25', '00:30', 5, 0).rueckkehr_min === 270, 'Herbst: Uhr springt zurück');
// Ampel: 60 Minuten sind noch „Reserve“, 59 „knapp“, 0 „knapp“, −1 „nach Sonnenuntergang“
(() => {
  const base = PH.tageslicht(47.5, 11.2, '2026-06-21', '09:00', 5, 0), unter = base.untergang_min;      // Sonnenuntergang in Minuten seit Mitternacht
  for (const [res, amp] of [[61, 'reserve'], [60, 'reserve'], [59, 'knapp'], [1, 'knapp'], [-2, 'nach_untergang'], [-120, 'nach_untergang']]) {
    const dauerMin = unter - res - 9 * 60, r = PH.tageslicht(47.5, 11.2, '2026-06-21', '09:00', dauerMin / 60, 0);
    ok(Math.abs(r.reserve_min - res) <= 1 && (Math.abs(r.reserve_min - res) === 0 ? r.ampel === amp : true), 'Reserve ' + res + ' → ' + r.reserve_min + ' ' + r.ampel);
  }
})();
A.strictEqual(PH.tageslicht(null, 11, null, null, 3, null).status, 'keine_position'); n++;
A.strictEqual(PH.tageslicht(0, 0, null, null, 3, null).status, 'keine_position'); n++;
A.strictEqual(PH.tageslicht(95, 11, null, null, 3, null).status, 'keine_position'); n++;
A.strictEqual(PH.tageslicht(47, 11, null, null, 0, null).status, 'keine_dauer'); n++;
A.strictEqual(PH.tageslicht(47, 11, '2026-06-21', null, null, null).status, 'keine_dauer'); n++;
ok(PH.tageslicht(47.5, 11.2, '2026-06-21', null, 3, null).start === '09:00' && PH.tageslicht(47.5, 11.2, '2026-06-21', null, 3, null).puffer_pct === 20, 'Standard 09:00 und 20 %');
ok(PH.tageslicht(47.5, 11.2, '2026-06-21', '09:00', 3, 0).puffer_min === 0, 'Puffer 0 ist erlaubt und bleibt 0');
ok(PH.polarArt(2026, 6, 21, 70) === 'tag' && PH.polarArt(2026, 12, 21, 70) === 'nacht' && PH.polarArt(2026, 12, 21, -70) === 'tag' && PH.polarArt(2026, 6, 21, 47) === null, 'Polar-Art');

/* ---------- Einordnung (Median-Verhältnis, Perzentil, Schwellen 0,80 / 1,25) ---------- */
for (const c of E.metrik) {
  const r = PH.metrik(c.in[0], c.in[1]), o = c.out;
  if (o === null) { A.strictEqual(r, null); n++; continue; }
  for (const k of Object.keys(o)) { if (typeof o[k] === 'number') close(r[k], o[k], k + ' ' + JSON.stringify(c.in)); else A.strictEqual(r[k], o[k], k + ' ' + JSON.stringify(c.in)); n++; }
}
ok(PH.metrik(10, [1, 2, 3, 4]) === null, 'unter 5 Vergleichswerte: null');
ok(PH.metrik(null, [1, 2, 3, 4, 5]) === null && PH.metrik(-1, [1, 2, 3, 4, 5]) === null, 'fehlender Planwert: null, nie 0');
ok(PH.metrik(8, [10, 10, 10, 10, 10]).einordnung === 'aehnlich' && PH.metrik(7.99, [10, 10, 10, 10, 10]).einordnung === 'unter', 'Schwelle 80 %');
ok(PH.metrik(12.5, [10, 10, 10, 10, 10]).einordnung === 'aehnlich' && PH.metrik(12.51, [10, 10, 10, 10, 10]).einordnung === 'ueber', 'Schwelle 125 %');
ok(PH.pyRound(0.5) === 0 && PH.pyRound(1.5) === 2 && PH.pyRound(2.5) === 2 && PH.pyRound(62.5) === 62, 'gerundet wie Python');

/* ---------- Form des Plans ---------- */
const ft = E.form_tours.map(t => ({ sport: t.sport, start: t.start_ts * 1000, dist: t.dist_m, dur: t.dur_s, up: t.up_m })), fnow = E.form_now * 1000;
for (const c of E.form) {
  const [km, up, est, sp] = c.in, r = PH.form(km, up, est, sp, ft, fnow), o = c.out;
  A.strictEqual(r.status, o.status); A.strictEqual(r.n, o.n); A.deepStrictEqual(r.deutlich_ueber, o.deutlich_ueber); n += 3;
  for (const k of ['km', 'up', 'dauer']) {
    if (o[k] === null) { A.strictEqual(r[k], null, k + ' ' + c.in); n++; continue; }
    for (const f of ['wert', 'median', 'max', 'n', 'verhaeltnis_median_pct', 'perzentil', 'vs_max_pct']) close(r[k][f], o[k][f], k + '.' + f + ' ' + c.in);
    A.strictEqual(r[k].einordnung, o[k].einordnung); A.strictEqual(r[k].max_stufe, o[k].max_stufe); n += 2;
  }
}
ok(PH.form(10, 100, 2, 'hike', ft.slice(0, 4), fnow).status === 'zu_wenig' && PH.form(10, 100, 2, 'hike', ft.slice(0, 4), fnow).km === null, 'zu wenig Touren: kein Teilwert');
ok(PH.gleicheGruppe('hike', 'mountaineering') && PH.gleicheGruppe('mtb', 'racebike') && !PH.gleicheGruppe('hike', 'bike') && PH.gleicheGruppe('walk', 'walk') && !PH.gleicheGruppe('walk', 'hike') && PH.gleicheGruppe('other', 'other'), 'Sportgruppen');
ok(Math.abs(PH.schaetzDauer('hike', 9, 500) - (9 / 4.5 + 1)) < 1e-9 && Math.abs(PH.schaetzDauer('bike', 32, 450) - (2 + 0.5)) < 1e-9, 'Dauerschätzung wie im Planer');

/* ---------- Links ---------- */
for (const c of E.links) {
  if (c.err) { A.throws(() => PH.pruefeUrl(c.in), e => e.message === c.err, 'Link ' + c.in.slice(0, 30)); n++; }
  else { A.strictEqual(PH.pruefeUrl(c.in), c.out); n++; }
}
for (const bad of ['javascript:alert(1)', 'JavaScript:alert(1)', ' javascript:alert(1)', 'data:text/html;base64,AAAA', 'file:///sdcard/x', 'content://x', 'intent://x#Intent;end', 'vbscript:x', 'https://a b.de', 'https://a.de/\nx']) A.throws(() => PH.pruefeUrl(bad), 'abgelehnt: ' + bad), n++;
ok(PH.pruefeLinks([{ url: 'https://www.komoot.de/x' }])[0].titel === 'www.komoot.de' && PH.pruefeLinks([{ url: 'https://a.de', titel: '  Mein   Titel ', art: 'wetter' }])[0].titel === 'Mein Titel', 'Titel bereinigt, leer = Servername');
A.throws(() => PH.pruefeLinks([{ url: 'https://a.de', art: 'geheim' }]), /Art unbekannt/); n++;
A.throws(() => PH.pruefeLinks(Array.from({ length: 21 }, () => ({ url: 'https://a.de' }))), /Höchstens 20/); n++;
ok(PH.pruefeLinks(Array.from({ length: 20 }, () => ({ url: 'https://a.de' }))).length === 20, '20 Links erlaubt');
A.throws(() => PH.pruefeLinks([{ url: 'https://a.de', titel: 'x'.repeat(121) }]), /Titel zu lang/); n++;
A.throws(() => PH.pruefeLinks([{ url: 'javascript:alert(1)' }]), /Link 1: Nur Adressen/); n++;
ok(PH.ladeLinks([{ url: 'javascript:x' }, { url: 'https://ok.de', titel: 'ok' }, 5, null]).length === 1, 'Beim Lesen werden ungültige Links still ausgelassen');
ok(PH.pruefeQuelle('komoot', ' Tour  123 ').text === 'Tour 123' && PH.pruefeQuelle('', '').art === null, 'Herkunft');
A.throws(() => PH.pruefeQuelle('geheim', ''), /Herkunft unbekannt/); n++;
A.throws(() => PH.pruefeQuelle('eigen', 'x'.repeat(201)), /zu lang/); n++;
A.throws(() => PH.pruefeNotiz('x'.repeat(4001)), /zu lang/); n++;
ok(PH.pruefeDatum('2026-02-28') === '2026-02-28' && PH.pruefeDatum('') === null, 'Datum');
A.throws(() => PH.pruefeDatum('2026-02-30')); A.throws(() => PH.pruefeDatum('28.02.2026')); A.throws(() => PH.pruefeStart('24:00')); A.throws(() => PH.pruefePuffer('101')); A.throws(() => PH.pruefePuffer('1.5')); n += 5;
ok(PH.pruefeStart('07:05') === '07:05' && PH.pruefePuffer('0') === 0 && PH.pruefePuffer('') === null && PH.pruefePuffer('25') === 25, 'Start und Puffer');

/* ---------- Rückblick ---------- */
{
  const rows = E.rueckblick.rows.map(r => ({ dist: r.dist_m, dur: r.dur_s, up: r.up_m })), cur = R.werte({ dist: E.rueckblick.cur_in.dist_m, dur: E.rueckblick.cur_in.dur_s, up: E.rueckblick.cur_in.up_m }), o = E.rueckblick.out;
  for (const k of ['dauer', 'strecke', 'auf', 'tempo']) close(cur[k], E.rueckblick.cur[k], 'werte ' + k);
  const r = R.einordnen(cur, rows);
  for (const k of Object.keys(o)) { for (const f of ['wert', 'median', 'n', 'verhaeltnis_median_pct', 'perzentil']) ok(Math.abs(r[k][f] - o[k][f]) < 1e-3, k + '.' + f);      // das Vorbild rundet Wert und Median auf drei Stellen
    A.strictEqual(r[k].einordnung, o[k].einordnung); n++; }
  ok(R.werte({ dist: 500, dur: 30, up: 10 }).tempo === null && R.werte({ dist: 500, dur: 30, up: 10 }).dauer === null && R.werte({ dist: 500, dur: 30, up: 10 }).strecke === 0.5, 'Platzhalter-Dauer und kurze Strecke: kein Tempo, nie 0');
  ok(R.werte({ dist: 5000, dur: 3600, up: null }).auf === null && R.werte({ dist: 5000 }).dauer === null, 'fehlender Aufstieg und fehlende Dauer sind null');
  const t0 = day(2026, 6, 10), mk = (i, sp) => tour(sp || 'hike', t0 - (i + 1) * 5 * 86400000, 8000 + 500 * i, 7200 + 300 * i, 300 + 20 * i);
  const all = Array.from({ length: 6 }, (_, i) => mk(i)), t = tour('hike', t0, 14000, 14400, 800);
  const rb = R.rueckblick(t, all.concat(t));
  ok(rb.status === 'ok' && rb.n === 6 && rb.kennzahlen.strecke.einordnung === 'ueber' && rb.kennzahlen.dauer.einordnung === 'ueber', 'Rückblick ok');
  ok(R.rueckblick(t, all.slice(0, 4).concat(t)).status === 'zu_wenig' && R.rueckblick(t, all.slice(0, 4)).kennzahlen === null, 'unter 5 Vergleichstouren: zu wenig, kein Platzhalter');
  ok(R.rueckblick(t, all.map(x => Object.assign({}, x, { sport: 'bike' })).concat(t)).status === 'zu_wenig', 'andere Sportgruppe zählt nicht');
  ok(R.rueckblick(t, all.map(x => Object.assign({}, x, { sport: 'mountaineering' })).concat(t)).status === 'ok', 'Bergsteigen gehört zur Gruppe Wandern');
  ok(R.rueckblick(t, all.map(x => Object.assign({}, x, { start: x.start - 400 * 86400000 })).concat(t)).status === 'zu_wenig', 'ältere als 12 Monate zählen nicht');
  ok(R.rueckblick(t, all.map(x => Object.assign({}, x, { start: t0 + 86400000 })).concat(t)).status === 'zu_wenig', 'spätere Touren zählen nicht');
  ok(R.rueckblick(Object.assign({}, t, { plan: 'p1' }), all).status === 'hat_plan', 'mit Plan: Plan und Ergebnis ist maßgeblich');
  ok(R.rueckblick(t, all.map(x => Object.assign({}, x, { status: 'planned' })).concat(t)).status === 'zu_wenig', 'geplante Touren zählen nicht');
  ok(R.rueckblick(Object.assign({}, t, { start: null }), all).status === 'zu_wenig', 'ohne Startzeit keine Einordnung');
  const nodauer = R.rueckblick(Object.assign({}, t, { dur: null }), all.concat(t));
  ok(nodauer.status === 'ok' && nodauer.kennzahlen.dauer === null && nodauer.kennzahlen.tempo === null && nodauer.kennzahlen.strecke !== null, 'Tour ohne Dauer: Dauer und Tempo entfallen, der Rest bleibt');
}

/* ---------- Fitness gegen die Python-Werte ---------- */
const heute = new Date(2026, 10, 20, 12);
const dn = s => { const [y, m, d] = s.split('-').map(Number); return Math.round(Date.UTC(y, m - 1, d) / 864e5); };
for (const [k, c] of Object.entries(E.fitness)) {
  const r = F.berechne(c.in.touren.map(t => ({ tag: dn(t.tag), dauer_s: t.dauer_s, up_m: t.up_m, hist: t.hist })), c.in.geburtsjahr, heute), o = c.out;
  A.strictEqual(r.status, o.status, k);
  for (const f of ['gesamt', 'vorher', 'alter', 'touren']) if (f in o) close(r[f], o[f], k + '.' + f);
  for (const f of ['einordnung', 'trend', 'von', 'bis']) if (f in o) A.strictEqual(r[f], o[f], k + '.' + f);
  for (const t of ['umfang', 'regel', 'intensitaet']) if (o[t]) for (const f of Object.keys(o[t])) { if (typeof o[t][f] === 'number') close(r[t][f], o[t][f], k + '.' + t + '.' + f); else A.strictEqual(r[t][f], o[t][f], k + '.' + t + '.' + f); }
  n += 5;
}
for (const [m, v] of E.fitness_units.umfang) close(F.teilwertUmfang(m), v, 'umfang ' + m);
for (const [l, v] of E.fitness_units.regel) close(F.teilwertRegel(l), v, 'regel ' + l);
for (const [a, v] of E.fitness_units.hfmax) close(F.hfmax(a), v, 'hfmax ' + a);
for (const [a, v] of E.fitness_units.faktor) close(F.faktorAlter(a), v, 'faktor ' + a);
for (const [args, v] of E.fitness_units.aufstieg) { const r = F.teilwertAufstieg(...args); if (v === null) A.strictEqual(r, null); else close(r.wert, v.wert, 'aufstieg ' + args); n++; }
// Altersabhängigkeit: derselbe Aufstieg je Stunde ergibt für Ältere einen höheren Teilwert und einen niedrigeren Richtwert; HFmax sinkt mit dem Alter
ok(F.teilwertAufstieg(400, 7200, 70).wert > F.teilwertAufstieg(400, 7200, 30).wert && F.teilwertAufstieg(400, 7200, 30).ref_m_h === 400 && F.teilwertAufstieg(400, 7200, 100).ref_m_h === 200, 'Aufstiegs-Richtwert hängt vom Alter ab (nie unter 200 m/h)');
ok(F.hfmax(20) > F.hfmax(60) && Math.round(F.hfmax(50)) === 173, 'HFmax = 208 − 0,7 × Alter');
// gleiche Pulsverteilung, anderes Alter: andere Zone
{
  const h = { 130: 700, 150: 700 };      // 23 Minuten
  ok(F.teilwertPuls(h, 30).zone_pct === 100 && F.teilwertPuls(h, 70).zone_pct === 50, 'Zonenanteil hängt vom Alter ab (HFmax 187 gegen 159)');
  ok(F.teilwertPuls({ 130: 599 }, 40) === null && F.teilwertPuls({ 130: 600 }, 40) !== null, 'unter 10 Minuten Pulsdaten: kein Pulswert (Rückfall auf Aufstieg)');
  ok(F.teilwertPuls({ 20: 5000, 250: 5000 }, 40) === null, 'unplausible Pulswerte zählen nicht');
}
// Geburtsjahr prüfen: Alter 10 bis 110
ok(F.pruefeJahr('1976', 2026) === 1976 && F.pruefeJahr(2016, 2026) === 2016 && F.pruefeJahr(1916, 2026) === 1916, 'Geburtsjahr an den Grenzen (Alter 10 und 110)');
for (const bad of ['2017', '1915', 'abcd', '76', '', null, '19 76', '1976.5']) { A.throws(() => F.pruefeJahr(bad, 2026), /Geburtsjahr/, String(bad)); n++; }
ok(F.berechne([{ tag: 1, dauer_s: 1, up_m: 1 }], null, heute).status === 'kein_geburtsjahr' && Object.keys(F.berechne([], '', heute)).length === 1, 'ohne Geburtsjahr nur der Status, keine Werte');
ok(F.berechne([], 1980, heute).status === 'keine_touren', 'ohne Touren');
{
  const sp = (hr, dt) => Array.from({ length: 10 }, (_, i) => ({ t: i * dt * 1000, hr }));
  const h = F.histAusSpur(sp(130, 20)); ok(h[130] === 180, 'Pulsverlauf: Sekunden je Wert');
  ok(F.histAusSpur(sp(130, 100))[130] === 270, 'Lücken zählen höchstens 30 Sekunden');
  ok(F.histAusSpur([{ t: 0, hr: null }, { t: 1000, hr: null }]) === null, 'ohne Puls: null');
}

/* ---------- Ziele ---------- */
{
  const now = new Date(2026, 6, 1, 12), ts = [tour('hike', day(2026, 2, 1), 100000, 7200, 600), tour('hike', day(2026, 4, 1), 10000, 9000, 900)];
  const g = o => Object.assign({ id: 'x', period: 'year', year: 2026, metric: 'km', target: 200, sport: '' }, o);
  const s1 = Z.stand(g({ target: 200 }), ts, now);      // 110 km, Prognose 220,6 ≥ 200
  ok(s1.status === 'im_plan' && close(s1.ist, 110) === undefined, 'im Plan');
  ok(Z.stand(g({ target: 230 }), ts, now).status === 'knapp', 'Prognose 220,6 von 230 = 96 %: knapp');
  ok(Z.stand(g({ target: 300 }), ts, now).status === 'dahinter', 'Prognose 73 %: dahinter');
  ok(Z.stand(g({ target: 100 }), ts, now).status === 'erreicht', 'erreicht');
  ok(Z.stand(g({ target: 245 }), ts, now).status === 'knapp' && Z.stand(g({ target: 245.2 }), ts, now).status === 'dahinter', 'Grenze 90 %');
  ok(Z.stand(g({ year: 2025, target: 200 }), ts, now).status === 'verfehlt' && Z.stand(g({ year: 2027 }), ts, now).status === 'offen', 'Vorjahr: verfehlt, Folgejahr: offen');
  ok(Z.stand(g({ metric: 'up', target: 2000 }), ts, now).ist === 1500 && Z.stand(g({ metric: 'count', target: 10 }), ts, now).ist === 2, 'Aufstieg und Touren');
  close(Z.stand(g({ metric: 'hours', target: 10 }), ts, now).ist, 2 + 2.5, 'Zeit in Stunden');
  ok(Z.stand(g({ sport: 'bike' }), ts, now).ist === 0 && Z.stand(g({ sport: 'grp:foot' }), ts, now).ist === 110, 'Sportart und Sportgruppe');
  ok(Z.stand(g({ target: 200 }), ts, new Date(2026, 0, 10)).status === 'offen' && Z.stand(g({ target: 200 }), ts, new Date(2026, 0, 14)).status !== 'offen', 'Prognose erst ab dem 14. Tag');
  ok(Z.stand(g({ target: 200 }), [], new Date(2026, 5, 1)).status === 'dahinter' && Z.stand(g({ target: 200 }), [], new Date(2026, 5, 1)).ist === 0, 'ohne Touren: dahinter, ist 0 (kein Fehler)');
}
{
  // Wochenziel: Mittwoch, 1. Juli 2026; die Woche beginnt am Montag, 29. Juni
  const now = new Date(2026, 6, 1, 12), w = o => Object.assign({ id: 'w', period: 'week', year: 0, metric: 'count', target: 2, sport: '' }, o);
  const ts = [tour('hike', day(2026, 6, 29, 8), 5000, 3600, 100), tour('hike', day(2026, 6, 28, 8), 5000, 3600, 100), tour('hike', day(2026, 7, 5, 8), 5000, 3600, 100)];
  let s = Z.stand(w(), ts, now);
  ok(s.ist === 1 && s.status === 'offen' && s.restTage === 4, 'Woche: Sonntag davor und Sonntag danach zählen nicht; noch 4 Tage');
  ok(Z.stand(w({ target: 1 }), ts, now).status === 'erreicht', 'Wochenziel erreicht');
  ok(Z.stand(w(), ts, new Date(2026, 6, 5, 20)).ist === 2 && Z.stand(w(), ts, new Date(2026, 6, 5, 20)).restTage === 0, 'Sonntag ist der letzte Tag');
  ok(Z.stand(w({ metric: 'km', target: 10 }), ts, now).ist === 5, 'Wochenziel in km');
  ok(Z.fuerJahr([w(), { period: 'year', year: 2025 }, { period: 'year', year: 2026 }], 2026, 2026).length === 2 && Z.fuerJahr([w(), { period: 'year', year: 2025 }], 2025, 2026).length === 1, 'Wochenziele nur im laufenden Jahr');
}
{
  // Ältere Jahresziele (kv „goals“) bleiben lesbar; erneutes Einlesen verdoppelt nichts
  const l = Z.legacy({ 2026: { km: 800, up: 15000, n: 40 }, 2025: { km: 500 }, kaputt: { km: 1 }, 2024: { km: 'viel', up: -5 } });
  ok(l.length === 4 && l.find(g => g.id === 'alt-2026-n').target === 40 && l.find(g => g.id === 'alt-2026-up').metric === 'up', 'altes Format gelesen');
  const z = Z.zusammen(Z.zusammen([], l), l); ok(z.length === 4, 'idempotent');
  ok(Z.zusammen([{ id: 'a', period: 'year', year: 2026, metric: 'km', target: 5, sport: '' }], [{ id: 'a', period: 'year', year: 2026, metric: 'km', target: 9 }]).length === 1, 'vorhandene Kennung bleibt');
  ok(Z.sauber({ id: 'q', period: 'year', year: 2026, metric: 'xx', target: 5 }) === null && Z.sauber({ id: 'q', period: 'year', year: 2026, metric: 'km', target: 0 }) === null && Z.sauber({ id: 'q', period: 'year', year: 1000, metric: 'km', target: 5 }) === null && Z.sauber(null) === null && Z.sauber({ id: 'q', period: 'week', metric: 'km', target: 5 }).year === 0, 'ungültige Ziele werden abgelehnt');
}

/* ---------- Wochen-Serie ---------- */
{
  const now = new Date(2026, 6, 1, 12);      // Mittwoch der Woche ab 29.06.
  const wk = (k) => day(2026, 6, 29 - 7 * k, 9);      // Montag, k Wochen vor der laufenden
  let s = Z.serie([tour('hike', wk(1)), tour('hike', wk(2)), tour('hike', wk(3)), tour('hike', wk(5))], now);
  ok(s.aktuell === 3 && s.offen === true && s.diese === false && s.rekord === 3, 'Serie läuft weiter, diese Woche fehlt noch eine Tour');
  s = Z.serie([tour('hike', wk(0)), tour('hike', wk(1)), tour('hike', wk(1)), tour('hike', wk(4)), tour('hike', wk(5)), tour('hike', wk(6)), tour('hike', wk(7))], now);
  ok(s.aktuell === 2 && s.offen === false && s.rekord === 4 && s.wochenMit === 6, 'Rekord 4, aktuelle Serie 2, 6 Wochen in den letzten 26');
  s = Z.serie([tour('hike', wk(2))], now); ok(s.aktuell === 0 && s.offen === false, 'Serie abgerissen: nichts zu retten');
  s = Z.serie([], now); ok(s.aktuell === 0 && s.rekord === 0 && s.wochenMit === 0, 'ohne Touren');
  // Sonntag 23:30 gehört noch zur alten, Montag 00:30 zur neuen Woche; Jahreswechsel und Zeitumstellung stören nicht
  const a = Z.weekIdx(new Date(2026, 5, 28, 23, 30).getTime()), b = Z.weekIdx(new Date(2026, 5, 29, 0, 30).getTime());
  ok(b === a + 1, 'Wochenwechsel um Mitternacht (Montag)');
  ok(Z.weekIdx(new Date(2026, 2, 29, 12).getTime()) === Z.weekIdx(new Date(2026, 2, 23, 0, 5).getTime()) && Z.weekIdx(new Date(2026, 2, 30, 0, 5).getTime()) === Z.weekIdx(new Date(2026, 2, 29, 12).getTime()) + 1, 'Zeitumstellung (29.03.2026) verschiebt keine Woche');
  ok(Z.weekIdx(new Date(2026, 0, 1).getTime()) === Z.weekIdx(new Date(2025, 11, 29).getTime()), 'Jahreswechsel: 29.12.2025 bis 04.01.2026 ist eine Woche');
}

/* ---------- Bestwerte ---------- */
{
  const ts = [tour('hike', day(2026, 1, 5), 20000, 7200, 600, { maxAlt: 1500, name: 'a' }), tour('hike', day(2026, 1, 20), 30000, 9000, 900, { maxAlt: 2100 }), tour('bike', day(2026, 3, 1), 60000, 7200, 400, { maxAlt: 700 }),
    tour('hike', day(2026, 3, 9), 15000, 20000, 0, { maxAlt: 0 }), tour('hike', day(2026, 3, 9, 14), 5000, 3600, 100, { maxAlt: 900 })];
  let b = Z.bestwerte(ts, 1);
  ok(b.strecke.length === 1 && b.strecke[0].dist === 60000 && b.aufstieg[0].up === 900 && b.dauer[0].dur === 20000 && b.hoehe[0].maxAlt === 2100, 'jeweils die beste Tour');
  ok(b.monat.length === 1 && b.monat[0].m === 2 && b.monat[0].dist === 80000 && b.monat[0].n === 3, 'stärkster Monat: März 2026 mit 80 km (3 Touren)');
  b = Z.bestwerte(ts, 3);
  ok(b.strecke.length === 3 && b.strecke.map(t => t.dist).join() === '60000,30000,20000' && b.monat.length === 2 && b.monat[1].m === 0, 'die besten drei');
  ok(b.aufstieg.length === 3 && b.aufstieg.every(t => t.up > 0) && Z.bestwerte(ts.slice(3, 4), 3).aufstieg.length === 0 && Z.bestwerte(ts.slice(3, 4), 3).hoehe.length === 0, 'Werte von 0 zählen nicht');
  ok(Z.bestwerte([], 3).strecke.length === 0 && Z.bestwerte([], 1).monat.length === 0, 'ohne Touren leer');
  ok(Z.bestwerte(ts, 7).strecke.length === 1, 'nur 1 oder 3 erlaubt');
  const tie = Z.bestwerte([tour('hike', day(2026, 5, 1), 9000, 1, 1), tour('hike', day(2026, 4, 1), 9000, 1, 1)], 1);
  ok(tie.strecke[0].start === day(2026, 4, 1), 'Gleichstand: die frühere Tour');
}

/* ---------- Sicherungs-Erinnerung ---------- */
{
  const now = new Date(2026, 10, 20, 12).getTime(), d = k => now - k * 86400000;
  ok(Z.sicherungHinweis(5, null, now, 14, null).zeigen && Z.sicherungHinweis(5, null, now, 14, null).text === 'Noch keine Sicherung gemacht', 'nie gesichert');
  ok(!Z.sicherungHinweis(0, null, now, 14, null).zeigen, 'ohne Touren nichts zu sichern');
  ok(!Z.sicherungHinweis(5, d(14), now, 14, null).zeigen && Z.sicherungHinweis(5, d(14) - 60000, now, 14, null).zeigen, 'älter als 14 Tage');
  ok(Z.sicherungHinweis(5, d(23), now, 14, null).text === 'Letzte Sicherung vor 23 Tagen' && Z.sicherungHinweis(5, d(15), now, 14, null).tage === 15, 'Text');
  ok(Z.sicherungHinweis(5, d(7.5), now, 7, null).text === 'Letzte Sicherung vor 7 Tagen' && Z.sicherungHinweis(5, d(1.2) - 1, now, 1, null).text === 'Letzte Sicherung vor 1 Tag', 'Einzahl');
  ok(!Z.sicherungHinweis(5, d(8), now, 30, null).zeigen && Z.sicherungHinweis(5, d(31), now, 30, null).zeigen && Z.sicherungHinweis(5, d(8), now, 7, null).zeigen, 'Schwelle 7 / 14 / 30');
  ok(!Z.sicherungHinweis(5, d(99), now, 0, null).zeigen && !Z.sicherungHinweis(5, null, now, 0, null).zeigen && !Z.sicherungHinweis(5, null, now, '', null).zeigen, 'aus');
  ok(!Z.sicherungHinweis(5, d(30), now, 14, now + 1000).zeigen && Z.sicherungHinweis(5, d(30), now, 14, now - 1000).zeigen && Z.sicherungHinweis(5, d(30), now, 14, now).zeigen, '„Später“: Ruhe bis zum gemerkten Zeitpunkt');
  ok(Z.sicherungHinweis(5, d(30), now, '14', null).zeigen, 'Schwelle als Text');
}

/* ---------- Aufstieg/Abstieg wie in Meine Touren (js/calc-hoehe.js gegen app/elev.py) ---------- */
(() => {
  const H = require(W + 'calc-hoehe.js'), Geo = require(W + 'geo.js');
  let maxAbw = 0;
  const abw = (a, b, m) => { n++; const d = Math.abs(a - b); maxAbw = Math.max(maxAbw, d); A.ok(d < 0.01, m + ': ' + a + ' ≠ ' + b); };
  for (const c of E.hoehe) {
    const v = c.in.filter(x => x !== null);
    const cl = H.clean(v); A.strictEqual(cl.length, c.clean.length, c.name); n++;
    cl.forEach((x, i) => abw(x, c.clean[i], c.name + ' clean ' + i));
    const sm = H.smooth(cl, 3, 3); sm.forEach((x, i) => abw(x, c.smooth[i], c.name + ' smooth ' + i));
    const [u, d] = H.ascent(sm); abw(u, c.up, c.name + ' auf'); abw(d, c.down, c.name + ' ab');
    const l = H.lauf(c.in); abw(l[0], c.up, c.name + ' lauf auf'); abw(l[1], c.down, c.name + ' lauf ab');       // Lücken (null) werden übersprungen
  }
  console.log('Höhenrechnung: ' + E.hoehe.length + ' Reihen gegen Python, größte Abweichung ' + maxAbw.toExponential(2) + ' m');
  // Läufe: ein ausgeschlossener Abschnitt trennt die Höhenreihen, jeder Lauf für sich (kein Sprung zwischen den Läufen)
  const a = E.hoehe.find(x => x.name === 'verrauscht_anstieg'), b = E.hoehe.find(x => x.name === 'abstieg');
  const r = H.aufstieg([a.in, b.in.map(x => x + 5000)]);
  abw(r.up, a.up + b.up, 'Läufe auf'); abw(r.down, a.down + b.down, 'Läufe ab'); ok(r.n === 300, 'Punkte mit Höhe');
  ok(H.aufstieg([[], [null, null]]).n === 0 && H.aufstieg([[], [null]]).up === 0, 'leer');
  ok(H.brauchbar(6) && !H.brauchbar(5), 'mehr als 5 Punkte mit Höhe');
  // Geo.stats nutzt dieselbe Rechnung und trennt Läufe an p.skip
  const pts = []; for (let i = 0; i < 40; i++) pts.push({ lat: 47 + i * 1e-4, lon: 11, ele: 500 + i * 2, t: 1e12 + i * 10000 });
  for (let i = 0; i < 40; i++) pts.push({ lat: 47.01 + i * 1e-4, lon: 11, ele: 1500 + i * 2, t: 1e12 + 500000 + i * 10000, skip: i === 0 });   // Seilbahn: 1000 m Sprung zählt nicht
  const st = Geo.stats(pts), e1 = H.lauf(pts.slice(0, 40).map(p => p.ele)), e2 = H.lauf(pts.slice(40).map(p => p.ele));
  abw(st.up, e1[0] + e2[0], 'Geo.stats Läufe'); ok(st.up < 200 && st.nEle === 80, 'Seilbahn zählt nicht: ' + st.up);
  ok(Geo.stats(pts.map(p => ({ lat: p.lat, lon: p.lon, ele: null, t: p.t }))).nEle === 0, 'ohne Höhen');
  // 2.7.0: Abstieg = gespiegelte Aufstiegsrechnung (gleiche Glättung, gleiche Schwelle). Jede Python-Reihe gespiegelt (Vorzeichen): Auf und Ab tauschen.
  // Nicht auf den Zentimeter: Am Rand nimmt der Median über 2 Werte den oberen (wie in Python) – das verschiebt höchstens eine Schwellenstufe.
  for (const c of E.hoehe) {
    const cl = H.clean(c.in.filter(x => x !== null)).map(x => -x);
    const [u, d] = H.ascent(H.smooth(cl, 3, 3)); n += 2;
    A.ok(Math.abs(u - c.down) <= 12 && Math.abs(d - c.up) <= 12, c.name + ' gespiegelt: ↑ ' + u + ' / ↓ ' + c.down + ', ↓ ' + d + ' / ↑ ' + c.up);
  }
  // Reiner Abstieg mit Rauschen unter der Schwelle: rund 500 m ab (der letzte Rest unter 4 m zählt nicht), kein Aufstieg; Wellen unter 4 m zählen gar nicht
  const ab = Array.from({ length: 251 }, (_, i) => 1500 - i * 2 + (i % 2 ? 1.2 : -1.2));
  const [ua, da] = H.lauf(ab); ok(Math.abs(da - 500) < 12 && ua < 1, 'Abstieg 500 m: ↑ ' + ua + ' ↓ ' + da);
  const welle = Array.from({ length: 100 }, (_, i) => 800 + (i % 4 < 2 ? 0 : 3)); ok(H.lauf(welle)[1] === 0 && H.lauf(welle)[0] === 0, 'Wellen unter der Schwelle');
  // Hin und zurück: gleicher Weg zurück → Abstieg ≈ Aufstieg; Geo.stats liefert beides
  const hz = []; for (let i = 0; i <= 60; i++) hz.push({ lat: 47 + i * 1e-4, lon: 11, ele: 600 + i * 5, t: 1e12 + i * 10000 });
  for (let i = 59; i >= 0; i--) hz.push({ lat: 47 + i * 1e-4, lon: 11.0001, ele: 600 + i * 5, t: 1e12 + 700000 + (59 - i) * 10000 });
  const sh = Geo.stats(hz); ok(Math.abs(sh.up - 300) < 15 && Math.abs(sh.down - 300) < 15 && Math.abs(sh.up - sh.down) < 1e-6, 'Hin und zurück: ↑ ' + sh.up + ' ↓ ' + sh.down);
})();

// Zepp-Typen: Gehen (6, 7) und 22 zählen als Wandern, Laufen (1, 8) bleibt getrennt
(() => {
  const src = require('fs').readFileSync(W + 'import.js', 'utf8'), m = src.match(/TYPEN: (\{[^}]*\})/);
  ok(!!m, 'Zepp-Typtabelle gefunden');
  const t = eval('(' + m[1] + ')');
  for (const k of [6, 7, 13, 15, 22]) ok(t[k] === 'hike', 'Typ ' + k + ' → Wandern');
  for (const k of [1, 8]) ok(t[k] === 'run', 'Typ ' + k + ' → Laufen');
  ok(t[9] === 'bike' && t[14] === 'ski', 'Rad unverändert, Typ 14 bleibt „Ski (allgemein)“ (Art unbekannt)');
  // 2.2.0: wie die Zuordnung des Servers (app/gpxtools.py ZEPP_SPORT): 43 und 105 Ski alpin, 178 Schneeschuh (Wandern + Schlagwort), 206 E-Bike
  ok(t[43] === 'skialpin' && t[105] === 'skialpin' && t[178] === 'hike' && t[206] === 'ebike', 'neue Zepp-Typen');
  const sc = src.match(/SCHNEESCHUH: (\[[^\]]*\])/); ok(!!sc && eval(sc[1]).join() === '178', 'Schneeschuh-Typ vermerkt');
})();

/* ---------- Doppelte Touren (2.1.0): Paar-Erkennung, Vorschlag „welche bleibt“, Zusammenlegen der Angaben ---------- */
(() => {
  const D = require(W + 'calc-doppelt.js'), MIN = 60000, T0 = day(2026, 8, 14, 9);
  const t = (id, start, dist, durMin, x) => Object.assign({ id, start, end: start + durMin * MIN, dur: durMin * 60, dist, status: 'done', timed: true, created: 1000, name: id }, x);
  // gleiche Startzeit: ± 5 Minuten und Länge ± 10 %
  ok(D.grund(t('a', T0, 10000, 180), t('b', T0 + 5 * MIN, 10900, 30)) === 'start', '5 min, +9 %');
  ok(D.grund(t('a', T0, 10000, 180), t('b', T0 + 5 * MIN + 1000, 10000, 30)) !== 'start', 'über 5 min ist nicht mehr „start“');
  ok(D.grund(t('a', T0, 10000, 180), t('b', T0, 11200, 180)) === null, 'Länge 12 % daneben');
  ok(D.grund(t('a', T0, 1000, 20), t('b', T0, 1290, 20)) === 'start', 'kurze Touren: 300 m Spielraum');
  ok(D.grund(t('a', T0, 1000, 20), t('b', T0, 1310, 20)) === null, 'kurze Touren: über 300 m');
  ok(D.grund(t('a', T0, 0, 180), t('b', T0, 0, 180)) === null, 'ohne Strecke kein Urteil');
  // stark überlappende Zeitspanne: mindestens 80 % der kürzeren Tour
  ok(D.grund(t('a', T0, 12000, 240), t('b', T0 + 20 * MIN, 11500, 215)) === 'zeit', 'Uhr 20 min später gestartet');
  ok(D.grund(t('a', T0, 12000, 240), t('b', T0 + 20 * MIN, 11500, 300)) === 'zeit', 'läuft länger, überlappt 220 von 240 min');
  ok(D.grund(t('a', T0, 12000, 240), t('b', T0 + 60 * MIN, 11500, 215)) === 'zeit', '180 von 215 min sind 84 %');
  ok(D.grund(t('a', T0, 12000, 240), t('b', T0 + 100 * MIN, 11500, 215)) === null, '140 von 215 min sind 65 %');
  ok(D.grund(t('a', T0, 12000, 240), t('b', T0 + 240 * MIN, 12000, 240)) === null, 'nacheinander: Hin- und Rückweg am selben Tag');
  ok(D.grund(t('a', T0, 12000, 240), t('b', T0 + 30 * MIN, 3000, 60)) === null, 'Teilstück: Länge passt nicht');
  // Zeitzonen-Versatz einer Quelle: Länge (1 %) und Dauer (60 s) gleich, Start bis 3 h daneben
  ok(D.grund(t('a', T0, 12000, 100), t('b', T0 + 120 * MIN, 12050, 100.5)) === 'versatz', '2 h versetzt');
  ok(D.grund(t('a', T0, 12000, 100), t('b', T0 + 120 * MIN, 12200, 100)) === null, 'Länge 1,7 % daneben');
  ok(D.grund(t('a', T0, 12000, 100), t('b', T0 + 120 * MIN, 12000, 103)) === null, 'Dauer 3 min daneben');
  ok(D.grund(t('a', T0, 12000, 100), t('b', T0 + 181 * MIN, 12000, 100)) === null, 'über 3 h');
  // was nicht zählt: geplant, ausgeblendet, ohne Zeit, dieselbe Tour
  const a = t('a', T0, 10000, 180);
  for (const x of [{ status: 'planned' }, { hidden: true }, { timed: false }, { start: null }]) ok(D.grund(a, t('b', T0, 10000, 180, x)) === null, 'zählt nicht: ' + JSON.stringify(x));
  ok(D.grund(a, a) === null, 'dieselbe Tour');
  ok(D.grund(a, t('b', T0, 10000, 0, { end: null, dur: 0 })) === 'start', 'ohne Ende/Dauer: Startzeit genügt');
  // Paare: sortiert (neueste zuerst), jedes Paar einmal, gemerkte Paare fehlen, kein Paar über die Tage hinweg
  const liste = [t('k1', T0, 10000, 180, { src: 'komoot' }), t('z1', T0 + 2 * MIN, 10300, 178, { src: 'zepp', hrAvg: 120 }),
    t('k2', T0 + 86400000, 8000, 120), t('z2', T0 + 86400000 + 30 * MIN, 8100, 95), t('x', T0 + 3 * 86400000, 8000, 120), t('y', T0 + 9 * 86400000, 8000, 120),
    t('p', T0, 10000, 180, { status: 'planned' })];
  let p = D.paare(liste);
  ok(p.length === 2 && p[0].key === 'k2|z2' && p[0].grund === 'zeit' && p[1].key === 'k1|z1' && p[1].grund === 'start', 'zwei Paare: ' + JSON.stringify(p.map(x => [x.key, x.grund])));
  ok(D.paare(liste.slice().reverse()).map(x => x.key).join() === p.map(x => x.key).join(), 'Reihenfolge der Eingabe egal');
  ok(D.paare(liste, { ignore: ['k1|z1'] }).length === 1 && D.paare(liste, { ignore: new Set(['k1|z1', 'k2|z2']) }).length === 0, '„Keine Doppelten“ gemerkt');
  ok(D.key('z1', 'k1') === 'k1|z1', 'Schlüssel unabhängig von der Reihenfolge');
  ok(D.paare([]).length === 0 && D.paare(null).length === 0 && D.paare([a]).length === 0, 'leer');
  // drei Einträge derselben Tour: drei Paare (nach dem ersten Zusammenführen bleibt eines)
  ok(D.paare([t('a', T0, 10000, 180), t('b', T0 + MIN, 10000, 180), t('c', T0 + 2 * MIN, 10000, 180)]).length === 3, 'Dreifache');
  // Vorschlag, welche bleibt: mehr Daten gewinnen; bei Gleichstand die früher angelegte
  ok(p[1].keep.id === 'z1' && p[1].drop.id === 'k1' && p[1].wk === 3 && p[1].wd === 0, 'Puls gewinnt');
  p = D.paare(liste, { fotos: { k1: 4 }, hand: x => x.id === 'k1' });
  ok(p[1].keep.id === 'k1' && p[1].wk === 5, 'Fotos und Name von Hand (5) schlagen Puls (3)');
  ok(D.paare([t('n', T0, 10000, 180, { created: 2000 }), t('m', T0, 10000, 180, { created: 1000 })])[0].keep.id === 'm', 'Gleichstand: die ältere bleibt');
  ok(D.paare([t('n', T0, 10000, 180, { note: ' ' }), t('m', T0, 10000, 180, { note: 'Schön', created: 5000 })])[0].keep.id === 'm', 'Notiz zählt, Leerzeichen nicht');
  ok(D.wert(t('w', T0, 1, 1, { hrAvg: 100, note: 'x', pins: [{}], tags: ['a'], fav: true, plan: 'p', elevSrc: 'zepp' }), { fotos: 2, hand: true }) === 15, 'alle Punkte');
  ok(D.hat(t('w', T0, 1, 1, { hrAvg: 100, note: 'x', pins: [{}, {}], fav: true }), { fotos: 1, hand: true }).join() === 'Puls,1 Foto,Notiz,von Hand benannt,2 Pins,Favorit', 'in Worten');
  // Zusammenlegen: Spur und Zahlen von keep; Notiz, Pins, Schlagworte, Favorit, Name und Zuordnungen von drop
  const keep = t('z', T0, 10300, 178, { src: 'zepp', srcId: 'zepp:111', name: 'Wandern am Morgen · 14.08.26', note: 'Von der Uhr', hrAvg: 120, up: 600, pins: [{ id: 'p1', ts: 5, text: 'A' }], tags: ['Alpen'] });
  const drop = t('k', T0, 10000, 180, { src: 'komoot', srcId: 'komoot:777', name: 'Kramerspitz', nameKomoot: 'Kramerspitz', note: 'Schöne Runde', upKomoot: 640, downKomoot: 630, fav: true, plan: 'plan1',
    pins: [{ id: 'p1', ts: 5, text: 'A' }, { id: 'p2', ts: 3, text: 'B' }], tags: ['Alpen', 'Gipfel'], alias: ['strava:9'] });
  let m = D.zusammen(keep, drop, { handKeep: false, handDrop: true });
  ok(m.id === 'z' && m.srcId === 'zepp:111' && m.dist === 10300 && m.up === 600 && m.hrAvg === 120, 'Spur und Zahlen der bleibenden Tour');
  ok(m.name === 'Kramerspitz' && m.nameKomoot === 'Kramerspitz' && m.komootId === '777' && m.upKomoot === 640 && m.downKomoot === 630, 'Name und Komoot-Zuordnung');
  ok(m.note === 'Von der Uhr\n\nSchöne Runde' && m.fav === true && m.plan === 'plan1' && m.tags.join() === 'Alpen,Gipfel', 'Notiz, Favorit, Plan, Schlagworte');
  ok(m.pins.length === 2 && m.pins[0].id === 'p2' && m.pins[1].id === 'p1', 'Pins ohne Doppelte, nach Zeit');
  ok(m.alias.join() === 'komoot:777,strava:9', 'Kennungen der gelöschten Tour bleiben als alias');
  ok(keep.name === 'Wandern am Morgen · 14.08.26' && !keep.alias && keep.pins.length === 1, 'Eingaben bleiben unverändert');
  ok(D.zusammen(keep, drop, { handKeep: true, handDrop: true }).name === keep.name, 'eigener Name der bleibenden Tour hat Vorrang');
  ok(D.zusammen(Object.assign({}, keep, { note: 'Schöne Runde, wirklich' }), drop, {}).note === 'Schöne Runde, wirklich', 'gleiche Notiz nicht doppelt');
  ok(D.zusammen(Object.assign({}, keep, { note: '' }), drop, {}).note === 'Schöne Runde', 'leere Notiz wird ersetzt');
  // Meine Touren: Kennung und maßgebliche Zahlen wandern mit; eine eigene Zuordnung der bleibenden Tour bleibt
  m = D.zusammen(keep, t('m', T0, 10100, 180, { src: 'mt', srcId: 'mt:g1', upMt: 655, downMt: 650, distMt: 10100, zMt: 1, nameMt: 'Kramerspitz', starsMt: 4 }), {});
  ok(m.mtId === 'g1' && m.zMt === 1 && m.up === 655 && m.down === 650 && m.dist === 10100 && m.upSrc === 'mt' && m.starsMt === 4 && m.alias.join() === 'mt:g1', 'Meine-Touren-Werte an der bleibenden Tour');
  m = D.zusammen(Object.assign({}, keep, { mtId: 'eigen', upMt: 600, zMt: 1 }), t('m', T0, 10100, 180, { mtId: 'g1', upMt: 655, zMt: 1 }), {});
  ok(m.mtId === 'eigen' && m.upMt === 600 && m.up === 600, 'vorhandene Zuordnung bleibt');
  m = D.zusammen(t('k', T0, 10000, 180, { srcId: 'komoot:777' }), t('k2', T0, 10000, 180, { komootId: '888' }), {});
  ok(m.komootId === undefined, 'Komoot-Tour behält ihre eigene Nummer');
})();

/* ---------- 2.2.0: Wintersportarten, Bewertung, Alles abgleichen ---------- */
(() => {
  const AB = require(W + 'calc-abgleich.js'), D = require(W + 'calc-doppelt.js'), H = 3600000;
  // Skigruppe: die drei neuen Arten plus „Ski (allgemein)“; Schneeschuh gehört zu Wandern (nicht mehr zu Ski)
  ok(PH.SPORT_GRP.ski.slice().sort().join() === 'nordic,ski,skialpin,skitour', 'Gruppe Ski');
  ok(PH.gleicheGruppe('skitour', 'skialpin') && PH.gleicheGruppe('nordic', 'ski') && !PH.gleicheGruppe('skitour', 'hike') && PH.gleicheGruppe('hike', 'mountaineering'), 'gleiche Gruppe: Ski unter sich, Wandern unter sich');
  ok(PH.TEMPO.skitour === 5 && PH.AUFSTIEG.skitour === 400 && PH.TEMPO.ski === 5 && PH.AUFSTIEG.ski === 400, 'Skitour und „Ski (allgemein)“ wie bisher');
  close(PH.schaetzDauer('nordic', 18, 300), 18 / 9 + 300 / 600, 'Langlauf'); close(PH.schaetzDauer('skialpin', 36, 1500), 36 / 18 + 1500 / 3000, 'Ski alpin mit Liften');
  close(PH.schaetzDauer('skitour', 10, 800), 10 / 5 + 800 / 400, 'Skitour'); close(PH.schaetzDauer('hike', 9, 500), 9 / 4.5 + 1, 'Wandern unverändert'); close(PH.schaetzDauer('unbekannt', 10, 900), 10 / 5 + 1, 'Rückfall');
  // Ziele: „grp:ski“ zählt alle Skiarten, ein altes Ziel „ski“ ebenfalls, Schneeschuh (jetzt Wandern) nicht
  for (const sp of ['skialpin', 'skitour', 'nordic', 'ski']) ok(Z.sportPasst({ sport: 'grp:ski' }, sp) && Z.sportPasst({ sport: 'ski' }, sp), 'Ziel Ski zählt ' + sp);
  ok(!Z.sportPasst({ sport: 'grp:ski' }, 'hike') && !Z.sportPasst({ sport: 'ski' }, 'hike') && Z.sportPasst({ sport: 'skitour' }, 'skitour') && !Z.sportPasst({ sport: 'skitour' }, 'nordic'), 'Ziel einzelne Art / nicht Wandern');
  const jetzt = day(2026, 11, 20, 12), zt = [tour('skitour', day(2026, 2, 1), 9000, 14000, 900), tour('nordic', day(2026, 2, 8), 15000, 5000, 100), tour('hike', day(2026, 2, 9), 8000, 9000, 300)];
  close(Z.stand({ id: 'x', period: 'year', year: 2026, metric: 'km', target: 100, sport: 'grp:ski' }, zt, new Date(jetzt)).ist, 24, 'Jahresziel Ski: 9 + 15 km');
  close(Z.stand({ id: 'x', period: 'year', year: 2026, metric: 'km', target: 100, sport: 'ski' }, zt, new Date(jetzt)).ist, 24, 'altes Ziel „Ski“ zählt alle Skiarten');

  // Bewertung: eigene Sterne gehen vor, übernommene gelten, solange nicht von Hand geändert
  ok(AB.sterne({}) === 0 && AB.sterne(null) === 0 && AB.sterne({ starsMt: 4 }) === 4 && AB.sterne({ stars: 3, starsMt: 4 }) === 3 && AB.sterne({ stars: 2, starsMan: 1, starsMt: 5 }) === 2, 'Sterne lesen');
  ok(AB.sterne({ starsMan: 1, starsMt: 5 }) === 0 && AB.sterne({ stars: 9 }) === 5 && AB.sterne({ stars: 0, starsMt: 0 }) === 0, 'von Hand entfernt = keine; zu groß = 5; 0 = keine');
  let e = {};
  ok(AB.sterneUebernehmen(e, 4) === true && e.stars === 4 && e.starsMt === 4 && !e.starsMan, 'Server-Sterne übernehmen');
  ok(AB.sterneUebernehmen(e, 4) === false, 'unverändert: keine Änderung');
  ok(AB.sterneUebernehmen(e, 2) === true && e.stars === 2 && e.starsMt === 2, 'Server ändert: zieht nach');
  ok(AB.sterneUebernehmen(e, null) === true && e.stars === undefined && e.starsMt === undefined, 'Server nimmt die Bewertung weg: weg');
  AB.sterneUebernehmen(e, 5); ok(AB.sterneSetzen(e, 3) === 3 && e.stars === 3 && e.starsMan === 1 && e.starsMt === 5, 'von Hand: 3 (Merker gesetzt, Wert des Servers bleibt als Angabe)');
  ok(AB.sterneUebernehmen(e, 1) === true && e.stars === 3 && e.starsMt === 1, 'Abgleich überschreibt die Handbewertung nie');
  ok(AB.sterneSetzen(e, 3) === 0 && e.stars === undefined && e.starsMan === 1 && AB.sterne(e) === 0, 'derselbe Stern nochmal: Bewertung entfernt (bleibt „von Hand“)');
  ok(AB.sterneUebernehmen(e, 4) === true && e.stars === undefined && AB.sterne(e) === 0, 'nach dem Entfernen von Hand holt der Abgleich sie nicht zurück');
  const e2 = {}; ok(AB.sterneSetzen(e2, 7) === 5 && AB.sterneSetzen(e2, -1) === 0 && AB.sterneSetzen(e2, 'x') === 0 && AB.sterneSetzen(e2, 2.6) === 3, 'Eingaben begrenzt');
  // Zusammenführen: von Hand gesetzte Bewertung gilt; sonst die vorhandene
  const tz = (id, x) => Object.assign({ id, start: day(2026, 8, 14, 9), end: day(2026, 8, 14, 12), dur: 10800, dist: 10000, status: 'done', timed: true, created: 1000, name: id }, x);
  ok(D.zusammen(tz('k', {}), tz('d', { stars: 4, starsMan: 1 }), {}).stars === 4 && D.zusammen(tz('k', {}), tz('d', { stars: 4, starsMan: 1 }), {}).starsMan === 1, 'Bewertung von Hand der anderen Tour kommt mit');
  ok(D.zusammen(tz('k', { stars: 2, starsMan: 1 }), tz('d', { stars: 5, starsMan: 1 }), {}).stars === 2, 'bleibende Tour mit Handbewertung behält sie');
  ok(D.zusammen(tz('k', { stars: 2 }), tz('d', { stars: 5, starsMan: 1 }), {}).stars === 5, 'Handbewertung der anderen schlägt eine übernommene');
  ok(D.zusammen(tz('k', {}), tz('d', { starsMt: 3, stars: 3 }), {}).stars === 3 && !D.zusammen(tz('k', {}), tz('d', { starsMt: 3, stars: 3 }), {}).starsMan, 'übernommene Bewertung der anderen, wenn die bleibende keine hat');
  ok(D.zusammen(tz('k', { stars: 4 }), tz('d', { stars: 1 }), {}).stars === 4 && AB.sterne(D.zusammen(tz('k', {}), tz('d', {}), {})) === 0, 'sonst bleibt es bei der bleibenden / keiner');
  // Ski zählen (Migration): nur unbestimmte „Ski (allgemein)“-Touren ohne Handwahl, keine geplanten
  ok(AB.skiOffen([{ sport: 'ski' }, { sport: 'ski', sportMan: 1 }, { sport: 'ski', status: 'planned' }, { sport: 'skitour' }, { sport: 'hike' }, null]) === 1 && AB.skiOffen(null) === 0, 'Ski offen');

  // Alles abgleichen: Reihenfolge, Anzeige, wann automatisch
  ok(AB.REIHENFOLGE.join() === 'zepp,komoot,mt' && AB.NAMEN.mt === 'Meine Touren', 'Reihenfolge Zepp → Komoot → Meine Touren');
  const nowT = day(2026, 11, 20, 12);
  ok(AB.wann(day(2026, 11, 20, 8) + 12 * 60000, nowT) === 'heute 08:12' && AB.wann(day(2026, 11, 19, 12), nowT) === 'gestern 12:00' && AB.wann(day(2026, 11, 3, 7), nowT) === '03.11. 07:00' && AB.wann(day(2025, 12, 24, 18), nowT) === '24.12.2025 18:00' && AB.wann(0, nowT) === '', 'Zeitangabe');
  ok(AB.wann(new Date(2026, 10, 20, 0, 5).getTime(), new Date(2026, 10, 20, 23, 0).getTime()) === 'heute 00:05' && AB.wann(new Date(2026, 10, 19, 23, 59).getTime(), new Date(2026, 10, 20, 0, 1).getTime()) === 'gestern 23:59', 'um Mitternacht');
  ok(AB.zeile({ t: day(2026, 11, 20, 8) + 12 * 60000, neu: 2, fehler: 0 }, nowT) === 'Zuletzt abgeglichen: heute 08:12 · 2 neue Touren', 'Zeile 2 neue');
  ok(AB.zeile({ t: day(2026, 11, 20, 8), neu: 1 }, nowT) === 'Zuletzt abgeglichen: heute 08:00 · 1 neue Tour' && AB.zeile({ t: day(2026, 11, 20, 8), neu: 0 }, nowT) === 'Zuletzt abgeglichen: heute 08:00 · nichts Neues', 'Zeile 1 / 0');
  ok(AB.zeile({ t: day(2026, 11, 20, 8), neu: 3, fehler: 1 }, nowT).endsWith('· 3 neue Touren · 1 Quelle mit Fehler') && AB.zeile({ t: day(2026, 11, 20, 8), neu: 0, fehler: 2 }, nowT).endsWith('2 Quellen mit Fehler') && AB.zeile(null) === '' && AB.zeile({}) === '', 'Zeile mit Fehlern / leer');
  ok(AB.neue([{ res: { added: 2 } }, { err: new Error('x') }, { res: { added: 1 } }, { skipped: true }, null]) === 3 && AB.neue(null) === 0, 'neue Touren zählen');
  const er = x => Object.assign(new Error('x'), x);
  ok(/Meine Touren neu anmelden/.test(AB.fehlerText('mt', er({ relogin: true }))) && /Mehr → Touren importieren → Meine Touren/.test(AB.fehlerText('mt', er({ relogin: true }))), 'Anmeldung abgelaufen: Meine Touren, mit Ort');
  ok(/Komoot neu anmelden/.test(AB.fehlerText('komoot', new Error('Tourenliste: HTTP 401'))) && /Zepp neu anmelden/.test(AB.fehlerText('zepp', new Error('Zepp-Anfrage fehlgeschlagen (403). Zugang abgelaufen? Bitte neu anmelden.'))), 'Anmeldung abgelaufen: Komoot, Zepp');
  ok(AB.fehlerText('mt', new Error('Meine Touren ist unter https://x nicht erreichbar. Bitte Adresse und Verbindung prüfen (WLAN, Tailscale).')).startsWith('Meine Touren ist unter') && AB.fehlerText('komoot', new Error('Tourenliste: HTTP 500')) === 'Tourenliste: HTTP 500' && AB.fehlerText('zepp', null) === 'Unbekannter Fehler', 'andere Fehler im Wortlaut');
  const desc = r => (r.added ? r.added + ' neu' : 'Nichts gefunden');
  ok(AB.quellZeile({ id: 'zepp', res: { added: 2 } }, desc) === '2 neu' && AB.quellZeile({ id: 'zepp', res: {} }, desc) === 'Nichts Neues' && AB.quellZeile({ id: 'mt', skipped: true }, desc) === 'Nicht ausgeführt (abgebrochen)' && /Komoot neu anmelden/.test(AB.quellZeile({ id: 'komoot', err: new Error('HTTP 401') }, desc)), 'Zeile je Quelle');
  const f = o => AB.faellig(Object.assign({ an: true, quellen: 2, live: false, last: nowT - 25 * H, lastTry: nowT - 25 * H, now: nowT }, o));
  ok(f({}) === true && f({ last: undefined, lastTry: undefined }) === true, 'fällig nach 25 h / noch nie');
  ok(f({ an: false }) === false && f({ quellen: 0 }) === false && f({ live: true }) === false, 'aus, keine Quelle, Aufzeichnung läuft: nie');
  ok(f({ last: nowT - 23 * H, lastTry: nowT - 23 * H }) === false && f({ last: nowT - 24 * H, lastTry: nowT - 24 * H }) === true && f({ last: nowT - 24 * H + 1000, lastTry: nowT - 24 * H }) === false, 'höchstens einmal je 24 h (Grenze)');
  ok(f({ lastTry: nowT - 30 * 60000 }) === false && f({ lastTry: nowT - 61 * 60000 }) === true, 'nach Fehlversuch frühestens nach einer Stunde');
  ok(f({ last: nowT + 5 * H, lastTry: nowT + 5 * H }) === true, 'Uhr zurückgestellt: nicht für immer gesperrt');
  ok(AB.faellig(null) === false && AB.faellig({}) === false, 'ohne Angaben nicht fällig');
})();


/* ---------- 2.3.0 Jahresrückblick (calc-jahr.js) ---------- */
(() => {
  const J = require(W + 'calc-jahr.js'), AB = require(W + 'calc-abgleich.js');
  const T = (id, sport, start, dist, up, o) => Object.assign({ id, name: id, sport, start, dist, up, dur: dist / 1.2, moving: dist / 1.5, maxAlt: 1000 + (up || 0), status: 'done', timed: true }, o);
  const eq = (a, b, m) => { n++; A.deepStrictEqual(a, b, m); };

  // Leeres Jahr, ohne Daten, nur geplante/ausgeblendete Touren: nichts Erfundenes
  const leer = J.berechne([], 2026, new Date(2026, 10, 20));
  ok(leer.leer && leer.n === 0 && leer.hoehepunkte === null && leer.vorjahr === null && leer.sportarten.length === 0 && leer.monate.length === 12 && leer.monate.every(m => m.n === 0), 'Jahr ohne Touren');
  ok(J.berechne(null, 2026).leer && J.berechne(undefined, 2026).leer, 'ohne Liste: leer, kein Absturz');
  ok(J.berechne([T('p', 'hike', day(2026, 5, 1), 5000, 100, { status: 'planned' }), T('h', 'hike', day(2026, 5, 2), 5000, 100, { hidden: true })], 2026).leer, 'geplant und ausgeblendet zählen nicht');
  ok(!J.zaehlt(null) && !J.zaehlt(T('x', 'hike', undefined, 1, 1)) && !J.zaehlt(T('x', 'hike', NaN, 1, 1)) && !J.zaehlt(T('x', 'hike', day(2026, 1, 1), 1, 1, { status: 'planned' })) && J.zaehlt(T('x', 'hike', day(2026, 1, 1), 1, 1)), 'zaehlt');
  ok(J.zaehlt(T('u', 'hike', day(2026, 1, 1), 1, 1, { timed: false })), 'Touren ohne Uhrzeit zählen mit (wie in der Statistik)');

  // Kennzahlen: Zeit = Summe „in Bewegung“, ersatzweise Summe der Dauer (wie die Statistik); aktive Tage = verschiedene Kalendertage
  const A1 = [T('a', 'hike', day(2026, 3, 7, 8), 10000, 500), T('b', 'hike', day(2026, 3, 7, 15), 5000, 200), T('c', 'run', day(2026, 3, 9, 7), 8000, 50)];
  const k = J.kennzahlen(A1);
  ok(k.n === 3 && k.dist === 23000 && k.up === 750 && k.tage === 2 && Math.abs(k.zeit - 23000 / 1.5) < 1e-6, 'Kennzahlen');
  ok(Math.abs(J.kennzahlen(A1.map(t => Object.assign({}, t, { moving: 0 }))).zeit - 23000 / 1.2) < 1e-6, 'Zeit: ohne „in Bewegung“ die Dauer');
  ok(Math.abs(J.kennzahlen(A1.map((t, i) => i ? Object.assign({}, t, { moving: 0 }) : t)).zeit - 10000 / 1.5) < 1e-6, 'Zeit: wie die Statistik die Summe der Bewegungszeit, wenn es sie gibt (nicht je Tour gemischt)');
  eq(J.kennzahlen([]), { n: 0, dist: 0, up: 0, zeit: 0, tage: 0 }, 'Kennzahlen leer');
  ok(J.kennzahlen([T('n', 'hike', day(2026, 1, 1), undefined, undefined, { dur: undefined, moving: undefined })]).dist === 0, 'fehlende Werte zählen 0');

  // Jahreswechsel nach Startzeit (Ortszeit): 31.12. 23:30 gehört zum alten, 01.01. 00:30 zum neuen Jahr; 31.12.23:59:59.999 / 1.1. 00:00:00
  const sylv = new Date(2025, 11, 31, 23, 30).getTime(), neujahr = new Date(2026, 0, 1, 0, 30).getTime();
  const W2 = [T('s', 'hike', sylv, 12000, 300), T('j', 'hike', neujahr, 8000, 100), T('e', 'hike', new Date(2025, 11, 31, 23, 59, 59, 999).getTime(), 1000, 0), T('f', 'hike', new Date(2026, 0, 1, 0, 0, 0, 0).getTime(), 2000, 0)];
  ok(J.berechne(W2, 2025, new Date(2026, 5, 1)).n === 2 && J.berechne(W2, 2026, new Date(2026, 5, 1)).n === 2 && J.berechne(W2, 2025, new Date(2026, 5, 1)).ids.join() === 's,e', 'Jahreswechsel nach Startzeit');
  ok(J.jahre(W2).join() === '2026,2025' && J.jahre([]).length === 0 && J.jahre(null).length === 0, 'Jahre, neueste zuerst');
  // Zeitzone: dieselbe Tour (UTC 31.12.2025 23:30) liegt in Madrid schon im neuen, in Los Angeles noch im alten Jahr – wie die App sonst Tage bestimmt (Ortszeit des Geräts)
  const utc = Date.UTC(2025, 11, 31, 23, 30), tz0 = process.env.TZ;
  const inJahr = tz => { process.env.TZ = tz; try { return [J.berechne([T('z', 'hike', utc, 5000, 10)], 2025, new Date(2026, 5, 1)).n, J.berechne([T('z', 'hike', utc, 5000, 10)], 2026, new Date(2026, 5, 1)).n]; } finally { process.env.TZ = tz0; } };
  eq(inJahr('Europe/Madrid'), [0, 1], 'Europe/Madrid: 00:30 am 1. Januar');
  eq(inJahr('America/Los_Angeles'), [1, 0], 'Los Angeles: noch der 31. Dezember');
  eq(inJahr('Europe/Berlin'), [0, 1], 'Berlin wie Madrid');
  process.env.TZ = 'Europe/Madrid';
  { const k2 = J.kennzahlen([T('m1', 'hike', Date.UTC(2026, 5, 10, 21, 30), 1, 1), T('m2', 'hike', Date.UTC(2026, 5, 10, 22, 30), 1, 1)]); ok(k2.tage === 2, 'Madrid: 23:30 und 00:30 Ortszeit sind zwei Tage (UTC: ein Tag)'); }
  process.env.TZ = tz0;
  ok(process.env.TZ === 'Europe/Berlin', 'Zeitzone zurückgestellt');

  // Vorjahr: nur wenn das Vorjahr Touren hat; im laufenden Jahr bis zum gleichen Kalendertag, sonst volles Jahr
  const V = [T('v1', 'hike', day(2025, 3, 1), 20000, 400), T('v2', 'hike', day(2025, 11, 25), 30000, 900), T('c1', 'hike', day(2026, 3, 1), 25000, 500), T('c2', 'hike', day(2026, 6, 1), 15000, 100)];
  const lauf = J.berechne(V, 2026, new Date(2026, 10, 20, 9));
  ok(lauf.vorjahr && lauf.vorjahr.bisHeute && lauf.vorjahr.year === 2025 && lauf.vorjahr.kennzahlen.n === 1 && lauf.vorjahr.diff.n === 1 && lauf.vorjahr.diff.dist === 40000 - 20000 && lauf.vorjahr.diff.up === 600 - 400, 'laufendes Jahr: Vorjahr bis zum 20.11. (die Tour vom 25.11. fehlt noch)');
  const fertig = J.berechne(V, 2025, new Date(2026, 10, 20, 9));
  ok(fertig.vorjahr === null, 'Vorjahr ohne Touren: kein Vergleich');
  const voll = J.berechne(V.concat([T('v0', 'hike', day(2024, 5, 5), 10000, 0)]), 2025, new Date(2026, 10, 20));
  ok(voll.vorjahr && !voll.vorjahr.bisHeute && voll.vorjahr.diff.n === 1 && voll.vorjahr.diff.dist === 50000 - 10000, 'abgeschlossenes Jahr: ganzes Jahr gegen ganzes Jahr');
  ok(J.berechne([T('a', 'hike', day(2025, 2, 28), 1000, 0), T('b', 'hike', day(2026, 1, 5), 1000, 0)], 2026, new Date(2026, 1, 28, 12)).vorjahr.kennzahlen.n === 1, 'Vorjahr bis 28.02.');
  ok(J.berechne([T('a', 'hike', day(2024, 2, 10), 1000, 0), T('a2', 'hike', day(2024, 2, 29), 1000, 0), T('b', 'hike', day(2024, 3, 1), 1000, 0), T('c', 'hike', day(2025, 1, 5), 1000, 0)], 2025, new Date(2025, 1, 28, 12)).vorjahr.kennzahlen.n === 1, 'Vorjahr (Schaltjahr) bis 28.02.: der 29.02. und spätere fehlen noch');
  ok(J.berechne([T('a', 'hike', day(2023, 2, 28), 1000, 0), T('c', 'hike', day(2024, 1, 5), 1000, 0)], 2024, new Date(2024, 1, 29, 12)).vorjahr.kennzahlen.n === 1, 'Stichtag 29.02.: Vorjahr bis 28.02.');
  ok(J.berechne([T('a', 'hike', day(2025, 3, 1), 1000, 0), T('c', 'hike', day(2026, 1, 5), 1000, 0)], 2026, new Date(2026, 1, 1, 12)).vorjahr === null, 'Vorjahr ohne Touren bis zum Stichtag: kein Vergleich');
  ok(J.berechne([T('a', 'hike', day(2025, 12, 1), 1000, 0), T('c', 'hike', day(2026, 1, 5), 1000, 0)], 2026, new Date(2026, 0, 10)).vorjahr === null, 'Vorjahr hat erst später im Jahr Touren: kein Vergleich im Januar');

  // Sportarten: Gruppen; Schneeschuh bleibt Wandern (Sportart hike + Schlagwort); Anteil nach Strecke, absteigend
  const S = [T('w1', 'hike', day(2026, 1, 10), 10000, 300, { tags: ['Schneeschuh'] }), T('w2', 'walk', day(2026, 1, 11), 2000, 10), T('w3', 'mountaineering', day(2026, 1, 12), 6000, 900),
    T('r1', 'mtb', day(2026, 5, 1), 40000, 800), T('r2', 'ebike', day(2026, 5, 2), 20000, 200), T('l1', 'run', day(2026, 6, 1), 10000, 50),
    T('s1', 'skitour', day(2026, 2, 1), 9000, 1200), T('s2', 'nordic', day(2026, 2, 2), 3000, 20), T('s3', 'ski', day(2026, 2, 3), 1000, 0), T('o1', 'other', day(2026, 7, 1), 1000, 0), T('o2', 'unbekannt', day(2026, 7, 2), 1000, 0)];
  const sp = J.nachSportart(S);
  eq(sp.map(g => [g.key, g.n]), [['rad', 2], ['wandern', 3], ['ski', 3], ['laufen', 1], ['sonst', 2]].sort((a, b) => ({ rad: 60, wandern: 18, ski: 13, laufen: 10, sonst: 2 })[b[0]] - ({ rad: 60, wandern: 18, ski: 13, laufen: 10, sonst: 2 })[a[0]]), 'Sportgruppen nach Strecke sortiert');
  ok(sp.find(g => g.key === 'wandern').dist === 18000 && sp.find(g => g.key === 'wandern').up === 1210 && Math.abs(sp.reduce((a, g) => a + g.anteil, 0) - 1) < 1e-9, 'Wandern enthält Schneeschuh, Spazieren und Bergsteigen; Anteile ergeben 1');
  ok(J.nachSportart([]).length === 0, 'keine Touren: keine Gruppen');
  ok(J.nachSportart([T('z', 'hike', day(2026, 1, 1), 0, 0), T('y', 'run', day(2026, 1, 2), 0, 0)]).every(g => g.anteil === 0.5), 'ohne Strecke teilt die Zahl der Touren');

  // Monate und aktivster Monat
  const M = J.nachMonat(S.concat([T('x', 'hike', day(2026, 5, 20), 1000, 0)]));
  ok(M.length === 12 && M[4].n === 3 && M[4].dist === 61000 && M[0].name === 'Januar' && M[11].n === 0, 'Monate');
  ok(J.aktivsterMonat(M).m === 4 && J.aktivsterMonat(J.nachMonat([])) === null, 'aktivster Monat nach Strecke');
  ok(J.aktivsterMonat(J.nachMonat([T('a', 'hike', day(2026, 3, 1), 0, 0), T('b', 'hike', day(2026, 8, 1), 0, 0), T('c', 'hike', day(2026, 8, 2), 0, 0)])).m === 7, 'Gleichstand bei der Strecke: mehr Touren');

  // Höhepunkte (Bestwerte wiederverwendet), Serie, schönste Tour
  const hp = J.berechne(S, 2026, new Date(2027, 0, 5)).hoehepunkte;
  ok(hp.laengste.id === 'r1' && hp.aufstieg.id === 's1' && hp.hoechster.id === 's1' && hp.monat.m === 4, 'Höhepunkte');
  eq(J.berechne(S, 2026, new Date(2027, 0, 5)).hoehepunkte.laengste, Z.bestwerte(S, 1).strecke[0], 'längste Tour = Bestwerte');
  ok(J.berechne([T('a', 'hike', day(2026, 1, 1), 0, 0, { maxAlt: null })], 2026).hoehepunkte.hoechster === null && J.berechne([T('a', 'hike', day(2026, 1, 1), 0, 0)], 2026).hoehepunkte.laengste === null, 'ohne Werte keine Höhepunkte');
  ok(hp.schoenste === null, 'nichts bewertet: keine schönste Tour');
  const R = [T('a', 'hike', day(2026, 4, 1), 1000, 0, { stars: 4, starsMan: 1 }), T('b', 'hike', day(2026, 4, 2), 5000, 0, { starsMt: 5 }), T('c', 'hike', day(2026, 4, 3), 9000, 0, { starsMt: 5 }), T('d', 'hike', day(2026, 4, 4), 99000, 0)];
  const sc = J.schoenste(R);
  ok(sc.tour.id === 'c' && sc.sterne === 5 && sc.gleiche === 2, 'schönste: 5 Sterne (aus Meine Touren), bei Gleichstand die längere');
  ok(J.schoenste([T('a', 'hike', day(2026, 4, 1), 1, 0, { stars: 5, starsMan: 1 }), T('b', 'hike', day(2026, 4, 1), 1, 0, { starsMt: 3, stars: 0, starsMan: 1 })]).tour.id === 'a' && AB.sterne(R[0]) === 4, 'von Hand gesetzte Sterne gelten');
  ok(J.schoenste([T('a', 'hike', day(2026, 4, 1), 1, 0, { stars: 0 })]) === null && J.schoenste([]) === null, 'Bewertung 0 zählt nicht');
  // Serie: Wochen (Mo–So) in Folge, nur Touren des Jahres; über die Jahresgrenze gezählt jede Woche für sich
  const wk = (y, m, d) => T('w' + y + m + d, 'hike', day(y, m, d), 1000, 0);
  const serie = (ts, y) => J.berechne(ts, y, new Date(y + 1, 5, 1)).hoehepunkte.serieWochen;
  ok(serie([wk(2026, 1, 5), wk(2026, 1, 12), wk(2026, 1, 20), wk(2026, 2, 16)], 2026) === 3 && serie([wk(2026, 3, 2)], 2026) === 1, 'Serie: drei Wochen in Folge, dann Lücke');
  ok(serie([wk(2026, 1, 5), wk(2026, 1, 7), wk(2026, 1, 11)], 2026) === 1, 'mehrere Touren in einer Woche (Mo–So) zählen einmal');
  ok(serie([wk(2025, 12, 15), wk(2025, 12, 22), wk(2025, 12, 29), wk(2026, 1, 5), wk(2026, 1, 12)], 2026) === 2 && serie([wk(2025, 12, 15), wk(2025, 12, 22), wk(2025, 12, 29), wk(2026, 1, 5), wk(2026, 1, 12)], 2025) === 3, 'Serie über die Jahresgrenze: jedes Jahr zählt nur seine eigenen Touren (29.12. liegt in der Woche bis 4.1.)');
  ok(serie([wk(2025, 12, 30), wk(2026, 1, 2)], 2026) === 1 && serie([wk(2025, 12, 30), wk(2026, 1, 2)], 2025) === 1, 'dieselbe Kalenderwoche über Silvester: in beiden Jahren eine Woche');
  ok(serie([wk(2026, 12, 21), wk(2026, 12, 28)], 2026) === 2 && serie([wk(2026, 12, 21), wk(2026, 12, 28), wk(2027, 1, 4)], 2026) === 2, 'Serie bis zum Jahresende');
  eq(J.berechne(S, 2026, new Date(2027, 0, 5)).hoehepunkte.serieWochen, Z.serie(S, new Date(2026, 11, 31)).rekord, 'Serie = vorhandene Wochen-Serie (Rekord)');

  // Regionen: nur bekannte, nichts erfunden
  const rg = J.regionen([T('a', 'hike', 1, 3000, 0), T('b', 'hike', 2, 5000, 0), T('c', 'hike', 3, 1000, 0), T('d', 'hike', 4, 1000, 0)], t => ({ a: 'Tirol', b: 'Tirol', c: 'Südtirol' })[t.id] || '');
  eq(rg, [{ name: 'Tirol', n: 2, dist: 8000 }, { name: 'Südtirol', n: 1, dist: 1000 }], 'Regionen: Tour d ohne Ort fehlt');
  ok(J.regionen([T('a', 'hike', 1, 1, 0)], () => '').length === 0 && J.regionen([T('a', 'hike', 1, 1, 0)], null).length === 0 && J.regionen([], t => 'x').length === 0, 'ohne Ortsangaben: leer');
  ok(J.regionen(Array.from({ length: 9 }, (_, i) => T('t' + i, 'hike', i, 1, 0)), t => 'R' + t.id).length === 5 && J.regionen(Array.from({ length: 9 }, (_, i) => T('t' + i, 'hike', i, 1, 0)), t => 'R' + t.id, 3).length === 3, 'höchstens fünf (oder die gewünschte Zahl)');

  // Jahr wählen und Startseiten-Eintrag
  const jj = [T('a', 'hike', day(2025, 6, 1), 1, 0), T('b', 'hike', day(2026, 1, 20), 1, 0)];
  ok(J.vorgabe(jj, new Date(2026, 10, 20)) === 2026 && J.vorgabe(jj, new Date(2026, 0, 31, 23, 59)) === 2025 && J.vorgabe(jj, new Date(2026, 1, 1)) === 2026, 'Vorgabe: im Januar das Vorjahr, ab 1. Februar das laufende');
  ok(J.vorgabe([T('b', 'hike', day(2026, 1, 20), 1, 0)], new Date(2026, 0, 31)) === 2026 && J.vorgabe([], new Date(2026, 0, 3)) === 2026, 'Januar ohne Touren im Vorjahr: das laufende Jahr');
  ok(J.waehle('2024', jj, new Date(2026, 10, 20)) === 2024 && J.waehle('abc', jj, new Date(2026, 10, 20)) === 2026 && J.waehle(undefined, jj, new Date(2026, 10, 20)) === 2026 && J.waehle('99999', jj, new Date(2026, 10, 20)) === 2026 && J.waehle('1850', jj, new Date(2026, 10, 20)) === 2026 && J.waehle('2025 ', jj, new Date(2026, 0, 5)) === 2025 && J.waehle('2025-1', jj, new Date(2026, 0, 5)) === 2025, 'Jahr aus der Adresse');
  eq(J.vorschlag(jj, new Date(2026, 10, 20)), { year: 2026, n: 1, hervor: false }, 'Nov: ruhig');
  eq(J.vorschlag(jj, new Date(2026, 11, 2)), { year: 2026, n: 1, hervor: true }, 'Dez: hervorgehoben');
  eq(J.vorschlag(jj, new Date(2026, 0, 15)), { year: 2025, n: 1, hervor: true }, 'Jan: Vorjahr, hervorgehoben');
  eq(J.vorschlag([T('a', 'hike', day(2025, 6, 1), 1, 0)], new Date(2026, 11, 2)), { year: 2026, n: 0, hervor: false }, 'Dez ohne Touren im Jahr: nicht hervorgehoben');
  eq(J.vorschlag([], new Date(2026, 11, 2)), { year: 2026, n: 0, hervor: false }, 'ohne Touren');

  // Gleiche Zahlen wie die Jahresstatistik: v-stats.js filtert mit Jahr.zaehlt und rechnet mit Jahr.kennzahlen (Quelltext geprüft); hier die Zahlen gegen eine unabhängige Nachrechnung nach dem alten Text der Statistik
  const fs = require('fs'), stats = fs.readFileSync(W + 'v-stats.js', 'utf8');
  ok(/filter\(Jahr\.zaehlt\)/.test(stats) && /Jahr\.kennzahlen\(ts\)/.test(stats) && !/status !== 'planned'/.test(stats), 'v-stats.js benutzt Jahr.zaehlt und Jahr.kennzahlen');
  const alt = (all, year) => { const ts = all.filter(t => t.status !== 'planned' && !t.hidden).filter(t => new Date(t.start).getFullYear() === year); const sm = k => ts.reduce((a, t) => a + (t[k] || 0), 0);
    return { n: ts.length, dist: sm('dist'), up: sm('up'), zeit: sm('moving') || sm('dur'), tage: new Set(ts.map(t => new Date(t.start).toDateString())).size }; };
  let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const viele = Array.from({ length: 400 }, (_, i) => T('r' + i, ['hike', 'run', 'mtb', 'skitour', 'walk', 'other'][i % 6], new Date(2024 + (i % 3), Math.floor(rnd() * 12), 1 + Math.floor(rnd() * 28), Math.floor(rnd() * 24), Math.floor(rnd() * 60)).getTime(), Math.round(rnd() * 30000), Math.round(rnd() * 900),
    { status: i % 17 === 0 ? 'planned' : 'done', hidden: i % 23 === 0, moving: i % 5 === 0 ? 0 : Math.round(rnd() * 20000) }));
  for (const y of [2024, 2025, 2026]) eq(J.berechne(viele, y, new Date(2030, 0, 1)).kennzahlen, alt(viele, y), 'Jahr ' + y + ' = Statistik');
  eq(J.berechne(viele, 2025, new Date(2030, 0, 1)).kennzahlen, J.kennzahlen(viele.filter(J.zaehlt).filter(t => new Date(t.start).getFullYear() === 2025)), 'berechne = kennzahlen');
  ok(J.berechne(viele, 2025, new Date(2030, 0, 1)).sportarten.reduce((a, g) => a + g.n, 0) === alt(viele, 2025).n && Math.abs(J.berechne(viele, 2025, new Date(2030, 0, 1)).sportarten.reduce((a, g) => a + g.dist, 0) - alt(viele, 2025).dist) < 1e-6, 'Sportarten ergeben zusammen die Gesamtzahlen');
  ok(Math.abs(J.berechne(viele, 2025, new Date(2030, 0, 1)).monate.reduce((a, g) => a + g.dist, 0) - alt(viele, 2025).dist) < 1e-6 && J.berechne(viele, 2025, new Date(2030, 0, 1)).monate.reduce((a, g) => a + g.n, 0) === alt(viele, 2025).n, 'Monate ergeben zusammen die Gesamtzahlen');
})();

/* ---------- Wanderführer (2.4.0): Buchtouren lesen, Abgleich „folgt der Tour der Buchstrecke?“, Zwischenspeicher, Blöcke, Anzeige ---------- */
const Fu = require(W + 'calc-fuehrer.js');
let fseed = 11; const frnd = () => (fseed = (fseed * 1103515245 + 12345) % 2147483648) / 2147483648;
const FM = 111195, LA0 = 47.5, LO0 = 11.2, KOS = Math.cos(LA0 * Math.PI / 180);
/** Geschwungene Strecke von `laenge` m mit n Punkten; Anfang bei (dx, dy) m; Rauschen in m; form = Verlauf der Breite. */
const strecke = (laenge, n, o) => {
  o = o || {}; const dx = o.dx || 0, dy = o.dy || 0, noise = o.noise || 0, amp = o.amp == null ? 0.12 : o.amp, ph = o.ph || 0;
  return Array.from({ length: n }, (_, i) => { const t = i / (n - 1), x = laenge * t, y = laenge * amp * Math.sin(4 * Math.PI * t + ph) + laenge * 0.05 * t;
    return { lat: LA0 + (y + dy + (frnd() - .5) * 2 * noise) / FM, lon: LO0 + (x + dx + (frnd() - .5) * 2 * noise) / (FM * KOS), ele: 800 + 300 * t }; });
};
const teil = (p, a, b) => p.slice(Math.round(a * (p.length - 1)), Math.round(b * (p.length - 1)) + 1);
const umk = p => p.slice().reverse();
const prep = p => Fu.vorbereiten(Fu.duenne(p, Fu.MAX_TOUR));
const buchP = p => Fu.vorbereiten(Fu.duenne(p, Fu.MAX_BUCH));
const folgt = (buch, tour) => Fu.vergleiche(buchP(buch), prep(tour));

/* ---------- 2.5.0 PDF: Aufbau, Querverweistabelle, Seitenaufteilung, Raster, Skizze, Profil, Text ---------- */
(() => {
  const P = require(W + 'calc-pdf.js');
  // Ein kleines echtes JPEG (1 × 1 Pixel, 3 Kanäle) und eines mit 1 Kanal – von Hand gebaut genügt für den Aufbau; die echte Lesbarkeit prüft test_web.py mit pypdf.
  const jpg = (w, h, comps, fill) => { const body = new Uint8Array(40).fill(fill || 7); const sof = [0xFF, 0xC0, 0x00, 8 + 3 * comps, 8, h >> 8, h & 255, w >> 8, w & 255, comps]; for (let i = 0; i < comps; i++) sof.push(i + 1, 0x11, 0); return Uint8Array.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x04, 0, 0, ...sof, ...body, 0xFF, 0xD9]); };
  const J = jpg(1240, 1754, 3), G = jpg(100, 50, 1);
  A.deepStrictEqual(P.jpegInfo(J), { w: 1240, h: 1754, comps: 3 }); n++;
  A.deepStrictEqual(P.jpegInfo(G), { w: 100, h: 50, comps: 1 }); n++;
  A.throws(() => P.jpegInfo(new Uint8Array([1, 2, 3, 4])), /JPEG/); n++;
  A.throws(() => P.jpegInfo(Uint8Array.from([0xFF, 0xD8, 0xFF, 0xD9])), /JPEG/); n++;
  const pdf = P.build([J, J, G], { title: 'Hüttenrunde – März ß', created: new Date(Date.UTC(2026, 10, 20, 14, 30, 5)) });
  const txt = Buffer.from(pdf).toString('latin1');
  ok(txt.startsWith('%PDF-1.4\n') && txt.endsWith('%%EOF\n'), 'Anfang %PDF-1.4, Ende %%EOF');
  ok(pdf[10] > 127 && pdf[11] > 127, 'Binärkommentar nach der Kopfzeile');
  // Querverweistabelle: jeder Eintrag zeigt wirklich auf „<n> 0 obj“; startxref zeigt auf „xref“
  const sx = +/startxref\n(\d+)\n%%EOF\n$/.exec(txt)[1];
  ok(txt.slice(sx, sx + 5) === 'xref\n', 'startxref zeigt auf die Tabelle');
  const m = /xref\n0 (\d+)\n((?:\d{10} \d{5} [nf] \n)+)trailer/.exec(txt.slice(sx)); const cnt = +m[1], entries = m[2].match(/[\s\S]{20}/g);
  ok(cnt === 4 + 3 * 3 && entries.length === cnt && entries[0] === '0000000000 65535 f \n', 'Zahl der Einträge: ' + cnt);
  for (let i = 1; i < cnt; i++) { const off = +entries[i].slice(0, 10); ok(txt.slice(off).startsWith(i + ' 0 obj\n') && entries[i].endsWith(' 00000 n \n'), 'xref-Eintrag ' + i + ' zeigt auf Objekt ' + i); }
  ok(/\/Size 13 \/Root 1 0 R \/Info 3 0 R/.test(txt), 'Trailer');
  ok(/\/Count 3/.test(txt) && (txt.match(/\/Type \/Page /g) || []).length === 3 && (txt.match(/\/Subtype \/Image/g) || []).length === 3 && (txt.match(/\/Filter \/DCTDecode/g) || []).length === 3, 'drei Seiten mit je einem DCT-Bild');
  ok(/\/ColorSpace \/DeviceGray/.test(txt) && (txt.match(/\/ColorSpace \/DeviceRGB/g) || []).length === 2, 'Farbraum nach Kanälen');
  ok(/\/MediaBox \[0 0 595\.2 841\.92\]/.test(txt), 'A4 bei 150 dpi: ' + /MediaBox \[[^\]]*\]/.exec(txt)[0]);
  ok(txt.includes('/Title <FEFF') && txt.includes('00FC') && txt.includes('00DF') && txt.includes('/CreationDate (D:20261120143005Z)'), 'Titel als UTF-16 (Umlaute), Erstellungsdatum');
  // jeder Strom hat die richtige Länge
  for (const mm of txt.matchAll(/\/Length (\d+) >>\nstream\n/g)) { const s = mm.index + mm[0].length; ok(txt.slice(s + +mm[1], s + +mm[1] + 10) === '\nendstream', 'Stromlänge ' + mm[1]); }
  ok(pdf.length === 0 || (pdf.length > 3 * 40 && pdf.length < 5000), 'Größe: ' + pdf.length + ' Bytes');
  A.throws(() => P.build([], {}), /mindestens eine Seite/); n++;
  const wr = P.writer({}); wr.addPage(J); wr.finish(); A.throws(() => wr.addPage(J), /fertig/); A.throws(() => wr.finish(), /fertig/); n += 2;
  // Seite für Seite: Zähler und Größe wachsen
  { const w2 = P.writer({}); const s0 = w2.size; w2.addPage(J); ok(w2.pages === 1 && w2.size > s0, 'writer zählt Seiten und Bytes'); }
  // optional mit echtem Werkzeug (poppler), wenn vorhanden – die Browser-Prüfung nimmt pypdf
  try {
    const cp = require('child_process'), fs = require('fs'), tmp = require('os').tmpdir() + '/mt-pdf-test-' + process.pid + '.pdf';
    const jp = Buffer.from(require('child_process').execSync('python3 -c "import io,sys; from PIL import Image; b=io.BytesIO(); Image.new(\'RGB\',(1240,1754),(250,250,244)).save(b,\'JPEG\',quality=80); sys.stdout.buffer.write(b.getvalue())"', { maxBuffer: 1 << 26 }));
    fs.writeFileSync(tmp, P.build([new Uint8Array(jp), new Uint8Array(jp)], { title: 'Test' }));
    const info = cp.execSync('pdfinfo ' + tmp, { encoding: 'utf8' });
    ok(/Pages:\s+2/.test(info) && /Page size:\s+595\.2 x 841\.92 pts \(A4\)/.test(info) && /PDF version:\s+1\.4/.test(info), 'pdfinfo liest das PDF: ' + info.split('\n').filter(l => /Pages|Page size|PDF version/.test(l)).join(' | '));
    fs.unlinkSync(tmp);
  } catch (e) { console.log('(pdfinfo/Pillow nicht vorhanden – Prüfung mit echtem Werkzeug übersprungen: ' + String(e.message).split('\n')[0] + ')'); }

  // Tourenliste: Seitenaufteilung
  const T0 = new Date(2026, 0, 3, 9).getTime(), tl = Array.from({ length: 100 }, (_, i) => ({ id: 't' + i, start: T0 + i * 3.4 * 86400000 }));
  const plan = P.zeilenPlan(tl, 78, 70, 1400), alle = plan.flat();
  ok(alle.filter(z => z.art === 'tour').length === 100 && new Set(alle.filter(z => z.art === 'tour').map(z => z.tour.id)).size === 100, 'jede Tour genau einmal');
  ok(plan.every(s => s.length && s.reduce((a, z) => a + (z.art === 'monat' ? 70 : 78), 0) <= 1400), 'keine Seite läuft über');
  ok(plan.every(s => s[0].art === 'monat') && plan.every(s => s[s.length - 1].art === 'tour'), 'jede Seite beginnt mit einer Monatsüberschrift, keine endet mit einer');
  ok(plan.slice(1).every(s => !s[0].fort || plan[plan.indexOf(s) - 1].flat().length > 0), 'Fortsetzung markiert');
  ok(plan.length >= 5 && plan.length <= 8, '100 Touren ohne Fotos: ' + plan.length + ' Seiten');
  const plan2 = P.zeilenPlan(tl, 150, 70, 1400); ok(plan2.length > plan.length, 'mit Fotos mehr Seiten: ' + plan2.length);
  const kette = alle.filter(z => z.art === 'tour').map(z => z.tour.start); ok(kette.every((v, i) => !i || v >= kette[i - 1]), 'nach Datum geordnet');
  ok(P.zeilenPlan([], 78, 70, 1400).length === 0 && P.zeilenPlan([tl[0]], 78, 70, 1400).length === 1, 'leer und eine Tour');
  { const mon = P.zeilenPlan([{ id: 'a', start: new Date(2026, 4, 2).getTime() }, { id: 'b', start: new Date(2026, 5, 2).getTime() }], 78, 70, 78 + 70 + 78 + 40);   // Platz: Überschrift + 1 Tour + ein bisschen
    ok(mon.length === 2 && mon[1][0].text === 'Juni 2026', 'Überschrift nie allein am Seitenende: Juni rückt auf die nächste Seite'); }
  // Fotoraster
  for (const k of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 12]) {
    const r = P.fotoRaster(k, 1060, 20); ok(r.length === Math.min(k, 9), 'Raster ' + k + ' → ' + r.length);
    ok(r.every(c => c.x >= -1e-9 && c.x + c.w <= 1060 + 1e-6 && c.w > 100 && c.h > 100), 'Zellen liegen in der Breite');
    for (let i = 0; i < r.length; i++) for (let j = i + 1; j < r.length; j++) ok(r[i].x + r[i].w <= r[j].x + 1e-6 || r[j].x + r[j].w <= r[i].x + 1e-6 || r[i].y + r[i].h <= r[j].y + 1e-6 || r[j].y + r[j].h <= r[i].y + 1e-6, 'Zellen überlappen nicht');
  }
  ok(P.fotoRaster(9, 1060, 20, 700).every(c => c.y + c.h <= 700 + 1e-6), 'Raster passt in die Höhe');
  const zu = P.zuschnitt(4000, 3000, 300, 300); ok(Math.abs(zu.sw - 3000) < 1e-9 && zu.sh === 3000 && zu.sx === 500 && zu.sy === 0, 'Zuschnitt quer → quadratisch');
  const zh = P.zuschnitt(3000, 4000, 300, 300); ok(zh.sw === 3000 && zh.sh === 3000 && zh.sx === 0 && zh.sy === 500, 'Zuschnitt hoch → quadratisch');
  // Skizze und Profil
  const rt = Array.from({ length: 500 }, (_, i) => ({ lat: 47 + i * 0.0003, lon: 11 + 0.004 * Math.sin(i / 25), ele: 800 + 200 * Math.sin(i / 160) + (i % 7) * 0.4 }));
  const sk = P.skizze(rt, 1000, 500, 30);
  ok(sk.punkte.length >= 2 && sk.punkte.every(p => p[0] >= 30 - 1e-6 && p[0] <= 970 + 1e-6 && p[1] >= 30 - 1e-6 && p[1] <= 470 + 1e-6), 'Skizze liegt im Rand');
  { const xs = sk.punkte.map(p => p[0]), ys = sk.punkte.map(p => p[1]); ok(Math.max(...ys) - Math.min(...ys) > 400 && Math.min(...ys) < 31, 'Skizze füllt die Höhe (schmale lange Strecke)'); void xs; }
  { // seitentreu: ein Quadrat auf dem Boden (gleiche Meter) bleibt quadratisch, auch bei 47° Breite
    const k = Math.cos(47 * Math.PI / 180), q = [{ lat: 47, lon: 11 }, { lat: 47, lon: 11 + 0.01 / k }, { lat: 47.01, lon: 11 + 0.01 / k }, { lat: 47.01, lon: 11 }], s = P.skizze(q, 600, 600, 0);
    const bw = Math.max(...s.punkte.map(p => p[0])) - Math.min(...s.punkte.map(p => p[0])), bh = Math.max(...s.punkte.map(p => p[1])) - Math.min(...s.punkte.map(p => p[1])); ok(Math.abs(bw / bh - 1) < 0.01, 'Skizze seitentreu: ' + (bw / bh).toFixed(3)); }
  ok(sk.start[1] > sk.ziel[1] && P.skizze([], 100, 100).punkte.length === 0 && P.skizze([rt[0]], 100, 100).punkte.length === 0, 'Start unten, Ziel oben; ohne Punkte leer');
  ok(P.skizze(Array.from({ length: 5000 }, (_, i) => ({ lat: 47 + i * 1e-5, lon: 11 })), 100, 100).punkte.length <= 800, 'höchstens 800 Punkte');
  const pr = P.profil(rt, 1000, 200);
  ok(pr && pr.punkte.length >= 2 && pr.punkte.length <= 300 && pr.punkte[0][0] === 0 && Math.abs(pr.punkte[pr.punkte.length - 1][0] - 1000) < 1e-6 && pr.punkte.every(p => p[1] >= -1e-6 && p[1] <= 200 + 1e-6), 'Profil in der Fläche');
  ok(pr.min < 700 || pr.min > 600, 'Profil min/max'); ok(pr.max > 900 && pr.dist > 100, 'Profil max/Strecke: ' + pr.max.toFixed(0) + ' m, ' + pr.dist.toFixed(0) + ' m');
  ok(P.profil(rt.map(p => ({ lat: p.lat, lon: p.lon, ele: null })), 100, 100) === null && P.profil(rt.slice(0, 1), 100, 100) === null, 'ohne Höhen kein Profil');
  { const flach = P.profil(rt.map(p => ({ lat: p.lat, lon: p.lon, ele: 500 })), 100, 100); ok(flach.punkte.every(p => Math.abs(p[1] - 50) < 1e-6), 'flache Strecke liegt in der Mitte'); }
  // Text
  const mess = s => s.length * 10;
  { const u = P.umbruch('Früh los, oben Gämsen gesehen. Sehr schöne Tour mit viel Sonne.', 200, mess); ok(u.lines.every(l => mess(l) <= 200) && u.lines.join(' ') === 'Früh los, oben Gämsen gesehen. Sehr schöne Tour mit viel Sonne.' && !u.cut, 'Umbruch: ' + JSON.stringify(u.lines)); }
  { const u = P.umbruch('Eins\n\nZwei Drei', 1000, mess); A.deepStrictEqual(u.lines, ['Eins', '', 'Zwei Drei']); n++; }
  { const u = P.umbruch('Donaudampfschifffahrtsgesellschaftskapitän', 100, mess); ok(u.lines.length >= 4 && u.lines.every(l => mess(l) <= 100) && u.lines.join('') === 'Donaudampfschifffahrtsgesellschaftskapitän', 'lange Wörter werden getrennt'); }
  { const u = P.umbruch('a '.repeat(200), 100, mess, 3); ok(u.lines.length === 3 && u.cut && u.lines[2].endsWith('…') && mess(u.lines[2]) <= 100, 'maxLines mit Auslassungszeichen'); }
  ok(P.umbruch('', 100, mess).lines.length === 0 && P.umbruch(null, 100, mess).lines.length === 0, 'leerer Text');
  ok(P.kuerzen('Kurz', 100, mess) === 'Kurz' && P.kuerzen('Ein sehr langer Tourenname', 100, mess).endsWith('…') && mess(P.kuerzen('Ein sehr langer Tourenname', 100, mess)) <= 100, 'kürzen');
  ok(P.dateiname('Hüttenrunde am Wank (März) ß!', 'Tour') === 'Tour_Huettenrunde_am_Wank_Maerz_ss.pdf' && P.dateiname('', 'Jahr', 'pdf') === 'Jahr.pdf' && /^[A-Za-z0-9._-]+$/.test(P.dateiname('Ça va? 日本', 'X')), 'Dateiname');
  ok(P.datum(new Date(2026, 10, 20)) === '20.11.2026', 'Datum');
})();


/* ---------- 2.6.0 Karte im Tour-PDF (calc-karte.js) und Zusatzbild/Text im PDF-Schreiber (calc-pdf.js) ---------- */
(() => {
  const K = require(W + 'calc-karte.js'), P = require(W + 'calc-pdf.js');
  // Projektion: bekannte Werte (Zoom 0: Welt 256 px; Greenwich/Äquator in der Mitte), Kachel von Garmisch bei z = 12 wie MapKit.tileXY, Hin und zurück
  { const [x, y] = K.welt(0, 0, 0); close(x, 128, 'Mitte x'); close(y, 128, 'Mitte y'); }
  { const [x, y] = K.welt(85.0511287798, -180, 3); close(x, 0, 'Ecke x'); ok(Math.abs(y) < 1e-6, 'Ecke oben'); ok(K.welt(89.9, 0, 0)[1] === K.welt(85.06, 0, 0)[1], 'Breite über 85,05° wird begrenzt'); }
  { const lat = 47.49, lon = 11.1, z = 12, n = 2 ** z, tx = Math.floor((lon + 180) / 360 * n), ty = Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * n);
    const [x, y] = K.welt(lat, lon, z); ok(Math.floor(x / 256) === tx && Math.floor(y / 256) === ty && tx === 2174 && ty === 1432, 'Kachel wie MapKit.tileXY: ' + Math.floor(x / 256) + '/' + Math.floor(y / 256)); }
  for (const [la, lo, z] of [[47.6, 11.2, 14], [-33.9, 151.2, 9], [64.1, -21.9, 5]]) { const [x, y] = K.welt(la, lo, z), [b, l] = K.geo(x, y, z); ok(Math.abs(b - la) < 1e-9 && Math.abs(l - lo) < 1e-9, 'hin und zurück ' + la + ',' + lo); }
  // Maßstab und Kachelgrenze: ein Feld braucht im schlimmsten Fall höchstens 12 Kacheln, nie mehr als 16
  for (const [w, h] of [[1060, 560], [1060, 820], [1060, 240], [500, 500], [2000, 1400]]) {
    const k = K.massstab(w, h); ok(k >= 1.5 && K.hoechstens(w, h, k) <= 12, 'Maßstab ' + w + '×' + h + ': ' + k + ' → höchstens ' + K.hoechstens(w, h, k) + ' Kacheln');
  }
  ok(K.massstab(1060, 560) === 1.5, 'Standardfeld: Maßstab 1,5 (12 Kacheln)');
  // Strecke wie im Web-Test: Runde am Wank (etwa 3 × 2,5 km)
  const rund = Array.from({ length: 420 }, (_, i) => { const a = i / 419 * Math.PI * 2; return { lat: 47.60 + 0.011 * Math.sin(a) + 0.004 * Math.sin(3 * a), lon: 11.20 + 0.019 * Math.cos(a) * (1 + 0.25 * Math.sin(2 * a)) }; });
  const inFeld = (pl, w, h, pad) => pl.punkte.every(p => p[0] >= pad - 1e-6 && p[0] <= w - pad + 1e-6 && p[1] >= pad - 1e-6 && p[1] <= h - pad + 1e-6);
  const deckt = (pl, w, h) => {      // die Kacheln decken das ganze Feld lückenlos ab
    for (const [x, y] of [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1], [w / 2, h / 2], [w / 3, h * 0.7]]) if (!pl.kacheln.some(t => x >= t.dx - 1e-6 && x < t.dx + t.s && y >= t.dy - 1e-6 && y < t.dy + t.s)) return false;
    return true;
  };
  { const pl = K.plan(rund, 1060, 560);
    ok(pl && pl.z >= 12 && pl.z <= 15, 'Runde: Zoom ' + (pl && pl.z)); ok(pl.kacheln.length >= 2 && pl.kacheln.length <= 12, 'Runde: ' + pl.kacheln.length + ' Kacheln');
    ok(inFeld(pl, 1060, 560, 56) && deckt(pl, 1060, 560), 'Runde liegt mit Rand im Feld, Kacheln decken das Feld');
    // größtmöglicher Zoom: eine Stufe mehr passt nicht mehr
    const xs = pl.punkte.map(p => p[0]), ys = pl.punkte.map(p => p[1]); ok((Math.max(...xs) - Math.min(...xs)) * 2 > 1060 - 112 || (Math.max(...ys) - Math.min(...ys)) * 2 > 560 - 112, 'Zoom ist der größte, der passt');
    ok(new Set(pl.kacheln.map(t => t.z + '/' + t.x + '/' + t.y)).size === pl.kacheln.length && pl.kacheln.every(t => t.z === pl.z), 'Kacheln verschieden, gleiche Zoomstufe');
    ok(pl.punkte.length < 420 && pl.punkte.length > 30, 'Linie vereinfacht: ' + pl.punkte.length + ' von 420 Punkten');
    ok(pl.start === pl.punkte[0] && pl.ziel === pl.punkte[pl.punkte.length - 1] && pl.quelle === '© OpenStreetMap-Mitwirkende', 'Start, Ziel, Quellenangabe');
    ok(K.url(pl.kacheln[0]) === 'https://tile.openstreetmap.org/' + pl.z + '/' + pl.kacheln[0].x + '/' + pl.kacheln[0].y + '.png', 'Kacheladresse'); }
  { const pl = K.plan(rund, 1060, 820); ok(pl.kacheln.length <= 12 && inFeld(pl, 1060, 820, 56) && deckt(pl, 1060, 820), 'hohes Feld: ' + pl.kacheln.length + ' Kacheln'); }
  // kurze Tour (50 m) und Strecke mit nur einem Ort: höchster Zoom 17, trotzdem Karte
  { const kurz = [{ lat: 47.5, lon: 11.1 }, { lat: 47.5003, lon: 11.1004 }], pl = K.plan(kurz, 1060, 560); ok(pl && pl.z === 17 && pl.kacheln.length <= 12 && inFeld(pl, 1060, 560, 56), 'kurze Tour: Zoom 17'); }
  { const pl = K.plan([{ lat: 47.5, lon: 11.1 }, { lat: 47.5, lon: 11.1 }], 1060, 560); ok(pl && pl.z === 17 && Math.abs(pl.start[0] - 530) < 1e-6 && Math.abs(pl.start[1] - 280) < 1e-6, 'zwei gleiche Punkte: Mitte'); }
  // sehr lange Tour (Fernradweg München–Venedig, etwa 560 km) und eine quer durch Europa: kleiner Zoom, Kachelgrenze hält
  { const lang = Array.from({ length: 20000 }, (_, i) => ({ lat: 48.14 - i / 19999 * 2.7 + 0.2 * Math.sin(i / 900), lon: 11.58 + i / 19999 * 0.76 }));
    const pl = K.plan(lang, 1060, 560); ok(pl && pl.z >= 6 && pl.z <= 9 && pl.kacheln.length <= 12 && inFeld(pl, 1060, 560, 56) && deckt(pl, 1060, 560), 'lange Tour: Zoom ' + pl.z + ', ' + pl.kacheln.length + ' Kacheln');
    ok(pl.punkte.length < 2500, 'lange Tour vereinfacht: ' + pl.punkte.length + ' Punkte'); }
  { const eu = [{ lat: 38.7, lon: -9.1 }, { lat: 59.3, lon: 18.1 }], pl = K.plan(eu, 1060, 560); ok(pl && pl.z <= 5 && pl.kacheln.length <= 12 && pl.kacheln.every(t => t.y >= 0 && t.y < 2 ** t.z && t.x >= 0 && t.x < 2 ** t.z), 'Lissabon–Stockholm: Zoom ' + pl.z); }
  for (const w of [300, 700, 1060]) for (const h of [240, 400, 560, 820]) { const pl = K.plan(rund, w, h); ok(pl.kacheln.length <= 12 && pl.kacheln.length <= K.GRENZE && deckt(pl, w, h), 'Feld ' + w + '×' + h + ': ' + pl.kacheln.length + ' Kacheln'); }
  // ohne GPS: keine Karte
  ok(K.plan([], 1060, 560) === null && K.plan(null, 1060, 560) === null && K.plan([{ lat: 47, lon: 11 }], 1060, 560) === null, 'leer oder ein Punkt: keine Karte');
  ok(K.plan([{ lat: null, lon: null, ele: 500 }, { lat: undefined, lon: 11 }, { lat: NaN, lon: 1 }], 1060, 560) === null, 'Punkte ohne Position: keine Karte');
  ok(K.plan(rund, 0, 560) === null, 'Feld ohne Fläche: keine Karte');
  // Vereinfachung: gerade Linie → zwei Punkte; Lücken (neues Stück) bleiben erhalten; Abweichungen über der Toleranz bleiben
  { const g = Array.from({ length: 100 }, (_, i) => [i, 2 * i, false]); A.deepStrictEqual(K.vereinfachen(g, 0.5).map(p => [p[0], p[1]]), [[0, 0], [99, 198]]); n++; }
  { const g = Array.from({ length: 100 }, (_, i) => [i, 0, i === 50]), v = K.vereinfachen(g, 0.5); ok(v.length === 4 && v[2][2] === true && v[2][0] === 50 && !v[1][2], 'Lücke bleibt: ' + JSON.stringify(v)); }
  { const zack = [[0, 0, false], [5, 3, false], [10, 0, false]]; ok(K.vereinfachen(zack, 0.5).length === 3 && K.vereinfachen(zack, 4).length === 2, 'Toleranz'); }
  // Schreiber: Seite mit Karte (zweites Bild, runde Ecken) und echtem Text (Helvetica, WinAnsi) – Querverweise stimmen weiter
  const jpg = (w, h) => { const sof = [0xFF, 0xC0, 0x00, 17, 8, h >> 8, h & 255, w >> 8, w & 255, 3, 1, 0x11, 0, 2, 0x11, 0, 3, 0x11, 0]; return Uint8Array.from([0xFF, 0xD8, ...sof, ...new Uint8Array(30).fill(9), 0xFF, 0xD9]); };
  const wr = P.writer({ created: new Date(Date.UTC(2026, 10, 21)) });
  wr.addPage(jpg(1240, 1754), { bilder: [{ jpeg: jpg(1060, 560), x: 90, y: 700, w: 1060, h: 560, r: 8 }], texte: [{ s: '© OpenStreetMap-Mitwirkende', x: 800, y: 1240, size: 20, rgb: [0, 0, 0] }] });
  wr.addPage(jpg(1240, 1754));
  const txt = Buffer.from(wr.finish()).toString('latin1');
  ok((txt.match(/\/Subtype \/Image/g) || []).length === 3 && (txt.match(/\/Type \/Page /g) || []).length === 2, 'zwei Seiten, drei Bilder');
  ok(/\/XObject << \/Im0 6 0 R \/Im1 7 0 R >> \/Font << \/F1 8 0 R >> \/ProcSet \[\/PDF \/Text \/ImageC\]/.test(txt), 'Ressourcen der Kartenseite');
  ok(/\/BaseFont \/Helvetica \/Encoding \/WinAnsiEncoding/.test(txt) && txt.includes('<A9204F70656E5374726565744D61702D4D69747769726B656E6465> Tj'), 'Quellenangabe als echter Text (© in WinAnsi)');
  ok(/ W n 508\.8 0 0 268\.8 43\.2 /.test(txt) && / c h W n /.test(txt), 'Karte an ihrer Stelle, mit runden Ecken beschnitten');
  { const sx = +/startxref\n(\d+)\n%%EOF\n$/.exec(txt)[1], m = /xref\n0 (\d+)\n((?:\d{10} \d{5} [nf] \n)+)trailer/.exec(txt.slice(sx)), cnt = +m[1], e = m[2].match(/[\s\S]{20}/g);
    ok(cnt === 12, 'Objekte: ' + cnt); for (let i = 1; i < cnt; i++) ok(txt.slice(+e[i].slice(0, 10)).startsWith(i + ' 0 obj\n'), 'xref ' + i);
    for (const mm of txt.matchAll(/\/Length (\d+) >>\nstream\n/g)) { const s = mm.index + mm[0].length; ok(txt.slice(s + +mm[1], s + +mm[1] + 10) === '\nendstream', 'Stromlänge'); } }
  ok(Math.abs(P.textBreite('© OpenStreetMap-Mitwirkende', 20) - 274.82) < 0.01 && P.winAnsi('Ä–€') === '<C4963F>', 'Textbreite und WinAnsi');
})();

/* ---------- 2.8.0 Panorama (calc-pano.js): Erkennung am Seitenverhältnis, Verfall des Kamera-Starts nach 12 h, Rückfall ohne Aufnahmezeit ---------- */
{
  const P = require(W + 'calc-pano.js'), H = 3600000, now = Date.UTC(2026, 10, 21, 12, 0);
  // Erkennung: deutlich breiter als 2,2 : 1 ja, übliche Formate (4:3, 3:2, 16:9, 2:1) und Hochformat nein; Videos und fehlende Größe nie
  for (const [w, hh] of [[12000, 3000], [6000, 1200], [4096, 1024], [9000, 2000]]) ok(P.ist(w, hh), 'Panorama ' + w + '×' + hh);
  for (const [w, hh] of [[4000, 3000], [3000, 2000], [1920, 1080], [2000, 1000], [3000, 12000], [0, 0], [null, 10], [10, undefined]]) ok(!P.ist(w, hh), 'kein Panorama ' + w + '×' + hh);
  ok(P.ist({ w: 6000, h: 1200 }) && !P.ist({ w: 6000, h: 1200, video: true }) && !P.ist({}), 'als Objekt, Video nie');
  ok(P.GRENZE === 2.2, 'Grenze 2,2');
  // Verfall: 1 h und 11 h offen, 13 h und 2 Tage verfallen; kein Start, kaputter Start und Start weit in der Zukunft nicht offen
  ok(P.offen({ ts: now - H }, now) && P.offen({ ts: now - 11 * H }, now) && P.offen({ ts: now - 60000 }, now), 'innerhalb von 12 h offen');
  ok(!P.offen({ ts: now - 13 * H }, now) && !P.offen({ ts: now - 48 * H }, now), 'nach 12 h verfallen');
  ok(P.verfallen({ ts: now - 13 * H }, now) && !P.verfallen({ ts: now - H }, now) && !P.verfallen({}, now) && !P.verfallen(null, now), 'verfallen nur bei vorhandenem, altem Start');
  ok(!P.offen(null, now) && !P.offen({}, now) && !P.offen({ ts: 0 }, now) && !P.offen({ ts: 'x' }, now), 'ohne Start nichts offen');
  ok(!P.offen({ ts: now + 2 * H }, now) && P.offen({ ts: now + 60000 }, now), 'Zukunft: nur kleine Uhrabweichung zählt');
  ok(P.offen({ ts: Date.now() - H }), 'ohne now: jetzt');
  // Rückfall: ohne Aufnahmezeit (exif false) Zeit und Ort des Kamera-Starts; mit Zeit oder alter Hülle (exif fehlt) unverändert; GPS im Bild bleibt
  const pend = { ts: now - 2 * H, lat: 47.5, lon: 11.2 };
  const r = P.rueckfall([{ id: 'a', ts: 5, exif: false }, { id: 'b', ts: 7, exif: true }, { id: 'c', ts: 9 }, { id: 'd', ts: 0, exif: false, lat: 46, lon: 10 }], pend);
  ok(r[0].ts === pend.ts && r[0].lat === 47.5 && r[0].lon === 11.2 && r[0].pos === 'start', 'ohne Zeit: Start als Rückfall ' + JSON.stringify(r[0]));
  ok(r[1].ts === 7 && r[1].lat == null && r[2].ts === 9 && r[2].lat == null, 'mit Zeit bzw. ohne Angabe unverändert');
  ok(r[3].ts === pend.ts && r[3].lat === 46 && !r[3].pos, 'Position aus dem Bild bleibt');
  const r2 = P.rueckfall([{ id: 'e', ts: 3, exif: false }], { ts: now });
  ok(r2[0].ts === now && r2[0].lat == null, 'Start ohne Position: nur die Zeit');
  ok(P.rueckfall([{ id: 'f', ts: 3, exif: false }], {})[0].ts === 3 && P.rueckfall(null, pend).length === 0, 'ohne Start nichts ändern');
}

/* ---------- 2.9.0 Videos (calc-video.js): Dauer „m:ss“, Aufnahmelänge → Sekunden, Speicherangabe ---------- */
{
  const V = require(W + 'calc-video.js');
  for (const [ms, s] of [[7000, '0:07'], [125000, '2:05'], [760000, '12:40'], [3723000, '1:02:03'], [59600, '1:00'], [400, '0:01'], [1499, '0:01'], [1500, '0:02']]) ok(V.dauer(ms) === s, 'Dauer ' + ms + ' → ' + V.dauer(ms));
  ok(V.dauer(0) === '' && V.dauer(null) === '' && V.dauer(undefined) === '' && V.dauer(-5) === '' && V.dauer('x') === '', 'unbekannte Dauer: leer');
  ok(V.dauerText(125000) === 'Video, 2 Minuten 5 Sekunden' && V.dauerText(60000) === 'Video, 1 Minute' && V.dauerText(0) === 'Video', 'vorlesbare Dauer');
  ok(V.limitSek('30') === 30 && V.limitSek('120') === 120 && V.limitSek('300') === 300 && V.limitSek('0') === 0 && V.limitSek(300) === 300, 'Aufnahmelänge');
  ok(V.limitSek(undefined) === 120 && V.limitSek('') === 120 && V.limitSek('45') === 120 && V.limitSek(null) === 120, 'unbekannt: 2 Minuten');
  ok(V.VORGABE === '120' && V.LIMITS.length === 4 && V.LIMITS.map(l => l[0]).join() === '30,120,300,0', 'Auswahl wie in VideoPlan.limitSeconds');
  const s1 = V.speicher({ photos: 10, photoBytes: 5e6, videos: 2, videoBytes: 7e7, bytes: 7.5e7, vids: { a1v: 3e7 } });
  ok(s1.fotos === 10 && s1.fotoBytes === 5e6 && s1.videos === 2 && s1.videoBytes === 7e7 && s1.vids.a1v === 3e7, 'Speicher getrennt');
  const s2 = V.speicher({ photos: 12, bytes: 9e6 });
  ok(s2.fotos === 12 && s2.fotoBytes === 9e6 && s2.videos === null && Object.keys(s2.vids).length === 0, 'alte Hülle: Videos unbekannt');
  ok(V.speicher(null) === null && V.speicher('x') === null, 'ohne Angabe');
}

/* ---------- 2.10.0 Sicherung (calc-sicherung.js): Tage seit, eine Erinnerungszeile für Touren und Medien, Texte, Fortschritt, „einmal am Tag“ ---------- */
{
  const S = require(W + 'calc-sicherung.js'), D = 86400000, now = day(2026, 11, 22, 10);
  ok(S.tageSeit(null, now) === null && S.tageSeit(0, now) === null && S.tageSeit(now - 3.9 * D, now) === 3 && S.tageSeit(now + 5000, now) === 0, 'Tage seit');
  ok(S.groesse(0) === '0,0 MB' && S.groesse(419430) === '0,4 MB' && S.groesse(12.4 * 1048576) === '12 MB' && S.groesse(1.6 * 1073741824) === '1,6 GB', 'Größe ' + S.groesse(419430));
  ok(S.neuZeile(5, 12 * 1048576, now - D) === '5 neue Dateien seit der letzten Medien-Sicherung (12 MB)', S.neuZeile(5, 12 * 1048576, now - D));
  ok(S.neuZeile(1, 1048576, now - D) === '1 neue Datei seit der letzten Medien-Sicherung (1,0 MB)' && S.neuZeile(0, 0, now - D) === 'Keine neuen Dateien seit der letzten Medien-Sicherung', 'Einzahl / nichts neu');
  ok(S.neuZeile(3, 3 * 1048576, null) === '3 Dateien noch nicht gesichert (3,0 MB)' && S.neuZeile(0, 0, null) === 'Keine Fotos oder Videos vorhanden', 'nie gesichert');
  const E = o => S.erinnerung(Object.assign({ touren: 5, letzteTouren: now, medienNeu: 0, medienBytes: 0, letzteMedien: null, jetzt: now, tage: 14, spaeter: 0 }, o));
  ok(!E({}).zeigen, 'alles frisch, keine neuen Medien: nichts');
  // nur Touren (wie bis 2.9.1, gleiche Texte)
  ok(E({ letzteTouren: null }).text === 'Noch keine Sicherung gemacht' && E({ letzteTouren: null }).art === 'touren', 'Touren nie gesichert');
  ok(E({ letzteTouren: now - 23 * D }).text === 'Letzte Sicherung vor 23 Tagen' && !E({ letzteTouren: now - 14 * D }).zeigen && E({ letzteTouren: now - 14 * D - 60000 }).zeigen, 'Touren: Schwelle 14');
  ok(!E({ touren: 0, letzteTouren: null }).zeigen, 'ohne Touren keine Touren-Zeile');
  ok(E({ letzteTouren: now - 1.5 * D, tage: 1 }).text === 'Letzte Sicherung vor 1 Tag', 'Einzahl Tag');
  // Gleiche Ergebnisse wie die alte Regel (calc-ziele.js) für alle Touren-Fälle
  for (const [nT, last, tg, sn] of [[5, null, 14, 0], [0, null, 14, 0], [5, now - 14 * D, 14, 0], [5, now - 23 * D, 14, 0], [5, now - 8 * D, 7, 0], [5, now - 99 * D, 0, 0], [5, now - 30 * D, 14, now + 1000], [5, now - 30 * D, '14', 0], [5, now - 30 * D, '', 0]]) {
    const a = Z.sicherungHinweis(nT, last, now, tg, sn), b = S.erinnerung({ touren: nT, letzteTouren: last, jetzt: now, tage: tg, spaeter: sn });
    ok(a.zeigen === b.zeigen && (!a.zeigen || a.text === b.text), 'wie bisher: ' + JSON.stringify([nT, last && (now - last) / D, tg, !!sn]));
  }
  // nur Medien
  const m1 = E({ medienNeu: 5, medienBytes: 12 * 1048576 });
  ok(m1.zeigen && m1.art === 'medien' && m1.text === 'Fotos und Videos noch nie gesichert' && m1.sub.startsWith('5 Dateien noch nicht gesichert (12 MB)'), 'Medien nie gesichert: ' + JSON.stringify(m1));
  const m2 = E({ medienNeu: 2, medienBytes: 2097152, letzteMedien: now - 20 * D });
  ok(m2.art === 'medien' && m2.text === 'Fotos und Videos: letzte Sicherung vor 20 Tagen' && m2.sub.startsWith('2 neue Dateien seit der letzten Medien-Sicherung (2,0 MB)'), 'Medien 20 Tage: ' + m2.text);
  ok(!E({ medienNeu: 0, letzteMedien: now - 99 * D }).zeigen, 'alte Medien-Sicherung, aber nichts Neues: nichts');
  ok(!E({ medienNeu: 3, letzteMedien: now - 10 * D }).zeigen, 'Medien unter der Schwelle');
  // beide fällig: die ältere; Gleichstand und „nie“ beider: Touren
  ok(E({ letzteTouren: now - 30 * D, medienNeu: 1, letzteMedien: now - 20 * D }).art === 'touren', 'Touren älter');
  ok(E({ letzteTouren: now - 20 * D, medienNeu: 1, letzteMedien: now - 30 * D }).art === 'medien', 'Medien älter');
  ok(E({ letzteTouren: now - 20 * D, medienNeu: 1, letzteMedien: null }).art === 'medien', 'Medien nie: älter als jede Touren-Sicherung');
  ok(E({ letzteTouren: null, medienNeu: 1, letzteMedien: null }).art === 'touren' && E({ letzteTouren: now - 20 * D, medienNeu: 1, letzteMedien: now - 20 * D }).art === 'touren', 'Gleichstand: Touren');
  // Aus und „Später“ gelten für beide
  ok(!E({ tage: 0, letzteTouren: null, medienNeu: 9 }).zeigen && !E({ tage: '', medienNeu: 9 }).zeigen, 'Erinnerung aus');
  ok(!E({ spaeter: now + 1, medienNeu: 9 }).zeigen && E({ spaeter: now - 1, medienNeu: 9 }).zeigen, '„Später“ für beide');
  ok(E({ tage: '7', medienNeu: 1, letzteMedien: now - 8 * D }).zeigen && !E({ tage: 30, medienNeu: 1, letzteMedien: now - 8 * D }).zeigen, 'Schwelle 7 / 30');
  // einmal am Tag automatisch
  ok(S.tagKey(day(2026, 1, 5, 0)) === '2026-01-05' && S.tagKey(day(2026, 12, 31, 23)) === '2026-12-31', 'örtliches Datum');
  ok(S.autoName(now) === 'Tourentagebuch-Auto-2026-11-22.mtl', 'Name ' + S.autoName(now));
  ok(S.autoFaellig(true, true, '', now) && S.autoFaellig(true, true, '2026-11-21', now) && !S.autoFaellig(true, true, '2026-11-22', now), 'einmal am Tag');
  ok(!S.autoFaellig(false, true, '', now) && !S.autoFaellig(true, false, '', now) && !S.autoFaellig(true, '', '', now), 'aus / ohne Ordner nie');
  ok(S.autoFaellig(true, true, '2026-11-22', day(2026, 11, 23, 0) + 60000), 'nach Mitternacht wieder');
  // Fortschritt und Ergebnis
  const MB = 1048576;
  const f1 = S.fortschritt({ kind: 'backup', running: true, done: 300 * MB, total: 1200 * MB, part: 1, parts: 2 });
  ok(Math.abs(f1.anteil - 0.25) < 1e-9 && f1.text === 'Teil 1 von 2 · 150 MB von 600 MB · 25 %', f1.text);
  ok(S.fortschritt({ kind: 'backup', done: 0, total: 0, parts: 1 }).text === '0,0 MB von 0,0 MB · 0 %' && S.fortschritt(null).anteil === 0, 'Anfang');
  ok(S.fortschritt({ kind: 'restore', done: 50, total: 200, file: 2, files: 3 }).text === 'Datei 2 von 3 · 25 %' && S.fortschritt({ kind: 'restore', done: 5, total: 2 }).anteil === 1, 'Wiederherstellen');
  ok(S.fortschritt({ kind: 'restore', phase: 'vorschau' }).text === 'Vorschaubilder werden geprüft …', 'Vorschaubilder');
  ok(S.ergebnis({ kind: 'backup', result: { files: 12, bytes: 40 * MB, parts: 1, folder: 'Documents/Sicherung' } }) === 'Gesichert: 12 Dateien (40 MB) in „Documents/Sicherung“', 'Ergebnis Sichern');
  ok(S.ergebnis({ kind: 'backup', result: { files: 3, bytes: 3 * MB, parts: 2 } }) === 'Gesichert: 3 Dateien (3,0 MB) in 2 Teilen', 'in Teilen');
  ok(S.ergebnis({ kind: 'backup', cancelled: true }) === 'Abgebrochen. Es wurde nichts gespeichert.' && S.ergebnis({ kind: 'backup', error: 'voll' }) === 'Sichern nicht möglich: voll', 'Abbruch / Fehler');
  ok(S.ergebnis({ kind: 'restore', result: { restored: 3, existing: 1, rejected: 2, thumbs: 1, bad: 1 } }) === '3 Dateien wiederhergestellt · 1 schon vorhanden · 2 abgelehnt (unsichere Namen) · 1 Sicherung nicht lesbar · 1 Vorschaubild neu erstellt', 'Ergebnis Wiederherstellen');
  ok(S.ergebnis({ kind: 'restore', cancelled: true, result: { restored: 2, cancelled: true } }) === 'Abgebrochen · 2 Dateien wiederhergestellt', 'Wiederherstellen abgebrochen');
  ok(S.ergebnis({ kind: 'backup', cancelled: true, result: { files: 4, parts: 1 } }) === 'Abgebrochen. Fertige Teile bleiben gültig.', 'Sichern nach einem Teil abgebrochen');
}

/* ---------- 2.8.1 Tourenkarte (calc-kartenpunkte.js): Startpunkte, Raster-Gruppen, Jahresfilter, Linien-Zoom, Ausschnitt ---------- */
{
  const K = require(W + 'calc-kartenpunkte.js');
  // Startpunkt: gespeicherte Lage, sonst erster Punkt mit Position, sonst keiner
  ok(JSON.stringify(K.startpunkt({ lat: 28.1, lon: -15.4 }, [{ lat: 1, lon: 2 }])) === '{"lat":28.1,"lon":-15.4}', 'Startpunkt aus der Tour');
  ok(JSON.stringify(K.startpunkt({ lat: null, lon: null }, [{ lat: null, lon: null }, { lat: 47.1, lon: 11.2 }])) === '{"lat":47.1,"lon":11.2}', 'Startpunkt: erster Punkt mit Position');
  ok(K.startpunkt({}, []) === null && K.startpunkt(null, null) === null && K.startpunkt({ lat: 95, lon: 0 }, [{ lat: NaN, lon: 1 }]) === null, 'ohne Position kein Startpunkt');
  const P = (lat, lon, id, start) => ({ lat, lon, id, start: start || Date.UTC(2024, 5, 1, 10) });
  // Eine Tour: in jeder Zoomstufe genau eine Gruppe mit n = 1
  for (const z of [0, 3, 9, 18]) { const g = K.gruppieren([P(47.5, 11.2, 'a')], z); ok(g.length === 1 && g[0].n === 1 && g[0].lat === 47.5 && g[0].punkte[0].id === 'a', 'eine Tour, Zoom ' + z); }
  ok(K.gruppieren([], 5).length === 0 && K.gruppieren(null, 5).length === 0 && K.gruppieren([{ lat: null, lon: 3 }], 5).length === 0, 'leer bzw. ohne Position: keine Gruppe');
  // Alle am selben Ort: auch im höchsten Zoom eine Gruppe, Rahmen ohne Ausdehnung
  const gleich = Array.from({ length: 25 }, (_, i) => P(28.05, -15.6, 's' + i));
  for (const z of [2, 12, 19]) { const g = K.gruppieren(gleich, z); ok(g.length === 1 && g[0].n === 25 && g[0].sued === g[0].nord && g[0].west === g[0].ost, 'selber Ort, Zoom ' + z); }
  ok(K.spanneKm(gleich) === 0, 'selber Ort: Spanne 0');
  // Weltweit verteilt: bei Zoom 2 mehrere Gruppen (Kontinente getrennt, Nachbarn in Europa zusammen), bei Zoom 12 jede Tour einzeln
  const welt = [P(47.5, 11.2, 'alpen1'), P(47.45, 11.3, 'alpen2'), P(47.6, 11.0, 'alpen3'), P(28.0, -15.6, 'gc1'), P(28.1, -15.5, 'gc2'), P(-33.9, 151.2, 'sydney'), P(40.7, -74.0, 'ny'), P(64.1, -21.9, 'island'), P(-13.2, -72.5, 'peru'), P(35.36, 138.7, 'fuji')];
  const g2 = K.gruppieren(welt, 2), g12 = K.gruppieren(welt, 12);
  ok(g2.reduce((s, g) => s + g.n, 0) === 10 && g12.reduce((s, g) => s + g.n, 0) === 10, 'jede Tour genau einmal gezählt');
  const alpen = g2.find(g => g.punkte.some(p => p.id === 'alpen1'));
  ok(alpen.n === 3 && g2.length >= 6 && g2.length <= 8, 'Zoom 2: Alpen als eine Gruppe, insgesamt ' + g2.length + ' Gruppen');
  ok(g2.find(g => g.punkte.some(p => p.id === 'sydney')).n === 1 && g2.find(g => g.punkte.some(p => p.id === 'gc1')).n === 2, 'Zoom 2: Sydney allein, Gran Canaria zu zweit');
  ok(g12.length === 10, 'Zoom 12: alle einzeln (' + g12.length + ')');
  ok(alpen.sued === 47.45 && alpen.nord === 47.6 && alpen.west === 11.0 && alpen.ost === 11.3 && Math.abs(alpen.lat - 47.516667) < 1e-5, 'Rahmen und Mitte der Gruppe');
  ok(K.gruppieren(welt, 2).map(g => g.punkte[0].id).join() === g2.map(g => g.punkte[0].id).join() && g2[0].punkte[0].id === 'alpen1', 'Reihenfolge stabil');
  // Mehr Zoom → nie weniger Gruppen; größere Zellen → nie mehr Gruppen (bei 2^k-Vielfachen der Zelle exakt verschachtelt)
  let vor = 0; for (let z = 0; z <= 14; z++) { const n = K.gruppieren(welt, z).length; ok(n >= vor, 'Zoom ' + z + ': ' + n + ' Gruppen ≥ ' + vor); vor = n; }
  ok(K.gruppieren(welt, 6, 80).length <= K.gruppieren(welt, 6, 40).length && K.gruppieren(welt, 6, 0).length === K.gruppieren(welt, 6).length, 'Zellgröße');
  // Datumsgrenze und Pole: ganz links und ganz rechts getrennte Gruppen, keine Fehler bei ±90°
  ok(K.gruppieren([P(0, -179.99, 'w'), P(0, 179.99, 'o'), P(90, 0, 'n'), P(-90, 0, 's')], 3).length === 4, 'Datumsgrenze und Pole');
  // Jahresfilter: wirkt auf die Punkte, leer = alle, Zahl und Text
  const tj = [P(47, 11, 'j1', new Date(2023, 0, 1, 0, 30).getTime()), P(47, 11, 'j2', new Date(2023, 11, 31, 23, 30).getTime()), P(28, -15, 'j3', new Date(2024, 6, 1).getTime()), { id: 'ohne' }];
  ok(K.jahrFilter(tj, '2023').map(t => t.id).join() === 'j1,j2' && K.jahrFilter(tj, 2024).map(t => t.id).join() === 'j3', 'Jahresfilter (Ortszeit, Jahresgrenzen)');
  ok(K.jahrFilter(tj, '').length === 4 && K.jahrFilter(tj, null).length === 4 && K.jahrFilter(tj, '1999').length === 0 && K.jahrFilter(null, '').length === 0, 'kein Filter bzw. leeres Jahr');
  ok(K.gruppieren(K.jahrFilter(tj, '2023'), 2).length === 1 && K.gruppieren(K.jahrFilter(tj, '2023'), 2)[0].n === 2, 'Jahresfilter wirkt auf die Gruppen');
  // Spanne und Linien-Zoom: Alpen (unter 1000 km) wie bisher, weltweit erst ab Zoom 9
  ok(Math.abs(K.km({ lat: 52.52, lon: 13.405 }, { lat: 48.137, lon: 11.575 }) - 504) < 5 && K.km({ lat: 47.5, lon: 11.2 }, { lat: 28.0, lon: -15.6 }) > 3000, 'Entfernung Berlin–München ≈ 504 km, Alpen–Gran Canaria über 3000 km');
  ok(K.spanneKm(welt.slice(0, 3)) < 50 && K.spanneKm(welt) > 10000 && K.spanneKm([P(47.5, 11.2)]) === 0, 'Spanne');
  ok(K.linienAb(300, 7) === 7 && K.linienAb(300, 11) === 9 && K.linienAb(1000, 6) === 6 && K.linienAb(1001, 6) === 9 && K.linienAb(5000, 2) === 9 && K.linienAb(10, 3) === 5 && K.linienAb(10, NaN) === 9, 'Linien-Zoom');
  // Ausschnitt: Rahmen [süd, west, nord, ost] schneidet { s, w, n, e }; Zählen der Punkte darin
  const v = { s: 27.5, w: -16, n: 28.5, e: -15 };
  ok(K.imAusschnitt([27.9, -15.7, 28.0, -15.6], v) && K.imAusschnitt([28.4, -15.1, 29, -14], v) && !K.imAusschnitt([47, 11, 47.5, 11.5], v) && !K.imAusschnitt(null, v), 'Rahmen im Ausschnitt');
  ok(K.zaehlen(welt, v) === 2 && K.zaehlen(welt, { s: -90, w: -180, n: 90, e: 180 }) === 10 && K.zaehlen([], v) === 0, 'Touren im Ausschnitt zählen');
  ok(K.anzahlText(0) === 'Keine Touren' && K.anzahlText(1) === '1 Tour' && K.anzahlText(12) === '12 Touren' && K.anzahlText(1234) === '1.234 Touren', 'Anzahl als Text');
  // Schriftfarbe auf Gruppen: jede Sportfarbe mindestens 4,5 : 1, helle eigene Farben bekommen dunkle Schrift
  for (const c of ['#2e7d32', '#e65100', '#1565c0', '#6a1b9a', '#00838f', '#c62828', '#37474f', '#3949ab', '#ad1457', '#00796b', '#4e342e', '#546e7a', '#ffeb3b', '#80deea', '#d81b60', '#888888']) {
    ok(K.kontrast(c, K.textFarbe(c)) >= 4.5 || (c === '#e65100' && K.kontrast(c, K.textFarbe(c)) >= 3), 'Schrift auf ' + c + ': ' + K.kontrast(c, K.textFarbe(c)).toFixed(2));
  }
  ok(K.textFarbe('#ffeb3b') === '#0c2526' && K.textFarbe('#1565c0') === '#ffffff' && K.textFarbe('kaputt') === '#ffffff', 'Weiß oder Dunkel');
  ok(K.haeufigste(['hike', 'bike', 'bike']) === 'bike' && K.haeufigste(['run', 'hike']) === 'run' && K.haeufigste([]) === null, 'häufigste Sportart');
  ok(K.groesse(2) === 30 && K.groesse(1000) === 46 && K.groesse(8) === 38 && K.groesse(1) === 30, 'Markergröße');
  // Viele Touren: 5000 Startpunkte in jedem Zoom schnell gruppiert
  const viel = Array.from({ length: 5000 }, (_, i) => P(-60 + (i * 7919 % 12000) / 100, -180 + (i * 104729 % 36000) / 100, 'v' + i));
  const t0 = Date.now(); for (let z = 0; z <= 18; z++) K.gruppieren(viel, z); const ms = Date.now() - t0;
  ok(ms < 3000, '5000 Touren × 19 Zoomstufen in ' + ms + ' ms');
}

/* ---------- An Meine Touren senden (calc-senden.js) ---------- */
{
  const S = require(W + 'calc-senden.js');
  const acc = { base: 'https://mt.test', token: 'k', role: 'admin' }, viewer = Object.assign({}, acc, { role: 'viewer' });
  const t0 = Date.UTC(2026, 5, 1, 7, 0), tr = (x) => Object.assign({ id: 'a', status: 'done', timed: true, start: t0, dist: 10000, sport: 'hike', tags: [] }, x);
  A.strictEqual(S.sport(tr()), 'hike'); A.strictEqual(S.sport(tr({ sport: 'walk' })), 'hike'); A.strictEqual(S.sport(tr({ tags: ['Schneeschuh'] })), 'snowshoe');
  A.strictEqual(S.sport(tr({ sport: 'run' })), 'jogging'); A.strictEqual(S.sport(tr({ sport: 'bike' })), 'touringbicycle'); A.strictEqual(S.sport(tr({ sport: 'ebike' })), 'e_touringbicycle');
  A.strictEqual(S.sport(tr({ sport: 'other' })), null); A.strictEqual(S.sport(tr({ sport: 'ski' })), null); A.strictEqual(S.sport(null), null); n += 7;
  ok(S.pruefen(tr(), acc).ok, 'normal'); ok(S.pruefen(tr(), null).code === 'verbindung', 'keine Verbindung'); ok(S.pruefen(tr(), { base: 'x' }).code === 'verbindung', 'ohne Schlüssel');
  ok(S.pruefen(tr(), { base: 'x', open: true, role: 'admin' }).ok, 'Server ohne Anmeldung');
  ok(S.pruefen(tr({ status: 'planned' }), acc).code === 'geplant', 'geplant'); ok(S.pruefen(tr({ src: 'mt' }), acc).code === 'schon', 'aus MT');
  ok(S.pruefen(tr({ mtId: '5' }), acc).code === 'schon', 'mtId'); ok(S.pruefen(tr({ srcId: 'mt:7' }), acc).code === 'schon', 'srcId');
  ok(S.pruefen(tr({ timed: false }), acc).code === 'zeit', 'ohne Zeit'); ok(S.pruefen(tr(), viewer).code === 'betrachter', 'Betrachter');
  ok(/Schreibrechten/.test(S.pruefen(tr(), viewer).grund), 'Betrachter-Text'); ok(S.pruefen(null, acc).code === 'spur', 'keine Tour');
  ok(S.sichtbar(tr(), acc) && S.sichtbar(tr(), viewer), 'sichtbar auch für Betrachter'); ok(!S.sichtbar(tr(), null), 'unsichtbar ohne Verbindung');
  ok(!S.sichtbar(tr({ src: 'mt' }), acc) && !S.sichtbar(tr({ mtId: '1' }), acc) && !S.sichtbar(tr({ status: 'planned' }), acc), 'unsichtbar bei MT-Herkunft / geplant');
  const ks = S.kandidaten([tr({ id: 'x', start: t0 }), tr({ id: 'y', start: t0 + 1e8 }), tr({ id: 'z', hidden: true }), tr({ id: 'v', mtId: '3' })], viewer);
  ok(ks.map(x => x.id).join() === 'y,x', 'Kandidaten: neueste zuerst, ohne ausgeblendete und gesendete');
  const liste = [{ id: 1, start_ts: t0 / 1000 + 120, dist_m: 10500 }, { id: 2, start_ts: t0 / 1000 + 4000, dist_m: 10000 }, { id: 3, start_ts: t0 / 1000, dist_m: 30000 }];
  ok(S.passend(tr(), liste).id === 1, 'Start ± 5 min, ähnliche Länge'); ok(S.passend(tr({ start: t0 + 1e7 }), liste) === null, 'anderer Start');
  ok(S.passend(tr({ dist: 0 }), liste.slice(2)).id === 3, 'ohne eigene Länge zählt der Start'); ok(S.passend(tr(), [liste[2]]) === null, 'Länge passt nicht');
  ok(S.passend(tr(), []) === null && S.passend(tr({ start: 0 }), liste) === null, 'leer');
  ok(/Schreibrechten/.test(S.fehlerText(403, '')) && /abgelaufen/.test(S.fehlerText(401)) && /zu groß/.test(S.fehlerText(413)) && /nicht angenommen: kaputt/.test(S.fehlerText(400, 'kaputt')) && /HTTP 502/.test(S.fehlerText(502)), 'Fehlertexte');
  ok(S.WIEDER(0) && S.WIEDER(null) && S.WIEDER(503) && !S.WIEDER(403) && !S.WIEDER(400) && !S.WIEDER(401), 'WIEDER');
  let q = S.queueAdd(null, 'a'); q = S.queueAdd(q, 'a'); q = S.queueAdd(q, 'b'); ok(q.length === 2, 'Warteschlange ohne Doppelte');
  for (let i = 0; i < S.MAX_VERSUCHE - 1; i++) q = S.queueNach(q, 'a', { ok: false, wieder: true });
  ok(q.some(e => e.id === 'a' && e.n === S.MAX_VERSUCHE - 1), 'noch drin'); q = S.queueNach(q, 'a', { ok: false, wieder: true }); ok(!q.some(e => e.id === 'a'), 'nach dem letzten Versuch raus');
  q = S.queueNach(q, 'b', { ok: false, wieder: false }); ok(q.length === 0, 'dauerhafter Fehler: raus'); ok(S.queueNach(S.queueAdd([], 'c'), 'c', { ok: true }).length === 0, 'Erfolg: raus');
  ok(S.zusammen({ gesendet: 2, vorhanden: 1, fehler: [], stopped: false }) === '2 Touren gesendet · 1 war schon vorhanden', 'zusammen'); ok(/abgebrochen/.test(S.zusammen({ gesendet: 0, vorhanden: 0, fehler: [], stopped: true })), 'abgebrochen');
  ok(S.zusammen({ gesendet: 1, vorhanden: 0, fehler: [{ name: 'x', text: 'nope' }] }) === '1 Tour gesendet · 1 nicht gesendet: nope', 'zusammen mit Fehler');
}

/* ---------- 2.11.0 Offline-Karten (calc-offline.js): Kachelrechnung, Rechteck, Strecke mit Rand, Grenzen, Pfade (gleiche Zahlen wie TilePlanCheck.java) ---------- */
{
  const O = require(W + 'calc-offline.js');
  const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), (m || '') + ': ' + JSON.stringify(a) + ' ≠ ' + JSON.stringify(b));
  eq(O.kachelXY(47.5, 11.2, 15), [17403, 11458], 'z15'); eq(O.kachelXY(47.42, 10.98, 12), [2172, 1433], 'z12');
  eq(O.kachelXY(-33.86, 151.21, 10), [942, 614], 'Sydney'); eq(O.kachelXY(89, -180, 3), [0, 0], 'Nordwestecke'); eq(O.kachelXY(-89, 180, 3), [7, 7], 'Südostecke begrenzt');
  const b = { s: 47.40, w: 11.00, n: 47.50, e: 11.15 };
  eq([13, 15, 16, 18].map(z => O.zaehleRechteck(b, 10, z)), [23, 275, 1059, 1059], 'Rechteck je Detailstufe (über 16 nie)');
  ok(O.zaehleRechteck(b, 15, 12) === 0 && O.zaehleRechteck(b, 10.5, 13) === 0, 'ungültige Zoomstufen: nichts');
  const rl = O.rechteck(b, 10, 15);
  ok(rl.length === 275 && rl[0][0] === 10 && rl[rl.length - 1][0] === 15 && new Set(rl.map(String)).size === 275, 'Rechteckliste vollständig und eindeutig');
  ok(O.rechteck({ s: 46, w: 10, n: 48, e: 13 }, 10, 16) === null && O.zaehleRechteck({ s: 46, w: 10, n: 48, e: 13 }, 10, 16) > O.MAX_KACHELN, 'großes Rechteck: keine Liste');
  const pts = [[47.40, 11.00], [47.45, 11.05], [47.47, 11.12], [47.47, 11.12], [47.50, 11.20]];
  ok(O.stuetzen(pts, 2000).length === 12, 'Stützpunkte');
  eq([13, 15, 16].map(z => O.korridor(pts, 2000, 10, z).anzahl), [38, 306, 1023], 'Strecke mit 2 km Rand');
  const k15 = O.korridor(pts, 2000, 10, 15);
  eq(k15.kacheln.slice(0, 2), [[10, 543, 357], [10, 543, 358]], 'erste Kacheln wie in Java');
  eq(O.abdeckung(k15.kacheln), ['2172/1433', '2172/1434', '2173/1432', '2173/1433', '2173/1434', '2174/1432', '2174/1433', '2175/1431', '2175/1432'], 'Abdeckung z12');
  ok(O.korridor(pts, 2000, 10, 15, 100).kacheln === null && O.korridor(pts, 2000, 10, 15, 100).anzahl === 306, 'Grenze: Zahl ja, Liste nein');
  ok(O.korridor([], 2000, 10, 15).anzahl === 0 && O.korridor([[NaN, 1], [95, 11]], 2000, 10, 15).anzahl === 0, 'leere/ungültige Strecke');
  const lang = O.korridor([[46, 8], [48, 16]], 5000, 10, 16);
  ok(lang.kacheln === null && lang.anzahl > O.MAX_KACHELN, 'sehr lange Strecke abgelehnt (' + lang.anzahl + (lang.mehr ? '+' : '') + ')');
  const r = O.rahmen(pts, 2000); ok(r.s < 47.40 && r.n > 47.50 && r.w < 11 && r.e > 11.2 && r.s > 47.38, 'Rahmen mit Rand');
  // Liegt ein Ort offline vor?
  const g = [{ src: 'topo', cover: O.abdeckung(k15.kacheln) }, { src: 'topo', bbox: [46.0, 7.0, 46.1, 7.1] }];
  ok(O.abgedeckt(g, 47.45, 11.05) && O.abgedeckt(g, 46.05, 7.05) && !O.abgedeckt(g, 48.2, 11.5) && !O.abgedeckt(g, NaN, 1) && !O.abgedeckt([], 47.45, 11.05), 'abgedeckt');
  ok(!O.abgedeckt(g, 47.45, 11.05, 'osm'), 'nur die gewünschte Quelle');
  // Grenzen und Texte
  ok(O.pruefen('topo', 275, 0).ok && O.pruefen('osm', 275, 0).grund === 'quelle' && O.pruefen('x', 1, 0).grund === 'quelle', 'Quellen');
  ok(O.pruefen('topo', 2000, 0).ok && O.pruefen('topo', 2001, 0).grund === 'zuviel' && O.pruefen('topo', 0, 0).grund === 'leer', 'Grenze 2000');
  ok(O.pruefen('topo', 2000, O.MAX_GESAMT - 1000).grund === 'speicher', 'Gesamtgrenze');
  ok(O.schaetzung('topo', 1000) === 25600000 && O.schaetzung('osm', 1) === 20480, 'Schätzung wie in Java');
  eq([0, 2000, 400000, 25600000, 2e9].map(O.mb), ['0 MB', '0,1 MB', '0,4 MB', '24 MB', '1,9 GB'], 'Größen');
  ok(O.umfang('topo', 1234) === '≈ 1.234 Kacheln, ≈ 30 MB' && O.umfang('topo', 1) === '≈ 1 Kachel, ≈ 0,1 MB' && O.umfang('topo', 60000, true).startsWith('mehr als 60.000'), 'Umfang: ' + O.umfang('topo', 1234));
  eq(O.STUFEN.map(s => O.zmaxVon(s[0])), [13, 15, 16], 'Detailstufen'); ok(O.zmaxVon('quatsch') === 15, 'Vorgabe Normal (bis 15)');
  // Pfade: nur ganze Zahlen, Quelle aus der Liste, im Raster
  ok(O.pfad('topo', 15, 17403, 11458) === 'topo/15/17403/11458.png' && O.lokal('topo', 15, 17403, 11458) === '/tiles/topo/15/17403/11458.png', 'Pfad');
  ok([['topo', 3, 8, 0], ['topo', -1, 0, 0], ['topo', 1.5, 0, 0], ['../x', 1, 0, 0], ['topo', 1, '0', 0], ['constructor', 1, 0, 0], ['topo', 20, 0, 0]].every(a => O.pfad(...a) === null), 'ungültige Pfade');
  // Fortschritt und Zusammenfassung eines Laufs der Hülle
  const fp = O.fortschritt({ done: 69, total: 275 }); ok(fp.text === '69 von 275 Kacheln' && Math.abs(fp.anteil - 69 / 275) < 1e-9, 'Fortschritt');
  ok(O.fortschritt({ done: 5, total: 0 }).text === 'Wird vorbereitet …' && O.fortschritt({ done: 3000, total: 1500 }).anteil === 1, 'Fortschritt Ränder');
  ok(O.ergebnis({ name: 'Karwendel', loaded: 1270, skipped: 5, failed: 0 }) === 'Offline-Karte „Karwendel“: 1.275 Kacheln gespeichert (5 waren schon da).', O.ergebnis({ name: 'Karwendel', loaded: 1270, skipped: 5 }));
  ok(O.ergebnis({ name: 'X', loaded: 10, failed: 2 }) === 'Offline-Karte „X“: 10 Kacheln gespeichert, 2 fehlen.' && O.ergebnis({ cancelled: true }).startsWith('Abgebrochen.') && O.ergebnis({ error: 'Kein WLAN', cancelled: true }) === 'Kein WLAN', 'Ergebnis');
  ok(O.name('  Karwendel\n Runde ') === 'Karwendel Runde' && O.name('', 'X') === 'X' && O.name('x'.repeat(80)).length === 60, 'Namen');
}

/* ---------- 2.12.0 Unterbrochene Aufzeichnung (calc-aufnahme.js): gleiche 12-Stunden-Regel wie RecoveryPlanCheck.java, Hinweistext ---------- */
{
  const AU = require(W + 'calc-aufnahme.js'), H = 3600000, now = day(2026, 11, 22, 18);
  ok(AU.FORTSETZEN_MAX_MS === 12 * H && AU.UHR_SPIEL_MS === 10 * 60000, 'Grenzen wie in der Hülle');
  ok(AU.fortsetzenErlaubt(now - 5 * 60000, now) && AU.fortsetzenErlaubt(now - (12 * H - 60000), now), 'bis knapp 12 h');
  ok(!AU.fortsetzenErlaubt(now - 12 * H, now) && !AU.fortsetzenErlaubt(now - 30 * H, now), 'ab 12 h nicht mehr');
  ok(AU.fortsetzenErlaubt(now + 5 * 60000, now) && !AU.fortsetzenErlaubt(now + H, now) && !AU.fortsetzenErlaubt(0, now) && !AU.fortsetzenErlaubt(null, now), 'Uhr zurück, ohne Zeit');
  ok(AU.unterbrochen({ state: 'recording', interrupted: true }) && !AU.unterbrochen({ state: 'recording', interrupted: false }) && !AU.unterbrochen({ state: 'recording' }), 'unterbrochen nur mit Meldung der Hülle');
  ok(!AU.unterbrochen({ state: 'paused', interrupted: true }) && !AU.unterbrochen(null) && !AU.unterbrochen({ state: 'idle' }), 'Pause/nichts ist nicht unterbrochen');
  const z = AU.zeile({ start: day(2026, 11, 22, 9) + 14 * 60000, count: 1234, dist_m: 12345 });
  ok(z === 'Aufnahme vom 22.11.2026, 09:14 Uhr wurde unterbrochen (1.234 Punkte, 12,3 km)', z);
  ok(AU.zeile({ start: day(2026, 3, 29, 3), count: 1, dist_m: 40 }) === 'Aufnahme vom 29.03.2026, 03:00 Uhr wurde unterbrochen (1 Punkt, 0,0 km)', 'Sommerzeit-Tag, ein Punkt');
  ok(AU.alter(now - 20000, now) === 'gerade eben' && AU.alter(now - 60000, now) === 'vor 1 Minute' && AU.alter(now - 25 * 60000, now) === 'vor 25 Minuten', 'Alter Minuten');
  ok(AU.alter(now - 3 * H, now) === 'vor 3 Stunden' && AU.alter(now - H, now) === 'vor 1 Stunde' && AU.alter(now - 50 * H, now) === 'vor 2 Tagen', 'Alter Stunden/Tage');
}

(async () => {
  // --- GPX einer Buchtour lesen ---
  const gpx = (inner, meta) => '<?xml version="1.0"?><gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">' + (meta || '') + inner + '</gpx>';
  const trk = (name, pts) => '<trk>' + (name ? '<name>' + name + '</name>' : '') + '<trkseg>' + pts.map(p => '<trkpt lat="' + p.lat + '" lon="' + p.lon + '">' + (p.ele != null ? '<ele>' + p.ele + '</ele>' : '') + '</trkpt>').join('') + '</trkseg></trk>';
  const rampe = Array.from({ length: 60 }, (_, i) => ({ lat: 47.5 + i * 0.0003, lon: 11.2 + i * 0.0002, ele: 1000 + i * 5 }));      // 295 m Anstieg, ≈ 2,2 km
  let g = Fu.lies(gpx(trk('Rother 12 · Hochalm &amp; Seilbahn', rampe)), 'tour12.gpx');
  A.strictEqual(g.titel, 'Rother 12 · Hochalm & Seilbahn'); A.strictEqual(g.pts.length, 60); n += 2;
  ok(g.km > 2.0 && g.km < 2.6, 'Länge in km ' + g.km); ok(g.up >= 280 && g.up <= 300, 'Aufstieg ' + g.up);
  A.strictEqual(Fu.lies(gpx(trk('', rampe)), 'pfad/Tour 7 Gipfel.gpx').titel, 'Tour 7 Gipfel'); n++;                         // ohne Namen: Dateiname
  A.strictEqual(Fu.lies(gpx(trk('tour7.gpx', rampe)), 'x.gpx').titel, 'x'); n++;                                              // Name ist selbst ein Dateiname
  A.strictEqual(Fu.lies(gpx(trk('Spur', rampe), '<metadata><name><![CDATA[Buchtitel Nr. 3]]></name></metadata>'), 'a.gpx').titel, 'Buchtitel Nr. 3'); n++;      // Metadaten vor Track, CDATA
  A.strictEqual(Fu.lies(gpx('<wpt lat="47.5" lon="11.2"><name>Parkplatz</name></wpt>' + trk('Die Runde', rampe)), 'a.gpx').titel, 'Die Runde'); n++;      // Wegpunkt ist kein Titel
  const route = '<rte><name>Routenname</name>' + rampe.map(p => '<rtept lat="' + p.lat + '" lon="' + p.lon + '"/>').join('') + '</rte>';
  g = Fu.lies(gpx(route), 'r.gpx'); A.strictEqual(g.titel, 'Routenname'); A.strictEqual(g.up, null); ok(g.pts.length === 60, 'Route ohne Höhen: Punkte, kein Aufstieg'); n += 2;
  for (const bad of ['', 'kein xml', gpx(trk('x', rampe.slice(0, 2))), gpx('<trk><trkseg><trkpt lat="99" lon="11"/><trkpt lat="a" lon="b"/><trkpt lat="1" lon="1"/></trkseg></trk>')]) { A.throws(() => Fu.lies(bad, 'x.gpx'), /keine Streckenpunkte/); n++; }
  ok(Fu.lies(gpx(trk('Nur drei', rampe.slice(0, 3))), 'x.gpx').pts.length === 3, 'drei Punkte genügen');
  // Aufstieg: Rauschen unter 3 m zählt nicht, echte Stufen schon
  A.strictEqual(Fu.aufstieg([100, 101, 100, 101, 100, 101, 100, 101]), 0); A.strictEqual(Fu.aufstieg([100, 100]), null); n += 2;
  const stufe = [].concat(Array(10).fill(100), Array(10).fill(150), Array(10).fill(200));
  ok(Math.abs(Fu.aufstieg(stufe) - 100) <= 8, 'Stufen: ' + Fu.aufstieg(stufe));
  // Länge: 1 Breitengrad = 111,2 km
  ok(Math.abs(Fu.laenge([{ lat: 47, lon: 11 }, { lat: 48, lon: 11 }]) / 1000 - 111.195) < 0.05, 'Länge eines Breitengrads');

  // --- Packen / Ausdünnen / Titel-Reihenfolge ---
  const roh = strecke(9000, 500, { noise: 3 }), pk = Fu.entpacke(JSON.parse(JSON.stringify(Fu.packe(roh))));
  ok(pk.length === 500 && roh.every((p, i) => Math.abs(p.lat - pk[i].lat) < 6e-6 && Math.abs(p.lon - pk[i].lon) < 6e-6 && Math.abs(p.ele - pk[i].ele) <= 0.5), 'packen und entpacken: höchstens 0,5 m Höhe, 0,6 m Lage Abweichung');
  ok(Fu.packe(roh).la.length === 500 && JSON.stringify(Fu.packe(roh)).length < JSON.stringify(roh).length / 3, 'gepackt deutlich kleiner');
  A.deepStrictEqual(Fu.entpacke(null), []); A.deepStrictEqual(Fu.entpacke({ la: [1], lo: [1, 2] }), []); n += 2;
  ok(Fu.packe(roh.map(p => ({ lat: p.lat, lon: p.lon, ele: null }))).e === undefined, 'ohne Höhen kein Höhenfeld'); A.strictEqual(Fu.entpacke(Fu.packe(roh.map(p => ({ lat: p.lat, lon: p.lon })))).length, 500); n++;
  const d3 = Fu.duenne(Array.from({ length: 1001 }, (_, i) => ({ lat: i, lon: 0 })), 400); ok(d3.length <= 401 && d3[0].lat === 0 && d3[d3.length - 1].lat === 1000, 'ausdünnen behält Anfang und Ende');
  ok(Fu.duenne([{ lat: 1, lon: 1 }], 400).length === 1, 'kurze Strecke bleibt');
  A.deepStrictEqual(['Tour 10', 'Tour 2', 'Tour 1'].sort(Fu.natuerlich), ['Tour 1', 'Tour 2', 'Tour 10']); n++;
  const bt = Fu.buchtour(Fu.lies(gpx(trk('Eins', rampe)), 'tour1.gpx'), 4, 'ordner/tour1.gpx');
  A.strictEqual(bt.meta.id, 't4'); A.strictEqual(bt.meta.ord, 4); A.strictEqual(bt.meta.f, 'tour1.gpx'); ok(bt.meta.bb[0] === 47.5 && bt.pts.length === 60 && bt.meta.n === 60, 'Buchtour'); n += 3;

  // --- Abgleich: Treffer, Fast-Treffer, Richtung, Teilstück, Abkürzung ---
  const BUCH = strecke(10000, 330, { noise: 0 });
  let r = folgt(BUCH, strecke(10000, 1500, { noise: 8 }));
  ok(r.folgt && r.buch > .95 && r.tour > .95 && r.wert > .9, 'gleiche Strecke, dichter und mit GPS-Rauschen: folgt (' + JSON.stringify(r) + ')');
  ok(folgt(BUCH, umk(strecke(10000, 1500, { noise: 8 }))).folgt, 'Gegenrichtung zählt');
  ok(folgt(umk(BUCH), strecke(10000, 900, { noise: 5 })).folgt, 'Buch rückwärts, Tour vorwärts zählt');
  // Querversatz: 70 m daneben folgt, 100 m daneben nicht (die Tour liegt dann nicht mehr auf der Buchstrecke: 80 m), 130 m auch nicht
  const GER = strecke(10000, 330, { amp: 0 });      // (fast) gerade, damit der Querversatz dem Abstand entspricht
  ok(folgt(GER, strecke(10000, 900, { amp: 0, dy: 70 })).folgt, '70 m Querversatz folgt');
  r = folgt(GER, strecke(10000, 900, { amp: 0, dy: 100 })); ok(r.buch > .95 && r.tour === 0 && !r.folgt, '100 m Querversatz: Buch ist abgedeckt (120 m), die Tour liegt aber nicht auf dem Buch (80 m): ' + JSON.stringify(r));
  ok(!folgt(GER, strecke(10000, 900, { amp: 0, dy: 130 })).folgt, '130 m Querversatz folgt nicht');
  // Anteil der Buchstrecke: die Tour geht nur den ersten Teil
  const T10 = strecke(10000, 1500, { noise: 5 });
  ok(folgt(BUCH, teil(T10, 0, .8)).folgt, '80 % der Buchstrecke genügen'); ok(!folgt(BUCH, teil(T10, 0, .6)).folgt, '60 % genügen nicht');
  ok(folgt(BUCH, teil(T10, .2, 1)).folgt && folgt(BUCH, teil(T10, .15, .9)).folgt, 'Abkürzung am Anfang oder Ende (80 %, 75 %): folgt');
  ok(!folgt(BUCH, teil(T10, 0, .3)).folgt, 'Teilstück (30 %): folgt nicht');
  // Abkürzung mitten in der Strecke: die Tour lässt 20 % aus (stark geschwungen) und geht stattdessen gerade
  const BUCH3 = strecke(10000, 330, { amp: .3 }), T3 = strecke(10000, 1500, { amp: .3, noise: 5 }), i40 = Math.round(.3 * 329), i60 = Math.round(.5 * 329);
  const gerade = Array.from({ length: 80 }, (_, i) => ({ lat: BUCH3[i40].lat + (BUCH3[i60].lat - BUCH3[i40].lat) * i / 79, lon: BUCH3[i40].lon + (BUCH3[i60].lon - BUCH3[i40].lon) * i / 79 }));
  r = folgt(BUCH3, [].concat(teil(T3, 0, .3), gerade, teil(T3, .5, 1))); ok(r.folgt && r.buch < .9 && r.buch >= .7, 'Abkürzung in der Mitte: folgt, Buch nicht ganz abgedeckt ' + JSON.stringify(r));
  ok(!folgt(BUCH3, [].concat(teil(T3, 0, .2), strecke(10000, 100, { amp: 0, dy: 4000 }).slice(10, 70), teil(T3, .6, 1))).folgt, 'große Auslassung (40 %): folgt nicht');
  // die Tour ist viel länger als die Buchstrecke: 50 % der Tour auf dem Buch genügen, 30 % nicht (Anteil der Tour)
  const Lbuch = strecke(4000, 200, { amp: 0.05 });
  const auf = (anteil) => { const mit = Fu.duenne(strecke(4000, 800, { amp: 0.05, noise: 3 }), 800), k = Math.round(mit.length * (1 - anteil) / anteil); return mit.concat(Array.from({ length: k }, (_, i) => ({ lat: LA0 + 0.3 + i * 5e-4, lon: LO0 + 0.3 }))); };
  ok(folgt(Lbuch, auf(.5)).folgt, 'Tour: 50 % auf dem Buch genügen'); ok(!folgt(Lbuch, auf(.3)).folgt, 'Tour: 30 % auf dem Buch genügen nicht');
  r = folgt(Lbuch, auf(.5)); ok(Math.abs(r.tour - .5) < .06 && r.buch > .95, 'Anteile gemessen: ' + JSON.stringify(r));
  // Entfernte Strecke: nichts
  ok(!folgt(BUCH, strecke(10000, 900, { dy: 5000 })).folgt && !folgt(BUCH, strecke(10000, 900, { dx: 20000 })).folgt, 'ganz woanders: folgt nicht');
  // Grenzen der Regel gegen die Werte des Vorbilds (0,7 · 120 m / 0,4 · 80 m)
  A.deepStrictEqual([Fu.R_BUCH, Fu.ANTEIL_BUCH, Fu.R_TOUR, Fu.ANTEIL_TOUR], [120, .7, 80, .4]); n++;
  // leere und kaputte Eingaben
  A.deepStrictEqual(Fu.vergleiche(null, prep(T10)), { buch: 0, tour: 0, folgt: false, wert: 0 }); A.deepStrictEqual(Fu.vergleiche(buchP(BUCH), null), { buch: 0, tour: 0, folgt: false, wert: 0 });
  ok(!Fu.vergleiche(buchP([]), prep(T10)).folgt && !Fu.vergleiche(buchP(BUCH), prep([])).folgt && !Fu.vergleiche(buchP(BUCH), prep(T10.slice(0, 5))).folgt, 'leere Strecke, weniger als 6 Tourpunkte: folgt nicht');
  ok(!Fu.vergleiche(buchP(BUCH.slice(0, 1)), prep(T10)).folgt, 'ein einzelner Buchpunkt: folgt nicht'); n += 2;
  // Ein Punkt weit weg vom Rest und sehr lange Strecken ohne Zwischenpunkte stören das Raster nicht
  ok(folgt(BUCH, T10.concat([{ lat: 10, lon: 10 }])).folgt, 'ein ferner Ausreißerpunkt am Ende ändert nichts Wesentliches');
  ok(folgt([{ lat: LA0, lon: LO0 }, { lat: LA0, lon: LO0 + 0.09 }, { lat: LA0, lon: LO0 + 0.18 }], Array.from({ length: 30 }, (_, i) => ({ lat: LA0, lon: LO0 + i * 0.0062 }))).folgt, 'lange gerade Strecke (12 km Abstand der Punkte) wird richtig gerastert');
  // Umrandung
  ok(Fu.nahe([47, 11, 47.1, 11.1], [47.11, 11.11, 47.2, 11.2]) && !Fu.nahe([47, 11, 47.1, 11.1], [47.13, 11.0, 47.2, 11.2]) && !Fu.nahe([47, 11, 47.1, 11.1], [47, 11.14, 47.1, 11.2]) && !Fu.nahe(null, [1, 1, 2, 2]), 'Vorfilter: 0,02° Breite, 0,03° Länge'); n++;

  // --- Bücher, Touren, Zwischenspeicher ---
  const mkBuch = (id, name, strecken) => ({ id, name, touren: strecken.map((s, k) => ({ id: 't' + k, ord: k, title: name + ' ' + k, km: Math.round(Fu.laenge(s)) / 1000, up: 100 + k, bb: Fu.umrandung(Fu.duenne(s, Fu.MAX_BUCH)), n: s.length })) });
  const speicher = { };
  const mkLauf = (buecher, touren, pts, extra) => {
    const zaehler = { punkte: 0, buch: 0, ys: 0 };
    return { zaehler, o: Object.assign({ buecher, touren, cache: speicher.c, ladePunkte: async id => { zaehler.punkte++; return pts[id] || []; },
      ladeBuch: async id => { zaehler.buch++; const b = buecher.find(x => x.id === id); return Object.fromEntries(b.touren.map((bt, k) => [bt.id, speicher.b[id][k]])); }, pause: async () => { zaehler.ys++; } }, extra || {}) };
  };
  const BA = [strecke(8000, 250, { dy: 0 }), strecke(6000, 200, { dx: 12000, dy: 3000 }), strecke(5000, 160, { dx: -30000 })];      // drei Buchtouren, die dritte weit weg
  const BB = [strecke(8000, 250, { dy: 40, amp: .12 })];      // ein zweites Buch mit fast derselben Strecke wie BA[0]
  speicher.b = { A: BA, B: BB };
  const buecher = [mkBuch('A', 'Buch A', BA), mkBuch('B', 'Buch B', BB)];
  const mkTour = (id, start, p, extra) => Object.assign({ id, name: id, start, dist: Fu.laenge(p), bbox: Fu.umrandung(p), status: 'done', hidden: false }, extra);
  const pts = {};
  const tA0 = strecke(8000, 900, { noise: 6 }), tA0b = strecke(8000, 700, { noise: 6 }), tA1 = umk(strecke(6000, 700, { dx: 12000, dy: 3000, noise: 6 }));
  pts.t1 = tA0; pts.t2 = tA0b; pts.t3 = tA1; pts.t4 = strecke(3000, 200, { dx: 100000 });      // t4 weit weg von allem
  pts.t5 = tA0; pts.t6 = tA0;                            // t5 versteckt, t6 geplant
  const touren = [mkTour('t1', day(2025, 6, 1), tA0), mkTour('t2', day(2026, 3, 1), tA0b), mkTour('t3', day(2024, 5, 5), tA1), mkTour('t4', day(2026, 1, 1), pts.t4),
    mkTour('t5', day(2026, 8, 1), tA0, { hidden: true }), mkTour('t6', day(2026, 9, 1), tA0, { status: 'planned' }), mkTour('t7', day(2026, 9, 2), tA0, { bbox: null })];      // t7 ohne Umrandung
  ok(!Fu.zaehlt(touren[4]) && !Fu.zaehlt(touren[5]) && !Fu.zaehlt(touren[6]) && Fu.zaehlt(touren[0]), 'versteckt, geplant und ohne Umrandung zählen nicht');
  let L = mkLauf(buecher, touren, pts); let e = await Fu.rechne(L.o); speicher.c = e.cache;
  const sA = e.stand.buecher.A, sB = e.stand.buecher.B;
  A.deepStrictEqual(sA.touren.t0, ['t2', 't1']); n++;                                  // zwei Touren folgen Buchtour 0: die jüngste zuerst
  A.deepStrictEqual(sA.touren.t1, ['t3']); A.deepStrictEqual(sA.touren.t2, []); n += 2;   // Gegenrichtung zählt; weit entfernt: offen
  A.deepStrictEqual([sA.fertig, sA.gesamt, sB.fertig, sB.gesamt], [2, 3, 1, 1]); n++;   // dieselbe Tour zählt in zwei Büchern (Buch B ist 40 m daneben)
  A.deepStrictEqual(sB.touren.t0, ['t2', 't1']); n++;
  A.deepStrictEqual([e.stand.fertig, e.stand.gesamt, e.stand.fehlendePaare], [3, 4, 0]); n++;
  ok(e.berechnet > 0 && e.berechnet <= 12 && L.zaehler.punkte === 3, 'nur nahe Touren werden geladen und verglichen: ' + e.berechnet + ' Vergleiche, ' + L.zaehler.punkte + ' Touren geladen (t4, t5, t6, t7 nicht)');
  ok(!e.abgebrochen && e.cache.v === Fu.VERSION, 'Zwischenspeicher mit Version');
  // zweiter Lauf: nichts mehr zu tun, keine Punkte geladen
  const c1 = JSON.stringify(speicher.c); L = mkLauf(buecher, touren, pts, { cache: JSON.parse(c1) }); e = await Fu.rechne(L.o);
  A.deepStrictEqual([e.berechnet, e.geladen, L.zaehler.punkte, L.zaehler.buch], [0, 0, 0, 0]); A.strictEqual(e.stand.fertig, 3); n += 2;
  A.strictEqual(JSON.stringify(e.cache), c1); n++;
  // Stand allein aus dem Zwischenspeicher, ohne Rechnen
  A.deepStrictEqual(Fu.stand(buecher, touren, JSON.parse(c1)).buecher.A.touren.t0, ['t2', 't1']); A.strictEqual(Fu.stand(buecher, touren, JSON.parse(c1)).fehlendePaare, 0); n += 2;
  ok(Fu.stand(buecher, touren, null).fehlendePaare > 0 && Fu.stand(buecher, touren, { v: 0, t: {} }).fehlendePaare > 0 && Fu.stand([], [], null).gesamt === 0, 'ohne oder mit alter Version: alles offen');
  // neue Tour: nur sie wird geladen; geänderte Strecke (andere Kennung): wird neu verglichen; neues Buch: nur dessen Vergleiche
  pts.t8 = strecke(6000, 600, { dx: 12000, dy: 3000, noise: 4 }); const t8 = mkTour('t8', day(2026, 10, 1), pts.t8), t8s = touren.concat([t8]);
  L = mkLauf(buecher, t8s, pts, { cache: JSON.parse(c1) }); e = await Fu.rechne(L.o);
  A.deepStrictEqual([L.zaehler.punkte, e.geladen], [1, 1]); A.deepStrictEqual(e.stand.buecher.A.touren.t1, ['t8', 't3']); n += 2;
  const cg = JSON.stringify(e.cache), geaendert = t8s.map(t => t.id === 't1' ? Object.assign({}, t, { dist: t.dist + 800 }) : t);
  L = mkLauf(buecher, geaendert, pts, { cache: JSON.parse(cg) }); e = await Fu.rechne(L.o); A.deepStrictEqual([L.zaehler.punkte, e.berechnet > 0], [1, true]); n++;
  const BC = [strecke(8000, 200, { dy: 0, amp: .12 }), strecke(3000, 100, { dx: 50000 })]; speicher.b.C = BC; const buecher3 = buecher.concat([mkBuch('C', 'Buch C', BC)]);
  L = mkLauf(buecher3, t8s, pts, { cache: JSON.parse(cg) }); e = await Fu.rechne(L.o);
  A.deepStrictEqual(e.stand.buecher.C.touren.t0.slice().sort(), ['t1', 't2'].sort()); ok(e.berechnet <= 4 && L.zaehler.buch === 1, 'neues Buch: nur dessen Vergleiche (' + e.berechnet + '), nur sein Buch geladen (' + L.zaehler.buch + ')'); n++;
  // Bücher und Touren verschwinden: aufräumen
  L = mkLauf([buecher[0]], touren.slice(0, 2), pts, { cache: JSON.parse(JSON.stringify(e.cache)) }); e = await Fu.rechne(L.o);
  ok(Object.keys(e.cache.t).every(k => ['t1', 't2'].includes(k)) && Object.values(e.cache.t).every(x => Object.keys(x.b).every(k => k === 'A')), 'Einträge gelöschter Touren und Bücher werden entfernt');
  // Abbrechen und Blöcke
  L = mkLauf(buecher, touren, pts, { cache: null, ms: -1, abbrechen: () => L.zaehler.ys >= 2 }); e = await Fu.rechne(L.o);
  ok(e.abgebrochen && L.zaehler.ys >= 2, 'Abbruch nach zwei Blöcken');
  L = mkLauf(buecher, touren, pts, { cache: e.cache, ms: -1 }); e = await Fu.rechne(L.o); ok(!e.abgebrochen && e.stand.fertig === 3 && e.stand.fehlendePaare === 0, 'nach dem Abbruch genügt ein weiterer Lauf: nichts geht verloren');
  let fort = [], teile = 0; L = mkLauf(buecher, touren, pts, { cache: null, ms: -1, fortschritt: a => fort.push(a), teil: () => teile++ }); await Fu.rechne(L.o);
  ok(fort.length > 1 && fort.every((x, i) => i === 0 || x >= fort[i - 1]) && fort[fort.length - 1] === 1 && L.zaehler.ys > 0, 'Fortschritt steigt bis 1, die Pause wird genutzt');
  // Fehler beim Laden einer Tour: sie gilt als nicht folgend, der Rest läuft weiter
  L = mkLauf(buecher, touren, pts, { cache: null }); L.o.ladePunkte = async id => { if (id === 't1') throw new Error('weg'); return pts[id]; }; e = await Fu.rechne(L.o);
  A.deepStrictEqual(e.stand.buecher.A.touren.t0, ['t2']); n++;
  // leere Eingaben
  e = await Fu.rechne({ buecher: [], touren: [], ladePunkte: async () => [], ladeBuch: async () => ({}) }); A.deepStrictEqual([e.berechnet, e.stand.gesamt, e.stand.fertig], [0, 0, 0]); n++;
  e = await Fu.rechne({ buecher, touren: [], ladePunkte: async () => [], ladeBuch: async () => ({}) }); A.deepStrictEqual([e.berechnet, e.stand.gesamt, e.stand.fertig], [0, 4, 0]); n++;
  e = await Fu.rechne({ buecher: [{ id: 'X', name: 'leer', touren: [] }], touren, ladePunkte: async () => [], ladeBuch: async () => ({}) }); A.deepStrictEqual([e.stand.gesamt, Fu.prozent(0, 0)], [0, 0]); n++;
  e = await Fu.rechne({ buecher, touren, ladePunkte: async () => [], ladeBuch: async () => null }); A.strictEqual(e.stand.fertig, 0); n++;      // fehlende Daten: nichts gewandert, kein Absturz
  A.strictEqual(Fu.sig(touren[0]), Fu.sig(Object.assign({}, touren[0]))); ok(Fu.sig(touren[0]) !== Fu.sig(Object.assign({}, touren[0], { dist: touren[0].dist + 5 })) && Fu.sig(touren[0]) !== Fu.sig(Object.assign({}, touren[0], { start: 1 })), 'Kennung ändert sich mit Strecke und Beginn'); n++;

  // --- Eine Tour gegen alle Bücher (Tourseite, Namensvorschlag) ---
  const lb = async id => Object.fromEntries(buecher.find(x => x.id === id).touren.map((b, k) => [b.id, speicher.b[id][k]]));
  let ft = await Fu.fuerTour(touren[0], pts.t1, buecher, lb); A.deepStrictEqual(ft.map(x => [x.buchId, x.id]).sort(), [['A', 't0'], ['B', 't0']]); ok(ft[0].wert >= ft[1].wert && ft[0].title && ft[0].buch, 'Treffer mit Titel und Buch, der beste zuerst'); n++;
  A.deepStrictEqual(await Fu.fuerTour(touren[3], pts.t4, buecher, lb), []); A.deepStrictEqual(await Fu.fuerTour(null, pts.t1, buecher, lb), []); A.deepStrictEqual(await Fu.fuerTour(touren[0], [], buecher, lb), []); A.deepStrictEqual(await Fu.fuerTour(touren[5], pts.t1, buecher, lb), []); n += 4;
  ok((await Fu.fuerTour(touren[0], pts.t1, buecher, lb, 1)).length === 1, 'höchstens so viele Treffer wie verlangt');
  let geladen = 0; await Fu.fuerTour(touren[3], pts.t4, buecher, async id => { geladen++; return lb(id); }); A.strictEqual(geladen, 0); n++;      // weit weg: kein Buch wird geladen

  // --- Anzeige: Filter, Suche, Reihenfolge ---
  const st = Fu.stand(buecher, touren, speicher.c), ans = (sel) => Fu.ansicht(buecher, st, sel);
  let v = ans(); A.deepStrictEqual(v.map(x => [x.buch.id, x.touren.length, x.fertig, x.gesamt]), [['A', 3, 2, 3], ['B', 1, 1, 1]]); n++;
  v = ans({ filter: 'offen' }); A.deepStrictEqual(v.map(x => [x.buch.id, x.touren.map(t => t.id)]), [['A', ['t2']]]); n++;        // Buch B hat nichts Offenes: entfällt; die Zahlen bleiben die des ganzen Buchs
  A.deepStrictEqual([v[0].fertig, v[0].gesamt], [2, 3]); n++;
  v = ans({ filter: 'gewandert' }); A.deepStrictEqual(v.map(x => [x.buch.id, x.touren.map(t => t.id)]), [['A', ['t0', 't1']], ['B', ['t0']]]); n++;
  v = ans({ suche: 'buch b' }); A.deepStrictEqual(v.map(x => x.buch.id), ['B']); n++;                                                  // Buchname trifft
  v = ans({ suche: 'a 2' }); A.deepStrictEqual(v.map(x => [x.buch.id, x.touren.map(t => t.id)]), [['A', ['t2']]]); n++;                // Titel trifft
  v = ans({ suche: 'BUCH A', filter: 'offen' }); A.deepStrictEqual(v[0].touren.map(t => t.id), ['t2']); n++;
  A.deepStrictEqual(ans({ suche: 'gibtesnicht' }), []); A.deepStrictEqual(Fu.ansicht([], null, {}), []); n += 2;
  const lg = Fu.ansicht(buecher, st, { sort: 'laenge' })[0].touren.map(t => t.id); A.deepStrictEqual(lg, ['t2', 't1', 't0']); n++;           // 5 km, 6 km, 8 km
  A.deepStrictEqual(Fu.ansicht(buecher, st, { sort: 'buch' })[0].touren.map(t => t.id), ['t0', 't1', 't2']); n++;
  A.deepStrictEqual(Fu.ansicht([{ id: 'Z', name: 'Leer', touren: [] }], null, {}).map(x => [x.gesamt, x.fertig]), [[0, 0]]); n++;      // leeres Buch ohne Stand bleibt sichtbar
  A.deepStrictEqual([Fu.prozent(12, 60), Fu.prozent(1, 3), Fu.prozent(2, 3), Fu.prozent(3, 3), Fu.prozent(0, 5)], [20, 33, 67, 100, 0]); n++;

  // --- Leistung: 800 Touren × 300 Buchtouren (6 Bücher à 50); gestreut über vier Regionen und – ungünstigster Fall – alle im selben Gebiet (alle Umrandungen überlappen) ---
  const leistung = async (REG, sp, name, grenze) => {
    const buchGross = [], ptsGross = {}, bp = {};
    for (let b = 0; b < 6; b++) {
      const reg = REG[b % REG.length], ss = [];
      for (let k = 0; k < 50; k++) { const s = strecke(5000 + frnd() * 9000, 300 + Math.floor(frnd() * 100), { amp: .06 + frnd() * .1, ph: frnd() * 6 }); const dla = reg[0] - LA0 + (frnd() - .5) * sp[0], dlo = reg[1] - LO0 + (frnd() - .5) * sp[1]; ss.push(s.map(p => ({ lat: p.lat + dla, lon: p.lon + dlo, ele: p.ele }))); }
      bp['G' + b] = ss; buchGross.push(mkBuch('G' + b, 'Buch ' + b, ss));
    }
    const tg = [];
    for (let i = 0; i < 800; i++) {
      let p;
      if (i % 4 === 0) { const j = i / 4, b = j % 6, k = Math.floor(j / 6) % 50, s = bp['G' + b][k]; p = Fu.duenne(s, 2500).map(q => ({ lat: q.lat + (frnd() - .5) * 2e-4, lon: q.lon + (frnd() - .5) * 3e-4, ele: q.ele })); if (i % 8 === 0) p = umk(p); while (p.length < 1800) p = p.concat(p.slice(-50)); }
      else { const reg = REG[i % REG.length], s = strecke(4000 + frnd() * 12000, 1500 + Math.floor(frnd() * 1500), { amp: .05 + frnd() * .1, ph: frnd() * 6 }); const dla = reg[0] - LA0 + (frnd() - .5) * sp[0], dlo = reg[1] - LO0 + (frnd() - .5) * sp[1]; p = s.map(q => ({ lat: q.lat + dla, lon: q.lon + dlo, ele: q.ele })); }
      ptsGross['g' + i] = p; tg.push(mkTour('g' + i, day(2020, 0, 1) + i * 86400000 * 2, p));
    }
    let yields = 0; const z0 = Date.now();
    const gross = await Fu.rechne({ buecher: buchGross, touren: tg, cache: null, ladePunkte: async id => ptsGross[id], ladeBuch: async id => Object.fromEntries(bp[id].map((s, k) => ['t' + k, s])), pause: async () => { yields++; } });
    const ms = Date.now() - z0;
    ok(gross.stand.fertig >= 150 && gross.stand.fertig <= 300 && gross.stand.fehlendePaare === 0, name + ': ' + gross.stand.fertig + ' von ' + gross.stand.gesamt + ' gewandert');
    ok(ms < grenze, name + ': 800 Touren × 300 Buchtouren in ' + ms + ' ms (' + gross.berechnet + ' Vergleiche, ' + gross.geladen + ' Touren geladen, ' + yields + ' Pausen)');
    const kb = Math.round(JSON.stringify(gross.cache).length / 1024), z2 = Date.now();
    const g2 = await Fu.rechne({ buecher: buchGross, touren: tg, cache: JSON.parse(JSON.stringify(gross.cache)), ladePunkte: async () => { throw new Error('darf nicht laden'); }, ladeBuch: async () => { throw new Error('darf nicht laden'); } });
    ok(g2.berechnet === 0 && Date.now() - z2 < 3000 && g2.stand.fertig === gross.stand.fertig, name + ': zweiter Lauf nur aus dem Zwischenspeicher: ' + (Date.now() - z2) + ' ms; Zwischenspeicher ' + kb + ' KB');
    if (process.env.FUEHRER_MESSUNG) console.log('MESSUNG ' + name + ': ' + ms + ' ms, ' + gross.berechnet + ' Vergleiche, ' + gross.geladen + ' Touren geladen, ' + yields + ' Pausen, Zwischenspeicher ' + kb + ' KB, zweiter Lauf ' + (Date.now() - z2) + ' ms, gewandert ' + gross.stand.fertig + '/' + gross.stand.gesamt);
  };
  await leistung([[28.0, -15.6], [47.5, 11.2], [50.1, 8.4], [43.2, 6.3]], [0.3, 0.4], 'gestreut', 20000);
  await leistung([[47.5, 11.2]], [0.08, 0.1], 'ein Gebiet (ungünstigster Fall)', 30000);
})().then(() => { console.log('OK (' + n + ' Prüfungen)'); }, e => { console.error(e); process.exit(1); });
