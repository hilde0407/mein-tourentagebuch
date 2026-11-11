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
        const r = await Tours.add(Object.assign({ name: a.name, sport: a.sport, pts: a.pts, src }, extra || {}));
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
    if (r.fail) p.push(r.fail + ' nicht lesbar');
    return p.join(' · ') || 'Nichts gefunden';
  },
  async fetchBuf(url) { const r = await fetch(url); if (!r.ok) throw new Error('Datei nicht lesbar'); return new Uint8Array(await r.arrayBuffer()); },

  /** Dateien über den Android-Auswahldialog. */
  async pickFiles(onProgress) {
    const files = await Native.json('pickFiles');
    return Import.cacheFiles(files, onProgress);
  },
  async cacheFiles(files, onProgress) {
    let tot = { added: 0, dup: 0, fail: 0 };
    for (let i = 0; i < files.length; i++) {
      if (onProgress) onProgress(i + 1, files.length, files[i].name);
      try {
        const buf = await Import.fetchBuf(files[i].url);
        tot = Import.sum(tot, await Import.fromData(files[i].name, buf, 'file'));
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
    /** Alle neuen Touren holen; onProgress(i, n, name). */
    async importAll(acc, opts, onProgress) {
      const types = opts.planned ? ['tour_recorded', 'tour_planned'] : ['tour_recorded'];
      let list = [];
      for (const ty of types) (await Import.Komoot.tours(acc, ty)).forEach(t => list.push([t, ty]));
      const have = new Set((await Tours.list()).map(t => t.srcId));
      const todo = list.filter(([t]) => !have.has('komoot:' + t.id));
      const res = { added: 0, dup: list.length - todo.length, fail: 0 };
      for (let i = 0; i < todo.length; i++) {
        const [t, ty] = todo[i];
        if (onProgress) onProgress(i + 1, todo.length, t.name);
        try {
          const items = await Import.Komoot.coords(acc, t.id);
          const start = t.date ? Date.parse(t.date) : null;
          const pts = items.map(c => ({ lat: c.lat, lon: c.lng, ele: c.alt, t: start && c.t != null && ty === 'tour_recorded' ? start + c.t : null }));
          const r = await Tours.add({ name: t.name, sport: Sports.norm(t.sport), pts, src: 'komoot', srcId: 'komoot:' + t.id, status: ty === 'tour_planned' ? 'planned' : 'done', start });
          if (r.dup) res.dup++; else res.added++;
        } catch (e) { res.fail++; }
      }
      await Photos.assignAll();
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
      const have = new Set((await Tours.list()).map(t => t.srcId));
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
          const r = await Tours.add({ name: a.name, sport: Sports.norm(a.sport_type || a.type), pts, src: 'strava', srcId: 'strava:' + a.id });
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
    async importAll(acc, onProgress) {
      const Z = Import.Zepp; let sums = [], nxt = null;
      for (;;) {
        const j = await Z.req(acc, '/v1/sport/run/history.json', nxt != null ? { trackid: nxt } : {});
        sums = sums.concat(j.data.summary || []);
        nxt = j.data.next; if (nxt == null || nxt === -1) break;
      }
      const have = new Set((await Tours.list()).map(t => t.srcId));
      const todo = sums.filter(s => !have.has('zepp:' + s.trackid));
      const res = { added: 0, dup: sums.length - todo.length, fail: 0 };
      const types = { 1: 'run', 6: 'walk', 9: 'bike', 8: 'run', 13: 'hike', 15: 'hike', 14: 'ski', 7: 'walk' };
      for (let i = 0; i < todo.length; i++) {
        const s = todo[i];
        if (onProgress) onProgress(i + 1, todo.length, F.dshort(s.trackid * 1000));
        try {
          const dj = await Z.req(acc, '/v1/sport/run/detail.json', { trackid: s.trackid, source: s.source || '' });
          const pts = Z.decode(s, dj.data);
          if (pts.length < 2) { res.dup++; continue; }
          const r = await Tours.add({ sport: types[s.type] || 'other', pts, src: 'zepp', srcId: 'zepp:' + s.trackid });
          if (r.dup) res.dup++; else res.added++;
        } catch (e) { res.fail++; }
      }
      await Photos.assignAll();
      return res;
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
