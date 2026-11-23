package de.tourentagebuch.app;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 2.18.0: Übertragung von Fotos und Videos zwischen dem Tagebuch und Meine Touren (3.57.0) – reines Java ohne Android, geprüft in tests/android/MtTransferCheck.java
 * gegen einen kleinen HTTP-Server.
 *
 * Senden: multipart/form-data, gestreamt aus der Datei (feste Länge, nie ganz im Speicher), mit Fortschritt und Abbrechen. Felder wie POST /api/tours/{id}/photo bzw. /video.
 * Holen: GET in eine Teildatei; ist sie schon angefangen, geht es mit „Range: bytes=n-“ weiter (206). Antwortet der Server mit 200, beginnt die Datei neu.
 * Grenzen wie am Server: Video höchstens {@link #VIDEO_MAX}, alle Videos einer Tour höchstens {@link #VIDEO_TOUR_MAX}, Foto höchstens {@link #FOTO_MAX}.
 * Das Sitzungs-Cookie wird nur als Kopfzeile gesendet und nirgends protokolliert.
 */
public final class MtTransfer {
    private MtTransfer() { }

    public static final long FOTO_MAX = 40L * 1024 * 1024;
    public static final long VIDEO_MAX = 200L * 1024 * 1024;
    public static final long VIDEO_TOUR_MAX = 1024L * 1024 * 1024;
    private static final Pattern REF = Pattern.compile("[A-Za-z0-9_.:-]{1,64}");
    private static final Pattern RANGE = Pattern.compile("bytes\\s+(\\d+)-(\\d+)/(\\d+|\\*)");
    private static final int BUF = 64 * 1024;

    /** Fortschritt (übertragene Bytes, gesamt oder -1) und Abbruch. */
    public interface Control {
        boolean cancelled();
        void progress(long done, long total);
    }

    public static final class CancelledException extends IOException {
        public CancelledException() { super("abgebrochen"); }
    }

    /** Antwort: HTTP-Status, Text der Antwort (gekürzt), übertragene Bytes, ob ein Download fortgesetzt wurde. */
    public static final class Result {
        public int status;
        public String body = "";
        public long bytes;
        public boolean resumed;
    }

    /** Kennung des Tagebuchs als „ref“: 1–64 Zeichen A–Z a–z 0–9 _ . : - (wie am Server). */
    public static boolean refOk(String ref) { return ref != null && REF.matcher(ref).matches(); }

    /** Dateiname für Formular und Teildateien: ohne Pfad, ohne Anführungszeichen und Steuerzeichen, höchstens 120 Zeichen. */
    public static String safeName(String n) {
        String s = n == null ? "" : n.replace('\\', '/');
        s = s.substring(s.lastIndexOf('/') + 1).replaceAll("[\\p{Cntrl}\"\r\n]", "_").trim();
        if (s.length() > 120) s = s.substring(0, 120);
        return s.isEmpty() ? "datei" : s;
    }

    /** null = Video darf gesendet werden; sonst die Meldung (wie die 413-Meldungen des Servers). used = schon belegte Bytes der Tour. */
    public static String videoCheck(long size, long used) {
        if (size <= 0) return "Die Videodatei fehlt oder ist leer.";
        if (size > VIDEO_MAX) return "Das Video ist zu groß: höchstens " + (VIDEO_MAX >> 20) + " MB je Video";
        if (used + size > VIDEO_TOUR_MAX) return "Für diese Tour ist kein Platz mehr für Videos: höchstens " + (VIDEO_TOUR_MAX >> 20) + " MB je Tour";
        return null;
    }

    /** Range-Kopf zum Fortsetzen ab Byte have; null, wenn von vorn. */
    public static String rangeHeader(long have) { return have > 0 ? "bytes=" + have + "-" : null; }

    /** „bytes 100-199/1000“ → {100, 199, 1000} (total -1 bei „*“); null, wenn unlesbar. */
    public static long[] contentRange(String h) {
        if (h == null) return null;
        Matcher m = RANGE.matcher(h.trim());
        if (!m.matches()) return null;
        return new long[]{Long.parseLong(m.group(1)), Long.parseLong(m.group(2)), "*".equals(m.group(3)) ? -1 : Long.parseLong(m.group(3))};
    }

    public static String boundary() {
        byte[] b = new byte[12];
        new SecureRandom().nextBytes(b);
        StringBuilder s = new StringBuilder("----Tourentagebuch");
        for (byte x : b) s.append(String.format("%02x", x));
        return s.toString();
    }

    private static byte[] fieldPart(String boundary, String name, String value) {
        return ("--" + boundary + "\r\nContent-Disposition: form-data; name=\"" + safeName(name) + "\"\r\n\r\n" + (value == null ? "" : value) + "\r\n").getBytes(StandardCharsets.UTF_8);
    }

    private static byte[] fileHead(String boundary, String field, String fileName, String mime) {
        return ("--" + boundary + "\r\nContent-Disposition: form-data; name=\"" + safeName(field) + "\"; filename=\"" + safeName(fileName) + "\"\r\nContent-Type: "
                + (mime == null ? "application/octet-stream" : mime) + "\r\n\r\n").getBytes(StandardCharsets.UTF_8);
    }

    private static byte[] tail(String boundary) { return ("\r\n--" + boundary + "--\r\n").getBytes(StandardCharsets.UTF_8); }

    /** Genaue Länge des Formulars (für setFixedLengthStreamingMode). */
    public static long multipartLength(String boundary, Map<String, String> fields, String fileField, String fileName, String mime, long fileLen) {
        long n = 0;
        for (Map.Entry<String, String> e : fields.entrySet()) n += fieldPart(boundary, e.getKey(), e.getValue()).length;
        return n + fileHead(boundary, fileField, fileName, mime).length + fileLen + tail(boundary).length;
    }

    /** Formular schreiben: erst die Felder, dann die Datei (gestreamt), dann der Abschluss. */
    public static void writeMultipart(OutputStream out, String boundary, Map<String, String> fields, String fileField, String fileName, String mime,
                                      InputStream in, long len, Control c) throws IOException {
        for (Map.Entry<String, String> e : fields.entrySet()) out.write(fieldPart(boundary, e.getKey(), e.getValue()));
        out.write(fileHead(boundary, fileField, fileName, mime));
        byte[] b = new byte[BUF];
        long done = 0;
        int r;
        while (done < len && (r = in.read(b, 0, (int) Math.min(b.length, len - done))) > 0) {
            if (c != null && c.cancelled()) throw new CancelledException();
            out.write(b, 0, r);
            done += r;
            if (c != null) c.progress(done, len);
        }
        if (done != len) throw new IOException("Datei kürzer als erwartet");
        out.write(tail(boundary));
    }

    private static String readBody(HttpURLConnection h, int max) {
        try (InputStream in = h.getResponseCode() >= 400 ? h.getErrorStream() : h.getInputStream()) {
            if (in == null) return "";
            byte[] b = new byte[8192];
            java.io.ByteArrayOutputStream o = new java.io.ByteArrayOutputStream();
            int r;
            while (o.size() < max && (r = in.read(b)) > 0) o.write(b, 0, Math.min(r, max - o.size()));
            return new String(o.toByteArray(), StandardCharsets.UTF_8);
        } catch (IOException e) {
            return "";
        }
    }

    private static HttpURLConnection open(String url, String cookie, int timeoutMs) throws IOException {
        HttpURLConnection h = (HttpURLConnection) new URL(url).openConnection();
        h.setConnectTimeout(20000);
        h.setReadTimeout(timeoutMs > 0 ? timeoutMs : 120000);
        h.setInstanceFollowRedirects(false);      // eine Umleitung würde das Formular verlieren; der Aufrufer meldet den Status
        h.setRequestProperty("Accept", "application/json");
        if (cookie != null && !cookie.isEmpty()) h.setRequestProperty("Cookie", cookie);
        return h;
    }

    /** Datei als multipart/form-data senden (Feld „file“). Gibt Status und Antworttext zurück; wirft bei Netzfehler oder Abbruch. */
    public static Result upload(String url, String cookie, Map<String, String> fields, File file, String fileName, String mime, Control c, int timeoutMs) throws IOException {
        if (fields == null) fields = new LinkedHashMap<>();
        long len = file.length();
        String bd = boundary();
        HttpURLConnection h = open(url, cookie, timeoutMs);
        try {
            h.setRequestMethod("POST");
            h.setDoOutput(true);
            h.setRequestProperty("Content-Type", "multipart/form-data; boundary=" + bd);
            h.setFixedLengthStreamingMode(multipartLength(bd, fields, "file", fileName, mime, len));      // gestreamt, ohne Puffer der ganzen Datei
            try (OutputStream out = h.getOutputStream(); InputStream in = new FileInputStream(file)) {
                writeMultipart(out, bd, fields, "file", fileName, mime, in, len, c);
            }
            Result r = new Result();
            r.status = h.getResponseCode();
            r.body = readBody(h, 64 * 1024);
            r.bytes = len;
            return r;
        } finally {
            h.disconnect();
        }
    }

    /**
     * In die Teildatei part laden (fortsetzen, wenn schon angefangen). maxBytes: größere Antworten werden abgebrochen (413-artig, Status 413 im Ergebnis).
     * Ergebnis: status 200/206 = fertig; sonst der Status des Servers (die Teildatei bleibt bei Netzfehler oder Abbruch erhalten).
     */
    public static Result download(String url, String cookie, File part, long maxBytes, Control c, int timeoutMs) throws IOException {
        Result r = new Result();
        long have = part.isFile() ? part.length() : 0;
        HttpURLConnection h = open(url, cookie, timeoutMs);
        try {
            String rg = rangeHeader(have);
            if (rg != null) h.setRequestProperty("Range", rg);
            int st = h.getResponseCode();
            r.status = st;
            if (st == 416 && have > 0) {      // schon vollständig oder Datei am Server anders: von vorn
                h.disconnect();
                if (!part.delete()) throw new IOException("Teildatei lässt sich nicht löschen");
                return download(url, cookie, part, maxBytes, c, timeoutMs);
            }
            if (st != 200 && st != 206) { r.body = readBody(h, 8192); return r; }
            long start = 0, total;
            if (st == 206) {
                long[] cr = contentRange(h.getHeaderField("Content-Range"));
                if (cr == null || cr[0] != have) { h.disconnect(); if (!part.delete()) throw new IOException("Teildatei lässt sich nicht löschen"); return download(url, cookie, part, maxBytes, c, timeoutMs); }
                start = have;
                total = cr[2];
                r.resumed = true;
            } else {
                long cl = h.getContentLengthLong();
                total = cl;
            }
            if (total > maxBytes) { r.status = 413; r.body = "zu groß"; return r; }
            try (InputStream in = h.getInputStream(); OutputStream out = new FileOutputStream(part, st == 206)) {
                byte[] b = new byte[BUF];
                long done = start;
                int n;
                while ((n = in.read(b)) > 0) {
                    if (c != null && c.cancelled()) throw new CancelledException();
                    done += n;
                    if (done > maxBytes) { r.status = 413; r.body = "zu groß"; break; }
                    out.write(b, 0, n);
                    if (c != null) c.progress(done, total);
                }
                r.bytes = done;
            }
            if (r.status == 413) { part.delete(); return r; }
            if (total > 0 && part.length() != total) throw new IOException("Verbindung unterbrochen (" + part.length() + " von " + total + " Bytes)");
            return r;
        } finally {
            h.disconnect();
        }
    }
}
