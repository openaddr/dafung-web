// 名士(英雄)池:数据驱动。新增名士 = 往这里加一条 HeroDef(技能 kind 若是新的,
// 还需在 types.HeroSkill 加该 kind + game.ts 对应时机接一处派发)。
import type { HeroDef } from "./types";

export const HEROES: HeroDef[] = [
  {
    id: "zhouyu",
    name: "周瑜",
    title: "雅量高致",
    desc: "你的移动步数始终 +1",
    skill: { kind: "moveBonus", steps: 1 },
  },
  {
    id: "caopi",
    name: "曹丕",
    title: "承继大统",
    desc: "其他玩家被动失去银两时,你 +50 分银",
    skill: { kind: "onOtherLoseCash", gain: 50 },
  },
  {
    id: "zhangxingcai",
    name: "张星彩",
    title: "银翎飞骑",
    desc: "场上任意人掷出 6,你 +20 分银",
    skill: { kind: "onAnyRoll", face: 6, gain: 20 },
  },
];
