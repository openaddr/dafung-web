// 引擎全状态序列化(调试 window.__dafung / 联机广播数据包 / CLI 持久化)。God view,读 engine public 字段。
// 从 game.ts 提取,集中序列化逻辑,便于联机时复用 + 单独演进。
// 联机化(CLAUDE.md 规则 5):本文件输出 = 服务器可广播给各端的完整可观测状态;
// 瞬时反馈(floaters / dice 动画状态)不在此列 —— 各端独立 spawn,避免高频小包。
//
// 序列化单点清单(spec #107 C2):「引擎哪些状态参与序列化」由 GameSnapshot(显式协议)
// + SNAPSHOT_FIELDS(成对读写表)唯一声明——serialize 与 restore 共享同一张表,
// 加一个引擎字段只在表里加一条(read/write 同点),不再横跨两个镜像函数五处文件。
// 契约测试(snapshot-contract.test.ts)断言「serializeGame 产出的键集 = 清单键集」双向一致,
// 杜绝「序列化了没恢复 / 清单记了没产出」的双向漂移。
import type { GameEngine, EnginePhase, SetupPhase } from "./game";
import type { ChoiceOption } from "./choices";
import type {
  DiceRoll,
  HeroDef,
  LandOutcomeKind,
  LandOutcomeSnapshot,
  LogEvent,
  MovePath,
  PendingLand,
  TurnPhase,
  VictoryReason,
} from "./types";
import { HEROES } from "./heroes";
import { netWorth } from "./networth";

/** 快照珍宝行(只存展示字段;价格由 guidePriceOf(level) 派生,不进协议)。 */
export interface TreasureRow {
  id: string;
  name: string;
  level: number;
  desc?: string;
}

/** 快照名士行(只存展示字段;skill/cooldown 由 HEROES 表按 id 回查)。 */
export interface HeroRow {
  id: string;
  name: string;
  title: string;
  desc: string;
  image: string;
}

/** 快照玩家行(netWorth 为派生列,UI 直读免重算)。 */
export interface SnapshotPlayer {
  id: string;
  name: string;
  guohao: string;
  colorIndex: number;
  isBot: boolean;
  cash: number;
  warrants: number;
  netWorth: number;
  isBankrupt: boolean;
  position: number;
  capitalIndex: number;
  onBranch: { step: number } | null;
  skipTurns: number;
  properties: { propertyId: string; level: number; group: string }[];
  heroes: HeroRow[];
  /** 名士冷却:skill.id → 上次触发的 round。 */
  heroLastFired: Record<string, number>;
  treasures: TreasureRow[];
}

/** 快照对外协议(显式声明):serializeGame 产出、GameEngine.restoreFromSnapshot 消费;
 *  联机 snapshot 消息与单机 store 灌装同构(store 的 GameSnapshot 即本结构)。
 *  对 UI 的既有字段口径不变(lastLandOutcomeKind 等扁平字段原样保留);
 *  加引擎字段 = 此处加一行 + SNAPSHOT_FIELDS 加一条,其余一概不动。 */
