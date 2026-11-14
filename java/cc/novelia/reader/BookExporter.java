package cc.novelia.reader;

import android.content.Context;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

/** Exports locally downloaded chapters to TXT or a minimal EPUB 3 file. */
final class BookExporter {
    private BookExporter() {}

    static File build(Context ctx, String provider, String novel, String format) throws Exception {
        String key = Store.key(provider, novel);
        JSONObject meta = Store.readMeta(ctx, key);
        if (meta == null) throw new Exception("还没有下载这本书");
        String title = first(meta.optString("titleZh"), meta.optString("titleJp"), "Novelia");
        String author = meta.optString("author", "");
        JSONArray toc = meta.optJSONArray("toc");
        if (toc == null) toc = new JSONArray();
        List<Chapter> chapters = new ArrayList<>();
        for (int i = 0; i < toc.length(); i++) {
            JSONObject item = toc.optJSONObject(i);
            if (item == null) continue;
            String raw = Store.readChapter(ctx, key, i);
            if (raw == null || raw.isEmpty()) continue;
            try {
                JSONObject c = new JSONObject(raw);
                String ct = first(c.optString("titleZh"), c.optString("titleJp"), item.optString("titleZh"), item.optString("titleJp"), "第 " + (i + 1) + " 章");
                List<String> paras = paragraphs(c);
                if (!paras.isEmpty()) chapters.add(new Chapter(ct, paras));
            } catch (Exception ignored) {}
        }
        if (chapters.isEmpty()) throw new Exception("还没有下载章节，先下载整本再导出");
        File dir = new File(ctx.getCacheDir(), "exports");
        if (!dir.exists()) dir.mkdirs();
        String safe = title.replaceAll("[\\\\/:*?\"<>|\\r\\n]+", "_").trim();
        if (safe.length() > 60) safe = safe.substring(0, 60);
        if (safe.isEmpty()) safe = "Novelia";
        if ("epub".equalsIgnoreCase(format)) {
            File out = new File(dir, safe + ".epub");
            writeEpub(out, title, author, chapters);
            return out;
        }
        File out = new File(dir, safe + ".txt");
        writeTxt(out, title, author, chapters);
        return out;
    }

    private static void writeTxt(File out, String title, String author, List<Chapter> chapters) throws IOException {
        StringBuilder sb = new StringBuilder();
        sb.append(title).append("\n");
        if (author != null && !author.isEmpty()) sb.append("作者：").append(author).append("\n");
        sb.append("\n");
        for (Chapter c : chapters) {
            sb.append("\n\n").append(c.title).append("\n\n");
            for (String p : c.paragraphs) sb.append(p).append("\n\n");
        }
        FileOutputStream fos = new FileOutputStream(out);
        fos.write(sb.toString().getBytes(StandardCharsets.UTF_8));
        fos.close();
    }

