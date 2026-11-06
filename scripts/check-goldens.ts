// 黄金台账门禁(#1162,票二):固定语料的逐回合摘要基线(test/goldens/<mapId>.json,
// jj 跟踪)vs 进程内重跑,逐位差分,首个漂移定位到「图/seed/第几笔摘要(turn·round)」
// 并逐字段列出两边差异。学自 vera20k .github/workflows/determinism.yml 的「哈希全等作
// 门禁」组织方式(逐帧哈希落产物 → compare 全等对齐 → 首分歧截头展示):本仓无 CI,
// 门 = 本地 check:goldens;粒度从逐帧收敛到逐回合(回合制,边界即语义切分,ADR-0052)。
//
// 台账记录 = 摘要定义冻结口径(ADR-0052,单源 scripts/state-digest.ts)的存储投影,
// 比内存 TurnDigest 瘦:剥掉 events 正文,只留 kind 序列——stateHash 已对「快照全量 +
// 本回合事件批」钉死,台账是索引不是第二事实源(存正文 = 造第二事实源,违全仓纪律;
// kinds 序列保留漂移可读性:多了/少了哪类事件一眼可见)。
//
// 先红教育口径(对齐 canary-seed):先红 = 信号,勿逐 spec 排查;漂移处定位到回合,
// 取证可跑 bun run sim:digest -- --json(逐回合摘要对照)。确认漂移符合预期后
// bun run check:goldens:update 刷新台账(update 打印新旧摘要差异,不静默),
// 流程详见 docs/how-to/开发与测试.md「黄金台账」节。
//
// 语料 = 票一同款(test/headless-whole-game.test.ts):guanzhong/zhongyuan/yanzhou
// × seed 3001-3010 × 4 bot 座,走 runWholeGame(机遇 = 产品默认,ADR-0035)。
// 不装扩展包——与票一同口径(装载会把扩展名将灌进全局名将池,bun test 单进程实锤)。
//
// 用法:bun scripts/check-goldens.ts          # 校验模式(重跑 diff,漂移即红)
//       bun scripts/check-goldens.ts update  # 刷新模式(重生成台账,打印新旧差异)
// 退出码:0 = 全绿/已刷新;1 = 台账漂移(校验模式)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import guanzhongData from "../public/maps/guanzhong.json" with { type: "json" };
import zhongyuanData from "../public/maps/zhongyuan.json" with { type: "json" };
import yanzhouData from "../test/fixtures/maps/yanzhou.json" with { type: "json" };
import { loadMap, type LoadedMap } from "../src/core/board-loader";
import type { SeatConfig } from "../src/core/authority";
import { canonicalize } from "./state-digest";
import type { TurnDigest } from "./state-digest";
import { runWholeGame } from "./whole-game";

const GOLDENS_DIR = resolve(import.meta.dir, "../test/goldens");
const LEDGER_FORMAT = 1;
const DOC_ANCHOR =
  "docs/how-to/开发与测试.md「黄金台账」节(先红=信号勿逐 spec 排查;确认漂移符合预期后 bun run check:goldens:update 刷新台账)";

// ── 语料(票一同款;两处同步维护,票一测试与台账语料必须同套)──
const MAPS = [
  { id: "guanzhong", data: guanzhongData },
  { id: "zhongyuan", data: zhongyuanData },
  { id: "yanzhou", data: yanzhouData },
] as const;
const SEEDS = [3001, 3002, 3003, 3004, 3005, 3006, 3007, 3008, 3009, 3010];
const botSeats = (): SeatConfig[] =>
  Array.from({ length: 4 }, (_, i) => ({ name: `诸侯 ${i + 1}`, isBot: true }));

// ── 台账格式(冻结;存储投影,字段语义见 scripts/state-digest.ts)──
interface LedgerRecord {
  /** 边界时刻引擎的轮次/回合号(状态本位:边界已步入下一回合)。 */
  round: number;
  turn: number;
  phase: string;
  turnPhase: string;
  activeIndex: number;
  isOver: boolean;
  /** 骰流游标(RNG 光标,掷骰次数分叉只有它抓得住)。 */
  rngState: number;
  /** 链式战报哈希(折入至本边界止的全部 log 行)。 */
  logHash: string;
  logCount: number;
  /** 状态指纹:快照全量 + 本回合事件批,规范化 sha256(全量钉死,正文不必入库)。 */
  stateHash: string;
  /** 本回合事件批的 kind 序列(正文不入库的理由见文件头;kinds 长度与序列本身也是断言面)。 */
  kinds: string[];
}
interface LedgerCorpusEntry {
  seed: number;
  seats: SeatConfig[];
  digests: LedgerRecord[];
}
interface LedgerFile {
  format: number;
  corpus: LedgerCorpusEntry[];
}

