package cc.novelia.reader;

import android.app.Activity;
import android.content.ClipData;
import android.content.Context;
import android.content.ClipboardManager;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.File;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** The only bridge between the local HTML UI and Android. Keeping it explicit means the
 *  web layer never needs CORS, cookies or a remote origin. */
final class Bridge {
    private final MainActivity activity;
    private final WebView webView;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService pool = Executors.newFixedThreadPool(4);

    Bridge(MainActivity activity, WebView webView) {
        this.activity = activity;
        this.webView = webView;
    }

    void deliver(String id, int status, String body) {
        resolve(id, status, body);
    }

    private void resolve(String id, int status, String body) {
        final String js = "window.NativeBridge&&window.NativeBridge.resolve("
                + JSONObject.quote(id) + "," + status + "," + JSONObject.quote(body == null ? "" : body) + ");";
        main.post(() -> {
            try {
                webView.evaluateJavascript(js, null);
            } catch (Exception ignored) {}
        });
    }

    @JavascriptInterface
    public void api(String id, String path) {
        if (path == null) { resolve(id, 0, "参数错误"); return; }
        if (!(path.startsWith("novel") || path.startsWith("wenku"))) {
            resolve(id, 0, "不允许的接口");
            return;
        }
        pool.execute(() -> {
            try {
                String body = ApiClient.get(activity, path);
                resolve(id, 200, body);
            } catch (ApiClient.ApiException e) {
                resolve(id, e.status, e.getMessage());
            } catch (Exception e) {
                resolve(id, 0, e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage());
            }
        });
    }

    @JavascriptInterface
    public void testProxy(String id) {
        pool.execute(() -> {
            JSONObject r = ApiClient.test(activity);
            try {
                resolve(id, r.optBoolean("ok") ? 200 : 0, r.toString());
            } catch (Exception e) {
                resolve(id, 0, "测试失败");
            }
        });
    }

    @JavascriptInterface
    public void commentSend(String id, String subjectKey, String content, long rootId) {
        if (subjectKey == null || !subjectKey.startsWith("web-") || content == null || content.trim().isEmpty()) {
            resolve(id, 0, "评论内容不能为空");
            return;
        }
        if (content.length() > 4000) {
            resolve(id, 0, "评论内容过长");
            return;
        }
        pool.execute(() -> {
            try {
                JSONObject body = new JSONObject();
                body.put("content", content.trim());
                if (rootId > 0) body.put("rootId", rootId);
                String path = "external/comment/novel/" + Uri.encode(subjectKey);
                String result = ApiClient.postJson(activity, "https://forum.novelia.cc/api/v1/" + path, body.toString());
                resolve(id, 200, result == null ? "" : result);
            } catch (ApiClient.ApiException e) {
                resolve(id, e.status, e.getMessage());
            } catch (Exception e) {
                resolve(id, 0, e.getMessage() == null ? "评论发送失败" : e.getMessage());
            }
        });
    }

    @JavascriptInterface
    public void forum(String id, String path) {
        if (path == null || !path.startsWith("external/comment/novel/")) {
            resolve(id, 0, "不允许的接口");
            return;
        }
        pool.execute(() -> {
            try {
                String body = ApiClient.get(activity, "https://forum.novelia.cc/api/v1/" + path);
                resolve(id, 200, body);
            } catch (ApiClient.ApiException e) {
                resolve(id, e.status, e.getMessage());
            } catch (Exception e) {
                resolve(id, 0, e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage());
            }
        });
    }

    @JavascriptInterface
    public String proxyGet() {
        return ApiClient.proxyInfo(activity).toString();
    }

    @JavascriptInterface
    public String proxySet(String mode, String host, String port) {
        ApiClient.setProxy(activity, mode, host, port);
        return "ok";
    }

    @JavascriptInterface
    public void setBrightness(double value) {
        main.post(() -> activity.setBrightness(value));
    }

    @JavascriptInterface
    public void keepScreenOn(boolean on) {
        main.post(() -> activity.setKeepScreenOn(on));
    }

    @JavascriptInterface
    public void speak(String text) {
        main.post(() -> activity.speakText(text));
    }

    @JavascriptInterface
    public void stopSpeak() {
        main.post(() -> activity.stopSpeak());
    }

