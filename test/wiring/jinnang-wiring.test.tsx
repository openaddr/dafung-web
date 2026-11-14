// 接线测试(ADR-0062 层④,#1315 批T1):锦囊域四族八例自 e2e 迁入接线层——
// ①手牌架「点牌详情含牌名全文/Esc 关闭」(react-jinnang-rack 例 1)、②出牌窗灰置牌
// 「aria-disabled+印条,点击开详情,零命令通路」(react-jinnang-rack #715 例 1)、
// ③④⑤窥探弹层「打出四击链→弹层出现/牌名可见/关闭无残留/空态/识破不弹」
// (react-jinnang-peek ×3)、⑥secrecy 可见性「己方牌面/他人计数章/他人牌面零 DOM」
// (react-jinnang 例 1)、⑦⑧目标段选自己「金圈/停持/轻晃/自疗落账」(react-self-target ×2)。
//
// 【判层理由】判据=ADR-0062 迁移判据,判层只看断言面:①②=点击→详情弹层 DOM 有无
// 与文本/aria 挂点+快照零命令证伪;③④⑤=点击→命令→事件批→弹层挂载与 testid 有无
// (快照零账本/零事件为负向锁);⑥=渲染树 DOM 有无+store 快照字段+席位徽章 aria
// (他人牌面零 DOM 是投影契约的 UI 面);⑦⑧=类名挂点(.candidate/.picked/.shake/
// .off)+aria 属性+快照落账真值(体力色条 width 百分比是 style 属性断言非几何量测,
// 格上体力色条的形态契约就是百分比字面量)。零几何零像素零演出泵。
//
// 【渲染装配配方】(模板 = test/wiring/popup-state-wiring.test.tsx,#1289 批二;模板四步 +
// 晚绑红线第 0 条 + 注册控制器第 2.5 步照抄,本文件差异见「表现消费腿」与「种植件」)
//   0.【晚绑红线】凡「typeof document 求值期捕获」的依赖必须晚于 ensureHappyDom
//      求值(Base UI 全族 useIsoLayoutEffect 在模块求值期按 document 在场定型;
//      静态 import 冻结成 noop、弹层空壳零报错,模板头注探针实锤)——GameScreen
//      全图、controller 基类依赖图与 fx 表现链(orchestrator→DiceOverlay/ sinks)
//      一律 beforeAll 内 await import 晚绑;@core 纯逻辑(含 planter 种植件)与
//      store/testids(零 DOM 求值期捕获)照旧静态。
//   1. beforeAll ensureHappyDom()(test/wiring/happy-dom-register.ts 局部注册/release 还原);
//   2. 真 GameEngine 直构(loadMap(guanzhong.json)+ createDice(seed)),公共命令走完
//      选都链停 Playing——seed 67 = 锦囊族 e2e 谱内既定锚(react-jinnang/peek/
//      self-target 三 spec 同源离线核算:人类先手、起手求贤令、开局出牌阶段
//      AwaitingJinnang 停靠),零种植即达三族共同到站态。
//   2.5. 注册控制器:WiringController(GameController 生产基类最小子型)同模板——
//      dispatchCommand = engine.submitCommand + this.sync;房间编排/传输/看门狗不进
//      接线层,零时钟零竞速,种下什么相位就停什么相位。
//   3. 基类 sync 灌真 store,act() 内渲染真 GameScreen(生产装配本体,整屏真挂);
//   4. act() 内合成事件(dispatchEvent 冒泡)与断言,testid/类名/DOM 文本/store 状态。
//
// 【表现消费腿(本文件新增,peek 族专用)】窥探弹层是 fxStore 开关态(peekApplied
// 表现事件驱动,PeekModal 头注),接线被测环含「命令→事件批→表现→弹层 DOM」——
// 命令批经 extractBatchEvents(单机/联机同一消费函数)+ present(真编排器,peekRevealed
// 同步下发零定时器)+ createEngineSink(真 sink)进 fxStore,与生产
// LocalController.onMessage("events")→SnapshotEffects 直译同一条管线,只是免去房间
// 队列/校准封装(那是层③领域)。prePositions 走签名缺省「全未知」口(既定形,本族
// 批无行军转移;行军批不在此层消费)。批内伴生的出牌线/浮字是生产同批产物,其自清
// setTimeout 回调纯 zustand set(不触 window,release 后无害);afterEach resetFx
//(生产换局清场原样口)防跨例泄漏。
//
// 【种植判词】全部经 @core/planter 种植件(giveJinnang/armHero/setCash/setStamina/
// giveTreasure/armPhase)——「单测/无头层直接 import 本模块函数」是种植件形制的既定
// 消费方式(#1295),各件判词单源在 planter 函数头注,本文件不重复;⑥secrecy 例零
// 种植(seed 67 离线核算天然凑齐断言面,react-jinnang.spec 同源,#1215 判词随迁)。
// 识破例的 isBot 翻转+resolveJinnang/respondReaction 直呼(引擎公共方法=合法漏斗,
// 非「凭空造局」):bot 即席代答按 isBot 判定(ADR-0017),无「挂起代答」公共通路,
// 翻人让窗挂起到应答拍是唯一种植口(e2e 同判词,单拍全同步零超时代答竞速)。
//
// 【断言宪法】本层禁几何(假 DOM 无排版引擎,getBoundingClientRect 恒 0)、禁像素、
// 禁演出泵与真实时钟;本八例断言面 = testid 有无 / 类名挂点(.sel/.off/.candidate/
// .picked/.shake/.hface)/ aria 属性 / style 属性字面量(体力色条 width 百分比)/
// DOM 文本 / store 快照字段与事件批,纯状态挂点与节点计数。
//
// 【store 隔离】(模板同款)useGameStore/useNetStore 模块单例跨文件纠缠,本文件
// beforeEach/afterEach 成对调用 reset();fxStore 随 afterEach resetFx 清场(表现
// 开关态不跨例);registry 控制器随 afterEach setController(null) 释放。
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
import { GameEngine, type GameCommand, type SeatConfig } from "@core/authority";
import { createDice } from "@core/dice";
import { jinnangCardOf } from "@core/jinnang";
import { armHero, armPhase, giveJinnang, giveTreasure, setCash, setStamina } from "@core/planter";
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
type ExtractModule = typeof import("@app/fx/event-extract");
type OrchestratorModule = typeof import("@app/fx/orchestrator");
type SinksModule = typeof import("@app/fx/sinks");
let GameScreen: GameScreenModule["GameScreen"];
let setController: RegistryModule["setController"];
let extractBatchEvents: ExtractModule["extractBatchEvents"];
let present: OrchestratorModule["present"];
let createEngineSink: SinksModule["createEngineSink"];

