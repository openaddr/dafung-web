# 游戏规则(RULES.md)

> **权威声明**:本文件是 `src/core/` 代码的人话镜像,**不是**第二个真相。代码与文档冲突时,以代码为准,改文档。每个关键数值在「§11 关键数值表」中标注了代码出处,便于核对与修改。
>
> 术语定义见 [`CONTEXT.md`](./CONTEXT.md)(Authority / Room / Seat / Host / Client 等)。

---

## 1. 胜利条件

两种胜利方式,先达成者称帝([`game.ts:777` `checkVictory`](src/core/game.ts)):

| 方式 | 条件 | 代码 |
|---|---|---|
| **身价达标** | 任一玩家身价 ≥ 目标身价(默认 ¥30000,即 300 两) | `game.ts:785-792` |
| **群雄尽灭** | 存活玩家仅剩一人(其余破产) | `game.ts:779-783` |

身价达标时:先查当前活跃玩家,再查其余玩家,多人同时达标取身价最高者([`game.ts:784-792`](src/core/game.ts))。

**身价 = 仅现金**(珍宝、城池账面均不计入)。这一口径迫使玩家管理现金流——购地直接降身价,只有现金流入(都城补给、卖珍宝)才能推高身价([`networth.ts:9` `netWorth`](src/core/networth.ts))。

---

## 2. 开局:三段式 Setup

开局分三个阶段([`game.ts:51` `SetupPhase`](src/core/game.ts),[`game.ts:223-388`](src/core/game.ts)):

### 阶段 1:国号(Guohao)
- 每位玩家选一个**单汉字**国号(如「魏」「蜀」「吴」),不可与他人冲突([`game.ts:229` `setGuohao`](src/core/game.ts))。
- 校验:单个 CJK 汉字([`constants.ts:25` `isSingleCjk`](src/core/constants.ts))。

### 阶段 2:点将定序(DoDraftRoll)
- 所有玩家掷骰,按点数从高到低确定选都顺序;平局重摇(≤6 人时保证无平局;>6 人接受并列、按玩家序破平)([`game.ts:246` `doDraftRoll`](src/core/game.ts))。
- 国号留空的座位(如 bot)在此阶段从字池(`GUOHAO_POOL`)随机分配([`game.ts:248-260`](src/core/game.ts))。

### 阶段 3:选都(PickCapital,三选一)
- 按定序顺序轮到某玩家时,引擎先为其滚出 **3 座候选城**(`offeredCapitals`,快照随 rngState 序列化,联机/恢复各端一致),玩家只能从候选中选([`game.ts` `rollOfferedCapitals`](src/core/game.ts))。候选生成规则:
  - 剩余可选城(未选都、未进过任何人的候选集)按建价排序分**低/中/高三档,每档各取一**(廉价/中档/高价拉开经济路线);
  - 同组内**最远点采样**:首城档内随机,后两城取「与已选候选的最小欧氏距离」最大者前 3 名中随机(地理分散、避免确定性感);
  - 退化:剩余不足 3 时档位合并;排除历史候选后不足 3 时放行复用未中选的历史候选(小地图仍可完成全员选都);剩余为 0 候选为空(沿用轮空推进)。
- 选都即**建城**:付建城费(`buildCost`)、获得该城地产(**Lv.0**)、棋子落于此格、此处成为玩家的"起点"。
- 点非候选城被拒(reason `非本轮候选城`)([`game.ts` `pickCapital`](src/core/game.ts))。
- 首轮先行者为定序第一人([`game.ts` `finishSetup`](src/core/game.ts))。

选都完成后进入 `Playing` 阶段,回合状态机启动。

---

## 3. 回合流程(TurnPhase 状态机)

每个玩家轮到时,经历以下状态([`game.ts:85` `turnPhase`](src/core/game.ts),[`types.ts:125` `TurnPhase`](src/core/types.ts)):

```
Roll → (掷骰移动) → AwaitingBranch? → Land → AwaitingDecision? → EndTurn → 下一位
                     (辅路入口抉择)    (落格结算) (买/升级/交涉抉择)
```

