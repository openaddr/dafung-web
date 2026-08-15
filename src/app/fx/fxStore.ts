// 瞬时表现的事件队列(zustand):浮动金额 / 回合横幅 / 朱砂印章 / 行军接管集。
// 设计:与 gameStore 分开——gameStore 是引擎快照真源,本 store 只装"一次性、
// 自动过期"的表现事件(带自增 id + 超时自清),FxLayer 订阅渲染。
// 坐标统一存「棋盘逻辑坐标」(SVG viewBox 系),由 FxLayer 在渲染时换算成
// 容器像素(对照旧 svgCoordHelpers.getScreenCTM 方案)——pan/zoom 后下一次
// 重渲还能自动对位,编排侧(控制器/行军)无需关心屏幕坐标。
import { create } from "zustand";
import { FX } from "./timings";

export interface FloaterFx {
  id: number;
  /** 棋盘逻辑坐标(SVG 系)。 */
  x: number;
  y: number;
  /** 正=收入(绿)/负=支出(红),FxLayer 负责格式化。 */
  amount: number;
  /** 补给类再撒一把铜钱雨(旧 kind==="supply")。 */
  coins: boolean;
}

export interface SealFx {
  id: number;
  x: number;
  y: number;
  char: string;
}

export interface BannerFx {
  id: number;
  guohao: string;
  /** 玩家色 rgba 字符串(--player-color)。 */
  color: string;
}

let nextId = 1;

interface FxState {
  floaters: FloaterFx[];
  seals: SealFx[];
  banner: BannerFx | null;
  /** 行军动画接管中的玩家 id(→ BoardView.skipTokenIds):React 声明式定位让位。 */
  marching: ReadonlySet<string>;

  spawnFloater(x: number, y: number, amount: number, coins: boolean): void;
  showBanner(guohao: string, color: string): void;
  stampSeal(x: number, y: number, char: string): void;
  addMarching(id: string): void;
  removeMarching(id: string): void;
  /** 清空全部(重开局/切屏时防陈旧特效滞留)。 */
  resetFx(): void;
}

export const useFxStore = create<FxState>((set) => ({
  floaters: [],
  seals: [],
  banner: null,
  marching: new Set<string>(),

  spawnFloater(x, y, amount, coins) {
    const id = nextId++;
    set((s) => ({ floaters: [...s.floaters, { id, x, y, amount, coins }] }));
    // 超时自清:动画 keyframe 是 1.3s/1.5s,到期必移除,防 store 无限增长。
    setTimeout(() => set((s) => ({ floaters: s.floaters.filter((f) => f.id !== id) })), FX.floaterMs);
  },

  showBanner(guohao, color) {
    const id = nextId++;
    set({ banner: { id, guohao, color } });
    setTimeout(() => set((s) => (s.banner?.id === id ? { banner: null } : {})), FX.bannerMs);
  },

  stampSeal(x, y, char) {
    const id = nextId++;
    set((s) => ({ seals: [...s.seals, { id, x, y, char }] }));
    setTimeout(() => set((s) => ({ seals: s.seals.filter((f) => f.id !== id) })), FX.sealMs);
  },

  addMarching(id) {
    set((s) => {
      if (s.marching.has(id)) return {};
      const next = new Set(s.marching);
      next.add(id);
      return { marching: next };
    });
  },

  removeMarching(id) {
    set((s) => {
      if (!s.marching.has(id)) return {};
      const next = new Set(s.marching);
      next.delete(id);
      return { marching: next };
    });
  },

  resetFx() {
    set({ floaters: [], seals: [], banner: null, marching: new Set<string>() });
  },
}));