export interface GameSnapshot {
  // 对局 id(ADR-0014):联机各端与恢复进程保持同一 id,对局日志落盘/导出据此命名
  gameId: string;
  phase: EnginePhase;
  setupPhase: SetupPhase;
  turnPhase: TurnPhase;
  turnNumber: number;
  round: number;
  roundAnchor: number;
  activeIndex: number;
  targetNetWorth: number;
  startingCash: number;
  isOver: boolean;
  winner: string | null;
  winReason: VictoryReason;
  draftOrder: number[];
  draftRolls: number[];
  currentDraftIndex: number;
  /** 纯派生:draftOrder[currentDraftIndex]。 */
  currentSetupPlayerIndex: number;
  takenCapitalIndices: number[];
  // 三选一选都:当前选都玩家的候选城 + 历史候选集(恢复/联机各端保持候选一致)
  offeredCapitals: number[];
  offeredCapitalHistory: number[];
  // 已选国号(联机 Setup 阶段同步,防止重复国号)
  usedGuohao: string[];
  // 已招名士 id(联机端据此排除已招候选,保持招贤池一致)
  recruitedHeroIds: string[];
  // 剩余珍宝牌堆(联机端需复现同一抽牌序列;抽牌结果由 server nextFloat 决定,牌堆内容对齐是必要的)
  treasureDeck: TreasureRow[];
  treasureVisitor: { propertyId: string; ownerIdx: number } | null;
  pendingDebt: { amount: number; creditor: string | null } | null;
  // 珍宝交涉交割托管(买家付清价款前珍宝暂存;恢复后可继续清算/交割)
  escrowTreasure: { treasure: TreasureRow; buyerIdx: number; sellerIdx: number; price: number } | null;
  // 纯派生(board 常量)
  branchStartTile: number | null;
  branchEndTile: number | null;
  // 纯派生(相位 + 棋位实时计算)
  currentTileIsBranchStart: boolean;
  // 决策相位选项集(ADR-0013):纯派生数据(choices.ts 注册表),UI/调试可见;
  // 联机零负担——无需序列化恢复,重 hydrate 后重算即得。
  choices: ChoiceOption[];
  // 决策归属座位(engine.decisionOwner 透出,纯派生):珍宝交涉=城主,其余=activeIndex。
  // 等待文案/视角归属直接消费快照,各端不再手抄「ownerIdx ?? activeIndex」推导(spec #107 C1)。
  decisionOwner: number;
  // PRNG 状态:CLI/联机跨进程续掷(不丢 rng 连续性)
  rngState: number;
  players: SnapshotPlayer[];
  offeredHeroes: HeroRow[];
  // 表现态字段经 presentation 视图读(Wave3 候选4:字段已私有,序列化格式不变)
  lastRoll: DiceRoll | null;
  // lastMove 全量坐标(waypoints/branchWaypoints)随行军动画坐标一并序列化:
  // 联机端收到 snapshot 时,行军动画可能尚未播放(或断线重连后需补播),需坐标才能复现路径。
  lastMove: MovePath | null;
  // 表现态扁平字段(UI 直接消费;GameScreen/DecisionScrollLayer 口径不变)
  lastLandOutcomeKind: LandOutcomeKind | null;
  lastLandOutcomeProperty: string | null;
  // lastLandOutcome 完整量(纯表现态,spec #107 C2 退役:决策消费已移交 pendingLand);
  // owner 不序列化(bot/UI 均不消费,需要时由 property 归属查 holdings)
  lastLandOutcome: LandOutcomeSnapshot | null;
  // 待决策落格(决策上下文单点,spec #107 C2):决策命令消费与恢复重建的唯一出处;
  // 只存 kind + propertyId 句柄,定义由 catalog 现查。
  pendingLand: PendingLand | null;
  // 纯派生(log 长度)
  logCount: number;
  // 完整战报(CLI 跨进程持久化 / 联机端断线重连看历史)。God view 包含 log,各端可截短。
  log: LogEvent[];
}

/** 单点清单条目:read(引擎 → 快照值)与 write(快照 → 引擎)成对同置。
 *  write 面向整份快照取参(而非单值),换取消单循环内完全的类型安全(无 any、无跨字段 cast);
 *  纯派生键(choices/currentSetupPlayerIndex/lastLandOutcomeKind 等)write 为 no-op,恢复后重算。 */
interface SnapshotField<K extends keyof GameSnapshot> {
  key: K;
  read: (e: GameEngine) => GameSnapshot[K];
  write: (e: GameEngine, s: GameSnapshot) => void;
}

/** 全部条目的联合(键类型恰好覆盖 GameSnapshot 的键,多键/错键在编译期炸出)。 */
type SnapshotFieldEntry = { [K in keyof GameSnapshot]: SnapshotField<K> }[keyof GameSnapshot];

/** 序列化单点清单(唯一):条目序 = 快照键序(serialize 产出序)。各条目 write 相互独立、
 *  均不读骰不互读,restore 按序循环应用即正确(无跨键次序依赖)。 */
