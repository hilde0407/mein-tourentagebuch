"""Browser-Test der Oberfläche mit simulierter Android-Brücke (Playwright)."""
import http.server, json, os, re, socketserver, threading, sys
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
 startRecording(s,n){window.__rec=Object.assign(window.__rec,{state:'recording',sport:s,name:n,start:Date.now(),count:5,dist_m:120,up_m:0,down_m:0,active_s:61,lat:47.5,lon:11.2,fix_age_s:1,fix_acc_m:5});window.__calls.push(['start',s,n])},
 pauseRecording(){window.__rec.state='paused'}, resumeRecording(){window.__rec.state='recording'},
 stopRecording(n){window.__rec.state='finished';window.__rec.unsent=true;window.__routeName='';window.__routePts=''},      /* wie die Hülle: Beenden löscht die Route (Navi.clear) */ takePhoto(){window.__calls.push(['photo']);return true}, takeVideo(){window.__calls.push(['video']);return true}, takePano(){window.__calls.push(['pano']);if(window.__panoOk===false)return false;window.__pano={ts:Date.now(),lat:47.5,lon:11.2};return true}, panoPending:()=>JSON.stringify(window.__pano||{}), panoClear(){window.__pano=null}, setJunctions(t){window.__calls.push(['junc',t.split(';').length])}, backups:()=>JSON.stringify(window.__baks||[]), backupGpx:()=>window.__bakgpx||'',
 setRoute(p,n){window.__calls.push(['route',n,p.split(';').length]);window.__routeName=n;window.__routePts=p}, routeInfo:()=>JSON.stringify(window.__routeName?{has:true,name:window.__routeName,points:3}:{}), routePoints:()=>JSON.stringify(window.__routeName&&window.__routePts?window.__routePts.split(';').map(x=>x.split(',').map(Number)):[]), clearRoute(){window.__routeName='';window.__routePts=''}, setGuide(){}, guideTest(){}, haptic(){window.__haptic=(window.__haptic||0)+1},
 takeShared:()=>'[]', takeSharedText:()=>'[]', takePhotoQueue:()=>'[]', openBatterySettings(){}, openUrl(u){window.__opened=u}, shareText(){}, logText:()=>'log',
 call(id,m,a){ a=JSON.parse(a); setTimeout(async()=>{ let r; try{
   if(m==='http'){ const x=await fetch(a.url,{method:a.method||'GET',headers:a.headers,body:a.body}); r={status:x.status,headers:{},body:a.bin?'':await x.text()}; if(a.bin){ const u=new Uint8Array(await x.arrayBuffer()); let b=''; u.forEach(c=>b+=String.fromCharCode(c)); r.b64=btoa(b); } }
   else if(m==='appendCache') r=true; else if(m==='uploadStart') r={ip:'192.168.0.5',port:8765,url:'http://192.168.0.5:8765/abc12/'}; else if(m==='uploadStop') r=true;
   else if(m==='uploadPoll'){ r={photos:window.__upl||[],failed:0,running:true}; window.__upl=[]; }
   else if(m==='perm') r={granted:true}; else if(m==='saveFile'){ r='Download/Tourentagebuch/'+a.name; window.__saved=a; }
   else if(m==='storage') r=window.__sto||{photos:0,bytes:0}; else if(m==='playVideo'){ (window.__plays=window.__plays||[]).push(a.id); r=window.__playRes||{ok:false,what:1,extra:-1004}; } else if(m==='videoPrefs'){ window.__vprefs=a; r=a; } else if(m==='galleryRange') r=window.__gallery||[];
   else if(m==='importUris') r=(a.uris||[]).map((u,i)=>({id:'g'+i+u.length,name:'g.jpg',ts:window.__gts||0,w:10,h:10,src:'galerie'}));
   else if(m==='pickPhotos'){ window.__pickArgs=a; window.__pickN=(window.__pickN||0)+1; r=window.__pickPh||[{id:'p1aaaaaa',name:'a.jpg',ts:1700000300000,w:10,h:10,src:'galerie',lat:47.4,lon:11.1}]; }
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


MINI_WEBM = "GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQJChYECGFOAZwEAAAAAAAJZEU2bdLpNu4tTq4QVSalmU6yBoU27i1OrhBZUrmtTrIHYTbuMU6uEElTDZ1OsggEeTbuMU6uEHFO7a1OsggJD7AEAAAAAAABZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmsirXsYMPQkBNgI1MYXZmNjAuMTYuMTAwV0GNTGF2ZjYwLjE2LjEwMESJiECPQAAAAAAAFlSua8GuAQAAAAAAADjXgQFzxYgn36A3G11dd5yBACK1nIN1bmSIgQCGhVZfVlA4g4EBI+ODhAvrwgDgibCBILqBIJqBAhJUw2f8c3OgY8CAZ8iaRaOHRU5DT0RFUkSHjUxhdmY2MC4xNi4xMDBzc9ZjwItjxYgn36A3G11dd2fIoUWjh0VOQ09ERVJEh5RMYXZjNjAuMzEuMTAyIGxpYnZweGfIoUWjiERVUkFUSU9ORIeTMDA6MDA6MDEuMDAwMDAwMDAwAB9DtnVAnueBAKO9gQAAgBADAJ0BKiAAIAAARwiFhYiFhIgCAgJ1qgP4A/oCCFkMvQD+/W7z/+K1h1nF/4rf/9Nk8VeM/+mLAKOVgQDIALEBAAEQEAAYABhYL/QACHAAo5WBAZAAsQEAARAQABgAGFgv9AAIcACjlYECWACxAQABEBAAGAAYWC/0AAhwAKOVgQMgALEBAAEQEAAYABhYL/QACHAAHFO7a5G7j7OBALeK94EB8YIBn/CBAw=="      # 1 s, 32×32, VP8 – spielt im Test-Chromium (H.264/HEVC kann es nicht)

VIDEO_MOCK = """() => {
  /* 2.7.1: Video-Umwandlung der Hülle nachgestellt: videoScan / videoConvert / videoStatus / videoCancel */
  const c0 = window.MTApp.call; window.__vcall0 = c0;
  window.__vs = { todo: [], cur: '', pct: 0, i: 0, n: 0, done: [], scan: { all: 0, n: 0, ids: [] }, hevc: true, calls: [] };
  window.MTApp.call = (id, m, a) => {
    const V = window.__vs;
    if (!/^video/.test(m)) return c0.call(window.MTApp, id, m, a);
    const o = JSON.parse(a || '{}'); V.calls.push(m); let r;
    if (m === 'videoScan') r = V.scan;
    else if (m === 'videoConvert') {
      const ids = o.ids || [];
      if (!V.hevc) r = { queued: 0, hevc: 0, skipped: ids.length };
      else { if (!V.cur && !V.todo.length) { V.i = 0; V.n = 0; } V.todo.push(...ids); V.n += ids.length; if (!V.cur) { V.cur = V.todo.shift(); V.i++; } r = { queued: ids.length, hevc: ids.length, skipped: 0 }; }
    } else if (m === 'videoCancel') { if (V.cur) V.done.push({ id: V.cur, ok: false, cancel: true, msg: 'abgebrochen' }); V.cur = ''; V.todo = []; V.pct = 0; r = true; }
    else if (m === 'videoStatus') { r = { running: !!V.cur, id: V.cur, i: V.i, n: V.n, pct: V.pct, waiting: V.todo.length, done: V.done }; V.done = []; }
    setTimeout(() => window.__mtcb(+id, true, JSON.stringify(r)), 5);
  };
  window.__vfin = res => { const V = window.__vs; V.done.push(Object.assign({ id: V.cur }, res)); V.cur = V.todo.shift() || ''; if (V.cur) V.i++; V.pct = 0; window.dispatchEvent(new Event('mtvideo')); };
  window.__vpct = p => { window.__vs.pct = p; window.dispatchEvent(new Event('mtvideo')); };
}"""

def videos_271(pg):
    """2.7.1: HEVC-Videos umwandeln – Knopf „Jetzt umwandeln“ in der Vollbildansicht, Sammelumwandlung unter Foto-Quellen, Meldungen."""
    import base64
    leise = lambda: pg.wait_for_function(LEISE, timeout=30000)
    webm = base64.b64decode(MINI_WEBM)
    # ohne „?c=“ (vor der Umwandlung): Datei, die der Browser nicht abspielen kann (MediaError 4, wie HEVC im WebView); danach ein spielbares Video
    pg.route("**/photo/*v.mp4*", lambda r: r.fulfill(status=200, body=webm, content_type="video/webm") if "?c=" in r.request.url else r.fulfill(status=200, body=b"\x00\x00\x00\x18ftypheic" + b"\x00" * 400, content_type="video/mp4"))
    pg.evaluate(VIDEO_MOCK)
    vid1, vid2 = "a1b2c3d4e5f6a7b8c9dv", "b1b2c3d4e5f6a7b8c9dv"
    pg.evaluate("""async ([a, b]) => { for (const id of [a, b]) await DB.put('photos', { id, name: 'Video.mp4', ts: 1700000300000, w: 0, h: 0, dur: 0, video: true, src: 'kamera' }); }""", [vid1, vid2])
    go(pg, "#/photos", ".photos")

    # 1. Vollbild: Fehler 4 → Meldung mit „Jetzt umwandeln“ und „In Video-App öffnen“
    #    (2.9.0: erst der Player der App – hier nachgestellt mit Fehler, dann der bisherige Weg im <video>-Element)
    pg.evaluate("async id => Lightbox.open([await DB.get('photos', id)], 0)", vid1)
    pg.click("#lb-play")
    pg.wait_for_selector("#lb-err:not([hidden]) #lb-conv", timeout=20000)
    assert "Fehler 4" in pg.inner_text("#lb-err") and pg.is_visible("#lb-ext"), pg.inner_text("#lb-err")
    leise(); pg.click("#lb-conv")
    pg.wait_for_function("() => /Video wird umgewandelt/.test(document.querySelector('#lb-err').textContent) && !!document.querySelector('#lb-stop')")
    assert pg.evaluate("__vs.calls.includes('videoConvert') && __vs.cur") == vid1
    pg.evaluate("__vpct(40)"); pg.wait_for_function("() => /40 %/.test(document.querySelector('#lb-err').textContent)")
    leise(); pg.evaluate("__vfin({ ok: true, w: 1920, h: 1080, dur: 5000 })")
    assert "Video fertig" in toast_text(pg, "Video fertig")
    pg.wait_for_function("() => document.querySelector('#lb-err').hidden && /\\?c=/.test(document.querySelector('video.lb-img').getAttribute('src'))")
    pg.wait_for_timeout(800)      # das neue (spielbare) Video meldet keinen Fehler: die Meldung bleibt weg
    assert pg.evaluate("document.querySelector('#lb-err').hidden"), pg.inner_text("#lb-err")
    ph = pg.evaluate("id => DB.get('photos', id)", vid1)
    assert ph["w"] == 1920 and ph["h"] == 1080 and ph["dur"] == 5000 and ph.get("h264") is True, ph
    pg.evaluate("window.__lightbox && window.__lightbox.close()")

    # 2. kein HEVC: Umwandeln wird nicht angeboten als Lösung; Hinweis statt Warteschlange
    pg.evaluate("__vs.hevc = false")
    pg.evaluate("async id => Lightbox.open([await DB.get('photos', id)], 0)", vid2)
    pg.click("#lb-play")
    pg.wait_for_selector("#lb-err:not([hidden]) #lb-conv", timeout=20000)
    leise(); pg.click("#lb-conv")
    assert "kein HEVC" in toast_text(pg, "kein HEVC")
    assert not pg.evaluate("__vs.cur")

    # 3. Umwandlung scheitert: Original bleibt, Meldung sagt es, Video-App bleibt als Weg
    pg.evaluate("__vs.hevc = true"); leise(); pg.click("#lb-conv")
    pg.wait_for_selector("#lb-stop")
    leise(); pg.evaluate("__vfin({ ok: false, msg: 'kein H.264-Encoder' })")
    assert "konnte nicht umgewandelt werden" in toast_text(pg, "nicht umgewandelt")
    pg.wait_for_function("() => /nicht geklappt/.test(document.querySelector('#lb-err').textContent) && /Original bleibt/.test(document.querySelector('#lb-err').textContent)")
    assert pg.is_visible("#lb-ext")
    # 3b. Abbrechen aus der Vollbildansicht
    leise(); pg.click("#lb-conv"); pg.wait_for_selector("#lb-stop"); pg.click("#lb-stop")
    pg.evaluate("window.dispatchEvent(new Event('mtvideo'))")
    assert "abgebrochen" in toast_text(pg, "abgebrochen")
    pg.wait_for_function("() => /abgebrochen/.test(document.querySelector('#lb-err').textContent)")
    pg.evaluate("window.__lightbox && window.__lightbox.close()")

    # 4. Umwandlung nach einer Aufnahme (startet in der Hülle): Meldung „wird umgewandelt …“, dann „fertig“
    leise(); pg.evaluate("() => { const V = __vs; V.cur = 'c1b2c3d4e5f6a7b8c9dv'; V.i = 1; V.n = 1; window.dispatchEvent(new Event('mtvideo')); }")
    assert "Video wird umgewandelt" in toast_text(pg, "wird umgewandelt")
    leise(); pg.evaluate("__vfin({ ok: true, w: 640, h: 480, dur: 2000 })")
    assert "Video fertig" in toast_text(pg, "Video fertig")

    # 5. Foto-Quellen: „Vorhandene Videos umwandeln“ – nichts zu tun
    go(pg, "#/sources", "#src-vconv")
    pg.evaluate("__vs.scan = { all: 4, n: 0, ids: [] }")
    leise(); pg.click("#src-vconv")
    assert "schon ab" in toast_text(pg, "schon ab")
    # … drei HEVC-Videos: zählen, nachfragen, „1 von 3“ → „2 von 3 · 50 %“, Abbrechen, Zusammenfassung
    ids = ["d1b2c3d4e5f6a7b8c9dv", "d2b2c3d4e5f6a7b8c9dv", "d3b2c3d4e5f6a7b8c9dv"]
    pg.evaluate("ids => { __vs.scan = { all: 6, n: 3, ids }; }", ids)
    leise(); pg.click("#src-vconv")
    pg.wait_for_selector(".sheet[aria-label='Videos umwandeln?']")
    assert "3 Videos sind im Format HEVC" in pg.inner_text(".sheet[aria-label='Videos umwandeln?']")
    pg.click(".sheet[aria-label='Videos umwandeln?'] button.pri")
    pg.wait_for_function("() => /^1 von 3/.test((document.querySelector('#vc-txt') || {}).textContent || '')")
    pg.evaluate("__vfin({ ok: true, w: 1280, h: 720, dur: 3000 })"); pg.evaluate("__vpct(50)")
    pg.wait_for_function("() => /^2 von 3 · 50 %/.test((document.querySelector('#vc-txt') || {}).textContent || '')")
    leise(); pg.click("#vc-stop")
    msg = toast_text(pg, "umgewandelt")
    assert msg.startswith("1 Video umgewandelt") and "abgebrochen" in msg, msg
    pg.wait_for_selector(".sheet[aria-label='Videos umwandeln']", state="detached")
    assert not pg.evaluate("__vs.cur") and not pg.evaluate("__vs.todo.length")
    # … ohne Abbruch bis zum Ende, ein Video scheitert
    leise(); pg.click("#src-vconv"); pg.wait_for_selector(".sheet[aria-label='Videos umwandeln?']"); pg.click(".sheet[aria-label='Videos umwandeln?'] button.pri")
    pg.wait_for_function("() => /^1 von 3/.test((document.querySelector('#vc-txt') || {}).textContent || '')")
    pg.evaluate("__vfin({ ok: true })"); pg.evaluate("__vfin({ ok: false, msg: 'HDR-Video' })"); leise(); pg.evaluate("__vfin({ ok: true })")
    msg = toast_text(pg, "umgewandelt")
    assert msg == "2 Videos umgewandelt · 1 nicht möglich (bleiben erhalten)", msg
    pg.wait_for_selector(".sheet[aria-label='Videos umwandeln']", state="detached")

    # aufräumen: Nachstellung zurück, Testvideos weg
    pg.unroute("**/photo/*v.mp4*")
    pg.evaluate("ids => { window.MTApp.call = window.__vcall0; return Promise.all(ids.map(id => DB.del('photos', id))); }", [vid1, vid2])


def videos_290(pg):
    """2.9.0: eigener Player (Native 'playVideo' mit id), Rückfall ins <video>-Element, Vorschaubild mit Abspiel-Symbol und Dauer, Kachel-Kennzeichen,
    Details mit Video-Wegen und Löschen, Einstellungen (Länge, Galerie, Umwandeln) gespeichert und an die Hülle gegeben, Speicheranzeige mit Videos."""
    import base64
    leise = lambda: pg.wait_for_function(LEISE, timeout=30000)
    webm = base64.b64decode(MINI_WEBM)
    pg.route("**/photo/*v.mp4*", lambda r: r.fulfill(status=200, body=webm, content_type="video/webm"))
    tid = pg.evaluate("Tours.list().then(a => a.filter(t => t.status !== 'planned')[0].id)")
    v1, v2 = "e1b2c3d4e5f6a7b8c9dv", "e2b2c3d4e5f6a7b8c9dv"
    pg.evaluate("""async ([a, b, tid]) => { await DB.put('photos', { id: a, name: 'Video.mp4', ts: 1700000400000, w: 1920, h: 1080, dur: 125000, video: true, src: 'kamera', tour: tid });
      await DB.put('photos', { id: b, name: 'Video.mp4', ts: 1700000500000, w: 1080, h: 1920, dur: 0, video: true, src: 'kamera', tour: '' }); window.__plays = []; window.__playRes = null; }""", [v1, v2, tid])

    # 1. Kacheln: Abspiel-Symbol und Dauer im Fotoraster und in der Fotoleiste der Tour; vorlesbar; Video ohne Dauer nur mit Symbol
    go(pg, "#/photos", ".pgrid")
    lab = f"button.pt[aria-label='Video, 2 Minuten 5 Sekunden öffnen']"
    pg.wait_for_selector(lab)
    assert pg.inner_text(lab + " .vmark").strip() == "2:05", pg.inner_text(lab)
    assert pg.locator("button.pt[aria-label='Video öffnen'] .vmark .vmark-i").count() == 1 and pg.inner_text("button.pt[aria-label='Video öffnen'] .vmark").strip() == ""
    assert pg.locator(".pgrid .vmark").count() == 2, pg.locator(".pgrid .vmark").count()
    go(pg, "#/tour/" + tid, ".strip")
    pg.wait_for_selector(".strip .th .vmark")
    assert "2:05" in pg.inner_text(".strip .th .vmark") and pg.locator(".strip .th .vmark").count() == 1

    # 2. Vollbild in der App: Vorschaubild mit großem Abspiel-Symbol und Dauer; kein <video>; Tipp ruft playVideo mit der id
    pg.evaluate("async id => Lightbox.open([await DB.get('photos', id)], 0)", v1)
    pg.wait_for_selector("#lb-play:not([hidden])")
    assert pg.inner_text("#lb-dur") == "2:05" and pg.get_attribute("#lb-play", "aria-label") == "Video abspielen (2:05)"
    assert pg.evaluate("document.querySelector('video.lb-img').hidden && !document.querySelector('video.lb-img').getAttribute('src')")
    assert "/thumb/" + v1 in pg.get_attribute("#lb-play img", "src")
    pg.evaluate("window.__playRes = { ok: true }")
    pg.click("#lb-play")
    pg.wait_for_function("id => (window.__plays || []).includes(id)", arg=v1)
    pg.wait_for_timeout(300)
    assert pg.evaluate("document.querySelector('video.lb-img').hidden") and pg.is_visible("#lb-play"), "nach normalem Schließen bleibt das Vorschaubild"
    assert pg.is_visible("#lb-app"), "⤴ In Video-App öffnen bleibt oben erreichbar"

    # 3. Player meldet Fehler: Meldung mit Code, dann der bisherige Weg im <video>-Element (spielt hier ab)
    pg.evaluate("window.__playRes = { ok: false, what: 1, extra: -1010 }")
    leise(); pg.wait_for_timeout(1600)      # Doppeltipp-Sperre (1,5 s) sicher abwarten
    pg.click("#lb-play")
    assert "nicht abspielen (Fehler 1/-1010)" in toast_text(pg, "Fehler 1/-1010")
    pg.wait_for_function("id => { const v = document.querySelector('video.lb-img'); return !v.hidden && (v.getAttribute('src') || '').includes(id); }", arg=v1)
    assert pg.evaluate("document.querySelector('#lb-play').hidden")
    pg.wait_for_timeout(600)
    assert pg.evaluate("document.querySelector('#lb-err').hidden"), "spielbares Video: keine Fehlermeldung"
    pg.evaluate("window.__lightbox && window.__lightbox.close()")

    # 4. Native fehlt (Browser): direkt das <video>-Element wie bisher, kein Abspiel-Knopf
    pg.evaluate("window.__mtSave = window.MTApp; window.MTApp = undefined")
    try:
        pg.evaluate("async id => Lightbox.open([await DB.get('photos', id)], 0)", v2)
        pg.wait_for_function("id => { const v = document.querySelector('video.lb-img'); return v && !v.hidden && (v.getAttribute('src') || '').includes(id); }", arg=v2)
        assert pg.evaluate("document.querySelector('#lb-play').hidden")
        pg.evaluate("window.__lightbox && window.__lightbox.close()")
    finally:
        pg.evaluate("window.MTApp = window.__mtSave")

    # 5. Details eines Videos: Abspielen, Video-App, Umwandeln erreichbar; Löschen mit Rückfrage entfernt den Eintrag (und ruft deletePhoto)
    pg.evaluate("async id => Lightbox.open([await DB.get('photos', id)], 0)", v2)
    pg.wait_for_selector("#lb-play:not([hidden])")
    assert pg.evaluate("document.querySelector('#lb-dur').hidden"), "ohne bekannte Dauer keine Zeitangabe"
    pg.click(".lb button[aria-label='Details']")
    pg.wait_for_selector(".sheet[aria-label='Video'] #lb-dext")
    assert pg.is_visible("#lb-dplay") and pg.is_visible("#lb-dconv") and pg.is_visible("#lb-del")
    pg.evaluate("window.__plays = []; window.__playRes = { ok: true }")
    pg.click("#lb-dplay")
    pg.wait_for_function("id => (window.__plays || []).includes(id)", arg=v2)
    pg.click(".lb button[aria-label='Details']"); pg.wait_for_selector(".sheet[aria-label='Video'] #lb-del")
    pg.click("#lb-del")
    pg.wait_for_selector(".sheet[aria-label='Video löschen?']")
    assert "Datei, Vorschaubild und Eintrag" in pg.inner_text(".sheet[aria-label='Video löschen?']")
    pg.click(".sheet[aria-label='Video löschen?'] button.pri")
    pg.wait_for_function("id => DB.get('photos', id).then(p => !p)", arg=v2)
    pg.wait_for_selector(".lb", state="detached")

    # 6. Einstellungen: Vorgaben (2 Minuten, Galerie an, Umwandeln aus), Änderungen gespeichert und an die Hülle (videoPrefs)
    go(pg, "#/settings", "#set-vlimit")
    assert pg.input_value("#set-vlimit") == "120", pg.input_value("#set-vlimit")
    assert [o.strip() for o in pg.locator("#set-vlimit option").all_inner_texts()] == ["30 Sekunden", "2 Minuten", "5 Minuten", "Unbegrenzt"]
    assert pg.is_checked("#set-vgal input") and not pg.is_checked("#set-vauto input")
    pg.select_option("#set-vlimit", "300")
    pg.wait_for_function("() => window.__vprefs && window.__vprefs.limit === '300'")
    pg.click("#set-vgal"); pg.wait_for_function("() => window.__vprefs && window.__vprefs.gallery === false")
    pg.click("#set-vauto"); pg.wait_for_function("() => window.__vprefs && window.__vprefs.auto === true")
    st = pg.evaluate("DB.kvGet('settings', {})")
    assert st["videoLimit"] == "300" and st["videoGallery"] is False and st["videoAuto"] is True, st
    go(pg, "#/settings", "#set-vlimit")      # neu aufgebaut: zeigt die gespeicherten Werte
    assert pg.input_value("#set-vlimit") == "300" and not pg.is_checked("#set-vgal input") and pg.is_checked("#set-vauto input")
    assert "nicht enthalten" in pg.inner_text("#bk-media") and "Videos" in pg.inner_text("#bk-media")
    pg.select_option("#set-vlimit", "0"); pg.wait_for_function("() => window.__vprefs.limit === '0'")
    # zurück auf die Vorgaben
    pg.select_option("#set-vlimit", "120"); pg.click("#set-vgal"); pg.click("#set-vauto")
    pg.wait_for_function("() => window.__vprefs.limit === '120' && window.__vprefs.gallery === true && window.__vprefs.auto === false")

    # 7. Foto-Quellen: Fotos und Videos getrennt gezählt, Videos einzeln mit Dauer und Größe, Löschen mit Rückfrage
    pg.evaluate("id => { window.__sto = { photos: 3, photoBytes: 3145728, videos: 1, videoBytes: 36700160, bytes: 39845888, vids: { [id]: 36700160 } }; }", v1)
    go(pg, "#/sources", "#src-sto")
    t = pg.inner_text("#src-sto")
    assert "Fotos" in t and "3 · 3,0 MB" in t and "Videos" in t and "1 · 35,0 MB" in t and "38,0 MB" in t, t
    row = "#src-v-" + v1
    pg.wait_for_selector(row)
    assert "2:05" in pg.inner_text(row) and "35,0 MB" in pg.inner_text(row), pg.inner_text(row)
    bad = layout_check(pg, ["#/sources", "#/photos"], widths=((360, 100), (390, 100), (360, 130)))
    assert not bad, bad
    go(pg, "#/sources", row)
    pg.click(row + " button[aria-label='Video löschen']")
    pg.wait_for_selector(".sheet[aria-label='Video löschen?']"); pg.click(".sheet[aria-label='Video löschen?'] button.pri")
    pg.wait_for_function("id => DB.get('photos', id).then(p => !p)", arg=v1)
    pg.wait_for_selector(row, state="detached")
    # alte Hülle ohne Videoangaben: nur Fotos und Zusammen
    pg.evaluate("window.__sto = { photos: 5, bytes: 5242880 }")
    go(pg, "#/sources", "#src-sto")
    assert "Videos" not in pg.inner_text("#src-sto") and "5 · 5,0 MB" in pg.inner_text("#src-sto")
    pg.evaluate("window.__sto = null; window.__playRes = null")
    pg.unroute("**/photo/*v.mp4*")
    print("Videos 2.9.0: Player, Rückfall, Kacheln, Details, Einstellungen, Speicher – in Ordnung")


def karte_281(pg, shots=None):
    """2.8.1: Tourenkarte – Startpunkte in Sportfarbe, weit draußen zu Gruppen mit Anzahl zusammengefasst; Linien erst nah (ab Zoom 9 bzw. wie bisher,
    wenn alle Touren in einer Gegend liegen) und nur im Ausschnitt; Gruppe antippen zoomt hinein, am selben Ort gibt es eine Liste; Jahresfilter;
    „Alle Touren“; „N Touren“ unten. Geprüft werden Marker und Leaflet-Ebenen, nicht das Kartenbild (Kacheln gibt es im Test nicht)."""
    import re
    orte = [("Alpen Hausrunde", 47.7012, 12.0123, 2023, "hike"), ("Alpen Hausrunde", 47.7012, 12.0123, 2024, "hike"), ("Alpen Hausrunde", 47.7012, 12.0123, 2024, "hike"),
            ("Karwendel", 47.42, 11.45, 2023, "mtb"), ("Roque Nublo", 27.97, -15.61, 2024, "hike"), ("Barranco de Guayadeque", 27.93, -15.48, 2024, "hike"),
            ("Tamadaba", 28.05, -15.73, 2024, "hike"), ("Pico de las Nieves Rad", 27.96, -15.57, 2024, "bike"), ("Island Esja", 64.21, -21.70, 2023, "hike"),
            ("New York Central Park", 40.77, -73.97, 2023, "run"), ("Blue Mountains", -33.73, 150.31, 2024, "hike"), ("Machu Picchu", -13.16, -72.54, 2023, "hike"),
            ("Fuji", 35.36, 138.73, 2024, "mountaineering")]
    ids = pg.evaluate("""async (orte) => { const ids = [];
      for (let k = 0; k < orte.length; k++) { const [name, la, lo, y, sport] = orte[k];
        const t0 = Date.UTC(y, 3 + (k % 6), 3 + k, 8, 0);
        const g = '<?xml version="1.0"?><gpx version="1.1"><trk><name>' + name + '</name><trkseg>' + Array.from({ length: 160 }, (_, i) => '<trkpt lat="' + (la + Math.sin(i / 25) * 0.03 + k * 1e-5) + '" lon="' + (lo + i * 0.0006) + '"><ele>' + (500 + i) + '</ele><time>' + new Date(t0 + i * 30000).toISOString() + '</time></trkpt>').join('') + '</trkseg></trk></gpx>';
        const r = await Import.fromData('welt' + k + '.gpx', new TextEncoder().encode(g), 'file');
        const t = (await Tours.list()).filter(x => x.name === name).sort((a, b) => b.start - a.start).find(x => !ids.includes(x.id)); if (!r.added || !t) throw new Error('Import ' + name);
        t.sport = sport; await DB.put('tours', t); ids.push(t.id); }
      return ids; }""", orte)
    n_alle = pg.evaluate("Tours.list().then(l => l.filter(t => t.status !== 'planned' && !t.hidden && t.lat != null).length)")
    K = "document.querySelector('.map.full').__karte"
    stand = lambda: pg.evaluate("""() => { const k = document.querySelector('.map.full').__karte;
      const g = [...document.querySelectorAll('.map.full .tgrp span')].map(e => +e.textContent), e = document.querySelectorAll('.map.full .tmk').length;
      return { zoom: k.map.getZoom(), linien: k.linien.getLayers().length, gruppen: g, einzeln: e, summe: g.reduce((a, b) => a + b, 0) + e, marker: k.punkte.getLayers().length, info: document.querySelector('#mapinfo').textContent }; }""")
    im_bild = lambda: pg.evaluate(f"async () => {{ const b = {K}.map.getBounds(); return (await Tours.list()).filter(t => t.status !== 'planned' && !t.hidden && t.lat != null && b.contains([t.lat, t.lon])).length; }}")      # andere Testtouren können mit im Bild liegen
    def ruhig():      # keine Zoom-/Schwenk-Animation mehr, danach kurz Zeit für moveend
        pg.wait_for_function(f"() => {{ const k = {K}; return k && !k.map._animatingZoom && !(k.map._panAnim && k.map._panAnim._inProgress); }}", timeout=10000); pg.wait_for_timeout(400)
    # 1. Weltansicht: Touren über mehrere Kontinente → Gruppen statt Linien, alle Touren gezählt, Linien erst ab Zoom 9
    go(pg, "#/map", ".map.full .leaflet-marker-icon"); ruhig()
    s = stand()
    assert pg.evaluate("document.querySelector('.map.full').dataset.linienAb") == "9", "weit verteilt: Linien erst ab Zoom 9"
    assert s["zoom"] <= 3 and s["linien"] == 0 and s["gruppen"] and s["summe"] == n_alle and s["info"] == f"{n_alle} Touren", s
    assert pg.locator(".map.full .tmk span").first.evaluate("e => getComputedStyle(e).borderTopColor") == "rgb(255, 255, 255)", "weißer Rand"
    assert pg.evaluate(f"() => {{ const k = {K}; return k.map.getContainer().querySelectorAll('.leaflet-marker-icon').length === k.punkte.getLayers().length; }}")
    # Gruppenschrift gut lesbar (Kontrast zur Fläche mindestens 4,5 : 1)
    kon = pg.evaluate("""() => [...document.querySelectorAll('.map.full .tgrp span')].map(e => { const cs = getComputedStyle(e), hx = c => '#' + c.match(/[0-9]+/g).slice(0, 3).map(v => (+v).toString(16).padStart(2, '0')).join(''); return KartenPunkte.kontrast(hx(cs.backgroundColor), hx(cs.color)); })""")
    assert min(kon) >= 4.5, kon
    # Knöpfe: „Alle Touren“ wie der Standortknopf (mapbtn), mindestens 44 px hoch
    bb = pg.locator("#alletouren").bounding_box(); assert bb["height"] >= 44 and "mapbtn" in pg.get_attribute("#alletouren", "class"), bb
    if shots: pg.screenshot(path=shots + "/karte_welt.png")
    # 2. Gruppe antippen: Karte zoomt hinein, es werden mehr bzw. kleinere Gruppen
    z0 = s["zoom"]; grp = max(s["gruppen"])
    pg.locator(".map.full .tgrp", has_text=str(grp)).first.click(); ruhig()
    pg.wait_for_function(f"z => {K}.map.getZoom() > z", arg=z0, timeout=10000); ruhig()
    assert stand()["zoom"] > z0
    # 3. Gran Canaria: nah genug → Linien im Ausschnitt, Startpunkte einzeln, Popup mit Name, Datum, Strecke und „Öffnen“
    pg.evaluate(f"{K}.map.setView([27.99, -15.58], 10, {{ animate: false }})"); ruhig()
    pg.wait_for_function(f"ids => {{ const l = {K}.linien.getLayers().map(x => x._tid); return ids.every(i => l.includes(i)); }}", arg=ids[4:8], timeout=10000)
    s = stand(); n_gc = im_bild(); assert s["summe"] >= n_gc >= 4 and s["info"] == f"{n_gc} Touren", (s, n_gc)
    if n_gc == 4: assert s["einzeln"] == 4 and not s["gruppen"], s      # allein auf der Insel: vier einzelne Startpunkte (im großen Lauf liegen dort auch Wanderführer-Touren)
    if shots: pg.screenshot(path=shots + "/karte_gran_canaria.png")
    pg.evaluate(f"{K}.map.setView([28.05, -15.73], 15, {{ animate: false }})"); ruhig()
    pg.locator(".map.full .tmk[title^='Tamadaba']").click(); pg.wait_for_selector(".leaflet-popup-content")
    tx = pg.inner_text(".leaflet-popup-content"); assert "Tamadaba" in tx and "km" in tx and "Öffnen" in tx, tx
    assert pg.get_attribute(".leaflet-popup-content a", "href") == "#/tour/" + ids[6]
    # Herauszoomen unter Zoom 9: Linien verschwinden, Punkte bleiben
    pg.evaluate(f"{K}.map.setZoom(8, {{ animate: false }})"); ruhig()
    pg.wait_for_function(f"() => {K}.linien.getLayers().length === 0", timeout=10000); s = stand(); assert s["summe"] >= im_bild() and s["info"] == pg.evaluate("n => KartenPunkte.anzahlText(n)", im_bild()), s
    # 4. Selber Ort (Hausrunde dreimal): auch ganz nah eine Gruppe „3“, Antippen zeigt die Liste
    for zz in ("14", f"{K}.map.getMaxZoom()"):      # schon vor der höchsten Stufe: hineinzoomen würde nichts trennen, also gleich die Liste
        pg.evaluate(f"{K}.map.closePopup(); {K}.map.setView([47.7012, 12.0123], {zz}, {{ animate: false }})"); ruhig(); z1 = stand()["zoom"]
        pg.locator(".map.full .tgrp", has=pg.locator("span", has_text=re.compile(r"^3$"))).click(); pg.wait_for_selector(".leaflet-popup-content")
        tx = pg.inner_text(".leaflet-popup-content"); assert "3 Touren" in tx and tx.count("Alpen Hausrunde") == 3 and stand()["zoom"] == z1, tx
    # 5. Jahresfilter wirkt auf die Punkte; „Alle Touren“ zeigt alle Startpunkte des Jahres
    pg.select_option("select[aria-label=Jahr]", "2023"); pg.click("#alletouren"); ruhig()
    n23 = pg.evaluate("Tours.list().then(l => l.filter(t => t.status !== 'planned' && !t.hidden && t.lat != null && new Date(t.start).getFullYear() === 2023).length)")
    pg.wait_for_function(f"n => document.querySelector('#mapinfo').textContent === n + ' Touren'", arg=n23, timeout=10000)
    s = stand(); assert s["summe"] == n23 and s["zoom"] <= 3, (s, n23)
    pg.select_option("select[aria-label=Jahr]", ""); pg.click("#alletouren"); ruhig()      # „N Touren“ zählt nur, was im Ausschnitt liegt
    pg.wait_for_function(f"n => document.querySelector('#mapinfo').textContent === n + ' Touren'", arg=n_alle, timeout=10000)
    # Fotos zeigen wie bisher (schaltet um, Punkte bleiben)
    pg.locator(".maptools .chip", has_text="Fotos zeigen").click(); pg.wait_for_selector(".maptools .chip.on"); assert stand()["summe"] == n_alle
    pg.locator(".maptools .chip", has_text="Fotos zeigen").click(); pg.wait_for_selector(".maptools .chip:not(.on)")
    # 6. Touren in einer Gegend (unter 1000 km): Linien wie bisher schon im ersten Ausschnitt
    pg.evaluate("async ids => { for (const id of ids) await Tours.remove(id); }", ids)
    go(pg, "#/start", "#view"); go(pg, "#/map", ".map.full .leaflet-marker-icon"); ruhig()
    ab = int(pg.evaluate("document.querySelector('.map.full').dataset.linienAb"))
    sp = pg.evaluate("Tours.list().then(l => KartenPunkte.spanneKm(l.filter(t => t.status !== 'planned' && !t.hidden && t.lat != null)))")
    s = stand(); assert s["summe"] >= im_bild() and s["info"] == pg.evaluate("n => KartenPunkte.anzahlText(n)", im_bild()), s
    if sp <= 1000: pg.wait_for_function(f"() => {K}.linien.getLayers().length > 0", timeout=10000); assert ab <= 9 and s["zoom"] >= ab, (ab, s)
    else: assert ab == 9, (ab, sp)      # im großen Testlauf liegen auch andere Testtouren weit verstreut
    print("Karte 2.8.1: Welt, Gruppen, Gran Canaria, Jahresfilter, Liste am selben Ort – in Ordnung")

def panorama_280(pg):
    """2.8.0: Panorama – Knopf in der Aufnahme, Hinweis (mit „Nicht mehr zeigen“), Rückkehr → „Panorama übernehmen?“, Auswahl, Später/Nein, Verfall,
    Rückfall ohne Aufnahmezeit, Vollbild mit sehr breitem Bild (auf Höhe quer schiebbar / ganz), Kennzeichen in Details und Raster."""
    import io
    from PIL import Image
    leise = lambda: pg.wait_for_function(LEISE, timeout=30000)
    t0 = 1700000000000
    pg.evaluate("window.__rec.state = 'idle'; window.__rec.unsent = false; window.__pano = null; window.__panoOk = true; window.__pickPh = null; Set_.set('panoHinweisAus', false)")
    go(pg, "#/rec", ".bigstart"); pg.click(".bigstart"); pg.wait_for_selector(".bigtime")
    pg.wait_for_selector("#rpano"); assert "Panorama" in pg.inner_text("#rpano")
    n_pano = lambda: pg.evaluate("__calls.filter(c => c[0] === 'pano').length")
    n0 = n_pano()
    # 1. Hinweis: Abbrechen öffnet nichts, „Kamera öffnen“ startet die Kamera-App (Start gemerkt)
    pg.locator("#rpano").scroll_into_view_if_needed(); pg.click("#rpano"); pg.wait_for_selector(".sheet[aria-label='Panorama aufnehmen']")
    tx = pg.inner_text(".sheet[aria-label='Panorama aufnehmen']")
    assert "Modus Panorama" in tx and "zurückkehren" in tx and "Nicht mehr zeigen" in tx, tx
    pg.get_by_role("button", name="Abbrechen", exact=True).click(); pg.wait_for_selector(".sheet", state="detached")
    assert n_pano() == n0 and not pg.evaluate("window.__pano")
    pg.click("#rpano"); pg.wait_for_selector("#pano-go"); pg.click("#pano-go"); pg.wait_for_selector(".sheet", state="detached")
    pg.wait_for_function("n => __calls.filter(c => c[0] === 'pano').length === n + 1", arg=n0)
    assert pg.evaluate("!!window.__pano && window.__pano.ts > 0") and pg.evaluate("Set_.get('panoHinweisAus')") is False
    # … mit „Nicht mehr zeigen“: danach direkt zur Kamera
    pg.click("#rpano"); pg.wait_for_selector("#pano-go"); pg.click("label.sw:has(#pano-nie)"); assert pg.is_checked("#pano-nie")
    pg.click("#pano-go"); pg.wait_for_function("Set_.get('panoHinweisAus') === true"); pg.wait_for_selector(".sheet", state="detached")
    pg.click("#rpano"); pg.wait_for_function("n => __calls.filter(c => c[0] === 'pano').length === n + 3", arg=n0)
    pg.wait_for_timeout(300); assert pg.locator(".sheet").count() == 0, "kein Hinweis mehr"
    # keine Kamera-App: Meldung, nichts gemerkt
    pg.evaluate("window.__pano = null; window.__panoOk = false"); leise(); pg.click("#rpano")
    assert "Keine Kamera-App" in toast_text(pg, "Keine Kamera-App"); assert not pg.evaluate("window.__pano")
    pg.evaluate("window.__panoOk = true"); pg.click("#rpano"); pg.wait_for_function("!!window.__pano")

    # 2. Zurück aus der Kamera (mtresume) → Rückfrage. „Später“ lässt den Start offen, beim nächsten Zurückkehren wird wieder gefragt
    pg.evaluate("window.dispatchEvent(new Event('mtresume'))"); pg.wait_for_selector(".sheet[aria-label='Panorama übernehmen?']")
    assert "Foto auswählen" in pg.inner_text(".sheet[aria-label='Panorama übernehmen?']")
    pg.click("#pano-spaeter"); pg.wait_for_selector(".sheet", state="detached"); assert pg.evaluate("!!window.__pano"), "Später: Start bleibt"
    # zweimal schnell hintereinander zurück: nur eine Rückfrage
    pg.evaluate("window.dispatchEvent(new Event('mtresume')); window.dispatchEvent(new Event('mtresume'))"); pg.wait_for_selector(".sheet[aria-label='Panorama übernehmen?']")
    pg.wait_for_timeout(200); assert pg.locator(".sheet[aria-label='Panorama übernehmen?']").count() == 1
    # 3. „Foto auswählen“: System-Fotoauswahl, mehrere Fotos; mit Aufnahmezeit → Tour und Position aus der Spur, ohne → Zeit und Ort des Kamera-Starts
    start = pg.evaluate("window.__pano.ts")
    pg.evaluate("t0 => { window.__pickPh = [{ id: 'pa11aa22bb33', name: 'PANO_1.jpg', ts: t0 + 300000, w: 4096, h: 1024, src: 'galerie', exif: true }, { id: 'pa44cc55dd66', name: 'PANO_2.jpg', ts: 1234, w: 4096, h: 900, src: 'galerie', exif: false }]; window.__pickN = 0; }", t0)
    leise(); pg.click("#pano-pick")
    assert "2 Fotos übernommen" in toast_text(pg, "übernommen")
    assert pg.evaluate("window.__pickArgs && window.__pickArgs.picker === true"), "System-Fotoauswahl angefordert"
    assert not pg.evaluate("window.__pano"), "bedient: Start erledigt"
    a, b2, tid = pg.evaluate("async () => [await DB.get('photos', 'pa11aa22bb33'), await DB.get('photos', 'pa44cc55dd66'), (await Tours.list()).find(t => t.name === 'Hüttenrunde').id]")
    assert a["tour"] == tid and a["pos"] == "track" and abs(a["lat"] - 47.0) < 0.05 and a["ts"] == t0 + 300000, a
    assert b2["ts"] == start and b2["lat"] == 47.5 and b2["lon"] == 11.2 and b2["pos"] == "start", b2
    # ein Panorama allein: eigene Meldung; schon vorhandenes: „Schon vorhanden“
    pg.click("#rpano"); pg.wait_for_function("!!window.__pano"); pg.evaluate("window.dispatchEvent(new Event('mtresume'))"); pg.wait_for_selector("#pano-pick")
    pg.evaluate("window.__pickPh = [{ id: 'pa77ee88ff99', name: 'PANO_3.jpg', ts: 1700000400000, w: 4096, h: 1000, src: 'galerie', exif: true }]")
    leise(); pg.click("#pano-pick"); assert "Panorama übernommen" in toast_text(pg, "Panorama übernommen")
    pg.click("#rpano"); pg.wait_for_function("!!window.__pano"); pg.evaluate("window.dispatchEvent(new Event('mtresume'))"); pg.wait_for_selector("#pano-pick")
    leise(); pg.click("#pano-pick"); assert "Schon vorhanden" in toast_text(pg, "Schon vorhanden")
    # nichts gewählt
    pg.click("#rpano"); pg.wait_for_function("!!window.__pano"); pg.evaluate("window.__pickPh = []; window.dispatchEvent(new Event('mtresume'))"); pg.wait_for_selector("#pano-pick")
    leise(); pg.click("#pano-pick"); assert "Kein Foto gewählt" in toast_text(pg, "Kein Foto gewählt")
    # 4. „Nein“: verworfen, keine Auswahl
    pg.click("#rpano"); pg.wait_for_function("!!window.__pano"); pg.evaluate("window.__pickN = 0; window.dispatchEvent(new Event('mtresume'))"); pg.wait_for_selector("#pano-nein")
    pg.click("#pano-nein"); pg.wait_for_selector(".sheet", state="detached")
    assert not pg.evaluate("window.__pano") and pg.evaluate("window.__pickN") == 0
    pg.evaluate("window.dispatchEvent(new Event('mtresume'))"); pg.wait_for_timeout(400); assert pg.locator(".sheet").count() == 0, "nach Nein keine Frage mehr"
    # 5. Verfall: Start vor 13 Stunden → keine Frage, still gelöscht
    pg.evaluate("window.__pano = { ts: Date.now() - 13 * 3600000, lat: 47.5, lon: 11.2 }; window.dispatchEvent(new Event('mtresume'))")
    pg.wait_for_function("!window.__pano", timeout=5000); pg.wait_for_timeout(300); assert pg.locator(".sheet").count() == 0
    # 6. nach Prozessende (App neu gestartet): Prüfung beim Start; Schließen mit ✕ = später
    pg.evaluate("window.__pano = { ts: Date.now() - 3 * 3600000 }; void Pano.check()"); pg.wait_for_selector(".sheet[aria-label='Panorama übernehmen?']")
    pg.click(".sheet[aria-label='Panorama übernehmen?'] .sheet-h button"); pg.wait_for_selector(".sheet", state="detached")
    assert pg.evaluate("!!window.__pano"); pg.evaluate("window.__pano = null; window.__pickPh = null")
    pg.evaluate("window.__rec.state = 'idle'; window.__rec.unsent = false; Set_.set('panoHinweisAus', false)")

    # 7. Vollbild mit sehr breitem Bild (6000 × 1200): auf Höhe, quer schiebbar, umschaltbar auf „ganz“; normales Foto ohne Umschalter
    def jpeg(w, h, farbe):
        im = Image.new("RGB", (w, h), farbe)
        for x in range(0, w, 500): im.paste((255, 255, 255), (x, 0, x + 20, h))
        bb = io.BytesIO(); im.save(bb, "JPEG", quality=70); return bb.getvalue()
    pano_jpg, norm_jpg = jpeg(6000, 1200, (40, 90, 160)), jpeg(800, 600, (120, 140, 60))
    pg.route("**/photo/panotest*", lambda r: r.fulfill(status=200, body=pano_jpg, content_type="image/jpeg"))
    pg.route("**/thumb/panotest*", lambda r: r.fulfill(status=200, body=pano_jpg, content_type="image/jpeg"))
    pg.route("**/photo/normtest*", lambda r: r.fulfill(status=200, body=norm_jpg, content_type="image/jpeg"))
    pg.evaluate("""async () => { await DB.put('photos', { id: 'normtest0001', name: 'n.jpg', ts: 1700000500000, w: 800, h: 600, src: 'galerie', tour: '', pos: 'none' });
      await DB.put('photos', { id: 'panotest0001', name: 'PANO.jpg', ts: 1700000600000, w: 6000, h: 1200, src: 'galerie', tour: '', pos: 'none' }); }""")
    go(pg, "#/photos", ".photos")
    pg.wait_for_selector(".pt[aria-label='Panorama öffnen'] .pt-pano")
    fit = pg.evaluate("getComputedStyle(document.querySelector(\".pt[aria-label='Panorama öffnen'] img\")).objectFit")
    assert fit == "cover", fit
    pg.evaluate("async () => Lightbox.open([await DB.get('photos', 'normtest0001'), await DB.get('photos', 'panotest0001')], 1)")
    pg.wait_for_function("() => { const i = document.querySelector('.lb-img'); return i && i.complete && i.naturalWidth === 6000; }", timeout=20000)
    pg.wait_for_selector("#lb-pano:not([hidden])"); assert "Ganz anzeigen" in pg.inner_text("#lb-pano")
    m = pg.evaluate("""() => { const i = document.querySelector('img.lb-img'), p = document.querySelector('#lb-pan'), r = i.getBoundingClientRect();
      return { h: r.height, w: r.width, sw: p.scrollWidth, cw: p.clientWidth, sl: p.scrollLeft, fit: document.querySelector('.lb').classList.contains('panofit'), vh: innerHeight, vw: innerWidth }; }""")
    assert m["fit"] and m["h"] >= m["vh"] * 0.9 and m["w"] > m["vw"] * 5 and m["sw"] > m["cw"] + 1000, m
    assert abs(m["w"] / m["h"] - 5) < 0.2, ("Seitenverhältnis bleibt", m)
    pg.wait_for_function("document.querySelector('#lb-pan').scrollLeft > 200", timeout=5000)      # beginnt in der Mitte
    pg.evaluate("document.querySelector('#lb-pan').scrollLeft = 0"); assert pg.evaluate("document.querySelector('#lb-pan').scrollLeft") == 0
    pg.mouse.move(195, 400); pg.mouse.wheel(1500, 0); pg.wait_for_function("document.querySelector('#lb-pan').scrollLeft > 100", timeout=5000)      # quer schieben
    tb = pg.evaluate("() => { const r = document.querySelector('#lb-pano').getBoundingClientRect(); return [r.left, r.right, r.height, innerWidth]; }")
    assert tb[0] > 40 and tb[1] <= tb[3] and tb[2] >= 44, ("Umschalter passt in die Kopfzeile", tb)
    # „Ganz anzeigen“: ganzes Bild auf Breite; zurück „Auf Höhe“
    pg.click("#lb-pano"); pg.wait_for_function("!document.querySelector('.lb').classList.contains('panofit')")
    m2 = pg.evaluate("() => { const r = document.querySelector('img.lb-img').getBoundingClientRect(); return { w: r.width, h: r.height, vw: innerWidth }; }")
    assert m2["w"] <= m2["vw"] + 1 and m2["w"] > m2["vw"] * 0.9 and abs(m2["w"] / m2["h"] - 5) < 0.2, m2
    assert "Auf Höhe" in pg.inner_text("#lb-pano")
    pg.click("#lb-pano"); pg.wait_for_function("document.querySelector('.lb').classList.contains('panofit')")
    # Details: Kennzeichen „Panorama“
    pg.click(".lb [aria-label=Details]"); pg.wait_for_selector("#lb-panotag"); assert "Panorama" in pg.inner_text("#lb-panotag") and "6000 × 1200" in pg.inner_text("#lb-panotag")
    zu(pg)
    # normales Foto: kein Umschalter, normale Darstellung
    pg.click(".lb-nav.l"); pg.wait_for_function("() => { const i = document.querySelector('.lb-img'); return i && i.complete && i.naturalWidth === 800; }", timeout=20000)
    assert pg.evaluate("document.querySelector('#lb-pano').hidden && !document.querySelector('.lb').classList.contains('panofit')")
    m3 = pg.evaluate("() => { const r = document.querySelector('img.lb-img').getBoundingClientRect(); return { w: r.width, vw: innerWidth }; }")
    assert m3["w"] <= m3["vw"] + 1, m3
    pg.click(".lb-nav.l"); pg.wait_for_selector("#lb-pano:not([hidden])")      # wieder das Panorama
    pg.evaluate("window.__lightbox && window.__lightbox.close()")
    pg.unroute("**/photo/panotest*"); pg.unroute("**/thumb/panotest*"); pg.unroute("**/photo/normtest*")
    pg.evaluate("async () => { for (const id of ['pa11aa22bb33', 'pa44cc55dd66', 'pa77ee88ff99', 'normtest0001', 'panotest0001']) await DB.del('photos', id); }")


def von_aussen(pg):
    """2.6.2: Von außen geöffnete Strecke (z. B. Total Commander): Rückfrage gemacht/geplant/abbrechen."""
    t0 = 1700000000000
    g = gpx(t0 + 86400000 * 3, name="Aussen")
    pg.evaluate("() => { window.__fb0 = Import.fetchBuf; window.__ts0 = MTApp.takeShared; }")
    def offnen(antwort):
        pg.evaluate("""g => { window.__tn = 0; Import.fetchBuf = async () => new TextEncoder().encode(g);
          MTApp.takeShared = () => { window.__tn++; return window.__tn === 1 ? JSON.stringify([{ name: 'aussen.gpx', url: 'x://y' }]) : '[]'; };
          window.__shared = handleShared(); }""", g)
        pg.wait_for_selector(".sheet #sh-gemacht")
        assert "geplant" in pg.inner_text(".sheet") and pg.locator(".sheet #sh-geplant").count() == 1
        pg.click(".sheet #" + antwort); pg.wait_for_selector(".sheet", state="detached")
        pg.evaluate("window.__shared"); pg.wait_for_timeout(300)
    n0 = pg.evaluate("Tours.list().then(l => l.length)")
    offnen("sh-abbruch")
    assert pg.evaluate("Tours.list().then(l => l.length)") == n0, "Abbrechen speichert nichts"
    offnen("sh-geplant")
    l = pg.evaluate("Tours.list().then(l => l.filter(t => t.name === 'Aussen').map(t => ({ s: t.status, timed: t.timed, src: t.src })))")
    assert len(l) == 1 and l[0]["s"] == "planned" and not l[0]["timed"], l
    pg.evaluate("Tours.list().then(l => Promise.all(l.filter(t => t.name === 'Aussen').map(t => Tours.remove ? Tours.remove(t.id) : DB.del('tours', t.id)))).then(() => Tours.invalidate())")
    offnen("sh-gemacht")
    l = pg.evaluate("Tours.list().then(l => l.filter(t => t.name === 'Aussen').map(t => ({ s: t.status, timed: t.timed })))")
    assert len(l) == 1 and l[0]["s"] == "done" and l[0]["timed"], l
    pg.evaluate("Tours.list().then(l => Promise.all(l.filter(t => t.name === 'Aussen').map(t => Tours.remove ? Tours.remove(t.id) : DB.del('tours', t.id)))).then(() => Tours.invalidate())")
    pg.evaluate("() => { Import.fetchBuf = window.__fb0; MTApp.takeShared = window.__ts0; }")      # die Nachstellung darf andere Prüfungen nicht stören
    print("Von außen geöffnet: Rückfrage gemacht/geplant/abbrechen ok")


MD_MOCK = """() => {
  /* 2.10.0: Medien-Sicherung der Hülle nachgestellt: mediaStatus / mediaFolder / mediaBackup / mediaPickZips / mediaRestore / mediaJob / mediaCancel / autoBackup */
  const c0 = window.MTApp.call; window.__mdcall0 = c0; const MB = 1048576;
  window.__md = { calls: [], folder: {}, pickFolder: { tree: 'content://com.android.externalstorage.documents/tree/primary%3ASicherung', name: 'Sicherung', ok: true },
    status: { anzahl: 8, bytes: 30 * MB, neu: 5, neuBytes: 12 * MB, teile: 2, running: false }, job: { running: false },
    zips: [{ uri: 'content://x/document/a', name: 'Medien_2026-11-01.zip', size: 1024 * MB }, { uri: 'content://x/document/b', name: 'Medien_2026-11-20.zip', size: 512 * MB }], auto: [] };
  window.MTApp.call = (id, m, a) => {
    if (!/^(media|autoBackup)/.test(m)) return c0.call(window.MTApp, id, m, a);
    const D = window.__md, o = JSON.parse(a || '{}'); D.calls.push([m, o]); let r;
    if (m === 'mediaStatus') r = Object.assign({}, D.status, D.folder.tree ? { folder: D.folder } : {}, { running: !!D.job.running });
    else if (m === 'mediaFolder') { if (o.pick) D.folder = D.pickFolder; r = D.folder; }
    else if (m === 'mediaBackup') { D.job = { running: true, kind: 'backup', phase: 'schreiben', done: 0, total: 2 * D.status.neuBytes, part: 1, parts: D.status.teile, file: 1, files: D.status.neu }; r = { started: true }; }
    else if (m === 'mediaPickZips') r = D.zips;
    else if (m === 'mediaRestore') { D.job = { running: true, kind: 'restore', phase: 'lesen', done: 0, total: 100, file: 1, files: (o.uris || []).length }; r = { started: true }; }
    else if (m === 'mediaJob') r = D.job;
    else if (m === 'mediaCancel') { D.job = { running: false, kind: D.job.kind, cancelled: true, result: D.job.kind === 'backup' ? { files: 0, parts: 0 } : { restored: 0 } }; r = true; }
    else if (m === 'autoBackup') { D.auto.push(o); r = { name: o.name, folder: 'Sicherung', deleted: 0 }; }
    setTimeout(() => window.__mtcb(+id, true, JSON.stringify(r)), 5);
  };
}"""

def rettung_2120(pg):
    """2.12.0 A: unterbrochene Aufzeichnung (Hülle meldet interrupted) – Hinweis auf Start und im Aufnahme-Reiter, Fortsetzen (bis 12 h),
    Dienst kommt doch zurück, Als Tour speichern, Verwerfen mit Rückfrage; Akku-Hinweis in den Einstellungen."""
    leise = lambda: pg.wait_for_function(LEISE, timeout=30000)
    t0 = 1763790000000
    unterbrochen = """([alt, kann]) => { const now = Date.now(); Object.assign(window.__rec, { state: 'recording', interrupted: true, can_resume: kann, start: now - alt - 3600000,
      last_ts: now - alt, count: 1234, dist_m: 12345, active_s: 3600, lat: 47.5, lon: 11.2, fix_age_s: -1, unsent: false }); }"""
    pg.evaluate("""() => { window.__akkuFrei = false; window.__akkuAuf = 0; window.__bat0 = MTApp.openBatterySettings;
      MTApp.openBatterySettings = () => { window.__akkuAuf++; }; MTApp.batteryUnrestricted = () => window.__akkuFrei;
      MTApp.resumeInterrupted = () => { if (!window.__rec.can_resume) return false; window.__rec.interrupted = false; window.__rec.fix_age_s = 1; window.__resumed = (window.__resumed || 0) + 1; return true; }; }""")
    tid = None
    try:
        # 1. Startseite: deutlicher Hinweis mit Datum, Punkten, Strecke; drei Knöpfe
        pg.evaluate(unterbrochen, [25 * 60000, True])
        go(pg, "#/start", "#recrescue")
        txt = pg.inner_text("#rr-txt")
        assert txt.startswith("Aufnahme vom ") and "wurde unterbrochen (1.234 Punkte, 12,3 km)" in txt, txt
        assert "vor 25 Minuten" in pg.inner_text("#rr-sub") and "die Lücke markiert" in pg.inner_text("#rr-sub"), pg.inner_text("#rr-sub")
        assert pg.is_visible("#rr-weiter") and pg.is_visible("#rr-save") and pg.is_visible("#rr-drop")
        assert "läuft" not in pg.inner_text("#startrec"), "unterbrochen ist keine laufende Aufnahme"
        bad = layout_check(pg, ["#/start", "#/rec"], widths=((360, 100), (390, 100), (360, 130)))
        assert not bad, "\n".join(bad)
        go(pg, "#/start", "#recrescue")
        # 2. Fortsetzen → Aufnahme läuft wieder (Hülle setzt fort)
        leise(); pg.click("#rr-weiter")
        pg.wait_for_function("location.hash === '#/rec'"); pg.wait_for_selector(".bigtime")
        assert pg.evaluate("window.__resumed") == 1 and "Lücke ist markiert" in toast_text(pg, "Lücke")
        # 3. Im Aufnahme-Reiter: läuft der Dienst nicht mehr, wechselt die Anzeige zum Hinweis; kommt er zurück (Neustart durch Android), wieder normal
        pg.evaluate(unterbrochen, [3 * 3600000, True])
        pg.wait_for_selector("#recrescue", timeout=10000)
        assert pg.inner_text("header.top h1") == "Aufnahme unterbrochen" and "vor 3 Stunden" in pg.inner_text("#rr-sub")
        assert "Akku" in pg.inner_text("#rr-why") and "eingeschränkt" in pg.inner_text("#rec-akku"), pg.inner_text("#rec-akku")
        pg.click("#rec-akku"); assert pg.evaluate("window.__akkuAuf") == 1, "Akku-Einstellungen öffnen"
        pg.evaluate("() => { window.__rec.interrupted = false; window.__rec.fix_age_s = 1; }")
        pg.wait_for_selector(".bigtime", timeout=10000)
        # 4. Älter als 12 Stunden: kein Fortsetzen, ehrlicher Satz
        pg.evaluate(unterbrochen, [13 * 3600000, False])
        go(pg, "#/start", "#recrescue")
        assert pg.locator("#rr-weiter").count() == 0 and "nur bis 12 Stunden" in pg.inner_text("#rr-sub"), pg.inner_text("#rr-sub")
        # 5. Verwerfen: erst Rückfrage (Abbrechen lässt alles), dann verwerfen
        leise(); pg.click("#rr-drop"); pg.wait_for_selector(".sheet[aria-label='Unterbrochene Aufnahme verwerfen?']")
        assert "Sicherungskopie" in pg.inner_text(".sheet[aria-label='Unterbrochene Aufnahme verwerfen?']")
        pg.get_by_role("button", name="Abbrechen", exact=True).click(); pg.wait_for_selector(".sheet", state="detached")
        assert pg.evaluate("__rec.state") == "recording" and pg.is_visible("#recrescue")
        pg.click("#rr-drop"); pg.wait_for_selector(".sheet[aria-label='Unterbrochene Aufnahme verwerfen?']")
        pg.click(".sheet[aria-label='Unterbrochene Aufnahme verwerfen?'] button.pri")
        assert "verworfen" in toast_text(pg, "verworfen") and pg.evaluate("__rec.state") == "idle"
        pg.wait_for_selector("#recrescue", state="detached")
        # 6. Als Tour speichern (aus dem Aufnahme-Reiter): beendet in der Hülle und speichert gleich als Tour
        pg.evaluate(unterbrochen, [40 * 60000, True])
        pg.evaluate("g => { window.__gpx = g }", gpx(t0, n=30, lat=46.6, name=""))
        go(pg, "#/rec", "#recrescue"); leise(); pg.click("#rr-save")
        pg.wait_for_function("location.hash.startsWith('#/tour/')", timeout=8000); tid = pg.evaluate("location.hash.split('/')[2]")
        assert "Tour gespeichert" in toast_text(pg, "gespeichert") and pg.evaluate("__rec.state") == "idle"
        assert pg.evaluate("sessionStorage.getItem('recAutoSave')") is None
        # 7. Einstellungen: Abschnitt Aufzeichnung mit ehrlichem Satz, Stand und Knopf
        go(pg, "#/settings", "#set-akku")
        assert "kann das nicht selbst einstellen" in pg.inner_text("#set-akku-txt") and "eingeschränkt" in pg.inner_text("#set-akku-stand")
        pg.click("#set-akku"); assert pg.evaluate("window.__akkuAuf") == 2
        pg.evaluate("window.__akkuFrei = true; window.dispatchEvent(new Event('mtresume'))")
        pg.wait_for_function("() => document.querySelector('#set-akku-stand').textContent.includes('nicht eingeschränkt ✓')")
    finally:
        pg.evaluate("""async id => { MTApp.openBatterySettings = window.__bat0; delete MTApp.batteryUnrestricted; delete MTApp.resumeInterrupted;
          Object.assign(window.__rec, { state: 'idle', unsent: false, interrupted: false, can_resume: false }); delete window.__rec.last_ts; window.__gpx = '';
          try { sessionStorage.removeItem('recAutoSave'); } catch (e) {} if (id) await Tours.remove(id); document.querySelectorAll('.sheet-back').forEach(e => e.remove()); sheet.stack = []; }""", tid)


def fotoort_2120(pg):
    """2.12.0 B: Orte aus der Tour ergänzen – Hinweis an der Tour, Vorschau am Beispielfoto, Uhrzeit-Verschiebung, Toleranz (gespeichert),
    außerhalb gelistet, Übernahme erst nach Bestätigung, Rückgängig (ein Schritt), Kennzeichnung in den Details, Menüeintrag, Platz bei 360 px."""
    leise = lambda: pg.wait_for_function(LEISE, timeout=30000)
    t0 = 1560000000000      # eigene Tour weit weg von den übrigen Testdaten (Juni 2019), damit keine fremden Fotos mitspielen
    ids = ["fo1aaaaaaa", "fo2aaaaaaa", "fo3aaaaaaa", "fo4aaaaaaa"]
    sh = ".sheet[aria-label='Orte aus der Tour ergänzen']"
    tid = None
    try:
        tid = pg.evaluate("""async t0 => (await Tours.add({ name: 'Ortetest', sport: 'hike', src: 'file', force: true,
          pts: Array.from({ length: 60 }, (_, i) => ({ lat: 47 + i * 0.0005, lon: 11 + i * 0.0004, ele: 800 + i * 3, t: t0 + i * 30000 })) })).tour.id""", t0)
        pg.evaluate("""async ([t0, tid]) => {
          await DB.put('photos', { id: 'fo1aaaaaaa', name: 'a.jpg', ts: t0 + 10 * 60000, lat: null, lon: null, pos: 'none', tour: tid, src: 'galerie', w: 10, h: 10 });
          await DB.put('photos', { id: 'fo2aaaaaaa', name: 'b.jpg', ts: t0 - 60 * 60000, lat: null, lon: null, pos: 'none', tour: '', src: 'galerie', w: 10, h: 10 });
          await DB.put('photos', { id: 'fo3aaaaaaa', name: 'c.jpg', ts: t0 + 5 * 60000, lat: 47.3, lon: 11.3, pos: 'exif', tour: tid, src: 'galerie', w: 10, h: 10 });
          await DB.put('photos', { id: 'fo4aaaaaaa', name: 'd.jpg', ts: t0 + 3 * 3600000, lat: null, lon: null, pos: 'none', tour: '', src: 'galerie', w: 10, h: 10 }); }""", [t0, tid])
        # 1. Tourseite: Hinweis „Fotos ohne Ort“ mit Knopf; Menüeintrag
        go(pg, "#/tour/" + tid, "#fotoort-btn")
        assert pg.inner_text("#fotoort-hint").startswith("3 Fotos ohne Ort"), pg.inner_text("#fotoort-hint")
        pg.click("header.top button[aria-label=Aktionen]"); pg.wait_for_selector("#fotoort-menu"); zu(pg)
        # 2. Blatt: ohne Verschiebung liegt Foto 1 (eine Stunde vor dem Start) außerhalb, Foto 2 auf der Spur; Foto mit eigenem Ort fehlt
        pg.click("#fotoort-btn"); pg.wait_for_selector(sh)
        assert pg.locator("#fo-list .li").count() == 3 and pg.locator("#fo-list .li[data-id=fo3aaaaaaa]").count() == 0
        assert "Foto 1 liegt dann außerhalb der Tour (1 h vor dem Start)" in pg.inner_text("#fo-bsp"), pg.inner_text("#fo-bsp")
        assert pg.inner_text("#fo-sum") == "1 Foto bekommt einen Ort · 2 liegen außerhalb", pg.inner_text("#fo-sum")
        km2 = pg.evaluate("async ([t0, tid]) => FotoOrtCalc.kmText(FotoOrtCalc.vorschlag([{ id: 'x', ts: t0 + 600000 }], await Tours.points(tid), {}).treffer[0].km)", [t0, tid])
        pg.click("#fo-list .li[data-id=fo1aaaaaaa]")
        assert pg.inner_text("#fo-bsp").startswith("Foto 2 liegt dann bei km " + km2), (pg.inner_text("#fo-bsp"), km2)
        assert "nicht zugeordnet: 2 h 31 min nach dem Ende" in pg.inner_text("#fo-list .li[data-id=fo4aaaaaaa]"), pg.inner_text("#fo-list")
        # 3. Kamera-Uhr eine Stunde nach: „+ 1 Stunde“ → Foto 1 am Start (km 0,0); Felder zeigen die Verschiebung
        pg.click("#fo-list .li[data-id=fo2aaaaaaa]"); pg.click("#fo-schnell button:has-text('+ 1 Stunde')")
        assert pg.inner_text("#fo-bsp").startswith("Foto 1 liegt dann bei km 0,0"), pg.inner_text("#fo-bsp")
        assert pg.input_value("#fo-std") == "1" and pg.input_value("#fo-min") == "0" and pg.input_value("#fo-vz") == "+"
        assert "Uhrzeit +1 h" in pg.inner_text("#fo-sum"), pg.inner_text("#fo-sum")
        # von Hand: 59 Minuten früher als +1 h → +1 min … dann 0 → wie am Anfang
        pg.fill("#fo-min", "30"); assert "Uhrzeit +1 h 30 min" in pg.inner_text("#fo-sum")
        pg.fill("#fo-min", "0")
        # 4. Toleranz 0: Foto 1 genau am Start bleibt; Toleranz wird gespeichert
        pg.select_option("#fo-tol", "0"); pg.wait_for_function("() => Set_.get('fotoOrtTol') === 0")
        pg.select_option("#fo-tol", "10"); pg.wait_for_function("() => Set_.get('fotoOrtTol') === 10")
        # 5. Platz bei 360 px und 130 % Schrift (Blatt oben)
        pg.evaluate("document.querySelector('.sheet-b').scrollTop = 0")
        bad = sheet_check_open(pg, "Orte ergänzen")
        assert not bad, "\n".join(bad)
        # 6. Übernehmen: erst Rückfrage (Abbrechen ändert nichts), dann übernommen
        pg.click("#fo-ok"); pg.wait_for_selector(".sheet[aria-label='Orte übernehmen?']")
        pg.click(".sheet[aria-label='Orte übernehmen?'] button:not(.pri)"); pg.wait_for_selector(".sheet[aria-label='Orte übernehmen?']", state="detached")
        assert pg.evaluate("DB.get('photos', 'fo2aaaaaaa').then(p => p.lat)") is None, "ohne Bestätigung nichts übernommen"
        leise(); pg.click("#fo-ok"); pg.wait_for_selector(".sheet[aria-label='Orte übernehmen?']")
        assert "1 Foto bekommt einen Ort" in pg.inner_text(".sheet[aria-label='Orte übernehmen?']") or "2 Fotos bekommen" in pg.inner_text(".sheet[aria-label='Orte übernehmen?']")
        pg.click(".sheet[aria-label='Orte übernehmen?'] button.pri")
        assert "ergänzt" in toast_text(pg, "ergänzt")
        p2 = pg.evaluate("DB.get('photos', 'fo2aaaaaaa')")
        start = pg.evaluate("tid => Tours.points(tid).then(p => p[0])", tid)
        assert p2["pos"] == "zeit" and p2["tour"] == tid and p2["camShift"] == 3600000 and abs(p2["lat"] - start["lat"]) < 1e-9, p2
        assert pg.evaluate("DB.get('photos', 'fo3aaaaaaa').then(p => p.lat)") == 47.3, "eigener Ort bleibt"
        pg.wait_for_function("() => document.querySelectorAll('#tphotos .strip .th').length >= 3")
        # alle Fotos neu zuordnen lässt die Verschiebung gelten (bleibt bei der Tour, Ort bleibt)
        pg.evaluate("Photos.assignAll(true)"); p2b = pg.evaluate("DB.get('photos', 'fo2aaaaaaa')")
        assert p2b["tour"] == tid and p2b["lat"] == p2["lat"] and p2b["pos"] == "zeit", p2b
        # Details: Kennzeichnung
        pg.evaluate("async () => Lightbox.open([await DB.get('photos', 'fo2aaaaaaa')], 0)"); pg.click(".lb button[aria-label=Details]")
        pg.wait_for_selector(".sheet[aria-label=Foto]"); assert "aus der Tourzeit ergänzt, Uhrzeit +1 h" in pg.inner_text(".sheet[aria-label=Foto]"), pg.inner_text(".sheet[aria-label=Foto]")
        zu(pg); pg.evaluate("window.__lightbox && window.__lightbox.close()")
        # 7. Rückgängig: ein Schritt, alte Werte genau zurück
        go(pg, "#/tour/" + tid, "#tphotos")
        pg.click("header.top button[aria-label=Aktionen]"); pg.click("#fotoort-menu"); pg.wait_for_selector(sh + " #fo-undo")
        leise(); pg.click("#fo-undo"); pg.wait_for_selector(".sheet[aria-label='Rückgängig machen?']"); pg.click(".sheet[aria-label='Rückgängig machen?'] button.pri")
        assert "Zurückgenommen" in toast_text(pg, "Zurückgenommen")
        p2c = pg.evaluate("DB.get('photos', 'fo2aaaaaaa')")
        assert p2c["lat"] is None and p2c["tour"] == "" and p2c["pos"] == "none" and "camShift" not in p2c, p2c
        assert pg.evaluate("tid => DB.kvGet('fotoOrtUndo:' + tid, null)", tid) is None
    finally:
        pg.evaluate("""async ([ids, tid]) => { for (const id of ids) await DB.del('photos', id); if (tid) { await DB.del('kv', 'fotoOrtUndo:' + tid); await Tours.remove(tid); } await Set_.set('fotoOrtTol', '');
          window.__lightbox && window.__lightbox.close(); document.querySelectorAll('.sheet-back').forEach(e => e.remove()); sheet.stack = []; }""", [ids, tid])


VJOB_MOCK = """() => {
  /* 2.12.0: VideoJob der Hülle nachgestellt: videoKeys / videoFrame / videoTrim / videoGalleryScan / videoGalleryCopy / videoJob / videoJobCancel */
  const c0 = window.MTApp.call; window.__vjcall0 = c0;
  window.__vj = { calls: [], job: { running: false }, keys: { dur: 10000, keys: [0, 2000, 4000, 6000, 8000], rot: 90, mime: 'video/hevc', audio: true },
    scan: { supported: true, all: 3, n: 2, ids: ['g1b2c3d4e5f6a7b8c9dv', 'g2b2c3d4e5f6a7b8c9dv'] }, startOk: true };
  window.MTApp.call = (id, m, a) => {
    const V = window.__vj;
    if (!['videoKeys', 'videoFrame', 'videoTrim', 'videoGalleryScan', 'videoGalleryCopy', 'videoJob', 'videoJobCancel'].includes(m)) return c0.call(window.MTApp, id, m, a);
    const o = JSON.parse(a || '{}'); V.calls.push([m, o]); let r;
    if (m === 'videoKeys') r = V.keys;
    else if (m === 'videoFrame') r = { url: '/cache/frames/' + o.id + '_' + o.ms + '.jpg', ms: o.ms };
    else if (m === 'videoTrim') { r = { started: V.startOk }; if (V.startOk) V.job = { running: true, kind: 'trim', done: 0, total: 1, pct: 0 }; }
    else if (m === 'videoGalleryScan') r = V.scan;
    else if (m === 'videoGalleryCopy') { r = { started: true }; V.job = { running: true, kind: 'gallery', done: 0, total: o.items.length, pct: 0 }; }
    else if (m === 'videoJob') r = V.job;
    else if (m === 'videoJobCancel') { V.cancelAsked = true; r = true; }
    setTimeout(() => window.__mtcb(+id, true, JSON.stringify(r)), 5);
  };
  window.__vjEnde = (res, extra) => { window.__vj.job = Object.assign({ running: false, kind: window.__vj.job.kind, done: 1, total: 1, pct: 100, cancelled: false }, res ? { result: res } : {}, extra || {}); };
}"""

def video_2120(pg):
    """2.12.0 C: Video zuschneiden (Schlüsselbild ehrlich angezeigt, Zeitfelder und Regler, Vorschaubilder, neues Video oder Original ersetzen mit Rückfrage,
    Fortschritt, Abbrechen, Fehler, belegt) und vorhandene Videos in die Galerie kopieren (Zählung, Rückfrage, Fortschritt, Ergebnis, Android unter 10)."""
    leise = lambda: pg.wait_for_function(LEISE, timeout=30000)
    pg.evaluate(VJOB_MOCK)
    vid, neu_id = "e1b2c3d4e5f6a7b8c9dv", "f1b2c3d4e5f6a7b8c9dv"
    t0 = 1700000300000
    calls = lambda m: pg.evaluate("m => __vj.calls.filter(c => c[0] === m).map(c => c[1])", m)
    sh = ".sheet[aria-label='Video zuschneiden']"
    def oeffne():
        pg.evaluate("async id => { window.__lightbox && window.__lightbox.close(); Lightbox.open([await DB.get('photos', id)], 0); }", vid)
        pg.click(".lb button[aria-label=Details]"); pg.wait_for_selector("#lb-dtrim"); pg.click("#lb-dtrim"); pg.wait_for_selector(sh)
    try:
        tid = pg.evaluate("Tours.list().then(l => l.find(t => t.name === 'Hüttenrunde').id)")
        pg.evaluate("async ([id, ts, tid]) => DB.put('photos', { id, name: 'Video.mp4', ts, w: 1920, h: 1080, dur: 10000, video: true, src: 'kamera', tour: tid, lat: 47.01, lon: 11.01, pos: 'exif', note: 'Gipfel' })", [vid, t0, tid])
        # 1. Blatt öffnen: ganzes Video gewählt → nichts zu schneiden
        oeffne()
        assert pg.inner_text("#vt-info") == "Schnitt bei 0:00,0 (Anfang) · Ende bei 0:10,0 · neue Länge 0:10,0", pg.inner_text("#vt-info")
        assert pg.is_disabled("#vt-go") and "Nichts weggeschnitten" in pg.inner_text("#vt-warn")
        # 2. Anfang 0:03,2 → Schnitt am Schlüsselbild 0:02,0 (ehrlich angezeigt), Regler folgt; Ende über den Regler
        pg.fill("#vt-at", "0:03,2"); pg.dispatch_event("#vt-at", "change")
        assert pg.inner_text("#vt-info").startswith("Schnitt bei 0:02,0 (nächstes Schlüsselbild davor)"), pg.inner_text("#vt-info")
        assert pg.input_value("#vt-a") == "3200"
        pg.evaluate("() => { const r = document.querySelector('#vt-e'); r.value = 7300; r.dispatchEvent(new Event('input')); }")
        assert "Ende bei 0:07,3 · neue Länge 0:05,3" in pg.inner_text("#vt-info") and pg.input_value("#vt-et") == "0:07,3"
        assert not pg.is_disabled("#vt-go") and pg.inner_text("#vt-go") == "Zuschneiden als neues Video" and pg.inner_text("#vt-warn") == ""
        # Vorschaubilder: am wirklichen Schnitt (Schlüsselbild) und genau am Ende
        pg.wait_for_function("() => (document.querySelector('#vt-fa').getAttribute('src') || '').endsWith('_2000.jpg')", timeout=5000)
        fr = calls("videoFrame"); assert any(c["ms"] == 2000 and not c["exact"] for c in fr) and any(c["ms"] == 7250 and c["exact"] for c in fr), fr
        # unlesbare Zeit: Hinweis, Feld zurück; zu kurz: Hinweis
        leise(); pg.fill("#vt-et", "abc"); pg.dispatch_event("#vt-et", "change")
        assert "Minuten:Sekunden" in toast_text(pg, "Minuten") and pg.input_value("#vt-et") == "0:07,3"
        pg.fill("#vt-et", "0:02,5"); pg.dispatch_event("#vt-et", "change")
        assert pg.is_disabled("#vt-go") and "mindestens 1 Sekunde" in pg.inner_text("#vt-warn")
        pg.fill("#vt-et", "7,3"); pg.dispatch_event("#vt-et", "change"); assert not pg.is_disabled("#vt-go")
        # Platz bei 360 px / 130 %
        pg.evaluate("document.querySelector('.sheet-b').scrollTop = 0"); bad = sheet_check_open(pg, "Video zuschneiden"); assert not bad, "\n".join(bad)
        # 3. Als neues Video: Auftrag an die Hülle, Fortschritt, fertig → neuer Eintrag (Zeit + Schnitt, gleiche Tour und Ort), Vollbild zeigt ihn
        pg.click("#vt-go"); pg.wait_for_selector("#vj-txt")
        assert calls("videoTrim")[-1] == {"id": vid, "startMs": 2000, "endMs": 7300, "replace": False}, calls("videoTrim")
        pg.evaluate("__vj.job.pct = 40"); pg.wait_for_function("() => document.querySelector('#vj-txt').textContent === 'Wird zugeschnitten … 40 %'")
        leise(); pg.evaluate("r => __vjEnde(r)", {"ok": True, "src": vid, "id": neu_id, "w": 1920, "h": 1080, "dur": 5300, "startMs": 2000, "endMs": 7300, "replaced": False})
        assert "als neues Video gespeichert" in toast_text(pg, "neues Video")
        n = pg.evaluate("id => DB.get('photos', id)", neu_id)
        assert n and n["ts"] == t0 + 2000 and n["dur"] == 5300 and n["tour"] == tid and n["lat"] == 47.01 and n["video"] and n["trimOf"] == vid and n["note"] == "", n
        assert pg.evaluate("id => DB.get('photos', id).then(p => p.dur)", vid) == 10000, "Original bleibt"
        pg.wait_for_function("() => document.querySelector('.lb .lb-cnt').textContent === '2 / 2'")
        # 4. Original ersetzen: Rückfrage (Abbrechen = nichts), dann ersetzt → Länge und Zeit des Originals neu
        oeffne(); pg.fill("#vt-at", "4"); pg.dispatch_event("#vt-at", "change"); pg.click("#vt-ers")
        assert pg.inner_text("#vt-go") == "Zuschneiden und ersetzen" and pg.get_attribute("#vt-ers", "aria-pressed") == "true", pg.inner_text("#vt-go")
        pg.click("#vt-go"); pg.wait_for_selector(".sheet[aria-label='Original ersetzen?']")
        assert "0:04,0–0:10,0" in pg.inner_text(".sheet[aria-label='Original ersetzen?']")
        pg.click(".sheet[aria-label='Original ersetzen?'] button:not(.pri)"); pg.wait_for_selector(".sheet[aria-label='Original ersetzen?']", state="detached")
        assert len(calls("videoTrim")) == 1, "ohne Bestätigung kein Auftrag"
        pg.click("#vt-go"); pg.wait_for_selector(".sheet[aria-label='Original ersetzen?']"); pg.click(".sheet[aria-label='Original ersetzen?'] button.pri")
        pg.wait_for_selector("#vj-txt"); assert calls("videoTrim")[-1]["replace"] is True and calls("videoTrim")[-1]["startMs"] == 4000
        leise(); pg.evaluate("r => __vjEnde(r)", {"ok": True, "src": vid, "id": vid, "w": 1920, "h": 1080, "dur": 6000, "startMs": 4000, "endMs": 10000, "replaced": True})
        assert "Original ist ersetzt" in toast_text(pg, "ersetzt")
        o = pg.evaluate("id => DB.get('photos', id)", vid); assert o["dur"] == 6000 and o["ts"] == t0 + 4000 and o["trimmed"], o
        # 5. Fehler, Abbrechen, belegt: Meldungen, Original unverändert
        oeffne(); pg.fill("#vt-at", "2"); pg.dispatch_event("#vt-at", "change"); pg.click("#vt-go"); pg.wait_for_selector("#vj-txt")
        leise(); pg.evaluate("__vjEnde(null, { error: 'Muxer lehnt das Tonformat ab' })")
        assert "nicht geklappt (Muxer lehnt das Tonformat ab). Das Original ist unverändert." in toast_text(pg, "nicht geklappt")
        oeffne(); pg.fill("#vt-at", "2"); pg.dispatch_event("#vt-at", "change"); pg.click("#vt-go"); pg.wait_for_selector("#vj-stop")
        pg.click("#vj-stop"); pg.wait_for_function("() => __vj.cancelAsked === true")
        leise(); pg.evaluate("__vjEnde(null, { cancelled: true })")
        assert "abgebrochen" in toast_text(pg, "abgebrochen")
        pg.evaluate("__vj.startOk = false")
        oeffne(); pg.fill("#vt-at", "2"); pg.dispatch_event("#vt-at", "change"); leise(); pg.click("#vt-go")
        assert "andere längere Arbeit" in toast_text(pg, "andere längere")
        pg.evaluate("__vj.startOk = true"); zu(pg); pg.evaluate("window.__lightbox && window.__lightbox.close()")
        assert pg.evaluate("id => DB.get('photos', id).then(p => p.dur)", vid) == 6000
        # 6. Vorhandene Videos in die Galerie: Zählung, Rückfrage, Fortschritt „1 von 2“, Ergebnis, neue Zählung
        pg.evaluate("async () => { await DB.put('photos', { id: 'g1b2c3d4e5f6a7b8c9dv', name: 'Video.mp4', ts: 1700000400000, video: true, dur: 3000, tour: '' }); }")
        go(pg, "#/settings", "#set-vgalcopy"); pg.wait_for_function("() => document.querySelector('#set-vgal-n').textContent === '2 Videos noch nicht in der Galerie'")
        pg.click("#set-vgalcopy"); pg.wait_for_selector(".sheet[aria-label='Videos in die Galerie kopieren?']")
        assert "2 Videos werden" in pg.inner_text(".sheet[aria-label='Videos in die Galerie kopieren?']") and "Movies/Tourentagebuch" in pg.inner_text(".sheet[aria-label='Videos in die Galerie kopieren?']")
        pg.click(".sheet[aria-label='Videos in die Galerie kopieren?'] button.pri"); pg.wait_for_selector("#vj-txt")
        it = calls("videoGalleryCopy")[-1]["items"]
        assert it == [{"id": "g1b2c3d4e5f6a7b8c9dv", "ts": 1700000400000}, {"id": "g2b2c3d4e5f6a7b8c9dv", "ts": 0}], it
        pg.wait_for_function("() => document.querySelector('#vj-txt').textContent === '1 von 2'")
        pg.evaluate("() => { __vj.job.done = 1; __vj.job.pct = 50; }"); pg.wait_for_function("() => document.querySelector('#vj-txt').textContent === '2 von 2'")
        leise(); pg.evaluate("() => { __vj.scan = { supported: true, all: 3, n: 0, ids: [] }; __vjEnde({ ok: 1, bad: 1, msg: 'Speicher voll', cancelled: false }); }")
        assert toast_text(pg, "Galerie kopiert") == "1 Video in die Galerie kopiert · 1 nicht möglich (Speicher voll)", pg.inner_text("#toast")
        pg.wait_for_function("() => document.querySelector('#set-vgal-n').textContent === 'Alle Videos sind schon in der Galerie.' && document.querySelector('#set-vgalcopy').disabled")
        pg.evaluate("__vj.scan = { supported: false, all: 3, n: 3, ids: [] }"); go(pg, "#/settings", "#set-vgalcopy")
        pg.wait_for_function("() => document.querySelector('#set-vgal-n').textContent === 'Erst ab Android 10 möglich.' && document.querySelector('#set-vgalcopy').disabled")
    finally:
        pg.evaluate("""async ids => { window.MTApp.call = window.__vjcall0; for (const id of ids) await DB.del('photos', id); window.__lightbox && window.__lightbox.close();
          document.querySelectorAll('.sheet-back').forEach(e => e.remove()); sheet.stack = []; }""", [vid, neu_id, "g1b2c3d4e5f6a7b8c9dv"])


def sicherung_2100(pg):
    """2.10.0: Sicherung der Fotos und Videos (Ordner wählen, Sichern mit Fortschritt und Abbrechen, Wiederherstellen aus mehreren ZIPs),
    eine Erinnerungszeile für Touren und Medien (erscheint, verschwindet, „Später“), Einstellungen (Schwelle, automatisch in Ordner) gespeichert."""
    leise = lambda: pg.wait_for_function(LEISE, timeout=30000)
    MB = 1048576; DAY = 86400000
    pg.evaluate(MD_MOCK)
    calls = lambda m: pg.evaluate("m => __md.calls.filter(c => c[0] === m).map(c => c[1])", m)
    try:
        # 1. Einstellungen: Hinweis angepasst, Stand der Medien, noch nie gesichert, noch kein Ordner
        go(pg, "#/settings", "#md-stand")
        pg.wait_for_function("() => document.querySelector('#md-stand').textContent.includes('noch nicht gesichert')")
        assert pg.inner_text("#md-stand") == "8 Dateien · 30 MB · 5 Dateien noch nicht gesichert (12 MB)", pg.inner_text("#md-stand")
        assert pg.inner_text("#md-last") == "Zuletzt gesichert: noch nie" and "noch keiner gewählt" in pg.inner_text("#md-ordner")
        assert "Fotos und Videos sichern" in pg.inner_text("#bk-media") and "nicht enthalten" in pg.inner_text("#bk-media")
        assert pg.inner_text("#md-h") == "Fotos und Videos sichern" and pg.inner_text("#md-save") == "Sichern" and pg.inner_text("#md-restore") == "Wiederherstellen"

        # 2. Sichern: ohne Ordner erst die Ordnerwahl, dann Rückfrage, dann Fortschritt; Abbrechen ruft mediaCancel
        pg.click("#md-save")
        pg.wait_for_selector(".sheet[aria-label='Fotos und Videos sichern?']")
        assert calls("mediaFolder")[-1] == {"pick": True}, calls("mediaFolder")
        t = pg.inner_text(".sheet[aria-label='Fotos und Videos sichern?']")
        assert "5 Dateien noch nicht gesichert (12 MB)" in t and "2 ZIP-Dateien" in t and "„Sicherung“" in t, t
        pg.click(".sheet[aria-label='Fotos und Videos sichern?'] button.btn.pri")
        pg.wait_for_selector("#md-txt")
        assert calls("mediaBackup") == [{"tree": "content://com.android.externalstorage.documents/tree/primary%3ASicherung"}], calls("mediaBackup")
        pg.evaluate("__md.job.done = __md.job.total / 4")
        pg.wait_for_function("() => document.querySelector('#md-txt').textContent === 'Teil 1 von 2 · 3,0 MB von 12 MB · 25 %'", timeout=10000)
        pg.wait_for_function("() => document.querySelector('#md-prog i').style.width === '25%'", timeout=10000)
        leise(); pg.click("#md-stop")
        assert "Abgebrochen. Es wurde nichts gespeichert." in toast_text(pg, "Abgebrochen")
        pg.wait_for_selector("#md-txt", state="detached")
        assert len(calls("mediaCancel")) == 1

        # 3. Zweiter Lauf: Ordner ist gemerkt (keine neue Wahl), fertig → Zusammenfassung, „Zuletzt gesichert“ heute, nichts mehr neu
        leise(); pg.click("#md-save")
        pg.wait_for_selector(".sheet[aria-label='Fotos und Videos sichern?']")
        assert len([c for c in calls("mediaFolder") if c.get("pick")]) == 1, "Ordner nur einmal gewählt"
        pg.click(".sheet[aria-label='Fotos und Videos sichern?'] button.btn.pri"); pg.wait_for_selector("#md-txt")
        pg.evaluate("() => { __md.status = Object.assign(__md.status, { neu: 0, neuBytes: 0, teile: 0, last: Date.now() }); __md.job = { running: false, kind: 'backup', result: { files: 5, bytes: 12 * 1048576, parts: 2, folder: 'Sicherung' } }; }")
        assert "Gesichert: 5 Dateien (12 MB) in 2 Teilen in „Sicherung“" in toast_text(pg, "Gesichert:")
        heute = pg.evaluate("new Date().toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })")
        pg.wait_for_function("h => document.querySelector('#md-last').textContent === 'Zuletzt gesichert: ' + h", arg=heute, timeout=10000)
        assert "Keine neuen Dateien seit der letzten Medien-Sicherung" in pg.inner_text("#md-stand") and pg.inner_text("#md-ordner") == "Ordner: Sicherung"
        leise(); pg.click("#md-save")
        assert "Alles gesichert" in toast_text(pg, "Alles gesichert"), "nichts Neues: keine Rückfrage"
        assert pg.locator(".sheet[aria-label='Fotos und Videos sichern?']").count() == 0

        # 4. Wiederherstellen: zwei ZIPs, Rückfrage mit Größe, Aufruf mit beiden Adressen, Fortschritt, Ergebnis
        leise(); pg.click("#md-restore")
        pg.wait_for_selector(".sheet[aria-label='Fotos und Videos wiederherstellen?']")
        t = pg.inner_text(".sheet[aria-label='Fotos und Videos wiederherstellen?']")
        assert "2 Dateien (1,5 GB)" in t and "bleiben unverändert" in t, t
        pg.click(".sheet[aria-label='Fotos und Videos wiederherstellen?'] button.btn.pri")
        pg.wait_for_selector(".sheet[aria-label='Fotos und Videos wiederherstellen'] #md-txt")
        assert calls("mediaRestore") == [{"uris": ["content://x/document/a", "content://x/document/b"]}], calls("mediaRestore")
        pg.evaluate("__md.job.done = 50")
        pg.wait_for_function("() => document.querySelector('#md-txt').textContent === 'Datei 1 von 2 · 50 %'", timeout=10000)
        pg.evaluate("() => { __md.job = { running: false, kind: 'restore', result: { restored: 3, existing: 1, rejected: 0, thumbs: 2 } }; }")
        assert "3 Dateien wiederhergestellt · 1 schon vorhanden · 2 Vorschaubilder neu erstellt" in toast_text(pg, "wiederhergestellt")
        pg.wait_for_selector("#md-txt", state="detached")
        # Auswahl abgebrochen: nichts passiert
        pg.evaluate("__md.zips = []"); n0 = len(calls("mediaRestore")); pg.click("#md-restore"); pg.wait_for_timeout(400)
        assert len(calls("mediaRestore")) == n0 and pg.locator(".sheet[aria-label='Fotos und Videos wiederherstellen?']").count() == 0

        # 5. Einstellungen: Schwelle gespeichert; „Automatisch in Ordner sichern“ schreibt sofort einmal (heute nicht noch einmal)
        pg.click("#bk-days button:has-text('7 Tage')")
        pg.wait_for_function("() => DB.kvGet('settings', {}).then(s => s.backupDays === 7)")
        pg.click("#bk-days button:has-text('14 Tage')")
        pg.wait_for_function("() => DB.kvGet('settings', {}).then(s => s.backupDays === 14)")
        pg.evaluate("DB.del('kv', 'autoBackupDay')")
        assert not pg.is_checked("#bk-auto input")
        leise(); pg.click("#bk-auto")
        pg.wait_for_function("() => __md.auto.length === 1", timeout=20000)
        a = pg.evaluate("__md.auto[0]")
        assert a["name"] == "Tourentagebuch-Auto-" + pg.evaluate("SicherungCalc.tagKey(Date.now())") + ".mtl" and a["keep"] == 5, {k: v for k, v in a.items() if k != "b64"}
        assert pg.evaluate("b => Backup.parse(Uint8Array.from(atob(b), c => c.charCodeAt(0))).app", a["b64"]) == "tourentagebuch"
        assert pg.evaluate("DB.kvGet('settings', {}).then(s => s.backupAuto === true)") and pg.evaluate("Set_.get('backupAuto')") is True
        pg.wait_for_function("() => DB.kvGet('lastBackup', 0).then(v => Date.now() - v < 30000)")
        assert pg.evaluate("Backup.auto()") is None and pg.evaluate("__md.auto.length") == 1, "höchstens einmal am Tag"
        pg.click("#bk-auto"); pg.wait_for_function("() => DB.kvGet('settings', {}).then(s => s.backupAuto === false)")
        # ohne Ordner und Ordnerwahl abgebrochen: Schalter bleibt aus
        pg.evaluate("() => { __md.folder = {}; __md.pickFolder = []; }")
        pg.click("#bk-auto"); pg.wait_for_timeout(500)
        assert not pg.is_checked("#bk-auto input") and pg.evaluate("Set_.get('backupAuto')") is False
        pg.evaluate("() => { __md.pickFolder = { tree: 'content://com.android.externalstorage.documents/tree/primary%3ASicherung', name: 'Sicherung', ok: true }; __md.folder = __md.pickFolder; }")

        # 6. Erinnerungszeile auf der Startseite: Medien fällig → eine Zeile mit „Jetzt sichern“ für Medien; „Später“ → Ruhe; unter der Schwelle / nichts Neues → keine
        def start(): pg.evaluate("() => { if (location.hash === '#/start') Nav.render(); else location.hash = '#/start'; }"); pg.wait_for_selector("#hero"); pg.wait_for_timeout(400)
        pg.evaluate("async ([d]) => { await DB.kvSet('lastBackup', Date.now()); await DB.kvSet('backupSnooze', 0); await Set_.set('backupDays', 14); __md.status = Object.assign(__md.status, { neu: 5, neuBytes: 12 * 1048576, teile: 1, last: Date.now() - 20 * d }); }", [DAY])
        start(); pg.wait_for_selector("#backupnote")
        t = pg.inner_text("#backupnote")
        assert "Fotos und Videos: letzte Sicherung vor 20 Tagen" in t and "5 neue Dateien seit der letzten Medien-Sicherung (12 MB)" in t, t
        assert pg.get_attribute("#bk-now", "data-art") == "medien" and pg.locator("#backupnote").count() == 1
        pg.click("#bk-now"); pg.wait_for_selector(".sheet[aria-label='Fotos und Videos sichern?']")
        pg.evaluate("window.mtBack()"); pg.wait_for_selector(".sheet[aria-label='Fotos und Videos sichern?']", state="detached")
        leise(); pg.click("#bk-later"); pg.wait_for_selector("#backupnote", state="detached")
        start(); assert pg.locator("#backupnote").count() == 0, "nach „Später“ Ruhe"
        pg.evaluate("DB.kvSet('backupSnooze', 0)")
        pg.evaluate("d => { __md.status.last = Date.now() - 5 * d; }", DAY); start(); assert pg.locator("#backupnote").count() == 0, "Medien unter der Schwelle"
        pg.evaluate("d => { __md.status.last = null; __md.status.neu = 0; }", DAY); start(); assert pg.locator("#backupnote").count() == 0, "nichts Neues zu sichern"
        # beide fällig: nur eine Zeile, die ältere (Touren 30 Tage, Medien 20 Tage)
        pg.evaluate("async ([d]) => { await DB.kvSet('lastBackup', Date.now() - 30 * d); __md.status = Object.assign(__md.status, { neu: 2, neuBytes: 1048576, last: Date.now() - 20 * d }); }", [DAY])
        start(); pg.wait_for_selector("#backupnote")
        assert "Letzte Sicherung vor 30 Tagen" in pg.inner_text("#backupnote") and pg.get_attribute("#bk-now", "data-art") == "touren" and pg.locator("#backupnote").count() == 1
        pg.evaluate("async ([d]) => { await DB.kvSet('lastBackup', Date.now() - 15 * d); }", [DAY])
        start(); pg.wait_for_selector("#backupnote"); assert pg.get_attribute("#bk-now", "data-art") == "medien", "Medien älter"
        pg.evaluate("Set_.set('backupDays', 0)"); start(); assert pg.locator("#backupnote").count() == 0, "Erinnerung aus"
    finally:
        pg.evaluate("async () => { window.MTApp.call = window.__mdcall0; await Set_.set('backupDays', 14); await Set_.set('backupAuto', false); await DB.kvSet('lastBackup', Date.now()); await DB.kvSet('backupSnooze', 0); await DB.del('kv', 'autoBackupDay'); document.querySelectorAll('.sheet-back').forEach(e => e.remove()); }")


OFF_MOCK = """() => {
  /* 2.11.0: Offline-Karten der Hülle nachgestellt: tilesList / tilesStart / tilesJob / tilesCancel / tilesDelete */
  const c0 = window.MTApp.call; window.__offcall0 = c0;
  window.__off = { calls: [], areas: [], bytes: 0, job: { running: false }, startRes: null };
  window.MTApp.call = (id, m, a) => {
    if (!/^tiles/.test(m)) return c0.call(window.MTApp, id, m, a);
    const D = window.__off, o = JSON.parse(a || '{}'); D.calls.push([m, o]); let r;
    if (m === 'tilesList') r = { areas: D.areas, bytes: D.bytes, max: 400 * 1048576, maxTiles: 2000, running: !!D.job.running, wifi: true };
    else if (m === 'tilesStart') {
      if (D.startRes) r = D.startRes;
      else {
        const n = o.refresh ? (D.areas.find(x => x.id === o.refresh) || {}).tiles : o.kind === 'route' ? OfflineCalc.korridor(o.pts, o.rand, 10, o.zmax).anzahl
          : OfflineCalc.zaehleRechteck({ s: o.bbox[0], w: o.bbox[1], n: o.bbox[2], e: o.bbox[3] }, 10, o.zmax);
        D.job = { running: true, id: o.refresh || 'a1', name: o.name || '', total: n, done: 0, loaded: 0, skipped: 0, failed: 0 }; r = { started: true, id: D.job.id };
      }
    }
    else if (m === 'tilesJob') r = D.job;
    else if (m === 'tilesCancel') { D.job = Object.assign({}, D.job, { running: false, cancelled: true }); r = true; }
    else if (m === 'tilesDelete') { D.areas = D.areas.filter(x => x.id !== o.id); D.bytes = 0; r = { deleted: 10, bytes: 1 }; }
    setTimeout(() => window.__mtcb(+id, true, JSON.stringify(r)), 5);
  };
}"""

def offline_2110(pg):
    """2.11.0: Offline-Karten – Schätzung (Kacheln, MB, Grenze), Detailstufen, Ausschnitt um eine Tour, Bestätigung, Start/Fortschritt/Abbruch,
    Liste mit Aktualisieren und Löschen, Einstellungen gespeichert, Hinweis in der Aufnahme ohne Netz, Wanderkarte ohne Netz, Karte im PDF aus Offline-Kacheln."""
    leise = lambda: pg.wait_for_function(LEISE, timeout=30000)
    pg.evaluate(OFF_MOCK)
    calls = lambda m: pg.evaluate("m => __off.calls.filter(c => c[0] === m).map(c => c[1])", m)
    sh = ".sheet[aria-label='Offline-Karte laden?']"
    est = lambda: pg.inner_text("#off-est")
    try:
        # 1. Erreichbar über Mehr, Einstellungen und den Kartenreiter (sichtbarer Ausschnitt wird übernommen)
        go(pg, "#/mehr", "#m-offline"); assert pg.get_attribute("#m-offline", "href") == "#/offline"
        go(pg, "#/settings", "#set-offline"); assert "Offline-Karten sind auch nicht enthalten" in pg.inner_text("#bk-media")
        go(pg, "#/map", "#tooffline")
        pg.evaluate("document.querySelector('.map.full').__karte.map.setView([47.45, 11.08], 13, { animate: false })"); pg.wait_for_timeout(200)
        vb = pg.evaluate("(() => { const b = document.querySelector('.map.full').__karte.map.getBounds(); return [b.getSouth(), b.getNorth()]; })()")
        pg.click("#tooffline"); pg.wait_for_function("location.hash === '#/offline'"); pg.wait_for_selector("#off-est"); pg.wait_for_selector("#off-leer")
        ob = pg.evaluate("(() => { const b = document.querySelector('#off-map').__karte.getBounds(); return [b.getSouth(), b.getNorth()]; })()")
        assert ob[0] <= vb[0] + 0.01 and ob[1] >= vb[1] - 0.01, (vb, ob)
        assert pg.inner_text("#off-belegt") == "Belegt: 0 MB von 400 MB" and "Noch keine Offline-Karte" in pg.inner_text("#off-liste")
        assert "Wanderkarte" in pg.inner_text(".offline > p.muted") and "nicht offline gespeichert" in pg.inner_text("#off-quelle") and "Sicherung (.mtl)" in pg.inner_text("#off-quelle")
        assert pg.is_checked("#off-wifi input") and pg.is_checked("#off-merken input") and pg.locator("#off-tourbox").is_hidden()

        # 2. Schätzung für den sichtbaren Ausschnitt, Detailstufen (gespeichert), Grenze → Knopf aus
        erwartet = "() => { const m = document.querySelector('#off-map').__karte, b = m.getBounds(); return OfflineCalc.umfang('topo', OfflineCalc.zaehleRechteck({ s: b.getSouth(), w: b.getWest(), n: b.getNorth(), e: b.getEast() }, 10, OfflineCalc.zmaxVon(Set_.get('offlineStufe')))); }"
        pg.wait_for_function("e => document.querySelector('#off-est').textContent === (new Function('return ' + e))()()", arg=erwartet, timeout=10000)
        assert est().startswith("≈ ") and " Kacheln, ≈ " in est() and est().endswith("MB") and not pg.is_disabled("#off-start"), est()
        n_normal = int(est().split()[1].replace(".", ""))
        pg.click("#off-stufe button:has-text('Grob (bis 13)')"); pg.wait_for_function("() => DB.kvGet('settings', {}).then(s => s.offlineStufe === 'grob')")
        assert int(est().split()[1].replace(".", "")) < n_normal, est()
        pg.click("#off-stufe button:has-text('Fein (bis 16)')"); pg.wait_for_function("() => Set_.get('offlineStufe') === 'fein'")
        pg.evaluate("document.querySelector('#off-map').__karte.setZoom(10, { animate: false })")
        pg.wait_for_function("() => document.querySelector('#off-est').textContent.includes('Zu groß')", timeout=10000)
        assert pg.is_disabled("#off-start") and "höchstens 2.000 Kacheln" in est() and pg.locator("#off-est.warn").count() == 1, est()
        pg.click("#off-stufe button:has-text('Normal (bis 15)')"); pg.evaluate("document.querySelector('#off-map').__karte.setView([47.45, 11.08], 13, { animate: false })")
        pg.wait_for_function("() => !document.querySelector('#off-start').disabled", timeout=10000)

        # 3. Ausschnitt um eine Tour: Strecke mit 2 km Rand, Name der Tour, Bestätigung mit Umfang, Start, Fortschritt, Abbrechen
        pg.click("#off-art button:has-text('Um eine Tour')"); pg.wait_for_selector("#off-tourbox:not([hidden])")
        assert "Bitte eine Tour wählen" in est() and pg.is_disabled("#off-start")
        tid = pg.evaluate("Tours.list().then(l => l.find(t => t.name === 'Hüttenrunde').id)")
        pg.select_option("#off-tour", tid)
        pg.wait_for_function("() => document.querySelector('#off-est').textContent.startsWith('≈')", timeout=10000)
        nk = pg.evaluate("async id => { const p = Geo.simplify(await Tours.points(id), 20).map(q => [+q.lat.toFixed(6), +q.lon.toFixed(6)]); return OfflineCalc.korridor(p, 2000, 10, 15).anzahl; }", tid)
        assert est() == pg.evaluate("n => OfflineCalc.umfang('topo', n)", nk) and pg.input_value("#off-name") == "Hüttenrunde", (est(), nk)
        pg.click("#off-start"); pg.wait_for_selector(sh)
        t = pg.inner_text(sh); assert pg.evaluate("n => OfflineCalc.umfang('topo', n)", nk) in t and "Wanderkarte (OpenTopoMap), Zoom 10–15" in t and "Nur über WLAN" in t, t
        pg.click(sh + " button.btn.pri"); pg.wait_for_selector("#off-txt")
        st = calls("tilesStart")[-1]
        assert st["src"] == "topo" and st["kind"] == "route" and st["zmax"] == 15 and st["rand"] == 2000 and st["wifiOnly"] is True and st["name"] == "Hüttenrunde" and len(st["pts"]) >= 2, {k: v for k, v in st.items() if k != "pts"}
        pg.evaluate("n => { __off.job.done = Math.round(n / 4); }", nk)
        pg.wait_for_function("t => document.querySelector('#off-txt').textContent === t", arg=pg.evaluate("n => OfflineCalc.tausend(Math.round(n / 4)) + ' von ' + OfflineCalc.tausend(n) + ' Kacheln'", nk), timeout=10000)
        pg.wait_for_function("() => parseInt(document.querySelector('#off-prog i').style.width) >= 24", timeout=10000)
        leise(); pg.click("#off-stop")
        assert "Abgebrochen. Bereits geladene Kacheln bleiben" in toast_text(pg, "Abgebrochen"); pg.wait_for_selector("#off-txt", state="detached")
        assert len(calls("tilesCancel")) == 1

        # 4. Sichtbarer Ausschnitt laden bis zum Ende: Zusammenfassung, Liste mit Name, Größe, Datum; „Belegt“
        pg.click("#off-art button:has-text('Kartenausschnitt')"); pg.wait_for_selector("#off-tourbox[hidden]", state="attached")
        pg.fill("#off-name", "Karwendel"); leise(); pg.click("#off-start"); pg.wait_for_selector(sh); pg.click(sh + " button.btn.pri"); pg.wait_for_selector("#off-txt")
        st = calls("tilesStart")[-1]; assert st["kind"] == "rect" and len(st["bbox"]) == 4 and st["name"] == "Karwendel" and st["zmax"] == 15, st
        pg.evaluate("""() => { const j = __off.job; __off.areas = [{ id: 'a1', name: 'Karwendel', src: 'topo', kind: 'rect', zmin: 10, zmax: 15, tiles: j.total, have: j.total, bytes: 7 * 1048576, date: Date.now(), complete: true,
          bbox: [47.40, 11.00, 47.50, 11.15], cover: OfflineCalc.abdeckung(OfflineCalc.rechteck({ s: 47.40, w: 11.00, n: 47.50, e: 11.15 }, 12, 12)) }]; __off.bytes = 7 * 1048576;
          __off.job = { running: false, name: 'Karwendel', total: j.total, loaded: j.total - 5, skipped: 5, failed: 0 }; }""")
        assert "Offline-Karte „Karwendel“:" in toast_text(pg, "Karwendel") and "(5 waren schon da)" in pg.inner_text("#toast")
        pg.wait_for_selector("#off-liste .offli[data-id=a1]")
        row = pg.inner_text("#off-liste .offli[data-id=a1]")
        heute = pg.evaluate("new Date().toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })")
        assert "Karwendel" in row and "Wanderkarte · Zoom 10–15" in row and "7,0 MB" in row and heute in row and "Unvollständig" not in row, row
        assert pg.inner_text("#off-belegt") == "Belegt: 7,0 MB von 400 MB"
        assert pg.evaluate("JSON.parse(localStorage.getItem('offlineAreas'))[0].id") == "a1", "Liste für ohne Netz gemerkt"

        # 5. Aktualisieren (Rückfrage, nur die Kennung), Start abgelehnt (Meldung der Hülle), Löschen
        leise(); pg.click("#off-liste .off-upd"); pg.wait_for_selector(".sheet[aria-label='„Karwendel“ aktualisieren?']")
        assert "älter als eine Woche" in pg.inner_text(".sheet[aria-label='„Karwendel“ aktualisieren?']")
        pg.click(".sheet[aria-label='„Karwendel“ aktualisieren?'] button.btn.pri"); pg.wait_for_selector("#off-txt")
        assert calls("tilesStart")[-1] == {"refresh": "a1", "wifiOnly": True}, calls("tilesStart")[-1]
        pg.evaluate("() => { __off.job = { running: false, name: 'Karwendel', total: 10, loaded: 2, skipped: 8, failed: 0 }; }"); toast_text(pg, "Karwendel")
        pg.evaluate("__off.startRes = { started: false, error: 'Kein WLAN. Bitte mit einem WLAN verbinden oder „Nur über WLAN“ ausschalten.' }")
        leise(); pg.click("#off-start"); pg.wait_for_selector(sh); pg.click(sh + " button.btn.pri")
        assert "Kein WLAN" in toast_text(pg, "Kein WLAN") and pg.locator("#off-txt").count() == 0
        pg.evaluate("__off.startRes = null")
        leise(); pg.click("#off-liste .off-del"); pg.wait_for_selector(".sheet[aria-label='Offline-Karte löschen?']")
        assert "andere Offline-Karte" in pg.inner_text(".sheet[aria-label='Offline-Karte löschen?']")
        pg.click(".sheet[aria-label='Offline-Karte löschen?'] button.btn.pri")
        assert "gelöscht" in toast_text(pg, "gelöscht"); pg.wait_for_selector("#off-leer")
        assert calls("tilesDelete") == [{"id": "a1"}]

        # 6. Einstellungen: nur über WLAN aus → beim Start mitgegeben; gesehene Kacheln merken aus; Leeren
        pg.click("#off-wifi"); pg.wait_for_function("() => DB.kvGet('settings', {}).then(s => s.offlineWifi === false)")
        leise(); pg.click("#off-start"); pg.wait_for_selector(sh); assert "Auch über mobile Daten" in pg.inner_text(sh); pg.click(sh + " button.btn.pri"); pg.wait_for_selector("#off-txt")
        assert calls("tilesStart")[-1]["wifiOnly"] is False
        pg.evaluate("() => { __off.job = { running: false, cancelled: true }; }"); pg.wait_for_selector("#off-txt", state="detached")
        pg.click("#off-merken"); pg.wait_for_function("() => DB.kvGet('settings', {}).then(s => s.tileMerken === false)"); assert pg.evaluate("MapKit.merken()") is False
        leise(); pg.click("#off-leeren"); assert "gelöscht" in toast_text(pg, "Gemerkte Kacheln gelöscht")
        pg.wait_for_function("() => document.querySelector('#off-merk-n').textContent.startsWith('0 Kacheln gemerkt')")

        # 7. Gemerkte Kacheln: höchstens MERKEN_MAX, die ältesten fallen heraus
        weg = pg.evaluate("""async () => { const c = await caches.open(MapKit.cacheName); for (let i = 0; i < 12; i++) await c.put('https://tile.opentopomap.org/1/0/' + i + '.png', new Response('x'));
          const n = await MapKit.kuerzen(5), k = (await c.keys()).map(r => r.url); await MapKit.clearCache(); return [n, k.length, k[0]]; }""")
        assert weg[0] == 7 and weg[1] == 5 and weg[2].endswith("/1/0/7.png"), weg

        # 8. Ohne Netz: Wanderkarte statt Straßenkarte (nur mit Offline-Karte); Hinweis in der Aufnahme nur ohne passende Offline-Karte
        pg.evaluate("() => { Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => window.__netz !== false }); window.__netz = false; Offline.gebiete = []; }")
        assert "openstreetmap" in pg.evaluate("MapKit.layer()._url"), "ohne Offline-Karte bleibt die gewählte Karte"
        pg.evaluate("() => { Offline.gebiete = [{ id: 'b', src: 'topo', have: 5, cover: OfflineCalc.abdeckung(OfflineCalc.rechteck({ s: 47.49, w: 11.19, n: 47.51, e: 11.21 }, 12, 12)) }]; }")
        assert "opentopomap" in pg.evaluate("MapKit.layer()._url"), "ohne Netz die Wanderkarte"
        pg.evaluate("() => { Offline.gebiete = []; }")
        go(pg, "#/rec", ".bigstart"); pg.click(".bigstart"); pg.wait_for_selector(".bigtime")
        pg.wait_for_selector("#rec-offline:not([hidden])", timeout=10000)
        assert pg.inner_text("#rec-offline") == "Keine Karte offline – Aufnahme läuft trotzdem"
        pg.evaluate("() => { Offline.gebiete = [{ id: 'b', src: 'topo', have: 5, cover: OfflineCalc.abdeckung(OfflineCalc.rechteck({ s: 47.49, w: 11.19, n: 47.51, e: 11.21 }, 12, 12)) }]; }")
        go(pg, "#/rec", ".bigtime"); pg.wait_for_timeout(1500); assert pg.locator("#rec-offline").is_hidden(), "Offline-Karte deckt den Ort ab"
        pg.evaluate("() => { window.__netz = true; Offline.gebiete = []; }"); go(pg, "#/rec", ".bigtime"); pg.wait_for_timeout(1500)
        assert pg.locator("#rec-offline").is_hidden(), "mit Netz kein Hinweis"
        pg.evaluate("() => { window.__rec.state = 'idle'; window.__rec.unsent = false; }"); go(pg, "#/start", "#hero")

        # 9. Karte im PDF: liegt der Ausschnitt ganz in der Offline-Karte, kommen die Kacheln aus dem Speicher (/tiles/topo/…), mit deren Quellenangabe
        png = kachel_png(); lok = []; osm = []
        def lokal(r): lok.append(r.request.url); r.fulfill(status=200, body=png, content_type="image/png")
        def netz(r): osm.append(r.request.url); r.fulfill(status=200, body=png, content_type="image/png", headers={"access-control-allow-origin": "*"})
        pg.route("**/tiles/topo/**", lokal); pg.route("**/tile.openstreetmap.org/**", netz)
        pdf = "async () => { const t = (await Tours.list()).find(x => x.name === 'Hüttenrunde'), r = await PdfUI.kartenBild(await Tours.points(t.id), 1060, 600, { stop: () => false }); return r ? { q: r.plan.quelle, off: !!r.plan.offline, n: r.plan.kacheln.length } : null; }"
        pg.evaluate("() => { Offline.gebiete = [{ id: 'b', src: 'topo', have: 5 }]; }")
        r = pg.evaluate(pdf)
        assert r and r["off"] and "OpenTopoMap" in r["q"] and len(lok) == r["n"] and not osm, (r, len(lok), osm[:2])
        pg.unroute("**/tiles/topo/**", lokal); lok.clear()
        pg.evaluate("MapKit.clearCache()")      # Vorschaubilder der Touren haben Kacheln gemerkt; die nähme das PDF sonst zuerst
        r = pg.evaluate(pdf)
        assert r and not r["off"] and r["q"] == "© OpenStreetMap-Mitwirkende" and len(osm) == r["n"], (r, len(osm))
        pg.unroute("**/tile.openstreetmap.org/**", netz)
    finally:
        pg.evaluate("""async () => { window.MTApp.call = window.__offcall0; delete navigator.onLine; window.__netz = true; Offline.gebiete = null; try { localStorage.removeItem('offlineAreas'); } catch (e) {}
          await Set_.set('offlineWifi', true); await Set_.set('tileMerken', true); await Set_.set('offlineStufe', 'normal'); window.__rec.state = 'idle'; window.__rec.unsent = false;
          try { sessionStorage.removeItem('offArt'); } catch (e) {} document.querySelectorAll('.sheet-back').forEach(e => e.remove()); sheet.stack = []; }""")


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
    pg.click("#goaladd"); pg.wait_for_selector("#goalsave"); pg.select_option("#goalsport", "mountaineering"); pg.click("#goalmetric .chip:has-text('Aufstieg')"); pg.fill("#goalval", "12000"); pg.click("#goalsave"); pg.wait_for_selector(".sheet", state="detached")
    assert "Aufstieg · Bergsteigen" in pg.inner_text("#goals") and "/ 12.000 m" in pg.inner_text("#goals")      # 2.19.0: feste Gruppen nur noch für alte Ziele; Bergsteigen wählbar
    pg.click("#goaladd"); pg.wait_for_selector("#goalsave"); pg.select_option("#goalsport", "mountaineering"); pg.click("#goalmetric .chip:has-text('Aufstieg')"); pg.fill("#goalval", "15000"); pg.click("#goalsave"); pg.wait_for_selector(".sheet", state="detached")
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
    assert u["sp"] == ["hike", "bike", "ebike", "emtb", "mtb", "racebike", "run", "skialpin", "skitour", "snowshoe", "nordic", "nordicwalking", "mountaineering", "other", "kitesurf", "other"], u["sp"]      # 2.19.0: Kitesurfen ist eine Aktivität
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
    assert {t["sport"]: st[t["id"]]["sport"] for t in srv if st[t["id"]]} == {"hike": "hike", "touringbicycle": "bike", "e_touringbicycle": "ebike", "mtb": "mtb", "e_mtb": "emtb", "racebike": "racebike", "jogging": "run",
        "skialpin": "skialpin", "skitour": "skitour", "snowshoe": "snowshoe", "nordic": "nordic", "nordicwalking": "nordicwalking", "mountaineering": "mountaineering", "other": "other"}      # 2.19.0: Schneeschuh, E-MTB, Nordic Walking eigene Sportarten
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

def halten(pg, sel, ms):
    """Finger (Maus) auf die Mitte von sel legen, ms halten, loslassen."""
    bb = pg.locator(sel).bounding_box(); pg.mouse.move(bb["x"] + bb["width"] / 2, bb["y"] + bb["height"] / 2); pg.mouse.down(); pg.wait_for_timeout(ms); pg.mouse.up()

def schieben(pg, anteil, sel="#rstopknob", leiste="#rstop"):
    """Griff um anteil (0…1) des möglichen Wegs nach rechts ziehen (in Schritten, wie ein Finger) und loslassen."""
    pg.evaluate("document.querySelector('#view').scrollTop = 1e6"); pg.wait_for_timeout(100)      # ganz nach unten: die Leiste liegt sonst unter der unteren Leiste
    k = pg.locator(sel).bounding_box(); t = pg.locator(leiste).bounding_box()
    weg = (t["width"] - k["width"] - 2 * (k["x"] - t["x"])) * anteil + (12 if anteil >= 1 else 0)
    x, y = k["x"] + k["width"] / 2, k["y"] + k["height"] / 2
    pg.mouse.move(x, y); pg.mouse.down()
    for i in range(1, 13): pg.mouse.move(x + weg * i / 12, y + (i % 3) - 1); pg.wait_for_timeout(16)
    pg.mouse.up()

def aufnahme_270(pg):
    """2.7.0: Beenden durch Schieben (zu kurz → zurück, Tastatur → Rückfrage), Pause nur durch Halten, Abstieg, gemerkte Route nach Neustart."""
    t0 = 1760000000000
    pg.evaluate("window.__rec.state = 'idle'; window.__rec.unsent = false; window.__routeName = ''; DB.kvSet('recRoute', null)")
    go(pg, "#/rec", ".bigstart"); pg.click(".bigstart"); pg.wait_for_selector(".bigtime")
    # Abstieg neben dem Aufstieg (Werte der Hülle: up_m / down_m)
    pg.evaluate("Object.assign(window.__rec, { up_m: 412, down_m: 287, alt_m: 1650 })")
    pg.wait_for_function("document.querySelector('.rec .kpis.big') && document.querySelector('.rec .kpis.big').innerText.includes('287')", timeout=5000)
    k = [x.replace("\n", " ").strip() for x in pg.locator(".rec .kpis.big .kpi").all_inner_texts()]
    assert any("↑" in x and "412" in x and "Aufstieg" in x for x in k) and any("↓" in x and "287" in x and "Abstieg" in x for x in k), k
    tops = pg.evaluate("[...document.querySelectorAll('.rec .kpis.big .kpi')].map(e => Math.round(e.getBoundingClientRect().top))")
    assert tops[2] == tops[3], ("Aufstieg und Abstieg nebeneinander", tops)
    # Pause: Tippen (auch mehrfach, wie in der Hosentasche) tut nichts, Halten pausiert (Balken, Ruckeln), ein Tipp setzt fort
    pg.locator("#rpause").scroll_into_view_if_needed()
    for _ in range(5): pg.locator("#rpause").click(delay=40)
    pg.wait_for_timeout(500); assert pg.evaluate("__rec.state") == "recording", "Antippen darf nicht pausieren"
    bb = pg.locator("#rpause").bounding_box(); pg.mouse.move(bb["x"] + bb["width"] / 2, bb["y"] + bb["height"] / 2); pg.mouse.down()
    pg.wait_for_function("+getComputedStyle(document.querySelector('#rpause')).getPropertyValue('--hold') > 0.05", timeout=3000)      # Balken füllt sich sichtbar
    pg.wait_for_function("__rec.state === 'paused'", timeout=5000); pg.mouse.up()
    assert pg.evaluate("window.__haptic || 0") >= 1, "beim Pausieren kurz ruckeln"
    pg.wait_for_function("document.querySelector('#rpause').innerText.includes('Weiter')")
    pg.locator("#rpause").click(); pg.wait_for_function("__rec.state === 'recording'", timeout=5000)
    pg.wait_for_function("document.querySelector('#rpause').innerText.includes('Pause')")
    # Losgelassen vor der Zeit: nichts
    halten(pg, "#rpause", 150); pg.wait_for_timeout(700); assert pg.evaluate("__rec.state") == "recording", "zu kurz gehalten"
    # Tastatur: Enter öffnet eine Rückfrage
    pg.focus("#rpause"); pg.keyboard.press("Enter"); pg.wait_for_selector(".sheet[aria-label='Aufzeichnung pausieren?']")
    pg.get_by_role("button", name="Pausieren", exact=True).click(); pg.wait_for_function("__rec.state === 'paused'", timeout=5000)
    pg.wait_for_selector(".sheet", state="detached"); pg.wait_for_function("document.querySelector('#rpause').innerText.includes('Weiter')")
    pg.focus("#rpause"); pg.keyboard.press("Enter"); pg.wait_for_function("__rec.state === 'recording'", timeout=5000)
    # Schieben: zu kurz → federt zurück, nichts passiert
    schieben(pg, 0.4); pg.wait_for_function("document.querySelector('#rstopknob').style.transform === 'translateX(0px)'", timeout=3000)
    pg.wait_for_timeout(300); assert pg.evaluate("__rec.state") == "recording", "zu kurzes Schieben"
    # Antippen des Griffs (ohne Schieben) beendet nicht
    pg.locator("#rstopknob").click(); pg.wait_for_timeout(400); assert pg.evaluate("__rec.state") == "recording" and pg.locator(".sheet").count() == 0
    # Tastatur: Enter → Rückfrage; Abbrechen lässt laufen, Beenden speichert wie bisher
    pg.focus("#rstopknob"); pg.keyboard.press("Enter"); pg.wait_for_selector(".sheet[aria-label='Aufzeichnung beenden?']")
    pg.get_by_role("button", name="Abbrechen", exact=True).click(); pg.wait_for_selector(".sheet", state="detached"); assert pg.evaluate("__rec.state") == "recording"
    pg.evaluate("g => { window.__gpx = g }", gpx(t0, n=30, lat=46.7, name=""))
    pg.focus("#rstopknob"); pg.keyboard.press("Enter"); pg.wait_for_selector(".sheet[aria-label='Aufzeichnung beenden?']")
    pg.get_by_role("button", name="Beenden", exact=True).click()
    pg.wait_for_function("location.hash.startsWith('#/tour/')", timeout=8000); rec1 = pg.evaluate("location.hash.split('/')[2]")
    assert "Abstieg" in pg.inner_text(".tourp .facts"), "Abstieg auf der Tourseite"

    # Gemerkte Route: wählen, App neu starten (die Hülle hat die Route verloren), Aufnahme öffnen → Route wieder da und auf der Karte
    plan = pg.evaluate("""async () => { const pts = Array.from({ length: 40 }, (_, i) => ({ lat: 47.30 + i * 0.0006, lon: 11.40 + i * 0.0005, ele: 900 + i * 4 }));
      return (await Tours.add({ name: 'Nachgehen R', sport: 'hike', pts, src: 'plan', status: 'planned', force: true })).tour.id; }""")
    go(pg, "#/rec", "select[aria-label='Geplante Tour als Route']")
    pg.select_option("select[aria-label='Geplante Tour als Route']", plan); pg.wait_for_selector("#rroutesel")
    assert pg.evaluate("id => DB.kvGet('recRoute', null).then(r => !!r && r.id === id && r.kind === 'tour')", plan)
    pg.evaluate("location.hash = '#/start'"); pg.wait_for_selector("#startrec")
    pg.reload(); pg.wait_for_selector("#tabs a")
    assert pg.evaluate("RecRoute.native()") is None, "nach dem Neustart hat die (nachgestellte) Hülle keine Route"
    go(pg, "#/rec", ".bigstart"); pg.wait_for_selector("#rroutesel"); assert "Nachgehen R" in pg.inner_text("#rroutesel")
    assert pg.evaluate("__calls.some(c => c[0] === 'route' && c[1] === 'Nachgehen R')"), "Route wieder an die Hülle gegeben"
    pg.click(".bigstart"); pg.wait_for_selector(".bigtime"); pg.wait_for_selector("#rroute:not([hidden])")
    assert "Nachgehen R" in pg.inner_text("#rroute") and int(pg.get_attribute(".rmap", "data-route") or 0) > 1, "Route auf der Aufnahmekarte"
    # Neustart MITTEN in der Aufzeichnung, Route in der Hülle weg: wird wieder geladen und gezeichnet
    pg.reload(); pg.wait_for_selector("#tabs a")
    pg.evaluate("DB.kvGet('recRoute', null).then(r => Object.assign(window.__rec, { state: 'recording', start: r.ts + 5000, count: 9, dist_m: 900, active_s: 3600, lat: 47.3, lon: 11.4, fix_age_s: 1, fix_acc_m: 4 }))")
    go(pg, "#/rec", ".bigtime"); pg.wait_for_selector("#rroute:not([hidden])"); assert int(pg.get_attribute(".rmap", "data-route") or 0) > 1
    # Volkers Fall: Route wählen, während noch eine (alte) Aufzeichnung läuft; deren Beenden löscht die Route in der Hülle – die Auswahl bleibt trotzdem
    pg.evaluate("DB.kvSet('recRoute', null); window.__routeName = ''; window.__rec.start = Date.now() - 600000")      # die alte Aufzeichnung lief schon vor der Auswahl
    pg.evaluate("id => { location.hash = '#/tour/' + id }", plan); pg.locator(".banner button", has_text="Mit Ansagen starten").click()
    pg.wait_for_function("location.hash === '#/rec'"); pg.wait_for_selector("#rroute:not([hidden])"); assert "Nachgehen R" in pg.inner_text("#rroute")
    pg.evaluate("g => { window.__gpx = g }", gpx(t0 + 86400000 * 3, n=30, lat=46.8, name=""))
    schieben(pg, 1.0); pg.wait_for_function("location.hash.startsWith('#/tour/')", timeout=8000); rec2 = pg.evaluate("location.hash.split('/')[2]")
    assert pg.evaluate("RecRoute.native()") is None, "die Hülle hat die Route beim Beenden gelöscht (wie Navi.clear)"
    go(pg, "#/rec", ".bigstart"); pg.wait_for_selector("#rroutesel"); assert "Nachgehen R" in pg.inner_text("#rroutesel"), "Route für die nächste Aufzeichnung wieder da"
    # Mit dieser Route aufgezeichnet und gespeichert: danach gilt sie als erledigt
    pg.click(".bigstart"); pg.wait_for_selector(".bigtime"); pg.evaluate("g => { window.__gpx = g }", gpx(t0 + 86400000 * 4, n=30, lat=46.9, name=""))
    schieben(pg, 1.0); pg.wait_for_function("location.hash.startsWith('#/tour/')", timeout=8000); rec3 = pg.evaluate("location.hash.split('/')[2]")
    assert pg.evaluate("DB.kvGet('recRoute', null)") is None, "nach der Tour mit der Route ist die Auswahl erledigt"
    # Gewählte Tour inzwischen gelöscht: deutlicher Hinweis statt stillem Verschwinden
    pg.evaluate("id => DB.kvSet('recRoute', { kind: 'tour', id, name: 'Nachgehen R', ts: Date.now() })", plan); pg.evaluate("id => Tours.remove(id)", plan)
    go(pg, "#/start", "#startrec"); pg.reload(); pg.wait_for_selector("#tabs a")
    go(pg, "#/rec", ".bigstart"); pg.wait_for_selector("#rroutegone"); assert "Nachgehen R" in pg.inner_text("#rroutegone") and "nicht mehr" in pg.inner_text("#rroutegone")
    pg.click("#rroutegone-ok"); pg.wait_for_selector("#rroutegone", state="detached"); assert pg.evaluate("DB.kvGet('recRoute', null)") is None
    # Aufräumen
    pg.evaluate("async ids => { for (const id of ids) await Tours.remove(id); window.__rec.state = 'idle'; window.__rec.unsent = false; window.__routeName = ''; }", [rec1, rec2, rec3])

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
    assert got["snowshoe"] == ["snowshoe", ["Schneeschuh"]] and got["skitour"] == ["skitour", []] and got["skialpin"] == ["skialpin", []] and got["nordic"] == ["nordic", []] and got["skiing"] == ["ski", []] and got["Snowshoe"] == ["snowshoe", ["Schneeschuh"]], got      # 2.19.0: Schneeschuh eigene Sportart
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
    assert st["s6"]["sport"] == "snowshoe" and st["s6"]["tags"] == ["Schneeschuh"] and st["s6"]["mt"] == "snowshoe" and st["s6"]["alt"] == "ski", st["s6"]
    assert st["s5"]["sport"] == "nordic" and st["s5"]["man"] == 1 and st["s5"]["mt"] == "skitour", "von Hand gewählte Sportart wird nie überschrieben: " + json.dumps(st["s5"])
    assert st["frei"]["sport"] == "ski" and st["frei"]["mt"] is None, "Tour nur in der App bleibt „Ski (allgemein)“"
    # neue Touren vom Server: richtige Arten (s0–s10 kommen als neue Touren, soweit nicht oben zugeordnet)
    neu = pg.evaluate("""async () => { const o = {}; for (const t of await Tours.list()) { const m = /^mt:(s\\d+)$/.exec(t.srcId || ''); if (m) o[m[1]] = [t.sport, t.tags || [], t.sportMt]; } return o; }""")
    assert neu["s8"][0] == "nordicwalking" and neu["s3"][0] == "run" and neu["s9"][0] == "mountaineering" and neu["s10"][0] == "other", neu
    assert "s4" not in neu and "s6" not in neu and "s7" not in neu, "zugeordnete Touren werden nicht noch einmal angelegt"
    # Schlagwort nur einmal: in der App entfernt → der nächste Abgleich bringt es nicht zurück; neuer Schneeschuh-Eintrag am Server bekommt es
    pg.evaluate("async id => { const t = await DB.get('tours', id); t.tags = []; await Tours.save(t); }", o["s6"])
    pg.evaluate("async () => Import.MT.importAll(await DB.kvGet('mt'), { zahlen: true }, null)")
    assert pg.evaluate("id => DB.get('tours', id).then(t => t.tags)", o["s6"]) == [], "entferntes Schlagwort kommt nicht wieder"
    pg.evaluate("async () => { for (const t of await Tours.list()) if (t.srcId === 'mt:s8') await Tours.remove(t.id); window.__mt.edit = l => l.map(t => t.id === 's8' ? Object.assign({}, t, { sport: 'snowshoe' }) : t); }")
    pg.evaluate("async () => Import.MT.importAll(await DB.kvGet('mt'), { zahlen: true }, null)")
    ns = pg.evaluate("Tours.list().then(l => l.find(t => t.srcId === 'mt:s8'))"); assert ns["sport"] == "snowshoe" and ns["tags"] == ["Schneeschuh"] and ns["sportMt"] == "snowshoe", ns      # neue Tour vom Server (2.19.0: Sportart Schneeschuh)
    pg.evaluate("window.__mt.edit = null")
    # Filter über das Schlagwort (Album) und die Tourseite zeigt Wandern + Schlagwort
    pg.evaluate("id => { location.hash = '#/tour/' + id }", ns["id"]); pg.wait_for_selector(".tourp")
    assert "Schneeschuh" in pg.inner_text(".tourp .sub") and pg.locator(".tourp a.chip", has_text="Schneeschuh").count() == 1
    # 3. Oberfläche: Sportart ändern (alle Arten, Handwahl), Tourenliste mit Chips, Statistik-Filter, Ziele, Planer, Aufzeichnung
    pg.evaluate("id => { location.hash = '#/tour/' + id }", o["s4"]); pg.wait_for_selector(".tourp"); pg.evaluate("document.querySelectorAll('.sheet-back').forEach(e => e.remove())")
    pg.locator("header.top button[aria-label=Aktionen]").click(); pg.get_by_text("Sportart ändern").click(); pg.wait_for_selector(".sheet[aria-label='Sportart'] .li")
    names = pg.locator(".sheet[aria-label='Sportart'] .li .li-t b").all_inner_texts()
    for want in ("Ski alpin", "Skitour", "Langlauf", "Wandern", "Bergsteigen", "Schneeschuh", "Snowboard"): assert want in names, names
    assert "Ski (allgemein)" not in names, names      # 2.19.0: nur noch für Touren, die sie schon haben
    pg.locator(".sheet .li", has_text="Skitour").click(); pg.wait_for_selector(".sheet", state="detached"); pg.wait_for_function("() => document.querySelector('.tourp .sub') && /Skitour/.test(document.querySelector('.tourp .sub').textContent)")
    t4 = pg.evaluate("id => DB.get('tours', id)", o["s4"]); assert t4["sport"] == "skitour" and t4["sportMan"] == 1, t4
    pg.evaluate("async () => Import.MT.importAll(await DB.kvGet('mt'), { zahlen: true }, null)"); assert pg.evaluate("id => DB.get('tours', id).then(t => t.sport)", o["s4"]) == "skitour", "Abgleich überschreibt die Handwahl nicht"
    pg.evaluate("location.hash = '#/'"); pg.wait_for_selector("a.tour"); pg.evaluate("TourUI.filter.sport = ''; Nav.render()"); pg.wait_for_selector(".chips .chip:has-text('Skitour')")
    chips = pg.locator(".filters .chips .chip").all_inner_texts()
    for want in ("Skitour", "Langlauf", "Ski (allgemein)", "Wandern"): assert any(want in c for c in chips), chips
    pg.click(".filters .chips .chip:has-text('Skitour')"); assert pg.locator("a.tour").count() == pg.evaluate("Tours.list().then(l => l.filter(t => t.sport === 'skitour' && t.status !== 'planned' && !t.hidden).length)")
    assert "Skitour" in pg.inner_text("a.tour .tb small"); pg.click(".filters .chips .chip:has-text('Alle')")
    pg.evaluate("Set_.set('statGruppen', StatGruppen.vorschlaege([]).filter(v => v.id === 'ski'))")      # 2.19.0: „Ski (alle Arten)“ gibt es nur noch als selbst angelegte Gruppe (Vorschlag „Alle Ski-Arten“)
    pg.evaluate("location.hash = '#/stats'"); pg.wait_for_selector(".kpis"); pg.select_option("select[aria-label=Zeitraum]", "all"); pg.select_option("select[aria-label=Sportart]", "sgrp:ski"); pg.wait_for_timeout(300)
    nski = pg.evaluate("Tours.list().then(l => l.filter(t => Sports.SKI.concat(['snowboard']).includes(t.sport) && t.status !== 'planned' && !t.hidden).length)")
    assert pg.locator(".kpis .kpi").first.inner_text().split("\n")[0].strip() == str(nski) and nski >= 6, (pg.inner_text(".kpis"), nski)
    pg.evaluate("location.hash = '#/stats/ziele'"); pg.wait_for_selector("#goaladd"); pg.click("#goaladd"); pg.wait_for_selector("#goalsport")
    opts = pg.locator("#goalsport option").all_inner_texts(); pg.evaluate("Set_.set('statGruppen', [])"); assert "Ski (zusammengefasst)" in opts and "Ski (alle Arten)" not in opts and "Skitour" in opts and "Langlauf" in opts and "Ski alpin" in opts and "Ski (allgemein)" not in opts, opts
    zu(pg)
    pg.evaluate("location.hash = '#/plan'"); pg.wait_for_selector(".ppanel select"); po = pg.locator(".ppanel select option").all_inner_texts()
    assert "Skitour" in po and "Langlauf" in po and "Ski (allgemein)" not in po and "Wandern" in po, po
    assert pg.evaluate("[Router.profileFor('skitour'), Router.profileFor('nordic'), Router.profileFor('skialpin'), Router.profileFor('ski'), Router.profileFor('hike')]") == ["hiking-mountain"] * 4 + ["hiking-mountain"]
    pg.evaluate("location.hash = '#/rec'"); pg.wait_for_selector(".bigstart"); rc = pg.locator(".chips .chip").all_inner_texts()
    assert any("Skitour" in c for c in rc) and any("Mehr" in c for c in rc) and not any("allgemein" in c for c in rc), rc      # 2.19.0: Favoriten als Chips, alle übrigen unter „Mehr …“
    pg.click("#rec-mehr"); pg.wait_for_selector("#rec-alle"); ma = pg.locator("#rec-alle .li-t b").all_inner_texts(); pg.evaluate("window.mtBack()"); pg.wait_for_selector(".sheet", state="detached")
    assert "Langlauf" in ma and "Ski alpin" in ma and "Bergsteigen" in ma and "Schneeschuh" in ma and "Ski (allgemein)" not in ma, ma
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
    assert [x[0] for x in sp] == ["mtb", "hike", "run"] and "2 Touren" in sp[1][1] and "18,0 km" in sp[1][1], sp
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
    pg.click("#jahr-pdf"); pg.wait_for_selector("#prog-stop")
    # Abbrechen im selben Takt wie die Seitenanzeige (kein Hin und Her zum Test, das auf schneller CI zu spät käme)
    pg.evaluate("""() => new Promise((ok, no) => { const t0 = Date.now(), iv = setInterval(() => { const s = document.querySelector('.sheet'), b = document.querySelector('#prog-stop');
      if (s && b && /Seite 2 von/.test(s.innerText)) { clearInterval(iv); b.click(); ok(); } else if (Date.now() - t0 > 60000) { clearInterval(iv); no('Seite 2 nie gesehen'); } }, 5); })""")
    pg.wait_for_selector(".sheet", state="detached", timeout=30000)
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
    pg.evaluate("MapKit.clearCache()")      # 2.11.0: das PDF nimmt gemerkte Kacheln zuerst – hier soll es wirklich laden
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


TB_MOCK = """() => {
  /* 2.13.0: Galerie der Hülle nachgestellt (imageGallery / saveImage); Zwischenspeicher und Teilen mitschreiben */
  const c0 = window.MTApp.call; window.__tbcall0 = c0; window.__tb = { calls: [], cache: {}, galerie: true };
  window.MTApp.call = (id, m, a) => {
    const T = window.__tb, o = JSON.parse(a || '{}');
    if (m === 'appendCache') { (T.cache[o.name] = o.reset ? [] : (T.cache[o.name] || [])).push(o.b64); }
    if (!['imageGallery', 'saveImage', 'shareCache'].includes(m)) return c0.call(window.MTApp, id, m, a);
    T.calls.push([m, o]); let r;
    if (m === 'imageGallery') r = { supported: T.galerie };
    else if (m === 'saveImage') r = 'Pictures/Tourentagebuch/' + o.name;
    else r = true;
    setTimeout(() => window.__mtcb(+id, true, JSON.stringify(r)), 5);
  };
}"""

def teilen_2130(pg):
    """2.13.0 A: Tour als Bild teilen – Menüeintrag, Vorschau, Hochformat/Quadrat, Fotos ein/aus (Titelfoto-Regel), Karte mit Quellenangabe,
    ohne Kacheln Spur auf ruhigem Grund (kein Fehler), Teilen über den Zwischenspeicher, In Galerie speichern (Android 10+), Platz bei 360 px."""
    import base64
    leise = lambda: pg.wait_for_function(LEISE, timeout=30000)
    t0 = 1561000000000
    tid = None
    ids = ["tbf1aaaaaa", "tbf2aaaaaa", "tbf3aaaaaa", "tbf4aaaaaa", "tbf5aaaav"]
    from PIL import Image as _Im
    import io as _io
    _b = _io.BytesIO(); _Im.new("RGB", (480, 360), (40, 120, 90)).save(_b, "JPEG"); jpg = _b.getvalue()
    pg.route("**/thumb/tbf*", lambda r: r.fulfill(status=200, body=jpg, content_type="image/jpeg"))
    pg.route("**/photo/tbf*", lambda r: r.fulfill(status=200, body=jpg, content_type="image/jpeg"))
    try:
        tid = pg.evaluate("""async t0 => (await Tours.add({ name: 'Über den langen Grat zur Hütte und durch die Klamm zurück ins Tal', sport: 'hike', src: 'file', force: true,
          pts: Array.from({ length: 80 }, (_, i) => ({ lat: 47.3 + i * 0.0006, lon: 11.3 + Math.sin(i / 9) * 0.004, ele: 900 + Math.sin(i / 12) * 300, t: t0 + i * 60000 })) })).tour.id""", t0)
        pg.evaluate("""async ([t0, tid, ids]) => { const f = [2, 0, null, 0, 0];
          for (let i = 0; i < ids.length; i++) await DB.put('photos', { id: ids[i], name: 'p.jpg', ts: t0 + (i + 1) * 600000, lat: null, lon: null, pos: 'none', tour: tid, src: 'galerie', w: 480, h: 360, faces: f[i], video: i === 4 }); }""", [t0, tid, ids])
        pg.evaluate(TB_MOCK)
        # Fotoauswahl wie das Titelfoto: Personenfoto (tbf1) bleibt draußen, Video auch
        sel = pg.evaluate("tid => DB.get('tours', tid).then(t => TourBild.daten(t)).then(d => d.fotos.map(p => p.id))", tid)
        assert sel == ["tbf2aaaaaa", "tbf3aaaaaa", "tbf4aaaaaa"], sel
        # 1. Menü → Blatt mit Vorschau
        go(pg, "#/tour/" + tid, "header.top button[aria-label=Aktionen]")
        pg.click("header.top button[aria-label=Aktionen]"); pg.wait_for_selector("#tb-menu"); pg.click("#tb-menu")
        pg.wait_for_selector(".sheet[aria-label='Als Bild teilen'] #tb-bild[src]")
        pg.wait_for_function("() => document.querySelector('#tb-vor').getAttribute('aria-busy') === 'false'", timeout=60000)
        assert pg.inner_text("#tb-info") == "Hochformat · 1080 × 1350 Pixel · 3 Fotos", pg.inner_text("#tb-info")
        assert pg.is_checked("#tb-fotos input") and pg.locator("#tb-galerie").count() == 1, "Fotos an (Vorgabe), Galerie-Knopf ab Android 10"
        dims = pg.evaluate("() => { const i = document.querySelector('#tb-bild'); return [i.naturalWidth, i.naturalHeight]; }"); assert dims == [1080, 1350], dims
        assert "mit 3 Fotos" in pg.get_attribute("#tb-bild", "alt")
        # 2. Platz bei 360 px und 130 % Schrift
        bad = sheet_check_open(pg, "Als Bild teilen")
        # 3. Fotos aus → ohne Fotos; Quadrat → 1080 × 1080
        pg.click("#tb-fotos"); pg.wait_for_function("() => document.querySelector('#tb-info').textContent === 'Hochformat · 1080 × 1350 Pixel'", timeout=60000)
        pg.click("#tb .seg button:has-text('Quadrat')"); pg.wait_for_function("() => document.querySelector('#tb-info').textContent === 'Quadrat · 1080 × 1080 Pixel'", timeout=60000)
        pg.wait_for_function("() => document.querySelector('#tb-bild').naturalHeight === 1080", timeout=30000)
        pg.click("#tb-fotos"); pg.wait_for_function("() => /3 Fotos$/.test(document.querySelector('#tb-info').textContent)", timeout=60000)
        # 4. Teilen: Zwischenspeicher (JPEG 1080 × 1080) + Teilen-Menü
        pg.click("#tb-teilen"); pg.wait_for_function("__tb.calls.some(c => c[0] === 'shareCache')", timeout=30000)
        sc = [o for m, o in pg.evaluate("__tb.calls") if m == "shareCache"][0]
        assert sc["name"].startswith("Tourentagebuch-Tour_ueber_den_langen_Grat") and sc["name"].endswith("-quadrat.jpg") and sc["mime"] == "image/jpeg" and sc["title"].endswith(" teilen"), sc
        raw = b"".join(base64.b64decode(x) for x in pg.evaluate("n => __tb.cache[n]", sc["name"]))
        assert raw[:3] == b"\xff\xd8\xff", raw[:4]
        d2 = pg.evaluate("async (b64) => { const im = new Image(); im.src = 'data:image/jpeg;base64,' + b64; await im.decode(); return [im.naturalWidth, im.naturalHeight]; }", base64.b64encode(raw).decode())
        assert d2 == [1080, 1080], d2
        # 5. In Galerie speichern
        pg.wait_for_function("() => !document.querySelector('#tb-galerie').disabled"); leise(); pg.click("#tb-galerie")
        assert "In der Galerie gespeichert: Pictures/Tourentagebuch/" in toast_text(pg, "Galerie gespeichert")
        sv = [o for m, o in pg.evaluate("__tb.calls") if m == "saveImage"][0]; assert sv["mime"] == "image/jpeg" and sv["name"] == sc["name"], sv
        zu(pg)
        # 6. Karte: mit Kacheln Quellenangabe; ohne Kacheln (Server-Fehler) Spur auf ruhigem Grund, ohne Fehler
        px = pg.evaluate("""async tid => { const t = await DB.get('tours', tid), d = await TourBild.daten(t); const cv = await TourBild.render(t, d, { format: 'hoch', mitFotos: false });
          const L = TeilenCalc.layout('hoch', { zeilen: 2, titelSize: 72, fotos: 0, profil: true }); const k = await TourBild.karte(d, L.karte.w, L.karte.h);
          const c = cv.getContext('2d'), at = (x, y) => [...c.getImageData(x, y, 1, 1).data].slice(0, 3);
          return { w: cv.width, h: cv.height, head: at(1000, 20), paper: at(1060, 700), karte: !!(k && k.cv), quelle: k && k.quelle.s }; }""", tid)
        assert px["w"] == 1080 and px["h"] == 1350 and px["head"] == [12, 37, 38] and px["paper"] == [242, 244, 238] and px["karte"] and "OpenStreetMap" in px["quelle"], px
        pg.route("**/tile.openstreetmap.org/**", lambda r: r.fulfill(status=503, body=b""))
        ok2 = pg.evaluate("""async tid => { const t = await DB.get('tours', tid), d = await TourBild.daten(t); const cv = await TourBild.render(t, d, { format: 'quadrat', mitFotos: true });
          return { w: cv.width, h: cv.height, karte: [...d.karten.values()].length }; }""", tid)
        assert ok2["w"] == 1080 and ok2["h"] == 1080, ok2
        pg.unroute("**/tile.openstreetmap.org/**")
        # 7. ohne Fotos: Hinweis statt Schalter; vor Android 10: kein Galerie-Knopf
        pg.evaluate("async ids => { for (const id of ids) await DB.del('photos', id); __tb.galerie = false; }", ids)
        pg.evaluate("tid => DB.get('tours', tid).then(t => TourBild.dialog(t))", tid)
        pg.wait_for_selector("#tb-keine"); pg.wait_for_function("() => document.querySelector('#tb-vor').getAttribute('aria-busy') === 'false'", timeout=60000)
        assert pg.locator("#tb-fotos").count() == 0 and pg.locator("#tb-galerie").count() == 0 and pg.inner_text("#tb-info") == "Hochformat · 1080 × 1350 Pixel"
        zu(pg)
        return bad
    finally:
        pg.unroute("**/thumb/tbf*"); pg.unroute("**/photo/tbf*")
        pg.evaluate("""async ([ids, tid]) => { if (window.__tbcall0) { window.MTApp.call = window.__tbcall0; window.__tbcall0 = null; } for (const id of ids) await DB.del('photos', id); if (tid) await Tours.remove(tid);
          document.querySelectorAll('.sheet-back').forEach(e => e.remove()); sheet.stack = []; }""", [ids, tid])


def statistik_2130(pg):
    """2.13.0 B: Statistik → Vergleich (zwei Jahre wählbar, Kennzahl, Differenz-Zeile, Linien aufsummiert mit Legende, Achse und Beschriftung für Screenreader,
    Tabelle, Sportart-Filter, Leerzustand) und „Bestwerte je Sportart“ als Rangliste (Beste / Beste drei, Tempo). Platz bei 360–430 px und 130 % Schrift."""
    ids = ["vg1", "vg2", "vg3", "vg4", "vg5", "vg6"]
    try:
        pg.evaluate("""async () => { const d = (y, m, dd) => new Date(y, m - 1, dd, 10).getTime();
          const T = [['vg1', 'hike', d(2016, 1, 10), 10000, 300, 7200, 6000, 1200], ['vg2', 'hike', d(2016, 3, 5), 20000, 900, 21600, 18000, 2400], ['vg3', 'bike', d(2016, 5, 1), 30000, 400, 7200, 6000, 800],
            ['vg4', 'hike', d(2015, 2, 2), 25000, 1200, 28800, 25000, 2100], ['vg5', 'bike', d(2015, 6, 2), 50000, 600, 9000, 8000, 700], ['vg6', 'hike', d(2015, 8, 2), 5000, 100, 3600, 3000, 900]];
          for (const [id, sport, start, dist, up, dur, moving, maxAlt] of T) await DB.put('tours', { id, name: 'Vergleich ' + id, sport, start, end: start + dur * 1000, dist, up, down: up, dur, moving, maxAlt, src: 'file', status: 'done' });
          Tours.invalidate(); await Set_.set('bestN', 1); Ausw.vgl = { a: 2016, b: 2015, m: 'dist' }; }""")
        go(pg, "#/stats", ".chips")
        pg.click(".chips .chip:has-text('Vergleich')"); pg.wait_for_selector("#vgl-diff")
        assert pg.locator("select[aria-label=Zeitraum]").count() == 0 and pg.locator("select[aria-label=Sportart]").count() == 1, "eigene Jahre, Sportart bleibt"
        assert pg.input_value("#vgl-a") == "2016" and pg.input_value("#vgl-b") == "2015"
        d = pg.inner_text("#vgl-diff"); assert d.startswith("−25 % Strecke") and "2016: 60,0 km" in d and "2015: 80,0 km" in d, d
        f = pg.inner_text("#vgl .facts"); assert "Touren" in f and "±0 Touren" in f and "Aufstieg" in f and "−300 m (−16 %)" in f, f
        lab = pg.get_attribute("#vgl-chart svg", "aria-label"); assert lab.startswith("Strecke aufsummiert je Monat. 2016: Januar 10,0 km, Februar 10,0 km, März 30,0 km") and "Dezember 60,0 km" in lab and "2015: Januar 0 m" in lab, lab
        assert pg.locator("#vgl-chart polyline.va").count() == 1 and pg.locator("#vgl-chart polyline.vb").count() == 1 and "2016" in pg.inner_text("#vgl-chart .vleg") and "2015" in pg.inner_text("#vgl-chart .vleg")
        yt = pg.evaluate("[...document.querySelectorAll('#vgl-chart text.vy')].map(e => e.textContent)"); assert yt == ["2015", "2016"], yt
        pg.locator("#vgl-chart rect.vh").nth(2).click(); assert pg.inner_text("#vgl-wert") == "März: 2016 30,0 km · 2015 25,0 km", pg.inner_text("#vgl-wert")
        pg.click("#vgl-tabelle summary"); assert pg.locator("#vgl-tabelle tbody tr").count() == 12 and "30,0 km" in pg.inner_text("#vgl-tabelle tbody tr:nth-child(3)")
        # Kennzahl wechseln, Sportart-Filter
        pg.click("#vgl .seg button:has-text('Zeit')"); d = pg.inner_text("#vgl-diff"); assert d.startswith("−17 % Zeit") and "2016: 8:20 h" in d, d
        pg.click("#vgl .seg button:has-text('Touren')"); assert pg.inner_text("#vgl-diff").startswith("±0 % Touren")
        pg.click("#vgl .seg button:has-text('Strecke')")
        pg.select_option("select[aria-label=Sportart]", "hike"); pg.wait_for_selector("#vgl-diff"); d = pg.inner_text("#vgl-diff"); assert d.startswith("±0 % Strecke") and "2016: 30,0 km" in d, d
        pg.select_option("select[aria-label=Sportart]", "run"); pg.wait_for_selector("#vgl .empty"); assert "Keine Touren in 2016 und 2015" in pg.inner_text("#vgl .empty")
        pg.select_option("select[aria-label=Sportart]", "")
        # Jahr wählen: 2015 gegen 2014 (2014 ohne Touren) → „neu“
        pg.wait_for_selector("#vgl-a"); pg.select_option("#vgl-a", "2015"); pg.select_option("#vgl-b", "2014"); d = pg.inner_text("#vgl-diff"); assert d.startswith("Strecke: neu in 2015"), d
        pg.select_option("#vgl-a", "2016"); pg.select_option("#vgl-b", "2015")
        bad = layout_check(pg, ["#/stats/vergleich"])
        # Bestwerte je Sportart: Beste / Beste drei, Tempo
        go(pg, "#/stats/rekorde", "#bw-sport")
        pg.select_option("select[aria-label=Zeitraum]", "all"); pg.wait_for_selector("#bw-sport")
        hs = pg.locator("#bw-sport h3.sub[data-sport]").all_inner_texts(); assert any("Wandern" in x for x in hs) and any("Radtour" in x for x in hs), hs      # 2.19.0: „Tourenrad“ heißt „Radtour“
        assert pg.locator("#bw-sport .bw-mehr").count() == 0 and pg.locator("#bw-sport a[data-m=tempo]").count() >= 1
        pg.click("#bestwerte .seg button:has-text('Beste drei')"); pg.wait_for_selector("#bw-sport .bw-mehr")
        assert "Platz 2 und 3" in pg.inner_text("#bw-sport")
        bad += layout_check(pg, ["#/stats/rekorde"], widths=((360, 100), (360, 130)))
        return bad
    finally:
        pg.evaluate("""async ids => { for (const id of ids) await DB.del('tours', id); Tours.invalidate(); await Set_.set('bestN', 1); Ausw.vgl = { a: null, b: null, m: 'dist' }; }""", ids)


def fuehrer_2130(pg):
    """2.13.0 C: Wanderführer als Datei – exportieren (Titelbilder nur auf Wunsch, Auskunft „gewandert“), importieren (Zusammenfassung, Unterschiede,
    nichts überschrieben, neue Bücher und Buchtouren, Titelbild nur wo keines ist), kaputte Datei, Platz bei 360 px."""
    import json as _json
    leise = lambda: pg.wait_for_function(LEISE, timeout=30000)
    cover = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q=="
    try:
        pg.evaluate("""async cover => { const lin = (la, lo) => Array.from({ length: 12 }, (_, i) => ({ lat: la + i * 0.001, lon: lo + i * 0.0012, ele: 500 + i * 10 }));
          const m = (id, ord, title, km, p) => ({ id, ord, title, km, up: 100, la: p[0].lat, lo: p[0].lon, bb: Fuehrer.umrandung(p), n: p.length, f: title + '.gpx' });
          const a = lin(28.1, -15.5), b = lin(28.2, -15.6);
          await DB.kvSet('guidepts:fxbuch001', { t0: Fuehrer.packe(a), t1: Fuehrer.packe(b) });
          await DB.kvSet('guidecover:fxbuch001', cover); Buecher.coverMem = {};
          await Buecher.aendere(l => { l.push({ id: 'fxbuch001', name: 'Übertragungsbuch', created: 1, next: 2, cover: 1, touren: [m('t0', 0, 'Roque Nublo', 4.2, a), m('t1', 1, 'Barranco', 9.8, b)] }); return l; }); }""", cover)
        go(pg, "#/fuehrer", "#fu-export")
        # 1. Export: Vorgabe ohne Titelbild
        pg.click("#fu-export"); pg.wait_for_selector(".sheet[aria-label='Wanderführer exportieren']")
        assert not pg.is_checked("#fu-ex-cover input"), "Titelbilder: Vorgabe aus"
        bad = sheet_check_open(pg, "Wanderführer exportieren")
        pg.evaluate("window.__saved = null"); leise(); pg.click("#fu-ex-go")
        assert "Gespeichert: Download/Tourentagebuch/Tourentagebuch-Wanderfuehrer-" in toast_text(pg, "Gespeichert")
        sv = pg.evaluate("window.__saved"); assert sv["mime"] == "application/json" and sv["name"].endswith(".json"), sv
        ex = _json.loads(sv["text"]); bk = [b for b in ex["buecher"] if b["id"] == "fxbuch001"][0]
        assert ex["format"] == "tourentagebuch-wanderfuehrer" and len(bk["touren"]) == 2 and "cover" not in bk and bk["touren"][0]["pts"]["la"], bk.keys()
        assert "lat" not in sv["text"] and "tracks" not in sv["text"], "keine Spuren eigener Touren"
        # mit Titelbild
        pg.click("#fu-export"); pg.click("#fu-ex-cover"); pg.evaluate("window.__saved = null"); leise(); pg.click("#fu-ex-go"); toast_text(pg, "Gespeichert")
        ex2 = _json.loads(pg.evaluate("window.__saved.text")); assert [b for b in ex2["buecher"] if b["id"] == "fxbuch001"][0]["cover"] == cover
        # 2. Import: andere Länge (Unterschied), neue Buchtour, neues Buch mit Titelbild; Titelbild des vorhandenen Buchs bleibt
        imp = _json.loads(sv["text"]); bk = [b for b in imp["buecher"] if b["id"] == "fxbuch001"][0]
        imp["buecher"] = [bk]
        bk["cover"] = cover.replace("Q==", "Qx=="); bk["touren"][1]["km"] = 11.5
        bk["touren"].append(dict(bk["touren"][0], title="Pico de las Nieves", km=7.1, id="t9", ord=9))
        imp["buecher"].append({ "id": "fxbuch002", "name": "Zweites Buch", "cover": cover, "touren": [dict(bk["touren"][0], title="Tejeda", km=5.0)] })
        pg.evaluate("t => { window.__pick = [{ name: 'fuehrer.json', url: URL.createObjectURL(new Blob([t], { type: 'application/json' })) }]; }", _json.dumps(imp))
        pg.click("#fu-import"); pg.wait_for_selector(".sheet[aria-label='Wanderführer importieren']")
        su = pg.inner_text("#fu-im-sum"); assert su == "1 neues Buch · 1 neue Buchtour in einem vorhandenen Buch · 1 Buchtour ist schon da · 1 Titelbild.", su
        kf = pg.inner_text("#fu-im-konf"); assert "2 Unterschiede" in kf and "„Barranco“ in „Übertragungsbuch“: in der Datei 11,5 km, bei dir 9,8 km – nicht übernommen." in kf and "Titelbild von „Übertragungsbuch“: deines bleibt." in kf, kf
        bad += sheet_check_open(pg, "Wanderführer importieren")
        leise(); pg.click("#fu-im-ok"); assert "Übernommen" in toast_text(pg, "Übernommen")
        r = pg.evaluate("""async () => { const l = await Buecher.liste(), a = l.find(b => b.id === 'fxbuch001'), b = l.find(b => b.id === 'fxbuch002');
          return { a: a.touren.map(t => t.title + ':' + t.km + ':' + t.id), next: a.next, b: b && b.touren.map(t => t.title), bcov: b && b.cover, acov: await DB.kvGet('guidecover:fxbuch001', null), bp: Object.keys(await DB.kvGet('guidepts:fxbuch002', {})), ap: Object.keys(await DB.kvGet('guidepts:fxbuch001', {})) }; }""")
        assert r["a"] == ["Roque Nublo:4.2:t0", "Barranco:9.8:t1", "Pico de las Nieves:7.1:t2"] and r["next"] == 3 and r["ap"] == ["t0", "t1", "t2"], r
        assert r["b"] == ["Tejeda"] and r["bcov"] == 1 and r["bp"] == ["t0"] and r["acov"] == cover, r
        pg.wait_for_selector("[data-book=fxbuch002]")
        # zweiter Import derselben Datei: nichts Neues, Übernehmen gesperrt
        pg.evaluate("t => { window.__pick = [{ name: 'fuehrer.json', url: URL.createObjectURL(new Blob([t], { type: 'application/json' })) }]; }", _json.dumps(imp))
        pg.click("#fu-import"); pg.wait_for_selector("#fu-im-sum"); assert pg.is_disabled("#fu-im-ok") and "3 Buchtouren sind schon da" in pg.inner_text("#fu-im-sum"), pg.inner_text("#fu-im-sum")
        zu(pg)
        # 3. kaputte oder fremde Datei: verständliche Meldung, nichts geändert
        pg.evaluate("() => { window.__pick = [{ name: 'x.json', url: URL.createObjectURL(new Blob(['{\"app\":\"tourentagebuch\"}'])) }]; }")
        leise(); pg.click("#fu-import"); assert "keine Wanderführer-Datei" in toast_text(pg, "Wanderführer-Datei")
        return bad
    finally:
        pg.evaluate("""async () => { for (const id of ['fxbuch001', 'fxbuch002']) await Buecher.entferne(id); window.__pick = []; window.__saved = null; document.querySelectorAll('.sheet-back').forEach(e => e.remove()); sheet.stack = []; }""")


def dp_jpg(farbe, muster=0, w=96, h=72, q=90):
    """Kleines Testbild: Fläche mit Rechtecken – gleiches Muster = gleiches Motiv; w/h ≠ 96×72 verkleinert/vergrößert dasselbe Motiv (neu gespeichert)."""
    import io as _io
    from PIL import Image as _Im, ImageDraw as _Dr
    im = _Im.new("RGB", (96, 72), farbe); d = _Dr.Draw(im)
    for k in range(6):
        x = (k * 37 + muster * 53) % 96; y = (k * 23 + muster * 31) % 72
        d.rectangle([x, y, x + 24, y + 14], fill=(255 - 40 * k % 255, (muster * 70 + 30 * k) % 255, 60 * k % 255))
    if (w, h) != (96, 72): im = im.resize((w, h), _Im.LANCZOS)
    b = _io.BytesIO(); im.save(b, "JPEG", quality=q); return b.getvalue()

DP_MOCK = """() => {
  /* 2.14.0: Hülle für doppelte Fotos nachgestellt: photoPrints (Abdruck und Größe gespeicherter Dateien), deletePhoto mitschreiben */
  const c0 = window.MTApp.call; window.__dpcall0 = c0;
  window.__dp = { del: [], prints: {}, calls: 0 };
  window.MTApp.call = (id, m, a) => {
    const D = window.__dp, o = JSON.parse(a || '{}');
    if (m === 'deletePhoto') D.del.push(o.id);
    if (m !== 'photoPrints' && m !== 'deletePhoto') return c0.call(window.MTApp, id, m, a);
    let r = true;
    if (m === 'photoPrints') { D.calls++; r = (o.ids || []).map(x => ({ id: x, fpd: D.prints[x] || ('p1:2048:' + (x + '0000000000000000').slice(0, 16).replace(/[^0-9a-f]/g, '0')), size: 1048576 })); }
    setTimeout(() => window.__mtcb(+id, true, JSON.stringify(r)), 5);
  };
}"""

def doppelt_2140(pg):
    """2.14.0: doppelte Fotos – Fotoleiste nach dem Löschen richtig neu gezeichnet; Import überspringt Bekanntes (Schalter);
    Suche (je Tour) zeigt Gruppen mit Vorauswahl, Auswahl änderbar; Löschen mit Übernahme von Notiz, Kommentar und Titelfoto; Videos; Platz bei 360–430 px."""
    leise = lambda: pg.wait_for_function(LEISE, timeout=30000)
    t0 = 1580000000000      # eigene Tour im Januar 2020, weit weg von den übrigen Testdaten
    bilder = {"dpa": dp_jpg((40, 120, 90), 1), "dpb": dp_jpg((40, 120, 90), 1), "dpd": dp_jpg((40, 120, 90), 1), "dpc": dp_jpg((200, 80, 40), 2),
              "dpe": dp_jpg((200, 80, 40), 2, 120, 90, 70), "dpv": dp_jpg((90, 90, 200), 3)}
    def bild(r):
        k = r.request.url.split("/")[-1][:3]
        r.fulfill(status=200, body=bilder.get(k, bilder["dpc"]), content_type="image/jpeg")
    pg.route("**/thumb/dp*", bild); pg.route("**/photo/dp*", bild)
    pg.evaluate(DP_MOCK)
    ids = ["dpa1111111", "dpb2222222", "dpc3333333", "dpd4444444", "dpe5555555", "dpv111111v", "dpv222222v", "dpn1111111", "dpn2222222", "dpn3333333", "dpn4444444"]
    tid = None; bad = []
    try:
        tid = pg.evaluate("""async t0 => (await Tours.add({ name: 'Doppeltest', sport: 'hike', src: 'file', force: true,
          pts: Array.from({ length: 60 }, (_, i) => ({ lat: 47.6 + i * 0.0005, lon: 11.6 + i * 0.0004, ele: 800 + i * 3, t: t0 + i * 30000 })) })).tour.id""", t0)
        pg.evaluate("""async ([t0, tid]) => {
          await DB.put('photos', { id: 'dpa1111111', name: 'IMG_0001.JPG', ts: t0 + 300000, lat: 47.61, lon: 11.61, pos: 'exif', tour: tid, src: 'smb', w: 96, h: 72, note: '' });
          await DB.put('photos', { id: 'dpb2222222', name: 'IMG_0001.JPG', ts: t0 + 300000, lat: null, lon: null, pos: 'none', tour: tid, src: 'rechner', w: 96, h: 72, note: 'Gipfelblick', fp: 'p1:5000:b0b0b0b0b0b0b0b0' });
          await DB.put('photos', { id: 'dpc3333333', name: 'IMG_0002.JPG', ts: t0 + 600000, lat: 47.62, lon: 11.62, pos: 'exif', tour: tid, src: 'smb', w: 96, h: 72, note: '' }); }""", [t0, tid])
        # 1. Fotoleiste: ein Foto in der Lightbox löschen → Leiste zeigt danach genau die übrigen, und jedes Vorschaubild öffnet sein eigenes Foto
        go(pg, "#/tour/" + tid, "#tphotos .strip .th")
        assert pg.locator("#tphotos .strip .th").count() == 3
        pg.locator("#tphotos .strip .th").nth(0).click(); pg.wait_for_selector(".lb")
        pg.click(".lb button[aria-label=Details]"); pg.wait_for_selector("#lb-del"); pg.click("#lb-del")
        pg.wait_for_selector(".sheet[aria-label='Foto löschen?']"); pg.click(".sheet[aria-label='Foto löschen?'] button.pri")
        pg.wait_for_function("() => DB.get('photos', 'dpa1111111').then(p => !p)")
        pg.evaluate("window.__lightbox && window.__lightbox.close()")
        pg.wait_for_function("() => document.querySelectorAll('#tphotos .strip .th').length === 2", timeout=5000)
        srcs = pg.eval_on_selector_all("#tphotos .strip .th img", "l => l.map(i => i.getAttribute('src'))")
        assert srcs == ["/thumb/dpb2222222.jpg", "/thumb/dpc3333333.jpg"], srcs
        pg.locator("#tphotos .strip .th").nth(1).click(); pg.wait_for_selector(".lb")
        assert "dpc3333333" in pg.get_attribute(".lb .lb-img", "src"), pg.get_attribute(".lb .lb-img", "src")
        assert pg.inner_text(".lb .lb-cnt") == "2 / 2", pg.inner_text(".lb .lb-cnt")
        pg.evaluate("window.__lightbox && window.__lightbox.close()")
        # 2. Import: gleicher Abdruck (andere Kennung, z. B. im Browser verkleinert) und gleicher Name + Zeit + Größe werden übersprungen und gezählt;
        #    die zweite Kopie löscht die Hülle wieder. Schalter (Vorgabe an) in „Fotos hinzufügen“; aus = wird übernommen.
        assert pg.evaluate("window.__dp.del") == ["dpa1111111"], "Lightbox löscht über die Hülle"
        pg.evaluate("""t0 => { window.__dp.del = []; window.__pickPh = [
          { id: 'dpn1111111', name: 'IMG_0001.JPG', ts: t0 + 300000 + 3600000, w: 96, h: 72, src: 'galerie', fp: 'p1:5000:b0b0b0b0b0b0b0b0', fpd: 'p1:4000:1111111111111111' },
          { id: 'dpn2222222', name: 'img_0002 (1).jpg', ts: t0 + 600400, w: 96, h: 72, src: 'galerie', fp: 'p1:6000:2222222222222222' },
          { id: 'dpn3333333', name: 'IMG_0003.JPG', ts: t0 + 900000, w: 96, h: 72, src: 'galerie', fp: 'p1:7000:3333333333333333' }]; }""", t0)
        pg.evaluate("PhotoSources.sheet(null, null)"); pg.wait_for_selector("#ps-skipdup")
        assert pg.is_checked("#ps-skipdup input"), "Vorgabe: schon vorhandene überspringen"
        bad += sheet_check_open(pg, "Fotos hinzufügen")
        leise(); pg.get_by_text("Aus der Galerie wählen").click()
        tx = toast_text(pg, "hinzugefügt"); assert tx == "1 Foto(s) hinzugefügt · 2 schon vorhanden, übersprungen", tx
        assert pg.evaluate("window.__dp.del.slice().sort().join()") == "dpn1111111,dpn2222222", pg.evaluate("window.__dp.del")
        assert pg.evaluate("Promise.all(['dpn1111111', 'dpn2222222', 'dpn3333333'].map(id => DB.get('photos', id))).then(l => l.map(p => !!p).join())") == "false,false,true"
        assert pg.evaluate("DB.get('photos', 'dpn3333333').then(p => p.fp)") == "p1:7000:3333333333333333", "Abdruck gespeichert"
        pg.evaluate("PhotoSources.sheet(null, null)"); pg.wait_for_selector("#ps-skipdup"); pg.click("#ps-skipdup"); pg.wait_for_function("() => Set_.get('fotoSkipDup') === false")
        pg.evaluate("""t0 => { window.__pickPh = [{ id: 'dpn4444444', name: 'x.jpg', ts: t0 + 5e6, w: 96, h: 72, src: 'galerie', fp: 'p1:5000:b0b0b0b0b0b0b0b0' }]; }""", t0)
        leise(); pg.get_by_text("Aus der Galerie wählen").click()
        assert toast_text(pg, "hinzugefügt") == "1 Foto(s) hinzugefügt", "Schalter aus: wird übernommen"
        pg.evaluate("async () => { await Set_.set('fotoSkipDup', true); for (const id of ['dpn3333333', 'dpn4444444']) await DB.del('photos', id); window.__dp.del = []; delete window.__pickPh; }")
        # 3. Suche je Tour (Tourmenü): gleiche Datei (Abdruck der gespeicherten Datei aus der Hülle), fast gleiches Bild in anderer Größe, zwei gleiche Videos
        pg.evaluate("""async ([t0, tid]) => {
          await DB.put('photos', { id: 'dpd4444444', name: 'IMG_0001.JPG', ts: t0 + 300000, lat: 47.615, lon: 11.615, pos: 'exif', tour: tid, src: 'smb', w: 96, h: 72, note: '' });
          await DB.put('photos', { id: 'dpe5555555', name: 'P1010002.JPG', ts: t0 + 601000, lat: null, lon: null, pos: 'none', tour: tid, src: 'rechner', w: 120, h: 90, note: '' });
          await DB.put('photos', { id: 'dpv111111v', name: 'Video.mp4', ts: t0 + 1200000, video: true, dur: 5000, lat: null, lon: null, pos: 'none', tour: tid, src: 'kamera', w: 64, h: 36, fp: 'p1:9:v0v0', fpd: 'p1:9:vd' });
          await DB.put('photos', { id: 'dpv222222v', name: 'Video.mp4', ts: t0 + 1200000, video: true, dur: 5000, lat: null, lon: null, pos: 'none', tour: tid, src: 'kamera', w: 64, h: 36, fp: 'p1:9:v0v0', fpd: 'p1:9:vd' });
          window.__dp.prints = { dpb2222222: 'p1:4096:dddddddddddddddd', dpd4444444: 'p1:4096:dddddddddddddddd' };
          await Comments.add('dpb2222222', 'Schöne Sicht');
          const bg = await DB.kvGet('tilebg', {}); bg[tid] = { kind: 'photo', ph: 'dpb2222222' }; await DB.kvSet('tilebg', bg); }""", [t0, tid])
        go(pg, "#/tour/" + tid, "#tphotos .strip .th")
        pg.click("header.top button[aria-label=Aktionen]"); pg.wait_for_selector("#fd-menu"); pg.click("#fd-menu")
        pg.wait_for_function("() => document.querySelectorAll('.fd-g').length > 0 && !Nav._busy", timeout=30000)
        assert pg.evaluate("location.hash") == "#/fotodoppelt/" + tid
        assert pg.locator(".fd-g").count() == 3, pg.inner_text("#view")
        assert pg.inner_text("#fd-sum") == "3 Gruppen mit 6 Fotos. Zum Löschen gewählt: 3 Fotos in 3 Gruppen · 3 MB frei.", pg.inner_text("#fd-sum")
        g1 = ".fd-g[data-key=dpb2222222]"
        assert "Gleiche Datei" in pg.inner_text(g1) and pg.locator(g1 + " .fd-e").count() == 2, pg.inner_text(g1)
        assert pg.inner_text(g1 + " .fd-e[data-id=dpd4444444] .fd-st") == "Bleibt" and pg.inner_text(g1 + " .fd-e[data-id=dpb2222222] .fd-st") == "Wird gelöscht", "Vorauswahl: das mit Ort bleibt"
        assert "mit Notiz" in pg.inner_text(g1 + " .fd-e[data-id=dpb2222222]") and "Titelfoto" in pg.inner_text(g1 + " .fd-e[data-id=dpb2222222]") and "1024 KB · 96 × 72" in pg.inner_text(g1 + " .fd-e[data-id=dpb2222222]")
        g2 = ".fd-g[data-key=dpc3333333]"
        assert "fast gleiches Bild" in pg.inner_text(g2) and pg.inner_text(g2 + " .fd-e[data-id=dpe5555555] .fd-st") == "Wird gelöscht", pg.inner_text(g2)
        g3 = ".fd-g[data-key=dpv111111v]"
        assert "2 Videos" in pg.inner_text(g3), pg.inner_text(g3)
        assert pg.evaluate("window.__dp.calls") >= 1 and pg.evaluate("DB.get('photos', 'dpd4444444').then(p => p.fpd + '|' + p.size + '|' + (p.gr || '').length)") == "p1:4096:dddddddddddddddd|1048576|128", "Abdruck und Grauraster gespeichert"
        # Auswahl ändern: alle löschen geht nicht (eines bleibt); im Videopaar nichts löschen
        leise(); pg.click(g1 + " .fd-e[data-id=dpd4444444] .fd-cb"); assert "Mindestens ein Foto" in toast_text(pg, "Mindestens")
        assert pg.inner_text(g1 + " .fd-e[data-id=dpd4444444] .fd-st") == "Bleibt"
        vdrop = pg.evaluate("[...document.querySelectorAll('.fd-g[data-key=dpv111111v] .fd-e.weg')].map(e => e.dataset.id)")
        assert len(vdrop) == 1, vdrop
        pg.click(g3 + f" .fd-e[data-id={vdrop[0]}] .fd-cb")
        assert pg.inner_text("#fd-sum").endswith("2 Fotos in 2 Gruppen · 2 MB frei."), pg.inner_text("#fd-sum")
        assert pg.inner_text("#fd-go") == "2 Fotos löschen"
        # Vorschaubild öffnet die Gruppe in der Lightbox
        pg.click(g2 + " .fd-e[data-id=dpe5555555] .fd-th"); pg.wait_for_selector(".lb"); assert pg.inner_text(".lb .lb-cnt") == "2 / 2"; pg.evaluate("window.__lightbox.close()")
        # 4. Löschen: Rückfrage (Abbrechen ändert nichts), dann Übernahme und Löschen
        pg.click("#fd-go"); pg.wait_for_selector(".sheet[aria-label='Doppelte Fotos löschen?']")
        assert "2 Fotos in 2 Gruppen" in pg.inner_text(".sheet[aria-label='Doppelte Fotos löschen?']")
        pg.click(".sheet[aria-label='Doppelte Fotos löschen?'] button:not(.pri)"); pg.wait_for_selector(".sheet[aria-label='Doppelte Fotos löschen?']", state="detached")
        assert pg.evaluate("DB.get('photos', 'dpb2222222').then(p => !!p)"), "ohne Bestätigung nichts gelöscht"
        leise(); pg.click("#fd-go"); pg.wait_for_selector(".sheet[aria-label='Doppelte Fotos löschen?']"); pg.click(".sheet[aria-label='Doppelte Fotos löschen?'] button.pri")
        tx = toast_text(pg, "gelöscht"); assert tx == "2 Fotos gelöscht · 2 MB frei · Angaben übernommen", tx
        r = pg.evaluate("""async tid => { const g = id => DB.get('photos', id); const d = await g('dpd4444444'), c = await g('dpc3333333');
          return { weg: [!(await g('dpb2222222')), !(await g('dpe5555555'))], note: d.note, lat: d.lat, fpx: d.fpx, cnote: c.note, vids: [!!(await g('dpv111111v')), !!(await g('dpv222222v'))],
            com: ((await DB.kvGet('comments', {}))['dpd4444444'] || []).map(x => x.text), comAlt: !!(await DB.kvGet('comments', {}))['dpb2222222'], bg: ((await DB.kvGet('tilebg', {}))[tid] || {}).ph, del: window.__dp.del.slice().sort() }; }""", tid)
        assert r["weg"] == [True, True] and r["note"] == "Gipfelblick" and r["lat"] == 47.615 and r["vids"] == [True, True], r
        assert "p1:5000:b0b0b0b0b0b0b0b0" in r["fpx"] and "p1:4096:dddddddddddddddd" not in (r["fpx"] or []), r
        assert r["com"] == ["Schöne Sicht"] and not r["comAlt"] and r["bg"] == "dpd4444444" and r["del"] == ["dpb2222222", "dpe5555555"], r
        pg.wait_for_function("() => !Nav._busy && document.querySelectorAll('.fd-g').length === 1", timeout=30000); assert pg.locator(".fd-g").count() == 1 and pg.inner_text("#fd-sum").startswith("1 Gruppe mit 2 Fotos"), pg.inner_text("#view")
        # Platz bei 360–430 px und 130 % Schrift
        bad += layout_check(pg, ["#/fotodoppelt/" + tid])
        # 5. Tourseite danach: Leiste zeigt genau die verbliebenen Fotos in Zeitfolge
        go(pg, "#/tour/" + tid, "#tphotos .strip .th")
        srcs = pg.eval_on_selector_all("#tphotos .strip .th img", "l => l.map(i => i.getAttribute('src'))")
        assert srcs == ["/thumb/dpd4444444.jpg", "/thumb/dpc3333333.jpg", "/thumb/dpv111111v.jpg", "/thumb/dpv222222v.jpg"], srcs
        # 6. Eingänge: Foto-Quellen und Import → Aufräumen; ohne Doppelte der leere Zustand
        go(pg, "#/sources", "#src-dup"); go(pg, "#/import", "#imp-fotodup")
        pg.evaluate("DB.del('photos', 'dpv222222v')")
        go(pg, "#/fotodoppelt/" + tid, ".empty"); assert "Keine doppelten Fotos gefunden" in pg.inner_text("#view")
        return bad
    finally:
        pg.unroute("**/thumb/dp*"); pg.unroute("**/photo/dp*")
        pg.evaluate("""async ([ids, tid]) => { for (const id of ids) await DB.del('photos', id); if (tid) { await Tours.remove(tid); const bg = await DB.kvGet('tilebg', {}); delete bg[tid]; await DB.kvSet('tilebg', bg); }
          const cm = await DB.kvGet('comments', {}); ids.forEach(id => delete cm[id]); await DB.kvSet('comments', cm); await Set_.set('fotoSkipDup', true); delete window.__pickPh;
          if (window.__dpcall0) { window.MTApp.call = window.__dpcall0; window.__dpcall0 = null; }
          window.__lightbox && window.__lightbox.close(); document.querySelectorAll('.sheet-back').forEach(e => e.remove()); sheet.stack = []; }""", [ids, tid])


MT_AN = "async () => { Set_.v.mtAktiv = true; await Set_.set('mtWahl', 'ja'); }"      # 2.15.0: Testhelfer – „Mit Meine Touren zusammenarbeiten“ an (die älteren Tests erwarten die Knöpfe)

MT_SPUREN_JS = """(extra) => {
  /* 2.15.0: Sucht auf der sichtbaren Seite und in offenen Blättern nach Berührungspunkten mit Meine Touren (Text, Beschriftungen, Knopf-Kennungen).
     Ausnahmen: die Einstellung selbst (#set-mt-box), die Quellenangabe einer Tour aus Meine Touren (#tsrc) und was der Aufrufer nennt. */
  const RX = /meine[\\s-]*touren|betrachter|tailscale|ts\\.net/i, out = [];
  const IDS = ['imp-mt', 'mt-senden-tour', 'mt-auto', 'mtsent', 'mtinfo', 'mt-zahlen', 'mt-senden', 'mt-go', 'mt-url', 'mt-off', 'mt-state', 'mt-viewer', 'fu-mt', 'fu-mt-go', 'mt-frage', 'send-zu-mt',
    'mt-abgleich-tour', 'mt-abgleich-alle', 'mt-abgleich-box', 'ab-sheet', 'ab-alle', 'ab-go', 'ab-a-go', 'ab-viewer', 'ab-ergebnis', 'send-pins', 'send-pins-box'];      // 2.18.0: Abgleich von Notizen/Fotos, Pins mitsenden
  const weg = '#tsrc, .quelle, #set-mt-box' + (extra ? ', ' + extra : '');
  for (const r of [document.querySelector('#view'), ...document.querySelectorAll('.sheet')]) {
    if (!r) continue;
    const c = r.cloneNode(true); c.querySelectorAll(weg).forEach(e => e.remove());
    const tx = c.textContent, m = tx.match(RX);
    if (m) out.push('Text „' + m[0] + '“: …' + tx.slice(Math.max(0, m.index - 50), m.index + 40).replace(/\\s+/g, ' ') + '…');
    c.querySelectorAll('*').forEach(e => { for (const a of ['aria-label', 'title', 'placeholder', 'value', 'href']) { const v = e.getAttribute(a); if (v && RX.test(v)) out.push(a + ' „' + v + '“'); }
      if (e.id && IDS.includes(e.id)) out.push('Kennung #' + e.id); });
  }
  return out;
}"""

def mt_spuren(pg, extra=""):
    return pg.evaluate(MT_SPUREN_JS, extra)

def erststart_2150(pg):
    """2.15.0: Erststart – ruhige Frage unter dem Willkommen (keine Blockade), sonst nichts von Meine Touren; „Nein“ wird gemerkt. Danach für die älteren Tests: an."""
    pg.wait_for_selector("#mt-frage")
    assert pg.evaluate("[Set_.get('mtAktiv'), Set_.get('mtWahl')]") == [False, "offen"], pg.evaluate("[Set_.get('mtAktiv'), Set_.get('mtWahl')]")
    assert "Nutzt du auch" in pg.inner_text("#mt-frage") and pg.locator("#mt-frage-nein").count() == 1 and pg.locator("#mt-frage-ja").count() == 1
    assert pg.locator(".sheet").count() == 0, "die Frage blockiert nichts"
    assert mt_spuren(pg, "#mt-frage") == [], mt_spuren(pg, "#mt-frage")
    for r in ("#/mehr", "#/settings", "#/import"):
        go(pg, r, "#view > *"); pg.wait_for_function("() => !Nav._busy"); pg.wait_for_timeout(300)
        assert mt_spuren(pg) == [], (r, mt_spuren(pg))
        if r == "#/settings": assert not pg.is_checked("#set-mt input") and pg.locator("#set-mt-box").count() == 1
    go(pg, "#/start", "#mt-frage"); pg.wait_for_function(LEISE, timeout=30000)
    pg.click("#mt-frage-nein"); assert "ganz für sich" in toast_text(pg, "für sich")
    pg.wait_for_selector("#mt-frage", state="detached")
    assert pg.evaluate("[Set_.get('mtAktiv'), Set_.get('mtWahl'), MT.aktiv()]") == [False, "nein", False]
    assert "Willkommen" in pg.inner_text("#view") and mt_spuren(pg) == [], mt_spuren(pg)
    pg.evaluate("Nav.render()"); pg.wait_for_function("() => !Nav._busy"); assert pg.locator("#mt-frage").count() == 0, "gemerkt: keine zweite Frage"
    pg.evaluate(MT_AN)

FU_MT_ANTWORT = {"format": "tourentagebuch-wanderfuehrer", "version": 1, "app": "Meine Touren 3.56.0", "erstellt": "2026-11-22T14:03:00+01:00",
    "buecher": [{"id": "mt-3f2a1b2c", "key": "Rother Testgebirge", "name": "Rother Testgebirge", "cover_v": None,
        "touren": [{"id": "t1", "ord": 1, "mt_id": 12, "title": "2 Tour 2", "km": 4.0, "up": 210, "f": "", "pts": {"la": [4752000, 50, 50], "lo": [1100000, 40, 40]},
                    "gewandert": [{"datum": "2026-11-19", "name": "Meine Runde am See"}]}]}]}

NETZ_WACHE = """() => {
  /* 2.15.0: Netz-Wächter – zählt jeden Aufruf an die Meine-Touren-Adresse (Native.http, fetch, XMLHttpRequest). __mtStub antwortet an Stelle des Servers. */
  const isMt = u => /mt\\.test/.test(String(u && u.url || u || ''));
  window.__netlog = []; window.__net0 = { http: Native.http, fetch: window.fetch, open: XMLHttpRequest.prototype.open };
  Native.http = async o => { if (isMt(o.url)) { window.__netlog.push((o.method || 'GET') + ' ' + o.url); if (window.__mtStub) return window.__mtStub(o); } return window.__net0.http(o); };
  window.fetch = function (u) { if (isMt(u)) window.__netlog.push('fetch ' + (u.url || u)); return window.__net0.fetch.apply(this, arguments); };
  XMLHttpRequest.prototype.open = function (m, u) { if (isMt(u)) window.__netlog.push('xhr ' + u); return window.__net0.open.apply(this, arguments); };
}"""
NETZ_WACHE_AUS = "() => { Native.http = window.__net0.http; window.fetch = window.__net0.fetch; XMLHttpRequest.prototype.open = window.__net0.open; delete window.__mtStub; delete window.__net0; }"

def mt_schalter_2150(pg):
    """2.15.0: Schalter „Mit Meine Touren zusammenarbeiten“. (a) Bei Aus auf jeder Ansicht kein Text und kein Knopf von Meine Touren (Ausnahmen: die Einstellung, die
    Quellenangabe einer Tour aus Meine Touren); (b) kein Netzaufruf an die Meine-Touren-Adresse, auch nicht beim automatischen Senden, Nachholen und Abgleich beim Öffnen;
    (c) Bestandsnutzer-Entscheidung; (d) Umschalten im Betrieb (Zahlen, Knöpfe, ohne Neustart); (e) Wanderführer aus Meine Touren holen (gestubbte Antwort im Serverformat)."""
    leise = lambda: pg.wait_for_function(LEISE, timeout=30000)
    bad = []
    vor = pg.evaluate("""async () => { const r = {}; for (const k of ['mt', 'zepp', 'komoot', 'mtOffen', 'abgleich']) r[k] = await DB.kvGet(k, null);
      r.set = { mtAuto: Set_.get('mtAuto'), autoAbgleich: Set_.get('autoAbgleich') }; return r; }""")
    pg.evaluate(NETZ_WACHE)
    ids = pg.evaluate("""async () => {
      await DB.del('kv', 'zepp'); await DB.del('kv', 'komoot');
      await DB.kvSet('mt', { base: 'https://mt.test', name: 'Volker', role: 'user', token: 'SITZUNG-2150', since: Date.now() });
      await Set_.set('mtAuto', true); await Set_.set('autoAbgleich', true); await DB.kvSet('abgleich', null); await DB.kvSet('mtOffen', []);
      const T0 = Date.UTC(2026, 9, 3, 8), pts = (n, la) => Array.from({ length: n }, (_, i) => ({ lat: la + i * 0.0006, lon: 11.3 + i * 0.0003, ele: 700 + 40 * Math.sin(i / 6), t: T0 + (la * 1e6 % 7) * 864e5 + i * 30000 }));
      const A = (await Tours.add({ name: 'Schalter A angeglichen', sport: 'hike', pts: pts(80, 46.1), src: 'file', force: true })).tour;
      Object.assign(A, { mtSent: Date.now(), zMt: 1, upMt: 999, downMt: 990, distMt: 12345, starsMt: 4 }); Tours.applyHoehe(A, Geo.stats(await Tours.points(A.id))); A.dist = 12345; await Tours.save(A);
      const B = (await Tours.add({ name: 'Schalter B von dort', sport: 'hike', pts: pts(60, 46.3), src: 'mt', srcId: 'mt:2150', force: true })).tour;
      B.mtId = '2150'; await Tours.save(B);
      const C = (await Tours.add({ name: 'Schalter C eigene', sport: 'hike', pts: pts(50, 46.5), src: 'rec', force: true })).tour;
      Tours.invalidate(); return { A: A.id, B: B.id, C: C.id }; }""")
    tour = lambda k: pg.evaluate("id => DB.get('tours', id)", ids[k])
    a0 = tour("A"); assert a0["up"] == 999 and a0["dist"] == 12345, a0

    # --- Ausschalten im Betrieb (Einstellungen): sofort, mit Meldung, ohne Löschen der Sitzung; Zahlen: eigene Rechnung ---
    go(pg, "#/settings", "#set-mt"); leise()
    assert pg.evaluate("document.querySelector('#view .pad').firstElementChild.id") == "set-mt-box", "Abschnitt ganz oben"
    assert pg.is_checked("#set-mt input") and "Ohne diese Option bleibt Mein Tourentagebuch ganz für sich." in pg.inner_text("#set-mt-box")
    pg.click("#set-mt"); assert "ganz für sich" in toast_text(pg, "für sich")
    pg.wait_for_function("() => !MT.aktiv() && Set_.get('mtWahl') === 'nein'")
    pg.wait_for_function("id => DB.get('tours', id).then(t => t.up !== 999 && t.dist !== 12345)", arg=ids["A"], timeout=30000)
    a1 = tour("A"); assert a1["zMt"] == 1 and a1["upMt"] == 999 and a1["distMt"] == 12345 and a1["starsMt"] == 4 and a1.get("upSrc") != "mt", a1      # Werte bleiben gespeichert
    assert pg.evaluate("DB.kvGet('mt', null).then(a => a && a.token)") == "SITZUNG-2150", "die Sitzung bleibt"
    assert not pg.is_checked("#set-mt input")
    pg.wait_for_function("() => !Import.Alles.busy && !Senden._busy"); pg.evaluate("window.__netlog.length = 0")      # ab hier zählt jeder Aufruf (ein Lauf von vor dem Ausschalten ist vorbei)
    leise()

    # (a) jede Ansicht ohne Meine Touren
    routes = ["#/start", "#/", "#/tour/" + ids["A"], "#/tour/" + ids["B"], "#/tour/" + ids["C"], "#/rec", "#/import", "#/sources", "#/photos", "#/fuehrer", "#/stats",
              "#/stats/rekorde", "#/stats/auswertung", "#/stats/ziele", "#/jahr", "#/mehr", "#/settings", "#/doppelt", "#/reisen", "#/plan"]
    for r in routes:
        pg.evaluate("h => { if (location.hash === h) Nav.render(); else location.hash = h; }", r)
        pg.wait_for_function("h => !Nav._busy && Nav.cur === '/' + (h.slice(2).split('/')[0] || '') && document.querySelector('#view').children.length > 0", arg=r); pg.wait_for_timeout(500)
        f = mt_spuren(pg)
        assert not f, (r, f)
        if r.startswith("#/tour/"):
            pg.click("header.top button[aria-label=Aktionen]"); pg.wait_for_selector(".sheet .menu"); f = mt_spuren(pg); zu(pg); assert not f, (r + " Menü", f)
    # Tour A: eigene Rechnung, Sterne ohne Herkunft; Tour B: Quelle bleibt als ehrliche Herkunft
    go(pg, "#/tour/" + ids["A"], "#rate .star"); assert pg.inner_text("#ratecap") == "4 von 5" and pg.locator("#mtinfo, #mtsent").count() == 0, pg.inner_text("#ratecap")
    go(pg, "#/tour/" + ids["B"], "#tsrc"); assert pg.inner_text("#tsrc").strip() == "· Meine Touren", pg.inner_text("#tsrc")
    go(pg, "#/mehr", "#m-import"); assert "Meine Touren" not in pg.inner_text("#m-import") and "Komoot" in pg.inner_text("#m-import")
    # „Alles abgleichen“: nur Meine Touren verbunden → kein Knopf, die Meldung nennt Meine Touren nicht
    assert pg.evaluate("Import.Alles.quellen().then(q => q.length)") == 0
    pg.evaluate("AllesUI.start()"); m = toast_text(pg, "noch keine Quelle"); assert "Meine Touren" not in m and "Komoot oder Zepp" in m, m
    leise()
    # mit Zepp verbunden: nur Zepp, ohne Meine-Touren-Zeile
    pg.evaluate("DB.kvSet('zepp', { token: 'z', viaToken: true })")
    assert pg.evaluate("Import.Alles.quellen().then(q => q.map(x => x.id))") == ["zepp"]
    go(pg, "#/import", "#all-go"); assert "Meine Touren" not in pg.inner_text("#all-src") and pg.locator("#imp-mt").count() == 0, pg.inner_text("#all-src")
    pg.evaluate("DB.del('kv', 'zepp')")

    # (b) kein Netzaufruf: automatisch senden nach Aufnahme-Ende, Nachholen, Abgleich beim Öffnen, Netzfunktionen selbst
    pg.evaluate("window.__mtStub = () => ({ status: 200, headers: {}, body: '[]' })")
    net = pg.evaluate("""async (ids) => {
      const C = await DB.get('tours', ids.C), acc = await DB.kvGet('mt', null), r = {};
      await DB.kvSet('mtOffen', [{ id: ids.C, n: 0 }]);
      await Senden.auto(C); await Senden.nachholen(); await autoAbgleich(); r.auto = await Import.Alles.auto();
      r.tours = await Import.MT.tours(acc).then(() => 'lief', e => e.aus ? 'aus' : e.message);
      r.holen = await Buecher.holeMt(acc, false).then(() => 'lief', e => /ausgeschaltet/.test(e.message) ? 'aus' : e.message);
      r.dialog = await Senden.dialog(C); r.konto = await MT.konto();
      r.offen = await DB.kvGet('mtOffen', []);
      return r; }""", ids)
    assert net["auto"] is None and net["tours"] == "aus" and net["holen"] == "aus" and net["dialog"] is None and net["konto"] is None, net
    assert net["offen"] == [{"id": ids["C"], "n": 0}], net      # nichts vorgemerkt, nichts abgearbeitet
    pg.wait_for_timeout(1500)
    assert pg.evaluate("window.__netlog") == [], pg.evaluate("window.__netlog")
    pg.evaluate("DB.kvSet('mtOffen', [])")

    # (c) Bestandsnutzer-Entscheidung beim ersten Start von 2.15.0; Sicherung überschreibt die Entscheidung des Geräts nicht
    mig = pg.evaluate("""async () => {
      const r = {}, st = () => [MT.aktiv(), Set_.get('mtWahl'), MT.frageOffen()];
      const neu = async (wahl, an) => { Set_.v.mtAktiv = an; await Set_.set('mtWahl', wahl); await MT.start(); return st(); };
      await DB.kvSet('mt', { base: 'https://mt.test', token: 'SITZUNG-2150' }); r.verbindung = await neu('', false);
      await DB.kvSet('mt', { base: 'https://mt.test', name: 'Volker' }); r.getrennt = await neu('', false);
      await DB.del('kv', 'mt'); r.touren = await neu('', false);
      const all0 = DB.all; DB.all = s => s === 'tours' ? Promise.resolve([]) : all0(s);
      try { r.nichts = await neu('', false); } finally { DB.all = all0; }
      await DB.kvSet('mt', { base: 'https://mt.test', token: 'SITZUNG-2150' }); r.gemerkt = await neu('nein', false);
      await Backup.restoreKv([{ k: 'settings', v: { mtAktiv: true, mtWahl: 'ja' } }]); r.sicherung = st();
      return r; }""")
    assert mig["verbindung"] == [True, "auto", False] and mig["getrennt"] == [True, "auto", False] and mig["touren"] == [True, "auto", False], mig
    assert mig["nichts"] == [False, "offen", True] and mig["gemerkt"] == [False, "nein", False] and mig["sicherung"] == [False, "nein", False], mig
    # die Frage auf der Startseite (mit Touren): „Ja“ schaltet ein, gemerkt
    pg.evaluate("Set_.set('mtWahl', 'offen')"); go(pg, "#/start", "#mt-frage"); leise()
    bad += layout_check(pg, ["#/start"])
    pg.click("#mt-frage-ja"); assert "eingeschaltet" in toast_text(pg, "eingeschaltet")
    pg.wait_for_selector("#mt-frage", state="detached"); assert pg.evaluate("[MT.aktiv(), Set_.get('mtWahl')]") == [True, "ja"]
    leise()

    # (d) An: alles wieder da, Zahlen aus Meine Touren wieder maßgeblich – ohne Neustart
    pg.wait_for_function("id => DB.get('tours', id).then(t => t.up === 999 && t.dist === 12345)", arg=ids["A"], timeout=30000)
    go(pg, "#/tour/" + ids["A"], "#mtinfo"); assert "aus Meine Touren" in pg.inner_text("#ratecap") and pg.locator("#mtsent").count() == 1
    go(pg, "#/tour/" + ids["C"], "#rate"); pg.click("header.top button[aria-label=Aktionen]"); pg.wait_for_selector("#mt-senden-tour"); zu(pg)
    go(pg, "#/tour/" + ids["B"], "#rate"); pg.click("header.top button[aria-label=Aktionen]"); pg.wait_for_selector("#mt-abgleich-tour"); assert pg.locator("#kp-menu").count() == 1; zu(pg)      # 2.18.0
    go(pg, "#/import", "#imp-mt"); pg.click("#imp-mt"); pg.wait_for_selector("#mt-abgleich-alle"); zu(pg)
    go(pg, "#/import", "#imp-mt"); go(pg, "#/mehr", "#m-import"); assert "Meine Touren" in pg.inner_text("#m-import")
    assert pg.evaluate("Import.Alles.quellen().then(q => q.map(x => x.id))") == ["mt"]
    # Aus über die Einstellung und gleich wieder an: die Importkarte verschwindet und kommt wieder, ohne Neuladen
    go(pg, "#/settings", "#set-mt"); pg.click("#set-mt"); toast_text(pg, "für sich"); go(pg, "#/import", "#view .list"); assert pg.locator("#imp-mt").count() == 0
    leise(); go(pg, "#/settings", "#set-mt"); pg.click("#set-mt"); toast_text(pg, "eingeschaltet"); go(pg, "#/import", "#imp-mt"); leise()

    # (e) Wanderführer aus Meine Touren holen
    pg.evaluate("""fx => { window.__fuReqs = []; window.__mtStub = o => { const u = new URL(o.url); if (u.pathname !== '/api/guides/export') return { status: 404, headers: {}, body: '{}' };
      window.__fuReqs.push({ url: o.url, method: o.method || 'GET', cookie: (o.headers || {}).Cookie || '', accept: (o.headers || {}).Accept || '' });
      if (window.__fuNetz) throw new Error('offline'); const s = window.__fuStatus || 200; return { status: s, headers: {}, body: s === 200 ? JSON.stringify(fx) : '{"detail":"x"}' }; }; }""", FU_MT_ANTWORT)
    pg.evaluate("window.__netlog.length = 0")
    go(pg, "#/fuehrer", "#fu-mt"); pg.click("#fu-mt"); pg.wait_for_selector("#fu-mt-go")
    assert not pg.is_checked("#fu-mt-cover input"), "Titelbilder: Vorgabe aus"
    bad += sheet_check_open(pg, "Wanderführer aus Meine Touren")
    pg.click("#fu-mt-go"); pg.wait_for_selector("#fu-im-sum")
    rq = pg.evaluate("window.__fuReqs"); assert len(rq) == 1 and rq[0]["url"] == "https://mt.test/api/guides/export" and rq[0]["method"] == "GET" and rq[0]["cookie"] == "kh_session=SITZUNG-2150" and rq[0]["accept"] == "application/json", rq
    assert pg.inner_text("#fu-im-sum").startswith("1 neues Buch") and pg.get_attribute(".sheet", "aria-label") == "Aus Meine Touren holen", pg.inner_text("#fu-im-sum")
    pg.click("#fu-im-ok"); toast_text(pg, "Übernommen")
    bk = pg.evaluate("Buecher.liste().then(l => l.filter(b => b.id === 'mt-3f2a1b2c').map(b => [b.name, b.touren.length, b.touren[0].title, b.touren[0].km, b.touren[0].up]))")
    assert bk == [["Rother Testgebirge", 1, "2 Tour 2", 4, 210]], bk
    assert pg.evaluate("Buecher.punkte('mt-3f2a1b2c').then(p => Object.values(p)[0] ? Object.values(p)[0].length : 0)") == 3
    leise()
    # mit Titelbildern: ?cover=1; zweites Mal nichts doppelt
    go(pg, "#/fuehrer", "#fu-mt"); pg.click("#fu-mt"); pg.wait_for_selector("#fu-mt-go"); pg.click("#fu-mt-cover"); pg.click("#fu-mt-go"); pg.wait_for_selector("#fu-im-sum")
    assert pg.evaluate("window.__fuReqs[1].url") == "https://mt.test/api/guides/export?cover=1" and "schon da" in pg.inner_text("#fu-im-sum"), pg.inner_text("#fu-im-sum")
    zu(pg)
    # Fehler: 404/403 → Version nötig; kein Netz → verständlich; 401 → Anmeldung abgelaufen, Knopf verschwindet
    for st, rx in ((404, "3\\.56\\.0"), (403, "3\\.56\\.0"), ("netz", "nicht erreichbar")):
        pg.evaluate("s => { window.__fuStatus = s === 'netz' ? 0 : s; window.__fuNetz = s === 'netz'; }", st); leise()
        go(pg, "#/fuehrer", "#fu-mt"); pg.click("#fu-mt"); pg.wait_for_selector("#fu-mt-go"); pg.click("#fu-mt-go"); m = toast_text(pg, rx)
        pg.wait_for_selector(".sheet", state="detached"); assert pg.locator("#fu-im-sum").count() == 0, (st, m)
    pg.evaluate("window.__fuStatus = 401; window.__fuNetz = false"); leise()
    go(pg, "#/fuehrer", "#fu-mt"); pg.click("#fu-mt"); pg.wait_for_selector("#fu-mt-go"); pg.click("#fu-mt-go")
    assert toast_text(pg, "abgelaufen") == "Die Anmeldung bei Meine Touren ist abgelaufen. Bitte neu anmelden."
    pg.wait_for_function("() => !Nav._busy && Nav.cur === '/fuehrer' && document.querySelector('#fu-xfer') && !document.querySelector('#fu-mt')")
    assert pg.evaluate("DB.kvGet('mt', null).then(a => [a.base, !!a.token])") == ["https://mt.test", False]
    assert all("mt.test" in u for u in pg.evaluate("window.__netlog"))
    leise()

    # aufräumen: Stubs zurück, Touren, Buch und Einstellungen wie vorher
    pg.evaluate(NETZ_WACHE_AUS)
    pg.evaluate("""async ([ids, vor]) => { for (const k of ['A', 'B', 'C']) await Tours.remove(ids[k]); await Buecher.entferne('mt-3f2a1b2c');
      for (const k of ['mt', 'zepp', 'komoot', 'mtOffen', 'abgleich']) { if (vor[k] == null) await DB.del('kv', k); else await DB.kvSet(k, vor[k]); }
      await Set_.set('mtAuto', vor.set.mtAuto); await Set_.set('autoAbgleich', vor.set.autoAbgleich); Set_.v.mtAktiv = true; await Set_.set('mtWahl', 'ja'); Tours.invalidate(); }""", [ids, vor])
    assert pg.evaluate("typeof window.__net0") == "undefined"
    return bad


AB_SERVER = """(cfg) => {
  /* 2.18.0: Meine Touren 3.57.0 nachgestellt – GET /api/tours/{id}/tagebuch, GET /api/tagebuch/uebersicht, POST /api/tours/{id}/notiz (Regel wie notiz_merge in
     tagebuch_abgleich.py, hier unabhängig nachgeschrieben), /api/tours (Liste), /api/record/upload (fürs Senden mit Pins); dazu die Hülle: mtNetz, Auftrag
     (mtAbgleichStart/Stand/Fortsetzen/Cancel/Verwerfen, 2.18.1), deletePhoto. Alles wird mitgeschrieben (window.__ab). */
  const A = window.__ab = { log: [], calls: [], notizPosts: [], uploads: [], wifi: true, tours: cfg.tours, geloescht: new Set(cfg.geloescht || []), darf: true, nextId: 900, vnext: 50 };
  const norm = s => String(s || '').replace(/\\r\\n/g, '\\n').replace(/\\r/g, '\\n').replace(/[ \\t]+\\n/g, '\\n').trim();
  const json = (st, o) => ({ status: st, headers: {}, body: JSON.stringify(o) });
  const stand = t => 's' + (t.notiz.geaendert || 0) + '-' + t.fotos.map(f => f.id).join('.') + '-' + t.videos.map(v => v.id).join('.');
  window.__mtStub = o => {
    const u = new URL(o.url), m = (o.method || 'GET').toUpperCase(), path = u.pathname; A.log.push(m + ' ' + path + u.search);
    if ((o.headers || {}).Cookie !== 'kh_session=SITZUNG-2180') return json(401, { detail: 'Nicht angemeldet' });
    let x;
    if (m === 'GET' && path === '/api/tagebuch/uebersicht') { const out = {}; (u.searchParams.get('ids') || '').split(',').forEach(id => { const t = A.tours[id]; if (t) out[id] = { fotos: t.fotos.length, videos: t.videos.length, notiz_geaendert: t.notiz.geaendert, notiz: !!t.notiz.text, stand: stand(t) }; }); return json(200, out); }
    if (m === 'GET' && (x = path.match(/^\\/api\\/tours\\/([^/]+)\\/tagebuch$/))) { const t = A.tours[decodeURIComponent(x[1])]; if (!t) return json(404, { detail: 'Tour nicht gefunden' });
      return json(200, { tour: { id: x[1], name: 'T', start_ts: 1 }, notiz: t.notiz, fotos: t.fotos, videos: t.videos, grenzen: { foto_mb: 40, video_mb: 200, video_tour_mb: 1024, breite_max: 2400, notiz_zeichen: 20000, heic: false }, darf_schreiben: A.darf }); }
    if (m === 'POST' && (x = path.match(/^\\/api\\/tours\\/([^/]+)\\/notiz$/))) {
      const t = A.tours[decodeURIComponent(x[1])], b = JSON.parse(o.body); A.notizPosts.push(b);
      if (!A.darf) return json(403, { detail: 'Dieser Zugang darf nur ansehen' });
      const cur = norm(t.notiz.text), neu = norm(b.text); let st, text = null;
      if (!neu) st = 'leer'; else if (neu === cur) st = 'gleich'; else if (!cur) { st = 'uebernommen'; text = neu; } else if (b.basis != null && t.notiz.geaendert != null && +b.basis === +t.notiz.geaendert) { st = 'uebernommen'; text = neu; }
      else if (cur.includes(neu)) st = 'schon_enthalten'; else if (neu.includes(cur)) { st = 'uebernommen'; text = neu; } else { st = 'zusammengefuehrt'; text = cur + '\\n\\n——— Aus Mein Tourentagebuch, 22.11.2026 14:05 ———\\n' + neu; }
      if (text != null) t.notiz = { text, geaendert: (t.notiz.geaendert || 0) + 1000 };
      return json(200, { status: st, konflikt: st === 'zusammengefuehrt', notiz: t.notiz }); }
    if (m === 'GET' && path === '/api/tours') return json(200, []);
    if (m === 'POST' && path === '/api/record/upload') { const b = JSON.parse(o.body); A.uploads.push(b); return json(200, { id: 'g' + (7000 + A.uploads.length), dup: false }); }
    if (m === 'POST' && /\\/(note|rating)$/.test(path)) return json(200, { ok: true });
    return json(404, { detail: 'Not Found' });
  };
  /* 2.18.1: Die Hülle arbeitet den Abgleich als Auftrag ab (MtAbgleich.java) – hier nachgestellt: Schritte nacheinander, Journal, Stand mit „ab“, Ende,
     Fortsetzen, Abbrechen, Verwerfen. Die einzelnen Schritte werden wie früher als mtFotoHolen/mtFotoSenden/mtVideoStart mitgeschrieben.
     Prüfhebel: A.schlaf (WebView angehalten: Stand liefert keine Ergebnisse), A.killNach (nach so vielen Ergebnissen „vom System beendet“, ohne Ende),
     A.langsam (ms je Schritt). */
  const tidOf = url => decodeURIComponent(new URL(url).pathname.split('/')[3]);
  const J = A.job = { plan: null, journal: [], running: false, ende: null, cancel: false, cookie: '', geholt: new Set() };
  const schritt = (t, ck) => {
    const o = Object.assign({}, t, { cookie: ck }); let r;
    if (t.art === 'notiz') { const x = window.__mtStub({ url: t.url, method: 'POST', headers: { Cookie: ck }, body: t.body }); return { status: x.status, body: x.body }; }
    if (t.art === 'stand') { const x = window.__mtStub({ url: t.url, headers: { Cookie: ck } }); return { status: x.status, body: x.body }; }
    if (ck !== 'kh_session=SITZUNG-2180') return { status: 401, body: '{"detail":"Nicht angemeldet"}' };
    if (t.art === 'foto-holen') { A.calls.push(['mtFotoHolen', o]); const pid = +new URL(o.url).pathname.split('/').pop(), f = A.tours[tidOf(o.url)].fotos.find(x => x.id === pid);
      r = f ? { status: 200, id: f.appId || ('h' + pid + 'aaaaaaaa'), name: o.name, ts: o.taken, lat: o.lat, lon: o.lng, w: 1600, h: 1200, src: 'meinetouren', exif: true, fp: 'p1:1:' + pid, fpd: 'p1:2:' + pid, size: 300000 } : { status: 404, body: '{"detail":"Foto nicht gefunden"}' };
      if (r.id) J.geholt.add(r.id); return r; }
    if (t.art === 'foto-senden') { if (J.geholt.has(o.id)) return { status: 200, uebersprungen: true };
      A.calls.push(['mtFotoSenden', o]); const tt = A.tours[tidOf(o.url)], f = o.fields;
      if (!A.darf) return { status: 403, body: '{"detail":"Dieser Zugang darf nur ansehen"}' };
      if (A.geloescht.has(f.ref) && f.force !== '1') return { status: 200, body: JSON.stringify({ status: 'geloescht', id: null }) };
      const v = tt.fotos.find(x => x.ref === f.ref); if (v) return { status: 200, body: JSON.stringify({ status: 'vorhanden', id: v.id, wie: 'kennung' }) };
      const nid = A.nextId++; tt.fotos.push({ id: nid, taken_ts: Math.round(+f.taken / 1000), lat: f.lat ? +f.lat : null, lng: f.lng ? +f.lng : null, size: 1, v: 'v' + nid, video: false, fp: null, sha1: 'x', ref: f.ref, name: f.name });
      return { status: 200, body: JSON.stringify({ status: 'neu', id: nid }) }; }
    const tt = A.tours[tidOf(o.url)];
    A.calls.push(['mtVideoStart', Object.assign({ mode: t.art === 'video-holen' ? 'holen' : 'senden', wifiOnly: J.plan.wifiOnly }, o)]);
    if (t.art === 'video-holen') { const vid = +new URL(o.url).pathname.split('/').pop(); return { status: 200, body: '', result: { id: 'vv' + vid + 'aaaaaaaaav', name: o.name, ts: o.taken, w: 640, h: 480, dur: 4000, video: true, src: 'meinetouren', size: 10 } }; }
    const nid = A.vnext++; tt.videos.push({ id: nid, taken_ts: 1, size: 10, v: 'w', video: true, ref: o.fields.ref, name: o.fields.name }); return { status: 200, body: JSON.stringify({ status: 'neu', id: nid }) };
  };
  const laufe = async () => {
    const tasks = J.plan.tasks, fertig = new Set(J.journal.map(x => x.i));
    for (let i = 0; i < tasks.length; i++) {
      if (fertig.has(i)) continue;
      await new Promise(r => setTimeout(r, A.langsam || 5));
      if (J.cancel) { J.ende = 'abgebrochen'; break; }
      if (A.killNach != null && J.journal.length >= A.killNach) { A.killNach = null; J.running = false; return; }      // vom System beendet: kein Ende
      const e = schritt(tasks[i], J.cookie); e.versuche = 1; J.journal.push({ i, e });
      if (e.status === 401) { J.ende = 'relogin'; break; } if (e.status === 403) { J.ende = 'verboten'; break; }
    }
    if (!J.ende) J.ende = 'fertig';
    J.running = false;
  };
  const c0 = window.MTApp.call; window.__abCall0 = c0;
  window.MTApp.call = (id, m, a) => {
    const o = JSON.parse(a || '{}');
    if (!/^mt(Netz|Abgleich(Start|Stand|Fortsetzen|Cancel|Verwerfen))$/.test(m) && m !== 'deletePhoto') return c0.call(window.MTApp, id, m, a);
    if (m !== 'mtAbgleichStand') A.calls.push([m, o]);
    let r;
    if (m === 'mtNetz') r = { wifi: A.wifi };
    else if (m === 'deletePhoto') r = true;
    else if (m === 'mtAbgleichStart') {
      if (J.running) r = { started: false, error: 'Es läuft schon ein Abgleich.' };
      else { J.plan = { jobId: o.jobId, wifiOnly: o.wifiOnly, wlanFotos: o.wlanFotos, tasks: JSON.parse(JSON.stringify(o.tasks)) }; J.journal = []; J.ende = null; J.cancel = false; J.cookie = o.cookie; J.geholt = new Set(); J.running = true; r = { started: true }; laufe(); }
    } else if (m === 'mtAbgleichFortsetzen') {
      if (!J.plan || J.running || (J.ende && J.ende !== 'wlan')) r = { started: false, error: 'Es gibt keinen unterbrochenen Abgleich.' };
      else { J.ende = null; J.cancel = false; J.cookie = o.cookie; J.running = true; r = { started: true }; laufe(); }
    } else if (m === 'mtAbgleichCancel') { J.cancel = true; r = true; }
    else if (m === 'mtAbgleichVerwerfen') { if (J.running) r = { ok: false }; else { J.plan = null; J.journal = []; J.ende = null; r = { ok: true }; } }
    else if (m === 'mtAbgleichStand') {
      if (!J.plan) r = { da: false, running: J.running };
      else { const ab = +o.ab || 0, sicht = A.schlaf ? [] : J.journal.slice(ab);
        r = { da: true, running: A.schlaf ? true : J.running, jobId: J.plan.jobId, n: J.plan.tasks.length, fertig: A.schlaf ? 0 : J.journal.length, zeilen: J.journal.length, ende: A.schlaf ? null : J.ende,
          ergebnisse: sicht.map(x => Object.assign({}, x.e, { i: x.i, a: J.plan.tasks[x.i] })), mehr: false, text: 'Schritt', pos: 0, bytesDone: 0, bytesTotal: 0, wartetWlan: false }; }
    }
    setTimeout(() => window.__mtcb(+id, true, JSON.stringify(r)), 5);
  };
}"""
AB_SERVER_AUS = "() => { window.MTApp.call = window.__abCall0; delete window.__abCall0; }"


def abgleich_2180(pg):
    """2.18.0 A/B/C: Notizen, Fotos und Videos mit Meine Touren abgleichen (Server und Hülle nachgestellt im Format von Meine Touren 3.57.0).
    Notiz: Lage, beide Fassungen, Vorschau der zusammengeführten Fassung, Holen/Senden/Beides, basis; Fotos: Vorschau „N dort / M hier / K vorhanden“, Holen mit mtPid und
    Duplikaten, Senden mit ref/taken/Ort, gelöschte nur mit „trotzdem senden“ (force); Videos nur mit Haken und Rückfrage, nur im WLAN; Betrachter: nur Holen;
    Sammel-Abgleich über die Übersicht (stand); Senden mit Pins und Notiz in der GPX (Schalter); Layout des Blatts. Stubs werden zurückgesetzt."""
    import xml.etree.ElementTree as ET
    leise = lambda: pg.wait_for_function(LEISE, timeout=30000)
    bad = []
    vor = pg.evaluate("async () => ({ mt: await DB.kvGet('mt', null), wlan: Set_.get('mtWlan'), mitNotiz: Set_.get('mtMitNotiz') })")
    T = 1782892800
    cfg = {"tours": {
        "g2180": {"notiz": {"text": "Im Browser ergänzt", "geaendert": 6}, "fotos": [
            {"id": 812, "taken_ts": T, "lat": 47.5, "lng": 11.25, "size": 412345, "v": "3f9a", "video": False, "fp": "c3c3", "sha1": "9b1e", "ref": "a1aaaaaaaaaaaaaaaaaa", "name": "IMG_1.jpg"},
            {"id": 814, "taken_ts": T + 600, "lat": 47.51, "lng": 11.26, "size": 500000, "v": "4a", "video": False, "fp": None, "sha1": None, "ref": None, "name": None},
            {"id": 817, "taken_ts": T + 900, "lat": None, "lng": None, "size": 380000, "v": "5b", "video": False, "fp": None, "sha1": None, "ref": None, "name": None},
            {"id": 818, "taken_ts": T + 1100, "lat": None, "lng": None, "size": 380000, "v": "6c", "video": False, "fp": None, "sha1": None, "ref": None, "name": None, "appId": "a9aaaaaaaaaaaaaaaaaa"}],
            "videos": [{"id": 3, "taken_ts": T + 1200, "lat": None, "lng": None, "size": 48123456, "v": "77aa", "video": True, "dur_ms": 42000, "sha1": "77aa", "ref": None, "name": "Video.mp4"}]},
        "g2181": {"notiz": {"text": "", "geaendert": None}, "fotos": [{"id": 830, "taken_ts": T + 86400 * 3, "lat": 47.6, "lng": 11.3, "size": 300000, "v": "x", "video": False, "fp": None, "sha1": None, "ref": None, "name": "Gipfel.jpg"}], "videos": []},
        "g2182": {"notiz": {"text": "Gleich", "geaendert": 9}, "fotos": [], "videos": []}},
        "geloescht": ["a4aaaaaaaaaaaaaaaaaa"]}
    pg.evaluate(NETZ_WACHE); pg.evaluate(AB_SERVER, cfg)
    ids = pg.evaluate("""async (T) => {
      await DB.kvSet('mt', { base: 'https://mt.test', name: 'Volker', role: 'user', token: 'SITZUNG-2180', since: Date.now() }); await Set_.set('mtWlan', true); await Set_.set('mtMitNotiz', true);
      const pts = (t0, n) => Array.from({ length: n }, (_, i) => ({ lat: 47.5 + i * 0.0002, lon: 11.25 + i * 0.0002, ele: 900 + i, t: t0 + i * 30000 }));
      const X = (await Tours.add({ name: 'Abgleich Gipfeltour', sport: 'hike', pts: pts(T * 1000, 80), src: 'file', force: true })).tour;
      Object.assign(X, { mtId: 'g2180', note: 'Vom Handy', noteMt: 'Alt', mtNotizBasis: 5 }); await Tours.save(X);
      const Y = (await Tours.add({ name: 'Abgleich Zweite', sport: 'hike', pts: pts((T + 86400 * 3) * 1000 - 60000, 40), src: 'mt', srcId: 'mt:g2181', force: true })).tour;
      Object.assign(Y, { note: 'Nur hier notiert' }); await Tours.save(Y);
      const Z = (await Tours.add({ name: 'Abgleich Dritte', sport: 'hike', pts: pts((T + 86400 * 6) * 1000, 40), src: 'file', force: true })).tour;
      Object.assign(Z, { mtId: 'g2182', note: 'Gleich', noteMt: 'Gleich', mtNotizBasis: 9 }); await Tours.save(Z);
      const ph = (id, ts, extra) => DB.put('photos', Object.assign({ id, name: id + '.jpg', ts, lat: 47.5, lon: 11.25, w: 4000, h: 3000, src: 'galerie', tour: X.id, pos: 'exif', note: '', size: 2500000 }, extra || {}));
      await ph('a1aaaaaaaaaaaaaaaaaa', T * 1000); await ph('a2aaaaaaaaaaaaaaaaaa', T * 1000 + 300000, { name: 'IMG_2.jpg' }); await ph('a4aaaaaaaaaaaaaaaaaa', T * 1000 + 400000, { mtGeloescht: true });
      await ph('a9aaaaaaaaaaaaaaaaaa', T * 1000 + 500000, { name: 'IMG_9.jpg' });      // gleiche Datei wie 818 dort (Hülle liefert diese Kennung): Duplikat
      await ph('b1b2c3d4e5f6a7b8c9dv', T * 1000 + 700000, { name: 'Video.mp4', video: true, size: 30 * 1048576, dur: 5000 });
      Tours.invalidate(); return { X: X.id, Y: Y.id, Z: Z.id }; }""", T)
    tour = lambda k: pg.evaluate("id => DB.get('tours', id)", ids[k])
    foto = lambda i: pg.evaluate("id => DB.get('photos', id)", i)
    calls = lambda m: pg.evaluate("m => window.__ab.calls.filter(c => c[0] === m).map(c => c[1])", m)
    menue = lambda k: (pg.evaluate("id => { location.hash = '#/tour/' + id; return Nav.render(); }", ids[k]), pg.wait_for_selector(".tourp h1"), pg.click("button[aria-label=Aktionen]"), pg.wait_for_selector(".sheet .menu"))
    try:
        # --- 1. Vorschau für Tour X: Notiz beide verschieden, Fotos 2 dort / 1 hier / 2 vorhanden (ref + gleiche Aufnahme 818 ist dort ohne ref → holen), Videos aus ---
        menue("X"); assert pg.locator("#mt-abgleich-tour").count() == 1 and pg.locator("#kp-menu").count() == 1
        pg.click("#mt-abgleich-tour"); pg.wait_for_selector("#ab-go")
        assert pg.inner_text("#ab-n-lage") == "Beide verschieden", pg.inner_text("#ab-n-lage")
        assert pg.evaluate("[document.querySelector('#ab-n-hier pre').textContent, document.querySelector('#ab-n-dort pre').textContent]") == ["Vom Handy", "Im Browser ergänzt"]
        neu = pg.locator("#ab-n-neu").inner_text()
        assert neu.startswith("Im Browser ergänzt\n\n——— Aus Mein Tourentagebuch, ") and neu.endswith(" ———\nVom Handy"), neu      # Vorschlag „Beides“: Server-Regel
        pg.click("#ab-notiz .seg button:has-text('Holen')"); neu = pg.locator("#ab-n-neu").inner_text()
        assert neu.startswith("Vom Handy\n\n——— Aus Meine Touren, ") and neu.endswith("———\nIm Browser ergänzt"), neu
        pg.click("#ab-notiz .seg button:has-text('Beides')")
        assert pg.inner_text("#ab-f-zahl") == "3 neue Fotos dort · 2 neu hier · 1 schon vorhanden", pg.inner_text("#ab-f-zahl")
        assert not pg.is_checked("#ab-videos input") and "nicht dabei" in pg.inner_text("#ab-v-info") and pg.locator("#ab-force").count() == 1 and not pg.is_checked("#ab-force input")
        assert pg.is_checked("#ab-wlan input")
        bad += sheet_check_open(pg, "Abgleich Tour")
        # dunkel
        pg.emulate_media(color_scheme="dark"); bad += sheet_check_open(pg, "Abgleich Tour dunkel"); pg.emulate_media(color_scheme="light")
        pg.click("#ab-go"); pg.wait_for_selector(".sheet[aria-label='Jetzt abgleichen?']")
        txt = pg.inner_text(".sheet[aria-label='Jetzt abgleichen?']"); assert "3 Foto(s) holen" in txt and "2 Foto(s) senden" in txt and "Video" not in txt, txt
        pg.click(".sheet[aria-label='Jetzt abgleichen?'] .btn.pri"); pg.wait_for_selector("#ab-ergebnis-t", timeout=30000)
        erg = pg.inner_text("#ab-ergebnis-t")
        assert erg.startswith("Notizen zusammengeführt · 2 Fotos geholt · 1 schon vorhanden · 1 Foto gesendet · 1 waren dort schon"), erg
        assert pg.locator("#ab-konflikt").count() == 1
        pg.click("#ab-fertig"); pg.wait_for_selector(".sheet", state="detached")
        assert calls("mtVideoStart") == [], "Videos nie ohne Haken"
        np = pg.evaluate("window.__ab.notizPosts"); assert np == [{"text": "Vom Handy", "basis": 5}], np
        x = tour("X"); srvn = pg.evaluate("window.__ab.tours.g2180.notiz")
        assert x["note"] == srvn["text"] and x["noteMt"] == srvn["text"] and x["mtNotizBasis"] == srvn["geaendert"] == 1006 and x["mtStand"].startswith("s1006-"), (x["note"], x.get("mtStand"), srvn)
        h814 = foto("h814aaaaaaaa"); h817 = foto("h817aaaaaaaa")
        assert h814["tour"] == ids["X"] and h814["mtPid"] == 814 and h814["src"] == "meinetouren" and h814["ts"] == (T + 600) * 1000 and h814["lat"] == 47.51 and h814["pos"] == "exif", h814
        assert h817["mtPid"] == 817 and h817["pos"] == "track" and h817["lat"] is not None, h817      # ohne Ort am Server: Ort aus der Spur
        assert foto("a9aaaaaaaaaaaaaaaaaa")["mtPid"] == 818, "Duplikat: vorhandenes Foto verknüpft statt doppelt"
        hol = calls("mtFotoHolen"); assert [h["url"] for h in hol] == ["https://mt.test/api/tours/g2180/tagebuch/photo/814?w=1600&v=4a", "https://mt.test/api/tours/g2180/tagebuch/photo/817?w=1600&v=5b", "https://mt.test/api/tours/g2180/tagebuch/photo/818?w=1600&v=6c"], hol
        assert all(h["cookie"] == "kh_session=SITZUNG-2180" for h in hol) and hol[0]["taken"] == (T + 600) * 1000 and hol[0]["lat"] == 47.51
        snd = calls("mtFotoSenden"); assert len(snd) == 1 and snd[0]["id"] == "a2aaaaaaaaaaaaaaaaaa" and snd[0]["maxPx"] == 2200 and snd[0]["url"] == "https://mt.test/api/tours/g2180/photo", snd
        f = snd[0]["fields"]; assert f["ref"] == "a2aaaaaaaaaaaaaaaaaa" and f["taken"] == str((T * 1000 + 300000)) and f["lat"] == "47.5" and f["lng"] == "11.25" and f["name"] == "IMG_2.jpg" and "force" not in f and re.fullmatch(r"[+-]\d\d:\d\d", f["offset"]), f
        assert foto("a2aaaaaaaaaaaaaaaaaa")["mtPid"] == 900 and foto("a4aaaaaaaaaaaaaaaaaa").get("mtPid") is None
        leise()

        # --- 2. Zweiter Abgleich: Notiz gleich; gelöschte nur mit „trotzdem senden“; Videos nur mit Haken + Rückfrage; ohne WLAN nicht ---
        pg.evaluate("window.__ab.calls.length = 0; window.__ab.notizPosts.length = 0")
        menue("X"); pg.click("#mt-abgleich-tour"); pg.wait_for_selector("#ab-go")
        assert pg.inner_text("#ab-n-lage").startswith("Gleich") and pg.locator("#ab-notiz .seg").count() == 0
        assert pg.inner_text("#ab-f-zahl") == "0 neue Fotos dort · 0 neu hier · 5 schon vorhanden", pg.inner_text("#ab-f-zahl")
        pg.click("#ab-videos"); pg.wait_for_function("() => /1 dort neu/.test(document.querySelector('#ab-v-info').textContent)")
        assert "1 hier neu (30 MB)" in pg.inner_text("#ab-v-info") and "46 MB" in pg.inner_text("#ab-v-info"), pg.inner_text("#ab-v-info")
        pg.evaluate("window.__ab.wifi = false")
        pg.click("#ab-go"); pg.wait_for_selector(".sheet[aria-label='Auch Videos übertragen?']")
        txt = pg.inner_text(".sheet[aria-label='Auch Videos übertragen?']"); assert "2 Video(s) bis 46 MB" in txt and "nur im WLAN" in txt, txt
        pg.click(".sheet[aria-label='Auch Videos übertragen?'] .btn.pri"); m = toast_text(pg, "Kein WLAN"); assert calls("mtVideoStart") == [], m
        pg.wait_for_selector(".sheet", state="detached"); leise()
        pg.evaluate("window.__ab.wifi = true")
        menue("X"); pg.click("#mt-abgleich-tour"); pg.wait_for_selector("#ab-go"); pg.click("#ab-force")
        assert "0 neue Fotos dort · 1 neu hier" in pg.inner_text("#ab-f-zahl"), pg.inner_text("#ab-f-zahl")
        pg.click("#ab-videos"); pg.click("#ab-go"); pg.wait_for_selector(".sheet[aria-label='Auch Videos übertragen?']"); pg.click(".sheet[aria-label='Auch Videos übertragen?'] .btn.pri")
        pg.wait_for_selector("#ab-ergebnis-t", timeout=30000); erg = pg.inner_text("#ab-ergebnis-t")
        assert "1 Foto gesendet" in erg and "2 Videos übertragen" in erg, erg
        snd = calls("mtFotoSenden"); assert len(snd) == 1 and snd[0]["fields"]["force"] == "1" and snd[0]["id"] == "a4aaaaaaaaaaaaaaaaaa", snd
        vs = calls("mtVideoStart"); assert [v["mode"] for v in vs] == ["holen", "senden"] and all(v["wifiOnly"] is True for v in vs), vs
        assert vs[0]["url"] == "https://mt.test/api/tours/g2180/tagebuch/video/3?video=1" and vs[1]["fields"]["bestaetigt"] == "1" and vs[1]["fields"]["ref"] == "b1b2c3d4e5f6a7b8c9dv" and vs[1]["fields"]["dur_ms"] == "5000", vs
        assert foto("vv3aaaaaaaaav")["video"] is True and foto("vv3aaaaaaaaav")["mtPid"] == 3 and foto("b1b2c3d4e5f6a7b8c9dv")["mtPid"] == 50 and foto("a4aaaaaaaaaaaaaaaaaa").get("mtGeloescht") is None
        assert pg.evaluate("window.__ab.notizPosts") == [], "gleiche Notiz: nichts gesendet"
        pg.click("#ab-fertig"); pg.wait_for_selector(".sheet", state="detached"); leise()

        # --- 3. Betrachter: nur Holen, kein Senden-Knopf, Hinweis; nichts geht schreibend an den Server ---
        pg.evaluate("async () => { window.__ab.darf = false; window.__ab.calls.length = 0; const a = await DB.kvGet('mt', null); a.role = 'viewer'; await DB.kvSet('mt', a); }")
        menue("Y"); pg.click("#mt-abgleich-tour"); pg.wait_for_selector("#ab-go")
        assert "darf nur ansehen" in pg.inner_text("#ab-viewer") and pg.locator("#ab-sheet .seg button:has-text('Senden')").count() == 0 and pg.locator("#ab-sheet .seg button:has-text('Beides')").count() == 0
        assert pg.inner_text("#ab-n-lage") == "Notiz nur hier" and pg.inner_text("#ab-f-zahl").startswith("1 neues Foto dort"), pg.inner_text("#ab-f-zahl")
        pg.click("#ab-go"); pg.wait_for_selector(".sheet[aria-label='Jetzt abgleichen?']"); pg.click(".sheet[aria-label='Jetzt abgleichen?'] .btn.pri"); pg.wait_for_selector("#ab-ergebnis-t", timeout=30000)
        assert "1 Foto geholt" in pg.inner_text("#ab-ergebnis-t") and calls("mtFotoSenden") == [] and pg.evaluate("window.__ab.notizPosts") == [], pg.inner_text("#ab-ergebnis-t")
        assert tour("Y")["note"] == "Nur hier notiert"
        pg.click("#ab-fertig"); pg.wait_for_selector(".sheet", state="detached")
        pg.evaluate("async () => { window.__ab.darf = true; const a = await DB.kvGet('mt', null); a.role = 'user'; await DB.kvSet('mt', a); }"); leise()

        # --- 4. Sammel-Abgleich (Touren importieren → Meine Touren): Übersicht, nur Touren mit Neuem; Tour Z unverändert wird nicht gelesen ---
        pg.evaluate("async id => { const t = await DB.get('tours', id); t.mtStand = 's9--'; await Tours.save(t); window.__ab.log.length = 0; window.__ab.calls.length = 0; }", ids["Z"])
        go(pg, "#/import", "#imp-mt"); pg.click("#imp-mt"); pg.wait_for_selector("#mt-abgleich-alle"); pg.click("#mt-abgleich-alle")
        pg.wait_for_selector("#ab-a-go", timeout=30000)
        log = pg.evaluate("window.__ab.log"); assert log[0].startswith("GET /api/tagebuch/uebersicht?ids=") and "GET /api/tours/g2182/tagebuch" not in log and "GET /api/tours/g2181/tagebuch" in log, log
        assert pg.inner_text("#ab-a-zahl") == "1 Tour hat Neues." and "Abgleich Zweite" in pg.inner_text("#ab-a-liste") and "Notiz nur hier" in pg.inner_text("#ab-a-liste"), pg.inner_text("#ab-alle")
        bad += sheet_check_open(pg, "Sammel-Abgleich")
        pg.click("#ab-a-go"); pg.wait_for_selector(".sheet[aria-label='Jetzt abgleichen?']"); pg.click(".sheet[aria-label='Jetzt abgleichen?'] .btn.pri"); pg.wait_for_selector("#ab-ergebnis-t", timeout=30000)
        assert pg.inner_text("#ab-ergebnis-t").startswith("Notiz übernommen"), pg.inner_text("#ab-ergebnis-t")
        assert pg.evaluate("window.__ab.tours.g2181.notiz.text") == "Nur hier notiert" and tour("Y")["mtNotizBasis"] == 1000
        pg.click("#ab-fertig"); pg.wait_for_selector("#mt-abgleich-alle"); zu(pg); leise()      # danach wieder das Blatt „Meine Touren“
        # nochmal: alles gleich
        go(pg, "#/import", "#imp-mt"); pg.click("#imp-mt"); pg.wait_for_selector("#mt-abgleich-alle"); pg.click("#mt-abgleich-alle"); assert "nichts abzugleichen" in toast_text(pg, "nichts abzugleichen"); leise()

        # --- 5. Senden mit Pins und Notiz (C): Wegpunkte mit Zeit/Text, Notiz als desc; Schalter aus: nur die Spur wie bisher ---
        sid = pg.evaluate("""async () => { const pts = Array.from({ length: 40 }, (_, i) => ({ lat: 47.2 + i * 0.0003, lon: 11.1, ele: 700 + i, t: Date.UTC(2027, 4, 1, 8) + i * 30000 }));
          const t = (await Tours.add({ name: 'Pin-Tour', sport: 'hike', pts, src: 'rec', force: true })).tour;
          Object.assign(t, { note: 'Notiz <mit> & Zeichen', pins: [{ id: 'p1', ts: Date.UTC(2027, 4, 1, 8, 5), lat: 47.21, lon: 11.1, text: 'Quelle am Weg' }, { id: 'p2', ts: Date.UTC(2027, 4, 1, 8, 10), lat: null, lon: null, text: 'Bank mit Aussicht' }] });
          await Tours.save(t); return t.id; }""")
        pg.evaluate("id => { location.hash = '#/tour/' + id; return Nav.render(); }", sid); pg.wait_for_selector(".tourp h1"); pg.click("button[aria-label=Aktionen]"); pg.wait_for_selector("#mt-senden-tour")
        pg.click("#mt-senden-tour"); pg.wait_for_selector("#send-pins"); assert pg.is_checked("#send-pins input")
        pg.click("#send-ja"); toast_text(pg, "gesendet")
        g = pg.evaluate("window.__ab.uploads[0].gpx"); root = ET.fromstring(g.encode("utf-8")); ns = {"g": "http://www.topografix.com/GPX/1/1"}
        w = root.findall("g:wpt", ns)
        assert [x.find("g:name", ns).text for x in w] == ["Quelle am Weg", "Bank mit Aussicht"] and w[0].find("g:time", ns).text == "2027-05-01T08:05:00Z" and abs(float(w[1].get("lat")) - 47.2060) < 0.001, g[:600]
        assert root.find("g:metadata/g:desc", ns).text == "Notiz <mit> & Zeichen" and root.find("g:trk/g:desc", ns).text == "Notiz <mit> & Zeichen" and len(root.findall(".//g:trkpt", ns)) == 40
        leise()
        sid2 = pg.evaluate("""async () => { const pts = Array.from({ length: 30 }, (_, i) => ({ lat: 46.2 + i * 0.0003, lon: 10.1, ele: 700, t: Date.UTC(2027, 4, 3, 8) + i * 30000 }));
          const t = (await Tours.add({ name: 'Pin-Tour 2', sport: 'hike', pts, src: 'rec', force: true })).tour; Object.assign(t, { note: 'n', pins: [{ id: 'q', ts: Date.UTC(2027, 4, 3, 8, 2), lat: 46.2, lon: 10.1, text: 'x' }] }); await Tours.save(t); return t.id; }""")
        pg.evaluate("id => { location.hash = '#/tour/' + id; return Nav.render(); }", sid2); pg.wait_for_selector(".tourp h1"); pg.click("button[aria-label=Aktionen]"); pg.wait_for_selector("#mt-senden-tour")
        pg.click("#mt-senden-tour"); pg.wait_for_selector("#send-pins"); bad += sheet_check_open(pg, "Senden mit Pins"); pg.click("#send-pins"); assert not pg.is_checked("#send-pins input")
        pg.click("#send-ja"); toast_text(pg, "gesendet")
        g2 = pg.evaluate("window.__ab.uploads[1].gpx"); assert "<wpt" not in g2 and "<desc>" not in g2 and "<metadata>" not in g2, g2[:300]
        assert pg.evaluate("Set_.get('mtMitNotiz')") is False and not any(l.endswith("/note") and "7002" in l for l in pg.evaluate("window.__ab.log")), "ohne Schalter keine Notiz"
        leise()

        # --- 7. 2.18.1: Bildschirm aus / Dienst beendet. Der Auftrag läuft in der Hülle weiter, auch wenn die Oberfläche nichts abholt (A.schlaf); die Ergebnisse
        #     werden danach vollständig übernommen. Hinweis zur Akku-Optimierung beim Start (mit beiden Knöpfen). Vom System beendet → „Abgleich fortsetzen?“,
        #     danach nur die offenen Schritte. Beim nächsten Öffnen (pruefeOffen) werden gepufferte Ergebnisse übernommen, auch bei „Nicht fortsetzen“. ---
        pg.evaluate("""() => { window.__akku = { opt: 0, app: 0 }; window.__ab7 = { bat: MTApp.openBatterySettings, frei: MTApp.batteryUnrestricted, det: MTApp.openAppDetails };
          MTApp.batteryUnrestricted = () => false; MTApp.openBatterySettings = () => { window.__akku.opt++; }; MTApp.openAppDetails = () => { window.__akku.app++; };
          const g = window.__ab.tours.g2180; for (const id of [840, 841, 842, 843, 844, 845, 846]) g.fotos.push({ id, taken_ts: 1782892800 + 4000 + (id - 840) * 60, lat: 47.52, lng: 11.27, size: 300000, v: 'n' + id, video: false, fp: null, sha1: null, ref: null, name: null });
          g.fotos_spaeter = g.fotos.splice(g.fotos.length - 4, 4); window.__ab.calls.length = 0; window.__ab.schlaf = true; window.__ab.langsam = 1200; }""")
        menue("X"); pg.click("#mt-abgleich-tour"); pg.wait_for_selector("#ab-go")
        assert pg.inner_text("#ab-f-zahl").startswith("3 neue Fotos dort"), pg.inner_text("#ab-f-zahl")
        pg.click("#ab-go"); pg.wait_for_selector(".sheet[aria-label='Jetzt abgleichen?']"); pg.click(".sheet[aria-label='Jetzt abgleichen?'] .btn.pri")
        pg.wait_for_selector("#ab-lauf #ab-akku"); assert "Autostart" in pg.inner_text("#ab-akku") and "Keine Einschränkungen" in pg.inner_text("#ab-akku"), pg.inner_text("#ab-akku")
        bad += sheet_check_open(pg, "Abgleich läuft (Akku-Hinweis)")
        pg.click("#ab-akku-opt"); pg.click("#ab-akku-app"); assert pg.evaluate("window.__akku") == {"opt": 1, "app": 1}
        st = pg.evaluate("Native.json('mtAbgleichStart', { jobId: 'x', tasks: [{ art: 'stand' }] })"); assert st["started"] is False, "zweiter Auftrag während einer läuft"
        pg.wait_for_function("() => !window.__ab.job.running && window.__ab.job.ende === 'fertig'", timeout=30000)      # die Hülle ist fertig, die Oberfläche hat noch nichts abgeholt
        assert foto("h840aaaaaaaa") is None and len(calls("mtFotoHolen")) == 3, "noch nicht übernommen"
        pg.evaluate("window.__ab.schlaf = false")      # Bildschirm wieder an
        pg.wait_for_selector("#ab-ergebnis-t", timeout=30000); erg = pg.inner_text("#ab-ergebnis-t"); assert erg.startswith("3 Fotos geholt"), erg
        assert all(foto(f"h{i}aaaaaaaa")["mtPid"] == i and foto(f"h{i}aaaaaaaa")["tour"] == ids["X"] for i in (840, 841, 842))
        assert any(c[0] == "mtAbgleichVerwerfen" for c in pg.evaluate("window.__ab.calls")) and pg.evaluate("window.__ab.job.plan") is None and pg.evaluate("DB.kvGet('mtAbgleichLauf', null)") is None
        pg.click("#ab-fertig"); pg.wait_for_selector(".sheet", state="detached"); leise()
        # vom System beendet nach einem Schritt → fortsetzen; nur die offenen Schritte laufen, das erste Foto wird nicht noch einmal geholt
        pg.evaluate("() => { const g = window.__ab.tours.g2180; g.fotos.push(g.fotos_spaeter.shift(), g.fotos_spaeter.shift()); window.__ab.calls.length = 0; window.__ab.langsam = 5; window.__ab.killNach = 1; MTApp.batteryUnrestricted = () => true; }")
        menue("X"); pg.click("#mt-abgleich-tour"); pg.wait_for_selector("#ab-go"); pg.click("#ab-go"); pg.wait_for_selector(".sheet[aria-label='Jetzt abgleichen?']"); pg.click(".sheet[aria-label='Jetzt abgleichen?'] .btn.pri")
        pg.wait_for_selector("#ab-weiter-ja", timeout=30000); t = pg.inner_text("#ab-weiter-t"); assert "1 von 3 Schritten" in t and "unterbrochen" in t, t
        assert pg.locator("#ab-weiter #ab-akku").count() == 0, "Akku frei: kein Hinweis"
        bad += sheet_check_open(pg, "Abgleich fortsetzen")
        assert foto("h843aaaaaaaa")["mtPid"] == 843 and foto("h844aaaaaaaa") is None, "erstes Ergebnis schon übernommen"
        pg.click("#ab-weiter-ja"); pg.wait_for_selector("#ab-ergebnis-t", timeout=30000); erg = pg.inner_text("#ab-ergebnis-t")
        assert erg.startswith("2 Fotos geholt"), erg
        hol = [c["pid"] for c in calls("mtFotoHolen")]; assert hol == [843, 844], hol
        fo = calls("mtAbgleichFortsetzen"); assert len(fo) == 1 and fo[0]["cookie"] == "kh_session=SITZUNG-2180", fo
        assert foto("h844aaaaaaaa")["mtPid"] == 844 and ".844-" in tour("X")["mtStand"], tour("X").get("mtStand")
        pg.click("#ab-fertig"); pg.wait_for_selector(".sheet", state="detached"); leise()
        # Auftrag lief, die App war zu (Oberfläche neu): beim Öffnen gepufferte Ergebnisse übernehmen; „Nicht fortsetzen“ verwirft den Rest
        pg.evaluate("""async id => { const g = window.__ab.tours.g2180; g.fotos.push(...g.fotos_spaeter.splice(0)); window.__ab.calls.length = 0; window.__ab.killNach = 1;
          const t = await DB.get('tours', id), neu = g.fotos.filter(f => f.id === 845 || f.id === 846);
          const tasks = MedienCalc.auftrag([{ t, id: 'g2180', notiz: 'nichts', a: { holen: neu, senden: [], videosHolen: [], videosSenden: [] }, r: { videos: [] } }], 'https://mt.test');
          await Native.json('mtAbgleichStart', { jobId: 'ab-test-offen', cookie: 'kh_session=SITZUNG-2180', wifiOnly: true, tasks }); }""", ids["X"])
        pg.wait_for_function("() => !window.__ab.job.running", timeout=30000)
        assert foto("h845aaaaaaaa") is None
        pg.evaluate("() => { MedienAbgleich.pruefeOffen(); }"); pg.wait_for_selector("#ab-weiter-nein", timeout=30000)      # wie beim Öffnen der App (wartet nicht auf die Antwort)
        assert foto("h845aaaaaaaa")["mtPid"] == 845 and "1 von 3 Schritten" in pg.inner_text("#ab-weiter-t"), pg.inner_text("#ab-weiter-t")
        pg.click("#ab-weiter-nein"); pg.wait_for_selector("#ab-ergebnis-t"); erg = pg.inner_text("#ab-ergebnis-t")
        assert erg.startswith("1 Foto geholt") and "abgebrochen" in erg, erg
        assert foto("h846aaaaaaaa") is None and pg.evaluate("window.__ab.job.plan") is None and [c["pid"] for c in calls("mtFotoHolen")] == [845]
        pg.click("#ab-fertig"); pg.wait_for_selector(".sheet", state="detached"); leise()
        assert pg.evaluate("MedienAbgleich.pruefeOffen()") is None and pg.locator(".sheet").count() == 0, "nichts mehr offen"
        # Abbrechen: der Auftrag endet mit „abgebrochen“ und wird nicht zum Fortsetzen angeboten
        pg.evaluate("() => { window.__ab.tours.g2180.fotos.push({ id: 847, taken_ts: 1782892800 + 4000 + 7 * 60, lat: null, lng: null, size: 1, v: 'n847', video: false, fp: null, sha1: null, ref: null, name: null }); window.__ab.langsam = 400; window.__ab.calls.length = 0; }")
        menue("X"); pg.click("#mt-abgleich-tour"); pg.wait_for_selector("#ab-go"); pg.click("#ab-go"); pg.wait_for_selector(".sheet[aria-label='Jetzt abgleichen?']"); pg.click(".sheet[aria-label='Jetzt abgleichen?'] .btn.pri")
        pg.wait_for_selector("#ab-p-stop"); pg.click("#ab-p-stop"); pg.wait_for_selector("#ab-ergebnis-t", timeout=30000)
        assert "abgebrochen" in pg.inner_text("#ab-ergebnis-t") and calls("mtFotoHolen") == [] and pg.locator("#ab-weiter").count() == 0, pg.inner_text("#ab-ergebnis-t")
        pg.click("#ab-fertig"); pg.wait_for_selector(".sheet", state="detached"); leise()
        pg.evaluate("() => { window.__ab.langsam = 5; MTApp.openBatterySettings = window.__ab7.bat; if (window.__ab7.frei) MTApp.batteryUnrestricted = window.__ab7.frei; else delete MTApp.batteryUnrestricted; if (window.__ab7.det) MTApp.openAppDetails = window.__ab7.det; else delete MTApp.openAppDetails; }")

        # --- 6. MT aus: kein Eintrag, kein Knopf, kein Netzaufruf – das Komoot-Paket bleibt ---
        pg.evaluate("async () => { Set_.v.mtAktiv = false; await Set_.set('mtWahl', 'nein'); window.__netlog.length = 0; window.__ab.calls.length = 0; }")
        menue("X"); assert pg.locator("#mt-abgleich-tour").count() == 0 and pg.locator("#kp-menu").count() == 1 and mt_spuren(pg) == [], mt_spuren(pg); zu(pg)
        r = pg.evaluate("async id => { const t = await DB.get('tours', id); return [await MedienAbgleich.tour(t), await MedienAbgleich.alle()]; }", ids["X"])
        assert r == [None, None] and pg.evaluate("window.__netlog") == [] and pg.evaluate("window.__ab.calls") == [], (r, pg.evaluate("window.__netlog"))
        pg.evaluate("async () => { Set_.v.mtAktiv = true; await Set_.set('mtWahl', 'ja'); }")
    finally:
        pg.evaluate(AB_SERVER_AUS); pg.evaluate(NETZ_WACHE_AUS)
        pg.evaluate("""async ([ids, vor]) => { for (const k of Object.keys(ids)) await Tours.remove(ids[k]);
          for (const t of await Tours.list()) if (/^Pin-Tour/.test(t.name)) await Tours.remove(t.id);
          for (const p of await DB.all('photos')) if (/^(a[1249]a{18}|b1b2c3d4e5f6a7b8c9dv|h8\\d\\daaaaaaaa|vv3a+v)$/.test(p.id)) await DB.del('photos', p.id);
          await DB.del('kv', 'mtAbgleichLauf');
          if (vor.mt == null) await DB.del('kv', 'mt'); else await DB.kvSet('mt', vor.mt); await Set_.set('mtWlan', vor.wlan); await Set_.set('mtMitNotiz', vor.mitNotiz); Set_.v.mtAktiv = true; await Set_.set('mtWahl', 'ja'); Tours.invalidate(); }""", [ids, vor])
    return bad


def kp_jpg(w, h, farbe, gps=True):
    """JPEG mit EXIF (Kamera, Aufnahmezeit und – wenn gps – GPS-Position), wie ein Foto vom Handy."""
    import io as _io
    from PIL import Image as _Im
    im = _Im.new("RGB", (w, h), farbe)
    for x in range(0, w, 97): im.paste((255 - farbe[0], 80, 40), (x, 0, min(w, x + 20), h))
    ex = _Im.Exif(); ex[0x0110] = "Testkamera"; ex[0x0132] = "2026:10:03 10:15:00"
    if gps: ex[0x8825] = {1: "N", 2: (47.0, 30.0, 0.0), 3: "E", 4: (11.0, 15.0, 0.0)}
    b = _io.BytesIO(); im.save(b, "JPEG", quality=80, exif=ex.tobytes()); return b.getvalue()


def komootpaket_2180(pg):
    """2.18.0 D: Komoot-Paket im Tourmenü – auch bei „Mit Meine Touren zusammenarbeiten“ aus. Fotoauswahl mit Vorschaubildern (Vorgabe: keine; Gesicht nie vorgewählt,
    mit Hinweis; „Alle ohne Gesicht“), ZIP lesen: GPX mit Pins (wpt) und Notiz (desc), notiz.txt, README, manifest, nur gewählte Fotos, verkleinert auf 2000 px, EXIF-GPS
    entfernt (Zeit bleibt), mit „Ort im Foto behalten“ GPS drin; gespeichert in Download/Tourentagebuch, Teilen; Layout hell und dunkel."""
    import base64, io as _io, zipfile
    import xml.etree.ElementTree as ET
    from PIL import Image as _Im
    leise = lambda: pg.wait_for_function(LEISE, timeout=30000)
    bad = []
    bilder = {"kp1aaaaaaaaaaaaaaaaa": kp_jpg(3000, 2000, (40, 120, 200)), "kp2aaaaaaaaaaaaaaaaa": kp_jpg(1200, 1600, (200, 160, 40)), "kp3aaaaaaaaaaaaaaaaa": kp_jpg(2400, 1800, (90, 200, 90))}
    def foto_route(r):
        pid = r.request.url.split("/")[-1].split(".")[0].split("?")[0]
        if pid in bilder: r.fulfill(status=200, body=bilder[pid], content_type="image/jpeg")
        else: r.fallback()
    pg.route("**/photo/kp*", foto_route); pg.route("**/thumb/kp*", foto_route)
    pg.evaluate(TB_MOCK)
    an0 = pg.evaluate("MT.aktiv()")
    tid = pg.evaluate("""async () => {
      Set_.v.mtAktiv = false; await Set_.set('mtWahl', 'nein');
      const T0 = Date.UTC(2026, 9, 3, 8), pts = Array.from({ length: 60 }, (_, i) => ({ lat: 47.4 + i * 0.0004, lon: 11.2 + i * 0.0002, ele: 800 + i * 4, t: T0 + i * 60000 }));
      const t = (await Tours.add({ name: 'Komoot Gipfel/Runde', sport: 'hike', pts, src: 'file', force: true })).tour;
      Object.assign(t, { note: 'Toller Tag 🥾\\nmit <Brotzeit> & Aussicht', pins: [{ id: 'k1', ts: T0 + 600000, lat: 47.404, lon: 11.202, text: 'Quelle' }, { id: 'k2', ts: T0 + 1800000, lat: null, lon: null, text: 'Gipfelkreuz mit sehr langer Beschreibung, die für den Namen eines Wegpunkts deutlich zu lang ist und gekürzt werden muss' }] });
      await Tours.save(t);
      const ph = (id, min, faces) => DB.put('photos', { id, name: id + '.jpg', ts: T0 + min * 60000, lat: 47.41, lon: 11.21, w: 3000, h: 2000, src: 'galerie', tour: t.id, pos: 'exif', note: '', faces });
      await ph('kp1aaaaaaaaaaaaaaaaa', 5, 0); await ph('kp2aaaaaaaaaaaaaaaaa', 15, 2); await ph('kp3aaaaaaaaaaaaaaaaa', 25, 0);
      Tours.invalidate(); return t.id; }""")
    menue = lambda: (pg.evaluate("id => { location.hash = '#/tour/' + id; return Nav.render(); }", tid), pg.wait_for_selector(".tourp h1"), pg.click("button[aria-label=Aktionen]"), pg.wait_for_selector(".sheet .menu"))
    def zip_lesen():
        sv = pg.evaluate("window.__saved"); assert sv and sv["mime"] == "application/zip" and sv["name"].startswith("Komoot-Paket Komoot Gipfel_Runde") and sv["name"].endswith(".zip"), sv
        b64 = pg.evaluate("p => window.__tb.cache[p].join('|')", sv["path"])
        data = b"".join(base64.b64decode(x) for x in b64.split("|"))
        return zipfile.ZipFile(_io.BytesIO(data))
    try:
        menue(); assert pg.locator("#kp-menu").count() == 1 and mt_spuren(pg) == [], mt_spuren(pg)
        pg.click("#kp-menu"); pg.wait_for_selector("#kp-go")
        assert pg.inner_text("#kp-zahl") == "0 von 3 Fotos gewählt (höchstens 60)" and pg.locator("#kp-fotos .kp-f").count() == 3 and pg.locator("#kp-fotos input:checked").count() == 0
        assert pg.locator("#kp-fotos .kp-f[data-id=kp2aaaaaaaaaaaaaaaaa] .kp-g").inner_text() == "Gesicht erkannt – Rechte der Personen beachten" and pg.locator("#kp-fotos .kp-g").count() == 1
        assert "Einwilligung" in pg.inner_text("#kp-rechte") and not pg.is_checked("#kp-ort input") and pg.is_checked("#kp-notiz input")
        pg.click("#kp-alle"); assert pg.inner_text("#kp-zahl").startswith("2 von 3") and not pg.is_checked("#kp-fotos .kp-f[data-id=kp2aaaaaaaaaaaaaaaaa] input"), "Gesicht nie automatisch"
        pg.click("#kp-fotos .kp-f[data-id=kp3aaaaaaaaaaaaaaaaa]"); pg.click("#kp-fotos .kp-f[data-id=kp2aaaaaaaaaaaaaaaaa]")      # bewusst: eines ab-, das Gesicht dazu
        assert pg.inner_text("#kp-zahl").startswith("2 von 3") and pg.is_checked("#kp-fotos .kp-f[data-id=kp2aaaaaaaaaaaaaaaaa] input")
        pg.evaluate("document.querySelectorAll('.sheet, .sheet-b').forEach(e => { e.scrollTop = 0; })")      # nach den Klicks oben beginnen (halb weggerollte Zeilen zählen sonst als zu klein)
        bad += sheet_check_open(pg, "Komoot-Paket")
        pg.emulate_media(color_scheme="dark"); bad += sheet_check_open(pg, "Komoot-Paket dunkel"); pg.emulate_media(color_scheme="light")
        for sel in ("#kp-ort", "#kp-go", "#kp-abbr"):      # weiter unten: nach dem Rollen gut erreichbar (44 px)
            pg.evaluate("s => document.querySelector(s).scrollIntoView({ block: 'center' })", sel); pg.wait_for_timeout(80)
            assert pg.evaluate("""s => { const el = document.querySelector(s), r = el.getBoundingClientRect(); return r.height >= 44 && [[0, 0], [0, -21], [0, 21]].every(([dx, dy]) => { const e = document.elementFromPoint(r.left + r.width / 2 + dx, r.top + r.height / 2 + dy); return e && (e === el || el.contains(e)); }); }""", sel), sel
        pg.click("#kp-go"); pg.wait_for_selector("#kp-fertig", timeout=60000)
        assert "Download/Tourentagebuch/Komoot-Paket" in pg.inner_text("#kp-ort-t") and "2 Foto(s)" in pg.inner_text("#kp-fertig") and "2 Pin(s)" in pg.inner_text("#kp-fertig"), pg.inner_text("#kp-fertig")
        bad += sheet_check_open(pg, "Komoot-Paket gespeichert")
        z = zip_lesen(); names = sorted(z.namelist())
        assert [n for n in names if not n.startswith("fotos/")] == sorted(["Komoot Gipfel_Runde.gpx", "notiz.txt", "README.txt", "manifest.json"]) and len([n for n in names if re.fullmatch(r"fotos/0[12]_2026-10-03_\d\d-\d\d-00\.jpg", n)]) == 2, names
        root = ET.fromstring(z.read("Komoot Gipfel_Runde.gpx")); ns = {"g": "http://www.topografix.com/GPX/1/1"}
        w = root.findall("g:wpt", ns)
        assert len(w) == 2 and w[0].find("g:name", ns).text == "Quelle" and w[0].find("g:time", ns).text == "2026-10-03T08:10:00Z" and w[0].find("g:desc", ns) is None
        assert len(w[1].find("g:name", ns).text) == 60 and w[1].find("g:name", ns).text.endswith("…") and w[1].find("g:desc", ns).text.startswith("Gipfelkreuz mit sehr langer") and abs(float(w[1].get("lat")) - 47.412) < 0.001
        assert root.find("g:metadata/g:desc", ns).text == "Toller Tag 🥾\nmit <Brotzeit> & Aussicht" and root.find("g:trk/g:desc", ns).text == root.find("g:metadata/g:desc", ns).text and len(root.findall(".//g:trkpt", ns)) == 60
        assert z.read("notiz.txt").decode("utf-8") == "Toller Tag 🥾\r\nmit <Brotzeit> & Aussicht\r\n"
        rd = z.read("README.txt").decode("utf-8"); assert "SICHTBARKEIT SELBST WÄHLEN" in rd and "Standard-Sichtbarkeit" in rd and "Foto hinzufügen" in rd and "Aufnahmeort in den Fotos: entfernt" in rd and "2 ausgewählte Fotos" in rd, rd
        mf = json.loads(z.read("manifest.json")); assert mf["format"] == "mein-tourentagebuch-komoot-paket" and [f["id"] for f in mf["fotos"]] == ["kp1aaaaaaaaaaaaaaaaa", "kp2aaaaaaaaaaaaaaaaa"] and mf["ort_entfernt"] is True and mf["fotos"][1]["gesicht"] is True and mf["wegpunkte"] == 2, mf
        fn = sorted(n for n in names if n.startswith("fotos/"))
        for n, gr in ((fn[0], (2000, 1333)), (fn[1], (1200, 1600))):
            im = _Im.open(_io.BytesIO(z.read(n))); ex = im.getexif()
            assert im.size == gr and ex.get_ifd(0x8769).get(0x9003, "").startswith("2026:10:03 ") and not ex.get_ifd(0x8825) and 0x8825 not in ex and 0x0110 not in ex, (n, im.size, dict(ex), ex.get_ifd(0x8825))
        pg.click("#kp-teilen"); pg.wait_for_selector("#kp-fertig", state="detached")
        sh = [c for c in pg.evaluate("window.__tb.calls") if c[0] == "shareCache"]; assert sh and sh[-1][1]["mime"] == "application/zip" and sh[-1][1]["name"].startswith("komoot-paket-"), sh
        leise()
        # Ort im Foto behalten, ohne Notiz, ein Foto
        pg.evaluate("window.__saved = null"); menue(); pg.click("#kp-menu"); pg.wait_for_selector("#kp-go")
        pg.click("#kp-fotos .kp-f[data-id=kp3aaaaaaaaaaaaaaaaa]"); pg.click("#kp-ort"); pg.click("#kp-notiz"); pg.click("#kp-go"); pg.wait_for_selector("#kp-fertig", timeout=60000)
        z = zip_lesen(); names = sorted(z.namelist()); assert "notiz.txt" not in names and len([n for n in names if n.startswith("fotos/")]) == 1, names
        im = _Im.open(_io.BytesIO(z.read([n for n in names if n.startswith("fotos/")][0]))); g = im.getexif().get_ifd(0x8825)
        assert g and g[1] == "N" and abs(g[2][0] + g[2][1] / 60 + g[2][2] / 3600 - 47.41) < 1e-4 and im.size == (2000, 1500), (dict(g), im.size)
        assert "<desc>" not in z.read("Komoot Gipfel_Runde.gpx").decode() or "Gipfelkreuz" in z.read("Komoot Gipfel_Runde.gpx").decode()
        assert "Aufnahmeort in den Fotos: enthalten" in z.read("README.txt").decode("utf-8")
        zu(pg)
        # ohne Fotos: Paket trotzdem (nur GPX, README, Manifest)
        pg.evaluate("window.__saved = null"); menue(); pg.click("#kp-menu"); pg.wait_for_selector("#kp-go"); pg.click("#kp-go"); pg.wait_for_selector("#kp-fertig", timeout=60000)
        assert not any(n.startswith("fotos/") for n in zip_lesen().namelist()) and "ohne Fotos" in pg.inner_text("#kp-fertig")
        zu(pg); leise()
    finally:
        pg.unroute("**/photo/kp*"); pg.unroute("**/thumb/kp*")
        pg.evaluate("() => { window.MTApp.call = window.__tbcall0; }")
        pg.evaluate("""async ([id, an]) => { await Tours.remove(id); for (const p of ['kp1aaaaaaaaaaaaaaaaa', 'kp2aaaaaaaaaaaaaaaaa', 'kp3aaaaaaaaaaaaaaaaa']) await DB.del('photos', p);
          Set_.v.mtAktiv = an; await Set_.set('mtWahl', an ? 'ja' : 'nein'); window.__saved = null; Tours.invalidate(); }""", [tid, an0])
    return bad


FLUG_DPR3 = "() => { window.__dpr0 = Object.getOwnPropertyDescriptor(window, 'devicePixelRatio'); Object.defineProperty(window, 'devicePixelRatio', { get: () => 3, configurable: true }); }"
FLUG_DPR_ZURUECK = "() => { delete window.devicePixelRatio; if (window.__dpr0) Object.defineProperty(window, 'devicePixelRatio', window.__dpr0); window.__dpr0 = null; }"
FLUG_RP = """() => { if (window.__rp0) return; window.__rp = 0; window.__rp0 = [];
  for (const C of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) if (C) { const o = C.prototype.readPixels; window.__rp0.push([C, o]); C.prototype.readPixels = function () { window.__rp++; return o.apply(this, arguments); }; } }"""
FLUG_RP_ZURUECK = "() => { (window.__rp0 || []).forEach(([C, o]) => { C.prototype.readPixels = o; }); window.__rp0 = null; }"


def flug_2160(pg):
    """2.16.0: 3D-Flug flüssiger. (a) Stufe in den Einstellungen speicherbar (Gerätewert, Vorgabe „Flüssig“ in der App); (b) pixelRatio begrenzt
    (gestubbtes devicePixelRatio 3 → 1 / 1,5 / 2,5); (c) Anpassung mit gestubbten Bildzeiten: über die echten Bilder eine Stufe herunter mit
    leiser Meldung, danach Hysterese; die gespeicherte Wahl bleibt; (d) Kopfzeile und gelbe Linie gedrosselt; (e) lange Spur: Linie ausgedünnt;
    (f) keine readPixels-Bremse durch Marker; (g) Kamera als reine Funktion der Zeit (stelleZeit). Stubs werden zurückgesetzt."""
    leise = lambda: pg.wait_for_function(LEISE, timeout=30000)
    vor = pg.evaluate("Set_.get('flugStufe')")
    # (a) Einstellungen: Auswahl da, Vorgabe in der App „Flüssig“, Wahl gespeichert
    pg.evaluate("Set_.set('flugStufe', '')")
    go(pg, "#/settings", "#set-flugstufe")
    assert pg.evaluate("[...document.querySelectorAll('#set-flugstufe option')].map(o => o.value).join()") == "fluessig,normal,schoen"
    assert pg.eval_on_selector("#set-flugstufe", "e => e.value") == "fluessig", "Vorgabe auf dem Handy"
    pg.select_option("#set-flugstufe", "schoen"); pg.wait_for_function("async () => (await DB.kvGet('settings', {})).flugStufe === 'schoen'")
    assert "flugStufe" in pg.evaluate("Backup.GERAET"), "Gerätewert, wird beim Einspielen nicht übernommen"
    # lange, glatte Spur (3000 Punkte, Schleife) mit Fotos
    tid = pg.evaluate("""async () => {
      const base = Date.UTC(2026, 6, 4, 7), pts = [];
      for (let k = 0; k < 3000; k++) { const a = k / 3000 * Math.PI * 2; pts.push({ lat: 47.25 + 0.03 * Math.cos(a), lon: 11.35 + 0.05 * Math.sin(a) + 0.004 * Math.sin(a * 5), ele: 1100 + 500 * Math.sin(a), t: base + k * 4000 }); }
      const r = await Tours.add({ name: 'Langer Flug 2160', sport: 'hike', pts, src: 'file', force: true });
      for (let i = 0; i < 12; i++) await DB.put('photos', { id: 'fl2160' + String(i).padStart(4, '0'), name: 'f.jpg', ts: base + (i * 250 + 100) * 4000, tour: r.tour.id, w: 10, h: 10, src: 'galerie' });
      return r.tour.id; }""")
    pg.evaluate(FLUG_DPR3); pg.evaluate(FLUG_RP); pg.evaluate("Flug.bildzeit = () => 0")      # echte (Software-)Bildzeiten neutralisieren
    pg.evaluate("id => { location.hash = '#/flug/' + id }", tid)
    pg.wait_for_function("() => Flug.aktiv && window.__flug && (document.querySelector('.fhud')?.innerText || '').includes('↑')", timeout=60000)
    # (b) pixelRatio: Schön 2,5 bei Gerät 3; Wechsel im Flug wirkt sofort und wird gespeichert
    assert pg.evaluate("[Flug.aktiv.stufe(), window.__flug.getPixelRatio()]") == ["schoen", 2.5], pg.evaluate("[Flug.aktiv.stufe(), window.__flug.getPixelRatio()]")
    for s_, pr in (("fluessig", 1), ("normal", 1.5), ("schoen", 2.5)):
        pg.select_option("#fst", s_); pg.wait_for_function("([s, pr]) => Flug.aktiv.stufe() === s && window.__flug.getPixelRatio() === pr && Set_.get('flugStufe') === s", arg=[s_, pr], timeout=10000)
    assert pg.evaluate("!!window.__flug.getLayer('schatten') && window.__flug.getLayoutProperty('schatten', 'visibility') !== 'none'"), "Schön: Geländeschatten"
    # (e) Linie ausgedünnt (Stufe beim Öffnen: Schön, Toleranz 1,5 m) und Fotos als Kartenebene (keine HTML-Marker)
    z = pg.evaluate("Flug.aktiv.zahlen()")
    voll = pg.evaluate("window.__flug.getSource('full')._data.geometry.coordinates.reduce((a, l) => a + l.length, 0)")
    assert z["punkte"] >= 800 and voll == z["linie"] and z["linie"] <= 0.6 * z["punkte"], (z, voll)
    assert pg.locator(".flight .fcam").count() == 0 and pg.locator(".flight .maplibregl-marker").count() == 1 and pg.evaluate("window.__flug.getSource('fotos')._data.features.length") == 12
    # (d) Takt: Kopfzeile und gelbe Linie höchstens im Takt der Stufe (Schön je 100 ms), nie öfter als Bilder
    pg.wait_for_timeout(4000)
    z = pg.evaluate("Flug.aktiv.zahlen()")
    assert z["bilder"] >= 3 and z["hud"] <= z["bilder"] + 1 and z["hud"] <= z["ms"] / 100 + 2 and z["spur"] <= z["ms"] / 100 + 2, z
    # (f) der Positionspunkt löst keine readPixels-Prüfung mehr aus
    pg.evaluate("window.__rp = 0"); pg.wait_for_timeout(3000)
    rp = pg.evaluate("window.__rp"); assert rp <= 3, "readPixels im Flug: %s" % rp
    # (c) Anpassung über die echten Bilder: gestubbte Bildzeit 55 ms → eine Stufe tiefer, leise Meldung, gespeicherte Wahl bleibt
    leise(); pg.evaluate("Flug.bildzeit = () => 55")
    pg.wait_for_function("() => Flug.aktiv.stufe() === 'normal'", timeout=180000)
    assert "Flug vereinfacht" in toast_text(pg, "vereinfacht")
    pg.evaluate("Flug.bildzeit = () => 0")
    assert pg.evaluate("[window.__flug.getPixelRatio(), Set_.get('flugStufe')]") == [1.5, "schoen"]
    # Hysterese: sofort weitere langsame Bilder ändern nichts (Ruhezeit + neues Fenster), danach eine weitere Stufe, darunter nichts mehr
    assert pg.evaluate("Flug.aktiv.bildzeiten(Array(30).fill(80))") is None and pg.evaluate("Flug.aktiv.stufe()") == "normal"
    leise()
    assert pg.evaluate("Flug.aktiv.bildzeiten(Array(60).fill(80))") == "fluessig" and pg.evaluate("window.__flug.getPixelRatio()") == 1
    assert pg.evaluate("Flug.aktiv.bildzeiten(Array(300).fill(80))") is None and pg.evaluate("Flug.aktiv.stufe()") == "fluessig"
    assert pg.evaluate("Flug.aktiv.bildzeiten(Array(300).fill(16))") is None and pg.evaluate("Flug.aktiv.stufe()") == "fluessig", "kein Hochschalten im Flug"
    leise()
    # (g) Kamera als Funktion der Zeit: gleiche Zeit → gleiche Kamera, auch nach Hin- und Herspringen; Karte steht dort
    k1 = pg.evaluate("JSON.stringify(Flug.aktiv.stelleZeit(30))"); pg.evaluate("Flug.aktiv.stelleZeit(80)"); pg.evaluate("Flug.aktiv.stelleZeit(5)")
    k2 = pg.evaluate("JSON.stringify(Flug.aktiv.stelleZeit(30))")
    assert k1 == k2, (k1, k2)
    c = json.loads(k2); mc = pg.evaluate("[window.__flug.getCenter().lng, window.__flug.getCenter().lat, window.__flug.getBearing()]")
    assert abs(mc[0] - c["center"][0]) < 1e-6 and abs(mc[1] - c["center"][1]) < 1e-6 and abs(((mc[2] - c["bearing"] + 540) % 360) - 180) < 0.01, (mc, c)
    assert "Weiter" in pg.inner_text("#fp") and pg.evaluate("Flug.aktiv.dauer") == 100
    # Layout der Steuerleiste bei 360 px / 130 %: kein Querrollen
    for w, fs in ((360, 130), (390, 100)):
        pg.set_viewport_size({"width": w, "height": 800}); pg.evaluate("fs => { let s = document.getElementById('fs-test'); if (!s) { s = document.createElement('style'); s.id = 'fs-test'; document.head.append(s); } s.textContent = fs === 100 ? '' : 'html{font-size:' + fs + '% !important}'; }", fs)
        pg.dispatch_event(".flight .fm", "pointerdown"); pg.wait_for_timeout(300)
        assert pg.evaluate("document.documentElement.scrollWidth <= innerWidth + 1 && [...document.querySelectorAll('.flight .fctl > *')].every(e => e.getBoundingClientRect().right <= innerWidth + 1)"), (w, fs)
    pg.evaluate("document.getElementById('fs-test').textContent = ''"); pg.set_viewport_size({"width": 390, "height": 800})
    # Stubs zurücksetzen
    pg.evaluate("location.hash = '#/'"); pg.wait_for_function("() => !document.querySelector('.flight') && !Flug.aktiv", timeout=20000)
    pg.evaluate(FLUG_DPR_ZURUECK); pg.evaluate("Flug.bildzeit = null")
    pg.evaluate(FLUG_RP_ZURUECK)
    pg.evaluate("s => Set_.set('flugStufe', s || '')", vor)
    assert pg.evaluate("window.devicePixelRatio") == 1 and pg.evaluate("Flug.bildzeit") is None



FV_MOCK = """(cfg) => {
  /* 2.17.0: Hülle für „Video erzeugen“ nachgestellt: flugVideoInfo/Start/Frame/Finish/Cancel/Save/Dienst/Share, appendCache (sammelt die Bytes), playVideo */
  if (!window.__fvcall0) window.__fvcall0 = window.MTApp.call;
  const c0 = window.__fvcall0;
  window.__fv = Object.assign({ calls: [], info: { avc: null, hevc: null, freiMB: 50000, ramGB: 16, sdk: 35, galerie: 'Movies/Tourentagebuch' }, dateien: {}, frames: [], nativ: null, datei: null }, cfg || {});
  window.MTApp.call = (id, m, a) => {
    const V = window.__fv;
    if (!/^flugVideo|^appendCache$|^playVideo$/.test(m)) return c0.call(window.MTApp, id, m, a);
    const o = JSON.parse(a || '{}');
    V.calls.push([m, m === 'appendCache' || m === 'flugVideoFrame' ? { name: o.name, i: o.i, len: (o.b64 || '').length, reset: o.reset } : o]);
    let r = true, fail = null;
    const bytes = b => Uint8Array.from(atob(b), c => c.charCodeAt(0));
    if (m === 'flugVideoInfo') r = V.info;
    else if (m === 'appendCache') { if (o.reset || !V.dateien[o.name]) V.dateien[o.name] = []; V.dateien[o.name].push(o.b64); }
    else if (m === 'flugVideoSave') {
      const parts = (V.dateien[o.tmp] || []).map(bytes), n = parts.reduce((x, p) => x + p.length, 0), all = new Uint8Array(n); let k = 0;
      for (const p of parts) { all.set(p, k); k += p.length; }
      all.set(bytes(o.patchB64), o.patchAt); V.datei = FlugVideo.b64(all); V.save = { tmp: o.tmp, name: o.name, patchAt: o.patchAt }; delete V.dateien[o.tmp];
      r = { ok: true, name: o.name, bytes: n, gallery: true, shown: 'Movies/Tourentagebuch/' + o.name };
    }
    else if (m === 'flugVideoCancel') { if (o.tmp) delete V.dateien[o.tmp]; V.nativ = null; }
    else if (m === 'flugVideoStart') { V.nativ = { o, n: 0 }; r = { ok: true, encoder: 'c2.mtk.avc.encoder', hw: true, w: o.w, h: o.h, name: o.name }; }
    else if (m === 'flugVideoFrame') { if (!V.nativ) fail = 'Es läuft kein Video-Export.'; else { V.frames.push({ i: o.i, jpeg: o.b64.slice(0, 4) === '/9j/', len: o.b64.length }); V.nativ.n++; r = { ok: true, i: V.nativ.n }; } }
    else if (m === 'flugVideoFinish') { if (!V.nativ) fail = 'Es läuft kein Video-Export.'; else { r = { ok: true, name: V.nativ.o.name, bytes: 123456, frames: V.nativ.n, gallery: true, shown: 'Movies/Tourentagebuch/' + V.nativ.o.name, encoder: 'c2.mtk.avc.encoder' }; V.nativ = null; } }
    else if (m === 'playVideo') r = { ok: true };
    setTimeout(() => window.__mtcb(+id, !fail, fail || JSON.stringify(r)), V.langsam || 2);
  };
}"""
FV_ZURUECK = "() => { if (window.__fvcall0) window.MTApp.call = window.__fvcall0; window.__fvcall0 = null; window.__fv = null; }"


def mp4_kaesten(b, a=0, e=None):
    """MP4-Kästen lesen (unabhängig von js/calc-mp4.js): {Pfad: (Anfang, Größe, Kopf)}."""
    import struct
    e = len(b) if e is None else e
    out = {}
    def lauf(a, e, pfad):
        while a + 8 <= e:
            size, typ = struct.unpack(">I4s", b[a:a + 8]); head = 8; typ = typ.decode("latin-1")
            if size == 1: size = struct.unpack(">Q", b[a + 8:a + 16])[0]; head = 16
            if size == 0: size = e - a
            assert size >= head and a + size <= e, ("Kasten kaputt", typ, a, size)
            p = pfad + "/" + typ if pfad else typ
            out.setdefault(p, (a, size, head))
            if typ in ("moov", "trak", "mdia", "minf", "stbl", "dinf", "edts"): lauf(a + head, a + size, p)
            a += size
    lauf(a, e, "")
    return out


def flugvideo_2170(pg):
    """2.17.0: 3D-Flug als Video (Bild für Bild). (a) Dialog: Voreinstellungen, Schätzung, Grenzen (Bildzahl, Speicher, Kodierer, 4K-Warnung),
    360–430 px, 130 % Schrift, hell und dunkel; (b) Wegwahl WebCodecs/Android; (c) echter Mini-Export mit WebCodecs (320 × 240, 10 Bilder) in der
    nachgestellten Hülle: Datei prüfen (Kästen, Bildzahl, Dauer; ffprobe, falls vorhanden); Bild i zeigt die Kamera bei t = i/fps; (d) Weg über
    Android: Start, Bildübergabe als JPEG, Fortschritt (Dienst), Ergebnis, Abspielen/Teilen; (e) Kachel-Zeitlimit → mit Lücken weiter; (f) Abbruch
    räumt auf (beide Wege). Stubs werden zurückgesetzt."""
    import base64, struct, subprocess, shutil, tempfile
    leise = lambda: pg.wait_for_function(LEISE, timeout=30000)
    vor = pg.evaluate("JSON.stringify(Set_.get('flugVideo') || {})")
    g0 = pg.evaluate("JSON.stringify(FlugVideo.GRENZEN)")
    import io as _io
    from PIL import Image as _Im
    _b = _io.BytesIO(); _Im.new("RGB", (256, 256), (128, 0, 0)).save(_b, "PNG"); dem = _b.getvalue()      # Terrarium: 0 m (flach) – Höhenkacheln nachgestellt
    dem_route = lambda r: r.fulfill(status=200, body=dem, content_type="image/png", headers={"access-control-allow-origin": "*"})
    pg.route("**/elevation-tiles-prod/**", dem_route)
    tid = pg.evaluate("""async () => {
      const base = Date.UTC(2026, 6, 4, 7), pts = [];
      for (let k = 0; k < 400; k++) { const a = k / 400 * Math.PI; pts.push({ lat: 47.30 + 0.02 * Math.sin(a), lon: 11.30 + 0.03 * k / 400, ele: 900 + 600 * Math.sin(a), t: base + k * 20000 }); }
      const r = await Tours.add({ name: 'Über den Grat 2170', sport: 'hike', pts, src: 'file', force: true });
      for (let i = 0; i < 3; i++) await DB.put('photos', { id: 'fv2170' + String(i).padStart(4, '0'), name: 'f.jpg', ts: base + (i * 120 + 50) * 20000, tour: r.tour.id, w: 10, h: 10, src: 'galerie' });
      return r.tour.id; }""")
    pg.evaluate(FV_MOCK)
    pg.evaluate("id => { location.hash = '#/flug/' + id }", tid)
    pg.wait_for_function("() => Flug.aktiv && window.__flug && (document.querySelector('.fhud')?.innerText || '').includes('↑')", timeout=60000)
    # Bedienleiste: „Video erzeugen“ ist der Hauptweg, die Echtzeit-Aufnahme heißt „Schnellaufnahme“
    assert "Video erzeugen" in pg.inner_text("#fvid") and "Schnellaufnahme" in pg.inner_text("#frec")
    for w, fs in ((360, 130), (390, 100)):
        pg.set_viewport_size({"width": w, "height": 800}); pg.evaluate("fs => { let s = document.getElementById('fs-test'); if (!s) { s = document.createElement('style'); s.id = 'fs-test'; document.head.append(s); } s.textContent = fs === 100 ? '' : 'html{font-size:' + fs + '% !important}'; }", fs)
        pg.dispatch_event(".flight .fm", "pointerdown"); pg.wait_for_timeout(300)
        assert pg.evaluate("document.documentElement.scrollWidth <= innerWidth + 1 && [...document.querySelectorAll('.flight .fctl > *')].every(e => e.getBoundingClientRect().right <= innerWidth + 1)"), (w, fs)
    pg.evaluate("document.getElementById('fs-test').textContent = ''"); pg.set_viewport_size({"width": 390, "height": 800})
    # (a) Dialog mit Voreinstellungen und Schätzung
    pg.evaluate("Set_.set('flugVideo', {})")
    pg.dispatch_event(".flight .fm", "pointerdown"); pg.evaluate("document.querySelector('#fvid').click()"); pg.wait_for_selector(".sheet[aria-label='Video erzeugen'] #fv-go")
    assert "Bild für Bild" in pg.inner_text(".sheet[aria-label='Video erzeugen']") and "Schnellaufnahme" in pg.inner_text(".sheet[aria-label='Video erzeugen']")
    assert pg.eval_on_selector("#fv-aufl", "e => e.value") == "1080" and pg.eval_on_selector("#fv-stufe", "e => e.value") == "schoen"
    assert pg.evaluate("[...document.querySelectorAll('#fv-aufl option')].map(o => o.value + (o.disabled ? '-' : '')).join()") == "720,1080,1440,2160"
    sch = pg.inner_text("#fv-schaetz"); assert "1920 × 1080" in sch and "1.830 Bilder" in sch and "140 MB" in sch, sch
    assert "Quellenangabe der Karte" in pg.inner_text(".sheet[aria-label='Video erzeugen']") and "keinen Ton" in pg.inner_text(".sheet[aria-label='Video erzeugen']")
    assert "geöffnet bleiben" in pg.inner_text(".sheet[aria-label='Video erzeugen']") and "Offline-Karte" in pg.inner_text(".sheet[aria-label='Video erzeugen']")
    pg.select_option("#fv-format", "hoch"); assert "1080 × 1920" in pg.inner_text("#fv-schaetz")
    pg.select_option("#fv-format", "quer")
    # Grenzen: zu viele Bilder → Fehler, Knopf aus; wieder gültig → an
    pg.select_option("#fv-fps", "60"); pg.select_option("#fv-dauer", "300")
    assert "Zu viele Bilder (18060)" in pg.inner_text("#fv-warn") and pg.eval_on_selector("#fv-go", "e => e.disabled")
    pg.select_option("#fv-fps", "30"); pg.select_option("#fv-dauer", "60"); assert not pg.eval_on_selector("#fv-go", "e => e.disabled")
    assert "Frei: 50.000 MB" in pg.inner_text("#fv-warn")
    # Layout 360–430 px, 130 % Schrift, hell und dunkel: nichts ragt hinaus, Tippflächen groß genug, Text lesbar
    bad = []
    for sch_ in ("light", "dark"):
        pg.emulate_media(color_scheme=sch_)
        for w, fs in ((360, 100), (390, 100), (430, 100), (360, 130), (430, 130)):
            pg.set_viewport_size({"width": w, "height": 2000})      # hoch genug, dass das ganze Blatt ohne Rollen zu sehen ist (Treffertest je Tippfläche)
            pg.evaluate("fs => { document.getElementById('fs-test').textContent = fs === 100 ? '' : 'html{font-size:' + fs + '% !important}'; }", fs); pg.wait_for_timeout(200)
            assert pg.evaluate("() => { const b = document.querySelector('.sheet[aria-label=\"Video erzeugen\"] .sheet-b'); return b.scrollHeight <= b.clientHeight + 1; }"), ("Blatt rollt noch", w, fs)
            bad += ["Video erzeugen %s %d px %d %%: %s" % (sch_, w, fs, x) for x in pg.evaluate(LAYOUT_JS) if ".sheet" in x or "fv-" in x or "Querrollen" in x]
            assert pg.evaluate("() => { const b = document.querySelector('.sheet[aria-label=\"Video erzeugen\"]'); return b.scrollWidth <= b.clientWidth + 1 && b.getBoundingClientRect().right <= innerWidth + 1; }"), (sch_, w, fs)
            assert pg.evaluate("() => { const e = document.querySelector('#fv-schaetz'), c = getComputedStyle(e); return c.color !== c.backgroundColor; }")
    pg.evaluate("document.getElementById('fs-test').textContent = ''"); pg.emulate_media(color_scheme="light"); pg.set_viewport_size({"width": 390, "height": 800})
    assert not bad, "\n".join(sorted(set(bad)))
    zu(pg)
    # Grenzen aus der Hülle: Kodierer bis 1080p → 1440p/2160p gesperrt; wenig Speicher → Fehler; 4K bei 6 GB → Warnung
    pg.evaluate("Object.assign(__fv.info, { avc: { name: 'c2.mtk.avc.encoder', hw: true, encLang: 1920, encKurz: 1080 }, freiMB: 600 })")
    pg.evaluate("document.querySelector('#fvid').click()"); pg.wait_for_selector("#fv-go")
    assert pg.evaluate("[...document.querySelectorAll('#fv-aufl option')].map(o => o.value + (o.disabled ? '-' : '')).join()") == "720,1080,1440-,2160-"
    assert "Zu wenig freier Speicher" in pg.inner_text("#fv-warn") and pg.eval_on_selector("#fv-go", "e => e.disabled")
    zu(pg)
    pg.evaluate("Object.assign(__fv.info, { avc: { name: 'c2.mtk.avc.encoder', hw: true, encLang: 3840, encKurz: 2160 }, freiMB: 50000, ramGB: 6 })")
    pg.evaluate("document.querySelector('#fvid').click()"); pg.wait_for_selector("#fv-go"); pg.select_option("#fv-aufl", "2160")
    assert "8 GB" in pg.inner_text("#fv-warn") and not pg.eval_on_selector("#fv-go", "e => e.disabled") and "3840 × 2160" in pg.inner_text("#fv-schaetz")
    zu(pg)
    # (b) Wegwahl: mit Hardware-Kodierer der Hülle und ohne Hardware-WebCodecs (headless) → Android; ohne Hülle-Kodierer → WebCodecs (Software)
    wc = pg.evaluate("typeof VideoEncoder !== 'undefined'")
    w1 = pg.evaluate("async () => { const f = await FlugVideo.faehig(); return (await FlugVideo.weg({ w: 320, h: 240, fps: 30, bitrate: 1e6, codec: 'avc', weg: 'auto' }, f)).art; }")
    assert w1 in ("android", "webcodecs"), w1
    pg.evaluate("__fv.info.avc = null; __fv.info.ramGB = 16")
    w2 = pg.evaluate("async () => { const f = await FlugVideo.faehig(); const w = await FlugVideo.weg({ w: 320, h: 240, fps: 30, bitrate: 1e6, codec: 'avc', weg: 'auto' }, f); return w && w.art; }")
    assert w2 == ("webcodecs" if wc else None), w2
    if wc and w1 == "android": print("  Wegwahl: headless meldet keine Hardware-WebCodecs → mit Hülle-Kodierer „über Android“, ohne → WebCodecs (Software)")
    pg.evaluate("FlugVideo.GRENZEN.zeitlimit = 6000; FlugVideo.test = { protokoll: [] }")
    alt_pr, alt_st = pg.evaluate("[window.__flug.getPixelRatio(), Flug.aktiv.stufe()]")
    WAHL = {"titel": True, "datum": True, "kennzahlen": True, "profil": True, "fotos": True, "stufe": "schoen", "codec": "avc"}
    # (c) echter Mini-Export mit WebCodecs: 320 × 240, 10 Bilder über den ganzen Flug
    if not wc:
        print("  WebCodecs fehlt in diesem Chromium – echter Mini-Export übersprungen")
    else:
        leise()
        r = pg.evaluate("""async (w) => { const ctx = Flug.aktiv.video(), f = await FlugVideo.faehig();
          const weg = await FlugVideo.weg({ w: 320, h: 240, fps: 30, bitrate: 1e6, codec: 'avc', weg: 'auto' }, f);
          const r = await FlugVideo.erzeuge(ctx, Object.assign({}, w, { w: 320, h: 240, fps: 30, dauer: 0.3, n: 10, bitrate: 1e6 }), weg);
          return r && { name: r.name, bytes: r.bytes, frames: r.frames, dauerMs: r.dauerMs, art: r.art, luecken: r.luecken }; }""", WAHL)
        assert r and r["art"] == "webcodecs" and r["frames"] == 10 and r["dauerMs"] == 333 and r["name"] == "Flug_Ueber_den_Grat_2170_2026-07-04.mp4", r
        pg.wait_for_selector("#fv-fertig"); txt = pg.inner_text("#fv-fertig")
        assert "Flug_Ueber_den_Grat_2170_2026-07-04.mp4" in txt and "320 × 240" in txt and "Movies/Tourentagebuch" in txt and "WebCodecs" in txt, txt
        assert pg.locator("#fv-play").count() == 1 and pg.locator("#fv-share").count() == 1
        pg.click("#fv-share"); pg.wait_for_function("() => __fv.calls.some(c => c[0] === 'flugVideoShare' && c[1].name === 'Flug_Ueber_den_Grat_2170_2026-07-04.mp4')")
        pg.click("#fv-play"); pg.wait_for_function("() => __fv.calls.some(c => c[0] === 'playVideo' && c[1].file === 'Flug_Ueber_den_Grat_2170_2026-07-04.mp4')")
        zu(pg)
        d = base64.b64decode(pg.evaluate("__fv.datei"))
        assert pg.evaluate("Object.keys(__fv.dateien).length") == 0 and len(d) == r["bytes"], (len(d), r)
        k = mp4_kaesten(d)
        assert d[4:8] == b"ftyp" and list(x for x in k if "/" not in x) == ["ftyp", "mdat", "moov"], list(k)
        a, sz, hd = k["moov/trak/mdia/minf/stbl/stsz"]; assert struct.unpack(">I", d[a + 16:a + 20])[0] == 10
        a, sz, hd = k["moov/trak/mdia/mdhd"]; ts, du = struct.unpack(">II", d[a + 20:a + 28]); assert (ts, du) == (90000, 30000), (ts, du)
        a, sz, hd = k["moov/trak/tkhd"]; assert struct.unpack(">II", d[a + 84:a + 92]) == (320 * 65536, 240 * 65536)
        assert d[k["moov/trak/mdia/minf/stbl/stsd"][0] + 20:k["moov/trak/mdia/minf/stbl/stsd"][0] + 24] == b"avc1"
        if shutil.which("ffprobe"):
            with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as fh: fh.write(d); fn = fh.name
            pr = subprocess.run(["ffprobe", "-v", "error", "-count_frames", "-select_streams", "v:0", "-show_entries", "stream=codec_name,width,height,nb_read_frames,r_frame_rate", "-of", "json", fn], capture_output=True, text=True)
            st_ = json.loads(pr.stdout)["streams"][0]; os.unlink(fn)
            assert st_["codec_name"] == "h264" and st_["width"] == 320 and st_["height"] == 240 and int(st_["nb_read_frames"]) == 10 and st_["r_frame_rate"] == "30/1", (st_, pr.stderr)
        else: print("  ffprobe fehlt – MP4 nur über die Kästen geprüft")
        # Bild i zeigt die Kamera bei t = i/fps: Flugzeit stimmt, Karte stand genau auf der Kamera der reinen Funktion
        pro = pg.evaluate("FlugVideo.test.protokoll"); T = pg.evaluate("Flug.aktiv.dauer")
        assert [p["i"] for p in pro] == list(range(10)), pro
        for p in pro:
            soll = min(T, p["i"] / 30 * T / 0.3); assert abs(p["sec"] - soll) < 1e-6, (p, soll)
        assert pro[0]["sec"] == 0 and pro[-1]["sec"] == T
        assert all(abs(p["zoom"] - 15.7) < 1e-6 for p in pro), [p["zoom"] for p in pro]      # Zoom wie bei der Aufnahme (zBase + 0,9)
        assert all(p["ok"] for p in pro), "alle Bilder ohne Zeitlimit (Kacheln nachgestellt)"
        # nach dem Export: Karte wieder wie vorher, Flug bedienbar
        zust = pg.evaluate("[window.__flug.getPixelRatio(), document.querySelector('.flight .fm').getAttribute('style'), Flug.aktiv.stufe(), window.__flug.getCanvas().width]"); assert zust[0] == alt_pr and not zust[1] and zust[2] == alt_st and zust[3] == 390, zust
        assert pg.evaluate("__fv.calls.filter(c => c[0] === 'flugVideoDienst').map(c => !!c[1].an).join()").startswith("true") and pg.evaluate("__fv.calls.filter(c => c[0] === 'flugVideoDienst').pop()[1].an") is False
    # Kamera bei derselben Zeit: Export-Kamera = reine Funktion (FlugCalc.kamera über Flug.aktiv.kameraBei während des Exports)
    pg.evaluate("""() => { const ctx = Flug.aktiv.video(), o = ctx.stelleZeit; window.__fvSoll = []; ctx.stelleZeit = sec => { const r = o(sec); window.__fvSoll.push({ sec, k: ctx.kameraBei(sec), m: [window.__flug.getCenter().lng, window.__flug.getCenter().lat, window.__flug.getBearing(), window.__flug.getPitch(), window.__flug.getZoom()] }); return r; }; window.__fvO = o; }""")
    # ab hier ohne Vorladen der Strecke (im Mini-Export oben echt geprüft; spart Zeit beim Software-Zeichnen)
    pg.evaluate("() => { const c = Flug.aktiv.video(); window.__fvVw = c.vorwaermen; c.vorwaermen = async (melde) => { melde(1); }; }")
    # (d) über Android: Start, Bilder als JPEG der Reihe nach, Fortschritt, Ergebnis
    pg.evaluate("__fv.info.avc = { name: 'c2.mtk.avc.encoder', hw: true, encLang: 3840, encKurz: 2160 }; __fv.calls = []; FlugVideo.test = { protokoll: [] }")
    leise()
    r = pg.evaluate("""async (w) => { const ctx = Flug.aktiv.video(), f = await FlugVideo.faehig();
      const weg = await FlugVideo.weg({ w: 640, h: 360, fps: 30, bitrate: 2e6, codec: 'avc', weg: 'android' }, f);
      const r = await FlugVideo.erzeuge(ctx, Object.assign({}, w, { w: 640, h: 360, fps: 30, dauer: 6 / 30, n: 6, bitrate: 2e6, stufe: 'normal' }), weg);
      return r && { art: r.art, frames: r.frames, name: r.name }; }""", WAHL)
    assert r == {"art": "android", "frames": 6, "name": "Flug_Ueber_den_Grat_2170_2026-07-04.mp4"}, r
    st_ = pg.evaluate("__fv.calls.filter(c => c[0] === 'flugVideoStart')[0][1]")
    assert st_["w"] == 640 and st_["h"] == 360 and st_["fps"] == 30 and st_["codec"] == "avc" and st_["bitrate"] == 2e6 and st_["frames"] == 6, st_
    fr = pg.evaluate("__fv.frames"); assert [x["i"] for x in fr] == list(range(6)) and all(x["jpeg"] and x["len"] > 1000 for x in fr), fr
    seq = [c[0] for c in pg.evaluate("__fv.calls") if c[0] in ("flugVideoStart", "flugVideoFrame", "flugVideoFinish")]
    assert seq == ["flugVideoStart"] + ["flugVideoFrame"] * 6 + ["flugVideoFinish"], seq
    pg.wait_for_selector("#fv-fertig"); assert "über Android" in pg.inner_text("#fv-fertig"); zu(pg)
    soll = pg.evaluate("window.__fvSoll")
    assert len(soll) == 6
    for e in soll:
        k_, m_ = e["k"], e["m"]
        assert abs(m_[0] - k_["center"][0]) < 1e-9 and abs(m_[1] - k_["center"][1]) < 1e-9 and abs(((m_[2] - k_["bearing"] + 540) % 360) - 180) < 1e-6, e
        assert abs(m_[3] - k_["pitch"]) < 1e-6 and abs(m_[4] - k_["zoom"]) < 1e-6, e
    pg.evaluate("() => { Flug.aktiv.video().stelleZeit = window.__fvO; window.__fvO = null; window.__fvSoll = null; }")
    # (e) Kacheln laden nicht (kein idle, nicht geladen) → je Bild Zeitlimit × Versuche, dann mit Lücken weiter
    pg.evaluate("""() => { const m = window.__flug; m.once = function (t, f) { if (t === 'idle') return this; return Object.getPrototypeOf(this).once.call(this, t, f); };
      m.areTilesLoaded = () => false; FlugVideo.GRENZEN.zeitlimit = 150; FlugVideo.GRENZEN.versuche = 2; __fv.frames = []; }""")
    leise()
    r = pg.evaluate("""async (w) => { const t0 = performance.now(), ctx = Flug.aktiv.video(), f = await FlugVideo.faehig(); const weg = await FlugVideo.weg({ w: 640, h: 360, fps: 30, bitrate: 2e6, codec: 'avc', weg: 'android' }, f);
      const r = await FlugVideo.erzeuge(ctx, Object.assign({}, w, { w: 640, h: 360, fps: 30, dauer: 4 / 30, n: 4, bitrate: 2e6, stufe: 'normal' }), weg); return r && { luecken: r.luecken, frames: r.frames, ms: performance.now() - t0 }; }""", WAHL)
    assert r["luecken"] == 4 and r["frames"] == 4 and r["ms"] >= 4 * 2 * 150, r
    pg.wait_for_selector("#fv-fertig"); assert "4 Bilder haben Lücken" in pg.inner_text("#fv-fertig"); zu(pg)
    pg.evaluate("() => { const m = window.__flug; delete m.once; delete m.areTilesLoaded; }")
    assert pg.evaluate("!Object.prototype.hasOwnProperty.call(window.__flug, 'once') && window.__flug.areTilesLoaded === Object.getPrototypeOf(window.__flug).areTilesLoaded")
    pg.evaluate("g => { Object.assign(FlugVideo.GRENZEN, JSON.parse(g)); }", g0)
    # (f) Abbruch räumt auf: über Android (Kodierer freigeben) …
    pg.evaluate("__fv.calls = []; __fv.frames = []; __fv.langsam = 30")
    pg.evaluate("""(w) => { (async () => { const ctx = Flug.aktiv.video(), f = await FlugVideo.faehig(); const weg = await FlugVideo.weg({ w: 640, h: 360, fps: 30, bitrate: 2e6, codec: 'avc', weg: 'android' }, f);
      window.__fvAb = await FlugVideo.erzeuge(ctx, Object.assign({}, w, { w: 640, h: 360, fps: 30, dauer: 10, n: 330, bitrate: 2e6, stufe: 'normal' }), weg); window.__fvAbFertig = true; })(); }""", WAHL)
    pg.wait_for_function("() => __fv.frames.length >= 3", timeout=60000)
    assert "Bild" in pg.inner_text("#fv-stand")
    leise(); pg.click("#fv-stop")
    pg.wait_for_function("() => window.__fvAbFertig === true && !FlugVideo.laeuft", timeout=60000)
    assert "Abgebrochen" in toast_text(pg, "Abgebrochen")
    assert pg.evaluate("window.__fvAb") is None and pg.locator("#fv-fertig").count() == 0
    assert pg.evaluate("__fv.calls.some(c => c[0] === 'flugVideoCancel') && !__fv.calls.some(c => c[0] === 'flugVideoFinish') && __fv.nativ === null")
    zust = pg.evaluate("[window.__flug.getPixelRatio(), document.querySelector('.flight .fm').getAttribute('style'), Flug.aktiv.stufe(), window.__flug.getCanvas().width]"); assert zust[0] == alt_pr and not zust[1] and zust[2] == alt_st and zust[3] == 390, zust
    assert pg.evaluate("__fv.calls.filter(c => c[0] === 'flugVideoDienst').pop()[1].an") is False
    # … und mit WebCodecs (Zwischendatei in der Hülle gelöscht)
    if wc:
        pg.evaluate("__fv.info.avc = null; __fv.calls = []; __fv.langsam = 2; window.__fvAbFertig = false")
        pg.evaluate("""(w) => { (async () => { const ctx = Flug.aktiv.video(), f = await FlugVideo.faehig(); const weg = await FlugVideo.weg({ w: 320, h: 240, fps: 30, bitrate: 1e6, codec: 'avc', weg: 'auto' }, f);
          window.__fvAb = await FlugVideo.erzeuge(ctx, Object.assign({}, w, { w: 320, h: 240, fps: 30, dauer: 10, n: 330, bitrate: 1e6, stufe: 'normal' }), weg); window.__fvAbFertig = true; })(); }""", WAHL)
        pg.wait_for_function("() => /Bild [3-9]/.test(document.querySelector('#fv-stand')?.textContent || '')", timeout=60000)
        leise(); pg.click("#fv-stop")
        pg.wait_for_function("() => window.__fvAbFertig === true && !FlugVideo.laeuft", timeout=60000)
        tmp = pg.evaluate("(__fv.calls.find(c => c[0] === 'flugVideoCancel') || [0, {}])[1].tmp")
        assert tmp and tmp.startswith("flugvideo-") and pg.evaluate("Object.keys(__fv.dateien).length") == 0, (tmp, pg.evaluate("Object.keys(__fv.dateien)"))
        assert "Abgebrochen" in toast_text(pg, "Abgebrochen")
    pg.evaluate("() => { Flug.aktiv.video().vorwaermen = window.__fvVw; window.__fvVw = null; }")
    # Flug läuft danach normal weiter
    pg.click("#fp"); pg.wait_for_function("() => document.querySelector('#fp').innerText.includes('Pause')")
    # Stubs zurücksetzen
    leise()
    pg.evaluate("location.hash = '#/'"); pg.wait_for_function("() => !document.querySelector('.flight') && !Flug.aktiv", timeout=20000)
    pg.evaluate(FV_ZURUECK); pg.evaluate("FlugVideo.test = null; window.__fvAb = null; window.__fvAbFertig = null")
    pg.evaluate("g => { FlugVideo.GRENZEN = JSON.parse(g); }", g0)
    pg.evaluate("v => Set_.set('flugVideo', JSON.parse(v))", vor)
    pg.evaluate("async id => { await Tours.remove(id); for (let i = 0; i < 3; i++) await DB.del('photos', 'fv2170' + String(i).padStart(4, '0')); }", tid)
    pg.unroute("**/elevation-tiles-prod/**", dem_route)
    assert pg.evaluate("window.__fvcall0") is None and pg.evaluate("FlugVideo.test") is None



NOTIZ_MASS = """sel => { const ta = document.querySelector(sel), r = ta.getBoundingClientRect(), lh = parseFloat(getComputedStyle(ta).lineHeight);
  return { sh: ta.scrollHeight, ch: ta.clientHeight, h: r.height, lh, w: r.width, rechts: r.right, vw: innerWidth, rand: getComputedStyle(ta).borderTopColor, grund: getComputedStyle(ta).backgroundColor, farbe: getComputedStyle(ta).color, resize: getComputedStyle(ta).resize }; }"""


def notizhoehe_2160(pg):
    """2.16.0: Notizfelder wachsen mit dem Inhalt (Tourseite und Planungsnotiz): 40 Zeilen komplett sichtbar, Wachsen beim Tippen, Schrumpfen beim
    Löschen, 360–430 px und 130 % Schrift, hell und dunkel; kein Ziehgriff. Die Notiz bleibt nach dem Neuladen vollständig sichtbar."""
    leise = lambda: pg.wait_for_function(LEISE, timeout=30000)
    lang = "\n".join("Zeile %d: Aufstieg über den Steig, oben Einkehr, Rückweg über die Alm." % (i + 1) for i in range(40))
    tid = pg.evaluate("""async (txt) => { const t = (await Tours.list()).find(x => x.status !== 'planned' && !x.hidden); const alt = t.note; t.note = txt; await Tours.save(t); return [t.id, alt || '']; }""", lang)
    sel = "textarea[aria-label=Notiz]"
    def voll(m, tag):
        assert m["sh"] <= m["ch"] + 1, ("abgeschnitten", tag, m)
        assert m["resize"] == "none", (tag, m)
    go(pg, "#/tour/" + tid[0], sel); pg.locator(sel).scroll_into_view_if_needed()
    m = pg.evaluate(NOTIZ_MASS, sel); voll(m, "Start")
    assert m["h"] >= 40 * m["lh"] * 0.95, ("40 Zeilen hoch", m)
    for sch in ("light", "dark"):
        pg.emulate_media(color_scheme=sch)
        for w, fs in ((360, 100), (390, 100), (430, 100), (360, 130), (430, 130)):
            pg.set_viewport_size({"width": w, "height": 800})
            pg.evaluate("fs => { let s = document.getElementById('fs-test'); if (!s) { s = document.createElement('style'); s.id = 'fs-test'; document.head.append(s); } s.textContent = fs === 100 ? '' : 'html{font-size:' + fs + '% !important}'; }", fs)
            pg.wait_for_timeout(150)
            m = pg.evaluate(NOTIZ_MASS, sel); voll(m, (sch, w, fs))
            assert m["rechts"] <= m["vw"] + 1 and pg.evaluate("document.documentElement.scrollWidth <= innerWidth + 1 && document.querySelector('#view').scrollWidth <= document.querySelector('#view').clientWidth + 1"), ("Querrollen", sch, w, fs, m, pg.evaluate("document.querySelector('#view').scrollWidth"))
            assert m["farbe"] != m["grund"], (sch, m)
    pg.evaluate("document.getElementById('fs-test').textContent = ''"); pg.emulate_media(color_scheme="light"); pg.set_viewport_size({"width": 390, "height": 800}); pg.wait_for_timeout(150)
    # Tippen: wächst; Löschen: schrumpft bis auf die Grundhöhe (3 Zeilen)
    h0 = pg.evaluate(NOTIZ_MASS, sel)["h"]
    pg.click(sel); pg.keyboard.press("Control+End")
    for k in range(5): pg.keyboard.press("Enter"); pg.keyboard.type("Neu %d" % k)
    m = pg.evaluate(NOTIZ_MASS, sel); voll(m, "getippt")
    assert m["h"] >= h0 + 4 * m["lh"], (h0, m)
    pg.keyboard.press("Control+A"); pg.keyboard.press("Delete"); pg.keyboard.type("Kurz.")
    m = pg.evaluate(NOTIZ_MASS, sel); voll(m, "gelöscht")
    assert m["h"] < 5 * m["lh"] + 40, ("geschrumpft", m)
    pg.evaluate("document.activeElement.blur()")
    pg.wait_for_function("id => DB.get('tours', id).then(t => t.note === 'Kurz.')", arg=tid[0], timeout=10000)
    # wieder lang, Seite neu aufbauen: vollständig
    pg.evaluate("async ([id, txt]) => { const t = await DB.get('tours', id); t.note = txt; await Tours.save(t); }", [tid[0], lang])
    pg.evaluate("Nav.render()"); pg.wait_for_selector(sel); pg.wait_for_timeout(200)
    voll(pg.evaluate(NOTIZ_MASS, sel), "neu geladen")
    # Planungsnotiz (geplante Tour) genauso
    pid = pg.evaluate("""async (txt) => { const pts = Array.from({ length: 20 }, (_, i) => ({ lat: 47.1 + i * 0.001, lon: 11.1, ele: 900 + i * 5 }));
      const r = await Tours.add({ name: 'Plan Notiz 2160', sport: 'hike', pts, src: 'plan', status: 'planned', force: true }); await PlanMeta.patch(r.tour.id, { note: txt }); return r.tour.id; }""", lang)
    go(pg, "#/tour/" + pid, "#pn-note"); pg.locator("#pn-note").scroll_into_view_if_needed()
    m = pg.evaluate(NOTIZ_MASS, "#pn-note"); voll(m, "Planung"); assert m["h"] >= 40 * m["lh"] * 0.95, m
    leise()
    pg.evaluate("async ([id, alt]) => { const t = await DB.get('tours', id); t.note = alt; await Tours.save(t); }", tid)
    pg.evaluate("async id => { const t = await DB.get('tours', id); t.hidden = true; await Tours.save(t); }", pid)



def statgruppen_2190(pg):
    """2.19.0: Aktivitäten-Katalog, Statistik-Gruppen und Favoriten. Vorgabe: jede Aktivität einzeln, keine Gruppe. Einstellungen: Vorschläge (ein Klick), Gruppe
    abhaken/löschen, gesperrte Sportarten, unfertige Gruppe; Wirkung in Statistik-Filter, Block „Sportarten“, Bestwerte je Sportart, Auswertung, Jahresrückblick,
    Zielen; Schneeschuh-Touren als Schneeschuh führen und zurück; Sicherung; Favoriten (Reihenfolge, Sterne, 12er-Grenze) und „Tour aufnehmen“ mit „Mehr …“,
    zuletzt benutzte Aktivität vorgewählt; Bergsteigen, Schneeschuh, Skitour überall wählbar. Gibt Layoutfehler zurück."""
    bad = []
    go = lambda h, sel: (pg.evaluate("h => { if (location.hash === h) Nav.render(); else location.hash = h; }", h), pg.wait_for_selector(sel), pg.wait_for_timeout(300))
    ok_klick = lambda: (pg.wait_for_selector(".sheet .btn.pri"), pg.click(".sheet .btn.pri"), pg.wait_for_selector(".sheet", state="detached"))
    ids = pg.evaluate("""async () => {
      await Set_.set('statGruppen', []); await Set_.set('favAkt', Aktiv.STANDARD); await Set_.set('recSport', '');
      const T0 = new Date(2019, 6, 10, 9).getTime(), mk = async (name, sport, k, tags) => {
        const pts = Array.from({ length: 40 }, (_, i) => ({ lat: 46.1 + k * 0.01 + i * 0.0004, lon: 10.1 + i * 0.0003, ele: 900 + i * 6, t: T0 + k * 86400000 + i * 60000 }));
        return (await Tours.add({ name, sport, tags, pts, src: 'file', force: true })).tour.id; };
      const r = { h: await mk('SG Wandern', 'hike', 0), m: await mk('SG Berg', 'mountaineering', 1), s: await mk('SG Schneeschuh alt', 'hike', 2, ['Schneeschuh']),
        b: await mk('SG MTB', 'mtb', 3), e: await mk('SG E-Bike', 'ebike', 4), m2: await mk('SG Berg 2', 'mountaineering', 5), k: await mk('SG Kajak', 'kayak', 6) };
      Tours.invalidate(); return r; }""")
    # Vorgabe: keine Gruppen, jede Aktivität einzeln (auch Bergsteigen, Kajak)
    go("#/stats", ".kpis"); pg.select_option("select[aria-label=Zeitraum]", "2019"); pg.wait_for_timeout(200)
    rows = pg.eval_on_selector_all("#st-sport .hb", "els => els.map(e => e.dataset.sport)")
    assert {"hike", "mountaineering", "mtb", "ebike", "kayak"} <= set(rows) and not any(r.startswith("sgrp:") for r in rows), rows
    opts = pg.locator("select[aria-label=Sportart] option").all_inner_texts()
    for want in ("Bergsteigen", "Schneeschuh", "Skitour", "Snowboard", "Kajak / Kanu", "Gassigehen", "Orientierungslauf", "Schneemobil", "Angeln", "E-Mountainbike", "Gravelbike"): assert want in opts, (want, opts)
    assert "Ski (alle Arten)" not in opts and not any("zusammengefasst" in o for o in opts), opts
    # Einstellungen: Vorschläge, keine Gruppe
    go("#/settings", "#sg-box")
    assert pg.locator("#sg-box .sg-grp").count() == 0 and "Keine Gruppen" in pg.inner_text("#sg-stand"), pg.inner_text("#sg-box")
    assert pg.locator("#sg-vorschlaege button").count() == 3
    pg.click("#sg-vorschlag-rad"); pg.wait_for_function("() => Set_.get('statGruppen').some(g => g.id === 'rad')")
    pg.click("#sg-vorschlag-berg"); pg.wait_for_function("() => Set_.get('statGruppen').some(g => g.id === 'berg')")
    gr = pg.evaluate("Set_.get('statGruppen')")
    assert [g["id"] for g in gr] == ["rad", "berg"] and gr[1]["sports"] == ["hike", "mountaineering", "snowshoe"], gr
    assert pg.locator("#sg-vorschlag-ski").count() == 1 and pg.locator("#sg-vorschlag-rad").count() == 0
    assert pg.is_disabled("#sg-grp-1 [data-sport=mtb] input") and "in „Rad“" in pg.inner_text("#sg-grp-1 [data-sport=mtb]") and pg.is_checked("#sg-grp-1 [data-sport=snowshoe] input")
    pg.locator("#sg-box").scroll_into_view_if_needed(); bad += ["Statistik-Gruppen: " + m for m in pg.evaluate(LAYOUT_JS)]
    # E-Bike aus „Rad“ lösen → steht wieder für sich
    pg.click("#sg-grp-0 [data-sport=ebike] input"); pg.wait_for_function("() => !Set_.get('statGruppen')[0].sports.includes('ebike')")
    # unfertige Gruppe: Hinweis, wird nicht gespeichert
    pg.click("#sg-add"); pg.wait_for_selector("#sg-hinweis-2")
    assert len(pg.evaluate("Set_.get('statGruppen')")) == 2
    # Statistik: Filter und Block „Sportarten“
    go("#/stats", ".kpis"); pg.select_option("select[aria-label=Zeitraum]", "2019"); pg.wait_for_timeout(200)
    opts = pg.locator("select[aria-label=Sportart] option").all_inner_texts()
    assert "Wandern + Berg + Schneeschuh (zusammengefasst)" in opts and "Rad (zusammengefasst)" in opts and "Bergsteigen" in opts, opts
    rows = pg.eval_on_selector_all("#st-sport .hb", "els => els.map(e => e.dataset.sport)")
    assert "sgrp:berg" in rows and "sgrp:rad" in rows and "ebike" in rows and "kayak" in rows and "mountaineering" not in rows and "hike" not in rows and "mtb" not in rows, rows
    pg.select_option("select[aria-label=Sportart]", "sgrp:berg"); pg.wait_for_timeout(200)
    assert pg.locator(".kpis .kpi").first.inner_text().split("\n")[0].strip() == "4", pg.inner_text(".kpis")      # Wandern, Schneeschuh (alt: Wandern), 2 × Bergsteigen
    # Bestwerte je Sportart und Auswertung
    pg.select_option("select[aria-label=Sportart]", ""); pg.click(".chips .chip:has-text('Bestwerte')"); pg.wait_for_selector("#bw-sport h3")
    hs = pg.eval_on_selector_all("#bw-sport h3[data-sport]", "els => els.map(e => [e.dataset.sport, e.textContent])")
    assert any(k == "sgrp:berg" and "Wandern + Berg + Schneeschuh · 4 Touren" in t for k, t in hs), hs
    pg.click(".chips .chip:has-text('Auswertung')"); pg.wait_for_selector("table.cstat")
    tr = pg.eval_on_selector_all("table.cstat tbody tr", "els => els.map(e => [e.dataset.sport, e.cells[0].textContent, e.cells[1].textContent])")
    assert any(k == "sgrp:berg" and b == "4" for k, a, b in tr) and any(k == "kayak" for k, a, b in tr), tr
    # Jahresrückblick
    go("#/jahr/2019", "#jahr-sport")
    sp = pg.eval_on_selector_all("#jahr-sport .jsp", "els => els.map(e => e.dataset.sport)")
    assert "sgrp:berg" in sp and "sgrp:rad" in sp and "ebike" in sp and "kayak" in sp, sp
    # Ziele: Gruppe wählbar, gelöschte Gruppe robust, feste Gruppen nur bei alten Zielen
    z = pg.evaluate("""async () => {
      const g = { id: 'zsg', period: 'year', year: 2019, metric: 'count', target: 10, sport: 'sgrp:berg' }, g2 = Object.assign({}, g, { id: 'zweg', sport: 'sgrp:weg' }), g3 = Object.assign({}, g, { id: 'zalt', sport: 'grp:bike' });
      await Goals.save([g, g2, g3]); const all = (await Tours.list()).filter(Jahr.zaehlt), d = new Date(2019, 11, 31);
      return { ist: Ziele.stand(g, all, d).ist, weg: Ziele.stand(g2, all, d).ist, alt: Ziele.stand(g3, all, d).ist, name: Goals.name(g), name2: Goals.name(g2) }; }""")
    assert z["ist"] == 4 and z["weg"] == 0 and z["alt"] == 2 and "(zusammengefasst)" in z["name"] and "Gelöschte Gruppe" in z["name2"], z
    go("#/stats/ziele", "#view"); pg.wait_for_timeout(300)
    pg.evaluate("Goals.edit({ id: 'zweg', period: 'year', year: 2019, metric: 'count', target: 10, sport: 'sgrp:weg' }, null, () => {})"); pg.wait_for_selector("#goalsport")
    o2 = pg.locator("#goalsport option").all_inner_texts()
    assert "Wandern + Berg + Schneeschuh (zusammengefasst)" in o2 and "Gelöschte Gruppe" in o2 and pg.eval_on_selector("#goalsport", "e => e.value") == "sgrp:weg" and "Rad (alle Arten)" not in o2 and "Bergsteigen" in o2 and "Skitour" in o2, o2
    pg.evaluate("window.mtBack()"); pg.wait_for_selector(".sheet", state="detached")
    pg.evaluate("Goals.edit({ id: 'zalt', period: 'year', year: 2019, metric: 'count', target: 10, sport: 'grp:bike' }, null, () => {})"); pg.wait_for_selector("#goalsport")
    assert "Rad (alle Arten)" in pg.locator("#goalsport option").all_inner_texts() and pg.eval_on_selector("#goalsport", "e => e.value") == "grp:bike"
    pg.evaluate("window.mtBack()"); pg.wait_for_selector(".sheet", state="detached")
    pg.evaluate("Goals.save([])")
    # Schneeschuh-Touren als Aktivität Schneeschuh führen und zurück
    go("#/settings", "#ss-um")
    assert "1 Wandern-Tour" in pg.inner_text("#ss-stand"), pg.inner_text("#ss-box")
    pg.click("#ss-um"); ok_klick(); pg.wait_for_selector("#ss-zurueck")
    t = pg.evaluate("id => DB.get('tours', id)", ids["s"]); assert t["sport"] == "snowshoe" and t["tags"] == ["Schneeschuh"] and t["ssUm"] == 1, t
    pg.click("#ss-zurueck"); ok_klick(); pg.wait_for_selector("#ss-um")
    t = pg.evaluate("id => DB.get('tours', id)", ids["s"]); assert t["sport"] == "hike" and "ssUm" not in t and t["tags"] == ["Schneeschuh"], t
    # Favoriten: Vorgabe, Reihenfolge, Stern, Grenze
    assert pg.eval_on_selector_all("#fav-liste .fav-row", "els => els.map(e => e.dataset.sport)") == ["hike", "run", "bike", "skitour", "mtb"]
    pg.click("#fav-liste .fav-row[data-sport=run] button[aria-label='Laufen nach vorn']"); pg.wait_for_timeout(150)
    pg.click("#fav-mountaineering"); pg.wait_for_timeout(150); pg.click("#fav-kayak"); pg.wait_for_timeout(150)
    assert pg.evaluate("Set_.get('favAkt')") == ["run", "hike", "bike", "skitour", "mtb", "mountaineering", "kayak"]
    pg.click("#fav-liste .fav-row[data-sport=bike] button[aria-label='Radtour entfernen']"); pg.wait_for_timeout(150)
    for k in ["walk", "snowshoe", "trailrun", "gravel", "emtb", "nordic"]: pg.click("#fav-" + k); pg.wait_for_timeout(60)
    assert len(pg.evaluate("Set_.get('favAkt')")) == 12 and pg.is_disabled("#fav-golf") and "12 von höchstens 12" in pg.inner_text("#fav-zahl")
    pg.locator("#fav-box").scroll_into_view_if_needed(); bad += ["Favoriten: " + m for m in pg.evaluate(LAYOUT_JS)]
    pg.click("#fav-standard"); pg.wait_for_timeout(150); assert pg.evaluate("Set_.get('favAkt')") == ["hike", "run", "bike", "skitour", "mtb"]
    pg.evaluate("Set_.set('favAkt', ['run', 'mountaineering', 'snowshoe'])")
    # Tour aufnehmen: Favoriten als Chips, „Mehr …“, zuletzt benutzte vorgewählt
    go("#/rec", ".bigstart")
    ch = pg.eval_on_selector_all(".chips.wrap .chip[data-sport]", "els => els.map(e => [e.dataset.sport, e.classList.contains('on')])")
    assert ch == [["run", True], ["mountaineering", False], ["snowshoe", False]], ch
    pg.click("#rec-mehr"); pg.wait_for_selector("#rec-alle")
    al = pg.locator("#rec-alle .li-t b").all_inner_texts(); hk = pg.locator("#rec-alle h3").all_inner_texts()
    assert hk == ["Zu Fuß", "Rad", "Winter", "Wasser", "Outdoor & Sonstige"] and "Skitour" in al and "Stand-up-Paddling" in al and "Golf" in al and "Ski (allgemein)" not in al, (hk, al)
    pg.click("#rec-akt-sup"); pg.wait_for_selector(".sheet", state="detached")
    ch = pg.eval_on_selector_all(".chips.wrap .chip[data-sport]", "els => els.map(e => [e.dataset.sport, e.classList.contains('on')])")
    assert ch[0] == ["sup", True] and len(ch) == 4, ch
    pg.click(".bigstart"); pg.wait_for_timeout(300)
    assert pg.evaluate("window.__calls.filter(c => c[0] === 'start').pop()[1]") == "sup" and pg.evaluate("Set_.get('recSport')") == "sup"
    pg.evaluate("window.__rec.state = 'idle'; window.__rec.unsent = false; Nav.render()"); pg.wait_for_selector(".bigstart")
    assert pg.eval_on_selector(".chips.wrap .chip.on", "e => e.dataset.sport") == "sup", "zuletzt benutzte bleibt vorgewählt"
    # Sicherung: Gruppen und Favoriten rein und raus
    bk = pg.evaluate("""async () => { const d = await Backup.collect(); const s = d.kv.find(k => k.k === 'settings'); const gr = s.v.statGruppen, fav = s.v.favAkt;
      await Set_.set('statGruppen', []); await Set_.set('favAkt', Aktiv.STANDARD);
      await Backup.restoreKv([{ k: 'settings', v: { statGruppen: gr.concat([{ id: 'x', name: 'kaputt', sports: ['hike'] }]), favAkt: fav.concat(['gibtsnicht']) } }]);
      const nach = Set_.get('statGruppen'), fnach = Set_.get('favAkt'); await Backup.restoreKv([{ k: 'settings', v: { bestN: 1 } }]);
      return { gr, nach, fav, fnach, bleibt: Set_.get('statGruppen'), gespeichert: (await DB.kvGet('settings', {})).statGruppen }; }""")
    assert bk["nach"] == bk["gr"] and bk["bleibt"] == bk["gr"] and bk["gespeichert"] == bk["gr"] and bk["fnach"] == bk["fav"] == ["run", "mountaineering", "snowshoe"], bk
    # Planung: Bergsteigen, Schneeschuh, Skitour, Ski alpin wählbar; Tour bearbeiten: alle Kategorien
    go("#/plan", "select[aria-label=Sportart]"); po = pg.locator("select[aria-label=Sportart] option").all_inner_texts()
    assert "Bergsteigen" in po and "Schneeschuh" in po and "Skitour" in po and "Ski alpin" in po, po
    # aufräumen
    pg.evaluate("async ids => { for (const id of Object.values(ids)) await Tours.remove(id); await Set_.set('statGruppen', []); await Set_.set('favAkt', Aktiv.STANDARD); await Set_.set('recSport', ''); Tours.invalidate(); }", ids)
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
        erststart_2150(pg)      # 2.15.0: Frage beim Erststart; danach „Mit Meine Touren zusammenarbeiten“ an (Testhelfer MT_AN)
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
        # Beenden: nur durch Schieben (2.7.0); Pause nur durch Halten
        assert "läuft" in pg.inner_text("header.top h1") and pg.locator("#tabs a.rec.live").count() == 1
        vals = [x.strip() for x in pg.locator(".rec .kpis.big .kpi small").all_inner_texts()]; assert vals == ["Strecke", "Höhe", "Aufstieg", "Abstieg"], vals
        assert pg.evaluate("parseFloat(getComputedStyle(document.querySelector('.bigtime')).fontSize)") >= 56, "Laufzeit muss groß sein"
        pg.locator("#rpause").click(); pg.wait_for_timeout(400); assert pg.evaluate("__rec.state") == "recording", "kurzer Tipp darf nicht pausieren"
        halten(pg, "#rpause", 1500); pg.wait_for_function("document.querySelector('header.top h1').innerText.includes('Pause')"); pg.locator("#rpause").click(); pg.wait_for_function("document.querySelector('header.top h1').innerText.includes('läuft')")
        pg.locator("#rstop").scroll_into_view_if_needed()
        schieben(pg, 0.35); pg.wait_for_timeout(400)
        assert pg.evaluate("__rec.state") == "recording", "zu kurzes Schieben darf nicht beenden"
        pg.evaluate("g => { window.__gpx = g }", gpx(t0 + 86400000 * 200, n=30, lat=46.5, name=""))
        schieben(pg, 1.0)
        pg.wait_for_function("location.hash.startsWith('#/tour/')", timeout=8000)
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
        assert "Längste Serie" in tx and "Beste Woche" in tx and "Bestwerte je Sportart" in tx and "Bestwerte" in tx and "Bester Monat" not in tx, tx[:400]
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
        assert hrefs == ["#/plan", "#/map", "#/offline", "#/fuehrer", "#/reisen", "#/stats", "#/jahr", "#/import", "#/sources", "#/settings"], hrefs
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
        flug_2160(pg)
        flugvideo_2170(pg)
        notizhoehe_2160(pg)

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
        von_aussen(pg)
        aufnahme_270(pg)
        karte_281(pg)
        videos_271(pg)
        videos_290(pg)
        sicherung_2100(pg)
        offline_2110(pg)
        rettung_2120(pg)
        fotoort_2120(pg)
        video_2120(pg)
        tb_bad = teilen_2130(pg)
        st_bad = statistik_2130(pg)
        fx_bad = fuehrer_2130(pg)
        dp_bad = doppelt_2140(pg)
        ms_bad = mt_schalter_2150(pg)
        ab_bad = abgleich_2180(pg)
        kp_bad = komootpaket_2180(pg)
        sg_bad = statgruppen_2190(pg)
        panorama_280(pg)
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
        bad = layout_check(pg, ["#/start", "#/", "#/map", "#/rec", "#/photos", "#/mehr", "#/stats", "#/stats/rekorde", "#/stats/kalender", "#/stats/auswertung", "#/stats/ziele", "#/reisen", "#/import", "#/settings", "#/sources", "#/plan", "#/offline", "#/tour/" + lt, "#/story/" + lt, "#/fix/" + lt])
        bad += neue_layout(pg, neu)
        bad += layout_21(pg)
        bad += layout_22(pg)
        bad += jahr_bad
        bad += fu_bad
        bad += tb_bad
        bad += st_bad
        bad += fx_bad
        bad += dp_bad
        bad += ms_bad
        bad += ab_bad
        bad += kp_bad
        bad += sg_bad
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
