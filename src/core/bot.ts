// AI 诸侯:回合 EV 决策(抽签/辅路/买/升级/抉择机遇/锦囊),Simple/Normal 两档。
// 选都决策在 GameEngine.aiChooseCapital。经过都城必停由引擎 rollAndMove 直接结算,无 bot 抉择点。
import type { GameEngine } from "./game";
import type { Player } from "./types";
import type { EncounterEffect } from "./encounters";
import { jinnangCardOf } from "./jinnang";
import { heroSkillTargetOk } from "./choices";
import { netWorth } from "./networth";

/** 座位散列(抉择声望折算系数的性格源,#124):纯座位派生,确定性、与对局状态无关,
 *  不消耗引擎骰(重放安全)。 */
function seatHash(seat: number): number {
  let h = (seat + 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** 声望折银系数(#124):5 + (seatHash % 5) ∈ [5,9]——不同 bot 性格不同:重声望者愿为
 *  声望多掏银(携民渡江式的仁主),轻声望者见利即取。repDelta × 系数折成银两后与选项的
 *  立即银两影响同尺比较。exported 供单测。 */
export function repCoefficient(seat: number): number {
  return 5 + (seatHash(seat) % 5);
}

/** 抉择选项的立即银两影响(#124 bot 贪心口径):cash 直取;玩家间转移(siphon/trade/levy)
 *  按面值;grantHero/grantCity 只计 fallbackCash(得将得城的长期价值不入立即净值);
 *  grantTreasure 无现金流量计 0;无 effect(纯声望/无事)= 0。exported 供单测。 */
export function encounterCashImpact(effect: EncounterEffect | undefined): number {
  if (!effect) return 0;
  switch (effect.kind) {
    case "cash":
      return effect.delta;
    case "siphon":
    case "trade":
      return effect.amount;
    case "levy":
      return -effect.amount;
    case "grantCard":
      return 0; // #147:得的是锦囊,无现金流量
    case "grantHero":
    case "grantCity":
      return effect.fallbackCash;
    case "grantTreasure":
      return 0;
  }
}

function estimateDestValue(engine: GameEngine, p: Player, destIndex: number): number {
  const tile = engine.board.at(destIndex);
  const def = engine.catalog.get(tile.propertyId);
  if (!def) return 0;
  const owner = engine.findOwner(def.id);
  if (!owner) return def.purchasePrice / 4; // 可买
  if (owner === p) {
    // 可免费扩军:价值 ≈ 升级后与当前等级城池价值之差 / 4(满级为 0)
    const h = p.properties.find((x) => x.propertyId === def.id);
    if (!h || h.level >= def.maxLevel) return 0;
    return (def.valueByLevel[h.level + 1] - def.valueByLevel[h.level]) / 4;
  }
  return 0; // 落他人城:无过路费(城主无珍宝=无事;有珍宝则城主择公道买卖/坐地起价,访客不可控,估中性)
}

/** 辅路入口抉择:走大路时下一落点的近似价值(平均掷骰 3.5 步后的 tile)。 */
function estimateBranchMainEv(engine: GameEngine, p: Player): number {
  const n = engine.board.count;
  const dest = (p.position + 4) % n; // 约 3-4 步后的主路落点
  return estimateDestValue(engine, p, dest);
}

// ────────────────────────── 锦囊策略(#148,T6,docs/explanation/锦囊设计.md §8)──────────────────────────

/** botAct 选项(#148):conservative=看门狗接管口径——锦囊永不主动用,一律「今不用」
 *  保守推进(目标段先作罢再收卷),全程不掷骰(重放安全);缺省 false=托管按策略表。
 *  skills(#188 档 3):主动技政策——缺省 "strategy"=真 bot 依净值贪心可出技;
 *  "hold"=永不出技(人类座位的代驾:自助托管,及看门狗/接管——技能是长线战略资源,
 *  代驾不替主人花;比锦囊更保守:锦囊代驾口径是「接管不用、自助托管按策略」)。 */
export interface BotActOptions {
  conservative?: boolean;
  skills?: "strategy" | "hold";
}

/** 锦囊意图(#148):策略表对单张牌的「用/不用 + 偏好目标序」。exported 供单测
 *  (连环计/军情密探结算未接入,端到端到不了,纯决策直测)。 */
export interface JinnangIntent {
  use: boolean;
  /** one/two-others 域的偏好目标座位(优先序:排位在前者优先;连环计两段依次取 [0]、[1])。
   *  仅是策略偏好——真正可发性仍以目标段 choicesFor 的 available 为准(ADR-0013 同口径)。 */
  targets?: number[];
}

/** 全体玩家现金中位数:奇数家取中位;偶数家取中间两位均值。确定性,不掷骰。exported 供单测。 */
export function medianCash(players: Player[]): number {
  const xs = players.map((p) => p.cash).sort((a, b) => a - b);
  const mid = xs.length >> 1;
  return xs.length % 2 === 1 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}

/** 锦囊策略表(#148):横征暴敛=可用即用;连环计=现金最高的两人相咬、次富者现金 ≥400
 *  才值得(可用目标 <2 → 不用);窃玉=珍宝最多者;火烧=城最多者;缓兵=仅对当前身价
 *  领先者(netWorth=现金,单口径;自己是领先者则无的放矢);密探=自己手牌 ≥2 才用;
 *  免战=现金低于全体玩家现金中位数(原表「房租均值」——本引擎无房租概念,#148 改中位数
 *  口径);求贤=可用即用。并列一律取座位序小者(输入保持座位序 + 稳定排序,禁
 *  Math.random,重放安全)。
 *  目标候选的可达性预筛(非己/存活/未庇护/有珍宝/有城)是 choices.ts jinnangTargetOk 的
 *  公开信息镜像,只用于「用不用 + 偏好序」;提交时引擎仍按目标段选项集逐段复验。 */
export function jinnangIntent(engine: GameEngine, cardId: string): JinnangIntent {
  const me = engine.activePlayer;
  const mySeat = engine.players.indexOf(me);
  const others = engine.players
    .map((t, seat) => ({ t, seat }))
    .filter(({ t, seat }) => seat !== mySeat && !t.isBankrupt && !t.jinnangShield);
  const byKeyDesc = (key: (x: { t: Player; seat: number }) => number) =>
    [...others].sort((a, b) => key(b) - key(a)); // 稳定排序:并列保持座位序(序小在前)
  switch (jinnangCardOf(cardId).effect.kind) {
    case "levyAll": // 横征暴敛:可用即用
    case "grantHero": // 求贤令:可用即用
      return { use: true };
    case "jinnangShield": // 免战金牌:现金低于全体现金中位数才用
      return { use: me.cash < medianCash(engine.players) };
    case "skipTurn": {
      // 缓兵之计:仅当目标当前身价领先;自己领先则无人值得拖
      const leader = [...engine.players]
        .map((t, seat) => ({ t, seat }))
        .sort((a, b) => netWorth(b.t) - netWorth(a.t))[0];
      return leader.seat === mySeat ? { use: false } : { use: true, targets: [leader.seat] };
    }
    case "stealTreasure": {
      // 窃玉偷香:珍宝最多者(无珍宝者不入选)
      const ranked = byKeyDesc(({ t }) => t.treasures.length).filter(({ t }) => t.treasures.length > 0);
      return { use: ranked.length > 0, targets: ranked.map(({ seat }) => seat) };
    }
    case "demolish": {
      // 火烧连营:城最多者(无城者不入选)
      const ranked = byKeyDesc(({ t }) => t.properties.length).filter(({ t }) => t.properties.length > 0);
      return { use: ranked.length > 0, targets: ranked.map(({ seat }) => seat) };
    }
    case "peek":
      // 军情密探:自己手牌 ≥2 才用(bot 拿信息无用,基本留给玩家——§8);目标取现金最高者
      return {
        use: me.jinnangHand.length >= 2,
        targets: byKeyDesc(({ t }) => t.cash).map(({ seat }) => seat),
      };
    case "duel": {
      // 连环计:现金最高的两人相咬;次富者现金 <400 或可用目标 <2 → 不用
      const ranked = byKeyDesc(({ t }) => t.cash);
      return {
        use: ranked.length >= 2 && ranked[1].t.cash >= 400,
        targets: ranked.slice(0, 2).map(({ seat }) => seat),
      };
    }
  }
}

/** 主动技意图(#188 档 3):策略表对单个技能的「用/不用 + 偏好目标序」。净值贪心、
 *  确定性(不掷骰,并列取座位序小者);exported 供单测。可发性仍以技能目标段
 *  choicesFor 的 available 为准(ADR-0013 同口径)。
 *  火攻=城最多者(与火烧连营同则);赈济=自身体力 <70 且付得起时自疗;
 *  征辟=可用即用(委任状稀缺,50 两补偿出自国库稳赚),补偿给现金最少的诸侯(买弱不买强);
 *  擂鼓=可用即用(免费步数 +2,过都城补给/委任状更频繁)。 */
export function heroSkillIntent(engine: GameEngine, skillId: string): JinnangIntent {
  const me = engine.activePlayer;
  const mySeat = engine.players.indexOf(me);
  const others = engine.players
    .map((t, seat) => ({ t, seat }))
    .filter(({ t, seat }) => seat !== mySeat && !t.isBankrupt);
  const byKeyDesc = (key: (x: { t: Player; seat: number }) => number) =>
    [...others].sort((a, b) => key(b) - key(a)); // 稳定排序:并列保持座位序(序小在前)
  const skill = engine.players[mySeat].heroes.find((h) => h.active?.id === skillId)?.active;
  if (!skill) throw new Error(`未知主动技:${skillId}(决策者麾下无此技,数据 bug)`); // 同 jinnangCardOf 口径:查不到就炸
  switch (skill.kind) {
    case "demolish": {
      // 火攻:城最多者,且须过 demolish 守卫(有可降/可失之城)——守卫镜像只筛「用不用 +
      // 偏好序」,提交时引擎目标段选项集逐段复验
      const ranked = byKeyDesc(({ t }) => t.properties.length).filter(
        ({ seat }) => heroSkillTargetOk(engine, mySeat, seat, skill).ok,
      );
      return { use: ranked.length > 0, targets: ranked.map(({ seat }) => seat) };
    }
    case "relief": {
      const cost = skill.params?.cost ?? 0;
      return { use: me.stamina < 70 && me.cash >= cost, targets: [mySeat] };
    }
    case "patronage": {
      // 征辟:可用即用;补偿给现金最少者(-cash 降序 = 现金升序,并列座位序小在前)
      const poorest = byKeyDesc(({ t }) => -t.cash);
      return { use: poorest.length > 0, targets: poorest.map(({ seat }) => seat) };
    }
    case "warDrum":
      return { use: true };
  }
}

/** 目标段提交(#148):按意图偏好序对着引擎目标段选项集(唯一可用口径)逐段提交;
 *  偏好目标全不可发 → 作罢(牌不消耗,退回卡牌段)返回 false,由调用方换下一张。 */
function commitJinnangTargets(engine: GameEngine, cardId: string): boolean {
  const prefs = jinnangIntent(engine, cardId).targets ?? [];
  while (engine.pendingJinnang) {
    const stage = engine.pendingJinnang.stage;
    const wanted = stage === "two-b" ? prefs.slice(1, 2) : prefs; // 连环计第二段必须次挑
    let seat: number | null = null;
    for (const w of wanted) {
      const opt = engine.choicesFor().find((o) => o.available && o.targetSeat === w);
      if (opt?.targetSeat != null) {
        seat = opt.targetSeat;
        break;
      }
    }
    if (seat == null) {
      engine.resolveJinnang(cardId, undefined, true); // 作罢
      return false;
    }
    engine.resolveJinnang(cardId, [seat]);
  }
  return true;
}

/** 技能目标段提交(#188 档 3):按意图偏好序对着引擎技能目标段选项集选第一个可用者;
 *  偏好全不可发 → 作罢(不记冷却)返回 false。 */
function commitHeroSkillTargets(engine: GameEngine, skillId: string): boolean {
  const prefs = heroSkillIntent(engine, skillId).targets ?? [];
  const opt = engine
    .choicesFor()
    .find((o) => o.available && o.targetSeat != null && prefs.includes(o.targetSeat));
  if (opt?.targetSeat != null) {
    engine.resolveHeroSkill(skillId, [opt.targetSeat]);
    return true;
  }
  engine.resolveHeroSkill(skillId, undefined, true); // 作罢
  return false;
}

/** 军师幕决策(#148 锦囊 → #188 档 3 扩义):可用项(经 choicesFor 同口径,ADR-0013)
 *  = 可用锦囊 + (skills="strategy" 时的)就绪主动技,按窗口顺序逐项过策略表,取第一张
 *  「值得用」的;锦囊指向域提交后入目标段按偏好序选人,偏好全不可发作罢换下一张;
 *  技能目标段同构。用一项后引擎可能停留窗口(异类标签/其他就绪技),循环续推直到收卷;
 *  tried 挡作罢-重选死循环,guard 兜底。Simple 难度掺骰 50% 弃权(确定性:同 seed 同掷)。
 *  skills="hold"(人类座位代驾):技能选项不参评,目标段残留亦只作罢不续推。 */
function driveJinnang(engine: GameEngine, simple: boolean, skills: "strategy" | "hold"): void {
  const tried = new Set<string>();
  if (engine.pendingJinnang) {
    // 中途接管:上一调用停在锦囊目标段,先续推完这一张
    const cardId = engine.pendingJinnang.cardId;
    tried.add(cardId);
    commitJinnangTargets(engine, cardId);
  }
  if (engine.pendingSkill && skills === "strategy") {
    // 中途接管:停在技能目标段,续推这一技
    const skillId = engine.pendingSkill.skillId;
    tried.add(`skill:${skillId}`);
    commitHeroSkillTargets(engine, skillId);
  }
  const skillEligible = (o: { skillId?: string }) => o.skillId != null && skills === "strategy";
  let guard = 0;
  while (engine.turnPhase === "AwaitingJinnang" && guard++ < 12) {
    const chosen = engine
      .choicesFor()
      .filter((o) => o.available && (o.cardTags != null || skillEligible(o)))
      .find((o) => {
        if (tried.has(o.id)) return false;
        return o.skillId != null
          ? heroSkillIntent(engine, o.skillId).use
          : jinnangIntent(engine, o.id).use;
      });
    if (!chosen) {
      engine.resolveJinnang(null);
      break;
    }
    if (simple && engine.dice.nextFloat() < 0.5) {
      engine.resolveJinnang(null); // Simple 50% 弃权
      break;
    }
    tried.add(chosen.id);
    if (chosen.skillId != null) {
      engine.resolveHeroSkill(chosen.skillId); // other/any 域 → 入目标段;none 域 → 直接执行
      if (engine.pendingSkill) commitHeroSkillTargets(engine, chosen.skillId);
    } else {
      engine.resolveJinnang(chosen.id); // one/two-others → 入目标段;self/all-others → 直接执行
      if (engine.pendingJinnang) commitJinnangTargets(engine, chosen.id);
    }
  }
}

/** 驱动当前 bot 回合的一步决策;UI 在 bot 回合轮询调用直到进入下一玩家或 GameOver。 */
export function botAct(engine: GameEngine, opts?: BotActOptions): void {
  const p = engine.activePlayer;
  const simple = engine.difficulty === "Simple";

  switch (engine.turnPhase) {
    case "Roll":
      engine.rollAndMove();
      break;

    case "AwaitingBranch": {
      // 辅路入口抉择:Simple 随机;Normal 估辅路 EV(treasure≈指导价期望 + event 轻微正 − penalty 风险)vs 主路落点价值
      if (simple) {
        engine.selectBranch(engine.dice.nextFloat() < 0.5 ? "Main" : "Branch");
        return;
      }
      const branch = engine.board.branch;
      let branchEv = 0;
      if (branch) {
        const cells = branch.cells;
        // 平均掷骰 3.5:辅路每格约 1/3.5 概率被踩中(简化估)
        const hitProb = 1 / 3.5;
        for (const c of cells) {
          if (c.kind === "treasure") branchEv += hitProb * 300; // 探宝期望(拼点成功率×指导价,粗估;经济 v2:珍宝 1-30 两)
          else if (c.kind === "event") branchEv += hitProb * 100; // 锦囊轻微正期望
          else branchEv -= hitProb * 500; // 中伏:跳一回合的机会成本
        }
      }
      // 主路:下一落点价值(起点 tile 之后约 3.5 步)
      const mainEv = estimateBranchMainEv(engine, p);
      engine.selectBranch(branchEv >= mainEv ? "Branch" : "Main");
      return;
    }

    case "AwaitingDecision": {
      // ADR-0013:先经 choicesFor 选项集注册表过滤可用项(与引擎自动执行同一口径,防第三套
      // 判断漂移),再按启发式选择。引擎已保证进入该相位时 ≥2 真实选项,此处过滤是收敛口径。
      const avail = engine.choicesFor().filter((o) => o.available);
      const def = engine.pendingLand != null ? engine.pendingLandDef() : null; // 决策上下文(spec #107 C2)
      if (avail.some((o) => o.id === "buy") && def) {
        const want = p.cash > def.purchasePrice * 1.5 && (simple ? engine.dice.nextFloat() < 0.5 : true);
        if (want) engine.buyProperty();
        else engine.endDecision();
      } else if (avail.some((o) => o.id === "upgrade")) {
        // 扩军免费:未满级即升(Simple 保留随机性情;满级已被引擎自动按兵不动)
        const want = simple ? engine.dice.nextFloat() < 0.75 : true;
        if (want) engine.upgradeProperty();
        else engine.endDecision();
      } else {
        engine.endDecision();
      }
      break;
    }

    case "AwaitingJinnang": {
      // 军师幕(#122/T2 → #148/T6 策略 → #188 档 3 并入主动技):conservative(看门狗/接管)
      // 一律保守推进——技能目标段/锦囊目标段先作罢再收卷,不掷骰,永不代花资源;托管按
      // 策略表(§8)经 driveJinnang 推进,其中主动技遵 skills 政策(代驾 "hold" 永不出技)。
      if (opts?.conservative) {
        if (engine.pendingSkill) engine.resolveHeroSkill(engine.pendingSkill.skillId, undefined, true); // 技能目标段:作罢(不记冷却)
        if (engine.pendingJinnang) engine.resolveJinnang(null); // 锦囊目标段:作罢(牌退回)
        if (engine.turnPhase === "AwaitingJinnang") engine.resolveJinnang(null); // 卡牌段:今不用
        break;
      }
      driveJinnang(engine, simple, opts?.skills ?? "strategy");
      break;
    }

    case "AwaitingExhaustion": {
      // 体力耗竭惩罚(#130):bot 随机弃一座(确定性走引擎 dice,保重放)。
      const available = engine
        .choicesFor()
        .map((o, i) => ({ o, i }))
        .filter(({ o }) => o.available);
      if (available.length > 0) {
        const pick = available[Math.floor(engine.dice.nextFloat() * available.length)];
        engine.resolveExhaustionChoice(pick.i);
      }
      break;
    }

    case "AwaitingHeroPick": {
      // bot 招贤纳士:随机选一位
      const count = engine.offeredHeroes.length;
      if (count > 0) engine.resolveHeroPick(Math.floor(engine.dice.nextFloat() * count));
      else engine.resolveHeroPick(0);
      break;
    }

    case "AwaitingEncounter": {
      // 抉择机遇(#124):立即净值贪心——score = 选项 effect 银两影响 + repDelta × 声望折银
      // 系数(repCoefficient(decisionOwner),不同 bot 性格不同)。确定性:不掷骰,同分取
      // 目录序在前者。Simple/Normal 同策略:一次性小事件不值得两档启发式。选项集先经
      // choicesFor 过滤(ADR-0013 同一口径,不可用选项不参评)。
      const enc = engine.pendingEncounter;
      if (!enc || !enc.choices) throw new Error("AwaitingEncounter 相位 pendingEncounter/choices 缺失:状态机不一致"); // 零兜底
      const choices = enc.choices; // 收窄进闭包(TS 不跨闭包保持窄化)
      const coef = repCoefficient(engine.decisionOwner);
      let bestIdx = -1;
      let bestScore = -Infinity;
      engine.choicesFor().forEach((o, i) => {
        if (!o.available) return;
        const c = choices[i];
        if (!c) throw new Error(`机遇「${enc.id}」选项 ${i} 越界:选项注册表与目录不一致`); // 零兜底
        const score = encounterCashImpact(c.effect) + c.repDelta * coef;
        if (score > bestScore) {
          bestScore = score;
          bestIdx = i;
        }
      });
      if (bestIdx >= 0) engine.resolveEncounterChoice(bestIdx);
      break;
    }

    case "AwaitingTreasureOwner": {
      // bot 城主:公道买卖(指导价)/坐地起价(加价)/跳过。
      //  Normal:高等级珍宝(≥6)溢价卖,低等级公道卖,偶尔(20%)跳过。
      //  Simple:随机 fair/premium/skip。
      const owner = engine.players[engine.treasureVisitor?.ownerIdx ?? 0];
      const treasures = owner.treasures;
      if (treasures.length === 0) { engine.resolveTreasureOwner({ type: "skip" }); break; }
      const pick = treasures[Math.floor(engine.dice.nextFloat() * treasures.length)];
      if (simple) {
        const r = engine.dice.nextFloat();
        if (r < 0.34) engine.resolveTreasureOwner({ type: "fair", treasureId: pick.id });
        else if (r < 0.68) engine.resolveTreasureOwner({ type: "premium", treasureId: pick.id });
        else engine.resolveTreasureOwner({ type: "skip" });
        break;
      }
      // Normal
      if (engine.dice.nextFloat() < 0.2) { engine.resolveTreasureOwner({ type: "skip" }); break; }
      const mode = pick.level >= 6 ? "premium" : "fair";
      engine.resolveTreasureOwner({ type: mode, treasureId: pick.id });
      break;
    }

    case "AwaitingBankruptcySettle": {
      // bot 清算:卖资产到够(优先名将→低珍宝→城,排除都城),再 confirm
      const p = engine.activePlayer;
      const debt = engine.pendingDebt!;
      const cap = engine.board.at(p.capitalIndex)?.propertyId;
      while (p.cash < debt.amount) {
        if (p.heroes.length) { engine.cashHeroBankruptcy(p.heroes[0].id); continue; }
        if (p.treasures.length) {
          const low = [...p.treasures].sort((a, b) => a.level - b.level)[0];
          engine.sellTreasureBankruptcy(low.id); continue;
        }
        const sellable = p.properties.find((h) => h.propertyId !== cap);
        if (sellable) { engine.sellPropertyBankruptcy(sellable.propertyId); continue; }
        break;
      }
      engine.confirmBankruptcySettle();
      break;
    }

    default:
      break;
  }
}
