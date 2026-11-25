package de.tourentagebuch.app;

import android.content.Context;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.util.BitSet;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * 2.18.1: Abgleich von Notizen, Fotos und Videos mit Meine Touren als Auftrag in der Hülle. Bis 2.18.0 lief die Schleife über alle Fotos in der Oberfläche
 * (ein Aufruf je Foto). Die WebView wird bei ausgeschaltetem Bildschirm gedrosselt oder angehalten – dann stand der Abgleich, bis das Handy wieder an war.
 *
 * Jetzt: Die Oberfläche (js/abgleich-medien.js) baut den Plan (Liste der Schritte, MedienCalc.auftrag) und übergibt ihn mit mtAbgleichStart. Ein Thread im
 * Vordergrunddienst {@link MtAbgleichService} (Wake-Lock, WLAN-Sperre, Benachrichtigung mit Abbrechen) arbeitet die Schritte ab. Jedes Ergebnis kommt als Zeile
 * ins Journal (filesDir/mtabgleich/ergebnisse.txt, fsync); die Oberfläche holt die Ergebnisse mit mtAbgleichStand ab, sobald sie läuft, und schreibt sie in
 * ihre Datenbank (IndexedDB). Was sie schon übernommen hat, merkt sie sich selbst (Zahl der Zeilen); die Übernahme ist wiederholbar ohne Schaden.
 * Ende: ende.txt = fertig | abgebrochen | relogin (401) | verboten (403) | wlan (zu lange kein WLAN). Fehlt ende.txt, obwohl nichts läuft, wurde der Dienst
 * beendet (Prozess vom System beendet) – die Oberfläche bietet dann „Abgleich fortsetzen?“ an (mtAbgleichFortsetzen). Erst mtAbgleichVerwerfen löscht den Plan.
 * Das Sitzungs-Cookie steht nur im Speicher, nie in einer Datei.
 */
final class MtAbgleich {
    private MtAbgleich() { }

    private static final long WLAN_WARTEN = 30 * 60 * 1000L;      // so lange auf WLAN warten, dann anhalten (fortsetzbar)
    private static final int MAX_JE_ABRUF = 150;                  // Ergebnisse je mtAbgleichStand

    private static final Object schlaf = new Object();
    private static volatile boolean running, cancel, still;
    private static String cookie = "", text = "";
    private static int pos;
    private static long bytesDone, bytesTotal;
    private static boolean wartetWlan;

    static File dir(Context c) { return new File(c.getFilesDir(), "mtabgleich"); }
    private static File planDatei(Context c) { return new File(dir(c), "auftrag.json"); }
    private static File journal(Context c) { return new File(dir(c), "ergebnisse.txt"); }
    private static File endeDatei(Context c) { return new File(dir(c), "ende.txt"); }

    static boolean isRunning() { return running; }

    /** {jobId, titel, wifiOnly, wlanFotos, cookie, tasks:[…]} → {started} oder {started:false, error}. */
    static synchronized JSONObject start(Context c, JSONObject a) throws Exception {
        if (running) return new JSONObject().put("started", false).put("error", "Abgleich läuft schon");
        JSONArray tasks = a.optJSONArray("tasks");
        if (tasks == null || tasks.length() == 0) return new JSONObject().put("started", false).put("error", "Nichts zu tun.");
        for (int i = 0; i < tasks.length(); i++) tasks.getJSONObject(i).remove("cookie");
        JSONObject plan = new JSONObject().put("jobId", a.getString("jobId")).put("titel", a.optString("titel", "Mit Meine Touren abgleichen"))
                .put("wifiOnly", a.optBoolean("wifiOnly", true)).put("wlanFotos", a.optBoolean("wlanFotos", false)).put("start", System.currentTimeMillis()).put("tasks", tasks);
        File d = dir(c);
        d.mkdirs();
        journal(c).delete();
        endeDatei(c).delete();
        MtAuftrag.schreibeSicher(planDatei(c), plan.toString());
        return los(c, a.optString("cookie"));
    }

