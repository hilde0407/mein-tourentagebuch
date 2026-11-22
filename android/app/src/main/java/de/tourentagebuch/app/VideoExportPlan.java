package de.tourentagebuch.app;

/**
 * 2.17.0: Plan des Video-Exports „3D-Flug als Video“ ohne Android-Klassen (prüfbar mit tests/android/VideoExportPlanCheck.java).
 * Dieselben Werte stehen in js/calc-flug.js (FlugCalc.video): Auflösungsstufen, Datenrate, Bildzahl, Zeitstempel, Platzbedarf, Grenzen.
 * Dazu die Umrechnung der Bildpunkte (ARGB) in YUV 4:2:0 nach BT.709 für den Kodierer (Weg „über Android“, FlugVideo).
 */
public final class VideoExportPlan {
    private VideoExportPlan() { }

    public static final int MAX_FRAMES = 9000;          // 30 Bilder/s × 5 Minuten
    public static final int MIN_FREE_MB = 500;
    public static final int KEY_INTERVAL_S = 2;         // Schlüsselbild alle 2 s
    public static final int MAX_SIDE = 4096;
    public static final int MIN_SIDE = 64;
    static final int[] SHORT_SIDES = {720, 1080, 1440, 2160};

    /** Größe aus kurzer Seite und Format ("quer" 16:9, "hoch" 9:16, "quadrat" 1:1). {w, h}, gerade. */
    public static int[] size(int shortSide, String format) {
        int k = Math.round(shortSide / 2f) * 2, l = Math.round(k * 16f / 9f / 2f) * 2;
        if ("hoch".equals(format)) return new int[]{k, l};
        if ("quadrat".equals(format)) return new int[]{k, k};
        return new int[]{l, k};
    }

    /** Datenrate (bit/s): 720p 8, 1080p 18, 1440p 30, 2160p 50 Mbit/s bei 30 Bildern/s und 16:9; 60 Bilder/s × 1,5; HEVC × 0,65; auf 0,5 Mbit/s gerundet. */
    public static int bitrate(int w, int h, int fps, String codec) {
        int kurz = Math.min(w, h), lang = Math.max(w, h);
        double basis;
        switch (kurz) {
            case 720: basis = 8; break;
            case 1080: basis = 18; break;
            case 1440: basis = 30; break;
            case 2160: basis = 50; break;
            default: basis = 18.0 * kurz * kurz / (1080.0 * 1080.0);
        }
        double flaeche = Math.min(1.0, lang / (kurz * 16.0 / 9.0));
        double mbit = basis * flaeche * (fps > 30 ? 1.5 : 1) * ("hevc".equals(codec) ? 0.65 : 1);
        return (int) Math.round(Math.max(1, Math.round(mbit * 2) / 2.0) * 1e6);
    }

    /** Bildzahl: Flug plus 1 s Standbild. */
    public static int frames(double seconds, int fps) { return (int) Math.round(seconds * fps) + fps; }

    /** Zeitstempel von Bild i in µs (wie FlugCalc.video.zeitUs). */
    public static long timeUs(long i, int fps) { return Math.round(i * 1e6 / fps); }

    public static double estimateMB(int bitrate, double seconds) { return bitrate * seconds / 8 / 1e6 * 1.02; }

    /** Platzbedarf in MB: Datei + Galerie-Kopie + Reserve. */
    public static long neededMB(double mb) { return (long) Math.ceil(mb * 2 + MIN_FREE_MB); }

    public static String mime(String codec) {
        if (codec == null || "avc".equals(codec) || codec.isEmpty()) return "video/avc";
        if ("hevc".equals(codec)) return "video/hevc";
        return null;
    }

    /** Passt w × h in die Grenzen des Kodierers (lange/kurze Seite)? */
    public static boolean fits(int w, int h, int maxLong, int maxShort) {
        return Math.max(w, h) <= maxLong && Math.min(w, h) <= maxShort;
    }

