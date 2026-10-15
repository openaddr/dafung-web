# dafung-web — 群雄逐鹿(三国大富翁)

TypeScript + Vite + React 的三国主题大富翁:**权威引擎**(`src/core/`,纯逻辑、可上服务器)+ **瘦客户端**(`src/app/`,React)。单机模式(1 真人对阵电脑)与联机模式(每人一台设备,WebSocket 同步)。个人项目,朋友圈子自用,**不考虑任何向前/向后兼容性**——需要重构直接改,别把「兼容」「迁移」当理由。

**本文件是路由与红线,不当事实源**:细节在下述文档里,按需读,别在这里找数值。

## 事实源地图

| 要什么                                       | 去哪                                                                                                                                                                                   |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 游戏规则与数值(权威以 `src/core/` 代码为准)  | [docs/reference/rules/](./docs/reference/rules/README.md)(十页导览,数值总表在第 10 页)                                                                                                 |
| 领域词汇(术语定名与弃用名)                   | [GLOSSARY.md](./GLOSSARY.md)                                                                                                                                                           |
| 代码文件职责速查(哪个文件管什么)             | [docs/reference/代码地图.md](./docs/reference/代码地图.md)                                                                                                                             |
| 设计决策存档                                 | docs/adr/                                                                                                                                                                              |
| 视觉/交互设计(改 UI 前必读)                  | [docs/design/DESIGN.md](./docs/design/DESIGN.md) + [BRIEF.md](./docs/design/BRIEF.md)                                                                                                  |
| 交互组件收口附表(shadcn/Base UI)             | [docs/design/组件收口.md](./docs/design/组件收口.md)                                                                                                                                   |
| 命令清单与测试跑法(单一事实源)               | [docs/how-to/开发与测试.md](./docs/how-to/开发与测试.md)                                                                                                                               |
| 联机架构 / 部署 / 对局日志                   | [docs/explanation/联机架构.md](./docs/explanation/联机架构.md) · [docs/how-to/部署服务器.md](./docs/how-to/部署服务器.md) · [docs/reference/对局日志.md](./docs/reference/对局日志.md) |
| 联机框架评估结论与参考仓借东西清单(动工前查) | [docs/reference/参考仓索引.md](./docs/reference/参考仓索引.md)                                                                                                                         |
| 派单纪律与模板                               | [docs/agents/派单模板.md](./docs/agents/派单模板.md)                                                                                                                                   |
| 机遇系统配置(`public/config/jiyu.json`)      | rules 第 07 页[声望与机遇](./docs/reference/rules/07-声望与机遇.md)                                                                                                                    |

## 零兜底原则(全项目贯穿)

**禁止一切兜底/容错性保护措施**:出了问题就让问题暴露——那是发现了 bug,修就是了;静默兜底只会掩盖问题、助长屎山。

- 禁止硬编码默认值兜底:可配置/可插拔的东西唯一事实源是配置本身(如默认地图 = `maps/index.json` 首项,清单空直接抛错)。
- 禁止 `catch {}` 吞错;`??`/`?.` 链式兜底同样审视——数据缺失是 bug,不是「回退一下就过去了」。
- 禁止「理论上到不了」式防御分支与极端场景静默保护;真到了就是求解逻辑有 bug,应该崩出来。
- 例外:①显式向用户报错的 catch(UI setError/pushHint);②纯 UI 空态展示(如「暂无可用地图」)——正常业务态,不是兜底。

## 架构红线(所有代码改动必须遵守)

