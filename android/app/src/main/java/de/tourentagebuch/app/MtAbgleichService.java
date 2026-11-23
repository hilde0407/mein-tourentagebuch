package de.tourentagebuch.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;

/**
 * 2.18.1: Vordergrunddienst (dataSync) für den Abgleich mit Meine Touren ({@link MtAbgleich}). Hält die CPU wach (PARTIAL_WAKE_LOCK) und das WLAN
 * leistungsfähig (WifiLock WIFI_MODE_FULL_HIGH_PERF, solange übertragen wird), damit der Abgleich bei ausgeschaltetem Bildschirm weiterläuft. Der Bildschirm
 * selbst bleibt nicht an. Benachrichtigung mit Fortschritt und „Abbrechen“. Eigener Dienst statt {@link ImportService}: dessen bgStop aus einem anderen
 * Vorgang der Oberfläche würde den Abgleich sonst mit beenden.
 */
public class MtAbgleichService extends Service {
    private static final String CHANNEL = "mtabgleich";
    private static final int NID = 4730;
    static final String ABBRECHEN = "de.tourentagebuch.app.MT_ABGLEICH_ABBRECHEN";
    private PowerManager.WakeLock wl;
    private WifiManager.WifiLock wifi;
    private Thread worker;
    private long last;
    private volatile boolean gemeldet;      // fertig() lief schon (der Thread endet gleich)
    private int sid;

    static void start(Context c) {
        Intent in = new Intent(c, MtAbgleichService.class);
        if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(in); else c.startService(in);
    }

    private static void ensure(NotificationManager nm) {
        if (Build.VERSION.SDK_INT >= 26) nm.createNotificationChannel(new NotificationChannel(CHANNEL, "Abgleich mit Meine Touren", NotificationManager.IMPORTANCE_LOW));
    }

    private Notification.Builder base(String title, String text, int i, int n, boolean ongoing) {
        Intent open = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pi = PendingIntent.getActivity(this, 3, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification.Builder b = new Notification.Builder(this, CHANNEL).setSmallIcon(R.drawable.ic_stat_rec)
                .setContentTitle(title).setContentText(text).setContentIntent(pi).setOngoing(ongoing).setOnlyAlertOnce(true);
        if (ongoing) {
            PendingIntent stop = PendingIntent.getService(this, 4, new Intent(this, MtAbgleichService.class).setAction(ABBRECHEN), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
            b.addAction(new Notification.Action.Builder(null, "Abbrechen", stop).build());
            if (n > 0) b.setProgress(n, Math.min(i, n), false); else b.setProgress(0, 0, true);
        }
        return b;
    }

    @Override
    public int onStartCommand(Intent in, int flags, int startId) {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        ensure(nm);
        if (in != null && ABBRECHEN.equals(in.getAction())) {
            MtAbgleich.cancel();
            if (worker != null && worker.isAlive()) nm.notify(NID, base("Mit Meine Touren abgleichen", "Wird abgebrochen …", 0, 0, true).build());
            else stopSelf();
            return START_NOT_STICKY;
        }
        Notification nt = base("Mit Meine Touren abgleichen", "Wird gestartet …", 0, 0, true).build();
        if (Build.VERSION.SDK_INT >= 29) startForeground(NID, nt, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
        else startForeground(NID, nt);
        try {
            if (wl == null) {
                wl = ((PowerManager) getSystemService(Context.POWER_SERVICE)).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "tourentagebuch:mtabgleich");
                wl.setReferenceCounted(false);
            }
            wl.acquire(6 * 60 * 60 * 1000L);
            if (wifi == null) {
                WifiManager wm = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
                if (wm != null) { wifi = wm.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "tourentagebuch:mtabgleich"); wifi.setReferenceCounted(false); }
            }
            if (wifi != null) wifi.acquire();
        } catch (Exception e) { AppLog.log("Meine Touren Abgleich: Sperren " + e); }
        if (worker != null && worker.isAlive() && gemeldet) { try { worker.join(3000); } catch (InterruptedException e) { /* weiter */ } }
        if (worker == null || !worker.isAlive()) {
            final Context app = getApplicationContext();
            gemeldet = false;
            sid = startId;
            worker = new Thread(() -> MtAbgleich.lauf(app, this), "Meine Touren Abgleich");
            worker.start();
        }
        return START_NOT_STICKY;
    }

    /** Fortschritt in der Benachrichtigung (höchstens etwa jede Sekunde, außer force). */
    void melde(String text, int i, int n, boolean force) {
        long now = System.currentTimeMillis();
        if (!force && now - last < 1000) return;
        last = now;
        try {
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            nm.notify(NID, base("Mit Meine Touren abgleichen", text, i, n, true).build());
        } catch (Exception e) { /* nur Anzeige */ }
    }

    /** Auftrag zu Ende (aus dem Thread): Sperren lösen, Dienst beenden, kurze Abschlussmeldung. */
    void fertig(String title, String text) {
        gemeldet = true;
        loesen();
        try {
            stopForeground(STOP_FOREGROUND_REMOVE);
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            nm.notify(NID + 1, base(title, text, 0, 0, false).setAutoCancel(true).build());
        } catch (Exception e) { AppLog.log("Meine Touren Abgleich: " + e); }
        stopSelf(sid);      // ein inzwischen neu gestarteter Auftrag (neuere startId) hält den Dienst am Leben
    }

    private void loesen() {
        try { if (wifi != null && wifi.isHeld()) wifi.release(); } catch (Exception e) { /* egal */ }
        try { if (wl != null && wl.isHeld()) wl.release(); } catch (Exception e) { /* egal */ }
    }

    /** Android 15+: Zeitgrenze für dataSync erreicht – anhalten, der Auftrag bleibt fortsetzbar. (Ohne @Override, damit es gegen API 34 baut.) */
    public void onTimeout(int startId, int fgsType) { MtAbgleich.anhalten(); }

    @Override
    public void onDestroy() {
        if (!gemeldet && worker != null && worker.isAlive()) MtAbgleich.anhalten();      // vom System beendet, während der Auftrag läuft: fortsetzbar lassen
        loesen();
        super.onDestroy();
    }

    @Override public IBinder onBind(Intent intent) { return null; }
}
