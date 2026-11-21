package de.tourentagebuch.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.util.ArrayDeque;
import java.util.Collection;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * 2.7.1: wandelt HEVC-Videos nacheinander in H.264 um (VideoConvert), als Vordergrunddienst mit Wake-Lock,
 * damit es auch bei ausgeschaltetem Bildschirm oder in einer anderen App weiterläuft.
 * Das Original wird erst ersetzt, wenn die neue Datei fertig und lesbar ist; bei Fehler/Abbruch bleibt es.
 * Ergebnisse landen in einer kleinen Warteschlange (SharedPreferences „video“), die die Oberfläche über
 * Native.call('videoStatus') abholt; Hinweis an die Oberfläche über den Listener (Ereignis „mtvideo“).
 */
public class VideoService extends Service {
    private static final String CHANNEL = "video";
    private static final int NID = 4721;

    interface Listener { void changed(); }

    static volatile Listener listener;
    private static final ArrayDeque<String> todo = new ArrayDeque<>();
    private static final AtomicBoolean cancel = new AtomicBoolean(false);
    private static String current;
    private static int done, total, pct;
    private static Thread worker;
    private static long lastNote;
    private static volatile VideoService inst;

    private PowerManager.WakeLock wl;

    /** Videos (IDs) zur Umwandlung vormerken; schon vorgemerkte werden nicht doppelt aufgenommen. Gibt die Zahl neu vorgemerkter zurück. */
    static int enqueue(Context c, Collection<String> ids) {
        int added = 0;
        synchronized (VideoService.class) {
            for (String id : ids) {
                if (id == null || !id.matches("[0-9a-f]{6,40}v")) continue;
                if (id.equals(current) || todo.contains(id)) continue;
                todo.add(id);
                added++;
            }
            if (added == 0) return 0;
            if (current == null && todo.size() == added) { done = 0; total = 0; }
            total += added;
        }
        Context app = c.getApplicationContext();
        try {
            Intent in = new Intent(app, VideoService.class);
            if (Build.VERSION.SDK_INT >= 26) app.startForegroundService(in); else app.startService(in);
        } catch (Exception e) {
            // Start als Vordergrunddienst nicht erlaubt (z. B. App im Hintergrund): trotzdem umwandeln, nur ohne Dienst
            AppLog.log("Video-Dienst: " + e);
            startWorker(app);
        }
        notifyUi();
        return added;
    }

    /** Laufende Umwandlung abbrechen und die Warteschlange leeren (Originale bleiben). */
    static void cancelAll() {
        synchronized (VideoService.class) { todo.clear(); if (current != null) cancel.set(true); }
        notifyUi();
    }

    /** Zustand für die Oberfläche; holt dabei die fertigen Ergebnisse ab (jedes genau einmal). */
    static JSONObject status(Context c) throws Exception {
        JSONObject o = new JSONObject();
        synchronized (VideoService.class) {
            o.put("running", current != null || !todo.isEmpty()).put("id", current == null ? "" : current)
                    .put("i", Math.min(total, done + (current != null ? 1 : 0))).put("n", total).put("pct", pct)
                    .put("waiting", todo.size());
        }
        o.put("done", takeDone(c));
        return o;
    }

    private static void notifyUi() {
        Listener l = listener;
        if (l != null) { try { l.changed(); } catch (Exception e) { /* Oberfläche gerade weg */ } }
    }

    private static synchronized void pushDone(Context c, JSONObject r) {
        SharedPreferences p = c.getSharedPreferences("video", MODE_PRIVATE);
        try {
            JSONArray a = new JSONArray(p.getString("done", "[]"));
            a.put(r);
            while (a.length() > 200) a.remove(0);
            p.edit().putString("done", a.toString()).commit();
        } catch (Exception e) { /* ignorieren */ }
    }

    private static synchronized JSONArray takeDone(Context c) {
        SharedPreferences p = c.getSharedPreferences("video", MODE_PRIVATE);
        JSONArray a;
        try { a = new JSONArray(p.getString("done", "[]")); } catch (Exception e) { a = new JSONArray(); }
        p.edit().remove("done").commit();
        return a;
    }

    private static synchronized void startWorker(Context app) {
        if (worker != null && worker.isAlive()) return;
        worker = new Thread(() -> work(app), "VideoConvert");
        worker.setPriority(Thread.NORM_PRIORITY - 1);
        worker.start();
    }

    private static void work(Context app) {
        while (true) {
            String id;
            synchronized (VideoService.class) {
                id = todo.poll();
                current = id;
                pct = 0;
                cancel.set(false);
                if (id == null) { worker = null; break; }
            }
            notifyUi();
            note();
            JSONObject r = convertOne(app, id);
            pushDone(app, r);
            synchronized (VideoService.class) { done++; current = null; }
            notifyUi();
        }
        notifyUi();
        VideoService s = inst;
        if (s != null) s.finish();
    }

