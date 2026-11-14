// 锦囊+主动技+效果执行域(#122/#188 档 3,ADR-0019 委托式拆分 #319):出牌阶段
// (AwaitingJinnang)抽牌/用牌决策、出牌宣布与反应窗挂点、锦囊效果执行、名将主动技
// 结算,以及招贤共享结算单点。域逻辑=自由函数,首参接 GameEngine 直接
// 读写引擎状态;与数据表 jinnang.ts/heroes.ts 分层(执行≠数据)。GameEngine 侧保留同名
// 公共方法薄委托(authority.ts);反应窗域(reaction-window.ts)续结算经 g.executeJinnang/
// g.settleJinnangExit 壳上委托回调,本域开窗/留痕/拼点则直调 reaction-window 自由函数。
import type { GameEngine } from "./authority";
import {
  activeSkillOf,
  cityTargetOptionId,
  computeChoices,
  fireWallSplashCities,
  hasUsableJinnang,
  skillOptionId,
} from "./choices";
import { diceShuffle, jinnangCardOf, TARGET_DOMAIN_STAGES } from "./jinnang";
import { formatMoney } from "./money";
import { HERO_CAPACITY } from "./constants";
import { heroById, HEROES } from "./heroes";
import {
  grantedNamesLine,
  heroSlotOf,
  learnSkillInSlot,
  rollGrantedSkills,
  skillBookLearners,
  type HeroSlot,
} from "./roster";
import { grantHeroOrBooks } from "./recruitment";
import { isSkillBook } from "./treasures";
import { skillById, type ActiveSkillDef } from "./skills";
import {
  openReactionWindow,
  resolveDuel,
  REACTION_EXPECT,
  type ReactionPayload,
  type ReactionViewSeed,
} from "./reaction-window";
import { emitGameEvent } from "./game-events";
import { applyFireDamage } from "./defense";
import { findHolding } from "./player";
import type { Player } from "./model";

// ── 锦囊/出牌阶段引擎态载荷(#122/#188 档 3;#326 types.ts 解散,ADR-0019 类型随域走)──
/** 锦囊目标段载荷(#122/T3):选牌后进入选人子状态(同相位内重算选项集);
 *  stage:one=单选立即执行;two-a/two-b=两步流首/末段(段数与排除语义声明单源
 *  jinnang.TARGET_DOMAIN_STAGES,#1067;末段候选排除首段已定目标)。
 *  picked 为已定座位;随快照走(目标段中途断线可恢复)。 */
export interface PendingJinnang {
  cardId: string;
  stage: "one" | "two-a" | "two-b";
  picked: number[];
}

/** 技能目标段载荷(#188 档 3;#817 携实例定位):选技后进入选人子状态(AwaitingJinnang
 *  相位内重算选项集);heroId+skillId=麾下实例定位对(与选项 id/命令同形状,拼接单源
 *  choices.skillOptionId),发动直落本实例。随快照走(目标段中途断线可恢复)。
 *  与锦囊 pendingJinnang 互斥(同一时刻至多一个子状态)。
 *  提交通道(#1388 T2 目标域分派):席位域 targets=[座位];城目标域(火攻)targets=
 *  [目标城 tileIndex](候选选项 targetTileIndex 同值,id 拼接单源 choices.cityTargetOptionId)。 */
export interface PendingHeroSkill {
  heroId: string;
  skillId: string;
}

/** 抽锦囊(#122/T1):从牌库堆顶抽 count 张入手。手牌无上限(#250),抽牌恒成功;
 *  牌库空而弃牌非空 → 弃牌堆骰序洗回牌库(正式机制,逐张检查,洗回后继续抽满 count)
 *  再抽;双空(牌库与弃堆皆空)→ 落空宣告(jinnangExhausted 事件,每次调用至多一次;
 *  「锦囊已空」浮字由 fx 面消费派生,#588 迁事件面)。
 *  返回实际入手张数(#384:落空=无转移,调用方据此不产转移类事件)。
 *  日志只记「抽了一张锦囊」不记牌名——暗牌内容不过对局日志(ADR-0016,日志随快照全网可见)。
 *  时机·JinnangGained(#456):物理单点内部派发(入手张数>0 时按次派一次),三路同覆盖
 *  ——起手发牌/锦囊城/机遇授书;暗牌不带牌 id(ADR-0016)。 */
export function drawJinnang(g: GameEngine, seat: number, count = 1): number {
  const p = g.players[seat];
  if (!p || p.isBankrupt) return 0;
  let emptyNotified = false;
  let drawn = 0;
  for (let k = 0; k < count; k++) {
    if (g.jinnangDeck.length === 0) {
      if (g.jinnangDiscard.length > 0) {
        reshuffleDiscardIntoDeck(g, seat); // 洗回后落到下方堆顶抽取,本迭代照常入手
      } else {
        if (!emptyNotified) {
          emitGameEvent(g, seat, { kind: "jinnangExhausted" }); // 落空宣告走事件面(#588):零转移纯宣告,浮字归 fx
          emptyNotified = true;
        }
        continue;
      }
    }
    const id = g.jinnangDeck.pop()!;
    g.jinnangDeckCount = g.jinnangDeck.length;
    p.jinnangHand.push(id);
    p.jinnangHandCount = p.jinnangHand.length;
    drawn++;
    g.logEvent(
      "system",
      p.guohao,
      `${p.guohao} 抽了一张锦囊(手牌 ${p.jinnangHand.length})`,
      `jinnangDraw player=${p.id} handSize=${p.jinnangHand.length}`,
    );
  }
  if (drawn > 0) g.dispatchMoment("JinnangGained", { subject: seat, count: drawn }); // 时机·JinnangGained:得锦囊进手(#456,落空不派)
  return drawn;
}

/** 弃牌堆洗回牌库(牌库耗尽的正式机制,非防御逻辑):弃牌堆骰序(diceShuffle 单源,
 *  g.dice 驱动——与开局 buildJinnangDeck 同一随机源,rngState 随快照序列化,联机/恢复
 *  确定性一致)整体洗成新牌库,弃堆清空,公开计数同步。宣告走事件面:对局日志一行
 *  (jinnangReshuffle 机读前缀)+ jinnangReshuffled 事件(count=洗回张数;洗后牌序是
 *  暗信息,事件不带牌 id——ADR-0016,比保密口径只少不多);浮字由 fx 面消费事件派生
 *  (event-extract,单机/联机同通路,引擎侧不推)。 */
