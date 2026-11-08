// 接线测试范例例(ADR-0062 层④,#1284 试点):席位格计数投影族(SeatRail)——
// react-seat-cells 的 cellsMatchSnapshot 逐席对账(现金+五图标计数)搬入接线层。
//
// 【判层理由】SeatRail 是 store 投影型纯渲染组件(#1096 决议1 纯展示,交互面已
// 退役):数据流单向 = store 快照 → 双行八项格 DOM,零 fx 泵、零真实时钟、零
// matchMedia 断点分支(式样全落 layout.css,组件零 JS 断点——故本例不需要
// matchMedia stub;后续接线例若断响应式分档类,stub 法:`globalThis.matchMedia =
// () => ({ matches: false, addEventListener() {}, removeEventListener() {} })` 级
// 假件)。第一波只收投影型组件:泵驱动件(行军/横幅/反应窗)留浏览器。
//
// 【渲染装配配方】(后续接线例照抄)
//   1. beforeAll ensureHappyDom()(test/wiring/happy-dom-register.ts:文件内局部注册,
//      afterAll release 还原——preload 全局注册会翻掉既有例的无 DOM 快路,判词见
//      该文件头注);
//   2. 真 GameEngine 直构(loadMap(guanzhong.json)+ createDice(seed)),公共命令
//      走完选都链(doDraftRoll → aiSetupStep/pickCapital)停在 Playing——无房间无
//      时钟,引擎不自走,零泵零竞速;
//   3. syncFromEngine(engine) 灌真 store,Host 组件订阅 useGameStore 渲染
//      SeatRail(镜像 GameScreen 数据流:snapshot 订阅 + selfSeat=solo 恒 0);
//   4. act() 内渲染与变更,断言面只许 testid/类名/DOM 文本/store 状态。
//
// 【断言宪法】本层禁几何(假 DOM 无排版引擎,getBoundingClientRect 恒 0)、禁
// 像素、禁演出泵与真实时钟;对账形状 = e2e cellsMatchSnapshot(现金逐席裸数 +
// 五账式计数剥标签字),但断言源取 useGameStore 快照(e2e 取 __dafung.snapshot(),
// 同一 store),在进程内原子对账。
//
// 【store 隔离】(#1284 量实②,结论 B)bun test 单进程多文件共享模块注册表,
// useGameStore/useNetStore 模块单例跨文件纠缠(探针实锤);按 ADR-0062 可隔离性
// 原则开最小缝:gameStore.reset()(本票新增)+ netStore.reset()(既有),本文件
// beforeEach/afterEach 成对调用——防前文件残留、不留痕给后文件。
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import guanzhongData from "../../public/maps/guanzhong.json";
import { loadMap } from "@core/board-loader";
import { GameEngine, type SeatConfig } from "@core/authority";
import { createDice } from "@core/dice";
import { SeatRail, STAMINA_LOW } from "@app/screens/game/SeatRail";
import { TESTIDS } from "@app/screens/game/testids";
import { useGameStore } from "@app/store/gameStore";
import { useNetStore } from "@app/store/netStore";
import { ensureHappyDom, releaseHappyDom } from "./happy-dom-register";

const MAP = loadMap(guanzhongData);
const SEED = 1486; // e2e quickStart 同款种子(既有对账例的既定锚,非新拍板)

/** 座位表:首座真人(solo 口径 seat 0 = 自机),余 bot——直构引擎无房间驱动,
 *  bot 座位只随选都链由 aiSetupStep 代选,进 Playing 后引擎停靠等人,零自走。 */
const SEATS: SeatConfig[] = [
  { name: "座 1", isBot: false, guohao: "魏" },
  { name: "座 2", isBot: true },
  { name: "座 3", isBot: true },
  { name: "座 4", isBot: true },
];

