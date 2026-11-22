package de.tourentagebuch.app;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.RandomAccessFile;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

/**
 * 2.12.0: Wiederherstellung einer unterbrochenen Aufzeichnung – reine Logik ohne Android (am Rechner geprüft:
 * tests/android/RecoveryPlanCheck.java; gleiche Regeln im Browser: js/calc-aufnahme.js).
 *
 * Zwei Dateien in filesDir:
 *  - rec_current.csv (TrackStore): jeder angenommene Punkt als eine Zeile „t,lat,lon,alt,seg“, sofort angehängt.
 *  - rec_meta.txt (hier): Start, Sportart, Name, Zustand, Route, Pausen, Lücken, Fotos/Videos – als Zeilen „schlüssel=wert“,
 *    immer ganz neu geschrieben über eine Zwischendatei und Umbenennen (atomar: entweder die alte oder die neue Fassung).
 * Ein abgerissenes Dateiende (Absturz mitten im Schreiben, leerer Akku) wird beim Lesen übergangen und beim Fortsetzen abgeschnitten.
 */
public final class RecoveryPlan {
    private RecoveryPlan() { }

    /** Fortsetzen ist nur bis 12 Stunden nach dem letzten Lebenszeichen erlaubt (danach: als Tour speichern oder verwerfen). */
    public static final long RESUME_MAX_MS = 12L * 60 * 60 * 1000;
    /** Uhr des Handys darf etwas zurückgehen (Zeitabgleich), ohne dass Fortsetzen gesperrt wird. */
    public static final long CLOCK_SLACK_MS = 10L * 60 * 1000;
    /** So lange nach einer Startanfrage an den Dienst gilt eine Aufzeichnung noch nicht als unterbrochen (der Dienst startet gerade). */
    public static final long START_GRACE_MS = 15_000;

    /** Metadaten der laufenden Aufzeichnung. */
    public static final class Meta {
        public long start;
        public String sport = "", name = "", state = "", route = "";
        public final List<long[]> pauses = new ArrayList<>();   // {von, bis}; bis = 0: Pause läuft
        public final List<long[]> gaps = new ArrayList<>();     // {von, bis}: Lücke durch Unterbrechung (Absturz, Prozessende, Akku)
        public final List<String> media = new ArrayList<>();    // "ts,id" – Fotos/Videos, die während der Aufzeichnung übernommen wurden

        /** Spätester bekannter Zeitpunkt aus den Metadaten (Start, Pausen, Lücken). */
        public long lastMark() {
            long m = start;
            for (long[] p : pauses) m = Math.max(m, Math.max(p[0], p[1]));
            for (long[] g : gaps) m = Math.max(m, Math.max(g[0], g[1]));
            return m;
        }
    }

    /** Zusammenfassung der Punktdatei. */
    public static final class Summary {
        public int count, badLines;
        public long first, last;
        public double distM;
        public boolean torn;            // letzte Zeile ohne Zeilenende (abgerissen)
    }

    private static String esc(String s) {
        if (s == null) return "";
        return s.replace("\\", "\\\\").replace("\n", "\\n").replace("\r", "");
    }