function reshuffleDiscardIntoDeck(g: GameEngine, seat: number): void {
  const deck = diceShuffle(g.jinnangDiscard, g.dice);
  g.jinnangDeck = deck;
  g.jinnangDiscard = [];
  g.jinnangDeckCount = g.jinnangDeck.length;
  const p = g.players[seat];
  g.logEvent(
    "system",
    p.guohao,
    `${p.guohao} 弃牌堆 ${deck.length} 张洗回牌库`,
    `jinnangReshuffle player=${p.id} count=${deck.length}`,
  );
  emitGameEvent(g, seat, { kind: "jinnangReshuffled", count: deck.length });
}

/** 抽锦囊进手并产事件(#384):drawJinnang 之上带 reason 产出 jinnangDrawn(count=
 *  实际入手;0=牌库空落空,无转移即无事件)。开局发牌(setup-flow)直走 drawJinnang
 *  不发——起手属开局校准点覆盖,与初始现金/体力同口径;游戏时进手(机遇/
 *  锦囊城)一律经本口。隐私口径:不写牌名(ADR-0016,与对局日志同)。 */
export function drawJinnangTraced(
  g: GameEngine,
  seat: number,
  count: number,
  reason: string,
): void {
  const drawn = drawJinnang(g, seat, count);
  if (drawn > 0) emitGameEvent(g, seat, { kind: "jinnangDrawn", count: drawn, reason });
}

/** 回合开始掷骰前(#122/T2):按注册表算锦囊选项集,有可用牌才进相位(ADR-0013:
 *  ≤1 可用=静默跳过不弹卷轴)。无可用牌时维持 Roll,不打扰。 */
export function enterJinnangPhase(g: GameEngine): void {
  if (hasUsableJinnang(g)) {
    g.turnPhase = "AwaitingJinnang";
  }
}

/** 用锦囊(#122/T2):cardId=null=今不用(收卷进 Roll);否则校验持有/可用(标签名额)
 *  后结算效果,再重算选项集——同回合仍有可用牌(异类标签)则继续停留卷轴,否则进 Roll。
 *  用牌是公开事件(战报+宣布事件,浮字由 fx 面派生),暗的只有持有(ADR-0016)。
 *  #188 档 3:出牌阶段内与技能目标段(pendingSkill)共存——cardId=null 时若停在技能目标段,
 *  代为作罢该技(驱动方兜子状态安全),其余锦囊命令属跨子状态误用,警告拒绝。 */
export function resolveJinnang(
  g: GameEngine,
  cardId: string | null,
  targets?: number[],
  cancel?: boolean,
): void {
  if (!g.assertPhase("AwaitingJinnang", "resolveJinnang")) return;
  const p = g.activePlayer;
  const userSeat = g.players.indexOf(p);

  // ── 技能目标段在场:锦囊命令只放行「收卷」语义(#188 档 3)──
  if (g.pendingSkill) {
    if (cardId == null || cancel) {
      cancelPendingSkill(g);
      return;
    }
    g.warn(`技能目标段内收到锦囊命令:${cardId}`);
    return;
  }

  // ── 目标段:提交目标 / 作罢 ──
  const pending = g.pendingJinnang;
  if (pending) {
    const def = jinnangCardOf(pending.cardId);
    if (cancel || cardId == null) {
      g.logEvent(
        "system",
        p.guohao,
        `${p.guohao} 作罢【${def.id}】`,
        `jinnangCancel player=${p.id} card=${def.id}`,
      );
      g.pendingJinnang = null;
      settleJinnangExit(g); // 牌未消耗,回卡牌段或收卷
      return;
    }
    if (cardId !== pending.cardId || !targets || targets.length !== 1) {
      g.warn(`目标段命令与载荷不符:${cardId}`);
      return;
    }
    const [target] = targets;
    // 目标段复验单源=选项集(#1389 目标域分派:席位域 id=t<座位>;城指向域 id=c<tileIndex>,
    // 拼接单源 choices.cityTargetOptionId——与技能城目标段同形制)
    const wantId = def.targetDomain === "one-city" ? cityTargetOptionId(target) : `t${target}`;
    if (!computeChoices(g, "AwaitingJinnang").some((o) => o.id === wantId && o.available)) {
      g.warn(`目标不可用:${def.targetDomain === "one-city" ? "城格" : "座位"} ${target}`);
      return;
    }
    if (pending.stage === "one") {
      g.pendingJinnang = null;
      settleJinnangPlay(g, p, userSeat, def, [target]);
      return;
    }
    // 两步流(stages=2 声明单源 TARGET_DOMAIN_STAGES,#1067;连环计为首例,T4):
    // two-a 存首挑进 two-b;two-b 合并执行
    if (pending.stage === "two-a") {
      g.pendingJinnang = { cardId: pending.cardId, stage: "two-b", picked: [target] };
      return; // 留在相位,选项集重算为第二段候选
    }
    g.pendingJinnang = null;
    settleJinnangPlay(g, p, userSeat, def, [...pending.picked, target]);
    return;
  }

  // ── 卡牌段 ──
  if (cardId == null) {
    g.logEvent("system", p.guohao, `${p.guohao} 锦囊今不用`, `jinnangPass player=${p.id}`);
    g.turnPhase = "Roll";
    return;
  }
  const def = jinnangCardOf(cardId);
  if (!p.jinnangHand.includes(cardId)) {
    g.warn(`${p.guohao} 手中无锦囊【${def.id}】`);
    return;
  }
  const option = computeChoices(g, "AwaitingJinnang").find((o) => o.id === cardId);
  if (!option?.available) {
    g.warn(`${p.guohao} 锦囊【${def.id}】不可用:${option?.reason ?? "未知原因"}`);
    return;
  }
  // 目标段分流读声明表 TARGET_DOMAIN_STAGES(#1067):stages 0=无目标段(self 自指/
  // all-others 全体/reaction 唯反应)直接宣布执行;1=单段单选;2=两步流(第二步排除
  // 首目标)。入目标段时牌暂不消耗(作罢可全退)。
  const flow = TARGET_DOMAIN_STAGES[def.targetDomain];
  if (flow.stages >= 1) {
    g.pendingJinnang = { cardId, stage: flow.stages === 2 ? "two-a" : "one", picked: [] };
    return; // 留在相位,选项集重算为候选名单
  }
  // 无目标段:立即宣布执行
  settleJinnangPlay(g, p, userSeat, def, []);
}