    /** Unterbrochenen Auftrag weiterführen. {cookie, wifiOnly?}. */
    static synchronized JSONObject fortsetzen(Context c, JSONObject a) throws Exception {
        if (running) return new JSONObject().put("started", false).put("error", "Abgleich läuft schon");
        String p = MtAuftrag.text(planDatei(c));
        if (p == null) return new JSONObject().put("started", false).put("error", "Es gibt keinen unterbrochenen Abgleich.");
        String e = MtAuftrag.text(endeDatei(c));
        if (e != null && !e.trim().equals("wlan")) return new JSONObject().put("started", false).put("error", "Dieser Abgleich ist schon beendet.");
        if (a.has("wifiOnly")) MtAuftrag.schreibeSicher(planDatei(c), new JSONObject(p).put("wifiOnly", a.optBoolean("wifiOnly", true)).toString());
        endeDatei(c).delete();
        return los(c, a.optString("cookie"));
    }

    private static JSONObject los(Context c, String ck) throws Exception {
        cookie = ck == null ? "" : ck;
        cancel = false; still = false; running = true; wartetWlan = false;
        text = "Wird gestartet …"; pos = 0; bytesDone = 0; bytesTotal = 0;
        try {
            MtAbgleichService.start(c);
        } catch (Exception ex) {
            running = false;
            AppLog.log("Meine Touren Abgleich: Dienst " + ex);
            return new JSONObject().put("started", false).put("error", "Der Hintergrunddienst ließ sich nicht starten. Bitte die App im Vordergrund lassen und noch einmal versuchen.");
        }
        return new JSONObject().put("started", true);
    }

    /** Abbrechen (Knopf in der Oberfläche oder in der Benachrichtigung): der Auftrag endet mit „abgebrochen“. */
    static void cancel() { cancel = true; synchronized (schlaf) { schlaf.notifyAll(); } }

    /** Der Dienst wird beendet (System): anhalten, ohne „abgebrochen“ zu schreiben – der Auftrag bleibt fortsetzbar. */
    static void anhalten() { still = true; cancel(); }

    /** {ab: Zahl der schon übernommenen Zeilen} → Stand und die Ergebnisse ab dieser Zeile (je Ergebnis mit dem Schritt „a“). */
    static synchronized JSONObject stand(Context c, JSONObject a) throws Exception {
        JSONObject out = new JSONObject().put("running", running);
        String p = MtAuftrag.text(planDatei(c));
        if (p == null) return out.put("da", false);
        JSONObject plan = new JSONObject(p);
        JSONArray tasks = plan.getJSONArray("tasks");
        List<String> zeilen = MtAuftrag.lesen(journal(c));
        int ab = Math.max(0, a.optInt("ab", 0));
        JSONArray erg = new JSONArray();
        for (int k = ab; k < zeilen.size() && erg.length() < MAX_JE_ABRUF; k++) {
            String z = zeilen.get(k);
            int i = MtAuftrag.nummer(z);
            JSONObject e;
            try { e = new JSONObject(MtAuftrag.json(z)); } catch (Exception ex) { e = new JSONObject().put("status", 0).put("fehler", "Ergebnis unlesbar"); }
            e.put("i", i).put("a", i >= 0 && i < tasks.length() ? tasks.getJSONObject(i) : JSONObject.NULL);
            erg.put(e);
        }
        String ende = MtAuftrag.text(endeDatei(c));
        out.put("da", true).put("jobId", plan.optString("jobId")).put("titel", plan.optString("titel")).put("n", tasks.length()).put("fertig", MtAuftrag.erledigt(zeilen).cardinality())
                .put("zeilen", zeilen.size()).put("ende", ende == null ? JSONObject.NULL : ende.trim()).put("ergebnisse", erg).put("mehr", ab + erg.length() < zeilen.size());
        synchronized (MtAbgleich.class) {
            out.put("text", running ? text : "").put("pos", pos).put("bytesDone", bytesDone).put("bytesTotal", bytesTotal).put("wartetWlan", running && wartetWlan);
        }
        return out;
    }

    /** Plan und Ergebnisse löschen (nachdem die Oberfläche alles übernommen hat oder nicht fortsetzen will). */
    static synchronized JSONObject verwerfen(Context c) throws Exception {
        if (running) return new JSONObject().put("ok", false);
        File d = dir(c);
        File[] fs = d.listFiles();
        if (fs != null) for (File f : fs) f.delete();
        d.delete();
        return new JSONObject().put("ok", true);
    }

