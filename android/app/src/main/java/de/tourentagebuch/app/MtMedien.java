package de.tourentagebuch.app;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;

import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 2.18.0: Hülle für den Abgleich von Fotos und Videos mit Meine Touren (Oberfläche: js/abgleich-medien.js). Die Übertragung selbst steht in {@link MtTransfer}
 * (reines Java, geprüft). Nur auf Knopfdruck aus der Oberfläche; die Oberfläche ruft nichts davon auf, wenn „Mit Meine Touren zusammenarbeiten“ aus ist.
 *
 * mtFotoSenden: gespeichertes Foto (photos/&lt;id&gt;.jpg) – wenn größer als maxPx, verkleinert neu gespeichert – als multipart an POST /api/tours/{id}/photo.
 * mtFotoHolen:  verkleinertes JPEG (w=1600) in den Zwischenspeicher, dann wie jeder Foto-Import übernommen (Aufnahmezeit und Ort aus den Angaben des Servers).
 * mtVideoStart: ein Video senden oder holen – im Hintergrund, gestreamt, mit Fortschritt (mtJob) und Abbrechen (mtJobCancel); Holen setzt einen
 *               abgebrochenen Download fort. Nur im WLAN, wenn wifiOnly gesetzt ist (Vorgabe der Oberfläche: an).
 */
public final class MtMedien {
    private MtMedien() { }

    private static final int TIMEOUT = 180000;

    static JSONObject netz(Context c) throws Exception { return new JSONObject().put("wifi", TileDownload.onWifi(c)); }

    private static Map<String, String> felder(JSONObject a) {
        Map<String, String> m = new LinkedHashMap<>();
        JSONObject f = a.optJSONObject("fields");
        if (f != null) { Iterator<String> it = f.keys(); while (it.hasNext()) { String k = it.next(); m.put(k, f.optString(k)); } }
        return m;
    }

    private static File mediaFile(Context c, String id) throws Exception {
        if (id == null || !id.matches("[0-9a-f]{6,40}v?")) throw new Exception("Ungültige Kennung");
        File f = new File(Photos.dir(c), id + (id.endsWith("v") ? ".mp4" : ".jpg"));
        if (!f.isFile()) throw new Exception("Datei fehlt");
        return f;
    }

    /** Foto verkleinern, wenn eine Seite größer als maxPx ist; sonst die gespeicherte Datei selbst. Gibt die zu sendende Datei zurück (tmp = selbst löschen). */
    private static File passend(Context c, File src, int maxPx, boolean[] tmp) throws Exception {
        BitmapFactory.Options bo = new BitmapFactory.Options();
        bo.inJustDecodeBounds = true;
        BitmapFactory.decodeFile(src.getAbsolutePath(), bo);
        if (bo.outWidth <= 0 || Math.max(bo.outWidth, bo.outHeight) <= maxPx) return src;
        BitmapFactory.Options o2 = new BitmapFactory.Options();
        o2.inSampleSize = ImagePlan.sampleSize(bo.outWidth, bo.outHeight, maxPx, ImagePlan.MAX_DECODE_PIXELS);
        Bitmap bm = BitmapFactory.decodeFile(src.getAbsolutePath(), o2);
        if (bm == null) return src;
        float sc = (float) maxPx / Math.max(bm.getWidth(), bm.getHeight());
        Bitmap r = sc < 1f ? Bitmap.createScaledBitmap(bm, Math.max(1, Math.round(bm.getWidth() * sc)), Math.max(1, Math.round(bm.getHeight() * sc)), true) : bm;
        File out = File.createTempFile("mts", ".jpg", c.getCacheDir());
        try (FileOutputStream fo = new FileOutputStream(out)) { r.compress(Bitmap.CompressFormat.JPEG, 88, fo); }
        if (r != bm) r.recycle();
        bm.recycle();
        tmp[0] = true;
        return out;
    }

    /** {url, cookie, id, fields:{ref,name,taken,offset,lat,lng,force}, maxPx} → {status, body}. */
    static JSONObject fotoSenden(Context c, JSONObject a) throws Exception {
        File src = mediaFile(c, a.getString("id"));
        boolean[] tmp = {false};
        File f = passend(c, src, a.optInt("maxPx", 2200), tmp);
        try {
            if (f.length() > MtTransfer.FOTO_MAX) throw new Exception("Das Foto ist größer als 40 MB");
            Map<String, String> m = felder(a);
            MtTransfer.Result r = MtTransfer.upload(a.getString("url"), a.optString("cookie"), m, f, MtTransfer.safeName(m.containsKey("name") ? m.get("name") : src.getName()), "image/jpeg", null, TIMEOUT);
            return new JSONObject().put("status", r.status).put("body", r.body).put("bytes", r.bytes);
        } finally {
            if (tmp[0]) f.delete();
        }
    }

