package cc.novelia.reader;

import android.content.Context;
import android.os.StatFs;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;

/** On-device library. Books live under files/novels/<key>/:
 *   meta.json    static metadata + full TOC
 *   state.json   live download state
 *   c00001.json  raw chapter payload
 */
final class Store {
    private Store() {}

    static File root(Context ctx) {
        File f = new File(ctx.getFilesDir(), "novels");
        if (!f.exists()) f.mkdirs();
        return f;
    }

    static String key(String provider, String novel) {
        String raw = (provider == null ? "" : provider) + "__" + (novel == null ? "" : novel);
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < raw.length() && sb.length() < 110; i++) {
            char c = raw.charAt(i);
            if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')
                    || c == '.' || c == '_' || c == '-') sb.append(c);
            else sb.append('_');
        }
        if (sb.length() == 0) sb.append("book");
        return sb.toString();
    }

    static File dir(Context ctx, String key) {
        return new File(root(ctx), key);
    }

    private static File metaFile(Context ctx, String key) { return new File(dir(ctx, key), "meta.json"); }
    private static File stateFile(Context ctx, String key) { return new File(dir(ctx, key), "state.json"); }
    private static File chapterFile(Context ctx, String key, int index) {
        return new File(dir(ctx, key), String.format(java.util.Locale.US, "c%05d.json", index));
    }

    static synchronized void saveMeta(Context ctx, String key, JSONObject meta) throws IOException {
        File d = dir(ctx, key);
        if (!d.exists()) d.mkdirs();
        writeAtomic(metaFile(ctx, key), meta.toString());
    }

    static synchronized void saveState(Context ctx, String key, JSONObject state) throws IOException {
        File d = dir(ctx, key);
        if (!d.exists()) d.mkdirs();
        try { state.put("updatedAt", System.currentTimeMillis()); } catch (Exception ignored) {}
        writeAtomic(stateFile(ctx, key), state.toString());
    }

    static JSONObject readMeta(Context ctx, String key) {
        return readJson(metaFile(ctx, key));
    }

    static JSONObject readState(Context ctx, String key) {
        return readJson(stateFile(ctx, key));
    }

    static boolean hasMeta(Context ctx, String key) {
        return metaFile(ctx, key).isFile();
    }

    static synchronized void saveChapter(Context ctx, String key, int index, String json) throws IOException {
        File d = dir(ctx, key);
        if (!d.exists()) d.mkdirs();
        writeAtomic(chapterFile(ctx, key, index), json);
    }

    static boolean hasChapter(Context ctx, String key, int index) {
        return chapterFile(ctx, key, index).isFile();
    }

    static long chapterSize(Context ctx, String key, int index) {
        return chapterFile(ctx, key, index).length();
    }

    static String readChapter(Context ctx, String key, int index) {
        File f = chapterFile(ctx, key, index);
        if (!f.isFile()) return "";
        try {
            return readString(f);
        } catch (Exception e) {
            return "";
        }
    }

    static String metaJson(Context ctx, String key) {
        JSONObject meta = readMeta(ctx, key);
        if (meta == null) return "";
        JSONObject state = readState(ctx, key);
        if (state != null) {
            try {
                for (String k : new String[]{"status", "done", "bytes", "error", "limit", "downloadable", "target", "rangeStart", "rangeEnd", "startedAt", "finishedAt"}) {
                    if (state.has(k)) meta.put(k, state.get(k));
                }
            } catch (Exception ignored) {}
        }
        return meta.toString();
    }

    static String listJson(Context ctx) {
        JSONArray arr = new JSONArray();
        File[] dirs = root(ctx).listFiles();
        if (dirs == null) return arr.toString();
        for (File d : dirs) {
            if (!d.isDirectory()) continue;
            JSONObject meta = readJson(new File(d, "meta.json"));
            if (meta == null) continue;
            if ("wenku".equals(meta.optString("source"))) continue;
            JSONObject state = readJson(new File(d, "state.json"));
            try {
                JSONObject o = new JSONObject();
                o.put("key", d.getName());
                o.put("providerId", meta.optString("providerId"));
                o.put("novelId", meta.optString("novelId"));
                o.put("titleZh", meta.optString("titleZh"));
                o.put("titleJp", meta.optString("titleJp"));
                o.put("author", meta.optString("author"));
                o.put("type", meta.optString("type"));
                o.put("total", meta.optInt("total"));
                o.put("downloadable", meta.optInt("downloadable"));
                o.put("createdAt", meta.optLong("createdAt"));
                if (state != null) {
                    o.put("status", state.optString("status", "paused"));
                    o.put("done", state.optInt("done"));
                    o.put("bytes", state.optLong("bytes"));
                    o.put("error", state.optString("error"));
                    o.put("limit", state.optInt("limit"));
                    o.put("target", state.optInt("target"));
                    o.put("rangeStart", state.optInt("rangeStart"));
                    o.put("rangeEnd", state.optInt("rangeEnd"));
                    o.put("updatedAt", state.optLong("updatedAt"));
                } else {
                    o.put("status", "paused");
                    o.put("done", 0);
                    o.put("bytes", 0L);
                    o.put("error", "");
                    o.put("updatedAt", meta.optLong("createdAt"));
                }
                arr.put(o);
            } catch (Exception ignored) {}
        }
        JSONArray sorted = new JSONArray();
        try {
            java.util.List<JSONObject> list = new java.util.ArrayList<>();
            for (int i = 0; i < arr.length(); i++) list.add(arr.getJSONObject(i));
            list.sort((a, b) -> Long.compare(b.optLong("updatedAt"), a.optLong("updatedAt")));
            for (JSONObject o : list) sorted.put(o);
        } catch (Exception e) {
            return arr.toString();
        }
        return sorted.toString();
    }

    static JSONObject storage(Context ctx) {
        JSONObject o = new JSONObject();
        try {
            long bytes = dirSize(root(ctx));
            StatFs sf = new StatFs(ctx.getFilesDir().getAbsolutePath());
            long free = sf.getAvailableBytes();
            o.put("bytes", bytes);
            o.put("free", free);
        } catch (Exception e) {
            try {
                o.put("bytes", 0);
                o.put("free", 0);
            } catch (Exception ignored) {}
        }
        return o;
    }

    static void remove(Context ctx, String key) {
        deleteRec(dir(ctx, key));
    }

    static void clearAll(Context ctx) {
        File[] dirs = root(ctx).listFiles();
        if (dirs == null) return;
        for (File d : dirs) deleteRec(d);
    }

    private static long dirSize(File f) {
        if (f == null || !f.exists()) return 0;
        if (f.isFile()) return f.length();
        long n = 0;
        File[] fs = f.listFiles();
        if (fs != null) for (File c : fs) n += dirSize(c);
        return n;
    }

    private static void deleteRec(File f) {
        if (f == null || !f.exists()) return;
        if (f.isDirectory()) {
            File[] fs = f.listFiles();
            if (fs != null) for (File c : fs) deleteRec(c);
        }
        //noinspection ResultOfMethodCallIgnored
        f.delete();
    }

    private static JSONObject readJson(File f) {
        if (f == null || !f.isFile()) return null;
        try {
            return new JSONObject(readString(f));
        } catch (Exception e) {
            return null;
        }
    }

    private static String readString(File f) throws IOException {
        FileInputStream in = new FileInputStream(f);
        ByteArrayOutputStream out = new ByteArrayOutputStream((int) Math.min(f.length(), 1 << 20));
        byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) != -1) out.write(buf, 0, n);
        in.close();
        return new String(out.toByteArray(), StandardCharsets.UTF_8);
    }

    private static void writeAtomic(File f, String text) throws IOException {
        File tmp = new File(f.getParentFile(), f.getName() + ".tmp");
        FileOutputStream out = new FileOutputStream(tmp);
        out.write(text.getBytes(StandardCharsets.UTF_8));
        out.flush();
        out.getFD().sync();
        out.close();
        if (f.exists() && !f.delete()) {
            //noinspection ResultOfMethodCallIgnored
            tmp.delete();
            throw new IOException("无法覆盖文件");
        }
        if (!tmp.renameTo(f)) {
            //noinspection ResultOfMethodCallIgnored
            tmp.delete();
            throw new IOException("无法写入文件");
        }
    }
}
