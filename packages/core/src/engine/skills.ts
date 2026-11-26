// 技能表(ADR-0036 技能升一等公民):技与将解耦——技能独立成表,一条技可入多个名将的
// 池(重叠是特性,不做去重守卫);技 id 全局唯一,用技名拼音、不带将名前缀(复用不撒谎)。
// 被动技(TriggerSkill·时机驱动)、主动技(ActiveSkillDef·出牌阶段手动)与静态被动
// (StaticSkillDef·持有即恒常改一条推导值,#1390 英姿)同表同目录;
// 名将经 HeroDef.skillPool 按池声明序引用(池序 = 派发序/卡面序/浮字拼接序,见 packages/core/src/engine/heroes.ts)。
// 新增技 = 往 SKILLS 加一条纯数据(效果查 packages/core/src/engine/effects.ts 注册表;扩展指南见
// docs/explanation/时机框架.md);新时机/新效果才需要动 timing.ts / effects.ts,
// 本文件永远只是纯数据 + 按 id 的读口(池序契约在麾下槽位 skillIds,见 packages/core/src/engine/roster.ts)。
import type { GameEngine } from "./authority";
import { DEFAULT_DIE_FACES } from "./dice";
import type { GameMoment, MomentStage } from "./timing";

// ── 技能系统:技能即数据(时机框架)。技能 = 「什么时机(when)触发什么效果(effect,查
// packages/core/src/engine/effects.ts 注册表)+ 纯数据参数(params)」;派发器统一在 authority.ts dispatchMoment。
export interface TriggerSkill {
  id: string; // 唯一 id(如 "jixing";同时是麾下槽位 lastFired 的冷却键)
  name: string; // 技名(如 "疾行";UI 技名 chips 与规则页用,#358;纯展示,不参与判定)
  desc: string; // 技效说明(玩家可见;招贤浮字/卡面技能区/技能全览弹框消费;#604 每技自带)
  stage: MomentStage;
  when: GameMoment; // 触发时机(查 packages/core/src/engine/timing.ts)
  effect: string; // EffectId,查 packages/core/src/engine/effects.ts 注册表;未知 id 派发时直接抛错(数据 bug)
  params?: Record<string, number>; // 效果参数(纯数据,可序列化)
  cooldown?: number; // 冷却(单位:轮,记于麾下槽位 lastFired,键=skill.id、各槽各账 #785)
  /** 技能属主(owner)与时机主体(subject)/当前行动者的关系;缺省 = "self":
   *  - "self":属主是时机主体(我的骰/我的失银/我的回合…)
   *  - "others":时机主体不是属主(别人失银/别人掷骰…)
   *  - "any":主体不限(任何人,含属主自己)
   *  - "actor":时机主体恰为当前行动玩家(activeIndex,属主不限)——当前所有派发点主体即行动者,
   *    与 "any" 等价;未来出现「非行动玩家」主体的时机(如回合外失银)时二者分化。 */
  scope?: "self" | "actor" | "others" | "any";
  /** 「你可」应答确认发动时，将本槽里该技能的标记归零。 */
  fireResetsMarks?: boolean;
}

/** 名将主动技(#188 档 3):数据声明,与被动技(TriggerSkill·时机驱动)同表并存。
 *  结算复用既有单点(火攻=defense.applyCityDamage,#1388 T2 定向化);
 *  技能结算内不派发时机(与 grantSkillCash 的防连锁口径一致)。
 *  目标校验单源在 choices.ts(引擎命令提交时复核,UI/bot 永不裁决,ADR-0013)。 */
export interface ActiveSkillDef {
  id: string; // 唯一(同时是麾下槽位 lastFired 的冷却键)
  name: string; // 火攻(卷轴选项 label 组合为「名将·技名」)
  cooldown: number; // 冷却(轮):发动后过 cooldown 轮才可再发动
  desc: string; // 卷轴文案(效果自证,与结算互证)
  /** 目标域:none=无目标(发动即结算);other=一名其他存活玩家;any=任一存活玩家(含自己);
   *  city=一座合法城(#1388 T2 城目标域:候选=合法城清单,谓词单源 choices.heroSkillCityTargets
   *  ——距离 ≤ params.range 且城主为他人;提交通道=目标城 tileIndex)。 */
  target: "none" | "other" | "any" | "city";
  /** 结算路径(游戏内唯一定义处):fireBlast=对目标城造成 params.damage 点火焰伤害
   *  (结算单点 defense.applyCityDamage,#1388;#1389 起火烧连营锦囊路同走该单点);
   *  relief=付费回体力;warDrum=本回合下一次掷骰步数加成。 */
  kind: "fireBlast" | "relief" | "warDrum";
  /** 技能参数(纯数据,可序列化):fireBlast={range,damage};relief={cost,stamina};
   *  warDrum={bonus}。缺必填项结算时响亮抛错(零兜底)。 */
  params?: Record<string, number>;
}

/** 静态被动(#1390 英姿首例):无时机、无结算、无冷却——持有即恒常改一条**推导值**
 *  (现役唯一=骰面数,查询口 heroDieFaces 单源推导,不入快照/不经派发/无快照双源)。
 *  与 TriggerSkill(时机驱动)、ActiveSkillDef(出牌手动)同表三形;卡面/全览/手册
 *  按形制渲染(非 active 非 trigger = 静态)。 */
