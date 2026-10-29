# dafung-web — 群雄逐鹿(三国大富翁)

TypeScript + Vite + React 的三国主题大富翁:**权威引擎**(`src/core/`,纯逻辑、可上服务器)+ **瘦客户端**(`src/app/`)。单机(1 真人对 AI)与联机(人手一设备,WebSocket 同步)。个人项目,朋友圈子自用,**不考虑任何向前/向后兼容性**——需要重构直接改,别把「兼容」「迁移」当理由。

**本文件是路由与红线,不当事实源**(内容分级纪律见 [ADR-0033](./docs/adr/0033-agents-content-tiering.md)):细节在下述文档里,按需读。**开工第一步看第一章:任何改动先开工作区,不直接改主树。**

## 版本协作(jj;硬纪律:先开工作区,再改任何东西)

jj-vcs(colocated),多会话并行是常态、主树工作副本只有一份。五条铁律;配方与命令速查唯一事实源=[开发与测试](./docs/how-to/开发与测试.md)「版本协作」节:

1. **任何写盘改动(不分体量)开工前先 `jj workspace add ../dafung-web-ws-<代号>`**;主树 @ 只读停靠、永不留活(唯一例外:`pr-merge.ts` 收口尾步前移主树空 @);@ 有别人的活=让出走 workspace。
2. **交付**=`jj describe` → 书签 → `jj git push --bookmark` + PR;master 受保护(禁直推/禁 merge commit,一律 PR+squash);workspace 谁建谁清。
3. **文件集自查两拍**:落盘后立即一拍、push 前一拍(`jj diff --stat` 对账,多出=折入先拆);收口走 `pr-merge.ts --expect <路径>` 硬闸。
4. **收账**由 pr-merge 尾步自动做(fetch+move+空 @ 前移);手动通路见 how-to 同节。
5. **里程碑快照**:写盘改动每里程碑 `jj st` 落一次快照——jj 只在命令时快照,未快照写盘随 workspace 被清不可恢复(2026-10-29 实锤);恢复配方与清扫验活见 how-to 同节。

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

## 架构红线(所有代码改动必须遵守)

1. **`src/core/` 零 DOM 依赖**:不 import 任何 `app/`(React 层)或 DOM API——引擎将来上服务器,任何耦合都阻断联机化。✅ `import type { Player } from "./types"`;❌ `import { useGameStore } from "../app/store/gameStore"`。
2. **GameEngine player-agnostic**:引擎只知道 `activeIndex`,不关心「谁在这个屏幕前」;不写 `if (player.isLocal)`。
3. **所有状态变更走引擎公共方法**(如 `engine.buyProperty()`),不直接改属性——保证服务器可审计/序列化每次操作。
4. **LocalController 是单机专用层**(假设活跃真人就在本屏前);联机走 `online.ts`;两者共享 `controller.ts` 基类。controller 不加引擎假设:引擎要做新事,先加引擎方法,controller 只调用。
5. **序列化友好**:需同步的状态无函数、无循环引用、无 DOM 引用;联机状态通路=引擎产出的类型化事件批(唯一状态下行,快照只作重连摘要与校准锚,ADR-0020)。
6. **交互类 UI 组件必须收口 shadcn/Base UI**(弹层/下拉/确认框/表单控件等:`bunx shadcn add <component>` 取无头行为层,套水墨皮,不手搓交互语义);shadcn 变量经 `app.css` 桥接 gen:theme 产出的 `--color-*` token,**配色单源仍是 `core/theme.ts`**。附表与豁免见 [docs/design/组件收口.md](./docs/design/组件收口.md)。
7. **状态表达原则**(DESIGN §4.6):能用 UI 状态变化(边框/色彩/位移/光圈)标识的,不加文字标牌。
8. **模块治理(常设)**:源文件单一主题、文件名必须是具体领域词——笼统聚合桶(game/utils/helpers/types 式)禁止,词汇表 `_Avoid` 词不上文件名;引擎壳 `authority.ts` 的行数与内容禁区由 `scripts/check-core-purity.ts` 断言强制;拆分配方(机制域轴+自由函数+薄委托、搬运与改名分离、验收判据)见 [ADR-0019](./docs/adr/0019-module-governance-principle.md)。

## 完成定义(DoD)

