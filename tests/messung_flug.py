"""2.16.0: Messung des 3D-Flugs in headless Chromium (Playwright).

Was gemessen wird (für eine lange Tour mit 3000 Punkten und 30 Fotos, Gelände aus nachgestellten Höhenkacheln):
  - Bildwechsel: Abstände zwischen zwei requestAnimationFrame-Aufrufen (Mittel, 95-%-Wert, Bilder je Sekunde)
  - Rechenzeit im Hauptthread je Bild aus den Chrome-Zählern (Skript, Stil, Layout, Aufgaben gesamt)
  - lange Aufgaben (> 50 ms, PerformanceObserver „longtask“)
  - gl.readPixels-Aufrufe (jeder hält die Grafik an, bis alles gezeichnet ist – auf Handys besonders teuer)
  - setData-Aufrufe der GeoJSON-Quellen (jeder lässt die Linie neu zerlegen und das Gelände-Abbild der Kacheln neu zeichnen)
  - Schreibzugriffe im Dokument (MutationObserver über die Flugansicht)
  - Zeichenfläche: Pixel der Karte (pixelRatio)

WICHTIG: headless Chromium zeichnet WebGL in Software (SwiftShader). Die Zahlen zeigen nur relative Unterschiede und die Kosten im
Hauptthread, nicht die echte Grafiklast auf einem Handy. Die Pixelzahl wirkt hier stärker als auf einer echten Grafikeinheit.

Aufruf:  python3 tests/messung_flug.py [--www PFAD] [--stufe fluessig|normal|schoen] [--sek 10] [--dpr 2.75]
         (--www zeigt z. B. auf einen alten Stand: git worktree add /tmp/alt <commit>; dann --www /tmp/alt/android/app/src/main/assets/www)
"""
import argparse, http.server, io, json, math, os, socketserver, sys, threading
from functools import partial
from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.dirname(__file__))
from test_web import MOCK, WWW  # noqa: E402


