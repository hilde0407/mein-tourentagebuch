import de.tourentagebuch.app.TilePlan;

import java.util.List;

/** 2.11.0: Kachelrechnung, Grenzen und Pfadschutz der Offline-Karten ohne Gerät prüfen.
    Die erwarteten Zahlen stehen genauso in tests/test_calc.js (calc-offline.js muss dasselbe ergeben). */
public class TilePlanCheck {
    static void check(boolean ok, String msg) {
        if (!ok) { System.err.println("FEHLER: " + msg); System.exit(1); }
    }

    public static void main(String[] a) {
        // Kachel eines Punkts (Web-Mercator), Ränder begrenzt
        int[] t = TilePlan.tileXY(47.5, 11.2, 15);
        check(t[0] == 17403 && t[1] == 11458, "47,5/11,2 z15: " + t[0] + "/" + t[1]);
        t = TilePlan.tileXY(47.42, 10.98, 12);
        check(t[0] == 2172 && t[1] == 1433, "z12: " + t[0] + "/" + t[1]);
        t = TilePlan.tileXY(-33.86, 151.21, 10);
        check(t[0] == 942 && t[1] == 614, "Sydney z10: " + t[0] + "/" + t[1]);
        t = TilePlan.tileXY(89, -180, 3);
        check(t[0] == 0 && t[1] == 0, "Nordwestecke");
        t = TilePlan.tileXY(-89, 180, 3);
        check(t[0] == 7 && t[1] == 7, "Südostecke begrenzt: " + t[0] + "/" + t[1]);

        // Rechteck: gleiche Zahlen wie calc-offline.js
        check(TilePlan.countRect(47.40, 11.00, 47.50, 11.15, 10, 13) == 23, "Rechteck 10–13");
        check(TilePlan.countRect(47.40, 11.00, 47.50, 11.15, 10, 15) == 275, "Rechteck 10–15: " + TilePlan.countRect(47.40, 11.00, 47.50, 11.15, 10, 15));
        check(TilePlan.countRect(47.40, 11.00, 47.50, 11.15, 10, 16) == 1059, "Rechteck 10–16");
        check(TilePlan.countRect(47.40, 11.00, 47.50, 11.15, 10, 18) == 1059, "über Zoom 16 wird nie gerechnet");
        check(TilePlan.countRect(47.40, 11.00, 47.50, 11.15, 15, 12) == 0, "zmin > zmax: nichts");
        TilePlan.Plan p = TilePlan.rect(47.40, 11.00, 47.50, 11.15, 10, 15, TilePlan.MAX_TILES);
        check(p.keys != null && p.keys.length == 275 && p.count == 275, "Rechteckliste");
        int[] k0 = TilePlan.unkey(p.keys[0]);
        check(k0[0] == 10, "beginnt mit Zoom 10");
        for (int i = 1; i < p.keys.length; i++) check(p.keys[i] > p.keys[i - 1] || TilePlan.unkey(p.keys[i])[0] > TilePlan.unkey(p.keys[i - 1])[0], "sortiert/eindeutig");
        int[] r = TilePlan.unkey(TilePlan.key(16, 34807, 22917));
        check(r[0] == 16 && r[1] == 34807 && r[2] == 22917, "Schlüssel hin und zurück");
        // zu groß: keine Liste, aber Zahl
        p = TilePlan.rect(46.0, 10.0, 48.0, 13.0, 10, 16, TilePlan.MAX_TILES);
        check(p.keys == null && p.count > TilePlan.MAX_TILES, "großes Rechteck abgelehnt: " + p.count);

        // Strecke mit 2 km Rand (doppelter Punkt darf nicht stören)
        double[][] pts = {{47.40, 11.00}, {47.45, 11.05}, {47.47, 11.12}, {47.47, 11.12}, {47.50, 11.20}};
        check(TilePlan.supports(pts, 2000).size() == 12, "Stützpunkte: " + TilePlan.supports(pts, 2000).size());
        p = TilePlan.corridor(pts, 2000, 10, 13, TilePlan.MAX_TILES);
        check(p.count == 38, "Korridor 10–13: " + p.count);
        p = TilePlan.corridor(pts, 2000, 10, 15, TilePlan.MAX_TILES);
        check(p.count == 306 && p.keys.length == 306, "Korridor 10–15: " + p.count);
        int[] f = TilePlan.unkey(p.keys[0]), s = TilePlan.unkey(p.keys[1]);
        check(f[0] == 10 && f[1] == 543 && f[2] == 357 && s[2] == 358, "erste Kacheln wie in JS");
        check(TilePlan.corridor(pts, 2000, 10, 16, TilePlan.MAX_TILES).count == 1023, "Korridor 10–16");
        List<String> cv = TilePlan.cover(p.keys);
        check(cv.size() == 9 && cv.get(0).equals("2172/1433") && cv.get(8).equals("2175/1432"), "Abdeckung z12: " + cv);
        check(TilePlan.corridor(pts, 2000, 10, 15, 100).keys == null, "Grenze max greift");
        check(TilePlan.corridor(new double[][]{}, 2000, 10, 15, 2000).count == 0, "leere Strecke");
        check(TilePlan.corridor(new double[][]{{Double.NaN, 1}, {95, 11}}, 2000, 10, 15, 2000).count == 0, "ungültige Punkte");
        double[] fr = TilePlan.frame(pts, 2000);
        check(fr[0] < 47.40 && fr[2] > 47.50 && fr[1] < 11.00 && fr[3] > 11.20, "Rahmen mit Rand");

        // Grenzen und Quellen
        check(TilePlan.check("topo", 275, 0) == null, "Wanderkarte erlaubt");
        check(TilePlan.check("osm", 275, 0) != null, "OSM-Standardkarte: kein Vorausladen");
        check(TilePlan.check("evil", 10, 0) != null, "unbekannte Quelle");
        check(TilePlan.check("topo", 2001, 0) != null && TilePlan.check("topo", 2000, 0) == null, "2000 ja, 2001 nein");
        check(TilePlan.check("topo", 0, 0) != null, "leer");
        check(TilePlan.check("topo", 2000, TilePlan.MAX_TOTAL - 1000) != null, "Gesamtgrenze");
        check(TilePlan.estimateBytes("topo", 1000) == 25600000L, "Schätzung");

        // Pfade: nur Ziffern, Quelle aus der Liste, im Raster
        check("topo/15/17403/11458.png".equals(TilePlan.relPath("topo", 15, 17403, 11458)), "Pfad");
        check(TilePlan.relPath("topo", 3, 8, 0) == null && TilePlan.relPath("topo", -1, 0, 0) == null && TilePlan.relPath("x", 1, 0, 0) == null, "ungültige Pfade");
        check("topo/15/17403/11458.png".equals(TilePlan.localPath("/tiles/topo/15/17403/11458.png")), "lokaler Pfad");
        check(TilePlan.localPath("/tiles/topo/15/../11458.png") == null && TilePlan.localPath("/tiles/topo/15/1/2.png/../../x") == null, "kein ..");
        check(TilePlan.localPath("/tiles/evil/1/0/0.png") == null && TilePlan.localPath("/tiles/topo/1/5/0.png") == null, "Quelle/Raster");
        check(TilePlan.localPath("/tiles/topo/15/-1/2.png") == null && TilePlan.localPath("/tiles/topo/15/1/2.jpg") == null, "nur Ziffern und .png");
        check("topo/12/2172/1433.png".equals(TilePlan.remotePath("tile.opentopomap.org", "/12/2172/1433.png")), "OpenTopoMap");
        check("topo/12/2172/1433.png".equals(TilePlan.remotePath("b.tile.opentopomap.org", "/12/2172/1433.png")), "OpenTopoMap b.");
        check("osm/12/2172/1433.png".equals(TilePlan.remotePath("tile.openstreetmap.org", "/12/2172/1433.png")), "OSM");
        check(TilePlan.remotePath("tile.openstreetmap.org.evil.com", "/12/2172/1433.png") == null && TilePlan.remotePath("x.tile.opentopomap.org", "/1/0/0.png") == null, "fremde Hosts");
        check(TilePlan.remotePath("tile.openstreetmap.org", "/12/2172/1433.png?x=1") == null && TilePlan.remotePath("tile.openstreetmap.org", "/a/1/2.png") == null, "fremde Pfade");
        check("https://tile.opentopomap.org/15/17403/11458.png".equals(TilePlan.url("topo", 15, 17403, 11458)), "Adresse");
        check(TilePlan.url("topo", 15, -1, 0) == null, "keine Adresse für Unsinn");
        check(TilePlan.validId("m3k9x2ab") && !TilePlan.validId("../a") && !TilePlan.validId("") && !TilePlan.validId("ABC"), "Kennungen");
        check(TilePlan.name("  Karwendel\n Runde ", null).equals("Karwendel Runde") && TilePlan.name("", "X").equals("X") && TilePlan.name("x".repeat(80), null).length() == 60, "Namen");

        // Laden: nur Fehlendes; Aktualisieren nur Altes; Wartezeiten; Bildprüfung
        long now = 1_800_000_000_000L, day = 86_400_000L;
        check(TilePlan.needs(false, 0, 0, false, now) && TilePlan.needs(true, 0, now, false, now), "fehlend/leer laden");
        check(!TilePlan.needs(true, 100, now - 30 * day, false, now), "vorhanden: nicht laden");
        check(TilePlan.needs(true, 100, now - 8 * day, true, now) && !TilePlan.needs(true, 100, now - day, true, now), "Aktualisieren nur älter als 7 Tage");
        check(TilePlan.backoff(1, 0) == 2000 && TilePlan.backoff(2, 0) == 5000 && TilePlan.backoff(3, 0) == 10000 && TilePlan.backoff(1, 429) == 30000, "Wartezeiten");
        check(TilePlan.looksLikeImage(new byte[]{(byte) 0x89, 'P', 'N', 'G', 13, 10, 26, 10}) && TilePlan.looksLikeImage(new byte[]{(byte) 0xFF, (byte) 0xD8, 0, 0, 0, 0, 0, 0}), "PNG/JPEG");
        check(!TilePlan.looksLikeImage("<html>Fehler</html>".getBytes()) && !TilePlan.looksLikeImage(new byte[3]), "Fehlerseite nicht");
        System.out.println("TilePlanCheck OK");
        // 2.16.0: Merker „Ordner fehlt“ beim Abfangen
        check("topo/15/17403".equals(TilePlan.folderOf("topo/15/17403/11458.png")), "Ordner einer Kachel");
        check(TilePlan.folderOf(null) == null && TilePlan.folderOf("x.png") == null && TilePlan.folderOf("/x") == null, "kein Ordner");
        check(TilePlan.folderOf(TilePlan.remotePath("tile.openstreetmap.org", "/14/8701/5729.png")).equals("osm/14/8701"), "Ordner aus Kachel-Adresse");
        check(TilePlan.missingValid(1000, 1000) && TilePlan.missingValid(1000, 1000 + TilePlan.MISSING_MS - 1), "Merker gilt");
        check(!TilePlan.missingValid(1000, 1000 + TilePlan.MISSING_MS) && !TilePlan.missingValid(1000, 999), "Merker abgelaufen / Uhr zurück");
        check(TilePlan.MISSING_MAX >= 1024 && TilePlan.MISSING_MS <= 60_000, "Grenzen des Merkers");
    }
}
