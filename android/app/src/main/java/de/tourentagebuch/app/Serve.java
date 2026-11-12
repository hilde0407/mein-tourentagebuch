package de.tourentagebuch.app;

import android.content.Context;
import android.webkit.WebResourceResponse;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Map;

/**
 * Virtueller Server der App: beantwortet die Anfragen des WebView an https://app.tourentagebuch
 * aus den Assets (Oberfläche) und den privaten Ordnern (Fotos, Vorschaubilder, Videos, Cache).
 */
final class Serve {
    private Serve() { }

    static WebResourceResponse handle(Context c, String path, String range) {
        try {
            InputStream in;
            if (path.equals("/")) path = "/index.html";
            if (path.startsWith("/photo/") || path.startsWith("/thumb/") || path.startsWith("/cache/")) {
                File base = path.startsWith("/photo/") ? Photos.dir(c) : path.startsWith("/thumb/") ? Photos.thumbDir(c) : c.getCacheDir();
                String rel = path.substring(path.indexOf('/', 1) + 1);
                File f = new File(base, rel);
                if (!f.getCanonicalPath().startsWith(base.getCanonicalPath() + File.separator) || !f.isFile()) return resp(404, "text/plain", new ByteArrayInputStream(new byte[0]));
                if (path.endsWith(".mp4")) return video(f, range);
                in = new FileInputStream(f);
            } else {
                in = c.getAssets().open("www" + path);
            }
            return resp(200, mime(path), in);
        } catch (Exception e) {
            return resp(404, "text/plain", new ByteArrayInputStream(new byte[0]));
        }
    }

    private static String mime(String p) {
        String l = p.toLowerCase();
        if (l.endsWith(".html")) return "text/html";
        if (l.endsWith(".js")) return "application/javascript";
        if (l.endsWith(".css")) return "text/css";
        if (l.endsWith(".json") || l.endsWith(".webmanifest")) return "application/json";
        if (l.endsWith(".png")) return "image/png";
        if (l.endsWith(".mp4")) return "video/mp4";
        if (l.endsWith(".jpg") || l.endsWith(".jpeg")) return "image/jpeg";
        if (l.endsWith(".svg")) return "image/svg+xml";
        if (l.endsWith(".gpx") || l.endsWith(".xml") || l.endsWith(".tcx")) return "application/xml";
        return "application/octet-stream";
    }

    /** Video mit Bereichsabfrage (Range), damit man darin springen kann. */
    private static WebResourceResponse video(File f, String range) throws Exception {
        long len = f.length(), a = 0, b = len - 1;
        boolean part = false;
        if (range != null && range.startsWith("bytes=")) {
            try {
                String[] p = range.substring(6).split("-", 2);
                if (!p[0].isEmpty()) a = Long.parseLong(p[0]);
                if (p.length > 1 && !p[1].isEmpty()) b = Math.min(len - 1, Long.parseLong(p[1]));
                part = a <= b && a < len;
            } catch (NumberFormatException e) { part = false; a = 0; b = len - 1; }
        }
        FileInputStream in = new FileInputStream(f);
        if (part && a > 0) in.skip(a);
        final long left = b - a + 1;
        InputStream lim = part ? new java.io.FilterInputStream(in) {
            long rest = left;
            @Override public int read() throws java.io.IOException { if (rest <= 0) return -1; int r = super.read(); if (r >= 0) rest--; return r; }
            @Override public int read(byte[] buf, int o, int n) throws java.io.IOException { if (rest <= 0) return -1; int r = super.read(buf, o, (int) Math.min(n, rest)); if (r > 0) rest -= r; return r; }
        } : in;
        Map<String, String> h = new HashMap<>();
        h.put("Cache-Control", "no-cache");
        h.put("Access-Control-Allow-Origin", "*");
        h.put("Accept-Ranges", "bytes");
        h.put("Content-Length", Long.toString(part ? left : len));
        if (part) h.put("Content-Range", "bytes " + a + "-" + b + "/" + len);
        WebResourceResponse r = new WebResourceResponse("video/mp4", null, lim);
        r.setStatusCodeAndReasonPhrase(part ? 206 : 200, part ? "Partial Content" : "OK");
        r.setResponseHeaders(h);
        return r;
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
}
