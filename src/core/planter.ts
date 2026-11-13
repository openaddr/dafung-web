// ──────────────────────────── 种植件 planter(#1295/#1298)────────────────────────────
// 三层共用的场景构造能力单源:单测/无头层直接 import 本模块函数;e2e 经调试桥
// `window.__dafung.plant(op)`(#1298 新增分发口,双门禁)转发到**同一份实现**——
// 桥只出机制+分发,op 为可序列化指令联合(族 kind+参数),字段写错在 e2e 侧编译期红。
//
// 【判词(本件一处,判词归一 #1295)】giveJinnang=裸写形:生产发牌只有牌堆顶随机抽
// (drawJinnang),无「给指定牌」流程——直写是唯一通路;种的是手牌**终态**(cards 即
// 手牌全集,非追加),写后重灌派生量 jinnangHandCount(公开信息字段,模型注释单源)。
// 数值族三件判词在各自函数头注(giveTreasure/setCash 各一处;setReputation/
// setStamina 薄包族共一处),#1299。布景族四件判词在各自函数头注(placePlayer/
// grantProperty/giveTreasureFromDeck 各一处;armHero/armHeroOffer 名将候选族共一处),
// #1300。执行态族三件判词:armPhase 一处、破产终局族(armBankrupt/armDebt/
// armGameOver)共一处、armReaction 一处,#1301。确定性族两件判词:pinDice(测试
// 替身)一处、injectWarLog 一处,#1302。残块收编四件(投影族 armLanding/
// setJinnangUsedTags 共一处、armVisitor 一处、setBot 一处),#1303——force 逃生口
// 随 #1303 退役,全仓非常规通道只剩 plant(场景字段种植)+ callEngine(公共方法
// 直呼)两条。
// 生产零 import 本文件不受限(与 testing.ts「仅 test/ 可 import」的区别):桥
// (src/app/controllers/registry.ts)必须转发到与单测相同的实现,这是三层共用契约
// 本身;测试专用属性由双门禁桥闸守住,不靠 import 规则。
//
// 形制纪律(#1295):每族一个种植件,形制写死在实现(不设运行时开关);被测环永不
// 种植件——种植只负责被测环之前的布置。再缺能力=补种植件(op 联合加 kind),force
// 不复活(#1303 收口退役)。
import type { EnginePhase, GameEngine, TurnPhase } from "./authority";
import { fullDefenseOf, resetToFull } from "./defense";
import { heroById } from "./heroes";
import { jinnangCardOf } from "./jinnang";
import type { LogEvent } from "./model";
import type { ReactionPayload, ReactionView } from "./reaction-window";
import type { TreasureDef } from "./treasures";

/** 塞指定锦囊指令(裸写形):把 seat 的锦囊手牌直写为 cards 终态。
 *  cards=牌目录 id(中文牌名);空数组=清空手牌;重复牌原样保留(牌库同 id 多副本)。 */
export interface GiveJinnangOp {
  kind: "giveJinnang";
  seat: number;
  cards: string[];
}

/** 塞指定珍宝指令(裸写形):把 seat 的珍宝位直写为 treasures 终态(全集替换,非追加;
 *  保起始珍宝的追加语义由测试侧读现值拼全集——snap 通路,形制仍一处)。
 *  珍宝对象不校验目录(与 giveJinnang 相反,判词见头注)。 */
export interface GiveTreasureOp {
  kind: "giveTreasure";
  seat: number;
  treasures: TreasureDef[];
}

/** 改现金指令(裸写形):把 seat 的现金直写为 cash 终态。 */
export interface SetCashOp {
  kind: "setCash";
  seat: number;
  cash: number;
}

/** 声望指令(薄包公共方法):把 seat 的声望种到 reputation 终态(对外绝对值语义)。 */
export interface SetReputationOp {
  kind: "setReputation";
  seat: number;
  reputation: number;
}

/** 体力指令(薄包公共方法):把 seat 的体力种到 stamina 终态(对外绝对值语义;
 *  夹紧 0~100 随公共口——超界种值落夹紧终态)。 */
export interface SetStaminaOp {
  kind: "setStamina";
  seat: number;
  stamina: number;
}

/** 摆位指令(裸写形):把 seat 摆到 position 绝对格位(终态摆位,#1300)。 */
export interface PlacePlayerOp {
  kind: "placePlayer";
  seat: number;
  position: number;
}

/** 授房产/等级指令(裸写形):让 seat 名下 propertyId 这块地等级=level(未持有则
 *  入册持有行,已持有则改等级,#1300)。 */
export interface GrantPropertyOp {
  kind: "grantProperty";
  seat: number;
  propertyId: string;
  level: number;
}

/** 防御值指令(裸写形):让 seat 名下 propertyId 这座城的防御值=defense 终态(#1387)。 */
export interface SetDefenseOp {
  kind: "setDefense";
  seat: number;
  propertyId: string;
  defense: number;
}

