// 效果注册表:时机框架的「效果」半边。技能(TriggerSkill.effect)通过 EffectId 查到这里,
// 由派发器(game.ts dispatchMoment)调用。设计见 docs/timing-framework.md。
//
// 约定:
//  - 效果只能通过引擎公共方法改状态 + pushFloater 留浮字;战报(skill 击发行)由派发器统一记录;
//  - 返回 true = 生效(派发器记战报/冷却);false = 条件不满足,静默跳过(不记战报/冷却);
//  - 零兜底:EffectId 查不到(派发器抛错)、必填 params 缺项(req 抛错)都是数据 bug,直接崩。
import type { GameEngine } from "./game";
import type { GameMoment } from "./timing";

/** 效果执行上下文:moment=当前时机;subject=时机主体座位;owner=技能属主座位;
 *  die=骰面(DieRolled 等);amount=时机涉及金额(CashLost 的失财额等)。 */
export interface EffectCtx {
  moment: GameMoment;
  subject: number;
  owner: number;
  die?: number;
  amount?: number;
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
};
