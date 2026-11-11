package de.tourentagebuch.app;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.os.Bundle;
import android.view.Gravity;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

/**
 * Meldet sich im Zepp-Konto an (Google, Apple, Mi oder Passwort – wie im Browser) und liest danach das Zugangs-Token
 * („apptoken“-Cookie) selbst aus dem Cookie-Speicher des Fensters. Dadurch funktioniert es auch ohne Lesezeichen
 * oder Entwicklerwerkzeuge. Es wird nichts angeklickt oder abgeschickt – nur das Cookie gelesen.
 */
public class ZeppLoginActivity extends Activity {
    static final String URL = "https://user.huami.com/privacy2/index.html?platform_app=com.xiaomi.hm.health&loginPlatform=web";
    private static final String[] SITES = {"https://user.huami.com", "https://user.zepp.com", "https://account.huami.com",
            "https://api-mifit.huami.com", "https://api-user.huami.com", "https://www.zepp.com", "https://account.zepp.com", "https://auth.zepp.com",
            "https://api-mifit-de2.zepp.com", "https://api-mifit.zepp.com", "https://api-mifit-us2.zepp.com"};
    private WebView web;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        TextView hint = new TextView(this);
        hint.setText("Bei Zepp anmelden. Dort nichts anderes antippen (die Seite bietet „Konto löschen“ an). Wenn du angemeldet bist: unten „Token übernehmen“.");
        hint.setPadding(32, 24, 32, 24); hint.setTextColor(Color.BLACK); hint.setBackgroundColor(0xFFFFF3C4); hint.setTextSize(14);
        Button take = new Button(this); take.setText("Token übernehmen");
        Button cancel = new Button(this); cancel.setText("Abbrechen");
        LinearLayout bar = new LinearLayout(this); bar.setOrientation(LinearLayout.HORIZONTAL); bar.setGravity(Gravity.CENTER);
        bar.addView(cancel, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        bar.addView(take, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true); s.setDomStorageEnabled(true); s.setSupportMultipleWindows(false);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true);
        web.setWebViewClient(new WebViewClient());
        root.addView(hint, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        root.addView(web, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));
        root.addView(bar, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        setContentView(root);
        cancel.setOnClickListener(v -> finish());
        take.setOnClickListener(v -> {
            String t = findToken();
            if (t == null) { Toast.makeText(this, "Noch kein Token gefunden – bitte zuerst anmelden.", Toast.LENGTH_LONG).show(); return; }
            setResult(RESULT_OK, new Intent().putExtra("token", t));
            finish();
        });
        web.loadUrl(URL);
    }

    private String findToken() {
        CookieManager cm = CookieManager.getInstance();
        cm.flush();
        for (String u : SITES) {
            String c = cm.getCookie(u);
            if (c == null) continue;
            for (String p : c.split(";")) {
                p = p.trim();
                if (p.startsWith("apptoken=") && p.length() > 20) {
                    try { return java.net.URLDecoder.decode(p.substring(9), "UTF-8"); } catch (Exception e) { return p.substring(9); }
                }
            }
        }
        return null;
    }

    @Override
    public void onBackPressed() {
        if (web != null && web.canGoBack()) web.goBack(); else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        if (web != null) { web.destroy(); }
        super.onDestroy();
    }
}
