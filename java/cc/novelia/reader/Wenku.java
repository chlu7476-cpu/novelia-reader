package cc.novelia.reader;

import android.content.Context;

import org.json.JSONArray;
import org.json.JSONObject;
import org.w3c.dom.Document;
import org.w3c.dom.Node;
import org.w3c.dom.NodeList;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Base64;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import java.util.regex.Matcher;

import javax.xml.parsers.DocumentBuilderFactory;

/** Downloads a Wenku volume's EPUB and turns its spine into plain-text chapters that the
 *  existing local reader can open (title + paragraphs per chapter). */
final class Wenku {
    private Wenku() {}

    static JSONObject prepare(Context ctx, String novelId, String volumeId, String translator) throws Exception {
        if (novelId == null || novelId.isEmpty() || volumeId == null || volumeId.isEmpty()) {
            throw new Exception("缺少文库书籍信息");
        }
        String tr = translator == null || translator.isEmpty() ? "sakura" : translator;
        String key = Store.key("wenku", hash(novelId + "|" + volumeId + "|" + tr));
        JSONObject old = Store.readMeta(ctx, key);
        if (old != null && old.optInt("parserVersion", 0) >= 5
                && old.optJSONArray("toc") != null && old.optJSONArray("toc").length() > 0) {
            return new JSONObject(Store.metaJson(ctx, key));
        }

        byte[] data = null;
        Exception last = null;
        String[] modes = new String[]{"zh", "zh-jp"};
        for (String mode : modes) {
            try {
                String url = "wenku/" + ApiClient.enc(novelId) + "/file/" + ApiClient.enc(volumeId)
                        + "?mode=" + mode + "&translationsMode=priority&filename=wenku.epub&translations=" + ApiClient.enc(tr);
                data = ApiClient.getBytes(ctx, url);
                if (data != null && data.length > 0) break;
            } catch (Exception e) {
                last = e;
            }
        }
        if (data == null || data.length == 0) {
            throw new Exception(last == null ? "文库文件下载失败" : last.getMessage());
        }

        Parsed parsed;
        if (volumeId.toLowerCase().endsWith(".txt")) {
            parsed = parseTxt(new String(data, StandardCharsets.UTF_8), volumeId);
        } else {
            if (data.length < 4 || data[0] != 'P' || data[1] != 'K') {
                throw new Exception("文库文件不是有效的 EPUB");
            }
            parsed = parseEpub(data);
        }
        if (parsed.chapters.isEmpty()) throw new Exception("文库中没有找到可读章节");
        if (parsed.title == null || parsed.title.trim().isEmpty()) {
            parsed.title = volumeId.replaceFirst("(?i)\\.epub$", "");
        }

        JSONObject meta = new JSONObject();
        meta.put("providerId", "wenku");
        meta.put("novelId", novelId);
        meta.put("source", "wenku");
        meta.put("parserVersion", 5);
        meta.put("volumeId", volumeId);
        meta.put("translator", tr);
        meta.put("titleJp", parsed.title);
        meta.put("titleZh", parsed.title);
        meta.put("author", parsed.author == null ? "" : parsed.author);
        meta.put("total", parsed.chapters.size());
        meta.put("downloadable", parsed.chapters.size());
        meta.put("createdAt", System.currentTimeMillis());
        JSONArray toc = new JSONArray();
        for (int i = 0; i < parsed.chapters.size(); i++) {
            JSONObject item = new JSONObject();
            String title = parsed.chapters.get(i).title;
            item.put("titleJp", title);
            item.put("titleZh", title);
            item.put("chapterId", String.valueOf(i));
            toc.put(item);
        }
        meta.put("toc", toc);
        meta.put("_key", key);

        for (int i = 0; i < parsed.chapters.size(); i++) {
            Chapter c = parsed.chapters.get(i);
            JSONObject ch = new JSONObject();
            ch.put("titleJp", c.title);
            ch.put("titleZh", c.title);
            ch.put("novelTitleJp", parsed.title);
            ch.put("novelTitleZh", parsed.title);
            JSONArray paras = new JSONArray();
            for (String p : c.paragraphs) paras.put(p);
            ch.put("paragraphs", paras);
            ch.put("sakuraParagraphs", paras);
            ch.put("gptParagraphs", paras);
            ch.put("youdaoParagraphs", paras);
            ch.put("baiduParagraphs", paras);
            Store.saveChapter(ctx, key, i, ch.toString());
        }
        Store.saveMeta(ctx, key, meta);
        return new JSONObject(Store.metaJson(ctx, key));
    }

