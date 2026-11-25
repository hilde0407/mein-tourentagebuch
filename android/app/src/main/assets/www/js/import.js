'use strict';
/* Import aus Dateien und Diensten (Komoot, Strava, Zepp/Amazfit, Dateien, Link, Ordner). */
const Import = {
  /** Gemeinsamer Abschluss: parst Daten und speichert alle Aktivitäten. */
  async fromData(name, data, src, extra) {
    const acts = await Parse.any(name, data);
    const res = { added: 0, dup: 0, fail: 0 };
    if (!acts.length) { res.fail = 1; return res; }
    for (const a of acts) {
      try {
        const pts = extra && extra.ohneZeit ? a.pts.map(p => Object.assign({}, p, { t: null })) : a.pts;      // Geplantes hat keine Zeiten (wie im Planer)
        const r = await Tours.add(Object.assign({ name: a.name, sport: a.sport, tags: a.tags, pts, src }, extra || {}));
        if (r.dup) res.dup++; else res.added++;
      } catch (e) { res.fail++; }
    }
    return res;
  },
  sum(a, b) { return { added: a.added + b.added, dup: a.dup + b.dup, fail: a.fail + b.fail }; },
  describe(r) {
    const p = [];
    if (r.added) p.push(r.added + (r.added === 1 ? ' Tour importiert' : ' Touren importiert'));
    if (r.dup) p.push(r.dup + ' schon vorhanden');
    if (r.hr) p.push('Puls bei ' + r.hr + (r.hr === 1 ? ' Tour ergänzt' : ' Touren ergänzt'));
    if (r.names) p.push('Name bei ' + r.names + (r.names === 1 ? ' Tour' : ' Touren') + ' von Komoot übernommen');
    if (r.namesMt) p.push('Name bei ' + r.namesMt + (r.namesMt === 1 ? ' Tour' : ' Touren') + ' übernommen');
    if (r.zahlen) p.push('Zahlen bei ' + r.zahlen + (r.zahlen === 1 ? ' Tour' : ' Touren') + ' angeglichen');
    if (r.eleUhr) p.push('Höhen bei ' + r.eleUhr + (r.eleUhr === 1 ? ' Tour' : ' Touren') + ' von der Uhr übernommen');
    if (r.ohne) p.push(r.ohne + ' ohne Strecke auf dem Server');
    if (r.nurApp) p.push(r.nurApp + (r.nurApp === 1 ? ' Tour' : ' Touren') + ' nur in der App');
    if (r.fail) p.push(r.fail + ' nicht lesbar');
    if (r.stopped) p.push('abgebrochen – der Rest kommt beim nächsten Mal');
    return p.join(' · ') || 'Nichts gefunden';
  },
  async fetchBuf(url) { const r = await fetch(url); if (!r.ok) throw new Error('Datei nicht lesbar'); return new Uint8Array(await r.arrayBuffer()); },

  /** Dateien über den Android-Auswahldialog. */
  async pickFiles(onProgress) {
    const files = await Native.json('pickFiles');
    return Import.cacheFiles(files, onProgress);
  },
  async cacheFiles(files, onProgress, extra) {
    let tot = { added: 0, dup: 0, fail: 0 };
    for (let i = 0; i < files.length; i++) {
      if (onProgress) onProgress(i + 1, files.length, files[i].name);
      try {
        const buf = await Import.fetchBuf(files[i].url);
        tot = Import.sum(tot, await Import.fromData(files[i].name, buf, extra && extra.src || 'file', extra));
      } catch (e) { tot.fail++; }
    }
    try { await Native.call('clearCache'); } catch (e) { /* egal */ }
    await Photos.assignAll();
    return tot;
  },
  /** Link auf eine GPX-/FIT-Datei. */
  async fromUrl(url) {
    const r = await Native.http({ url, bin: true });
    if (r.status >= 400) throw new Error('Link nicht abrufbar (HTTP ' + r.status + ')');
    const bin = atob(r.b64 || btoa(unescape(encodeURIComponent(r.body || ''))));
    const u8 = Uint8Array.from(bin, c => c.charCodeAt(0));
    const res = await Import.fromData(url.split('/').pop().split('?')[0] || 'link.gpx', u8, 'link');
    await Photos.assignAll();
    return res;
  },

  /* ---------------- Komoot ---------------- */
  Komoot: {
    base: 'https://api.komoot.de',
    auth: (u, p) => ({ Authorization: 'Basic ' + btoa(unescape(encodeURIComponent(u + ':' + p))) }),
    async login(email, pass) {
      const r = await Native.http({ url: Import.Komoot.base + '/v006/account/email/' + encodeURIComponent(email) + '/', headers: Import.Komoot.auth(email, pass) });
      if (r.status === 401) throw new Error('Komoot hat die Anmeldung abgelehnt (E-Mail oder Passwort falsch?)');
      if (r.status !== 200) throw new Error('Komoot-Anmeldung fehlgeschlagen (HTTP ' + r.status + ')');
      const j = JSON.parse(r.body);
      const acc = { user: String(j.username), token: j.password, email };
      await DB.kvSet('komoot', acc);
      return acc;
    },
    async tours(acc, type) {
      const out = []; let page = 0;
      for (;;) {
        const r = await Native.http({ url: `${Import.Komoot.base}/v007/users/${acc.user}/tours/?type=${type}&limit=100&page=${page}&sort_field=date&sort_direction=desc`, headers: Import.Komoot.auth(acc.user, acc.token) });
        if (r.status !== 200) throw new Error('Tourenliste: HTTP ' + r.status);
        const j = JSON.parse(r.body);
        ((j._embedded || {}).tours || []).forEach(t => out.push(t));
        page++;
        if (page >= ((j.page || {}).totalPages || 1)) break;
      }
      return out;
    },
    async coords(acc, id) {
      for (const u of [`/v007/tours/${id}/coordinates`, `/v007/tours/${id}?_embedded=coordinates`]) {
        const r = await Native.http({ url: Import.Komoot.base + u, headers: Import.Komoot.auth(acc.user, acc.token) });
        if (r.status !== 200) continue;
        const j = JSON.parse(r.body);
        const items = j.items || (((j._embedded || {}).coordinates || {}).items);
        if (items && items.length) return items;
      }
      return [];
    },
    /** Ist der Name einer Tour selbst erzeugt („Wandern am Mittag · 19.11.26“, auch mit früherer Sportart) oder leer? */
    autoNamed(e) {
      if (!e.name || !e.name.trim()) return true;
      if (e.name === Tours.autoName(e.sport, e.start) || (e.sportAlt && e.name === Tours.autoName(e.sportAlt, e.start))) return true;
      const esc = x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp('^(' + Sports.list.map(x => esc(x[1])).concat(['Ski & Schnee', 'Tourenrad', 'Spazieren', 'Schneeschuh', 'Klettern'].map(esc))      /* 2.19.0: frühere Namen („Tourenrad“ heißt jetzt „Radtour“, „Spazieren“ jetzt „Spazieren / Gehen“ …) */.join('|') + ')( (am Morgen|am Mittag|am Nachmittag|am Abend) · .*)?$').test(e.name.trim());
    },
    /** Namen von Komoot übernehmen (2.0.4): nur wenn der bisherige Name selbst erzeugt ist oder noch der zuletzt von Komoot übernommene –
        ein in der App von Hand vergebener Name bleibt. Gibt true zurück, wenn sich der Name geändert hat. */
    takeName(e, kname) {
      kname = (kname || '').trim();
      if (!kname) return false;
      const vonMt = e.nameMt != null && e.name === e.nameMt;      // 2.1.0: ein Name aus „Meine Touren“ hat Vorrang vor Komoot (er zieht über den Abgleich mit Meine Touren nach)
      const frei = !vonMt && (Import.Komoot.autoNamed(e) || (e.nameKomoot != null && e.name === e.nameKomoot));
      const alt = e.name;
      if (frei) e.name = kname;
      if (frei || e.name === kname) e.nameKomoot = kname;
      return e.name !== alt;
    },
    /** Gehört ein Komoot-Eintrag (aus der Tourenliste, ohne Spur) zu einer vorhandenen Tour aus anderer Quelle (Zepp, Datei, Aufzeichnung)?
        Gleicher Start (± 5 Minuten) und, wo beide eine Strecke haben, ähnliche Länge (± 10 %, mindestens 300 m). */
    match(t, tours) {
      const st = t.date ? Date.parse(t.date) : NaN, dist = +t.distance || 0;
      if (!isFinite(st)) return null;
      let best = null, bd = Infinity;
      for (const e of tours) {
        if (e.status === 'planned' || !e.start || e.timed === false || /^komoot:/.test(e.srcId || '')) continue;
        if (e.komootId && e.komootId !== String(t.id)) continue;
        const d = Math.abs(e.start - st);
        if (d > 300000) continue;
        if (dist && e.dist && Math.abs(e.dist - dist) > Math.max(300, 0.1 * dist)) continue;
        if (d < bd) { best = e; bd = d; }
      }
      return best;
    },
    /** Alle neuen Touren holen; onProgress(i, n, name). Vorhandene Touren (auch aus Zepp, Dateien oder eigener Aufzeichnung) bekommen den Komoot-Namen. */
    async importAll(acc, opts, onProgress) {
      const types = opts.planned ? ['tour_recorded', 'tour_planned'] : ['tour_recorded'];
      let list = [];
      for (const ty of types) (await Import.Komoot.tours(acc, ty)).forEach(t => list.push([t, ty]));
      const mine = await Tours.list();
      const mineK = new Map(mine.map(t => [t.srcId, t]));
      const byKid = new Map(mine.filter(t => t.komootId).map(t => [t.komootId, t]));
      const res = { added: 0, dup: 0, fail: 0, names: 0 };
      const todo = [];
      // Schon vorhandene Touren: Name von Komoot übernehmen; Komoots Höhenwert nur als Zusatzangabe aufbewahren (der Aufstieg bleibt die eigene Rechnung)
      for (const [t, ty] of list) {
        const own = mineK.get('komoot:' + t.id);
        const e = own || byKid.get(String(t.id)) || (ty === 'tour_recorded' ? Import.Komoot.match(t, mine) : null);
        if (!e) { todo.push([t, ty]); continue; }
        res.dup++;
        let ch = false;
        if (!own && e.komootId !== String(t.id)) { e.komootId = String(t.id); ch = true; }
        if (Import.Komoot.takeName(e, t.name)) { res.names++; ch = true; }
        if (isFinite(t.elevation_up) && t.elevation_up != null && (e.upKomoot == null || Math.abs(e.upKomoot - t.elevation_up) >= 1)) {
          e.upKomoot = t.elevation_up; e.downKomoot = isFinite(t.elevation_down) && t.elevation_down != null ? t.elevation_down : (e.downKomoot == null ? null : e.downKomoot);
          Tours.applyHoehe(e, Geo.stats(await Tours.points(e.id)));
          ch = true;
        }
        if (ch) await Tours.save(e);
      }
      for (let i = 0; i < todo.length; i++) {
        if (opts.stop && opts.stop()) { res.stopped = true; break; }      // 2.2.0: abbrechbar (Alles abgleichen); der Rest kommt beim nächsten Mal
        const [t, ty] = todo[i];
        if (onProgress) onProgress(i + 1, todo.length, t.name);
        try {
          const items = await Import.Komoot.coords(acc, t.id);
          const start = t.date ? Date.parse(t.date) : null;
          const pts = items.map(c => ({ lat: c.lat, lon: c.lng, ele: c.alt, t: start && c.t != null && ty === 'tour_recorded' ? start + c.t : null }));
          const r = await Tours.add({ name: t.name, sport: Sports.norm(t.sport), tags: Sports.tags(t.sport), pts, src: 'komoot', srcId: 'komoot:' + t.id, up: t.elevation_up, down: t.elevation_down, status: ty === 'tour_planned' ? 'planned' : 'done', start });
          if (r.dup) {
            res.dup++;      // die Spur gab es schon (erst an der Spur erkannt): Name und Komoot-Kennung nachtragen, damit sie beim nächsten Mal nicht wieder geladen wird
            const e = r.tour; let ch = false;
            if (!/^komoot:/.test(e.srcId || '') && e.komootId !== String(t.id)) { e.komootId = String(t.id); ch = true; }
            if (Import.Komoot.takeName(e, t.name)) { res.names++; ch = true; }
            if (ch) await Tours.save(e);
          } else { res.added++; const e = r.tour; if (e && e.nameKomoot == null && (t.name || '').trim()) { e.nameKomoot = t.name.trim(); await Tours.save(e); } }
        } catch (e) { res.fail++; }
      }
      await Photos.assignAll();
      return res;
    },
  },

  /* ---------------- Meine Touren (eigener Server, 2.1.0) ----------------
     Nur lesend: Anmeldung (POST /api/login, bei Zwei-Faktor danach POST /api/login/2fa), Tourenliste (GET /api/tours), Strecke je neuer Tour
     (GET /api/tours/<id>/gpx), Abmeldung (POST /api/logout). Die Sitzung ist das Cookie „kh_session“ des Servers; gemerkt wird nur dieser
     Sitzungsschlüssel (kv „mt“, nie in der Sicherung), nicht das Passwort. Ein Konto „nur ansehen“ (Betrachter) genügt. */
  MT: {
    COOKIE: 'kh_session',
    /** Sportarten von Meine Touren → Sportarten der App. Unbekanntes läuft über Sports.norm und landet sonst bei „Sonstiges“. */
    SPORT: { hike: 'hike', mountaineering: 'mountaineering', jogging: 'run', touringbicycle: 'bike', e_touringbicycle: 'ebike', e_mtb: 'emtb', racebike: 'racebike', mtb: 'mtb',
      skialpin: 'skialpin', skitour: 'skitour', snowshoe: 'snowshoe', nordic: 'nordic', nordicwalking: 'nordicwalking', other: 'other',      // 2.2.0: Wintersportarten getrennt; 2.19.0: Schneeschuh (+ Schlagwort), Nordic Walking, E-Mountainbike eigene Sportarten
      mtb_easy: 'gravel', skaten: 'inline' },      // 2.19.0: Schlüssel, die Meine Touren anders nennt; alle übrigen (climbing, trailrun, bikepacking, kayak … und entfernte wie dogwalk, sup) über Sports.norm
    sport: s => Import.MT.SPORT[s] || Sports.norm(s),
    /** Serveradresse aufräumen: ohne „http(s)://“ wird https angenommen; übrig bleiben Schema, Rechner und Port. Wirft bei Unsinn. */
    base(raw) {
      let s = String(raw || '').trim();
      if (!s) throw new Error('Bitte die Adresse von Meine Touren eintragen, z. B. https://meine-touren.example.ts.net');
      if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = 'https://' + s;
      let u; try { u = new URL(s); } catch (e) { u = null; }
      if (!u || !/^https?:$/.test(u.protocol) || !u.hostname) throw new Error('Das ist keine gültige Adresse. Beispiel: https://meine-touren.example.ts.net');
      return u.protocol + '//' + u.host;
    },
    /** Adresse im eigenen Netz (Heimnetz, Tailscale, Rechnername ohne Punkt)? Dort ist http üblich. */
    privat(base) {
      let hst = ''; try { hst = new URL(base).hostname.toLowerCase(); } catch (e) { return false; }
      if (hst.includes(':')) return /^\[?(f[cd][0-9a-f]{2}:|fe80:|::1\]?$)/.test(hst);      // IPv6: nur lokale Bereiche
      if (hst === 'localhost' || !hst.includes('.') || /\.(local|lan|home|internal|fritz\.box|ts\.net)$/.test(hst)) return true;
      const m = hst.match(/^(\d+)\.(\d+)\.\d+\.\d+$/); if (!m) return false;
      const a = +m[1], b = +m[2];
      return a === 10 || a === 127 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
    },
    /** Ein Aufruf am Server. Fehler der Verbindung werden zu einer verständlichen Meldung (ohne Zugangsdaten). */
    async http(base, path, o) {
      if (!MT.aktiv()) throw Object.assign(new Error('Die Zusammenarbeit mit Meine Touren ist ausgeschaltet (Mehr → Einstellungen).'), { aus: true });      // 2.15.0: Sicherung – bei Aus kein Netzaufruf
      o = o || {};
      const headers = { Accept: 'application/json' };
      if (o.token) headers.Cookie = Import.MT.COOKIE + '=' + o.token;
      const q = { url: base + path, method: o.method || 'GET', headers };
      if (o.json) { q.body = JSON.stringify(o.json); q.contentType = 'application/json'; }
      try { return await Native.http(q); }
      catch (e) { throw new Error('Meine Touren ist unter ' + base + ' nicht erreichbar. Bitte Adresse und Verbindung prüfen (WLAN, Tailscale).'); }
    },
    detail(r, sonst) { try { const d = JSON.parse(r.body).detail; if (typeof d === 'string' && d) return d; } catch (e) { /* keine JSON-Antwort */ } return sonst; },
    /** Antwortet unter der Adresse ein „Meine Touren“? Gibt die Antwort von /api/me zurück. */
    async probe(base) {
      const r = await Import.MT.http(base, '/api/me');
      let j = null; try { j = JSON.parse(r.body); } catch (e) { /* kein JSON */ }
      if (r.status === 401) throw new Error('Dieser Server ist nur mit einem gemeinsamen Passwort geschützt. Bitte in Meine Touren die Benutzerverwaltung einrichten, dann klappt die Anmeldung.');
      if (r.status !== 200 || !j || typeof j.users_enabled !== 'boolean') throw new Error('Unter ' + base + ' antwortet kein „Meine Touren“ (HTTP ' + r.status + '). Bitte die Adresse prüfen.');
      return j;
    },
    /** Sitzung aus der Antwort einer geglückten Anmeldung übernehmen und merken. Das Passwort wird nirgends gespeichert. */
    async finish(base, r) {
      const m = String((r.headers || {})['set-cookie'] || '').match(new RegExp('(?:^|[;,\\s])' + Import.MT.COOKIE + '=([^;,\\s]+)'));
      if (!m) throw new Error('Die Anmeldung hat geklappt, aber der Server hat keine Sitzung geliefert. Steht ein Proxy davor, der Cookies verändert?');
      const u = (JSON.parse(r.body).user) || {};
      const acc = { base, name: u.name || '', uid: u.uid || '', role: u.role || '', token: m[1], since: Date.now() };
      await DB.kvSet('mt', acc);
      return acc;
    },
    /** Anmelden. Gibt das Konto zurück – oder { need2fa, ticket, base }, wenn der Server einen Code aus der Authenticator-App verlangt. */
    async login(base, name, pw) {
      const me = await Import.MT.probe(base);
      if (!me.users_enabled) { const acc = { base, name: '', uid: '', role: 'offen', token: '', open: true, since: Date.now() }; await DB.kvSet('mt', acc); return acc; }      // Server ohne Benutzer: keine Anmeldung nötig
      if (!String(name || '').trim() || !pw) throw new Error('Bitte Name und Passwort eintragen.');
      const r = await Import.MT.http(base, '/api/login', { method: 'POST', json: { name: String(name).trim(), password: pw } });
      if (r.status === 401 || r.status === 429) throw new Error(Import.MT.detail(r, 'Name oder Passwort stimmt nicht'));
      if (r.status !== 200) throw new Error(Import.MT.detail(r, 'Anmeldung fehlgeschlagen (HTTP ' + r.status + ')'));
      const j = JSON.parse(r.body);
      if (j.need_2fa) return { need2fa: true, ticket: j.ticket, base };
      return Import.MT.finish(base, r);
    },
    /** Zweiter Schritt: Code aus der Authenticator-App (oder ein Wiederherstellungscode). */
    async login2fa(base, ticket, code) {
      const r = await Import.MT.http(base, '/api/login/2fa', { method: 'POST', json: { ticket, code: String(code || '').trim() } });
      if (r.status !== 200) throw new Error(Import.MT.detail(r, 'Der Code stimmt nicht (HTTP ' + r.status + ')'));
      return Import.MT.finish(base, r);
    },
    /** Sitzung abgelaufen oder abgemeldet: Schlüssel vergessen (Adresse und Name bleiben fürs Formular) und freundlich melden. */
    async expired(acc) {
      await DB.kvSet('mt', { base: acc.base, name: acc.name });
      const e = new Error('Die Anmeldung bei Meine Touren ist abgelaufen. Bitte neu anmelden.'); e.relogin = true; return e;
    },
    /** Lesender Aufruf mit Sitzung. 401 → Sitzung abgelaufen. */
    async get(acc, path) {
      const r = await Import.MT.http(acc.base, path, { token: acc.token });
      if (r.status === 401) throw await Import.MT.expired(acc);
      return r;
    },
    async tours(acc) {
      const r = await Import.MT.get(acc, '/api/tours');
      if (r.status !== 200) throw new Error(Import.MT.detail(r, 'Tourenliste: HTTP ' + r.status));
      const l = JSON.parse(r.body);
      if (!Array.isArray(l)) throw new Error('Tourenliste: unerwartete Antwort des Servers');
      return l.filter(t => t && t.id != null && t.start_ts);
    },
    /** Strecke einer Tour als GPX-Text; null, wenn der Server keine Strecke dazu hat. */
    async gpx(acc, id) {
      const r = await Import.MT.get(acc, '/api/tours/' + encodeURIComponent(id) + '/gpx');
      if (r.status === 404) return null;
      if (r.status !== 200) throw new Error('Strecke: HTTP ' + r.status);
      return r.body;
    },
    /** Verbindung trennen: am Server abmelden (soweit erreichbar) und den Sitzungsschlüssel löschen. */
    async logout(acc) {
      if (acc && acc.token) { try { await Import.MT.http(acc.base, '/api/logout', { method: 'POST', token: acc.token }); } catch (e) { /* nicht erreichbar: der Schlüssel wird trotzdem gelöscht */ } }
      await DB.kvSet('mt', acc && acc.base ? { base: acc.base, name: acc.name || '' } : null);
    },
    /** Namen aus Meine Touren übernehmen: nur wenn der bisherige Name selbst erzeugt ist oder zuletzt von Meine Touren oder Komoot kam –
        ein in der App von Hand vergebener Name bleibt. Gibt true zurück, wenn sich der Name geändert hat. */
    takeName(e, name) {
      name = (name || '').trim();
      if (!name) return false;
      const frei = Import.Komoot.autoNamed(e) || (e.nameMt != null && e.name === e.nameMt) || (e.nameKomoot != null && e.name === e.nameKomoot);
      const alt = e.name;
      if (frei) e.name = name;
      if (frei || e.name === name) e.nameMt = name;
      return e.name !== alt;
    },
    /** Gehört ein Eintrag der Tourenliste zu einer vorhandenen Tour (aus Zepp, Komoot, Datei, Aufzeichnung)? Gleicher Start (± 5 Minuten) und,
        wo beide eine Strecke haben, ähnliche Länge (± 10 %, mindestens 300 m). used: Touren, die schon einem anderen Eintrag zugeordnet sind. */
    match(t, tours, used) {
      const st = t.start_ts * 1000, dist = +t.dist_m || 0;
      if (!isFinite(st)) return null;
      let best = null, bd = Infinity;
      for (const e of tours) {
        if (e.status === 'planned' || !e.start || e.timed === false || e.mtId || /^mt:/.test(e.srcId || '') || (used && used.has(e.id))) continue;
        const d = Math.abs(e.start - st);
        if (d > 300000) continue;
        if (dist && e.dist && Math.abs(e.dist - dist) > Math.max(300, 0.1 * dist)) continue;
        if (d < bd) { best = e; bd = d; }
      }
      return best;
    },
    /** Angaben eines Listeneintrags auf eine Tour der App legen. opts.zahlen: Aufstieg, Abstieg und Strecke aus Meine Touren als maßgebliche Werte.
        Gibt { ch, name, zahlen, eigen } zurück; eigen = die Tour war angeglichen und soll wieder aus der eigenen Spur gerechnet werden. */
    take(e, t, opts) {
      const vor = JSON.stringify(e), r = { ch: false, name: false, zahlen: false, eigen: false };
      const num = v => (typeof v === 'number' && isFinite(v) ? v : null);
      const put = (k, v) => { if (v == null) delete e[k]; else e[k] = v; };
      const vorSp = e.sportMt;
      r.name = Import.MT.takeName(e, t.name);
      const sp = Import.MT.sport(t.sport), rawSp = String(t.sport || '');
      if (!e.sportMan && sp && !Abgleich.sportGleich(e.sport, sp) && e.status !== 'planned') { e.sportAlt = e.sportAlt || e.sport; e.sport = sp; }      // 2.19.0: bisherige Zuordnung ↔ neue Sportart (z. B. Wandern ↔ Schneeschuh) ist keine Änderung
      if (rawSp) e.sportMt = rawSp; else delete e.sportMt;      // die Sportart, wie Meine Touren sie nennt (2.2.0)
      if (Sports.isSnowshoe(rawSp) && !(e.tags || []).includes(Sports.SCHNEESCHUH) && !(vorSp && Sports.isSnowshoe(vorSp))) e.tags = (e.tags || []).concat(Sports.SCHNEESCHUH);      // einmal ergänzen; in der App entfernt, kommt es nicht wieder
      const note = String(t.note || '').trim();
      if (note && (!String(e.note || '').trim() || (e.noteMt != null && e.note === e.noteMt))) e.note = note;      // eine in der App geschriebene Notiz bleibt
      if (note && e.note === note) e.noteMt = note;
      Abgleich.sterneUebernehmen(e, num(t.stars));      // 2.2.0: Sterne aus Meine Touren, solange die Bewertung in der App nicht von Hand geändert wurde
      const tags = String(t.tags || '').split('|').map(x => x.trim()).filter(Boolean);
      const neu = tags.filter(g => !(e.tagsMt || []).includes(g) && !(e.tags || []).includes(g));      // nur neue Schlagworte ergänzen; in der App entfernte kommen nicht wieder
      if (neu.length) e.tags = (e.tags || []).concat(neu);
      put('tagsMt', tags.length ? tags : null);
      const up = num(t.up_m), down = num(t.down_m), dist = num(t.dist_m) > 0 ? t.dist_m : null;
      put('upMt', up); put('downMt', up != null ? down : null); put('distMt', dist);
      if (opts && opts.zahlen && (up != null || dist != null)) {
        const o = [e.up || 0, e.down || 0, e.dist || 0];
        e.zMt = 1;
        if (up != null) { e.up = up; if (down != null) e.down = down; e.upSrc = 'mt'; }
        if (dist != null) e.dist = dist;
        r.zahlen = Math.abs((e.up || 0) - o[0]) >= 1 || Math.abs((e.down || 0) - o[1]) >= 1 || Math.abs((e.dist || 0) - o[2]) >= 10;
      } else if (e.zMt) { delete e.zMt; r.eigen = true; }
      r.ch = JSON.stringify(e) !== vor;
      return r;
    },
    /** Abgleich. opts: zahlen (Vorgabe an), stop() (Abbruch). onProgress(i, n, text).
        Vorhandene Touren werden zugeordnet (Kennung, sonst Start und Länge) und bekommen Name, Sportart, Notiz und Zahlen – ohne dass eine Strecke geladen wird.
        Nur für Touren, die es in der App noch nicht gibt, wird die Strecke vom Server geholt. Beliebig oft wiederholbar. */
    async importAll(acc, opts, onProgress) {
      opts = Object.assign({ zahlen: true }, opts || {});
      const M = Import.MT, stop = () => !!(opts.stop && opts.stop());
      const list = (await M.tours(acc)).sort((a, b) => a.start_ts - b.start_ts);
      const mine = await Tours.list();
      const bySrc = new Map(), byMt = new Map(), byK = new Map();
      for (const e of mine) {
        [e.srcId].concat(e.alias || []).filter(Boolean).forEach(k => { bySrc.set(k, e); const m = /^komoot:(.+)$/.exec(k); if (m) byK.set(m[1], e); });
        if (e.mtId) byMt.set(String(e.mtId), e);
        if (e.komootId) byK.set(String(e.komootId), e);
      }
      const res = { added: 0, dup: 0, fail: 0, namesMt: 0, zahlen: 0, ohne: 0 };
      const used = new Set(), pairs = [], rest = [], todo = [];
      for (const t of list) {      // 1. sichere Zuordnung über Kennungen (auch die Komoot-Nummer, wenn die Tour am Server von Komoot stammt)
        const id = String(t.id), e = bySrc.get('mt:' + id) || byMt.get(id) || (t.source === 'komoot' && byK.get(id) && !byK.get(id).mtId ? byK.get(id) : null);
        if (e && !used.has(e.id)) { used.add(e.id); pairs.push([t, e]); }
        else if (e && bySrc.get('mt:' + id) === e) res.dup++;      // am Server doppelt, in der App schon eine Tour: nichts zu tun
        else rest.push(t);
      }
      for (const t of rest) {      // 2. Zuordnung über Startzeit und Länge
        const e = M.match(t, mine, used);
        if (e) { used.add(e.id); pairs.push([t, e]); } else todo.push(t);
      }
      let batch = [], eigen = [];
      const flush = async () => {
        if (batch.length) { await DB.putMany('tours', batch); batch = []; }
        for (const id of eigen) await Tours.recalc(id, { eigen: true });      // Schalter aus: wieder die eigene Rechnung
        eigen = []; Tours.invalidate();
      };
      for (let i = 0; i < pairs.length; i++) {
        if (stop()) { res.stopped = true; break; }
        const [t, e] = pairs[i], id = String(t.id);
        res.dup++;
        const link = e.srcId !== 'mt:' + id && e.mtId !== id;
        if (link) e.mtId = id;
        const r = M.take(e, t, opts);
        if (r.name) res.namesMt++;
        if (r.zahlen) res.zahlen++;
        if (r.eigen) eigen.push(e.id);
        if (r.ch || link) batch.push(e);
        if (batch.length >= 40 || (i % 100 === 99)) { await flush(); if (onProgress) onProgress(i + 1, pairs.length, 'Vorhandene Touren abgleichen'); await sleep(0); }
      }
      await flush();
      for (let i = 0; i < todo.length && !res.stopped; i++) {      // 3. neue Touren: Strecke laden und anlegen
        if (stop()) { res.stopped = true; break; }
        const t = todo[i], id = String(t.id);
        if (onProgress) onProgress(i + 1, todo.length, t.name || '');
        let text;
        try { text = await M.gpx(acc, id); } catch (e) { if (e.relogin) throw e; res.fail++; continue; }
        if (text == null) { res.ohne++; continue; }
        try {
          const acts = await Parse.any('mt-' + id + '.gpx', new TextEncoder().encode(text));
          if (!acts.length || acts[0].pts.length < 2) { res.ohne++; continue; }
          const start = t.start_ts * 1000;
          const r = await Tours.add({ name: t.name, sport: M.sport(t.sport), pts: acts[0].pts, src: 'mt', srcId: 'mt:' + id, start, note: String(t.note || '').trim() });
          const e = r.tour;
          if (r.dup && (e.mtId || /^mt:/.test(e.srcId || '')) && e.srcId !== 'mt:' + id && e.mtId !== id) {      // am Server doppelt: die Tour der App gehört schon zu einem anderen Eintrag – nur die Kennung merken
            res.dup++; e.alias = [...new Set((e.alias || []).concat('mt:' + id))]; await Tours.save(e); continue;
          }
          if (r.dup) { res.dup++; if (e.srcId !== 'mt:' + id) e.mtId = id; }      // die Spur gab es schon (erst an der Spur erkannt): Zuordnung merken
          else {
            res.added++;
            if (!e.timed) { e.start = start; if (t.end_ts) e.end = t.end_ts * 1000; if (t.dur_s) e.dur = t.dur_s; }      // Strecke ohne Zeitstempel: Datum und Dauer vom Server
          }
          const k = M.take(e, t, opts);
          if (r.dup && k.name) res.namesMt++;
          if (r.dup && k.zahlen) res.zahlen++;
          await Tours.save(e);
          if (k.eigen) await Tours.recalc(e.id, { eigen: true });
        } catch (e) { res.fail++; }
      }
      if (res.added) await Photos.assignAll();
      Tours.invalidate();
      if (!res.stopped) {      // Touren, die es nur in der App gibt (erklärt eine unterschiedliche Tourenzahl); gelöscht wird nie etwas
        const ids = new Set(list.map(t => String(t.id)));
        res.nurApp = (await Tours.list()).filter(e => e.status !== 'planned' && !e.hidden && !(e.mtId && ids.has(String(e.mtId))) && ![e.srcId].concat(e.alias || []).some(k => /^mt:/.test(k || '') && ids.has(k.slice(3)))).length;
      }
      return res;
    },
  },

  /* ---------------- Strava ---------------- */
  Strava: {
    authUrl: id => `https://www.strava.com/oauth/authorize?client_id=${encodeURIComponent(id)}&response_type=code&redirect_uri=${encodeURIComponent('http://localhost/exchange')}&approval_prompt=force&scope=read,activity:read_all`,
    parseCode(s) { const m = String(s).match(/[?&]code=([^&\s]+)/); return m ? m[1] : String(s).trim(); },
    async exchange(id, secret, code) {
      const body = `client_id=${encodeURIComponent(id)}&client_secret=${encodeURIComponent(secret)}&code=${encodeURIComponent(code)}&grant_type=authorization_code`;
      const r = await Native.http({ method: 'POST', url: 'https://www.strava.com/oauth/token', body, contentType: 'application/x-www-form-urlencoded', headers: { Accept: 'application/json' } });
      if (r.status !== 200) throw new Error('Strava hat den Code abgelehnt (HTTP ' + r.status + '). Er ist nur einmal und kurz gültig – bitte neu anfordern.');
      const j = JSON.parse(r.body);
      const acc = { id, secret, access: j.access_token, refresh: j.refresh_token, exp: j.expires_at, name: (j.athlete || {}).firstname || '' };
      await DB.kvSet('strava', acc); return acc;
    },
    async token(acc) {
      if (acc.exp * 1000 > Date.now() + 60000) return acc.access;
      const body = `client_id=${encodeURIComponent(acc.id)}&client_secret=${encodeURIComponent(acc.secret)}&grant_type=refresh_token&refresh_token=${encodeURIComponent(acc.refresh)}`;
      const r = await Native.http({ method: 'POST', url: 'https://www.strava.com/oauth/token', body, contentType: 'application/x-www-form-urlencoded' });
      if (r.status !== 200) throw new Error('Strava-Anmeldung abgelaufen – bitte neu verbinden');
      const j = JSON.parse(r.body);
      Object.assign(acc, { access: j.access_token, refresh: j.refresh_token, exp: j.expires_at });
      await DB.kvSet('strava', acc); return acc.access;
    },
    async get(acc, path) {
      const tk = await Import.Strava.token(acc);
      const r = await Native.http({ url: 'https://www.strava.com/api/v3' + path, headers: { Authorization: 'Bearer ' + tk } });
      if (r.status === 429) throw new Error('Strava-Limit erreicht (100 Abfragen / 15 Minuten). Später erneut starten – bereits geladene Touren bleiben erhalten.');
      if (r.status !== 200) throw new Error('Strava: HTTP ' + r.status);
      return JSON.parse(r.body);
    },
    async importAll(acc, onProgress) {
      let list = [];
      for (let p = 1; ; p++) { const a = await Import.Strava.get(acc, `/athlete/activities?per_page=100&page=${p}`); list = list.concat(a); if (a.length < 100) break; }
      const have = new Set(); (await Tours.list()).forEach(t => { have.add(t.srcId); (t.alias || []).forEach(a => have.add(a)); });
      const todo = list.filter(a => !have.has('strava:' + a.id) && !a.manual && a.start_latlng !== null);
      const res = { added: 0, dup: list.length - todo.length, fail: 0 };
      for (let i = 0; i < todo.length; i++) {
        const a = todo[i];
        if (onProgress) onProgress(i + 1, todo.length, a.name);
        try {
          const s = await Import.Strava.get(acc, `/activities/${a.id}/streams?keys=latlng,time,altitude&key_by_type=true`);
          const ll = (s.latlng || {}).data || [], tm = (s.time || {}).data || [], al = (s.altitude || {}).data || [];
          const st = Date.parse(a.start_date);
          const pts = ll.map((c, k) => ({ lat: c[0], lon: c[1], ele: al[k] != null ? al[k] : null, t: st + (tm[k] || 0) * 1000 }));
          const r = await Tours.add({ name: a.name, sport: Sports.norm(a.sport_type || a.type), tags: Sports.tags(a.sport_type || a.type), pts, src: 'strava', srcId: 'strava:' + a.id });
          if (r.dup) res.dup++; else res.added++;
        } catch (e) { if (/Limit/.test(e.message)) { res.limit = e.message; break; } res.fail++; }
      }
      await Photos.assignAll();
      return res;
    },
  },

  /* ---------------- Zepp / Amazfit ---------------- */
  Zepp: {
    KEY: 'xeNtBVqzDc6tuNTh', IV: 'MAAAYAAAAAAAAABg',
    /** Zepp-Sporttyp → Sportart der App (2.2.0 wie die Zuordnung des Servers „Meine Touren“, app/gpxtools.py): 43 und 105 Ski alpin, 178 Schneeschuh (seit 2.19.0 eigene Sportart,
        dazu das Schlagwort „Schneeschuh“), 206 E-Bike. „Gehen“ zählt als Wandern; Laufen (1, 8) bleibt – anders als im Server – getrennt.
        2.19.0 (endgültige Auswahl): nur diese bekannten Typen; 14 (bis dahin „Ski (allgemein)“) gibt es nicht mehr – unbekannte Typen werden „Sonstiges“. */
    TYPEN: { 1: 'run', 6: 'hike', 7: 'hike', 8: 'run', 9: 'bike', 13: 'hike', 15: 'hike', 22: 'hike', 43: 'skialpin', 105: 'skialpin', 178: 'snowshoe', 206: 'ebike' },
    SCHNEESCHUH: [178],
    HOSTS: ['https://api-mifit-de2.zepp.com', 'https://api-mifit-us2.zepp.com', 'https://api-mifit.huami.com', 'https://api-mifit.zepp.com'],
    async enc(text) {
      const te = new TextEncoder();
      const key = await crypto.subtle.importKey('raw', te.encode(Import.Zepp.KEY), 'AES-CBC', false, ['encrypt']);
      const iv = te.encode(Import.Zepp.IV);
      return new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-CBC', iv }, key, te.encode(text)));
    },
    async login(email, pass) {
      const q = new URLSearchParams();
      q.append('emailOrPhone', email); q.append('state', 'REDIRECTION'); q.append('client_id', 'HuaMi'); q.append('password', pass);
      q.append('redirect_uri', 'https://s3-us-west-2.amazonaws.com/hm-registration/successsignin.html'); q.append('region', 'us-west-2');
      q.append('token', 'access'); q.append('token', 'refresh'); q.append('country_code', 'US');
      const enc = await Import.Zepp.enc(q.toString());
      let bin = ''; enc.forEach(b => bin += String.fromCharCode(b));
      const r = await Native.http({ method: 'POST', url: 'https://api-user-us2.zepp.com/v2/registrations/tokens', bodyB64: btoa(bin), noRedirect: true,
        contentType: 'application/x-www-form-urlencoded; charset=UTF-8',
        headers: { app_name: 'com.huami.midong', appname: 'com.huami.midong', cv: '151689_9.12.5', v: '2.0', appplatform: 'android_phone', vb: '202509151347', vn: '9.12.5', 'user-agent': 'Zepp/9.12.5 (Pixel 4; Android 12; Density/2.75)', 'x-hm-ekv': '1' } });
      if (r.status !== 303) throw new Error('Zepp hat die Anmeldung abgelehnt (HTTP ' + r.status + '). E-Mail/Passwort prüfen. Konten mit Google-/Apple-/Mi-Login haben kein Passwort.');
      const loc = (r.headers || {}).location || '';
      const access = new URLSearchParams(loc.split('?')[1] || '').get('access');
      if (!access) throw new Error('Zepp: kein Zugriffstoken erhalten. Bei Google-/Apple-/Mi-Konten gibt es kein Passwort.');
      const body = new URLSearchParams({ code: access, device_id: uid(), device_model: 'android_phone', app_version: '9.12.5',
        dn: 'api-mifit.zepp.com,api-user.zepp.com,api-mifit.zepp.com,api-watch.zepp.com,app-analytics.zepp.com,auth.zepp.com,api-analytics.zepp.com',
        third_name: 'huami', source: 'com.huami.watch.hmwatchmanager:9.12.5:151689', app_name: 'com.huami.midong', country_code: 'US', grant_type: 'access_token', allow_registration: 'false', lang: 'en', countryState: 'US-NY' }).toString();
      const r2 = await Native.http({ method: 'POST', url: 'https://api-mifit-us2.zepp.com/v2/client/login', body, contentType: 'application/x-www-form-urlencoded; charset=UTF-8',
        headers: { app_name: 'com.huami.webapp', appname: 'com.huami.webapp', origin: 'https://user.zepp.com', referer: 'https://user.zepp.com/', accept: 'application/json' } });
      if (r2.status !== 200) throw new Error('Zepp-Login fehlgeschlagen (HTTP ' + r2.status + ')');
      const ti = (JSON.parse(r2.body).token_info) || {};
      if (!ti.app_token) throw new Error('Zepp: kein App-Token in der Antwort');
      const acc = { token: ti.app_token, user: String(ti.user_id || '') };
      await DB.kvSet('zepp', acc); return acc;
    },
    /* Anmeldung per Token (für Google-/Apple-/Mi-Konten ohne Passwort): prüfen, welcher Server antwortet, dann merken */
    async useToken(raw, host) {
      const token = Parse.zeppToken(raw);
      if (!token) throw new Error('Das sieht nicht wie ein Zepp-Token aus. Es besteht aus mindestens 20 Zeichen (Buchstaben, Ziffern, - _ = +). Bitte den Wert von „apptoken“ komplett einfügen.');
      let h0 = String(host || '').trim().replace(/\/+$/, '');
      if (h0 && !/^https?:\/\//i.test(h0)) h0 = 'https://' + h0;
      const acc = { token, user: '', host: h0 || undefined, viaToken: true };
      await Import.Zepp.req(acc, '/v1/sport/run/history.json', {});          // wirft, wenn das Token nicht (mehr) gilt
      await DB.kvSet('zepp', acc); return acc;
    },
    async req(acc, endpoint, params) {
      const hosts = acc.host ? [acc.host] : Import.Zepp.HOSTS;
      let last = null;
      for (const h0 of hosts) for (const [pf, an] of [['android_phone', 'com.huami.midong'], ['web', 'com.xiaomi.hm.health']]) {
        try {
          const qs = new URLSearchParams(params || {}).toString();
          const r = await Native.http({ url: h0 + endpoint + (qs ? '?' + qs : ''), headers: { apptoken: acc.token, appPlatform: pf, appname: an } });
          last = r.status;
          if (r.status === 200) { const j = JSON.parse(r.body); if ((j.code === 1 || j.code == null) && 'data' in j) { acc.host = h0; return j; } }
        } catch (e) { last = e.message; }
      }
      throw new Error('Zepp-Anfrage fehlgeschlagen (' + last + '). ' + (acc.viaToken ? 'Das Token ist abgelaufen oder gehört zu einem anderen Server – bitte ein neues holen (Abmelden, dann neu einfügen).' : 'Zugang abgelaufen? Bitte neu anmelden.'));
    },
    col(s, idx, defOne) { return (s || '').split(';').filter(Boolean).map(v => { if (idx != null) v = v.split(',')[idx]; return parseInt(v || (defOne ? 1 : 0), 10) || 0; }); },
    cum: a => { let s = 0; return a.map(v => s += v); },
    interp(data, orig, nw) {
      const NO = -2000000; data = data.slice();
      let old = NO; for (const v of data) { if (v !== NO) { old = v; break; } }
      for (let i = 0; i < data.length; i++) { if (data[i] === NO) data[i] = old; else old = data[i]; }
      if (!nw.length) return []; if (!orig.length) return nw.map(() => 0); if (orig.length === 1) return nw.map(() => orig[0]);
      const sl = []; for (let i = 0; i < orig.length - 1; i++) sl.push(Math.floor((data[i + 1] - data[i]) / ((orig[i + 1] - orig[i]) || 1)));
      return nw.map(x => {
        let lo = 0, hi = orig.length; while (lo < hi) { const m = (lo + hi) >> 1; if (orig[m] < x) lo = m + 1; else hi = m; }
        const i = lo - 1;
        if (i >= sl.length) return data[data.length - 1]; if (i < 0) return data[0];
        return data[i] + sl[i] * (x - orig[i]);
      });
    },
    decode(summary, d) {
      const Z = Import.Zepp, ll = d.longitude_latitude || '';
      if (!ll) return [];
      const tt = Z.cum(Z.col(d.time)), la = Z.col(ll, 0), lo = Z.col(ll, 1), al = Z.col(d.altitude);
      const hr = Z.cum(Z.col(d.heart_rate, 0, true)), stp = Z.cum(Z.col(d.gait, 0));
      const all = Array.from(new Set([].concat(tt, hr, stp))).sort((a, b) => a - b);
      const LA = Z.interp(Z.cum(la), tt, all), LO = Z.interp(Z.cum(lo), tt, all), AL = Z.interp(al, tt, all);
      // Puls: wie die Zeiten steht in Spalte 1 nur die Änderung zum Vorwert – erst aufsummieren, dann auf alle Zeitpunkte legen
      const HR = hr.length ? Z.interp(Z.cum(Z.col(d.heart_rate, 1)), hr, all) : null;
      const start = parseInt(summary.trackid, 10);
      return all.map((t, i) => {
        const e = AL[i] / 100;
        return { lat: LA[i] / 1e8, lon: LO[i] / 1e8, ele: e > -500 && e < 9000 ? e : null, t: (start + t) * 1000, hr: HR ? Parse.hr(HR[i]) : null };
      });
    },
    /** Gleiche Aktivität wie eine vorhandene Tour (auch aus Komoot oder Datei)? Gleicher Start (±5 min) oder gleiche Strecke und Dauer. */
    match(s, tours) {
      const st = parseInt(s.trackid, 10) * 1000, dist = parseFloat(s.dis) || 0, dur = parseFloat(s.run_time) || 0;
      for (const t of tours) {
        if (t.status === 'planned' || !t.start) continue;
        if (t.srcId === 'zepp:' + s.trackid || (t.alias && t.alias.includes('zepp:' + s.trackid))) return t;
        const d = Math.abs(t.start - st);
        if (d <= 300000) return t;
        if (dist && t.dist && Math.abs(t.dist - dist) <= 0.01 * dist && dur && t.dur && Math.abs(t.dur - dur) <= 60
          && (d <= 3 * 3600000 || [1, 2].some(h => Math.abs(d - h * 3600000) <= 300000))) return t;
      }
      return null;
    },
    /** opts.ele (Vorgabe an, 2.1.0): Passt eine Aktivität zu einer vorhandenen Tour aus anderer Quelle (Komoot, Datei, Aufzeichnung), bekommt deren Spur
        die Barometerhöhen der Uhr (wie „Höhe aus Uhr abgleichen“, rückholbar über „Originalhöhen wiederherstellen“) – aber nur, wenn die Tour noch keine
        Uhr-Höhen hat, nicht mit dem Geländemodell korrigiert wurde und es nicht schon einmal versucht wurde (Tour.zele). */
    async importAll(acc, onProgress, opts) {
      opts = opts || {};
      const Z = Import.Zepp; let sums = [], nxt = null;
      for (;;) {
        const j = await Z.req(acc, '/v1/sport/run/history.json', nxt != null ? { trackid: nxt } : {});
        sums = sums.concat(j.data.summary || []);
        nxt = j.data.next; if (nxt == null || nxt === -1) break;
      }
      const mine = await Tours.list();
      const res = { added: 0, dup: 0, fail: 0, hr: 0, eleUhr: 0 };
      const types = Import.Zepp.TYPEN;
      // Jede Zepp-Aktivität: gibt es sie schon (auch als Komoot-/Datei-Tour), nur Puls und Uhr-Höhen nachtragen – sonst neu laden
      const vonZepp = t => t.src === 'zepp' || /^zepp:/.test(t.srcId || '');      // trägt die Uhr-Höhen von Anfang an
      const todo = [], seen = new Set();
      for (const s of sums) {
        const t = Z.match(s, mine);
        if (!t) { todo.push({ s, t: null }); continue; }
        const hr = !t.hrAvg && !t.zhr, ele = opts.ele !== false && !t.elevSrc && !t.elevFix && !t.zele && !vonZepp(t) && !seen.has(t.id);
        if (hr || ele) { todo.push({ s, t, hr, ele }); seen.add(t.id); }
        else res.dup++;
      }
      for (let i = 0; i < todo.length; i++) {
        const { s, t, hr, ele } = todo[i];
        if (opts.stop && opts.stop()) { res.stopped = true; break; }
        if (onProgress) onProgress(i + 1, todo.length, (t ? (ele ? 'Uhr-Daten ' : 'Puls ') : '') + F.dshort(s.trackid * 1000));
        try {
          const dj = await Z.req(acc, '/v1/sport/run/detail.json', { trackid: s.trackid, source: s.source || '' });
          const pts = Z.decode(s, dj.data);
          if (t) {
            let did = false;
            if (hr && await Tours.fillHr(t.id, pts, parseInt(s.trackid, 10) * 1000)) { res.hr++; did = true; }
            if (ele) {
              const trk = await DB.get('tracks', t.id);
              let ok = false;
              if (trk && trk.lat.length >= 5) {
                try { await Fix.zeppEleWith(t, trk, acc, s, { det: dj, auto: true }); ok = true; }
                catch (e) { if (!/brauchbaren/.test(e.message)) throw e; }
              }
              if (ok) { res.eleUhr++; did = true; }
              else { const t2 = await DB.get('tours', t.id); if (t2) { t2.zele = 1; await Tours.save(t2); } }      // Versuch vermerken: keine brauchbaren Höhen von der Uhr
            }
            if (!did) res.dup++;
            continue;
          }
          if (pts.length < 2) { res.dup++; continue; }
          const r = await Tours.add({ sport: types[s.type] || 'other', tags: Import.Zepp.SCHNEESCHUH.includes(+s.type) ? [Sports.SCHNEESCHUH] : [], pts, src: 'zepp', srcId: 'zepp:' + s.trackid });
          if (r.dup) res.dup++; else res.added++;
        } catch (e) { res.fail++; }
      }
      await Photos.assignAll();
      return res;
    },
  },

  /* ---------------- Alles abgleichen (2.2.0) ----------------
     Führt nacheinander alle verbundenen Quellen mit ihren gespeicherten Einstellungen aus – dieselben Abgleiche wie die einzelnen Blätter, nur gebündelt.
     Reihenfolge und Begründung: calc-abgleich.js. Nicht verbundene Quellen werden übersprungen (kein Anmeldeblatt). Ein Fehler einer Quelle bricht die
     anderen nicht ab; er steht in der Zusammenfassung. Zustand (kv „abgleich“, nicht in der Sicherung): { t: letzter geglückter Lauf, neu, fehler, versuch: letzter Start }. */
  Alles: {
    busy: false,
    /** Verbundene Quellen in der Reihenfolge des Abgleichs: [{ id, name, acc }]. */
    async quellen() {
      const ok = { zepp: a => !!(a && a.token), komoot: a => !!(a && a.token), mt: a => !!(a && (a.token || a.open)) }, out = [];
      for (const id of MTCalc.reihenfolge(Abgleich.REIHENFOLGE, MT.aktiv())) { const acc = await DB.kvGet(id, null); if (ok[id](acc)) out.push({ id, name: Abgleich.NAMEN[id], acc }); }
      return out;
    },
    /** Eine Quelle mit ihren gespeicherten Einstellungen ausführen. upd(i, n, text). */
    eine(q, o, upd) {
      if (q.id === 'zepp') return Import.Zepp.importAll(q.acc, upd, { ele: Set_.get('zeppEle') !== false, stop: o.stop });
      if (q.id === 'komoot') return Import.Komoot.importAll(q.acc, { planned: !!Set_.get('komootPlanned'), stop: o.stop }, upd);
      if (!MT.aktiv()) return Promise.reject(new Error('Die Zusammenarbeit mit Meine Touren ist ausgeschaltet.'));
      return Import.MT.importAll(q.acc, { zahlen: Set_.get('mtZahlen') !== false, stop: o.stop }, upd);
    },
    /** Alle verbundenen Quellen abgleichen. o: stop() (Abbruch), onProgress(text, anteil 0…1). Gibt { items, stopped, neu, fehler } zurück;
        items: [{ id, name, res | err | skipped }]. Merkt Zeitpunkt und Ergebnis (kv „abgleich“). */
    async run(o) {
      o = o || {};
      if (Import.Alles.busy) throw new Error('Ein Abgleich läuft schon.');
      Import.Alles.busy = true;
      const t0 = Date.now(), items = [];
      try {
        const qs = await Import.Alles.quellen(), stop = () => !!(o.stop && o.stop());
        await DB.kvSet('abgleich', Object.assign({}, await DB.kvGet('abgleich', null), { versuch: t0 }));
        for (let k = 0; k < qs.length; k++) {
          const q = qs[k];
          if (stop()) { items.push({ id: q.id, name: q.name, skipped: true }); continue; }
          const say = (frac, text) => { if (o.onProgress) o.onProgress(text, (k + Math.max(0, Math.min(1, frac))) / qs.length); };
          say(0, q.name + ' …');
          const upd = (i, n, text) => say(n ? i / n : 0, q.name + ' · ' + i + ' von ' + n + (text ? ' · ' + text : ''));
          try { items.push({ id: q.id, name: q.name, res: await Import.Alles.eine(q, { stop }, upd) }); }
          catch (e) { items.push({ id: q.id, name: q.name, err: e }); }
        }
        const stopped = items.some(i => i.skipped || (i.res && i.res.stopped)), fehler = items.filter(i => i.err).length;
        const neu = Abgleich.neue(items), geglueckt = items.some(i => i.res);
        Tours.invalidate();
        if (geglueckt && !stopped) await DB.kvSet('abgleich', { t: Date.now(), neu, fehler, versuch: t0 });
        if (o.onProgress) o.onProgress('Fertig', 1);
        return { items, stopped, neu, fehler };
      } finally { Import.Alles.busy = false; }
    },
    /** Still im Hintergrund (Einstellung „Beim Öffnen automatisch abgleichen“, Vorgabe aus): höchstens einmal je 24 Stunden, nur mit Verbindung,
        nie während einer Aufzeichnung (läuft eine an, hört der Abgleich an der nächsten Stelle auf). Gibt das Ergebnis zurück oder null, wenn nichts zu tun war. */
    async auto() {
      if (!Set_.get('autoAbgleich') || Import.Alles.busy) return null;
      const qs = await Import.Alles.quellen(), st = (await DB.kvGet('abgleich', null)) || {};
      if (!Abgleich.faellig({ an: true, quellen: qs.length, live: Home.live(), last: st.t, lastTry: st.versuch, now: Date.now() })) return null;
      let lv = false, at = 0;
      const stop = () => { const n = Date.now(); if (n - at > 5000) { at = n; lv = Home.live(); } return lv; };      // die Brücke nicht bei jeder Tour fragen
      const r = await Import.Alles.run({ stop });
      return r;
    },
  },

  /* ---------------- überwachter Ordner (Garmin-Sync, Syncthing, Cloud-Ordner …) ---------------- */
  async scanFolders(onProgress) {
    const folders = await DB.kvGet('trackFolders', []);
    let tot = { added: 0, dup: 0, fail: 0 };
    for (const f of folders) {
      let items;
      try { items = (await Native.json('folderScan', { tree: f.tree, since: f.since || 0 })).filter(i => i.kind === 'track'); } catch (e) { continue; }
      if (items.length) {
        const files = await Native.json('copyUris', { uris: items.map(i => i.uri) });
        tot = Import.sum(tot, await Import.cacheFiles(files, onProgress));
      }
      f.since = Date.now();
    }
    await DB.kvSet('trackFolders', folders);
    return tot;
  },
};
