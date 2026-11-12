package de.tourentagebuch.app;

/**
 * Reine Entscheidungslogik des WLAN-Empfangs (siehe UploadServer): aus Methode, angefragtem Pfad und dem
 * aktuell gültigen Kennwort wird entschieden, was zu tun ist. Ohne jeden Android-Bezug, damit sich das
 * Verhalten – insbesondere die Weiterleitung einer Adresse ohne abschließenden Schrägstrich – mit einem
 * einfachen Test prüfen lässt (tests/android/UploadServerCheck.java), ohne das Android-SDK zu brauchen.
 */
public final class UploadRoute {
    private UploadRoute() { }

    public static final int NOT_FOUND = 0, REDIRECT = 1, PAGE = 2, UPLOAD = 3;

    public static int decide(String method, String path, String tok) {
        String bare = "/" + tok, base = bare + "/";
        // Browser lassen den abschließenden Schrägstrich beim Anzeigen oder Kopieren der Adresse gerne weg;
        // ohne diese Weiterleitung kam dafür bisher sofort „Nicht gefunden“.
        if ("GET".equals(method) && path.equals(bare)) return REDIRECT;
        if (!path.startsWith(base)) return NOT_FOUND;
        String rest = path.substring(base.length());
        if ("GET".equals(method) && rest.isEmpty()) return PAGE;
        if ("POST".equals(method) && rest.equals("up")) return UPLOAD;
        return NOT_FOUND;
    }
}