/** 塞名将指令(裸写形):把 heroId 名将以槽位行追加进 seat 麾下(skillIds 缺省=整池
 *  原序,#1300)。 */
export interface ArmHeroOp {
  kind: "armHero";
  seat: number;
  heroId: string;
  skillIds?: string[];
}

/** 塞招贤候选指令(裸写形):把招贤候选终态整体替换为 heroIds 依序的候选行
 *  (skillIds=各行全池原序;行序=卷轴陈列序,#1300)。 */
export interface ArmHeroOfferOp {
  kind: "armHeroOffer";
  heroIds: string[];
}

/** 牌堆源珍宝指令(裸写形):把 seat 的珍宝位直写为真牌堆前 count 件实例(终态
 *  替换,#1300)。 */
export interface GiveTreasureFromDeckOp {
  kind: "giveTreasureFromDeck";
  seat: number;
  count: number;
}

/** 相位/活跃方补丁(#1301):三字段按需选填,只写给出的字段。 */
export interface ArmPhasePatch {
  /** 对局大相位(Setup/Playing/GameOver)。 */
  phase?: EnginePhase;
  /** 回合状态机相位(权威 TurnPhase 全集)。 */
  turnPhase?: TurnPhase;
  /** 活跃座位(0 基,越界炸)。 */
  activeIndex?: number;
}

/** 改相位/活跃方指令(裸写形):把对局钉到指定相位/回合相位/活跃方(#1301,
 *  判词见 armPhase 函数头注)。 */
export interface ArmPhaseOp extends ArmPhasePatch {
  kind: "armPhase";
}

/** 破产印指令(裸写形):把 seat 玩家置破产印(isBankrupt,#1301,判词见破产终局族
 *  共同头注)。 */
export interface ArmBankruptOp {
  kind: "armBankrupt";
  seat: number;
}

/** 挂债清算窗指令(裸写形):pendingDebt 直写(creditor=座位号,过网可序列化,
 *  实现内解析成 Player 引用)+ turnPhase=AwaitingBankruptcySettle 同拍(#1301,
 *  判词见破产终局族共同头注)。 */
export interface ArmDebtOp {
  kind: "armDebt";
  amount: number;
  creditor: number | null;
}

/** 终局宣告指令(裸写形):isOver+winner+phase=GameOver 一体直写(winnerSeat 解析
 *  成 Player 引用,#1301,判词见破产终局族共同头注)。 */
export interface ArmGameOverOp {
  kind: "armGameOver";
  winnerSeat: number;
}

/** 挂反应载荷指令(裸写形):直种 pendingReaction 挂起态(view/payload 由种植者
 *  给形,seq 引擎自增取号,answers 恒空,turnPhase=AwaitingReaction 同拍,#1301,
 *  判词见 armReaction 函数头注)。 */
export interface ArmReactionOp {
  kind: "armReaction";
  view: ReactionView;
  payload: ReactionPayload;
}

/** 钉骰子通道(#1302):行程骰(march=dice.roll,rollAndMove 消费)或拼点骰
 *  (duel=dice.rollDie,拼点结算消费)——两注入口互不串队(判词见 pinDice)。 */
export type PinDiceChannel = "march" | "duel";

/** 钉骰子指令(测试替身):channel 注入口接下来 values.length 次掷骰依序取
 *  values(判词见 pinDice 函数头注)。 */
export interface PinDiceOp {
  kind: "pinDice";
  channel: PinDiceChannel;
  values: number[];
}

/** 战报注入指令(合成行直种):向对局日志追加一条 LogEvent(判词见 injectWarLog
 *  函数头注)。 */
export interface InjectWarLogOp {
  kind: "injectWarLog";
  category: LogEvent["category"];
  player: string | null;
  brief: string;
  detail: string;
  amount?: number;
}

/** 落格投影指令(裸写形,#1303):pendingLand(决策上下文)+ lastLandOutcome(表现
 *  投影)一体置值;landing=null=双字段一体清(停车坪空闲态,判词见 armLanding)。 */
export interface ArmLandingOp {
  kind: "armLanding";
  landing:
    | null
    | { kind: "PropertyAvailable"; propertyId: string }
    | { kind: "OwnProperty"; propertyId: string };
}

/** 交涉挂起载荷指令(裸写形,#1303):直种 treasureVisitor(判词见 armVisitor)。 */
export interface ArmVisitorOp {
  kind: "armVisitor";
  /** 所访之城(目录内,def 现查)。 */
  propertyId: string;
  /** 城主座位号(引擎 ownerIdx 同形)。 */
  ownerSeat: number;
}

/** 座位旗标指令(裸写形,#1303):翻/回 seat 的 isBot(判词见 setBot)。 */
export interface SetBotOp {
  kind: "setBot";
  seat: number;
  bot: boolean;
}

/** 出牌用过标签投影指令(裸写形,#1303,判词同投影族见 armLanding):把回合内
 *  已用标签投影直写为 tags 终态。 */
export interface SetJinnangUsedTagsOp {
  kind: "setJinnangUsedTags";
  tags: string[];
}

