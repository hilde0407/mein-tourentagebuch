package de.tourentagebuch.app;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.io.OutputStreamWriter;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Pattern;
import java.util.zip.CRC32;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import java.util.zip.ZipOutputStream;

/**
 * 2.10.0: Medien-Sicherung ohne Android (reines Java, geprüft in tests/android/MediaZipCheck.java).
 *
 * Format: normale ZIP-Dateien ohne Kompression (STORED; Fotos und Videos sind schon komprimiert) mit
 * „manifest.json“ (Version, Zeit, Teil, Liste der Dateien) und den Einträgen „photos/&lt;name&gt;“ und „thumbs/&lt;name&gt;“.
 * Größere Sicherungen werden in Teile zu höchstens {@link #PART_LIMIT} geteilt (Medien_&lt;Datum&gt;_Teil1.zip …):
 * jede Teildatei ist für sich ein vollständiges ZIP, bleibt unter 4 GB (FAT32-Speicherkarten, alte Entpacker)
 * und kann allein wiederhergestellt werden. Nur eine einzelne Datei über dem Limit landet allein in einem Teil
 * (über 4 GB schreibt java.util.zip dann von selbst ZIP64).
 *
 * Geschrieben wird streamend: jede Datei wird zweimal gelesen (erst die Prüfsumme CRC-32, dann der Inhalt), nie ganz in den Speicher.
 * Inkrementell: pro gesicherter Datei ein Schlüssel „name\tgröße\tänderungszeit“ in einer kleinen Textdatei.
 */
public final class MediaZip {
    private MediaZip() { }

    /** Größte Teildatei (Summe der Einträge): 1,5 GiB. */
    public static final long PART_LIMIT = 1536L * 1024 * 1024;
    /** Höchstens so viele Einträge je Teil (ZIP ohne ZIP64 erlaubt 65 535). */
    public static final int MAX_ENTRIES = 20000;
    /** Geschätzter Verwaltungsaufwand je Eintrag (lokaler Kopf + Verzeichniseintrag + Name). */
    static final int ENTRY_OVERHEAD = 200;
    public static final String MANIFEST = "manifest.json";
    public static final String[] DIRS = {"photos", "thumbs"};
    private static final Pattern NAME = Pattern.compile("[A-Za-z0-9._-]{1,120}");
    private static final int BUF = 256 * 1024;

    /** Eine Mediendatei: Eintragsname („photos/abc.jpg“), Größe, Änderungszeit und (beim Sichern) die Datei. */
    public static final class Item {
        public final String name;
        public final long size, mtime;
        public final File file;
        public Item(String name, long size, long mtime, File file) { this.name = name; this.size = size; this.mtime = mtime; this.file = file; }
        /** Schlüssel für „schon gesichert“: Kennung + Größe + Änderungszeit. */
        public String key() { return name + "\t" + size + "\t" + mtime; }
    }

    /** Fortschritt und Abbruch. progress bekommt die seit dem letzten Aufruf verarbeiteten Bytes. */
    public interface Control {
        boolean cancelled();
        void progress(long bytes);
    }

    public static final class CancelledException extends IOException {
        public CancelledException() { super("abgebrochen"); }
    }

    /** Ergebnis einer Wiederherstellung. */
    public static final class ReadResult {
        public int restored, existing, rejected;
        public long bytes;
        public boolean manifest;
        public final List<String> names = new ArrayList<>();
    }

    /* ---------- Namen ---------- */

    /** Sicherer Dateiname: nur [A-Za-z0-9._-], kein führender Punkt, kein „..“. */
    public static boolean safeName(String n) {
        return n != null && NAME.matcher(n).matches() && !n.startsWith(".") && !n.contains("..");
    }

    /** Erlaubter Eintrag in einer Medien-Sicherung (Schutz vor „Zip Slip“): genau „photos/name“ oder „thumbs/name“. */
    public static boolean safeEntry(String e) {
        if (e == null) return false;
        for (String d : DIRS) if (e.startsWith(d + "/")) return safeName(e.substring(d.length() + 1));
        return false;
    }

