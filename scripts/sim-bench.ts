// bot 对战基准 + 历史区间台账(#1163,票三):3 图 × 座位档(2/4)× seed 4001-4050
// = 300 局全 bot 自对弈,种子固定 = 确定性(不飘),逐局断言 + 区间对账 + 文本报告。
// 学自 vera20k src/bin/sim-bench.rs 的「批量场景 × 稳态统计口径」组织方式;场景三型
// (march/match/skirmish)与预热段、座位档 8 不适用,判词见 docs/adr/0054-sim-bench.md。
//
// 逐局断言(发现即炸/即红,零兜底):
//   ① 终局必须达成:finished=false 即红并列 seed 清单;触回合上限 = 平衡发现,
//      处置 = 调语料或 ADR 记判读,不是 update 能盖掉的;
//   ② 零不变量违规:driveToEnd 六守卫(相位/归属/无进展/词表/数值/僵死)已覆盖,
//      引擎抛错原样上抛,本脚本不接不包;
//   ③ 终态经济扫尾:全员 netWorth 有限 / 非破产座位终态 cash ≥ 0 / 局中
//      playerBankrupt 事件座位(subject=破产者,timing.ts)终态 isBankrupt 必须 = true
//      (事件↔旗子交叉核对);终局而无胜者同样炸(异常终局不许泄漏进基准);
//   ④ 局长中位数与破产率落历史区间:test/goldens/bench-ranges.json(jj 跟踪),
//      每 (mapId, seats) 记 { medianRounds, bankruptRate, format },越界红,
//      报「图/档/实测 vs 区间」。
//
// 双模式(check-goldens 同款心智):
//   bun scripts/sim-bench.ts          # 校验:矩阵全跑 + 断言 + 区间对账,越界即红
//   bun scripts/sim-bench.ts update   # 刷新:按当前矩阵重算区间,打印新旧对比,不静默
//
// 语料口径:3 图同票一语料源(guanzhong/zhongyuan 内置 + yanzhou 夹具),机遇 = 产品
// 默认(ENCOUNTER_PRODUCT_DEFAULTS,ADR-0035),不装扩展包——与票一/票二同口径,
// 区间只依赖仓内内容,扩展目录变动不进基准。seed 段 4001-4050 与票一/二语料
// 3001-3010 分开,两门互不踩。统计口径沿 sim-batch 先例:分位数 q(arr,p) =
// arr[floor(p·(n-1))],破产率 = 局均破产人次(isBankrupt 旗为单源)。
// 带宽口径:首跑中位 ±25%;轮数(整数量纲)四舍五入取整,破产率(小数量纲)保留
// 两位小数——取整会把低速率带宽压成 [0,0] 伪门(判词见 ADR-0054)。
//
// 定位:「按需跑」的平衡基准(不进默认门);文本报告(stdout)给平衡性调参用,
// 逐局进度走 stderr(同 sim-batch)。
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import guanzhongData from "../public/maps/guanzhong.json" with { type: "json" };
import zhongyuanData from "../public/maps/zhongyuan.json" with { type: "json" };
import yanzhouData from "../test/fixtures/maps/yanzhou.json" with { type: "json" };
import { loadMap, type LoadedMap } from "../src/core/board-loader";
import type { SeatConfig } from "../src/core/authority";
import { netWorth } from "../src/core/networth";
import { runWholeGame } from "./whole-game";

// ── 矩阵(座位档 2/4:引擎座位上限 4、国号池四家,sim-batch 校验 2-4;票面「8」
//    不适用,判词见 ADR-0054)──
const MAPS = [
  { id: "guanzhong", data: guanzhongData },
  { id: "zhongyuan", data: zhongyuanData },
  { id: "yanzhou", data: yanzhouData },
] as const;
const SEATS_OPTIONS = [2, 4];
const SEED0 = 4001;
const SEED_COUNT = 50;
/** 回合上限(单玩家回合数,同 sim-batch):防永动局的测量口径,触顶 = 终局未达成。 */
const TURN_CAP = 3000;

