// 关键接线:真实组件与控制器验证命令/状态或私密信息通路,不验证几何和演出。
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
// bun 测试进程无 Vite define:GameScreen 全图经 SettingsDialog 触达 version.ts(模板
// 同款,先行注入,晚绑 import 前生效)。
import { useFxStore } from "@app/fx/fxStore";
import { TESTIDS } from "@app/screens/game/testids";
import { useGameStore } from "@app/store/gameStore";
import { useNetStore } from "@app/store/netStore";
import { GameEngine, type GameCommand, type SeatConfig } from "@dafung/core/engine/authority";
import type { MapData } from "@dafung/core/engine/board-loader";
import { loadMap } from "@dafung/core/engine/board-loader";
import { createDice } from "@dafung/core/engine/dice";
import { applyPlant, type PlantOp } from "@dafung/core/engine/planter";
import { heroSlotOf, skillMarksOf } from "@dafung/core/engine/roster";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import pkg from "../../package.json";
import rawGuanzhongData from "../../packages/core/maps/guanzhong.json";
import { ensureHappyDom, releaseHappyDom } from "./happy-dom-register";
(globalThis as Record<string, unknown>).__APP_VERSION__ = pkg.version;

/** 晚绑模块型(红线见模板头注第 0 步)。 */
type GameScreenModule = typeof import("@app/screens/game/GameScreen");
type RegistryModule = typeof import("@app/controllers/registry");
type GameControllerClass = import("@app/controllers/controller").GameController;
let GameScreen: GameScreenModule["GameScreen"];
let setController: RegistryModule["setController"];

/** 接线控制器面(GameController 生产基类最小子型 + resync 测试口;构造见 beforeAll)。 */
type WiringController = GameControllerClass & { resync(): void };
let newWiringController: (e: GameEngine) => WiringController;

const guanzhongData = rawGuanzhongData as MapData;
const MAP = loadMap(guanzhongData);
const SEED = 67; // 出牌阶段停靠锚(react-jinnang-use/battle-wiring 同源离线核算)

/** 座位表:与模板同(solo 口径 seat 0 = 自机)。 */
const SEATS: SeatConfig[] = [
  { name: "座 1", isBot: false, guohao: "魏" },
  { name: "座 2", isBot: true },
  { name: "座 3", isBot: true },
  { name: "座 4", isBot: true },
];

