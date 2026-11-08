// 接线测试(ADR-0062 层④,#1316 批T2):首页存储域六例自 e2e 迁入接线层——
// 选图三例(react-map-selection:①清单/②确认记忆 localStorage/③换图起兵)+ 韧性
// 两例(react-resilience:④垃圾串回显/⑤失效 id 拦截)+ 手册净空一例(react-manual
// 「收口净空」)。react-map-selection 三例迁尽整删文件。
//
// 【判层理由】判据=ADR-0062 迁移判据,判层只看断言面:①②=点击→清单 DOM/地图名文本/
// localStorage 存储(真 happy-dom localStorage)语义;③=起兵点击→引擎按所选图构造→
// 棋盘 [data-tile] 节点计数+快照字段(phase/席数)——节点计数与 store 状态,非几何;
// ④⑤=损坏 localStorage 记忆的零兜底呈现链(原样回显/起兵被拦/显式报错,不静默清不
// 静默兜底)= DOM 文本与 store 状态;⑥=退场协议走完叠层/壳先后卸载+零孤儿弹层=DOM
// 有无。零几何零像素零演出泵。
//
// 【渲染装配配方】(模板 = test/wiring/popup-state-wiring.test.tsx #1289 批二;晚绑红线第 0 条
// + 环境缝 + store 隔离照抄,本文件差异在「非对局屏族」两条)
//   0.【晚绑红线】凡「typeof document 求值期捕获」的依赖必须晚于 ensureHappyDom
//      求值(Base UI 全族 useIsoLayoutEffect 在模块求值期按 document 在场定型,静态
//      import 冻结成 noop、弹层永不挂载)——HomeScreen(携 MapSelectPanel/ManualModal
//      弹层族)/SoloSetupScreen/GameScreen 全图与 controller 基类依赖图一律 beforeAll
//      内 await import 晚绑;@core 纯逻辑与 testids/store(零 DOM 求值期捕获)照旧静态。
//   1. beforeAll ensureHappyDom()(test/wiring/happy-dom-register.ts 局部注册/release 还原);
//   2.【非对局屏族:WiringHost 生产装配镜像】本族宿主=App.tsx 地图分支的镜像(判词
//      见 WiringHost 注):首页/配置页真挂 + 起兵腿镜像 App.handleStart 的引擎构造段
//      (loadMapById→GameEngine→控制器→sync→切 game)——房间编排/Worker 时钟是层③
//      领域不进接线层(模板判词:种下什么相位就停什么相位),引擎构造与灌屏是被测环
//      「起兵→该图开局→棋盘渲染」的装配本体;地图源注入组件声明的测试缝(mapSource
//      prop「测试可注入内存实现」,HomeScreen/SoloSetupScreen/MapSelectPanel 三处同缝
//      ——生产 FetchMapSource 是进程级 fetch 单例,happy-dom 无站点根,内存源是唯一
//      通路,数据取真 public/maps 清单与地图 JSON,零假数据)。
//   3. act() 内真点击(合成事件冒泡)与断言,testid/DOM 文本/localStorage/store 状态。
//
// 【自动化通道豁免】HomeScreen 挂载即 startWarmup(warmup.ts 头注:预热为人眼首现
// 平滑服务,自动化通道 navigator.webdriver 直返跳过)——happy-dom 无真资源通路
// (字体解码/位图 decode/游戏屏 chunk 预取全属浏览器面),接线测试置自动化位走
// 生产既有豁免口,不造第二套 skip 缝。
//
// 【localStorage 卫生】happy-dom 注册体自带真 localStorage(文件内跨例共享):
// 本族断言面就落在 dafung.mapId 键上,afterEach 成对清除本族触及键防跨例泄漏
// (注册体销毁时整体焚,不跨文件)。
//
// 【store 隔离】(模板同款)useGameStore/useNetStore 模块单例跨文件纠缠,本文件
// beforeEach/afterEach 成对调用 reset();registry 控制器随 afterEach setController(null)
// 释放(起兵例注册过控制器)。
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
// bun 测试进程无 Vite define:GameScreen 全图经 SettingsDialog 触达 version.ts,其
// 模块求值读构建期注入的 __APP_VERSION__——按生产同一值源(package.json CalVer)先行
// 注入,晚绑 import 前生效(模板同款,留置不还原,无害)。
import pkg from "../../package.json";
(globalThis as Record<string, unknown>).__APP_VERSION__ = pkg.version;
import { act } from "react";
import { useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import catalogData from "../../public/maps/index.json";
import guanzhongData from "../../public/maps/guanzhong.json";
import zhongyuanData from "../../public/maps/zhongyuan.json";
import { loadMap, type MapData } from "@core/board-loader";
import { GameEngine, type GameCommand } from "@core/authority";
import { createDice } from "@core/dice";
import { entryFromFile, parseCatalog, type MapEntry, type MapSource } from "@core/map-source";
import { HOME_TID } from "@app/screens/home/testids";
import { TID as SETUP_TID } from "@app/screens/setup/testids";
import { MANUAL_TID } from "@app/screens/manual/testids";
import { useGameStore } from "@app/store/gameStore";
import { useNetStore } from "@app/store/netStore";
import { ensureHappyDom, releaseHappyDom } from "./happy-dom-register";

/** 晚绑模块型(late binding,红线见头注第 0 步;type-of-import 类型面静态引用,
 *  求值面零触碰,不破晚绑)。 */
type HomeModule = typeof import("@app/screens/home/HomeScreen");
type SetupModule = typeof import("@app/screens/setup/SoloSetupScreen");
type GameScreenModule = typeof import("@app/screens/game/GameScreen");
type RegistryModule = typeof import("@app/controllers/registry");
type GameControllerClass = import("@app/controllers/controller").GameController;
let HomeScreen: HomeModule["HomeScreen"];
let SoloSetupScreen: SetupModule["SoloSetupScreen"];
/** 起兵配置形(类型面静态引用:interface 不在 typeof 模块值面上,直接 type-import)。 */
type SetupConfig = import("@app/screens/setup/SoloSetupScreen").SetupConfig;
let GameScreen: GameScreenModule["GameScreen"];
let setController: RegistryModule["setController"];

/** 接线控制器面(GameController 生产基类的最小子型 + resync 测试口;构造见 beforeAll,
 *  模板同款——本族唯一引擎消费面是起兵例的快照健康与棋盘渲染,零交互命令腿)。 */
type WiringController = GameControllerClass & { resync(): void };
let newWiringController: (e: GameEngine) => WiringController;

/** App.tsx MAP_PREF_KEY 同字面量(单源在 App,引模块只为一个字符串会把整屏组件树
 *  拖进 import 图——registry.ts 既有先例同判词)。 */
const MAP_PREF_KEY = "dafung.mapId";

/** 内存地图源(组件声明的测试缝,判词见头注「装配配方 2」):数据取真 public/maps
 *  清单与地图 JSON;清单外 id 抛错(生产 FetchMapSource 同语义,零兜底——韧性⑤
 *  失效 id 例的「起兵真被拦」就吃这条真抛错通路)。 */
class MemMapSource implements MapSource {
  private readonly cat = parseCatalog(catalogData);
  private readonly data: Map<string, MapData> = new Map([
    ["guanzhong", guanzhongData as MapData],
    ["zhongyuan", zhongyuanData as MapData],
  ]);
  async listMaps(): Promise<MapEntry[]> {
    return this.cat.map(entryFromFile);
  }
  async loadMapData(id: string): Promise<MapData> {
    const entry = this.cat.find((e) => e.id === id);
    if (entry == null) throw new Error(`内置图清单中无此 id:${id}`);
    const data = this.data.get(id);
    if (data == null) throw new Error(`内存源缺图数据:${id}(清单/数据表不同步)`);
    return data;
  }
}

/** 生产装配镜像(App.tsx 地图分支 + handleStart 引擎构造段;判词见头注「装配配方 2」)。
 *  屏路由/记忆回写/失败显式报错三面与生产同构;起兵腿免房间编排(层③领域),bot
 *  选都驱动到人类停靠(#398 startGame 同步段语义,不替人类选都——e2e 断言拍停在
 *  Setup 同一形态)。 */
function WiringHost(props: { mapSource: MapSource; seed?: number }) {
  const { mapSource, seed = 42 } = props;
  const screen = useGameStore((s) => s.screen);
  const setScreen = useGameStore((s) => s.setScreen);
  // 零兜底原则(App 同构):默认地图唯一事实源 = localStorage 记忆,无记忆时异步解析
  // 清单首项(App getDefaultMapId 同语义,失败显式报错不静默回退);未解析出不进依赖
  // 地图的屏(「地图清单加载中」分支;垃圾串也是合法记忆值,不进此支)。
  const [initialMapId, setInitialMapId] = useState(() => localStorage.getItem(MAP_PREF_KEY));
  useEffect(() => {
    if (initialMapId != null) return;
    let alive = true;
    mapSource.listMaps().then(
      (maps) => {
        if (!alive) return;
        if (maps.length === 0) {
          useGameStore
            .getState()
            .pushHint("地图清单加载失败:地图清单为空:内置地图加载失败(index.json 缺失或损坏)");
          return;
        }
        setInitialMapId(maps[0]!.id);
      },
      (err: Error) => alive && useGameStore.getState().pushHint(`地图清单加载失败:${err.message}`),
    );
    return () => {
      alive = false;
    };
  }, [initialMapId, mapSource]);
  const handleMapChange = (mapId: string) => {
    localStorage.setItem(MAP_PREF_KEY, mapId);
    setInitialMapId(mapId);
  };
  // 正式开局(App.handleStart 镜像):加载地图 → 构造引擎 → 控制器注册+首帧直灌 →
  // 进 Game 屏;失败显式报错(零兜底豁免条款①:UI setError/pushHint)。
  const handleStart = async (config: SetupConfig) => {
    try {
      const map = loadMap(await mapSource.loadMapData(config.mapId));
      const e = new GameEngine(map.board, map.catalog, createDice(seed), {
        seats: config.seats,
        targetNetWorth: map.targetNetWorth,
        startingCash: map.startingCash,
        startingTreasures: map.startingTreasures,
        seed,
        mapId: config.mapId,
        encounter: config.encounter,
      });
      // bot 选都驱动到人类停靠(#398 startGame 同步段语义;不替人类选都,起兵断言拍
      // =Setup 停靠,e2e 同形态)。步进被拒=引擎状态机 bug,响亮炸(零兜底)。
      e.doDraftRoll();
      while (e.phase === "Setup" && e.players[e.currentSetupPlayerIndex].isBot) {
        if (!e.aiSetupStep()) throw new Error("起兵镜像:bot 选都步进被拒(引擎状态机 bug)");
      }
      const c = newWiringController(e);
      setController(c);
      act(() => {
        c.resync();
      });
      setScreen("game");
    } catch (err) {
      useGameStore.getState().pushHint(`起兵失败:${(err as Error).message}`);
    }
  };
  let content: React.ReactNode;
  if (screen === "game") {
    content = <GameScreen />;
  } else if (screen === "solo-setup" && initialMapId) {
    content = (
      <div className="relative h-full">
        <SoloSetupScreen
          onStart={handleStart}
          onBack={() => setScreen("setup")}
          mapId={initialMapId}
          mapSource={mapSource}
          onMapChange={handleMapChange}
        />
      </div>
    );
  } else if (screen === "setup" && initialMapId) {
    content = (
      <div className="relative h-full">
        <HomeScreen
          onSolo={() => setScreen("solo-setup")}
          onOnline={() => {
            throw new Error("接线测试:联机入口不在本族断言面(点到了就是装配 bug)");
          }}
          initialMapId={initialMapId}
          onMapChange={handleMapChange}
          mapSource={mapSource}
        />
      </div>
    );
  } else {
    content = <p className="p-8 font-deco">地图清单加载中…</p>;
  }
  return <div className="relative h-full w-full">{content}</div>;
}

let container: HTMLElement | null = null;
let root: Root | null = null;

/** act() 内挂 WiringHost;卸载统一走 afterEach。 */
function mount(): HTMLElement {
  container = document.createElement("div");
  document.body.appendChild(container);
  act(() => {
    root = createRoot(container!);
    root.render(<WiringHost mapSource={new MemMapSource()} />);
  });
  return container;
}

function q(scope: ParentNode, id: string): Element | null {
  return scope.querySelector(`[data-testid="${id}"]`);
}

/** 屏内元素取用口(带显式报错,零兜底):缺失=装配/接线 bug,报「接线测试:」错。 */
function must(scope: ParentNode, id: string, label: string): Element {
  const el = q(scope, id);
  if (el == null) throw new Error(`接线测试:${label}缺席(${id} 装配/接线断)`);
  return el;
}

/** 真点击(React 合成事件走冒泡;act 内派发,模板同款)。 */
function click(el: Element): void {
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

/** 异步拍收口(模板同款):弹层壳底件挂载拍有 RO 测量态更新,让一拍宏任务并包进
 *  act(断言面不依赖该拍,纯噪声治理)。 */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

/** 有界等待出现(异步链:清单/预览加载/起兵开局):happy-dom 真定时器下自然走时,
 *  轮询到位即收,超死线响亮红(显式超时禁裸等)。 */
async function waitUntil(cond: () => boolean, label: string, timeout = 3_000): Promise<void> {
  const deadline = Date.now() + timeout;
  while (!cond() && Date.now() < deadline) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
  }
  expect(cond(), label).toBe(true);
}

/** 有界等待卸载(manual-wiring waitUnmounted 同款):退场协议(210ms「播完再移除」)
 *  走完即卸——轮询到位即收,超死线响亮红。 */
async function waitUnmounted(
  query: () => Element | null,
  label: string,
  timeout = 3_000,
): Promise<void> {
  const deadline = Date.now() + timeout;
  while (query() != null && Date.now() < deadline) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
  }
  expect(query(), label).toBeNull();
}