    /** Name einer Teildatei: „Medien_2026-11-22.zip“ oder bei mehreren Teilen „Medien_2026-11-22_Teil2.zip“ (i ab 1). */
    public static String partName(String date, int i, int n) {
        return n <= 1 ? "Medien_" + date + ".zip" : "Medien_" + date + "_Teil" + i + ".zip";
    }

    /* ---------- Auswahl ---------- */

    private static String stem(String name) {
        String b = name.substring(name.indexOf('/') + 1);
        int p = b.lastIndexOf('.');
        return p > 0 ? b.substring(0, p) : b;
    }

    /** Alle sicherbaren Dateien aus photos/ und thumbs/ (unsichere Namen und Unterordner bleiben weg).
     *  Sortiert nach Kennung, Foto vor Vorschaubild – so liegen beide in derselben Teildatei. */
    public static List<Item> scan(File photos, File thumbs) {
        List<Item> out = new ArrayList<>();
        File[] dirs = {photos, thumbs};
        for (int k = 0; k < dirs.length; k++) {
            File[] fs = dirs[k] == null ? null : dirs[k].listFiles();
            if (fs == null) continue;
            for (File f : fs) if (f.isFile() && safeName(f.getName())) out.add(new Item(DIRS[k] + "/" + f.getName(), f.length(), f.lastModified(), f));
        }
        Collections.sort(out, (a, b) -> {
            int c = stem(a.name).compareTo(stem(b.name));
            return c != 0 ? c : a.name.compareTo(b.name);
        });
        return out;
    }

    /** Was noch nicht (oder nicht in dieser Größe/Änderungszeit) gesichert ist. */
    public static List<Item> pending(List<Item> all, Set<String> done) {
        List<Item> out = new ArrayList<>();
        for (Item it : all) if (done == null || !done.contains(it.key())) out.add(it);
        return out;
    }

    public static long bytes(List<Item> l) {
        long s = 0;
        for (Item it : l) s += it.size;
        return s;
    }

    /** In Teile teilen: der Reihe nach füllen, bis Limit (Bytes inkl. Verwaltung) oder Eintragszahl erreicht wäre.
     *  Eine einzelne zu große Datei bekommt einen eigenen Teil. Leere Liste → keine Teile. */
    public static List<List<Item>> split(List<Item> items, long limit, int maxEntries) {
        List<List<Item>> parts = new ArrayList<>();
        List<Item> cur = new ArrayList<>();
        long sum = 0;
        for (Item it : items) {
            long cost = it.size + ENTRY_OVERHEAD;
            if (!cur.isEmpty() && (sum + cost > limit || cur.size() >= maxEntries)) { parts.add(cur); cur = new ArrayList<>(); sum = 0; }
            cur.add(it);
            sum += cost;
        }
        if (!cur.isEmpty()) parts.add(cur);
        return parts;
    }

    /** Automatische Sicherungen (.mtl) im Ordner: welche Namen gelöscht werden, damit nur die neuesten keep bleiben.
     *  Berücksichtigt nur Namen mit prefix und suffix (das Datum im Namen sortiert sie); fremde Dateien bleiben immer. */
    public static List<String> toDelete(List<String> names, String prefix, String suffix, int keep) {
        List<String> own = new ArrayList<>();
        for (String n : names) if (n != null && n.startsWith(prefix) && n.endsWith(suffix)) own.add(n);
        Collections.sort(own, Collections.reverseOrder());
        return own.size() <= keep ? new ArrayList<>() : new ArrayList<>(own.subList(Math.max(0, keep), own.size()));
    }

    /* ---------- Schreiben ---------- */

