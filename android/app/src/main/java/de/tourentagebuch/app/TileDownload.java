package de.tourentagebuch.app;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.os.PowerManager;
import android.webkit.WebResourceResponse;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;

import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;

/**
 * 2.11.0: Offline-Karten. Lädt die Kacheln eines Ausschnitts (Rechnung und Grenzen in {@link TilePlan}) nach
 * filesDir/tiles/&lt;quelle&gt;/&lt;z&gt;/&lt;x&gt;/&lt;y&gt;.png, nur fehlende, höchstens zwei Anfragen gleichzeitig mit kleiner Pause,
 * mit Wiederholung bei Netzfehlern; abbrechbar; auf Wunsch nur im WLAN. Wie bei der Medien-Sicherung (2.10.0):
 * eigener Faden, Wake-Lock und Vordergrunddienst {@link ImportService} mit Fortschritt in der Benachrichtigung;
 * die Oberfläche holt den Stand über 'tilesJob' ab.
 *
 * Die Liste der Ausschnitte steht in tiles/gebiete.json, die Kacheln jedes Ausschnitts in tiles/gebiete/&lt;id&gt;.txt
 * (eine Zeile „z/x/y“). Beim Löschen bleiben Kacheln, die ein anderer Ausschnitt derselben Quelle auch braucht.
 * Ausliefern: {@link #serve} (virtueller Server /tiles/…) und {@link #intercept} (Kachel-Adressen der Kartenserver
 * im WebView – vorhandene Kachel aus dem Speicher, sonst geht die Anfrage normal ins Netz).
 */
final class TileDownload {
    private TileDownload() { }

    private static final AtomicBoolean cancel = new AtomicBoolean(false);
    private static volatile boolean running;
    private static String areaId = "", areaName = "", error = "";
    private static int total, done, loaded, skipped, failed;
    private static boolean cancelled, wifiLost;
    private static long lastNote;
    private static OkHttpClient http;

    static boolean isRunning() { return running; }

    private static volatile File base;
    /** Ordner der Kacheln (einmal ermittelt; getFilesDir nimmt jedes Mal eine Sperre). */
    static File dir(Context c) { File b = base; if (b == null) base = b = new File(c.getFilesDir(), "tiles"); return b; }
    /** 2.16.0: Kachel-Ordner, die es (gerade) nicht gibt, mit Zeitpunkt – spart beim 3D-Flug die Dateisuche je Anfrage (TilePlan.folderOf). */
    private static final ConcurrentHashMap<String, Long> missing = new ConcurrentHashMap<>();
    private static File areasFile(Context c) { return new File(dir(c), "gebiete.json"); }
    private static File listFile(Context c, String id) { return new File(new File(dir(c), "gebiete"), id + ".txt"); }

    /* ---------- Ausliefern ---------- */

    /** Gespeicherte Kachel zu einem relativen Pfad (aus TilePlan, nur Ziffern) oder null. */
    static File file(Context c, String rel) {
        if (rel == null) return null;
        String folder = TilePlan.folderOf(rel);
        long now = System.currentTimeMillis();
        if (folder != null) { Long t = missing.get(folder); if (t != null && TilePlan.missingValid(t, now)) return null; }
        File f = new File(dir(c), rel);
        if (f.isFile() && f.length() > 0) return f;
        File d = f.getParentFile();
        if (folder != null && d != null && !d.isDirectory()) {
            if (missing.size() >= TilePlan.MISSING_MAX) missing.clear();
            missing.put(folder, now);
        }
        return null;
    }

    /** Antwort mit einer gespeicherten Kachel; CORS offen, damit fetch() der Karte sie lesen kann; X-MT-Offline sagt der Oberfläche,
     *  dass sie die Kachel nicht noch einmal in ihren eigenen Zwischenspeicher legen muss. */
    static WebResourceResponse response(File f) throws Exception {
        Map<String, String> h = new HashMap<>();
        h.put("Access-Control-Allow-Origin", "*");
        h.put("Access-Control-Expose-Headers", "X-MT-Offline");
        h.put("X-MT-Offline", "1");
        h.put("Cache-Control", "no-cache");
        h.put("Content-Length", Long.toString(f.length()));
        WebResourceResponse r = new WebResourceResponse("image/png", null, new FileInputStream(f));
        r.setStatusCodeAndReasonPhrase(200, "OK");
        r.setResponseHeaders(h);
        return r;
    }

