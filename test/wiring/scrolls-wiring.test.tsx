// 关键接线:真实组件与控制器验证命令/状态或私密信息通路,不验证几何和演出。
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
// bun 测试进程无 Vite define:GameScreen 全图经 SettingsDialog 触达 version.ts,其
// 模块求值读构建期注入的 __APP_VERSION__——按生产同一值源(package.json CalVer)先行
// 注入,晚绑 import 前生效(模板同款,#1297 波评审备案:留置不还原,无害)。
import { useFxStore } from "@app/fx/fxStore";
import { GHOST, UI } from "@app/fx/timings";
import { SCROLL_TESTIDS as T } from "@app/screens/game/scroll/testids";
import { TESTIDS } from "@app/screens/game/testids";
import { useGameStore, type GameSnapshot } from "@app/store/gameStore";
import { useNetStore } from "@app/store/netStore";
import { GameEngine, type GameCommand, type SeatConfig } from "@core/authority";
import type { MapData } from "@core/board-loader";
import { loadMap } from "@core/board-loader";
import { createDice } from "@core/dice";
import { heroById } from "@core/heroes";
import { formatMoney } from "@core/money";
import { applyPlant, type PlantOp } from "@core/planter";
import { guidePriceOf } from "@core/treasures";
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
