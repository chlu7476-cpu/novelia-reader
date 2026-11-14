package cc.novelia.reader;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Base64;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.InetSocketAddress;
import java.net.Proxy;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.zip.GZIPInputStream;

/** Tiny HTTP client for the public Novelia API. All traffic goes through one place so the
 *  optional user proxy (HTTP CONNECT or SOCKS5) also covers reading and downloading. */
final class ApiClient {
    static final String HOST = "books.fishhawk.top";
    static final String API_BASE = "https://" + HOST + "/api/";
    static final String SITE_BASE = "https://" + HOST + "/";
    static final String FALLBACK_HOST = "n.novelia.cc";
    static final String FALLBACK_API_BASE = "https://" + FALLBACK_HOST + "/api/";
    private static final String UA =
            "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 "
                    + "(KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36 NoveliaReader/1.0";
    private static final int CONNECT_TIMEOUT = 15000;
    private static final int READ_TIMEOUT = 35000;
    private static final int MAX_BODY = 12 * 1024 * 1024;
    private static final String AUTH_PREFS = "auth";
    private static volatile boolean relayOnly = false;
    private static volatile String activeBase = API_BASE;

    private ApiClient() {}

    static boolean relayActive() { return relayOnly; }

    static void resetRoute() { relayOnly = false; }

    static String relayMode(Context ctx) {
        return ctx.getSharedPreferences("network", Context.MODE_PRIVATE)
                .getString("relay_mode", "auto");
    }

    static void setRelayMode(Context ctx, String mode) {
        ctx.getSharedPreferences("network", Context.MODE_PRIVATE).edit()
                .putString("relay_mode", mode == null ? "auto" : mode).apply();
        resetRoute();
    }

