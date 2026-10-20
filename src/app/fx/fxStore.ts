// 瞬时表现的事件队列(zustand):浮动金额 / 回合横幅 / 朱砂印章 / 行军接管集。
// 设计:与 gameStore 分开——gameStore 是引擎快照真源,本 store 只装"一次性、
// 自动过期"的表现事件(带自增 id + 超时自清),FxLayer 订阅渲染。
// 坐标统一存「棋盘逻辑坐标」(SVG viewBox 系),由 FxLayer 在渲染时换算成
// 容器像素(对照旧 svgCoordHelpers.getScreenCTM 方案)——pan/zoom 后下一次
// 重渲还能自动对位,编排侧(控制器/行军)无需关心屏幕坐标。
import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import { FX } from "./timings";

export interface FloaterFx {
  id: number;
  /** 棋盘逻辑坐标(SVG 系)。 */
  x: number;
  y: number;
  /** 正=收入(绿)/负=支出(红),FxLayer 负责格式化;text 存在时改渲染文案小字。 */
  amount: number;
  /** 补给类再撒一把铜钱雨(旧 kind==="supply")。 */
  coins: boolean;
  /** 文案浮字(ADR-0013 唯一选项自动执行轻提示):非空时替代金额渲染。 */
  text?: string;
}

export interface SealFx {
  id: number;
  x: number;
  y: number;
  char: string;
  /** 印色档(S7):缺省朱砂深底;gold=漆金印(探宝「得」)。 */
  tone?: "gold";
}

export interface BannerFx {
  id: number;
  guohao: string;
  /** 玩家色 rgba 字符串(--player-color)。 */
  color: string;
}

/** 都城停全屏宣告横幅(S7 #513):漆金横幅级宣告(FxLayer 屏幕层渲染)。 */
export interface HaltBannerFx {
  id: number;
  guohao: string;
  /** 玩家色 rgba 字符串(--player-color)。 */
  color: string;
  cityName: string;
}

/** 落格定音金圈(S7 #513):落点格一拍即散。 */
export interface PulseFx {
  id: number;
  x: number;
  y: number;
}

/** 铭牌墨渍(S7 破产仪式第二拍):径向晕开即散。 */
export interface InkBlotFx {
  id: number;
  x: number;
  y: number;
}

/** 铜钱撒落(S7 破产仪式第三拍):count 枚一次性径向抛撒(≠补给铜钱雨的定数 6)。 */
export interface CoinBurstFx {
  id: number;
  x: number;
  y: number;
  count: number;
}

/** 出牌指示线(#281 P2-E):「使用者 token → 目标 token」水墨墨线的两个端点
 *  (棋盘逻辑坐标,提取期已按当时牌局状态解析)。 */
