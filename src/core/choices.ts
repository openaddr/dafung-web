// 决策相位选项集(choice-set)集中注册表(ADR-0013):
// 每个决策相位一个计算器,选项带 available/reason——引擎在进入决策相位前先计算选项集,
// 除默认行为外可用选项为 0 时直接自动执行默认行为(战报+浮字),不弹卷轴;
// UI/bot/联机只消费结果(snapshot.choices 透出),禁止在 UI 层私自增删选项。
// 扩展口:未来技能(低价买城)经时机框架在选项计算前修改玩家状态,
// 此处计算结果随之变化——与 timing 框架同构,无需改引擎流程。
import type { GameEngine, TurnPhase } from "./authority";
import { canUpgrade } from "./economy";
import { tileIndexOfProperty } from "./board";
import type { ActiveSkillDef, TriggerSkill } from "./skills";
import { isActiveSkill, isTriggerSkill, skillById } from "./skills";
import { findHolding } from "./player";
import { HERO_CAPACITY } from "./constants";
import { heroById } from "./heroes";
import { HEROES } from "./heroes";
import { heroSlotOf, resetSkillMarks, skillBookLearners, type HeroSlot } from "./roster";
import { isSkillBook } from "./treasures";
import type { EncounterChoiceOption, EncounterTier } from "./encounters";
import { jinnangCardOf, isReactionCard, TARGET_DOMAIN_STAGES, type JinnangEffect } from "./jinnang";

/** 已接入结算的锦囊效果种类(#122/T2 起逐票点亮;#281 反应牌 counter/ambush 经反应窗结算,
 *  同属已接入)。新增 effect.kind 而未接结算案时:灰置路径仍在(此计暂未启用)。 */
export const JINNANG_LIVE_EFFECTS: ReadonlySet<JinnangEffect["kind"]> = new Set([
  "counter",
  "ambush",
  "grantHero",
  "levyAll", // T3:指向他人四牌
  "stealTreasure",
  "fireWall", // #1389 T3 棒1:火烧连营溅射化(城指向/前方溅射/识破按城拆份)
  "skipTurn",
  "duel", // T4:连环计二虎竞食
  "peek", // T4:军情密探
]);

/** 单个选项:available=false 时 reason 说明不可用原因(「银两不足」「已满级」)。 */
export interface ChoiceOption {
  id: string; // 如 "buy" / "upgrade" / "skip" / "fair" / "premium" / "decline"
  label: string; // 玩家可读
  available: boolean;
  reason?: string; // 不可用原因
  /** 抉择机遇选项专属(#124):机遇 id/文段随选项经 snapshot.choices 派生透出——机遇上下文
   *  过网的唯一通道(UI 卷轴渲染文段、restoreFromSnapshot 按 id 回链目录);其余相位不携带。 */
  encounterId?: string;
  encounterText?: string;
  /** 抉择机遇选项专属(#847):机遇档位随选项出快照(单通道透出 def.tier,纯表现数据,
   *  引擎裁决零改动)——UI 三档视觉分档(机遇卷轴题印/题名侧饰条色)唯一数据源;
   *  消费方查无此章 = 注册表盖章缺失,当场炸出不静默回退。其余相位不携带。 */
  encounterTier?: EncounterTier;
  /** 出牌阶段专属(#122/T2):牌名/标签/牌面文案随选项派生透出(同 encounterId 通道口径);
   *  id 即 cardId(pass=今不用)。 */
  cardText?: string;
  cardTags?: string[];
  /** 目标段选项(#122/T3):候选座位(id=`t${seat}`,label=国号)。 */
  targetSeat?: number;
  /** 名将主动技选项专属(#188 档 3;#817 选项携实例):id=`skill:<heroId>:<skillId>`
   *  (拼接单源 skillOptionId);出牌阶段文案随选项派生透出(同 encounterId 通道口径);
   *  skillId+skillHeroId=麾下实例定位对(判定单源 isSkillOption),skillHero=名将名
   *  (卷轴组合显示)。 */
  skillId?: string;
  skillHeroId?: string;
  skillText?: string;
  skillHero?: string;
  /** 城目标段选项专属(#1388 T2):候选城四件随选项派生透出(快照 choices 通道,棒2 UI
   *  消费)。id=`c${targetTileIndex}`(拼接单源 cityTargetOptionId,label=城名);
   *  targetTileIndex=提交通道(命令 targets=[tileIndex],与席位域 targetSeat 同款对称);
   *  targetPropertyId/targetOwnerSeat/targetDistance=候选清单结构化载荷(城 id/城主座位/
   *  双向最短距离,呈现数据,合法性不由此判定)。席位域选项不携带本组字段。 */
  targetPropertyId?: string;
  targetOwnerSeat?: number;
  targetDistance?: number;
  targetTileIndex?: number;
}

/** AwaitingDecision(购地/扩军,按 pendingLand 分流;spec #107 C2 决策载荷分离)。
 *  skip = 默认行为(不取/按兵不动),永远可用。 */
function decisionChoices(e: GameEngine): ChoiceOption[] {
  const pending = e.pendingLand;
  const p = e.activePlayer;
  if (pending?.kind === "PropertyAvailable") {
    const def = e.pendingLandDef();
    const affordable = p.cash >= def.purchasePrice;
    return [
      {
        id: "buy",
        label: `购地`,
        available: affordable,
        reason: !affordable ? "银两不足" : undefined,
      },
      { id: "skip", label: "不取", available: true },
    ];
  }
  if (pending?.kind === "OwnProperty") {
    const def = e.pendingLandDef();
    const holding = findHolding(p, def.id);
    return [
      {
        id: "upgrade",
        label: "扩军(免费)",
        available: holding != null && canUpgrade(holding),
        reason: "已满级",
      },
      { id: "skip", label: "按兵不动", available: true },
    ];
  }
  // 非决策性 pendingLand(理论上到不了):仅剩默认行为
  return [{ id: "skip", label: "按兵不动", available: true }];
}

