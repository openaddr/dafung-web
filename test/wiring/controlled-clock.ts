import { act } from "react";
import { setTimeout as nativeSetTimeout } from "node:timers";
import { withGlobal } from "@sinonjs/fake-timers";

// install 会接管 node:timers 导出;先保留真宏任务出口,不拿业务计时器让步。
const yieldTask = nativeSetTimeout;

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
      await new Promise<void>((resolve) => yieldTask(resolve, 0));
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
