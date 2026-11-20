"""Prüft „Aus Meine Touren holen“ (2.1.0) gegen einen ECHTEN Server der Schwester-App „Meine Touren“. Nicht Teil der CI.

Aufruf:  python3 tests/check_meine_touren.py [Pfad zu meine-touren] [--fixtures] [--shots Ordner]
         (ohne Pfad: Umgebungsvariable MT_REPO, sonst der Nachbarordner ../meine-touren)

Was geschieht:
  1. Ein Meine-Touren-Server wird aus dem angegebenen Ordner gestartet – mit eigenem, leerem Datenverzeichnis (temporär) und Testdaten
     (Besitzer „Volker“, Betrachter „Tagebuch“, Konto mit Zwei-Faktor „Zweifach“, 17 Touren). Am Ordner selbst wird nichts geändert.
  2. Die App läuft im Browser (Playwright). Die Android-Brücke `Native.http` wird so nachgestellt, wie sie in MainActivity.httpCall gebaut ist:
     kein Cookie-Speicher, Antwort-Kopfzeilen in Kleinbuchstaben (bei mehreren gleichnamigen die letzte), Text als UTF-8.
  3. Geprüft wird der ganze Ablauf: falsches Passwort, Anmeldung als Betrachter und als Besitzer, Zwei-Faktor, Liste, Strecken,
     Abgleich (neu / vorhanden / Namen / Zahlen / Sportarten), Wiederholung ohne Doppelte, Korrektur der Spur, Schalter aus,
     Umbenennen am Server, Abmelden, abgelaufene Sitzung, nicht erreichbarer Server.
  Mit --fixtures werden die echten Antworten bereinigt (Sitzungsschlüssel ersetzt) nach tests/data/meine-touren-beispiel.json geschrieben;
  tests/test_web.py spielt sie hinter einer nachgestellten Native.http ab."""
import base64, hashlib, hmac, json, os, socket, socketserver, struct, subprocess, sys, tempfile, threading, time, urllib.error, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import test_web as T  # noqa: E402

