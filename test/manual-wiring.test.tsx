// 接线测试(ADR-0062 层④,#1288 批一):手册详情叠层投影族——react-manual 的
// 「名将详情」「机遇详情」两例迁入接线层。判层只看断言面:点卡开叠层/只读语境无
// 拍板钮/体力代价注记明文 = 全部「点击→命令→DOM 有无与文本」接线语义,零几何零
// 像素零演出泵。(同格「五签陈列数」例不迁:实际断言面混「内滚不溢出」几何腿
// (scrollHeight/clientHeight + boundingBox 视口钳)= 名册标错,停手上报未动,
// 判词与行注见 e2e-分类表 react-manual 行。)
//
// 【渲染装配配方】(模板 = test/seat-rail-wiring.test.tsx,#1284 试点;本文件在模板
// 四步上多一条「晚绑红线」,其余照抄)
//   0. 【晚绑红线,本文件新增】凡「typeof document 求值期捕获」的依赖必须晚于
//      ensureHappyDom 求值——Base UI 全族(弹层底件)的 useIsoLayoutEffect 在模块
//      求值期按 document 在场与否定型:静态 import 会把整条 @base-ui 链在注册前
//      求值,layout effect 被冻结成 noop,Dialog 的 mounted 门控永不翻转、弹层永不
//      挂载(探针实锤:空壳渲染零报错)。故 @base-ui 消费组件(ManualModal)一律
//      beforeAll 内 await import 晚绑;@core 纯逻辑与 testids(零 DOM 求值期捕获,
//      模板同款)照旧静态。
//   1. beforeAll ensureHappyDom()(test/happy-dom-register.ts:文件内局部注册,
//      afterAll release 还原——preload 全局注册会翻掉既有例的无 DOM 快路,判词见
//      该文件头注);
//   2-3. 手册是全静态 UI(直渲 core 目录表,零引擎零机遇随机),无种局步骤:
//      ManualWiringHost 受控挂 ManualModal(open,镜像首页「手册」入口点开后的挂载态
//      ——入口点击链与首页导航非本例断言面,e2e 同口径);
//   4. act() 内渲染与变更,断言面只许 testid/DOM 文本。
//
// 【退场协议等待判词】叠层关闭走 useDialogExit「播完再移除」(210ms setTimeout 出口
// 卸载)——本层断言的不是时序数值而是「协议走完即卸载」的语义:happy-dom 真定时器
// 自然走时,有界轮询(2s 死线,act 内让出)到位即收,超线即响亮红;实仓先例 =
// local-room.test.ts 的有界轮询形态。非演出泵(无 rAF 循环、无动画值断言)。
//
// 【store 隔离】本族零 store 消费(手册直读 core 目录表),仍按纪律成对 reset
// (模板同款,防前文件残留)。
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import { act } from "react";
import { useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MANUAL_TID } from "@app/screens/manual/testids";
import { TESTIDS } from "@app/screens/game/testids";
import { useGameStore } from "@app/store/gameStore";
import { useNetStore } from "@app/store/netStore";
import { ensureHappyDom, releaseHappyDom } from "./happy-dom-register";

/** 晚绑模块型(late binding):类型面静态、求值面动态(晚绑红线见头注第 0 步)。 */
type ManualModule = typeof import("@app/screens/manual/ManualModal");
let ManualModal: ManualModule["ManualModal"];

let container: HTMLElement | null = null;
let root: Root | null = null;

/** act() 内挂 Host(手册弹层挂载即开态);卸载统一走 afterEach。 */
function mount(): HTMLElement {
  container = document.createElement("div");
  document.body.appendChild(container);
  act(() => {
    root = createRoot(container!);
    root.render(<ManualWiringHost />);
  });
  return container;
}

/** 受控挂载态(镜像首页入口点开后的形态):open 恒真;onClose 由壳协议触发(本两例
 *  只关叠层不关壳,e2e 同口径)。 */
function ManualWiringHost() {
  const [, forceClose] = useState(0);
  return <ManualModal open onClose={() => forceClose((n) => n + 1)} />;
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

/** 退场协议收口等待(判词见头注):有界轮询到「叠层卸载」即收,超死线响亮红。 */
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
  // 晚绑红线(头注第 0 步):document 在场后再求值 Base UI 消费链。
  const mod = await import("@app/screens/manual/ManualModal");
  ManualModal = mod.ManualModal;
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

describe("手册详情叠层接线(ADR-0062 层④,#1288 批一):点卡 → 叠层 DOM 投影", () => {
  // 名将详情(e2e「名将详情」例迁入,#1288):点周瑜卡开技能全览只读弹层——可达名
  // (题名将名)、只读语境契约(不传 onPick → 无「收为麾下」拍板钮,spec 决议⑤)、
  // 可关回(壳 X → 退场协议卸载),全 testid 有无断言。
  it("名将详情:点周瑜卡开技能全览只读弹层(无拍板钮),壳 X 关回", async () => {
    mount();
    const card = q(document, MANUAL_TID.card("zhouyu"));
    if (card == null) throw new Error("接线测试:周瑜卡缺席(名将签未渲染)");
    click(card);
    const glossary = q(document, TESTIDS.skillGlossary);
    if (glossary == null) throw new Error("接线测试:技能全览叠层未挂载(点卡接线断)");
    // 只读浏览语境:不传 onPick → 无「收为麾下」拍板钮(spec 决议⑤)。
    expect(q(document, TESTIDS.skillGlossaryPick)).toBeNull();
    // 点叠层壳 X:退场协议(210ms「播完再移除」)走完叠层卸载。
    const close = q(document, TESTIDS.modalClose);
    if (close == null) throw new Error("接线测试:叠层关闭钮缺席");
    click(close);
    await waitUnmounted(() => q(document, TESTIDS.skillGlossary), "技能全览叠层应随协议卸载");
  });

  // 机遇详情(e2e「机遇详情」例迁入,#1288):霉运卡点开详情,即时条注体力代价
  // (机读 effect.staminaDelta 注记,与 choices 注同形制,Q1 拍板)——文本明文断言。
  it("机遇详情:霉运即时条注体力代价(粮道被劫),可关回", async () => {
    mount();
    // 签行真点击切机遇签(签选态=本地 state 接线)。
    const tab = q(document, MANUAL_TID.tabEncounters);
    if (tab == null) throw new Error("接线测试:机遇签缺席(签行未渲染)");
    click(tab);
    const card = q(document, MANUAL_TID.card("粮道被劫"));
    if (card == null) throw new Error("接线测试:霉运卡(粮道被劫)缺席(机遇签未渲染)");
    click(card);
    const detail = q(document, MANUAL_TID.detail("粮道被劫"));
    if (detail == null) throw new Error("接线测试:机遇详情叠层未挂载(点卡接线断)");
    // 详情机读 effect.staminaDelta 注体力代价(减号 U+2212,现值 −10)。
    expect(detail.textContent).toContain("体力 −");
    // 点叠层壳 X 关回:退场协议走完卸载。
    const close = q(document, TESTIDS.modalClose);
    if (close == null) throw new Error("接线测试:叠层关闭钮缺席");
    click(close);
    await waitUnmounted(
      () => q(document, MANUAL_TID.detail("粮道被劫")),
      "机遇详情叠层应随协议卸载",
    );
  });
});
