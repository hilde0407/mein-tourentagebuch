import com.sun.net.httpserver.HttpServer;
import de.tourentagebuch.app.MtTransfer;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

/** 2.18.0: Prüft MtTransfer (Fotos/Videos zu und von Meine Touren) gegen einen kleinen HTTP-Server: Formular gestreamt mit genauer Länge, Felder und Datei
 *  unverändert, Cookie, Abbrechen; Download mit Fortsetzen (Range/206), Neubeginn bei 200, Grenze; Hilfsfunktionen. Aufruf wie die übrigen Checks (javac + java). */
public class MtTransferCheck {
    static int n = 0;
    static void ok(boolean c, String m) { n++; if (!c) throw new AssertionError(m); }

    public static void main(String[] a) throws Exception {
        // Hilfsfunktionen
        ok(MtTransfer.refOk("a1b2c3d4e5f6a7b8c9d0") && MtTransfer.refOk("a.b:c-d_e") && !MtTransfer.refOk("") && !MtTransfer.refOk("ä") && !MtTransfer.refOk(new String(new char[65]).replace('\0', 'x')), "ref");
        ok(MtTransfer.safeName("../../x\"y.jpg").equals("x_y.jpg") && MtTransfer.safeName(null).equals("datei") && MtTransfer.safeName("a\\b\\c.mp4").equals("c.mp4"), "Name " + MtTransfer.safeName("../../x\"y.jpg"));
        ok(MtTransfer.videoCheck(10, 0) == null && MtTransfer.videoCheck(0, 0) != null && MtTransfer.videoCheck(MtTransfer.VIDEO_MAX + 1, 0).contains("200 MB")
                && MtTransfer.videoCheck(100L << 20, 1000L << 20).contains("1024 MB") && MtTransfer.videoCheck(24L << 20, 1000L << 20) == null, "Grenzen");
        ok(MtTransfer.rangeHeader(0) == null && "bytes=100-".equals(MtTransfer.rangeHeader(100)), "Range");
        ok(Arrays.equals(MtTransfer.contentRange("bytes 100-199/1000"), new long[]{100, 199, 1000}) && MtTransfer.contentRange("bytes 0-9/*")[2] == -1 && MtTransfer.contentRange("x") == null, "Content-Range");

        byte[] data = new byte[300_000];
        for (int i = 0; i < data.length; i++) data[i] = (byte) (i * 31 + (i >> 8));
        File dir = Files.createTempDirectory("mtt").toFile();
        File f = new File(dir, "foto.jpg");
        Files.write(f.toPath(), data);

        HttpServer srv = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        AtomicReference<byte[]> got = new AtomicReference<>();
        AtomicReference<String> ctype = new AtomicReference<>(), cookie = new AtomicReference<>(), range = new AtomicReference<>();
        AtomicReference<Long> clen = new AtomicReference<>();
        AtomicInteger mode = new AtomicInteger(0), hits = new AtomicInteger(0);
        srv.createContext("/api/tours/t1/photo", ex -> {
            ctype.set(ex.getRequestHeaders().getFirst("Content-Type"));
            cookie.set(ex.getRequestHeaders().getFirst("Cookie"));
            String cl = ex.getRequestHeaders().getFirst("Content-Length");
            clen.set(cl == null ? -1L : Long.parseLong(cl));
            ByteArrayOutputStream bo = new ByteArrayOutputStream();
            try (InputStream in = ex.getRequestBody()) { in.transferTo(bo); }
            got.set(bo.toByteArray());
            byte[] r = "{\"status\":\"neu\",\"id\":813}".getBytes(StandardCharsets.UTF_8);
            ex.getResponseHeaders().set("Content-Type", "application/json");
            ex.sendResponseHeaders(200, r.length);
            try (OutputStream o = ex.getResponseBody()) { o.write(r); }
        });
        srv.createContext("/api/tours/t1/tagebuch/video/3", ex -> {
            hits.incrementAndGet();
            String rg = ex.getRequestHeaders().getFirst("Range");
            range.set(rg);
            int m = mode.get();
            if (m == 2 || rg == null) {        // ganz (auch wenn eine Range erbeten war: Server ohne Range-Unterstützung)
                ex.sendResponseHeaders(200, data.length);
                try (OutputStream o = ex.getResponseBody()) { o.write(data); }
                return;
            }
            int from = Integer.parseInt(rg.replaceAll("bytes=(\\d+)-", "$1"));
            ex.getResponseHeaders().set("Content-Range", "bytes " + from + "-" + (data.length - 1) + "/" + data.length);
            ex.sendResponseHeaders(206, data.length - from);
            try (OutputStream o = ex.getResponseBody()) { o.write(data, from, data.length - from); }
        });
        srv.createContext("/fehlt", ex -> { byte[] r = "{\"detail\":\"Foto nicht gefunden\"}".getBytes(StandardCharsets.UTF_8); ex.sendResponseHeaders(404, r.length); try (OutputStream o = ex.getResponseBody()) { o.write(r); } });
        srv.start();
        String base = "http://127.0.0.1:" + srv.getAddress().getPort();
        try {
            // --- Senden ---
            Map<String, String> fields = new LinkedHashMap<>();
            fields.put("ref", "a1b2c3d4e5f6a7b8c9d0"); fields.put("name", "Gipfel ä.jpg"); fields.put("taken", "1782893430000"); fields.put("lat", "47.5"); fields.put("lng", "11.25");
            long[] last = {0, 0};
            MtTransfer.Result r = MtTransfer.upload(base + "/api/tours/t1/photo", "kh_session=GEHEIM", fields, f, "Gipfel ä.jpg", "image/jpeg", new MtTransfer.Control() {
                public boolean cancelled() { return false; }
                public void progress(long d, long t) { last[0] = d; last[1] = t; }
            }, 30000);
            ok(r.status == 200 && r.body.contains("\"neu\""), "Antwort " + r.status + " " + r.body);
            ok("kh_session=GEHEIM".equals(cookie.get()), "Cookie");
            ok(last[0] == data.length && last[1] == data.length, "Fortschritt");
            String bd = ctype.get().replaceAll(".*boundary=", "");
            ok(ctype.get().startsWith("multipart/form-data; boundary="), ctype.get());
            byte[] body = got.get();
            ok(clen.get() == body.length && body.length == MtTransfer.multipartLength(bd, fields, "file", "Gipfel ä.jpg", "image/jpeg", data.length), "feste Länge " + clen.get() + " / " + body.length);
            String txt = new String(body, StandardCharsets.ISO_8859_1);
            for (Map.Entry<String, String> e : fields.entrySet()) {
                String want = "Content-Disposition: form-data; name=\"" + e.getKey() + "\"\r\n\r\n" + new String(e.getValue().getBytes(StandardCharsets.UTF_8), StandardCharsets.ISO_8859_1) + "\r\n";
                ok(txt.contains(want), "Feld " + e.getKey());
            }
            String head = "name=\"file\"; filename=\"" + new String("Gipfel ä.jpg".getBytes(StandardCharsets.UTF_8), StandardCharsets.ISO_8859_1) + "\"\r\nContent-Type: image/jpeg\r\n\r\n";
            int at = txt.indexOf(head) + head.length();
            ok(at > head.length() && Arrays.equals(Arrays.copyOfRange(body, at, at + data.length), data), "Datei unverändert");
            ok(txt.endsWith("\r\n--" + bd + "--\r\n"), "Abschluss");
            // Abbrechen mitten im Senden
            boolean abgebrochen = false;
            try {
                MtTransfer.upload(base + "/api/tours/t1/photo", "", fields, f, "x.jpg", "image/jpeg", new MtTransfer.Control() {
                    public boolean cancelled() { return last[0] > 100_000; }
                    public void progress(long d, long t) { last[0] = d; }
                }, 30000);
            } catch (MtTransfer.CancelledException e) { abgebrochen = true; }
            ok(abgebrochen, "Abbrechen beim Senden");

            // --- Holen mit Fortsetzen ---
            File part = new File(dir, "v.part");
            Files.write(part.toPath(), Arrays.copyOf(data, 120_000));      // angefangener Download
            mode.set(1);
            MtTransfer.Result d = MtTransfer.download(base + "/api/tours/t1/tagebuch/video/3?video=1", "kh_session=X", part, MtTransfer.VIDEO_MAX, null, 30000);
            ok(d.status == 206 && d.resumed && "bytes=120000-".equals(range.get()) && Arrays.equals(Files.readAllBytes(part.toPath()), data), "Fortsetzen " + d.status + " " + range.get());
            // Server ohne Range: 200 → Datei von vorn
            Files.write(part.toPath(), new byte[]{9, 9, 9});
            mode.set(2);
            d = MtTransfer.download(base + "/api/tours/t1/tagebuch/video/3?video=1", null, part, MtTransfer.VIDEO_MAX, null, 30000);
            ok(d.status == 200 && !d.resumed && Arrays.equals(Files.readAllBytes(part.toPath()), data), "Neubeginn bei 200");
            // Grenze
            part.delete();
            d = MtTransfer.download(base + "/api/tours/t1/tagebuch/video/3?video=1", null, part, 100_000, null, 30000);
            ok(d.status == 413 && !part.exists(), "Grenze beim Holen");
            // Abbrechen: Teildatei bleibt zum Fortsetzen
            boolean ab2 = false;
            try {
                MtTransfer.download(base + "/api/tours/t1/tagebuch/video/3?video=1", null, part, MtTransfer.VIDEO_MAX, new MtTransfer.Control() {
                    public boolean cancelled() { return part.length() > 0; }
                    public void progress(long dd, long t) { }
                }, 30000);
            } catch (MtTransfer.CancelledException e) { ab2 = true; }
            ok(ab2 && part.isFile() && part.length() > 0 && part.length() < data.length, "Abbrechen beim Holen, Teil bleibt: " + part.length());
            mode.set(1);
            d = MtTransfer.download(base + "/api/tours/t1/tagebuch/video/3?video=1", null, part, MtTransfer.VIDEO_MAX, null, 30000);
            ok(d.resumed && Arrays.equals(Files.readAllBytes(part.toPath()), data), "nach Abbruch fortgesetzt");
            // Fehler des Servers: Status und Text, keine Datei
            File p2 = new File(dir, "x.part");
            d = MtTransfer.download(base + "/fehlt", null, p2, 1000, null, 30000);
            ok(d.status == 404 && d.body.contains("nicht gefunden") && !p2.exists(), "404");
        } finally {
            srv.stop(0);
        }
        System.out.println("MtTransferCheck OK (" + n + " Prüfungen)");
    }
}
