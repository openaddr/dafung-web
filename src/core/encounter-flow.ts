// 机遇主流程+体力耗竭域(#123/#124/#130/#132,ADR-0019 委托式拆分 #320):机遇掷骰
// 触发与加权抽取、抉择机遇入相(AwaitingEncounter)与选项结算、即时效果结算(八种效果
// 落账)、机遇体力接线与体力耗竭(AwaitingExhaustion)善后。域逻辑=自由函数,首参接
// GameEngine 直接读写引擎状态;与数据表 encounters.ts 分层(流程≠配置,零依赖纯数据)。
// GameEngine 侧保留同名方法薄委托(authority.ts):公共入口 maybeApplyEncounter/
// resolveEncounterChoice/resolveExhaustionChoice/exhaustIfDepleted,入相与即时结算
// enterEncounterPhase/settleEncounter(#320 去私有化:域内经 g.xxx 往返消费,兼作
// testing.ts 白盒窄面 EngineTestInternals 的触达点);reaction-window 续结算经壳上
// g.maybeApplyEncounter 委托回调(#318 预案),锦囊抽牌按 #319 预案跨模块直调自由函数。
import type { GameEngine } from "./authority";
import { computeChoices, ENCOUNTER_HERO_TREASURE_COST } from "./choices";
import {
  ENCOUNTERS,
  pickTier,
  pickWeighted,
  tierShares,
  type EncounterChoiceOption,
  type EncounterDef,
  type EncounterEffect,
} from "./encounters";
import { findHolding } from "./player";
import { HEROES } from "./heroes";
import { HERO_CAPACITY, STARTING_STAMINA } from "./constants";
import { drawJinnang } from "./jinnang-execution";
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
  if (opt.exhaustionKind === "downgrade") {
    const holding = findHolding(p, opt.holdingPropertyId);
    if (!holding) throw new Error(`耗竭降级:房产 ${opt.holdingPropertyId} 不在持有列表`);
    holding.level -= 1; // 可用性已保证 level>0
  } else {
    p.properties = p.properties.filter((h) => h.propertyId !== opt.holdingPropertyId); // 城回无主
  }
  applyExhaustionAftermath(g, p, note);
  g.endTurn();
}

/** 耗竭善后(#130):跳过下一回合(复用辅路惩罚的 skipTurns 机制)+ 体力重置 100。 */
function applyExhaustionAftermath(g: GameEngine, p: Player, note: string): void {
  p.skipTurns += 1;
  p.stamina = STARTING_STAMINA;
  g.pendingExhaustionSeat = null;
  g.pushFloaterText(p, `体力耗竭:${note},倒地不起(跳过一回合)`, p.position);
  g.logEvent(
    "system",
    p.guohao,
    `${p.guohao} 体力耗竭:${note},跳过下一回合,体力回 100`,
    `exhaustionSettle player=${p.id} skipTurns=${p.skipTurns} stamina=100`,
  );
}

/** 机遇触发与抽取(#123)。返回 none/settled(继续落格结算)/deciding(抉择机遇占用本落格,
 *  #124)/liquidating/bankrupt/exhausted(#132:体力归 0 触发耗竭,相位或自动惩罚占用本落格,
 *  均中断落格结算)。一切随机经 this.dice:触发 roll → 档位 roll → 同档加权抽取,顺序固定保重放。 */