/** 种引擎到 Playing 停靠(公共命令链,与 seedSolo/房间编排同语义;非法态当场
 *  抛错不静默——开局链没进 Playing = 引擎状态机 bug,接线层不兜)。 */
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
      // 真人座位:选都 = 棋盘序首候选(seedSolo 口径:offeredCapitals 数组序是
      // 抽出序,Math.min 即棋盘序首个)
      const r = e.pickCapital(e.currentSetupPlayerIndex, Math.min(...e.offeredCapitals));
      if (!r.ok) throw new Error(`种局:选都被拒(${r.reason ?? "未知"})`);
    }
  }
  if (e.phase !== "Playing") throw new Error(`种局:选都链后非 Playing(phase=${e.phase})`);
  return e;
}

/** 生产接线镜像(GameScreen 同款数据流):store 订阅 → SeatRail。selfSeat 取
 *  solo 口径恒 0(GameScreen:`online ? viewSeat : 0`);快照缺失即抛(对局屏
 *  挂载门卫同款,零兜底)。 */
function StoreHost() {
  const snapshot = useGameStore((s) => s.snapshot);
  if (snapshot == null) throw new Error("接线测试:快照缺失(种局链未灌 store)");
  return <SeatRail snapshot={snapshot} selfSeat={0} />;
}

let container: HTMLElement | null = null;
let root: Root | null = null;

/** act() 内挂 Host;卸载统一走 afterEach(浮标定时器随 effect cleanup 清撤)。 */
function mount(): HTMLElement {
  container = document.createElement("div");
  document.body.appendChild(container);
  act(() => {
    root = createRoot(container!);
    root.render(<StoreHost />);
  });
  return container;
}

/** 对账取数口(cellsMatchSnapshot 同形):testid 文本 + 五账式剥标签字取纯数。 */
function q(el: HTMLElement, id: string): Element | null {
  return el.querySelector(`[data-testid="${id}"]`);
}
function num(el: HTMLElement, id: string): string | null {
  return q(el, id)?.textContent?.replace(/^[城牌将宝望]/, "") ?? null;
}
const handShown = (n: number): string => (n > 9 ? "9+" : String(n));
/** 席位格根 testid:自机占 seatSelf 不占 seat-0(自机入列契约,e2e 同款)。 */
const cellId = (seat: number): string => (seat === 0 ? TESTIDS.seatSelf : TESTIDS.seat(seat));

