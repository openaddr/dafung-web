// 关键接线:真实组件与控制器验证命令/状态或私密信息通路,不验证几何和演出。
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
// bun 测试进程无 Vite define:GameScreen 全图经 SettingsDialog 触达 version.ts,其
// 模块求值读构建期注入的 __APP_VERSION__——按生产同一值源(package.json CalVer)先行
// 注入,晚绑 import 前生效(模板同款,#1297 波评审备案:留置不还原,无害)。
import { useFxStore } from "@app/fx/fxStore";
import { GHOST } from "@app/fx/timings";
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

const guanzhongData = rawGuanzhongData as MapData; // JSON 导入 tier 丢字面量,cast 同 map-storage-wiring #1316 形
const MAP = loadMap(guanzhongData);
const SEED = 67; // 锦囊族既定锚(react-jinnang-use 同源:开局出牌阶段停靠)

/** 座位表:与模板同(solo 口径 seat 0 = 自机)。 */
const SEATS: SeatConfig[] = [
  { name: "座 1", isBot: false, guohao: "魏" },
  { name: "座 2", isBot: true },
  { name: "座 3", isBot: true },
  { name: "座 4", isBot: true },
];

/** 种引擎到 Playing 停靠(公共命令链,模板 seedPlayingEngine 同款;非法态当场
 *  抛错不静默)。seed 67 落点:开局出牌阶段态(turnPhase=AwaitingJinnang、手各 1)。 */
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

/** 种局→种植→注册控制器→基类 sync 灌 store→挂屏(每例开头同款一条龙)。
 *  ops = 初始布场指令(PlantOp 单源逐条落种,判词见头注「种植单源形」)。 */
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

/** 类名挂点整词判定(className 空白分词恒等比较——「sel」这类短词不吃子串误伤)。 */
function hasClass(el: Element, cls: string): boolean {
  return el.className.split(/\s+/).includes(cls);
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
  await clock.settle();
}

/** 推进退场出口后断卸载;布尔断言避免失败时序列化 happy-dom 循环节点。 */
async function finishExit(query: () => Element | null, label: string): Promise<void> {
  await clock.advance(GHOST.frameMs);
  expect(query() == null, label).toBe(true);
}

/** 火烧连营窗种植(识破应答/不用路径/降噪口三例共用的反应窗形):userSeat=bot 真打出
 *  形,目标=受击城 tileIndex(城指向域,#1389——view.targetSeats 与 payload.targets 均
 *  为城格清单),被询问=仅自机(窗应答即本例人工链,bot 零牵涉)。 */
function huoshaoWindow(userSeat: number, cityTile: number): PlantOp[] {
  return [
    {
      kind: "armReaction",
      view: {
        kind: "jinnang",
        cardId: "火烧连营",
        userSeat,
        targetSeats: [cityTile],
        queriedBySeat: [0],
        windowMs: 30000,
      },
      payload: { kind: "jinnang", userSeat, cardId: "火烧连营", targets: [cityTile] },
    },
  ];
}

/** 受击城选址(接线种植地形约束):取「无主且 tileIndex<4」的首座城。无主=多窗判词
 *  需要(免烧行「无主,免于火焰」);上界 4 为既有断言的城名锚稳定保留——历史约束
 *  (planter 公开面把 targetSeats 当座位断言、城格须 <席位数)已随 #1389/#1395 城份
 *  域感知改走棋盘界,不再生效。exclude=已入用的城(多窗不重城)。 */
