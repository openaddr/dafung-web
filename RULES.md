# 游戏规则(RULES.md)

> **权威声明**:本文件是 `src/core/` 代码的人话镜像,**不是**第二个真相。代码与文档冲突时,以代码为准,改文档。每个关键数值在「§11 关键数值表」中标注了代码出处,便于核对与修改。
>
> 术语定义见 [`CONTEXT.md`](./CONTEXT.md)(Authority / Room / Seat / Host / Client 等)。

---

## 1. 胜利条件

两种胜利方式,先达成者称帝([`game.ts:726` `checkVictory`](src/core/game.ts)):

| 方式 | 条件 | 代码 |
|---|---|---|
| **身价达标** | 任一玩家身价 ≥ 目标身价(默认 ¥8000) | `game.ts:734` |
| **群雄尽灭** | 存活玩家仅剩一人(其余破产) | `game.ts:728` |

身价达标时若多人同时达标,取身价最高者([`game.ts:737-741`](src/core/game.ts))。

**身价 = 仅现金**(珍宝、城池账面均不计入)。这一口径迫使玩家管理现金流——购地、扩军直接降身价,只有现金流入(都城补给、卖珍宝)才能推高身价([`networth.ts:10`](src/core/networth.ts))。

---

## 2. 开局:三段式 Setup

开局分三个阶段([`game.ts:50` `SetupPhase`](src/core/game.ts),[`game.ts:180-346`](src/core/game.ts)):

### 阶段 1:国号(Guohao)
- 每位玩家选一个**单汉字**国号(如「魏」「蜀」「吴」),不可与他人冲突([`game.ts:186` `setGuohao`](src/core/game.ts))。
- 校验:单个 CJK 汉字([`constants.ts:25` `isSingleCjk`](src/core/constants.ts))。

### 阶段 2:点将定序(DoDraftRoll)
- 所有玩家掷骰,按点数从高到低确定选都顺序;平局重摇(≤6 人时保证无平局)([`game.ts:203` `doDraftRoll`](src/core/game.ts))。
- 国号留空的座位(如 bot)在此阶段从字池随机分配([`game.ts:206-217`](src/core/game.ts))。

### 阶段 3:选都(PickCapital)
- 按定序顺序,每人选一座**可作都城**的空城作为自己的都城([`game.ts:293` `pickCapital`](src/core/game.ts))。
- 选都即**建城**:付建城费(`buildCost`)、获得该城地产(Lv.0)、棋子落于此格、此处成为玩家的"起点"。
- 首轮先行者由定序第一人确定([`game.ts:335`](src/core/game.ts))。

选都完成后进入 `Playing` 阶段,回合状态机启动。

---

## 3. 回合流程(TurnPhase 状态机)

每个玩家轮到时,经历以下状态([`game.ts:76` `turnPhase`](src/core/game.ts),[`types.ts` `TurnPhase`](src/core/types.ts)):

```
Roll → (掷骰移动) → AwaitingCapitalHalt? → AwaitingBranch? → Land → AwaitingDecision? → EndTurn → 下一位
                         (经过都城抉择)        (辅路入口抉择)       (落格结算) (买/升级/交涉抉择)
```

### 3.1 抽签移动(`Roll` → `rollAndMove`)
- 掷**单骰**(1-6),前进对应步数([`game.ts:354`](src/core/game.ts));签面用汉字「一~六」展示([`constants.ts:3` `SIGN_FACES`](src/core/constants.ts))。
- 名士·移动加成计入步数(如周瑜 +1)([`game.ts:357` `heroMoveBonus`](src/core/game.ts))。
- **经过自己都城**(非落点):立即 +2 委任状([`game.ts:379-387`](src/core/game.ts),[`constants.ts:18` `WARRANTS_PER_PASS`](src/core/constants.ts))。

### 3.2 驻跸抉择(`AwaitingCapitalHalt`)
当移动路径**经过自己都城但落点不是都城**时触发([`game.ts:390`](src/core/game.ts)):
- **驻跸**(`haltAtCapital`):放弃剩余步数停在都城,结算补给,**结束回合**([`game.ts:429`](src/core/game.ts))。
- **继续行军**(`continueMove`):不停,走到原落点正常结算([`game.ts:440`](src/core/game.ts))。

