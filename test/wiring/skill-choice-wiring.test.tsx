// 接线测试(ADR-0062 层④,#1378):「你可」选择闸(#1377 引擎面,本票交付面)两域——
// ①放逐标记进度上屏(AC3):席位格底缘金色进度轨(.skmark)随槽位 marks 在场/满档
//   ready 档/发动归零后卸下,他人席零挂点;
// ②触发卡交互链:挂问(AwaitingSkillChoice)→ 触发卡升起(文案=引擎挂问战报同款)
//   → 候选笺点选(选中实金 .picked,再点取消)→「发动」→ 窗收 + 目标被跳落账 +
//   标记归零(轨卸下)+ 战报留痕(skillChoiceFire);「暂不发」→ 窗收 + 标记保留;
// ③行殇窗:目标既定免选(候选笺零挂点、发动恒可),发动=既定目标 +1 跳回合落账。
//
// 【判层理由】判据=ADR-0062 迁移判据,判层只看断言面:①=挂点有无(.skmark/.ready)+
// aria 属性(数值/名词)+ 内联宽度派生自快照 marks(store→DOM 直读);②③=点击→真命令
// (respondSkillChoice)→ 相位推进 → 渲染树挂载有无(触发卡/候选笺/进度轨)+ 引擎
// 落账(skipTurns/marks/日志行)。全部「操作过后 store/渲染树里的语义」,零几何零像素
// 零演出泵(内联 width % 是状态投影非排版断言,happy-dom 下 getBoundingClientRect
// 恒 0 故不碰)。引擎结算语义(发动/放弃/阈值/叠加/耗竭过滤/快照往返)已由
// fangzhu-xingshang.test.ts 层①守住,本文件只接「store→DOM 的一公里」。
//
// 【渲染装配配方】模板 = test/wiring/battle-wiring.test.tsx(#1317 批T3;模板四步 +
// 晚绑红线第 0 条 + 注册控制器第 2.5 步 + 环境缝照抄):happy-dom 局部注册、真
// GameEngine(seed 67 出牌阶段停靠,同源离线核算)、WiringController 最小子型、基类
// sync 灌真 store、act() 内挂真 GameScreen。种植单源形:初始布场走 PlantOp 指令
// (applyPlant 单源;armHero=名将直授、setStamina=体力终态经公共口 StaminaLoss——
// 放逐攒怒正是本例被测环的输入沿,非被测环本身);拍间布景走引擎公共口
// (endTurn/dispatchMoment,同 T1 层①先例)。
// 【断言宪法】本层禁几何禁像素禁演出泵:断言面 = testid 有无 / 类名挂点(.picked/
// .ready)/ aria 属性 / DOM 文本 / store 快照与引擎日志行,纯状态挂点。
// 【store 隔离】(模板同款)beforeEach/afterEach 成对 reset 三 store;registry 随
// afterEach setController(null) 释放。
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
// bun 测试进程无 Vite define:GameScreen 全图经 SettingsDialog 触达 version.ts(模板
// 同款,先行注入,晚绑 import 前生效)。
import pkg from "../../package.json";
(globalThis as Record<string, unknown>).__APP_VERSION__ = pkg.version;
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import rawGuanzhongData from "../../public/maps/guanzhong.json";
import type { MapData } from "@core/board-loader";
import { loadMap } from "@core/board-loader";
import { GameEngine, type GameCommand, type SeatConfig } from "@core/authority";
import { createDice } from "@core/dice";
import { applyPlant, type PlantOp } from "@core/planter";
import { heroSlotOf, skillMarksOf } from "@core/roster";
import { TESTIDS } from "@app/screens/game/testids";
import { useGameStore } from "@app/store/gameStore";
import { useNetStore } from "@app/store/netStore";
import { useFxStore } from "@app/fx/fxStore";
import { ensureHappyDom, releaseHappyDom } from "./happy-dom-register";

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
    encounter: { enabled: false }, // 机遇硬关:测试隔离既有口径
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

/** 挂窗一条龙(放逐例共用):布景后 engine.endTurn 开窗 + resync 灌屏。 */
function openSkillWindow(scene: ReturnType<typeof startGame>): ReturnType<typeof startGame> {
  scene.engine.endTurn(); // 回合收口:先挂问再收口(AwaitingSkillChoice)
  scene.resync();
  expect(scene.engine.turnPhase).toBe("AwaitingSkillChoice");
  return scene;
}

