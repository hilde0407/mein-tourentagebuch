'use strict';
/* „Alles abgleichen“ (2.2.0): gemeinsames Fortschrittsblatt, am Ende eine Zusammenfassung mit einer Zeile je Quelle.
   Genutzt von der Importseite (ganz oben) und der Startseite (ruhige Zweitaktion). after(): danach, z. B. Seite neu zeichnen. */
const AllesUI = {
  async start(after) {
    if (Import.Alles.busy) { toast('Ein Abgleich läuft schon.'); return; }
    const qs = await Import.Alles.quellen();
    if (!qs.length) { toast(MTCalc.keineQuelle(MT.aktiv()), 6000); return; }
    let halt = false, r = null, err = null;
    try {
      r = await PhotoSources.progress('Alles abgleichen', upd => Import.Alles.run({ stop: () => halt, onProgress: (text, frac) => upd(frac, 1, null, text) }), { cancel: () => { halt = true; } });
    } catch (e) { err = e; }
    Tours.invalidate();
    const done = () => { if (after) after(); };
    if (err || !r) { toast((err && err.message) || 'Der Abgleich ist fehlgeschlagen.', 7000); done(); return; }
    const kopf = r.stopped ? 'Abgebrochen – der Rest kommt beim nächsten Mal.' : r.neu ? (r.neu === 1 ? '1 neue Tour' : r.neu + ' neue Touren') + ' im Tagebuch.' : 'Das Tagebuch ist auf dem neuesten Stand.';
    const s = sheet(r.stopped ? 'Abgleich abgebrochen' : 'Abgleich fertig', h('div', { id: 'sum' },
      h('p', { id: 'sum-head' }, kopf),
      UI.list(r.items.map(i => UI.row({ id: 'sum-' + i.id, title: i.name, sub: Abgleich.quellZeile(i, Import.describe), trail: i.err ? 'Fehler' : null }))),
      h('div', { class: 'row end' }, h('button', { class: 'btn pri', id: 'sum-ok', onclick: () => s.close() }, 'Fertig'))), { onclose: done });
  },
};