    private static String q(String s) {
        StringBuilder b = new StringBuilder("\"");
        for (char c : s.toCharArray()) {
            if (c == '"' || c == '\\') b.append('\\').append(c);
            else if (c < 0x20) b.append(String.format("\\u%04x", (int) c));
            else b.append(c);
        }
        return b.append('"').toString();
    }

    /** Kleine Inhaltsangabe eines Teils (JSON). */
    public static String manifest(List<Item> part, int i, int n, long now, String appVersion) {
        StringBuilder b = new StringBuilder();
        b.append("{\"app\":\"tourentagebuch\",\"art\":\"medien\",\"v\":1,\"version\":").append(q(appVersion == null ? "" : appVersion))
                .append(",\"date\":").append(now).append(",\"teil\":").append(i).append(",\"teile\":").append(n)
                .append(",\"anzahl\":").append(part.size()).append(",\"bytes\":").append(bytes(part)).append(",\"dateien\":[");
        for (int k = 0; k < part.size(); k++) {
            Item it = part.get(k);
            if (k > 0) b.append(',');
            b.append("{\"name\":").append(q(it.name)).append(",\"size\":").append(it.size).append(",\"mtime\":").append(it.mtime).append('}');
        }
        return b.append("]}").toString();
    }

    private static void check(Control c) throws CancelledException { if (c != null && c.cancelled()) throw new CancelledException(); }

    /** Einen Teil als ZIP (STORED) in out schreiben; out wird nicht geschlossen. Jede Datei: erst CRC-32 lesen, dann kopieren.
     *  Fortschritt zählt beide Durchgänge (insgesamt 2 × Bytes). Ändert sich eine Datei dazwischen, bricht der Teil mit Fehler ab. */
    public static void write(OutputStream out, List<Item> part, String manifest, Control c) throws IOException {
        ZipOutputStream z = new ZipOutputStream(new BufferedOutputStream(out, BUF));
        z.setMethod(ZipOutputStream.STORED);
        byte[] mb = manifest.getBytes(StandardCharsets.UTF_8);
        putStored(z, MANIFEST, mb.length, crc(mb), System.currentTimeMillis());
        z.write(mb);
        z.closeEntry();
        byte[] b = new byte[BUF];
        for (Item it : part) {
            check(c);
            CRC32 crc = new CRC32();
            long len = 0;
            try (InputStream in = new FileInputStream(it.file)) {
                int n;
                while ((n = in.read(b)) > 0) { crc.update(b, 0, n); len += n; if (c != null) { c.progress(n); check(c); } }
            }
            putStored(z, it.name, len, crc.getValue(), it.mtime);
            long copied = 0;
            try (InputStream in = new FileInputStream(it.file)) {
                int n;
                while (copied < len && (n = in.read(b, 0, (int) Math.min(b.length, len - copied))) > 0) {
                    z.write(b, 0, n);
                    copied += n;
                    if (c != null) { c.progress(n); check(c); }
                }
            }
            if (copied != len) throw new IOException("Datei hat sich beim Sichern geändert: " + it.name);
            z.closeEntry();
        }
        z.finish();
        z.flush();
    }

    private static long crc(byte[] b) { CRC32 c = new CRC32(); c.update(b); return c.getValue(); }

    private static void putStored(ZipOutputStream z, String name, long len, long crc, long time) throws IOException {
        ZipEntry e = new ZipEntry(name);
        e.setMethod(ZipEntry.STORED);
        e.setSize(len);
        e.setCompressedSize(len);
        e.setCrc(crc);
        if (time > 0) e.setTime(time);
        z.putNextEntry(e);
    }

    /* ---------- Lesen ---------- */

    /** Zählt gelesene Bytes (Fortschritt beim Wiederherstellen: Anteil der ZIP-Datei) und prüft den Abbruch. */
    public static final class CountingInputStream extends FilterInputStream {
        private final Control c;
        public CountingInputStream(InputStream in, Control c) { super(in); this.c = c; }
        @Override public int read() throws IOException { check(c); int r = super.read(); if (r >= 0 && c != null) c.progress(1); return r; }
        @Override public int read(byte[] b, int off, int len) throws IOException { check(c); int r = super.read(b, off, len); if (r > 0 && c != null) c.progress(r); return r; }
        @Override public long skip(long n) throws IOException { check(c); long r = super.skip(n); if (r > 0 && c != null) c.progress(r); return r; }
    }

