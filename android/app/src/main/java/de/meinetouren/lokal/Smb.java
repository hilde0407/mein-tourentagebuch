package de.meinetouren.lokal;

import android.content.Context;

import com.hierynomus.msdtyp.AccessMask;
import com.hierynomus.msfscc.FileAttributes;
import com.hierynomus.msfscc.fileinformation.FileIdBothDirectoryInformation;
import com.hierynomus.mssmb2.SMB2CreateDisposition;
import com.hierynomus.mssmb2.SMB2ShareAccess;
import com.hierynomus.smbj.SMBClient;
import com.hierynomus.smbj.auth.AuthenticationContext;
import com.hierynomus.smbj.connection.Connection;
import com.hierynomus.smbj.session.Session;
import com.hierynomus.smbj.share.DiskShare;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.util.EnumSet;

/** Zugriff auf Windows-/NAS-Freigaben (SMB 2/3, Bibliothek smbj, Apache-2.0) zum Auflisten und Importieren von Fotos. */
public final class Smb {
    private Smb() {}

    /** Verbindung, die nach der Nutzung geschlossen wird. */
    private static final class Conn implements AutoCloseable {
        final SMBClient client = new SMBClient();
        Connection con;
        Session ses;
        DiskShare share;

        Conn(JSONObject a) throws Exception {
            con = client.connect(a.optString("host", "").trim());
            String user = a.optString("user", "");
            AuthenticationContext ac = user.isEmpty() ? AuthenticationContext.guest()
                    : new AuthenticationContext(user, a.optString("pass", "").toCharArray(), a.optString("domain", ""));
            ses = con.authenticate(ac);
            share = (DiskShare) ses.connectShare(a.optString("share", "").replace("/", ""));
        }

        @Override public void close() {
            try { if (share != null) share.close(); } catch (Exception e) { /* egal */ }
            try { if (ses != null) ses.close(); } catch (Exception e) { /* egal */ }
            try { if (con != null) con.close(); } catch (Exception e) { /* egal */ }
            try { client.close(); } catch (Exception e) { /* egal */ }
        }
    }

    private static String norm(String p) {
        p = p == null ? "" : p.replace('/', '\\');
        while (p.startsWith("\\")) p = p.substring(1);
        while (p.endsWith("\\")) p = p.substring(0, p.length() - 1);
        return p;
    }

    /** Listet einen Ordner: [{name, dir, size, mtime, path}] */
    public static JSONArray list(JSONObject a) throws Exception {
        String path = norm(a.optString("path", ""));
        JSONArray out = new JSONArray();
        try (Conn c = new Conn(a)) {
            for (FileIdBothDirectoryInformation f : c.share.list(path)) {
                String n = f.getFileName();
                if (".".equals(n) || "..".equals(n)) continue;
                boolean dir = (f.getFileAttributes() & FileAttributes.FILE_ATTRIBUTE_DIRECTORY.getValue()) != 0;
                out.put(new JSONObject().put("name", n).put("dir", dir).put("size", dir ? 0 : f.getEndOfFile())
                        .put("mtime", f.getLastWriteTime().toEpochMillis()).put("path", (path.isEmpty() ? "" : path.replace('\\', '/') + "/") + n));
            }
        }
        return out;
    }

    private static InputStream open(Conn c, String path) {
        com.hierynomus.smbj.share.File f = c.share.openFile(norm(path), EnumSet.of(AccessMask.GENERIC_READ), null,
                EnumSet.of(SMB2ShareAccess.FILE_SHARE_READ), SMB2CreateDisposition.FILE_OPEN, null);
        final com.hierynomus.smbj.share.File ff = f;
        final InputStream in = f.getInputStream();
        return new InputStream() {
            @Override public int read() throws java.io.IOException { return in.read(); }
            @Override public int read(byte[] b, int o, int l) throws java.io.IOException { return in.read(b, o, l); }
            @Override public void close() throws java.io.IOException { try { in.close(); } finally { ff.close(); } }
        };
    }

    /** Holt Fotos einer Verbindung nacheinander und importiert sie. */
    public static JSONArray importPhotos(Context ctx, JSONObject a, JSONArray files) throws Exception {
        JSONArray out = new JSONArray();
        try (Conn c = new Conn(a)) {
            for (int i = 0; i < files.length(); i++) {
                JSONObject f = files.getJSONObject(i);
                try (InputStream in = open(c, f.getString("path"))) {
                    out.put(Photos.importStream(ctx, in, f.getString("path").replaceAll(".*/", ""), f.optLong("mtime"), Double.NaN, Double.NaN, 0, "smb"));
                } catch (Exception e) { AppLog.log("SMB-Foto: " + e); }
            }
        }
        return out;
    }

    /** Holt eine beliebige Datei (z. B. GPX) in den Cache. */
    public static File fetch(Context ctx, JSONObject a, String path) throws Exception {
        File dir = new File(ctx.getCacheDir(), "imp");
        dir.mkdirs();
        File out = new File(dir, System.nanoTime() + "_" + path.replaceAll(".*/", "").replaceAll("[^A-Za-z0-9._-]", "_"));
        try (Conn c = new Conn(a); InputStream in = open(c, path); FileOutputStream o = new FileOutputStream(out)) {
            byte[] b = new byte[64 * 1024];
            int n;
            while ((n = in.read(b)) > 0) o.write(b, 0, n);
        }
        return out;
    }
}
