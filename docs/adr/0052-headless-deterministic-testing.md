# ADR-0052: 无头确定性测试体系(票一:整局驱动器 + 状态摘要)

日期:2026-11-07 · 状态:已采纳 · 票:[#1161](https://github.com/openaddr/dafung-web/issues/1161) · 地图:[#1160](https://github.com/openaddr/dafung-web/issues/1160)(无头确定性 e2e 测试体系,wayfinder)

## 背景

「游戏对不对」的验证此前几乎全在浏览器 e2e 层:43 条 spec(实查 40 条)混装 UI 壳与逻辑断言,全量分钟级,断相不可诊断(canary-seed 头注释自证:setup 骰流一变,离线种子整体作废,e2e 侧只看到卷轴不升/驱动超时)。本 ADR 记票一:无头整局驱动器 + 逐回合状态摘要——后续票(黄金差分 / bot 基准 / 协议级故障注入)的确定性前提。

参考仓 vera20k(本机克隆路径见 docs/reference/参考仓索引.md 单源)。

## 参考与取舍

### 学了什么(照单)

| vera20k 文件                                                 | 学到的                                                                                                                                                                                                                          | 落地形态                                                                                                 |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `src/sim/parity_digest.rs`                                   | 摘要是「逐项 lined up、首个分歧定位到点」的原料;哈希迭代序必须是确定性序(stable-id 序);RNG 游标入摘要——可观测状态碰巧一致而掷骰次数分叉的漂移只有游标抓得住;**故意排除字段必须记名记理由**(它排除 elevation:折入必产无意义失配) | `scripts/state-digest.ts`:键排序规范化 + sha256;`TurnDigest.rngState`;HASH_EXCLUDED 逐条判词(gameId/log) |
| `src/bin/parity-digest.rs`                                   | **固定种子+固定地图是对比有意义的前提**;sink 归工具所有、位于引擎之外——启用测量不得扰动被测的跑法                                                                                                                               | `scripts/whole-game.ts`:map/seed/seats 全必配;摘要在驱动器取,引擎对摘要全然不知                          |
| `.github/workflows/determinism.yml`(票二正式借,此处只认心智) | 逐帧哈希全等可作门禁                                                                                                                                                                                                            | 本票先落「两跑逐位一致」门(同图同种两跑),台账化留票二                                                    |

### 什么不适用、为什么

- **「证据非判决」口径**——vera20k 摘要对比的是两套引擎(移植 vs 原版),分歧只是侦查线索;本仓同一引擎两跑,分歧即非确定源实证,直接判死(先消灭源再谈台账)。
- **逐 tick 粒度**——vera20k 是实时 RTS;本仓回合制,回合边界(turnNumber 推进)是语义自然切分点,逐 tick 摘要是噪声。
- **JSONL 流式 sink**——vera20k 面向长录制与跨进程消费;本仓摘要直接进测试断言与(票二)台账 JSON,Bun 内存态够用,CLI 导出另走 sim-digest。
- **把驱动器写成 choicesFor→策略→apply 的逐项循环**(任务书初稿措辞)——本仓 `botAct` 是行为单源(#580,ADR-0028 三路代打归一),驱动器逐项重排选择 = 造第二套 bot 语义,违统一原则;故驱动循环收敛为「守卫 + botAct 裸调 + 钩子」,sim-batch 原循环一并收敛进 `driveToEnd`(单源,不复制副本)。

## 摘要定义(冻结;漂移走「确认 → 评审 → update 台账」)

每回合边界一笔 `TurnDigest`(单源 `scripts/state-digest.ts`):

1. **可读概要**:round / turn / phase / turnPhase / activeIndex / isOver / rngState(骰流游标)/ logCount。
2. **stateHash** = SNAPSHOT_FIELDS 全量 + 本回合事件批,键排序规范化(canonicalize)后 sha256。
3. **logHash** = 链式战报哈希:每回合只折新增 log 行(链种子 = 上笔摘要),**剥离两处**:
   - 每行 `ts`(epoch ms @ Date.now)——「何时发生」非「发生什么」;
   - `header` 类行整行——局头 detail 内嵌 gameId 与 startedAt(墙钟),且局头全是重放要素(=语料定义本身,已由 stateHash 对应字段钉住)。
4. **events** = 本回合累计事件批(批界口径 #375)。

### 排除字段判词(HASH_EXCLUDED,vera20k elevation 条款同构)

- **gameId 不收编进骰流**:它是实例身份(时间戳+随机后缀),承担 `data/logs/<gameId>.jsonl` 文件名与 IndexedDB key 的**唯一性契约**——种子化会让同 seed 房间撞名;其非确定性属身份非内容,生成不动、摘要排除。快照往返不受影响(restoreFromSnapshot 原样回灌,续跑继承同一 id)。
- **log / logCount 不整表哈希**:战报随回合线性增长,整表折入 = O(n²);内容是「命令+种子」的派生记录,漂移由链式 logHash 以 O(n) 兜住,覆盖不丢。
- **dice.ts `createDice` 的 `seed ?? Math.random()` 缺省回退不算旁路**:那是种子流自身的缺省入口(无种子产品的随机来源),产物记进局头(seed 字段)可重放——复核了全仓,真正绕过骰流的 `Math.random` 仅 authority.ts 构造器里的 gameId 生成一处,判词如上。

## 落地物

- `scripts/state-digest.ts` — 摘要口径单源(canonicalize / hashCanonical / chainLogHash / turnDigestOf)。
- `scripts/whole-game.ts` — 整局循环单源:driveToEnd(相位守卫/决策归属/无进展/词表合法/数值有限/连 N 回合无事件,六守卫发现即炸)+ runWholeGame 便利入口 + 人类座 choice-index 回放接口位(onHumanDecision;反应窗人类被询问同走此缝,完整重放随协议票)。
- `scripts/sim-digest.ts` — 单局逐回合摘要导出 CLI(`--json` 落盘;票二台账语料入口 + 先红诊断取证)。
- `scripts/sim-batch.ts` — 原整局 while 循环收敛进 driveToEnd(统计逻辑经 onStep 钩子不变)。
- `src/core/game-events.ts` — +`GAME_EVENT_KINDS` 词表运行时清单(加法,零行为变更;`satisfies` 锚住联合,漏登记新 kind 会在巡检红出来)。
- `test/headless-whole-game.test.ts` — 确定性两跑门(3 图 × 10 种子 × 4 bot,两跑逐位 + 终局可达)、快照往返门(第 8 笔摘要截断 → 同 config 重建 → 续跑与对照逐位)、摘要器单测、人类座缝验证;**实测全文件 9.3s,进默认池**(单局 zhongyuan ~100ms 量级)。
- `test/fixtures/maps/yanzhou.json` — 第三语料图(兖州 12 城小盘;仓内内置图仅 guanzhong/zhongyuan 两张,夹具补足「≥3 图」,测试工件不入产品清单)。
- GLOSSARY「测试」节:无头整局 / 状态摘要 / 黄金台账 / 故障注入代理。

## 不变量口径判词(评审收口补记)

票面任务 6 的两条不变量落法:①「netWorth 与组分重算吻合」——netWorth 是纯派生函数(现金+资产单源计算,无存储对偶可「吻合」),该不变量由构造成立;驱动器的 assertEconomySane 钉其有限性(数值泄漏面)。②「破产结算正确」两路覆盖:driveToEnd 相位守卫(停在任何不可驱动相位含破产清算即炸,响亮暴露结算卡死)+ 票三 sim-bench 的 playerBankrupt 事件↔isBankrupt 旗交叉核对(4001-4050 语料);票一语料的巡检面=守卫面,交叉核对归基准语料。

## 后果

- 确定性两跑门与快照往返门从此常驻 `bun test`:任何非确定源(漏序列化状态、迭代序、时钟)当场红,不再等浏览器 e2e 断相。
- sim-batch 的守卫语义由 driveToEnd 统一(报错措辞微调:如「bot 步无进展」→「驱动步无进展」);统计输出格式不变。
- 票二(check:goldens)直接消费本票的摘要与语料;语料 seeds 3001-3010 与夹具图 yanzhou 为台账首版语料。
- 已知边界:反应窗的完整 choice-index 重放、多人人类座回放随协议票(票四)落地;摘要含 `events` 批,事件字段新增即漂移——票二台账 update 流程承接。
