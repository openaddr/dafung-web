// bot 自对弈批量模拟:一条命令跑 N 局全 bot 对局,stdout 输出统计分布
// (#1104 机遇扩容平衡验证回路;前身为失修的 tmp/sim-batch.ts,安家 scripts/——
// 模拟工具不进浏览器包,tmp/ 不纳管)。
//
// 用法:bun scripts/sim-batch.ts [局数=50] [起始seed=1000] [--map <id>] [--seats <2-4>] [--no-encounter]
//
// 配置口径(全部取当前 master 真实配置,零硬编码兜底):
//   地图 = --map 显式给定;缺省 = 内置清单 maps/index.json 首项(与 cli.ts 同口径,清单空当场抛)。
//   机遇 = 产品默认开关 ENCOUNTER_PRODUCT_DEFAULTS(core 单源,同 cli/单机;ADR-0035 必出);
//          --no-encounter 关机遇跑 A/B 对照档。
//   起手现金/目标身价 = 地图顶层必配值(ADR-0041:引擎无缺省,loadMap 校验)。
//   扩展包 = 与 cli/server 同口径装载 ./extensions(真实对局含扩展名将,名将池不残缺)。
//
// 驱动与观测:整局循环单源在 whole-game.ts driveToEnd(#1161 收敛;botAct 裸调仍是
// bot 行为单源 #580);本脚本经 onStep 钩子逐步读引擎事件批(批界 = botAct 入口,#375)。
// 机遇档位/条目/抉择全是引擎种子化骰流的产出(档位走 #1090 声望 softmax),本脚本
// 不另起任何随机源——同 seed 恒同局,统计可复现。
//
// 统计口径:
//   对局面 = 终局率 / 回合数(轮)分布 / 终局方式 / 最终身价分布 / 破产人次;
//   机遇侧 = 触发合计 / 各档出现次数 / 逐条目出现分布(全目录含 0 次条目)/ 抉择选项选择分布;
//   技能侧(#1119 技能扩展地图)= 授技分布(全表含 0 次,授 0=池饿死)/ 击发统计(被动+主动+每授击发率)/ 终局构筑多样性;
//   经济动作计数(#1121 数值校准分母)= 购城/升级/珍宝成交 局均频率。
//   扩容验收用法:改 ENCOUNTERS 前后各跑一批对比,0 次条目与 0 次选项即死数据;逐局进度走 stderr。
//
// 退出码:引擎抛错 = 发现 bug,逐 seed 报告且进程非零;回合上限未终局 = 平衡发现
// (响亮上报,不算工具故障)。两者都看「终局率」行。
import { resolve } from "node:path";
import { loadExtensionPackages } from "../src/core/extension-loader";
import { ENCOUNTER_PRODUCT_DEFAULTS, ENCOUNTERS, type EncounterTier } from "../src/core/encounters";
import { SKILLS, isTriggerSkill } from "../src/core/skills";
import { driveToEnd } from "./whole-game";
import { netWorth } from "../src/core/networth";
import { formatMoney } from "../src/core/money";
import type { SeatConfig } from "../src/core/authority";
import {
  autoSetup,
  builtinMapCatalog,
  createEngine,
  loadBuiltinMapById,
  type GameConfig,
} from "./engine-helpers";

// 扩展包装载(#412,与 cli.ts/server.ts 同口径):坏包当场炸;空目录 = 合法零包。
await loadExtensionPackages(resolve(process.env.EXTENSIONS_DIR ?? "./extensions"));

// ── 参数(严格解析:非法当场抛,零兜底)──
function intValue(raw: string, label: string): number {
  if (!/^-?\d+$/.test(raw)) throw new Error(`${label} 必须为整数,收到:${raw}`);
  return parseInt(raw, 10);
}
const argv = process.argv.slice(2);
const positionals: string[] = [];
const flags = new Map<string, string>();
/** 布尔旗标(在场即真,不取值);其余 --flag 必须带值,缺值当场抛。 */
const BOOLEAN_FLAGS = new Set(["no-encounter"]);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith("--")) {
    const key = a.slice(2);
    if (BOOLEAN_FLAGS.has(key)) {
      flags.set(key, "true");
      continue;
    }
    const v = argv[i + 1];
    if (v === undefined || v.startsWith("--")) throw new Error(`旗标 ${a} 缺值`);
    flags.set(key, v);
    i++;
  } else {
    positionals.push(a);
  }
}
const N = positionals.length > 0 ? intValue(positionals[0], "局数") : 50;
if (N <= 0) throw new Error(`局数必须为正整数,收到:${N}`);
const SEED0 = positionals.length > 1 ? intValue(positionals[1], "起始 seed") : 1000;
// 地图:--map 显式给定,缺省 = 清单首项(清单空/格式坏由 parseCatalog 当场抛,零兜底)
const mapId = flags.get("map") ?? builtinMapCatalog()[0].id;
const map = loadBuiltinMapById(mapId);
const seatsRaw = flags.get("seats");
const SEATS_N = seatsRaw !== undefined ? intValue(seatsRaw, "--seats") : 4;
if (!(SEATS_N >= 2 && SEATS_N <= 4))
  throw new Error(`--seats 必须 2-4(国号池四家),收到:${SEATS_N}`);
