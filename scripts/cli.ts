// 纯 CLI:每命令一进程,引擎状态持久到 state.json(默认 ./state.json,--state path 覆盖)。
// 运行:npx tsx scripts/cli.ts <command> [args] [--state path]
// 流程:load state.json → 重建引擎(restore) → 执行命令 → save state.json → stdout 输出 JSON。
// import 用相对路径(Node 不认 vite alias)。
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import sanguoData from "../public/maps/sanguo.json" with { type: "json" };
import { loadMap } from "../src/core/board-loader";
import { GameEngine } from "../src/core/game";
import type { SeatConfig } from "../src/core/game";
import type { GameCommand, TurnPhase } from "../src/core/types";
import { createDice } from "../src/core/dice";

const map = loadMap(sanguoData);

// ──────────────────────────── arg 解析 ────────────────────────────
interface ParsedArgs {
  positionals: string[];
  flags: Record<string, string>; // --key value 形式
}
function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      // 布尔短形(--flag)后跟另一个 -- 视为真;否则取下一个值
      if (next === undefined || next.startsWith("--")) {
        flags[key] = "true";
      } else {
        flags[key] = next;
        i++;
      }
    } else {
      positionals.push(a);
    }
  }
  return { positionals, flags };
}

// ──────────────────────────── state 持久化 ────────────────────────────
interface PersistedState {
  snapshot: ReturnType<GameEngine["snapshot"]>;
  config: {
    seats: SeatConfig[];
    targetNetWorth?: number;
    startingCash?: number;
    seed?: number;
  };
}

function statePath(flags: Record<string, string>): string {
  return resolve(flags.state ?? "./state.json");
}

function loadEngine(path: string): GameEngine {
  if (!existsSync(path)) {
    throw new Error(`state 文件不存在:${path}(先运行 new 命令开新局)`);
  }
  const raw = JSON.parse(readFileSync(path, "utf-8")) as PersistedState;
  const cfg = raw.config;
  // 用保存时的 config 重建一个引擎(只为了让 readonly 字段就位),然后覆盖可变状态
  const engine = new GameEngine(map.board, map.catalog, createDice(cfg.seed), {
    seats: cfg.seats,
    targetNetWorth: cfg.targetNetWorth,
    startingCash: cfg.startingCash,
    seed: cfg.seed,
  });
  engine.restoreFromSnapshot(raw.snapshot);
  return engine;
}

function saveEngine(path: string, engine: GameEngine, config: PersistedState["config"]): void {
  const state: PersistedState = { snapshot: engine.snapshot(), config };
  writeFileSync(path, JSON.stringify(state, null, 2), "utf-8");
}

// ──────────────────────────── 状态摘要(供 status / 命令后输出) ────────────────────────────
function statusOf(e: GameEngine) {
  const s = e.snapshot();
  return {
    phase: s.phase,
    setupPhase: s.setupPhase,
    turnPhase: s.turnPhase,
    activeIndex: s.activeIndex,
    active: s.players[s.activeIndex]?.guohao ?? null,
    isOver: s.isOver,
    winner: s.winner ? s.players.find((p) => p.id === s.winner)?.guohao ?? null : null,
    winReason: s.winReason,
    turnNumber: s.turnNumber,
    round: s.round,
    lastRoll: s.lastRoll?.die ?? null,
    branchStartTile: s.branchStartTile,
    rngState: s.rngState,
    players: s.players.map((p) => ({
      guohao: p.guohao,
      isBot: p.isBot,
      cash: p.cash,
      netWorth: p.netWorth,
      warrants: p.warrants,
      position: p.position,
      capitalIndex: p.capitalIndex,
      isBankrupt: p.isBankrupt,
      onBranch: p.onBranch,
      skipTurns: p.skipTurns,
      treasures: p.treasures.length,
      properties: p.properties.length,
      heroes: p.heroes.length,
    })),
    prompt: promptFor(s.phase, s.setupPhase, s.turnPhase, s.players[s.activeIndex]?.guohao, s.players[s.activeIndex]?.isBot),
  };
}