    /** Medien aus einem ZIP zurückspielen. Nur „photos/“ und „thumbs/“ mit sicheren Namen; vorhandene Dateien bleiben unverändert.
     *  Jede Datei entsteht erst in tmpDir und wird nach vollständigem Lesen (Prüfsumme geprüft von ZipInputStream) umbenannt.
     *  Bei Abbruch bleibt die halbe Datei nicht liegen. */
    public static ReadResult read(InputStream in, File photos, File thumbs, File tmpDir, Control c) throws IOException {
        ReadResult r = new ReadResult();
        tmpDir.mkdirs();
        ZipInputStream z = new ZipInputStream(new BufferedInputStream(in, BUF));
        byte[] b = new byte[BUF];
        ZipEntry e;
        while ((e = z.getNextEntry()) != null) {
            check(c);
            String n = e.getName();
            if (MANIFEST.equals(n)) { r.manifest = true; continue; }
            if (e.isDirectory()) continue;
            if (!safeEntry(n)) { r.rejected++; continue; }
            File dir = n.startsWith("photos/") ? photos : thumbs;
            File dst = new File(dir, n.substring(n.indexOf('/') + 1));
            if (dst.exists()) { r.existing++; continue; }
            dir.mkdirs();
            File tmp = new File(tmpDir, "r" + System.nanoTime() + ".tmp");
            long len = 0;
            boolean ok = false;
            try {
                try (OutputStream o = new FileOutputStream(tmp)) {
                    int k;
                    while ((k = z.read(b)) > 0) { o.write(b, 0, k); len += k; check(c); }
                }
                if (e.getSize() >= 0 && e.getSize() != len) throw new IOException("Eintrag unvollständig: " + n);
                if (e.getTime() > 0) tmp.setLastModified(e.getTime());
                if (dst.exists()) { r.existing++; continue; }
                if (!tmp.renameTo(dst)) throw new IOException("Konnte " + n + " nicht ablegen");
                ok = true;
            } finally {
                if (!ok) tmp.delete();
            }
            r.restored++;
            r.bytes += len;
            r.names.add(n);
        }
        return r;
    }

    /* ---------- Merkliste „schon gesichert“ ---------- */

    public static Set<String> loadState(File f) {
        Set<String> s = new HashSet<>();
        if (f == null || !f.isFile()) return s;
        try (BufferedReader r = new BufferedReader(new InputStreamReader(new FileInputStream(f), StandardCharsets.UTF_8))) {
            String l;
            while ((l = r.readLine()) != null) if (!l.isEmpty()) s.add(l);
        } catch (IOException e) { /* leer: dann wird eben alles neu gesichert */ }
        return s;
    }

    /** Atomar speichern (erst Zwischendatei, dann umbenennen). Nur Schlüssel von Dateien, die es noch gibt (alle anderen fallen weg). */
    public static void saveState(File f, Set<String> keys, List<Item> existing) throws IOException {
        Set<String> live = new HashSet<>();
        if (existing != null) for (Item it : existing) live.add(it.key());
        File tmp = new File(f.getPath() + ".tmp");
        try (BufferedWriter w = new BufferedWriter(new OutputStreamWriter(new FileOutputStream(tmp), StandardCharsets.UTF_8))) {
            List<String> l = new ArrayList<>(keys);
            Collections.sort(l);
            for (String k : l) if (existing == null || live.contains(k)) { w.write(k); w.write('\n'); }
        }
        if (!tmp.renameTo(f)) { f.delete(); if (!tmp.renameTo(f)) throw new IOException("Merkliste nicht gespeichert"); }
    }
}
