// 注入通道一「书满贯」(#1148 技能扩展数值校准,spec #1144 拆票 D/五):给指定座位
// 「灌满麾下全池技」——其招募入槽的名将一律授整池(无视 rollGrantedSkills 几何衰减,
// #969/ADR-0046),量化「授技衰减稀释了多少技能设计的冲击」。判据:对未注入对照批
// (sim-batch 同 seed 段)局长(中位轮数)与身价分布漂移 ≤10%。
//
// 注入面(scripts/ 测量通道,不进 src/、不改授技公式本体):onStep 钩子里扫本步事件批,
// 见目标座位的 heroRecruited 即把该麾下槽 skillIds 补齐为名将整池(heroById 查池,槽内
// lastFired 为空、与刚授技同形——补技时机=落槽同刻,语义等价「衰减未发生」)。四路送将
// (招贤城/机遇/锦囊/位满印书)里位满路印书不入槽、无 heroRecruited,天然不注入。
//
// 其余驱动与统计口径与 sim-batch.ts 全同(同 seed 段可直接对表);追加注入专线指标:
// 注入补技次数/补技总技数、目标座位胜率与终局身价,以及逐技击发(满池 vs 衰减对照)。
//
// 用法:bun scripts/sim-inject-fullpool.ts [局数=50] [起始seed=1000] [--seat <0-3>]
import { resolve } from "node:path";
import { loadExtensionPackages } from "../src/core/extension-loader";
import { ENCOUNTER_PRODUCT_DEFAULTS } from "../src/core/encounters";
import { heroById } from "../src/core/heroes";
import { driveToEnd } from "./whole-game";
import { netWorth } from "../src/core/networth";
import type { GameEvent } from "../src/core/game-events";
import type { GameEngine, SeatConfig } from "../src/core/authority";
import {
  autoSetup,
  builtinMapCatalog,
  createEngine,
  loadBuiltinMapById,
  type GameConfig,
} from "./engine-helpers";

await loadExtensionPackages(resolve(process.env.EXTENSIONS_DIR ?? "./extensions"));

function intValue(raw: string, label: string): number {
  if (!/^-?\d+$/.test(raw)) throw new Error(`${label} 必须为整数,收到:${raw}`);
  return parseInt(raw, 10);
}
const argv = process.argv.slice(2);
const positionals: string[] = [];
const flags = new Map<string, string>();
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith("--")) {
    const v = argv[i + 1];
    if (v === undefined || v.startsWith("--")) throw new Error(`旗标 ${a} 缺值`);
    flags.set(a.slice(2), v);
    i++;
  } else {
    positionals.push(a);
  }
}
const N = positionals.length > 0 ? intValue(positionals[0], "局数") : 50;
if (N <= 0) throw new Error(`局数必须为正整数,收到:${N}`);
const SEED0 = positionals.length > 1 ? intValue(positionals[1], "起始 seed") : 1000;
const mapId = flags.get("map") ?? builtinMapCatalog()[0].id;
const map = loadBuiltinMapById(mapId);
const TARGET_SEAT = flags.get("seat") !== undefined ? intValue(flags.get("seat")!, "--seat") : 0;
const TURN_CAP = 3000;

const seats: SeatConfig[] = Array.from({ length: 4 }, (_, i) => ({
  name: `诸侯 ${i + 1}`,
  isBot: true,
}));
function newEngine(seed: number) {
  const config: GameConfig = {
    seats,
    targetNetWorth: map.targetNetWorth,
    startingCash: map.startingCash,
    seed,
    mapId,
    encounter: ENCOUNTER_PRODUCT_DEFAULTS,
  };
  return createEngine(config, true, map);
}

/** 整池补技(#1148 书满贯注入):槽 skillIds 补齐为名将整池(池序为准,已授子集保留序)。 */
function topUpToFullPool(e: GameEngine, heroId: string): string[] {
  const pool = heroById(heroId).skillPool;
  const slot = e.players[TARGET_SEAT].heroes.find((h) => h.heroId === heroId);
  if (slot == null) throw new Error(`书满贯:目标座位 ${TARGET_SEAT} 无麾下槽 ${heroId}——注入失配`);
  const added = pool.filter((id) => !slot.skillIds.includes(id));
  slot.skillIds = pool.map((id) => id); // 池序为准整写(槽内序=池序契约,roster.ts)
  return added;
}