/** 弹层查询口:选图面板/手册弹层经 Portal 渲染在 body,一律 document 级。 */
const modalQ = (id: string): Element | null => q(document, id);

/** 首页就绪等待:无记忆时地图 id 走清单首项异步解析(App getDefaultMapId 镜像),
 *  home-screen 真挂才可点入口。先让一拍(清单 Promise 微任务在 act 内落定,免
 *  act 外更新噪声)再轮询。 */
async function waitHomeReady(el: HTMLElement): Promise<void> {
  await settle();
  await waitUntil(() => q(el, HOME_TID.screen) != null, "首页应真挂(地图 id 解析链断)");
}

/** 首页选图链(①②③公用前置):点「选择地图」→ 面板真挂 → 点条目展开预览。 */
async function openMapPanelAndPick(el: HTMLElement, mapId: string): Promise<void> {
  await waitHomeReady(el);
  click(must(el, HOME_TID.selectMap, "「选择地图」入口(桌面档首页装配)"));
  await settle();
  if (modalQ(SETUP_TID.mapPanel) == null)
    throw new Error("接线测试:选图面板未挂载(选图入口接线断)");
  click(must(document, SETUP_TID.mapItem(mapId), `地图条目 ${mapId}(清单装配)`));
  await waitUntil(() => modalQ(SETUP_TID.mapPreview) != null, "点选应展开 SVG 预览");
}

