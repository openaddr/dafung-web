// 纯 CLI 对局 + LLM 演练线:每命令一进程,引擎状态持久到 state 文件(默认 data/cli-state.json,--state path 覆盖)。
// LLM 演练线:new 全参数面开局 → auto-setup → auto(stoppedBy=human 停等)→ 人类按
// status.prompt / choices / reaction 发命令推进,循环到终局;全 bot 局可 run-to-end 一步跑完。
// 共享层(地图/序列化/状态摘要)在 ./engine-helpers,与 server.ts 复用;
// bot 驱动的相位正典 = src/core/bot.ts 的 BOT_ATTENDED_PHASES。
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { GameEngine } from "../src/core/authority";
import type { SeatConfig } from "../src/core/authority";
import type { GameCommand } from "../src/core/authority";
import type { AiDifficulty } from "../src/core/authority";
import { parseEncounterFile, type EncounterConfig } from "../src/core/encounters";
import { botAct, BOT_ATTENDED_PHASES } from "../src/core/bot";
import { reactionQueriedSeats } from "./bot-driver";
import { fingerprint } from "./seat-projection";
import {
  createEngine,
  loadEngineAt,
  saveEngineAt,
  autoSetup,
  statusOf,
  boardOf,
  builtinMapCatalog,
  loadBuiltinMapById,
  type GameConfig,
} from "./engine-helpers";
import { loadExtensionPackages } from "../src/core/extension-loader";

// ──────────────────────────── 扩展包装载(#412,与 server.ts 同口径)────────────────────────────
// 每命令一进程:启动即装载 extensions/(名将/效果/问询注册进引擎注册面,CLI 对局与
// 服务器/单机同规则)。零兜底口径同 server.ts:坏包当场炸;空目录 = 合法零包。
// stdout 只出命令 JSON(脚本消费面),装载诊断不打印。
const EXTENSIONS_DIR = resolve(process.env.EXTENSIONS_DIR ?? "./extensions");
await loadExtensionPackages(EXTENSIONS_DIR);

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
// 持久化(序列化/restore)在 engine-helpers,这里只决定 state 文件路径。
function statePath(flags: Record<string, string>): string {
  return resolve(flags.state ?? "data/cli-state.json");
}

// ──────────────────────────── new 参数解析 ────────────────────────────
/** 整数 flag:缺失 undefined,非整数(含「12abc」类 parseInt 截断)显式抛——
 *  seed/starting-cash 等是重放要素,静默截断 = 污染局头。 */
function intFlag(flags: Record<string, string>, key: string): number | undefined {
  if (flags[key] === undefined) return undefined;
  if (!/^-?\d+$/.test(flags[key])) throw new Error(`--${key} 必须为整数,收到:${flags[key]}`);
  return parseInt(flags[key], 10);
}

function parseDifficulty(v: string): AiDifficulty {
  if (v !== "Simple" && v !== "Normal")
    throw new Error(`--difficulty 只收 Simple|Normal,收到:${v}`);
  return v;
}

/** --encounter 解析:"jiyu" = 产品默认配置(public/config/jiyu.json);其余按路径读。
 *  parseEncounterFile 返回 null(结构不齐)即抛错——机遇配置是重放要素(触发判定消耗
 *  骰流),坏配置不许静默降级。 */
function loadEncounterCfg(spec: string): EncounterConfig {
  const path = spec === "jiyu" ? resolve("public/config/jiyu.json") : resolve(spec);
  const cfg = parseEncounterFile(JSON.parse(readFileSync(path, "utf-8")));
  if (!cfg) throw new Error(`机遇配置无效(triggerRate/baseRates 结构不齐):${path}`);
  return cfg;
}

function cmdNew(flags: Record<string, string>): { engine: GameEngine; config: GameConfig } {
  const seatsNum = parseInt(flags.seats ?? "2", 10);
  if (!(seatsNum >= 2 && seatsNum <= 4)) throw new Error("--seats 必须 2-4");
  const botIdx = new Set(
    (flags.bot ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => parseInt(s, 10)),
  );
  const target = intFlag(flags, "target");
  const seed = intFlag(flags, "seed");
  const startingCash = intFlag(flags, "starting-cash");
  const reactionWindowMs = intFlag(flags, "reaction-window-ms");
  // 地图:--map <id>,缺省 = 内置清单首项;未知 id 由 loadBuiltinMapById 抛错
  const mapId = flags.map ?? builtinMapCatalog()[0].id;
  const map = loadBuiltinMapById(mapId);
  const difficulty = flags.difficulty !== undefined ? parseDifficulty(flags.difficulty) : undefined;
  const encounter = flags.encounter !== undefined ? loadEncounterCfg(flags.encounter) : undefined;

  const seats: SeatConfig[] = [];
  for (let i = 0; i < seatsNum; i++) {
    seats.push({
      name: `诸侯 ${i + 1}`,
      isBot: botIdx.has(i),
      // guohao 留空,doDraftRoll 会从字池分配(对 bot 必要,对人类也省事)
    });
  }
  // config 即落盘构造参数(mapId 为重放要素必带,ADR-0014;encounter/reactionWindowMs
  // 有则存,缺省语义 = 机遇关 / 反应窗查 core 常量表,与 EngineConfig 对齐)
  const config: GameConfig = {
    seats,
    targetNetWorth: target,
    ...(seed !== undefined && { seed }),
    ...(startingCash !== undefined && { startingCash }),
    ...(difficulty !== undefined && { difficulty }),
    mapId,
    ...(encounter !== undefined && { encounter }),
    ...(reactionWindowMs !== undefined && { reactionWindowMs }),
  };
  const engine = createEngine(config, true, map);
  return { engine, config };
}

