import de.tourentagebuch.app.UploadRoute;

/** Prüft die Wegeentscheidung des WLAN-Empfangs ohne Android: vor allem, dass eine Adresse ohne
 * abschließenden Schrägstrich weitergeleitet statt mit „Nicht gefunden“ abgewiesen wird. */
public class UploadServerCheck {
    static void check(boolean ok, String msg) { if (!ok) { System.out.println("FEHLER: " + msg); System.exit(1); } }

    public static void main(String[] a) {
        String t = "ab3xk";
        check(UploadRoute.decide("GET", "/" + t, t) == UploadRoute.REDIRECT, "Adresse ohne Schrägstrich muss weiterleiten");
        check(UploadRoute.decide("GET", "/" + t + "/", t) == UploadRoute.PAGE, "Adresse mit Schrägstrich muss die Seite liefern");
        check(UploadRoute.decide("POST", "/" + t + "/up", t) == UploadRoute.UPLOAD, "Hochladen muss erkannt werden");
        check(UploadRoute.decide("GET", "/" + t + "/up", t) == UploadRoute.NOT_FOUND, "GET auf /up ist kein Hochladen");
        check(UploadRoute.decide("GET", "/anders", t) == UploadRoute.NOT_FOUND, "falsches Kennwort muss abgelehnt werden");
        check(UploadRoute.decide("GET", "/" + t + "x", t) == UploadRoute.NOT_FOUND, "Pfad, der nur mit dem Kennwort beginnt, darf nicht reichen");
        check(UploadRoute.decide("GET", "/", t) == UploadRoute.NOT_FOUND, "leerer Pfad ohne Kennwort muss abgelehnt werden");
        System.out.println("OK");
    }
}