/** AwaitingTreasureOwner(城主三选,天然 ≥2,永不自动执行;registry 供 bot/未来技能消费)。 */
function treasureOwnerChoices(): ChoiceOption[] {
  return [
    { id: "fair", label: "公道买卖", available: true },
    { id: "premium", label: "坐地起价", available: true },
    { id: "decline", label: "不交易", available: true },
  ];
}

/** AwaitingHeroPick(候选三选一,永不自动执行)。 */
function heroPickChoices(e: GameEngine): ChoiceOption[] {
  return e.offeredHeroes.map((h) => ({
    id: `hero:${h.def.id}`,
    label: h.def.name,
    available: true,
  }));
}

/** 抉择选项现金代价推导(#1153 自动现金闸,kind 推导非逐条数据):负 cash 效果的支出额
 *  与 levy 输币额(输币=定向资敌,疫病入营式「隐忍输币」同受闸),加选项级 cashCost
 *  (#1154 太平要术式「付费+得物分离」代价,语义与负 cash 同款);其余效果不计现金
 *  (grantHero 的珍宝代价 treasureCost 另走珍宝闸)。 */
function optionCashCost(c: EncounterChoiceOption): number {
  let cost = 0;
  if (c.effect != null) {
    if (c.effect.kind === "cash") cost = c.effect.delta < 0 ? -c.effect.delta : 0;
    else if (c.effect.kind === "levy") cost = c.effect.amount;
  }
  return cost + (c.cashCost ?? 0);
}

/** 抉择选项可用门槛(#124 基线,#1153 泛化):可用性全部由条目声明与效果 kind 自动推导,
 *  注册表是唯一口径(零兜底):
 *  ① option 级 requiresFlags(#1153 P2 章闸):未持满所要求的机遇章 → 不可用,reason 写
 *     持章要求;
 *  ② grantHero 三连检留 kind 推导(#1067 代价随条目声明,直读不兜底)+ 指定将扩展:
 *     珍宝 < treasureCost「珍宝不足」/ 麾下满「麾下已满」/ 名将池尽「名将已尽」/
 *     指定将已被招揽「指定名将已被招揽」——任一不满足则换贤必落空(结算折现
 *     fallbackCash,白损珍宝),选项必须拦下并报原因;
 *  ③ 现金代价自动闸(#1153 新红线「机遇不送清算」):现金 < 现金代价(负 cash 效果、
 *     levy 输币额或选项级 cashCost,#1154)→ 不可用「银两不足」,全目录追溯,引擎规则
 *     非逐条数据;cashBlocked=结构化「仅被现金闸拦」标记(保底放行的判据,#1169 评审
 *     收口:不拿展示文案 reason 做控制流,文案改字不致保底静默失效)。
 *  保底放行(拍板项)在 encounterChoices 门槛过滤后兜;目录约定每条抉择机遇都自带一个
 *  无门槛的「不作」型选项,保证 ≤1 可用时自动执行永不死锁(章闸条目由 encounters.ts
 *  模块初始化守卫 assertChoicesNotFlagLocked 强制)。 */
function encounterOptionGate(
  e: GameEngine,
  c: EncounterChoiceOption,
): { available: boolean; reason?: string; cashBlocked?: boolean } {
  const p = e.activePlayer;
  if (c.requiresFlags != null && !c.requiresFlags.every((f) => p.encounterFlags.includes(f)))
    return { available: false, reason: `需持机遇章〔${c.requiresFlags.join("〕〔")}〕` };
  if (c.effect?.kind === "grantHero") {
    if (p.treasures.length < c.treasureCost!) return { available: false, reason: "珍宝不足" };
    if (p.heroes.length >= HERO_CAPACITY) return { available: false, reason: "麾下已满" };
    if (!HEROES.some((h) => !e.recruitedHeroIds.has(h.id)))
      return { available: false, reason: "名将已尽" };
    if (c.effect.heroId != null && e.recruitedHeroIds.has(c.effect.heroId))
      return { available: false, reason: "指定名将已被招揽" };
  }
  if (p.cash < optionCashCost(c))
    return { available: false, reason: "银两不足", cashBlocked: true };
  return { available: true };
}

/** AwaitingEncounter(抉择机遇,#124):目录选项逐一映射,顺序与 def.choices 一致
 *  (resolveEncounterChoice 的 index 即此下标)。encounterId/encounterText/encounterTier
 *  随选项出快照(#847:tier 单通道透出,机遇卷轴按档分色的唯一数据源)。
 *  保底放行(#1153 拍板项):门槛过滤后若无任何可用选项,而存在仅被现金闸拦下的选项
 *  (gate.cashBlocked=章闸/换贤闸均已通过的结构化判据)→ 放行现金代价最低者——卷轴
 *  永不全灰;放行后的实付由负现金封顶兜底(最多付光现金,不送清算)。 */
function encounterChoices(e: GameEngine): ChoiceOption[] {
  const def = e.pendingEncounter;
  if (!def?.choices) return [];
  const gated = def.choices.map((c, i) => ({ index: i, c, gate: encounterOptionGate(e, c) }));
  if (!gated.some((m) => m.gate.available)) {
    const cashBlocked = gated.filter((m) => m.gate.cashBlocked === true);
    if (cashBlocked.length > 0) {
      const cheapest = cashBlocked.reduce((a, b) =>
        optionCashCost(b.c) < optionCashCost(a.c) ? b : a,
      );
      cheapest.gate = { available: true };
    }
  }
  return gated.map(({ index, c, gate }) => ({
    id: `choice:${index}`,
    label: c.text,
    available: gate.available,
    reason: gate.reason,
    encounterId: def.id,
    encounterText: def.text,
    encounterTier: def.tier,
  }));
}