    /** Kachel-Adresse eines bekannten Kartenservers: gespeicherte Kachel liefern, sonst null (normal ins Netz). */
    static WebResourceResponse intercept(Context c, String host, String path) {
        try {
            File f = file(c, TilePlan.remotePath(host, path));
            return f == null ? null : response(f);
        } catch (Exception e) { return null; }
    }

    /* ---------- Liste ---------- */

    private static synchronized JSONArray readAreas(Context c) {
        try {
            File f = areasFile(c);
            if (!f.isFile()) return new JSONArray();
            return new JSONArray(new String(java.nio.file.Files.readAllBytes(f.toPath()), StandardCharsets.UTF_8));
        } catch (Exception e) { AppLog.log("Offline-Karten: Liste unlesbar: " + e); return new JSONArray(); }
    }

    private static synchronized void writeAreas(Context c, JSONArray a) throws Exception {
        File d = dir(c);
        d.mkdirs();
        File tmp = new File(d, "gebiete.json.tmp");
        try (FileOutputStream o = new FileOutputStream(tmp)) { o.write(a.toString().getBytes(StandardCharsets.UTF_8)); }
        if (!tmp.renameTo(areasFile(c))) throw new Exception("Liste der Offline-Karten nicht gespeichert");
    }

    private static synchronized JSONObject findArea(Context c, String id) {
        JSONArray a = readAreas(c);
        for (int i = 0; i < a.length(); i++) { JSONObject o = a.optJSONObject(i); if (o != null && id.equals(o.optString("id"))) return o; }
        return null;
    }

    private static synchronized void putArea(Context c, JSONObject area) throws Exception {
        JSONArray a = readAreas(c), out = new JSONArray();
        boolean put = false;
        for (int i = 0; i < a.length(); i++) {
            JSONObject o = a.optJSONObject(i);
            if (o == null) continue;
            if (area.optString("id").equals(o.optString("id"))) { out.put(area); put = true; } else out.put(o);
        }
        if (!put) out.put(area);
        writeAreas(c, out);
    }

    /** Belegter Platz aller Kacheln (Bytes). */
    static long usedBytes(Context c) {
        long[] s = {0};
        walk(dir(c), s, 0);
        return s[0];
    }

    private static void walk(File d, long[] s, int depth) {
        File[] fs = d.listFiles();
        if (fs == null || depth > 5) return;
        for (File f : fs) {
            if (f.isDirectory()) walk(f, s, depth + 1);
            else if (f.getName().endsWith(".png")) s[0] += f.length();
        }
    }

    /** Ausschnitte, belegter Platz, Grenzen, WLAN-Stand. */
    static JSONObject list(Context c) throws Exception {
        JSONArray a = readAreas(c);
        return new JSONObject().put("areas", a).put("bytes", usedBytes(c)).put("max", TilePlan.MAX_TOTAL).put("maxTiles", TilePlan.MAX_TILES)
                .put("running", running).put("wifi", onWifi(c));
    }

