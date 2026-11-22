package de.tourentagebuch.app;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.location.Location;
import android.location.LocationManager;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.io.Writer;

/**
 * Zustand einer Aufzeichnung (läuft in der ganzen App-Prozess-Lebenszeit, Zustand zusätzlich in Datei/Einstellungen gesichert).
 * 2.12.0: Neben den Punkten (rec_current.csv, jeder Punkt sofort angehängt) liegen die Metadaten in rec_meta.txt (atomar geschrieben,
 * siehe RecoveryPlan). Startet der Prozess neu und der Dienst läuft nicht (Absturz, „Beenden erzwingen“, Akku leer, Neustart des Handys),
 * gilt die Aufzeichnung als unterbrochen: die Oberfläche bietet Fortsetzen (bis 12 h), Als Tour speichern oder Verwerfen an.
 */
public final class Recorder {
    public static final String IDLE = "idle", RECORDING = "recording", PAUSED = "paused", FINISHED = "finished";
    private static Recorder inst;

    public static synchronized Recorder get(Context c) {
        if (inst == null) inst = new Recorder(c.getApplicationContext());
        return inst;
    }

    public volatile long lastFixMs = 0;
    public volatile float lastAcc = -1;
    private int fixes = 0;
    private final Context ctx;
    private final SharedPreferences prefs;
    private final TrackStore store;
    private final File finalFile, csvFile, metaFile;
    private RecoveryPlan.Meta meta;
    /** Zeitpunkt (elapsedRealtime) der letzten Startanfrage an den Dienst in diesem Prozess; 0 = keine. */
    private volatile long startAskedAt = 0;

    private Recorder(Context c) {
        ctx = c;
        AppLog.init(c);
        prefs = c.getSharedPreferences("rec", Context.MODE_PRIVATE);
        File dir = c.getFilesDir();
        csvFile = new File(dir, "rec_current.csv");
        metaFile = new File(dir, "rec_meta.txt");
        store = new TrackStore(csvFile);
        finalFile = new File(dir, "rec_finished.gpx");
        meta = RecoveryPlan.load(metaFile);
        String s = state();
        // Einstellungen verloren (z. B. Prozessende, bevor sie geschrieben waren), Wiederherstellungsdatei aber da: aus ihr übernehmen
        if (IDLE.equals(s) && meta != null && (RECORDING.equals(meta.state) || PAUSED.equals(meta.state)) && csvFile.isFile()) {
            prefs.edit().putString("state", meta.state).putString("sport", meta.sport.isEmpty() ? "hike" : meta.sport)
                    .putString("name", meta.name).putLong("start", meta.start).commit();
            s = meta.state;
            AppLog.log("Zustand aus der Wiederherstellungsdatei übernommen: " + s);
        }
        if (RECORDING.equals(s) || PAUSED.equals(s)) {
            store.load();
            if (meta == null) { meta = newMeta(prefs.getLong("start", 0)); saveMeta(); }
            AppLog.log("Aufzeichnung geladen: " + store.count() + " Punkte (" + s + ")");
        }
    }

    private RecoveryPlan.Meta newMeta(long start) {
        RecoveryPlan.Meta m = new RecoveryPlan.Meta();
        m.start = start;
        m.state = state();
        m.sport = sport();
        m.name = name();
        return m;
    }

    /** Metadaten atomar schreiben (Zustand, Sportart, Name und Route immer frisch). */
    private void saveMeta() {
        if (meta == null) return;
        meta.state = state();
        meta.sport = sport();
        meta.name = name();
        try { meta.route = routeName(); } catch (Exception e) { /* ohne Route */ }
        try { RecoveryPlan.writeAtomic(metaFile, RecoveryPlan.format(meta)); }
        catch (IOException e) { AppLog.log("Wiederherstellungsdatei: " + e); }
    }

    private String routeName() {
        try {
            JSONObject o = new JSONObject(Navi.info(ctx));
            return o.optBoolean("has") ? o.optString("name", "") : "";
        } catch (Exception e) { return ""; }
    }

    /** Läuft der Dienst nicht, obwohl aufgezeichnet werden soll (Prozess neu gestartet nach Absturz/Beenden/Akku leer)? */
    public boolean interrupted() {
        long since = startAskedAt == 0 ? Long.MAX_VALUE : android.os.SystemClock.elapsedRealtime() - startAskedAt;
        return RecoveryPlan.interrupted(state(), RecorderService.alive, since);
    }

