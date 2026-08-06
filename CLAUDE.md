# dafung-web — 群雄逐鹿(三国大富翁)

## 项目概况
TypeScript + Vite 的纯 DOM/SVG 三国主题大富翁桌游。当前为**本地热座模式**(单设备多人轮流操作),**终局目标是联机模式**(每人一台设备,WebSocket 同步)。

## 架构红线(所有代码改动必须遵守)

### 1. core/ = 纯游戏逻辑,零 DOM 依赖
- `src/core/` 下的所有文件**不允许 import 任何 `render/` 或 `DOM API**(`document`、`window`、`SVG` 等)
- 引擎将来会搬到服务器上跑,任何 DOM 耦合都会阻断联机化
- ✅ 正确:`import type { Player } from "./types"`
- ❌ 错误:`import { svg } from "../render/dom"`

### 2. GameEngine 必须 player-agnostic(不认识"本地玩家")
- 引擎只知道 `activeIndex`(轮到谁),不关心"谁在这个屏幕前"
- **不要**在引擎里写 `if (player.isLocal)` 之类的逻辑
- 所有玩家操作通过公共方法提交(`submitCommand`),引擎不区分命令来自本地点击还是网络

### 3. 所有状态变更走引擎公共方法,不直接改属性
- ✅ `engine.buyProperty()`
- ❌ `player.cash -= 200`(UI 层直接改引擎内部状态)
- 这保证将来服务器可以审计/序列化每一次操作

### 4. state.ts 是热座专用层,将来会重写
- `src/render/state.ts` 的 `App` 类假设"活跃玩家就在这个屏幕前"
- 将来联机时,这个文件会拆成 `network-client.ts`(发命令/收快照)+ 保留的本地渲染逻辑
- **不要在 state.ts 里加新的引擎假设**;如果需要引擎做新事,先在引擎加方法,state.ts 只调用

### 5. 序列化友好
- 所有需要同步的状态必须可序列化(无函数、无循环引用、无 DOM 引用)
- `engine.snapshot()` 已提供完整状态序列化,联机时直接作为广播数据包

## 技术栈
- 构建:Vite (TypeScript strict)
- 渲染:纯 DOM + SVG(无 React/Vue)
- 测试:Vitest(单元) + Playwright(e2e)
- 地图数据:`public/maps/sanguo.json`(运行时 fetch)
- 部署:Tauri 2(Android APK,横屏,框架已搭未实测)

## 关键文件
| 文件 | 职责 |
|---|---|
| `src/core/game.ts` | GameEngine:回合状态机、胜负、日志、珍宝、名士、委任状 |
| `src/core/types.ts` | 所有核心类型定义(TurnPhase、Player、HeroDef 等) |
| `src/core/board.ts` | 棋盘:主路环、辅路、computePath(含必停都城) |
| `src/core/economy.ts` | 地产交易:购买、升级、租金计算 |
| `src/core/bot.ts` | AI 决策(Simple/Normal 两档) |
| `src/core/heroes.ts` | 名士数据表(数据驱动,新增名士只改此文件) |
| `src/core/treasures.ts` | 珍宝数据表 + 牌堆(数据驱动,新增珍宝只改此文件) |
| `src/core/constants.ts` | 全局共享常量(委任状/都城补偿/签面等) |
| `src/core/theme.ts` | 配色 Theme 对象(SVG/Canvas 用)。**hex 字面量须与 `src/render/style.css` :root 人工同步**——core 零 DOM,不能编译期校验 |
| `src/render/state.ts` | App 控制器(热座专用,将来重写) |
| `src/render/board.ts` | SVG 棋盘渲染 + 缩放平移 |
| `src/render/ui.ts` | 布局/侧栏/弹窗/设置屏 |
| `src/render/animate.ts` | 骰子/行军/横幅/浮动金额/印章动画 |
| `scripts/cli.ts` | 纯 CLI(每命令一进程,state.json 持久,AI 可完整测试对局) |
| `scripts/server.ts` | 权威引擎 HTTP 服务(联机化第 1 步:内存常驻引擎 + REST + 落盘) |
| `scripts/engine-helpers.ts` | CLI/Server 共享层(地图加载/序列化/状态摘要/bot 自动驱动) |

## 游戏机制速查
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
- **第 1 步(已完成)**:`scripts/server.ts` —— Node 常驻引擎,REST 接口(`/new` `/cmd` `/auto` `/bot-step` `/status` `/log` `/board` `/full`),落 `state.json` 与 CLI 互换。CORS 已开,供浏览器直连。
- **第 2 步(待做)**:`src/render/state.ts` → `network-client` —— 浏览器 fetch server 发 `submitCommand` + 收 snapshot 渲染(CLAUDE.md 红线 4 已预留)。
- **第 3 步(待做)**:CLI 连 server —— 不再用本地 state.json,改为 fetch server。

## 联机测试基础设施
- **多客户端 e2e**:`e2e/multi-helpers.ts` 提供 `createClients(browser, n, opts)` / `actIfCan(page)` / `driveToGameOver(clients)` / `playRounds(clients, n)` / `assertSync(a, b)`。
- **模式**:N 个独立 browser context(= N 台设备)同房,走真实 UI(非 REST 旁路);`actIfCan` 驱动活跃方(掷骰/内嵌/卷轴),循环到终局 + 同步断言。
- **调试钩子**:network-client 暴露 `window.__dafung`(engine/seat/busy/snapshot),卡死时自动 dump 诊断。
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
