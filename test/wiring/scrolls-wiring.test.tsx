// 关键接线:真实组件与控制器验证命令/状态或私密信息通路,不验证几何和演出。
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
// bun 测试进程无 Vite define:GameScreen 全图经 SettingsDialog 触达 version.ts,其
// 模块求值读构建期注入的 __APP_VERSION__——按生产同一值源(package.json CalVer)先行
// 注入,晚绑 import 前生效(模板同款,#1297 波评审备案:留置不还原,无害)。
import { useFxStore } from "@app/fx/fxStore";
import { setSnapPin } from "@app/fx/catchup";
import type { WorkerClock } from "@app/net/worker-clock";
import { setAudio } from "@app/fx/audio";
import { UI } from "@app/fx/timings";
import { SHORT_LANDSCAPE_QUERY } from "@app/hooks/use-media-query";
import { SCROLL_TESTIDS as T } from "@app/screens/game/scroll/testids";
import { TESTIDS } from "@app/screens/game/testids";
import { GAME_DIAG_TID } from "@app/screens/shared/testids";
import { useGameStore, type GameSnapshot } from "@app/store/gameStore";
import { useNetStore } from "@app/store/netStore";
import { GameEngine, type GameCommand, type SeatConfig } from "@dafung/core/engine/authority";
import type { MapData } from "@dafung/core/engine/board-loader";
import { loadMap } from "@dafung/core/engine/board-loader";
import { createDice } from "@dafung/core/engine/dice";
import { heroById } from "@dafung/core/engine/heroes";
import { formatMoney } from "@dafung/core/engine/money";
import { applyPlant, type PlantOp } from "@dafung/core/engine/planter";
import { AUTO_ROLL_DELAY_MS, BOT_STEP_MS } from "@dafung/core/engine/timings";
import { guidePriceOf, makeSkillBook } from "@dafung/core/engine/treasures";
import type { DecisionOptions } from "@dafung/core/protocol/wire";
import { recruitmentDecisionOf } from "@dafung/core/room/recruitment-decisions";
import { treasureDecisionOf } from "@dafung/core/room/treasure-decisions";
import { IDBFactory } from "fake-indexeddb";
import type { Window as HappyDomWindow } from "happy-dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import pkg from "../../package.json";
import rawGuanzhongData from "../../packages/core/maps/guanzhong.json";
import { installControlledClock } from "./controlled-clock";
import { ensureHappyDom, releaseHappyDom } from "./happy-dom-register";
import { recordAudio } from "./record-audio";
(globalThis as Record<string, unknown>).__APP_VERSION__ = pkg.version;

/** 晚绑模块型(late binding,红线见头注第 0 步;type-of-import 类型面静态引用,
 *  求值面零触碰,不破晚绑)。 */
type GameScreenModule = typeof import("@app/screens/game/GameScreen");
type RegistryModule = typeof import("@app/controllers/registry");
type GameControllerClass = import("@app/controllers/controller").GameController;
let GameScreen: GameScreenModule["GameScreen"];
let setController: RegistryModule["setController"];
let LocalController: typeof import("@app/controllers/local").LocalController;
let originalIndexedDb: PropertyDescriptor | undefined;

/** 接线控制器面(GameController 生产基类的最小子型 + resync 测试口;构造见 beforeAll)。 */
type WiringController = GameControllerClass & { resync(): void };
let newWiringController: (e: GameEngine) => WiringController;

const guanzhongData = rawGuanzhongData as MapData; // JSON 导入 tier 丢字面量,cast 同 map-storage-wiring #1316 形
const MAP = loadMap(guanzhongData);
const SEED = 1486; // 模板既定锚(e2e 卷轴族谱内种子)

/** 座位表:与模板同(solo 口径 seat 0 = 自机)。 */
const SEATS: SeatConfig[] = [
  { name: "座 1", isBot: false, guohao: "魏" },
  { name: "座 2", isBot: true },
  { name: "座 3", isBot: true },
  { name: "座 4", isBot: true },
];