    static JSONObject importLocal(Context ctx, String filename, byte[] data) throws Exception {
        if (data == null || data.length == 0) throw new Exception("文件为空");
        String name = filename == null || filename.trim().isEmpty() ? "本地书籍" : filename.trim();
        String lower = name.toLowerCase(java.util.Locale.US);
        String title = name.replaceFirst("(?i)\\.(epub|txt|srt)$", "");
        Parsed parsed;
        if (lower.endsWith(".epub")) {
            parsed = parseEpub(data);
        } else if (lower.endsWith(".srt")) {
            parsed = parseSrt(decodeText(data));
        } else {
            parsed = parseTxtBook(decodeText(data), title);
        }
        if (parsed == null || parsed.chapters.isEmpty()) throw new Exception("没有找到可读内容");
        if (parsed.title == null || parsed.title.trim().isEmpty()) parsed.title = title;
        String key = Store.key("local", hash(name + "|" + data.length + "|" + System.currentTimeMillis()));
        JSONObject meta = new JSONObject();
        meta.put("providerId", "local");
        meta.put("novelId", key);
        meta.put("source", "local");
        meta.put("local", true);
        meta.put("parserVersion", 5);
        meta.put("titleJp", parsed.title);
        meta.put("titleZh", parsed.title);
        meta.put("author", parsed.author == null ? "" : parsed.author);
        meta.put("total", parsed.chapters.size());
        meta.put("downloadable", parsed.chapters.size());
        meta.put("createdAt", System.currentTimeMillis());
        JSONArray toc = new JSONArray();
        for (int i = 0; i < parsed.chapters.size(); i++) {
            JSONObject item = new JSONObject();
            String ct = parsed.chapters.get(i).title;
            item.put("titleJp", ct);
            item.put("titleZh", ct);
            item.put("chapterId", String.valueOf(i));
            toc.put(item);
        }
        meta.put("toc", toc);
        meta.put("_key", key);
        for (int i = 0; i < parsed.chapters.size(); i++) {
            Chapter c = parsed.chapters.get(i);
            JSONObject ch = new JSONObject();
            ch.put("titleJp", c.title);
            ch.put("titleZh", c.title);
            ch.put("novelTitleJp", parsed.title);
            ch.put("novelTitleZh", parsed.title);
            JSONArray paras = new JSONArray();
            for (String para : c.paragraphs) paras.put(para);
            ch.put("paragraphs", paras);
            ch.put("sakuraParagraphs", paras);
            ch.put("gptParagraphs", paras);
            ch.put("youdaoParagraphs", paras);
            ch.put("baiduParagraphs", paras);
            Store.saveChapter(ctx, key, i, ch.toString());
        }
        Store.saveMeta(ctx, key, meta);
        return new JSONObject(Store.metaJson(ctx, key));
    }

    private static String decodeText(byte[] data) {
        String utf8 = new String(data, StandardCharsets.UTF_8);
        if (utf8.indexOf('\uFFFD') < 0) return utf8.replace("\uFEFF", "");
        try { return new String(data, "GB18030").replace("\uFEFF", ""); }
        catch (Exception e) { return utf8; }
    }