    /** Letztes Lebenszeichen der Aufzeichnung (letzter Punkt, Start, Pausen). */
    public synchronized long lastActivity() {
        long l = RecoveryPlan.lastActivity(meta, store.lastTime());
        return Math.max(l, prefs.getLong("start", 0));
    }

    public TrackStore store() { return store; }
    public synchronized String state() { return prefs.getString("state", IDLE); }
    public synchronized String sport() { return prefs.getString("sport", "hike"); }
    public synchronized String name() { return prefs.getString("name", ""); }

    private void setState(String s) { prefs.edit().putString("state", s).commit(); }      // 2.12.0: commit – der Zustand muss ein Prozessende überstehen

    /** Abstand/Zeit der GPS-Abfrage je nach Sportart: Rad schneller, zu Fuß sparsamer. */
    public long minTimeMs() {
        String s = sport();
        if (s.contains("bicycle") || s.equals("racebike") || s.equals("mtb") || s.equals("jogging")) return 3000;
        return 5000;
    }
    public float minDistM() {
        String s = sport();
        if (s.contains("bicycle") || s.equals("racebike") || s.equals("mtb")) return 8f;
        return 4f;
    }

    private void service(String action) {
        Intent i = new Intent(ctx, RecorderService.class).setAction(action);
        if (RecorderService.ACT_STOP.equals(action) || RecorderService.ACT_PAUSE.equals(action)) {
            // 2.12.0: läuft der Dienst gar nicht (Prozess war beendet), nicht eigens starten, nur um ihn zu beenden
            if (!RecorderService.alive && !RecorderService.running) { if (RecorderService.ACT_STOP.equals(action)) Navi.clear(ctx); return; }
            ctx.startService(i);
        } else {
            startAskedAt = android.os.SystemClock.elapsedRealtime();
            ctx.startForegroundService(i);
        }
    }

    public synchronized void start(String sport, String name) {
        store.clear();
        finalFile.delete();
        long now = System.currentTimeMillis();
        prefs.edit().putString("state", RECORDING).putString("sport", sport == null || sport.isEmpty() ? "hike" : sport)
                .putString("name", name == null ? "" : name).putLong("start", now).commit();
        meta = newMeta(now);
        saveMeta();
        AppLog.log("Start: " + sport + " \"" + name + "\"");
        service(RecorderService.ACT_START);
    }

    public synchronized void pause() {
        if (!RECORDING.equals(state())) return;
        setState(PAUSED);
        store.breakSegment();
        if (meta != null) meta.pauses.add(new long[]{System.currentTimeMillis(), 0});
        saveMeta();
        AppLog.log("Pause bei " + store.count() + " Punkten");
        service(RecorderService.ACT_PAUSE);
    }

    public synchronized void resume() {
        if (!PAUSED.equals(state())) return;
        setState(RECORDING);
        store.breakSegment();
        if (meta != null && !meta.pauses.isEmpty() && meta.pauses.get(meta.pauses.size() - 1)[1] == 0) meta.pauses.get(meta.pauses.size() - 1)[1] = System.currentTimeMillis();
        saveMeta();
        AppLog.log("Weiter");
        service(RecorderService.ACT_RESUME);
    }

    /** Wird vom Dienst nach einem Neustart durch das System aufgerufen: die Lücke bekommt ein neues Segment. */
    public synchronized void resumeAfterKill() {
        AppLog.log("Dienst vom System neu gestartet - neues Segment");
        store.breakSegment();
        noteGap();
    }

    private void noteGap() {
        if (meta == null) return;
        long from = lastActivity(), now = System.currentTimeMillis();
        if (now > from) meta.gaps.add(new long[]{from, now});
        saveMeta();
    }

    /**
     * 2.12.0: Unterbrochene Aufzeichnung fortsetzen (nur wenn unterbrochen und höchstens 12 h alt). Die Lücke wird als eigenes
     * Segment markiert (in der GPX-Datei ein neues trkseg, in der Wiederherstellungsdatei als „gap“). false = nicht möglich.
     */
    public synchronized boolean resumeInterrupted() {
        if (!interrupted()) return false;
        if (!RecoveryPlan.canResume(lastActivity(), System.currentTimeMillis())) return false;
        store.breakSegment();
        noteGap();
        AppLog.log("Unterbrochene Aufzeichnung fortgesetzt (" + store.count() + " Punkte)");
        service(RecorderService.ACT_RESUME);
        return true;
    }

