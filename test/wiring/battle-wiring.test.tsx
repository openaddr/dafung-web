// 接线测试(ADR-0062 层④,#1317 批T3):对战决策窗域九例自 e2e 迁入接线层——
// 出牌窗族六例(react-jinnang-use:①识破诡计反应窗点选/取消/落印/窗收牌耗、②不出
// 直发窗放行牌留架、③求贤令点牌→出牌→牌离架、④军情密探目标段两步(#417 点席位选中/
// 再点取消/「出」钮打出)、⑤作罢路径、⑥灰置印条/多标签双章/技能卡双卡与发技转灰置)+
// 反应窗族三例(react-reaction:⑦不用路径、⑧唯反应灰置、⑨降噪口静默代发)。
// 永留浏览器不迁的兄弟例:异将同名(#817 载体装配拍板点名钉)与出牌墨线(rAF 采样端点
// 对准几何)两例归 react-jinnang-use;脊柱③识破自保(mini 签面几何哨 #834)/半路杀出
// 三分支走查/长按开详情(裸指针输入时序)三例归 react-reaction——名册地板,判例见
// ADR-0062 迁移判据。
//
// 【判层理由】判据=ADR-0062 迁移判据,判层只看断言面:①=类名挂点(.reactive/.sel)+
// 按钮启禁+横幅挂载有无+快照手牌/日志真值(窗收牌耗的呈现面);②③⑤=点击→真命令→
// 相位推进→渲染树挂载有无(牌留架/牌离架/选中清空);④=目标段三挂点(候选金圈
// .candidate/棋盘 token 呼吸环节点在场/实金停持 .picked)+确认钮启禁+打出收段;
// ⑥=aria-disabled/灰置类 .off/印条文本/双标签章节点计数/全览弹框行挂点(.is-hl/.is-off)
// +发技转灰置(.off+原因印条);⑦⑨=点击→respondReaction 真命令→横幅卸载+应答留痕
// (reactionRespond use=0)+静默代发零人工点击;⑧=唯反应双牌灰置挂点+印条文案+零命令
// 证伪(相位/手牌不动)。全部「操作过后 store/渲染树里的语义」,零几何零像素零演出泵。
// ⑨降噪口静默状态机判词已下沉 test/reaction-mute.test.ts 纯函数(#1181),本例守的是
// GameScreen 消费侧接线(engage→当窗代发/静默期自动代发/换行动者复显)。
//
// 【渲染装配配方】(模板 = test/wiring/popup-state-wiring.test.tsx #1289 批二 + test/
// jinnang-wiring.test.tsx #1315 批T1 + test/wiring/overview-wiring.test.tsx #1316 批T2;
// 模板四步 + 晚绑红线第 0 条 + 注册控制器第 2.5 步 + 环境缝照抄,本文件差异见
// 「种植单源形」)——本域无表现消费腿:出牌窗/反应窗/目标段全是快照驱动
// (pendingJinnang/pendingReaction),不涉 fxStore 开关态;命中的表现事件
// (jinnangAnnounced/peekApplied/jinnangVoided)留在快照事件批里不消费即无定时器,
// afterEach resetFx 常规清场照惯例保留(邻座文件零泄漏)。
//   0.【晚绑红线】凡「typeof document 求值期捕获」的依赖必须晚于 ensureHappyDom
//      求值(Base UI 全族 useIsoLayoutEffect 求值期定型,静态 import 冻结成 noop、
//      弹层空壳零报错)——GameScreen 全图(含技能全览弹框)与 controller 基类依赖图
//      一律 beforeAll 内 await import 晚绑;@core 纯逻辑(含 planter 种植件)与
//      store/testids(零 DOM 求值期捕获)照旧静态。
//   1. beforeAll ensureHappyDom()(test/wiring/happy-dom-register.ts 局部注册/release 还原);
//   2. 真 GameEngine 直构(loadMap(guanzhong.json)+ createDice(seed)),公共命令走完
//      选都链停 Playing——seed 67=锦囊族既定锚(react-jinnang-use 同源离线核算:人类
//      先手、起手求贤令、开局出牌阶段 AwaitingJinnang 停靠);零时钟零竞速,种下什么
//      相位就停什么相位。
//   2.5. 注册控制器:WiringController(GameController 生产基类最小子型)同模板,
//      dispatchCommand = engine.submitCommand + this.sync;房间编排/传输/看门狗不进
//      接线层(反应窗超时代发=权威侧定时器语义,#1181 已落 test/reaction-watchdog
//      单测;本层窗应答全走人工点击与 UI 自动代发,零看门狗)。
//   3. 基类 sync 灌真 store,act() 内渲染真 GameScreen(生产装配本体,整屏真挂);
//   4. act() 内合成事件(dispatchEvent 冒泡)与断言,testid/类名/DOM 文本/store 状态。
//
// 【种植单源形】(overview-wiring #1321 形制)初始布场与拍间种植一律走 PlantOp 指令
// (applyPlant 单源 @core/planter,与 e2e 桥/单测同一份实现):startGame(ops[]) 开局
// 前逐条落种、plant(op) 拍间补种+resync 重灌——全文件零裸直写,各件判词单源在
// planter 函数头注,本文件不重复。bot 手牌清形(giveJinnang cards:[])与挪城
// (grantProperty)等「终态组合表达」的判词亦在 planter 各族头注。
//
// 【断言宪法】本层禁几何(假 DOM 无排版引擎,getBoundingClientRect 恒 0)、禁像素、
// 禁演出泵与真实时钟;本九例断言面 = testid 有无 / 类名挂点(.reactive/.sel/.off/
// .candidate/.picked/.is-hl/.is-off)/ aria 属性 / 节点计数(双标签章/token 呼吸环/
// 全览行)/ DOM 文本(印条/冷却注/横幅文案)/ store 快照字段与日志行,纯状态挂点。
//
// 【store 隔离】(模板同款)useGameStore/useNetStore 模块单例跨文件纠缠,本文件
// beforeEach/afterEach 成对调用 reset();fxStore 随 afterEach resetFx 清场(本域虽无
// 表现消费,防邻域事件批残留);registry 控制器随 afterEach setController(null) 释放。
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
// bun 测试进程无 Vite define:GameScreen 全图经 SettingsDialog 触达 version.ts,其
// 模块求值读构建期注入的 __APP_VERSION__——按生产同一值源(package.json CalVer)先行
// 注入,晚绑 import 前生效(模板同款,#1297 波评审备案:留置不还原,无害)。
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
import { TESTIDS } from "@app/screens/game/testids";
import { useGameStore, type GameSnapshot } from "@app/store/gameStore";
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
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

