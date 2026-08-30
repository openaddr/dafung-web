# UI 评审 · 第三轮（2026-08-30）

> 方法：以最终构建实拍 20 张截图（7 张 look-\* + 13 张 r3-\*，screenshots/ 目录，gitignore），
> 5 个子 agent 并行分区评审（主页联机 / 棋盘 / 手牌资产 / 卷轴终局 / 动效美术横切），
> 全部结论经代码行号核实。第二轮已修复项（纹理、蛇形重排、城池棋子放大、破产口径、
> 选都三选一、身份头、WaitingBar 计时）不再涉及。
> 汇总：38 条，P0 × 0，P1 × 14，P2 × 17，P3 × 7。

---

## 一、主页 / 准备页 / 联机大厅（Agent A，8 条）

1. **【联机建房/加入行控件高度不一】P1 · S**
   - 证据：r3-lobby-empty.png；`LobbyScreen.tsx:169` inputBase=`px-2 py-1`≈30px、`Stepper.tsx:22` h-10=40px、`LobbyScreen.tsx:251` 建房钮≈38px，同排三控件三种高度，「诸侯数/目标身价」标签错位 5px。
   - 方案：inputBase 追加 `h-10 py-2`；建房/加入按钮改 `h-10 py-0`；「建房」的 `self-end` 移除。
2. **【选图面板带预选打开时预览区空白】P1 · S**
   - 证据：r3-setup-map.png；`MapSelectPanel.tsx:89` picked 初始化不触发预览加载，`:199-202` 虚线槽无条件渲染——默认路径下「看图选图」恰好缺失。
   - 方案：挂载时对初始 picked 复用 `pick()` 加载（useEffect once + 卸载守卫）；预览分区条件渲染，未加载不留空槽。
3. **【房间码缺「怎么用」引导】P1 · S**
   - 证据：r3-lobby-room.png；`LobbyScreen.tsx:324-344` 大字房码+「点击复制」，无用途说明；host 轮换文案（:106-108）全是氛围句。
   - 方案：提示行改「点击复制，发给好友凭码入座」；host 未满座轮换首句固定为「把房间码发给好友，入座即可开局」；房码钮补 aria-label。
4. **【金色小字对比度约 2:1】P1 · S**
   - 证据：r3-lobby-room.png；`LobbyScreen.tsx:391` 国号章 13px text-gold 对 gold/15 底≈1.8:1、`:402` 改名预告≈2:1（AA 小字 4.5:1）。
   - 方案：章字色改 `text-ink` 或改朱砂印（`border-danger bg-danger/10 text-danger`≈4.5:1）；改名预告改 `text-ink-dim` + 被改单字 `text-ink font-bold`；房码 hover 改 `hover:bg-gold/10`。
5. **【单机座位表表头错位 8px + bot 行「电脑」重复】P2 · S**
   - 证据：r3-setup.png；`SoloSetupScreen.tsx:198` 表头 grid 无 gap vs `:207` 数据行 gap-2；bot 行国号列（:217-223）与类型列（:253-255）都显示「电脑」。
   - 方案：表头追加 `gap-2`；bot 行国号列改「待分配」。
6. **【首页四入口等尺寸无层级】P2 · S**
   - 证据：r3-home.png；`HomeScreen.tsx:46-47` 统一 py-5 text-2xl，玩法与工具权重相同。
   - 方案：选择地图/编辑地图降为 `py-4 text-xl`；grid 改 `gap-x-4 gap-y-5` 分组。
7. **【房主建房丢失预设国号】P2 · M（跨端）**
   - 证据：`SoloSetupScreen.tsx:248` 承诺联机自动使用，`lobby-api.ts:44` createRoom 无 guohao 参数、`scripts/server.ts:305-327` `/room/new` 不接收——承诺仅对加入者成立。
   - 方案：`/room/new` 接收 `guohao?` → registry 给 seat0 走 joinSeat 同款预设写入；api/UI 各补一处。
8. **【大字距文本尾距未补偿】P3 · S**
   - 证据：`LobbyScreen.tsx:331` 房码 tracking-[0.4em] 视觉左移 7px、`:324` 大厅标题 5px；首页已有 `pl-[0.5em]` 先例（HomeScreen.tsx:74-75）。
   - 方案：房码补 `pl-[0.4em]`、大厅标题 `pl-[0.3em]`，顺检 `:196`。

