"""Prüft die Lesbarkeit (WCAG-Kontrast) in Hell und Dunkel: alle Knöpfe, Chips, Links und Felder mit 4,5 : 1,
dazu jeden sichtbaren Text (große Schrift ab 24 px bzw. 18,66 px fett mit 3 : 1). Aufruf: python tests/audit_kontrast.py [--fail]"""
import json, socketserver, sys, threading, os
sys.path.insert(0, os.path.dirname(__file__))
from playwright.sync_api import sync_playwright
import test_web as T

JS = """() => {
  const parse = c => { const m = c.match(/rgba?\\(([^)]+)\\)/); if (!m) return null; const p = m[1].split(/[ ,\\/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const lum = c => { const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }; return .2126 * f(c.r) + .7152 * f(c.g) + .0722 * f(c.b); };
  const over = (top, bot) => ({ r: top.r * top.a + bot.r * (1 - top.a), g: top.g * top.a + bot.g * (1 - top.a), b: top.b * top.a + bot.b * (1 - top.a), a: 1 });
  /* Hintergrund: eigene Fläche oder eine vollflächige ::before-Fläche (so ist das Wegweiserschild gebaut) */
  const layer = e => { const c = parse(getComputedStyle(e).backgroundColor); if (c && c.a > 0) return c;
    const p = getComputedStyle(e, '::before'); if (p.content !== 'none' && p.position === 'absolute' && p.top === '0px' && p.bottom === '0px' && p.left === '0px' && p.right === '0px') { const q = parse(p.backgroundColor); if (q && q.a > 0) return q; } return null; };
  const bgOf = el => { const layers = []; for (let e = el; e; e = e.parentElement) { const c = layer(e); if (c) { layers.push(c); if (c.a >= 1) break; } } let base = { r: 255, g: 255, b: 255, a: 1 }; for (let i = layers.length - 1; i >= 0; i--) base = over(layers[i], base); return base; };
  const out = [], seen = new Set();
  const check = (el, kind) => {
    if (seen.has(el)) return; seen.add(el);
    if (el.closest('.leaflet-container, .hero.pic, .lb, .sh, .flight, .sph')) return;      // Schrift auf Karten und Bildern: eigene dunkle Unterlage, hier nicht messbar
    const r = el.getBoundingClientRect(); if (r.width < 4 || r.height < 4) return;
    const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) return;
    for (let e = el.parentElement; e; e = e.parentElement) { const c = getComputedStyle(e); if (c.display === 'none' || c.visibility === 'hidden' || +c.opacity === 0) return; }
    const txt = kind === 'text' ? [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.nodeValue).join(' ').trim() : (el.value && el.tagName === 'INPUT' ? '' : (el.innerText || '')).trim();
    if (!txt && el.tagName !== 'SELECT') return;
    const fg0 = parse(cs.color); if (!fg0) return;
    const bg = bgOf(el), fg = over(fg0, bg);
    const L1 = lum(fg), L2 = lum(bg), ratio = (Math.max(L1, L2) + .05) / (Math.min(L1, L2) + .05);
    const dis = el.disabled || el.getAttribute('aria-disabled') === 'true';
    const px = parseFloat(cs.fontSize), big = px >= 24 || (px >= 18.66 && +cs.fontWeight >= 700);      // große Schrift: 3 : 1 genügt (WCAG)
    if (ratio < (kind === 'text' && big ? 3 : 4.5)) out.push({ ratio: Math.round(ratio * 100) / 100, txt: txt.slice(0, 30), cls: (el.className && el.className.baseVal === undefined ? el.className : '') + '|' + el.tagName + (kind === 'text' ? ' (Text)' : ''), fg: cs.color, bg: `rgb(${Math.round(bg.r)},${Math.round(bg.g)},${Math.round(bg.b)})`, dis });
  };
  document.querySelectorAll('button, a:not(.leaflet-marker-icon), .btn, .chip, [role=button], label.sw, summary, select, input:not([type=checkbox]):not([type=radio])').forEach(el => { if (!el.closest('.leaflet-marker-icon')) check(el, 'ctl'); });
  /* dazu jeder sichtbare Text: Überschriften, Kennzahlen, Etiketten, Fließtext */
  document.querySelectorAll('#view *, #tabs *, .sheet *, #toast').forEach(el => { if ([...el.childNodes].some(n => n.nodeType === 3 && n.nodeValue.trim())) check(el, 'text'); });
  return out;
}"""

