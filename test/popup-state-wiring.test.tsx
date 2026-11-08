// 接线测试(ADR-0062 层④,#1289 批二):弹层状态机族五例自 e2e 迁入接线层——
// ①锦囊架「他人回合收起即撤/回合回来弹回」(react-jinnang-rack 例 3)、②锦囊架
// 呼吸钮 .breathe 状态机(react-jinnang-rack #1006 例④)、③技能书书格 button
// 通路 1 名可学直发命令(react-skill-book 例①)、④多名可学选人叠层点将拍板
// (react-skill-book 例②)、⑤遣散二段确认命令落账(react-hero-dismiss 例①)。
//
// 【判层理由】断言面全部是「操作过后 store/渲染树里的语义」:显隐状态机的输入
// 全来自 store 快照(回合归属/相位)与点击(会话临时态),输出=挂载有无与类名
// 挂点(.on/.breathe);书格/遣散=点击→命令→store 落账(结算语义引擎侧已由
// skill-book.test/hero-dismiss.test 钉死,本层守接线)。零几何零像素零演出泵。
// 「真实输入语义留浏览器」判例逐例标注(rack 族名册地板,本票不迁):长按
// 500ms 计时与补发 click 抑制(输入时序)、hover 挥出与几何叠加/窥条(真实排版
// 几何)、reduced-motion 入场(动画时序取证 getComputedStyle)——happy-dom 无
// 真值通路,永留浏览器(ADR-0062 迁移判据)。
//
// 【渲染装配配方】(模板 = test/war-report-wiring.test.tsx,#1288 批一;模板四步
// + 晚绑红线第 0 条照抄,本文件差异只在第 2.5 步「注册控制器」)
//   0.【晚绑红线】凡「typeof document 求值期捕获」的依赖必须晚于 ensureHappyDom
//      求值——Base UI 全族(弹层底件)的 useIsoLayoutEffect 在模块求值期按
//      document 在场与否定型:静态 import 会把整条 @base-ui 链在注册前求值,
//      layout effect 被冻结成 noop、弹层永不挂载(空壳零报错,探针实锤见模板
//      头注)。本批被测面全在弹层消费面:GameScreen 全图(HandRack/HandZone/
//      PileButtons/PileModal/SkillBookLearnModal/SettingsDialog/scroll 族)与
//      controller 基类依赖图,一律 beforeAll 内 await import 晚绑;@core 纯逻辑
//      与 store/testids(零 DOM 求值期捕获,模板同款)照旧静态。
//   1. beforeAll ensureHappyDom()(test/happy-dom-register.ts:文件内局部注册,
//      afterAll release 还原,判词见该文件头注);
//   2. 真 GameEngine 直构(loadMap(guanzhong.json)+ createDice(seed)),公共命令
//      走完选都链(doDraftRoll → aiSetupStep/pickCapital)停在 Playing——无房间
//      无时钟,引擎不自走,零泵零竞速;
//   2.5.【本文件新增:注册控制器】GameScreen 挂载门卫要 registry 静态上下文
//      (getControllerContext),交互回调走 controller.dispatchCommand——开
//      WiringController(GameController 生产基类的最小子类:单机 hotSeat 参数 +
//      dispatchCommand = engine.submitCommand(引擎统一命令口,校验全在,违例
//      当场抛)+ this.sync()(基类状态桥:snapshot/viewSeat/interactive/
//      selfPresenting 同拍刷新,与生产同一出口)),setController 注册进 registry。
//      房间编排/传输面/看门狗不进来:那是双端对跑层(③)与协议单测的领域,非
//      本层断言面(到达形制换轨判词,e2e 同构);由此零时钟零看门狗,种下什么
//      相位就停什么相位,交互链即被测环。
//   3. 基类 sync 灌真 store,act() 内渲染真 GameScreen(生产装配本体,非镜像
//      Host——本批被测面含 GameScreen 持有的 rackHidden 状态机与 PileButtons
//      接线,镜像即假测,故整屏真挂);
//   4. act() 内合成事件(dispatchEvent 冒泡)与引擎直写,断言面只许 testid/
//      类名/DOM 文本/store 状态。
//
// 【到达形制换轨判词】e2e 的「quickStart 真实开局链 + parkMyTurn 停车坪 +
// force eval」在此收敛为:种局配方(模板同款选都链)+ 进程内引擎直写(与
// force 同语义,免 eval 桥)+ 基类 sync 灌 store。点击全部真点击(合成事件
// 冒泡走 React 合成事件通路,模板同款);引擎落账走真命令(submitCommand)。
//
// 【种植判词】(e2e force 同构,断言面需要而公共命令到不了的形态才直写):
//   - 相位钉(AwaitingDecision 空闲态/AwaitingJinnang 出牌窗/Roll):引擎自转
//     无「钉相位」公共命令,窗态/空闲态即断言前提(pinRackIdle/plantBook/
//     plantOwnTurn 同判词);
//   - 回合交接(activeIndex 直写):回合交接由引擎自转驱动,无「把回合让给
//     bot」公共命令,直写是最小种植(e2e 同判词);
//   - 手牌/麾下/珍宝布场:无「发指定牌/授将/授宝」公共命令,断言面需特定形态
//     (已学双技+冷却账+净珍宝位/池序麾下+指定书),直写(e2e 同判词);技能书
//     实例用 makeSkillBook 真工厂,零手抄形状。
//   命令腿零种植:书格研读/遣散落账全部经 submitCommand 真命令执行。
//
// 【断言宪法】本层禁几何(假 DOM 无排版引擎,getBoundingClientRect 恒 0)、禁
// 像素、禁演出泵与真实时钟;本五例断言面 = testid 有无 / 类名挂点(.on/.breathe/
// .armed)/ 按钮文本 / store 快照字段,纯状态挂点与节点计数。
//
// 【store 隔离】(模板同款)useGameStore/useNetStore 模块单例跨文件纠缠,本文件
// beforeEach/afterEach 成对调用 reset();registry 控制器随 afterEach
// setController(null) 释放(destroy 契约),不留活口给邻座文件。
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
// bun 测试进程无 Vite define:GameScreen 全图经 SettingsDialog 触达 version.ts,
// 其模块求值读构建期注入的 __APP_VERSION__——此处按生产同一值源(package.json
// CalVer version,vite.config define 同源)先行注入,晚绑 import 前生效。
import pkg from "../package.json";
(globalThis as Record<string, unknown>).__APP_VERSION__ = pkg.version;
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import guanzhongData from "../public/maps/guanzhong.json";
import { loadMap } from "@core/board-loader";
import { GameEngine, type GameCommand, type SeatConfig } from "@core/authority";
import { createDice } from "@core/dice";
import type { GameEvent } from "@core/game-events";
import type { HeroSlot } from "@core/roster";
import { makeSkillBook } from "@core/treasures";
import { TESTIDS } from "@app/screens/game/testids";
import { useGameStore, type GameSnapshot } from "@app/store/gameStore";
import { useNetStore } from "@app/store/netStore";
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