## 二、棋盘与地图（Agent B，6 条）

1. **【主路缺方向性语言：无箭羽、无起点标记】P1 · S**
   - 证据：r3-overview/look-07-full 全程素色驿道；`StaticLayers.tsx:194-205` 仅画折线，蛇形六 U 弯方向全靠猜；起始城长安无「起点」标识。
   - 方案：RoadsLayer 每段中点画箭羽 `path "M -9,-7 L 5,0 L -9,7"`（stroke `rgba(90,70,40,0.5)`、宽 4.5、rotate atan2）；首段前双箭羽；长安铭牌右上叠「起」字朱印（复用 bv-capital-seal 制式，rotate -6°）。
2. **【玩家色板与区域分组色同值，归属染色抹掉地域色】P1 · S**
   - 证据：`theme.ts:50-59 vs 73-82`——groupColors.c/d/e/h ≡ playerColors[3/4/2/5]；`Tile.tsx:361-367` 有主时色带染玩家色，长沙（无主·岭南）与江陵（宋·荆楚）同为紫色。
   - 方案：色带恒用区域色（删 ownerRgb 分支）——归属已有铭牌整块深底+屋顶瓦色+城主旗三重编码不受损；不建议重排 16 组色相。
3. **【当前回合格与都城共用金色脉动】P2 · S**
   - 证据：`board.css:47-52` 同一 `.bv-capital-glow` 光晕，仅周期 3.5s/1.8s 之别。
   - 方案：活跃格改独立语法——旋转虚线环 `r=80 strokeDasharray="12 9"`（6s linear，与行军金虚线环同族=「行动主体」语言），金晕专属都城。
4. **【辅路格/碑亭未随 2.2x 放大，总览不可辨】P2 · S**
   - 证据：`StaticLayers.tsx:221-234` 辅路 circle r=18/字 18、碑亭 239-275 仍 1x 口径；r3-overview 中「宝/囊/伏」字约 5px。
   - 方案：辅路 r 18→30、字 18→28、描边 2→3；碑亭整体 `scale(1.6)`。主次比约 1:3.7。
5. **【区域晕染峰值 8% 低于感知阈值】P2 · S**
   - 证据：`StaticLayers.tsx:178-183` stopOpacity 0.08/0.04/0，八片晕染宣纸底上均不可辨。
   - 方案：峰值 0.08→0.15、70% 处 0.04→0.08（仍低于道路 0.38/铭牌 0.92）；验收口径=总览能看出交界色相推移。
6. **【缩放无 +/− 控件】P3 · S**
   - 证据：`GameScreen.tsx:292-302` 仅 ◎ 复位钮；触屏单手/触板不可发现缩放。
   - 方案：棋盘左下竖排两枚 40×40「+/−」与 ◎ 同制式，usePanZoom 增 ~20 行 zoomBy(factor)（×0.8/×1.25，视口中心锚定）。结论性意见：边缘渐隐已扎实，不建议加小地图/指北针。

（Agent B 核验过不建议立项：匾额与下邻王旗尖角理论擦碰 <2px；多子槽位偏移核算不重叠；1280×700 留白节奏健康。）

## 三、手牌区 / 资产区 / 诸侯列表（Agent C，8 条）

1. **【矮视口抽屉诸侯区被压到 0 高，整区静默消失】P1 · S**
   - 证据：r3-mobile-drawer.png 底部止于「珍宝·名士」标题；`GameScreen.tsx:390` 抽屉分支 `overflow-hidden`、`OthersPanel.tsx:14` min-h-0、`TreasuryPanel.tsx:70` min-h-24——核算 65+92+196+96≈449px > 390px。
   - 方案：抽屉态 aside 改 `overflow-y-auto`；OthersPanel 根 section `shrink-0` + 内滚容器 `max-h-40`；TreasuryPanel `max-md:flex-none`。
2. **【三处重复同一组资产数字】P2 · S**
   - 证据：StatusBar.tsx:40 / HandPanel.tsx:202-222 / OthersPanel.tsx:66-72——同一玩家现金×3、身价×3、委任×2。
   - 方案：定权威——手牌区是「我的钱」唯一大数呈现（删其「身价」小字）；StatusBar meta 收敛为「身价 X · 委任 N」；诸侯行保留作他人信息唯一来源。