/** 种引擎到 Playing 停靠(模板 seedPlayingEngine 同款;seed 67 落点=开局出牌阶段)。 */
function seedPlayingEngine(): GameEngine {
  const e = new GameEngine(MAP.board, MAP.catalog, createDice(SEED), {
    seats: SEATS,
    targetNetWorth: MAP.targetNetWorth,
    startingCash: MAP.startingCash,
    startingTreasures: MAP.startingTreasures,
    seed: SEED,
    mapId: "guanzhong",
  });
  e.beginCapitalSelection();
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

/** 种局→种植→注册控制器→基类 sync 灌 store→挂屏(模板 startGame 一条龙)。
 *  出牌阶段停靠(seed 67)先「今不用」收卷:布景相位纯净,窗由测试显式开。 */
function startGame(ops: PlantOp[] = []): {
  el: HTMLElement;
  engine: GameEngine;
  resync: () => void;
} {
  const e = seedPlayingEngine();
  for (const op of ops) applyPlant(e, op);
  if (e.turnPhase === "AwaitingJinnang") e.resolveJinnang(null); // 今不用:收出牌窗
  const c = newWiringController(e);
  setController(c, guanzhongData);
  act(() => {
    c.resync();
  });
  const el = mount();
  return { el, engine: e, resync: () => act(() => c.resync()) };
}

function q(scope: ParentNode, id: string): Element | null {
  return scope.querySelector(`[data-testid="${id}"]`);
}

/** 类名挂点整词判定(模板同款:className 空白分词恒等比较)。 */
function hasClass(el: Element, cls: string): boolean {
  return el.className.split(/\s+/).includes(cls);
}

/** 真点击(React 合成事件走冒泡;act 内派发,模板同款)。 */
function click(el: Element): void {
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

/** 放逐在体力损耗时打开选择窗。 */
function openSkillWindow(scene: ReturnType<typeof startGame>): ReturnType<typeof startGame> {
  scene.engine.damageStamina(0, 70, 1);
  scene.resync();
  expect(scene.engine.turnPhase).toBe("AwaitingSkillChoice");
  return scene;
}

beforeAll(async () => {
  ensureHappyDom();
  // 环境缝(matchMedia stub 同族,模板同款):SVG clientWidth/Height 中性真值让
  // 生产挂载走通;断言面零几何。
  Object.defineProperty(SVGSVGElement.prototype, "clientWidth", {
    get: () => 844,
    configurable: true,
  });
  Object.defineProperty(SVGSVGElement.prototype, "clientHeight", {
    get: () => 390,
    configurable: true,
  });
  // 晚绑红线(模板头注第 0 步):document 在场后再求值 Base UI 消费链与 controller 图。
  const screenMod = await import("@app/screens/game/GameScreen");
  const registryMod = await import("@app/controllers/registry");
  const ctrlMod = await import("@app/controllers/controller");
  GameScreen = screenMod.GameScreen;
  setController = registryMod.setController;
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
  // 排干 React 调度器余拍(模板同款),再拆 happy-dom。
  await new Promise((r) => setTimeout(r, 0));
  await releaseHappyDom();
});

describe("放逐标记进度上屏(#1378 AC3,层④)", () => {
  it("暂不发:窗收标记保留(轨随保留的标记在场);发动归零:轨随 marks 清空卸下", () => {
    const { el, engine, resync } = openSkillWindow(
      startGame([{ kind: "armHero", seat: 0, heroId: "caopi", skillIds: ["fangzhu"] }]),
    );
    const mark = () => q(el, TESTIDS.seatSkillMark(0));
    expect(hasClass(mark()!, "ready")).toBe(true); // 挂问拍:满档呼吸档
    click(q(document, TESTIDS.skillChoiceDecline)!); // 暂不发(放弃=标记保留)
    expect(q(document, TESTIDS.skillChoiceBanner)).toBeNull(); // 窗收
    expect(skillMarksOf(heroSlotOf(engine.players[0], "caopi"), "fangzhu")).toBe(70);
    expect(mark()).not.toBeNull(); // 轨随保留的标记在场
    expect(engine.log.some((l) => l.detail.includes("skillChoiceDecline"))).toBe(true);
    // 归零一击再次触发放逐。选座位 3，使罚跳留到之后的回合，便于观察。
    engine.damageStamina(0, 30, 1);
    engine.respondSkillChoice(0, true, 3);
    resync();
    expect(skillMarksOf(heroSlotOf(engine.players[0], "caopi"), "fangzhu")).toBe(0);
    expect(mark()).toBeNull(); // 归零后轨卸下
    expect(engine.players[3].skipTurns).toBe(1);
  });
});

describe("触发卡交互链(#1378 AC1 呈现段,层④)", () => {
  it("挂问升起→候选笺点选(选中可逆)→发动→窗收+目标被跳+标记归零+留痕", () => {
    const { el, engine } = openSkillWindow(
      startGame([{ kind: "armHero", seat: 0, heroId: "caopi", skillIds: ["fangzhu"] }]),
    );
    const banner = () => q(document, TESTIDS.skillChoiceBanner);
    expect(banner()).not.toBeNull(); // 触发卡升起(自机=决策属主,interactive 门)
    expect(banner()!.textContent).toContain("「放逐」可达发动条件");
    // 候选笺=存活他人三席(choices 唯一可用性口径;自己席零笺)
    const chip = (seat: number) => q(document, TESTIDS.skillChoiceSeat(seat))!;
    expect(chip(1)).toBeTruthy();
    expect(chip(2)).toBeTruthy();
    expect(chip(3)).toBeTruthy();
    expect(q(document, TESTIDS.skillChoiceSeat(0))).toBeNull();
    // 未选目标发动禁用;点笺选中(实金 .picked)点亮;再点同笺取消回禁用(#417 口径)
    const confirm = () => q(document, TESTIDS.skillChoiceConfirm)!;
    expect(confirm().hasAttribute("disabled")).toBe(true);
    click(chip(2));
    expect(hasClass(chip(2), "picked")).toBe(true);
    expect(confirm().hasAttribute("disabled")).toBe(false);
    click(chip(2));
    expect(hasClass(chip(2), "picked")).toBe(false);
    expect(confirm().hasAttribute("disabled")).toBe(true);
    // 选定发动后，选择窗收起，目标增加一次罚跳，标记归零。
    click(chip(2));
    click(confirm());
    expect(banner()).toBeNull();
    expect(engine.players[2].skipTurns).toBe(1);
    expect(skillMarksOf(heroSlotOf(engine.players[0], "caopi"), "fangzhu")).toBe(0);
    expect(q(el, TESTIDS.seatSkillMark(0))).toBeNull(); // 归零=规范缺省,轨卸下
    expect(engine.log.some((l) => l.detail.includes("skillChoiceFire"))).toBe(true);
    expect(engine.turnPhase).toBe("Roll"); // 应答后续回原行动
  });
});
