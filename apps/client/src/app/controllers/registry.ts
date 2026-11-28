// 控制器注册表:各屏经此取当前 GameController,单机注册 LocalController,联机注册 OnlineController。
// 实例持有方法与连接,放在模块级而不进入 zustand 可序列化状态。
import type { Board } from "@dafung/core/engine/board";
import type { MapCatalog } from "@dafung/core/engine/board-loader";
import type { MapData } from "@dafung/core/engine/board-loader";
import type { GameController } from "./controller";

let current: GameController | null = null;
/** 当前对局地图原始数据(MapData)。快照不含地图(体积考虑),BoardView 需要它重建棋盘。 */
let currentMap: MapData | null = null;
/** 渲染层的静态查询上下文(board/catalog);可变数据从快照读取。
 *  地图随引擎构造确定,联机换图重建引擎后由 setController 更新。 */
let currentContext: { board: Board; catalog: MapCatalog } | null = null;

/** 注册新对局的控制器与地图(换局时旧 controller 会先 destroy 释放 WS 等资源)。 */
export function setController(controller: GameController | null, map: MapData | null = null): void {
  if (current && current !== controller) current.destroy();
  current = controller;
  currentMap = map;
  // 静态上下文取自当前引擎(board/catalog 是构造入参、对局期不可变,存引用无复制开销)。
  currentContext = controller
    ? { board: controller.engine.board, catalog: controller.engine.catalog }
    : null;
}

/** 取当前控制器(null = 尚未开局)。屏幕组件用它做交互入口。 */
export function getController(): GameController | null {
  return current;
}

/** 取当前对局地图数据(BoardView 的 map prop 来源;null = 尚未开局)。 */
export function getControllerMap(): MapData | null {
  return currentMap;
}

/** 取当前对局的静态查询上下文(board/catalog;null = 尚未开局),供渲染层查城名与地产定义。 */
export function getControllerContext(): { board: Board; catalog: MapCatalog } | null {
  return currentContext;
}

// ──────────────────────────── window.__dafung 调试钩子 ────────────────────────────
// 控制台与单次辅助可读引擎/快照、重同步、种植场景及控制演出与房间时钟。
// 类型声明见 src/app/debug.d.ts;使用边界见 ADR-0065。
import { getEngine, setEngine, useGameStore } from "@app/store/gameStore";
import { E2E_DEBUG_BRIDGE_KEY } from "@app/fx/timings";
import { catchupCounters, setSnapPin } from "@app/fx/catchup";
import { latestWorkerClock } from "@app/net/worker-clock";
import { collectFrameDiag } from "@app/frameDiag";
import { present } from "@app/fx/orchestrator";
import { anchorMarches } from "@app/fx/event-extract";
import { createEngineSink } from "@app/fx/sinks";
import type { PresentationEvent } from "@app/fx/presentation";
import type { GameCommand, GameEngine } from "@dafung/core/engine/authority";
import { MAX_SEAT_COUNT, MIN_SEAT_COUNT } from "@dafung/core/engine/constants";
import { applyPlant, type PlantOp } from "@dafung/core/engine/planter";
import { HEROES } from "@dafung/core/engine/heroes";
import { loadMapById } from "@dafung/core/engine/map-source";
import { getDefaultMapId, getMapSource } from "@app/map-sources";
import {
  DEFAULT_GUOHAO,
  DEFAULT_TARGET_NET_WORTH,
  defaultSetupSeats,
} from "@app/screens/setup/setup-defaults";
import { LocalController } from "./local";

// 偏好键与 App.tsx MAP_PREF_KEY / SoloSetupScreen GUOHAO_PREF_KEY 保持一致;
// 直接导入整屏会把组件树带入调试桥。席位/身价/国号默认值共用 setup-defaults.ts。
const MAP_PREF_KEY = "dafung.mapId";
const GUOHAO_PREF_KEY = "dafung.guohao";

