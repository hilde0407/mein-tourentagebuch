package de.tourentagebuch.app;

import android.Manifest;
import android.app.Activity;
import android.content.ContentUris;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.DocumentsContract;
import android.provider.MediaStore;
import android.provider.OpenableColumns;
import android.provider.Settings;
import android.view.ViewGroup;
import android.webkit.GeolocationPermissions;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;

/**
 * Mein Tourentagebuch: eine WebView zeigt die Oberfläche aus den Assets unter https://app.local/.
 * Alle Daten liegen auf dem Handy. Die Brücke "MTApp" erledigt, was eine Webseite nicht kann
 * (Netzwerk ohne CORS, Dateien, Fotos, SMB, GPS-Aufzeichnung, Sprachansagen).
 */
public class MainActivity extends Activity {
    static final String HOST = "app.local";
    private static final int REQ_PERM = 11, REQ_PICK = 12, REQ_PHOTO = 13, REQ_TREE = 14, REQ_PERM2 = 15;
    private WebView web;
    private SharedPreferences prefs;
    private GeolocationPermissions.Callback geoCb;
    private String geoOrigin;
    private final ExecutorService pool = Executors.newFixedThreadPool(3);
    private final Map<Integer, String> pending = new HashMap<>();
    private final OkHttpClient http = new OkHttpClient.Builder()
            .connectTimeout(20, TimeUnit.SECONDS).readTimeout(90, TimeUnit.SECONDS).writeTimeout(90, TimeUnit.SECONDS)
            .followRedirects(true).build();

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        prefs = getSharedPreferences("app", MODE_PRIVATE);
        AppLog.init(this);
        web = new WebView(this);
        setContentView(web, new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setGeolocationEnabled(true);
        s.setAllowFileAccess(false);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setUserAgentString(s.getUserAgentString() + " Tourentagebuch/1.0");
        web.addJavascriptInterface(new Bridge(), "MTApp");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest r) {
                Uri u = r.getUrl();
                if (u == null || !HOST.equals(u.getHost())) return null;
                return serve(u.getPath() == null ? "/" : u.getPath());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                Uri u = r.getUrl();
                if (u != null && HOST.equals(u.getHost())) return false;
                try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception e) { /* keine App */ }
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback cb) {
                if (hasLoc()) { cb.invoke(origin, true, false); return; }
                geoCb = cb;
                geoOrigin = origin;
                requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION}, REQ_PERM);
            }
        });
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED)
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, REQ_PERM2);
        if (b != null) web.restoreState(b);
        else web.loadUrl("https://" + HOST + "/index.html");
        handleIntent(getIntent());
    }

    /* ---------- virtueller Server: Assets, Fotos, Cache ---------- */
    private static String mime(String p) {
        String l = p.toLowerCase();
        if (l.endsWith(".html")) return "text/html";
        if (l.endsWith(".js")) return "application/javascript";
        if (l.endsWith(".css")) return "text/css";
        if (l.endsWith(".json") || l.endsWith(".webmanifest")) return "application/json";
        if (l.endsWith(".png")) return "image/png";
        if (l.endsWith(".jpg") || l.endsWith(".jpeg")) return "image/jpeg";
        if (l.endsWith(".svg")) return "image/svg+xml";
        if (l.endsWith(".gpx") || l.endsWith(".xml") || l.endsWith(".tcx")) return "application/xml";
        return "application/octet-stream";
    }

    private WebResourceResponse serve(String path) {
        try {
            InputStream in = null;
            if (path.equals("/")) path = "/index.html";
            if (path.startsWith("/photo/") || path.startsWith("/thumb/") || path.startsWith("/cache/")) {
                File base = path.startsWith("/photo/") ? Photos.dir(this) : path.startsWith("/thumb/") ? Photos.thumbDir(this) : getCacheDir();
                String rel = path.substring(path.indexOf('/', 1) + 1);
                File f = new File(base, rel);
                if (!f.getCanonicalPath().startsWith(base.getCanonicalPath() + File.separator) || !f.isFile()) return resp(404, "text/plain", new ByteArrayInputStream(new byte[0]));
                in = new FileInputStream(f);
            } else {
                in = getAssets().open("www" + path);
            }
            return resp(200, mime(path), in);
        } catch (Exception e) {
            return resp(404, "text/plain", new ByteArrayInputStream(new byte[0]));
        }
    }

    private static WebResourceResponse resp(int code, String mime, InputStream in) {
        Map<String, String> h = new HashMap<>();
        h.put("Cache-Control", "no-cache");
        h.put("Access-Control-Allow-Origin", "*");
        WebResourceResponse r = new WebResourceResponse(mime, mime.startsWith("text/") || mime.contains("javascript") || mime.contains("json") || mime.contains("xml") ? "UTF-8" : null, in);
        r.setStatusCodeAndReasonPhrase(code, code == 200 ? "OK" : "Not Found");
        r.setResponseHeaders(h);
        return r;
    }

    private boolean hasLoc() { return checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED; }

    @Override protected void onNewIntent(Intent in) { super.onNewIntent(in); setIntent(in); handleIntent(in); }
    @Override protected void onSaveInstanceState(Bundle o) { super.onSaveInstanceState(o); web.saveState(o); }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
        js("window.dispatchEvent(new Event('mtresume'))");
    }

    @Override
    public void onBackPressed() {
        web.evaluateJavascript("(window.mtBack&&window.mtBack())===true", v -> {
            if (!"true".equals(v)) { if (web.canGoBack()) web.goBack(); else MainActivity.super.onBackPressed(); }
        });
    }

    private void js(String code) { runOnUiThread(() -> web.evaluateJavascript(code, null)); }

    /* ---------- Teilen / Öffnen mit ---------- */
    private void handleIntent(Intent in) {
        if (in == null) return;
        String act = in.getAction();
        final ArrayList<Uri> uris = new ArrayList<>();
        if (Intent.ACTION_SEND.equals(act)) {
            Uri u = in.getParcelableExtra(Intent.EXTRA_STREAM);
            if (u != null) uris.add(u);
            String t = in.getStringExtra(Intent.EXTRA_TEXT);
            if (u == null && t != null) {
                try { queue("sharedtext", new JSONObject().put("text", t)); } catch (Exception e) { /* ignorieren */ }
                js("window.dispatchEvent(new Event('mtshared'))");
                return;
            }
        } else if (Intent.ACTION_SEND_MULTIPLE.equals(act)) {
            ArrayList<Uri> l = in.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
            if (l != null) uris.addAll(l);
        } else if (Intent.ACTION_VIEW.equals(act) && in.getData() != null) {
            uris.add(in.getData());
        }
        if (uris.isEmpty()) return;
        in.setAction(null);
        pool.execute(() -> {
            try {
                JSONArray arr = copyToCache(uris);
                for (int i = 0; i < arr.length(); i++) queue("shared", arr.getJSONObject(i));
                js("window.dispatchEvent(new Event('mtshared'))");
            } catch (Exception e) { AppLog.log("Teilen: " + e); }
        });
    }

    private synchronized void queue(String key, JSONObject o) {
        try {
            JSONArray a = new JSONArray(prefs.getString(key, "[]"));
            a.put(o);
            prefs.edit().putString(key, a.toString()).apply();
        } catch (Exception e) { /* ignorieren */ }
    }

    private synchronized String take(String key) {
        String v = prefs.getString(key, "[]");
        prefs.edit().remove(key).apply();
        return v;
    }

    private String nameOf(Uri u) {
        String name = null;
        try (Cursor cur = getContentResolver().query(u, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (cur != null && cur.moveToFirst()) name = cur.getString(0);
        } catch (Exception e) { /* Name aus Pfad */ }
        if (name == null || name.isEmpty()) name = u.getLastPathSegment() == null ? "datei" : u.getLastPathSegment();
        return name.replaceAll("[^A-Za-z0-9._ -]", "_");
    }

    private JSONArray copyToCache(ArrayList<Uri> uris) throws Exception {
        File dir = new File(getCacheDir(), "imp");
        dir.mkdirs();
        JSONArray out = new JSONArray();
        for (Uri u : uris) {
            String name = nameOf(u);
            File f = new File(dir, System.nanoTime() + "_" + name.replace(' ', '_'));
            try (InputStream in = getContentResolver().openInputStream(u); OutputStream o = new FileOutputStream(f)) {
                byte[] b = new byte[64 * 1024];
                int n;
                while (in != null && (n = in.read(b)) > 0) o.write(b, 0, n);
            }
            out.put(new JSONObject().put("name", name).put("url", "/cache/imp/" + f.getName()).put("path", f.getAbsolutePath()).put("size", f.length()));
        }
        return out;
    }

    /* ---------- Ergebnisse von Auswahldialogen ---------- */
    @Override
    protected void onActivityResult(int req, int res, Intent data) {
        String cid = pending.remove(req);
        if (req == REQ_PHOTO) {
            final String pf = prefs.getString("pend_file", "");
            final double la = Double.longBitsToDouble(prefs.getLong("pend_lat", Double.doubleToLongBits(Double.NaN)));
            final double lo = Double.longBitsToDouble(prefs.getLong("pend_lon", Double.doubleToLongBits(Double.NaN)));
            final long ts = prefs.getLong("pend_ts", System.currentTimeMillis());
            prefs.edit().remove("pend_file").apply();
            final File f = new File(PhotoProvider.camDir(this), pf);
            if (res == RESULT_OK && !pf.isEmpty() && f.length() > 0) {
                pool.execute(() -> {
                    try (InputStream in = new FileInputStream(f)) {
                        JSONObject m = Photos.importStream(getApplicationContext(), in, "Kamera.jpg", ts, la, lo, ts, "kamera");
                        queue("photoq", m);
                        js("window.dispatchEvent(new Event('mtphoto'))");
                    } catch (Exception e) { AppLog.log("Kamera-Foto: " + e); }
                    f.delete();
                });
            } else if (!pf.isEmpty()) f.delete();
            return;
        }
        if (cid == null) return;
        final String id = cid;
        if (res != RESULT_OK || data == null) { reply(id, true, "[]"); return; }
        if (req == REQ_TREE) {
            Uri t = data.getData();
            try {
                getContentResolver().takePersistableUriPermission(t, Intent.FLAG_GRANT_READ_URI_PERMISSION);
            } catch (Exception e) { /* nur für diese Sitzung */ }
            String nm = t == null ? "" : String.valueOf(t.getLastPathSegment());
            try { reply(id, true, new JSONObject().put("tree", String.valueOf(t)).put("name", nm).toString()); } catch (Exception e) { reply(id, false, e.toString()); }
            return;
        }
        final ArrayList<Uri> uris = new ArrayList<>();
        if (data.getClipData() != null) for (int i = 0; i < data.getClipData().getItemCount(); i++) uris.add(data.getClipData().getItemAt(i).getUri());
        else if (data.getData() != null) uris.add(data.getData());
        final boolean photos = "photos".equals(prefs.getString("pick_kind_" + req, ""));
        pool.execute(() -> {
            try {
                if (photos) reply(id, true, importUris(uris, "galerie").toString());
                else reply(id, true, copyToCache(uris).toString());
            } catch (Exception e) { reply(id, false, String.valueOf(e)); }
        });
    }

    private JSONArray importUris(java.util.List<Uri> uris, String src) {
        JSONArray out = new JSONArray();
        boolean orig = checkSelfPermission(Manifest.permission.ACCESS_MEDIA_LOCATION) == PackageManager.PERMISSION_GRANTED;
        for (Uri u0 : uris) {
            try {
                Uri u = u0;
                if (orig && "media".equals(u0.getAuthority())) {
                    try { u = MediaStore.setRequireOriginal(u0); } catch (Exception e) { u = u0; }
                }
                long fb = 0;
                try (Cursor cur = getContentResolver().query(u0, new String[]{DocumentsContract.Document.COLUMN_LAST_MODIFIED}, null, null, null)) {
                    if (cur != null && cur.moveToFirst()) fb = cur.getLong(0);
                } catch (Exception e) { /* ohne */ }
                InputStream in;
                try { in = getContentResolver().openInputStream(u); } catch (Exception e) { in = getContentResolver().openInputStream(u0); }
                try {
                    out.put(Photos.importStream(this, in, nameOf(u0), fb, Double.NaN, Double.NaN, 0, src));
                } finally { if (in != null) in.close(); }
            } catch (Exception e) { AppLog.log("Foto-Import: " + e); }
        }
        return out;
    }

    @Override
    public void onRequestPermissionsResult(int req, String[] perms, int[] res) {
        if (geoCb != null) { geoCb.invoke(geoOrigin, hasLoc(), false); geoCb = null; }
        js("window.dispatchEvent(new CustomEvent('mtperm',{detail:" + (hasLoc() ? "true" : "false") + "}))");
        String cid = pending.remove(req);
        if (cid != null) reply(cid, true, "{\"granted\":" + (res.length > 0 && res[0] == PackageManager.PERMISSION_GRANTED) + "}");
    }

    private void reply(String id, boolean ok, String json) {
        js("window.__mtcb(" + Integer.parseInt(id) + "," + ok + "," + JSONObject.quote(json) + ")");
    }

    private void pick(String id, int req, String[] types, boolean multi, boolean photos) {
        pending.put(req, id);
        prefs.edit().putString("pick_kind_" + req, photos ? "photos" : "files").apply();
        runOnUiThread(() -> {
            Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE);
            i.setType(types.length == 1 ? types[0] : "*/*");
            if (types.length > 1) i.putExtra(Intent.EXTRA_MIME_TYPES, types);
            i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, multi);
            try { startActivityForResult(i, req); } catch (Exception e) { reply(id, false, "Kein Dateiauswahl-Dialog"); }
        });
    }

    /* ---------- Brücke zur Weboberfläche ---------- */
    public class Bridge {
        @JavascriptInterface public String version() { return "1.0.0"; }

        /** Einziger Einstieg für alles Asynchrone: Ergebnis kommt über window.__mtcb(id, ok, json). */
        @JavascriptInterface
        public void call(final String id, final String method, final String argsJson) {
            pool.execute(() -> {
                try {
                    JSONObject a = new JSONObject(argsJson == null || argsJson.isEmpty() ? "{}" : argsJson);
                    String r = dispatch(id, method, a);
                    if (r != null) reply(id, true, r);
                } catch (Throwable e) {
                    AppLog.log("call " + method + ": " + e);
                    reply(id, false, String.valueOf(e.getMessage() == null ? e.toString() : e.getMessage()));
                }
            });
        }

        // ---- synchrone, schnelle Aufrufe ----
        @JavascriptInterface public void startRecording(String sport, String name) { Recorder.get(MainActivity.this).start(sport, name); }
        @JavascriptInterface public void pauseRecording() { Recorder.get(MainActivity.this).pause(); }
        @JavascriptInterface public void resumeRecording() { Recorder.get(MainActivity.this).resume(); }
        @JavascriptInterface public void stopRecording(String name) { Recorder.get(MainActivity.this).stop(name); }
        @JavascriptInterface public String status() { return Recorder.get(MainActivity.this).statusJson(); }
        @JavascriptInterface public String points(int max) { return Recorder.get(MainActivity.this).store().pointsJson(max); }
        @JavascriptInterface public String takeFinished() { return Recorder.get(MainActivity.this).finishedGpx(); }
        @JavascriptInterface public void discardRecording() { Recorder.get(MainActivity.this).discard(); }
        @JavascriptInterface public String backups() { return Recorder.get(MainActivity.this).backupsJson(); }
        @JavascriptInterface public String backupGpx(String f) { return Recorder.get(MainActivity.this).backupGpx(f); }
        @JavascriptInterface public void bgStart(String title, String text, int i, int n) { ImportService.start(MainActivity.this, title, text, i, n); }
        @JavascriptInterface public void bgStop(String doneText) { ImportService.stop(MainActivity.this, doneText); }
        @JavascriptInterface public String takePhotoQueue() { return take("photoq"); }
        @JavascriptInterface public String takeShared() { return take("shared"); }
        @JavascriptInterface public String takeSharedText() { return take("sharedtext"); }
        @JavascriptInterface public void setRoute(String pts, String name) { Navi.setRoute(MainActivity.this, pts, name); }
        @JavascriptInterface public String routePoints() { return Navi.points(MainActivity.this); }
        @JavascriptInterface public void clearRoute() { Navi.clear(MainActivity.this); }
        @JavascriptInterface public String routeInfo() { return Navi.info(MainActivity.this); }
        @JavascriptInterface public void setGuide(boolean on) { Navi.setEnabled(MainActivity.this, on); }
        @JavascriptInterface public void guideTest() { Navi.speak(MainActivity.this, "Die Sprachansagen sind eingeschaltet. In 100 Metern links abbiegen."); }
        @JavascriptInterface public boolean hasPermission() { return hasLoc(); }
        @JavascriptInterface public String logText() { return AppLog.tail(30000); }
        @JavascriptInterface public void clearLog() { AppLog.clear(); }
        @JavascriptInterface public void appLog(String m) { AppLog.log("[Web] " + m); }

        @JavascriptInterface
        public void requestPermission() {
            runOnUiThread(() -> requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION}, REQ_PERM));
        }

        @JavascriptInterface
        public void openBatterySettings() {
            runOnUiThread(() -> {
                try { startActivity(new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)); }
                catch (Exception e) { startActivity(new Intent(Settings.ACTION_SETTINGS)); }
            });
        }

        @JavascriptInterface
        public void openUrl(String u) {
            runOnUiThread(() -> {
                try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(u)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); }
                catch (Exception e) { Toast.makeText(MainActivity.this, "Keine App dafür gefunden", Toast.LENGTH_LONG).show(); }
            });
        }

        @JavascriptInterface
        public void shareText(String text) {
            runOnUiThread(() -> {
                Intent i = new Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text);
                startActivity(Intent.createChooser(i, "Senden mit …"));
            });
        }

        @JavascriptInterface
        public boolean takePhoto() {
            Recorder r = Recorder.get(MainActivity.this);
            double la = r.store().lastLat(), lo = r.store().lastLon();
            if (Double.isNaN(la)) {
                try {
                    android.location.LocationManager lm = (android.location.LocationManager) getSystemService(LOCATION_SERVICE);
                    android.location.Location l = hasLoc() ? lm.getLastKnownLocation(android.location.LocationManager.GPS_PROVIDER) : null;
                    if (l == null && hasLoc()) l = lm.getLastKnownLocation(android.location.LocationManager.NETWORK_PROVIDER);
                    if (l != null) { la = l.getLatitude(); lo = l.getLongitude(); }
                } catch (Exception e) { /* ohne Position */ }
            }
            final File f = new File(PhotoProvider.camDir(MainActivity.this), "cam_" + System.currentTimeMillis() + ".jpg");
            try { f.createNewFile(); } catch (Exception e) { return false; }
            prefs.edit().putString("pend_file", f.getName()).putLong("pend_lat", Double.doubleToLongBits(la))
                    .putLong("pend_lon", Double.doubleToLongBits(lo)).putLong("pend_ts", System.currentTimeMillis()).apply();
            runOnUiThread(() -> {
                try {
                    Uri u = PhotoProvider.uriFor(f);
                    Intent i = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
                    i.putExtra(MediaStore.EXTRA_OUTPUT, u);
                    i.setClipData(android.content.ClipData.newRawUri("", u));
                    i.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    startActivityForResult(i, REQ_PHOTO);
                } catch (Exception e) {
                    prefs.edit().remove("pend_file").apply();
                    f.delete();
                    Toast.makeText(MainActivity.this, "Keine Kamera-App gefunden", Toast.LENGTH_LONG).show();
                }
            });
            return true;
        }
    }

    /** Alle Aufrufe über Bridge.call. Gibt JSON zurück oder null, wenn die Antwort später (Dialog) kommt. */
    private String dispatch(String id, String m, JSONObject a) throws Exception {
        switch (m) {
            case "info": {
                return new JSONObject().put("version", "1.0.0").put("android", Build.VERSION.RELEASE + " (API " + Build.VERSION.SDK_INT + ")")
                        .put("device", Build.MANUFACTURER + " " + Build.MODEL).put("loc", hasLoc())
                        .put("battery_free", ((android.os.PowerManager) getSystemService(POWER_SERVICE)).isIgnoringBatteryOptimizations(getPackageName()))
                        .put("rec", new JSONObject(Recorder.get(this).statusJson())).toString();
            }
            case "http": return httpCall(a);
            case "download": return download(a);
            case "pickFiles": pick(id, REQ_PICK, new String[]{"*/*"}, true, false); return null;
            case "pickPhotos": pick(id, REQ_PICK + 100, new String[]{"image/*"}, true, true); return null;
            case "pickFolder": {
                pending.put(REQ_TREE, id);
                runOnUiThread(() -> {
                    try { startActivityForResult(new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION), REQ_TREE); }
                    catch (Exception e) { reply(id, false, "Kein Ordner-Dialog"); }
                });
                return null;
            }
            case "perm": {
                String[] want = Build.VERSION.SDK_INT >= 33
                        ? new String[]{Manifest.permission.READ_MEDIA_IMAGES, Manifest.permission.ACCESS_MEDIA_LOCATION}
                        : new String[]{Manifest.permission.READ_EXTERNAL_STORAGE, Manifest.permission.ACCESS_MEDIA_LOCATION};
                if (checkSelfPermission(want[0]) == PackageManager.PERMISSION_GRANTED) return "{\"granted\":true}";
                pending.put(REQ_PERM + 50, id);
                runOnUiThread(() -> requestPermissions(want, REQ_PERM + 50));
                return null;
            }
            case "galleryRange": {
                long from = a.optLong("from"), to = a.optLong("to");
                JSONArray out = new JSONArray();
                String[] proj = {MediaStore.Images.Media._ID, MediaStore.Images.Media.DATE_TAKEN, MediaStore.Images.Media.DISPLAY_NAME};
                try (Cursor c = getContentResolver().query(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, proj,
                        MediaStore.Images.Media.DATE_TAKEN + " BETWEEN ? AND ?", new String[]{String.valueOf(from), String.valueOf(to)},
                        MediaStore.Images.Media.DATE_TAKEN + " ASC")) {
                    while (c != null && c.moveToNext() && out.length() < 400)
                        out.put(new JSONObject().put("uri", ContentUris.withAppendedId(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, c.getLong(0)).toString())
                                .put("ts", c.getLong(1)).put("name", c.getString(2)));
                }
                return out.toString();
            }
            case "folderScan": {
                Uri tree = Uri.parse(a.getString("tree"));
                long since = a.optLong("since", 0);
                JSONArray out = new JSONArray();
                scanTree(tree, DocumentsContract.getTreeDocumentId(tree), since, out, 0);
                return out.toString();
            }
            case "importUris": {
                JSONArray ua = a.getJSONArray("uris");
                ArrayList<Uri> l = new ArrayList<>();
                for (int i = 0; i < ua.length(); i++) l.add(Uri.parse(ua.getString(i)));
                return importUris(l, a.optString("src", "galerie")).toString();
            }
            case "copyUris": {
                JSONArray ua = a.getJSONArray("uris");
                ArrayList<Uri> l = new ArrayList<>();
                for (int i = 0; i < ua.length(); i++) l.add(Uri.parse(ua.getString(i)));
                return copyToCache(l).toString();
            }
            case "importFiles": {   // Fotos aus Cache-Dateien (z. B. nach WebDAV-Download)
                JSONArray pa = a.getJSONArray("paths");
                JSONArray out = new JSONArray();
                for (int i = 0; i < pa.length(); i++) {
                    File f = new File(pa.getString(i));
                    if (!f.getCanonicalPath().startsWith(getCacheDir().getCanonicalPath())) continue;
                    try { out.put(Photos.importFile(this, f, a.optString("src", "web"))); } catch (Exception e) { AppLog.log("Foto: " + e); }
                    f.delete();
                }
                return out.toString();
            }
            case "deletePhoto": Photos.delete(this, a.optString("id")); return "true";
            case "smbList": return Smb.list(a).toString();
            case "smbImport": return Smb.importPhotos(this, a, a.getJSONArray("files")).toString();
            case "smbFetch": {
                File f = Smb.fetch(this, a, a.getString("path"));
                return new JSONObject().put("name", f.getName()).put("url", "/cache/imp/" + f.getName()).put("size", f.length()).toString();
            }
            case "saveFile": return saveFile(a);
            case "readFileB64": {
                File f = new File(a.getString("path"));
                if (!f.getCanonicalPath().startsWith(getCacheDir().getCanonicalPath())) throw new Exception("Pfad nicht erlaubt");
                return JSONObject.quote(android.util.Base64.encodeToString(java.nio.file.Files.readAllBytes(f.toPath()), android.util.Base64.NO_WRAP));
            }
            case "clearCache": {
                File[] fs = new File(getCacheDir(), "imp").listFiles();
                if (fs != null) for (File f : fs) f.delete();
                return "true";
            }
            case "storage": {
                long ph = 0;
                File[] fs = Photos.dir(this).listFiles();
                if (fs != null) for (File f : fs) ph += f.length();
                return new JSONObject().put("photos", fs == null ? 0 : fs.length).put("bytes", ph).toString();
            }
            default: throw new Exception("unbekannt: " + m);
        }
    }

    private void scanTree(Uri tree, String docId, long since, JSONArray out, int depth) {
        if (depth > 4 || out.length() > 3000) return;
        Uri kids = DocumentsContract.buildChildDocumentsUriUsingTree(tree, docId);
        String[] proj = {DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                DocumentsContract.Document.COLUMN_MIME_TYPE, DocumentsContract.Document.COLUMN_LAST_MODIFIED};
        ArrayList<String> dirs = new ArrayList<>();
        try (Cursor c = getContentResolver().query(kids, proj, null, null, null)) {
            while (c != null && c.moveToNext()) {
                String mt = c.getString(2), nm = c.getString(1);
                if (DocumentsContract.Document.MIME_TYPE_DIR.equals(mt)) { dirs.add(c.getString(0)); continue; }
                boolean img = (mt != null && mt.startsWith("image/")) || (nm != null && nm.toLowerCase().matches(".*\\.(jpe?g|png|heic|webp)"));
                boolean gpx = nm != null && nm.toLowerCase().matches(".*\\.(gpx|fit|tcx)");
                long lm = c.getLong(3);
                if ((img || gpx) && lm >= since) {
                    try {
                        out.put(new JSONObject().put("uri", DocumentsContract.buildDocumentUriUsingTree(tree, c.getString(0)).toString())
                                .put("name", nm).put("mtime", lm).put("kind", img ? "photo" : "track"));
                    } catch (Exception e) { /* überspringen */ }
                }
            }
        } catch (Exception e) { AppLog.log("Ordner: " + e); }
        for (String d : dirs) scanTree(tree, d, since, out, depth + 1);
    }

    private String httpCall(JSONObject a) throws Exception {
        Request.Builder rb = new Request.Builder().url(a.getString("url"));
        JSONObject h = a.optJSONObject("headers");
        if (h != null) { java.util.Iterator<String> it = h.keys(); while (it.hasNext()) { String k = it.next(); rb.header(k, h.getString(k)); } }
        String method = a.optString("method", "GET").toUpperCase();
        RequestBody body = null;
        if (a.has("bodyB64")) body = RequestBody.create(android.util.Base64.decode(a.getString("bodyB64"), android.util.Base64.DEFAULT), MediaType.parse(a.optString("contentType", "application/octet-stream")));
        else if (a.has("body")) body = RequestBody.create(a.getString("body").getBytes("UTF-8"), MediaType.parse(a.optString("contentType", "text/plain; charset=utf-8")));
        else if (!method.equals("GET") && !method.equals("HEAD")) body = RequestBody.create(new byte[0], null);
        rb.method(method, body);
        OkHttpClient cl = a.optBoolean("noRedirect") ? http.newBuilder().followRedirects(false).followSslRedirects(false).build() : http;
        try (Response r = cl.newCall(rb.build()).execute()) {
            JSONObject o = new JSONObject().put("status", r.code());
            JSONObject hh = new JSONObject();
            for (String n : r.headers().names()) hh.put(n.toLowerCase(), r.header(n));
            o.put("headers", hh);
            byte[] data = r.body() == null ? new byte[0] : r.body().bytes();
            if (a.optBoolean("bin")) o.put("b64", android.util.Base64.encodeToString(data, android.util.Base64.NO_WRAP));
            else o.put("body", new String(data, "UTF-8"));
            return o.toString();
        }
    }

    private String download(JSONObject a) throws Exception {
        Request.Builder rb = new Request.Builder().url(a.getString("url"));
        JSONObject h = a.optJSONObject("headers");
        if (h != null) { java.util.Iterator<String> it = h.keys(); while (it.hasNext()) { String k = it.next(); rb.header(k, h.getString(k)); } }
        File dir = new File(getCacheDir(), "imp");
        dir.mkdirs();
        File f = new File(dir, System.nanoTime() + "_" + a.optString("name", "datei").replaceAll("[^A-Za-z0-9._-]", "_"));
        try (Response r = http.newCall(rb.build()).execute()) {
            if (!r.isSuccessful()) throw new Exception("HTTP " + r.code());
            try (InputStream in = r.body().byteStream(); OutputStream o = new FileOutputStream(f)) {
                byte[] b = new byte[64 * 1024];
                int n;
                while ((n = in.read(b)) > 0) o.write(b, 0, n);
            }
        }
        return new JSONObject().put("name", f.getName()).put("path", f.getAbsolutePath()).put("url", "/cache/imp/" + f.getName()).put("size", f.length()).toString();
    }

    /** Speichert eine Datei im Download-Ordner des Handys (ohne Berechtigung über MediaStore). */
    private String saveFile(JSONObject a) throws Exception {
        String name = a.getString("name").replaceAll("[^A-Za-z0-9._ -]", "_");
        byte[] data = a.has("b64") ? android.util.Base64.decode(a.getString("b64"), android.util.Base64.DEFAULT) : a.optString("text").getBytes("UTF-8");
        String mt = a.optString("mime", "application/octet-stream");
        if (Build.VERSION.SDK_INT >= 29) {
            android.content.ContentValues v = new android.content.ContentValues();
            v.put(MediaStore.Downloads.DISPLAY_NAME, name);
            v.put(MediaStore.Downloads.MIME_TYPE, mt);
            v.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/Tourentagebuch");
            Uri u = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
            if (u == null) throw new Exception("Speichern nicht möglich");
            try (OutputStream o = getContentResolver().openOutputStream(u)) { o.write(data); }
            return JSONObject.quote("Download/Tourentagebuch/" + name);
        }
        File d = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), "Tourentagebuch");
        d.mkdirs();
        try (OutputStream o = new FileOutputStream(new File(d, name))) { o.write(data); }
        return JSONObject.quote("Download/Tourentagebuch/" + name);
    }
}
