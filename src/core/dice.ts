// 骰子:可注入随机种子以便测试。单骰 1–6。
import type { DiceRoll } from "./types";

/** mulberry32:快速可种子化 PRNG。返回 next + 状态读写(供序列化跨进程续掷)。 */
export function mulberry32(seed: number): {
  next: () => number;
  getState: () => number;
  setState: (a: number) => void;
} {
  let a = seed >>> 0;
  function next(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  return {
    next,
    getState: () => a >>> 0,
    setState: (v: number) => {
      a = v >>> 0;
    },
  };
}

export interface Dice {
  roll(): DiceRoll;
  /** 返回 1–6,供掷骰定序/拼点复用。 */
  rollDie(): number;
  nextFloat(): number;
  /** 当前 PRNG 内部状态(供 CLI/联机跨进程续掷)。 */
  getRngState(): number;
  /** 恢复 PRNG 状态(从序列化数据还原)。 */
  setRngState(a: number): void;
}

export function createDice(seed?: number): Dice {
  const rng = mulberry32(seed ?? Math.floor(Math.random() * 0xffffffff));
  const rollDie = (): number => 1 + Math.floor(rng.next() * 6);
  return {
    roll(): DiceRoll {
      return { die: rollDie() };
    },
    rollDie,
    nextFloat: rng.next,
    getRngState: rng.getState,
    setRngState: rng.setState,
  };
}