/** 种植指令联合(可序列化,#1298 giveJinnang 族首发;其余族按迁移票逐族扩展
 *  kind,#1299-#1303——联合即扩展位,桥分发 switch 穷尽校验)。 */
export type PlantOp =
  | GiveJinnangOp
  | GiveTreasureOp
  | SetCashOp
  | SetReputationOp
  | SetStaminaOp
  | PlacePlayerOp
  | GrantPropertyOp
  | SetDefenseOp
  | ArmHeroOp
  | ArmHeroOfferOp
  | GiveTreasureFromDeckOp
  | ArmPhaseOp
  | ArmBankruptOp
  | ArmDebtOp
  | ArmGameOverOp
  | ArmReactionOp
  | PinDiceOp
  | InjectWarLogOp
  | ArmLandingOp
  | ArmVisitorOp
  | SetBotOp
  | SetJinnangUsedTagsOp;

/** 塞指定锦囊(判词见文件头注):手牌终态=cards,派生量 jinnangHandCount 同步重灌。
 *  目录外牌/越界座位当场炸(零兜底:种错的场要响)。 */
export function giveJinnang(e: GameEngine, seat: number, cards: string[]): void {
  const p = e.players[seat];
  if (p == null) throw new Error(`giveJinnang:座位 ${seat} 不存在(共 ${e.players.length} 席)`);
  for (const id of cards) jinnangCardOf(id); // 目录校验(未知 id 抛错,单源 jinnang.ts)
  p.jinnangHand = [...cards];
  p.jinnangHandCount = p.jinnangHand.length;
}

/** 【判词(giveTreasure 一处,#1299)】塞指定珍宝=裸写形:生产珍宝入手只随机遇/探宝/
 *  交易/变卖结算,无「给指定珍宝」流程(落点与时机不可控)——直写是唯一通路。语义=
 *  **终态替换**(与 giveJinnang 同款,站点多数派):关中谱起手珍宝 2 件/人,「保起始
 *  珍宝再添几件」的站点(scrolls 交涉/变卖)由测试侧读现值拼全集,形制仍一处。
 *  **不校验目录**(与 giveJinnang 相反):站点素材含目录外虚构珍宝(gem-1 类,只进
 *  计数位被测面——席位格珍宝计数/总览槽位,不回查目录);错 id 流入装裱卡渲染路径
 *  (交涉/变卖清单)时由 #521 的实例 id 回查目录抛错——炸点在被测面自身,种植件
 *  不加防(零兜底:不替测试作者拦「理论上渲染不到」的素材)。越界座位当场炸。 */
export function giveTreasure(e: GameEngine, seat: number, treasures: TreasureDef[]): void {
  const p = e.players[seat];
  if (p == null) throw new Error(`giveTreasure:座位 ${seat} 不存在(共 ${e.players.length} 席)`);
  p.treasures = [...treasures];
}

/** 【判词(setCash 一处,#1299)】改现金=裸写形:走结算通道都有种植段不要的副作用——
 *  grantSkillCash 是效果注册表内部通道(#188 口径「UI/bot 不得使用」),直调会派发
 *  「技能得银」假战报污染日志断言面;payOrLiquidate 在现金不足时当场引爆清算弹窗/
 *  自救支线。种植段要的是**终态**,直写字段是唯一通路。派生量零重灌:身价=现金+地产
 *  活算(无存储字段),直写后无需重灌。越界座位当场炸;数值不校验
 *  (负现金/巨款是测试作者的场景决定,不加防)。 */
export function setCash(e: GameEngine, seat: number, cash: number): void {
  const p = e.players[seat];
  if (p == null) throw new Error(`setCash:座位 ${seat} 不存在(共 ${e.players.length} 席)`);
  p.cash = cash;
}

/** 【判词(setReputation/setStamina 共一处,#1299)】声望/体力=**薄包公共方法**(两件
 *  形制同款,判词归一到此):对外绝对值语义(测试要终态),内部换算 delta 走引擎
 *  唯一写口 addReputation/addStamina——公共口的不变量天然全保真。声望:无夹紧
 *  (#1090 去夹紧),绝对值精确可达;ReputationChanged 时机随唯一写口正常广播
 *  (事件流多一条,战报零染——断言事件流序列的被测面需择位,现状无此面)。
 *  体力:夹紧 0~100 随公共口,种超界值=落夹紧终态(这正是公共口语义,不加防)。
 *  历史依赖场景(如「连续扣到耗竭」)由测试侧多次调本件或直呼公共方法。越界座位炸。 */
export function setReputation(e: GameEngine, seat: number, reputation: number): void {
  const p = e.players[seat];
  if (p == null) throw new Error(`setReputation:座位 ${seat} 不存在(共 ${e.players.length} 席)`);
  e.addReputation(seat, reputation - p.reputation);
}

