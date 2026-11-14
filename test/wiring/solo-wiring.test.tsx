// 接线测试(ADR-0062 层④,#1318 批T4):单机决策域三例自 e2e 迁入接线层——
// ①购地决策(react-solo「购地决策:卷轴购地扣银两 + 获得地产」)、②扩军决策
// (react-solo「扩军决策:己方城升级免费」)、③bot 托管思考态(react-solo
// 「活跃方为电脑时 WaitingBar 显示运筹中」)。react-solo 存例=脊柱②行军自动触发
// 与脊柱⑥加速到胜利(骑局),名册地板永不迁移,留 e2e。
//
// 【判层理由】判据=ADR-0062 迁移判据,判层只看断言面:①②=点卷轴钮→真命令
// (buyProperty/upgradeProperty)→快照真值(扣价入册/免费升级)+日志留痕+卷轴收+
// 相位推进,全「操作过后 store/渲染树里的语义」;③=活跃方种植为 bot→派生量
// interactive=false→WaitingBar 挂载与文案(派生渲染响应链)。零几何零像素零演出泵。
// e2e 版为竞速读数服务的 poll/freezeClock 配方(#421 冻结闸、endTurn 同步放 bot 链
// 的竞速注)在接线层整体失效:本层无房间无看门狗无 bot 链,命令结算同步收口,断言
// 直读快照即终态(零时钟零竞速,模板判词)。
//
// 【种植判词】(种植单源形,overview-wiring #1321 形制;各件判词单源 @core/planter
// 函数头注,本文件不重复)react-solo 三例的前置种植随迁换装 PlantOp:
//   - 购地:现金注资=setCash(#1299,「购价+1000」确保必买得起,本例测购地机制
//     不测购地门槛)+ 相位/行动方钉=armPhase(#1301,引擎自转无「钉相位」公共命令;
//     #188 行军自动化后停靠随骰流,决策方须钉到人类)+ 落格询问载荷=armLanding
//     (#1303 投影族,决策上下文 pendingLand 与表现投影 lastLandOutcome 一体置值);
//   - 扩军:授房产=grantProperty(#1300,升级前提「名下有城」开局初期自然到不了,
//     选址=测试侧读现值非都城无主首格)+ armPhase/armLanding 同上;
//   - bot 行动方=armPhase(#1301,自然停靠随骰流,断言面需确定的 bot 行动方)。
//
// 【渲染装配配方】(模板 = test/wiring/battle-wiring.test.tsx #1317 批T3;模板四步 + 晚绑
// 红线第 0 条 + 注册控制器第 2.5 步 + 环境缝照抄)
//   0.【晚绑红线】凡「typeof document 求值期捕获」的依赖必须晚于 ensureHappyDom
//      求值(Base UI 全族 useIsoLayoutEffect 求值期定型,静态 import 冻结成 noop、
//      弹层空壳零报错)——GameScreen 全图(含决策卷轴族/知会槽)与 controller 基类
//      依赖图一律 beforeAll 内 await import 晚绑;@core 纯逻辑(含 planter 种植件)
//      与 store/testids(零 DOM 求值期捕获)照旧静态。
//   1. beforeAll ensureHappyDom()(test/wiring/happy-dom-register.ts 局部注册/release 还原);
//   2. 真 GameEngine 直构(loadMap(guanzhong.json)+ createDice(seed)),公共命令走完
//      选都链停 Playing——种子 1486=模板既定锚(popup/overview-wiring 同源,非新
//      拍板);零时钟零竞速,种下什么相位就停什么相位。
//   2.5. 注册控制器:WiringController(GameController 生产基类最小子型)同模板,
//      dispatchCommand = engine.submitCommand + this.sync;**连地图一起注册**
//      (setController(c, guanzhongData),battle-wiring 同款——决策卷轴经 registry
//      静态上下文读城名/地产定义)。房间编排/传输/看门狗不进接线层。
//   3. 基类 sync 灌真 store,act() 内渲染真 GameScreen(生产装配本体,整屏真挂);
//   4. act() 内合成事件(dispatchEvent 冒泡)与断言,testid/aria/DOM 文本/store 状态。
//
// 【断言宪法】本层禁几何(假 DOM 无排版引擎,getBoundingClientRect 恒 0)、禁像素、
// 禁演出泵与真实时钟;本三例断言面 = testid 有无 / 按钮 disabled 属性 / DOM 文本
// (WaitingBar 文案)/ store 快照字段(现金/地产/等级/决策归属)与日志行,纯状态挂点。
//
// 【store 隔离】(模板同款)useGameStore/useNetStore 模块单例跨文件纠缠,本文件
// beforeEach/afterEach 成对调用 reset();fxStore 随 afterEach resetFx 清场(防邻域
// 事件批残留);registry 控制器随 afterEach setController(null) 释放。
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
import { SCROLL_TESTIDS } from "@app/screens/game/scroll/testids";
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