    @JavascriptInterface
    public void exportBook(String id, String provider, String novel, String format) {
        pool.execute(() -> {
            try {
                File f = BookExporter.build(activity, provider, novel, format);
                activity.startExportFile(id, f, f.getName(), "epub".equalsIgnoreCase(format) ? "application/epub+zip" : "text/plain");
            } catch (Exception e) {
                resolve(id, 0, e.getMessage() == null ? "导出失败" : e.getMessage());
            }
        });
    }

    @JavascriptInterface
    public void exportBackup(String id, String json, String filename) {
        main.post(() -> activity.startExportBackup(id, json, filename));
    }

    @JavascriptInterface
    public void importBackup(String id) {
        main.post(() -> activity.startImportBackup(id));
    }

    @JavascriptInterface
    public String privacyInfo() {
        return Privacy.info(activity).toString();
    }

    @JavascriptInterface
    public String privacySetPin(String pin) {
        boolean ok = Privacy.setPin(activity, pin);
        if (ok) main.post(() -> activity.applyPrivacyFlags());
        return ok ? "ok" : "PIN 需要 4-8 位数字";
    }

    @JavascriptInterface
    public boolean privacyVerify(String pin) {
        return Privacy.verify(activity, pin);
    }

    @JavascriptInterface
    public String privacyClear(String pin) {
        if (!Privacy.verify(activity, pin)) return "PIN 不正确";
        Privacy.clear(activity);
        main.post(() -> activity.applyPrivacyFlags());
        return "ok";
    }

    @JavascriptInterface
    public String privacyHideRecents(boolean value) {
        Privacy.setHideRecents(activity, value);
        main.post(() -> activity.applyPrivacyFlags());
        return "ok";
    }