/** 城指向域宣布/结算共用的中心城格读取(#1389):targets 缺格=目标段载荷缺失,
 *  状态机 bug(零兜底)。 */
function requireCenter(def: ReturnType<typeof jinnangCardOf>, targets: number[]): number {
  const center = targets[0];
  if (center === undefined)
    throw new Error(`锦囊【${def.id}】缺中心城格(目标段载荷缺失,状态机 bug)`);
  return center;
}

/** 手牌段扣账(#122/T3):出牌=离手入弃堆+占标签名额(执行时点;作罢不占)。 */
function consumeJinnangCard(
  g: GameEngine,
  p: Player,
  cardId: string,
  def: ReturnType<typeof jinnangCardOf>,
): void {
  p.jinnangHand.splice(p.jinnangHand.indexOf(cardId), 1);
  p.jinnangHandCount = p.jinnangHand.length;
  g.jinnangDiscard.push(cardId);
  g.jinnangUsedTags.push(...def.tags);
}

/** 锦囊宣布与反应窗挂点(#281):出牌扣账 → 公开事件(jinnangAnnounced 事件浮字+出牌指示线,fx 面派生)→
 *  JinnangAnnounced 时机 → 持识破诡计者(使用者除外)询问窗;无有效识破则照常执行。
 *  主动技不经此口(fireHeroSkill 直结算,#229 口径:主动技不可被识破);反应牌不经
 *  出牌阶段「唯反应」灰置,根窗永不挂反应牌——识破自身的反制走 reaction-window
 *  链环窗(payload.counter,反识破,#571 ADR-0060)。 */
function settleJinnangPlay(
  g: GameEngine,
  user: Player,
  userSeat: number,
  def: ReturnType<typeof jinnangCardOf>,
  targets: number[],
): void {
  consumeJinnangCard(g, user, def.id, def); // 出牌即扣账:被识破也不回手(识破只护份)
  // 份清单(view.targetSeats):self=使用者自身一份;全体域=受影响全员;指向域=被指定者;
  // 城指向域(#1389)=受击城 tileIndex 清单(一份=一座受击城:有主且非打空都城免疫)。
  const splash =
    def.targetDomain === "one-city" ? fireWallSplashCities(g, requireCenter(def, targets)) : null;
  const shareSeats =
    def.targetDomain === "self"
      ? [userSeat]
      : def.targetDomain === "all-others"
        ? g
            .alivePlayers()
            .map((p) => g.players.indexOf(p))
            .filter((seat) => seat !== userSeat)
        : def.targetDomain === "one-city"
          ? splash!.filter((c) => c.ownerSeat != null && !c.immune).map((c) => c.tileIndex)
          : [...targets];
  // 时机 ctx 的 targetSeats 语义=受影响座位(处变不惊消费面):城指向域=受击城主座位
  // 去重(座位序;一份=城,时机面按「谁的城被烧」归座位,与席位域「人」语义对齐)
  const announcedSeats =
    def.targetDomain === "one-city"
      ? [...new Set(splash!.filter((c) => c.ownerSeat != null).map((c) => c.ownerSeat!))].sort(
          (a, b) => a - b,
        )
      : shareSeats;
  // 出牌宣告走 JinnangAnnounced 时机产事件:fx 面=出牌指示线+文案浮字(#719 死写删除)
  g.dispatchMoment("JinnangAnnounced", {
    subject: userSeat,
    cardId: def.id,
    targetSeats: announcedSeats,
  }); // 时机·JinnangAnnounced:锦囊宣布、结算前(识破诡计反应窗挂点)
  const queried = g
    .alivePlayers()
    .map((p) => g.players.indexOf(p))
    .filter(
      (seat) =>
        seat !== userSeat &&
        g.players[seat].jinnangHand.some(
          (id) => jinnangCardOf(id).effect.kind === REACTION_EXPECT.jinnang,
        ),
    );
  if (queried.length === 0) {
    // 无人可识破:不开窗,直接结算
    executeJinnang(g, user, userSeat, def, targets);
    settleJinnangExit(g);
    return;
  }
  const view: ReactionViewSeed = {
    kind: "jinnang",
    cardId: def.id,
    userSeat,
    targetSeats: shareSeats,
    queriedBySeat: queried,
  };
  const payload: ReactionPayload = {
    kind: "jinnang",
    userSeat,
    cardId: def.id,
    targets: [...targets],
  };
  openReactionWindow(g, view, payload); // bot 全代答时窗在开窗调用内即席结算
}

// ──────────────────────────── 名将主动技(#188 档 3)────────────────────────────
// 出牌阶段(AwaitingJinnang)内与锦囊同窗决策:resolveHeroSkill 与 resolveJinnang 并列的
// 命令入口。校验(冷却/持有/目标)单源选项集(choices.ts),UI/bot 永不裁决(ADR-0013);
// 结算复用既有单点(火攻=defense.applyFireDamage,#1388 T2 定向化);结算内不派发时机
// (防技能链级联,与 grantSkillCash 不派发 CashGained 同口径)。

/** 发动主动技(#817 实例定位):heroId+skillId 须定位到决策者麾下主动技实例且选项集
 *  可用(冷却/费用/目标门槛);无目标域发动即结算(直落本实例槽内账),席位域(other/any)
 *  与城目标域(#1388 T2 火攻)入目标段(pendingSkill,选项集重算为候选名单——席位域=
 *  候选座位,城目标域=合法城清单);cancel=作罢(回卡牌段或收卷,不记冷却)。 */
