package de.tourentagebuch.app;

import android.annotation.TargetApi;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.media.MediaCodec;
import android.media.MediaExtractor;
import android.media.MediaFormat;
import android.media.MediaMetadataRetriever;
import android.media.MediaMuxer;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.PowerManager;
import android.provider.MediaStore;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.ByteBuffer;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * 2.12.0: zwei längere Arbeiten an vorhandenen Videos, je als Lauf im Hintergrund mit Vordergrunddienst ({@link ImportService},
 * wie bei der Medien-Sicherung) und Wake-Lock. Die Oberfläche fragt den Stand über Native.call('videoJob') ab.
 *  - Zuschneiden ohne Neu-Kodierung: MediaExtractor → MediaMuxer (MPEG-4), Video- und Tonspur unverändert kopiert, Drehung als Ausrichtungsangabe.
 *    Beginn immer an einem Schlüsselbild (VideoPlan.trimStartUs). Ergebnis als neues Video (Vorgabe) oder anstelle des Originals – das Original
 *    wird erst ersetzt, wenn die neue Datei fertig und lesbar ist; bei Fehler oder Abbruch bleibt es unberührt.
 *  - Vorhandene Videos in die Galerie kopieren (Movies/Tourentagebuch, ab Android 10 ohne Berechtigung), jedes nur einmal (Merkliste „gal_vids“).
 */
final class VideoJob {
    private VideoJob() { }

    private static final AtomicBoolean cancel = new AtomicBoolean(false);
    private static volatile boolean running;
    private static String kind = "", error = "";
    private static int done, total, pct;
    private static JSONObject result;
    private static boolean cancelled;
    private static long lastNote;

    static final class Cancelled extends Exception { Cancelled() { super("abgebrochen"); } }

    static synchronized JSONObject job() throws Exception {
        JSONObject o = new JSONObject().put("running", running).put("kind", kind).put("done", done).put("total", total).put("pct", pct).put("cancelled", cancelled);
        if (!error.isEmpty()) o.put("error", error);
        if (result != null) o.put("result", result);
        return o;
    }

    static void cancelJob() { if (running) cancel.set(true); }

    static boolean isRunning() { return running; }

    private static synchronized boolean begin(String k, int tot) {
        if (running || MediaBackup.isRunning() || TileDownload.isRunning()) return false;      // ein Lauf zur Zeit (gemeinsame Benachrichtigung)
        running = true; kind = k; error = ""; result = null; cancelled = false; done = 0; total = tot; pct = 0; lastNote = 0;
        cancel.set(false);
        return true;
    }

    interface Work { JSONObject run(Context c) throws Exception; }

    private static void note(Context c, String title, String text, int p) {
        long now = System.currentTimeMillis();
        if (now - lastNote < 1500) return;
        lastNote = now;
        ImportService.update(c, title, text, p, 100);
    }