/** 有界等待弹层卸载(overview-wiring 同款):退场协议(210ms「播完再移除」)走完
 *  即卸——happy-dom 真定时器自然走时,轮询到位即收,超死线响亮红。判词:卸载后的
 *  「null 断言」必须等协议走完;协议在途就把在场 happy-dom 节点递给 expect,断言
 *  失败路径的 diff 序列化会走节点循环引用(wire3 实锤:bun 序列化爆炸 17GB 死循环,
 *  探针二分定性),waitUnmounted 保证断言吃到的是已卸载后的 null。 */
async function waitUnmounted(query: () => Element | null, label: string): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (query() != null && Date.now() < deadline) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
  }
  expect(query(), label).toBeNull();
}

/** 弹层查询口:技能全览弹框经 Portal 渲染在 body,一律 document 级。 */
const modalQ = (id: string): Element | null => q(document, id);

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
    await waitUnmounted(banner, "落印后窗应随结算收横幅"); // 窗收断言吃已卸载 null(wire3 判词)
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

  // ── ②不出直发(react-jinnang-use 例 2 迁入)──
  // 断言面:「不出」真命令→窗收(动作条卸载)、架常驻牌仍在(不消耗)。放行后自动
  // 行军接棒(#188)=房间编排领域不进接线层(层③),窗收与牌留架的 UI 面照守。
  it("不出直发:窗放行(动作条卸)、牌留架(不消耗)", () => {
    const { el, snap } = startGame([
      { kind: "giveJinnang", seat: 0, cards: ["火烧连营"] }, // 钉任意可留架牌形(终态替换)
      { kind: "armPhase", turnPhase: "AwaitingJinnang" }, // 钉出牌窗(断言前提)
    ]);
    expect(q(document, TESTIDS.actionbar)).not.toBeNull(); // 窗已升起
    click(q(document, TESTIDS.actionbarPass)!);
    expect(q(document, TESTIDS.actionbar)).toBeNull(); // 窗收(卡牌段离场)
    expect(snap().turnPhase).not.toBe("AwaitingJinnang"); // 相位已被真命令推进
    expect(snap().players[0].jinnangHand).toContain("火烧连营"); // 牌未消耗
    expect(q(el, TESTIDS.jinnangCard("火烧连营"))).not.toBeNull(); // 架常驻牌在
  });

  // ── ③求贤令点牌→出牌(react-jinnang-use 例 3 迁入)──
  // 断言面:点牌只选中(出牌点亮)→「出牌」打出→牌离架(消耗的 UI 表达);招贤结算
  // 与战报留痕归 test/jinnang.test.ts(单测已钉,非本层)。
  it("求贤令:点牌→出牌点亮→打出牌离架", () => {
    const { el, snap } = startGame([
      { kind: "giveJinnang", seat: 0, cards: ["求贤令"] },
      { kind: "armPhase", turnPhase: "AwaitingJinnang" },
    ]);
    const card = q(el, TESTIDS.jinnangCard("求贤令"));
    if (card == null) throw new Error("接线测试:求贤令牌钮缺席(手牌种植断)");
    click(card);
    const play = q(document, TESTIDS.actionbarPlay)!;
    // 点牌只选中,出牌点亮(点亮态 aria-disabled 属性缺席=ActionBar 自门控契约)
    expect(play.hasAttribute("aria-disabled")).toBe(false);
    click(play);
    expect(q(el, TESTIDS.jinnangCard("求贤令"))).toBeNull(); // 牌离架(消耗的 UI 表达)
    expect(snap().players[0].jinnangHand).not.toContain("求贤令");
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

  // ── ⑤作罢路径(react-jinnang-use 例 5 迁入)──
  // 断言面:进目标段→「作罢」→收回卡牌段(动作条切回)、选中清空(「出牌」回禁用
  // #751 B1 aria-disabled 自门控)、牌未消耗的 UI 面。不消耗/不记冷却的记账归引擎层
  // 单测(react-jinnang-use 头注 #305 下沉判词随迁)。
  it("军情密探作罢:目标段收回,回卡牌段选中清空、牌未消耗", () => {
    const { el, snap } = startGame([
      { kind: "giveTreasure", seat: 1, treasures: [{ id: "gem-1", name: "夜明珠", level: 5 }] },
      { kind: "giveJinnang", seat: 0, cards: ["军情密探"] },
      { kind: "armPhase", turnPhase: "AwaitingJinnang" },
    ]);
    click(q(el, TESTIDS.jinnangCard("军情密探"))!);
    click(q(document, TESTIDS.actionbarPlay)!);
    expect(q(document, TESTIDS.actionbarTarget)).not.toBeNull();
    // 作罢:目标段收回,回到卡牌段窗态
    click(q(document, TESTIDS.actionbarCancel)!);
    const play = q(document, TESTIDS.actionbarPlay);
    if (play == null) throw new Error("接线测试:作罢后卡牌段未回场(目标段收回断)");
    // 选中已清空(进/出目标段即清空重选);卡牌段禁用=aria-disabled 自门控
    expect(play.getAttribute("aria-disabled")).toBe("true");
    expect(q(el, TESTIDS.jinnangCard("军情密探"))).not.toBeNull(); // 牌回卡牌段
    expect(snap().players[0].jinnangHand).toContain("军情密探"); // 未消耗
    expect(snap().turnPhase).toBe("AwaitingJinnang"); // 相位不动
  });

  // ── ⑥灰置印条/多标签双章/技能卡(react-jinnang-use 例 6 迁入)──
  // 断言面:双标签占额灰置(aria-disabled+灰置类 .off+双章节点+原因印条)、可用对照
  // 牌照常、同将双主动技双卡可辨(主技名大字+载体将名+冷却注读技表+兄弟技/未授被动
  // 不上卡)、技能全览弹框(点主技名开,被点技高亮行+池内未授灰置行+技效全文,无拍板
  // 钮)、点卡体选中→发技→本实例转灰置亮引擎原因(兄弟卡不连坐)。冷却记账归
  // test/hero-skill.test.ts(UI 只读 choices 展示)。种植:双标签占额=setJinnangUsedTags
  // 投影族、麾下=armHero(实授子集显式给定)、bot 城防拉级=grantProperty upsert 改等
  // 级形(火攻可指定前提),判词单源 planter。
  it("灰置印条/多标签双章/技能卡双卡:占额灰置、双卡可辨、发技转灰置", async () => {
    const { el, engine, plant, snap } = startGame([
      { kind: "giveJinnang", seat: 0, cards: ["缓兵之计", "求贤令"] },
      // #1390 周瑜池换血后无「同将双主动技」生产形(各将现役至多一主动):双卡布场改
      // 双将各一主动(周瑜火攻+张星彩擂鼓),池序子集不变量不破(槽 ⊆ 池)
      { kind: "armHero", seat: 0, heroId: "zhouyu", skillIds: ["huogong"] },
      { kind: "armHero", seat: 0, heroId: "zhangxingcai", skillIds: ["leigu"] },
      { kind: "setJinnangUsedTags", tags: ["谋", "攻"] },
      { kind: "armPhase", turnPhase: "AwaitingJinnang" },
    ]);
    // bot 都城拉级(火攻有可毁目标,卡面可用;开局各座唯都城 Lv0,upsert 改等级形)
    const botCapitals = engine.players
      .slice(1)
      .map((p) => engine.board.at(p.capitalIndex).propertyId);
    for (let seat = 1; seat <= botCapitals.length; seat++)
      plant({ kind: "grantProperty", seat, propertyId: botCapitals[seat - 1]!, level: 1 });
    // 灰置牌:aria-disabled+灰置类+双标签章竖排+原因印条;可用对照组牌照常
    const huan = q(el, TESTIDS.jinnangCard("缓兵之计"));
    if (huan == null) throw new Error("接线测试:缓兵之计牌钮缺席(手牌种植断)");
    expect(huan.getAttribute("aria-disabled")).toBe("true");
    expect(hasClass(huan.querySelector(".jinnang-card")!, "off")).toBe(true);
    expect(huan.querySelectorAll(".seal")).toHaveLength(2); // 多标签:谋+攻 章竖排双挂
    expect(huan.querySelector(".reason")!.textContent).toBe("本回合已用过〔谋〕〔攻〕");
    const qiuxian = q(el, TESTIDS.jinnangCard("求贤令"));
    if (qiuxian == null) throw new Error("接线测试:求贤令牌钮缺席(可用对照组断)");
    expect(qiuxian.hasAttribute("aria-disabled")).toBe(false); // 可用牌无禁用宣告
    // 名将技能卡(#818 形制:技能为维度、名将为载体):同将双主动技=双卡,卡面=载体+
    // 主技名大字;testid=选项 id 实例形状 skill:<heroId>:<skillId>(#817)
    const huo = q(el, TESTIDS.jinnangCard("skill:zhouyu:huogong"));
    const lei = q(el, TESTIDS.jinnangCard("skill:zhangxingcai:leigu"));
    if (huo == null || lei == null) throw new Error("接线测试:技能卡缺席(armHero→choices 装配断)");
    const huoFace = huo.querySelector(".hface")!;
    const leiFace = lei.querySelector(".hface")!;
    expect(huoFace.textContent).toContain("火攻");
    expect(huoFace.textContent).toContain("周瑜"); // 载体将名
    expect(huoFace.querySelector(".cd")!.textContent).toBe("冷却 5 轮"); // 冷却注(技表单源)
    expect(huoFace.textContent).not.toContain("擂鼓"); // 兄弟卡技不上卡
    expect(huoFace.textContent).not.toContain("英姿"); // 未授静态被动不上卡
    expect(leiFace.textContent).toContain("擂鼓");
    expect(leiFace.textContent).not.toContain("火攻");
    // 技能全览(#605):点主技名=开全览弹框(不选中)——被点技高亮行、池内未授灰置行、
    // 技效描述全文在场;浏览语境无「收为麾下」拍板钮;关闭后卡体照常可选中
    const chip = huo.querySelector('[data-skill="huogong"]');
    if (chip == null) throw new Error("接线测试:主技名章缺席(技能卡装配断)");
    click(chip);
    await settle();
    const glossary = modalQ(TESTIDS.skillGlossary);
    if (glossary == null) throw new Error("接线测试:技能全览弹框未挂载(点主技名通路断)");
    expect(modalQ(TESTIDS.skillGlossaryPick)).toBeNull(); // 浏览语境:无拍板钮(缺席,断言吃到 null)
    expect(hasClass(modalQ(TESTIDS.skillGlossaryRow("huogong"))!, "is-hl")).toBe(true);
    expect(hasClass(modalQ(TESTIDS.skillGlossaryRow("yingzi"))!, "is-off")).toBe(true); // 池内未授
    expect(glossary.textContent).toContain("此面值递增1"); // 池内技描述全文(卡面上无描述)
    // 关闭:X→退场协议(210ms「播完再移除」)走完即卸——有界等待(happy-dom 真定时器
    // 自然走时);协议在途时节点仍在场,「卸载后断言吃到 null」才安全(在场元素进
    // expect 会触发序列化循环引用爆炸,见 waitUnmounted 判词)。
    click(modalQ(TESTIDS.modalClose)!);
    await waitUnmounted(() => modalQ(TESTIDS.skillGlossary), "技能全览应随退场协议卸载");
    // 点卡体=选中(主技名点击不触发选中的分流在 skillIdFromClick)→「出牌」打出
    click(lei);
    expect(hasClass(leiFace, "sel")).toBe(true);
    click(q(document, TESTIDS.actionbarPlay)!);
    // 发技 → 本实例卡转灰置亮引擎原因;兄弟卡不连坐(相位留在出牌阶段态)
    expect(hasClass(leiFace, "off")).toBe(true);
    expect(lei.querySelector(".reason")!.textContent).toBe("冷却中(还差 4 轮)");
    expect(hasClass(huoFace, "off")).toBe(false);
    expect(snap().turnPhase).toBe("AwaitingJinnang");
  });
});