3. **【现金浮字金色对比不足，起点压进身份头】P2 · S**
   - 证据：`useDeltaFloat.tsx:57-64` text-gold 对纸底≈1.9:1；`game-hud.css:14-26` 上浮 14px 后压「本方视角」。
   - 方案：金字加深 #8a6a1c 或补纸色光晕 text-shadow；text-xs→text-sm；位移 -20px；1.4s `cubic-bezier(0.22,1,0.36,1)`。
4. **【珍宝区空态荒芜 + 珍宝行无等级视觉】P2 · M**
   - 证据：r3-treasury.png 只有两行 12px 灰字；`TreasuryPanel.tsx:90-93` ◆ 同色同尺寸。
   - 方案：空态合并为居中「藏」字浅章（36px 方章+一行说明，与观战空态同语言）；等级三档视觉（Lv2 border-gold/70、Lv3 bg-gold/10+金点，或 10px 方章徽记）。
5. **【诸侯行数字无 tabular 对齐 + 口径漂移】P2 · S**
   - 证据：`OthersPanel.tsx:70`「身价{…}」无空格 vs HandPanel「身价 83两」；进锭后右列宽度参差。
   - 方案：数字 span 加 `tabular-nums font-medium`；补空格统一口径；现金与身价间加 1px 竖分隔。
6. **【品牌横幅对局中常驻 65px】P2 · S**
   - 证据：`GameScreen.tsx:398-401` text-2xl+py-2+block 副标，矮视口占 1/6。
   - 方案：Playing 时压为单行（text-base + inline 副标 ≈36px），Setup/GameOver 保留大横幅。
7. **【「你」行定位仅 1px 淡金 ring】P3 · S**
   - 证据：`OthersPanel.tsx:32` ring-gold/60 纸底上很淡。
   - 方案：非活跃补 `bg-gold/10`、ring 改 `ring-gold`、「你」印 px-1/text-xs。
8. **【「第 N 轮」用最弱档呈现】P3 · S**
   - 证据：`StatusBar.tsx:50-52` text-xs text-ink-dim。
   - 方案：升一档 `font-deco text-sm text-ink`，或并入活跃卡 meta 行首。

## 四、卷轴系统 / 终局（Agent D，8 条）

1. **【详情卷轴 × 锚点错误，悬浮压在内容上】P1 · S**
   - 证据：r3-tiledetail × 悬在价值表中段；`ScrollShell.tsx:150` 标题栏无 `relative`，:168 的 `absolute top-1/2` 相对壳体居中，44px 热区形成幻点击区。
   - 方案：标题栏加 `relative`（一行）；× 升级为 1px 描边圆钮（h-7 w-7 rounded-full border-gold/40）。
2. **【卷轴只展开、不收起】P1 · S（可关卷轴）/ M（含决策卷轴）**
   - 证据：`scroll.css:6-15` 仅 unroll-in；ScrollShell.tsx:138 关闭直接卸载。
   - 方案：增 `@keyframes scroll-rollup`（scaleY→0.08 + opacity→0，origin top，0.2s ease-in）；closing 本地态 210ms 后真卸载（照抄 useDeltaFloat「播完再移除」模式）；DecisionScrollLayer 相位切换保留一帧 keep-alive（e2e 容忍残留帧）。
3. **【卷轴展开音效仍未接入】P1 · S**
   - 证据：`audio.ts:302-304` 注释自认「待接」；SoundEvent 无 scrollOpen、AUDIO_FILES 未映射 scroll-unroll.ogg。
   - 方案：SoundEvent 增 `"scrollOpen"` + AUDIO_FILES 映射 + ScrollShell 挂载即 `getAudio().play("scrollOpen")`（与展开 0.35s 天然同步，零新增资产）。
4. **【展开动画是「整体压扁回弹」不是「卷轴摊开」】P2 · M**
   - 证据：`scroll.css:6-15` scaleY+scaleX 挂整个壳体（含标题字），读感是 pop-zoom。
   - 方案：拆两层「标题栏先行」——壳体 opacity+translateY(-8px)+scaleX(0.97)（0.22s ease-out）；body wrapper origin-top scaleY(0→1)（0.34s ease-out，delay 60ms backwards）；底部垫 4px 深金「下轴」随展开下移。ConfirmDialog 同步。