/** AwaitingExhaustion 已随耗竭全自动结算退役(外敌乘虚+休整,无抉择):归 0 不再进
 *  任何相位,处置与休整一律引擎内完成(encounter-flow.ts exhaustIfDepleted)。 */

/** AwaitingBankruptcySettle(各资产变卖 + 认赔)。ADR-0013 明确例外:重大不可逆事件,
 *  即使唯一选项(无可卖资产只能认赔)也不自动执行——见 EXCLUDED_FROM_AUTO。 */
function bankruptcyChoices(e: GameEngine): ChoiceOption[] {
  const p = e.activePlayer;
  // 凑足即止硬守卫(assertStillOwing 的注册表镜像):现金已达自救线后变卖全部不可用
  const stillOwing = e.pendingDebt != null && p.cash < e.pendingDebt.amount;
  const capProp = e.board.at(p.capitalIndex)?.propertyId;
  const tileNameOf = (propId: string): string =>
    e.board.at(tileIndexOfProperty(e.board, propId)).name;
  return [
    ...p.treasures.map<ChoiceOption>((t) => ({
      id: `sell-treasure:${t.id}`,
      label: `变卖「${t.name}」`,
      available: stillOwing,
      reason: "已凑足债务",
    })),
    ...p.properties
      .filter((h) => h.propertyId !== capProp)
      .map<ChoiceOption>((h) => ({
        id: `sell-property:${h.propertyId}`,
        label: `变卖「${tileNameOf(h.propertyId)}」`,
        available: stillOwing,
        reason: "已凑足债务",
      })),
    ...p.heroes.map<ChoiceOption>((slot) => ({
      id: `cash-hero:${slot.heroId}`,
      label: `遣散「${heroById(slot.heroId).name}」`,
      available: stillOwing,
      reason: "已凑足债务",
    })),
    { id: "settle", label: "认赔清偿", available: true },
  ];
}

/** 目标有效性(#122/T3):非己、存活(#281:免战庇护已随免战金牌退役,目标排除逻辑删除);
 *  卡面附加条件由 effectKind 分派。反应域牌不经目标段,永不走此校验。 */
export function jinnangTargetOk(
  e: GameEngine,
  user: number,
  target: number,
  effectKind: JinnangEffect["kind"],
): { ok: boolean; reason?: string } {
  const t = e.players[target];
  if (target === user) return { ok: false, reason: "不能指定自己" };
  if (t.isBankrupt) return { ok: false, reason: "已出局" };
  switch (effectKind) {
    case "stealTreasure":
      if (t.treasures.length === 0) return { ok: false, reason: "无珍宝" };
      break;
    case "fireWall":
      // 城指向域(#1389):不走席位校验(合法性单源 fireWallCenterTargets 候选集,
      // 提交复验按 cityTargetOptionId 对选项集),误入本口=调用方目标域分派 bug
      throw new Error(
        `jinnangTargetOk:火烧连营为城指向域,不走席位校验(候选单源 fireWallCenterTargets,#1389)`,
      );
  }
  return { ok: true };
}

/** 主动技目标有效性(#188 档 3;席位域专用):目标域按技能定义分派。
 *  注:主动技不受反应窗/锦囊任何庇护(#229/#281 口径:技能不走 announce 通道,不可被识破),
 *  故此处无锦囊类守卫。城目标域(#1388 T2)不走席位校验——合法性单源
 *  heroSkillCityTargets,误入本口=调用方目标域分派 bug,当场炸(零兜底)。 */
export function heroSkillTargetOk(
  e: GameEngine,
  user: number,
  target: number,
  skill: ActiveSkillDef,
): { ok: boolean; reason?: string } {
  if (skill.target === "city")
    throw new Error(
      `heroSkillTargetOk:技 ${skill.id} 为城目标域,不走席位校验(合法性单源 heroSkillCityTargets,#1388)`,
    );
  const t = e.players[target];
  if (t.isBankrupt) return { ok: false, reason: "已出局" };
  if (target === user && skill.target !== "any") return { ok: false, reason: "不能指定自己" };
  return { ok: true };
}

/** 城目标段选项 id 拼接单源(#1388 T2):`c${tileIndex}`——候选选项 id、resolveHeroSkill
 *  目标段复验、UI 提交(targetTileIndex)三处同一形状,唯此一处拼(与 skillOptionId 同纪律)。 */
export function cityTargetOptionId(tileIndex: number): string {
  return `c${tileIndex}`;
}

/** 火攻合法城清单(#1388 T2 城目标域,目标域谓词全局唯一单源):userSeat 视角下全部
 *  「距离 ≤ 技表 params.range(双向最短,board.distance,#1386)且城池等级>0 且城主为他人」
 *  的城。都城在域内合法(可降级,打空即停由 defense 单点管);无主城/己城/0 级城/射程外
 *  一律不入选。choices 选项装配、目标段候选、bot 策略全回查本口,UI/bot 不复制谓词
 *  (ADR-0013)。确定性:座位序×持有序遍历,排序归消费方(bot 自带打分)。 */
export interface HeroSkillCityTarget {
  propertyId: string;
  tileIndex: number;
  name: string; // 城名(候选钮 label)
  level: number; // 城池等级(候选呈现 + bot 打分第一序)
  ownerSeat: number; // 城主座位
  distance: number; // 攻方所在格→城格的双向最短距离(#1386 距离谓词)
}