interface GameStat {
  seed: number;
  finished: boolean;
  rounds: number;
  winReason: string;
  netWorths: number[];
  winnerSeat: number | null;
  targetWon: boolean;
  targetNetWorth: number | null;
  bankrupts: number;
  topUps: number;
  topUpSkills: number;
  skillFires: Map<string, number>;
  targetFires: Map<string, number>;
  grants: Map<string, number>;
  builds: string[];
  econ: { bought: number; upgraded: number; traded: number };
}

function runOne(seed: number): GameStat {
  const e = newEngine(seed);
  autoSetup(e);
  const stat: GameStat = {
    seed,
    finished: false,
    rounds: 0,
    winReason: "None",
    netWorths: [],
    winnerSeat: null,
    targetWon: false,
    targetNetWorth: null,
    bankrupts: 0,
    topUps: 0,
    topUpSkills: 0,
    skillFires: new Map(),
    targetFires: new Map(),
    grants: new Map(),
    builds: [],
    econ: { bought: 0, upgraded: 0, traded: 0 },
  };
  const handle = (ev: GameEvent) => {
    if (ev.kind === "skillFired" || ev.kind === "heroSkillActivated") {
      stat.skillFires.set(ev.skillId, (stat.skillFires.get(ev.skillId) ?? 0) + 1);
      if (ev.seat === TARGET_SEAT)
        stat.targetFires.set(ev.skillId, (stat.targetFires.get(ev.skillId) ?? 0) + 1);
    } else if (ev.kind === "heroRecruited" && ev.seat === TARGET_SEAT) {
      const added = topUpToFullPool(e, ev.heroId); // 衰减未发生:整池入槽
      stat.topUps += 1;
      stat.topUpSkills += added.length;
      for (const sid of ev.skillIds) stat.grants.set(sid, (stat.grants.get(sid) ?? 0) + 1);
    } else if (ev.kind === "propertyBought") {
      stat.econ.bought += 1;
    } else if (ev.kind === "propertyUpgraded") {
      stat.econ.upgraded += 1;
    } else if (ev.kind === "treasureTraded") {
      stat.econ.traded += 1;
    }
  };
  const result = driveToEnd(e, {
    label: `fullpool seed ${seed}`,
    turnCap: TURN_CAP,
    hooks: {
      onStep: (events) => {
        for (const ev of events) handle(ev);
      },
    },
  });
  stat.finished = result.finished;
  stat.rounds = e.round;
  stat.winReason = e.winReason;
  stat.netWorths = e.players.map((p) => netWorth(p));
  stat.winnerSeat = e.winner ? e.players.indexOf(e.winner) : null;
  stat.targetWon = stat.winnerSeat === TARGET_SEAT;
  stat.targetNetWorth = stat.netWorths[TARGET_SEAT] ?? null;
  stat.bankrupts = e.players.filter((p) => p.isBankrupt).length;
  stat.builds = e.players.map(
    (p) =>
      p.heroes
        .flatMap((h) => h.skillIds)
        .sort()
        .join("+") || "空",
  );
  return stat;
}

