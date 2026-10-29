// React 层的全局游戏状态(zustand):持有 engine.snapshot() 的可序列化数据 + UI 态。
// 这是旧 fullRender() 的新等价物——旧渲染层每次引擎变化后命令式重画 DOM,
// React 层改为:控制器每次引擎变化后调 syncFromEngine() 把 snapshot 灌进 store,
// 组件订阅 store 声明式重渲。
import { create } from "zustand";
import type { GameEngine } from "@core/authority";
import type {
  GameSnapshot as CoreGameSnapshot,
  SnapshotPlayer as CoreSnapshotPlayer,
} from "@core/snapshot";
import type { HeroSlotRow } from "@core/snapshot";
import { heroById } from "@core/heroes";
// #117 收编:提示 TTL 统一收口 fx/timings.ts(与 netStore 同一常量,不再双处 1800)。
import { UI } from "@app/fx/timings";

/** 引擎快照类型(serializeGame 的返回结构;联机 snapshot 消息同构,可直灌 store)。
 *  store 里存放的是 UI 视图快照(见 SnapshotPlayer 派生读口),引擎字段面同构。 */
export type GameSnapshotCore = CoreGameSnapshot;

/** UI 旧形状麾下行(#785 派生读口):快照麾下行已改槽位全量(heroId+已授技+冷却账),
 *  展示字段按 heroId 回查名将表派生成 {id,name,title,image}——UI 组件零改动继续工作;
 *  「同槽不同技」的表达面(已授技 chips 等)归票 #786 收窄时直读槽位拆除本读口。 */
export interface HeroViewRow {
  id: string;
  name: string;
  title: string;
  image: string;
}

/** 快照里的玩家行(含派生 netWorth;heroes 为槽位派生的旧形状视图行,其余字段同 core)。 */
export type SnapshotPlayer = Omit<CoreSnapshotPlayer, "heroes"> & { heroes: HeroViewRow[] };

/** 快照里的珍宝行(serializeGame 只序列化 id/name/level/desc,不含价字段——价格由
 *  展示层 guidePriceOf(level) 等推导)。卷轴组件的 props 按此声明,避免把快照珍宝
 *  断言成含价字段的完整 TreasureDef。 */
export type SnapshotTreasure = SnapshotPlayer["treasures"][number];

/** store 持有的 UI 视图快照:core 快照 + players.heroes 槽位→旧形状派生(装配单点
 *  toUiSnapshot)。联机 snapshot 消息(core 形状)同样经此派生后进 store。 */
export type GameSnapshot = Omit<CoreGameSnapshot, "players"> & { players: SnapshotPlayer[] };

/** 槽位 → UI 旧形状麾下行(展示字段回查名将表;heroId 查无=数据 bug,炸出,零兜底)。 */
function heroViewRow(slot: HeroSlotRow): HeroViewRow {
  const def = heroById(slot.heroId);
  return { id: def.id, name: def.name, title: def.title, image: def.image };
}

/** 数据装配单点(#785):core 快照 → UI 视图快照(players.heroes 槽位派生旧行,
 *  其余字段原样——浅拷贝共享,快照本就不可变消费)。 */
function toUiSnapshot(s: CoreGameSnapshot): GameSnapshot {
  return {
    ...s,
    players: s.players.map((p) => ({ ...p, heroes: p.heroes.map(heroViewRow) })),
  };
}

// ──────────────────────────── engine 引用管理 ────────────────────────────
// engine 是带方法/循环引用的可变实例,不属于响应式数据:
// ① 不序列化——zustand state 若混入 engine,DevTools/persist/浅比较全被污染;
// ② 不订阅——React 只该对"可渲染的数据"重渲,对实例本身不感兴趣;
// ③ 全局唯一——同一时刻只存在一局,模块级单例最干净(比藏在 store 的
//    non-reactive 字段好:不占用 store 类型,控制器/调试钩子可直接导入读写)。
let currentEngine: GameEngine | null = null;

