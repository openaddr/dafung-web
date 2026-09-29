// 名将(英雄)池:技能即数据(时机框架)。新增名将 = 往这里加一条 HeroDef(技能挂到任意
// GameMoment 时机,效果查 src/core/effects.ts 注册表;时机定义见 src/core/timing.ts)。
// 新时机/新效果才需要动 timing.ts / effects.ts,本文件永远只是纯数据。
// 名将技能类型随域走(#326 types.ts 解散,ADR-0019):名将/技能定义由本文件拥有。
import type { GameMoment } from "./timing";

// ── 名将(英雄)系统:技能即数据(时机框架)。技能 = 「什么时机(when)触发什么效果(effect,查
// src/core/effects.ts 注册表)+ 纯数据参数(params)」;派发器统一在 authority.ts dispatchMoment。
// 扩展指南见 docs/explanation/时机框架.md:加效果一步、加技能两步、加时机三步。
export interface TriggerSkill {
  id: string; // 唯一 id(如 "zhouyu-move+1";同时是 heroLastFired 冷却键)
  when: GameMoment; // 触发时机(查 src/core/timing.ts)
  effect: string; // EffectId,查 src/core/effects.ts 注册表;未知 id 派发时直接抛错(数据 bug)
  params?: Record<string, number>; // 效果参数(纯数据,可序列化)
  cooldown?: number; // 冷却(单位:轮,复用 heroLastFired 机制,键=skill.id)
  /** 技能属主(owner)与时机主体(subject)/当前行动者的关系;缺省 = "self":
   *  - "self":属主是时机主体(我的骰/我的失财/我的回合…)
   *  - "others":时机主体不是属主(别人失财/别人掷骰…)
   *  - "any":主体不限(任何人,含属主自己)
   *  - "actor":时机主体恰为当前行动玩家(activeIndex,属主不限)——当前所有派发点主体即行动者,
   *    与 "any" 等价;未来出现「非行动玩家」主体的时机(如回合外失财)时二者分化。 */
  scope?: "self" | "actor" | "others" | "any";
}

export interface HeroDef {
  id: string;
  name: string; // 周瑜
  title: string; // 火烧赤壁(称号,风味)
  desc: string; // 给玩家看的技能说明
  skills?: TriggerSkill[]; // 一武多技(时机驱动,按数组序派发)
  /** 主动技(#188 档 3):军师幕(与锦囊合并窗,AwaitingJinnang 相位)内手动发动,
   *  独立冷却(复用 heroLastFired,键=active.id);每名将至多一个,缺省=无主动技。 */
  active?: ActiveSkillDef;
  image: string; // 画像路径(public 下,如 /assets/heroes/hero-zhouyu-sgs.png;3:4 竖版)
}

/** 名将主动技(#188 档 3):数据声明,与被动技(TriggerSkill·时机驱动)并存。
 *  结算复用既有路径(火攻=demolish 语义、征辟=转移+委任状),不新造 effect kind;
 *  技能结算内不派发时机(与 grantSkillCash 的防连锁口径一致)。
 *  目标校验单源在 choices.ts(引擎命令提交时复核,UI/bot 永不裁决,ADR-0013)。 */
export interface ActiveSkillDef {
  id: string; // 唯一(同时是 heroLastFired 冷却键)
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

export const HEROES: HeroDef[] = [
  {
    id: "zhouyu",
    image: "/assets/heroes/hero-zhouyu-sgs.png",
    name: "周瑜",
    title: "雅量高致",
    desc: "你的移动步数始终 +1",
    skills: [
      {
        id: "zhouyu-move+1",
        when: "BeforeMarch",
        effect: "moveBonus",
        params: { steps: 1 },
        scope: "self",
      },
    ],
    // 主动技(#188 档 3):火烧连营同款 demolish 结算(复用 #226 守卫:都城可降不可失)
    active: {
      id: "zhouyu-huogong",
      name: "火攻",
      cooldown: 5,
      desc: "火烧一座敌城:指定一名诸侯,其一处城防降 1 级;城防尽毁则失一座城(都城不失)。",
      target: "other",
      targetGuard: "demolish",
      kind: "demolish",
    },
  },
  {
    id: "caopi",
    image: "/assets/heroes/hero-caopi-sgs.png",
    name: "曹丕",
    title: "承继大统",
    desc: "其他玩家被动失去银两时,你 +50 两",
    skills: [
      {
        id: "caopi-gain-on-other-lose",
        when: "CashLost",
        effect: "gainCash",
        params: { amount: 50 },
        scope: "others",
      },
    ],
    // 主动技:买官鬻爵——朝廷发你委任状,国库补偿目标(等价交换,银两出自国库非自家)
    active: {
      id: "caopi-zhengpi",
      name: "征辟",
      cooldown: 4,
      desc: "征辟就任:你 +1 委任状,并指定一名诸侯获 50 两补偿(出自国库)。",
      target: "other",
      kind: "patronage",
      params: { cash: 50 },
    },
  },
  {
    id: "zhangxingcai",
    image: "/assets/heroes/hero-zhangxingcai-sgs.png",
    name: "张星彩",
    title: "银翎飞骑",
    desc: "场上任意人掷出 6,你 +20 两",
    skills: [
      {
        id: "zhangxingcai-gain-on-six",
        when: "DieRolled",
        effect: "gainIfFace",
        params: { face: 6, amount: 20 },
        scope: "any",
      },
    ],
    // 主动技:擂鼓进军——本回合掷骰步数 +2(与周瑜被动同为步数加成,骰面不变)
    active: {
      id: "zhangxingcai-leigu",
      name: "擂鼓",
      cooldown: 4,
      desc: "擂鼓进军:本回合你的下一次掷骰步数 +2(签面不变)。",
      target: "none",
      kind: "warDrum",
      params: { bonus: 2 },
    },
  },
  {
    id: "huatuo",
    image: "", // 画像资源未落地(#133):UI 画像位 onError 兜底显「像」字占位,资源到位后回填路径
    name: "华佗",
    title: "神医",
    desc: "每 3 轮为麾下恢复 15 体力(不与世界为敌,只与病痛为敌)",
    // scope="any":RoundStart 的 subject 是轮次锚点,缺省 self 会让非锚点持有者永不触发——
    // 每次轮首派发都参评,效果内部落账给持有者(ctx.owner);cooldown 3(轮)即「每 3 轮一跳」。
    skills: [
      {
        id: "huatuo-regen-stamina",
        when: "RoundStart",
        effect: "regenStamina",
        params: { amount: 15 },
        cooldown: 3,
        scope: "any",
      },
    ],
    // 主动技:开仓赈济——付 100 两为任一存活诸侯(含自己)回 30 体力
    active: {
      id: "huatuo-zhenji",
      name: "赈济",
      cooldown: 3,
      desc: "开仓赈济:付 100 两,为任一诸侯(含自己)恢复 30 体力。",
      target: "any",
      kind: "relief",
      params: { cost: 100, stamina: 30 },
    },
  },
];
