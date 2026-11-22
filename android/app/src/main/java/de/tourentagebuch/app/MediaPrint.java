package de.tourentagebuch.app;

import java.io.File;
import java.io.IOException;
import java.io.RandomAccessFile;

/**
 * 2.14.0: Abdruck einer Foto- oder Videodatei, um doppelte Dateien zu erkennen – ohne die ganze Datei zu lesen.
 * Gelesen werden höchstens 3 × 64 KB: Anfang, Mitte und Ende (kleine Dateien ganz). Daraus zwei 32-Bit-FNV-1a-Werte
 * (der zweite mischt die Position ein), am Ende durchmischt, plus die genaue Dateigröße: „p1:&lt;Größe&gt;:&lt;16 Hex-Zeichen&gt;“.
 * Gleicher Abdruck heißt: dieselbe Datei (Byte für Byte, mit sehr hoher Wahrscheinlichkeit). Dasselbe Motiv in anderer
 * Größe oder neu gespeichert ergibt einen anderen Abdruck.
 * Dieselbe Rechnung steht in js/calc-fotodoppelt.js (FotoDoppeltCalc.abdruck) und in der Empfangsseite (UploadServer.PAGE, fpr),
 * damit ein im Browser verkleinertes Foto den Abdruck seines Originals mitbringen kann. Geprüft in tests/android/MediaPrintCheck.java
 * und tests/test_calc.js mit demselben erwarteten Wert. Ohne Android-Bezug.
 */
public final class MediaPrint {
    private MediaPrint() { }

    public static final int CHUNK = 65536;

    /** Anfangsstellen der gelesenen Abschnitte (je höchstens CHUNK Bytes); bei kleinen Dateien nur 0 (ganze Datei). */
    public static long[] offsets(long size) {
        if (size <= 3L * CHUNK) return new long[] { 0 };
        return new long[] { 0, size / 2 - CHUNK / 2, size - CHUNK };
    }

    /** Länge eines Abschnitts ab off. */
    public static int length(long size, long off) {
        if (size <= 3L * CHUNK) return (int) size;
        return (int) Math.min(CHUNK, size - off);
    }

    /** Laufender Zustand der beiden FNV-Werte. */
    static final class State {
        int a = 0x811c9dc5, b = 0x050c5d1f;
        long k = 0;
        void update(byte[] buf, int off, int len) {
            for (int i = off; i < off + len; i++) {
                int c = buf[i] & 0xff;
                a = (a ^ c) * 16777619;
                b = (b ^ ((c + (int) (k & 0xff)) & 0xff)) * 16777619;
                k++;
            }
        }
        String result(long size) { return String.format(java.util.Locale.US, "p1:%d:%08x%08x", size, mix(a), mix(b)); }
    }

    /** Abschließendes Durchmischen (wie MurmurHash3 fmix32), damit auch die unteren Bits von allen Bytes abhängen. */
    static int mix(int h) {
        h ^= h >>> 16; h *= 0x85ebca6b; h ^= h >>> 13; h *= 0xc2b2ae35; h ^= h >>> 16;
        return h;
    }

    /** Abdruck aus Bytes im Speicher (für Tests und kleine Daten). */
    public static String of(byte[] data) {
        State s = new State();
        long size = data.length;
        for (long off : offsets(size)) s.update(data, (int) off, length(size, off));
        return s.result(size);
    }

    /** Abdruck einer Datei; liest höchstens 3 × 64 KB. */
    public static String of(File f) throws IOException {
        try (RandomAccessFile r = new RandomAccessFile(f, "r")) {
            long size = r.length();
            State s = new State();
            byte[] buf = new byte[CHUNK];
            for (long off : offsets(size)) {
                int len = length(size, off);
                r.seek(off);
                r.readFully(buf, 0, len);
                s.update(buf, 0, len);
            }
            return s.result(size);
        }
    }

    /** Sieht der Text wie ein Abdruck aus? (Wert aus dem Browser wird nur dann übernommen.) */
    public static boolean valid(String fp) {
        return fp != null && fp.matches("p1:\\d{1,15}:[0-9a-f]{16}");
    }
}
