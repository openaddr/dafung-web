// 引擎 CLI：地图加载、状态文件 I/O 与棋盘摘要。
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import guanzhongData from "@dafung/core/maps/guanzhong.json" with { type: "json" };
import { loadMap, type LoadedMap } from "@dafung/core/engine/board-loader";
import { GameEngine, type EngineConfig, type SeatConfig } from "@dafung/core/engine/authority";
import { createDice } from "@dafung/core/engine/dice";
import { createBuiltinMapLoader, readMapCatalog } from "../apps/server/src/map-files";

export { statusOf } from "@dafung/core/room/room-status";

/** CLI 场景快捷入口，使用内置关中图。 */
export const MAP: LoadedMap = loadMap(guanzhongData);

const MAPS_DIR = resolve(
  process.env.MAPS_DIR ??
    dirname(fileURLToPath(import.meta.resolve("@dafung/core/maps/index.json"))),
);

export function builtinMapCatalog() {
  return readMapCatalog(MAPS_DIR);
}

export const loadBuiltinMapById = createBuiltinMapLoader(MAPS_DIR);

// ──────────────────────────── 状态文件持久化(CLI 与 Server 共用格式) ────────────────────────────
// state.json = { snapshot, config }。snapshot 完整可序列化;config 保存构造参数,
// 这样 restoreFromSnapshot 时能用同 config 重建只读字段后再覆盖可变状态。
export interface GameConfig {
  seats: SeatConfig[];
  /** 胜利线/起手现金:必配(ADR-0041 删引擎缺省);CLI 落盘前按地图顶层解析,旗标可显式覆盖 */
  targetNetWorth: number;
  startingCash: number;
  /** 起手珍宝(件/人,必配 #1100):CLI 落盘前按地图顶层解析;0=不发。 */
  startingTreasures: number;
  seed?: number;
  /** 地图 id(ADR-0014:随引擎写入对局日志局头,重放要素)。 */
  mapId?: string;
  /** 反应窗时长覆盖(#284):env E2E_REACTION_MS → registry → 引擎;缺省查 core 常量表。 */
  reactionWindowMs?: number;
}

export interface PersistedState {
  snapshot: ReturnType<GameEngine["snapshot"]>;
  config: GameConfig;
}

/** 全新引擎:构造 +(可选)国号摇骰定序。不落盘。
 *  map 可选:传入则用该地图(联机每房间各持自己的 LoadedMap);省略则用默认关中图(CLI / 单机)。 */
export function createEngine(config: GameConfig, doDraft = true, map: LoadedMap = MAP): GameEngine {
  const engine = new GameEngine(
    map.board,
    map.catalog,
    createDice(config.seed),
    config satisfies EngineConfig,
  );
  if (doDraft) engine.doDraftRoll();
  return engine;
}

export function loadEngineAt(path: string): { engine: GameEngine; config: GameConfig } {
  if (!existsSync(path)) {
    throw new Error(`state 文件不存在:${path}(先 new 开新局)`);
  }
  const raw = JSON.parse(readFileSync(path, "utf-8")) as PersistedState;
  // 按落盘 mapId 重建引擎(readonly 字段就位 + 同一张地图),再覆盖可变状态;
  // 旧格式 state 无 mapId → 显式抛错重开(无兼容负担,零兜底);
  // 起手现金/目标/起手珍宝缺任一同样拒载(旧格式在必配化之前落盘)。
  if (!raw.config.mapId) throw new Error("state 文件缺 mapId(旧格式):请 new 重开");
  if (raw.config.startingCash == null || raw.config.targetNetWorth == null)
    throw new Error("state 文件缺起手现金或目标线(旧格式):请 new 重开");
  if (raw.config.startingTreasures == null)
    throw new Error("state 文件缺 startingTreasures(旧格式):请 new 重开");
  const engine = createEngine(raw.config, false, loadBuiltinMapById(raw.config.mapId));
  engine.restoreFromSnapshot(raw.snapshot);
  return { engine, config: raw.config };
}

export function saveEngineAt(path: string, engine: GameEngine, config: GameConfig): void {
  mkdirSync(dirname(path), { recursive: true }); // I/O 卫生:父目录不存在则建
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

export function boardOf(e: GameEngine) {
  const tiles = e.board.tiles.map((t) => {
    const def = e.catalog.get(t.propertyId);
    const owner = t.propertyId ? e.findOwner(t.propertyId) : null;
    const holding =
      owner && def ? owner.properties.find((h) => h.propertyId === def.id) : undefined;
    return {
      index: t.index,
      id: t.propertyId,
      name: t.name,
      type: t.type,
      group: def?.group,
      owner: owner?.guohao ?? null,
      level: holding?.level ?? 0,
    };
  });
  return {
    tiles,
  };
}
