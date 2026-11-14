# dafung-web — 群雄逐鹿(三国大富翁)

TypeScript + Vite + React 三国大富翁:**权威引擎** `src/core/`(纯逻辑、可上服务器)+ **瘦客户端** `src/app/`；支持单机人机对战与 WebSocket 联机。**正式交付为 Tauri 安卓 APK**，验收移动横屏 844×390；网页只作开发及明确请求的单次排查。**不考虑前后兼容，需要重构直接改。**

本文件只留红线与条件路由；配方、数值查声明单源，新增内容遵循 [ADR-0033](./docs/adr/0033-agents-content-tiering.md)。**任何改动先开工作区。**

## 版本协作(jj;硬纪律:先开工作区,再改任何东西)

配方单源：[开发与测试](./docs/how-to/开发与测试.md)「版本协作」。

1. **任何写盘先建 jj workspace**，落盘用 workspace 绝对路径，每命令固定 cwd。主树 @ 只读停靠；有别人的活即让出，唯一写入例外为 pr-merge 尾步前移空 @。
2. **交付**：describe → 书签 → push → PR；master 只经 PR+squash，禁直推、merge commit。workspace 谁建谁清。
3. **文件集两拍**：落盘后与 push 前各跑 `jj diff --stat`；混入先拆。收口必带 `pr-merge.ts --expect <路径>` 精确对账。
4. **收账**由 pr-merge 尾步完成；手动恢复按开发指南的触发条件执行。
5. **每个写盘里程碑跑 `jj st` 快照**，未快照内容不可恢复。

## 事实源地图

- 游戏规则与数值(权威=`src/core/`):[rules 十页](./docs/reference/rules/README.md)
- 领域词汇(定名与弃用名):[GLOSSARY.md](./GLOSSARY.md)
- 代码文件职责速查:[代码地图](./docs/reference/代码地图.md)
- 探索领域或变更决策前：[领域文档](./docs/agents/domain.md)、[docs/adr/](./docs/adr/)
- 视觉/交互设计(改 UI 前必读):[DESIGN.md](./docs/design/DESIGN.md)
- 文档风格与发版时机:[文档规约](./docs/how-to/文档规约.md)
- 联机架构:[联机架构](./docs/explanation/联机架构.md)
- 部署:[部署服务器](./docs/how-to/部署服务器.md)
- 对局日志:[对局日志](./docs/reference/对局日志.md)
- 联机框架工作前查:[参考仓索引](./docs/reference/参考仓索引.md)
- 机遇系统配置(`public/config/jiyu.json`):rules 第 07 页[声望与机遇](./docs/reference/rules/07-声望与机遇.md)

## 零兜底原则(全项目贯穿)

**缺失与错误直接暴露，禁止静默兜底/容错。**

- 禁硬编码默认值兜底:可配置项唯一事实源是配置本身(默认地图=`maps/index.json` 首项,清单空直接抛错)。
- 禁 `catch {}` 吞错;`??`/`?.` 链式兜底同审——数据缺失是 bug,不是回退借口。
- 禁「理论上到不了」式防御分支;真到了就是求解逻辑有 bug,崩出来。
- 例外:①显式向用户报错的 catch(UI setError/pushHint);②纯 UI 空态展示(如「暂无可用地图」)——正常业务态。

## 统一原则

**能一套就不做两套**:玩家可见的演出、节奏与机制,对人类/bot、单机/联机一律同一套参数与形制;只有语义不同(如拼点≠行军)才允许形制不同,禁止按玩家身份或运行模式分参数档。

## 架构红线(所有代码改动必须遵守)

1. **`src/core/` 零 DOM 依赖**：不 import `app/` 或 DOM API。
2. **GameEngine player-agnostic**:引擎只知道 `activeIndex`,不关心屏幕前是谁;不写 `if (player.isLocal)`。
3. **所有状态变更走引擎公共方法**,不直接改属性——服务器可审计/序列化每次操作。
4. **LocalController 是单机专用层**;联机走 `online.ts`;两者共享 `controller.ts` 基类。controller 不加引擎假设:引擎要做新事,先加引擎方法,controller 只调用。
5. **序列化友好**:需同步的状态无函数、无循环引用、无 DOM 引用;联机状态通路=引擎产出的类型化事件批(唯一状态下行,快照只作重连锚,ADR-0020)。
6. **交互类 UI 组件必须收口 shadcn/Base UI**(取无头行为层、套水墨皮,不手搓交互语义);shadcn 变量经 `app.css` 桥接 `--color-*` token,**配色单源仍是 `core/theme.ts`**。附表与豁免见 [组件收口](./docs/design/组件收口.md)。
7. **状态表达原则**(DESIGN §4.6):能用 UI 状态变化(边框/色彩/位移/光圈)标识的,不加文字标牌。
8. **模块治理(常设)**:源文件单一主题、文件名必须是具体领域词——笼统聚合桶(game/utils/helpers/types 式)禁止,词汇表 `_Avoid` 词不上文件名;引擎壳 `authority.ts` 行数与内容禁区由 `scripts/check-core-purity.ts` 断言强制;拆分配方见 [ADR-0019](./docs/adr/0019-module-governance-principle.md)。