    private static String unesc(String s) {
        StringBuilder b = new StringBuilder(s.length());
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c == '\\' && i + 1 < s.length()) {
                char d = s.charAt(++i);
                b.append(d == 'n' ? '\n' : d);
            } else b.append(c);
        }
        return b.toString();
    }

    public static String format(Meta m) {
        StringBuilder b = new StringBuilder();
        b.append("v=1\n");
        b.append("start=").append(m.start).append('\n');
        b.append("state=").append(esc(m.state)).append('\n');
        b.append("sport=").append(esc(m.sport)).append('\n');
        b.append("name=").append(esc(m.name)).append('\n');
        b.append("route=").append(esc(m.route)).append('\n');
        for (long[] p : m.pauses) b.append("pause=").append(p[0]).append(',').append(p[1]).append('\n');
        for (long[] g : m.gaps) b.append("gap=").append(g[0]).append(',').append(g[1]).append('\n');
        for (String x : m.media) b.append("media=").append(esc(x)).append('\n');
        b.append("end=1\n");
        return b.toString();
    }

    /** Liest die Metadaten; unbekannte oder kaputte Zeilen werden übergangen. Nie null. */
    public static Meta parse(String text) {
        Meta m = new Meta();
        if (text == null) return m;
        for (String line : text.split("\n")) {
            int eq = line.indexOf('=');
            if (eq <= 0) continue;
            String k = line.substring(0, eq).trim(), v = line.substring(eq + 1);
            try {
                switch (k) {
                    case "start": m.start = Long.parseLong(v.trim()); break;
                    case "state": m.state = unesc(v); break;
                    case "sport": m.sport = unesc(v); break;
                    case "name": m.name = unesc(v); break;
                    case "route": m.route = unesc(v); break;
                    case "pause": case "gap": {
                        String[] f = v.split(",");
                        if (f.length != 2) break;
                        long[] r = {Long.parseLong(f[0].trim()), Long.parseLong(f[1].trim())};
                        (k.equals("pause") ? m.pauses : m.gaps).add(r);
                        break;
                    }
                    case "media": if (v.length() > 0) m.media.add(unesc(v)); break;
                    default: break;
                }
            } catch (NumberFormatException e) {
                // kaputte Zeile: übergehen
            }
        }
        return m;
    }

    /** Text atomar schreiben: erst in „name.tmp“ (auf den Datenträger gezwungen), dann umbenennen. */
    public static void writeAtomic(File f, String text) throws IOException {
        File tmp = new File(f.getParentFile(), f.getName() + ".tmp");
        try (FileOutputStream o = new FileOutputStream(tmp)) {
            o.write(text.getBytes(StandardCharsets.UTF_8));
            o.flush();
            try { o.getFD().sync(); } catch (IOException e) { /* manche Dateisysteme können das nicht – Umbenennen bleibt atomar */ }
        }
        if (!tmp.renameTo(f)) {
            f.delete();
            if (!tmp.renameTo(f)) throw new IOException("Umbenennen fehlgeschlagen");
        }
    }

    public static String read(File f) {
        if (f == null || !f.isFile()) return null;
        try (FileInputStream in = new FileInputStream(f)) {
            byte[] b = new byte[(int) Math.min(f.length(), 4L * 1024 * 1024)];
            int n = 0, r;
            while (n < b.length && (r = in.read(b, n, b.length - n)) > 0) n += r;
            return new String(b, 0, n, StandardCharsets.UTF_8);
        } catch (IOException e) {
            return null;
        }
    }

    /** Metadaten lesen; fehlt die Datei: null. Gibt es eine liegengebliebene Zwischendatei (Absturz zwischen Schreiben und Umbenennen), gilt die fertige Fassung. */
    public static Meta load(File f) {
        String t = read(f);
        if (t == null) {
            File tmp = new File(f.getParentFile(), f.getName() + ".tmp");
            String tt = read(tmp);
            if (tt == null || !tt.contains("\nend=1")) return null;      // halb geschriebene Zwischendatei taugt nicht
            t = tt;
        }
        return parse(t);
    }

    /** Eine Zeile der Punktdatei; null, wenn sie kaputt ist. Ergebnis: {t, lat, lon, seg(0/1)}. */
    public static double[] parseLine(String line) {
        if (line == null) return null;
        String[] f = line.split(",", -1);
        if (f.length < 5) return null;
        try {
            long t = Long.parseLong(f[0]);
            double la = Double.parseDouble(f[1]), lo = Double.parseDouble(f[2]);
            if (f[3].length() > 0) Double.parseDouble(f[3]);
            if (t <= 0 || Double.isNaN(la) || Double.isNaN(lo) || Math.abs(la) > 90 || Math.abs(lo) > 180) return null;
            return new double[]{t, la, lo, "1".equals(f[4]) ? 1 : 0};
        } catch (NumberFormatException e) {
            return null;
        }
    }

    static double haversine(double la1, double lo1, double la2, double lo2) {
        double r = 6371000.0;
        double dLa = Math.toRadians(la2 - la1), dLo = Math.toRadians(lo2 - lo1);
        double a = Math.sin(dLa / 2) * Math.sin(dLa / 2)
                + Math.cos(Math.toRadians(la1)) * Math.cos(Math.toRadians(la2)) * Math.sin(dLo / 2) * Math.sin(dLo / 2);
        return 2 * r * Math.asin(Math.min(1.0, Math.sqrt(a)));
    }

    /** Punktdatei zusammenfassen (Anzahl, Strecke ohne Sprünge über Segmentgrenzen, erste/letzte Zeit). Kaputte Zeilen zählen nicht. */
    public static Summary scan(File csv) {
        Summary s = new Summary();
        if (csv == null || !csv.isFile()) return s;
        try (RandomAccessFile raf = new RandomAccessFile(csv, "r")) {
            long len = raf.length();
            if (len > 0) { raf.seek(len - 1); s.torn = raf.read() != '\n'; }
        } catch (IOException e) { /* weiter */ }
        try (BufferedReader r = new BufferedReader(new InputStreamReader(new FileInputStream(csv), StandardCharsets.UTF_8))) {
            String line;
            double[] prev = null;
            while ((line = r.readLine()) != null) {
                if (line.isEmpty()) continue;
                double[] p = parseLine(line);
                if (p == null) { s.badLines++; continue; }
                if (s.count == 0) s.first = (long) p[0];
                if (prev != null && p[3] == 0 && p[0] > prev[0]) s.distM += haversine(prev[1], prev[2], p[1], p[2]);
                s.last = Math.max(s.last, (long) p[0]);
                s.count++;
                prev = p;
            }
        } catch (IOException e) { /* was gelesen ist, gilt */ }
        return s;
    }

    /** Abgerissenes Ende (Zeile ohne Zeilenumbruch) abschneiden, damit der nächste angehängte Punkt nicht mit ihm verklebt. Gibt die entfernten Bytes zurück. */
    public static int repairTail(File csv) {
        if (csv == null || !csv.isFile()) return 0;
        try (RandomAccessFile raf = new RandomAccessFile(csv, "rw")) {
            long len = raf.length();
            if (len == 0) return 0;
            raf.seek(len - 1);
            if (raf.read() == '\n') return 0;
            long pos = len - 1;
            while (pos > 0) {
                raf.seek(pos - 1);
                if (raf.read() == '\n') break;
                pos--;
            }
            raf.setLength(pos);
            return (int) (len - pos);
        } catch (IOException e) {
            return 0;
        }
    }

    /** Darf eine unterbrochene Aufzeichnung fortgesetzt werden? lastMs = letztes Lebenszeichen (letzter Punkt oder Pause/Start). */
    public static boolean canResume(long lastMs, long nowMs) {
        if (lastMs <= 0) return false;
        long age = nowMs - lastMs;
        return age >= -CLOCK_SLACK_MS && age < RESUME_MAX_MS;
    }

    /**
     * Ist die Aufzeichnung unterbrochen? Nur „recording“ zählt (eine Pause schreibt ohnehin nichts und bleibt einfach Pause).
     * serviceAlive: der Aufnahmedienst hört in diesem Prozess gerade auf GPS. sinceStartMs: Zeit seit der letzten Startanfrage an
     * den Dienst in diesem Prozess (Long.MAX_VALUE = keine) – kurz nach dem Start ist der Dienst noch nicht da.
     */
    public static boolean interrupted(String state, boolean serviceAlive, long sinceStartMs) {
        return "recording".equals(state) && !serviceAlive && sinceStartMs > START_GRACE_MS;
    }

    /** Letztes Lebenszeichen aus Punkten und Metadaten. */
    public static long lastActivity(Meta m, long lastPointMs) {
        return Math.max(lastPointMs, m == null ? 0 : m.lastMark());
    }
}