const ENCOUNTER_ON = !flags.has("no-encounter");

/** 回合上限(单玩家回合数;4 席 ≈ 750 轮):防永动局的测量口径,触顶 = 未终局,响亮上报。 */
const TURN_CAP = 3000;

// ── 座位与构造参数(全 bot;guohao 留空由 doDraftRoll 从字池分配,与 cli new 同口径)──
const seats: SeatConfig[] = Array.from({ length: SEATS_N }, (_, i) => ({
  name: `诸侯 ${i + 1}`,
  isBot: true,
}));
function newEngine(seed: number) {
  const config: GameConfig = {
    seats,
    targetNetWorth: map.targetNetWorth,
    startingCash: map.startingCash,
    startingTreasures: map.startingTreasures,
    seed,
    mapId,
    encounter: ENCOUNTER_ON ? ENCOUNTER_PRODUCT_DEFAULTS : { enabled: false },
  };
  return createEngine(config, true, map);
}

// ── 单局统计载体 ──
interface GameStat {
  seed: number;
  finished: boolean;
  rounds: number;
  winReason: string;
  /** 全座位终局身价(下标 = 座位)。 */
  netWorths: number[];
  /** 胜者终局身价(未终局 = null)。 */
  winnerNetWorth: number | null;
  bankrupts: number;
  tiers: Record<EncounterTier, number>;
  /** 机遇条目 id → 触发次数。 */
  entries: Map<string, number>;
  /** `${encounterId}#${choiceIndex}` → 选择次数。 */
  choices: Map<string, number>;
  /** skillId → 被动技击发次数。 */
  skillFires: Map<string, number>;
  /** skillId → 主动技发动次数。 */
  activeFires: Map<string, number>;
  /** skillId → 授技(招募入槽)次数。 */
  grants: Map<string, number>;
  /** 招募人次(授技分母)。 */
  recruits: number;
  /** 终局全座位构筑(麾下技能多重集排序拼接;无麾下=「空」)。 */
  builds: string[];
  /** 经济动作计数(#1121 频率校准分母)。 */
  econ: { bought: number; upgraded: number; traded: number };
}

/** 跑一局到终局(或回合上限)。引擎抛错原样上抛 = 发现 bug,由批循环逐 seed 收账;
 *  相位守卫/无进展/僵死巡检在 driveToEnd 内(整局循环单源,#1161)。 */
function runOne(seed: number): GameStat {
  const e = newEngine(seed);
  autoSetup(e);
  const stat: GameStat = {
    seed,
    finished: false,
    rounds: 0,
    winReason: "None",
    netWorths: [],
    winnerNetWorth: null,
    bankrupts: 0,
    tiers: { 好运: 0, 中性: 0, 霉运: 0 },
    entries: new Map(),
    choices: new Map(),
    skillFires: new Map(),
    activeFires: new Map(),
    grants: new Map(),
    recruits: 0,
    builds: [],
    econ: { bought: 0, upgraded: 0, traded: 0 },
  };
  const result = driveToEnd(e, {
    label: `seed ${seed}`,
    turnCap: TURN_CAP,
    hooks: {
      // 本步事件批(批界 = botAct 入口,#375):机遇触发/抉择在此,typed 读取零正则
      onStep: (events) => {
        for (const ev of events) {
          if (ev.kind === "encounterTriggered") {
            stat.tiers[ev.tier] += 1;
            stat.entries.set(ev.encounterId, (stat.entries.get(ev.encounterId) ?? 0) + 1);
          } else if (ev.kind === "encounterChoice") {
            const k = `${ev.encounterId}#${ev.choiceIndex}`;
            stat.choices.set(k, (stat.choices.get(k) ?? 0) + 1);
          } else if (ev.kind === "skillFired") {
            stat.skillFires.set(ev.skillId, (stat.skillFires.get(ev.skillId) ?? 0) + 1);
          } else if (ev.kind === "heroSkillActivated") {
            stat.activeFires.set(ev.skillId, (stat.activeFires.get(ev.skillId) ?? 0) + 1);
          } else if (ev.kind === "heroRecruited") {
            stat.recruits += 1;
            for (const sid of ev.skillIds) stat.grants.set(sid, (stat.grants.get(sid) ?? 0) + 1);
          } else if (ev.kind === "propertyBought") {
            stat.econ.bought += 1;
          } else if (ev.kind === "propertyUpgraded") {
            stat.econ.upgraded += 1;
          } else if (ev.kind === "treasureTraded") {
            stat.econ.traded += 1;
          }
        }
      },
    },
  });
  stat.finished = result.finished;
  stat.rounds = e.round;
  stat.winReason = e.winReason;
  stat.netWorths = e.players.map((p) => netWorth(p));
  stat.winnerNetWorth = e.winner ? netWorth(e.winner) : null;
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

// ── 跑批 ──
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
    const msg = err instanceof Error ? err.message : String(err); // 显式报错:逐 seed 收账,不吞
    crashed.push({ seed, err: msg });
    console.error(`[${i + 1}/${N}] seed=${seed} 崩溃:${msg}`);
  }
}