export function resolveHeroSkill(
  g: GameEngine,
  heroId: string,
  skillId: string,
  targets?: number[],
  cancel?: boolean,
): void {
  if (!g.assertPhase("AwaitingJinnang", "resolveHeroSkill")) return;
  if (g.pendingJinnang) {
    g.warn(`锦囊目标段内收到技能命令:${heroId}·${skillId}`);
    return;
  }
  const p = g.activePlayer;
  const userSeat = g.players.indexOf(p);

  // ── 目标段:提交目标 / 作罢 ──
  const pending = g.pendingSkill;
  if (pending) {
    const skill = activeSkillOf(p, pending.heroId, pending.skillId);
    if (!skill)
      throw new Error(
        `技能目标段载荷失效:${pending.heroId}·${pending.skillId}(麾下无此实例,状态机 bug)`,
      ); // 零兜底
    if (cancel) {
      cancelPendingSkill(g);
      return;
    }
    if (
      heroId !== pending.heroId ||
      skillId !== pending.skillId ||
      !targets ||
      targets.length !== 1
    ) {
      g.warn(`技能目标段命令与载荷不符:${heroId}·${skillId}`);
      return;
    }
    const [target] = targets;
    // 目标段复验单源=选项集(#1388 T2 目标域分派:席位域 id=t<座位>;城目标域
    // id=c<tileIndex>,拼接单源 choices.cityTargetOptionId)
    const wantId = skill.target === "city" ? cityTargetOptionId(target) : `t${target}`;
    if (!computeChoices(g, "AwaitingJinnang").some((o) => o.id === wantId && o.available)) {
      g.warn(`目标不可用:${skill.target === "city" ? "城格" : "座位"} ${target}`);
      return;
    }
    g.pendingSkill = null;
    fireHeroSkill(g, userSeat, heroSlotOf(p, pending.heroId), skill, targets);
    settleJinnangExit(g);
    return;
  }

  // ── 卡牌段:发动 ──
  const skill = activeSkillOf(p, heroId, skillId);
  if (!skill) {
    g.warn(`${p.guohao} 无此主动技:${heroId}·${skillId}`);
    return;
  }
  // 可用性随选项集归一(#817 实例化:每实例一选项,available=本实例冷却就绪);
  // 冷却账本在槽内各记(#785),发动直落命令指定的本实例槽,「首就绪槽」代寻退役
  const option = computeChoices(g, "AwaitingJinnang").find(
    (o) => o.id === skillOptionId(heroId, skillId),
  );
  if (!option?.available) {
    g.warn(`${p.guohao} 主动技【${skill.name}】不可用:${option?.reason ?? "未知原因"}`);
    return;
  }
  if (skill.target !== "none") {
    g.pendingSkill = { heroId, skillId };
    return; // 留在相位,选项集重算为候选名单
  }
  fireHeroSkill(g, userSeat, heroSlotOf(p, heroId), skill, []);
  settleJinnangExit(g);
}

/** 作罢技能目标段(#188 档 3):清载荷回卡牌段或收卷,技未发动不记冷却。 */
function cancelPendingSkill(g: GameEngine): void {
  const p = g.activePlayer;
  const pending = g.pendingSkill;
  const skill = pending ? activeSkillOf(p, pending.heroId, pending.skillId) : null;
  g.pendingSkill = null;
  if (skill) {
    g.logEvent(
      "system",
      p.guohao,
      `${p.guohao} 作罢【${skill.name}】`,
      `heroSkillCancel player=${p.id} skill=${skill.id}`,
    );
  }
  settleJinnangExit(g);
}

/** 主动技结算:冷却记账入槽(#785 槽内账,同名技各槽各账)+ 公开事件(施展浮字由 fx 面按
 *  事件派生,与出牌同口径)+ 效果落账。目标合法性已由目标段选项集校验,此处不再复核。
 *  targets 语义随目标域(#1388 T2):席位域=[座位];城目标域=[目标城 tileIndex]。 */
function fireHeroSkill(
  g: GameEngine,
  userSeat: number,
  slot: HeroSlot,
  skill: ActiveSkillDef,
  targets: number[],
): void {
  const user = g.players[userSeat];
  slot.lastFired[skill.id] = g.round;
  // 施展宣告走 heroSkillActivated 事件(fx 面文案浮字,#719 死写删除;heroId=槽定位,
  // 折叠按槽记账,同名技多槽不串账)。事件体按目标域判别(#1388 T2,#585 口径:漏传
  // 目标在类型层面不可表达)——fireBlast 必带目标城(propId+tileIndex,fx 指向线锚城格
  // /fold 留账两处消费),relief 必带 targetSeat,warDrum 无目标字段;载荷缺失=目标段
  // 状态机 bug,响亮炸出(零兜底)。
  if (skill.kind === "fireBlast") {
    const tileIndex = targets[0];
    if (tileIndex === undefined) throw new Error("火攻宣告缺目标城格(目标段载荷缺失,状态机 bug)"); // 零兜底
    const propId = g.board.at(tileIndex).propertyId;
    if (propId == null) throw new Error(`火攻宣告目标格 ${tileIndex} 无城(状态机 bug)`); // 零兜底
    emitGameEvent(g, userSeat, {
      kind: "heroSkillActivated",
      heroId: slot.heroId,
      skillId: skill.id,
      skillKind: "fireBlast",
      targetPropertyId: propId,
      targetTileIndex: tileIndex,
    });
  } else if (skill.kind === "relief") {
    const seat = targets[0];
    if (seat === undefined) throw new Error("赈济宣告缺目标座位(目标段载荷缺失,状态机 bug)"); // 零兜底
    emitGameEvent(g, userSeat, {
      kind: "heroSkillActivated",
      heroId: slot.heroId,
      skillId: skill.id,
      skillKind: "relief",
      targetSeat: seat,
    });
  } else {
    emitGameEvent(g, userSeat, {
      kind: "heroSkillActivated",
      heroId: slot.heroId,
      skillId: skill.id,
      skillKind: "warDrum",
    });
  } // 事件流(#384):主动技发动(发动者=seat;目标域随 skillKind 判别分支)
  const targetAudit =
    skill.target === "city"
      ? targets.length > 0
        ? `prop=${g.board.at(targets[0]!).propertyId ?? "-"} tile=${targets[0]}`
        : "-"
      : targets.length > 0
        ? g.players[targets[0]].id
        : "-";
  g.logEvent(
    "skill",
    user.guohao,
    `${user.guohao} 施展主动技【${skill.name}】`,
    `heroSkill owner=${user.id} skill=${skill.id} kind=${skill.kind} target=${targetAudit}`,
  );
  switch (skill.kind) {
    case "fireBlast":
      fireBlastOnCity(g, user, skill, targets[0]); // 火攻定向结算(#1388 T2;技路不派城损时机,#457)
      break;
    case "relief": {
      const cost = skill.params?.cost;
      const stamina = skill.params?.stamina;
      if (cost === undefined || stamina === undefined)
        throw new Error(`赈济参数缺失:params=${JSON.stringify(skill.params ?? {})}(数据 bug)`); // 零兜底
      user.cash -= cost; // 可用性已保证 cash ≥ cost(费用浮字不另发:施展文案+HUD 现金+战报承载,#719)
      const seat = targets[0];
      const target = g.players[seat];
      const staminaBefore = target.stamina;
      const after = g.addStamina(seat, stamina);
      const gained = after - staminaBefore; // 夹紧后实际差(#568 病 B):浮字/战报增量记实际差,非技能请求数
      const signedGained = `${gained >= 0 ? "+" : "−"}${Math.abs(gained)}`;
      emitGameEvent(g, seat, {
        kind: "staminaChanged",
        delta: gained,
        reason: "heroRelief",
      }); // 事件流(#384):体力变更(赈济,夹紧后实际增减;目标浮字由 fx 面派生)
      g.logEvent(
        "system",
        user.guohao,
        `${user.guohao} 【${skill.name}】:付 ${formatMoney(cost)},${target.guohao} 体力 ${signedGained}(现 ${after})`,
        `heroRelief owner=${user.id} skill=${skill.id} target=${target.id} cost=${cost} stamina=${stamina} staminaNow=${after}`,
        -cost,
      );
      break;
    }
    case "warDrum": {
      const bonus = skill.params?.bonus;
      if (bonus === undefined)
        throw new Error(`擂鼓参数缺失:params=${JSON.stringify(skill.params ?? {})}(数据 bug)`); // 零兜底
      g.heroDiceBonus = bonus;
      g.logEvent(
        "system",
        user.guohao,
        `${user.guohao} 【${skill.name}】:本回合掷骰步数 +${bonus}`,
        `heroWarDrum owner=${user.id} skill=${skill.id} bonus=${bonus}`,
      );
      break;
    }
    default: {
      // 穷尽守卫:ActiveSkillDef.kind 新增种类必须先实现结算案(编译期逼出)
      const exhausted: never = skill.kind;
      throw new Error(`主动技结算未接入:${String(exhausted)}(#188 档 3)`);
    }
  }
}