    private static synchronized void setze(int i, String t) { pos = i; text = t; bytesDone = 0; bytesTotal = 0; }
    private static synchronized void bytes(long d, long t) { bytesDone = d; bytesTotal = t; }
    private static synchronized void wlan(boolean w) { wartetWlan = w; }

    /** Warten (Wiederholung, WLAN); false = abgebrochen. Mit dem Wake-Lock des Dienstes läuft die Uhr auch bei aus­geschaltetem Bildschirm. */
    private static boolean schlafe(long ms) {
        long bis = System.currentTimeMillis() + ms;
        synchronized (schlaf) {
            while (!cancel) {
                long r = bis - System.currentTimeMillis();
                if (r <= 0) return true;
                try { schlaf.wait(r); } catch (InterruptedException e) { return false; }
            }
        }
        return false;
    }

    /** Thread des Dienstes: alle offenen Schritte nacheinander. */
    static void lauf(Context c, MtAbgleichService svc) {
        String ende = null;
        int ok = 0, fehl = 0, n = 0;
        try {
            JSONObject plan = new JSONObject(MtAuftrag.text(planDatei(c)));
            JSONArray tasks = plan.getJSONArray("tasks");
            n = tasks.length();
            boolean wifiOnly = plan.optBoolean("wifiOnly", true), wlanFotos = plan.optBoolean("wlanFotos", false);
            List<String> zeilen = MtAuftrag.lesen(journal(c));
            BitSet done = MtAuftrag.erledigt(zeilen);
            Set<String> geholt = new HashSet<>();
            for (String z : zeilen) {
                try {
                    JSONObject e = new JSONObject(MtAuftrag.json(z));
                    if (e.optInt("status") == 200 && !e.has("fehler")) ok++; else fehl++;
                    if (e.has("id")) geholt.add(e.optString("id"));
                    if (e.optJSONObject("result") != null) geholt.add(e.getJSONObject("result").optString("id"));
                } catch (Exception ex) { fehl++; }
            }
            for (int i = MtAuftrag.naechster(n, done); i >= 0; i = MtAuftrag.naechster(n, done)) {
                if (cancel) { ende = "abgebrochen"; break; }
                JSONObject t = tasks.getJSONObject(i);
                String art = t.optString("art"), basis = MtAuftrag.zeile(i, n, t.optString("tname"), art);
                setze(i, basis);
                svc.melde(basis, i, n, false);
                boolean brauchtWlan = wifiOnly && (art.startsWith("video") || (wlanFotos && art.startsWith("foto")));
                if (brauchtWlan && !TileDownload.onWifi(c) && !warteAufWlan(c, svc, basis, i, n)) { ende = cancel ? "abgebrochen" : "wlan"; break; }
                JSONObject e = schritt(c, t, geholt, svc, basis, i, n);
                if (e == null) { ende = "abgebrochen"; break; }
                MtAuftrag.anhaengen(journal(c), i, e.toString());
                done.set(i);
                if (e.optInt("status") == 200 && !e.has("fehler")) ok++; else fehl++;
                String f = MtAuftrag.endgueltig(e.optInt("status"));
                if (f != null) { ende = f; break; }
            }
            if (ende == null) ende = "fertig";
            if (still) ende = null;                                  // vom System beendet: fortsetzbar lassen
            else MtAuftrag.schreibeSicher(endeDatei(c), ende);
        } catch (Throwable e) {
            ende = null;                                            // kein Ende vermerkt: beim nächsten Öffnen „fortsetzen?“
            AppLog.log("Meine Touren Abgleich: " + e);
        } finally {
            running = false;
            String titel = ende == null ? "Abgleich unterbrochen" : ende.equals("fertig") ? "Abgleich mit Meine Touren fertig" : ende.equals("abgebrochen") ? "Abgleich abgebrochen"
                    : ende.equals("relogin") ? "Abgleich angehalten: Anmeldung abgelaufen" : ende.equals("verboten") ? "Abgleich angehalten: keine Schreibrechte" : "Abgleich wartet auf WLAN";
            String tx = ok + " von " + n + " erledigt" + (fehl > 0 ? ", " + fehl + " nicht übertragen" : "") + (ende == null || ende.equals("wlan") ? " – in der App fortsetzen" : "");
            svc.fertig(titel, tx);
        }
    }

