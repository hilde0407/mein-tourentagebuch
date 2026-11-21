'use strict';
/* 2.9.0: Rechenlogik ohne Oberfläche für Videos: Dauer als „m:ss“ für Kachel und Vollbild, Auswahl der Aufnahmelänge (Einstellung → Sekunden),
   Zählen von Fotos und Videos aus der Speicherangabe der Hülle. Läuft im Browser (globales `VideoCalc`) und in Node (tests/test_calc.js).
   Die gleiche Auswahl „Längste Aufnahme“ steht in der Hülle in VideoPlan.limitSeconds (geprüft in tests/android/VideoPlanCheck.java). */
(function (root) {
  const node = typeof module !== 'undefined' && module.exports;

  /** Einstellung „Längste Aufnahme“: Wert (Text, wie gespeichert) und Beschriftung. Vorgabe 2 Minuten (wie bis 2.8.1 fest). */
  const LIMITS = [['30', '30 Sekunden'], ['120', '2 Minuten'], ['300', '5 Minuten'], ['0', 'Unbegrenzt']];
  const VORGABE = '120';

  /** Wert der Einstellung in Sekunden; 0 = unbegrenzt; Unbekanntes → 120. */
  function limitSek(v) {
    const s = v == null ? '' : String(v).trim();
    return LIMITS.some(l => l[0] === s) ? +s : +VORGABE;
  }

  /** Dauer (ms) als „0:07“, „2:05“, „12:40“, ab einer Stunde „1:02:03“. Unbekannt (0, leer, negativ) → ''. Gerundet auf ganze Sekunden. */
  function dauer(ms) {
    ms = +ms;
    if (!(ms > 0)) return '';
    const t = Math.max(1, Math.round(ms / 1000)), hh = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
    const ss = String(s).padStart(2, '0');
    return hh ? hh + ':' + String(m).padStart(2, '0') + ':' + ss : m + ':' + ss;
  }

  /** Vorlesbare Fassung für aria-label: „Video, 2 Minuten 5 Sekunden“. */
  function dauerText(ms) {
    ms = +ms;
    if (!(ms > 0)) return 'Video';
    const t = Math.max(1, Math.round(ms / 1000)), hh = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
    const teil = [hh ? hh + (hh === 1 ? ' Stunde' : ' Stunden') : '', m ? m + (m === 1 ? ' Minute' : ' Minuten') : '', s ? s + (s === 1 ? ' Sekunde' : ' Sekunden') : ''].filter(Boolean);
    return 'Video, ' + teil.join(' ');
  }

  /** Speicherangabe der Hülle ('storage') vereinheitlichen. Ältere Hüllen (vor 2.9.0) kennen nur photos/bytes (Videos mitgezählt): videos = null. */
  function speicher(sto) {
    if (!sto || typeof sto !== 'object') return null;
    const neu = sto.videos != null;
    return {
      fotos: +sto.photos || 0,
      fotoBytes: neu ? (+sto.photoBytes || 0) : (+sto.bytes || 0),
      videos: neu ? (+sto.videos || 0) : null,
      videoBytes: neu ? (+sto.videoBytes || 0) : null,
      bytes: +sto.bytes || 0,
      vids: neu && sto.vids && typeof sto.vids === 'object' ? sto.vids : {},
    };
  }

  const api = { LIMITS, VORGABE, limitSek, dauer, dauerText, speicher };
  if (node) module.exports = api; else root.VideoCalc = api;
})(typeof window !== 'undefined' ? window : globalThis);