/** 接线控制器面(GameController 生产基类的最小子型 + resync 测试口;构造见 beforeAll)。 */
type WiringController = GameControllerClass & { resync(): void };
let newWiringController: (e: GameEngine) => WiringController;

const MAP = loadMap(guanzhongData);
const SEED = 67; // 锦囊族既定锚(react-jinnang/peek/self-target 三 spec 同源离线核算,头注第 2 步)

/** 座位表:与模板同(solo 口径 seat 0 = 自机)。 */
const SEATS: SeatConfig[] = [
  { name: "座 1", isBot: false, guohao: "魏" },
  { name: "座 2", isBot: true },
  { name: "座 3", isBot: true },
  { name: "座 4", isBot: true },
];

/** 种引擎到 Playing 停靠(公共命令链,模板 seedPlayingEngine 同款;非法态当场
 *  抛错不静默)。seed 67 落点:开局出牌阶段态(turnPhase=AwaitingJinnang、手各 1、
 *  牌库 14),react-jinnang.spec 头注离线核算同款。 */
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

/** 种局→布场→注册控制器→基类 sync 灌 store→挂屏(每例开头同款一条龙)。
 *  writeEngine = 进程内引擎直写 + 重灌 store(与 e2e 种植件裸写形同语义的无桥同构,
 *  判词见模板头注;旧名 force 已随 #1303 退役,勿复用)。 */
