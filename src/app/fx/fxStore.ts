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

/** 顶中知会横幅槽演出件(#732):回合横幅与都城停条带统一为槽内知会——同形同槽,
 *  由槽组件(NoticeBanner)渲染;瞬态知会优先于等待条(槽组件负责让位/回归)。 */
export interface TurnNoticeFx {
  kind: "turn";
  id: number;
  guohao: string;
  /** 玩家色 rgba 字符串(--player-color)。 */
  color: string;
}

/** 常驻回合胶囊(#762 两段式亮相的第二段终态):全幅横幅读完(亮相段)即收编为
 *  顶中槽内的小药丸,此后常驻显示当前回合方——「谁在打」永有答案。内容 = 国号印 +
 *  名号 + 「第 N 轮」;每次回合宣告(全幅或合并)都刷新,横幅消散不带走它
 *  (resetFx 换局才清)。 */
export interface TurnCapsuleFx {
  id: number;
  guohao: string;
  /** 玩家色 rgba 字符串(--player-color)。 */
  color: string;
  /** 座位色下标(印字亮档换算单源 core/theme playerSealText,UI 侧消费)。 */
  colorIndex: number;
  /** 宣告时的轮次(引擎 round,提取拍烤进事件;胶囊「第 N 轮」文案源)。 */
  round: number;
}

/** 回合宣告的判别元数据(#762 知会槽合并规则):提取拍从引擎烤定(ADR-0029 不变量①
 *  同族——播放期零读引擎),槽泵据此判「bot→bot 同轮连续」并折叠全幅串播。 */
export interface TurnAnnounceMeta {
  isBot: boolean;
  round: number;
}

/** 都城停条带(#732 降格):原全屏漆金宣告(S7 #513)降为条带级横幅,与回合横幅
 *  同槽互斥排队。 */
export interface HaltNoticeFx {
  kind: "halt";
  id: number;
  guohao: string;
  /** 玩家色 rgba 字符串(--player-color)。 */
  color: string;
  cityName: string;
}

export type NoticeFx = TurnNoticeFx | HaltNoticeFx;

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

/** 知会槽泵(#732):槽空且队列非空即取队首开播,时长到自清再泵下一条——
 *  同槽互斥(同一时刻 notice 至多一条)+ 先进先出排队,全在这里结构性成立。
 *  时长与槽内 CSS 动画全长硬同步(turn=FX.bannerMs 同两段式亮相全长;halt 同 calibre,
 *  见 timings.ts),id 守卫防 resetFx 后迟到回调复活旧知会。 */
const pumpNotice = () => {
  const s = useFxStore.getState();
  if (s.notice != null || s.noticeQueue.length === 0) return;
  const next = s.noticeQueue[0];
  useFxStore.setState({ notice: next, noticeQueue: s.noticeQueue.slice(1) });
  const ms = next.kind === "turn" ? FX.bannerMs : FX.haltBannerMs;
  setTimeout(() => {
    const cur = useFxStore.getState();
    if (cur.notice?.id === next.id) useFxStore.setState({ notice: null });
    pumpNotice();
  }, ms);
};

interface FxState {
  floaters: FloaterFx[];
  seals: SealFx[];
  /** 顶中知会横幅槽(#732):当前展示的知会件(null=槽空,等待条可回归)。 */
  notice: NoticeFx | null;
  /** 知会排队(#732):同槽互斥——展示中的知会播完(时长到)才从队首取下一条。 */
  noticeQueue: NoticeFx[];
  /** 常驻回合胶囊(#762):当前回合方(国号印+名号+轮次),每次回合宣告刷新,
   *  不随横幅/知会消散——「谁在打」的永在答案,等待条附加信息与它同槽融合。 */
  turnCapsule: TurnCapsuleFx | null;
  /** 最近一次回合宣告的判别元数据(#762):合并规则的游标——上一个宣告是否 bot、
   *  属哪一轮;resetFx 清零(新局首个宣告恒全幅)。 */
  lastTurnMeta: TurnAnnounceMeta | null;
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
  /** 回合宣告入槽(#732 入槽;#762 合并规则):入知会队列,槽空即播;无论全幅与否
   *  都刷新常驻回合胶囊。返回「是否全幅播出」——bot→bot 同轮连续回合折叠为胶囊
   *  更新(false),sink 据此跳过横幅音效、播放器据此跳过编排停留窗。
   *  colorIndex 供胶囊印字亮档换算(单源 core/theme playerSealText)。 */
  showBanner(guohao: string, color: string, meta: TurnAnnounceMeta, colorIndex: number): boolean;
  stampSeal(x: number, y: number, char: string, tone?: "gold"): void;
  spawnJinnangLine(x1: number, y1: number, x2: number, y2: number): void;
  /** 窥探弹层(#575):置开关态(同拍再窥=替换,id 单调供弹层重挂重播入场)。 */
  revealPeek(viewerSeat: number, targetSeat: number, guohao: string, hand: string[]): void;
  /** 关闭窥探弹层(#575):关闭即清,无任何残留。 */
  closePeek(): void;
  /** 都城停条带(#732 降格):入知会队列,槽空即播;号角/震屏校准在 sink 侧。 */
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
    notice: null,
    noticeQueue: [],
    turnCapsule: null,
    lastTurnMeta: null,
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

    showBanner(guohao, color, meta, colorIndex) {
      const id = nextId++;
      // 知会槽合并规则(#762,判别写死不留开放配置):bot→bot 同轮连续回合不再串播
      // 全幅大字段,只更新常驻胶囊;真人回合、每轮首个回合宣告(跨轮/首宣告)仍全幅。
      // lastTurnMeta 追踪的是「上一次宣告」而非「上一次全幅」——bot 链中途换人才
      // 不会把后续 bot 回合误判成连续。
      const prev = useFxStore.getState().lastTurnMeta;
      const merged = meta.isBot && prev != null && prev.isBot && prev.round === meta.round;
      useFxStore.setState({
        lastTurnMeta: meta,
        turnCapsule: { id, guohao, color, colorIndex, round: meta.round },
      });
      if (merged) return false;
      useFxStore.setState((s) => ({
        noticeQueue: [...s.noticeQueue, { kind: "turn", id, guohao, color }],
      }));
      pumpNotice();
      return true;
    },

    stampSeal(x, y, char, tone) {
      const id = nextId++;
      set((s) => ({ seals: [...s.seals, { id, x, y, char, tone }] }));
      setTimeout(() => set((s) => ({ seals: s.seals.filter((f) => f.id !== id) })), FX.sealMs);
    },

    showHaltBanner(guohao, color, cityName) {
      const id = nextId++;
      set((s) => ({
        noticeQueue: [...s.noticeQueue, { kind: "halt", id, guohao, color, cityName }],
      }));
      pumpNotice();
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
        notice: null,
        noticeQueue: [],
        turnCapsule: null,
        lastTurnMeta: null,
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
