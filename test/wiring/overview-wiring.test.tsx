// 接线测试(ADR-0062 层④,#1316 批T2):总览/席位域七例自 e2e 迁入接线层——
// 席位格四例(react-seat-cells:①4 席计数对账 cellsMatchSnapshot 语义/②五状态+自机
// 挂点/③托管常驻微标开关/④目标段候选与停持)+ 诸侯详情三例(react-warlords-overview:
// ⑤四元素钻入单层互斥/⑥状态挂点/⑦十列行数据语义腿)。
//
// 【判层理由】判据=ADR-0062 迁移判据,判层只看断言面:①=渲染树 testid 文本与 store
// 快照逐席原子对账+节点计数(一人一格);②③④=类名挂点(.active/.self/.low/.bankrupt/
// .candidate/.picked)+aria 属性+DOM 有无(微标/目标段),点击→命令→store→渲染树接线;
// ⑤=点击→弹层单层互斥切换+明细文本(钻入链全部 DOM 有无与文本);⑥=行状态类挂点
// (.self/.dead/.is-active)+数值文本;⑦=行数据逐字对照(chips/slot/题名/Esc 关闭,
// 全 DOM 结构与文本)。零几何零像素零演出泵——⑦刻意不含声列概率条 getBoundingClientRect
// 宽度比与满编 8 行几何(几何腿留浏览器壳例,切腿判词见 e2e spec 与分类表行注)。
//
// 【渲染装配配方】(模板 = test/wiring/popup-state-wiring.test.tsx #1289 批二 + test/
// jinnang-wiring.test.tsx #1315 批T1;模板四步 + 晚绑红线第 0 条 + 注册控制器第 2.5 步
// + 环境缝照抄,本文件差异见「种植单源形」与「托管回读缝」)
//   0.【晚绑红线】凡「typeof document 求值期捕获」的依赖必须晚于 ensureHappyDom
//      求值(Base UI 全族 useIsoLayoutEffect 求值期定型,静态 import 冻结成 noop、
//      弹层空壳零报错)——GameScreen 全图(含 WarlordsOverview/CityLedgerModal/
//      SeatAttrModals/SettingsDialog 弹层族)与 controller 基类依赖图一律 beforeAll
//      内 await import 晚绑;@core 纯逻辑(含 planter 种植件/tierShares)与 store/
//      testids(零 DOM 求值期捕获)照旧静态。
//   1. beforeAll ensureHappyDom()(test/wiring/happy-dom-register.ts 局部注册/release 还原);
//   2. 真 GameEngine 直构(loadMap(guanzhong.json)+ createDice(seed)),公共命令走完
//      选都链停 Playing——零时钟零竞速,种下什么相位就停什么相位;种子 1486=模板既定锚,
//      67=锦囊族既定锚(开局出牌阶段停靠,目标段例同 jinnang-wiring ⑧ 同源)。
//   2.5. 注册控制器:WiringController(GameController 生产基类最小子型)同模板,
//      dispatchCommand = engine.submitCommand + this.sync;本文件增「托管回读缝」(下)。
//   3. 基类 sync 灌真 store,act() 内渲染真 GameScreen(生产装配本体,整屏真挂);
//   4. act() 内合成事件(dispatchEvent 冒泡)与断言,testid/类名/DOM 文本/store 状态。
//
// 【种植单源形】(本文件相对模板的形制收敛)初始布场与拍间种植一律走 PlantOp 指令
// (applyPlant 单源 @core/planter,与 e2e 桥/单测同一份实现):startGame(ops[]) 开局
// 前逐条落种、plant(op) 拍间补种+resync 重灌——全文件零裸直写,各件判词单源在
// planter 函数头注,本文件不重复(#1321 force 退役后的接线层种植单源 API)。
//
// 【托管回读缝】(③托管微标例专用)基类契约单源(controller.ts 头注):单机托管生效态
// =「本地标记回读」(LocalController.autoPilotOn 读房间会话 autoPilot 集,房间 WS 中转
// 是层③传输领域不进接线层)——WiringController 同契约直达实现:setAutoPilot 翻本地
// 标记 + sync 重渲(useAutopilotOn 单机取值源=controller.autoPilotOn,netStore.roomId
// 空即走此源)。e2e 的 aria-checked 广播回读轮询配方是负载丢拍 armor(非断言面),
// 接线层同拍即达不需 armor;微标本体(hosted 齿轮 DOM 有无)与开关交互链照守。
//
// 【断言宪法】本层禁几何(假 DOM 无排版引擎,getBoundingClientRect 恒 0)、禁像素、
// 禁演出泵与真实时钟;本七例断言面 = testid 有无 / 类名挂点(.active/.self/.low/
// .bankrupt/.candidate/.picked/.zl-empty/.zl-full/.zl-more)/ DOM 文本与节点计数 /
// store 快照字段,纯状态挂点。
//
// 【store 隔离】(模板同款)useGameStore/useNetStore 模块单例跨文件纠缠,本文件
// beforeEach/afterEach 成对调用 reset();registry 控制器随 afterEach setController(null)
// 释放。localStorage 本族零消费(无存储语义断言面)。
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
// bun 测试进程无 Vite define:GameScreen 全图经 SettingsDialog 触达 version.ts,其
// 模块求值读构建期注入的 __APP_VERSION__——按生产同一值源(package.json CalVer)先行
// 注入,晚绑 import 前生效(模板同款,#1297 波评审备案:留置不还原,无害)。
import pkg from "../../package.json";
(globalThis as Record<string, unknown>).__APP_VERSION__ = pkg.version;
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import guanzhongData from "../../public/maps/guanzhong.json";
import { loadMap } from "@core/board-loader";
import { tileIndexOfProperty } from "@core/board";
import { GameEngine, type GameCommand, type SeatConfig } from "@core/authority";
import { createDice } from "@core/dice";
import { tierShares } from "@core/encounters";
import { heroById, HEROES } from "@core/heroes";
import { applyPlant, type PlantOp } from "@core/planter";
import { TESTIDS } from "@app/screens/game/testids";
import { useGameStore, type GameSnapshot } from "@app/store/gameStore";
import { useNetStore } from "@app/store/netStore";
import { ensureHappyDom, releaseHappyDom } from "./happy-dom-register";
import { GHOST } from "@app/fx/timings";
import { installControlledClock } from "./controlled-clock";

