// 关键接线:真实组件与控制器验证命令/状态或私密信息通路,不验证几何和演出。
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
// bun 测试进程无 Vite define:GameScreen 全图经 SettingsDialog 触达 version.ts,其
// 模块求值读构建期注入的 __APP_VERSION__——按生产同一值源(package.json CalVer)先行
// 注入,晚绑 import 前生效(模板同款,#1297 波评审备案:留置不还原,无害)。
import { useFxStore } from "@app/fx/fxStore";
import { GHOST } from "@app/fx/timings";
import { SCROLL_TESTIDS } from "@app/screens/game/scroll/testids";
import { TESTIDS } from "@app/screens/game/testids";
import { useGameStore, type GameSnapshot } from "@app/store/gameStore";
import { useNetStore } from "@app/store/netStore";
import { GameEngine, type GameCommand, type SeatConfig } from "@core/authority";
import type { MapData } from "@core/board-loader";
import { loadMap } from "@core/board-loader";
import { createDice } from "@core/dice";
import { applyPlant, type PlantOp } from "@core/planter";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import pkg from "../../package.json";
import rawGuanzhongData from "../../public/maps/guanzhong.json";
import { installControlledClock } from "./controlled-clock";
import { ensureHappyDom, releaseHappyDom } from "./happy-dom-register";
(globalThis as Record<string, unknown>).__APP_VERSION__ = pkg.version;

/** 晚绑模块型(late binding,红线见头注第 0 步;type-of-import 类型面静态引用,
 *  求值面零触碰,不破晚绑)。 */
type GameScreenModule = typeof import("@app/screens/game/GameScreen");
type RegistryModule = typeof import("@app/controllers/registry");
type GameControllerClass = import("@app/controllers/controller").GameController;
let GameScreen: GameScreenModule["GameScreen"];
let setController: RegistryModule["setController"];

/** 接线控制器面(GameController 生产基类的最小子型 + resync 测试口;构造见 beforeAll)。 */
type WiringController = GameControllerClass & { resync(): void };
let newWiringController: (e: GameEngine) => WiringController;

const guanzhongData = rawGuanzhongData as MapData; // JSON 导入 tier 丢字面量,cast 同 battle-wiring #1317 形
const MAP = loadMap(guanzhongData);
const SEED = 1486; // 模板既定锚(popup/overview-wiring 同源;落点形态离线核算:Playing 停靠)

/** 座位表:与模板同(solo 口径 seat 0 = 自机)。 */
const SEATS: SeatConfig[] = [
  { name: "座 1", isBot: false, guohao: "魏" },
  { name: "座 2", isBot: true },
  { name: "座 3", isBot: true },
  { name: "座 4", isBot: true },
];

/** 种引擎到 Playing 停靠(公共命令链,模板 seedPlayingEngine 同款;非法态当场
 *  抛错不静默)。 */
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
let clock: ReturnType<typeof installControlledClock>;

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

/** 种局→种植→注册控制器(连地图)→基类 sync 灌 store→挂屏(每例开头同款一条龙)。
 *  ops = 初始布场指令(PlantOp 单源逐条落种,判词见头注「种植判词」)。 */
