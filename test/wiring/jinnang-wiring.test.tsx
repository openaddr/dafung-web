// 关键接线:真实组件与控制器验证命令/状态或私密信息通路,不验证几何和演出。
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, spyOn } from "bun:test";
import * as tauriApp from "@tauri-apps/api/app";
import * as tauriCore from "@tauri-apps/api/core";
// bun 测试进程无 Vite define:GameScreen 全图经 SettingsDialog 触达 version.ts,其
// 模块求值读构建期注入的 __APP_VERSION__——按生产同一值源(package.json CalVer)先行
// 注入,晚绑 import 前生效(模板同款,#1297 波评审备案:留置不还原,无害)。
import { useFxStore } from "@app/fx/fxStore";
import { TESTIDS } from "@app/screens/game/testids";
import { useGameStore, type GameSnapshot } from "@app/store/gameStore";
import { useNetStore } from "@app/store/netStore";
import { GameEngine, type GameCommand, type SeatConfig } from "@dafung/core/engine/authority";
import { tileIndexOfProperty } from "@dafung/core/engine/board";
import { loadMap } from "@dafung/core/engine/board-loader";
import { createDice } from "@dafung/core/engine/dice";
import { JINNANG_DECK_LIST, jinnangCardOf } from "@dafung/core/engine/jinnang";
import {
  armBankrupt,
  armHero,
  armPhase,
  giveJinnang,
  giveTreasure,
  grantProperty,
  pinDice,
  placePlayer,
  setCash,
} from "@dafung/core/engine/planter";
import { skillOptionId } from "@dafung/core/engine/choices";
import { makeSkillBook } from "@dafung/core/engine/treasures";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import pkg from "../../package.json";
import guanzhongData from "../../packages/core/maps/guanzhong.json";
import { ensureHappyDom, releaseHappyDom } from "./happy-dom-register";
import { installControlledClock } from "./controlled-clock";
(globalThis as Record<string, unknown>).__APP_VERSION__ = pkg.version;

/** 晚绑模块型(late binding,红线见头注第 0 步;type-of-import 类型面静态引用,
 *  求值面零触碰,不破晚绑)。 */
type GameScreenModule = typeof import("@app/screens/game/GameScreen");
type TipModule = typeof import("@app/screens/game/Tip");
type RegistryModule = typeof import("@app/controllers/registry");
type GameControllerClass = import("@app/controllers/controller").GameController;
type ExtractModule = typeof import("@app/fx/event-extract");
type OrchestratorModule = typeof import("@app/fx/orchestrator");
type SinksModule = typeof import("@app/fx/sinks");
let GameScreen: GameScreenModule["GameScreen"];
let Tip: TipModule["Tip"];
let setController: RegistryModule["setController"];
let extractBatchEvents: ExtractModule["extractBatchEvents"];
let present: OrchestratorModule["present"];
let createEngineSink: SinksModule["createEngineSink"];

/** 接线控制器面(GameController 生产基类的最小子型 + resync 测试口;构造见 beforeAll)。 */
type WiringController = GameControllerClass & { resync(): void; completeCommand(): void };
let newWiringController: (e: GameEngine, deferCommands: boolean) => WiringController;

const MAP = loadMap(guanzhongData);
const SEED = 67;

/** 座位表:与模板同(solo 口径 seat 0 = 自机)。 */
const SEATS: SeatConfig[] = [
  { name: "座 1", isBot: false, guohao: "魏" },
  { name: "座 2", isBot: true },
  { name: "座 3", isBot: true },
  { name: "座 4", isBot: true },
];

