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
 stopRecording(n){window.__rec.state='finished';window.__rec.unsent=true}, takePhoto(){window.__calls.push(['photo']);return true},
 setRoute(p,n){window.__calls.push(['route',n,p.split(';').length])}, routeInfo:()=>'{}', routePoints:()=>'[]', clearRoute(){}, setGuide(){}, guideTest(){},
 takeShared:()=>'[]', takeSharedText:()=>'[]', takePhotoQueue:()=>'[]', openBatterySettings(){}, openUrl(){}, shareText(){}, logText:()=>'log',
 call(id,m,a){ a=JSON.parse(a); setTimeout(async()=>{ let r;
   if(m==='http'){ const x=await fetch(a.url,{method:a.method||'GET',headers:a.headers,body:a.body}); r={status:x.status,headers:{},body:a.bin?'':await x.text()}; if(a.bin){ const u=new Uint8Array(await x.arrayBuffer()); let b=''; u.forEach(c=>b+=String.fromCharCode(c)); r.b64=btoa(b); } }
   else if(m==='perm') r={granted:true}; else if(m==='saveFile'){ r='Download/Tourentagebuch/'+a.name; window.__saved=a; }
   else if(m==='storage') r={photos:0,bytes:0}; else if(m==='galleryRange') r=window.__gallery||[];
   else if(m==='importUris') r=(a.uris||[]).map((u,i)=>({id:'g'+i+u.length,name:'g.jpg',ts:window.__gts||0,w:10,h:10,src:'galerie'}));
   else if(m==='pickPhotos') r=[{id:'p1aaaaaa',name:'a.jpg',ts:1700000300000,w:10,h:10,src:'galerie',lat:47.4,lon:11.1}];
   else r=[];
   window.__mtcb(+id,true,JSON.stringify(r)); },5); }
};
"""

def gpx(t0, n=60, lat=47.0, lon=11.0, ele0=800, name="T"):
    pts = "".join(
        f'<trkpt lat="{lat+i*0.0005}" lon="{lon+i*0.0004}"><ele>{ele0+i*3}</ele><time>{__import__("datetime").datetime.fromtimestamp(t0/1000+i*30, __import__("datetime").timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")}</time></trkpt>' for i in range(n))
    return f'<?xml version="1.0"?><gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>{name}</name><type>hiking</type><trkseg>{pts}</trkseg></trk></gpx>'

def main():
    srv = socketserver.TCPServer(("127.0.0.1", 0), Q); port = srv.server_address[1]
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    errs = []
    with sync_playwright() as p:
        b = p.chromium.launch(); ctx = b.new_context(viewport={"width": 390, "height": 800}, device_scale_factor=1, permissions=["geolocation"], geolocation={"latitude": 47.0, "longitude": 11.0})
        ctx.add_init_script(MOCK)
        pg = ctx.new_page()
        pg.on("pageerror", lambda e: errs.append("PAGEERROR " + str(e)))
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
        pg.locator("a.tour", has_text="Hüttenrunde").click(); pg.wait_for_selector(".stats")
        txt = pg.inner_text("#view"); assert "Höhenprofil" in txt and "Aufstieg" in txt, txt
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
        for path, key in [("#/map", ".leaflet-container"), ("#/photos", ".pgrid"), ("#/stats", ".kpis"), ("#/import", ".list"), ("#/settings", "h3"), ("#/sources", ".list"), ("#/plan", ".pmap"), ("#/rec", ".bigstart")]:
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
        pg.locator(".rbtn", has_text="Foto").click(); assert pg.evaluate("__calls.some(c=>c[0]==='photo')")
        pg.evaluate("window.__gpx = arguments[0]", None) if False else None
        pg.evaluate("g => { window.__gpx = g }", gpx(t0 + 86400000 * 200, n=30, lat=46.5, name=""))
        pg.locator(".rbtn.stop").click(); pg.get_by_role("button", name="Beenden", exact=True).click()
        pg.wait_for_function("location.hash.startsWith('#/tour/')", timeout=6000)
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
        pg.get_by_role("button", name="Rekorde", exact=True).click(); pg.wait_for_selector("text=Bester Tag"); tx = pg.inner_text("#view")
        assert "Längste Serie" in tx and "Beste Woche" in tx and "Je Sportart" in tx, tx[:400]
        pg.get_by_role("button", name="Kalender", exact=True).click(); pg.wait_for_selector(".cal")
        assert pg.locator(".cd.l1, .cd.l2, .cd.l3, .cd.l4").count() >= 1
        pg.locator("button.cd").first.click(); pg.wait_for_selector(".sheet .li"); pg.evaluate("(sheet.stack || []).slice().forEach(x => x.close())"); pg.wait_for_selector(".sheet", state="detached")
        pg.get_by_role("button", name="Auswertung", exact=True).click(); pg.wait_for_selector("text=Statistik nach Aktivität")
        pg.get_by_role("button", name="Berechnen").click(); pg.wait_for_selector("text=Größte Entdeckungen", timeout=15000)
        nl = pg.evaluate("Tours.list().then(a => a.filter(t => t.nlCells != null).map(t => [t.nlNew, t.nlCells]))")
        assert len(nl) >= 3 and nl[0][1] > 0 and any(x[0] == 100 for x in nl), nl
        pg.get_by_role("button", name="Wetter laden").click(); pg.wait_for_selector("text=Touren mit Wetterdaten", timeout=15000)
        assert "an Regentagen" in pg.inner_text("#view") and "Kälteste Tour" in pg.inner_text("#view")
        pg.get_by_role("button", name="Ziele", exact=True).click(); pg.wait_for_selector("text=Lege Ziele")
        pg.locator(".goal input").first.fill("500"); pg.locator(".goal input").first.dispatch_event("change"); pg.wait_for_selector(".gbar")
        assert "von 500 km" in pg.inner_text("#view")

        pg.route("**/nominatim.openstreetmap.org/**", lambda r: r.fulfill(status=500, body="x", headers={"access-control-allow-origin": "*"}))
        # Reisen & Alben: Reise aus 4 weit entfernten Tagen erkennen, Tags vergeben, Album-Seite
        rz = pg.evaluate("""async () => {
          const base = Date.UTC(2025, 5, 10, 8);
          const mk = (i, d) => Array.from({ length: 12 }, (_, k) => ({ lat: 46.5 + i * 0.01 + k * 0.0006, lon: 11.5 + k * 0.0005, ele: 1200 + k * 5, t: base + d * 86400000 + k * 60000 }));
          for (let d = 0; d < 5; d++) await Tours.add({ name: 'Reisetour ' + (d + 1), sport: 'hike', pts: mk(d, d), src: 'file' });
          await Set_.set('homeLat', '53.55'); await Set_.set('homeLon', '10.0');
          const all = (await Tours.list()).filter(t => t.status !== 'planned');
          const trips = Reisen.detect(all, [53.55, 10.0], await Reisen.settings());
          const none = Reisen.detect(all, [46.5, 11.5], await Reisen.settings());
          const rt = all.filter(t => /^Reisetour/.test(t.name));
          for (const t of rt) { t.tags = ['Südtirol 2025']; await Tours.save(t); }
          return { n: trips.length, tours: trips[0] && trips[0].tours.length, days: trips[0] && trips[0].days, none: none.length, rng: trips[0] && Reisen.range(trips[0].first, trips[0].last) };
        }""")
        assert rz["n"] == 1 and rz["tours"] == 5 and rz["days"] == 5 and rz["none"] == 0 and "Juni 2025" in rz["rng"], rz
        pg.evaluate("location.hash='#/reisen'"); pg.wait_for_selector("text=Reise 10.–14. Juni 2025"); assert "5 Touren an 5 Tagen" in pg.inner_text("#view")
        pg.get_by_role("button", name="Alben", exact=True).click(); pg.wait_for_selector("text=Südtirol 2025")
        pg.get_by_text("Südtirol 2025").first.click(); pg.wait_for_selector("text=Reisetour 3"); assert "Tage" in pg.inner_text("#view") and pg.locator(".map path").count() >= 1
        pg.evaluate("location.hash='#/reisen'"); pg.wait_for_selector(".chips"); pg.locator("a.li", has_text="Reise 10.").first.click(); pg.wait_for_selector("text=Als Album speichern")

        # Komoot: Auf-/Abstieg wie bei Komoot übernehmen (neue Touren und schon vorhandene)
        ko = pg.evaluate("""async () => {
          const base = 1730000000000;
          const mk = (i) => Array.from({ length: 20 }, (_, k) => ({ lat: 48 + i * 0.1 + k * 0.0004, lon: 12 + k * 0.0003, alt: 500 + (k % 2) * 10, t: k * 20000 }));
          await Tours.add({ name: 'K alt', sport: 'hike', pts: mk(1).map(c => ({ lat: c.lat, lon: c.lon, ele: c.alt, t: base + c.t })), src: 'komoot', srcId: 'komoot:555', start: base });
          Import.Komoot.tours = async () => [{ id: 555, name: 'K alt', sport: 'hike', date: new Date(base).toISOString(), elevation_up: 4321, elevation_down: 4000 },
                                               { id: 556, name: 'K neu', sport: 'hike', date: new Date(base + 86400000 * 3).toISOString(), elevation_up: 777, elevation_down: 700 }];
          Import.Komoot.coords = async (acc, id) => mk(2).map(c => ({ lat: c.lat + (id === 556 ? 0.5 : 0), lng: c.lon, alt: c.alt, t: c.t }));
          const r = await Import.Komoot.importAll({ user: 'u', token: 't' }, { planned: false }, null);
          const l = await Tours.list();
          const a = l.find(t => t.srcId === 'komoot:555'), b = l.find(t => t.srcId === 'komoot:556');
          return { r, a: [a.up, a.down, a.upSrc], b: b ? [b.up, b.down, b.upSrc] : null };
        }""")
        assert ko["a"] == [4321, 4000, "komoot"] and ko["b"] == [777, 700, "komoot"] and ko["r"]["up"] == 1, ko

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
          for (const d of [0, 1, 5, 6, 10]) await Tours.add({ name: 'Réunion ' + d, sport: 'hike', pts: Array.from({ length: 12 }, (_, k) => ({ lat: -21.1 + d * 0.01 + k * 0.0006, lon: 55.5 + k * 0.0005, ele: 900 + k * 6, t: base + d * 86400000 + k * 60000 })), src: 'file' });
        }""")
        pg.evaluate("location.hash='#/reisen'"); pg.wait_for_selector("text=La Réunion Juni 2026", timeout=15000)
        assert "5 Touren an 5 Tagen" in pg.inner_text("#view"), pg.inner_text("#view")
        pg.wait_for_selector("text=Mehrtagestouren"); assert "2 Etappen an 2 Tagen" in pg.inner_text("#view"), pg.inner_text("#view")
        pg.locator("a.li", has_text="2 Etappen an 2 Tagen").first.click(); pg.wait_for_selector("text=Mehrtagestour "); assert "Touren" in pg.inner_text("#view")
        pg.wait_for_selector("text=Tag 1 · Etappe 1/2"); assert "Tag 2 · Etappe 2/2" in pg.inner_text("#view"), pg.inner_text("#view")
        pg.locator("a.li", has_text="Etappe 2/2").first.click(); pg.wait_for_selector("#stage"); assert "Tag 2 · Etappe 2/2" in pg.inner_text("#stage"), pg.inner_text("#stage")

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
        pg.select_option("#fv", "8"); pg.fill("#fs", "990") if False else pg.evaluate("document.querySelector('#fs').value = 1000; document.querySelector('#fs').dispatchEvent(new Event('input'))")
        pg.wait_for_function("() => document.querySelector('#fp').innerText.includes('Nochmal')", timeout=20000)
        pg.evaluate("location.hash = '#/'"); pg.wait_for_function("() => !document.querySelector('.flight')")

        b.close()
    assert not errs, "\n".join(errs)
    print("OK")

if __name__ == "__main__":
    main()