function startGame(ops: PlantOp[] = []): {
  el: HTMLElement;
  engine: GameEngine;
  plant: (op: PlantOp) => void;
  snap: () => GameSnapshot;
} {
  const e = seedPlayingEngine();
  for (const op of ops) applyPlant(e, op);
  const c = newWiringController(e);
  setController(c, guanzhongData); // 生产同款:连地图一起注册(卷轴层/棋盘挂载门卫)
  act(() => {
    c.resync();
  });
  const el = mount();
  return {
    el,
    engine: e,
    plant: (op) => {
      applyPlant(e, op);
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

/** 推进退场出口后断卸载;布尔断言避免失败时序列化 happy-dom 循环节点。 */
async function finishExit(query: () => Element | null, label: string): Promise<void> {
  await clock.advance(GHOST.frameMs);
  expect(query() == null, label).toBe(true);
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
  // 晚绑红线(头注第 0 步):document 在场后再求值 Base UI 消费链与 controller 图。
  const screenMod = await import("@app/screens/game/GameScreen");
  const registryMod = await import("@app/controllers/registry");
  const ctrlMod = await import("@app/controllers/controller");
  GameScreen = screenMod.GameScreen;
  setController = registryMod.setController;
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
    // 测试侧重灌口(protected sync 的公开面;种植后调)。
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
  clock = installControlledClock();
});

afterEach(async () => {
  await clock.settle();
  if (root != null) {
    act(() => root!.unmount());
    root = null;
  }
  if (container != null) container.remove();
  container = null;
  setController(null); // registry 换局销毁契约:控制器随例释放,不留活口
  useGameStore.getState().reset();
  useNetStore.getState().reset();
  useFxStore.getState().resetFx();
  clock.restore();
});

afterAll(async () => {
  // 排干 React 调度器余拍(模板同款):release 后再触发会在无 window 环境抛
  // 「window is not defined」——window 还在时让完这一拍再拆 happy-dom。
  await Bun.sleep(0);
  await releaseHappyDom();
});

describe("单机决策接线(自 react-solo 迁入,#1318 批T4)", () => {
  // ── ①购地决策(react-solo 例 2 迁入)──
  // 断言面:卷轴自动弹(scroll-buy)→买钮可用→真命令 buyProperty→快照真值
  // (扣价入册)+buy 留痕+卷轴收+相位被真命令推进。结算算术归 test/economy.test.ts
  // (单测已钉,非本层)。种植:setCash+armPhase+armLanding(判词见头注;现金注资
  // 「购价+1000」=测机制不测门槛,e2e 同判词随迁)。
  it("购地决策:卷轴购地扣银两 + 获得地产", async () => {
    const { el, engine, plant, snap } = startGame();
    // 无主城选址读现值(购价随地图再平衡,断言面不吃数值漂移,e2e 同判词随迁)
    const tile = engine.board.tiles.find(
      (t) => t.propertyId != null && engine.findOwner(t.propertyId) == null,
    );
    if (tile?.propertyId == null) throw new Error("接线测试:无主城缺席(购地布场断)");
    const pid = tile.propertyId;
    const price = engine.catalog.get(pid)!.purchasePrice;
    plant({ kind: "setCash", seat: 0, cash: price + 1000 });
    // 钉相位+行动方到人类(armPhase #1301)+ 落格询问载荷(armLanding #1303,
    // 决策上下文与表现投影一体置值)
    plant({ kind: "armPhase", turnPhase: "AwaitingDecision", activeIndex: 0 });
    plant({ kind: "armLanding", landing: { kind: "PropertyAvailable", propertyId: pid } });
    // 轮到即自动弹(交互重构:决策一律走卷轴)
    const scroll = q(el, SCROLL_TESTIDS.buyScroll);
    if (scroll == null) throw new Error("接线测试:购地卷轴未挂载(AwaitingDecision 接线断)");
    const buy = q(el, TESTIDS.actionButton("buy"));
    if (buy == null) throw new Error("接线测试:买钮缺席(卷轴装配断)");
    expect(buy.hasAttribute("disabled")).toBe(false);
    const before = snap().players[0]!.cash;
    click(buy);
    // 快照真值(结算同步收口,零竞速——无房间无看门狗,模板判词):扣价 + 入册
    const s = snap();
    expect(s.players[0]!.cash).toBe(before - price);
    expect(s.players[0]!.properties.some((h) => h.propertyId === pid)).toBe(true);
    const line = s.log.find((l) => l.category === "buy" && l.detail.startsWith("buy player=p0 "));
    if (line == null) throw new Error("接线测试:buy 留痕缺席(购地命令通路断)");
    expect(line.detail).toContain(`prop=${pid}`);
    expect(line.detail).toContain(`cash=${before - price}`); // 留痕现金=结算瞬间值
    expect(s.turnPhase).not.toBe("AwaitingDecision"); // 相位已被真命令推进(收尾交棒)
    // 卷轴收:控时推进幽灵帧退场出口后断卸载,布尔断言避免序列化在途节点。
    await finishExit(() => q(el, SCROLL_TESTIDS.buyScroll), "购地卷轴应随决策清退场");
  });
});