// ── 区间台账(格式冻结;键 = `${mapId}#${seats}`)──
const RANGES_PATH = resolve(import.meta.dir, "../test/goldens/bench-ranges.json");
const RANGE_FORMAT = 1;
const BAND = 0.25;
const DOC_ANCHOR =
  "docs/how-to/开发与测试.md「bot 基准」节(越界=平衡漂移信号;确认符合预期后 bun run check:sim-bench:update 刷新区间)";

interface RangeEntry {
  /** 局长中位数历史区间 [lo, hi](轮,整数)。 */
  medianRounds: [number, number];
  /** 破产率(局均破产人次)历史区间 [lo, hi](两位小数)。 */
  bankruptRate: [number, number];
  format: number;
}
type RangeFile = Record<string, RangeEntry>;

const cellKey = (mapId: string, seats: number): string => `${mapId}#${seats}`;
const ALL_KEYS: string[] = MAPS.flatMap((m) => SEATS_OPTIONS.map((s) => cellKey(m.id, s)));

/** 区间台账冻结格式校验(缺键/未知图档/字段漂移当场抛,零兜底)。 */
function parseRanges(): RangeFile {
  if (!existsSync(RANGES_PATH))
    throw new Error(
      `区间台账缺文件:${RANGES_PATH}——先跑 bun run check:sim-bench:update 生成,别让门禁空转`,
    );
  const raw: unknown = JSON.parse(readFileSync(RANGES_PATH, "utf-8"));
  if (raw == null || typeof raw !== "object" || Array.isArray(raw))
    throw new Error(`${RANGES_PATH}:台账顶层非对象——台账损坏`);
  const file = raw as Record<string, unknown>;
  const keys = Object.keys(file);
  const missing = ALL_KEYS.filter((k) => !keys.includes(k));
  const unknown = keys.filter((k) => !ALL_KEYS.includes(k));
  if (missing.length > 0 || unknown.length > 0)
    throw new Error(
      `${RANGES_PATH}:矩阵键不符(缺 [${missing.join(",")}] 未知 [${unknown.join(",")}])——矩阵变更须重刷台账(bun run check:sim-bench:update)`,
    );
  for (const k of ALL_KEYS) {
    const e = file[k] as Partial<RangeEntry> | null;
    if (e == null || typeof e !== "object")
      throw new Error(`${RANGES_PATH}:${k} 条目缺失或非对象——台账损坏`);
    const extra = Object.keys(e).filter(
      (f) => !["medianRounds", "bankruptRate", "format"].includes(f),
    );
    if (extra.length > 0)
      throw new Error(
        `${RANGES_PATH}:${k} 多出字段 [${extra.join(",")}]——区间格式已冻结,漂移走 ADR-0054 update 流程`,
      );
    if (e.format !== RANGE_FORMAT)
      throw new Error(
        `${RANGES_PATH}:${k} format ${String(e.format)} ≠ ${RANGE_FORMAT}——区间格式已冻结,漂移走 ADR-0054 update 流程`,
      );
    for (const f of ["medianRounds", "bankruptRate"] as const) {
      const band = e[f];
      if (
        !Array.isArray(band) ||
        band.length !== 2 ||
        !band.every((v) => typeof v === "number" && Number.isFinite(v)) ||
        band[0] > band[1]
      )
        throw new Error(`${RANGES_PATH}:${k} 的 ${f} 非合法 [lo, hi] 区间——台账损坏`);
    }
  }
  return file as RangeFile;
}

/** 首跑值 ±25% 带宽;round 参数定数量纲(轮数取整 / 破产率两位小数,判词见文件头)。 */
function bandOf(v: number, round: (x: number) => number): [number, number] {
  return [round(v * (1 - BAND)), round(v * (1 + BAND))];
}

// ── 单局:跑整局 + 逐局断言(发现即炸)──
interface GameOutcome {
  finished: boolean;
  rounds: number;
  winReason: string;
  /** 胜者终局身价(未终局 = null;finished 而 null 会在断言处炸)。 */
  winnerNetWorth: number | null;
  bankrupts: number;
}