/** main.tsx 挂载前安装调试桥;仅 dev 构建或显式预置 E2E_DEBUG_BRIDGE_KEY 时注册。
 *  生产默认不暴露引擎改写面;明确请求的单次辅助可预置桥键(ADR-0065)。 */
export function installDebugHooks(): void {
  const gated = import.meta.env.DEV || localStorage.getItem(E2E_DEBUG_BRIDGE_KEY) != null;
  if (!gated) return;
  // 快路径开局复用地图加载、LocalController 与 setController/sync/切屏,再经公共命令选都。
  // 默认值共用 setup-defaults.ts,地图/国号读取偏好。
  // seedSoloToRound 复用此链,开局后必须停在座位 0 选都门。
  const seedSolo = async (opts: { seed?: number; mapId?: string; seats?: number } = {}) => {
    // 显式席位数须与设置屏/引擎同界,先拒绝非整数,避免 defaultSetupSeats 截断。
    if (
      opts.seats != null &&
      (!Number.isInteger(opts.seats) || opts.seats < MIN_SEAT_COUNT || opts.seats > MAX_SEAT_COUNT)
    )
      throw new Error(
        `seedSolo:seats 须为 ${MIN_SEAT_COUNT}–${MAX_SEAT_COUNT} 的整数(收到 ${String(opts.seats)})`,
      );
    const source = getMapSource();
    // df.seed.* 分段量取参数解析、地图加载、控制器构造、注册、同步和选都;cost-probe 聚合读取。
    const tResolve = performance.now();
    const mapId = opts.mapId ?? localStorage.getItem(MAP_PREF_KEY) ?? (await getDefaultMapId());
    const guohao = localStorage.getItem(GUOHAO_PREF_KEY) ?? DEFAULT_GUOHAO;
    const seats = defaultSetupSeats(guohao, opts.seats);
    performance.measure("df.seed.resolve", { start: tResolve, end: performance.now() });
    const tMap = performance.now();
    const map = await loadMapById(source, mapId);
    performance.measure("df.seed.loadMapById", { start: tMap, end: performance.now() });
    const tCtor = performance.now();
    const controller = new LocalController(map, {
      seats,
      targetNetWorth: DEFAULT_TARGET_NET_WORTH,
      seed: opts.seed,
      mapId,
    });
    performance.measure("df.seed.ctor", { start: tCtor, end: performance.now() });
    const tSet = performance.now();
    // map-sources 缓存同图数据,注册时复用加载结果。
    setController(controller, await source.loadMapData(mapId));
    performance.measure("df.seed.setController", { start: tSet, end: performance.now() });
    const tSync = performance.now();
    useGameStore.getState().setScreen("game");
    performance.measure("df.seed.sync", { start: tSync, end: performance.now() });
    const e = controller.engine;
    if (
      e.phase !== "Setup" ||
      e.setupPhase !== "PickCapital" ||
      e.currentSetupPlayerIndex !== 0 ||
      e.offeredCapitals.length === 0
    ) {
      throw new Error(
        `seedSolo:开局后未停在选择都相位(phase=${e.phase}/${e.setupPhase} ` +
          `轮次=${e.currentSetupPlayerIndex} 候选=${e.offeredCapitals.length})`,
      );
    }
    // 选棋盘序首个候选,与 UI 首格点击一致;offeredCapitals 是抽出序,不能取 [0]。
    const tPick = performance.now();
    controller.setupPickCapital(Math.min(...e.offeredCapitals));
    performance.measure("df.seed.pickCapital", { start: tPick, end: performance.now() });
  };

  // 中盘构造:冻结房间时钟后,经房间命令面逐拍应答真人决策,推进到目标回合的稳定停靠态。
  // 引擎只读查询与读数可直取,写入均走 dispatchCommand,保持事件批归属与 RNG 消耗序。
  /** 取首个可用决策;反应窗答不用、锦囊今不用、珍宝不交易。
   *  破产清算不代答,遇到即抛错,由调用方调整 seed/目标回合。 */
  const answerAtHumanStop = (e: GameEngine): GameCommand => {
    switch (e.turnPhase) {
      case "Roll":
        return { type: "rollAndMove" }; // 停靠 Roll=开手无可用锦囊已自决,起摇即走
      case "AwaitingJinnang":
        return { type: "useJinnang", cardId: null }; // 今不用
      case "AwaitingDecision": {
        const idx = e.choicesFor().findIndex((o) => o.available);
        const opt = e.choicesFor()[idx];
        if (opt?.id === "buy") return { type: "buyProperty" };
        if (opt?.id === "upgrade") return { type: "upgradeProperty" };
        if (opt?.id === "skip") return { type: "endDecision" };
        throw new Error(`seedSoloToRound:AwaitingDecision 选项异常(${JSON.stringify(opt)})`);
      }
      case "AwaitingHeroPick":
        return e.offeredHeroes.length > 0
          ? { type: "resolveHeroPick", index: 0 }
          : { type: "resolveHeroPick", action: "seekBook" };
      case "AwaitingTreasureOwner":
        return { type: "resolveTreasureOwner", action: { type: "skip" } }; // 不交易
      case "AwaitingReaction":
        return { type: "respondReaction", seat: 0, use: false }; // 「不用」(单机人类座位 0)
      case "AwaitingBankruptcySettle":
        throw new Error(
          "seedSoloToRound:快进撞上破产清算决策(AwaitingBankruptcySettle)——应答表不接,换 seed/目标回合避开",
        );
      default:
        throw new Error(`seedSoloToRound:不可应答相位 ${e.turnPhase}`);
    }
  };
  /** 停靠须由座位 0 行动且决策,处于非反应窗 Awaiting* 相位,turnNumber 达标。
   *  afterFirstRoll 另要求本次快进已应答 rollAndMove,避免开手锦囊窗被认作首掷后。
   *  仅在 interactive 时派命令,随后让出宏任务,等真实事件回流与本座演出落定;
   *  bot 仍由房间驱动链推进。反应窗解冻会超时代答,不能作为稳定停靠态。 */
  const driveToRound = async (targetRound: number, opts?: { afterFirstRoll?: boolean }) => {
    const deadline = Date.now() + 120_000;
    const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
    let lastFp = "";
    let stallSince = 0; // 当前 fp 首见的 interactive 拍时刻,作为无进展守卫的墙钟锚
    let rolled = false; // 已应答过起摇(首掷在引擎侧随命令同步段落账)
    for (;;) {
      if (Date.now() > deadline)
        throw new Error(`seedSoloToRound:120s 内未推进到第 ${targetRound} 回合(推进停滞)`);
      const e = getEngine();
      if (e == null) throw new Error("seedSoloToRound:引擎丢失(对局被销毁)");
      if (e.phase === "GameOver")
        throw new Error(`seedSoloToRound:快进途中终局(round=${e.round},目标=${targetRound})`);
      if (e.phase !== "Playing") throw new Error(`seedSoloToRound:非 Playing 相位(${e.phase})`);
      const parked =
        e.activeIndex === 0 &&
        e.decisionOwner === 0 &&
        e.turnPhase !== "AwaitingReaction" &&
        e.turnPhase.startsWith("Awaiting") &&
        (!opts?.afterFirstRoll || rolled);
      if (parked && e.turnNumber >= targetRound)
        return { turnNumber: e.turnNumber, round: e.round, turnPhase: e.turnPhase };
      const c = getController();
      if (c == null) throw new Error("seedSoloToRound:控制器丢失");
      if (!c.interactive) {
        await sleep(0); // 命令在途(等该命令事件拍回流)/本座行军演出未落定/等相位转移:宏任务短让出
        continue;
      }
      const fp = `${e.turnNumber}/${e.round}/${e.turnPhase}/${e.gameEvents.length}`;
      if (fp !== lastFp) {
        lastFp = fp;
        stallSince = Date.now();
      } else if (Date.now() - stallSince > 3000) {
        // 守卫只在 interactive 拍检查,指纹变化即重锚。
        throw new Error(
          `seedSoloToRound:应答无进展 3s+(phase=${e.turnPhase} round=${e.round})——命令被吞或驱动断链`,
        );
      }
      const cmd = answerAtHumanStop(e);
      if (cmd.type === "rollAndMove") rolled = true;
      c.dispatchCommand(cmd);
      await sleep(0); // 精确让出:等该命令事件拍回流(pending 解锁),回流后首拍 interactive 转真即续
    }
  };
  const w = window as typeof window & { __dafung?: unknown };
  w.__dafung = {
    /** 表现态构造:原样走产品播放器与生产 sink;不改引擎或表现 store 字段。 */
    playPresentation: (events: PresentationEvent[]) => {
      const sink = createEngineSink();
      anchorMarches(events, sink);
      return present(events, sink);
    },
    getEngine,
    setEngine,
    /** 当前 store 里的全量快照。 */
    snapshot: () => useGameStore.getState().snapshot,
    /** 手动从引擎重灌快照(怀疑 UI 与引擎脱节时排查用)。 */
    sync: () => getController()?.sync(),
    /** 名将目录供招贤候选种植;候选行须含 def 与预掷 skillIds,引擎落定时原样入槽。 */
    heroDefs: () => [...HEROES],
    /** 转发 core/planter 的 applyPlant,与无浏览器测试共用场景构造(ADR-0065)。
     *  只应用种植;调用方先等演出排空,写后经 controller().sync() 同步并再次等排空。 */
    plant: (op: PlantOp) => {
      const e = getEngine();
      if (e == null) throw new Error("plant:无活动对局(未开局不可种植)");
      applyPlant(e, op);
    },
    /** 当前控制器(交互入口)。 */
    controller: () => getController(),
    seedSolo,
    /** seedSolo 开局后冻结房间时钟,由 driveToRound 推进到目标回合的稳定停靠态后解冻。
     *  afterFirstRoll 要求首掷已发生;演出排空由调用方等待。 */
    seedSoloToRound: async (opts: {
      seed?: number;
      mapId?: string;
      seats?: number;
      targetRound: number;
      afterFirstRoll?: boolean;
    }) => {
      if (!Number.isInteger(opts.targetRound) || opts.targetRound < 1)
        throw new Error(
          `seedSoloToRound:targetRound 须为 ≥1 整数(收到 ${String(opts.targetRound)})`,
        );
      await seedSolo(opts);
      const clock = latestWorkerClock();
      if (clock == null) throw new Error("seedSoloToRound:无活动 Worker 时钟(仅单机对局可冻结)");
      clock.pause();
      const arrival = await driveToRound(opts.targetRound, {
        afterFirstRoll: opts.afterFirstRoll,
      });
      clock.resume();
      return arrival;
    },
    /** 瞬空钉:转发 catchup.setSnapPin,使 SnapshotEffects.dequeueChunk 常开吸附档。
     *  只弃未播演出、棋子直切终态,不改引擎;产品默认关闭,解除后恢复正常判档(ADR-0065)。 */
    setSnapPin: setSnapPin,
    // 冻结单机 Worker 时钟的看门狗/自动起摇/托管回调,resume 按到点序补放。
    // 未开局或联机没有 Worker 时钟,误用直接抛错。
    clockPause: () => {
      const c = latestWorkerClock();
      if (c == null) throw new Error("clockPause:无活动 Worker 时钟(仅单机对局可冻结)");
      c.pause();
    },
    clockResume: () => {
      const c = latestWorkerClock();
      if (c == null) throw new Error("clockResume:无活动 Worker 时钟(仅单机对局可冻结)");
      c.resume();
    },
    // 落后即校准诊断只读快照(ADR-0029;实体见 fx/catchup.ts)。
    fxCatchup: () => ({ ...catchupCounters }),
    // scripts/frame-probe.ts 经此读取活动帧诊/lastDump;只读,不启停采样(ADR-0047)。
    frameDiag: () => collectFrameDiag(),
  };
}
