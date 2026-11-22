'use strict';
/* 2.10.0: Rechenlogik ohne Oberfläche für die Sicherung: Tage seit der letzten Sicherung, die eine Erinnerungszeile auf der Startseite
   (Touren-Sicherung .mtl und Medien-Sicherung getrennt gezählt, gezeigt wird nur die ältere bzw. bei Gleichstand die der Touren),
   Texte zu neuen Mediendateien, Fortschritt eines Laufs der Hülle und die Regel „automatisch höchstens einmal am Tag“.
   Läuft im Browser (globales `SicherungCalc`) und in Node (tests/test_calc.js). Auswahl, Teilung und Namensprüfung der Medien-ZIPs
   stehen in der Hülle (MediaZip.java, geprüft in tests/android/MediaZipCheck.java). */
(function (root) {
  const TAG = 86400000;

  /** Ganze Tage seit last (ms); null, wenn nie. */
  function tageSeit(last, jetzt) {
    if (!last || !(last > 0)) return null;
    return Math.max(0, Math.floor((jetzt - last) / TAG));
  }

  /** Bytes als „0,4 MB“, „12 MB“, „1,6 GB“. */
  function groesse(b) {
    b = +b || 0;
    const mb = b / 1048576;
    if (mb >= 1024) return (mb / 1024).toFixed(1).replace('.', ',') + ' GB';
    if (mb >= 10) return Math.round(mb) + ' MB';
    return mb.toFixed(1).replace('.', ',') + ' MB';
  }

  const dateien = n => n === 1 ? '1 Datei' : n + ' Dateien';

  /** Zeile zu den Mediendateien: „5 neue Dateien seit der letzten Medien-Sicherung (12 MB)“. */
  function neuZeile(neu, bytes, last) {
    neu = +neu || 0;
    if (!last) return neu ? dateien(neu) + ' noch nicht gesichert (' + groesse(bytes) + ')' : 'Keine Fotos oder Videos vorhanden';
    if (!neu) return 'Keine neuen Dateien seit der letzten Medien-Sicherung';
    return (neu === 1 ? '1 neue Datei' : neu + ' neue Dateien') + ' seit der letzten Medien-Sicherung (' + groesse(bytes) + ')';
  }

  /** Eine Erinnerungszeile oder keine.
      o: { touren, letzteTouren, medienNeu, medienBytes, letzteMedien, jetzt, tage (0 = aus), spaeter (Ruhe bis ms) }
      Touren fällig: es gibt Touren und (nie gesichert oder älter als tage). Medien fällig: es gibt ungesicherte Dateien und
      (nie gesichert oder älter als tage). Beide fällig: die ältere (nie = am ältesten), bei Gleichstand die Touren. */
  function erinnerung(o) {
    o = o || {};
    const tage = Number(o.tage), jetzt = +o.jetzt || Date.now();
    if (!(tage > 0)) return { zeigen: false };
    if (o.spaeter && jetzt < o.spaeter) return { zeigen: false };
    const grenze = tage * TAG;
    const alter = last => last ? jetzt - last : Infinity;
    const tFaellig = (+o.touren > 0) && alter(o.letzteTouren) > grenze;
    const mFaellig = (+o.medienNeu > 0) && alter(o.letzteMedien) > grenze;
    if (!tFaellig && !mFaellig) return { zeigen: false };
    const art = tFaellig && (!mFaellig || alter(o.letzteTouren) >= alter(o.letzteMedien)) ? 'touren' : 'medien';
    if (art === 'touren') {
      const d = tageSeit(o.letzteTouren, jetzt);
      return { zeigen: true, art, nie: d === null, tage: d, text: d === null ? 'Noch keine Sicherung gemacht' : 'Letzte Sicherung vor ' + d + (d === 1 ? ' Tag' : ' Tagen'),
        sub: 'Deine Touren liegen nur auf diesem Handy.' };
    }
    const d = tageSeit(o.letzteMedien, jetzt);
    return { zeigen: true, art, nie: d === null, tage: d, text: d === null ? 'Fotos und Videos noch nie gesichert' : 'Fotos und Videos: letzte Sicherung vor ' + d + (d === 1 ? ' Tag' : ' Tagen'),
      sub: neuZeile(o.medienNeu, o.medienBytes, o.letzteMedien) + '. Sie liegen nur auf diesem Handy.' };
  }

  /** Örtliches Datum „2026-11-22“. */
  function tagKey(ms) {
    const d = new Date(ms);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  /** Name der automatischen Sicherung (ein Name je Tag; die Hülle behält die neuesten 5). */
  const autoName = ms => 'Tourentagebuch-Auto-' + tagKey(ms) + '.mtl';

  /** Automatisch sichern? Nur eingeschaltet, mit Ordner, und nicht schon heute. */
  function autoFaellig(an, ordner, letzterTag, jetzt) {
    return !!an && !!ordner && letzterTag !== tagKey(jetzt);
  }

  /** Fortschritt eines Laufs der Hülle (Native 'mediaJob') als Anteil 0…1 und Text. */
  function fortschritt(j) {
    if (!j) return { anteil: 0, text: '' };
    const anteil = j.total > 0 ? Math.max(0, Math.min(1, j.done / j.total)) : 0, pct = Math.floor(anteil * 100);
    if (j.phase === 'vorschau') return { anteil: 1, text: 'Vorschaubilder werden geprüft …' };
    if (j.kind === 'backup') {
      const mb = groesse(j.done / 2) + ' von ' + groesse(j.total / 2);      // jede Datei wird zweimal gelesen (Prüfsumme, dann Inhalt)
      return { anteil, text: (j.parts > 1 ? 'Teil ' + Math.max(1, j.part) + ' von ' + j.parts + ' · ' : '') + mb + ' · ' + pct + ' %' };
    }
    return { anteil, text: (j.files > 1 ? 'Datei ' + Math.max(1, j.file) + ' von ' + j.files + ' · ' : '') + pct + ' %' };
  }

  /** Zusammenfassung nach einem Lauf in Worten. */
  function ergebnis(j) {
    if (!j) return '';
    if (j.error) return (j.kind === 'restore' ? 'Wiederherstellen' : 'Sichern') + ' nicht möglich: ' + j.error;
    const r = j.result || {};
    if (j.kind === 'backup') {
      if (j.cancelled) return 'Abgebrochen. ' + (r.parts ? 'Fertige Teile bleiben gültig.' : 'Es wurde nichts gespeichert.');
      if (!r.files) return 'Nichts Neues zu sichern.';
      return 'Gesichert: ' + dateien(r.files) + ' (' + groesse(r.bytes) + ')' + (r.parts > 1 ? ' in ' + r.parts + ' Teilen' : '') + (r.folder ? ' in „' + r.folder + '“' : '');
    }
    const t = [];
    if (j.cancelled) t.push('Abgebrochen');
    t.push((r.restored === 1 ? '1 Datei' : (r.restored || 0) + ' Dateien') + ' wiederhergestellt');
    if (r.existing) t.push(r.existing + ' schon vorhanden');
    if (r.rejected) t.push(r.rejected + ' abgelehnt (unsichere Namen)');
    if (r.bad) t.push(r.bad + (r.bad === 1 ? ' Sicherung nicht lesbar' : ' Sicherungen nicht lesbar'));
    if (r.notMedia) t.push(r.notMedia === 1 ? '1 Datei ist keine Medien-Sicherung' : r.notMedia + ' Dateien sind keine Medien-Sicherung');
    if (r.thumbs) t.push(r.thumbs === 1 ? '1 Vorschaubild neu erstellt' : r.thumbs + ' Vorschaubilder neu erstellt');
    return t.join(' · ');
  }

  const api = { TAG, tageSeit, groesse, neuZeile, erinnerung, tagKey, autoName, autoFaellig, fortschritt, ergebnis };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.SicherungCalc = api;
})(typeof window !== 'undefined' ? window : globalThis);
