// 机遇主流程+体力耗竭域(#123/#124/#130/#132,ADR-0019 委托式拆分 #320):机遇必出
// 触发(ADR-0035)与加权抽取、抉择机遇入相(AwaitingEncounter)与选项结算、即时效果结算
// (八种效果落账)、机遇体力接线与体力耗竭(AwaitingExhaustion)善后。域逻辑=自由函数,
// 首参接 GameEngine 直接读写引擎状态;与数据表 encounters.ts 分层(流程≠配置,零依赖纯数据)。
// GameEngine 侧保留同名方法薄委托(authority.ts):公共入口 maybeApplyEncounter/
// resolveEncounterChoice/resolveExhaustionChoice/exhaustIfDepleted,入相与即时结算
// enterEncounterPhase/settleEncounter(#320 去私有化:域内经 g.xxx 往返消费,兼作
// testing.ts 白盒窄面 EngineTestInternals 的触达点);reaction-window 续结算经壳上
// g.maybeApplyEncounter 委托回调(#318 预案),锦囊抽牌按 #319 预案跨模块直调自由函数。
import type { GameEngine } from "./authority";
import { computeChoices } from "./choices";
import {
  ENCOUNTERS,
  ONCE_PER_GAME_ENCOUNTER_IDS,
  drawableEncounters,
  grantEncounterFlags,
  pickTier,
  pickWeighted,
  tierShares,
  type EncounterChoiceOption,
  type EncounterDef,
  type EncounterEffect,
} from "./encounters";
import { findHolding } from "./player";
import { HEROES, heroById } from "./heroes";
import { grantHeroSlot, grantedNamesLine, rollGrantedSkills } from "./roster";
import { HERO_CAPACITY, STARTING_STAMINA } from "./constants";
import { drawJinnangTraced } from "./jinnang-execution";
import { emitGameEvent } from "./game-events";
import type { Player } from "./model";
import type { PropertyDef } from "./economy";

/** 耗竭入口(#130):体力归 0 的 Seat 调用(机遇结算后)。多房产 → AwaitingExhaustion
 *  相位自选;可用选项 ≤1 → 自动执行;无可处置(无房产/仅 0 级都城) → 纯跳回合。
 *  结算统一:skipTurns+1(跳过下一回合)、体力重置 100、endTurn。 */
export function exhaustIfDepleted(g: GameEngine, seat: number): "none" | "auto" | "phase" {
  const p = g.players[seat];
  if (p.stamina > 0) return "none";
  g.pendingExhaustionSeat = seat;
  const options = computeChoices(g, "AwaitingExhaustion");
  const availableCount = options.filter((o) => o.available).length;
  if (availableCount > 1) {
    g.turnPhase = "AwaitingExhaustion";
    g.logEvent(
      "system",
      p.guohao,
      `${p.guohao} 体力耗竭!须弃一座城池苟活`,
      `exhaustion player=${p.id} options=${availableCount}`,
    );
    return "phase";
  }
  if (availableCount === 1) {
    const idx = options.findIndex((o) => o.available);
    settleExhaustionChoice(g, seat, idx);
    return "auto";
  }
  applyExhaustionAftermath(g, p, "无可处置城池");
  return "auto";
}

/** 玩家从耗竭选项中择一(公开,供 UI/bot/联机)。不可用选项硬拒绝(零兜底同机遇)。 */
export function resolveExhaustionChoice(g: GameEngine, index: number): void {
  if (!g.assertPhase("AwaitingExhaustion", "ResolveExhaustionChoice")) return;
  const options = computeChoices(g, "AwaitingExhaustion");
  const opt = options[index];
  if (g.pendingExhaustionSeat == null || !opt) {
    g.warn(`ResolveExhaustionChoice:耗竭上下文缺失或选项越界(index=${index})`);
    return;
  }
  if (!opt.available) {
    g.warn(
      `ResolveExhaustionChoice:选项不可用(index=${index}${opt.reason ? `,${opt.reason}` : ""})`,
    );
    return;
  }
  settleExhaustionChoice(g, g.pendingExhaustionSeat, index);
}

/** 耗竭选项结算(#130):降 1 级 / 失去整座(城回无主)→ skipTurns+1 + 体力重置 → endTurn。 */
function settleExhaustionChoice(g: GameEngine, seat: number, index: number): void {
  const p = g.players[seat];
  const options = computeChoices(g, "AwaitingExhaustion");
  const opt = options[index];
  if (!opt?.holdingPropertyId || !opt.exhaustionKind) {
    throw new Error(`耗竭选项结算:选项载荷缺失(index=${index},数据 bug)`); // 零兜底
  }
  const note = opt.label;
  emitGameEvent(g, seat, {
    kind: "exhaustionChoice",
    propertyId: opt.holdingPropertyId,
    exhaustionKind: opt.exhaustionKind,
  }); // 事件流(#385):耗竭处置落定(降级/失城;目录文案 fx 按 propertyId+kind 派生)
  if (opt.exhaustionKind === "downgrade") {
    const holding = findHolding(p, opt.holdingPropertyId);
    if (!holding) throw new Error(`耗竭降级:房产 ${opt.holdingPropertyId} 不在持有列表`);
    holding.level -= 1; // 可用性已保证 level>0
    g.dispatchMoment("PropertyDemolished", {
      subject: seat,
      propertyId: opt.holdingPropertyId,
      tileIndex: g.tileIndexOfProperty(opt.holdingPropertyId),
    }); // 时机·PropertyDemolished:耗竭「降 1 级」处置(#457)
  } else {
    const lost = findHolding(p, opt.holdingPropertyId);
    if (!lost) throw new Error(`耗竭失城:房产 ${opt.holdingPropertyId} 不在持有列表`); // 零兜底
    // 城池变更留痕(ADR-0015,本写点补齐 #457):失城回无主,形状对齐破产变卖(bankruptcy.ts)
    g.propertyChanges.push({
      tileIndex: g.tileIndexOfProperty(opt.holdingPropertyId),
      level: lost.level,
      ownerColorIndex: null,
      levelChanged: false,
      ownerChanged: true,
    });
    p.properties = p.properties.filter((h) => h.propertyId !== opt.holdingPropertyId); // 城回无主
    g.dispatchMoment("PropertyLost", {
      subject: seat,
      propertyId: opt.holdingPropertyId,
      tileIndex: g.tileIndexOfProperty(opt.holdingPropertyId),
    }); // 时机·PropertyLost:耗竭「失去整座」处置(#457)
  }
  applyExhaustionAftermath(g, p, note);
  g.endTurn();
}

