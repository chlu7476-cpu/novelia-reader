package cc.novelia.reader;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Base64;

import org.json.JSONObject;

import java.security.MessageDigest;
import java.security.SecureRandom;

/** Small local privacy gate. This is UI privacy, not disk encryption. */
final class Privacy {
    private static final String PREFS = "privacy";

    private Privacy() {}

    private static SharedPreferences sp(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static boolean hasPin(Context ctx) {
        String hash = sp(ctx).getString("pin_hash", "");
        return hash != null && !hash.isEmpty();
    }

    static boolean setPin(Context ctx, String pin) {
        if (pin == null || !pin.matches("[0-9]{4,8}")) return false;
        try {
            byte[] salt = new byte[16];
            new SecureRandom().nextBytes(salt);
            String saltText = Base64.encodeToString(salt, Base64.NO_WRAP);
            String hash = hash(saltText, pin);
            sp(ctx).edit().putString("pin_salt", saltText).putString("pin_hash", hash).apply();
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    static boolean verify(Context ctx, String pin) {
        if (pin == null) return false;
        String salt = sp(ctx).getString("pin_salt", "");
        String expected = sp(ctx).getString("pin_hash", "");
        if (salt.isEmpty() || expected.isEmpty()) return false;
        try {
            return MessageDigest.isEqual(hash(salt, pin).getBytes("UTF-8"), expected.getBytes("UTF-8"));
        } catch (Exception e) {
            return false;
        }
    }

    static void clear(Context ctx) {
        sp(ctx).edit().remove("pin_salt").remove("pin_hash").apply();
    }

    static boolean hideRecents(Context ctx) {
        return sp(ctx).getBoolean("hide_recents", true);
    }

    static void setHideRecents(Context ctx, boolean value) {
        sp(ctx).edit().putBoolean("hide_recents", value).apply();
    }

    static JSONObject info(Context ctx) {
        JSONObject o = new JSONObject();
        try {
            o.put("hasPin", hasPin(ctx));
            o.put("hideRecents", hideRecents(ctx));
        } catch (Exception ignored) {}
        return o;
    }

    private static String hash(String salt, String pin) throws Exception {
        MessageDigest md = MessageDigest.getInstance("SHA-256");
        byte[] out = md.digest((salt + ":" + pin + ":novelia-reader").getBytes("UTF-8"));
        return Base64.encodeToString(out, Base64.NO_WRAP);
    }
}
