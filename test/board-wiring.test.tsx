// 接线测试(ADR-0062 层④,#1318 批T4):棋盘等级珠域一例自 e2e 迁入接线层——
// 「城池等级珠:等级=珠数,满级金框加冕,非满级无金框,Lv0 无珠」(react-board,
// 迁尽→整文件删;慢池贵例 52.4s 下放接线层毫秒级)。react-board 存例已清空。
//
// 【判层理由】判据=ADR-0062 迁移判据,判层只看断言面:data-level 属性字面量 +
// .bv-pip 珠数节点计数 + .bv-pips-crown 金框有无 = 渲染树语义(纯状态挂点,宪法
// 明许「节点计数」);零几何零像素零演出泵。珠形视觉(金珠着色/金框描边观感)归
// visual-compare 像素对照,不在此层。e2e 版的 waitFxIdle/freezeClock 配方(#987
// 收幕竞速注、#943 竞速点清偿)随演出泵一并失效:本层无房间无 bot 链,种植后
// 渲染树即终态,零时钟零竞速。
//
// 【种植判词】(种植单源形;各件判词单源 @core/planter 函数头注,本文件不重复)
// 授房产/等级=grantProperty(#1300):满级/半级城引擎到不了——真实升级路径走
// endTurn 会同步放 bot 链(火烧连营可同拍拆城),升级后的活状态断言必竞速(react-solo
// 扩军实录);持有直接入册=断言面需特定等级形态,是确定性到达手段(e2e 判词随迁)。
// 满级/半级取值读目录现值(maxLevel 与 maxLevel-1),不吃地图数值再平衡;第三城保持
// 无主=Lv0 无珠对照组。e2e 版的 armPhase 钉相位随迁省略:本例断言面纯渲染树,
// 无相位依赖,零多余种植。
//
// 【渲染装配配方】(模板 = test/battle-wiring.test.tsx #1317 批T3;模板四步 + 晚绑
// 红线第 0 条 + 注册控制器第 2.5 步 + 环境缝照抄)
//   0.【晚绑红线】凡「typeof document 求值期捕获」的依赖必须晚于 ensureHappyDom
//      求值(Base UI 全族 useIsoLayoutEffect 求值期定型,静态 import 冻结成 noop、
//      弹层空壳零报错)——GameScreen 全图(棋盘 BoardView/Tile 全图)与 controller
//      基类依赖图一律 beforeAll 内 await import 晚绑;@core 纯逻辑(含 planter
//      种植件)与 store/testids(零 DOM 求值期捕获)照旧静态。
//   1. beforeAll ensureHappyDom()(test/happy-dom-register.ts 局部注册/release 还原);
//   2. 真 GameEngine 直构(loadMap(guanzhong.json)+ createDice(seed)),公共命令走完
//      选都链停 Playing——种子 1486=模板既定锚(popup/overview-wiring 同源,非新
//      拍板);零时钟零竞速,种下什么相位就停什么相位。
//   2.5. 注册控制器:WiringController(GameController 生产基类最小子型)同模板,
//      **连地图一起注册**(setController(c, guanzhongData)——BoardView 经 registry
//      静态上下文取 board/catalog,maxLevel 单源目录)。本例零交互命令腿(纯渲染面)。
//   3. 基类 sync 灌真 store,act() 内渲染真 GameScreen(生产装配本体,整屏真挂);
//   4. 断言渲染树:属性字面量与节点计数,零点击零命令。
//
// 【断言宪法】本层禁几何(假 DOM 无排版引擎,getBoundingClientRect 恒 0)、禁像素、
// 禁演出泵与真实时钟;本例断言面 = data-level 属性字面量 + .bv-pip/.bv-pips-crown
// 节点计数 + 挂载有无,纯状态挂点(SVG 节点经 querySelector 取用,不碰 className
// 对象形与几何量)。
//
// 【store 隔离】(模板同款)useGameStore/useNetStore 模块单例跨文件纠缠,本文件
// beforeEach/afterEach 成对调用 reset();fxStore 随 afterEach resetFx 清场(扩军
// 宣告 nonce 族消费源,防邻域事件批残留);registry 控制器随 afterEach
// setController(null) 释放。
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
// bun 测试进程无 Vite define:GameScreen 全图经 SettingsDialog 触达 version.ts,其
// 模块求值读构建期注入的 __APP_VERSION__——按生产同一值源(package.json CalVer)先行
// 注入,晚绑 import 前生效(模板同款,#1297 波评审备案:留置不还原,无害)。
import pkg from "../package.json";
(globalThis as Record<string, unknown>).__APP_VERSION__ = pkg.version;
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import rawGuanzhongData from "../public/maps/guanzhong.json";
import type { MapData } from "@core/board-loader";
import { loadMap } from "@core/board-loader";
import { GameEngine, type GameCommand, type SeatConfig } from "@core/authority";
import { createDice } from "@core/dice";
import { applyPlant, type PlantOp } from "@core/planter";
import { useGameStore } from "@app/store/gameStore";
import { useNetStore } from "@app/store/netStore";
import { useFxStore } from "@app/fx/fxStore";
import { ensureHappyDom, releaseHappyDom } from "./happy-dom-register";

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
const SEED = 1486; // 模板既定锚(落点形态离线核算:Playing 停靠,前三无主城齐备)

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
 *  ops = 初始布场指令(PlantOp 单源逐条落种);plant = 拍间补种+resync 重灌。 */