/** 耗竭善后(#130):跳过下一回合(skipTurns 共用机制)+ 体力重置 100。
 *  重置走 addStamina 唯一口并以 staminaChanged(reason=exhaustion)产事件(#384):
 *  耗竭入口已保证 stamina=0,增量恒为满值,夹紧不改变落账结果。 */
function applyExhaustionAftermath(g: GameEngine, p: Player, note: string): void {
  const seat = g.players.indexOf(p);
  const staminaBefore = p.stamina;
  p.skipTurns += 1;
  g.dispatchMoment("TurnSkipImposed", { subject: seat, reason: "exhaustion" }); // 时机·TurnSkipImposed:耗竭善后强加跳回合(#456,写点 +=1 语义保留)
  const after = g.addStamina(seat, STARTING_STAMINA - staminaBefore);
  emitGameEvent(g, seat, {
    kind: "staminaChanged",
    delta: after - staminaBefore,
    reason: "exhaustion",
  }); // 事件流(#384):体力变更(耗竭重置)
  g.pendingExhaustionSeat = null;
  // 耗竭文案由 staminaChanged(reason=exhaustion) 事件在 fx 面派生(exhaustionTextOf,
  // 批内前置 exhaustionChoice 升级带处置明细版,#719 死写删除)
  g.logEvent(
    "system",
    p.guohao,
    `${p.guohao} 体力耗竭:${note},跳过下一回合,体力回 100`,
    `exhaustionSettle player=${p.id} skipTurns=${p.skipTurns} stamina=100`,
  );
}

/** 机遇触发与抽取(#123;ADR-0035 机遇必出,#776)。enabled=false 为系统总开关(引擎
 *  缺省关=测试隔离):关闭时不出机遇、不耗骰流。开启时凡调用必出一条——档位 roll →
 *  同档加权抽取,顺序固定保重放。返回 none(仅开关关)/settled(继续落格结算)/
 *  deciding(抉择机遇占用本落格,#124)/liquidating/bankrupt/exhausted(#132:体力归 0
 *  触发耗竭,相位或自动惩罚占用本落格,均中断落格结算)。 */
export function maybeApplyEncounter(
  g: GameEngine,
  mover: Player,
): "none" | "settled" | "deciding" | "liquidating" | "bankrupt" | "exhausted" {
  if (!g.encounter.enabled) return "none";
  const tier = pickTier(g.dice.nextFloat(), tierShares(mover.reputation));
  // 抽取过滤(#1153 P2 章闸 + #1154 奇遇一局一遇):def 级 requiresFlags 只对持章者可见
  // (#1133 链式后编高权重的前提);奇遇(ONCE_PER_GAME_ENCOUNTER_IDS 成员)对已触发过的
  // 玩家除名(#1110 一局一遇按玩家)。池空=目录 bug(守卫+目录账用例双拦),此处不兜底
  const def = pickWeighted(
    drawableEncounters(
      ENCOUNTERS.filter((c) => c.tier === tier),
      mover.encounterFlags,
      mover.onceEncounterIds,
    ),
    g.dice.nextFloat(),
  );
  if (ONCE_PER_GAME_ENCOUNTER_IDS.includes(def.id as (typeof ONCE_PER_GAME_ENCOUNTER_IDS)[number]))
    mover.onceEncounterIds.push(def.id); // 奇遇已遇集(#1154):触发即记,中断路照记(#1126 拍板③口径)
  emitGameEvent(g, g.players.indexOf(mover), {
    kind: "encounterTriggered",
    encounterId: def.id,
    tier: def.tier,
  }); // 事件流(#375):机遇触发(已抽中具体机遇)
  if (def.choices) return g.enterEncounterPhase(mover, def); // 抉择机遇(#124):不即时结算
  return g.settleEncounter(mover, def);
}

/** 抉择机遇入相(#124):抽中 choices 型机遇后调用。选项集经注册表(choices.ts)计算,
 *  ADR-0013:可用选项 ≤1 → 自动执行唯一可用项(战报+encounterChoice 事件文案浮字;结盟互市单选项即「自动发生」;
 *  以宝换贤珍宝不足时只剩「婉言相拒」同理),返回 deciding(回合已在收尾中);
 *  ≥2 → 进 AwaitingEncounter 等待 resolveEncounterChoice,返回 deciding。
 *  两种场合机遇都先于城池结算:自动执行已在内部续跑落格结算(返回 deciding),
 *  ≥2 选项由 resolveEncounterChoice 解完后续跑(同在 settleEncounterChoice 内)。 */
