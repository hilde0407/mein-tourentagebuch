import de.tourentagebuch.app.ImagePlan;

/** 2.8.0: Größenentscheidungen beim Foto-Import (Panoramen, Speicherschutz) ohne Gerät prüfen. */
public class ImagePlanCheck {
    static void check(boolean ok, String msg) {
        if (!ok) { System.err.println("FEHLER: " + msg); System.exit(1); }
    }

    public static void main(String[] a) {
        // Panorama-Erkennung: deutlich über 2,2 : 1 (quer und hoch), normale Fotos nicht
        check(ImagePlan.isPano(12000, 3000), "12000x3000 ist Panorama");
        check(ImagePlan.isPano(3000, 12000), "hochkant ist auch Panorama");
        check(ImagePlan.isPano(6000, 1200), "6000x1200");
        check(!ImagePlan.isPano(4000, 3000), "4:3 nicht");
        check(!ImagePlan.isPano(4000, 2250), "16:9 nicht");
        check(!ImagePlan.isPano(2000, 1000), "2:1 nicht");
        check(!ImagePlan.isPano(0, 0) && !ImagePlan.isPano(-1, -1), "unbekannte Größe nicht");

        // Lange Seite der gespeicherten Kopie
        int[] s = ImagePlan.outSize(12000, 3000);
        check(s[0] == 4096 && s[1] == 1024, "Panorama auf 4096: " + s[0] + "x" + s[1]);
        s = ImagePlan.outSize(4000, 3000);
        check(s[0] == 2400 && s[1] == 1800, "normal auf 2400: " + s[0] + "x" + s[1]);
        s = ImagePlan.outSize(1600, 1200);
        check(s[0] == 1600 && s[1] == 1200, "kleines Bild bleibt");
        s = ImagePlan.outSize(3000, 800);
        check(s[0] == 3000 && s[1] == 800, "kleines Panorama bleibt");

        // inSampleSize: nie unter die Zielgröße halbieren, Speicher begrenzen
        int ss = ImagePlan.sampleSize(12000, 3000, 4096, ImagePlan.MAX_DECODE_PIXELS);
        check(ss == 2, "12000x3000 → inSampleSize 2, war " + ss);
        check(12000 / ss >= 4096, "dekodiert noch breit genug");
        ss = ImagePlan.sampleSize(40000, 5000, 4096, ImagePlan.MAX_DECODE_PIXELS);
        check(40000 / ss >= 4096 && 40000 / (ss * 2) < 4096, "40000x5000 → " + ss);
        ss = ImagePlan.sampleSize(4000, 3000, 2400, ImagePlan.MAX_DECODE_PIXELS);
        check(ss == 1, "12 MP normal unverändert: " + ss);
        ss = ImagePlan.sampleSize(8000, 6000, 2400, ImagePlan.MAX_DECODE_PIXELS);
        check(ss == 2, "48 MP → 2: " + ss);
        // Speicher: auch ohne Größenvorgabe nie mehr als MAX_DECODE_PIXELS
        for (int[] d : new int[][]{{12000, 3000}, {20000, 20000}, {9000, 9000}, {100000, 3000}}) {
            int q = ImagePlan.sampleSize(d[0], d[1], Integer.MAX_VALUE, ImagePlan.MAX_DECODE_PIXELS);
            check((long) (d[0] / q) * (d[1] / q) <= ImagePlan.MAX_DECODE_PIXELS, "Speichergrenze " + d[0] + "x" + d[1] + " ss=" + q);
        }
        check(ImagePlan.sampleSize(0, 0, 2400, ImagePlan.MAX_DECODE_PIXELS) == 1, "unlesbare Größe → 1");

        // Vorschaubild: normal lange Seite 480; Panorama kurze Seite 240, lange höchstens 1200
        s = ImagePlan.thumbSize(2400, 1800);
        check(s[0] == 480 && s[1] == 360, "normales Vorschaubild: " + s[0] + "x" + s[1]);
        s = ImagePlan.thumbSize(4096, 1024);
        check(s[1] == 240 && s[0] == 960, "Panorama-Vorschau: " + s[0] + "x" + s[1]);
        s = ImagePlan.thumbSize(4096, 400);
        check(s[0] <= 1200 && s[1] >= 100, "sehr schmales Panorama: " + s[0] + "x" + s[1]);
        s = ImagePlan.thumbSize(300, 200);
        check(s[0] == 300 && s[1] == 200, "kleines Bild nicht vergrößert");
        System.out.println("ImagePlanCheck OK");
    }
}