SEED = r'''
import sys, os, math, time, random
sys.dont_write_bytecode = True
sys.path.insert(0, sys.argv[1])
from app import auth, ctx, db, config, routes, tracks
from datetime import datetime, timezone
random.seed(7)
def gpx(t0, n=120, lat=47.42, lon=11.05, ele0=820, step=40, amp=260, hr=False):
    f = lambda ts: datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    pts = []
    for i in range(n):
        e = ele0 + amp * math.sin(math.pi * i / (n - 1)) + random.uniform(-1.5, 1.5)
        x = '<extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>%d</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions>' % (130 + int(30 * math.sin(i / 20))) if hr else ""
        pts.append('<trkpt lat="%.6f" lon="%.6f"><ele>%.1f</ele><time>%s</time>%s</trkpt>' % (lat + i * 0.00032, lon + 0.004 * math.sin(i / 15), e, f(t0 + i * step), x))
    return ('<?xml version="1.0"?><gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1" xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1">'
            '<trk><name>Tour</name><type>hiking</type><trkseg>' + "".join(pts) + '</trkseg></trk></gpx>')
T = lambda y, m, d, hh=9, mi=0: int(datetime(y, m, d, hh, mi, tzinfo=timezone.utc).timestamp())
uid = auth.create_user("Volker", "geheim-1234", "admin", "volker@example.com")
vid = auth.create_user("Tagebuch", "nur-lesen-1234", "viewer", None); auth.set_viewer_owner(vid, uid)
zid = auth.create_user("Zweifach", "zwei-faktor-1234", "user", "zwei@example.com")
auth.q("UPDATE users SET totp_secret=?, totp_on=1 WHERE uid=?", ("JBSWY3DPEHPK3PXP", zid))
with ctx.as_user(uid):
    db.init(); config.TRACK_DIR.mkdir(parents=True, exist_ok=True)
    tracks.adopt(gpx(T(2026, 8, 14, 7, 30), hr=True), "a.gpx", ident="g1", name="Kramerspitz über den Kramersteig")
    tracks.adopt(gpx(T(2026, 8, 20, 8, 0), n=1800, step=10, lat=47.50, amp=640), "b.gpx", ident="g2", name="Große Runde mit vielen Punkten")
    tracks.adopt(gpx(T(2026, 9, 2, 10, 0), n=60, lat=47.60, lon=11.3, amp=90), "c.gpx", ident="g3", name="Loisach-Radweg", sport="touringbicycle")
    tracks.adopt(gpx(T(2026, 9, 5, 10, 0), lat=47.61, lon=11.3, amp=420), "d.gpx", ident="g4", name="Feierabendrunde E-Bike", sport="e_touringbicycle")
    for i, sp in enumerate(["mtb", "e_mtb", "racebike", "jogging", "skialpin", "skitour", "snowshoe", "nordic", "nordicwalking", "mountaineering", "other"]):
        tracks.adopt(gpx(T(2026, 1, 3 + i, 9, 0), n=30, lat=47.3 + i * 0.01, amp=120), "s%d.gpx" % i, ident="s%d" % i, name="Sportart " + sp, sport=sp)
    ts = T(2026, 7, 4, 6, 45)      # Komoot-Tour: nur Streckenpunkte im Zwischenspeicher, keine GPX-Datei
    db.execute("INSERT INTO tours(id,name,sport,start_ts,end_ts,dist_m,dur_s,up_m,down_m,lat,lng,status,source) VALUES('987654321','Zugspitze durchs Reintal','hike',?,?,21400,27000,2210,160,47.40,11.10,'tour_recorded','komoot')", (ts, ts + 27000))
    routes.store("987654321", [(47.40 + i * 0.0008, 11.10 + i * 0.0005, 760 + i * 14.5, i * 180000) for i in range(150)])
    ts2 = T(2026, 6, 1, 8, 0)      # Komoot-Tour ohne Strecke am Server
    db.execute("INSERT INTO tours(id,name,sport,start_ts,end_ts,dist_m,dur_s,up_m,down_m,lat,lng,status,source) VALUES('987654322','Ohne Strecke','hike',?,?,5000,5400,300,300,47.1,11.2,'tour_recorded','komoot')", (ts2, ts2 + 5400))
    db.execute("INSERT OR REPLACE INTO tour_notes(id,note) VALUES('g1','Früh los, oben Gämsen gesehen.')")
    db.execute("INSERT OR REPLACE INTO tour_rating(id,stars) VALUES('g1',5)")
    db.execute("INSERT OR REPLACE INTO tour_tags(id,tag) VALUES('g1','Wetterstein')"); db.execute("INSERT OR REPLACE INTO tour_tags(id,tag) VALUES('g1','Gipfel')")
    db.execute("INSERT OR REPLACE INTO elev_fix(id,orig_up,orig_down,up_m,down_m,ts,src) VALUES('g2',700,690,655,650,?, 'zepp')", (int(time.time()),))
    db.execute("UPDATE tours SET up_m=655, down_m=650 WHERE id='g2'")      # am Server korrigierter Aufstieg (Höhe aus der Uhr)
with ctx.as_user(zid):
    db.init(); config.TRACK_DIR.mkdir(parents=True, exist_ok=True)
    tracks.adopt(gpx(T(2026, 5, 5), n=30), "z.gpx", ident="z1", name="Tour im 2FA-Konto")
'''

LAUNCH = r'''
import sys
sys.dont_write_bytecode = True
sys.path.insert(0, sys.argv[1])
import uvicorn
from app.main import app
uvicorn.run(app, host="127.0.0.1", port=int(sys.argv[2]), log_level="warning")
'''

PW = {"Volker": "geheim-1234", "Tagebuch": "nur-lesen-1234", "Zweifach": "zwei-faktor-1234"}
LOG = []          # jeder Aufruf der nachgestellten Brücke: (Methode, Pfad, Status)


