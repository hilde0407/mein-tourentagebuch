import com.sun.net.httpserver.HttpServer;
import de.tourentagebuch.app.MtAuftrag;
import de.tourentagebuch.app.MtTransfer;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileNotFoundException;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.BitSet;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

/** 2.18.1: Prüft MtAuftrag (Abgleich mit Meine Touren als Auftrag in der Hülle): Wiederholen mit Wartezeit bei Netzfehlern und 5xx (höchstens 3-mal, dann
 *  Fehler und weiter), kein Wiederholen bei 4xx und fehlender Datei, Abbrechen während des Wartens, 401/403 beenden den Auftrag; Journal mit fsync, halbe
 *  letzte Zeile wird verworfen, erledigte Schritte und nächster offener Schritt (Fortsetzen); sicheres Ersetzen einer Datei; MtTransfer.json gegen einen
 *  kleinen HTTP-Server (POST mit JSON und Cookie, GET), auch mit einem Server, der erst zweimal 503 antwortet. Aufruf wie die übrigen Checks (javac + java). */
public class MtAuftragCheck {
    static int n = 0;
    static void ok(boolean c, String m) { n++; if (!c) throw new AssertionError(m); }

    public static void main(String[] args) throws Exception {
        // Regeln
        ok(MtAuftrag.wiederholbar(0) && MtAuftrag.wiederholbar(503) && MtAuftrag.wiederholbar(500) && MtAuftrag.wiederholbar(429) && MtAuftrag.wiederholbar(408), "wiederholbar");
        ok(!MtAuftrag.wiederholbar(200) && !MtAuftrag.wiederholbar(404) && !MtAuftrag.wiederholbar(413) && !MtAuftrag.wiederholbar(401) && !MtAuftrag.wiederholbar(403), "nicht wiederholbar");
        ok("relogin".equals(MtAuftrag.endgueltig(401)) && "verboten".equals(MtAuftrag.endgueltig(403)) && MtAuftrag.endgueltig(404) == null && MtAuftrag.endgueltig(500) == null, "endgültig");
        ok(MtAuftrag.warte(1) == 5000 && MtAuftrag.warte(2) == 20000 && MtAuftrag.warte(3) == 60000 && MtAuftrag.warte(9) == 60000, "Wartezeiten");
        ok(MtAuftrag.netzfehler(new java.net.SocketTimeoutException()) && MtAuftrag.netzfehler(new java.net.UnknownHostException()) && !MtAuftrag.netzfehler(new FileNotFoundException())
                && !MtAuftrag.netzfehler(new MtTransfer.CancelledException()) && !MtAuftrag.netzfehler(new Exception("Datei fehlt")), "Netzfehler");
        ok(MtAuftrag.zeile(0, 40, "Gipfeltour", "foto-holen").equals("1 von 40 · Gipfeltour · Foto holen") && MtAuftrag.zeile(4, 5, "", "stand").equals("5 von 5 · Stand"), MtAuftrag.zeile(0, 40, "Gipfeltour", "foto-holen"));

        // Wiederholen: zweimal Netzfehler, dann 200 → 3 Versuche, Wartezeiten 5 s und 20 s
        List<Long> gewartet = new ArrayList<>();
        AtomicInteger k = new AtomicInteger();
        MtAuftrag.Warten w = (ms, v) -> { gewartet.add(ms); return true; };
        MtAuftrag.Ausgang o = MtAuftrag.wiederholt(() -> { if (k.incrementAndGet() < 3) throw new java.net.SocketException("Netz weg"); return 200; }, w);
        ok(o.status == 200 && o.versuche == 3 && o.fehler == null && !o.abgebrochen && gewartet.equals(List.of(5000L, 20000L)), "Netzwechsel: " + o.versuche + " " + gewartet);
        // immer Netzfehler → 1 + 3 Versuche, dann Fehler (der Auftrag zählt den Schritt als Fehler und macht weiter)
        gewartet.clear(); k.set(0);
        o = MtAuftrag.wiederholt(() -> { k.incrementAndGet(); throw new java.net.SocketTimeoutException("Zeit abgelaufen"); }, w);
        ok(o.status == 0 && o.versuche == 4 && k.get() == 4 && "Zeit abgelaufen".equals(o.fehler) && !o.abgebrochen && gewartet.size() == 3, "aufgeben " + o.versuche);
        // 503 dreimal, dann 200
        gewartet.clear(); k.set(0);
        o = MtAuftrag.wiederholt(() -> k.incrementAndGet() <= 3 ? 503 : 200, w);
        ok(o.status == 200 && o.versuche == 4, "503 " + o.versuche);
        // 404 und fehlende Datei: kein neuer Versuch
        k.set(0);
        o = MtAuftrag.wiederholt(() -> { k.incrementAndGet(); return 404; }, w);
        ok(o.status == 404 && o.versuche == 1 && k.get() == 1, "404");
        o = MtAuftrag.wiederholt(() -> { throw new Exception("Datei fehlt"); }, w);
        ok(o.versuche == 1 && "Datei fehlt".equals(o.fehler), "Datei fehlt");
        o = MtAuftrag.wiederholt(() -> 401, w);
        ok(o.status == 401 && o.versuche == 1, "401");
        // Abbrechen während des Wartens und mitten in der Übertragung
        k.set(0);
        o = MtAuftrag.wiederholt(() -> { k.incrementAndGet(); return 502; }, (ms, v) -> false);
        ok(o.abgebrochen && k.get() == 1, "Abbruch beim Warten");
        o = MtAuftrag.wiederholt(() -> { throw new MtTransfer.CancelledException(); }, w);
        ok(o.abgebrochen && o.versuche == 1, "Abbruch beim Übertragen");

        // Journal
        File dir = Files.createTempDirectory("mta").toFile();
        File j = new File(dir, "ergebnisse.txt");
        ok(MtAuftrag.lesen(j).isEmpty() && MtAuftrag.text(j) == null, "kein Journal");
        MtAuftrag.anhaengen(j, 0, "{\"status\":200,\"id\":\"abc\"}");
        MtAuftrag.anhaengen(j, 1, "{\"status\":404,\"body\":\"Zeile\\\\nmit Umbruch nur maskiert\"}");
        MtAuftrag.anhaengen(j, 3, "{\"status\":200}");
        boolean warf = false;
        try { MtAuftrag.anhaengen(j, 4, "{\"a\":\"x\ny\"}"); } catch (IllegalArgumentException e) { warf = true; }
        ok(warf, "Zeilenumbruch abgelehnt");
        try (FileOutputStream fo = new FileOutputStream(j, true)) { fo.write("2\t{\"status\":2".getBytes(StandardCharsets.UTF_8)); }      // Absturz mitten im Schreiben
        List<String> z = MtAuftrag.lesen(j);
        ok(z.size() == 3 && MtAuftrag.nummer(z.get(0)) == 0 && MtAuftrag.json(z.get(0)).equals("{\"status\":200,\"id\":\"abc\"}") && MtAuftrag.nummer(z.get(2)) == 3, "Journal lesen " + z);
        BitSet b = MtAuftrag.erledigt(z);
        ok(b.get(0) && b.get(1) && !b.get(2) && b.get(3) && MtAuftrag.naechster(5, b) == 2, "erledigt/nächster");
        b.set(2); b.set(4);
        ok(MtAuftrag.naechster(5, b) == -1 && MtAuftrag.naechster(6, b) == 5, "alle erledigt");
        ok(MtAuftrag.nummer("x\t{}") == -1 && MtAuftrag.nummer("{}") == -1 && MtAuftrag.nummer(null) == -1 && MtAuftrag.nummer("12\t{}") == 12, "Nummer");
        // weiterschreiben nach der halben Zeile: sie wird erst abgeschlossen, bleibt unlesbar und verworfen; die neue Zeile gilt
        MtAuftrag.anhaengen(j, 2, "{\"status\":201}");
        z = MtAuftrag.lesen(j);
        ok(z.size() == 4 && MtAuftrag.json(z.get(3)).equals("{\"status\":201}") && MtAuftrag.naechster(4, MtAuftrag.erledigt(z)) == -1, "nach halber Zeile " + z);
        ok(MtAuftrag.nummer("2\t{\"status\":2") == -1 && MtAuftrag.nummer("2\t{}") == 2, "halbe Zeile unlesbar");

        // sicher ersetzen
        File p = new File(dir, "auftrag.json");
        MtAuftrag.schreibeSicher(p, "{\"a\":1}");
        MtAuftrag.schreibeSicher(p, "{\"a\":2,\"text\":\"Grüße\"}");
        ok(MtAuftrag.text(p).equals("{\"a\":2,\"text\":\"Grüße\"}") && !new File(dir, "auftrag.json.neu").exists(), "sicher ersetzen");

        // MtTransfer.json gegen einen Server, der erst zweimal 503 antwortet
        HttpServer srv = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        AtomicReference<String> got = new AtomicReference<>(), ck = new AtomicReference<>(), ct = new AtomicReference<>();
        AtomicInteger hits = new AtomicInteger();
        srv.createContext("/api/tours/t1/notiz", ex -> {
            int h = hits.incrementAndGet();
            ck.set(ex.getRequestHeaders().getFirst("Cookie"));
            ct.set(ex.getRequestHeaders().getFirst("Content-Type"));
            ByteArrayOutputStream bo = new ByteArrayOutputStream();
            try (InputStream in = ex.getRequestBody()) { in.transferTo(bo); }
            got.set(new String(bo.toByteArray(), StandardCharsets.UTF_8));
            byte[] r = (h <= 2 ? "{\"detail\":\"kurz weg\"}" : "{\"status\":\"uebernommen\",\"notiz\":{\"text\":\"Hallo Grüße\",\"geaendert\":7}}").getBytes(StandardCharsets.UTF_8);
            ex.sendResponseHeaders(h <= 2 ? 503 : 200, r.length);
            try (OutputStream os = ex.getResponseBody()) { os.write(r); }
        });
        srv.createContext("/api/tagebuch/uebersicht", ex -> {
            byte[] r = ("{\"t1\":{\"stand\":\"s7\"},\"q\":\"" + ex.getRequestURI().getQuery() + "\",\"m\":\"" + ex.getRequestMethod() + "\"}").getBytes(StandardCharsets.UTF_8);
            ex.sendResponseHeaders(200, r.length);
            try (OutputStream os = ex.getResponseBody()) { os.write(r); }
        });
        srv.start();
        String base = "http://127.0.0.1:" + srv.getAddress().getPort();
        try {
            final MtTransfer.Result[] last = {null};
            gewartet.clear();
            o = MtAuftrag.wiederholt(() -> { last[0] = MtTransfer.json(base + "/api/tours/t1/notiz", "kh_session=abc", "POST", "{\"text\":\"Hallo Grüße\",\"basis\":null}", 5000); return last[0].status; }, w);
            ok(o.status == 200 && o.versuche == 3 && hits.get() == 3 && last[0].body.contains("\"geaendert\":7") && last[0].body.contains("Grüße"), "Notiz mit Wiederholung " + o.versuche + " " + last[0].body);
            ok("kh_session=abc".equals(ck.get()) && "application/json".equals(ct.get()) && got.get().equals("{\"text\":\"Hallo Grüße\",\"basis\":null}"), "Notiz: Kopf und Inhalt " + ct.get() + " " + got.get());
            MtTransfer.Result g = MtTransfer.json(base + "/api/tagebuch/uebersicht?ids=t1", "kh_session=abc", "GET", null, 5000);
            ok(g.status == 200 && g.body.contains("\"q\":\"ids=t1\"") && g.body.contains("\"m\":\"GET\""), "Stand lesen " + g.body);
            // Server weg: Netzfehler (IOException) → würde wiederholt
            boolean netz = false;
            try { MtTransfer.json("http://127.0.0.1:1/x", "", "GET", null, 2000); } catch (IOException e) { netz = MtAuftrag.netzfehler(e); }
            ok(netz, "Verbindung abgelehnt zählt als Netzfehler");
        } finally {
            srv.stop(0);
        }
        System.out.println("MtAuftragCheck: " + n + " Prüfungen ok");
    }
}