    private static Parsed parseTxtBook(String text, String fallbackTitle) {
        Parsed p = new Parsed();
        p.title = fallbackTitle == null ? "" : fallbackTitle;
        String[] lines = text.split("\\r?\\n");
        java.util.regex.Pattern heading = java.util.regex.Pattern.compile(
                "^\\s*(第[零一二三四五六七八九十百千万0-9]+[章卷回节话]|Chapter\\s+\\d+|CHAPTER\\s+\\d+)\\s*.*$",
                java.util.regex.Pattern.CASE_INSENSITIVE);
        Chapter current = null;
        for (String line : lines) {
            String t = line.trim();
            if (t.isEmpty()) continue;
            if (heading.matcher(t).matches() && t.length() <= 90) {
                if (current != null && !current.paragraphs.isEmpty()) p.chapters.add(current);
                current = new Chapter();
                current.title = t;
                current.paragraphs = new ArrayList<>();
            } else {
                if (current == null) {
                    current = new Chapter();
                    current.title = p.title;
                    current.paragraphs = new ArrayList<>();
                }
                current.paragraphs.add(t);
            }
        }
        if (current != null && !current.paragraphs.isEmpty()) p.chapters.add(current);
        return p;
    }

    private static Parsed parseSrt(String text) {
        Parsed p = new Parsed();
        Chapter c = new Chapter();
        c.title = "字幕文本";
        c.paragraphs = new ArrayList<>();
        java.util.regex.Pattern time = java.util.regex.Pattern.compile("\\d{1,2}:\\d{2}:\\d{2}[,.]\\d{3}\\s*-->");
        StringBuilder block = new StringBuilder();
        for (String line : text.split("\\r?\\n")) {
            String t = line.trim();
            if (t.isEmpty()) {
                if (block.length() > 0) {
                    c.paragraphs.add(block.toString().trim());
                    block.setLength(0);
                }
                continue;
            }
            if (t.matches("^\\d+$") || time.matcher(t).find()) continue;
            if (block.length() > 0) block.append(' ');
            block.append(t);
        }
        if (block.length() > 0) c.paragraphs.add(block.toString().trim());
        if (!c.paragraphs.isEmpty()) p.chapters.add(c);
        return p;
    }

    private static String hash(String input) throws Exception {
        MessageDigest md = MessageDigest.getInstance("SHA-256");
        byte[] out = md.digest(input.getBytes(StandardCharsets.UTF_8));
        StringBuilder sb = new StringBuilder();
        for (byte b : out) sb.append(String.format("%02x", b));
        return sb.substring(0, 24);
    }

    private static final class Chapter {
        String title;
        List<String> paragraphs;
    }

    private static final class Parsed {
        String title = "";
        String author = "";
        List<Chapter> chapters = new ArrayList<>();
    }

    private static final class Item {
        String href;
        String mediaType;
        String properties;
    }

