import de.tourentagebuch.app.PicturePlan;

/** 2.13.0: „In Galerie speichern“ (Tour als Bild) – Dateiname, Dateityp, Android-Version – ohne Gerät prüfen. */
public class PicturePlanCheck {
    static void check(boolean ok, String msg) {
        if (!ok) { System.err.println("FEHLER: " + msg); System.exit(1); }
    }

    public static void main(String[] a) {
        check(!PicturePlan.supported(26) && !PicturePlan.supported(28) && PicturePlan.supported(29) && PicturePlan.supported(34), "ab Android 10");
        check("image/jpeg".equals(PicturePlan.mime("image/jpeg")) && "image/png".equals(PicturePlan.mime("image/png")), "JPEG und PNG");
        check(PicturePlan.mime("text/html") == null && PicturePlan.mime(null) == null && PicturePlan.mime("image/svg+xml") == null, "andere Typen nicht");
        check("Tourentagebuch-Tour_Grat.jpg".equals(PicturePlan.fileName("Tourentagebuch-Tour_Grat.jpg", "image/jpeg")), "normaler Name bleibt");
        check("passwd.jpg".equals(PicturePlan.fileName("../../etc/passwd", "image/jpeg")), "kein Pfad: " + PicturePlan.fileName("../../etc/passwd", "image/jpeg"));
        check("Bild.png".equals(PicturePlan.fileName("Bild.jpg", "image/png")), "Endung passend zum Typ");
        check("Tourentagebuch.jpg".equals(PicturePlan.fileName("...", "image/jpeg")) && "Tourentagebuch.jpg".equals(PicturePlan.fileName(null, "image/jpeg")), "leerer Name");
        check("_ber_den_Grat.jpg".equals(PicturePlan.fileName("Über den Grat", "image/jpeg")), "Sonderzeichen: " + PicturePlan.fileName("Über den Grat", "image/jpeg"));
        StringBuilder sb = new StringBuilder(); for (int i = 0; i < 300; i++) sb.append('x');
        check(PicturePlan.fileName(sb.toString(), "image/jpeg").length() == 100 && PicturePlan.fileName(sb.toString(), "image/jpeg").endsWith(".jpg"), "höchstens 100 Zeichen");
        check("Pictures/Tourentagebuch/a.jpg".equals(PicturePlan.shownPath("a.jpg")), "Anzeige");
        System.out.println("PicturePlanCheck OK");
    }
}
