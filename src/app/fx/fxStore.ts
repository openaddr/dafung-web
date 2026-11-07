// 瞬时表现的事件队列(zustand):浮动金额 / 回合横幅 / 朱砂印章 / 行军接管集。
// 设计:与 gameStore 分开——gameStore 是引擎快照真源,本 store 只装"一次性、
// 自动过期"的表现事件(带自增 id + 超时自清),FxLayer 订阅渲染。
// 坐标统一存「棋盘逻辑坐标」(SVG viewBox 系),由 FxLayer 在渲染时换算成
// 容器像素(对照旧 svgCoordHelpers.getScreenCTM 方案)——pan/zoom 后下一次
// 重渲还能自动对位,编排侧(控制器/行军)无需关心屏幕坐标。
import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import { FX } from "./timings";
import type { SkillFloatTone } from "./presentation";

/** 补给铜钱雨定数枚数(曾驻 FxLayer,#1140 散布烤产线后随迁——数量与散布同源)。 */
const SUPPLY_COINS = 6;

/** 补给雨散布:横向 ±30 逻辑像素、纵向 90~120 落差(原 FxLayer 渲染期随机式原样迁移)。 */
function supplyCoinScatter(): Array<{ dx: number; dy: number }> {
  return Array.from({ length: SUPPLY_COINS }, () => ({
    dx: Math.round((Math.random() - 0.5) * 60),
    dy: 90 + Math.round(Math.random() * 30),
  }));
}

/** 撒币散布:径向抛散 ±75 / 上抛 -20~110(原 FxLayer 渲染期随机式原样迁移)。 */
function burstCoinScatter(count: number): Array<{ dx: number; dy: number }> {
  return Array.from({ length: count }, () => ({
    dx: Math.round((Math.random() - 0.5) * 150),
    dy: Math.round(Math.random() * 130) - 20,
  }));
}

export interface FloaterFx {
  id: number;
  /** 棋盘逻辑坐标(SVG 系)。 */
  x: number;
  y: number;
  /** 正=收入(绿)/负=支出(红),FxLayer 负责格式化;text 存在时改渲染文案小字。 */
  amount: number;
  /** 补给类再撒一把铜钱雨(旧 kind==="supply")。 */
  coins: boolean;
  /** 补给雨铜钱落点(spawn 拍烤死,SUPPLY_COINS 枚):曾在 FxLayer 渲染期
   *  Math.random 现算,fx 层任何 spawn/cleanup 触发的重渲都会重写在飞铜钱的
   *  keyframe 目标(落点中途瞬移+多付一次失效)——#1140 渲染税,散布归产线单源。 */
  coinScatter: ReadonlyArray<{ dx: number; dy: number }>;
  /** 文案浮字(ADR-0013 唯一选项自动执行轻提示):非空时替代金额渲染。 */
  text?: string;
  /** 技能演出档(#850):cast=主动技施展浮字升档(1.0×/玩家色细描边,色随件烤定);
   *  tag=被动技名小签(短签全长 FX.skillTagMs)。缺省=普通文案浮字。 */
  skill?: SkillFloatTone;
}

export interface SealFx {
  id: number;
  x: number;
  y: number;
  char: string;
  /** 印色档(S7):缺省朱砂深底;gold=漆金印(探宝「得」)。 */
  tone?: "gold";
}

/** 常驻回合胶囊(回合宣告唯一形制;#762 立,#958 全幅横幅退役后单源):顶中槽内的
 *  小药丸,常驻显示当前回合方——「谁在打」永有答案。内容 = 国号印 + 名号 +
 *  「第 N 轮」;每次回合宣告都刷新重挂(入场过渡重播),resetFx 换局才清。 */
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

/** 都城停条带(#732 降格,原全屏漆金宣告 S7 #513):槽内唯一的瞬态知会——回合全幅
 *  横幅已退役(#958,单源归常驻回合胶囊),知会槽瞬态位归它独占。 */
