package cc.novelia.reader;

import android.content.Context;
import android.net.Uri;
import android.provider.OpenableColumns;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.List;

/** Reads user-selected EPUB/TXT/SRT files through SAF and imports them into the local store. */
final class BookImporter {
    private BookImporter() {}

    static JSONArray importFiles(Context ctx, List<Uri> uris) throws Exception {
        JSONArray out = new JSONArray();
        Exception last = null;
        for (Uri uri : uris) {
            try {
                String name = displayName(ctx, uri);
                byte[] data = read(ctx, uri);
                JSONObject meta = Wenku.importLocal(ctx, name, data);
                out.put(meta);
            } catch (Exception e) {
                last = e;
            }
        }
        if (out.length() == 0) {
            throw new Exception(last == null ? "没有导入任何文件" : (last.getMessage() == null ? "导入失败" : last.getMessage()));
        }
        return out;
    }

    private static String displayName(Context ctx, Uri uri) {
        try (android.database.Cursor c = ctx.getContentResolver().query(uri, null, null, null, null)) {
            if (c != null && c.moveToFirst()) {
                int idx = c.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (idx >= 0) {
                    String n = c.getString(idx);
                    if (n != null && !n.trim().isEmpty()) return n;
                }
            }
        } catch (Exception ignored) {}
        String s = uri.getLastPathSegment();
        return s == null || s.isEmpty() ? "本地书籍.epub" : s;
    }

    private static byte[] read(Context ctx, Uri uri) throws Exception {
        InputStream in = ctx.getContentResolver().openInputStream(uri);
        if (in == null) throw new Exception("无法读取文件");
        try {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[8192]; int n; long total = 0;
            while ((n = in.read(buf)) != -1) {
                total += n;
                if (total > 64L * 1024 * 1024) throw new Exception("文件不能超过 64 MB");
                out.write(buf, 0, n);
            }
            return out.toByteArray();
        } finally { in.close(); }
    }
}
