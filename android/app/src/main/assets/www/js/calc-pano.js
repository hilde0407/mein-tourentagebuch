'use strict';
/* 2.8.0: Rechenlogik ohne Oberfläche für Panoramafotos. Die Oberfläche (Hinweis, Rückfrage, Vollbild) steht in js/v-photos.js (Pano, Lightbox).
   Hier nur, was sich prüfen lässt: Ist ein Bild ein Panorama? Gilt ein gemerkter Kamera-Start noch? Welche Angaben bekommt ein gewähltes Foto,
   wenn es keine Aufnahmezeit enthält? Läuft im Browser (globales `PanoCalc`) und in Node. */
(function (root) {
  const node = typeof module !== 'undefined' && module.exports;

  /** Ab diesem Seitenverhältnis (Breite : Höhe) gilt ein Bild als Panorama. */
  const GRENZE = 2.2;
  /** So lange nach dem Kamera-Start fragt die App beim Zurückkehren nach dem Panorama. */
  const FRIST = 12 * 3600000;

  /** Querformat-Panorama: Breite mehr als 2,2-mal die Höhe. Videos und Bilder ohne Größe nie. */
  function ist(w, h) {
    if (w && typeof w === 'object') { if (w.video) return false; h = w.h; w = w.w; }
    w = +w; h = +h;
    return w > 0 && h > 0 && w / h > GRENZE;
  }

  /** Gemerkter Kamera-Start { ts, lat?, lon? } noch offen? Verfällt nach 12 Stunden; ein Start „in der Zukunft“ (Uhr verstellt) zählt nur bis 10 min. */
  function offen(p, now) {
    if (!p || !(+p.ts > 0)) return false;
    const d = (now == null ? Date.now() : now) - p.ts;
    return d < FRIST && d > -10 * 60000;
  }

  /** Gemerkter Start, der verfallen ist (und darum still gelöscht werden kann). */
  function verfallen(p, now) { return !!p && +p.ts > 0 && !offen(p, now); }

  /** Rückfall für gewählte Fotos: ohne Aufnahmezeit im Bild (exif === false) gelten Zeit und – falls bekannt – Position des Kamera-Starts.
      pos 'start' heißt: Position vom Kamera-Start; liegt das Foto in einer Tour, wird sie wie bei 'track' aus der Spur berechnet. */
  function rueckfall(metas, p) {
    return (metas || []).map(m => {
      if (!m || m.exif !== false || !p || !(+p.ts > 0)) return m;
      const o = Object.assign({}, m, { ts: +p.ts });
      if (o.lat == null && p.lat != null && p.lon != null) { o.lat = +p.lat; o.lon = +p.lon; o.pos = 'start'; }
      return o;
    });
  }

  const api = { GRENZE, FRIST, ist, offen, verfallen, rueckfall };
  if (node) module.exports = api; else root.PanoCalc = api;
})(typeof window !== 'undefined' ? window : globalThis);
