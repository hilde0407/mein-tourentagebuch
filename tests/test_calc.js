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
})();

console.log('OK (' + n + ' Prüfungen)');
