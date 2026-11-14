package cc.novelia.reader;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONObject;

import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/** Anonymous, account-free install counter. One increment per app install. */
final class Usage {
    private static final String NS = "novelia_reader_cc";
    private static final String KEY = "installs";
    private static final String BASE = "https://abacus.jasoncameron.dev";
    private static final String PREFS = "usage_stats";

    private Usage() {}

    static void reportInstall(Context ctx) {
        SharedPreferences sp = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        if (sp.getBoolean("reported", false)) return;
        try {
            JSONObject o = new JSONObject(get(BASE + "/hit/" + NS + "/" + KEY, ctx));
            if (o.optInt("value", 0) > 0) {
                sp.edit().putBoolean("reported", true).apply();
            }
        } catch (Exception ignored) {
            // Offline / blocked: retry on a later launch, never block startup.
        }
    }

    static int count(Context ctx) throws Exception {
        JSONObject o = new JSONObject(get(BASE + "/get/" + NS + "/" + KEY, ctx));
        return o.optInt("value", 0);
    }

    private static String get(String urlText, Context ctx) throws Exception {
        HttpURLConnection conn = null;
        try {
            URL url = new URL(urlText);
            conn = (HttpURLConnection) url.openConnection(ApiClient.proxy(ctx));
            conn.setConnectTimeout(8000);
            conn.setReadTimeout(8000);
            conn.setRequestMethod("GET");
            conn.setRequestProperty("User-Agent", "NoveliaReader/1.0");
            conn.setRequestProperty("Accept", "application/json");
            int code = conn.getResponseCode();
            InputStream in = code >= 400 ? conn.getErrorStream() : conn.getInputStream();
            if (in == null) throw new Exception("统计服务无响应");
            java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
            byte[] buf = new byte[2048]; int n;
            while ((n = in.read(buf)) != -1) out.write(buf, 0, n);
            in.close();
            if (code < 200 || code >= 300) throw new Exception("统计服务返回 " + code);
            return new String(out.toByteArray(), StandardCharsets.UTF_8);
        } finally {
            if (conn != null) conn.disconnect();
        }
    }
}