    /** Bis zu 30 Minuten auf WLAN warten (Benachrichtigung „wartet auf WLAN“). */
    private static boolean warteAufWlan(Context c, MtAbgleichService svc, String basis, int i, int n) {
        long bis = System.currentTimeMillis() + WLAN_WARTEN;
        wlan(true);
        try {
            while (!cancel && System.currentTimeMillis() < bis) {
                setze(i, basis + " · wartet auf WLAN");
                svc.melde(basis + " · wartet auf WLAN", i, n, false);
                if (!schlafe(5000)) return false;
                if (TileDownload.onWifi(c)) return true;
            }
            return false;
        } finally { wlan(false); }
    }

    /** Ein Schritt mit Wiederholungen. null = abgebrochen. Ergebnis: {status, body, … , fehler?, versuche}. */
    private static JSONObject schritt(final Context c, final JSONObject t, Set<String> geholt, final MtAbgleichService svc, final String basis, final int i, final int n) throws Exception {
        final String art = t.optString("art");
        if (art.equals("foto-senden") && geholt.contains(t.optString("id")))      // eben beim Holen als dasselbe Foto erkannt
            return new JSONObject().put("status", 200).put("uebersprungen", true).put("versuche", 0);
        final JSONObject a = new JSONObject(t.toString()).put("cookie", cookie);
        final JSONObject[] res = {null};
        final MtTransfer.Control ctl = new MtTransfer.Control() {
            long last;
            public boolean cancelled() { return cancel; }
            public void progress(long d, long tot) {
                bytes(d, tot);
                long now = System.currentTimeMillis();
                if (now - last > 1500 && tot > 0) { last = now; svc.melde(basis + " · " + (d >> 20) + " von " + (tot >> 20) + " MB", (int) (d * 100 / tot), 100, true); }
            }
        };
        MtAuftrag.Ausgang o = MtAuftrag.wiederholt(() -> {
            JSONObject r;
            switch (art) {
                case "notiz": {
                    MtTransfer.Result x = MtTransfer.json(a.getString("url"), cookie, "POST", a.getString("body"), 60000);
                    r = new JSONObject().put("status", x.status).put("body", x.body);
                    break;
                }
                case "stand": {
                    MtTransfer.Result x = MtTransfer.json(a.getString("url"), cookie, "GET", null, 60000);
                    r = new JSONObject().put("status", x.status).put("body", x.body);
                    break;
                }
                case "foto-holen": r = MtMedien.fotoHolen(c, a); break;
                case "foto-senden": r = MtMedien.fotoSenden(c, a); break;
                case "video-holen": r = MtMedien.videoHolen(c, a, ctl); break;
                case "video-senden": r = MtMedien.videoSenden(c, a, ctl); break;
                default: throw new Exception("Unbekannter Schritt: " + art);
            }
            res[0] = r;
            return r.optInt("status", 0);
        }, (ms, v) -> {
            String w = basis + " · neuer Versuch (" + v + " von " + MtAuftrag.WIEDERHOLUNGEN + ") in " + (ms / 1000) + " s";
            setze(i, w);
            svc.melde(w, i, n, false);
            return schlafe(ms);
        });
        if (o.abgebrochen) return null;
        JSONObject e = o.fehler == null && res[0] != null ? res[0] : new JSONObject().put("status", o.status);
        if (o.fehler != null) { e.put("fehler", o.fehler); AppLog.log("Meine Touren Abgleich, " + art + ": " + o.fehler + " (" + o.versuche + " Versuche)"); }
        e.put("versuche", o.versuche);
        if (e.optInt("status") == 200 && e.has("id") && art.equals("foto-holen")) geholt.add(e.optString("id"));
        if (e.optJSONObject("result") != null && art.equals("video-holen")) geholt.add(e.getJSONObject("result").optString("id"));
        return e;
    }
}
