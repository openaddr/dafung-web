// 名士(英雄)池:技能即数据(时机框架)。新增名士 = 往这里加一条 HeroDef(技能挂到任意
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
  },
  {
    id: "caopi",
    image: "/assets/heroes/hero-caopi-sgs.png",
    name: "曹丕",
    title: "承继大统",
    desc: "其他玩家被动失去银两时,你 +50 分银",
    skills: [{ id: "caopi-gain-on-other-lose", when: "CashLost", effect: "gainCash", params: { amount: 50 }, scope: "others" }],
  },
  {
    id: "zhangxingcai",
    image: "/assets/heroes/hero-zhangxingcai-sgs.png",
    name: "张星彩",
    title: "银翎飞骑",
    desc: "场上任意人掷出 6,你 +20 分银",
    skills: [{ id: "zhangxingcai-gain-on-six", when: "DieRolled", effect: "gainIfFace", params: { face: 6, amount: 20 }, scope: "any" }],
  },
];