export function setStamina(e: GameEngine, seat: number, stamina: number): void {
  const p = e.players[seat];
  if (p == null) throw new Error(`setStamina:座位 ${seat} 不存在(共 ${e.players.length} 席)`);
  e.addStamina(seat, stamina - p.stamina);
}

/** 【判词(placePlayer 一处,#1300)】摆位布防=裸写形:行军命令只归活跃座位自身回合,
 *  「把任意座位挪到指定格」无公共命令,真实走位到断言前提位(拦检窗开窗前提=行人贴
 *  都城前一格之类)不可控——直写是唯一通路。**落格结算不发火正是种植段语义**:摆位
 *  是被测环(落格结算/开窗/呈现)的前一拍布置,结算归被测环的真命令链。驱动形(被测
 *  环=落格结算本身)不另设摆位件——钉骰(#1302 钉骰族)+行军公共口(rollAndMove)
 *  组合即达,头注在此立据。终态摆位=position 绝对格位;「都城前一格」等算式由测试侧
 *  读现值拼(读 capitalIndex/board.count,react-scrolls「读现值拼全集」同款)。出盘面
 *  格位与越界座位当场炸(零兜底:种错的场要响)。 */
export function placePlayer(e: GameEngine, seat: number, position: number): void {
  const p = e.players[seat];
  if (p == null) throw new Error(`placePlayer:座位 ${seat} 不存在(共 ${e.players.length} 席)`);
  if (!Number.isInteger(position) || position < 0 || position >= e.board.count)
    throw new Error(`placePlayer:格位 ${position} 出界(盘面 ${e.board.count} 格)`);
  p.position = position;
}

/** 【判词(grantProperty 一处,#1300)】授房产/等级=裸写形:生产授产只经购买(购地
 *  命令,落点受行军路线+现金约束)与升级(到达己城触发,且扩军命令只作用于活跃座位
 *  自身待决决策)结算,无「授指定城/指定等级」流程——直写是唯一通路。持有行按
 *  propertyId **upsert**:已持有=改等级、未持有=入册——「seat 名下这块地,等级=
 *  level」的同一终态语义两面(授城/拉级/满级三形一体)。行形状单源 PropertyHolding,
 *  group 与 maxLevel 自城目录(catalog PropertyDef)派生:loadMap 校验 group 必配、
 *  maxLevel 地图级必配,无兜底可加;旧站点手写行的 purchasePrice:1000 是已删字段的
 *  死重量(持有价零玩法消费,模型注释单源),随收编退役。目录外地块与越界座位当场
 *  炸;level 原不校验(负级/超上限是测试作者的场景决定),防御值(#1386)入模后
 *  持有行必带防御——等级写定即 resetToFull,越界等级在满值表处响亮抛错(越界等级
 *  无满值可回,种不出的状态不静默);「种受损态」由 setDefense 在本件之后叠加。 */
export function grantProperty(
  e: GameEngine,
  seat: number,
  propertyId: string,
  level: number,
): void {
  const p = e.players[seat];
  if (p == null) throw new Error(`grantProperty:座位 ${seat} 不存在(共 ${e.players.length} 席)`);
  const def = e.catalog.get(propertyId);
  if (def == null) throw new Error(`grantProperty:目录外地块 ${propertyId}`);
  const held = p.properties.find((h) => h.propertyId === propertyId);
  if (held) {
    held.level = level;
    resetToFull(held); // 等级一变防御即重置满值(与生产升级/降级同口径,#1386)
    return;
  }
  p.properties.push({
    propertyId,
    group: def.group,
    level,
    maxLevel: def.maxLevel,
    defense: fullDefenseOf(level), // 入册即满值(满值表单源;越界等级响亮抛错,#1386)
  });
}

/** 【判词(setDefense 一处,#1387)】种防御值=裸写形:生产防御值只经等级变动重置满值
 *  (resetToFull 挂点:购入/建都/赐城/扩军/公道买卖升级/破产转移/旧 demolish 降级)
 *  与火焰伤害结算(applyFireDamage)变动,平时不回复——「直接摆到指定受损/满溢态」
 *  无生产流程,走真通路需耗点数伤害且过目标门,断言面前置不可控,直写是唯一通路。
 *  未持有城当场炸(无主城不存在防御值);数值不校验(负值/超满值是测试作者的场景
 *  决定,同 setCash 口径,响在被测面)。 */
export function setDefense(e: GameEngine, seat: number, propertyId: string, defense: number): void {
  const p = e.players[seat];
  if (p == null) throw new Error(`setDefense:座位 ${seat} 不存在(共 ${e.players.length} 席)`);
  const held = p.properties.find((h) => h.propertyId === propertyId);
  if (held == null)
    throw new Error(`setDefense:${propertyId} 不在座位 ${seat} 名下(无主城无防御值)`);
  held.defense = defense;
}

