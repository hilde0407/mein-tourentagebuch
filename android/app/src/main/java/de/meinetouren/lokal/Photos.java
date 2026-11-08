package de.meinetouren.lokal;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Matrix;
import android.media.ExifInterface;

import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.security.MessageDigest;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;

/** Foto-Import: kopiert ein Bild in den privaten App-Speicher (verkleinert), liest Aufnahmezeit und GPS-Position aus den EXIF-Daten. */
public final class Photos {
    private Photos() {}

    public static final int MAX_PX = 2400, THUMB_PX = 480;

    public static File dir(Context c) { File d = new File(c.getFilesDir(), "photos"); d.mkdirs(); return d; }
    public static File thumbDir(Context c) { File d = new File(c.getFilesDir(), "thumbs"); d.mkdirs(); return d; }

    /**
     * @param in        Bilddaten
     * @param name      ursprünglicher Dateiname
     * @param fallbackMs Zeit (Dateidatum), falls das Bild keine Aufnahmezeit enthält; 0 = unbekannt
     * @param forceLat  feste Position (z. B. bei Kamera-Aufnahme während der Aufzeichnung) oder NaN
     * @param forceTs   feste Aufnahmezeit oder 0
     */
    public static JSONObject importStream(Context c, InputStream in, String name, long fallbackMs, double forceLat, double forceLon, long forceTs, String src) throws Exception {
        File tmp = File.createTempFile("imp", ".jpg", c.getCacheDir());
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-1");
            try (FileOutputStream o = new FileOutputStream(tmp)) {
                byte[] b = new byte[64 * 1024];
                int n;
                while ((n = in.read(b)) > 0) { o.write(b, 0, n); md.update(b, 0, n); }
            }
            StringBuilder sb = new StringBuilder();
            for (byte x : md.digest()) sb.append(String.format(Locale.US, "%02x", x));
            String id = sb.substring(0, 20);
            ExifInterface ex = new ExifInterface(tmp.getAbsolutePath());
            long ts = 0;
            String dt = ex.getAttribute(ExifInterface.TAG_DATETIME_ORIGINAL);
            if (dt == null) dt = ex.getAttribute(ExifInterface.TAG_DATETIME);
            String off = ex.getAttribute("OffsetTimeOriginal");
            if (off == null) off = ex.getAttribute("OffsetTime");
            if (dt != null) {
                try {
                    boolean hasOff = off != null && off.matches("[+-]\\d\\d:\\d\\d");
                    SimpleDateFormat f = new SimpleDateFormat(hasOff ? "yyyy:MM:dd HH:mm:ss Z" : "yyyy:MM:dd HH:mm:ss", Locale.US);
                    if (hasOff) ts = f.parse(dt + " " + off.replace(":", "")).getTime();
                    else { f.setTimeZone(TimeZone.getDefault()); ts = f.parse(dt).getTime(); }
                } catch (Exception e) { ts = 0; }
            }
            if (forceTs > 0) ts = forceTs;
            if (ts == 0) ts = fallbackMs;
            double lat = Double.NaN, lon = Double.NaN;
            float[] ll = new float[2];
            if (ex.getLatLong(ll)) { lat = ll[0]; lon = ll[1]; }
            if (!Double.isNaN(forceLat) && !Double.isNaN(forceLon)) { lat = forceLat; lon = forceLon; }
            int orient = ex.getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL);

            File out = new File(dir(c), id + ".jpg"), th = new File(thumbDir(c), id + ".jpg");
            int[] wh = new int[2];
            if (!out.exists() || !th.exists()) {
                BitmapFactory.Options bo = new BitmapFactory.Options();
                bo.inJustDecodeBounds = true;
                BitmapFactory.decodeFile(tmp.getAbsolutePath(), bo);
                int big = Math.max(bo.outWidth, bo.outHeight);
                int ss = 1;
                while (big / (ss * 2) >= MAX_PX) ss *= 2;
                BitmapFactory.Options o2 = new BitmapFactory.Options();
                o2.inSampleSize = ss;
                Bitmap bm = BitmapFactory.decodeFile(tmp.getAbsolutePath(), o2);
                if (bm == null) throw new Exception("kein Bild");
                Matrix m = new Matrix();
                switch (orient) {
                    case ExifInterface.ORIENTATION_ROTATE_90: m.postRotate(90); break;
                    case ExifInterface.ORIENTATION_ROTATE_180: m.postRotate(180); break;
                    case ExifInterface.ORIENTATION_ROTATE_270: m.postRotate(270); break;
                    default: break;
                }
                float sc = (float) MAX_PX / Math.max(bm.getWidth(), bm.getHeight());
                if (sc < 1f) m.postScale(sc, sc);
                Bitmap r = Bitmap.createBitmap(bm, 0, 0, bm.getWidth(), bm.getHeight(), m, true);
                if (r != bm) bm.recycle();
                try (FileOutputStream fo = new FileOutputStream(out)) { r.compress(Bitmap.CompressFormat.JPEG, 86, fo); }
                float s2 = (float) THUMB_PX / Math.max(r.getWidth(), r.getHeight());
                Bitmap t = s2 < 1f ? Bitmap.createScaledBitmap(r, Math.round(r.getWidth() * s2), Math.round(r.getHeight() * s2), true) : r;
                try (FileOutputStream fo = new FileOutputStream(th)) { t.compress(Bitmap.CompressFormat.JPEG, 80, fo); }
                wh[0] = r.getWidth(); wh[1] = r.getHeight();
                if (t != r) t.recycle();
                r.recycle();
            } else {
                BitmapFactory.Options bo = new BitmapFactory.Options();
                bo.inJustDecodeBounds = true;
                BitmapFactory.decodeFile(out.getAbsolutePath(), bo);
                wh[0] = bo.outWidth; wh[1] = bo.outHeight;
            }
            JSONObject j = new JSONObject();
            j.put("id", id).put("name", name == null ? id + ".jpg" : name).put("ts", ts).put("w", wh[0]).put("h", wh[1]).put("src", src == null ? "" : src);
            if (!Double.isNaN(lat)) j.put("lat", lat).put("lon", lon);
            return j;
        } finally {
            tmp.delete();
        }
    }

    public static JSONObject importFile(Context c, File f, String src) throws Exception {
        try (InputStream in = new FileInputStream(f)) {
            return importStream(c, in, f.getName(), f.lastModified(), Double.NaN, Double.NaN, 0, src);
        }
    }

    public static void delete(Context c, String id) {
        if (id == null || !id.matches("[0-9a-f]{6,40}")) return;
        new File(dir(c), id + ".jpg").delete();
        new File(thumbDir(c), id + ".jpg").delete();
    }

    public static String iso(long ms) {
        SimpleDateFormat f = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US);
        f.setTimeZone(TimeZone.getTimeZone("UTC"));
        return f.format(new Date(ms));
    }
}
