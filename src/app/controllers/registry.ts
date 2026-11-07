// 控制器注册表(模块级单例):App 各屏统一从这里取当前 GameController,
// 不把 controller 塞进 zustand(实例带方法/WS 连接等非序列化资源,同 engine 的理由,见 gameStore.ts 注释)。
// 单机开局(setup 屏/临时快速开局)调 setController 注册 LocalController;
// 联机(后续阶段)注册 OnlineController —— 屏幕组件对两种模式无感。
import type { GameEngine } from "@core/authority";
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

// ──────────────────────────── 单机权威引擎登记位(#1240 调试桥双口)────────────────────────────
// 调试桥第二口 getAuthorityEngine 的模块级登记位:独立于状态桥引擎单例(getEngine 的
// store 侧引用)——T2 接缝翻转后状态桥单例换成水合副本,本登记位直引的房间权威引擎
// 纹丝不动,种植/注入类 e2e 语义不随翻转漂移。登记时机:单机控制器建房(LocalController
// 构造)登记、destroy(解散/换局)清除;联机对局/未开局天然无登记,访问口抛错(零兜底,
// 不返回 undefined 溜过去)。
let authoritative: GameEngine | null = null;

/** 单机控制器建房时登记房间权威引擎(登记位唯一写入口,单测直调)。 */
export function registerAuthorityEngine(engine: GameEngine): void {
  authoritative = engine;
}

/** 解散/换局时清除登记(权威口随之恢复抛错态)。无所属比对:生产换局序恒为
 *  「旧 destroy(setController(null)/换局销毁)→ 新控制器构造登记」,清除先于新登记,
 *  时序错乱若将来出现,force 注入当场抛错暴露(零兜底,不加防御分支)。 */
export function clearAuthorityEngine(): void {
  authoritative = null;
}

/** 调试桥单机权威访问口(与玩家侧 getEngine 并列;force 注入/种植段/abort 类测试
 *  注入专用,规格 #1239「凡走权威口即种植段」):无登记即抛错。 */
export function getAuthorityEngine(): GameEngine {
  if (authoritative == null)
    throw new Error("getAuthorityEngine:仅单机对局存在权威引擎(联机/未开局无登记)");
  return authoritative;
}

// ──────────────────────────── window.__dafung 调试钩子 ────────────────────────────
// 重建旧 src/render/state.ts 的调试入口:控制台可直接读引擎/快照(玩家侧/单机权威双口)。
// 类型声明见 src/app/debug.d.ts(declare global,零运行时开销)。
import { getEngine, setEngine, useGameStore } from "@app/store/gameStore";
import { E2E_DEBUG_BRIDGE_KEY } from "@app/fx/timings";
import { catchupCounters } from "@app/fx/catchup";
import { latestWorkerClock } from "@app/net/worker-clock";
import { collectFrameDiag } from "@app/frameDiag";
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
  const w = window as typeof window & { __dafung?: unknown };
  w.__dafung = {
    getEngine,
    /** 单机权威访问口(#1240 双口预置):直取单机房间权威引擎本体,force 注入/种植段
     *  专用——语义见模块级登记位一节;无登记抛错,联机对局不走此口。 */
    getAuthorityEngine,
    setEngine,
    /** 当前 store 里的快照(god view;等价旧 __dafung.snapshot)。 */
    snapshot: () => useGameStore.getState().snapshot,
    /** 名将目录全量 HeroDef(#378):e2e/控制台种植招贤候选用——候选行 = {def, skillIds
     *  (预掷授技,#787)},直写 offeredHeroes 必须给候选行形状;预掷结果由种植者定
     *  (e2e 通常给整池),引擎落定原样入槽不重掷。 */
    heroDefs: () => [...HEROES],
    /** 当前控制器(交互入口)。 */
    controller: () => getController(),
    // ── 种局式快路径开局(#1211,e2e 专用)──
    // 复刻 App.handleStart 生产三步(加载地图 → LocalController → setController/sync/
    // 进 game 屏)+ 程序化选都,一步直达对局态。缺省逐项对齐 SoloSetupScreen 默认
    // (单源 setup-defaults.ts):4 席 / 目标身价标准档 / 地图 = localStorage 记忆→
    // 清单首项 / 国号 = 记忆→「魏」;机遇硬关(openSoloSetup 的 jiyu.json route 拦截
    // 同语义)。选都只走公共命令 setupPickCapital(UI「定都于此」确认最终发的那条,
    // 架构红线 3:不直改引擎内部状态);开局后未停在选择都相位 = 起兵编排有 bug,
    // 当场抛错不静默(零兜底)。
    seedSolo: async (opts: { seed?: number; mapId?: string; seats?: number } = {}) => {
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
