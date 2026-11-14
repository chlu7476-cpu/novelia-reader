package cc.novelia.reader;

import android.content.ClipData;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.net.Uri;

import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.Locale;

/** Static GitHub Pages update channel: update.json + signed APK. */
final class UpdateManager {
    static final String MANIFEST_URL = "https://chlu7476-cpu.github.io/novelia-reader/update.json";
    private static final String APK_HOST = "chlu7476-cpu.github.io";
    private static boolean downloading = false;

    private UpdateManager() {}

    static File apkFile(Context ctx) {
        return new File(ctx.getCacheDir(), "update.apk");
    }

    static Uri apkUri(Context ctx) {
        return Uri.parse("content://" + ctx.getPackageName() + ".updates/update.apk");
    }

    static JSONObject check(Context ctx) throws Exception {
        JSONObject out = new JSONObject();
        PackageInfo pi = ctx.getPackageManager().getPackageInfo(ctx.getPackageName(), 0);
        long currentCode = android.os.Build.VERSION.SDK_INT >= 28 ? pi.getLongVersionCode() : pi.versionCode;
        out.put("currentCode", currentCode);
        out.put("currentName", pi.versionName == null ? "" : pi.versionName);
        JSONObject remote = new JSONObject(get(MANIFEST_URL + "?t=" + System.currentTimeMillis(), ctx, 12000));
        long code = remote.optLong("versionCode", 0);
        String name = remote.optString("versionName", "");
        String url = remote.optString("apkUrl", "");
        String notes = remote.optString("notes", "");
        String sha = remote.optString("sha256", "");
        long size = remote.optLong("size", 0);
        boolean has = code > currentCode && !url.isEmpty();
        out.put("hasUpdate", has);
        out.put("versionCode", code);
        out.put("versionName", name);
        out.put("apkUrl", url);
        out.put("notes", notes);
        out.put("sha256", sha);
        out.put("size", size);
        org.json.JSONObject notice = remote.optJSONObject("notice");
        if (notice != null) out.put("notice", notice);
        return out;
    }

    static JSONObject install(Context ctx, String url, String sha) throws Exception {
        synchronized (UpdateManager.class) {
            if (downloading) throw new Exception("正在下载更新，请稍候");
            downloading = true;
        }
        File tmp = new File(ctx.getCacheDir(), "update.apk.part");
        File dst = apkFile(ctx);
        try {
            URL u = new URL(url);
            if (!"https".equalsIgnoreCase(u.getProtocol()) || !APK_HOST.equalsIgnoreCase(u.getHost())) {
                throw new Exception("更新地址不合法");
            }
            if (tmp.exists()) tmp.delete();
            HttpURLConnection conn = null;
            try {
                conn = (HttpURLConnection) u.openConnection(ApiClient.proxy(ctx));
                conn.setConnectTimeout(12000);
                conn.setReadTimeout(30000);
                conn.setInstanceFollowRedirects(true);
                conn.setRequestProperty("User-Agent", "NoveliaReader/1.0");
                int code = conn.getResponseCode();
                if (code < 200 || code >= 300) throw new Exception("下载失败（" + code + "）");
                long total = conn.getContentLengthLong();
                if (total > 0 && total > 80L * 1024 * 1024) throw new Exception("更新包异常");
                InputStream in = conn.getInputStream();
                FileOutputStream out = new FileOutputStream(tmp);
                MessageDigest md = MessageDigest.getInstance("SHA-256");
                byte[] buf = new byte[8192];
                int n; long read = 0;
                while ((n = in.read(buf)) != -1) {
                    out.write(buf, 0, n);
                    md.update(buf, 0, n);
                    read += n;
                }
                out.flush(); out.close(); in.close();
                if (read < 1024) throw new Exception("更新包下载不完整");
                String actual = hex(md.digest());
                if (sha != null && !sha.isEmpty() && !sha.equalsIgnoreCase(actual)) {
                    throw new Exception("更新包校验失败，请重试");
                }
                if (dst.exists()) dst.delete();
                if (!tmp.renameTo(dst)) throw new Exception("更新包保存失败");
            } finally {
                if (conn != null) conn.disconnect();
            }
            Uri uri = apkUri(ctx);
            Intent i = new Intent(Intent.ACTION_VIEW);
            i.setDataAndType(uri, "application/vnd.android.package-archive");
            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            i.setClipData(ClipData.newRawUri("update", uri));
            ctx.startActivity(i);
            JSONObject o = new JSONObject();
            o.put("ok", true);
            return o;
        } catch (Exception e) {
            try { if (tmp.exists()) tmp.delete(); } catch (Exception ignored) {}
            throw e;
        } finally {
            synchronized (UpdateManager.class) { downloading = false; }
        }
    }

    private static String get(String urlText, Context ctx, int readTimeout) throws Exception {
        HttpURLConnection conn = null;
        try {
            URL u = new URL(urlText);
            conn = (HttpURLConnection) u.openConnection(ApiClient.proxy(ctx));
            conn.setConnectTimeout(10000);
            conn.setReadTimeout(readTimeout);
            conn.setRequestProperty("User-Agent", "NoveliaReader/1.0");
            conn.setRequestProperty("Accept", "application/json");
            int code = conn.getResponseCode();
            InputStream in = code >= 400 ? conn.getErrorStream() : conn.getInputStream();
            if (in == null) throw new Exception("更新服务无响应");
            java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
            byte[] buf = new byte[4096]; int n;
            while ((n = in.read(buf)) != -1) out.write(buf, 0, n);
            in.close();
            if (code < 200 || code >= 300) throw new Exception("更新服务返回 " + code);
            return new String(out.toByteArray(), "UTF-8");
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private static String hex(byte[] bytes) {
        StringBuilder sb = new StringBuilder();
        for (byte b : bytes) sb.append(String.format(Locale.US, "%02x", b));
        return sb.toString();
    }
}