function botSeats(n: number): SeatConfig[] {
  return Array.from({ length: n }, (_, i) => ({ name: `诸侯 ${i + 1}`, isBot: true }));
}

function runGame(map: LoadedMap, mapId: string, seats: number, seed: number): GameOutcome {
  const where = `seed ${seed} @ ${mapId}/${seats}席`;
  const bankruptEventSeats = new Set<number>();
  const result = runWholeGame({
    map,
    mapId,
    seed,
    seats: botSeats(seats),
    turnCap: TURN_CAP,
    hooks: {
      onStep: (events) => {
        for (const ev of events) {
          if (ev.kind === "playerBankrupt") {
            if (ev.seat == null)
              throw new Error(`${where}:playerBankrupt 事件无主体座位——派发损坏`);
            bankruptEventSeats.add(ev.seat);
          }
        }
      },
    },
  });
  const e = result.engine;
  // 终态经济扫尾(①类断言:红一次即定性上报,不迭代;driveToEnd 已守每回合边界,
  // 此处补终局收尾态的最后一拍)
  for (const p of e.players) {
    const nw = netWorth(p);
    if (!Number.isFinite(nw))
      throw new Error(`${where}:座位 ${p.id} 终态身价非有限(${String(nw)})——数值泄漏`);
    if (!p.isBankrupt && p.cash < 0)
      throw new Error(`${where}:非破产座位 ${p.id} 终态现金 ${p.cash} < 0——破产旗未置位或结算泄漏`);
  }
  for (const s of bankruptEventSeats) {
    const p = e.players[s];
    if (p == null) throw new Error(`${where}:playerBankrupt 事件座位 ${s} 不存在——派发损坏`);
    if (p.isBankrupt !== true)
      throw new Error(
        `${where}:座位 ${s} 局中 playerBankrupt 在案,终态 isBankrupt=${String(p.isBankrupt)}——破产旗未落位`,
      );
  }
  if (result.finished && e.winner == null)
    throw new Error(`${where}:终局而无胜者(winReason=${e.winReason})——异常终局泄漏进基准`);
  return {
    finished: result.finished,
    rounds: e.round,
    winReason: e.winReason,
    winnerNetWorth: e.winner != null ? netWorth(e.winner) : null,
    bankrupts: e.players.filter((p) => p.isBankrupt).length,
  };
}

// ── 单元格(mapId × seats):跑满 50 seed,聚合统计 ──
interface CellStat {
  mapId: string;
  seats: number;
  games: number;
  finished: number;
  unfinishedSeeds: number[];
  /** 终局局轮数(未终局局的轮数不计入分布——该格已红,统计仅供报告参考)。 */
  finishedRounds: number[];
  winReasons: Map<string, number>;
  winnerNetWorths: number[];
  bankruptsTotal: number;
}

function runCell(map: LoadedMap, mapId: string, seats: number): CellStat {
  const stat: CellStat = {
    mapId,
    seats,
    games: 0,
    finished: 0,
    unfinishedSeeds: [],
    finishedRounds: [],
    winReasons: new Map(),
    winnerNetWorths: [],
    bankruptsTotal: 0,
  };
  for (let i = 0; i < SEED_COUNT; i++) {
    const seed = SEED0 + i;
    const o = runGame(map, mapId, seats, seed);
    stat.games += 1;
    stat.bankruptsTotal += o.bankrupts;
    if (o.finished) {
      stat.finished += 1;
      stat.finishedRounds.push(o.rounds);
      stat.winReasons.set(o.winReason, (stat.winReasons.get(o.winReason) ?? 0) + 1);
      if (o.winnerNetWorth != null) stat.winnerNetWorths.push(o.winnerNetWorth);
      console.error(`[${mapId}/${seats}席] seed=${seed} 终局 ${o.rounds} 轮(${o.winReason})`);
    } else {
      stat.unfinishedSeeds.push(seed);
      console.error(`[${mapId}/${seats}席] seed=${seed} 未终局(触 ${TURN_CAP} 回合上限)`);
    }
  }
  return stat;
}

