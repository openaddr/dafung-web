// 效果注册表:时机框架的「效果」半边。技能(TriggerSkill.effect)通过 EffectId 查到这里,
// 由派发器(game.ts dispatchMoment)调用。设计见 docs/explanation/时机框架.md。
//
// 约定:
//  - 效果只能通过引擎公共方法改状态 + pushFloater 留浮字;战报(skill 击发行)由派发器统一记录;
//  - 返回 true = 生效(派发器记战报/冷却);false = 条件不满足,静默跳过(不记战报/冷却);
//  - 零兜底:EffectId 查不到(派发器抛错)、必填 params 缺项(req 抛错)都是数据 bug,直接崩。
import type { GameEngine } from "./game";
import type { GameMoment, MomentCtx } from "./timing";

/** 效果执行上下文:moment=当前时机;owner=技能属主座位;其余字段(MomentCtx)按时机语义携带——
 *  subject=时机主体座位,die=骰面(DieRolled),amount=金额(CashLost/CashGained/TreasureSold/TradeSettled/
 *  BankruptcySettle),passedSeat/ownerSeat/buyerSeat/sellerSeat=相关座位,propertyId/treasureId/heroId=
 *  涉事资产 id,tileIndex=涉事格。各时机的字段清单见 timing.ts GameMoment 注释与 docs 分类目录。 */
export interface EffectCtx extends MomentCtx {
  moment: GameMoment;
  owner: number;
}

/** 效果函数:纯逻辑(禁止 DOM/React),经引擎公共方法改状态。返回是否生效。 */
export type EffectFn = (engine: GameEngine, ctx: EffectCtx, params: Record<string, number>) => boolean;

/** 必填参数读取:缺项=数据 bug,直接抛错(零兜底)。 */
function req(params: Record<string, number>, key: string): number {
  const v = params[key];
  if (v === undefined) throw new Error(`效果参数缺失:${key}(params=${JSON.stringify(params)})`);
  return v;
}

export const EFFECTS: Record<string, EffectFn> = {
  /** 行军加成:BeforeMarch 时机累计步数,rollAndMove 掷骰后并入移动步数。params: { steps } */
  moveBonus: (engine, _ctx, params) => {
    engine.addMarchBonus(req(params, "steps"));
    return true;
  },
  /** 得银:属主 +amount。params: { amount } */
  gainCash: (engine, ctx, params) => {
    engine.grantSkillCash(ctx.owner, req(params, "amount"));
    return true;
  },
  /** 条件得银:DieRolled 时机,骰面恰为 face 时属主 +amount。params: { face, amount } */
  gainIfFace: (engine, ctx, params) => {
    if (ctx.die !== req(params, "face")) return false; // 条件不满足:静默跳过(不记战报/冷却)
    engine.grantSkillCash(ctx.owner, req(params, "amount"));
    return true;
  },
  /** 体力回复(#133 华佗):属主 +amount(clamp 0~100 由 addStamina 保证;只加不减,不触发耗竭)。
   *  params: { amount }。落账恒走 ctx.owner(技能持有者)——RoundStart 的 subject=轮次锚点,
   *  与持有者无关。文本浮字无公共通道(pushFloaterText 为引擎私有,game.ts 本票禁改),
   *  反馈由派发器统一的 skill 战报行承担。 */
  regenStamina: (engine, ctx, params) => {
    engine.addStamina(ctx.owner, req(params, "amount"));
    return true;
  },
};