    private static void run(Context c0, String title, Work w) {
        final Context c = c0.getApplicationContext();
        new Thread(() -> {
            PowerManager.WakeLock wl = null;
            try {
                wl = ((PowerManager) c.getSystemService(Context.POWER_SERVICE)).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "tourentagebuch:videojob");
                wl.acquire(2 * 60 * 60 * 1000L);
            } catch (Exception e) { AppLog.log("Video Wake-Lock: " + e); }
            ImportService.start(c, title, "Wird vorbereitet …", 0, 100);
            JSONObject res = null;
            String err = "";
            boolean ab = false;
            try { res = w.run(c); }
            catch (Cancelled e) { ab = true; }
            catch (Throwable e) { err = e.getMessage() == null ? e.toString() : e.getMessage(); AppLog.log(title + ": " + e); }
            finally {
                synchronized (VideoJob.class) { result = res; error = err; cancelled = ab || cancel.get(); running = false; }
                ImportService.stop(c, null);
                if (wl != null && wl.isHeld()) try { wl.release(); } catch (Exception e) { /* egal */ }
            }
        }, "Video-Lauf").start();
    }

    /* ---------- Schlüsselbilder und Vorschaubilder ---------- */

    private static int track(MediaExtractor ex, String prefix) {
        for (int i = 0; i < ex.getTrackCount(); i++) {
            String m = ex.getTrackFormat(i).getString(MediaFormat.KEY_MIME);
            if (m != null && m.startsWith(prefix)) return i;
        }
        return -1;
    }

    /** Länge (ms), Schlüsselbilder (ms, aufsteigend, höchstens 20 000), Drehung und Format der Videospur. */
    static JSONObject keyframes(File f) throws Exception {
        MediaExtractor ex = new MediaExtractor();
        try {
            ex.setDataSource(f.getAbsolutePath());
            int vt = track(ex, "video/");
            if (vt < 0) throw new Exception("Keine Videospur");
            MediaFormat vf = ex.getTrackFormat(vt);
            long durUs = vf.containsKey(MediaFormat.KEY_DURATION) ? vf.getLong(MediaFormat.KEY_DURATION) : 0;
            ex.selectTrack(vt);
            JSONArray keys = new JSONArray();
            long last = -1, lastT = 0;
            while (keys.length() < 20000) {
                long t = ex.getSampleTime();
                if (t < 0) break;
                lastT = Math.max(lastT, t);
                if ((ex.getSampleFlags() & MediaExtractor.SAMPLE_FLAG_SYNC) != 0 && t / 1000 != last) { last = t / 1000; keys.put(last); }
                if (!ex.advance()) break;
            }
            if (durUs <= 0) durUs = lastT;
            return new JSONObject().put("dur", durUs / 1000).put("keys", keys).put("rot", rotation(f, vf))
                    .put("mime", String.valueOf(vf.getString(MediaFormat.KEY_MIME))).put("audio", track(ex, "audio/") >= 0);
        } finally {
            ex.release();
        }
    }

    private static int rotation(File f, MediaFormat vf) {
        if (vf != null && vf.containsKey(MediaFormat.KEY_ROTATION)) {
            try { return vf.getInteger(MediaFormat.KEY_ROTATION); } catch (Exception e) { /* weiter */ }
        }
        MediaMetadataRetriever mr = new MediaMetadataRetriever();
        try {
            mr.setDataSource(f.getAbsolutePath());
            String r = mr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION);
            return r == null ? 0 : Integer.parseInt(r.trim());
        } catch (Exception e) {
            return 0;
        } finally {
            try { mr.release(); } catch (Exception e) { /* egal */ }
        }
    }

    /** Vorschaubild bei ms (exact: genau dieses Bild, sonst das Schlüsselbild davor) als JPEG im Zwischenspeicher; Adresse für die Oberfläche. */
    static JSONObject frame(Context c, String id, File f, long ms, boolean exact) throws Exception {
        File dir = new File(c.getCacheDir(), "frames");
        dir.mkdirs();
        File[] old = dir.listFiles();
        if (old != null && old.length > 40) for (File o : old) o.delete();      // nur ein paar Vorschaubilder auf Vorrat
        File out = new File(dir, id + "_" + ms + (exact ? "e" : "k") + ".jpg");
        if (!out.isFile()) {
            MediaMetadataRetriever mr = new MediaMetadataRetriever();
            try {
                mr.setDataSource(f.getAbsolutePath());
                Bitmap b = mr.getFrameAtTime(ms * 1000, exact ? MediaMetadataRetriever.OPTION_CLOSEST : MediaMetadataRetriever.OPTION_PREVIOUS_SYNC);
                if (b == null) throw new Exception("Kein Bild an dieser Stelle");
                float s = 480f / Math.max(b.getWidth(), b.getHeight());
                Bitmap t = s < 1f ? Bitmap.createScaledBitmap(b, Math.round(b.getWidth() * s), Math.round(b.getHeight() * s), true) : b;
                try (FileOutputStream o = new FileOutputStream(out)) { t.compress(Bitmap.CompressFormat.JPEG, 82, o); }
            } finally {
                try { mr.release(); } catch (Exception e) { /* egal */ }
            }
        }
        return new JSONObject().put("url", "/cache/frames/" + out.getName()).put("ms", ms);
    }

    /* ---------- Zuschneiden ---------- */

    /** Startet das Zuschneiden. false = es läuft schon etwas. */
    static boolean startTrim(Context c0, final String id, final long startMs, final long endMs, final boolean replace) throws Exception {
        final Context c = c0.getApplicationContext();
        final File src = new File(Photos.dir(c), id + ".mp4");
        if (!src.isFile()) throw new Exception("Video fehlt");
        JSONObject k = keyframes(src);
        JSONArray ka = k.getJSONArray("keys");
        long[] keysUs = new long[ka.length()];
        for (int i = 0; i < keysUs.length; i++) keysUs[i] = ka.getLong(i) * 1000;
        final long durUs = k.getLong("dur") * 1000;
        final long sUs = VideoPlan.trimStartUs(keysUs, startMs * 1000), eUs = VideoPlan.trimEndUs(durUs, endMs * 1000);
        if (!VideoPlan.trimOk(sUs, eUs, durUs)) throw new Exception("Der Ausschnitt ist zu kurz oder umfasst das ganze Video (mindestens 1 Sekunde, Beginn am Schlüsselbild " + VideoPlan.timeLabel(sUs / 1000) + ").");
        if (!begin("trim", 1)) return false;
        run(c, "Video zuschneiden", ctx -> {
            File dir = new File(ctx.getFilesDir(), "umwandeln");      // gleiches Dateisystem wie photos/: Ersetzen per Umbenennen
            dir.mkdirs();
            File tmp = new File(dir, id + "_schnitt.mp4");
            try {
                tmp.delete();
                trim(src, tmp, sUs, eUs, p -> { synchronized (VideoJob.class) { pct = p; } note(ctx, "Video zuschneiden", p + " %", p); });
                if (VideoConvert.videoMime(tmp) == null || tmp.length() < 1024) throw new Exception("Ergebnis unbrauchbar");
                JSONObject r = new JSONObject().put("ok", true).put("src", id).put("startMs", sUs / 1000).put("endMs", eUs / 1000).put("replaced", replace);
                if (replace) {
                    File old = new File(dir, id + ".alt");
                    old.delete();
                    if (!src.renameTo(old)) throw new Exception("Original lässt sich nicht beiseitelegen");
                    if (!tmp.renameTo(src)) { old.renameTo(src); throw new Exception("Neue Datei lässt sich nicht ablegen"); }
                    old.delete();
                    new File(PhotoProvider.camDir(ctx), "ansicht_" + id + ".mp4").delete();
                    long[] m = Photos.videoMeta(ctx, id);
                    r.put("id", id).put("w", m[0]).put("h", m[1]).put("dur", m[2]);
                } else {
                    JSONObject m = Photos.importVideo(ctx, tmp, 0, Double.NaN, Double.NaN);
                    r.put("id", m.getString("id")).put("w", m.optInt("w")).put("h", m.optInt("h")).put("dur", m.optLong("dur"));
                }
                synchronized (VideoJob.class) { done = 1; pct = 100; }
                AppLog.log("Video " + id + " zugeschnitten " + VideoPlan.timeLabel(sUs / 1000) + "–" + VideoPlan.timeLabel(eUs / 1000) + (replace ? " (ersetzt)" : " (neu: " + r.optString("id") + ")"));
                return r;
            } finally {
                tmp.delete();
            }
        });
        return true;
    }

    interface Progress { void at(int pct); }

    /** Ausschnitt [sUs, eUs] ohne Neu-Kodierung kopieren. sUs muss ein Schlüsselbild sein; Zeiten im Ergebnis beginnen bei 0. */
    static void trim(File in, File out, long sUs, long eUs, Progress progress) throws Exception {
        MediaExtractor ex = new MediaExtractor();
        MediaMuxer mux = null;
        boolean started = false, ok = false;
        try {
            ex.setDataSource(in.getAbsolutePath());
            int vt = track(ex, "video/"), at = track(ex, "audio/");
            if (vt < 0) throw new Exception("Keine Videospur");
            MediaFormat vf = ex.getTrackFormat(vt);
            mux = new MediaMuxer(out.getAbsolutePath(), MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4);
            int rot = rotation(in, vf);
            if (rot == 90 || rot == 180 || rot == 270) mux.setOrientationHint(rot);
            int maxIn = 1 << 20;
            ex.selectTrack(vt);
            int mv = mux.addTrack(vf);
            if (vf.containsKey(MediaFormat.KEY_MAX_INPUT_SIZE)) maxIn = Math.max(maxIn, vf.getInteger(MediaFormat.KEY_MAX_INPUT_SIZE));
            int ma = -1;
            if (at >= 0) {
                MediaFormat af = ex.getTrackFormat(at);
                try {
                    ma = mux.addTrack(af);
                    ex.selectTrack(at);
                    if (af.containsKey(MediaFormat.KEY_MAX_INPUT_SIZE)) maxIn = Math.max(maxIn, af.getInteger(MediaFormat.KEY_MAX_INPUT_SIZE));
                } catch (Exception e) { ma = -1; AppLog.log("Tonspur nicht übernehmbar: " + e); }      // z. B. Tonformat, das MPEG-4 nicht kennt: Video ohne Ton
            }
            ByteBuffer buf = ByteBuffer.allocateDirect(Math.max(maxIn, 2 << 20));
            MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();
            ex.seekTo(sUs, MediaExtractor.SEEK_TO_PREVIOUS_SYNC);
            mux.start();
            started = true;
            boolean vDone = false, aDone = ma < 0;
            long span = Math.max(1, eUs - sUs);
            int lastP = -1;
            while (!(vDone && aDone)) {
                if (cancel.get()) throw new Cancelled();
                int ti = ex.getSampleTrackIndex();
                if (ti < 0) break;
                long t = ex.getSampleTime();
                boolean isV = ti == vt;
                if (t > eUs) {                                          // hinter dem Ende: diese Spur ist fertig
                    if (isV) vDone = true; else aDone = true;
                    if (!ex.advance()) break;
                    continue;
                }
                if (t >= sUs && ((isV && !vDone) || (!isV && ti == at && ma >= 0 && !aDone))) {
                    buf.clear();
                    int n = ex.readSampleData(buf, 0);
                    if (n < 0) break;
                    int fl = (ex.getSampleFlags() & MediaExtractor.SAMPLE_FLAG_SYNC) != 0 ? MediaCodec.BUFFER_FLAG_KEY_FRAME : 0;
                    info.set(0, n, t - sUs, fl);
                    mux.writeSampleData(isV ? mv : ma, buf, info);
                    if (isV) {
                        int p = VideoPlan.percent(t - sUs, span);
                        if (p != lastP) { lastP = p; progress.at(p); }
                    }
                }
                if (!ex.advance()) break;
            }
            ok = true;
        } finally {
            if (mux != null) {
                try { if (started) mux.stop(); } catch (Exception e) { if (ok) { ok = false; AppLog.log("Muxer: " + e); } }
                try { mux.release(); } catch (Exception e) { /* egal */ }
            }
            ex.release();
            if (!ok) out.delete();
        }
        if (!ok) throw new Exception("Zuschneiden fehlgeschlagen");
    }

    /* ---------- Vorhandene Videos in die Galerie ---------- */

    private static SharedPreferences prefs(Context c) { return c.getSharedPreferences("app", Context.MODE_PRIVATE); }

    /** Alle Videos in photos/ (Kennungen). */
    static List<String> allVideos(Context c) {
        List<String> l = new ArrayList<>();
        File[] fs = Photos.dir(c).listFiles();
        if (fs != null) for (File f : fs) { String n = f.getName(); if (n.endsWith("v.mp4")) l.add(n.substring(0, n.length() - 4)); }
        java.util.Collections.sort(l);
        return l;
    }

    static Set<String> galleryDone(Context c) { return new HashSet<>(prefs(c).getStringSet("gal_vids", new HashSet<>())); }

    /** Wie viele Videos noch nicht in der Galerie sind; supported = false unter Android 10. */
    static JSONObject galleryScan(Context c) throws Exception {
        List<String> all = allVideos(c), todo = VideoPlan.galleryTodo(all, galleryDone(c));
        return new JSONObject().put("supported", Build.VERSION.SDK_INT >= 29).put("all", all.size()).put("n", todo.size()).put("ids", new JSONArray(todo));
    }

    /** Ein Video in die Galerie kopieren und merken (jede Kennung nur einmal). ts = Aufnahmezeit (0 = unbekannt). */
    static synchronized boolean copyToGallery(Context c, File src, String vid, long ts) throws Exception {
        if (Build.VERSION.SDK_INT < 29) return false;
        Set<String> d = galleryDone(c);
        if (d.contains(vid) || !src.isFile()) return false;
        copyQ(c, src, vid, ts);
        d.add(vid);
        prefs(c).edit().putStringSet("gal_vids", d).apply();
        return true;
    }

    @TargetApi(29)
    private static void copyQ(Context c, File src, String vid, long ts) throws Exception {
        ContentResolver cr = c.getContentResolver();
        ContentValues v = new ContentValues();
        v.put(MediaStore.MediaColumns.DISPLAY_NAME, VideoPlan.galleryName(vid, ts, null));
        v.put(MediaStore.MediaColumns.MIME_TYPE, "video/mp4");
        v.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_MOVIES + "/Tourentagebuch");
        v.put(MediaStore.MediaColumns.IS_PENDING, 1);
        if (ts > 0) v.put(MediaStore.Video.VideoColumns.DATE_TAKEN, ts);
        Uri u = cr.insert(MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY), v);
        if (u == null) throw new Exception("MediaStore lehnt ab");
        try {
            try (InputStream in = new FileInputStream(src); OutputStream o = cr.openOutputStream(u)) {
                if (o == null) throw new Exception("kein Ausgabestrom");
                byte[] b = new byte[64 * 1024];
                int n;
                while ((n = in.read(b)) > 0) {
                    if (cancel.get() && running && "gallery".equals(kind)) throw new Cancelled();
                    o.write(b, 0, n);
                }
            }
            ContentValues fin = new ContentValues();
            fin.put(MediaStore.MediaColumns.IS_PENDING, 0);
            cr.update(u, fin, null, null);
        } catch (Exception e) {
            try { cr.delete(u, null, null); } catch (Exception e2) { /* egal */ }
            throw e;
        }
    }

    /** Vorhandene Videos (items: [{id, ts}]) nacheinander in die Galerie kopieren. false = es läuft schon etwas. */
    static boolean startGallery(Context c0, JSONArray items) throws Exception {
        final Context c = c0.getApplicationContext();
        if (Build.VERSION.SDK_INT < 29) throw new Exception("Erst ab Android 10 möglich");
        final List<String> ids = new ArrayList<>();
        final java.util.Map<String, Long> ts = new java.util.HashMap<>();
        for (int i = 0; i < items.length(); i++) {
            JSONObject o = items.getJSONObject(i);
            String id = o.optString("id").replaceAll("[^A-Za-z0-9]", "");
            ids.add(id);
            ts.put(id, o.optLong("ts", 0));
        }
        final List<String> todo = VideoPlan.galleryTodo(ids, galleryDone(c));
        if (todo.isEmpty()) throw new Exception("Alle Videos sind schon in der Galerie.");
        if (!begin("gallery", todo.size())) return false;
        run(c, "Videos in die Galerie kopieren", ctx -> {
            int ok = 0, bad = 0;
            String lastErr = "";
            boolean ab = false;
            for (int i = 0; i < todo.size(); i++) {
                if (cancel.get()) { ab = true; break; }
                String id = todo.get(i);
                synchronized (VideoJob.class) { done = i; pct = todo.size() > 0 ? i * 100 / todo.size() : 0; }
                note(ctx, "Videos in die Galerie kopieren", (i + 1) + " von " + todo.size(), pct);
                try {
                    Long t = ts.get(id);
                    if (copyToGallery(ctx, new File(Photos.dir(ctx), id + ".mp4"), id, t == null ? 0 : t)) ok++;
                } catch (Cancelled e) {
                    ab = true;
                    break;
                } catch (Exception e) {
                    bad++;
                    lastErr = e.getMessage() == null ? e.toString() : e.getMessage();
                    AppLog.log("Galerie-Kopie " + id + ": " + e);
                }
                synchronized (VideoJob.class) { done = i + 1; }
            }
            return new JSONObject().put("ok", ok).put("bad", bad).put("msg", lastErr).put("cancelled", ab);
        });
        return true;
    }
}