export interface HaltNoticeFx {
  kind: "halt";
  id: number;
  guohao: string;
  /** 玩家色 rgba 字符串(--player-color)。 */
  color: string;
  cityName: string;
}

export type NoticeFx = HaltNoticeFx;

/** 金圈一拍(#850 技能施展定音;S7 落格定音原产者已随 #826 退役,通道转正给施法):一拍即散。 */
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

/** 铜钱撒落(S7 破产仪式第三拍):count 枚一次性径向抛撒(≠补给铜钱雨的定数 6)。
 *  scatter = 每枚落点(spawn 拍烤死,理由同 FloaterFx.coinScatter #1140)。 */
export interface CoinBurstFx {
  id: number;
  x: number;
  y: number;
  count: number;
  scatter: ReadonlyArray<{ dx: number; dy: number }>;
}

/** 金钱飞行归账(#764):进账从来源棋子格飞一枚铜钱至收账者席位格。一条记录 =
 *  一枚在途铜钱(present 侧已按「同席位同帧合并总差额」收敛,sink 只收合并后的)。
 *  存活期 = CSS 飞行全程,animationend 即移除(抵达拍自摘,无第二套超时清理)。 */
export interface CashFlyFx {
  id: number;
  /** 收账玩家 id(座位号渲染期经快照解析;快照缺人 = 接线 bug,炸出不兜底)。 */
  playerId: string;
  /** 归账总额(恒 >0:出账方向不飞,#764 出账反向后置)。 */
  amount: number;
  /** 来源锚点(棋盘逻辑坐标,cashDelta/supplyRain 事件自带,提取拍烤定)。 */
  x: number;
  y: number;
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
  /** 所因锦囊 id(弹层题名按锦囊目录回查——UI 不硬编码牌名,#1067)。 */
  cardId: string;
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
  /** 扩军宣告 nonce:等级珠末珠落位(bv-pip-grow)以其为 key。 */
  level: number;
  /** 易主宣告 nonce:易主流光以其为 key。 */
  owner: number;
  /** 最近一次易主的新归属座位色(null=回无主,流光转金色)。 */
  ownerColorIndex: number | null;
}

/** 易主流光件(架构体检 B 批出底板):铭牌顶缘横穿流光,世界坐标在 FxLayer 按
 *  board.tiles 查表落位(tileIndex 单源,流光几何走 fx.css 类,stroke 色随件内联)。 */
export interface OwnFlashFx {
  id: number;
  tileIndex: number;
  /** 新归属座位色(null=回无主,流光转金色)。 */
  colorIndex: number | null;
}

let nextId = 1;

/** 知会槽泵(#732):槽空且队列非空即取队首开播,时长到自清再泵下一条——
 *  同槽互斥(同一时刻 notice 至多一条)+ 先进先出排队,全在这里结构性成立。
 *  时长与槽内 CSS 动画全长硬同步(halt=FX.haltBannerMs,见 timings.ts),id 守卫防
 *  resetFx 后迟到回调复活旧知会。 */
