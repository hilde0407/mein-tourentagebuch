'use strict';
/* Gezeichnete Symbole statt Emojis – dieselbe Strichart wie bei „Meine Touren“ (24er-Raster, runde Enden).
   Die Ansichten dürfen weiterhin z. B. „🗑️ Löschen“ schreiben: iconize() ersetzt das führende Zeichen durch
   das Liniensymbol in Schriftfarbe. Neue Stellen nehmen besser gleich Ico.svg('name') oder Ico.el('name'). */
const ICONS = {
  // Reiter und Navigation
  home: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/>',
  peak: '<path d="M3 19l6-11 4 7 2-3 6 7z"/>',
  tours: '<path d="M3 19l6-10 4 6 2-3 6 7z"/><circle cx="17" cy="6" r="1.6"/>',
  map: '<path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2-6-2z"/><path d="M9 4v14M15 6v14"/>',
  photo: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M21 16l-5-5-8 8"/>',
  more: '<circle cx="5" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.5" fill="currentColor" stroke="none"/>',
  dots: '<circle cx="12" cy="5" r="1.5" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="12" cy="19" r="1.5" fill="currentColor" stroke="none"/>',
  back: '<path d="M11 5l-7 7 7 7"/><path d="M4 12h16"/>',
  prev: '<path d="M14.5 5.5L8 12l6.5 6.5"/>',
  next: '<path d="M9.5 5.5L16 12l-6.5 6.5"/>',
  up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
  filter: '<path d="M4 7h16M7 12h10M10 17h4"/>',
  list: '<path d="M9 6.5h11M9 12h11M9 17.5h11"/><path d="M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01" stroke-width="2.6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5"/><circle cx="12" cy="7.8" r=".9" fill="currentColor" stroke="none"/>',
  // Handlungen
  rec: '<circle cx="12" cy="12" r="6" fill="currentColor" stroke="none"/>',
  stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="1.5" fill="currentColor" stroke="none"/>',
  play: '<path d="M8 5.5v13l11-6.5z" fill="currentColor" stroke="none"/>',
  pause: '<path d="M8.5 6v12M15.5 6v12" stroke-width="2.6"/>',
  replay: '<path d="M4 12a8 8 0 1 0 2.3-5.7"/><path d="M4 4v5h5"/>',
  pencil: '<path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/>',
  route: '<circle cx="6" cy="18" r="2.2"/><circle cx="18" cy="6" r="2.2"/><path d="M8 17.5c6 0 2-10 8-11"/>',
  tag: '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.3"/>',
  book: '<path d="M3 5c3-1 6-1 9 1v14c-3-2-6-2-9-1z"/><path d="M21 5c-3-1-6-1-9 1v14c3-2 6-2 9-1z"/>',
  share: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M5 20h14"/>',
  download: '<path d="M12 4v12M7 11l5 5 5-5"/><path d="M5 20h14"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  video: '<rect x="3" y="7" width="12" height="10" rx="2"/><path d="M15 11l6-3v8l-6-3z"/>',
  refresh: '<path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 4v5h-5"/>',
  trash: '<path d="M4 7h16M10 4h4M6 7l1 13h10l1-13"/><path d="M10 11v6M14 11v6"/>',
  trophy: '<path d="M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4M12 14v4M8 20h8"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  gear: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v2.6M12 18.9v2.6M4.2 7.2l2.2 1.3M17.6 15.5l2.2 1.3M4.2 16.8l2.2-1.3M17.6 8.5l2.2-1.3"/>',
  save: '<path d="M5 4h11l3 3v13H5z"/><path d="M8 4v5h7V4M8 20v-6h8v6"/>',
  undo: '<path d="M9 7L4 12l5 5"/><path d="M4 12h10a5 5 0 0 1 0 10h-2"/>',
  clock: '<circle cx="12" cy="13" r="7.5"/><path d="M12 9.5V13l2.5 1.5M9.5 2.5h5"/>',
  pin: '<path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  heart: '<path d="M12 20s-7-4.6-7-9.6A3.9 3.9 0 0 1 12 8a3.9 3.9 0 0 1 7 2.4c0 5-7 9.6-7 9.6z" fill="currentColor" stroke="none"/>',
  star: '<path d="M12 3.5l2.7 5.5 6 .9-4.3 4.2 1 6-5.4-2.8-5.4 2.8 1-6L3.3 9.9l6-.9z" fill="currentColor" stroke="none"/>',
  staro: '<path d="M12 3.5l2.7 5.5 6 .9-4.3 4.2 1 6-5.4-2.8-5.4 2.8 1-6L3.3 9.9l6-.9z"/>',
  bag: '<rect x="5" y="8" width="14" height="12" rx="2"/><path d="M9 8V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V8"/><path d="M9 12v4M15 12v4"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  file: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 13h6M9 17h6"/>',
  watch: '<rect x="7" y="7" width="10" height="10" rx="2.5"/><path d="M9 7l.7-4h4.6l.7 4M9 17l.7 4h4.6l.7-4M12 10v2.3l1.5 1"/>',
  bulb: '<path d="M9 17h6M10 20.5h4"/><path d="M8.5 14.5A6 6 0 1 1 15.5 14.5c-.6.5-.9 1.3-.9 2.5H9.4c0-1.2-.3-2-.9-2.5z"/>',
  wrench: '<path d="M14.5 6.5a4 4 0 0 0-5 5L4 17v3h3l5.5-5.5a4 4 0 0 0 5-5l-2.5 2.5-2.5-.5-.5-2.5z"/>',
  flight: '<path d="M3 11.5l18-7.5-7.5 18-2.5-8z"/><path d="M11 14l4-4"/>',
  film: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 5v14M17 5v14M3 9.5h4M3 14.5h4M17 9.5h4M17 14.5h4"/>',
  spark: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M18.5 16l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"/>',
  laptop: '<rect x="5" y="5" width="14" height="10" rx="1.5"/><path d="M2.5 19h19"/>',
  server: '<rect x="4" y="4" width="16" height="6.5" rx="1.5"/><rect x="4" y="13.5" width="16" height="6.5" rx="1.5"/><path d="M7.5 7.3h.01M7.5 16.8h.01"/>',
  cloud: '<path d="M7 18.5a4 4 0 0 1-.5-8 5.5 5.5 0 0 1 10.6-1 4.5 4.5 0 0 1 .4 9z"/>',
  eye: '<path d="M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
  eyeoff: '<path d="M4 4l16 16"/><path d="M9.5 5.9A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-2.8 3.6M6.3 7.7A16.5 16.5 0 0 0 2.5 12s3.5 6.5 9.5 6.5c1.3 0 2.5-.3 3.6-.8"/>',
  calendar: '<rect x="4" y="5.5" width="16" height="14.5" rx="2"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4"/>',
  speaker: '<path d="M4 10v4h3.5l4.5 4V6l-4.5 4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',
  signal: '<path d="M5 19a14 14 0 0 1 14-14"/><path d="M5 19a8.5 8.5 0 0 1 8.5-8.5"/><circle cx="6" cy="18" r="1.6" fill="currentColor" stroke="none"/>',
  battery: '<rect x="3" y="8" width="16" height="8.5" rx="2"/><path d="M21.5 11v2.5M6.5 11v2.5M9.5 11v2.5"/>',
  locate: '<circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="1.8" fill="currentColor" stroke="none"/><path d="M12 2.5V6M12 18v3.5M2.5 12H6M18 12h3.5"/>',
  loop: '<path d="M17 4l3 3-3 3"/><path d="M20 7H9a5 5 0 0 0 0 10h1"/><path d="M14 17h6"/>',
  swap: '<path d="M4 8h14M14 4l4 4-4 4"/><path d="M20 16H6M10 12l-4 4 4 4"/>',
  flag: '<path d="M6 21V4"/><path d="M6 5h11l-2.5 4 2.5 4H6"/>',
  target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/>',
  chat: '<path d="M4 5.5h16v11H10l-4.5 3.5v-3.5H4z"/>',
  flame: '<path d="M12 21a6 6 0 0 1-6-6c0-3 2-4.5 3-7 .5 2 1.5 3 2.5 3.5C11 8 12 5 14.5 3c0 4 3.5 6 3.5 12a6 6 0 0 1-6 6z"/>',
  bike: '<circle cx="5.5" cy="17" r="3.5"/><circle cx="18.5" cy="17" r="3.5"/><path d="M5.5 17l4-7h5l4 7M9.5 10l3 7M14 7h3"/>',
  bolt: '<path d="M13 2L5 14h6l-1 8 8-12h-6z"/>',
  walk: '<circle cx="13" cy="4.5" r="1.8"/><path d="M13 8l-3 4 2 3 1 5M13 8l3 3 2 1M10 12l-3 7"/>',
  run: '<circle cx="15" cy="4.5" r="1.8"/><path d="M15 8l-4 3 1 4 2 5M11 11L7 13l-1 4M12 15l5 1"/>',
  ski: '<circle cx="14" cy="4.5" r="1.8"/><path d="M14 8l-2 4 3 3 1 4M3 19l18-4M9 12l-3 4"/>',
  skialpin: '<circle cx="15" cy="4.5" r="1.8"/><path d="M15 8l-3.5 3 2.5 3.5 2 1.5M3 20l18-6M11.5 11L7 12.5M13 8l4 3"/>',
  skitour: '<circle cx="9" cy="5" r="1.8"/><path d="M9 8.5l-1 4 3 2.5.5 4M3 18l15-5M8 12.5L5 10.5M14 21l3.5-7 3.5 7z"/>',
  nordic: '<circle cx="12" cy="4.5" r="1.8"/><path d="M12 8l-1 4-4.5 4M11.5 12l4.5 3.5 4-1M3 20h8M13 18.5h8M12 8l5 3M8 10l4-2"/>',
  snowshoe: '<circle cx="13" cy="4.5" r="1.8"/><path d="M13 8l-3 4 2 3 .5 3.5M13 8l3 3 2 1M10 12l-2.5 5.5"/><ellipse cx="7" cy="20" rx="3.2" ry="1.4"/><ellipse cx="14" cy="20.5" rx="3.2" ry="1.4"/>',      // 2.19.0: Schneeschuh
  // 2.19.0: Symbole der neuen Aktivitäten
  wall: '<path d="M4 21V3h16v18"/><circle cx="9" cy="8" r="1"/><circle cx="15" cy="11" r="1"/><circle cx="10" cy="15" r="1"/><circle cx="14" cy="18" r="1"/><path d="M12 3v3"/>',
  nwalk: '<circle cx="12" cy="4.5" r="1.8"/><path d="M12 8l-2.5 4 2 3 1 5M12 8l3 3 2 1M9.5 12l-3 7M5 21l3-10M19 21l-2-9"/>',
  trail: '<circle cx="15" cy="4.5" r="1.8"/><path d="M15 8l-4 3 1 4 2 5M11 11L7 13l-1 4M12 15l5 1M2 21l7-5 4 2 9-6"/>',
  snowboard: '<circle cx="12" cy="4.5" r="1.8"/><path d="M12 8l-3 4 4 2-1 4M12 8l4 3M9 12l-4-1M3 19.5l18-3"/>',
  sled: '<path d="M4 14h13l2-3M6 14v3M15 14v3M3 19h15a3 3 0 0 0 3-3"/><circle cx="10" cy="6" r="1.8"/><path d="M10 9l-1 5M10 9l4 2"/>',
  skate: '<path d="M6 4h5v8l7 2v3H5zM4 20h16M8 17v3M16 17v3"/>',
  swim: '<circle cx="16" cy="6" r="1.8"/><path d="M4 13l5-4 3 3 4-2M2 17c2 0 2 1.5 4 1.5S8 17 10 17s2 1.5 4 1.5 2-1.5 4-1.5 2 1.5 4 1.5"/>',
  kayak: '<path d="M2 15c4 3 16 3 20 0M5 4l14 16"/><path d="M4 3l2 3M18 21l2-3"/><circle cx="12" cy="9" r="1.6"/>',
  sup: '<circle cx="12" cy="4.5" r="1.8"/><path d="M12 8v6l-2 4M12 14l2 4M12 9l5 2M17 4v14M3 19h18"/>',
  row: '<path d="M2 16c4 3 16 3 20 0M3 9l18 6"/><circle cx="12" cy="8" r="1.6"/><path d="M12 10l-2 4h4"/>',
  sail: '<path d="M12 3v14M12 3l7 12h-7M12 6L6 15h6M3 18c3 2 15 2 18 0"/>',
  inline: '<path d="M6 3h5v8l7 2v3H5zM4 20h2M10 20h2M16 20h2"/><circle cx="7" cy="20" r="1"/><circle cx="13" cy="20" r="1"/>',
  horse: '<path d="M6 21v-6l-2-3 3-5 4-2 3 1 3-2v4l2 3-2 1-2-2-2 2v3l2 6M10 15h5"/>',
  golf: '<path d="M8 21V3l9 4-9 4M4 21h12"/><circle cx="17" cy="19" r="1.5"/>',
  fish: '<path d="M3 12c3-4 9-5 13-2l4-3v10l-4-3c-4 3-10 2-13-2z"/><circle cx="8" cy="11" r=".8" fill="currentColor" stroke="none"/>',
  bow: '<path d="M5 3c8 3 13 8 16 16M5 3c-1 6 1 12 6 16 4-1 8-3 10-0M3 21L19 5M15 5h4v4"/>',
  moto: '<circle cx="5.5" cy="17" r="3.5"/><circle cx="18.5" cy="17" r="3.5"/><path d="M5.5 17l5-6h5l3 6M10 11l-2-3H5M15 11l2-4h3"/>',
  climb: '<circle cx="13" cy="4.5" r="1.8"/><path d="M13 8l-3 3 1 5-2 5M13 8l4 2 2 5M10 11L6 13"/>',
  dot: '<circle cx="12" cy="12" r="4" fill="currentColor" stroke="none"/>',
  pano: '<path d="M2.5 7c6.3-1.8 12.7-1.8 19 0v10c-6.3-1.8-12.7-1.8-19 0z"/><path d="M5.5 14.5l3.5-3.5 2.5 2.5 2-2 4.5 4"/>',      // 2.8.0: Panorama (breites, leicht gewölbtes Bild mit Bergen)
};
/* Zeichen, die in Texten der Ansichten vorkommen → Name des Symbols. Längere Folgen zuerst. */
const ICON_CHARS = {
  '❚❚': 'pause', '⛰': 'peak', '✏': 'pencil', '✎': 'pencil', '🏷': 'tag', '📖': 'book', '📤': 'share', '📥': 'download', '⬇': 'download', '🔗': 'link',
  '🧭': 'compass', '📷': 'camera', '🎥': 'video', '🔄': 'refresh', '↻': 'replay', '🗑': 'trash', '🏆': 'trophy', '📊': 'chart', '🖼': 'photo', '⚙': 'gear',
  '💾': 'save', '↩': 'undo', '↶': 'undo', '⏱': 'clock', '📍': 'pin', '📌': 'pin', '♥': 'heart', '★': 'star', '☆': 'staro', '✕': 'close', '●': 'rec', '⏺': 'rec',
  '■': 'stop', '⏹': 'stop', '▶': 'play', '＋': 'plus', '←': 'back', '‹': 'prev', '›': 'next', '⋮': 'dots', 'ⓘ': 'info', '⬆': 'up',
  '🧳': 'bag', '📁': 'folder', '📂': 'folder', '📄': 'file', '⌚': 'watch', '💡': 'bulb', '🛠': 'wrench', '🚁': 'flight', '🎞': 'film', '✨': 'spark',
  '💻': 'laptop', '🖧': 'server', '☁': 'cloud', '👁': 'eye', '🙈': 'eyeoff', '📅': 'calendar', '🔊': 'speaker', '📡': 'signal', '🔋': 'battery', '🗺': 'map',
  '◎': 'locate', '⟲': 'loop', '⇄': 'swap', '🏁': 'flag', '🎯': 'target', '💬': 'chat', '🔥': 'flame', '🟢': 'dot', '🟠': 'dot', '🌄': 'pano',
  // Sportarten
  '🥾': 'peak', '🚶': 'walk', '🚵': 'bike', '🚴': 'bike', '🚲': 'bike', '⚡': 'bolt', '🏃': 'run', '⛷': 'ski', '🏂': 'snowboard', '🎿': 'skitour', '❄': 'nordic', '🧗': 'climb', '🌨': 'snowshoe',
  '🪨': 'wall', '🐕': 'walk', '🏙': 'bike', '🛞': 'bike', '🛻': 'sled', '🤿': 'swim', '🐉': 'row', '🚤': 'kayak', '🌊': 'sup', '🪁': 'sup', '🛹': 'inline', '🎣': 'fish', '🦌': 'bow', '🏹': 'bow', '🚙': 'moto', '🏍': 'moto', '🦯': 'nwalk', '🌲': 'trail', '🏔': 'skialpin', '🛷': 'sled', '⛸': 'skate', '🏊': 'swim', '🛶': 'kayak', '🏄': 'sup', '🚣': 'row', '⛵': 'sail', '🛼': 'inline', '🐎': 'horse', '⛳': 'golf',
};
const Ico = {
  /** Symbol als SVG-Text. `key` ist ein Name aus ICONS oder eines der Zeichen aus ICON_CHARS. */
  svg(key, size) {
    const d = ICONS[key] || ICONS[ICON_CHARS[String(key).replace(/️/g, '')]];
    if (!d) return '';
    const s = size || 20;
    return `<svg class="ic" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  },
  /** Symbol als Element (für h(...)). */
  el(key, size) { const t = document.createElement('template'); t.innerHTML = Ico.svg(key, size); return t.content.firstChild || document.createTextNode(''); },
};
const ICO_RE = new RegExp('^\\s*(' + Object.keys(ICON_CHARS).sort((a, b) => b.length - a.length).map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')\\uFE0F?\\s*');
/* Wo ein führendes Zeichen ersetzt wird: Knöpfe, Listen-Symbole und die Textstellen, an denen Ansichten ein Zeichen voranstellen. */
const ICO_SEL = 'button, a.btn, .chip, .li-i, .ico > span, .rbtn > span, h3, .sub, .banner, .stt, .splc, .scm, .sph b, summary, td:first-child, .hb > span, #view p, #view b, .sheet p, .sheet b, small.stage, .tr-st';

function iconize() {
  document.querySelectorAll(ICO_SEL).forEach(e => {
    const n = e.firstChild;
    if (!n || n.nodeType !== 3) return;
    const m = n.nodeValue.match(ICO_RE);
    if (!m) return;
    const big = e.classList.contains('li-i');
    n.nodeValue = n.nodeValue.slice(m[0].length);
    e.insertAdjacentHTML('afterbegin', Ico.svg(m[1], big ? 22 : 20));
  });
}
{
  let pend = false;
  const obs = () => {
    if (pend) return;
    pend = true;
    requestAnimationFrame(() => { pend = false; iconize(); });
  };
  document.addEventListener('DOMContentLoaded', () => {
    new MutationObserver(obs).observe(document.body, { childList: true, subtree: true, characterData: true });
    iconize();
  });
}
