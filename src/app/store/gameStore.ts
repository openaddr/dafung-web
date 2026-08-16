// React 层的全局游戏状态(zustand):持有 engine.snapshot() 的可序列化数据 + UI 态。
// 这是旧 fullRender() 的新等价物——旧渲染层每次引擎变化后命令式重画 DOM,
// React 层改为:控制器每次引擎变化后调 syncFromEngine() 把 snapshot 灌进 store,
// 组件订阅 store 声明式重渲。
import { create } from "zustand";
import type { GameEngine } from "@core/game";
import type { LogEvent } from "@core/types";

/** 引擎快照类型(serializeGame 的返回结构;联机 snapshot 消息同构,可直灌 store)。 */
export type GameSnapshot = ReturnType<GameEngine["snapshot"]>;

/** 快照里的玩家行(含派生 netWorth,且 heroes/treasures 只带展示字段)。 */
export type SnapshotPlayer = GameSnapshot["players"][number];

/** 快照里的珍宝行(serializeGame 只序列化 id/name/level/desc,不含价字段——价格由
 *  展示层 guidePriceOf(level) 等推导)。卷轴组件的 props 按此声明,避免把快照珍宝
 *  断言成含价字段的完整 TreasureDef。 */
export type SnapshotTreasure = SnapshotPlayer["treasures"][number];

// ──────────────────────────── engine 引用管理 ────────────────────────────
// engine 是带方法/循环引用的可变实例,不属于响应式数据:
// ① 不序列化——zustand state 若混入 engine,DevTools/persist/浅比较全被污染;
// ② 不订阅——React 只该对"可渲染的数据"重渲,对实例本身不感兴趣;
// ③ 全局唯一——同一时刻只存在一局,模块级单例最干净(比藏在 store 的
//    non-reactive 字段好:不占用 store 类型,控制器/调试钩子可直接导入读写)。
let currentEngine: GameEngine | null = null;

/** 取当前引擎实例(无对局时 null)。控制器与调试钩子用它做命令入口。 */
export function getEngine(): GameEngine | null {
  return currentEngine;
}

/** 绑定新引擎(单机开局 / 联机换图重建占位引擎时调用)。 */
export function setEngine(engine: GameEngine | null): void {
  currentEngine = engine;
}

// ──────────────────────────── store 定义 ────────────────────────────

/** 应用当前屏(setup = 首页;solo-setup = 单机配置页;lobby = 联机大厅;editor = 地图编辑器)。 */
export type Screen = "setup" | "solo-setup" | "lobby" | "game" | "editor";

export interface GameStoreState {
  // ── 引擎数据(快照;null = 尚未开局)──
  snapshot: GameSnapshot | null;
  /** 本地视角座位(单机=当前活跃人类座位;联机=自己分到的 seat;-1 = 未入座)。 */
  viewSeat: number;
  /** 此刻本地玩家能否操作(由控制器判定写入:UI 不自行推导,保持单一来源)。 */
  interactive: boolean;

  // ── UI 态 ──
  screen: Screen;
  /** 提示文案(旧 flashHint 的新等价物;null = 不显示)。 */
  hint: string | null;
  /** 思考中标记(旧 setThinking:等待 bot/远程玩家行动时显示"运筹中…")。 */
  thinking: boolean;

  // ── actions ──
  /** 读引擎 snapshot + 派生量写入 state(旧 fullRender 的新等价物)。控制器在每次引擎变化后调用。 */
  syncFromEngine: (engine: GameEngine) => void;
  setViewSeat: (seat: number) => void;
  setInteractive: (interactive: boolean) => void;
  /** 短暂提示(自动过期的 hint 由 UI 层 setTimeout 清;store 只存文案,不持定时器)。 */
  pushHint: (hint: string | null) => void;
  setThinking: (thinking: boolean) => void;
  setScreen: (screen: Screen) => void;
}

export const useGameStore = create<GameStoreState>((set) => ({
  snapshot: null,
  viewSeat: -1,
  interactive: false,
  screen: "setup",
  hint: null,
  thinking: false,

  syncFromEngine: (engine) => {
    const snapshot = engine.snapshot();
    // 全量替换快照:引擎每次动作都是新的序列化对象,浅比较引用即触发订阅组件重渲。
    set({ snapshot });
  },
  setViewSeat: (seat) => set({ viewSeat: seat }),
  setInteractive: (interactive) => set({ interactive }),
  pushHint: (hint) => set({ hint }),
  setThinking: (thinking) => set({ thinking }),
  setScreen: (screen) => set({ screen }),
}));

// ──────────────────────────── 派生选择器 ────────────────────────────
// 纯函数 + useGameStore 订阅:不进 store(避免双份真源),组件按需选用。

/** 本地视角玩家(null = 未入座/未开局)。 */
export function useLocalPlayer(): SnapshotPlayer | null {
  return useGameStore((s) => s.snapshot?.players[s.viewSeat] ?? null);
}

/** 当前活跃玩家(轮到谁行动;null = 未开局)。 */
export function useActivePlayer(): SnapshotPlayer | null {
  return useGameStore((s) => s.snapshot?.players[s.snapshot.activeIndex] ?? null);
}

/** 快照玩家的净资产。口径来自 core/networth(serializeGame 内调用),此处只读快照字段,
 *  避免在 React 层重算导致与引擎/联机端三处口径漂移。 */
export function playerNetWorth(p: SnapshotPlayer): number {
  return p.netWorth;
}

/** 最近 n 条战报(新在前;全量 log 也在快照里,组件可自行切片)。 */
export function useRecentLog(count: number): LogEvent[] {
  return useGameStore((s) => {
    const log = s.snapshot?.log;
    if (!log) return [];
    return log.slice(-count).reverse();
  });
}