/** 火攻定向结算(#1388 T2,规格 #1386):对目标城(tileIndex 载荷)造成技表 damage 点
 *  火焰伤害,结算单点=defense.applyFireDamage(T1 交付,本域只消费不复制)。合法性
 *  (射程/等级/城主/冷却)单源目标段选项集(choices.heroSkillCityTargets 装配 +
 *  resolveHeroSkill 提交复验),本函数只结算;空格/无主到达此处=目标门被绕过,响亮炸
 *  (零兜底)。
 *  战报=「主动技【火攻】」来源段风格,果分文案:demolished=城防降为 N 级 /
 *  absorbed=防御值降至 N(0 级都城打空=打空吸收)/ lost=失城「X」——lost 在火攻
 *  不可达(目标门要求等级>0,等级>0 城在单点内只会降级不归失城分支),到得了即目标门
 *  被绕过,当场炸(零兜底)。
 *  #457 现状拍板:城损时机(PropertyDemolished/Lost)只挂锦囊路调用侧,火攻技路
 *  不派,本票不翻转;降级/失城留痕(propertyChanges)由单点内照 ADR-0015 写。 */
function fireBlastOnCity(
  g: GameEngine,
  user: Player,
  skill: ActiveSkillDef,
  tileIndex: number | undefined,
): void {
  const damage = skill.params?.damage;
  if (damage === undefined) throw new Error(`火攻技 ${skill.id} 缺伤害参数 damage(数据 bug)`); // 零兜底
  if (tileIndex === undefined) throw new Error("火攻结算缺目标城格(目标段载荷缺失,状态机 bug)"); // 零兜底
  const propId = g.board.at(tileIndex).propertyId;
  if (propId == null) throw new Error(`火攻目标格 ${tileIndex} 无城(候选清单只出城格,状态机 bug)`);
  const victim = g.findOwner(propId);
  if (victim == null)
    throw new Error(`火攻目标城 ${propId} 无主(无主城不受火焰伤害,目标门应已拦,状态机 bug)`);
  const cityName = g.board.at(tileIndex).name;
  const outcome = applyFireDamage(g, victim, propId, damage);
  if (outcome.kind === "lost")
    throw new Error(`火攻结算出 lost(城 ${propId} 应为等级>0):目标门被绕过(状态机 bug)`);
  const h = findHolding(victim, propId);
  if (h == null) throw new Error(`火攻结算后城 ${propId} 不在 ${victim.guohao} 名下(状态机 bug)`); // 零兜底
  const resultTxt =
    outcome.kind === "demolished"
      ? `城防降为 ${h.level} 级`
      : h.defense === 0
        ? "防御值打空,火焰伤害被吸收"
        : `防御值降至 ${h.defense}`;
  g.logEvent(
    "system",
    user.guohao,
    `${user.guohao} 主动技【${skill.name}】:${victim.guohao} 的「${cityName}」${resultTxt}`,
    `heroFire owner=${user.id} skill=${skill.id} victim=${victim.id} prop=${propId} tile=${tileIndex} outcome=${outcome.kind} level=${h.level} defense=${h.defense}`,
  );
}

/** 用牌收尾(#122/T3):重算卡牌段,同回合仍有可用牌(异类标签)→ 停留卷轴;否则进 Roll。 */
export function settleJinnangExit(g: GameEngine): void {
  g.turnPhase = hasUsableJinnang(g) ? "AwaitingJinnang" : "Roll";
}

// ──────────────────────────── 技能书·用书学技(#1146)────────────────────────────
/** 用书学技(#1146,出牌阶段第三类决策——与锦囊/主动技同窗的独立命令口):消耗决策者
 *  珍宝位的一册技能书,令麾下一名「池含此技且未习得」名将习得该书之技。校验单源:
 *  书在手且为技能书(isSkillBook)、目标在可学者集(skillBookLearners 槽位序)——0 名
 *  可学=书不可用(纯交易物)引擎拒绝,UI 据同口禁用;学技落账单源 learnSkillInSlot
 *  (池序入槽、lastFired 不落键)。用后书消耗(珍宝位出册,不回牌堆);skillLearned
 *  事件随批(fold 面:入槽+书出册);战报 category:"skill"(与击发/施展同族)。
 *  学技后窗口收口走 settleJinnangExit(仍有可用项停留,与用牌/出技同口径)。
 *  目标段子状态(pendingJinnang/pendingSkill)在场时=跨子状态误用,警告拒绝。 */
