// 接线测试层(ADR-0062 层④)happy-dom 装配缝:文件内局部注册,不用 bunfig preload。
// 判词(选型理由,#1284 量实①:preload 全局注册全量跑一遍定性)——preload 会把
// happy-dom 的 window/document/WebSocket 等覆写灌进全部 79 个测试文件,实锤翻掉
// 既有例:useMarch.animateMove 有「无 DOM 运行时」快路(typeof document ===
// "undefined" → 段簿记直收尾,presentation.test.ts 依赖该语义),document 在场即
// 走真 DOM 分支、行为等价性被破(该例 preload 全量挂、单文件+preload 复挂、主树
// 原生态绿,三步定性)。故 DOM 只跟着接线用例走:哪个文件 ensure,哪个文件的
// 运行时有 DOM;afterAll release 还原,后续文件回无 DOM 原生态。
// bun test 单进程多文件共享模块注册表(量实②:store 哨兵跨文件可见),在册与否
// 以 GlobalRegistrator.isRegistered 运行时态为准——多个接线测试文件先后
// ensure/release 各自成对,不依赖文件执行序;成对调用是纪律,不成对即污染邻座。
import { GlobalRegistrator } from "@happy-dom/global-registrator";

/** 本文件运行时装上 happy-dom 全局(document/window/navigator/…,幂等):
 *  在 beforeAll 调;IS_REACT_ACT_ENVIRONMENT 供 react act() 驱动渲染。 */
export function ensureHappyDom(): void {
  if (!GlobalRegistrator.isRegistered) {
    GlobalRegistrator.register();
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