/** 【判词(armHero/armHeroOffer 名将候选族共一处,#1300)】塞名将/候选=裸写形:麾下
 *  槽位与招贤候选都无「授指定将/指定候选」公共命令——生产仅招贤卷轴随机抽 3
 *  (offerHeroes shuffle+slice,授技预掷 rollGrantedSkills)与机遇效果 grantHero
 *  一途,落点与时机不可控,直写是唯一通路。签名与白盒先例统一(testing.ts
 *  armHero/heroOffer,#785 槽位化):armHero=槽位行**追加**(HeroSlot 形状单源
 *  roster;skillIds 缺省=整池原序,显式=实授子集——种植者定预掷结果,引擎落定原样
 *  入槽不重掷);armHeroOffer=候选**终态整体替换**(e.offeredHeroes 单字段,候选行
 *  {def,skillIds} 形状单源 recruitment,行序=卷轴陈列序,skillIds=各行全池)。候选
 *  挂活跃方语境(e.offeredHeroes 全局无座位维度——座位钉归相位族,#1301),故本件
 *  无 seat 参数。名将 id 经 heroById 目录回查(扩展包名将同表,main.tsx 顶层注册
 *  进 HEROES),目录外当场炸;越界座位(armHero)当场炸。 */
export function armHero(e: GameEngine, seat: number, heroId: string, skillIds?: string[]): void {
  const p = e.players[seat];
  if (p == null) throw new Error(`armHero:座位 ${seat} 不存在(共 ${e.players.length} 席)`);
  const hero = heroById(heroId); // 目录外炸(零兜底)
  p.heroes.push({
    heroId: hero.id,
    skillIds: skillIds ?? [...hero.skillPool],
    lastFired: {},
    marks: {}, // 技能标记容器(#1377):标记感知构造(缺容器写标记会炸,HeroSlot.marks 头注)
  });
}

export function armHeroOffer(e: GameEngine, heroIds: string[]): void {
  e.offeredHeroes = heroIds.map((id) => {
    const def = heroById(id); // 目录外炸(零兜底)
    return { def, skillIds: [...def.skillPool] };
  });
}

/** 【判词(giveTreasureFromDeck 一处,#1300)】牌堆源珍宝=裸写形,与 giveTreasure
 *  (测试侧供 def)互补的一件:素材=**真牌堆实例**(e.treasureDeck 前 count 件),
 *  保 UI 按 def 现算的渲染面(交涉价签/变卖清单的档位价/名/描述)字段全真实——
 *  虚构 def 在这些面会画错,giveTreasure 的「不校验目录」判词只覆盖计数位被测面。
 *  语义=**终态替换**(与 giveTreasure 同款,三站点多数派;「保起始珍宝再添」的追加
 *  形由测试侧读现值拼全集,同 giveTreasure 判词口径)。牌堆**只读不收缩**(slice 非
 *  splice):抽走实例会扰动后续机遇抽珍宝的牌序,种植件不碰对局随机面。count 超牌堆
 *  深度与越界座位当场炸(零兜底:静默短发是掩盖)。 */
export function giveTreasureFromDeck(e: GameEngine, seat: number, count: number): void {
  const p = e.players[seat];
  if (p == null)
    throw new Error(`giveTreasureFromDeck:座位 ${seat} 不存在(共 ${e.players.length} 席)`);
  if (count > e.treasureDeck.length)
    throw new Error(`giveTreasureFromDeck:count ${count} 超牌堆深度 ${e.treasureDeck.length}`);
  p.treasures = e.treasureDeck.slice(0, count);
}

/** TurnPhase/EnginePhase 联合的运行时影子(op 过桥是无类型 JSON,未知相位要在
 *  种植点响,不落进 UI 慢性烂);联合增员时此处漏登=种植点当场炸(响,不静默)。 */
const TURN_PHASES: ReadonlySet<TurnPhase> = new Set([
  "Roll",
  "AwaitingDecision",
  "AwaitingHeroPick",
  "AwaitingEncounter",
  "AwaitingJinnang",
  "AwaitingTreasureOwner",
  "AwaitingBankruptcySettle",
  "AwaitingReaction",
  "Land",
  "EndTurn",
  "GameOver",
]);
const ENGINE_PHASES: ReadonlySet<EnginePhase> = new Set(["Setup", "Playing", "GameOver"]);
/** LogEvent.category 运行时影子(injectWarLog 校验用,同 TURN_PHASES 口径:联合
 *  增员时此处漏登=种植点当场炸)。 */
const LOG_CATEGORIES: ReadonlySet<LogEvent["category"]> = new Set([
  "header",
  "system",
  "roll",
  "buy",
  "upgrade",
  "trade",
  "supply",
  "halt",
  "setup",
  "skill",
  "victory",
  "final",
  "cmd",
  "room",
]);

/** 座位界内断言(执行态族共用):越界/非整数当场炸(零兜底:种错的场要响)。 */
function assertSeat(who: string, e: GameEngine, seat: number): void {
  if (!Number.isInteger(seat) || seat < 0 || seat >= e.players.length)
    throw new Error(`${who}:座位 ${seat} 越界(共 ${e.players.length} 席)`);
}

