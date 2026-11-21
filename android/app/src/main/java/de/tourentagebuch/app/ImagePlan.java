package de.tourentagebuch.app;

/**
 * 2.8.0: reine Größenentscheidungen beim Foto-Import (ohne Android, darum auch auf dem Rechner prüfbar: tests/android/ImagePlanCheck.java).
 * Panoramen (Seitenverhältnis über 2,2 : 1, z. B. 12000 × 3000 px) behalten mehr Pixel auf der langen Seite (4096 statt 2400),
 * damit sie in der Vollbildansicht „auf Höhe“ nicht matschig werden; 4096 bleibt unter der Texturgrenze vieler WebViews.
 * Beim Dekodieren wird so weit verkleinert (inSampleSize), dass weder die lange Seite unnötig groß ist noch der Speicher überläuft.
 */
public final class ImagePlan {
    private ImagePlan() { }

    public static final double PANO_RATIO = 2.2;
    public static final int MAX_PX = 2400, PANO_PX = 4096, THUMB_PX = 480, PANO_THUMB_SHORT = 240, PANO_THUMB_LONG = 1200;
    /** Höchstens so viele Pixel dekodieren (16 MP ≈ 64 MB bei ARGB_8888). */
    public static final long MAX_DECODE_PIXELS = 16L * 1000 * 1000;

    /** Panorama: lange Seite mehr als 2,2-mal so lang wie die kurze (quer oder hoch). */
    public static boolean isPano(int w, int h) {
        if (w <= 0 || h <= 0) return false;
        return (double) Math.max(w, h) / Math.min(w, h) > PANO_RATIO;
    }

    /** Größte erlaubte lange Seite der gespeicherten Kopie. */
    public static int maxLong(int w, int h) { return isPano(w, h) ? PANO_PX : MAX_PX; }

    /** inSampleSize (Zweierpotenz): halbiert, solange die lange Seite danach noch mindestens maxLong hat, dann weiter, bis höchstens maxPixels übrig sind. */
    public static int sampleSize(int w, int h, int maxLong, long maxPixels) {
        if (w <= 0 || h <= 0) return 1;
        int big = Math.max(w, h), ss = 1;
        while (big / (ss * 2) >= maxLong) ss *= 2;
        while ((long) (w / ss) * (h / ss) > maxPixels && ss < 1 << 12) ss *= 2;
        return ss;
    }

    /** Endgröße der gespeicherten Kopie (nie größer als das Original). */
    public static int[] outSize(int w, int h) {
        int ml = maxLong(w, h);
        return scaled(w, h, (double) ml / Math.max(w, h));
    }

    /** Größe des Vorschaubilds: normal lange Seite 480; Panorama kurze Seite 240 (lange höchstens 1200), damit Kacheln mit „cover“ nicht unscharf werden. */
    public static int[] thumbSize(int w, int h) {
        if (w <= 0 || h <= 0) return new int[]{Math.max(w, 0), Math.max(h, 0)};
        double s = isPano(w, h)
                ? Math.min((double) PANO_THUMB_SHORT / Math.min(w, h), (double) PANO_THUMB_LONG / Math.max(w, h))
                : (double) THUMB_PX / Math.max(w, h);
        return scaled(w, h, s);
    }

    private static int[] scaled(int w, int h, double s) {
        if (s >= 1) return new int[]{w, h};
        return new int[]{Math.max(1, (int) Math.round(w * s)), Math.max(1, (int) Math.round(h * s))};
    }
}
