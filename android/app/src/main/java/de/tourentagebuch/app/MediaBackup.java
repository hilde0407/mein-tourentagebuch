package de.tourentagebuch.app;

import android.content.ContentResolver;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.UriPermission;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.os.PowerManager;
import android.provider.DocumentsContract;
import android.provider.OpenableColumns;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * 2.10.0: Sicherung der Foto- und Videodateien (Logik und Format in {@link MediaZip}) in einen einmal gewählten Ordner
 * (Storage Access Framework, Baumberechtigung dauerhaft), Wiederherstellen aus einer oder mehreren ZIP-Dateien,
 * und die automatische Tagessicherung der .mtl in denselben Ordner.
 *
 * Ein Lauf (Sichern oder Wiederherstellen) läuft in einem eigenen Faden. Damit er bei ausgeschaltetem Bildschirm
 * nicht stirbt: Vordergrunddienst {@link ImportService} (Benachrichtigung mit Fortschritt, Typ dataSync) und ein
 * eigener Wake-Lock (PARTIAL, höchstens 4 Stunden). Der Zustand liegt statisch hier; die Oberfläche holt ihn
 * über Native 'mediaJob' ab (übersteht also auch ein Neuladen der Oberfläche, nicht aber das Ende des Prozesses).
 * Fertige Teile sind gültig und in der Merkliste vermerkt; ein abgebrochener Teil wird gelöscht.
 */
final class MediaBackup {
    private MediaBackup() { }

    static final String PREF_TREE = "bk_tree", PREF_LAST = "media_last";
    static final String AUTO_PREFIX = "Tourentagebuch-Auto-", AUTO_SUFFIX = ".mtl";

    private static final AtomicBoolean cancel = new AtomicBoolean(false);
    private static volatile boolean running;
    private static String kind = "", phase = "", error = "";
    private static long done, total;
    private static int file, files, part, parts;
    private static JSONObject result;
    private static boolean cancelled;
    private static long lastNote;

    static File stateFile(Context c) { return new File(c.getFilesDir(), "medien-sicherung.txt"); }
    private static SharedPreferences prefs(Context c) { return c.getSharedPreferences("app", Context.MODE_PRIVATE); }

    /* ---------- Ordner ---------- */

    /** Gemerkter Sicherungsordner; ok = Schreibrecht besteht noch. */
    static JSONObject folder(Context c) throws Exception {
        String t = prefs(c).getString(PREF_TREE, "");
        JSONObject o = new JSONObject();
        if (t.isEmpty()) return o;
        Uri u = Uri.parse(t);
        boolean ok = false;
        for (UriPermission p : c.getContentResolver().getPersistedUriPermissions())
            if (p.getUri().equals(u) && p.isWritePermission()) { ok = true; break; }
        return o.put("tree", t).put("name", treeName(u)).put("ok", ok);
    }

