import de.tourentagebuch.app.VideoExportPlan;

/** 2.17.0: Plan des Video-Exports (3D-Flug als Video) ohne Gerät prüfen. Dieselben Zahlen prüft tests/test_calc.js für js/calc-flug.js. */
public class VideoExportPlanCheck {
    static void check(boolean ok, String msg) {
        if (!ok) { System.err.println("FEHLER: " + msg); System.exit(1); }
    }

    public static void main(String[] a) {
        // Größen wie in JS
        int[][] q = {VideoExportPlan.size(720, "quer"), VideoExportPlan.size(1080, "quer"), VideoExportPlan.size(1440, "quer"), VideoExportPlan.size(2160, "quer")};
        check(q[0][0] == 1280 && q[0][1] == 720 && q[1][0] == 1920 && q[1][1] == 1080 && q[2][0] == 2560 && q[2][1] == 1440 && q[3][0] == 3840 && q[3][1] == 2160, "Größen quer");
        int[] s = VideoExportPlan.size(1080, "hoch"); check(s[0] == 1080 && s[1] == 1920, "hoch");
        s = VideoExportPlan.size(1080, "quadrat"); check(s[0] == 1080 && s[1] == 1080, "quadrat");
        // Datenraten wie in JS
        check(VideoExportPlan.bitrate(1280, 720, 30, "avc") == 8_000_000 && VideoExportPlan.bitrate(1920, 1080, 30, "avc") == 18_000_000 && VideoExportPlan.bitrate(2560, 1440, 30, "avc") == 30_000_000
                && VideoExportPlan.bitrate(3840, 2160, 30, "avc") == 50_000_000, "Datenraten");
        check(VideoExportPlan.bitrate(1920, 1080, 60, "avc") == 27_000_000 && VideoExportPlan.bitrate(1080, 1920, 30, "avc") == 18_000_000 && VideoExportPlan.bitrate(1080, 1080, 30, "avc") == 10_000_000, "60 fps / hoch / quadratisch: " + VideoExportPlan.bitrate(1080, 1080, 30, "avc"));
        check(VideoExportPlan.bitrate(3840, 2160, 30, "hevc") == 32_500_000 && VideoExportPlan.bitrate(320, 240, 30, "avc") >= 1_000_000, "HEVC / klein");
        // Bildzahl, Zeitstempel
        check(VideoExportPlan.frames(60, 30) == 1830 && VideoExportPlan.frames(100, 60) == 6060 && VideoExportPlan.frames(10, 30) == 330, "Bildzahl");
        check(VideoExportPlan.timeUs(0, 30) == 0 && VideoExportPlan.timeUs(1, 30) == 33333 && VideoExportPlan.timeUs(30, 30) == 1_000_000 && VideoExportPlan.timeUs(3, 60) == 50000 && VideoExportPlan.timeUs(1829, 30) == 60966667, "Zeitstempel");
        long prev = 0; boolean mono = true;
        for (int i = 1; i < 9000; i++) { long t = VideoExportPlan.timeUs(i, 30), d = t - prev; if (d < 33333 || d > 33334) mono = false; prev = t; }
        check(mono, "Zeitstempel gleichmäßig");
        check(Math.abs(VideoExportPlan.estimateMB(18_000_000, 61) - 139.995) < 0.01 && VideoExportPlan.neededMB(140) == 780, "Größe/Bedarf");
        // Formate
        check("video/avc".equals(VideoExportPlan.mime("avc")) && "video/avc".equals(VideoExportPlan.mime(null)) && "video/hevc".equals(VideoExportPlan.mime("hevc")) && VideoExportPlan.mime("vp9") == null, "MIME");
        check(VideoExportPlan.fits(1080, 1920, 1920, 1088) && !VideoExportPlan.fits(3840, 2160, 1920, 1088) && VideoExportPlan.fits(3840, 2160, 4096, 2304), "Grenzen lang/kurz");
        // Prüfung der Eingaben
        check(VideoExportPlan.check(1920, 1080, 30, 18_000_000, "avc", 50_000, 1830) == null, "gültig");
        check(VideoExportPlan.check(1921, 1080, 30, 18_000_000, "avc", -1, 10).contains("Bildgröße"), "ungerade");
        check(VideoExportPlan.check(8192, 4320, 30, 18_000_000, "avc", -1, 10).contains("Bildgröße"), "zu groß");
        check(VideoExportPlan.check(1920, 1080, 120, 18_000_000, "avc", -1, 10).contains("Bildrate"), "Bildrate");
        check(VideoExportPlan.check(1920, 1080, 30, 1000, "avc", -1, 10).contains("Datenrate"), "Datenrate");
        check(VideoExportPlan.check(1920, 1080, 30, 18_000_000, "vp9", -1, 10).contains("Videoformat"), "Format");
        check(VideoExportPlan.check(1920, 1080, 30, 18_000_000, "avc", -1, 9001).contains("Zu viele Bilder"), "Bildzahl");
        String sp = VideoExportPlan.check(1920, 1080, 30, 18_000_000, "avc", 600, 1830);
        check(sp != null && sp.contains("780 MB nötig, 600 MB frei"), "Speicher: " + sp);
        // Dateinamen
        check("Flug_Zugspitze_2026-07-04.mp4".equals(VideoExportPlan.fileName("Flug_Zugspitze_2026-07-04.mp4")), "Name bleibt");
        check("Flug_a_b_.._c.mp4".equals(VideoExportPlan.fileName("Flug a/b/../c")) || VideoExportPlan.fileName("Flug a/b/../c").matches("[A-Za-z0-9._-]+\\.mp4"), "Name sicher: " + VideoExportPlan.fileName("Flug a/b/../c"));
        check(!VideoExportPlan.fileName("../../x.mp4").contains("..") && !VideoExportPlan.fileName("../../x.mp4").contains("/"), "kein Pfad: " + VideoExportPlan.fileName("../../x.mp4"));
        check("Flug.mp4".equals(VideoExportPlan.fileName("")) && "Flug.mp4".equals(VideoExportPlan.fileName(null)) && VideoExportPlan.fileName("x".repeat(300)).length() == 100, "leer / lang");
        check(VideoExportPlan.errorText("ENOSPC (No space left on device)").contains("Speicher") && VideoExportPlan.errorText("").equals("Unbekannter Fehler"), "Fehlertexte");
        // Farben: Weiß, Schwarz, Grau neutral (U = V = 128), Rot/Blau in die richtige Richtung; 2×2-Mittel
        int w = 4, h = 2;
        int[] px = {0xffffffff, 0xffffffff, 0xff000000, 0xff000000, 0xffffffff, 0xffffffff, 0xff000000, 0xff000000};
        byte[] y = new byte[w * h], u = new byte[w * h / 4], v = new byte[w * h / 4];
        VideoExportPlan.argbToYuv420(px, w, h, y, u, v);
        check((y[0] & 255) == 235 && (y[2] & 255) == 16, "Weiß 235, Schwarz 16: " + (y[0] & 255) + "/" + (y[2] & 255));
        check((u[0] & 255) == 128 && (v[0] & 255) == 128 && (u[1] & 255) == 128 && (v[1] & 255) == 128, "neutral: " + (u[0] & 255) + "/" + (v[0] & 255));
        int[] grau = new int[16]; java.util.Arrays.fill(grau, 0xff808080);
        byte[] gy = new byte[16], gu = new byte[4], gv = new byte[4];
        VideoExportPlan.argbToYuv420(grau, 4, 4, gy, gu, gv);
        check(Math.abs((gy[5] & 255) - 126) <= 1 && (gu[3] & 255) == 128 && (gv[3] & 255) == 128, "Grau: " + (gy[5] & 255));
        int[] rot = new int[4]; java.util.Arrays.fill(rot, 0xffff0000);
        byte[] ry = new byte[4], ru = new byte[1], rv = new byte[1];
        VideoExportPlan.argbToYuv420(rot, 2, 2, ry, ru, rv);
        check((rv[0] & 255) > 230 && (ru[0] & 255) < 110 && Math.abs((ry[0] & 255) - 63) <= 1, "Rot: Y " + (ry[0] & 255) + " U " + (ru[0] & 255) + " V " + (rv[0] & 255));
        int[] blau = new int[4]; java.util.Arrays.fill(blau, 0xff0000ff);
        VideoExportPlan.argbToYuv420(blau, 2, 2, ry, ru, rv);
        check((ru[0] & 255) > 230 && (rv[0] & 255) < 128, "Blau: U " + (ru[0] & 255));
        // Tempo der Umrechnung (4K): darf den Export nicht bremsen (Rechner, nur grob)
        int W = 3840, H = 2160; int[] big = new int[W * H]; for (int i = 0; i < big.length; i++) big[i] = 0xff000000 | (i * 2654435761L > 0 ? i : -i) & 0xffffff;
        byte[] by = new byte[W * H], bu = new byte[W * H / 4], bv = new byte[W * H / 4];
        VideoExportPlan.argbToYuv420(big, W, H, by, bu, bv);
        long t0 = System.nanoTime(); for (int k = 0; k < 3; k++) VideoExportPlan.argbToYuv420(big, W, H, by, bu, bv);
        long ms = (System.nanoTime() - t0) / 3_000_000;
        System.out.println("YUV-Umrechnung 4K: " + ms + " ms je Bild (Rechner)");
        check(ms < 2000, "Umrechnung 4K zu langsam: " + ms + " ms");
        System.out.println("VideoExportPlanCheck OK");
    }
}