export function resolveBookSkill(g: GameEngine, treasureId: string, heroId: string): void {
  if (!g.assertPhase("AwaitingJinnang", "resolveBookSkill")) return;
  if (g.pendingJinnang || g.pendingSkill) {
    g.warn(`目标段内收到用书命令:${treasureId}`);
    return;
  }
  const p = g.activePlayer;
  const book = p.treasures.find((t) => t.id === treasureId);
  if (book == null || !isSkillBook(book)) {
    g.warn(`${p.guohao} 手中无此技能书:${treasureId}`);
    return;
  }
  const learners = skillBookLearners(p, book.skillId);
  if (learners.length === 0) {
    g.warn(`${p.guohao} 无可学者:麾下无人「池含 ${book.skillId} 且未习得」`);
    return;
  }
  if (!learners.some((slot) => slot.heroId === heroId)) {
    g.warn(`${p.guohao} 用书目标不可学:${heroId}(可学者单源 skillBookLearners)`);
    return;
  }
  p.treasures.splice(
    p.treasures.findIndex((t) => t.id === treasureId),
    1,
  );
  const skill = skillById(book.skillId);
  g.logEvent(
    "skill",
    p.guohao,
    `${p.guohao} 研读「${book.name}」,「${heroById(heroId).name}」习得【${skill.name}】`,
    `skillLearn player=${p.id} hero=${heroId} skill=${book.skillId} treasure=${treasureId}`,
  );
  learnSkillInSlot(p, heroId, book.skillId);
  emitGameEvent(g, g.players.indexOf(p), {
    kind: "skillLearned",
    heroId,
    skillId: book.skillId,
    treasureId,
  }); // 事件流(#1146):用书学技(fold 面:槽入技+书出册)
  settleJinnangExit(g);
}

/** 锦囊效果执行(#122):牌已在手牌段扣账(消耗/弃堆/名额);此处只做结算。
 *  targets:one/two-others=被指定座位;one-city(#1389)=[中心城 tileIndex];all-others=空(自行遍历)。
 *  exempt(#281):识破按份豁免集——横征暴敛 AOE 用=座位集、火烧连营城指向域用=受击城
 *  tileIndex 集(一份=一座城);其余计忽略。
 *  出牌公开事件(浮字/指示线,fx 面按 jinnangAnnounced 事件派生)已在宣布点(settleJinnangPlay)落账。 */