5. **【ValueTable 不标当前档位】P2 · S**
   - 证据：`ValueTable.tsx:13-28` 无高亮入参，4 行视觉均质；购地/扩军关键档也不标记。
   - 方案：增 `highlight?: { level, label }`——行 `bg-gold/12 + border-l-2 border-gold`，行尾 10px 角标（当前/购入档/扩军后）。
6. **【决策按钮主次权重不足】P2 · S**
   - 证据：`ScrollShell.tsx:56-58` primary 仅 1px→2px 边框+25% 金底。
   - 方案：primary 升档：金渐变实底 + inset 内高光 + px-5 py-2.5 text-[17px]；secondary 降半档 text-[15px]。
7. **【破产「结算」不区分两种结局】P2 · S / M（含进度条）**
   - 证据：`BankruptcyScroll.tsx:117-121` 恒金色主钮——仍欠款时点它=毁局（game.ts:1345-1354），凑足后也无达成反馈。
   - 方案：两态按钮：owe>0 降为警示次级（danger 描边，文案「结算 · 仍欠 X 两，认破产」）；owe=0 升主行动「结算 · 凑足！免破产」+一次性金晕脉冲；顶行下加 6px 清偿进度条（width 随清偿 0.3s ease-out 收缩）。
8. **【胜利屏缺「称帝」朱砂印落款】P2 · S**
   - 证据：`VictoryScreen.tsx:123` 450ms 播 stamp 锣声，但该时刻无画面事件。
   - 方案：称帝行右侧 56×56 朱砂印（border-[3px] #b23a2e、内嵌国号单字、rotate -6°），`animation-delay:0.45s`、0.28s out-back scale(1.8→1) 盖章入场，与锣声同帧。

## 五、动效体系 / 美术资源（Agent E，10 条）

### 动效线
1. **【动效 token 缺位：24 种时长魔法数、8 种缓动】P1 · M**
   - 证据：tokens.css 0 个 `--dur-*`/`--ease-*`；「呼吸」周期 1.2/1.6/1.8/2.0/2.4/2.6/2.8/3.5s 八种并存；timings.ts `ANIM` 是死代码（0 消费）；CTA 呼吸关键帧在 game-hud.css、时长却在 HandPanel.tsx:260 的 Tailwind 任意值。
   - 方案：theme.ts 增 motion 段走 gen:theme 管线——`--dur-instant:80ms/fast:150ms/med:250ms/slow:400ms/reveal:600ms/fx:1300ms/ambient:2600ms`；缓动四条：`--ease-out:(0.22,1,0.36,1)`、`--ease-in:(0.4,0,1,1)`、`--ease-out-back:(0.34,1.56,0.64,1)`、`--ease-sine:(0.45,0,0.55,1)`；各 css 全量替换字面量，删除或接活 ANIM。
2. **【屏幕切换零转场】P1 · M**
   - 证据：`App.tsx:202-243` 按 store.screen 瞬时硬切，开局是重场景跳变。
   - 方案：App 外包 keyed div（key=screen）入场 `opacity 0→1 + translateY 8px→0` 250ms ease-out；进 game 追加棋盘 viewBox scale×1.06→1 的 600ms 缓推（复用 flyTo，首帧一次性）；退场不做。
3. **【卷轴入场无退场 + 音效未接】P2 · S**（并入四-2/四-3）
4. **【城池升级/易主无视觉宣告】P2 · M**
   - 证据：`orchestrator.ts:169-175` 扩军只有音效+浮字；Tile 建筑与 LevelSeal 即时跳变。
   - 方案：LevelSeal 印章 pop（0.45s out-back，SVG `transform-box: fill-box`）；建筑顶层 `key={level}` 重挂 + grow（0.3s out-back，origin 底边中心）；易主顶横幅玩家色流光 0.5s。
5. **【按压反馈不成体系 + 现金数字硬切】P3 · S**
   - 证据：home.css:82-84 `:active scale(0.97)` 但无 transition（实为硬切）；现金主数字瞬时跳变。
   - 方案：app.css 全局 `button:not(:disabled):active { transform: scale(0.98); transition: transform var(--dur-instant) }`；现金 chip 加一拍 0.98→1 pulse（零依赖方案）。

