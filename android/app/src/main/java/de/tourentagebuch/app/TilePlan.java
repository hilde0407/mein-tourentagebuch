package de.tourentagebuch.app;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.TreeSet;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 2.11.0: Reine Rechenlogik für Offline-Karten (ohne Android, Prüfung: tests/android/TilePlanCheck.java).
 * Gegenstück zu js/calc-offline.js – gleiche Rechnung und gleiche Grenzen. Die Hülle rechnet die Kachelliste selbst
 * aus den Angaben (Rechteck oder Strecke mit Rand, Zoomstufen) und vertraut der Oberfläche nicht.
 *
 * Quellen nur aus der festen Liste: "osm" (tile.openstreetmap.org – Offline-Nutzung laut Betreiber verboten, darum
 * nie geladen, nur gespeicherte Kacheln würden ausgeliefert) und "topo" (OpenTopoMap, kleine Mengen für den Eigenbedarf).
 * Pfadteile bestehen nur aus Ziffern; Dateien liegen unter filesDir/tiles/&lt;quelle&gt;/&lt;z&gt;/&lt;x&gt;/&lt;y&gt;.png.
 */
public final class TilePlan {
    private TilePlan() { }

    public static final int MAX_TILES = 2000;                 // je Ausschnitt, hart
    public static final int ZMIN = 10, ZMAX = 16;             // Zoomstufen zum Laden
    public static final int ZSERVE = 19;                      // ausliefern bis zu dieser Stufe (Karte), laden nie über ZMAX
    public static final long MAX_TOTAL = 400L * 1048576L;     // alle Offline-Karten zusammen
    public static final int COVER_Z = 12;                     // grobes Raster für „liegt der Ort in einer Offline-Karte?“
    public static final int COUNT_LIMIT = 60000;              // Zählen bricht hier ab
    public static final int MAX_POINTS = 5000;                // Stützpunkte einer Strecke, die angenommen werden
    public static final long REFRESH_MS = 7L * 24 * 3600 * 1000;   // „Aktualisieren“ lädt nur Kacheln, die älter sind (Server schonen)

    private static final double MAXLAT = 85.0511287798, RAD = Math.PI / 180, M_GRAD = 111320;

    public static final String[] SOURCES = {"osm", "topo"};

    public static boolean known(String src) { return "osm".equals(src) || "topo".equals(src); }

    /** Darf von dieser Quelle vorausgeladen werden? Nur OpenTopoMap (OSM-Standardserver: Offline-Nutzung verboten). */
    public static boolean offlineAllowed(String src) { return "topo".equals(src); }

    public static String sourceName(String src) {
        return "topo".equals(src) ? "Wanderkarte (OpenTopoMap)" : "osm".equals(src) ? "Straßenkarte (OpenStreetMap)" : "?";
    }

    /** Geschätzte Größe einer Kachel in Bytes (wie in calc-offline.js). */
    public static long estimateBytes(String src, long n) { return Math.round(("osm".equals(src) ? 20 : 25) * 1024.0 * Math.max(0, n)); }

    /** Adresse beim Kartenserver, oder null bei ungültigen Angaben. */
    public static String url(String src, int z, int x, int y) {
        if (!valid(src, z, x, y)) return null;
        String host = "topo".equals(src) ? "tile.opentopomap.org" : "tile.openstreetmap.org";
        return "https://" + host + "/" + z + "/" + x + "/" + y + ".png";
    }

    public static boolean valid(String src, int z, int x, int y) {
        if (!known(src) || z < 0 || z > ZSERVE) return false;
        long n = 1L << z;
        return x >= 0 && y >= 0 && x < n && y < n;
    }

    /** Relativer Dateiname „topo/15/17403/11458.png“ oder null. */
    public static String relPath(String src, int z, int x, int y) {
        return valid(src, z, x, y) ? src + "/" + z + "/" + x + "/" + y + ".png" : null;
    }

    private static final Pattern LOCAL = Pattern.compile("^/tiles/(osm|topo)/(\\d{1,2})/(\\d{1,7})/(\\d{1,7})\\.png$");
    private static final Pattern REMOTE_PATH = Pattern.compile("^/(\\d{1,2})/(\\d{1,7})/(\\d{1,7})\\.png$");
    private static final Pattern TOPO_HOST = Pattern.compile("^([abc]\\.)?tile\\.opentopomap\\.org$");

    /** Pfad des virtuellen Servers (/tiles/topo/15/1/2.png) → relativer Dateiname, oder null. */
    public static String localPath(String path) {
        if (path == null) return null;
        Matcher m = LOCAL.matcher(path);
        if (!m.matches()) return null;
        return relPath(m.group(1), Integer.parseInt(m.group(2)), Integer.parseInt(m.group(3)), Integer.parseInt(m.group(4)));
    }

