// 控制器注册表(模块级单例):App 各屏统一从这里取当前 GameController,
// 不把 controller 塞进 zustand(实例带方法/WS 连接等非序列化资源,同 engine 的理由,见 gameStore.ts 注释)。
// 单机开局(setup 屏/临时快速开局)调 setController 注册 LocalController;
// 联机(后续阶段)注册 OnlineController —— 屏幕组件对两种模式无感。
import type { Board } from "@core/board";
import type { MapCatalog } from "@core/board-loader";
import type { MapData } from "@core/types";
import type { GameController } from "./controller";

let current: GameController | null = null;
/** 当前对局地图原始数据(MapData)。快照不含地图(体积考虑),BoardView 需要它重建棋盘。 */
let currentMap: MapData | null = null;
/** 当前对局的静态查询上下文(board/catalog,Wave3 候选5):渲染层只读不可变地图数据,
 *  一律从这里取,不再伸手摸活引擎(getEngine/controller.engine)。两者随引擎构造而定、
 *  对局期间不变(联机换图=重建引擎后重新 setController),在此快照式持有即可。 */
let currentContext: { board: Board; catalog: MapCatalog } | null = null;

/** 注册新对局的控制器与地图(换局时旧 controller 会先 destroy 释放 WS 等资源)。 */
export function setController(controller: GameController | null, map: MapData | null = null): void {
  if (current && current !== controller) current.destroy();
  current = controller;
  currentMap = map;
  // 静态上下文取自当前引擎(board/catalog 是构造入参、对局期不可变,存引用无复制开销)。
  currentContext = controller ? { board: controller.engine.board, catalog: controller.engine.catalog } : null;
}

/** 取当前控制器(null = 尚未开局)。屏幕组件用它做交互入口。 */
export function getController(): GameController | null {
  return current;
}

/** 取当前对局地图数据(BoardView 的 map prop 来源;null = 尚未开局)。 */
export function getControllerMap(): MapData | null {
  return currentMap;
}

/** 取当前对局的静态查询上下文(board/catalog;null = 尚未开局)。
 *  渲染层(HandPanel/DecisionScrollLayer 等)查城名/地产定义用它——候选5 的
 *  「渲染层停止摸活引擎」:引擎可变态不再暴露给渲染组件,可变数据唯一来源=快照。 */
export function getControllerContext(): { board: Board; catalog: MapCatalog } | null {
  return currentContext;
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