    private static void writeEpub(File out, String title, String author, List<Chapter> chapters) throws IOException {
        ZipOutputStream z = new ZipOutputStream(new BufferedOutputStream(new FileOutputStream(out)));
        try {
            ZipEntry mime = new ZipEntry("mimetype");
            mime.setMethod(ZipEntry.STORED);
            byte[] mimeBytes = "application/epub+zip".getBytes(StandardCharsets.UTF_8);
            mime.setSize(mimeBytes.length);
            mime.setCompressedSize(mimeBytes.length);
            java.util.zip.CRC32 crc = new java.util.zip.CRC32();
            crc.update(mimeBytes);
            mime.setCrc(crc.getValue());
            z.putNextEntry(mime); z.write(mimeBytes); z.closeEntry();

            put(z, "META-INF/container.xml", "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n"
                    + "<container version=\"1.0\" xmlns=\"urn:oasis:names:tc:opendocument:xmlns:container\">"
                    + "<rootfiles><rootfile full-path=\"OEBPS/content.opf\" media-type=\"application/oebps-package+xml\"/></rootfiles></container>");

            put(z, "OEBPS/style.css", "body{font-family:serif;line-height:1.8;margin:1.2em}h1{font-size:1.35em;line-height:1.5}p{text-indent:2em;margin:0 0 .7em;text-align:justify}");

            StringBuilder manifest = new StringBuilder();
            StringBuilder spine = new StringBuilder();
            for (int i = 0; i < chapters.size(); i++) {
                String name = "ch" + (i + 1) + ".xhtml";
                StringBuilder x = new StringBuilder("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<!DOCTYPE html>\n<html xmlns=\"http://www.w3.org/1999/xhtml\"><head><meta charset=\"UTF-8\"/><title>")
                        .append(xml(chapters.get(i).title)).append("</title><link rel=\"stylesheet\" href=\"style.css\"/></head><body><h1>")
                        .append(xml(chapters.get(i).title)).append("</h1>");
                for (String p : chapters.get(i).paragraphs) x.append("<p>").append(xml(p)).append("</p>");
                x.append("</body></html>");
                put(z, "OEBPS/" + name, x.toString());
                manifest.append("<item id=\"c").append(i + 1).append("\" href=\"").append(name).append("\" media-type=\"application/xhtml+xml\"/>");
                spine.append("<itemref idref=\"c").append(i + 1).append("\"/>");
            }
            StringBuilder opf = new StringBuilder("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n")
                    .append("<package xmlns=\"http://www.idpf.org/2007/opf\" version=\"3.0\" unique-identifier=\"bookid\">")
                    .append("<metadata xmlns:dc=\"http://purl.org/dc/elements/1.1/\"><dc:identifier id=\"bookid\">novelia-").append(System.currentTimeMillis())
                    .append("</dc:identifier><dc:title>").append(xml(title)).append("</dc:title>");
            if (author != null && !author.isEmpty()) opf.append("<dc:creator>").append(xml(author)).append("</dc:creator>");
            opf.append("<dc:language>zh-CN</dc:language><meta property=\"dcterms:modified\">2026-01-01T00:00:00Z</meta></metadata>")
                    .append("<manifest><item id=\"css\" href=\"style.css\" media-type=\"text/css\"/><item id=\"nav\" href=\"nav.xhtml\" media-type=\"application/xhtml+xml\" properties=\"nav\"/>")
                    .append(manifest).append("</manifest><spine>").append(spine).append("</spine></package>");
            put(z, "OEBPS/content.opf", opf.toString());

            StringBuilder nav = new StringBuilder("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<!DOCTYPE html>\n<html xmlns=\"http://www.w3.org/1999/xhtml\" xmlns:epub=\"http://www.idpf.org/2007/ops\"><head><title>")
                    .append(xml(title)).append("</title></head><body><nav epub:type=\"toc\"><h1>")
                    .append(xml(title)).append("</h1><ol>");
            for (int i = 0; i < chapters.size(); i++) nav.append("<li><a href=\"ch").append(i + 1).append(".xhtml\">").append(xml(chapters.get(i).title)).append("</a></li>");
            nav.append("</ol></nav></body></html>");
            put(z, "OEBPS/nav.xhtml", nav.toString());
        } finally {
            z.close();
        }
    }

    private static void put(ZipOutputStream z, String name, String text) throws IOException {
        z.putNextEntry(new ZipEntry(name));
        z.write(text.getBytes(StandardCharsets.UTF_8));
        z.closeEntry();
    }

    private static List<String> paragraphs(JSONObject c) {
        for (String field : new String[]{"zhParagraphs", "paragraphs"}) {
            JSONArray a = c.optJSONArray(field);
            if (a == null) continue;
            List<String> out = new ArrayList<>();
            for (int i = 0; i < a.length(); i++) {
                String s = a.optString(i, "").trim();
                if (!s.isEmpty() && !s.matches("^!\\[[^\\]]*\\]\\(.*")) out.add(s);
            }
            if (!out.isEmpty()) return out;
        }
        return new ArrayList<>();
    }

    private static String first(String... values) {
        for (String v : values) if (v != null && !v.trim().isEmpty()) return v.trim();
        return "";
    }

    private static String xml(String s) {
        return String.valueOf(s == null ? "" : s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;").replace("'", "&apos;");
    }

    private static final class Chapter {
        final String title; final List<String> paragraphs;
        Chapter(String t, List<String> p) { title = t; paragraphs = p; }
    }
}