export function heroSkillCityTargets(
  e: GameEngine,
  userSeat: number,
  skill: ActiveSkillDef,
): HeroSkillCityTarget[] {
  if (skill.target !== "city")
    throw new Error(`heroSkillCityTargets:技 ${skill.id} 非城目标域(调用方分派 bug)`);
  const range = skill.params?.range;
  if (range === undefined) throw new Error(`火攻技 ${skill.id} 缺射程参数 range(数据 bug)`); // 零兜底
  const me = e.players[userSeat];
  const out: HeroSkillCityTarget[] = [];
  for (const owner of e.players) {
    const seat = e.players.indexOf(owner);
    if (seat === userSeat || owner.isBankrupt) continue;
    for (const h of owner.properties) {
      if (h.level <= 0) continue; // 等级门:0 级城不可指定(打空即失的门不在此开)
      const tileIndex = tileIndexOfProperty(e.board, h.propertyId);
      const distance = e.board.distance(me.position, tileIndex);
      if (distance > range) continue; // 射程门
      out.push({
        propertyId: h.propertyId,
        tileIndex,
        name: e.board.at(tileIndex).name,
        level: h.level,
        ownerSeat: seat,
        distance,
      });
    }
  }
  return out;
}

// ─────────── 火烧连营城指向域(#1389,谓词全局唯一单源,形制对齐 heroSkillCityTargets)───────────

/** 火烧连营火源候选(#1389 城目标域):全部城池格(全城池制 #826 下棋盘每格都是城;
 *  无距离限制——任意城皆可为溅射中心,含无主城=几何中心(自身免伤)与己城)。
 *  choices 选项装配、目标段候选、bot 中心打分全回查本口,UI/bot 不复制谓词(ADR-0013)。
 *  确定性:tileIndex 序;排序归消费方(bot 自带打分)。 */
export interface FireWallCenterTarget {
  propertyId: string;
  tileIndex: number;
  name: string; // 城名(候选钮 label 基底)
  ownerSeat: number | null; // null=无主(可作火源而自身免伤,#1386)
  level: number | null; // null=无主(城池等级只在持有态上)
}

export function fireWallCenterTargets(e: GameEngine): FireWallCenterTarget[] {
  const out: FireWallCenterTarget[] = [];
  for (const tile of e.board.tiles) {
    if (tile.propertyId == null) continue; // 是城才溅:propertyId null=编辑器半成品格,非城
    const owner = e.findOwner(tile.propertyId);
    const holding = owner == null ? null : findHolding(owner, tile.propertyId);
    if (owner != null && holding == null)
      throw new Error(`fireWallCenterTargets:城 ${tile.propertyId} 城主与持有失配(状态机 bug)`); // 零兜底
    out.push({
      propertyId: tile.propertyId,
      tileIndex: tile.index,
      name: tile.name,
      ownerSeat: owner == null ? null : e.players.indexOf(owner),
      level: holding == null ? null : holding.level,
    });
  }
  return out;
}

/** 火烧连营溅射受击清单(#1389 结算/识破份共用谓词):火源=中心 tileIndex,受击面=
 *  中心 + 前方距离 1、2 格上的城(#1386 前方距离谓词;是城才溅——全城池制下恒为城,
 *  propertyId null 的半成品格不入)。「一份=一座受击城」:识破份清单、火烧结算、
 *  bot 打分同读此口。immune=有主但为打空都城(0 级防御 0)——对火焰伤害免疫
 *  (defense.applyFireDamage 吸收),不算受击份(bot 不计命中),但仍在溅射面内
 *  (挨了打只是被吸收,果分战报照记)。确定性:中心→前方 1 格→前方 2 格(格序)。 */
export interface FireWallBurnCity {
  tileIndex: number;
  propertyId: string;
  name: string;
  ownerSeat: number | null; // null=无主:不受火焰伤害(不调结算单点,溅射锚/占位照记)
  level: number | null; // 与 ownerSeat 同步为 null(无主无持有态)
  defense: number | null; // 同上
  immune: boolean; // 有主打空都城:伤害被吸收(0 级都城打空即停免疫,#1386)
}

export function fireWallSplashCities(e: GameEngine, centerTileIndex: number): FireWallBurnCity[] {
  const out: FireWallBurnCity[] = [];
  for (const tile of e.board.tiles) {
    if (tile.propertyId == null) continue;
    const forward = e.board.forwardDistance(centerTileIndex, tile.index);
    if (forward > 2) continue; // 溅射距离门:中心+前方 1、2 格
    const owner = e.findOwner(tile.propertyId);
    const holding = owner == null ? null : findHolding(owner, tile.propertyId);
    if (owner != null && holding == null)
      throw new Error(`fireWallSplashCities:城 ${tile.propertyId} 城主与持有失配(状态机 bug)`); // 零兜底
    const ownerSeat = owner == null ? null : e.players.indexOf(owner);
    const immune =
      holding != null &&
      holding.level === 0 &&
      holding.defense === 0 &&
      tile.propertyId === e.board.at(owner!.capitalIndex)?.propertyId;
    out.push({
      tileIndex: tile.index,
      propertyId: tile.propertyId,
      name: tile.name,
      ownerSeat,
      level: holding == null ? null : holding.level,
      defense: holding == null ? null : holding.defense,
      immune,
    });
  }
  return out.sort((a, b) => {
    const fa = e.board.forwardDistance(centerTileIndex, a.tileIndex);
    const fb = e.board.forwardDistance(centerTileIndex, b.tileIndex);
    return fa - fb || a.tileIndex - b.tileIndex;
  });
}

/** AwaitingJinnang(出牌阶段,#122/T2 + #188 档 3):统一决策窗——锦囊卡牌段 + 就绪主动技 +
 *  「今不用」。目标段二态:pendingJinnang(锦囊选人)或 pendingSkill(技能选人)在场时
 *  改列候选座位 +「作罢」。锦囊 effect 尚未接入结算的种类灰置。 */
