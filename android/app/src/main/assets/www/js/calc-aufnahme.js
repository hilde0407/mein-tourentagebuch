'use strict';
/* 2.12.0: Rechenlogik ohne Oberfläche für unterbrochene Aufzeichnungen (Absturz, Prozessende, Akku leer).
   Gleiche Regeln wie in der Hülle (RecoveryPlan.java, geprüft in tests/android/RecoveryPlanCheck.java): Fortsetzen bis knapp 12 Stunden nach dem
   letzten Lebenszeichen, die Uhr darf 10 Minuten zurückgehen. Läuft im Browser (globales `AufnahmeCalc`) und in Node (tests/test_calc.js). */
(function (root) {
  const node = typeof module !== 'undefined' && module.exports;
  const FORTSETZEN_MAX_MS = 12 * 3600000, UHR_SPIEL_MS = 10 * 60000;

  /** Ist die Aufzeichnung unterbrochen (Status der Hülle)? */
  function unterbrochen(st) { return !!st && st.state === 'recording' && st.interrupted === true; }

  /** Darf fortgesetzt werden? last = letztes Lebenszeichen (ms), now = jetzt (ms). */
  function fortsetzenErlaubt(last, now) {
    if (!(+last > 0)) return false;
    const alter = now - last;
    return alter >= -UHR_SPIEL_MS && alter < FORTSETZEN_MAX_MS;
  }

  const zahl = n => String(Math.round(+n || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const km = m => ((+m || 0) / 1000).toFixed(1).replace('.', ',') + ' km';
  const zwei = n => String(n).padStart(2, '0');

  /** „Aufnahme vom 22.11.2026, 09:14 Uhr wurde unterbrochen (1.234 Punkte, 12,3 km)“ – Datum in Ortszeit. */
  function zeile(st) {
    const d = new Date(+st.start || +st.last_ts || 0), n = +st.count || 0;
    const wann = zwei(d.getDate()) + '.' + zwei(d.getMonth() + 1) + '.' + d.getFullYear() + ', ' + zwei(d.getHours()) + ':' + zwei(d.getMinutes()) + ' Uhr';
    return 'Aufnahme vom ' + wann + ' wurde unterbrochen (' + (n === 1 ? '1 Punkt' : zahl(n) + ' Punkte') + ', ' + km(st.dist_m) + ')';
  }

  /** Wie lange ist das letzte Lebenszeichen her? „vor 25 Minuten“, „vor 3 Stunden“, „vor 2 Tagen“. */
  function alter(last, now) {
    const min = Math.max(0, Math.round((now - last) / 60000));
    if (min < 1) return 'gerade eben';
    if (min < 60) return 'vor ' + min + (min === 1 ? ' Minute' : ' Minuten');
    const hh = Math.round(min / 60);
    if (hh < 48) return 'vor ' + hh + (hh === 1 ? ' Stunde' : ' Stunden');
    const tg = Math.round(hh / 24);
    return 'vor ' + tg + ' Tagen';
  }

  const api = { FORTSETZEN_MAX_MS, UHR_SPIEL_MS, unterbrochen, fortsetzenErlaubt, zeile, alter };
  if (node) module.exports = api; else root.AufnahmeCalc = api;
})(typeof window !== 'undefined' ? window : globalThis);