export function enterEncounterPhase(
  g: GameEngine,
  mover: Player,
  def: EncounterDef,
): "deciding" | "liquidating" | "bankrupt" | "exhausted" {
  g.pendingEncounter = def;
  g.lastLandOutcome = { kind: "Noop" };
  g.logEvent(
    "system",
    mover.guohao,
    `${mover.guohao} 机遇「${def.id}」:${def.text}`,
    `encounterAwait player=${mover.id} id=${def.id} tier=${def.tier}`,
  );
  const options = computeChoices(g, "AwaitingEncounter");
  const availableIdx = options.map((o, i) => (o.available ? i : -1)).filter((i) => i >= 0);
  if (availableIdx.length > 1) {
    g.turnPhase = "AwaitingEncounter";
    return "deciding";
  }
  // ≤1 可用选项:自动执行唯一可用项(目录约定必有无门槛选项,availableIdx[0] 恒存在;
  // 空目录=数据 bug,按无事发生收尾并留痕,不卡流程)
  const idx = availableIdx[0];
  if (idx === undefined)
    throw new Error(`机遇「${def.id}」无可执行选项:choices 与选项注册表不一致(数据 bug)`); // 零兜底:目录数据 bug 应炸出来
  const choice = def.choices![idx];
  // 选项文案由 settleEncounterChoice 内的 encounterChoice 事件在 fx 面查目录派生(#719 死写删除)
  const r = settleEncounterChoice(g, mover, def, choice, idx ?? 0);
  return r === "settled" ? "deciding" : r; // settled=回合已收尾;机遇仍占用本落格
}

/** 玩家从抉择机遇选项中择一(公开,供 UI/bot/联机)。index=def.choices 下标(与
 *  snapshot.choices 顺序一致)。不可用选项引擎硬拒绝(可用性唯一口径在注册表,零兜底)。 */
export function resolveEncounterChoice(g: GameEngine, index: number): void {
  if (!g.assertPhase("AwaitingEncounter", "ResolveEncounterChoice")) return;
  const def = g.pendingEncounter;
  const option = def?.choices?.[index];
  if (!def || !option) {
    g.warn(`ResolveEncounterChoice:机遇上下文缺失或选项越界(index=${index})`);
    return;
  }
  const opt = computeChoices(g, "AwaitingEncounter")[index];
  if (!opt?.available) {
    g.warn(
      `ResolveEncounterChoice:选项不可用(index=${index}${opt?.reason ? `,${opt.reason}` : ""})`,
    );
    return;
  }
  settleEncounterChoice(g, g.activePlayer, def, option, index);
}

/** 抉择选项结算(#124):repDelta 经 addReputation 落账(直接累加,#1090 去夹紧)→ effect
 *  复用即时机遇结算(cash 负值与 levy 同款封顶以其现有银两为限,#1153 不送清算)
 *  → 选项级 staminaDelta 落账(#132)→ 清载荷 → endTurn。
 *  对局日志记机遇 id + 所选选项;liquidating 留给 AwaitingBankruptcySettle 的 confirm 收尾;
 *  bankrupt 已在效果内 endTurn;exhausted=耗竭接管本落格(#132),三者均不续跑落格结算
 *  (pendingEncounterHalt 一并作废);settled → 普通落格继续本落格的城池结算(#120 决策 2),
 *  驻跸截断(ADR-0035,marchTraverse 置 pendingEncounterHalt)续跑驻跸尾(补给+结束回合)。 */
