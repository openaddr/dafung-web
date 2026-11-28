// 控制器一次发布座位可观察的局面和交互状态，组件订阅渲染。
// 同时持有屏幕、交互门与提示等 UI 态;可变引擎实例另存模块引用。
import { useMemo, useRef } from "react";
import { create } from "zustand";
import type { GameEngine } from "@dafung/core/engine/authority";
import type { SnapshotPlayer as CoreSnapshotPlayer } from "@dafung/core/engine/snapshot";
import type { SeatInteractionView } from "@dafung/core/protocol/seat-interaction";
import type { SeatSnapshot } from "@dafung/core/room/seat-projection";
// 提示 TTL 与 netStore 共用 timings.UI.hintTtlMs。
import { UI } from "@app/fx/timings";

/** core 玩家快照行,heroes 保留槽位的已授技与冷却账。 */
export type SnapshotPlayer = CoreSnapshotPlayer;

/** 快照里的珍宝行(serializeGame 只序列化 id/name/level/desc,不含价字段——价格由
 *  展示层 guidePriceOf(level) 等推导)。卷轴组件的 props 按此声明,避免把快照珍宝
 *  断言成含价字段的完整 TreasureDef。 */
export type SnapshotTreasure = SnapshotPlayer["treasures"][number];

/** 单机和联机均由控制器发布观察座位的局面。 */
export type GameSnapshot = SeatSnapshot;

// ──────────────────────────── engine 引用管理 ────────────────────────────
// engine 是带方法/循环引用的可变实例,不属于响应式数据:
// ① 不序列化——zustand state 若混入 engine,DevTools/persist/浅比较全被污染;
// ② 不订阅——React 只该对"可渲染的数据"重渲,对实例本身不感兴趣;
// ③ 全局唯一——同一时刻只存在一局,模块级单例最干净(比藏在 store 的
//    non-reactive 字段好:不占用 store 类型,控制器可直接导入绑定)。
let currentEngine: GameEngine | null = null;

// 唯一提示过期定时器,由 pushHint/reset 清理。
let gameHintTimer: ReturnType<typeof setTimeout> | null = null;

/** 取当前引擎实例(无对局时 null)。供 UI 派生读取;对局命令由控制器上行。 */
export function getEngine(): GameEngine | null {
  return currentEngine;
}

/** 绑定客户端水合副本(单机开局 / 联机换图重建时调用)。 */
export function setEngine(engine: GameEngine | null): void {
  currentEngine = engine;
}

// ──────────────────────────── store 定义 ────────────────────────────

/** 应用当前屏(setup = 首页;solo-setup = 单机配置页;lobby = 联机大厅;game = 对局)。 */
type Screen = "setup" | "solo-setup" | "lobby" | "game";

interface GameStoreState {
  // ── 引擎数据(快照;null = 尚未开局)──
  snapshot: GameSnapshot | null;
  seatView: SeatInteractionView<GameSnapshot> | null;
  /** 当前快照的反应窗在本机单调时钟上的截止时刻。 */
  reactionDeadlineAt: number | null;
  /** 房间分配的真人座位。-1 表示尚未入座。 */
  viewSeat: number;
  /** 此刻本地玩家能否操作(由控制器判定写入:UI 不自行推导,保持单一来源)。 */
  interactive: boolean;
  /** 本座位动作在途(「行军中…」提示源,与 interactive 同拍由控制器写入):
   *  命令已发未回或本座位行军会话未落定——按钮灰且轮到我时的等待条文案来源。 */
  selfPresenting: boolean;

  // ── UI 态 ──
  screen: Screen;
  /** 提示文案(null = 不显示)。 */
  hint: string | null;
  /** 提示级别:error = 红底白字 chip;info = 灰面板样式。 */
  hintLevel: "error" | "info";

  // ── actions ──
  /** 短暂提示,过期由 store 统一管理;重复 push 重新计时,level 决定样式。 */
  pushHint: (hint: string | null, level?: "error" | "info") => void;
  setScreen: (screen: Screen) => void;
  /** 测试显式重置模块单例,避免 Bun 跨文件共享状态串扰(ADR-0065)。
   *  引擎引用另由 setEngine(null) 解绑。 */
  reset: () => void;
}

