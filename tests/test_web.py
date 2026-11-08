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
        b.close()
    assert not errs, "\n".join(errs)
    print("OK")

if __name__ == "__main__":
    main()