function settleEncounterChoice(
  g: GameEngine,
  mover: Player,
  def: EncounterDef,
  option: EncounterChoiceOption,
  index: number,
): "settled" | "liquidating" | "bankrupt" | "exhausted" {
  const seat = g.players.indexOf(mover);
  emitGameEvent(g, seat, {
    kind: "encounterChoice",
    encounterId: def.id,
    choiceIndex: index,
  }); // 事件流(#385):机遇抉择落定(auto/resolve 两路共用此口;文案 fx 按 id+下标查目录派生)
  // 选项路章写点(#1153):option.setsFlags 去重落章,与 encounterChoice 事件同位——
  // 中断路(liquidating/bankrupt/exhausted)flag 照写(#1126 拍板③),破产不清章(拍板⑥)
  grantEncounterFlags(mover, option.setsFlags);
  // 换贤代价(#124 目录约定,#1067 代价入条目数据):grantHero 型选项先扣 treasureCost
  // 件珍宝再得将——代价随条目声明(模块初始化守卫保证已声明,直读不兜底),代价侧
  // 没有对应 EncounterEffect,故在选项结算处收口(可用性门槛已保证足量,此处恒扣满)。
  let costDetail = "";
  if (option.effect?.kind === "grantHero") {
    const cost = mover.treasures.splice(0, option.treasureCost!);
    for (const t of cost) g.dispatchMoment("TreasureLost", { subject: seat, treasureId: t.id }); // 时机·TreasureLost:以宝换贤交出珍宝(非售出流失,#457,每件一派)
    costDetail = ` costTreasures=${cost.map((t) => t.id).join("+")}`;
  }
  // 选项现金代价(#1154):付费与得物分离的代价随条目声明——闸门已保证现金充足,唯保底
  // 放行路可带不足现金进场,实付封顶以其现有银两为限(#1153 红线同款;实付 0=分文未动
  // 不产事件,与负 cash 封顶同款)
  if (option.cashCost != null && option.cashCost > 0) {
    const paid = Math.min(option.cashCost, mover.cash);
    mover.cash -= paid;
    if (paid > 0)
      emitGameEvent(g, seat, { kind: "cashChanged", delta: -paid, reason: "encounter" }); // 事件流(#375):金钱变更(实付,浮字由 fx 面派生)
    costDetail += ` costCash=${paid}`;
  }
  if (option.repDelta !== 0) {
    const repBefore = mover.reputation;
    g.addReputation(seat, option.repDelta);
    emitGameEvent(g, seat, {
      kind: "reputationChanged",
      delta: mover.reputation - repBefore,
      reason: "encounter",
    }); // 事件流(#384):声望变更(实际增减,浮字由 fx 面派生)
  }
  g.logEvent(
    "system",
    mover.guohao,
    `${mover.guohao} 机遇「${def.id}」抉择:${option.text}`,
    `encounterChoice player=${mover.id} id=${def.id} index=${index} repDelta=${option.repDelta} reputation=${mover.reputation} effect=${option.effect?.kind ?? "none"}${costDetail}`,
  );
  g.pendingEncounter = null;
  const r = option.effect
    ? applyEncounterEffect(g, mover, def, option.effect, option.text)
    : "settled";
  if (r !== "settled") {
    // liquidating=留清算 confirm;bankrupt=效果内已 endTurn(优先级高于体力,#132):
    // 落格由接管方收尾,驻跸续跑标记一并作废
    g.pendingEncounterHalt = false;
    return r;
  }
  // 选项级体力(#132):repDelta/effect 落账后 staminaDelta 落账;exhausted=耗竭接管本落格
  const s = applyEncounterStamina(g, mover, def, option.staminaDelta ?? 0, option.text);
  if (s === "exhausted") {
    g.pendingEncounterHalt = false; // 耗竭接管本落格:驻跸尾不再续跑(人倒下了不领补给)
    return "exhausted";
  }
  // 机遇解完续跑(#120 决策 2;ADR-0035):普通落格继续城池结算;驻跸截断续跑驻跸尾
  if (g.pendingEncounterHalt) {
    g.pendingEncounterHalt = false;
    g.finishCapitalHalt(mover);
    return r;
  }
  g.turnPhase = "Land";
  g.resolveLanding();
  return r;
}

/** 即时机遇结算(#123):效果落账 + 事件宣告(浮字由 fx 面派生)+ 对局日志。cash 负值
 *  封顶以其现有银两为限(#1153 新红线「机遇不送清算」),levy 输币同款。
 *  玩家间转移(敌营哗变/假道征粮等)为即时动账:上限=付款方现有现金,不触发对方清算
 *  (对方清算会与移动者回合交织——实现取舍,非 #120 豁免,已在 #120 留评说明)。
 *  抉择机遇(#124)无即时效果:结算发生在选项 resolve 阶段(settleEncounterChoice)。 */
export function settleEncounter(
  g: GameEngine,
  mover: Player,
  def: EncounterDef,
): "settled" | "liquidating" | "bankrupt" | "exhausted" {
  // 即时路章写点(#1153):def.setsFlags 去重落章,先于效果结算——中断路(liquidating/
  // bankrupt/exhausted)flag 照写(#1126 拍板③),破产不清章(拍板⑥)
  grantEncounterFlags(mover, def.setsFlags);
  if (!def.effect) return "settled";
  return applyEncounterEffect(g, mover, def, def.effect, def.text);
}

/** 机遇效果结算(即时/抉择两路共用,#123/#124)。narr=战报叙事段:即时机遇=def.text,
 *  抉择机遇=所选选项文本——机遇 id 保持出自 def,叙事随所选选项走。
 *  尾部接线体力(#132):效果落账后 effect.staminaDelta 经 applyEncounterStamina 结算,
 *  耗竭返回 exhausted(liquidating/bankrupt 优先,不再结算体力)。
 *  #320 拆分:八种效果各归 apply*Effect 单一职责小函数,case 体逐字搬运(票面授权,
 *  行为零变化由同种子对拍兜底)。 */
function applyEncounterEffect(
  g: GameEngine,
  mover: Player,
  def: EncounterDef,
  effect: EncounterEffect,
  narr: string,
): "settled" | "liquidating" | "bankrupt" | "exhausted" {
  const seat = g.players.indexOf(mover);
  // 效果级 repDelta(#1153):即时条目落声望,先于效果落账(与选项级「声望→效果→体力」
  // 同序);走 addReputation 唯一写口,emit reputationChanged(before/after 差值模式,
  // 先例=选项级 repDelta 与天命城 applyFateReputation)
  if (effect.repDelta != null && effect.repDelta !== 0) {
    const repBefore = mover.reputation;
    g.addReputation(seat, effect.repDelta);
    emitGameEvent(g, seat, {
      kind: "reputationChanged",
      delta: mover.reputation - repBefore,
      reason: "encounter",
    }); // 事件流(#384):声望变更(实际增减,浮字由 fx 面派生)
  }
  const r = ((): "settled" | "liquidating" | "bankrupt" => {
    switch (effect.kind) {
      case "cash":
        return applyCashEffect(g, mover, def, effect, narr);
      case "grantTreasure":
        return applyGrantTreasureEffect(g, mover, def, narr);
      case "grantHero":
        return applyGrantHeroEffect(g, mover, def, effect, narr);
      case "grantCard":
        return applyGrantCardEffect(g, mover, def, narr);
      case "grantCity":
        return applyGrantCityEffect(g, mover, def, effect, narr);
      case "siphon":
        return applySiphonEffect(g, mover, def, effect, narr);
      case "levy":
        return applyLevyEffect(g, mover, def, effect, narr);
      case "trade":
        return applyTradeEffect(g, mover, def, effect, narr);
    }
  })();
  if (r !== "settled") return r; // liquidating/bankrupt 优先(#132):清算/破产中断,不再结算体力
  return applyEncounterStamina(g, mover, def, effect.staminaDelta ?? 0, narr);
}