function startGame(plant: (e: GameEngine) => void): {
  el: HTMLElement;
  engine: GameEngine;
  writeEngine: (write: (e: GameEngine) => void) => void;
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
    engine: e,
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

/** Esc 关闭(底件 document 级 keydown 监听;act 内派发)。 */
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
  setController = registryMod.setController;
  extractBatchEvents = extractMod.extractBatchEvents;
  present = orchMod.present;
  createEngineSink = sinksMod.createEngineSink;
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

describe("手牌架点牌详情与灰置印条(自 react-jinnang-rack 迁入,#1315 批T1)", () => {
  // #1423:检视与选择只属于当前屏前玩家的当前渲染项。命令与状态经生产装配，
  // 仅断 DOM/aria/store；横滚几何、拖动抑制与跨旧时限留真浏览器，不在假 DOM 等时钟。
  it("全展检视:重复牌独立续选，详情/目标段结束，牌序与身份变更不残留", () => {
    const cards = ["求贤令", "求贤令", "军情密探", "识破诡计"];
    const { el, writeEngine, snap } = startGame((e) => {
      giveJinnang(e, 0, cards);
      giveJinnang(e, 1, cards);
      armHero(e, 0, "huatuo", ["qingnang", "zhenji"]);
      setCash(e, 0, 2000);
      setStamina(e, 0, 50);
    });
    const badge = () => q(el, TESTIDS.jinnangSpreadBadge)!;
    const duplicates = () => [
      ...el.querySelectorAll(`[data-testid="${TESTIDS.jinnangCard("求贤令")}"]`),
    ];
    const selected = () =>
      el.querySelectorAll(`[data-testid="${TESTIDS.jinnangHand}"] > button[aria-pressed="true"]`);
    click(badge());
    click(duplicates()[1]);
    expect(duplicates().map((card) => card.getAttribute("aria-pressed"))).toEqual([
      "false",
      "true",
    ]);
    expect(badge().getAttribute("aria-pressed")).toBe("true");
    // 数字键与点牌同一实例账本：换选第一张、再换第二张，再点即取消；检视仍在。
    for (const [key, expected] of [
      ["1", ["true", "false"]],
      ["2", ["false", "true"]],
    ] as const) {
      act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true })));
      expect(duplicates().map((card) => card.getAttribute("aria-pressed"))).toEqual([...expected]);
    }
    click(duplicates()[1]);
    expect(selected()).toHaveLength(0);
    expect(badge().getAttribute("aria-pressed")).toBe("true");
    // 同窗态快照重灌不结束检视；单机视角轮转也不替换屏前玩家。
    click(duplicates()[1]);
    writeEngine(() => {});
    act(() => useGameStore.getState().setViewSeat(1));
    expect(duplicates()[1].getAttribute("aria-pressed")).toBe("true");
    expect(badge().getAttribute("aria-pressed")).toBe("true");
    act(() => useGameStore.getState().setViewSeat(0));
    const skill = q(el, TESTIDS.jinnangCard("skill:huatuo:zhenji"))!;
    click(skill);
    expect(selected()).toHaveLength(1);
    expect(skill.getAttribute("aria-pressed")).toBe("true");
    expect(badge().getAttribute("aria-pressed")).toBe("true");
    click(skill.querySelector(TESTIDS.skillChip("zhenji"))!);
    expect(q(document, TESTIDS.skillGlossary)).not.toBeNull();
    expect(badge().getAttribute("aria-pressed")).toBe("false");
    pressEscape();
    click(badge());
    click(q(el, TESTIDS.jinnangCard("识破诡计"))!);
    expect(modalQ(TESTIDS.jinnangDetail)).not.toBeNull();
    expect(badge().getAttribute("aria-pressed")).toBe("false");
    pressEscape();
    click(badge());
    click(duplicates()[1]);
    writeEngine((e) => giveJinnang(e, 0, ["求贤令", "军情密探", "识破诡计", "缓兵之计"]));
    expect(selected()).toHaveLength(0); // 同名序缩短不能迁选另一张。
    expect(q(document, TESTIDS.actionbarPlay)!.getAttribute("aria-disabled")).toBe("true");
    // 遣散走公共方法，移除技能项后两席拥有相同牌序，专门证伪只按语义 id 留选中。
    writeEngine((e) => {
      e.dismissHero("huatuo");
      giveJinnang(e, 0, cards);
    });
    click(duplicates()[1]);
    act(() => {
      useNetStore.getState().setRoom({
        roomId: "wiring-hand-owner",
        seats: snap().players.map((player, seat) => ({
          seat,
          kind: player.isBot ? ("bot" as const) : ("human" as const),
          taken: true,
          online: true,
          autoPilot: false,
          guohao: player.guohao,
        })),
      });
      useGameStore.getState().setViewSeat(1);
    });
    expect(selected()).toHaveLength(0);
    expect(badge().getAttribute("aria-pressed")).toBe("false");
    act(() => useGameStore.getState().setViewSeat(0));
    click(badge());
    click(q(el, TESTIDS.jinnangCard("军情密探"))!);
    click(q(document, TESTIDS.actionbarPlay)!);
    expect(snap().pendingJinnang?.cardId).toBe("军情密探"); // 仍发原语义命令。
    expect(q(document, TESTIDS.actionbarTarget)).not.toBeNull();
    expect(badge().getAttribute("aria-pressed")).toBe("false");
    click(q(document, TESTIDS.actionbarCancel)!);
    click(badge());
    act(() => document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })));
    expect(badge().getAttribute("aria-pressed")).toBe("false");
    click(badge());
    click(q(el, TESTIDS.jinnangToggle)!);
    click(q(el, TESTIDS.jinnangToggle)!);
    expect(badge().getAttribute("aria-pressed")).toBe("false");
    click(badge());
    click(q(document, TESTIDS.actionbarPass)!);
    expect(badge().getAttribute("aria-pressed")).toBe("false");
  });

  // ── ①点牌详情(react-jinnang-rack 例 1 迁入)──
  // 断言面:架/手牌行挂载、恰 1 张、点击→详情弹层含牌名与牌面全文、Esc 关闭即卸载。
  // 空闲态钉相位走 armPhase 种植件(判词单源 planter:引擎自转无「钉相位」公共命令,
  // 断言前提=常态架语义——窗态点牌是选中非详情,e2e pinRackIdle 同判词)。
  it("起手 1 张:架可见且牌在架内;点牌详情含牌名全文;Esc 关闭", () => {
    const { el, snap } = startGame((e) => {
      armPhase(e, { turnPhase: "AwaitingDecision" }); // 钉空闲态:点牌=详情语义(e2e pinRackIdle 同判词)
    });
    const cardId = snap().players[0].jinnangHand[0];
    if (cardId == null) throw new Error("接线测试:起手牌为空——发牌没进引擎,后续断言全是废话");
    expect(q(el, TESTIDS.jinnangRack)).not.toBeNull();
    expect(q(el, TESTIDS.jinnangHand)).not.toBeNull();
    const card = q(el, TESTIDS.jinnangCard(cardId));
    if (card == null) throw new Error("接线测试:手牌钮缺席(架内牌面接线断)");
    // 点牌 → 详情弹层(桌面=底部面板,Portal 在 body):含牌名与牌面全文
    click(card);
    const detail = modalQ(TESTIDS.jinnangDetail);
    if (detail == null) throw new Error("接线测试:详情弹层未挂载(点牌详情接线断)");
    expect(detail.textContent).toContain(cardId);
    expect(detail.textContent).toContain(jinnangCardOf(cardId).text);
    // Esc 关闭(detail 容器随 Portal 卸载;底件 document 级 keydown 监听)
    pressEscape();
    expect(modalQ(TESTIDS.jinnangDetail)).toBeNull();
  });

  // ── ②灰置印条(react-jinnang-rack #715 例 1 迁入)──
  // 断言面:aria-disabled+非原生 disabled+灰置类+唯反应印条;点击=只开详情不选中
  // (出牌钮保持禁用);快照证伪零命令通路(相位/手牌不动)。长按腿(裸指针时序)
  // 留浏览器地板,不在本层断言面(模板头注判例)。
  it("唯反应灰置牌:点击开详情(aria-disabled 语义保持),选中与出牌零通路", () => {
    const { el, snap } = startGame((e) => {
      giveJinnang(e, 0, ["识破诡计"]); // 唯反应牌(判词单源 planter:发指定牌无公共通路)
      armPhase(e, { turnPhase: "AwaitingJinnang" }); // 钉出牌窗(断言前提,同①判词)
    });
    expect(q(document, TESTIDS.actionbar)).not.toBeNull(); // 窗已升起(停车坪自证)
    const card = q(el, TESTIDS.jinnangCard("识破诡计"));
    if (card == null) throw new Error("接线测试:灰置牌缺席(窗态牌行接线断)");
    // 禁用形态双钉:原生 disabled 已弃(pointer 可达可查看),aria-disabled 宣告禁用;
    // 灰置态下沉置灰 + 唯反应原因印条(文案单源 choices)
    expect(card.hasAttribute("disabled")).toBe(false);
    expect(card.getAttribute("aria-disabled")).toBe("true");
    expect(hasClass(card.querySelector(".jinnang-card")!, "off")).toBe(true);
    expect(card.querySelector(".reason")!.textContent).toBe("唯反应(反应窗打出)");
    // 点击=只开详情(不选中):动作条「出牌」钮不亮(#751 B1 aria-disabled 挂点)
    click(card);
    const detail = modalQ(TESTIDS.jinnangDetail);
    if (detail == null) throw new Error("接线测试:灰置牌详情未挂载(自门控详情通路断)");
    expect(detail.textContent).toContain("识破诡计");
    expect(q(document, TESTIDS.actionbarPlay)!.getAttribute("aria-disabled")).toBe("true");
    // Esc 关闭后引擎零命令:相位仍在出牌窗、牌未消耗(出牌命令通路未开)
    pressEscape();
    expect(modalQ(TESTIDS.jinnangDetail)).toBeNull();
    expect(snap().turnPhase).toBe("AwaitingJinnang");
    expect(snap().players[0].jinnangHand).toContain("识破诡计");
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

  // ── ④空手牌空态(react-jinnang-peek 例 2 迁入)──
  // 「囊中空空」空态呈现=真业务态(目标有效性对手牌数无守卫,#477),非兜底。
  it("空手牌目标合法可窥:弹层「囊中空空」空态(目标有效性对手牌数无守卫)", async () => {
    const { el, engine } = startGame((e) => {
      giveJinnang(e, 0, ["军情密探"]);
      giveJinnang(e, 1, []); // 目标空手形(终态替换,planter 判词)
    });
    click(q(el, TESTIDS.jinnangCard("军情密探"))!);
    click(q(document, TESTIDS.actionbarPlay)!);
    click(q(el, TESTIDS.seatTarget(1))!);
    click(q(document, TESTIDS.actionbarTarget)!);
    await presentCommandFx(engine);
    await settle();
    const modal = modalQ(TESTIDS.peekModal);
    if (modal == null) throw new Error("接线测试:窥探弹层未挂载(空手形表现链断)");
    expect(q(modal, TESTIDS.peekEmpty)).not.toBeNull();
    expect(q(modal, TESTIDS.peekCard("火烧连营"))).toBeNull();
  });

  // ── ⑤被识破不弹(react-jinnang-peek 例 3 迁入)──
  // 命令序(resolveJinnang/respondReaction)走引擎公共方法=合法漏斗(非红牌);isBot
  // 翻转判词见头注「种植判词」。断言面:识破生效公开面(reactionCounter 留痕)+
  // peekApplied 事件零产出 + 弹层从未打开(负向锁;无表现消费腿——无 peek 可言,
  // fxStore.peek 恒空即弹层零渲染的自门本体)。
  it("被识破:无窥探弹层(识破只护份,窥探从未发生)", () => {
    const { writeEngine, snap } = startGame((e) => {
      giveJinnang(e, 0, ["军情密探"]);
      giveJinnang(e, 1, ["识破诡计"]);
      // 只给 seat1 识破诡计(queried 恰 [1]):清走其余座位反应牌,防其他 bot 被询问
      // 留窗拖尾(「去指定牌」语义以 giveJinnang 终态组合表达,e2e 同款 #1301 判词)
      for (let seat = 2; seat < e.players.length; seat++) {
        giveJinnang(
          e,
          seat,
          e.players[seat].jinnangHand.filter((id) => id !== "识破诡计"),
        );
      }
    });
    writeEngine((e) => {
      e.players[1].isBot = false; // 暂翻人:窗不即席代答,留给下面的应答(种植判词见头注)
      e.resolveJinnang("军情密探");
      e.resolveJinnang("军情密探", [1]);
      e.respondReaction(1, true, "识破诡计", 1); // 识破自保生效,窗闭即结算
      e.players[1].isBot = true; // 翻回 bot
    });
    // 引擎面:识破生效(战报公开面照旧),窥探事件零产出
    const s = snap();
    expect(s.log.some((l) => l.detail.includes("reactionCounter"))).toBe(true);
    expect(s.events.some((x) => x.kind === "peekApplied")).toBe(false);
    // 呈现面:窥探弹层从未打开(fxStore.peek 恒空 = PeekModal 自门零渲染的本体)
    expect(useFxStore.getState().peek).toBeNull();
    expect(modalQ(TESTIDS.peekModal)).toBeNull();
  });
});

