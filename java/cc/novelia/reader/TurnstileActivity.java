package cc.novelia.reader;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.LinearLayout;
import android.widget.TextView;

/** One-shot Cloudflare Turnstile page for the auth service. It only returns the Turnstile token;
 *  registration itself is performed by the native API client. */
public class TurnstileActivity extends Activity {
    private WebView webView;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private boolean finished;
    private final Runnable poll = new Runnable() {
        @Override public void run() {
            if (finished || webView == null) return;
            webView.evaluateJavascript("(function(){try{if(location.origin!=='https://auth.novelia.cc')return '';if(window.turnstile){var t=window.turnstile.getResponse();if(t&&t.length<=2048&&t.length>10){window.NoveliaTurnstile.token(t);return t;}}}catch(e){}return '';})()", null);
            handler.postDelayed(this, 800);
        }
    };

    @Override protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        buildUi();
        configure();
        String app = getIntent().getStringExtra("app");
        if (app == null || app.isEmpty()) app = "f";
        webView.loadUrl("https://auth.novelia.cc/register?app=" + app + "&theme=dark");
        handler.postDelayed(poll, 1200);
    }

    private int dp(int v) { return Math.round(getResources().getDisplayMetrics().density * v); }

    private void buildUi() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(0xFFF5F7F4);

        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setPadding(dp(10), 0, dp(10), 0);
        bar.setBackgroundColor(0xFFF5F7F4);
        bar.setElevation(dp(3));

        TextView close = new TextView(this);
        close.setText("‹");
        close.setTextSize(30);
        close.setTextColor(0xFF1F7A4D);
        close.setGravity(Gravity.CENTER);
        close.setOnClickListener(v -> cancel());
        bar.addView(close, new LinearLayout.LayoutParams(dp(42), dp(52)));

        TextView title = new TextView(this);
        title.setText("人机验证");
        title.setTextSize(16);
        title.setTextColor(0xFF16221B);
        title.setGravity(Gravity.CENTER_VERTICAL);
        bar.addView(title, new LinearLayout.LayoutParams(0, dp(52), 1f));
        root.addView(bar, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(52)));

        TextView hint = new TextView(this);
        hint.setText("完成验证后会自动返回，继续发送邮箱验证码。");
        hint.setTextSize(11);
        hint.setTextColor(0xFF6B7F70);
        hint.setPadding(dp(16), dp(8), dp(16), dp(8));
        root.addView(hint);

        webView = new WebView(this);
        webView.setBackgroundColor(0xFFFFFFFF);
        root.addView(webView, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        setContentView(root);
        if (Build.VERSION.SDK_INT >= 35) {
            root.setOnApplyWindowInsetsListener((v, insets) -> {
                android.graphics.Insets b = insets.getInsets(android.view.WindowInsets.Type.systemBars() | android.view.WindowInsets.Type.displayCutout());
                v.setPadding(b.left, b.top, b.right, b.bottom);
                return insets;
            });
            root.requestApplyInsets();
        }
        getWindow().setStatusBarColor(0xFFF5F7F4);
        getWindow().setNavigationBarColor(0xFFF5F7F4);
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
    }

    private void configure() {
        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setLoadsImagesAutomatically(true);
        s.setSupportMultipleWindows(false);
        s.setJavaScriptCanOpenWindowsAutomatically(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        s.setMediaPlaybackRequiresUserGesture(true);
        s.setTextZoom(100);
        CookieManager cm = CookieManager.getInstance();
        cm.setAcceptCookie(true);
        cm.setAcceptThirdPartyCookies(webView, true);

        webView.addJavascriptInterface(new Object() {
            @JavascriptInterface public void token(String t) {
                if (t == null || t.length() < 10 || t.length() > 2048) return;
                if (finished) return;
                finished = true;
                handler.removeCallbacksAndMessages(null);
                Intent data = new Intent();
                data.putExtra("token", t);
                setResult(RESULT_OK, data);
                finish();
            }
        }, "NoveliaTurnstile");

        webView.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (request == null || request.getUrl() == null) return true;
                Uri u = request.getUrl();
                String host = u.getHost() == null ? "" : u.getHost();
                String scheme = u.getScheme() == null ? "" : u.getScheme();
                if ("https".equals(scheme) && (host.equals("auth.novelia.cc") || host.endsWith(".cloudflare.com") || host.endsWith(".novelia.cc"))) return false;
                return true;
            }
            @Override public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                // Keep only the Turnstile widget visible; the native form handles the rest.
                view.evaluateJavascript("(function(){try{var w=document.querySelector('form [aria-busy]');if(w){for(var n=w;n&&n!==document.body;n=n.parentElement){var p=n.parentElement;if(!p)break;for(var i=0;i<p.children.length;i++){if(p.children[i]!==n)p.children[i].style.setProperty('display','none','important');}p.style.cssText='display:block;margin:0;padding:0;min-height:0;height:auto;max-width:none;width:100%';}document.body.style.background='#f5f7f4';}}catch(e){}})()", null);
            }
        });
        webView.setWebChromeClient(new WebChromeClient());
    }

    private void cancel() {
        finished = true;
        handler.removeCallbacksAndMessages(null);
        setResult(RESULT_CANCELED);
        finish();
    }

    @Override public void onBackPressed() { cancel(); }

    @Override protected void onDestroy() {
        finished = true;
        handler.removeCallbacksAndMessages(null);
        try { if (webView != null) { webView.stopLoading(); webView.destroy(); webView = null; } } catch (Exception ignored) {}
        super.onDestroy();
    }
}