describe("反应窗应答接线(自 react-reaction 迁入,#1317 批T3)", () => {
  // ── ⑦不用路径(react-reaction 例 3 迁入;#1389 结算改防御值制)──
  // 断言面:点「不用」单发命令应答→窗收+use=0 留痕+火烧真结算随行(受击城=溅射中心,
  // 恰受 1 点火焰伤害,引擎同拍;城损细则归 test/reaction-window.test.ts)。种植:受击城
  // =grantProperty(自机名下 Lv1,择址判词见 plantableCityTile),判词单源 planter。
  it("不用路径:点「不用」立即应答→窗收留痕(use=0),火烧结算随行", async () => {
    const { engine, plant, snap } = startGame([{ kind: "armPhase", activeIndex: 1 }]);
    // 受击城:自机名下恰一座 Lv1 城(中心恰受 1 点=确定性;旧「随机降级」结算已退役)
    const { tileIndex, propertyId } = plantableCityTile(engine);
    plant({ kind: "grantProperty", seat: 0, propertyId, level: 1 });
    for (const op of huoshaoWindow(1, tileIndex)) plant(op);
    expect(q(document, TESTIDS.reactionBanner)).not.toBeNull(); // 窗已升起
    click(q(document, TESTIDS.reactionDecline)!);
    // 窗收+留痕:权威侧 use=0 应答(reactionRespond);结算随行=中心受 1 点火焰伤害
    //(Lv1 满防 4→3,等级不动)
    await waitUnmounted(
      () => q(document, TESTIDS.reactionBanner),
      "不用后窗应随结算收横幅", // 窗收断言吃已卸载 null(wire3 判词)
    );
    expect(snap().turnPhase).not.toBe("AwaitingReaction");
    const log = snap()
      .log.map((l) => l.detail)
      .join("\n");
    expect(log).toContain("reactionRespond");
    expect(log).toContain("use=0");
    const holding = engine
      .findOwner(propertyId)!
      .properties.find((h) => h.propertyId === propertyId)!;
    expect(holding.defense).toBe(3);
    expect(holding.level).toBe(1);
  });

  // ── ⑧唯反应灰置(react-reaction 例 5 迁入)──
  // 断言面:出牌窗内两张反应牌皆灰置(aria-disabled+灰置类+唯反应原因印条)不入可用
  // 集;未选牌点「出牌」零命令通路(相位/手牌不动);「不出」放行窗照常收(相位推进)。
  // 放行后自动起摇(#188)=房间编排领域不进接线层(层③)。
  it("出牌阶段「唯反应」:两张反应牌皆灰置不入可用集,放行窗照常收", () => {
    const { el, snap } = startGame([
      { kind: "giveJinnang", seat: 0, cards: ["识破诡计", "半路杀出"] },
      { kind: "armPhase", turnPhase: "AwaitingJinnang" },
    ]);
    const shipo = q(el, TESTIDS.jinnangCard("识破诡计"));
    const banlu = q(el, TESTIDS.jinnangCard("半路杀出"));
    if (shipo == null || banlu == null)
      throw new Error("接线测试:唯反应手牌缺席(giveJinnang 终态替换断)");
    for (const card of [shipo, banlu]) {
      expect(card.getAttribute("aria-disabled")).toBe("true");
      expect(hasClass(card.querySelector(".jinnang-card")!, "off")).toBe(true);
      expect(card.querySelector(".reason")!.textContent).toBe("唯反应(反应窗打出)");
    }
    // 未选牌点「出牌」:零命令通路(自门控回执,相位/手牌不动)
    click(q(document, TESTIDS.actionbarPlay)!);
    expect(snap().turnPhase).toBe("AwaitingJinnang");
    expect(snap().players[0].jinnangHand).toEqual(["识破诡计", "半路杀出"]);
    // 「不出」放行:窗照常收(相位推进,唯反应手牌不拦决策通路)
    click(q(document, TESTIDS.actionbarPass)!);
    expect(q(document, TESTIDS.actionbar)).toBeNull();
    expect(snap().turnPhase).not.toBe("AwaitingJinnang");
  });

  // ── ⑨降噪口(react-reaction 例 6 迁入;#1389 结算改防御值制)──
  // 断言面:第一道窗点「本回合不再询问」→当窗立即代发不用+横幅即收;同一行动者的第二
  // 道窗零人工点击被静默自动代发(应答计数 2=第二份必出自静默代发;静默状态机判词已
  // 下沉 test/reaction-mute.test.ts 纯函数);行动者变更(armPhase 换座)静默解除,第三
  // 道窗横幅恢复弹出→点「不用」收尾。种植:每窗恰一座受击城(溅射中心恰受 1 点=确定性,
  // 各窗即时断言本窗中心的防御落账)、窗载荷 armReaction、行动者切换 armPhase(判词
  // 单源 planter)。
  it("降噪口:当窗代发+同行动者后续窗静默代发(零点击)+换行动者复显", async () => {
    const { engine, plant, snap } = startGame([{ kind: "armPhase", activeIndex: 1 }]);
    // 受击城种植器:自机名下再添一座 Lv1 城(择址判词见 plantableCityTile;exclude=已
    // 入用的城,多窗不重城)
    const used = new Set<string>();
    const plantCity = (): { tileIndex: number; propertyId: string } => {
      const spot = plantableCityTile(engine, used);
      used.add(spot.propertyId);
      plant({ kind: "grantProperty", seat: 0, propertyId: spot.propertyId, level: 1 });
      return spot;
    };
    const banner = () => q(document, TESTIDS.reactionBanner);
    const respondCount = () =>
      snap().log.filter((l) => l.detail.includes("reactionRespond")).length;
    const defenseOf = (pid: string): number =>
      engine.findOwner(pid)!.properties.find((h) => h.propertyId === pid)!.defense;
    // 第一道窗:点降噪口=当前窗立即「不用」+本回合静默(中心受 1 点:满防 4→3)
    const city1 = plantCity();
    for (const op of huoshaoWindow(1, city1.tileIndex)) plant(op);
    expect(banner()).not.toBeNull();
    click(q(document, TESTIDS.reactionMute)!);
    await waitUnmounted(banner, "降噪后代发应即收横幅"); // 窗收断言吃已卸载 null(wire3 判词)
    expect(respondCount()).toBe(1);
    expect(defenseOf(city1.propertyId)).toBe(3); // 结算随代发落地(本窗即时拍)
    // 第二道窗(同一行动者途经):零人工点击——静默期自动代发「不用」(接线=消费侧
    // useEffect 依窗实例号代发;状态机判词单源 reaction-mute.test)
    const city2 = plantCity();
    for (const op of huoshaoWindow(1, city2.tileIndex)) plant(op);
    await waitUnmounted(banner, "静默期横幅不应弹出"); // 静默:横幅不弹(判词同上)
    expect(snap().turnPhase).not.toBe("AwaitingReaction"); // 自动代发后窗已收
    expect(respondCount()).toBe(2); // 两份应答、一次点击=第二份必出自静默代发
    expect(defenseOf(city2.propertyId)).toBe(3); // 第二窗结算亦随代发落地(本窗即时拍)
    // 行动者变更:静默解除(边沿清空)——第三行动者的窗横幅恢复弹出;无主 <4 城格已
    // 耗尽(两座已入用)→ 第三城取自机都城(grantProperty upsert 只升等级,易主不发生)
    plant({ kind: "armPhase", activeIndex: 2 });
    const capTile = engine.players[0].capitalIndex;
    const capPid = engine.board.tiles[capTile]!.propertyId!;
    plant({ kind: "grantProperty", seat: 0, propertyId: capPid, level: 1 });
    for (const op of huoshaoWindow(2, capTile)) plant(op);
    expect(banner()).not.toBeNull();
    click(q(document, TESTIDS.reactionDecline)!); // 收尾放行,不留悬窗
    await waitUnmounted(banner, "收尾放行后窗应收横幅"); // 窗收断言吃已卸载 null(wire3 判词)
    expect(respondCount()).toBe(3);
    expect(defenseOf(capPid)).toBe(3); // 第三窗结算落地(本窗即时拍)
    expect(city1.propertyId).not.toEqual(city2.propertyId); // 三窗不重城自证(选址器 exclude)
  });
});
