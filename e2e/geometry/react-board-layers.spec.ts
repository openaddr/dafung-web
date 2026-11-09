// 地板名册(ADR-0062):地板·几何钉——#1013 合成层 will-change computed style,三层全绿漏网的真渲染钉(拍板点名)
// 棋盘合成层提升契约(#1013,ADR-0045 修订):.bv-stack 与 fx/flow 宿主必须恒挂
// will-change:transform。守住什么:真机弱 GPU 上「决策收口→行军启动」城池闪现的
// 根修——栈/宿主不提升时与底板 #board 共用栅格缓存,弹层卸载/横幅入场/特效逐帧的
// 脏矩形连城池像素一起重栅,欠债即闪成背景色。这是桌面全绿也测不出的不可见回归
// (桌面栅格快到无感),故以 computed style 钉死;误删 = 真机闪现复发。
// 同钉两处「不提升」:tokens 宿主(子件棋子包装已逐个自提升,宿主零直接绘制)与
// 氛围层根容器(子件动画自动提升)——防「顺手统一加上」白费全屏层(DPR3 ~12MB/层)。
import { test, expect } from "../fixtures";
import { quickStart } from "../react-helpers";

// 真实段(ADR-0058):quickStart 真实开局链挂载的棋盘合成层计算样式即被测环
// (getComputedStyle willChange,呈现态断言零操作链)——零种植零冻结。
test("棋盘栈+fx/flow 宿主合成层提升契约(#1013)", async ({ page }) => {
  await quickStart(page);
  const wc = await page.evaluate(() => {
    const pick = (sel: string): string | null => {
      const el = document.querySelector(sel);
      return el == null ? null : getComputedStyle(el).willChange;
    };
    return {
      stack: pick(".bv-stack"),
      fx: pick("#bv-fx"),
      flow: pick("#bv-flow"),
      tokensHost: pick("#bv-tokens"),
      token: pick("[data-token-player]"),
    };
  });
  expect(wc.stack).toBe("transform");
  expect(wc.fx).toBe("transform");
  expect(wc.flow).toBe("transform");
  expect(wc.tokensHost).toBe("auto");
  expect(wc.token).toBe("transform");
});
