'use strict';
/* Rechenlogik ohne Oberfläche für den Abgleich von Notizen, Fotos und Videos mit Meine Touren (2.18.0). Netz und Oberfläche: js/abgleich-medien.js.
   Server-Seite: Meine Touren 3.57.0 (GET /api/tours/{id}/tagebuch, POST /api/tours/{id}/notiz, …/photo, …/video).

   Notiz – es geht nie etwas verloren, ein leerer Text löscht nie:
     Senden  = Regel des Servers (serverMerge, gleiche Fälle wie notiz_merge in tagebuch_abgleich.py): Server-Text, Leerzeile,
               „——— Aus Mein Tourentagebuch, TT.MM.JJJJ hh:mm ———“, Text der App – außer der Server hat seit dem letzten Abgleich nichts geändert
               (basis = Stempel „geaendert“) oder ein Text enthält den anderen vollständig.
     Holen   = dieselbe Regel spiegelbildlich (holenMerge): Text der App, Leerzeile, „——— Aus Meine Touren, TT.MM.JJJJ hh:mm ———“, Server-Text –
               außer die Notiz der App ist seit dem letzten Abgleich unverändert (dann gilt der Server-Text) oder ein Text enthält den anderen.
     Beides  = senden, danach gilt hier die Notiz, die der Server zurückgibt (sie enthält den Text der App immer vollständig).
   Gemerkt wird je Tour: noteMt (Text der App beim letzten Abgleich, auch von „Aus Meine Touren holen“ gesetzt), mtNotizBasis (Stempel „geaendert“ des Servers),
   mtStand (Kennzahl „stand“ der Übersicht). Je Foto: mtPid (Foto-Kennung in Meine Touren), mtGeloescht (Server meldete „in Meine Touren gelöscht“).
   Läuft im Browser (globales `MedienCalc`) und in Node (tests/test_calc.js). */
