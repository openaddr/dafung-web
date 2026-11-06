// 遣散域(#1147,spec #1144 拆票 C/五):免费主动遣散的机制单点——名册遣散命令
// (dismissHero)的校验与结算。与破产变卖分流:cashHeroBankruptcy(bankruptcy.ts)是
// 清算语境的「遣散换银 200 两」,本域是玩家主动的「遣散回池+折书」,免费、无声望代价。
// 机制三件:槽移除(整槽弃,#785 同款——已授技与冷却账随槽俱弃,无孤儿键)+
// recruitedHeroIds 划名回池(finalizeBankruptcy 同口径,再招=全新实例重掷授技)+
// 已学技逐册折书(印书单源 makeSkillBook;每册 push 珍宝+战报一行+TreasureGained 时机
// 派发,printSkillBooks 同构零特判——TreasureGained 监听技白得照走珍宝通路)。
// 事件:heroDismissed 显式 emit(非触发时机——不进 MOMENTS、无 scope/冷却语义),
// skillIds=折书明细随事件走;折书入位本身随同批 treasureGained 事件各自折叠。
// 独立 mini 机制自成模块的先例与机遇域同构(玩家命令两段式:引擎校验域内自洽,壳上薄委托);
// 不入 roster.ts 的理由:game-events 已 import roster(heroSlotOf),本域再反向依赖
// game-events(emitGameEvent)会成环——遣散是麾下生命周期出账侧,独立成域最薄。
import type { GameEngine } from "./authority";
import { heroById } from "./heroes";
import { foldSkillBookIntoTreasures } from "./roster";
import { emitGameEvent } from "./game-events";

/** 遣散一名麾下名将(#1147,免费主动遣散)。校验三道(违规 g.warn 留痕拒绝,与三变卖
 *  同款引擎硬闸风格,UI 永不裁决):
 *  ① 对局中(phase="Playing";Setup 选都期/终局不可遣散);
 *  ② 决策窗归行动者本人(自己回合随时可点;珍宝交涉 AwaitingTreasureOwner 等
 *     decisionOwner≠activeIndex 的他座决策窗拒绝——遣散是行动者本人的免费权);
 *  ③ 目标在麾下(空册/查无同径拒绝)。
 * 结算序:槽移除+回池划名 → heroDismissed 事件 → 逐册折书(每册 push 珍宝+战报一行+
 * TreasureGained 派发)。执行者恒为 activePlayer:命令语义即「遣散我自己的将」,
 * 联机侧座位归属校验在房间编排层(applyCommandFromSeat,与一切命令同闸)。 */
export function dismissHero(g: GameEngine, heroId: string): void {
  if (g.phase !== "Playing") {
    g.warn(`遣散:对局 ${g.phase} 期不可遣散`);
    return;
  }
  if (g.decisionOwner !== g.activeIndex) {
    g.warn("遣散:当前决策窗不归行动者本人(自己回合随时可点,他座决策窗除外)");
    return;
  }
  const p = g.activePlayer;
  const idx = p.heroes.findIndex((slot) => slot.heroId === heroId);
  if (idx < 0) {
    g.warn(`遣散:名将 ${heroId} 不在麾下`);
    return;
  }
  const hero = heroById(heroId);
  const slot = p.heroes.splice(idx, 1)[0]!; // 整槽弃(#785):已授技与冷却账随槽俱弃
  g.recruitedHeroIds.delete(heroId); // 回池:再被招 = 重新预掷授技(破产释放同口径)
  const seat = g.players.indexOf(p);
  emitGameEvent(g, seat, {
    kind: "heroDismissed",
    heroId,
    skillIds: [...slot.skillIds], // 折书明细随事件走(槽已删,此为唯一出窗口径)
  });
  g.logEvent(
    "system",
    p.guohao,
    `${p.guohao} 遣散「${hero.name}」回招贤池,已学技折成 ${slot.skillIds.length} 册技能书`,
    `dismissHero player=${p.id} hero=${heroId} skills=${slot.skillIds.join("|")}`,
  );
  // 已学技逐册折书(机制环单源 roster.foldSkillBookIntoTreasures,评审 S1 与位满印书共环;
  // 入位宣告走 TreasureGained,得宝系联动技照常击发零特判)
  for (const skillId of slot.skillIds) {
    foldSkillBookIntoTreasures(
      g,
      p,
      skillId,
      heroId,
      (bookName) => `${p.guohao} 已学技化作「${bookName}」入珍宝位`,
      "dismissBook",
    );
  }
}