export interface StaticSkillDef {
  id: string; // 唯一(查询口按 id 判持有,如 heroDieFaces 判 yingzi)
  name: string; // 英姿(卡面/全览/手册展示,#358)
  desc: string; // 技效说明(玩家可见;#604 每技自带)
}

/** 技能(被动 ∪ 主动 ∪ 静态被动)统一形状:技表条目;查得后经
 *  isTriggerSkill/isActiveSkill/isStaticSkill 收窄。 */
export type SkillDef = TriggerSkill | ActiveSkillDef | StaticSkillDef;

export function isTriggerSkill(skill: SkillDef): skill is TriggerSkill {
  return "when" in skill;
}

export function isActiveSkill(skill: SkillDef): skill is ActiveSkillDef {
  return "kind" in skill;
}

export function isStaticSkill(skill: SkillDef): skill is StaticSkillDef {
  return !isTriggerSkill(skill) && !isActiveSkill(skill);
}

/** 技表(id 全局唯一由本表自证;扩展经 extension-registry 注册并入同表)。 */
export const SKILLS: SkillDef[] = [
  // ── 被动技(时机驱动)──
  {
    id: "jixing",
    name: "疾行",
    desc: "你的移动步数始终 +1",
    when: "BeforeMarch",
    stage: "during",
    effect: "moveBonus",
    params: { steps: 1 },
    scope: "self",
  },
  {
    id: "yuli",
    name: "渔利", // 提案名(#358 施工资未拍板,报告供审)
    desc: "其他玩家被动失去银两时,你 +50 两",
    when: "CashLost",
    stage: "during",
    effect: "gainCash",
    params: { amount: 50 },
    scope: "others",
  },
  {
    id: "zhijin",
    name: "掷金",
    desc: "场上任意人掷出 6,你 +20 两",
    when: "DieRolled",
    stage: "during",
    effect: "gainIfFace",
    params: { face: 6, amount: 20 },
    scope: "any",
  },
  {
    id: "qingnang",
    name: "青囊",
    desc: "每 3 轮为自身恢复 15 体力(不与世界为敌,只与病痛为敌)",
    when: "RoundStart",
    stage: "during",
    effect: "regenStamina",
    params: { amount: 15 },
    cooldown: 3,
    // scope="any":RoundStart 的 subject 是轮次锚点,缺省 self 会让非锚点持有者永不触发——
    // 每次轮首派发都参评,效果内部落账给持有者(ctx.owner);cooldown 3(轮)即「每 3 轮一跳」。
    scope: "any",
  },
  // ── 被动技·技能扩展内容包(#1145,spec #1144 拆票 A/五):现役联动技，
  // 数值经 #1148 sim A/B 校准定稿(seeds 1000–1049 五判据收敛+注入双通道);
  // 时机/效果对号 timing.ts MOMENTS 与 effects.ts EFFECTS
  // 注册表,冷却照疾行/渔利/掷金形制(无冷却)。──
  {
    id: "delongwangshu",
    name: "得陇望蜀",
    desc: "你获得珍宝时,+100 两",
    when: "TreasureGained",
    stage: "during",
    effect: "gainCash",
    params: { amount: 100 },
    scope: "self",
  },
  {
    id: "yusui",
    name: "玉碎",
    desc: "你失去珍宝时,+80 两",
    when: "TreasureLost",
    stage: "during",
    effect: "gainCash",
    params: { amount: 80 },
    scope: "self",
  },
  {
    id: "shengougolei",
    name: "深沟高垒",
    desc: "他人途经你城而不入时,你 +20 两",
    when: "MarchPassedCity",
    stage: "during",
    effect: "cashOnOwnCityPassed",
    params: { amount: 20 },
    // scope="any":主体=行人,受益人=城主(ctx.ownerSeat);落点格不派、拦停即止皆框架语义。
    scope: "any",
  },
  {
    id: "taoguangyanghui",
    name: "韬光养晦",
    desc: "你被强加跳回合时,+100 两",
    when: "TurnSkipImposed",
    stage: "during",
    effect: "gainCash",
    params: { amount: 100 },
    scope: "self",
  },
  {
    id: "chubianbujing",
    name: "处变不惊",
    desc: "他人的锦囊指向你时,你 +10 两",
    when: "JinnangAnnounced",
    stage: "during",
    effect: "cashIfTargetedByJinnang",
    params: { amount: 10 },
    // scope="others":主体=用计者,自己用计不触发;「属主 ∈ targetSeats」在效果内判。
    scope: "others",
  },
  {
    id: "suifeng",
    name: "岁俸",
    desc: "每个回合开始时,你 +1 两",
    when: "TurnStart",
    stage: "during",
    effect: "gainCash",
    params: { amount: 1 },
    // scope="any":TurnStart 的 subject 是新活跃玩家,缺省 self 会让非活跃持有者永不触发——
    // 每次回合开始派发都参评,效果内部落账给持有者(ctx.owner);同青囊的 any 先例,
    // 双池共享(司马懿↔邓艾)=首批共享三技之后的新共享先例。
    scope: "any",
  },
  // ── 被动技·「你可」可选发动：在触发的时机内完成选择。──
  {
    id: "fangzhu",
    name: "放逐",
    desc: "每次损失体力时，获得等量的「放逐」标记。此时若累计至少有 60 枚标记，你可指定一名其他诸侯，使其跳过下一个回合，并清空你的「放逐」标记。",
    when: "StaminaLoss",
    stage: "during",
    effect: "fangzhuMark",
    params: { threshold: 60 },
    scope: "self", // 伤害=主公损失体力:主体恒属主本人(体力唯一写口内派发)
    fireResetsMarks: true, // 发动重置「放逐」标记数(超出 60 的部分随归零舍弃)
  },
  {
    id: "xingshang",
    name: "行殇",
    desc: "一名其他诸侯因体力耗竭进入休整时，你可令该诸侯多休整 1 个回合。",
    when: "TurnSkipImposed",
    stage: "during",
    effect: "xingshangOffer",
    // scope="others":主体=被跳者,自己休整不触发;原因过滤(只认耗竭)在效果内判——
    // 缓兵之计的跳过(jinnang)与行殇本笔(xingshang)均不触发。
    scope: "others",
  },
  // ── 静态被动(#1390,spec #1386 周瑜重做):持有即恒常,无时机/无结算/无冷却——
  // 骰面数由持有状态经 heroDieFaces 推导(下方查询口单源),不入快照(免双源);
  // 不经 dispatchMoment(两形守卫皆 false,派发/出牌卷轴/技能卡三面天然跳过)。
  // ──
  {
    id: "yingzi",
    name: "英姿",
    desc: "你的骰子始终多 1 面，新增面的点数比原最高点数多 1。",
  },
  // ── 主动技(出牌阶段手动,#188 档 3)──
  {
    id: "huogong",
    name: "火攻",
    cooldown: 5,
    // 目标由 choices.heroSkillCityTargets 校验，结算走统一城池伤害。
    desc: "出牌阶段，你可指定距离你 5 格以内的一座其他诸侯的城池，对其造成 10 点火焰伤害。实际扣防且未破防时施加燃烧，若已燃烧则续火。",
    target: "city",
    kind: "fireBlast",
    params: { range: 5, damage: 10 },
  },
  {
    id: "leigu",
    name: "擂鼓",
    cooldown: 4,
    // 擂鼓进军——本回合掷骰步数 +2(与疾行同为步数加成,骰面不变)
    desc: "擂鼓进军:本回合你的下一次掷骰步数 +2(签面不变)。",
    target: "none",
    kind: "warDrum",
    params: { bonus: 2 },
  },
  {
    id: "zhenji",
    name: "赈济",
    cooldown: 3,
    // 开仓赈济——付 100 两为任一存活诸侯(含自己)回 30 体力
    desc: "开仓赈济:付 100 两,为任一诸侯(含自己)恢复 30 体力。",
    target: "any",
    kind: "relief",
    params: { cost: 100, stamina: 30 },
  },
];