/** 晚绑模块型(late binding,红线见头注第 0 步;type-of-import 类型面静态引用,
 *  求值面零触碰,不破晚绑)。 */
type GameScreenModule = typeof import("@app/screens/game/GameScreen");
type RegistryModule = typeof import("@app/controllers/registry");
type GameControllerClass = import("@app/controllers/controller").GameController;
let GameScreen: GameScreenModule["GameScreen"];
let setController: RegistryModule["setController"];

/** 接线控制器面(GameController 生产基类的最小子型 + resync 测试口 + 托管回读缝,
 *  构造见 beforeAll)。 */
type WiringController = GameControllerClass & { resync(): void };
let newWiringController: (e: GameEngine) => WiringController;

const MAP = loadMap(guanzhongData);
const SEED = 1486; // 模板既定锚(react-seat-cells 计数例 e2e quickStart 同源)
const SEED_JUNSHI = 67; // 锦囊族既定锚:开局出牌阶段停靠(目标段例,jinnang-wiring ⑧ 同源)

/** 座位表:与模板同(solo 口径 seat 0 = 自机)。 */
const SEATS: SeatConfig[] = [
  { name: "座 1", isBot: false, guohao: "魏" },
  { name: "座 2", isBot: true },
  { name: "座 3", isBot: true },
  { name: "座 4", isBot: true },
];

/** 种引擎到 Playing 停靠(公共命令链,模板 seedPlayingEngine 同款;非法态当场
 *  抛错不静默)。 */
