package de.meinetouren.lokal;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;

/**
 * Hält die App während eines Imports (Komoot, Strava, Fotos …) am Leben, auch wenn der Bildschirm aus ist
 * oder eine andere App im Vordergrund liegt. Zeigt den Fortschritt in der Benachrichtigung.
 */
public class ImportService extends Service {
    private static final String CHANNEL = "import";
    private static final int NID = 4711;
    private PowerManager.WakeLock wl;

    public static void start(Context c, String title, String text, int i, int n) {
        Intent in = new Intent(c, ImportService.class).putExtra("title", title).putExtra("text", text).putExtra("i", i).putExtra("n", n);
        try {
            if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(in); else c.startService(in);
        } catch (Exception e) { AppLog.log("Import-Dienst: " + e); }
    }

    public static void stop(Context c, String doneText) {
        c.stopService(new Intent(c, ImportService.class));
        if (doneText != null && !doneText.isEmpty()) {
            NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
            ensure(nm, c);
            nm.notify(NID + 1, base(c, "Import fertig", doneText, 0, 0, false).setAutoCancel(true).build());
        }
    }

    private static void ensure(NotificationManager nm, Context c) {
        if (Build.VERSION.SDK_INT >= 26) nm.createNotificationChannel(new NotificationChannel(CHANNEL, "Import", NotificationManager.IMPORTANCE_LOW));
    }

    private static Notification.Builder base(Context c, String title, String text, int i, int n, boolean ongoing) {
        Intent open = new Intent(c, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pi = PendingIntent.getActivity(c, 1, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification.Builder b = new Notification.Builder(c, CHANNEL).setSmallIcon(R.drawable.ic_stat_rec)
                .setContentTitle(title).setContentText(text).setContentIntent(pi).setOngoing(ongoing).setOnlyAlertOnce(true);
        if (n > 0) b.setProgress(n, Math.min(i, n), false); else if (ongoing) b.setProgress(0, 0, true);
        return b;
    }

    @Override
    public int onStartCommand(Intent in, int flags, int startId) {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        ensure(nm, this);
        String title = in == null ? "Import läuft" : in.getStringExtra("title");
        String text = in == null ? "" : in.getStringExtra("text");
        int i = in == null ? 0 : in.getIntExtra("i", 0), n = in == null ? 0 : in.getIntExtra("n", 0);
        Notification nt = base(this, title == null ? "Import läuft" : title, text == null ? "" : text, i, n, true).build();
        if (wl == null) {
            wl = ((PowerManager) getSystemService(Context.POWER_SERVICE)).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "meinetouren:import");
            wl.acquire(3 * 60 * 60 * 1000L);
        }
        if (Build.VERSION.SDK_INT >= 29) startForeground(NID, nt, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
        else startForeground(NID, nt);
        return START_NOT_STICKY;
    }

    @Override
    public void onDestroy() {
        if (wl != null && wl.isHeld()) wl.release();
        super.onDestroy();
    }

    @Override public IBinder onBind(Intent intent) { return null; }
}