/** 效果·现金增减(#123):正=入账派 CashGained;负=#1153 新红线「机遇不送清算」——
 *  实际损失= min(|delta|, 现有现金)(以其现有银两为限,不送清算:siphon 的 take=min
 *  同款语义),机遇不再把人逼进变卖/破产。即时与抉择两路经本函数同款封顶;levy 输币
 *  同款封顶(applyLevyEffect,实付额照付对手)。 */
function applyCashEffect(
  g: GameEngine,
  mover: Player,
  def: EncounterDef,
  effect: Extract<EncounterEffect, { kind: "cash" }>,
  narr: string,
): "settled" | "liquidating" | "bankrupt" {
  const seat = g.players.indexOf(mover);
  // 纯体力事件(#132):delta 0 不产生 "+0" 浮字/战报/时机,体力全权交给 staminaDelta
  if (effect.delta === 0) return "settled";
  if (effect.delta > 0) {
    mover.cash += effect.delta;
    emitGameEvent(g, seat, { kind: "cashChanged", delta: effect.delta, reason: "encounter" }); // 事件流(#375):金钱变更(浮字由 fx 面派生)
    g.dispatchMoment("CashGained", { subject: seat, amount: effect.delta });
    g.logEvent(
      "system",
      mover.guohao,
      `${mover.guohao} 机遇「${def.id}」:${narr} +${effect.delta}`,
      `encounter player=${mover.id} id=${def.id} tier=${def.tier} delta=${effect.delta} cash=${mover.cash}`,
      effect.delta,
    );
    return "settled";
  }
  // 负现金封顶(#1153):实付以现有银两为限,零兜底语义=红线本体(损失封顶后恒 settled,
  // cash 效果不再产 liquidating/bankrupt;实付 0=分文未动不产事件,与汲取 take>0 守卫同款)
  const loss = Math.min(-effect.delta, mover.cash);
  mover.cash -= loss;
  if (loss > 0) {
    emitGameEvent(g, seat, { kind: "cashChanged", delta: -loss, reason: "encounter" }); // 事件流(#375):金钱变更(实际损失,浮字由 fx 面派生)
    g.dispatchMoment("CashLost", { subject: seat, amount: loss });
  }
  g.logEvent(
    "system",
    mover.guohao,
    `${mover.guohao} 机遇「${def.id}」:${narr} −${loss}${loss < -effect.delta ? "(银两不敷,以其现有银两为限)" : ""}`,
    `encounter player=${mover.id} id=${def.id} tier=${def.tier} delta=${effect.delta} paid=${loss} cash=${mover.cash}`,
    -loss,
  );
  return "settled";
}

/** 效果·授珍宝(#123):牌堆抽取;牌堆空 → 转 100 两(探宝的"搜刮一空"口径)。 */
function applyGrantTreasureEffect(
  g: GameEngine,
  mover: Player,
  def: EncounterDef,
  narr: string,
): "settled" | "liquidating" | "bankrupt" {
  const seat = g.players.indexOf(mover);
  if (g.treasureDeck.length === 0) {
    mover.cash += 100; // 牌堆空 → 转 100 两(探宝的"搜刮一空"口径)
    emitGameEvent(g, seat, { kind: "cashChanged", delta: 100, reason: "encounter" }); // 事件流(#375):折现(#455 A2 补缺口;浮字由 fx 面派生)
    g.dispatchMoment("CashGained", { subject: seat, amount: 100 }); // 时机·CashGained:被动得银(授宝空堆折现,#455 A2 补派)
    g.logEvent(
      "system",
      mover.guohao,
      `${mover.guohao} 机遇「${def.id}」:珍宝已被搜刮一空,转得 100 两`,
      `encounter player=${mover.id} id=${def.id} tier=${def.tier} fallback=100 cash=${mover.cash}`,
      100,
    );
    return "settled";
  }
  const drawIdx = Math.floor(g.dice.nextFloat() * g.treasureDeck.length);
  const treasure = g.treasureDeck.splice(drawIdx, 1)[0];
  mover.treasures.push(treasure);
  // 得宝宣告走 TreasureGained 时机产事件(fx 面=金「得」印+treasure 音,#719 死写删除)
  g.logEvent(
    "system",
    mover.guohao,
    `${mover.guohao} 机遇「${def.id}」:${narr},得「${treasure.name}」(Lv.${treasure.level})`,
    `encounter player=${mover.id} id=${def.id} tier=${def.tier} treasure=${treasure.id}`,
  );
  g.dispatchMoment("TreasureGained", { subject: seat, treasureId: treasure.id });
  return "settled";
}