const stats: GameStat[] = [];
const crashed: { seed: number; err: string }[] = [];
for (let i = 0; i < N; i++) {
  const seed = SEED0 + i;
  try {
    const s = runOne(seed);
    stats.push(s);
    console.error(
      `[${i + 1}/${N}] seed=${seed} ${s.finished ? `终局 ${s.rounds} 轮(${s.winReason})` : "未终局(触回合上限)"}`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    crashed.push({ seed, err: msg });
    console.error(`[${i + 1}/${N}] seed=${seed} 崩溃:${msg}`);
  }
}

const asc = (arr: number[]) => [...arr].sort((a, b) => a - b);
const q = (arr: number[], p: number) => arr[Math.floor(p * (arr.length - 1))];
const num = (v: number) => v.toLocaleString("en-US");
const REASON_ZH: Record<string, string> = {
  TargetNetWorth: "身价达标",
  LastStanding: "群雄尽灭",
  None: "无",
  aborted: "异常作废",
};

console.log(`═══ sim-inject-fullpool(书满贯):${N} 局 · 注入座位 ${TARGET_SEAT} 满池授技 ═══`);
console.log(`地图:${mapId} · 种子:${SEED0}–${SEED0 + N - 1}(对照批 = sim-batch 同段)`);
const fin = stats.filter((s) => s.finished);
console.log(`终局率:${fin.length}/${N}`);
if (fin.length > 0) {
  const rounds = asc(fin.map((s) => s.rounds));
  console.log(
    `回合数(轮):中位 ${q(rounds, 0.5)} / p90 ${q(rounds, 0.9)} / min ${rounds[0]} / max ${rounds[rounds.length - 1]}`,
  );
  const byReason = new Map<string, number>();
  for (const s of fin) byReason.set(s.winReason, (byReason.get(s.winReason) ?? 0) + 1);
  console.log(
    `终局方式:${[...byReason.entries()].map(([r, n]) => `${REASON_ZH[r] ?? r} ×${n}`).join(" · ")}`,
  );
  const allNW = asc(fin.flatMap((s) => s.netWorths));
  console.log(
    `最终身价(终局局 · 全座位):中位 ${num(q(allNW, 0.5))} / p90 ${num(q(allNW, 0.9))} / min ${num(allNW[0])} / max ${num(allNW[allNW.length - 1])}`,
  );
  const targetNW = asc(fin.map((s) => s.targetNetWorth!));
  const wins = fin.filter((s) => s.targetWon).length;
  console.log(
    `注入座位:胜率 ${wins}/${fin.length} · 终局身价中位 ${num(q(targetNW, 0.5))} / min ${num(targetNW[0])} / max ${num(targetNW[targetNW.length - 1])}`,
  );
  const bankrupts = fin.reduce((a, s) => a + s.bankrupts, 0);
  console.log(`破产人次:${bankrupts}(局均 ${(bankrupts / fin.length).toFixed(2)})`);
}
const topUps = stats.reduce((a, s) => a + s.topUps, 0);
const topUpSkills = stats.reduce((a, s) => a + s.topUpSkills, 0);
const grantSum = stats.reduce((a, s) => a + [...s.grants.values()].reduce((x, y) => x + y, 0), 0);
console.log(
  `注入量:招募入槽 ${topUps} 次 · 补技 ${topUpSkills} 技(局均 ${(topUpSkills / N).toFixed(1)}) · 自然授技 ${grantSum} 枚`,
);
const boughtTotal = stats.reduce((a, s) => a + s.econ.bought, 0);
const upgradedTotal = stats.reduce((a, s) => a + s.econ.upgraded, 0);
const tradedTotal = stats.reduce((a, s) => a + s.econ.traded, 0);
console.log(
  `经济动作(局均):购城 ${(boughtTotal / N).toFixed(1)} · 升级 ${(upgradedTotal / N).toFixed(1)} · 珍宝成交 ${(tradedTotal / N).toFixed(1)}`,
);
const fireAgg = new Map<string, number>();
for (const s of stats)
  for (const [id, n] of s.skillFires) fireAgg.set(id, (fireAgg.get(id) ?? 0) + n);
const targetAgg = new Map<string, number>();
for (const s of stats)
  for (const [id, n] of s.targetFires) targetAgg.set(id, (targetAgg.get(id) ?? 0) + n);
console.log(`注入座位逐技击发(满池持有视角;全表逐技):`);
const rows = [...fireAgg.entries()].sort(
  (a, b) => (targetAgg.get(b[0]) ?? 0) - (targetAgg.get(a[0]) ?? 0),
);
for (const [id, n] of rows) {
  const t = targetAgg.get(id) ?? 0;
  if (t > 0)
    console.log(
      `  ${id.padEnd(14)} 注入座发 ${String(t).padStart(5)}(全场 ${String(n).padStart(5)})`,
    );
}
const buildAgg = new Map<string, number>();
for (const s of stats) for (const b of s.builds) buildAgg.set(b, (buildAgg.get(b) ?? 0) + 1);
console.log(`终局构筑:${buildAgg.size} 种 / ${N * 4} 席`);
if (crashed.length > 0) {
  console.log(`\n═══ 崩溃 ${crashed.length} 局 ═══`);
  for (const c of crashed) console.log(`  seed ${c.seed}:${c.err}`);
  process.exit(1);
}
