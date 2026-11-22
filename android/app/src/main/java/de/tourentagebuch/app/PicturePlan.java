package de.tourentagebuch.app;

/**
 * 2.13.0: Regeln für „In Galerie speichern“ (Tour als Bild): Dateiname, Dateityp und ab welcher Android-Version es geht.
 * Ohne Android-Klassen, damit tests/android/PicturePlanCheck.java es ohne Gerät prüfen kann. Das Einfügen in MediaStore steht in MainActivity.saveImage.
 */
public final class PicturePlan {
    private PicturePlan() {}

    /** Ab Android 10 (API 29) braucht das Einfügen in MediaStore keine Berechtigung; darunter wird nur geteilt. */
    public static final int MIN_SDK = 29;
    /** Unterordner in „Pictures“. */
    public static final String SUBDIR = "Tourentagebuch";

    public static boolean supported(int sdk) { return sdk >= MIN_SDK; }

    /** Nur JPEG und PNG; alles andere wird abgelehnt (null). */
    public static String mime(String m) {
        if ("image/jpeg".equals(m) || "image/png".equals(m)) return m;
        return null;
    }

    /** Sicherer Dateiname: nur A–Z, a–z, 0–9, Punkt, Unterstrich, Bindestrich; ohne Pfad; Endung passend zum Typ; höchstens 100 Zeichen. */
    public static String fileName(String name, String mime) {
        String n = name == null ? "" : name;
        int s = Math.max(n.lastIndexOf('/'), n.lastIndexOf('\\'));
        if (s >= 0) n = n.substring(s + 1);
        n = n.replaceAll("[^A-Za-z0-9._-]", "_").replaceAll("^\\.+", "");
        String ext = "image/png".equals(mime) ? ".png" : ".jpg";
        String low = n.toLowerCase(java.util.Locale.ROOT);
        if (low.endsWith(".jpg") || low.endsWith(".jpeg") || low.endsWith(".png")) n = n.substring(0, n.lastIndexOf('.'));
        if (n.isEmpty()) n = "Tourentagebuch";
        if (n.length() > 100 - ext.length()) n = n.substring(0, 100 - ext.length());
        return n + ext;
    }

    /** Anzeige des Speicherorts: „Pictures/Tourentagebuch/<Name>“. */
    public static String shownPath(String file) { return "Pictures/" + SUBDIR + "/" + file; }
}
