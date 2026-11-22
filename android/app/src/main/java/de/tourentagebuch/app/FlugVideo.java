package de.tourentagebuch.app;

import android.annotation.TargetApi;
import android.app.ActivityManager;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.media.Image;
import android.media.MediaCodec;
import android.media.MediaCodecInfo;
import android.media.MediaCodecList;
import android.media.MediaFormat;
import android.media.MediaMuxer;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;

import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.RandomAccessFile;
import java.nio.ByteBuffer;

/**
 * 2.17.0: „3D-Flug als Video“ – die Hülle-Seite des Bild-für-Bild-Exports.
 *
 * Zwei Wege (die Oberfläche wählt, siehe docs/versionen/2.17.0.md):
 * 1. WebCodecs im WebView kodiert selbst und verpackt als MP4 (js/calc-mp4.js); die fertigen Bytes kommen stückweise über „appendCache“.
 *    Hier wird nur die Größe des Datenteils nachgetragen ({@link #saveMuxed}) und die Datei in die Galerie gelegt.
 * 2. Rückfall „über Android“: die Oberfläche schickt jedes Bild als JPEG (Base64); hier wird es dekodiert, nach YUV 4:2:0 (BT.709)
 *    umgerechnet ({@link VideoExportPlan#argbToYuv420}) und mit genauem Zeitstempel an MediaCodec (H.264/HEVC) gegeben; MediaMuxer schreibt MP4.
 *    Zeitstempel = Bildnummer / Bildrate – unabhängig davon, wie lange ein Bild zum Zeichnen braucht.
 *
 * Ergebnis: Datei im Zwischenspeicher-Ordner „cam“ (über den PhotoProvider teilbar und abspielbar) und eine Kopie in Movies/Tourentagebuch
 * (MediaStore, ab Android 10 ohne Berechtigung) bzw. darunter im App-Ordner (Android/data/…/files/Movies). Keine neuen Rechte.
 * Ton gibt es keinen.
 */
final class FlugVideo {
    private FlugVideo() { }

    private static MediaCodec enc;
    private static MediaMuxer mux;
    private static int track = -1, w, h, fps;
    private static boolean muxStarted;
    private static long frames, written;
    private static File out;
    private static MediaCodec.BufferInfo bi;
    private static int[] argb;
    private static byte[] yb, ub, vb;
    private static String encName = "";

    /* ---------------- Fähigkeiten ---------------- */

    /** Kodierer für mime: bevorzugt Hardware; null, wenn keiner. */
    private static MediaCodecInfo encoder(String mime) {
        MediaCodecInfo soft = null;
        for (MediaCodecInfo ci : new MediaCodecList(MediaCodecList.REGULAR_CODECS).getCodecInfos()) {
            if (!ci.isEncoder()) continue;
            if (Build.VERSION.SDK_INT >= 29 && ci.isAlias()) continue;
            for (String t : ci.getSupportedTypes()) {
                if (!t.equalsIgnoreCase(mime)) continue;
                if (hw(ci)) return ci;
                if (soft == null) soft = ci;
            }
        }
        return soft;
    }

    private static boolean hw(MediaCodecInfo ci) {
        return Build.VERSION.SDK_INT >= 29 ? ci.isHardwareAccelerated() : !ci.getName().toLowerCase(java.util.Locale.ROOT).matches("^(omx\\.google|c2\\.android).*");
    }

