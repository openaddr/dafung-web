# UI/UX 评审清单 · 第二轮(2026-08)

> 四路并行子代理评审产出(入口屏 / 游戏 HUD / 棋盘演出 / 移动端),共 76 项。
> 与 docs/ui-improvements.md(第一轮 19 项,已全部完成)不重复。
> 实施波次见文末;改完打 `[x]` 并注 commit。

## 一、P0 — 体验阻断(9)

### 交互
- [x] **P0-1 起兵无 loading/防连点**:地图异步加载期按钮无 busy 态(SoloSetupScreen.tsx:230-236);点击后 disabled + 文案「调兵遣将中…」
- [x] **P0-2 已入座无「退出房间」入口**:玩家被困,唯一退出=房主解散(LobbyScreen.tsx:237-365);加常驻「离开房间」按钮(非 host 可见),走 controller 离房 + onExit
- [x] **P0-3 折叠窄条丢失「轮到我」**:收起侧栏后行军按钮被藏,可能错过整回合(GameScreen.tsx:292-311);窄条加轮到我状态(金色/呼吸描边)+ 竖排小「行军」热钮
- [x] **P0-4 行军按钮视觉重量不足**:`bg-gold/20 px-4 py-1`≈30px 高,不像主 CTA(HandPanel.tsx:122-131);可掷时实心金底/min-h-10/微光呼吸

### 移动端
- [ ] **P0-5 无双指 pinch 缩放**:usePanZoom 单指针模型,第二指落下当平移跳变(usePanZoom.ts:75-104);维护 `Map<pointerId,{x,y}>`,双指按距离比以中点为锚缩放
- [ ] **P0-6 SVG 无 touch-action:none**:触屏拖棋盘与浏览器原生手势打架;board 容器加 `touchAction:"none"`(+ overscroll-behavior)
- [ ] **P0-7 游戏屏无 <768px 布局**:侧栏并排压缩占 45vw(GameScreen.tsx:257);窄屏改覆盖式滑出抽屉(复用 sidebarOpen 态),需 useMediaQuery 基础设施
- [ ] **P0-8 Android 未锁横屏**:tauri.conf/manifest 无 screenOrientation;目标横屏 APK 需 `sensorLandscape`
- [ ] **P0-9 safe-area 未落地**:仅 index.html 注释,`env(safe-area-inset-*)` 全项目 0 使用;悬浮按钮(top-2/right-2)会被刘海/状态栏遮挡

## 二、P1 — 入口类屏(11)

- [x] **H-1 金底按钮金色笔触下划线不可见**(home.css:37 vs HomeScreen.tsx:52);金底按钮下划线取反用 ink 线
- [x] **H-2 入场动效断层**:标题/副标题瞬时出现,按钮才 stagger(home.css:9-21);标题先行淡入;MapSelectPanel 加 150-200ms 进出场
- [x] **H-3 tracking-[0.3em/0.5em] 尾部字距溢出**致文字偏左(HomeScreen.tsx:45,69;LobbyScreen.tsx:252);末字负 margin 抵消
- [x] **H-4 focus-visible 无轮廓**(home.css:43-46);补 outline 2px dashed ink
- [ ] **H-5 「当前地图」行低对比(4.1:1)且不可点击**(SoloSetupScreen.tsx:96-100);提对比 + 整行可点唤起选图
- [x] **S-2 国号非法时起兵仍可点**(SoloSetupScreen.tsx:230);`disabled={guohaoInvalid}` + title
- [ ] **S-3 配置页换图绕四步**;当前地图行加「更换」内嵌 MapSelectPanel
- [x] **S-4 选图弹层错误态无重试、无 Esc/遮罩关闭**(MapSelectPanel.tsx:112-121);加 Esc 监听 + 遮罩点击关闭 + 重试按钮
- [x] **S-5 大厅传 MapSelectPanel 的 mapSource 每渲染新建致重复拉取**(LobbyScreen.tsx:354 / MapSelectPanel.tsx:99);useMemo 或 effect dep 收敛
- [x] **L-2 建房目标身价零校验,NaN 可直发**(LobbyScreen.tsx:166-182);inputMode=numeric + 失焦校验
- [x] **L-3 房码输入框 w-24 放不下 8 位码**(LobbyScreen.tsx:200-203);加宽 w-44+
- [x] **L-4 「返回设置」文案与新 IA 不符**(LobbyScreen.tsx:218,128);改「返回首页」并核对 App 接线

## 三、P1 — 游戏 HUD(10)

