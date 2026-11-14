// 接线测试(ADR-0062 层④,#1318 批T4):机遇域一例自 e2e 迁入接线层——「机遇
// 开关开局 + 声望渲染 + 抉择机遇卷轴弹出并结算」(react-encounters,迁尽→整文件
// 删;慢池贵例 40.2s 下放接线层毫秒级)。react-encounters 存例已清空,慢池 -1。
//
// 【判层理由】判据=ADR-0062 迁移判据,判层只看断言面:开关=引擎 encounter.enabled
// 构造入参显式(接线层直构引擎,无需 e2e 的「拨开关→读引擎回执」fail-fast 回读——
// 构造入参就在被测三行内,回读属自证);被测环=真命令 rollAndMove 真实行军真实落格
// →机遇必出(ADR-0035)抽中抉择型→卷轴真实弹出→点选项真命令 resolveEncounterChoice
// →结算落账→声望徽章 DOM 渲染。全「操作过后 store/渲染树里的语义」:卷轴/选项
// testid 有无、按钮 disabled 属性、徽章 aria 文本、快照声望真值。零几何零像素零
// 演出泵。引擎机遇抽取/结算算术与必出制归 test/encounters.test.ts + 金账(单测已钉,
// 非本层);e2e 版的 120s 等卷轴 poll 与 seed 67 钉时点配方,在本层收敛为「确定性
// 到达」:seed 19 + 钉骰 die=1 离线核算必抽中抉择型「摸金」(两选项皆可用),零等待
// 零概率(概率性不可靠零容忍,#987 同口径)。
//
// 【到达形制换轨判词】(与分类表 react-encounters 行注同源)e2e 的「真实对局自走
// 卷轴真弹」= 开关开 + 真实落格;接线层同语义:开关开(构造入参)+ 真实落格
// (rollAndMove 真命令走真 march 链,机遇由 maybeApplyEncounter 真抽取)——行军
// 骰值钉 die=1 是确定性族种植件(pinDice #1302 测试替身,判词单源 planter),替的
// 是骰值不是被测环;e2e 的 seedSolo quickStart 语义同源(构造器种局+机遇开),非
// 第二条通路。卷轴点选走真 UI 点击(合成事件冒泡),命令经 WiringController。
//
// 【种植判词】(种植单源形;各件判词单源 @core/planter 函数头注,本文件不重复)
// 骰值钉=pinDice(march 通道,#1302):「指定掷点」无公共通路,落点确定性是断言面
// 前提。其余零种植:落格、机遇抽取、结算、落格续跑全真链。
//
// 【渲染装配配方】(模板 = test/wiring/battle-wiring.test.tsx #1317 批T3;模板四步 + 晚绑
// 红线第 0 条 + 注册控制器第 2.5 步 + 环境缝照抄)
//   0.【晚绑红线】凡「typeof document 求值期捕获」的依赖必须晚于 ensureHappyDom
//      求值(Base UI 全族 useIsoLayoutEffect 求值期定型,静态 import 冻结成 noop、
//      弹层空壳零报错)——GameScreen 全图(含机遇卷轴族/席位格)与 controller 基类
//      依赖图一律 beforeAll 内 await import 晚绑;@core 纯逻辑(含 planter 种植件)
//      与 store/testids(零 DOM 求值期捕获)照旧静态。
//   1. beforeAll ensureHappyDom()(test/wiring/happy-dom-register.ts 局部注册/release 还原);
//   2. 真 GameEngine 直构(loadMap(guanzhong.json)+ createDice(seed)),公共命令走完
//      选都链停 Playing——种子 19=离线核算既定锚(本文件下注:开局 Roll 停靠、人类
//      先手、掷 1 必抽中「摸金」抉择机遇);机遇开关开=本域被测前提(引擎缺省关
//      属测试隔离默认,本域显式开),除此之外零时钟零竞速。
//   2.5. 注册控制器:WiringController(GameController 生产基类最小子型)同模板,
//      dispatchCommand = engine.submitCommand + this.sync,**连地图一起注册**
//      (setController(c, guanzhongData)——卷轴层经 registry 静态上下文读城名)。
//      房间编排/传输/看门狗不进接线层(行军自动起摇=层③看门狗语义,本层掷骰由
//      测试侧发真命令驱动,被测环从落格起算)。
//   3. 基类 sync 灌真 store,act() 内合成事件(dispatchEvent 冒泡)与断言;
//   4. 断言面=testid 有无/按钮 disabled 属性/aria 文本/store 快照字段。
//
// 【断言宪法】本层禁几何(假 DOM 无排版引擎,getBoundingClientRect 恒 0)、禁像素、
// 禁演出泵与真实时钟;本例断言面 = 卷轴/选项 testid 有无、按钮 disabled 属性、
// 声望徽章 aria 文本、快照声望/现金真值,纯状态挂点。
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
// 种子 19 离线核算锚(换锚=机遇目录/抽取权重变更,应显式重核算而非放宽断言):
// 选都链后开局 Roll 停靠、人类(0)先手、落都 tile 9;钉骰掷 1 真实落格 tile 10,
// 机遇必出抽中抉择型「摸金」(中性,两选项皆可用:「遣校尉发丘」声望 −15 得银 300 /
// 「封冢而还」声望 +5 无花销)。
const SEED = 19;
const DIE = 1;
/** 「封冢而还」选项下标与结算真值(离线核算,随锚注走)。 */
const OPT_DECLINE_LOOT = 1;
const REP_AFTER = 5;

