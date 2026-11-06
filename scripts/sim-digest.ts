// 单局逐回合摘要导出(#1161):固定 (图, seed) 跑一局全 bot,stdout 出逐回合摘要表 +
// --json 落完整摘要文件。三用:①票二黄金台账的语料入口;②确定性先红时逐回合对表的
// 诊断取证;③单局耗时记录(完成门证据)。驱动/摘要单源在 whole-game.ts/state-digest.ts,
// 本文件只做参数解析与呈现(严格解析,非法当场抛,零兜底,同 sim-batch 口径)。
//
// 用法:bun scripts/sim-digest.ts <seed> [--map <id>] [--seats <2-4>] [--json <path>] [--no-encounter]
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { builtinMapCatalog, loadBuiltinMapById } from "./engine-helpers";
import { runWholeGame } from "./whole-game";
import type { SeatConfig } from "../src/core/authority";

// ── 参数(严格解析:非法当场抛,零兜底)──
function intValue(raw: string, label: string): number {
  if (!/^-?\d+$/.test(raw)) throw new Error(`${label} 必须为整数,收到:${raw}`);
  return parseInt(raw, 10);
}
const argv = process.argv.slice(2);
const positionals: string[] = [];
const flags = new Map<string, string>();
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
if (positionals.length !== 1)
  throw new Error(
    `用法:bun scripts/sim-digest.ts <seed> [--map <id>] [--seats <2-4>] [--json <path>] [--no-encounter]`,
  );
const SEED = intValue(positionals[0], "seed");
const mapId = flags.get("map") ?? builtinMapCatalog()[0].id;
const map = loadBuiltinMapById(mapId);
const seatsRaw = flags.get("seats");
const SEATS_N = seatsRaw !== undefined ? intValue(seatsRaw, "--seats") : 4;
if (!(SEATS_N >= 2 && SEATS_N <= 4))
  throw new Error(`--seats 必须 2-4(国号池四家),收到:${SEATS_N}`);
const ENCOUNTER_ON = !flags.has("no-encounter");
const JSON_OUT = flags.get("json");

// ── 跑局 + 计时 ──
const seats: SeatConfig[] = Array.from({ length: SEATS_N }, (_, i) => ({
  name: `诸侯 ${i + 1}`,
  isBot: true,
}));
const t0 = performance.now();
const result = runWholeGame({
  map,
  mapId,
  seed: SEED,
  seats,
  encounter: ENCOUNTER_ON ? undefined : { enabled: false },
});
const elapsedMs = Math.round(performance.now() - t0);

// ── 呈现 ──
console.log(
  `═══ sim-digest:seed ${SEED} @ ${mapId}(${SEATS_N} bot · 机遇${ENCOUNTER_ON ? "开" : "关"})═══`,
);
console.log(
  `${result.finished ? `终局` : "未终局(触回合上限)"} · ${result.rounds} 轮 · ${result.digests.length} 笔摘要 · 单局耗时 ${elapsedMs}ms`,
);
for (const d of result.digests) {
  const last = d.events[d.events.length - 1];
  console.log(
    `  t${String(d.turn).padStart(4)} r${String(d.round).padStart(3)} ${d.turnPhase.padEnd(22)} act=${d.activeIndex} rng=${String(d.rngState).padEnd(10)} ev=${String(d.events.length).padStart(2)}${last ? ` last=${last.kind}` : ""}  ${d.stateHash.slice(0, 12)} log:${d.logHash.slice(0, 8)}#${d.logCount}`,
  );
}
const winner = result.engine.winner;
console.log(
  `胜者:${winner ? `${winner.name}(${winner.guohao})` : "无"} · 末摘要 ${result.digests[result.digests.length - 1].stateHash.slice(0, 12)}`,
);

// ── JSON 导出 ──
if (JSON_OUT !== undefined) {
  const outPath = resolve(JSON_OUT);
  const payload = {
    mapId,
    seed: SEED,
    seats: SEATS_N,
    encounter: ENCOUNTER_ON,
    elapsedMs,
    finished: result.finished,
    rounds: result.rounds,
    digests: result.digests,
  };
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(payload, null, 2));
  console.log(`逐回合摘要已落 ${outPath}`);
}