function plantableCityTile(
  engine: GameEngine,
  exclude: ReadonlySet<string> = new Set(),
): { tileIndex: number; propertyId: string } {
  const owned = new Set(engine.players.flatMap((p) => p.properties.map((h) => h.propertyId)));
  const tileIndex = engine.board.tiles.findIndex(
    (t) => t.propertyId != null && !owned.has(t.propertyId) && !exclude.has(t.propertyId),
  );
  if (tileIndex < 0 || tileIndex >= 4)
    throw new Error("接线测试:可种植城格缺席(择址判词=无主且 tileIndex<4,前提失真)");
  const propertyId = engine.board.tiles[tileIndex]!.propertyId!;
  return { tileIndex, propertyId };
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
  await settle();
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

describe("出牌窗交互链(自 react-jinnang-use 迁入,#1317 批T3)", () => {
  // ── ①识破诡计反应窗应答(react-jinnang-use 例 1 迁入;#1389 城指向域改走选份流程)──
  // 断言面:架上金边(.reactive)→点牌选中(.sel)→未选份=落印禁用(城指向域确认钮
  // 自门控,与 all-others 同形,#1389 新拍)→点城份令牌选中(aria-pressed,令牌=城名)
  // →落印点亮→再点令牌取消(选中可逆)→重选牌+份落印确认→窗收+牌离手(识破消耗)
  // +留痕(reactionRespond use=1 share=<城格> / reactionCounter)。识破结算(受击城免烧)
  // 是引擎同拍真结算;窗载荷经 armReaction 种植(判词单源 planter:反应窗由持牌+时机
  // 判定产生,凭空开窗无公共命令);bot 手牌清形防识破链环(被询问集=持 counter 牌者,
  // seed 67 起手随机可能含识破诡计——giveJinnang 终态组合表达「去指定牌」,判词同
  // e2e #1301)。
  it("识破诡计:架上金边→点选/未选份禁用/选城份→落印→窗收牌耗+留痕", async () => {
    const { el, engine, plant, snap } = startGame([
      { kind: "giveJinnang", seat: 0, cards: ["识破诡计"] },
      { kind: "giveJinnang", seat: 1, cards: [] },
      { kind: "giveJinnang", seat: 2, cards: [] },
      { kind: "giveJinnang", seat: 3, cards: [] },
    ]);
    // 受击城与窗体拍间种植(择址/窗形判词见 plantableCityTile·huoshaoWindow 头注;
    // 城名断言查板,不落数值第二源)。识破候选=有主受击城(引擎开窗侧已滤无主/免疫,
    // jinnang-execution shareSeats 判词)——受击城须先入自机名下,凭空无主城进窗会踩
    // settle「受击城恒有主」断言(测试前提失真,非引擎缺口)。
    const { tileIndex, propertyId } = plantableCityTile(engine);
    plant({ kind: "grantProperty", seat: 0, propertyId, level: 1 });
    plant({ kind: "armPhase", activeIndex: 1 }); // bot 行动方回合内打出的窗(e2e 同形)
    for (const op of huoshaoWindow(1, tileIndex)) plant(op);
    const cityName = engine.board.at(tileIndex).name;
    const banner = () => q(document, TESTIDS.reactionBanner);
    expect(banner()).not.toBeNull(); // 窗已升起(停车坪自证)
    expect(banner()!.textContent).toContain(`使用【火烧连营】(对 ${cityName})`); // 目标括注=城名(#1389)
    const card = () => q(el, TESTIDS.jinnangCard("识破诡计"))!;
    // 反应窗槽的呼吸金边/选中实金挂按钮本体(.reactive/.sel,HandRack 反应槽形;
    // 出牌窗槽的 .off 才在 .jinnang-card 画心,两槽形制不同勿混)
    expect(hasClass(card(), "reactive")).toBe(true);
    const confirm = () => q(document, TESTIDS.reactionConfirm)!;
    expect(confirm().hasAttribute("disabled")).toBe(true); // 未选牌落印禁用
    // 点牌=选中(.sel);城指向域还须选份,未选份落印仍禁用(自门控,#1389 新拍)
    click(card());
    expect(hasClass(card(), "sel")).toBe(true);
    expect(confirm().hasAttribute("disabled")).toBe(true);
    // 城份令牌(testid=reaction-seat-<城格>):点令牌=选中(aria-pressed)→落印点亮;
    // 再点同令牌=取消→回禁用(#417 选中可逆同口径)
    const chip = () => q(document, TESTIDS.reactionSeat(tileIndex))!;
    expect(chip().textContent).toContain(cityName); // 份令牌以城名呈现
    click(chip());
    expect(chip().getAttribute("aria-pressed")).toBe("true");
    expect(confirm().hasAttribute("disabled")).toBe(false);
    click(chip());
    expect(chip().getAttribute("aria-pressed")).toBe("false");
    expect(confirm().hasAttribute("disabled")).toBe(true);
    // 牌取消可逆(原拍保留):再点同牌=取消→回禁用;重选后份已清,仍须重选份
    click(card());
    expect(hasClass(card(), "sel")).toBe(false);
    click(card());
    expect(hasClass(card(), "sel")).toBe(true);
    click(chip());
    click(confirm());
    await finishExit(banner, "落印后窗应随结算收横幅"); // 窗收断言吃已卸载 null(wire3 判词)
    expect(snap().players[0].jinnangHand).not.toContain("识破诡计"); // 牌耗(离手)
    const log = snap()
      .log.map((l) => l.detail)
      .join("\n");
    expect(log).toContain("reactionRespond");
    expect(log).toContain("use=1");
    expect(log).toContain(`share=${tileIndex}`); // 城份随确认链过帐(tileIndex 语义,#1389)
    expect(log).toContain("reactionCounter"); // 识破留痕(bot 零 counter 牌=链即站住)
    // 受击城免烧:防御满值不动(Lv1 满防 4,#1386 防御值口径)
    const holding = engine
      .findOwner(propertyId)!
      .properties.find((h) => h.propertyId === propertyId)!;
    expect(holding.defense).toBe(4);
  });

  // ── ④军情密探目标段两步(react-jinnang-use 例 4 迁入)──
  // 断言面:出牌进目标段(确认钮引导态禁用+候选席位 .candidate 金圈+棋盘 token 呼吸
  // 环节点在场)→点席位选中(.picked,「出」点亮)→再点取消→三点重选→「出」确认打出
  // (目标段收+牌离架)。窥探结算与回收记账归 test/jinnang.test.ts(单测已钉)。
  // 种植:军情密探目标门槛=对方有珍宝(giveTreasure 终态替换,判词单源 planter)。
  it("军情密探:出牌进目标段,点席位选中/再点取消,#417 「出」钮打出", () => {
    const { el, snap } = startGame([
      { kind: "giveTreasure", seat: 1, treasures: [{ id: "gem-1", name: "夜明珠", level: 5 }] },
      { kind: "giveJinnang", seat: 0, cards: ["军情密探"] },
      { kind: "armPhase", turnPhase: "AwaitingJinnang" },
    ]);
    const opt = q(el, TESTIDS.jinnangCard("军情密探"));
    if (opt == null) throw new Error("接线测试:军情密探牌钮缺席(手牌种植断)");
    click(opt);
    click(q(document, TESTIDS.actionbarPlay)!);
    // 目标段:确认钮「选择目标」引导态禁用;候选席位金圈 + 棋盘 token 呼吸环节点在场
    const confirm = () => q(document, TESTIDS.actionbarTarget)!;
    expect(confirm().hasAttribute("disabled")).toBe(true);
    expect(hasClass(q(el, TESTIDS.seat(1))!, "candidate")).toBe(true);
    expect(el.querySelectorAll(".bv-token-target-ring").length).toBeGreaterThan(0);
    // 点席位=选中(.picked 实金停持)→「出」点亮;再点=取消→回禁用
    const selfTarget = () => q(el, TESTIDS.seatTarget(1))!;
    click(selfTarget());
    expect(hasClass(q(el, TESTIDS.seat(1))!, "picked")).toBe(true);
    expect(confirm().hasAttribute("disabled")).toBe(false);
    click(selfTarget());
    expect(hasClass(q(el, TESTIDS.seat(1))!, "picked")).toBe(false);
    expect(confirm().hasAttribute("disabled")).toBe(true);
    // 三点重选 → 「出」确认打出:目标段收、牌离架
    click(selfTarget());
    click(confirm());
    expect(q(document, TESTIDS.actionbarTarget)).toBeNull();
    expect(q(el, TESTIDS.jinnangCard("军情密探"))).toBeNull();
    expect(snap().players[0].jinnangHand).not.toContain("军情密探");
  });
});
