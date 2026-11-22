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

  /* ---- 2.12.0: Zuschneiden ohne Neu-Kodierung (gleiche Regeln in der Hülle: VideoPlan.trimStartUs/trimEndUs/trimOk/timeLabel) ---- */
  const SCHNITT_MIN_MS = 1000;
  /** Wirklicher Start (ms): letztes Schlüsselbild bei oder vor dem Wunsch; vor dem ersten: das erste; ohne Schlüsselbilder: 0. keys aufsteigend (ms). */
  function schnittStart(keys, want) {
    if (!keys || !keys.length) return 0;
    let best = keys[0];
    for (const k of keys) { if (k <= want) best = k; else break; }
    return Math.max(0, best);
  }
  /** Wirkliches Ende (ms): genau wie gewünscht, höchstens die Länge; 0/zu groß → Länge. */
  function schnittEnde(dur, want) { return dur > 0 && (!(want > 0) || want > dur) ? dur : Math.max(0, +want || 0); }
  /** Mindestens 1 s, vor dem Ende, nicht das ganze Video. */
  function schnittOk(a, e, dur) {
    if (a < 0 || e <= a || e - a < SCHNITT_MIN_MS) return false;
    if (dur > 0 && (a >= dur || (a === 0 && e >= dur))) return false;
    return true;
  }
  /** „0:03,2“ (abgerundet auf Zehntel), ab einer Stunde „1:02:03,4“. */
  function zeitText(ms) {
    ms = Math.max(0, +ms || 0);
    const z = Math.floor(ms / 100), t = Math.floor(z / 10), d = z % 10, hh = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
    const ss = String(s).padStart(2, '0') + ',' + d;
    return hh ? hh + ':' + String(m).padStart(2, '0') + ':' + ss : m + ':' + ss;
  }
  /** Eingabe „1:05,5“, „0:03“, „12,3“, „1:02:03“ (Punkt oder Komma) → ms; Unlesbares → null. */
  function zeitLesen(txt) {
    const t = String(txt == null ? '' : txt).trim().replace(',', '.');
    if (!/^\d+(:\d{1,2}){0,2}(\.\d+)?$/.test(t)) return null;
    const teile = t.split(':'), sek = parseFloat(teile.pop());
    if (teile.length && sek >= 60) return null;
    let v = sek;
    if (teile.length === 1) v += 60 * +teile[0];
    if (teile.length === 2) { if (+teile[1] >= 60) return null; v += 3600 * +teile[0] + 60 * +teile[1]; }
    return Math.round(v * 1000);
  }
  /** Videos, die noch nicht in der Galerie sind (Merkliste der Hülle), ohne doppelte. */
  function galerieOffen(ids, done) {
    const d = new Set(done || []), seen = new Set();
    return (ids || []).filter(id => id && !seen.has(id) && seen.add(id) && !d.has(id));
  }

  const api = { LIMITS, VORGABE, limitSek, dauer, dauerText, speicher, SCHNITT_MIN_MS, schnittStart, schnittEnde, schnittOk, zeitText, zeitLesen, galerieOffen };
  if (node) module.exports = api; else root.VideoCalc = api;
})(typeof window !== 'undefined' ? window : globalThis);
