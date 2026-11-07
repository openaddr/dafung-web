// 注入通道二「遣散刷书」(#1148 技能扩展数值校准,spec #1144 拆票 D/五):放开
// 「遣散→招贤」循环——bot v1 不主动遣散是产品口径,本通道是测量用脚本注入,不改 bot
// 产品行为(bot.ts 零改动):目标座位在每个自己的行动决策缝(AwaitingDecision 且
// decisionOwner=本人,dismissHero 的合法性闸)把麾下技数最少的将遣散掉(免费、折书),
// 招贤事件随后自然回填麾下——循环 = 技→书→(珍宝通路变卖/交涉)→银两,看书产出速率与
// 经济是否自节流(书变卖价 = SKILL_BOOK_LEVEL 档指导价,珍宝位现通路零特判)。
//
// 注入面(scripts/ 测量通道):driveToEnd onStep 钩子,批界之后、下一步 botAct 之前执行
// dismissHero(引擎公共域函数,校验照走);遣散事件折入下一步事件批,统计照收。
// 遣散目标选择:麾下 skillIds 最少者,平手取先入槽(确定性,不掷骰)。
//
// 其余驱动与统计口径与 sim-batch.ts 全同(同 seed 段可直接对表);追加注入专线指标:
// 遣散人次/折书册数、目标座位书经珍宝通路出账(变卖 treasureSold+交割 treasureTraded
// 中 skillbook- 前缀)、目标座位胜率/终局身价/破产。
//
// 用法:bun scripts/sim-inject-dismiss.ts [局数=50] [起始seed=1000] [--seat <0-3>]
import { resolve } from "node:path";
import { loadExtensionPackages } from "../src/core/extension-loader";
import { ENCOUNTER_PRODUCT_DEFAULTS } from "../src/core/encounters";
import { SKILL_BOOK_ID_PREFIX } from "../src/core/treasures";
import { dismissHero } from "../src/core/hero-dismiss";
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

/** 技能书判别(实例 id 前缀,印书单源派生)。 */
const bookish = (id: string) => id.startsWith(SKILL_BOOK_ID_PREFIX);

