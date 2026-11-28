// 骰子:可注入随机种子以便测试。单骰 1–面数(面数参数化,#1390):缺省六面;持英姿者
// 七面——面数唯一单源 = skills.ts `heroDieFaces`(持有状态从麾下槽位已授技推导),
// 掷骰调用方显式传参,本文件不查技能(叶子模块零反向依赖)。钉骰契约(planter.ts
// pinDice):钉值 > 本次掷骰面数 = 消费点响亮炸点名(7 仅持英姿可达)。

/** 缺省骰面数（六面）。 */
export const DEFAULT_DIE_FACES = 6;

/** 单骰掷骰结果(移动步数 = die)。 */
export interface DiceRoll {
  die: number; // 1–面数(单骰;移动步数 = die)
}

/** mulberry32:快速可种子化 PRNG。返回 next + 状态读写(供序列化跨进程续掷)。 */
function mulberry32(seed: number): {
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
  /** 掷骰:faces 缺省 = DEFAULT_DIE_FACES(六面);掷骰调用方按 skills.heroDieFaces
   *  显式传参(持英姿者 7,#1390)。 */
  roll(faces?: number): DiceRoll;
  /** 返回 1–面数，供拼点等单骰结算复用（faces 语义同 roll）。 */
  rollDie(faces?: number): number;
  nextFloat(): number;
  /** 当前 PRNG 内部状态(供 CLI/联机跨进程续掷)。 */
  getRngState(): number;
  /** 恢复 PRNG 状态(从序列化数据还原)。 */
  setRngState(a: number): void;
}

export function createDice(seed?: number): Dice {
  const rng = mulberry32(seed ?? Math.floor(Math.random() * 0xffffffff));
  const rollDie = (faces = DEFAULT_DIE_FACES): number => 1 + Math.floor(rng.next() * faces);
  return {
    roll(faces?: number): DiceRoll {
      return { die: rollDie(faces) };
    },
    rollDie,
    nextFloat: rng.next,
    getRngState: rng.getState,
    setRngState: rng.setState,
  };
}

export type DiceChannel = "march" | "duel";

const pinnedRolls = new WeakMap<Dice, Record<DiceChannel, number[]>>();

function readPinnedDie(queue: number[], channel: DiceChannel, faces = DEFAULT_DIE_FACES) {
  const value = queue.shift();
  if (value !== undefined && value > faces) {
    throw new Error(
      `pinDice:钉值 ${value} 超本次掷骰面数 ${faces}(${channel} 通道，面数由技能决定)`,
    );
  }
  return value;
}

/** 种植件专用。钉骰不消耗种子流，行程与拼点各用自己的队列。 */
export function pinDiceValues(dice: Dice, channel: DiceChannel, values: readonly number[]): void {
  if (values.length === 0) throw new Error("pinDice:空值队列(至少钉一个骰值)");
  for (const value of values) {
    if (!Number.isInteger(value) || value < 1 || value > DEFAULT_DIE_FACES + 1) {
      throw new Error(`pinDice:骰值 ${value} 出 1..${DEFAULT_DIE_FACES + 1} 契约`);
    }
  }
  let queues = pinnedRolls.get(dice);
  if (queues === undefined) {
    const pins: Record<DiceChannel, number[]> = { march: [], duel: [] };
    const roll = dice.roll.bind(dice);
    const rollDie = dice.rollDie.bind(dice);
    dice.roll = (faces) => {
      const value = readPinnedDie(pins.march, "march", faces);
      return value === undefined ? roll(faces) : { die: value };
    };
    dice.rollDie = (faces) => {
      const value = readPinnedDie(pins.duel, "duel", faces);
      return value === undefined ? rollDie(faces) : value;
    };
    pinnedRolls.set(dice, pins);
    queues = pins;
  }
  queues[channel] = [...values, ...queues[channel]];
}

/** 草稿裁决可恢复钉骰队列。生产骰只需按快照恢复种子。 */
export function checkpointDicePins(dice: Dice): (() => void) | undefined {
  const queues = pinnedRolls.get(dice);
  if (queues === undefined) return undefined;
  const march = [...queues.march];
  const duel = [...queues.duel];
  return () => {
    queues.march = [...march];
    queues.duel = [...duel];
  };
}

/** Fisher-Yates 洗牌(rng 注入,确定性,返回打乱副本):开局分配国号与排列选都顺序
 *  (setup-flow)/招贤候选序(recruitment)/授技子集抽取(roster.rollGrantedSkills)
 *  共用单源。放骰子域:消费方(roster)与其上游(锦囊域)有环,叶子模块承接共用件。 */
export function shuffle<T>(arr: readonly T[], rng: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
