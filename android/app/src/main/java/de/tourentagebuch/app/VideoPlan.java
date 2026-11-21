package de.tourentagebuch.app;

import java.util.Locale;

/**
 * 2.7.1: reine Entscheidungen für die Video-Umwandlung HEVC → H.264 (ohne Android, darum auch auf dem Rechner prüfbar:
 * tests/android/VideoPlanCheck.java). Grundsatz: nie größer und nie mit mehr Datenrate als das Original.
 */
public final class VideoPlan {
    private VideoPlan() { }

    /** Muss das Video umgewandelt werden? Nur bei HEVC (H.265); H.264 und alles andere bleibt, wie es ist. */
    public static boolean needsConvert(String mime) {
        if (mime == null) return false;
        String m = mime.trim().toLowerCase(Locale.ROOT);
        return m.equals("video/hevc") || m.equals("video/x-hevc") || m.equals("video/h265");
    }

    /**
     * Zielgröße (Breite, Höhe) wie im Original gespeichert (ohne Drehung). Passt das Original in die Grenzen des Encoders
     * (längste/kürzeste Seite), bleibt es genau so; sonst wird es mit gleichem Seitenverhältnis verkleinert. Nie vergrößert.
     * Ergebnis immer gerade Zahlen (die Encoder verlangen das), mindestens 2.
     */
    public static int[] size(int w, int h, int maxLong, int maxShort) {
        if (w <= 0 || h <= 0) return new int[]{0, 0};
        int lo = Math.max(w, h), sh = Math.min(w, h);
        double s = 1.0;
        if (maxLong > 0 && lo > maxLong) s = Math.min(s, (double) maxLong / lo);
        if (maxShort > 0 && sh > maxShort) s = Math.min(s, (double) maxShort / sh);
        int ow = even(s >= 1.0 ? w : (int) Math.floor(w * s)), oh = even(s >= 1.0 ? h : (int) Math.floor(h * s));
        return new int[]{Math.min(ow, even(w)), Math.min(oh, even(h))};
    }

    private static int even(int v) { v = v - (v % 2); return Math.max(2, v); }

    /**
     * Datenrate (bit/s) für das H.264-Video. srcBps: Datenrate des Originals (0 = unbekannt), auf die Zielgröße umgerechnet;
     * unbekannt: Schätzung aus Pixelzahl und Bildrate. Nie mehr als das Original, höchstens maxBps (Encodergrenze, 0 = ohne).
     */
    public static int bitrate(long srcBps, int w, int h, int ow, int oh, int fps, int maxBps) {
        int f = fps > 0 && fps <= 240 ? fps : 30;
        double px = (double) Math.max(1, ow) * Math.max(1, oh);
        long est = (long) (px * f * 0.12);                 // grob: 1080p mit 30 Bildern ≈ 7,5 Mbit/s
        long b;
        if (srcBps > 0) {
            double ratio = px / ((double) Math.max(1, w) * Math.max(1, h));
            b = (long) (srcBps * Math.min(1.0, ratio));
            b = Math.min(b, srcBps);
        } else b = est;
        if (maxBps > 0) b = Math.min(b, maxBps);
        b = Math.max(b, 200_000L);
        if (srcBps > 0) b = Math.min(b, srcBps);           // auch die Untergrenze hebt nicht über das Original
        return (int) Math.min(b, Integer.MAX_VALUE);
    }

    /** Fortschritt in Prozent (0…100) aus der aktuellen Bildzeit und der Gesamtdauer (beide µs). */
    public static int percent(long tUs, long durUs) {
        if (durUs <= 0 || tUs <= 0) return 0;
        long p = tUs * 100 / durUs;
        return (int) Math.max(0, Math.min(100, p));
    }
}
