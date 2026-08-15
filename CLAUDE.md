# dafung-web — 群雄逐鹿(三国大富翁)

## 项目概况
TypeScript + Vite + React 的三国主题大富翁桌游。两种对局形态:**单机模式**(1 真人对阵电脑)与**联机模式**(每人一台设备,WebSocket 同步)。早期为本地热座(单设备多真人轮流),已移除。

**项目性质(影响所有设计决策)**:个人项目,朋友圈子自用。**不考虑任何向前/向后兼容性**——不需要担心用户升级、旧版本数据迁移、API 兼容。只要当前版本能跑就行,需要重构就直接改。分析问题时不要把"兼容性""迁移"当作理由,除非用户明确要求。

## 架构红线(所有代码改动必须遵守)

### 1. core/ = 纯游戏逻辑,零 DOM 依赖
- `src/core/` 下的所有文件**不允许 import 任何 `app/`(React 层)或 `DOM API**(`document`、`window`、`SVG`、React 等)
- 引擎将来会搬到服务器上跑,任何 DOM/React 耦合都会阻断联机化
- ✅ 正确:`import type { Player } from "./types"`
- ❌ 错误:`import { useGameStore } from "../app/store/gameStore"`

### 2. GameEngine 必须 player-agnostic(不认识"本地玩家")
- 引擎只知道 `activeIndex`(轮到谁),不关心"谁在这个屏幕前"
- **不要**在引擎里写 `if (player.isLocal)` 之类的逻辑
- 所有玩家操作通过公共方法提交(`submitCommand`),引擎不区分命令来自本地点击还是网络

### 3. 所有状态变更走引擎公共方法,不直接改属性
- ✅ `engine.buyProperty()`
- ❌ `player.cash -= 200`(UI 层直接改引擎内部状态)
- 这保证将来服务器可以审计/序列化每一次操作

### 4. LocalController 是单机专用层
- `src/app/controllers/local.ts` 服务单机模式(恰 1 真人 + 电脑):假设"活跃人类玩家就在这个屏幕前"
- 联机走 `src/app/controllers/online.ts`(WS 发命令 / 收快照重 hydrate 只读引擎);两者共享 `controller.ts` 的 `GameController` 基类(状态桥:引擎变化后 `syncFromEngine` 灌 zustand store)
- **不要在 controller 里加新的引擎假设**;如果需要引擎做新事,先在引擎加方法,controller 只调用

### 5. 序列化友好
- 所有需要同步的状态必须可序列化(无函数、无循环引用、无 DOM 引用)
- `engine.snapshot()` 已提供完整状态序列化,联机时直接作为广播数据包

## 技术栈
- 构建:Vite (TypeScript strict)
- 渲染:React 19 + zustand + Tailwind CSS v4(token 由 `core/theme.ts` 单源生成:`npm run gen:theme`)
- 测试:Vitest(单元) + Playwright(e2e)
- 地图数据:`public/maps/sanguo.json`(运行时 fetch)
- 部署:Tauri 2(Android APK,横屏,框架已搭未实测)

## 关键文件
| 文件 | 职责 |
|---|---|
| `src/core/game.ts` | GameEngine:回合状态机、胜负、日志、珍宝、名士、委任状 |
| `src/core/types.ts` | 所有核心类型定义(TurnPhase、Player、HeroDef 等) |
| `src/core/board.ts` | 棋盘:主路环、辅路、computePath(含必停都城) |
| `src/core/economy.ts` | 地产交易:购买、升级、破产裁决(本作无传统租金机制,落他人城走珍宝交涉) |
| `src/core/bot.ts` | AI 决策(Simple/Normal 两档) |
| `src/core/heroes.ts` | 名士数据表(数据驱动,新增名士只改此文件) |
| `src/core/treasures.ts` | 珍宝数据表 + 牌堆(数据驱动,新增珍宝只改此文件) |
| `src/core/constants.ts` | 全局共享常量(委任状/都城补偿/签面等) |
| `src/core/theme.ts` | 配色 Theme 对象(单源)。Tailwind token 由 `npm run gen:theme` 从此生成 `src/app/styles/tokens.css`,不再人工同步 |
| `src/app/main.tsx` | React 入口(createRoot + StrictMode + `installDebugHooks`) |
| `src/app/store/gameStore.ts` | zustand 全局态:引擎 snapshot + UI 态(viewSeat/interactive/screen 等) |
| `src/app/store/netStore.ts` | 联机房间/座位态(lobby 广播灌入) |
| `src/app/controllers/` | `controller.ts` 基类(状态桥)+ `local.ts` 单机 + `online.ts` 联机 + `registry.ts` 单例注册表 |
| `src/app/components/board/` | SVG 棋盘(Tile/TokenLayer/StaticLayers)+ usePanZoom 缩放平移 |
| `src/app/screens/` | setup / lobby / game / editor 四屏(各屏自带 testids.ts) |
| `src/app/fx/` | 表现层:骰子(ThreeDice 3D 物理骰)、行军、浮字、横幅、印章、音效(orchestrator.ts 编排时序) |
| `scripts/cli.ts` | 纯 CLI(每命令一进程,state.json 持久,AI 可完整测试对局) |
| `scripts/server.ts` | 权威引擎服务(联机化完成态:多房间 WebSocket + REST 大厅 + 静态托管 dist/ + 落盘恢复) |
| `scripts/room.ts` | 房间编排(座位/接管/bot 驱动/host 移交/纯视图),零 WS 依赖 |
| `scripts/room-persistence.ts` | 房间持久化适配器(FileRoomPersistence,可注入 InMemory 测试) |
| `scripts/engine-helpers.ts` | CLI/Server 共享层(地图加载/序列化/状态摘要/bot 自动驱动) |

## 游戏机制速查

> 完整规则与数值表见 [`RULES.md`](./RULES.md)(以 `src/core/` 代码为权威)。本段为 AI 快速参考的速查卡。

- **签筒**:单骰 1-6(不使用双骰,移动距离短便于追踪)
- **货币**:白银制,1锭=100两=10000分(内部 cash 为"分")。**身价=仅现金**(珍宝/城池账面均不计;购地直接降身价,逼玩家管现金流)
- **委任状**:起手3,+2/圈(过都城),买城耗1,扩军不耗
- **名士**:起手0,过都城/卧龙岗招贤纳士(三选一),上限3,被动技能
- **都城**:经过时弹抉择——驻跸(停都城拿补给+委任+招贤,结束回合)或继续行军到落点;巡幸都城(经过即触发)+2 委任状
- **珍宝**:牌堆固定数量,等级 1-10 决定指导价;获得途径:① 落无主宝物城(TreasureCity)**拼点**(双骰 2-12)≥ 等级即得,② 落他人城且城主有宝时触发珍宝交涉
- **珍宝交涉**(他人城):城主抉择——**公道买卖**(访客付指导价得宝,银两给城主,玩家间流转) / **坐地起价**(访客付指导价×城池加价[tradeMult/tradeAdd]得宝) / 不交易;访客不可拒
- **城池等级**:0-3(maxLevel=3),扩军升级,满级后不可再升
- **分岔辅路**:主路仍是单环;另有一条辅路(起点/终点都接主路)。默认走主路,只有**刚好落到辅路起点**才弹抉择「入辅路/走大路」。进辅路后**逐格掷骰**沿辅路格推进(每格触发:treasure 拼点探宝 / event 锦囊事件 / penalty 中伏跳一回合),到终点汇入主路继续。辅路入口抉择复用 `AwaitingBranch` 阶段与 `selectBranch`(语义改 Main|Branch)。
- **破产清算**:现金不足付款且有可变卖资产 → 变卖自救(珍宝按指导价、城按购入价、名士换 200 分);凑够债务免破产继续,凑不够才破产(资产转债主、名士释放回招贤池)
- **回合**:所有人各行动一次=1轮(engine.round,为冷却技能预留)

## 验证命令
```bash
npm run build      # tsc --noEmit && vite build
npm test           # 单元测试(Vitest)
npm run test:e2e   # e2e(Playwright,需先 npm run build)
npm run preview    # 本地预览(http://localhost:4173)
npm run serve      # 权威引擎 HTTP 服务(http://127.0.0.1:3000,env: PORT/HOST/STATE_FILE)
npm run typecheck:scripts  # 类型检查 scripts/(CLI + server,主 build 不含)
npx tsx scripts/cli.ts <command>  # 纯 CLI 测试(与 server 共用 state.json 格式)
```

## 联机化进度(终局目标)
- **第 1 步(已完成)**:`scripts/server.ts` 常驻引擎 + 共享层(`engine-helpers.ts`)。`snapshot()`/`restoreFromSnapshot()` 全状态可序列化。
- **第 2 步(已完成)**:多房间 WebSocket 服务 + 浏览器联机客户端 ——
  - 服务器:`scripts/server.ts`(瘦传输层)+ `scripts/room.ts`(房间编排)+ `scripts/room-persistence.ts`(落盘适配器)。REST 大厅 `/room/new|join|start|takeover|dismiss`、WS `/ws?room=&seat=&token=`、seatToken 鉴权、掉线冻结 + 房主解散/bot 接管 + 房主掉线身份移交、`rooms/<id>.json` 每手落盘 + 启动恢复、同进程静态托管 `dist/`。env:`PORT`(3000)/`HOST`(127.0.0.1,局域网需 0.0.0.0)/`ROOMS_DIR`/`STATIC_DIR`。
  - 客户端:`src/app/controllers/online.ts`(OnlineController:WS 发 GameCommand、收 snapshot 用 `restoreFromSnapshot` 重 hydrate 只读引擎后灌 store)+ setup 屏联机入口 / `?online=1` 直链;`serverUrl = location.origin`(服务器自托管网页,同源免填)。
  - 已验:多客户端 e2e(`e2e/online-multi.spec.ts` 181 步完整对局)。
- **第 3 步(待做)**:CLI 改 fetch server(弃本地 state.json)。部署真机验收(部署 runbook 见 `docs/multiplayer.md`,VPS + Caddy + systemd)。

## 联机测试基础设施
- **多客户端 e2e**:`e2e/multi-helpers.ts` 提供 `createClients(browser, n, opts)` / `actIfCan(page)` / `driveToGameOver(clients)` / `playRounds(clients, n)` / `assertSync(a, b)`。
- **模式**:N 个独立 browser context(= N 台设备)同房,走真实 UI(非 REST 旁路);`actIfCan` 驱动活跃方(掷骰/内嵌/卷轴),循环到终局 + 同步断言。
- **调试钩子**:registry.ts 的 `installDebugHooks` 暴露 `window.__dafung`(getEngine/setEngine/snapshot/sync/controller),卡死时可手动重灌快照排查。
- **用法**:
  ```ts
  const { clients } = await createClients(browser, 2, { target: 3000 });
  const { winner } = await driveToGameOver(clients);           // 完整对局到终局
  // 场景测试:await playRounds(clients, 5); await clients[1].close(); // 测掉线/接管
  ```
- 跑:`npm run test:e2e`(含 `e2e/online-multi.spec.ts`)。

## Agent skills

### Issue tracker

本地 markdown:issue/spec 存 `.scratch/<feature>/`(spec.md + issues/NN-slug.md)。见 `docs/agents/issue-tracker.md`。

### Triage labels

默认五标签(needs-triage / needs-info / ready-for-agent / ready-for-human / wontfix)。见 `docs/agents/triage-labels.md`。

### Domain docs

单上下文:`CONTEXT.md`(根)+ `docs/adr/`。见 `docs/agents/domain.md`。
