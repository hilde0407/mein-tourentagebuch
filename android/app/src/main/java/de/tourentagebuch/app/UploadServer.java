package de.tourentagebuch.app;

import android.content.Context;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Enumeration;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Fotos vom Rechner empfangen: Solange der Dialog in der App offen ist, hört das Handy im WLAN auf einem Port.
 * Am Rechner öffnet man die angezeigte Adresse im Browser und wirft Fotos auf die Seite. Die Adresse enthält ein
 * zufälliges Kennwort; ohne es antwortet der Server nicht. Die Übertragung ist unverschlüsselt (nur im eigenen Netz nutzen).
 */
public final class UploadServer {
    private static final long MAX_BYTES = 120L * 1024 * 1024;
    private static ServerSocket server;
    private static ExecutorService pool;
    private static String token;
    private static Context ctx;
    private static final List<JSONObject> done = Collections.synchronizedList(new ArrayList<JSONObject>());
    private static volatile int failed = 0;

    private UploadServer() { }

    public static synchronized JSONObject start(Context c) throws Exception {
        // Läuft schon ein Empfang, die laufende Adresse weitergeben statt sie durch eine neue zu ersetzen –
        // sonst wird eine gerade angezeigte Adresse ungültig, wenn der Dialog aus Versehen zweimal geöffnet wird.
        if (server != null && !server.isClosed()) return info();
        ctx = c.getApplicationContext();
        byte[] r = new byte[5];
        new SecureRandom().nextBytes(r);
        StringBuilder sb = new StringBuilder();
        for (byte b : r) sb.append("abcdefghjkmnpqrstuvwxyz23456789".charAt((b & 0xff) % 31));
        token = sb.toString();
        try { server = new ServerSocket(8765); } catch (IOException e) { server = new ServerSocket(0); }
        pool = Executors.newFixedThreadPool(3);
        done.clear();
        failed = 0;
        final ServerSocket s = server;
        Thread t = new Thread(new Runnable() {
            @Override public void run() {
                while (!s.isClosed()) {
                    try {
                        final Socket k = s.accept();
                        pool.execute(new Runnable() { @Override public void run() { handle(k); } });
                    } catch (Exception e) { if (!s.isClosed()) AppLog.log("Empfang: " + e); }
                }
            }
        }, "upload-server");
        t.setDaemon(true);
        t.start();
        return info();
    }

    private static JSONObject info() throws Exception {
        String ip = localIp();
        return new JSONObject().put("ip", ip == null ? "" : ip).put("port", server.getLocalPort()).put("token", token)
                .put("url", ip == null ? "" : "http://" + ip + ":" + server.getLocalPort() + "/" + token + "/");
    }

    public static synchronized void stop() {
        try { if (server != null) server.close(); } catch (Exception e) { /* egal */ }
        server = null;
        if (pool != null) { pool.shutdownNow(); pool = null; }
    }

    /** Seit dem letzten Abruf fertig importierte Fotos (Meta-Daten) und Zahl der Fehler. */
    public static JSONObject poll() throws Exception {
        JSONArray a = new JSONArray();
        synchronized (done) { for (JSONObject j : done) a.put(j); done.clear(); }
        return new JSONObject().put("photos", a).put("failed", failed).put("running", server != null);
    }

    /** Namen virtueller Schnittstellen, deren Adresse ein anderes Gerät im WLAN nicht erreichen kann
     * (Mobilfunk-Tunnel, IPv6-zu-IPv4-Übersetzung, eigener Hotspot, VPN) – hier nie die Adresse hernehmen. */
    private static final String[] SKIP_IF = {"rmnet", "v4-", "clat", "ap", "p2p", "tun", "ipsec", "dummy"};

    static String localIp() {
        try {
            String fallback = null;
            for (Enumeration<NetworkInterface> e = NetworkInterface.getNetworkInterfaces(); e.hasMoreElements(); ) {
                NetworkInterface n = e.nextElement();
                if (!n.isUp() || n.isLoopback()) continue;
                String name = n.getName() == null ? "" : n.getName();
                boolean skip = false;
                for (String s : SKIP_IF) if (name.startsWith(s)) { skip = true; break; }
                if (skip) continue;
                for (Enumeration<InetAddress> ad = n.getInetAddresses(); ad.hasMoreElements(); ) {
                    InetAddress a = ad.nextElement();
                    if (a instanceof Inet4Address && a.isSiteLocalAddress()) {
                        if (name.startsWith("wlan") || name.startsWith("eth")) return a.getHostAddress();
                        if (fallback == null) fallback = a.getHostAddress();
                    }
                }
            }
            return fallback;
        } catch (Exception e) { return null; }
    }