改动**玩家可见机制**(相位、数值、牌、事件、地图字段、操作流程)时,除代码与测试外,**同一 PR 内**必须:

- [ ] 回填 `docs/reference/rules/` 对应规则页(数值带符号名锚点,禁写行号)
- [ ] 新术语登记 [GLOSSARY.md](./GLOSSARY.md)
- [ ] README 文档地图与受影响文档链接有效

## 文档风格规约

全中文,入口文件英文命名(深层文档中文文件名,ADR 英文);受众玩家优先;数值表只做索引 + 代码锚点,**不复制数值造第二事实源**(计数同理——用例数/时机数/文件数等一律指向不落数),活文档禁写行号;README 主 CTA 置顶,开发内容下沉 how-to/;发版走 git tag + GitHub Releases,不建 CHANGELOG;打 tag 前先 bump package.json 的 version(唯一版本源,CalVer 制式 YYYY.M.P、月份不补零,如 2026.10.0;tauri.conf.json 经路径引用它,APK/桌面包版本随之)。

## 关键文件

各文件职责速查见 [docs/reference/代码地图.md](./docs/reference/代码地图.md)。三条高频路由常驻于此:

- 加名将/珍宝/机遇 = 只改 `core/` 三张数据表(`heroes.ts` / `treasures.ts` / `encounters.ts`);
- 改配色 = 单源 `core/theme.ts`,改后跑 `bun run gen:theme`,不手改 tokens.css;
- e2e 选择器 = 各屏 `testids.ts` 单源,勿硬编码字符串。

联机协议面五个单源(动协议前先看代码地图):`seat-projection.ts`(下行装配必经)、`wire.ts`(双工同一本体)、`event-batch.ts`(共享批语义)、`room-record.ts`(重建单源)、`watchdogs.ts`(四组看门狗)。

## 开发陷阱速查(守门类;口径与数值一律查 [rules](./docs/reference/rules/README.md))

- 选都即迁城:**起点=各人自己的都城**,出生位 tile 0 仅选都期临时落位,勿当共同起点(「起」印已随 #620 退役);选都候选 `offeredCapitals` 随 rngState 序列化,联机/恢复必须一致。
- `AwaitingCapitalHalt` 相位已删勿复活:都城路过必停、结束回合,无「驻跸/继续」抉择。
- 机遇档位归一/回退**单源在 `core/encounters.ts`**;引擎缺省 `triggerRate=0`,产品默认来自 jiyu.json。

## 验证纪律

细节唯一事实源=[开发与测试](./docs/how-to/开发与测试.md)。五条常驻:

- **测试宁缺毋滥**:重复用例、低性能用例宁可不要,发现即删或重写;新增用例先答「守住什么、花几秒」。
- **视觉设计与回归以移动端横屏 844×390 为标准**:截图自证(`shot.mjs` 默认视口)、原型/mock 画布、e2e 功能冒烟一律按此档;桌面档维持零重排,不再设专项布局断言。
- **开工前 `bun run check:freshness`**(过期禁止开工;多轮任务每轮续作前重跑,并行会话可能已合票推进 master)。
- **门槛挂 PR 前——本地全绿**(无 CI,本地是唯一门):lint 0 warning + fmt + check:fmt + build + bun test,改 `scripts/` 加跑 typecheck:scripts。实锤陷阱:**改共享类型(挂根字段增删一类)先 `bun run typecheck` 盘点全部消费点再动刀**——排除式过滤词的 grep 会按文件名吞命中,漏网到 build 才爆就是几轮返工。
- **杀进程先验名**:`tasklist` 验进程名,只杀自己拉起的进程;`aurora_slim` 是用户 VPN 日常必用,永不入清理名单。

## Agent 工作流

- Issue tracker:GitHub Issues(`openaddr/dafung-web`),细则见 [docs/agents/issue-tracker.md](./docs/agents/issue-tracker.md) 与 [triage-labels.md](./docs/agents/triage-labels.md);领域文档消费方式见 [docs/agents/domain.md](./docs/agents/domain.md)。
- **子代理派单前**先读 [docs/agents/派单模板.md](./docs/agents/派单模板.md)(五条纪律+模板+QC 检查单+jj 配方三律);截图自证一律走 `scripts/shot.mjs`。
