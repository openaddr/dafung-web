// 接线测试(ADR-0062 层④,#1317 批T3):全浮层布局域三例自 e2e 迁入接线层
// (react-layout 迁尽整删)——①回合胶囊轮次对账+总览/设置钮通路、②手牌区结构
// (签面驻左端/架在区内/退役 testid 零残留)、③三圆钮计数角标随快照+藏品弹层忠实
// 镜像(#361 双入口接替)。
//
// 【判层理由】判据=ADR-0062 迁移判据,判层只看断言面:①=胶囊内「第 N 轮」档
// (.tc-round,NoticeBanner 单源)文本与快照轮次相等+总览钮点击→弹窗挂载→Esc 卸载
// +设置钮可用(全 DOM 有无与文本);②=testid 嵌套 containment(diceFace 文本 ∈
// 签/待/一~六;jinnangRack 挂 handZone 区内;dash 系退役 testid 零残留=缺席);
// ③=.cnt 角标文本与快照逐字对账(零值角标隐藏 #743 G)+点钮开藏品弹层(题名/网格
// 件数/计数行与同拍快照原子对账)+X/Esc 关闭卸载。零几何零像素零演出泵——844×390
// 视口档是 e2e 的运行条件非断言面,接线层假 DOM 无排版引擎,零重排桌面档天然成立
// (ADR-0032 标准分辨率原则的接线层形)。
//
// 【渲染装配配方】(模板 = test/wiring/battle-wiring.test.tsx #1317 同批 + test/overview-
// wiring.test.tsx #1316 批T2;模板四步 + 晚绑红线第 0 条 + 注册控制器第 2.5 步 +
// 环境缝照抄)①含一处表现消费腿:回合胶囊是 fxStore 开关态(turnStarted 表现事件
// 驱动,NoticeBanner 头注),接线被测环含「开局批→表现→胶囊 DOM」——开局转移批经
// extractBatchEvents(单机/联机同一消费函数)+ present(真编排器,turnBanner 即发即忘
// 零停留窗)+ createEngineSink(真 sink)进 fxStore,与生产 LocalController.onMessage
// ("events")→SnapshotEffects 直译同一条管线(jinnang-wiring 配方同款);②③全快照
// 驱动(手牌行显隐/圆钮计数/藏品弹层)。
//   0.【晚绑红线】凡「typeof document 求值期捕获」的依赖必须晚于 ensureHappyDom
//      求值(Base UI 全族 useIsoLayoutEffect 求值期定型,静态 import 冻结成 noop、
//      弹层空壳零报错)——GameScreen 全图(含 WarlordsOverview/PileModal 弹层族)与
//      controller 基类依赖图一律 beforeAll 内 await import 晚绑;@core 纯逻辑(含
//      planter 种植件)与 store/testids(零 DOM 求值期捕获)照旧静态。
//   1. beforeAll ensureHappyDom()(test/wiring/happy-dom-register.ts 局部注册/release 还原);
//   2. 真 GameEngine 直构(loadMap(guanzhong.json)+ createDice(seed)),公共命令走完
//      选都链停 Playing——seed 1486=模板既定锚;零时钟零竞速,种下什么相位就停什么
//      相位(e2e 的「对局自走+poll 对账」 Armor 在接线层不需要:引擎不自走,种下即
//      终态,断言恒同拍)。
//   2.5. 注册控制器:WiringController(GameController 生产基类最小子型)同模板,
//      dispatchCommand = engine.submitCommand + this.sync;房间编排/传输/看门狗不进
//      接线层。
//   3. 基类 sync 灌真 store,act() 内渲染真 GameScreen(生产装配本体,整屏真挂);
//   4. act() 内合成事件(dispatchEvent 冒泡)与断言,testid/类名/DOM 文本/store 状态。
//
// 【种植单源形】(overview-wiring #1321 形制)初始布场与拍间种植一律走 PlantOp 指令
// (applyPlant 单源 @core/planter,与 e2e 桥/单测同一份实现):startGame(ops[]) 开局
// 前逐条落种、plant(op) 拍间补种+resync 重灌——全文件零裸直写,各件判词单源在
// planter 函数头注。③名将布场=快照 restoreFromSnapshot 公共方法回灌(e2e 同判词:
// 生产通路本体,联机恢复同一条产线路径;快照参数构造=测试数据非引擎直写,restore
// 内含珍宝位故先种珍宝后回灌)。
//
// 【断言宪法】本层禁几何(假 DOM 无排版引擎,getBoundingClientRect 恒 0)、禁像素、
// 禁演出泵与真实时钟;本三例断言面 = testid 有无 / 类名挂点(.tc-round/.cnt)/ DOM
// 文本与节点计数 / store 快照字段,纯状态挂点。
//
// 【store 隔离】(模板同款)useGameStore/useNetStore 模块单例跨文件纠缠,本文件
// beforeEach/afterEach 成对调用 reset();fxStore 随 afterEach resetFx 清场;registry
// 控制器随 afterEach setController(null) 释放。
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
import { heroById } from "@core/heroes";
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