/** 按技 id 查技(表含扩展注册;查无 = 数据 bug,炸出)。 */
export function skillById(id: string): SkillDef {
  const skill = SKILLS.find((s) => s.id === id);
  if (skill == null) throw new Error(`技能目录外 id:${id}(core/skills.ts SKILLS 无此 id)`);
  return skill;
}

/** 按技 id 查主动技(技 id 同时是麾下槽位 lastFired 的冷却键,与 TriggerSkill.id 同口径);
 *  查无/非主动 = 数据 bug,炸出。 */
export function activeSkillById(id: string): ActiveSkillDef {
  const skill = skillById(id);
  if (!isActiveSkill(skill)) throw new Error(`技能 ${id} 不是主动技(数据 bug)`);
  return skill;
}

// ── 骰面数查询口(#1390 英姿;掷骰面数唯一单源)──

/** 英姿技 id(面数推导的持有判据;与 SKILLS 表条目同源,常量供查询口与测试引用)。 */
export const YINGZI_SKILL_ID = "yingzi";

/** 持有英姿者骰面数 +1(第七面 = DEFAULT_DIE_FACES+1 = 7),否则六面。
 *  持有状态从**麾下槽位已授技**(HeroSlot.skillIds)推导——与冷却账同族(同一份槽位态),
 *  不入快照(免双源):快照已有槽位 skillIds,面数随查随得,恢复/联机天然一致;
 *  骰值本身照常走既有 RNG 快照通路。适用该玩家全部掷骰(行军/拼点双掷/探宝拼点双骰)。 */
export function heroDieFaces(e: GameEngine, seat: number): number {
  const p = e.players[seat];
  if (p == null) throw new Error(`heroDieFaces:座位 ${seat} 不存在(共 ${e.players.length} 席)`);
  const hasYingzi = p.heroes.some((slot) => slot.skillIds.includes(YINGZI_SKILL_ID));
  return hasYingzi ? DEFAULT_DIE_FACES + 1 : DEFAULT_DIE_FACES;
}