/** 效果·招名将(#123):从未被招揽池抽取;麾下已满/名将已尽/指定将已被招揽(#1153
 *  heroId 指定招揽,点名不可得)→ 折现 fallbackCash(#1126 口径,协议零改动)。 */
function applyGrantHeroEffect(
  g: GameEngine,
  mover: Player,
  def: EncounterDef,
  effect: Extract<EncounterEffect, { kind: "grantHero" }>,
  narr: string,
): "settled" | "liquidating" | "bankrupt" {
  const seat = g.players.indexOf(mover);
  const candidates = HEROES.filter((h) => !g.recruitedHeroIds.has(h.id));
  // 指定招揽(#1153):heroId 点名将(三顾茅庐→诸葛亮);heroId 不在名将表=条目数据 bug,
  // heroById 当场炸出(零兜底);指定将已被招揽=不可得,与麾下满/名将尽同走折现
  const designated = effect.heroId != null ? heroById(effect.heroId) : null;
  const designatedOk = designated != null && !g.recruitedHeroIds.has(designated.id);
  if (
    mover.heroes.length >= HERO_CAPACITY ||
    candidates.length === 0 ||
    (designated != null && !designatedOk)
  ) {
    mover.cash += effect.fallbackCash;
    emitGameEvent(g, seat, {
      kind: "cashChanged",
      delta: effect.fallbackCash,
      reason: "encounter",
    }); // 事件流(#375):折现
    g.dispatchMoment("CashGained", { subject: seat, amount: effect.fallbackCash }); // 时机·CashGained:被动得银(招贤折现,#299 派发缺口补齐)
    g.logEvent(
      "system",
      mover.guohao,
      `${mover.guohao} 机遇「${def.id}」:${narr},麾下已满/名将已尽/指定将不可得,转得 ${effect.fallbackCash} 两`,
      `encounter player=${mover.id} id=${def.id} tier=${def.tier} fallback=${effect.fallbackCash} cash=${mover.cash}`,
      effect.fallbackCash,
    );
    return "settled";
  }
  // 指定招揽不掷选将骰(点名必中);盲盒路(#787)同掷授技,将身份落定一刻掷定
  const hero = designated ?? candidates[Math.floor(g.dice.nextFloat() * candidates.length)];
  // 盲盒路(#787):无候选呈现,将身份落定一刻同掷授技(rollGrantedSkills 单源公式,
  // 掷骰只走 g.dice.nextFloat);战报=已授技口径(不再拼接全池被动 desc)
  const granted = rollGrantedSkills(hero.skillPool, g.dice.nextFloat);
  g.logEvent(
    "system",
    mover.guohao,
    `${mover.guohao} 机遇「${def.id}」:${narr},得「${hero.name}」,授${grantedNamesLine(granted)}`,
    `encounter player=${mover.id} id=${def.id} tier=${def.tier} hero=${hero.id} skills=${granted.join("|")}`,
  );
  grantHeroSlot(g, mover, hero, granted); // 授技入麾下单点(#785):建槽+占池+HeroRecruited(事件体携 skillIds)
  return "settled";
}

/** 效果·授锦囊(#147 圯上授书):机遇→锦囊流通,经 jinnang-execution.drawJinnang 入手
 *  (#319 预案:跨模块直调自由函数)。 */
function applyGrantCardEffect(
  g: GameEngine,
  mover: Player,
  def: EncounterDef,
  narr: string,
): "settled" | "liquidating" | "bankrupt" {
  const seat = g.players.indexOf(mover);
  // 圯上授书(#147):机遇→锦囊流通;手牌无上限(#250)恒入手,牌库空落空由 jinnangExhausted
  // 事件宣告(抽牌宣告=jinnangDrawn 事件 fx 面派生,#719 死写删除)
  g.logEvent(
    "system",
    mover.guohao,
    `${mover.guohao} 机遇「${def.id}」:${narr},得锦囊一封`,
    `encounter player=${mover.id} id=${def.id} tier=${def.tier} grantCard=1`,
  );
  drawJinnangTraced(g, seat, 1, "encounter"); // 事件流(#384):抽锦囊进手(落空不产)
  return "settled";
}

