# dafung-web — 群雄逐鹿(三国大富翁)

TypeScript + Vite + React 的三国主题大富翁:**权威引擎**(`src/core/`,纯逻辑、可上服务器)+ **瘦客户端**(`src/app/`)。单机(1 真人对 AI)与联机(人手一设备,WebSocket 同步)。**交付形态=安卓 APK**(Tauri 打包,唯一正式输出件);网页构建只作开发和用户明确要求的单次排查通道,一切视觉/回归验收按移动端横屏 844×390。个人项目,朋友圈子自用,**不考虑任何向前/向后兼容性**——需要重构直接改,别把「兼容」「迁移」当理由。

**本文件是路由与红线,不当事实源**(内容分级纪律见 [ADR-0033](./docs/adr/0033-agents-content-tiering.md)):细节在下述文档里,按需读。**开工第一步看第一章:任何改动先开工作区,不直接改主树。**

## 版本协作(jj;硬纪律:先开工作区,再改任何东西)

jj-vcs(colocated),多会话并行是常态、主树工作副本只有一份。五条铁律;配方与命令速查唯一事实源=[开发与测试](./docs/how-to/开发与测试.md)「版本协作」节:

1. **任何写盘改动(不分体量)开工前先 `jj workspace add ../dafung-web-ws-<代号>`**(建仓/起基/install/e2e 配方见 how-to 同节「jj workspace 通道」);落盘路径一律 workspace 绝对路径(shell cwd 每命令重置);主树 @ 只读停靠、永不留活(唯一例外:`pr-merge.ts` 收口尾步前移主树空 @);@ 有别人的活=让出走 workspace。
2. **交付**=`jj describe` → 书签 → `jj git push --bookmark` + PR;master 受保护(禁直推/禁 merge commit,一律 PR+squash);workspace 谁建谁清。
3. **文件集自查两拍**:落盘后立即一拍、push 前一拍(`jj diff --stat` 对账,多出=折入先拆);收口走 `pr-merge.ts --expect <路径>` 硬闸(配方见 how-to 同节)。
4. **收账**由 pr-merge 尾步自动做(fetch+move+空 @ 前移);手动通路见 how-to 同节。
5. **里程碑快照**:写盘改动每里程碑 `jj st` 落一次快照——jj 只在命令时快照,未快照写盘随 workspace 被清不可恢复;恢复配方与清扫验活见 how-to 同节。

## 事实源地图

| 要什么                                      | 去哪                                                                                                                              |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 游戏规则与数值(权威以 `src/core/` 代码为准) | [docs/reference/rules/](./docs/reference/rules/README.md)(十页导览,数值总表第 10 页)                                              |
| 领域词汇(定名与弃用名)                      | [GLOSSARY.md](./GLOSSARY.md)                                                                                                      |
| 代码文件职责速查                            | [docs/reference/代码地图.md](./docs/reference/代码地图.md)                                                                        |
| 设计决策存档                                | docs/adr/                                                                                                                         |
| 视觉/交互设计(改 UI 前必读)                 | [DESIGN.md](./docs/design/DESIGN.md) + [BRIEF.md](./docs/design/BRIEF.md)                                                         |
| 交互组件收口附表(shadcn/Base UI)            | [docs/design/组件收口.md](./docs/design/组件收口.md)                                                                              |
| 命令清单与测试跑法(单一事实源)              | [docs/how-to/开发与测试.md](./docs/how-to/开发与测试.md)                                                                          |
| 联机架构 / 部署 / 对局日志                  | [联机架构](./docs/explanation/联机架构.md) · [部署服务器](./docs/how-to/部署服务器.md) · [对局日志](./docs/reference/对局日志.md) |
| 联机框架评估与借东西清单(动工前查)          | [docs/reference/参考仓索引.md](./docs/reference/参考仓索引.md)                                                                    |
| 派单纪律与模板                              | [docs/agents/派单模板.md](./docs/agents/派单模板.md)                                                                              |
| 机遇系统配置(`public/config/jiyu.json`)     | rules 第 07 页[声望与机遇](./docs/reference/rules/07-声望与机遇.md)                                                               |

## 零兜底原则(全项目贯穿)

**禁止一切兜底/容错性保护措施**:出了问题就让问题暴露——那是发现了 bug,修就是了;静默兜底只会掩盖问题、助长屎山。