Views['/import'] = async root => {
  const body = h('div', { class: 'pad' });
  root.append(topbar('Touren importieren', { back: true }), body);
  /** Import mit Fortschrittsblatt. opts.cancel: abbrechbar; opts.after(fehler): nach dem Lauf (z. B. Anmeldeblatt erneut zeigen). */
  const run = async (title, fn, opts) => {
    if (Import.Alles.busy) { toast('Gerade läuft ein Abgleich – bitte kurz warten.'); return; }
    let err = null;
    try {
      const r = await PhotoSources.progress(title, (upd, txt) => fn(upd, txt), opts);
      const msg = r && r.added != null ? Import.describe(r) + (r.limit ? ' – ' + r.limit : '') : String(r);
      Tours.invalidate(); toast(msg, 7000);
    } catch (e) { err = e; toast(e.message, 8000); }
    if (opts && opts.after) opts.after(err);
  };
  const card = (ico, t, sub, fn, id) => UI.row({ icon: ico, title: t, sub, onclick: fn, id });
  /* Alles abgleichen: ganz oben, nur wenn mindestens eine Quelle verbunden ist */
  const allBox = h('div', { class: 'allbox', id: 'allbox', hidden: true });
  (async () => {
    const qs = await Import.Alles.quellen();
    if (!qs.length) return;
    const last = await DB.kvGet('abgleich', null);
    allBox.append(h('button', { class: 'btn pri', id: 'all-go', html: Ico.svg('refresh') + '<span>Alles abgleichen</span>', onclick: () => AllesUI.start(() => Nav.render()) }),
      h('p', { class: 'muted small', id: 'all-src' }, qs.map(q => q.name).join(' → ') + ' – verbundene Quellen nacheinander, mit den gespeicherten Einstellungen.' + (last && last.t ? ' ' + Abgleich.zeile(last) + '.' : '')),
      UI.toggle('Beim Öffnen automatisch abgleichen', !!Set_.get('autoAbgleich'), v => Set_.set('autoAbgleich', !!v), { id: 'auto-sync' }),
      h('p', { class: 'muted small' }, 'Still im Hintergrund, höchstens einmal am Tag und nur, wenn gerade nichts aufgezeichnet wird. Neue Touren meldet die App kurz.'));
    allBox.hidden = false;
  })().catch(() => {});
  body.append(allBox, h('p', { class: 'muted' }, 'Importierte Touren werden auf diesem Handy gespeichert. Doppelte Touren werden erkannt und übersprungen – du kannst jeden Import beliebig oft wiederholen.'),
    h('div', { class: 'list' },
      card('file', 'Dateien (GPX, FIT, TCX, ZIP)', 'Auch ganze Exporte von Strava, Garmin, Suunto, Polar, Wahoo …', () => run('Import', upd => Import.pickFiles(upd))),
      MT.aktiv() ? card('server', 'Meine Touren', 'Touren, Namen und Zahlen vom eigenen Server holen', mt, 'imp-mt') : null,      // 2.15.0: nur bei „Mit Meine Touren zusammenarbeiten“
      card('route', 'Komoot', 'Alle aufgezeichneten (und geplanten) Touren', komoot),
      card('run', 'Strava', 'Aktivitäten über die Strava-Schnittstelle', strava),
      card('watch', 'Zepp / Amazfit', 'Aktivitäten mit GPS direkt aus der Zepp-Cloud', zepp),
      card('bike', 'Bosch eBike Flow', 'Fahrten aus der Flow-App', bosch),
      card('compass', 'Garmin, Suunto, Polar, Wahoo, Coros …', 'Per Export, Teilen-Menü oder überwachtem Ordner', others),
      card('link', 'Link auf eine GPX-Datei', 'z. B. von Outdooractive, Wikiloc, RideWithGPS, Gipfelbuch', link)),
    UI.section('Aufräumen', UI.list([UI.row({ icon: 'swap', title: 'Doppelte Touren prüfen', sub: 'Gleiche Tour aus zwei Quellen finden und zusammenführen', href: '#/doppelt', id: 'imp-dup' }), UI.row({ icon: 'photo', title: 'Doppelte Fotos suchen', sub: 'Gleiche Fotos und Videos finden und aufräumen', href: '#/fotodoppelt', id: 'imp-fotodup' })])));

  /* „Meine Touren“ (eigener Server): verbinden, abgleichen, trennen. Gemerkt wird nur der Sitzungsschlüssel (kv „mt“), nie das Passwort. */
  async function mt() {
    if (!MT.aktiv()) return;
    const M = Import.MT, c = await DB.kvGet('mt', null), on = !!(c && (c.token || c.open));
    const zahlen = UI.toggle('Zahlen aus Meine Touren übernehmen (Aufstieg, Strecke)', Set_.get('mtZahlen') !== false, v => Set_.set('mtZahlen', !!v), { id: 'mt-zahlen' });
    const zHint = h('p', { class: 'muted small' }, 'Dann zeigen beide Apps für dieselbe Tour dieselben Zahlen. Korrigierst du eine Strecke in der App, gilt dort die eigene Rechnung – bis zum nächsten Abgleich.');
    const sync = acc0 => {
      let halt = false;
      run('Meine Touren', async (upd, txt) => {
        let acc = acc0;
        if (typeof acc0 === 'function') { txt.textContent = 'Anmelden …'; acc = await acc0(); }
        txt.textContent = 'Tourenliste laden …';
        return M.importAll(acc, { zahlen: Set_.get('mtZahlen') !== false, stop: () => halt }, upd);
      }, { cancel: () => { halt = true; }, after: e => { if (e && e.relogin) mt(); } });
    };
    if (on) {
      let host = c.base; try { host = new URL(c.base).host; } catch (e) { /* Adresse wie gemerkt */ }
      const s = sheet('Meine Touren', h('div', null,
        h('p', { id: 'mt-state' }, '✓ Verbunden mit ' + host + (c.name ? ' als ' + c.name : '') + (c.role === 'viewer' ? ' (nur ansehen)' : '')),
        c.role === 'viewer' ? h('p', { class: 'muted small', id: 'mt-viewer' }, 'Mit diesem Konto kann die App Touren holen, aber keine senden. Zum Senden brauchst du ein Konto mit Schreibrechten.')
          : c.open ? null : h('p', { class: 'muted small' }, 'Tipp: Zum Holen genügt ein Konto „nur ansehen“. Zum Senden von Touren braucht es ein Konto mit Schreibrechten.'),
        c.role === 'viewer' ? null : h('div', { id: 'mt-senden-box' },
          h('button', { class: 'btn', id: 'mt-senden', onclick: () => { s.close(); Senden.auswahl(() => mt()); } }, 'Touren senden …'),
          UI.toggle('Neue Aufzeichnungen automatisch senden', !!Set_.get('mtAuto'), v => Set_.set('mtAuto', !!v), { id: 'mt-auto' }),
          h('p', { class: 'muted small' }, 'Nur wenn du das einschaltest: Nach dem Ende einer Aufzeichnung wird die Tour still an Meine Touren gesendet. Klappt das nicht (kein Netz), versucht die App es später noch einmal.')),
        /^http:/.test(c.base) ? h('p', { class: 'muted small' }, 'Die Verbindung ist nicht verschlüsselt (http).') : null,
        zahlen, zHint,
        h('div', { class: 'row end wrap' },
          h('button', { class: 'btn', id: 'mt-off', onclick: async () => { await M.logout(c); s.close(); toast('Verbindung getrennt'); mt(); } }, 'Verbindung trennen'),
          h('button', { class: 'btn pri', id: 'mt-go', onclick: () => { s.close(); sync(c); } }, 'Abgleichen'))));
      return;
    }
    const url = h('input', { type: 'url', id: 'mt-url', value: c && c.base ? c.base : '', placeholder: 'https://meine-touren.example.ts.net', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' });
    const nm = h('input', { type: 'text', id: 'mt-name', value: c && c.name ? c.name : '', placeholder: 'Name', autocomplete: 'off', autocapitalize: 'off' });
    const pw = h('input', { type: 'password', id: 'mt-pw', placeholder: 'Passwort', autocomplete: 'off' });
    const warn = h('p', { class: 'muted small', id: 'mt-http', hidden: true });
    const check = () => {
      const v = url.value.trim(), http = /^http:\/\//i.test(v);
      let priv = false; try { priv = http && M.privat(M.base(v)); } catch (e) { /* noch unvollständig */ }
      warn.hidden = !http;
      warn.textContent = !http ? '' : priv ? 'Hinweis: http ist nicht verschlüsselt. Im eigenen Netz (WLAN zu Hause, Tailscale) ist das üblich.'
        : 'Achtung: Mit http gehen Name und Passwort unverschlüsselt durch das Netz. Besser eine Adresse mit https verwenden.';
    };
    url.addEventListener('input', check); check();
    const s = sheet('Meine Touren', h('div', null,
      h('p', { class: 'muted' }, 'Holt deine Touren aus „Meine Touren“ auf deinem eigenen Server: neue Touren mit Strecke, für vorhandene den Namen, die Sportart und die Zahlen. Die App liest nur. Am Server ändert sie nur dann etwas, wenn du ausdrücklich eine Tour sendest.'),
      h('label', { class: 'fld' }, 'Serveradresse', url), warn,
      h('label', { class: 'fld' }, 'Name', nm), h('label', { class: 'fld' }, 'Passwort', pw),
      h('p', { class: 'muted small' }, 'Empfohlen: in Meine Touren unter „Konto & Freigaben“ einen Betrachter (nur ansehen) anlegen und hier verwenden. Das Passwort wird nicht gespeichert, nur ein Sitzungsschlüssel auf diesem Handy. Er kommt in keine Sicherung.'),
      zahlen, zHint,
      h('div', { class: 'row end' }, h('button', { class: 'btn pri', id: 'mt-go', onclick: async () => {
        let base; try { base = M.base(url.value); } catch (e) { toast(e.message, 6000); return; }
        if (/^http:/.test(base) && !M.privat(base) && !await confirmBox('Unverschlüsselt verbinden?', 'Die Adresse beginnt mit http. Name und Passwort gehen dann unverschlüsselt durch das Netz und können mitgelesen werden. Sicherer ist eine Adresse mit https.', 'Trotzdem verbinden')) return;
        const name = nm.value, pass = pw.value;
        s.close();
        sync(async () => {
          let acc = await M.login(base, name, pass);
          if (acc.need2fa) {
            const code = await askText('Zweiter Schritt', 'Code aus der Authenticator-App', '', 'Anmelden');
            if (code == null || !code.trim()) throw new Error('Anmeldung abgebrochen');
            acc = await M.login2fa(base, acc.ticket, code);
          }
          return acc;
        });
      } }, 'Verbinden & abgleichen'))));
  }
  async function komoot() {
    const c = await DB.kvGet('komoot', null);
    const em = h('input', { type: 'email', value: c ? c.email : '', autocomplete: 'off', placeholder: 'E-Mail' }), pw = h('input', { type: 'password', placeholder: 'Passwort', autocomplete: 'off' });
    const pl = h('input', { type: 'checkbox', checked: !!Set_.get('komootPlanned') });
    const s = sheet('Komoot', h('div', null,
      h('p', { class: 'muted' }, 'Es wird dein Komoot-Zugang genutzt, um deine eigenen Touren zu laden. Das Passwort wird nicht gespeichert, nur ein Zugriffsschlüssel auf diesem Handy.'),
      c ? h('p', null, '✓ Angemeldet als ' + c.email) : null,
      c ? null : h('label', { class: 'fld' }, 'E-Mail', em), c ? null : h('label', { class: 'fld' }, 'Passwort', pw),
      h('label', { class: 'sw' }, pl, h('span', null, 'Auch geplante Touren laden')),
      h('div', { class: 'row end' }, c ? h('button', { class: 'btn', onclick: async () => { await DB.del('kv', 'komoot'); s.close(); komoot(); } }, 'Abmelden') : null,
        h('button', { class: 'btn pri', onclick: async () => {
          s.close(); await Set_.set('komootPlanned', !!pl.checked);      // „Alles abgleichen“ nutzt dieselbe Wahl
          await run('Komoot', async (upd, txt) => {
            let acc = c; if (!acc) { txt.textContent = 'Anmelden …'; acc = await Import.Komoot.login(em.value.trim(), pw.value); }
            txt.textContent = 'Tourenliste laden …';
            return Import.Komoot.importAll(acc, { planned: pl.checked }, upd);
          });
        } }, 'Touren laden'))));
  }
  async function strava() {
    const c = await DB.kvGet('strava', null), id = h('input', { inputmode: 'numeric', value: c ? c.id : Set_.get('stravaId') || '', placeholder: 'Client-ID' }), sec = h('input', { type: 'password', placeholder: 'Client-Secret', value: c ? c.secret : '' });
    const code = h('input', { placeholder: 'Adresse oder Code einfügen' });
    const s = sheet('Strava', h('div', null,
      c ? h('div', null, h('p', null, '✓ Verbunden' + (c.name ? ' als ' + c.name : '')), h('div', { class: 'row end' }, h('button', { class: 'btn', onclick: async () => { await DB.del('kv', 'strava'); s.close(); strava(); } }, 'Trennen'),
        h('button', { class: 'btn pri', onclick: () => { s.close(); run('Strava', upd => Import.Strava.importAll(c, upd)); } }, 'Aktivitäten laden'))) :
      h('div', null,
        h('ol', { class: 'steps' }, h('li', null, 'Auf strava.com/settings/api eine eigene Anwendung anlegen (Domain für die Weiterleitung: ', h('code', null, 'localhost'), ').'), h('li', null, 'Client-ID und Client-Secret hier eintragen.'), h('li', null, '„Bei Strava erlauben“ tippen und zustimmen. Die Seite danach lässt sich nicht öffnen – das ist normal.'), h('li', null, 'Die Adresse dieser Seite (enthält code=…) hier einfügen.')),
        h('label', { class: 'fld' }, 'Client-ID', id), h('label', { class: 'fld' }, 'Client-Secret', sec),
        h('button', { class: 'btn', onclick: async () => { if (!id.value.trim()) { toast('Bitte Client-ID eintragen'); return; } await Set_.set('stravaId', id.value.trim()); Native.available() ? MTApp.openUrl(Import.Strava.authUrl(id.value.trim())) : window.open(Import.Strava.authUrl(id.value.trim())); } }, 'Bei Strava erlauben'),
        h('label', { class: 'fld' }, 'Adresse / Code', code),
        h('div', { class: 'row end' }, h('button', { class: 'btn pri', onclick: async () => { try { const acc = await Import.Strava.exchange(id.value.trim(), sec.value.trim(), Import.Strava.parseCode(code.value)); s.close(); run('Strava', upd => Import.Strava.importAll(acc, upd)); } catch (e) { toast(e.message, 7000); } } }, 'Verbinden & laden'))),
      h('p', { class: 'muted small' }, 'Tipp: Strava erlaubt 100 Abfragen je 15 Minuten. Bei sehr vielen Aktivitäten einfach später erneut starten. Alternativ den kompletten Strava-Export (ZIP) über „Dateien“ importieren.')));
  }
  async function zepp() {
    const c = await DB.kvGet('zepp', null);
    const em = h('input', { type: 'email', placeholder: 'E-Mail', autocomplete: 'off' }), pw = h('input', { type: 'password', placeholder: 'Passwort', autocomplete: 'off' });
    const tk = h('input', { type: 'password', placeholder: 'Token einfügen (apptoken)', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' });
    const hs = h('input', { placeholder: 'leer = automatisch', autocomplete: 'off', autocapitalize: 'off' });
    // Hilfsprogramm für Lesezeichen/Adresszeile: liest den apptoken im Browser, wo man bei Zepp angemeldet ist, und zeigt ihn zum Kopieren an
    const bm = "javascript:(function(){var m=document.cookie.match(/(?:^|; )apptoken=([^;]+)/);if(!m){alert('Kein apptoken gefunden - bitte zuerst bei Zepp anmelden.');return;}var t=decodeURIComponent(m[1]);try{navigator.clipboard.writeText(t);}catch(e){}prompt('Token (wurde kopiert):',t);})()";
    const zo = () => ({ ele: Set_.get('zeppEle') !== false });
    const eleSw = h('div', null, UI.toggle('Höhen der Uhr übernehmen', Set_.get('zeppEle') !== false, v => Set_.set('zeppEle', !!v), { id: 'zp-ele' }),
      h('p', { class: 'muted small' }, 'Touren aus Komoot, Dateien oder eigener Aufzeichnung bekommen beim Laden die Barometerhöhen der Uhr. Rückholbar an der Tour: „Originalhöhen wiederherstellen“. Mit dem Geländemodell korrigierte Touren bleiben, wie sie sind.'));
    const run0 = (acc0) => { s.close(); run('Zepp', async (upd, txt) => { let acc = acc0; txt.textContent = 'Aktivitäten laden …'; return Import.Zepp.importAll(acc, upd, zo()); }); };
    const loggedIn = h('div', null, h('p', null, '✓ Angemeldet' + (c && c.viaToken ? ' (mit Token)' : '')),
      h('div', { class: 'row end wrap' },
        h('button', { class: 'btn', onclick: async () => { await DB.del('kv', 'zepp'); s.close(); zepp(); } }, 'Abmelden'),
        h('button', { class: 'btn', onclick: async () => { try { await Import.Zepp.req(c, '/v1/sport/run/history.json', {}); toast('Zugang funktioniert'); } catch (e) { toast(e.message, 8000); } } }, 'Zugang testen'),
        h('button', { class: 'btn', onclick: () => { s.close(); run('Höhe aus Uhr', async (upd, txt) => { txt.textContent = 'Zepp-Trainings laden …'; const r = await Fix.zeppEleAll(c, upd); return `Höhe aus Uhr abgeglichen: ${r.done} von ${r.total} passenden Touren` + (r.none ? `, ${r.none} ohne brauchbare Höhendaten` : '') + (r.fail ? `, ${r.fail} fehlgeschlagen` : ''); }); } }, '⌚ Höhe für alle Touren abgleichen'),
        h('button', { class: 'btn pri', onclick: () => run0(c) }, 'Aktivitäten laden')));
    const pass = h('div', null, h('p', { class: 'muted' }, 'Für Konten mit E-Mail und Passwort.'),
      h('label', { class: 'fld' }, 'E-Mail', em), h('label', { class: 'fld' }, 'Passwort', pw),
      h('div', { class: 'row end' }, h('button', { class: 'btn pri', onclick: () => { s.close(); run('Zepp', async (upd, txt) => { txt.textContent = 'Anmelden …'; const acc = await Import.Zepp.login(em.value.trim(), pw.value); txt.textContent = 'Aktivitäten laden …'; return Import.Zepp.importAll(acc, upd, zo()); }); } }, 'Anmelden & laden')));
    const inApp = Native.available() ? h('div', null,
      h('p', { class: 'muted' }, 'Für Konten mit Google-, Apple- oder Mi-Anmeldung (ohne Passwort): Die App öffnet die Zepp-Anmeldeseite, du meldest dich wie gewohnt an, die App übernimmt das Zugangs-Token selbst.'),
      h('div', { class: 'row end' }, h('button', { class: 'btn pri', onclick: async () => {
        let r; try { r = await Native.json('zeppLogin'); } catch (e) { toast(e.message, 7000); return; }
        if (!r || !r.token) { toast('Kein Token übernommen'); return; }
        let acc; try { toast('Token wird geprüft …'); acc = await Import.Zepp.useToken(r.token, hs.value); } catch (e) { toast(e.message, 9000); return; }
        run0(acc); } }, 'Bei Zepp anmelden')),
      null) : null;
    const tok = h('div', null, inApp,
      h('p', { class: 'muted' }, Native.available() ? 'Falls die Anmeldung in der App nicht klappt, kannst du das Zugangs-Token („apptoken“) auch von Hand holen:' : 'Für Konten mit Google-, Apple- oder Mi-Anmeldung (ohne Passwort). Du brauchst einmalig das Zugangs-Token („apptoken“) deines Zepp-Kontos:'),
      h('ol', { class: 'steps' },
        h('li', null, 'Im Handy-Browser (Chrome) ', h('code', null, 'user.huami.com/privacy2/index.html?platform_app=com.xiaomi.hm.health&loginPlatform=web'), ' öffnen und anmelden. Dort ', h('b', null, 'nichts'), ' antippen – die Seite bietet „Konto löschen“ an.'),
        h('li', null, 'Danach die Adresszeile antippen, den folgenden Text einfügen und abschicken (das Wort „javascript:“ vorne muss dabei stehen bleiben – manche Browser löschen es beim Einfügen, dann von Hand davor tippen). Es erscheint ein Fenster mit dem Token; es ist schon kopiert.'),
        h('li', null, 'Hier zurückkehren und das Token ins Feld einfügen.')),
      h('div', { class: 'row end wrap' }, h('button', { class: 'btn', onclick: async () => { try { await navigator.clipboard.writeText(bm); toast('Hilfstext kopiert'); } catch (e) { toast('Kopieren nicht möglich – Text manuell markieren', 6000); } } }, 'Hilfstext kopieren'),
        Native.available() ? h('button', { class: 'btn', onclick: () => MTApp.openUrl('https://user.huami.com/privacy2/index.html?platform_app=com.xiaomi.hm.health&loginPlatform=web') }, 'Zepp-Seite öffnen') : null),
      h('label', { class: 'fld' }, 'Token', tk), h('label', { class: 'fld' }, 'Server (nur falls nötig)', hs),
      h('p', { class: 'muted small' }, 'Das Token wird nur auf diesem Handy gespeichert und läuft nach einiger Zeit ab; dann einfach ein neues holen. Es gibt Zugriff auf deine Zepp-Daten – nicht weitergeben.'),
      h('div', { class: 'row end' }, h('button', { class: 'btn pri', onclick: async () => {
        let acc; try { toast('Token wird geprüft …'); acc = await Import.Zepp.useToken(tk.value, hs.value); } catch (e) { toast(e.message, 9000); return; }
        run0(acc); } }, 'Prüfen & laden')));
    const sel = h('div', { class: 'row' }, ['Mit Token', 'E-Mail / Passwort'].map((n, i) => h('button', { class: 'btn' + (i ? '' : ' pri'), onclick: e => { tok.hidden = !!i; pass.hidden = !i; [...sel.children].forEach((b, j) => b.classList.toggle('pri', j === i)); } }, n)));
    pass.hidden = true;
    if (c) loggedIn.insertBefore(eleSw, loggedIn.lastChild);      // angemeldet: Schalter über den Knöpfen
    const s = sheet('Zepp / Amazfit', c ? loggedIn : h('div', null, sel, tok, pass, eleSw));
  }
  function bosch() {
    const s = sheet('Bosch eBike Flow', h('div', null,
      h('p', null, 'Bosch bietet keine öffentliche Schnittstelle für Fahrten. So kommen sie trotzdem in die App:'),
      h('ol', { class: 'steps' }, h('li', null, 'In der Flow-App die Fahrt öffnen.'), h('li', null, 'Teilen/Exportieren wählen (GPX-Datei).'), h('li', null, 'Als Ziel „Mein Tourentagebuch“ wählen – die Fahrt wird sofort übernommen.')),
      h('p', { class: 'muted' }, 'Oder die exportierten Dateien hier auswählen. Alternativ in den Flow-Einstellungen die Verbindung zu Komoot/Strava nutzen und von dort importieren.'),
      h('div', { class: 'row end' }, h('button', { class: 'btn pri', onclick: () => { s.close(); run('Import', upd => Import.pickFiles(upd)); } }, 'Dateien wählen'))));
  }
  async function others() {
    const folders = await DB.kvGet('trackFolders', []);
    const s = sheet('Weitere Dienste', h('div', null,
      h('p', null, h('b', null, 'Teilen-Menü: '), 'In Garmin Connect, Suunto, Polar Flow, Wahoo, Coros, Outdooractive, Gipfelbuch … die Aktivität als GPX/FIT teilen und „Mein Tourentagebuch“ wählen.'),
      h('p', null, h('b', null, 'Datenexport: '), 'Vollständige Exporte (ZIP) über „Dateien“ importieren. Alle Aktivitäten darin werden übernommen.'),
      h('p', null, h('b', null, 'Überwachter Ordner: '), 'Ein Ordner, in den z. B. Syncthing, ein Cloud-Dienst oder die Garmin-Sync-App neue Dateien legt. Neue GPX/FIT/TCX-Dateien werden bei jedem Einlesen importiert.'),
      folders.length ? h('div', { class: 'list' }, folders.map((f, i) => h('div', { class: 'li' }, h('span', { class: 'li-i' }, '📁'), h('span', { class: 'li-t' }, h('b', null, decodeURIComponent(f.name))), h('button', { class: 'ico', 'aria-label': 'Entfernen', onclick: async () => { folders.splice(i, 1); await DB.kvSet('trackFolders', folders); s.close(); others(); } }, '✕')))) : null,
      h('div', { class: 'row end wrap' }, h('button', { class: 'btn', onclick: async () => { const f = await Native.json('pickFolder'); if (!f.tree) return; folders.push({ tree: f.tree, name: f.name, since: 0 }); await DB.kvSet('trackFolders', folders); s.close(); others(); } }, 'Ordner hinzufügen'),
        folders.length ? h('button', { class: 'btn pri', onclick: () => { s.close(); run('Ordner einlesen', upd => Import.scanFolders(upd)); } }, 'Jetzt einlesen') : null)));
  }
  function link() {
    const u = h('input', { type: 'url', placeholder: 'https://…', autocapitalize: 'off' });
    const s = sheet('Link importieren', h('div', null, h('label', { class: 'fld' }, 'Adresse der GPX-Datei', u), h('div', { class: 'row end' }, h('button', { class: 'btn pri', onclick: () => { s.close(); run('Link', async () => Import.fromUrl(u.value.trim())); } }, 'Laden'))));
  }
};

Views['/settings'] = async root => {
  const body = h('div', { class: 'pad' });
  root.append(topbar('Einstellungen', { back: true }), body);
  const sel = (label, key, opts) => h('label', { class: 'fld' }, label, h('select', { onchange: async e => { await Set_.set(key, e.target.value); } }, opts.map(([v, l]) => h('option', { value: v, selected: String(Set_.get(key)) === String(v) }, l))));
  const homeBox = () => {      // Heimatort suchen und übernehmen (Kartenmitte der Planung, Wetter, Vorschläge)
    const q = h('input', { type: 'text', placeholder: 'Ort oder Adresse suchen …', value: Set_.get('homeName') || '', autocapitalize: 'off' }),
      res = h('div'), st = h('p', { class: 'muted small' });
    const show = () => { st.textContent = Set_.get('homeLat') ? `📍 ${Set_.get('homeName') || ''} (${(+Set_.get('homeLat')).toFixed(3)}, ${(+Set_.get('homeLon')).toFixed(3)})` : 'Noch kein Heimatort eingetragen.'; };
    const search = async () => {
      const t = q.value.trim(); if (t.length < 2) return;
      res.textContent = 'Suche …';
      try {
        const r = await Native.http({ url: 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&accept-language=de&q=' + encodeURIComponent(t), headers: { 'User-Agent': 'MeinTourentagebuch/1.0' } });
        if (r.status !== 200) throw new Error('Ortssuche: HTTP ' + r.status);
        const l = JSON.parse(r.body); res.innerHTML = '';
        if (!l.length) { res.textContent = 'Nichts gefunden.'; return; }
        l.forEach(e => res.append(h('div', null, h('button', { class: 'btn sm', style: { margin: '4px 0', textAlign: 'left', justifyContent: 'flex-start' }, onclick: async () => {
          const name = e.display_name.split(',').slice(0, 2).join(',').trim();
          await Set_.set('homeName', name); await Set_.set('homeLat', (+e.lat).toFixed(5)); await Set_.set('homeLon', (+e.lon).toFixed(5));
          q.value = name; res.innerHTML = ''; show(); toast('Heimatort gespeichert');
        } }, '📍 ' + e.display_name))));
      } catch (er) { res.textContent = String(er.message || er); }
    };
    q.addEventListener('keydown', e => { if (e.key === 'Enter') search(); });
    show();
    return h('div', null, h('div', { class: 'row' }, q, h('button', { class: 'btn sm', onclick: search }, 'Suchen'),
      h('button', { class: 'btn sm', 'aria-label': 'Heimatort entfernen', onclick: async () => { for (const k of ['homeName', 'homeLat', 'homeLon']) await Set_.set(k, ''); q.value = ''; res.innerHTML = ''; show(); } }, '✕')), res, st);
  };
  const inp = (label, key, ph, type) => h('label', { class: 'fld' }, label, h('input', { type: type || 'text', value: Set_.get(key) || '', placeholder: ph || '', autocapitalize: 'off', onchange: async e => { await Set_.set(key, e.target.value.trim()); } }));
  const remind = h('div'), lastEl = () => $('#lastbk');
  const drawRemind = () => { remind.innerHTML = ''; remind.append(UI.chips([[7, '7 Tage'], [14, '14 Tage'], [30, '30 Tage'], [0, 'Aus']].map(([d, l]) => UI.chip(l, +Set_.get('backupDays') === d, async () => { await Set_.set('backupDays', d); drawRemind(); })), { id: 'bk-days' })); };
  drawRemind();
  const showLast = async () => { const t = await DB.kvGet('lastBackup', null); if (lastEl()) lastEl().textContent = 'Letzte Sicherung: ' + (t ? new Date(t).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : 'noch nie'); };
  // 2.10.0: Sicherung der Foto- und Videodateien (Medien) und automatische Tagessicherung in einen Ordner
  const fmtTag = t => new Date(t).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const mdStand = h('p', { class: 'muted small', id: 'md-stand' }, window.MTApp ? 'Wird gezählt …' : 'Nur in der Android-App.');
  const mdLast = h('p', { class: 'muted small', id: 'md-last' }, 'Zuletzt gesichert: –'), mdOrdner = h('p', { class: 'muted small', id: 'md-ordner' }, '');
  const showMedien = async () => {
    const st = await Medien.status();
    if (!mdStand.isConnected && Medien.refresh === showMedien) Medien.refresh = null;
    if (!st) { mdStand.textContent = window.MTApp ? 'Diese App-Version kann Fotos und Videos noch nicht sichern.' : 'Nur in der Android-App.'; return; }
    mdStand.textContent = (st.anzahl === 1 ? '1 Datei' : st.anzahl + ' Dateien') + ' · ' + SicherungCalc.groesse(st.bytes) + (st.anzahl ? ' · ' + SicherungCalc.neuZeile(st.neu, st.neuBytes, st.last) : '');
    mdLast.textContent = 'Zuletzt gesichert: ' + (st.last ? fmtTag(st.last) : 'noch nie');
    mdOrdner.textContent = st.folder ? 'Ordner: ' + st.folder.name + (st.folder.ok ? '' : ' (kein Zugriff mehr – bitte neu wählen)') : 'Ordner: noch keiner gewählt (wird beim ersten Sichern gefragt)';
    if (st.running) Medien.follow();
  };
  Medien.refresh = showMedien;
  // 2.12.0: vorhandene Videos in die Galerie kopieren – Zählung „N Videos noch nicht in der Galerie“
  const vgStand = h('p', { class: 'muted small', id: 'set-vgal-n' }, 'Wird gezählt …');
  const zeigeVg = async () => { const sc = await VideoGalerie.stand(); vgStand.textContent = VideoGalerie.zeile(sc); const b = $('#set-vgalcopy'); if (b) b.disabled = !(sc && sc.supported && sc.n); };
  const nT = await DB.count('tours'), nP = await DB.count('photos');
  body.append(
    MT.einstellung(),      // 2.15.0: ganz oben – „Mit Meine Touren zusammenarbeiten“
    h('h3', null, 'Karte'),
    h('div', { class: 'fld' }, 'Streckenfarbe', h('div', { class: 'chips wrap', id: 'rc' }, [['', 'Nach Sportart'], ['#e53935', 'Rot'], ['#fb8c00', 'Orange'], ['#fdd835', 'Gelb'], ['#43a047', 'Grün'], ['#1e88e5', 'Blau'], ['#8e24aa', 'Violett'], ['#d81b60', 'Pink'], ['#212121', 'Schwarz']].map(([c, n]) =>
      h('button', { class: 'chip' + ((Set_.get('routeColor') || '') === c ? ' on' : ''), 'aria-label': 'Streckenfarbe ' + n, style: c ? { borderColor: c, borderWidth: '3px' } : {}, onclick: async e => { await Set_.set('routeColor', c); $('#rc').querySelectorAll('.chip').forEach(b => b.classList.remove('on')); e.currentTarget.classList.add('on'); } }, n)))),
    sel('Kartenquelle', 'tiles', Object.entries(MapKit.providers).map(([k, v]) => [k, v.name])),
    inp('Eigene Kachel-Adresse', 'tileUrl', 'https://…/{z}/{x}/{y}.png?key={key}'), inp('Schlüssel (für {key})', 'tileKey', ''),
    UI.list([UI.row({ icon: 'download', title: 'Offline-Karten', sub: 'Ausschnitte für unterwegs laden, gesehene Kacheln merken', href: '#/offline', id: 'set-offline' })]),
    h('p', { class: 'muted small' }, 'Hinweis: Die öffentlichen OpenStreetMap-Kartenserver sind nur für leichte, private Nutzung gedacht. Für intensiven Einsatz bitte einen eigenen Anbieter eintragen.'),
    UI.toggle('Karte im PDF (braucht Internet)', Set_.get('pdfKarte') !== false, v => Set_.set('pdfKarte', !!v), { id: 'pdf-karte' }),
    h('p', { class: 'muted small' }, 'Beim Tour-PDF lädt die App dafür einen Kartenausschnitt von OpenStreetMap (nur zum Zeichnen, nichts wird gespeichert). Vorhandene Kacheln nimmt sie zuerst: eine Offline-Karte, die den ganzen Ausschnitt enthält, oder gemerkte Kacheln. Fehlt etwas ohne Internet, oder ist der Schalter aus, steht die Streckenskizze im PDF.'),
    h('h3', null, 'Routing'), inp('Routing-Server (BRouter)', 'routeUrl', 'https://brouter.de/brouter'), inp('Profil überschreiben (optional)', 'routeProfile', 'z. B. trekking'),
    h('h3', null, 'Fotos'), sel('Zeitfenster um die Tour', 'photoMargin', [[0, 'genau'], [10, '10 Minuten'], [20, '20 Minuten'], [45, '45 Minuten'], [90, '90 Minuten']]),
    h('button', { class: 'btn', onclick: async () => toast((await Photos.assignAll(true)) + ' Foto(s) neu zugeordnet') }, 'Alle Fotos neu zuordnen'),
    // 2.9.0: Videos aufnehmen – die Hülle bekommt die Werte über Videos.prefs()
    h('h3', { id: 'set-video-h' }, 'Videos'),
    h('label', { class: 'fld' }, 'Längste Video-Aufnahme', h('select', { id: 'set-vlimit', onchange: async e => { await Set_.set('videoLimit', e.target.value); Videos.prefs(); } },
      VideoCalc.LIMITS.map(([v, l]) => h('option', { value: v, selected: String(Set_.get('videoLimit')) === v }, l)))),
    UI.toggle('Aufgenommene Videos auch in der Galerie speichern', Set_.get('videoGallery') !== false, async v => { await Set_.set('videoGallery', !!v); Videos.prefs(); }, { id: 'set-vgal' }),
    h('p', { class: 'muted small' }, 'Ab Android 10 im Ordner „Movies/Tourentagebuch“, ohne zusätzliche Berechtigung. Auf älteren Handys wird keine Kopie angelegt. Das Video bleibt in jedem Fall auch in der App.'),
    window.MTApp ? h('div', { class: 'vg-box' }, vgStand, h('button', { class: 'btn', id: 'set-vgalcopy', onclick: () => VideoGalerie.kopieren(zeigeVg) }, 'Vorhandene Videos in die Galerie kopieren')) : null,
    UI.toggle('HEVC-Videos beim Aufnehmen automatisch umwandeln', !!Set_.get('videoAuto'), async v => { await Set_.set('videoAuto', !!v); Videos.prefs(); }, { id: 'set-vauto' }),
    h('p', { class: 'muted small' }, 'Aus: Videos bleiben, wie die Kamera sie speichert; der Player der App spielt sie ab. Umwandeln in H.264 geht jederzeit unter Foto-Quellen oder in den Details eines Videos.'),
    // 2.12.0: Akku-Optimierung – ehrlich: die App kann sie nicht selbst ausschalten (keine Sonderberechtigung), nur die Einstellung öffnen
    h('h3', { id: 'set-rec-h' }, 'Aufzeichnung'),
    h('p', { class: 'muted small', id: 'set-akku-txt' }, 'Manche Handys beenden Apps im Hintergrund, um Akku zu sparen – dann bricht eine lange Aufnahme ab. Öffne die Akku-Einstellungen, suche „Tourentagebuch“ und wähle „Nicht eingeschränkt“ (je nach Handy auch „Nicht optimieren“). Die App kann das nicht selbst einstellen. Bricht eine Aufnahme trotzdem ab, sind die Punkte bis dahin gesichert, und die App bietet beim nächsten Öffnen Fortsetzen oder Speichern an.'),
    window.MTApp ? h('p', { class: 'muted small', id: 'set-akku-stand' }, RecRescue.akkuZeile()) : null,
    window.MTApp ? h('button', { class: 'btn', id: 'set-akku', onclick: () => MTApp.openBatterySettings() }, 'Akku-Einstellungen öffnen') : h('p', { class: 'muted small' }, 'Nur in der Android-App.'),
    h('h3', null, 'Heimatort'), homeBox(),
    h('h3', null, 'Puls'), inp('Maximalpuls (bpm)', 'hrMax', 'z. B. 185', 'number'),
    h('p', { class: 'muted small' }, 'Danach richten sich die fünf Pulszonen. Ohne Angabe wird mit 190 bpm gerechnet. Die Pulswerte selbst kommen aus den importierten Dateien (GPX, TCX, FIT) oder von Zepp.'),
    h('h3', null, 'Fitness-Einordnung'), h('p', { class: 'muted small' }, 'Das Geburtsjahr braucht die Fitness-Einordnung in der Statistik (nur das Jahr). Es bleibt auf diesem Handy und kommt in keine Diashow und keinen Export.'), FitUI.yearBox(null, { label: 'Geburtsjahr' }),
    h('h3', { id: 'homeset-h' }, 'Startseite'), h('p', { class: 'muted small' }, 'Was unter den Hauptknöpfen steht. Die Reihenfolge ist fest. Den Hinweis auf die Sicherung stellst du unter Datensicherung ein.'),
    h('div', { id: 'homeset' }, Home.blocks.filter(b => b.meta).map(b => h('div', { class: 'hs-row' }, UI.toggle(b.meta.label, Home.shown(b), async on => {
      const m = Object.assign({}, Set_.get('homeShow') || {}); m[b.id] = !!on; await Set_.set('homeShow', m);
    }, { id: 'hs-' + b.id }), b.meta.sub ? h('p', { class: 'muted small' }, b.meta.sub) : null))),
    h('h3', null, 'Datensicherung'), h('p', { class: 'muted' }, `${nT} Touren · ${nP} Fotos. Alle Daten liegen nur auf diesem Handy. Mach regelmäßig eine Sicherung und speichere sie außerhalb des Handys.`),
    h('p', { class: 'muted small', id: 'lastbk' }, 'Letzte Sicherung: noch nie'),
    h('p', { class: 'muted small', id: 'bk-media' }, 'Die Foto- und Videodateien sind in dieser Sicherung nicht enthalten, nur ihre Einträge (Zeit, Ort, Tour). Die Dateien sicherst du getrennt unter „Fotos und Videos sichern“. Offline-Karten sind auch nicht enthalten – sie lassen sich jederzeit neu laden.'),
    h('div', { class: 'row wrap' }, h('button', { class: 'btn pri', id: 'bk-save', onclick: async () => { try { await Backup.save(); showLast(); } catch (e) { toast(e.message, 7000); } } }, 'Sicherung speichern'), h('button', { class: 'btn', id: 'bk-restore', onclick: Backup.restore }, 'Sicherung einspielen')),
    h('div', { class: 'fld' }, 'Erinnern, wenn die letzte Sicherung älter ist als', remind),
    h('p', { class: 'muted small' }, 'Touren und Fotos/Videos werden getrennt gezählt; die Startseite zeigt höchstens eine Zeile.'),
    UI.toggle('Automatisch in Ordner sichern', !!Set_.get('backupAuto'), async (on, e) => {
      if (!on) { await Set_.set('backupAuto', false); return; }
      const f = await Medien.ordner(false);
      if (!f) { e.target.checked = false; return; }
      await Set_.set('backupAuto', true); showMedien();
      toast('Ab jetzt einmal am Tag beim Start in „' + f.name + '“', 5000);
      Backup.auto().then(r => { if (r) showLast(); });
    }, { id: 'bk-auto' }),
    h('p', { class: 'muted small' }, 'Beim Öffnen der App höchstens einmal am Tag eine neue Sicherung (.mtl, ohne Foto- und Videodateien) in den Sicherungsordner. Die letzten 5 bleiben, ältere löscht die App. Fotos und Videos werden nur auf Knopfdruck gesichert.'),
    h('h3', { id: 'md-h' }, 'Fotos und Videos sichern'),
    h('p', { class: 'muted small' }, 'Die App speichert die Dateien als ZIP in einen Ordner deiner Wahl, am besten auf einer Speicherkarte, einem USB-Stick oder in einem Ordner, den du danach auf den Computer kopierst. Beim nächsten Mal kommt nur Neues in eine weitere Datei „Medien_<Datum>.zip“ – bewahre alle auf. Große Sicherungen werden in Teile zu höchstens 1,5 GB geteilt.'),
    mdStand, mdLast, mdOrdner,
    h('div', { class: 'row wrap' }, h('button', { class: 'btn pri', id: 'md-save', onclick: async () => { await Medien.sichern(); showMedien(); } }, 'Sichern'),
      h('button', { class: 'btn', id: 'md-restore', onclick: async () => { await Medien.wiederherstellen(); showMedien(); } }, 'Wiederherstellen'),
      h('button', { class: 'btn', id: 'md-folder', onclick: async () => { const f = await Medien.ordner(true); if (f) toast('Sicherungsordner: ' + f.name, 4000); showMedien(); } }, 'Ordner ändern')),
    h('p', { class: 'muted small' }, 'Wiederherstellen: eine oder mehrere Medien-Sicherungen wählen. Fotos und Videos, die schon auf dem Handy sind, bleiben unverändert.'),
    h('h3', null, 'Über'), h('p', { class: 'muted small' }, 'Mein Tourentagebuch ' + (window.MTApp ? MTApp.version() : '(Browser)') + ' · Kartendaten © OpenStreetMap-Mitwirkende · Leaflet (BSD-2), fflate (MIT), OkHttp (Apache-2.0), smbj (Apache-2.0)'),
    h('div', { class: 'row wrap' }, window.MTApp ? h('button', { class: 'btn sm', onclick: () => { const s = sheet('Protokoll', h('pre', { class: 'log' }, MTApp.logText() || '(leer)')); void s; } }, 'Protokoll') : null,
      h('button', { class: 'btn sm danger', onclick: wipe }, 'Alle Daten löschen')));

  showLast(); showMedien(); if (window.MTApp) zeigeVg();
  async function wipe() {
    if (!await confirmBox('Alle Daten löschen?', 'Touren, Spuren und Foto-Einträge werden unwiderruflich von diesem Handy gelöscht.', 'Alles löschen')) return;
    for (const s of ['tours', 'tracks', 'photos']) await DB.clear(s);
    for (const e of await DB.all('kv')) if (e.k.startsWith('pn:')) await DB.del('kv', e.k);      // Notizen und Links der gelöschten Planungen
    Tours.invalidate(); toast('Gelöscht'); Nav.render();
  }
};