export function maybeApplyEncounter(
  g: GameEngine,
  mover: Player,
  atTile: number,
): "none" | "settled" | "deciding" | "liquidating" | "bankrupt" | "exhausted" {
  // 天命格是固定声望泉(resolveSpecial +20),不参与机遇 roll(#120 决策 2,评审修正)
  if (g.board.at(atTile).type === "Fate") return "none";
  if (g.encounter.triggerRate <= 0) return "none";
  if (g.dice.nextFloat() * 100 >= g.encounter.triggerRate) {
    // 规格故事 16:每次 roll 与结果都进对局日志(未中也留机读痕)
    g.logEvent(
      "system",
      mover.guohao,
      `${mover.guohao} 机遇未降临`,
      `encounterMiss player=${mover.id} rate=${g.encounter.triggerRate} reputation=${mover.reputation}`,
    );
    return "none";
  }
  const tier = pickTier(
    g.dice.nextFloat(),
    tierShares(mover.reputation, g.encounter.shares),
  );
  const def = pickWeighted(
    ENCOUNTERS.filter((c) => c.tier === tier),
    g.dice.nextFloat(),
  );
  if (def.choices) return g.enterEncounterPhase(mover, atTile, def); // 抉择机遇(#124):不即时结算
  return g.settleEncounter(mover, atTile, def);
}

/** 抉择机遇入相(#124):抽中 choices 型机遇后调用。选项集经注册表(choices.ts)计算,
 *  ADR-0013:可用选项 ≤1 → 自动执行唯一可用项(战报+浮字;结盟互市单选项即「自动发生」;
 *  以宝换贤珍宝不足时只剩「婉言相拒」同理),返回 deciding(回合已在收尾中);
 *  ≥2 → 进 AwaitingEncounter 等待 resolveEncounterChoice,返回 deciding。
 *  两种场合机遇都先于城池结算:自动执行已在内部续跑落格结算(返回 deciding),
 *  ≥2 选项由 resolveEncounterChoice 解完后续跑(同在 settleEncounterChoice 内)。 */
export function enterEncounterPhase(
  g: GameEngine,
  mover: Player,
  atTile: number,
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
  g.pushFloaterText(mover, choice.text, atTile);
  const r = settleEncounterChoice(g, mover, atTile, def, choice, idx ?? 0);
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
  settleEncounterChoice(g, g.activePlayer, g.activePlayer.position, def, option, index);
}

/** 抉择选项结算(#124):repDelta 经 addReputation 落账并夹紧 → effect 复用即时机遇结算
 *  (银两支出走支付/清算,与购地同规则)→ 选项级 staminaDelta 落账(#132)→ 清载荷 → endTurn。
 *  对局日志记机遇 id + 所选选项;liquidating 留给 AwaitingBankruptcySettle 的 confirm 收尾;
 *  bankrupt 已在效果内 endTurn;exhausted=耗竭接管本落格(#132),三者均不续跑城池结算;
 *  settled → 继续本落格的城池结算(#120 决策 2,评审修正:原先漏掉购地/过路)。 */
function settleEncounterChoice(
  g: GameEngine,
  mover: Player,
  atTile: number,
  def: EncounterDef,
  option: EncounterChoiceOption,
  index: number,
): "settled" | "liquidating" | "bankrupt" | "exhausted" {
  const seat = g.players.indexOf(mover);
  // 换贤代价(#124 目录约定):grantHero 型选项先扣 2 件珍宝再得将——代价侧没有对应
  // EncounterEffect,故在选项结算处收口(可用性门槛已保证足量,此处恒扣满)。
  let costDetail = "";
  if (option.effect?.kind === "grantHero") {
    const cost = mover.treasures.splice(0, ENCOUNTER_HERO_TREASURE_COST);
    costDetail = ` costTreasures=${cost.map((t) => t.id).join("+")}`;
  }
  if (option.repDelta !== 0) {
    g.addReputation(seat, option.repDelta);
    g.pushFloaterText(
      mover,
      `「${def.id}」声望 ${option.repDelta > 0 ? "+" : ""}${option.repDelta}`,
      atTile,
    );
  }
  g.logEvent(
    "system",
    mover.guohao,
    `${mover.guohao} 机遇「${def.id}」抉择:${option.text}`,
    `encounterChoice player=${mover.id} id=${def.id} index=${index} repDelta=${option.repDelta} reputation=${mover.reputation} effect=${option.effect?.kind ?? "none"}${costDetail}`,
  );
  g.pendingEncounter = null;
  const r = option.effect
    ? applyEncounterEffect(g, mover, atTile, def, option.effect, option.text)
    : "settled";
  if (r !== "settled") return r; // liquidating=留清算 confirm;bankrupt=效果内已 endTurn(优先级高于体力,#132)
  // 选项级体力(#132):repDelta/effect 落账后 staminaDelta 落账;exhausted=耗竭接管本落格
  const s = applyEncounterStamina(g, mover, atTile, def, option.staminaDelta ?? 0, option.text);
  if (s === "exhausted") return "exhausted";
  // 机遇解完 → 继续本落格的城池结算(#120 决策 2,评审修正:原先直接 endTurn 漏掉购地/过路)
  g.turnPhase = "Land";
  g.resolveLanding();
  return r;
}

