// ──────────────────────────── 种植件 planter(#1295/#1298)────────────────────────────
// 三层共用的场景构造能力单源:单测/无头层直接 import 本模块函数;e2e 经调试桥
// `window.__dafung.plant(op)`(#1298 新增分发口,双门禁)转发到**同一份实现**——
// 桥只出机制+分发,op 为可序列化指令联合(族 kind+参数),字段写错在 e2e 侧编译期红。
//
// 【判词(本件一处,判词归一 #1295)】giveJinnang=裸写形:生产发牌只有牌堆顶随机抽
// (drawJinnang),无「给指定牌」流程——直写是唯一通路;种的是手牌**终态**(cards 即
// 手牌全集,非追加),写后重灌派生量 jinnangHandCount(公开信息字段,模型注释单源)。
// 生产零 import 本文件不受限(与 testing.ts「仅 test/ 可 import」的区别):桥
// (src/app/controllers/registry.ts)必须转发到与单测相同的实现,这是三层共用契约
// 本身;测试专用属性由双门禁桥闸守住,不靠 import 规则。
//
// 形制纪律(#1295):每族一个种植件,形制写死在实现(不设运行时开关);被测环永不
// 种植件——种植只负责被测环之前的布置。再缺能力=补种植件(op 联合加 kind),force
// 不复活(#1303 收口退役)。
import type { GameEngine } from "./authority";
import { jinnangCardOf } from "./jinnang";

/** 塞指定锦囊指令(裸写形):把 seat 的锦囊手牌直写为 cards 终态。
 *  cards=牌目录 id(中文牌名);空数组=清空手牌;重复牌原样保留(牌库同 id 多副本)。 */
export interface GiveJinnangOp {
  kind: "giveJinnang";
  seat: number;
  cards: string[];
}

/** 种植指令联合(可序列化,#1298 giveJinnang 族首发;其余 11 族按迁移票逐族扩展
 *  kind,#1299-#1302——联合即扩展位,桥分发 switch 穷尽校验)。 */
export type PlantOp = GiveJinnangOp;

/** 塞指定锦囊(判词见文件头注):手牌终态=cards,派生量 jinnangHandCount 同步重灌。
 *  目录外牌/越界座位当场炸(零兜底:种错的场要响)。 */
export function giveJinnang(e: GameEngine, seat: number, cards: string[]): void {
  const p = e.players[seat];
  if (p == null) throw new Error(`giveJinnang:座位 ${seat} 不存在(共 ${e.players.length} 席)`);
  for (const id of cards) jinnangCardOf(id); // 目录校验(未知 id 抛错,单源 jinnang.ts)
  p.jinnangHand = [...cards];
  p.jinnangHandCount = p.jinnangHand.length;
}

/** 种植指令分发单源:桥 plant(op) 与单测共用的唯一入口(未知 kind 当场炸——
 *  分发口不吞错,零兜底)。 */
export function applyPlant(e: GameEngine, op: PlantOp): void {
  switch (op.kind) {
    case "giveJinnang":
      giveJinnang(e, op.seat, op.cards);
      return;
    default:
      throw new Error(`applyPlant:未知种植指令 kind=${String((op as { kind: unknown }).kind)}`);
  }
}