export function executeJinnang(
  g: GameEngine,
  user: Player,
  userSeat: number,
  def: ReturnType<typeof jinnangCardOf>,
  targets: number[],
  exempt?: ReadonlySet<number>,
): void {
  switch (def.effect.kind) {
    case "grantHero":
      g.logEvent(
        "system",
        user.guohao,
        `${user.guohao} 使用锦囊【求贤令】`,
        `jinnangUse player=${user.id} card=${def.id}`,
      );
      grantHeroToPlayer(
        g,
        user,
        def.effect.fallbackCash,
        "锦囊【求贤令】张榜",
        `jinnang=${def.id}`,
      );
      break;
    case "levyAll": {
      // 横征暴敛:全体其他玩家各付 amount(上限=现金,不清算);被识破豁免的份跳过(#281)
      const amount = def.effect.amount;
      let gained = 0;
      let payers = 0;
      let spared = 0;
      for (const t of g.players) {
        const seat = g.players.indexOf(t);
        if (seat === userSeat || t.isBankrupt) continue;
        if (exempt?.has(seat)) {
          spared++;
          continue;
        }
        const pay = Math.min(amount, t.cash);
        t.cash -= pay;
        gained += pay;
        payers++;
        emitGameEvent(g, seat, {
          kind: "cashChanged",
          delta: -pay,
          reason: "levyAll",
          counterpartSeat: userSeat,
        }); // 事件流(#375):金钱变更(被征方)
        g.dispatchMoment("CashLost", { subject: seat, amount: pay });
        g.logEvent(
          "system",
          t.guohao,
          `${t.guohao} 被【横征暴敛】征去 ${formatMoney(pay)}`,
          `jinnangLevy payer=${t.id} amount=${pay} cash=${t.cash}`,
          -pay,
        );
      }
      user.cash += gained;
      if (gained > 0) {
        emitGameEvent(g, userSeat, { kind: "cashChanged", delta: gained, reason: "levyAll" }); // 事件流(#375):金钱变更(征银方)
        g.dispatchMoment("CashGained", { subject: userSeat, amount: gained });
      }
      g.logEvent(
        "system",
        user.guohao,
        `${user.guohao} 使用锦囊【横征暴敛】:${payers} 家缴纳 ${formatMoney(gained)}${spared ? `,${spared} 份被识破免征` : ""}`,
        `jinnangUse player=${user.id} card=${def.id} gained=${gained} payers=${payers} spared=${spared}`,
        gained,
      );
      break;
    }
    case "stealTreasure": {
      const victim = g.players[targets[0]];
      const idx = Math.floor(g.dice.nextFloat() * victim.treasures.length);
      const treasure = victim.treasures.splice(idx, 1)[0];
      g.dispatchMoment("TreasureLost", {
        subject: g.players.indexOf(victim),
        treasureId: treasure.id,
      }); // 时机·TreasureLost:窃玉偷香失窃方(非售出流失,#457,与下得宝时机同点成对)
      user.treasures.push(treasure);
      g.dispatchMoment("TreasureGained", { subject: userSeat, treasureId: treasure.id }); // 时机·TreasureGained:窃玉偷香得宝(#455 A4 补派,subject=窃方)
      emitGameEvent(g, userSeat, {
        kind: "treasureStolen",
        victimSeat: g.players.indexOf(victim),
        treasureId: treasure.id,
        treasureName: treasure.name,
      }); // 事件流(#385):窃宝宣告(名字随事件走,牌堆实例 id 带流水号不属可查表目录)
      g.logEvent(
        "system",
        user.guohao,
        `${user.guohao} 使用锦囊【窃玉偷香】:窃得 ${victim.guohao} 的「${treasure.name}」(Lv.${treasure.level})`,
        `jinnangUse player=${user.id} card=${def.id} victim=${victim.id} treasure=${treasure.id}`,
      );
      break;
    }
    case "fireWall":
      fireWallStrike(g, user, def, targets, exempt);
      break;
    case "skipTurn": {
      const victim = g.players[targets[0]];
      victim.skipTurns += 1;
      g.dispatchMoment("TurnSkipImposed", {
        subject: targets[0],
        reason: "jinnang",
      }); // 时机·TurnSkipImposed:缓兵之计强加跳回合(#456,写点 +=1 语义保留)
      emitGameEvent(g, userSeat, {
        kind: "jinnangInflicted",
        cardId: def.id,
        targetSeat: targets[0],
      }); // 事件流(#385):中招宣告(fx 锚中招者位置出文案;实际跳过另有 turnSkipped)
      g.logEvent(
        "system",
        user.guohao,
        `${user.guohao} 使用锦囊【缓兵之计】:${victim.guohao} 下回合被拖住`,
        `jinnangUse player=${user.id} card=${def.id} victim=${victim.id} skip=1`,
      );
      break;
    }
    case "duel": {
      // 连环计·二虎竞食(#122/T4):指定两人各掷 1d6;赢家国库 +300,输家向使用者付
      // 400(上限=现金,不清算);平局双方无事、此计作废。拼点公共结算(#281 与拦检共用)。
      const [aSeat, bSeat] = targets;
      const a = g.players[aSeat];
      const b = g.players[bSeat];
      const { aRoll, bRoll, winnerSeat } = resolveDuel(g, aSeat, bSeat);
      const { winnerBankGain, loserPaysUser } = def.effect; // case 已收窄为 duel 变体
      g.logEvent(
        "system",
        user.guohao,
        `${user.guohao} 使用锦囊【连环计】:${a.guohao} 掷 ${aRoll} 点,${b.guohao} 掷 ${bRoll} 点`,
        `jinnangUse player=${user.id} card=${def.id} duel a=${aSeat}:${aRoll} b=${bSeat}:${bRoll}`,
      );
      if (winnerSeat == null) {
        // 平局宣告=拼点签面(duelResolved 事件,无胜者即平局作废,ADR-0030 签面即信息)
        g.logEvent(
          "system",
          null,
          `二虎相持(各 ${aRoll} 点),连环计作废`,
          `jinnangDuel tie roll=${aRoll}`,
        );
        break;
      }
      const loserSeat = winnerSeat === aSeat ? bSeat : aSeat;
      const winner = g.players[winnerSeat];
      const loser = g.players[loserSeat];
      winner.cash += winnerBankGain; // 国库出
      emitGameEvent(g, winnerSeat, { kind: "cashChanged", delta: winnerBankGain, reason: "duel" }); // 事件流(#375):金钱变更(胜者国库款)
      g.dispatchMoment("CashGained", {
        subject: winnerSeat,
        amount: winnerBankGain,
      }); // 时机·CashGained:被动得银(连环计胜者国库款,#299 派发缺口补齐)
      g.logEvent(
        "system",
        winner.guohao,
        `二虎相争:胜者 ${winner.guohao} 得 ${formatMoney(winnerBankGain)}(掷 ${Math.max(aRoll, bRoll)} 点)`,
        `jinnangDuel winner=${winner.id} gain=${winnerBankGain}`,
        winnerBankGain,
      );
      const pay = Math.min(loserPaysUser, loser.cash);
      if (pay > 0) {
        loser.cash -= pay;
        user.cash += pay;
        emitGameEvent(g, loserSeat, {
          kind: "cashChanged",
          delta: -pay,
          reason: "duel",
          counterpartSeat: userSeat,
        }); // 事件流(#375):金钱变更(败者赔付)
        g.dispatchMoment("CashLost", { subject: loserSeat, amount: pay });
        emitGameEvent(g, userSeat, {
          kind: "cashChanged",
          delta: pay,
          reason: "duel",
          counterpartSeat: loserSeat,
        }); // 事件流(#375):金钱变更(使用者收款)
        g.dispatchMoment("CashGained", { subject: userSeat, amount: pay });
      }
      g.logEvent(
        "system",
        loser.guohao,
        `二虎相争:败者 ${loser.guohao} 向 ${user.guohao} 赔 ${formatMoney(pay)}(掷 ${Math.min(aRoll, bRoll)} 点)`,
        `jinnangDuel loser=${loser.id} pay=${pay} cash=${loser.cash}`,
        -pay,
      );
      break;
    }
    case "peek": {
      // 军情密探(#575 即时一次性):真生效处产出 peekApplied——窥方/被窥者+手牌内容
      // 随事件走(viewer 凭事件看一次,redact 逐座位裁,ADR-0016);被识破到不了这里。
      // 唯一目标契约(#575 自折叠侧迁入产出侧):announce 的 targetSeats 已由目标段
      // 校验,此处不唯一 = 状态机 bug,当场炸出。
      if (targets.length !== 1) throw new Error("军情密探:宣布无唯一目标(状态机 bug)");
      const target = targets[0]!;
      emitGameEvent(g, userSeat, {
        kind: "peekApplied",
        viewerSeat: userSeat,
        targetSeat: target,
        cardId: def.id, // #1067:题名按目录回查,载荷带牌 id(UI 不硬编码牌名)
        hand: [...g.players[target].jinnangHand],
      });
      g.dispatchMoment("PeekApplied", { subject: userSeat, targetSeat: target }); // 时机·PeekApplied:军情密探窥探生效(#456)
      // 窥探专属文案浮字不另发(#719 死写删除):出牌宣布(通用浮字+指向线)已公开
      // 「谁窥了谁」,窥得内容=peekApplied 弹层仅窥方可见
      g.logEvent(
        "system",
        user.guohao,
        `${user.guohao} 使用锦囊【军情密探】:窥探 ${g.players[target].guohao} 的锦囊`,
        `jinnangUse player=${user.id} card=${def.id} peek viewer=${userSeat} target=${target}`,
      );
      break;
    }
    case "counter":
    case "ambush":
      // 反应牌不经常规锦囊结算(#281):只在反应窗打出(settleJinnangPlay 的唯反应
      // 灰置 + respondReaction 持牌校验双重保证),走到这里 = 状态机 bug
      throw new Error(`反应牌【${def.id}】不应进入常规锦囊结算(#281 状态机 bug)`);
    default: {
      // 穷尽守卫:新 effect.kind 必须先实现结算案,目录才可投放(编译期逼出)
      const exhausted: never = def.effect;
      throw new Error(`锦囊效果未接入结算:${JSON.stringify(exhausted)}(#122)`);
    }
  }
}