describe("锦囊 secrecy 可见性(自 react-jinnang 迁入,#1315 批T1)", () => {
  // ── ⑥secrecy(react-jinnang 例 1 迁入)──
  // 零种植全真:选都链(引擎真实开局流,进程内毫秒级)到发牌呈现——单机快照是 god
  // view(引擎在本机),「他人只见计数」的投影逻辑由 room 层单测 redactSnapshotForSeat
  // 直测;本例断言 UI 面不泄:他人牌面永不出现在 DOM。引擎缝账目断言(牌库/离库)同
  // e2e __dafung 桥语义,直读进程内引擎。
  it("起手各 1 张:架中见自己牌面;牌库余 14;席位卡见计数章", () => {
    const { el, engine, snap } = startGame(() => {
      // 零种植:seed 67 离线核算天然凑齐断言面(头注第 2 步)
    });
    // 引擎缝 fail-fast:发牌没进引擎,后面全是废话(e2e 同款断言,直读引擎)
    expect(engine.jinnangDeck.length).toBe(14); // 18 − 4 起手(#281 牌库 9 种 18 张)
    expect(
      engine.players.reduce((a, p) => a + p.jinnangHand.length, 0) + engine.jinnangDiscard.length,
    ).toBe(4); // 离库 4 张无一消失(用牌只进弃牌堆不回库,牌库数即发牌证据)
    // 己方牌面:手牌行 + 恰好 1 张(testid 带牌名,目录中文 id)
    expect(q(el, TESTIDS.handZone)).not.toBeNull();
    expect(
      el.querySelectorAll(`[data-testid="${TESTIDS.jinnangHand}"] [data-testid^="jinnang-card-"]`),
    ).toHaveLength(1);
    // 他人计数章可见(席位卡手牌徽章 aria 即计数,#253 jinnang-count 随诸侯行退役)
    expect(q(el, TESTIDS.seatAttr(1, "hand"))!.getAttribute("aria-label")).toBe("锦囊手牌 1");
    // 整页不存在第二份锦囊牌面(他人内容不渲染——secrecy 的 UI 面本体)
    expect(el.querySelectorAll("[data-testid^='jinnang-card-']")).toHaveLength(1);
    expect(snap().players[0].jinnangHand).toHaveLength(1);
  });
});