    /** Eingaben der Oberfläche prüfen. null = in Ordnung, sonst ein Satz für den Menschen. */
    public static String check(int w, int h, int fps, int bitrate, String codec, long freeMB, int frames) {
        if (mime(codec) == null) return "Unbekanntes Videoformat";
        if (w < MIN_SIDE || h < MIN_SIDE || Math.max(w, h) > MAX_SIDE || w % 2 != 0 || h % 2 != 0) return "Ungültige Bildgröße " + w + " × " + h;
        if (fps < 1 || fps > 60) return "Ungültige Bildrate " + fps;
        if (bitrate < 250_000 || bitrate > 200_000_000) return "Ungültige Datenrate";
        if (frames > MAX_FRAMES) return "Zu viele Bilder (höchstens " + MAX_FRAMES + ")";
        double mb = estimateMB(bitrate, frames > 0 ? frames / (double) fps : 0);
        if (freeMB >= 0 && freeMB < neededMB(mb)) return "Zu wenig freier Speicher: etwa " + neededMB(mb) + " MB nötig, " + freeMB + " MB frei";
        return null;
    }

    /** Dateiname aus der Oberfläche absichern: nur Buchstaben, Ziffern, _ - . ; endet auf .mp4; höchstens 100 Zeichen. */
    public static String fileName(String name) {
        String n = name == null ? "" : name.replaceAll("[^A-Za-z0-9._-]", "_").replaceAll("\\.{2,}", "_");
        if (n.toLowerCase(java.util.Locale.ROOT).endsWith(".mp4")) n = n.substring(0, n.length() - 4);
        n = n.replaceAll("^[._]+", "");
        if (n.length() > 96) n = n.substring(0, 96);
        if (n.isEmpty()) n = "Flug";
        return n + ".mp4";
    }

    /** Fehlermeldung des Kodierers in einen verständlichen Satz. */
    public static String errorText(String raw) {
        String r = raw == null ? "" : raw;
        String l = r.toLowerCase(java.util.Locale.ROOT);
        if (l.contains("enospc") || l.contains("no space")) return "Der Speicher ist voll.";
        if (l.contains("codec") && (l.contains("config") || l.contains("0x80001001") || l.contains("unsupported"))) return "Der Video-Kodierer lehnt diese Einstellung ab – bitte eine kleinere Auflösung wählen.";
        if (l.contains("kein export") || l.contains("not started")) return "Es läuft kein Video-Export.";
        return r.isEmpty() ? "Unbekannter Fehler" : r;
    }

    /**
     * ARGB (Bitmap.getPixels) → YUV 4:2:0 in drei Ebenen (y: w·h, u und v: (w/2)·(h/2)), BT.709 mit begrenztem Bereich (16…235/240),
     * Farbe je 2×2-Block gemittelt. w und h gerade.
     */
    public static void argbToYuv420(int[] argb, int w, int h, byte[] y, byte[] u, byte[] v) {
        int cw = w / 2;
        for (int j = 0; j < h; j++) {
            int row = j * w;
            for (int i = 0; i < w; i++) {
                int c = argb[row + i], r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255;
                y[row + i] = (byte) ((47 * r + 157 * g + 16 * b + 4096 + 128) >> 8);
            }
        }
        for (int j = 0; j < h / 2; j++) {
            for (int i = 0; i < cw; i++) {
                int p = 2 * j * w + 2 * i, c0 = argb[p], c1 = argb[p + 1], c2 = argb[p + w], c3 = argb[p + w + 1];
                int r = (((c0 >> 16) & 255) + ((c1 >> 16) & 255) + ((c2 >> 16) & 255) + ((c3 >> 16) & 255) + 2) >> 2;
                int g = (((c0 >> 8) & 255) + ((c1 >> 8) & 255) + ((c2 >> 8) & 255) + ((c3 >> 8) & 255) + 2) >> 2;
                int b = ((c0 & 255) + (c1 & 255) + (c2 & 255) + (c3 & 255) + 2) >> 2;
                u[j * cw + i] = (byte) clamp((-26 * r - 87 * g + 113 * b + 32768 + 128) >> 8);
                v[j * cw + i] = (byte) clamp((112 * r - 102 * g - 10 * b + 32768 + 128) >> 8);
            }
        }
    }

    private static int clamp(int x) { return x < 0 ? 0 : x > 255 ? 255 : x; }
}
