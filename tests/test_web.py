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
    pg.evaluate("location.hash = '#/start'"); pg.wait_for_selector("#backupnote")
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
    if (m !== 'GET') return { status: 405, headers: {}, body: '{"detail":"Method Not Allowed"}' };      // die App ruft sonst nur lesend auf
    if (!S.sessions.has(tok)) return R(A.ohne_sitzung);
    if (path === '/api/tours') { let l = JSON.parse(A.tours.body); if (S.edit) l = S.edit(l); return { status: 200, headers: {}, body: JSON.stringify(l) }; }
    const g = path.match(/^\\/api\\/tours\\/([^/]+)\\/gpx$/);
    if (g) return fx.gpx[g[1]] ? { status: 200, headers: {}, body: fx.gpx[g[1]] } : R(A.gpx_fehlt);
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
    assert u["sp"] == ["hike", "bike", "ebike", "ebike", "mtb", "racebike", "run", "ski", "ski", "ski", "ski", "hike", "mountaineering", "other", "other", "other"], u["sp"]
    pre = pg.evaluate(MT_VORHANDEN, srv)
    # Blatt: unverschlüsselte Adresse außerhalb des eigenen Netzes → deutlicher Hinweis und Rückfrage; im eigenen Netz nur der Hinweis
    go = lambda: (pg.evaluate("location.hash = '#/import'"), pg.wait_for_selector("#imp-mt"), pg.evaluate("(sheet.stack || []).slice().forEach(x => x.close())"), pg.wait_for_selector(".sheet", state="detached"), pg.click("#imp-mt"))
    toast = lambda rx, t=20000: (pg.wait_for_function("rx => { const t = document.querySelector('#toast'); return !!t && t.classList.contains('on') && new RegExp(rx).test(t.textContent); }", arg=rx, timeout=t), pg.inner_text("#toast"))[1]
    go(); pg.wait_for_selector("#mt-url"); assert pg.locator("#mt-http").is_hidden() and pg.locator("#mt-zahlen input").is_checked()
    pg.fill("#mt-url", "http://192.168.1.20:8080"); assert "Im eigenen Netz" in pg.inner_text("#mt-http")
    pg.fill("#mt-url", "http://touren.example.org"); assert "Achtung" in pg.inner_text("#mt-http") and "unverschlüsselt" in pg.inner_text("#mt-http")
    pg.fill("#mt-name", "Tagebuch"); pg.fill("#mt-pw", "nur-lesen-1234"); pg.click("#mt-go"); pg.wait_for_selector(".sheet[aria-label='Unverschlüsselt verbinden?']")
    pg.click(".sheet[aria-label='Unverschlüsselt verbinden?'] .btn:has-text('Abbrechen')"); pg.wait_for_selector(".sheet[aria-label='Unverschlüsselt verbinden?']", state="detached")
    assert pg.evaluate("window.__mt.log.length") == 0 and pg.locator("#mt-url").count() == 1, "ohne Zustimmung geht nichts ins Netz"
    # Falsches Passwort: verständliche Meldung, nichts gemerkt, das Blatt bleibt benutzbar
    pg.fill("#mt-url", "mt.test"); pg.fill("#mt-pw", "falsch"); pg.click("#mt-go"); assert "Name oder Passwort stimmt nicht" in toast("Passwort")
    assert pg.evaluate("DB.kvGet('mt', null)") is None and pg.evaluate("window.__mt.log") == ["GET /api/me", "POST /api/login"]
    # Anmeldung als Betrachter und erster Abgleich
    pg.wait_for_selector(".sheet", state="detached"); go(); pg.wait_for_selector("#mt-url"); pg.fill("#mt-url", "mt.test"); pg.fill("#mt-name", "Tagebuch"); pg.fill("#mt-pw", "nur-lesen-1234")
    pg.evaluate("window.__mt.log = []"); pg.click("#mt-go"); msg = toast("importiert", 60000)
    assert msg == "13 Touren importiert · 3 schon vorhanden · Name bei 2 Touren übernommen · Zahlen bei 3 Touren angeglichen · 1 ohne Strecke auf dem Server", msg
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
        "skialpin": "ski", "skitour": "ski", "snowshoe": "ski", "nordic": "ski", "nordicwalking": "hike", "mountaineering": "mountaineering", "other": "other"}
    # Tourseite: Quelle, maßgebliche Zahlen mit eigener Rechnung daneben, Bewertung
    pg.evaluate("id => { location.hash = '#/tour/' + id }", g1["id"]); pg.wait_for_selector(".tourp .facts"); f = pg.inner_text(".tourp")
    assert "· Meine Touren" in pg.inner_text(".tourp .sub") and "Zahlen aus" in f and "Eigene Rechnung" in f and "5 von 5 Sternen" in f, f
    # Verbundenes Blatt, Wiederholung: nichts doppelt, keine Strecke wird noch einmal geladen (außer dem Versuch für die Tour ohne Strecke)
    go(); pg.wait_for_selector("#mt-state"); assert pg.inner_text("#mt-state") == "✓ Verbunden mit mt.test als Tagebuch (nur ansehen)", pg.inner_text("#mt-state")
    n1 = pg.evaluate("Tours.list().then(l => l.length)"); pg.evaluate("window.__mt.log = []"); pg.click("#mt-go"); assert toast("schon vorhanden") == "16 schon vorhanden · 1 ohne Strecke auf dem Server"
    assert pg.evaluate("window.__mt.log") == ["GET /api/tours", "GET /api/tours/987654322/gpx"] and pg.evaluate("Tours.list().then(l => l.length)") == n1
    sync = "async (z) => Import.MT.importAll(await DB.kvGet('mt'), { zahlen: z }, null)"
    # Rangfolge der Zahlen: nach einer Korrektur der Spur von Hand gilt die eigene Rechnung – bis zum nächsten Abgleich
    own = pg.evaluate("id => Tours.recalc(id, { eigen: true }).then(t => [t.up, t.dist, t.zMt === undefined, t.upSrc === undefined, t.upMt])", pre["a"]["id"])
    assert abs(own[0] - pre["a"]["up"]) < 1e-6 and abs(own[1] - pre["a"]["dist"]) < 1e-6 and own[2] and own[3] and own[4] == 655, own
    pg.evaluate("id => { location.hash = '#/tour/' + id }", pre["a"]["id"]); pg.wait_for_selector(".tourp .facts"); f = pg.inner_text(".tourp .facts"); assert "Meine Touren nennt" in f and "655 m" in f and "Zahlen aus" not in f, f
    r = pg.evaluate(sync, True); assert r["zahlen"] == 1 and r["added"] == 0 and r["dup"] == 16 and r["namesMt"] == 0, r
    assert pg.evaluate("id => DB.get('tours', id).then(t => [t.up, t.zMt, t.dist])", pre["a"]["id"]) == [655, 1, by["g2"]["dist_m"]]
    # … eine Neuberechnung ohne Korrektur (z. B. Uhr-Höhen beim Zepp-Import, Reparatur) lässt die Zahlen aus Meine Touren stehen
    assert pg.evaluate("id => Tours.recalc(id).then(t => [t.up, t.zMt, t.dist])", pre["a"]["id"]) == [655, 1, by["g2"]["dist_m"]]
    assert pg.evaluate("async id => { const t = await DB.get('tours', id); const r = await Fix.restoreEle(t); return [r.zMt === undefined, Math.abs(r.up - 655) > 5]; }", pre["a"]["id"]) == [True, True], "Originalhöhen wiederherstellen = von Hand"
    pg.evaluate(sync, True)
    # Schalter aus (im Blatt): überall wieder die eigene Rechnung, die Werte von Meine Touren bleiben als Angabe; Schalter an: wieder angeglichen
    go(); pg.wait_for_selector("#mt-zahlen"); pg.click("#mt-zahlen"); pg.wait_for_function("Set_.get('mtZahlen') === false"); pg.click("#mt-go"); toast("schon vorhanden"); pg.wait_for_selector(".sheet", state="detached")
    z = pg.evaluate("Tours.list().then(l => [l.filter(t => t.zMt).length, l.filter(t => t.upSrc === 'mt').length, l.filter(t => t.upMt != null).length])"); assert z == [0, 0, 16], z
    assert abs(pg.evaluate("id => DB.get('tours', id).then(t => t.up)", pre["a"]["id"]) - pre["a"]["up"]) < 1e-6
    go(); pg.wait_for_selector("#mt-zahlen"); assert not pg.locator("#mt-zahlen input").is_checked(); pg.click("#mt-zahlen"); pg.wait_for_function("Set_.get('mtZahlen') === true"); pg.click("#mt-go")
    assert "Zahlen bei" in toast("angeglichen") and pg.evaluate("Tours.list().then(l => l.filter(t => t.zMt).length)") == 16
    pg.wait_for_selector(".sheet", state="detached")
    # Namen: am Server umbenannt → zieht nach; in der App von Hand benannt → bleibt; ein Name aus Meine Touren hat Vorrang vor Komoot
    pg.evaluate("() => { window.__mt.edit = l => l.map(t => t.id === 'g1' ? Object.assign({}, t, { name: 'Kramerspitz (neu benannt)' }) : t); }")
    r = pg.evaluate(sync, True); assert r["namesMt"] == 1 and pg.evaluate("Tours.list().then(l => l.find(t => t.srcId === 'mt:g1').name)") == "Kramerspitz (neu benannt)", r
    pg.evaluate("async () => { const t = (await Tours.list()).find(t => t.srcId === 'mt:g1'); t.name = 'Von Hand in der App'; await Tours.save(t); window.__mt.edit = l => l.map(t => t.id === 'g1' ? Object.assign({}, t, { name: 'Dritter Name am Server', note: 'Neue Notiz am Server' }) : t); }")
    r = pg.evaluate(sync, True); g = pg.evaluate("Tours.list().then(l => l.find(t => t.srcId === 'mt:g1'))"); assert r["namesMt"] == 0 and g["name"] == "Von Hand in der App" and g["note"] == "Neue Notiz am Server", (r, g)
    assert pg.evaluate("id => DB.get('tours', id).then(t => [Import.Komoot.takeName(t, 'Name aus Komoot'), t.name])", pre["k"]) == [False, "Zugspitze durchs Reintal"]
    pg.evaluate("window.__mt.edit = null")
    # Abbruch: langsamer Server, „Abbrechen“ im Fortschrittsblatt – der Rest kommt beim nächsten Mal, nichts doppelt
    pg.evaluate("async () => { for (const t of (await Tours.list()).filter(t => /^mt:s\\d+$/.test(t.srcId))) await Tours.remove(t.id); window.__mt.delay = 250; }")
    go(); pg.wait_for_selector("#mt-go"); pg.click("#mt-go"); pg.wait_for_selector("#prog-stop"); pg.wait_for_function("/\\d+ von 12/.test(document.querySelector('.sheet p').textContent)"); pg.click("#prog-stop")
    m = toast("abgebrochen", 30000); assert "abgebrochen – der Rest kommt beim nächsten Mal" in m, m
    k = pg.evaluate("Tours.list().then(l => l.filter(t => /^mt:s\\d+$/.test(t.srcId)).length)"); assert 0 < k < 11, k
    pg.evaluate("window.__mt.delay = 0"); r = pg.evaluate(sync, True); assert r["added"] == 11 - k and pg.evaluate("Tours.list().then(l => l.filter(t => /^mt:s\\d+$/.test(t.srcId)).length)") == 11, r
    # Abgelaufene Sitzung: freundliche Meldung ohne Schlüssel, Schlüssel vergessen, das Anmeldeblatt kommt mit Adresse und Name wieder
    pg.wait_for_selector(".sheet", state="detached"); pg.evaluate("window.__mt.sessions.clear()"); go(); pg.wait_for_selector("#mt-go"); pg.click("#mt-go")
    m = toast("abgelaufen"); assert m == "Die Anmeldung bei Meine Touren ist abgelaufen. Bitte neu anmelden." and "SITZUNG" not in m, m
    pg.wait_for_selector("#mt-pw"); assert pg.input_value("#mt-url") == "https://mt.test" and pg.input_value("#mt-name") == "Tagebuch" and pg.evaluate("DB.kvGet('mt')") == {"base": "https://mt.test", "name": "Tagebuch"}
    # Zwei-Faktor: falscher Code → Meldung; richtiger Code → verbunden
    for code, want in (("000000", "Der Code stimmt nicht"), ("123456", "schon vorhanden")):
        pg.wait_for_selector("#prog-stop", state="detached"); go(); pg.wait_for_selector("#mt-pw"); pg.fill("#mt-name", "Zweifach"); pg.fill("#mt-pw", "zwei-faktor-1234"); pg.click("#mt-go")
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
        png = bytes.fromhex("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000001e221bc330000000049454e44ae426082")
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
            assert pg.locator(".home .chips .chip.on").count() == 1 and pg.locator(".year .ygoal").count() == 2
            pg.locator(".home .chips .chip").first.click(); pg.wait_for_timeout(200)
            assert pg.locator(".year .kpi b").first.inner_text() == big0
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
        assert hrefs == ["#/plan", "#/map", "#/reisen", "#/stats", "#/import", "#/sources", "#/settings"], hrefs
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
        uhr_hoehen(pg)
        neu = neue_funktionen(pg)

        # Gestaltung: kein Querrollen bei 360–430 px, auch mit 130 % Schrift; Tippflächen mindestens 44 px
        pg.evaluate("document.querySelectorAll('.sheet-back').forEach(e => e.remove())")
        lt = pg.evaluate("Tours.list().then(l => l.filter(t => t.status !== 'planned' && !t.hidden)[0].id)")
        bad = layout_check(pg, ["#/start", "#/", "#/map", "#/rec", "#/photos", "#/mehr", "#/stats", "#/stats/rekorde", "#/stats/kalender", "#/stats/auswertung", "#/stats/ziele", "#/reisen", "#/import", "#/settings", "#/sources", "#/plan", "#/tour/" + lt, "#/story/" + lt, "#/fix/" + lt])
        bad += neue_layout(pg, neu)
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
