package cc.novelia.reader;

import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.speech.tts.TextToSpeech;
import android.util.Log;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.ConsoleMessage;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.InputStream;
import java.io.OutputStream;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Locale;

public class MainActivity extends Activity {
    private static final String TAG = "NoveliaReader";
    private static final String START_URL = "file:///android_asset/www/index.html";
    private WebView webView;
    private boolean dark = false;
    private boolean readerMode = false;
    private int insetTop = 0, insetBottom = 0, insetLeft = 0, insetRight = 0;
    private Bridge bridge;
    private static final int REQ_EXPORT_BACKUP = 901;
    private static final int REQ_IMPORT_BACKUP = 902;
    private TextToSpeech tts;
    private boolean ttsReady = false;
    private String pendingExportId;
    private String pendingExportData;
    private String pendingImportId;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        webView = new WebView(this);
        webView.setLayoutParams(new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        webView.setBackgroundColor(0xFFF5F7F4);
        configure(webView);
        webView.clearCache(true);
        setContentView(webView);
        setupInsets();
        applyPrivacyFlags();
        initTts();
        boolean systemDark = (getResources().getConfiguration().uiMode
                & android.content.res.Configuration.UI_MODE_NIGHT_MASK)
                == android.content.res.Configuration.UI_MODE_NIGHT_YES;
        setDark(systemDark);
        new Thread(() -> cc.novelia.reader.Usage.reportInstall(this)).start();
        webView.loadUrl(START_URL);
    }

