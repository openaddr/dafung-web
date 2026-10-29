// 技能表(ADR-0036 技能升一等公民):技与将解耦——技能独立成表,一条技可入多个名将的
// 池(重叠是特性,不做去重守卫);技 id 全局唯一,用技名拼音、不带将名前缀(复用不撒谎)。
// 被动技(TriggerSkill·时机驱动)与主动技(ActiveSkillDef·出牌阶段手动)同表同目录;
// 名将经 HeroDef.skillPool 按池声明序引用(池序 = 派发序/卡面序/浮字拼接序,见 src/core/heroes.ts)。
// 新增技 = 往 SKILLS 加一条纯数据(效果查 src/core/effects.ts 注册表;扩展指南见
// docs/explanation/时机框架.md);新时机/新效果才需要动 timing.ts / effects.ts,
// 本文件永远只是纯数据 + 按 id 的读口(池序契约在麾下槽位 skillIds,见 src/core/roster.ts)。
import type { GameMoment } from "./timing";

// ── 技能系统:技能即数据(时机框架)。技能 = 「什么时机(when)触发什么效果(effect,查
// src/core/effects.ts 注册表)+ 纯数据参数(params)」;派发器统一在 authority.ts dispatchMoment。
export interface TriggerSkill {
  id: string; // 唯一 id(如 "jixing";同时是麾下槽位 lastFired 的冷却键)
  name: string; // 技名(如 "疾行";UI 技名 chips 与规则页用,#358;纯展示,不参与判定)
  desc: string; // 技效说明(玩家可见;招贤浮字/卡面技能区/技能全览弹框消费;#604 每技自带)
  when: GameMoment; // 触发时机(查 src/core/timing.ts)
  effect: string; // EffectId,查 src/core/effects.ts 注册表;未知 id 派发时直接抛错(数据 bug)
  params?: Record<string, number>; // 效果参数(纯数据,可序列化)
  cooldown?: number; // 冷却(单位:轮,记于麾下槽位 lastFired,键=skill.id、各槽各账 #785)
  /** 技能属主(owner)与时机主体(subject)/当前行动者的关系;缺省 = "self":
   *  - "self":属主是时机主体(我的骰/我的失财/我的回合…)
   *  - "others":时机主体不是属主(别人失财/别人掷骰…)
   *  - "any":主体不限(任何人,含属主自己)
   *  - "actor":时机主体恰为当前行动玩家(activeIndex,属主不限)——当前所有派发点主体即行动者,
   *    与 "any" 等价;未来出现「非行动玩家」主体的时机(如回合外失财)时二者分化。 */
  scope?: "self" | "actor" | "others" | "any";
}

/** 名将主动技(#188 档 3):数据声明,与被动技(TriggerSkill·时机驱动)同表并存。
 *  结算复用既有路径(火攻=demolish 语义、征辟=转移+委任状),不新造 effect kind;
 *  技能结算内不派发时机(与 grantSkillCash 的防连锁口径一致)。
 *  目标校验单源在 choices.ts(引擎命令提交时复核,UI/bot 永不裁决,ADR-0013)。 */
export interface ActiveSkillDef {
  id: string; // 唯一(同时是麾下槽位 lastFired 的冷却键)
  name: string; // 火攻(卷轴选项 label 组合为「名将·技名」)
  cooldown: number; // 冷却(轮):发动后过 cooldown 轮才可再发动
  desc: string; // 卷轴文案(效果自证,与结算互证)
  /** 目标域:none=无目标(发动即结算);other=一名其他存活玩家;any=任一存活玩家(含自己)。 */
  target: "none" | "other" | "any";
  /** 结算路径(游戏内唯一定义处):demolish=降 1 级/失城(火烧连营同款);relief=付费回体力;
   *  patronage=自得委任状、目标得银;warDrum=本回合下一次掷骰步数加成。 */
  kind: "demolish" | "relief" | "patronage" | "warDrum";
  /** 目标附加守卫(demolish 专属):有 Lv>0 城可降、或有非都城可失,二者居一才可指定
   *  (#226 口径:都城可降不可失)。 */
  targetGuard?: "demolish";
  /** 技能参数(纯数据,可序列化):relief={cost,stamina};patronage={cash};warDrum={bonus}。 */
  params?: Record<string, number>;
}

/** 技能(被动 ∪ 主动)统一形状:技表条目;查得后经 isTriggerSkill/isActiveSkill 收窄。 */
export type SkillDef = TriggerSkill | ActiveSkillDef;

export function isTriggerSkill(skill: SkillDef): skill is TriggerSkill {
  return "when" in skill;
}

export function isActiveSkill(skill: SkillDef): skill is ActiveSkillDef {
  return "kind" in skill;
}

/** 技表(id 全局唯一由本表自证;扩展经 extension-registry 注册并入同表)。 */
export const SKILLS: SkillDef[] = [
  // ── 被动技(时机驱动)──
  {
    id: "jixing",
    name: "疾行",
    desc: "你的移动步数始终 +1",
    when: "BeforeMarch",
    effect: "moveBonus",
    params: { steps: 1 },
    scope: "self",
  },
  {
    id: "yuli",
    name: "渔利", // 提案名(#358 施工资未拍板,报告供审)
    desc: "其他玩家被动失去银两时,你 +50 两",
    when: "CashLost",
    effect: "gainCash",
    params: { amount: 50 },
    scope: "others",
  },
  {
    id: "zhijin",
    name: "掷金",
    desc: "场上任意人掷出 6,你 +20 两",
    when: "DieRolled",
    effect: "gainIfFace",
    params: { face: 6, amount: 20 },
    scope: "any",
  },
  {
    id: "qingnang",
    name: "青囊",
    desc: "每 3 轮为自身恢复 15 体力(不与世界为敌,只与病痛为敌)",
    when: "RoundStart",
    effect: "regenStamina",
    params: { amount: 15 },
    cooldown: 3,
    // scope="any":RoundStart 的 subject 是轮次锚点,缺省 self 会让非锚点持有者永不触发——
    // 每次轮首派发都参评,效果内部落账给持有者(ctx.owner);cooldown 3(轮)即「每 3 轮一跳」。
    scope: "any",
  },
  // ── 主动技(出牌阶段手动,#188 档 3)──
  {
    id: "huogong",
    name: "火攻",
    cooldown: 5,
    // 火烧连营同款 demolish 结算(复用 #226 守卫:都城可降不可失)
    desc: "火烧一座敌城:指定一名诸侯,其一处城防降 1 级;城防尽毁则失一座城(都城不失)。",
    target: "other",
    targetGuard: "demolish",
    kind: "demolish",
  },
  {
    id: "zhengpi",
    name: "征辟",
    cooldown: 4,
    // 买官鬻爵——朝廷发你委任状,国库补偿目标(等价交换,银两出自国库非自家)
    desc: "征辟就任:你 +1 委任状,并指定一名诸侯获 50 两补偿(出自国库)。",
    target: "other",
    kind: "patronage",
    params: { cash: 50 },
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