/** 效果·赐城池(#123):从棋盘收无主城随机赐予;无城可赐 → 折现 fallbackCash。 */
function applyGrantCityEffect(
  g: GameEngine,
  mover: Player,
  def: EncounterDef,
  effect: Extract<EncounterEffect, { kind: "grantCity" }>,
  narr: string,
): "settled" | "liquidating" | "bankrupt" {
  const seat = g.players.indexOf(mover);
  // 无主城从棋盘 tile 收集(MapCatalog 只暴露 get/groupMembers,不可枚举)
  const unownedCities = g.board.tiles
    .filter((t) => t.propertyId != null && g.findOwner(t.propertyId) == null)
    .map((t) => ({ tileIndex: t.index, tileName: t.name, def: g.catalog.get(t.propertyId) }))
    .filter((c): c is { tileIndex: number; tileName: string; def: PropertyDef } => c.def != null);
  if (unownedCities.length === 0) {
    mover.cash += effect.fallbackCash;
    emitGameEvent(g, seat, {
      kind: "cashChanged",
      delta: effect.fallbackCash,
      reason: "encounter",
    }); // 事件流(#375):折现
    g.dispatchMoment("CashGained", { subject: seat, amount: effect.fallbackCash }); // 时机·CashGained:被动得银(无城可赐折现,#299 派发缺口补齐)
    g.logEvent(
      "system",
      mover.guohao,
      `${mover.guohao} 机遇「${def.id}」:${narr},已无可归之城,转得 ${effect.fallbackCash} 两`,
      `encounter player=${mover.id} id=${def.id} tier=${def.tier} fallback=${effect.fallbackCash} cash=${mover.cash}`,
      effect.fallbackCash,
    );
    return "settled";
  }
  const picked = unownedCities[Math.floor(g.dice.nextFloat() * unownedCities.length)];
  const defCity = picked.def;
  mover.properties.push({
    propertyId: defCity.id,
    group: defCity.group,
    level: 0,
    maxLevel: defCity.maxLevel,
  });
  // 城池变更留痕(ADR-0015,本写点补齐 #457):赐城即易主(无主 → 得城者),形状对齐购地
  g.propertyChanges.push({
    tileIndex: picked.tileIndex,
    level: 0,
    ownerColorIndex: mover.colorIndex,
    levelChanged: false,
    ownerChanged: true,
  });
  // 赐城宣告随 #719 迁事件面(propertyGranted,fx=城池易主宣告):死浮字先行删除
  g.logEvent(
    "system",
    mover.guohao,
    `${mover.guohao} 机遇「${def.id}」:${narr},得「${picked.tileName}」`,
    `encounter player=${mover.id} id=${def.id} tier=${def.tier} city=${defCity.id}`,
  );
  g.dispatchMoment("PropertyGained", { subject: seat, propertyId: defCity.id }); // 时机·PropertyGained:机遇赐城(与 PropertyBought「购」语义区分,#457)
  return "settled";
}

/** 效果·汲取(#123):随机存活对手现金划转(上限=对方现有现金,不触发对方清算)。 */
function applySiphonEffect(
  g: GameEngine,
  mover: Player,
  def: EncounterDef,
  effect: Extract<EncounterEffect, { kind: "siphon" }>,
  narr: string,
): "settled" | "liquidating" | "bankrupt" {
  const seat = g.players.indexOf(mover);
  const target = randomOpponentOf(g, mover);
  if (!target) return "settled";
  const take = Math.min(effect.amount, target.cash);
  target.cash -= take;
  mover.cash += take;
  if (take > 0) {
    emitGameEvent(g, g.players.indexOf(target), {
      kind: "cashChanged",
      delta: -take,
      reason: "encounter",
      counterpartSeat: seat,
    }); // 事件流(#375):金钱变更(被吸取方)
    g.dispatchMoment("CashLost", {
      subject: g.players.indexOf(target),
      amount: take,
    }); // 时机·CashLost:被动失银(被吸取方,#299 派发缺口补齐)
    emitGameEvent(g, seat, {
      kind: "cashChanged",
      delta: take,
      reason: "encounter",
      counterpartSeat: g.players.indexOf(target),
    }); // 事件流(#375):金钱变更(吸取方)
    g.dispatchMoment("CashGained", { subject: seat, amount: take }); // 时机·CashGained:被动得银(吸取方,#299 派发缺口补齐)
  }
  g.logEvent(
    "system",
    mover.guohao,
    `${mover.guohao} 机遇「${def.id}」:${narr},自 ${target.guohao} 得 ${take} 两`,
    `encounter player=${mover.id} id=${def.id} tier=${def.tier} target=${target.id} take=${take} cash=${mover.cash}`,
    take,
  );
  return "settled";
}

/** 效果·征粮(#123):向随机对手定向征银。#1153 新红线「机遇不送清算」:输币封顶以其
 *  现有银两为限(与 cash 负值同款,不送支付/清算),实付额照付对手——资敌语义不变。 */
function applyLevyEffect(
  g: GameEngine,
  mover: Player,
  def: EncounterDef,
  effect: Extract<EncounterEffect, { kind: "levy" }>,
  narr: string,
): "settled" | "liquidating" | "bankrupt" {
  const seat = g.players.indexOf(mover);
  const paid = Math.min(effect.amount, mover.cash);
  mover.cash -= paid;
  const target = randomOpponentOf(g, mover);
  if (target && paid > 0) {
    target.cash += paid;
    emitGameEvent(g, g.players.indexOf(target), {
      kind: "cashChanged",
      delta: paid,
      reason: "encounter",
      counterpartSeat: seat,
    }); // 事件流(#375):金钱变更(得款对手)
    g.dispatchMoment("CashGained", {
      subject: g.players.indexOf(target),
      amount: paid,
    }); // 时机·CashGained:被动得银(得款对手,#299 派发缺口补齐)
  }
  if (paid > 0)
    emitGameEvent(g, seat, {
      kind: "cashChanged",
      delta: -paid,
      reason: "encounter",
      counterpartSeat: target ? g.players.indexOf(target) : undefined,
    }); // 事件流(#375):金钱变更(征粮方;实付 0=分文未动不产事件,与汲取 take>0 守卫同款)
  if (paid > 0) g.dispatchMoment("CashLost", { subject: seat, amount: paid }); // 时机·CashLost:被动失银(征粮;实付 0=分文未动不派发,与汲取 take>0 守卫同款)
  g.logEvent(
    "system",
    mover.guohao,
    `${mover.guohao} 机遇「${def.id}」:${narr} −${paid}${paid < effect.amount ? "(银两不敷,以其现有银两为限)" : ""}`,
    `encounter player=${mover.id} id=${def.id} tier=${def.tier} paid=${paid} target=${target?.id ?? "-"}`,
    -paid,
  );
  return "settled";
}