/** 座位表:与模板同(solo 口径 seat 0 = 自机)。 */
const SEATS: SeatConfig[] = [
  { name: "座 1", isBot: false, guohao: "魏" },
  { name: "座 2", isBot: true },
  { name: "座 3", isBot: true },
  { name: "座 4", isBot: true },
];

/** 种引擎到 Playing 停靠(公共命令链,模板 seedPlayingEngine 同款;非法态当场
 *  抛错不静默)。与模板唯一差异=机遇开关开:本域被测前提(产品默认来自 jiyu.json,
 *  e2e 同语义经设置屏拨开)。 */
function seedPlayingEngine(): GameEngine {
  const e = new GameEngine(MAP.board, MAP.catalog, createDice(SEED), {
    seats: SEATS,
    targetNetWorth: MAP.targetNetWorth,
    startingCash: MAP.startingCash,
    startingTreasures: MAP.startingTreasures,
    seed: SEED,
    mapId: "guanzhong",
    encounter: { enabled: true }, // 机遇必出(ADR-0035):本域被测前提,构造入参显式
  });
  e.doDraftRoll();
  while (e.phase === "Setup") {
    if (!e.aiSetupStep()) {
      const r = e.pickCapital(e.currentSetupPlayerIndex, Math.min(...e.offeredCapitals));
      if (!r.ok) throw new Error(`种局:选都被拒(${r.reason ?? "未知"})`);
    }
  }
  if (e.phase !== "Playing") throw new Error(`种局:选都链后非 Playing(phase=${e.phase})`);
  // 出牌窗放行(#1389 起火烧连营改任意城当中心,开局第 1 回合恒有合法目标=窗恒开,
  // 不再直落 Roll):与 UI「不出」同一命令(今不用,牌不消耗),停靠锚语义不变=开局 Roll。
  if (e.turnPhase === "AwaitingJinnang") e.submitCommand({ type: "useJinnang", cardId: null });
  if (e.turnPhase !== "Roll") throw new Error(`种局:开局非 Roll 停靠(turnPhase=${e.turnPhase})`);
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
 *  dispatch = 生产命令腿真漏斗(WiringController.dispatchCommand:submitCommand+
 *  sync,与 UI 点击 onCommand 同一条路);plant = 拍间补种+resync 重灌。 */
function startGame(ops: PlantOp[] = []): {
  el: HTMLElement;
  engine: GameEngine;
  dispatch: (cmd: GameCommand) => void;
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
    dispatch: (cmd) => {
      act(() => {
        c.dispatchCommand(cmd);
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
 *  断言失败路径的 diff 序列化会走节点循环引用(爆炸实锤见 battle-wiring
 *  waitUnmounted 判词)。 */
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
  // 排干 React 调度器余拍(模板同款)再拆 happy-dom。
  await new Promise((r) => setTimeout(r, 0));
  await releaseHappyDom();
});

describe("机遇卷轴接线(自 react-encounters 迁入,#1318 批T4)", () => {
  // 断言面(e2e 判词随迁):开关开(构造入参)→ 真命令行军真实落格 → 机遇必出抽中
  // 抉择型 → 卷轴弹出(≥2 真实选项)→ 点选项收卷真结算 → 声望徽章渲染落账值。
  // 声望断言吃确定性锚的精确值(声望 0 → +5):比 e2e 的 /声望 -?\d+/ 正则更强——
  // e2e 放宽是负载下档位分布漂移的 armor,接线层确定性到达无需 armor;锚注见头注
  // SEED 注(机遇目录/抽取权重变更时应显式重核算,放宽断言=假绿)。落格续跑
  // (机遇解完续落格结算)由相位推进自证。
  it("机遇开关 + 声望渲染 + 抉择机遇卷轴弹出并结算", async () => {
    const { el, dispatch, snap } = startGame([
      { kind: "pinDice", channel: "march", values: [DIE] }, // 骰值替身(确定性到达,判词见头注)
    ]);
    // 声望渲染初值:席位格声望徽章(#700 仪表条退役,aria 即名词+值)
    const repBadge = q(el, TESTIDS.seatAttr(0, "rep"));
    if (repBadge == null) throw new Error("接线测试:声望徽章未挂载(席位格装配断)");
    expect(repBadge.getAttribute("aria-label")).toBe("声望 0");
    // 真命令行军:掷骰→行军→真实落格→机遇必出(ADR-0035)→抽中抉择型挂起
    expect(q(el, SCROLL_TESTIDS.encounterScroll)).toBeNull(); // 卷轴未弹(掷骰前)
    dispatch({ type: "rollAndMove" });
    expect(snap().turnPhase).toBe("AwaitingEncounter"); // 抉择机遇占用本落格(#124)
    const scroll = q(el, SCROLL_TESTIDS.encounterScroll);
    if (scroll == null) throw new Error("接线测试:机遇卷轴未挂载(AwaitingEncounter 接线断)");
    // 异步拍收口(battle-wiring settle 同款):卷轴壳内 ScrollArea 底件挂载拍有 RO
    // 测量态更新,回调在 act 外落会刷 act 警告噪声——让一拍宏任务并包进 act
    // (断言面不依赖该拍,纯噪声治理)。
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    // ≥2 真实选项(抉择型判据;不可用项才会 disabled,本锚两选项皆可用)
    const opt = q(el, SCROLL_TESTIDS.encounterOption(OPT_DECLINE_LOOT));
    if (opt == null) throw new Error("接线测试:机遇选项缺席(卷轴选项装配断)");
    expect(opt.hasAttribute("disabled")).toBe(false);
    // 点第一可用选项收卷:真命令 resolveEncounterChoice → 结算落账 → 卷轴收
    // (卸载断言走 waitUnmounted:决策卷轴离场走幽灵帧退场协议 210ms,判词见 helper 注)
    click(opt);
    // 异步拍收口(同上):落格续跑后接续弹出的下家卷轴(购地)挂载拍有 RO 测量态
    // 更新,回调在 act 外落会刷 act 警告噪声——让一拍宏任务并包进 act。
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    await waitUnmounted(() => q(el, SCROLL_TESTIDS.encounterScroll), "机遇卷轴应随结算退场");
    expect(snap().turnPhase).not.toBe("AwaitingEncounter"); // 相位被真命令推进(落格续跑)
    // 声望渲染落账值:「封冢而还」声望 +5(0→5),徽章 aria 随快照重渲
    expect(repBadge.getAttribute("aria-label")).toBe(`声望 ${REP_AFTER}`);
    expect(snap().players[0]!.reputation).toBe(REP_AFTER);
  });
});
