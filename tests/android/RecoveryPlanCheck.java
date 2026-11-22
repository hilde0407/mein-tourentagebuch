import de.tourentagebuch.app.RecoveryPlan;
import de.tourentagebuch.app.TrackStore;
import java.io.File;
import java.io.FileOutputStream;
import java.io.FileWriter;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;

/** 2.12.0: Wiederherstellung einer unterbrochenen Aufzeichnung (RecoveryPlan + TrackStore.load). Gleiche 12-Stunden-Regel wie js/calc-aufnahme.js. */
public class RecoveryPlanCheck {
    static int n = 0;
    static void check(boolean ok, String msg) {
        n++;
        if (!ok) { System.err.println("FEHLER: " + msg); System.exit(1); }
    }

    public static void main(String[] a) throws Exception {
        File dir = Files.createTempDirectory("rec").toFile();
        long t0 = 1763800000000L, H = 3600000L;

        // 1. Metadaten: schreiben/lesen, Sonderzeichen, Pausen, Lücken, Fotos
        RecoveryPlan.Meta m = new RecoveryPlan.Meta();
        m.start = t0; m.state = "recording"; m.sport = "hike"; m.name = "Hütte = schön\nzweite Zeile \\ ok"; m.route = "Runde";
        m.pauses.add(new long[]{t0 + 600000, t0 + 900000});
        m.pauses.add(new long[]{t0 + 2 * H, 0});
        m.gaps.add(new long[]{t0 + H, t0 + H + 120000});
        m.media.add((t0 + 300000) + ",abc123v");
        File mf = new File(dir, "rec_meta.txt");
        RecoveryPlan.writeAtomic(mf, RecoveryPlan.format(m));
        check(!new File(dir, "rec_meta.txt.tmp").exists(), "Zwischendatei bleibt liegen");
        RecoveryPlan.Meta r = RecoveryPlan.load(mf);
        check(r != null && r.start == t0 && "recording".equals(r.state) && "hike".equals(r.sport) && "Runde".equals(r.route), "Metadaten gelesen");
        check(m.name.equals(r.name), "Name mit Zeilenumbruch, = und \\: " + r.name);
        check(r.pauses.size() == 2 && r.pauses.get(0)[1] == t0 + 900000 && r.pauses.get(1)[1] == 0, "Pausen");
        check(r.gaps.size() == 1 && r.gaps.get(0)[0] == t0 + H, "Lücken");
        check(r.media.size() == 1 && r.media.get(0).endsWith(",abc123v"), "Fotos/Videos");
        check(r.lastMark() == t0 + 2 * H, "spätester Zeitpunkt aus den Metadaten: " + r.lastMark());
        // überschreiben (atomar) und alte Fassung ist weg
        m.state = "paused";
        RecoveryPlan.writeAtomic(mf, RecoveryPlan.format(m));
        check("paused".equals(RecoveryPlan.load(mf).state), "Überschreiben");
        // kaputte Zeilen werden übergangen, Rest bleibt lesbar
        RecoveryPlan.Meta k = RecoveryPlan.parse("v=1\nstart=12x\nsport=mtb\npause=1,\npause=5,6\ngap=a,b\nmüll\n=leer\nname=Ok");
        check(k.start == 0 && "mtb".equals(k.sport) && k.pauses.size() == 1 && k.gaps.isEmpty() && "Ok".equals(k.name), "kaputte Metadaten-Zeilen übergangen");
        check(RecoveryPlan.parse(null) != null && RecoveryPlan.load(new File(dir, "fehlt.txt")) == null, "fehlende Datei");
        // Absturz zwischen Schreiben und Umbenennen: fertige Zwischendatei gilt, halbe nicht
        File mf2 = new File(dir, "m2.txt");
        Files.write(new File(dir, "m2.txt.tmp").toPath(), RecoveryPlan.format(m).getBytes(StandardCharsets.UTF_8));
        check(RecoveryPlan.load(mf2) != null && RecoveryPlan.load(mf2).start == t0, "fertige Zwischendatei wird genommen");
        Files.write(new File(dir, "m3.txt.tmp").toPath(), "v=1\nstart=5\n".getBytes(StandardCharsets.UTF_8));
        check(RecoveryPlan.load(new File(dir, "m3.txt")) == null, "halbe Zwischendatei wird nicht genommen");

        // 2. Punktdatei: Aufzeichnung schreibt laufend, „Prozessende“, abgerissenes Ende, Laden ohne Verlust
        File csv = new File(dir, "rec_current.csv");
        TrackStore s = new TrackStore(csv);
        for (int i = 0; i < 120; i++) s.add(t0 + i * 5000L, 47.0 + i * 0.0002, 11.0, 800 + i, 5f);
        int before = s.count();
        double dist = s.distanceM();
        long sizeBefore = csv.length();
        // Absturz mitten im Schreiben: halbe Zeile ohne Zeilenende angehängt
        try (FileOutputStream o = new FileOutputStream(csv, true)) { o.write("1763800999000,47.03".getBytes(StandardCharsets.US_ASCII)); }
        RecoveryPlan.Summary sum = RecoveryPlan.scan(csv);
        check(sum.torn && sum.count == before && sum.badLines == 1, "abgerissenes Ende erkannt: " + sum.count + "/" + sum.badLines + " torn=" + sum.torn);
        check(Math.abs(sum.distM - dist) < 1.0 && sum.first == t0 && sum.last == t0 + 119 * 5000L, "Strecke/Zeiten aus der Datei: " + sum.distM);
        // neuer Prozess: laden – die Datei bleibt (nur das abgerissene Ende fällt weg), Strecke stimmt
        TrackStore s2 = new TrackStore(csv);
        s2.load();
        check(s2.count() == before && Math.abs(s2.distanceM() - dist) < 1.0, "geladen: " + s2.count() + " Punkte, " + s2.distanceM() + " m");
        check(csv.length() == sizeBefore, "Datei nach dem Laden unverändert bis auf das abgerissene Ende: " + csv.length() + " statt " + sizeBefore);
        check(!RecoveryPlan.scan(csv).torn, "Ende repariert");
        // fortsetzen: neuer Punkt beginnt ein neues Segment (Lücke markiert) und klebt nicht an einer kaputten Zeile
        check(s2.add(t0 + 2 * H, 47.05, 11.01, 900, 5f), "Punkt nach dem Fortsetzen");
        TrackStore s3 = new TrackStore(csv);
        s3.load();
        check(s3.count() == before + 1, "nach Fortsetzen und erneutem Laden: " + s3.count());
        String gpx = s3.gpx("x", "hike");
        check(gpx.split("<trkseg>", -1).length - 1 == 2, "Lücke als neues Segment");
        // die Lücke zählt nicht zur Strecke
        check(Math.abs(s3.distanceM() - dist) < 1.0, "Lücke nicht als Strecke gezählt: " + s3.distanceM());
        check(Math.abs(RecoveryPlan.scan(csv).distM - dist) < 1.0, "auch die Zusammenfassung zählt die Lücke nicht");
        // kaputte Zeile mitten in der Datei wird übergangen
        try (FileWriter w = new FileWriter(csv, true)) { w.write("xx,yy\n" + (t0 + 2 * H + 5000) + ",47.0502,11.01,900.0,0\n"); }
        TrackStore s4 = new TrackStore(csv);
        s4.load();
        check(s4.count() == before + 2, "kaputte Zeile übergangen: " + s4.count());
        check(RecoveryPlan.repairTail(csv) == 0, "vollständige Datei bleibt");
        File leer = new File(dir, "leer.csv");
        leer.createNewFile();
        check(RecoveryPlan.scan(leer).count == 0 && RecoveryPlan.repairTail(leer) == 0 && RecoveryPlan.scan(new File(dir, "nix.csv")).count == 0, "leere/fehlende Datei");
        // nur eine halbe Zeile
        File halb = new File(dir, "halb.csv");
        Files.write(halb.toPath(), "17638".getBytes(StandardCharsets.US_ASCII));
        check(RecoveryPlan.repairTail(halb) == 5 && halb.length() == 0, "nur halbe Zeile → leer");
        check(RecoveryPlan.parseLine("1,2,3,,1") != null && RecoveryPlan.parseLine("1,95,3,,0") == null && RecoveryPlan.parseLine("1,2,3,x,0") == null, "Zeile prüfen");

        // 3. Fortsetzen erlaubt? Bis knapp 12 h nach dem letzten Lebenszeichen; Uhr darf 10 min zurückgehen
        long now = t0 + 20 * H;
        check(RecoveryPlan.canResume(now - 5 * 60000, now), "5 min alt");
        check(RecoveryPlan.canResume(now - (12 * H - 60000), now), "11:59 h alt");
        check(!RecoveryPlan.canResume(now - 12 * H, now), "genau 12 h: nicht mehr");
        check(!RecoveryPlan.canResume(now - 30 * H, now), "30 h alt");
        check(RecoveryPlan.canResume(now + 5 * 60000, now), "Uhr 5 min zurück");
        check(!RecoveryPlan.canResume(now + 60 * 60000, now), "Uhr 1 h zurück: unsicher");
        check(!RecoveryPlan.canResume(0, now), "ohne Zeit");
        check(RecoveryPlan.lastActivity(r, t0 + 3 * H) == t0 + 3 * H && RecoveryPlan.lastActivity(r, t0) == t0 + 2 * H && RecoveryPlan.lastActivity(null, 7) == 7, "letztes Lebenszeichen");

        // 4. Unterbrochen? Nur „recording“ ohne lebenden Dienst und nicht gerade erst gestartet
        check(RecoveryPlan.interrupted("recording", false, Long.MAX_VALUE), "Dienst fehlt nach Neustart");
        check(!RecoveryPlan.interrupted("recording", true, Long.MAX_VALUE), "Dienst läuft");
        check(!RecoveryPlan.interrupted("recording", false, 3000), "Dienst startet gerade");
        check(RecoveryPlan.interrupted("recording", false, 60000), "Dienst kam nach dem Start nicht");
        check(!RecoveryPlan.interrupted("paused", false, Long.MAX_VALUE), "Pause ist keine Unterbrechung");
        check(!RecoveryPlan.interrupted("idle", false, Long.MAX_VALUE) && !RecoveryPlan.interrupted("finished", false, Long.MAX_VALUE), "nichts aufgezeichnet");
        check(RecoveryPlan.RESUME_MAX_MS == 12 * H, "12 Stunden");

        System.out.println("OK (" + n + " Prüfungen)");
    }
}
