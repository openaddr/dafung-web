// 锦囊+主动技+效果执行域(#122/#188 档 3,ADR-0019 委托式拆分 #319):军师幕
// (AwaitingJinnang)抽牌/用牌决策、出牌宣布与反应窗挂点、锦囊效果执行、名将主动技
// 结算,以及 demolish/招贤两个共享结算单点。域逻辑=自由函数,首参接 GameEngine 直接
// 读写引擎状态;与数据表 jinnang.ts/heroes.ts 分层(执行≠数据)。GameEngine 侧保留同名
// 公共方法薄委托(authority.ts);反应窗域(reaction-window.ts)续结算经 g.executeJinnang/
// g.settleJinnangExit 壳上委托回调,本域开窗/留痕/拼点则直调 reaction-window 自由函数。
import type { GameEngine } from "./authority";
import { activeSkillOf, computeChoices, hasUsableJinnang } from "./choices";
import { jinnangCardOf } from "./jinnang";
import { formatMoney } from "./money";
import { HERO_CAPACITY } from "./constants";
import { HEROES } from "./heroes";
import { openReactionWindow, resolveDuel, traceJinnangPlay } from "./reaction-window";
import type { ActiveSkillDef, Player, ReactionPayload, ReactionViewSeed } from "./types";

/** 抽锦囊(#122/T1):从牌库堆顶抽 count 张入手。手牌无上限(#250),抽牌恒成功;
 *  牌库空→浮字「锦囊已空」落空(每次调用至多提示一次)。
 *  日志只记「抽了一张锦囊」不记牌名——暗牌内容不过对局日志(ADR-0016,日志随快照全网可见)。 */