beforeAll(async () => {
  ensureHappyDom();
  // 自动化通道豁免(头注判词):home 挂载即 startWarmup,置自动化位走生产既有豁免口。
  Object.defineProperty(globalThis.navigator, "webdriver", {
    get: () => true,
    configurable: true,
  });
  // 环境缝(matchMedia stub 同族,#1284 配方;起兵例挂 GameScreen 吃同一缝):
  // happy-dom 无排版引擎,底板 svg clientWidth/Height 恒 0——boardHost commit 拍
  // 真值断言(ensureBoardPxPerUnit,零兜底设计)当场炸;document.fonts.ready 同缺席。
  // 断言面不碰任何几何(断言宪法,[data-tile] 是节点计数非几何)。
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
  const homeMod = await import("@app/screens/home/HomeScreen");
  const setupMod = await import("@app/screens/setup/SoloSetupScreen");
  const screenMod = await import("@app/screens/game/GameScreen");
  const registryMod = await import("@app/controllers/registry");
  const ctrlMod = await import("@app/controllers/controller");
  HomeScreen = homeMod.HomeScreen;
  SoloSetupScreen = setupMod.SoloSetupScreen;
  GameScreen = screenMod.GameScreen;
  setController = registryMod.setController;
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
      this.sync();
    }
    // 测试侧重灌口(protected sync 的公开面)。
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
  // localStorage 卫生(头注):本族触及键成对清除,防跨例泄漏
  localStorage.removeItem(MAP_PREF_KEY);
  localStorage.removeItem("dafung.guohao");
});