describe("目标段选自己(自 react-self-target 迁入,#1315 批T1)", () => {
  // ── ⑦赈济 any 域(react-self-target 例 1 迁入)──
  // 断言面:自机格候选层(.candidate 金圈呼吸挂点)/点选实金停持(.picked)/确认钮
  // 启禁/打出自疗落账(体力色条 width 百分比 style 属性字面量 + 现金裸数,非几何);
  // 结算细则归 test/hero-skill.test.ts(文件头注自述,随迁)。种植=armHero/setCash/
  // setStamina(判词单源 planter:麾下无授将公共命令;数值终态直种)。
  it("赈济(any 域):你印=候选金圈呼吸→点选实金停持→「出」打出自疗", () => {
    const { el, snap } = startGame((e) => {
      armHero(e, 0, "huatuo", ["qingnang", "zhenji"]); // 华佗全池原序,槽位行(planter 判词)
      setCash(e, 0, 2000); // ≥cost 排除整技可用性疑虑(数值族判词 planter)
      setStamina(e, 0, 50); // 满体力自疗无可见落账,种半血(同上)
    });
    // testid=选项 id 实例形状 skill:<heroId>:<skillId>(#817;布场属主华佗)
    // (引用只在点击前用:目标段 options 清空会整卡卸载、打完后重挂——打出后的
    // 灰置断言重查询,不吃旧节点引用)
    const ji = q(el, TESTIDS.jinnangCard("skill:huatuo:zhenji"));
    if (ji == null) throw new Error("接线测试:技能卡缺席(armHero→choices 装配断)");
    click(ji);
    click(q(document, TESTIDS.actionbarPlay)!);
    // 打出前基准:自机格体力条宽 50%(种局直写值;#700 仪表条退役,格上体力=色条)
    const staminaFill = q(el, TESTIDS.seatStamina(0))!.querySelector(".strack i")!;
    expect(staminaFill.getAttribute("style")).toMatch(/width:\s*50%/);
    // 目标段:自机格点击层就位(候选金圈呼吸挂格),未选中时「选择目标」引导态禁用
    const selfBtn = q(el, TESTIDS.seatTarget(0));
    if (selfBtn == null) throw new Error("接线测试:自机格点击层缺席(目标段装配断)");
    expect(selfBtn.hasAttribute("disabled")).toBe(false);
    expect(selfBtn.hasAttribute("aria-disabled")).toBe(false);
    expect(hasClass(q(el, TESTIDS.seatSelf)!, "candidate")).toBe(true);
    const confirm = q(document, TESTIDS.actionbarTarget)!;
    expect(confirm.hasAttribute("disabled")).toBe(true);
    // 点自己=选中(.picked 实金停持)→「出」点亮;再点=取消→回禁用;三点重选→打出
    click(selfBtn);
    expect(hasClass(selfBtn, "picked")).toBe(true);
    expect(confirm.hasAttribute("disabled")).toBe(false);
    click(selfBtn);
    expect(hasClass(selfBtn, "picked")).toBe(false);
    expect(confirm.hasAttribute("disabled")).toBe(true);
    click(selfBtn);
    click(confirm);
    // 打出:目标段收、技能卡转灰置(冷却;目标段曾整卡卸载,此处重查询新节点);
    // 自疗落账走可见 UI——自机格体力条 50%→80%、现金裸数 2000→1900(格上无千分位
    // 省「两」;结算细则归 test/hero-skill.test.ts)
    expect(q(document, TESTIDS.actionbarTarget)).toBeNull();
    const jiAfter = q(el, TESTIDS.jinnangCard("skill:huatuo:zhenji"));
    if (jiAfter == null) throw new Error("接线测试:打出后技能卡缺席(冷却灰置应留在选项集)");
    expect(hasClass(jiAfter.querySelector(".hface")!, "off")).toBe(true);
    expect(staminaFill.getAttribute("style")).toMatch(/width:\s*80%/);
    expect(q(el, TESTIDS.seatCash(0))!.textContent).toBe("1900");
    expect(snap().players[0].stamina).toBe(80);
  });

  // ── ⑧军情密探 one 域(react-self-target 例 2 迁入)──
  // 断言面:非 any 域自己「恒在但不可选」——aria-disabled+原因读 aria-label(#1097 起
  // 弹层放行退役)、点按死区反馈=格身轻晃(.shake 类挂点,§4.6 位移即状态;动画本身
  // 留浏览器)、未选中不吃 .picked。种植=giveTreasure(对方有宝门槛,判词 planter)+
  // giveJinnang(one 域牌形)。
  it("军情密探(one 域):你印恒在但不可选,点按轻晃(reason 读 aria-label)", () => {
    const { el, snap } = startGame((e) => {
      giveTreasure(e, 1, [{ id: "gem-1", name: "夜明珠", level: 5 }]); // 对方有宝门槛(planter 判词)
      giveJinnang(e, 0, ["军情密探"]);
    });
    click(q(el, TESTIDS.jinnangCard("军情密探"))!);
    click(q(document, TESTIDS.actionbarPlay)!);
    // 恒在口径(拍板 Q3):非 any 域自己不消失,而是不可选——aria-disabled 挂点,
    // 禁用原因读 aria-label(单人格弹层随 #1097 退役)
    const selfBtn = q(el, TESTIDS.seatTarget(0));
    if (selfBtn == null) throw new Error("接线测试:自机格点击层缺席(one 域目标段断)");
    expect(selfBtn.getAttribute("aria-disabled")).toBe("true");
    expect(selfBtn.getAttribute("aria-label")).toBe("不可指定:不能指定自己");
    expect(hasClass(q(el, TESTIDS.seatSelf)!, "candidate")).toBe(false);
    // 死区点按:格身轻晃类挂点(动画 ~240ms 内可见,happy-dom 无动画即恒驻——断言面
    // 是类名非动画本身)+ 单人格弹层零残留(常量已随 #1097 核销删除,无单源可引)
    click(selfBtn);
    expect(hasClass(q(el, TESTIDS.seatSelf)!, "shake")).toBe(true);
    expect(q(el, "seat-pop-0")).toBeNull();
    // 未选中(不可选席不吃 .picked,「出」确认钮保持禁用)
    expect(hasClass(selfBtn, "picked")).toBe(false);
    expect(q(document, TESTIDS.actionbarTarget)!.hasAttribute("disabled")).toBe(true);
    expect(snap().turnPhase).toBe("AwaitingJinnang"); // 零命令通路:死区点按不发出
  });
});