function ledgerPath(mapId: string): string {
  return join(GOLDENS_DIR, `${mapId}.json`);
}

function toRecord(d: TurnDigest): LedgerRecord {
  return {
    round: d.round,
    turn: d.turn,
    phase: d.phase,
    turnPhase: d.turnPhase,
    activeIndex: d.activeIndex,
    isOver: d.isOver,
    rngState: d.rngState,
    logHash: d.logHash,
    logCount: d.logCount,
    stateHash: d.stateHash,
    kinds: d.events.map((e) => e.kind),
  };
}

const RECORD_KEYS = [
  "round",
  "turn",
  "phase",
  "turnPhase",
  "activeIndex",
  "isOver",
  "rngState",
  "logHash",
  "logCount",
  "stateHash",
  "kinds",
] as const;

/** 台账文件结构校验(冻结格式;缺文件/格式不符当场抛,零兜底)。返回 corpus。 */
function parseLedger(mapId: string, raw: string): LedgerCorpusEntry[] {
  const file = JSON.parse(raw) as LedgerFile;
  const where = ledgerPath(mapId);
  if (file.format !== LEDGER_FORMAT)
    throw new Error(
      `${where}:format ${String(file.format)} ≠ ${LEDGER_FORMAT}——台账格式已冻结,漂移走 ADR-0053 update 流程`,
    );
  if (!Array.isArray(file.corpus)) throw new Error(`${where}:corpus 非数组——台账损坏`);
  const expectedSeats = botSeats();
  for (const entry of file.corpus) {
    if (typeof entry.seed !== "number" || !Number.isInteger(entry.seed))
      throw new Error(`${where}:corpus 条目 seed 非整数——台账损坏`);
    if (JSON.stringify(canonicalize(entry.seats)) !== JSON.stringify(canonicalize(expectedSeats)))
      throw new Error(
        `${where}:seed ${entry.seed} 的座位表与当前语料不一致——语料变更须重刷台账(bun run check:goldens:update)`,
      );
    if (!Array.isArray(entry.digests))
      throw new Error(`${where}:seed ${entry.seed} digests 非数组——台账损坏`);
    for (const r of entry.digests) {
      const missing = RECORD_KEYS.filter((k) => !(k in r));
      const extra = Object.keys(r).filter((k) => !(RECORD_KEYS as readonly string[]).includes(k));
      if (missing.length > 0 || extra.length > 0)
        throw new Error(
          `${where}:记录字段不符冻结格式(缺 [${missing.join(",")}] 多 [${extra.join(",")}]——字段集漂移走 ADR-0053 update 流程)`,
        );
    }
  }
  const ledgerSeeds = file.corpus.map((e) => e.seed);
  if (JSON.stringify(ledgerSeeds) !== JSON.stringify(SEEDS))
    throw new Error(
      `${where}:台账语料 [${ledgerSeeds.join(",")}] ≠ 当前语料 [${SEEDS.join(",")}]——语料变更须重刷台账(bun run check:goldens:update)`,
    );
  return file.corpus;
}

// ── 重跑语料:逐 seed 跑整局,onDigest 钩子投影成台账记录 ──
function runCorpus(mapId: string, map: LoadedMap): LedgerCorpusEntry[] {
  const entries: LedgerCorpusEntry[] = [];
  for (const seed of SEEDS) {
    const seats = botSeats();
    const digests: LedgerRecord[] = [];
    const result = runWholeGame({
      map,
      mapId,
      seed,
      seats,
      hooks: { onDigest: (d) => digests.push(toRecord(d)) },
    });
    entries.push({ seed, seats, digests });
    if (result.finished) continue;
    console.log(`  ⚠ seed ${seed} 未终局(触回合上限)——台账照记(isOver 字段已钉),平衡判读归消费方`);
  }
  return entries;
}