/** 即时机遇结算(#123):效果落账 + 浮字 + 对局日志。机遇自身银两支出走支付/清算(破产与购地同规则)。
 *  玩家间转移(敌营哗变/假道征粮等)为即时动账:上限=付款方现有现金,不触发对方清算
 *  (对方清算会与移动者回合交织——实现取舍,非 #120 豁免,已在 #120 留评说明)。
 *  抉择机遇(#124)无即时效果:结算发生在选项 resolve 阶段(settleEncounterChoice)。 */
export function settleEncounter(
  g: GameEngine,
  mover: Player,
  atTile: number,
  def: EncounterDef,
): "settled" | "liquidating" | "bankrupt" | "exhausted" {
  if (!def.effect) return "settled";
  return applyEncounterEffect(g, mover, atTile, def, def.effect, def.text);
}

/** 机遇效果结算(即时/抉择两路共用,#123/#124)。narr=战报/浮字叙事段:即时机遇=def.text,
 *  抉择机遇=所选选项文本——机遇 id 保持出自 def,叙事随所选选项走。
 *  尾部接线体力(#132):效果落账后 effect.staminaDelta 经 applyEncounterStamina 结算,
 *  耗竭返回 exhausted(liquidating/bankrupt 优先,不再结算体力)。
 *  #320 拆分:八种效果各归 apply*Effect 单一职责小函数,case 体逐字搬运(票面授权,
 *  行为零变化由同种子对拍兜底)。 */
function applyEncounterEffect(
  g: GameEngine,
  mover: Player,
  atTile: number,
  def: EncounterDef,
  effect: EncounterEffect,
  narr: string,
): "settled" | "liquidating" | "bankrupt" | "exhausted" {
  const r = ((): "settled" | "liquidating" | "bankrupt" => {
    switch (effect.kind) {
      case "cash":
        return applyCashEffect(g, mover, atTile, def, effect, narr);
      case "grantTreasure":
        return applyGrantTreasureEffect(g, mover, atTile, def, narr);
      case "grantHero":
        return applyGrantHeroEffect(g, mover, atTile, def, effect, narr);
      case "grantCard":
        return applyGrantCardEffect(g, mover, atTile, def, narr);
      case "grantCity":
        return applyGrantCityEffect(g, mover, atTile, def, effect, narr);
      case "siphon":
        return applySiphonEffect(g, mover, atTile, def, effect, narr);
      case "levy":
        return applyLevyEffect(g, mover, atTile, def, effect, narr);
      case "trade":
        return applyTradeEffect(g, mover, atTile, def, effect, narr);
    }
  })();
  if (r !== "settled") return r; // liquidating/bankrupt 优先(#132):清算/破产中断,不再结算体力
  return applyEncounterStamina(g, mover, atTile, def, effect.staminaDelta ?? 0, narr);
}

/** 效果·现金增减(#123):正=入账派 CashGained;负=走支付/清算(破产与购地同规则),
 *  破产时效果内 endTurn 收尾回合。 */
