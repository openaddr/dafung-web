// ──────────────────────────── 种植件 planter(#1295/#1298)────────────────────────────
// 三层共用的场景构造能力单源:单测/无头层直接 import 本模块函数;e2e 经调试桥
// `window.__dafung.plant(op)`(#1298 新增分发口,双门禁)转发到**同一份实现**——
// 桥只出机制+分发,op 为可序列化指令联合(族 kind+参数),字段写错在 e2e 侧编译期红。
//
// 【判词(本件一处,判词归一 #1295)】giveJinnang=裸写形:生产发牌只有牌堆顶随机抽
// (drawJinnang),无「给指定牌」流程——直写是唯一通路;种的是手牌**终态**(cards 即
// 手牌全集,非追加),写后重灌派生量 jinnangHandCount(公开信息字段,模型注释单源)。
// 数值族三件判词在各自函数头注(giveTreasure/setCash 各一处;setReputation/
// setStamina 薄包族共一处),#1299。
// 生产零 import 本文件不受限(与 testing.ts「仅 test/ 可 import」的区别):桥
// (src/app/controllers/registry.ts)必须转发到与单测相同的实现,这是三层共用契约
// 本身;测试专用属性由双门禁桥闸守住,不靠 import 规则。
//
// 形制纪律(#1295):每族一个种植件,形制写死在实现(不设运行时开关);被测环永不
// 种植件——种植只负责被测环之前的布置。再缺能力=补种植件(op 联合加 kind),force
// 不复活(#1303 收口退役)。
import type { GameEngine } from "./authority";
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

/** 种植指令联合(可序列化,#1298 giveJinnang 族首发;其余 11 族按迁移票逐族扩展
 *  kind,#1299-#1302——联合即扩展位,桥分发 switch 穷尽校验)。 */
export type PlantOp = GiveJinnangOp | GiveTreasureOp | SetCashOp | SetReputationOp | SetStaminaOp;

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
    default:
      throw new Error(`applyPlant:未知种植指令 kind=${String((op as { kind: unknown }).kind)}`);
  }
}
