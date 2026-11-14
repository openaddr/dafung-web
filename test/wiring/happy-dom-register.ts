// happy-dom 按接线测试文件局部注册,afterAll 释放(ADR-0065)。
// 全局 preload 会改变 useMarch.animateMove 的无 DOM 快路,污染无浏览器测试。
// Bun 跨文件共享模块注册表,以 GlobalRegistrator.isRegistered 为准;ensure/release 须成对。
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { readFileSync } from "node:fs";

const fxStyles = readFileSync(new URL("../../src/app/fx/fx.css", import.meta.url), "utf8");

/** 本文件运行时装上 happy-dom 全局(document/window/navigator/…,幂等):
 *  在 beforeAll 调;IS_REACT_ACT_ENVIRONMENT 供 react act() 驱动渲染。 */
export function ensureHappyDom(): void {
  if (!GlobalRegistrator.isRegistered) {
    GlobalRegistrator.register();
    // Happy DOM无字体资源加载器;接线层提供事件/Promise接口形状,不证明字形几何。
    // 真实字体、视口与像素交由用户在 APK 中验收。
    (document as unknown as { fonts: unknown }).fonts = Object.assign(new EventTarget(), {
      ready: Promise.resolve(),
      load: () => Promise.resolve([]),
    });
    // Bun不装载CSS副作用;表现挂载会读取落章弧变量,用生产样式提供同源值。
    // 接线层仍不据此断言几何或像素,release时随document一并销毁。
    const style = document.createElement("style");
    style.textContent = fxStyles;
    document.head.append(style);
  }
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
}

/** 还原全局(在 afterAll 调):window 关闭、document 等还原缺席,后续测试文件
 *  回到 bun 原生无 DOM 形态。 */
export async function releaseHappyDom(): Promise<void> {
  if (GlobalRegistrator.isRegistered) {
    await GlobalRegistrator.unregister();
  }
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
}