    /** Was kann der Kodierer? {name, hw, encLang, encKurz, sizes: {"1080": {"30": true, "60": true, "hoch": true}, …}} oder null. */
    private static JSONObject caps(String mime) throws Exception {
        MediaCodecInfo ci = encoder(mime);
        if (ci == null) return null;
        MediaCodecInfo.VideoCapabilities vc = ci.getCapabilitiesForType(mime).getVideoCapabilities();
        if (vc == null) return null;
        JSONObject sizes = new JSONObject();
        int lang = 0, kurz = 0;
        for (int k : VideoExportPlan.SHORT_SIDES) {
            int[] q = VideoExportPlan.size(k, "quer");
            boolean ok30 = vc.areSizeAndRateSupported(q[0], q[1], 30), ok60 = vc.areSizeAndRateSupported(q[0], q[1], 60);
            boolean hoch = vc.isSizeSupported(q[1], q[0]);
            sizes.put(String.valueOf(k), new JSONObject().put("30", ok30).put("60", ok60).put("hoch", hoch));
            if (ok30 || vc.isSizeSupported(q[0], q[1])) { lang = q[0]; kurz = q[1]; }
        }
        return new JSONObject().put("name", ci.getName()).put("hw", hw(ci)).put("encLang", lang).put("encKurz", kurz)
                .put("maxW", vc.getSupportedWidths().getUpper()).put("maxH", vc.getSupportedHeights().getUpper())
                .put("maxBitrate", vc.getBitrateRange().getUpper()).put("sizes", sizes);
    }

    static long freeMB(Context c) {
        long a = c.getCacheDir().getUsableSpace();
        File ext = c.getExternalFilesDir(null);
        if (ext != null) a = Math.min(a, ext.getUsableSpace());
        return a / (1024 * 1024);
    }

    static JSONObject info(Context c) throws Exception {
        ActivityManager.MemoryInfo mi = new ActivityManager.MemoryInfo();
        ((ActivityManager) c.getSystemService(Context.ACTIVITY_SERVICE)).getMemoryInfo(mi);
        JSONObject avc = null, hevc = null;
        try { avc = caps(MediaFormat.MIMETYPE_VIDEO_AVC); } catch (Exception e) { AppLog.log("Flugvideo AVC: " + e); }
        try { hevc = caps(MediaFormat.MIMETYPE_VIDEO_HEVC); } catch (Exception e) { AppLog.log("Flugvideo HEVC: " + e); }
        return new JSONObject().put("avc", avc == null ? JSONObject.NULL : avc).put("hevc", hevc == null ? JSONObject.NULL : hevc)
                .put("freiMB", freeMB(c)).put("ramGB", Math.round(mi.totalMem / 1e9)).put("sdk", Build.VERSION.SDK_INT)
                .put("galerie", Build.VERSION.SDK_INT >= 29 ? "Movies/Tourentagebuch" : "App-Ordner (Android/data/de.tourentagebuch.app/files/Movies)");
    }

    /* ---------------- Weg 2: Kodieren über MediaCodec ---------------- */