    private static String readLine(InputStream in) throws IOException {
        ByteArrayOutputStream b = new ByteArrayOutputStream();
        int c;
        while ((c = in.read()) >= 0) {
            if (c == '\n') break;
            if (c != '\r') b.write(c);
            if (b.size() > 8192) throw new IOException("Zeile zu lang");
        }
        if (c < 0 && b.size() == 0) return null;
        return new String(b.toByteArray(), StandardCharsets.ISO_8859_1);
    }

    private static void reply(OutputStream o, int code, String type, byte[] body) throws IOException {
        String head = "HTTP/1.1 " + code + (code == 200 ? " OK" : " Error") + "\r\nContent-Type: " + type + "\r\nContent-Length: " + body.length
                + "\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n";
        o.write(head.getBytes(StandardCharsets.ISO_8859_1));
        o.write(body);
        o.flush();
    }

    private static String param(String q, String key) throws Exception {
        if (q == null) return "";
        for (String p : q.split("&")) {
            int i = p.indexOf('=');
            if (i > 0 && p.substring(0, i).equals(key)) return URLDecoder.decode(p.substring(i + 1), "UTF-8");
        }
        return "";
    }

    /** Liest genau n Bytes und meldet dann Dateiende (damit der Import nicht über das Ende hinauslesen kann). */
    private static final class Limited extends InputStream {
        private final InputStream in;
        private long left;
        Limited(InputStream in, long n) { this.in = in; this.left = n; }
        @Override public int read() throws IOException { if (left <= 0) return -1; int c = in.read(); if (c >= 0) left--; return c; }
        @Override public int read(byte[] b, int off, int len) throws IOException {
            if (left <= 0) return -1;
            int n = in.read(b, off, (int) Math.min(len, left));
            if (n > 0) left -= n;
            return n;
        }
        void drain() throws IOException { byte[] b = new byte[8192]; while (left > 0 && read(b, 0, b.length) > 0) { /* weglesen */ } }
    }

    private static void handle(Socket k) {
        try {
            k.setSoTimeout(60000);
            InputStream in = new BufferedInputStream(k.getInputStream());
            OutputStream out = k.getOutputStream();
            String line = readLine(in);
            if (line == null) return;
            String[] rq = line.split(" ");
            if (rq.length < 2) return;
            long len = 0;
            String h;
            while ((h = readLine(in)) != null && h.length() > 0) {
                int i = h.indexOf(':');
                if (i > 0 && h.substring(0, i).trim().equalsIgnoreCase("content-length")) { try { len = Long.parseLong(h.substring(i + 1).trim()); } catch (Exception e) { len = 0; } }
            }
            String path = rq[1], q = null;
            int qi = path.indexOf('?');
            if (qi >= 0) { q = path.substring(qi + 1); path = path.substring(0, qi); }
            int d = UploadRoute.decide(rq[0], path, token);
            if (d == UploadRoute.REDIRECT) {
                byte[] body = "Weitergeleitet".getBytes(StandardCharsets.UTF_8);
                String head = "HTTP/1.1 301 Moved Permanently\r\nLocation: /" + token + "/\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: " + body.length
                        + "\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n";
                out.write(head.getBytes(StandardCharsets.ISO_8859_1)); out.write(body); out.flush();
                return;
            }
            if (d == UploadRoute.NOT_FOUND) { reply(out, 404, "text/plain; charset=utf-8", "Nicht gefunden".getBytes(StandardCharsets.UTF_8)); return; }
            if (d == UploadRoute.PAGE) { reply(out, 200, "text/html; charset=utf-8", PAGE.getBytes(StandardCharsets.UTF_8)); return; }
            if (d == UploadRoute.UPLOAD) {
                if (len <= 0 || len > MAX_BYTES) { reply(out, 413, "application/json", "{\"ok\":false,\"error\":\"Datei zu gro\\u00df oder leer\"}".getBytes(StandardCharsets.UTF_8)); return; }
                Limited body = new Limited(in, len);
                String name = param(q, "n");
                long mtime = 0;
                try { mtime = Long.parseLong(param(q, "m")); } catch (Exception e) { mtime = 0; }
                // Wurde das Foto im Browser vor dem Senden verkleinert, gehen die EXIF-Daten (Position, Aufnahmezeit)
                // dabei verloren; der Browser liest sie vorher selbst aus und schickt sie separat mit.
                double lat = Double.NaN, lon = Double.NaN;
                try { lat = Double.parseDouble(param(q, "lat")); lon = Double.parseDouble(param(q, "lon")); } catch (Exception e) { lat = Double.NaN; lon = Double.NaN; }
                long ts = 0;
                try { ts = Long.parseLong(param(q, "ts")); } catch (Exception e) { ts = 0; }
                try {
                    JSONObject j = Photos.importStream(ctx, body, name.isEmpty() ? null : name, mtime, lat, lon, ts, "rechner");
                    done.add(j);
                    body.drain();
                    reply(out, 200, "application/json", "{\"ok\":true}".getBytes(StandardCharsets.UTF_8));
                } catch (Exception e) {
                    failed++;
                    AppLog.log("Empfang: " + name + ": " + e);
                    try { body.drain(); reply(out, 200, "application/json", "{\"ok\":false,\"error\":\"Kein lesbares Foto\"}".getBytes(StandardCharsets.UTF_8)); } catch (Exception e2) { /* Verbindung weg */ }
                }
                return;
            }
            reply(out, 404, "text/plain; charset=utf-8", "Nicht gefunden".getBytes(StandardCharsets.UTF_8));
        } catch (Exception e) {
            AppLog.log("Empfang: " + e);
        } finally {
            try { k.close(); } catch (Exception e) { /* egal */ }
        }
    }

