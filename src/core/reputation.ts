// 声望域(#121/#147,ADR-0019 委托式拆分,#384 随事件流接线自壳迁入):声望增减唯一
// 写口(clamp ±100)与声望献计里程碑(首次向上穿越 +30/+60/+90 各献锦囊一张)。
// 事件流(#384):里程碑献计的进手经 drawJinnangTraced 产出 jinnangDrawn(reason=
// repMilestone);声望变更本体(reputationChanged)由各结算点(机遇抉择=encounter/
// 天命城=fate)显式产出——落账签名不带 reason,夹紧后的实际增减由调用点以 before/
// after 差值落事件(词汇表见 game-events.ts)。域逻辑=自由函数,首参接 GameEngine;
// 壳内同名公共方法薄委托(外部 importer 无感)。
import type { GameEngine } from "./authority";
import { emitGameEvent } from "./game-events";

/** 声望献计里程碑(#147/#384):唯一事实源,事件折叠侧(event-fold)按此对齐演出。 */
export const REP_MILESTONES = [30, 60, 90] as const;
import { drawJinnangTraced } from "./jinnang-execution";

/** 声望增减(#121):机遇抉择/天命城固定事件的唯一写入口,clamp ±100。
 *  声望献计(#147):首次向上穿越 +30/+60/+90 各献锦囊一张(只在本入口挂钩,
 *  不看来源——把机遇抉择玩好就有实物兑现)。
 *  时机·ReputationChanged(#456):唯一写口单点广播(夹紧提交后派发,天命城/机遇 repDelta
 *  两路天然全覆盖);事件流 reputationChanged 的 before/after 差值模式在各调用点,并存不冲突。
 *  里程碑穿越宣告 repMilestoneCrossed(#719 迁事件面):零新增转移的纯宣告,浮字由 fx 面派生。 */
export function addReputation(g: GameEngine, seat: number, delta: number): void {
  const p = g.players[seat];
  const before = p.reputation;
  p.reputation = Math.max(-100, Math.min(100, p.reputation + delta));
  g.dispatchMoment("ReputationChanged", { subject: seat, delta: p.reputation - before }); // 时机·ReputationChanged:声望变更(#456,delta=夹紧后实际增减)
  for (const m of REP_MILESTONES) {
    if (before < m && p.reputation >= m && !p.repMilestones.includes(m)) {
      p.repMilestones.push(m);
      emitGameEvent(g, seat, { kind: "repMilestoneCrossed", milestone: m }); // 事件流(#719):里程碑穿越宣告(浮字由 fx 面派生)
      g.logEvent(
        "system",
        p.guohao,
        `${p.guohao} 声望达 ${m},名将献计一封`,
        `repMilestone player=${p.id} milestone=${m}`,
      );
      drawJinnangTraced(g, seat, 1, "repMilestone"); // 事件流(#384):献计进手(jinnangDrawn)
    }
  }
}