export const SNAPSHOT_FIELDS: readonly SnapshotFieldEntry[] = [
  {
    // 对局 id(ADR-0014):联机各端与恢复进程保持同一 id,对局日志落盘/导出据此命名
    key: "gameId",
    read: (e) => e.gameId,
    write: (e, s) => {
      e.gameId = s.gameId;
    },
  },
  {
    key: "phase",
    read: (e) => e.phase,
    write: (e, s) => {
      e.phase = s.phase;
    },
  },
  {
    key: "setupPhase",
    read: (e) => e.setupPhase,
    write: (e, s) => {
      e.setupPhase = s.setupPhase;
    },
  },
  {
    key: "turnPhase",
    read: (e) => e.turnPhase,
    write: (e, s) => {
      e.turnPhase = s.turnPhase;
    },
  },
  {
    key: "turnNumber",
    read: (e) => e.turnNumber,
    write: (e, s) => {
      e.turnNumber = s.turnNumber;
    },
  },
  {
    key: "round",
    read: (e) => e.round,
    write: (e, s) => {
      e.round = s.round;
    },
  },
  {
    // 轮次锚点需跨进程恢复,否则恢复后 round 计数会漂移
    key: "roundAnchor",
    read: (e) => e.roundAnchor,
    write: (e, s) => {
      e.roundAnchor = s.roundAnchor;
    },
  },
  // public:供 snapshot/联机序列化(内部由 advanceToNextActive 维护)
  {
    key: "activeIndex",
    read: (e) => e.activeIndex,
    write: (e, s) => {
      e.activeIndex = s.activeIndex;
    },
  },
  {
    // readonly:构造时定(前置:恢复引擎的 config 与快照匹配),不随快照覆盖
    key: "targetNetWorth",
    read: (e) => e.targetNetWorth,
    write: () => {},
  },
  {
    // readonly:同 targetNetWorth
    key: "startingCash",
    read: (e) => e.startingCash,
    write: () => {},
  },
  {
    key: "isOver",
    read: (e) => e.isOver,
    write: (e, s) => {
      e.isOver = s.isOver;
    },
  },
  {
    // winner:快照存 id,恢复时从座位表反查玩家
    key: "winner",
    read: (e) => (e.winner ? e.winner.id : null),
    write: (e, s) => {
      const wid = s.winner;
      e.winner = wid ? e.players.find((p) => p.id === wid) ?? null : null;
    },
  },
  {
    key: "winReason",
    read: (e) => e.winReason,
    write: (e, s) => {
      e.winReason = s.winReason;
    },
  },
  {
    key: "draftOrder",
    read: (e) => [...e.draftOrder],
    write: (e, s) => {
      e.draftOrder = [...s.draftOrder];
    },
  },
  {
    key: "draftRolls",
    read: (e) => [...e.draftRolls],
    write: (e, s) => {
      e.draftRolls = [...s.draftRolls];
    },
  },
  {
    key: "currentDraftIndex",
    read: (e) => e.currentDraftIndex,
    write: (e, s) => {
      e.currentDraftIndex = s.currentDraftIndex;
    },
  },
  {
    // 纯派生(getter):draftOrder + currentDraftIndex 恢复后自动就位
    key: "currentSetupPlayerIndex",
    read: (e) => e.currentSetupPlayerIndex,
    write: () => {},
  },
  {
    key: "takenCapitalIndices",
    read: (e) => [...e.takenCapitalIndices],
    write: (e, s) => {
      e.takenCapitalIndices = new Set(s.takenCapitalIndices);
    },
  },
  {
    // 三选一选都候选集(轮到时生成、选定/轮空后滚换)
    key: "offeredCapitals",
    read: (e) => [...e.offeredCapitals],
    write: (e, s) => {
      e.offeredCapitals = [...s.offeredCapitals];
    },
  },
  {
    // 曾进过任何候选集的城(尽量不复用,保证跨玩家候选不重复)
    key: "offeredCapitalHistory",
    read: (e) => [...e.offeredCapitalHistory],
    write: (e, s) => {
      e.offeredCapitalHistory = new Set(s.offeredCapitalHistory);
    },
  },
  {
    // 已选国号(联机 Setup 阶段同步,防止重复国号)
    key: "usedGuohao",
    read: (e) => [...e.usedGuohao],
    write: (e, s) => {
      e.usedGuohao = new Set(s.usedGuohao);
    },
  },
  {
    // 已招名士 id(联机端据此排除已招候选,保持招贤池一致)
    key: "recruitedHeroIds",
    read: (e) => [...e.recruitedHeroIds],
    write: (e, s) => {
      e.recruitedHeroIds = new Set(s.recruitedHeroIds);
    },
  },
  {
    // 剩余珍宝牌堆(联机端需复现同一抽牌序列)
    key: "treasureDeck",
    read: (e) => e.treasureDeck.map((t) => ({ id: t.id, name: t.name, level: t.level, desc: t.desc })),
    write: (e, s) => {
      e.treasureDeck = s.treasureDeck.map((t) => ({ id: t.id, name: t.name, level: t.level, desc: t.desc }));
    },
  },
  {
    key: "treasureVisitor",
    read: (e) =>
      e.treasureVisitor ? { propertyId: e.treasureVisitor.def.id, ownerIdx: e.treasureVisitor.ownerIdx } : null,
    write: (e, s) => {
      const tv = s.treasureVisitor;
      if (tv == null) {
        e.treasureVisitor = null;
        return;
      }
      // 定义按 id 从 catalog 现查;查无 = 快照与地图不符,显式抛错(零兜底,不静默丢交涉上下文)
      const def = e.catalog.get(tv.propertyId);
      if (def == null) throw new Error(`快照 treasureVisitor.propertyId=${tv.propertyId} 不在 catalog,交涉上下文无法重建`);
      e.treasureVisitor = { def, ownerIdx: tv.ownerIdx };
    },
  },
  {
    key: "pendingDebt",
    read: (e) => (e.pendingDebt ? { amount: e.pendingDebt.amount, creditor: e.pendingDebt.creditor?.id ?? null } : null),
    write: (e, s) => {
      const debt = s.pendingDebt;
      e.pendingDebt = debt
        ? { amount: debt.amount, creditor: e.players.find((p) => p.id === debt.creditor) ?? null }
        : null;
    },
  },
  {
    // 珍宝交涉交割托管:恢复后可继续清算/交割
    key: "escrowTreasure",
    read: (e) =>
      e.escrowTreasure
        ? {
            treasure: {
              id: e.escrowTreasure.treasure.id,
              name: e.escrowTreasure.treasure.name,
              level: e.escrowTreasure.treasure.level,
              desc: e.escrowTreasure.treasure.desc,
            },
            buyerIdx: e.escrowTreasure.buyerIdx,
            sellerIdx: e.escrowTreasure.sellerIdx,
            price: e.escrowTreasure.price,
          }
        : null,
    write: (e, s) => {
      const esc = s.escrowTreasure;
      e.escrowTreasure = esc
        ? {
            treasure: {
              id: esc.treasure.id,
              name: esc.treasure.name,
              level: esc.treasure.level,
              desc: esc.treasure.desc,
            },
            buyerIdx: esc.buyerIdx,
            sellerIdx: esc.sellerIdx,
            price: esc.price,
          }
        : null;
    },
  },
  {
    // 纯派生(board 常量,不随对局变)
    key: "branchStartTile",
    read: (e) => (e.board.branch ? e.board.branch.startNode : null),
    write: () => {},
  },
  {
    // 纯派生(同 branchStartTile)
    key: "branchEndTile",
    read: (e) => (e.board.branch ? e.board.branch.endNode : null),
    write: () => {},
  },
  {
    // 纯派生(相位 + 棋位实时计算)
    key: "currentTileIsBranchStart",
    read: (e) => e.currentTileIsBranchStart(),
    write: () => {},
  },
  {
    // 决策相位选项集(ADR-0013):纯派生,重 hydrate 后重算即得
    key: "choices",
    read: (e) => e.choicesFor(),
    write: () => {},
  },
  {
    // 决策归属座位(纯派生,同 choices:重 hydrate 后重算即得)
    key: "decisionOwner",
    read: (e) => e.decisionOwner,
    write: () => {},
  },
  {
    // PRNG 状态:CLI/联机跨进程续掷。write 只写 rng 不读骰,清单序下无「必须最后设」约束
    // (成对表各 write 相互独立,不存在穿插消费 rng 的路径)
    key: "rngState",
    read: (e) => e.dice.getRngState(),
    write: (e, s) => {
      e.dice.setRngState(s.rngState);
    },
  },
  {
    key: "players",
    read: (e) =>
      e.players.map((p) => ({
        id: p.id,
        name: p.guohao || p.name,
        guohao: p.guohao,
        colorIndex: p.colorIndex,
        isBot: p.isBot,
        cash: p.cash,
        warrants: p.warrants,
        netWorth: netWorth(p),
        isBankrupt: p.isBankrupt,
        position: p.position,
        capitalIndex: p.capitalIndex,
        onBranch: p.onBranch,
        skipTurns: p.skipTurns,
        properties: p.properties.map((h) => ({ propertyId: h.propertyId, level: h.level, group: h.group })),
        heroes: p.heroes.map((h) => ({ id: h.id, name: h.name, title: h.title, desc: h.desc, image: h.image })),
        // 名士冷却记录(跨进程恢复 cooldown 判定)
        heroLastFired: { ...p.heroLastFired },
        treasures: p.treasures.map((t) => ({ id: t.id, name: t.name, level: t.level, desc: t.desc })),
      })),
    write: (e, s) => {
      // 玩家状态(覆盖构造时设的初值)
      s.players.forEach((ps, i) => {
        const p = e.players[i];
        p.guohao = ps.guohao;
        p.isBot = ps.isBot; // 恢复 isBot(联机客户端的占位引擎可能与服务器不一致)
        p.cash = ps.cash;
        p.warrants = ps.warrants;
        p.isBankrupt = ps.isBankrupt;
        p.position = ps.position;
        p.capitalIndex = ps.capitalIndex;
        p.onBranch = ps.onBranch ? { step: ps.onBranch.step } : null;
        p.skipTurns = ps.skipTurns;
        // heroes:查 HEROES 表补 skill/cooldown(snapshot 故意只存展示字段)
        p.heroes = ps.heroes
          .map((h) => HEROES.find((H) => H.id === h.id))
          .filter((h): h is HeroDef => h != null);
        p.heroLastFired = { ...ps.heroLastFired };
        p.treasures = ps.treasures.map((t) => ({ id: t.id, name: t.name, level: t.level, desc: t.desc }));
        // properties:从 catalog 补 purchasePrice/maxLevel(snapshot 只存 propertyId/level/group)
        p.properties = ps.properties.map((h) => {
          const def = e.catalog.get(h.propertyId);
          return {
            propertyId: h.propertyId,
            group: h.group ?? def?.group ?? "z",
            purchasePrice: def?.purchasePrice ?? def?.buildCost ?? 0,
            level: h.level,
            maxLevel: def?.maxLevel ?? 3,
          };
        });
      });
    },
  },
  {
    // offeredHeroes:从 HEROES 表查完整 HeroDef(snapshot 只存展示字段,丢 skill/cooldown)
    key: "offeredHeroes",
    read: (e) => e.offeredHeroes.map((h) => ({ id: h.id, name: h.name, title: h.title, desc: h.desc, image: h.image })),
    write: (e, s) => {
      e.offeredHeroes = s.offeredHeroes
        .map((h) => HEROES.find((H) => H.id === h.id))
        .filter((h): h is HeroDef => h != null);
    },
  },
  {
    // 表现态字段经 presentation 视图读;回写走 applyPresentationRoll(私有表现字段的恢复写口)
    key: "lastRoll",
    read: (e) => e.presentation.lastRoll,
    write: (e, s) => {
      e.applyPresentationRoll(s.lastRoll);
    },
  },
  {
    // lastMove 全量坐标:联机端收到 snapshot 时行军动画可能尚未播放(或断线重连后需补播),
    // 需坐标才能复现路径。回写走 applyPresentationMove(表现侧写 lastMove 的合法入口)。
    key: "lastMove",
    read: (e) => e.presentation.lastMove,
    write: (e, s) => {
      const m = s.lastMove;
      e.applyPresentationMove(
        m
          ? {
              from: m.from,
              traversed: [...m.traversed],
              landIndex: m.landIndex,
              passedCapital: m.passedCapital,
              capitalIndex: m.capitalIndex,
              waypoints: [...m.waypoints],
              landBranchStep: m.landBranchStep,
              branchWaypoints: [...m.branchWaypoints],
            }
          : null,
      );
    },
  },
  {
    // 表现态扁平字段(UI 直接消费;GameScreen/DecisionScrollLayer 口径不变)。
    // 纯派生:由 lastLandOutcome 重建,不单独回写。
    key: "lastLandOutcomeKind",
    read: (e) => e.lastLandOutcome?.kind ?? null,
    write: () => {},
  },
  {
    // 纯派生(同 lastLandOutcomeKind)
    key: "lastLandOutcomeProperty",
    read: (e) => e.lastLandOutcome?.property?.id ?? null,
    write: () => {},
  },
  {
    // lastLandOutcome:纯表现态(spec #107 C2 退役:决策消费已移交 pendingLand)。
    // 恢复时按 propertyId 从 catalog 重构 property 引用,仅供 UI/战报口径;
    // 无 property 的 outcome(如纯补给 OwnProperty)原样保留为无 property。
    key: "lastLandOutcome",
    read: (e) =>
      e.lastLandOutcome
        ? {
            kind: e.lastLandOutcome.kind,
            propertyId: e.lastLandOutcome.property?.id ?? null,
            amount: e.lastLandOutcome.amount ?? null,
            resupply: e.lastLandOutcome.resupply ?? null,
            causedBankruptcy: e.lastLandOutcome.causedBankruptcy ?? null,
          }
        : null,
    write: (e, s) => {
      const lo = s.lastLandOutcome;
      e.lastLandOutcome = lo
        ? {
            kind: lo.kind,
            // ?? undefined 仅类型归一(catalog.get 缺失返回 null;property 字段语义=无定义即缺席)
            property: (lo.propertyId ? e.catalog.get(lo.propertyId) : undefined) ?? undefined,
            amount: lo.amount ?? undefined,
            resupply: lo.resupply ?? undefined,
            causedBankruptcy: lo.causedBankruptcy ?? undefined,
          }
        : null;
    },
  },
  {
    // 待决策落格(决策上下文单点,spec #107 C2):决策命令消费与恢复重建的唯一出处;
    // lastLandOutcome 不再兼职决策载荷。快照声称有待决策落格但目录查无定义 → 显式抛错
    //(序列化缺口教训:静默丢引用 = 恢复后决策悄悄失效)。
    key: "pendingLand",
    read: (e) => (e.pendingLand ? { kind: e.pendingLand.kind, propertyId: e.pendingLand.propertyId } : null),
    write: (e, s) => {
      const pl = s.pendingLand;
      if (pl != null && e.catalog.get(pl.propertyId) == null)
        throw new Error(`快照 pendingLand.propertyId=${pl.propertyId} 不在 catalog,决策上下文无法重建`);
      e.pendingLand = pl ? { kind: pl.kind, propertyId: pl.propertyId } : null;
    },
  },
  {
    // 纯派生(log 长度,供各端截短战报判断)
    key: "logCount",
    read: (e) => e.log.length,
    write: () => {},
  },
  {
    // 完整战报(CLI 跨进程持久化 / 联机端断线重连看历史)。God view 包含 log,各端可截短。
    key: "log",
    read: (e) => e.log,
    write: (e, s) => {
      e.log = [...s.log];
    },
  },
];

/** 序列化:按单点清单逐键产出快照(键序 = 清单条目序)。
 *  聚合处的 Record 中转仅为让「联合键逐键赋值」过类型检查(清单条目本身已逐键类型约束),
 *  表内 read 的返回类型与 GameSnapshot 键类型一一对应,错配在条目声明处编译期炸出。 */
export function serializeGame(e: GameEngine): GameSnapshot {
  const out = {} as Record<keyof GameSnapshot, unknown>;
  for (const f of SNAPSHOT_FIELDS) out[f.key] = f.read(e);
  return out as GameSnapshot;
}

/** 快照 → 引擎:按单点清单循环应用(各 write 独立,无跨键次序依赖)。
 *  瞬态字段(floaters/lastTransaction)不参与清单,由 GameEngine.restoreFromSnapshot 清空。 */
export function restoreGameSnapshot(e: GameEngine, s: GameSnapshot): void {
  for (const f of SNAPSHOT_FIELDS) f.write(e, s);
}
