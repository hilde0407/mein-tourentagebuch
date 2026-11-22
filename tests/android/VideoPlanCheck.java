import de.tourentagebuch.app.VideoPlan;

/** 2.7.1: Entscheidungen der Video-Umwandlung (HEVC → H.264) ohne Gerät prüfen. */
public class VideoPlanCheck {
    static void check(boolean ok, String msg) {
        if (!ok) { System.err.println("FEHLER: " + msg); System.exit(1); }
    }

    public static void main(String[] a) {
        // Nur HEVC wird umgewandelt
        check(VideoPlan.needsConvert("video/hevc"), "video/hevc");
        check(VideoPlan.needsConvert(" VIDEO/HEVC "), "Groß/Leerzeichen");
        check(VideoPlan.needsConvert("video/x-hevc"), "video/x-hevc");
        check(!VideoPlan.needsConvert("video/avc"), "H.264 bleibt");
        check(!VideoPlan.needsConvert("video/mp4v-es"), "MPEG-4 bleibt");
        check(!VideoPlan.needsConvert(""), "leer");
        check(!VideoPlan.needsConvert(null), "null");

        // Größe: passt sie, bleibt sie genau
        int[] s = VideoPlan.size(1920, 1080, 4096, 2304);
        check(s[0] == 1920 && s[1] == 1080, "1080p bleibt: " + s[0] + "x" + s[1]);
        s = VideoPlan.size(3840, 2160, 3840, 2160);
        check(s[0] == 3840 && s[1] == 2160, "4K bleibt bei 4K-Encoder");
        // Hochformat gespeichert (selten): Grenzen gelten für lange/kurze Seite
        s = VideoPlan.size(1080, 1920, 1920, 1088);
        check(s[0] == 1080 && s[1] == 1920, "Hochformat bleibt: " + s[0] + "x" + s[1]);
        // zu groß für den Encoder: verkleinert, Seitenverhältnis bleibt, gerade Zahlen
        s = VideoPlan.size(3840, 2160, 1920, 1088);
        check(s[0] <= 1920 && s[1] <= 1088 && s[0] % 2 == 0 && s[1] % 2 == 0, "4K auf 1080p-Encoder: " + s[0] + "x" + s[1]);
        check(Math.abs((double) s[0] / s[1] - 16.0 / 9) < 0.01, "Seitenverhältnis: " + s[0] + "x" + s[1]);
        // nie größer als das Original, auch bei großzügigen Grenzen; ungerade wird gerade (nach unten)
        s = VideoPlan.size(1281, 721, 99999, 99999);
        check(s[0] == 1280 && s[1] == 720, "ungerade: " + s[0] + "x" + s[1]);
        s = VideoPlan.size(640, 480, 0, 0);
        check(s[0] == 640 && s[1] == 480, "ohne Grenzen");
        s = VideoPlan.size(0, 480, 1920, 1080);
        check(s[0] == 0 && s[1] == 0, "unbekannte Größe");

        // Datenrate: nie über dem Original
        int b = VideoPlan.bitrate(12_000_000, 1920, 1080, 1920, 1080, 30, 0);
        check(b == 12_000_000, "gleiche Größe, gleiche Rate: " + b);
        b = VideoPlan.bitrate(40_000_000, 3840, 2160, 1920, 1080, 30, 0);
        check(b <= 40_000_000 / 3 && b >= 40_000_000 / 5, "verkleinert: anteilig weniger: " + b);
        b = VideoPlan.bitrate(12_000_000, 1920, 1080, 1920, 1080, 30, 8_000_000);
        check(b == 8_000_000, "Encodergrenze: " + b);
        b = VideoPlan.bitrate(100_000, 320, 240, 320, 240, 30, 0);
        check(b <= 100_000, "sehr kleines Original bleibt darunter: " + b);
        b = VideoPlan.bitrate(0, 1920, 1080, 1920, 1080, 30, 0);
        check(b > 2_000_000 && b < 20_000_000, "unbekannt: geschätzt: " + b);
        b = VideoPlan.bitrate(0, 1920, 1080, 1920, 1080, 0, 0);
        check(b > 2_000_000 && b < 20_000_000, "unbekannte Bildrate: " + b);

        // Fortschritt
        check(VideoPlan.percent(0, 1000) == 0, "Anfang");
        check(VideoPlan.percent(500, 1000) == 50, "Mitte");
        check(VideoPlan.percent(2000, 1000) == 100, "über Ende");
        check(VideoPlan.percent(500, 0) == 0, "Dauer unbekannt");

        // 2.9.0: Vorschaubild bei etwa 1 s, kurze Videos in der Mitte
        check(VideoPlan.thumbTimeUs(35_000) == 1_000_000L, "langes Video: 1 s");
        check(VideoPlan.thumbTimeUs(2000) == 1_000_000L, "2 s: 1 s");
        check(VideoPlan.thumbTimeUs(1000) == 500_000L, "1 s: Mitte");
        check(VideoPlan.thumbTimeUs(0) == 1_000_000L, "unbekannt: 1 s versuchen");
        // Längenbegrenzung
        check(VideoPlan.limitSeconds("30") == 30 && VideoPlan.limitSeconds("120") == 120 && VideoPlan.limitSeconds("300") == 300, "Grenzen");
        check(VideoPlan.limitSeconds("0") == 0, "unbegrenzt");
        check(VideoPlan.limitSeconds(null) == 120 && VideoPlan.limitSeconds("abc") == 120 && VideoPlan.limitSeconds("") == 120, "unbekannt: wie bisher 120");
        // Bildschirmlage
        check(VideoPlan.orientation(1920, 1080) == 1 && VideoPlan.orientation(1080, 1920) == 2, "quer/hoch");
        check(VideoPlan.orientation(0, 1080) == 0 && VideoPlan.orientation(500, 500) == 0, "unbekannt/quadratisch");
        // Galerie-Name
        String gn = VideoPlan.galleryName("a1b2c3d4e5f6v", 1_700_000_000_000L, java.util.TimeZone.getTimeZone("UTC"));
        check(gn.equals("Tourentagebuch_20231114_221320_a1b2c3.mp4"), "Galerie-Name: " + gn);
        check(VideoPlan.galleryName("../x", 1_700_000_000_000L, java.util.TimeZone.getTimeZone("UTC")).equals("Tourentagebuch_20231114_221320_x.mp4"), "Name ohne Pfadzeichen");

        // 2.12.0: Zuschneiden ohne Neu-Kodierung (gleiche Zahlen in tests/test_calc.js für calc-video.js)
        long[] keys = {0, 2_000_000L, 4_000_000L, 6_000_000L, 8_000_000L};
        check(VideoPlan.trimStartUs(keys, 3_200_000L) == 2_000_000L, "Start auf das Schlüsselbild davor");
        check(VideoPlan.trimStartUs(keys, 4_000_000L) == 4_000_000L, "Start genau auf einem Schlüsselbild");
        check(VideoPlan.trimStartUs(keys, 0) == 0 && VideoPlan.trimStartUs(keys, 99_000_000L) == 8_000_000L, "Anfang/hinter dem letzten");
        check(VideoPlan.trimStartUs(new long[]{500_000L, 3_000_000L}, 200_000L) == 500_000L, "vor dem ersten Schlüsselbild: das erste");
        check(VideoPlan.trimStartUs(null, 3_000_000L) == 0 && VideoPlan.trimStartUs(new long[0], 3_000_000L) == 0, "ohne Schlüsselbilder: Anfang");
        check(VideoPlan.trimEndUs(10_000_000L, 7_300_000L) == 7_300_000L && VideoPlan.trimEndUs(10_000_000L, 12_000_000L) == 10_000_000L && VideoPlan.trimEndUs(10_000_000L, 0) == 10_000_000L, "Ende genau, höchstens Länge");
        check(VideoPlan.trimOk(2_000_000L, 7_300_000L, 10_000_000L), "gültiger Schnitt");
        check(!VideoPlan.trimOk(2_000_000L, 2_900_000L, 10_000_000L), "unter 1 s");
        check(VideoPlan.trimOk(2_000_000L, 3_000_000L, 10_000_000L), "genau 1 s");
        check(!VideoPlan.trimOk(0, 10_000_000L, 10_000_000L), "ganzes Video: kein Schnitt");
        check(!VideoPlan.trimOk(10_000_000L, 12_000_000L, 10_000_000L) && !VideoPlan.trimOk(5_000_000L, 4_000_000L, 10_000_000L), "hinter dem Ende/verkehrt");
        check(VideoPlan.timeLabel(3_249).equals("0:03,2") && VideoPlan.timeLabel(0).equals("0:00,0") && VideoPlan.timeLabel(125_000).equals("2:05,0"), "Zeit: " + VideoPlan.timeLabel(3_249));
        check(VideoPlan.timeLabel(3_723_400).equals("1:02:03,4") && VideoPlan.timeLabel(-5).equals("0:00,0"), "Zeit ab einer Stunde: " + VideoPlan.timeLabel(3_723_400));
        java.util.List<String> todo = VideoPlan.galleryTodo(java.util.Arrays.asList("av", "bv", "av", "cv", "", null), new java.util.HashSet<>(java.util.Arrays.asList("bv")));
        check(todo.equals(java.util.Arrays.asList("av", "cv")), "Galerie: nur noch nicht kopierte, nicht doppelt: " + todo);
        check(VideoPlan.galleryTodo(null, null).isEmpty() && VideoPlan.galleryTodo(java.util.Arrays.asList("xv"), null).size() == 1, "Galerie: leer/ohne Merkliste");

        System.out.println("VideoPlanCheck OK");
    }
}