function seedPlayingEngine(seed = SEED): GameEngine {
  const e = new GameEngine(MAP.board, MAP.catalog, createDice(seed), {
    seats: SEATS,
    targetNetWorth: MAP.targetNetWorth,
    startingCash: MAP.startingCash,
    startingTreasures: MAP.startingTreasures,
    seed,
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
 *  ops = 初始布场指令(PlantOp 单源逐条落种,判词见头注「种植单源形」)。
 *  engine 一并交出:期望值逐字核算要读进程内引擎(board/目录/玩家行,与 e2e
 *  __dafung 桥读引擎同语义,种植判词真源)。 */
function startGame(
  ops: PlantOp[] = [],
  seed = SEED,
): {
  el: HTMLElement;
  engine: GameEngine;
  plant: (op: PlantOp) => void;
  snap: () => GameSnapshot;
} {
  const e = seedPlayingEngine(seed);
  for (const op of ops) applyPlant(e, op);
  const c = newWiringController(e);
  setController(c);
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

/** Esc 关闭(Base UI 底件 document 级 keydown 监听;act 内派发)。 */
function pressEscape(): void {
  act(() => {
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    );
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

/** 弹层查询口:总览/钻入明细/设置弹层经 Portal 渲染在 body,一律 document 级。 */
const modalQ = (id: string): Element | null => q(document, id);

/** 点开诸侯详情弹层(触发钮真点击+settle;各例独立开合,零用例间依赖)。 */
async function openOverview(): Promise<Element> {
  const el = container!;
  const btn = q(el, TESTIDS.topbarOverview);
  if (btn == null) throw new Error("接线测试:详情钮缺席(顶栏装配断)");
  click(btn);
  await settle();
  const modal = modalQ(TESTIDS.warlordsOverview);
  if (modal == null) throw new Error("接线测试:诸侯详情弹层未挂载(详情钮接线断)");
  return modal;
}

/** 对账取数口(cellsMatchSnapshot 同形):testid 文本 + 五账式剥标签字取纯数。 */
function num(el: ParentNode, id: string): string | null {
  return q(el, id)?.textContent?.replace(/^[城牌将宝望]/, "") ?? null;
}
const handShown = (n: number): string => (n > 9 ? "9+" : String(n));

/** 诸侯详情种植(react-warlords-overview plantSeat1Roster 的接线层直译,全 PlantOp):
 *  座位 1 高声望 +210 / 自机钉零声望(softmax 极端形态断言前提)/ 牌堆源珍宝 2 件 /
 *  3 座无主城入册 / 首名将入麾下;返回逐字期望值(读自进程内引擎 board/目录,与
 *  e2e 同口径:真身份陈列按 id 回查,假 id 当场炸)。 */
function plantSeat1Roster(
  e: GameEngine,
  plant: (op: PlantOp) => void,
): {
  guohao: string;
  cityNames: string[];
  plantedIds: string[];
  heroName: string;
} {
  plant({ kind: "setReputation", seat: 1, reputation: 210 });
  plant({ kind: "setReputation", seat: 0, reputation: 0 }); // 自机钉零:softmax 零点前提
  plant({ kind: "giveTreasureFromDeck", seat: 1, count: 2 }); // 珍宝槽 3 槽 2 满断言前提
  const owned = new Set(e.players.flatMap((p) => p.properties.map((h) => h.propertyId)));
  const free = MAP.board.tiles.filter((t) => t.propertyId != null && !owned.has(t.propertyId));
  if (free.length < 3) throw new Error("接线测试:无主城不足 3 座(地图/开局变了,种植前提失真)");
  const plantedIds = free.slice(0, 3).map((t) => t.propertyId!);
  for (const pid of plantedIds)
    plant({ kind: "grantProperty", seat: 1, propertyId: pid, level: 0 });
  const heroId = HEROES[0]!.id; // 首名将(e2e heroDefs()[0] 同源:核心池序,扩展后仍池首)
  plant({ kind: "armHero", seat: 1, heroId });
  // 城池名逐字期望:玩家名下全集(都城+种植)按棋盘 index 序(行军顺序,与 #622 清单
  // 行序/总览 chips 同源;e2e plantSeat1Roster 同口径读引擎玩家行)
  const cityNames = e.players[1].properties
    .map((h) => ({
      name: MAP.board.at(tileIndexOfProperty(MAP.board, h.propertyId)).name,
      i: tileIndexOfProperty(MAP.board, h.propertyId),
    }))
    .sort((a, b) => a.i - b.i)
    .map((r) => r.name);
  return {
    guohao: e.players[1].guohao,
    cityNames,
    plantedIds,
    heroName: heroById(heroId).name,
  };
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
  // 托管回读缝:autopilotSupported=单机真值(设置弹层托管行的门卫)+ 本地标记直达
  // 实现(判词见头注「托管回读缝」)。
  const Base = ctrlMod.GameController;
  class WiringControllerImpl extends Base {
    private roomAutoPilot = false;
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
    override readonly autopilotSupported = true; // 单机有托管(LocalController 同真值)
    override get autoPilotOn(): boolean {
      return this.roomAutoPilot;
    }
    override setAutoPilot(on: boolean): void {
      this.roomAutoPilot = on; // 单机=本地标记回读(基类契约单源,头注判词)
      this.sync(); // 回读重渲(生产=房间广播拍驱动,接线层同拍直达)
    }
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
  clock.restore();
});

afterAll(async () => {
  // 排干 React 调度器余拍(模板同款):release 后再触发会在无 window 环境抛
  // 「window is not defined」——window 还在时让完这一拍再拆 happy-dom。
  await Bun.sleep(0);
  await releaseHappyDom();
});

describe("席位格接线(自 react-seat-cells 迁入,#1316 批T2)", () => {
  // ── ①4 席计数对账(react-seat-cells 例 1 迁入)──
  // 断言面:行1 现金主数(裸数无千分位)+ 行2 五账式计数(剥标签字)逐席与 store 快照
  // 一致 + 一人一格全在单一 seatcol(自机入列,seat-0 缺席)。零种植:数值全由引擎
  // 真逻辑长出(react-seat-cells 真实段同口径)。
  it("4 席局:现金主数(裸数无千分位)+ 五图标计数逐席一致,一人一格", () => {
    const { el, snap } = startGame();
    const s = snap();
    // 一人一格(自机入列):4 席局 = 4 张格,全部在单一 seatcol 内
    expect(el.querySelectorAll(`[data-testid="${TESTIDS.seatRail}"] .seatcol .seat`)).toHaveLength(
      s.players.length,
    );
    expect(q(el, TESTIDS.seat(0))).toBeNull();
    expect(q(el, TESTIDS.seatSelf)).not.toBeNull();
    // 逐席对账(cellsMatchSnapshot 同形,断言源 = useGameStore 快照,进程内原子对账)
    s.players.forEach((p, seat) => {
      expect(q(el, TESTIDS.seatCash(seat))?.textContent).toBe(String(p.cash));
      expect(num(el, TESTIDS.seatAttr(seat, "city"))).toBe(String(p.properties.length));
      expect(num(el, TESTIDS.seatAttr(seat, "hand"))).toBe(handShown(p.jinnangHandCount));
      expect(num(el, TESTIDS.seatAttr(seat, "hero"))).toBe(String(p.heroes.length));
      expect(num(el, TESTIDS.seatAttr(seat, "gem"))).toBe(String(p.treasures.length));
      expect(num(el, TESTIDS.seatAttr(seat, "rep"))).toBe(String(p.reputation));
    });
  });

  // ── ②五状态+自机挂点(react-seat-cells 例 2 迁入)──
  // 断言面:活跃金圈呼吸(.active)/自机金样式(.self,无「你」字章)/濒耗竭色条朱砂
  // (.low)/破产降透明印灰(.bankrupt)对引擎状态的 CSS 响应链。钉行动方走 armPhase、
  // 濒耗竭走 setStamina(薄包 addStamina 唯一写口,「体力<三成」形态开局到不了——
  // 起手满体力负增量无自然来源)、破产印走 armBankrupt(判词单源 planter)。
  it("活跃金圈/濒耗竭朱砂条/破产印灰挂点,自机=金样式无文字章", () => {
    const { el, plant, snap } = startGame();
    // 活跃:行动方钉到 bot 席(引擎无「钉相位」公共命令,钉死挂点断言前提)→ 该格 .active
    plant({ kind: "armPhase", activeIndex: 1 });
    expect(hasClass(q(el, TESTIDS.seat(1))!, "active")).toBe(true);
    // 自机格:seat-self 挂点 + .self 类;活跃已钉在 bot 席 → 自机格无 .active/.picked;
    // seat-N 族不含自机(对手席专用族不变)
    const selfCell = q(el, TESTIDS.seatSelf);
    if (selfCell == null) throw new Error("接线测试:自机格缺席(自机入列接线断)");
    expect(hasClass(selfCell, "self")).toBe(true);
    expect(hasClass(selfCell, "active")).toBe(false);
    expect(hasClass(selfCell, "picked")).toBe(false);
    expect(q(el, TESTIDS.seat(0))).toBeNull();
    // 濒耗竭:体力压到 20(<三成)→ 色条挂 .low(转朱砂)
    plant({ kind: "setStamina", seat: 1, stamina: 20 });
    const track = q(el, TESTIDS.seatStamina(1))?.querySelector(".strack");
    if (track == null) throw new Error("接线测试:体力色条缺席(席位格行2 装配断)");
    expect(hasClass(track, "low")).toBe(true);
    // 破产印 → 整格降透明印灰挂点(照排:行仍在,非性质抹除)
    plant({ kind: "armBankrupt", seat: 2 });
    expect(hasClass(q(el, TESTIDS.seat(2))!, "bankrupt")).toBe(true);
    // store 快照同拍为证(挂点面=快照投影,双钉防「类对了数据没对」的假绿)
    expect(snap().players[1]!.stamina).toBe(20);
    expect(snap().players[2]!.isBankrupt).toBe(true);
    expect(snap().activeIndex).toBe(1);
  });

  // ── ③托管常驻微标(react-seat-cells 例 3 迁入)──
  // 断言面:设置弹层「托管」开关真点击链(开/关往返)+ 微标随开关往返的真渲染:
  // 开=自机格齿轮挂点、关=撤,bot 席恒无(SeatRail hosted 单机口径=本地标记回读,
  // 热座唯一真人座即自机)。aria-checked 回读腿=广播回读 armor(e2e 负载配方),
  // 重开弹层拍即达同值,判词见头注「托管回读缝」。
  it("托管微标(#770):开=自机格齿轮挂点、关=撤,对手 bot 席恒无", async () => {
    const { el, snap } = startGame();
    const badge = () => q(el, TESTIDS.seatHosted(0));
    expect(badge()).toBeNull(); // 初始关:微标不在场
    // 开托管:设置弹层「托管」开关真点击(#1097 通路,ADR-0028 同一引擎通路)
    const openSettings = async (): Promise<Element> => {
      const btn = q(el, TESTIDS.settingsButton);
      if (btn == null) throw new Error("接线测试:设置钮缺席(顶栏装配断)");
      click(btn);
      await settle();
      const dlg = modalQ(TESTIDS.settingsDialog);
      if (dlg == null) throw new Error("接线测试:设置弹层未挂载(设置钮接线断)");
      return dlg;
    };
    const closeSettings = async (): Promise<void> => {
      pressEscape();
      await finishExit(() => modalQ(TESTIDS.settingsDialog), "设置弹层应随 Esc 卸载");
    };
    let dlg = await openSettings();
    const sw = q(dlg, TESTIDS.settingsAutopilot);
    if (sw == null) throw new Error("接线测试:托管开关缺席(autopilotSupported 门卫断)");
    expect(sw.getAttribute("aria-checked")).toBe("false");
    click(sw);
    expect(snap()).toBeDefined(); // sync 拍已落(下一断言的真值源)
    await closeSettings();
    // 常驻微标现于自机格(纯展示,开关交互唯设置弹层);对手 bot 席非托管恒无
    expect(badge()).not.toBeNull();
    expect(q(el, TESTIDS.seatHosted(1))).toBeNull();
    // 重开弹层:开关回读为开(单机=控制器本地标记,重挂拍读真值)
    dlg = await openSettings();
    expect(q(dlg, TESTIDS.settingsAutopilot)!.getAttribute("aria-checked")).toBe("true");
    // 关托管 → 微标撤(状态随开关往返,§4.6 无文字章)
    click(q(dlg, TESTIDS.settingsAutopilot)!);
    await closeSettings();
    expect(badge()).toBeNull();
  });

  // ── ④目标段候选/停持(react-seat-cells 例 4 迁入)──
  // 断言面:出牌窗内点牌→目标段候选(.candidate 金圈呼吸)→点格选中停持(.picked 实金)
  // →再点取消(#417 统一口径)。种植=seat1 挂珍宝凑目标门槛(giveTreasure,珍宝无授给
  // 公共命令)+ 手牌终态替换(giveJinnang,手牌无公共通路),判词单源 planter;
  // seed 67 开局出牌阶段停靠(锦囊族既定锚,jinnang-wiring ⑧ 同源零钉相位)。
  it("目标段:候选格金圈呼吸(.candidate),点选实金停持(.picked)再点取消", () => {
    const { el } = startGame(
      [
        { kind: "giveTreasure", seat: 1, treasures: [{ id: "gem-1", name: "夜明珠", level: 5 }] },
        { kind: "giveJinnang", seat: 0, cards: ["军情密探"] },
      ],
      SEED_JUNSHI,
    );
    const card = q(el, TESTIDS.jinnangCard("军情密探"));
    if (card == null) throw new Error("接线测试:手牌钮缺席(架内牌面接线断)");
    click(card);
    const play = q(document, TESTIDS.actionbarPlay);
    if (play == null) throw new Error("接线测试:出牌钮缺席(动作条装配断)");
    click(play);
    // 目标段:候选格金圈呼吸挂点(one 域:目标有宝才候选,giveTreasure 已凑门槛)
    expect(hasClass(q(el, TESTIDS.seat(1))!, "candidate")).toBe(true);
    // 点格=选中(.picked 实金停持),再点同格=取消(#417 统一口径)
    const target = q(el, TESTIDS.seatTarget(1));
    if (target == null) throw new Error("接线测试:目标段点击层缺席(席位格目标装配断)");
    click(target);
    expect(hasClass(q(el, TESTIDS.seat(1))!, "picked")).toBe(true);
    click(target);
    expect(hasClass(q(el, TESTIDS.seat(1))!, "picked")).toBe(false);
  });
});

describe("诸侯详情接线(自 react-warlords-overview 迁入,#1316 批T2)", () => {
  // ── ⑥状态挂点(react-warlords-overview 例 3 迁入)──
  // 断言面:总览行状态挂点对引擎状态的 CSS 响应链——自机行 .self 金描边(真实座位
  // 真渲染)/活跃方 .is-active 印金圈(Playing 相位下 activeIndex 行)/破产行 .dead
  // 灰化且数值列仍逐字可读(灰化不藏数)。破产印走 armBankrupt 种植件(判词单源
  // planter:破产态开局不可达,断言面需破产行形态)。
  it("自机行 .self 金描边;破产行 .dead 灰化;活跃方 .is-active 印金圈", async () => {
    const { plant, snap } = startGame();
    plant({ kind: "armBankrupt", seat: 1 }); // 种植破产(对手席)
    const s = snap();
    await openOverview();
    expect(hasClass(modalQ(TESTIDS.warlordsRow(0))!, "self")).toBe(true);
    expect(hasClass(modalQ(TESTIDS.warlordsRow(1))!, "dead")).toBe(true);
    // 活跃方印金圈:Playing 相位下 activeIndex 行挂 .is-active(样式走 .zl-seal 后代)
    expect(s.phase).toBe("Playing");
    expect(hasClass(modalQ(TESTIDS.warlordsRow(s.activeIndex))!, "is-active")).toBe(true);
    // 破产行照排:数值列仍逐字可读(灰化不藏数)
    expect(modalQ(TESTIDS.warlordsCash(1))!.textContent).toBe(String(s.players[1]!.cash));
  });

  // ── ⑤四元素钻入单层互斥(react-warlords-overview 例 2 迁入)──
  // 断言面:chips/槽/声列真点击→总览先关再开目标弹层(单层互斥,GameTopBar 持开合态)
  // + 明细文本逐字(城池清单行序/名录麾下计数/珍宝已持有数/声望明细吃 tierShares
  // 同源现算)。零几何——.rep-prob-bar > i 只断「三段在场」节点计数,宽度比几何腿
  // 留浏览器(切腿判词见 spec 头注与分类表行注)。
  it("城池 chips→清单/名将 chips→名录/珍宝槽→列表/声列→明细;单层互斥", async () => {
    const { engine, plant, snap } = startGame();
    const planted = plantSeat1Roster(engine, plant);
    const s = snap();
    const closeDrill = async (tid: string, label: string): Promise<void> => {
      const x = modalQ(TESTIDS.modalClose);
      if (x == null) throw new Error(`接线测试:${label}关闭钮缺席`);
      click(x);
      await finishExit(() => modalQ(tid), `${label}应随退场协议卸载`);
    };
    // 城池 chips → #622 清单(单层互斥:总览先关,清单开到对应诸侯)
    await openOverview();
    click(modalQ(TESTIDS.warlordsCities(1))!);
    expect(modalQ(TESTIDS.warlordsOverview)).toBeNull(); // 单层互斥:总览先关
    const ledger = modalQ(TESTIDS.cityLedger);
    if (ledger == null) throw new Error("接线测试:城池清单未挂载(城池钻入接线断)");
    expect(ledger.textContent).toContain(`${planted.guohao}名下城池`);
    for (const id of planted.plantedIds) {
      expect(q(document, TESTIDS.cityLedgerRow(id))).not.toBeNull();
    }
    await closeDrill(TESTIDS.cityLedger, "城池清单");
    // 名将 chips → 名将名录(PileShell 名录,麾下 1 席,卡面出将名)
    await openOverview();
    click(modalQ(TESTIDS.warlordsHeroes(1))!);
    expect(modalQ(TESTIDS.warlordsOverview)).toBeNull();
    const heroModal = modalQ(TESTIDS.seatHeroModal);
    if (heroModal == null) throw new Error("接线测试:名将名录未挂载(名将钻入接线断)");
    expect(heroModal.textContent).toContain("麾下名将 · 1 席");
    expect(heroModal.textContent).toContain(planted.heroName);
    await closeDrill(TESTIDS.seatHeroModal, "名将名录");
    // 珍宝槽 → 珍宝列表(种植 2 件,陈列 2 卡)
    await openOverview();
    click(modalQ(TESTIDS.warlordsGems(1))!);
    expect(modalQ(TESTIDS.warlordsOverview)).toBeNull();
    const gemModal = modalQ(TESTIDS.seatGemModal);
    if (gemModal == null) throw new Error("接线测试:珍宝列表未挂载(珍宝钻入接线断)");
    expect(gemModal.textContent).toContain("已持有 · 2 件");
    await closeDrill(TESTIDS.seatGemModal, "珍宝列表");
    // 声列 → 声望明细终态:大数+三段概率条在场+三档百分比明文(逐字吃 tierShares
    // 同源现算,宽度比几何腿不在此层);零冗余负向断言:不含『献计』『里程碑』字样。
    await openOverview();
    click(modalQ(TESTIDS.warlordsRepCell(1))!);
    expect(modalQ(TESTIDS.warlordsOverview)).toBeNull();
    const repModal = modalQ(TESTIDS.seatRepModal);
    if (repModal == null) throw new Error("接线测试:声望明细未挂载(声列钻入接线断)");
    expect(repModal.querySelector(".sdtl-bignum")!.textContent).toBe(
      String(s.players[1]!.reputation),
    );
    expect(repModal.querySelectorAll(".rep-prob-bar > i")).toHaveLength(3); // 三段在场(计数非几何)
    const shares = tierShares(s.players[1]!.reputation);
    const tierTexts = [...repModal.querySelectorAll(".sdtl-tiers > span")].map(
      (n) => n.textContent,
    );
    expect(tierTexts).toEqual([
      `好运 ${Math.round(shares.good)}%`,
      `中性 ${Math.round(shares.neutral)}%`,
      `霉运 ${Math.round(shares.bad)}%`,
    ]);
    expect(repModal.textContent).not.toContain("献计");
    expect(repModal.textContent).not.toContain("里程碑");
    await closeDrill(TESTIDS.seatRepModal, "声望明细");
  });

  // ── ⑦十列行数据语义腿(react-warlords-overview 例 1 切腿迁入)──
  // 断言面=「行数据逐字对照」语义腿:十列数值列(cash/体力/牌数/声)逐席与快照一致、
  // 空槽画空格(HERO_CAPACITY 制式)/种植席名将名与珍宝槽位逐字/城池名录直读+折叠
  // 「+N」/题名行轮次/Esc 关闭即卸。切腿判词:声列三档概率条 getBoundingClientRect
  // 宽度比与满编 8 行零滚动是几何腿(假 DOM 恒 0 不可下放),留浏览器壳例——语义腿
  // 与几何腿分离后本层只断结构与文本,零几何零像素。
  it("十列数值逐字对照;城池/名将名录直读,超 3 折叠 +N,空槽画空格;Esc 关闭", async () => {
    const { engine, plant, snap } = startGame();
    const planted = plantSeat1Roster(engine, plant);
    const s = snap();
    const modal = await openOverview();
    // 行集 = 座位集,座序即行序;数值列逐席与快照一致(总览经 Portal 在 body,一律 document 级)
    for (let seat = 0; seat < s.players.length; seat++) {
      const row = modalQ(TESTIDS.warlordsRow(seat));
      if (row == null) throw new Error(`接线测试:总览行 ${seat} 缺席(行集=座位集断)`);
      expect(modalQ(TESTIDS.warlordsCash(seat))!.textContent).toBe(String(s.players[seat]!.cash));
      expect(modalQ(TESTIDS.warlordsStamina(seat))!.textContent).toBe(
        String(s.players[seat]!.stamina),
      );
      expect(modalQ(TESTIDS.warlordsHand(seat))!.textContent).toBe(
        String(s.players[seat]!.jinnangHandCount),
      );
      expect(modalQ(TESTIDS.warlordsRep(seat))!.textContent).toBe(
        String(s.players[seat]!.reputation),
      );
    }
    // 空槽画空格:自机麾下 0 将 = 三空槽(HERO_CAPACITY 制式)
    expect(modalQ(TESTIDS.warlordsHeroes(0))!.textContent).toBe("···");
    // 种植席:名将名逐字(朱砂 chips)+ 两空槽;珍宝计数槽 3 槽 2 满
    const heroes1 = modalQ(TESTIDS.warlordsHeroes(1))!;
    expect(
      [...heroes1.querySelectorAll(".zl-hnslot:not(.zl-empty)")].map((n) => n.textContent),
    ).toEqual([planted.heroName]);
    expect(heroes1.querySelectorAll(".zl-hnslot.zl-empty")).toHaveLength(2);
    const gems1 = modalQ(TESTIDS.warlordsGems(1))!;
    expect(gems1.querySelectorAll(".zl-slot")).toHaveLength(3);
    expect(gems1.querySelectorAll(".zl-slot.zl-full")).toHaveLength(2);
    // 城池名录直读:capital+3 种植 = 4 城 → 前 3 chips 逐字(棋盘 index 序)+ 折叠「+1」
    const cities1 = modalQ(TESTIDS.warlordsCities(1))!;
    expect(
      [...cities1.querySelectorAll(".zl-cityslot:not(.zl-more)")].map((n) => n.textContent),
    ).toEqual(planted.cityNames.slice(0, 3));
    expect(cities1.querySelector(".zl-cityslot.zl-more")!.textContent).toBe(
      `+${planted.cityNames.length - 3}`,
    );
    // 题名行:轮次与快照一致
    expect(modal.querySelector(".zl-round")!.textContent).toBe(`${s.round} 轮`);
    // Esc 关闭(挂载不夺焦,Esc 直关由底件白拿;退场协议走完即卸)
    pressEscape();
    await finishExit(() => modalQ(TESTIDS.warlordsOverview), "总览应随 Esc 退场协议卸载");
  });
});