function jinnangChoices(e: GameEngine): ChoiceOption[] {
  const p = e.activePlayer;
  const pending = e.pendingJinnang;
  if (pending) {
    const def = jinnangCardOf(pending.cardId);
    // 城指向目标段(#1389 火烧连营):候选=全部城池格(谓词单源 fireWallCenterTargets;
    // 无主城标注「作火源自身免伤」语义进 label),逐城携城 id/城主;提交通道=targetTileIndex
    // (命令 targets=[tileIndex],id 拼接单源 cityTargetOptionId——与技能城目标段同形制)。
    if (def.targetDomain === "one-city") {
      const targets: ChoiceOption[] = fireWallCenterTargets(e).map((c): ChoiceOption => ({
        id: cityTargetOptionId(c.tileIndex),
        label: c.ownerSeat == null ? `${c.name}(无主,作火源自身免伤)` : c.name,
        available: true,
        targetPropertyId: c.propertyId,
        targetOwnerSeat: c.ownerSeat ?? undefined,
        targetTileIndex: c.tileIndex,
      }));
      return [...targets, { id: "cancel", label: "作罢", available: true }];
    }
    // 末段候选排除首段已定目标(声明单源 jinnang.TARGET_DOMAIN_STAGES.excludeFirstFromSecond,
    // #1067;两步域段名 two-b 由载荷形状承载)
    const exclude =
      TARGET_DOMAIN_STAGES[def.targetDomain].excludeFirstFromSecond && pending.stage === "two-b"
        ? pending.picked
        : [];
    const targets: ChoiceOption[] = e.players.map((t, seat): ChoiceOption => {
      const excluded = exclude.includes(seat);
      const verdict = jinnangTargetOk(e, e.players.indexOf(p), seat, def.effect.kind);
      const ok = !excluded && verdict.ok;
      return {
        id: `t${seat}`,
        label: t.guohao || t.name,
        available: ok,
        reason: excluded ? "已指定" : ok ? undefined : verdict.reason,
        targetSeat: seat,
      };
    });
    return [...targets, { id: "cancel", label: "作罢", available: true }];
  }
  const pendingSkill = e.pendingSkill;
  if (pendingSkill) {
    const skill = activeSkillOf(p, pendingSkill.heroId, pendingSkill.skillId);
    const userSeat = e.players.indexOf(p);
    // 城目标段(#1388 T2):候选=合法城清单(谓词单源 heroSkillCityTargets),逐城携
    // 城名(label)/城 id/城主/距离;作罢不记冷却(与席位域同口径)。
    if (skill?.target === "city") {
      const targets: ChoiceOption[] = heroSkillCityTargets(e, userSeat, skill).map(
        (c): ChoiceOption => ({
          id: cityTargetOptionId(c.tileIndex),
          label: c.name,
          available: true,
          targetPropertyId: c.propertyId,
          targetOwnerSeat: c.ownerSeat,
          targetDistance: c.distance,
          targetTileIndex: c.tileIndex,
        }),
      );
      return [...targets, { id: "cancel", label: "作罢", available: true }];
    }
    // 席位域目标段(#188 档 3):候选按技能目标域逐一校验(守卫单源 heroSkillTargetOk)
    const targets: ChoiceOption[] = e.players.map((t, seat): ChoiceOption => {
      const verdict = skill
        ? heroSkillTargetOk(e, userSeat, seat, skill)
        : { ok: false, reason: "技不在身" };
      return {
        id: `t${seat}`,
        label: t.guohao || t.name,
        available: verdict.ok,
        reason: verdict.ok ? undefined : verdict.reason,
        targetSeat: seat,
      };
    });
    return [...targets, { id: "cancel", label: "作罢", available: true }];
  }
  const used = new Set(e.jinnangUsedTags);
  const cards = p.jinnangHand.map((cardId): ChoiceOption => {
    const def = jinnangCardOf(cardId);
    const quotaBlocked = def.tags.some((t) => used.has(t));
    const implemented = JINNANG_LIVE_EFFECTS.has(def.effect.kind);
    // 纯反应牌(#281):不经出牌阶段,恒灰置「唯反应」——持唯反应牌不进「出牌阶段」
    // (hasUsableJinnang 由此不计纯反应牌);只在反应窗(snapshot.reaction)打出。
    const reactionOnly = isReactionCard(def);
    // 连环计需要两名有效目标:候选不足即灰置「对手不足」(T4);单目标域(#477)同样
    // 预检——一名有效目标都没有时牌不可名标,放行只会窥空(窃玉=对手无珍宝,密探/缓兵
    // =无存活对手,末者实际对局不可达,域级守卫顺手覆盖);城指向域(#1389)同族门:
    // 目标段无候选=牌不可出(候选=全部城,实际对局恒可达,门与目标域既有口径对齐)。
    const needTwo = def.targetDomain === "two-others";
    const needOne = def.targetDomain === "one";
    const isCityDomain = def.targetDomain === "one-city";
    const validTargets =
      needTwo || needOne
        ? e.players.filter(
            (_, i) => jinnangTargetOk(e, e.players.indexOf(p), i, def.effect.kind).ok,
          ).length
        : 0;
    const targetsShort =
      (needTwo && validTargets < 2) ||
      (needOne && validTargets < 1) ||
      (isCityDomain && fireWallCenterTargets(e).length === 0);
    const targetsReason = !targetsShort
      ? undefined
      : needTwo
        ? "对手不足"
        : isCityDomain
          ? "无可指向之城"
          : def.effect.kind === "stealTreasure"
            ? "无珍宝"
            : "对手不足";
    return {
      id: cardId,
      label: def.id,
      available: !reactionOnly && !quotaBlocked && implemented && !targetsShort,
      reason: reactionOnly
        ? "唯反应(反应窗打出)"
        : !implemented
          ? "此计暂未启用"
          : targetsShort
            ? targetsReason
            : quotaBlocked
              ? `本回合已用过〔${def.tags.filter((t) => used.has(t)).join("〕〔")}〕`
              : undefined,
      cardText: def.text,
      cardTags: def.tags,
    };
  });
  return [...cards, ...activeSkillChoices(e), { id: "pass", label: "今不用", available: true }];
}