def main():
    srv = socketserver.TCPServer(("127.0.0.1", 0), T.Q); port = srv.server_address[1]
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    bad = {}
    with sync_playwright() as p:
        b = p.chromium.launch()
        for scheme in ("light", "dark"):
            ctx = b.new_context(viewport={"width": 390, "height": 800}, color_scheme=scheme, permissions=["geolocation"], geolocation={"latitude": 47.0, "longitude": 11.0})
            ctx.add_init_script(T.MOCK); pg = ctx.new_page()
            png = bytes.fromhex("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000001e221bc330000000049454e44ae426082")
            pg.route("**/tile.openstreetmap.org/**", lambda r: r.fulfill(status=200, body=png, content_type="image/png", headers={"access-control-allow-origin": "*"}))
            pg.goto(f"http://127.0.0.1:{port}/index.html"); pg.wait_for_selector("#tabs a")
            # 2.15.0: Erststart mit der Frage „Nutzt du auch Meine Touren?“, danach mit Meine Touren weiter (die Szenen unten brauchen die Knöpfe)
            pg.wait_for_selector("#mt-frage"); pg.wait_for_timeout(300)
            for item in pg.evaluate(JS): bad.setdefault(("Erststart, Frage Meine Touren", item["txt"], item["cls"], item["fg"], item["bg"], scheme), item)
            pg.evaluate(T.MT_AN)
            t0 = 1700000000000
            pg.evaluate("""async ([a,b]) => { const e=s=>new TextEncoder().encode(s); await Import.fromData('a.gpx',e(a),'file'); await Import.fromData('b.gpx',e(b),'file'); }""",
                        [T.gpx(t0, name="Hüttenrunde"), T.gpx(t0 + 86400000 * 40, lat=47.2, name="Zweite Tour")])
            routes = ["#/jahr", "#/jahr/2023", "#/jahr/2031", "#/start", "#/", "#/mehr", "#/rec", "#/map", "#/photos", "#/stats", "#/import", "#/settings", "#/sources", "#/plan", "#/reisen"]
            tid = pg.evaluate("DB.all('tours').then(a => a[0].id)")
            routes += [f"#/tour/{tid}", f"#/story/{tid}", f"#/fix/{tid}"]
            for r in routes:
                pg.evaluate(f"location.hash='{r}'"); pg.wait_for_timeout(700)
                for item in pg.evaluate(JS): bad.setdefault((r, item["txt"], item["cls"], item["fg"], item["bg"], scheme), item)
            # Blätter (Sheets) der Importseite
            pg.evaluate("location.hash='#/import'"); pg.wait_for_selector(".list")
            for name in ("Meine Touren", "Komoot", "Strava", "Zepp / Amazfit", "Bosch eBike Flow", "Garmin, Suunto", "Link auf eine GPX-Datei"):
                try:
                    pg.get_by_text(name, exact=False).first.click(); pg.wait_for_timeout(400)
                    for item in pg.evaluate(JS): bad.setdefault(("import:" + name, item["txt"], item["cls"], item["fg"], item["bg"], scheme), item)
                    pg.evaluate("(sheet.stack || []).slice().forEach(x => x.close())"); pg.wait_for_timeout(200)
                except Exception as e: print("übersprungen:", name, str(e)[:60])
            pg.evaluate("location.hash='#/stats'"); pg.wait_for_selector(".chips")
            for tabname in ("Bestwerte", "Kalender", "Auswertung", "Ziele", "Fitness"):
                pg.get_by_role("button", name=tabname, exact=True).click(); pg.wait_for_timeout(500)
                for item in pg.evaluate(JS): bad.setdefault(("Statistik " + tabname, item["txt"], item["cls"], item["fg"], item["bg"], scheme), item)
            # Funktionen aus „Meine Touren“ (2.0.0): Rückblick, Plan und Ergebnis, Planungshilfe, Fitness, Ziele, Startseite mit allen Bausteinen
            def scan(label):
                for item in pg.evaluate(JS): bad.setdefault((label, item["txt"], item["cls"], item["fg"], item["bg"], scheme), item)
            def go(h, sel): pg.evaluate("h => { if (location.hash === h) Nav.render(); else location.hash = h; }", h); pg.wait_for_selector(sel); pg.wait_for_timeout(400)
            neu = pg.evaluate("""async () => {
              const mk = async (name, ago, n, status) => { const base = Math.floor(Date.now() / 86400000) * 86400000 + 8 * 3600000 - ago * 86400000;
                const pts = Array.from({ length: n }, (_, i) => ({ lat: 46 + ago * 0.01 + i * 0.0005, lon: 9, ele: 800 + i * 3, t: status ? null : base + i * 60000 }));
                return (await Tours.add({ name, sport: 'hike', pts, src: 'file', status: status || 'done' })).tour; };
              for (let i = 0; i < 6; i++) await mk('Vergleich ' + i, 75 - i * 11, 40);
              const big = await mk('Große Runde', 5, 120), plan = await mk('Plan Hochtour', 0, 200, 'planned'), plan2 = await mk('Plan Runde', 0, 40, 'planned'), run = await mk('Gelaufen nach Plan', 3, 45);
              run.plan = plan2.id; await Tours.save(run);
              await DB.kvSet('pn:' + plan.id, { note: 'Parkplatz am See', quelle: { art: 'komoot', text: 'Tour 123' }, links: [{ titel: 'Karte', url: 'https://www.komoot.de/tour/1', art: 'karte' }, { titel: 'Lawinenbericht', url: 'https://lawinen.report/', art: 'wetter' }] });
              const y = new Date().getFullYear();
              await Goals.save([{ id: 'a1', period: 'year', year: y, metric: 'km', target: 400, sport: '' }, { id: 'a2', period: 'week', year: 0, metric: 'count', target: 2, sport: 'grp:foot' }, { id: 'a3', period: 'year', year: y - 1, metric: 'up', target: 9000, sport: '' }]);
              await Set_.set('birthYear', 1975); await Set_.set('homeShow', { serie: true, fitness: true }); await DB.del('kv', 'lastBackup'); await DB.kvSet('backupSnooze', 0);
              return { big: big.id, plan: plan.id, run: run.id }; }""")
            go("#/start", "#fitness-home"); pg.wait_for_selector("#backupnote"); pg.wait_for_selector("#serie"); scan("Start, alle Bausteine")
            go("#/tour/" + neu["big"], "#rueckblick"); scan("Tour, Rückblick")
            go("#/tour/" + neu["run"], "#planergebnis"); scan("Tour, Plan und Ergebnis")
            go("#/tour/" + neu["plan"], "#pnotes-sec"); scan("Planung, Hilfe")
            for start, puffer, label in (("13:00", "100", "spät"), ("09:00", "150", "Fehler")):      # Rückkehr nach Sonnenuntergang; ungültiger Puffer (Fehlertext)
                pg.fill("#tl-date", "2026-12-21"); pg.fill("#tl-start", start); pg.fill("#tl-puffer", puffer); pg.dispatch_event("#tl-puffer", "change"); pg.wait_for_timeout(300); scan("Planung, Tageslicht " + label)
            pg.fill("#tl-puffer", "20"); pg.dispatch_event("#tl-puffer", "change")
            pg.evaluate("document.querySelector('#pn-addlink').click()"); pg.wait_for_selector("#lk-url"); pg.click("#lk-save"); pg.wait_for_selector(".sheet .err:not(:empty)"); scan("Planung, Link hinzufügen")
            pg.evaluate("(sheet.stack || []).slice().forEach(x => x.close())"); pg.wait_for_timeout(250)
            go("#/stats/fitness", "#fit-total"); pg.click("#fit-how summary"); pg.wait_for_timeout(200); scan("Fitness")
            pg.click("#fit-chg"); pg.wait_for_selector("#fit-year"); pg.fill("#fit-year", "1850"); pg.click("#fit-save"); pg.wait_for_timeout(250); scan("Fitness, Geburtsjahr")
            pg.evaluate("Set_.set('birthYear', '')"); go("#/stats/fitness", "#fit-year"); scan("Fitness ohne Geburtsjahr"); pg.evaluate("Set_.set('birthYear', 1975)")
            go("#/stats/ziele", "#goals .ygoal"); scan("Ziele"); pg.click("#goaladd"); pg.wait_for_selector("#goalsave"); pg.click("#goalsave"); pg.wait_for_timeout(250); scan("Ziele, Blatt"); pg.evaluate("(sheet.stack || []).slice().forEach(x => x.close())"); pg.wait_for_timeout(250)
            go("#/stats/rekorde", "#bestwerte .li"); pg.click("#bestwerte .seg button:has-text('Beste drei')"); pg.wait_for_timeout(300); scan("Bestwerte, beste drei"); pg.click("#bestwerte .seg button:text-is('Beste')"); pg.wait_for_timeout(200)
            go("#/settings", "#homeset"); scan("Einstellungen, Startseite")
            go("#/settings", "#akt-box"); pg.locator("#akt-katalog").scroll_into_view_if_needed(); scan("Einstellungen, Sportarten-Katalog (2.19.0)")
            go("#/settings", "#sg-vorschlag-berg"); pg.click("#sg-vorschlag-berg"); pg.wait_for_selector("#sg-grp-0"); pg.click("#sg-add"); pg.wait_for_timeout(250); scan("Einstellungen, Statistik-Gruppen und Favoriten (2.19.0)")      # gesperrte Sportarten, Hinweis einer unfertigen Gruppe
            pg.evaluate("Set_.set('statGruppen', [])"); go("#/rec", ".bigstart"); pg.click("#rec-mehr"); pg.wait_for_selector("#rec-alle"); scan("Aufnehmen, alle Sportarten (2.19.0)"); pg.evaluate("(sheet.stack || []).slice().forEach(x => x.close())"); pg.wait_for_timeout(250)
            # 2.11.0: Offline-Karten (Liste mit unvollständiger Karte, Schätzung über der Grenze)
            pg.evaluate(T.OFF_MOCK)
            pg.evaluate("""() => { __off.areas = [{ id: 'a1', name: 'Karwendel', src: 'topo', kind: 'rect', zmin: 10, zmax: 15, tiles: 1234, have: 1200, bytes: 29e6, date: Date.now(), complete: false },
              { id: 'a2', name: 'Hüttenrunde', src: 'topo', kind: 'route', zmin: 10, zmax: 16, tiles: 800, have: 800, bytes: 18e6, date: Date.now(), complete: true }]; __off.bytes = 47e6; }""")
            go("#/offline", "#off-liste .offli"); scan("Offline-Karten")
            pg.evaluate("document.querySelector('#off-map').__karte.setZoom(8, { animate: false })"); pg.wait_for_function("() => document.querySelector('#off-est').textContent.includes('Zu groß')"); scan("Offline-Karten, zu groß")
            pg.evaluate("() => { window.MTApp.call = window.__offcall0; try { localStorage.removeItem('offlineAreas'); } catch (e) {} Offline.gebiete = null; }")
            pg.evaluate("(async () => { await Set_.set('homeShow', {}); await DB.kvSet('lastBackup', Date.now()); })()")
            # 2.1.0: Meine Touren (anmelden mit Hinweis, verbunden, zweiter Schritt, Fortschritt mit „Abbrechen“), Zepp mit Schalter, Doppelte Touren (Paare, Rückfrage, leer), Tourseite mit Zahlen aus Meine Touren
            zu = lambda: (pg.evaluate("(sheet.stack || []).slice().forEach(x => x.close())"), pg.wait_for_timeout(250))
            go("#/import", "#imp-mt"); pg.click("#imp-mt"); pg.wait_for_selector("#mt-url"); pg.fill("#mt-url", "http://touren.example.org"); pg.fill("#mt-name", "Tagebuch"); pg.wait_for_timeout(300); scan("Meine Touren, anmelden"); zu()
            pg.evaluate("DB.kvSet('mt', { base: 'http://192.168.178.20:8000', name: 'Volker', role: 'admin', token: 'x' })"); pg.click("#imp-mt"); pg.wait_for_selector("#mt-off"); pg.wait_for_timeout(300); scan("Meine Touren, verbunden"); zu()
            pg.evaluate("() => { askText('Zweiter Schritt', 'Code aus der Authenticator-App', '', 'Anmelden'); }"); pg.wait_for_timeout(400); scan("Zweiter Schritt"); zu()
            pg.evaluate("() => { PhotoSources.progress('Meine Touren', upd => new Promise(r => { upd(3, 12, 'Kramerspitz'); window.__progEnd = r; }), { cancel: () => {} }); }"); pg.wait_for_selector("#prog-stop"); pg.wait_for_timeout(300); scan("Fortschritt"); pg.click("#prog-stop"); pg.wait_for_timeout(150); scan("Fortschritt, abgebrochen"); zu(); pg.evaluate("window.__progEnd()")
            pg.evaluate("DB.kvSet('zepp', { token: 'x', viaToken: true })"); pg.get_by_text("Zepp / Amazfit").click(); pg.wait_for_selector("#zp-ele"); pg.wait_for_timeout(300); scan("Zepp, angemeldet"); zu()
            go("#/doppelt", "text=Keine doppelten Touren gefunden"); scan("Doppelte, leer")
            dup = pg.evaluate(T.DUP_DATEN)
            pg.evaluate("async id => { const t = await DB.get('tours', id); Object.assign(t, { mtId: 'g1', zMt: 1, upMt: 655, downMt: 650, distMt: Math.round(t.dist) + 40, starsMt: 4, upSrc: 'mt', up: 655, down: 650, dist: Math.round(t.dist) + 40 }); await Tours.save(t); }", dup["K"])
            go("#/doppelt", "section.dup .dup-a"); scan("Doppelte, Paare"); pg.locator("section.dup button[data-a=merge]").first.click(); pg.wait_for_timeout(400); scan("Doppelte, Rückfrage"); zu()
            go("#/tour/" + dup["K"], "#mtinfo"); scan("Tour, Zahlen aus Meine Touren")
            pg.evaluate("async (d) => { for (const k of ['K', 'Z', 'X', 'Y']) await Tours.remove(d[k]); for (const i of [1, 2]) await DB.del('photos', 'dupfoto' + i); await DB.del('kv', 'mt'); await DB.del('kv', 'zepp'); }", dup)
            # 2.5.0: PDF und Senden (Jahresrückblick mit „Als PDF“, Tourmenü, Blätter zum Senden und zum PDF)
            bd = T.blaetter_setup(pg)
            go("#/jahr/%d" % bd["jahr"], "#jahr-pdf"); scan("Jahresrückblick, Als PDF")
            for lab in T.blaetter_zustaende(pg, bd): pg.wait_for_timeout(250); scan(lab)
            T.blaetter_ende(pg, bd)
            # 2.4.0: Wanderführer (leer, Bücher zugeklappt und aufgeklappt, Filter, Blätter, Startseite, Tourseite)
            go("#/fuehrer", "#fu-add2"); scan("Wanderführer, leer")
            pg.click("#fu-add2"); pg.wait_for_selector("#fu-go"); pg.click("#fu-go"); pg.wait_for_selector("#fu-err:not(:empty)"); scan("Wanderführer, Buch anlegen mit Hinweis"); zu()
            fb = T.fu_buch_a()[:4]
            fid = pg.evaluate("""async ([tp, bs, cov]) => { const tid = (await Tours.add({ name: 'Roque-Runde', sport: 'hike', src: 'file', pts: tp.map((p, i) => ({ lat: p[0], lon: p[1], ele: p[2], t: 1747000000000 + i * 20000 })) })).tour.id;
              const r = await Buecher.speichere(null, 'Rother Wanderführer Fantasia Süd', { ok: bs.map(([n, text]) => ({ name: n, text })), bad: [] });
              await Buecher.speichere(null, 'Fantasia Nord', { ok: [], bad: [] }); await Buecher.setzeCover(r.buch.id, cov); Buecher.ui.offen.clear(); Buecher.ui.offen.add(r.buch.id); return { tid, bid: r.buch.id }; }""",
                [[list(p) for p in T.fu_kurve(28.0, -15.6, 400, 6000, amp=0.09, noise=7, seed=2)], [[f"T{k + 1}.gpx", T.fu_gpx(T.FU_TITEL[k], fb[k])] for k in range(4)],
                 pg.evaluate("() => { const c = document.createElement('canvas'); c.width = 200; c.height = 280; const g = c.getContext('2d'); const gr = g.createLinearGradient(0, 0, 0, 280); gr.addColorStop(0, '#1e5a78'); gr.addColorStop(1, '#f0aa5a'); g.fillStyle = gr; g.fillRect(0, 0, 200, 280); return c.toDataURL('image/jpeg', .8); }")])
            pg.evaluate("Buecher.sync()"); go("#/fuehrer", ".fu-t"); pg.wait_for_function("() => !Buecher._run && document.querySelector('#fu-sync').hidden", timeout=30000); scan("Wanderführer, aufgeklappt")
            pg.evaluate("Buecher.ui.offen.clear()"); go("#/fuehrer", ".fu-book"); pg.wait_for_function("() => !document.querySelector('.fu-t')"); scan("Wanderführer, zugeklappt")
            pg.evaluate("id => Buecher.ui.offen.add(id)", fid["bid"]); pg.evaluate("Buecher.ui.filter = 'offen'"); go("#/fuehrer", ".fu-t"); scan("Wanderführer, Filter offen"); pg.evaluate("Buecher.ui.filter = 'gewandert'"); go("#/fuehrer", ".fu-t"); scan("Wanderführer, Filter gewandert")
            pg.evaluate("Buecher.ui.filter = 'alle'; Buecher.ui.suche = 'gibtesnicht'"); go("#/fuehrer", "#fu-leer"); scan("Wanderführer, nichts gefunden"); pg.evaluate("Buecher.ui.suche = ''")
            go("#/fuehrer", ".fu-t"); pg.locator("button.fu-t.open").first.click(); pg.wait_for_selector("#fu-plan"); pg.wait_for_timeout(500); scan("Wanderführer, Karte der Buchtour"); zu()
            pg.locator("[data-a=manage]").first.click(); pg.wait_for_selector("#fu-m-del"); scan("Wanderführer, Buch verwalten"); zu()
            go("#/start", "#fuehrer-home-row"); scan("Start, Wanderführer-Zeile")
            go("#/tour/" + fid["tid"], "#imbuch"); scan("Tour, Aus dem Buch")
            pg.evaluate("async (f) => { await Tours.remove(f.tid); for (const b of await Buecher.liste()) await Buecher.entferne(b.id); await DB.del('kv', 'guides'); await DB.del('kv', 'guideMatch'); }", fid)
            # 2.7.0: Aufnahme läuft (Route, Aufstieg/Abstieg, Pause halten, Zum Beenden schieben), pausiert, Route nicht mehr vorhanden
            pid = pg.evaluate("async () => (await Tours.add({ name: 'Route K', sport: 'hike', src: 'plan', status: 'planned', force: true, pts: Array.from({ length: 30 }, (_, i) => ({ lat: 47.5 + i * 4e-4, lon: 11.2 + i * 3e-4, ele: 900 + i })) })).tour.id")
            pg.evaluate("id => DB.kvSet('recRoute', { kind: 'tour', id, name: 'Route K', ts: Date.now() })", pid); go("#/rec", "#rroutesel"); scan("Aufnahme, Route gemerkt")
            pg.click(".bigstart"); pg.wait_for_selector("#rroute:not([hidden])"); pg.evaluate("Object.assign(window.__rec, { up_m: 412, down_m: 287, alt_m: 1650 })"); pg.wait_for_timeout(1300)
            for k in range(3): pg.evaluate("k => { document.querySelector('#view').scrollTop = k * 400 }", k); pg.wait_for_timeout(100); scan("Aufnahme läuft")
            pg.evaluate("window.__rec.state = 'paused'"); pg.wait_for_timeout(1300); scan("Aufnahme pausiert")
            pg.evaluate("async id => { window.__rec.state = 'idle'; window.__rec.unsent = false; window.__routeName = ''; await Tours.remove(id); await DB.kvSet('recRoute', { kind: 'tour', id, name: 'Route K', ts: Date.now() }); }", pid)
            go("#/rec", "#rroutegone"); scan("Aufnahme, Route nicht mehr vorhanden"); pg.evaluate("DB.kvSet('recRoute', null)")
            # 2.12.0: unterbrochene Aufnahme (Start und Aufnahme), Orte aus der Tour ergänzen, Video zuschneiden, Galerie-Kopie in den Einstellungen
            pg.evaluate("() => { const now = Date.now(); MTApp.resumeInterrupted = () => true; MTApp.batteryUnrestricted = () => false; Object.assign(window.__rec, { state: 'recording', interrupted: true, can_resume: true, start: now - 7200000, last_ts: now - 1800000, count: 321, dist_m: 4321 }); }")
            go("#/start", "#recrescue"); scan("Start, Aufnahme unterbrochen")
            go("#/rec", "#recrescue"); scan("Aufnahme unterbrochen")
            go("#/settings", "#set-akku"); scan("Einstellungen, Aufzeichnung")
            pg.evaluate("() => { delete MTApp.resumeInterrupted; delete MTApp.batteryUnrestricted; Object.assign(window.__rec, { state: 'idle', interrupted: false, can_resume: false }); }")
            pg.evaluate("async tid => { const t = await DB.get('tours', tid); for (let i = 0; i < 3; i++) await DB.put('photos', { id: 'kfo' + i + 'aaaaaa', name: 'k.jpg', ts: t.start + i * 600000 - (i === 2 ? 7200000 : 0), lat: null, lon: null, pos: 'none', tour: i === 2 ? '' : tid, w: 10, h: 10 }); }", tid)
            go("#/tour/" + tid, "#fotoort-btn"); scan("Tour, Fotos ohne Ort")
            pg.click("#fotoort-btn"); pg.wait_for_selector("#fo-bsp"); pg.wait_for_timeout(300); scan("Orte aus der Tour ergänzen")
            pg.evaluate("(sheet.stack || []).slice().forEach(x => x.close())"); pg.wait_for_timeout(250)
            pg.evaluate(T.VJOB_MOCK)
            pg.evaluate("async () => { await DB.put('photos', { id: 'kvid0aaaaaaaaaaaaaav', name: 'Video.mp4', ts: 1700000300000, video: true, dur: 10000, w: 1920, h: 1080, tour: '' }); Lightbox.open([await DB.get('photos', 'kvid0aaaaaaaaaaaaaav')], 0); }")
            pg.click(".lb button[aria-label=Details]"); pg.wait_for_selector("#lb-dtrim"); pg.click("#lb-dtrim"); pg.wait_for_selector("#vt-info")
            pg.fill("#vt-et", "0:01,5"); pg.dispatch_event("#vt-et", "change"); pg.wait_for_timeout(300); scan("Video zuschneiden (mit Hinweis)")
            pg.evaluate("(sheet.stack || []).slice().forEach(x => x.close())"); pg.evaluate("window.__lightbox && window.__lightbox.close()"); pg.wait_for_timeout(250)
            go("#/settings", "#set-vgalcopy"); pg.wait_for_function("() => document.querySelector('#set-vgal-n').textContent.includes('Galerie')"); scan("Einstellungen, Videos in die Galerie")
            pg.evaluate("async () => { window.MTApp.call = window.__vjcall0; for (const id of ['kfo0aaaaaa', 'kfo1aaaaaa', 'kfo2aaaaaa', 'kvid0aaaaaaaaaaaaaav']) await DB.del('photos', id); }")
            # 2.13.0: Statistik → Vergleich (mit Wert eines Monats), Bestwerte je Sportart, Tour als Bild, Wanderführer übertragen
            go("#/stats/vergleich", "#vgl-diff"); pg.locator("#vgl-chart rect.vh").nth(5).click(); pg.click("#vgl-tabelle summary"); pg.wait_for_timeout(200); scan("Statistik Vergleich")
            go("#/stats/rekorde", "#bestwerte"); pg.click("#bestwerte .seg button:has-text('Beste drei')"); pg.wait_for_timeout(300); scan("Statistik Bestwerte je Sportart (drei)"); pg.evaluate("Set_.set('bestN', 1)")
            pg.evaluate("tid => DB.get('tours', tid).then(t => TourBild.dialog(t))", tid); pg.wait_for_selector("#tb-bild[src]"); pg.wait_for_function("() => document.querySelector('#tb-vor').getAttribute('aria-busy') === 'false'", timeout=60000); scan("Als Bild teilen")
            pg.evaluate("(sheet.stack || []).slice().forEach(x => x.close())"); pg.wait_for_timeout(250)
            go("#/fuehrer", "#fu-xfer"); scan("Wanderführer, Übertragen")
            # 2.15.0: „Aus Meine Touren holen“ (Knopf und Blatt), Frage auf der Startseite mit Touren, Einstellung ganz oben (aus)
            pg.evaluate("DB.kvSet('mt', { base: 'https://mt.test', name: 'V', role: 'viewer', token: 'x' })"); go("#/fuehrer", "#fu-mt"); scan("Wanderführer, Aus Meine Touren holen")
            pg.click("#fu-mt"); pg.wait_for_selector("#fu-mt-go"); pg.wait_for_timeout(250); scan("Wanderführer aus Meine Touren, Blatt")
            pg.evaluate("(sheet.stack || []).slice().forEach(x => x.close())"); pg.wait_for_timeout(250); pg.evaluate("DB.del('kv', 'mt')")
            pg.evaluate("Set_.set('mtWahl', 'offen')"); go("#/start", "#mt-frage"); scan("Start, Frage Meine Touren")
            pg.evaluate("async () => { Set_.v.mtAktiv = false; await Set_.set('mtWahl', 'nein'); }"); go("#/settings", "#set-mt"); scan("Einstellungen, Meine Touren aus"); pg.evaluate(T.MT_AN); go("#/fuehrer", "#fu-xfer")
            pg.click("#fu-export"); pg.wait_for_selector("#fu-ex-go"); pg.wait_for_timeout(250); scan("Wanderführer exportieren")
            pg.evaluate("(sheet.stack || []).slice().forEach(x => x.close())"); pg.wait_for_timeout(250)
            pg.evaluate("() => { window.__pick = [{ name: 'f.json', url: URL.createObjectURL(new Blob([JSON.stringify({ format: 'tourentagebuch-wanderfuehrer', version: 1, buecher: [{ id: 'kx1', name: 'Kontrastbuch', touren: [{ title: 'A', km: 3, pts: { la: [4700000, 10, 10], lo: [1100000, 10, 10] } }] }] })])) }]; }")
            pg.click("#fu-import"); pg.wait_for_selector("#fu-im-sum"); pg.wait_for_timeout(250); scan("Wanderführer importieren")
            pg.evaluate("(sheet.stack || []).slice().forEach(x => x.close()); window.__pick = [];"); pg.wait_for_timeout(250)
            # 2.14.0: Doppelte Fotos – Gruppen, Rückfrage, leer; Schalter in „Fotos hinzufügen“
            pg.evaluate("""async tid => { for (const [id, src, lat] of [['kfd111111a', 'smb', 47.1], ['kfd222222b', 'rechner', null], ['kfd333333v', 'kamera', null], ['kfd444444v', 'kamera', null]])
              await DB.put('photos', { id, name: id.endsWith('v') ? 'Video.mp4' : 'IMG_7.JPG', ts: 1700000400000, lat, lon: lat, pos: lat ? 'exif' : 'none', tour: tid, src, w: 40, h: 30, note: src === 'rechner' ? 'Notiz' : '', video: id.endsWith('v'), dur: id.endsWith('v') ? 4000 : 0, fp: id.endsWith('v') ? 'p1:9:vv' : 'p1:9:ff', size: 2000000 }); }""", tid)
            go("#/fotodoppelt", ".fd-g"); pg.wait_for_function("() => !Nav._busy"); scan("Doppelte Fotos, Gruppen")
            pg.click("#fd-go"); pg.wait_for_selector(".sheet[aria-label='Doppelte Fotos löschen?']"); pg.wait_for_timeout(250); scan("Doppelte Fotos, Rückfrage")
            pg.evaluate("(sheet.stack || []).slice().forEach(x => x.close())"); pg.wait_for_timeout(250)
            pg.evaluate("PhotoSources.sheet(null, null)"); pg.wait_for_selector("#ps-skipdup"); pg.wait_for_timeout(250); scan("Fotos hinzufügen, Schalter")
            pg.evaluate("(sheet.stack || []).slice().forEach(x => x.close())"); pg.wait_for_timeout(250)
            pg.evaluate("async () => { for (const id of ['kfd111111a', 'kfd222222b', 'kfd333333v', 'kfd444444v']) await DB.del('photos', id); }")
            go("#/fotodoppelt", ".empty"); pg.wait_for_function("() => !Nav._busy"); scan("Doppelte Fotos, leer")
            # 2.17.0: Video erzeugen (Dialog mit Grenzen und Warnung, Erweitert offen; Ergebnis) – ohne laufenden Flug, mit nachgestellten Fähigkeiten
            pg.evaluate("FlugVideo.dialog({ dauer: 100 }, { webcodecs: true, nativ: { avc: { name: 'x', hw: true, encLang: 3840, encKurz: 2160 }, hevc: null }, glMax: 8192, freiMB: 50000, ramGB: 6 })")
            pg.wait_for_selector("#fv-go"); pg.select_option("#fv-aufl", "2160"); pg.click(".fv-mehr summary"); pg.wait_for_timeout(250); scan("Video erzeugen, 4K mit Warnung")
            pg.select_option("#fv-fps", "60"); pg.select_option("#fv-dauer", "300"); pg.wait_for_timeout(150); scan("Video erzeugen, zu viele Bilder")
            pg.evaluate("(sheet.stack || []).slice().forEach(x => x.close())"); pg.wait_for_timeout(250)
            pg.evaluate("FlugVideo.fertig({ ok: true, name: 'Flug_Test_2026-07-04.mp4', bytes: 140e6, w: 1920, h: 1080, dauerMs: 61000, shown: 'Movies/Tourentagebuch/Flug_Test_2026-07-04.mp4', luecken: 3, ms: 900000, art: 'webcodecs', hw: true }, [])")
            pg.wait_for_selector("#fv-fertig"); pg.wait_for_timeout(250); scan("Video fertig")
            pg.evaluate("(sheet.stack || []).slice().forEach(x => x.close())"); pg.wait_for_timeout(250)
            # 2.18.0: Mit Meine Touren abgleichen (Vorschau mit Konflikt und Videos, Rückfrage, Ergebnis, Betrachter, Sammel), Senden mit Pins, Komoot-Paket
            T0 = 1782892800
            pg.evaluate(T.NETZ_WACHE); pg.evaluate(T.AB_SERVER, {"tours": {"g2180": {"notiz": {"text": "Im Browser ergänzt", "geaendert": 6}, "fotos": [{"id": 814, "taken_ts": T0 + 600, "lat": 47.5, "lng": 11.2, "size": 500000, "v": "a", "video": False, "ref": None, "name": None}],
                "videos": [{"id": 3, "taken_ts": T0 + 900, "size": 48000000, "v": "b", "video": True, "ref": None, "name": "Video.mp4"}]}}, "geloescht": ["kab2aaaaaaaaaaaaaaaa"]})
            ab = pg.evaluate("""async T0 => { await DB.kvSet('mt', { base: 'https://mt.test', name: 'V', role: 'user', token: 'SITZUNG-2180' });
              const pts = Array.from({ length: 40 }, (_, i) => ({ lat: 47.5 + i * 2e-4, lon: 11.2, ele: 900 + i, t: T0 * 1000 + i * 30000 }));
              const t = (await Tours.add({ name: 'Kontrast Abgleich', sport: 'hike', pts, src: 'file', force: true })).tour;
              Object.assign(t, { mtId: 'g2180', note: 'Vom Handy', noteMt: 'Alt', mtNotizBasis: 5, pins: [{ id: 'kp', ts: T0 * 1000 + 60000, lat: 47.5, lon: 11.2, text: 'Quelle' }] }); await Tours.save(t);
              await DB.put('photos', { id: 'kab1aaaaaaaaaaaaaaaa', name: 'a.jpg', ts: T0 * 1000 + 100000, w: 40, h: 30, tour: t.id, faces: 0 });
              await DB.put('photos', { id: 'kab2aaaaaaaaaaaaaaaa', name: 'b.jpg', ts: T0 * 1000 + 200000, w: 40, h: 30, tour: t.id, faces: 2, mtGeloescht: true });
              await DB.put('photos', { id: 'kab3aaaaaaaaaaaaaaav', name: 'Video.mp4', ts: T0 * 1000 + 300000, w: 40, h: 30, tour: t.id, video: true, size: 30e6 });
              return t.id; }""", T0)
            pg.evaluate("id => DB.get('tours', id).then(t => MedienAbgleich.tour(t))", ab); pg.wait_for_selector("#ab-go"); pg.click("#ab-n-hier summary"); pg.click("#ab-videos"); pg.wait_for_timeout(250); scan("Abgleich, Vorschau")
            pg.click("#ab-notiz .seg button:has-text('Holen')"); pg.wait_for_timeout(150); scan("Abgleich, Vorschau Holen")
            pg.click("#ab-go"); pg.wait_for_selector(".sheet[aria-label='Auch Videos übertragen?']"); pg.wait_for_timeout(250); scan("Abgleich, Rückfrage Videos")
            pg.click(".sheet[aria-label='Auch Videos übertragen?'] .btn.pri"); pg.wait_for_selector("#ab-ergebnis-t", timeout=30000); pg.wait_for_timeout(300); scan("Abgleich, Ergebnis")
            pg.evaluate("(sheet.stack || []).slice().forEach(x => x.close())"); pg.wait_for_timeout(250)
            pg.evaluate("async () => { window.__ab.darf = false; const a = await DB.kvGet('mt', null); a.role = 'viewer'; await DB.kvSet('mt', a); }")
            pg.evaluate("async id => { const t = await DB.get('tours', id); t.note = 'Neu nur hier'; await Tours.save(t); MedienAbgleich.tour(t); }", ab); pg.wait_for_selector("#ab-go"); pg.wait_for_timeout(250); scan("Abgleich, Betrachter")
            pg.evaluate("(sheet.stack || []).slice().forEach(x => x.close())"); pg.wait_for_timeout(250)
            pg.evaluate("async () => { window.__ab.darf = true; const a = await DB.kvGet('mt', null); a.role = 'user'; await DB.kvSet('mt', a); }")
            pg.evaluate("MedienAbgleich.alle()"); pg.wait_for_selector("#ab-a-go", timeout=30000); pg.wait_for_timeout(250); scan("Abgleich, alle Touren")
            pg.evaluate("(sheet.stack || []).slice().forEach(x => x.close())"); pg.wait_for_timeout(250)
            pg.evaluate("async id => { const t = await DB.get('tours', id); delete t.mtId; await Tours.save(t); Senden.dialog(t); }", ab); pg.wait_for_selector("#send-pins"); pg.wait_for_timeout(250); scan("Senden, Pins und Notiz")
            pg.evaluate("(sheet.stack || []).slice().forEach(x => x.close())"); pg.wait_for_timeout(250)
            pg.evaluate("id => DB.get('tours', id).then(t => KomootPaket.dialog(t))", ab); pg.wait_for_selector("#kp-go"); pg.click("#kp-alle"); pg.wait_for_timeout(300); scan("Komoot-Paket, Auswahl")
            pg.evaluate("(sheet.stack || []).slice().forEach(x => x.close())"); pg.wait_for_timeout(250)
            pg.evaluate("id => DB.get('tours', id).then(t => KomootPaket.ausgeben({ bytes: new Uint8Array(2048), name: 'Komoot-Paket Kontrast.zip', manifest: { fotos: [], wegpunkte: 1 }, ohneOrt: 1 }, t))", ab); pg.wait_for_selector("#kp-fertig"); pg.wait_for_timeout(250); scan("Komoot-Paket, gespeichert")
            pg.evaluate("(sheet.stack || []).slice().forEach(x => x.close())"); pg.wait_for_timeout(250)
            pg.evaluate(T.AB_SERVER_AUS); pg.evaluate(T.NETZ_WACHE_AUS)
            pg.evaluate("async id => { await Tours.remove(id); for (const p of ['kab1aaaaaaaaaaaaaaaa', 'kab2aaaaaaaaaaaaaaaa', 'kab3aaaaaaaaaaaaaaav', 'h814aaaaaaaa', 'vv3aaaaaaaaav']) await DB.del('photos', p); await DB.del('kv', 'mt'); }", ab)
            # Aktionsmenüs auf Tour- und Listenseiten
            for r in (f"#/tour/{tid}", "#/", "#/photos"):
                pg.evaluate(f"location.hash='{r}'"); pg.wait_for_timeout(600)
                for el in pg.locator("header.top button[aria-label]").all()[:4]:
                    try:
                        el.click(timeout=1500); pg.wait_for_timeout(300)
                        for item in pg.evaluate(JS): bad.setdefault((r + " Menü", item["txt"], item["cls"], item["fg"], item["bg"], scheme), item)
                        pg.evaluate("(sheet.stack || []).slice().forEach(x => x.close())"); pg.keyboard.press("Escape"); pg.wait_for_timeout(150)
                    except Exception: pass
            # Filter und „Neue Tour“ in der Tourenliste, leerer Suchtreffer
            pg.evaluate("location.hash='#/'"); pg.wait_for_selector("#filterbtn")
            for sel in ("#filterbtn", "#touradd"):
                pg.click(sel); pg.wait_for_timeout(350)
                for item in pg.evaluate(JS): bad.setdefault(("Touren " + sel, item["txt"], item["cls"], item["fg"], item["bg"], scheme), item)
                pg.evaluate("(sheet.stack || []).slice().forEach(x => x.close())"); pg.wait_for_timeout(250)
            pg.fill("input[type=search]", "gibtesnicht"); pg.wait_for_timeout(250)
            for item in pg.evaluate(JS): bad.setdefault(("Touren leer", item["txt"], item["cls"], item["fg"], item["bg"], scheme), item)
            pg.fill("input[type=search]", "")
            # Startseite ohne Kartenbild (gezeichneter Aufmacher: weiße Schrift auf Petrol) und mit Jahreszielen
            pg.evaluate("(async () => { await DB.kvSet('heroMap', null); await caches.delete('tiles-v1'); await DB.kvSet('goals', {[new Date().getFullYear()]: {km: 500, up: 9000}}); })()")
            pg.unroute("**/tile.openstreetmap.org/**"); pg.route("**/tile.openstreetmap.org/**", lambda r: r.abort())
            pg.evaluate("location.hash='#/start'"); pg.wait_for_selector("#hero"); pg.wait_for_timeout(700)
            assert pg.locator("#hero.pic").count() == 0, "ohne Kacheln muss der gezeichnete Aufmacher stehen"
            for item in pg.evaluate(JS): bad.setdefault(("Start gezeichnet", item["txt"], item["cls"], item["fg"], item["bg"], scheme), item)
            # Laufende und pausierte Aufzeichnung (rote Scheibe, große Ziffern, Beenden)
            pg.evaluate("() => { Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false }); Offline.gebiete = []; }")      # 2.11.0: Hinweis „Keine Karte offline“
            pg.evaluate("location.hash='#/rec'"); pg.wait_for_selector(".bigstart"); pg.click(".bigstart"); pg.wait_for_selector(".bigtime"); pg.wait_for_selector("#rec-offline:not([hidden])"); pg.wait_for_timeout(500)
            for item in pg.evaluate(JS): bad.setdefault(("Aufzeichnung läuft", item["txt"], item["cls"], item["fg"], item["bg"], scheme), item)
            pg.click("#rpause"); pg.wait_for_timeout(1400)
            for item in pg.evaluate(JS): bad.setdefault(("Aufzeichnung Pause", item["txt"], item["cls"], item["fg"], item["bg"], scheme), item)
            pg.evaluate("() => { delete navigator.onLine; Offline.gebiete = null; }")
            pg.evaluate("location.hash='#/start'"); pg.wait_for_selector("#startrec.live"); pg.wait_for_timeout(300)
            for item in pg.evaluate(JS): bad.setdefault(("Start, Aufzeichnung läuft", item["txt"], item["cls"], item["fg"], item["bg"], scheme), item)
            ctx.close()
        b.close()
    for (r, txt, cls, fg, bg, scheme), it in sorted(bad.items(), key=lambda kv: kv[1]["ratio"]):
        print(f'{it["ratio"]:5} {scheme:5} {r:22} „{txt}“ {cls} {fg} auf {bg}' + (" (deaktiviert)" if it["dis"] else ""))
    print(len(bad), "Stellen unter 4,5:1")
    if "--fail" in sys.argv and bad: sys.exit(1)

if __name__ == "__main__":
    main()
