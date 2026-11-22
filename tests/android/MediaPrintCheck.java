import de.tourentagebuch.app.MediaPrint;

import java.io.File;
import java.io.FileOutputStream;

/** 2.14.0: Abdruck für doppelte Fotos/Videos ohne Gerät prüfen. Dieselben erwarteten Werte stehen in tests/test_calc.js (JS-Fassung). */
public class MediaPrintCheck {
    static void check(boolean ok, String msg) {
        if (!ok) { System.err.println("FEHLER: " + msg); System.exit(1); }
    }

    /** Gleiche Testdaten wie in test_calc.js: einfacher Zufallsgenerator (LCG), oberes Byte. */
    static byte[] daten(int n) {
        byte[] b = new byte[n];
        int r = 12345;
        for (int i = 0; i < n; i++) { r = (r * 1103515245 + 12345) & 0x7fffffff; b[i] = (byte) ((r >>> 16) & 255); }
        return b;
    }

    public static void main(String[] a) throws Exception {
        // Erwartete Werte (identisch in tests/test_calc.js und damit in der Empfangsseite des WLAN-Imports)
        check(MediaPrint.of(daten(0)).equals("p1:0:ab3e7c0b0578ab1b"), "leer: " + MediaPrint.of(daten(0)));
        check(MediaPrint.of(daten(1000)).equals("p1:1000:eef021298246a447"), "1000 B: " + MediaPrint.of(daten(1000)));
        check(MediaPrint.of(daten(196608)).equals("p1:196608:e863b2d179bd6e61"), "3 × 64 KB (ganz gelesen): " + MediaPrint.of(daten(196608)));
        check(MediaPrint.of(daten(300001)).equals("p1:300001:9d71ed57e4f9f842"), "300001 B (drei Abschnitte): " + MediaPrint.of(daten(300001)));

        // Abschnitte: kleine Datei ganz, große Datei Anfang/Mitte/Ende mit je 64 KB
        check(MediaPrint.offsets(196608).length == 1 && MediaPrint.length(196608, 0) == 196608, "bis 192 KB ganz");
        long[] o = MediaPrint.offsets(300001);
        check(o.length == 3 && o[0] == 0 && o[1] == 150000 - 32768 && o[2] == 300001 - 65536, "Abschnitte 300001");
        long big = 4L * 1024 * 1024 * 1024 + 7;      // 4 GB: Video, das nicht in den Speicher passt
        long[] ob = MediaPrint.offsets(big);
        check(ob[2] + MediaPrint.length(big, ob[2]) == big && MediaPrint.length(big, ob[1]) == 65536, "4-GB-Datei: höchstens 3 × 64 KB");

        // Datei auf der Platte = Bytes im Speicher
        byte[] d = daten(300001);
        File f = File.createTempFile("mpcheck", ".bin");
        try (FileOutputStream w = new FileOutputStream(f)) { w.write(d); }
        check(MediaPrint.of(f).equals(MediaPrint.of(d)), "Datei = Speicher");
        File g = File.createTempFile("mpcheck", ".bin");
        try (FileOutputStream w = new FileOutputStream(g)) { w.write(daten(1000)); }
        check(MediaPrint.of(g).equals("p1:1000:eef021298246a447"), "kleine Datei");

        // Ein geändertes Byte am Anfang, in der Mitte oder am Ende → anderer Abdruck; ein Byte mehr → andere Größe
        String ref = MediaPrint.of(d);
        for (int pos : new int[] { 0, 150000, 300000 }) {
            byte[] e = d.clone(); e[pos] ^= 1;
            check(!MediaPrint.of(e).equals(ref), "Änderung bei " + pos + " erkannt");
        }
        byte[] l = java.util.Arrays.copyOf(d, d.length + 1);
        check(!MediaPrint.of(l).equals(ref), "andere Länge");
        // Ehrliche Grenze: eine Änderung zwischen den Abschnitten (hier bei 100000) sieht der Teilabdruck nicht
        byte[] e = d.clone(); e[100000] ^= 1;
        check(MediaPrint.of(e).equals(ref), "Lücke zwischen den Abschnitten wird nicht gelesen");
        // Vertauschte Bytes ändern den zweiten Wert (Position fließt ein)
        byte[] s = daten(1000), t = s.clone(); byte x = t[10]; t[10] = t[11]; t[11] = x;
        check(s[10] == s[11] || !MediaPrint.of(s).equals(MediaPrint.of(t)), "Vertauschung");

        check(MediaPrint.valid("p1:300001:9d71ed57e4f9f842") && !MediaPrint.valid("p1:1:xyz") && !MediaPrint.valid(null) && !MediaPrint.valid("p1:1:9d71ed57e4f9f842;rm"), "valid()");
        f.delete(); g.delete();
        System.out.println("MediaPrintCheck OK");
    }
}