/** 【判词(armPhase 一处,执行态族 #1301)】改相位/活跃方=裸写形:相位迁移是回合
 *  引擎状态机的内部结算产物(行军落格/出牌/反应窗各相位各有其到达命令链),「把
 *  对局钉到任意相位/任意活跃方」无单步公共命令,绕行命令链=假场景——直写+控制器
 *  sync 重灌派生量(interactive/viewSeat)是唯一通路(单测白盒 forceTurnPhase 同款
 *  先例)。三字段(phase/turnPhase/activeIndex)一个 kind 归一,按需选填(站点字段
 *  集不同在调用侧表达,不拆 kind);全空补丁当场炸(空种植=种了个寂寞,响)。
 *  turnPhase/phase 按运行时全集校验(未知相位当场炸),activeIndex 越界当场炸。 */
export function armPhase(e: GameEngine, patch: ArmPhasePatch): void {
  const fields = Object.keys(patch).filter((k) => patch[k as keyof ArmPhasePatch] !== undefined);
  if (fields.length === 0) throw new Error("armPhase:空补丁(至少指定一个相位字段)");
  if (patch.phase != null) {
    if (!ENGINE_PHASES.has(patch.phase)) throw new Error(`armPhase:未知相位 ${patch.phase}`);
    e.phase = patch.phase;
  }
  if (patch.turnPhase != null) {
    if (!TURN_PHASES.has(patch.turnPhase))
      throw new Error(`armPhase:未知回合相位 ${patch.turnPhase}`);
    e.turnPhase = patch.turnPhase;
  }
  if (patch.activeIndex != null) {
    assertSeat("armPhase", e, patch.activeIndex);
    e.activeIndex = patch.activeIndex;
  }
}

/** 【判词(破产终局族 armBankrupt/armDebt/armGameOver 共一处,#1301)】破产由缴支
 *  结算产生(现金不足触发清算支线,债务数值与终局胜者不可钉),「即时破产印/挂债
 *  清算窗/直判终局」断言面形态无公共命令可达(清算通路需整局推演到破产)——直写
 *  是唯一通路。三件按字段集拆细:armBankrupt=玩家破产印(isBankrupt,席位格/总览
 *  灰化挂点形);armDebt=挂债清算窗(pendingDebt+AwaitingBankruptcySettle 一体直写
 *  ——引擎破产路径同拍双写,拆开即窗悬相位不自洽;creditor 过网带座位号,实现内
 *  解析成 Player 引用保 op 可序列化);armGameOver=终局宣告(isOver+winner+phase=
 *  GameOver 一体,引擎终局写入同款三件套)。越界座位当场炸;amount 数值不校验
 *  (债务是场景决定,同 setCash 口径)。 */
export function armBankrupt(e: GameEngine, seat: number): void {
  assertSeat("armBankrupt", e, seat);
  e.players[seat].isBankrupt = true;
}

export function armDebt(e: GameEngine, amount: number, creditor: number | null): void {
  if (creditor != null) assertSeat("armDebt", e, creditor);
  e.pendingDebt = {
    amount,
    creditor: creditor == null ? null : e.players[creditor],
  };
  e.turnPhase = "AwaitingBankruptcySettle";
}

export function armGameOver(e: GameEngine, winnerSeat: number): void {
  assertSeat("armGameOver", e, winnerSeat);
  e.isOver = true;
  e.winner = e.players[winnerSeat];
  e.phase = "GameOver";
}

/** 【判词(armReaction 一处,执行态族 #1301)】挂反应载荷=裸写形:反应窗由持牌+
 *  时机判定产生(引擎只在对方真实打出反应牌时经 openReactionWindow 挂窗,挂点散在
 *  结算中段),「凭空开一道窗」无公共命令——直种 pendingReaction 挂起态是窗态唯一
 *  种植口。字段与 openReactionWindow 产物一一同构:seq=jinnangSeq 自增取号同款、
 *  answers 恒空、turnPhase=AwaitingReaction 同拍(拆开即窗悬相位不自洽);view/
 *  payload 由种植者给形(windowMs 显式给值=免与默认展示档赛跑的站点惯例)。bot 即席
 *  代答**不模拟**(种的是挂起态,应答归被测环真命令链 respondReaction)。view 公开面
 *  座位(userSeat/targetSeats/queriedBySeat/ownerSeat)越界当场炸;payload 续结算
 *  载荷不校验(消费面=被测环的续结算,引擎自有断言)。 */
export function armReaction(e: GameEngine, view: ReactionView, payload: ReactionPayload): void {
  const seats = (s: number[]) => s.forEach((x) => assertSeat("armReaction", e, x));
  if (view.kind === "jinnang") {
    assertSeat("armReaction", e, view.userSeat);
    seats(view.targetSeats);
    seats(view.queriedBySeat);
  } else {
    assertSeat("armReaction", e, view.userSeat);
    assertSeat("armReaction", e, view.ownerSeat);
  }
  e.jinnangSeq += 1;
  e.pendingReaction = { seq: e.jinnangSeq, view, answers: [], payload };
  e.turnPhase = "AwaitingReaction";
}

