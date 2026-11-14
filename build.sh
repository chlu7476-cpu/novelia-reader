#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
SDK="${ANDROID_SDK:-${ANDROID_HOME:-$HOME/Android/Sdk}}"
find_jar() {
  for p in \
    "$SDK/platforms/android-35/android.jar" \
    "$SDK/platform-35/android-35/android.jar" \
    "$SDK/platforms/android-34/android.jar"; do
    [ -f "$p" ] && { echo "$p"; return; }
  done
  echo "Android platform jar not found under $SDK" >&2; exit 1
}
PLATFORM="$(find_jar)"
AAPT_PLATFORM="$PLATFORM"
for p in "$SDK/platforms/android-30/android.jar" "$SDK/platform-30/android-11/android.jar"; do
  [ -f "$p" ] && { AAPT_PLATFORM="$p"; break; }
done
BT="${BUILD_TOOLS:-$(ls -d "$SDK"/build-tools/* 2>/dev/null | sort -V | tail -1)}"
AAPT="${AAPT:-$BT/aapt}"; [ -x "$AAPT" ] || AAPT="$(command -v aapt)"
OUT="$ROOT/build"; APK_NAME="${APK_NAME:-NoveliaReader.apk}"
rm -rf "$OUT"; mkdir -p "$OUT/classes" "$OUT/dex"

echo "[1/5] packaging resources + assets"
"$AAPT" package -f -M "$ROOT/AndroidManifest.xml" -S "$ROOT/res" -A "$ROOT/assets" \
  -I "$AAPT_PLATFORM" -F "$OUT/base.apk" --min-sdk-version 26 --target-sdk-version 35

echo "[2/5] compiling java"
find "$ROOT/java" -name '*.java' > "$OUT/sources.txt"
javac -encoding UTF-8 -source 17 -target 17 -Xlint:-options \
  -classpath "$PLATFORM" -d "$OUT/classes" @"$OUT/sources.txt"

echo "[3/5] dexing"
find "$OUT/classes" -name '*.class' > "$OUT/classes.txt"
"$BT/d8" --release --lib "$PLATFORM" --min-api 26 --output "$OUT/dex" @"$OUT/classes.txt"

echo "[4/5] assembling"
cp "$OUT/base.apk" "$OUT/unsigned.apk"
(cd "$OUT" && zip -q -j unsigned.apk dex/classes.dex)
zipalign -f 4 "$OUT/unsigned.apk" "$OUT/aligned.apk"

if [ -n "${KEYSTORE:-}" ] && [ -f "$KEYSTORE" ]; then
  echo "[5/5] signing"
  apksigner sign --ks "$KEYSTORE" --ks-key-alias "${KEY_ALIAS:-novelia}" \
    --ks-pass "pass:${KS_PASS:?KS_PASS is required}" --key-pass "pass:${KEY_PASS:-$KS_PASS}" \
    --out "$OUT/$APK_NAME" "$OUT/aligned.apk"
  apksigner verify "$OUT/$APK_NAME"
else
  echo "[5/5] no KEYSTORE set, leaving unsigned"
  cp "$OUT/aligned.apk" "$OUT/${APK_NAME%.apk}-unsigned.apk"
fi
ls -lh "$OUT"/*.apk