### 3.3 辅路入口抉择(`AwaitingBranch`)
当落点恰为**辅路起点**时触发([`game.ts:414` `currentTileIsBranchStart`](src/core/game.ts)):
- **走大路**(`selectBranch("Main")`):起点格按普通落格处理([`game.ts:468`](src/core/game.ts))。
- **入辅路**(`selectBranch("Branch")`):从辅路第 0 格开始,**逐格掷骰**沿辅路推进,每格触发效果,到终点汇入主路([`game.ts:461`](src/core/game.ts))。

### 3.4 落格结算(`Land` → `resolveLanding`)
落点类型决定结算方式([`game.ts:537` `resolveLanding`](src/core/game.ts)):

| 落点 | 处理 |
|---|---|
| 自己都城 | 补给 + 招贤纳士([`game.ts:540`](src/core/game.ts)) |
| 卧龙岗(Wolong) | 招贤纳士(不可进驻)([`game.ts:549`](src/core/game.ts)) |
| 宝物城(TreasureCity) | 拼点探宝([§8.1](#81-宝物城拼点探宝)) |
| 锦囊(Chance)/天命(Fate) | 随机事件 ±100~250([§9](#9-随机事件)) |
| 税关(Tax) | 缴税 ¥200([`game.ts:575`](src/core/game.ts)) |
| 商市(Stock) | 行情波动 ±100~200([`game.ts:587`](src/core/game.ts)) |
| 无主普通城 | 可购买(`AwaitingDecision`)([`game.ts:617`](src/core/game.ts)) |
| 自己的普通城 | 可扩军(`AwaitingDecision`)([`game.ts:624`](src/core/game.ts)) |
| 他人普通城 | 珍宝交涉或无事([§5.3](#53-落他人城珍宝交涉)) |

### 3.5 抉择(`AwaitingDecision` / `AwaitingTreasureOwner` / `AwaitingHeroPick` / `AwaitingBankruptcySettle`)
玩家做出选择后回合结束。所有玩家操作统一走 `submitCommand`([`game.ts:985`](src/core/game.ts)),详见各机制章节。

### 3.6 回合结束与轮次(`EndTurn`)
- 结算胜负 → 推进到下一位存活玩家([`game.ts:677` `endTurn`](src/core/game.ts),[`game.ts:745` `advanceToNextActive`](src/core/game.ts))。
- **中伏跳过**:新活跃玩家若有 `skipTurns > 0`,扣 1 并跳过,继续推进([`game.ts:697`](src/core/game.ts))。
- **轮次计数**(`round`):所有人各行动一次 = 1 轮;回到轮次锚点时 +1([`game.ts:714`](src/core/game.ts))。轮次供名士技能冷却使用。

---

## 4. 棋盘

地图数据驱动,见 `public/maps/*.json`(默认 `sanguo.json`)。

- **30 城主环**:三国郡县州构成单环主路,坐标按真实中国地图方位布点([`board.ts`](src/core/board.ts))。
- **都城**:玩家开局所选的城,取代传统"起点"。经过自己都城时颁发委任状;落自己都城时补给 + 招贤。
- **辅路(分岔捷径)**:一条独立辅路,起点和终点都接主路。默认走主路,只有**刚好落到辅路起点**才弹抉择([§3.3](#33-辅路入口抉择awaitingbranch))。辅路逐格推进,每格触发效果([§8.2](#82-辅路格))。
- **特殊格**:卧龙岗(招贤)、宝物城(探宝)、锦囊/天命(事件)、税关(缴税)、商市(行情)。

> 要隘捷径(函谷关 / 赤壁 / 华容道 / 剑阁 / 子午谷)是辅路入口的命名与主题包装,机制同上。

---

## 5. 地产经济

### 5.1 购买(`buyProperty`)
落到无主普通城,可花钱**进驻**([`economy.ts:11` `buy`](src/core/economy.ts),[`game.ts:473` `buyProperty`](src/core/game.ts)):
- 消耗现金 `purchasePrice` **+ 1 张委任状**([`game.ts:490`](src/core/game.ts),[`constants.ts:19` `BUY_WARRANT_COST`](src/core/constants.ts))。
- 委任状不足 → 拒绝(`NoWarrant`,UI 禁用购买按钮)([`game.ts:482`](src/core/game.ts))。
- 现金不足 → 拒绝(`InsufficientFunds`)([`economy.ts:12`](src/core/economy.ts))。

### 5.2 升级 / 扩军(`upgradeProperty`)
落到自己的普通城,可花钱**扩军**升级([`economy.ts:26` `upgrade`](src/core/economy.ts),[`game.ts:503` `upgradeProperty`](src/core/game.ts)):
- 消耗现金 `upgradeCost`,等级 +1([`economy.ts:33`](src/core/economy.ts))。
- **城池等级 Lv.0 – Lv.3**(`maxLevel = 3`,由地图配置)([`board-loader.ts:54`](src/core/board-loader.ts))。满级后不可再升(`AlreadyMaxLevel`)([`economy.ts:29`](src/core/economy.ts))。
- 扩军**不消耗委任状**([`constants.ts:19` 注释](src/core/constants.ts))。

### 5.3 落他人城:珍宝交涉
**本作没有传统"付租金"机制。** 落到他人持有的城时([`game.ts:609` `resolveProperty`](src/core/game.ts)):

| 城主状态 | 处理 |
|---|---|
| 城主**有**珍宝 | 进入珍宝交涉(`AwaitingTreasureOwner`):城主可选公道买卖 / 坐地起价 / 不交易([§8.3](#83-珍宝交涉awaitingtreasureowner)) |
| 城主**无**珍宝 | 无事发生,直接结束回合([`game.ts:642`](src/core/game.ts)) |

---

## 6. 委任状

委任状是**买城的额度**,防止运气好的玩家一圈跑下来把城全占光([`constants.ts:16` 注释](src/core/constants.ts))。

| 事件 | 委任状变化 | 代码 |
|---|---|---|
| 开局 | 每人 **3** 张 | `constants.ts:17` `STARTING_WARRANTS` |
| 经过自己都城(巡幸) | **+2** | `constants.ts:18` `WARRANTS_PER_PASS`,`game.ts:380` |
| 进驻(买)一座新城 | **−1** | `constants.ts:19` `BUY_WARRANT_COST`,`game.ts:490` |
| 扩军(升级) | 不消耗 | `constants.ts:19` 注释 |

---

## 7. 名士(英雄)

### 7.1 获取
- **起手 0 位**,上限 **3 位**([`constants.ts:22` `HERO_CAPACITY`](src/core/constants.ts))。
- 获取途径:落到自己都城 / 卧龙岗时触发**招贤纳士**(三选一),从剩余名士池随机抽 3 张选 1([`game.ts:1063` `tryRecruitHero`](src/core/game.ts))。
- 名士**唯一**:已被招揽的不再出现在候选池(`recruitedHeroIds`)([`game.ts:1065`](src/core/game.ts))。
- 破产时名士释放回招贤池([`game.ts:919`](src/core/game.ts))。

### 7.2 名士技能表(数据驱动,见 [`heroes.ts`](src/core/heroes.ts))

| 名士 | 技能 | 效果 | 触发时机 |
|---|---|---|---|
| 周瑜 | moveBonus | 移动步数 **+1** | 移动前(被动) |
| 曹丕 | onOtherLoseCash | 其他玩家被动失财时,自己 **+50** | 他人失财后(触发) |
| 张星彩 | onAnyRoll | 场上任意人掷出 **6**,自己 **+20** | 每次掷骰后(触发) |

> 触发型技能可有**冷却**(按轮次计)([`game.ts:1018` `isHeroReady`](src/core/game.ts))。当前三名士均无冷却。

---

## 8. 珍宝

### 8.1 宝物城:拼点探宝
落到宝物城(TreasureCity)([`game.ts:758` `resolveTreasureCity`](src/core/game.ts) → [`game.ts:763` `drawTreasureAt`](src/core/game.ts)):
1. 从珍宝牌堆随机抽 1 件。
2. **掷双骰(2d6 = 2–12)** 拼点。
3. **拼点 ≥ 珍宝等级** → 获得该珍宝;**< 等级** → 珍宝放回牌堆底([`game.ts:779-788`](src/core/game.ts))。
4. 牌堆抽完后再落宝物城,无事发生([`game.ts:766`](src/core/game.ts))。

### 8.2 辅路格
辅路逐格推进时,每落一格触发([`game.ts:826` `resolveBranchCell`](src/core/game.ts)):

| 格类型 | 效果 |
|---|---|
| treasure | 拼点探宝(同 §8.1) |
| event | 锦囊随机事件(同 §9) |
| penalty | 中伏,`skipTurns = 1`(下回合跳过) |

### 8.3 珍宝交涉(`AwaitingTreasureOwner`)
落到他人城且城主有珍宝时,**城主**做抉择([`game.ts:850` `resolveTreasureOwner`](src/core/game.ts))。访客不可拒绝:

| 抉择 | 售价 | 说明 |
|---|---|---|
| **公道买卖**(fair) | 指导价 | 访客付指导价得宝,银两给城主 |
| **坐地起价**(premium) | 指导价 × tradeMult[Lv] + tradeAdd[Lv] | 按城池等级加价;无配置时回退指导价 ×1.5 × 等级倍率 |
| **不交易**(skip) | — | 无事发生 |

- 售价均为**玩家间流转**(visitor → owner),无银行注入([`game.ts:876` 注释](src/core/game.ts))。
- 访客先得宝再付款;付不起则进入破产清算([§10](#10-破产清算))。
- 坐地起价公式见 [`treasures.ts:37` `premiumPriceOf`](src/core/treasures.ts);等级倍率表 [`treasures.ts:33` `CITY_LEVEL_MULTIPLIER`](src/core/treasures.ts):L0=×1, L1=×2, L2=×3, L3=×5。

### 8.4 珍宝数据(见 [`treasures.ts`](src/core/treasures.ts))

牌堆共 **14** 件(展开 count 后):

| 珍宝 | 等级 | 数量 | 指导价 |
|---|---|---|---|
| 传国玉玺 | 10 | 1 | ¥2000 |
| 带血的诏书 | 9 | 1 | ¥1500 |
| 新鲜的荔枝 | 9 | 3 | ¥1500 |
| 青囊书残卷 | 5 | 5 | ¥500 |
| 小斛 | 3 | 3 | ¥300 |
| 草帽 | 1 | 1 | ¥100 |

指导价查表 [`treasures.ts:15` `TREASURE_PRICE`](src/core/treasures.ts):Lv1-5 线性(×100),Lv6+ 加速(700/900/1200/1500/2000)。

---

## 9. 随机事件

落到锦囊(Chance)/天命(Fate)格,或辅路 event 格时,从对应池随机抽一条事件,结算 `cashDelta`([`game.ts:793` `applyRandomEvent`](src/core/game.ts))。

- **锦囊(Chance)**——偏正面([`events.ts:10` `CHANCE_EVENTS`](src/core/events.ts)):空城退敌 +250 / 草船借箭 +200 / 义士来投 +150 / 风调雨顺 +100。
- **天命(Fate)**——偏负面([`events.ts:17` `FATE_EVENTS`](src/core/events.ts)):败走麦城 −250 / 火烧连营 −200 / 痛失街亭 −150 / 中伏溃散 −100。
- 支出可能触发破产清算([§10](#10-破产清算))。

---

## 10. 破产清算

当玩家需付款但现金不足时([`game.ts:894` `payOrLiquidate`](src/core/game.ts)):

1. **现金够** → 直接扣款,继续。
2. **现金不够但有可变卖资产** → 进入清算(`AwaitingBankruptcySettle`),玩家可逐项变卖自救([`game.ts:911` `hasMarketableAssets`](src/core/game.ts)):
   - 卖珍宝:按**指导价**变现([`game.ts:926` `sellTreasureBankruptcy`](src/core/game.ts))。
   - 卖城池:按**购入价**变现,都城不可卖([`game.ts:938` `sellPropertyBankruptcy`](src/core/game.ts))。
   - 遣散名士:换 **¥200**([`game.ts:950` `cashHeroBankruptcy`](src/core/game.ts))。
   - 凑够债务 → 清偿继续;凑不够 → 真破产([`game.ts:962` `confirmBankruptcySettle`](src/core/game.ts))。
3. **无任何可变卖资产** → 直接破产。
4. **破产后果**([`economy.ts:47` `settleDebt`](src/core/economy.ts),[`game.ts:918` `finalizeBankruptcy`](src/core/game.ts)):
   - 所有资产(城池、珍宝)转移给债主;无债主则销毁。
   - 名士释放回招贤池。
   - 玩家标记 `isBankrupt`,退出后续回合。

---

## 11. 关键数值表

> 每行标注代码出处。地图配置值来自 `public/maps/sanguo.json`(其他地图可能不同)。

| 数值 | 值 | 出处 |
|---|---|---|
| 目标身价(默认) | ¥8000 | `game.ts:53` `DEFAULT_TARGET`;地图 `targetNetWorth` |
| 起手现金(默认) | ¥2500 | `game.ts:54` `DEFAULT_CASH`;地图 `startingCash` |
| 城池最高等级 | Lv.3 | 地图 `maxLevel`;`board-loader.ts:54` |
| 起手委任状 | 3 | `constants.ts:17` `STARTING_WARRANTS` |
| 经过都城 +委任状 | 2 | `constants.ts:18` `WARRANTS_PER_PASS` |
| 买城耗委任状 | 1 | `constants.ts:19` `BUY_WARRANT_COST` |
| 名士上限 | 3 | `constants.ts:22` `HERO_CAPACITY` |
| 遣散名士换银 | ¥200 | `game.ts:957` |
| 都城补给公式 | resupplyPerLevel × (Lv+1) | `economy.ts:39` `supplyFor` |
| 都城补给系数(地图) | ¥150 | 地图 `resupplyPerLevel`;`economy.ts:40` |
| 税关缴税 | ¥200 | `game.ts:576` |
| 商市波动范围 | ±¥100~200 | `game.ts:589` |
| 拼点骰子 | 双骰 2d6(2–12) | `game.ts:776-778` |
| 珍宝等级范围 | 1–10 | `treasures.ts:5-12` |
| 珍宝牌堆总数 | 14 | `treasures.ts:5-12`(展开 count) |
| 坐地起价等级倍率 | L0=×1, L1=×2, L2=×3, L3=×5 | `treasures.ts:33` `CITY_LEVEL_MULTIPLIER` |
| 身价口径 | 仅现金 | `networth.ts:10` `netWorth` |
| 座位数 | 2–4 | `game.ts:127` |
| 骰子 | 单骰 1–6 | `dice.ts`;`game.ts:354` |

---

## 12. AI 诸侯

两档 AI 自动决策([`bot.ts:28` `botAct`](src/core/bot.ts)):

| 抉择点 | Simple(随机) | Normal(EV 启发式) |
|---|---|---|
| 驻跸 vs 行军 | 固定驻跸 | 比较补给价值 vs 落点价值,取大者 |
| 辅路入口 | 50/50 随机 | 比较辅路 EV(探宝−中伏风险)vs 主路落点价值 |
| 买城 | 50% 概率买(需现金 > 1.5×价格 + 有委任状) | 现金 > 1.5×价格即买 |
| 扩军 | 50% 概率升(需现金 > 1.5×费用) | 现金 > 1.5×费用即升 |
| 招贤 | 随机选一位 | 随机选一位 |
| 珍宝交涉(城主) | fair/premium/skip 各 1/3 | 等级 ≥6 坐地起价,否则公道买卖;20% 概率跳过 |
| 破产清算 | 同 Normal | 优先名士→低等级珍宝→城(排除都城),卖到够再确认 |

AI 选都评分:都城补给性价比(`resupplyPerLevel × 8 / buildCost`)+ 随机扰动(Simple 扰动大)([`game.ts:269` `aiChooseCapital`](src/core/game.ts))。

---

## 13. UI 层约定(React,`src/app/`)

> 本节镜像 React 渲染层的实现约定(旧 `src/render/` 已删除)。规则细节以 `src/app/` 代码为权威。

- **分层**:`store/`(zustand:gameStore 存引擎 snapshot + UI 态,netStore 存联机房间态)← `controllers/`(GameController 基类做"状态桥":local.ts 单机持权威引擎 / online.ts 联机持只读引擎 + WS)→ `screens/`(setup / lobby / game / editor 四屏)+ `components/board/`(SVG 棋盘)+ `fx/`(骰子/行军/浮字/横幅/印章/音效)。
- **snapshot 驱动**:组件只订阅 store 声明式重渲;engine/controller 是带方法的实例,不进 zustand(模块级单例,registry.ts 收口)。
- **data-testid**:常量集中定义在各屏的 `testids.ts`(如 `src/app/screens/game/testids.ts`),e2e 统一 import,避免字符串拼写漂移;命名 kebab-case,容器 `xxx-panel`、条目 `xxx-item`。棋盘格仍用 `data-tile="N"`。
- **fx 编排时序**:`fx/orchestrator.ts` 把一次引擎推进翻译为 骰子→行军→浮字→印章/横幅 的表现序列(掷骰 `animateDice` → `animateMove` 行军 → `spawnFloaters` 消费 `engine.drainFloaters()` → 回合推进弹下家横幅)。UI 不得自造时序,一律走编排器。