/** 分位数(sim-batch 同款口径):arr[floor(p·(n-1))],须已升序。 */
function q(sorted: number[], p: number): number {
  return sorted[Math.floor(p * (sorted.length - 1))];
}
const asc = (arr: number[]): number[] => [...arr].sort((a, b) => a - b);
const num = (v: number): string => v.toLocaleString("en-US");
const REASON_ZH: Record<string, string> = {
  TargetNetWorth: "身价达标",
  LastStanding: "群雄尽灭",
  None: "无",
  aborted: "异常作废",
};

// ── 校验模式:矩阵全跑 + 断言 + 区间对账,越界/未终局即红(exit 1)──
function checkAll(): void {
  const ranges = parseRanges();
  const t0 = performance.now();
  const violations: string[] = [];
  for (const m of MAPS) {
    const map = loadMap(m.data);
    for (const seats of SEATS_OPTIONS) {
      const cell = runCell(map, m.id, seats);
      printCellReport(cell);
      const key = cellKey(m.id, seats);
      if (cell.unfinishedSeeds.length > 0) {
        violations.push(
          `${key}:终局未达成(${cell.unfinishedSeeds.length} 局:seeds ${cell.unfinishedSeeds.join(",")})——触回合上限 = 平衡发现,处置 = 调语料或 ADR-0054 记判读`,
        );
        continue;
      }
      const r = ranges[key];
      const med = q(asc(cell.finishedRounds), 0.5);
      const rate = cell.bankruptsTotal / cell.games;
      if (med < r.medianRounds[0] || med > r.medianRounds[1])
        violations.push(
          `${key}:轮中位 ${med} 越历史区间 [${r.medianRounds[0]}, ${r.medianRounds[1]}]`,
        );
      if (rate < r.bankruptRate[0] || rate > r.bankruptRate[1])
        violations.push(
          `${key}:破产率 ${rate.toFixed(2)} 越历史区间 [${r.bankruptRate[0].toFixed(2)}, ${r.bankruptRate[1].toFixed(2)}]`,
        );
    }
  }
  if (violations.length > 0) {
    console.error(`\nbot 基准红:${violations.length} 项越界/未达成`);
    for (const v of violations) console.error(`  ${v}`);
    console.error(`处置见 ${DOC_ANCHOR}`);
    process.exit(1);
  }
  console.log(
    `\nbot 基准全绿:${MAPS.length} 图 × ${SEATS_OPTIONS.join("/")} 席 × ${SEED_COUNT} 种子 = ${MAPS.length * SEATS_OPTIONS.length * SEED_COUNT} 局,区间对账通过,总耗时 ${Math.round(performance.now() - t0)}ms`,
  );
}

function printCellReport(cell: CellStat): void {
  const lines: string[] = [];
  lines.push(`\n── ${cell.mapId} · ${cell.seats} 席 ──`);
  lines.push(`终局率:${cell.finished}/${cell.games}`);
  if (cell.finishedRounds.length > 0) {
    const rounds = asc(cell.finishedRounds);
    lines.push(
      `轮数分布:min ${rounds[0]} / p50 ${q(rounds, 0.5)} / p90 ${q(rounds, 0.9)} / max ${rounds[rounds.length - 1]}(轮)`,
    );
    const byReason = [...cell.winReasons.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([r, n]) => `${REASON_ZH[r] ?? r} ×${n}`)
      .join(" · ");
    lines.push(`终局方式:${byReason}`);
    const winners = asc(cell.winnerNetWorths);
    lines.push(`胜者身价:中位 ${num(q(winners, 0.5))}`);
  }
  const rate = cell.bankruptsTotal / cell.games;
  lines.push(`破产率:${rate.toFixed(2)}(局均破产人次,旗单源)`);
  if (cell.unfinishedSeeds.length > 0)
    lines.push(`未终局 seeds:${cell.unfinishedSeeds.join(", ")}(触回合上限,平衡发现)`);
  console.log(lines.join("\n"));
}