## 完成定义(DoD)

改动**玩家可见机制**(相位、数值、牌、事件、地图字段、操作流程)时,**同一 PR 内**必须:

- [ ] 回填 `docs/reference/rules/` 对应规则页(数值带符号名锚点,禁写行号)
- [ ] 新术语登记 [GLOSSARY.md](./GLOSSARY.md)
- [ ] README 文档地图与受影响文档链接有效

## 关键文件

各文件职责速查见 [代码地图](./docs/reference/代码地图.md)。三条高频路由:

- 加名将/珍宝/机遇 = 只改 `core/` 三张数据表(`heroes.ts` / `treasures.ts` / `encounters.ts`);
- 改配色 = 单源 `core/theme.ts`,改后跑 `bun run gen:theme`,不手改 tokens.css;
- 测试与单次辅助的选择器 = 各屏 `testids.ts` 单源,勿硬编码字符串。

联机协议面五个单源(动协议前先看代码地图):`seat-projection.ts` / `wire.ts` / `event-batch.ts` / `room-record.ts` / `watchdogs.ts`。

## 开发陷阱速查(守门类;口径与数值一律查 [rules](./docs/reference/rules/README.md))

- 选都即迁城:**起点=各人自己的都城**,tile 0 仅选都期临时落位,勿当共同起点;`offeredCapitals` 随 rngState 序列化,联机/恢复一致。
- `AwaitingCapitalHalt` 相位已删勿复活:都城路过必停、结束回合,无「驻跸/继续」抉择。
- 机遇档位归一/回退**单源在 `core/encounters.ts`**;机遇必出(ADR-0035):引擎缺省 `enabled=false`,产品默认来自 jiyu.json。

## 验证纪律

命令、领域追加门与精确回执收口见[开发与测试](./docs/how-to/开发与测试.md)；取舍见 [ADR-0065](./docs/adr/0065-test-economics-browser-retirement.md)。

- **日常定向、收口一次**:迭代只跑受影响的无浏览器测试;完成代码后执行一次完整默认池和构建。完整整局、故障与 CLI 慢例只在对应能力改动时定向运行,不自动按批次或发版跑全慢池。
- **常驻浏览器回归已退役**:不新增、不恢复;开发、PR、集成、发版均不跑。仅用户明确要求页面观察、截图对比或浏览器复现时执行单次辅助,不形成用例、不接入门槛。实现页面、改样式、修 bug 不自动授权浏览器操作。
- **APK 人工验收**：视觉、真实手势、系统返回、键盘、后台恢复与原生保存由用户检查，网页截图不替代。
- **测试宁缺毋滥**:新增先答守住什么、运行成本;普通展示、文案、样式与重复数值不补例。接线也属于无浏览器测试,仅守关键命令和状态通路。删除不要求等价迁移。
- **概率性不可靠例零容忍**:发现即删、默认删,不养台账;仅一两行确定性修复能根除且覆盖独有时保留。删例无需批准。
- **回归例**:每修一个真实 bug 配 1–3 个不修必挂的直接回归,先红再绿;体量与修动成比例,禁镜像实现。基建真火证据可在 PR 说明。
- **场景构造**:无浏览器测试与单次辅助均复用 `core/planter.ts` 具名种植件;字段构造不复活 force,引擎公共命令直接调用。
- **开工前 freshness**:每轮续作先 `bun run check:freshness`,过期先重定基。
- **PR 本地门槛**：lint 零 warning、格式、build、完整默认池及开发指南中的受影响领域追加门全绿。共享类型变更先 typecheck 盘点消费点。
- **杀进程先验名**:tasklist 验名,只杀本次拉起的进程;用户 VPN `aurora_slim` 永不清理。

## Agent 工作流

- 操作工单前读[工单约定](./docs/agents/issue-tracker.md)；分诊时查[默认标签](./docs/agents/triage-labels.md)。
- 派子代理前读[派单模板](./docs/agents/派单模板.md)，落实文件属主、验证范围与主线诊断/QC。
- **执行规格票必显式调用 `implement-spec`**，每波重新加载；项目适配为 jj workspace 串行实施，主线承担 merger、接缝和诊断，细则见派单模板。