- 禁止硬编码默认值兜底:可配置/可插拔的东西唯一事实源是配置本身(如默认地图 = `maps/index.json` 首项,清单空直接抛错)。
- 禁止 `catch {}` 吞错;`??`/`?.` 链式兜底同样审视——数据缺失是 bug,不是「回退一下就过去了」。
- 禁止「理论上到不了」式防御分支与极端场景静默保护;真到了就是求解逻辑有 bug,应该崩出来。
- 例外:①显式向用户报错的 catch(UI setError/pushHint);②纯 UI 空态展示(如「暂无可用地图」)——正常业务态,不是兜底。

## 统一原则(全项目贯穿,#927 拍板)

**能一套就不做两套**:玩家可见的演出、节奏与机制,对人类/bot、单机/联机一律同一套参数与形制;只有语义不同(事件种类不同,如拼点≠行军)才允许形制不同,禁止按玩家身份或运行模式分参数档。

## 架构红线(所有代码改动必须遵守)

1. **`src/core/` 零 DOM 依赖**:不 import 任何 `app/`(React 层)或 DOM API——引擎将来上服务器,任何耦合都阻断联机化。✅ `import type { Player } from "./types"`;❌ `import { useGameStore } from "../app/store/gameStore"`。
2. **GameEngine player-agnostic**:引擎只知道 `activeIndex`,不关心「谁在这个屏幕前」;不写 `if (player.isLocal)`。
3. **所有状态变更走引擎公共方法**(如 `engine.buyProperty()`),不直接改属性——保证服务器可审计/序列化每次操作。
4. **LocalController 是单机专用层**(假设活跃真人就在本屏前);联机走 `online.ts`;两者共享 `controller.ts` 基类。controller 不加引擎假设:引擎要做新事,先加引擎方法,controller 只调用。
5. **序列化友好**:需同步的状态无函数、无循环引用、无 DOM 引用;联机状态通路=引擎产出的类型化事件批(唯一状态下行,快照只作重连摘要与校准锚,ADR-0020)。
6. **交互类 UI 组件必须收口 shadcn/Base UI**(弹层/下拉/确认框/表单控件等取无头行为层、套水墨皮,不手搓交互语义);shadcn 变量经 `app.css` 桥接 gen:theme 产出的 `--color-*` token,**配色单源仍是 `core/theme.ts`**。附表与豁免见 [docs/design/组件收口.md](./docs/design/组件收口.md)。
7. **状态表达原则**(DESIGN §4.6):能用 UI 状态变化(边框/色彩/位移/光圈)标识的,不加文字标牌。
8. **模块治理(常设)**:源文件单一主题、文件名必须是具体领域词——笼统聚合桶(game/utils/helpers/types 式)禁止,词汇表 `_Avoid` 词不上文件名;引擎壳 `authority.ts` 的行数与内容禁区由 `scripts/check-core-purity.ts` 断言强制;拆分配方(机制域轴+自由函数+薄委托)见 [ADR-0019](./docs/adr/0019-module-governance-principle.md)。

## 完成定义(DoD)

改动**玩家可见机制**(相位、数值、牌、事件、地图字段、操作流程)时,除代码与测试外,**同一 PR 内**必须:

- [ ] 回填 `docs/reference/rules/` 对应规则页(数值带符号名锚点,禁写行号)
- [ ] 新术语登记 [GLOSSARY.md](./GLOSSARY.md)
- [ ] README 文档地图与受影响文档链接有效

## 文档风格规约

全中文,入口文件英文命名(深层文档中文文件名,ADR 英文);受众玩家优先;数值表只做索引 + 代码锚点,**不复制数值造第二事实源**(计数同理——用例数/时机数/文件数等一律指向不落数),活文档禁写行号;README 主 CTA 置顶,开发内容下沉 how-to/。发版走 git tag + GitHub Releases,不建 CHANGELOG;打 tag 前先 bump package.json 的 version(唯一版本源,CalVer 制式 YYYY.M.P、月份不补零,如 2026.10.0;tauri.conf.json 经路径引用它,APK/桌面包版本随之)。**发版时机:玩家可见变更(DoD 清单口径)合入 master 后,合并会话自动发版,不再等确认;纯文档/测试/脚本基建合并不触发,拿不准就发**——细则与防挤兑三闸见 how-to「发版时机」。

## 关键文件

各文件职责速查见 [docs/reference/代码地图.md](./docs/reference/代码地图.md)。三条高频路由常驻于此:

