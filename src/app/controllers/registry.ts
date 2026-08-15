// 控制器注册表(模块级单例):App 各屏统一从这里取当前 GameController,
// 不把 controller 塞进 zustand(实例带方法/WS 连接等非序列化资源,同 engine 的理由,见 gameStore.ts 注释)。
// 单机开局(setup 屏/临时快速开局)调 setController 注册 LocalController;
// 联机(后续阶段)注册 OnlineController —— 屏幕组件对两种模式无感。
import type { MapData } from "@core/types";
import type { GameController } from "./controller";

let current: GameController | null = null;
/** 当前对局地图原始数据(MapData)。快照不含地图(体积考虑),BoardView 需要它重建棋盘。 */
let currentMap: MapData | null = null;

/** 注册新对局的控制器与地图(换局时旧 controller 会先 destroy 释放 WS 等资源)。 */
export function setController(controller: GameController | null, map: MapData | null = null): void {
  if (current && current !== controller) current.destroy();
  current = controller;
  currentMap = map;
}

/** 取当前控制器(null = 尚未开局)。屏幕组件用它做交互入口。 */
export function getController(): GameController | null {
  return current;
}

/** 取当前对局地图数据(BoardView 的 map prop 来源;null = 尚未开局)。 */
export function getControllerMap(): MapData | null {
  return currentMap;
}

// ──────────────────────────── window.__dafung 调试钩子 ────────────────────────────
// 重建旧 src/render/state.ts 的调试入口:控制台可直接读引擎/快照、手动触发重同步。
// 类型声明见 src/app/debug.d.ts(declare global,零运行时开销)。
import { getEngine, setEngine, useGameStore } from "@app/store/gameStore";

/** 在 main.tsx 挂载前调用一次;幂等(StrictMode 双调用安全)。 */
export function installDebugHooks(): void {
  const w = window as typeof window & { __dafung?: unknown };
  w.__dafung = {
    getEngine,
    setEngine,
    /** 当前 store 里的快照(god view;等价旧 __dafung.snapshot)。 */
    snapshot: () => useGameStore.getState().snapshot,
    /** 手动从引擎重灌快照(怀疑 UI 与引擎脱节时排查用)。 */
    sync: () => {
      const e = getEngine();
      if (e) useGameStore.getState().syncFromEngine(e);
    },
    /** 交互入口(等价旧 __dafung.debug 等;后续可按需扩充)。 */
    controller: () => getController(),
  };
}