function promptFor(
  phase: string,
  setupPhase: string,
  tp: TurnPhase,
  guohao: string | undefined,
  isBot: boolean | undefined,
): string {
  if (!guohao) return "";
  const who = `${guohao}${isBot ? "(bot)" : ""}`;
  if (phase === "GameOver") return "游戏结束";
  if (phase === "Setup") {
    if (setupPhase === "Guohao") return `${who} 选国号(cmd 不支持,用 new 时 seats 带入)`;
    if (setupPhase === "PickCapital") {
      const idx = guohao; // 提示当前选都玩家
      return `${idx} 选都:pick-capital <tileIndex>(auto-setup 自动跑完)`;
    }
    return `${who} 开局中…`;
  }
  switch (tp) {
    case "Roll":
      return `${who} 的回合:掷骰(roll)`;
    case "AwaitingCapitalHalt":
      return `${who} 到达都城:驻跸(halt)或继续行军(continue)`;
    case "AwaitingBranch":
      return `${who} 到达辅路入口:走大路(main)或入辅路(branch)`;
    case "AwaitingDecision":
      return `${who} 落城:购买(buy)/扩军(upgrade)/跳过(skip)`;
    case "AwaitingHeroPick":
      return `${who} 招贤纳士:选名士(cmd {"type":"resolveHeroPick","index":0..2})`;
    case "AwaitingTreasureOwner":
      return `${who} 城主抉择:赠宝(gift <id>)/贸易(trade <id>)/跳过(tskip)`;
    case "AwaitingBankruptcySettle":
      return `${who} 破产清算:变卖(cmd {"type":"sellTreasureBankruptcy",...})或结算(confirm)`;
    case "Land":
    case "EndTurn":
      return `${who} 结算中…(状态过渡,无需操作)`;
    default:
      return `${who} 状态:${tp}`;
  }
}

// ──────────────────────────── 命令实现 ────────────────────────────
function cmdNew(flags: Record<string, string>): { engine: GameEngine; config: PersistedState["config"] } {
  const seatsNum = parseInt(flags.seats ?? "2", 10);
  if (!(seatsNum >= 2 && seatsNum <= 4)) throw new Error("--seats 必须 2-4");
  const botIdx = new Set(
    (flags.bot ?? "").split(",").map((s) => s.trim()).filter(Boolean).map((s) => parseInt(s, 10)),
  );
  const target = flags.target !== undefined ? parseInt(flags.target, 10) : undefined;
  const seed = flags.seed !== undefined ? parseInt(flags.seed, 10) : undefined;

  const seats: SeatConfig[] = [];
  for (let i = 0; i < seatsNum; i++) {
    seats.push({
      name: `座 ${i + 1}`,
      isBot: botIdx.has(i),
      // guohao 留空,doDraftRoll 会从字池分配(对 bot 必要,对人类也省事)
    });
  }
  const engine = new GameEngine(map.board, map.catalog, createDice(seed), {
    seats,
    targetNetWorth: target,
    seed,
  });
  engine.doDraftRoll();
  return { engine, config: { seats, targetNetWorth: target, seed } };
}

function autoSetup(e: GameEngine): void {
  let guard = 0;
  while (e.phase === "Setup" && guard++ < 100) {
    const idx = e.currentSetupPlayerIndex;
    if (idx < 0) break;
    if (e.players[idx].isBot) {
      e.aiSetupStep();
    } else {
      const cap = e.firstAvailableCapitalIndex();
      if (cap < 0) break;
      e.pickCapital(idx, cap);
    }
  }
}

function boardOf(e: GameEngine) {
  const tiles = e.board.tiles.map((t) => {
    const def = e.catalog.get(t.propertyId);
    const owner = t.propertyId ? e.findOwner(t.propertyId) : null;
    const holding = owner && def ? owner.properties.find((h) => h.propertyId === def.id) : undefined;
    return {
      index: t.index,
      id: t.propertyId,
      name: t.name,
      type: t.type,
      region: t.region,
      group: def?.group,
      owner: owner?.guohao ?? null,
      level: holding?.level ?? 0,
    };
  });
  return {
    tiles,
    branch: e.board.branch
      ? { start: e.board.branch.startNode, end: e.board.branch.endNode, cells: e.board.branch.cells.map((c, i) => ({ step: i, kind: c.kind })) }
      : null,
  };
}