/** 技能卡实例定位对判定(#817 实例化):skillId+skillHeroId 双章齐备即技实例选项——
 *  UI/bot 分流「技能卡/锦囊卡」与读实例定位都走本口,别再各自摸字段造第二套解析。 */
export function isSkillOption(
  o: ChoiceOption,
): o is ChoiceOption & { skillId: string; skillHeroId: string } {
  return o.skillId != null && o.skillHeroId != null;
}

/** 技能卡选项 id 拼接单源(#817):`skill:<heroId>:<skillId>`——选项 id/testid、useHeroSkill
 *  命令、快照 pendingSkill 四处同一形状,唯此一处拼。同一将池内技 id 唯一,故
 *  heroId+skillId 唯一定位一个麾下实例(技能卡实例卡不合并,#815 拍板)。 */
export function skillOptionId(heroId: string, skillId: string): string {
  return `skill:${heroId}:${skillId}`;
}

/** 按实例定位麾下主动技(#188 档 3;#817 实例定位对 heroId+skillId):指定槽已授技含该技
 *  且其为主动技才命中,技引用经授技单点校验可解析。查无返回 null(命令与麾下不符时
 *  由调用方处置)。 */
export function activeSkillOf(
  p: { heroes: HeroSlot[] },
  heroId: string,
  skillId: string,
): ActiveSkillDef | null {
  const slot = p.heroes.find((s) => s.heroId === heroId);
  if (slot == null || !slot.skillIds.includes(skillId)) return null;
  const def = skillById(skillId);
  return isActiveSkill(def) ? def : null;
}

/** 冷却剩余轮数(#188 档 3;#785 槽内账:>0 = 仍在冷却,键=active.id,同槽各技/同名技
 *  各槽各账)。 */
function skillCooldownLeft(e: GameEngine, slot: HeroSlot, skill: ActiveSkillDef): number {
  const last = slot.lastFired[skill.id];
  if (last == null) return 0;
  return Math.max(0, skill.cooldown - (e.round - last));
}

/** 出牌阶段主动技选项段(#188 档 3;#817 实例化——#815 拍板翻案 #806 去重权宜,技能卡
 *  实例卡不合并):遍历麾下槽位序×槽内已授技序(=池序),**每实例一选项**——同名技多槽
 *  (如周瑜+张星彩同授擂鼓)各出一条、各携实例(id=skill:<heroId>:<skillId>,拼接单源
 *  skillOptionId;同一将池内技 id 唯一,该对唯一定位一个实例),发动直落本实例槽内账
 *  (#785),「首就绪槽」代寻退役。可用性=本实例冷却就绪(冷却中 reason 报本实例剩余
 *  轮数),费用/目标门槛技级一验;label 带「名将·技名」照旧。与锦囊选项同窗并列,
 *  UI 以 skillId 区分「技」章。 */
function activeSkillChoices(e: GameEngine): ChoiceOption[] {
  const p = e.activePlayer;
  const userSeat = e.players.indexOf(p);
  const out: ChoiceOption[] = [];
  for (const slot of p.heroes) {
    const hero = heroById(slot.heroId);
    for (const skillId of slot.skillIds) {
      const skill = skillById(skillId);
      if (!isActiveSkill(skill)) continue; // 槽可含多条主动技(ADR-0036 逐字表)
      // 本实例冷却自读(#785 槽内账):冷却中报本实例剩余轮数
      const cdLeft = skillCooldownLeft(e, slot, skill);
      let available = cdLeft === 0;
      let reason = cdLeft > 0 ? `冷却中(还差 ${cdLeft} 轮)` : undefined;
      if (available) {
        // 冷却就绪后再验执行门槛:费用 → 目标候选存在(技级一验,同技实例共用;
        // 城目标域=合法城清单非空,#1388 T2,谓词单源 heroSkillCityTargets)
        const cost = skill.params?.cost ?? 0;
        if (cost > 0 && p.cash < cost) {
          available = false;
          reason = "银两不足";
        } else if (skill.target === "city") {
          if (heroSkillCityTargets(e, userSeat, skill).length === 0) {
            available = false;
            reason = "射程内无可烧之城";
          }
        } else if (skill.target !== "none") {
          const anyTarget = e.players.some(
            (_, seat) => heroSkillTargetOk(e, userSeat, seat, skill).ok,
          );
          if (!anyTarget) {
            available = false;
            reason = "无可指定目标";
          }
        }
      }
      out.push({
        id: skillOptionId(slot.heroId, skill.id),
        label: `${hero.name}·${skill.name}`,
        available,
        reason,
        skillId: skill.id,
        skillHeroId: slot.heroId,
        skillText: skill.desc,
        skillHero: hero.name,
      });
    }
  }
  return out;
}

/** 出牌阶段「仍有可用项」单源判定(#122/T2 → #188 档 3 扩义 → #1146 再扩):锦囊可用牌、
 *  就绪主动技、可学技能书三者任一存在即 true——相位进入与用牌/出技/用书收尾共用,防
 *  两处漂移。纯反应牌(#281)经「唯反应」灰置 available=false,天然不计入:持唯反应牌
 *  不进「出牌阶段」。技能书不经出牌窗选项集(入口=珍宝弹层,PileModal 一族书可点态),
 *  可学性判定单源 skillBookLearners——窗口零可用而书可用时,窗内空架+书从珍宝位走。 */
