"""Prüft die Lesbarkeit aller Knöpfe, Chips und Links (WCAG-Kontrast) in Hell und Dunkel. Aufruf: python tests/audit_kontrast.py [--fail]"""
import json, socketserver, sys, threading, os
sys.path.insert(0, os.path.dirname(__file__))
from playwright.sync_api import sync_playwright
import test_web as T

JS = """() => {
  const parse = c => { const m = c.match(/rgba?\\(([^)]+)\\)/); if (!m) return null; const p = m[1].split(/[ ,\\/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const lum = c => { const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }; return .2126 * f(c.r) + .7152 * f(c.g) + .0722 * f(c.b); };
  const over = (top, bot) => ({ r: top.r * top.a + bot.r * (1 - top.a), g: top.g * top.a + bot.g * (1 - top.a), b: top.b * top.a + bot.b * (1 - top.a), a: 1 });
  const bgOf = el => { const layers = []; for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c.a > 0) { layers.push(c); if (c.a >= 1) break; } } let base = { r: 255, g: 255, b: 255, a: 1 }; for (let i = layers.length - 1; i >= 0; i--) base = over(layers[i], base); return base; };
  const out = [];
  document.querySelectorAll('button, a:not(.leaflet-marker-icon), .btn, .chip, [role=button], label.sw, summary, select, input:not([type=checkbox]):not([type=radio])').forEach(el => {
    if (el.closest('.leaflet-marker-icon')) return;
    const r = el.getBoundingClientRect(); if (r.width < 4 || r.height < 4) return;
    const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) return;
    const txt = (el.value && el.tagName === 'INPUT' ? '' : (el.innerText || '')).trim(); if (!txt && el.tagName !== 'SELECT') return;
    const fg0 = parse(cs.color); if (!fg0) return;
    const bg = bgOf(el), fg = over(fg0, bg);
    const L1 = lum(fg), L2 = lum(bg), ratio = (Math.max(L1, L2) + .05) / (Math.min(L1, L2) + .05);
    const dis = el.disabled || el.getAttribute('aria-disabled') === 'true';
    if (ratio < 4.5) out.push({ ratio: Math.round(ratio * 100) / 100, txt: txt.slice(0, 30), cls: (el.className && el.className.baseVal === undefined ? el.className : '') + '|' + el.tagName, fg: cs.color, bg: `rgb(${Math.round(bg.r)},${Math.round(bg.g)},${Math.round(bg.b)})`, dis });
  });
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
            t0 = 1700000000000
            pg.evaluate("""async ([a,b]) => { const e=s=>new TextEncoder().encode(s); await Import.fromData('a.gpx',e(a),'file'); await Import.fromData('b.gpx',e(b),'file'); }""",
                        [T.gpx(t0, name="Hüttenrunde"), T.gpx(t0 + 86400000 * 40, lat=47.2, name="Zweite Tour")])
            routes = ["#/start", "#/tours", "#/rec", "#/map", "#/photos", "#/stats", "#/import", "#/settings", "#/sources", "#/plan"]
            tid = pg.evaluate("DB.all('tours').then(a => a[0].id)")
            routes += [f"#/tour/{tid}", f"#/story/{tid}"]
            for r in routes:
                pg.evaluate(f"location.hash='{r}'"); pg.wait_for_timeout(700)
                for item in pg.evaluate(JS): bad.setdefault((r, item["txt"], item["cls"], item["fg"], item["bg"], scheme), item)
            # Blätter (Sheets) der Importseite
            pg.evaluate("location.hash='#/import'"); pg.wait_for_selector(".list")
            for name in ("Komoot", "Strava", "Zepp / Amazfit", "Bosch eBike Flow", "Garmin, Suunto", "Link auf eine GPX-Datei"):
                try:
                    pg.get_by_text(name, exact=False).first.click(); pg.wait_for_timeout(400)
                    for item in pg.evaluate(JS): bad.setdefault(("import:" + name, item["txt"], item["cls"], item["fg"], item["bg"], scheme), item)
                    pg.evaluate("(sheet.stack || []).slice().forEach(x => x.close())"); pg.wait_for_timeout(200)
                except Exception as e: print("übersprungen:", name, str(e)[:60])
            pg.evaluate("location.hash='#/stats'"); pg.wait_for_selector(".chips")
            for tabname in ("Rekorde", "Kalender", "Auswertung", "Ziele"):
                pg.get_by_role("button", name=tabname, exact=True).click(); pg.wait_for_timeout(500)
                for item in pg.evaluate(JS): bad.setdefault(("Statistik " + tabname, item["txt"], item["cls"], item["fg"], item["bg"], scheme), item)
            # Aktionsmenüs auf Tour- und Listenseiten
            for r in (f"#/tour/{tid}", "#/tours", "#/photos"):
                pg.evaluate(f"location.hash='{r}'"); pg.wait_for_timeout(600)
                for el in pg.locator("header.top button[aria-label]").all()[:4]:
                    try:
                        el.click(timeout=1500); pg.wait_for_timeout(300)
                        for item in pg.evaluate(JS): bad.setdefault((r + " Menü", item["txt"], item["cls"], item["fg"], item["bg"], scheme), item)
                        pg.evaluate("(sheet.stack || []).slice().forEach(x => x.close())"); pg.keyboard.press("Escape"); pg.wait_for_timeout(150)
                    except Exception: pass
            ctx.close()
        b.close()
    for (r, txt, cls, fg, bg, scheme), it in sorted(bad.items(), key=lambda kv: kv[1]["ratio"]):
        print(f'{it["ratio"]:5} {scheme:5} {r:22} „{txt}“ {cls} {fg} auf {bg}' + (" (deaktiviert)" if it["dis"] else ""))
    print(len(bad), "Stellen unter 4,5:1")
    if "--fail" in sys.argv and bad: sys.exit(1)

if __name__ == "__main__":
    main()
