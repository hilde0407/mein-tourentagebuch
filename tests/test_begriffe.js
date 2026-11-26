'use strict';
/* 2.20.0: Wächter für den Leitfaden „Begriffe und Bedienlogik“ (docs/LEITFADEN-BEGRIFFE.md, Tabelle 1 und Regel 10).
   Liest alle Textstücke (String-Literale ohne Kommentare) aus www/js/*.js, die Texte aus index.html, strings.xml und die Java-Hülle
   und schlägt fehl, wenn ein entfallenes Wort wieder auftaucht. Interne Bezeichner (Schlüssel, IDs, Selektoren, Dateinamen) sind keine
   deutschen Wörter in Großschreibung und fallen darum nicht auf; Quelltext in Zeichenketten (istCode) wird übergangen.
   Aufruf: node tests/test_begriffe.js   (–v zeigt zusätzlich die Ausnahmen, die gegriffen haben) */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..'), WWW = path.join(ROOT, 'android/app/src/main/assets/www');
const JAVA = path.join(ROOT, 'android/app/src/main/java/de/tourentagebuch/app');

/** Textstücke aus JS/Java-Quelltext: '…', "…", `…` (Vorlagen in Teilen zwischen ${…}); Kommentare und reguläre Ausdrücke werden übersprungen. */
function stuecke(src, java) {
  const out = []; let i = 0, line = 1, prev = '';
  const n = src.length;
  const push = (s, l) => out.push({ s, line: l });
  while (i < n) {
    const c = src[i];
    if (c === '\n') { line++; i++; continue; }
    if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') { i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') line++; i++; } i += 2; continue; }
    if (c === '"' || c === "'") {
      const l0 = line; let s = ''; i++;
      while (i < n && src[i] !== c) { if (src[i] === '\\') { s += src[i + 1]; i += 2; continue; } if (src[i] === '\n') line++; s += src[i++]; }
      i++; push(s, l0); prev = 'x'; continue;
    }
    if (c === '`' && !java) {
      // Vorlage: die festen Teile als ein Stück (Platzhalter als „#“), Ausdrücke darin rekursiv
      const l0 = line; let s = ''; i++;
      while (i < n && src[i] !== '`') {
        if (src[i] === '\\') { s += src[i + 1]; i += 2; continue; }
        if (src[i] === '$' && src[i + 1] === '{') {
          let d = 1, j = i + 2; while (j < n && d) { if (src[j] === '{') d++; else if (src[j] === '}') d--; j++; }
          const inner = src.slice(i + 2, j - 1); stuecke(inner).forEach(x => push(x.s, l0 + x.line - 1));
          for (const ch of inner) if (ch === '\n') line++;
          s += '#'; i = j; continue;
        }
        if (src[i] === '\n') line++; s += src[i++];
      }
      i++; push(s, l0); prev = 'x'; continue;
    }
    if (c === '/' && !java && (/[(,=:[!&|?{};+\-*%<>~^]$/.test(prev) || /\b(return|typeof|case|in|of)$/.test(prev) || prev === '')) {
      // regulärer Ausdruck
      i++; let cls = false;
      while (i < n) { const d = src[i]; if (d === '\\') { i += 2; continue; } if (d === '[') cls = true; else if (d === ']') cls = false; else if (d === '/' && !cls) break; else if (d === '\n') break; i++; }
      i++; while (/[a-z]/.test(src[i] || '')) i++; prev = 'x'; continue;
    }
    if (!/\s/.test(c)) prev = (/[\w$]/.test(c) ? (prev.match(/[\w$]*$/) ? prev : '') + c : c).slice(-12);
    i++;
  }
  return out;
}
/** Sichtbare Texte aus HTML (zwischen Tags, title/aria-label/placeholder) */
function htmlStuecke(src) {
  const out = []; src.split('\n').forEach((l, k) => {
    l.replace(/<script[\s\S]*?<\/script>/g, '').replace(/>([^<>]+)</g, (_, t) => { if (t.trim()) out.push({ s: t, line: k + 1 }); return ''; })
      .replace(/(?:title|aria-label|placeholder|alt)="([^"]*)"/g, (_, t) => { out.push({ s: t, line: k + 1 }); return ''; });
  });
  return out;
}

/* Regeln: Wort (regulärer Ausdruck) → was stattdessen gilt. `ausser`: Textstücke, in denen das Wort eine andere, erlaubte Bedeutung hat
   (begründet). `nur`: Regel gilt nur für diese Dateien. */
