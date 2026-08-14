// 引擎 CLI/Server 共享层:地图加载 + 状态文件 I/O + 状态摘要 + bot 自动驱动。
// scripts/cli.ts(每命令一进程,状态落 state.json)与 scripts/server.ts(常驻 HTTP,
// 内存引擎 + 落盘)共同复用,保证两端同一地图、同一序列化格式、同一 bot 语义。
// import 用相对路径(Node 不认 vite alias);core/ 零 DOM,Node 直接可跑。
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import sanguoData from "../public/maps/sanguo.json" with { type: "json" };
import { loadMap, type LoadedMap } from "../src/core/board-loader";
import { GameEngine } from "../src/core/game";
import type { SeatConfig, EngineConfig } from "../src/core/game";
import type { TurnPhase, AiDifficulty } from "../src/core/types";
import { createDice } from "../src/core/dice";
import { botAct } from "../src/core/bot";

/** 共享地图(主路 + 辅路 + catalog)。CLI 与 Server 用同一份,避免漂移。 */
export const MAP: LoadedMap = loadMap(sanguoData);

// ──────────────────────────── 状态文件持久化(CLI 与 Server 共用格式) ────────────────────────────
// state.json = { snapshot, config }。snapshot 完整可序列化;config 保存构造参数,
// 这样 restoreFromSnapshot 时能用同 config 重建只读字段后再覆盖可变状态。
export interface GameConfig {
  seats: SeatConfig[];
  targetNetWorth?: number;
  startingCash?: number;
  difficulty?: AiDifficulty;
  seed?: number;
}

export interface PersistedState {
  snapshot: ReturnType<GameEngine["snapshot"]>;
  config: GameConfig;
}

/** 全新引擎:构造 +(可选)国号摇骰定序。不落盘。
 *  map 可选:传入则用该地图(联机每房间各持自己的 LoadedMap);省略则用默认 sanguo(CLI / 单机)。 */
export function createEngine(config: GameConfig, doDraft = true, map: LoadedMap = MAP): GameEngine {
  const engine = new GameEngine(map.board, map.catalog, createDice(config.seed), config satisfies EngineConfig);
  if (doDraft) engine.doDraftRoll();
  return engine;
}

export function loadEngineAt(path: string): { engine: GameEngine; config: GameConfig } {
  if (!existsSync(path)) {
    throw new Error(`state 文件不存在:${path}(先 new 开新局)`);
  }
  const raw = JSON.parse(readFileSync(path, "utf-8")) as PersistedState;
  // 用保存时的 config 重建一个引擎(只为了让 readonly 字段就位),然后覆盖可变状态
  const engine = createEngine(raw.config, false);
  engine.restoreFromSnapshot(raw.snapshot);
  return { engine, config: raw.config };
}

export function saveEngineAt(path: string, engine: GameEngine, config: GameConfig): void {
  const state: PersistedState = { snapshot: engine.snapshot(), config };
  writeFileSync(path, JSON.stringify(state, null, 2), "utf-8");
}

/** 自动跑完选都:Setup/PickCapital → Playing。bot 用 aiSetupStep,人类用首个可用都城。
 *  对纯 CLI / 服务器快速开局都很有用(人类逐个选都交由 Web UI 处理)。 */