const pumpNotice = () => {
  const s = useFxStore.getState();
  if (s.notice != null || s.noticeQueue.length === 0) return;
  const next = s.noticeQueue[0];
  useFxStore.setState({ notice: next, noticeQueue: s.noticeQueue.slice(1) });
  const ms = FX.haltBannerMs;
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
  /** 常驻回合胶囊(#762 立,#958 起为回合宣告唯一形制):当前回合方(国号印+名号+
   *  轮次),每次回合宣告刷新重挂——「谁在打」的永在答案,等待条附加信息与它同槽融合。 */
  turnCapsule: TurnCapsuleFx | null;
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
  /** 易主流光(架构体检 B 批出底板):铭牌顶缘一次性流光,mini-svg 世界坐标挂在
   *  fx 宿主(SVG 动画出 #board——底板内逐帧重绘随迁层拔除,ADR-0045 同法)。 */
  ownFlashes: OwnFlashFx[];
  /** 金圈一拍(技能施展定音,#850)。 */
  pulses: PulseFx[];
  /** 破产仪式墨渍(S7)。 */
  inkBlots: InkBlotFx[];
  /** 破产仪式撒币(S7)。 */
  coinBursts: CoinBurstFx[];
  /** 金钱飞行归账(#764):在途铜钱集(进账方向,present 合帧后单枚下发)。 */
  cashFlies: CashFlyFx[];
  /** 出牌窗聚光(#764):窗态选中牌放大 1.6× 时的全屏 radial 压暗层开关——
   *  HandRack 卡牌段选中/取消即挂摘,FxLayer 经 body portal 渲染(opacity 过渡
   *  走 --dur-med;开关是本机窗态,非表现事件,不进 present 管线)。 */
  spotlight: boolean;
  /** 全屏签面 overlay 活动中(#849 棒2):掷骰签面(DiceOverlay)或拼点签面
   *  (DuelSignsOverlay)在场的真值窗——编排器(present)在两张 overlay 的挂→摘
   *  区间置位/复位。消费见 orchestrator:批内同步件遇 overlay 活动延后到收场补发
   *  (同步件画在 z-45 幕下不可见);store 只装状态,互斥判据(批内前视)在编排侧。 */
  overlayActive: boolean;

  spawnFloater(x: number, y: number, amount: number, coins: boolean): void;
  spawnTextFloater(x: number, y: number, text: string, skill?: SkillFloatTone): void;
  /** 回合宣告:只刷新常驻回合胶囊(重挂重播入场过渡),不入知会队列——全幅横幅
   *  已退役(#958),回合切换信号=胶囊重挂+席位金圈。colorIndex 供胶囊印字亮档
   *  换算(单源 core/theme playerSealText)。 */
  announceTurn(guohao: string, color: string, round: number, colorIndex: number): void;
  stampSeal(x: number, y: number, char: string, tone?: "gold"): void;
  spawnJinnangLine(x1: number, y1: number, x2: number, y2: number): void;
  /** 窥探弹层(#575):置开关态(同拍再窥=替换,id 单调供弹层重挂重播入场)。
   *  入参=表现事件减 id(整件透传,含 cardId 题名锚,#1067)。 */
  revealPeek(ev: Omit<PeekFx, "id">): void;
  /** 关闭窥探弹层(#575):关闭即清,无任何残留。 */
  closePeek(): void;
  /** 都城停条带(#732 降格):入知会队列,槽空即播;号角/震屏校准在 sink 侧。 */
  showHaltBanner(guohao: string, color: string, cityName: string): void;
  /** 金圈一拍(技能施展定音,#850)。 */
  spawnPulse(x: number, y: number): void;
  /** 破产仪式墨渍晕开(S7)。 */
  spawnInkBlot(x: number, y: number): void;
  /** 破产仪式铜钱撒落(S7)。 */
  spawnCoinBurst(x: number, y: number, count: number): void;
  /** 金钱飞行归账(#764):下发一枚在途铜钱(进账;合并已在 present 侧完成)。 */
  spawnCashFly(playerId: string, amount: number, x: number, y: number): void;
  /** 铜钱抵达即摘(animationend 拍,FlyCoin 回调;id 不在场 = 已被 resetFx 清,静默)。 */
  removeCashFly(id: number): void;
  /** 出牌窗聚光(#764):开关态(HandRack 窗态选中挂摘;unmount 兜摘由调用方负责)。 */
  setSpotlight(on: boolean): void;
  /** 全屏签面 overlay 活动标志(#849 棒2):present 在两张签面 overlay 的挂→摘区间
   *  调用(挂 true / 摘 false),resetFx 一并复位。 */
  setOverlayActive(on: boolean): void;
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
  /** 易主流光(架构体检 B 批出底板):ownerChanged 时由 FxSink.announceTileChange
   *  一并下发,FxLayer 在 fx 宿主渲染 mini-svg 流光,TTL=FX.ownFlashMs 自清。 */
  pushOwnFlash(tileIndex: number, colorIndex: number | null): void;
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
    jinnangLines: [],
    peek: null,
    marching: new Set<string>(),
    announces: new Map<number, TileAnnounce>(),
    ownFlashes: [],
    pulses: [],
    inkBlots: [],
    coinBursts: [],
    cashFlies: [],
    spotlight: false,
    overlayActive: false,

    spawnFloater(x, y, amount, coins) {
      const id = nextId++;
      set((s) => ({
        floaters: [
          ...s.floaters,
          { id, x, y, amount, coins, coinScatter: coins ? supplyCoinScatter() : [] },
        ],
      }));
      // 超时自清:动画 keyframe 是 1.3s/1.5s,到期必移除,防 store 无限增长。
      setTimeout(
        () => set((s) => ({ floaters: s.floaters.filter((f) => f.id !== id) })),
        FX.floaterMs,
      );
    },

    spawnTextFloater(x, y, text, skill) {
      const id = nextId++;
      set((s) => ({
        floaters: [
          ...s.floaters,
          { id, x, y, amount: 0, coins: false, coinScatter: [], text, skill },
        ],
      }));
      // 超时自清:普通/施展浮字按 floaterMs(--dur-fx 同源);被动小签(#850)全长
      // FX.skillTagMs 短于普通浮字,同窗清理无截断竞态,不再单设第二清理账本。
      setTimeout(
        () => set((s) => ({ floaters: s.floaters.filter((f) => f.id !== id) })),
        FX.floaterMs,
      );
    },

    announceTurn(guohao, color, round, colorIndex) {
      const id = nextId++;
      useFxStore.setState({ turnCapsule: { id, guohao, color, colorIndex, round } });
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
      set((s) => ({
        coinBursts: [...s.coinBursts, { id, x, y, count, scatter: burstCoinScatter(count) }],
      }));
      setTimeout(
        () => set((s) => ({ coinBursts: s.coinBursts.filter((b) => b.id !== id) })),
        FX.coinBurstMs,
      );
    },

    spawnCashFly(playerId, amount, x, y) {
      const id = nextId++;
      set((s) => ({ cashFlies: [...s.cashFlies, { id, playerId, amount, x, y }] }));
      // 无超时自清:存活期 = CSS 飞行全程,animationend 拍走 removeCashFly
      //(时长单源 FX.cashFlyMs,内联注入动画——超时账本是第二事实源,不设)。
    },

    removeCashFly(id) {
      set((s) => ({ cashFlies: s.cashFlies.filter((f) => f.id !== id) }));
    },

    setSpotlight(on) {
      set({ spotlight: on });
    },

    setOverlayActive(on) {
      set({ overlayActive: on });
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

    revealPeek(ev) {
      set({ peek: { id: nextId++, ...ev, hand: [...ev.hand] } });
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

    pushOwnFlash(tileIndex, colorIndex) {
      const id = nextId++;
      set((s) => ({ ownFlashes: [...s.ownFlashes, { id, tileIndex, colorIndex }] }));
      setTimeout(() => {
        set((s) => ({ ownFlashes: s.ownFlashes.filter((f) => f.id !== id) }));
      }, FX.ownFlashMs);
    },

    resetFx() {
      set({
        floaters: [],
        seals: [],
        notice: null,
        noticeQueue: [],
        turnCapsule: null,
        jinnangLines: [],
        peek: null,
        marching: new Set<string>(),
        announces: new Map(),
        ownFlashes: [],
        pulses: [],
        inkBlots: [],
        coinBursts: [],
        cashFlies: [],
        spotlight: false,
        overlayActive: false,
      });
    },
  })),
);