/** 【判词(pinDice 一处,确定性族 #1302)】钉骰子=**测试替身**(非场景字段):
 *  骰值单源=种子 rng 全局流(Dice 构造注入,唯一旋钮 seed,局中无「钉骰」公共
 *  命令),「接下来 N 次掷依序取定值」只能替换骰口——测试替身是唯一通路(先例
 *  react-reaction marchQueue/diceQueue 局部形态,#303 立配方,本件收编归一)。语义
 *  三件套:①按值序替换骰口(每次掷取队列下一值);②**耗尽自还原**(只钉接下来
 *  N 次掷=局部确定性,不钉死后续世界);③**种子 rng 不消耗**(替身命中不触摸
 *  mulberry32,还原后种子流无缝续走——同种子未钉对照引擎逐位一致)。行程/拼点
 *  **分属两个注入口互不串队**(既有事实,#303 实锤:行程骰=dice.roll 属性,由
 *  rollAndMove 消费;拼点骰=dice.rollDie,由拼点结算消费;探宝拼点走 nextFloat
 *  第三口,两队列都不吃)——钉 march 不改 duel 骰流,反之亦然。种的是运行时替身
 *  非引擎字段:快照/重灌不动它,对局继续即按值消费。空值队列(钉零骰=种了个寂寞)
 *  与非 1..6 整数(骰面契约,越界值会静默扭曲行军算术)当场炸。 */
export function pinDice(e: GameEngine, channel: PinDiceChannel, values: number[]): void {
  if (values.length === 0) throw new Error("pinDice:空值队列(至少钉一个骰值)");
  for (const v of values)
    if (!Number.isInteger(v) || v < 1 || v > 6)
      throw new Error(`pinDice:骰值 ${v} 出 1..6 契约(单骰 1–6,单源 dice.ts)`);
  if (channel === "march") {
    const orig = e.dice.roll.bind(e.dice);
    const queue = [...values];
    e.dice.roll = () => {
      const v = queue.shift()!;
      if (queue.length === 0) e.dice.roll = orig; // 耗尽自还原(局部确定性)
      return { die: v }; // 替身命中不触摸种子 rng
    };
    return;
  }
  const orig = e.dice.rollDie.bind(e.dice);
  const queue = [...values];
  e.dice.rollDie = () => {
    const v = queue.shift()!;
    if (queue.length === 0) e.dice.rollDie = orig;
    return v;
  };
}

/** 【判词(injectWarLog 一处,确定性族 #1302)】战报注入=合成行直种:对局日志是
 *  结算产物流(引擎只按真实对局事件落行),「指定内容的任意时刻行」无生产流程
 *  (开局存量约一窗,凑任意行需数百真实回合不可达)——直种是唯一通路(先例
 *  react-war-report 的 e.log.push 合成行;行形状单源 LogEvent)。写口走引擎唯一
 *  落行通道 logEvent:ts/round/turn 派生戳与真行**同源保真**(planter 模块自身禁读
 *  墙钟——ADR-0057 确定性源码闸冻结清单,ts 唯一合法来源=引擎写口内部),行本体
 *  字段(category/player/brief/detail/amount)由种植者给形。category 按运行时全集
 *  校验(未知类当场炸——渲染端按类白名单消费战报,种错类即假场景);文本字段不
 *  校验(合成行是测试作者的素材,同 giveTreasure 口径)。 */
export function injectWarLog(e: GameEngine, line: Omit<InjectWarLogOp, "kind">): void {
  if (!LOG_CATEGORIES.has(line.category))
    throw new Error(`injectWarLog:未知日志类别 ${String(line.category)}`);
  e.logEvent(line.category, line.player, line.brief, line.detail, line.amount);
}

/** 【判词(投影族 armLanding/setJinnangUsedTags 共一处,#1303)】落格投影/用过标签
 *  投影=裸写形:两者都是结算的派生呈现/决策态——pendingLand(决策上下文)与
 *  lastLandOutcome(表现投影)由落格结算一并置值(movement-flow 落格分流同拍双写),
 *  jinnangUsedTags 由出牌结算累积、endTurn 清;「指定投影形态」无生产流程(行军落点
 *  由骰流驱动,推演到指定落格不可控)——直写是唯一通路。armLanding 两字段**一体置值/
 *  一体清**(拆开即表现与决策不自洽,react-solo 购地例布场注同判词);停车坪清投影
 *  (landing=null)=「决策卷轴不遮顶栏」的空闲态形(rack/narrow/layout/float-skeleton
 *  八站多数派)。propertyId 是唯一句柄(与 pendingLand 同模式),def 目录现查(目录外
 *  当场炸);形制与归属矛盾当场炸(PropertyAvailable 须无主/OwnProperty 须有主——
 *  owner 按持有关系解析,与生产 settleMarchLanding 同源,不另设座位参数)。
 *  setJinnangUsedTags=终态替换,标签文本不校验(渲染面按文本出章,素材由测试作者
 *  定,同 giveTreasure 口径)。 */