// ── 首漂定位:逐笔逐字段对齐,返回首个不一致处;全等返回 null ──
interface FieldDiff {
  field: string;
  ledger: string;
  rerun: string;
}
interface FirstDrift {
  seed: number;
  index: number;
  digest: LedgerRecord | null; // 两边都有的笔(长度差异时缺的一侧为 null)
  fields: FieldDiff[];
  ledgerLen: number;
  rerunLen: number;
}

function firstDriftOf(ledger: LedgerCorpusEntry[], rerun: LedgerCorpusEntry[]): FirstDrift | null {
  for (let ci = 0; ci < rerun.length; ci++) {
    const a = ledger[ci].digests;
    const b = rerun[ci].digests;
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) {
      const fields: FieldDiff[] = [];
      for (const k of RECORD_KEYS) {
        if (k === "kinds") continue;
        if (a[i][k] !== b[i][k])
          fields.push({
            field: k,
            ledger: preview(a[i][k]),
            rerun: preview(b[i][k]),
          });
      }
      const kindsDiffer =
        a[i].kinds.length !== b[i].kinds.length || a[i].kinds.some((v, j) => v !== b[i].kinds[j]);
      if (kindsDiffer)
        fields.push({
          field: `kinds(len ${a[i].kinds.length}→${b[i].kinds.length})`,
          ledger: a[i].kinds.join(","),
          rerun: b[i].kinds.join(","),
        });
      if (fields.length > 0)
        return {
          seed: rerun[ci].seed,
          index: i,
          digest: b[i],
          fields,
          ledgerLen: a.length,
          rerunLen: b.length,
        };
    }
    if (a.length !== b.length)
      return {
        seed: rerun[ci].seed,
        index: n,
        digest: b[n] ?? null,
        fields: [],
        ledgerLen: a.length,
        rerunLen: b.length,
      };
  }
  return null;
}

/** 摘要展示:哈希截头(sim-digest 同款口径),标量原样。 */
function preview(v: string | number | boolean): string {
  if (typeof v === "string" && v.length > 16) return v.slice(0, 16) + "…";
  return String(v);
}

// ── 校验模式:逐图重跑 diff,首漂即红(exit 1);全绿打印汇总 ──
function checkAll(): void {
  const t0 = performance.now();
  let total = 0;
  for (const m of MAPS) {
    const where = ledgerPath(m.id);
    if (!existsSync(where))
      throw new Error(`台账缺文件:${where}——先跑 bun run check:goldens:update 生成,别让门禁空转`);
    const ledger = parseLedger(m.id, readFileSync(where, "utf-8"));
    const tMap = performance.now();
    const rerun = runCorpus(m.id, loadMap(m.data));
    const drift = firstDriftOf(ledger, rerun);
    if (drift != null) {
      const lines: string[] = [];
      lines.push(`黄金台账漂移:${m.id} / seed ${drift.seed} / 第 ${drift.index + 1} 笔摘要`);
      if (drift.digest != null)
        lines.push(
          `  漂移回合:turn ${drift.digest.turn} · round ${drift.digest.round} · ${drift.digest.turnPhase}`,
        );
      lines.push(`  摘要笔数:台账 ${drift.ledgerLen} 笔 vs 重跑 ${drift.rerunLen} 笔`);
      if (drift.fields.length === 0) {
        lines.push(`  公共前缀逐位一致,笔数在两侧分叉(一侧多出的首笔即漂移起点):`);
      } else {
        lines.push(`  逐字段 diff(台账 vs 重跑):`);
        for (const f of drift.fields)
          lines.push(
            `    ${f.field.padEnd(24)} 台账=${f.ledger}\n    ${" ".repeat(24)} 重跑=${f.rerun}`,
          );
      }
      lines.push(`处置见 ${DOC_ANCHOR}`);
      console.error(lines.join("\n"));
      process.exit(1);
    }
    const count = rerun.reduce((sum, e) => sum + e.digests.length, 0);
    total += count;
    console.log(`  ${m.id}:10 seed ✓(${count} 笔摘要,${Math.round(performance.now() - tMap)}ms)`);
  }
  console.log(
    `黄金台账全绿:${MAPS.length} 图 × ${SEEDS.length} 种子,共 ${total} 笔摘要逐位一致,总耗时 ${Math.round(performance.now() - t0)}ms`,
  );
}