### 美术线
6. **【音频资产三处悬空：2 死文件 + 3 未登记】P1 · S**
   - 证据：gong-hit.ogg/horse-gallop.ogg 零引用且 horse-gallop 无 manifest/CREDITS 条目；woodblock-hit/coins-shake/gong-long 在用（audio.ts:293-301）但两处均无登记——授权纪律缺口。
   - 方案：horse-gallop 接线（marchStart 低音量 0.15 马蹄底噪）或删除；三个在用音频补 manifest+CREDITS（README 记有来源）；gong-hit 删或移作破产音。
7. **【字体意图未落地：文楷只有 2 处示意，Noto Serif 202 片近乎死重】P1 · S**
   - 证据：`tokens.css:29` --font-body 首选 Noto Serif SC（全仓最重）消费仅 1 处；--font-wenkai 仅 DecisionScrolls.tsx:44、TileDetailScroll.tsx:75；app.css 无 body 默认 font-family，正文实走系统栈。
   - 方案：app.css 加 `body { font-family: var(--font-wenkai) }`（或 @theme 覆盖 --font-sans）；Noto Serif SC 若无去处从 fonts.css 移除 202 片（体积+加载竞态双收益）。
8. **【棋盘远景是三块多边形，与胜利屏千里江山落差大】P2 · S**
   - 证据：`StaticLayers.tsx:77-106` 手写 polygon 山 opacity 0.12；胜利屏 qianli-jiangshan.webp 效果出色。
   - 方案：fetch-asset 管线取《溪山清远图》（PD）1920px 裁带 → TerrainLayer 上下缘 `<image>` 带（高≈18%、opacity 0.10-0.14、bv-edge-mask 渐隐）；退役删除 4 个零引用旧 SVG（ink-mountains/rice-paper/chinese-fret-border/compass-rose，fret-border 可先试接侧栏分隔线）。
9. **【珍宝/地标照片与水墨风打架】P3 · S / M**
   - 证据：treasure-lychee.jpg 实拍水果照、tile-Wolong.jpg 糖画照（唯一 CC BY-SA 条目）与书法字牌同屏。
   - 方案：短期容器加 `filter: sepia(0.35) saturate(0.85) contrast(0.92)` + 照片 multiply 融纸底；长期换 game-icons.net（CC BY 3.0，管线已验证）剪影或 PD 文物照；Wolong 优先替换消除唯一 SA 授权。
10. **【宣纸纹理 0.45 偏浓 + 全屏混合层常驻合成开销】P2 · S**
    - 证据：`app.css:84-93` opacity 0.45、z-60 常驻（盖在骰子 overlay z-50 上）；2x 放大下格内纸纹与墨线打架。
    - 方案：拆变量 `--texture-opacity-menu:0.45 / --texture-opacity-game:0.36`；骰子/卷轴激活期临时降 0.28；xuan-paper.jpg 273KB→1280px q80 约 120KB；真机掉帧兜底=纹理烘进棋盘纸底 rect。

---

## 汇总与建议切分

| 批次 | 内容 | 条数 | 特征 |
|---|---|---|---|
| R3-Wave A「一行修」 | 四-1 ×锚点 / 四-3 卷轴音 / 一-2 选图预览 / 一-5 表头+电脑重复 / 三-1 抽屉诸侯区 / 三-5 tabular / 一-8 尾距 / 五-6 音频登记清理 / 五-7 字体落地 | 9 | 全 S，多为 1-3 行修复 |
| R3-Wave B「视觉语言」 | 二-1 箭羽+起点印 / 二-2 色带归区域色 / 二-3 活跃虚线环 / 二-4 辅路放大 / 二-5 晕染提浓 / 三-4 珍宝空态+等级 / 三-2 数字去重 / 三-3 浮字 / 三-6 横幅压缩 / 三-7/8 / 一-1 等高 / 一-3 房码引导 / 一-4 金字对比 / 一-6 首页层级 | 14 | S 为主，纯前端 |
| R3-Wave C「动效体系」 | 五-1 motion token / 五-2 屏幕转场 / 四-2+五-3 卷轴收起 / 四-4 摊开重构 / 四-5 ValueTable 高亮 / 四-6 按钮主次 / 四-7 破产两态+进度条 / 四-8 称帝印 / 五-4 升级宣告 / 五-5 按压+现金 pulse / 二-6 缩放钮 | 11 | M 为主，动效主场 |
| R3-Wave D「跨端+资产」 | 一-7 房主国号（server） / 五-8 溪山清远图 / 五-9 照片做旧 | 3 | 各自独立 |