    static synchronized JSONObject start(Context c, JSONObject a) throws Exception {
        release(true);
        int ww = a.getInt("w"), hh = a.getInt("h"), f = a.optInt("fps", 30), br = a.optInt("bitrate", 0), n = a.optInt("frames", 0);
        String codec = a.optString("codec", "avc"), mime = VideoExportPlan.mime(codec);
        if (br <= 0) br = VideoExportPlan.bitrate(ww, hh, f, codec);
        String err = VideoExportPlan.check(ww, hh, f, br, codec, freeMB(c), n);
        if (err != null) throw new Exception(err);
        MediaCodecInfo ci = encoder(mime);
        if (ci == null) throw new Exception("Kein Video-Kodierer für " + ("hevc".equals(codec) ? "HEVC" : "H.264") + " auf diesem Handy");
        MediaCodecInfo.VideoCapabilities vc = ci.getCapabilitiesForType(mime).getVideoCapabilities();
        if (vc != null && !vc.isSizeSupported(ww, hh)) throw new Exception("Der Video-Kodierer schafft " + ww + " × " + hh + " nicht – bitte eine kleinere Auflösung wählen.");
        MediaFormat mf = MediaFormat.createVideoFormat(mime, ww, hh);
        mf.setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatYUV420Flexible);
        mf.setInteger(MediaFormat.KEY_BIT_RATE, vc != null ? Math.min(br, vc.getBitrateRange().getUpper()) : br);
        mf.setInteger(MediaFormat.KEY_FRAME_RATE, f);
        mf.setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, VideoExportPlan.KEY_INTERVAL_S);
        if (Build.VERSION.SDK_INT >= 24) {
            mf.setInteger(MediaFormat.KEY_COLOR_STANDARD, MediaFormat.COLOR_STANDARD_BT709);
            mf.setInteger(MediaFormat.KEY_COLOR_RANGE, MediaFormat.COLOR_RANGE_LIMITED);
            mf.setInteger(MediaFormat.KEY_COLOR_TRANSFER, MediaFormat.COLOR_TRANSFER_SDR_VIDEO);
        }
        if (Build.VERSION.SDK_INT >= 29) mf.setInteger(MediaFormat.KEY_MAX_B_FRAMES, 0);
        String name = VideoExportPlan.fileName(a.optString("name", "Flug.mp4"));
        cleanup(c);
        File o = new File(PhotoProvider.camDir(c), name);
        try {
            enc = MediaCodec.createByCodecName(ci.getName());
            enc.configure(mf, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE);
            enc.start();
            mux = new MediaMuxer(o.getAbsolutePath(), MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4);
        } catch (Exception e) {
            release(true);
            if (o.exists()) o.delete();
            throw new Exception(VideoExportPlan.errorText(String.valueOf(e.getMessage())));
        }
        out = o; w = ww; h = hh; fps = f; frames = 0; written = 0; track = -1; muxStarted = false; encName = ci.getName();
        bi = new MediaCodec.BufferInfo();
        argb = new int[w * h]; yb = new byte[w * h]; ub = new byte[w * h / 4]; vb = new byte[w * h / 4];
        AppLog.log("Flugvideo: " + encName + " " + w + "x" + h + " " + f + " fps " + br + " bit/s");
        return new JSONObject().put("ok", true).put("encoder", encName).put("hw", hw(ci)).put("w", w).put("h", h).put("name", name);
    }

    /** Ein Bild (JPEG/PNG als Base64) kodieren. */
    static synchronized JSONObject frame(JSONObject a) throws Exception {
        if (enc == null) throw new Exception("Es läuft kein Video-Export.");
        byte[] data = android.util.Base64.decode(a.getString("b64"), android.util.Base64.DEFAULT);
        Bitmap bm = BitmapFactory.decodeByteArray(data, 0, data.length);
        if (bm == null) throw new Exception("Bild " + frames + " ließ sich nicht lesen");
        try {
            if (bm.getWidth() != w || bm.getHeight() != h) {
                Bitmap s = Bitmap.createScaledBitmap(bm, w, h, true);
                bm.recycle();
                bm = s;
            }
            bm.getPixels(argb, 0, w, 0, 0, w, h);
        } finally { bm.recycle(); }
        VideoExportPlan.argbToYuv420(argb, w, h, yb, ub, vb);
        int ix = -1;
        for (int k = 0; k < 400 && ix < 0; k++) {           // höchstens etwa 4 s warten; dazwischen fertige Bilder abholen
            ix = enc.dequeueInputBuffer(10_000);
            if (ix < 0) drain(false);
        }
        if (ix < 0) throw new Exception("Der Video-Kodierer nimmt keine Bilder mehr an");
        Image img = enc.getInputImage(ix);
        if (img == null) throw new Exception("Der Video-Kodierer bietet keine Bildpuffer an");
        Image.Plane[] pl = img.getPlanes();
        put(pl[0], yb, w, h);
        put(pl[1], ub, w / 2, h / 2);
        put(pl[2], vb, w / 2, h / 2);
        enc.queueInputBuffer(ix, 0, w * h * 3 / 2, VideoExportPlan.timeUs(frames, fps), 0);
        frames++;
        drain(false);
        return new JSONObject().put("ok", true).put("i", frames).put("bytes", written);
    }

    /** Eine Ebene zeilenweise in den Bildpuffer des Kodierers (Zeilen- und Punktabstand beachten). */
    private static void put(Image.Plane p, byte[] src, int pw, int ph) {
        ByteBuffer b = p.getBuffer();
        int rs = p.getRowStride(), ps = p.getPixelStride();
        for (int r = 0; r < ph; r++) {
            int base = r * rs;
            if (ps == 1) { b.position(base); b.put(src, r * pw, pw); }
            else for (int x = 0; x < pw; x++) b.put(base + x * ps, src[r * pw + x]);
        }
    }

    private static void drain(boolean eos) {
        int idle = 0;
        while (true) {
            int ix = enc.dequeueOutputBuffer(bi, eos ? 10_000 : 0);
            if (ix == MediaCodec.INFO_TRY_AGAIN_LATER) {
                if (!eos || ++idle > 500) return;
                continue;
            }
            if (ix == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                track = mux.addTrack(enc.getOutputFormat());
                mux.start();
                muxStarted = true;
                continue;
            }
            if (ix < 0) continue;
            ByteBuffer ob = enc.getOutputBuffer(ix);
            if ((bi.flags & MediaCodec.BUFFER_FLAG_CODEC_CONFIG) != 0) bi.size = 0;
            if (bi.size > 0 && muxStarted && ob != null) {
                ob.position(bi.offset);
                ob.limit(bi.offset + bi.size);
                mux.writeSampleData(track, ob, bi);
                written += bi.size;
            }
            enc.releaseOutputBuffer(ix, false);
            if ((bi.flags & MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) return;
        }
    }

    static synchronized JSONObject finish(Context c) throws Exception {
        if (enc == null) throw new Exception("Es läuft kein Video-Export.");
        if (frames == 0) { release(true); throw new Exception("Keine Bilder kodiert"); }
        int ix = -1;
        for (int k = 0; k < 400 && ix < 0; k++) { ix = enc.dequeueInputBuffer(10_000); if (ix < 0) drain(false); }
        if (ix >= 0) enc.queueInputBuffer(ix, 0, 0, VideoExportPlan.timeUs(frames, fps), MediaCodec.BUFFER_FLAG_END_OF_STREAM);
        drain(true);
        File f = out;
        long n = frames;
        boolean ok = muxStarted;
        out = null;           // release() darf die fertige Datei nicht löschen
        release(false);
        if (!ok || f == null || !f.isFile() || f.length() == 0) { if (f != null) f.delete(); throw new Exception("Das Video ist leer geblieben"); }
        JSONObject r = publish(c, f);
        return r.put("frames", n).put("encoder", encName);
    }

    /** Abbrechen: Kodierer freigeben, Zwischendateien löschen (auch die des WebCodecs-Wegs, tmp im Ordner rec). */
    static synchronized void cancel(Context c, String tmp) {
        release(true);
        if (tmp != null && !tmp.isEmpty()) {
            File t = new File(new File(c.getCacheDir(), "rec"), new File(tmp).getName().replaceAll("[^A-Za-z0-9._-]", "_"));
            if (t.exists()) t.delete();
        }
    }

    private static void release(boolean deleteOut) {
        try { if (enc != null) enc.stop(); } catch (Exception e) { /* egal */ }
        try { if (enc != null) enc.release(); } catch (Exception e) { /* egal */ }
        try { if (mux != null && muxStarted) mux.stop(); } catch (Exception e) { /* egal */ }
        try { if (mux != null) mux.release(); } catch (Exception e) { /* egal */ }
        enc = null; mux = null; muxStarted = false; track = -1;
        argb = null; yb = null; ub = null; vb = null;
        if (deleteOut && out != null && out.exists()) out.delete();
        out = null;
    }

    /** Frühere Export-Dateien im Teilen-Ordner entfernen (sie liegen ohnehin in der Galerie). */
    private static void cleanup(Context c) {
        File[] fs = PhotoProvider.camDir(c).listFiles();
        if (fs != null) for (File f : fs) if (f.getName().startsWith("Flug_") && f.getName().endsWith(".mp4")) f.delete();
    }

    /* ---------------- Weg 1: fertige MP4 aus WebCodecs ---------------- */

    /** {tmp, name, patchAt, patchB64}: Datei aus cache/rec, Größe des Datenteils eintragen, in den Teilen-Ordner und in die Galerie. */
    static synchronized JSONObject saveMuxed(Context c, JSONObject a) throws Exception {
        File t = new File(new File(c.getCacheDir(), "rec"), new File(a.getString("tmp")).getName().replaceAll("[^A-Za-z0-9._-]", "_"));
        if (!t.isFile()) throw new Exception("Videodatei fehlt");
        byte[] patch = android.util.Base64.decode(a.optString("patchB64", ""), android.util.Base64.DEFAULT);
        long at = a.optLong("patchAt", -1);
        try (RandomAccessFile rf = new RandomAccessFile(t, "rw")) {
            byte[] head = new byte[8];
            rf.readFully(head);
            if (head[4] != 'f' || head[5] != 't' || head[6] != 'y' || head[7] != 'p') throw new Exception("Keine MP4-Datei");
            if (patch.length != 8 || at < 8 || at + 8 > rf.length()) throw new Exception("Ungültige Angabe zur Dateigröße");
            rf.seek(at);
            rf.write(patch);
        } catch (Exception e) { t.delete(); throw e; }
        String name = VideoExportPlan.fileName(a.optString("name", "Flug.mp4"));
        cleanup(c);
        File dst = new File(PhotoProvider.camDir(c), name);
        if (dst.exists()) dst.delete();
        if (!t.renameTo(dst)) {
            java.nio.file.Files.copy(t.toPath(), dst.toPath(), java.nio.file.StandardCopyOption.REPLACE_EXISTING);
            t.delete();
        }
        return publish(c, dst);
    }

    /* ---------------- Ergebnis ---------------- */

    private static JSONObject publish(Context c, File f) throws Exception {
        JSONObject r = new JSONObject().put("ok", true).put("name", f.getName()).put("bytes", f.length());
        try {
            if (Build.VERSION.SDK_INT >= 29) { galleryQ(c, f); r.put("gallery", true).put("shown", "Movies/Tourentagebuch/" + f.getName()); }
            else {
                File d = c.getExternalFilesDir(Environment.DIRECTORY_MOVIES);
                if (d == null) throw new Exception("kein App-Ordner");
                d.mkdirs();
                copy(f, new File(d, f.getName()));
                r.put("gallery", false).put("shown", "Android/data/" + c.getPackageName() + "/files/Movies/" + f.getName());
            }
        } catch (Exception e) {
            AppLog.log("Flugvideo Galerie: " + e);
            r.put("gallery", false).put("msg", VideoExportPlan.errorText(String.valueOf(e.getMessage())));
        }
        return r;
    }

    private static void copy(File src, File dst) throws Exception {
        try (InputStream in = new FileInputStream(src); OutputStream o = new FileOutputStream(dst)) {
            byte[] b = new byte[256 * 1024];
            int n;
            while ((n = in.read(b)) > 0) o.write(b, 0, n);
        }
    }

    @TargetApi(29)
    private static void galleryQ(Context c, File src) throws Exception {
        ContentResolver cr = c.getContentResolver();
        ContentValues v = new ContentValues();
        v.put(MediaStore.MediaColumns.DISPLAY_NAME, src.getName());
        v.put(MediaStore.MediaColumns.MIME_TYPE, "video/mp4");
        v.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_MOVIES + "/Tourentagebuch");
        v.put(MediaStore.MediaColumns.IS_PENDING, 1);
        Uri u = cr.insert(MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY), v);
        if (u == null) throw new Exception("MediaStore lehnt ab");
        try {
            try (InputStream in = new FileInputStream(src); OutputStream o = cr.openOutputStream(u)) {
                if (o == null) throw new Exception("kein Ausgabestrom");
                byte[] b = new byte[256 * 1024];
                int n;
                while ((n = in.read(b)) > 0) o.write(b, 0, n);
            }
            ContentValues fin = new ContentValues();
            fin.put(MediaStore.MediaColumns.IS_PENDING, 0);
            cr.update(u, fin, null, null);
        } catch (Exception e) {
            try { cr.delete(u, null, null); } catch (Exception e2) { /* egal */ }
            throw e;
        }
    }

    /** Fertige Datei im Teilen-Ordner (für Teilen und Abspielen); null, wenn es sie nicht gibt. */
    static File result(Context c, String name) {
        File f = new File(PhotoProvider.camDir(c), VideoExportPlan.fileName(name));
        return f.isFile() ? f : null;
    }
}