    void applyPrivacyFlags() {
        try {
            if (Privacy.hasPin(this) && Privacy.hideRecents(this)) getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
            else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE);
        } catch (Exception ignored) {}
    }

    private void initTts() {
        try {
            tts = new TextToSpeech(this, status -> {
                if (status == TextToSpeech.SUCCESS && tts != null) {
                    try {
                        int r = tts.setLanguage(Locale.CHINESE);
                        if (r == TextToSpeech.LANG_MISSING_DATA || r == TextToSpeech.LANG_NOT_SUPPORTED) {
                            tts.setLanguage(Locale.getDefault());
                        }
                        tts.setSpeechRate(1.0f);
                    } catch (Exception ignored) {}
                    ttsReady = true;
                }
            });
        } catch (Exception e) {
            ttsReady = false;
        }
    }

    void setBrightness(double value) {
        runOnUiThread(() -> {
            try {
                WindowManager.LayoutParams lp = getWindow().getAttributes();
                lp.screenBrightness = value <= 0 ? WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE : (float) Math.max(0.05, Math.min(1.0, value));
                getWindow().setAttributes(lp);
            } catch (Exception ignored) {}
        });
    }

    void setKeepScreenOn(boolean on) {
        runOnUiThread(() -> {
            try { if (webView != null) webView.setKeepScreenOn(on); } catch (Exception ignored) {}
        });
    }

    void speakText(String text) {
        runOnUiThread(() -> {
            if (text == null || text.trim().isEmpty()) return;
            if (!ttsReady || tts == null) {
                android.widget.Toast.makeText(this, "系统没有可用的语音引擎", android.widget.Toast.LENGTH_SHORT).show();
                return;
            }
            try {
                tts.stop();
                int max = 1800;
                int i = 0;
                int part = 0;
                while (i < text.length()) {
                    int end = Math.min(text.length(), i + max);
                    // Prefer a sentence boundary near the chunk end.
                    if (end < text.length()) {
                        int cut = Math.max(text.lastIndexOf('。', end), Math.max(text.lastIndexOf('！', end), text.lastIndexOf('？', end)));
                        if (cut > i + max / 2) end = cut + 1;
                    }
                    tts.speak(text.substring(i, end), part == 0 ? TextToSpeech.QUEUE_FLUSH : TextToSpeech.QUEUE_ADD, null, "novelia-" + part);
                    i = end;
                    part++;
                }
            } catch (Exception ignored) {}
        });
    }

    void stopSpeak() {
        runOnUiThread(() -> { try { if (tts != null) tts.stop(); } catch (Exception ignored) {} });
    }

    private void setupInsets() {
        if (Build.VERSION.SDK_INT < 35 || webView == null) return;
        webView.setOnApplyWindowInsetsListener((v, insets) -> {
            Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
            insetTop = bars.top;
            insetBottom = bars.bottom;
            insetLeft = bars.left;
            insetRight = bars.right;
            injectInsets();
            return insets;
        });
        webView.requestApplyInsets();
    }

    private void injectInsets() {
        if (webView == null) return;
        // WindowInsets are physical pixels; CSS px in the WebView viewport are dp.
        float density = getResources().getDisplayMetrics().density;
        if (density <= 0) density = 1f;
        int top = Math.round(insetTop / density);
        int bottom = Math.round(insetBottom / density);
        int left = Math.round(insetLeft / density);
        int right = Math.round(insetRight / density);
        String js = "(function(){var s=document.documentElement.style;"
                + "s.setProperty('--sat','" + top + "px');"
                + "s.setProperty('--sab','" + bottom + "px');"
                + "s.setProperty('--sal','" + left + "px');"
                + "s.setProperty('--sar','" + right + "px');"
                + "})();";
        try { webView.evaluateJavascript(js, null); } catch (Exception ignored) {}
    }

    private void configure(WebView w) {
        WebSettings s = w.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(true);
        s.setAllowContentAccess(true);
        s.setLoadsImagesAutomatically(true);
        s.setBlockNetworkImage(false);
        s.setDefaultTextEncodingName("UTF-8");
        s.setCacheMode(WebSettings.LOAD_NO_CACHE);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setTextZoom(100);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        if (Build.VERSION.SDK_INT >= 26) {
            s.setSafeBrowsingEnabled(false);
        }
        bridge = new Bridge(this, w);
        w.addJavascriptInterface(bridge, "Native");
        w.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (request == null || request.getUrl() == null) return true;
                String scheme = request.getUrl().getScheme();
                if ("file".equals(scheme) || "about".equals(scheme) || "data".equals(scheme)) return false;
                try {
                    URL u = new URL(request.getUrl().toString());
                    if ("n.novelia.cc".equals(u.getHost()) || "books.fishhawk.top".equals(u.getHost())) {
                        // Keep the app's own shell. Site pages are opened in a browser instead.
                        return true;
                    }
                } catch (Exception ignored) {}
                try {
                    android.content.Intent i = new android.content.Intent(
                            android.content.Intent.ACTION_VIEW, request.getUrl());
                    i.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(i);
                } catch (Exception ignored) {}
                return true;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                readerMode = url != null && url.contains("/reader.html");
                injectInsets();
                setDark(dark);
            }
        });
        w.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(ConsoleMessage cm) {
                if (cm != null) Log.d(TAG, cm.message() + " @" + cm.lineNumber());
                return true;
            }
        });
        w.setLongClickable(true);
        w.setOnLongClickListener(v -> false);
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        int code = event.getKeyCode();
        if (readerMode && (code == KeyEvent.KEYCODE_VOLUME_UP || code == KeyEvent.KEYCODE_VOLUME_DOWN)) {
            if (event.getAction() == KeyEvent.ACTION_DOWN && event.getRepeatCount() == 0 && webView != null) {
                int dir = code == KeyEvent.KEYCODE_VOLUME_UP ? -1 : 1;
                webView.evaluateJavascript("window.ReaderApp&&ReaderApp.turnPage(" + dir + ");", null);
            }
            return true;
        }
        return super.dispatchKeyEvent(event);
    }

    public void setDark(boolean value) {
        dark = value;
        int bg = value ? 0xFF101512 : 0xFFF5F7F4;
        runOnUiThread(() -> {
            try {
                getWindow().setStatusBarColor(bg);
                getWindow().setNavigationBarColor(bg);
                int flags = getWindow().getDecorView().getSystemUiVisibility();
                if (value) {
                    flags &= ~View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
                    flags &= ~View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
                } else {
                    flags |= View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
                    flags |= View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
                }
                getWindow().getDecorView().setSystemUiVisibility(flags);
                if (Build.VERSION.SDK_INT >= 30) {
                    WindowInsetsController c = getWindow().getInsetsController();
                    if (c != null) {
                        c.setSystemBarsAppearance(value ? 0 : WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS,
                                WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS);
                    }
                }
                if (webView != null) webView.setBackgroundColor(bg);
            } catch (Exception ignored) {}
        });
    }

    void startExportBackup(String id, String json, String filename) {
        if (json == null) { if (bridge != null) bridge.deliver(id, 0, "备份内容为空"); return; }
        pendingExportId = id;
        pendingExportData = json;
        try {
            Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT);
            i.addCategory(Intent.CATEGORY_OPENABLE);
            i.setType("application/json");
            i.putExtra(Intent.EXTRA_TITLE, filename == null || filename.trim().isEmpty()
                    ? "Novelia-Backup.json" : filename.trim());
            startActivityForResult(i, REQ_EXPORT_BACKUP);
        } catch (Exception e) {
            pendingExportId = null;
            pendingExportData = null;
            if (bridge != null) bridge.deliver(id, 0, "无法打开文件选择器");
        }
    }

    void startImportBackup(String id) {
        pendingImportId = id;
        try {
            Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
            i.addCategory(Intent.CATEGORY_OPENABLE);
            i.setType("*/*");
            i.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"application/json", "text/plain", "application/octet-stream"});
            startActivityForResult(i, REQ_IMPORT_BACKUP);
        } catch (Exception e) {
            pendingImportId = null;
            if (bridge != null) bridge.deliver(id, 0, "无法打开文件选择器");
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQ_EXPORT_BACKUP) {
            String id = pendingExportId;
            String json = pendingExportData;
            pendingExportId = null;
            pendingExportData = null;
            if (id == null || bridge == null) return;
            if (resultCode != RESULT_OK || data == null || data.getData() == null) {
                bridge.deliver(id, 0, "已取消");
                return;
            }
            try {
                Uri uri = data.getData();
                OutputStream out = getContentResolver().openOutputStream(uri, "wt");
                if (out == null) throw new Exception("无法写入文件");
                out.write(json.getBytes(StandardCharsets.UTF_8));
                out.flush();
                out.close();
                bridge.deliver(id, 200, "saved");
            } catch (Exception e) {
                bridge.deliver(id, 0, e.getMessage() == null ? "导出失败" : e.getMessage());
            }
        } else if (requestCode == REQ_IMPORT_BACKUP) {
            String id = pendingImportId;
            pendingImportId = null;
            if (id == null || bridge == null) return;
            if (resultCode != RESULT_OK || data == null || data.getData() == null) {
                bridge.deliver(id, 0, "已取消");
                return;
            }
            try {
                Uri uri = data.getData();
                InputStream in = getContentResolver().openInputStream(uri);
                if (in == null) throw new Exception("无法读取文件");
                java.io.ByteArrayOutputStream bos = new java.io.ByteArrayOutputStream();
                byte[] buf = new byte[8192];
                int n;
                int total = 0;
                while ((n = in.read(buf)) != -1) {
                    total += n;
                    if (total > 8 * 1024 * 1024) throw new Exception("备份文件过大");
                    bos.write(buf, 0, n);
                }
                in.close();
                bridge.deliver(id, 200, new String(bos.toByteArray(), StandardCharsets.UTF_8));
            } catch (Exception e) {
                bridge.deliver(id, 0, e.getMessage() == null ? "读取失败" : e.getMessage());
            }
        }
    }

    @Override
    public void onBackPressed() {
        if (webView == null) {
            super.onBackPressed();
            return;
        }
        String js = "(function(){try{"
                + "if(window.App&&window.App.handleBack&&window.App.handleBack())return true;"
                + "if(window.ReaderApp&&window.ReaderApp.handleBack&&window.ReaderApp.handleBack())return true;"
                + "return false;}catch(e){return false;}})()";
        webView.evaluateJavascript(js, value -> {
            if ("true".equals(value)) return;
            runOnUiThread(() -> {
                if (webView != null && webView.canGoBack()) {
                    String u = webView.getUrl();
                    if (u != null && u.startsWith("file:///android_asset/www/index.html")) {
                        finish();
                    } else {
                        webView.goBack();
                    }
                } else {
                    finish();
                }
            });
        });
    }

    @Override
    protected void onResume() {
        super.onResume();
        applyPrivacyFlags();
        if (webView != null) {
            webView.onResume();
            webView.evaluateJavascript("window.App&&window.App.onResume&&window.App.onResume();", null);
        }
    }

    @Override
    protected void onPause() {
        if (webView != null) webView.onPause();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        try { if (tts != null) { tts.stop(); tts.shutdown(); tts = null; } } catch (Exception ignored) {}
        try {
            if (webView != null) {
                webView.removeJavascriptInterface("Native");
                webView.destroy();
            }
        } catch (Exception ignored) {}
        super.onDestroy();
    }
}