export const useGameStore = create<GameStoreState>((set) => ({
  snapshot: null,
  seatView: null,
  reactionDeadlineAt: null,
  viewSeat: -1,
  interactive: false,
  selfPresenting: false,
  screen: "setup",
  hint: null,
  hintLevel: "error",

  // 同时只保留最新提示的过期计时;重复 push 先取消旧定时器。
  pushHint: (hint, level = "error") => {
    if (gameHintTimer != null) clearTimeout(gameHintTimer);
    gameHintTimer = hint === null ? null : setTimeout(() => set({ hint: null }), UI.hintTtlMs);
    set({ hint, hintLevel: level });
  },
  setScreen: (screen) => set({ screen }),
  reset: () => {
    if (gameHintTimer != null) clearTimeout(gameHintTimer);
    gameHintTimer = null;
    set({
      snapshot: null,
      seatView: null,
      reactionDeadlineAt: null,
      viewSeat: -1,
      interactive: false,
      selfPresenting: false,
      screen: "setup",
      hint: null,
      hintLevel: "error",
    });
  },
}));

// ──────────────────────────── 派生选择器 ────────────────────────────
// 纯函数 + useGameStore 订阅:不进 store(避免双份真源),组件按需选用。

/** 本地视角玩家(对局屏挂载期恒有解:快照就位且已入座;唯二消费方门卫见 GameScreenLive)。 */
export function useLocalPlayer(): SnapshotPlayer {
  // `!` = 挂载门卫的类型面(无快照不进对局屏);座位缺位 = 接线 bug,下游取字段当场炸出。
  return useGameStore((s) => s.snapshot!.players[s.viewSeat]);
}

/** 玩家行值等:键循环逐字段比,嵌套数组(properties/heroes/
 *  treasures)逐项两级浅等——嵌套元素皆扁平记录({propertyId,level}/{heroId,…}/
 *  {id,name,level,desc})或原始值(jinnangHand),两级全覆盖;键循环而非手抄字段表,
 *  类型增字段自动纳入比较。 */
function snapshotPlayerEqual(a: SnapshotPlayer, b: SnapshotPlayer): boolean {
  for (const key in a) {
    const av = a[key as keyof SnapshotPlayer];
    const bv = b[key as keyof SnapshotPlayer];
    if (av === bv) continue;
    if (Array.isArray(av) && Array.isArray(bv) && av.length === bv.length) {
      let same = true;
      for (let i = 0; i < av.length; i++) {
        const x = av[i] as unknown;
        const y = bv[i] as unknown;
        if (x === y) continue;
        if (
          typeof x !== "object" ||
          typeof y !== "object" ||
          x === null ||
          y === null ||
          Array.isArray(x) ||
          Array.isArray(y)
        ) {
          same = false;
          break;
        }
        const xo = x as Record<string, unknown>;
        const yo = y as Record<string, unknown>;
        for (const k in xo) {
          if (xo[k] !== yo[k]) {
            same = false;
            break;
          }
        }
        if (!same) break;
      }
      if (same) continue;
    }
    return false;
  }
  return true;
}

/** sync 会产生新的 players 引用;逐席位值等时复用元素,全部复用时连数组一起复用。
 *  内容变化仍产生新引用供下游 memo 更新;各消费方独立持有自己的上一份。 */
export function useStablePlayers(players: SnapshotPlayer[]): SnapshotPlayer[] {
  const prevRef = useRef<SnapshotPlayer[] | null>(null);
  return useMemo(() => {
    const prev = prevRef.current;
    const next = players.map((p, i) =>
      prev !== null && prev[i] !== undefined && snapshotPlayerEqual(prev[i], p) ? prev[i] : p,
    );
    if (prev !== null && prev.length === next.length && next.every((p, i) => prev[i] === p)) {
      return prev;
    }
    prevRef.current = next;
    return next;
  }, [players]);
}
