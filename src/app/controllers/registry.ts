// 控制器注册表(模块级单例):App 各屏统一从这里取当前 GameController,
// 不把 controller 塞进 zustand(实例带方法/WS 连接等非序列化资源,同 engine 的理由,见 gameStore.ts 注释)。
// 单机开局(setup 屏/临时快速开局)调 setController 注册 LocalController;
// 联机(后续阶段)注册 OnlineController —— 屏幕组件对两种模式无感。
import type { Board } from "@core/board";
import type { MapCatalog } from "@core/board-loader";
import type { MapData } from "@core/board-loader";
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
import { E2E_DEBUG_BRIDGE_KEY } from "@app/fx/timings";
import { catchupCounters } from "@app/fx/catchup";
import { latestWorkerClock } from "@app/net/worker-clock";
import { collectFrameDiag } from "@app/frameDiag";
import type { GameCommand, GameEngine } from "@core/authority";
import { HEROES } from "@core/heroes";
import { loadMapById } from "@core/map-source";
import { getDefaultMapId, getMapSource } from "@app/map-sources";
import {
  DEFAULT_GUOHAO,
  DEFAULT_TARGET_NET_WORTH,
  defaultSetupSeats,
} from "@app/screens/setup/setup-defaults";
import { LocalController } from "./local";

// 默认链键名与设置屏同字面量(App.tsx MAP_PREF_KEY / SoloSetupScreen GUOHAO_PREF_KEY):
// 引 App/SoloSetupScreen 模块只为一个字符串会把整屏组件树拖进桥的 import 图,
// 同字面量+注释指单源是 fixtures.ts 既定先例。缺省值(席位/身价/国号)不走本文件
// 字面量——单源在 setup-defaults.ts(与设置屏共用,#1211 QC 抽取)。
const MAP_PREF_KEY = "dafung.mapId";
const GUOHAO_PREF_KEY = "dafung.guohao";

/** 在 main.tsx 挂载前调用一次;幂等(StrictMode 双调用安全)。
 *  双门禁(timings.ts E2E_DEBUG_BRIDGE_KEY):仅 dev 构建,或 e2e/截图脚手架经
 *  addInitScript 预置桥键时才注册——生产构建零引擎改写面(单机控制台可改引擎),
 *  测试/生产的可观察面不靠约定靠门禁(2026-09-25 学自 ZCode e2eStoreBridge)。 */
