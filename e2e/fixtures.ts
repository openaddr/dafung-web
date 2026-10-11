// 共享 Playwright fixtures(#116):全部 spec 从这里 import test/expect,不再直接
// import @playwright/test。page fixture 在页面加载前(addInitScript,先于应用任何
// 模块初始化)写入 e2e 时间倍率 localStorage 键,src/app/fx/timings.ts 模块初始化时
// 读取该键缩放演出编排时长(骰子/横幅/行军/bot 延时),大幅缩短 e2e 墙钟。
// 生产/真人局无此键,倍率恒为 1(逐位恒等直通),零感知。
import { test as base, expect, type Browser, type Page } from "@playwright/test";
// 键名单源:与 timings.ts 共用同一常量,避免字符串双源漂移。
// (timings.ts 自身 import @core/theme——playwright 的 tsconfig paths 解析可处理,
// 若运行时报模块解析失败,回退为字面量 "dafung-e2e-time-scale" 并在此注明。)
import {
  E2E_DEBUG_BRIDGE_KEY,
  E2E_REACTION_MS_KEY,
  E2E_TIME_SCALE_KEY,
} from "../src/app/fx/timings";

export { expect };
export type { Browser, Page };

// 注入值(env 可覆盖):localStorage 只存字符串,注入的必须是数字字符串,
// timings 侧对非法值按 1(全速)解释。
const timeScale = process.env.E2E_TIME_SCALE ?? "0.25";
// 反应窗加长(#284 联机同款):权威窗 3s 在 4 worker 负载下与「断言+读数+应答」的
// 点击链赛跑——窗内没答完,看门狗代发「不用」后应答落到下一个窗上(误窗应答)。
// 单机 5s:实测负载下点击链 1-3s(余量 ~2 倍);不再取高值——「点不用」例连锁
// 3 道火烧窗逐窗 8s 会被 30s 结算 poll 逼满。单机经 E2E_REACTION_MS_KEY →
// registry 选项 reactionWindowMs(与 server env 同一通道);权威窗长不吃倍率,
// 横幅展示按倍率缩放。
const reactionMs = process.env.E2E_REACTION_MS ?? "5000";

/** 单机 spec(棋盘/卷轴/侧栏/开局/solo):注入倍率,编排加速;并开调试桥门禁
 *  (registry.installDebugHooks 双门禁:生产构建不注册 window.__dafung,dev 或
 *  桥键非空才注册——quickStart/force/截图脚手架全依赖它)。 */
export const test = base.extend({
  page: async ({ page }, use) => {
    await page.addInitScript(
      ({ key, value, bridge, reactionKey, reactionValue }) => {
        localStorage.setItem(key, value);
        localStorage.setItem(bridge, "1");
        localStorage.setItem(reactionKey, reactionValue);
      },
      {
        key: E2E_TIME_SCALE_KEY,
        value: timeScale,
        bridge: E2E_DEBUG_BRIDGE_KEY,
        reactionKey: E2E_REACTION_MS_KEY,
        reactionValue: reactionMs,
      },
    );
    await use(page);
  },
});

/** 联机/韧性 spec 免注入(#116 评审实证):对局节奏由服务端驱动,客户端编排加速
 *  只会造出快照洪流——实测 0.25 倍率下服务端 2.5s 冲 109 轮,guest 代打页被卡死
 *  不落子,服务端无决策超时永久等待(市面无此保护)。联机用例提速归零收益,维持全速;
 *  但调试桥门禁键仍要注入(coreState/force 读 window.__dafung,生产构建下无键不注册)。 */
export const testUnscaled = base.extend({
  page: async ({ page }, use) => {
    await page.addInitScript(({ bridge }) => localStorage.setItem(bridge, "1"), {
      bridge: E2E_DEBUG_BRIDGE_KEY,
    });
    await use(page);
  },
});