/** 公共命令链开局，非法态当场抛错。 */
function seedEngine(): GameEngine {
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
let clock: ReturnType<typeof installControlledClock>;
const roomClock: WorkerClock = {
  now: () => performance.now(),
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  dispose() {},
  pause() {},
  resume() {},
  onFatal() {},
  paused: false,
};

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

/** 种局→种植→注册控制器→基类 sync 灌 store→挂屏(每例开头同款一条龙)。
 *  ops = 初始布场指令(PlantOp 单源逐条落种,判词见头注「种植单源形」);
 *  writeEngine = 进程内引擎公共方法直呼缝 + 重灌 store(e2e callEngine #1302 同语义)。 */
function startGame(ops: PlantOp[] = []): {
  el: HTMLElement;
  engine: GameEngine;
  plant: (op: PlantOp) => void;
  writeEngine: (write: (e: GameEngine) => void) => void;
  snap: () => GameSnapshot;
} {
  const e = seedEngine();
  for (const op of ops) applyPlant(e, op);
  const c = newWiringController(e);
  setController(c, guanzhongData); // 生产同款:连地图一起注册(卷轴层挂载门卫)
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

function patchSeatView(patch: {
  snapshot?: GameSnapshot;
  interactive?: boolean;
  decisionOptions?: DecisionOptions;
}): void {
  act(() => {
    const seatView = { ...useGameStore.getState().seatView!, ...patch };
    useGameStore.setState({
      seatView,
      snapshot: seatView.snapshot,
      interactive: seatView.interactive,
    });
  });
}

/** 真点击(React 合成事件走冒泡;act 内派发,模板同款)。 */
function click(el: Element): void {
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

/** 宏任务让步与业务延时分开:本拍只排零延时任务,不跨越退场/钤印节拍。 */
const settle = () => clock.settle();

/** 明确走完退场协议后断卸载,不轮询真实业务时钟。布尔断言避免失败时序列化
 *  happy-dom 节点的循环引用;时间取生产单源,不缩短玩家节拍。 */
async function finishExit(query: () => Element | null, label: string): Promise<void> {
  await clock.advance(0);
  expect(query() === null, label).toBe(true);
}

/** 弹层/卷轴查询口:选宝弹层/技能全览经 Portal 在 body;卷轴族在 GameScreen 卷轴层
 *  内——一律 document 级查询,不受挂载点漂移影响。 */
const docQ = (id: string): Element | null => q(document, id);

/** 交涉现场种植(react-scrolls plantTrade 的接线层直译,城主=人类 0,访客=bot 1):
 *  城主持宝(giveTreasure 终态替换保起手全集,判词单源 planter)+ 访客垫足现金
 *  (setCash,防 payOrLiquidate 清算自救支线劫持交涉结算)+ 被访城授产(grantProperty,
 *  #413 判词:必须无人持有,定都产出会撞车)+ 交涉挂起载荷(armVisitor)+ 停交涉相位
 *  (armPhase,decisionOwner=城主天然成立)。返回被访城 propertyId 与种子城 def 供价签
 *  期望核算。 */
function plantTrade(handles: ReturnType<typeof startGame>, level: number | "max" = 1): string {
  const { engine, plant, snap } = handles;
  plant({
    kind: "giveTreasure",
    seat: 0,
    treasures: [
      ...snap().players[0].treasures,
      { id: "seal", name: "传国玉玺", level: 3, desc: "天命所归" },
    ],
  });
  plant({ kind: "setCash", seat: 1, cash: Math.max(snap().players[1].cash, 5000) });
  const owned = new Set(engine.players.flatMap((p) => p.properties.map((h) => h.propertyId)));
  const tile = engine.board.tiles.find((t) => t.propertyId != null && !owned.has(t.propertyId));
  if (tile?.propertyId == null) throw new Error("接线测试:无主城缺席(种植前提失真)");
  plant({
    kind: "grantProperty",
    seat: 0,
    propertyId: tile.propertyId,
    level: level === "max" ? engine.catalog.get(tile.propertyId)!.maxLevel : level,
  });
  plant({ kind: "placePlayer", seat: 1, position: tile.index });
  plant({ kind: "armVisitor", propertyId: tile.propertyId, ownerSeat: 0 });
  plant({
    kind: "armPhase",
    phase: "Playing",
    activeIndex: 1,
    turnPhase: "AwaitingTreasureOwner",
  });
  return tile.propertyId;
}

beforeAll(async () => {
  ensureHappyDom();
  originalIndexedDb = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: new IDBFactory() });
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
  ({ LocalController } = await import("@app/controllers/local"));
  GameScreen = screenMod.GameScreen;
  setController = registryMod.setController;
  // 注册带地图(生产 setController(controller, map) 同款):DecisionScrollLayer/
  // BoardView 的挂载门卫要 registry 静态上下文(getControllerMap),缺图整层不渲染。
  // WiringController:生产基类最小子型——submitCommand 命令腿
  // + 基类 sync 状态桥(模板同款;房间编排/传输/看门狗是层③领域不进来)。
  const Base = ctrlMod.GameController;
  class WiringControllerImpl extends Base {
    constructor(private readonly e: GameEngine) {
      super();
    }
    override get engine(): GameEngine {
      return this.e;
    }
    protected override get mySeat(): number {
      return 0;
    }

    override dispatchCommand(cmd: GameCommand, decisionPoint?: string): void {
      if (
        (cmd.type === "resolveHeroPick" || cmd.type === "resolveTreasureOwner") &&
        decisionPoint !== this.seatView.decisionPoint
      )
        throw new Error("卷轴未提交原决策点");
      this.e.submitCommand(cmd); // 引擎统一命令口:校验全在,违例当场抛(零兜底)
      this.resync();
    }
    // 测试侧重灌口(protected sync 的公开面;种植后调)。
    resync(): void {
      if (this.e.decisionOwner === this.mySeat && this.e.turnPhase === "AwaitingJinnang") {
        this.observeSeatDecision({
          decisionPoint: `出牌-${this.e.turnNumber}`,
          decisionOptions: {
            kind: "playJinnang",
            choices: this.e.choicesFor(),
            pendingJinnang: this.e.pendingJinnang,
            pendingSkill: this.e.pendingSkill,
          },
        });
      } else if (this.e.decisionOwner === this.mySeat && this.e.turnPhase === "AwaitingHeroPick") {
        this.observeSeatDecision({
          decisionPoint: `招贤-${this.e.turnNumber}`,
          decisionOptions: recruitmentDecisionOf(this.e),
        });
      } else if (
        this.e.decisionOwner === this.mySeat &&
        this.e.turnPhase === "AwaitingTreasureOwner"
      ) {
        this.observeSeatDecision({
          decisionPoint: `珍宝-${this.e.turnNumber}`,
          decisionOptions: treasureDecisionOf(this.e),
        });
      } else {
        this.observeSeatDecision({ decisionPoint: null });
      }
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
  await settle(); // 原生异步测量余拍也包进 act,再卸组件执行各自的定时器清理
  if (root != null) {
    act(() => root!.unmount());
    root = null;
  }
  if (container != null) container.remove();
  container = null;
  setAudio(null);
  setController(null); // registry 换局销毁契约:控制器随例释放,不留活口
  useGameStore.getState().reset();
  useNetStore.getState().reset();
  useFxStore.getState().resetFx();
  clock.restore();
});

afterAll(async () => {
  // 排干 React 调度器余拍(模板同款):release 后再触发会在无 window 环境抛
  // 「window is not defined」——window 还在时让完这一拍再拆 happy-dom。
  await new Promise((r) => setTimeout(r, 0));
  if (originalIndexedDb) Object.defineProperty(globalThis, "indexedDB", originalIndexedDb);
  else Reflect.deleteProperty(globalThis, "indexedDB");
  await releaseHappyDom();
});

it.each(["no-preference", "reduce"] as const)(
  "定都卷轴首次展纸，筑章实际钤定只响一次（%s）",
  async (motion) => {
    const device = (window as unknown as HappyDomWindow).happyDOM.settings.device;
    device.prefersReducedMotion = motion;
    try {
      const controller = new LocalController(
        MAP,
        { seats: SEATS.slice(0, 2), seed: SEED, mapId: "guanzhong", botStepMs: BOT_STEP_MS },
        roomClock,
      );
      setController(controller, guanzhongData);
      const el = mount();
      const { capital, snapshot } = controller.seatView;
      const option = capital!.options.find((candidate) => candidate.available)!;
      const city = el.querySelector(TESTIDS.city(option.tileIndex))!;
      const sounds = recordAudio();

      click(city);
      expect(sounds).toEqual(["scrollOpen"]);
      expect(docQ(T.tileDetailScroll)!.textContent).toContain(formatMoney(option.cost));
      click(q(docQ(T.tileDetailScroll)!, TESTIDS.modalMinimize)!);
      await settle();
      expect(controller.seatView.capital?.selectedOption).toEqual(option);
      expect(docQ(T.tileDetailScroll)?.closest("[hidden]") != null).toBe(true);
      click(docQ(TESTIDS.modalRestore)!);
      await settle();
      click(docQ(TESTIDS.confirmCapitalCancel)!);
      expect(controller.seatView.capital?.selectedOption).toBeNull();
      expect(controller.seatView.snapshot.players[0].capitalIndex).toBe(-1);
      click(city);
      expect(sounds).toEqual(["scrollOpen"]);
      click(docQ(TESTIDS.confirmCapitalOk)!);

      await settle();
      const settled = controller.seatView.snapshot.players[0];
      expect(settled.capitalIndex).toBe(option.tileIndex);
      expect(settled.cash).toBe(snapshot.players[0].cash - option.cost);
      const seal = q(el, TESTIDS.fxSeal("筑"));
      if (!seal) throw new Error("定都后缺少筑章");
      if (motion === "no-preference") {
        expect(sounds).not.toContain("stamp");
        act(() => {
          for (let i = 0; i < 2; i++) {
            seal.dispatchEvent(
              new AnimationEvent("animationend", { animationName: "fx-seal-slam", bubbles: true }),
            );
          }
        });
      }
      expect(sounds.filter((sound) => sound === "stamp")).toEqual(["stamp"]);
    } finally {
      act(() => {
        device.prefersReducedMotion = "no-preference";
      });
    }
  },
);

it("购地卷轴按座位选项报价，点击后经单机房间扣款进驻", async () => {
  setSnapPin(true);
  try {
    const controller = new LocalController(
      MAP,
      { seats: SEATS.slice(0, 2), seed: 2, mapId: "guanzhong", botStepMs: BOT_STEP_MS },
      roomClock,
    );
    setController(controller, guanzhongData);
    const el = mount();
    click(el.querySelector(TESTIDS.city(3))!);
    click(docQ(TESTIDS.confirmCapitalOk)!);
    await clock.advance(BOT_STEP_MS);
    click(q(el, TESTIDS.actionbarPass)!);
    await settle();
    await clock.advance(AUTO_ROLL_DELAY_MS + 1);
    const { snapshot, decisionOptions } = controller.seatView;
    expect(snapshot.players[0].position).toBe(9);
    expect(decisionOptions).toMatchObject({
      kind: "landDecision",
      landing: { propertyId: "prop-lushui", tileIndex: 9 },
      options: [
        { command: "buyProperty", cost: 1800 },
        { command: "endDecision", cost: 0 },
      ],
    });
    patchSeatView({
      snapshot: {
        ...snapshot,
        choices: [],
        lastLandOutcomeKind: "Noop",
        lastLandOutcomeProperty: null,
      },
    });
    expect(q(el, T.buyScroll)?.textContent).toContain(formatMoney(1800));
    click(q(el, TESTIDS.actionButton("buy"))!);
    await settle();
    const settled = controller.seatView.snapshot;
    expect(settled.players[0].cash).toBe(snapshot.players[0].cash - 1800);
    expect(settled.players[0].properties).toContainEqual(
      expect.objectContaining({ propertyId: "prop-lushui", level: 1, defense: 40 }),
    );
    expect(settled.activeIndex).toBe(1);
    await finishExit(() => q(el, T.buyScroll), "成交后收起购地卷轴");
  } finally {
    setSnapPin(false);
  }
});

describe("招贤卷轴(自 react-scrolls 迁入,#1317 批T3)", () => {
  // ── ①先看后选拍板(react-scrolls 招贤例迁入)──
  // 断言面:tryRecruitHero 公共方法真掷候选(候选行=引擎真产物,非伪造 offeredHeroes,
  // e2e callEngine 同语义)→招贤卷轴同时提供求书和跳过→
  // 预掷明牌 chips≥1 →点候选技名 chip=开技能全览(池全貌逐技在列+未授灰置+看将不发
  // 命令)→关框→点卡体=开详情弹框(拍板唯一入口,「收为麾下」在场)→拍板→钤印节拍
  // 后卷轴收场、候选清空。钤印与幽灵退场各按生产时长推进,不轮询真实业务延时。
  it("三选一:预掷明牌 chips+全览池对照,点卡/技名开全览先看后选,弹框拍板收将", async () => {
    const { el, engine, writeEngine, snap } = startGame([
      { kind: "armPhase", activeIndex: 0 }, // 候选拍板归活跃方(resolveHeroPick 授 activePlayer)
    ]);
    writeEngine((e) => e.tryRecruitHero(e.players[0]));
    const scroll = () => docQ(T.heroPickScroll);
    expect(scroll()).not.toBeNull();
    expect(docQ(T.heroPickDecline)?.textContent).toBe("跳过");
    const seekBookButton = () => docQ(TESTIDS.actionButton("seek-book"));
    expect(seekBookButton()?.textContent).toBe("求书");
    const { decisionOptions } = useGameStore.getState().seatView!;
    if (decisionOptions?.kind !== "recruitment") throw new Error("接线测试缺少本席招贤选项");
    patchSeatView({
      decisionOptions: {
        ...decisionOptions,
        options: decisionOptions.options.map((option) =>
          option.id === "seekBook"
            ? { ...option, label: "暂歇求书", available: false, reason: "本次不可求书" }
            : option,
        ),
      },
    });
    expect(seekBookButton()?.hasAttribute("disabled")).toBe(true);
    expect(seekBookButton()?.textContent).toBe("暂歇求书");
    patchSeatView({ decisionOptions });
    const rows = snap().offeredHeroes;
    expect(rows).toHaveLength(3);
    for (let i = 0; i < rows.length; i++) {
      expect(rows[i]!.skillIds.length).toBeGreaterThanOrEqual(1); // 至少一技(预掷明牌)
      const option = q(el, T.heroPickOption(i));
      if (option == null) throw new Error(`接线测试:候选行 ${i} 缺席(卷轴陈列断)`);
      expect(option.querySelectorAll("[data-skill]")).toHaveLength(rows[i]!.skillIds.length);
    }
    // 先看后选(2026-11-01 拍板):点候选将技名 chip=开技能全览弹框,池全貌+未授灰置,
    // 不触发选将(候选不清空、招贤层仍在);浏览语境无「收为麾下」拍板钮
    const mid = rows[1]!;
    const chip = q(el, T.heroPickOption(1))!.querySelector("[data-skill]");
    if (chip == null) throw new Error("接线测试:候选技名 chip 缺席(预掷明牌陈列断)");
    click(chip);
    await settle();
    const glossary = docQ(TESTIDS.skillGlossary);
    if (glossary == null) throw new Error("接线测试:技能全览弹框未挂载(点技名通路断)");
    const pool = heroById(mid.id).skillPool;
    for (const id of pool) expect(docQ(TESTIDS.skillGlossaryRow(id))).not.toBeNull(); // 池全貌逐技在列
    expect(glossary.querySelectorAll(".skg-row.is-off")).toHaveLength(
      pool.length - mid.skillIds.length,
    ); // 未授灰置
    expect(scroll()).not.toBeNull();
    expect(snap().offeredHeroes).toHaveLength(3); // 看将不发命令
    click(docQ(TESTIDS.modalClose)!);
    await finishExit(() => docQ(TESTIDS.skillGlossary), "技能全览应随退场协议卸载");
    // 点卡体同开详情弹框(拍板唯一入口):拍板钮在场 →「收为麾下」→钤印节拍后卷轴
    // 收场、候选清空
    click(q(el, T.heroPickOption(1))!);
    await settle();
    const pick = docQ(TESTIDS.skillGlossaryPick);
    if (pick == null) throw new Error("接线测试:拍板钮缺席(招贤语境 onPick 通路断)");
    click(pick);
    await clock.advance(UI.pickSealMs);
    await finishExit(scroll, "招贤卷轴应随拍板收场(钤印节拍+幽灵帧走完)");
    expect(snap().offeredHeroes).toHaveLength(0); // 候选清空
    expect(engine.players[0].heroes.some((h) => h.heroId === mid.id)).toBe(true); // 入麾下
  });
});

it("战报：阅读旧条目时上方新增，保留原条目及其 DOM 身份", async () => {
  const { writeEngine } = startGame();
  writeEngine((e) => {
    for (let i = 0; i < 100; i++) e.logEvent("system", null, `旧战报 ${i}`, `old=${i}`);
  });
  click(docQ(TESTIDS.settingsButton)!);
  click(docQ(TESTIDS.settingsWarReport)!);
  await settle();

  const list = docQ(TESTIDS.logDrawer)!.querySelector("ul")!;
  const findRow = (brief: string) =>
    Array.from(list.children).find((row) => row.textContent?.endsWith(brief));
  const oldRow = findRow("旧战报 0");
  expect(oldRow).toBeDefined();
  act(() => {
    list.scrollTop = 100;
    list.dispatchEvent(new Event("scroll"));
  });

  writeEngine((e) => e.logEvent("system", null, "新战报", "new"));
  expect(list.firstElementChild!.textContent).toContain("新战报");
  expect(findRow("旧战报 0") === oldRow).toBe(true);
});

describe("珍宝交涉(自 react-scrolls 迁入,#1317 批T3)", () => {
  it("公道买卖：预选后一次成交提交交易命令", async () => {
    // 宽裕横屏仍须在固定操作区显示城池结果,而不是随选宝网格滚走。
    expect(window.innerWidth).toBeGreaterThan(window.innerHeight);
    expect(window.matchMedia(SHORT_LANDSCAPE_QUERY).matches).toBe(false);
    const handles = startGame();
    const sounds = recordAudio();
    const propertyId = plantTrade(handles);
    const { engine, snap } = handles;
    const cityName = engine.board.tiles.find((tile) => tile.propertyId === propertyId)!.name;
    const cityOutcome = `${cityName} +1 级`;
    expect(docQ(T.treasureScroll)).not.toBeNull();
    expect(docQ(T.treasureModeFair)!.textContent).toBe("公道买卖");
    expect(docQ(T.treasureModePremium)!.textContent).toBe("坐地起价");
    click(docQ(T.treasureModeFair)!);
    expect(useGameStore.getState().seatView?.treasure?.mode).toBe("fair");
    expect(sounds).toEqual(["scrollOpen"]);
    const pick = () => docQ(T.treasurePick);
    expect(pick()).not.toBeNull();
    expect(pick()!.textContent).toContain(`成交后${cityOutcome}`);
    expect(pick()!.textContent!.split(cityOutcome)).toHaveLength(2);
    const item = () => docQ(T.treasureItem("seal"))!;
    expect(item()).not.toBeNull();
    // 价签:未选=指导价;指导价单源 core/treasures(不写第二事实源)
    expect(item().textContent).toContain(`指导价 ${formatMoney(guidePriceOf(3))}`);
    const confirm = () => docQ(T.treasureConfirm)!;
    const actionArea = () => q(pick()!, TESTIDS.modalFooter)!;
    expect(actionArea()).not.toBeNull();
    expect(q(pick()!, TESTIDS.modalScrollBody)!.contains(actionArea())).toBe(false);
    expect(actionArea().textContent).toContain(cityOutcome);
    expect(confirm().hasAttribute("disabled")).toBe(true); // 未预选不可成交
    // 点选=金描边上浮:aria-pressed 翻真 + 价签转「成交 · 至 N 两」
    click(item());
    click(item());
    expect(useGameStore.getState().seatView?.treasure?.selectedTreasure?.id).toBe("seal");
    expect(sounds).toEqual(["scrollOpen", "jinnangSelect"]);
    expect(item().getAttribute("aria-pressed")).toBe("true");
    expect(item().textContent).toContain(`成交 · 至 ${formatMoney(guidePriceOf(3))}`);
    expect(actionArea().querySelector('[aria-live="polite"]')!.textContent).toBe(
      `卖出 传国玉玺 · 入账 ${formatMoney(guidePriceOf(3))}`,
    );
    expect(pick()!.textContent!.split(cityOutcome)).toHaveLength(2);
    expect(actionArea().contains(confirm())).toBe(true);
    expect(actionArea().textContent).toContain(cityOutcome);
    expect(snap().turnPhase).toBe("AwaitingTreasureOwner");
    const logLenBefore = engine.log.length;
    click(confirm());
    const cmdLine = engine.log
      .slice(logLenBefore)
      .find((l) => l.category === "cmd" && l.detail.includes("resolveTreasureOwner"));
    if (cmdLine == null) throw new Error("接线测试:resolveTreasureOwner 命令留痕缺席");
    expect(JSON.parse(cmdLine.detail)).toEqual({
      type: "resolveTreasureOwner",
      action: { type: "fair", treasureId: "seal" },
    });
    expect(snap().players[0].properties.find((h) => h.propertyId === propertyId)!.level).toBe(2);
    expect(snap().players[1].treasures.some((t) => t.id === "seal")).toBe(true);
    // 层随结算收口(幽灵帧 210ms 走完;命令留痕已被钉住,层收跟拍不吃竞速)
    await clock.advance(0);
    expect(pick() === null, "选宝层应随结算收口").toBe(true);
    expect(docQ(T.treasureScroll) === null, "交涉卷轴应随结算收场").toBe(true);
  });

  it("满级城公道交易仅预览入账，成交后维持满级", () => {
    const handles = startGame();
    const propertyId = plantTrade(handles, "max");
    const { engine, snap } = handles;
    const maxLevel = engine.catalog.get(propertyId)!.maxLevel;

    click(docQ(T.treasureModeFair)!);
    const pick = docQ(T.treasurePick)!;
    click(docQ(T.treasureItem("seal"))!);
    const summary = pick.querySelector('[aria-live="polite"]')!.textContent!;
    expect(summary).toBe(`卖出 传国玉玺 · 入账 ${formatMoney(guidePriceOf(3))}`);
    expect(pick.textContent).not.toContain("+1 级");
    expect(pick.textContent).not.toContain("满级");

    const logLenBefore = engine.log.length;
    click(docQ(T.treasureConfirm)!);
    const cmdLine = engine.log.slice(logLenBefore).find((line) => line.category === "cmd");
    expect(JSON.parse(cmdLine!.detail)).toEqual({
      type: "resolveTreasureOwner",
      action: { type: "fair", treasureId: "seal" },
    });
    expect(snap().players[0].properties.find((h) => h.propertyId === propertyId)!.level).toBe(
      maxLevel,
    );
    expect(snap().players[1].treasures.some((t) => t.id === "seal")).toBe(true);
  });
});

describe("破产清算卷轴(自 react-scrolls 迁入,#1317 批T3)", () => {
  it("点空白让出棋盘，查城后恢复清算预选且全程无命令", async () => {
    const { el, engine, snap, plant } = startGame([
      { kind: "armPhase", activeIndex: 0 },
      { kind: "setCash", seat: 0, cash: 0 },
      { kind: "giveTreasure", seat: 0, treasures: [makeSkillBook("jixing")] },
    ]);
    const sounds = recordAudio();
    plant({ kind: "armDebt", amount: 1000, creditor: null });
    await settle();
    expect(sounds).toEqual(["scrollOpen"]);

    const commands = engine.log.filter((line) => line.category === "cmd").length;
    const asset = () => docQ(T.bankruptcyAsset("treasure", "skillbook-jixing"))!;
    const assetViewport = () => asset().closest<HTMLElement>('[data-slot="scroll-area-viewport"]');
    const viewport = assetViewport();
    expect(viewport !== null).toBe(true);
    viewport!.scrollTop = 32;
    expect(docQ(TESTIDS.modalBackdrop)).not.toBeNull();
    click(asset());
    expect(sounds).toEqual(["scrollOpen", "jinnangSelect"]);
    click(docQ(TESTIDS.modalBackdrop)!);
    await settle();
    expect(docQ(T.bankruptcyScroll)?.closest("[hidden]") != null).toBe(true);
    expect(document.activeElement === docQ(TESTIDS.modalRestore)).toBe(true);

    click(el.querySelector(TESTIDS.city(0))!);
    await settle();
    expect(docQ(T.tileDetailScroll)).not.toBeNull();
    click(q(docQ(T.tileDetailScroll)!, TESTIDS.modalMinimize)!);
    await settle();
    expect(docQ(T.tileDetailScroll)).toBeNull();

    click(docQ(TESTIDS.modalRestore)!);
    await settle();
    expect(docQ(T.bankruptcyScroll)?.closest("[hidden]") == null).toBe(true);
    expect(assetViewport()?.scrollTop).toBe(32);
    expect(asset().getAttribute("aria-pressed")).toBe("true");
    click(asset());
    expect(snap().pendingDebt?.amount).toBe(1000);
    expect(engine.log.filter((line) => line.category === "cmd")).toHaveLength(commands);
    expect(sounds).toEqual(["scrollOpen", "jinnangSelect"]);
  });

  it("从认破产确认框最小化整栈，恢复确认；新债务换掉已失效的抉择", async () => {
    const { plant, snap, engine } = startGame([
      { kind: "armPhase", activeIndex: 0 },
      { kind: "setCash", seat: 0, cash: 0 },
      { kind: "giveTreasure", seat: 0, treasures: [] },
      { kind: "armDebt", amount: 100, creditor: null },
    ]);
    await settle();
    const commands = engine.log.filter((line) => line.category === "cmd").length;
    const minimizeConfirmation = () => {
      const minimize = q(docQ(T.confirmDialog)!, TESTIDS.modalMinimize);
      expect(minimize).not.toBeNull();
      click(minimize!);
    };

    click(docQ(T.bankruptcyDeclare)!);
    await settle();
    minimizeConfirmation();
    await settle();
    expect(docQ(T.confirmDialog)?.closest("[hidden]") != null).toBe(true);
    expect(docQ(T.bankruptcyScroll)?.closest("[hidden]") != null).toBe(true);

    click(docQ(TESTIDS.modalRestore)!);
    await settle();
    expect(docQ(T.confirmDialog)?.closest("[hidden]") == null).toBe(true);
    minimizeConfirmation();
    await settle();

    plant({ kind: "armDebt", amount: 300, creditor: 1 });
    await settle();
    expect(docQ(TESTIDS.modalRestore)).toBeNull();
    expect(docQ(T.confirmDialog)).toBeNull();
    expect(docQ(T.bankruptcyDebt)?.textContent).toContain(formatMoney(300));
    expect(snap().players[0].isBankrupt).toBe(false);
    expect(engine.log.filter((line) => line.category === "cmd")).toHaveLength(commands);
  });

  it("零资产清算先展示说明,取消认破产保留对局,二次确认才提交出局", async () => {
    const { snap } = startGame([
      { kind: "armPhase", activeIndex: 0 },
      { kind: "setCash", seat: 0, cash: 0 },
      { kind: "giveTreasure", seat: 0, treasures: [] },
      { kind: "armDebt", amount: 100, creditor: null },
    ]);
    await settle();

    expect(snap().players[0].isBankrupt).toBe(false);
    expect((docQ(T.bankruptcyConfirm) as HTMLButtonElement).disabled).toBe(true);
    expect(docQ(T.bankruptcyDeclare)).not.toBeNull();
    click(docQ(T.bankruptcyDeclare)!);
    await settle();
    expect(docQ(T.confirmDialog)).not.toBeNull();
    expect(snap().players[0].isBankrupt).toBe(false);
    click(docQ(T.confirmCancel)!);
    await settle();
    expect(snap().pendingDebt?.amount).toBe(100);

    click(docQ(T.bankruptcyDeclare)!);
    await settle();
    click(docQ(T.confirmOk)!);
    await settle();
    expect(snap().players[0].isBankrupt).toBe(true);
    expect(snap().pendingDebt).toBeNull();
  });

  // 关键接线:预选/数量/翻页不提交,最后有序逐件明细只提交一次清偿。
  it("清算跨页预选保留实物顺序,重复珍宝数量可减到零,足额后只允许减选", async () => {
    const { plant, snap, engine } = startGame();
    const treasures = [
      makeSkillBook("jixing"),
      makeSkillBook("jixing"),
      { id: "qingnang-10", name: "青囊书残卷", level: 5 },
      { id: "qingnang-11", name: "青囊书残卷", level: 5 },
      { id: "hat-12", name: "草帽", level: 1 },
      { id: "hu-13", name: "小斛", level: 3 },
      { id: "lychee-14", name: "新鲜的荔枝", level: 9 },
      { id: "seal-15", name: "传国玉玺", level: 10 },
      { id: "edict-16", name: "带血的诏书", level: 9 },
    ];
    plant({ kind: "giveTreasure", seat: 0, treasures });
    plant({ kind: "setCash", seat: 0, cash: 100 });
    plant({ kind: "armPhase", activeIndex: 0 });
    plant({ kind: "armDebt", amount: 1000, creditor: null });
    const commandCount = engine.log.filter((line) => line.category === "cmd").length;
    const bookQuantity = () => docQ(T.bankruptcyQuantity("skillbook-jixing"))!;
    const viewportSelector = '[data-slot="scroll-area-viewport"]';
    const viewport = bookQuantity().closest<HTMLElement>(viewportSelector);
    expect(viewport !== null).toBe(true);
    expect(docQ(T.bankruptcyDebt)!.closest(viewportSelector) === null).toBe(true);
    expect(docQ(T.bankruptcyNext)!.closest(viewportSelector) === null).toBe(true);
    expect(docQ(T.bankruptcyConfirm)!.closest(viewportSelector) === null).toBe(true);
    click(docQ(T.bankruptcyIncrease("skillbook-jixing"))!);
    expect(bookQuantity().textContent).toBe("1");
    click(docQ(T.bankruptcyDecrease("skillbook-jixing"))!);
    expect(bookQuantity().textContent).toBe("0");
    click(docQ(T.bankruptcyIncrease("qingnang"))!);
    click(docQ(T.bankruptcyIncrease("skillbook-jixing"))!);
    click(docQ(T.bankruptcyIncrease("qingnang"))!);
    expect((docQ(T.bankruptcyIncrease("skillbook-jixing")) as HTMLButtonElement).disabled).toBe(
      true,
    );
    click(docQ(T.bankruptcyDecrease("qingnang"))!);
    viewport!.scrollTop = 32;
    click(docQ(T.bankruptcyNext)!);
    expect(
      docQ(T.bankruptcyAsset("treasure", "edict"))!.closest<HTMLElement>(viewportSelector)
        ?.scrollTop,
    ).toBe(0);
    click(docQ(T.bankruptcyAsset("treasure", "edict"))!);
    click(docQ(T.bankruptcyPrevious)!);
    expect(docQ(T.bankruptcyQuantity("qingnang"))!.textContent).toBe("1");
    expect(bookQuantity().textContent).toBe("1");
    expect(engine.log.filter((line) => line.category === "cmd")).toHaveLength(commandCount);
    expect(snap().players[0].cash).toBe(100);
    expect(snap().players[0].treasures).toHaveLength(treasures.length);

    click(docQ(T.bankruptcyConfirm)!);
    await settle();
    const submitted = engine.log.filter((line) => line.category === "cmd").slice(commandCount);
    expect(submitted.map((line) => JSON.parse(line.detail))).toEqual([
      {
        type: "confirmBankruptcySettle",
        assets: [
          { kind: "treasure", id: "qingnang-10" },
          { kind: "treasure", id: "skillbook-jixing" },
          { kind: "treasure", id: "edict-16" },
        ],
      },
    ]);
    expect(snap().pendingDebt).toBeNull();
    expect(snap().players[0].treasures.map((t) => t.id)).toContain("qingnang-11");
    expect(snap().players[0].treasures.filter((t) => t.id === "skillbook-jixing")).toHaveLength(1);
  });
});

it("设置上的战报最小化后，可逐层关闭诸侯分项和名录并恢复战报滚动", async () => {
  const { el } = startGame();
  click(q(el, TESTIDS.settingsButton)!);
  await settle();
  const settings = docQ(TESTIDS.settingsDialog)!;
  click(q(settings, TESTIDS.settingsWarReport)!);
  await settle();

  expect(docQ(TESTIDS.settingsDialog) === settings).toBe(true);
  const report = () => docQ(TESTIDS.logDrawer)!;
  const list = () => report().querySelector("ul")!;
  list().scrollTop = 72;
  click(q(report().parentElement!, TESTIDS.modalBackdrop)!);
  await settle();
  expect(report().closest("[hidden]")).not.toBeNull();
  expect(settings.closest("[hidden]")).not.toBeNull();

  click(q(el, TESTIDS.topbarOverview)!);
  await settle();
  const overview = docQ(TESTIDS.warlordsOverview)!;
  click(q(overview, TESTIDS.warlordsCities(0))!);
  await settle();
  click(q(docQ(TESTIDS.cityLedger)!, TESTIDS.modalClose)!);
  await finishExit(() => docQ(TESTIDS.cityLedger), "查阅分项关闭");
  expect(docQ(TESTIDS.warlordsOverview) === overview).toBe(true);

  click(q(overview, TESTIDS.modalClose)!);
  await finishExit(() => docQ(TESTIDS.warlordsOverview), "关闭名录回棋盘");
  click(docQ(TESTIDS.modalRestore)!);
  await settle();
  expect(report().closest("[hidden]")).toBeNull();
  expect(list().scrollTop).toBe(72);
  click(report().querySelector('[data-slot="sheet-close"]')!);
  await settle();
  expect(docQ(TESTIDS.logDrawer)).toBeNull();
  expect(docQ(TESTIDS.settingsDialog) === settings).toBe(true);
});

it("对局诊断关闭后回到同一个设置弹层", async () => {
  const { el } = startGame();
  click(q(el, TESTIDS.settingsButton)!);
  await settle();
  const settings = docQ(TESTIDS.settingsDialog)!;
  click(q(settings, TESTIDS.settingsDiagnostic)!);
  await settle();

  expect(docQ(TESTIDS.settingsDialog) === settings).toBe(true);
  click(docQ(GAME_DIAG_TID.dialog)!.querySelector('button[aria-label="关闭"]')!);
  await settle();
  expect(docQ(GAME_DIAG_TID.dialog)).toBeNull();
  expect(docQ(TESTIDS.settingsDialog) === settings).toBe(true);
});

it("从战报看局面时收到交涉抉择，恢复后才显示", async () => {
  const game = startGame([{ kind: "armPhase", activeIndex: 1 }]);
  click(q(game.el, TESTIDS.settingsButton)!);
  await settle();
  click(docQ(TESTIDS.settingsWarReport)!);
  await settle();
  click(q(docQ(TESTIDS.logDrawer)!.parentElement!, TESTIDS.modalBackdrop)!);
  await settle();

  const commands = () => game.engine.log.filter((line) => line.category === "cmd").length;
  const before = commands();
  plantTrade(game);
  await settle();
  expect(game.snap().turnPhase).toBe("AwaitingTreasureOwner");
  expect(docQ(TESTIDS.modalRestore)).not.toBeNull();
  expect(docQ(T.treasureScroll) === null).toBe(true);
  expect(commands()).toBe(before);

  click(docQ(TESTIDS.modalRestore)!);
  await settle();
  expect(docQ(T.treasureScroll)).not.toBeNull();
});

it("看局面时换到下一座位，手牌架自动收起后仍能返回牌面详情", async () => {
  const { el, plant } = startGame([
    { kind: "armPhase", activeIndex: 1, turnPhase: "Roll" },
    { kind: "giveJinnang", seat: 0, cards: ["军情密探"] },
  ]);
  click(q(el, TESTIDS.jinnangToggle)!);
  click(q(el, TESTIDS.jinnangCard("军情密探"))!);
  await settle();
  const detail = docQ(TESTIDS.jinnangDetail)!;
  click(q(detail, TESTIDS.modalMinimize)!);
  await settle();

  plant({ kind: "armPhase", activeIndex: 2 });
  await settle();
  expect(q(el, TESTIDS.jinnangRack) === null).toBe(true);
  expect(docQ(TESTIDS.modalRestore) !== null).toBe(true);

  click(docQ(TESTIDS.modalRestore)!);
  await settle();
  expect(docQ(TESTIDS.jinnangDetail) === detail).toBe(true);
  expect(detail.closest("[hidden]") === null).toBe(true);
});

it("研读选将在临时锁定后可恢复，出牌阶段结束时撤下恢复入口", async () => {
  const book = makeSkillBook("huogong");
  const { el, engine, plant } = startGame([
    { kind: "armHero", seat: 0, heroId: "zhouyu", skillIds: ["yingzi"] },
    { kind: "armHero", seat: 0, heroId: "zhugeliang", skillIds: ["yuli"] },
    { kind: "giveTreasure", seat: 0, treasures: [book] },
    { kind: "armPhase", activeIndex: 0, turnPhase: "AwaitingJinnang" },
  ]);
  click(q(el, TESTIDS.bookUse(book.id))!);
  await settle();
  const learn = () => docQ(TESTIDS.bookLearnModal);
  const sheet = learn()!;
  const pick = q(sheet, TESTIDS.bookLearnItem("zhouyu")) as HTMLButtonElement;
  const confirm = q(sheet, TESTIDS.bookLearnConfirm) as HTMLButtonElement;
  click(pick);
  expect(confirm.disabled).toBe(false);
  const minimize = () => click(q(sheet, TESTIDS.modalMinimize)!);
  minimize();
  await settle();

  patchSeatView({ interactive: false });
  click(docQ(TESTIDS.modalRestore)!);
  await settle();
  expect(learn() === sheet).toBe(true);
  expect(pick.disabled).toBe(true);
  expect(pick.getAttribute("aria-pressed")).toBe("true");
  expect(confirm.disabled).toBe(true);
  click(confirm);
  expect(engine.players[0].heroes[0].skillIds).toEqual(["yingzi"]);

  minimize();
  await settle();

  plant({ kind: "armPhase", activeIndex: 1, turnPhase: "Roll" });
  await settle();
  expect(docQ(TESTIDS.modalRestore)).toBeNull();
  expect(learn() === null).toBe(true);
  expect(engine.players[0].treasures.map((treasure) => treasure.id)).toContain(book.id);
});
