## Context

dafung-web 是 TypeScript + Vite、纯 DOM/SVG(无框架)的三国大富翁。结构:

- `src/core/`(纯逻辑,可单测):`types` `board` `board-loader` `dice` `economy` `events` `game` `networth` `player` `theme` `money` `bot`
- `src/render/`(DOM/SVG):`board`(SVG 棋盘 + 城池图标 + 道路地形 + 缩放平移 + tile/token 更新,~470 行)、`state`(App 上帝对象,~490 行)、`ui`(布局/侧栏/弹窗)、`editor`(地图编辑器)、`animate`(动画)、`style.css`、`dom`(svg/el 工具)
- `src/main.ts`(入口/地图加载)、`src/version.ts`、`public/maps/sanguo.json`

经多轮迭代积累技术债:常量/逻辑多处重复、两个文件职责过载、魔法数字散落、陈旧引用、地图校验直接 throw 曾卡死游戏(v1.9.4 已热修)。本设计在**不改玩法行为**的前提下做内部重构。

约束:无 git;测试基线为单测 41 + e2e 10;`window.__dafung` 调试面、`loadMap(data, opts?)` 签名须保持兼容;localStorage 存档格式不变。

## Goals / Non-Goals

**Goals:**
- 共享常量单一来源(骰面/签字、棋子同格错位、最小间距、viewBox、城池尺寸/字号、动画时长、缩放上下限)。
- 拆分 `render/board.ts` 与 `render/state.ts` 两个过载文件为聚焦模块。
- 移除死代码与陈旧引用(`.dice-tray`、"机遇/命运""掷骰""¥""jail/shop/airport"等)。
- 固化并扩展地图加载韧性(见 `map-loading-resilience` 规约)。
- 内容更数据驱动(TileType/事件类别/货币档位/捷径后果等枚举集中),利于扩展。
- 全程测试保持绿;无玩法行为变更。

**Non-Goals:**
- 不加新玩法特性。
- 不换技术栈(继续 DOM/SVG,不引入框架/Canvas 重写)。
- 不做性能重写(SVG 当前够用)。
- 不改存档格式 / 不破坏 localStorage。
- 不重写编辑器(只做韧性 + 共享常量)。

## Decisions

### 1. 新增共享常量模块 `src/core/constants.ts`
集中:`SIGN_FACES`(签面 一二三四五六)、`TOKEN_SLOT_OFFSETS`(同格错位 [-22,-8]…)、`MIN_TILE_DIST`(=80)、棋盘 `VIEWBOX`、城池 base 尺寸/字号、`ZOOM_MAX`、关键动画时长。
**理由**:消除 ≥3 处重复(animate.ts 与 state.ts 的骰面;board.ts 与 animate.ts 的棋子偏移;board-loader.ts 与 editor.ts 的间距阈值),调参一处生效。
**备选**:各文件就地保留(否决——正是当前状态,已产生阈值分歧)。

### 2. 拆分 `render/board.ts`(~470 行)
按职责拆为:
- `render/board-canvas.ts`:`createBoardSvg`、各 SVG 层、viewBox、缩放平移、`resetView`、`BoardView` 接口。
- `render/tile-icon.ts`:`buildGate`、`drawBuilding`、`priceOf`。
- `render/board-terrain.ts`:`drawMountainsAndRivers`、`drawRoads`。
- tile/token 的 `updateTiles`/`updateTokens`/`setTokenPosition` 留在 board-canvas 或抽 `board-update.ts`。
**理由**:470 → 若干 ~120 行聚焦文件;改城池图标不影响缩放逻辑。
**`BoardView` 公开接口保持不变**(导入路径变,调用方 state.ts/animate.ts 改 import 即可)。

### 3. 拆分 `render/state.ts` 的 App(~490 行)— 高风险,后置/可选
抽出:`turn-flow`(roll/move/afterLand/bot 调度)、`overlays`(scroll/confirm/decision/detail/hint/thinking)、`setup-flow`(选都 advanceSetup/handlePickCapital)为独立函数/模块;App 退化为薄协调者。
**理由**:上帝对象难维护、难扩展。
**备选**:只抽 `overlays`(风险较低),其余保留(若风险/工时不允许全拆)。

### 4. 地图加载韧性(对应规约)
- `loadDefaultMap` 的 try/catch 降级(v1.9.4 已实现)保留并固化。
- 编辑器"试玩"路径同样 try/catch + 可读错误。
- `MIN_TILE_DIST` 从 `constants.ts` 导出,`board-loader`(严格)与 `editor.overlappingTiles`(高亮)共用;`loadMap(data, {lenient:true})` 仍用于编辑器实时预览。

### 5. 内容数据驱动(轻量)
确认 `TileType`、事件 `category`、货币档位、`ShortcutConsequence` 等枚举/表集中在 `core/types.ts`/`events.ts`,消除散落硬编码字符串;为后续加城池/格子类型/事件留好扩展点。不做大改。