    /** 2.12.0: Foto/Video, das während der Aufzeichnung übernommen wurde, in der Wiederherstellungsdatei vermerken. */
    public synchronized void noteMedia(String id, long ts) {
        String s = state();
        if (meta == null || id == null || (!RECORDING.equals(s) && !PAUSED.equals(s))) return;
        meta.media.add(ts + "," + id);
        saveMeta();
    }

    public synchronized void stop(String name) {
        String s = state();
        if (!RECORDING.equals(s) && !PAUSED.equals(s)) return;
        if (name != null && name.trim().length() > 0) prefs.edit().putString("name", name.trim()).commit();
        AppLog.log("Ende: " + store.count() + " Punkte, " + Math.round(store.distanceM()) + " m" + (interrupted() ? " (nach Unterbrechung)" : ""));
        service(RecorderService.ACT_STOP);
        String gpx = store.gpx(name(), sport());
        try {
            Writer w = new OutputStreamWriter(new FileOutputStream(finalFile), "UTF-8");
            try { w.write(gpx); } finally { w.close(); }
            setState(store.count() > 1 ? FINISHED : IDLE);
            // 2.12.0: Punkte und Metadaten erst löschen, wenn die GPX-Datei wirklich geschrieben ist
            csvFile.delete();
            metaFile.delete();
            meta = null;
        } catch (IOException e) {
            // GPX nicht schreibbar (Speicher voll?): Aufzeichnung bleibt als Pause mit allen Punkten erhalten statt verloren zu gehen
            AppLog.log("GPX schreiben fehlgeschlagen: " + e + " – Aufzeichnung bleibt erhalten");
            setState(PAUSED);
            saveMeta();
        }
    }

    /** Aufzeichnung verwerfen bzw. nach erfolgreichem Hochladen aufräumen. */
    public synchronized void discard() {
        AppLog.log("Aufzeichnung verworfen/abgeschlossen");
        backupFinished();
        if (RECORDING.equals(state()) || PAUSED.equals(state())) {
            backupCurrent();      // 2.12.0: auch eine laufende/unterbrochene Aufzeichnung bleibt als Sicherung
            service(RecorderService.ACT_STOP);
        }
        store.clear();
        finalFile.delete();
        metaFile.delete();
        meta = null;
        setState(IDLE);
    }

    /** Laufende Punkte als GPX in die Sicherungen legen (bevor sie verworfen werden). */
    private void backupCurrent() {
        try {
            if (store.count() < 2) return;
            Writer w = new OutputStreamWriter(new FileOutputStream(finalFile), "UTF-8");
            try { w.write(store.gpx(name(), sport())); } finally { w.close(); }
            backupFinished();
        } catch (IOException e) {
            AppLog.log("Sicherung der laufenden Aufzeichnung fehlgeschlagen: " + e);
        }
    }

    /** Fertige Aufzeichnung vor dem Löschen als Sicherung ablegen (die letzten 10 bleiben), damit nichts verloren geht. */
    private void backupFinished() {
        try {
            if (!finalFile.exists() || finalFile.length() < 200) return;
            File dir = new File(ctx.getFilesDir(), "backup");
            dir.mkdirs();
            String stamp = new java.text.SimpleDateFormat("yyyyMMdd_HHmmss", java.util.Locale.US).format(new java.util.Date());
            File to = new File(dir, "rec_" + stamp + ".gpx");
            java.io.InputStream in = new FileInputStream(finalFile);
            java.io.OutputStream out = new FileOutputStream(to);
            try {
                byte[] b = new byte[8192];
                int n;
                while ((n = in.read(b)) > 0) out.write(b, 0, n);
            } finally { in.close(); out.close(); }
            File[] all = dir.listFiles();
            if (all != null && all.length > 10) {
                java.util.Arrays.sort(all);
                for (int i = 0; i < all.length - 10; i++) all[i].delete();
            }
            AppLog.log("Sicherung angelegt: " + to.getName());
        } catch (Exception e) {
            AppLog.log("Sicherung fehlgeschlagen: " + e.getClass().getSimpleName());
        }
    }