- [ ] **G-3 「运筹中」覆盖不足 + 与 HintBar 叠位**(GameScreen.tsx:185-193);统一等待状态条:bot=「智将运筹中」/远端人类=「静候『魏』落子」,与 HintBar 分位
- [ ] **G-5 棋盘无常驻回合线索**(仅侧栏呼吸描边);棋盘角加回合 chip(国号色徽+「X的回合」)或活跃棋子常驻高亮环
- [x] **G-7 卡牌 chip 点击目标 24px 无按下反馈**(HandPanel.tsx:75-98);min-h-9 + 边框加重 affordance
- [x] **G-8 托管可见性弱**:折叠后完全消失;托管中给窄条常驻标记;speed select 提高触达;reason 文案区分「托管中」
- [ ] **G-9 现金变化无就地反馈**(HandPanel.tsx:60-65);变化时 +/− 差值浮标;头部补自己身价
- [ ] **G-12 战报无玩家颜色编码**(WarlogPanel.tsx:92-106);条目前置国号色徽,自己的事件淡底
- [ ] **G-13 战报无轮次锚点/回最新**(WarlogPanel.tsx:88-108);按轮插「—第X轮—」分隔;上滚离底显示「回最新▾」
- [ ] **G-16 联机对手抉择无过程反馈**(DecisionScrollLayer.tsx:161-219);非交互方显示「『魏』正在抉择」(并入 G-3 等待条)
- [ ] **G-17 城详情×卡详情双层卷轴 z 序冲突**(GameScreen.tsx:196-204 + HandPanel.tsx:170);互斥或弹层栈
- [ ] **G-21 债权人看不到「对方变卖抵债」**(DecisionScrollLayer.tsx:96-126);并入统一等待条

## 四、P1 — 棋盘/演出/性能(11)

- [ ] **A1 主环 ~1200px 对角线断裂 + 底部 510px 空档**(chessboard.json:wan→wolong→xiangyang);补 1-2 过渡格(渡口/驿站),底部空档同理;同步 index.json tileCount
- [ ] **A2 中央大面积真空**(40 格全压边框,中央 1500×700 空);加粗江河水墨穿中央或区域晕染中心
- [ ] **B1 总览缩放下匾额字 ≈6px 不可读**(Tile.tsx:125 注释的 13.6px 论证漏了 0.43 总览系数);两级设计:总览靠色块/旗形 LOD,放大读字;先修正注释
- [ ] **B2 棋子旗/城旗/王旗三旗语法雷同**(TokenLayer.tsx:56-81 / Tile.tsx:404-419 / 363-392);棋子换形态或比例显著拉大+描边
- [x] **C1 每回合 1.2-2.1s 全屏骰子无 bot 减速**(ThreeDice.ts:348-349,303);bot 走半速(MIN_ROLL_MS→250/停留 600→250)
- [ ] **C2 solveLaunch 同步最多 40 次物理模拟卡主线程**(ThreeDice.ts:335,423-436);solve 期间先 render 起手帧 + 限制预算
- [x] **C3 回合横幅不占编排时长与下一骰重叠**(presentation.ts:60-61 / orchestrator.ts:46-48);showBanner 改 await
- [ ] **C4 镜头不跟随行军**:放大时行军/浮字全在视野外(BoardView.tsx:100 / usePanZoom 无 flyTo);暴露 flyTo(x,y) + 行军开始目标不在视区则缓动跟随
- [ ] **D1 浮字/印章拖拽棋盘时脱锚**(FxLayer.tsx:10-22);viewBox 版本注入依赖或画进 SVG #bv-fx 层
- [ ] **E1 胜利演出全程无声**(VictoryScreen.tsx);入场鼓点/印章重音(复用 audio.ts sample)
- [ ] **F1 pan/zoom 每帧 40 城全量 reconciliation**(BoardView.tsx:135-144 TileVisualState 内联对象击穿 memo);tiles JSX useMemo + viewBox 命令式 setAttribute 绕开 React

## 五、P1 — 移动端其余(5)

- [ ] **M-1 无 useMediaQuery/横竖屏检测基础设施**(全项目 0 matchMedia);建 hooks
- [ ] **M-2 触屏无城池 tap 反馈**(board.css:17 hover-only);补 active/点击闪亮
- [ ] **M-3 卷轴/大厅/配置按钮触达 <40px**(ScrollShell.tsx:45 / MapSelectPanel.tsx:165 / SoloSetupScreen.tsx:226 / LobbyScreen.tsx:186);统一 min-h-10
- [ ] **M-4 prefers-reduced-motion 0 支持**(fx.css 6 组 / board.css 2 组 infinite);CSS media query 降级 + 骰子开关
- [ ] **M-5 低端 GPU 无骰子降级**(ThreeDice.ts);帧率检测失败自动文字 fallback
- [ ] **M-6 字体走 Google Fonts 在线**(index.html:12-15),APK 离线裸奔;本地化 @font-face

## 六、P2 — 打磨项(29)

