// 关键接线:真实组件与控制器验证命令/状态或私密信息通路,不验证几何和演出。
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
// bun 测试进程无 Vite define:GameScreen 全图经 SettingsDialog 触达 version.ts,其
// 模块求值读构建期注入的 __APP_VERSION__——按生产同一值源(package.json CalVer)先行
// 注入,晚绑 import 前生效(模板同款,#1297 波评审备案:留置不还原,无害)。
import { useFxStore } from "@app/fx/fxStore";
import { TESTIDS } from "@app/screens/game/testids";
import { useGameStore, type GameSnapshot } from "@app/store/gameStore";
import { useNetStore } from "@app/store/netStore";
import { GameEngine, type GameCommand, type SeatConfig } from "@core/authority";
import { loadMap } from "@core/board-loader";
import { createDice } from "@core/dice";
import { giveJinnang } from "@core/planter";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import pkg from "../../package.json";
import guanzhongData from "../../public/maps/guanzhong.json";
import { ensureHappyDom, releaseHappyDom } from "./happy-dom-register";
(globalThis as Record<string, unknown>).__APP_VERSION__ = pkg.version;

/** 晚绑模块型(late binding,红线见头注第 0 步;type-of-import 类型面静态引用,
 *  求值面零触碰,不破晚绑)。 */
type GameScreenModule = typeof import("@app/screens/game/GameScreen");
type RegistryModule = typeof import("@app/controllers/registry");
type GameControllerClass = import("@app/controllers/controller").GameController;
type ExtractModule = typeof import("@app/fx/event-extract");
type OrchestratorModule = typeof import("@app/fx/orchestrator");
type SinksModule = typeof import("@app/fx/sinks");
let GameScreen: GameScreenModule["GameScreen"];
let setController: RegistryModule["setController"];
let extractBatchEvents: ExtractModule["extractBatchEvents"];
let present: OrchestratorModule["present"];
let createEngineSink: SinksModule["createEngineSink"];

/** 接线控制器面(GameController 生产基类的最小子型 + resync 测试口;构造见 beforeAll)。 */
type WiringController = GameControllerClass & { resync(): void };
let newWiringController: (e: GameEngine) => WiringController;

const MAP = loadMap(guanzhongData);
const SEED = 67; // 锦囊族既定锚(react-jinnang/peek/self-target 三 spec 同源离线核算,头注第 2 步)

/** 座位表:与模板同(solo 口径 seat 0 = 自机)。 */
const SEATS: SeatConfig[] = [
  { name: "座 1", isBot: false, guohao: "魏" },
  { name: "座 2", isBot: true },
  { name: "座 3", isBot: true },
  { name: "座 4", isBot: true },
];

/** 种引擎到 Playing 停靠(公共命令链,模板 seedPlayingEngine 同款;非法态当场
 *  抛错不静默)。seed 67 落点:开局出牌阶段态(turnPhase=AwaitingJinnang、手各 1、
 *  牌库 14),react-jinnang.spec 头注离线核算同款。 */
function seedPlayingEngine(): GameEngine {
  const e = new GameEngine(MAP.board, MAP.catalog, createDice(SEED), {
    seats: SEATS,
    targetNetWorth: MAP.targetNetWorth,
    startingCash: MAP.startingCash,
    startingTreasures: MAP.startingTreasures,
    seed: SEED,
    mapId: "guanzhong",
    encounter: { enabled: false }, // 机遇硬关:与 e2e quickStart/单测既有口径同
  });
  e.doDraftRoll();
  while (e.phase === "Setup") {
    if (!e.aiSetupStep()) {
      const r = e.pickCapital(e.currentSetupPlayerIndex, Math.min(...e.offeredCapitals));
      if (!r.ok) throw new Error(`种局:选都被拒(${r.reason ?? "未知"})`);
    }
  }
  if (e.phase !== "Playing") throw new Error(`种局:选都链后非 Playing(phase=${e.phase})`);
  return e;
}

let container: HTMLElement | null = null;
let root: Root | null = null;

/** act() 内挂 GameScreen;卸载统一走 afterEach。 */
function mount(): HTMLElement {
  container = document.createElement("div");
  document.body.appendChild(container);
  act(() => {
    root = createRoot(container!);
    root.render(<GameScreen />);
  });
  return container;
}

/** 种局→布场→注册控制器→基类 sync 灌 store→挂屏(每例开头同款一条龙)。
 *  writeEngine = 进程内引擎直写 + 重灌 store(与 e2e 种植件裸写形同语义的无桥同构,
 *  判词见模板头注;旧名 force 已随 #1303 退役,勿复用)。 */
function startGame(plant: (e: GameEngine) => void): {
  el: HTMLElement;
  engine: GameEngine;
  writeEngine: (write: (e: GameEngine) => void) => void;
  snap: () => GameSnapshot;
} {
  const e = seedPlayingEngine();
  plant(e);
  const c = newWiringController(e);
  setController(c);
  act(() => {
    c.resync();
  });
  const el = mount();
  return {
    el,
    engine: e,
    writeEngine: (write) => {
      write(e);
      act(() => {
        c.resync();
      });
    },
    snap: () => useGameStore.getState().snapshot!,
  };
}