// ──────────────────────────── auto 驱动(LLM 演练线)────────────────────────────
// 进展指纹单源 = seat-projection.fingerprint(联机侧正典,含 turnNumber/position/
// skipTurns/warrants 全量字段)。勿在 CLI 手抄缩水副本:缩水版看不见「破产位被跳 +
// 中伏跳过绕一圈回到原 active」这类零计数变化但真实前进的循环,会误判 idle(#442 dogfood 实锤)。

/** 当前决策点是否 bot 受控。被询问座位公式单源 = bot-driver.reactionQueriedSeats
 *  (scripts 层正典,与 app 层三层注释互指)。AwaitingReaction:bot 座位由引擎开窗同
 *  调用即席代答(ADR-0017,全 bot 被询问时相位不外显)→ 窗在必有未应答人类座位,
 *  没有即状态机不一致,抛错(零兜底),有人类待应答则停等。其余相位 = 决策方
 *  engine.decisionOwner(TreasureOwner=城主,其余折叠为 active)。 */
function botControls(e: GameEngine): boolean {
  if (e.phase !== "Playing") return false;
  if (e.turnPhase === "AwaitingReaction") {
    const pr = e.pendingReaction;
    if (pr == null) throw new Error("AwaitingReaction 相位 pendingReaction 缺失:状态机不一致"); // 零兜底
    const waitingHumans = reactionQueriedSeats(pr.view).filter(
      (seat) => !pr.answers.some((a) => a.seat === seat) && !e.players[seat].isBot,
    );
    if (waitingHumans.length === 0)
      throw new Error("反应窗在而无未应答人类座位:bot 座位应已即席代答收窗,状态机不一致");
    return false;
  }
  if (!BOT_ATTENDED_PHASES.has(e.turnPhase)) return false;
  return e.players[e.decisionOwner].isBot;
}

/** 连续驱动 bot 决策点直到:轮到人类(human)/ 游戏结束(over)/ 无进展(idle)。
 *  每步 botAct 前后比对指纹,不变即停(botAct 空转 = 状态机异常,交调用方暴露)。 */
function autoDrive(e: GameEngine): { stoppedBy: "human" | "over" | "idle"; steps: number } {
  let steps = 0;
  while (!e.isOver) {
    if (!botControls(e)) return { stoppedBy: "human", steps };
    const before = fingerprint(e);
    botAct(e);
    steps++;
    if (e.isOver) return { stoppedBy: "over", steps };
    if (fingerprint(e) === before) return { stoppedBy: "idle", steps };
  }
  return { stoppedBy: "over", steps };
}

/** 提交命令并如实透出引擎是否接受:引擎对相位不符等非法命令是 warn 留痕 + 静默无操作
 *  (assertPhase 口径),此处比对指纹抓出未生效,reason = 末条系统警告——恒报 ok:true
 *  会让 LLM 以为命令成功而状态机原地没动(#441)。与 pick-capital 的 ok/reason 口径对齐。 */
function submitCmd(e: GameEngine, cmd: GameCommand): { ok: boolean; reason?: string } {
  const before = fingerprint(e);
  const logBefore = e.log.length;
  e.submitCommand(cmd);
  if (fingerprint(e) !== before) return { ok: true };
  const warn = e.log.slice(logBefore).find((ev) => ev.category === "system");
  return { ok: false, reason: warn ? warn.brief : "命令未产生状态变化(详见 log 末条)" };
}