- 加名将/珍宝/机遇 = 只改 `core/` 三张数据表(`heroes.ts` / `treasures.ts` / `encounters.ts`);
- 改配色 = 单源 `core/theme.ts`,改后跑 `bun run gen:theme`,不手改 tokens.css;
- 测试与单次辅助的选择器 = 各屏 `testids.ts` 单源,勿硬编码字符串。

联机协议面五个单源(动协议前先看代码地图):`seat-projection.ts` / `wire.ts` / `event-batch.ts` / `room-record.ts` / `watchdogs.ts`。

## 开发陷阱速查(守门类;口径与数值一律查 [rules](./docs/reference/rules/README.md))

- 选都即迁城:**起点=各人自己的都城**,出生位 tile 0 仅选都期临时落位,勿当共同起点(「起」印已随 #620 退役);选都候选 `offeredCapitals` 随 rngState 序列化,联机/恢复必须一致。
- `AwaitingCapitalHalt` 相位已删勿复活:都城路过必停、结束回合,无「驻跸/继续」抉择。
- 机遇档位归一/回退**单源在 `core/encounters.ts`**;机遇必出(ADR-0035):引擎缺省 `enabled=false`(测试隔离),产品默认来自 jiyu.json。

## 验证纪律

命令与按需触发单源=[开发与测试](./docs/how-to/开发与测试.md);取舍见 [ADR-0065](./docs/adr/0065-test-economics-browser-retirement.md)。

- **日常定向、收口一次**:迭代只跑受影响的无浏览器测试;完成代码后执行一次完整默认池和构建。完整整局、故障与 CLI 慢例只在对应能力改动时定向运行,不自动按批次或发版跑全慢池。
- **常驻浏览器回归已退役**:不新增、不恢复;开发、PR、集成、发版均不跑。仅用户明确要求页面观察、截图对比或浏览器复现时执行单次辅助,不形成用例、不接入门槛。实现页面、改样式、修 bug 不自动授权浏览器操作。lint 的 `check:test-boundaries` 防止入口复活。
- **视觉与设备交互人工验收**:由用户在 APK 中检查;标准档为移动横屏 844×390。网页截图不替代真实手势、系统返回、键盘、后台恢复与原生保存。
- **测试宁缺毋滥**:新增先答守住什么、运行成本;普通展示、文案、样式与重复数值不补例。接线也属于无浏览器测试,仅守关键命令和状态通路。删除不要求等价迁移。
- **概率性不可靠例零容忍**:发现即删、默认删,不养台账;仅一两行确定性修复能根除且覆盖独有时保留。删例无需批准。
- **回归例**:每修一个真实 bug 配 1–3 个不修必挂的直接回归,先红再绿;体量与修动成比例,禁镜像实现。基建真火证据可在 PR 说明。
- **场景构造**:无浏览器测试与单次辅助均复用 `core/planter.ts` 具名种植件;字段构造不复活 force,引擎公共命令直接调用。
- **开工前 freshness**:每轮续作先 `bun run check:freshness`,过期先重定基。
- **PR 本地门槛**:lint 0 warning、fmt/check:fmt、build、`bun run test`;改 scripts 加 `typecheck:scripts`,core 行为加 `check:core`/`check:goldens`,棋盘源码加 `check:board`,局长/破产机制加 `check:sim-bench`,AGENTS 加 `check:agents-budget`。共享类型变更先 typecheck 盘点消费点。
- **杀进程先验名**:tasklist 验名,只杀本次拉起的进程;用户 VPN `aurora_slim` 永不清理。

## Agent 工作流

- Issue tracker:GitHub Issues(`openaddr/dafung-web`),细则见 [docs/agents/issue-tracker.md](./docs/agents/issue-tracker.md) 与 [triage-labels.md](./docs/agents/triage-labels.md);领域文档消费方式见 [docs/agents/domain.md](./docs/agents/domain.md)。
- **子代理派单前**先读 [docs/agents/派单模板.md](./docs/agents/派单模板.md)(五条纪律+模板+QC 检查单+jj 配方);浏览器辅助的授权边界见验证纪律。
- **规格票执行必调 `implement-spec`**:立完规格+实施票、要派工执行时,先显式调用该技能加载流程,再按本项目适配执行(jj workspace 串行替代每票独立 worktree、merger 职责归主线 QC、诊断权归主线,适配细则见[派单模板](./docs/agents/派单模板.md))——不许靠上一波的惯性走流程(2026-11-06 拍板)。
