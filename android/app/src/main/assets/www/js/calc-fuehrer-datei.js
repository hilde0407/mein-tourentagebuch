'use strict';
/* Rechenlogik ohne Oberfläche: Wanderführer als Datei übertragen (2.13.0) – „Wanderführer exportieren“ und „Wanderführer importieren“.
   Die Datei ist JSON: Bücher mit ihren Buchtouren (Titel, Länge, Aufstieg, Dateiname, Strecke gepackt wie im Gerät), dazu je Buchtour als Auskunft, mit welchen
   eigenen Touren sie gewandert wurde (Datum und Name; beim Import wird das neu berechnet, es überschreibt nichts). Titelbilder nur, wenn man es beim Export wählt
   (es sind immer selbst gewählte Bilder; Vorgabe aus). Keine Spuren eigener Touren, keine Fotos, keine Zugangsdaten.
   Import führt zusammen, ohne zu überschreiben: neue Bücher kommen dazu, in vorhandenen Büchern (gleiche Kennung oder gleicher Name) kommen nur neue Buchtouren dazu;
   gleiche Buchtour (gleicher Titel, Länge auf 50 m gleich) zählt als schon da; gleicher Titel mit anderer Länge ist ein Konflikt und bleibt draußen.
   Läuft im Browser (globales `FuehrerDatei`) und in Node. */