    private static Parsed parseEpub(byte[] data) throws Exception {
        Map<String, byte[]> entries = new HashMap<>();
        Map<String, String> imageCache = new HashMap<>();
        ZipInputStream zis = new ZipInputStream(new ByteArrayInputStream(data));
        ZipEntry entry;
        int total = 0;
        while ((entry = zis.getNextEntry()) != null) {
            if (entry.isDirectory()) continue;
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = zis.read(buf)) != -1) {
                total += n;
                if (total > 64 * 1024 * 1024) throw new Exception("EPUB 过大");
                out.write(buf, 0, n);
            }
            entries.put(entry.getName(), out.toByteArray());
        }
        zis.close();

        byte[] containerBytes = entries.get("META-INF/container.xml");
        if (containerBytes == null) throw new Exception("EPUB 缺少 container.xml");
        Document container = parseXml(containerBytes);
        NodeList roots = container.getElementsByTagNameNS("*", "rootfile");
        if (roots.getLength() == 0) throw new Exception("EPUB 缺少 OPF");
        String opfPath = attr(roots.item(0), "full-path");
        if (opfPath == null || opfPath.isEmpty()) throw new Exception("EPUB OPF 路径为空");
        byte[] opfBytes = entries.get(opfPath);
        if (opfBytes == null) throw new Exception("EPUB 缺少 OPF 文件");
        Document opf = parseXml(opfBytes);

        Parsed parsed = new Parsed();
        NodeList titles = opf.getElementsByTagNameNS("*", "title");
        if (titles.getLength() > 0) parsed.title = text(titles.item(0)).trim();
        NodeList creators = opf.getElementsByTagNameNS("*", "creator");
        StringBuilder authors = new StringBuilder();
        for (int i = 0; i < creators.getLength(); i++) {
            String name = text(creators.item(i)).trim();
            if (!name.isEmpty()) {
                if (authors.length() > 0) authors.append(" / ");
                authors.append(name);
            }
        }
        parsed.author = authors.toString();

        Map<String, Item> manifest = new HashMap<>();
        NodeList items = opf.getElementsByTagNameNS("*", "item");
        for (int i = 0; i < items.getLength(); i++) {
            Node n = items.item(i);
            Item it = new Item();
            it.href = attr(n, "href");
            it.mediaType = attr(n, "media-type");
            it.properties = attr(n, "properties");
            String id = attr(n, "id");
            if (id != null && it.href != null) manifest.put(id, it);
        }

        String baseDir = dirOf(opfPath);
        Map<String, String> navTitles = new HashMap<>();
        for (Item it : manifest.values()) {
            if (it.properties == null || !it.properties.contains("nav") || it.href == null) continue;
            byte[] navBytes = entries.get(normalize(baseDir, it.href));
            if (navBytes == null) continue;
            String nav = new String(navBytes, StandardCharsets.UTF_8);
            java.util.regex.Matcher nm = java.util.regex.Pattern
                    .compile("(?is)<a[^>]+href=[\"']([^\"']+)[\"'][^>]*>(.*?)</a>").matcher(nav);
            while (nm.find()) {
                String target = normalize(baseDir, nm.group(1));
                String label = stripTags(nm.group(2));
                if (!target.isEmpty() && !label.isEmpty()) navTitles.put(target, label);
            }
        }
        // EPUB 2 NCX navigation is still common; it has cleaner chapter labels than <title>.
        for (Map.Entry<String, Item> e : manifest.entrySet()) {
            Item it = e.getValue();
            String mt = it.mediaType == null ? "" : it.mediaType.toLowerCase();
            if (!mt.contains("dtbncx") && !(it.href != null && it.href.toLowerCase().endsWith(".ncx"))) continue;
            byte[] ncxBytes = entries.get(normalize(baseDir, it.href));
            if (ncxBytes == null) continue;
            try {
                Document ncx = parseXml(ncxBytes);
                NodeList points = ncx.getElementsByTagNameNS("*", "navPoint");
                for (int i = 0; i < points.getLength(); i++) {
                    Node point = points.item(i);
                    NodeList contents = ((org.w3c.dom.Element) point).getElementsByTagNameNS("*", "content");
                    NodeList labels = ((org.w3c.dom.Element) point).getElementsByTagNameNS("*", "text");
                    if (contents.getLength() == 0 || labels.getLength() == 0) continue;
                    String src = attr(contents.item(0), "src");
                    String label = cleanText(text(labels.item(0)));
                    String target = normalize(dirOf(normalize(baseDir, it.href)), src);
                    if (!target.isEmpty() && !label.isEmpty() && !navTitles.containsKey(target)) navTitles.put(target, label);
                }
            } catch (Exception ignored) {}
        }

        NodeList refs = opf.getElementsByTagNameNS("*", "itemref");
        int chapterIndex = 0;
        for (int i = 0; i < refs.getLength(); i++) {
            Node ref = refs.item(i);
            String linear = attr(ref, "linear");
            if ("no".equalsIgnoreCase(linear)) continue;
            Item item = manifest.get(attr(ref, "idref"));
            if (item == null || item.href == null) continue;
            String mt = item.mediaType == null ? "" : item.mediaType.toLowerCase();
            if (!(mt.contains("xhtml") || mt.contains("html"))) continue;
            String path = normalize(baseDir, item.href);
            String lower = path.toLowerCase();
            if (lower.contains("cover") || lower.contains("colophon") || lower.contains("titlepage")
                    || lower.contains("caution") || lower.contains("navigation")
                    || lower.contains("/nav") || lower.contains("toc")) continue;
            byte[] bytes = entries.get(path);
            if (bytes == null) continue;
            String html = new String(bytes, StandardCharsets.UTF_8);
            boolean hasNav = navTitles.containsKey(path);
            String title = navTitles.get(path);
            if (title == null || title.isEmpty()) title = extractTitle(html);
            List<String> imagePaths = new ArrayList<>();
            String withImages = replaceImages(html, path, entries, imagePaths);
            List<String> paras = extractParagraphs(withImages, title, entries, imagePaths, imageCache);
            if (paras.isEmpty()) continue;
            String joined = String.join(" ", paras);
            if (isFrontMatter(paras, joined, parsed.title)) continue;

            // Many EPUBs split one chapter over several xhtml files. Only the first file
            // appears in the NCX/nav; subsequent files are continuations, not new chapters.
            if (!navTitles.isEmpty() && !hasNav && !parsed.chapters.isEmpty()) {
                parsed.chapters.get(parsed.chapters.size() - 1).paragraphs.addAll(paras);
                continue;
            }
            if (title == null || title.trim().isEmpty() || title.matches("(?i)^[a-z0-9_-]{1,12}$")) {
                title = "第 " + (chapterIndex + 1) + " 章";
            }
            Chapter c = new Chapter();
            c.title = cleanText(title);
            c.paragraphs = paras;
            parsed.chapters.add(c);
            chapterIndex++;
        }
        mergeImageOnly(parsed);
        return parsed;
    }

    private static Parsed parseTxt(String text, String volumeId) {
        Parsed p = new Parsed();
        p.title = volumeId.replaceFirst("(?i)\\.txt$", "");
        Chapter c = new Chapter();
        c.title = p.title;
        c.paragraphs = new ArrayList<>();
        for (String line : text.split("\\r?\\n")) {
            String t = line.trim();
            if (!t.isEmpty()) c.paragraphs.add(t);
        }
        if (!c.paragraphs.isEmpty()) p.chapters.add(c);
        return p;
    }

    private static void mergeImageOnly(Parsed parsed) {
        List<Chapter> merged = new ArrayList<>();
        List<String> pending = new ArrayList<>();
        for (Chapter c : parsed.chapters) {
            boolean onlyImages = !c.paragraphs.isEmpty();
            for (String para : c.paragraphs) {
                if (!para.startsWith("![插图](")) { onlyImages = false; break; }
            }
            if (onlyImages) {
                pending.addAll(c.paragraphs);
                continue;
            }
            if (!pending.isEmpty()) {
                c.paragraphs.addAll(0, pending);
                pending.clear();
            }
            merged.add(c);
        }
        if (!pending.isEmpty() && !merged.isEmpty()) {
            merged.get(merged.size() - 1).paragraphs.addAll(pending);
        }
        parsed.chapters = merged;
    }

    private static boolean isFrontMatter(List<String> paras, String joined, String bookTitle) {
        if (paras.isEmpty()) return true;
        // Never treat a long chapter as front matter just because it mentions a word
        // like "封面" or "作者". Those are common in story text (publishing plots, etc.).
        if (paras.size() > 12) return false;
        String first = paras.get(0);
        if ("作者".equals(first) || first.startsWith("作者简介")) return true;
        if (joined.contains("CONTENTS") || joined.contains("著作权") || joined.contains("版权")) return true;
        if (joined.contains("封面") || joined.contains("刊头插画")) return true;
        if (joined.contains("GA文库") || joined.contains("GA文庫")) return true;
        if (joined.contains("粉丝信")) return true;
        if (paras.size() <= 3 && bookTitle != null && !bookTitle.isEmpty()
                && joined.contains(bookTitle.substring(0, Math.min(8, bookTitle.length())))) return true;
        if (paras.size() <= 3 && joined.length() < 120
                && !first.startsWith("　") && !first.startsWith("「")
                && !first.startsWith("『")) return true;
        return false;
    }

    private static Document parseXml(byte[] bytes) throws Exception {
        DocumentBuilderFactory f = DocumentBuilderFactory.newInstance();
        f.setNamespaceAware(true);
        f.setExpandEntityReferences(false);
        try { f.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true); } catch (Exception ignored) {}
        try { f.setFeature("http://xml.org/sax/features/external-general-entities", false); } catch (Exception ignored) {}
        try { f.setFeature("http://xml.org/sax/features/external-parameter-entities", false); } catch (Exception ignored) {}
        return f.newDocumentBuilder().parse(new ByteArrayInputStream(bytes));
    }

    private static String attr(Node node, String name) {
        if (node == null || node.getAttributes() == null) return "";
        Node a = node.getAttributes().getNamedItem(name);
        return a == null ? "" : a.getNodeValue();
    }

    private static String text(Node node) {
        return node == null ? "" : node.getTextContent();
    }

    private static String dirOf(String path) {
        int i = path.lastIndexOf('/');
        return i < 0 ? "" : path.substring(0, i + 1);
    }

    private static String normalize(String base, String href) {
        String clean = href;
        int h = clean.indexOf('#');
        if (h >= 0) clean = clean.substring(0, h);
        try { clean = java.net.URLDecoder.decode(clean, "UTF-8"); } catch (Exception ignored) {}
        String full = clean.startsWith("/") ? clean.substring(1) : base + clean;
        ArrayDeque<String> parts = new ArrayDeque<>();
        for (String p : full.split("/")) {
            if (p.isEmpty() || ".".equals(p)) continue;
            if ("..".equals(p)) { if (!parts.isEmpty()) parts.removeLast(); }
            else parts.addLast(p);
        }
        StringBuilder sb = new StringBuilder();
        for (String p : parts) {
            if (sb.length() > 0) sb.append('/');
            sb.append(p);
        }
        return sb.toString();
    }

    private static String extractTitle(String html) {
        java.util.regex.Matcher m = java.util.regex.Pattern
                .compile("(?is)<h[1-3][^>]*>(.*?)</h[1-3]>").matcher(html);
        if (m.find()) {
            String t = stripTags(m.group(1));
            if (!t.isEmpty()) return t;
        }
        m = java.util.regex.Pattern.compile("(?is)<title[^>]*>(.*?)</title>").matcher(html);
        if (m.find()) return stripTags(m.group(1));
        return "";
    }

    private static String replaceImages(String html, String xhtmlPath, Map<String, byte[]> entries, List<String> imagePaths) {
        java.util.regex.Pattern p = java.util.regex.Pattern.compile(
                "(?is)<(?:img|image)\\b[^>]*?\\b(?:src|xlink:href|href)\\s*=\\s*([\"'])(.*?)\\1[^>]*>");
        java.util.regex.Matcher m = p.matcher(html);
        StringBuffer sb = new StringBuffer();
        while (m.find()) {
            String src = m.group(2);
            String resolved = normalize(dirOf(xhtmlPath), src);
            byte[] image = entries.get(resolved);
            if (image != null && image.length <= 8 * 1024 * 1024 && imageMime(resolved) != null) {
                imagePaths.add(resolved);
                m.appendReplacement(sb, java.util.regex.Matcher.quoteReplacement(
                        "\n[[NIMG:" + (imagePaths.size() - 1) + "]]\n"));
            } else {
                m.appendReplacement(sb, " ");
            }
        }
        m.appendTail(sb);
        return sb.toString();
    }

    private static String imageMime(String path) {
        String p = path.toLowerCase();
        if (p.endsWith(".jpg") || p.endsWith(".jpeg")) return "image/jpeg";
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".gif")) return "image/gif";
        if (p.endsWith(".webp")) return "image/webp";
        return null;
    }

    private static String imageData(String path, Map<String, byte[]> entries, Map<String, String> cache) {
        String cached = cache.get(path);
        if (cached != null) return cached;
        byte[] bytes = entries.get(path);
        String mime = imageMime(path);
        if (bytes == null || mime == null || bytes.length > 8 * 1024 * 1024) return null;
        String uri = "data:" + mime + ";base64," + Base64.getEncoder().encodeToString(bytes);
        cache.put(path, uri);
        return uri;
    }

    private static List<String> extractParagraphs(String html, String title, Map<String, byte[]> entries,
                                                  List<String> imagePaths, Map<String, String> imageCache) {
        String s = html;
        s = s.replaceAll("(?is)<head[^>]*>.*?</head>", " ");
        s = s.replaceAll("(?is)<script[^>]*>.*?</script>", " ");
        s = s.replaceAll("(?is)<style[^>]*>.*?</style>", " ");
        s = s.replaceAll("(?is)<nav[^>]*>.*?</nav>", " ");
        s = s.replaceAll("(?is)<svg[^>]*>.*?</svg>", " ");
        s = s.replaceAll("(?i)<br\\s*/?>", "\n");
        s = s.replaceAll("(?i)</(p|div|h[1-6]|li|section|article|blockquote|tr|td)>", "\n");
        s = s.replaceAll("(?is)<[^>]+>", " ");
        String plain = decodeEntities(s);
        List<String> out = new ArrayList<>();
        String cleanTitle = cleanText(title);
        for (String line : plain.split("\\r?\\n")) {
            String t = cleanText(line);
            if (t.isEmpty()) continue;
            if (t.startsWith("[[NIMG:") && t.endsWith("]]")) {
                try {
                    int idx = Integer.parseInt(t.substring(7, t.length() - 2));
                    if (idx >= 0 && idx < imagePaths.size()) {
                        String data = imageData(imagePaths.get(idx), entries, imageCache);
                        if (data != null) out.add("![插图](" + data + ")");
                    }
                } catch (Exception ignored) {}
                continue;
            }
            if (cleanTitle != null && !cleanTitle.isEmpty() && t.equals(cleanTitle) && out.isEmpty()) continue;
            out.add(t);
        }
        return out;
    }

    private static String stripTags(String s) {
        if (s == null) return "";
        return cleanText(decodeEntities(s.replaceAll("(?is)<[^>]+>", " ")));
    }

    private static String decodeEntities(String text) {
        if (text == null) return "";
        String s = text
                .replace("&nbsp;", " ").replace("&#160;", " ")
                .replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
                .replace("&quot;", "\"").replace("&#39;", "'").replace("&apos;", "'")
                .replace("&mdash;", "—").replace("&ndash;", "–")
                .replace("&hellip;", "…").replace("&ldquo;", "“").replace("&rdquo;", "”")
                .replace("&lsquo;", "‘").replace("&rsquo;", "’");
        java.util.regex.Matcher m = java.util.regex.Pattern.compile("&#(x?[0-9a-fA-F]+);").matcher(s);
        StringBuffer sb = new StringBuffer();
        while (m.find()) {
            try {
                String num = m.group(1);
                int cp = num.startsWith("x") || num.startsWith("X")
                        ? Integer.parseInt(num.substring(1), 16) : Integer.parseInt(num);
                m.appendReplacement(sb, Matcher.quoteReplacement(new String(Character.toChars(cp))));
            } catch (Exception e) {
                m.appendReplacement(sb, Matcher.quoteReplacement(m.group(0)));
            }
        }
        m.appendTail(sb);
        return sb.toString();
    }

    private static String cleanText(String s) {
        if (s == null) return "";
        return s.replace('\u00a0', ' ')
                .replaceAll("[\\t\\x0B\\f\\r]", " ")
                .replaceAll(" +", " ")
                .replaceAll("^[\\s\\u3000]+|[\\s\\u3000]+$", "");
    }
}
