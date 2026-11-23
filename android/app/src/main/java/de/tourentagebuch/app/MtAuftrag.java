package de.tourentagebuch.app;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileNotFoundException;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.BitSet;
import java.util.List;

/**
 * 2.18.1: Regeln für den Abgleich-Auftrag mit Meine Touren, der in der Hülle läuft (MtAbgleich/MtAbgleichService) – reines Java ohne Android,
 * geprüft in tests/android/MtAuftragCheck.java.
 *
 * Wiederholen: Netzfehler (IOException außer „Datei fehlt“), 408, 425, 429 und 5xx werden bis zu {@link #WIEDERHOLUNGEN}-mal mit Wartezeit
 * ({@link #warte(int)}) wiederholt; danach zählt der Schritt als Fehler und der Auftrag geht weiter. 401 und 403 beenden den Auftrag ({@link #endgueltig(int)}).
 * Journal: eine Zeile je erledigtem Schritt „&lt;Nummer&gt;\t&lt;JSON&gt;\n“, angehängt und mit fsync auf die Platte gebracht. Eine halb geschriebene letzte Zeile
 * (Absturz mitten im Schreiben) wird beim Lesen verworfen; der Schritt läuft beim Fortsetzen dann noch einmal.
 */
public final class MtAuftrag {
    private MtAuftrag() { }

    public static final int WIEDERHOLUNGEN = 3;
    private static final long[] WARTE = {5000, 20000, 60000};

    /** Wartezeit vor Wiederholung Nr. versuch (1, 2, 3 …) in ms. */
    public static long warte(int versuch) { return WARTE[Math.max(0, Math.min(WARTE.length - 1, versuch - 1))]; }

    /** Lohnt ein neuer Versuch bei diesem HTTP-Status? 0 = keine Antwort (Netzfehler). */
    public static boolean wiederholbar(int status) { return status == 0 || status == 408 || status == 425 || status == 429 || (status >= 500 && status <= 599); }

    /** Beendet dieser Status den ganzen Auftrag? „relogin“ (401), „verboten“ (403), sonst null. */
    public static String endgueltig(int status) { return status == 401 ? "relogin" : status == 403 ? "verboten" : null; }

    /** Ist diese Ausnahme ein vorübergehender Netzfehler? Eine fehlende Datei oder ein Fehler der Daten ist es nicht. */
    public static boolean netzfehler(Throwable e) {
        return e instanceof IOException && !(e instanceof FileNotFoundException) && !(e instanceof MtTransfer.CancelledException);
    }

    /** Ein Versuch: gibt den HTTP-Status zurück (das Ergebnis selbst hält der Aufrufer fest) oder wirft. */
    public interface Aufgabe { int lauf() throws Exception; }

    /** Warten zwischen den Versuchen; false = abgebrochen. versuch: Nummer der folgenden Wiederholung (1 …). */
    public interface Warten { boolean warte(long ms, int versuch); }

    /** Ausgang eines Schritts nach allen Versuchen. */
    public static final class Ausgang {
        public int status;              // letzter HTTP-Status (0 = keine Antwort)
        public String fehler;           // Text bei einer Ausnahme im letzten Versuch, sonst null
        public int versuche;            // 1 … WIEDERHOLUNGEN + 1
        public boolean abgebrochen;
    }

    /** Aufgabe mit Wiederholungen ausführen. */
    public static Ausgang wiederholt(Aufgabe a, Warten w) {
        Ausgang o = new Ausgang();
        for (int v = 1; ; v++) {
            o.versuche = v;
            o.fehler = null;
            boolean nochmal;
            try {
                o.status = a.lauf();
                nochmal = wiederholbar(o.status);
            } catch (MtTransfer.CancelledException e) {
                o.abgebrochen = true;
                return o;
            } catch (Exception e) {
                o.status = 0;
                o.fehler = e.getMessage() == null ? e.toString() : e.getMessage();
                nochmal = netzfehler(e);
            }
            if (!nochmal || v > WIEDERHOLUNGEN) return o;
            if (!w.warte(warte(v), v)) { o.abgebrochen = true; return o; }
        }
    }

    /* ---------------- Journal und Dateien ---------------- */