    /** Vom Ordner-Dialog gewählt: dauerhaft merken (Lesen und Schreiben). */
    static JSONObject setFolder(Context c, Uri t) throws Exception {
        try {
            c.getContentResolver().takePersistableUriPermission(t, android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION | android.content.Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        } catch (Exception e) { AppLog.log("Sicherungsordner: " + e); }
        prefs(c).edit().putString(PREF_TREE, t.toString()).apply();
        return folder(c);
    }

    /** „primary:Documents/Sicherung“ → „Documents/Sicherung“. */
    static String treeName(Uri t) {
        try {
            String id = DocumentsContract.getTreeDocumentId(t);
            int p = id.indexOf(':');
            String n = p >= 0 ? id.substring(p + 1) : id;
            return n.isEmpty() ? "Hauptordner des Speichers" : n;
        } catch (Exception e) { return String.valueOf(t.getLastPathSegment()); }
    }

    private static Uri treeDoc(Uri tree) { return DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree)); }

    private static Uri requireTree(Context c, String given) throws Exception {
        JSONObject f = folder(c);
        String t = given != null && !given.isEmpty() ? given : f.optString("tree");
        if (t.isEmpty()) throw new Exception("Kein Sicherungsordner gewählt");
        if (!f.optBoolean("ok") || !t.equals(f.optString("tree"))) throw new Exception("Kein Schreibrecht im Sicherungsordner – bitte den Ordner neu wählen");
        return Uri.parse(t);
    }

    /* ---------- Stand ---------- */

    /** Wie viele Dateien (und Bytes) noch nicht gesichert sind; wann zuletzt; wie viele Teile es würden. */
    static JSONObject status(Context c) throws Exception {
        List<MediaZip.Item> all = MediaZip.scan(Photos.dir(c), Photos.thumbDir(c));
        List<MediaZip.Item> neu = MediaZip.pending(all, MediaZip.loadState(stateFile(c)));
        long last = prefs(c).getLong(PREF_LAST, 0);
        JSONObject o = new JSONObject().put("anzahl", all.size()).put("bytes", MediaZip.bytes(all)).put("neu", neu.size()).put("neuBytes", MediaZip.bytes(neu))
                .put("teile", MediaZip.split(neu, MediaZip.PART_LIMIT, MediaZip.MAX_ENTRIES).size()).put("running", running);
        if (last > 0) o.put("last", last);
        JSONObject f = folder(c);
        if (f.has("tree")) o.put("folder", f);
        return o;
    }

    /** Zustand des laufenden oder letzten Laufs. */
    static synchronized JSONObject job() throws Exception {
        JSONObject o = new JSONObject().put("running", running).put("kind", kind).put("phase", phase).put("done", done).put("total", total)
                .put("file", file).put("files", files).put("part", part).put("parts", parts).put("cancelled", cancelled);
        if (!error.isEmpty()) o.put("error", error);
        if (result != null) o.put("result", result);
        return o;
    }

    static void cancel() { if (running) cancel.set(true); }

    private static synchronized boolean begin(String k, long tot, int nParts) {
        if (running) return false;
        running = true; kind = k; phase = "start"; error = ""; result = null; cancelled = false;
        done = 0; total = tot; file = 0; files = 0; part = 0; parts = nParts; lastNote = 0;
        cancel.set(false);
        return true;
    }

    private static synchronized void add(long b) { done += b; }

    private static void note(Context c, String title, boolean force) {
        long now = System.currentTimeMillis();
        if (!force && now - lastNote < 2000) return;
        lastNote = now;
        int pct = total > 0 ? (int) Math.min(100, done * 100 / total) : 0;
        String txt = (parts > 1 ? "Teil " + Math.max(1, part) + " von " + parts + " · " : files > 1 ? "Datei " + Math.max(1, file) + " von " + files + " · " : "") + pct + " %";
        ImportService.update(c, title, txt, pct, 100);
    }

    private static MediaZip.Control control(Context c, String title) {
        return new MediaZip.Control() {
            public boolean cancelled() { return cancel.get(); }
            public void progress(long b) { add(b); note(c, title, false); }
        };
    }

    /** Wake-Lock und Vordergrunddienst um einen Lauf. */
    private static void run(Context c0, String title, Job job) {
        final Context c = c0.getApplicationContext();
        Thread t = new Thread(() -> {
            PowerManager.WakeLock wl = null;
            try {
                wl = ((PowerManager) c.getSystemService(Context.POWER_SERVICE)).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "tourentagebuch:medien");
                wl.acquire(4 * 60 * 60 * 1000L);
            } catch (Exception e) { AppLog.log("Medien Wake-Lock: " + e); }
            ImportService.start(c, title, "Wird vorbereitet …", 0, 100);
            JSONObject res = null;
            String err = "";
            boolean ab = false;
            try { res = job.run(c, control(c, title)); }
            catch (MediaZip.CancelledException e) { ab = true; }
            catch (Throwable e) { err = e.getMessage() == null ? e.toString() : e.getMessage(); AppLog.log(title + ": " + e); }
            finally {
                synchronized (MediaBackup.class) {
                    result = res; error = err; cancelled = ab || cancel.get(); phase = "fertig"; running = false;
                }
                ImportService.stop(c, null);
                if (wl != null && wl.isHeld()) try { wl.release(); } catch (Exception e) { /* egal */ }
            }
        }, "Medien-Sicherung");
        t.start();
    }

    interface Job { JSONObject run(Context c, MediaZip.Control ctl) throws Exception; }

    /* ---------- Sichern ---------- */

    /** Neue und geänderte Dateien in den Ordner sichern. false = es läuft schon etwas. */
    static boolean startBackup(Context c0, String treeArg, String appVersion) throws Exception {
        final Context c = c0.getApplicationContext();
        final Uri tree = requireTree(c, treeArg);
        final File stf = stateFile(c);
        final List<MediaZip.Item> all = MediaZip.scan(Photos.dir(c), Photos.thumbDir(c));
        final Set<String> state = MediaZip.loadState(stf);
        final List<MediaZip.Item> neu = MediaZip.pending(all, state);
        final List<List<MediaZip.Item>> plan = MediaZip.split(neu, MediaZip.PART_LIMIT, MediaZip.MAX_ENTRIES);
        if (!begin("backup", 2 * MediaZip.bytes(neu), plan.size())) return false;
        synchronized (MediaBackup.class) { files = neu.size(); }
        run(c, "Fotos und Videos sichern", (ctx, ctl) -> {
            ContentResolver cr = ctx.getContentResolver();
            Uri dir = treeDoc(tree);
            String date = new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date());
            JSONArray names = new JSONArray();
            int nFiles = 0;
            long nBytes = 0;
            synchronized (MediaBackup.class) { phase = "schreiben"; }
            int fertig = 0;
            try {
            for (int i = 0; i < plan.size(); i++) {
                List<MediaZip.Item> p = plan.get(i);
                synchronized (MediaBackup.class) { part = i + 1; file = nFiles + 1; }
                String name = MediaZip.partName(date, i + 1, plan.size());
                Uri doc = DocumentsContract.createDocument(cr, dir, "application/zip", name);
                if (doc == null) throw new Exception("Datei „" + name + "“ ließ sich im Ordner nicht anlegen");
                boolean ok = false;
                try (OutputStream os = cr.openOutputStream(doc, "w")) {
                    if (os == null) throw new Exception("Kein Schreibzugriff auf „" + name + "“");
                    MediaZip.write(os, p, MediaZip.manifest(p, i + 1, plan.size(), System.currentTimeMillis(), appVersion), ctl);
                    ok = true;
                } finally {
                    if (!ok) try { DocumentsContract.deleteDocument(cr, doc); } catch (Exception e) { AppLog.log("Halbe Teildatei löschen: " + e); }
                }
                for (MediaZip.Item it : p) state.add(it.key());
                MediaZip.saveState(stf, state, all);          // fertiger Teil zählt, auch wenn ein späterer abbricht
                nFiles += p.size();
                nBytes += MediaZip.bytes(p);
                names.put(nameOf(cr, doc, name));
                fertig++;
            }
            } catch (MediaZip.CancelledException e) {
                // Abbruch: fertige Teile bleiben gültig (in der Merkliste), der angefangene ist gelöscht
                return new JSONObject().put("files", nFiles).put("bytes", nBytes).put("parts", fertig).put("names", names).put("folder", treeName(tree)).put("cancelled", true);
            }
            prefs(ctx).edit().putLong(PREF_LAST, System.currentTimeMillis()).apply();
            return new JSONObject().put("files", nFiles).put("bytes", nBytes).put("parts", fertig).put("names", names).put("folder", treeName(tree));
        });
        return true;
    }

    private static String nameOf(ContentResolver cr, Uri doc, String fallback) {
        try (Cursor cur = cr.query(doc, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (cur != null && cur.moveToFirst() && cur.getString(0) != null) return cur.getString(0);
        } catch (Exception e) { /* Name wie gewünscht */ }
        return fallback;
    }

    private static long sizeOf(ContentResolver cr, Uri u) {
        try (Cursor cur = cr.query(u, new String[]{OpenableColumns.SIZE}, null, null, null)) {
            if (cur != null && cur.moveToFirst() && !cur.isNull(0)) return cur.getLong(0);
        } catch (Exception e) { /* unbekannt */ }
        return 0;
    }

    /* ---------- Wiederherstellen ---------- */

    static boolean startRestore(Context c0, List<Uri> uris) throws Exception {
        final Context c = c0.getApplicationContext();
        final ContentResolver cr0 = c.getContentResolver();
        long tot = 0;
        for (Uri u : uris) tot += sizeOf(cr0, u);
        if (!begin("restore", tot, 0)) return false;
        synchronized (MediaBackup.class) { files = uris.size(); }
        run(c, "Fotos und Videos wiederherstellen", (ctx, ctl) -> {
            ContentResolver cr = ctx.getContentResolver();
            File ph = Photos.dir(ctx), th = Photos.thumbDir(ctx), tmp = new File(ctx.getCacheDir(), "medien-tmp");
            int restored = 0, existing = 0, rejected = 0, notMedia = 0, bad = 0;
            long bytes = 0;
            Set<String> names = new HashSet<>();
            synchronized (MediaBackup.class) { phase = "lesen"; }
            for (int i = 0; i < uris.size(); i++) {
                synchronized (MediaBackup.class) { file = i + 1; }
                try (InputStream in = cr.openInputStream(uris.get(i))) {
                    if (in == null) throw new java.io.IOException("Datei nicht lesbar");
                    MediaZip.ReadResult r = MediaZip.read(new MediaZip.CountingInputStream(in, ctl), ph, th, tmp, ctl);
                    restored += r.restored; existing += r.existing; rejected += r.rejected; bytes += r.bytes;
                    names.addAll(r.names);
                    if (!r.manifest && r.restored + r.existing == 0) notMedia++;
                } catch (MediaZip.CancelledException e) {
                    markRestored(ctx, names);
                    return new JSONObject().put("restored", restored).put("existing", existing).put("rejected", rejected).put("bytes", bytes)
                            .put("notMedia", notMedia).put("bad", bad).put("thumbs", 0).put("zips", uris.size()).put("cancelled", true);
                } catch (java.io.IOException e) {
                    bad++;                                // beschädigt, Prüfsumme falsch oder kein ZIP: weiter mit der nächsten Datei
                    AppLog.log("Wiederherstellen " + uris.get(i) + ": " + e);
                }
            }
            markRestored(ctx, names);
            synchronized (MediaBackup.class) { phase = "vorschau"; }
            int thumbs = checkThumbs(ctx);
            return new JSONObject().put("restored", restored).put("existing", existing).put("rejected", rejected).put("bytes", bytes)
                    .put("notMedia", notMedia).put("bad", bad).put("thumbs", thumbs).put("zips", uris.size());
        });
        return true;
    }

    /** Zurückgespielte Dateien gelten als gesichert (sie liegen ja in einer Sicherung) – sonst würde die nächste Medien-Sicherung alles noch einmal schreiben. */
    private static void markRestored(Context c, Set<String> names) {
        if (names.isEmpty()) return;
        try {
            List<MediaZip.Item> all = MediaZip.scan(Photos.dir(c), Photos.thumbDir(c));
            Set<String> st = MediaZip.loadState(stateFile(c));
            for (MediaZip.Item it : all) if (names.contains(it.name)) st.add(it.key());
            MediaZip.saveState(stateFile(c), st, all);
        } catch (Exception e) { AppLog.log("Merkliste nach Wiederherstellen: " + e); }
    }

    /** Fehlende Vorschaubilder nachholen: Videos über Photos.videoMeta, Fotos verkleinert. Gibt die Zahl neu erzeugter zurück. */
    static int checkThumbs(Context c) {
        int made = 0;
        File[] fs = Photos.dir(c).listFiles();
        if (fs == null) return 0;
        File td = Photos.thumbDir(c);
        for (File f : fs) {
            if (cancel.get()) break;
            String nm = f.getName();
            int p = nm.lastIndexOf('.');
            if (p <= 0 || !MediaZip.safeName(nm)) continue;
            String id = nm.substring(0, p);
            File th = new File(td, id + ".jpg");
            if (th.exists()) continue;
            try {
                if (nm.endsWith(".mp4")) { Photos.videoMeta(c, id); if (th.exists()) made++; }
                else if (nm.endsWith(".jpg") && thumbOf(f, th)) made++;
            } catch (Throwable e) { AppLog.log("Vorschaubild " + nm + ": " + e); }
        }
        return made;
    }

    private static boolean thumbOf(File src, File dst) throws Exception {
        BitmapFactory.Options bo = new BitmapFactory.Options();
        bo.inJustDecodeBounds = true;
        BitmapFactory.decodeFile(src.getAbsolutePath(), bo);
        if (bo.outWidth <= 0 || bo.outHeight <= 0) return false;
        BitmapFactory.Options o2 = new BitmapFactory.Options();
        o2.inSampleSize = Math.max(1, Integer.highestOneBit(Math.max(bo.outWidth, bo.outHeight) / Photos.THUMB_PX));
        Bitmap bm = BitmapFactory.decodeFile(src.getAbsolutePath(), o2);
        if (bm == null) return false;
        int[] ts = ImagePlan.thumbSize(bm.getWidth(), bm.getHeight());
        Bitmap t = ts[0] < bm.getWidth() ? Bitmap.createScaledBitmap(bm, ts[0], ts[1], true) : bm;
        try (FileOutputStream fo = new FileOutputStream(dst)) { t.compress(Bitmap.CompressFormat.JPEG, 80, fo); }
        if (t != bm) t.recycle();
        bm.recycle();
        return true;
    }

    /* ---------- Automatische .mtl-Sicherung ---------- */

    /** Fertige .mtl (Base64 von der Oberfläche) in den Sicherungsordner schreiben; danach nur die neuesten keep automatischen behalten. */
    static JSONObject autoSave(Context c, String name, byte[] data, int keep) throws Exception {
        Uri tree = requireTree(c, null);
        ContentResolver cr = c.getContentResolver();
        String safe = name.replaceAll("[^A-Za-z0-9._-]", "_");
        if (!safe.startsWith(AUTO_PREFIX) || !safe.endsWith(AUTO_SUFFIX)) throw new Exception("Name nicht erlaubt");
        Uri dir = treeDoc(tree);
        // gleicher Tag schon vorhanden (z. B. nach Neuinstallation): ersetzen statt „(1)“ anlegen
        List<String[]> kids = children(cr, tree);
        for (String[] k : kids) if (k[1].equals(safe)) { try { DocumentsContract.deleteDocument(cr, DocumentsContract.buildDocumentUriUsingTree(tree, k[0])); } catch (Exception e) { /* dann eben daneben */ } }
        Uri doc = DocumentsContract.createDocument(cr, dir, "application/octet-stream", safe);
        if (doc == null) throw new Exception("Datei ließ sich im Ordner nicht anlegen");
        boolean ok = false;
        try (OutputStream os = cr.openOutputStream(doc, "w")) {
            if (os == null) throw new Exception("Kein Schreibzugriff");
            os.write(data);
            ok = true;
        } finally {
            if (!ok) try { DocumentsContract.deleteDocument(cr, doc); } catch (Exception e) { /* egal */ }
        }
        List<String> names = new ArrayList<>();
        kids = children(cr, tree);
        for (String[] k : kids) names.add(k[1]);
        int deleted = 0;
        for (String del : MediaZip.toDelete(names, AUTO_PREFIX, AUTO_SUFFIX, Math.max(1, keep))) {
            for (String[] k : kids) if (k[1].equals(del)) {
                try { if (DocumentsContract.deleteDocument(cr, DocumentsContract.buildDocumentUriUsingTree(tree, k[0]))) deleted++; }
                catch (Exception e) { AppLog.log("Alte Sicherung löschen: " + e); }
            }
        }
        return new JSONObject().put("name", nameOf(cr, doc, safe)).put("folder", treeName(tree)).put("deleted", deleted);
    }

    /** Kinder des Ordners: [Dokument-ID, Anzeigename]. */
    private static List<String[]> children(ContentResolver cr, Uri tree) {
        List<String[]> out = new ArrayList<>();
        Uri kids = DocumentsContract.buildChildDocumentsUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree));
        try (Cursor cur = cr.query(kids, new String[]{DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_DISPLAY_NAME}, null, null, null)) {
            while (cur != null && cur.moveToNext()) if (cur.getString(0) != null && cur.getString(1) != null) out.add(new String[]{cur.getString(0), cur.getString(1)});
        } catch (Exception e) { AppLog.log("Ordner lesen: " + e); }
        return out;
    }

    /** Für die Auswahl beim Wiederherstellen: Name und Größe. */
    static JSONObject describe(Context c, Uri u) throws Exception {
        ContentResolver cr = c.getContentResolver();
        return new JSONObject().put("uri", u.toString()).put("name", nameOf(cr, u, String.valueOf(u.getLastPathSegment()))).put("size", sizeOf(cr, u));
    }
}
