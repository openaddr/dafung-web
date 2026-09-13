// 名将(英雄)池:技能即数据(时机框架)。新增名将 = 往这里加一条 HeroDef(技能挂到任意
// GameMoment 时机,效果查 src/core/effects.ts 注册表;时机定义见 src/core/timing.ts)。
// 新时机/新效果才需要动 timing.ts / effects.ts,本文件永远只是纯数据。
import type { HeroDef } from "./types";

export const HEROES: HeroDef[] = [
  {
    id: "zhouyu",
    image: "/assets/heroes/hero-zhouyu-sgs.png",
    name: "周瑜",
    title: "雅量高致",
    desc: "你的移动步数始终 +1",
    skills: [{ id: "zhouyu-move+1", when: "BeforeMarch", effect: "moveBonus", params: { steps: 1 }, scope: "self" }],
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
    desc: "其他玩家被动失去银两时,你 +50 分银",
    skills: [{ id: "caopi-gain-on-other-lose", when: "CashLost", effect: "gainCash", params: { amount: 50 }, scope: "others" }],
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
    desc: "场上任意人掷出 6,你 +20 分银",
    skills: [{ id: "zhangxingcai-gain-on-six", when: "DieRolled", effect: "gainIfFace", params: { face: 6, amount: 20 }, scope: "any" }],
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
    skills: [{ id: "huatuo-regen-stamina", when: "RoundStart", effect: "regenStamina", params: { amount: 15 }, cooldown: 3, scope: "any" }],
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