    @JavascriptInterface
    public boolean isWifi() {
        try {
            ConnectivityManager cm = (ConnectivityManager) activity.getSystemService(Context.CONNECTIVITY_SERVICE);
            if (cm == null) return false;
            Network network = cm.getActiveNetwork();
            if (network == null) return false;
            NetworkCapabilities caps = cm.getNetworkCapabilities(network);
            return caps != null && (caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)
                    || caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET));
        } catch (Exception e) {
            return false;
        }
    }

    @JavascriptInterface
    public void wenkuPrepare(String id, String novelId, String volumeId, String translator) {
        pool.execute(() -> {
            try {
                JSONObject meta = Wenku.prepare(activity, novelId, volumeId, translator);
                resolve(id, 200, meta.toString());
            } catch (ApiClient.ApiException e) {
                resolve(id, e.status, e.getMessage());
            } catch (Exception e) {
                resolve(id, 0, e.getMessage() == null ? "文库准备失败" : e.getMessage());
            }
        });
    }

    @JavascriptInterface
    public String authInfo() {
        return ApiClient.authInfo(activity).toString();
    }

    @JavascriptInterface
    public void authLogin(String id, String username, String password) {
        pool.execute(() -> {
            try {
                JSONObject info = ApiClient.login(activity, username, password);
                resolve(id, 200, info.toString());
            } catch (ApiClient.ApiException e) {
                resolve(id, e.status, e.getMessage());
            } catch (Exception e) {
                resolve(id, 0, e.getMessage() == null ? "登录失败" : e.getMessage());
            }
        });
    }

    @JavascriptInterface
    public String authLogout() {
        ApiClient.logout(activity);
        return "ok";
    }

    @JavascriptInterface
    public String relayGet() {
        return ApiClient.relayMode(activity);
    }

    @JavascriptInterface
    public String relaySet(String mode) {
        ApiClient.setRelayMode(activity, mode);
        return "ok";
    }

    @JavascriptInterface
    public String localChapter(String key, int index) {
        try {
            return Store.readChapter(activity, key, index);
        } catch (Exception e) {
            return "";
        }
    }

    @JavascriptInterface
    public String meta(String key) {
        try {
            return Store.metaJson(activity, key);
        } catch (Exception e) {
            return "";
        }
    }

    @JavascriptInterface
    public String downloads() {
        try {
            return Store.listJson(activity);
        } catch (Exception e) {
            return "[]";
        }
    }

    @JavascriptInterface
    public String storage() {
        return Store.storage(activity).toString();
    }

    @JavascriptInterface
    public String key(String provider, String novel) {
        return Store.key(provider, novel);
    }

    @JavascriptInterface
    public String download(String provider, String novelId, int limit, int start, int end) {
        try {
            String key = Store.key(provider, novelId);
            DownloadService.start(activity, provider, novelId, limit, start, end);
            return key;
        } catch (Exception e) {
            return "";
        }
    }

    @JavascriptInterface
    public void pause(String key) {
        try {
            DownloadService.pause(activity, key);
        } catch (Exception ignored) {}
    }

    @JavascriptInterface
    public String resume(String provider, String novelId, int limit, int start, int end) {
        try {
            DownloadService.start(activity, provider, novelId, limit, start, end);
            return Store.key(provider, novelId);
        } catch (Exception e) {
            return "";
        }
    }

    @JavascriptInterface
    public void remove(String key) {
        try {
            DownloadService.cancel(activity, key);
            Store.remove(activity, key);
        } catch (Exception ignored) {}
    }

    @JavascriptInterface
    public void clearAll() {
        try {
            Store.clearAll(activity);
        } catch (Exception ignored) {}
    }

    @JavascriptInterface
    public void copyText(String text) {
        main.post(() -> {
            try {
                ClipboardManager cm = (ClipboardManager) activity.getSystemService(Context.CLIPBOARD_SERVICE);
                cm.setPrimaryClip(ClipData.newPlainText("feedback", text == null ? "" : text));
            } catch (Exception ignored) {}
        });
    }

    @JavascriptInterface
    public void updateInfo(String id) {
        pool.execute(() -> {
            try {
                resolve(id, 200, UpdateManager.check(activity).toString());
            } catch (Exception e) {
                resolve(id, 0, e.getMessage() == null ? "检查更新失败" : e.getMessage());
            }
        });
    }

    @JavascriptInterface
    public void installUpdate(String id, String url, String sha) {
        pool.execute(() -> {
            try {
                resolve(id, 200, UpdateManager.install(activity, url == null ? "" : url, sha == null ? "" : sha).toString());
            } catch (Exception e) {
                resolve(id, 0, e.getMessage() == null ? "更新失败" : e.getMessage());
            }
        });
    }

    @JavascriptInterface
    public void usageCount(String id) {
        pool.execute(() -> {
            try {
                int n = Usage.count(activity);
                JSONObject o = new JSONObject();
                o.put("count", n);
                resolve(id, 200, o.toString());
            } catch (Exception e) {
                resolve(id, 0, e.getMessage() == null ? "暂时无法获取" : e.getMessage());
            }
        });
    }

    @JavascriptInterface
    public String version() {
        return "1.5.3";
    }

    @JavascriptInterface
    public void toast(String text) {
        main.post(() -> Toast.makeText(activity, text == null ? "" : text, Toast.LENGTH_SHORT).show());
    }

    @JavascriptInterface
    public void openWeb(String url) {
        if (url == null) return;
        try {
            android.net.Uri u = android.net.Uri.parse(url);
            String scheme = u.getScheme();
            String host = u.getHost();
            if (!"https".equals(scheme) || host == null) return;
            if (!(host.equals("novelia.cc") || host.endsWith(".novelia.cc"))) return;
            main.post(() -> {
                try {
                    Intent i = new Intent(activity, WebActivity.class);
                    i.putExtra("url", url);
                    activity.startActivity(i);
                } catch (Exception e) {
                    Toast.makeText(activity, "无法打开网页版", Toast.LENGTH_SHORT).show();
                }
            });
        } catch (Exception ignored) {}
    }

    @JavascriptInterface
    public void openExternal(String url) {
        if (url == null) return;
        main.post(() -> {
            try {
                Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                activity.startActivity(i);
            } catch (Exception e) {
                Toast.makeText(activity, "没有可用的浏览器", Toast.LENGTH_SHORT).show();
            }
        });
    }

    @JavascriptInterface
    public void share(String text) {
        main.post(() -> {
            try {
                Intent i = new Intent(Intent.ACTION_SEND);
                i.setType("text/plain");
                i.putExtra(Intent.EXTRA_TEXT, text == null ? "" : text);
                activity.startActivity(Intent.createChooser(i, "分享"));
            } catch (Exception ignored) {}
        });
    }

    @JavascriptInterface
    public void setDark(boolean dark) {
        main.post(() -> activity.setDark(dark));
    }

    @JavascriptInterface
    public void requestNotifications() {
        if (Build.VERSION.SDK_INT >= 33) {
            main.post(() -> {
                try {
                    activity.requestPermissions(new String[]{"android.permission.POST_NOTIFICATIONS"}, 901);
                } catch (Exception ignored) {}
            });
        }
    }

    @JavascriptInterface
    public void exit() {
        main.post(activity::finish);
    }
}
