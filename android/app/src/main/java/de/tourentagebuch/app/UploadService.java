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
 * Hält den WLAN-Empfang (siehe UploadServer) auch bei ausgeschaltetem Bildschirm am Laufen: ohne Vordergrunddienst
 * und Wachhalte-Sperren bremst Android den Hintergrund-Thread der App kurz nach dem Abschalten des Bildschirms ein
 * oder friert ihn ein, und der Empfang vom Rechner bricht ab. Nach dem Muster von ImportService.java.
 */
public class UploadService extends Service {
    private static final String CHANNEL = "upload";
    private static final int NID = 4712;
    private PowerManager.WakeLock wl;
    private WifiManager.WifiLock wifiLock;

    public static void start(Context c) {
        Intent in = new Intent(c, UploadService.class);
        try {
            if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(in); else c.startService(in);
        } catch (Exception e) { AppLog.log("Empfangs-Dienst: " + e); }
    }

    public static void stop(Context c) {
        try { c.stopService(new Intent(c, UploadService.class)); } catch (Exception e) { /* egal */ }
    }

    private static void ensure(NotificationManager nm) {
        if (Build.VERSION.SDK_INT >= 26) nm.createNotificationChannel(new NotificationChannel(CHANNEL, "Fotoempfang", NotificationManager.IMPORTANCE_LOW));
    }

    @Override
    public int onStartCommand(Intent in, int flags, int startId) {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        ensure(nm);
        Intent open = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pi = PendingIntent.getActivity(this, 2, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification nt = new Notification.Builder(this, CHANNEL).setSmallIcon(R.drawable.ic_stat_rec)
                .setContentTitle("Empfängt Fotos vom Rechner").setContentText("Bleibt auch bei ausgeschaltetem Bildschirm aktiv")
                .setContentIntent(pi).setOngoing(true).setOnlyAlertOnce(true).build();
        if (wl == null) {
            wl = ((PowerManager) getSystemService(Context.POWER_SERVICE)).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "tourentagebuch:upload");
            wl.acquire(3 * 60 * 60 * 1000L);
        }
        if (wifiLock == null) {
            WifiManager wm = (WifiManager) getSystemService(Context.WIFI_SERVICE);
            if (wm != null) {
                wifiLock = wm.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "tourentagebuch:upload");
                wifiLock.acquire();
            }
        }
        if (Build.VERSION.SDK_INT >= 29) startForeground(NID, nt, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
        else startForeground(NID, nt);
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        if (wl != null && wl.isHeld()) wl.release();
        if (wifiLock != null && wifiLock.isHeld()) wifiLock.release();
        super.onDestroy();
    }

    @Override public IBinder onBind(Intent intent) { return null; }
}