const MAP = loadMap(guanzhongData);
const SEED = 1486; // 模板同款种子(e2e quickStart 谱内既定锚,非新拍板)

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

/** 挂起载荷全清(e2e plantBook/plantOwnTurn 布场头部同款;不清会与钉相位失配)。 */
function clearPending(e: GameEngine): void {
  e.pendingLand = null;
  e.pendingEncounter = null;
  e.pendingJinnang = null;
  e.pendingSkill = null;
  e.pendingReaction = null;
  e.treasureVisitor = null;
  e.pendingDebt = null;
  e.pendingExhaustionSeat = null;
}

/** 布场①:己方空闲态(AwaitingDecision)——架显隐状态机两例的停车坪(e2e
 *  pinRackIdle 的 force 同构,minus 手牌直写:两例断的正是起手牌/架显隐本身)。
 *  activeIndex=0:种局落点随种子谱可停在 bot 席(e2e 以 parkMyTurn 等一轮到人类
 *  停靠;接线层无房间无 bot 链,直写同前提,回合交接写同判词见头注)。 */
function plantIdleDecision(e: GameEngine): void {
  e.activeIndex = 0;
  e.lastLandOutcome = null;
  e.pendingLand = null;
  e.turnPhase = "AwaitingDecision";
}

/** 布场②(e2e plantBook 同构):己方(座位 0)出牌阶段卡牌段 + 麾下 heroes(池序
 *  skillIds)+ 珍宝位塞一本真技能书;开局手牌清空——书=窗内可用项唯一来源,判据
 *  不被开局锦囊牌路污染(e2e 同判词)。activeIndex=0 同布场①判词。 */
function plantBook(e: GameEngine, skillId: string, heroes: HeroSlot[]): void {
  clearPending(e);
  e.activeIndex = 0;
  const me = e.players[0];
  me.jinnangHand = [];
  me.jinnangHandCount = 0;
  for (const h of heroes) {
    me.heroes.push(h);
    e.recruitedHeroIds.add(h.heroId);
  }
  me.treasures.push(makeSkillBook(skillId));
  e.turnPhase = "AwaitingJinnang";
}