export function autoSetup(e: GameEngine): void {
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

// ──────────────────────────── 状态摘要(供 /status 与 CLI 输出) ────────────────────────────
export function statusOf(e: GameEngine) {
  const s = e.snapshot();
  const activePlayer = s.players[s.activeIndex];
  return {
    phase: s.phase,
    setupPhase: s.setupPhase,
    turnPhase: s.turnPhase,
    activeIndex: s.activeIndex,
    active: activePlayer?.guohao ?? null,
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
    prompt: promptFor(
      s.phase,
      s.setupPhase,
      s.turnPhase,
      activePlayer?.guohao,
      activePlayer?.isBot,
      // 城主视角(AwaitingTreasureOwner):提示该谁抉择
      s.turnPhase === "AwaitingTreasureOwner" ? decisionOwnerGuohao(e) : undefined,
    ),
  };
}

/** AwaitingTreasureOwner 阶段,真正做抉择的是城主(可能 ≠ active 玩家)。
 *  归属座位统一走 engine.decisionOwner;treasureVisitor 缺失 → 无城主提示(原语义)。 */
function decisionOwnerGuohao(e: GameEngine): string | undefined {
  if (e.turnPhase !== "AwaitingTreasureOwner" || e.treasureVisitor == null) return undefined;
  return e.players[e.decisionOwner]?.guohao;
}

export function promptFor(
  phase: string,
  setupPhase: string,
  tp: TurnPhase,
  guohao: string | undefined,
  isBot: boolean | undefined,
  decisionOwner?: string,
): string {
  if (!guohao) return "";
  const who = `${guohao}${isBot ? "(bot)" : ""}`;
  if (phase === "GameOver") return "游戏结束";
  if (phase === "Setup") {
    if (setupPhase === "Guohao") return `${who} 选国号(cmd 不支持,用 new 时 seats 带入)`;
    if (setupPhase === "PickCapital") {
      return `${guohao} 选都:pick-capital <tileIndex>(auto-setup 自动跑完)`;
    }
    return `${who} 开局中…`;
  }
  switch (tp) {
    case "Roll":
      return `${who} 的回合:行军(roll)`;
    case "AwaitingCapitalHalt":
      return `${who} 到达都城:驻跸(halt)或继续行军(continue)`;
    case "AwaitingBranch":
      return `${who} 到达辅路入口:走大路(main)或入辅路(branch)`;
    case "AwaitingDecision":
      return `${who} 落城:购地(buy)/扩军(upgrade)/跳过(skip)`;
    case "AwaitingHeroPick":
      return `${who} 招贤纳士:选名士(cmd {"type":"resolveHeroPick","index":0..2})`;
    case "AwaitingTreasureOwner":
      return `${decisionOwner ?? who} 城主抉择:公道买卖(fair <id>)/坐地起价(premium <id>)/跳过(tskip)`;
    case "AwaitingBankruptcySettle":
      return `${who} 破产清算:变卖(cmd {"type":"sellTreasureBankruptcy",...})或结算(confirm)`;
    case "Land":
    case "EndTurn":
      return `${who} 结算中…(状态过渡,无需操作)`;
    default:
      return `${who} 状态:${tp}`;
  }
}

export function boardOf(e: GameEngine) {
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
      ? {
          start: e.board.branch.startNode,
          end: e.board.branch.endNode,
          cells: e.board.branch.cells.map((c, i) => ({ step: i, kind: c.kind })),
        }
      : null,
  };
}

// ──────────────────────────── bot 自动驱动 ────────────────────────────
// botAct 一次推进一个决策点;但要"轮到谁"取决于相位:大部分相位由 active 玩家抉择,
// AwaitingTreasureOwner 例外——城主(可能 ≠ 访客)抉择。归属判断统一走 engine.decisionOwner
// (收口,不再手抄 treasureVisitor 推导)。
export function botOwnsDecision(e: GameEngine): boolean {
  switch (e.turnPhase) {
    case "AwaitingTreasureOwner":
      // 城主抉择(可能 ≠ 访客)。treasureVisitor 缺失 → 非法状态,不驱动(与原语义一致)。
      if (e.treasureVisitor == null) return false;
      return e.players[e.decisionOwner]?.isBot === true;
    case "AwaitingBankruptcySettle":
    case "Roll":
    case "AwaitingCapitalHalt":
    case "AwaitingBranch":
    case "AwaitingDecision":
    case "AwaitingHeroPick":
      return e.activePlayer.isBot;
    default:
      return false;
  }
}

export type BotStopReason = "human" | "over" | "idle";

/** 连续驱动 bot 决策直到:轮到人类(human)/ 游戏结束(over)/ 无进展(idle 防死循环)。
 *  同步执行(服务器无动画需求)。每次 botAct 后取指纹,不变即停(正常情况下引擎保证进展)。 */
export function autoResolveBots(e: GameEngine): { reason: BotStopReason; steps: number } {
  let steps = 0;
  let guard = 0;
  while (e.phase !== "GameOver" && botOwnsDecision(e) && guard++ < 500) {
    const before = fingerprint(e);
    botAct(e);
    steps++;
    if (e.isOver) return { reason: "over", steps };
    if (fingerprint(e) === before) return { reason: "idle", steps }; // botAct 未改任何状态 → 交还人类
  }
  if (e.isOver || e.phase === "GameOver") return { reason: "over", steps };
  return { reason: botOwnsDecision(e) ? "idle" : "human", steps };
}

/** 廉价状态指纹:相位 + active + 选都进度 + 各玩家现金/珍宝/城/名士计数。任何真实进展都会改变它。 */
function fingerprint(e: GameEngine): string {
  return [
    e.phase,
    e.setupPhase,
    e.turnPhase,
    e.activeIndex,
    e.currentDraftIndex,
    e.players.map((p) => `${p.cash}:${p.treasures.length}:${p.properties.length}:${p.heroes.length}`).join(","),
  ].join("|");
}