function q(scope: ParentNode, id: string): Element | null {
  return scope.querySelector(`[data-testid="${id}"]`);
}

/** 真点击(React 合成事件走冒泡;act 内派发,模板同款)。 */
function click(el: Element): void {
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

/** 异步拍收口(模板同款):弹层壳底件挂载拍有 RO 测量态更新,回调在 act 外落会刷
 *  act 警告噪声——让一拍宏任务并包进 act(断言面不依赖该拍,纯噪声治理)。 */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

/** 弹层查询口:详情/窥探弹层经 Portal 渲染在 body,一律 document 级。 */
const modalQ = (id: string): Element | null => q(document, id);

/** 表现消费腿(头注「表现消费腿」节):当前转移批 → 表现事件 → 真编排器 → 真 sink
 *  → fxStore。命令批已由 dispatchCommand 内 sync 落进快照(events=当前转移批)。 */
async function presentCommandFx(engine: GameEngine): Promise<void> {
  const presentation = extractBatchEvents(engine, useGameStore.getState().snapshot!.events);
  await act(async () => {
    await present(presentation, createEngineSink());
  });
}

beforeAll(async () => {
  ensureHappyDom();
  // 环境缝(matchMedia stub 同族,#1284 配方):happy-dom 无排版引擎,底板 svg
  // clientWidth/Height 恒 0——boardHost 的 commit 拍真值断言(ensureBoardPxPerUnit,
  // 零兜底设计)当场炸;document.fonts.ready 同缺席。给中性真值(844×390 标准档)
  // 让生产代码走通挂载,断言面不碰任何几何(断言宪法)。happy-dom 注册生命周期内
  // 生效,release 后随注册体整体丢弃,零跨文件泄漏(模板同款)。
  Object.defineProperty(SVGSVGElement.prototype, "clientWidth", {
    get: () => 844,
    configurable: true,
  });
  Object.defineProperty(SVGSVGElement.prototype, "clientHeight", {
    get: () => 390,
    configurable: true,
  });
  // 晚绑红线(头注第 0 步):document 在场后再求值 Base UI 消费链、controller 图
  // 与 fx 表现链。
  const screenMod = await import("@app/screens/game/GameScreen");
  const registryMod = await import("@app/controllers/registry");
  const ctrlMod = await import("@app/controllers/controller");
  const extractMod = await import("@app/fx/event-extract");
  const orchMod = await import("@app/fx/orchestrator");
  const sinksMod = await import("@app/fx/sinks");
  GameScreen = screenMod.GameScreen;
  setController = registryMod.setController;
  extractBatchEvents = extractMod.extractBatchEvents;
  present = orchMod.present;
  createEngineSink = sinksMod.createEngineSink;
  // WiringController:生产基类最小子型——单机 hotSeat 参数 + submitCommand 命令腿
  // + 基类 sync 状态桥(模板同款;房间编排/传输/看门狗是层③领域不进来)。
  const Base = ctrlMod.GameController;
  class WiringControllerImpl extends Base {
    constructor(private readonly e: GameEngine) {
      super();
    }
    override get engine(): GameEngine {
      return this.e;
    }
    // 单机热座:视角跟随决策方(LocalController 同口径)。
    override get viewSeat(): number {
      return this.e.decisionOwner;
    }
    protected override get mySeat(): number {
      return 0;
    }
    protected override readonly hotSeat = true;
    override dispatchCommand(cmd: GameCommand): void {
      this.e.submitCommand(cmd); // 引擎统一命令口:校验全在,违例当场抛(零兜底)
      this.sync(); // 基类状态桥:与生产同一出口(snapshot/interactive 同拍刷新)
    }
    // 测试侧重灌口(protected sync 的公开面;直写引擎后调)。
    resync(): void {
      this.sync();
    }
  }
  newWiringController = (e) => new WiringControllerImpl(e);
});

beforeEach(() => {
  useGameStore.getState().reset();
  useNetStore.getState().reset();
  useFxStore.getState().resetFx();
});

afterEach(() => {
  if (root != null) {
    act(() => root!.unmount());
    root = null;
  }
  container = null;
  setController(null); // registry 换局销毁契约:控制器随例释放,不留活口
  useGameStore.getState().reset();
  useNetStore.getState().reset();
  useFxStore.getState().resetFx();
});

afterAll(async () => {
  // 排干 React 调度器余拍(模板同款):release 后再触发会在无 window 环境抛
  // 「window is not defined」——window 还在时让完这一拍再拆 happy-dom。
  await new Promise((r) => setTimeout(r, 0));
  await releaseHappyDom();
});

describe("军情密探即时窥探弹层(自 react-jinnang-peek 迁入,#1315 批T1)", () => {
  // ── ③主路径(react-jinnang-peek 例 1 迁入)──
  // 出牌四击链全真(点牌→「出牌」→点席位→「出」),打出命令走 WiringController 真命
  // 令口;弹层由真 peekApplied 事件批经表现消费腿(头注专节)驱动——关闭走内容区点击
  // (「点击任意处关闭」口径,closePeek 同步清 store,零定时器;遮罩/Esc 路归底件,
  // 退场协议已由模板族他例覆盖)。
  it("主路径:打出→窥探弹层出现→目标牌名可见→关闭后无残留", async () => {
    const { el, engine } = startGame((e) => {
      giveJinnang(e, 0, ["军情密探"]); // 己方窥探牌(种植判词:发指定牌无公共通路)
      giveJinnang(e, 1, ["火烧连营", "求贤令"]); // 被窥者手牌钉两张(弹层内容断言口)
    });
    click(q(el, TESTIDS.jinnangCard("军情密探"))!);
    click(q(document, TESTIDS.actionbarPlay)!);
    expect(q(el, TESTIDS.seatTarget(1))).not.toBeNull(); // 目标段就位(席位点击层)
    click(q(el, TESTIDS.seatTarget(1))!);
    click(q(document, TESTIDS.actionbarTarget)!);
    await presentCommandFx(engine);
    await settle();
    // 弹层出现:目标牌名可见(PileShell 壳 Portal 在 body,竖笺牌面横排)
    const modal = modalQ(TESTIDS.peekModal);
    if (modal == null) throw new Error("接线测试:窥探弹层未挂载(peekApplied 表现链断)");
    expect(q(modal, TESTIDS.peekCard("火烧连营"))).not.toBeNull();
    expect(q(modal, TESTIDS.peekCard("求贤令"))).not.toBeNull();
    // 引擎侧:窥探零账本(持续窗口字段随 #575 删除,快照无此键——负向回归锁,
    // 死代码台账立案面;类型面已无此键,按 Record 探针读)
    const rawSnap = useGameStore.getState().snapshot as unknown as Record<string, unknown>;
    expect(rawSnap.jinnangPeeks).toBeUndefined();
    // 关闭:点击弹层内容区任意处 → closePeek 清 store → 弹层即卸
    click(modal.querySelector(".peek-body")!);
    await settle();
    // 无残留:关闭即清,零复现(窥探无任何客户端状态,引擎零账本)
    expect(modalQ(TESTIDS.peekModal)).toBeNull();
    expect(modalQ(TESTIDS.peekCard("火烧连营"))).toBeNull();
  });
});

describe("锦囊 secrecy 可见性(自 react-jinnang 迁入,#1315 批T1)", () => {
  // ── ⑥secrecy(react-jinnang 例 1 迁入)──
  // 零种植全真:选都链(引擎真实开局流,进程内毫秒级)到发牌呈现——单机快照是 god
  // view(引擎在本机),「他人只见计数」的投影逻辑由 room 层单测 redactSnapshotForSeat
  // 直测;本例断言 UI 面不泄:他人牌面永不出现在 DOM。引擎缝账目断言(牌库/离库)同
  // e2e __dafung 桥语义,直读进程内引擎。
  it("起手各 1 张:架中见自己牌面;牌库余 14;席位卡见计数章", () => {
    const { el, engine, snap } = startGame(() => {
      // 零种植:seed 67 离线核算天然凑齐断言面(头注第 2 步)
    });
    // 引擎缝 fail-fast:发牌没进引擎,后面全是废话(e2e 同款断言,直读引擎)
    expect(engine.jinnangDeck.length).toBe(14); // 18 − 4 起手(#281 牌库 9 种 18 张)
    expect(
      engine.players.reduce((a, p) => a + p.jinnangHand.length, 0) + engine.jinnangDiscard.length,
    ).toBe(4); // 离库 4 张无一消失(用牌只进弃牌堆不回库,牌库数即发牌证据)
    // 己方牌面:手牌行 + 恰好 1 张(testid 带牌名,目录中文 id)
    expect(q(el, TESTIDS.handZone)).not.toBeNull();
    expect(
      el.querySelectorAll(`[data-testid="${TESTIDS.jinnangHand}"] [data-testid^="jinnang-card-"]`),
    ).toHaveLength(1);
    // 他人计数章可见(席位卡手牌徽章 aria 即计数,#253 jinnang-count 随诸侯行退役)
    expect(q(el, TESTIDS.seatAttr(1, "hand"))!.getAttribute("aria-label")).toBe("锦囊手牌 1");
    // 整页不存在第二份锦囊牌面(他人内容不渲染——secrecy 的 UI 面本体)
    expect(el.querySelectorAll("[data-testid^='jinnang-card-']")).toHaveLength(1);
    expect(snap().players[0].jinnangHand).toHaveLength(1);
  });
});
