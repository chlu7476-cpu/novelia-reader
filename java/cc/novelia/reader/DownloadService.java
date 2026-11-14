package cc.novelia.reader;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.os.IBinder;
import android.os.PowerManager;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Foreground downloader. One book at a time keeps the site load predictable and lets the
 *  progress state be resumed safely if the process is killed. */
public class DownloadService extends Service {
    private static final String TAG = "NoveliaDownload";
    private static final String CHANNEL = "novelia_downloads";
    private static final int NOTIF_ID = 4102;

    static final String ACTION_START = "cc.novelia.reader.DL_START";
    static final String ACTION_PAUSE = "cc.novelia.reader.DL_PAUSE";
    static final String ACTION_CANCEL = "cc.novelia.reader.DL_CANCEL";
    static final String EXTRA_PROVIDER = "provider";
    static final String EXTRA_NOVEL = "novel";
    static final String EXTRA_LIMIT = "limit";
    static final String EXTRA_START = "start";
    static final String EXTRA_END = "end";

    private static final Set<String> PAUSED = ConcurrentHashMap.newKeySet();
    private static final Set<String> CANCELLED = ConcurrentHashMap.newKeySet();
    private static final ExecutorService EXEC = Executors.newSingleThreadExecutor();
    private static final Object LOCK = new Object();
    private static int pending = 0;

    private PowerManager.WakeLock wakeLock;

    static void start(Context ctx, String provider, String novelId, int limit) {
        start(ctx, provider, novelId, limit, 1, 0);
    }

    static void start(Context ctx, String provider, String novelId, int limit, int start, int end) {
        String key = Store.key(provider, novelId);
        PAUSED.remove(key);
        CANCELLED.remove(key);
        Intent i = new Intent(ctx, DownloadService.class);
        i.setAction(ACTION_START);
        i.putExtra(EXTRA_PROVIDER, provider);
        i.putExtra(EXTRA_NOVEL, novelId);
        i.putExtra(EXTRA_LIMIT, limit);
        i.putExtra(EXTRA_START, Math.max(1, start));
        i.putExtra(EXTRA_END, Math.max(0, end));
        if (android.os.Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(i);
        else ctx.startService(i);
    }

    static void pause(Context ctx, String key) {
        PAUSED.add(key);
        try {
            JSONObject st = Store.readState(ctx, key);
            if (st != null) {
                st.put("status", "paused");
                Store.saveState(ctx, key, st);
            }
        } catch (Exception ignored) {}
    }

    static void cancel(Context ctx, String key) {
        CANCELLED.add(key);
        Store.remove(ctx, key);
    }

    @Override
    public void onCreate() {
        super.onCreate();
        createChannel();
        try {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (pm != null) {
                wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "NoveliaReader:download");
                wakeLock.setReferenceCounted(false);
                wakeLock.acquire(60 * 60 * 1000L);
            }
        } catch (Exception ignored) {}
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) return START_NOT_STICKY;
        String action = intent.getAction();
        if (ACTION_PAUSE.equals(action)) {
            pause(this, intent.getStringExtra("key"));
            return START_NOT_STICKY;
        }
        if (ACTION_CANCEL.equals(action)) {
            cancel(this, intent.getStringExtra("key"));
            return START_NOT_STICKY;
        }
        if (!ACTION_START.equals(action)) return START_NOT_STICKY;

        final String provider = intent.getStringExtra(EXTRA_PROVIDER);
        final String novelId = intent.getStringExtra(EXTRA_NOVEL);
        final int limit = intent.getIntExtra(EXTRA_LIMIT, 0);
        final int start = intent.getIntExtra(EXTRA_START, 1);
        final int end = intent.getIntExtra(EXTRA_END, 0);
        if (provider == null || novelId == null) return START_NOT_STICKY;
        final String key = Store.key(provider, novelId);
        PAUSED.remove(key);
        CANCELLED.remove(key);

        synchronized (LOCK) { pending++; }
        startForeground(NOTIF_ID, buildNotification("准备下载", "正在获取目录…", true, 0, 0));