def dem_png():
    """Terrarium-Höhenkachel mit Hügeln (Höhe = R*256 + G + B/256 − 32768)."""
    from PIL import Image
    im = Image.new("RGB", (256, 256)); px = im.load()
    for y in range(256):
        for x in range(256):
            h = 1200 + 500 * math.sin(x / 23.0) * math.cos(y / 31.0) + 200 * math.sin((x + y) / 11.0)
            v = h + 32768; r = int(v // 256); g = int(v % 256); b = int((v - math.floor(v)) * 256)
            px[x, y] = (r, g, b)
    o = io.BytesIO(); im.save(o, "PNG"); return o.getvalue()


def map_png():
    from PIL import Image, ImageDraw
    im = Image.new("RGB", (256, 256), (236, 232, 222)); d = ImageDraw.Draw(im)
    for k in range(0, 256, 32): d.line([(k, 0), (255 - k, 255)], fill=(180, 170, 150), width=2); d.line([(0, k), (255, k)], fill=(205, 215, 195), width=1)
    o = io.BytesIO(); im.save(o, "PNG"); return o.getvalue()


INSTR = """() => {
  if (window.__m) return;
  const M = window.__m = { rp: 0, sd: 0, mut: 0, lt: [], frames: [] };
  for (const C of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) if (C) { const o = C.prototype.readPixels; C.prototype.readPixels = function () { M.rp++; return o.apply(this, arguments); }; }
  try { new PerformanceObserver(l => l.getEntries().forEach(e => M.lt.push(e.duration))).observe({ entryTypes: ['longtask'] }); } catch (e) { /* egal */ }
}"""

SPUR = """async ([n, nf]) => {
  const base = Date.UTC(2026, 6, 4, 7), pts = [];
  for (let k = 0; k < n; k++) { const a = k / n * Math.PI * 2; pts.push({ lat: 47.25 + 0.03 * Math.sin(a) + 0.002 * Math.sin(k / 7), lon: 11.35 + 0.05 * Math.sin(2 * a) + 0.002 * Math.cos(k / 9), ele: 1100 + 600 * Math.sin(a), t: base + k * 4000, hr: 110 + (k % 40) }); }
  const r = await Tours.add({ name: 'Messflug', sport: 'hike', pts, src: 'file', force: true });
  for (let i = 0; i < nf; i++) await DB.put('photos', { id: 'mf' + String(i).padStart(8, '0'), name: 'm.jpg', ts: base + Math.round((i + 0.5) / nf * n) * 4000, tour: r.tour.id, w: 10, h: 10, src: 'galerie' });
  return r.tour.id;
}"""

START = """() => {
  const M = window.__m, m = window.__flug;
  M.rp = 0; M.mut = 0; M.lt = []; M.frames = []; M.sd = 0;
  for (const id of ['done', 'full', 'fotos']) { const s = m.getSource(id); if (s && !s.__w) { const o = s.setData.bind(s); s.setData = d => { M.sd++; return o(d); }; s.__w = 1; } }
  const fl = document.querySelector('.flight');
  M.mo && M.mo.disconnect(); M.mo = new MutationObserver(l => { M.mut += l.length; }); M.mo.observe(fl, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['style', 'class', 'value'] });
  let last = performance.now(); M.run = true;
  const f = now => { M.frames.push(now - last); last = now; if (M.run) requestAnimationFrame(f); }; requestAnimationFrame(f);
  const c = m.getCanvas(); M.px = c.width * c.height; M.pr = m.getPixelRatio ? m.getPixelRatio() : null;
  M.full = (() => { const s = m.getSource('full'); const d = s && s._data; return d && d.geometry ? d.geometry.coordinates.reduce((a, l) => a + l.length, 0) : null; })();
}"""

STOP = """() => { const M = window.__m; M.run = false; M.mo.disconnect(); const f = M.frames.slice(2).sort((a, b) => a - b);
  return { n: f.length, mittel: f.reduce((a, b) => a + b, 0) / f.length, p95: f[Math.floor(f.length * 0.95)], rp: M.rp, sd: M.sd, mut: M.mut, lt: M.lt.length, ltMs: M.lt.reduce((a, b) => a + b, 0), px: M.px, pr: M.pr, full: M.full,
  terrainKacheln: window.__flug.terrain ? window.__flug.terrain.sourceCache.getRenderableTiles().length : 0,
  rasterKacheln: Object.entries(window.__flug.style.sourceCaches).filter(([k]) => ['osm', 'topo', 'sat'].includes(k)).reduce((a, [, c]) => a + c.getVisibleCoordinates().length, 0) }; }"""


def miss(www, stufe, sek, dpr, n=3000, nf=30, bild=None):
    class Q(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *a, **k): super().__init__(*a, directory=www, **k)
        def log_message(self, *a): pass
    srv = socketserver.TCPServer(("127.0.0.1", 0), Q); port = srv.server_address[1]
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    dem, kachel = dem_png(), map_png()
    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context(viewport={"width": 390, "height": 800}, device_scale_factor=dpr)
        ctx.add_init_script(MOCK)
        pg = ctx.new_page()
        hdr = {"access-control-allow-origin": "*"}
        pg.route("**/elevation-tiles-prod/**", lambda r: r.fulfill(status=200, body=dem, content_type="image/png", headers=hdr))
        for pat in ("**/tile.openstreetmap.org/**", "**/tile.opentopomap.org/**", "**/server.arcgisonline.com/**"):
            pg.route(pat, lambda r: r.fulfill(status=200, body=kachel, content_type="image/png", headers=hdr))
        pg.goto(f"http://127.0.0.1:{port}/index.html"); pg.wait_for_selector("#tabs a")
        pg.evaluate("async () => { await Set_.set('mtWahl', 'nein'); }")
        if stufe: pg.evaluate("s => Set_.set('flugStufe', s)", stufe)
        tid = pg.evaluate(SPUR, [n, nf])
        pg.evaluate(INSTR)
        pg.evaluate("() => { if (window.Flug) Flug.bildzeit = () => 0; }")      # 2.16.0: Stufe während der Messung festhalten (keine Anpassung)
        if os.environ.get("FLUG_PATCH"): pg.evaluate("async () => { await Flug.loadLib(); " + os.environ["FLUG_PATCH"] + " }")
        cdp = ctx.new_cdp_session(pg); cdp.send("Performance.enable")
        pg.evaluate("id => { location.hash = '#/flug/' + id }", tid)
        pg.wait_for_function("() => window.__flug && window.__flug.getSource('done') && (document.querySelector('.fhud')?.innerText || '').includes('↑')", timeout=120000)
        pg.wait_for_timeout(1500)
        met = lambda: {m["name"]: m["value"] for m in cdp.send("Performance.getMetrics")["metrics"]}
        pg.evaluate(START); m0 = met()
        pg.wait_for_timeout(int(sek * 1000))
        m1 = met(); r = pg.evaluate(STOP)
        d = {k: (m1[k] - m0[k]) * 1000 for k in ("ScriptDuration", "LayoutDuration", "RecalcStyleDuration", "TaskDuration")}
        r.update({k + "_je_Bild_ms": v / max(1, r["n"]) for k, v in d.items()})
        r["Layouts"] = m1["LayoutCount"] - m0["LayoutCount"]; r["Stilberechnungen"] = m1["RecalcStyleCount"] - m0["RecalcStyleCount"]
        r["sek"] = sek
        if bild: pg.screenshot(path=bild)
        b.close()
    srv.shutdown()
    return r


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--www", default=WWW); ap.add_argument("--stufe", default=""); ap.add_argument("--sek", type=float, default=10); ap.add_argument("--dpr", type=float, default=2.75); ap.add_argument("--bild", default=None)
    a = ap.parse_args()
    r = miss(os.path.abspath(a.www), a.stufe, a.sek, a.dpr, bild=a.bild)
    print(json.dumps({k: (round(v, 2) if isinstance(v, float) else v) for k, v in r.items()}, ensure_ascii=False))