(function (root) {
  const node = typeof module !== 'undefined' && module.exports;
  const Fu = node ? require('./calc-fuehrer.js') : root.Fuehrer;
  const FORMAT = 'tourentagebuch-wanderfuehrer', VERSION = 1;
  const COVER_MAX = 200000;           // Zeichen der Daten-Adresse (das Titelbild ist ≈ 400 px und meist unter 90 000)
  const MAX_BUECHER = 200, MAX_TOUREN = 500;

  const p2 = n => String(n).padStart(2, '0');
  const tag = ms => { const d = new Date(ms); return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()); };
  const norm = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().toLocaleLowerCase('de');
  const istCover = c => typeof c === 'string' && c.startsWith('data:image/jpeg;base64,') && c.length <= COVER_MAX;

  /** Die Exportdatei als Objekt. buecher: Liste aus kv „guides“; pts: { buchId: { buchtourId: gepackt } }; covers: { buchId: Daten-Adresse } (nur bei opts.mitCover);
      gewandert: { buchId: { buchtourId: [{ start, name }] } } (Auskunft, optional). */
  function exportiere(buecher, pts, covers, gewandert, opts) {
    opts = opts || {};
    const out = { format: FORMAT, version: VERSION, app: opts.app || 'Mein Tourentagebuch', erstellt: new Date(opts.now || Date.now()).toISOString(), buecher: [] };
    for (const b of buecher || []) {
      const bp = (pts && pts[b.id]) || {}, gw = (gewandert && gewandert[b.id]) || {};
      const e = { id: b.id, name: b.name, touren: [] };
      if (b.created) e.created = b.created;
      for (const t of (b.touren || []).slice().sort((x, y) => x.ord - y.ord)) {
        if (!bp[t.id]) continue;      // ohne Strecke ist die Buchtour nicht übertragbar
        const r = { id: t.id, ord: t.ord, title: t.title, km: t.km, up: t.up == null ? null : t.up, f: t.f || '', pts: bp[t.id] };
        const g = (gw[t.id] || []).filter(x => x && x.start).map(x => ({ datum: tag(x.start), name: String(x.name || '').slice(0, 200) }));
        if (g.length) r.gewandert = g;
        e.touren.push(r);
      }
      if (opts.mitCover && covers && istCover(covers[b.id])) e.cover = covers[b.id];
      out.buecher.push(e);
    }
    return out;
  }
  /** Dateiname „Tourentagebuch-Wanderfuehrer-2026-11-22.json“. */
  const dateiname = now => 'Tourentagebuch-Wanderfuehrer-' + tag(now || Date.now()) + '.json';

  /** Datei lesen und prüfen. text: Inhalt. Wirft mit verständlicher Meldung; gibt die geprüften Bücher zurück: [{ id, name, created, cover, touren: [{ title, km, up, f, pts (gepackt), punkte }] }]
      und die Zahl der Buchtouren, die nicht lesbar waren. */
  function lies(text) {
    let d;
    try { d = typeof text === 'string' ? JSON.parse(text) : text; } catch (e) { throw new Error('Die Datei ist keine Wanderführer-Datei (kein JSON).'); }
    if (!d || d.format !== FORMAT) throw new Error('Das ist keine Wanderführer-Datei von Mein Tourentagebuch.');
    if (!(d.version >= 1) || d.version > VERSION) throw new Error('Die Datei stammt aus einer neueren Version der App. Bitte die App aktualisieren.');
    if (!Array.isArray(d.buecher)) throw new Error('In der Datei stehen keine Bücher.');
    let defekt = 0;
    const buecher = [];
    for (const b of d.buecher.slice(0, MAX_BUECHER)) {
      if (!b || typeof b.name !== 'string' || !b.name.trim() || !Array.isArray(b.touren)) { defekt++; continue; }
      const touren = [];
      for (const t of b.touren.slice(0, MAX_TOUREN)) {
        const ok = t && typeof t.title === 'string' && t.title.trim() && typeof t.km === 'number' && isFinite(t.km) && t.km >= 0;
        const punkte = ok ? Fu.entpacke(t.pts).filter(p => isFinite(p.lat) && isFinite(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180) : [];
        if (!ok || punkte.length < 3) { defekt++; continue; }
        touren.push({ title: t.title.trim().slice(0, 200), km: Math.round(t.km * 1000) / 1000, up: typeof t.up === 'number' && isFinite(t.up) ? Math.round(t.up) : null, f: typeof t.f === 'string' ? t.f.slice(0, 200) : '', pts: t.pts, punkte });
      }
      buecher.push({ id: typeof b.id === 'string' && /^[\w-]{1,40}$/.test(b.id) ? b.id : null, name: b.name.trim().slice(0, 120), created: typeof b.created === 'number' ? b.created : null,
        cover: istCover(b.cover) ? b.cover : null, touren });
    }
    return { buecher, defekt, erstellt: typeof d.erstellt === 'string' ? d.erstellt : null };
  }

  const gleicheTour = (a, b) => norm(a.title) === norm(b.title) && Math.abs((a.km || 0) - (b.km || 0)) < 0.05;
  const kmText = km => (Math.round(km * 10) / 10).toFixed(1).replace('.', ',') + ' km';

  /** Was der Import täte – ohne etwas zu ändern. lokal: Bücher im Gerät; datei: Ergebnis von lies(); hatCover: { buchId: true } (Titelbilder im Gerät); neueId(): neue Buchkennung.
      Gibt { neu: [{ buch, pts }], ergaenzen: [{ id, name, touren: [meta], pts: { id: gepackt }, next }], cover: [{ id, data }], konflikte: [Text], schon, nNeu, nTouren } zurück. */
  function plane(lokal, datei, hatCover, neueId) {
    lokal = lokal || []; hatCover = hatCover || {};
    const out = { neu: [], ergaenzen: [], cover: [], konflikte: [], schon: 0, nNeu: 0, nTouren: 0 };
    const ids = new Set(lokal.map(b => b.id)), vergeben = new Set(ids);
    for (const fb of datei.buecher) {
      const lb = (fb.id && lokal.find(b => b.id === fb.id)) || lokal.find(b => norm(b.name) === norm(fb.name));
      if (!lb) {
        let id = fb.id && !vergeben.has(fb.id) ? fb.id : null;
        while (!id || vergeben.has(id)) id = neueId();
        vergeben.add(id);
        const touren = [], pts = {};
        for (const t of fb.touren) {
          if (touren.some(x => gleicheTour(x, t))) { out.schon++; continue; }
          const meta = metaVon(t, touren.length); touren.push(meta); pts[meta.id] = t.pts;
        }
        const buch = { id, name: fb.name, created: fb.created || Date.now(), next: touren.length, cover: 0, touren };
        out.neu.push({ buch, pts }); out.nNeu++; out.nTouren += touren.length;
        if (fb.cover) out.cover.push({ id, data: fb.cover });
        continue;
      }
      if (fb.id === lb.id && norm(fb.name) !== norm(lb.name)) out.konflikte.push('Buch „' + lb.name + '“ heißt in der Datei „' + fb.name + '“ – dein Name bleibt.');
      let next = Math.max(lb.next || 0, ...lb.touren.map(t => (t.ord || 0) + 1), 0);
      const neu = [], pts = {}, belegt = new Set(lb.touren.map(t => t.id));
      for (const t of fb.touren) {
        const da = lb.touren.concat(neu);
        if (da.some(x => gleicheTour(x, t))) { out.schon++; continue; }
        const gleicherName = da.find(x => norm(x.title) === norm(t.title));
        if (gleicherName) { out.konflikte.push('„' + t.title + '“ in „' + lb.name + '“: in der Datei ' + kmText(t.km) + ', bei dir ' + kmText(gleicherName.km) + ' – nicht übernommen.'); continue; }
        while (belegt.has('t' + next)) next++;
        const meta = metaVon(t, next++); belegt.add(meta.id); neu.push(meta); pts[meta.id] = t.pts;
      }
      if (neu.length) { out.ergaenzen.push({ id: lb.id, name: lb.name, touren: neu, pts, next }); out.nTouren += neu.length; }
      if (fb.cover) { if (!hatCover[lb.id] && !lb.cover) out.cover.push({ id: lb.id, data: fb.cover }); else out.konflikte.push('Titelbild von „' + lb.name + '“: deines bleibt.'); }
    }
    return out;
  }
  /** Kennzahlen einer Buchtour aus der Datei, wie Fuehrer.buchtour sie anlegt (Umrandung und Startpunkt aus der Strecke neu gerechnet). */
  function metaVon(t, ord) {
    const p = t.punkte;
    return { id: 't' + ord, ord, title: t.title, km: t.km, up: t.up, la: p[0].lat, lo: p[0].lon, bb: Fu.umrandung(p), n: p.length, f: t.f || '' };
  }
  /** Kurze Zusammenfassung für die Rückfrage. */
  function zusammenfassung(pl) {
    const t = [];
    if (pl.nNeu) t.push(pl.nNeu === 1 ? '1 neues Buch' : pl.nNeu + ' neue Bücher');
    const erg = pl.nTouren - pl.neu.reduce((a, x) => a + x.buch.touren.length, 0);
    if (erg) t.push(erg === 1 ? '1 neue Buchtour in einem vorhandenen Buch' : erg + ' neue Buchtouren in vorhandenen Büchern');
    if (pl.schon) t.push(pl.schon === 1 ? '1 Buchtour ist schon da' : pl.schon + ' Buchtouren sind schon da');
    if (pl.cover.length) t.push(pl.cover.length === 1 ? '1 Titelbild' : pl.cover.length + ' Titelbilder');
    return t.length ? t.join(' · ') : 'Nichts Neues in der Datei';
  }

  const api = { FORMAT, VERSION, COVER_MAX, exportiere, dateiname, lies, plane, metaVon, zusammenfassung, gleicheTour };
  if (node) module.exports = api; else root.FuehrerDatei = api;
})(typeof window !== 'undefined' ? window : globalThis);
