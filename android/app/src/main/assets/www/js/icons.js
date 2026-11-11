'use strict';
/* Gezeichnete Symbole statt Emojis – dieselben Zeichen wie bei „Meine Touren“.
   Die Ansichten schreiben weiterhin z. B. „🗑️ Löschen“; hier wird das führende Zeichen
   durch ein Liniensymbol in Schriftfarbe ersetzt. So sieht die App auf jedem Gerät gleich aus. */
const ICONS = {
  '⛰': '<path d="M3 19l6-11 4 7 2-3 6 7z"/>',
  '✏': '<path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/>',
  '✎': '<path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/>',
  '🏷': '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.3"/>',
  '📖': '<path d="M3 5c3-1 6-1 9 1v14c-3-2-6-2-9-1z"/><path d="M21 5c-3-1-6-1-9 1v14c3-2 6-2 9-1z"/>',
  '📤': '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M5 20h14"/>',
  '📥': '<path d="M12 4v12M7 11l5 5 5-5"/><path d="M5 20h14"/>',
  '🔗': '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  '🧭': '<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>',
  '📷': '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  '🔄': '<path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 4v5h-5"/>',
  '🗑': '<path d="M4 7h16M10 4h4M6 7l1 13h10l1-13"/><path d="M10 11v6M14 11v6"/>',
  '🏆': '<path d="M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4M12 14v4M8 20h8"/>',
  '📊': '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  '🖼': '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M21 16l-5-5-8 8"/>',
  '⚙': '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v2.6M12 18.9v2.6M4.2 7.2l2.2 1.3M17.6 15.5l2.2 1.3M4.2 16.8l2.2-1.3M17.6 8.5l2.2-1.3"/>',
  '💾': '<path d="M5 4h11l3 3v13H5z"/><path d="M8 4v5h7V4M8 20v-6h8v6"/>',
  '↩': '<path d="M9 7L4 12l5 5"/><path d="M4 12h10a6 6 0 0 1 0 12"/>',
  '⏱': '<circle cx="12" cy="13" r="7.5"/><path d="M12 9.5V13l2.5 1.5M9.5 2.5h5"/>',
  '📍': '<path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  '♥': '<path d="M12 20s-7-4.6-7-9.6A3.9 3.9 0 0 1 12 8a3.9 3.9 0 0 1 7 2.4c0 5-7 9.6-7 9.6z" fill="currentColor" stroke="none"/>',
  '★': '<path d="M12 3.5l2.7 5.5 6 .9-4.3 4.2 1 6-5.4-2.8-5.4 2.8 1-6L3.3 9.9l6-.9z" fill="currentColor" stroke="none"/>',
  '☆': '<path d="M12 3.5l2.7 5.5 6 .9-4.3 4.2 1 6-5.4-2.8-5.4 2.8 1-6L3.3 9.9l6-.9z"/>',
  '✕': '<path d="M6 6l12 12M18 6L6 18"/>',
  '●': '<circle cx="12" cy="12" r="6" fill="currentColor" stroke="none"/>',
  '＋': '<path d="M12 5v14M5 12h14"/>',
  // Sportarten
  '🥾': '<path d="M3 19l6-11 4 7 2-3 6 7z"/>',
  '🚶': '<circle cx="13" cy="4.5" r="1.8"/><path d="M13 8l-3 4 2 3 1 5M13 8l3 3 2 1M10 12l-3 7"/>',
  '🚵': '<circle cx="5.5" cy="17" r="3.5"/><circle cx="18.5" cy="17" r="3.5"/><path d="M5.5 17l4-7h5l4 7M9.5 10l3 7M14 7h3"/>',
  '🚴': '<circle cx="5.5" cy="17" r="3.5"/><circle cx="18.5" cy="17" r="3.5"/><path d="M5.5 17l4-7h5l4 7M9.5 10l3 7M14 7h3"/>',
  '⚡': '<path d="M13 2L5 14h6l-1 8 8-12h-6z"/>',
  '🏃': '<circle cx="15" cy="4.5" r="1.8"/><path d="M15 8l-4 3 1 4 2 5M11 11L7 13l-1 4M12 15l5 1"/>',
  '⛷': '<circle cx="14" cy="4.5" r="1.8"/><path d="M14 8l-2 4 3 3 1 4M3 19l18-4M9 12l-3 4"/>',
  '🧗': '<circle cx="13" cy="4.5" r="1.8"/><path d="M13 8l-3 3 1 5-2 5M13 8l4 2 2 5M10 11L6 13"/>',
};
const Ico = {
  svg(ch, size) {
    const d = ICONS[ch];
    if (!d) return '';
    const s = size || 19;
    return `<svg class="ic" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  },
};
const ICO_RE = new RegExp('^\\s*(' + Object.keys(ICONS).join('|') + ')\\uFE0F?\\s*');

function iconize() {
  document.querySelectorAll('button, a.btn, .chip, .li-i, .fab').forEach(e => {
    if (e.querySelector('svg')) return;
    const n = e.firstChild;
    if (!n || n.nodeType !== 3) return;
    const m = n.nodeValue.match(ICO_RE);
    if (!m) return;
    const big = e.classList.contains('li-i') || e.classList.contains('fab');
    n.nodeValue = n.nodeValue.slice(m[0].length);
    e.insertAdjacentHTML('afterbegin', Ico.svg(m[1], big ? 23 : 19));
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
