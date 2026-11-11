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
   if(m==='http'){ const x=await fetch(a.url,{method:a.method||'GET',headers:a.headers,body:a.body}); r={status:x.status,headers:{},body:await x.text()}; }
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

        # Zepp per Token: schlechte Eingabe abgelehnt, gutes Token geprüft (Server vorgetäuscht) und gemerkt, Sheet zeigt Abmelden
        pg.evaluate("location.hash='#/import'"); pg.wait_for_selector(".list")
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

        b.close()
    assert not errs, "\n".join(errs)
    print("OK")

if __name__ == "__main__":
    main()