export function drawJinnang(g: GameEngine, seat: number, count = 1): void {
  const p = g.players[seat];
  if (!p || p.isBankrupt) return;
  let emptyNotified = false;
  for (let k = 0; k < count; k++) {
    if (g.jinnangDeck.length === 0) {
      if (!emptyNotified) {
        g.floaters.push({ playerIndex: seat, amount: 0, kind: "msg", text: "锦囊已空" });
        emptyNotified = true;
      }
      continue;
    }
    const id = g.jinnangDeck.pop()!;
    g.jinnangDeckCount = g.jinnangDeck.length;
    p.jinnangHand.push(id);
    p.jinnangHandCount = p.jinnangHand.length;
    g.logEvent(
      "system",
      p.guohao,
      `${p.guohao} 抽了一张锦囊(手牌 ${p.jinnangHand.length})`,
      `jinnangDraw player=${p.id} handSize=${p.jinnangHand.length}`,
    );
  }
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
 *  用牌是公开事件(浮字+战报),暗的只有持有(ADR-0016)。
 *  #188 档 3:军师幕内与技能目标段(pendingSkill)共存——cardId=null 时若停在技能目标段,
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
    if (
      !computeChoices(g, "AwaitingJinnang").some((o) => o.id === `t${target}` && o.available)
    ) {
      g.warn(`目标不可用:座位 ${target}`);
      return;
    }
    if (pending.stage === "one") {
      g.pendingJinnang = null;
      settleJinnangPlay(g, p, userSeat, def, [target]);
      return;
    }
    // 连环计两步(T4):two-a 存首挑进 two-b;two-b 合并执行
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
  // 指向域 → 入目标段(牌暂不消耗;作罢可全退)
  const domain = def.targetDomain;
  if (domain === "one" || domain === "two-others" || domain === "all-others") {
    if (domain !== "all-others") {
      g.pendingJinnang = { cardId, stage: domain === "one" ? "one" : "two-a", picked: [] };
      return; // 留在相位,选项集重算为候选名单
    }
    // 全体域(横征暴敛):无目标段,直接宣布执行
    settleJinnangPlay(g, p, userSeat, def, []);
    return;
  }
  // 自身域:立即宣布执行
  settleJinnangPlay(g, p, userSeat, def, []);
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

/** 锦囊宣布与反应窗挂点(#281):出牌扣账 → 公开事件(浮字+出牌指示线留痕)→
 *  JinnangAnnounced 时机 → 持识破诡计者(使用者除外)询问窗;无有效识破则照常执行。
 *  主动技不经此口(fireHeroSkill 直结算,#229 口径:主动技不可被识破);反应牌自身永经
 *  军师幕「唯反应」灰置,不经 announce 通道(识破不可被识破的另一半保证)。 */
function settleJinnangPlay(
  g: GameEngine,
  user: Player,
  userSeat: number,
  def: ReturnType<typeof jinnangCardOf>,
  targets: number[],
): void {
  consumeJinnangCard(g, user, def.id, def); // 出牌即扣账:被识破也不回手(识破只护份)
  // 份清单(view.targetSeats):self=使用者自身一份;全体域=受影响全员;指向域=被指定者
  const shareSeats =
    def.targetDomain === "self"
      ? [userSeat]
      : def.targetDomain === "all-others"
        ? g.alivePlayers()
            .map((p) => g.players.indexOf(p))
            .filter((seat) => seat !== userSeat)
        : [...targets];
  g.pushFloaterText(user, `${user.guohao} 使用锦囊【${def.id}】`, user.position);
  traceJinnangPlay(g, userSeat, shareSeats, def.id);
  g.dispatchMoment("JinnangAnnounced", {
    subject: userSeat,
    cardId: def.id,
    targetSeats: shareSeats,
  }); // 时机·JinnangAnnounced:锦囊宣布、结算前(识破诡计反应窗挂点)
  const queried = g.alivePlayers()
    .map((p) => g.players.indexOf(p))
    .filter(
      (seat) =>
        seat !== userSeat &&
        g.players[seat].jinnangHand.some((id) => jinnangCardOf(id).effect.kind === "counter"),
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
// 军师幕(AwaitingJinnang)内与锦囊同窗决策:resolveHeroSkill 与 resolveJinnang 并列的
// 命令入口。校验(冷却/持有/目标)单源选项集(choices.ts),UI/bot 永不裁决(ADR-0013);
// 结算复用既有路径(火攻=demolishOnVictim),不新造 effect kind;结算内不派发时机
// (防技能链级联,与 grantSkillCash 不派发 CashGained 同口径)。

/** 发动主动技:skillId 须为决策者麾下主动技且选项集可用(冷却/费用/目标门槛);
 *  无目标域发动即结算,other/any 域入目标段(pendingSkill,选项集重算为候选名单);
 *  cancel=作罢(回卡牌段或收卷,不记冷却)。 */
export function resolveHeroSkill(
  g: GameEngine,
  skillId: string,
  targets?: number[],
  cancel?: boolean,
): void {
  if (!g.assertPhase("AwaitingJinnang", "resolveHeroSkill")) return;
  if (g.pendingJinnang) {
    g.warn(`锦囊目标段内收到技能命令:${skillId}`);
    return;
  }
  const p = g.activePlayer;
  const userSeat = g.players.indexOf(p);

  // ── 目标段:提交目标 / 作罢 ──
  const pending = g.pendingSkill;
  if (pending) {
    const skill = activeSkillOf(p, pending.skillId);
    if (!skill) throw new Error(`技能目标段载荷失效:${pending.skillId}(麾下无此技,状态机 bug)`); // 零兜底
    if (cancel) {
      cancelPendingSkill(g);
      return;
    }
    if (skillId !== pending.skillId || !targets || targets.length !== 1) {
      g.warn(`技能目标段命令与载荷不符:${skillId}`);
      return;
    }
    const [target] = targets;
    if (
      !computeChoices(g, "AwaitingJinnang").some((o) => o.id === `t${target}` && o.available)
    ) {
      g.warn(`目标不可用:座位 ${target}`);
      return;
    }
    g.pendingSkill = null;
    fireHeroSkill(g, userSeat, skill, targets);
    settleJinnangExit(g);
    return;
  }

  // ── 卡牌段:发动 ──
  const skill = activeSkillOf(p, skillId);
  if (!skill) {
    g.warn(`${p.guohao} 无此主动技:${skillId}`);
    return;
  }
  const option = computeChoices(g, "AwaitingJinnang").find((o) => o.id === `skill:${skillId}`);
  if (!option?.available) {
    g.warn(`${p.guohao} 主动技【${skill.name}】不可用:${option?.reason ?? "未知原因"}`);
    return;
  }
  if (skill.target !== "none") {
    g.pendingSkill = { skillId };
    return; // 留在相位,选项集重算为候选名单
  }
  fireHeroSkill(g, userSeat, skill, []);
  settleJinnangExit(g);
}

/** 作罢技能目标段(#188 档 3):清载荷回卡牌段或收卷,技未发动不记冷却。 */
function cancelPendingSkill(g: GameEngine): void {
  const p = g.activePlayer;
  const skill = g.pendingSkill ? activeSkillOf(p, g.pendingSkill.skillId) : null;
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

/** 主动技结算:冷却记账(独立冷却,heroLastFired 键=skill.id)+ 公开事件(浮字+战报,
 *  与出牌同口径)+ 效果落账。目标合法性已由目标段选项集校验,此处不再复核。 */
function fireHeroSkill(g: GameEngine, userSeat: number, skill: ActiveSkillDef, targets: number[]): void {
  const user = g.players[userSeat];
  user.heroLastFired[skill.id] = g.round;
  g.pushFloaterText(user, `${user.guohao} 施展【${skill.name}】`, user.position);
  g.logEvent(
    "skill",
    user.guohao,
    `${user.guohao} 施展主动技【${skill.name}】`,
    `heroSkill owner=${user.id} skill=${skill.id} kind=${skill.kind} target=${targets.length > 0 ? g.players[targets[0]].id : "-"}`,
  );
  switch (skill.kind) {
    case "demolish":
      // 火攻 = 火烧连营同款 demolish 结算(#226 守卫:都城可降不可失)
      demolishOnVictim(
        g,
        user,
        g.players[targets[0]],
        `主动技【${skill.name}】`,
        `heroSkill owner=${user.id} skill=${skill.id}`,
      );
      break;
    case "relief": {
      const cost = skill.params?.cost;
      const stamina = skill.params?.stamina;
      if (cost === undefined || stamina === undefined)
        throw new Error(`赈济参数缺失:params=${JSON.stringify(skill.params ?? {})}(数据 bug)`); // 零兜底
      user.cash -= cost; // 可用性已保证 cash ≥ cost
      g.pushFloater(user, -cost, user.position, "expense");
      const seat = targets[0];
      const target = g.players[seat];
      const after = g.addStamina(seat, stamina);
      g.pushFloaterText(target, `${target.guohao} 体力 +${stamina}`, target.position);
      g.logEvent(
        "system",
        user.guohao,
        `${user.guohao} 【${skill.name}】:付 ${formatMoney(cost)},${target.guohao} 体力 +${stamina}(现 ${after})`,
        `heroRelief owner=${user.id} skill=${skill.id} target=${target.id} cost=${cost} stamina=${stamina} staminaNow=${after}`,
        -cost,
      );
      break;
    }
    case "patronage": {
      const cash = skill.params?.cash;
      if (cash === undefined)
        throw new Error(`征辟参数缺失:params=${JSON.stringify(skill.params ?? {})}(数据 bug)`); // 零兜底
      user.warrants += 1;
      const target = g.players[targets[0]];
      g.grantSkillCash(targets[0], cash); // 国库补偿:+现金 +浮字(不派发 CashGained,防连锁)
      g.pushFloaterText(user, `${user.guohao} 征辟就任,委任状 +1`, user.position);
      g.logEvent(
        "system",
        user.guohao,
        `${user.guohao} 【${skill.name}】:委任状 +1,${target.guohao} 获 ${formatMoney(cash)} 补偿`,
        `heroPatronage owner=${user.id} skill=${skill.id} target=${target.id} cash=${cash} warrants=${user.warrants}`,
        cash,
      );
      break;
    }
    case "warDrum": {
      const bonus = skill.params?.bonus;
      if (bonus === undefined)
        throw new Error(`擂鼓参数缺失:params=${JSON.stringify(skill.params ?? {})}(数据 bug)`); // 零兜底
      g.heroDiceBonus = bonus;
      g.pushFloaterText(user, `擂鼓进军,本回合掷骰步数 +${bonus}`, user.position);
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

/** 用牌收尾(#122/T3):重算卡牌段,同回合仍有可用牌(异类标签)→ 停留卷轴;否则进 Roll。 */
export function settleJinnangExit(g: GameEngine): void {
  g.turnPhase = hasUsableJinnang(g) ? "AwaitingJinnang" : "Roll";
}

/** 锦囊效果执行(#122):牌已在手牌段扣账(消耗/弃堆/名额);此处只做结算。
 *  targets:one/two-others=被指定座位;all-others=空(自行遍历)。
 *  exempt(#281):识破按份豁免的座位集(横征暴敛 AOE 用;其余计忽略)。
 *  出牌公开事件(浮字/指示线留痕)已在宣布点(settleJinnangPlay)落账。 */
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
        g.pushFloater(t, -pay, t.position, "expense");
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
        g.pushFloater(user, gained, user.position, "income");
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
      user.treasures.push(treasure);
      g.pushFloaterText(user, `窃得「${victim.guohao}」的「${treasure.name}」`, user.position);
      g.logEvent(
        "system",
        user.guohao,
        `${user.guohao} 使用锦囊【窃玉偷香】:窃得 ${victim.guohao} 的「${treasure.name}」(Lv.${treasure.level})`,
        `jinnangUse player=${user.id} card=${def.id} victim=${victim.id} treasure=${treasure.id}`,
      );
      break;
    }
    case "demolish": {
      const victim = g.players[targets[0]];
      demolishOnVictim(
        g,
        user,
        victim,
        `使用锦囊【${def.id}】`,
        `jinnangUse player=${user.id} card=${def.id}`,
      );
      break;
    }
    case "skipTurn": {
      const victim = g.players[targets[0]];
      victim.skipTurns += 1;
      g.pushFloaterText(victim, `中【缓兵之计】,下回合无法行动`, victim.position);
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
        g.pushFloaterText(user, `二虎相持(各 ${aRoll} 点),此计作废`, user.position);
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
      g.pushFloater(winner, winnerBankGain, winner.position, "income");
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
        g.pushFloater(loser, -pay, loser.position, "expense");
        g.dispatchMoment("CashLost", { subject: loserSeat, amount: pay });
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
      const target = targets[0];
      g.jinnangPeeks.push({ viewer: userSeat, target });
      g.pushFloaterText(
        user,
        `细作已入 ${g.players[target].guohao} 营中(至你下回合)`,
        user.position,
      );
      g.logEvent(
        "system",
        user.guohao,
        `${user.guohao} 使用锦囊【军情密探】:窥探 ${g.players[target].guohao} 的锦囊(至下回合)`,
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

/** demolish 结算单点(#122 火烧连营 与 #188 档 3 周瑜火攻共用):随机降目标一座
 *  Lv>0 城 1 级(都城可降);城防全 0 级则失一座非都城(都城不可失,#226 根因修复:
 *  失城只从非都城中取,与耗竭「都城可降不可失」、破产「都城不可变卖」同口径)。
 *  「仅剩 0 级都城」的目标已被选项集门槛(demolishTargetOk)拦下,空池 = 门槛被绕过,
 *  当场抛出(零兜底:让状态机 bug 在出生地暴露)。
 *  sourceLabel=战报来源段(「使用锦囊【火烧连营】」/「主动技【火攻】」);
 *  auditPrefix=机读 detail 前缀(各自保留原键名)。 */
function demolishOnVictim(
  g: GameEngine,
  user: Player,
  victim: Player,
  sourceLabel: string,
  auditPrefix: string,
): void {
  const upgradable = victim.properties.filter((h) => h.level > 0);
  const tileIndexOf = (pid: string) => g.board.tiles.findIndex((t) => t.propertyId === pid);
  if (upgradable.length > 0) {
    const h = upgradable[Math.floor(g.dice.nextFloat() * upgradable.length)];
    h.level -= 1;
    g.propertyChanges.push({
      tileIndex: tileIndexOf(h.propertyId),
      level: h.level,
      ownerColorIndex: victim.colorIndex,
      levelChanged: true,
      ownerChanged: false,
    }); // 宣告留痕(ADR-0015)
    g.logEvent(
      "system",
      user.guohao,
      `${user.guohao} ${sourceLabel}:${victim.guohao} 的城防降为 ${h.level} 级`,
      `${auditPrefix} victim=${victim.id} prop=${h.propertyId} level=${h.level}`,
    );
  } else {
    const capPropId = g.board.at(victim.capitalIndex)?.propertyId;
    const losable = victim.properties.filter((h) => h.propertyId !== capPropId);
    if (losable.length === 0)
      throw new Error("demolish:目标无可失之城(目标门槛应已拦截,状态机 bug)");
    const h = losable[Math.floor(g.dice.nextFloat() * losable.length)];
    victim.properties.splice(victim.properties.indexOf(h), 1);
    g.propertyChanges.push({
      tileIndex: tileIndexOf(h.propertyId),
      level: 0,
      ownerColorIndex: null,
      levelChanged: false,
      ownerChanged: true,
    }); // 失城=回无主(ADR-0015)
    const lostName = g.board.tiles.find((t) => t.propertyId === h.propertyId)!.name; // 地图一致性由 map-economy 守卫
    g.logEvent(
      "system",
      user.guohao,
      `${user.guohao} ${sourceLabel}:${victim.guohao} 城防尽毁,失「${lostName}」`,
      `${auditPrefix} victim=${victim.id} lost=${h.propertyId}`,
    );
  }
}

/** 招贤入队共享(#122/T2 自机遇 grantHero 抽取):满编/名将已尽折现,否则骰选一名。
 *  prefix=战报前缀(机遇「id」/锦囊【名】两路同文风)。 */
function grantHeroToPlayer(
  g: GameEngine,
  p: Player,
  fallbackCash: number,
  prefix: string,
  auditTag: string,
): void {
  const seat = g.players.indexOf(p);
  const candidates = HEROES.filter((h) => !g.recruitedHeroIds.has(h.id));
  if (p.heroes.length >= HERO_CAPACITY || candidates.length === 0) {
    p.cash += fallbackCash;
    g.pushFloater(p, fallbackCash, p.position, "income");
    g.dispatchMoment("CashGained", { subject: seat, amount: fallbackCash }); // 时机·CashGained:被动得银(招贤折现,#299 派发缺口补齐)
    g.logEvent(
      "system",
      p.guohao,
      `${p.guohao} ${prefix},麾下已满/名将已尽,转得 ${fallbackCash} 两`,
      `heroGrant ${auditTag} player=${p.id} fallback=${fallbackCash} cash=${p.cash}`,
      fallbackCash,
    );
    return;
  }
  const hero = candidates[Math.floor(g.dice.nextFloat() * candidates.length)];
  p.heroes.push(hero);
  g.recruitedHeroIds.add(hero.id);
  g.pushFloaterText(p, `${prefix},${hero.name} 来投`, p.position);
  g.logEvent(
    "system",
    p.guohao,
    `${p.guohao} ${prefix},得「${hero.name}」:${hero.desc}`,
    `heroGrant ${auditTag} player=${p.id} hero=${hero.id}`,
  );
  g.dispatchMoment("HeroRecruited", { subject: seat, heroId: hero.id });
}
