package de.tourentagebuch.app;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;

import java.io.File;
import java.io.FileNotFoundException;

/** Gibt der Kamera-App Schreibzugriff auf genau eine Datei im privaten Ordner der App (ohne AndroidX/FileProvider). */
public class PhotoProvider extends ContentProvider {
    public static final String AUTH = "de.tourentagebuch.app.fileprovider";

    public static File camDir(android.content.Context c) {
        File d = new File(c.getCacheDir(), "cam");
        d.mkdirs();
        return d;
    }

    public static Uri uriFor(File f) {
        return Uri.parse("content://" + AUTH + "/p/" + Uri.encode(f.getName()));
    }

    @Override public boolean onCreate() { return true; }

    @Override
    public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        String name = uri.getLastPathSegment();
        if (name == null || name.contains("/") || name.contains("..")) throw new FileNotFoundException();
        File f = new File(camDir(getContext()), name);
        int m = mode.contains("w") ? ParcelFileDescriptor.MODE_READ_WRITE | ParcelFileDescriptor.MODE_CREATE : ParcelFileDescriptor.MODE_READ_ONLY;
        return ParcelFileDescriptor.open(f, m);
    }

    @Override public String getType(Uri uri) {
        String n = uri.getLastPathSegment();
        String l = n == null ? "" : n.toLowerCase(java.util.Locale.ROOT);
        return l.endsWith(".mp4") ? "video/mp4" : l.endsWith(".html") ? "text/html" : l.endsWith(".pdf") ? "application/pdf" : "image/jpeg";
    }
    // Name und Größe für Apps wie WhatsApp, die sie über OpenableColumns abfragen (ohne sie kommt das PDF nicht an)
    @Override public Cursor query(Uri u, String[] p, String s, String[] a, String o) {
        String n = u.getLastPathSegment();
        if (n == null || n.contains("/") || n.contains("..") || getContext() == null) return null;
        File f = new File(camDir(getContext()), n);
        if (!f.isFile()) return null;
        String[] cols = p != null ? p : new String[]{android.provider.OpenableColumns.DISPLAY_NAME, android.provider.OpenableColumns.SIZE};
        android.database.MatrixCursor c = new android.database.MatrixCursor(cols, 1);
        Object[] row = new Object[cols.length];
        for (int i = 0; i < cols.length; i++)
            row[i] = android.provider.OpenableColumns.SIZE.equals(cols[i]) ? (Object) Long.valueOf(f.length())
                   : android.provider.OpenableColumns.DISPLAY_NAME.equals(cols[i]) ? (Object) n : null;
        c.addRow(row);
        return c;
    }
    @Override public Uri insert(Uri u, ContentValues v) { return null; }
    @Override public int delete(Uri u, String s, String[] a) { return 0; }
    @Override public int update(Uri u, ContentValues v, String s, String[] a) { return 0; }
}