### 3.1 抽签移动(`Roll` → `rollAndMove`)
- 掷**单骰**(1-6),前进对应步数([`game.ts` `rollAndMove`](src/core/game.ts));签面用汉字「一~六」展示([`constants.ts:3` `SIGN_FACES`](src/core/constants.ts))。
- 名士·移动加成计入步数(如周瑜 +1):时机·`BeforeMarch` 触发 `moveBonus` 效果累计([`game.ts:456`](src/core/game.ts),时机框架见 [`docs/timing-framework.md`](docs/timing-framework.md))。
- **经过自己都城**(非落点):**必停**——立即 +2 委任状(巡幸),棋子停在都城不再走完剩余步数,结算驻跸补给,**结束回合**(不再有「驻跸/继续」抉择)([`game.ts` `rollAndMove` 必停分支](src/core/game.ts))。

### 3.2 必停都城(无抉择,引擎直接结算)
移动路径**经过自己都城但落点不是都城**时触发([`game.ts` `rollAndMove`](src/core/game.ts)):
- 棋子停在都城(行军动画也截断到都城),结算补给(战报「军至都城 X,驻跸补给(+N)」),**结束回合**。
- **落点恰是都城**:行为不同——走正常落格(补给 + 招贤纳士三选一),见 §3.4。

### 3.3 辅路入口抉择(`AwaitingBranch`)
当落点恰为**辅路起点**时触发([`game.ts` `rollAndMove`](src/core/game.ts);判定函数 [`game.ts` `currentTileIsBranchStart`](src/core/game.ts)):
- **走大路**(`selectBranch("Main")`):起点格按普通落格处理。
- **入辅路**(`selectBranch("Branch")`):**本回合结束**——棋子留在主路入口格,置「待入辅路」状态(`onBranch={step:-1}`);**下回合掷骰**起沿辅路格推进:掷几点走几格(落第 die 格并触发该格效果),掷满溢出则从辅路终点汇入主路继续走剩余步数([`board.ts` `computePath`](src/core/board.ts))。

### 3.4 落格结算(`Land` → `resolveLanding`)
落点类型决定结算方式([`game.ts:577` `resolveLanding`](src/core/game.ts)):