(function (root) {
  const NOTIZ_MAX = 20000;                     // Zeichen, wie NOTIZ_MAX des Servers
  const VIDEO_MAX = 200 * 1024 * 1024;         // Bytes je Video (Server: VIDEO_MAX)
  const VIDEO_TOUR_MAX = 1024 * 1024 * 1024;   // Bytes aller Videos einer Tour (Server: VIDEO_TOUR_MAX)
  const FOTO_PX = 2200;                        // Fotos beim Senden höchstens so groß (der Server speichert ebenfalls 2200 px)
  const HOLEN_PX = 1600;                       // Fotos beim Holen (w=1600)
  const SEK = 2000;                            // „gleiche Aufnahmezeit“: ± 2 s wie am Server
  const WLAN_AB = 20 * 1024 * 1024;            // ab dieser Datenmenge (Fotos) gilt „Nur über WLAN“; Videos immer

  /* ---------------- Notiz ---------------- */
  /** Wie _norm des Servers: Zeilenenden zu \n, Leerzeichen vor Zeilenende weg, außen getrimmt. */
  function norm(s) { return String(s == null ? '' : s).replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/[ \t]+\n/g, '\n').trim(); }
  /** Länge in Zeichen wie am Server (Python zählt Codepunkte: ein Emoji ist ein Zeichen, in JavaScript sind es zwei). */
  const laenge = s => { let n = 0; for (const _ of String(s || '')) n++; return n; };
  const zwei = n => (n < 10 ? '0' : '') + n;
  function datum(ms) { const d = new Date(ms); return zwei(d.getDate()) + '.' + zwei(d.getMonth() + 1) + '.' + d.getFullYear() + ' ' + zwei(d.getHours()) + ':' + zwei(d.getMinutes()); }
  /** Trennzeile beim Zusammenführen. quelle: 'Mein Tourentagebuch' (beim Senden, so schreibt es der Server) oder 'Meine Touren' (beim Holen). */
  function trennzeile(ms, quelle) { return '——— Aus ' + (quelle || 'Mein Tourentagebuch') + ', ' + datum(ms == null ? Date.now() : ms) + ' ———'; }

  /** Regel des Servers für POST /notiz. Gibt { status, text } zurück; text = Notiz am Server danach. */
  function serverMerge(cur, curTs, neu, basis, when) {
    cur = norm(cur); neu = norm(neu);
    if (!neu) return { status: 'leer', text: cur };
    if (neu === cur) return { status: 'gleich', text: cur };
    if (!cur) return { status: 'uebernommen', text: neu };
    if (basis != null && curTs != null && +basis === +curTs) return { status: 'uebernommen', text: neu };
    if (cur.includes(neu)) return { status: 'schon_enthalten', text: cur };
    if (neu.includes(cur)) return { status: 'uebernommen', text: neu };
    return { status: 'zusammengefuehrt', text: cur + '\n\n' + trennzeile(when, 'Mein Tourentagebuch') + '\n' + neu };
  }
  /** Holen: Server-Text in die Notiz der App. lokalUnveraendert: die Notiz der App ist seit dem letzten Abgleich nicht geändert worden. */
  function holenMerge(lokal, server, lokalUnveraendert, when) {
    const L = norm(lokal), S = norm(server);
    if (!S) return { status: 'leer', text: L };
    if (S === L) return { status: 'gleich', text: L };
    if (!L || lokalUnveraendert) return { status: 'uebernommen', text: S };
    if (S.includes(L)) return { status: 'uebernommen', text: S };
    if (L.includes(S)) return { status: 'schon_enthalten', text: L };
    return { status: 'zusammengefuehrt', text: L + '\n\n' + trennzeile(when, 'Meine Touren') + '\n' + S };
  }

  /** Lage der Notiz einer Tour. t: Tour der App (note, noteMt, mtNotizBasis); r: notiz aus GET /tagebuch ({ text, geaendert }).
      Gibt { fall, vorschlag, hier, dort, senden, holen, beides, zuLang } zurück.
      fall: 'gleich' | 'nurHier' | 'nurDort' | 'hierNeu' (nur hier geändert) | 'dortNeu' (nur dort geändert) | 'beide' (beide verschieden).
      senden/holen/beides: { hier, dort, status } = Notiz hier bzw. dort danach (Vorschau); zuLang: Liste der Wege, die über 20 000 Zeichen kämen. */
  function notizLage(t, r, when) {
    const L = norm(t && t.note), R = norm(r && r.text), rts = r && r.geaendert != null ? +r.geaendert : null;
    const basis = t && t.mtNotizBasis != null ? +t.mtNotizBasis : null;
    const hierGeaendert = !(t && t.noteMt != null) || norm(t.noteMt) !== L;
    const dortGeaendert = basis == null || rts == null || rts !== basis;
    let fall, vorschlag;
    if (L === R) { fall = 'gleich'; vorschlag = 'nichts'; }
    else if (!R) { fall = 'nurHier'; vorschlag = 'senden'; }
    else if (!L) { fall = 'nurDort'; vorschlag = 'holen'; }
    else if (!hierGeaendert && dortGeaendert) { fall = 'dortNeu'; vorschlag = 'holen'; }
    else if (hierGeaendert && !dortGeaendert) { fall = 'hierNeu'; vorschlag = 'senden'; }
    else { fall = 'beide'; vorschlag = R.includes(L) ? 'holen' : L.includes(R) ? 'senden' : 'beides'; }
    const s = serverMerge(R, rts, L, basis, when);
    const ho = holenMerge(L, R, !hierGeaendert, when);
    const out = { fall, vorschlag, hier: L, dort: R, hierGeaendert, dortGeaendert,
      senden: { hier: L, dort: s.text, status: s.status },
      holen: { hier: ho.text, dort: R, status: ho.status },
      beides: { hier: s.status === 'leer' ? R : s.text, dort: s.text, status: s.status } };
    out.zuLang = ['senden', 'holen', 'beides'].filter(k => laenge(out[k].hier) > NOTIZ_MAX || laenge(out[k].dort) > NOTIZ_MAX || (k !== 'holen' && laenge(L) > NOTIZ_MAX));
    return out;
  }
  /** Kurztext zur Lage („Nur hier“, „Beide verschieden“ …). an: Meine Touren nennen (bei Aus wird nichts davon gezeigt). */
  function notizText(l) {
    return { gleich: 'Gleich – nichts zu tun', nurHier: 'Notiz nur hier', nurDort: 'Notiz nur in Meine Touren', hierNeu: 'Hier geändert', dortNeu: 'In Meine Touren geändert', beide: 'Beide verschieden' }[l.fall] || '';
  }

  /* ---------------- Fotos und Videos ---------------- */
  const grund = n => String(n || '').replace(/^.*[\\/]/, '').replace(/\.[a-z0-9]{2,5}$/i, '').replace(/(\s*\(\d+\)|\s*-\s*kopie)$/i, '').trim().toLowerCase();
  /** Gleiche Aufnahme? Gleiche Zeit (± 2 s); haben beide einen Namen (nicht nur die Kennung), muss er passen. */
  function gleicheAufnahme(p, r) {
    if (!(p.ts > 0) || !(r.taken_ts > 0)) return false;
    if (Math.abs(p.ts - r.taken_ts * 1000) > SEK) return false;
    const a = grund(p.name), b = grund(r.name);
    if (a && b && a !== String(p.id).toLowerCase() && a !== b) return false;
    return !!p.video === !!r.video;
  }
  /** Schätzung der Datenmenge eines Fotos beim Holen (w=1600) bzw. Senden (≤ 2200 px). */
  const schaetzHolen = r => Math.min(+r.size || 700000, 900000);
  const schaetzSenden = p => Math.min(+p.size || 1200000, p.w > FOTO_PX || p.h > FOTO_PX ? 1300000 : 2500000);

  /** Plan für eine Tour. lokal: Fotos/Videos der Tour in der App; r: Antwort von GET /tagebuch. o: { videos (einbeziehen), force (gelöschte trotzdem senden) }.
      Gibt { holen, senden, vorhanden, geloescht, dortGeloescht, videosHolen, videosSenden, videosZuGross, bytes… } zurück. */
  function fotoPlan(lokal, r, o) {
    o = o || {};
    const rf = (r && r.fotos) || [], rv = (r && r.videos) || [];
    const ids = new Set((lokal || []).map(p => p.id)), pids = new Set((lokal || []).filter(p => p.mtPid != null).map(p => (p.video ? 'v' : 'f') + p.mtPid));
    const refs = new Set(rf.concat(rv).map(x => x.ref).filter(Boolean)), rfIds = new Set(rf.map(x => 'f' + x.id)), rvIds = new Set(rv.map(x => 'v' + x.id));
    const res = { holen: [], senden: [], vorhanden: 0, geloescht: [], dortGeloescht: [], videosHolen: [], videosSenden: [], videosZuGross: [], videosVorhanden: 0,
      bytesHolen: 0, bytesSenden: 0, videoBytesHolen: 0, videoBytesSenden: 0, darfSchreiben: !(r && r.darf_schreiben === false) };
    const lokalFotos = (lokal || []).filter(p => !p.video), lokalVideos = (lokal || []).filter(p => p.video);
    for (const x of rf) {
      if ((x.ref && ids.has(x.ref)) || pids.has('f' + x.id) || lokalFotos.some(p => gleicheAufnahme(p, x))) { res.vorhanden++; continue; }
      res.holen.push(x); res.bytesHolen += schaetzHolen(x);
    }
    for (const p of lokalFotos) {
      if (refs.has(p.id) || (p.mtPid != null && rfIds.has('f' + p.mtPid)) || rf.some(x => gleicheAufnahme(p, x))) continue;      // dort schon gezählt
      if (p.mtPid != null) { res.dortGeloescht.push(p); continue; }      // kam von dort oder war dort – fehlt jetzt: in Meine Touren gelöscht
      if (p.mtGeloescht && !o.force) { res.geloescht.push(p); continue; }
      res.senden.push(p); res.bytesSenden += schaetzSenden(p);
    }
    let belegt = rv.reduce((s, x) => s + (+x.size || 0), 0);
    for (const x of rv) {
      if ((x.ref && ids.has(x.ref)) || pids.has('v' + x.id) || lokalVideos.some(p => gleicheAufnahme(p, x))) { res.videosVorhanden++; continue; }
      if (+x.size > VIDEO_MAX) { res.videosZuGross.push(Object.assign({ wo: 'dort' }, x)); continue; }
      res.videosHolen.push(x); res.videoBytesHolen += +x.size || 0;
    }
    for (const p of lokalVideos) {
      if (refs.has(p.id) || (p.mtPid != null && rvIds.has('v' + p.mtPid)) || rv.some(x => gleicheAufnahme(p, x))) continue;
      if (p.mtPid != null) { res.dortGeloescht.push(p); continue; }
      const sz = +p.size || 0;
      if (sz > VIDEO_MAX || (sz && belegt + sz > VIDEO_TOUR_MAX)) { res.videosZuGross.push(Object.assign({ wo: 'hier' }, p)); continue; }
      belegt += sz; res.videosSenden.push(p); res.videoBytesSenden += sz;
    }
    if (!o.videos) { res.videosHolenAus = res.videosHolen.length; res.videosSendenAus = res.videosSenden.length; }
    return res;
  }
  /** Was bei einer Wahl übertragen wird. wahl: 'holen' | 'senden' | 'beides' | 'nichts'. */
  function auswahl(plan, wahl, o) {
    o = o || {};
    const h = wahl === 'holen' || wahl === 'beides', s = (wahl === 'senden' || wahl === 'beides') && plan.darfSchreiben;
    const out = { holen: h ? plan.holen : [], senden: s ? plan.senden : [], videosHolen: h && o.videos ? plan.videosHolen : [], videosSenden: s && o.videos ? plan.videosSenden : [] };
    out.bytes = out.holen.reduce((a, x) => a + schaetzHolen(x), 0) + out.senden.reduce((a, p) => a + schaetzSenden(p), 0);
    out.videoBytes = out.videosHolen.reduce((a, x) => a + (+x.size || 0), 0) + out.videosSenden.reduce((a, p) => a + (+p.size || 0), 0);
    out.n = out.holen.length + out.senden.length + out.videosHolen.length + out.videosSenden.length;
    out.wlan = out.videoBytes > 0 || out.bytes >= WLAN_AB;      // „Nur über WLAN“ greift bei Videos immer, bei Fotos ab 20 MB
    return out;
  }
  /** Größe in Worten (deutsch): „0,4 MB“, „12 MB“, „1,2 GB“. */
  function mb(b) {
    b = +b || 0;
    if (b >= 1024 * 1024 * 1024) return (Math.round(b / 1073741824 * 10) / 10).toString().replace('.', ',') + ' GB';
    const m = b / 1048576;
    return (m < 10 ? (Math.round(m * 10) / 10).toString().replace('.', ',') : String(Math.round(m))) + ' MB';
  }
  /** „3 neue Fotos dort · 2 neue hier · 5 schon vorhanden“ */
  function fotoText(plan) {
    const f = n => n + (n === 1 ? ' neues Foto' : ' neue Fotos');
    return f(plan.holen.length) + ' dort · ' + plan.senden.length + ' neu hier · ' + plan.vorhanden + ' schon vorhanden';
  }
  /** Bestätigungstext für Videos: „2 Videos bis 180 MB, nur im WLAN“. */
  function videoFrage(liste) {
    const max = (liste || []).reduce((a, x) => Math.max(a, +x.size || 0), 0), sum = (liste || []).reduce((a, x) => a + (+x.size || 0), 0);
    const n = (liste || []).length;
    return n + (n === 1 ? ' Video' : ' Videos') + ' bis ' + mb(max) + ', zusammen ' + mb(sum) + ', nur im WLAN';
  }
  /** Antwort von POST /photo bzw. /video zählen. z: { neu, vorhanden, geloescht, fehler }. */
  function zaehle(z, antwort) {
    z = z || { neu: 0, vorhanden: 0, geloescht: 0, fehler: 0 };
    const st = antwort && antwort.status;
    if (st === 'neu') z.neu++; else if (st === 'vorhanden') z.vorhanden++; else if (st === 'geloescht') z.geloescht++; else z.fehler++;
    return z;
  }
  /** Ergebnis in Worten. e: { notiz (status), holen, gesendet: z, videos: z, fehler: [text], stopped } */
  function ergebnisText(e) {
    const p = [];
    const nt = { uebernommen: 'Notiz übernommen', zusammengefuehrt: 'Notizen zusammengeführt', gleich: 'Notiz war gleich', schon_enthalten: 'Notiz war schon enthalten', leer: null, geholt: 'Notiz geholt' };
    if (e.notiz && nt[e.notiz]) p.push(nt[e.notiz]);
    if (e.holen) p.push(e.holen + (e.holen === 1 ? ' Foto geholt' : ' Fotos geholt'));
    if (e.uebersprungen) p.push(e.uebersprungen + ' schon vorhanden');
    const g = e.gesendet;
    if (g && (g.neu || g.vorhanden || g.geloescht)) {
      if (g.neu) p.push(g.neu + (g.neu === 1 ? ' Foto gesendet' : ' Fotos gesendet'));
      if (g.vorhanden) p.push(g.vorhanden + ' waren dort schon');
      if (g.geloescht) p.push(g.geloescht + ' dort gelöscht – nicht wieder aufgenommen');
    }
    if (e.videos) p.push(e.videos + (e.videos === 1 ? ' Video übertragen' : ' Videos übertragen'));
    if (e.fehler && e.fehler.length) p.push(e.fehler.length + ' nicht übertragen: ' + e.fehler[0]);
    if (e.stopped) p.push('abgebrochen – der Rest bleibt, wie er war');
    return p.join(' · ') || 'Nichts zu tun – alles ist gleich';
  }
  /** Muss für diese Tour GET /tagebuch abgerufen werden? Nein, wenn der Stand am Server gleich ist, alle Fotos verknüpft sind und die Notiz hier unverändert. */
  function brauchtAbruf(t, ueb, lokal, o) {
    if (!ueb) return false;                                     // Tour am Server unbekannt
    if (t.mtStand == null || t.mtStand !== ueb.stand) return true;
    if (norm(t.note) !== norm(t.noteMt == null ? '' : t.noteMt)) return true;
    return (lokal || []).some(p => p.mtPid == null && !p.mtGeloescht && (!p.video || (o && o.videos)));
  }
  /** Kennung der Tour in Meine Touren (mtId oder srcId „mt:<id>“), sonst null. */
  function mtId(t) { if (!t) return null; if (t.mtId) return String(t.mtId); const m = /^mt:(.+)$/.exec(t.srcId || ''); return m ? m[1] : null; }
  /** Zeitzone als „+02:00“ für eine Aufnahmezeit (ms) in der Zeitzone des Geräts. */
  function offset(ms) { const m = -new Date(ms).getTimezoneOffset(), a = Math.abs(m); return (m < 0 ? '-' : '+') + zwei(Math.floor(a / 60)) + ':' + zwei(a % 60); }
  /** Felder für POST /photo bzw. /video (ohne Datei). force nur auf ausdrücklichen Wunsch. */
  function sendeFelder(p, force) {
    const f = { ref: String(p.id), name: String(p.name || (p.id + (p.video ? '.mp4' : '.jpg'))).slice(0, 120) };
    if (p.ts > 0) { f.taken = String(Math.round(p.ts)); if (!p.video) f.offset = offset(p.ts); }
    if (p.lat != null && p.lon != null && isFinite(p.lat) && isFinite(p.lon)) { f.lat = String(p.lat); f.lng = String(p.lon); }
    if (p.video) { f.bestaetigt = '1'; if (p.dur > 0) f.dur_ms = String(Math.round(p.dur)); }
    else if (force) f.force = '1';
    return f;
  }

  /* ---------------- 2.18.1: Auftrag für die Hülle ---------------- */
  /** Schritte für den Abgleich in der Hülle (MtAbgleich.java), in dieser Reihenfolge je Tour: Notiz senden, Fotos holen, Fotos senden, Videos, Stand lesen.
      items: [{ t (Tour der App: id, name, note, mtNotizBasis), id (Kennung in Meine Touren), notiz ('senden'|'beides'|sonst nichts), a (auswahl()), force, r (GET /tagebuch),
               stand (Stand auch ohne andere Schritte lesen, z. B. nach „Notiz holen“) }].
      Notiz holen braucht kein Netz und gehört nicht hierher (macht die Oberfläche sofort). Jeder Schritt trägt, was die Oberfläche zum Übernehmen braucht
      (tour, mt, pid …); das Sitzungs-Cookie steht nicht darin. */
  function auftrag(items, base) {
    const out = [], enc = encodeURIComponent;
    for (const it of items || []) {
      const pfad = rest => base + '/api/tours/' + enc(it.id) + rest, c = { tour: it.t.id, mt: String(it.id), tname: String(it.t.name || '') }, a = it.a || {};
      if (it.notiz === 'senden' || it.notiz === 'beides') {
        const L = norm(it.t.note);
        if (L) out.push(Object.assign({ art: 'notiz', url: pfad('/notiz'), body: JSON.stringify({ text: L, basis: it.t.mtNotizBasis != null ? it.t.mtNotizBasis : null }), L, beides: it.notiz === 'beides' }, c));
      }
      for (const x of a.holen || []) out.push(Object.assign({ art: 'foto-holen', url: pfad('/tagebuch/photo/' + enc(x.id) + '?w=' + HOLEN_PX + (x.v ? '&v=' + enc(x.v) : '')),
        name: x.name || ('MeineTouren_' + x.id + '.jpg'), taken: x.taken_ts ? x.taken_ts * 1000 : 0, lat: x.lat, lng: x.lng, pid: x.id }, c));
      for (const p of a.senden || []) out.push(Object.assign({ art: 'foto-senden', url: pfad('/photo'), id: p.id, fields: sendeFelder(p, !!(it.force && p.mtGeloescht)), maxPx: FOTO_PX }, c));
      for (const x of a.videosHolen || []) out.push(Object.assign({ art: 'video-holen', url: pfad('/tagebuch/video/' + enc(x.id) + '?video=1'), key: it.id + '_' + x.id + '_' + (x.v || ''),
        name: x.name || 'Video.mp4', taken: x.taken_ts ? x.taken_ts * 1000 : 0, lat: x.lat, lng: x.lng, size: x.size || 0, pid: x.id }, c));
      const used = ((it.r && it.r.videos) || []).reduce((s, v) => s + (+v.size || 0), 0);
      for (const p of a.videosSenden || []) out.push(Object.assign({ art: 'video-senden', url: pfad('/video'), id: p.id, fields: sendeFelder(p, false), used }, c));
      if ((out.length && out[out.length - 1].mt === c.mt) || it.stand) out.push(Object.assign({ art: 'stand', url: base + '/api/tagebuch/uebersicht?ids=' + enc(it.id) }, c));
    }
    return out;
  }
  /** Stand der Hülle → lässt sich der Auftrag fortsetzen? (vom System beendet oder zu lange ohne WLAN, noch nicht alles erledigt) */
  function fortsetzbar(st) { return !!(st && st.da && !st.running && (st.ende == null || st.ende === 'wlan') && +st.fertig < +st.n); }

  const api = { NOTIZ_MAX, laenge, VIDEO_MAX, VIDEO_TOUR_MAX, FOTO_PX, HOLEN_PX, WLAN_AB, norm, trennzeile, datum, serverMerge, holenMerge, notizLage, notizText,
    gleicheAufnahme, fotoPlan, auswahl, mb, fotoText, videoFrage, zaehle, ergebnisText, brauchtAbruf, mtId, offset, sendeFelder, auftrag, fortsetzbar };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.MedienCalc = api;
})(typeof window !== 'undefined' ? window : globalThis);
