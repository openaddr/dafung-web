# 游戏时机框架(Timing Framework)

> 一句话:**技能/珍宝/地块/全局规则 = 纯数据声明(何时触发)+ 效果函数(做什么)**,统一挂到引擎的时机总线上,不再在 `game.ts` 各处手写散派。

## 1. 组成

| 文件 | 职责 |
|---|---|
| [`src/core/timing.ts`](../src/core/timing.ts) | 时机定义:`GameMoment` 类型 + `MOMENTS` 集中注册表(单一事实源) |
| [`src/core/effects.ts`](../src/core/effects.ts) | 效果注册表:`EFFECTS: Record<EffectId, EffectFn>` + `EffectCtx` |
| [`src/core/types.ts`](../src/core/types.ts) | `TriggerSkill`(技能即数据)挂在 `HeroDef.skills` 上(一武多技) |
| [`src/core/heroes.ts`](../src/core/heroes.ts) | 名士数据表:新增名士只改此文件(纯数据) |
| [`src/core/game.ts`](../src/core/game.ts) | 派发器 `GameEngine.dispatchMoment` + 各时机挂点 |

术语对齐(用户定义):**回合(turn)**= 一个人行动一次(`engine.turnNumber`);**轮(round)**= 所有人各行动一次(`engine.round`,由 `roundAnchor` 锚定)。

## 2. 三要素

### 时机(GameMoment,`timing.ts`)
```ts
export type GameMoment =
  | "RoundStart" | "RoundEnd"   // 一轮开始/结束(subject = roundAnchor)
  | "TurnStart"  | "TurnEnd"    // 回合开始/结束(subject = 该回合玩家)
  | "BeforeMarch" | "AfterMarch" // 行军前(掷骰前)/行军后(落格结算前)
  | "DieRolled"                  // 骰子掷出后(subject = 掷骰者,ctx.die = 骰面)
  | "CashLost";                  // 玩家被动失去银两(subject = 失财者,ctx.amount = 失财额)
```
各时机的**挂点**(唯一派发处,全在 `game.ts`):

| 时机 | 挂点 |
|---|---|
| `TurnStart` | `finishSetup`(开局首回合进 Playing 时)与 `endTurn`(新 activeIndex 确定后,含中伏跳过推进的最终结果) |
| `TurnEnd` | `endTurn()` 入口(胜负判定/结算移除前) |
| `RoundEnd` → `round += 1` → `RoundStart` | `endTurn` 轮次交替处:最后一位玩家 endTurn 且回到 `roundAnchor` 时,先 RoundEnd 再 RoundStart |
| `BeforeMarch` | `rollAndMove` 入口、掷骰之前(行军加成经 `addMarchBonus` 累计) |
| `DieRolled` | `roll` 计算出后、行军步数计算前 |
| `AfterMarch` | `rollAndMove` 移动执行完(位置/lastMove 就绪)、落格结算(驻跸必停/辅路分派/resolveLanding)之前;必停/辅路/主路三条落点分支各一处挂点,单次行军恰好触发一次 |
| `CashLost` | 被动失银处:税关、商市下跌、锦囊/天命/辅路事件损失、珍宝交涉付款(访客不可拒)。**主动买城不算** |

### 技能(TriggerSkill,`types.ts`)——技能即数据
```ts
export interface TriggerSkill {
  id: string;                                 // 唯一 id(如 "zhouyu-move+1"),同时是冷却键
  when: GameMoment;                           // 触发时机
  effect: string;                             // EffectId,查 effects.ts 注册表
  params?: Record<string, number>;            // 效果参数(纯数据,可序列化)
  cooldown?: number;                          // 冷却(单位:轮;复用 heroLastFired,键=skill.id)
  scope?: "self" | "actor" | "others" | "any"; // 属主与主体/行动者的关系,缺省 "self"
}
```

**scope 语义(定案)**——属主(owner)= 技能持有者座位,主体(subject)= 时机相关玩家座位:
- `"self"`:属主是时机主体(`owner === subject`,我的骰/我的失财/我的回合…)。
- `"others"`:主体不是属主(`owner !== subject`,别人失财/别人掷骰…)。
- `"any"`:主体不限(任何人,含属主自己)。
- `"actor"`:时机主体恰为当前行动玩家(`subject === activeIndex`,属主不限)。当前所有挂点主体即行动者,与 `"any"` 行为等价;未来出现「非行动玩家」主体的时机(如回合外失财)时二者分化。

### 效果(EffectFn,`effects.ts`)
```ts
export type EffectFn = (engine: GameEngine, ctx: EffectCtx, params: Record<string, number>) => boolean;
```
- `ctx = { moment, subject, owner, die?, amount? }`。
- 返回 `true` = 生效(派发器记战报 + 冷却);返回 `false` = 条件不满足,**静默跳过**(不记战报/冷却,如 `gainIfFace` 骰面不匹配)。
- 效果只能通过引擎方法改状态(现有效果通道:`addMarchBonus`/`takeMarchBonus`/`grantSkillCash`),浮字经 `grantSkillCash` 自动入队;战报(skill 击发行)由派发器统一记录。
- **零兜底**:EffectId 查不到 → 派发器抛错;必填 params 缺项(`req`)→ 抛错。都是数据 bug,直接崩。

