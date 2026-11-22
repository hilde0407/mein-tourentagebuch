package de.tourentagebuch.app;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.graphics.Color;
import android.media.MediaPlayer;
import android.os.Bundle;
import android.view.Gravity;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.MediaController;
import android.widget.TextView;
import android.widget.VideoView;

import java.io.File;

/**
 * 2.9.0: eigener Vollbild-Player für Videos der App. Spielt die Datei direkt aus photos/&lt;id&gt;.mp4 (ohne den internen Server des WebViews,
 * an dem Volkers H.264-Videos mit Fehler 4 scheiterten). VideoView + MediaController sind Bordmittel seit Android 1; kein neues Recht nötig.
 * Ergebnis an MainActivity: RESULT_OK (normal geschlossen) oder RESULT_FIRST_USER mit „what“/„extra“ (Fehler des MediaPlayers),
 * dann nimmt die Oberfläche den bisherigen Weg (Ansicht im WebView, Video-App).
 * Drehung: im Manifest configChanges=orientation|screenSize|keyboardHidden – die Activity wird nicht neu gebaut, die Position bleibt.
 */
public class VideoPlayerActivity extends Activity {
    static final String EXTRA_ID = "id", EXTRA_W = "w", EXTRA_H = "h";
    private VideoView vv;
    private int pos = 0;               // Wiedergabeposition (ms), gemerkt in onPause und für den Fall, dass Android die Activity doch neu baut
    private boolean wasPlaying = true; // beim ersten Start sofort abspielen; nach onPause bleibt es pausiert
    private boolean failed = false;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        Intent in = getIntent();
        String id = in == null ? null : in.getStringExtra(EXTRA_ID);
        id = id == null ? "" : id.replaceAll("[^A-Za-z0-9]", "");
        File f = new File(Photos.dir(this), id + ".mp4");
        if (id.isEmpty() || !f.isFile()) { fail(-1, 0); return; }
        if (b != null) { pos = b.getInt("pos", 0); wasPlaying = b.getBoolean("playing", true); }

        // Hochformat- oder Querformat-Video: Bildschirm folgt dem Video (Sensor darf um 180° drehen)
        // Maße und Drehung aus der Datei selbst lesen: Handyvideos sind oft 1920x1080 mit Drehung 90 (also hochkant angezeigt)
        int vw = in.getIntExtra(EXTRA_W, 0), vh = in.getIntExtra(EXTRA_H, 0);
        try {
            android.media.MediaMetadataRetriever r = new android.media.MediaMetadataRetriever();
            try {
                r.setDataSource(f.getAbsolutePath());
                int w = Integer.parseInt(r.extractMetadata(android.media.MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH));
                int h = Integer.parseInt(r.extractMetadata(android.media.MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT));
                String rot = r.extractMetadata(android.media.MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION);
                int rd = rot == null ? 0 : Integer.parseInt(rot);
                if (rd == 90 || rd == 270) { int t = w; w = h; h = t; }
                vw = w; vh = h;
            } finally { r.release(); }
        } catch (Exception e) { /* dann die übergebenen Maße */ }
        int o = VideoPlan.orientation(vw, vh);
        setRequestedOrientation(o == 1 ? ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
                : o == 2 ? ActivityInfo.SCREEN_ORIENTATION_SENSOR_PORTRAIT : ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        immersive();

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);
        vv = new VideoView(this);
        // MATCH_PARENT: VideoView skaliert das Bild seitenverhältnistreu so groß wie möglich (WRAP_CONTENT blieb in Videogröße)
        root.addView(vv, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT, Gravity.CENTER));
        TextView close = new TextView(this);
        close.setText("✕");
        close.setTextColor(Color.WHITE);
        close.setTextSize(24);
        close.setGravity(Gravity.CENTER);
        close.setBackgroundColor(0x66000000);
        close.setContentDescription("Schließen");
        int px = Math.round(56 * getResources().getDisplayMetrics().density);
        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(px, px, Gravity.TOP | Gravity.END);
        root.addView(close, lp);
        close.setOnClickListener(v -> finishOk());
        setContentView(root);

        MediaController mc = new MediaController(this);
        mc.setAnchorView(vv);
        vv.setMediaController(mc);
        vv.setOnPreparedListener(mp -> {
            if (pos > 0) vv.seekTo(pos);
            if (wasPlaying) vv.start();
            mc.show(2500);
        });
        vv.setOnCompletionListener(mp -> { pos = 0; mc.show(0); });
        vv.setOnErrorListener((MediaPlayer mp, int what, int extra) -> {
            AppLog.log("Player: Fehler " + what + "/" + extra + " bei " + f.getName());
            fail(what, extra);
            return true;      // keinen System-Dialog zeigen; die Oberfläche übernimmt
        });
        vv.setVideoPath(f.getAbsolutePath());
    }

    @SuppressWarnings("deprecation")
    private void immersive() {
        getWindow().getDecorView().setSystemUiVisibility(android.view.View.SYSTEM_UI_FLAG_LAYOUT_STABLE | android.view.View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                | android.view.View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | android.view.View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | android.view.View.SYSTEM_UI_FLAG_FULLSCREEN | android.view.View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
    }

    @Override
    public void onWindowFocusChanged(boolean f) { super.onWindowFocusChanged(f); if (f) immersive(); }

    private void fail(int what, int extra) {
        if (failed) return;
        failed = true;
        setResult(RESULT_FIRST_USER, new Intent().putExtra("what", what).putExtra("extra", extra));
        finish();
    }

    private void finishOk() {
        if (!failed) setResult(RESULT_OK, new Intent().putExtra("pos", vv == null ? 0 : vv.getCurrentPosition()));
        finish();
    }

    @Override
    public void onBackPressed() { finishOk(); }

    @Override
    protected void onPause() {
        super.onPause();
        if (vv != null) {
            int p = vv.getCurrentPosition();
            if (p > 0) pos = p;
            vv.pause();
            wasPlaying = false;      // pausiert bleiben, bis man selbst wieder auf Abspielen tippt
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        // VideoView gibt beim Verlassen seine Fläche frei und öffnet die Datei danach neu (onPrepared springt dann an pos)
        if (vv != null && pos > 0 && !vv.isPlaying() && vv.getCurrentPosition() != pos) vv.seekTo(pos);
    }

    @Override
    protected void onSaveInstanceState(Bundle o) {
        super.onSaveInstanceState(o);
        if (vv != null) { int p = vv.getCurrentPosition(); o.putInt("pos", p > 0 ? p : pos); o.putBoolean("playing", wasPlaying); }
    }

    @Override
    protected void onDestroy() {
        if (vv != null) { try { vv.stopPlayback(); } catch (Exception e) { /* egal */ } }
        super.onDestroy();
    }
}