| 落点 | 处理 |
|---|---|
| 自己都城 | 补给 + 招贤纳士([`game.ts:580-585`](src/core/game.ts)) |
| 卧龙岗(Wolong) | 招贤纳士(不可进驻)([`game.ts:589-593`](src/core/game.ts)) |
| 宝物城(TreasureCity) | 拼点探宝([§8.1](#81-宝物城拼点探宝)) |
| 锦囊(Chance)/天命(Fate) | 随机事件 ±100~250([§9](#9-随机事件)) |
| 税关(Tax) | 缴税 ¥200([`game.ts:615-624`](src/core/game.ts)) |
| 商市(Stock) | 行情波动 ±100~200([`game.ts:627-644`](src/core/game.ts)) |
| 无主普通城 | 可购买(`AwaitingDecision`)([`game.ts:657-662`](src/core/game.ts)) |
| 自己的普通城 | 可免费扩军(`AwaitingDecision`)([`game.ts:664-668`](src/core/game.ts)) |
| 他人普通城 | 珍宝交涉或无事;**公道买卖成交才升级**([§5.3](#53-落他人城珍宝交涉公道买卖成交升级)) |

### 3.5 抉择(`AwaitingDecision` / `AwaitingTreasureOwner` / `AwaitingHeroPick` / `AwaitingBankruptcySettle`)
玩家做出选择后回合结束。所有玩家操作统一走 `submitCommand`([`game.ts:1068`](src/core/game.ts)),详见各机制章节。

### 3.6 回合结束与轮次(`EndTurn`)
- 回合收尾时机(`TurnEnd`)→ 结算胜负 → 推进到下一位存活玩家([`game.ts:800` `endTurn`](src/core/game.ts),[`game.ts:876` `advanceToNextActive`](src/core/game.ts))。
- **中伏跳过**:新活跃玩家若有 `skipTurns > 0`,扣 1 并跳过,继续推进([`game.ts:819-831`](src/core/game.ts))。
- **轮次计数**(`round`):所有人各行动一次 = 1 轮;回到轮次锚点时先派发 `RoundEnd` 时机 → `round + 1` → 再派发 `RoundStart`(锚点玩家破产则改用定序中首个存活者)([`game.ts:832-844`](src/core/game.ts))。轮次供名士技能冷却使用。
- 回合开始时机(`TurnStart`):新 `activeIndex` 确定后派发(含开局首回合,见 [`game.ts:446`](src/core/game.ts))。

---

## 4. 棋盘

地图数据驱动,见 `public/maps/*.json`(默认 `sanguo.json`)。

- **31 城主环**(sanguo 地图,共 40 格):三国郡县州构成单环主路,坐标按真实中国地图方位布点([`board.ts`](src/core/board.ts))。其他地图城数不同(如 zhongyuan 8 城)。
- **都城**:玩家开局所选的城,取代传统"起点"。**经过自己都城必停**(巡幸 +2 委任状、驻跸补给、结束回合);落自己都城时补给 + 招贤。
- **辅路(分岔捷径)**:一条独立辅路,起点和终点都接主路。默认走主路,只有**刚好落到辅路起点**才弹抉择([§3.3](#33-辅路入口抉择awaitingbranch))。选「入辅路」= 本回合结束(棋子留入口格);此后每回合掷骰沿辅路格推进(掷几点走几格),每格触发效果([§8.2](#82-辅路格))。
- **特殊格**:卧龙岗(招贤)、宝物城(探宝)、锦囊/天命(事件)、税关(缴税)、商市(行情)。

> 要隘捷径(函谷关 / 赤壁 / 华容道 / 剑阁 / 子午谷)是辅路入口的命名与主题包装,机制同上。

---

## 5. 地产经济

> 本作**无过路费、无升级费**:自己到达己城可选免费扩军;他人落城不升级,仅当城主对访客的珍宝交涉选择公道买卖且成交时城池才 +1 级。玩家收入全靠都城补给与卖珍宝([`economy.ts:1-2`](src/core/economy.ts) 注释)。

### 5.1 购买(`buyProperty`)
落到无主普通城,可花钱**进驻**([`economy.ts:12` `buy`](src/core/economy.ts),[`game.ts:515` `buyProperty`](src/core/game.ts)):
- 消耗现金 `purchasePrice` **+ 1 张委任状**([`game.ts:529-532`](src/core/game.ts),[`constants.ts:19` `BUY_WARRANT_COST`](src/core/constants.ts))。
- 委任状不足 → 拒绝(`NoWarrant`,UI 禁用购买按钮)([`game.ts:524-527`](src/core/game.ts))。
- 现金不足 → 拒绝(`InsufficientFunds`)([`economy.ts:13`](src/core/economy.ts))。
- **购入即为 Lv.0**([`economy.ts:19`](src/core/economy.ts),[`types.ts:56` 注释](src/core/types.ts))。

### 5.2 升级 / 扩军(免费)
**升级不花一分钱**([`economy.ts:26` `upgrade`](src/core/economy.ts)):
- **自己到达己城**:可选免费扩军 +1 级([`game.ts:545` `upgradeProperty`](src/core/game.ts),[`game.ts:664-668`](src/core/game.ts))。
- **他人到达城池不升级**:仅当城主对该访客的珍宝交涉选择**公道买卖且成交**时,城池才 +1 级(满级封顶;见 §5.3)。坐地起价 / 不交易 / 无交易发生均不升级。
- **城池等级 Lv.0 – Lv.3**(`maxLevel = 3`,等级 0..maxLevel 共 4 级,由地图配置)([`board-loader.ts:54`](src/core/board-loader.ts),[`types.ts:38`](src/core/types.ts))。购入 / 建都即 Lv.0,满级后不可再升(`AlreadyMaxLevel`)([`economy.ts:29`](src/core/economy.ts),[`types.ts:65` `canUpgrade`](src/core/types.ts))。
- 扩军**不消耗委任状**([`constants.ts:19` 注释](src/core/constants.ts))。
- 各等级城池价值(变卖价)显式定义于地图 json 的 `valueByLevel` 数组(长度 = maxLevel+1,下标 = 等级)([`types.ts:39`](src/core/types.ts))。

### 5.3 落他人城:珍宝交涉(公道买卖成交升级)
**本作没有传统"付租金"机制。** 落到他人持有的城时([`game.ts:649` `resolveProperty`](src/core/game.ts)):
1. **到达本身不升级**(升级是公道买卖成交的奖励,不白送)。
2. 然后按城主状态结算:

| 城主状态 | 处理 |
|---|---|
| 城主**有**珍宝 | 进入珍宝交涉(`AwaitingTreasureOwner`):城主可选公道买卖 / 坐地起价 / 不交易([§8.3](#83-珍宝交涉awaitingtreasureowner)) |
| 城主**无**珍宝 | 无事发生,直接结束回合([`game.ts:692-696`](src/core/game.ts)) |

---

## 6. 委任状

委任状是**买城的额度**,防止运气好的玩家一圈跑下来把城全占光([`constants.ts:16` 注释](src/core/constants.ts))。

| 事件 | 委任状变化 | 代码 |
|---|---|---|
| 开局 | 每人 **3** 张 | `constants.ts:17` `STARTING_WARRANTS` |
| 经过自己都城(巡幸,必停) | **+2** | `constants.ts:18` `WARRANTS_PER_PASS`;`game.ts` `rollAndMove` |
| 进驻(买)一座新城 | **−1** | `constants.ts:19` `BUY_WARRANT_COST`;`game.ts:532` |
| 扩军(升级) | 不消耗(升级免费) | `constants.ts:19` 注释 |

---

## 7. 名士(英雄)

### 7.1 获取
- **起手 0 位**,上限 **3 位**([`constants.ts:22` `HERO_CAPACITY`](src/core/constants.ts))。
- 获取途径:落到自己都城 / 卧龙岗时触发**招贤纳士**(三选一),从剩余名士池随机抽 3 张选 1([`game.ts:1288` `tryRecruitHero`](src/core/game.ts))。
- 名士**唯一**:已被招揽的不再出现在候选池(`recruitedHeroIds`)([`game.ts:1290`](src/core/game.ts))。
- 破产时名士释放回招贤池([`game.ts:1090` `finalizeBankruptcy`](src/core/game.ts))。

### 7.2 名士技能(时机框架,技能即数据)

技能 = 纯数据声明「什么时机(`when`,查 [`timing.ts`](src/core/timing.ts) 的 GameMoment)触发什么效果(`effect`,查 [`effects.ts`](src/core/effects.ts) 注册表)+ 参数(`params`)」,挂在 `HeroDef.skills`(一武多技);由派发器 [`game.ts:1225` `dispatchMoment`](src/core/game.ts) 按「座位序 × 技能序」确定性派发。设计说明与扩展指南(加效果一步/加技能两步/加时机三步)见 [`docs/timing-framework.md`](docs/timing-framework.md)。

| 名士 | when | effect(params) | scope | 行为 |
|---|---|---|---|---|
| 周瑜 | `BeforeMarch` | `moveBonus {steps:1}` | self | 移动步数 **+1**(每次行军前累计) |
| 曹丕 | `CashLost` | `gainCash {amount:50}` | others | 其他玩家被动失财时,自己 **+50** |
| 张星彩 | `DieRolled` | `gainIfFace {face:6, amount:20}` | any | 场上任意人掷出 **6**,自己 **+20**(非 6 静默跳过) |

- **scope**(属主与时机主体的关系,缺省 `self`):`self`=属主是主体;`others`=主体非属主;`any`=不限;`actor`=主体恰为当前行动玩家。
- **触发留痕**:击发记 `category:"skill"` 战报(detail 含 `skillFire owner/hero/skill/moment/subject`),可审计。
- 技能可有**冷却**(`cooldown`,单位=轮;键=skill.id,复用 `heroLastFired`)([`game.ts:1281` `skillReady`](src/core/game.ts))。当前三名士均无冷却。
- 破产玩家的技能不参与派发;效果内禁止同步再派发时机(派发深度 >2 直接抛错,防递归)。

---

## 8. 珍宝

### 8.1 宝物城:拼点探宝
落到宝物城(TreasureCity)([`game.ts:809` `resolveTreasureCity`](src/core/game.ts) → [`game.ts:814` `drawTreasureAt`](src/core/game.ts)):
1. 从珍宝牌堆随机抽 1 件。
2. **掷双骰(2d6 = 2–12)** 拼点([`game.ts:827-829`](src/core/game.ts))。
3. **拼点 ≥ 珍宝等级** → 获得该珍宝;**< 等级** → 珍宝放回牌堆底([`game.ts:830-838`](src/core/game.ts))。
4. 牌堆抽完后再落宝物城,无事发生([`game.ts:817-821`](src/core/game.ts))。

### 8.2 辅路格
辅路逐格推进时,每落一格触发([`game.ts:877` `resolveBranchCell`](src/core/game.ts)):

| 格类型 | 效果 |
|---|---|
| treasure | 拼点探宝(同 §8.1) |
| event | 锦囊随机事件(同 §9) |
| penalty | 中伏,`skipTurns = 1`(下回合跳过) |

### 8.3 珍宝交涉(`AwaitingTreasureOwner`)
落到他人城且城主有珍宝时,**城主**做抉择([`game.ts:902` `resolveTreasureOwner`](src/core/game.ts))。访客不可拒绝:

| 抉择 | 售价 | 说明 |
|---|---|---|
| **公道买卖**(fair) | 指导价 | 访客付指导价得宝,银两给城主;**交易达成 → 城池 +1 级**(满级封顶) |
| **坐地起价**(premium) | 指导价 × tradeMult[Lv] + tradeAdd[Lv] | 按城池当前等级查表(先乘再加);无 per-level 配置时回退旧 trade 公式(指导价 ×1.5 × 等级倍率);**不升级** |
| **不交易**(skip) | — | 无事发生 |

- 售价均为**玩家间流转**(visitor → owner),无银行注入([`game.ts:899-901` 注释](src/core/game.ts))。
- **公道买卖成交即升级**(挂在交易达成时;此后买家破产退宝**不回滚**——升级是对城主选择公道的奖励)([`game.ts` `resolveTreasureOwner` fair 分支](src/core/game.ts))。
- **先付款后交货**:成交后珍宝先进**交割托管区**(escrow),买家付清价款(可能经破产清算变卖其他资产自救)才交割;托管中的珍宝不可被买家变卖抵债(防"得宝即卖"白嫖套利);买家最终破产则托管珍宝退回卖家([`game.ts:929-942`](src/core/game.ts),[`game.ts:954-970`](src/core/game.ts))。
- 付不起价款则进入破产清算([§10](#10-破产清算))。
- 坐地起价公式见 [`treasures.ts:38` `premiumPriceOf`](src/core/treasures.ts);回退等级倍率表 [`treasures.ts:34` `CITY_LEVEL_MULTIPLIER`](src/core/treasures.ts):**Lv0=×1,Lv1=×2,Lv2=×3,Lv3=×5**(下标 = 等级,共 4 条)。地图 json 可用 `tradeMult`/`tradeAdd`(同样下标 = 等级,长度 4)per-city 配置,如 sanguo 地图翻倍城 `tradeMult = [2, 4, 6, 10]`、加价城 `tradeAdd = [300, 600, 900, 1500]`。

### 8.4 珍宝数据(见 [`treasures.ts`](src/core/treasures.ts))

牌堆共 **14** 件(展开 count 后):

| 珍宝 | 等级 | 数量 | 指导价 |
|---|---|---|---|
| 传国玉玺 | 10 | 1 | ¥3000 |
| 带血的诏书 | 9 | 1 | ¥2200 |
| 新鲜的荔枝 | 9 | 3 | ¥2200 |
| 青囊书残卷 | 5 | 5 | ¥600 |
| 小斛 | 3 | 3 | ¥300 |
| 草帽 | 1 | 1 | ¥100 |

指导价查表 [`treasures.ts` `TREASURE_PRICE`](src/core/treasures.ts)(经济 v2):Lv1-10 = 100/200/300/400/600/800/1200/1600/2200/3000 分(1~30 两);缺等级直接抛错(零兜底)。

---

## 9. 随机事件

落到锦囊(Chance)/天命(Fate)格,或辅路 event 格时,从对应池随机抽一条事件,结算 `cashDelta`([`game.ts:844` `applyRandomEvent`](src/core/game.ts))。

- **锦囊(Chance)**——偏正面([`events.ts:10` `CHANCE_EVENTS`](src/core/events.ts)):空城退敌 +250 / 草船借箭 +200 / 义士来投 +150 / 风调雨顺 +100。
- **天命(Fate)**——偏负面([`events.ts:17` `FATE_EVENTS`](src/core/events.ts)):败走麦城 −250 / 火烧连营 −200 / 痛失街亭 −150 / 中伏溃散 −100。
- 支出可能触发破产清算([§10](#10-破产清算))。

---

## 10. 破产清算

当玩家需付款但现金不足时([`game.ts:973` `payOrLiquidate`](src/core/game.ts)):

1. **现金够** → 直接扣款,继续。
2. **现金不够但有可变卖资产** → 进入清算(`AwaitingBankruptcySettle`),玩家可逐项变卖自救([`game.ts:990` `hasMarketableAssets`](src/core/game.ts)):
   - 卖珍宝:按**指导价**变现([`game.ts:1005` `sellTreasureBankruptcy`](src/core/game.ts))。
   - 卖城池:按**当前等级价值**(`valueByLevel[level]`)变现,都城不可卖([`game.ts:1017` `sellPropertyBankruptcy`](src/core/game.ts),[`economy.ts:35` `sellValueOf`](src/core/economy.ts))。
   - 遣散名士:换 **¥200**([`game.ts:1031` `cashHeroBankruptcy`](src/core/game.ts))。
   - **凑足即止**:现金已达自救线(≥债务)后,引擎**硬拒绝**后续一切变卖命令(warn「已凑足债务,不可再卖」,不靠 UI 禁用自觉;[`game.ts:1067` `assertStillOwing`](src/core/game.ts))。单笔变卖允许超额凑足。
   - 凑够债务 → 清偿继续(托管珍宝交割);凑不够 → 真破产([`game.ts:1043` `confirmBankruptcySettle`](src/core/game.ts))。
3. **无任何可变卖资产** → 直接破产。
4. **破产后果**([`economy.ts:48` `settleDebt`](src/core/economy.ts),[`game.ts:997` `finalizeBankruptcy`](src/core/game.ts)):
   - 所有资产(城池含都城、珍宝)转移给债主;无债主则销毁。
   - 名士释放回招贤池。
   - 玩家标记 `isBankrupt`,退出后续回合。

---

## 11. 关键数值表

> 每行标注代码出处。地图配置值来自 `public/maps/sanguo.json`(其他地图可能不同)。

| 数值 | 值 | 出处 |
|---|---|---|
| 目标身价(默认) | ¥30000(300 两) | `game.ts` `DEFAULT_TARGET`;地图 `targetNetWorth` |
| 起手现金(默认) | ¥10000(100 两) | `game.ts` `DEFAULT_CASH`;地图 `startingCash` |
| 座位数 | **2–8** | `game.ts:162-163` |
| 城池等级 | Lv.0–3 共 4 级(购入/建都即 Lv.0) | `types.ts:56`;地图 `maxLevel`;`board-loader.ts:54` |
| 城池变卖价 | `valueByLevel[level]`(当前等级价值) | `economy.ts:35` `sellValueOf`;地图 `valueByLevel`(长度 4) |
| 升级费 | **无**(自己到达己城可选免费扩军;公道买卖成交 +1 级) | `economy.ts:25-31` `upgrade`;`game.ts` `resolveTreasureOwner` |
| 过路费/租金 | **无**(落他人城走珍宝交涉) | `game.ts:649` `resolveProperty` |
| 起手委任状 | 3 | `constants.ts:17` `STARTING_WARRANTS` |
| 经过都城 +委任状 | 2 | `constants.ts:18` `WARRANTS_PER_PASS` |
| 买城耗委任状 | 1 | `constants.ts:19` `BUY_WARRANT_COST` |
| 名士上限 | 3 | `constants.ts:22` `HERO_CAPACITY` |
| 遣散名士换银 | ¥200 | `game.ts:1038` |
| 都城补给公式 | resupplyPerLevel × (当前等级 Lv + 1) | `economy.ts:40` `supplyFor` |
| 都城补给/级(地图) | 逐城显式:边陲 200 / 中庸 300 / 沃野 400 / 乘法城 300(分) | 地图 tile `resupplyPerLevel`(缺省回退顶层,自定义地图用);`board-loader.ts` |
| 税关缴税 | ¥200 | `game.ts:616` |
| 商市波动范围 | ±¥100~200 | `game.ts:629` |
| 拼点骰子 | 双骰 2d6(2–12) | `game.ts:827-829` |
| 珍宝等级范围 | 1–10 | `treasures.ts:5-12` |
| 珍宝牌堆总数 | 14 | `treasures.ts:5-12`(展开 count) |
| 坐地起价公式 | 指导价 × tradeMult[Lv] + tradeAdd[Lv] | `treasures.ts:38` `premiumPriceOf`;地图 `tradeMult`/`tradeAdd`(长度 4) |
| 坐地起价回退倍率 | Lv0=×2,Lv1=×3,Lv2=×4,Lv3=×5 | `treasures.ts` `CITY_LEVEL_MULTIPLIER` |
| 城池价位档(经济 v2) | 18/22/24/27/34/38/40 两七档加法城 + 30 两固定乘法城(成都/邺城/剑阁/街亭/华容道/合肥,tradeMult=[2,3,4,5]) | 地图 json;一致性守卫 `test/map-economy-guard.test.ts` |
| 城池变卖价系数 | 购价×[0.4,0.6,0.85,1.2](两取整) | 地图 `valueByLevel`;守卫测试 |
| 建城费 | 购价×50%(两取整) | 地图 `buildCost`;守卫测试 |
| 身价口径 | 仅现金 | `networth.ts:9` `netWorth` |
| 骰子 | 单骰 1–6 | `dice.ts`;`game.ts:396` |

---

## 12. AI 诸侯

两档 AI 自动决策([`bot.ts:33` `botAct`](src/core/bot.ts)):

| 抉择点 | Simple(随机) | Normal(EV 启发式) |
|---|---|---|
| 辅路入口 | 50/50 随机 | 比较辅路 EV(探宝−中伏风险)vs 主路落点价值 |
| 买城 | 50% 概率买(需现金 > 1.5×价格 + 有委任状) | 现金 > 1.5×价格且有委任状即买 |
| 扩军(免费) | 75% 概率升 | 非满级即升,满级按兵不动 |
| 招贤 | 随机选一位 | 随机选一位 |
| 珍宝交涉(城主) | fair/premium/skip 各 ~1/3 | 等级 ≥6 坐地起价,否则公道买卖;20% 概率跳过 |
| 破产清算 | 同 Normal | 优先名士→低等级珍宝→城(排除都城),卖到够再确认 |

AI 选都评分:在三候选(`offeredCapitals`)中取最高分——都城补给性价比(`resupplyPerLevel × 8 / buildCost`)+ 随机扰动(Simple 扰动 0~2.0,Normal 0~0.3)([`game.ts` `aiChooseCapital`](src/core/game.ts))。

---

## 13. UI 层约定(React,`src/app/`)

> 本节镜像 React 渲染层的实现约定(旧 `src/render/` 已删除)。规则细节以 `src/app/` 代码为权威。

- **分层**:`store/`(zustand:gameStore 存引擎 snapshot + UI 态,netStore 存联机房间态)← `controllers/`(GameController 基类做"状态桥":local.ts 单机持权威引擎 / online.ts 联机持只读引擎 + WS)→ `screens/`(setup / lobby / game / editor 四屏)+ `components/board/`(SVG 棋盘)+ `fx/`(骰子/行军/浮字/横幅/印章/音效)。
- **snapshot 驱动**:组件只订阅 store 声明式重渲;engine/controller 是带方法的实例,不进 zustand(模块级单例,registry.ts 收口)。
- **data-testid**:常量集中定义在各屏的 `testids.ts`(如 `src/app/screens/game/testids.ts`),e2e 统一 import,避免字符串拼写漂移;命名 kebab-case,容器 `xxx-panel`、条目 `xxx-item`。棋盘格仍用 `data-tile="N"`。
- **fx 编排时序**:`fx/orchestrator.ts` 把一次引擎推进翻译为 骰子→行军→浮字→印章/横幅 的表现序列(掷骰 `animateDice` → `animateMove` 行军 → `spawnFloaters` 消费 `engine.drainFloaters()` → 回合推进弹下家横幅)。UI 不得自造时序,一律走编排器。
