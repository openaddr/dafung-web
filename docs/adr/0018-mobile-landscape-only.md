# 移动端仅横屏:APK 锁 sensorLandscape,浏览器竖屏提示层,竖屏游戏布局不做

日期:2026-09-27,用户拍板。

## 背景与问题

布局重构(#242 地图)桌面形态定案后,窄屏/Android 短横屏形态成票 #276。Tauri Android 是既定交付形态(#242 红线),设计初稿曾把「竖屏窄屏」与「短横屏」并列为两套待做形态——用户纠偏:**移动端只做横屏适配**。为竖屏另维护一套对局屏形态(席位卡/仪表条/手牌架在 ~390px 宽下的重排)成本高、收益存疑:真机游玩以横持为主,竖屏体验天花板低。

## 决策

1. **APK 启动即横屏**:`src-tauri/gen/android/app/src/main/AndroidManifest.xml` 的 MainActivity 已设 `android:screenOrientation="sensorLandscape"`(启动即横屏,陀螺仪在左右横屏间双向跟随;gen/android 入库跟踪)——APK 形态零额外工作。
2. **手机浏览器(LAN 玩)给提示层**:网页无法强制横屏(Screen Orientation API 的 `lock()` 需全屏上下文),竖屏打开时全屏「请横屏游玩」遮罩(`orientation: portrait and max-width: 700px and pointer: coarse` 才触发,桌面窄窗口 pointer:fine 不误伤),由 #276 实现。
3. **竖屏游戏布局永不做**:后续任何 UI 工单不得为竖屏增加游戏布局断点;「请横屏」提示层不是游戏布局,是形态门卫。

## 后果

- 正面:对局屏只维护一套游戏形态——桌面与短横屏(`orientation: landscape and max-height: 500px`,hand-rack.css/scroll.css 既有断点先例)共用结构,断点只调密度不重排;响应式面收窄为一个密度断点 + 一个提示层。
- 代价:手机浏览器竖屏打开必须旋转才能玩(提示层引导);若未来确需竖屏形态(特殊设备/新玩法),重开 ADR 撤销本裁决。