beforeAll(async () => {
  ensureHappyDom();
  // 环境缝(matchMedia stub 同族,模板同款):SVG clientWidth/Height 中性真值让
  // 生产挂载走通;断言面零几何。
  (document as unknown as { fonts: unknown }).fonts = { ready: Promise.resolve() };
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
  it("攒怒中:自机格进度轨在场(aria 数值=快照 marks),他人席零挂点;未满档无 ready", () => {
    const { el, engine, resync } = startGame([
      { kind: "armHero", seat: 0, heroId: "caopi", skillIds: ["fangzhu"] },
      { kind: "setStamina", seat: 0, stamina: 70 }, // 损失 30 < 60:攒怒中,无待决
    ]);
    const mark = () => q(el, TESTIDS.seatSkillMark(0));
    expect(mark()).not.toBeNull(); // 攒怒中即在场(状态表达 §4.6:进度即状态)
    expect(mark()!.getAttribute("aria-label")).toBe("放逐 30/60");
    expect(hasClass(mark()!, "ready")).toBe(false);
    expect(q(el, TESTIDS.seatSkillMark(1))).toBeNull(); // 他人席(无标记)零挂点
    // 补损失过阈:ready 档 + 待决入队(引擎真值同步换轨)
    applyPlant(engine, { kind: "setStamina", seat: 0, stamina: 30 }); // 再损 40 → 70
    resync();
    expect(skillMarksOf(heroSlotOf(engine.players[0], "caopi"), "fangzhu")).toBe(70);
    expect(mark()!.getAttribute("aria-label")).toBe("放逐 70/60");
    expect(hasClass(mark()!, "ready")).toBe(true);
    expect(engine.pendingSkillChoices).toHaveLength(1);
  });

  it("暂不发:窗收标记保留(轨随保留的标记在场);发动归零:轨随 marks 清空卸下", () => {
    const { el, engine, resync } = openSkillWindow(
      startGame([
        { kind: "armHero", seat: 0, heroId: "caopi", skillIds: ["fangzhu"] },
        { kind: "setStamina", seat: 0, stamina: 30 }, // 损失 70 过阈
      ]),
    );
    const mark = () => q(el, TESTIDS.seatSkillMark(0));
    expect(hasClass(mark()!, "ready")).toBe(true); // 挂问拍:满档呼吸档
    click(q(document, TESTIDS.skillChoiceDecline)!); // 暂不发(放弃=标记保留)
    expect(q(document, TESTIDS.skillChoiceBanner)).toBeNull(); // 窗收
    expect(skillMarksOf(heroSlotOf(engine.players[0], "caopi"), "fangzhu")).toBe(70);
    expect(mark()).not.toBeNull(); // 轨随保留的标记在场
    expect(engine.log.some((l) => l.detail.includes("skillChoiceDecline"))).toBe(true);
    // 再攒再问→发动:归零=规范缺省,轨卸下(超出部分舍弃语义的呈现面)。
    // 目标取座位 3(非本环推进的下家):+1 落账不被收口跳回合环即时消费,可观察。
    // 引擎直呼段(次级腿,命令面交互链已由上例覆盖)后必 resync:store 不同步则
    // 断言吃到挂着的旧轨节点(expect(node).toBeNull() 的 happy-dom 序列化爆炸,
    // wire3 实锤口径——red 前先保证断言面干净)。
    applyPlant(engine, { kind: "setStamina", seat: 0, stamina: 0 }); // 再损 30 → 100:新问
    engine.endTurn();
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
      startGame([
        { kind: "armHero", seat: 0, heroId: "caopi", skillIds: ["fangzhu"] },
        { kind: "setStamina", seat: 0, stamina: 30 }, // 损失 70 过阈
      ]),
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
    // 选定发动:窗收 + 目标(座位 2,bot 非下家,+1 落账不被即时消费)+ 标记归零
    click(chip(2));
    click(confirm());
    expect(banner()).toBeNull();
    expect(engine.players[2].skipTurns).toBe(1);
    expect(skillMarksOf(heroSlotOf(engine.players[0], "caopi"), "fangzhu")).toBe(0);
    expect(q(el, TESTIDS.seatSkillMark(0))).toBeNull(); // 归零=规范缺省,轨卸下
    expect(engine.log.some((l) => l.detail.includes("skillChoiceFire"))).toBe(true);
    expect(engine.turnPhase).not.toBe("AwaitingSkillChoice"); // 应答后重入收口
  });

  it("非属主座位零渲染(他人待决不弹卡,公开信息=战报行)", () => {
    const { el, engine, resync } = startGame([
      { kind: "armHero", seat: 1, heroId: "caopi", skillIds: ["fangzhu"] },
    ]);
    // 布景:座位 1(他人)损失过阈挂问,本端(座位 0)视角零卡
    applyPlant(engine, { kind: "setStamina", seat: 1, stamina: 30 });
    engine.endTurn(); // 座位 0 收口:队列首问属主=座位 1,窗挂起
    resync();
    expect(engine.turnPhase).toBe("AwaitingSkillChoice");
    expect(engine.decisionOwner).toBe(1);
    expect(q(document, TESTIDS.skillChoiceBanner)).toBeNull(); // 非属主:零渲染
    expect(el).toBeTruthy();
  });

  it("行殇窗:目标既定免选(候选笺零挂点、发动恒可),发动=既定目标 +1 跳回合落账", () => {
    const { el, engine, resync } = startGame([
      { kind: "armHero", seat: 0, heroId: "caopi", skillIds: ["xingshang"] },
    ]);
    // 布景:座位 2(非下家)被强加跳回合(原因=耗竭)→ 行殇待决入队(目标既定=座位 2)
    engine.players[2].skipTurns = 1;
    engine.dispatchMoment("TurnSkipImposed", { subject: 2, reason: "exhaustion" });
    expect(engine.pendingSkillChoices).toHaveLength(1);
    engine.endTurn(); // 回合收口挂问
    resync();
    expect(engine.turnPhase).toBe("AwaitingSkillChoice");
    const banner = () => q(document, TESTIDS.skillChoiceBanner);
    expect(banner()).not.toBeNull();
    expect(banner()!.textContent).toContain("「行殇」可达发动条件");
    expect(banner()!.textContent).toContain("目标"); // 目标括注在文案(既定,免选)
    expect(q(document, TESTIDS.skillChoiceSeat(2))).toBeNull(); // 免选:零候选笺
    const confirm = () => q(document, TESTIDS.skillChoiceConfirm)!;
    expect(confirm().hasAttribute("disabled")).toBe(false); // 目标既定:恒可
    click(confirm());
    expect(banner()).toBeNull();
    expect(engine.players[2].skipTurns).toBe(2); // 既定目标 +1(座位 2 未轮到,不被消费)
    expect(engine.log.some((l) => l.detail.includes("skillChoiceFire skill=xingshang"))).toBe(true);
    expect(el).toBeTruthy();
  });
});
