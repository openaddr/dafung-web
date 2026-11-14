# APK 冒烟验收与真机交接

本记录对应 [#1440](https://github.com/openaddr/dafung-web/issues/1440)。工具只证明指定 APK 在指定安卓设备上的安装、版本核对、启动及取证;物理真机人工检查沿用 [#215](https://github.com/openaddr/dafung-web/issues/215),不另立人工票。复跑前提与入口见 [开发与测试](../how-to/开发与测试.md#apk-设备冒烟)。

## 2026-11-14 构建来源

源码固定为 `b51dcf7505dfe8dc32d243dfc328d1d5c1904a72`,其父为测试优化集成尖端 `eb5fc1693946d048ee7ded6b67b25579e77ada90`。代码先 `jj describe` 定格、再 `jj new` 留出本次证据提交;后续 CLI 焦点修复与证据提交不是 APK 的构建来源,未修改游戏代码或重建 APK。版本为 `2026.11.52`,versionCode 为 `2026011052`,包名为 `com.dafung.web`,aapt 确认唯一目标 ABI 为 `x86_64`,使用 release 优化档。本次是测试工具验收包,未运行发布脚本、打 tag 或上传 Release,不冒充正式 arm64 发布资产。

安装包 SHA256 为 `f192f7e2d72f662753c681182f0e579558a69ccc9ad8b9ec00b6c38684321971`。`apksigner verify` 退出 `0`,v2/v3 签名验证通过,证书 SHA256 为 `7d09b4f0696ad5ba9e54202c1e02ca9a534e2a6fed8f2db8a84fd65237a5c2d4`。

构建环境为 `JAVA_HOME=C:/App/env/jdk-17`、`ANDROID_HOME=C:/App/env/android-sdk`、`NDK_HOME` 与 `ANDROID_NDK_HOME=C:/App/env/android-sdk/ndk/27.0.12077973`。在上述源码工作区构建:

```powershell
bunx tauri android build --target x86_64
```

release 未签名包需用 build-tools `35.0.0` 的 `zipalign.exe -f 4` 对齐,再用既有 `%USERPROFILE%/.android/debug.keystore` 的 `androiddebugkey` 签名。签名密码参数沿 [release.ts](../../scripts/release.ts) 的既有 debug-key 通路;这里只调用签名工具,不执行其中的 tag/发布动作。最终用 `apksigner.bat verify --verbose --print-certs` 核验。APK 保留在本地临时产物目录,不提交大二进制;产物 SHA256、versionCode、ABI、证书与验收时间随报告归档。

## 设备与复跑

本次专属 serial 为 `emulator-5580`,从空闲 `5580/5581` 端口启动既有 `medium_phone` AVD,使用 `-no-window -read-only -no-snapshot -no-audio` 与 WHPX。仅在该临时实例设置 `wm size 390x844`、`wm density 160`,应用横屏后采集 844×390 PNG;未改 AVD 配置文件。`wm` 与 `dumpsys display` 核得 override 为横屏 844×390/density 160,物理基值仍为 1080×2400/density 420,font_scale 为 `1.0`。844×390 是包含系统状态/导航条的整屏 PNG 像素,未测 WebView CSS viewport,不能把 PNG 尺寸等同完整标准档验收。设备为 Android 15/API 35、x86_64,WebView `com.android.webview 124.0.6367.219`。这是模拟器,不是物理真机。

签名包的本地路径为 `C:/Data/Pro/dafung-web-ws-test-opt-1432/tmp/apk-smoke/v2026.11.52-x86_64.apk`。从该工作区复跑时换一个尚不存在的证据目录:

```powershell
bun run test:apk --apk C:/Data/Pro/dafung-web-ws-test-opt-1432/tmp/apk-smoke/v2026.11.52-x86_64.apk --device emulator-5580 --package com.dafung.web --version 2026.11.52 --out C:/Data/Pro/dafung-web-ws-test-opt-1432/tmp/apk-smoke/repeat
```

清理工作区后,先从记录的源码 commit 重建并签名,再显式替换 APK 绝对路径与设备 serial;同版本重建不保证 APK 字节摘要相同。入口不会自动选择包或设备。模拟器仅由本次会话启动和关闭,共享 adb server 不关闭,不卸载用户应用、不清全局 logcat。收尾已用 `tasklist` 验明本次 emulator/qemu 进程,定点关闭 `emulator-5580` 后复核两进程均退出、设备列表为空;本次创建的设备 XML 已逐件删除,Kotlin 会话临时 leaf 已自动移除。

## 本次验收状态

工具的 CLI 错误出口族已经先红后绿,缺必填参数与缺 SDK 均返回非零;失败报告记录指定 serial、错误步骤与命令输出。脚本类型检查、lint 和格式检查通过。未运行全仓单测或浏览器 e2e。

本次真火发现并修正过一个工具缺口:首轮仅核对 Activity/pid,系统的“System UI isn't responding”遮罩仍被旧入口误放行。原始 PNG 与原始 `passed` 报告原样留在本地 `tmp/apk-smoke/rejected-initial/`,未改写为“脚本当时已拒绝”。随后在同一遮罩仍存在时,修后入口真实返回非零,错误明确指出 `mCurrentFocus=Application Not Responding: com.android.systemui`。同一焦点守卫现用于启动后与截图后,并要求截图后 pid 与本次启动相同。该缺口以实际遮罩的前后真火取代额外制造系统 ANR 的概率性测试。

仅对本次自建模拟器点击一次该系统对话框的“Wait”后,焦点恢复到游戏;没有重启、再次修改显示配置或把系统 ANR 归为游戏 bug。修后 CLI 在 `2026-11-14 18:54:55–18:55:06`(UTC+8)完整运行,步骤命令均退出 `0`,启动后及截图后焦点均归 `com.dafung.web`,截图后仍为本次启动 pid `2720`。结果为**模拟器上的安装、版本核对、原生进程/窗口就绪与取证通过**,页面完成另记实绘复核。

该轮原始 PNG 只有游戏背景;同一 pid 稍后完整显示首页。`uiautomator` 在首页可见时未暴露文本节点,未未经验证添加文本就绪轮询。当时入口有 3s 日志观察期,没有把它当作页面就绪判据。`2026-11-14 18:56:54`(UTC+8)补采当前态 PNG,同时确认焦点仍归本包、pid 仍为 `2720`;主线亲审完整首页可见。补采未重装、重启或改配置,仅为模拟器单态人工实绘复核,不能代替手势、系统返回、后台恢复、原生保存或完整对局验收。

| 归档证据                                                | 说明                                                                                    |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| [report.json](APK冒烟证据/2026-11-14/report.json)       | 修后完整成功报告原样复制;其 invocation/out 保留实际本地运行路径,evidence 使用相对文件名 |
| [logcat.txt](APK冒烟证据/2026-11-14/logcat.txt)         | 同一 CLI 运行、本包与本次设备起点之后的日志                                             |
| [screenshot.png](APK冒烟证据/2026-11-14/screenshot.png) | 与原始 CLI 报告一一对应的背景截图,未换成晚到首页                                        |
| [homepage.png](APK冒烟证据/2026-11-14/homepage.png)     | 后续同进程首页补采,不冒充 CLI 当时的画面                                                |

首页补采 PNG 的 SHA256 为 `71ae100bd9022829738f9dfa346b233cbe27def43798b868d776c6bd33d9fd44`。原始报告 SHA256 为 `5c456d87b7227b84a7a361b0416ba886cb0b205566cbb2845c3abef8123be165`,保留当时报告内容,没有回写历史状态或截图。

补采命令(二进制直接写盘,不经 PowerShell 文本重定向):

```powershell
bun -e "const r=Bun.spawnSync(['C:/App/env/android-sdk/platform-tools/adb.exe','-s','emulator-5580','exec-out','screencap','-p']);if(r.exitCode!==0)throw new Error(r.stderr.toString());await Bun.write('tmp/apk-smoke/current-state.png',r.stdout)"
```

失败路径实跑结果:

| 条件                            | 退出码与定位                                                      |
| ------------------------------- | ----------------------------------------------------------------- |
| APK 路径不存在                  | `1`,“APK 身份”步骤保留 `ENOENT`                                   |
| 期望版本改为 `2026.11.0`        | `1`,“APK 身份”步骤显示实得 `2026.11.52`,安装前即停止              |
| serial 改为 `missing-t9-device` | `1`,“指定设备”步骤明确该 serial 不存在;即使另一台设备在线也不改选 |
| 系统 ANR 遮罩占据焦点           | `1`,“启动并核对前台”步骤指出系统窗口,不能伪报通过                 |

上述失败报告均保留原始步骤与命令输出;本地临时产物清理后,本表与归档报告中的失败摘要保留定位事实。未授权设备通过明确拒绝非 `device` 状态执行;本次没有真实未授权连接,不声称实跑过该分支。

## 物理真机人工待验

下表均未以脚本安装启动或模拟器截图代验。人工执行后将结论回填 [#215](https://github.com/openaddr/dafung-web/issues/215),该票继续保持打开。

| 检查                                 | 当前结论                      |
| ------------------------------------ | ----------------------------- |
| 标准横屏 844×390 的完整游戏实绘      | 待验;首页取证不能代表完整对局 |
| 真实手势输入                         | 待验                          |
| 系统返回                             | 待验                          |
| 后台恢复                             | 待验                          |
| 原生文件保存                         | 待验                          |
| #215 软键盘与 viewport               | 待验                          |
| #215 Dialog 返回键与 input autoFocus | 待验                          |
| #215 关闭后首 tap、滚动起手          | 待验                          |
| #215 Select 层级与键盘               | 待验                          |

本票不扩展 [#1354](https://github.com/openaddr/dafung-web/issues/1354) 后置的 APK AI 传输口或设备农场。工具实现完成、模拟器设备冒烟通过与物理真机人工验收完成分别交接。
