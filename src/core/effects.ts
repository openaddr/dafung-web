// 效果注册表:时机框架的「效果」半边。技能(TriggerSkill.effect)通过 EffectId 查到这里,
// 由派发器(authority.ts dispatchMoment)调用。设计见 docs/explanation/时机框架.md。
//
// 约定:
//  - 效果只能通过引擎公共方法改状态 + 事件宣告(emitGameEvent,浮字由 fx 面消费派生);
//    战报(skill 击发行)由派发器统一记录;
//  - 返回 true = 生效(派发器记战报/冷却);false = 条件不满足,静默跳过(不记战报/冷却);
//  - 零兜底:EffectId 查不到(派发器抛错)、必填 params 缺项(req 抛错)都是数据 bug,直接崩。
import type { GameEngine } from "./authority";
import type { GameMoment, MomentCtx } from "./timing";
import { emitGameEvent } from "./game-events";
import { queueSkillChoice } from "./choices";
import { addSkillMarks, heroSlotOf } from "./roster";

/** 效果执行上下文:moment=当前时机;owner=技能属主座位;skillId/slotHeroId=击发技与
 *  其麾下槽位(#1377,效果需按实例落账——技能标记记槽);其余字段(MomentCtx)按时机
 *  语义携带——subject=时机主体座位,die=骰面(DieRolled),amount=金额(CashLost/CashGained/
 *  TreasureSold/TradeSettled/BankruptcySettle),passedSeat/ownerSeat/buyerSeat/sellerSeat=
 *  相关座位,propertyId/treasureId/heroId=涉事资产 id,tileIndex=涉事格。各时机的字段清单
 *  见 timing.ts GameMoment 注释与 docs 分类目录。 */
export interface EffectCtx extends MomentCtx {
  moment: GameMoment;
  owner: number;
  skillId: string;
  slotHeroId: string;
}

/** 效果函数:纯逻辑(禁止 DOM/React),经引擎公共方法改状态。返回是否生效。 */
export type EffectFn = (
  engine: GameEngine,
  ctx: EffectCtx,
  params: Record<string, number>,
) => boolean;

/** 必填参数读取:缺项=数据 bug,直接抛错(零兜底)。 */
function req(params: Record<string, number>, key: string): number {
  const v = params[key];
  if (v === undefined) throw new Error(`效果参数缺失:${key}(params=${JSON.stringify(params)})`);
  return v;
}

/** 技能声望落账 + 浮字事件(#1145 声望族效果共用私有通路):走引擎公共写口 addReputation
 *  (ReputationChanged 时机照常单点广播);reputationChanged 事件显式产出——时机映射表不产
 *  声望事件(#384 口径:声望事件在结算点直呼),reason="skill" 开放词表新 slug,
 *  浮字由 fx 面派生(同 regenStamina 的 staminaChanged 显式产出款)。 */