        EXEC.execute(() -> {
            try {
                runJob(provider, novelId, limit, start, end);
            } catch (Throwable t) {
                Log.e(TAG, "download failed", t);
                try {
                    JSONObject st = Store.readState(this, key);
                    if (st == null) st = new JSONObject();
                    st.put("status", "error");
                    st.put("error", friendly(t));
                    Store.saveState(this, key, st);
                } catch (Exception ignored) {}
                notifyFinal("下载失败", friendly(t), false);
            } finally {
                boolean stop;
                synchronized (LOCK) {
                    pending--;
                    stop = pending <= 0;
                }
                if (stop) {
                    stopForeground(STOP_FOREGROUND_REMOVE);
                    stopSelf();
                }
            }
        });
        return START_NOT_STICKY;
    }

    private void runJob(String provider, String novelId, int limit, int start, int end) throws Exception {
        String key = Store.key(provider, novelId);
        JSONObject existingMeta = Store.readMeta(this, key);
        JSONObject existingState = Store.readState(this, key);
        long createdAt = existingMeta != null ? existingMeta.optLong("createdAt", System.currentTimeMillis()) : System.currentTimeMillis();

        JSONObject detail = new JSONObject(ApiClient.get(this,
                "novel/" + ApiClient.enc(provider) + "/" + ApiClient.enc(novelId)));
        JSONArray toc = detail.optJSONArray("toc");
        if (toc == null) toc = new JSONArray();

        JSONObject meta = new JSONObject();
        meta.put("providerId", provider);
        meta.put("novelId", novelId);
        meta.put("titleJp", detail.optString("titleJp"));
        meta.put("titleZh", detail.optString("titleZh"));
        meta.put("type", detail.optString("type"));
        meta.put("introductionJp", detail.optString("introductionJp"));
        meta.put("introductionZh", detail.optString("introductionZh"));
        meta.put("totalCharacters", detail.optInt("totalCharacters"));
        meta.put("points", detail.optInt("points"));
        meta.put("visited", detail.optInt("visited"));
        meta.put("attentions", detail.optJSONArray("attentions") == null ? new JSONArray() : detail.optJSONArray("attentions"));
        meta.put("keywords", detail.optJSONArray("keywords") == null ? new JSONArray() : detail.optJSONArray("keywords"));
        meta.put("authors", detail.optJSONArray("authors") == null ? new JSONArray() : detail.optJSONArray("authors"));
        meta.put("author", joinAuthors(detail.optJSONArray("authors")));
        meta.put("total", toc.length());
        meta.put("createdAt", createdAt);
        meta.put("toc", toc);

        int downloadable = 0;
        for (int i = 0; i < toc.length(); i++) {
            String cid = toc.optJSONObject(i) == null ? "" : toc.optJSONObject(i).optString("chapterId");
            if (!cid.isEmpty()) downloadable++;
        }
        meta.put("downloadable", downloadable);
        Store.saveMeta(this, key, meta);

        int from = Math.max(0, Math.min(toc.length() - 1, start - 1));
        int to = end > 0 ? Math.max(from, Math.min(toc.length() - 1, end - 1)) : toc.length() - 1;
        int rangeDownloadable = 0;
        for (int i = from; i <= to; i++) {
            JSONObject item = toc.optJSONObject(i);
            if (item != null && !item.optString("chapterId").isEmpty()) rangeDownloadable++;
        }
        int target = limit > 0 ? Math.min(limit, rangeDownloadable) : rangeDownloadable;
        int done = 0;
        long bytes = 0;
        // Count files that are already on disk so a resumed task starts where it stopped.
        for (int i = from; i <= to; i++) {
            JSONObject item = toc.optJSONObject(i);
            if (item == null || item.optString("chapterId").isEmpty()) continue;
            if (Store.hasChapter(this, key, i)) {
                done++;
                bytes += Store.chapterSize(this, key, i);
            }
        }

        JSONObject state = new JSONObject();
        state.put("status", "downloading");
        state.put("done", Math.min(done, target));
        state.put("bytes", bytes);
        state.put("limit", limit);
        state.put("downloadable", downloadable);
        state.put("target", target);
        state.put("rangeStart", from + 1);
        state.put("rangeEnd", to + 1);
        state.put("error", "");
        state.put("startedAt", System.currentTimeMillis());
        Store.saveState(this, key, state);

        String title = detail.optString("titleZh");
        if (title.isEmpty()) title = detail.optString("titleJp");
        updateNotification(title, "", true, done, target);

        int processed = 0;
        int consecutiveErrors = 0;
        long lastNotif = 0;
        boolean paused = false;

        for (int i = from; i <= to; i++) {
            if (CANCELLED.contains(key)) return;
            if (PAUSED.contains(key)) { paused = true; break; }
            JSONObject item = toc.optJSONObject(i);
            if (item == null) continue;
            String chapterId = item.optString("chapterId");
            if (chapterId.isEmpty()) continue;
            if (limit > 0 && processed >= limit) break;
            processed++;

            if (Store.hasChapter(this, key, i)) {
                continue;
            }

            String body = null;
            Exception last = null;
            for (int attempt = 0; attempt < 3; attempt++) {
                try {
                    body = ApiClient.get(this, "novel/" + ApiClient.enc(provider) + "/"
                            + ApiClient.enc(novelId) + "/chapter/" + ApiClient.enc(chapterId));
                    last = null;
                    break;
                } catch (Exception e) {
                    last = e;
                    if (CANCELLED.contains(key)) return;
                    try { Thread.sleep(1200L * (attempt + 1)); } catch (InterruptedException ie) {
                        Thread.currentThread().interrupt();
                        return;
                    }
                }
            }
            if (body == null) {
                consecutiveErrors++;
                if (consecutiveErrors >= 5) {
                    state.put("status", "error");
                    state.put("error", "连续下载失败：" + friendly(last));
                    state.put("done", done);
                    state.put("bytes", bytes);
                    Store.saveState(this, key, state);
                    notifyFinal("下载中断", friendly(last), false);
                    return;
                }
                continue;
            }
            try {
                new JSONObject(body);
            } catch (Exception e) {
                consecutiveErrors++;
                continue;
            }
            consecutiveErrors = 0;
            Store.saveChapter(this, key, i, body);
            done++;
            bytes += body.getBytes(java.nio.charset.StandardCharsets.UTF_8).length;
            state.put("done", Math.min(done, target));
            state.put("bytes", bytes);
            Store.saveState(this, key, state);

            long now = System.currentTimeMillis();
            if (now - lastNotif > 900) {
                lastNotif = now;
                updateNotification(title, "已下载 " + done + " / " + target + " 章", true, done, target);
            }
            try { Thread.sleep(ApiClient.relayActive() ? 2200L : 120L); } catch (InterruptedException ie) {
                Thread.currentThread().interrupt();
                return;
            }
        }

        if (CANCELLED.contains(key)) return;
        state.put("status", paused ? "paused" : "done");
        state.put("done", Math.min(done, target));
        state.put("bytes", bytes);
        state.put("error", "");
        if (!paused) state.put("finishedAt", System.currentTimeMillis());
        Store.saveState(this, key, state);
        if (paused) {
            notifyFinal(title, "已暂停 · " + done + " / " + target + " 章", true);
        } else {
            notifyFinal(title, "已下载 " + done + " / " + target + " 章", false);
        }
    }

    private static String joinAuthors(JSONArray authors) {
        if (authors == null) return "";
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < authors.length(); i++) {
            JSONObject a = authors.optJSONObject(i);
            String n = a == null ? "" : a.optString("name");
            if (!n.isEmpty()) {
                if (sb.length() > 0) sb.append(" / ");
                sb.append(n);
            }
        }
        return sb.toString();
    }

    private static String friendly(Throwable t) {
        if (t == null) return "未知错误";
        String m = t.getMessage();
        if (m == null || m.trim().isEmpty()) m = t.getClass().getSimpleName();
        return m;
    }

    private void createChannel() {
        if (android.os.Build.VERSION.SDK_INT >= 26) {
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null) return;
            NotificationChannel ch = new NotificationChannel(CHANNEL, "下载", NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("小说下载进度");
            ch.setShowBadge(false);
            nm.createNotificationChannel(ch);
        }
    }

    private Notification buildNotification(String title, String text, boolean ongoing, int done, int total) {
        Notification.Builder b = android.os.Build.VERSION.SDK_INT >= 26
                ? new Notification.Builder(this, CHANNEL)
                : new Notification.Builder(this);
        b.setSmallIcon(android.R.drawable.stat_sys_download)
                .setContentTitle(title == null || title.isEmpty() ? "Novelia 下载" : title)
                .setContentText(text)
                .setOngoing(ongoing)
                .setOnlyAlertOnce(true)
                .setContentIntent(PendingIntent.getActivity(this, 0,
                        new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
                        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
        if (total > 0) {
            int pct = (int) Math.max(0, Math.min(100, done * 100.0 / total));
            b.setProgress(100, pct, false);
        } else {
            b.setProgress(0, 0, true);
        }
        return b.build();
    }

    private void updateNotification(String title, String text, boolean ongoing, int done, int total) {
        try {
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) nm.notify(NOTIF_ID, buildNotification(title, text, ongoing, done, total));
        } catch (Exception ignored) {}
    }

    private void notifyFinal(String title, String text, boolean ongoing) {
        try {
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null) return;
            Notification.Builder b = android.os.Build.VERSION.SDK_INT >= 26
                    ? new Notification.Builder(this, CHANNEL)
                    : new Notification.Builder(this);
            b.setSmallIcon(android.R.drawable.stat_sys_download_done)
                    .setContentTitle(title)
                    .setContentText(text)
                    .setOngoing(ongoing)
                    .setAutoCancel(!ongoing)
                    .setOnlyAlertOnce(true)
                    .setContentIntent(PendingIntent.getActivity(this, 0,
                            new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
                            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
            nm.notify(NOTIF_ID, b.build());
        } catch (Exception ignored) {}
    }

    @Override
    public void onDestroy() {
        try {
            if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        } catch (Exception ignored) {}
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }
}