const DIENST = /Strava|Zepp|Garmin|Suunto|Polar|Wahoo|Coros|Komoot|Amazfit|Mi Fitness|Google Fit|Health Connect/;
const REGELN = [
  { re: /\bAktivität(en)?\b/i, statt: 'Sportart / Tour', ausser: [
    [DIENST, 'Name des Dienstes: Strava, Zepp, Garmin … nennen ihre Einträge „Aktivitäten“'],
    [/WHO|körperliche Aktivität|Bewegung/, 'WHO-Empfehlung in der Fitness-Einordnung (körperliche Aktivität, andere Bedeutung)']] },
  { re: /\bSport\b(?![-a-zäöü])/, statt: 'Sportart' },
  { re: /\b(Tour|Touren) aufnehmen\b|\bAufnehmen\b|\bTracking\b/, statt: 'aufzeichnen (GPS)', ausser: [
    [/Foto|Video|Kamera|Panorama|Bild/, '„aufnehmen“ für Foto und Video bleibt']] },
  { re: /\bAufnahme(n)?\b(?!ort|zeit|datum)/, statt: 'Aufzeichnung (GPS); „Aufnahme“ nur für Foto/Video', ausser: [
    [/Foto|Video|Kamera|Panorama|Bild|Schnellaufnahme|Ton\b|Galerie/, 'Foto- und Videoaufnahme']] },
  { re: /\bTags\b|\bLabels?\b|\bSchlagworte(n)?\b/, statt: 'Schlagwort, Schlagwörter', ausser: [
    [/\b(des|eines|jeden|des ganzen) Tags\b/, '„des Tags“ = Genitiv von „Tag“ (Datum)']] },
  { re: /\bRekord(e|en)?\b/, statt: 'Bestwert(e)' },
  { re: /\bTraining(s)?\b|\bWorkouts?\b/, statt: 'Tour', ausser: [[/Suunto „Workouts“/, 'Suunto nennt den Export so']] },
  { re: /\bMit Plan\b|\bPläne\b|[Ii]m Plan\b|\bPlan und Ergebnis\b|\bvom Plan\b|\bzum Plan\b/, statt: 'Planung / geplante Tour, „im Soll“' },
  { re: /\bDistanz\b|\bLänge\b/, statt: 'Strecke', ausser: [[/westliche Länge|östliche Länge|Längengrad/, 'geografische Länge (andere Bedeutung)'], [/Länge des Videos/, 'Länge eines Videos (andere Bedeutung)']] },
  { re: /Höhenmeter|\bAnstieg\b|\d\s?hm\b|\shm\b/, statt: 'Aufstieg' },
  { re: /Zeit unterwegs|Stunden unterwegs|Gesamtzeit|Zeit in Bewegung/, statt: 'Dauer / Bewegungszeit' },
  { re: /Tage mit Tour/, statt: 'aktive Tage' },
  { re: /Alle Bilder hier/, statt: 'Fotos' },
  { re: /\beinlesen\b|\beingelesen\b|Jetzt einlesen|Aktivitäten laden|Tourenliste laden|GPX-Datei laden/, statt: 'holen / importieren' },
  { re: /\bSync\b|[Ss]ynchronisier/, statt: 'abgleichen', ausser: [[/Garmin-Sync|Syncthing/, 'Name einer fremden App']] },
  { re: /Höhe aus (der )?Uhr abgleichen|Höhen korrigieren/, statt: 'Höhe korrigieren' },
  { re: /Als GPX speichern|Als PDF\b(?! exportieren)/, statt: 'Als GPX/PDF exportieren' },
  { re: /\bBackups?\b|Datensicherung/, statt: 'Sicherung' },
  { re: /Seitenlayout|\bDashboard\b|\bWidgets?\b/, statt: 'Ansicht / Baustein / Start' },
  { re: /\(zusammengefasst\)|Zusammengefasst/, statt: 'Statistik-Gruppe (Anzeige: nur der Name)' },
  { re: /^ = $/, statt: 'Statistik-Gruppe: „Name = A + B + C“ nur über StatGruppen.titel() (title/aria, Editor), nie selbst zusammensetzen', nur: /www\/js\/(?!calc-statgruppen\.js)/ },
  { re: /\bFavorit\b|Favoriten(?!-Sportart)/, statt: 'Favoriten-Sportarten / Lieblingstour' },
  { re: /\bAlle Jahre\b/, statt: 'Gesamte Zeit' },
  { re: /^Alle$/, statt: 'Alle Sportarten (im Sportart-Filter)', nur: /v-start\.js|v-tours\.js|v-map\.js|v-stats\.js/ },
  { re: /^Trennen$|\bAbmelden\b|Angemeldet als/, statt: 'Verbindung trennen / Verbunden mit …' },
  { re: /^OK$|^Übernehmen$|^Anwenden$/, statt: 'Speichern / Schließen / die Handlung beim Namen', nur: /^www\// },
  { re: /gespeichert ✓|✓ gespeichert/, statt: '„… gespeichert“ ohne ✓' },
  { re: /fehlgeschlagen|hat nicht geklappt|Das hat nicht geklappt/, statt: '„<Vorgang> nicht möglich: <Grund>“' },
  { re: /Es läuft schon ein|Gerade läuft ein/, statt: '„<Vorgang> läuft schon“' },
  { re: /->/, statt: '→' },
  { re: /\.\.\./, statt: '„ …“', ausser: [[/^\.\.\.$/, 'Spread-Operator']] },
  { re: /[a-zäöüß]\((e?n|e|s|er)\)/, statt: 'Mehrzahl ausschreiben (1 Foto / 2 Fotos)' },
  { re: /Einstellungen & Sicherung|Karte aller Touren/, statt: 'Seitentitel = Name des Menüpunkts' },
];

function istText(s) { return /\s/.test(s.trim()) || /[äöüÄÖÜß„“…→–]/.test(s); }
/** Quelltext in Zeichenketten (Lesezeichen-Skript, HTML-Seite der Upload-Hülle) ist kein Benutzertext */
function istCode(s) { return /function\s*\(|<!doctype|=>|\)\{|;var |innerHTML/i.test(s); }
function dateien() {
  const out = [];
  for (const f of fs.readdirSync(path.join(WWW, 'js')).filter(f => f.endsWith('.js')).sort()) out.push(['www/js/' + f, stuecke(fs.readFileSync(path.join(WWW, 'js', f), 'utf8'))]);
  out.push(['www/index.html', htmlStuecke(fs.readFileSync(path.join(WWW, 'index.html'), 'utf8'))]);
  const xml = fs.readFileSync(path.join(ROOT, 'android/app/src/main/res/values/strings.xml'), 'utf8');
  out.push(['res/values/strings.xml', htmlStuecke(xml)]);
  for (const f of fs.readdirSync(JAVA).filter(f => f.endsWith('.java')).sort()) out.push(['java/' + f, stuecke(fs.readFileSync(path.join(JAVA, f), 'utf8'), true)]);
  return out;
}

const fehler = [], ausnahmen = [];
let gezaehlt = 0;
for (const [datei, liste] of dateien()) {
  for (const { s, line } of liste) {
    if (istCode(s)) continue;
    if (istText(s)) gezaehlt++;
    for (const r of REGELN) {
      if (r.nur && !r.nur.test(datei)) continue;
      if (!r.re.test(s)) continue;
      const a = (r.ausser || []).find(([re]) => re.test(s));
      if (a) { ausnahmen.push(`${datei}:${line}  „${s.trim().slice(0, 90)}“ – ${a[1]}`); continue; }
      fehler.push(`${datei}:${line}  „${s.trim().slice(0, 110)}“  → ${r.statt}`);
    }
  }
}
/* Regel 10, Symbole: Tagebuch zeigt an Knöpfen SVG-Symbole. Ein Textstück, das mit einem Bildzeichen beginnt, muss darum eines sein,
   das icons.js (ICON_CHARS) in ein Liniensymbol umsetzt – sonst stünde ein buntes Emoji im Knopf. */
{
  const ico = fs.readFileSync(path.join(WWW, 'js/icons.js'), 'utf8');
  const zeichen = [...ico.match(/const ICON_CHARS = \{([\s\S]*?)\n\};/)[1].matchAll(/'([^']+)':/g)].map(x => x[1]);
  for (const f of fs.readdirSync(path.join(WWW, 'js')).filter(f => f.endsWith('.js') && f !== 'icons.js')) {
    for (const { s, line } of stuecke(fs.readFileSync(path.join(WWW, 'js', f), 'utf8'))) {
      const m = s.match(/^\s*(\p{Extended_Pictographic})/u);
      if (!m || m[1] === '©' || m[1] === '®') continue;
      const c = m[1].replace(/\ufe0f/g, '');
      if (!zeichen.some(k => k.startsWith(c))) fehler.push(`www/js/${f}:${line}  „${s.trim().slice(0, 60)}“  → Bildzeichen ohne Liniensymbol (icons.js ICON_CHARS ergänzen)`);
    }
  }
}
/* 2.20.1: Statistik-Gruppe in Anzeigen nur mit Namen; die volle Schreibweise nur als titel() (title/aria-label, Editor) */
{
  const SGt = require(path.join(WWW, 'js/calc-statgruppen.js')), G = [{ id: 'w', name: 'Wandern (gesamt)', sports: ['hike', 'mountaineering', 'snowshoe', 'walk'] }];
  if (SGt.beschriftung('sgrp:w', G) !== 'Wandern (gesamt)') fehler.push('StatGruppen.beschriftung liefert nicht nur den Namen: ' + SGt.beschriftung('sgrp:w', G));
  if (!/^Wandern \(gesamt\) = .+ \+ .+ \+ .+ \+ /.test(SGt.titel('sgrp:w', G))) fehler.push('StatGruppen.titel liefert nicht die volle Zusammensetzung: ' + SGt.titel('sgrp:w', G));
  if (/ = | \+ /.test(SGt.auswahl(G)[0][1]) || /\+/.test(SGt.chipAuswahl(['hike'], G).gruppen[0].label)) fehler.push('Auswahl/Chips zeigen die Zusammensetzung statt des Namens');
}
if (process.argv.includes('-v')) console.log('Ausnahmen:\n' + ausnahmen.join('\n'));
if (gezaehlt < 3000) { console.error('Zu wenige Textstücke gefunden (' + gezaehlt + ') – Leser kaputt?'); process.exit(1); }
if (fehler.length) {
  console.error(fehler.length + ' Textstücke widersprechen docs/LEITFADEN-BEGRIFFE.md:\n' + fehler.join('\n'));
  process.exit(1);
}
console.log('OK – ' + gezaehlt + ' Textstücke geprüft, ' + ausnahmen.length + ' begründete Ausnahmen');