export interface JinnangLineFx {
  id: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** 窥探弹层(#575,军情密探即时窥探):viewer-only 一次性演出的开关态——被窥者
 *  锦囊手牌陈列,关闭即清(无持续窗口、无自动过期:关闭动作归玩家);viewerSeat
 *  供弹层组件按本座自门(仅 viewer=本座渲染,他座客户端持有记录但零渲染)。 */
export interface PeekFx {
  id: number;
  viewerSeat: number;
  targetSeat: number;
  /** 被窥者国号(弹层副题「窥 {国号} 营锦囊」)。 */
  guohao: string;
  /** 被窥者锦囊手牌内容(viewer 之外恒空——redactEvents 逐座位裁,ADR-0016)。 */
  hand: string[];
}

/** 城池宣告记录(ADR-0015):Tile 订阅本记录重播宣告动画,自身不做 props diff。
 *  按 tileIndex 各存一条,nonce 单调递增、播完自然过期(不清理定时器,下条覆盖):
 *  level/owner 两维独立计数,各自作为 Tile 内受影响元素的 React key——nonce 变化
 *  即重挂重播,不变则原地静置。0 = 该维从未宣告(开局铺盘/快照恢复不播动画)。 */
export interface TileAnnounce {
  /** 扩军宣告 nonce:档位珠末珠落位(bv-pip-grow)以其为 key。 */
  level: number;
  /** 易主宣告 nonce:易主流光以其为 key。 */
  owner: number;
  /** 最近一次易主的新归属座位色(null=回无主,流光转金色)。 */
  ownerColorIndex: number | null;
}

let nextId = 1;

interface FxState {
  floaters: FloaterFx[];
  seals: SealFx[];
  banner: BannerFx | null;
  /** 都城停全屏宣告(S7)。 */
  halt: HaltBannerFx | null;
  /** 出牌指示线(#281 P2-E)。 */
  jinnangLines: JinnangLineFx[];
  /** 窥探弹层(#575):null=关闭(关闭即清,无任何残留)。 */
  peek: PeekFx | null;
  /** 行军动画接管中的玩家 id(→ BoardView.skipTokenIds):React 声明式定位让位;
   *  外部移出某 id = 在途行军的取消令牌(selector 订阅在 useMarch,按 id 派发:
   *  会话作废 + 清 marchPos,#609 per-id 行军会话)——终局封场的接管收回
   *  (orchestrator→abandonMarch)与重连边界(abandonAllMarches)即走此通道。 */
  marching: ReadonlySet<string>;
  /** 城池宣告记录(ADR-0015),key = tileIndex。 */
  announces: ReadonlyMap<number, TileAnnounce>;
  /** 落格定音金圈(S7)。 */
  pulses: PulseFx[];
  /** 破产仪式墨渍(S7)。 */
  inkBlots: InkBlotFx[];
  /** 破产仪式撒币(S7)。 */
  coinBursts: CoinBurstFx[];

  spawnFloater(x: number, y: number, amount: number, coins: boolean): void;
  spawnTextFloater(x: number, y: number, text: string): void;
  showBanner(guohao: string, color: string): void;
  stampSeal(x: number, y: number, char: string, tone?: "gold"): void;
  spawnJinnangLine(x1: number, y1: number, x2: number, y2: number): void;
  /** 窥探弹层(#575):置开关态(同拍再窥=替换,id 单调供弹层重挂重播入场)。 */
  revealPeek(viewerSeat: number, targetSeat: number, guohao: string, hand: string[]): void;
  /** 关闭窥探弹层(#575):关闭即清,无任何残留。 */
  closePeek(): void;
  /** 都城停全屏宣告(S7):横幅随 CSS 全长自清。 */
  showHaltBanner(guohao: string, color: string, cityName: string): void;
  /** 落格定音金圈一拍(S7)。 */
  spawnPulse(x: number, y: number): void;
  /** 破产仪式墨渍晕开(S7)。 */
  spawnInkBlot(x: number, y: number): void;
  /** 破产仪式铜钱撒落(S7)。 */
  spawnCoinBurst(x: number, y: number, count: number): void;
  addMarching(id: string): void;
  removeMarching(id: string): void;
  /** 城池宣告(ADR-0015):由 FxSink.announceTileChange 调用(触发源是播放器/sink,
   *  不是 Tile 自身 diff)。levelChanged/ownerChanged 各自推进对应维度的 nonce。 */
  announceTileChange(
    tileIndex: number,
    levelChanged: boolean,
    ownerChanged: boolean,
    ownerColorIndex: number | null,
  ): void;
  /** 清空全部(重开局/切屏时防陈旧特效滞留)。 */
  resetFx(): void;
}

export const useFxStore = create<FxState>()(
  subscribeWithSelector((set) => ({
    floaters: [],
    seals: [],
    banner: null,
    halt: null,
    jinnangLines: [],
    peek: null,
    marching: new Set<string>(),
    announces: new Map<number, TileAnnounce>(),
    pulses: [],
    inkBlots: [],
    coinBursts: [],

    spawnFloater(x, y, amount, coins) {
      const id = nextId++;
      set((s) => ({ floaters: [...s.floaters, { id, x, y, amount, coins }] }));
      // 超时自清:动画 keyframe 是 1.3s/1.5s,到期必移除,防 store 无限增长。
      setTimeout(
        () => set((s) => ({ floaters: s.floaters.filter((f) => f.id !== id) })),
        FX.floaterMs,
      );
    },

    spawnTextFloater(x, y, text) {
      const id = nextId++;
      set((s) => ({ floaters: [...s.floaters, { id, x, y, amount: 0, coins: false, text }] }));
      setTimeout(
        () => set((s) => ({ floaters: s.floaters.filter((f) => f.id !== id) })),
        FX.floaterMs,
      );
    },

    showBanner(guohao, color) {
      const id = nextId++;
      set({ banner: { id, guohao, color } });
      setTimeout(() => set((s) => (s.banner?.id === id ? { banner: null } : {})), FX.bannerMs);
    },

    stampSeal(x, y, char, tone) {
      const id = nextId++;
      set((s) => ({ seals: [...s.seals, { id, x, y, char, tone }] }));
      setTimeout(() => set((s) => ({ seals: s.seals.filter((f) => f.id !== id) })), FX.sealMs);
    },

    showHaltBanner(guohao, color, cityName) {
      const id = nextId++;
      set({ halt: { id, guohao, color, cityName } });
      setTimeout(() => set((s) => (s.halt?.id === id ? { halt: null } : {})), FX.haltBannerMs);
    },

    spawnPulse(x, y) {
      const id = nextId++;
      set((s) => ({ pulses: [...s.pulses, { id, x, y }] }));
      setTimeout(
        () => set((s) => ({ pulses: s.pulses.filter((p) => p.id !== id) })),
        FX.landPulseMs,
      );
    },

    spawnInkBlot(x, y) {
      const id = nextId++;
      set((s) => ({ inkBlots: [...s.inkBlots, { id, x, y }] }));
      setTimeout(
        () => set((s) => ({ inkBlots: s.inkBlots.filter((b) => b.id !== id) })),
        FX.inkBlotMs,
      );
    },

    spawnCoinBurst(x, y, count) {
      const id = nextId++;
      set((s) => ({ coinBursts: [...s.coinBursts, { id, x, y, count }] }));
      setTimeout(
        () => set((s) => ({ coinBursts: s.coinBursts.filter((b) => b.id !== id) })),
        FX.coinBurstMs,
      );
    },

    spawnJinnangLine(x1, y1, x2, y2) {
      const id = nextId++;
      set((s) => ({ jinnangLines: [...s.jinnangLines, { id, x1, y1, x2, y2 }] }));
      // 超时自清:与 fx.css 的三段 keyframe 全长(FX.jinnangLineMs=700ms)硬同步
      setTimeout(
        () => set((s) => ({ jinnangLines: s.jinnangLines.filter((l) => l.id !== id) })),
        FX.jinnangLineMs,
      );
    },

    revealPeek(viewerSeat, targetSeat, guohao, hand) {
      set({ peek: { id: nextId++, viewerSeat, targetSeat, guohao, hand: [...hand] } });
    },

    closePeek() {
      set({ peek: null });
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

    announceTileChange(tileIndex, levelChanged, ownerChanged, ownerColorIndex) {
      set((s) => {
        const prev = s.announces.get(tileIndex) ?? { level: 0, owner: 0, ownerColorIndex: null };
        const next: TileAnnounce = {
          level: levelChanged ? prev.level + 1 : prev.level,
          owner: ownerChanged ? prev.owner + 1 : prev.owner,
          ownerColorIndex: ownerChanged ? ownerColorIndex : prev.ownerColorIndex,
        };
        const announces = new Map(s.announces);
        announces.set(tileIndex, next);
        return { announces };
      });
    },

    resetFx() {
      set({
        floaters: [],
        seals: [],
        banner: null,
        halt: null,
        jinnangLines: [],
        peek: null,
        marching: new Set<string>(),
        announces: new Map(),
        pulses: [],
        inkBlots: [],
        coinBursts: [],
      });
    },
  })),
);