    /** Liste der Sicherungen als JSON: [{"file","size","ts"}], neueste zuerst. */
    public String backupsJson() {
        org.json.JSONArray a = new org.json.JSONArray();
        File[] all = new File(ctx.getFilesDir(), "backup").listFiles();
        if (all != null) {
            java.util.Arrays.sort(all, java.util.Collections.reverseOrder());
            for (File f : all) {
                try { a.put(new JSONObject().put("file", f.getName()).put("size", f.length()).put("ts", f.lastModified())); } catch (JSONException e) { }
            }
        }
        return a.toString();
    }

    public String backupGpx(String name) {
        if (name == null || name.contains("/") || name.contains("..")) return "";
        try {
            BufferedReader r = new BufferedReader(new InputStreamReader(new FileInputStream(new File(new File(ctx.getFilesDir(), "backup"), name)), "UTF-8"));
            StringBuilder b = new StringBuilder();
            char[] buf = new char[8192];
            int n;
            try { while ((n = r.read(buf)) > 0) b.append(buf, 0, n); } finally { r.close(); }
            return b.toString();
        } catch (IOException e) {
            return "";
        }
    }

    public synchronized String finishedGpx() {
        if (!finalFile.exists()) return "";
        try {
            BufferedReader r = new BufferedReader(new InputStreamReader(new FileInputStream(finalFile), "UTF-8"));
            StringBuilder b = new StringBuilder();
            char[] buf = new char[8192];
            int n;
            try { while ((n = r.read(buf)) > 0) b.append(buf, 0, n); } finally { r.close(); }
            return b.toString();
        } catch (IOException e) {
            return "";
        }
    }

    public void onLocation(Location l) {
        if (!RECORDING.equals(state())) return;
        lastFixMs = System.currentTimeMillis();
        lastAcc = l.hasAccuracy() ? l.getAccuracy() : -1;
        if (++fixes % 25 == 1) AppLog.log("Fix #" + fixes + " Genauigkeit " + Math.round(lastAcc) + " m, Punkte " + store.count());
        store.add(l.getTime() > 0 ? l.getTime() : System.currentTimeMillis(), l.getLatitude(), l.getLongitude(),
                l.hasAltitude() ? l.getAltitude() : Double.NaN, l.hasAccuracy() ? l.getAccuracy() : 0f);
    }

    public String statusJson() {
        JSONObject o = new JSONObject();
        try {
            String s = state();
            o.put("state", s);
            o.put("sport", sport());
            o.put("name", name());
            o.put("start", prefs.getLong("start", 0));
            o.put("count", store.count());
            o.put("dist_m", Math.round(store.distanceM()));
            o.put("up_m", Math.round(store.ascentM()));
            o.put("down_m", Math.round(store.descentM()));
            long act = store.activeMs();
            long last = store.lastTime();
            if (RECORDING.equals(s) && last > 0 && System.currentTimeMillis() - last < 60000) act += System.currentTimeMillis() - last;
            o.put("active_s", act / 1000);
            double al = store.lastAlt(), ma = store.maxAlt();
            if (!Double.isNaN(al)) o.put("alt_m", Math.round(al));
            if (!Double.isNaN(ma)) o.put("max_alt_m", Math.round(ma));
            o.put("speed_ms", Math.round(store.recentSpeedMs() * 100) / 100.0);
            if (store.count() > 0) {
                o.put("lat", store.lastLat());
                o.put("lon", store.lastLon());
            }
            LocationManager lm = (LocationManager) ctx.getSystemService(Context.LOCATION_SERVICE);
            o.put("gps", lm != null && lm.isProviderEnabled(LocationManager.GPS_PROVIDER));
            o.put("unsent", finalFile.exists());
            o.put("fix_age_s", lastFixMs > 0 ? (System.currentTimeMillis() - lastFixMs) / 1000 : -1);
            o.put("fix_acc_m", Math.round(lastAcc));
            // 2.12.0: unterbrochene Aufzeichnung (Dienst läuft nicht) – Oberfläche zeigt Fortsetzen / Als Tour speichern / Verwerfen
            if (RECORDING.equals(s) || PAUSED.equals(s)) {
                boolean intr = interrupted();
                long lastAct = lastActivity();
                o.put("interrupted", intr);
                o.put("last_ts", lastAct);
                o.put("can_resume", intr && RecoveryPlan.canResume(lastAct, System.currentTimeMillis()));
                o.put("gaps", meta == null ? 0 : meta.gaps.size());
                o.put("media", meta == null ? 0 : meta.media.size());
            }
        } catch (JSONException e) {
            // nicht erreichbar: nur Zahlen und Texte
        }
        return o.toString();
    }
}