// ──────────────────────────── main ────────────────────────────
function main(): void {
  const argv = process.argv.slice(2);
  if (argv.length === 0) {
    console.error(
      JSON.stringify(
        { ok: false, error: "缺少命令。用法:cli.ts <command> [args] [--state path]" },
        null,
        2,
      ),
    );
    process.exit(2);
  }
  const { positionals, flags } = parseArgs(argv);
  const command = positionals[0];
  const path = statePath(flags);

  try {
    // 查询命令(不改状态,无需 save)
    if (command === "help" || command === "--help" || command === "-h") {
      console.log(
        JSON.stringify(
          {
            commands: {
              "new [--seats N] [--bot 0,1] [--seed S] [--target T]":
                "开新局;参数面:--map <id>(缺省=内置清单首项)/ --difficulty Simple|Normal / --starting-cash N / --encounter jiyu|<路径>(缺省=机遇关)/ --reaction-window-ms N",
              "auto-setup": "自动跑选都到 Playing",
              auto: "连续驱动 bot 决策,直到轮到人类(stoppedBy=human)/终局(over)/无进展(idle)",
              "run-to-end": "全 bot 局一键跑完到终局(任一座位非 bot 即抛错)",
              "pick-capital <tileIndex>": "当前玩家选都",
              roll: "行军(rollAndMove)",
              "buy | upgrade | skip": "购地/扩军/跳过(AwaitingDecision)",
              "main | branch":
                "走大路/入辅路(AwaitingBranch;入辅路=本回合结束,下回合掷骰沿辅路推进)",
              "fair <id> | premium <id> | tskip": "公道买卖/坐地起价/跳过(AwaitingTreasureOwner)",
              confirm: "破产清算结算(AwaitingBankruptcySettle)",
              "cmd <json>": "任意 GameCommand(JSON 字符串)",
              status: "当前状态摘要 + prompt + choices + reaction",
              "log [n]": "最近 n 条战报(默认 20)",
              board: "棋盘 tile 列表(owner/level)",
              full: "完整 snapshot",
            },
            options: { "--state path": "状态文件路径(默认 data/cli-state.json,相对 cwd)" },
            注: "快捷命令(roll/buy/…/cmd)ok:false = 命令被引擎拒绝,reason 给原因(如相位不符)",
            "cmd JSON 示例(按相位)": {
              AwaitingEncounter:
                '{"type":"resolveEncounterChoice","index":0}(下标见 status.choices)',
              AwaitingExhaustion:
                '{"type":"resolveExhaustionChoice","index":0}(下标见 status.choices)',
              AwaitingJinnang:
                '{"type":"useJinnang","cardId":"<id>"} / {"type":"useJinnang","cardId":null}(今不用);待发动技 {"type":"useHeroSkill","skillId":"<id>"}',
              AwaitingReaction:
                '{"type":"respondReaction","seat":1,"use":false}(待应答座位见 status.reaction)',
            },
          },
          null,
          2,
        ),
      );
      return;
    }

    if (command === "new") {
      const { engine, config } = cmdNew(flags);
      saveEngineAt(path, engine, config);
      console.log(JSON.stringify({ ok: true, command: "new", ...statusOf(engine) }, null, 2));
      return;
    }

    // 其他命令都需要加载引擎(状态文件 → 按 config.mapId 重建;查询命令也写回,以防 rngState/log 变化)
    const { engine, config } = loadEngineAt(path);

    switch (command) {
      case "auto-setup": {
        autoSetup(engine);
        saveEngineAt(path, engine, config);
        console.log(
          JSON.stringify({ ok: true, command: "auto-setup", ...statusOf(engine) }, null, 2),
        );
        return;
      }
      case "auto": {
        const r = autoDrive(engine);
        saveEngineAt(path, engine, config);
        console.log(
          JSON.stringify(
            {
              ok: true,
              command: "auto",
              stoppedBy: r.stoppedBy,
              steps: r.steps,
              ...statusOf(engine),
            },
            null,
            2,
          ),
        );
        return;
      }
      case "run-to-end": {
        if (engine.players.some((p) => !p.isBot))
          throw new Error("run-to-end 仅限全 bot 局(有真人座位请用 auto)");
        if (engine.phase === "Setup") autoSetup(engine);
        const r = autoDrive(engine);
        // 全 bot 局唯一合法出口是终局;idle/human 都是引擎状态机 bug,该崩(零兜底)
        if (r.stoppedBy !== "over")
          throw new Error(
            `run-to-end 异常停止(${r.stoppedBy},steps=${r.steps}):全 bot 局必须跑完到终局,状态机 bug`,
          );
        saveEngineAt(path, engine, config);
        console.log(
          JSON.stringify(
            { ok: true, command: "run-to-end", steps: r.steps, ...statusOf(engine) },
            null,
            2,
          ),
        );
        return;
      }
      case "pick-capital": {
        const tileIndex = parseInt(positionals[1] ?? "", 10);
        if (!Number.isFinite(tileIndex)) throw new Error("用法:pick-capital <tileIndex>");
        const idx = engine.currentSetupPlayerIndex;
        if (idx < 0) throw new Error("非选都阶段");
        const r = engine.pickCapital(idx, tileIndex);
        saveEngineAt(path, engine, config);
        console.log(
          JSON.stringify(
            { ok: r.ok, reason: r.reason, command: "pick-capital", ...statusOf(engine) },
            null,
            2,
          ),
        );
        return;
      }
      case "roll": {
        const r = submitCmd(engine, { type: "rollAndMove" });
        saveEngineAt(path, engine, config);
        console.log(
          JSON.stringify({ ok: r.ok, reason: r.reason, command: "roll", ...statusOf(engine) }, null, 2),
        );
        return;
      }
      case "buy": {
        const r = submitCmd(engine, { type: "buyProperty" });
        saveEngineAt(path, engine, config);
        console.log(JSON.stringify({ ok: r.ok, reason: r.reason, command: "buy", ...statusOf(engine) }, null, 2));
        return;
      }
      case "upgrade": {
        const r = submitCmd(engine, { type: "upgradeProperty" });
        saveEngineAt(path, engine, config);
        console.log(
          JSON.stringify({ ok: r.ok, reason: r.reason, command: "upgrade", ...statusOf(engine) }, null, 2),
        );
        return;
      }
      case "skip": {
        const r = submitCmd(engine, { type: "endDecision" });
        saveEngineAt(path, engine, config);
        console.log(JSON.stringify({ ok: r.ok, reason: r.reason, command: "skip", ...statusOf(engine) }, null, 2));
        return;
      }
      case "main": {
        const r = submitCmd(engine, { type: "selectBranch", kind: "Main" });
        saveEngineAt(path, engine, config);
        console.log(JSON.stringify({ ok: r.ok, reason: r.reason, command: "main", ...statusOf(engine) }, null, 2));
        return;
      }
      case "branch": {
        const r = submitCmd(engine, { type: "selectBranch", kind: "Branch" });
        saveEngineAt(path, engine, config);
        console.log(JSON.stringify({ ok: r.ok, reason: r.reason, command: "branch", ...statusOf(engine) }, null, 2));
        return;
      }
      case "fair": {
        const treasureId = positionals[1];
        if (!treasureId) throw new Error("用法:fair <treasureId>");
        const r = submitCmd(engine, {
          type: "resolveTreasureOwner",
          action: { type: "fair", treasureId },
        });
        saveEngineAt(path, engine, config);
        console.log(JSON.stringify({ ok: r.ok, reason: r.reason, command: "fair", ...statusOf(engine) }, null, 2));
        return;
      }
      case "premium": {
        const treasureId = positionals[1];
        if (!treasureId) throw new Error("用法:premium <treasureId>");
        const r = submitCmd(engine, {
          type: "resolveTreasureOwner",
          action: { type: "premium", treasureId },
        });
        saveEngineAt(path, engine, config);
        console.log(
          JSON.stringify({ ok: r.ok, reason: r.reason, command: "premium", ...statusOf(engine) }, null, 2),
        );
        return;
      }
      case "tskip": {
        const r = submitCmd(engine, { type: "resolveTreasureOwner", action: { type: "skip" } });
        saveEngineAt(path, engine, config);
        console.log(JSON.stringify({ ok: r.ok, reason: r.reason, command: "tskip", ...statusOf(engine) }, null, 2));
        return;
      }
      case "confirm": {
        const r = submitCmd(engine, { type: "confirmBankruptcySettle" });
        saveEngineAt(path, engine, config);
        console.log(
          JSON.stringify({ ok: r.ok, reason: r.reason, command: "confirm", ...statusOf(engine) }, null, 2),
        );
        return;
      }
      case "cmd": {
        const jsonStr = positionals[1];
        if (!jsonStr) throw new Error("用法:cmd <json>(GameCommand JSON 字符串)");
        const cmd = JSON.parse(jsonStr) as GameCommand;
        const r = submitCmd(engine, cmd);
        saveEngineAt(path, engine, config);
        console.log(
          JSON.stringify({ ok: r.ok, reason: r.reason, command: "cmd", cmd, ...statusOf(engine) }, null, 2),
        );
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
        console.log(
          JSON.stringify({ ok: true, command: "log", count: entries.length, entries }, null, 2),
        );
        return;
      }
      case "board": {
        console.log(JSON.stringify({ ok: true, command: "board", ...boardOf(engine) }, null, 2));
        return;
      }
      case "full": {
        console.log(
          JSON.stringify({ ok: true, command: "full", snapshot: engine.snapshot() }, null, 2),
        );
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