afterAll(async () => {
  // 排干 React 调度器余拍(模板同款)再拆 happy-dom。
  await new Promise((r) => setTimeout(r, 0));
  await releaseHappyDom();
});

describe("选图面板接线(自 react-map-selection 迁入,#1316 批T2)", () => {
  // ── ①清单与预览(react-map-selection 例 1 迁入)──
  // 断言面:点「选择地图」→ 面板真挂;内置图清单含城数与目标(城数随清单数据,真
  // public/maps 数据零假数据);点选展开 SVG 预览(节点有无)。
  it("选图面板:列出内置图(含城数与目标),点选展开 SVG 预览", async () => {
    const el = mount();
    await waitHomeReady(el);
    click(must(el, HOME_TID.selectMap, "「选择地图」入口(桌面档首页装配)"));
    await settle();
    if (modalQ(SETUP_TID.mapPanel) == null)
      throw new Error("接线测试:选图面板未挂载(选图入口接线断)");
    expect(must(document, SETUP_TID.mapItem("guanzhong"), "关中条目").textContent).toContain(
      "28 城",
    ); // #938 28 城 4×7 缩域盘
    expect(must(document, SETUP_TID.mapItem("zhongyuan"), "中原条目").textContent).toContain(
      "8 城",
    );
    // 点 zhongyuan → 异步加载 + 简版预览 SVG
    click(must(document, SETUP_TID.mapItem("zhongyuan"), "中原条目"));
    await waitUntil(() => modalQ(SETUP_TID.mapPreview) != null, "点选应展开 SVG 预览");
  });

  // ── ②确认记忆(react-map-selection 例 2 迁入)──
  // 断言面:点选→确认的真交互链,地图名刷新(展示名回显)+ localStorage 记忆写入
  // (真 happy-dom localStorage 语义)。
  it("选 zhongyuan 确认:地图名刷新 + 记忆到 localStorage(dafung.mapId)", async () => {
    const el = mount();
    await openMapPanelAndPick(el, "zhongyuan");
    click(must(document, SETUP_TID.mapConfirm, "确认选择钮"));
    await settle();
    expect(must(el, SETUP_TID.currentMapName, "地图名回显").textContent).toBe("中原争霸");
    expect(localStorage.getItem(MAP_PREF_KEY)).toBe("zhongyuan");
  });

  // ── ③换图起兵(react-map-selection 例 3 迁入)──
  // 断言面:选图→起兵真开局链——引擎按所选图构造(镜像 handleStart 装配段,判词见
  // 头注/宿主注),棋盘为 8 城小环([data-tile] 节点计数)+ 快照健康(Setup 相位/
  // 默认 4 席)。种子 42 = e2e ?seed=42 同源(确定性前提,非新拍板)。
  it("选 zhongyuan 起兵:棋盘为 8 城小环,快照健康", async () => {
    const el = mount();
    await openMapPanelAndPick(el, "zhongyuan");
    click(must(document, SETUP_TID.mapConfirm, "确认选择钮"));
    await settle();
    click(must(el, HOME_TID.solo, "「单机模式」入口")); // 首页 → 次级配置页
    await settle();
    click(must(el, SETUP_TID.startGame, "起兵钮"));
    // 起兵是异步链(loadMapById→构造→sync→切屏):有界等 Game 屏快照直灌
    await waitUntil(() => useGameStore.getState().snapshot != null, "起兵后快照应直灌(开局链断)");
    // 棋盘为 8 城小环(节点计数非几何)+ 快照健康(e2e 同款三断言)
    expect(el.querySelectorAll("[data-tile]")).toHaveLength(8);
    const s = useGameStore.getState().snapshot!;
    expect(s.phase).toBe("Setup");
    expect(s.players).toHaveLength(4); // 默认 4 诸侯档
  });
});

