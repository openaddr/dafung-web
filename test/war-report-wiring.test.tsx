// 接线测试(ADR-0062 层④,#1288 批一):战报抽屉投影族——react-war-report 两例
// (窗口化渲染契约 + 未读金点清账)迁入接线层。判层只看断言面:窗口化=固定窗行数
// 契约(节点计数非排版测量)、金点=状态挂点(testid 有无),断言面全部是「操作过后
// store/渲染树里的语义」,零几何零像素零演出泵。
//
// 【渲染装配配方】(模板 = test/seat-rail-wiring.test.tsx,#1284 试点;本文件在模板
// 四步上多一条「晚绑红线」,其余照抄)
//   0. 【晚绑红线,本文件新增】凡「typeof document 求值期捕获」的依赖必须晚于
//      ensureHappyDom 求值——Base UI 全族(弹层底件)的 useIsoLayoutEffect 在模块
//      求值期按 document 在场与否定型:静态 import 会把整条 @base-ui 链在注册前
//      求值,layout effect 被冻结成 noop,Dialog 的 mounted 门控永不翻转、弹层永不
//      挂载(探针实锤:空壳渲染零报错)。故 @base-ui 消费组件(GameTopBar/
//      WarReportDrawer)一律 beforeAll 内 await import 晚绑;@core 纯逻辑与 store/
//      testids(零 DOM 求值期捕获,模板同款)照旧静态。
// 【降级注记(#1297 波评审 P1)】WarWiringHost 内「未读账三行+openWarReport 直连」
// 是 GameScreen 对应接线的抄本替身:生产链(⚙→设置弹层→「战报›」)与 GameScreen
// 账本改动本例不感知——本例守 GameTopBar 挂点+抽屉投影;账本接线升格走批二整屏
// 真挂范式或 hook 提取,后续迁移票禁复制本抄本。
//   1. beforeAll ensureHappyDom()(test/happy-dom-register.ts:文件内局部注册,
//      afterAll release 还原——preload 全局注册会翻掉既有例的无 DOM 快路,判词见
//      该文件头注);
//   2. 真 GameEngine 直构(loadMap(guanzhong.json)+ createDice(seed)),公共命令
//      走完选都链(doDraftRoll → aiSetupStep/pickCapital)停在 Playing——无房间无
//      时钟,引擎不自走,零泵零竞速;
//   3. syncFromEngine(engine) 灌真 store,WarWiringHost 订阅 useGameStore 渲染
//      GameTopBar + 条件挂载 WarReportDrawer(镜像 GameScreen 数据流:战报未读账
//      三行 + openWarReport 清账回调逐行同款);
//   4. act() 内渲染与变更,断言面只许 testid/类名/DOM 文本/store 状态。
//
// 【到达形制换轨判词】e2e 的「真实开局 + 设置弹层两击开抽屉」链在此收敛为:种局
// 配方(同 #1284 模板)+ ⚙ 钮真点击直通 openWarReport——设置弹层自身开合是另一
// 组件的断言面,未读账与抽屉投影的接线在 GameScreen.openWarReport 回调,Host 原样
// 接线即被测环。force(log 只增、无「指定时刻追加」公共命令,e2e 同判词)换成 store
// 快照直种:接线层被测面 = store 态 → DOM,组件契约只看 store,直种即被测环本体
// (模板第三例同判词);直种条目与真条目同 LogEvent schema,渲染窗感知同形数据。
//
// 【断言宪法】本层禁几何(假 DOM 无排版引擎,getBoundingClientRect 恒 0)、禁像素、
// 禁演出泵与真实时钟;本两例断言面 = .war-item 行数 / testid 有无 / 条目文本,纯
// 节点计数与状态挂点。
//
// 【store 隔离】(#1284 量实②,结论 B)useGameStore/useNetStore 模块单例跨文件
// 纠缠,本文件 beforeEach/afterEach 成对调用 reset()——防前文件残留、不留痕给后文件。
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import { act } from "react";
import { useCallback, useMemo, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import guanzhongData from "../public/maps/guanzhong.json";
import { loadMap } from "@core/board-loader";
import { GameEngine, type SeatConfig } from "@core/authority";
import { createDice } from "@core/dice";
import type { LogEvent } from "@core/model";
import { TESTIDS } from "@app/screens/game/testids";
import { useGameStore } from "@app/store/gameStore";
import { useNetStore } from "@app/store/netStore";
import { ensureHappyDom, releaseHappyDom } from "./happy-dom-register";

/** 晚绑模块型(late binding):类型面静态、求值面动态(晚绑红线见头注第 0 步)。 */
type WarReportModule = typeof import("@app/screens/game/WarReportDrawer");
type GameTopBarModule = typeof import("@app/screens/game/GameTopBar");
let WarReportDrawer: WarReportModule["WarReportDrawer"];
let warEntriesOf: WarReportModule["warEntriesOf"];
let WAR_WINDOW: WarReportModule["WAR_WINDOW"];
let GameTopBar: GameTopBarModule["GameTopBar"];

const MAP = loadMap(guanzhongData);
const SEED = 1486; // 模板同款种子(e2e quickStart 谱内既定锚,非新拍板)

/** 座位表:与模板同(solo 口径 seat 0 = 自机)。 */
const SEATS: SeatConfig[] = [
  { name: "座 1", isBot: false, guohao: "魏" },
  { name: "座 2", isBot: true },
  { name: "座 3", isBot: true },
  { name: "座 4", isBot: true },
];

/** 种引擎到 Playing 停靠(公共命令链,与模板 seedPlayingEngine 同语义;非法态当场
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

/** 生产接线镜像(GameScreen 同款数据流):store 订阅 → GameTopBar(未读金点)+
 *  条件挂载 WarReportDrawer。「战报未读账(#768)」与 openWarReport 逐行镜像
 *  GameScreen 同名段:warTotal 挂 logCount 值语义依赖(#1081)、游标越过总数=日志
 *  账本已换、开抽屉即清账(条数取点击拍当下快照,getState 读不闭包捕获)。快照缺失
 *  即抛(对局屏挂载门卫同款,零兜底)。 */
function WarWiringHost() {
  const snapshot = useGameStore((s) => s.snapshot);
  if (snapshot == null) throw new Error("接线测试:快照缺失(种局链未灌 store)");
  const [warReportOpen, setWarReportOpen] = useState(false);
  const [warReadCount, setWarReadCount] = useState(0);
  const warTotal = useMemo(() => warEntriesOf(snapshot).length, [snapshot.logCount]);
  const warUnread = warReadCount > warTotal ? warTotal : warTotal - warReadCount;
  const openWarReport = useCallback(() => {
    setWarReadCount(warEntriesOf(useGameStore.getState().snapshot!).length);
    setWarReportOpen(true);
  }, []);
  return (
    <>
      <GameTopBar snapshot={snapshot} warUnread={warUnread} onOpenSettings={openWarReport} />
      {warReportOpen && (
        <WarReportDrawer snapshot={snapshot} onClose={() => setWarReportOpen(false)} />
      )}
    </>
  );
}

let container: HTMLElement | null = null;
let root: Root | null = null;

/** act() 内挂 Host;卸载统一走 afterEach。 */
function mount(): HTMLElement {
  container = document.createElement("div");
  document.body.appendChild(container);
  act(() => {
    root = createRoot(container!);
    root.render(<WarWiringHost />);
  });
  return container;
}

function q(scope: ParentNode, id: string): Element | null {
  return scope.querySelector(`[data-testid="${id}"]`);
}

/** 真点击(React 合成事件走冒泡;act 内派发)。 */
function click(el: Element): void {
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

/** 抽屉壳自带关闭钮(Base UI SheetPrimitive.Close,面板右上 ×):onOpenChange(false)
 *  → close() → onClose,真实用户关闭通路。 */
function clickDrawerClose(): void {
  const btn = document.querySelector('[data-slot="sheet-close"]');
  if (btn == null) throw new Error("接线测试:抽屉关闭钮缺席(壳未挂载?)");
  click(btn);
}

/** store 快照直种追加战报条目(与真条目同 LogEvent schema;返回追加后的战报总条数)。 */
function appendWarEntries(count: number, briefOf: (i: number) => string): number {
  const snap = useGameStore.getState().snapshot!;
  const synth: LogEvent[] = Array.from({ length: count }, (_, i) => ({
    ts: Date.now(),
    round: snap.round,
    turn: snap.turnNumber,
    player: "魏",
    brief: briefOf(i),
    detail: `act=synth i=${i}`,
    category: "roll",
  }));
  act(() => {
    useGameStore.setState({
      snapshot: {
        ...snap,
        log: [...snap.log, ...synth],
        logCount: snap.log.length + count,
      },
    });
  });
  return warEntriesOf(useGameStore.getState().snapshot!).length;
}

beforeAll(async () => {
  ensureHappyDom();
  // 晚绑红线(头注第 0 步):document 在场后再求值 Base UI 消费链。
  const warMod = await import("@app/screens/game/WarReportDrawer");
  const topBarMod = await import("@app/screens/game/GameTopBar");
  WarReportDrawer = warMod.WarReportDrawer;
  warEntriesOf = warMod.warEntriesOf;
  WAR_WINDOW = warMod.WAR_WINDOW;
  GameTopBar = topBarMod.GameTopBar;
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
  useGameStore.getState().reset();
  useNetStore.getState().reset();
});

afterAll(async () => {
  await releaseHappyDom();
});

describe("战报抽屉接线(ADR-0062 层④,#1288 批一):store 快照 → 窗口化条目列投影", () => {
  // 窗口化渲染契约(e2e「战报抽屉窗口化」例迁入,#1288):①长日志只渲最近一窗;
  // ②截断态追加行数恒一窗、新条目在窗内;③「加载更早」每次放开一窗,放到见底按钮
  // 消失、行数=全部条目。全节点计数,零排版测量。
  it("窗口化:长日志只渲一窗,截断态追加不涨行数,加载更早按窗放开到见底", () => {
    const e = seedPlayingEngine();
    act(() => {
      useGameStore.getState().syncFromEngine(e);
    });
    const el = mount();
    // 膨胀 350 条玩法事件(roll 入白名单),叠加开局存量后总战报条数 > 2 窗。
    const total = appendWarEntries(350, (i) => `合成战报${i}号事件`);
    expect(total).toBeGreaterThan(WAR_WINDOW * 2);
    // ⚙ 钮真点击开抽屉(Host 接线:onOpenSettings → openWarReport 清账回调)。
    const settingsBtn = q(el, TESTIDS.settingsButton);
    if (settingsBtn == null) throw new Error("接线测试:设置钮缺席(顶栏未挂载)");
    click(settingsBtn);
    const drawer = q(document, TESTIDS.logDrawer);
    if (drawer == null) throw new Error("接线测试:抽屉未挂载(开抽屉接线断)");
    // ① 只渲最近一窗:行数恰一窗;最旧条目(0 号)在窗外、最新条目(349 号)在窗内
    //    (倒序=最新在上)。
    const items = () => document.querySelectorAll(".war-item");
    expect(items()).toHaveLength(WAR_WINDOW);
    expect(drawer.textContent).toContain("合成战报349号事件");
    expect(drawer.textContent).not.toContain("合成战报0号事件");
    // ② 截断态下追加(「越玩越卡」的根源就是这里当年会随日志涨到全量):行数恒一窗,
    //    新条目在窗内可见。
    const finalTotal = appendWarEntries(1, () => "合成战报999号追加事件");
    expect(items()).toHaveLength(WAR_WINDOW);
    expect(drawer.textContent).toContain("合成战报999号追加事件");
    // ③ 「加载更早」每次放开一窗;放到见底按钮消失,行数 = 全部战报条数(> 2 窗)。
    const earlier = () => q(document, TESTIDS.logEarlier);
    click(earlier()!);
    expect(items()).toHaveLength(WAR_WINDOW * 2);
    for (let i = 0; i < 4; i++) {
      const btn = earlier();
      if (btn == null) break;
      const before = items().length;
      click(btn);
      expect(items().length).toBeGreaterThan(before);
    }
    expect(earlier()).toBeNull();
    expect(items().length).toBe(finalTotal);
  });

  // 未读金点(#768)(e2e「战报未读金点」例迁入,#1288):存量即未读 → 打开抽屉清账
  // → 关抽屉后的增量再点亮 → 再开再清。挂点断言(testid 有无),纯状态投影。
  it("未读金点:存量即未读,打开抽屉清账,增量再点亮,再开再清", () => {
    const e = seedPlayingEngine();
    act(() => {
      useGameStore.getState().syncFromEngine(e);
    });
    const el = mount();
    // ① 开局存量(setup 等白名单条目)在已读游标(0)之前 = 全量未读,⚙ 钮金点即亮
    //    (断言前提:存量非空——种局链开局必然落 setup/roll 条目,零即引擎 bug)。
    expect(warEntriesOf(useGameStore.getState().snapshot!).length).toBeGreaterThan(0);
    expect(q(el, TESTIDS.settingsUnreadDot)).not.toBeNull();
    // ② 点⚙打开抽屉即清账:金点随抽屉在场撤下;壳关闭钮真点击收抽屉。
    click(q(el, TESTIDS.settingsButton)!);
    expect(q(el, TESTIDS.settingsUnreadDot)).toBeNull();
    expect(q(document, TESTIDS.logDrawer)).not.toBeNull();
    clickDrawerClose();
    expect(q(document, TESTIDS.logDrawer)).toBeNull();
    // ③ 关抽屉后的增量(log 只增)再点亮;再开再清。
    appendWarEntries(1, () => "合成战报未读号事件");
    expect(q(el, TESTIDS.settingsUnreadDot)).not.toBeNull();
    click(q(el, TESTIDS.settingsButton)!);
    expect(q(el, TESTIDS.settingsUnreadDot)).toBeNull();
    expect(q(document, TESTIDS.logDrawer)).not.toBeNull();
  });
});