    private static final String PAGE = "<!doctype html><html lang=de><head><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'><title>Fotos an das Tourentagebuch senden</title>"
            + "<style>body{font:16px system-ui,sans-serif;margin:0;background:#0e2a2b;color:#fff}main{max-width:640px;margin:0 auto;padding:24px}h1{font-size:24px;margin:0 0 8px}"
            + "#drop{border:3px dashed #f2c230;border-radius:16px;padding:48px 16px;text-align:center;margin:20px 0;cursor:pointer}#drop.over{background:#17494a}"
            + "button{background:#f2c230;color:#1a1a1a;border:0;border-radius:10px;padding:12px 20px;font:600 16px system-ui}ul{list-style:none;padding:0}li{padding:6px 0;border-bottom:1px solid #fff3;display:flex;justify-content:space-between;gap:12px}.ok{color:#8be28b}.err{color:#ff9a9a}small{opacity:.8}</style></head>"
            + "<body><main><h1>Fotos an das Tourentagebuch senden</h1><p>Ziehe Fotos hierher oder w&auml;hle sie aus. Sie landen direkt auf dem Handy.</p>"
            + "<div id=drop>Fotos hierher ziehen<br><br><button id=pick type=button>Fotos ausw&auml;hlen</button> <button id=pickdir type=button>Ordner ausw&auml;hlen</button></div>"
            + "<input id=f type=file accept='image/*' multiple hidden><input id=fd type=file webkitdirectory multiple hidden><p id=sum></p><ul id=l></ul>"
            + "<small>Bei &bdquo;Ordner ausw&auml;hlen&ldquo; werden auch alle Bilder in Unterordnern mit hochgeladen.<br>Die &Uuml;bertragung ist nicht verschl&uuml;sselt &ndash; nur im eigenen WLAN nutzen. Die Seite funktioniert nur, solange der Dialog in der App offen ist.</small></main>"
            + "<script>var d=document.getElementById('drop'),f=document.getElementById('f'),fd=document.getElementById('fd'),l=document.getElementById('l'),sum=document.getElementById('sum'),n=0,ok=0,bad=0,q=[],busy=false,MAXPX=2400;"
            + "document.getElementById('pick').onclick=function(e){e.stopPropagation();f.click()};document.getElementById('pickdir').onclick=function(e){e.stopPropagation();fd.click()};d.onclick=function(){f.click()}"
            + ";d.ondragover=function(e){e.preventDefault();d.className='over'};d.ondragleave=function(){d.className=''};d.ondrop=function(e){e.preventDefault();d.className='';add(e.dataTransfer.files)};f.onchange=function(){add(f.files);"
            + "f.value=''};fd.onchange=function(){add(fd.files);fd.value=''};function add(fs){for(var i=0;i<fs.length;i++){if(/^image\\//.test(fs[i].type)||/\\.(jpe?g|png|heic|webp)$/i.test(fs[i].name)){var li=document.createElement('li');"
            + "li.innerHTML='<span></span><span>wartet</span>';li.firstChild.textContent=fs[i].webkitRelativePath||fs[i].name;l.appendChild(li);q.push([fs[i],li]);n++}}upd();run()}function upd(){sum.textContent=ok+' von '+n+' gesendet'+(bad?', '+bad+' fehlgeschlagen':'')}"
            + "function parseExif(buf){var dv=new DataView(buf);if(dv.byteLength<4||dv.getUint16(0)!==0xFFD8)return null;var off=2,app1=null;while(off+4<=dv.byteLength){var marker=dv.getUint16(off);if((marker&0xFF00)!==0xFF00)break;"
            + "if(marker===0xFFD8||marker===0xFFD9){off+=2;continue}if(off+4>dv.byteLength)break;var size=dv.getUint16(off+2);if(marker===0xFFE1){var segStart=off+4;if(dv.getUint32(segStart)===0x45786966&&dv.getUint16(segStart+4)===0x0000){app1=segStart+6}"
            + "break}if(marker>=0xFFD0&&marker<=0xFFD9){off+=2;continue}off+=2+size}if(app1==null)return null;var tiffStart=app1,little=dv.getUint16(tiffStart)===0x4949;function u16(o){return dv.getUint16(o,little)}"
            + "function u32(o){return dv.getUint32(o,little)}function readIfd(ifdOff){var n=u16(tiffStart+ifdOff),entries={};for(var i=0;i<n;i++){var eOff=tiffStart+ifdOff+2+i*12,tag=u16(eOff),type=u16(eOff+2),count=u32(eOff+4);"
            + "entries[tag]={type:type,count:count,valOff:eOff+8}}return{entries:entries}}function rational(o){var num=u32(o),den=u32(o+4);return den===0?0:num/den}function entryValueOffset(e){var sizeOf={1:1,2:1,3:2,4:4,5:8,7:1}"
            + ",total=(sizeOf[e.type]||1)*e.count;return total>4?tiffStart+u32(e.valOff):e.valOff}var ifd0=readIfd(u32(tiffStart+4)),result={lat:null,lon:null,ts:null},exifPtr=ifd0.entries[0x8769],gpsPtr=ifd0.entries[0x8825];"
            + "if(exifPtr){var exifIfd=readIfd(u32(entryValueOffset(exifPtr))),dto=exifIfd.entries[0x9003];if(dto){var o=entryValueOffset(dto),bytes=[];for(var i=0;i<Math.min(dto.count,19);i++)bytes.push(dv.getUint8(o+i));"
            + "var s=String.fromCharCode.apply(null,bytes),m=/^(\\d{4}):(\\d{2}):(\\d{2}) (\\d{2}):(\\d{2}):(\\d{2})/.exec(s);if(m)result.ts=new Date(+m[1],+m[2]-1,+m[3],+m[4],+m[5],+m[6]).getTime()}}if(gpsPtr){var gpsIfd=readIfd(u32(entryValueOffset(gpsPtr)));"
            + "function dms(e){var o=entryValueOffset(e);return rational(o)+rational(o+8)/60+rational(o+16)/3600}var latE=gpsIfd.entries[2],latRefE=gpsIfd.entries[1],lonE=gpsIfd.entries[4],lonRefE=gpsIfd.entries[3];"
            + "if(latE&&latRefE){var latRef=String.fromCharCode(dv.getUint8(entryValueOffset(latRefE))),lat=dms(latE);result.lat=latRef==='S'?-lat:lat}if(lonE&&lonRefE){var lonRef=String.fromCharCode(dv.getUint8(entryValueOffset(lonRefE))),lon=dms(lonE);"
            + "result.lon=lonRef==='W'?-lon:lon}}return result}function prep(fl){if(!/^image\\//.test(fl.type)||fl.type==='image/gif')return Promise.resolve({blob:fl});return fl.slice(0,131072).arrayBuffer().then(function(ab){var meta=null;"
            + "try{meta=parseExif(ab)}catch(e){meta=null}return createImageBitmap(fl).then(function(bm){var w=bm.width,h=bm.height;if(Math.max(w,h)<=MAXPX){if(bm.close)bm.close();return{blob:fl,lat:meta&&meta.lat,lon:meta&&meta.lon,ts:meta&&meta.ts}"
            + "}var sc=MAXPX/Math.max(w,h),cw=Math.round(w*sc),ch=Math.round(h*sc),cv=document.createElement('canvas');cv.width=cw;cv.height=ch;cv.getContext('2d').drawImage(bm,0,0,cw,ch);if(bm.close)bm.close();return new Promise(function(res){cv.toBlob(function(b){res({blob:b||fl,lat:meta&&meta.lat,lon:meta&&meta.lon,ts:meta&&meta.ts}"
            + ")},'image/jpeg',0.85)})})}).catch(function(){return{blob:fl}})}function run(){if(busy||!q.length)return;busy=true;var it=q.shift(),fl=it[0],li=it[1];li.lastChild.textContent='wird gesendet \\u2026';prep(fl).then(function(p){var url='up?n='+encodeURIComponent(fl.name)+'&m='+fl.lastModified;"
            + "if(p.lat!=null&&p.lon!=null)url+='&lat='+p.lat+'&lon='+p.lon;if(p.ts)url+='&ts='+p.ts;return fetch(url,{method:'POST',body:p.blob})}).then(function(r){return r.json()}).then(function(j){if(j.ok){ok++;"
            + "li.lastChild.textContent='\\u2713';li.lastChild.className='ok'}else{bad++;li.lastChild.textContent=j.error||'Fehler';li.lastChild.className='err'}}).catch(function(){bad++;li.lastChild.textContent='Verbindung unterbrochen';"
            + "li.lastChild.className='err'}).then(function(){busy=false;upd();run()})}</script></body></html>";
}
