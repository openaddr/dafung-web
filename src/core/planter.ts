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
// #1300。
// 生产零 import 本文件不受限(与 testing.ts「仅 test/ 可 import」的区别):桥
// (src/app/controllers/registry.ts)必须转发到与单测相同的实现,这是三层共用契约
// 本身;测试专用属性由双门禁桥闸守住,不靠 import 规则。
//
// 形制纪律(#1295):每族一个种植件,形制写死在实现(不设运行时开关);被测环永不
// 种植件——种植只负责被测环之前的布置。再缺能力=补种植件(op 联合加 kind),force
// 不复活(#1303 收口退役)。
import type { GameEngine } from "./authority";
import { heroById } from "./heroes";
import { jinnangCardOf } from "./jinnang";
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

/** 种植指令联合(可序列化,#1298 giveJinnang 族首发;其余 11 族按迁移票逐族扩展
 *  kind,#1299-#1302——联合即扩展位,桥分发 switch 穷尽校验)。 */
export type PlantOp =
  | GiveJinnangOp
  | GiveTreasureOp
  | SetCashOp
  | SetReputationOp
  | SetStaminaOp
  | PlacePlayerOp
  | GrantPropertyOp
  | ArmHeroOp
  | ArmHeroOfferOp
  | GiveTreasureFromDeckOp;

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
 *  活算(无存储字段),与 force 现场站点写法同口径。越界座位当场炸;数值不校验
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
 *  炸;level 不校验(负级/超上限是测试作者的场景决定,同 setCash 口径,响在被测面)。 */
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
    return;
  }
  p.properties.push({ propertyId, group: def.group, level, maxLevel: def.maxLevel });
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
  p.heroes.push({ heroId: hero.id, skillIds: skillIds ?? [...hero.skillPool], lastFired: {} });
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
    case "armHero":
      armHero(e, op.seat, op.heroId, op.skillIds);
      return;
    case "armHeroOffer":
      armHeroOffer(e, op.heroIds);
      return;
    case "giveTreasureFromDeck":
      giveTreasureFromDeck(e, op.seat, op.count);
      return;
    default:
      throw new Error(`applyPlant:未知种植指令 kind=${String((op as { kind: unknown }).kind)}`);
  }
}
