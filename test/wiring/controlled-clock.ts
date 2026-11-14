import { act } from "react";
import { withGlobal } from "@sinonjs/fake-timers";

/** 接线层的时间边界:ensureHappyDom 后、挂组件前安装;先卸组件再 restore。
 *  happy-dom 注册后 window === globalThis,两种 timeout 写法共用一个时钟。
 *  只接管 timeout/interval,Date、rAF 与 React 调度器仍走原生通路;不驱动演出泵。 */
export function installControlledClock() {
  const clock = withGlobal(globalThis).install({
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"],
  });

  async function advance(ms: number): Promise<void> {
    await act(async () => {
      clock.tick(ms);
      // Bun 原生让步不捕获 happy-dom Window 的计时器；后者可能属于已关闭的前一文件。
      await Bun.sleep(0);
    });
  }

  return {
    advance,
    /** 只让过当前拍的宏任务/零延迟任务,不跨越业务延时。 */
    settle: () => advance(0),
    /** 组件卸载已执行自身清理后还原原生计时器,不 runAll、不全局清空计时器。 */
    restore: () => clock.uninstall(),
  };
}