    static boolean looksJson(String s) {
        if (s == null) return false;
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c == ' ' || c == '\n' || c == '\r' || c == '\t') continue;
            return c == '{' || c == '[';
        }
        return false;
    }

    static class ApiException extends IOException {
        final int status;
        ApiException(int status, String message) {
            super(message);
            this.status = status;
        }
    }

    static Proxy proxy(Context ctx) {
        SharedPreferences sp = ctx.getSharedPreferences("network", Context.MODE_PRIVATE);
        String mode = sp.getString("proxy_mode", "none");
        if (mode == null || mode.equals("none")) return Proxy.NO_PROXY;
        String host = sp.getString("proxy_host", "").trim();
        int port;
        try {
            port = Integer.parseInt(sp.getString("proxy_port", "0").trim());
        } catch (Exception e) {
            port = 0;
        }
        if (host.isEmpty() || port <= 0 || port > 65535) return Proxy.NO_PROXY;
        Proxy.Type type = mode.equals("socks") ? Proxy.Type.SOCKS : Proxy.Type.HTTP;
        return new Proxy(type, InetSocketAddress.createUnresolved(host, port));
    }

    static String authToken(Context ctx) {
        SharedPreferences sp = ctx.getSharedPreferences(AUTH_PREFS, Context.MODE_PRIVATE);
        String token = sp.getString("token", "");
        if (token == null || token.isEmpty()) return "";
        try {
            long exp = jwtPayload(token).optLong("exp", 0);
            if (exp > 0 && exp * 1000L <= System.currentTimeMillis()) return "";
        } catch (Exception ignored) {}
        return token;
    }

    static JSONObject jwtPayload(String token) throws Exception {
        String[] parts = token.split("\\.");
        if (parts.length < 2) throw new Exception("无效令牌");
        byte[] raw = Base64.decode(parts[1], Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING);
        return new JSONObject(new String(raw, StandardCharsets.UTF_8));
    }

    static JSONObject authInfo(Context ctx) {
        JSONObject o = new JSONObject();
        try {
            String token = authToken(ctx);
            o.put("loggedIn", !token.isEmpty());
            if (token.isEmpty()) {
                o.put("user", "");
                o.put("canR18", false);
                o.put("ageDays", 0);
                return o;
            }
            JSONObject p = jwtPayload(token);
            long exp = p.optLong("exp", 0);
            long crat = p.optLong("crat", 0);
            long days = crat > 0 ? Math.max(0, (System.currentTimeMillis() / 1000L - crat) / 86400L) : 0;
            o.put("loggedIn", exp == 0 || exp * 1000L > System.currentTimeMillis());
            o.put("user", p.optString("sub", ""));
            o.put("role", p.optString("role", ""));
            o.put("exp", exp);
            o.put("createdAt", crat);
            o.put("ageDays", days);
            o.put("canR18", days >= 30);
        } catch (Exception e) {
            try {
                o.put("loggedIn", false);
                o.put("user", "");
                o.put("canR18", false);
                o.put("ageDays", 0);
                o.put("message", e.getMessage() == null ? "登录状态无效" : e.getMessage());
            } catch (Exception ignored) {}
        }
        return o;
    }

    static void logout(Context ctx) {
        ctx.getSharedPreferences(AUTH_PREFS, Context.MODE_PRIVATE).edit().clear().apply();
    }

    static JSONObject login(Context ctx, String username, String password) throws IOException {
        if (username == null || username.trim().isEmpty() || password == null || password.isEmpty()) {
            throw new IOException("请填写用户名和密码");
        }
        HttpURLConnection conn = null;
        try {
            JSONObject payload = new JSONObject();
            payload.put("app", "n");
            payload.put("username", username.trim());
            payload.put("password", password);
            byte[] bytes = payload.toString().getBytes(StandardCharsets.UTF_8);

            URL url = new URL("https://auth.novelia.cc/api/v1/auth/login");
            conn = (HttpURLConnection) url.openConnection(proxy(ctx));
            conn.setConnectTimeout(CONNECT_TIMEOUT);
            conn.setReadTimeout(READ_TIMEOUT);
            conn.setRequestMethod("POST");
            conn.setDoOutput(true);
            conn.setFixedLengthStreamingMode(bytes.length);
            conn.setRequestProperty("User-Agent", UA);
            conn.setRequestProperty("Accept", "application/json,text/plain,*/*");
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setRequestProperty("Origin", "https://books.fishhawk.top");
            conn.setRequestProperty("Accept-Encoding", "gzip");
            OutputStream out = conn.getOutputStream();
            out.write(bytes);
            out.close();

            int code = conn.getResponseCode();
            InputStream raw = code >= 400 ? conn.getErrorStream() : conn.getInputStream();
            String body = readAll(raw, conn.getContentEncoding());
            if (code < 200 || code >= 300) {
                String msg = body == null ? "" : body.trim();
                if (msg.length() > 300) msg = msg.substring(0, 300);
                if (msg.isEmpty()) msg = "登录失败（" + code + "）";
                throw new ApiException(code, msg);
            }
            String token = body == null ? "" : body.trim();
            if (token.startsWith("\"") && token.endsWith("\"") && token.length() > 2) {
                token = token.substring(1, token.length() - 1);
            }
            if (token.isEmpty()) throw new IOException("登录服务没有返回令牌");
            JSONObject info;
            try { info = jwtPayload(token); } catch (Exception e) { throw new IOException("登录令牌格式异常"); }
            String user = info.optString("sub", username.trim());
            ctx.getSharedPreferences(AUTH_PREFS, Context.MODE_PRIVATE).edit()
                    .putString("token", token)
                    .putString("user", user)
                    .putLong("savedAt", System.currentTimeMillis())
                    .apply();
            JSONObject result = authInfo(ctx);
            result.put("ok", true);
            return result;
        } catch (ApiException e) {
            throw e;
        } catch (Exception e) {
            throw new IOException(e.getMessage() == null ? "登录失败" : e.getMessage(), e);
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    static byte[] getBytes(Context ctx, String path) throws IOException {
        String urlText = path.startsWith("http://") || path.startsWith("https://")
                ? path : activeBase + (path.startsWith("/") ? path.substring(1) : path);
        try {
            return fetchBytes(ctx, urlText);
        } catch (IOException first) {
            if (urlText.startsWith(API_BASE)) {
                String alt = FALLBACK_API_BASE + urlText.substring(API_BASE.length());
                try {
                    byte[] body = fetchBytes(ctx, alt);
                    activeBase = FALLBACK_API_BASE;
                    return body;
                } catch (IOException ignored) {}
            }
            throw first;
        }
    }

    private static byte[] fetchBytes(Context ctx, String urlText) throws IOException {
        HttpURLConnection conn = null;
        try {
            URL url = new URL(urlText);
            conn = (HttpURLConnection) url.openConnection(proxy(ctx));
            conn.setConnectTimeout(CONNECT_TIMEOUT);
            conn.setReadTimeout(120000);
            conn.setInstanceFollowRedirects(true);
            conn.setRequestMethod("GET");
            conn.setRequestProperty("User-Agent", UA);
            conn.setRequestProperty("Accept", "application/epub+zip,application/octet-stream,text/plain,*/*");
            conn.setRequestProperty("Accept-Language", "zh-CN,zh;q=0.9,ja;q=0.7");
            String host = url.getHost();
            if ("books.fishhawk.top".equals(host) || "n.novelia.cc".equals(host) || "forum.novelia.cc".equals(host)) {
                String token = authToken(ctx);
                if (!token.isEmpty()) conn.setRequestProperty("Authorization", "Bearer " + token);
            }
            int code = conn.getResponseCode();
            InputStream raw = code >= 400 ? conn.getErrorStream() : conn.getInputStream();
            if (code < 200 || code >= 300) {
                String body = readAll(raw, conn.getContentEncoding());
                String msg = body == null ? "" : body.trim();
                if (msg.length() > 300) msg = msg.substring(0, 300);
                if (msg.isEmpty()) msg = "下载失败（" + code + "）";
                throw new ApiException(code, msg);
            }
            if (raw == null) throw new IOException("下载内容为空");
            InputStream is = raw;
            if (conn.getContentEncoding() != null && conn.getContentEncoding().toLowerCase().contains("gzip")) {
                is = new GZIPInputStream(raw);
            }
            ByteArrayOutputStream out = new ByteArrayOutputStream(65536);
            byte[] buf = new byte[8192];
            int n;
            int total = 0;
            while ((n = is.read(buf)) != -1) {
                total += n;
                if (total > 64 * 1024 * 1024) throw new IOException("文件过大");
                out.write(buf, 0, n);
            }
            is.close();
            return out.toByteArray();
        } catch (ApiException e) {
            throw e;
        } catch (Exception e) {
            throw new IOException(e.getMessage() == null ? "下载失败" : e.getMessage(), e);
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    static String postJson(Context ctx, String urlText, String jsonBody) throws IOException {
        HttpURLConnection conn = null;
        try {
            byte[] bytes = (jsonBody == null ? "" : jsonBody).getBytes(StandardCharsets.UTF_8);
            URL url = new URL(urlText);
            conn = (HttpURLConnection) url.openConnection(proxy(ctx));
            conn.setConnectTimeout(CONNECT_TIMEOUT);
            conn.setReadTimeout(READ_TIMEOUT);
            conn.setRequestMethod("POST");
            conn.setDoOutput(true);
            conn.setFixedLengthStreamingMode(bytes.length);
            conn.setRequestProperty("User-Agent", UA);
            conn.setRequestProperty("Accept", "application/json,text/plain,*/*");
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setRequestProperty("Origin", "https://books.fishhawk.top");
            conn.setRequestProperty("Accept-Encoding", "gzip");
            String token = authToken(ctx);
            if (!token.isEmpty()) conn.setRequestProperty("Authorization", "Bearer " + token);
            OutputStream out = conn.getOutputStream();
            out.write(bytes);
            out.close();

            int code = conn.getResponseCode();
            InputStream raw = code >= 400 ? conn.getErrorStream() : conn.getInputStream();
            String body = readAll(raw, conn.getContentEncoding());
            if (code < 200 || code >= 300) {
                String msg = body == null ? "" : body.trim();
                if (msg.length() > 300) msg = msg.substring(0, 300);
                if (msg.isEmpty()) msg = "请求失败（" + code + "）";
                throw new ApiException(code, msg);
            }
            return body == null ? "" : body;
        } catch (ApiException e) {
            throw e;
        } catch (Exception e) {
            throw new IOException(e.getMessage() == null ? "评论请求失败" : e.getMessage(), e);
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    static JSONObject proxyInfo(Context ctx) {
        SharedPreferences sp = ctx.getSharedPreferences("network", Context.MODE_PRIVATE);
        JSONObject o = new JSONObject();
        try {
            o.put("mode", sp.getString("proxy_mode", "none"));
            o.put("host", sp.getString("proxy_host", ""));
            o.put("port", sp.getString("proxy_port", ""));
        } catch (Exception ignored) {}
        return o;
    }

    static void setProxy(Context ctx, String mode, String host, String port) {
        SharedPreferences.Editor e = ctx.getSharedPreferences("network", Context.MODE_PRIVATE).edit();
        e.putString("proxy_mode", mode == null ? "none" : mode);
        e.putString("proxy_host", host == null ? "" : host.trim());
        e.putString("proxy_port", port == null ? "" : port.trim());
        e.apply();
        resetRoute();
    }

    static String enc(String s) {
        try {
            return URLEncoder.encode(s == null ? "" : s, "UTF-8").replace("+", "%20");
        } catch (Exception e) {
            return "";
        }
    }

    private static String requestDirect(Context ctx, String url) throws IOException {
        try {
            return request(ctx, url);
        } catch (IOException first) {
            if (url.startsWith(API_BASE)) {
                String alt = FALLBACK_API_BASE + url.substring(API_BASE.length());
                try {
                    String body = request(ctx, alt);
                    activeBase = FALLBACK_API_BASE;
                    return body;
                } catch (IOException ignored) {}
            }
            throw first;
        }
    }

    static String get(Context ctx, String path) throws IOException {
        String url = path.startsWith("http://") || path.startsWith("https://")
                ? path : activeBase + (path.startsWith("/") ? path.substring(1) : path);
        String mode = relayMode(ctx);
        if ("on".equals(mode)) {
            relayOnly = true;
            return requestRelay(ctx, url);
        }
        if ("auto".equals(mode) && relayOnly) {
            try {
                return requestRelay(ctx, url);
            } catch (IOException relayError) {
                relayOnly = false;
                return request(ctx, url);
            }
        }
        try {
            String body = requestDirect(ctx, url);
            if ("auto".equals(mode) && url.contains("/api/") && !looksJson(body)) {
                try {
                    String relayed = requestRelay(ctx, url);
                    if (looksJson(relayed)) { relayOnly = true; return relayed; }
                } catch (IOException ignored) {}
            }
            return body;
        } catch (IOException directError) {
            if (!"auto".equals(mode)) throw directError;
            if (directError instanceof ApiException) {
                int code = ((ApiException) directError).status;
                if (code == 401 || code == 404) throw directError;
            }
            try {
                String relayed = requestRelay(ctx, url);
                relayOnly = true;
                return relayed;
            } catch (IOException relayError) {
                throw new IOException("直连失败：" + directError.getMessage()
                        + "；只读加速也失败：" + relayError.getMessage(), directError);
            }
        }
    }

    /** r.jina.ai returns a short metadata header followed by the original API body. */
    private static String requestRelay(Context ctx, String target) throws IOException {
        String raw = request(ctx, "https://r.jina.ai/" + target);
        int idx = raw.lastIndexOf("Markdown Content:");
        if (idx >= 0) raw = raw.substring(idx + "Markdown Content:".length());
        raw = raw.trim();
        if (!looksJson(raw)) throw new IOException("只读加速返回了非 JSON 内容");
        return raw;
    }

    static String getSite(Context ctx, String url) throws IOException {
        return request(ctx, url);
    }

    private static String request(Context ctx, String urlText) throws IOException {
        HttpURLConnection conn = null;
        try {
            URL url = new URL(urlText);
            conn = (HttpURLConnection) url.openConnection(proxy(ctx));
            conn.setConnectTimeout(CONNECT_TIMEOUT);
            conn.setReadTimeout(READ_TIMEOUT);
            conn.setInstanceFollowRedirects(true);
            conn.setRequestMethod("GET");
            conn.setRequestProperty("User-Agent", UA);
            conn.setRequestProperty("Accept", "application/json,text/plain,*/*");
            conn.setRequestProperty("Accept-Language", "zh-CN,zh;q=0.9,ja;q=0.7");
            conn.setRequestProperty("Accept-Encoding", "gzip");
            conn.setRequestProperty("Connection", "keep-alive");
            String host = url.getHost();
            if ("books.fishhawk.top".equals(host) || "n.novelia.cc".equals(host) || "forum.novelia.cc".equals(host)) {
                String token = authToken(ctx);
                if (!token.isEmpty()) conn.setRequestProperty("Authorization", "Bearer " + token);
            }

            int code = conn.getResponseCode();
            InputStream raw = code >= 400 ? conn.getErrorStream() : conn.getInputStream();
            String body = readAll(raw, conn.getContentEncoding());
            if (code < 200 || code >= 300) {
                String msg = body == null ? "" : body.trim();
                if (msg.length() > 300) msg = msg.substring(0, 300);
                if (msg.isEmpty()) msg = "服务器返回 " + code;
                throw new ApiException(code, msg);
            }
            return body == null ? "" : body;
        } catch (ApiException e) {
            throw e;
        } catch (java.net.SocketTimeoutException e) {
            throw new IOException("连接超时，请检查网络或代理设置", e);
        } catch (javax.net.ssl.SSLException e) {
            throw new IOException("TLS 握手失败，请检查网络或代理设置", e);
        } catch (java.net.UnknownHostException e) {
            throw new IOException("无法解析域名 " + HOST, e);
        } catch (java.net.ConnectException e) {
            throw new IOException("无法连接服务器，可能被网络屏蔽", e);
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private static String readAll(InputStream in, String encoding) throws IOException {
        if (in == null) return "";
        InputStream is = in;
        if (encoding != null && encoding.toLowerCase().contains("gzip")) {
            is = new GZIPInputStream(in);
        }
        ByteArrayOutputStream out = new ByteArrayOutputStream(8192);
        byte[] buf = new byte[8192];
        int n;
        int total = 0;
        while ((n = is.read(buf)) != -1) {
            total += n;
            if (total > MAX_BODY) throw new IOException("响应过大");
            out.write(buf, 0, n);
        }
        is.close();
        return new String(out.toByteArray(), StandardCharsets.UTF_8);
    }

    static JSONObject test(Context ctx) {
        JSONObject o = new JSONObject();
        long t0 = System.currentTimeMillis();
        try {
            String body = get(ctx, "novel?page=0&pageSize=1&level=1&provider=syosetu&sort=0");
            long ms = System.currentTimeMillis() - t0;
            o.put("ok", true);
            o.put("ms", ms);
            o.put("route", relayOnly ? "只读加速" : "直连");
            o.put("message", "连接正常 · " + ms + " ms · " + (relayOnly ? "只读加速" : "直连"));
            o.put("sample", body.length());
        } catch (Exception e) {
            try {
                o.put("ok", false);
                o.put("ms", System.currentTimeMillis() - t0);
                o.put("message", e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage());
            } catch (Exception ignored) {}
        }
        return o;
    }
}