const guanzhongData = rawGuanzhongData as MapData; // JSON 导入 tier 丢字面量,cast 同 battle-wiring #1317 形
const MAP = loadMap(guanzhongData);
const SEED = 1486; // 模板既定锚(popup/overview-wiring 同源;落点形态离线核算:Playing 停靠)

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
 *  ops = 初始布场指令(PlantOp 单源逐条落种,判词见头注「种植判词」)。 */
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

/** 真点击(React 合成事件走冒泡;act 内派发,模板同款)。 */
function click(el: Element): void {
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

/** 有界等待卸载(battle-wiring 配方原样):退场协议(幽灵帧 210ms「播完再移除」)
 *  走完即卸——happy-dom 真定时器自然走时,轮询到位即收,超死线响亮红。判词:卸载
 *  后的「null 断言」必须等协议走完;协议在途就把在场 happy-dom 节点递给 expect,
 *  断言失败路径的 diff 序列化会走节点循环引用(wire3 实锤:bun 序列化爆炸 17GB
 *  死循环),waitUnmounted 保证断言吃到的是已卸载后的 null。 */
async function waitUnmounted(query: () => Element | null, label: string): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (query() != null && Date.now() < deadline) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
  }
  expect(query(), label).toBeNull();
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

describe("单机决策接线(自 react-solo 迁入,#1318 批T4)", () => {
  // ── ①购地决策(react-solo 例 2 迁入)──
  // 断言面:卷轴自动弹(scroll-buy)→买钮可用→真命令 buyProperty→快照真值
  // (扣价入册)+buy 留痕+卷轴收+相位被真命令推进。结算算术归 test/economy.test.ts
  // (单测已钉,非本层)。种植:setCash+armPhase+armLanding(判词见头注;现金注资
  // 「购价+1000」=测机制不测门槛,e2e 同判词随迁)。
  it("购地决策:卷轴购地扣银两 + 获得地产", async () => {
    const { el, engine, plant, snap } = startGame();
    // 无主城选址读现值(购价随地图再平衡,断言面不吃数值漂移,e2e 同判词随迁)
    const tile = engine.board.tiles.find(
      (t) => t.propertyId != null && engine.findOwner(t.propertyId) == null,
    );
    if (tile?.propertyId == null) throw new Error("接线测试:无主城缺席(购地布场断)");
    const pid = tile.propertyId;
    const price = engine.catalog.get(pid)!.purchasePrice;
    plant({ kind: "setCash", seat: 0, cash: price + 1000 });
    // 钉相位+行动方到人类(armPhase #1301)+ 落格询问载荷(armLanding #1303,
    // 决策上下文与表现投影一体置值)
    plant({ kind: "armPhase", turnPhase: "AwaitingDecision", activeIndex: 0 });
    plant({ kind: "armLanding", landing: { kind: "PropertyAvailable", propertyId: pid } });
    // 轮到即自动弹(交互重构:决策一律走卷轴)
    const scroll = q(el, SCROLL_TESTIDS.buyScroll);
    if (scroll == null) throw new Error("接线测试:购地卷轴未挂载(AwaitingDecision 接线断)");
    const buy = q(el, TESTIDS.actionButton("buy"));
    if (buy == null) throw new Error("接线测试:买钮缺席(卷轴装配断)");
    expect(buy.hasAttribute("disabled")).toBe(false);
    const before = snap().players[0]!.cash;
    click(buy);
    // 快照真值(结算同步收口,零竞速——无房间无看门狗,模板判词):扣价 + 入册
    const s = snap();
    expect(s.players[0]!.cash).toBe(before - price);
    expect(s.players[0]!.properties.some((h) => h.propertyId === pid)).toBe(true);
    const line = s.log.find((l) => l.category === "buy" && l.detail.startsWith("buy player=p0 "));
    if (line == null) throw new Error("接线测试:buy 留痕缺席(购地命令通路断)");
    expect(line.detail).toContain(`prop=${pid}`);
    expect(line.detail).toContain(`cash=${before - price}`); // 留痕现金=结算瞬间值
    expect(s.turnPhase).not.toBe("AwaitingDecision"); // 相位已被真命令推进(收尾交棒)
    // 卷轴收:卸载断言走 waitUnmounted(battle-wiring 配方,禁裸 toBeNull)——决策
    // 卷轴离场走幽灵帧退场协议(210ms「播完再移除」),协议在途时节点仍在场,裸
    // toBeNull 会把在场 happy-dom 节点递给 expect,断言失败路径的 diff 序列化走
    // 节点循环引用(爆炸实锤见 battle-wiring waitUnmounted 判词)。
    await waitUnmounted(() => q(el, SCROLL_TESTIDS.buyScroll), "购地卷轴应随决策清退场");
  });

  // ── ②扩军决策(react-solo 例 3 迁入)──
  // 断言面:卷轴自动弹(scroll-upgrade)→扩军钮可用→真命令 upgradeProperty→
  // 等级 +1 + 现金不变(免费)+upgrade 留痕+卷轴收+相位推进。e2e 版「点击后再读
  // 快照属与 bot 链的竞速读数」的 poll 配方在本层失效:结算同步,直读即终态。
  it("扩军决策:己方城升级免费(到达己城可选扩军,现金不变)", async () => {
    const { el, engine, plant, snap } = startGame();
    // 己方城选址读现值(非都城无主首格,授房产=升级前提种植件,e2e 同判词随迁)
    const capitalPid = engine.board.at(engine.players[0]!.capitalIndex).propertyId;
    const tile = engine.board.tiles.find(
      (t) =>
        t.propertyId != null &&
        t.propertyId !== capitalPid &&
        engine.findOwner(t.propertyId) == null,
    );
    if (tile?.propertyId == null) throw new Error("接线测试:无主城缺席(扩军布场断)");
    const pid = tile.propertyId;
    plant({ kind: "grantProperty", seat: 0, propertyId: pid, level: 0 });
    plant({ kind: "armPhase", turnPhase: "AwaitingDecision", activeIndex: 0 });
    plant({ kind: "armLanding", landing: { kind: "OwnProperty", propertyId: pid } });
    const scroll = q(el, SCROLL_TESTIDS.upgradeScroll);
    if (scroll == null) throw new Error("接线测试:扩军卷轴未挂载(OwnProperty 投影接线断)");
    const up = q(el, TESTIDS.actionButton("upgrade"));
    if (up == null) throw new Error("接线测试:扩军钮缺席(卷轴装配断)");
    expect(up.hasAttribute("disabled")).toBe(false);
    const before = snap().players[0]!.cash;
    click(up);
    // 快照真值:等级 +1 + 免费(现金不动)+ upgrade 留痕(结算瞬间值)
    const s = snap();
    expect(s.players[0]!.cash).toBe(before);
    expect(s.players[0]!.properties.find((h) => h.propertyId === pid)?.level).toBe(1);
    const line = s.log.find(
      (l) => l.category === "upgrade" && l.detail.startsWith("upgrade player=p0 "),
    );
    if (line == null) throw new Error("接线测试:upgrade 留痕缺席(扩军命令通路断)");
    expect(line.detail).toContain("level=1");
    expect(line.detail).toContain(`cash=${before}`);
    expect(s.turnPhase).not.toBe("AwaitingDecision"); // 相位已被真命令推进
    // 卷轴收:卸载断言走 waitUnmounted(幽灵帧退场协议 210ms,判词同「购地决策」例)
    await waitUnmounted(() => q(el, SCROLL_TESTIDS.upgradeScroll), "扩军卷轴应随决策清退场");
  });

  // ── ③bot 托管思考态(react-solo 例 4 迁入)──
  // 断言面:活跃方种植为 bot(armPhase #1301,断言面需确定的 bot 行动方,e2e 同
  // 判词随迁)→派生量 interactive=false(基类交互公式,#433 单源)→WaitingBar
  // 挂载且文案「运筹中…」。e2e 版的 waitFxIdle/freezeClock 配方(#987 收幕竞速注)
  // 随演出泵一并失效:本层零演出零时钟,种植后同拍即终态。
  it("bot 托管思考态:活跃方为电脑时 WaitingBar 显示「运筹中…」", () => {
    const { el, plant, snap } = startGame();
    const botIdx = snap().players.findIndex((p) => p.isBot);
    if (botIdx < 0) throw new Error("接线测试:bot 席缺席(座位表装配断)");
    plant({ kind: "armPhase", activeIndex: botIdx });
    expect(snap().decisionOwner).toBe(botIdx); // 决策归属随种植落 bot(快照透出单源)
    const bar = q(el, TESTIDS.waitingBar);
    if (bar == null) throw new Error("接线测试:WaitingBar 未挂载(非交互派生渲染断)");
    expect(q(el, TESTIDS.thinking)?.textContent).toContain("运筹中…");
  });
});