def totp(secret="JBSWY3DPEHPK3PXP", t=None):
    step = int((t or time.time()) // 30)
    d = hmac.new(base64.b32decode(secret), struct.pack(">Q", step), hashlib.sha1).digest()
    o = d[-1] & 15
    return "%06d" % ((struct.unpack(">I", d[o:o + 4])[0] & 0x7fffffff) % 1000000)


def bridge_http(arg):
    """Wie MainActivity.httpCall (OkHttp ohne Cookie-Speicher): gibt JSON {status, headers, body|b64} zurück; Verbindungsfehler werfen."""
    a = json.loads(arg)
    method = (a.get("method") or "GET").upper()
    data = None
    headers = dict(a.get("headers") or {})
    if "body" in a:
        data = a["body"].encode("utf-8"); headers["Content-Type"] = a.get("contentType", "text/plain; charset=utf-8")
    elif method not in ("GET", "HEAD"):
        data = b""
    req = urllib.request.Request(a["url"], data=data, method=method, headers=headers)
    try:
        r = urllib.request.build_opener().open(req, timeout=20)
    except urllib.error.HTTPError as e:
        r = e
    body = r.read()
    hd = {}
    for k, v in r.headers.items():
        hd[k.lower()] = v          # bei mehreren gleichnamigen Kopfzeilen bleibt die letzte – wie Response.header(name) von OkHttp
    LOG.append((method, a["url"].split("//", 1)[1].split("/", 1)[1] if "/" in a["url"].split("//", 1)[1] else "", r.status if hasattr(r, "status") else r.code))
    out = {"status": getattr(r, "status", None) or r.code, "headers": hd}
    if a.get("bin"): out["b64"] = base64.b64encode(body).decode()
    else: out["body"] = body.decode("utf-8", "replace")
    return json.dumps(out)


def direct(url, path, method="GET", js=None, cookie=None):
    """Direkter Aufruf am Server (ohne App) – zum Gegenprüfen."""
    h = {"Accept": "application/json"}
    if cookie: h["Cookie"] = "kh_session=" + cookie
    data = None
    if js is not None: data = json.dumps(js).encode(); h["Content-Type"] = "application/json"
    elif method != "GET": data = b""
    try: r = urllib.request.build_opener().open(urllib.request.Request(url + path, data=data, method=method, headers=h), timeout=20)
    except urllib.error.HTTPError as e: r = e
    return (getattr(r, "status", None) or r.code), r.headers, r.read().decode("utf-8", "replace")


def login_direct(url, name):
    st, hd, body = direct(url, "/api/login", "POST", {"name": name, "password": PW[name]})
    assert st == 200, (st, body)
    return hd["set-cookie"].split("kh_session=")[1].split(";")[0]


def start_server(repo, tmp):
    data = os.path.join(tmp, "data")
    env = dict(os.environ, DATA_DIR=data, PHOTOS_DIR=os.path.join(tmp, "p"), BACKUP_DIR=os.path.join(tmp, "b"), MT_NO_SCHEDULER="1", PYTHONDONTWRITEBYTECODE="1")
    for name, src in (("seed.py", SEED), ("launch.py", LAUNCH)):
        with open(os.path.join(tmp, name), "w", encoding="utf-8") as f: f.write(src)
    out = subprocess.run([sys.executable, os.path.join(tmp, "seed.py"), repo], capture_output=True, text=True, cwd=tmp, env=env)
    assert out.returncode == 0, out.stderr[-2000:]
    s = socket.socket(); s.bind(("127.0.0.1", 0)); port = s.getsockname()[1]; s.close()
    pr = subprocess.Popen([sys.executable, os.path.join(tmp, "launch.py"), repo, str(port)], cwd=tmp, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    url = f"http://127.0.0.1:{port}"
    for _ in range(150):
        try: urllib.request.urlopen(url + "/api/version", timeout=1); break
        except Exception: time.sleep(0.2)
    else:
        pr.kill(); raise SystemExit("Server startet nicht")
    return pr, url


WRAP = """
(() => { const c0 = window.MTApp.call; window.MTApp.call = (id, m, a) => {
  if (m !== 'http') return c0(id, m, a);
  window.__pyHttp(a).then(r => window.__mtcb(+id, true, r), e => window.__mtcb(+id, false, 'java.net.ConnectException: Failed to connect'));
}; })();
"""


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    shots = sys.argv[sys.argv.index("--shots") + 1] if "--shots" in sys.argv else None
    if shots: args = [a for a in args if a != shots]
    repo = os.path.abspath(args[0] if args else os.environ.get("MT_REPO") or os.path.join(HERE, "..", "..", "meine-touren"))
    assert os.path.exists(os.path.join(repo, "app", "main.py")), "Kein Meine-Touren-Ordner: " + repo
    from playwright.sync_api import sync_playwright
    tmp = tempfile.mkdtemp(prefix="mt-check-")
    pr, url = start_server(repo, tmp)
    web = socketserver.TCPServer(("127.0.0.1", 0), T.Q); threading.Thread(target=web.serve_forever, daemon=True).start()
    fx = {"hinweis": "Echte Antworten eines lokalen Testservers von „Meine Touren“ (erzeugt mit tests/check_meine_touren.py --fixtures); Sitzungsschlüssel ersetzt.", "version": None, "antworten": {}, "gpx": {}}
    try:
        st, _, body = direct(url, "/api/version"); assert st == 200; fx["version"] = json.loads(body)["version"]; print("Server:", fx["version"], url)
        # --- Server allein: Endpunkte, Rollen, keine Herkunftsprüfung für Nicht-Browser ---
        st, hd, body = direct(url, "/api/tours"); assert st == 401 and json.loads(body)["detail"] == "Bitte anmelden"; fx["antworten"]["ohne_sitzung"] = {"status": st, "body": body}
        st, hd, body = direct(url, "/api/me"); assert st == 200 and json.loads(body)["users_enabled"] is True and json.loads(body)["user"] is None; fx["antworten"]["me"] = {"status": st, "body": body}
        st, hd, body = direct(url, "/api/login", "POST", {"name": "Tagebuch", "password": "falsch"}); assert st == 401, st; fx["antworten"]["login_falsch"] = {"status": st, "body": body}
        st, hd, body = direct(url, "/api/login", "POST", {"name": "Tagebuch", "password": PW["Tagebuch"]}); assert st == 200 and "kh_session=" in hd["set-cookie"] and len(hd.get_all("set-cookie")) == 1
        vtok = hd["set-cookie"].split("kh_session=")[1].split(";")[0]
        fx["antworten"]["login_betrachter"] = {"status": st, "headers": {"set-cookie": hd["set-cookie"].replace(vtok, "SITZUNG-BETRACHTER-BEISPIEL")}, "body": body}
        st, hd, body = direct(url, "/api/tours", cookie=vtok); assert st == 200; srv = json.loads(body); assert len(srv) == 17, len(srv); fx["antworten"]["tours"] = {"status": st, "body": body}
        for t in srv:
            st, hd, g = direct(url, f"/api/tours/{t['id']}/gpx", cookie=vtok)
            if t["id"] == "987654322": assert st == 404; fx["antworten"]["gpx_fehlt"] = {"status": st, "body": g}
            else:
                assert st == 200 and "<trkpt" in g, (t["id"], st)
                if t["id"] not in ("g2", "g4", "987654321"): fx["gpx"][t["id"]] = g      # nur Touren, die im Web-Test neu angelegt werden
        assert direct(url, "/api/tours/g2/gpx", cookie=vtok)[2].count("<trkpt") == 1501, "Der Server liefert höchstens 1500 Punkte je Strecke (Zwischenspeicher der Koordinaten)"
        for path, js in (("/api/tours/g1/rename", {"name": "x"}), ("/api/settings", {"live_mode": "on"})):
            st, _, body = direct(url, path, "POST", js, cookie=vtok); assert st == 403, (path, st)      # Betrachter darf nichts ändern
        st, hd, body = direct(url, "/api/login", "POST", {"name": "Zweifach", "password": PW["Zweifach"]}); j = json.loads(body); assert st == 200 and j["need_2fa"] and j["ticket"] and "set-cookie" not in hd
        fx["antworten"]["login_2fa_noetig"] = {"status": st, "body": json.dumps({"need_2fa": True, "ticket": "TICKET-BEISPIEL"})}
        st, hd, body = direct(url, "/api/login/2fa", "POST", {"ticket": j["ticket"], "code": "000000"}); assert st == 401; fx["antworten"]["login_2fa_falsch"] = {"status": st, "body": body}
        st, hd, body = direct(url, "/api/login/2fa", "POST", {"ticket": j["ticket"], "code": totp()}); assert st == 200 and "kh_session=" in hd["set-cookie"], (st, body)
        ztok = hd["set-cookie"].split("kh_session=")[1].split(";")[0]
        fx["antworten"]["login_2fa_ok"] = {"status": st, "headers": {"set-cookie": hd["set-cookie"].replace(ztok, "SITZUNG-ZWEIFACH-BEISPIEL")}, "body": body}
        st, hd, body = direct(url, "/api/logout", "POST", cookie=ztok); assert st == 200; fx["antworten"]["logout"] = {"status": st, "body": body}
        assert direct(url, "/api/tours", cookie=ztok)[0] == 401
        direct(url, "/api/logout", "POST", cookie=vtok)
        if "--fixtures" in sys.argv:
            assert vtok not in json.dumps(fx) and ztok not in json.dumps(fx)
            with open(os.path.join(HERE, "data", "meine-touren-beispiel.json"), "w", encoding="utf-8") as f: json.dump(fx, f, ensure_ascii=False, indent=1)
            print("Beispieldaten geschrieben:", os.path.join(HERE, "data", "meine-touren-beispiel.json"))

        # --- Die App gegen den Server ---
        errs = []
        with sync_playwright() as p:
            b = p.chromium.launch(); ctx = b.new_context(viewport={"width": 390, "height": 800})
            ctx.expose_function("__pyHttp", bridge_http); ctx.add_init_script(T.MOCK); ctx.add_init_script(WRAP)
            pg = ctx.new_page()
            pg.on("pageerror", lambda e: errs.append("PAGEERROR " + str(e)))
            png = bytes.fromhex("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000001e221bc330000000049454e44ae426082")
            pg.route("**/tile.openstreetmap.org/**", lambda r: r.fulfill(status=200, body=png, content_type="image/png"))
            pg.goto(f"http://127.0.0.1:{web.server_address[1]}/index.html"); pg.wait_for_selector("#tabs a")
            by = {t["id"]: t for t in srv}
            # Vorhandene Touren in der App: g2 als Datei mit selbst erzeugtem Namen, g4 als Datei mit eigenem Namen, die Komoot-Tour (andere Spur, gleiche Komoot-Nummer)
            otok = login_direct(url, "Volker")
            pre = pg.evaluate("""async ([g2, g4, t0]) => { const enc = s => new TextEncoder().encode(s);
              await Import.fromData('g2.gpx', enc(g2), 'file'); await Import.fromData('g4.gpx', enc(g4), 'file');
              const l = await Tours.list(); const a = l.find(t => /Große Runde/.test(t.name)), b = l.find(t => /Feierabend/.test(t.name));
              a.name = Tours.autoName(a.sport, a.start); await Tours.save(a); b.name = 'Mein eigener Name'; await Tours.save(b);
              const k = (await Tours.add({ name: 'Komoot-Name alt', sport: 'hike', src: 'komoot', srcId: 'komoot:987654321', pts: Array.from({ length: 50 }, (_, i) => ({ lat: 47.4 + i * 0.002, lon: 11.1, ele: 800 + i * 20, t: t0 + i * 60000 })) })).tour;
              k.nameKomoot = k.name; await Tours.save(k);
              return { a: { id: a.id, up: a.up, dist: a.dist }, b: b.id, k: k.id }; }""",
                              [direct(url, "/api/tours/g2/gpx", cookie=otok)[2], direct(url, "/api/tours/g4/gpx", cookie=otok)[2], by["987654321"]["start_ts"] * 1000 + 3 * 3600000])
            # A. falsches Passwort: verständliche Meldung, nichts gemerkt
            bad = pg.evaluate("async ([u]) => { try { await Import.MT.login(u, 'Tagebuch', 'falsch'); return 'ok'; } catch (e) { return e.message; } }", [url])
            assert bad == "Name oder Passwort stimmt nicht", bad
            assert pg.evaluate("DB.kvGet('mt', null)") is None
            # B. Anmeldung über das Blatt (Betrachter), Abgleich mit Fortschritt
            pg.evaluate("location.hash = '#/import'"); pg.wait_for_selector("#imp-mt"); pg.click("#imp-mt"); pg.wait_for_selector("#mt-url")
            pg.fill("#mt-url", url); assert "nicht verschlüsselt" in pg.inner_text("#mt-http")
            pg.fill("#mt-name", "tagebuch"); pg.fill("#mt-pw", PW["Tagebuch"])
            if shots: os.makedirs(shots, exist_ok=True); pg.wait_for_timeout(300); pg.screenshot(path=os.path.join(shots, "echt-anmelden.png"))
            LOG.clear(); pg.click("#mt-go")
            pg.wait_for_function("document.querySelector('#toast') && /importiert/.test(document.querySelector('#toast').textContent)", timeout=60000)
            msg = pg.inner_text("#toast"); print("Erster Abgleich:", msg)
            assert "13 Touren importiert" in msg and "3 schon vorhanden" in msg and "Name bei 2 Touren übernommen" in msg and "1 ohne Strecke auf dem Server" in msg and "Zahlen bei" in msg, msg
            assert [x for x in LOG if x[1] == "api/login"] and [x for x in LOG if x[1] == "api/tours"] and len([x for x in LOG if x[1].endswith("/gpx")]) == 14, LOG      # 13 neue + 1 ohne Strecke; g2, g4 und die Komoot-Tour werden nicht geladen
            kv = pg.evaluate("DB.all('kv')"); acc = [k for k in kv if k["k"] == "mt"][0]["v"]
            assert acc["role"] == "viewer" and acc["name"] == "Tagebuch" and len(acc["token"]) > 20 and acc["base"] == url, acc
            assert PW["Tagebuch"] not in json.dumps(kv), "Das Passwort darf nirgends gespeichert sein"
            assert acc["token"] not in json.dumps(pg.evaluate("Backup.collect()")), "Der Sitzungsschlüssel darf nicht in die Sicherung"
            st = pg.evaluate("""async ([ids]) => { const l = await Tours.list(), g = id => l.find(t => t.srcId === 'mt:' + id || t.mtId === id);
              const o = {}; for (const id of ids) { const t = g(id); o[id] = t ? { name: t.name, sport: t.sport, up: t.up, down: t.down, dist: t.dist, zMt: t.zMt, upSrc: t.upSrc, src: t.src, mtId: t.mtId, note: t.note, stars: t.starsMt, tags: t.tags, hr: t.hrAvg, nameMt: t.nameMt, start: t.start } : null; }
              return { o, n: l.length }; }""", [list(by)])
            o = st["o"]; assert st["n"] == 16 and o["987654322"] is None, st["n"]
            for t in srv:      # dieselben Zahlen wie am Server – Tour für Tour
                if t["id"] == "987654322": continue
                a = o[t["id"]]; assert a and a["zMt"] == 1 and a["upSrc"] == "mt" and abs(a["up"] - t["up_m"]) < 1e-6 and abs(a["down"] - t["down_m"]) < 1e-6 and abs(a["dist"] - t["dist_m"]) < 1e-6 and (a["start"] == t["start_ts"] * 1000 or t["id"] == "987654321"), (t["id"], a, t)      # die Komoot-Tour der App hat absichtlich eine andere Startzeit (Zuordnung über die Komoot-Nummer)
            assert o["g2"]["name"] == "Große Runde mit vielen Punkten" and o["g2"]["src"] == "file" and o["g2"]["mtId"] == "g2" and o["g2"]["up"] == 655 and abs(pre["a"]["up"] - 655) > 5, (o["g2"], pre)
            assert o["g4"]["name"] == "Mein eigener Name" and o["g4"]["nameMt"] is None and o["g4"]["sport"] == "ebike", o["g4"]
            assert o["987654321"]["name"] == "Zugspitze durchs Reintal" and o["987654321"]["src"] == "komoot" and o["987654321"]["up"] == 2210, o["987654321"]
            assert o["g1"]["note"] == "Früh los, oben Gämsen gesehen." and o["g1"]["stars"] == 5 and sorted(o["g1"]["tags"]) == ["Gipfel", "Wetterstein"] and o["g1"]["hr"] and o["g1"]["src"] == "mt", o["g1"]
            sports = {t["sport"]: o[t["id"]]["sport"] for t in srv if o.get(t["id"])}
            print("Sportarten:", sports)
            assert sports == {"hike": "hike", "touringbicycle": "bike", "e_touringbicycle": "ebike", "mtb": "mtb", "e_mtb": "ebike", "racebike": "racebike", "jogging": "run", "skialpin": "ski", "skitour": "ski",
                              "snowshoe": "ski", "nordic": "ski", "nordicwalking": "hike", "mountaineering": "mountaineering", "other": "other"}, sports
            sumS = (sum(t["dist_m"] for t in srv if t["id"] != "987654322"), sum(t["up_m"] for t in srv if t["id"] != "987654322"))
            sumA = pg.evaluate("Tours.list().then(l => [l.reduce((s, t) => s + t.dist, 0), l.reduce((s, t) => s + t.up, 0)])")
            assert abs(sumS[0] - sumA[0]) < 0.01 and abs(sumS[1] - sumA[1]) < 0.01, (sumS, sumA); print("Summen gleich: %.1f km, ↑ %.0f m" % (sumA[0] / 1000, sumA[1]))
            # Blatt im verbundenen Zustand
            pg.click("#imp-mt"); pg.wait_for_selector("#mt-state"); assert "Verbunden mit 127.0.0.1" in pg.inner_text("#mt-state") and "als Tagebuch (nur ansehen)" in pg.inner_text("#mt-state")
            if shots: pg.wait_for_timeout(300); pg.screenshot(path=os.path.join(shots, "echt-verbunden.png"))
            # C. Wiederholung: nichts doppelt, keine Strecke wird noch einmal geladen (außer dem Versuch für die Tour ohne Strecke)
            LOG.clear(); pg.click("#mt-go"); pg.wait_for_function("document.querySelector('#toast') && /schon vorhanden/.test(document.querySelector('#toast').textContent) && !document.querySelector('.sheet')", timeout=60000)
            msg2 = pg.inner_text("#toast"); print("Zweiter Abgleich:", msg2)
            assert msg2 == "16 schon vorhanden · 1 ohne Strecke auf dem Server", msg2
            assert [x[1] for x in LOG] == ["api/tours", "api/tours/987654322/gpx"], LOG
            sync = "async (z) => Import.MT.importAll(await DB.kvGet('mt'), { zahlen: z }, null)"
            # D. Spur in der App korrigiert → eigene Rechnung; nächster Abgleich → wieder die Zahlen aus Meine Touren
            own = pg.evaluate("id => Tours.recalc(id, { eigen: true }).then(t => [t.up, t.zMt, t.upSrc, t.upMt])", pre["a"]["id"])
            assert abs(own[0] - pre["a"]["up"]) < 1e-6 and own[1] is None and own[2] is None and own[3] == 655, own
            r = pg.evaluate(sync, True); assert r["zahlen"] == 1 and r["added"] == 0 and r["dup"] == 16, r
            assert pg.evaluate("id => DB.get('tours', id).then(t => [t.up, t.zMt])", pre["a"]["id"]) == [655, 1]
            # E. Schalter aus: überall wieder die eigene Rechnung; Schalter an: wieder angeglichen
            r = pg.evaluate(sync, False); z = pg.evaluate("Tours.list().then(l => [l.filter(t => t.zMt).length, l.filter(t => t.upSrc === 'mt').length, l.filter(t => t.upMt != null).length])")
            assert z == [0, 0, 16] and r["zahlen"] == 0, (r, z)
            assert abs(pg.evaluate("id => DB.get('tours', id).then(t => t.up)", pre["a"]["id"]) - pre["a"]["up"]) < 1e-6
            r = pg.evaluate(sync, True); assert r["zahlen"] >= 1 and pg.evaluate("Tours.list().then(l => l.filter(t => t.zMt).length)") == 16, r
            # F. Am Server umbenannt (Besitzer): der Name zieht nach; ein in der App vergebener Name bleibt
            assert direct(url, "/api/tours/g1/rename", "POST", {"name": "Kramerspitz (neu benannt)"}, cookie=otok)[0] == 200
            r = pg.evaluate(sync, True); assert r["namesMt"] == 1, r
            assert pg.evaluate("Tours.list().then(l => [l.find(t => t.srcId === 'mt:g1').name, l.find(t => t.mtId === 'g4').name])") == ["Kramerspitz (neu benannt)", "Mein eigener Name"]
            # G. Abmelden: Schlüssel weg, am Server ungültig
            tok = acc["token"]; assert direct(url, "/api/tours", cookie=tok)[0] == 200
            pg.evaluate("(sheet.stack || []).slice().forEach(x => x.close())"); pg.wait_for_selector(".sheet", state="detached")
            pg.click("#imp-mt"); pg.wait_for_selector("#mt-off"); pg.click("#mt-off"); pg.wait_for_selector("#mt-url")
            assert pg.input_value("#mt-url") == url and pg.input_value("#mt-name") == "Tagebuch" and pg.input_value("#mt-pw") == ""
            assert pg.evaluate("DB.kvGet('mt', null)") == {"base": url, "name": "Tagebuch"} and direct(url, "/api/tours", cookie=tok)[0] == 401
            pg.evaluate("(sheet.stack || []).slice().forEach(x => x.close())")
            # H. Abgelaufene Sitzung: freundliche Meldung, Schlüssel vergessen, neu anmelden möglich
            acc2 = pg.evaluate("async ([u, n, p]) => Import.MT.login(u, n, p)", [url, "Volker", PW["Volker"]]); assert acc2["role"] == "admin", acc2      # Besitzer geht ebenso
            direct(url, "/api/logout", "POST", cookie=acc2["token"])
            ex = pg.evaluate("async () => { try { await Import.MT.importAll(await DB.kvGet('mt'), {}, null); return null; } catch (e) { return { m: e.message, re: !!e.relogin, kv: await DB.kvGet('mt') }; } }")
            assert ex and ex["re"] and "abgelaufen" in ex["m"] and "token" not in ex["kv"] and acc2["token"] not in ex["m"], ex
            # I. Zwei-Faktor: falscher Code, richtiger Code
            two = pg.evaluate("async ([u, n, p]) => { const a = await Import.MT.login(u, n, p); let bad = ''; try { await Import.MT.login2fa(u, a.ticket, '000000'); } catch (e) { bad = e.message; } return { need: a.need2fa, ticket: a.ticket, bad }; }", [url, "Zweifach", PW["Zweifach"]])
            assert two["need"] and two["bad"] == "Der Code stimmt nicht", two
            acc3 = pg.evaluate("async ([u, t, c]) => { const a = await Import.MT.login2fa(u, t, c); return { a, n: (await Import.MT.tours(a)).length }; }", [url, two["ticket"], totp(t=time.time() + 30)])      # ein Zeitschritt gilt am Server nur einmal (oben schon benutzt); der nächste wird angenommen (± 30 s)
            assert acc3["a"]["name"] == "Zweifach" and acc3["n"] == 1, acc3
            pg.evaluate("async () => Import.MT.logout(await DB.kvGet('mt'))")
            # J. Server nicht erreichbar, falsche Adresse
            s = socket.socket(); s.bind(("127.0.0.1", 0)); dead = s.getsockname()[1]; s.close()
            down = pg.evaluate("async (u) => { try { await Import.MT.login(u, 'x', 'y'); return 'ok'; } catch (e) { return e.message; } }", f"http://127.0.0.1:{dead}")
            assert "nicht erreichbar" in down and "x" not in down.split("erreichbar")[1].replace("prüfen", ""), down
            other = pg.evaluate("async (u) => { try { await Import.MT.login(u, 'x', 'y'); return 'ok'; } catch (e) { return e.message; } }", f"http://127.0.0.1:{web.server_address[1]}")
            assert "antwortet kein „Meine Touren“" in other, other
            b.close()
        assert not errs, errs
        print("OK – Abgleich gegen den echten Server geprüft")
    finally:
        pr.terminate()
        try: pr.wait(10)
        except subprocess.TimeoutExpired: pr.kill()
        import shutil; shutil.rmtree(tmp, ignore_errors=True)      # Datenverzeichnis des Testservers wieder entfernen


if __name__ == "__main__":
    main()