// ── 汇总 ──
const REASON_ZH: Record<string, string> = {
  TargetNetWorth: "身价达标",
  LastStanding: "群雄尽灭",
  None: "无",
  aborted: "异常作废",
};
const fin = stats.filter((s) => s.finished);
const unfin = stats.filter((s) => !s.finished);
const asc = (arr: number[]) => [...arr].sort((a, b) => a - b);
const q = (arr: number[], p: number) => arr[Math.floor(p * (arr.length - 1))];
const avg = (arr: number[]) => (arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
const num = (v: number) => v.toLocaleString("en-US");

console.log(`═══ sim-batch:${N} 局全 bot 自对弈 ═══`);
const mapEntry = builtinMapCatalog().find((e) => e.id === mapId);
console.log(
  `地图:${mapEntry ? mapEntry.name : mapId}(共 ${map.board.count} 格) 目标身价 ${formatMoney(map.targetNetWorth)} 起手 ${formatMoney(map.startingCash)}`,
);
console.log(
  `机遇:${ENCOUNTER_ON ? "开(产品默认)" : "关(--no-encounter 对照)"} · 座位:${SEATS_N} bot · 种子:${SEED0}–${SEED0 + N - 1}`,
);

// ── 对局面 ──
console.log(`\n── 对局面 ──`);
console.log(`终局率:${fin.length}/${N}(未终局 = ${TURN_CAP} 回合上限仍未分胜负)`);
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
  const winnerNW = asc(fin.map((s) => s.winnerNetWorth).filter((v): v is number => v != null));
  console.log(
    `最终身价(终局局 · 全座位):中位 ${num(q(allNW, 0.5))} / p90 ${num(q(allNW, 0.9))} / min ${num(allNW[0])} / max ${num(allNW[allNW.length - 1])}`,
  );
  console.log(
    `胜者身价:中位 ${num(q(winnerNW, 0.5))} / min ${num(winnerNW[0])} / max ${num(winnerNW[winnerNW.length - 1])}(目标 ${num(map.targetNetWorth)})`,
  );
  const bankrupts = fin.reduce((a, s) => a + s.bankrupts, 0);
  console.log(`破产人次:${bankrupts}(局均 ${avg(fin.map((s) => s.bankrupts)).toFixed(2)})`);
}
if (unfin.length > 0)
  console.log(`未终局 seeds:${unfin.map((s) => s.seed).join(", ")}(平衡发现:扩容后局变慢看这里)`);

// ── 机遇侧(本票核心交付)──
console.log(`\n── 机遇侧 ──`);
if (!ENCOUNTER_ON) {
  console.log("机遇关(--no-encounter 对照档):无机遇统计。");
} else {
  const total = stats.reduce((a, s) => a + s.tiers.好运 + s.tiers.中性 + s.tiers.霉运, 0);
  const tierOf = (t: EncounterTier) => stats.reduce((a, s) => a + s.tiers[t], 0);
  console.log(
    `触发合计:${total} 次(局均 ${avg(stats.map((s) => s.tiers.好运 + s.tiers.中性 + s.tiers.霉运)).toFixed(1)})`,
  );
  if (total > 0) {
    const tierLine = (["好运", "中性", "霉运"] as EncounterTier[])
      .map((t) => `${t} ${tierOf(t)}(${((tierOf(t) / total) * 100).toFixed(1)}%)`)
      .join(" · ");
    console.log(`档位分布:${tierLine}`);
  }
  // 逐条目分布:全目录逐一列出(0 次条目 = 死数据,扩容验收的直接信号)
  const entryAgg = new Map<string, number>();
  for (const s of stats)
    for (const [id, n] of s.entries) entryAgg.set(id, (entryAgg.get(id) ?? 0) + n);
  console.log(`条目分布(次数 · 局均;全目录 ${ENCOUNTERS.length} 条含 0 次):`);
  const entryRows = ENCOUNTERS.map((d) => ({
    id: d.id,
    tier: d.tier,
    n: entryAgg.get(d.id) ?? 0,
  })).sort((a, b) => b.n - a.n || a.id.localeCompare(b.id));
  for (const r of entryRows)
    console.log(
      `  [${r.tier}] ${r.id.padEnd(6)} ${String(r.n).padStart(5)}  局均 ${(r.n / N).toFixed(2)}`,
    );
  // 抉择选项分布:全部抉择条目 × 全部选项(0 次选项 = 没人选的摆设选项)
  const choiceAgg = new Map<string, number>();
  for (const s of stats)
    for (const [k, n] of s.choices) choiceAgg.set(k, (choiceAgg.get(k) ?? 0) + n);
  const choiceDefs = ENCOUNTERS.flatMap((d) =>
    d.choices != null ? [{ id: d.id, choices: d.choices }] : [],
  );
  console.log(`抉择选项分布(条目 ${choiceDefs.length} 条 · 选项 · 次数):`);
  for (const d of choiceDefs) {
    for (let i = 0; i < d.choices.length; i++) {
      const n = choiceAgg.get(`${d.id}#${i}`) ?? 0;
      const solo = d.choices.length === 1 ? "(唯一选项,引擎自动执行)" : "";
      console.log(`  ${d.id}[${i}] ${d.choices[i].text} ×${n}${solo}`);
    }
  }
}