describe("记忆健壮性接线(自 react-resilience 迁入,#1316 批T2)", () => {
  // ── ④垃圾串回显(react-resilience 例 1 迁入)──
  // 断言面:零兜底原则的 UI 面——垃圾记忆原样回显可见、启动不卡死、记忆不被静默
  // 改写(损坏可见,不静默清空)。真 localStorage 预置 + 首页真渲染。
  it("记忆地图 id 为垃圾串:首页原样回显不卡死,记忆不被静默清空", () => {
    localStorage.setItem(MAP_PREF_KEY, "not-json{{{");
    const el = mount();
    // 垃圾串也是合法记忆值:不走「清单加载中」闸,首页直接渲染,id 原样回显(待数据非兜底)
    expect(el.textContent).not.toContain("地图清单加载中…");
    expect(must(el, SETUP_TID.currentMapName, "地图名回显").textContent).toBe("not-json{{{");
    // 不静默清空:垃圾记忆原样保留(损坏对后续开局可见,见下例「失效 id」)
    expect(localStorage.getItem(MAP_PREF_KEY)).toBe("not-json{{{");
  });

  // ── ⑤失效 id 拦截(react-resilience 例 2 迁入)──
  // 断言面:失效记忆 id 起兵 → loadMapById 真抛错(内存源与生产 FetchMapSource 同
  // 语义)→ 显式报错(hint「起兵失败」,UI setError 豁免条款)+ 停留设置屏 + 引擎
  // 未构造(快照缺席)——降级不崩溃,零静默兜底。
  it("记忆的地图 id 失效:起兵被拦,停留设置屏(降级不崩溃)", async () => {
    localStorage.setItem(MAP_PREF_KEY, "no-such-map");
    const el = mount();
    expect(must(el, SETUP_TID.currentMapName, "地图名回显").textContent).toBe("no-such-map");
    click(must(el, HOME_TID.solo, "「单机模式」入口"));
    await settle();
    click(must(el, SETUP_TID.startGame, "起兵钮"));
    // 起兵是异步链:有界等显式报错落账(真抛错→pushHint,生产同一 catch 通路)
    await waitUntil(
      () => useGameStore.getState().hint != null,
      "起兵失败应显式报错(静默=兜底,违零兜底原则)",
    );
    expect(useGameStore.getState().hint).toContain("起兵失败");
    // 降级不崩溃:停留配置页、未开局(快照缺席 = 引擎未构造,e2e getEngine() 探针同语义)
    expect(q(el, SETUP_TID.screen)).not.toBeNull();
    expect(useGameStore.getState().snapshot).toBeNull();
  });
});

