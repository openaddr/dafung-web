// 接线测试(ADR-0062 层④,#1317 批T3):决策卷轴/终局屏域九例自 e2e 迁入接线层——
// 卷轴族七例(react-scrolls:①招贤先看后选拍板收将、②交涉坐地价签双行与分解式结算行、
// ③交涉公道二段式成交发 resolveTreasureOwner 命令、④破产清算债务进度/选宝弹层二段式
// 变卖/售出清单刷新、⑤胜利屏全屏覆盖、⑥城池详情点城弹只读卷轴、⑦珍宝城购地落格弹卷/
// 「余」差额行/点买收卷)+ 耗竭一例(react-stamina:⑧耗竭卷轴升收→自选降级→体力条
// 回满)+ 作废一例(react-abort:⑨引擎 abortGame→对局作废面板快照相+胜局演出零残留)。
//
// 【判层理由】判据=ADR-0062 迁移判据,判层只看断言面:①=点击→全览弹框行挂点(.is-hl/
// .is-off)→拍板→卷轴卸载+快照候选清空;②=价签文本(指导价/要价/成交·至,口径与引擎
// 同一纯函数 guidePriceOf/premiumPriceOf,不写第二事实源)+返回回模式步;③=aria-pressed
// 翻面+二段武装文案+命令留痕(log 行 category=cmd 的 JSON 逐字对账)+层随结算收口;
// ④=进度行文本+二段式变卖+重开清单刷新(已卖件消失余件仍在);⑤⑨=终局覆盖层 DOM
// 有无+快照相(phase/winner/winReason)+胜局/作废专属元素在场/零残留;⑥=点城→只读
// 详情卷轴文本(交易加成恒主列;第二列按城型=都城补给|变卖价,#671 列语义);⑦=落格
// 弹卷+「余/差」符号语义(#566:付得起记「余」)+点买收卷;⑧=卷轴升收+选项计数+结算
// 留痕+体力色条 width 百分比(style 属性字面量=形态契约非几何量测)。零几何零像素
// 零演出泵。
// 刻意不迁的腿(名册判词见 e2e-分类表行注):⑤/⑨的「重开钮点击」=location.reload
// (真浏览器 API 面,happy-dom 无真值通路,ADR-0062 迁移判据「真浏览器 API 面」族)——
// 本层只守出口钮 DOM 有无,点击腿随例退役;⑦的行军表现投影(applyPresentationMove)
// 是 fx 面,接线层不消费(落格决策链已由 marchTraverse→settleMarchLanding 真引擎路径
// 全走)。
//
// 【渲染装配配方】(模板 = test/wiring/battle-wiring.test.tsx #1317 同批 + test/overview-
// wiring.test.tsx #1316 批T2;模板四步 + 晚绑红线第 0 条 + 注册控制器第 2.5 步 + 环境
// 缝照抄)本域全快照驱动(pendingLand/treasureVisitor/pendingDebt/offeredHeroes/
// pendingExhaustionSeat/phase),无表现消费腿:终局屏/卷轴族不涉 fxStore 开关态。
//   0.【晚绑红线】凡「typeof document 求值期捕获」的依赖必须晚于 ensureHappyDom
//      求值(Base UI 全族 useIsoLayoutEffect 求值期定型,静态 import 冻结成 noop、
//      弹层空壳零报错)——GameScreen 全图(含选宝弹层/技能全览/终局屏族)与 controller
//      基类依赖图一律 beforeAll 内 await import 晚绑;@core 纯逻辑(含 planter 种植件/
//      价签纯函数)与 store/testids(零 DOM 求值期捕获)照旧静态。
//   1. beforeAll ensureHappyDom()(test/wiring/happy-dom-register.ts 局部注册/release 还原);
//   2. 真 GameEngine 直构(loadMap(guanzhong.json)+ createDice(seed)),公共命令走完
//      选都链停 Playing——seed 1486=模板既定锚;零时钟零竞速,种下什么相位就停什么
//      相位。
//   2.5. 注册控制器:WiringController(GameController 生产基类最小子型)同模板,
//      dispatchCommand = engine.submitCommand + this.sync;房间编排/传输/看门狗不进
//      接线层。
//   3. 基类 sync 灌真 store,act() 内渲染真 GameScreen(生产装配本体,整屏真挂);
//   4. act() 内合成事件(dispatchEvent 冒泡)与断言,testid/类名/DOM 文本/store 状态。
//
// 【种植单源形】(overview-wiring #1321 形制)初始布场与拍间种植一律走 PlantOp 指令
// (applyPlant 单源 @core/planter,与 e2e 桥/单测同一份实现):startGame(ops[]) 开局
// 前逐条落种、plant(op) 拍间补种+resync 重灌——全文件零裸直写,各件判词单源在
// planter 函数头注。交涉/购地/耗竭三例的「读现值拼」(保起手珍宝全集/无主城选址/都城
// 前置持仓哨兵)读的是进程内引擎真值,判词同 e2e(测试侧读现值,种植件只收终态)。
// 引擎公共方法直呼(marchTraverse/settleMarchLanding/tryRecruitHero/exhaustIfDepleted/
// abortGame)经 writeEngine 缝=「只承载引擎公共方法调用」的合法漏斗(e2e callEngine
// #1302 同语义,封装三拍含 resync 重灌派生量)。
//
// 【断言宪法】本层禁几何(假 DOM 无排版引擎,getBoundingClientRect 恒 0)、禁像素、
// 禁演出泵与真实时钟;本九例断言面 = testid 有无 / 类名挂点(.is-hl/.is-off)/ aria
// 属性(aria-pressed)/ DOM 文本(价签/进度行/详情列/印条)/ style 属性字面量(体力
// 色条 width 百分比)/ store 快照字段与日志行,纯状态挂点。
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
import { formatMoney } from "@core/money";
import { heroById } from "@core/heroes";
import { guidePriceOf, premiumPriceOf } from "@core/treasures";
import { applyPlant, type PlantOp } from "@core/planter";
import { TESTIDS } from "@app/screens/game/testids";
import { SCROLL_TESTIDS as T } from "@app/screens/game/scroll/testids";
import { useGameStore, type GameSnapshot } from "@app/store/gameStore";
import { useNetStore } from "@app/store/netStore";
import { useFxStore } from "@app/fx/fxStore";
import { ensureHappyDom, releaseHappyDom } from "./happy-dom-register";
import { installControlledClock } from "./controlled-clock";
import { GHOST, UI } from "@app/fx/timings";

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
const SEED = 1486; // 模板既定锚(e2e 卷轴族谱内种子)

