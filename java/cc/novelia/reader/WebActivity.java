package cc.novelia.reader;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

/** In-app web view for the original site (login and R18 sections included). The native
 *  reader intentionally only handles the public general catalogue; account-gated content
 *  stays inside the site's own session and permission checks. */
public class WebActivity extends Activity {
    private WebView webView;
    private TextView titleView;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        String url = getIntent().getStringExtra("url");
        if (url == null || !url.startsWith("https://")) url = "https://books.fishhawk.top/";
        buildUi();
        configureWebView();
        try {
            if (Privacy.hasPin(this) && Privacy.hideRecents(this)) getWindow().addFlags(android.view.WindowManager.LayoutParams.FLAG_SECURE);
        } catch (Exception ignored) {}
        webView.loadUrl(url);
    }

    private int dp(int v) {
        return Math.round(getResources().getDisplayMetrics().density * v);
    }

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

        TextView back = new TextView(this);
        back.setText("‹");
        back.setTextSize(30);
        back.setTextColor(0xFF1F7A4D);
        back.setGravity(Gravity.CENTER);
        back.setPadding(dp(8), 0, dp(10), dp(2));
        back.setOnClickListener(v -> finish());
        bar.addView(back, new LinearLayout.LayoutParams(dp(42), dp(52)));

        titleView = new TextView(this);
        String initialUrl = getIntent().getStringExtra("url");
        titleView.setText(initialUrl != null && initialUrl.contains("forum.novelia.cc") ? "论坛" : "网页版");
        titleView.setTextSize(15);
        titleView.setTextColor(0xFF16221B);
        titleView.setSingleLine(true);
        titleView.setEllipsize(android.text.TextUtils.TruncateAt.END);
        titleView.setGravity(Gravity.CENTER_VERTICAL);
        LinearLayout.LayoutParams tp = new LinearLayout.LayoutParams(0, dp(52), 1f);
        bar.addView(titleView, tp);

        TextView refresh = new TextView(this);
        refresh.setText("刷新");
        refresh.setTextSize(12);
        refresh.setTextColor(0xFF1F7A4D);
        refresh.setGravity(Gravity.CENTER);
        refresh.setPadding(dp(8), 0, dp(8), 0);
        refresh.setOnClickListener(v -> { if (webView != null) webView.reload(); });
        bar.addView(refresh, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, dp(52)));

        TextView external = new TextView(this);
        external.setText("↗");
        external.setTextSize(19);
        external.setTextColor(0xFF1F7A4D);
        external.setGravity(Gravity.CENTER);
        external.setPadding(dp(8), 0, dp(4), 0);
        external.setOnClickListener(v -> {
            try {
                String u = webView == null ? "https://books.fishhawk.top/" : webView.getUrl();
                startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(u)));
            } catch (Exception e) {
                Toast.makeText(this, "没有可用的浏览器", Toast.LENGTH_SHORT).show();
            }
        });
        bar.addView(external, new LinearLayout.LayoutParams(dp(40), dp(52)));
        root.addView(bar, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(52)));

        webView = new WebView(this);
        webView.setBackgroundColor(0xFFFFFFFF);
        root.addView(webView, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        setContentView(root);
        if (Build.VERSION.SDK_INT >= 35) {
            root.setOnApplyWindowInsetsListener((v, insets) -> {
                Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                v.setPadding(bars.left, bars.top, bars.right, bars.bottom);
                return insets;
            });
            root.requestApplyInsets();
        }

        try {
            getWindow().setStatusBarColor(0xFFF5F7F4);
            getWindow().setNavigationBarColor(0xFFF5F7F4);
            getWindow().getDecorView().setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
        } catch (Exception ignored) {}
    }

    private void configureWebView() {
        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setLoadsImagesAutomatically(true);
        s.setDefaultTextEncodingName("UTF-8");
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setSupportMultipleWindows(false);
        s.setJavaScriptCanOpenWindowsAutomatically(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        s.setMediaPlaybackRequiresUserGesture(true);
        s.setTextZoom(100);
        if (Build.VERSION.SDK_INT >= 26) s.setSafeBrowsingEnabled(false);

        CookieManager cm = CookieManager.getInstance();
        cm.setAcceptCookie(true);
        if (Build.VERSION.SDK_INT >= 21) cm.setAcceptThirdPartyCookies(webView, true);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (request == null || request.getUrl() == null) return true;
                Uri u = request.getUrl();
                String scheme = u.getScheme() == null ? "" : u.getScheme();
                if ("http".equals(scheme) || "https".equals(scheme)) {
                    String host = u.getHost() == null ? "" : u.getHost();
                    if (host.equals("novelia.cc") || host.endsWith(".novelia.cc")) return false;
                    try {
                        startActivity(new Intent(Intent.ACTION_VIEW, u));
                    } catch (Exception ignored) {}
                    return true;
                }
                if ("intent".equals(scheme)) {
                    try { startActivity(Intent.parseUri(u.toString(), Intent.URI_INTENT_SCHEME)); } catch (Exception ignored) {}
                    return true;
                }
                return false;
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onReceivedTitle(WebView view, String title) {
                if (titleView != null && title != null && !title.trim().isEmpty()) titleView.setText(title);
            }
        });
        webView.setDownloadListener((url, userAgent, contentDisposition, mimetype, contentLength) -> {
            try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url))); }
            catch (Exception ignored) {}
        });
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onPause() {
        try { CookieManager.getInstance().flush(); } catch (Exception ignored) {}
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        try {
            if (webView != null) {
                webView.stopLoading();
                webView.destroy();
                webView = null;
            }
        } catch (Exception ignored) {}
        super.onDestroy();
    }
}