describe("手册收口净空(自 react-manual 迁入,#1316 批T2)", () => {
  // ── ⑥收口净空(react-manual 例 3 迁入)──
  // 断言面:详情开着点壳 X,叠层先卸/壳随收/零孤儿弹层的退场协议真实走查(全 DOM
  // 有无)。几何腿(顶带让位/重开壳体 opacity)不在此层——react-manual 存例判词见
  // 分类表行注。
  it("收口净空:详情开着点壳 X,叠层随壳同卸不留孤儿", async () => {
    const el = mount();
    // 首页「手册」入口真点击开弹层(到达链与 e2e 同构)
    await waitHomeReady(el);
    click(must(el, HOME_TID.manual, "「手册」入口"));
    await settle();
    if (modalQ(MANUAL_TID.modal) == null)
      throw new Error("接线测试:手册弹层未挂载(手册入口接线断)");
    click(must(document, MANUAL_TID.tabEncounters, "机遇签"));
    await settle();
    click(must(document, MANUAL_TID.card("义士来投"), "霉运卡(义士来投)"));
    const detail = modalQ(MANUAL_TID.detail("义士来投"));
    if (detail == null) throw new Error("接线测试:机遇详情叠层未挂载(点卡接线断)");
    // 壳的题名行+X 露在叠层上方,真机可点(裸弹层复的触发钮):点壳 X 而非叠层 X
    click(must(document, MANUAL_TID.close, "壳关闭钮"));
    // 净空语义:叠层先于壳退场消失(closing 起手即卸载,壳 210ms 协议随后收场);
    // 两体有界轮询各到终态即收(断言面=先后卸载的终态,非时序数值)
    await waitUnmounted(
      () => modalQ(MANUAL_TID.detail("义士来投")),
      "叠层应先于壳卸载(closing 起手即净空)",
      2_000,
    );
    await waitUnmounted(() => modalQ(MANUAL_TID.modal), "壳应随退场协议卸载", 2_000);
    // 不留孤儿:body 上无任何活弹层,人回首页
    expect(document.querySelectorAll('[data-slot="dialog-content"]').length).toBe(0);
    expect(q(el, HOME_TID.screen)).not.toBeNull();
  });
});