    /** {url, cookie, name, taken (ms), lat, lng} → Metadaten wie beim Foto-Import (id, ts, fp, fpd, size …) oder {status, body} bei einem Fehler des Servers. */
    static JSONObject fotoHolen(Context c, JSONObject a) throws Exception {
        File part = File.createTempFile("mth", ".jpg", c.getCacheDir());
        part.delete();
        try {
            MtTransfer.Result r = MtTransfer.download(a.getString("url"), a.optString("cookie"), part, MtTransfer.FOTO_MAX, null, TIMEOUT);
            if (r.status != 200 && r.status != 206) return new JSONObject().put("status", r.status).put("body", r.body);
            double la = a.has("lat") && !a.isNull("lat") ? a.getDouble("lat") : Double.NaN, lo = a.has("lng") && !a.isNull("lng") ? a.getDouble("lng") : Double.NaN;
            try (InputStream in = new FileInputStream(part)) {
                JSONObject j = Photos.importStream(c, in, MtTransfer.safeName(a.optString("name", "MeineTouren.jpg")), 0, la, lo, a.optLong("taken", 0), "meinetouren");
                return j.put("status", 200);
            }
        } finally {
            part.delete();
        }
    }

    /* ---------------- Videos im Hintergrund ---------------- */
    private static Thread worker;
    private static volatile boolean cancel;
    private static String mode = "", error = "", body = "";
    private static long done, total;
    private static int status;
    private static JSONObject result;
    private static boolean running;

    static synchronized JSONObject job() throws Exception {
        return new JSONObject().put("running", running).put("mode", mode).put("done", done).put("total", total).put("status", status)
                .put("error", error).put("body", body).put("result", result == null ? JSONObject.NULL : result);
    }

    static void cancel() { cancel = true; }

    private static synchronized void set(long d, long t) { done = d; total = t; }

    /** {mode: 'senden'|'holen', url, cookie, wifiOnly, id (senden) | key, name, taken, lat, lng, size (holen), fields (senden), used (senden: belegte Bytes der Tour)}. */
    static synchronized JSONObject start(final Context c, final JSONObject a) throws Exception {
        if (running) return new JSONObject().put("started", false).put("error", "Es läuft schon eine Übertragung.");
        if (a.optBoolean("wifiOnly", true) && !TileDownload.onWifi(c)) return new JSONObject().put("started", false).put("error", "Kein WLAN. Videos werden nur im WLAN übertragen.");
        final String m = a.optString("mode");
        if (m.equals("senden")) {
            File f = mediaFile(c, a.getString("id"));
            String why = MtTransfer.videoCheck(f.length(), a.optLong("used", 0));
            if (why != null) return new JSONObject().put("started", false).put("error", why);
        } else if (!m.equals("holen")) throw new Exception("mode fehlt");
        else if (a.optLong("size", 0) > MtTransfer.VIDEO_MAX) return new JSONObject().put("started", false).put("error", "Das Video ist größer als 200 MB und wird nicht übertragen.");
        running = true; cancel = false; mode = m; error = ""; body = ""; status = 0; result = null; done = 0; total = 0;
        worker = new Thread(new Runnable() { public void run() { MtMedien.run(c, a); } }, "Meine Touren Video");
        worker.start();
        return new JSONObject().put("started", true);
    }

    private static void run(Context c, JSONObject a) {
        MtTransfer.Control ctl = new MtTransfer.Control() {
            public boolean cancelled() { return cancel; }
            public void progress(long d, long t) { set(d, t); }
        };
        JSONObject res = null;
        String err = "", bod = "";
        int st = 0;
        try {
            if (mode.equals("senden")) {
                File f = mediaFile(c, a.getString("id"));
                Map<String, String> m = felder(a);
                m.put("bestaetigt", "1");      // Server: Videos nur auf ausdrücklichen Wunsch
                MtTransfer.Result r = MtTransfer.upload(a.getString("url"), a.optString("cookie"), m, f, MtTransfer.safeName(m.containsKey("name") ? m.get("name") : f.getName()), "video/mp4", ctl, 600000);
                st = r.status; bod = r.body;
            } else {
                File dir = new File(c.getCacheDir(), "mtv");
                dir.mkdirs();
                File part = new File(dir, MtTransfer.safeName(a.optString("key", "video")).replaceAll("[^A-Za-z0-9._-]", "_") + ".part");
                MtTransfer.Result r = MtTransfer.download(a.getString("url"), a.optString("cookie"), part, MtTransfer.VIDEO_MAX, ctl, 600000);
                st = r.status; bod = r.body;
                if (st == 200 || st == 206) {
                    double la = a.has("lat") && !a.isNull("lat") ? a.getDouble("lat") : Double.NaN, lo = a.has("lng") && !a.isNull("lng") ? a.getDouble("lng") : Double.NaN;
                    res = Photos.importVideo(c, part, a.optLong("taken", System.currentTimeMillis()), la, lo);
                    res.put("src", "meinetouren").put("name", MtTransfer.safeName(a.optString("name", "Video.mp4")));
                    part.delete();
                }
            }
        } catch (MtTransfer.CancelledException e) {
            err = "abgebrochen";
        } catch (Throwable e) {
            err = e.getMessage() == null ? e.toString() : e.getMessage();
            AppLog.log("Meine Touren Video: " + err);
        }
        synchronized (MtMedien.class) { running = false; error = err; body = bod; status = st; result = res; }
    }
}
