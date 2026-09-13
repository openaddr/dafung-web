# dafung-web — 群雄逐鹿(三国大富翁)

## 项目概况
TypeScript + Vite + React 的三国主题大富翁桌游。两种对局形态:**单机模式**(1 真人对阵电脑)与**联机模式**(每人一台设备,WebSocket 同步)。早期为本地热座(单设备多真人轮流),已移除。锦囊牌系统(#122)已实装:全游戏唯一隐藏信息(暗置手牌、回合开始主动使用),设计视角见 `docs/explanation/锦囊设计.md`。

**项目性质(影响所有设计决策)**:个人项目,朋友圈子自用。**不考虑任何向前/向后兼容性**——不需要担心用户升级、旧版本数据迁移、API 兼容。只要当前版本能跑就行,需要重构就直接改。分析问题时不要把"兼容性""迁移"当作理由,除非用户明确要求。

**零兜底原则(用户钦定,全项目贯穿)**:**禁止一切兜底/容错性保护措施**。代码简洁与可扩展性绝对优先;出了问题就让问题暴露出来,那是发现了 bug,修就是了——静默兜底只会掩盖问题、助长屎山。具体红线:

- **禁止硬编码默认值兜底**:地图等一切可配置/可插拔的东西,唯一事实源是配置本身(如默认地图 = `maps/index.json` 首项,`getDefaultMapId()` 清单空直接抛错)。配置损坏 → 抛错,不回退到"某个写死的值"。
- **禁止 `catch {}` 吞错**:空的或只写注释的 catch 块一律不允许。要么处理(显式提示用户),要么让它抛。`??`/`?.` 链式兜底同样审视:数据缺失是 bug,不是"回退一下就过去了"。
- **禁止"理论上到不了"式的防御分支**:不要为不可能的状态写保护代码;真到了就是求解逻辑有 bug,应该崩出来。
- **个人项目不需要防御性编程**:隐私模式、超限、损坏输入等极端场景不做静默保护,让异常自然抛出,帮助提前发现问题。
- 例外(允许存在):①显式向用户报错的 catch(UI setError/pushHint 展示失败原因);②纯 UI 的空态展示(如"暂无可用地图")——那是正常业务态,不是兜底。

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

### 6. UI 组件必须收口 shadcn/Base UI(2026-09 定「优先」;同日验收升级「必须」,地图 #152/#157)
- **每次新增/重构交互类 UI 组件(弹层、下拉、确认框、表单控件、popover 等),必须 `bunx shadcn add <component>` 取 shadcn 版为底**(无头行为层:焦点陷阱/ARIA/键盘导航,零成本白拿;原语库 2026-09-12 定 **Base UI**——shadcn 新项目默认,Radix 转维护,见地图 #152/#158),再套本项目水墨皮;不要手搓交互语义。基建已就位:`components.json` + `@app/utils/cn` + `src/app/components/ui/dialog.tsx`(已改皮,后续 CLI 更新时 diff 保留皮差异)
- shadcn 的 CSS 变量(`--background` 等)在 `app.css` 桥接层引用 gen:theme 产出的 `--color-*` token——**单源仍是 `core/theme.ts`**,不得在组件里硬编码 shadcn 默认色,也不得把 shadcn 变量当第二个事实源
- 两条豁免:①纯视觉/器物件(棋盘 SVG、卷轴装饰、画像卡)不在此列;②器物级自定义皮肤(如游戏卷轴 `ScrollShell`)可直接用无头原语自行组皮,但行为口径(焦点陷阱/Esc/点外关闭)必须与 ui/ 底件一致;Base UI 无独立 FocusScope(#158),焦点陷阱由 shared/DialogFocusScope 自研原语承担(全仓唯一特许的自写交互语义集中点, radix 依赖已清零);**卷轴/弹层挂载不夺焦**(FocusScope onMountAutoFocus 恒 preventDefault——首焦点若落在 × 关闭钮会促成 Enter 误关),新弹层沿用此口径;
  ③手写交互语义(自写焦点陷阱、自绘遮罩开关、裸 role)在附表之外的交互组件上一律打回。

- **附表(2026-09-12 定稿,来源 #155 全景盘点;新组件对号入座,不逐案重议)**:
  - 已收口(走 ui/ 底件或 FocusScope 惯用法):ConfirmDialog、MapSelectPanel、VictoryScreen、ScrollShell(内联焦点陷阱,shared/DialogFocusScope 自研原语)、ui/dialog 底件
  - 保留现实现(语义达标,动到时才评估收口):SegmentedSelect、Stepper、决策/详情卷轴族、HandPanel、TreasuryPanel、HomeScreen、LobbyScreen、GameScreen、CollapsedRail、WaitingBar
  - 器物豁免(永久):棋盘 Tile/BoardView、TokenLayer/StaticLayers、FxLayer、DiceOverlay、AudioProvider、纯展示件(OthersPanel);遗留评估:#214(3D 棋盘 a11y)

## 完成定义(Definition of Done)

改动**玩家可见机制**(新增/修改相位、数值、牌、事件、地图字段、操作流程)时,除代码与测试外,**同一 PR 内**必须:

- [ ] 回填 `docs/reference/rules/` 对应规则页(数值带符号名锚点,禁写行号)
- [ ] 新术语登记 `CONTEXT.md`
- [ ] README 文档地图与受影响文档链接有效(全仓库无死链)

## 文档风格规约(2026-09-12 定,随 Diátaxis 重构生效)

1. **受众**:文档玩家优先,贡献者次之;agent 无专属章节——agent 读玩家文档,理解力缺口用代码注释补
2. **how-to 动宾式标题**(「部署服务器」而非「服务器部署」);tutorials 收敛为单篇「新手第一局」
3. **数值表只做索引 + 代码锚点**,不复制数值造第二事实源;活文档禁写行号(写符号名,行号必漂移)
4. **README 主 CTA(openaddr.cn 即开即玩)置顶**,开发内容全部下沉 how-to/
5. **全中文**;入口文件英文命名(README/AGENTS/LICENSE/CONTEXT),深层文档中文文件名,ADR 英文命名不变
6. **发版走 git tag + GitHub Releases**(notes 用玩家视角短句,重大版本链叙事说明),不建 CHANGELOG.md

## 技术栈
- 构建:Vite (TypeScript strict)
- 渲染:React 19 + zustand + Tailwind CSS v4(token 由 `core/theme.ts` 单源生成:`bun run gen:theme`)
- 测试:Bun test(单元) + Playwright(e2e)
- 地图数据:`public/maps/`(运行时 fetch;默认地图 = index.json 首项,现「棋盘天下」chessboard.json)
- 部署:Tauri 2(Android APK,横屏,框架已搭未实测)

## 关键文件
| 文件 | 职责 |
|---|---|
| `src/core/game.ts` | GameEngine:回合状态机、胜负、日志、珍宝、名士、委任状 |
| `src/core/types.ts` | 所有核心类型定义(TurnPhase、Player、TriggerSkill/HeroDef 等) |
| `src/core/timing.ts` | 时机总线:GameMoment 时机定义 + MOMENTS 集中注册表(时机框架,见 docs/explanation/时机框架.md) |
| `src/core/effects.ts` | 效果注册表:EFFECTS(EffectId → EffectFn),时机框架的「做什么」半边 |
| `src/core/choices.ts` | 决策相位选项集注册表(ADR-0013):每相位选项计算器(available+reason);≤1 真实选项引擎自动执行默认行为+浮字,bot/快照共用同一口径 |
| `src/core/board.ts` | 棋盘:主路环、辅路、computePath(含必停都城) |
| `src/core/economy.ts` | 地产交易:购买(即 Lv.0)、升级(免费)、破产裁决(落他人城走珍宝交涉,公道买卖成交才升级) |
| `src/core/bot.ts` | AI 决策(Simple/Normal 两档) |
| `src/core/heroes.ts` | 名士数据表(数据驱动,新增名士只改此文件) |
| `src/core/treasures.ts` | 珍宝数据表 + 牌堆(数据驱动,新增珍宝只改此文件) |
| `src/core/constants.ts` | 全局共享常量(委任状/都城补偿/签面等) |
| `src/core/theme.ts` | 配色 Theme 对象(单源)。Tailwind token 由 `bun run gen:theme` 从此生成 `src/app/styles/tokens.css`,不再人工同步 |
| `src/app/main.tsx` | React 入口(createRoot + StrictMode + `installDebugHooks`) |
| `src/app/store/gameStore.ts` | zustand 全局态:引擎 snapshot + UI 态(viewSeat/interactive/screen 等) |
| `src/app/store/netStore.ts` | 联机房间/座位态(lobby 广播灌入) |
| `src/app/controllers/` | `controller.ts` 基类(状态桥)+ `local.ts` 单机 + `online.ts` 联机 + `registry.ts` 单例注册表 |
| `src/app/components/board/` | SVG 棋盘(Tile/TokenLayer/StaticLayers)+ usePanZoom 缩放平移 |
| `src/app/screens/` | home(首页四入口)/ setup(单机配置)+ lobby / game / editor(各屏自带 testids.ts) |
| `src/app/fx/` | 表现层:骰子(ThreeDice 3D 物理骰)、行军、浮字、横幅、印章、音效(orchestrator.ts 编排时序) |
| `scripts/cli.ts` | 纯 CLI(每命令一进程,state.json 持久,AI 可完整测试对局) |
| `scripts/server.ts` | 权威引擎服务(联机化完成态:多房间 WebSocket + REST 大厅 + 静态托管 dist/ + 落盘恢复) |
| `scripts/room.ts` | 房间编排(座位/接管/bot 驱动/host 移交/纯视图),零 WS 依赖 |
| `scripts/room-persistence.ts` | 房间持久化适配器(FileRoomPersistence,可注入 InMemory 测试) |
| `scripts/replay-log.ts` | ADR-0014 对局日志重放校验:jsonl → 局头重建引擎 → cmd 流重放 → 终局行逐字段断言(用法见 docs/reference/对局日志.md) |
| `scripts/engine-helpers.ts` | CLI/Server 共享层(地图加载/序列化/状态摘要/bot 自动驱动) |

## 游戏机制速查

> 完整规则与数值总表见 [`docs/reference/rules/`](./docs/reference/rules/README.md)(以 `src/core/` 代码为权威)。本段为 AI 快速参考的速查卡。

- **签筒**:单骰 1-6(不使用双骰,移动距离短便于追踪)
- **选都三选一**:开局轮到某玩家时引擎滚出 3 候选城(`offeredCapitals`,随 rngState 序列化→联机/恢复一致),只能从中选;候选按建价低/中/高三档各一 + 最远点采样分散地理;跨玩家候选不重复(小地图不足时退化复用)
- **货币**:白银制,1锭=100两=10000分(内部 cash 为"分")。**身价=仅现金**(珍宝/城池账面均不计;购地直接降身价,逼玩家管现金流)。经济 v2:**目标身价 30000 分(300 两)/起手 10000 分(100 两)**(引擎与三张内置地图统一);城池 18~40 两七档加法城 + 30 两乘法城 6 座(成都/邺城/剑阁/街亭/华容道/合肥);都城补给/级按区域档 边陲 200/中庸 300/沃野 400(乘法城 300)
- **委任状**:起手3,+2/圈(过都城),买城耗1,扩军不耗
- **名士**:起手0,过都城/卧龙岗招贤纳士(三选一),上限3,被动技能
- **都城**:经过**必停**——路过自己都城(含落点非都城)即停,巡幸 +2 委任状 + 驻跸补给,结束回合(无「驻跸/继续」抉择,`AwaitingCapitalHalt` 相位已删);落点恰是都城同补给另触发招贤纳士
- **珍宝**:牌堆固定数量,等级 1-10 决定指导价(经济 v2:Lv1-10 = 1/2/3/4/6/8/12/16/22/30 两,查表缺项直接抛错);获得途径:① 落无主宝物城(TreasureCity)**拼点**(双骰 2-12)≥ 等级即得,② 落他人城且城主有宝时触发珍宝交涉
- **珍宝交涉**(他人城):城主抉择——**公道买卖**(访客付指导价得宝,银两给城主,玩家间流转;**成交则城池 +1 级**,满级封顶,买家事后破产退宝不回滚) / **坐地起价**(访客付指导价×城池加价[tradeMult/tradeAdd,下标=等级]得宝,不升级) / 不交易(不升级);访客不可拒;他人到达城池本身**不**升级
- **城池等级**:Lv.0-3 共 4 级(购入/建都即 Lv.0,maxLevel=3)。**本作无过路费/升级费**:自己到达己城可选免费扩军 +1 级;城池升级只挂在公道买卖成交路径上
- **决策选项集(ADR-0013)**:各决策相位(购地/扩军/交涉/择路/招贤/破产)的选项集中注册于 `src/core/choices.ts`(带 available/reason);除默认行为外可用选项为 0 → 引擎自动执行默认行为(战报+浮字轻提示),不弹卷轴——弹卷轴 ⇔ ≥2 真实选项;破产清算例外(重大不可逆仍弹);`engine.choicesFor()`/快照 `choices` 字段供 UI/bot/调试消费
- **分岔辅路**:主路仍是单环;另有一条辅路(起点/终点都接主路)。默认走主路,只有**刚好落到辅路起点**才弹抉择「入辅路/走大路」。选「入辅路」= **本回合结束**(棋子留在主路入口格,`onBranch={step:-1}` 表「待入辅路」);**下回合掷骰**沿辅路格推进——掷几点走几格(落第 die 格并触发该格效果:treasure 拼点探宝 / event 锦囊事件 / penalty 中伏跳一回合),掷满溢出从辅路终点汇入主路继续走剩余步数。辅路入口抉择复用 `AwaitingBranch` 阶段与 `selectBranch`(Main|Branch)。
- **破产清算**:现金不足付款且有可变卖资产 → 变卖自救(珍宝按指导价、城按当前等级价值 valueByLevel、名士换 200 分);**凑足即止**——现金≥债务后引擎硬拒绝继续变卖(`assertStillOwing`,不靠 UI 禁用自觉);凑够债务免破产继续,凑不够才破产(资产转债主、名士释放回招贤池)
- **回合**:所有人各行动一次=1轮(engine.round,为冷却技能预留)
- **对局日志(ADR-0014)**:一局一个 jsonl = 局头(header:gameId/mapId/seed/座位表)+ 玩法事件流(中文 brief + 机读 detail)+ 命令流(cmd:submitCommand 与人类 pickCapital 全量;bot 路径不记,重放自动重算)+ 终局行(final:重放断言锚点)。双轨落盘:联机 `logs/<gameId>.jsonl`(server 启动清扫 TTL 30 天,env LOG_TTL_DAYS/LOGS_DIR)、单机 IndexedDB(dafung-logs,写入时顺手清过期);`bun scripts/replay-log.ts logs/x.jsonl` 重放校验终态一致。详见 docs/reference/对局日志.md
- **时机框架**:技能=数据声明(when 时机+effect 效果+params 参数)挂 `HeroDef.skills`,派发器 `engine.dispatchMoment` 按「座位序×技能序」确定性派发。**26 时机七类**(生命周期/回合与轮/掷骰与行军/落格与路径/资产与交易/玩家状态/破产与终局结算),挂点全在 game.ts;**设计技能/事件先翻 docs/explanation/时机框架.md §2 分类目录**(每时机:触发点位/subject/ctx 字段/灵感示例)。加效果一步(effects.ts)/加技能两步(heroes.ts)/加时机三步(timing.ts+game.ts);效果内禁同步再派发时机(派发深度>2 抛错);CashGained 防连锁——仅经济结算点派发,效果层收益(grantSkillCash)不递归触发

## 机遇系统配置(#125)

- **默认文件**:`public/config/jiyu.json`(静态资源,运行时 fetch;JSON 无注释,口径说明在此与设置屏文案)。引擎本身缺省 `triggerRate=0`(机遇关闭),产品默认由本文件提供
- **字段**:`triggerRate` = 落格触发概率 %(默认 40);`baseRates.good / neutral / bad` = 好运/中性/霉运三档基准(默认 30/45/25)
- **归一规则**:三档按占比归一,**和不必为 100**(如 10/10/10 → 各 1/3);任一档 ≤0 或非数 → 引擎整体回退默认 30/45/25;触发率夹紧 0~100。归一/回退单源在引擎 `resolveEncounterConfig`(`src/core/encounters.ts`),设置屏只透传原值
- **单局覆盖**:单机「起兵」屏「机遇」折叠区可对本局改这四个值(默认值即读自 jiyu.json,fetch 失败回退与文件同值的内置默认),经 `SetupConfig.encounter` → `EngineConfig.encounter` 传入引擎,只影响当局

## 验证命令
```bash
bun run build      # tsc --noEmit && vite build
bun test           # 单元测试(bun:test,275 项)
bun run test:e2e   # e2e(Playwright,需先 bun run build)
bun run preview    # 本地预览(http://localhost:4173)
bun run serve      # 权威引擎 HTTP 服务(http://127.0.0.1:3000,env: PORT/HOST/STATE_FILE)
bun run typecheck:scripts  # 类型检查 scripts/(CLI + server,主 build 不含)
bun scripts/cli.ts <command>    # 纯 CLI 测试(与 server 共用 state.json 格式)
```

### 本地 e2e 跑法

- `E2E_WORKERS=2 bun run test:e2e`——默认 workers 在本机因 CPU 超载会成片超时,2 为实测稳态。
- `E2E_TIME_SCALE`(默认 `0.25`):e2e 时间倍率,由 `e2e/fixtures.ts` 在页面加载前写入 localStorage 键(键名单源:`src/app/fx/timings.ts` 的 `E2E_TIME_SCALE_KEY`),加速骰子/横幅/行军等演出编排;设 `E2E_TIME_SCALE=1` 回退全速。仅测试注入,生产/真人局无此键零感知。

## 联机化进度(终局目标)
- **第 1 步(已完成)**:`scripts/server.ts` 常驻引擎 + 共享层(`engine-helpers.ts`)。`snapshot()`/`restoreFromSnapshot()` 全状态可序列化。
- **第 2 步(已完成)**:多房间 WebSocket 服务 + 浏览器联机客户端 ——
  - 服务器:`scripts/server.ts`(瘦传输层)+ `scripts/room.ts`(房间编排)+ `scripts/room-persistence.ts`(落盘适配器)。REST 大厅 `/room/new|join|start|takeover|dismiss`、WS `/ws?room=&seat=&token=`、seatToken 鉴权、掉线冻结 + 房主解散/bot 接管 + 房主掉线身份移交、`rooms/<id>.json` 每手落盘 + 启动恢复、同进程静态托管 `dist/`。env:`PORT`(3000)/`HOST`(0.0.0.0,默认监听所有网卡)/`ROOMS_DIR`/`STATIC_DIR`/`JIYU_CONFIG`/`DECISION_TIMEOUT_MS`(120000,0=关)/`LOGS_DIR`/`LOG_TTL_DAYS`(30)。
  - 客户端:`src/app/controllers/online.ts`(OnlineController:WS 发 GameCommand、收 snapshot 用 `restoreFromSnapshot` 重 hydrate 只读引擎后灌 store)+ setup 屏联机入口 / `?online=1` 直链;`serverUrl = location.origin`(服务器自托管网页,同源免填)。
  - 已验:多客户端 e2e(`e2e/react-online.spec.ts` 双端同步全流程,断线重连在 `react-resilience.spec.ts`)。
- **第 3 步(待做)**:CLI 改 fetch server(弃本地 state.json)。部署真机验收(部署 runbook 见 `docs/how-to/部署服务器.md`)。

## 联机测试基础设施
- **多客户端 e2e**:`e2e/react-online.spec.ts` / `react-online-autopilot.spec.ts` / `react-resilience.spec.ts`,共享工具 `e2e/react-helpers.ts`(quickStart / pickCapital / snap / waitForSnapChanged / waitForEngine)。
- **模式**:N 个独立 browser context(= N 台设备)同房,走真实 UI(非 REST 旁路);固定等待全部改状态轮询(waitForSnapChanged/expect.poll),慢速托管窗 240s。
- **调试钩子**:registry.ts 的 `installDebugHooks` 暴露 `window.__dafung`(getEngine/setEngine/snapshot/sync/controller),卡死时可手动重灌快照排查。
- 跑:`bun run test:e2e`(10 个 react-*.spec,37 用例)。

## Agent skills

### Issue tracker

GitHub Issues(`openaddr/dafung-web`;gh 未认证时走 token+REST 等效通路)。见 `docs/agents/issue-tracker.md`。

### Triage labels

默认五标签(needs-triage / needs-info / ready-for-agent / ready-for-human / wontfix)。见 `docs/agents/triage-labels.md`。

### Domain docs

单上下文:`CONTEXT.md`(根)+ `docs/adr/`。见 `docs/agents/domain.md`。

### Coverage audit

覆盖率体检(刻意低频,守基线不刷数字):`bun test --coverage`,重点只看 `src/core/`;触发时机与判读口径见 `.agents/skills/coverage-audit/SKILL.md`,台账在 `docs/reference/覆盖率台账.md`。不进 CI、不设阈值。
