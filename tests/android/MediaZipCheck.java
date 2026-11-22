import de.tourentagebuch.app.MediaZip;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import java.util.zip.ZipOutputStream;

/** 2.10.0: Medien-Sicherung ohne Gerät prüfen – Namensprüfung (Zip Slip), Auswahl für „nur Neues“, Teilung, echter Schreib-/Lese-Rundlauf, Abbruch, Aufräumen der automatischen Sicherungen. */
public class MediaZipCheck {
    static int n = 0;
    static void check(boolean ok, String msg) {
        n++;
        if (!ok) { System.err.println("FEHLER: " + msg); System.exit(1); }
    }

    static File write(File dir, String name, int size, int seed) throws Exception {
        File f = new File(dir, name);
        byte[] b = new byte[size];
        for (int i = 0; i < size; i++) b[i] = (byte) (i * 31 + seed);
        Files.write(f.toPath(), b);
        f.setLastModified(1700000000000L + seed * 1000L);
        return f;
    }

    static void rm(File d) {
        File[] fs = d.listFiles();
        if (fs != null) for (File f : fs) rm(f);
        d.delete();
    }

    public static void main(String[] a) throws Exception {
        // 1. Namen: nur photos/ und thumbs/ mit [A-Za-z0-9._-], kein Weg nach draußen
        for (String ok : new String[]{"photos/abc123.jpg", "photos/0a1b2c3d4e5f6a7b8c9dv.mp4", "thumbs/abc_1-2.jpg", "photos/A.B.C"})
            check(MediaZip.safeEntry(ok), "erlaubt: " + ok);
        for (String bad : new String[]{"../x.jpg", "photos/../../etc/passwd", "photos/..", "photos/.", "photos/.hidden", "photos/a/b.jpg", "photos/",
                "/photos/a.jpg", "photos\\a.jpg", "photos/a b.jpg", "photos/ä.jpg", "videos/a.mp4", "manifest.json", "thumbs/..jpg", "photos/a..b", null, "",
                "PHOTOS/a.jpg", "photos/a.jpg\u0000.txt", "photos/" + "x".repeat(121)})
            check(!MediaZip.safeEntry(bad), "abgelehnt: " + bad);
        check(MediaZip.safeName("a.jpg") && !MediaZip.safeName("") && !MediaZip.safeName(null) && !MediaZip.safeName("a/b"), "safeName");

        // 2. Teilnamen
        check(MediaZip.partName("2026-11-22", 1, 1).equals("Medien_2026-11-22.zip"), "ein Teil");
        check(MediaZip.partName("2026-11-22", 2, 3).equals("Medien_2026-11-22_Teil2.zip"), "Teil 2 von 3");

        // 3. Teilung
        List<MediaZip.Item> it = new ArrayList<>();
        for (int i = 0; i < 5; i++) it.add(new MediaZip.Item("photos/p" + i + ".jpg", 1000, 1, null));
        List<List<MediaZip.Item>> sp = MediaZip.split(it, 2500, 1000);
        check(sp.size() == 3 && sp.get(0).size() == 2 && sp.get(2).size() == 1, "1000-Byte-Dateien bei 2500: 2+2+1, war " + sp.size());
        check(MediaZip.split(it, 10_000_000, 2).size() == 3, "Eintragsgrenze teilt auch");
        check(MediaZip.split(new ArrayList<>(), 100, 10).isEmpty(), "nichts zu sichern: keine Teile");
        List<MediaZip.Item> gross = Arrays.asList(new MediaZip.Item("photos/a.jpg", 100, 1, null), new MediaZip.Item("photos/big.mp4", 5000, 1, null), new MediaZip.Item("photos/c.jpg", 100, 1, null));
        sp = MediaZip.split(gross, 1000, 100);
        check(sp.size() == 3 && sp.get(1).size() == 1 && sp.get(1).get(0).name.equals("photos/big.mp4"), "zu große Datei bekommt eigenen Teil");
        int total = 0;
        for (List<MediaZip.Item> p : MediaZip.split(it, 1300, 100)) total += p.size();
        check(total == 5, "jede Datei genau einmal");
        check(MediaZip.PART_LIMIT == 1536L * 1024 * 1024 && MediaZip.PART_LIMIT < 0xFFFFFFFFL, "Teil unter 4 GB");

        // 4. Echte Dateien: scannen, sortieren, „nur Neues“
        File root = Files.createTempDirectory("mzc").toFile();
        File ph = new File(root, "photos"), th = new File(root, "thumbs"), tmp = new File(root, "tmp");
        ph.mkdirs(); th.mkdirs();
        write(ph, "aaa.jpg", 3000, 1);
        write(ph, "bbbv.mp4", 7000, 2);
        write(th, "aaa.jpg", 400, 3);
        write(ph, "kaputt name.jpg", 10, 4);          // unsicherer Name: wird nicht gesichert
        new File(ph, "unterordner").mkdirs();
        List<MediaZip.Item> all = MediaZip.scan(ph, th);
        check(all.size() == 3, "3 sicherbare Dateien, war " + all.size());
        check(all.get(0).name.equals("photos/aaa.jpg") && all.get(1).name.equals("thumbs/aaa.jpg") && all.get(2).name.equals("photos/bbbv.mp4"), "Foto und Vorschaubild nebeneinander");
        check(MediaZip.bytes(all) == 10400, "Summe");
        check(MediaZip.pending(all, new HashSet<>()).size() == 3, "anfangs alles neu");

        // 5. Rundlauf mit kleinem Limit: zwei Teile, Fortschritt zählt 2 × Bytes
        List<List<MediaZip.Item>> parts = MediaZip.split(all, 4000, 100);
        check(parts.size() == 2 && parts.get(0).size() == 2 && parts.get(1).size() == 1, "kleines Limit: 2 Teile, war " + parts.size());
        final long[] prog = {0};
        MediaZip.Control ctl = new MediaZip.Control() { public boolean cancelled() { return false; } public void progress(long b) { prog[0] += b; } };
        List<byte[]> zips = new ArrayList<>();
        Set<String> done = new HashSet<>();
        for (int i = 0; i < parts.size(); i++) {
            ByteArrayOutputStream bo = new ByteArrayOutputStream();
            String man = MediaZip.manifest(parts.get(i), i + 1, parts.size(), 1700000000000L, "2.10.0");
            check(man.contains("\"teil\":" + (i + 1)) && man.contains("\"teile\":2") && man.contains("\"art\":\"medien\""), "Manifest " + man);
            MediaZip.write(bo, parts.get(i), man, ctl);
            zips.add(bo.toByteArray());
            for (MediaZip.Item x : parts.get(i)) done.add(x.key());
        }
        check(prog[0] == 2 * 10400, "Fortschritt 2 × Bytes, war " + prog[0]);
        // ohne Kompression: ZIP ist etwas größer als der Inhalt
        check(zips.get(0).length > 3400 && zips.get(0).length < 3400 + 1500, "STORED: Größe " + zips.get(0).length);
        try (ZipInputStream z = new ZipInputStream(new ByteArrayInputStream(zips.get(0)))) {
            ZipEntry e = z.getNextEntry();
            check(e.getName().equals("manifest.json") && e.getMethod() == ZipEntry.STORED, "Manifest zuerst");
            e = z.getNextEntry();
            check(e.getName().equals("photos/aaa.jpg") && e.getMethod() == ZipEntry.STORED && e.getSize() == 3000, "Eintrag ungepackt");
        }
        // Merkliste speichern/laden, danach nichts mehr neu; geänderte Datei wieder neu
        File st = new File(root, "state.txt");
        MediaZip.saveState(st, done, all);
        Set<String> back = MediaZip.loadState(st);
        check(back.equals(done) && MediaZip.pending(MediaZip.scan(ph, th), back).isEmpty(), "nach der Sicherung nichts neu");
        write(ph, "ccc.jpg", 500, 5);
        File b2 = new File(ph, "bbbv.mp4");
        b2.setLastModified(1800000000000L);
        List<MediaZip.Item> neu = MediaZip.pending(MediaZip.scan(ph, th), back);
        check(neu.size() == 2 && neu.get(0).name.equals("photos/bbbv.mp4") && neu.get(1).name.equals("photos/ccc.jpg"), "neu + geändert: " + neu.size());
        // gelöschte Dateien fallen aus der Merkliste
        MediaZip.saveState(st, back, MediaZip.scan(ph, th).subList(0, 1));
        check(MediaZip.loadState(st).size() == 1, "Merkliste nur für vorhandene Dateien");
        check(MediaZip.loadState(new File(root, "fehlt.txt")).isEmpty(), "fehlende Merkliste: leer");

        // 6. Wiederherstellen in ein leeres Gerät: beide Teile, Inhalt gleich, nichts übrig in tmp
        File r2 = new File(root, "neu"), ph2 = new File(r2, "photos"), th2 = new File(r2, "thumbs");
        int restored = 0;
        for (byte[] z : zips) {
            MediaZip.ReadResult rr = MediaZip.read(new ByteArrayInputStream(z), ph2, th2, tmp, null);
            check(rr.manifest && rr.rejected == 0 && rr.existing == 0, "Teil gelesen");
            restored += rr.restored;
        }
        check(restored == 3, "3 Dateien zurück, war " + restored);
        check(Arrays.equals(Files.readAllBytes(new File(ph2, "aaa.jpg").toPath()), Files.readAllBytes(new File(ph, "aaa.jpg").toPath())), "Foto gleich");
        check(Files.size(new File(ph2, "bbbv.mp4").toPath()) == 7000 && Files.size(new File(th2, "aaa.jpg").toPath()) == 400, "Video und Vorschaubild gleich groß");
        check(Math.abs(new File(ph2, "aaa.jpg").lastModified() - new File(ph, "aaa.jpg").lastModified()) <= 2000, "Änderungszeit (auf 2 s genau)");
        check(tmp.listFiles().length == 0, "keine Zwischendateien");
        // zweites Mal: alles schon da, nichts überschrieben
        Files.write(new File(ph2, "aaa.jpg").toPath(), new byte[]{1, 2, 3});
        MediaZip.ReadResult again = MediaZip.read(new ByteArrayInputStream(zips.get(0)), ph2, th2, tmp, null);
        check(again.restored == 0 && again.existing == 2 && Files.size(new File(ph2, "aaa.jpg").toPath()) == 3, "vorhandene Kennungen nicht überschrieben");

        // 7. Böses ZIP: Zip-Slip-Namen werden übersprungen, gute Einträge kommen trotzdem
        ByteArrayOutputStream evil = new ByteArrayOutputStream();
        try (ZipOutputStream z = new ZipOutputStream(evil)) {
            for (String nm : new String[]{"../../boese.jpg", "photos/../../boese2.jpg", "photos/sub/x.jpg", "andere/x.jpg", "photos/gut.jpg"}) {
                z.putNextEntry(new ZipEntry(nm));
                z.write("x".getBytes());
                z.closeEntry();
            }
        }
        File r3 = new File(root, "evil");
        MediaZip.ReadResult er = MediaZip.read(new ByteArrayInputStream(evil.toByteArray()), new File(r3, "photos"), new File(r3, "thumbs"), tmp, null);
        check(er.rejected == 4 && er.restored == 1 && !er.manifest, "Zip Slip abgelehnt: " + er.rejected + "/" + er.restored);
        check(!new File(root, "boese.jpg").exists() && !new File(r3, "boese2.jpg").exists() && !new File(root.getParentFile(), "boese.jpg").exists(), "nichts außerhalb geschrieben");
        check(new File(r3, "photos/gut.jpg").isFile(), "guter Eintrag da");

        // 8. Abbruch beim Schreiben und beim Lesen
        final int[] calls = {0};
        MediaZip.Control stop = new MediaZip.Control() { public boolean cancelled() { return calls[0] > 2; } public void progress(long b) { calls[0]++; } };
        boolean threw = false;
        try { MediaZip.write(new ByteArrayOutputStream(), all, "{}", stop); } catch (MediaZip.CancelledException e) { threw = true; }
        check(threw, "Abbruch beim Schreiben");
        final long[] gelesen = {0};
        MediaZip.Control stop2 = new MediaZip.Control() { public boolean cancelled() { return gelesen[0] >= 5000; } public void progress(long b) { gelesen[0] += b; } };
        java.io.InputStream tropf = new java.io.FilterInputStream(new ByteArrayInputStream(zips.get(1))) {      // höchstens 1000 Bytes je Lesen: Abbruch mitten im Video
            @Override public int read(byte[] b, int off, int len) throws java.io.IOException { return super.read(b, off, Math.min(len, 1000)); }
        };
        threw = false;
        File r4 = new File(root, "abbruch");
        try { MediaZip.read(new MediaZip.CountingInputStream(tropf, stop2), new File(r4, "photos"), new File(r4, "thumbs"), tmp, stop2); }
        catch (MediaZip.CancelledException e) { threw = true; }
        check(threw && gelesen[0] < 7000 && !new File(r4, "photos/bbbv.mp4").exists() && tmp.listFiles().length == 0, "Abbruch beim Lesen: keine halbe Datei (" + threw + ", " + gelesen[0] + ")");

        // 9. Beschädigtes ZIP (Inhalt verändert): Fehler, keine Datei
        byte[] bad = zips.get(1).clone();
        int pos = -1;
        for (int i = 0; i < bad.length - 8; i++) if (bad[i] == 'b' && bad[i + 1] == 'b' && bad[i + 2] == 'b' && bad[i + 3] == 'v') { pos = i + 40; break; }
        bad[pos + 100] ^= 0x55;
        threw = false;
        File r5 = new File(root, "kaputt");
        try { MediaZip.read(new ByteArrayInputStream(bad), new File(r5, "photos"), new File(r5, "thumbs"), tmp, null); } catch (java.io.IOException e) { threw = true; }
        check(threw && !new File(r5, "photos/bbbv.mp4").exists(), "falsche Prüfsumme erkannt");

        // 10. Automatische .mtl-Sicherungen: die neuesten 5 bleiben, fremde Dateien nie
        List<String> names = new ArrayList<>(Arrays.asList("Tourentagebuch-Auto-2026-11-01.mtl", "Tourentagebuch-Auto-2026-11-22.mtl", "Tourentagebuch-Auto-2026-10-30.mtl",
                "Tourentagebuch-Auto-2026-11-15.mtl", "Tourentagebuch-Auto-2026-11-20.mtl", "Tourentagebuch-Auto-2026-11-21.mtl", "Tourentagebuch-Sicherung-2020-01-01.mtl",
                "Medien_2026-11-22.zip", "Tourentagebuch-Auto-2026-11-02.mtl.txt"));
        List<String> del = MediaZip.toDelete(names, "Tourentagebuch-Auto-", ".mtl", 5);
        check(del.size() == 1 && del.get(0).equals("Tourentagebuch-Auto-2026-10-30.mtl"), "älteste löschen: " + del);
        check(MediaZip.toDelete(names.subList(0, 3), "Tourentagebuch-Auto-", ".mtl", 5).isEmpty(), "unter 5: nichts löschen");
        check(MediaZip.toDelete(names, "Tourentagebuch-Auto-", ".mtl", 2).size() == 4, "keep 2");

        rm(root);
        System.out.println("MediaZipCheck OK (" + n + " Prüfungen)");
    }
}