function applyCashEffect(
  g: GameEngine,
  mover: Player,
  atTile: number,
  def: EncounterDef,
  effect: Extract<EncounterEffect, { kind: "cash" }>,
  narr: string,
): "settled" | "liquidating" | "bankrupt" {
  const seat = g.players.indexOf(mover);
  // 纯体力事件(#132):delta 0 不产生 "+0" 浮字/战报/时机,体力全权交给 staminaDelta
  if (effect.delta === 0) return "settled";
  if (effect.delta > 0) {
    mover.cash += effect.delta;
    g.pushFloater(mover, effect.delta, atTile, "income");
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
  const r = g.payOrLiquidate(mover, null, -effect.delta);
  if (r === "liquidating") return "liquidating";
  const bankrupt = r === "bankrupt";
  g.pushFloater(mover, effect.delta, atTile, "expense");
  g.dispatchMoment("CashLost", { subject: seat, amount: -effect.delta });
  g.logEvent(
    "system",
    mover.guohao,
    `${mover.guohao} 机遇「${def.id}」:${narr} ${effect.delta}${bankrupt ? " → 破产" : ""}`,
    `encounter player=${mover.id} id=${def.id} tier=${def.tier} delta=${effect.delta} cash=${mover.cash}`,
    effect.delta,
  );
  if (bankrupt) g.endTurn();
  return bankrupt ? "bankrupt" : "settled";
}

/** 效果·授珍宝(#123):牌堆抽取;牌堆空 → 转 100 两(探宝的"搜刮一空"口径)。 */
function applyGrantTreasureEffect(
  g: GameEngine,
  mover: Player,
  atTile: number,
  def: EncounterDef,
  narr: string,
): "settled" | "liquidating" | "bankrupt" {
  const seat = g.players.indexOf(mover);
  if (g.treasureDeck.length === 0) {
    mover.cash += 100; // 牌堆空 → 转 100 两(探宝的"搜刮一空"口径)
    g.pushFloater(mover, 100, atTile, "income");
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
  g.pushFloaterText(mover, `机遇「${def.id}」:${narr},得「${treasure.name}」`, atTile);
  g.logEvent(
    "system",
    mover.guohao,
    `${mover.guohao} 机遇「${def.id}」:${narr},得「${treasure.name}」(Lv.${treasure.level})`,
    `encounter player=${mover.id} id=${def.id} tier=${def.tier} treasure=${treasure.id}`,
  );
  g.dispatchMoment("TreasureGained", { subject: seat, treasureId: treasure.id });
  return "settled";
}

/** 效果·招名将(#123):从未被招揽池抽取;麾下已满/名将已尽 → 折现 fallbackCash。 */
function applyGrantHeroEffect(
  g: GameEngine,
  mover: Player,
  atTile: number,
  def: EncounterDef,
  effect: Extract<EncounterEffect, { kind: "grantHero" }>,
  narr: string,
): "settled" | "liquidating" | "bankrupt" {
  const seat = g.players.indexOf(mover);
  const candidates = HEROES.filter((h) => !g.recruitedHeroIds.has(h.id));
  if (mover.heroes.length >= HERO_CAPACITY || candidates.length === 0) {
    mover.cash += effect.fallbackCash;
    g.pushFloater(mover, effect.fallbackCash, atTile, "income");
    g.dispatchMoment("CashGained", { subject: seat, amount: effect.fallbackCash }); // 时机·CashGained:被动得银(招贤折现,#299 派发缺口补齐)
    g.logEvent(
      "system",
      mover.guohao,
      `${mover.guohao} 机遇「${def.id}」:${narr},麾下已满/名将已尽,转得 ${effect.fallbackCash} 两`,
      `encounter player=${mover.id} id=${def.id} tier=${def.tier} fallback=${effect.fallbackCash} cash=${mover.cash}`,
      effect.fallbackCash,
    );
    return "settled";
  }
  const hero = candidates[Math.floor(g.dice.nextFloat() * candidates.length)];
  mover.heroes.push(hero);
  g.recruitedHeroIds.add(hero.id);
  g.pushFloaterText(mover, `机遇「${def.id}」:${hero.name} 来投`, atTile);
  g.logEvent(
    "system",
    mover.guohao,
    `${mover.guohao} 机遇「${def.id}」:${narr},得「${hero.name}」:${hero.desc}`,
    `encounter player=${mover.id} id=${def.id} tier=${def.tier} hero=${hero.id}`,
  );
  g.dispatchMoment("HeroRecruited", { subject: seat, heroId: hero.id });
  return "settled";
}

/** 效果·授锦囊(#147 圯上授书):机遇→锦囊流通,经 jinnang-execution.drawJinnang 入手
 *  (#319 预案:跨模块直调自由函数)。 */
function applyGrantCardEffect(
  g: GameEngine,
  mover: Player,
  atTile: number,
  def: EncounterDef,
  narr: string,
): "settled" | "liquidating" | "bankrupt" {
  const seat = g.players.indexOf(mover);
  // 圯上授书(#147):机遇→锦囊流通;手牌无上限(#250)恒入手,牌库空由 drawJinnang 自行落空提示
  g.pushFloaterText(mover, `机遇「${def.id}」:${narr},得锦囊一封`, atTile);
  g.logEvent(
    "system",
    mover.guohao,
    `${mover.guohao} 机遇「${def.id}」:${narr},得锦囊一封`,
    `encounter player=${mover.id} id=${def.id} tier=${def.tier} grantCard=1`,
  );
  drawJinnang(g, seat, 1);
  return "settled";
}

/** 效果·赐城池(#123):从棋盘收无主城随机赐予;无城可赐 → 折现 fallbackCash。 */
function applyGrantCityEffect(
  g: GameEngine,
  mover: Player,
  atTile: number,
  def: EncounterDef,
  effect: Extract<EncounterEffect, { kind: "grantCity" }>,
  narr: string,
): "settled" | "liquidating" | "bankrupt" {
  const seat = g.players.indexOf(mover);
  // 无主城从棋盘 tile 收集(MapCatalog 只暴露 get/groupMembers,不可枚举)
  const unownedCities = g.board.tiles
    .filter(
      (t) => t.type === "Property" && t.propertyId && g.findOwner(t.propertyId) == null,
    )
    .map((t) => ({ tileName: t.name, def: g.catalog.get(t.propertyId) }))
    .filter((c): c is { tileName: string; def: PropertyDef } => c.def != null);
  if (unownedCities.length === 0) {
    mover.cash += effect.fallbackCash;
    g.pushFloater(mover, effect.fallbackCash, atTile, "income");
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
    purchasePrice: defCity.buildCost,
    level: 0,
    maxLevel: defCity.maxLevel,
  });
  g.pushFloaterText(mover, `机遇「${def.id}」:${picked.tileName} 归你所有`, atTile);
  g.logEvent(
    "system",
    mover.guohao,
    `${mover.guohao} 机遇「${def.id}」:${narr},得「${picked.tileName}」`,
    `encounter player=${mover.id} id=${def.id} tier=${def.tier} city=${defCity.id}`,
  );
  return "settled";
}

/** 效果·汲取(#123):随机存活对手现金划转(上限=对方现有现金,不触发对方清算)。 */
function applySiphonEffect(
  g: GameEngine,
  mover: Player,
  atTile: number,
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
  g.pushFloater(mover, take, atTile, "income");
  if (take > 0) {
    g.dispatchMoment("CashLost", {
      subject: g.players.indexOf(target),
      amount: take,
    }); // 时机·CashLost:被动失银(被吸取方,#299 派发缺口补齐)
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

/** 效果·征粮(#123):向随机对手定向征银;现金不足走支付/清算,破产时效果内 endTurn。 */
function applyLevyEffect(
  g: GameEngine,
  mover: Player,
  atTile: number,
  def: EncounterDef,
  effect: Extract<EncounterEffect, { kind: "levy" }>,
  narr: string,
): "settled" | "liquidating" | "bankrupt" {
  const seat = g.players.indexOf(mover);
  const r = g.payOrLiquidate(mover, null, effect.amount);
  if (r === "liquidating") return "liquidating";
  const bankrupt = r === "bankrupt";
  const target = randomOpponentOf(g, mover);
  const paid = bankrupt ? 0 : effect.amount;
  if (target && paid > 0) {
    target.cash += paid;
    g.dispatchMoment("CashGained", {
      subject: g.players.indexOf(target),
      amount: paid,
    }); // 时机·CashGained:被动得银(得款对手,#299 派发缺口补齐)
  }
  g.pushFloater(mover, -paid, atTile, "expense");
  g.dispatchMoment("CashLost", { subject: seat, amount: paid });
  g.logEvent(
    "system",
    mover.guohao,
    `${mover.guohao} 机遇「${def.id}」:${narr} −${paid}${bankrupt ? " → 破产" : ""}`,
    `encounter player=${mover.id} id=${def.id} tier=${def.tier} paid=${paid} target=${target?.id ?? "-"}`,
    -paid,
  );
  if (bankrupt) g.endTurn();
  return bankrupt ? "bankrupt" : "settled";
}

/** 效果·互市(#123):国库出银,你与随机对手各得 amount(正和)。 */
function applyTradeEffect(
  g: GameEngine,
  mover: Player,
  atTile: number,
  def: EncounterDef,
  effect: Extract<EncounterEffect, { kind: "trade" }>,
  narr: string,
): "settled" | "liquidating" | "bankrupt" {
  const seat = g.players.indexOf(mover);
  const target = randomOpponentOf(g, mover);
  mover.cash += effect.amount;
  g.pushFloater(mover, effect.amount, atTile, "income");
  g.dispatchMoment("CashGained", { subject: seat, amount: effect.amount }); // 时机·CashGained:被动得银(互市己方,#299 派发缺口补齐)
  if (target) {
    target.cash += effect.amount;
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

/** 机遇体力接线(#132):staminaDelta 经 addStamina 落账(clamp 0~100;非 0 留「体力 ±n」
 *  浮字,对局日志 detail 补 stamina=落账值)→ 归 0 触发 exhaustIfDepleted。
 *  返回 "exhausted"=耗竭接管本落格:phase 进 AwaitingExhaustion、auto 已 endTurn 收尾回合——
 *  两种场合调用方都不得续跑城池结算(人倒下了不买地),与 liquidating/bankrupt 同占落格。 */
function applyEncounterStamina(
  g: GameEngine,
  mover: Player,
  atTile: number,
  def: EncounterDef,
  delta: number,
  narr: string,
): "settled" | "exhausted" {
  if (delta === 0) return "settled";
  const seat = g.players.indexOf(mover);
  const stamina = g.addStamina(seat, delta);
  const signed = `${delta > 0 ? "+" : "−"}${Math.abs(delta)}`;
  g.pushFloaterText(mover, `体力 ${signed}`, atTile);
  g.logEvent(
    "system",
    mover.guohao,
    `${mover.guohao} 机遇「${def.id}」:${narr},体力 ${signed}`,
    `encounterStamina player=${mover.id} id=${def.id} tier=${def.tier} delta=${delta} stamina=${stamina}`,
  );
  if (stamina !== 0) return "settled";
  const ex = exhaustIfDepleted(g, seat);
  if (ex === "none") throw new Error("机遇体力结算后 stamina>0:耗竭判定状态不一致"); // 零兜底:状态不一致炸出来
  if (ex === "auto" && g.turnPhase !== "Roll" && !g.isOver) {
    // 自动惩罚收口(#132):唯一可用选项路径(settleExhaustionChoice)内部已 endTurn
    // (turnPhase=Roll);「无可处置城池」纯跳回合路径不收尾回合——由机遇结算侧补
    // endTurn,人倒下了回合即止,不留悬空相位。
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
