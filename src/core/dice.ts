// 骰子:可注入随机种子以便测试。单骰 1–6。对应 C# 版 Dice.cs(IDice)。
import type { DiceRoll } from "./types";

/** mulberry32:快速可种子化 PRNG。 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Dice {
  roll(): DiceRoll;
  /** CoinFlip 用:返回 1–6,>=4 视为胜(便于调参)。 */
  rollDie(): number;
  nextFloat(): number;
}

export function createDice(seed?: number): Dice {
  const rng = mulberry32(seed ?? Math.floor(Math.random() * 0xffffffff));
  const rollDie = (): number => 1 + Math.floor(rng() * 6);
  return {
    roll(): DiceRoll {
      return { die: rollDie() };
    },
    rollDie,
    nextFloat: rng,
  };
}