// ──────────────────────────── main ────────────────────────────
function main(): void {
  const argv = process.argv.slice(2);
  if (argv.length === 0) {
    console.error(JSON.stringify({ ok: false, error: "缺少命令。用法:cli.ts <command> [args] [--state path]" }, null, 2));
    process.exit(2);
  }
  const { positionals, flags } = parseArgs(argv);
  const command = positionals[0];
  const path = statePath(flags);

  try {
    // 查询命令(不改状态,无需 save)
    if (command === "help" || command === "--help" || command === "-h") {
      console.log(JSON.stringify({
        commands: {
          "new [--seats N] [--seed S] [--bot 0,1] [--target T]": "开新局(创建引擎 → doDraftRoll → 存)",
          "auto-setup": "自动跑选都到 Playing",
          "pick-capital <tileIndex>": "当前玩家选都",
          "roll": "掷骰(rollAndMove)",
          "buy | upgrade | skip": "购买/扩军/跳过(AwaitingDecision)",
          "halt | continue": "驻跸/继续行军(AwaitingCapitalHalt)",
          "main | branch": "走大路/入辅路(AwaitingBranch)",
          "gift <id> | trade <id> | tskip": "赠宝/贸易/跳过(AwaitingTreasureOwner)",
          "confirm": "破产清算结算(AwaitingBankruptcySettle)",
          "cmd <json>": "任意 GameCommand(JSON 字符串)",
          "status": "当前状态摘要 + prompt",
          "log [n]": "最近 n 条战报(默认 20)",
          "board": "棋盘 tile 列表(owner/level)",
          "full": "完整 snapshot",
        },
        options: { "--state path": "状态文件路径(默认 ./state.json)" },
      }, null, 2));
      return;
    }

    if (command === "new") {
      const { engine, config } = cmdNew(flags);
      saveEngine(path, engine, config);
      console.log(JSON.stringify({ ok: true, command: "new", ...statusOf(engine) }, null, 2));
      return;
    }

    // 其他命令都需要加载引擎
    const engine = loadEngine(path);
    // 取回 config 以便保存(查询命令也需要写回,以防 rngState/log 变化)
    const persisted = JSON.parse(readFileSync(path, "utf-8")) as PersistedState;
    const config = persisted.config;

    switch (command) {
      case "auto-setup": {
        autoSetup(engine);
        saveEngine(path, engine, config);
        console.log(JSON.stringify({ ok: true, command: "auto-setup", ...statusOf(engine) }, null, 2));
        return;
      }
      case "pick-capital": {
        const tileIndex = parseInt(positionals[1] ?? "", 10);
        if (!Number.isFinite(tileIndex)) throw new Error("用法:pick-capital <tileIndex>");
        const idx = engine.currentSetupPlayerIndex;
        if (idx < 0) throw new Error("非选都阶段");
        const r = engine.pickCapital(idx, tileIndex);
        saveEngine(path, engine, config);
        console.log(JSON.stringify({ ok: r.ok, reason: r.reason, command: "pick-capital", ...statusOf(engine) }, null, 2));
        return;
      }
      case "roll": {
        engine.submitCommand({ type: "rollAndMove" });
        saveEngine(path, engine, config);
        console.log(JSON.stringify({ ok: true, command: "roll", ...statusOf(engine) }, null, 2));
        return;
      }
      case "buy": {
        engine.submitCommand({ type: "buyProperty" });
        saveEngine(path, engine, config);
        console.log(JSON.stringify({ ok: true, command: "buy", ...statusOf(engine) }, null, 2));
        return;
      }
      case "upgrade": {
        engine.submitCommand({ type: "upgradeProperty" });
        saveEngine(path, engine, config);
        console.log(JSON.stringify({ ok: true, command: "upgrade", ...statusOf(engine) }, null, 2));
        return;
      }
      case "skip": {
        engine.submitCommand({ type: "endDecision" });
        saveEngine(path, engine, config);
        console.log(JSON.stringify({ ok: true, command: "skip", ...statusOf(engine) }, null, 2));
        return;
      }
      case "halt": {
        engine.submitCommand({ type: "haltAtCapital" });
        saveEngine(path, engine, config);
        console.log(JSON.stringify({ ok: true, command: "halt", ...statusOf(engine) }, null, 2));
        return;
      }
      case "continue": {
        engine.submitCommand({ type: "continueMove" });
        saveEngine(path, engine, config);
        console.log(JSON.stringify({ ok: true, command: "continue", ...statusOf(engine) }, null, 2));
        return;
      }
      case "main": {
        engine.submitCommand({ type: "selectBranch", kind: "Main" });
        saveEngine(path, engine, config);
        console.log(JSON.stringify({ ok: true, command: "main", ...statusOf(engine) }, null, 2));
        return;
      }
      case "branch": {
        engine.submitCommand({ type: "selectBranch", kind: "Branch" });
        saveEngine(path, engine, config);
        console.log(JSON.stringify({ ok: true, command: "branch", ...statusOf(engine) }, null, 2));
        return;
      }
      case "gift": {
        const treasureId = positionals[1];
        if (!treasureId) throw new Error("用法:gift <treasureId>");
        engine.submitCommand({ type: "resolveTreasureOwner", action: { type: "gift", treasureId } });
        saveEngine(path, engine, config);
        console.log(JSON.stringify({ ok: true, command: "gift", ...statusOf(engine) }, null, 2));
        return;
      }
      case "trade": {
        const treasureId = positionals[1];
        if (!treasureId) throw new Error("用法:trade <treasureId>");
        engine.submitCommand({ type: "resolveTreasureOwner", action: { type: "trade", treasureId } });
        saveEngine(path, engine, config);
        console.log(JSON.stringify({ ok: true, command: "trade", ...statusOf(engine) }, null, 2));
        return;
      }
      case "tskip": {
        engine.submitCommand({ type: "resolveTreasureOwner", action: { type: "skip" } });
        saveEngine(path, engine, config);
        console.log(JSON.stringify({ ok: true, command: "tskip", ...statusOf(engine) }, null, 2));
        return;
      }
      case "confirm": {
        engine.submitCommand({ type: "confirmBankruptcySettle" });
        saveEngine(path, engine, config);
        console.log(JSON.stringify({ ok: true, command: "confirm", ...statusOf(engine) }, null, 2));
        return;
      }
      case "cmd": {
        const jsonStr = positionals[1];
        if (!jsonStr) throw new Error("用法:cmd <json>(GameCommand JSON 字符串)");
        const cmd = JSON.parse(jsonStr) as GameCommand;
        engine.submitCommand(cmd);
        saveEngine(path, engine, config);
        console.log(JSON.stringify({ ok: true, command: "cmd", cmd, ...statusOf(engine) }, null, 2));
        return;
      }
      case "status": {
        // 纯查询,不 save(rngState 没变,无需写回)
        console.log(JSON.stringify({ ok: true, command: "status", ...statusOf(engine) }, null, 2));
        return;
      }
      case "log": {
        const n = parseInt(positionals[1] ?? "20", 10);
        const entries = engine.log.slice(-n);
        console.log(JSON.stringify({ ok: true, command: "log", count: entries.length, entries }, null, 2));
        return;
      }
      case "board": {
        console.log(JSON.stringify({ ok: true, command: "board", ...boardOf(engine) }, null, 2));
        return;
      }
      case "full": {
        console.log(JSON.stringify({ ok: true, command: "full", snapshot: engine.snapshot() }, null, 2));
        return;
      }
      default:
        throw new Error(`未知命令:${command}(help 查看可用命令)`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(JSON.stringify({ ok: false, error: msg }, null, 2));
    process.exit(1);
  }
}

main();