export function hasUsableJinnang(e: GameEngine): boolean {
  const p = e.activePlayer;
  return (
    computeChoices(e, "AwaitingJinnang").some(
      (o) => o.available && (o.cardTags != null || isSkillOption(o)),
    ) || p.treasures.some((t) => isSkillBook(t) && skillBookLearners(p, t.skillId).length > 0)
  );
}

/** 决策相位 → 选项计算器。未注册的相位(Roll/Land/EndTurn/GameOver)无决策。 */
export const PHASE_CHOICES: Partial<Record<TurnPhase, (e: GameEngine) => ChoiceOption[]>> = {
  AwaitingDecision: decisionChoices,
  AwaitingTreasureOwner: treasureOwnerChoices,
  AwaitingHeroPick: heroPickChoices,
  AwaitingEncounter: encounterChoices,
  AwaitingJinnang: jinnangChoices,
  AwaitingBankruptcySettle: bankruptcyChoices,
  AwaitingSkillChoice: skillChoiceChoices,
};

/** 自动执行例外名单(ADR-0013 决议 3):这些相位即使唯一选项也照常弹卷轴。 */
export const EXCLUDED_FROM_AUTO: ReadonlySet<TurnPhase> = new Set(["AwaitingBankruptcySettle"]);

/** 按相位查注册表计算选项集(引擎 choicesFor / 进入相位前的预检共用)。
 *  注册表查无计算器即空集(choices 通路(ADR-0013)是唯一问询通路;定制问询线
 *  已整线退役,#1065)。 */
export function computeChoices(e: GameEngine, phase: TurnPhase): ChoiceOption[] {
  return PHASE_CHOICES[phase]?.(e) ?? [];
}

// ─────────────────── 「你可」选择闸(#1377,被动技可选发动形制)───────────────────
// 放逐/行殇式被动技命中时不自动结算:效果层把待决入队(fangzhuMark/xingshangOffer),
// 回合收口 endTurn 入口逐条开窗(AwaitingSkillChoice 相位),真人经 respondSkillChoice
// 命令应答(选目标/放弃),bot 由驱动器按 botSkillChoiceDecision(bot.ts 单源)代答。
// 形制对齐反应窗(ADR-0017):停相位等应答、bot 不外显相位、零兜底(相位与载荷失配
// 当场炸);通道独立于 pendingReaction——反应窗的公告/应答事件与折叠面按牌语义收紧,
// 技能待决无牌面,快照队列即状态(联机经校准快照同步,呈现接线归交付票 #1378)。

/** 「你可」待决选择:时机命中且条件满足的效果挂起态,回合收口逐条开窗。纯数据,
 *  可序列化(快照非空才产键,空队=规范缺省)。 */
export interface PendingSkillChoice {
  /** 待决技 id(fangzhu/xingshang 共用形制)。 */
  skillId: string;
  /** 麾下槽位定位(放逐发动标记归零落槽)。 */
  heroId: string;
  /** 决策者=技属主座位(应答命令须同座)。 */
  ownerSeat: number;
  /** 触发主体座位(StaminaLoss 受损者 / TurnSkipImposed 被跳者)。 */
  subjectSeat: number;
  /** 既定目标座位(行殇=被跳者);放逐缺省=应答时选(不许指定自己,choices 校验)。 */
  targetSeat?: number;
}

/** 待决入队(效果注册表专用通道,effects.ts 域内直呼——同 roster.addSkillMarks 通路):
 *  同一槽位同一待决已在队=幂等不重问(阈值达成后标记未清,同回合再损失不再重复挂问);
 *  发动归零后新损失产生的是新问,不受此限。 */
export function queueSkillChoice(g: GameEngine, choice: PendingSkillChoice): void {
  const dup = g.pendingSkillChoices.some(
    (c) =>
      c.skillId === choice.skillId &&
      c.heroId === choice.heroId &&
      c.ownerSeat === choice.ownerSeat &&
      c.subjectSeat === choice.subjectSeat &&
      c.targetSeat === choice.targetSeat,
  );
  if (dup) return;
  g.pendingSkillChoices.push({ ...choice });
}

/** 回合收口的「你可」闸(endTurn 入口调):队列空=无事(返回 false,零扰动);
 *  非空先弃残问——①破产属主(与派发器跳过破产玩家同口径,破产者无决策);②属主
 *  麾下已无此技槽(遣散/破产清算遣散换银把将整槽撤走,规格 #1375 用户故事 9:
 *  「遣散放逐/行殇后标记与待决状态随技能槽清零,不残留」——槽既不在,残问不弃则
 *  发动落账 heroSlotOf 当场炸,#1378 池换血后曹丕可达此路,sim-bench 实锤),弃空
 *  则照常收口;否则停相位 AwaitingSkillChoice 挂首问等应答。bot 不即席代答——窗在
 *  endTurn 入口停相位后控制权交还驱动器,下一泵 botAct 按策略应答(bot.ts 决策
 *  单源),相位对全 bot 驱动链外显一拍即被代答续收。 */