function grantReputation(engine: GameEngine, seat: number, amount: number): void {
  const before = engine.players[seat].reputation;
  engine.addReputation(seat, amount);
  emitGameEvent(engine, seat, {
    kind: "reputationChanged",
    delta: engine.players[seat].reputation - before,
    reason: "skill",
  });
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
   *  与持有者无关。浮字由 staminaChanged(reason=skill) 事件在 fx 面派生,
   *  零实际差无演出(#568)。 */
  regenStamina: (engine, ctx, params) => {
    const before = engine.players[ctx.owner].stamina;
    const after = engine.addStamina(ctx.owner, req(params, "amount"));
    emitGameEvent(engine, ctx.owner, {
      kind: "staminaChanged",
      delta: after - before,
      reason: "skill",
    }); // 事件流(#384):体力变更(被动技,夹紧后实际增减)
    return true;
  },

  // ── 技能扩展内容包(#1145,spec #1144 拆票 A/五):六新效果函数 ──

  /** 得声望:属主 +amount(#1145 屯田/互市;与 gainCash 对偶的声望纯参数效果)。
   *  params: { amount } */
  gainReputation: (engine, ctx, params) => {
    grantReputation(engine, ctx.owner, req(params, "amount"));
    return true;
  },
  /** 满级升级声望(#1145 声势):PropertyUpgraded 时机,本次升级恰至满级(level===maxLevel)
   *  时属主 +amount;未满级扩军返回 false 静默跳过(不记战报/冷却)。
   *  params: { amount }。涉事城不在属主名下 = 数据 bug,炸出。 */
  reputationOnMaxLevelUpgrade: (engine, ctx, params) => {
    const holding = engine.players[ctx.owner].properties.find(
      (h) => h.propertyId === ctx.propertyId,
    );
    if (holding == null)
      throw new Error(`声势:PropertyUpgraded 涉事城 ${ctx.propertyId} 不在属主名下(数据 bug)`);
    if (holding.level < holding.maxLevel) return false;
    grantReputation(engine, ctx.owner, req(params, "amount"));
    return true;
  },
  /** 己城被落声望(#1145 瓮中捉鳖):LandedOnProperty 时机,访客落的正是属主之城
   *  (ctx.ownerSeat===owner)时城主 +amount 声望;落他人城返回 false 静默跳过
   *  (时机只在落点格派发,途经格不沾)。params: { amount } */
  reputationOnOwnCityHit: (engine, ctx, params) => {
    if (ctx.ownerSeat !== ctx.owner) return false;
    grantReputation(engine, ctx.owner, req(params, "amount"));
    return true;
  },
  /** 己城被途经得银(#1145 深沟高垒):MarchPassedCity 时机,被途经城恰为属主之城时
   *  城主 +amount 两。落点不算(#1145 spec「路过即触发、落点不算」):时机只在
   *  marchTraverse 途经遍历内派发(唯一派发点,rollAndMove 先置 engine.lastMove 后走、
   *  拦检续走不改写),当次行军 MovePath 恒在;落点格虽在 traversed 内照派,此处按
   *  spec 剔除——无在途行军 = 派发契约违反,炸出(零兜底)。「拦停即止」(拦停成功后
   *  后续城不再问)是遍历侧既有语义,效果不再另判。params: { amount } */
  cashOnOwnCityPassed: (engine, ctx, params) => {
    if (ctx.ownerSeat !== ctx.owner) return false;
    const path = engine.lastMove;
    if (path == null)
      throw new Error(
        "深沟高垒:MarchPassedCity 派发时无在途行军(engine.lastMove 缺失,派发契约违反)",
      );
    if (path.landIndex === ctx.tileIndex) return false; // 行人本就停留的落点格:不算途经
    engine.grantSkillCash(ctx.owner, req(params, "amount"));
    return true;
  },
  /** 被动失银声望(#1145 塞翁失马):CashLost 时机,单笔失银 ≥threshold 时属主 +amount
   *  声望(只吃被动失银——主动支出不经此时机,引擎口径);不满阈值返回 false 静默跳过。
   *  params: { threshold, amount } */
  reputationOnPassiveCashLoss: (engine, ctx, params) => {
    if (ctx.amount == null) throw new Error("塞翁失马:CashLost 派发缺 amount(时机载荷契约违反)");
    if (ctx.amount < req(params, "threshold")) return false;
    grantReputation(engine, ctx.owner, req(params, "amount"));
    return true;
  },
  /** 被锦囊指向得银(#1145 处变不惊):JinnangAnnounced 时机(scope=others:主体≠属主,
   *  自己用计不触发),属主 ∈ targetSeats 时 +amount 两;未被指向返回 false 静默跳过。
   *  params: { amount } */
  cashIfTargetedByJinnang: (engine, ctx, params) => {
    if (ctx.targetSeats == null)
      throw new Error("处变不惊:JinnangAnnounced 派发缺 targetSeats(时机载荷契约违反)");
    if (!ctx.targetSeats.includes(ctx.owner)) return false;
    engine.grantSkillCash(ctx.owner, req(params, "amount"));
    return true;
  },

  // ── 「你可」可选发动形制(#1377,曹丕放逐/行殇):命中不自动结算,挂待决队列,
  //    回合收口 endTurn 入口开窗(choices.ts enterSkillChoiceWindowIfOwed)。──

  /** 放逐攒怒(#1377):StaminaLoss 时机(scope=self,伤害=主公损失体力),损失额
   *  (delta 取绝对值)累入本槽技能标记;达 params.threshold 挂「你可」待决(入队,
   *  发动归零与选人罚跳归回合收口后的应答命令)。未达阈值返回 false 静默跳过
   *  (不记战报/冷却)。params: { threshold }。ctx.delta 缺失或非负=派发契约违反,炸出。 */
  fangzhuMark: (engine, ctx, params) => {
    if (ctx.delta == null || ctx.delta >= 0)
      throw new Error("放逐:StaminaLoss 派发缺 delta 或非损失方向(时机载荷契约违反)");
    const total = addSkillMarks(
      heroSlotOf(engine.players[ctx.owner], ctx.slotHeroId),
      ctx.skillId,
      -ctx.delta,
    );
    if (total < req(params, "threshold")) return false;
    queueSkillChoice(engine, {
      skillId: ctx.skillId,
      heroId: ctx.slotHeroId,
      ownerSeat: ctx.owner,
      subjectSeat: ctx.subject,
    });
    return true;
  },
  /** 行殇询问(#1377):TurnSkipImposed 时机(scope=others,一名其他诸侯进入休整),
   *  原因=耗竭(卧床入休)才挂「你可」待决,目标=被跳者(既定,应答免选人);
   *  缓兵之计(jinnang)与行殇本笔(xingshang)均不触发——后者兼防递归
   *  (发动落账追加的同时机笔不再问)。ctx.reason 缺失=派发契约违反,炸出。 */
  xingshangOffer: (engine, ctx) => {
    if (ctx.reason == null) throw new Error("行殇:TurnSkipImposed 派发缺 reason(时机载荷契约违反)");
    if (ctx.reason !== "exhaustion") return false;
    queueSkillChoice(engine, {
      skillId: ctx.skillId,
      heroId: ctx.slotHeroId,
      ownerSeat: ctx.owner,
      subjectSeat: ctx.subject,
      targetSeat: ctx.subject,
    });
    return true;
  },
};