// ── 刷新模式:按当前矩阵重算区间,打印新旧对比(不静默);未终局局在场 = 拒刷 ──
function updateAll(): void {
  const t0 = performance.now();
  const oldFile: RangeFile | null = existsSync(RANGES_PATH) ? parseRanges() : null;
  const fresh: RangeFile = {};
  for (const m of MAPS) {
    const map = loadMap(m.data);
    for (const seats of SEATS_OPTIONS) {
      const cell = runCell(map, m.id, seats);
      printCellReport(cell);
      if (cell.unfinishedSeeds.length > 0)
        throw new Error(
          `${cellKey(m.id, seats)}:终局未达成(seeds ${cell.unfinishedSeeds.join(",")})——未终局的区间不可信,先调语料或按 ADR-0054 记判读`,
        );
      const key = cellKey(m.id, seats);
      fresh[key] = {
        medianRounds: bandOf(q(asc(cell.finishedRounds), 0.5), (x) => Math.round(x)),
        bankruptRate: bandOf(cell.bankruptsTotal / cell.games, (x) => Math.round(x * 100) / 100),
        format: RANGE_FORMAT,
      };
    }
  }
  for (const key of ALL_KEYS) {
    const nw = fresh[key];
    if (oldFile == null) {
      console.log(
        `  ${key}:新建区间 中位 [${nw.medianRounds[0]}, ${nw.medianRounds[1]}] · 破产率 [${nw.bankruptRate[0].toFixed(2)}, ${nw.bankruptRate[1].toFixed(2)}]`,
      );
      continue;
    }
    const old = oldFile[key];
    const same =
      old.medianRounds[0] === nw.medianRounds[0] &&
      old.medianRounds[1] === nw.medianRounds[1] &&
      old.bankruptRate[0] === nw.bankruptRate[0] &&
      old.bankruptRate[1] === nw.bankruptRate[1];
    if (same) {
      console.log(
        `  ${key}:区间无变化 中位 [${nw.medianRounds[0]}, ${nw.medianRounds[1]}] · 破产率 [${nw.bankruptRate[0].toFixed(2)}, ${nw.bankruptRate[1].toFixed(2)}]——确认刷新意图,台账原样重写`,
      );
    } else {
      console.log(
        `  ${key}:中位 [${old.medianRounds[0]}, ${old.medianRounds[1]}] → [${nw.medianRounds[0]}, ${nw.medianRounds[1]}] · 破产率 [${old.bankruptRate[0].toFixed(2)}, ${old.bankruptRate[1].toFixed(2)}] → [${nw.bankruptRate[0].toFixed(2)}, ${nw.bankruptRate[1].toFixed(2)}]`,
      );
    }
  }
  writeFileSync(RANGES_PATH, renderRanges(fresh), "utf-8");
  console.log(
    `区间台账已刷新 → ${RANGES_PATH}(总耗时 ${Math.round(performance.now() - t0)}ms;台账 diff 与代码同 PR 入库)`,
  );
}

/** 区间台账落盘排版:与 oxfmt 规范形拉平(短数值数组收单行)。空白不进解析面
 *  (JSON.parse 不挑),但 check:fmt 在门上——writeFileSync 排版若与 formatter
 *  不一致,update 一跑 check:fmt 就红、次次拉锯;票二 renderLedger 同款取舍
 *  (ADR-0053 落盘排版节)。 */
function renderRanges(file: RangeFile): string {
  const out: string[] = ["{"];
  ALL_KEYS.forEach((key, i) => {
    const e = file[key];
    out.push(`  "${key}": {`);
    out.push(`    "medianRounds": [${e.medianRounds[0]}, ${e.medianRounds[1]}],`);
    out.push(`    "bankruptRate": [${e.bankruptRate[0]}, ${e.bankruptRate[1]}],`);
    out.push(`    "format": ${e.format}`);
    out.push(`  }${i < ALL_KEYS.length - 1 ? "," : ""}`);
  });
  out.push("}");
  return out.join("\n") + "\n";
}

// ── 入口(严格解析:update 是唯一子命令,其余当场抛)──
const argv = process.argv.slice(2);
if (argv.length === 0) checkAll();
else if (argv.length === 1 && argv[0] === "update") updateAll();
else throw new Error(`用法:bun scripts/sim-bench.ts [update](收到:${argv.join(" ")})`);