/** 效果·互市(#123):国库出银,你与随机对手各得 amount(正和)。 */
function applyTradeEffect(
  g: GameEngine,
  mover: Player,
  def: EncounterDef,
  effect: Extract<EncounterEffect, { kind: "trade" }>,
  narr: string,
): "settled" | "liquidating" | "bankrupt" {
  const seat = g.players.indexOf(mover);
  const target = randomOpponentOf(g, mover);
  mover.cash += effect.amount;
  emitGameEvent(g, seat, { kind: "cashChanged", delta: effect.amount, reason: "encounter" }); // 事件流(#375):金钱变更(互市己方,浮字由 fx 面派生)
  g.dispatchMoment("CashGained", { subject: seat, amount: effect.amount }); // 时机·CashGained:被动得银(互市己方,#299 派发缺口补齐)
  if (target) {
    target.cash += effect.amount;
    emitGameEvent(g, g.players.indexOf(target), {
      kind: "cashChanged",
      delta: effect.amount,
      reason: "encounter",
    }); // 事件流(#375):金钱变更(互市对手)
    g.dispatchMoment("CashGained", {
      subject: g.players.indexOf(target),
      amount: effect.amount,
    }); // 时机·CashGained:被动得银(互市对手,#299 派发缺口补齐)
  }
  g.logEvent(
    "system",
    mover.guohao,
    `${mover.guohao} 机遇「${def.id}」:${narr},你与 ${target?.guohao ?? "诸侯"} 各得 ${effect.amount} 两`,
    `encounter player=${mover.id} id=${def.id} tier=${def.tier} target=${target?.id ?? "-"} gain=${effect.amount}`,
    effect.amount,
  );
  return "settled";
}

/** 机遇体力接线(#132):staminaDelta 经 addStamina 落账(clamp 0~100;浮字/战报增量记
 *  夹紧后实际差,非入参请求数,#568 病 B;detail 的 delta=请求数、stamina=落账值)
 *  → 归 0 触发 exhaustIfDepleted。
 *  返回 "exhausted"=耗竭接管本落格:phase 进 AwaitingExhaustion、auto 已 endTurn 收尾回合——
 *  两种场合调用方都不得续跑城池结算(人倒下了不买地),与 liquidating/bankrupt 同占落格。 */
function applyEncounterStamina(
  g: GameEngine,
  mover: Player,
  def: EncounterDef,
  delta: number,
  narr: string,
): "settled" | "exhausted" {
  if (delta === 0) return "settled";
  const seat = g.players.indexOf(mover);
  const staminaBefore = mover.stamina;
  const stamina = g.addStamina(seat, delta);
  emitGameEvent(g, seat, {
    kind: "staminaChanged",
    delta: stamina - staminaBefore,
    reason: "encounter",
  }); // 事件流(#384):体力变更(机遇,夹紧后实际增减)
  g.dispatchMoment("StaminaChanged", {
    subject: seat,
    delta: stamina - staminaBefore,
  }); // 时机·StaminaChanged:机遇路体力变更(#456 拍定仅机遇路挂——耗竭重置是系统复位、华佗赈济属主动技结算内,两处均不派)
  const gained = stamina - staminaBefore; // 夹紧后实际差(#568 病 B):浮字/战报增量记实际差,非机遇请求数
  const signed = `${gained >= 0 ? "+" : "−"}${Math.abs(gained)}`;
  // 体力浮字由 staminaChanged(reason=encounter) 事件在 fx 面派生(#719 死写删除)
  g.logEvent(
    "system",
    mover.guohao,
    `${mover.guohao} 机遇「${def.id}」:${narr},体力 ${signed}`,
    `encounterStamina player=${mover.id} id=${def.id} tier=${def.tier} delta=${delta} stamina=${stamina}`,
  );
  if (stamina !== 0) return "settled";
  const turnBefore = g.turnNumber;
  const ex = exhaustIfDepleted(g, seat);
  if (ex === "none") throw new Error("机遇体力结算后 stamina>0:耗竭判定状态不一致"); // 零兜底:状态不一致炸出来
  if (ex === "auto" && g.turnNumber === turnBefore && !g.isOver) {
    // 自动惩罚收口(#132/#452):以 turnNumber 前后比对判「未被收尾」——不用 turnPhase
    // 嗅探(endTurn 会经 enterJinnangPhase 把相位改写为 AwaitingJinnang,判据失真,
    // 曾误补第二枪 endTurn 吞掉下家整回合)。唯一可用选项路径(settleExhaustionChoice)
    // 内部已 endTurn,turnNumber 已 +1 → 不补;「无可处置城池」纯跳回合路径不收尾回合
    // (turnNumber 不变)→ 由机遇结算侧补 endTurn,人倒下了回合即止,不留悬空相位。
    g.endTurn();
  }
  return "exhausted"; // phase/auto 一律占用本落格:调用方不得续跑城池结算
}

/** 随机存活对手(#123):无可用对手(全部破产/单人)返回 null,调用方静默跳过转移。 */
function randomOpponentOf(g: GameEngine, mover: Player): Player | null {
  const others = g.players.filter((p) => p !== mover && !p.isBankrupt);
  if (others.length === 0) return null;
  return others[Math.floor(g.dice.nextFloat() * others.length)];
}