// ── 技能侧(#1119 技能扩展地图指标)──
console.log(`\n── 技能侧 ──`);
const fireAgg = new Map<string, number>();
const activeAgg = new Map<string, number>();
const grantAgg = new Map<string, number>();
let recruitTotal = 0;
for (const s of stats) {
  for (const [id, n] of s.skillFires) fireAgg.set(id, (fireAgg.get(id) ?? 0) + n);
  for (const [id, n] of s.activeFires) activeAgg.set(id, (activeAgg.get(id) ?? 0) + n);
  for (const [id, n] of s.grants) grantAgg.set(id, (grantAgg.get(id) ?? 0) + n);
  recruitTotal += s.recruits;
}
const grantSum = [...grantAgg.values()].reduce((a, b) => a + b, 0);
console.log(`招募 ${recruitTotal} 人次 · 授技 ${grantSum} 枚(局均 ${(grantSum / N).toFixed(1)})`);
const boughtTotal = stats.reduce((a, s) => a + s.econ.bought, 0);
const upgradedTotal = stats.reduce((a, s) => a + s.econ.upgraded, 0);
const tradedTotal = stats.reduce((a, s) => a + s.econ.traded, 0);
console.log(
  `经济动作(局均,频率校准分母):购城 ${(boughtTotal / N).toFixed(1)} · 升级 ${(upgradedTotal / N).toFixed(1)} · 珍宝成交 ${(tradedTotal / N).toFixed(1)}`,
);
const skillRows = SKILLS.map((d) => {
  const g = grantAgg.get(d.id) ?? 0;
  const f = fireAgg.get(d.id) ?? 0;
  const a = activeAgg.get(d.id) ?? 0;
  return {
    id: d.id,
    name: d.name,
    isPassive: isTriggerSkill(d),
    g,
    f: f + a,
    per: g > 0 ? (f + a) / g : 0,
  };
}).sort((x, y) => y.g - x.g || y.f - x.f || x.id.localeCompare(y.id));
console.log(`授技与击发(全表 ${SKILLS.length} 条含 0 次;授 0=池饿死信号 · 授多发 0=摆设技):`);
for (const r of skillRows)
  console.log(
    `  [${r.isPassive ? "被动" : "主动"}] ${r.id.padEnd(12)} ${r.name} 授 ${String(r.g).padStart(4)} · 发 ${String(r.f).padStart(5)} · 每授 ${r.per.toFixed(2)}`,
  );
const buildAgg = new Map<string, number>();
for (const s of stats) for (const b of s.builds) buildAgg.set(b, (buildAgg.get(b) ?? 0) + 1);
const buildInstances = [...buildAgg.values()].reduce((a, b) => a + b, 0);
const topBuild = [...buildAgg.entries()].sort((a, b) => b[1] - a[1])[0] ?? ["—", 0];
console.log(
  `终局构筑: ${buildAgg.size} 种 / ${buildInstances} 席 · 众数「${topBuild[0]}」×${topBuild[1]}(${((topBuild[1] / Math.max(buildInstances, 1)) * 100).toFixed(0)}%)`,
);
console.log(`技能书/遣散刷书场景待对应功能落地后接入(数值票验收跑)。`);

// ── 崩溃收账(引擎/数据 bug = 进程非零;平衡发现不算工具故障)──
if (crashed.length > 0) {
  console.log(`\n═══ 崩溃 ${crashed.length} 局(引擎抛错 = 发现 bug)═══`);
  for (const c of crashed) console.log(`  seed ${c.seed}:${c.err}`);
  process.exit(1);
}