### 6. 死代码 / 陈旧引用清理
删未用的 `.dice-tray` CSS、`rentFor`(`types.ts`)、`setText`(`dom.ts`)、`NS`/`void NS`(`board.ts`)等;把注释/命名中的"机遇/命运""掷骰""¥""jail/shop/airport"与现状(锦囊/天命、抽签、锭两分、Property/Chance/Fate/Tax/Stock)对齐。死枚举 `Shop/Airport/Jail`(无任何代码产生/处理)要么实现、要么从 `TileType` 删除(倾向删除,见 Decision 5)。

### 7. 修复审查发现的可靠性 bug(小改、高价值)
- **`doDraftRoll` n>6 死循环**(`game.ts:193`):DEV 允许最多 30 人但骰子只有 d6,`new Set(rolls).size === n` 对 n>6 永不成立 → 无限循环。改为:尝试上限 + 接受并列(平局者按序),或 n>6 时换更宽的随机源。
- **编辑器 导入/重置 丢字段**(`editor.ts:78,105`):只迁移 `tiles/shortcuts/targetNetWorth/startingCash`,漏 `version/maxLevel/resupplyPerLevel` → 导入高 maxLevel 地图时按旧值校验租金长度而崩。改用 `Object.assign(mapData, loaded)` 全字段迁移。
- **CoinFlip 胜负符号未校验**(`game.ts:413`):`win.cashDelta`/`lose.cashDelta` 的正负无约束,作者填反则"胜"显示为扣钱。在 `loadMap` 校验 `win>=0 && lose<=0`。
- **默认 group `"z"` 无配色/名称**(`board-loader.ts:107` + `theme.ts`):落到 `groupNames.z = undefined`。改为有 `"杂"` 兜底或算法生成色。
- **编辑器捷径 id 碰撞**(`editor.ts:230`):删后再加复用同 id → 用 `crypto.randomUUID()`。
- **`lastRoll/lastMove` 不清空的隐式不变量**(`game.ts:656`):加 snapshot/单测断言,防止未来重构误清。
- **悬浮层生命周期不一**(`state.ts`):统一所有 `showX()` 先 `hideOverlay()`,胜利走 overlay 槽位。

## Risks / Trade-offs

- **[board.ts/state.ts 拆分移动大量代码]** → 拆分=纯移动 + import 调整,保持 `BoardView`/App 公开面不变;每拆一个文件跑一次 `npm test` + `npm run build` + 关键 e2e。
- **[state.ts 拆分风险最高]** → 安排在最后;若超时/风险过高,降级为只抽 `overlays`(Decision 3 备选)。
- **[抽常量时值被误改]** → 抽取阶段保持数值完全一致(纯移动),调参另开任务。
- **[编辑器 lenient 掩盖真实错误]** → 仅编辑器预览用 lenient;游戏启动路径严格(失败即降级),不掩盖。
- **[陈旧注释清理可能误删有用上下文]** → 只改命名/措辞与事实不符处,不删业务说明。

## Migration Plan

分阶段提交(无 git,靠测试兜底;每阶段 `npm test` + `build` 全绿才进下一阶段):
1. **常量抽取 + 共享模块**(纯新增,零行为变更):`core/constants.ts`(SIGN_FACES、TOKEN_SLOT_OFFSETS、MIN_TILE_DIST、VIEWBOX、TILE_GEO、ZOOM 参数、TAP_MAX_MOVE)、`render/timings.ts`(动画/bot 延时)、`core/bot-policy.ts`(AI 权重)、`core/geometry.ts`+`render/svg-util.ts`(findTooCloseTiles、polylinePath、svgCoordHelpers、isSingleCjk)→ 测试。
2. **去重**(board/animate/state/editor/loader 改用常量)→ 测试。
3. **韧性**(loader 降级已有;扩展编辑器试玩 + 共享 MIN_DIST + 新增降级单测)→ 测试。
4. **清理**(死 CSS + 陈旧引用)→ 测试。
5. **拆 board.ts** → 测试。
6. **(可选/高风险)拆 state.ts** → 测试。

回滚:每阶段独立,失败则回退该阶段改动;无数据迁移(localStorage 格式不变)。**为将来版本升级预留**:`loadMap` 增加 `migrate(data)` 钩子(版本号变更时转换旧存档),避免再次出现"升版本静默清空 localStorage"。

## Open Questions

- `state.ts` 拆到什么程度?(全拆 vs 仅抽 overlays/setup)——按风险 appetite 在实施阶段定;倾向先抽低风险的 overlays/setup,turn-flow 视情况。
- 是否一并整理 CSS 值为主题变量?(CSS 变量已在 `:root` 集中;本轮先做 TS 常量,CSS 暂不动。)