beforeAll(() => {
  ensureHappyDom();
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

describe("席位格接线(ADR-0062 层④范例):store 快照 → 双行八项格投影", () => {
  // 逐席对账(cellsMatchSnapshot 搬入):真引擎种到 Playing,快照灌 store,断言
  // 现金与五图标计数逐席与 store 快照一致。零种植快照字段——数值全由引擎真逻辑
  // 长出(起手现金/珍宝/国号摇序随 seed)。
  it("逐席对账:现金裸数与五账式计数随 store 快照真渲染;一人一格自机入列", () => {
    const e = seedPlayingEngine();
    act(() => {
      useGameStore.getState().syncFromEngine(e);
      useGameStore.getState().setViewSeat(0);
    });
    const el = mount();
    const snap = useGameStore.getState().snapshot!;
    // 结构:全员一格入 seatcol;自机格占 seatSelf,seat-0 缺席(自机入列契约)
    expect(el.querySelectorAll(`[data-testid="${TESTIDS.seatRail}"] .seatcol .seat`)).toHaveLength(
      snap.players.length,
    );
    expect(q(el, TESTIDS.seat(0))).toBeNull();
    expect(q(el, TESTIDS.seatSelf)).not.toBeNull();
    // 逐席对账(e2e cellsMatchSnapshot 同形,断言源 = useGameStore 快照)
    snap.players.forEach((p, seat) => {
      expect(q(el, TESTIDS.seatCash(seat))?.textContent).toBe(String(p.cash));
      expect(num(el, TESTIDS.seatAttr(seat, "city"))).toBe(String(p.properties.length));
      expect(num(el, TESTIDS.seatAttr(seat, "hand"))).toBe(handShown(p.jinnangHandCount));
      expect(num(el, TESTIDS.seatAttr(seat, "hero"))).toBe(String(p.heroes.length));
      expect(num(el, TESTIDS.seatAttr(seat, "gem"))).toBe(String(p.treasures.length));
      expect(num(el, TESTIDS.seatAttr(seat, "rep"))).toBe(String(p.reputation));
    });
  });

  // 状态挂点随快照:活跃金圈(activeIndex)/自机金样式;接线环「引擎公共命令 →
  // syncFromEngine → UI 更新」以 addStamina 演示(濒耗竭形态开局初期到不了,起手
  // 满体力、负增量无自然来源——压体力走引擎公共方法,生产同通路,e2e 同判词)。
  it("接线环:引擎公共命令→store→UI;活跃/自机挂点随快照,濒耗竭色条挂 .low", () => {
    const e = seedPlayingEngine();
    act(() => {
      useGameStore.getState().syncFromEngine(e);
      useGameStore.getState().setViewSeat(0);
    });
    const el = mount();
    const snap = useGameStore.getState().snapshot!;
    // 活跃:恰一格 .active,即快照 activeIndex 席;自机格恒 .self
    expect(el.querySelectorAll(".seat.active")).toHaveLength(1);
    expect(q(el, cellId(snap.activeIndex))?.className).toContain("active");
    expect(q(el, TESTIDS.seatSelf)?.className).toContain("self");
    // 接线环:引擎公共命令 → 重灌 store → 席位格色条翻档(纯投影,零泵)
    const after = e.addStamina(1, -80);
    expect(after).toBeLessThan(STAMINA_LOW); // 濒耗竭前提(钳制后的落账值)
    act(() => {
      useGameStore.getState().syncFromEngine(e);
    });
    const track = q(el, TESTIDS.seatStamina(1))?.querySelector(".strack");
    expect(track).not.toBeNull();
    expect(track!.className).toContain("low");
  });

  // 快照直种投影:接线层被测面 = store 态 → DOM,故 store 快照可直种形态字段
  // (SnapshotPlayer 同形展开,类型面护栏)——9+/负声望/破产三形态引擎无「即时
  // 到达」公共通路(手牌数随抽牌事件、破产归清算整局推演),e2e 直写引擎字段同
  // 判词;本层连直写都不必:组件契约只看 store,直种 store 即被测环本体。
  it("快照直种投影:手牌封顶 9+(aria 保真全数)/负声望 rep-neg/破产 bankrupt", () => {
    const e = seedPlayingEngine();
    act(() => {
      useGameStore.getState().syncFromEngine(e);
      useGameStore.getState().setViewSeat(0);
    });
    const el = mount();
    act(() => {
      const snap = useGameStore.getState().snapshot!;
      useGameStore.setState({
        snapshot: {
          ...snap,
          players: snap.players.map((p, i) =>
            i === 2 ? { ...p, jinnangHandCount: 12, reputation: -5, isBankrupt: true } : p,
          ),
        },
      });
    });
    // 封顶态(#743 判词 A):格上「9+」示意,aria-label 保真全数(数值例外条款)
    expect(num(el, TESTIDS.seatAttr(2, "hand"))).toBe("9+");
    expect(q(el, TESTIDS.seatAttr(2, "hand"))?.getAttribute("aria-label")).toBe("锦囊手牌 12");
    // 负声望:整项朱砂挂点,数值保真负值(不在封顶族)
    expect(num(el, TESTIDS.seatAttr(2, "rep"))).toBe("-5");
    expect(q(el, TESTIDS.seatAttr(2, "rep"))?.className).toContain("rep-neg");
    // 破产:整格降透明印灰挂点
    expect(q(el, cellId(2))?.className).toContain("bankrupt");
  });
});