    /** Im WLAN (oder per Kabel)? Braucht ACCESS_NETWORK_STATE (vorhanden seit 1.x). */
    static boolean onWifi(Context c) {
        try {
            ConnectivityManager cm = (ConnectivityManager) c.getSystemService(Context.CONNECTIVITY_SERVICE);
            if (cm == null) return false;
            Network n = cm.getActiveNetwork();
            NetworkCapabilities nc = n == null ? null : cm.getNetworkCapabilities(n);
            return nc != null && (nc.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) || nc.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET));
        } catch (Exception e) { return false; }
    }

    /* ---------- Stand ---------- */

    static synchronized JSONObject job() throws Exception {
        JSONObject o = new JSONObject().put("running", running).put("id", areaId).put("name", areaName).put("total", total).put("done", done)
                .put("loaded", loaded).put("skipped", skipped).put("failed", failed).put("cancelled", cancelled).put("wifiLost", wifiLost);
        if (!error.isEmpty()) o.put("error", error);
        return o;
    }

    static void cancel() { if (running) cancel.set(true); }

    private static synchronized boolean begin(String id, String name, int n) {
        if (running) return false;
        running = true; areaId = id; areaName = name; error = ""; cancelled = false; wifiLost = false;
        total = n; done = 0; loaded = 0; skipped = 0; failed = 0; lastNote = 0;
        cancel.set(false);
        return true;
    }

    private static synchronized void step(int kind) {      // 0 geladen, 1 übersprungen, 2 fehlgeschlagen
        done++;
        if (kind == 0) loaded++; else if (kind == 1) skipped++; else failed++;
    }

    private static synchronized void fail(String e) { if (error.isEmpty()) error = e; cancel.set(true); }

    private static void note(Context c, boolean force) {
        long now = System.currentTimeMillis();
        int d, t;
        synchronized (TileDownload.class) {
            if (!force && now - lastNote < 2000) return;
            lastNote = now; d = done; t = total;
        }
        ImportService.update(c, "Offline-Karte laden", d + " von " + t + " Kacheln", d, t);
    }

    /* ---------- Laden ---------- */

    private static double[][] points(JSONArray a) throws Exception {
        int n = Math.min(a.length(), TilePlan.MAX_POINTS);
        double[][] p = new double[n][];
        for (int i = 0; i < n; i++) { JSONArray q = a.getJSONArray(i); p[i] = new double[]{q.getDouble(0), q.getDouble(1)}; }
        return p;
    }

    private static String newId() {
        String s = Long.toString(System.currentTimeMillis(), 36) + Integer.toString((int) (Math.random() * 1296), 36);
        return s.length() > 24 ? s.substring(0, 24) : s;
    }

    /**
     * Neuen Ausschnitt laden ({src, name, kind: rect|route, bbox:[s,w,n,e] | pts:[[lat,lon]…], rand, zmax, wifiOnly})
     * oder einen vorhandenen aktualisieren ({refresh: id, wifiOnly}). Gibt {started, id} oder {started:false, error} zurück.
     */
    static JSONObject start(Context c0, JSONObject a, String version) throws Exception {
        final Context c = c0.getApplicationContext();
        if (running) return new JSONObject().put("started", false).put("error", "Offline-Karte laden läuft schon");
        if (MediaBackup.isRunning()) return new JSONObject().put("started", false).put("error", "Sicherung der Fotos und Videos läuft schon – bitte danach laden");
        final boolean wifiOnly = a.optBoolean("wifiOnly", true);
        if (wifiOnly && !onWifi(c)) return new JSONObject().put("started", false).put("error", "Kein WLAN. Bitte mit einem WLAN verbinden oder „Nur über WLAN“ ausschalten.");
        final boolean refresh = a.has("refresh");
        JSONObject area;
        long[] keys;
        if (refresh) {
            String id = a.getString("refresh");
            if (!TilePlan.validId(id)) throw new Exception("Ungültige Karte");
            area = findArea(c, id);
            if (area == null) throw new Exception("Diese Offline-Karte gibt es nicht mehr");
            keys = readList(c, id);
            if (keys == null) throw new Exception("Kachelliste fehlt – bitte die Karte löschen und neu laden");
            if (!TilePlan.offlineAllowed(area.optString("src"))) throw new Exception("Diese Karte darf nicht offline geladen werden");
        } else {
            String src = a.optString("src");
            int zmax = Math.min(TilePlan.ZMAX, a.optInt("zmax", 15)), zmin = TilePlan.ZMIN;
            double rand = Math.max(0, Math.min(10000, a.optDouble("rand", 2000)));
            TilePlan.Plan p;
            double[] bbox;
            if ("route".equals(a.optString("kind"))) {
                double[][] pts = points(a.getJSONArray("pts"));
                p = TilePlan.corridor(pts, rand, zmin, zmax, TilePlan.MAX_TILES);
                bbox = TilePlan.frame(pts, rand);
            } else {
                JSONArray b = a.getJSONArray("bbox");
                double s = b.getDouble(0), w = b.getDouble(1), n = b.getDouble(2), e = b.getDouble(3);
                if (!(s < n && w < e) || Math.abs(s) > 90 || Math.abs(n) > 90 || Math.abs(w) > 180 || Math.abs(e) > 180) throw new Exception("Ungültiger Ausschnitt");
                p = TilePlan.rect(s, w, n, e, zmin, zmax, TilePlan.MAX_TILES);
                bbox = new double[]{s, w, n, e};
            }
            int n = p.keys == null ? p.count : p.keys.length;
            String why = TilePlan.check(src, n, usedBytes(c));
            if (why != null) return new JSONObject().put("started", false).put("error", why);
            keys = p.keys;
            String id = newId();
            JSONArray bb = new JSONArray();
            for (double v : bbox == null ? new double[0] : bbox) bb.put(v);
            JSONArray cov = new JSONArray();
            for (String s : TilePlan.cover(keys)) cov.put(s);
            area = new JSONObject().put("id", id).put("name", TilePlan.name(a.optString("name"), "Offline-Karte")).put("src", src)
                    .put("kind", "route".equals(a.optString("kind")) ? "route" : "rect").put("zmin", zmin).put("zmax", zmax)
                    .put("bbox", bb).put("cover", cov).put("tiles", keys.length).put("have", 0).put("bytes", 0)
                    .put("date", System.currentTimeMillis()).put("complete", false);
            writeList(c, id, keys);
            putArea(c, area);
        }
        final JSONObject ar = area;
        final long[] ks = keys;
        if (!begin(ar.getString("id"), ar.optString("name"), ks.length)) return new JSONObject().put("started", false).put("error", "Offline-Karte laden läuft schon");
        Thread t = new Thread(() -> run(c, ar, ks, refresh, wifiOnly, version), "Offline-Karte");
        t.start();
        return new JSONObject().put("started", true).put("id", ar.getString("id"));
    }

    private static void run(Context c, JSONObject area, long[] keys, boolean refresh, boolean wifiOnly, String version) {
        PowerManager.WakeLock wl = null;
        try {
            wl = ((PowerManager) c.getSystemService(Context.POWER_SERVICE)).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "tourentagebuch:karte");
            wl.acquire(2 * 60 * 60 * 1000L);
        } catch (Exception e) { AppLog.log("Offline-Karte Wake-Lock: " + e); }
        ImportService.start(c, "Offline-Karte laden", "0 von " + keys.length + " Kacheln", 0, keys.length);
        try {
            if (http == null) http = new OkHttpClient.Builder().connectTimeout(15, TimeUnit.SECONDS).readTimeout(30, TimeUnit.SECONDS).followRedirects(true).build();
            final String src = area.optString("src"), ua = "MeinTourentagebuch/" + version + " (Android; Offline-Karte)";
            final File base = dir(c);
            final AtomicInteger next = new AtomicInteger(0), netFails = new AtomicInteger(0), busy = new AtomicInteger(0);
            final long now = System.currentTimeMillis();
            Runnable worker = () -> { try {
                int i;
                while (!cancel.get() && (i = next.getAndIncrement()) < keys.length) {
                    int[] t = TilePlan.unkey(keys[i]);
                    String rel = TilePlan.relPath(src, t[0], t[1], t[2]);
                    if (rel == null) { step(2); continue; }
                    File f = new File(base, rel);
                    if (!TilePlan.needs(f.isFile(), f.length(), f.lastModified(), refresh, now)) { step(1); continue; }
                    step(fetchTile(TilePlan.url(src, t[0], t[1], t[2]), f, ua, netFails, busy));
                    note(c, false);
                    if (wifiOnly && i % 20 == 0 && !onWifi(c)) { synchronized (TileDownload.class) { wifiLost = true; } fail("WLAN getrennt – Laden angehalten. Bereits geladene Kacheln bleiben; „Aktualisieren“ lädt den Rest."); }
                    pause(150);
                }
            } catch (Throwable e) { fail(e.getMessage() == null ? e.toString() : e.getMessage()); AppLog.log("Offline-Karte: " + e); } };
            Thread w2 = new Thread(worker, "Offline-Karte 2");
            w2.start();
            worker.run();
            w2.join();
        } catch (Throwable e) {
            fail(e.getMessage() == null ? e.toString() : e.getMessage());
            AppLog.log("Offline-Karte: " + e);
        } finally {
            try { finishArea(c, area, keys); } catch (Exception e) { AppLog.log("Offline-Karte abschließen: " + e); }
            synchronized (TileDownload.class) { cancelled = cancel.get() && error.isEmpty(); running = false; }
            note(c, true);
            ImportService.stop(c, null);
            if (wl != null && wl.isHeld()) try { wl.release(); } catch (Exception e) { /* egal */ }
        }
    }

    private static void pause(long ms) {
        long end = System.currentTimeMillis() + ms;
        while (!cancel.get() && System.currentTimeMillis() < end) {
            try { Thread.sleep(Math.min(200, Math.max(1, end - System.currentTimeMillis()))); } catch (InterruptedException e) { return; }
        }
    }

    /** Eine Kachel laden (mit Wiederholung). 0 = geladen, 2 = fehlgeschlagen. Bricht den ganzen Lauf ab, wenn der Server ablehnt oder keine Verbindung besteht. */
    private static int fetchTile(String url, File f, String ua, AtomicInteger netFails, AtomicInteger busy) {
        for (int attempt = 1; attempt <= 4 && !cancel.get(); attempt++) {
            int status;
            try {
                Request rq = new Request.Builder().url(url).header("User-Agent", ua).build();
                try (Response r = http.newCall(rq).execute()) {
                    status = r.code();
                    if (status == 200 && r.body() != null) {
                        byte[] b = readLimited(r.body().byteStream(), 1 << 20);
                        if (b == null || !TilePlan.looksLikeImage(b)) return 2;
                        File d = f.getParentFile();
                        if (d != null) d.mkdirs();
                        missing.clear();                      // neuer Ordner: Merker „fehlt“ gilt nicht mehr
                        File tmp = new File(d, f.getName() + ".tmp");
                        try (FileOutputStream o = new FileOutputStream(tmp)) { o.write(b); }
                        if (!tmp.renameTo(f)) { tmp.delete(); return 2; }
                        netFails.set(0); busy.set(0);
                        return 0;
                    }
                }
            } catch (Exception e) { status = -1; }
            if (status == 403) { fail("Der Kartenserver lehnt das Laden ab (HTTP 403). Bitte später versuchen."); return 2; }
            if (status == 404 || status == 400 || status == 410) return 2;
            if (status == 429 || status == 503) { if (busy.incrementAndGet() >= 3) { fail("Der Kartenserver bittet um eine Pause. Bitte später weiterladen („Aktualisieren“)."); return 2; } }
            else if (status < 0 && netFails.incrementAndGet() >= 8) { fail("Keine Verbindung zum Kartenserver. Bereits geladene Kacheln bleiben."); return 2; }
            if (attempt < 4) pause(TilePlan.backoff(attempt, status));
        }
        return 2;
    }

    private static byte[] readLimited(InputStream in, int max) throws Exception {
        ByteArrayOutputStream o = new ByteArrayOutputStream();
        byte[] b = new byte[16 * 1024];
        int n;
        while ((n = in.read(b)) > 0) { o.write(b, 0, n); if (o.size() > max) return null; }
        return o.toByteArray();
    }

    /** Nach dem Lauf: wie viele Kacheln da sind, wie viel Platz sie belegen, vollständig? */
    private static void finishArea(Context c, JSONObject area, long[] keys) throws Exception {
        String src = area.optString("src");
        int have = 0;
        long bytes = 0;
        for (long k : keys) {
            int[] t = TilePlan.unkey(k);
            File f = file(c, TilePlan.relPath(src, t[0], t[1], t[2]));
            if (f != null) { have++; bytes += f.length(); }
        }
        JSONObject cur = findArea(c, area.getString("id"));
        if (cur == null) return;      // inzwischen gelöscht
        cur.put("have", have).put("bytes", bytes).put("tiles", keys.length).put("complete", have == keys.length).put("date", System.currentTimeMillis());
        putArea(c, cur);
    }

    /* ---------- Kachellisten ---------- */

    private static void writeList(Context c, String id, long[] keys) throws Exception {
        File f = listFile(c, id);
        if (f.getParentFile() != null) f.getParentFile().mkdirs();
        StringBuilder sb = new StringBuilder(keys.length * 16);
        for (long k : keys) { int[] t = TilePlan.unkey(k); sb.append(t[0]).append('/').append(t[1]).append('/').append(t[2]).append('\n'); }
        try (FileOutputStream o = new FileOutputStream(f)) { o.write(sb.toString().getBytes(StandardCharsets.UTF_8)); }
    }

    private static long[] readList(Context c, String id) {
        try {
            File f = listFile(c, id);
            if (!f.isFile()) return null;
            List<Long> l = new ArrayList<>();
            for (String line : new String(java.nio.file.Files.readAllBytes(f.toPath()), StandardCharsets.UTF_8).split("\n")) {
                String[] p = line.trim().split("/");
                if (p.length != 3 || !line.trim().matches("^\\d{1,2}/\\d{1,7}/\\d{1,7}$")) continue;
                int z = Integer.parseInt(p[0]), x = Integer.parseInt(p[1]), y = Integer.parseInt(p[2]);
                if (z <= TilePlan.ZMAX && TilePlan.valid("topo", z, x, y)) l.add(TilePlan.key(z, x, y));
                if (l.size() > TilePlan.MAX_TILES) return null;
            }
            long[] out = new long[l.size()];
            for (int i = 0; i < out.length; i++) out[i] = l.get(i);
            return out;
        } catch (Exception e) { return null; }
    }

    /* ---------- Löschen ---------- */

    /** Ausschnitt löschen; Kacheln, die ein anderer Ausschnitt derselben Quelle braucht, bleiben. */
    static JSONObject delete(Context c, String id) throws Exception {
        if (!TilePlan.validId(id)) throw new Exception("Ungültige Karte");
        synchronized (TileDownload.class) { if (running && id.equals(areaId)) throw new Exception("Diese Karte wird gerade geladen – erst abbrechen."); }
        JSONObject area = findArea(c, id);
        if (area == null) return new JSONObject().put("deleted", 0);
        String src = area.optString("src");
        long[] mine = readList(c, id);
        Set<Long> keep = new HashSet<>();
        JSONArray all = readAreas(c);
        for (int i = 0; i < all.length(); i++) {
            JSONObject o = all.optJSONObject(i);
            if (o == null || id.equals(o.optString("id")) || !src.equals(o.optString("src"))) continue;
            long[] l = readList(c, o.optString("id"));
            if (l != null) for (long k : l) keep.add(k);
        }
        int n = 0;
        long bytes = 0;
        if (mine != null) for (long k : mine) {
            if (keep.contains(k)) continue;
            int[] t = TilePlan.unkey(k);
            File f = file(c, TilePlan.relPath(src, t[0], t[1], t[2]));
            if (f != null) { long len = f.length(); if (f.delete()) { n++; bytes += len; } }
        }
        listFile(c, id).delete();
        JSONArray out = new JSONArray();
        for (int i = 0; i < all.length(); i++) { JSONObject o = all.optJSONObject(i); if (o != null && !id.equals(o.optString("id"))) out.put(o); }
        writeAreas(c, out);
        return new JSONObject().put("deleted", n).put("bytes", bytes);
    }
}
