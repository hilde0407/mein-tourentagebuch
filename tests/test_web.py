"""Browser-Test der Oberfläche mit simulierter Android-Brücke (Playwright)."""
import http.server, json, os, socketserver, threading, sys
from playwright.sync_api import sync_playwright

WWW = os.path.join(os.path.dirname(__file__), "..", "android", "app", "src", "main", "assets", "www")

class Q(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=WWW, **k)
    def log_message(self, *a): pass

MOCK = """
window.__calls=[];
window.__rec={state:'idle',sport:'hike',name:'',count:0,dist_m:0,up_m:0,active_s:0,gps:true};
window.MTApp={
 version:()=>'test', hasPermission:()=>true, requestPermission(){}, status:()=>JSON.stringify(window.__rec),
 points:()=>JSON.stringify([[47.5,11.2],[47.501,11.201]]), takeFinished:()=>window.__gpx||'', discardRecording(){window.__rec.state='idle';window.__rec.unsent=false},
 startRecording(s,n){window.__rec=Object.assign(window.__rec,{state:'recording',sport:s,name:n,count:5,dist_m:120,active_s:61,lat:47.5,lon:11.2,fix_age_s:1,fix_acc_m:5});window.__calls.push(['start',s,n])},
 pauseRecording(){window.__rec.state='paused'}, resumeRecording(){window.__rec.state='recording'},
 stopRecording(n){window.__rec.state='finished';window.__rec.unsent=true}, takePhoto(){window.__calls.push(['photo']);return true}, takeVideo(){window.__calls.push(['video']);return true}, setJunctions(t){window.__calls.push(['junc',t.split(';').length])}, backups:()=>JSON.stringify(window.__baks||[]), backupGpx:()=>window.__bakgpx||'',
 setRoute(p,n){window.__calls.push(['route',n,p.split(';').length]);window.__routeName=n}, routeInfo:()=>JSON.stringify(window.__routeName?{name:window.__routeName,points:3}:{}), routePoints:()=>'[]', clearRoute(){window.__routeName=''}, setGuide(){}, guideTest(){},
 takeShared:()=>'[]', takeSharedText:()=>'[]', takePhotoQueue:()=>'[]', openBatterySettings(){}, openUrl(u){window.__opened=u}, shareText(){}, logText:()=>'log',
 call(id,m,a){ a=JSON.parse(a); setTimeout(async()=>{ let r; try{
   if(m==='http'){ const x=await fetch(a.url,{method:a.method||'GET',headers:a.headers,body:a.body}); r={status:x.status,headers:{},body:a.bin?'':await x.text()}; if(a.bin){ const u=new Uint8Array(await x.arrayBuffer()); let b=''; u.forEach(c=>b+=String.fromCharCode(c)); r.b64=btoa(b); } }
   else if(m==='appendCache') r=true; else if(m==='uploadStart') r={ip:'192.168.0.5',port:8765,url:'http://192.168.0.5:8765/abc12/'}; else if(m==='uploadStop') r=true;
   else if(m==='uploadPoll'){ r={photos:window.__upl||[],failed:0,running:true}; window.__upl=[]; }
   else if(m==='perm') r={granted:true}; else if(m==='saveFile'){ r='Download/Tourentagebuch/'+a.name; window.__saved=a; }
   else if(m==='storage') r={photos:0,bytes:0}; else if(m==='galleryRange') r=window.__gallery||[];
   else if(m==='importUris') r=(a.uris||[]).map((u,i)=>({id:'g'+i+u.length,name:'g.jpg',ts:window.__gts||0,w:10,h:10,src:'galerie'}));
   else if(m==='pickPhotos') r=[{id:'p1aaaaaa',name:'a.jpg',ts:1700000300000,w:10,h:10,src:'galerie',lat:47.4,lon:11.1}];
   else if(m==='pickFiles') r=window.__pick||[];
   else r=[];
   }catch(e){ r={status:599,headers:{},body:''}; }
   window.__mtcb(+id,true,JSON.stringify(r)); },5); }
};
"""

def gpx(t0, n=60, lat=47.0, lon=11.0, ele0=800, name="T"):
    pts = "".join(
        f'<trkpt lat="{lat+i*0.0005}" lon="{lon+i*0.0004}"><ele>{ele0+i*3}</ele><time>{__import__("datetime").datetime.fromtimestamp(t0/1000+i*30, __import__("datetime").timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")}</time></trkpt>' for i in range(n))
    return f'<?xml version="1.0"?><gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>{name}</name><type>hiking</type><trkseg>{pts}</trkseg></trk></gpx>'

LAYOUT_JS = """() => {
  /* Prüft die sichtbare Seite: kein Querrollen, Tippflächen mindestens 44 px (gemessen per Treffertest, nicht per Kastenmaß). */
  const out = [], v = document.querySelector('#view');
  if (v.scrollWidth > v.clientWidth + 1) out.push('Querrollen: Inhalt ' + v.scrollWidth + ' px breit, Platz ' + v.clientWidth + ' px');
  if (document.documentElement.scrollWidth > innerWidth + 1) out.push('Querrollen: Seite ' + document.documentElement.scrollWidth + ' px');
  const head = document.querySelector('#view > header.top:not(.over)'), tabs = document.querySelector('#tabs:not(.hide)');
  const over = document.querySelector('#view > header.top.over');      // schwebende Knöpfe der Tourseite: was darunter liegt, wird nach dem Rollen geprüft
  const top = head ? head.getBoundingClientRect().bottom : over ? 64 : 0, bottom = tabs ? tabs.getBoundingClientRect().top - 32 : innerHeight;
  document.querySelectorAll('#view button, #view a[href], #view select, #view input, #view textarea, #view summary, #tabs a, .sheet button, .sheet a[href], .sheet select, .sheet input').forEach(el0 => {
    if (el0.closest('.leaflet-control-attribution, .leaflet-popup, .leaflet-marker-pane, .leaflet-overlay-pane')) return;
    const el = el0.type === 'checkbox' && el0.closest('label') ? el0.closest('label') : el0;      // beim Schalter zählt die ganze Zeile
    const r = el.getBoundingClientRect(), inTabs = !!el.closest('#tabs, header.top');
    if (r.width < 2 || r.height < 2 || r.left < 0 || r.right > innerWidth + 1) return;
    if (!inTabs && (r.top < top || r.bottom > bottom)) return;      // (teilweise) verdeckt oder außerhalb: wird nach dem Rollen geprüft
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const hit = (x, y) => { const e = document.elementFromPoint(x, y); return !!e && (e === el || el.contains(e)); };
    if (!hit(cx, cy)) return;
    const miss = [[0, -21], [0, 21], [-21, 0], [21, 0]].filter(([dx, dy]) => !hit(cx + dx, cy + dy));
    if (miss.length) out.push('Tippfläche unter 44 px: <' + el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\\s+/).join('.') : '') + '> „' + (el.innerText || el.getAttribute('aria-label') || el.placeholder || '').trim().slice(0, 28) + '“ ' + Math.round(r.width) + '×' + Math.round(r.height));
  });
  return [...new Set(out)];
}"""

def layout_check(pg, routes, widths=((360, 100), (390, 100), (430, 100), (360, 130))):
    """Jede Hauptansicht bei 360–430 px Breite und mit 130 % Schriftgröße: nichts ragt seitlich hinaus, alles ist gut tippbar."""
    bad = []
    for w, fs in widths:
        pg.set_viewport_size({"width": w, "height": 800})
        pg.evaluate("fs => { let s = document.getElementById('fs-test'); if (!s) { s = document.createElement('style'); s.id = 'fs-test'; document.head.append(s); } s.textContent = fs === 100 ? '' : 'html{font-size:' + fs + '% !important}'; }", fs)
        for r in routes:
            pg.evaluate("h => { if (location.hash === h) Nav.render(); else location.hash = h; }", r)
            pg.wait_for_function("h => !Nav._busy && Nav.cur === '/' + (h.slice(2).split('/')[0] || '') && document.querySelector('#view').children.length > 0", arg=r); pg.wait_for_timeout(350)
            steps = pg.evaluate("Math.min(14, Math.ceil(document.querySelector('#view').scrollHeight / 500))")
            for k in range(max(1, steps)):
                pg.evaluate("k => { document.querySelector('#view').scrollTop = k * 500 }", k); pg.wait_for_timeout(60)
                for m in pg.evaluate(LAYOUT_JS): bad.append(f"{w} px, {fs} %, {r}: {m}")
    pg.evaluate("document.getElementById('fs-test').textContent = ''"); pg.set_viewport_size({"width": 390, "height": 800})
    return sorted(set(bad))


def neue_funktionen(pg):
    """Funktionen aus „Meine Touren“ (2.0.0): Sicherungs-Erinnerung, Ziele, Bestwerte, Rückblick, Planung, Fitness, Startseite einrichten."""
    DAY = 86400000
    # --- 1. Sicherungs-Erinnerung ---
    pg.evaluate("async () => { await DB.del('kv', 'lastBackup'); await DB.del('kv', 'backupSnooze'); await Set_.set('backupDays', 14); }")
    pg.evaluate("() => { if (location.hash === '#/start') Nav.render(); else location.hash = '#/start'; }"); pg.wait_for_selector("#backupnote")
    assert "Noch keine Sicherung gemacht" in pg.inner_text("#backupnote"), pg.inner_text("#backupnote")
    pg.click("#bk-later"); pg.wait_for_selector("#backupnote", state="detached")
    assert pg.evaluate("DB.kvGet('backupSnooze', 0).then(v => v > Date.now() + 6.9 * 86400000)")
    pg.evaluate("Nav.render()"); pg.wait_for_selector("#hero"); pg.wait_for_timeout(300); assert pg.locator("#backupnote").count() == 0, "nach „Später“ sieben Tage Ruhe"
    pg.evaluate("async ([d]) => { await DB.kvSet('backupSnooze', 0); await DB.kvSet('lastBackup', Date.now() - 23 * d); }", [DAY])
    pg.evaluate("Nav.render()"); pg.wait_for_selector("#backupnote"); assert "Letzte Sicherung vor 23 Tagen" in pg.inner_text("#backupnote"), pg.inner_text("#backupnote")
    pg.evaluate("window.__saved = null"); pg.click("#bk-now"); pg.wait_for_function("window.__saved && window.__saved.name.endsWith('.mtl')"); pg.wait_for_selector("#backupnote", state="detached")
    assert pg.evaluate("DB.kvGet('lastBackup', 0).then(v => Date.now() - v < 20000)"), "Zeitpunkt der Sicherung gemerkt"
    pg.evaluate("async ([d]) => { await DB.kvSet('lastBackup', Date.now() - 10 * d); }", [DAY]); pg.evaluate("Nav.render()"); pg.wait_for_selector("#hero"); pg.wait_for_timeout(300)
    assert pg.locator("#backupnote").count() == 0, "10 Tage sind unter der Schwelle von 14"
    pg.evaluate("location.hash = '#/settings'"); pg.wait_for_selector("#bk-days"); pg.click("#bk-days .chip:has-text('7 Tage')"); pg.wait_for_function("Set_.get('backupDays') === 7")
    pg.evaluate("location.hash = '#/start'"); pg.wait_for_selector("#backupnote"); assert "vor 10 Tagen" in pg.inner_text("#backupnote")
    pg.evaluate("location.hash = '#/settings'"); pg.wait_for_selector("#bk-days"); pg.click("#bk-days .chip:has-text('Aus')"); pg.wait_for_function("Set_.get('backupDays') === 0")
    pg.evaluate("location.hash = '#/start'"); pg.wait_for_selector("#hero"); pg.wait_for_timeout(300); assert pg.locator("#backupnote").count() == 0, "Erinnerung aus"
    pg.evaluate("async () => { await Set_.set('backupDays', 14); await DB.kvSet('lastBackup', Date.now()); }")

    # --- 2. Ziele: Jahres- und Wochenziele, Prognose in Worten, Pflege in der Statistik, Anzeige auf der Startseite ---
    pg.evaluate("async () => { await DB.del('kv', 'goals2'); await DB.kvSet('goals', {}); }")
    pg.evaluate("location.hash = '#/stats/ziele'"); pg.wait_for_selector("#goaladd"); assert "Noch kein Ziel für" in pg.inner_text("#view")
    pg.click("#goaladd"); pg.wait_for_selector("#goalsave")
    pg.click("#goalsave"); pg.wait_for_selector(".sheet .err:not(:empty)"); assert "Zielwert über 0" in pg.inner_text(".sheet .err"), "ohne Wert wird nichts gespeichert"
    pg.fill("#goalval", "0"); pg.click("#goalsave"); assert pg.evaluate("DB.kvGet('goals2', null)") is None
    pg.fill("#goalval", "500"); pg.click("#goalsave"); pg.wait_for_selector(".sheet", state="detached"); pg.wait_for_selector("#goals .ygoal")
    row = pg.inner_text("#goals .ygoal"); assert "/ 500 km" in row and ("Prognose zum Jahresende" in row or "erreicht" in row), row
    assert pg.evaluate("DB.kvGet('goals2', []).then(l => l.length === 1 && l[0].metric === 'km' && l[0].target === 500 && l[0].period === 'year')")
    # Wochenziel: zwei Touren pro Woche
    pg.click("#goaladd"); pg.wait_for_selector("#goalsave"); pg.click(".sheet .seg button:has-text('Wochenziel')"); assert pg.locator("#goalyear").is_hidden()
    pg.click("#goalmetric .chip:has-text('Touren')"); pg.fill("#goalval", "2"); pg.click("#goalsave"); pg.wait_for_selector(".sheet", state="detached")
    pg.wait_for_selector("text=Wochenziele"); wk = pg.inner_text("#goals .sec:has(h3:text-is('Wochenziele')) .ygoal")
    assert "Touren pro Woche" in wk and "/ 2 Touren" in wk and ("Noch" in wk or "letzte Tag" in wk or "erreicht" in wk), wk
    # Sportart je Ziel; dasselbe Ziel zweimal ändert das vorhandene
    pg.click("#goaladd"); pg.wait_for_selector("#goalsave"); pg.select_option("#goalsport", "grp:foot"); pg.click("#goalmetric .chip:has-text('Aufstieg')"); pg.fill("#goalval", "12000"); pg.click("#goalsave"); pg.wait_for_selector(".sheet", state="detached")
    assert "Aufstieg · Wandern und Bergsteigen" in pg.inner_text("#goals") and "/ 12.000 m" in pg.inner_text("#goals")
    pg.click("#goaladd"); pg.wait_for_selector("#goalsave"); pg.select_option("#goalsport", "grp:foot"); pg.click("#goalmetric .chip:has-text('Aufstieg')"); pg.fill("#goalval", "15000"); pg.click("#goalsave"); pg.wait_for_selector(".sheet", state="detached")
    assert pg.evaluate("DB.kvGet('goals2', []).then(l => l.length === 3 && l.filter(g => g.metric === 'up').length === 1 && l.find(g => g.metric === 'up').target === 15000)")
    # Ändern und Löschen
    pg.locator("#goals .ygoal", has_text="Strecke").first.click(); pg.wait_for_selector("#goaldel"); assert pg.input_value("#goalval") == "500"
    pg.fill("#goalval", "800"); pg.click("#goalsave"); pg.wait_for_selector(".sheet", state="detached"); assert "/ 800 km" in pg.inner_text("#goals")
    # Startseite: Jahresziel und Wochenziel im Abschnitt „Dieses Jahr“ (höchstens drei), Verweis zur Pflege
    pg.evaluate("location.hash = '#/start'"); pg.wait_for_selector(".year .ygoal"); assert pg.locator(".year .ygoal").count() == 3, pg.inner_text(".year")
    assert "/ 800 km" in pg.inner_text(".year") and pg.locator("#year .ygoals a.ylink").count() == 1
    pg.evaluate("location.hash = '#/stats/ziele'"); pg.wait_for_selector("#goals .ygoal")
    pg.locator("#goals .ygoal", has_text="Aufstieg").first.click(); pg.wait_for_selector("#goaldel"); pg.click("#goaldel"); pg.wait_for_selector(".sheet .btn.pri:has-text('Löschen')"); pg.click(".sheet .btn.pri:has-text('Löschen')"); pg.wait_for_selector(".sheet", state="detached")
    assert pg.evaluate("DB.kvGet('goals2', []).then(l => l.length === 2)")
    # Ältere Jahresziele (kv „goals“) bleiben lesbar und gehen beim ersten Ändern in die neue Liste über
    pg.evaluate("async () => { await DB.del('kv', 'goals2'); await DB.kvSet('goals', {[new Date().getFullYear()]: {km: 300, up: 9000, n: 20}}); }")
    pg.evaluate("Nav.go('/stats/ziele')"); pg.wait_for_selector("#goals .ygoal"); assert pg.locator("#goals .ygoal").count() == 3 and "/ 300 km" in pg.inner_text("#goals"), pg.inner_text("#goals")
    pg.locator("#goals .ygoal", has_text="Touren").first.click(); pg.wait_for_selector("#goalsave"); pg.fill("#goalval", "25"); pg.click("#goalsave"); pg.wait_for_selector(".sheet", state="detached")
    assert pg.evaluate("DB.kvGet('goals2', []).then(l => l.length === 3 && l.find(g => g.metric === 'count').target === 25 && l.find(g => g.metric === 'km').target === 300)")
    pg.evaluate("async () => { await DB.del('kv', 'goals2'); await DB.kvSet('goals', {}); }")
    # --- 3. Bestwerte (ein Abschnitt, 1 oder 3) und Wochen-Serie ---
    pg.evaluate("Nav.go('/stats/rekorde')"); pg.wait_for_selector("#bestwerte .li")
    t1 = pg.inner_text("#bestwerte"); assert pg.locator("#bestwerte .li").count() >= 4, t1
    for lab in ("Längste Strecke:", "Größter Aufstieg:", "Längste Dauer:", "Höchster Punkt:", "Stärkster Monat:"): assert lab in t1, (lab, t1)
    assert pg.locator("#bestwerte a.li").count() >= 4, "Zeilen führen zur Tour"
    pg.click("#bestwerte .seg button:has-text('Beste drei')"); pg.wait_for_selector("#bestwerte h3.sub")
    assert pg.evaluate("Set_.get('bestN')") == 3 and pg.locator("#bestwerte .li").count() > 8
    pg.click("#bestwerte .seg button:text-is('Beste')"); pg.wait_for_function("Set_.get('bestN') === 1")
    assert "Bester Monat" not in pg.inner_text("#view") and pg.locator("#serie-sec").count() == 1 and "aktuelle Serie" in pg.inner_text("#serie-sec")
    pg.evaluate("Nav.go('/stats/bestwerte')"); pg.wait_for_selector("#bestwerte")      # Alias
    pg.evaluate("location.hash = '#/stats'"); pg.wait_for_selector(".kpis"); assert "Rekorde" not in pg.inner_text("#view"), "keine zweite Rekordliste in der Übersicht"
    # Serie auf der Startseite: standardmäßig aus; in den Einstellungen einschaltbar (Punkt 8)
    pg.evaluate("location.hash = '#/start'"); pg.wait_for_selector("#hero"); pg.wait_for_timeout(300); assert pg.locator("#serie").count() == 0
    pg.evaluate("async () => { await Set_.set('homeShow', { serie: true }); Nav.render(); }"); pg.wait_for_selector("#serie .kpi")
    assert "in Folge" in pg.inner_text("#serie") and "Rekord" in pg.inner_text("#serie") and ("Diese Woche" in pg.inner_text("#serie") or "Keine laufende Serie" in pg.inner_text("#serie")), pg.inner_text("#serie")
    pg.evaluate("async () => { await Set_.set('homeShow', {}); }")

    # --- 4. Rückblick „Wie ist es gelaufen?“ ---
    # Testtouren liegen relativ zu heute („vor … Tagen“), damit die Fenster „12 Monate davor“ und „letzte 12 Wochen“ an jedem Tag stimmen.
    # Sportart „walk“: davon legt der übrige Test keine Touren an, also zählen genau diese hier als Vergleich.
    mk = """async ([name, sport, ago, n, dt, step, lat, lon, status]) => {
      const base = Math.floor(Date.now() / 86400000) * 86400000 + 8 * 3600000 - ago * 86400000;
      const pts = Array.from({ length: n }, (_, i) => ({ lat: lat + i * step, lon: lon, ele: 800 + i * 3, t: status ? null : base + i * dt }));
      return (await Tours.add({ name, sport, pts, src: 'file', status: status || 'done' })).tour.id;
    }"""
    refs = [pg.evaluate(mk, [f"Vergleich {i}", "walk", 260 - i * 9, 30, 60000, 0.0005, 45.0 + i * 0.05, 9.0, None]) for i in range(6)]
    big = pg.evaluate(mk, ["Große Runde", "walk", 180, 90, 60000, 0.0005, 45.5, 9.5, None])
    pg.evaluate("id => { location.hash = '#/tour/' + id }", big); pg.wait_for_selector("#rueckblick")
    rb = pg.inner_text("#rueckblick"); assert "Wie ist es gelaufen?" in rb and "Dauer: länger als üblich" in rb and "Strecke: länger als üblich" in rb and "Aufstieg: mehr als üblich" in rb, rb
    assert "deinen 6 Touren" in rb and "im Mittel" in rb and "NaN" not in rb and "undefined" not in rb and "null" not in rb, rb
    pg.evaluate("id => { location.hash = '#/tour/' + id }", refs[4]); pg.wait_for_selector(".tourp h1"); pg.wait_for_timeout(300); assert pg.locator("#rueckblick").count() == 0, "5 Vergleichstouren sind noch nicht da: kein Abschnitt, kein Platzhalter"
    pg.evaluate("id => { location.hash = '#/tour/' + id }", refs[0]); pg.wait_for_selector(".tourp h1"); pg.wait_for_timeout(300); assert pg.locator("#rueckblick").count() == 0
    bike = pg.evaluate(mk, ["Radtour", "bike", 170, 40, 60000, 0.001, 44.0, 9.0, None])
    pg.evaluate("id => { location.hash = '#/tour/' + id }", bike); pg.wait_for_selector(".tourp h1"); pg.wait_for_timeout(300); assert pg.locator("#rueckblick").count() == 0, "andere Sportart: keine Vergleichstouren"
    # --- 5. Planung: Notizen & Quellen, Passt die Tour zu mir? ---
    plan = pg.evaluate(mk, ["Plan Hochtour", "walk", 0, 150, 0, 0.0005, 47.0, 11.0, "planned"]); plan_n = pg.evaluate(mk, ["Plan Nord", "walk", 0, 40, 0, 0.0005, 70.0, 20.0, "planned"])
    pg.evaluate("id => { location.hash = '#/tour/' + id }", plan); pg.wait_for_selector("#passt-sec"); pg.wait_for_selector("#pnotes-sec")
    ps = pg.inner_text("#passt-sec"); assert "Form" in ps and "Tageslicht" in ps and "Strecke: länger als üblich" in ps and "Mehr als sonst" in ps and "Orientierung, keine Sicherheitsgarantie. Wetter, Lawinenlage und Gelände selbst prüfen." in ps, ps
    assert pg.locator("#rueckblick").count() == 0
    assert pg.input_value("#tl-start") == "09:00" and pg.input_value("#tl-puffer") == "20", "Standard 09:00 und 20 %"
    pg.fill("#tl-date", "2026-06-21"); pg.dispatch_event("#tl-date", "change"); pg.wait_for_function("document.querySelector('#tl-say').innerText.includes('vor Sonnenuntergang')")
    sy = pg.inner_text("#tl-out"); assert "Rückkehr vor Sonnenuntergang mit" in sy and "Reserve" in sy and "Sonnenaufgang" in sy and "Sonnenuntergang" in sy, sy
    pg.fill("#tl-date", "2026-12-21"); pg.fill("#tl-start", "13:00"); pg.fill("#tl-puffer", "100"); pg.dispatch_event("#tl-puffer", "change"); pg.wait_for_function("document.querySelector('#tl-say').innerText.includes('nach Sonnenuntergang')")
    assert pg.evaluate("PlanMeta.get(%s).then(m => m.datum === '2026-12-21' && m.start === '13:00' && m.puffer === 100)" % json.dumps(plan)), "Datum, Start und Puffer gemerkt"
    pg.fill("#tl-start", "10:00"); pg.fill("#tl-puffer", "0"); pg.dispatch_event("#tl-puffer", "change"); pg.wait_for_function("!document.querySelector('#tl-say').innerText.includes('nach Sonnenuntergang')")
    pg.fill("#tl-puffer", "150"); pg.dispatch_event("#tl-puffer", "change"); pg.wait_for_selector("#tl-out .err"); assert "Puffer" in pg.inner_text("#tl-out")
    pg.fill("#tl-puffer", "20"); pg.dispatch_event("#tl-puffer", "change"); pg.wait_for_selector("#tl-say")
    pg.evaluate("id => { location.hash = '#/tour/' + id }", plan_n); pg.wait_for_selector("#passt-sec"); pg.fill("#tl-date", "2026-06-21"); pg.dispatch_event("#tl-date", "change"); pg.wait_for_function("document.querySelector('#tl-say').innerText.includes('Polartag')")
    pg.fill("#tl-date", "2026-12-21"); pg.dispatch_event("#tl-date", "change"); pg.wait_for_function("document.querySelector('#tl-say').innerText.includes('Polarnacht')")
    pg.evaluate("id => { location.hash = '#/tour/' + id }", plan); pg.wait_for_selector("#pnotes-sec"); assert pg.input_value("#tl-date") == "2026-12-21", "Eingaben bleiben nach dem Wechsel erhalten"
    # Notiz, Herkunft, Links
    opened = []; pg.on("request", lambda r: opened.append(r.url) if "komoot.de" in r.url else None)
    pg.fill("#pn-note", "Parkplatz am See, Einkehr in der Hütte"); pg.dispatch_event("#pn-note", "change")
    pg.select_option("#pn-qart", "komoot"); pg.fill("#pn-qtext", "Tour 123"); pg.dispatch_event("#pn-qtext", "change")
    pg.wait_for_function("PlanMeta.get(%s).then(m => m.note === 'Parkplatz am See, Einkehr in der Hütte' && m.quelle && m.quelle.art === 'komoot' && m.quelle.text === 'Tour 123')" % json.dumps(plan))
    pg.evaluate("document.querySelector('#pn-qtext').value = 'x'.repeat(201)"); pg.dispatch_event("#pn-qtext", "change"); pg.wait_for_timeout(500); assert "zu lang" in pg.evaluate("document.querySelector('#toast').textContent"), pg.evaluate("[document.querySelector('#toast').textContent, document.querySelector('#pn-qtext').value.length, document.querySelector('#pn-qart').value]")
    for bad, why in (("javascript:alert(1)", "http"), ("data:text/html,<b>x</b>", "http"), ("file:///etc/passwd", "http"), ("https://user:pw@example.org/", "Zugangsdaten"), ("", "Adresse fehlt")):
        pg.click("#pn-addlink"); pg.wait_for_selector("#lk-url"); pg.fill("#lk-url", bad); pg.click("#lk-save"); pg.wait_for_selector(".sheet .err:not(:empty)")
        assert why in pg.inner_text(".sheet .err"), (bad, pg.inner_text(".sheet .err"))
        assert pg.evaluate("PlanMeta.get(%s).then(m => !(m.links || []).length)" % json.dumps(plan)), "abgelehnte Adresse wird nicht gespeichert: " + bad
        pg.evaluate("(sheet.stack || []).slice().forEach(x => x.close())"); pg.wait_for_selector(".sheet", state="detached")
    pg.click("#pn-addlink"); pg.fill("#lk-titel", "Komoot-Tour"); pg.fill("#lk-url", "https://www.komoot.de/tour/123"); pg.select_option("#lk-art", "karte"); pg.click("#lk-save"); pg.wait_for_selector(".sheet", state="detached")
    pg.click("#pn-addlink"); pg.fill("#lk-url", "https://lawinen.report/"); pg.select_option("#lk-art", "wetter"); pg.click("#lk-save"); pg.wait_for_selector(".sheet", state="detached")
    lk = pg.inner_text("#pn-links"); assert "Komoot-Tour" in lk and "www.komoot.de · Karte, Route" in lk and "lawinen.report · Wetter, Lawinenbericht" in lk, lk
    a = pg.locator("#pn-links a").first; assert a.get_attribute("href") == "https://www.komoot.de/tour/123" and a.get_attribute("target") == "_blank" and "noopener" in a.get_attribute("rel")
    pg.evaluate("window.__opened = null"); a.click(); assert pg.evaluate("window.__opened") == "https://www.komoot.de/tour/123", "öffnet über die Brücke"
    pg.wait_for_timeout(300); assert not opened, "Links werden nie automatisch abgerufen: " + str(opened)
    pg.evaluate("Nav.render()"); pg.wait_for_selector("#passt-sec a[href^='https://lawinen.report']"); assert pg.locator("#pn-links .li").count() == 2 and pg.locator("#passt-sec a[href^='https://lawinen.report']").count() == 1, (pg.locator("#pn-links .li").count(), pg.inner_text("#passt-sec"), pg.evaluate("[...document.querySelectorAll('#passt-sec a')].map(a=>a.href)"))
    pg.click("#pn-links button[aria-label^='Link entfernen: Komoot']"); pg.wait_for_function("document.querySelectorAll('#pn-links .li').length === 1")
    pg.evaluate("async id => { const m = await PlanMeta.get(id); m.links = Array.from({ length: 20 }, (_, i) => ({ titel: 'L' + i, url: 'https://a.de/' + i, art: 'sonstiges' })); await DB.kvSet('pn:' + id, m); Nav.render(); }", plan)
    pg.wait_for_selector("#pn-addlink[disabled]"); assert "Höchstens 20" in pg.inner_text("#pn-addlink")
    pg.evaluate("async id => { const m = await PlanMeta.get(id); m.links = [{ titel: 'böse', url: 'javascript:alert(1)', art: 'karte' }, { titel: 'gut', url: 'https://ok.de', art: 'karte' }]; await DB.kvSet('pn:' + id, m); Nav.render(); }", plan)
    pg.wait_for_selector("#pn-links"); assert pg.locator("#pn-links .li").count() == 1 and "gut" in pg.inner_text("#pn-links"), "ungültige Links aus fremden Daten werden beim Lesen ausgelassen"
    # Neu-Speichern im Planer (Tour entfernen, gleiche Kennung) verliert die Notizen nicht
    pg.evaluate("async id => { const t = await DB.get('tours', id), p = await Tours.points(id); await Tours.remove(id); await Tours.add({ id, name: t.name, sport: t.sport, pts: p, status: 'planned', src: 'plan' }); }", plan)
    assert pg.evaluate("PlanMeta.get(%s).then(m => m.note.startsWith('Parkplatz'))" % json.dumps(plan))
    # --- 6. Plan und Ergebnis: manuell verknüpfen, und aus einer Aufzeichnung heraus ---
    pg.evaluate("id => { location.hash = '#/tour/' + id }", big); pg.wait_for_selector("#rueckblick"); pg.click("header.top button[aria-label=Aktionen]"); pg.get_by_text("Mit Plan vergleichen").click(); pg.wait_for_selector(".sheet .li")
    pg.locator(".sheet .li", has_text="Plan Hochtour").click(); pg.wait_for_selector("#planergebnis")
    pe = pg.inner_text("#planergebnis"); assert "geplant" in pe and "geschätzt" in pe and ("mehr" in pe or "weniger" in pe or "wie geplant" in pe), pe
    assert pg.locator("#rueckblick").count() == 0, "mit Plan zeigt nur „Plan und Ergebnis“, nichts doppelt"
    pg.evaluate("id => { location.hash = '#/tour/' + id }", plan); pg.wait_for_selector("#ranby"); assert "Große Runde" in pg.inner_text("#ranby")
    pg.evaluate("id => { location.hash = '#/tour/' + id }", big); pg.wait_for_selector("#unlinkplan"); pg.click("#unlinkplan"); pg.wait_for_selector("#rueckblick"); assert pg.locator("#planergebnis").count() == 0
    # Aufzeichnung aus der Planung: Verknüpfung nur, wenn die Route noch die der Planung ist
    pg.evaluate("window.__routeName = 'Plan Nord'"); pg.evaluate("async id => { TourHelp.armPlan(await DB.get('tours', id)); }", plan_n); pg.wait_for_timeout(100)
    pg.evaluate("window.__routeName = 'Etwas anderes'"); pg.evaluate("TourHelp.lockPlan()"); pg.wait_for_timeout(200)
    assert pg.evaluate("DB.kvGet('recPlanRun', 'x')") is None, "andere Route: keine Verknüpfung"
    pg.evaluate("window.__routeName = 'Plan Nord'"); pg.evaluate("TourHelp.lockPlan()"); pg.wait_for_timeout(200)
    assert pg.evaluate("DB.kvGet('recPlanRun', null)") == plan_n
    lid = pg.evaluate(mk, ["Gelaufen Nord", "walk", 160, 30, 60000, 0.0005, 70.0, 20.0, None])
    assert pg.evaluate("async ([id, pid]) => { const t = await DB.get('tours', id); await TourHelp.attachPlan(t); return (await DB.get('tours', id)).plan === pid; }", [lid, plan_n])
    pg.evaluate("id => { location.hash = '#/tour/' + id }", lid); pg.wait_for_selector("#planergebnis"); assert "Plan Nord" in pg.inner_text("#planergebnis")
    pg.evaluate("window.__routeName = ''")
    # --- 7. Fitness-Einordnung ---
    for i in range(6): pg.evaluate(mk, [f"Fit {i}", "hike", 70 - i * 11, 60, 60000, 0.0005, 46.0 + i * 0.05, 8.0, None])
    pg.evaluate("async () => { await Set_.set('birthYear', ''); }")
    pg.evaluate("Nav.go('/stats/fitness')"); pg.wait_for_selector("#fitness"); assert pg.locator("#fit-year").count() == 1 and "Orientierung, keine medizinische Aussage" in pg.inner_text("#fitness") and pg.locator("#fit-total").count() == 0
    pg.fill("#fit-year", "1850"); pg.click("#fit-save"); pg.wait_for_timeout(200); assert "plausibel" in pg.inner_text("#fitness").lower() or "zwischen" in pg.inner_text("#fitness").lower() or "Jahr" in pg.inner_text("#fitness"); assert pg.evaluate("Set_.get('birthYear')") == ""
    pg.fill("#fit-year", "1975"); pg.click("#fit-save"); pg.wait_for_selector("#fit-total"); ft = pg.inner_text("#fitness")
    assert "von 100" in ft and "Umfang" in ft and "Regelmäßigkeit" in ft and "Intensität" in ft and "NaN" not in ft and "undefined" not in ft, ft
    assert "Orientierung, keine medizinische Aussage" in ft and pg.locator("#fit-how").count() == 1 and pg.evaluate("document.querySelector('#fit-how').open") is False
    pg.click("#fit-how summary"); assert "Tanaka" in pg.inner_text("#fit-how") and "WHO" in pg.inner_text("#fit-how") or "Weltgesundheitsorganisation" in pg.inner_text("#fit-how")
    pg.evaluate("location.hash = '#/start'"); pg.wait_for_selector("#hero"); pg.wait_for_timeout(300); assert pg.locator("#fitness-home").count() == 0, "Fitness auf der Startseite ist standardmäßig aus"
    pg.evaluate("async () => { await Set_.set('homeShow', { fitness: true }); Nav.render(); }"); pg.wait_for_selector("#fitness-home"); assert "Orientierung, keine medizinische Aussage" in pg.inner_text("#fitness-home")
    pg.evaluate("async () => { await Set_.set('homeShow', {}); }")
    # --- 8. Startseite einrichten (Einstellungen) ---
    pg.evaluate("Nav.go('/settings')"); pg.wait_for_selector("#homeset")
    assert pg.locator("#homeset input[type=checkbox]").count() >= 5 and "Sicherung" in pg.inner_text("#view")
    assert not pg.is_checked("#hs-serie input") and not pg.is_checked("#hs-fitness input") and pg.is_checked("#hs-recent input") and pg.is_checked("#hs-memo input")
    pg.click("#hs-serie"); pg.click("#hs-recent"); pg.wait_for_function("Set_.get('homeShow').serie === true && Set_.get('homeShow').recent === false")
    # Geburtsjahr auch hier: entfernen und wieder eintragen, das Feld zeichnet sich selbst neu
    assert pg.input_value("#fit-year") == "1975"; pg.click("#fit-del"); pg.wait_for_selector("#fit-del", state="detached"); assert pg.evaluate("Set_.get('birthYear')") == "" and pg.input_value("#fit-year") == ""
    pg.fill("#fit-year", "abcd"); pg.click("#fit-save"); pg.wait_for_selector("#fit-yearbox .err:not(:empty)"); assert pg.evaluate("Set_.get('birthYear')") == ""
    pg.fill("#fit-year", "1975"); pg.click("#fit-save"); pg.wait_for_selector("#fit-del"); assert pg.evaluate("Set_.get('birthYear')") == 1975
    pg.evaluate("Nav.go('/start')"); pg.wait_for_selector("#hero"); pg.wait_for_timeout(400)
    assert pg.locator("#serie").count() == 1 and pg.locator("#recent").count() == 0 and pg.locator("#hero").count() == 1
    pg.evaluate("async () => { await Set_.set('homeShow', {}); }")
    # --- Sicherung hin und zurück: neue Daten reisen mit, alte Sicherungen laden ---
    pg.evaluate("async () => { await Goals.save([{ id: 'gbk', period: 'year', year: new Date().getFullYear(), metric: 'km', target: 555, sport: '' }]); await Set_.set('homeShow', { serie: true }); await Set_.set('backupDays', 30); }")
    pg.evaluate("async id => { const m = await PlanMeta.get(id); m.note = 'Sicherungsnotiz'; await DB.kvSet('pn:' + id, m); }", plan)
    pg.evaluate("async () => { window.__bk = JSON.parse(JSON.stringify(await Backup.collect())); }")
    assert pg.evaluate("__bk.kv.some(e => e.k === 'goals2') && __bk.kv.some(e => e.k.startsWith('pn:')) && __bk.kv.some(e => e.k === 'settings' && e.v.birthYear == 1975 && e.v.backupDays === 30) && !__bk.kv.some(e => e.k === 'lastBackup')")
    pg.evaluate("async id => { await DB.del('kv', 'goals2'); await DB.del('kv', 'pn:' + id); await Set_.set('birthYear', ''); await Set_.set('homeShow', {}); await Set_.set('backupDays', 14); }", plan)
    pg.evaluate("async () => { await Backup.apply(__bk); }")
    assert pg.evaluate("Goals.list().then(l => l.some(g => g.id === 'gbk' && g.target === 555))")
    assert pg.evaluate("async id => (await PlanMeta.get(id)).note === 'Sicherungsnotiz'", plan)
    assert pg.evaluate("Set_.get('birthYear') == 1975 && Set_.get('homeShow').serie === true && Set_.get('backupDays') === 30")
    pg.evaluate("async () => { await Backup.apply({ app: 'tourentagebuch', v: 1, tours: [], tracks: [], photos: [], kv: [{ k: 'goals', v: { 2025: { km: 700 } } }] }); await Backup.apply({ app: 'tourentagebuch', v: 1, tours: [], tracks: [], photos: [] }); }")
    assert pg.evaluate("Goals.list().then(l => l.some(g => g.year === 2025 && g.target === 700) && l.some(g => g.id === 'gbk'))"), "ältere Ziele werden ergänzt, nichts geht verloren"
    # Dasselbe über die gepackte Datei (.mtl), wie sie wirklich gespeichert und wieder eingelesen wird; auch die Verknüpfung Plan ↔ Tour und die Links reisen mit
    pg.evaluate("window.__saved = null"); pg.evaluate("Backup.save()"); pg.wait_for_function("window.__saved && window.__saved.name.endsWith('.mtl')")
    pg.evaluate("async ([pid, lid]) => { await DB.del('kv', 'goals2'); await DB.del('kv', 'pn:' + pid); await Tours.remove(lid); await Set_.set('birthYear', ''); await Set_.set('homeShow', {}); await Set_.set('bestN', 1); }", [plan, lid])
    n = pg.evaluate("async () => { const u = Uint8Array.from(atob(__saved.b64), c => c.charCodeAt(0)), d = Backup.parse(u); await Backup.apply(d); return [d.v, d.tours.length, d.kv.length]; }")
    assert n[0] == 1 and n[1] > 10 and n[2] > 3, n
    assert pg.evaluate("async ([pid, lid, pn]) => { const t = await DB.get('tours', lid), m = await PlanMeta.get(pid); return !!t && t.plan === pn && m.note === 'Sicherungsnotiz' && Planhilfe.ladeLinks(m.links).length === 1 && (await Tours.points(lid)).length === 30; }", [plan, lid, plan_n])
    assert pg.evaluate("Goals.list().then(l => l.some(g => g.id === 'gbk')) && Set_.get('birthYear') == 1975 && Set_.get('homeShow').serie === true")
    pg.evaluate("id => { location.hash = '#/tour/' + id }", lid); pg.wait_for_selector("#planergebnis")
    # Alte Sicherung (Stand 1.8: Touren ohne die neuen Felder, ältere Einstellungen, ältere Jahresziele, Zwischenspeicher): lädt, nichts Vorhandenes geht verloren, nichts Fremdes kommt herein
    old = pg.evaluate("""async () => {
      const pts = Array.from({ length: 20 }, (_, i) => ({ lat: 44 + i * 0.0005, lon: 7, ele: 500 + i, t: Date.UTC(2021, 5, 1, 8) + i * 60000 }));
      const data = { app: 'tourentagebuch', v: 1, date: Date.UTC(2024, 0, 1),
        tours: [{ id: 'alt18tour', name: 'Aus alter Sicherung', sport: 'hike', status: 'done', start: pts[0].t, end: pts[19].t, dur: 1140, moving: 1140, dist: 1056, up: 19, down: 0, maxAlt: 519, minAlt: 500, lat: 44, lon: 7, src: 'file', srcId: '', note: 'alt', fav: false, hidden: false, timed: true, created: 1 }],
        tracks: [{ id: 'alt18tour', lat: pts.map(p => p.lat), lon: pts.map(p => p.lon), ele: pts.map(p => p.ele), t: pts.map(p => p.t), seg: pts.map(() => 0) }], photos: [],
        kv: [{ k: 'settings', v: { photoMargin: 45, tiles: 'osm', gibtEsNicht: 1 } }, { k: 'goals', v: { 2024: { km: 444, n: 12 } } }, { k: 'tilebg', v: { x: 1 } }, { k: 'heroMap', v: { id: 'x', data: 'y' } }, { k: 'komoot', v: { token: 'geheim' } }, { k: 'plan:alt18plan', v: { wps: [] } }] };
      const gz = fflate.gzipSync(new TextEncoder().encode(JSON.stringify(data)));
      const before = { n: (await Tours.list()).length, heroMap: JSON.stringify(await DB.kvGet('heroMap', null)), komoot: JSON.stringify(await DB.kvGet('komoot', null)), by: Set_.get('birthYear') };
      await Backup.apply(Backup.parse(gz));
      return { added: (await Tours.list()).length - before.n, pm: Set_.get('photoMargin'), by: Set_.get('birthYear') == before.by, junk: 'gibtEsNicht' in Set_.v,
        goal: (await Goals.list()).some(g => g.year === 2024 && g.metric === 'km' && g.target === 444) && (await Goals.list()).some(g => g.id === 'gbk'),
        cache: JSON.stringify(await DB.kvGet('heroMap', null)) === before.heroMap, cred: JSON.stringify(await DB.kvGet('komoot', null)) === before.komoot, plan: !!(await DB.kvGet('plan:alt18plan', null)) }; }""")
    assert old == {"added": 1, "pm": 45, "by": True, "junk": False, "goal": True, "cache": True, "cred": True, "plan": True}, old
    pg.evaluate("location.hash = '#/tour/alt18tour'"); pg.wait_for_selector(".tourp h1"); pg.wait_for_timeout(300)
    assert "Aus alter Sicherung" in pg.inner_text(".tourp") and pg.locator("#rueckblick, #planergebnis, #passt-sec").count() == 0, "alte Tour ohne neue Felder öffnet wie bisher"
    pg.evaluate("async () => { await Tours.remove('alt18tour'); await DB.del('kv', 'plan:alt18plan'); await Set_.set('photoMargin', 20); await DB.del('kv', 'goals2'); await DB.kvSet('goals', {}); await Set_.set('homeShow', {}); await Set_.set('backupDays', 14); await DB.kvSet('lastBackup', Date.now()); }")
    return {"big": big, "plan": plan, "linked": lid}


MT_FAKE = """(fx) => {
  /* „Meine Touren“ hinter einer nachgestellten Native.http: spielt die echten Antworten eines Testservers ab (tests/data/meine-touren-beispiel.json,
     erzeugt mit tests/check_meine_touren.py --fixtures). Sitzungen, Abmelden und Zwei-Faktor verhalten sich wie am Server. */
  const S = { sessions: new Set(), log: [], edit: null, delay: 0 }, A = fx.antworten, real = window.__mtReal || Native.http;
  window.__mtReal = real;
  const R = x => ({ status: x.status, headers: Object.assign({}, x.headers || {}), body: x.body });
  Native.http = async o => {
    const u = new URL(o.url); if (u.hostname !== 'mt.test') return real(o);
    const path = u.pathname, m = (o.method || 'GET').toUpperCase(), tok = String((o.headers || {}).Cookie || '').replace('kh_session=', '');
    S.log.push(m + ' ' + path);
    if (S.delay) await new Promise(r => setTimeout(r, S.delay));
    if (path === '/api/me') return R(A.me);
    if (path === '/api/login' && m === 'POST') { const b = JSON.parse(o.body), n = String(b.name).toLowerCase();
      if (n === 'tagebuch' && b.password === 'nur-lesen-1234') { S.sessions.add('SITZUNG-BETRACHTER-BEISPIEL'); return R(A.login_betrachter); }
      if (n === 'zweifach' && b.password === 'zwei-faktor-1234') return R(A.login_2fa_noetig);
      return R(A.login_falsch); }
    if (path === '/api/login/2fa' && m === 'POST') { const b = JSON.parse(o.body);
      if (b.ticket === 'TICKET-BEISPIEL' && b.code === '123456') { S.sessions.add('SITZUNG-ZWEIFACH-BEISPIEL'); return R(A.login_2fa_ok); } return R(A.login_2fa_falsch); }
    if (path === '/api/logout' && m === 'POST') { S.sessions.delete(tok); return R(A.logout); }
    /* 2.5.0 Senden: nachgestellt wird, was der Server tut (app/main.py api_record_upload, extras.py /note, more.py /rating): Konto „nur ansehen“ → 403, Kennung g<Start in s>, zweites Mal dup */
    S.mine = S.mine || []; S.up = S.up || []; S.notes = S.notes || {}; S.stars = S.stars || {}; S.gpx = S.gpx || {};
    if (m === 'POST' && /^\\/api\\/(record\\/upload|tours\\/[^/]+\\/(note|rating))$/.test(path)) {
      if (!S.sessions.has(tok)) return R(A.ohne_sitzung);
      if (/^SITZUNG-BETRACHTER/.test(tok)) return { status: 403, headers: {}, body: '{"detail":"Nur ansehen: dieses Konto darf nichts ändern"}' };
      if (S.fail) return { status: S.fail, headers: {}, body: '{"detail":"Testfehler"}' };
      const b = JSON.parse(o.body);
      if (path === '/api/record/upload') {
        const tm = String(b.gpx).match(/<trkpt[^>]*>[\\s\\S]*?<time>([^<]+)</); if (!tm || String(b.gpx).indexOf('<trkpt') < 0) return { status: 400, headers: {}, body: '{"detail":"Keine GPS-Punkte"}' };
        const ts = Math.round(Date.parse(tm[1]) / 1000), id = 'g' + ts;
        if (S.mine.some(x => x.id === id) || JSON.parse(A.tours.body).some(x => x.id === id)) return { status: 200, headers: {}, body: JSON.stringify({ id, dup: true }) };
        S.up.push(b); S.gpx[id] = b.gpx;
        const n = (String(b.gpx).match(/<trkpt/g) || []).length;
        S.mine.push({ id, name: b.name, sport: b.sport || 'hike', start_ts: ts, end_ts: ts + n * 30, dist_m: S.dist || (n - 1) * 44.478, dur_s: n * 30, up_m: 10, down_m: 10, lat: 47, lng: 11, status: 'tour_recorded', source: 'local', photos: 0, note: null, stars: null });
        return { status: 200, headers: {}, body: JSON.stringify({ id, dup: false, device: null }) };
      }
      const id = decodeURIComponent(path.split('/')[3]);
      if (!S.mine.some(x => x.id === id)) return { status: 404, headers: {}, body: '{"detail":"Tour nicht gefunden"}' };
      if (/note$/.test(path)) S.notes[id] = b.note; else S.stars[id] = b.stars;
      return { status: 200, headers: {}, body: '{"ok":true}' };
    }
    if (m !== 'GET') return { status: 405, headers: {}, body: '{"detail":"Method Not Allowed"}' };
    if (!S.sessions.has(tok)) return R(A.ohne_sitzung);
    if (path === '/api/tours') { let l = JSON.parse(A.tours.body); if (S.edit) l = S.edit(l); return { status: 200, headers: {}, body: JSON.stringify(l.concat(S.mine)) }; }
    const g = path.match(/^\\/api\\/tours\\/([^/]+)\\/gpx$/), gid = g && ((S.gleich || {})[g[1]] || g[1]);
    if (g && S.gpx[g[1]]) return { status: 200, headers: {}, body: S.gpx[g[1]] };
    if (g) return fx.gpx[gid] ? { status: 200, headers: {}, body: fx.gpx[gid] } : R(A.gpx_fehlt);
    return { status: 404, headers: {}, body: '{"detail":"Not Found"}' };
  };
  window.__mt = S; }"""

def mt_fixture():
    with open(os.path.join(os.path.dirname(__file__), "data", "meine-touren-beispiel.json"), encoding="utf-8") as f: return json.load(f)

MT_VORHANDEN = """async (srv) => {
  /* Touren, die es in der App schon gibt: g2 als Datei mit selbst erzeugtem Namen, g4 als Datei mit eigenem Namen (Start 2 Minuten daneben),
     die Komoot-Tour (andere Startzeit, gleiche Komoot-Nummer) und eine Tour mit gleicher Startzeit wie s0, aber dreifacher Länge (keine Zuordnung). */
  const by = Object.fromEntries(srv.map(t => [t.id, t]));
  const line = (t, f, n, dt) => Array.from({ length: n }, (_, i) => ({ lat: t.lat + i * (t.dist_m * f / (n - 1)) / 111195, lon: t.lng, ele: 600 + 300 * Math.sin(Math.PI * i / (n - 1)), t: t.start_ts * 1000 + (dt || 0) + i * 30000 }));
  const a = (await Tours.add({ sport: 'hike', pts: line(by.g2, 1.04, 200), src: 'file' })).tour;
  const b = (await Tours.add({ name: 'Mein eigener Name', sport: 'bike', pts: line(by.g4, 0.97, 80, 120000), src: 'file' })).tour;
  const k = (await Tours.add({ name: 'Komoot-Name alt', sport: 'hike', pts: line(by['987654321'], 0.5, 60, 3 * 3600000), src: 'komoot', srcId: 'komoot:987654321' })).tour;
  k.nameKomoot = k.name; await Tours.save(k);
  const l = (await Tours.add({ name: 'Andere Tour zur selben Zeit', sport: 'hike', pts: line(by.s0, 3, 40), src: 'file' })).tour;
  return { a: { id: a.id, up: a.up, dist: a.dist, name: a.name }, b: b.id, k: k.id, l: l.id }; }"""

def meine_touren(pg):
    """2.1.0, Punkt 1: „Aus Meine Touren holen“ – Anmeldung (auch Zwei-Faktor, falsches Passwort, abgelaufene Sitzung), Abgleich (neu, vorhanden, Namen, Zahlen,
    Sportarten), Wiederholung, Abbruch, Rangfolge der Zahlen nach einer Korrektur, Schalter, Trennen, Sicherung ohne Sitzungsschlüssel. Die Antworten des Servers
    sind echte, bereinigte Beispieldaten (siehe MT_FAKE); gegen einen laufenden Server prüft tests/check_meine_touren.py."""
    fx = mt_fixture(); srv = json.loads(fx["antworten"]["tours"]["body"]); by = {t["id"]: t for t in srv}
    vorher = pg.evaluate("Tours.list().then(l => l.map(t => t.id))")
    pg.evaluate(MT_FAKE, fx)
    # Adresse und Hinweise (rein gerechnet)
    u = pg.evaluate("""() => { const M = Import.MT, bad = x => { try { M.base(x); return false; } catch (e) { return true; } };
      return { b: [M.base('meine-touren.example.ts.net/'), M.base(' http://192.168.1.5:8080/#/tour/1 '), M.base('HTTPS://Touren.Example.org/x?y')], bad: [bad(''), bad('ftp://x.y'), bad('http://')],
        priv: ['http://192.168.1.5:8080', 'http://10.0.0.2', 'http://172.20.1.1', 'http://100.101.102.103', 'http://nas', 'http://nas.fritz.box', 'http://touren.tail1234.ts.net', 'http://localhost:8000', 'http://[fd7a:115c:a1e0::1]'].map(M.privat),
        pub: ['http://touren.example.org', 'http://8.8.8.8', 'http://172.32.0.1', 'http://100.128.0.1', 'http://[2001:db8::1]'].map(M.privat),
        sp: ['hike', 'touringbicycle', 'e_touringbicycle', 'e_mtb', 'mtb', 'racebike', 'jogging', 'skialpin', 'skitour', 'snowshoe', 'nordic', 'nordicwalking', 'mountaineering', 'other', 'kitesurfen', ''].map(M.sport) }; }""")
    assert u["b"] == ["https://meine-touren.example.ts.net", "http://192.168.1.5:8080", "https://touren.example.org"] and all(u["bad"]) and all(u["priv"]) and not any(u["pub"]), u
    assert u["sp"] == ["hike", "bike", "ebike", "ebike", "mtb", "racebike", "run", "skialpin", "skitour", "hike", "nordic", "hike", "mountaineering", "other", "other", "other"], u["sp"]
    pre = pg.evaluate(MT_VORHANDEN, srv)
    # Blatt: unverschlüsselte Adresse außerhalb des eigenen Netzes → deutlicher Hinweis und Rückfrage; im eigenen Netz nur der Hinweis
    go = lambda: (pg.evaluate("location.hash = '#/import'"), pg.wait_for_selector("#imp-mt"), pg.evaluate("(sheet.stack || []).slice().forEach(x => x.close())"), pg.wait_for_selector(".sheet", state="detached"), pg.click("#imp-mt"))
    toast = lambda rx, t=20000: (pg.wait_for_function("rx => { const t = document.querySelector('#toast'); return !!t && t.classList.contains('on') && new RegExp(rx).test(t.textContent); }", arg=rx, timeout=t), pg.inner_text("#toast"))[1]
    leise = lambda: pg.wait_for_function("() => { const t = document.querySelector('#toast'); return !t || !t.classList.contains('on'); }", timeout=30000)      # alte Meldung abwarten, sonst passt der Text der vorigen
    go(); pg.wait_for_selector("#mt-url"); assert pg.locator("#mt-http").is_hidden() and pg.locator("#mt-zahlen input").is_checked()
    pg.fill("#mt-url", "http://192.168.1.20:8080"); assert "Im eigenen Netz" in pg.inner_text("#mt-http")
    pg.fill("#mt-url", "http://touren.example.org"); assert "Achtung" in pg.inner_text("#mt-http") and "unverschlüsselt" in pg.inner_text("#mt-http")
    pg.fill("#mt-name", "Tagebuch"); pg.fill("#mt-pw", "nur-lesen-1234"); (leise(), pg.click("#mt-go")); pg.wait_for_selector(".sheet[aria-label='Unverschlüsselt verbinden?']")
    pg.click(".sheet[aria-label='Unverschlüsselt verbinden?'] .btn:has-text('Abbrechen')"); pg.wait_for_selector(".sheet[aria-label='Unverschlüsselt verbinden?']", state="detached")
    assert pg.evaluate("window.__mt.log.length") == 0 and pg.locator("#mt-url").count() == 1, "ohne Zustimmung geht nichts ins Netz"
    # Falsches Passwort: verständliche Meldung, nichts gemerkt, das Blatt bleibt benutzbar
    pg.fill("#mt-url", "mt.test"); pg.fill("#mt-pw", "falsch"); (leise(), pg.click("#mt-go")); assert "Name oder Passwort stimmt nicht" in toast("Passwort")
    assert pg.evaluate("DB.kvGet('mt', null)") is None and pg.evaluate("window.__mt.log") == ["GET /api/me", "POST /api/login"]
    # Anmeldung als Betrachter und erster Abgleich
    pg.wait_for_selector(".sheet", state="detached"); go(); pg.wait_for_selector("#mt-url"); pg.fill("#mt-url", "mt.test"); pg.fill("#mt-name", "Tagebuch"); pg.fill("#mt-pw", "nur-lesen-1234")
    pg.evaluate("window.__mt.log = []"); (leise(), pg.click("#mt-go")); msg = toast("importiert", 60000)
    nur = " · %d Touren nur in der App" % (1 + pg.evaluate("ids => Tours.list().then(l => l.filter(t => ids.includes(t.id) && t.status !== 'planned' && !t.hidden).length)", vorher))      # was vorher da war, und die „andere Tour zur selben Zeit“
    assert msg == "13 Touren importiert · 3 schon vorhanden · Name bei 2 Touren übernommen · Zahlen bei 3 Touren angeglichen · 1 ohne Strecke auf dem Server" + nur, msg
    log = pg.evaluate("window.__mt.log"); assert log[:3] == ["GET /api/me", "POST /api/login", "GET /api/tours"] and len([x for x in log if x.endswith("/gpx")]) == 14 and not [x for x in log if x.split()[0] != "GET" and "login" not in x], log
    assert not [x for x in log if "/g2/" in x or "/g4/" in x or "/987654321/" in x], "für vorhandene Touren wird keine Strecke geladen"
    kv = pg.evaluate("DB.all('kv')"); acc = [k for k in kv if k["k"] == "mt"][0]["v"]
    assert acc["base"] == "https://mt.test" and acc["role"] == "viewer" and acc["name"] == "Tagebuch" and acc["token"] == "SITZUNG-BETRACHTER-BEISPIEL" and "nur-lesen-1234" not in json.dumps(kv), acc
    bk = pg.evaluate("Backup.collect()"); assert "SITZUNG" not in json.dumps(bk) and not [k for k in bk["kv"] if k["k"] == "mt"], "Sitzungsschlüssel nie in der Sicherung"
    assert pg.evaluate("async () => { await Backup.restoreKv([{ k: 'mt', v: { base: 'https://boese.example', token: 'x' } }]); return (await DB.kvGet('mt')).base; }") == "https://mt.test"
    st = pg.evaluate("""async (ids) => { const l = await Tours.list(), g = id => l.find(t => t.srcId === 'mt:' + id || t.mtId === id), o = {};
      for (const id of ids) { const t = g(id); o[id] = t ? { id: t.id, name: t.name, sport: t.sport, up: t.up, down: t.down, dist: t.dist, zMt: t.zMt, upSrc: t.upSrc, src: t.src, srcId: t.srcId, mtId: t.mtId, note: t.note, stars: t.starsMt, tags: t.tags, hr: t.hrAvg, nameMt: t.nameMt, start: t.start, timed: t.timed } : null; }
      return o; }""", list(by))
    assert st["987654322"] is None
    for t in srv:      # dieselben Zahlen wie am Server, Tour für Tour
        if t["id"] == "987654322": continue
        a = st[t["id"]]; assert a and a["zMt"] == 1 and a["upSrc"] == "mt" and abs(a["up"] - t["up_m"]) < 1e-6 and abs(a["down"] - t["down_m"]) < 1e-6 and abs(a["dist"] - t["dist_m"]) < 1e-6, (t["id"], a)
    assert st["g2"]["id"] == pre["a"]["id"] and st["g2"]["name"] == "Große Runde mit vielen Punkten" and st["g2"]["src"] == "file" and st["g2"]["mtId"] == "g2" and st["g2"]["up"] == 655 and abs(pre["a"]["up"] - 655) > 5, (st["g2"], pre)
    assert st["g4"]["id"] == pre["b"] and st["g4"]["name"] == "Mein eigener Name" and st["g4"]["nameMt"] is None and st["g4"]["sport"] == "ebike", st["g4"]      # Name von Hand bleibt, Sportart kommt
    assert st["987654321"]["id"] == pre["k"] and st["987654321"]["name"] == "Zugspitze durchs Reintal" and st["987654321"]["up"] == 2210 and st["987654321"]["srcId"] == "komoot:987654321", st["987654321"]
    assert st["s0"]["id"] != pre["l"] and st["s0"]["srcId"] == "mt:s0" and st["s0"]["src"] == "mt", st["s0"]      # gleiche Startzeit, aber ganz andere Länge: eigene Tour
    g1 = st["g1"]; assert g1["note"] == "Früh los, oben Gämsen gesehen." and g1["stars"] == 5 and sorted(g1["tags"]) == ["Gipfel", "Wetterstein"] and g1["hr"] and g1["timed"] and g1["start"] == by["g1"]["start_ts"] * 1000, g1
    assert {t["sport"]: st[t["id"]]["sport"] for t in srv if st[t["id"]]} == {"hike": "hike", "touringbicycle": "bike", "e_touringbicycle": "ebike", "mtb": "mtb", "e_mtb": "ebike", "racebike": "racebike", "jogging": "run",
        "skialpin": "skialpin", "skitour": "skitour", "snowshoe": "hike", "nordic": "nordic", "nordicwalking": "hike", "mountaineering": "mountaineering", "other": "other"}
    # Tourseite: Quelle, maßgebliche Zahlen mit eigener Rechnung daneben, Bewertung
    pg.evaluate("id => { location.hash = '#/tour/' + id }", g1["id"]); pg.wait_for_selector("#mtinfo"); f = pg.inner_text("#mtinfo")
    assert "· Meine Touren" in pg.inner_text(".tourp .sub") and "stammen aus Meine Touren" in f and "Eigene Rechnung aus der Spur: 4,5 km · ↑ " in f and "Sternen" not in f, f      # die Sterne stehen jetzt in der eigenen Bewertung (2.2.0)
    assert pg.locator("#rate .star.on").count() == 5 and "5 von 5 · aus Meine Touren" in pg.inner_text("#ratecap"), pg.inner_text("#ratecap")
    # Verbundenes Blatt, Wiederholung: nichts doppelt, keine Strecke wird noch einmal geladen (außer dem Versuch für die Tour ohne Strecke)
    go(); pg.wait_for_selector("#mt-state"); assert pg.inner_text("#mt-state") == "✓ Verbunden mit mt.test als Tagebuch (nur ansehen)", pg.inner_text("#mt-state")
    n1 = pg.evaluate("Tours.list().then(l => l.length)"); pg.evaluate("window.__mt.log = []"); pg.wait_for_function("() => { const t = document.querySelector('#toast'); return !t || !t.classList.contains('on'); }", timeout=30000); (leise(), pg.click("#mt-go")); tx = toast("schon vorhanden"); assert tx == "16 schon vorhanden · 1 ohne Strecke auf dem Server" + nur, tx
    assert pg.evaluate("window.__mt.log") == ["GET /api/tours", "GET /api/tours/987654322/gpx"] and pg.evaluate("Tours.list().then(l => l.length)") == n1
    sync = "async (z) => Import.MT.importAll(await DB.kvGet('mt'), { zahlen: z }, null)"
    # Rangfolge der Zahlen: nach einer Korrektur der Spur von Hand gilt die eigene Rechnung – bis zum nächsten Abgleich
    own = pg.evaluate("id => Tours.recalc(id, { eigen: true }).then(t => [t.up, t.dist, t.zMt === undefined, t.upSrc === undefined, t.upMt])", pre["a"]["id"])
    assert abs(own[0] - pre["a"]["up"]) < 1e-6 and abs(own[1] - pre["a"]["dist"]) < 1e-6 and own[2] and own[3] and own[4] == 655, own
    pg.evaluate("id => { location.hash = '#/tour/' + id }", pre["a"]["id"]); pg.wait_for_selector("#mtinfo"); f = pg.inner_text("#mtinfo"); assert "Meine Touren nennt" in f and "↑ 655 m" in f and "stammen aus" not in f, f
    r = pg.evaluate(sync, True); assert r["zahlen"] == 1 and r["added"] == 0 and r["dup"] == 16 and r["namesMt"] == 0, r
    assert pg.evaluate("id => DB.get('tours', id).then(t => [t.up, t.zMt, t.dist])", pre["a"]["id"]) == [655, 1, by["g2"]["dist_m"]]
    # … eine Neuberechnung ohne Korrektur (z. B. Uhr-Höhen beim Zepp-Import, Reparatur) lässt die Zahlen aus Meine Touren stehen
    assert pg.evaluate("id => Tours.recalc(id).then(t => [t.up, t.zMt, t.dist])", pre["a"]["id"]) == [655, 1, by["g2"]["dist_m"]]
    assert pg.evaluate("async id => { const t = await DB.get('tours', id); const r = await Fix.restoreEle(t); return [r.zMt === undefined, Math.abs(r.up - 655) > 5]; }", pre["a"]["id"]) == [True, True], "Originalhöhen wiederherstellen = von Hand"
    pg.evaluate(sync, True)
    # Schalter aus (im Blatt): überall wieder die eigene Rechnung, die Werte von Meine Touren bleiben als Angabe; Schalter an: wieder angeglichen
    go(); pg.wait_for_selector("#mt-zahlen"); pg.click("#mt-zahlen"); pg.wait_for_function("Set_.get('mtZahlen') === false"); (leise(), pg.click("#mt-go")); toast("schon vorhanden"); pg.wait_for_selector(".sheet", state="detached")
    z = pg.evaluate("Tours.list().then(l => [l.filter(t => t.zMt).length, l.filter(t => t.upSrc === 'mt').length, l.filter(t => t.upMt != null).length])"); assert z == [0, 0, 16], z
    assert abs(pg.evaluate("id => DB.get('tours', id).then(t => t.up)", pre["a"]["id"]) - pre["a"]["up"]) < 1e-6
    go(); pg.wait_for_selector("#mt-zahlen"); assert not pg.locator("#mt-zahlen input").is_checked(); pg.click("#mt-zahlen"); pg.wait_for_function("Set_.get('mtZahlen') === true"); (leise(), pg.click("#mt-go"))
    assert "Zahlen bei" in toast("angeglichen") and pg.evaluate("Tours.list().then(l => l.filter(t => t.zMt).length)") == 16
    pg.wait_for_selector(".sheet", state="detached")
    # Namen: am Server umbenannt → zieht nach; in der App von Hand benannt → bleibt; ein Name aus Meine Touren hat Vorrang vor Komoot
    pg.evaluate("() => { window.__mt.edit = l => l.map(t => t.id === 'g1' ? Object.assign({}, t, { name: 'Kramerspitz (neu benannt)' }) : t); }")
    r = pg.evaluate(sync, True); assert r["namesMt"] == 1 and pg.evaluate("Tours.list().then(l => l.find(t => t.srcId === 'mt:g1').name)") == "Kramerspitz (neu benannt)", r
    pg.evaluate("async () => { const t = (await Tours.list()).find(t => t.srcId === 'mt:g1'); t.name = 'Von Hand in der App'; await Tours.save(t); window.__mt.edit = l => l.map(t => t.id === 'g1' ? Object.assign({}, t, { name: 'Dritter Name am Server', note: 'Neue Notiz am Server' }) : t); }")
    r = pg.evaluate(sync, True); g = pg.evaluate("Tours.list().then(l => l.find(t => t.srcId === 'mt:g1'))"); assert r["namesMt"] == 0 and g["name"] == "Von Hand in der App" and g["note"] == "Neue Notiz am Server", (r, g)
    assert pg.evaluate("id => DB.get('tours', id).then(t => [Import.Komoot.takeName(t, 'Name aus Komoot'), t.name])", pre["k"]) == [False, "Zugspitze durchs Reintal"]
    pg.evaluate("window.__mt.edit = null")
    # Am Server doppelt vorhanden (gleiche Spur unter zweiter Kennung): in der App bleibt es eine Tour, die Strecke wird nur einmal geholt
    pg.evaluate("() => { window.__mt.gleich = { g3b: 'g3' }; window.__mt.edit = l => l.concat([Object.assign({}, l.find(t => t.id === 'g3'), { id: 'g3b' })]); window.__mt.log = []; }")
    n2 = pg.evaluate("Tours.list().then(l => l.length)"); r = pg.evaluate(sync, True); lg = pg.evaluate("window.__mt.log"); assert r["added"] == 0 and r["dup"] == 17 and "GET /api/tours/g3b/gpx" in lg, (r, lg)
    pg.evaluate("window.__mt.log = []"); r = pg.evaluate(sync, True); lg = pg.evaluate("window.__mt.log")
    assert r["dup"] == 17 and r["zahlen"] == 0 and "GET /api/tours/g3b/gpx" not in lg and pg.evaluate("Tours.list().then(l => [l.length, l.find(t => t.srcId === 'mt:g3').alias])") == [n2, ["mt:g3b"]], (r, lg)
    # Großer Bestand: 800 Touren am Server, alle schon in der App – ein Listenabruf, keine Strecke, Zahlen und Namen in Portionen angeglichen
    big = pg.evaluate("""async () => { const base = 1500000000, N = 800;
      window.__mt.edit = () => Array.from({ length: N }, (_, i) => ({ id: 'p' + i, name: 'Tour Nummer ' + i, sport: 'hike', start_ts: base + i * 86400, end_ts: base + i * 86400 + 7200, dist_m: 10000 + i, dur_s: 7200, up_m: 500 + i, down_m: 480, source: 'local' }));
      await DB.putMany('tours', Array.from({ length: N }, (_, i) => ({ id: 'big' + i, name: Tours.autoName('hike', (base + i * 86400) * 1000 + 60000), sport: 'hike', status: 'done', start: (base + i * 86400) * 1000 + 60000, end: (base + i * 86400) * 1000 + 7260000,
        dur: 7200, dist: 10300, up: 450, down: 450, src: 'zepp', srcId: 'zepp:big' + i, note: '', fav: false, hidden: false, timed: true, created: 1, calcV: 2 }))); Tours.invalidate();
      window.__mt.log = []; const t0 = performance.now(); const r = await Import.MT.importAll(await DB.kvGet('mt'), { zahlen: true }, null); const ms = Math.round(performance.now() - t0);
      const l = (await Tours.list()).filter(t => /^big/.test(t.id)), ok = l.filter(t => t.zMt === 1 && t.up === 500 + +t.mtId.slice(1) && t.name === 'Tour Nummer ' + t.mtId.slice(1)).length;
      const log = window.__mt.log.slice(); window.__mt.log = []; const t1 = performance.now(); const r2 = await Import.MT.importAll(await DB.kvGet('mt'), { zahlen: true }, null); const ms2 = Math.round(performance.now() - t1);
      await DB._tx('tours', 'readwrite', st => { l.forEach(t => st.delete(t.id)); }); Tours.invalidate(); window.__mt.edit = null;
      return { r, ms, ok, log, r2, ms2 }; }""")
    print(f"Meine Touren, 800 vorhandene Touren abgleichen: {big['ms']} ms (Wiederholung {big['ms2']} ms)")
    assert big["r"]["dup"] == 800 and big["r"]["added"] == 0 and big["r"]["zahlen"] == 800 and big["r"]["namesMt"] == 800 and big["ok"] == 800 and big["log"] == ["GET /api/tours"] and big["ms"] < 20000, big
    assert big["r2"]["zahlen"] == 0 and big["r2"]["namesMt"] == 0 and big["r2"]["dup"] == 800, big["r2"]
    # Abbruch: langsamer Server, „Abbrechen“ im Fortschrittsblatt – der Rest kommt beim nächsten Mal, nichts doppelt
    pg.evaluate("async () => { for (const t of (await Tours.list()).filter(t => /^mt:s\\d+$/.test(t.srcId))) await Tours.remove(t.id); window.__mt.delay = 250; }")
    go(); pg.wait_for_selector("#mt-go"); (leise(), pg.click("#mt-go")); pg.wait_for_selector("#prog-stop"); pg.wait_for_function("/\\d+ von 12/.test(document.querySelector('.sheet p').textContent)"); pg.click("#prog-stop")
    m = toast("abgebrochen", 30000); assert "abgebrochen – der Rest kommt beim nächsten Mal" in m, m
    k = pg.evaluate("Tours.list().then(l => l.filter(t => /^mt:s\\d+$/.test(t.srcId)).length)"); assert 0 < k < 11, k
    pg.evaluate("window.__mt.delay = 0"); r = pg.evaluate(sync, True); assert r["added"] == 11 - k and pg.evaluate("Tours.list().then(l => l.filter(t => /^mt:s\\d+$/.test(t.srcId)).length)") == 11, r
    # Abgelaufene Sitzung: freundliche Meldung ohne Schlüssel, Schlüssel vergessen, das Anmeldeblatt kommt mit Adresse und Name wieder
    pg.wait_for_selector(".sheet", state="detached"); pg.evaluate("window.__mt.sessions.clear()"); go(); pg.wait_for_selector("#mt-go"); (leise(), pg.click("#mt-go"))
    m = toast("abgelaufen"); assert m == "Die Anmeldung bei Meine Touren ist abgelaufen. Bitte neu anmelden." and "SITZUNG" not in m, m
    pg.wait_for_selector("#mt-pw"); assert pg.input_value("#mt-url") == "https://mt.test" and pg.input_value("#mt-name") == "Tagebuch" and pg.evaluate("DB.kvGet('mt')") == {"base": "https://mt.test", "name": "Tagebuch"}
    # Zwei-Faktor: falscher Code → Meldung; richtiger Code → verbunden
    for code, want in (("000000", "Der Code stimmt nicht"), ("123456", "schon vorhanden")):
        pg.wait_for_selector("#prog-stop", state="detached"); go(); pg.wait_for_selector("#mt-pw"); pg.fill("#mt-name", "Zweifach"); pg.fill("#mt-pw", "zwei-faktor-1234"); (leise(), pg.click("#mt-go"))
        pg.wait_for_selector(".sheet[aria-label='Zweiter Schritt'] input"); pg.fill(".sheet[aria-label='Zweiter Schritt'] input", code); pg.click(".sheet[aria-label='Zweiter Schritt'] .btn.pri"); assert want in toast(want)
    acc = pg.evaluate("DB.kvGet('mt')"); assert acc["name"] == "Zweifach" and acc["role"] == "user" and acc["token"] == "SITZUNG-ZWEIFACH-BEISPIEL", acc
    # Verbindung trennen: am Server abgemeldet, Schlüssel gelöscht; ohne Hinweis „nur ansehen“ stand der Tipp zum Nur-Lese-Konto da
    pg.wait_for_selector("#prog-stop", state="detached"); go(); pg.wait_for_selector("#mt-off"); assert "genügt ein Konto „nur ansehen“" in pg.inner_text(".sheet")
    pg.evaluate("window.__mt.log = []"); pg.click("#mt-off"); pg.wait_for_selector("#mt-pw")
    assert pg.evaluate("window.__mt.log") == ["POST /api/logout"] and pg.evaluate("window.__mt.sessions.size") == 0 and pg.evaluate("DB.kvGet('mt')") == {"base": "https://mt.test", "name": "Zweifach"}
    pg.evaluate("(sheet.stack || []).slice().forEach(x => x.close())"); pg.wait_for_selector(".sheet", state="detached")
    # Aufräumen: alles, was dieser Abschnitt angelegt hat
    pg.evaluate("async (keep) => { for (const t of await Tours.list()) if (!keep.includes(t.id)) await Tours.remove(t.id); await DB.del('kv', 'mt'); await Set_.set('mtZahlen', true); Native.http = window.__mtReal; }", vorher)
    assert pg.evaluate("Tours.list().then(l => l.length)") == len(vorher)


def uhr_hoehen(pg):
    """2.1.0, Punkt 2: Der Zepp-Import legt die Barometerhöhen der Uhr auf vorhandene Touren aus anderen Quellen – rückholbar, nie über eine Geländemodell-Korrektur,
    nie zweimal; die Zahlen aus Meine Touren behalten ihren Rang; Schalter „Höhen der Uhr übernehmen“."""
    vorher = pg.evaluate("Tours.list().then(l => l.map(t => t.id))")
    r = pg.evaluate("""async () => {
      const Z = Import.Zepp, DAY = 86400, base = 1750000000, N = 40;
      /* Training i: 40 Punkte im 30-s-Takt, die Uhr misst einen Berg (0 → +240 m → 0); Training 4 hat keine Höhen (Platzhalter) */
      const det = i => ({ time: '0' + ';30'.repeat(N - 1), longitude_latitude: (4700000000 + i * 1000000) + ',1100000000' + ';30000,20000'.repeat(N - 1),
        altitude: Array.from({ length: N }, (_, k) => i === 4 ? -2000000 : Math.round((900 + 240 * Math.sin(Math.PI * k / (N - 1))) * 100)).join(';'), heart_rate: ',95' + ';30,1'.repeat(N - 1), gait: '0' });
      const sums = [1, 2, 3, 4, 5, 6, 7].map(i => ({ trackid: String(base + i * DAY), type: 6, source: 'x' }));
      const calls = { hist: 0, det: [] };
      const req0 = Z.req;
      Z.req = async (acc, ep, q) => { if (/history/.test(ep)) { calls.hist++; return { data: { summary: window.__zsums || sums.slice(0, calls.n || 6), next: -1 } }; } calls.det.push(+q.trackid); return { data: det((+q.trackid - base) / DAY) }; };
      window.__zreq0 = req0; window.__zcalls = calls;
      /* vorhandene Touren: dieselbe Strecke und Zeit wie das Training, aber flache (Handy-/Komoot-)Höhen, kein Puls */
      const flat = i => Z.decode(sums[i - 1], det(i === 4 ? 1 : i)).map((p, k) => ({ lat: p.lat + (i === 4 ? 0.03 : 0), lon: p.lon, ele: 880 + (k % 2), t: p.t }));
      const A = (await Tours.add({ name: 'A Komoot', sport: 'hike', pts: flat(1), src: 'komoot', srcId: 'komoot:u1' })).tour;
      const B = (await Tours.add({ name: 'B Gelände', sport: 'hike', pts: flat(2), src: 'file' })).tour; B.elevFix = 1; await Tours.save(B);
      const C = (await Tours.add({ name: 'C Zepp', sport: 'hike', pts: flat(3), src: 'zepp', srcId: 'zepp:' + sums[2].trackid })).tour;
      const D = (await Tours.add({ name: 'D ohne Uhr-Höhen', sport: 'hike', pts: flat(4), src: 'rec' })).tour;
      const E = (await Tours.add({ name: 'E Meine Touren', sport: 'hike', pts: flat(5), src: 'file' })).tour; Object.assign(E, { mtId: 'e5', zMt: 1, upMt: 777, downMt: 700, distMt: 4321 }); Tours.applyHoehe(E, Geo.stats(flat(5))); await Tours.save(E);
      const up0 = A.up;
      const get = async t => { const x = await DB.get('tours', t.id), trk = await DB.get('tracks', t.id); return { up: x.up, dist: x.dist, src: x.elevSrc || null, fix: x.elevFix || null, zele: x.zele || null, zMt: x.zMt || null, hr: x.hrAvg || null, orig: !!trk.origEle, max: Math.max(...trk.ele), origUp: x.origUp }; };
      const acc = { token: 'x' };
      const r1 = await Z.importAll(acc, null, { ele: true }), d1 = calls.det.slice(); calls.det = [];
      const s1 = { A: await get(A), B: await get(B), C: await get(C), D: await get(D), E: await get(E) };
      const r2 = await Z.importAll(acc, null, { ele: true }), d2 = calls.det.slice(); calls.det = [];
      /* von Hand zurückgeholt: bleibt so, auch beim nächsten Import */
      const back = await Fix.restoreEle(await DB.get('tours', A.id));
      const r3 = await Z.importAll(acc, null, { ele: true }), d3 = calls.det.slice(); calls.det = [];
      const s3 = await get(A);
      /* Schalter aus: neue passende Tour bekommt nur den Puls */
      const F = (await Tours.add({ name: 'F Schalter aus', sport: 'hike', pts: flat(7), src: 'komoot', srcId: 'komoot:u7' })).tour; calls.n = 7;      // Training 7 taucht erst jetzt im Verlauf auf
      const r4 = await Z.importAll(acc, null, { ele: false }); const s4 = await get(F);
      const r5 = await Z.importAll(acc, null, {}); const s5 = await get(F);      // Vorgabe: an
      return { up0, r1, d1: d1.map(x => (x - base) / DAY), s1, r2, d2, back: [back.up, back.elevSrc || null, back.zele], r3, d3, s3, r4, s4, r5, s5, txt: Import.describe(r1), ids: { A: A.id } };
    }""")
    s1 = r["s1"]
    assert r["r1"]["added"] == 1 and r["r1"]["eleUhr"] == 2 and r["r1"]["hr"] == 5 and r["r1"]["fail"] == 0, r["r1"]      # Training 6 ist neu; A und E bekommen Höhen; alle fünf vorhandenen den Puls
    assert "Höhen bei 2 Touren von der Uhr übernommen" in r["txt"] and "Puls bei 5 Touren ergänzt" in r["txt"], r["txt"]
    assert sorted(r["d1"]) == [1, 2, 3, 4, 5, 6], r["d1"]
    A = s1["A"]; assert A["src"] == "zepp" and A["zele"] == 1 and A["orig"] and 200 < A["up"] < 250 and r["up0"] < 5 and A["hr"] and abs(A["origUp"] - r["up0"]) < 1e-6, (A, r["up0"])
    assert s1["B"]["src"] is None and s1["B"]["fix"] == 1 and not s1["B"]["orig"] and s1["B"]["up"] < 5 and s1["B"]["hr"], s1["B"]      # Geländemodell-Korrektur bleibt
    assert s1["C"]["src"] is None and not s1["C"]["orig"], s1["C"]
    assert s1["D"]["src"] is None and s1["D"]["zele"] == 1 and not s1["D"]["orig"] and s1["D"]["hr"], s1["D"]      # Uhr ohne brauchbare Höhen: vermerkt, nichts geändert
    E = s1["E"]; assert E["src"] == "zepp" and E["orig"] and E["max"] > 940 and E["up"] == 777 and E["dist"] == 4321 and E["zMt"] == 1, E      # Rangfolge: die Zahlen aus Meine Touren bleiben maßgeblich
    assert r["r2"]["eleUhr"] == 0 and r["r2"]["added"] == 0 and r["r2"]["hr"] == 0 and r["d2"] == [], (r["r2"], r["d2"])      # zweiter Lauf: nichts zu tun, nichts geladen
    assert abs(r["back"][0] - r["up0"]) < 1e-6 and r["back"][1] is None and r["back"][2] == 1 and r["r3"]["eleUhr"] == 0 and r["d3"] == [] and r["s3"]["src"] is None and not r["s3"]["orig"], (r["back"], r["r3"], r["s3"])
    assert r["r4"]["eleUhr"] == 0 and r["s4"]["src"] is None and r["s4"]["hr"] and r["s4"]["zele"] is None, (r["r4"], r["s4"])
    assert r["r5"]["eleUhr"] == 1 and r["s5"]["src"] == "zepp" and "Höhen bei 1 Tour von der Uhr übernommen" in pg.evaluate("r => Import.describe(r)", r["r5"]), (r["r5"], r["s5"])
    # Tourseite: Uhr-Höhen sind zurückholbar; Schalter im Zepp-Blatt (Vorgabe an) wird gemerkt und an den Import gegeben
    pg.evaluate("async id => { const t = await DB.get('tours', id), trk = await DB.get('tracks', id); await Fix.zeppEleWith(t, trk, { token: 'x' }, { trackid: String(1750000000 + 86400) }, { auto: true }); location.hash = '#/tour/' + id; }", r["ids"]["A"])
    pg.wait_for_selector("header.top button[aria-label=Aktionen]"); pg.click("header.top button[aria-label=Aktionen]"); pg.wait_for_selector("text=Originalhöhen wiederherstellen"); assert pg.get_by_text("Höhe aus Uhr (bereits abgeglichen)").count() == 1
    pg.evaluate("(sheet.stack || []).slice().forEach(x => x.close())"); pg.wait_for_selector(".sheet", state="detached")
    pg.evaluate("async () => { await DB.kvSet('zepp', { token: 'x', viaToken: true }); window.__zsums = []; location.hash = '#/import'; }"); pg.wait_for_selector("#imp-mt")
    pg.get_by_text("Zepp / Amazfit").click(); pg.wait_for_selector("#zp-ele"); assert pg.locator("#zp-ele input").is_checked() and "Originalhöhen wiederherstellen" in pg.inner_text(".sheet")
    pg.click("#zp-ele"); pg.wait_for_function("Set_.get('zeppEle') === false")
    seen = pg.evaluate("""async () => { const o = Import.Zepp.importAll; let got = null; Import.Zepp.importAll = async (acc, upd, opts) => { got = opts; return { added: 0, dup: 0, fail: 0 }; };
      document.querySelector('.sheet .btn.pri').click(); await new Promise(r => setTimeout(r, 400)); Import.Zepp.importAll = o; return got; }""")
    assert seen == {"ele": False}, seen
    pg.wait_for_selector(".sheet", state="detached")
    pg.evaluate("async (keep) => { Import.Zepp.req = window.__zreq0; delete window.__zsums; for (const t of await Tours.list()) if (!keep.includes(t.id)) await Tours.remove(t.id); await DB.del('kv', 'zepp'); await Set_.set('zeppEle', true); }", vorher)
    assert pg.evaluate("Tours.list().then(l => l.length)") == len(vorher)


DUP_DATEN = """async () => {
  /* Zwei Paare: dieselbe Tour aus Komoot (Name von Hand, Notiz, Pin) und von der Uhr (Puls, Fotos), Start 2 Minuten versetzt –
     und zwei Aufzeichnungen mit überlappender Zeitspanne, die der Mensch als „keine Doppelten“ markiert. */
  const base = Date.UTC(2026, 5, 20, 7), MIN = 60000;
  const line = (t0, n, lat, f, hr) => Array.from({ length: n }, (_, i) => Object.assign({ lat: lat + i * 0.0006 * f, lon: 11.4, ele: 900 + i * 6, t: t0 + i * MIN }, hr ? { hr: 110 + (i % 20) } : {}));
  const K = (await Tours.add({ name: 'Kramerspitz', sport: 'hike', pts: line(base, 90, 47.5, 1), src: 'komoot', srcId: 'komoot:d1', up: 640, down: 630, note: 'Schöne Runde' })).tour;
  K.pins = [{ id: 'pin1', ts: base + 30 * MIN, lat: 47.51, lon: 11.4, text: 'Gipfelkreuz' }]; K.nameKomoot = 'Kramerspitz'; await Tours.save(K);
  const Z = (await Tours.add({ sport: 'hike', pts: line(base + 2 * MIN, 88, 47.5, 1.03, true), src: 'zepp', srcId: 'zepp:d1' })).tour;
  await DB.putMany('photos', [1, 2].map(i => ({ id: 'dupfoto' + i, name: 'd' + i + '.jpg', ts: base + i * 10 * MIN, lat: null, lon: null, w: 10, h: 10, src: 'galerie', tour: Z.id, pos: 'none', note: '' })));
  const X = (await Tours.add({ name: 'Vormittag mit dem Rad', sport: 'bike', pts: line(base + 5 * 86400000, 60, 47.7, 2), src: 'rec' })).tour;
  const Y = (await Tours.add({ name: 'Begleitung zu Fuß', sport: 'hike', pts: line(base + 5 * 86400000 + 8 * MIN, 50, 47.7, 2.3), src: 'file' })).tour;
  return { K: K.id, Z: Z.id, X: X.id, Y: Y.id, zname: Z.name, kup: K.up }; }"""

def doppelte(pg):
    """2.1.0, Punkt 3: „Doppelte Touren prüfen“ – Paare finden, Vorschlag in Worten, „Andere behalten“, Zusammenführen mit Rückfrage (Fotos, Puls, Notiz, Pins,
    Zuordnungen wandern mit; ein späterer Import legt die gelöschte Tour nicht wieder an), „Keine Doppelten“ merken und wieder zeigen. Nie von selbst."""
    vorher = pg.evaluate("Tours.list().then(l => l.map(t => t.id))")
    pg.evaluate("location.hash = '#/doppelt'"); pg.wait_for_selector("text=Keine doppelten Touren gefunden"); assert "Jede Tour steht nur einmal" in pg.inner_text("#view")
    d = pg.evaluate(DUP_DATEN); n0 = pg.evaluate("Tours.list().then(l => l.length)"); assert n0 == len(vorher) + 4
    key = lambda a, b: "|".join(sorted([d[a], d[b]]))
    box = lambda a, b: f"section.dup[data-key='{key(a, b)}']"
    pg.evaluate("location.hash = '#/import'"); pg.wait_for_selector("#imp-dup"); pg.click("#imp-dup"); pg.wait_for_selector("#dup-n")
    assert pg.inner_text("#dup-n") == "2 mögliche Paare" and pg.locator("section.dup").count() == 2, pg.inner_text("#view")
    assert pg.evaluate("Tours.list().then(l => l.length)") == n0, "Ansehen ändert nichts"
    kz = pg.inner_text(box("K", "Z")); m = pg.locator(box("K", "Z") + " .dup-m").all_inner_texts()
    assert "Grund: gleiche Startzeit" in kz and "Grund: gleiche Zeitspanne" in pg.inner_text(box("X", "Y")), kz
    assert m[0] == "Bleibt · Quelle Zepp · Puls, 2 Fotos" and m[1] == "Wird gelöscht · Quelle Komoot · Notiz, von Hand benannt, 1 Pin", m      # Puls und Fotos (6) vor Notiz, Name, Pin (5)
    assert pg.locator(box("K", "Z") + " a.tour").count() == 2 and "Kramerspitz" in kz and d["zname"] in kz
    # „Andere behalten“ dreht den Vorschlag um; die Rückfrage nennt beide; Abbrechen ändert nichts
    pg.click(box("K", "Z") + " button[data-a=swap]"); m = pg.locator(box("K", "Z") + " .dup-m").all_inner_texts(); assert m[0].startswith("Bleibt · Quelle Komoot") and m[1].startswith("Wird gelöscht · Quelle Zepp"), m
    pg.click(box("K", "Z") + " button[data-a=merge]"); pg.wait_for_selector(".sheet[aria-label='Touren zusammenführen?']"); q = pg.inner_text(".sheet")
    assert "„Kramerspitz“ bleibt" in q and f"„{d['zname']}“ gelöscht" in q and "nicht rückgängig" in q, q
    pg.click(".sheet .btn:has-text('Abbrechen')"); pg.wait_for_selector(".sheet", state="detached"); assert pg.evaluate("Tours.list().then(l => l.length)") == n0
    # Zusammenführen: Fotos und Puls wandern zur bleibenden Tour, Kennung der gelöschten bleibt als alias
    pg.click(box("K", "Z") + " button[data-a=merge]"); pg.wait_for_selector(".sheet .btn.pri:has-text('Zusammenführen')"); pg.click(".sheet .btn.pri:has-text('Zusammenführen')")
    pg.wait_for_function("document.querySelector('#toast') && /Zusammengeführt/.test(document.querySelector('#toast').textContent)"); assert pg.inner_text("#toast") == "Zusammengeführt · 2 Fotos übernommen"
    pg.wait_for_function("document.querySelectorAll('section.dup').length === 1"); assert pg.inner_text("#dup-n") == "1 mögliches Paar"
    r = pg.evaluate("""async (d) => { const k = await DB.get('tours', d.K), z = await DB.get('tours', d.Z), ph = await DB.byIndex('photos', 'tour', d.K), trk = await DB.get('tracks', d.K);
      const again = await Tours.add({ sport: 'hike', src: 'zepp', srcId: 'zepp:d1', pts: [{ lat: 1, lon: 1, t: 1e12 }, { lat: 1.01, lon: 1, t: 1e12 + 60000 }] });
      return { k, z: z || null, ztrk: (await DB.get('tracks', d.Z)) || null, ph: ph.length, hr: (trk.hr || []).filter(Boolean).length, again: [again.dup, again.tour.id],
        match: (Import.Zepp.match({ trackid: 'd1' }, await Tours.list()) || {}).id, n: (await Tours.list()).length }; }""", d)
    k = r["k"]; assert r["z"] is None and r["ztrk"] is None and r["n"] == n0 - 1 and r["ph"] == 2 and r["hr"] > 50 and k["hrAvg"], r
    assert k["name"] == "Kramerspitz" and k["note"] == "Schöne Runde" and len(k["pins"]) == 1 and k["alias"] == ["zepp:d1"] and k["srcId"] == "komoot:d1" and k["upKomoot"] == 640 and abs(k["up"] - d["kup"]) < 1e-6, k
    assert r["again"] == [True, d["K"]] and r["match"] == d["K"], "ein späterer Zepp-Import erkennt die zusammengeführte Tour wieder"
    # „Keine Doppelten“: wird gemerkt und nicht wieder gezeigt; die Markierung lässt sich zurücknehmen; sie reist mit der Sicherung
    pg.click(box("X", "Y") + " button[data-a=keep]"); pg.wait_for_selector("text=Keine doppelten Touren gefunden"); assert "Ein Paar hast du als „keine Doppelten“ gemerkt." in pg.inner_text("#view")
    assert pg.evaluate("DB.kvGet('dupIgnore', [])") == [key("X", "Y")] and pg.evaluate("Tours.list().then(l => l.length)") == n0 - 1
    bk = pg.evaluate("Backup.collect().then(b => b.kv.find(k => k.k === 'dupIgnore'))"); assert bk and bk["v"] == [key("X", "Y")], bk
    assert pg.evaluate("async (bk) => { await DB.del('kv', 'dupIgnore'); await Backup.restoreKv([bk]); return DB.kvGet('dupIgnore', []); }", bk) == [key("X", "Y")]
    pg.click("#dup-reset"); pg.wait_for_selector(box("X", "Y")); assert pg.evaluate("DB.kvGet('dupIgnore', [])") == []
    pg.evaluate("async (keep) => { for (const t of await Tours.list()) if (!keep.includes(t.id)) await Tours.remove(t.id); for (const i of [1, 2]) await DB.del('photos', 'dupfoto' + i); await DB.del('kv', 'dupIgnore'); }", vorher)
    assert pg.evaluate("Tours.list().then(l => l.length)") == len(vorher)


def sheet_check(pg, label, opener):
    """Ein Blatt bei 360 px mit 100 % und 130 % Schrift prüfen. opener() öffnet es."""
    bad = []
    for fs in (100, 130):
        pg.set_viewport_size({"width": 360, "height": 800})
        pg.evaluate("fs => { let s = document.getElementById('fs-test'); if (!s) { s = document.createElement('style'); s.id = 'fs-test'; document.head.append(s); } s.textContent = fs === 100 ? '' : 'html{font-size:' + fs + '% !important}'; }", fs)
        opener(); pg.wait_for_selector(".sheet-back.on"); pg.wait_for_timeout(300)
        if pg.evaluate("(() => { const s = document.querySelector('.sheet'); return s.scrollWidth > s.clientWidth + 1 })()"): bad.append(f"{label}, {fs} %: Blatt rollt quer")
        bad += [f"{label}, {fs} %: " + m for m in pg.evaluate(LAYOUT_JS)]
        pg.evaluate("(sheet.stack || []).slice().forEach(x => x.close())"); pg.wait_for_selector(".sheet", state="detached")
    pg.evaluate("document.getElementById('fs-test').textContent = ''"); pg.set_viewport_size({"width": 390, "height": 800})
    return bad


def neue_layout(pg, ids):
    """Gestaltungsprüfung der neuen Abschnitte, Seiten und Blätter (Rückblick, Plan und Ergebnis, Planungshilfe, Fitness, Ziele, Startseite mit allen Bausteinen)."""
    tour = lambda k: "#/tour/" + ids[k]
    pg.evaluate("async () => { await Goals.save([{ id: 'lay1', period: 'year', year: new Date().getFullYear(), metric: 'km', target: 1200, sport: '' }, { id: 'lay2', period: 'week', year: 0, metric: 'count', target: 2, sport: 'grp:foot' }]); }")
    bad = layout_check(pg, ["#/stats/fitness", "#/stats/ziele", "#/stats/rekorde", tour("big"), tour("linked"), tour("plan"), "#/settings"])
    for sel, name in (("#fitness #fit-total", "Fitness"), ("#goals .ygoal", "Ziele")):      # die Seiten zeigen wirklich die neuen Inhalte
        pg.evaluate("h => { location.hash = h }", "#/stats/" + ("fitness" if name == "Fitness" else "ziele")); pg.wait_for_selector(sel)
    pg.evaluate("h => { location.hash = h }", tour("big")); pg.wait_for_selector("#rueckblick")
    pg.evaluate("h => { location.hash = h }", tour("linked")); pg.wait_for_selector("#planergebnis")
    pg.evaluate("h => { location.hash = h }", tour("plan")); pg.wait_for_selector("#passt-sec"); pg.wait_for_selector("#pn-links .li")
    # Startseite mit allem, was sich einschalten lässt, und fälligem Sicherungs-Hinweis
    pg.evaluate("async () => { await Set_.set('homeShow', { serie: true, fitness: true }); await DB.del('kv', 'lastBackup'); await DB.kvSet('backupSnooze', 0); }")
    pg.evaluate("location.hash = '#/start'"); pg.wait_for_selector("#backupnote"); pg.wait_for_selector("#serie"); pg.wait_for_selector("#fitness-home"); pg.wait_for_selector("#year .ygoal")
    bad += ["alle Bausteine: " + m for m in layout_check(pg, ["#/start"])]
    pg.evaluate("async () => { await Set_.set('homeShow', {}); await DB.kvSet('lastBackup', Date.now()); }")
    # Fitness ohne Geburtsjahr (Eingabe) und beim Ändern
    pg.evaluate("async () => { await Set_.set('birthYear', ''); }")
    bad += ["ohne Geburtsjahr: " + m for m in layout_check(pg, ["#/stats/fitness"], widths=((360, 100), (360, 130)))]
    pg.evaluate("async () => { await Set_.set('birthYear', 1975); }")
    # Blätter
    def go(h, sel): pg.evaluate("h => { if (location.hash === h) Nav.render(); else location.hash = h; }", h); pg.wait_for_selector(sel); pg.wait_for_timeout(250)
    bad += sheet_check(pg, "Link hinzufügen", lambda: (go(tour("plan"), "#pn-addlink"), pg.evaluate("document.querySelector('#pn-addlink').click()")))
    bad += sheet_check(pg, "Mit Plan vergleichen", lambda: (go(tour("big"), "#rueckblick"), pg.evaluate("DB.get('tours', location.hash.split('/')[2]).then(t => TourHelp.linkSheet(t))")))
    bad += sheet_check(pg, "Ziel", lambda: (go("#/stats/ziele", "#goaladd"), pg.evaluate("document.querySelector('#goaladd').click()")))
    bad += sheet_check(pg, "Aktionen (gelaufene Tour)", lambda: (go(tour("big"), "header.top button[aria-label=Aktionen]"), pg.click("header.top button[aria-label=Aktionen]")))
    pg.evaluate("async () => { await DB.del('kv', 'goals2'); }")
    return sorted(set(bad))


LEISE = "() => { const t = document.querySelector('#toast'); return !t || !t.classList.contains('on'); }"      # alte Meldung abwarten, sonst passt der Text der vorigen (Lehre aus 2.1.0)

def toast_text(pg, rx, t=20000):
    pg.wait_for_function("rx => { const t = document.querySelector('#toast'); return !!t && t.classList.contains('on') && new RegExp(rx).test(t.textContent); }", arg=rx, timeout=t)
    return pg.inner_text("#toast")

def zu(pg):
    pg.evaluate("(sheet.stack || []).slice().forEach(x => x.close())"); pg.wait_for_selector(".sheet", state="detached")

def go(pg, h, sel):
    pg.evaluate("h => { if (location.hash === h) Nav.render(); else location.hash = h; }", h); pg.wait_for_selector(sel); pg.wait_for_timeout(200)

WINTER_TOUREN = """async (srv) => {
  /* Touren, die es in der App schon gibt – alle mit der alten Sammel-Sportart „ski“ – und passend zu s4 (Ski alpin), s5 (Skitour), s6 (Schneeschuh), s7 (Langlauf) am Server;
     dazu die Skitour s5 noch einmal als von Hand gewählte Sportart (Langlauf) und eine Ski-Tour, die es am Server nicht gibt. */
  const by = Object.fromEntries(srv.map(t => [t.id, t]));
  const line = (t, n, dt, lat0) => Array.from({ length: n }, (_, i) => ({ lat: (lat0 || t.lat) + i * (t.dist_m / (n - 1)) / 111195, lon: t.lng, ele: 1500 + 200 * Math.sin(Math.PI * i / (n - 1)), t: t.start_ts * 1000 + (dt || 0) + i * 30000 }));
  const mk = async (id, name, sp, extra) => { const t = (await Tours.add({ name, sport: 'ski', pts: line(by[id], 40), src: 'file' })).tour; if (sp) { t.sportMan = 1; t.sport = sp; } Object.assign(t, extra || {}); await Tours.save(t); return t.id; };
  const o = { s4: await mk('s4', 'Pistentag'), s6: await mk('s6', 'Schneeschuhrunde'), s7: await mk('s7', 'Loipe am Morgen'), s5: await mk('s5', 'Auf den Gipfel', 'nordic') };
  o.frei = (await Tours.add({ name: 'Nur in der App', sport: 'ski', pts: line({ lat: 46.5, lng: 10.5, dist_m: 2000, start_ts: 1760000000 }, 30), src: 'file' })).tour.id;
  return o; }"""

def winter(pg):
    """2.2.0, Punkt A: Wintersportarten getrennt, Schneeschuh zählt als Wandern. Dateien, Abgleich mit Meine Touren (auch für Touren mit der alten Sportart „ski“,
    nie bei von Hand gewählter Sportart), Schlagwort „Schneeschuh“ nur einmal, Zählung nach dem Update, Oberfläche (Sportart ändern, Chips, Statistik, Ziele, Planer, Aufzeichnung)."""
    fx = mt_fixture(); srv = json.loads(fx["antworten"]["tours"]["body"])
    vorher = pg.evaluate("Tours.list().then(l => l.map(t => t.id))")
    # 1. Dateien: GPX-Typ → Sportart, „Schneeschuh“ als Schlagwort
    r = pg.evaluate("""async () => { const out = {};
      const gx = (ty, k) => '<?xml version="1.0"?><gpx version="1.1"><trk><name>W ' + ty + '</name><type>' + ty + '</type><trkseg>' + Array.from({ length: 30 }, (_, i) => '<trkpt lat="' + (46.1 + k * 0.01 + i * 0.0005) + '" lon="10.1"><ele>' + (1800 + i * 4) + '</ele><time>' + new Date(Date.UTC(2025, 0, 10 + k, 9, 0, i * 30)).toISOString() + '</time></trkpt>').join('') + '</trkseg></trk></gpx>';
      const types = ['snowshoe', 'skitour', 'skialpin', 'nordic', 'skiing', 'Snowshoe'];
      for (let k = 0; k < types.length; k++) { const x = await Import.fromData('w' + k + '.gpx', new TextEncoder().encode(gx(types[k], k)), 'file'); out[types[k] + k] = x.added; }
      const l = await Tours.list(); return { out, t: l.filter(t => /^W /.test(t.name)).map(t => [t.name, t.sport, t.tags || []]) }; }""")
    got = {n.split()[1]: [sp, tg] for n, sp, tg in r["t"]}
    assert r["out"] == {"snowshoe0": 1, "skitour1": 1, "skialpin2": 1, "nordic3": 1, "skiing4": 1, "Snowshoe5": 1}, r
    assert got["snowshoe"] == ["hike", ["Schneeschuh"]] and got["skitour"] == ["skitour", []] and got["skialpin"] == ["skialpin", []] and got["nordic"] == ["nordic", []] and got["skiing"] == ["ski", []] and got["Snowshoe"] == ["hike", ["Schneeschuh"]], got
    # 2. Abgleich mit Meine Touren: alte „ski“-Touren bekommen ihre Art, Schneeschuh wird Wandern + Schlagwort, Handwahl bleibt
    pg.evaluate("(fx) => { window.__mtFx = fx; }", fx); pg.evaluate(MT_FAKE, fx)
    o = pg.evaluate(WINTER_TOUREN, srv)
    assert pg.evaluate("async o => (await Promise.all(Object.values(o).map(id => DB.get('tours', id)))).filter(t => t.sport === 'ski').length", o) == 4      # s4, s6, s7 und „nur in der App“ (s5 ist von Hand Langlauf)
    # Zählung nach dem Update: einmalig, mit Hinweis auf der Startseite
    pg.evaluate("async () => { await DB.kvSet('skiVer', 0); await DB.kvSet('calcNote', null); }")
    m = pg.evaluate("Tours.migrate().then(r => r && r.ski)"); assert m >= 4, m
    assert pg.evaluate("DB.kvGet('calcNote').then(n => n.ski)") == m and pg.evaluate("Tours.migrate().then(r => r && r.ski || 0)") == 0 and pg.evaluate("DB.kvGet('skiVer')") == 1, "gezählt wird einmal"
    go(pg, "#/start", "#calcnote"); tx = pg.inner_text("#calcnote")
    assert "Ski (allgemein)" in tx and "Meine Touren" in tx and "Schneeschuh" in tx and str(m) in tx, tx
    pg.click("#calc-ok"); pg.wait_for_selector("#calcnote", state="detached")
    pg.evaluate("""async () => { await DB.kvSet('mt', { base: 'https://mt.test', name: 'Tagebuch', role: 'viewer', token: 'SITZUNG-BETRACHTER-BEISPIEL' }); window.__mt.sessions.add('SITZUNG-BETRACHTER-BEISPIEL'); }""")
    pg.evaluate("window.__mt.log = []")
    res = pg.evaluate("async () => Import.MT.importAll(await DB.kvGet('mt'), { zahlen: true }, null)")
    st = pg.evaluate("""async (o) => { const out = {}; for (const [k, id] of Object.entries(o)) { const t = await DB.get('tours', id); out[k] = { sport: t.sport, alt: t.sportAlt, man: t.sportMan, tags: t.tags || [], mt: t.sportMt, name: t.name }; } return out; }""", o)
    assert st["s4"] == {"sport": "skialpin", "alt": "ski", "man": None, "tags": [], "mt": "skialpin", "name": st["s4"]["name"]}, st["s4"]
    assert st["s7"]["sport"] == "nordic" and st["s7"]["mt"] == "nordic", st["s7"]
    assert st["s6"]["sport"] == "hike" and st["s6"]["tags"] == ["Schneeschuh"] and st["s6"]["mt"] == "snowshoe" and st["s6"]["alt"] == "ski", st["s6"]
    assert st["s5"]["sport"] == "nordic" and st["s5"]["man"] == 1 and st["s5"]["mt"] == "skitour", "von Hand gewählte Sportart wird nie überschrieben: " + json.dumps(st["s5"])
    assert st["frei"]["sport"] == "ski" and st["frei"]["mt"] is None, "Tour nur in der App bleibt „Ski (allgemein)“"
    # neue Touren vom Server: richtige Arten (s0–s10 kommen als neue Touren, soweit nicht oben zugeordnet)
    neu = pg.evaluate("""async () => { const o = {}; for (const t of await Tours.list()) { const m = /^mt:(s\\d+)$/.exec(t.srcId || ''); if (m) o[m[1]] = [t.sport, t.tags || [], t.sportMt]; } return o; }""")
    assert neu["s8"][0] == "hike" and neu["s3"][0] == "run" and neu["s9"][0] == "mountaineering" and neu["s10"][0] == "other", neu
    assert "s4" not in neu and "s6" not in neu and "s7" not in neu, "zugeordnete Touren werden nicht noch einmal angelegt"
    # Schlagwort nur einmal: in der App entfernt → der nächste Abgleich bringt es nicht zurück; neuer Schneeschuh-Eintrag am Server bekommt es
    pg.evaluate("async id => { const t = await DB.get('tours', id); t.tags = []; await Tours.save(t); }", o["s6"])
    pg.evaluate("async () => Import.MT.importAll(await DB.kvGet('mt'), { zahlen: true }, null)")
    assert pg.evaluate("id => DB.get('tours', id).then(t => t.tags)", o["s6"]) == [], "entferntes Schlagwort kommt nicht wieder"
    pg.evaluate("async () => { for (const t of await Tours.list()) if (t.srcId === 'mt:s8') await Tours.remove(t.id); window.__mt.edit = l => l.map(t => t.id === 's8' ? Object.assign({}, t, { sport: 'snowshoe' }) : t); }")
    pg.evaluate("async () => Import.MT.importAll(await DB.kvGet('mt'), { zahlen: true }, null)")
    ns = pg.evaluate("Tours.list().then(l => l.find(t => t.srcId === 'mt:s8'))"); assert ns["sport"] == "hike" and ns["tags"] == ["Schneeschuh"] and ns["sportMt"] == "snowshoe", ns      # neue Tour vom Server
    pg.evaluate("window.__mt.edit = null")
    # Filter über das Schlagwort (Album) und die Tourseite zeigt Wandern + Schlagwort
    pg.evaluate("id => { location.hash = '#/tour/' + id }", ns["id"]); pg.wait_for_selector(".tourp")
    assert "Wandern" in pg.inner_text(".tourp .sub") and pg.locator(".tourp a.chip", has_text="Schneeschuh").count() == 1
    # 3. Oberfläche: Sportart ändern (alle Arten, Handwahl), Tourenliste mit Chips, Statistik-Filter, Ziele, Planer, Aufzeichnung
    pg.evaluate("id => { location.hash = '#/tour/' + id }", o["s4"]); pg.wait_for_selector(".tourp"); pg.evaluate("document.querySelectorAll('.sheet-back').forEach(e => e.remove())")
    pg.locator("header.top button[aria-label=Aktionen]").click(); pg.get_by_text("Sportart ändern").click(); pg.wait_for_selector(".sheet[aria-label='Sportart'] .li")
    names = pg.locator(".sheet[aria-label='Sportart'] .li .li-t b").all_inner_texts()
    for want in ("Ski alpin", "Skitour", "Langlauf", "Ski (allgemein)", "Wandern"): assert want in names, names
    pg.locator(".sheet .li", has_text="Skitour").click(); pg.wait_for_selector(".sheet", state="detached"); pg.wait_for_function("() => document.querySelector('.tourp .sub') && /Skitour/.test(document.querySelector('.tourp .sub').textContent)")
    t4 = pg.evaluate("id => DB.get('tours', id)", o["s4"]); assert t4["sport"] == "skitour" and t4["sportMan"] == 1, t4
    pg.evaluate("async () => Import.MT.importAll(await DB.kvGet('mt'), { zahlen: true }, null)"); assert pg.evaluate("id => DB.get('tours', id).then(t => t.sport)", o["s4"]) == "skitour", "Abgleich überschreibt die Handwahl nicht"
    pg.evaluate("location.hash = '#/'"); pg.wait_for_selector("a.tour"); pg.evaluate("TourUI.filter.sport = ''; Nav.render()"); pg.wait_for_selector(".chips .chip:has-text('Skitour')")
    chips = pg.locator(".filters .chips .chip").all_inner_texts()
    for want in ("Skitour", "Langlauf", "Ski (allgemein)", "Wandern"): assert any(want in c for c in chips), chips
    pg.click(".filters .chips .chip:has-text('Skitour')"); assert pg.locator("a.tour").count() == pg.evaluate("Tours.list().then(l => l.filter(t => t.sport === 'skitour' && t.status !== 'planned' && !t.hidden).length)")
    assert "Skitour" in pg.inner_text("a.tour .tb small"); pg.click(".filters .chips .chip:has-text('Alle')")
    pg.evaluate("location.hash = '#/stats'"); pg.wait_for_selector(".kpis"); pg.select_option("select[aria-label=Zeitraum]", "all"); pg.select_option("select[aria-label=Sportart]", "grp:ski"); pg.wait_for_timeout(300)
    nski = pg.evaluate("Tours.list().then(l => l.filter(t => Sports.SKI.includes(t.sport) && t.status !== 'planned' && !t.hidden).length)")
    assert pg.locator(".kpis .kpi").first.inner_text().split("\n")[0].strip() == str(nski) and nski >= 6, (pg.inner_text(".kpis"), nski)
    pg.evaluate("location.hash = '#/stats/ziele'"); pg.wait_for_selector("#goaladd"); pg.click("#goaladd"); pg.wait_for_selector("#goalsport")
    opts = pg.locator("#goalsport option").all_inner_texts(); assert "Ski (alle Arten)" in opts and "Skitour" in opts and "Langlauf" in opts and "Ski alpin" in opts and "Ski (allgemein)" not in opts, opts
    zu(pg)
    pg.evaluate("location.hash = '#/plan'"); pg.wait_for_selector(".ppanel select"); po = pg.locator(".ppanel select option").all_inner_texts()
    assert "Skitour" in po and "Langlauf" in po and "Ski (allgemein)" not in po and "Wandern" in po, po
    assert pg.evaluate("[Router.profileFor('skitour'), Router.profileFor('nordic'), Router.profileFor('skialpin'), Router.profileFor('ski'), Router.profileFor('hike')]") == ["hiking-mountain"] * 4 + ["hiking-mountain"]
    pg.evaluate("location.hash = '#/rec'"); pg.wait_for_selector(".bigstart"); rc = pg.locator(".chips .chip").all_inner_texts()
    assert any("Skitour" in c for c in rc) and any("Langlauf" in c for c in rc) and any("Ski alpin" in c for c in rc) and not any("allgemein" in c for c in rc), rc
    # Symbole und Farben für alle Arten (kein leeres Symbol, jede Skiart eine eigene Kartenfarbe)
    ic = pg.evaluate("() => Sports.list.map(s => [s[0], Ico.svg(s[2]).length > 50, /^#[0-9a-f]{6}$/i.test(MapKit.sportColor[s[0]] || '')])")
    assert all(a and b for _, a, b in ic), ic
    assert len({pg.evaluate("k => MapKit.sportColor[k]", k) for k in ("ski", "skialpin", "skitour", "nordic", "hike", "bike", "ebike", "run", "racebike", "mtb")}) == 10, "Farben unterscheidbar"
    assert pg.evaluate("Suggest.sportName.skitour") == "Skitour" and pg.evaluate("Suggest.sportName.nordic") == "Langlauftour"
    # Sicherung: alte Sportart „ski“ und die neuen gehen verlustfrei hin und zurück
    bk = pg.evaluate("async () => { const b = await Backup.collect(); const z = fflate.gunzipSync(fflate.gzipSync(new TextEncoder().encode(JSON.stringify(b)))); const d = Backup.parse(fflate.gzipSync(z)); return { sp: d.tours.map(t => t.sport), tg: d.tours.filter(t => (t.tags || []).includes('Schneeschuh')).length, sk: d.kv.map(k => k.k) }; }")
    assert {"ski", "skialpin", "skitour", "nordic", "hike"} <= set(bk["sp"]) and bk["tg"] >= 3 and "skiVer" not in bk["sk"] and "abgleich" not in bk["sk"] and "mt" not in bk["sk"], bk
    # Aufräumen
    pg.evaluate("async (keep) => { for (const t of await Tours.list()) if (!keep.includes(t.id)) await Tours.remove(t.id); await DB.del('kv', 'mt'); window.__mt.edit = null; Native.http = window.__mtReal; TourUI.filter.sport = ''; }", vorher)
    assert pg.evaluate("Tours.list().then(l => l.length)") == len(vorher)


def sterne(pg):
    """2.2.0, Punkt B: eigene Bewertung. Antippen, nochmal = entfernen, Liste, Filter, Abgleich mit Meine Touren (zieht nach, bis man von Hand ändert), Sicherung."""
    fx = mt_fixture(); srv = json.loads(fx["antworten"]["tours"]["body"])
    vorher = pg.evaluate("Tours.list().then(l => l.map(t => t.id))")
    pg.evaluate(MT_FAKE, fx); pg.evaluate("async () => { await DB.kvSet('mt', { base: 'https://mt.test', name: 'Tagebuch', role: 'viewer', token: 'SITZUNG-BETRACHTER-BEISPIEL' }); window.__mt.sessions.add('SITZUNG-BETRACHTER-BEISPIEL'); }")
    ids = pg.evaluate("""async (srv) => { const g1 = srv.find(t => t.id === 'g1'), g4 = srv.find(t => t.id === 'g4');
      const line = (t, n) => Array.from({ length: n }, (_, i) => ({ lat: t.lat + i * (t.dist_m / (n - 1)) / 111195, lon: t.lng, ele: 700 + 50 * Math.sin(i / 5), t: t.start_ts * 1000 + i * 30000 }));
      const a = (await Tours.add({ name: 'Eigene Wanderung', sport: 'hike', pts: line(g1, 60), src: 'file' })).tour, b = (await Tours.add({ name: 'Radrunde ohne Stern', sport: 'bike', pts: line(g4, 40), src: 'file' })).tour;
      return { a: a.id, b: b.id }; }""", srv)
    # Tourseite: keine Bewertung, fünf Sterne, Tippfläche mindestens 44 px, Beschriftung
    pg.evaluate("id => { location.hash = '#/tour/' + id }", ids["b"]); pg.wait_for_selector("#rate .star")
    assert pg.locator("#rate .star").count() == 5 and "Noch nicht bewertet" in pg.inner_text("#ratecap") and pg.locator("#rate .star.on").count() == 0
    assert pg.get_attribute("#rate", "role") == "radiogroup" and pg.get_attribute("#rate", "aria-label") == "Deine Bewertung" and pg.get_attribute("#rate .star >> nth=0", "aria-label") == "1 Stern" and pg.get_attribute("#rate .star >> nth=4", "aria-label") == "5 Sterne"
    for k in range(5):
        bb = pg.locator("#rate .star").nth(k).bounding_box(); assert bb["width"] >= 44 and bb["height"] >= 44, bb
    pg.click("#rate .star >> nth=3"); pg.wait_for_function("document.querySelectorAll('#rate .star.on').length === 4")
    assert "4 von 5" in pg.inner_text("#ratecap") and "Meine Touren" not in pg.inner_text("#ratecap") and pg.get_attribute("#rate .star >> nth=3", "aria-checked") == "true" and pg.get_attribute("#rate .star >> nth=1", "aria-checked") == "false"
    t = pg.evaluate("id => DB.get('tours', id)", ids["b"]); assert t["stars"] == 4 and t["starsMan"] == 1, t
    # Farbe: Tinte, nicht Gelb (Gelb gehört der Hauptaktion)
    col = pg.evaluate("[getComputedStyle(document.querySelector('#rate .star.on')).color, getComputedStyle(document.querySelector('#rate .star:not(.on)')).color, getComputedStyle(document.documentElement).getPropertyValue('--ink').trim(), getComputedStyle(document.documentElement).getPropertyValue('--yellow').trim()]")
    assert col[0] != col[1] and "242, 194, 48" not in col[0] + col[1], col
    pg.click("#rate .star >> nth=1"); pg.wait_for_function("document.querySelectorAll('#rate .star.on').length === 2"); assert "2 von 5" in pg.inner_text("#ratecap")
    pg.click("#rate .star >> nth=1"); pg.wait_for_function("document.querySelectorAll('#rate .star.on').length === 0")      # derselbe Stern nochmal: weg
    t = pg.evaluate("id => DB.get('tours', id)", ids["b"]); assert "stars" not in t and t["starsMan"] == 1 and "Noch nicht bewertet" in pg.inner_text("#ratecap"), t
    pg.click("#rate .star >> nth=4"); pg.wait_for_function("document.querySelectorAll('#rate .star.on').length === 5")
    pg.keyboard.press("Tab")      # Tastatur: Sterne sind Knöpfe
    pg.evaluate("id => { location.hash = '#/' }", ids["b"]); pg.wait_for_selector("a.tour")
    row = pg.locator("a.tour", has_text="Radrunde ohne Stern"); assert "★ 5" in row.locator("small").first.inner_text(), row.inner_text()
    assert "★" not in pg.locator("a.tour", has_text="Eigene Wanderung").locator("small").first.inner_text()
    # Abgleich: Sterne vom Server (g1 hat 5) kommen an die zugeordnete Tour; von Hand geänderte nicht
    r = pg.evaluate("async () => Import.MT.importAll(await DB.kvGet('mt'), { zahlen: true }, null)")
    a = pg.evaluate("id => DB.get('tours', id)", ids["a"]); assert a["mtId"] == "g1" and a["stars"] == 5 and a["starsMt"] == 5 and not a.get("starsMan"), a
    pg.evaluate("id => { location.hash = '#/tour/' + id }", ids["a"]); pg.wait_for_selector("#rate .star"); assert pg.locator("#rate .star.on").count() == 5 and "5 von 5 · aus Meine Touren" in pg.inner_text("#ratecap")
    assert "Sternen" not in pg.inner_text(".tourp"), "keine Doppelanzeige"
    pg.evaluate("() => { window.__mt.edit = l => l.map(t => t.id === 'g1' ? Object.assign({}, t, { stars: 3 }) : t); }")
    pg.evaluate("async () => Import.MT.importAll(await DB.kvGet('mt'), { zahlen: true }, null)")
    a = pg.evaluate("id => DB.get('tours', id)", ids["a"]); assert a["stars"] == 3 and a["starsMt"] == 3, ("Server ändert: zieht nach", a)
    pg.evaluate("location.hash = '#/'"); pg.evaluate("id => { location.hash = '#/tour/' + id }", ids["a"]); pg.wait_for_selector("#rate .star"); pg.click("#rate .star >> nth=1")
    pg.wait_for_function("document.querySelectorAll('#rate .star.on').length === 2")
    pg.evaluate("() => { window.__mt.edit = l => l.map(t => t.id === 'g1' ? Object.assign({}, t, { stars: 4 }) : t); }")
    pg.evaluate("async () => Import.MT.importAll(await DB.kvGet('mt'), { zahlen: true }, null)")
    a = pg.evaluate("id => DB.get('tours', id)", ids["a"]); assert a["stars"] == 2 and a["starsMan"] == 1 and a["starsMt"] == 4, ("Handbewertung bleibt", a)
    pg.evaluate("() => { window.__mt.edit = l => l.map(t => t.id === 'g1' ? Object.assign({}, t, { stars: null }) : t); }")
    pg.evaluate("async () => Import.MT.importAll(await DB.kvGet('mt'), { zahlen: true }, null)")
    a = pg.evaluate("id => DB.get('tours', id)", ids["a"]); assert a["stars"] == 2 and "starsMt" not in a, a
    pg.evaluate("window.__mt.edit = null")
    # Bestand aus 2.1.0: nur starsMt gespeichert (ohne stars) → wird angezeigt, Handtipp ersetzt
    pg.evaluate("async id => { const t = await DB.get('tours', id); delete t.stars; delete t.starsMan; t.starsMt = 4; await Tours.save(t); }", ids["a"])
    pg.evaluate("Nav.render()"); pg.wait_for_selector("#rate .star"); assert pg.locator("#rate .star.on").count() == 4 and "aus Meine Touren" in pg.inner_text("#ratecap")
    # Filter „Bewertung“ im Filterblatt (ab 4 Sternen), Zähler am Knopf, Zurücksetzen
    pg.evaluate("location.hash = '#/'"); pg.wait_for_selector("#filterbtn"); pg.click("#filterbtn"); pg.wait_for_selector("#filterstars")
    assert pg.locator("#filterstars option").all_inner_texts() == ["Alle", "ab 3 Sternen", "ab 4 Sternen", "5 Sterne"]
    pg.select_option("#filterstars", "4"); pg.wait_for_function("() => document.querySelectorAll('a.tour').length === 2")      # Eigene Wanderung (4, nur starsMt) und Radrunde (5)
    assert "Filter, 1 gesetzt" == pg.get_attribute("#filterbtn", "aria-label")
    pg.select_option("#filterstars", "5"); pg.wait_for_function("() => document.querySelectorAll('a.tour').length === 1"); assert "Radrunde" in pg.inner_text("a.tour")
    pg.click(".sheet .btn:has-text('Zurücksetzen')"); pg.wait_for_function("() => document.querySelectorAll('a.tour').length > 2"); assert pg.input_value("#filterstars") == ""; pg.click("#filterok"); pg.wait_for_selector(".sheet", state="detached")
    # Sicherung enthält Bewertung und Merker; Einspielen bringt sie zurück
    bk = pg.evaluate("async id => { const b = await Backup.collect(); const t = b.tours.find(t => t.id === id); return [t.stars, t.starsMan]; }", ids["b"]); assert bk == [5, 1], bk
    pg.evaluate("async (keep) => { for (const t of await Tours.list()) if (!keep.includes(t.id)) await Tours.remove(t.id); await DB.del('kv', 'mt'); Native.http = window.__mtReal; }", vorher)


ALLES_STUBS = """() => { const S = window.__al = { calls: [], gate: null, mode: {} }, real = { z: Import.Zepp.importAll, k: Import.Komoot.importAll, m: Import.MT.importAll };
  window.__alReal = real;
  const wait = async (o, ms) => { for (let i = 0; i < ms / 20 && !(o.stop && o.stop()); i++) await new Promise(r => setTimeout(r, 20)); };
  const mk = (id, res) => async (...a) => {
    const opts = id === 'zepp' ? a[2] : a[1], upd = id === 'zepp' ? a[1] : a[2];
    S.calls.push([id, Object.assign({}, opts, { stop: undefined })]);
    const m = S.mode[id] || {};
    if (upd) upd(1, 2, 'Anfang'); 
    if (m.gate) { await m.gate; }
    if (m.slow) await wait(opts, 20000);
    if (m.err) throw Object.assign(new Error(m.err.message), m.err);
    if (opts.stop && opts.stop()) return Object.assign({}, res, { stopped: true });
    return Object.assign({ added: 0, dup: 5, fail: 0 }, res);
  };
  Import.Zepp.importAll = mk('zepp', { added: 1, hr: 2 }); Import.Komoot.importAll = mk('komoot', { added: 2, names: 1 }); Import.MT.importAll = mk('mt', { added: 0, namesMt: 3, zahlen: 4 }); }"""

def senden(pg):
    """2.5.0, Funktion 1: Tour an Meine Touren senden. Konto „nur ansehen“ → Erklärung statt stillem Scheitern; Rückfrage; Hochladen mit Sportart; Notiz und Sterne nur bei neu angelegter Tour;
    erneutes Senden → „war schon vorhanden“ (nichts doppelt); gemerkte Kennung → „Aus Meine Touren holen“ legt nichts doppelt an; Auswahl; unverschlüsselte Adresse; automatisch senden
    (Vorgabe aus, Warteschlange und erneuter Versuch). Der Server ist nachgestellt (MT_FAKE); gegen den echten Server prüft tests/check_meine_touren.py."""
    fx = mt_fixture(); srv = json.loads(fx["antworten"]["tours"]["body"])
    vorher = pg.evaluate("Tours.list().then(l => l.map(t => t.id))")
    pg.evaluate(MT_FAKE, fx)
    toast = lambda rx, t=20000: (pg.wait_for_function("rx => { const t = document.querySelector('#toast'); return !!t && t.classList.contains('on') && new RegExp(rx).test(t.textContent); }", arg=rx, timeout=t), pg.inner_text("#toast"))[1]
    leise = lambda: pg.wait_for_function("() => { const t = document.querySelector('#toast'); return !t || !t.classList.contains('on'); }", timeout=30000)
    zu = lambda: (pg.evaluate("(sheet.stack || []).slice().forEach(x => x.close())"), pg.wait_for_function("() => !document.querySelector('.sheet-back')"))
    posts = lambda: pg.evaluate("window.__mt.log.filter(x => x.startsWith('POST '))")
    konto = lambda rolle, tok: pg.evaluate("async ([r, k]) => { await DB.kvSet('mt', { base: 'https://mt.test', name: 'Tagebuch', role: r, token: k, since: Date.now() }); window.__mt.sessions.add(k); window.__mt.log.length = 0; }", [rolle, tok])
    ids = pg.evaluate("""async () => {
      const T0 = Date.UTC(2027, 0, 10, 8, 0), line = (t0, n) => Array.from({ length: n }, (_, i) => ({ lat: 47.5 + i * 0.0004, lon: 11.2, ele: 800 + 40 * Math.sin(i / 4), t: t0 + i * 30000 }));
      const mk = async (name, sport, t0, extra) => { const t = (await Tours.add({ name, sport, pts: line(t0, 40), src: 'file' })).tour; Object.assign(t, extra || {}); await Tours.save(t); return t.id; };
      return { a: await mk('Sendetour Hüttenrunde', 'hike', T0, { note: 'Schöner Tag, Quellwasser am Wegkreuz.', stars: 4 }), b: await mk('Sendetour Radrunde', 'bike', T0 + 86400000),
        c: await mk('Sendetour Lauf', 'run', T0 + 2 * 86400000), d: await mk('Sendetour Abend', 'other', T0 + 3 * 86400000), p: await mk('Sendetour geplant', 'hike', T0 + 4 * 86400000, { status: 'planned' }) }; }""")
    tour = lambda i: pg.evaluate("id => DB.get('tours', id)", ids[i])
    menue = lambda i: (pg.evaluate("id => { location.hash = '#/tour/' + id; return Nav.render(); }", ids[i]), pg.wait_for_selector(".tourp h1"), pg.click("button[aria-label=Aktionen]"), pg.wait_for_selector(".sheet .menu"))
    try:
        # 1. Ohne Verbindung: kein Eintrag. Konto „nur ansehen“: Eintrag da, Tippen erklärt (nichts geht ins Netz).
        pg.evaluate("DB.del('kv', 'mt')"); menue("a"); assert pg.locator("#mt-senden-tour").count() == 0, "ohne Verbindung kein Eintrag"; zu()
        konto("viewer", "SITZUNG-BETRACHTER-BEISPIEL"); menue("a"); assert pg.locator("#mt-senden-tour").count() == 1
        pg.click("#mt-senden-tour"); pg.wait_for_selector("#send-grund")
        assert "Schreibrechten" in pg.inner_text("#send-grund") and pg.locator("#send-ja").count() == 0 and posts() == [], pg.inner_text("#send-grund")
        pg.click("#send-ok"); zu()
        # geplante Tour: kein Eintrag
        konto("user", "SITZUNG-SCHREIBER-BEISPIEL"); menue("p"); assert pg.locator("#mt-senden-tour").count() == 0, "geplante Tour wird nicht angeboten"; zu()
        # 2. Schreibkonto: Rückfrage mit Name und Server; „Abbrechen“ sendet nichts
        menue("a"); pg.click("#mt-senden-tour"); pg.wait_for_selector("#send-ja")
        assert "Sendetour Hüttenrunde" in pg.inner_text("#send-name") and "mt.test" in pg.inner_text("#send-frage") and "Fotos nicht" in pg.inner_text("#send-frage")
        pg.click("#send-nein"); zu(); assert posts() == [] and "mtId" not in tour("a")
        # 3. Senden: Hochladen mit Sportart und Name, danach Notiz und Sterne; Kennung gemerkt
        menue("a"); pg.click("#mt-senden-tour"); pg.wait_for_selector("#send-ja"); pg.click("#send-ja")
        assert "wurde an Meine Touren gesendet" in toast("gesendet|schon in Meine Touren")
        up = pg.evaluate("window.__mt.up"); assert len(up) == 1 and up[0]["name"] == "Sendetour Hüttenrunde" and up[0]["sport"] == "hike" and "<trkpt" in up[0]["gpx"] and "<time>" in up[0]["gpx"], up
        t = tour("a"); gid = "g" + str(int(__import__("datetime").datetime(2027, 1, 10, 8, 0, tzinfo=__import__("datetime").timezone.utc).timestamp()))
        assert t["mtId"] == gid and t["mtSent"] > 0, t
        assert posts() == ["POST /api/record/upload", "POST /api/tours/%s/note" % gid, "POST /api/tours/%s/rating" % gid], posts()
        assert pg.evaluate("window.__mt.notes") == {gid: "Schöner Tag, Quellwasser am Wegkreuz."} and pg.evaluate("window.__mt.stars") == {gid: 4}
        pg.wait_for_selector("#mtsent"); assert "gesendet am" in pg.inner_text("#mtsent")
        pg.click("button[aria-label=Aktionen]"); pg.wait_for_selector(".sheet .menu"); assert pg.locator("#mt-senden-tour").count() == 0, "nach dem Senden kein zweiter Eintrag"; zu()
        # 4. Kennung verloren (z. B. aus alter Sicherung): erneutes Senden erkennt die Tour am Server – nichts doppelt
        pg.evaluate("async id => { const t = await DB.get('tours', id); delete t.mtId; delete t.mtSent; await Tours.save(t); }", ids["a"]); leise()
        pg.evaluate("window.__mt.log.length = 0"); menue("a"); pg.click("#mt-senden-tour"); pg.wait_for_selector("#send-ja"); pg.click("#send-ja")
        assert "schon in Meine Touren" in toast("schon in Meine Touren|wurde an Meine Touren gesendet") and posts() == [], posts()
        assert len(pg.evaluate("window.__mt.up")) == 1 and tour("a")["mtId"] == gid
        # 5. „Aus Meine Touren holen“: die gesendete Tour wird erkannt, nichts doppelt
        pg.evaluate("window.__mt.log.length = 0")
        n0 = pg.evaluate("Tours.list().then(l => l.filter(t => t.name.startsWith('Sendetour')).length)")
        pg.evaluate("async () => { const acc = await DB.kvGet('mt', null); window.__imp = await Import.MT.importAll(acc, { zahlen: false }, () => {}); Tours.invalidate(); }")
        l = pg.evaluate("Tours.list().then(l => l.map(t => ({ id: t.id, name: t.name, mtId: t.mtId, srcId: t.srcId })))")
        assert sum(1 for t in l if t["mtId"] == gid or t["srcId"] == "mt:" + gid) == 1, [t for t in l if t["mtId"] == gid or t["srcId"] == "mt:" + gid]
        assert sum(1 for t in l if t["name"] == "Sendetour Hüttenrunde") == 1 and not any("/api/tours/%s/gpx" % gid in x for x in pg.evaluate("window.__mt.log")), "die Tour wird nicht noch einmal geholt"
        # 6. Auswahl unter „Meine Touren“: nur noch nicht gesendete; nichts vorgewählt
        pg.evaluate("location.hash = '#/import'"); pg.wait_for_selector("#imp-mt"); pg.click("#imp-mt"); pg.wait_for_selector("#mt-senden")
        assert pg.locator("#mt-auto").count() == 1 and pg.locator("#mt-viewer").count() == 0
        pg.click("#mt-senden"); pg.wait_for_selector("#send-liste .send-row")
        assert pg.locator("#send-liste .send-row[data-id='%s']" % ids["a"]).count() == 0, "Gesendetes erscheint nicht"
        assert pg.locator("#send-liste .send-row[data-id='%s']" % ids["p"]).count() == 0 and pg.locator("#send-liste .send-row[data-id='%s']" % ids["b"]).count() == 1
        assert pg.locator("#send-los").is_disabled() and "0 von" in pg.inner_text("#send-zahl")
        pg.locator("#send-liste .send-row[data-id='%s'] input" % ids["b"]).check(); assert pg.locator("#send-los").is_enabled() and "1 Tour senden" in pg.inner_text("#send-los")
        pg.click("#send-keine"); assert pg.locator("#send-los").is_disabled(); pg.locator("#send-liste .send-row[data-id='%s'] input" % ids["b"]).check()
        pg.click("#send-los"); pg.wait_for_selector("#send-ja"); pg.click("#send-ja")
        pg.wait_for_selector("#send-ergebnis-t"); assert "1 Tour gesendet" in pg.inner_text("#send-ergebnis-t"), pg.inner_text("#send-ergebnis-t")
        assert tour("b")["mtId"].startswith("g") and pg.evaluate("window.__mt.up.length") == 2 and pg.evaluate("window.__mt.up[1].sport") == "touringbicycle"
        pg.click("#send-fertig"); pg.wait_for_selector("#mt-senden"); zu()      # danach geht es zurück zum Blatt „Meine Touren“
        # 7. Konto „nur ansehen“ im Blatt: kein Senden, ein Hinweis
        konto("viewer", "SITZUNG-BETRACHTER-BEISPIEL"); pg.evaluate("location.hash = '#/'"); pg.evaluate("location.hash = '#/import'"); pg.wait_for_selector("#imp-mt"); pg.click("#imp-mt"); pg.wait_for_selector("#mt-viewer")
        assert pg.locator("#mt-senden").count() == 0 and pg.locator("#mt-auto").count() == 0 and "Schreibrechten" in pg.inner_text("#mt-viewer"); zu()
        # 8. Unverschlüsselte Adresse außerhalb des eigenen Netzes: Warnung vor dem Senden; „Abbrechen“ geht nicht ins Netz
        pg.evaluate("async () => { await DB.kvSet('mt', { base: 'http://touren.example.org', name: 'x', role: 'user', token: 'K' }); window.__mt.log.length = 0; }")
        menue("c"); pg.click("#mt-senden-tour"); pg.wait_for_selector("#send-ja"); assert "unverschlüsselt" in pg.inner_text("#send-frage").lower(), pg.inner_text("#send-frage"); pg.click("#send-nein"); zu(); assert posts() == [] and "mtId" not in tour("c")
        # 9. Automatisch senden: Vorgabe aus → nichts; eingeschaltet → still gesendet; Fehler → vorgemerkt und später erneut versucht
        konto("user", "SITZUNG-SCHREIBER-BEISPIEL"); assert pg.evaluate("Set_.get('mtAuto')") is False
        pg.evaluate("id => DB.get('tours', id).then(t => Senden.auto(t))", ids["c"]); assert posts() == [] and pg.evaluate("DB.kvGet('mtOffen', [])") == [], "ausgeschaltet: nichts geht raus"
        pg.evaluate("Set_.set('mtAuto', true)"); leise()
        pg.evaluate("id => DB.get('tours', id).then(t => Senden.auto(t))", ids["c"]); assert "gesendet" in toast("gesendet|schon in Meine Touren")
        assert pg.evaluate("window.__mt.up.length") == 3 and pg.evaluate("DB.kvGet('mtOffen', [])") == [] and tour("c")["mtId"].startswith("g"), "Auto: gesendet, Warteschlange leer"
        pg.evaluate("window.__mt.fail = 503"); leise()
        pg.evaluate("id => DB.get('tours', id).then(t => Senden.auto(t))", ids["d"]); toast("später noch einmal")
        q = pg.evaluate("DB.kvGet('mtOffen', [])"); assert q == [{"id": ids["d"], "n": 1}], q
        assert "mtId" not in tour("d") and pg.evaluate("window.__mt.up.length") == 3, "nichts angekommen, Tour unverändert"
        pg.evaluate("window.__mt.fail = null"); leise(); pg.evaluate("Senden.nachholen()"); toast("gesendet")
        assert pg.evaluate("DB.kvGet('mtOffen', [])") == [] and tour("d")["mtId"].startswith("g") and pg.evaluate("window.__mt.up.length") == 4
        assert pg.evaluate("window.__mt.up[3].sport") is None, "„Sonstiges“: keine Sportart mitgesendet"
        # Sicherung: Sitzungsschlüssel und Warteschlange bleiben draußen
        bk = pg.evaluate("Backup.SKIP.includes('mt') && Backup.SKIP.includes('mtOffen')"); assert bk
        assert "Passwort" not in json.dumps(pg.evaluate("DB.kvGet('mt', null)")) and "password" not in json.dumps(pg.evaluate("DB.kvGet('mt', null)")).lower()
    finally:
        pg.evaluate("(sheet.stack || []).slice().forEach(x => x.close())")
        pg.evaluate("async () => { window.__mt.fail = null; for (const t of (await Tours.list())) if (t.name.startsWith('Sendetour')) await Tours.remove(t.id); await DB.del('kv', 'mt'); await DB.del('kv', 'mtOffen'); await Set_.set('mtAuto', false); Tours.invalidate(); }")
    nachher = pg.evaluate("Tours.list().then(l => l.map(t => t.id))")
    new_ = [i for i in nachher if i not in vorher]
    if new_: pg.evaluate("async ids => { for (const i of ids) await Tours.remove(i); Tours.invalidate(); }", new_)      # was „Aus Meine Touren holen“ aus dem Beispielserver mitgebracht hat


def blaetter_setup(pg):
    """2.5.0: Touren eines Jahres (mit Notiz) und ein nachgestellter Server für die neuen Blätter. Gibt { tour, jahr } zurück; aufräumen mit blaetter_ende."""
    fx = mt_fixture(); pg.evaluate(MT_FAKE, fx)
    return pg.evaluate("""async () => {
      const mk = async (name, sport, t0, n, extra) => { const pts = Array.from({ length: n }, (_, i) => ({ lat: 47.5 + i * 0.0004, lon: 11.2 + Math.sin(i / 9) * 0.004, ele: 800 + 60 * Math.sin(i / 7), t: t0 + i * 30000 }));
        const t = (await Tours.add({ name, sport, pts, src: 'file' })).tour; Object.assign(t, extra || {}); await Tours.save(t); return t.id; };
      const ids = [await mk('Blatt Hüttenrunde mit einem recht langen Namen am Wank', 'hike', Date.UTC(2023, 4, 6, 8), 120, { note: 'Schöner Tag, Quellwasser am Wegkreuz.', stars: 4 }), await mk('Blatt Radrunde', 'bike', Date.UTC(2023, 5, 17, 8), 90), await mk('Blatt Abendlauf', 'run', Date.UTC(2023, 8, 2, 17), 60)];
      return { tour: ids[0], ids, jahr: 2023 }; }""")


def blaetter_zustaende(pg, d):
    """Öffnet nacheinander die neuen Blätter (PDF und Senden) und gibt jeweils eine Bezeichnung zurück; danach sind sie wieder zu. Der Aufrufer prüft, was er will (Layout, Kontrast)."""
    zu = lambda: (pg.evaluate("(sheet.stack || []).slice().forEach(x => x.close())"), pg.wait_for_function("() => !document.querySelector('.sheet-back')"))
    toene = lambda: pg.wait_for_function("() => { const t = document.querySelector('#toast'); return !t || !t.classList.contains('on'); }", timeout=30000)
    konto = lambda r, k: pg.evaluate("async ([r, k]) => { await DB.kvSet('mt', { base: 'https://mt.test', name: 'Tagebuch', role: r, token: k, since: Date.now() }); window.__mt.sessions.add(k); }", [r, k])
    route = lambda h: (pg.evaluate("h => { if (location.hash === h) return Nav.render(); location.hash = h; }", h), pg.wait_for_selector(".tourp h1" if "tour" in h else ".view, #view"), pg.wait_for_timeout(300))
    konto("user", "SITZUNG-SCHREIBER-BEISPIEL")
    route("#/tour/" + d["tour"]); pg.click("button[aria-label=Aktionen]"); pg.wait_for_selector("#mt-senden-tour"); yield "Tour, Menü mit Als PDF und Senden"; zu()
    pg.evaluate("id => { window.__d = DB.get('tours', id).then(t => Senden.dialog(t)); }", d["tour"]); pg.wait_for_selector("#send-ja"); yield "Senden, Rückfrage"
    pg.click("#send-nein"); zu()
    pg.evaluate("() => { PhotoSources.progress('An Meine Touren senden', upd => new Promise(r => { upd(3, 12, 'Blatt Hüttenrunde'); window.__pe = r; }), { cancel: () => {}, note: 'Bitte die App geöffnet lassen, bis das Senden fertig ist.' }); }")
    pg.wait_for_selector("#prog-stop"); yield "Senden, Fortschritt mit Abbrechen"; pg.evaluate("window.__pe()"); zu()
    pg.evaluate("() => { window.__r = Senden.auswahl(() => {}); }"); pg.wait_for_selector("#send-liste .send-row")
    yield "Senden, Auswahl leer"
    pg.click("#send-alle"); yield "Senden, Auswahl alle markiert"; zu()
    pg.evaluate("Senden.erklaeren(SendenCalc.pruefen({ timed: true, start: 1, status: 'done' }, { base: 'x', token: 'k', role: 'viewer' }))"); pg.wait_for_selector("#send-grund"); yield "Senden, Betrachter-Erklärung"; zu()
    pg.evaluate("() => { window.__r = Senden.mitFortschritt({ base: 'https://mt.test', token: 'SITZUNG-SCHREIBER-BEISPIEL', role: 'user', name: 'x' }, [], () => {}); }")
    pg.wait_for_selector("#send-ergebnis-t"); yield "Senden, Ergebnis"; zu()
    route("#/import"); pg.click("#imp-mt"); pg.wait_for_selector("#mt-senden"); yield "Meine Touren, verbunden (Schreibkonto)"; zu()
    konto("viewer", "SITZUNG-BETRACHTER-BEISPIEL"); pg.click("#imp-mt"); pg.wait_for_selector("#mt-viewer"); yield "Meine Touren, verbunden (nur ansehen)"; zu()
    pg.evaluate("async id => { PdfUI.tour(await DB.get('tours', id)); }", d["tour"]); pg.wait_for_selector("#pdf-fertig", timeout=60000); yield "PDF, fertig (Speichern und Teilen)"; zu()
    pg.evaluate("() => { PhotoSources.progress('Jahresrückblick 2023 als PDF', upd => new Promise(r => { upd(7, 30, 'Seite 2 von 5'); window.__pe = r; }), { cancel: () => {}, note: 'Bitte die App geöffnet lassen.' }); }")
    pg.wait_for_selector("#prog-stop"); yield "PDF, Fortschritt mit Abbrechen"; pg.evaluate("window.__pe()"); zu()
    pg.evaluate("DB.kvSet('mt', null)")


def blaetter_ende(pg, d):
    pg.evaluate("(sheet.stack || []).slice().forEach(x => x.close())")
    pg.evaluate("async ids => { for (const i of ids) await Tours.remove(i); await DB.del('kv', 'mt'); Tours.invalidate(); }", d["ids"])


def blaetter(pg):
    """2.5.0: Layout der neuen Bedienelemente (Jahresrückblick „Als PDF“, Tourmenü, Blätter zum PDF und zum Senden) bei 360–430 px und 130 % Schrift."""
    d = blaetter_setup(pg); bad = []
    try:
        bad += layout_check(pg, ["#/jahr/%d" % d["jahr"]])
        pg.evaluate("location.hash = '#/jahr/%d'" % d["jahr"]); pg.wait_for_selector("#jahr-pdf"); pg.wait_for_selector("#jahr-pdf-fotos")
        for w, fs in ((360, 100), (390, 100), (430, 100), (360, 130)):
            pg.set_viewport_size({"width": w, "height": 800})
            pg.evaluate("fs => { let s = document.getElementById('fs-test'); if (!s) { s = document.createElement('style'); s.id = 'fs-test'; document.head.append(s); } s.textContent = fs === 100 ? '' : 'html{font-size:' + fs + '% !important}'; }", fs)
            for lab in blaetter_zustaende(pg, d):
                pg.wait_for_timeout(250)
                for m in pg.evaluate(LAYOUT_JS): bad.append(f"{w} px, {fs} %, {lab}: {m}")
        pg.evaluate("document.getElementById('fs-test').textContent = ''"); pg.set_viewport_size({"width": 390, "height": 800})
    finally: blaetter_ende(pg, d)
    assert not bad, "Layout der neuen Blätter:\n" + "\n".join(sorted(set(bad))[:20])


def alles(pg):
    """2.2.0, Punkt C: „Alles abgleichen“ – nur mit verbundenen Quellen, Reihenfolge, gespeicherte Einstellungen, gemeinsames Fortschrittsblatt, Abbruch, Fehler einer Quelle,
    Zusammenfassung, Zeile auf der Startseite, automatischer Abgleich (24 h, nie während einer Aufzeichnung, Vorgabe aus)."""
    pg.evaluate("async () => { for (const k of ['mt', 'zepp', 'komoot', 'abgleich']) await DB.del('kv', k); await Set_.set('autoAbgleich', false); await Set_.set('zeppEle', true); await Set_.set('mtZahlen', true); await Set_.set('komootPlanned', false); }")
    # ohne verbundene Quelle: nirgends ein Knopf; Vorgabe der Einstellung: aus
    go(pg, "#/start", "#startrec"); pg.wait_for_timeout(300); assert pg.locator("#startsync").count() == 0
    go(pg, "#/import", "#imp-mt"); pg.wait_for_timeout(300); assert pg.locator("#all-go").count() == 0 and pg.evaluate("document.querySelector('#allbox').hidden")
    assert pg.evaluate("Set_.get('autoAbgleich')") is False and pg.evaluate("Set_.defaults.autoAbgleich") is False
    pg.evaluate(ALLES_STUBS)
    assert pg.evaluate("Import.Alles.quellen().then(q => q.length)") == 0
    # nur Meine Touren verbunden: Knopf da, auf der Startseite ruhig (kein Gelb), „Noch nicht abgeglichen“
    pg.evaluate("DB.kvSet('mt', { base: 'https://mt.test', name: 'V', role: 'viewer', token: 'x' })")
    go(pg, "#/start", "#startsync"); assert "Noch nicht abgeglichen" in pg.inner_text("#lastsync") and "pri" not in (pg.get_attribute("#startsync", "class") or "")
    assert pg.evaluate("getComputedStyle(document.querySelector('#startsync')).backgroundColor") in ("rgba(0, 0, 0, 0)", "transparent"), "kein gelber Knopf"
    # alle drei verbunden (Komoot und Zepp mit Zugangsdaten), Einstellungen gespeichert: Zepp ohne Uhr-Höhen, Komoot mit geplanten, Zahlen aus
    pg.evaluate("async () => { await DB.kvSet('komoot', { user: '1', token: 't', email: 'a@b.de' }); await DB.kvSet('zepp', { token: 'z', viaToken: true }); await Set_.set('zeppEle', false); await Set_.set('komootPlanned', true); await Set_.set('mtZahlen', false); }")
    assert pg.evaluate("Import.Alles.quellen().then(q => q.map(x => x.id).join())") == "zepp,komoot,mt", "Reihenfolge"
    go(pg, "#/import", "#all-go"); assert pg.evaluate("document.querySelector('#view .pad').firstElementChild.id") == "allbox", "ganz oben"
    assert "Zepp → Komoot → Meine Touren" in pg.inner_text("#all-src") and not pg.locator("#auto-sync input").is_checked() and "pri" in pg.get_attribute("#all-go", "class")
    # Lauf mit gemeinsamem Fortschrittsblatt
    pg.evaluate("() => { __al.calls = []; let go; __al.mode.komoot = { gate: new Promise(r => { window.__alGo = r; }) }; }")
    pg.click("#all-go"); pg.wait_for_selector("#prog-stop"); pg.wait_for_function("() => /Komoot · 1 von 2 · Anfang/.test(document.querySelector('.sheet p').textContent)")
    assert pg.evaluate("document.querySelector('.sheet').getAttribute('aria-label')") == "Alles abgleichen" and pg.evaluate("document.querySelector('.prog i').style.width") != "0px"
    w = pg.evaluate("parseFloat(document.querySelector('.prog i').style.width)"); assert 33 < w < 67, w      # Quelle 2 von 3 läuft: Zepp fertig, Komoot halb
    pg.evaluate("window.__alGo()"); pg.wait_for_selector("#sum")
    assert pg.evaluate("__al.calls.map(c => c[0]).join()") == "zepp,komoot,mt", "Reihenfolge der Aufrufe"
    c = pg.evaluate("Object.fromEntries(__al.calls)"); assert c["zepp"]["ele"] is False and c["komoot"]["planned"] is True and c["mt"]["zahlen"] is False, c      # gespeicherte Einstellungen
    assert pg.inner_text("#sum-head") == "3 neue Touren im Tagebuch." and pg.evaluate("document.querySelector('#sum').closest('.sheet').getAttribute('aria-label')") == "Abgleich fertig"
    assert pg.locator("#sum .li").count() == 3 and [x.strip() for x in pg.locator("#sum .li .li-t b").all_inner_texts()] == ["Zepp", "Komoot", "Meine Touren"]
    z = pg.inner_text("#sum-zepp"); assert "1 Tour importiert" in z and "Puls bei 2 Touren ergänzt" in z and "5 schon vorhanden" in z, z
    assert "Name bei 1 Tour von Komoot übernommen" in pg.inner_text("#sum-komoot") and "Zahlen bei 4 Touren angeglichen" in pg.inner_text("#sum-mt")
    st = pg.evaluate("DB.kvGet('abgleich')"); assert st["neu"] == 3 and st["fehler"] == 0 and abs(st["t"] - pg.evaluate("Date.now()")) < 60000, st
    pg.click("#sum-ok"); pg.wait_for_selector(".sheet", state="detached")
    go(pg, "#/start", "#lastsync")
    import re as _re
    assert _re.fullmatch(r"Zuletzt abgeglichen: heute \d\d:\d\d · 3 neue Touren", pg.inner_text("#lastsync")), pg.inner_text("#lastsync")
    # Abbrechen: bricht sauber ab, die übrigen Quellen werden nicht ausgeführt, „abgebrochen“ in der Zusammenfassung, Zeitpunkt bleibt
    vor = pg.evaluate("DB.kvGet('abgleich').then(a => a.t)")
    pg.evaluate("() => { __al.calls = []; __al.mode = { zepp: { slow: true } }; }")
    pg.click("#startsync"); pg.wait_for_selector("#prog-stop"); pg.wait_for_function("() => __al.calls.length === 1"); pg.click("#prog-stop"); pg.wait_for_selector("#sum")
    assert pg.evaluate("document.querySelector('#sum').closest('.sheet').getAttribute('aria-label')") == "Abgleich abgebrochen" and "der Rest kommt beim nächsten Mal" in pg.inner_text("#sum-head")
    assert "abgebrochen – der Rest kommt beim nächsten Mal" in pg.inner_text("#sum-zepp") and "Nicht ausgeführt" in pg.inner_text("#sum-komoot") and "Nicht ausgeführt" in pg.inner_text("#sum-mt")
    assert pg.evaluate("__al.calls.map(c => c[0]).join()") == "zepp" and pg.evaluate("DB.kvGet('abgleich').then(a => a.t)") == vor, "abgebrochener Lauf zählt nicht als letzter Abgleich"
    pg.click("#sum-ok"); pg.wait_for_selector(".sheet", state="detached")
    # Fehler einer Quelle brechen die anderen nicht ab: Komoot nicht erreichbar, Meine Touren abgelaufen
    pg.evaluate("""() => { __al.calls = []; __al.mode = { komoot: { err: { message: 'Tourenliste: HTTP 401' } }, mt: { err: { message: 'Die Anmeldung bei Meine Touren ist abgelaufen. Bitte neu anmelden.', relogin: true } } }; }""")
    pg.click("#startsync"); pg.wait_for_selector("#sum")
    assert pg.evaluate("__al.calls.map(c => c[0]).join()") == "zepp,komoot,mt" and "1 neue Tour im Tagebuch." == pg.inner_text("#sum-head")
    assert "1 Tour importiert" in pg.inner_text("#sum-zepp") and "Komoot neu anmelden" in pg.inner_text("#sum-komoot") and "Mehr → Touren importieren → Meine Touren neu anmelden" in pg.inner_text("#sum-mt")
    assert pg.locator("#sum .li-r", has_text="Fehler").count() == 2
    pg.click("#sum-ok"); pg.wait_for_selector(".sheet", state="detached"); go(pg, "#/start", "#lastsync")
    assert pg.inner_text("#lastsync").endswith("· 1 neue Tour · 2 Quellen mit Fehler"), pg.inner_text("#lastsync")
    # eine Quelle nicht erreichbar, alle anderen auch: nichts „abgeglichen“ gemerkt, Versuch schon
    pg.evaluate("""async () => { __al.mode = { zepp: { err: { message: 'x' } }, komoot: { err: { message: 'y' } }, mt: { err: { message: 'z' } } }; await DB.del('kv', 'abgleich'); }""")
    pg.click("#startsync"); pg.wait_for_selector("#sum"); assert "1 Quelle" not in pg.inner_text("#sum-head") and pg.locator("#sum .li-r", has_text="Fehler").count() == 3; pg.click("#sum-ok"); pg.wait_for_selector(".sheet", state="detached")
    st = pg.evaluate("DB.kvGet('abgleich')"); assert "t" not in st and st["versuch"] > 0, st
    # läuft schon einer: der zweite Start und die Einzelimporte warten
    pg.evaluate("() => { __al.mode = { zepp: { gate: new Promise(r => { window.__alGo = r; }) } }; __al.calls = []; }")
    go(pg, "#/start", "#startsync"); pg.click("#startsync"); pg.wait_for_selector("#prog-stop")
    assert pg.evaluate("Import.Alles.busy") is True and pg.evaluate("Import.Alles.run().then(() => 'lief', e => e.message)") == "Ein Abgleich läuft schon."
    pg.evaluate("window.__alGo()"); pg.wait_for_selector("#sum"); pg.click("#sum-ok"); pg.wait_for_selector(".sheet", state="detached"); assert pg.evaluate("Import.Alles.busy") is False
    # Automatischer Abgleich: Vorgabe aus → nichts; Schalter an → fällig nach 24 h; nie während einer Aufzeichnung; höchstens einmal je 24 h; still, nur kurze Meldung
    pg.evaluate("async () => { __al.mode = {}; __al.calls = []; await DB.kvSet('abgleich', { t: Date.now() - 30 * 3600000, neu: 0, fehler: 0, versuch: Date.now() - 30 * 3600000 }); }")
    assert pg.evaluate("Import.Alles.auto()") is None and pg.evaluate("__al.calls.length") == 0, "Vorgabe aus: nichts"
    go(pg, "#/import", "#auto-sync"); pg.click("#auto-sync"); pg.wait_for_function("Set_.get('autoAbgleich') === true"); pg.evaluate("location.hash = '#/start'"); pg.wait_for_selector("#startrec"); pg.reload(); pg.wait_for_selector("#tabs a"); pg.evaluate(ALLES_STUBS)      # neu laden: die Einstellung gilt nach dem Start
    pg.evaluate("window.__rec.state = 'recording'"); assert pg.evaluate("Import.Alles.auto()") is None and pg.evaluate("__al.calls.length") == 0, "während einer Aufzeichnung nie"
    pg.evaluate("window.__rec.state = 'idle'")
    pg.evaluate("async () => { await DB.kvSet('abgleich', { t: Date.now() - 2 * 3600000, neu: 1, fehler: 0, versuch: Date.now() - 2 * 3600000 }); }"); assert pg.evaluate("Import.Alles.auto()") is None, "vor weniger als 24 h"
    pg.evaluate("async () => { await DB.kvSet('abgleich', { t: Date.now() - 30 * 3600000, neu: 1, fehler: 0, versuch: Date.now() - 600000 }); }"); assert pg.evaluate("Import.Alles.auto()") is None, "Versuch vor 10 Minuten"
    pg.evaluate("async () => { await DB.kvSet('abgleich', { t: Date.now() - 30 * 3600000, neu: 1, fehler: 0, versuch: Date.now() - 30 * 3600000 }); }")
    go(pg, "#/start", "#startsync"); pg.wait_for_function(LEISE, timeout=30000)
    pg.evaluate("autoAbgleich()"); toast = toast_text(pg, "Abgeglichen", 20000)
    assert toast == "Abgeglichen: 3 neue Touren", toast
    assert pg.locator("#sum, #prog-stop, .sheet").count() == 0, "still: kein Blatt"
    assert pg.evaluate("__al.calls.map(c => c[0]).join()") == "zepp,komoot,mt" and pg.evaluate("Import.Alles.auto()") is None, "danach 24 Stunden Ruhe"
    pg.wait_for_function("() => /heute \\d\\d:\\d\\d · 3 neue Touren/.test(document.querySelector('#lastsync').textContent)")
    # Aufzeichnung startet mitten im automatischen Abgleich: er hört an der nächsten Stelle auf
    pg.evaluate("async () => { __al.calls = []; __al.mode = { zepp: { slow: true } }; await DB.kvSet('abgleich', { t: Date.now() - 30 * 3600000, neu: 0, fehler: 0, versuch: Date.now() - 30 * 3600000 }); }")
    pg.evaluate("() => { window.__autoP = Import.Alles.auto(); }"); pg.wait_for_function("__al.calls.length === 1"); pg.evaluate("window.__rec.state = 'recording'")
    r = pg.evaluate("window.__autoP.then(r => [r.stopped, r.items.map(i => i.id + (i.skipped ? ':ausgelassen' : '')).join()])"); assert r == [True, "zepp,komoot:ausgelassen,mt:ausgelassen"], r
    pg.evaluate("window.__rec.state = 'idle'")
    # Aufräumen
    pg.evaluate("""async () => { Import.Zepp.importAll = __alReal.z; Import.Komoot.importAll = __alReal.k; Import.MT.importAll = __alReal.m; for (const k of ['mt', 'zepp', 'komoot', 'abgleich']) await DB.del('kv', k); await Set_.set('autoAbgleich', false); await Set_.set('zeppEle', true); await Set_.set('mtZahlen', true); await Set_.set('komootPlanned', false); }""")


def alles_echt(pg):
    """„Alles abgleichen“ mit dem echten Abgleich von Meine Touren (simulierter Server) und Komoot/Zepp nicht verbunden: die Quelle läuft mit ihren Einstellungen, übersprungen wird, was nicht verbunden ist."""
    fx = mt_fixture(); vorher = pg.evaluate("Tours.list().then(l => l.map(t => t.id))")
    pg.evaluate(MT_FAKE, fx)
    pg.evaluate("async () => { for (const k of ['zepp', 'komoot', 'abgleich']) await DB.del('kv', k); await DB.kvSet('mt', { base: 'https://mt.test', name: 'Tagebuch', role: 'viewer', token: 'SITZUNG-BETRACHTER-BEISPIEL' }); window.__mt.sessions.add('SITZUNG-BETRACHTER-BEISPIEL'); }")
    seen = []
    r = pg.evaluate("async () => { const f = []; const r = await Import.Alles.run({ onProgress: (t, a) => f.push([t, Math.round(a * 100)]) }); return { items: r.items.map(i => ({ id: i.id, added: i.res && i.res.added, err: i.err && i.err.message })), neu: r.neu, stopped: r.stopped, fehler: r.fehler, f }; }")
    assert [i["id"] for i in r["items"]] == ["mt"] and r["items"][0]["added"] == 13 and r["neu"] == 13 and not r["stopped"] and r["fehler"] == 0, r
    assert r["f"][0][1] == 0 and r["f"][-1] == ["Fertig", 100] and any("Meine Touren" in t for t, _ in r["f"]), r["f"][:3]
    log = pg.evaluate("window.__mt.log"); assert log[0] == "GET /api/tours" and not [x for x in log if x.split()[0] != "GET"], "nur lesend"
    # abgelaufene Sitzung: Fehler in der Zusammenfassung mit Hinweis, kein Anmeldeblatt
    pg.evaluate("window.__mt.sessions.clear()")
    go(pg, "#/start", "#startsync"); pg.click("#startsync"); pg.wait_for_selector("#sum")
    tx = pg.inner_text("#sum-mt"); assert "abgelaufen" in tx and "Mehr → Touren importieren → Meine Touren neu anmelden" in tx, tx
    assert pg.locator("#mt-pw, #mt-url").count() == 0, "keine Anmeldeblätter"; pg.click("#sum-ok"); pg.wait_for_selector(".sheet", state="detached")
    assert pg.evaluate("DB.kvGet('mt')") == {"base": "https://mt.test", "name": "Tagebuch"}
    pg.evaluate("async (keep) => { for (const t of await Tours.list()) if (!keep.includes(t.id)) await Tours.remove(t.id); for (const k of ['mt', 'abgleich']) await DB.del('kv', k); Native.http = window.__mtReal; }", vorher)


JAHR_SEED = """async () => {
  const L = (y, m, d, hh, mi) => new Date(y, m - 1, d, hh, mi || 0).getTime();
  const mk = (id, name, sport, start, dist, up, dur, extra) => DB.put('tours', Object.assign({ id, name, sport, status: 'done', start, end: start + dur * 1000, dur, moving: Math.round(dur * .8), dist, up, down: up, maxAlt: 1000 + up, lat: 47.5, lon: 11.2, timed: true, hidden: false, fav: false, created: 1 }, extra || {}));
  await mk('jy1', 'Schneeschuh am Joch', 'hike', L(2019, 1, 5, 9), 10000, 500, 7200, { tags: ['Schneeschuh'] });
  await mk('jy2', 'Laufrunde', 'run', L(2019, 1, 5, 18), 5000, 50, 1800);
  await mk('jy3', 'Rad zum See', 'mtb', L(2019, 7, 20, 10), 40000, 800, 9000, { stars: 5, starsMan: 1 });
  await mk('jy4', 'Silvesterrunde', 'hike', L(2019, 12, 31, 23, 30), 8000, 100, 3600);
  await mk('jy5', 'Ausgeblendet', 'hike', L(2019, 8, 1, 9), 99000, 9000, 9000, { hidden: true });
  await mk('jy6', 'Geplant', 'hike', L(2019, 9, 1, 9), 99000, 9000, 9000, { status: 'planned' });
  await mk('jy7', 'Neujahr', 'hike', L(2020, 1, 1, 0, 30), 7000, 70, 3000);
  await mk('jy8', 'Vorjahrestour', 'hike', L(2018, 7, 1, 9), 20000, 300, 7200);
  Tours.invalidate();
}"""

def kpis(pg):
    return pg.evaluate("() => Object.fromEntries([...document.querySelectorAll('.kpi')].map(k => [k.querySelector('small').innerText.replace(/^Tour$/, 'Touren').replace(/^Tag mit Tour$/, 'Tage mit Tour'), k.querySelector('b').innerText.replace(/\\s+/g, ' ')]))")

def jahr(pg):
    """2.3.0: Jahresrückblick. Zahlen wie in der Statistik, Leerzustand, Jahr wählen, Vorjahr, Sportarten, Höhepunkte, Monatsdiagramm, Regionen, Fotos,
    Teilen (App-Weg und Browser-Download), Bildkarte, Startseite (ruhig / hervorgehoben), Mehr, Gestaltung."""
    png = bytes.fromhex("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000001e221bc330000000049454e44ae426082")
    pg.evaluate(JAHR_SEED)
    go(pg, "#/jahr/2019", "#jahr-teilen")
    # 1. Zahlen: dieselben wie die Jahresstatistik (versteckte, geplante und Touren des Nachbarjahres zählen nicht; Silvester 23:30 gehört zu 2019)
    j = kpis(pg)
    assert j["Touren"] == "4", j
    go(pg, "#/stats", "select[aria-label=Zeitraum]"); pg.select_option("select[aria-label=Zeitraum]", "2019"); pg.wait_for_selector(".kpis .kpi")
    st = kpis(pg)
    assert st["Touren"] == j["Touren"] and st["Strecke"] == j["Kilometer"] and st["Aufstieg"] == j["Höhenmeter im Aufstieg"] and st["Zeit unterwegs"] == j["Stunden unterwegs"] and st["Aktive Tage"] == j["Tage mit Tour"], (st, j)
    assert j["Kilometer"].replace(" ", "") == "63,0km" and j["Tage mit Tour"] == "3" and j["Höhenmeter im Aufstieg"].replace(" ", "") == "1.450m", j
    # Alle Jahre mit Touren stimmen überein (die Jahre der anderen Testteile eingeschlossen)
    ys = pg.evaluate("Tours.list().then(l => Jahr.jahre(l))")
    for y in ys[:6]:
        go(pg, "#/jahr/%d" % y, "#jahr-teilen"); a = kpis(pg)
        go(pg, "#/stats", "select[aria-label=Zeitraum]"); pg.select_option("select[aria-label=Zeitraum]", str(y)); pg.wait_for_selector(".kpis .kpi"); b = kpis(pg)
        assert (b["Strecke"], b["Aufstieg"], b["Zeit unterwegs"], b["Aktive Tage"]) == (a["Kilometer"], a["Höhenmeter im Aufstieg"], a["Stunden unterwegs"], a["Tage mit Tour"]) and b["Touren"].split()[0] == a["Touren"].split()[0], (y, a, b)
    # 2. Seite: Vorjahr, Sportarten (Schneeschuh bei Wandern), Höhepunkte, Monate
    go(pg, "#/jahr/2019", "#jahr-teilen")
    vj = pg.inner_text("#jahr-vorjahr"); assert "Gegenüber 2018" in vj and "+3" in vj and "+43,0 km" in vj, vj
    sp = pg.evaluate("[...document.querySelectorAll('.jsp')].map(e => [e.dataset.sport, e.innerText.replace(/\\s+/g, ' ')])")
    assert [x[0] for x in sp] == ["rad", "wandern", "laufen"] and "2 Touren" in sp[1][1] and "18,0 km" in sp[1][1], sp
    hp = pg.inner_text("#jahr-hoehe"); assert "Längste Tour" in hp and "Rad zum See" in hp and "Schönste Tour" in hp and "5 Sterne" in hp and "Aktivster Monat" in hp and "Juli 2019" in hp and "Längste Serie" not in hp, hp
    assert pg.locator("#jahr-hoehe a.li").count() == 4, "Verweise auf Touren"
    assert pg.evaluate("document.querySelectorAll('#jahr-chart svg rect').length") == 12 and "Juli 40,0 km" in pg.get_attribute("#jahr-chart svg", "aria-label") and "Januar 15,0 km" in pg.get_attribute("#jahr-chart svg", "aria-label")
    pg.click("#jahr-monate .seg button:has-text('Touren')"); assert "Januar 2 Touren" in pg.get_attribute("#jahr-chart svg", "aria-label")
    pg.click("#jahr-zahlenliste summary"); assert pg.locator(".jmon tbody tr").count() == 12 and "Juli" in pg.inner_text(".jmon")
    assert pg.locator("#jahr-orte").count() == 0 and pg.locator("#jahr-fotos").count() == 0, "ohne Orte und Fotos kein Abschnitt"
    # Jahr wählen
    pg.click("#jahr-2018"); pg.wait_for_function("location.hash === '#/jahr/2018' && (document.querySelector('#jahr-titel') || {}).innerText === '2018'")
    assert pg.locator("#jahr-vorjahr").count() == 0, "2017 hat keine Touren: kein Vergleich"
    # 3. Leerzustand
    go(pg, "#/jahr/2031", ".jahr-leer"); t = pg.inner_text(".jahr-leer"); assert "Im Jahr 2031 steht noch keine Tour" in t and pg.locator("#jahr-teilen").count() == 0 and pg.locator("#jahr-frueher").count() == 1, t
    pg.click("#jahr-frueher"); pg.wait_for_selector("#jahr-teilen")
    # 4. Regionen und Fotos erscheinen nur, wenn es sie gibt
    pg.route("**/thumb/**", lambda r: r.fulfill(status=200, body=png, content_type="image/jpeg"))
    pg.evaluate("""async () => { await DB.kvSet('regionCells', { [Reisen.cell({ lat: 47.5, lon: 11.2 })]: 'Tirol' });
      for (let i = 0; i < 3; i++) await DB.put('photos', { id: 'jf' + i + 'aaaaaa', name: 'j.jpg', ts: new Date(2019, 0, 5, 10 + i).getTime(), tour: 'jy1', w: 10, h: 10, src: 'galerie', faces: 0 }); }""")
    go(pg, "#/jahr/2019", "#jahr-orte"); o = pg.inner_text("#jahr-orte"); assert "Tirol" in o and "4 Touren" in o, o
    pg.wait_for_selector("#jahr-fotozahl"); assert pg.inner_text("#jahr-fotozahl").startswith("3 Fotos zu 1 Tour"), pg.inner_text("#jahr-fotozahl")
    pg.wait_for_selector("#jahr-collage:not([hidden]) img"); assert pg.locator("#jahr-collage img").count() >= 1
    pg.unroute("**/thumb/**")
    # 5. Teilen über den Weg der App (Zwischenspeicher + Teilen-Menü), Bild 1080 × 1350
    pg.evaluate("""() => { window.__sh = []; if (!window.__call0) window.__call0 = Native.call; Native.call = (m, a) => { window.__sh.push([m, a]); return window.__call0.call(Native, m, a); }; }""")
    pg.click("#jahr-teilen"); pg.wait_for_function("window.__sh.some(x => x[0] === 'shareCache')", timeout=30000)
    pg.wait_for_function("() => !document.querySelector('#jahr-teilen').disabled")
    sh = pg.evaluate("window.__sh"); ap = [a for m, a in sh if m == "appendCache"]; sc = [a for m, a in sh if m == "shareCache"][0]
    assert ap and ap[0]["reset"] is True and all(a["name"] == "Tourentagebuch-Jahr-2019.jpg" for a in ap) and sc["name"] == "Tourentagebuch-Jahr-2019.jpg" and sc["mime"] == "image/jpeg", (sc, len(ap))
    import base64
    raw = b"".join(base64.b64decode(a["b64"]) for a in ap); assert raw[:3] == b"\xff\xd8\xff" and len(raw) > 20000, len(raw)
    dims = pg.evaluate("""async (b64) => { const im = new Image(); im.src = 'data:image/jpeg;base64,' + b64; await im.decode(); return [im.naturalWidth, im.naturalHeight]; }""", base64.b64encode(raw).decode())
    assert dims == [1080, 1350], dims
    # Im Browser (ohne Hülle) wird das Bild heruntergeladen
    pg.evaluate("() => { window.__mt0 = window.MTApp; window.MTApp = undefined; }")
    pg.wait_for_function(LEISE)
    with pg.expect_download(timeout=30000) as dl: pg.click("#jahr-teilen")
    assert dl.value.suggested_filename == "Tourentagebuch-Jahr-2019.jpg"
    toast_text(pg, "Bild gespeichert")
    pg.evaluate("() => { window.MTApp = window.__mt0; Native.call = window.__call0; }")
    # 6. Bildkarte: eigenes Canvas, Inhalt vorhanden (Kopf petrol, Papier, Tinte)
    px = pg.evaluate("""async () => { const d = Jahr.berechne(await Tours.list(), 2019, new Date(2026, 10, 20)); const cv = await JahrKarte.render(d, { now: new Date(2026, 10, 20) }); const c = cv.getContext('2d');
      const at = (x, y) => [...c.getImageData(x, y, 1, 1).data].slice(0, 3); let ink = 0, d2 = c.getImageData(0, 150, 1080, 1200).data; for (let i = 0; i < d2.length; i += 4) if (d2[i] < 60) ink++;
      return { w: cv.width, h: cv.height, head: at(900, 20), paper: at(1000, 700), ink }; }""")
    assert px["w"] == 1080 and px["h"] == 1350 and px["head"] == [12, 37, 38] and px["paper"] == [242, 244, 238] and px["ink"] > 15000, px
    err = pg.evaluate("JahrKarte.render({ leer: true }).then(() => 'ok', e => e.message)"); assert "Keine Touren" in err, err
    # 7. Startseite: ruhiger Eintrag, im Dezember und Januar hervorgehoben; Mehr
    def block(now_args):
        return pg.evaluate("""async (a) => { const all = (await Tours.list()).filter(Jahr.zaehlt), now = new Date(...a); const out = []; for (const b of Home.blocks.filter(b => b.id === 'jahr' || b.id === 'jahrhoch')) { const el = await b.fn({ all, now, year: now.getFullYear() }); if (el) out.push([b.id, el.innerText.replace(/\\s+/g, ' '), el.querySelector('a').getAttribute('href')]); } return out; }""", now_args)
    nov = block([2019, 10, 20]); assert len(nov) == 1 and nov[0][0] == "jahr" and "Dein Jahr 2019 im Rückblick" in nov[0][1] and nov[0][2] == "#/jahr/2019", nov
    dez = block([2019, 11, 10]); assert len(dez) == 1 and dez[0][0] == "jahrhoch" and dez[0][1].startswith("Dein Jahr 2019") and "63,0km" in dez[0][1] and "Jahresrückblick ansehen" in dez[0][1] and dez[0][2] == "#/jahr/2019", dez
    jan = block([2020, 0, 15]); assert len(jan) == 1 and jan[0][0] == "jahrhoch" and jan[0][1].startswith("Dein Jahr 2019") and jan[0][2] == "#/jahr/2019", jan
    leerj = block([2031, 11, 10]); assert len(leerj) == 1 and leerj[0][0] == "jahr" and leerj[0][2] == "#/jahr", leerj
    go(pg, "#/start", "#jahr-ruhig, #jahr-gross, #hero"); pg.wait_for_selector("#hero")
    assert pg.locator("#jahr-eintrag").count() == 1 or pg.locator("#jahr-gross").count() == 1, "Startseite hat den Eintrag"
    pg.evaluate("Set_.set('homeShow', { jahr: false })"); go(pg, "#/start", "#hero"); assert pg.locator("#jahr-eintrag, #jahr-gross").count() == 0, "in den Einstellungen ausschaltbar"
    pg.evaluate("Set_.set('homeShow', {})")
    go(pg, "#/mehr", "#m-jahr"); pg.click("#m-jahr"); pg.wait_for_selector("#jahr"); assert pg.evaluate("document.querySelector(\"#tabs a[data-p='/mehr']\").classList.contains('on') && !document.querySelector('#tabs').classList.contains('hide')")
    # 8. Gestaltung: kein Querrollen, Tippflächen, 360–430 px, 130 % Schrift (Seite, Leerzustand, Jahr mit allen Abschnitten)
    go(pg, "#/jahr/2019", "#jahr-orte"); pg.click("#jahr-zahlenliste summary") if pg.evaluate("!document.querySelector('#jahr-zahlenliste').open") else None
    bad = layout_check(pg, ["#/jahr/2019", "#/jahr/2018", "#/jahr/2031", "#/jahr"])
    # Aufräumen
    pg.evaluate("""async () => { for (const id of ['jy1','jy2','jy3','jy4','jy5','jy6','jy7','jy8']) await DB.del('tours', id); for (let i = 0; i < 3; i++) await DB.del('photos', 'jf' + i + 'aaaaaa'); await DB.del('kv', 'regionCells'); Tours.invalidate(); }""")
    return bad


def layout_22(pg):
    """Gestaltungsprüfung der Neuerungen aus 2.2.0: Tourseite mit Bewertung, Tourenliste mit „★ 4“ und Filterblatt, Startseite und Importseite mit „Alles abgleichen“,
    das Fortschrittsblatt, die Zusammenfassung (ohne und mit Fehlern), Sportart-Blatt und Ziel-Blatt mit den neuen Arten."""
    vorher = pg.evaluate("Tours.list().then(l => l.map(t => t.id))")
    ids = pg.evaluate("""async () => { const mk = async (name, sport, k, o) => { const t = (await Tours.add({ name, sport, pts: Array.from({ length: 40 }, (_, i) => ({ lat: 46.3 + k * 0.01 + i * 0.0005, lon: 10.3, ele: 1600 + i * 5, t: Date.UTC(2025, 1, 1 + k, 9) + i * 30000 })), src: 'file' })).tour; Object.assign(t, o || {}); await Tours.save(t); return t.id; };
      return { a: await mk('Skitour auf den Piz Lat', 'skitour', 1, { stars: 4, starsMan: 1 }), b: await mk('Langlauf im Engadin mit einem sehr langen Namen, der umbrechen muss', 'nordic', 2, { starsMt: 5 }), c: await mk('Piste', 'skialpin', 3), d: await mk('Schneeschuhrunde', 'hike', 4, { tags: ['Schneeschuh'] }) }; }""")
    bad = layout_check(pg, ["#/tour/" + ids["a"], "#/tour/" + ids["b"], "#/"])
    pg.evaluate(ALLES_STUBS)
    pg.evaluate("async () => { await DB.kvSet('mt', { base: 'https://mt.test', name: 'V', role: 'viewer', token: 'x' }); await DB.kvSet('zepp', { token: 'z', viaToken: true }); await DB.kvSet('komoot', { user: '1', token: 't', email: 'a@b.de' }); await DB.kvSet('abgleich', { t: Date.now() - 3600000, neu: 2, fehler: 0, versuch: Date.now() }); }")
    bad += ["verbunden: " + m for m in layout_check(pg, ["#/start", "#/import"])]
    # Sterne auch im Hell und Dunkel gut sichtbar (Kontrast prüft tests/audit_kontrast.py); hier: Tippflächen im Blatt „Filter“ und alle neuen Blätter
    bad += sheet_check(pg, "Filter mit Bewertung", lambda: (go(pg, "#/", "#filterbtn"), pg.click("#filterbtn")))
    bad += sheet_check(pg, "Sportart ändern", lambda: (go(pg, "#/tour/" + ids["a"], "header.top button[aria-label=Aktionen]"), pg.click("header.top button[aria-label=Aktionen]"), pg.wait_for_selector(".sheet .li"), pg.get_by_text("Sportart ändern").click()))
    bad += sheet_check(pg, "Ziel mit Skiarten", lambda: (go(pg, "#/stats/ziele", "#goaladd"), pg.evaluate("document.querySelector('#goaladd').click()")))
    def fortschritt():
        if pg.evaluate("!!window.__alGo"):      # ein früherer Durchgang hängt noch: freigeben, Zusammenfassung abwarten und schließen
            pg.evaluate("window.__alGo(); window.__alGo = null"); pg.wait_for_selector("#sum"); zu(pg)
        go(pg, "#/start", "#startsync"); pg.evaluate("() => { __al.mode = { zepp: { gate: new Promise(r => { window.__alGo = r; }) } }; document.querySelector('#startsync').click(); }"); pg.wait_for_selector("#prog-stop")
    bad += sheet_check(pg, "Alles abgleichen, Fortschritt", fortschritt)
    pg.evaluate("window.__alGo()"); pg.wait_for_selector("#sum")
    bad += ["Zusammenfassung: " + m for m in pg.evaluate(LAYOUT_JS)]
    zu(pg)
    bad += sheet_check(pg, "Alles abgleichen, Zusammenfassung", lambda: (go(pg, "#/start", "#startsync"), pg.evaluate("() => { __al.mode = {}; document.querySelector('#startsync').click(); }"), pg.wait_for_selector("#sum")))
    bad += sheet_check(pg, "Alles abgleichen, mit Fehlern", lambda: (go(pg, "#/start", "#startsync"), pg.evaluate("() => { __al.mode = { komoot: { err: { message: 'Tourenliste: HTTP 401' } }, mt: { err: { message: 'Die Anmeldung bei Meine Touren ist abgelaufen. Bitte neu anmelden.', relogin: true } } }; document.querySelector('#startsync').click(); }"), pg.wait_for_selector("#sum")))
    pg.evaluate("""async (keep) => { Import.Zepp.importAll = __alReal.z; Import.Komoot.importAll = __alReal.k; Import.MT.importAll = __alReal.m; for (const t of await Tours.list()) if (!keep.includes(t.id)) await Tours.remove(t.id); for (const k of ['mt', 'zepp', 'komoot', 'abgleich']) await DB.del('kv', k); }""", vorher)
    return sorted(set(bad))


def layout_21(pg):
    """Gestaltungsprüfung der Neuerungen aus 2.1.0: Seite „Doppelte Touren“ (mit Paaren und leer), Importseite mit den neuen Zeilen, Tourseite mit den Zahlen aus
    Meine Touren, und die Blätter (Meine Touren: anmelden / verbunden, zweiter Schritt, Fortschritt mit „Abbrechen“, Zepp mit Schalter, Rückfrage beim Zusammenführen)."""
    vorher = pg.evaluate("Tours.list().then(l => l.map(t => t.id))")
    bad = ["leer: " + m for m in layout_check(pg, ["#/doppelt"], widths=((360, 100), (360, 130)))]
    d = pg.evaluate(DUP_DATEN)
    pg.evaluate("async id => { const t = await DB.get('tours', id); Object.assign(t, { mtId: 'g1', zMt: 1, upMt: 655, downMt: 650, distMt: Math.round(t.dist) + 40, starsMt: 4, upSrc: 'mt', up: 655, down: 650, dist: Math.round(t.dist) + 40 }); await Tours.save(t); }", d["K"])
    bad += layout_check(pg, ["#/doppelt", "#/import", "#/tour/" + d["K"]])
    pg.evaluate("location.hash = '#/doppelt'"); pg.wait_for_selector("section.dup .dup-a"); assert pg.locator("section.dup").count() == 2
    pg.evaluate("id => { location.hash = '#/tour/' + id }", d["K"]); pg.wait_for_selector("#mtinfo"); assert "stammen aus Meine Touren" in pg.inner_text("#mtinfo") and "Sternen" not in pg.inner_text("#mtinfo") and pg.locator("#rate .star.on").count() == 4
    def go(h, sel): pg.evaluate("h => { if (location.hash === h) Nav.render(); else location.hash = h; }", h); pg.wait_for_selector(sel); pg.wait_for_timeout(250)
    def mt_login(): go("#/import", "#imp-mt"); pg.evaluate("DB.del('kv', 'mt')"); pg.click("#imp-mt"); pg.wait_for_selector("#mt-url"); pg.fill("#mt-url", "http://touren.example.org"); pg.wait_for_selector("#mt-http:not([hidden])")
    def mt_on(): go("#/import", "#imp-mt"); pg.evaluate("DB.kvSet('mt', { base: 'http://192.168.178.20:8000', name: 'Volker', role: 'admin', token: 'x' })"); pg.click("#imp-mt"); pg.wait_for_selector("#mt-off")
    def zepp(on): go("#/import", "#imp-mt"); pg.evaluate("on => on ? DB.kvSet('zepp', { token: 'x', viaToken: true }) : DB.del('kv', 'zepp')", on); pg.get_by_text("Zepp / Amazfit").click(); pg.wait_for_selector("#zp-ele")
    bad += sheet_check(pg, "Meine Touren, anmelden", mt_login)
    bad += sheet_check(pg, "Meine Touren, verbunden", mt_on)
    bad += sheet_check(pg, "Zweiter Schritt", lambda: (go("#/import", "#imp-mt"), pg.evaluate("() => { askText('Zweiter Schritt', 'Code aus der Authenticator-App', '', 'Anmelden'); }")))
    bad += sheet_check(pg, "Fortschritt mit Abbrechen", lambda: (go("#/import", "#imp-mt"), pg.evaluate("() => { PhotoSources.progress('Meine Touren', upd => new Promise(r => { upd(3, 12, 'Kramerspitz über den Kramersteig'); window.__progEnd = r; }), { cancel: () => {} }); }"), pg.wait_for_selector("#prog-stop")))
    pg.evaluate("window.__progEnd && window.__progEnd()")
    bad += sheet_check(pg, "Zepp, angemeldet", lambda: zepp(True))
    bad += sheet_check(pg, "Zepp, anmelden", lambda: zepp(False))
    bad += sheet_check(pg, "Zusammenführen", lambda: (go("#/doppelt", "section.dup .dup-a"), pg.locator("section.dup button[data-a=merge]").first.click()))
    pg.evaluate("async (keep) => { for (const t of await Tours.list()) if (!keep.includes(t.id)) await Tours.remove(t.id); for (const i of [1, 2]) await DB.del('photos', 'dupfoto' + i); await DB.del('kv', 'dupIgnore'); await DB.del('kv', 'mt'); await DB.del('kv', 'zepp'); }", vorher)
    return sorted(set(bad))


# ---------------------------------------------------------------------------------------------------------------------------------------------------------
# 2.4.0 Wanderführer: Bücher anlegen (mehrere GPX-Dateien, ZIP), Abgleich „folgt der Tour der Buchstrecke“, Karten und Listen, Titelbild, Startseite, Sicherung
# ---------------------------------------------------------------------------------------------------------------------------------------------------------
FU_TITEL = ["Tour 1 · Roque Fantasia", "Tour 2 · Barranco del Sol", "Tour 3 · Pico Nublado", "Tour 4 · Presa de las Rosas", "Tour 5 · Cumbre Azul", "Tour 6 · Playa Escondida", "Tour 7 · Mirador Imaginario", "Tour 10 · Valle Ficticio"]

def fu_kurve(la0, lo0, n, laenge, amp=0.1, ph=0.0, noise=0.0, seed=1):
    import math, random
    rnd = random.Random(seed); k = math.cos(math.radians(la0)); out = []
    for i in range(n):
        t = i / (n - 1); x = laenge * t; y = laenge * amp * math.sin(4 * math.pi * t + ph) + laenge * 0.05 * t
        out.append((la0 + (y + (rnd.random() - .5) * 2 * noise) / 111195, lo0 + (x + (rnd.random() - .5) * 2 * noise) / (111195 * k), 800 + 300 * t))
    return out

def fu_gpx(titel, pts, meta=True):
    inner = "".join(f'<trkpt lat="{la:.6f}" lon="{lo:.6f}"><ele>{e:.1f}</ele></trkpt>' for la, lo, e in pts)
    m = f"<metadata><name>{titel}</name></metadata>" if meta else ""
    return f'<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="Beispiel" xmlns="http://www.topografix.com/GPX/1/1">{m}<trk><name>{titel}</name><trkseg>{inner}</trkseg></trk></gpx>'

def fu_buch_a():
    """Sechs (später acht) Buchtouren eines erfundenen Wanderführers; Ort und Form sind Fantasie."""
    return [fu_kurve(28.0 + 0.05 * k, -15.6, 160, 6000 + k * 1100, amp=0.09 + 0.01 * (k % 3), ph=k * 0.9, seed=10 + k) for k in range(8)]

def fu_cover_png(pfad, titel, farbe, w=900, h=1300):
    """Erfundenes Titelbild (keine Verlagscover): Farbverlauf, Berge, Titel."""
    from PIL import Image, ImageDraw
    im = Image.new("RGB", (w, h)); d = ImageDraw.Draw(im)
    for y in range(h):
        t = y / h; d.line([(0, y), (w, y)], fill=tuple(int(c0 + (c1 - c0) * t) for c0, c1 in zip(farbe[0], farbe[1])))
    d.polygon([(0, h * .72), (w * .25, h * .45), (w * .42, h * .62), (w * .68, h * .36), (w, h * .66), (w, h), (0, h)], fill=farbe[2])
    d.polygon([(0, h * .86), (w * .3, h * .68), (w * .6, h * .82), (w, h * .7), (w, h), (0, h)], fill=farbe[3])
    d.ellipse([w * .66, h * .1, w * .86, h * .1 + w * .2], fill=(250, 235, 170))
    import random; rnd = random.Random(titel)
    for _ in range(30000): x, y = rnd.randrange(w), rnd.randrange(h); d.point((x, y), fill=tuple(min(255, c + rnd.randrange(40)) for c in im.getpixel((x, y))))      # Körnung, damit das Bild nicht winzig ist
    d.rectangle([w * .08, h * .06, w * .92, h * .06 + 8], fill=(255, 255, 255)); d.text((w * .1, h * .08), titel, fill=(255, 255, 255))
    im.save(pfad)
    return open(pfad, "rb").read()

FU_PICK = """fs => { window.__pick = fs.map(([n, b64]) => ({ name: n, url: URL.createObjectURL(new Blob([Uint8Array.from(atob(b64), c => c.charCodeAt(0))])) })); }"""

def fu_pick(pg, dateien):
    import base64
    pg.evaluate(FU_PICK, [[n, base64.b64encode(d if isinstance(d, bytes) else d.encode("utf-8")).decode()] for n, d in dateien])

def fuehrer(pg):
    """2.4.0: Wanderführer. Leerzustand, Buch anlegen (mehrere GPX-Dateien, kaputte Datei, natürliche Reihenfolge, ZIP, Doppelte), Abgleich (Hin- und Rückrichtung,
    mehrere Touren je Buchtour, versteckte und geplante Touren), Karte der Buchtour und „Als Planung übernehmen“, Filter, Suche, Reihenfolge, Titelbild (verkleinert, entfernen),
    Tourseite und Namensvorschlag, Startseite (ruhige Zeile, abschaltbar), Sicherung (hin und zurück, alte Sicherung), Bedienbarkeit bei vielen Touren, Gestaltung."""
    import base64, io, os, zipfile, json as _json
    bad = []
    shots = os.environ.get("FUEHRER_SHOTS")
    if shots: os.makedirs(shots, exist_ok=True)
    def shot(name):
        if not shots: return
        pg.wait_for_function(LEISE, timeout=30000)      # alte Meldung abwarten, damit sie nicht im Bild steht
        if name == "6-start": pg.evaluate("document.querySelector('#fuehrer-home').scrollIntoView({ block: 'center' })")
        for sch in ("light", "dark"):
            pg.emulate_media(color_scheme=sch); pg.wait_for_timeout(250)
            pg.screenshot(path=os.path.join(shots, f"{name}-{'hell' if sch == 'light' else 'dunkel'}.png"))
        pg.emulate_media(color_scheme="light"); pg.wait_for_timeout(150)
    leise = lambda: pg.wait_for_function(LEISE, timeout=30000)
    vorher = pg.evaluate("Tours.list().then(l => l.map(t => t.id))")
    pg.evaluate("async () => { for (const k of ['guides', 'guideMatch']) await DB.del('kv', k); }")
    sync_fertig = lambda: pg.wait_for_function("() => !Buecher._run && document.querySelector('#fu-sync') && document.querySelector('#fu-sync').hidden", timeout=60000)

    # --- 1. Leerzustand; Zugang über Mehr ---
    go(pg, "#/mehr", "#m-fuehrer"); assert "Wanderführer" in pg.inner_text("#m-fuehrer") and pg.locator("#m-fuehrer").get_attribute("href") == "#/fuehrer"
    pg.click("#m-fuehrer"); pg.wait_for_selector("#fu-add2")
    assert pg.evaluate("Nav.cur") == "/fuehrer" and pg.locator("#tabs a[aria-current=page]").get_attribute("data-p") == "/mehr", "Wanderführer gehört unter Mehr"
    tx = pg.inner_text("#fuehrer"); assert "Noch kein Wanderführer" in tx and "GPX-Dateien" in tx, tx
    assert pg.locator("#fu-q").count() == 0 and pg.locator(".fu-book").count() == 0, "ohne Buch keine Suche und keine Filter"
    go(pg, "#/start", "#hero"); pg.wait_for_timeout(300); assert pg.locator("#fuehrer-home").count() == 0, "ohne Buch keine Zeile auf der Startseite"
    go(pg, "#/fuehrer", "#fu-add2"); shot("4-leer")
    bad += ["Leerzustand: " + m for m in layout_check(pg, ["#/fuehrer"], widths=((360, 100), (360, 130)))]

    # --- 2. Touren im Tagebuch, die Buchstrecken folgen ---
    A = fu_buch_a(); T = lambda pts, t0, name, rev=False: [name, [list(p) for p in (pts[::-1] if rev else pts)], t0]
    t1 = 1747000000000; day = 86400000
    ids = pg.evaluate("""async (ts) => { const o = {}; for (const [k, name, pts, t0] of ts) { o[k] = (await Tours.add({ name, sport: 'hike', src: 'file', pts: pts.map((p, i) => ({ lat: p[0], lon: p[1], ele: p[2], t: t0 + i * 20000 })) })).tour.id; } return o; }""", [
        ["a1", "Roque-Runde (alt)", fu_kurve(28.0, -15.6, 700, 6000, amp=0.09, ph=0, noise=7, seed=1)[::1], t1],
        ["a2", "Roque-Runde (neu)", fu_kurve(28.0, -15.6, 500, 6000, amp=0.09, ph=0, noise=9, seed=2), t1 + 200 * day],
        ["b", "Rückweg Nublado", fu_kurve(28.1, -15.6, 600, 8200, amp=0.11, ph=1.8, noise=6, seed=3)[::-1], t1 + 90 * day],
        ["fern", "Ganz woanders", fu_kurve(40.0, -3.7, 300, 7000, seed=4), t1 + 5 * day]])
    assert ids["a1"] and ids["b"]

    # --- 3. Buch anlegen: Name nötig; sechs Dateien in wirrer Reihenfolge, eine kaputte ---
    dateien = [("T3.gpx", fu_gpx(FU_TITEL[2], A[2])), ("T1.gpx", fu_gpx(FU_TITEL[0], A[0])), ("kaputt.gpx", "das ist keine GPX-Datei"), ("T6.gpx", fu_gpx(FU_TITEL[5], A[5], meta=False)),
               ("T2.gpx", fu_gpx(FU_TITEL[1], A[1])), ("T5.gpx", fu_gpx(FU_TITEL[4], A[4])), ("T4.gpx", fu_gpx(FU_TITEL[3], A[3]))]
    pg.click("#fu-add2" if pg.locator("#fu-add2").count() else "#fu-add"); pg.wait_for_selector("#fu-go")
    bad += sheet_check_open(pg, "Buch anlegen")
    pg.click("#fu-go"); pg.wait_for_selector("#fu-err:not(:empty)"); assert "Name" in pg.inner_text("#fu-err"), "ohne Namen wird nichts angelegt"
    assert pg.evaluate("DB.kvGet('guides', null)") is None
    fu_pick(pg, dateien)
    pg.fill("#fu-name", "Rother Wanderführer Fantasia Süd"); leise(); pg.click("#fu-go")
    tx = toast_text(pg, "angelegt"); assert tx.startswith("6 Buchtouren angelegt") and "1 nicht lesbar (kaputt.gpx)" in tx, tx
    pg.wait_for_selector(".fu-book"); sync_fertig()
    b = pg.evaluate("Buecher.liste()"); assert len(b) == 1 and b[0]["name"] == "Rother Wanderführer Fantasia Süd" and len(b[0]["touren"]) == 6, b
    assert [t["title"] for t in b[0]["touren"]] == FU_TITEL[:6], "Reihenfolge wie im Buch (T1 … T6), nicht wie ausgewählt"
    t0m = b[0]["touren"][0]; assert t0m["f"] == "T1.gpx" and 7 < t0m["km"] < 8 and t0m["up"] and t0m["la"] and t0m["n"] == 160 and len(t0m["bb"]) == 4, t0m
    bid = b[0]["id"]
    assert pg.evaluate("id => DB.kvGet('guidepts:' + id, null).then(o => Object.keys(o).length)", bid) == 6
    # --- 4. Abgleich: zwei Touren auf Buchtour 1 (die jüngste zählt), Rückweg auf Tour 3, fern: nichts ---
    assert "1 Buch · 2 von 6 Buchtouren gewandert" in pg.inner_text("#fu-sum"), pg.inner_text("#fu-sum")
    card = pg.locator(f".fu-book[data-id='{bid}']"); assert card.locator(".fu-name").inner_text() == "Rother Wanderführer Fantasia Süd" and "2 von 6 gewandert" in card.locator(".fu-sub").inner_text()
    ring = card.locator("svg.fu-ring"); assert ring.get_attribute("role") == "img" and ring.get_attribute("aria-label") == "2 von 6 gewandert, 33 Prozent" and "33 %" in ring.text_content(), ring.get_attribute("aria-label")
    assert card.locator(".fu-head").get_attribute("aria-expanded") == "true", "das neue Buch ist aufgeklappt"
    rows = card.locator(".fu-t"); assert rows.count() == 6
    assert [x.strip() for x in card.locator(".fu-t .li-t b").all_inner_texts()] == FU_TITEL[:6]
    done = card.locator("a.fu-t.done"); assert done.count() == 2 and card.locator("button.fu-t.open").count() == 4, (done.count(), card.locator("button.fu-t.open").count(), card.inner_text())
    d2 = pg.evaluate("ms => Buecher.datum(ms)", t1 + 200 * day)
    r0 = card.locator(".fu-t").nth(0); assert "done" in r0.get_attribute("class") and r0.get_attribute("href") == "#/tour/" + ids["a2"], "die jüngste Tour zählt"
    assert f"gewandert am {d2}" in r0.inner_text() and "+1 weitere" in r0.inner_text() and "km" in r0.inner_text() and "↑" in r0.inner_text(), r0.inner_text()
    r2 = card.locator(".fu-t").nth(2); assert r2.get_attribute("href") == "#/tour/" + ids["b"] and "weitere" not in r2.inner_text(), "Gegenrichtung zählt"
    r1 = card.locator(".fu-t").nth(1); assert "open" in r1.get_attribute("class") and "offen · " in r1.inner_text() and "km" in r1.inner_text() and "↑" in r1.inner_text(), r1.inner_text()
    assert pg.evaluate("Buecher.stand().then(s => s.fehlendePaare)") == 0, "alles gerechnet und im Zwischenspeicher"
    # Zwischenspeicher: keine Wiederholung beim erneuten Öffnen (es werden keine Spuren geladen)
    pg.evaluate("() => { window.__geladen = 0; const o = DB.get; DB.get = function (s, k) { if (s === 'tracks') window.__geladen++; return o.apply(DB, arguments); }; window.__dbget = o; }")
    go(pg, "#/mehr", "#m-fuehrer"); go(pg, "#/fuehrer", ".fu-book"); sync_fertig(); pg.wait_for_timeout(300)
    assert pg.evaluate("window.__geladen") == 0, "nur geändertes oder Neues wird neu gerechnet"
    pg.evaluate("() => { DB.get = window.__dbget; }")
    # --- 5. Ein- und Ausklappen ---
    card.locator(".fu-head").click(); pg.wait_for_selector(f".fu-book[data-id='{bid}'] .fu-t", state="detached"); assert pg.locator(f".fu-book[data-id='{bid}'] .fu-head").get_attribute("aria-expanded") == "false"
    assert "2 von 6 gewandert" in pg.inner_text(f".fu-book[data-id='{bid}']"), "Zahl und Ring bleiben eingeklappt sichtbar"
    pg.locator(f".fu-book[data-id='{bid}'] .fu-head").click(); pg.wait_for_selector(f".fu-book[data-id='{bid}'] .fu-t"); assert pg.locator(f".fu-book[data-id='{bid}'] .fu-t").count() == 6

    # --- 6. Zwei weitere Bücher (Programmschnittstelle), eines mit einer folgenden Tour ---
    B = [fu_kurve(28.4 + 0.03 * k, -15.9, 120, 4000 + 900 * k, ph=k, seed=30 + k) for k in range(4)]
    C = [fu_kurve(47.6 + 0.02 * k, 10.3, 120, 7000 - 800 * k, ph=k * 1.3, seed=50 + k) for k in range(3)]      # absteigend lang: Buchreihenfolge und Länge sind verschieden
    pg.evaluate("""async ([b, c]) => { const mk = ts => ({ ok: ts.map(([n, text]) => ({ name: n, text })), bad: [] });
      await Buecher.speichere(null, 'Wanderführer Fantasia Nord', mk(b)); await Buecher.speichere(null, 'Allgäu Fantasie', mk(c)); }""", [
        [[f"N{k + 1}.gpx", fu_gpx(f"Nord {k + 1} · Fantasiegipfel {k + 1}", B[k])] for k in range(4)], [[f"C{k + 1}.gpx", fu_gpx(f"Allgäu {k + 1} · Wiesenpfad {k + 1}", C[k])] for k in range(3)]])
    idE = pg.evaluate("""async (pts) => (await Tours.add({ name: 'Allgäu-Runde', sport: 'hike', src: 'file', pts: pts.map((p, i) => ({ lat: p[0], lon: p[1], ele: p[2], t: 1750000000000 + i * 20000 })) })).tour.id""", [list(p) for p in fu_kurve(47.62, 10.3, 400, 6200, ph=1.3, noise=8, seed=61)])
    go(pg, "#/fuehrer", ".fu-book"); sync_fertig(); pg.wait_for_function("document.querySelectorAll('.fu-book').length === 3")
    assert "3 Bücher · 3 von 13 Buchtouren gewandert" in pg.inner_text("#fu-sum"), pg.inner_text("#fu-sum")
    names = pg.locator(".fu-name").all_inner_texts(); assert names == ["Rother Wanderführer Fantasia Süd", "Wanderführer Fantasia Nord", "Allgäu Fantasie"], names
    # --- 7. Filter, Suche, Reihenfolge ---
    pg.evaluate("Buecher.ui.offen.clear()"); go(pg, "#/fuehrer", ".fu-book"); sync_fertig()
    assert pg.locator(".fu-t").count() == 0, "alle eingeklappt: keine Zeilen"
    pg.click("#fu-f-offen"); assert pg.locator("#fu-f-offen").get_attribute("aria-pressed") == "true" and pg.locator(".fu-book").count() == 3
    pg.locator(".fu-book[data-id='%s'] .fu-head" % bid).click(); assert pg.locator("a.fu-t.done").count() == 0 and pg.locator("button.fu-t.open").count() == 4, "Filter „Offen“ zeigt nur offene Buchtouren"
    assert "2 von 6 gewandert" in pg.inner_text(f".fu-book[data-id='{bid}'] .fu-sub"), "die Zahlen gelten weiter für das ganze Buch"
    shot("3-filter-offen"); bad += ["Filter Offen: " + m for m in layout_check(pg, ["#/fuehrer"], widths=((360, 100), (360, 130)))]
    pg.click("#fu-f-gewandert"); assert pg.locator("button.fu-t.open").count() == 0 and pg.locator("a.fu-t.done").count() == 2 and pg.locator(".fu-book").count() == 2, "Bücher ohne gewanderte Tour entfallen"
    pg.click("#fu-f-alle"); assert pg.locator(".fu-book").count() == 3 and pg.locator(".fu-t").count() == 6
    pg.fill("#fu-q", "nublado"); assert pg.locator(".fu-book").count() == 1 and pg.locator(".fu-t").count() == 1 and "Pico Nublado" in pg.inner_text(".fu-t"), "Suche über alle Bücher, Treffer klappen auf"
    pg.fill("#fu-q", "FANTASIA NORD"); assert pg.locator(".fu-book").count() == 1 and pg.locator(".fu-t").count() == 4 and pg.locator(".fu-name").inner_text() == "Wanderführer Fantasia Nord", "Buchname trifft: alle Touren des Buchs"
    pg.fill("#fu-q", "gibtesnicht"); pg.wait_for_selector("#fu-leer"); assert "Nichts gefunden" in pg.inner_text("#fu-leer")
    pg.fill("#fu-q", "wiese"); assert pg.locator(".fu-t").count() == 3
    pg.fill("#fu-q", "Allgäu"); assert [x.split(" · ")[0] for x in pg.locator(".fu-t .li-t b").all_inner_texts()] == ["Allgäu 1", "Allgäu 2", "Allgäu 3"], "Buchreihenfolge"
    pg.locator("#fu-ctl .seg button", has_text="Nach Länge").click(); assert pg.locator("#fu-ctl .seg button.on").inner_text() == "Nach Länge"
    assert [x.split(" · ")[0] for x in pg.locator(".fu-t .li-t b").all_inner_texts()] == ["Allgäu 3", "Allgäu 2", "Allgäu 1"], "nach Länge: kürzeste zuerst"
    pg.locator("#fu-ctl .seg button", has_text="Buchreihenfolge").click(); assert [x.split(" · ")[0] for x in pg.locator(".fu-t .li-t b").all_inner_texts()][0] == "Allgäu 1"
    pg.fill("#fu-q", "")
    pg.evaluate("id => { Buecher.ui.offen.clear(); Buecher.ui.offen.add(id); }", bid); go(pg, "#/fuehrer", ".fu-t"); sync_fertig()

    # --- 8. Mehr Dateien dazu: ZIP, natürliche Reihenfolge (7 vor 10), Doppelte ---
    zb = io.BytesIO()
    with zipfile.ZipFile(zb, "w") as z:
        z.writestr("Buch/T10.gpx", fu_gpx(FU_TITEL[7], A[7])); z.writestr("Buch/T7.gpx", fu_gpx(FU_TITEL[6], A[6])); z.writestr("Buch/doppelt.gpx", fu_gpx(FU_TITEL[0], A[0])); z.writestr("__MACOSX/._T7.gpx", "x"); z.writestr("Buch/liesmich.txt", "x")
    fu_pick(pg, [("Nachtrag.zip", zb.getvalue())])
    pg.locator(f".fu-book[data-id='{bid}'] [data-a=manage]").click(); pg.wait_for_selector("#fu-m-add"); pg.click("#fu-m-add"); pg.wait_for_selector("#fu-go"); assert pg.locator("#fu-name").count() == 0, "beim Ergänzen kein Namensfeld"
    leise(); pg.click("#fu-go"); tx = toast_text(pg, "hinzugefügt"); assert tx.startswith("2 Buchtouren hinzugefügt") and "1 schon vorhanden" in tx, tx
    pg.wait_for_function("(id) => Buecher.liste().then(l => l.find(b => b.id === id).touren.length === 8)", arg=bid); sync_fertig()
    assert [t["title"] for t in pg.evaluate("id => Buecher.liste().then(l => l.find(b => b.id === id).touren)", bid)] == FU_TITEL, "Tour 7 steht vor Tour 10"
    assert "2 von 8 gewandert" in pg.inner_text(f".fu-book[data-id='{bid}'] .fu-sub")
    pg.evaluate("Buecher.ui.sort = 'buch'"); go(pg, "#/fuehrer", ".fu-book"); sync_fertig()

    # --- 9. Karte der Buchtour, „Als Planung übernehmen“ ---
    pg.locator(f".fu-book[data-id='{bid}'] button.fu-t.open").first.click(); pg.wait_for_selector("#fu-plan"); pg.wait_for_selector("#fu-map .leaflet-container, #fu-map.leaflet-container")
    pg.wait_for_function("""() => { const c = document.querySelector('#fu-map canvas'); if (!c || !c.width) return false; const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) return true; return false; }""", timeout=8000)      # die Strecke ist auf die Karte gezeichnet
    tx = pg.inner_text(".sheet"); assert "Aus dem Buch: Rother Wanderführer Fantasia Süd" in tx and "Länge" in tx and "Aufstieg" in tx, tx
    shot("7-karte"); zu(pg)
    bad += sheet_check(pg, "Buchtour, Karte", lambda: pg.locator(f".fu-book[data-id='{bid}'] button.fu-t.open").first.click())
    pg.locator(f".fu-book[data-id='{bid}'] button.fu-t.open").first.click(); pg.wait_for_selector("#fu-plan")
    npl = pg.evaluate("Tours.list().then(l => l.length)"); leise(); pg.click("#fu-plan"); pg.wait_for_function("location.hash.startsWith('#/tour/')"); pg.wait_for_selector(".banner:has-text('Geplante Tour')")
    pid = pg.evaluate("location.hash.split('/')[2]"); pl = pg.evaluate("id => DB.get('tours', id)", pid)
    assert pl["status"] == "planned" and pl["name"] == FU_TITEL[1] and pl["dist"] > 6000 and pl["up"] > 100, pl
    assert pg.evaluate("id => PlanMeta.get(id)", pid)["quelle"] == {"art": "fuehrer", "text": "Rother Wanderführer Fantasia Süd – " + FU_TITEL[1]}
    assert pg.evaluate("Tours.list().then(l => l.length)") == npl + 1
    pg.evaluate("id => Tours.remove(id)", pid)
    go(pg, "#/fuehrer", ".fu-book"); sync_fertig(); assert "2 von 8 gewandert" in pg.inner_text(f".fu-book[data-id='{bid}'] .fu-sub"), "eine Planung zählt nicht als gewandert"

    # --- 10. Tourseite und Namensvorschlag ---
    go(pg, "#/tour/" + ids["a2"], "#imbuch"); assert pg.inner_text("#imbuch") == "Aus dem Buch: " + FU_TITEL[0] + " (Rother Wanderführer Fantasia Süd)", pg.inner_text("#imbuch")
    go(pg, "#/tour/" + ids["fern"], ".tourp"); pg.wait_for_timeout(300); assert pg.locator("#imbuch").count() == 0, "Tour ohne Buch: keine Zeile"
    go(pg, "#/tour/" + ids["a2"], "#imbuch"); pg.click("header.top button[aria-label=Aktionen]"); pg.get_by_text("Namensvorschläge").click(); pg.wait_for_selector("[data-buch]")
    assert "Aus dem Buch: Rother Wanderführer Fantasia Süd" in pg.inner_text("[data-buch]") and FU_TITEL[0] in pg.inner_text("[data-buch]")
    pg.click("[data-buch]"); pg.wait_for_function("(id) => DB.get('tours', id).then(t => t.name === 'Tour 1 · Roque Fantasia')", arg=ids["a2"])

    # --- 11. Änderungen: neue Tour folgt Tour 7; verstecken, geplant, löschen ---
    pg.evaluate("""async (pts) => { await Tours.add({ name: 'Mirador-Tag', sport: 'hike', src: 'file', pts: pts.map((p, i) => ({ lat: p[0], lon: p[1], ele: p[2], t: 1755000000000 + i * 20000 })) }); }""", [list(p) for p in fu_kurve(28.0 + 0.05 * 6, -15.6, 500, 6000 + 6 * 1100, amp=0.09, ph=6 * 0.9, noise=7, seed=71)])
    go(pg, "#/fuehrer", ".fu-book"); sync_fertig(); assert "3 von 8 gewandert" in pg.inner_text(f".fu-book[data-id='{bid}'] .fu-sub"), pg.inner_text(f".fu-book[data-id='{bid}'] .fu-sub")
    pg.evaluate("async ([a, b]) => { for (const id of [a, b]) { const t = await DB.get('tours', id); t.hidden = true; await Tours.save(t); } }", [ids["a1"], ids["a2"]])
    go(pg, "#/fuehrer", ".fu-book"); sync_fertig(); assert "2 von 8 gewandert" in pg.inner_text(f".fu-book[data-id='{bid}'] .fu-sub"), "versteckte Touren zählen nicht"
    pg.evaluate("async ([a, b]) => { const t = await DB.get('tours', a); t.hidden = false; await Tours.save(t); const u = await DB.get('tours', b); u.status = 'planned'; await Tours.save(u); }", [ids["a1"], ids["a2"]])
    go(pg, "#/fuehrer", ".fu-book"); sync_fertig(); r0 = pg.locator(f".fu-book[data-id='{bid}'] .fu-t").nth(0)
    assert "done" in r0.get_attribute("class") and r0.get_attribute("href") == "#/tour/" + ids["a1"] and "weitere" not in r0.inner_text(), "geplante Touren zählen nicht, die ältere Tour zählt wieder"
    pg.evaluate("async (a) => { const t = await DB.get('tours', a); t.status = 'done'; await Tours.save(t); }", ids["a2"])

    # --- 12. Titelbild ---
    sd = shots or "/tmp"
    cov = fu_cover_png(os.path.join(sd, "titelbild-test-1.png"), "FANTASIA SUED", [(30, 90, 120), (240, 170, 90), (30, 60, 50), (15, 35, 30)])
    cov2 = fu_cover_png(os.path.join(sd, "titelbild-test-2.png"), "FANTASIA NORD", [(70, 40, 100), (230, 120, 110), (50, 30, 60), (25, 15, 35)])
    assert len(cov) > 20000
    pg.evaluate("id => { Buecher.ui.offen.add(id); }", bid); go(pg, "#/fuehrer", ".fu-t"); sync_fertig()
    assert pg.locator(f".fu-book[data-id='{bid}'] .fu-cov img").count() == 0, "noch kein Titelbild"
    assert pg.locator(f".fu-book[data-id='{bid}'] .fu-cov svg").count() == 1, "ohne Titelbild: Buch-Symbol als Platzhalter"
    fu_pick(pg, [("titel.png", cov)]); pg.locator(f".fu-book[data-id='{bid}'] [data-a=cover]").click(); toast_text(pg, "Titelbild gespeichert")
    pg.wait_for_selector(f".fu-book[data-id='{bid}'] .fu-cov img")
    ci = pg.evaluate("""id => DB.kvGet('guidecover:' + id, null).then(d => new Promise(ok => { const im = new Image(); im.onload = () => ok({ w: im.naturalWidth, h: im.naturalHeight, len: d.length, jpg: d.startsWith('data:image/jpeg') }); im.src = d; }))""", bid)
    assert ci["jpg"] and max(ci["w"], ci["h"]) == 400 and ci["w"] < ci["h"] and ci["len"] < 90000, f"auf 400 px Kante verkleinert, kleines JPEG: {ci}"
    assert pg.evaluate("id => Buecher.liste().then(l => l.find(b => b.id === id).cover)", bid) == 1
    assert "Titelbild ändern" in pg.inner_text(f".fu-book[data-id='{bid}'] [data-a=cover]")
    # Nord: zweites Titelbild; Allgäu bleibt beim Platzhalter
    nid = pg.evaluate("Buecher.liste().then(l => l.find(b => b.name.includes('Nord')).id)"); pg.evaluate("id => Buecher.ui.offen.add(id)", nid); go(pg, "#/fuehrer", ".fu-book"); sync_fertig()
    fu_pick(pg, [("nord.png", cov2)]); leise(); pg.locator(f".fu-book[data-id='{nid}'] [data-a=cover]").click(); toast_text(pg, "Titelbild gespeichert"); pg.wait_for_selector(f".fu-book[data-id='{nid}'] .fu-cov img")
    # kein Bild gewählt (Abbruch) und ein Nicht-Bild
    fu_pick(pg, []); pg.locator(f".fu-book[data-id='{nid}'] [data-a=cover]").click(); pg.wait_for_timeout(300); assert pg.locator(f".fu-book[data-id='{nid}'] .fu-cov img").count() == 1, "Abbruch ändert nichts"
    fu_pick(pg, [("kaputt.png", "kein Bild")]); leise(); pg.locator(f".fu-book[data-id='{nid}'] [data-a=cover]").click(); assert "lässt sich nicht lesen" in toast_text(pg, "nicht lesen")
    assert pg.locator(f".fu-book[data-id='{nid}'] .fu-cov img").count() == 1, "ein unlesbares Bild lässt das alte stehen"
    shot("1-titelbilder")
    # Verwalten, Titelbild entfernen (Nord), Menü prüfen
    pg.locator(f".fu-book[data-id='{nid}'] [data-a=manage]").click(); pg.wait_for_selector("#fu-m-covdel"); assert pg.locator("#fu-m-ren").count() == 1 and pg.locator("#fu-m-add").count() == 1 and pg.locator("#fu-m-del").count() == 1
    shot("5-verwalten"); pg.click("#fu-m-covdel"); pg.wait_for_selector(f".fu-book[data-id='{nid}'] .fu-cov svg"); assert pg.evaluate("id => DB.kvGet('guidecover:' + id, null)", nid) is None
    bad += sheet_check(pg, "Buch verwalten", lambda: (go(pg, "#/fuehrer", ".fu-book"), pg.locator(f".fu-book[data-id='{bid}'] [data-a=manage]").click()))
    # Umbenennen
    pg.locator(f".fu-book[data-id='{nid}'] [data-a=manage]").click(); pg.click("#fu-m-ren"); pg.wait_for_selector(".sheet input"); pg.fill(".sheet input", "Fantasia Nord (2. Auflage)"); pg.get_by_role("button", name="Speichern", exact=True).click()
    pg.wait_for_function("() => [...document.querySelectorAll('.fu-name')].some(e => e.textContent === 'Fantasia Nord (2. Auflage)')")

    # --- 13. Startseite: ruhige Zeile, abschaltbar ---
    go(pg, "#/start", "#fuehrer-home-row"); tx = pg.inner_text("#fuehrer-home-row"); assert "Wanderführer: 4 von 15 gewandert" in tx and "3 Bücher" in tx, tx
    assert pg.evaluate("document.querySelector('#fuehrer-home-row').getAttribute('href')") == "#/fuehrer"
    shot("6-start")
    go(pg, "#/settings", "#homeset"); assert "Wanderführer" in pg.inner_text("#homeset")
    pg.locator("#homeset .sw", has_text="Wanderführer").click(); pg.wait_for_function("(Set_.get('homeShow') || {}).fuehrer === false")
    go(pg, "#/start", "#hero"); pg.wait_for_timeout(300); assert pg.locator("#fuehrer-home").count() == 0, "abgeschaltet: keine Zeile"
    pg.evaluate("Set_.set('homeShow', {})"); go(pg, "#/start", "#fuehrer-home-row")
    bad += ["Startseite mit Wanderführer: " + m for m in layout_check(pg, ["#/start"], widths=((360, 100), (360, 130)))]

    # --- 14. Sicherung: Bücher samt Titelbild hin und zurück; alte Sicherung ohne Bücher ---
    r = pg.evaluate("""async () => {
      const data = await Backup.collect(), keys = data.kv.map(k => k.k), json = JSON.stringify(data), gz = fflate.gzipSync(new TextEncoder().encode(json));
      const before = await Buecher.liste(), covBefore = await Buecher.cover(before[0].id), nPts = Object.keys(await Buecher.punkte(before[0].id)).length;
      for (const b of before) await Buecher.entferne(b.id);
      const gone = (await Buecher.liste()).length + (await DB.all('kv')).filter(k => k.k.startsWith('guidepts:') || k.k.startsWith('guidecover:')).length;
      await Backup.apply(Backup.parse(gz));
      Buecher.coverMem = {};
      const after = await Buecher.liste(), covAfter = await Buecher.cover(before[0].id), nPts2 = Object.keys(await Buecher.punkte(before[0].id)).length;
      await Backup.apply(Backup.parse(gz));      // zweimal einspielen: keine Doppelten
      const again = (await Buecher.liste()).length;
      const alt = { app: 'tourentagebuch', v: 1, date: Date.now(), tours: data.tours, tracks: data.tracks, photos: [] };      // alte Sicherung ohne kv und ohne Bücher
      await Backup.apply(Backup.parse(fflate.gzipSync(new TextEncoder().encode(JSON.stringify(alt)))));
      const nachAlt = (await Buecher.liste()).length;
      const alt2 = Object.assign({}, data, { kv: data.kv.filter(k => !/^guide/.test(k.k)) });
      for (const b of await Buecher.liste()) await Buecher.entferne(b.id);
      await Backup.apply(Backup.parse(fflate.gzipSync(new TextEncoder().encode(JSON.stringify(alt2)))));
      const ohneBuecher = (await Buecher.liste()).length;
      await Backup.apply(Backup.parse(gz));
      return { keys, raw: json.length, gz: gz.length, n: before.length, names: before.map(b => b.name), gone, after: after.map(b => b.name), covSame: !!covBefore && covBefore === covAfter, nPts, nPts2, again, nachAlt, ohneBuecher, finalN: (await Buecher.liste()).length };
    }""")
    assert "guides" in r["keys"] and any(k.startswith("guidepts:") for k in r["keys"]) and any(k.startswith("guidecover:") for k in r["keys"]) and "guideMatch" not in r["keys"], r["keys"]
    assert r["n"] == 3 and r["gone"] == 0 and r["after"] == r["names"] and r["covSame"] and r["nPts"] == r["nPts2"] == 8 and r["again"] == 3, r
    assert r["nachAlt"] == 3 and r["ohneBuecher"] == 0 and r["finalN"] == 3, ("alte Sicherungen ohne Bücher laden und lassen vorhandene Bücher in Ruhe", r)
    ncov = sum(1 for k in r["keys"] if k.startswith("guidecover:"))
    print(f"  Sicherung mit 3 Büchern (15 Buchtouren, {ncov} Titelbild): {r['raw'] // 1024} KB unkomprimiert, {r['gz'] // 1024} KB gepackt (alle Touren des Tests eingeschlossen)")
    pg.evaluate("Buecher.coverMem = {}"); go(pg, "#/fuehrer", ".fu-book"); sync_fertig(); assert pg.locator(".fu-book .fu-cov img").count() >= 1 and "4 von 15" in pg.inner_text("#fu-sum"), "nach dem Einspielen ist alles wieder da (Abgleich neu gerechnet)"

    # --- 15. Bedienbarkeit bei vielen Touren: 300 Touren × 100 Buchtouren im selben Gebiet; die Seite darf nie lange stehen ---
    m = pg.evaluate("""async () => {
      const la0 = 20.0, lo0 = 100.0, M = 111195, k = Math.cos(la0 * Math.PI / 180), cur = (L, np, ph, dy, dx) => Array.from({ length: np }, (_, i) => { const t = i / (np - 1); return { lat: la0 + (L * 0.12 * Math.sin(4 * Math.PI * t + ph) + L * 0.05 * t + dy) / M, lon: lo0 + (L * t + dx) / (M * k), ele: 500 + 200 * t }; });
      const touren = [], tracks = [], ids = [];
      for (let i = 0; i < 300; i++) { const p = cur(5000 + (i % 40) * 150, 1200, (i % 17) * 0.4, (i % 7) * 500, (i % 5) * 700), id = 'last' + i; ids.push(id);
        touren.push({ id, name: 'Last ' + i, sport: 'hike', status: 'done', hidden: false, start: 1600000000000 + i * 86400000, dist: 6000, bbox: Fuehrer.umrandung(p) });
        tracks.push({ id, lat: p.map(q => q.lat), lon: p.map(q => q.lon), ele: p.map(q => q.ele), t: p.map(() => null), seg: p.map(() => 0) }); }
      await DB.putMany('tours', touren); await DB.putMany('tracks', tracks); Tours.invalidate();
      const bts = []; for (let i = 0; i < 100; i++) bts.push(Fuehrer.buchtour({ titel: 'Last ' + i, km: 6, up: 100, pts: cur(5000 + (i % 40) * 150, 300, (i % 17) * 0.4, (i % 7) * 500, (i % 5) * 700) }, i, 'l' + i + '.gpx'));
      const bk = { id: 'lastbuch', name: 'Lastbuch', created: 1, next: 100, cover: 0, touren: bts.map(b => b.meta) };
      await DB.kvSet('guidepts:lastbuch', Object.fromEntries(bts.map(b => [b.meta.id, Fuehrer.packe(b.pts)])));
      await Buecher.aendere(l => { l.push(bk); return l; });
      let max = 0, last = performance.now(); const iv = setInterval(() => { const n = performance.now(); max = Math.max(max, n - last); last = n; }, 10);
      const t0 = performance.now(), st = await Buecher.sync(); const ms = performance.now() - t0; clearInterval(iv);
      const s2 = performance.now(), st2 = await Buecher.sync(); const ms2 = performance.now() - s2;
      const done = st.buecher.lastbuch.fertig;
      await Buecher.entferne('lastbuch'); for (const id of ids) { await DB.del('tours', id); await DB.del('tracks', id); } Tours.invalidate();
      return { ms: Math.round(ms), max: Math.round(max), ms2: Math.round(ms2), done, fehlt: st.fehlendePaare, fehlt2: st2.fehlendePaare }; }""")
    print(f"  Last (300 Touren × 100 Buchtouren, alle im selben Gebiet): {m['ms']} ms gesamt, längste Sperre der Seite {m['max']} ms, zweiter Lauf {m['ms2']} ms, {m['done']} von 100 gewandert")
    assert m["fehlt"] == 0 and m["fehlt2"] == 0 and m["done"] == 100 and m["max"] < 400 and m["ms2"] < 1500, m

    # --- 16. Gestaltung: Seite mit Büchern (zu, offen, mit Titelbild), Blätter ---
    pg.evaluate("Buecher.ui.offen.clear(); Buecher.ui.filter = 'alle'; Buecher.ui.suche = ''; Buecher.ui.sort = 'buch'"); go(pg, "#/fuehrer", ".fu-book"); sync_fertig()
    shot("2-eingeklappt")
    bad += ["Bücher zugeklappt: " + m_ for m_ in layout_check(pg, ["#/fuehrer"])]
    pg.evaluate("id => Buecher.ui.offen.add(id)", bid); go(pg, "#/fuehrer", ".fu-t"); sync_fertig(); shot("2-aufgeklappt")
    bad += ["Buch aufgeklappt: " + m_ for m_ in layout_check(pg, ["#/fuehrer"])]
    pg.evaluate("Buecher.ui.suche = 'Allgäu'"); go(pg, "#/fuehrer", ".fu-t"); bad += ["Suche: " + m_ for m_ in layout_check(pg, ["#/fuehrer"], widths=((360, 100), (360, 130)))]
    pg.evaluate("Buecher.ui.suche = ''; Buecher.ui.filter = 'offen'"); go(pg, "#/fuehrer", ".fu-t"); bad += ["Filter offen: " + m_ for m_ in layout_check(pg, ["#/fuehrer"], widths=((360, 100), (360, 130)))]
    pg.evaluate("Buecher.ui.filter = 'alle'"); go(pg, "#/tour/" + ids["a1"], "#imbuch"); bad += ["Tourseite mit Buchzeile: " + m_ for m_ in layout_check(pg, ["#/tour/" + ids["a1"]], widths=((360, 100), (360, 130)))]
    go(pg, "#/fuehrer", ".fu-t")
    # --- 17. Buch entfernen (mit Rückfrage), Aufräumen ---
    pg.locator(f".fu-book[data-id='{nid}'] .fu-head").click(); pg.locator(f".fu-book[data-id='{nid}'] [data-a=manage]").click(); pg.click("#fu-m-del"); pg.wait_for_selector(".sheet[aria-label='Buch entfernen?']")
    assert "Deine Touren bleiben unverändert" in pg.inner_text(".sheet[aria-label='Buch entfernen?']"); pg.get_by_role("button", name="Abbrechen").click(); pg.wait_for_selector(".sheet", state="detached"); assert len(pg.evaluate("Buecher.liste()")) == 3
    pg.locator(f".fu-book[data-id='{nid}'] [data-a=manage]").click(); pg.click("#fu-m-del"); pg.wait_for_selector(".sheet[aria-label='Buch entfernen?']"); pg.get_by_role("button", name="Entfernen", exact=True).click(); pg.wait_for_function("document.querySelectorAll('.fu-book').length === 2")
    assert pg.evaluate("id => DB.kvGet('guidepts:' + id, null)", nid) is None and pg.evaluate("id => DB.kvGet('guidecover:' + id, null)", nid) is None
    for k in [bid] + [b["id"] for b in pg.evaluate("Buecher.liste()") if b["id"] != bid]:
        pg.evaluate("id => Buecher.entferne(id)", k)
    go(pg, "#/fuehrer", "#fu-add2"); assert pg.evaluate("DB.all('kv').then(l => l.filter(k => /^guide(pts|cover):/.test(k.k)).length)") == 0
    pg.evaluate("async (keep) => { for (const t of await Tours.list()) if (!keep.includes(t.id)) await Tours.remove(t.id); for (const k of ['guides', 'guideMatch']) await DB.del('kv', k); Buecher.coverMem = {}; }", vorher)
    return sorted(set(bad))

# ---------------------------------------------------------------------------------------------------------------------------------------------------------
# 2.5.0 Als PDF: Tour (1–2 Seiten) und Jahr (Deckblatt, Zeile je Tour), Aufbau des PDF, Fotos, Abbruch, Teilen/Download
# ---------------------------------------------------------------------------------------------------------------------------------------------------------
PDF_LANG = ("Früh los, oben Gämsen gesehen und ein Murmeltier direkt am Weg. Der Aufstieg über den Kramersteig war nass, aber gut zu gehen; "
            "oben gab es Kaiserschmarrn auf der Hütte, der Wirt hat uns noch einen Schnaps ausgegeben. ") * 3
PDF_FARBEN = [((120, 170, 225), (225, 235, 245), (70, 100, 90)), ((250, 190, 120), (255, 230, 190), (110, 80, 70)), ((90, 130, 190), (190, 210, 235), (60, 90, 80)),
              ((200, 150, 190), (245, 220, 235), (90, 70, 90)), ((110, 190, 170), (220, 245, 235), (60, 100, 90)), ((230, 200, 110), (250, 240, 200), (100, 90, 60)),
              ((140, 150, 200), (215, 220, 245), (70, 80, 110)), ((180, 210, 130), (235, 245, 210), (80, 110, 60)), ((100, 160, 210), (210, 235, 250), (60, 90, 110)),
              ((220, 130, 110), (250, 215, 200), (110, 70, 60)), ((130, 200, 200), (215, 245, 245), (60, 100, 100))]
_PDF_BILDER = {}

def pdf_bild(i, hoch=False):
    """Erfundenes Illustrationsfoto (Himmel, Sonne, Berge) als JPEG – kein echtes Foto, keine Personen."""
    k = (i, hoch)
    if k in _PDF_BILDER: return _PDF_BILDER[k]
    import io, random
    from PIL import Image, ImageDraw
    w, h = (360, 480) if hoch else (480, 360)
    top, bot, berg = PDF_FARBEN[i % len(PDF_FARBEN)]; rnd = random.Random(i)
    im = Image.new("RGB", (w, h)); d = ImageDraw.Draw(im)
    for y in range(h): f = y / h; d.line([(0, y), (w, y)], fill=tuple(int(top[c] + (bot[c] - top[c]) * f) for c in range(3)))
    sx = int(w * (0.15 + 0.6 * rnd.random())); d.ellipse([sx, int(h * 0.1), sx + 54, int(h * 0.1) + 54], fill=(255, 245, 200))
    for ebene in range(3):
        c = tuple(int(berg[q] * (0.7 + 0.15 * ebene) + 40 * (2 - ebene)) % 256 for q in range(3)); pts = [(0, h)]
        for x in range(0, w + 40, 40): pts.append((x, int(h * (0.45 + 0.12 * ebene) - rnd.random() * h * 0.22)))
        pts.append((w, h)); d.polygon(pts, fill=c)
    b = io.BytesIO(); im.save(b, "JPEG", quality=85); _PDF_BILDER[k] = b.getvalue(); return _PDF_BILDER[k]

PDF_ROUTE_JS = """async ([name, note, nFotos, stars]) => {
  const N = 420, t0 = Date.UTC(2026, 8, 21, 14, 13);
  const pts = Array.from({ length: N }, (_, i) => { const a = i / (N - 1) * Math.PI * 2;
    return { lat: 47.60 + 0.011 * Math.sin(a) + 0.004 * Math.sin(3 * a), lon: 11.20 + 0.019 * Math.cos(a) * (1 + 0.25 * Math.sin(2 * a)), ele: 880 + 520 * Math.pow(Math.sin(Math.PI * i / (N - 1)), 1.2) + 14 * Math.sin(i / 9), t: t0 + i * 25000, hr: 112 + Math.round(26 * Math.sin(i / 40) + 18 * Math.sin(Math.PI * i / N)) }; });
  const r = await Tours.add({ name, sport: 'hike', pts, src: 'file' }); const t = r.tour;
  t.note = note; if (stars) Abgleich.sterneSetzen(t, stars); await Tours.save(t);
  for (let k = 0; k < nFotos; k++) await DB.put('photos', { id: 'pdfph' + k, name: 'p' + k + '.jpg', ts: t0 + 120000 + k * 400000, w: k % 3 === 1 ? 360 : 480, h: k % 3 === 1 ? 480 : 360, src: 'galerie', tour: t.id, lat: pts[k * 30].lat, lon: pts[k * 30].lon });
  return t.id; }"""

PDF_JAHR_JS = """async ([year, n, mitFotos]) => {
  const NAMEN = ['Hüttenrunde am Wank', 'Kramerspitz über den Kramersteig', 'Loisach-Radweg bis Eschenlohe', 'Feierabendrunde', 'Zugspitze durchs Reintal', 'Herzogstand und Heimgarten, Überschreitung mit Abstieg nach Walchensee und Rückfahrt mit dem Bus',
    'Morgenlauf am See', 'Schneeschuh zur Wallgauer Alm', 'Skitour Brunstkogel', 'Partnachklamm'], SP = ['hike', 'hike', 'bike', 'run', 'hike', 'hike', 'run', 'hike', 'skitour', 'hike'];
  const ids = [];
  for (let i = 0; i < n; i++) {
    const day = 1 + Math.floor(i * 360 / n), d0 = new Date(year, 0, day, 8 + (i % 6), (i * 7) % 60).getTime(), len = 30 + (i * 37) % 160, lat0 = 47.2 + (i % 13) * 0.02, lon0 = 11.0 + (i % 7) * 0.03;
    const pts = Array.from({ length: len }, (_, k) => ({ lat: lat0 + k * (0.0004 + (i % 5) * 0.00006), lon: lon0 + 0.003 * Math.sin(k / 7 + i), ele: 700 + (i % 9) * 60 + 120 * Math.sin(Math.PI * k / len), t: d0 + k * 40000 }));
    const t = (await Tours.add({ name: i === 0 ? NAMEN[5] : NAMEN[i % NAMEN.length] + (i >= 10 ? ' ' + (i + 1) : ''), sport: SP[i % SP.length], pts, src: 'file' })).tour;
    ids.push(t.id);
    if (mitFotos && i % 3 === 0) await DB.put('photos', { id: 'pdfjh' + i, name: 'j' + i + '.jpg', ts: d0 + 60000, w: 480, h: 360, src: 'galerie', tour: t.id });
  }
  Tours.invalidate(); return ids; }"""

PDF_FANG = """() => { const c0 = window.MTApp.call; window.__cache = {}; window.__ticks = []; window.MTApp.call = (id, m, a) => { if (m === 'appendCache') { const o = JSON.parse(a); (window.__cache[o.name] = o.reset ? [] : (window.__cache[o.name] || [])).push(o.b64); } return c0.call(window.MTApp, id, m, a); }; }"""

def pdf_bytes(pg, name):
    import base64
    ch = pg.evaluate("n => window.__cache[n] || null", name)
    assert ch, "Das PDF wurde nicht an die Hülle übergeben: " + name
    return b"".join(base64.b64decode(c) for c in ch)

def pdf_pruefen(data, seiten, wo="", karte=0):
    """Das PDF mit einem echten Werkzeug lesen: Kopf, Ende, Seitenzahl, Seitengröße (A4), ein Seitenbild je Seite, Bilder lassen sich entpacken.
    karte = 1 (2.6.0): Seite 1 trägt zusätzlich die Karte als eigenes Bild und die Quellenangabe als echten Text; 0: keine Karte (Skizze), kein Text."""
    import io
    assert data.startswith(b"%PDF-1.4") and data.rstrip().endswith(b"%%EOF"), wo + ": Kopf/Ende"
    assert data.count(b"/Subtype /Image") == seiten + karte and data.count(b"/Filter /DCTDecode") == seiten + karte, (wo, data.count(b"/Subtype /Image"), seiten, karte)
    from pypdf import PdfReader
    r = PdfReader(io.BytesIO(data), strict=True)
    assert len(r.pages) == seiten, (wo, len(r.pages))
    bilder = []
    for i, pgn in enumerate(r.pages):
        assert abs(float(pgn.mediabox.width) - 595.2) < 0.1 and abs(float(pgn.mediabox.height) - 841.92) < 0.1, pgn.mediabox
        assert len(pgn.images) == 1 + (karte if i == 0 else 0), (wo, i, len(pgn.images))
        im = pgn.images[0].image; assert im.size == (1240, 1754), im.size
        bilder.append(im.convert("RGB"))
    quelle = "OpenStreetMap-Mitwirkende" in (r.pages[0].extract_text() or "")
    assert quelle == bool(karte), (wo, "Quellenangabe", quelle, karte)
    return r, bilder

def pdf_anteil(im, box=None):
    """Anteil der Pixel, die nicht Papierfarbe sind (so erkennt man gefüllte Flächen: Fotos, Diagramme)."""
    from PIL import ImageChops, Image
    c = im.crop(box) if box else im
    d = ImageChops.difference(c, Image.new("RGB", c.size, (251, 252, 248))).convert("L").point(lambda v: 255 if v > 24 else 0)
    return sum(1 for v in d.getdata() if v) / (c.size[0] * c.size[1])

def pdf(pg, aus=None):
    """2.5.0 Als PDF. aus: Ordner für Beispieldateien (PDF und PNG je Seite), sonst nichts schreiben."""
    import os, subprocess, tempfile
    from PIL import Image
    zeigen = lambda data, name: aus and (os.makedirs(aus, exist_ok=True), open(os.path.join(aus, name), "wb").write(data))
    pg.evaluate(PDF_FANG)
    zaehl = {"thumb": 0, "foto": 0}
    def thumb(r):
        zaehl["thumb"] += 1; m = __import__("re").search(r"/thumb/(pdf(?:ph|jh)(\d+))\.jpg", r.request.url)
        r.fulfill(status=200, body=pdf_bild(int(m.group(2)) if m else 0, bool(m and m.group(1).startswith("pdfph") and int(m.group(2)) % 3 == 1)), content_type="image/jpeg")
    pg.route("**/thumb/pdf*", thumb)
    pg.evaluate("() => { const f = PdfUI.foto; window.__fotoCalls = 0; PdfUI.foto = function () { window.__fotoCalls++; return f.apply(this, arguments); }; }")
    vorher = pg.evaluate("Tours.list().then(l => l.map(t => t.id))")
    bad = []
    # ---- Tour ohne Fotos und ohne Notiz: eine Seite
    tid = pg.evaluate(PDF_ROUTE_JS, ["Hüttenrunde am Wank mit Blick auf den See und das Wettersteingebirge", "", 0, 4])
    go(pg, "#/tour/" + tid, "header.top button[aria-label=Aktionen]"); pg.click("header.top button[aria-label=Aktionen]"); pg.wait_for_selector(".sheet-back.on")
    assert pg.get_by_text("Als PDF", exact=True).count() == 1, "Menüpunkt „Als PDF“"
    pg.get_by_text("Als PDF", exact=True).click(); pg.wait_for_selector("#pdf-fertig", timeout=60000)
    assert "Download/Tourentagebuch/Tour_Huettenrunde_am_Wank_mit_Blick_auf_den_See_und_das_Wetterst" in pg.inner_text("#pdf-ort") and pg.inner_text("#pdf-ort").endswith(".pdf")
    sv = pg.evaluate("window.__saved"); assert sv["mime"] == "application/pdf" and sv["name"].endswith(".pdf") and sv["path"] == sv["name"], sv
    d1 = pdf_bytes(pg, sv["name"]); r1, b1 = pdf_pruefen(d1, 1, "Tour ohne Fotos", 1); zeigen(d1, "tour-1-seite.pdf")
    assert pdf_anteil(b1[0]) > 0.08, "Seite 1 ist nicht leer"
    assert (r1.metadata.title or "").startswith("Hüttenrunde am Wank"), r1.metadata.title
    assert pg.evaluate("window.__fotoCalls") == 0
    zu(pg)
    print("Tour-PDF ohne Fotos: 1 Seite,", len(d1) // 1024, "KB")
    # ---- Tour mit Notiz und elf Fotos: zwei Seiten, neun Fotos
    pg.evaluate("async ([id, n]) => { const t = await DB.get('tours', id); t.note = n; await Tours.save(t); for (let k = 0; k < 11; k++) await DB.put('photos', { id: 'pdfph' + k, name: 'p' + k + '.jpg', ts: t.start + 120000 + k * 90000, w: 480, h: 360, src: 'galerie', tour: id }); }", [tid, PDF_LANG])
    zaehl["thumb"] = 0
    pg.evaluate("t => DB.get('tours', t).then(x => PdfUI.tour(x))", tid); pg.wait_for_selector("#pdf-fertig", timeout=60000)
    sv = pg.evaluate("window.__saved"); d2 = pdf_bytes(pg, sv["name"]); r2, b2 = pdf_pruefen(d2, 2, "Tour mit Fotos", 1); zeigen(d2, "tour-2-seiten.pdf")
    assert pg.evaluate("window.__fotoCalls") == 9 and zaehl["thumb"] == 9, (pg.evaluate("window.__fotoCalls"), zaehl)      # höchstens neun Fotos, gleichmäßig verteilt
    assert pdf_anteil(b2[1], (90, 700, 1150, 1650)) > 0.5, "Fotoraster füllt die zweite Seite: %.2f" % pdf_anteil(b2[1], (90, 700, 1150, 1650))
    assert len(d2) > len(d1) + 30000, (len(d1), len(d2))
    zu(pg); print("Tour-PDF mit 9 Fotos und Notiz: 2 Seiten,", len(d2) // 1024, "KB")
    # ---- Tour mit Notiz, ohne Fotos: eine Seite (Notiz passt); mit sehr langer Notiz: zwei Seiten, auf Seite 2 gekürzt
    pg.evaluate("async id => { for (let k = 0; k < 11; k++) await DB.del('photos', 'pdfph' + k); const t = await DB.get('tours', id); t.note = 'Kurz und schön.'; await Tours.save(t); }", tid)
    pg.evaluate("t => DB.get('tours', t).then(x => PdfUI.tour(x))", tid); pg.wait_for_selector("#pdf-fertig", timeout=60000); d3 = pdf_bytes(pg, pg.evaluate("window.__saved.name")); pdf_pruefen(d3, 1, "Tour mit kurzer Notiz", 1); zu(pg)
    pg.evaluate("async ([id, n]) => { const t = await DB.get('tours', id); t.note = n.repeat(8); await Tours.save(t); }", [tid, PDF_LANG])
    pg.evaluate("t => DB.get('tours', t).then(x => PdfUI.tour(x))", tid); pg.wait_for_selector("#pdf-fertig", timeout=60000); d4 = pdf_bytes(pg, pg.evaluate("window.__saved.name")); r4, b4 = pdf_pruefen(d4, 2, "Tour mit sehr langer Notiz", 1); zeigen(d4, "tour-lange-notiz.pdf"); zu(pg)
    # ---- Tour ohne Höhen und ohne Zeit: keine Fehler, Profil entfällt
    tid2 = pg.evaluate("""async () => { const pts = Array.from({ length: 40 }, (_, i) => ({ lat: 47.0 + i * 0.0006, lon: 11.0 + 0.002 * Math.sin(i / 5), ele: null, t: null }));
      return (await Tours.add({ name: 'Ohne Höhen und Zeit', sport: 'other', pts, src: 'file' })).tour.id; }""")
    pg.evaluate("t => DB.get('tours', t).then(x => PdfUI.tour(x))", tid2); pg.wait_for_selector("#pdf-fertig", timeout=60000); d5 = pdf_bytes(pg, pg.evaluate("window.__saved.name")); pdf_pruefen(d5, 1, "Tour ohne Höhen", 1); zeigen(d5, "tour-ohne-hoehen.pdf"); zu(pg)
    # ---- Teilen aus dem Ergebnisblatt: gleiche Datei noch einmal an die Hülle, mit dem Typ application/pdf
    pg.evaluate("() => { window.__shared = null; const c1 = window.MTApp.call; window.MTApp.call = (id, m, a) => { if (m === 'shareCache') window.__shared = JSON.parse(a); return c1.call(window.MTApp, id, m, a); }; }")
    pg.evaluate("t => DB.get('tours', t).then(x => PdfUI.tour(x))", tid2); pg.wait_for_selector("#pdf-teilen", timeout=60000); pg.click("#pdf-teilen")
    pg.wait_for_function("window.__shared", timeout=10000); sh = pg.evaluate("window.__shared"); assert sh["mime"] == "application/pdf" and sh["name"].endswith(".pdf") and "Ohne_Hoehen_und_Zeit" in sh["name"], sh
    assert pg.evaluate("window.__cache[__shared.name].length") >= 1; pg.wait_for_selector(".sheet", state="detached")
    # ---- Im Browser (ohne Hülle): Download statt Speichern
    pg.evaluate("window.__mtapp = window.MTApp; window.MTApp = undefined")
    with pg.expect_download(timeout=60000) as dl: pg.evaluate("t => DB.get('tours', t).then(x => PdfUI.tour(x))", tid2)
    d6 = open(dl.value.path(), "rb").read(); pdf_pruefen(d6, 1, "Download", 1); assert dl.value.suggested_filename == "Tour_Ohne_Hoehen_und_Zeit.pdf", dl.value.suggested_filename
    assert "PDF gespeichert" in toast_text(pg, "PDF gespeichert"); pg.evaluate("window.MTApp = window.__mtapp")
    # ---- Jahr: 100 Touren, ohne und mit Fotos; die Oberfläche bleibt bedienbar
    ids = pg.evaluate(PDF_JAHR_JS, [2015, 100, True]); jahr_start = ids
    go(pg, "#/jahr/2015", "#jahr-pdf"); assert pg.locator("#jahr-pdf").inner_text() == "Als PDF" and "Als Bild teilen" in pg.inner_text("#jahr-teilen")
    assert not pg.locator("#jahr-pdf-fotos input").is_checked()
    pg.evaluate("window.__ticks = []; let l = performance.now(); window.__iv = setInterval(() => { const n = performance.now(); window.__ticks.push(n - l); l = n; }, 10)")
    pg.click("#jahr-pdf"); pg.wait_for_selector("#pdf-fertig", timeout=120000)
    tk = pg.evaluate("clearInterval(window.__iv) || window.__ticks"); luecke = max(tk)
    sv = pg.evaluate("window.__saved"); dj = pdf_bytes(pg, sv["name"]); assert sv["name"] == "Tourentagebuch_Jahr_2015.pdf", sv
    rj, bj = pdf_pruefen(dj, len(pdf_seiten_erwartet(100)) , "Jahr ohne Fotos"); zeigen(dj, "jahr-100-touren.pdf"); zu(pg)
    print("Jahres-PDF 100 Touren ohne Fotos:", len(rj.pages), "Seiten,", len(dj) // 1024, "KB; größte Pause der Oberfläche", round(luecke), "ms bei", len(tk), "Takten")
    assert len(tk) >= 10 and luecke < 1500, ("Oberfläche blockiert", luecke, len(tk))
    pg.click("#jahr-pdf-fotos input"); assert pg.locator("#jahr-pdf-fotos input").is_checked()
    pg.evaluate("window.__fotoCalls = 0"); pg.click("#jahr-pdf"); pg.wait_for_selector("#pdf-fertig", timeout=180000)
    dj2 = pdf_bytes(pg, pg.evaluate("window.__saved.name")); rj2, bj2 = pdf_pruefen(dj2, len(pdf_seiten_erwartet(100, True)), "Jahr mit Fotos"); zeigen(dj2, "jahr-100-touren-mit-fotos.pdf"); zu(pg)
    assert pg.evaluate("window.__fotoCalls") == 34, pg.evaluate("window.__fotoCalls")      # jede dritte Tour hat ein Foto (0, 3, …, 99)
    assert len(dj2) > len(dj), (len(dj), len(dj2))
    print("Jahres-PDF 100 Touren mit Fotos:", len(rj2.pages), "Seiten,", len(dj2) // 1024, "KB")
    # ---- Abbrechen: nichts wird gespeichert, die Oberfläche ist danach wieder frei
    pg.evaluate("window.__saved = null; window.__cache = {}"); pg.unroute("**/thumb/pdf*")
    def langsam(r):
        __import__("time").sleep(0.6); thumb(r)
    pg.route("**/thumb/pdf*", langsam)
    pg.click("#jahr-pdf"); pg.wait_for_selector("#prog-stop"); pg.wait_for_function("/Seite 2 von/.test(document.querySelector('.sheet').innerText)", timeout=60000)
    pg.click("#prog-stop"); pg.wait_for_selector(".sheet", state="detached", timeout=30000)
    assert "Abgebrochen" in toast_text(pg, "Abgebrochen") and pg.evaluate("window.__saved") is None and pg.evaluate("Object.keys(window.__cache).length") == 0, "Abbruch speichert nichts"
    assert pg.evaluate("PdfUI.busy") is False and pg.locator("#jahr-pdf").is_enabled()
    pg.unroute("**/thumb/pdf*"); pg.route("**/thumb/pdf*", thumb)
    # ---- Leeres Jahr: freundlich, kein PDF
    pg.evaluate("() => PdfUI.jahr(Jahr.berechne([], 2001, new Date()), [])"); assert "keine Touren" in toast_text(pg, "keine Touren")
    # ---- Aufräumen
    pg.evaluate("async keep => { for (const t of await Tours.list()) if (!keep.includes(t.id)) await Tours.remove(t.id); for (const p of await DB.all('photos')) if (/^pdf(ph|jh)/.test(p.id)) await DB.del('photos', p.id); Tours.invalidate(); }", vorher)
    pg.unroute("**/thumb/pdf*")
    return bad

# ---------------------------------------------------------------------------------------------------------------------------------------------------------
# 2.6.0 Karte im Tour-PDF: Kacheln (nachgestellt), Quellenangabe als Text, höflich laden, Rückfall auf die Skizze, Abbrechen, Schalter, Kachelgrenze
# ---------------------------------------------------------------------------------------------------------------------------------------------------------
def kachel_png():
    """Nachgestellte Kartenkachel: hellblau mit Gitter und einer weißen „Straße“ – leicht von der Strecke (kräftiges Rot) zu unterscheiden."""
    import io
    from PIL import Image, ImageDraw
    im = Image.new("RGB", (256, 256), (150, 190, 230)); d = ImageDraw.Draw(im)
    for k in range(0, 256, 64): d.line([(k, 0), (k, 255)], fill=(120, 150, 200), width=2); d.line([(0, k), (255, k)], fill=(120, 150, 200), width=2)
    d.line([(0, 200), (255, 60)], fill=(250, 250, 250), width=10)
    b = io.BytesIO(); im.save(b, "PNG"); return b.getvalue()

KACHEL_ZAEHLER = """() => { if (window.__klH0) return; const h0 = Native.http; window.__klH0 = h0; window.__kl = { aktiv: 0, max: 0, n: 0, ua: '' };
  Native.http = async o => { if (!/tile\\.openstreetmap\\.org/.test(o.url)) return h0(o); const k = window.__kl; k.n++; k.aktiv++; k.max = Math.max(k.max, k.aktiv); k.ua = (o.headers || {})['User-Agent'] || '';
    try { if (window.__klHaengen) await new Promise(() => {}); return await h0(o); } finally { k.aktiv--; } }; }"""
CACHE_ZAHL = "async () => { if (!window.caches) return 0; let n = 0; for (const k of await caches.keys()) n += (await (await caches.open(k)).keys()).length; return n; }"

def pdf_karte(pg, aus=None):
    """2.6.0: Karte im Tour-PDF. aus: Ordner für ein Beispiel (PDF und PNG der Seite)."""
    import os, re, subprocess, time
    png = kachel_png(); st = {"urls": [], "modus": "ok"}
    def kachel(r):
        st["urls"].append(r.request.url)
        if st["modus"] == "404" and len(st["urls"]) % 3 == 0: r.fulfill(status=404, body="nicht da", headers={"access-control-allow-origin": "*"})
        elif st["modus"] == "abbruch": r.abort("internetdisconnected")
        else: r.fulfill(status=200, body=png, content_type="image/png", headers={"access-control-allow-origin": "*"})
    pg.route("**/tile.openstreetmap.org/**", kachel)
    if not pg.evaluate("!!window.__cache"): pg.evaluate(PDF_FANG)
    pg.evaluate(KACHEL_ZAEHLER)
    vorher = pg.evaluate("Tours.list().then(l => l.map(t => t.id))")
    tid = pg.evaluate(PDF_ROUTE_JS, ["Kartenrunde am Wank", "", 0, 0])
    def neu(): st["urls"].clear(); pg.evaluate("window.__kl.n = 0; window.__kl.max = 0; window.__kl.aktiv = 0; window.__saved = null")
    def tour_pdf(t=None):
        pg.wait_for_function(LEISE, timeout=15000)
        pg.evaluate("t => DB.get('tours', t).then(x => PdfUI.tour(x))", t or tid); pg.wait_for_selector("#pdf-fertig", timeout=60000)
        d = pdf_bytes(pg, pg.evaluate("window.__saved.name")); hw = pg.locator("#pdf-hinweis").count(); txt = pg.inner_text("#pdf-fertig"); zu(pg)
        return d, hw, txt
    def anteil(im, f):
        b = im.tobytes(); px = [b[i:i + 3] for i in range(0, len(b), 3)]; return sum(1 for p in px if f(p)) / len(px)
    # ---- Karte: eigenes Bild an der Stelle der Skizze, Strecke gut sichtbar, Quellenangabe als echter Text, höflich geladen, nichts gespeichert
    neu(); c0 = pg.evaluate(CACHE_ZAHL)
    d, hw, _ = tour_pdf(); r, b = pdf_pruefen(d, 1, "Tour mit Karte", 1)
    kl = pg.evaluate("window.__kl")
    assert hw == 0 and 2 <= kl["n"] <= 12 and len(st["urls"]) == kl["n"] and len(set(st["urls"])) == len(st["urls"]), (hw, kl, st["urls"])
    assert kl["max"] <= 3 and "MeinTourentagebuch/" in kl["ua"], kl
    assert all(re.fullmatch(r"https://tile\.openstreetmap\.org/1[1-6]/\d+/\d+\.png", u) for u in st["urls"]), st["urls"]
    assert pg.evaluate(CACHE_ZAHL) == c0, "Kacheln des PDFs dürfen nicht gespeichert werden"
    karte = [x.image for x in r.pages[0].images if x.image.size != (1240, 1754)][0].convert("RGB")
    assert karte.size[0] == 1060 and 240 <= karte.size[1] <= 820, karte.size
    blau = anteil(karte, lambda p: p[2] > p[0] + 40 and p[2] > 170); rot = anteil(karte, lambda p: p[0] > 150 and p[1] < 90 and p[2] < 150)
    assert blau > 0.5 and rot > 0.004, ("Karte und Strecke", round(blau, 3), round(rot, 4))
    text = r.pages[0].extract_text() or ""; assert "© OpenStreetMap-Mitwirkende" in text, text
    print("Tour-PDF mit Karte:", kl["n"], "Kacheln, höchstens", kl["max"], "gleichzeitig,", len(d) // 1024, "KB; Karte", karte.size, "Blau %.2f, Strecke %.3f" % (blau, rot))
    if aus:
        os.makedirs(aus, exist_ok=True); fn = os.path.join(aus, "tour-mit-karte.pdf"); open(fn, "wb").write(d)
        subprocess.run(["pdftoppm", "-r", "100", "-png", "-f", "1", "-l", "1", fn, os.path.join(aus, "tour-mit-karte")], check=False)
    # ---- Rückfall: eine Kachel fehlt (404) → Skizze, Hinweis im Ergebnisblatt, kein Fehler
    neu(); st["modus"] = "404"
    d, hw, txt = tour_pdf(); pdf_pruefen(d, 1, "Kachel fehlt", 0)
    assert hw == 1 and "Karte nicht verfügbar" in txt, txt
    assert pg.evaluate("window.__kl.n") <= 12
    # ---- Rückfall: kein Netz (Verbindung bricht ab)
    neu(); st["modus"] = "abbruch"
    d, hw, txt = tour_pdf(); pdf_pruefen(d, 1, "Kein Netz", 0); assert hw == 1, txt
    if aus:
        fn = os.path.join(aus, "tour-skizze-rueckfall.pdf"); open(fn, "wb").write(d)
        subprocess.run(["pdftoppm", "-r", "60", "-png", "-f", "1", "-l", "1", fn, os.path.join(aus, "tour-skizze-rueckfall")], check=False)
    st["modus"] = "ok"
    # ---- Rückfall: Kachelserver antwortet nicht (Zeitüberschreitung je Kachel, hier verkürzt)
    neu(); pg.evaluate("window.__klHaengen = true; PdfUI.KARTE.ms = 400"); t0 = time.time()
    d, hw, txt = tour_pdf(); pdf_pruefen(d, 1, "Zeitüberschreitung", 0); assert hw == 1 and time.time() - t0 < 20, (hw, time.time() - t0)
    # ---- Abbrechen während die Kacheln laden: greift sofort (nicht erst nach 8 s), nichts wird gespeichert
    neu(); pg.evaluate("PdfUI.KARTE.ms = 8000"); pg.wait_for_function(LEISE, timeout=15000)
    pg.evaluate("t => { DB.get('tours', t).then(x => PdfUI.tour(x)); }", tid)
    pg.wait_for_function("(document.querySelector('.sheet') || {}).innerText && /Karte laden/.test(document.querySelector('.sheet').innerText)", timeout=30000)
    t0 = time.time(); pg.click("#prog-stop"); pg.wait_for_selector(".sheet", state="detached", timeout=6000)
    assert "Abgebrochen" in toast_text(pg, "Abgebrochen") and pg.evaluate("window.__saved") is None and time.time() - t0 < 6, "Abbruch beim Kartenladen"
    pg.wait_for_function("PdfUI.busy === false", timeout=5000); pg.evaluate("window.__klHaengen = false")
    # ---- Schalter in den Einstellungen (Vorgabe an); aus → Skizze, kein Netz
    go(pg, "#/settings", "#pdf-karte"); assert pg.locator("#pdf-karte input").is_checked() and "braucht Internet" in pg.inner_text("#pdf-karte")
    pg.click("#pdf-karte"); pg.wait_for_function("Set_.get('pdfKarte') === false"); assert pg.evaluate("DB.kvGet('settings', {}).then(s => s.pdfKarte)") is False
    neu(); d, hw, _ = tour_pdf(); pdf_pruefen(d, 1, "Schalter aus", 0); assert hw == 0 and not st["urls"] and pg.evaluate("window.__kl.n") == 0, st["urls"]
    go(pg, "#/settings", "#pdf-karte"); pg.click("#pdf-karte"); pg.wait_for_function("Set_.get('pdfKarte') === true")
    # ---- sehr lange Tour (etwa 560 km, 3000 Punkte): kleiner Zoom, Kachelgrenze hält
    tl = pg.evaluate("""async () => { const N = 3000, t0 = Date.UTC(2026, 6, 1, 6); const pts = Array.from({ length: N }, (_, i) => ({ lat: 48.14 - i / (N - 1) * 2.7 + 0.2 * Math.sin(i / 140), lon: 11.58 + i / (N - 1) * 0.76, ele: 500 + 300 * Math.sin(i / 300), t: t0 + i * 60000 }));
      return (await Tours.add({ name: 'München–Venedig', sport: 'bike', pts, src: 'file' })).tour.id; }""")
    neu(); d, hw, _ = tour_pdf(tl); pdf_pruefen(d, 1, "Lange Tour", 1); assert hw == 0 and 2 <= len(st["urls"]) <= 12, len(st["urls"])
    assert all(int(u.split("/")[3]) <= 9 for u in st["urls"]), st["urls"][:3]
    # ---- Aufräumen
    pg.evaluate("async keep => { for (const t of await Tours.list()) if (!keep.includes(t.id)) await Tours.remove(t.id); Tours.invalidate(); Native.http = window.__klH0; delete window.__klH0; }", vorher)
    pg.unroute("**/tile.openstreetmap.org/**", kachel)

def pdf_seiten_erwartet(n, mit_fotos=False):
    """Seitenaufteilung wie in PdfUI.jahrPdf, aus den 100 Beispieltouren (Monate gleichmäßig über das Jahr) – gerechnet mit denselben Zahlen."""
    zeilen = 140 if mit_fotos else 66; platz = 1754 - 150 - 130; kopf = 92
    from datetime import datetime
    tage = [1 + (i * 360) // n for i in range(n)]
    monat = lambda t: min(11, (t - 1) // 30)       # nur zur Schätzung der Seitenzahl; genau prüft das Python-Gegenstück unten
    seiten = [[]]; y = 0; m = None
    for t in tage:
        d = datetime(2015, 1, 1).toordinal() + t - 1; mo = datetime.fromordinal(d).month
        if mo != m:
            if seiten[-1] and y + kopf + zeilen > platz: seiten.append([]); y = 0
            seiten[-1].append("m"); y += kopf; m = mo
        elif y + zeilen > platz: seiten.append(["m"]); y = kopf
        seiten[-1].append("t"); y += zeilen
    return [None] * (1 + len(seiten))

def sheet_check_open(pg, label):
    """Das gerade offene Blatt bei 360 px mit 100 % und 130 % Schrift prüfen (es bleibt offen)."""
    bad = []
    for fs in (100, 130):
        pg.set_viewport_size({"width": 360, "height": 800})
        pg.evaluate("fs => { let s = document.getElementById('fs-test'); if (!s) { s = document.createElement('style'); s.id = 'fs-test'; document.head.append(s); } s.textContent = fs === 100 ? '' : 'html{font-size:' + fs + '% !important}'; }", fs); pg.wait_for_timeout(300)
        if pg.evaluate("(() => { const s = document.querySelector('.sheet'); return s.scrollWidth > s.clientWidth + 1 })()"): bad.append(f"{label}, {fs} %: Blatt rollt quer")
        bad += [f"{label}, {fs} %: " + m for m in pg.evaluate(LAYOUT_JS)]
    pg.evaluate("document.getElementById('fs-test').textContent = ''"); pg.set_viewport_size({"width": 390, "height": 800})
    return bad


def main():
    srv = socketserver.TCPServer(("127.0.0.1", 0), Q); port = srv.server_address[1]
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    errs = []
    with sync_playwright() as p:
        b = p.chromium.launch(); ctx = b.new_context(viewport={"width": 390, "height": 800}, device_scale_factor=1, permissions=["geolocation"], geolocation={"latitude": 47.0, "longitude": 11.0})
        ctx.add_init_script(MOCK)
        pg = ctx.new_page()
        pg.on("pageerror", lambda e: errs.append("PAGEERROR " + str(e) + " " + str(getattr(e, "stack", ""))))
        pg.on("console", lambda m: m.type == "error" and "Failed to load resource" not in m.text and "net::" not in m.text and errs.append("CONSOLE " + m.text))
        # Kartenserver/Routing nachstellen
        import io as _io
        from PIL import Image as _Im
        _b = _io.BytesIO(); _Im.new("RGB", (256, 256), (242, 239, 233)).save(_b, "PNG"); png = _b.getvalue()      # 2.6.0: gültige Kachel (die frühere 1-Pixel-PNG war defekt; die Karte im PDF prüft das Bild)
        pg.route("**/tile.openstreetmap.org/**", lambda r: r.fulfill(status=200, body=png, content_type="image/png", headers={"access-control-allow-origin": "*"}))
        pg.route("**/brouter.de/**", lambda r: r.fulfill(status=200, content_type="application/json", headers={"access-control-allow-origin": "*"}, body=json.dumps({"features": [{"geometry": {"coordinates": [[11.0, 47.0, 500], [11.001, 47.001, 520], [11.002, 47.002, 560]]}}]})))
        pg.goto(f"http://127.0.0.1:{port}/index.html"); pg.wait_for_selector("#tabs a")
        assert "Willkommen" in pg.inner_text("#view"), "Leerzustand fehlt"
        # Touren einlesen (wie beim Datei-Import)
        t0 = 1700000000000
        res = pg.evaluate("""async ([a,b,dup]) => { const enc=s=>new TextEncoder().encode(s); const r1=await Import.fromData('a.gpx',enc(a),'file'); const r2=await Import.fromData('b.gpx',enc(b),'file'); const r3=await Import.fromData('a2.gpx',enc(dup),'file'); return [r1,r2,r3]; }""",
                          [gpx(t0, name="Hüttenrunde"), gpx(t0 + 86400000 * 40, lat=47.2, name="Zweite Tour"), gpx(t0, name="Doppelt")])
        assert res[0]["added"] == 1 and res[1]["added"] == 1 and res[2]["dup"] == 1, res
        # Zip-Import
        z = pg.evaluate("""async (g) => { const z=fflate.zipSync({'x/1.gpx':new TextEncoder().encode(g)}); return await Import.fromData('exp.zip', z, 'file'); }""", gpx(t0 + 86400000 * 90, lat=46.9, name="Aus ZIP"))
        assert z["added"] == 1, z
        # Fotos mit Zeit innerhalb der ersten Tour
        n = pg.evaluate("""async (t0) => Photos.addMeta([{id:'aa11bb22cc',name:'x.jpg',ts:t0+300000,w:10,h:10,src:'galerie'},{id:'dd11ee22ff',name:'y.jpg',ts:t0+99999999999,w:10,h:10}])""", t0)
        assert n == 2
        ph = pg.evaluate("DB.all('photos')")
        a = [x for x in ph if x["id"] == "aa11bb22cc"][0]; bq = [x for x in ph if x["id"] == "dd11ee22ff"][0]
        assert a["tour"] and a["pos"] == "track" and abs(a["lat"] - 47.0) < 0.05, a
        assert not bq["tour"], bq
        # Ansichten
        pg.evaluate("location.hash='#/'"); pg.wait_for_selector("a.tour")
        assert pg.locator("a.tour").count() == 3, pg.inner_text("#view")
        assert "Hüttenrunde" in pg.inner_text("#view")
        pg.fill("input[type=search]", "zweite"); assert pg.locator("a.tour").count() == 1
        pg.fill("input[type=search]", "")
        pg.locator("a.tour", has_text="Hüttenrunde").click(); pg.wait_for_selector(".tourp .kpis.big")
        txt = pg.inner_text("#view"); assert "Höhenprofil" in txt and "Aufstieg" in txt, txt
        # Tourseite: Titel unter der Karte, die drei wichtigsten Zahlen groß (Strecke, Aufstieg, Dauer), der Rest als leise Tabelle
        assert pg.inner_text(".tourp > h1") == "Hüttenrunde" and pg.locator(".tourp .kpis.big .kpi").count() == 3
        assert [x.strip() for x in pg.locator(".tourp .kpis.big .kpi small").all_inner_texts()] == ["Strecke", "Aufstieg", "Dauer"]
        assert pg.locator(".tourp .facts > div").count() >= 5 and "Abstieg" in pg.inner_text(".tourp .facts")
        assert pg.locator("header.top.over button").count() == 3, "Zurück, Favorit, Aktionen schweben über der Karte"
        pg.wait_for_selector(".leaflet-tile-loaded, .leaflet-container"); pg.wait_for_timeout(500)
        assert pg.locator(".strip .th").count() == 1
        pg.screenshot(path="/tmp/shot_tour.png")
        pg.locator(".strip .th").click(); pg.wait_for_selector(".lb"); pg.screenshot(path="/tmp/shot_lb.png")
        assert pg.evaluate("window.mtBack()") is True; assert pg.locator(".lb").count() == 0
        # Aktionen: GPX speichern
        pg.locator("header.top button[aria-label=Aktionen]").click(); pg.get_by_text("Als GPX speichern").click(); pg.wait_for_timeout(300)
        assert pg.evaluate("window.__saved && __saved.name.endsWith('.gpx') && __saved.text.includes('<trkpt')")
        # Erzählung: Zeitleiste, Fotostandorte, Kommentare
        pg.route("**/nominatim.openstreetmap.org/**", lambda r: r.fulfill(status=200, content_type="application/json", headers={"access-control-allow-origin": "*"}, body=json.dumps([{"display_name": "Hamburg, Deutschland", "lat": "53.55", "lon": "10.0"}] if "/search" in r.request.url else {"address": {"village": "Testdorf"}})))
        tid = pg.evaluate("DB.all('tours').then(a => a.find(t => t.name === 'Hüttenrunde').id)")
        pg.evaluate(f"location.hash='#/story/{tid}'"); pg.wait_for_selector(".stl .stev", timeout=5000)
        txt = pg.inner_text(".stl"); assert "Start" in txt and "Ziel" in txt and "Foto" in txt, txt
        pg.wait_for_function("document.querySelector('.stl .splc') && document.querySelector('.stl .splc').textContent.includes('Testdorf')", timeout=8000)
        assert pg.locator(".tmap .pmk").count() >= 1, "Fotostandort fehlt auf der Karte"
        pg.locator(".stl .sph").first.click(); pg.wait_for_selector("input[placeholder^=Kommentar]")
        pg.fill("input[placeholder^=Kommentar]", "Schöner Blick"); pg.get_by_role("button", name="Senden").click()
        pg.wait_for_selector(".scm2"); assert "Schöner Blick" in pg.inner_text(".scm2")
        pg.wait_for_selector(".stl .scm"); assert "Schöner Blick" in pg.inner_text(".stl")
        pg.locator(".scm2 button").click(); pg.wait_for_selector(".scm2", state="detached")
        pg.evaluate("(sheet.stack || []).slice().forEach(x => x.close())"); pg.wait_for_selector(".sheet", state="detached")
        # Heimatort suchen und speichern
        pg.evaluate("location.hash='#/settings'"); pg.wait_for_selector("input[placeholder^='Ort oder Adresse']")
        pg.fill("input[placeholder^='Ort oder Adresse']", "Hamburg"); pg.get_by_role("button", name="Suchen").click()
        pg.get_by_role("button", name="Hamburg, Deutschland").click()   # das 📍 wird zum Symbol, bleibt aber nicht im Namen
        pg.wait_for_function("DB.kvGet && Set_.get('homeName') === 'Hamburg, Deutschland' && Set_.get('homeLat') === '53.55000'")
        for path, key in [("#/map", ".leaflet-container"), ("#/photos", ".pgrid"), ("#/stats", ".kpis"), ("#/import", ".list"), ("#/settings", "h3"), ("#/sources", ".list"), ("#/plan", ".pmap"), ("#/rec", ".bigstart"), ("#/mehr", "#m-settings")]:
            pg.evaluate(f"location.hash='{path}'"); pg.wait_for_selector(key, timeout=5000); pg.wait_for_timeout(250)
        pg.evaluate("location.hash='#/stats'"); pg.wait_for_selector(".kpis"); assert "3" in pg.inner_text(".kpis")
        pg.screenshot(path="/tmp/shot_stats.png")
        # Planer: drei Punkte, Speichern
        pg.evaluate("location.hash='#/plan'"); pg.wait_for_selector(".pmap"); pg.wait_for_timeout(600)
        box = pg.locator(".pmap").bounding_box()
        for dx, dy in [(-60, 20), (20, -30), (80, 40)]:
            pg.mouse.click(box["x"] + box["width"] / 2 + dx, box["y"] + box["height"] / 2 + dy); pg.wait_for_timeout(500)
        assert pg.locator(".pmap .mk").count() == 3, pg.locator(".pmap .mk").count()
        assert "Strecke" in pg.inner_text(".ppanel")
        pg.get_by_text("Tour speichern").click(); pg.wait_for_selector("input[placeholder=Name]"); pg.fill("input[placeholder=Name]", "Geplant A"); pg.get_by_role("button", name="Speichern", exact=True).click()
        pg.wait_for_selector(".banner"); assert "Geplante Tour" in pg.inner_text(".banner")
        pg.screenshot(path="/tmp/shot_plan.png")
        pg.get_by_text("Mit Ansagen starten").click(); pg.wait_for_selector(".bigstart")
        assert pg.evaluate("__calls.some(c=>c[0]==='route'&&c[1]==='Geplant A')")
        # Aufzeichnung (simuliert)
        pg.locator(".bigstart").click(); pg.wait_for_selector(".bigtime"); assert "01:01" in pg.inner_text(".bigtime")
        pg.locator("#rphoto").click(); assert pg.evaluate("__calls.some(c=>c[0]==='photo')")
        pg.locator("#rvideo").click(); assert pg.evaluate("__calls.some(c=>c[0]==='video')")
        # Pin mit Kommentar
        pg.locator("#rpin").click(); pg.wait_for_selector(".sheet input"); pg.fill(".sheet input", "Schöne Aussicht"); pg.get_by_role("button", name="Speichern", exact=True).click(); pg.wait_for_timeout(300)
        assert pg.evaluate("DB.kvGet('recPins',[]).then(a=>a.length===1&&a[0].text==='Schöne Aussicht')")
        # Beenden: ein kurzer Druck beendet nichts, erst Halten
        assert "läuft" in pg.inner_text("header.top h1") and pg.locator("#tabs a.rec.live").count() == 1
        vals = [x.strip() for x in pg.locator(".rec .kpis.big .kpi small").all_inner_texts()]; assert vals == ["Strecke", "Aufstieg", "Höhe", "Tempo"], vals
        assert pg.evaluate("parseFloat(getComputedStyle(document.querySelector('.bigtime')).fontSize)") >= 56, "Laufzeit muss groß sein"
        pg.locator("#rpause").click(); pg.wait_for_function("document.querySelector('header.top h1').innerText.includes('Pause')"); pg.locator("#rpause").click(); pg.wait_for_function("document.querySelector('header.top h1').innerText.includes('läuft')")
        pg.locator("#rstop").scroll_into_view_if_needed(); bb = pg.locator("#rstop").bounding_box()
        pg.mouse.move(bb["x"] + 20, bb["y"] + 20); pg.mouse.down(); pg.wait_for_timeout(300); pg.mouse.up(); pg.wait_for_timeout(300)
        assert pg.evaluate("__rec.state") == "recording", "kurzer Druck darf nicht beenden"
        pg.evaluate("g => { window.__gpx = g }", gpx(t0 + 86400000 * 200, n=30, lat=46.5, name=""))
        pg.mouse.move(bb["x"] + 20, bb["y"] + 20); pg.mouse.down()
        pg.wait_for_function("location.hash.startsWith('#/tour/')", timeout=8000); pg.mouse.up()
        pg.wait_for_selector("#pins"); assert "Schöne Aussicht" in pg.inner_text("#pins")
        tid = pg.evaluate("location.hash.split('/')[2]")
        # Aufzeichnung aus einer Planung gestartet („Speichern & starten“): die Tour ist mit der Planung verknüpft und zeigt Plan und Ergebnis
        assert pg.evaluate("async id => { const t = await DB.get('tours', id), p = (await Tours.list()).find(x => x.name === 'Geplant A'); return !!p && t.plan === p.id; }", tid), "Verknüpfung mit der Planung fehlt"
        pg.wait_for_selector("#planergebnis"); assert "Geplant A" in pg.inner_text("#planergebnis") and "geplant" in pg.inner_text("#planergebnis")
        # Gesicherte Aufzeichnung wiederherstellen (Tour war gelöscht)
        pg.evaluate("window.__routeName = ''")
        pg.evaluate("t => Tours.remove(t)", tid)
        pg.evaluate("g => { window.__baks=[{file:'rec_20260101_100000.gpx',size:2048,ts:1767261600000}]; window.__bakgpx=g }", gpx(t0 + 86400000 * 200, n=30, lat=46.5, name=""))
        pg.evaluate("location.hash='#/rec'"); pg.wait_for_selector("#baks"); pg.wait_for_selector("#gpxroute"); pg.click("#baks"); pg.locator(".sheet .li").first.click()
        pg.get_by_role("button", name="Wiederherstellen", exact=True).click()
        pg.wait_for_function("location.hash.startsWith('#/tour/')", timeout=6000)
        # Planen ist von Start und Touren aus erreichbar (Touren: über „＋“)
        pg.evaluate("location.hash='#/'"); pg.wait_for_selector("#touradd"); pg.click("#touradd"); pg.wait_for_selector("#newplan")
        assert pg.locator("#newimport").count() == 1 and pg.locator("#newrec").count() == 1
        pg.click("#newplan"); pg.wait_for_function("location.hash==='#/plan'"); pg.wait_for_selector(".pmap")
        pg.evaluate("location.hash='#/start'"); pg.wait_for_selector("#startplan")
        # Startseite: letzte Tour als Aufmacher (führt zur Tour), drei Hauptaktionen, „Dieses Jahr“, „Letzte Touren“
        last = pg.evaluate("Tours.list().then(l => l.filter(t => t.status !== 'planned' && !t.hidden)[0])")
        assert last["name"] in pg.inner_text("#hero h2") and pg.get_attribute("#hero", "href") == "#/tour/" + last["id"], pg.inner_text("#hero")
        assert "km" in pg.inner_text("#hero .hero-k") and "Zuletzt" in pg.inner_text("#hero")
        assert pg.get_attribute("#startrec", "href") == "#/rec" and pg.get_attribute("#startplan", "href") == "#/plan" and pg.get_attribute("#startimport", "href") == "#/import"
        assert [x.strip() for x in pg.locator("#year .kpis .kpi small").all_inner_texts()][:3] == ["Strecke", "Touren", "Aufstieg"], pg.inner_text("#year")
        nrec = pg.evaluate("Tours.list().then(l => l.filter(t => t.status !== 'planned' && !t.hidden).length)")
        assert pg.locator("#recent a.tour").count() == min(4, nrec - 1), pg.locator("#recent a.tour").count()
        assert last["name"] not in pg.inner_text("#recent"), "die letzte Tour steht schon im Aufmacher"
        pg.click("#hero"); pg.wait_for_function("location.hash.startsWith('#/tour/')"); pg.evaluate("location.hash='#/start'"); pg.wait_for_selector("#hero")
        # Bausteine: Ein weiterer Abschnitt lässt sich anmelden und erscheint an seiner Stelle; ein fehlerhafter Baustein reißt die Seite nicht mit
        pg.evaluate("Home.add('probe', 30, async ctx => UI.section('Probe', UI.figs([[ctx.all.length, 'Touren']]), { id: 'probe' }))")
        pg.evaluate("Nav.render()"); pg.wait_for_selector("#probe .kpi")
        order = pg.evaluate("[...document.querySelectorAll('.home > *')].map(e => e.id || e.className)")
        assert order.index("year") < order.index("probe") < order.index("recent"), order
        pg.evaluate("Home.blocks = Home.blocks.filter(b => b.id !== 'probe'); Nav.render()"); pg.wait_for_selector("#probe", state="detached")
        # Jahreskarte: ohne Ziel der Hinweis, mit Ziel die Fortschrittszeile; Sport-Chip filtert die Karte
        pg.wait_for_selector("#yset")
        pg.evaluate("DB.kvSet('goals', {[new Date().getFullYear()]: {km: 1000, n: 50}})")
        pg.evaluate("location.hash='#/'"); pg.wait_for_selector("#touradd"); pg.evaluate("location.hash='#/start'"); pg.wait_for_selector(".year .ygoal")
        assert pg.locator(".year .ygoal").count() == 2 and pg.locator(".year .ygoal .gbar u").count() == 2
        big0 = pg.locator(".year .kpi b").first.inner_text(); nch = pg.locator(".home .chips .chip").count()
        if nch > 2:
            pg.locator(".home .chips .chip").nth(1).click(); pg.wait_for_timeout(200)
            assert pg.locator(".home .chips .chip.on").count() == 1 and pg.locator(".year .ygoal").count() == 0      # 2.6.1: Ziele „Alle Sportarten“ passen nicht zu den Zahlen einer Sportart
            assert pg.locator("#ynogoal").count() == 1 and pg.locator("#year a.ylink").count() == 1
            pg.locator(".home .chips .chip").first.click(); pg.wait_for_timeout(200)
            assert pg.locator(".year .kpi b").first.inner_text() == big0 and pg.locator(".year .ygoal").count() == 2
        pg.click(".year .ylink"); pg.wait_for_function("location.hash==='#/stats/ziele'")
        pg.wait_for_selector("#goals .ygoal"); assert pg.locator(".chips .chip.on").inner_text() == "Ziele"
        pg.evaluate("DB.kvSet('goals', {})"); pg.evaluate("location.hash='#/start'"); pg.wait_for_selector("#yset")
        # Foto-Quellen: Galerie zu Tour
        pg.evaluate("window.__gts = %d; window.__gallery=[{uri:'content://m/1',ts:%d,name:'q'}]" % (t0 + 100000, t0 + 100000))
        pg.evaluate("location.hash='#/photos'"); pg.wait_for_selector(".pgrid")
        pg.locator("header.top button[aria-label='Fotos hinzufügen']").click(); pg.get_by_text("Passende Fotos zu allen Touren finden").click(); pg.wait_for_timeout(1500)
        assert pg.evaluate("DB.count('photos')") >= 3
        pg.screenshot(path="/tmp/shot_photos.png")
        # Sicherung
        pg.evaluate("location.hash='#/settings'"); pg.wait_for_selector("h3"); pg.get_by_text("Sicherung speichern").click(); pg.wait_for_timeout(500)
        assert pg.evaluate("__saved.name.endsWith('.mtl') && __saved.b64.length>100")
        # Puls: GPX mit Herzfrequenz einlesen, Kennzahlen und Anzeige prüfen
        hgpx = gpx(t0 + 86400000 * 120, lat=46.5, name="Mit Puls").replace("</trkpt>",
            "<extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>%d</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions></trkpt>" % 140)
        hres = pg.evaluate("""async g => Import.fromData('hr.gpx', new TextEncoder().encode(g), 'file')""", hgpx)
        assert hres["added"] == 1, hres
        ht = pg.evaluate("""async () => (await Tours.list()).find(t => t.name === 'Mit Puls')""")
        assert ht["hrAvg"] == 140 and ht["hrMax"] == 140 and sum(ht["hrZones"]) > 0, ht
        pg.evaluate("location.hash='#/tour/' + arguments[0]" if False else "id => location.hash = '#/tour/' + id", ht["id"])
        pg.wait_for_selector("text=Ø Puls")
        assert "140" in pg.inner_text("#view")
        assert pg.evaluate("""() => !!document.querySelector('.hbars .hb')""")
        exp = pg.evaluate("""async id => Geo.gpx('x', 'hike', await Tours.points(id))""", ht["id"])
        assert "<gpxtpx:hr>140</gpxtpx:hr>" in exp
        pg.evaluate("location.hash='#/stats'"); pg.wait_for_selector("text=Ø Puls")
        assert "bpm" in pg.inner_text("#view")

        # Auswertung: Rekorde, Kalender, Auswertung (Neuland, Wetter), Ziele
        pg.route("**/archive-api.open-meteo.com/**", lambda r: r.fulfill(status=200, content_type="application/json", headers={"access-control-allow-origin": "*"}, body=json.dumps({"daily": {"temperature_2m_mean": [8.5], "temperature_2m_max": [12.0], "precipitation_sum": [2.4]}})))
        pg.evaluate("location.hash='#/stats'"); pg.wait_for_selector(".kpis")
        pg.get_by_role("button", name="Bestwerte", exact=True).click(); pg.wait_for_selector("text=Bester Tag"); tx = pg.inner_text("#view")
        assert "Längste Serie" in tx and "Beste Woche" in tx and "Je Sportart" in tx and "Bestwerte" in tx and "Bester Monat" not in tx, tx[:400]
        pg.get_by_role("button", name="Kalender", exact=True).click(); pg.wait_for_selector(".cal")
        assert pg.locator(".cd.l1, .cd.l2, .cd.l3, .cd.l4").count() >= 1
        pg.locator("button.cd").first.click(); pg.wait_for_selector(".sheet .li"); pg.evaluate("(sheet.stack || []).slice().forEach(x => x.close())"); pg.wait_for_selector(".sheet", state="detached")
        pg.get_by_role("button", name="Auswertung", exact=True).click(); pg.wait_for_selector("text=Statistik nach Aktivität")
        pg.get_by_role("button", name="Berechnen").click(); pg.wait_for_selector("text=Größte Entdeckungen", timeout=15000)
        nl = pg.evaluate("Tours.list().then(a => a.filter(t => t.nlCells != null).map(t => [t.nlNew, t.nlCells]))")
        assert len(nl) >= 3 and nl[0][1] > 0 and any(x[0] == 100 for x in nl), nl
        pg.get_by_role("button", name="Wetter laden").click(); pg.wait_for_selector("text=Touren mit Wetterdaten", timeout=15000)
        assert "an Regentagen" in pg.inner_text("#view") and "Kälteste Tour" in pg.inner_text("#view")
        pg.get_by_role("button", name="Ziele", exact=True).click(); pg.wait_for_selector("#goaladd")

        pg.route("**/nominatim.openstreetmap.org/**", lambda r: r.fulfill(status=500, body="x", headers={"access-control-allow-origin": "*"}))
        # Reisen & Alben: Reise aus 4 weit entfernten Tagen erkennen, Tags vergeben, Album-Seite
        rz = pg.evaluate("""async () => {
          const base = Date.UTC(2025, 5, 10, 8);
          const mk = (i, d) => Array.from({ length: 12 }, (_, k) => ({ lat: 46.5 + i * 0.01 + k * 0.0006, lon: 11.5 + k * 0.0005, ele: 1200 + k * 5, t: base + d * 86400000 + k * 60000 }));
          for (let d = 0; d < 5; d++) await Tours.add({ name: 'Reisetour ' + (d + 1), sport: 'hike', pts: mk(d, d), src: 'file' });
          await Set_.set('homeLat', '53.55'); await Set_.set('homeLon', '10.0');
          const all = (await Tours.list()).filter(t => t.status !== 'planned');
          const trips = Reisen.detect(all, [[53.55, 10.0]], await Reisen.settings());
          const none = Reisen.detect(all, [[46.5, 11.5]], await Reisen.settings());
          const rt = all.filter(t => /^Reisetour/.test(t.name));
          for (const t of rt) { t.tags = ['Südtirol 2025']; await Tours.save(t); }
          return { n: trips.length, tours: trips[0] && trips[0].tours.length, days: trips[0] && trips[0].days, none: none.length, rng: trips[0] && Reisen.range(trips[0].first, trips[0].last) };
        }""")
        assert rz["n"] == 1 and rz["tours"] == 5 and rz["days"] == 5 and rz["none"] == 0 and "Juni 2025" in rz["rng"], rz
        pg.evaluate("location.hash='#/reisen'"); pg.wait_for_selector("text=Reise 10.–14. Juni 2025"); assert "5 Touren an 5 Tagen" in pg.inner_text("#view")
        pg.get_by_role("button", name="Alben", exact=True).click(); pg.wait_for_selector("text=Südtirol 2025")
        pg.get_by_text("Südtirol 2025").first.click(); pg.wait_for_selector("text=Reisetour 3"); assert "Tage" in pg.inner_text("#view") and pg.locator(".map path").count() >= 1
        pg.evaluate("location.hash='#/reisen'"); pg.wait_for_selector(".seg"); pg.locator("a.li", has_text="Reise 10.").first.click(); pg.wait_for_selector("text=Als Album speichern")

        # Komoot: der Wert von Komoot wird nicht mehr übernommen, sondern nur aufbewahrt (neue und schon vorhandene Touren); der Aufstieg kommt aus der eigenen Rechnung
        ko = pg.evaluate("""async () => {
          const base = 1730000000000;
          const mk = (i) => Array.from({ length: 20 }, (_, k) => ({ lat: 48 + i * 0.1 + k * 0.0004, lon: 12 + k * 0.0003, alt: 500 + k * 3, t: k * 20000 }));
          await Tours.add({ name: 'K alt', sport: 'hike', pts: mk(1).map(c => ({ lat: c.lat, lon: c.lon, ele: c.alt, t: base + c.t })), src: 'komoot', srcId: 'komoot:555', start: base });
          Import.Komoot.tours = async () => [{ id: 555, name: 'K alt', sport: 'hike', date: new Date(base).toISOString(), elevation_up: 4321, elevation_down: 4000 },
                                               { id: 556, name: 'K neu', sport: 'hike', date: new Date(base + 86400000 * 3).toISOString(), elevation_up: 777, elevation_down: 700 },
                                               { id: 557, name: 'K ohne Höhe', sport: 'hike', date: new Date(base + 86400000 * 6).toISOString(), elevation_up: 612, elevation_down: 600 }];
          Import.Komoot.coords = async (acc, id) => mk(2).map(c => ({ lat: c.lat + (id === 556 ? 0.5 : id === 557 ? 1 : 0), lng: c.lon, alt: id === 557 ? null : c.alt, t: c.t }));
          const r = await Import.Komoot.importAll({ user: 'u', token: 't' }, { planned: false }, null);
          const l = await Tours.list();
          const g = s => l.find(t => t.srcId === s), a = g('komoot:555'), b = g('komoot:556'), c = g('komoot:557');
          const own = Geo.stats(mk(2).map(q => ({ lat: q.lat, lon: q.lon, ele: q.alt, t: q.t }))).up;
          return { r, own, a: [a.up, a.down, a.upSrc, a.upKomoot, a.downKomoot], b: [b.up, b.upSrc, b.upKomoot, b.downKomoot], c: [c.up, c.down, c.upSrc, c.upKomoot], txt: Import.describe(r), calcV: a.calcV };
        }""")
        assert ko["own"] > 40 and ko["a"][0] == ko["own"] and ko["a"][2] is None and ko["a"][3] == 4321 and ko["a"][4] == 4000 and ko["calcV"] == 2, ko      # vorhandene Tour: eigene Rechnung, Komoot-Wert nur aufbewahrt
        assert ko["b"] == [ko["own"], None, 777, 700], ko      # neue Tour genauso
        assert ko["c"] == [612, 600, "komoot", 612], ko      # ohne Höhen in der Spur: Komoot-Wert als Ersatz

        # 2.0.4: Namen von Komoot übernehmen – auch für Touren aus Zepp/Dateien (Abgleich über Startzeit und Länge, ohne die Spur zu laden);
        # ein in der App von Hand vergebener Name bleibt, ein in Komoot geänderter Name zieht nach
        kn = pg.evaluate("""async () => {
          const b2 = 1731000000000;
          const mk = (i, n) => Array.from({ length: n || 30 }, (_, k) => ({ lat: 28 + i * 0.2 + k * 0.0004, lon: -15.5 + k * 0.0003, ele: 500 + k * 3, t: b2 + i * 86400000 + k * 20000 }));
          const z = (await Tours.add({ sport: 'hike', pts: mk(1), src: 'zepp', srcId: 'zepp:kn1' })).tour;                       // Zepp: selbst erzeugter Name
          const m = (await Tours.add({ name: 'Selbst benannt', sport: 'hike', pts: mk(2), src: 'file' })).tour;                  // Datei: Name von Hand
          const w = (await Tours.add({ sport: 'walk', pts: mk(3), src: 'zepp', srcId: 'zepp:kn3' })).tour;                       // früher „Spazieren“, jetzt Wandern
          w.sportAlt = 'walk'; w.sport = 'hike'; await Tours.save(w);
          const auto = z.name, autoW = w.name;
          let coords = [];
          const kt = (id, name, i, extra) => Object.assign({ id, name, sport: 'hike', date: new Date(b2 + i * 86400000 + 60000).toISOString(), distance: Geo.stats(mk(i)).dist * 1.02 }, extra || {});
          let liste = [kt(900, 'Barranco de Azuaje', 1), kt(901, 'Komoot-Name B', 2), kt(902, 'Tamadaba-Runde', 3), kt(903, 'Nur bei Komoot', 9), kt(904, 'Falsche Länge', 1, { date: new Date(b2 + 86400000 + 200000).toISOString(), distance: 99000 })];
          Import.Komoot.tours = async () => liste;
          Import.Komoot.coords = async (acc, id) => { coords.push(id); return mk(id === 903 ? 9 : 12).map(c => ({ lat: c.lat, lng: c.lon, alt: c.ele, t: c.t - (b2 + (id === 903 ? 9 : 12) * 86400000) })); };
          const acc = { user: 'u', token: 't' }, get = async id => DB.get('tours', id);
          const r1 = await Import.Komoot.importAll(acc, { planned: false }, null), c1 = coords.slice(); coords = [];
          const s1 = { z: (await get(z.id)).name, zk: (await get(z.id)).komootId, m: (await get(m.id)).name, mk: (await get(m.id)).komootId, w: (await get(w.id)).name, txt: Import.describe(r1) };
          const r2 = await Import.Komoot.importAll(acc, { planned: false }, null), c2 = coords.slice(); coords = [];           // zweiter Lauf: nichts mehr zu tun, nichts wird geladen
          liste = liste.map(t => t.id === 900 ? Object.assign({}, t, { name: 'Azuaje, neu benannt' }) : t);
          const r3 = await Import.Komoot.importAll(acc, { planned: false }, null);                                              // in Komoot umbenannt: zieht nach
          const s3 = (await get(z.id)).name;
          const zz = await get(z.id); zz.name = 'Mein eigener Name'; await Tours.save(zz);                                       // in der App umbenannt: bleibt
          liste = liste.map(t => t.id === 900 ? Object.assign({}, t, { name: 'Dritter Komoot-Name' }) : t);
          const r4 = await Import.Komoot.importAll(acc, { planned: false }, null);
          const s4 = (await get(z.id)).name;
          const all = await Tours.list();
          const out = { auto, autoW, r1, c1, s1, r2, c2, r3: r3.names, s3, r4: r4.names, s4, neu: all.filter(t => t.srcId === 'komoot:903').length, falsch: all.filter(t => t.srcId === 'komoot:904').length };
          for (const t of all.filter(t => [z.id, m.id, w.id].includes(t.id) || /^komoot:90[34]$/.test(t.srcId || ''))) await Tours.remove(t.id);
          return out;
        }""")
        assert "Wandern" in kn["auto"] and "Spazieren" in kn["autoW"], kn
        assert kn["s1"]["z"] == "Barranco de Azuaje" and kn["s1"]["zk"] == "900" and kn["s1"]["w"] == "Tamadaba-Runde", kn      # selbst erzeugte Namen (auch mit früherer Sportart) werden ersetzt
        assert kn["s1"]["m"] == "Selbst benannt" and kn["s1"]["mk"] == "901", kn                                              # von Hand vergebener Name bleibt, die Zuordnung wird trotzdem gemerkt
        assert kn["r1"]["names"] == 2 and kn["r1"]["added"] == 2 and sorted(kn["c1"]) == [903, 904] and "Name bei 2 Touren von Komoot übernommen" in kn["s1"]["txt"], kn      # nur wirklich neue Touren werden geladen
        assert kn["neu"] == 1 and kn["falsch"] == 1, kn                                                                      # gleiche Zeit, aber ganz andere Länge: keine Zuordnung
        assert kn["r2"]["names"] == 0 and kn["r2"]["added"] == 0 and kn["c2"] == [], kn
        assert kn["r3"] == 1 and kn["s3"] == "Azuaje, neu benannt" and kn["r4"] == 0 and kn["s4"] == "Mein eigener Name", kn
        assert "Komoot übernommen" not in ko["txt"] and "up" not in ko["r"], ko
        kid = pg.evaluate("Tours.list().then(l => l.find(t => t.srcId === 'komoot:555').id)")
        pg.evaluate("id => { location.hash = '#/tour/' + id }", kid); pg.wait_for_selector(".tourp .facts"); assert "Komoot nennt" in pg.inner_text(".tourp .facts") and "4.321 m" in pg.inner_text(".tourp .facts"), pg.inner_text(".tourp .facts")
        pg.evaluate("location.hash = '#/start'")
        pg.evaluate("async () => { for (const t of await Tours.list()) if (/^K (alt|neu|ohne)/.test(t.name)) await Tours.remove(t.id); }")

        # Einmalige Neuberechnung (Version 2.0.1): alte Werte bleiben als upAlt, Touren ohne Höhen bleiben, Zepp „Spazieren“ → Wandern, zweiter Lauf tut nichts
        mg = pg.evaluate("""async () => {
          const N = 40, base = Date.UTC(2026, 4, 3, 8), noisy = (o, up) => Array.from({ length: N }, (_, k) => ({ lat: 47 + o + k * 0.0004, lon: 11 + k * 0.0003, ele: k === 7 ? -20000 : 600 + k * 2 + (k % 3) * 2.5 + (up || 0), t: base + k * 20000 }));
          const put = async (id, o, pts) => {
            const t = Object.assign({ id, name: id, sport: 'hike', status: 'done', start: base, end: base + N * 20000, dur: 780, moving: 700, dist: 500, up: 31, down: 5, maxAlt: 700, minAlt: 600, lat: 47, lon: 11, src: 'file', srcId: '', note: '', fav: false, hidden: false, timed: true, created: 1 }, o);
            await DB.put('tours', t);
            await DB.put('tracks', { id, lat: pts.map(p => p.lat), lon: pts.map(p => p.lon), ele: pts.map(p => p.ele), t: pts.map(p => p.t), seg: pts.map(() => 0) });
          };
          const mkpts = noisy(0.3);
          await put('mgA', { up: 9999, down: 8888, src: 'komoot', srcId: 'komoot:1', upSrc: 'komoot' }, mkpts);
          await put('mgB', { up: 123, down: 45 }, mkpts.map(p => Object.assign({}, p, { ele: null })));
          await put('mgC', { up: 888, down: 7, status: 'planned' }, noisy(0.35));
          await put('mgD', { sport: 'walk', src: 'zepp', srcId: 'zepp:1' }, noisy(0.4));
          await put('mgE', { sport: 'walk', src: 'zepp', srcId: 'zepp:2', sportMan: 1 }, noisy(0.45));
          await put('mgF', { sport: 'walk', src: 'file' }, noisy(0.5));
          await put('mgG', { sport: 'run', src: 'zepp', srcId: 'zepp:3' }, noisy(0.55));
          await put('mgH', { up: 500, down: 400, upKomoot: 500, downKomoot: 400, upSrc: 'komoot', src: 'komoot', srcId: 'komoot:2' }, mkpts.slice(0, 4));      // zu wenige Höhenpunkte: Komoot-Wert bleibt Ersatz
          const own = Geo.stats(mkpts), ids = ['mgA', 'mgB', 'mgC', 'mgD', 'mgE', 'mgF', 'mgG', 'mgH'];
          await DB.kvSet('calcVer', 0); await DB.kvSet('calcNote', null);
          let ui = 0; const iv = setInterval(() => ui++, 5);      // Oberfläche bleibt zwischen den Portionen ansprechbar
          const t0 = performance.now(); const r1 = await Tours.migrate({ batch: 2 }); const ms = performance.now() - t0; clearInterval(iv);
          const get = async id => DB.get('tours', id);
          const T = {}; for (const id of ids) T[id] = await get(id);
          const r2 = await Tours.migrate({ batch: 2 });
          const T2 = {}; for (const id of ids) T2[id] = await get(id);
          const note = await DB.kvGet('calcNote', null), ver = await DB.kvGet('calcVer', 0);
          // wiederaufnehmbar: Merker zurück, eine Tour von Hand verändert (calcV 2): wird übersprungen, die anderen sind unverändert
          await DB.kvSet('calcVer', 0); const x = await get('mgF'); x.up = 4242; await DB.put('tours', x); const r3 = await Tours.migrate();
          const keep = (await get('mgF')).up;
          return { own: [own.up, own.down], r1, r2, r3, T, same: ids.every(id => JSON.stringify(T[id]) === JSON.stringify(T2[id])), note, ver, ms, ui, keep };
        }""")
        T = mg["T"]; ou, od = mg["own"]
        assert 20 < ou < 80 and mg["r1"]["fail"] == 0 and mg["r1"]["n"] >= 8 and mg["r1"]["sport"] == 1, mg
        assert abs(T["mgA"]["up"] - ou) < 0.01 and abs(T["mgA"]["down"] - od) < 0.01 and T["mgA"]["upAlt"] == 9999 and T["mgA"]["downAlt"] == 8888 and T["mgA"]["upKomoot"] == 9999 and "upSrc" not in T["mgA"], T["mgA"]      # alter Komoot-Wert bleibt als Zusatz
        assert T["mgB"]["up"] == 123 and T["mgB"]["down"] == 45 and "upAlt" not in T["mgB"] and T["mgB"]["calcV"] == 2, T["mgB"]      # ohne Höhen: unverändert
        assert T["mgC"]["status"] == "planned" and T["mgC"]["upAlt"] == 888 and T["mgC"]["up"] != 888, T["mgC"]      # geplante Tour nach derselben Regel
        assert T["mgD"]["sport"] == "hike" and T["mgD"]["sportAlt"] == "walk", T["mgD"]
        assert T["mgE"]["sport"] == "walk" and T["mgF"]["sport"] == "walk" and T["mgG"]["sport"] == "run", [T["mgE"]["sport"], T["mgF"]["sport"], T["mgG"]["sport"]]      # von Hand gewählt, andere Quelle, Laufen: nicht angefasst
        assert T["mgH"]["up"] == 500 and T["mgH"]["upSrc"] == "komoot", T["mgH"]
        assert mg["r2"] is None and mg["same"] and mg["ver"] == 2, mg      # zweiter Lauf tut nichts
        assert mg["note"] == {"up": mg["r1"]["up"], "sport": 1} and mg["r1"]["up"] >= 4, mg
        assert mg["r3"]["n"] == 0 and mg["keep"] == 4242, mg      # Touren mit calcV 2 werden übersprungen
        print("Migration:", round(mg["ms"]), "ms für 8 Touren, Oberfläche-Ticks:", mg["ui"])
        # Der Hinweis auf der Startseite erscheint einmal und lässt sich schließen
        pg.evaluate("location.hash = '#/'"); pg.evaluate("location.hash = '#/start'"); pg.wait_for_selector("#calcnote")
        nt = pg.inner_text("#calcnote"); assert "Aufstieg neu berechnet – gleiche Rechnung wie in Meine Touren" in nt and "Zepp-Tour" in nt and "Spazieren" in nt, nt
        pg.click("#calc-ok"); pg.wait_for_selector("#calcnote", state="detached"); assert pg.evaluate("DB.kvGet('calcNote', 'x')") is None
        # Sicherung hin und zurück: neue Felder gehen mit, calcVer/calcNote nicht; alte Sicherung (ohne calcV) wird nach dem Einspielen neu gerechnet
        bk = pg.evaluate("""async () => {
          const data = await Backup.collect(); const a = data.tours.find(t => t.id === 'mgA');
          const kvk = data.kv.map(k => k.k);
          const old = JSON.parse(JSON.stringify(data)); old.tours.forEach(t => { if (t.id.startsWith('mg')) { delete t.calcV; delete t.upAlt; delete t.downAlt; } });
          const oa = old.tours.find(t => t.id === 'mgA'); oa.up = 7777; oa.down = 6666; oa.upKomoot = undefined; delete oa.upKomoot; delete oa.downKomoot; oa.upSrc = 'komoot';
          for (const id of ['mgA', 'mgB', 'mgC', 'mgD', 'mgE', 'mgF', 'mgG', 'mgH']) { await Tours.remove(id); }
          await Backup.apply(Backup.parse(fflate.gzipSync(new TextEncoder().encode(JSON.stringify(old)))));
          for (let i = 0; i < 100 && (await DB.kvGet('calcVer', 0)) < 2; i++) await new Promise(r => setTimeout(r, 50));
          const b = await DB.get('tours', 'mgA');
          return { fields: [a.upAlt, a.upKomoot, a.calcV], kvk, up: b.up, upAlt: b.upAlt, upKomoot: b.upKomoot, sport: (await DB.get('tours', 'mgD')).sport, ver: await DB.kvGet('calcVer', 0) };
        }""")
        assert bk["fields"] == [9999, 9999, 2] and "calcVer" not in bk["kvk"] and "calcNote" not in bk["kvk"], bk
        assert bk["ver"] == 2 and bk["upAlt"] == 7777 and bk["upKomoot"] == 7777 and abs(bk["up"] - ou) < 0.01 and bk["sport"] == "hike", bk
        pg.evaluate("async () => { for (const id of ['mgA', 'mgB', 'mgC', 'mgD', 'mgE', 'mgF', 'mgG', 'mgH']) await Tours.remove(id); await DB.kvSet('calcNote', null); }")

        # 2.0.3: Die Tourenliste merkt sich die Rollposition – Tour öffnen, zurückgehen, gleiche Stelle; der Reiter „Touren“ führt wieder nach oben
        pg.evaluate("""async gs => { const enc = s => new TextEncoder().encode(s); for (const [n, g] of gs) await Import.fromData(n, enc(g), 'file'); }""",
                    [[f"rp{i}.gpx", gpx(1600000000000 + 86400000 * i * 3, lat=45.0 + i * 0.05, name=f"Rollprobe {i}")] for i in range(14)])
        pg.evaluate("location.hash = '#/start'"); pg.evaluate("location.hash = '#/'"); pg.wait_for_selector("#view input[type=search]")
        pg.fill("#view input[type=search]", "Rollprobe"); pg.wait_for_function("() => document.querySelectorAll('#view a.tour').length === 14")
        y0 = pg.evaluate("() => { const v = document.querySelector('#view'); v.scrollTop = Math.min(600, v.scrollHeight - v.clientHeight); return v.scrollTop; }")
        assert y0 > 200, y0
        pg.evaluate("() => { const v = document.querySelector('#view').getBoundingClientRect(); const a = [...document.querySelectorAll('#view a.tour')].find(e => { const r = e.getBoundingClientRect(); return r.top > v.top + 80 && r.bottom < v.bottom - 120; }); a.click(); }")
        pg.wait_for_function("() => location.hash.startsWith('#/tour/')"); pg.wait_for_selector("#view .kpis")
        assert pg.evaluate("document.querySelector('#view').scrollTop") == 0
        pg.evaluate("history.back()")
        pg.wait_for_function("y => location.hash === '#/' && document.querySelectorAll('#view a.tour').length === 14 && Math.abs(document.querySelector('#view').scrollTop - y) <= 2", arg=y0)
        pg.click("#tabs a[data-p='/']"); pg.wait_for_function("() => document.querySelector('#view').scrollTop === 0 && document.querySelectorAll('#view a.tour').length === 14")
        pg.fill("#view input[type=search]", "")
        pg.evaluate("async () => { for (const t of (await Tours.list()).filter(t => /^Rollprobe/.test(t.name))) await Tours.remove(t.id); }")

        # 2.0.2: Spur aus einer FIT-Datei mit vorzeichenlos gelesener Länge (344,4° statt −15,6°) und Punkten ohne Position (180°/180°) wird berichtigt
        fx = pg.evaluate("""async () => {
          const n = 200, id = 'fxA';
          const lat = Array.from({ length: n }, (_, k) => 28.10 + k * 1e-4), lon = Array.from({ length: n }, (_, k) => 344.43 + k * 1e-5);
          lat[50] = lon[50] = 179.99999991618097; lat[120] = lon[120] = 179.99999991618097;
          const ele = Array.from({ length: n }, (_, k) => 500 + k), t = Array.from({ length: n }, (_, k) => 1.7e12 + k * 1000);
          const pts0 = lat.map((la, k) => ({ lat: la, lon: lon[k], ele: ele[k], t: t[k] })), st0 = Geo.stats(pts0);
          await DB.put('tours', { id, name: 'FIT West', sport: 'hike', status: 'done', start: t[0], dist: st0.dist, up: st0.up, down: st0.down, lat: lat[0], lon: lon[0], bbox: Geo.bbox(pts0), src: 'file', srcId: '', hidden: false, calcV: 2 });
          await DB.put('tracks', { id, lat, lon, ele, t, seg: lat.map(() => 0), hr: lat.map(() => 100) });
          await DB.put('tours', { id: 'fxB', name: 'Ost', sport: 'hike', status: 'done', start: 2, dist: 5, up: 1, down: 1, lat: 47, lon: 11, bbox: [47, 11, 47.1, 11.1], src: 'file', srcId: '', hidden: false, calcV: 2 });
          await DB.kvSet('posVer', 0); await DB.kvSet('calcNote', null);
          const r = await Tours.migrate(), r2 = await Tours.migrate();
          const a = await DB.get('tours', id), trk = await DB.get('tracks', id), b = await DB.get('tours', 'fxB'), note = await DB.kvGet('calcNote', null);
          const out = { vorher: st0.dist, r, r2, dist: a.dist, lon: a.lon, bbox: a.bbox, n: trk.lat.length, hr: trk.hr.length, seg: trk.seg.length, maxLon: Math.max(...trk.lon), maxLat: Math.max(...trk.lat), b: b.dist, note, ver: await DB.kvGet('posVer', 0) };
          await Tours.remove(id); await Tours.remove('fxB'); await DB.kvSet('calcNote', null);
          return out;
        }""")
        assert fx["vorher"] > 1e7 and 2000 < fx["dist"] < 3000, fx                      # vorher zehntausende Kilometer, danach die echten gut 2 km
        assert fx["r"]["pos"] == 1 and fx["r2"] is None and fx["ver"] == 1, fx           # genau die betroffene Tour, kein zweiter Lauf
        assert fx["n"] == 198 and fx["hr"] == 198 and fx["seg"] == 198 and fx["maxLon"] < -15 and fx["maxLat"] < 29 and abs(fx["lon"] + 15.57) < 0.01 and fx["bbox"][3] < 0, fx
        assert fx["b"] == 5 and fx["note"] == {"pos": 1}, fx                             # unauffällige Tour unberührt; Hinweis für die Startseite

        # Laufzeit: 800 Touren mit je 3000 Punkten neu rechnen (Messung im Browser; auf dem Handy etwa 3–10 mal langsamer)
        lz = pg.evaluate("""async () => {
          const ids = [];
          for (let i = 0; i < 800; i++) {
            const id = 'lz' + i, n = 3000;
            await DB.put('tours', { id, name: id, sport: 'hike', status: 'done', start: 1, up: 1, down: 1, src: 'file', srcId: '', hidden: false });
            await DB.put('tracks', { id, lat: Array.from({ length: n }, (_, k) => 47 + k * 1e-5), lon: Array.from({ length: n }, (_, k) => 11 + k * 1e-5), ele: Array.from({ length: n }, (_, k) => 800 + 300 * Math.sin(k / 150) + (k * 7 % 5)), t: Array.from({ length: n }, (_, k) => 1e12 + k * 5000), seg: Array.from({ length: n }, () => 0) });
            ids.push(id);
          }
          await DB.kvSet('calcVer', 0);
          const t0 = performance.now(); const r = await Tours.migrate(); const ms = performance.now() - t0;
          const one = await DB.get('tours', 'lz5');
          for (const id of ids) await Tours.remove(id);
          await DB.kvSet('calcNote', null);
          return { ms, up: r.up, n: r.n, one: one.up };
        }""")
        assert lz["n"] >= 800 and lz["up"] == 800 and lz["one"] > 1000, lz
        print("Laufzeit Neuberechnung 800 Touren x 3000 Punkte:", round(lz["ms"] / 1000, 1), "s")

        # Zepp per Token: schlechte Eingabe abgelehnt, gutes Token geprüft (Server vorgetäuscht) und gemerkt, Sheet zeigt Abmelden
        pg.evaluate("location.hash='#/import'"); pg.wait_for_selector(".list")
        pg.evaluate("window.__http0 = Native.http")
        zr = pg.evaluate("""async () => {
          const seen = []; Native.http = async o => { seen.push(o.url + '|' + (o.headers || {}).apptoken); return { status: 200, body: JSON.stringify({ code: 1, data: { summary: [], next: -1 } }) }; };
          let bad = ''; try { await Import.Zepp.useToken('kurz'); } catch (e) { bad = e.message; }
          const acc = await Import.Zepp.useToken(' apptoken=abcDEF123456abcDEF123456; Path=/ ', 'api-mifit-de2.zepp.com/');
          const kv = await DB.kvGet('zepp', null);
          return { bad, host: acc.host, token: kv && kv.token, via: kv && kv.viaToken, seen };
        }""")
        assert "Token" in zr["bad"] and zr["token"] == "abcDEF123456abcDEF123456" and zr["via"] and zr["host"] == "https://api-mifit-de2.zepp.com", zr
        assert zr["seen"][0].startswith("https://api-mifit-de2.zepp.com/v1/sport/run/history.json|abcDEF"), zr
        pg.get_by_text("Zepp / Amazfit").click(); pg.wait_for_selector("text=Angemeldet (mit Token)")
        assert pg.get_by_text("Höhe für alle Touren abgleichen").count() == 1
        # Sammel-Abgleich: ohne passende Touren/Trainings nichts zu tun, Verlauf wird geladen
        zb = pg.evaluate("""async () => {
          const o = Import.Zepp.req; let calls = 0;
          Import.Zepp.req = async () => { calls++; return { data: { summary: [], next: -1 } }; };
          try { const r = await Fix.zeppEleAll({ token: 'x' }, null); return { r, calls }; } finally { Import.Zepp.req = o; }
        }""")
        assert zb["r"]["total"] == 0 and zb["r"]["done"] == 0 and zb["calls"] == 1, zb
        pg.get_by_text("Zugang testen").click(); pg.wait_for_selector("text=Zugang funktioniert")
        pg.get_by_text("Abmelden").click(); pg.wait_for_selector("text=Prüfen & laden")
        assert pg.evaluate("() => !document.querySelector('input[placeholder^=\"Token einfügen\"]').closest('div[hidden]')")

        # Zepp: Puls wird mitdekodiert und bei früher importierten Touren nachgetragen
        zh = pg.evaluate("""async () => {
          const hrraw = ',72' + Array.from({ length: 12 }, (_, i) => ';5,' + (i % 2 ? -3 : 4)).join('');
          const det = { time: '0' + ';5'.repeat(12), longitude_latitude: '100000000,5000000000' + ';1000,1000'.repeat(12), altitude: '50000' + ';10'.repeat(12), heart_rate: hrraw, gait: '0' };
          const pts = Import.Zepp.decode({ trackid: '1700000000' }, det);
          const withHr = pts.filter(p => p.hr != null).length;
          const noHr = pts.map(p => ({ lat: p.lat, lon: p.lon, ele: p.ele, t: p.t }));
          const r = await Tours.add({ sport: 'walk', pts: noHr, src: 'zepp', srcId: 'zepp:1700000000' });
          const before = r.tour.hrAvg || null;
          const ok = await Tours.fillHr(r.tour.id, pts);
          const t2 = (await Tours.list()).find(t => t.id === r.tour.id);
          const again = await Tours.points(r.tour.id);
          return { n: pts.length, withHr, before, ok, avg: t2.hrAvg, zhr: t2.zhr, stored: again.filter(p => p.hr).length };
        }""")
        # Komoot-Tour (andere Quelle, Startzeit 1 h verschoben): wird erkannt, Puls kommt nach Zeit seit Start auf die Punkte
        km = pg.evaluate("""async () => {
          const det = { time: '0' + ';5'.repeat(12), longitude_latitude: '200000000,5100000000' + ';1000,1000'.repeat(12), altitude: '50000' + ';10'.repeat(12),
            heart_rate: ',90' + ';5,1'.repeat(12), gait: '0' };
          const s = { trackid: '1710000000' };
          const zp = Import.Zepp.decode(s, det);
          const gs = Geo.stats(zp); s.dis = String(gs.dist); s.run_time = String(gs.dur);
          const shifted = zp.map(p => ({ lat: p.lat, lon: p.lon, ele: p.ele, t: p.t + 3600000 }));
          const r = await Tours.add({ sport: 'hike', pts: shifted, src: 'komoot', srcId: 'komoot:42' });
          const m = Import.Zepp.match(s, await Tours.list());
          const ok = m && await Tours.fillHr(m.id, zp, 1710000000000);
          const t2 = (await Tours.list()).find(t => t.id === r.tour.id);
          const none = Import.Zepp.match({ trackid: '1500000000', dis: '999', run_time: '60' }, await Tours.list());
          return { matched: !!m, ok, avg: t2.hrAvg, none: none === null };
        }""")
        assert km["matched"] and km["ok"] and 88 <= km["avg"] <= 100 and km["none"], km
        assert zh["withHr"] == zh["n"] and zh["before"] is None and zh["ok"] and 70 <= zh["avg"] <= 80 and zh["zhr"] == 1 and zh["stored"] > 5, zh

        pg.evaluate("Native.http = window.__http0")
        # Tour verbessern: Höhen aus Gelände (Kachel mit konstant 1500 m) und Track korrigieren
        import zlib, struct
        def _chunk(k, d): return struct.pack(">I", len(d)) + k + d + struct.pack(">I", zlib.crc32(k + d) & 0xffffffff)
        raw = b"".join(b"\x00" + bytes([132, 220, 0]) * 256 for _ in range(256))     # 132*256+220-32768 = 1244 m
        elev_png = b"\x89PNG\r\n\x1a\n" + _chunk(b"IHDR", struct.pack(">IIBBBBB", 256, 256, 8, 2, 0, 0, 0)) + _chunk(b"IDAT", zlib.compress(raw)) + _chunk(b"IEND", b"")
        pg.route("**/elevation-tiles-prod/**", lambda r: r.fulfill(status=200, body=elev_png, content_type="image/png", headers={"access-control-allow-origin": "*"}))
        fx = pg.evaluate("""async () => {
          const base = Date.UTC(2025, 7, 1, 8);
          const pts = Array.from({ length: 40 }, (_, k) => ({ lat: 47.1 + k * 0.0004, lon: 11.1, ele: 1000 + (Math.floor(k / 4) % 2 ? 150 : 0), t: base + k * 30000 }));
          const r = await Tours.add({ name: 'Zackig', sport: 'hike', pts, src: 'file' });
          return { id: r.tour.id, up: r.tour.up };
        }""")
        assert fx["up"] > 400, fx
        pg.evaluate("location.hash = '#/tour/' + %s" % json.dumps(fx["id"])); pg.wait_for_selector("#fixbanner")
        pg.evaluate("document.querySelectorAll('.sheet-back').forEach(e => e.remove())"); pg.click("#fixbanner"); pg.wait_for_function("() => /Aufstieg [^ ]+ m? ?→|Nicht möglich/.test(document.body.innerText)", timeout=15000)
        t2 = pg.evaluate("async (id) => (await Tours.list()).find(t => t.id === id)", fx["id"])
        assert t2["elevFix"] == 1 and t2["up"] < 5 and abs(t2["maxAlt"] - 1244) < 2, t2
        back = pg.evaluate("async (id) => { const t = (await Tours.list()).find(t => t.id === id); return Fix.restoreEle(t); }", fx["id"])
        assert back["up"] > 400 and not back.get("elevFix"), back
        # Höhe aus Uhr: Menüeintrag da, ohne Zepp-Zugang klare Meldung statt Absturz
        pg.evaluate("DB.kvSet('zepp', null)")
        pg.evaluate("location.hash = '#/tour/' + %s" % json.dumps(fx["id"])); pg.wait_for_selector("header.top button[aria-label=Aktionen]")
        pg.evaluate("document.querySelectorAll('.sheet-back').forEach(e => e.remove())")
        pg.locator("header.top button[aria-label=Aktionen]").click(); pg.get_by_text("Höhe aus Uhr abgleichen (Zepp)").click()
        pg.wait_for_function("() => /Zepp-Zugang fehlt/.test(document.body.innerText)", timeout=8000)
        # Track: Ausreißer + zu schneller Abschnitt
        tf = pg.evaluate("""async () => {
          const base = Date.UTC(2025, 7, 2, 8);
          const pts = Array.from({ length: 30 }, (_, k) => ({ lat: 47.2 + k * 0.0002, lon: 11.2, ele: 900, t: base + k * 30000 }));
          pts[10] = { ...pts[10], lat: 47.3 };                                    // Sprung weg und zurück
          for (let k = 20; k < 30; k++) pts[k] = { ...pts[k], lat: 47.2 + 0.004 + (k - 20) * 0.01 };   // 1,1 km in 30 s
          const r = await Tours.add({ name: 'Sprung', sport: 'hike', pts, src: 'file' });
          const p = await Tours.points(r.tour.id), f = Fix.detect(p, 'hike');
          return { id: r.tour.id, dist: r.tour.dist, spike: f.spike, fast: f.fast.length };
        }""")
        assert tf["spike"] == [10] and tf["fast"] >= 1, tf
        pg.evaluate("location.hash = '#/fix/' + %s" % json.dumps(tf["id"])); pg.wait_for_selector("#fx-spike")
        pg.click("#fx-spike"); pg.wait_for_selector("#fx-restore")
        pg.evaluate("location.hash = '#/fix/' + %s" % json.dumps(tf["id"])); pg.wait_for_selector("#fx-fast")
        pg.click("#fx-fast"); pg.wait_for_selector("text=Schnelle Abschnitte ausgeschlossen")
        af = pg.evaluate("async (id) => { const t = (await Tours.list()).find(t => t.id === id); const p = await Tours.points(id); return { dist: t.dist, n: p.length, skip: p.filter(x => x.skip).length }; }", tf["id"])
        assert af["n"] == 29 and af["skip"] >= 5 and af["dist"] < 600, af
        rs = pg.evaluate("async (id) => { await Fix.restoreTrack(id); await Tours.recalc(id); const p = await Tours.points(id); return { n: p.length, skip: p.filter(x => x.skip).length }; }", tf["id"])
        assert rs["n"] == 30 and rs["skip"] == 0, rs

        # Urlaub mit Strandtagen (Pausen bis 4 Tage) bleibt eine Reise und heißt nach dem Ort
        pg.route("**/nominatim.openstreetmap.org/**", lambda r: r.fulfill(status=200, content_type="application/json", headers={"access-control-allow-origin": "*"}, body=json.dumps({"address": {"country": "La Réunion", "country_code": "re"}})))
        pg.evaluate("""async () => {
          const base = Date.UTC(2026, 5, 3, 8);
          for (const d of [0, 1, 5, 6, 10]) await Tours.add({ name: d < 2 ? 'Réunion Tag ' + (d + 1) : 'Réunion ' + d, sport: 'hike', pts: Array.from({ length: 12 }, (_, k) => ({ lat: -21.1 + d * 0.01 + k * 0.0006, lon: 55.5 + k * 0.0005, ele: 900 + k * 6, t: base + d * 86400000 + k * 60000 })), src: 'file' });
        }""")
        pg.evaluate("location.hash='#/reisen'"); pg.wait_for_selector("text=La Réunion Frühjahr 2026", timeout=15000)
        assert "5 Touren an 5 Tagen" in pg.inner_text("#view"), pg.inner_text("#view")
        pg.wait_for_selector("text=Mehrtagestouren"); assert "2 Etappen" in pg.inner_text("#view"), pg.inner_text("#view")
        pg.locator("a.li", has_text="2 Etappen").first.click(); pg.wait_for_selector("text=Tag 1 · Etappe 1/2"); assert "Tag 2 · Etappe 2/2" in pg.inner_text("#view"), pg.inner_text("#view")
        pg.locator("a.li", has_text="Etappe 2/2").first.click(); pg.wait_for_selector("#stage"); assert "Tag 2 · Etappe 2/2" in pg.inner_text("#stage"), pg.inner_text("#stage")
        # Inselreise: zwei Inseln, Herbst
        pg.evaluate("""async () => {
          const base = Date.UTC(2026, 9, 5, 8);
          const mk = (la, lo, d) => Array.from({ length: 12 }, (_, k) => ({ lat: la + k * 0.0006, lon: lo + k * 0.0005, ele: 400 + k * 6, t: base + d * 86400000 + k * 60000 }));
          const pl = [[28.10, -17.20], [28.11, -17.21], [28.09, -17.19], [27.95, -15.60], [27.96, -15.61]];
          for (let d = 0; d < 5; d++) await Tours.add({ name: 'Insel ' + d, sport: 'hike', pts: mk(pl[d][0], pl[d][1], d), src: 'file' });
        }""")
        pg.evaluate("location.hash='#/reisen'"); pg.wait_for_selector("text=La Gomera und Gran Canaria Herbst 2026", timeout=15000)
        # Reise ausblenden / wieder einblenden / Zeitraum ändern
        pg.locator("a.li", has_text="La Gomera und Gran Canaria").first.click(); pg.wait_for_selector("text=Ausblenden")
        pg.get_by_role("button", name="Zeitraum ändern").click(); pg.wait_for_selector("text=Zeitraum der Reise")
        pg.locator("input[type=date]").nth(1).fill("2026-10-07"); pg.get_by_role("button", name="Speichern", exact=True).click(); pg.wait_for_selector(".kpi:has-text('Touren') b:text-is('3')", timeout=8000)
        pg.get_by_role("button", name="Ausblenden").click(); pg.wait_for_selector("text=Ausgeblendete Reisen (1)")
        assert "La Gomera und Gran Canaria" not in pg.inner_text("#view").split("Ausgeblendete")[0], pg.inner_text("#view")
        pg.locator("details summary", has_text="Ausgeblendete").click(); pg.locator("a.li", has_text="La Gomera").first.click(); pg.get_by_role("button", name="Wieder einblenden").click(); pg.wait_for_selector("text=La Gomera und Gran Canaria")
        pg.evaluate("async () => { await DB.kvSet('tripPeriod', {}); }")
        # Jahr und Region liegen hinter „Filter“; der Zähler am Knopf zeigt, wie viele davon gesetzt sind
        pg.evaluate("location.hash = '#/'"); pg.wait_for_selector("#filterbtn"); assert pg.locator("#filterbtn i").count() == 0
        pg.click("#filterbtn"); pg.wait_for_selector("select[aria-label='Region']:not([hidden])")
        pg.select_option("select[aria-label='Region']", label="La Gomera (3)"); pg.wait_for_function("document.querySelectorAll('a.tour').length === 3")
        assert "Insel" in pg.inner_text("a.tour"), pg.inner_text("#view")
        pg.click("#filterok"); pg.wait_for_selector(".sheet", state="detached"); assert pg.inner_text("#filterbtn i") == "1"
        pg.click("#filterbtn"); pg.select_option("select[aria-label='Region']", label="Alle Regionen"); pg.click("#filterok"); pg.wait_for_selector(".sheet", state="detached")
        assert pg.locator("#filterbtn i").count() == 0
        # Suche ohne Treffer: der leere Zustand bietet an, Suche und Filter zurückzusetzen
        pg.fill("input[type=search]", "gibtesnicht"); pg.wait_for_selector(".tours .empty"); assert pg.locator("a.tour").count() == 0
        pg.get_by_role("button", name="Suche und Filter zurücksetzen").click(); pg.wait_for_selector("a.tour")
        # Tourzeile: Miniatur fester Größe, Titel, „Datum · Sportart“, Kennzahlen; Monatsüberschrift mit Summe
        row = pg.evaluate("(() => { const a = document.querySelector('a.tour'), r = a.querySelector('.tr-pv').getBoundingClientRect(); return { w: r.width, h: r.height, meta: a.querySelector('.tb small').innerText, met: a.querySelector('.met').innerText, month: document.querySelector('.month').innerText }; })()")
        assert row["w"] == 72 and row["h"] == 72 and " · " in row["meta"] and "↑" in row["met"] and ("Tour" in row["month"] and "km" in row["month"]), row
        pg.evaluate("location.hash = '#/'"); pg.wait_for_selector("a.tour small.stage"); assert "Etappe" in pg.inner_text("a.tour small.stage")

        # Namensvorschläge: Start-/Zielort über Nominatim, Gipfel über Overpass (vorgetäuscht)
        pg.route("**/nominatim.openstreetmap.org/reverse**", lambda r: r.fulfill(status=200, content_type="application/json", headers={"access-control-allow-origin": "*"}, body=json.dumps({"address": {"village": "Ort-" + r.request.url.split("lat=")[1][:5]}})))
        pg.route("**/overpass-api.de/**", lambda r: r.fulfill(status=200, content_type="application/json", headers={"access-control-allow-origin": "*"}, body=json.dumps({"elements": [{"lat": 47.0, "lon": 11.0, "tags": {"name": "Hoher Test"}}]})))
        nm = pg.evaluate("""async () => {
          const base = Date.UTC(2025, 8, 1, 8);
          const pts = Array.from({ length: 30 }, (_, k) => ({ lat: 47.5 + k * 0.004, lon: 11.5, ele: 800 + k * 20, t: base + k * 60000 }));
          const r = await Tours.add({ name: 'Alt', sport: 'hike', pts, src: 'file' });
          return Suggest.names(r.tour, await Tours.points(r.tour.id));
        }""")
        assert any(x.startswith("Wanderung von Ort-") for x in nm) and any("Hoher Test" in x for x in nm), nm

        # Untere Leiste: fünf Reiter, „Aufnehmen“ in der Mitte und hervorgehoben, alle gut tippbar
        pg.evaluate("location.hash = '#/'"); pg.wait_for_selector("#tabs a[data-p='/mehr']")
        tabs = pg.evaluate("[...document.querySelectorAll('#tabs a')].map(a => [a.dataset.p, a.innerText.trim(), Math.round(a.getBoundingClientRect().width), a.classList.contains('rec')])")
        assert [t[0] for t in tabs] == ["/start", "/", "/rec", "/photos", "/mehr"] and [t[1] for t in tabs] == ["Start", "Touren", "Aufnehmen", "Fotos", "Mehr"], tabs
        assert min(t[2] for t in tabs) >= 64 and [t[3] for t in tabs] == [False, False, True, False, False], tabs
        disc = pg.evaluate("(() => { const r = document.querySelector('#tabs a.rec .ti').getBoundingClientRect(); return [r.width, r.height]; })()")
        assert min(disc) >= 48, disc
        # Jede bisherige Funktion bleibt erreichbar: „Mehr“ führt zu Planen, Karte, Reisen, Statistik, Import, Foto-Quellen, Einstellungen
        pg.click("#tabs a[data-p='/mehr']"); pg.wait_for_selector("#m-settings")
        hrefs = pg.evaluate("[...document.querySelectorAll('#view a.li')].map(a => a.getAttribute('href'))")
        assert hrefs == ["#/plan", "#/map", "#/fuehrer", "#/reisen", "#/stats", "#/jahr", "#/import", "#/sources", "#/settings"], hrefs
        # Reisen liegt unter „Mehr“; die Leiste bleibt dort sichtbar und „Mehr“ markiert, auf Arbeitsseiten verschwindet sie
        pg.click("#m-reisen"); pg.wait_for_selector("text=Mehrtagestouren"); pg.wait_for_function("document.querySelector(\"#tabs a[data-p='/mehr']\").classList.contains('on') && !document.querySelector('#tabs').classList.contains('hide')", timeout=10000)
        anyid = pg.evaluate("Tours.list().then(l => l[0].id)")
        for path, tab, hidden in [("/start", "/start", False), ("/", "/", False), ("/map", "/", False), ("/rec", "/rec", False), ("/photos", "/photos", False), ("/mehr", "/mehr", False), ("/stats", "/mehr", False),
                                  ("/tour/" + anyid, "/", True), ("/plan", "/mehr", True), ("/import", "/mehr", True), ("/settings", "/mehr", True), ("/sources", "/mehr", True)]:
            pg.evaluate("p => { location.hash = '#' + p }", path)
            pg.wait_for_function("([p, t, h]) => Nav.cur === '/' + (p.split('/')[1] || '') && !Nav._busy && [...document.querySelectorAll('#tabs a.on')].map(a => a.dataset.p).join() === t && document.querySelector('#tabs').classList.contains('hide') === h", arg=[path, tab, hidden], timeout=10000)
        # Zurück-Taste des Handys: von einer Unterseite zurück, von einem Reiter zur Startseite, auf der Startseite verlässt sie die App
        pg.evaluate("location.hash = '#/mehr'"); pg.wait_for_selector("#m-settings"); pg.click("#m-settings"); pg.wait_for_selector("input[placeholder^='Ort oder Adresse']")
        assert pg.evaluate("window.mtBack()") is True; pg.wait_for_function("location.hash === '#/mehr'")
        assert pg.evaluate("window.mtBack()") is True; pg.wait_for_function("location.hash === '#/start'"); pg.wait_for_selector("#hero")
        assert pg.evaluate("window.mtBack()") is False
        # Läuft eine Aufzeichnung, ist die Scheibe „Aufnehmen“ rot und die Startseite führt zur laufenden Aufzeichnung
        pg.evaluate("window.__rec.state = 'recording'; Nav.render()"); pg.wait_for_selector("#tabs a.rec.live"); pg.wait_for_selector("#startrec.live")
        assert "läuft" in pg.inner_text("#startrec")
        pg.evaluate("window.__rec.state = 'idle'; Nav.render()"); pg.wait_for_selector("#tabs a.rec:not(.live)"); pg.wait_for_selector("#startrec:not(.live)")
        # Karte und Liste sind zwei Ansichten der Touren
        pg.evaluate("location.hash = '#/'"); pg.wait_for_selector("#tomap"); pg.click("#tomap"); pg.wait_for_selector(".map.full"); pg.click("#tolist"); pg.wait_for_selector("#touradd")
        # Fotos vom Rechner empfangen: Adresse wird angezeigt, per Abruf eingegangene Fotos werden übernommen
        pg.evaluate("location.hash = '#/photos'"); pg.wait_for_selector("button[aria-label='Fotos hinzufügen']"); pg.click("button[aria-label='Fotos hinzufügen']")
        pg.get_by_text("Vom Rechner im WLAN").click(); pg.wait_for_selector("#recvurl"); assert "192.168.0.5:8765/abc12/" in pg.inner_text("#recvurl")
        pg.evaluate("window.__upl = [{ id: 'rcaaaaaaaa', name: 'r.jpg', ts: 1700000000000, w: 10, h: 10, src: 'rechner' }]")
        pg.wait_for_selector("text=1 Foto(s) empfangen", timeout=10000)
        pg.keyboard.press("Escape"); pg.evaluate("document.querySelectorAll('.sheet-back').forEach(e => e.remove())")
        assert pg.evaluate("async () => !!(await DB.get('photos', 'rcaaaaaaaa'))")
        # Streckenfarbe und Diashow
        pg.evaluate("async () => { await Set_.set('routeColor', '#d81b60'); const l = await Tours.list(); location.hash = '#/tour/' + l[0].id; }")
        pg.wait_for_selector(".tmap"); assert pg.evaluate("MapKit.routeColor('hike') === '#d81b60' && MapKit.routeColor('ebike') === '#d81b60'")
        pg.evaluate("Set_.set('routeColor', '')"); assert pg.evaluate("MapKit.routeColor('hike')") == '#2e7d32'
        pg.evaluate("""async () => { const l = await Tours.list(); const t = l[0];
          for (const k of [1, 2, 3]) await DB.put('photos', { id: 'sh' + k + 'aaaaaa', name: 's.jpg', ts: t.start + k * 1000, tour: t.id, w: 10, h: 10, src: 'galerie' }); location.hash = '#/tour/' + t.id; Nav.render(); }""")
        pg.wait_for_selector("#tshow"); pg.click("#tshow"); pg.wait_for_selector(".sh .sh-cap")
        assert "1 / 3" in pg.inner_text(".sh-cap"), pg.inner_text(".sh-cap")
        pg.mouse.click(350, 400); pg.wait_for_function("() => document.querySelector('.sh-cap').innerText.includes('2 / 3')")
        pg.keyboard.press("Escape"); pg.wait_for_selector(".sh", state="detached")

        # 3D-Flug: Ansicht öffnet, Karte entsteht, Kopfzeile zeigt Strecke/Höhe, Ende zeigt „Nochmal“
        fl = pg.evaluate("async () => { const l = await Tours.list(); location.hash = '#/flug/' + l[0].id; return l[0].id; }")
        pg.wait_for_selector(".flight .fm canvas", timeout=20000)
        pg.wait_for_function("() => (document.querySelector('.fhud')?.innerText || '').includes('↑')", timeout=30000)
        pg.wait_for_selector(".flight.idle", timeout=15000)      # Bedienelemente blenden sich aus …
        pg.dispatch_event(".flight .fm", "pointerdown"); pg.wait_for_selector(".flight:not(.idle)", timeout=10000)      # … und kommen per Tipp zurück
        pg.select_option("#fv", "8"); pg.fill("#fs", "990") if False else pg.evaluate("document.querySelector('#fs').value = 1000; document.querySelector('#fs').dispatchEvent(new Event('input'))")
        pg.wait_for_function("() => document.querySelector('#fp').innerText.includes('Nochmal')", timeout=20000)
        pg.evaluate("location.hash = '#/'"); pg.wait_for_function("() => !document.querySelector('.flight')")

        # Reiseflug über mehrere Touren (zwei Inseln) mit Video-Aufnahme
        ids = pg.evaluate("async () => (await Tours.list()).filter(t => /^Insel/.test(t.name)).map(t => t.id).join(',')")
        pg.evaluate("window.__saved = null; Flug.title = 'Inselreise'; location.hash = '#/flug/set:' + %s" % json.dumps(ids))
        pg.wait_for_function("() => (document.querySelector('.fhud')?.innerText || '').includes('Insel')", timeout=30000)
        pg.select_option("#fv", "8"); pg.evaluate("document.querySelector('#frec').click()"); pg.wait_for_function("() => window.__flugRec && window.__flugRec()", timeout=90000)
        pg.wait_for_timeout(2000)
        pg.evaluate("document.querySelector('#fs').value = 1000; document.querySelector('#fs').dispatchEvent(new Event('input'))")
        pg.wait_for_function("() => window.__saved && /^flug-/.test(window.__saved.path || '')", timeout=30000)
        assert pg.evaluate("window.__saved.name") == "Inselreise.webm" or pg.evaluate("window.__saved.name").endswith((".webm", ".mp4")), pg.evaluate("window.__saved")
        pg.evaluate("location.hash = '#/'"); pg.wait_for_function("() => !document.querySelector('.flight')")

        # Zeitzonentolerante Fotozuordnung: tzOff > 0 heißt, die Kamerazeit geht der echten (GPS-)Zeit um tzOff vor (Prüfzeit = ts − tzOff)
        tz = pg.evaluate("""async (t0) => {
          const H = 3600000;
          await Photos.addMeta([{id:'tz4h000001',name:'tz.jpg',ts:t0+300000+4*H,w:10,h:10,src:'galerie'},{id:'tz20h00002',name:'tz2.jpg',ts:t0+300000+20*H,w:10,h:10,src:'galerie'}]);
          const all = await DB.all('photos'); return [all.find(x => x.id === 'tz4h000001'), all.find(x => x.id === 'tz20h00002'), (await Tours.list()).find(t => t.name === 'Hüttenrunde').id];
        }""", t0)
        assert tz[0]["tour"] == tz[2] and tz[0]["tzOff"] == 4 * 3600000 and tz[0]["ts"] == t0 + 300000 + 4 * 3600000, tz[0]      # ts bleibt unverändert
        assert tz[0]["pos"] == "track" and abs(tz[0]["lat"] - 47.0) < 0.05, tz[0]      # Position aus der Spur zur korrigierten Zeit
        assert not tz[1]["tour"] and "tzOff" not in tz[1], tz[1]      # 20 h daneben: kein Fenster, bleibt unzugeordnet

        meine_touren(pg)
        senden(pg)
        uhr_hoehen(pg)
        doppelte(pg)
        winter(pg)
        sterne(pg)
        alles(pg)
        alles_echt(pg)
        jahr_bad = jahr(pg)
        pdf(pg)
        pdf_karte(pg)
        blaetter(pg)
        neu = neue_funktionen(pg)
        fu_bad = fuehrer(pg)

        # Kachelfoto: auch bei lauter Personenfotos und bei einer früher gemerkten Zeichnung kommt ein Foto (2.3.1)
        k = pg.evaluate("""async () => {
          const t = (await Tours.list()).find(x => x.name === 'Hüttenrunde');
          for (let i = 0; i < 6; i++) await DB.put('photos', { id: 'kachel0' + i, name: 'k' + i + '.jpg', ts: 1700000300000 + i * 1000, w: 10, h: 10, src: 'galerie', tour: t.id, faces: 2 });
          const memo = { [t.id]: { kind: 'svg' } }, pv = document.createElement('span');
          await UI.thumb(pv, t, memo, null);
          const a = { img: !!pv.querySelector('img'), kind: memo[t.id].kind };
          const pv2 = document.createElement('span'), m2 = { [t.id]: { kind: 'svg', n: (await DB.byIndex('photos', 'tour', t.id)).filter(x => !x.video).length } };      // gleiche Fotozahl: Zeichnung bleibt
          await UI.thumb(pv2, t, m2, null); a.keep = !pv2.querySelector('img') && m2[t.id].kind === 'svg';
          for (let i = 0; i < 6; i++) await DB.del('photos', 'kachel0' + i);
          return a;
        }""")
        assert k["img"] and k["kind"] == "photo" and k["keep"], k

        # Gestaltung: kein Querrollen bei 360–430 px, auch mit 130 % Schrift; Tippflächen mindestens 44 px
        pg.evaluate("document.querySelectorAll('.sheet-back').forEach(e => e.remove())")
        lt = pg.evaluate("Tours.list().then(l => l.filter(t => t.status !== 'planned' && !t.hidden)[0].id)")
        bad = layout_check(pg, ["#/start", "#/", "#/map", "#/rec", "#/photos", "#/mehr", "#/stats", "#/stats/rekorde", "#/stats/kalender", "#/stats/auswertung", "#/stats/ziele", "#/reisen", "#/import", "#/settings", "#/sources", "#/plan", "#/tour/" + lt, "#/story/" + lt, "#/fix/" + lt])
        bad += neue_layout(pg, neu)
        bad += layout_21(pg)
        bad += layout_22(pg)
        bad += jahr_bad
        bad += fu_bad
        # … auch in den wichtigsten Blättern (Filter, Neue Tour, Aktionen der Tour) und während einer Aufzeichnung
        pg.evaluate("location.hash = '#/'"); pg.wait_for_selector("#filterbtn"); pg.click("#filterbtn"); pg.wait_for_selector(".sheet-back.on"); pg.wait_for_timeout(250); bad += ["Filter: " + m for m in pg.evaluate(LAYOUT_JS)]; pg.click("#filterok"); pg.wait_for_selector(".sheet", state="detached")
        pg.click("#touradd"); pg.wait_for_selector(".sheet-back.on"); pg.wait_for_timeout(250); bad += ["Neue Tour: " + m for m in pg.evaluate(LAYOUT_JS)]; pg.evaluate("window.mtBack()"); pg.wait_for_selector(".sheet", state="detached")
        pg.evaluate("id => { location.hash = '#/tour/' + id }", lt); pg.wait_for_selector("header.top button[aria-label=Aktionen]"); pg.click("header.top button[aria-label=Aktionen]"); pg.wait_for_selector(".sheet-back.on"); pg.wait_for_timeout(250)
        bad += ["Aktionen: " + m for m in pg.evaluate(LAYOUT_JS)]; pg.evaluate("window.mtBack()"); pg.wait_for_selector(".sheet", state="detached")
        pg.evaluate("location.hash = '#/rec'"); pg.wait_for_selector(".bigstart"); pg.click(".bigstart"); pg.wait_for_selector(".bigtime")
        for w, fs in ((360, 100), (360, 130)):
            pg.set_viewport_size({"width": w, "height": 800}); pg.evaluate("fs => { document.getElementById('fs-test').textContent = fs === 100 ? '' : 'html{font-size:' + fs + '% !important}' }", fs); pg.wait_for_timeout(1200)
            for k in range(3):
                pg.evaluate("k => { document.querySelector('#view').scrollTop = k * 400 }", k); pg.wait_for_timeout(60); bad += [f"Aufzeichnung {w} px {fs} %: " + m for m in pg.evaluate(LAYOUT_JS)]
        pg.evaluate("document.getElementById('fs-test').textContent = ''; window.__rec.state = 'idle'; window.__rec.unsent = false"); pg.set_viewport_size({"width": 390, "height": 800})
        assert not bad, "\n".join(sorted(set(bad)))
        b.close()
    assert not errs, "\n".join(errs)
    print("OK")

if __name__ == "__main__":
    main()