export function enterSkillChoiceWindowIfOwed(g: GameEngine): boolean {
  if (g.pendingSkillChoices.length === 0) return false;
  g.pendingSkillChoices = g.pendingSkillChoices.filter((c) => {
    if (g.players[c.ownerSeat].isBankrupt) return false;
    const slot = g.players[c.ownerSeat].heroes.find((s) => s.heroId === c.heroId);
    return slot != null && slot.skillIds.includes(c.skillId);
  });
  const pending = g.pendingSkillChoices[0];
  if (pending == null) return false;
  const skill = skillById(pending.skillId);
  if (!isTriggerSkill(skill)) throw new Error(`「你可」待决 ${pending.skillId} 非被动技(数据 bug)`); // 零兜底
  g.turnPhase = "AwaitingSkillChoice";
  const owner = g.players[pending.ownerSeat];
  const targetTxt =
    pending.targetSeat != null ? `,目标 ${g.players[pending.targetSeat].guohao}` : "";
  g.logEvent(
    "system",
    owner.guohao,
    `${owner.guohao}「${skill.name}」可达发动条件,可指定目标或暂不发${targetTxt}`,
    `skillChoiceAwait skill=${pending.skillId} hero=${pending.heroId} owner=${owner.id} subject=${g.players[pending.subjectSeat].id}`,
  );
  return true;
}

/** 「你可」应答(公共入口,UI/bot 驱动器/托管代驾同走):校验「仅决策者、目标合法」
 *  后落账;放逐发动=目标 skipTurns +1(与缓兵之计同形制叠加)+ 追加一笔被强加跳回合
 *  (reason=xingshang,韬光养晦按笔计酬)+ 本槽标记归零;放弃=标记保留。应答后队列
 *  续问(停下一窗)或重入回合收口(endTurn,队列空即正常收尾)。非法命令警告拒绝,
 *  不占待决名额(窗原地保留)。 */
export function respondSkillChoice(
  g: GameEngine,
  seat: number,
  use: boolean,
  targetSeat?: number,
): void {
  if (!g.assertPhase("AwaitingSkillChoice", "respondSkillChoice")) return;
  const pending = g.pendingSkillChoices[0];
  if (pending == null)
    throw new Error("respondSkillChoice:AwaitingSkillChoice 相位无待决选择(状态机 bug)"); // 零兜底
  const owner = g.players[pending.ownerSeat];
  const skill = skillById(pending.skillId);
  if (!isTriggerSkill(skill)) throw new Error(`「你可」待决 ${pending.skillId} 非被动技(数据 bug)`); // 零兜底
  if (seat !== pending.ownerSeat) {
    g.warn(`respondSkillChoice:座位 ${seat} 非本窗决策者`);
    return;
  }
  if (use) {
    const target = pending.targetSeat ?? targetSeat;
    if (target == null) {
      g.warn("respondSkillChoice:发动缺目标座位");
      return;
    }
    if (target === seat) {
      g.warn("respondSkillChoice:不能指定自己");
      return;
    }
    if (g.players[target].isBankrupt) {
      g.warn("respondSkillChoice:目标已出局");
      return;
    }
    g.pendingSkillChoices.shift(); // 先离队再落账:发动内派发不再回看本问
    fireSkillChoice(g, pending, skill, target);
  } else {
    g.pendingSkillChoices.shift(); // 放弃:标记保留(归零只在发动时发生,再攒再问)
    g.logEvent(
      "system",
      owner.guohao,
      `${owner.guohao} 暂不发「${skill.name}」`,
      `skillChoiceDecline skill=${pending.skillId} hero=${pending.heroId} owner=${owner.id}`,
    );
  }
  if (g.pendingSkillChoices.length > 0) {
    enterSkillChoiceWindowIfOwed(g); // 续问:停下一窗(bot 座位由驱动器下一泵代答)
    return;
  }
  g.endTurn(); // 队列清空:重入回合收口(入口闸见空即正常收尾)
}

/** 发动落账(#1377):目标 skipTurns +1(叠加语义,缓兵之计同形制)+ 追加一笔
 *  「被强加跳回合」时机(subject=目标,reason=xingshang:行殇过滤只认耗竭故不递归,
 *  韬光养晦按笔计酬=设计联动);fireResetsMarks 技另把本槽标记归零(超出部分舍弃)。 */
function fireSkillChoice(
  g: GameEngine,
  pending: PendingSkillChoice,
  skill: TriggerSkill,
  target: number,
): void {
  const owner = g.players[pending.ownerSeat];
  const victim = g.players[target];
  victim.skipTurns += 1;
  g.dispatchMoment("TurnSkipImposed", { subject: target, reason: "xingshang" });
  if (skill.fireResetsMarks) resetSkillMarks(heroSlotOf(owner, pending.heroId), skill.id);
  g.logEvent(
    "system",
    owner.guohao,
    `${owner.guohao} 发动「${skill.name}」:${victim.guohao} 下回合被拖住`,
    `skillChoiceFire skill=${skill.id} hero=${pending.heroId} owner=${owner.id} target=${victim.id} skip=${victim.skipTurns}`,
  );
}

/** AwaitingSkillChoice 选项集(ADR-0013 注册表):发动目标候选(放逐=存活他人逐座校验,
 *  行殇=既定目标)+「暂不发」。命令面=respondSkillChoice(use+targetSeat),选项集为
 *  UI/bot 的可用性口径(快照 choices 透出)。 */
function skillChoiceChoices(e: GameEngine): ChoiceOption[] {
  const pending = e.pendingSkillChoices[0];
  if (pending == null) return []; // 非本相位无决策:注册表按相位调入,理论不达
  const options: ChoiceOption[] = e.players.map((t, seat): ChoiceOption => {
    const ok =
      pending.targetSeat != null
        ? seat === pending.targetSeat
        : seat !== pending.ownerSeat && !t.isBankrupt;
    const reason = ok
      ? undefined
      : pending.targetSeat != null
        ? "非本技目标"
        : seat === pending.ownerSeat
          ? "不能指定自己"
          : t.isBankrupt
            ? "已出局"
            : undefined;
    return { id: `t${seat}`, label: t.guohao || t.name, available: ok, reason, targetSeat: seat };
  });
  options.push({ id: "decline", label: "暂不发", available: true });
  return options;
}