### 入口
- [ ] H-5b 选图项缺 aria-pressed;预览城池字 fontSize 9 过小(MapSelectPanel.tsx:70,134)
- [ ] S-6 表单控件点击区小、与首页按钮尺度断裂(SoloSetupScreen.tsx:112,125,180);统一 min-h-[40px]
- [ ] S-7 bot 行占位「机」语义不明(SoloSetupScreen.tsx:166);改「电脑」或 title 说明
- [ ] S-8 装饰 hint 与错误提示混用同位(SoloSetupScreen.tsx:59,239);装饰文案上移副标题
- [ ] L-5 「bot」中英混排(LobbyScreen.tsx:36);统一中文
- [ ] L-6 建房按钮 mt-5 硬对齐(LobbyScreen.tsx:186);self-end/grid items-end
- [ ] L-7 copied 定时器不清理 + busy 仅靠 title(LobbyScreen.tsx:232);effect 清理 + 文案「处理中…」
- [ ] L-8 座位状态翻转整行动画重放(LobbyScreen.tsx:271 key 含状态);动画只在入座事件

### HUD
- [ ] G-2 折叠现金换算丢精度口径不一(GameScreen.tsx:306-309);统一 formatMoney
- [ ] G-4 ConfirmDialog 无 Esc/焦点圈定(scroll/ConfirmDialog.tsx:32-45)
- [ ] G-10 未入座空态浪费(HandPanel.tsx:50);「观战中」明确信息 + 隐藏动作区
- [ ] G-11 手牌 flex-1 与战报 flex-[1.4] 比例颠倒(HandPanel.tsx:48 / WarlogPanel.tsx:67);手牌 shrink-0
- [ ] G-14 战报 300 条全量渲染无 memo(WarlogPanel.tsx:65,89);窗口化或 memo 单条
- [ ] G-15 OthersPanel 无身价/破产预警(OthersPanel.tsx:37-38);补身价小字或排序
- [ ] G-18 卷轴拖拽后换城不复位(ScrollShell.tsx:67-76);children 变化重置 transform
- [ ] G-19 ScrollButton 36px 低于 40 基线 + 决策无数字快捷键(ScrollShell.tsx:43-47)
- [ ] G-20 买地卷轴信息过载,买不起仍展示全表(DecisionScrolls.tsx:94-121);「持有X·需Y·差Z」一行 + 折叠

### 棋盘/演出
- [ ] A3 区域晕染 8 层全幅叠加中央糊(StaticLayers.tsx:127-130);半径收紧或中央让位江河
- [ ] A4 辅路「⇄」符号与水墨语境脱节(StaticLayers.tsx:179-183);换小旗/碑亭剪影,方向随 branch 走向
- [ ] B3 王旗文字贴近三角尖端溢出(Tile.tsx:381-390);锚点右移或旗面改平行四边形
- [ ] B4 「都」印 14px 总览失效(Tile.tsx:396);放大 ~20 或远距并入金座
- [ ] B5 竖排匾 3 字行距 18/字 17 无间缝(Tile.tsx:130-131);step 20-21
- [ ] C5 行军动画无取消令牌(resetFx 后 stale 演出继续)(useMarch.ts:79-135)
- [ ] D2 dice overlay z-45 压胜利屏 z-40(fx.css:15 / VictoryScreen.tsx:97);victory 挂载清 overlay
- [ ] D3 铜钱雨 🪙 emoji 与水墨语言相斥(FxLayer.tsx:45-48);换「泉」字或方孔钱剪影
- [ ] D4 浮字 26px 固定屏幕像素高倍缩放失衡(fx.css:28);随视图缩放设下限
- [ ] E2 胜利演出无叙事序列(VictoryScreen.tsx:94-136);四块 200-300ms 阶梯 + 再战钮延后
- [ ] E3 烟花粒子固定像素大屏显小、波频略密(VictoryScreen.tsx:57,84);按容器尺寸缩放
- [ ] F2 都城光晕 blur(9px) 滤镜动画常驻(Tile.tsx:226 / board.css:23-42);改 radialGradient 圆
- [ ] F3 ThreeDice 不响应 resize(ThreeDice.ts:189-192);挂监听 cleanup
- [ ] F4 feTurbulence 全幅滤镜缩放重算(StaticLayers.tsx:20-27);噪点预渲染 image 平铺(观察项)

### 移动端
- [ ] M-7 height:100%/86vh 移动浏览器抖动(app.css:16 / MapSelectPanel.tsx:117);100dvh
- [ ] M-8 title 提示 13 处触屏不可见;关键信息常显或点击弹出
- [ ] M-9 infinite pulse 动画移动端耗电;reduced-motion 或窄屏关闭

## 实施波次(并行分片按文件所有权划分防冲突)

1. **波1 快赢**:P0-1/2/3/4 + H-1/2/3/4 + S-2/4 + L-2/3/4/7 + C1/C3 + G-8 部分
2. **波2 核心手感**:C4 镜头跟随 + F1 性能 + D1 浮字 + E1/E2 胜利 + G-3/16/21 等待条 + G-12/13 战报
3. **波3 移动端**:P0-5/6/7/9 + M-1~M-6 + P0-8
4. **波4 地图与视觉**:A1/A2 + B1/B2 + 其余 P2
5. **波5 清尾**:全部剩余 P2

每波后统一验证:tsc --noEmit + bun test + bun run build + e2e 全量。