1. **`src/core/` 零 DOM 依赖**:不 import 任何 `app/`(React 层)或 DOM API——引擎将来上服务器,任何耦合都阻断联机化。✅ `import type { Player } from "./types"`;❌ `import { useGameStore } from "../app/store/gameStore"`。
2. **GameEngine player-agnostic**:引擎只知道 `activeIndex`,不关心「谁在这个屏幕前」;不写 `if (player.isLocal)`。
3. **所有状态变更走引擎公共方法**(如 `engine.buyProperty()`),不直接改属性——保证服务器可审计/序列化每次操作。
4. **LocalController 是单机专用层**(`src/app/controllers/local.ts`,假设活跃真人就在本屏前);联机走 `online.ts`;两者共享 `controller.ts` 基类。controller 不加引擎假设:引擎要做新事,先加引擎方法,controller 只调用。
5. **序列化友好**:需同步的状态无函数、无循环引用、无 DOM 引用;联机状态通路=引擎产出的类型化事件批(折叠切换⑥ #388 起为唯一状态下行,快照只作重连摘要与校准锚,ADR-0020)。
6. **交互类 UI 组件必须收口 shadcn/Base UI**(弹层/下拉/确认框/表单控件等:`bunx shadcn add <component>` 取无头行为层,套水墨皮,不手搓交互语义);shadcn 变量经 `app.css` 桥接 gen:theme 产出的 `--color-*` token,**配色单源仍是 `core/theme.ts`**。附表与豁免见 [docs/design/组件收口.md](./docs/design/组件收口.md)。
7. **视觉/交互设计开工前先读 [DESIGN.md](./docs/design/DESIGN.md)**;§4.6 状态表达原则:能用 UI 状态变化(边框/色彩/位移/光圈)标识的,不加文字标牌。
8. **模块治理(常设,目的=可读性/维护性/扩展性)**:源文件单一主题、文件名必须是具体领域词——笼统聚合桶(game/utils/helpers/types 式)禁止,词汇表 `_Avoid` 词不上文件名;拆分走机制域轴+自由函数+薄委托,**搬运与改名分离**,验收=测试全绿+方法清单 diff 零(同种子快照哈希验收已由 ADR-0021 删除);引擎壳 `authority.ts` 的行数与内容禁区由 `scripts/check-core-purity.ts` 断言强制。细则见 [ADR-0019](./docs/adr/0019-module-governance-principle.md)。

## 完成定义(DoD)

改动**玩家可见机制**(相位、数值、牌、事件、地图字段、操作流程)时,除代码与测试外,**同一 PR 内**必须:

- [ ] 回填 `docs/reference/rules/` 对应规则页(数值带符号名锚点,禁写行号)
- [ ] 新术语登记 [GLOSSARY.md](./GLOSSARY.md)
- [ ] README 文档地图与受影响文档链接有效(全仓库无死链)

## 文档风格规约

全中文,入口文件英文命名(深层文档中文文件名,ADR 英文);受众玩家优先;数值表只做索引 + 代码锚点,**不复制数值造第二事实源**(计数同理——用例数/时机数/文件数等一律指向不落数),活文档禁写行号;README 主 CTA 置顶,开发内容下沉 how-to/;发版走 git tag + GitHub Releases,不建 CHANGELOG。

## 关键文件

各文件职责速查见 [docs/reference/代码地图.md](./docs/reference/代码地图.md)。三条高频路由常驻于此:

- 加名将/珍宝/机遇 = 只改 `core/` 三张数据表(`heroes.ts` / `treasures.ts` / `encounters.ts`);
- 改配色 = 单源 `core/theme.ts`,改后跑 `bun run gen:theme`,不手改 tokens.css;
- e2e 选择器 = 各屏 `testids.ts` 单源,勿硬编码字符串。

联机协议面五个单源(动协议前先看代码地图):`seat-projection.ts`(per-seat 下行装配必经)、`wire.ts`(联机 WS 与单机内存双工同一本体)、`event-batch.ts`(共享批语义)、`room-record.ts`(「记录→引擎」重建单源)、`watchdogs.ts`(四组同构看门狗)。

## 开发陷阱速查(游戏逻辑;数值一律查 [rules 第 10 页](./docs/reference/rules/10-关键数值总表.md))

- 选都三选一的候选 `offeredCapitals` 随 rngState 序列化——联机/恢复必须一致。
- 都城**路过必停**、结束回合,无「驻跸/继续」抉择(`AwaitingCapitalHalt` 相位已删,勿复活)。
- **身价=仅现金**:购地直接降身价;本作无过路费/升级费,城池升级只挂公道买卖成交路径。
- 破产自救**凑足即止**:现金≥债务后引擎硬拒绝继续变卖(`assertStillOwing`),不靠 UI 禁用自觉。
- 弹卷轴 ⇔ 选项集 ≥2 真实选项;≤1 引擎自动执行默认行为+浮字(ADR-0013,`engine.choicesFor()`/快照 `choices` 供消费);破产清算例外仍弹。
- 机遇档位归一/回退单源在 `core/encounters.ts`;引擎缺省 `triggerRate=0`,产品默认来自 jiyu.json。
- 时机框架:技能=数据声明挂 `HeroDef.skills`,`dispatchMoment` 按座位序×技能序确定性派发;加效果一步(`effects.ts`)/加技能两步(`heroes.ts`)/加时机三步(`timing.ts`+`authority.ts`);效果内禁同步再派发时机(深度>2 抛错);CashGained 仅经济结算点派发,防连锁。
- 对局日志(ADR-0014):**纯归档**(ADR-0021 删重放校验器)——记人类 `submitCommand`/`pickCapital` 全量,**bot 路径不记**;联机落 `data/logs/<gameId>.jsonl`,单机在 IndexedDB,排查直接读 jsonl(格式见[对局日志](./docs/reference/对局日志.md))。

## 验证纪律

- **测试宁缺毋滥**:宁愿不要测试用例,也不要垃圾用例、低性能用例——这种测试会严重降低开发迭代效率;发现即删除或重写,新增用例先回答「守住什么、花几秒」。
- **开工前**:`bun run check:freshness`(基线指纹 / 落后 origin-master / 冲突标记三合一;过期禁止开工,审计取证尤其如此——防在旧基线上修已消失的问题)。多轮任务每轮续作前重跑——并行会话可能已合票推进 master(2026-10-15 实锤:收账把工作副本运到新基线)。
- **改完码**:lint(0 warning 基线)+ fmt 先过,日常 build + `bun test`;改 `scripts/` 加跑 typecheck:scripts。命令与跑法细节一律见[开发与测试](./docs/how-to/开发与测试.md)(命令单一事实源)。
- **分层**:工单收口只跑本工单 spec;全量 e2e 每分支一次、PR 前收口,门禁=放行判据(判据、workers 与墙钟预算见开发与测试)。
- e2e 时间倍率仅测试生效;联机/韧性 spec 用免注入的 `testUnscaled`。
- **杀进程先验名**:清端口占用必先 `tasklist` 验进程名再杀,只杀自己拉起的进程;`aurora_slim` 是用户 VPN 日常必用,永不入清理名单(2026-10-05 误杀断网事故的硬规矩)。

## 版本协作(jj 优先)

本项目 **优先使用 jj-vcs(colocated 模式)** 协作开发:`jj git init --colocate` 已落地,.jj 与 .git 共存,git/jj 双通道全兼容。口径:

- **主线(会话)用 jj**:分支/合并/收账/审查走 jj;**子代理协作走 jj workspace**(`jj workspace add ../dafung-web-ws-<代号>`——#537 试点已通过,workspace 为正式通道;git worktree = 逃生舱通道),网络断可全本地流转,最后统一推。
- **master 受保护**(禁直推/禁 merge commit,一律 PR + squash);大批次走集成分支(如 `xuanmo-batch` 先例)单 PR 入库。
- 操作配方、0.45 摩擦清单与命令速查的单一事实源:[开发与测试](./docs/how-to/开发与测试.md)「版本协作」节;派单场景三律见[派单模板](./docs/agents/派单模板.md)jj 配方节。

## Agent 工作流

- Issue tracker:GitHub Issues(`openaddr/dafung-web`;gh 未认证走 token+REST 等效通路),细则见 [docs/agents/issue-tracker.md](./docs/agents/issue-tracker.md) 与 [triage-labels.md](./docs/agents/triage-labels.md);领域文档消费方式见 [docs/agents/domain.md](./docs/agents/domain.md)。
- **子代理派单前**先读 [docs/agents/派单模板.md](./docs/agents/派单模板.md)(五条纪律+模板+QC 检查单);截图自证一律走 `scripts/shot.mjs`。
- 覆盖率体检与耗时回顾各有 skill(`.agents/skills/`),按其 SKILL.md 触发条件使用,勿日常化。