/** 通过公共命令开局。各用例自行种植所需手牌与相位。 */
function seedPlayingEngine(): GameEngine {
  const e = new GameEngine(MAP.board, MAP.catalog, createDice(SEED), {
    seats: SEATS,
    targetNetWorth: MAP.targetNetWorth,
    startingCash: MAP.startingCash,
    startingTreasures: MAP.startingTreasures,
    seed: SEED,
    mapId: "guanzhong",
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
let clock: ReturnType<typeof installControlledClock> | null = null;

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
function startGame(
  plant: (e: GameEngine) => void,
  deferCommands = false,
): {
  el: HTMLElement;
  engine: GameEngine;
  writeEngine: (write: (e: GameEngine) => void) => void;
  snap: () => GameSnapshot;
  completeCommand: () => void;
} {
  const e = seedPlayingEngine();
  plant(e);
  const c = newWiringController(e, deferCommands);
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
    completeCommand: () => act(() => c.completeCommand()),
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

it("锦囊详情显示功能标签和牌面效果，不提示已取消的出牌限制", async () => {
  const { el } = startGame((engine) => {
    giveJinnang(engine, 0, ["缓兵之计"]);
    armPhase(engine, { activeIndex: 0, turnPhase: "Roll" });
  });
  click(q(el, TESTIDS.jinnangCard("缓兵之计"))!);
  await settle();
  const detail = modalQ(TESTIDS.jinnangDetail);
  if (detail == null) throw new Error("手牌未打开锦囊详情");
  expect(detail.textContent).toContain(jinnangCardOf("缓兵之计").text);
  expect(detail.textContent).toContain("谋攻");
  expect(detail.textContent).not.toContain("每回合每类限用一张");
});

it("选中锦囊直接显示全文，换选更新正文，进入目标段收起正文", () => {
  const { el, snap } = startGame((e) => {
    giveJinnang(e, 0, ["火烧连营", "军情密探"]);
    armPhase(e, { activeIndex: 0, turnPhase: "AwaitingJinnang" });
  });
  const text = () => q(el, TESTIDS.selectedJinnangText);
  click(q(el, TESTIDS.jinnangCard("火烧连营"))!);
  expect(text()?.textContent).toContain(jinnangCardOf("火烧连营").text);
  click(q(el, TESTIDS.jinnangCard("军情密探"))!);
  expect(text()?.textContent).toContain(jinnangCardOf("军情密探").text);
  expect(snap().players[0].jinnangHand).toEqual(["火烧连营", "军情密探"]);
  click(q(el, TESTIDS.actionbarPlay)!);
  expect(text()).toBeNull();
});

it("任一席位打开全员详情，查档关闭回到全员，选目标时席位仍只接选择", async () => {
  clock = installControlledClock();
  const { el, snap } = startGame((e) => {
    giveJinnang(e, 0, ["军情密探"]);
    armPhase(e, { activeIndex: 0, turnPhase: "AwaitingJinnang" });
  });
  const overview = () => q(document, TESTIDS.warlordsOverview);
  click(q(el, TESTIDS.seatOverview(2))!);
  for (const [seat, player] of snap().players.entries()) {
    expect(q(overview()!, TESTIDS.warlordsHand(seat))?.textContent).toBe(
      String(player.jinnangHandCount),
    );
  }
  const parent = overview()!;
  const viewport = parent.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]')!;
  viewport.scrollTop = 72;
  for (const [entry, modal] of [
    [TESTIDS.warlordsCities(2), TESTIDS.cityLedger],
    [TESTIDS.warlordsHeroes(2), TESTIDS.seatHeroModal],
    [TESTIDS.warlordsGems(2), TESTIDS.seatGemModal],
  ]) {
    click(q(parent, entry)!);
    expect(overview() === parent).toBe(true);
    expect(parent.hasAttribute("data-nested-dialog-open")).toBe(true);
    const detail = q(document, modal)!;
    click(q(detail, TESTIDS.modalClose)!);
    await clock.advance(0);
    expect(q(document, modal)).toBeNull();
    expect(overview() === parent).toBe(true);
    expect(viewport.scrollTop).toBe(72);
  }
  click(q(parent, TESTIDS.warlordsGems(2))!);
  click(q(parent, TESTIDS.modalClose)!);
  expect(q(document, TESTIDS.seatGemModal)).toBeNull();
  await clock.advance(0);

  click(q(el, TESTIDS.jinnangCard("军情密探"))!);
  click(q(el, TESTIDS.actionbarPlay)!);
  expect(q(el, TESTIDS.seatOverview(1))).toBeNull();
  const target = q(el, TESTIDS.seatTarget(1))!;
  click(target);
  expect(target.getAttribute("aria-pressed")).toBe("true");
  expect(overview()).toBeNull();
});

it("安卓系统返回先关闭分项，再关闭诸侯详情", async () => {
  using _native = spyOn(tauriCore, "isTauri").mockReturnValue(true);
  const listener = new tauriCore.PluginListener("app", "back-button", 0);
  using unregister = spyOn(listener, "unregister").mockResolvedValue(undefined);
  using register = spyOn(tauriApp, "onBackButtonPress").mockResolvedValue(listener);
  const userAgent = Object.getOwnPropertyDescriptor(navigator, "userAgent");
  Object.defineProperty(navigator, "userAgent", { configurable: true, value: "Android" });
  clock = installControlledClock();
  try {
    const { el } = startGame((e) => armPhase(e, { activeIndex: 0, turnPhase: "Roll" }));
    click(q(el, TESTIDS.topbarOverview)!);
    const overview = () => q(document, TESTIDS.warlordsOverview);
    click(q(overview()!, TESTIDS.warlordsCities(0))!);
    expect(register).toHaveBeenCalledTimes(1);
    const pressBack = register.mock.calls[0][0];

    act(() => pressBack({ canGoBack: false }));
    await clock.advance(0);
    expect(q(document, TESTIDS.cityLedger)).toBeNull();
    expect(overview()).not.toBeNull();
    expect(unregister).not.toHaveBeenCalled();

    act(() => pressBack({ canGoBack: false }));
    await clock.advance(0);
    expect(overview()).toBeNull();
    expect(unregister).toHaveBeenCalledTimes(1);
  } finally {
    if (userAgent === undefined) Reflect.deleteProperty(navigator, "userAgent");
    else Object.defineProperty(navigator, "userAgent", userAgent);
  }
});

it("连环计上一步经在途锁保留首选，改选后第二步需重新选择", () => {
  const { el, snap, completeCommand } = startGame((e) => {
    for (let seat = 0; seat < e.players.length; seat++) {
      giveJinnang(e, seat, seat === 0 ? ["连环计"] : []);
    }
    armPhase(e, { activeIndex: 0, turnPhase: "AwaitingJinnang" });
    pinDice(e, "duel", [6, 1]);
  }, true);
  const confirm = () => q(el, TESTIDS.actionbarTarget)!;
  const seat = (index: number) => q(el, TESTIDS.seatTarget(index))!;
  click(q(el, TESTIDS.jinnangCard("连环计"))!);
  expect(q(el, TESTIDS.actionbarPlay)!.textContent).toBe("选目标");
  click(q(el, TESTIDS.actionbarPlay)!);
  completeCommand();
  click(seat(0));
  expect(q(el, TESTIDS.actionbar)?.textContent).toContain("不能指定自己");
  click(seat(1));
  expect(q(el, TESTIDS.actionbar)?.textContent).not.toContain("不能指定自己");
  expect(seat(1).getAttribute("aria-pressed")).toBe("true");
  click(confirm());
  completeCommand();
  expect(q(el, TESTIDS.actionbar)!.textContent).toContain(`已选 ${snap().players[1].guohao}`);
  expect(seat(1).getAttribute("aria-pressed")).toBe("true");
  expect(seat(1).getAttribute("aria-label")).toContain("已选为第一位");
  click(seat(3));
  click(q(el, TESTIDS.actionbarPrevious)!);
  expect(useGameStore.getState().interactive).toBe(false);
  expect(seat(3).getAttribute("aria-pressed")).toBe("true");
  expect(confirm().hasAttribute("disabled")).toBe(true);
  completeCommand();
  expect(seat(1).getAttribute("aria-pressed")).toBe("true");
  click(seat(2));
  click(confirm());
  completeCommand();
  expect(seat(1).getAttribute("aria-pressed")).toBe("false");
  expect(seat(2).getAttribute("aria-label")).toContain("已选为第一位");
  expect(seat(3).getAttribute("aria-pressed")).toBe("false");
  expect(confirm().hasAttribute("disabled")).toBe(true);
  expect(snap().players[0].jinnangHand).toEqual(["连环计"]);
  click(seat(1));
  expect(confirm().textContent).toBe("出牌");
  click(confirm());
  completeCommand();
  expect(snap().players[0].jinnangHand).toEqual([]);
  expect(snap().events.filter((event) => event.kind === "duelResolved")).toHaveLength(1);
});

it("地图选择收架，可重开并保留目标，取消后仍能以同一入口发动火攻", () => {
  const city = tileIndexOfProperty(MAP.board, "prop-xianyang");
  const { el, engine, snap } = startGame((e) => {
    for (let seat = 0; seat < e.players.length; seat++) {
      giveJinnang(e, seat, seat === 0 ? ["火烧连营"] : []);
    }
    armPhase(e, { activeIndex: 0, turnPhase: "AwaitingJinnang" });
    armHero(e, 0, "zhouyu", ["huogong"]);
    placePlayer(e, 0, city);
    grantProperty(e, 1, "prop-xianyang", 2);
  });
  const confirm = () => q(el, TESTIDS.actionbarTarget)!;
  click(q(el, TESTIDS.jinnangCard("火烧连营"))!);
  click(q(el, TESTIDS.actionbarPlay)!);
  expect(q(el, TESTIDS.jinnangRack)).toBeNull();
  const unowned = engine.board.tiles.find(
    (tile) => tile.propertyId != null && engine.findOwner(tile.propertyId) == null,
  )!;
  click(el.querySelector(TESTIDS.cityTarget(unowned.index))!);
  expect(q(el, TESTIDS.actionbar)!.textContent).toContain(`${unowned.name}(无主,作火源自身免伤)`);
  click(el.querySelector(TESTIDS.cityTarget(city))!);
  click(q(el, TESTIDS.jinnangToggle)!);
  expect(el.querySelector(TESTIDS.cityTargetPicked(city))).not.toBeNull();
  expect(confirm().hasAttribute("disabled")).toBe(false);
  click(q(el, TESTIDS.actionbarCancel)!);
  expect(snap().players[0].jinnangHand).toEqual(["火烧连营"]);
  click(q(el, TESTIDS.jinnangCard(skillOptionId("zhouyu", "huogong")))!);
  expect(q(el, TESTIDS.actionbarPlay)!.textContent).toBe("选目标");
  click(q(el, TESTIDS.actionbarPlay)!);
  click(el.querySelector(TESTIDS.cityTarget(city))!);
  expect(confirm().textContent).toBe("发动");
  expect(q(el, TESTIDS.actionbarCancel)!.textContent).toBe("作罢");
  click(confirm());
  expect(snap().events).toContainEqual(
    expect.objectContaining({
      kind: "heroSkillActivated",
      skillId: "huogong",
      targetTileIndex: city,
    }),
  );
  expect(snap().players[0].jinnangHand).toEqual(["火烧连营"]);
});

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
  Tip = (await import("@app/screens/game/Tip")).Tip;
  setController = registryMod.setController;
  extractBatchEvents = extractMod.extractBatchEvents;
  present = orchMod.present;
  createEngineSink = sinksMod.createEngineSink;
  // WiringController:生产基类最小子型——单机 hotSeat 参数 + submitCommand 命令腿
  // + 基类 sync 状态桥(模板同款;房间编排/传输/看门狗是层③领域不进来)。
  const Base = ctrlMod.GameController;
  class WiringControllerImpl extends Base {
    private pendingCommand: GameCommand | null = null;
    constructor(
      private readonly e: GameEngine,
      private readonly deferCommands: boolean,
    ) {
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
      if (this.deferCommands) {
        // 传输边界分拍:与生产控制器同样先上 pending 锁,回包拍再执行真实命令。
        this.pendingCommand = cmd;
        this.pending = true;
        this.sync();
        return;
      }
      this.e.submitCommand(cmd); // 引擎统一命令口:校验全在,违例当场抛(零兜底)
      this.sync(); // 基类状态桥:与生产同一出口(snapshot/interactive 同拍刷新)
    }
    completeCommand(): void {
      if (this.pendingCommand == null) throw new Error("接线测试:没有待回包命令");
      this.e.submitCommand(this.pendingCommand);
      this.pendingCommand = null;
      this.pending = false;
      this.sync();
    }
    // 测试侧重灌口(protected sync 的公开面;直写引擎后调)。
    resync(): void {
      const current = this.e.pendingReaction;
      if (current != null) {
        this.observeReactionTiming(
          { seq: current.seq, remainingMs: current.view.windowMs },
          performance.now(),
        );
      }
      this.sync();
    }
  }
  newWiringController = (e, deferCommands) => new WiringControllerImpl(e, deferCommands);
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
  setController(null); // registry 换局销毁契约:控制器随例释放,不留活口
  useGameStore.getState().reset();
  useNetStore.getState().reset();
  useFxStore.getState().resetFx();
  container?.remove();
  container = null;
  clock?.restore();
  clock = null;
});

afterAll(async () => {
  // 排干 React 调度器余拍(模板同款):release 后再触发会在无 window 环境抛
  // 「window is not defined」——window 还在时让完这一拍再拆 happy-dom。
  await new Promise((r) => setTimeout(r, 0));
  await releaseHappyDom();
});

describe("手牌架内容与临时显隐", () => {
  it("非己方回合说明遣散限制，回合开始后可确认遣散", async () => {
    const { el, engine, writeEngine } = startGame((e) => {
      armHero(e, 0, "caopi", ["fangzhu"]);
      armPhase(e, { activeIndex: 1, turnPhase: "Roll" });
    });
    click(q(el, TESTIDS.pileHeroes)!);
    await settle();
    const actions = () => modalQ(TESTIDS.heroInspectionActions)!;
    const dismiss = () => modalQ(TESTIDS.heroDismiss("caopi"))! as HTMLButtonElement;
    expect(dismiss().disabled).toBe(true);
    expect(actions().textContent).toContain("己方回合可遣散");

    writeEngine((e) => armPhase(e, { activeIndex: 0 }));
    expect(actions().textContent).not.toContain("己方回合可遣散");
    expect(dismiss().disabled).toBe(false);
    click(dismiss());
    expect(dismiss().textContent).toBe("确认遣散");
    click(dismiss());
    expect(engine.players[0]!.heroes).toHaveLength(0);
  });

  it("合资格技能书在自己的出牌阶段进入牌架，选将确认才消耗一册", async () => {
    clock = installControlledClock();
    const book = makeSkillBook("huogong");
    const { el, engine, writeEngine } = startGame((e) => {
      giveJinnang(e, 0, []);
      giveTreasure(e, 0, [book, book]);
      armPhase(e, { activeIndex: 0, turnPhase: "AwaitingJinnang" });
    });
    const rackBook = () => q(el, TESTIDS.bookUse(book.id));
    expect(rackBook()).toBeNull();

    writeEngine((e) => {
      armHero(e, 0, "zhouyu", ["yingzi"]);
      armHero(e, 0, "zhugeliang", ["huogong"]);
      armPhase(e, { turnPhase: "Roll" });
    });
    expect(rackBook()).toBeNull();
    writeEngine((e) => armPhase(e, { activeIndex: 1, turnPhase: "AwaitingJinnang" }));
    expect(rackBook()).toBeNull();
    writeEngine((e) => armPhase(e, { activeIndex: 0 }));
    expect(rackBook()).not.toBeNull();
    expect(q(el, TESTIDS.jinnangToggle)!.textContent).toBe("锦囊");

    click(q(el, TESTIDS.pileTreasures)!);
    await clock.settle();
    const treasureModal = modalQ(TESTIDS.treasureModal)!;
    expect(treasureModal.textContent).toContain(book.name);
    expect(q(treasureModal, TESTIDS.bookUse(book.id))).toBeNull();
    click(q(treasureModal, TESTIDS.modalClose)!);
    await clock.advance(0);

    const deck = [...engine.jinnangDeck];
    const discard = [...engine.jinnangDiscard];
    const openPicker = () => click(rackBook()!);
    const chooseZhouYu = () => click(modalQ(TESTIDS.bookLearnItem("zhouyu"))!);
    const confirm = () => modalQ(TESTIDS.bookLearnConfirm)! as HTMLButtonElement;
    openPicker();
    expect(confirm().disabled).toBe(true);
    expect(modalQ(TESTIDS.bookLearnItem("zhugeliang"))).toBeNull();
    chooseZhouYu();
    click(modalQ(TESTIDS.bookLearnCancel)!);
    expect(engine.players[0]!.heroes[0]!.skillIds).toEqual(["yingzi"]);
    expect(engine.players[0]!.treasures).toHaveLength(2);

    openPicker();
    chooseZhouYu();
    expect(confirm().disabled).toBe(false);
    expect(engine.players[0]!.treasures).toHaveLength(2);
    click(confirm());
    expect(engine.players[0]!.heroes[0]!.skillIds).toContain("huogong");
    expect(engine.players[0]!.treasures).toEqual([book]);
    expect(rackBook()).toBeNull();
    expect(engine.players[0]!.jinnangHand).toEqual([]);
    expect(engine.jinnangDeck).toEqual(deck);
    expect(engine.jinnangDiscard).toEqual(discard);
    await clock.settle();
  });

  it("手指移出签面后取消长按，重新长按仍可查看浮签", async () => {
    clock = installControlledClock();
    container = document.createElement("div");
    document.body.appendChild(container);
    act(() => {
      root = createRoot(container!);
      root.render(
        <Tip tip={{ name: "签面", detail: "点数" }} testId={TESTIDS.diceFace}>
          签
        </Tip>,
      );
    });
    const trigger = q(container, TESTIDS.diceFace)!;
    const pointer = (type: string) =>
      new PointerEvent(type, {
        bubbles: true,
        pointerType: "touch",
        pointerId: 1,
        isPrimary: true,
        relatedTarget: type === "pointerout" ? document.body : null,
      });
    act(() => {
      trigger.dispatchEvent(pointer("pointerdown"));
      trigger.dispatchEvent(pointer("pointerout"));
    });
    await clock.advance(401);
    expect(modalQ(TESTIDS.attrTip)).toBeNull();
    act(() => {
      document.body.dispatchEvent(pointer("pointerup"));
      trigger.dispatchEvent(pointer("pointerdown"));
    });
    await clock.advance(401);
    expect(modalQ(TESTIDS.attrTip)).not.toBeNull();
    act(() => trigger.dispatchEvent(pointer("pointerup")));
  });

  it("不可发动的技能仍可查看技名详情，收放手牌保留已选技能", () => {
    const { el, engine } = startGame((e) => {
      for (let seat = 0; seat < e.players.length; seat++) giveJinnang(e, seat, []);
      armHero(e, 0, "huatuo", ["zhenji"]);
      armHero(e, 0, "zhangxingcai", ["leigu"]);
      setCash(e, 0, 0);
      armPhase(e, { activeIndex: 0, turnPhase: "AwaitingJinnang" });
    });
    const unavailable = q(
      el,
      TESTIDS.jinnangCard(skillOptionId("huatuo", "zhenji")),
    )! as HTMLButtonElement;
    const available = () => q(el, TESTIDS.jinnangCard(skillOptionId("zhangxingcai", "leigu")))!;
    expect(unavailable.textContent).toContain("银两不足");
    expect(unavailable.getAttribute("aria-label")).toContain("华佗·赈济");
    expect(unavailable.getAttribute("aria-label")).toContain("银两不足");
    click(available());
    expect(available().getAttribute("aria-pressed")).toBe("true");
    click(unavailable);
    expect(available().getAttribute("aria-pressed")).toBe("true");
    expect(engine.pendingSkill).toBeNull();
    const toggle = q(el, TESTIDS.jinnangToggle)! as HTMLButtonElement;
    click(toggle);
    expect(q(el, TESTIDS.jinnangRack)).toBeNull();
    expect(engine.pendingSkill).toBeNull();
    click(toggle);
    expect(available().getAttribute("aria-pressed")).toBe("true");
    const inspect = q(el, TESTIDS.skillCardInspect("huatuo", "zhenji"))! as HTMLButtonElement;
    expect(inspect.getAttribute("aria-label")).toContain("赈济");
    click(inspect);
    expect(modalQ(TESTIDS.skillGlossary)).not.toBeNull();
    expect(modalQ(TESTIDS.skillGlossaryRow("zhenji"))).not.toBeNull();
    expect(available().getAttribute("aria-pressed")).toBe("true");
    expect(engine.pendingSkill).toBeNull();
  });

  it("不同名将的同名技能各自选牌并打开对应名将的全览", () => {
    const city = tileIndexOfProperty(MAP.board, "prop-xianyang");
    const { el } = startGame((e) => {
      for (let seat = 0; seat < e.players.length; seat++) giveJinnang(e, seat, []);
      armHero(e, 0, "zhouyu", ["huogong"]);
      armHero(e, 0, "zhugeliang", ["huogong"]);
      placePlayer(e, 0, city);
      grantProperty(e, 1, "prop-xianyang", 2);
      armPhase(e, { activeIndex: 0, turnPhase: "AwaitingJinnang" });
    });
    const zhouyu = q(el, TESTIDS.jinnangCard(skillOptionId("zhouyu", "huogong")))!;
    const zhugeliang = q(el, TESTIDS.jinnangCard(skillOptionId("zhugeliang", "huogong")))!;
    click(zhouyu);
    expect(zhouyu.getAttribute("aria-pressed")).toBe("true");
    click(zhugeliang);
    expect(zhouyu.getAttribute("aria-pressed")).toBe("false");
    expect(zhugeliang.getAttribute("aria-pressed")).toBe("true");
    click(q(el, TESTIDS.skillCardInspect("zhouyu", "huogong"))!);
    expect(modalQ(TESTIDS.skillGlossary)!.textContent).toContain("周瑜");
    expect(zhugeliang.getAttribute("aria-pressed")).toBe("true");
  });

  it("卡牌段收架只留阶段提示，展开后恢复选择并继续出牌", () => {
    const { el, engine } = startGame((e) => {
      for (let seat = 0; seat < e.players.length; seat++) giveJinnang(e, seat, []);
      giveJinnang(e, 0, ["横征暴敛"]);
      armPhase(e, { activeIndex: 0, turnPhase: "AwaitingJinnang" });
    });
    const toggle = () => click(q(el, TESTIDS.jinnangToggle)!);
    const card = () => q(el, TESTIDS.jinnangCard("横征暴敛"))!;
    const expectCollapsed = () => {
      expect(q(el, TESTIDS.jinnangRack)).toBeNull();
      expect(q(el, TESTIDS.actionbar)!.textContent).toBe("出牌阶段");
      expect(q(el, TESTIDS.actionbarPass)).toBeNull();
      expect(q(el, TESTIDS.actionbarPlay)).toBeNull();
    };
    toggle();
    expectCollapsed();
    toggle();
    expect(q(el, TESTIDS.actionbarPass)).not.toBeNull();
    click(card());
    expect(card().getAttribute("aria-pressed")).toBe("true");
    toggle();
    expectCollapsed();
    toggle();
    expect(card().getAttribute("aria-pressed")).toBe("true");
    click(q(el, TESTIDS.actionbarPlay)!);
    expect(engine.players[0].jinnangHand).toEqual([]);
  });

  it("同一出牌窗遣散命令在途与回包都保留手动收架", async () => {
    const { el, engine, snap, completeCommand } = startGame((e) => {
      for (let seat = 0; seat < e.players.length; seat++) giveJinnang(e, seat, []);
      giveJinnang(e, 0, ["横征暴敛"]);
      armHero(e, 0, "caopi", ["fangzhu"]);
      armPhase(e, { activeIndex: 0, turnPhase: "AwaitingJinnang" });
    }, true);
    const window = () => [snap().phase, snap().turnPhase, snap().turnNumber, snap().activeIndex];
    const before = window();
    expect(snap().turnPhase).toBe("AwaitingJinnang");
    click(q(el, TESTIDS.jinnangToggle)!);
    expect(q(el, TESTIDS.jinnangRack) === null).toBe(true);
    click(q(el, TESTIDS.pileHeroes)!);
    await settle();
    click(modalQ(TESTIDS.heroDismiss("caopi"))!);
    click(modalQ(TESTIDS.heroDismiss("caopi"))!);
    expect(useGameStore.getState().interactive).toBe(false);
    expect(window()).toEqual(before);
    expect(q(el, TESTIDS.jinnangRack) === null).toBe(true);
    completeCommand();
    expect(useGameStore.getState().interactive).toBe(true);
    expect(engine.players[0].heroes).toEqual([]);
    expect(window()).toEqual(before);
    expect(q(el, TESTIDS.jinnangRack) === null).toBe(true);
  });

  it("内容变化即时对齐自动显隐,手动开收保留至回合或窗态边界,收架仍能应答", () => {
    const { el, engine, writeEngine } = startGame((e) => {
      for (let seat = 0; seat < e.players.length; seat++) giveJinnang(e, seat, []);
      armPhase(e, { activeIndex: 0, turnPhase: "Roll" });
    });
    const rack = () => q(el, TESTIDS.jinnangRack);
    const toggle = () => click(q(el, TESTIDS.jinnangToggle)!);
    expect(q(el, TESTIDS.handZone) === null).toBe(true);
    // 同一回合首次抽牌无需相位变化即可展开。
    writeEngine((e) => {
      expect(e.drawJinnang(0, 1)).toBe(1);
    });
    expect(rack() !== null).toBe(true);
    writeEngine((e) => {
      giveJinnang(e, 0, ["横征暴敛"]);
      armBankrupt(e, 3);
      armPhase(e, { turnPhase: "AwaitingJinnang" });
    });
    click(q(el, TESTIDS.jinnangCard("横征暴敛"))!);
    expect(q(el, TESTIDS.actionbar)!.textContent).toContain("对其余 2 位诸侯各征至多 200 两");
    click(q(document, TESTIDS.actionbarPlay)!);
    expect(engine.players[0].jinnangHand).toEqual([]);
    expect(q(el, TESTIDS.handZone) === null).toBe(true);
    // 空态手动入口保留;内容增减不覆盖玩家本次开/收。
    toggle();
    expect(rack() !== null).toBe(true);
    expect(q(el, TESTIDS.diceFace) === null).toBe(true);
    writeEngine((e) => {
      expect(e.drawJinnang(0, 1)).toBe(1);
    });
    expect(q(el, TESTIDS.diceFace) !== null).toBe(true);
    writeEngine((e) => giveJinnang(e, 0, []));
    expect(rack() !== null).toBe(true);
    toggle();
    writeEngine((e) => giveJinnang(e, 0, ["识破诡计"]));
    expect(rack() === null).toBe(true);
    writeEngine((e) => e.endTurn());
    writeEngine((e) => armPhase(e, { activeIndex: 0, turnPhase: "Roll" }));
    expect(rack() !== null).toBe(true); // 只有反应牌也算内容,新回合复位手动收。
    writeEngine((e) => armPhase(e, { turnPhase: "AwaitingJinnang" }));
    writeEngine((e) => giveJinnang(e, 0, []));
    expect(rack() === null).toBe(true);
    writeEngine((e) => armHero(e, 0, "zhangxingcai", ["leigu"]));
    expect(q(el, TESTIDS.jinnangCard(skillOptionId("zhangxingcai", "leigu"))) !== null).toBe(true);
    toggle();
    writeEngine((e) => armPhase(e, { turnPhase: "Roll" }));
    writeEngine((e) => armPhase(e, { turnPhase: "AwaitingJinnang" }));
    expect(rack() !== null).toBe(true); // 新窗按当前主动技内容重新对齐。
    // 反应横幅在手动收架后仍可“不用”,命令走真实反应窗。
    writeEngine((e) => {
      giveJinnang(e, 0, ["识破诡计"]);
      giveJinnang(e, 1, ["横征暴敛"]);
      armPhase(e, { activeIndex: 1, turnPhase: "AwaitingJinnang" });
      e.submitCommand({ type: "useJinnang", cardId: "横征暴敛" });
    });
    toggle();
    expect(q(document, TESTIDS.reactionBanner) !== null).toBe(true);
    click(q(document, TESTIDS.reactionDecline)!);
    expect(engine.pendingReaction).toBeNull();
    // 无牌的触发技能询问只挂横幅,空架不影响应答通路。
    writeEngine((e) => {
      giveJinnang(e, 0, []);
      armPhase(e, { activeIndex: 0, turnPhase: "Roll" });
      armHero(e, 0, "caopi", ["fangzhu"]);
      e.damageStamina(0, 70, 1);
    });
    expect(q(el, TESTIDS.jinnangHand) === null).toBe(true);
    expect(q(document, TESTIDS.skillChoiceBanner) !== null).toBe(true);
    click(q(document, TESTIDS.skillChoiceDecline)!);
    expect(engine.turnPhase).toBe("Roll");
  });
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
  it("起手与首回合摸牌后，架中只见自己牌面，其他席位显示张数", () => {
    const { el, engine, snap } = startGame(() => {
      // 零种植:seed 67 离线核算天然凑齐断言面(头注第 2 步)
    });
    // 引擎缝 fail-fast:发牌没进引擎,后面全是废话(e2e 同款断言,直读引擎)
    expect(engine.jinnangDeck.length).toBe(JINNANG_DECK_LIST.length - 5);
    expect(
      engine.players.reduce((a, p) => a + p.jinnangHand.length, 0) + engine.jinnangDiscard.length,
    ).toBe(5);
    const ownCount = engine.activeIndex === 0 ? 2 : 1;
    const otherCount = engine.activeIndex === 1 ? 2 : 1;
    expect(q(el, TESTIDS.handZone)).not.toBeNull();
    expect(
      el.querySelectorAll(`[data-testid="${TESTIDS.jinnangHand}"] [data-testid^="jinnang-card-"]`),
    ).toHaveLength(ownCount);
    // 他人计数章可见(席位卡手牌徽章 aria 即计数,#253 jinnang-count 随诸侯行退役)
    expect(q(el, TESTIDS.seatAttr(1, "hand"))!.getAttribute("aria-label")).toBe(
      `锦囊手牌 ${otherCount}`,
    );
    expect(el.querySelectorAll("[data-testid^='jinnang-card-']")).toHaveLength(ownCount);
    expect(snap().players[0].jinnangHand).toHaveLength(ownCount);
  });
});