    /** Ein Video umwandeln und das Original ersetzen. Gibt das Ergebnis für die Oberfläche zurück. */
    static JSONObject convertOne(Context app, String id) {
        JSONObject r = new JSONObject();
        File src = new File(Photos.dir(app), id + ".mp4");
        File tmpDir = new File(app.getFilesDir(), "umwandeln");      // gleiches Dateisystem wie photos/: Ersetzen per Umbenennen
        tmpDir.mkdirs();
        File tmp = new File(tmpDir, id + ".mp4");
        try {
            r.put("id", id);
            if (!src.isFile()) throw new Exception("Video fehlt");
            if (!VideoConvert.isHevc(src)) { r.put("ok", false).put("skip", true).put("msg", "kein HEVC"); return r; }
            long t0 = System.currentTimeMillis();
            tmp.delete();
            VideoConvert.convert(src, tmp, cancel, p -> {
                synchronized (VideoService.class) { pct = p; }
                long now = System.currentTimeMillis();
                if (now - lastNote > 1000) { lastNote = now; notifyUi(); note(); }
            });
            // Prüfen, bevor das Original ersetzt wird: H.264 und eine Dauer
            String m = VideoConvert.videoMime(tmp);
            if (m == null || !m.equalsIgnoreCase("video/avc") || tmp.length() < 1024) throw new Exception("Ergebnis unbrauchbar");
            File old = new File(tmpDir, id + ".alt");
            old.delete();
            if (!src.renameTo(old)) throw new Exception("Original lässt sich nicht beiseitelegen");
            if (!tmp.renameTo(src)) { old.renameTo(src); throw new Exception("Neue Datei lässt sich nicht ablegen"); }
            old.delete();
            new File(PhotoProvider.camDir(app), "ansicht_" + id + ".mp4").delete();      // alte Kopie für die Video-App
            long[] meta = Photos.videoMeta(app, id);
            r.put("ok", true).put("w", meta[0]).put("h", meta[1]).put("dur", meta[2]).put("ms", System.currentTimeMillis() - t0);
            AppLog.log("Video " + id + " in H.264 umgewandelt (" + (System.currentTimeMillis() - t0) / 1000 + " s)");
        } catch (VideoConvert.Cancelled e) {
            try { r.put("ok", false).put("cancel", true).put("msg", "abgebrochen"); } catch (Exception x) { /* egal */ }
        } catch (Throwable e) {
            AppLog.log("Video umwandeln " + id + ": " + e);
            try { r.put("ok", false).put("msg", e.getMessage() == null ? e.toString() : e.getMessage()); } catch (Exception x) { /* egal */ }
        } finally {
            tmp.delete();
        }
        return r;
    }

    private static void ensure(NotificationManager nm) {
        if (Build.VERSION.SDK_INT >= 26) nm.createNotificationChannel(new NotificationChannel(CHANNEL, "Videos umwandeln", NotificationManager.IMPORTANCE_LOW));
    }

    private Notification build() {
        String text;
        int p, i, n;
        synchronized (VideoService.class) { p = pct; n = total; i = Math.min(total, done + 1); }
        text = (n > 1 ? i + " von " + n + " · " : "") + p + " %";
        Intent open = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pi = PendingIntent.getActivity(this, 2, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        return new Notification.Builder(this, CHANNEL).setSmallIcon(R.drawable.ic_stat_rec).setContentTitle("Video wird umgewandelt …")
                .setContentText(text).setContentIntent(pi).setOngoing(true).setOnlyAlertOnce(true).setProgress(100, p, false).build();
    }

    private static void note() {
        VideoService s = inst;
        if (s == null) return;
        try { ((NotificationManager) s.getSystemService(Context.NOTIFICATION_SERVICE)).notify(NID, s.build()); } catch (Exception e) { /* egal */ }
    }

    /** Dienst beenden – aber nur, wenn wirklich nichts mehr ansteht (ein gerade neu Vorgemerktes läuft sonst ohne Dienst). */
    void finish() {
        synchronized (VideoService.class) { if (current != null || !todo.isEmpty() || (worker != null && worker.isAlive() && worker != Thread.currentThread())) return; }
        try { stopForeground(true); } catch (Exception e) { /* egal */ }
        stopSelf();
    }

    @Override
    public int onStartCommand(Intent in, int flags, int startId) {
        inst = this;
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        ensure(nm);
        Notification nt = build();
        if (Build.VERSION.SDK_INT >= 29) startForeground(NID, nt, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
        else startForeground(NID, nt);
        if (wl == null) {
            wl = ((PowerManager) getSystemService(Context.POWER_SERVICE)).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "tourentagebuch:video");
            wl.acquire(4 * 60 * 60 * 1000L);
        }
        boolean idle;
        synchronized (VideoService.class) { idle = todo.isEmpty() && current == null; }
        if (idle) { finish(); return START_NOT_STICKY; }
        startWorker(getApplicationContext());
        return START_NOT_STICKY;
    }

    @Override
    public void onDestroy() {
        if (inst == this) inst = null;
        if (wl != null && wl.isHeld()) wl.release();
        super.onDestroy();
    }

    @Override public IBinder onBind(Intent intent) { return null; }
}