function startGame(ops: PlantOp[] = []): {
  el: HTMLElement;
  engine: GameEngine;
  plant: (op: PlantOp) => void;
} {
  const e = seedPlayingEngine();
  for (const op of ops) applyPlant(e, op);
  const c = newWiringController(e);
  setController(c, guanzhongData); // 生产同款:连地图一起注册(BoardView 挂载门卫)
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
  };
}

beforeAll(async () => {
  ensureHappyDom();
  // 环境缝(matchMedia stub 同族,#1284 配方):happy-dom 无排版引擎,底板 svg
  // clientWidth/Height 恒 0——boardHost 的 commit 拍真值断言(ensureBoardPxPerUnit,
  // 零兜底设计)当场炸;document.fonts.ready 同缺席。给中性真值(844×390 标准档)
  // 让生产代码走通挂载,断言面不碰任何几何(断言宪法,[data-tile] 内节点计数非
  // 几何)。happy-dom 注册生命周期内生效,release 后随注册体整体丢弃,零跨文件泄漏。
  (document as unknown as { fonts: unknown }).fonts = { ready: Promise.resolve() };
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
  // WiringController:生产基类最小子型(模板同款;本例零命令腿,仅注册+sync 面)。
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
      this.e.submitCommand(cmd);
      this.sync();
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
  // 排干 React 调度器余拍(模板同款)再拆 happy-dom。
  await new Promise((r) => setTimeout(r, 0));
  await releaseHappyDom();
});

describe("城池等级珠接线(自 react-board 迁入,#1318 批T4)", () => {
  // 断言面(e2e 判词随迁):满级城=data-level=满级 + 珠数=等级 + 满贯金框加冕;
  // 非满级城=珠数齐、金框缺席(满级判据 level>=maxLevel 的反面,防金框误常亮);
  // 无主城=Lv0 珠组不挂载(有珠才看,升级过的城天然突出)。三城形态全由
  // grantProperty 种植(判词见头注),种植后渲染树即终态。
  it("等级珠:等级=珠数,满级金框加冕,非满级无金框,Lv0 无珠", () => {
    const { el, engine, plant } = startGame();
    // 选址=测试侧读现值(无主城前三格:头两格授满级/半级,第三格保持无主=对照组;
    // 满级/半级取值读目录 maxLevel 现值,不吃地图数值再平衡)
    const unowned = engine.board.tiles
      .filter((t) => t.propertyId != null && engine.findOwner(t.propertyId!) == null)
      .slice(0, 3);
    if (unowned.length < 3) throw new Error("接线测试:无主城不足三座(等级珠布场断)");
    const maxLevel = engine.catalog.get(unowned[0]!.propertyId!)!.maxLevel;
    if (maxLevel < 2) throw new Error("接线测试:满级档 <2,半级对照组不成立(目录数据断)");
    plant({ kind: "grantProperty", seat: 0, propertyId: unowned[0]!.propertyId!, level: maxLevel });
    plant({
      kind: "grantProperty",
      seat: 1,
      propertyId: unowned[1]!.propertyId!,
      level: maxLevel - 1,
    });
    const pipsOf = (tileIndex: number): Element | null =>
      el.querySelector(`[data-tile="${tileIndex}"] .bv-level-pips`);
    // 满级城:data-level=满级档 + 珠数=等级 + 满贯金框在场
    const full = pipsOf(unowned[0]!.index);
    if (full == null) throw new Error("接线测试:满级城珠组未挂载(等级珠渲染链断)");
    expect(full.getAttribute("data-level")).toBe(String(maxLevel));
    expect(full.querySelectorAll(".bv-pip")).toHaveLength(maxLevel);
    expect(full.querySelectorAll(".bv-pips-crown")).toHaveLength(1);
    // 非满级城:data-level=半级档 + 珠数=等级 + 金框缺席(反面锁,防金框误常亮)
    const mid = pipsOf(unowned[1]!.index);
    if (mid == null) throw new Error("接线测试:半级城珠组未挂载(等级珠渲染链断)");
    expect(mid.getAttribute("data-level")).toBe(String(maxLevel - 1));
    expect(mid.querySelectorAll(".bv-pip")).toHaveLength(maxLevel - 1);
    expect(mid.querySelectorAll(".bv-pips-crown")).toHaveLength(0);
    // 无主城=Lv0:珠组不挂载(有珠才看)
    expect(pipsOf(unowned[2]!.index)).toBeNull();
  });
});