    /** Kachel-Adresse eines bekannten Kartenservers (Host + Pfad) → relativer Dateiname, oder null (dann geht die Anfrage normal ins Netz). */
    public static String remotePath(String host, String path) {
        if (host == null || path == null) return null;
        String h = host.toLowerCase(Locale.ROOT), src = "tile.openstreetmap.org".equals(h) ? "osm" : TOPO_HOST.matcher(h).matches() ? "topo" : null;
        if (src == null) return null;
        Matcher m = REMOTE_PATH.matcher(path);
        if (!m.matches()) return null;
        return relPath(src, Integer.parseInt(m.group(1)), Integer.parseInt(m.group(2)), Integer.parseInt(m.group(3)));
    }

    /** Ausschnitt-Kennung: nur Kleinbuchstaben und Ziffern, 1 bis 24 Zeichen. */
    public static boolean validId(String id) { return id != null && id.matches("^[a-z0-9]{1,24}$"); }

    /** Name eines Ausschnitts: ohne Steuerzeichen, höchstens 60 Zeichen, nie leer. */
    public static String name(String s, String fb) {
        String t = (s == null ? "" : s).replaceAll("[\\u0000-\\u001f\\u007f]", " ").replaceAll("\\s+", " ").trim();
        if (t.length() > 60) t = t.substring(0, 60);
        return t.isEmpty() ? (fb == null || fb.isEmpty() ? "Offline-Karte" : fb) : t;
    }

    /* ---------- Kachelrechnung ---------- */

    public static int[] tileXY(double lat, double lon, int z) {
        long n = 1L << z;
        double la = Math.max(-MAXLAT, Math.min(MAXLAT, lat)) * RAD;
        long x = (long) Math.floor((lon + 180) / 360 * n);
        long y = (long) Math.floor((1 - Math.log(Math.tan(la) + 1 / Math.cos(la)) / Math.PI) / 2 * n);
        x = Math.max(0, Math.min(n - 1, x));
        y = Math.max(0, Math.min(n - 1, y));
        return new int[]{(int) x, (int) y};
    }

    public static long key(int z, int x, int y) { return ((long) z << 40) | ((long) x << 20) | y; }
    public static int[] unkey(long k) { return new int[]{(int) (k >>> 40), (int) ((k >>> 20) & 0xFFFFF), (int) (k & 0xFFFFF)}; }

    private static int[] zooms(int zmin, int zmax) {
        int a = Math.max(0, zmin), b = Math.min(ZMAX, zmax);
        return a <= b ? new int[]{a, b} : null;
    }

    /** Anzahl der Kacheln eines Rechtecks (s, w, n, e in Grad) in zmin … zmax. */
    public static long countRect(double s, double w, double n, double e, int zmin, int zmax) {
        int[] zz = zooms(zmin, zmax);
        if (zz == null) return 0;
        long c = 0;
        for (int z = zz[0]; z <= zz[1]; z++) {
            int[] a = tileXY(n, w, z), b = tileXY(s, e, z);
            c += (long) Math.max(0, b[0] - a[0] + 1) * Math.max(0, b[1] - a[1] + 1);
        }
        return c;
    }

    /** Ergebnis einer Planung: Schlüssel (sortiert) oder null, wenn es mehr als max sind; count zählt bis COUNT_LIMIT. */
    public static final class Plan {
        public final long[] keys; public final int count; public final boolean more;
        Plan(long[] k, int c, boolean m) { keys = k; count = c; more = m; }
    }

    public static Plan rect(double s, double w, double n, double e, int zmin, int zmax, int max) {
        long c = countRect(s, w, n, e, zmin, zmax);
        if (c > max) return new Plan(null, (int) Math.min(c, COUNT_LIMIT), c >= COUNT_LIMIT);
        int[] zz = zooms(zmin, zmax);
        long[] out = new long[(int) c];
        int i = 0;
        if (zz != null) for (int z = zz[0]; z <= zz[1]; z++) {
            int[] a = tileXY(n, w, z), b = tileXY(s, e, z);
            for (int x = a[0]; x <= b[0]; x++) for (int y = a[1]; y <= b[1]; y++) out[i++] = key(z, x, y);
        }
        return new Plan(out, (int) c, false);
    }

    /** Stützpunkte entlang der Strecke (Abstand höchstens step Meter), wie in calc-offline.js. pts: {lat, lon}. */
    public static List<double[]> supports(double[][] pts, double step) {
        List<double[]> v = new ArrayList<>(), out = new ArrayList<>();
        if (pts != null) for (double[] p : pts)
            if (p != null && p.length >= 2 && !Double.isNaN(p[0]) && !Double.isNaN(p[1]) && !Double.isInfinite(p[0]) && !Double.isInfinite(p[1]) && Math.abs(p[0]) <= 90 && Math.abs(p[1]) <= 180) v.add(p);
        for (int i = 0; i < v.size(); i++) {
            double[] a = v.get(i);
            if (i == 0) { out.add(new double[]{a[0], a[1]}); continue; }
            double[] b = v.get(i - 1);
            double dy = (a[0] - b[0]) * M_GRAD, dx = (a[1] - b[1]) * M_GRAD * Math.cos((a[0] + b[0]) / 2 * RAD);
            int k = (int) Math.ceil(Math.sqrt(dx * dx + dy * dy) / step);
            for (int j = 1; j <= k; j++) { double t = (double) j / k; out.add(new double[]{b[0] + (a[0] - b[0]) * t, b[1] + (a[1] - b[1]) * t}); }
        }
        return out;
    }