const guanzhongData = rawGuanzhongData as MapData; // JSON 导入 tier 丢字面量,cast 同 map-storage-wiring #1316 形
const MAP = loadMap(guanzhongData);
const SEED = 1486; // 模板既定锚

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

/** 种局→种植→注册控制器→基类 sync 灌 store→挂屏(每例开头同款一条龙)。 */
function startGame(ops: PlantOp[] = []): {
  el: HTMLElement;
  engine: GameEngine;
  plant: (op: PlantOp) => void;
  writeEngine: (write: (e: GameEngine) => void) => void;
  snap: () => GameSnapshot;
} {
  const e = seedPlayingEngine();
  for (const op of ops) applyPlant(e, op);
  const c = newWiringController(e);
  setController(c, guanzhongData); // 生产同款:连地图一起注册(棋盘/卷轴层挂载门卫)
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
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

/** 有界等待弹层卸载(overview-wiring 同款):退场协议(210ms「播完再移除」)走完
 *  即卸——happy-dom 真定时器自然走时,轮询到位即收,超死线响亮红。判词:卸载后的
 *  「null 断言」必须等协议走完;协议在途就把在场 happy-dom 节点递给 expect,断言
 *  失败路径的 diff 序列化会走节点循环引用(battle-wiring waitUnmounted 判词,
 *  wire3 实锤)。 */
async function waitUnmounted(query: () => Element | null, label: string): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (query() != null && Date.now() < deadline) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
  }
  expect(query(), label).toBeNull();
}

/** 弹层查询口:总览/藏品弹层经 Portal 渲染在 body,一律 document 级。 */
const modalQ = (id: string): Element | null => q(document, id);

/** 表现消费腿(头注专节):当前转移批(种局链=开局批)→ 表现事件 → 真编排器 → 真
 *  sink → fxStore。开局批已随 resync 落进快照(events=当前转移批);turnBanner=即发
 *  即忘零停留窗,无定时器拖账(orchestrator turnBanner 分支)。 */