export function armLanding(e: GameEngine, landing: ArmLandingOp["landing"]): void {
  if (landing == null) {
    e.lastLandOutcome = null;
    e.pendingLand = null;
    return;
  }
  const def = e.catalog.get(landing.propertyId);
  if (def == null) throw new Error(`armLanding:目录外地块 ${landing.propertyId}`);
  const owner = e.findOwner(landing.propertyId);
  if (landing.kind === "PropertyAvailable") {
    if (owner != null) throw new Error(`armLanding:${landing.propertyId} 已有主,可购投影形制矛盾`);
    e.pendingLand = { kind: "PropertyAvailable", propertyId: landing.propertyId };
    e.lastLandOutcome = { kind: "PropertyAvailable", property: def };
    return;
  }
  if (owner == null) throw new Error(`armLanding:${landing.propertyId} 无主,己城投影形制矛盾`);
  e.pendingLand = { kind: "OwnProperty", propertyId: landing.propertyId };
  e.lastLandOutcome = { kind: "OwnProperty", property: def, owner };
}

/** 【判词(armVisitor 一处,#1303)】交涉挂起载荷=裸写形:珍宝交涉窗由落珍宝城
 *  结算产生(挂点散在落格结算中段),「凭空挂交涉」无公共流程——直写是唯一通路。
 *  字段与引擎挂点产物同构:def 按目录现查(目录外当场炸),ownerIdx=城主座位号
 *  (引擎存座位号同形,op 过网可序列化)。越界座位当场炸。 */
export function armVisitor(e: GameEngine, propertyId: string, ownerSeat: number): void {
  assertSeat("armVisitor", e, ownerSeat);
  const def = e.catalog.get(propertyId);
  if (def == null) throw new Error(`armVisitor:目录外地块 ${propertyId}`);
  e.treasureVisitor = { def, ownerIdx: ownerSeat };
}

/** 【判词(setBot 一处,#1303)】座位旗标=裸写形:bot 归属由房间座位构造决定
 *  (EngineConfig seats.isBot,开局后无改动命令),单机内「改座位归属」无玩家级
 *  命令——直写是唯一通路(先例 react-jinnang-peek 翻人:bot 即席代答按 isBot 判定
 *  (reaction-window,ADR-0017),翻人让窗挂起到应答拍)。越界座位当场炸。 */
export function setBot(e: GameEngine, seat: number, bot: boolean): void {
  assertSeat("setBot", e, seat);
  e.players[seat].isBot = bot;
}

export function setJinnangUsedTags(e: GameEngine, tags: string[]): void {
  e.jinnangUsedTags = [...tags];
}

/** 种植指令分发单源:桥 plant(op) 与单测共用的唯一入口(未知 kind 当场炸——
 *  分发口不吞错,零兜底)。 */
export function applyPlant(e: GameEngine, op: PlantOp): void {
  switch (op.kind) {
    case "giveJinnang":
      giveJinnang(e, op.seat, op.cards);
      return;
    case "giveTreasure":
      giveTreasure(e, op.seat, op.treasures);
      return;
    case "setCash":
      setCash(e, op.seat, op.cash);
      return;
    case "setReputation":
      setReputation(e, op.seat, op.reputation);
      return;
    case "setStamina":
      setStamina(e, op.seat, op.stamina);
      return;
    case "placePlayer":
      placePlayer(e, op.seat, op.position);
      return;
    case "grantProperty":
      grantProperty(e, op.seat, op.propertyId, op.level);
      return;
    case "setDefense":
      setDefense(e, op.seat, op.propertyId, op.defense);
      return;
    case "armHero":
      armHero(e, op.seat, op.heroId, op.skillIds);
      return;
    case "armHeroOffer":
      armHeroOffer(e, op.heroIds);
      return;
    case "giveTreasureFromDeck":
      giveTreasureFromDeck(e, op.seat, op.count);
      return;
    case "armPhase":
      armPhase(e, op);
      return;
    case "armBankrupt":
      armBankrupt(e, op.seat);
      return;
    case "armDebt":
      armDebt(e, op.amount, op.creditor);
      return;
    case "armGameOver":
      armGameOver(e, op.winnerSeat);
      return;
    case "armReaction":
      armReaction(e, op.view, op.payload);
      return;
    case "pinDice":
      pinDice(e, op.channel, op.values);
      return;
    case "injectWarLog":
      injectWarLog(e, op);
      return;
    case "armLanding":
      armLanding(e, op.landing);
      return;
    case "armVisitor":
      armVisitor(e, op.propertyId, op.ownerSeat);
      return;
    case "setBot":
      setBot(e, op.seat, op.bot);
      return;
    case "setJinnangUsedTags":
      setJinnangUsedTags(e, op.tags);
      return;
    default:
      throw new Error(`applyPlant:未知种植指令 kind=${String((op as { kind: unknown }).kind)}`);
  }
}