## 3. 派发器(`GameEngine.dispatchMoment`)

```
dispatchMoment(moment, { subject, die?, amount? })
  ├─ 派发深度 +1;> 2 层 → 抛错(不变量校验,防递归)
  ├─ 按座位序遍历所有未破产玩家 × 每人 heroes 序 × skills 数组序:
  │    when 匹配 → scope 过滤 → cooldown 检查 → 查 EFFECTS(未知→抛错)
  │    → 执行效果;返回 true 才记 heroLastFired[skill.id] = round + logEvent("skill", …)
  └─ 派发深度 -1(finally)
```

**确定性**:同层派发顺序 = 座位序 × 技能序,与行动顺序/随机数无关;固定 seed 的对局触发序列完全可复现(`test/timing.test.ts` 稳定性断言)。

**禁递归**:效果内同步再派发时机最多嵌套一层(顶层 + 1);第 3 层直接抛错。这是不变量校验而非兜底——效果链递归是框架 bug,必须崩出来。

**零新增序列化状态**:技能从 `HEROES` 数据派生(快照只存名士 id,恢复时查表回填 `skills`);冷却复用 `heroLastFired`(键从 heroId 改为 skill.id,结构不变)。`snapshot-contract` 契约测试自动覆盖一致性。

## 4. 扩展指南

### 加一个效果(一步,`effects.ts`)
```ts
// 1. 在 EFFECTS 注册表加一项(必填参数用 req 读,缺项自动抛错)
export const EFFECTS: Record<string, EffectFn> = {
  // …
  /** 回血:params { amount } */
  heal: (engine, ctx, params) => {
    engine.grantSkillCash(ctx.owner, req(params, "amount")); // 复用引擎效果通道
    return true;
  },
};
```

### 加一个技能(两步,`heroes.ts` + 可选战报文案)
```ts
// 1. heroes.ts 给名士加一条纯数据声明(一武可多技,数组保扩展):
{
  id: "simayi", name: "司马懿", title: "冢虎", desc: "你的回合开始时 +100 分银",
  image: "/assets/heroes/hero-simayi-sgs.png",
  skills: [{ id: "simayi-turn-start-gain", when: "TurnStart", effect: "gainCash", params: { amount: 100 }, scope: "self" }],
}
// 2. 跑 bun test(现有行为断言 + snapshot-contract 自动校验)。不需要的效果实现零改动。
```

### 加一个时机(三步,`timing.ts` + `game.ts`)
```ts
// 1. timing.ts:GameMoment 加一项 + MOMENTS 注册(集中注册表,两处同文件)
export type GameMoment = … | "LandTile";
export const MOMENTS = […, "LandTile"] as const;

// 2. game.ts:在正确点位挂一个派发(时机语义写进注释:subject 是谁/ctx 带什么):
this.dispatchMoment("LandTile", { subject: this.activeIndex, amount: def.purchasePrice });

// 3. 补测试:test/timing.test.ts 断言点位(可观测副作用/时机序列);文档本表加一行。
```

## 5. 现有名士(迁移映射,行为不变)

| 名士 | 旧(HeroSkill) | 新(skills 声明) |
|---|---|---|
| 周瑜 | `{ kind:"moveBonus", steps:1 }` | `{ id:"zhouyu-move+1", when:"BeforeMarch", effect:"moveBonus", params:{steps:1}, scope:"self" }` |
| 曹丕 | `{ kind:"onOtherLoseCash", gain:50 }` | `{ id:"caopi-gain-on-other-lose", when:"CashLost", effect:"gainCash", params:{amount:50}, scope:"others" }` |
| 张星彩 | `{ kind:"onAnyRoll", face:6, gain:20 }` | `{ id:"zhangxingcai-gain-on-six", when:"DieRolled", effect:"gainIfFace", params:{face:6,amount:20}, scope:"any" }` |

战报变化:技能击发行 category 由 `"supply"` 改为 `"skill"`(detail 含 `skillFire owner/hero/skill/moment/subject/die/amount/params`,全链路可审计)。

## 6. 测试(`test/timing.test.ts`)
- 各时机点位:开局 TurnStart;一回合完整序列(BeforeMarch→DieRolled→AfterMarch→…→TurnEnd→RoundEnd→RoundStart→TurnStart);BeforeMarch 时位置未动/无骰面、AfterMarch 时位置=最终落点(capture 效果注入断言)。
- 确定性:座位序 × 技能序;固定 seed 两局触发序列完全一致。
- scope 四过滤(self/others/any/actor,缺省=self)。
- cooldown:冷却内不触发、冷却完再触发(手动轮次推进 + 真实对局 RoundStart 冷却 2 轮)。
- 破产玩家技能不触发;递归派发第 3 层抛错(一层嵌套允许);未知 EffectId / 必填参数缺失抛错。
- 行为等价:moveBonus 多技能叠加计入 bonus;gainIfFace 不匹配静默跳过(不记战报/冷却)。3 武将原有断言在 `test/game.test.ts`(断言不变)。