    /** Kacheln für eine Strecke mit Rand (Meter): um jeden Stützpunkt ein Quadrat mit halber Kantenlänge rand. */
    public static Plan corridor(double[][] pts, double rand, int zmin, int zmax, int max) {
        int[] zz = zooms(zmin, zmax);
        double m = Math.max(0, rand);
        Set<Long> set = new HashSet<>();
        boolean more = false;
        if (zz != null) {
            List<double[]> st = supports(pts, Math.max(100, m));
            outer:
            for (int z = zz[0]; z <= zz[1]; z++) {
                for (double[] s : st) {
                    double dla = m / M_GRAD, dlo = m / (M_GRAD * Math.max(0.01, Math.cos(s[0] * RAD)));
                    int[] a = tileXY(s[0] + dla, s[1] - dlo, z), b = tileXY(s[0] - dla, s[1] + dlo, z);
                    for (int x = a[0]; x <= b[0]; x++) for (int y = a[1]; y <= b[1]; y++) {
                        set.add(key(z, x, y));
                        if (set.size() >= COUNT_LIMIT) { more = true; break outer; }
                    }
                }
            }
        }
        if (set.size() > max) return new Plan(null, set.size(), more);
        long[] out = new long[set.size()];
        int i = 0;
        for (long k : set) out[i++] = k;
        Arrays.sort(out);
        return new Plan(out, out.length, more);
    }

    /** Umgebendes Rechteck einer Strecke mit Rand: {s, w, n, e} oder null. */
    public static double[] frame(double[][] pts, double rand) {
        double s = 90, w = 180, n = -90, e = -180;
        boolean any = false;
        if (pts != null) for (double[] p : pts) {
            if (p == null || p.length < 2 || Double.isNaN(p[0]) || Double.isNaN(p[1])) continue;
            any = true; s = Math.min(s, p[0]); n = Math.max(n, p[0]); w = Math.min(w, p[1]); e = Math.max(e, p[1]);
        }
        if (!any) return null;
        double m = Math.max(0, rand), dla = m / M_GRAD, dlo = m / (M_GRAD * Math.max(0.01, Math.cos((s + n) / 2 * RAD)));
        return new double[]{Math.max(-MAXLAT, s - dla), Math.max(-180, w - dlo), Math.min(MAXLAT, n + dla), Math.min(180, e + dlo)};
    }

    /** Grobes Raster (Zoom 12): „x/y“, sortiert. */
    public static List<String> cover(long[] keys) {
        TreeSet<String> set = new TreeSet<>();
        if (keys != null) for (long k : keys) {
            int[] t = unkey(k);
            if (t[0] >= COVER_Z) { int d = t[0] - COVER_Z; set.add((t[1] >> d) + "/" + (t[2] >> d)); }
        }
        return new ArrayList<>(set);
    }

    /** Darf geladen werden? null = ja, sonst der Grund (Text für die Oberfläche). */
    public static String check(String src, long n, long used) {
        if (!known(src)) return "Unbekannte Kartenquelle.";
        if (!offlineAllowed(src)) return "Diese Karte darf nicht offline gespeichert werden (Nutzungsregeln des Betreibers). Offline gibt es die Wanderkarte.";
        if (n <= 0) return "Kein Ausschnitt gewählt.";
        if (n > MAX_TILES) return "Zu groß: höchstens " + MAX_TILES + " Kacheln je Ausschnitt.";
        if (used + estimateBytes(src, n) > MAX_TOTAL) return "Zu wenig Platz: Offline-Karten dürfen zusammen höchstens 400 MB belegen. Bitte erst eine alte Karte löschen.";
        return null;
    }

    /** Muss diese Kachel geladen werden? exists/mtime der Datei, refresh = „Aktualisieren“. */
    public static boolean needs(boolean exists, long length, long mtime, boolean refresh, long now) {
        if (!exists || length <= 0) return true;
        return refresh && now - mtime > REFRESH_MS;
    }

    /** Wartezeit vor dem nächsten Versuch (Millisekunden) nach Fehlversuch attempt (1, 2, …); 429/503 = Server bittet um Pause. */
    public static long backoff(int attempt, int status) {
        if (status == 429 || status == 503) return 30000L * attempt;
        return attempt <= 1 ? 2000 : attempt == 2 ? 5000 : 10000;
    }

    /** Erste Bytes einer PNG- oder JPEG-Datei? (Fehlerseiten des Servers werden nicht gespeichert.) */
    public static boolean looksLikeImage(byte[] b) {
        if (b == null || b.length < 8) return false;
        boolean png = (b[0] & 0xFF) == 0x89 && b[1] == 'P' && b[2] == 'N' && b[3] == 'G';
        boolean jpg = (b[0] & 0xFF) == 0xFF && (b[1] & 0xFF) == 0xD8;
        return png || jpg;
    }
}