    /** Zeile „nummer\tjson“ anhängen und mit fsync sichern. json darf keinen Zeilenumbruch enthalten. */
    public static void anhaengen(File f, int nummer, String json) throws IOException {
        if (json.indexOf('\n') >= 0 || json.indexOf('\r') >= 0) throw new IllegalArgumentException("Zeilenumbruch im Journal");
        boolean offen = false;      // endet die Datei mit einer halben Zeile (Absturz beim Schreiben)? Dann erst abschließen, damit sie allein steht
        if (f.length() > 0) try (java.io.RandomAccessFile r = new java.io.RandomAccessFile(f, "r")) { r.seek(f.length() - 1); offen = r.read() != '\n'; }
        try (FileOutputStream o = new FileOutputStream(f, true)) {
            if (offen) o.write('\n');
            o.write((nummer + "\t" + json + "\n").getBytes(StandardCharsets.UTF_8));
            o.flush();
            o.getFD().sync();
        }
    }

    /** Vollständige Zeilen des Journals (ohne die halb geschriebene letzte und ohne unlesbare). Leere Liste, wenn es die Datei nicht gibt. */
    public static List<String> lesen(File f) throws IOException {
        List<String> out = new ArrayList<>();
        String s = text(f);
        if (s == null) return out;
        int start = 0;
        for (int i = 0; i < s.length(); i++) {
            if (s.charAt(i) != '\n') continue;
            String z = s.substring(start, i);
            start = i + 1;
            if (nummer(z) >= 0) out.add(z);
        }
        return out;
    }

    /** Nummer einer Journalzeile, -1 wenn unlesbar (auch, wenn der JSON-Teil nicht vollständig von { bis } reicht). */
    public static int nummer(String zeile) {
        int t = zeile == null ? -1 : zeile.indexOf('\t');
        if (t <= 0 || t > 9 || zeile.length() < t + 3 || zeile.charAt(t + 1) != '{' || zeile.charAt(zeile.length() - 1) != '}') return -1;
        try { return Integer.parseInt(zeile.substring(0, t)); } catch (NumberFormatException e) { return -1; }
    }

    /** JSON-Teil einer Journalzeile. */
    public static String json(String zeile) { return zeile.substring(zeile.indexOf('\t') + 1); }

    /** Erledigte Schritte laut Journal. */
    public static BitSet erledigt(List<String> zeilen) {
        BitSet b = new BitSet();
        for (String z : zeilen) { int n = nummer(z); if (n >= 0) b.set(n); }
        return b;
    }

    /** Nächster offener Schritt ab 0, oder -1 wenn alle n erledigt sind. */
    public static int naechster(int n, BitSet erledigt) { int i = erledigt.nextClearBit(0); return i < n ? i : -1; }

    /** Datei ersetzen, ohne dass beim Absturz eine halbe Datei bleibt: erst eine Kopie schreiben und sichern, dann umbenennen. */
    public static void schreibeSicher(File f, String inhalt) throws IOException {
        File tmp = new File(f.getPath() + ".neu");
        try (FileOutputStream o = new FileOutputStream(tmp)) {
            o.write(inhalt.getBytes(StandardCharsets.UTF_8));
            o.flush();
            o.getFD().sync();
        }
        if (!tmp.renameTo(f)) { f.delete(); if (!tmp.renameTo(f)) throw new IOException("Datei lässt sich nicht ersetzen: " + f.getName()); }
    }

    /** Inhalt einer Datei als Text, null wenn es sie nicht gibt. */
    public static String text(File f) throws IOException {
        if (!f.isFile()) return null;
        try (InputStream in = new FileInputStream(f)) {
            ByteArrayOutputStream o = new ByteArrayOutputStream();
            byte[] b = new byte[16384];
            int r;
            while ((r = in.read(b)) > 0) o.write(b, 0, r);
            return new String(o.toByteArray(), StandardCharsets.UTF_8);
        }
    }

    /** Kurzer Text für die Benachrichtigung: „12 von 40 · Gipfeltour · Foto holen“. */
    public static String zeile(int i, int n, String tour, String art) {
        String was = "foto-holen".equals(art) ? "Foto holen" : "foto-senden".equals(art) ? "Foto senden" : "video-holen".equals(art) ? "Video holen"
                : "video-senden".equals(art) ? "Video senden" : "notiz".equals(art) ? "Notiz" : "stand".equals(art) ? "Stand" : "";
        return (i + 1) + " von " + n + (tour == null || tour.isEmpty() ? "" : " · " + tour) + (was.isEmpty() ? "" : " · " + was);
    }
}