// ── 刷新模式:重生成台账,打印新旧摘要差异(不静默);首版新建也明说 ──
function updateAll(): void {
  const t0 = performance.now();
  mkdirSync(GOLDENS_DIR, { recursive: true });
  for (const m of MAPS) {
    const where = ledgerPath(m.id);
    const oldRaw = existsSync(where) ? readFileSync(where, "utf-8") : null;
    const oldCorpus = oldRaw != null ? parseLedger(m.id, oldRaw) : null;
    const fresh = runCorpus(m.id, loadMap(m.data));
    const count = fresh.reduce((sum, e) => sum + e.digests.length, 0);
    if (oldCorpus == null) {
      console.log(`  ${m.id}:新建台账(${count} 笔摘要)`);
    } else {
      const drift = firstDriftOf(oldCorpus, fresh);
      if (drift == null) {
        console.log(
          `  ${m.id}:与旧台账逐位一致(0 笔差,${count} 笔摘要)——确认刷新意图,台账原样重写`,
        );
      } else {
        const changed = countChangedRecords(oldCorpus, fresh);
        const at =
          drift.digest != null
            ? `首漂 seed ${drift.seed} turn ${drift.digest.turn}`
            : `首漂 seed ${drift.seed} 第 ${drift.index + 1} 笔(笔数差)`;
        console.log(`  ${m.id}:${count} 笔摘要中 ${changed} 笔与旧台账不同(${at})`);
      }
    }
    const payload: LedgerFile = { format: LEDGER_FORMAT, corpus: fresh };
    writeFileSync(where, renderLedger(payload), "utf-8");
  }
  console.log(
    `台账已刷新:${MAPS.length} 图 × ${SEEDS.length} 种子 → ${GOLDENS_DIR}(总耗时 ${Math.round(performance.now() - t0)}ms;台账 diff 与代码同 PR 入库)`,
  );
}

/** 逐 seed 对齐数「内容不同的笔数」(含长度差),刷新汇总用。 */
function countChangedRecords(old: LedgerCorpusEntry[], fresh: LedgerCorpusEntry[]): number {
  let changed = 0;
  for (let ci = 0; ci < fresh.length; ci++) {
    const a = old[ci].digests;
    const b = fresh[ci].digests;
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) if (JSON.stringify(a[i]) !== JSON.stringify(b[i])) changed += 1;
    changed += Math.abs(a.length - b.length);
  }
  return changed;
}

/** 台账落盘排版:骨架缩进、每笔摘要记录压成一行(紧凑 JSON)——记录是机器产物的
 *  机器断言面,逐笔一行的价值在评审:台账 diff 中「变了的回合」逐行可见,且
 *  空白开销减半(guanzhong 语料单文件 ~4MB 级,距 repo 快照 5MiB 上限留足余量;
 *  首版缩进排版实测贴线,故定此排版并冻结为可解析格式——JSON.parse 不挑空白)。 */
function renderLedger(file: LedgerFile): string {
  const out: string[] = ["{", `  "format": ${LEDGER_FORMAT},`, '  "corpus": ['];
  file.corpus.forEach((entry, ci) => {
    out.push("    {");
    out.push(`      "seed": ${entry.seed},`);
    out.push(`      "seats": ${JSON.stringify(entry.seats)},`);
    out.push('      "digests": [');
    entry.digests.forEach((r, di) => {
      out.push(`        ${JSON.stringify(r)}${di < entry.digests.length - 1 ? "," : ""}`);
    });
    out.push("      ]");
    out.push(`    }${ci < file.corpus.length - 1 ? "," : ""}`);
  });
  out.push("  ]");
  out.push("}");
  return out.join("\n") + "\n";
}

// ── 入口(严格解析:update 是唯一子命令,其余当场抛)──
const argv = process.argv.slice(2);
if (argv.length === 0) checkAll();
else if (argv.length === 1 && argv[0] === "update") updateAll();
else throw new Error(`用法:bun scripts/check-goldens.ts [update](收到:${argv.join(" ")})`);
