# Novelia 阅读

非官方 Android 轻小说阅读器：多书源、文库 EPUB、分卷缓存、双语阅读、标签搜索、离线书架。

> 本项目只提供阅读与缓存工具，不存储、不传播作品内容。内容版权归原作者与发布站点所有。请支持正版，并遵守当地法律法规与站点条款。

## 功能

- 六大书源：成为小说家吧 / KAKUYOMU / Novelup / Hameln / Pixiv / Alphapolis
- 文库 EPUB：分卷下载、插图、原生分页阅读
- 阅读器：左右翻页、音量键、字体/行距、中日双语、朗读、书签
- 搜索：书名/作者/标签、排序、类型、译本、页码跳转
- 离线：整本/范围下载、断点续传、书架进度
- 本地备份/恢复、隐私锁、匿名安装计数

## 构建

需要：JDK 17、Android SDK Platform 35、Build Tools 35、`aapt`、`d8`、`zipalign`、`apksigner`。

```bash
export ANDROID_SDK="$HOME/Android/Sdk"
export KEYSTORE="$HOME/.android/novelia-release.jks"
export KS_PASS="your-store-password"
export KEY_ALIAS="novelia"
export KEY_PASS="your-key-password"

APK_NAME=NoveliaReader.apk ./build.sh
```

不设置 `KEYSTORE` 时会输出未签名 APK。签名密钥、`build/`、`local.properties` 不会进入仓库。

## 目录

- `java/cc/novelia/reader/`：Android 端（WebView、桥接、API、下载、缓存、TTS、隐私锁）
- `assets/www/`：本地 SPA（首页、搜索、书架、下载、设置、阅读器）
- `res/`：图标与主题资源

## 免责声明

本项目与“轻小说机翻机器人”官方无关。应用不提供 VPN、不代理登录、不内置作品内容；网络访问、账号权限与内容合规由使用者自行负责。
