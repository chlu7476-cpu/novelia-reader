package cc.novelia.reader;

import android.content.Context;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/** Minimal native client for the official forum API. Tokens stay in the WebView's local storage;
 *  this class only performs the HTTP request so the page never needs CORS. */
final class ForumClient {
    private static final String API = "https://forum.novelia.cc/api/v1/";
    private static final String LOGIN = "https://auth.novelia.cc/api/v1/auth/login";

    private ForumClient() {}

    static String request(Context ctx, String method, String path, String body, String token) throws Exception {
        if (path == null || path.startsWith("http") || path.contains("..") || path.indexOf('\\') >= 0) {
            throw new Exception("论坛路径不合法");
        }
        if (!(path.startsWith("post/") || path.startsWith("category/"))) {
            throw new Exception("论坛路径不合法");
        }
        String m = method == null ? "GET" : method.toUpperCase(java.util.Locale.US);
        if (!m.equals("GET") && !m.equals("POST")) throw new Exception("论坛请求方式不支持");
        return call(ctx, m, API + path, body, token, "https://forum.novelia.cc");
    }

    static String login(Context ctx, String username, String password) throws Exception {
        if (username == null || username.trim().isEmpty() || password == null || password.isEmpty()) {
            throw new Exception("请填写论坛账号和密码");
        }
        JSONObject body = new JSONObject();
        body.put("app", "f");
        body.put("username", username.trim());
        body.put("password", password);
        return call(ctx, "POST", LOGIN, body.toString(), null, "https://forum.novelia.cc");
    }

    private static String call(Context ctx, String method, String urlText, String body, String token, String origin) throws Exception {
        HttpURLConnection conn = null;
        try {
            URL url = new URL(urlText);
            conn = (HttpURLConnection) url.openConnection(ApiClient.proxy(ctx));
            conn.setRequestMethod(method);
            conn.setConnectTimeout(15000);
            conn.setReadTimeout(25000);
            conn.setInstanceFollowRedirects(true);
            conn.setRequestProperty("Accept", "application/json");
            conn.setRequestProperty("User-Agent", "NoveliaReader/1.6.7");
            conn.setRequestProperty("Origin", origin);
            conn.setRequestProperty("Referer", origin + "/");
            if (token != null && !token.isEmpty()) conn.setRequestProperty("Authorization", "Bearer " + token);
            if (body != null && !body.isEmpty() && !"GET".equals(method)) {
                conn.setDoOutput(true);
                conn.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
                conn.setFixedLengthStreamingMode(bytes.length);
                OutputStream out = conn.getOutputStream();
                out.write(bytes); out.flush(); out.close();
            }
            int code = conn.getResponseCode();
            InputStream in = code >= 400 ? conn.getErrorStream() : conn.getInputStream();
            if (in == null) throw new Exception("论坛服务无响应");
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[8192]; int n;
            while ((n = in.read(buf)) != -1) out.write(buf, 0, n);
            in.close();
            String text = out.toString("UTF-8");
            if (code < 200 || code >= 300) {
                String msg = text == null ? "" : text.trim();
                if (msg.length() > 300) msg = msg.substring(0, 300);
                throw new Exception(msg.isEmpty() ? ("论坛请求失败（" + code + "）") : msg);
            }
            return text;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }
}