export function installDebugHooks(): void {
  const gated = import.meta.env.DEV || localStorage.getItem(E2E_DEBUG_BRIDGE_KEY) != null;
  if (!gated) return;
  // ── 种局式快路径开局(#1211,e2e 专用)──
  // 复刻 App.handleStart 生产三步(加载地图 → LocalController → setController/sync/
  // 进 game 屏)+ 程序化选都,一步直达对局态。缺省逐项对齐 SoloSetupScreen 默认
  // (单源 setup-defaults.ts):4 席 / 目标身价标准档 / 地图 = localStorage 记忆→
  // 清单首项 / 国号 = 记忆→「魏」;机遇硬关(openSoloSetup 的 jiyu.json route 拦截
  // 同语义)。选都只走公共命令 setupPickCapital(UI「定都于此」确认最终发的那条,
  // 架构红线 3:不直改引擎内部状态);开局后未停在选择都相位 = 起兵编排有 bug,
  // 当场抛错不静默(零兜底)。
  // 本体提为局部函数(#1252 中盘构造器示导波):seedSoloToRound 复用同一条开局链,
  // 不复制实现——开局语义单源仍在本注释与 how-to「种局式直通」条。
  const seedSolo = async (opts: { seed?: number; mapId?: string; seats?: number } = {}) => {
    const source = getMapSource();
    const mapId = opts.mapId ?? localStorage.getItem(MAP_PREF_KEY) ?? (await getDefaultMapId());
    const guohao = localStorage.getItem(GUOHAO_PREF_KEY) ?? DEFAULT_GUOHAO;
    const seats = defaultSetupSeats(guohao, opts.seats);
    const map = await loadMapById(source, mapId);
    const controller = new LocalController(map, {
      seats,
      targetNetWorth: DEFAULT_TARGET_NET_WORTH,
      seed: opts.seed,
      mapId,
      encounter: { enabled: false }, // 快路径硬关,与 openSoloSetup route 拦截同语义
    });
    setController(controller, await source.loadMapData(mapId));
    useGameStore.getState().syncFromEngine(controller.engine);
    useGameStore.getState().setScreen("game");
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
    // 选都口径对齐旅程点击语义:pickCapital 助手点的是 DOM 首个可选格(BoardView 按
    // 格 index 序渲染)= 候选集里棋盘序首个。offeredCapitals 数组序是抽出序、与棋盘
    // 序不同序(seed 1101 实证 [20,7,25]、DOM 首格=7)——取 [0] 会让同 seed 两路开
    // 出两局不同的棋,钉种子的用例全数漂移。统一原则:两路同 seed 必须同局。
    controller.setupPickCapital(Math.min(...e.offeredCapitals));
  };

  // ── 中盘构造器(ADR-0059 示导波,#1252)──
  // 冻结编排时钟后,页内按无头整局同款语义(回合数变化定界,whole-game driveToEnd 同源
  // 口径)经房间命令面逐拍应答真人决策点,推进到第 N 回合边界,解冻交还被测环(沉降
  // waitFxIdle/waitSettled 归调用方)。合法性=按构造等同(ADR-0059):现场由引擎真逻辑
  // 经公共命令长出(RNG 流位与事件批按真实序产生),非深种;直调引擎仅限 choicesFor()
  // 只读问询与状态读数,写一律走 dispatchCommand(混用会挪事件批归属)。
  /** 真人决策点应答表(#1252 钉死口径):选项集 ≤1 引擎进相位门槛已自决(choices.ts
   *  enterDecisionPhase/enterJinnangPhase 同款——真停在决策相位即有 ≥1 真选择),取
   *  首个可用;反应窗一律「不用」代发(看门狗超时兜底同款);锦囊=今不用、珍宝交涉=
   *  不交易,对齐既有 e2e 代发口径(actIfCan 先 pass / parkMyTurn 点 treasureSkip)。
   *  破产清算不代答当场炸(多段变卖决策,目标回合内出现负债=换 seed/目标回合避开,
   *  不静默兜)。 */
  const answerAtHumanStop = (e: GameEngine): GameCommand => {
    switch (e.turnPhase) {
      case "Roll":
        return { type: "rollAndMove" }; // 停靠 Roll=开手无可用锦囊已自决,起摇即走(#188 同款)
      case "AwaitingJinnang":
        return { type: "useJinnang", cardId: null }; // 今不用(出牌阶段既有代发口径)
      case "AwaitingDecision": {
        const idx = e.choicesFor().findIndex((o) => o.available);
        const opt = e.choicesFor()[idx];
        if (opt?.id === "buy") return { type: "buyProperty" };
        if (opt?.id === "upgrade") return { type: "upgradeProperty" };
        if (opt?.id === "skip") return { type: "endDecision" };
        throw new Error(`seedSoloToRound:AwaitingDecision 选项异常(${JSON.stringify(opt)})`);
      }
      case "AwaitingHeroPick":
      case "AwaitingEncounter":
      case "AwaitingExhaustion": {
        // index = 选项集下标(resolveEncounterChoice/resolveExhaustionChoice 的 index
        // 即 snapshot.choices 顺序下标,encounter-flow 注释单源)。
        const idx = e.choicesFor().findIndex((o) => o.available);
        if (idx < 0)
          throw new Error(
            `seedSoloToRound:${e.turnPhase} 无可用选项(进相位门槛应保证 ≥1,状态机 bug)`,
          );
        if (e.turnPhase === "AwaitingHeroPick") return { type: "resolveHeroPick", index: idx };
        if (e.turnPhase === "AwaitingEncounter")
          return { type: "resolveEncounterChoice", index: idx };
        return { type: "resolveExhaustionChoice", index: idx };
      }
      case "AwaitingTreasureOwner":
        return { type: "resolveTreasureOwner", action: { type: "skip" } }; // 不交易(既有代发口径)
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
  /** 推进循环:每拍 = 真人决策点应答 → 让出宏任务 → 读回合数,至停靠态(parkMyTurn
   *  谓词:activeIndex/decisionOwner=0 × Awaiting*;另排除 AwaitingReaction——解冻后
   *  5s 代发看门狗会收窗,非稳定停靠)且 turnNumber ≥ targetRound。命令只在 interactive
   *  门开启的同一同步块里派(dispatchCommand 的 pending/演出锁会静默吞命令,轮询续拍
   *  重试);bot 腿由房间驱动链在本命令同步段内推进(e2e botStepMs=0),页内不直调
   *  botAct。同 seed 两跑确定性:应答表无随机、看门狗冻结不点火、RNG 消耗序由引擎定。 */
  const driveToRound = async (targetRound: number) => {
    const deadline = Date.now() + 120_000;
    const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
    let lastFp = "";
    let stallBeats = 0;
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
        e.turnPhase.startsWith("Awaiting");
      if (parked && e.turnNumber >= targetRound)
        return { turnNumber: e.turnNumber, round: e.round, turnPhase: e.turnPhase };
      const c = getController();
      if (c == null) throw new Error("seedSoloToRound:控制器丢失");
      if (!c.interactive) {
        await sleep(20); // 命令在途/本座行军演出未落定:让出宏任务等下一拍
        continue;
      }
      const fp = `${e.turnNumber}/${e.round}/${e.turnPhase}/${e.gameEvents.length}`;
      if (fp === lastFp && ++stallBeats > 150)
        throw new Error(
          `seedSoloToRound:应答无进展 3s+(phase=${e.turnPhase} round=${e.round})——命令被吞或驱动断链`,
        );
      if (fp !== lastFp) {
        lastFp = fp;
        stallBeats = 0;
      }
      c.dispatchCommand(answerAtHumanStop(e));
      await sleep(20); // 让出宏任务:命令同步段(引擎结算+bot 链)与下行拍落地
    }
  };
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
    /** 名将目录全量 HeroDef(#378):e2e/控制台种植招贤候选用——候选行 = {def, skillIds
     *  (预掷授技,#787)},直写 offeredHeroes 必须给候选行形状;预掷结果由种植者定
     *  (e2e 通常给整池),引擎落定原样入槽不重掷。 */
    heroDefs: () => [...HEROES],
    /** 当前控制器(交互入口)。 */
    controller: () => getController(),
    seedSolo,
    /** 中盘构造器(ADR-0059 示导波,#1252):seedSolo 同款开局 → 冻结房间时钟 → 页内
     *  逐拍应答真人决策点(应答表见 answerAtHumanStop)推进至第 targetRound 回合边界
     *  (停靠谓词对齐 parkMyTurn)→ 解冻。返回停靠态读数;同 seed 同目标回合两跑逐位
     *  一致(守卫 spec e2e/react-midgame-constructor.spec.ts 钉 seed 守着)。 */
    seedSoloToRound: async (opts: {
      seed?: number;
      mapId?: string;
      seats?: number;
      targetRound: number;
    }) => {
      if (!Number.isInteger(opts.targetRound) || opts.targetRound < 1)
        throw new Error(
          `seedSoloToRound:targetRound 须为 ≥1 整数(收到 ${String(opts.targetRound)})`,
        );
      await seedSolo(opts);
      const clock = latestWorkerClock();
      if (clock == null) throw new Error("seedSoloToRound:无活动 Worker 时钟(仅单机对局可冻结)");
      clock.pause();
      const arrival = await driveToRound(opts.targetRound);
      clock.resume();
      return arrival;
    },
    // ── 房间时钟冻结闸(#421,调试观测面)──
    // pause 后看门狗(#188 自动起摇/#281 反应窗/#118 停摆/#380 保留窗)与托管
    // 步进的到点回调全部挂起,resume 按到点序补放——e2e 把对局钉在任意停靠态做
    // 「种植→点击→断言」手术,根除与自动推进的竞速。纯调试面:产品路径从不调用,
    // 不冻结时零行为变化;冻结后断言仍失败 = 真 bug,上报而非掩盖(零兜底)。
    // 无活动 Worker 时钟(未开局/联机对局)当场抛错——调试面误用要响,不静默。
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
    // ── 落后即校准诊断面(#610,ADR-0029 ③;只读快照,实体见 fx/catchup.ts)──
    fxCatchup: () => ({ ...catchupCounters }),
    // ── 帧诊读取口(ADR-0047 消费面):scripts/frame-probe.ts(日常帧率薄弱点检测)
    //  经此读活动会话/lastDump,免再开导出下载通路。只读,不启停采样。 ──
    frameDiag: () => collectFrameDiag(),
  };
}