async function presentOpeningFx(engine: GameEngine): Promise<void> {
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

describe("全浮层布局接线(自 react-layout 迁入,#1317 批T3)", () => {
  // ── ①回合胶囊对账+总览/设置通路(react-layout 例 1 迁入)──
  // 断言面:胶囊内「第 N 轮」档(.tc-round,NoticeBanner 单源)与快照回合相等(e2e 的
  // poll 对账在接线层收敛为同拍相等——引擎不自走,种下即终态);总览钮点开诸侯详情
  // 弹窗→Esc 随退场协议卸载;设置钮可用(点开收合归 manual/popup 族既有例)。
  it("回合胶囊轮次与快照一致;总览钮点开弹窗 Esc 收净;设置钮可用", async () => {
    const { el, engine, snap } = startGame([]);
    // 表现消费腿:开局转移批(turnStarted 随 GameStart 同批)→ fxStore 胶囊常驻件
    await presentOpeningFx(engine);
    const round = snap().round;
    const tc = q(el, TESTIDS.turnCapsule);
    if (tc == null) throw new Error("接线测试:回合胶囊缺席(顶栏装配断)");
    expect(tc.querySelector(".tc-round")!.textContent).toBe(`第${round}轮`);
    // 详情钮 #702 点亮(#732 正名「详情」):点开诸侯详情弹窗(内容与投影归
    // overview-wiring,此处只守「开得了、Esc 收得净」)
    const overviewBtn = q(el, TESTIDS.topbarOverview);
    if (overviewBtn == null) throw new Error("接线测试:详情钮缺席(顶栏装配断)");
    expect(overviewBtn.hasAttribute("disabled")).toBe(false);
    click(overviewBtn);
    await settle();
    expect(modalQ(TESTIDS.warlordsOverview)).not.toBeNull();
    pressEscape();
    await waitUnmounted(() => modalQ(TESTIDS.warlordsOverview), "总览弹窗应随 Esc 退场协议卸载");
    expect(q(el, TESTIDS.settingsButton)).not.toBeNull(); // 设置钮可用(在场即通路)
  });

  // ── ②手牌区结构(react-layout 例 2 迁入)──
  // 断言面:签面驻左端(diceFace 文本 ∈ 签/待/一~六)+ 手牌架挂手牌区内(testid
  // 嵌套 containment)+ 仪表条退役面零残留(dash 系 testid 核销,常量已随 #700 删除
  // 无单源可引,字面量缺席断言)。钉 AwaitingDecision 空闲态+清落格投影(armLanding
  // null,停车坪判词单源 planter)。
  it("手牌区:签面驻左端,手牌架在区内;仪表条退役面零残留", () => {
    const { el } = startGame([
      { kind: "armPhase", turnPhase: "AwaitingDecision", activeIndex: 0 }, // 钉空闲态+我的回合(架显隐亮沿门卫)
      { kind: "armLanding", landing: null }, // 清落格投影(决策卷轴不遮手牌区)
    ]);
    const zone = q(el, TESTIDS.handZone);
    if (zone == null) throw new Error("接线测试:手牌区缺席(布局装配断)");
    // 签面(testid dice-face 契约不变):文本 ∈ 签/待/一~六
    expect(q(el, TESTIDS.diceFace)!.textContent).toMatch(/[签一二三四五六]/);
    // 手牌架挂手牌区内(嵌套 containment)
    expect(q(zone, TESTIDS.jinnangRack)).not.toBeNull();
    // 现金大数/体力刻度随仪表条退役:dash 系 testid 零残留(常量已随 #700 核销删除,
    // 无单源可引——退役核销缺席断言,字面量口径同 e2e)
    expect(q(el, "dash-cash")).toBeNull();
    expect(q(el, "dash-stamina")).toBeNull();
  });

  // ── ③三圆钮计数角标与藏品弹层(react-layout 例 3 迁入)──
  // 断言面:退役牌架双入口零残留(rack-treasures/rack-heroes 核销,#361 接替者=三圆
  // 钮);.cnt 角标与快照逐字对账(珍宝裸数/名将 N/3;零值角标隐藏 #743 G);点「珍宝」
  // 圆钮→藏品弹层忠实镜像同拍快照(题名/网格件数/「已持有 · N 件」计数行);X 关闭
  // 卸载;点「名将」圆钮→HeroCardFace 详情档网格(题名+将名陈列);Esc 关闭卸载。
  // 种植:珍宝×2=giveTreasureFromDeck(真牌堆实例,判词单源 planter);名将×2=快照
  // restoreFromSnapshot 公共方法回灌(生产通路本体;快照参数构造=测试数据,restore
  // 内含珍宝位故先种珍宝后回灌,e2e 同判词)。
  it("三圆钮:计数角标随快照,珍宝/名将点开藏品弹层(#361 双入口接替)", async () => {
    const { el, writeEngine, snap } = startGame([
      { kind: "giveTreasureFromDeck", seat: 0, count: 2 },
    ]);
    // 退役核销:牌架双入口零残留(常量已随 #361/#700 核销删除,无单源可引)
    expect(q(el, "rack-treasures")).toBeNull();
    expect(q(el, "rack-heroes")).toBeNull();
    // 名将×2:快照 restore 通路(槽位行=heroId+已授技+冷却账,restore 原样回灌)
    writeEngine((e) => {
      const s = e.snapshot();
      s.players[0].heroes.push(
        { heroId: "zhouyu", skillIds: [...heroById("zhouyu").skillPool], lastFired: {} },
        { heroId: "huatuo", skillIds: ["qingnang", "zhenji"], lastFired: {} },
      );
      s.recruitedHeroIds.push("zhouyu", "huatuo");
      e.restoreFromSnapshot(s);
    });
    // 三圆钮计数与快照一致(接线层无自走对局,种下即终态——角标恒同拍,e2e 的
    // poll 对账在此收敛为直等;零值角标隐藏 #743 G 由 2>0 分支覆盖,同 e2e 形)
    const gem = q(el, TESTIDS.pileTreasures)!.querySelector(".cnt");
    const hero = q(el, TESTIDS.pileHeroes)!.querySelector(".cnt");
    expect(gem!.textContent).toBe(String(snap().players[0].treasures.length));
    expect(hero!.textContent).toBe(`${snap().players[0].heroes.length}/3`);
    // 点「珍宝」圆钮 → 珍宝弹层:陈列忠实镜像同拍快照(题名/网格件数/计数行)
    click(q(el, TESTIDS.pileTreasures)!);
    await settle();
    const modal = modalQ(TESTIDS.treasureModal);
    if (modal == null) throw new Error("接线测试:珍宝弹层未挂载(三圆钮通路断)");
    expect(modal.querySelector(".pile-title")!.textContent).toContain("珍宝");
    expect(modal.querySelectorAll(".pile-cell")).toHaveLength(snap().players[0].treasures.length);
    expect(modal.querySelector(".pile-zone")!.textContent).toContain(
      `已持有 · ${snap().players[0].treasures.length} 件`,
    );
    // 右上 X 关闭,卸载零残留(退场协议走完)
    click(modalQ(TESTIDS.modalClose)!);
    await waitUnmounted(() => modalQ(TESTIDS.treasureModal), "珍宝弹层应随 X 卸载");
    // 点「名将」圆钮 → 人物卷:画像签可达,正文随当前名将切换
    click(q(el, TESTIDS.pileHeroes)!);
    await settle();
    const heroModal = modalQ(TESTIDS.heroModal);
    if (heroModal == null) throw new Error("接线测试:名将弹层未挂载(三圆钮通路断)");
    expect(heroModal.querySelector(".pile-title")!.textContent).toContain("名将");
    expect(q(heroModal, TESTIDS.heroInspectionName)!.textContent).toBe("周瑜");
    expect(q(heroModal, TESTIDS.heroInspectionSelect("zhouyu"))).not.toBeNull();
    const huatuo = q(heroModal, TESTIDS.heroInspectionSelect("huatuo"))!;
    expect(huatuo).not.toBeNull();
    click(huatuo);
    expect(q(heroModal, TESTIDS.heroInspectionName)!.textContent).toBe("华佗");
    // Esc 关闭(Base UI 底件行为),卸载零残留
    pressEscape();
    await waitUnmounted(() => modalQ(TESTIDS.heroModal), "名将弹层应随 Esc 卸载");
  });
});