/** 座位表:与模板同(solo 口径 seat 0 = 自机)。 */
const SEATS: SeatConfig[] = [
  { name: "座 1", isBot: false, guohao: "魏" },
  { name: "座 2", isBot: true },
  { name: "座 3", isBot: true },
  { name: "座 4", isBot: true },
];

/** 公共命令链开局;默认选完都停 Playing,费用接线例留在选都前。非法态当场抛错。 */
function seedEngine(pickCapitals = true): GameEngine {
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
  while (pickCapitals && e.phase === "Setup") {
    if (!e.aiSetupStep()) {
      const r = e.pickCapital(e.currentSetupPlayerIndex, Math.min(...e.offeredCapitals));
      if (!r.ok) throw new Error(`种局:选都被拒(${r.reason ?? "未知"})`);
    }
  }
  if (pickCapitals && e.phase !== "Playing")
    throw new Error(`种局:选都链后非 Playing(phase=${e.phase})`);
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
 *  ops = 初始布场指令(PlantOp 单源逐条落种,判词见头注「种植单源形」);
 *  writeEngine = 进程内引擎公共方法直呼缝 + 重灌 store(e2e callEngine #1302 同语义)。 */
function startGame(
  ops: PlantOp[] = [],
  pickCapitals = true,
): {
  el: HTMLElement;
  engine: GameEngine;
  plant: (op: PlantOp) => void;
  writeEngine: (write: (e: GameEngine) => void) => void;
  snap: () => GameSnapshot;
} {
  const e = seedEngine(pickCapitals);
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
  await clock.advance(GHOST.frameMs);
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
function plantTrade(handles: ReturnType<typeof startGame>): string {
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
  plant({ kind: "grantProperty", seat: 0, propertyId: tile.propertyId, level: 1 });
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
  // 注册带地图(生产 setController(controller, map) 同款):DecisionScrollLayer/
  // BoardView 的挂载门卫要 registry 静态上下文(getControllerMap),缺图整层不渲染。
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
    override setupPickCapital(tileIndex: number): void {
      const result = this.e.pickCapital(this.e.currentSetupPlayerIndex, tileIndex);
      if (!result.ok) throw new Error(`接线测试:选都被拒(${result.reason})`);
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
  await releaseHappyDom();
});

describe("招贤卷轴(自 react-scrolls 迁入,#1317 批T3)", () => {
  // ── ①先看后选拍板(react-scrolls 招贤例迁入)──
  // 断言面:tryRecruitHero 公共方法真掷候选(候选行=引擎真产物,非伪造 offeredHeroes,
  // e2e callEngine 同语义)→三选一卷轴(无「不取」:引擎相位不接受 endDecision)→
  // 预掷明牌 chips≥1 →点候选技名 chip=开技能全览(池全貌逐技在列+未授灰置+看将不发
  // 命令)→关框→点卡体=开详情弹框(拍板唯一入口,「收为麾下」在场)→拍板→钤印节拍
  // 后卷轴收场、候选清空。钤印与幽灵退场各按生产时长推进,不轮询真实业务延时。
  it("三选一:预掷明牌 chips+全览池对照,点卡/技名开全览先看后选,弹框拍板收将", async () => {
    const { el, engine, writeEngine, snap } = startGame([
      { kind: "armPhase", activeIndex: 0 }, // 候选拍板归活跃方(resolveHeroPick 授 activePlayer)
    ]);
    writeEngine((e) => {
      const r = e.tryRecruitHero(e.players[0]);
      if (r !== "offered") throw new Error(`接线测试:tryRecruitHero=${r}(招贤候选未开)`);
    });
    const scroll = () => docQ(T.heroPickScroll);
    expect(scroll()).not.toBeNull();
    expect(docQ(T.heroPickDecline)).toBeNull(); // 无「不取」:引擎相位不接受 endDecision
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

describe("珍宝交涉(自 react-scrolls 迁入,#1317 批T3)", () => {
  // ── ②坐地价签(react-scrolls 交涉 premium 例迁入)──
  // 断言面:模式选定弹选宝层(标题随口径)→坐地双行价签(指导价+要价,要价与引擎
  // 结算同一 premiumPriceOf;holding level=1,UI 与引擎同走 per-level 公式)→点选转
  // 「成交 · 至 要价」+结算行分解式「指导价 + 加价 = 入账」→返回回模式步(本地状态
  // 回退,不发命令)。
  it("坐地起价:双行价签与引擎同公式,点选转成交价签,返回回模式步", async () => {
    const handles = startGame();
    plantTrade(handles);
    const { engine } = handles;
    const scroll = () => docQ(T.treasureScroll);
    expect(scroll()).not.toBeNull();
    click(docQ(T.treasureModePremium)!);
    await settle();
    const pick = () => docQ(T.treasurePick);
    expect(pick()).not.toBeNull();
    expect(pick()!.textContent).toContain("坐地起价"); // 标题随口径
    const item = () => docQ(T.treasureItem("seal"))!;
    expect(item()).not.toBeNull();
    // 坐地价签:未选=双行「指导价+要价」,要价与引擎结算同一 premiumPriceOf
    const guide = guidePriceOf(3);
    const def = engine.treasureVisitor!.def;
    const ask = premiumPriceOf(guide, def, 1);
    expect(item().textContent).toContain(`指导价 ${formatMoney(guide)}`);
    expect(item().textContent).toContain(`要价 ${formatMoney(ask)}`);
    // 点选:价签转「成交 · 至 要价」,结算行给分解式「指导价 + 加价 = 入账」
    click(item());
    expect(item().textContent).toContain(`成交 · 至 ${formatMoney(ask)}`);
    expect(pick()!.textContent).toContain(
      `指导价 ${formatMoney(guide)} + 加价 ${formatMoney(ask - guide)} = 入账 ${formatMoney(ask)}`,
    );
    // 返回:关层回模式选择步(本地状态回退,不发命令;相位不动)
    click(docQ(T.treasureBack)!);
    expect(pick()).toBeNull();
    expect(docQ(T.treasureModePremium)).not.toBeNull();
    expect(handles.snap().turnPhase).toBe("AwaitingTreasureOwner");
  });

  // ── ③公道买卖二段式成交(react-scrolls 交涉 fair 例迁入)──
  // 断言面:点选金描边(aria-pressed)→确认武装(文案翻面,不提交:层不关、相位不动、
  // 零命令)→二段提交发 resolveTreasureOwner{fair,treasureId} 命令(log 行 category=cmd
  // 的 JSON 逐字对账,#799 基线后切片)→层随结算收口(幽灵帧走完)。结算细则归
  // test/treasure.test.ts(单测已钉,cmd 行=命令接线证据)。
  it("公道买卖:点选金描边+二段式成交,确认提交发 resolveTreasureOwner 命令", async () => {
    const handles = startGame();
    plantTrade(handles);
    const { snap } = handles;
    expect(docQ(T.treasureScroll)).not.toBeNull();
    click(docQ(T.treasureModeFair)!);
    const pick = () => docQ(T.treasurePick);
    expect(pick()).not.toBeNull();
    const item = () => docQ(T.treasureItem("seal"))!;
    expect(item()).not.toBeNull();
    // 价签:未选=指导价;指导价单源 core/treasures(不写第二事实源)
    expect(item().textContent).toContain(`指导价 ${formatMoney(guidePriceOf(3))}`);
    const confirm = () => docQ(T.treasureConfirm)!;
    expect(confirm().hasAttribute("disabled")).toBe(true); // 未预选不可成交
    // 点选=金描边上浮:aria-pressed 翻真 + 价签转「成交 · 至 N 两」
    click(item());
    expect(item().getAttribute("aria-pressed")).toBe("true");
    expect(item().textContent).toContain(`成交 · 至 ${formatMoney(guidePriceOf(3))}`);
    // 二段式:第一段=预选态点亮确认,不提交(层不关、相位不动、零命令)
    click(confirm());
    expect(confirm().textContent).toBe("确认成交");
    expect(pick()).not.toBeNull();
    expect(snap().turnPhase).toBe("AwaitingTreasureOwner");
    // 留痕基线(#799):只扫「基线后追加段」——种植交涉停在人类决策点,基线到提交间
    // 无任何他线可插,切片内首条恒为本例命令线(结算路径内同步写入)。
    const logLenBefore = snap().log.length;
    click(confirm()); // 第二段=确认提交
    const cmdLine = snap()
      .log.slice(logLenBefore)
      .find((l) => l.category === "cmd" && l.detail.includes("resolveTreasureOwner"));
    if (cmdLine == null) throw new Error("接线测试:resolveTreasureOwner 命令留痕缺席");
    expect(JSON.parse(cmdLine.detail)).toEqual({
      type: "resolveTreasureOwner",
      action: { type: "fair", treasureId: "seal" },
    });
    // 层随结算收口(幽灵帧 210ms 走完;命令留痕已被钉住,层收跟拍不吃竞速)
    await clock.advance(GHOST.frameMs);
    expect(pick() === null, "选宝层应随结算收口").toBe(true);
    expect(docQ(T.treasureScroll) === null, "交涉卷轴应随结算收场").toBe(true);
  });
});

describe("破产清算卷轴(自 react-scrolls 迁入,#1317 批T3)", () => {
  // ── ④债务进度/选宝弹层/售出清单刷新(react-scrolls 破产例迁入)──
  // 断言面:清算卷轴升起+进度行「已凑」三数同窗→卷轴内入口开选宝弹层(「变卖自救」
  // 标题+进度伴随)→指导价口径价签→二段式变卖(点选金描边→确认武装→提交)→层随结算
  // 收口→重开清单刷新(已卖件消失、余件仍在)。变卖入账=指导价的结算等式归
  // test/bankruptcy.test.ts(单测已钉);种植=giveTreasure 终态拼全集+armDebt 挂债
  // (判词单源 planter)。
  it("债务进度/选宝弹层(二段式变卖)/售出清单刷新", async () => {
    const { el, plant, snap } = startGame();
    plant({
      kind: "giveTreasure",
      seat: 0,
      treasures: [
        ...snap().players[0].treasures,
        { id: "seal", name: "传国玉玺", level: 3, desc: "x" },
        { id: "hat", name: "草帽", level: 1, desc: "x" },
      ],
    });
    plant({ kind: "armPhase", activeIndex: 0 });
    plant({ kind: "armDebt", amount: 99999, creditor: null });
    const scroll = () => docQ(T.bankruptcyScroll);
    expect(scroll()).not.toBeNull();
    expect(docQ(T.bankruptcyDebt)).not.toBeNull(); // 进度行:已凑/债务/尚欠三数同窗
    expect(docQ(T.bankruptcyProgress)!.textContent).toContain("已凑");
    // 卷轴内入口开选宝弹层
    click(q(el, T.bankruptcySellTreasureOpen)!);
    await settle();
    const pick = () => docQ(T.bankruptcyTreasurePick);
    expect(pick()).not.toBeNull();
    expect(pick()!.textContent).toContain("变卖自救"); // 标题语义保留
    expect(docQ(T.bankruptcyPickProgress)!.textContent).toContain("已凑");
    const item = () => docQ(T.bankruptcySellTreasure("seal"))!;
    expect(item()).not.toBeNull();
    expect(item().textContent).toContain(`至 ${formatMoney(guidePriceOf(3))}`); // 指导价口径
    // 二段式:点选金描边 → 确认武装 → 提交
    click(item());
    expect(item().getAttribute("aria-pressed")).toBe("true");
    const confirm = () => docQ(T.bankruptcySellTreasureConfirm)!;
    click(confirm());
    expect(confirm().textContent).toBe("确认变卖");
    click(confirm());
    // 售出即收层(命令落账同步;入账等式归引擎单测)
    await finishExit(pick, "变卖选宝层应随结算收口");
    // 重开清单随快照刷新(已卖件消失,余件仍在)
    click(q(el, T.bankruptcySellTreasureOpen)!);
    await settle();
    expect(docQ(T.bankruptcyTreasurePick)).not.toBeNull();
    expect(docQ(T.bankruptcySellTreasure("seal"))).toBeNull(); // 已卖件消失(缺席=null,断言安全)
    expect(docQ(T.bankruptcySellTreasure("hat"))).not.toBeNull(); // 余件仍在
  });
});

describe("城池详情卷轴(自 react-scrolls 迁入,#1317 批T3)", () => {
  // #1417:接线守建城费/余额与真实选都扣款,首屏与钉底几何留真浏览器。
  it("选都展示建城费与余额,确认后实际扣款一致(#1417)", async () => {
    const { el, engine, writeEngine } = startGame([], false);
    writeEngine((e) => {
      while (e.currentSetupPlayerIndex !== 0) {
        if (!e.aiSetupStep()) throw new Error("接线测试:真人前置选都未推进");
      }
    });
    const idx = engine.offeredCapitals[0];
    const def = engine.catalog.get(engine.board.at(idx).propertyId!)!;
    const cash = engine.players[0].cash;
    click(el.querySelector(`[data-tile="${idx}"]`)!);
    const detail = docQ(T.tileDetailScroll)!;
    expect(detail.textContent).toContain(`建城费 ${formatMoney(def.buildCost)}`);
    expect(detail.textContent).toContain(`余额 ${formatMoney(cash - def.buildCost)}`);
    expect(detail.textContent).toContain(`都城补给 ${formatMoney(def.resupply)}`);
    click(docQ(TESTIDS.confirmCapitalOk)!);
    expect(engine.players[0].cash).toBe(cash - def.buildCost);
    expect(engine.players[0].capitalIndex).toBe(idx);
    await settle();
  });

  it.each(["单机", "联机"])(
    "%s查看自己与他人持有城:保留持有收益,不出现购买余差(#1417)",
    async (mode) => {
      const { el, engine } = startGame([
        { kind: "armPhase", activeIndex: 0, turnPhase: "AwaitingDecision" },
        { kind: "armLanding", landing: null },
      ]);
      if (mode === "联机") {
        act(() => {
          useNetStore.getState().setRoom({
            roomId: "wiring-city-fees",
            seats: engine.players.map((player, seat) => ({
              seat,
              kind: player.isBot ? "bot" : "human",
              taken: true,
              online: true,
              autoPilot: false,
              guohao: player.guohao,
            })),
          });
          useNetStore.getState().setMySeat(0);
        });
      }
      for (const seat of [0, 1]) {
        const player = engine.players[seat];
        const idx = player.capitalIndex;
        const tile = engine.board.at(idx);
        const def = engine.catalog.get(tile.propertyId!)!;
        click(el.querySelector(`[data-tile="${idx}"]`)!);
        const detail = docQ(T.tileDetailScroll)!;
        expect(detail.textContent).toContain(`持有:${player.guohao}`);
        expect(detail.textContent).toContain("都城 Lv.0");
        expect(detail.textContent).toContain(`购入价 ${formatMoney(def.purchasePrice)}`);
        expect(detail.textContent).toContain("交易加成");
        expect(detail.textContent).toContain("都城补给");
        expect(detail.textContent).not.toContain("需 ");
        expect(detail.textContent).not.toContain("余 ");
        expect(detail.textContent).not.toContain("差 ");
        expect(docQ(TESTIDS.confirmCapitalOk)).toBeNull();
        click(q(detail, T.scrollClose)!);
        await finishExit(() => docQ(T.tileDetailScroll), "只读城池详情应关闭");
      }
    },
  );

  // ── ⑥点城详情(react-scrolls 城池详情例迁入)──
  // 断言面:对局中真点城池格(data-tile 点击层)→详情卷轴弹出→列语义(主列交易加成
  // 恒在;第二列按城型=都城补给|变卖价,#671 列语义钉)。选城与城型期望值读进程内引擎
  // 现值(与 e2e __dafung 桥读引擎同语义);空闲态前置=钉 AwaitingDecision+清落格投影
  // (armLanding null,停车坪判词单源 planter)。
  it("对局中点城弹出只读详情:交易加成恒主列,第二列按城型", async () => {
    const { el, engine, snap } = startGame([
      { kind: "armPhase", turnPhase: "AwaitingDecision" }, // 空闲态:点城=详情语义(选都期点城=定都流程,相位分流)
      { kind: "armLanding", landing: null }, // 清落格投影(决策卷轴不遮点城通路)
    ]);
    void snap;
    const idx = engine.board.tiles.findIndex((t) => t.propertyId != null);
    if (idx < 0) throw new Error("接线测试:盘面无城池格(地图数据 bug)");
    const isCapital = engine.players.some((p) => p.capitalIndex === idx);
    const tileEl = el.querySelector(`[data-tile="${idx}"]`);
    if (tileEl == null) throw new Error("接线测试:城池格点击层缺席(棋盘装配断)");
    click(tileEl);
    await settle();
    const detail = docQ(T.tileDetailScroll);
    if (detail == null) throw new Error("接线测试:城池详情卷轴未挂载(点城通路断)");
    expect(detail.textContent).toContain("交易加成"); // 主列恒为交易加成
    expect(detail.textContent).toContain(isCapital ? "都城补给" : "变卖价"); // 第二列按城型
  });
});

describe("购地卷轴(自 react-scrolls 迁入,#1317 批T3)", () => {
  // ── ⑦珍宝城购地(react-scrolls 购地例迁入)──
  // 断言面:落格弹购地卷轴(真引擎路径:marchTraverse→settleMarchLanding,与掷定 1 步
  // 后同一段落格结算,非伪造挂起)→差额行符号语义(#566:买得起记「余」不记「差」,
  // formatMoney 拒负后此行是契约面)→点买发命令卷轴收(幽灵帧走完)。链序正典与收口
  // 零探宝归 test/treasure.test.ts(单测已钉);大额现金=setCash 数值族种植(与地图
  // 价格解耦,判词单源 planter);lastMove=行军投影回写经 applyPresentationMove 公共
  // 方法(settleMarchLanding 的 marchArrived 事件硬要求路径——引擎缺路径当场炸,零
  // 兜底;e2e 同款直呼,表现侧设 lastMove 的唯一合法入口)。
  it("落格弹购地卷轴、差额行「余」、点买收卷", async () => {
    const { engine, plant, writeEngine } = startGame();
    plant({ kind: "setCash", seat: 0, cash: 20000 }); // 大额现金:购入价解耦(「余」侧确定性)
    plant({ kind: "armPhase", phase: "Playing", activeIndex: 0 });
    // 无主珍宝城选址读数(只读):落格=城格,起步=贴邻前一格
    const tile = engine.board.tiles.find(
      (t) => t.event === "treasure" && t.propertyId != null && !engine.findOwner(t.propertyId),
    );
    if (tile?.propertyId == null) throw new Error("接线测试:盘面无无主珍宝城(地图数据 bug)");
    const land = tile.index;
    const from = (land + engine.board.count - 1) % engine.board.count;
    plant({ kind: "placePlayer", seat: 0, position: from });
    writeEngine((e) => {
      const r = e.marchTraverse(e.players[0], [land], 1, land, from, 1);
      if (r !== "landed") throw new Error(`接线测试:marchTraverse=${r}(单格无拦检,契约违反)`);
      // 行军投影回写(marchArrived 事件路径契约;路径经 computePath 读现值拼)
      e.applyPresentationMove(e.board.computePath(from, 1, e.players[0].capitalIndex));
      e.settleMarchLanding(e.players[0], land); // 落格结算:探宝先行、可购决策挂起(#825 链序)
    });
    const scroll = () => docQ(T.buyScroll);
    expect(scroll()).not.toBeNull(); // 落格即弹购地卷轴
    // 差额行符号语义(#566):买得起记「余」不记「差」
    expect(scroll()!.textContent).toContain("余");
    expect(scroll()!.textContent).not.toContain("差");
    expect(scroll()!.textContent).toContain(
      `需 ${formatMoney(engine.catalog.get(tile.propertyId)!.purchasePrice)}`,
    ); // #1417:购地继续读购入价,不跟随选都改成建城费
    // 点买 → 命令受理,卷轴收(决策收口的 UI 面;购地结算与链序归引擎单测)
    click(docQ(TESTIDS.actionButton("buy"))!);
    expect(scroll()).not.toBeNull(); // 命令已受理,幽灵退场帧仍在
    await clock.advance(GHOST.frameMs - 1);
    expect(scroll()).not.toBeNull(); // 出口时刻之前仍保留退场节点
    await clock.advance(1);
    expect(scroll() === null, "购地卷轴应随点买收卷(幽灵帧走完)").toBe(true);
    expect(engine.findOwner(tile.propertyId)!.id).toBe(engine.players[0].id); // 购入落账
  });
});

describe("耗竭全自动结算(耗竭卷轴随抉择相位退役)", () => {
  // ── ⑧耗竭改全自动(外敌乘虚+休整,原「自 react-stamina 迁入」例改写)──
  // 断言面:exhaustIfDepleted 公共入口真触发 → 无任何卷轴弹出(归 0 不再进抉择相位)→
  // exhaustionSettle 留痕落账 + 种植城真实降级(接线证据兼结算完成同步)→体力色条
  // 渲染 0%(归 0 当刻不回血,卧床状态可见;回满细则归引擎单测)。惩罚结算细则
  // (诸城齐降/skipTurns/休整回满)归 test/stamina.test.ts;种植=grantProperty 拉级
  // +setStamina 压 0(判词单源 planter);都城持仓哨兵(#226)保留。
  it("体力耗竭:无卷轴、全自动落账(种植城真降级+exhaustionSettle 留痕+体力条 0%)", async () => {
    const { el, engine, plant, writeEngine, snap } = startGame([
      { kind: "armPhase", activeIndex: 0 }, // 钉活跃方到人类:interactive 门卫(decisionOwner 非 bot)
    ]);
    // 都城持仓哨兵(#226 回归直读断言,非种植):开局双写一致
    const capPropId = engine.board.tiles[engine.players[0].capitalIndex].propertyId;
    if (capPropId == null) throw new Error("接线测试:都城格无 propertyId(地图数据 bug)");
    if (!engine.players[0].properties.some((h) => h.propertyId === capPropId))
      throw new Error("接线测试:都城持仓缺失(开局双写不一致,#226 回归)");
    const taken = new Set(engine.players.flatMap((p) => p.properties.map((h) => h.propertyId)));
    const tile = engine.board.tiles.find((t) => t.propertyId != null && !taken.has(t.propertyId));
    if (tile?.propertyId == null) throw new Error("接线测试:无主城缺席(种植前提失真)");
    plant({ kind: "grantProperty", seat: 0, propertyId: tile.propertyId, level: 2 });
    plant({ kind: "setStamina", seat: 0, stamina: 0 });
    const logLenBefore = snap().log.length;
    writeEngine((e) => {
      e.exhaustIfDepleted(0); // 引擎公共入口:全自动结算(诸城降级+休整+endTurn)
    });
    expect(docQ(T.scrollShell)).toBeNull(); // 无选项相位即无卷轴
    expect(engine.turnPhase).toBe("AwaitingJinnang"); // 结算内已 endTurn 收尾(本架起手牌在册→下家入出牌阶段)
    expect(engine.players[0].properties.find((h) => h.propertyId === tile.propertyId)!.level).toBe(
      1,
    ); // 种植城 2→1 真降级
    expect(engine.players[0].stamina).toBe(0); // 归 0 当刻不回血
    expect(
      snap()
        .log.slice(logLenBefore)
        .some((l) => l.detail.includes("exhaustionSettle")),
    ).toBe(true); // 全自动结算落账的接线证据(单测守结算字段)
    // 体力上自机格(#700 仪表条退役):0 值=色条 0 宽(style 属性字面量,形态契约非几何)
    const fill = q(el, TESTIDS.seatStamina(0))!.querySelector(".strack i")!;
    expect(fill.getAttribute("style")).toMatch(/width:\s*0%/);
  });
});

describe("终局屏(自 react-scrolls/react-abort 迁入,#1317 批T3)", () => {
  // ── ⑤胜利屏(react-scrolls 胜利例迁入)──
  // 断言面:GameOver 全屏覆盖呈现(题名/称帝行/终榜/出口钮组在场)+快照终局三件套。
  // 重开钮点击=location.reload(真浏览器 API 面,happy-dom 无真值通路,ADR-0062 迁移
  // 判据)——本层只守出口钮 DOM 有无,点击腿随例退役(判词见头注)。
  it("胜利屏:GameOver 全屏覆盖(题名/称帝行/终榜/出口钮组在场)", async () => {
    const { snap } = startGame([{ kind: "armGameOver", winnerSeat: 0 }]);
    const s = snap();
    expect(s.phase).toBe("GameOver");
    expect(s.winner).not.toBeNull();
    expect(docQ(T.victoryScreen)).not.toBeNull();
    expect(docQ(T.victoryTitle)).not.toBeNull(); // 天下归一大字
    expect(docQ(T.victorySub)).not.toBeNull(); // 称帝行
    expect(docQ(T.victoryStandings)).not.toBeNull(); // 终榜一行
    // 出口钮按演出节拍延后挂载(showButton,防高潮期误触)
    expect(docQ(T.victoryRestart)).toBeNull();
    await clock.advance(UI.victoryButtonMs - 1);
    expect(docQ(T.victoryRestart)).toBeNull(); // 保护期尚差 1ms,出口仍不可点击
    await clock.advance(1);
    expect(docQ(T.victoryRestart)).not.toBeNull();
  });

  // ── ⑨对局作废(react-abort 例迁入)──
  // 断言面:引擎公共命令 abortGame(驱动链三出口的生产通路本体)→快照 GameOver 相位
  // (winReason="aborted"、winner=null,零兜底判别的数据前提)→作废面板标题+说明=
  // 「对局作废」口径+无胜者渲染(胜局专属演出元素零在场,缺席=null 断言安全)+出口
  // 按钮组在场。重开点击腿=location.reload 随例退役(同⑤判词);「fx 折叠全链」的
  // 引擎语义已在单测(test/abort-exits.test.ts / abort-presentation.test.ts),本层
  // 只守 UI 面。
  it("异常终局:abortGame→作废面板,无胜者渲染,快照相逐字", async () => {
    const { writeEngine, snap } = startGame([]);
    writeEngine((e) => e.abortGame("接线测试:注入作废(驱动链死亡出口语义)"));
    // 快照口径:作废态无胜者(零兜底判别的数据前提)
    const s = snap();
    expect(s.phase).toBe("GameOver");
    expect(s.winner).toBeNull();
    expect(s.winReason).toBe("aborted");
    // 作废面板(壳体复用 victory-screen):标题+说明=「对局作废」口径
    expect(docQ(T.victoryScreen)).not.toBeNull();
    expect(docQ(T.victoryAbortedTitle)!.textContent).toBe("对局作废");
    expect(docQ(T.victoryAbortedNote)!.textContent).toContain("详情见对局日志");
    // 无胜者渲染:胜局专属演出元素(天下归一大字/称帝行/终榜)零在场
    expect(docQ(T.victoryTitle)).toBeNull();
    expect(docQ(T.victorySub)).toBeNull();
    expect(docQ(T.victoryStandings)).toBeNull();
    // 出口按钮组与胜局同款(点击腿=location.reload,真浏览器 API 腿随例退役;
    // 按钮延后挂载节拍同⑤)
    expect(docQ(T.victoryRestart)).toBeNull();
    await clock.advance(UI.victoryButtonMs - 1);
    expect(docQ(T.victoryRestart)).toBeNull();
    await clock.advance(1);
    expect(docQ(T.victoryRestart)).not.toBeNull();
  });
});
