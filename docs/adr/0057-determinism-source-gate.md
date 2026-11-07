# ADR-0057: 确定性源码闸(src/core 时钟/随机/环境读取源码级钉死)

日期:2026-11-07 · 状态:已采纳 · 票:[#1206](https://github.com/openaddr/dafung-web/issues/1206)

## 背景

src/core 是权威引擎,单机/联机/恢复/黄金台账全部建立在其逐位确定性上。ADR-0052 已建「事后」面:无头整局两跑逐位一致门 + 状态摘要 + 黄金台账——但两跑门只能等分叉红了再侦查,非确定源从混入到发现之间可能隔着任意多提交,定位靠考古。

事前缺一层:任何人在 src/core 写一行 `Date.now()` / `Math.random()` / 读环境变量,门禁应当场红,而不是等两跑比对漂了再查。引擎侧已盘点(开工 sweep 复核)的合法时钟/随机/环境面有三:authority.ts 的 gameId 生成与墙钟展示戳(ADR-0052 判词:身份唯一性契约 + chainLogHash 剥 ts/header,均非逻辑输入)、dice.ts 的 seed 缺省回退(产物进局头 seed 字段可重放)、extension-loader.ts 的扩展目录扫描(sweep 撞出的清单外新命中,主线裁决登记——见决策 3)。

参考仓 vera20k(本机克隆路径见 docs/reference/参考仓索引.md 单源)。

## 参考与取舍

### 学了什么(照单)

| vera20k 文件                                                       | 学到的                                                                                                                                                                                          | 落地形态                                                                                                                                         |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/architecture_guards.rs`(头注释)                               | **determinism guards pin the engine files that read platform- or process-dependent values**——模式清单(clocks/环境/目录序/线程数等)+ 冻结例外清单双件套,失败信息可行动(指明去哪登记、清单只准缩) | `scripts/check-core-purity.ts` 确定性扫描节:`DETERMINISM_PATTERNS` 模式族 + `DETERMINISM_FREEZE` 冻结例外清单(file 级→模式级放行,行内注释写理由) |
| 同文件 `production_dependency_edges_match_frozen_ledger_inventory` | 双向棘轮:新边红之外,**stale 例外也红**——条目不再命中=存量已清偿,必须删条目收紧清单("Delete the entry so the ratchet tightens")                                                                  | 冻结条目零命中检查,与新增违规同场红                                                                                                              |

### 什么不适用、为什么

- **测试即守卫的形制**——vera20k 把架构守卫写成 `#[test]` 走 cargo test;本仓既有 check:core 单一入口(scripts/check-core-purity.ts)已是纯度门禁的落点,确定性闸挂进同场执行,不另起命令、不进 bun test(bun test 管行为,门禁脚本管结构)。
- **libm 数学/线程数等模式**——vera20k 是 Rust 实时模拟,浮点库与线程池是现实分叉源;本仓 TS 引擎的算子是 IEEE 754 定值、单线程事件循环,模式族按本项目现实面取(时钟/随机/环境/宿主调度),不照抄。
- **baseline 指纹机制复用**——`.core-purity-baseline.json` 的存量台账语义不适于确定性面:合法例外必须写理由、走评审(改脚本),不是 `baseline:update` 一键掩过;冻结清单本身就是确定性面的存量台账。

## 决策

1. **挂进 check:core 单一入口**,不新增命令——纯度红线(#1/#2)与确定性闸同场执行,一条命令背两个闸,失败输出同款格式(文件:行号 + 模式 + 可行动指引)。
2. **模式族 18 项钉死**:时钟(`Date.now` / `new Date(` / `Date.parse` / `performance.now`)、随机(`Math.random` / `crypto.getRandomValues` / `crypto.randomUUID`)、环境(`process.env` / `process.platform` / `process.cwd` / `localStorage` / `sessionStorage` / `navigator`)、宿主与调度(`setTimeout` / `setInterval` / `import.meta.dir` / `Bun.file` / `readdirSync`)。扫描面 `src/core/**/*.ts` 排除 `*.test.ts`;与既有红线同款「剥注释后扫」——禁「使用」不禁「提及」。
3. **冻结例外清单只准缩不准长**:新模式命中必先答「引擎为何要读平台/进程依赖值」,确属合法时钟/随机面才登记 file→pattern 条目,理由写行内注释(评审记录);放行按**模式粒度**——条目只放行登记的模式,同文件出现其他模式族照样红(闸的语义是「清单外零命中」,不是「零环境读取」)。首版三条:
   - `authority.ts` → `Date.now`、`Math.random`:gameId 生成(实例身份唯一性,种子化会同 seed 撞名)+ startedAt/log ts 墙钟展示戳;无头层 chainLogHash 剥 ts+header(ADR-0052),均非引擎逻辑输入。
   - `dice.ts` → `Math.random`:seed 缺省回退(无种子本地起局的随机来源),产物记进局头 seed 字段可重放;联机路径必传 seed。
   - `extension-loader.ts` → `readdirSync`:ADR-0022 权威侧扩展装载器,bun/node 启动期环境读取,非引擎逻辑面;目录序已显式字典序排序钉死(消费方仅 scripts/server.ts 装载与 test/,浏览器禁入)。
4. **确定性违规不走 baseline**:硬红当场退出 1,`baseline:update` 不掩——冻结清单登记动作 = 改脚本的评审变更。isLocal 零容忍无例外(既有规则同场,本票确认)。
5. **stale 收紧行**:冻结条目对应 file:pattern 零命中即红,提示删条目——合法面消偿后清单必须跟着缩。

## 落地物

- `scripts/check-core-purity.ts` — 确定性扫描节(模式族 + 冻结清单 + stale 检查 + 硬红输出),check:core 单一入口不变,`baseline:update` 子命令语义不动。
- AGENTS.md 验证纪律 check:core 行、docs/how-to/开发与测试.md 架构门禁条:各一句同步(闸的存在与冻结清单口径)。

## 后果

- 新非确定源当场红(文件+行号+模式+登记指引),两跑门/黄金台账从事后侦查退居兜底验证——绝大多数分叉源被事前层吃掉。
- 冻结清单是棘轮:合法面消偿(如 gameId 生成改造去随机)后条目必须同步删,清单只准缩。
- 行号为剥注释后行号,前置块注释会致与原始行号漂一(既有壳断言同款口径),命中行文本随行打印可定位。
- 引擎将来需要的新合法面(如显式注入时钟的默认实现)不豁免本闸:注入点住在 src/core 之外,core 只吃参数。
