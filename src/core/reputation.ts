// 声望域(#121,ADR-0019 委托式拆分,#384 随事件流接线自壳迁入;#1090 去夹紧):
// 声望增减唯一写口(直接累加,无界可负,开局 0)。声望变更本体(reputationChanged)
// 由各结算点(机遇抉择=encounter/天命城=fate)显式产出——落账签名不带 reason,实际
// 增减由调用点以 before/after 差值落事件(词汇表见 game-events.ts)。域逻辑=自由函数,
// 首参接 GameEngine;壳内同名公共方法薄委托(外部 importer 无感)。
import type { GameEngine } from "./authority";

/** 声望增减(#121;#1090 去 ±100 夹紧):机遇抉择/天命城固定事件的唯一写入口,直接累加,
 *  无界可负(开局 0);声望作为 softmax 调制输入见 encounters.ts tierShares(#1090)。
 *  时机·ReputationChanged(#456):唯一写口单点广播(累加提交后派发,天命城/机遇 repDelta
 *  两路天然全覆盖);事件流 reputationChanged 的 before/after 差值模式在各调用点,并存不冲突。 */
export function addReputation(g: GameEngine, seat: number, delta: number): void {
  const p = g.players[seat];
  const before = p.reputation;
  p.reputation = p.reputation + delta;
  g.dispatchMoment("ReputationChanged", { subject: seat, delta: p.reputation - before }); // 时机·ReputationChanged:声望变更(#456,delta=实际增减)
}