// F4:hint 过期定时器(见 pushHint 注释;TTL 为三屏统一后的单一口径,常量收编 fx/timings.ts UI.hintTtlMs)。
let gameHintTimer: ReturnType<typeof setTimeout> | null = null;

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
  /** 本座位动作在途(#611「行军中…」提示源,与 interactive 同拍由控制器写入):
   *  命令已发未回或本座位行军会话未落定——按钮灰且轮到我时的等待条文案来源。 */
  selfPresenting: boolean;

  // ── UI 态 ──
  screen: Screen;
  /** 提示文案(旧 flashHint 的新等价物;null = 不显示)。 */
  hint: string | null;
  /** 提示级别(F4):error = 红底白字 chip(醒目);info = 原灰面板样式。 */
  hintLevel: "error" | "info";
  /** 思考中标记(旧 setThinking:等待 bot/远程玩家行动时显示"运筹中…")。 */
  thinking: boolean;

  // ── actions ──
  /** 读引擎 snapshot + 派生量写入 state(旧 fullRender 的新等价物)。控制器在每次引擎变化后调用。 */
  syncFromEngine: (engine: GameEngine) => void;
  setViewSeat: (seat: number) => void;
  setInteractive: (interactive: boolean) => void;
  setSelfPresenting: (selfPresenting: boolean) => void;
  /** 短暂提示:F4 起过期逻辑下沉到 store(统一 1.8s,重复 push 先清旧定时器),
   *  渲染层不再各自 setTimeout——原来 game 1.5s / lobby 1.8s / App+solo-setup 永不
   *  过期,三套口径同一文案行为不一致。level 决定渲染样式(error=红 chip)。 */
  pushHint: (hint: string | null, level?: "error" | "info") => void;
  setThinking: (thinking: boolean) => void;
  setScreen: (screen: Screen) => void;
}

export const useGameStore = create<GameStoreState>((set) => ({
  snapshot: null,
  viewSeat: -1,
  interactive: false,
  selfPresenting: false,
  screen: "setup",
  hint: null,
  hintLevel: "error",
  thinking: false,

  syncFromEngine: (engine) => {
    // 数据装配单点(#785):core 快照 → UI 视图(heroes 槽位派生旧行)再进 store。
    // 全量替换快照:引擎每次动作都是新的序列化对象,浅比较引用即触发订阅组件重渲。
    const snapshot = toUiSnapshot(engine.snapshot());
    set({ snapshot });
  },
  setViewSeat: (seat) => set({ viewSeat: seat }),
  setInteractive: (interactive) => set({ interactive }),
  setSelfPresenting: (selfPresenting) => set({ selfPresenting }),
  // F4:定时器归 store 持有(模块级单例——同一时刻只有一条 hint 在屏)。
  // 重复 push 先清旧定时器,保证「最新一条 1.8s 后消失」;原来屏层各自 setTimeout,
  // App/solo-setup 没挂定时器导致提示永不过期(评审 F4 的口径漂移点)。
  pushHint: (hint, level = "error") => {
    if (gameHintTimer != null) clearTimeout(gameHintTimer);
    gameHintTimer = hint === null ? null : setTimeout(() => set({ hint: null }), UI.hintTtlMs);
    set({ hint, hintLevel: level });
  },
  setThinking: (thinking) => set({ thinking }),
  setScreen: (screen) => set({ screen }),
}));

// ──────────────────────────── 派生选择器 ────────────────────────────
// 纯函数 + useGameStore 订阅:不进 store(避免双份真源),组件按需选用。

/** 本地视角玩家(对局屏挂载期恒有解:快照就位且已入座;唯二消费方门卫见 GameScreenLive)。 */
export function useLocalPlayer(): SnapshotPlayer {
  // `!` = 挂载门卫的类型面(无快照不进对局屏);座位缺位 = 接线 bug,下游取字段当场炸出。
  return useGameStore((s) => s.snapshot!.players[s.viewSeat]);
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
