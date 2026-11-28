# 昆医349手机版

手机版复用现有 HTML、CSS、JavaScript 和四科题库。它以静态网页或渐进式 Web 应用（PWA）运行，学习记录保存在手机当前网页应用内。通过设置中的「备份个人数据」和「导入备份」可在设备间迁移记录。

## 构建与预览

在项目根目录使用 Python 3.10 或更新版本运行。构建目录需为新目录。

```powershell
python -X utf8 tools/build_mobile.py .review/mobile
python -m http.server 8953 --bind 127.0.0.1 --directory .review/mobile
```

电脑预览使用 [本机 8953 端口](http://127.0.0.1:8953/)。如需部署到子路径，整体上传生成目录的内容，入口为 `index.html`。站点使用 HTTPS 后，可在 Android Chrome 的菜单中安装应用，或在 iPhone Safari 的分享菜单里选择「添加到主屏幕」，并打开「作为网页 App 打开」。

首次联网打开后，设置中出现「离线题库可用」即表示题库、题图和知识导航准备完成。Windows 独立窗口与手机分别保存学习记录。

[Android 与一般 PWA 安装说明](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable) · [iPhone 主屏幕网页应用说明](https://support.apple.com/guide/iphone/bookmark-a-website-iph42ab2f3a7/ios)
