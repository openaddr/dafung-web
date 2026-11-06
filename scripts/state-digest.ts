// 状态摘要(#1161 无头确定性体系):引擎逐回合状态的稳定指纹 + 可读摘要记录。
// 学自 vera20k src/sim/parity_digest.rs:逐帧摘要是「 lined up 逐项对齐、首个分歧
// 定位到点」的原料;哈希迭代序必须是确定性序(vera20k 用 stable-id 序,本仓用
// SNAPSHOT_FIELDS 表序 + 键排序规范化,同一效果);故意排除字段必须记名记理由
// (vera20k 排除 elevation——折入必产「无意义失配」,本仓同理排除 gameId/log)。
// 摘要定义冻结(任务总则):本文件即摘要口径单源;任何漂移走「确认 → 评审 →
// update 台账」,不许静默改字段。消费者:whole-game.ts(驱动器)、check:goldens(票二)。
// 本模块零 DOM 零时钟;Bun.CryptoHasher 仅在 bun 运行时可用(scripts/ 不进浏览器包)。
import type { GameEngine } from "../src/core/authority";
import type { GameEvent } from "../src/core/game-events";
import { SNAPSHOT_FIELDS } from "../src/core/snapshot";

/** 摘要哈希排除字段(记名记理由,vera20k elevation 条款同构):
 *  - gameId:实例身份非引擎内容(时间戳+随机后缀,日志文件名/IndexedDB key 的唯一性
 *    契约要求实例唯一);种子化其生成会让同 seed 房间撞名,故生成不动、摘要排除
 *    (快照往返不受影响——restoreFromSnapshot 原样回灌,续跑继承同一 id)。
 *  - log / logCount:完整战报随回合线性增长,整表哈希 = O(n²);内容是「命令+种子」
 *    的派生记录,漂移由 TurnDigest.logHash 链式增量折入兜住(每回合只哈希新增行),
 *    覆盖不丢、代价 O(n)。 */
const HASH_EXCLUDED: ReadonlySet<string> = new Set(["gameId", "log", "logCount"]);

/** 键排序稳定序列化:对象键递归排序,数组保序(数组序 = 语义序,不是遍历意外)。
 *  undefined 值跳过(与 JSON.stringify 语义一致)。同构状态无论键以何序插入,产出恒等。 */
export function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(src).sort()) {
      if (src[k] !== undefined) out[k] = canonicalize(src[k]);
    }
    return out;
  }
  return value;
}

/** 规范化 JSON 的 sha256(hex)。摘要的「同状态必同哈希」由此单点保证。 */
export function hashCanonical(value: unknown): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(JSON.stringify(canonicalize(value)));
  return hasher.digest("hex");
}

/** 链式战报哈希:折入上一链值 + 本批新增战报行(内容剥离,见下)。续跑端以边界摘要的
 *  {logHash, logCount} 作链种子续折,与对照跑逐位一致。
 *  剥离两处非「发生什么」的字段(vera20k elevation 排除条款同构:折入必产跨跑无意义
 *  失配;其余六键 round/turn/player/brief/detail/category 全折入,内容漂移照抓):
 *  - 每行 ts(墙钟出生时间,epoch ms @ Date.now)——「何时发生」非引擎内容;
 *  - header 类行整行——局头 detail 内嵌 gameId(实例身份)与 startedAt(墙钟),
 *    且局头全是重放要素(=语料定义本身,已由 stateHash 的对应字段钉住)。 */
export function chainLogHash(prevHash: string, newLines: unknown[]): string {
  const content = newLines
    .filter((line) => (line as Record<string, unknown>).category !== "header")
    .map((line) => {
      const { ts: _ts, ...rest } = line as Record<string, unknown>;
      return rest;
    });
  return hashCanonical({ prev: prevHash, lines: content });
}

/** 逐回合摘要记录(回合边界产出一笔)。字段即摘要定义(冻结,见文件头):
 *  可读概要(定位漂移用)+ stateHash(状态指纹)+ events(本回合事件批)。 */
export interface TurnDigest {
  /** 边界时刻引擎的轮次/回合号(状态本位:边界已步入下一回合)。 */
  round: number;
  turn: number;
  phase: string;
  turnPhase: string;
  activeIndex: number;
  isOver: boolean;
  /** 骰流游标(vera20k rng_index 条款:RNG 光标入摘要——可观测状态碰巧一致而
   *  掷骰次数分叉的漂移,只有游标抓得住)。 */
  rngState: number;
  /** 链式战报哈希(折入至本边界止的全部 log 行)。 */
  logHash: string;
  logCount: number;
  /** 状态指纹:SNAPSHOT_FIELDS 全量(除 HASH_EXCLUDED)+ 本回合事件批,规范化 sha256。 */
  stateHash: string;
  /** 本回合事件批(边界前累计的全部转移批,批界口径 #375)。 */
  events: GameEvent[];
}

/** 在回合边界处对引擎取摘要。turnEvents = 本回合累计事件批(驱动器负责归集);
 *  logChain = 链式战报哈希的上一环 {hash, count}(首环传 {hash: "", count: 0})。 */
export function turnDigestOf(
  e: GameEngine,
  turnEvents: GameEvent[],
  logChain: { hash: string; count: number },
): TurnDigest {
  const state: Record<string, unknown> = {};
  for (const f of SNAPSHOT_FIELDS) {
    if (HASH_EXCLUDED.has(f.key)) continue;
    state[f.key] = f.read(e);
  }
  const newLines = e.log.slice(logChain.count);
  return {
    round: e.round,
    turn: e.turnNumber,
    phase: e.phase,
    turnPhase: e.turnPhase,
    activeIndex: e.activeIndex,
    isOver: e.isOver,
    rngState: e.dice.getRngState(),
    logHash: chainLogHash(logChain.hash, newLines),
    logCount: e.log.length,
    stateHash: hashCanonical({ state, events: turnEvents }),
    events: turnEvents,
  };
}
