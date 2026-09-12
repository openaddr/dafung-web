# Android 横屏适配与移动端注意事项

## P0-8 Android 锁横屏

Tauri 2 的横竖屏**不在** `tauri.conf.json` 里配置(该文件没有 orientation 字段),
唯一入口是 GenAndroid 工程(`bun run tauri android init` 产物)里的 AndroidManifest.xml:

```
src-tauri/gen/android/app/src/main/AndroidManifest.xml
```

本仓库已有 GenAndroid 工程,`<activity android:name=".MainActivity">` 上已改为:

```xml
android:screenOrientation="sensorLandscape"
```

- `sensorLandscape`:锁横屏,但允许随传感器在左右两个横向之间切换(推荐,体验最好)。
- 需要绝对锁定单侧时改为 `landscape`(仅右横向)。
- 若重新 `tauri android init` 覆盖了 manifest,需重新把该属性改回。

### 从零初始化的完整步骤(本仓库已执行过,仅供重建时参考)

```bash
bun run tauri android init
# 然后编辑 src-tauri/gen/android/app/src/main/AndroidManifest.xml,
# 给 <activity android:name=".MainActivity"> 加/改:
#   android:screenOrientation="sensorLandscape"
bun run tauri android dev   # 真机/模拟器验证
```

## 其他移动端适配落点(波3 环境适配分片)

- **P0-9 safe-area**:`index.html` 已开 `viewport-fit=cover`;`src/app/styles/app.css`
  定义 `--safe-top/--safe-right/--safe-bottom/--safe-left` 与 `.safe-pad` 工具类。
  贴边悬浮元素由各组件自行挂 `.safe-pad`(清单见任务报告)。
- **M-7 dvh**:`app.css` 的 html/body/#app 用 `100dvh`(回退 `100%`);
  弹层高度用 `max-h-[86dvh]` 等 Tailwind 任意值。
- **M-4 reduced-motion**:`app.css` 全局兜层 + `src/app/fx/ThreeDice.ts` 模块级
  `reducedMotion` 检测(骰子跳过物理演出,overlay 停留 ~500ms)。
- **M-6 字体离线**:`public/fonts/` 下是 Google Fonts 的 woff2 unicode-range 子集镜像
  (Ma Shan Zheng / ZCOOL XiaoWei / Noto Serif SC 400+700,共 386 个子集,约 13MB),
  `index.html` 引用本地 `/fonts/fonts.css`,font-family 名不变,离线 APK 样式零变化。