/** 火烧连营溅射结算(#1389,规格 #1386):以中心城格为火源,对「中心 + 前方距离 1、2 格
 *  上的城」(受击清单单源 choices.fireWallSplashCities)各造成技表 damage 点火焰伤害,
 *  逐城结算单点=defense.applyFireDamage(T1 交付,本域只消费不复制)。
 *  目标域门(任一座城可为火源,无距离限制;无主城=几何中心而自身免伤)单源目标段候选集
 *  (choices.fireWallCenterTargets 装配 + resolveJinnang 提交复验),本函数只结算。
 *  无主城不调单点(「无主城不受火焰伤害」由清单 ownerSeat=null 表达,中心无主时溅射锚
 *  照成立、前两格照溅);识破免单城(exempt=受击城 tileIndex 集)整城跳过——含溅射账,
 *  免城宣告归识破窗(jinnangVoided),此处不留痕。
 *  果分战报逐城一行(来源段「使用锦囊【火烧连营】」):demolished=城防降为 N 级 /
 *  lost=失「城名」回无主 / absorbed=防御值降至 N(0 级都城打空=打空吸收)——lost 与
 *  打空 absorbed 两果经火烧连营门可达(0 级非都城可烧毁、都城可降打空即停),与火攻
 *  技路(fireBlastOnCity,lost 不可达)不同。
 *  #457 口径延续:城损时机(PropertyDemolished/Lost)按果择一逐城派,absorbed 不派;
 *  降级/失城留痕(propertyChanges)由单点内照 ADR-0015 写。 */
function fireWallStrike(
  g: GameEngine,
  user: Player,
  def: ReturnType<typeof jinnangCardOf>,
  targets: number[],
  exempt?: ReadonlySet<number>,
): void {
  if (def.effect.kind !== "fireWall")
    throw new Error(`fireWallStrike:锦囊【${def.id}】非 fireWall 效果(分派 bug)`); // 零兜底
  const center = requireCenter(def, targets);
  const centerTile = g.board.at(center);
  if (centerTile.propertyId == null)
    throw new Error(`火烧连营火源格 ${center} 无城(候选清单只出城格,状态机 bug)`); // 零兜底
  const exemptCities = exempt ?? new Set<number>();
  const splash = fireWallSplashCities(g, center);
  for (const city of splash) {
    if (city.ownerSeat == null) {
      // 无主城不受火焰伤害(#1386):不调单点;溅射锚/占位照记一行(战报逐城一行)
      g.logEvent(
        "system",
        user.guohao,
        `${user.guohao} 使用锦囊【火烧连营】:「${city.name}」无主,免于火焰`,
        `jinnangFireWall card=${def.id} center=${center} tile=${city.tileIndex} prop=${city.propertyId} victim=- outcome=unowned`,
      );
      continue;
    }
    if (exemptCities.has(city.tileIndex)) continue; // 识破免单城(#1389):完全不受此次伤害
    const victim = g.players[city.ownerSeat];
    const outcome = applyFireDamage(g, victim, city.propertyId, def.effect.damage);
    const holding = outcome.kind === "lost" ? null : findHolding(victim, city.propertyId);
    if (outcome.kind !== "lost" && holding == null)
      throw new Error(`火烧连营结算后城 ${city.propertyId} 不在 ${victim.guohao} 名下(状态机 bug)`); // 零兜底
    const resultTxt =
      outcome.kind === "demolished"
        ? `${victim.guohao} 的「${city.name}」城防降为 ${holding!.level} 级`
        : outcome.kind === "lost"
          ? `${victim.guohao} 失「${city.name}」,城回无主`
          : holding!.defense === 0
            ? `${victim.guohao} 的「${city.name}」城防打空,火焰伤害被吸收`
            : `${victim.guohao} 的「${city.name}」防御值降至 ${holding!.defense}`;
    g.logEvent(
      "system",
      user.guohao,
      `${user.guohao} 使用锦囊【火烧连营】:${resultTxt}`,
      `jinnangFireWall card=${def.id} center=${center} tile=${city.tileIndex} prop=${city.propertyId} victim=${victim.id} outcome=${outcome.kind} level=${holding?.level ?? 0} defense=${holding?.defense ?? 0}`,
    );
    if (outcome.kind !== "absorbed") {
      // 时机·PropertyDemolished/Lost:火烧连营城损按果择一逐城派(#457 拍定挂调用侧——
      // 单点内不派,火攻主动技路不派;absorbed=纯扣防/打空吸收,不派)
      g.dispatchMoment(outcome.kind === "demolished" ? "PropertyDemolished" : "PropertyLost", {
        subject: city.ownerSeat,
        propertyId: city.propertyId,
        tileIndex: city.tileIndex,
      });
    }
  }
}

/** 招贤入队共享(#122/T2 自机遇 grantHero 抽取):名将已尽折现;位满改印书(#1146 单喉);
 *  否则骰选一名入麾下。prefix=战报前缀(机遇「id」/锦囊【名】两路同文风)。 */
function grantHeroToPlayer(
  g: GameEngine,
  p: Player,
  fallbackCash: number,
  prefix: string,
  auditTag: string,
): void {
  const seat = g.players.indexOf(p);
  const candidates = HEROES.filter((h) => !g.recruitedHeroIds.has(h.id));
  if (candidates.length === 0) {
    p.cash += fallbackCash;
    emitGameEvent(g, seat, { kind: "cashChanged", delta: fallbackCash, reason: "fallback" }); // 事件流(#375):招贤折现(浮字由 fx 面派生)
    g.dispatchMoment("CashGained", { subject: seat, amount: fallbackCash }); // 时机·CashGained:被动得银(招贤折现,#299 派发缺口补齐)
    g.logEvent(
      "system",
      p.guohao,
      `${p.guohao} ${prefix},名将已尽,转得 ${fallbackCash} 两`,
      `heroGrant ${auditTag} player=${p.id} fallback=${fallbackCash} cash=${p.cash}`,
      fallbackCash,
    );
    return;
  }
  const hero = candidates[Math.floor(g.dice.nextFloat() * candidates.length)];
  // 盲盒路(#787):无候选呈现,将身份落定一刻同掷授技(rollGrantedSkills 单源公式,
  // 掷骰只走 g.dice.nextFloat);战报=已授技口径(不再拼接全池被动 desc)。
  // 位满(#1146):预掷结果改印书——该次预掷照掷(零新随机),战报归单喉逐册自带。
  const granted = rollGrantedSkills(hero.skillPool, g.dice.nextFloat);
  if (p.heroes.length < HERO_CAPACITY) {
    g.logEvent(
      "system",
      p.guohao,
      `${p.guohao} ${prefix},得「${hero.name}」,授${grantedNamesLine(granted)}`,
      `heroGrant ${auditTag} player=${p.id} hero=${hero.id} skills=${granted.join("|")}`,
    );
  }
  grantHeroOrBooks(g, p, hero, granted, `${prefix},`); // 位满分叉单喉(#1146)
}
