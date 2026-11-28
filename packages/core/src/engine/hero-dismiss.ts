// 遣散域(#1147,spec #1144 拆票 C/五):免费主动遣散的机制单点——名册遣散命令
// (dismissHero)的校验与结算。玩家主动遣散名将回池并折书，免收费用。
// 清算期间禁止遣散,名将只能在实际破产后回池,不参与筹款。
// 机制三件:槽移除(整槽弃,#785 同款——已授技与冷却账随槽俱弃,无孤儿键)+
// recruitedHeroIds 划名回池(finalizeBankruptcy 同口径,再招=全新实例重掷授技)+
// 已学技逐册折书(印书单源 makeSkillBook;每册 push 珍宝+战报一行+TreasureGained 时机
// 派发,printSkillBooks 同构零特判——TreasureGained 监听技白得照走珍宝通路)。
// 事件:heroDismissed 显式 emit(非触发时机——不进 MOMENTS、无 scope/冷却语义),
// skillIds=折书明细随事件走;折书入位本身随同批 treasureGained 事件各自折叠。
// 不入 roster.ts 的理由:game-events 已 import roster(heroSlotOf),本域再反向依赖
// game-events(emitGameEvent)会成环——遣散是麾下生命周期出账侧,独立成域最薄。
import type { GameEngine } from "./authority";
import { heroById } from "./heroes";
import { foldSkillBookIntoTreasures } from "./roster";
import { emitGameEvent } from "./game-events";
import type { CommandWarningCode } from "./model";

type HeroDismissalBlock = { code: CommandWarningCode; reason: string };

/** 遣散属于正在行动的诸侯，清算和归他席的抉择期间停用。 */
export function heroDismissalWindowBlock(g: GameEngine): HeroDismissalBlock | null {
  if (g.phase !== "Playing") return { code: "dismissalWrongPhase", reason: "当前阶段不可遣散名将" };
  if (g.decisionOwner !== g.activeIndex)
    return { code: "dismissalOutsideOwnDecision", reason: "仅行动者自己的决策窗可遣散名将" };
  if (g.turnPhase === "AwaitingBankruptcySettle")
    return { code: "dismissalDuringSettlement", reason: "清算期间不可主动遣散名将" };
  return null;
}

/** 权威命令和名册选项共用同一份遣散资格判定。 */
export function heroDismissalBlock(g: GameEngine, heroId: string): HeroDismissalBlock | null {
  const window = heroDismissalWindowBlock(g);
  if (window !== null) return window;
  if (
    g.pendingSkill?.heroId === heroId ||
    (g.turnPhase === "AwaitingSkillChoice" && g.pendingSkillChoices[0]?.heroId === heroId)
  )
    return { code: "dismissalUnavailable", reason: "请先结束此名将的待决技能" };
  if (!g.activePlayer.heroes.some((slot) => slot.heroId === heroId))
    return { code: "dismissalUnavailable", reason: "所选名将不在麾下" };
  return null;
}

/** 遣散一名麾下名将(#1147,免费主动遣散)。校验四道(违规 g.warn 留痕拒绝,与变卖
 *  同款引擎硬闸风格,UI 永不裁决):
 *  ① 对局中(phase="Playing";Setup 选都期/终局不可遣散);
 *  ② 决策窗归行动者本人(自己回合随时可点;珍宝交涉 AwaitingTreasureOwner 等
 *     decisionOwner≠activeIndex 的他座决策窗拒绝——遣散是行动者本人的免费权);
 *  ③ 非清算期(禁止遣散折书筹款);
 *  ④ 目标在麾下，且该槽位的技能没有在等待应答。
 * 结算序:槽移除+回池划名 → heroDismissed 事件 → 逐册折书(每册 push 珍宝+战报一行+
 * TreasureGained 派发)。执行者恒为 activePlayer:命令语义即「遣散我自己的将」,
 * 联机侧由房间校验提交座位和原决策点。 */
export function dismissHero(g: GameEngine, heroId: string): void {
  const block = heroDismissalBlock(g, heroId);
  if (block !== null) {
    g.warnCommand(block.code, `遣散:${block.reason}`);
    return;
  }
  const p = g.activePlayer;
  const idx = p.heroes.findIndex((slot) => slot.heroId === heroId);
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