/** 布场③(e2e plantOwnTurn 同构):己方自己回合(Roll 相位)+ 麾下周瑜(已学
 *  火攻+擂鼓,火攻挂冷却账)+ 清珍宝位(折书判据纯净)。activeIndex=0 同布场①判词。 */
function plantOwnTurn(e: GameEngine): void {
  clearPending(e);
  e.activeIndex = 0;
  const me = e.players[0];
  me.heroes.length = 0;
  me.heroes.push({ heroId: "zhouyu", skillIds: ["huogong", "leigu"], lastFired: { huogong: 3 } });
  e.recruitedHeroIds.add("zhouyu");
  me.treasures.length = 0;
  e.turnPhase = "Roll";
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

/** 种局→布场→注册控制器→基类 sync 灌 store→挂屏(每例开头同款一条龙)。
 *  force = 进程内引擎直写 + 重灌 store(e2e force 的无桥同构,判词见头注)。 */
function startGame(plant: (e: GameEngine) => void): {
  el: HTMLElement;
  force: (write: (e: GameEngine) => void) => void;
  snap: () => GameSnapshot;
} {
  const e = seedPlayingEngine();
  plant(e);
  const c = newWiringController(e);
  setController(c);
  act(() => {
    c.resync();
  });
  const el = mount();
  return {
    el,
    force: (write) => {
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

/** 异步拍收口:弹层壳内的 ScrollArea 底件挂载拍有 RO 测量态更新,回调在 act 外
 *  落会刷 act 警告噪声——开弹层后让一拍宏任务并包进 act,测量拍在包裹内跑完
 *  (断言面不依赖该拍,纯噪声治理)。 */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

/** 事件按 kind 取批(快照 events=当前转移批;谓词内 kind 再收窄取字段)。 */
function eventsOf(snap: GameSnapshot, kind: GameEvent["kind"]): GameEvent[] {
  return snap.events.filter((ev) => ev.kind === kind);
}

/** 弹层查询口:PileModal/SkillBookLearnModal 经 Portal 渲染在 body,一律 document 级。 */
const modalQ = (id: string): Element | null => q(document, id);

beforeAll(async () => {
  ensureHappyDom();
  // 环境缝(matchMedia stub 同族,#1284 配方):happy-dom 无排版引擎,底板 svg
  // clientWidth/Height 恒 0——boardHost 的 commit 拍真值断言(ensureBoardPxPerUnit,
  // 零兜底设计)当场炸;document.fonts.ready 同缺席。给中性真值(844×390 标准档)
  // 让生产代码走通挂载,断言面不碰任何几何(断言宪法)——几何哨族(棋盘景深/
  // 合成层)永留浏览器,本 shim 不放大其绿。happy-dom 注册生命周期内生效,release
  // 后随注册体整体丢弃,零跨文件泄漏。
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
  // + 基类 sync 状态桥(头注第 2.5 步;房间编排/传输/看门狗是层③领域不进来)。
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
    // 测试侧重灌口(protected sync 的公开面;直写引擎后调)。
    resync(): void {
      this.sync();
    }
  }
  newWiringController = (e) => new WiringControllerImpl(e);
});

beforeEach(() => {
  useGameStore.getState().reset();
  useNetStore.getState().reset();
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
});

afterAll(async () => {
  // 排干 React 调度器余拍(scheduler 宏任务可能晚于卸载在途):release 后再触发
  // 会在无 window 环境抛「window is not defined」,污染跨文件跑面——window 还在时
  // 让完这一拍再拆 happy-dom。
  await new Promise((r) => setTimeout(r, 0));
  await releaseHappyDom();
});

describe("弹层状态机接线(ADR-0062 层④,#1289 批二)", () => {
  // ── ①锦囊架「收起即隐/再点回亮」(react-jinnang-rack 例 3 迁入,#1289 批二)──
  // 显隐状态机断言面:回合交出(activeIndex 离席)→ 架整区卸载+开关撤亮;回合
  // 回来 → 自动弹回+开关复亮。挂载有无与类名挂点,零几何(收沿贴底位移等几何腿
  // 留浏览器地板例)。长按/hover 真实输入语义留浏览器(头注判例)。
  it("他人回合:架自动收起(回合交出即撤);回合回来自动弹回", () => {
    const { el, force, snap } = startGame(plantIdleDecision);
    const toggle = () => q(el, TESTIDS.jinnangToggle)!;
    // 我的回合空闲态:架亮(handZone 在场,开关 .on)
    expect(q(el, TESTIDS.handZone)).not.toBeNull();
    expect(toggle().className).toContain("on");
    // 回合交出(activeIndex 直写 bot,种植判词见头注):decisionOwner 随派生离席,
    // 架自动收起(整区卸载),开关撤亮。
    force((e) => {
      e.activeIndex = e.players.findIndex((p) => p.isBot);
    });
    expect(snap().decisionOwner).not.toBe(0);
    expect(q(el, TESTIDS.handZone)).toBeNull();
    expect(toggle().className).not.toContain("on");
    // 回合回来:我的回合亮沿自动弹回(架回场,钮亮态)。
    force((e) => {
      e.activeIndex = e.players.findIndex((p) => !p.isBot);
    });
    expect(q(el, TESTIDS.handZone)).not.toBeNull();
    expect(toggle().className).toContain("on");
  });

  // ── ②呼吸钮 .breathe 状态机(react-jinnang-rack #1006 例④迁入,#1289 批二)──
  // 呼吸=窗态∧收起(「有活决策被收起来了」,状态表达 §4.6 零文字):非窗态收起
  // 无呼吸、窗态亮架不呼吸、窗内收起挂 .breathe、窗落沿按规则重对齐抹平手动态。
  // 纯类名挂点四态走查;呼吸金光的视觉存在归 visual-compare。
  it("呼吸钮:窗态+收起才挂 .breathe;非窗态收起与窗态亮架均无该 class", () => {
    const { el, force } = startGame(plantIdleDecision);
    const toggle = () => q(el, TESTIDS.jinnangToggle)!;
    const breathe = () => toggle().className.includes("breathe");
    // 非窗态收起:无呼吸(「有活决策被收起来」只在窗态成立)
    click(toggle());
    expect(q(el, TESTIDS.handZone)).toBeNull();
    expect(breathe()).toBe(false);
    // 窗态开场亮沿先弹回(亮沿②);窗态亮架不呼吸——呼吸=窗态∧收起,非「窗态」
    // 单条件(动作条在场=窗态证据)。
    click(toggle());
    force((e) => {
      e.turnPhase = "AwaitingJinnang";
    });
    expect(q(document, TESTIDS.actionbar)).not.toBeNull();
    expect(breathe()).toBe(false);
    // 窗内收起:呼吸金光挂上(类名挂点,开关与钮同态)
    click(toggle());
    expect(q(el, TESTIDS.handZone)).toBeNull();
    expect(breathe()).toBe(true);
    // 窗落(仍在我的回合):窗落沿按规则重对齐——我的回合=亮,窗内手动收起被抹平
    // (手动只活沿间,回合联动语义);呼吸随窗态退场。
    force((e) => {
      e.turnPhase = "AwaitingDecision";
    });
    expect(q(el, TESTIDS.handZone)).not.toBeNull();
    expect(breathe()).toBe(false);
  });

  // ── ③书格 button 通路·1 名可学(react-skill-book 例①迁入,#1289 批二)──
  // 点击链全真:珍宝钮→藏品弹层→书格真 button→GameScreen onUseBook→useBookSkill
  // 命令→引擎落账→store→渲染树。断言面=快照真值(书消耗/池序入槽/skillLearned
  // 随批/窗口停留);学技结算算术单测在 skill-book.test(非本层断言面)。
  it("书可点态(1 名可学):点书研读——书消耗、池序入槽、skillLearned 随批", async () => {
    const { el, snap } = startGame((e) =>
      plantBook(e, "leigu", [{ heroId: "zhouyu", skillIds: ["huogong"], lastFired: {} }]),
    );
    click(q(el, TESTIDS.pileTreasures)!);
    await settle();
    const modal = modalQ(TESTIDS.treasureModal);
    if (modal == null) throw new Error("接线测试:珍宝弹层未挂载(藏品入口接线断)");
    const bookBtn = modalQ(TESTIDS.bookUse("skillbook-leigu"));
    if (bookBtn == null) throw new Error("接线测试:书格可点态缺席(bookPlayReady 通路断)");
    click(bookBtn);
    await settle();
    // 快照真值:书消耗 + 池序入槽(周瑜池 [疾行,火攻,擂鼓] → [火攻,擂鼓])+ 学技
    // 事件随批;学得的擂鼓=主动技即刻就绪:窗口不误收(相位不动)。
    const s = snap();
    expect(s.players[0].treasures.filter((t) => t.kind === "book")).toHaveLength(0);
    expect(s.players[0].heroes[0]?.skillIds).toEqual(["huogong", "leigu"]);
    expect(
      eventsOf(s, "skillLearned").some(
        (ev) => ev.kind === "skillLearned" && ev.skillId === "leigu" && ev.heroId === "zhouyu",
      ),
    ).toBe(true);
    expect(s.turnPhase).toBe("AwaitingJinnang");
  });

  // ── ④多名可学选人叠层(react-skill-book 例②迁入,#1289 批二)──
  // 两名池含此技未习得 → 书格点击开选人叠层(PileShell 制式)→ 点将拍板:书消耗/
  // 指定将池序入槽/层随结算收口(setLearnPick 同步卸载,非退场协议)全真。
  it("多名可学弹窗:两名池含此技未习得 → 选人叠层点将拍板", async () => {
    const { el, snap } = startGame((e) =>
      plantBook(e, "jixing", [
        { heroId: "zhouyu", skillIds: ["huogong"], lastFired: {} }, // 周瑜池含疾行
        { heroId: "zhangxingcai", skillIds: ["leigu"], lastFired: {} }, // 张星彩池含疾行
      ]),
    );
    click(q(el, TESTIDS.pileTreasures)!);
    await settle();
    click(modalQ(TESTIDS.bookUse("skillbook-jixing"))!);
    await settle();
    const learn = modalQ(TESTIDS.bookLearnModal);
    if (learn == null) throw new Error("接线测试:选人叠层未挂载(多名可学分流断)");
    click(modalQ(TESTIDS.bookLearnItem("zhangxingcai"))!);
    // 快照真值:书消耗 + 指定将(张星彩)池序入槽 + 周瑜不动 + 叠层随结算收口。
    const s = snap();
    expect(s.players[0].treasures.filter((t) => t.kind === "book")).toHaveLength(0);
    expect(s.players[0].heroes[1]?.skillIds).toEqual(["leigu", "jixing"]);
    expect(s.players[0].heroes[0]?.skillIds).toEqual(["huogong"]);
    expect(modalQ(TESTIDS.bookLearnModal)).toBeNull();
  });

  // ── ⑤遣散二段确认(react-hero-dismiss 例①迁入,#1289 批二)──
  // 首点武装「确认遣散」(误触防线,armed 类+文案翻面)→ 再点发命令:槽移除/
  // 免费(现金不动)/已学技逐册折书入位/heroDismissed+treasureGained 事件随批/
  // 回池划名,快照真值逐项断言;结算语义单测在 hero-dismiss.test(非本层)。
  it("遣散主链:二段确认→槽移除/免费/折书入位/事件随批/回池划名", async () => {
    const { el, snap } = startGame(plantOwnTurn);
    const cash0 = snap().players[0].cash; // 遣散前现金(免费判据基准)
    click(q(el, TESTIDS.pileHeroes)!);
    await settle();
    const heroModal = modalQ(TESTIDS.heroModal);
    if (heroModal == null) throw new Error("接线测试:名将弹层未挂载(藏品入口接线断)");
    const btn = modalQ(TESTIDS.heroDismiss("zhouyu"));
    if (btn == null) throw new Error("接线测试:遣散钮缺席(麾下布场断)");
    expect(btn.hasAttribute("disabled")).toBe(false); // 己回合可用
    click(btn); // 第一段:武装
    expect(btn.textContent).toBe("确认遣散"); // 二段确认惯例(误触防线)
    expect(btn.className).toContain("armed");
    click(btn); // 第二段:发命令
    // 快照真值:槽移除 + 免费现金不动 + 两册折书(skillbook-<skillId>)+ 回池划名
    // + heroDismissed/treasureGained 事件随批(TreasureGained 时机零特判:每册一条)。
    const s = snap();
    expect(s.players[0].heroes).toHaveLength(0); // 槽移除(冷却随槽消失)
    expect(s.players[0].treasures.filter((t) => t.kind === "book").map((t) => t.skillId)).toEqual([
      "huogong",
      "leigu",
    ]); // 已学技逐册折书(结算序=槽内序)
    expect(s.players[0].cash).toBe(cash0); // 免费(与破产变卖 200 两分流)
    expect(s.recruitedHeroIds.includes("zhouyu")).toBe(false); // 回池划名
    expect(
      eventsOf(s, "heroDismissed").some(
        (ev) => ev.kind === "heroDismissed" && ev.heroId === "zhouyu",
      ),
    ).toBe(true);
    expect(eventsOf(s, "treasureGained")).toHaveLength(2);
  });
});
