// 纯 CLI:每命令一进程,引擎状态持久到 state.json(默认 ./state.json,--state path 覆盖)。
// 运行:npx tsx scripts/cli.ts <command> [args] [--state path]
// 流程:load state.json → 重建引擎(restore) → 执行命令 → save state.json → stdout 输出 JSON。
// 共享层(地图/序列化/状态摘要)在 ./engine-helpers,与 server.ts 复用。
import { resolve } from "node:path";
import type { GameEngine } from "../src/core/game";
import type { SeatConfig } from "../src/core/game";
import type { GameCommand } from "../src/core/types";
import {
  createEngine,
  loadEngineAt,
  saveEngineAt,
  autoSetup,
  statusOf,
  boardOf,
  type GameConfig,
} from "./engine-helpers";

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

// ──────────────────────────── state 路径 ────────────────────────────
// 持久化(序列化/restore)在 engine-helpers,这里只决定 state.json 路径。
function statePath(flags: Record<string, string>): string {
  return resolve(flags.state ?? "./state.json");
}

// ──────────────────────────── 命令实现 ────────────────────────────
function cmdNew(flags: Record<string, string>): { engine: GameEngine; config: GameConfig } {
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
  const engine = createEngine({ seats, targetNetWorth: target, seed });
  return { engine, config: { seats, targetNetWorth: target, seed } };
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
          "fair <id> | premium <id> | tskip": "公道买卖/坐地起价/跳过(AwaitingTreasureOwner)",
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
      saveEngineAt(path, engine, config);
      console.log(JSON.stringify({ ok: true, command: "new", ...statusOf(engine) }, null, 2));
      return;
    }

    // 其他命令都需要加载引擎(状态文件 → 重建;查询命令也写回,以防 rngState/log 变化)
    const { engine, config } = loadEngineAt(path);

    switch (command) {
      case "auto-setup": {
        autoSetup(engine);
        saveEngineAt(path, engine, config);
        console.log(JSON.stringify({ ok: true, command: "auto-setup", ...statusOf(engine) }, null, 2));
        return;
      }
      case "pick-capital": {
        const tileIndex = parseInt(positionals[1] ?? "", 10);
        if (!Number.isFinite(tileIndex)) throw new Error("用法:pick-capital <tileIndex>");
        const idx = engine.currentSetupPlayerIndex;
        if (idx < 0) throw new Error("非选都阶段");
        const r = engine.pickCapital(idx, tileIndex);
        saveEngineAt(path, engine, config);
        console.log(JSON.stringify({ ok: r.ok, reason: r.reason, command: "pick-capital", ...statusOf(engine) }, null, 2));
        return;
      }
      case "roll": {
        engine.submitCommand({ type: "rollAndMove" });
        saveEngineAt(path, engine, config);
        console.log(JSON.stringify({ ok: true, command: "roll", ...statusOf(engine) }, null, 2));
        return;
      }
      case "buy": {
        engine.submitCommand({ type: "buyProperty" });
        saveEngineAt(path, engine, config);
        console.log(JSON.stringify({ ok: true, command: "buy", ...statusOf(engine) }, null, 2));
        return;
      }
      case "upgrade": {
        engine.submitCommand({ type: "upgradeProperty" });
        saveEngineAt(path, engine, config);
        console.log(JSON.stringify({ ok: true, command: "upgrade", ...statusOf(engine) }, null, 2));
        return;
      }
      case "skip": {
        engine.submitCommand({ type: "endDecision" });
        saveEngineAt(path, engine, config);
        console.log(JSON.stringify({ ok: true, command: "skip", ...statusOf(engine) }, null, 2));
        return;
      }
      case "halt": {
        engine.submitCommand({ type: "haltAtCapital" });
        saveEngineAt(path, engine, config);
        console.log(JSON.stringify({ ok: true, command: "halt", ...statusOf(engine) }, null, 2));
        return;
      }
      case "continue": {
        engine.submitCommand({ type: "continueMove" });
        saveEngineAt(path, engine, config);
        console.log(JSON.stringify({ ok: true, command: "continue", ...statusOf(engine) }, null, 2));
        return;
      }
      case "main": {
        engine.submitCommand({ type: "selectBranch", kind: "Main" });
        saveEngineAt(path, engine, config);
        console.log(JSON.stringify({ ok: true, command: "main", ...statusOf(engine) }, null, 2));
        return;
      }
      case "branch": {
        engine.submitCommand({ type: "selectBranch", kind: "Branch" });
        saveEngineAt(path, engine, config);
        console.log(JSON.stringify({ ok: true, command: "branch", ...statusOf(engine) }, null, 2));
        return;
      }
      case "fair": {
        const treasureId = positionals[1];
        if (!treasureId) throw new Error("用法:fair <treasureId>");
        engine.submitCommand({ type: "resolveTreasureOwner", action: { type: "fair", treasureId } });
        saveEngineAt(path, engine, config);
        console.log(JSON.stringify({ ok: true, command: "fair", ...statusOf(engine) }, null, 2));
        return;
      }
      case "premium": {
        const treasureId = positionals[1];
        if (!treasureId) throw new Error("用法:premium <treasureId>");
        engine.submitCommand({ type: "resolveTreasureOwner", action: { type: "premium", treasureId } });
        saveEngineAt(path, engine, config);
        console.log(JSON.stringify({ ok: true, command: "premium", ...statusOf(engine) }, null, 2));
        return;
      }
      case "tskip": {
        engine.submitCommand({ type: "resolveTreasureOwner", action: { type: "skip" } });
        saveEngineAt(path, engine, config);
        console.log(JSON.stringify({ ok: true, command: "tskip", ...statusOf(engine) }, null, 2));
        return;
      }
      case "confirm": {
        engine.submitCommand({ type: "confirmBankruptcySettle" });
        saveEngineAt(path, engine, config);
        console.log(JSON.stringify({ ok: true, command: "confirm", ...statusOf(engine) }, null, 2));
        return;
      }
      case "cmd": {
        const jsonStr = positionals[1];
        if (!jsonStr) throw new Error("用法:cmd <json>(GameCommand JSON 字符串)");
        const cmd = JSON.parse(jsonStr) as GameCommand;
        engine.submitCommand(cmd);
        saveEngineAt(path, engine, config);
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