const seats: SeatConfig[] = Array.from({ length: 4 }, (_, i) => ({
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
    encounter: ENCOUNTER_PRODUCT_DEFAULTS,
  };
  return createEngine(config, true, map);
}

/** 遣散目标:麾下技数最少者(平手取先入槽;确定性,零掷骰)。麾下空 = null。 */
function pickVictim(e: GameEngine): string | null {
  const heroes = e.players[TARGET_SEAT].heroes;
  if (heroes.length === 0) return null;
  let best = heroes[0]!;
  for (const h of heroes) if (h.skillIds.length < best.skillIds.length) best = h;
  return best.heroId;
}

/** 行动决策缝注入(产品行为零改动):目标座位是行动者、停在行动决策窗即遣散一将。
 *  返回本次折书册数(0=窗不归目标/麾下空/校验拒绝)。遣散事件折在下个 botAct 开批时
 *  被清(#375 批界纪律),计量只能在此直数,不走事件批。 */
function maybeDismiss(e: GameEngine): number {
  if (e.decisionOwner !== TARGET_SEAT || e.turnPhase !== "AwaitingDecision") return 0;
  const victim = pickVictim(e);
  if (victim == null) return 0;
  const victimSlot = e.players[TARGET_SEAT].heroes.find((h) => h.heroId === victim)!;
  const books = victimSlot.skillIds.length;
  const slots0 = e.players[TARGET_SEAT].heroes.length;
  dismissHero(e, victim); // 校验不过=g.warn 留痕拒绝(照引擎硬闸)
  if (e.players[TARGET_SEAT].heroes.length !== slots0 - 1) return 0; // 遣散被拒:零计
  return books;
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
  targetBankrupt: boolean;
  dismissals: number;
  booksPrinted: number;
  booksNatural: number;
  booksSoldCash: number;
  booksSoldCount: number;
  booksTradedCount: number;
  booksHeldEnd: number;
  grants: Map<string, number>;
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
    targetBankrupt: false,
    dismissals: 0,
    booksPrinted: 0,
    booksNatural: 0,
    booksSoldCash: 0,
    booksSoldCount: 0,
    booksTradedCount: 0,
    booksHeldEnd: 0,
    grants: new Map(),
    econ: { bought: 0, upgraded: 0, traded: 0 },
  };
  const handle = (ev: GameEvent) => {
    if (ev.kind === "treasureGained" && ev.seat === TARGET_SEAT && bookish(ev.treasureId)) {
      stat.booksNatural += 1; // 位满印书(遣散折书在批界前被清,直数于 maybeDismiss)
    } else if (ev.kind === "treasureSold" && ev.seat === TARGET_SEAT && bookish(ev.treasureId)) {
      stat.booksSoldCount += 1;
      stat.booksSoldCash += ev.amount;
    } else if (
      ev.kind === "treasureTraded" &&
      ev.sellerSeat === TARGET_SEAT &&
      bookish(ev.treasureId)
    ) {
      stat.booksTradedCount += 1;
    } else if (ev.kind === "heroRecruited" && ev.seat === TARGET_SEAT) {
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
    label: `dismissfarm seed ${seed}`,
    turnCap: TURN_CAP,
    hooks: {
      onStep: (events) => {
        for (const ev of events) handle(ev);
        const books = maybeDismiss(e); // 下一步 botAct 前:停在目标座位行动缝就遣散
        if (books > 0) {
          stat.dismissals += 1;
          stat.booksPrinted += books;
        }
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
  stat.targetBankrupt = e.players[TARGET_SEAT].isBankrupt;
  stat.booksHeldEnd = e.players[TARGET_SEAT].treasures.filter((t) => bookish(t.id)).length;
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

console.log(`═══ sim-inject-dismiss(遣散刷书):${N} 局 · 注入座位 ${TARGET_SEAT} 行动缝必遣散 ═══`);
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
const dismissals = stats.reduce((a, s) => a + s.dismissals, 0);
const printed = stats.reduce((a, s) => a + s.booksPrinted, 0);
const natural = stats.reduce((a, s) => a + s.booksNatural, 0);
const soldN = stats.reduce((a, s) => a + s.booksSoldCount, 0);
const soldCash = stats.reduce((a, s) => a + s.booksSoldCash, 0);
const tradedN = stats.reduce((a, s) => a + s.booksTradedCount, 0);
const heldEnd = stats.reduce((a, s) => a + s.booksHeldEnd, 0);
const grantSum = stats.reduce((a, s) => a + [...s.grants.values()].reduce((x, y) => x + y, 0), 0);
console.log(
  `刷书账(注入座位·合计):遣散 ${dismissals} 次 · 折书 ${printed} 册 · 位满印书 ${natural} 册(合计 ${(printed + natural) / N} 册/局)`,
);
console.log(
  `  书出账:变卖 ${soldN} 册(入账 ${num(soldCash)} 两) · 交割转手 ${tradedN} 册 · 终局仍持 ${heldEnd} 册(出账闭环 ${(((soldN + tradedN + heldEnd) / Math.max(printed + natural, 1)) * 100).toFixed(0)}%)`,
);
console.log(`  目标座位自然授技 ${grantSum} 枚(技→书→技循环的技流入口)`);
const boughtTotal = stats.reduce((a, s) => a + s.econ.bought, 0);
const upgradedTotal = stats.reduce((a, s) => a + s.econ.upgraded, 0);
const tradedTotal = stats.reduce((a, s) => a + s.econ.traded, 0);
console.log(
  `经济动作(局均):购城 ${(boughtTotal / N).toFixed(1)} · 升级 ${(upgradedTotal / N).toFixed(1)} · 珍宝成交 ${(tradedTotal / N).toFixed(1)}`,
);
const targetCrash = stats.filter((s) => s.targetBankrupt).length;
console.log(`注入座位破产:${targetCrash}/${N} 局(刷书换银是否救穷/致穷看这里)`);
if (crashed.length > 0) {
  console.log(`\n═══ 崩溃 ${crashed.length} 局 ═══`);
  for (const c of crashed) console.log(`  seed ${c.seed}:${c.err}`);
  process.exit(1);
}
