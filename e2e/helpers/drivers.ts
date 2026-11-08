// ──────────────────────────── 驱动层 drivers(ADR-0059 决策 5 四层之一,#1255)────────────────────────────
// 守什么:调试桥(window.__dafung)的调用封装——桥通道开设(newBridgeContext,双门禁
// 键注入)、桥挂载等待(waitForEngine)、引擎直写+派生量重灌(force),以及种局/推进
// 桥链(seedSolo/seedSoloFrozen/seedSoloToRound/seedSoloPastFirstRoll,#1255 起
// quickStart 五态的页内本体从 scenes 内联 evaluate 抽出为逐链封装)。
// 给谁用:scenes.quickStart 组装五态;spec 直接用 force/newBridgeContext/waitForEngine。
// 新代码直接 import 本模块;旧路径 e2e/react-helpers.ts 转门面逐名转出(新封装不进
// 门面——门面=冻结的旧出口面,新面只长在层内,收缩留给迁移波)。
// 边界:每个封装=一次 page.evaluate 的桥调用(快进/瞬空的 evaluate 内结构原样保留,
// 同 evaluate 零竞速性质不破),不夹沉降——解冻后的 waitFxIdle/waitSettled 归调用方
// (settle);桥能力按需生长纪律与双门禁不变(ADR-0058/0059 决策 5,桥面单源在
// src/app/controllers/registry.ts,类型声明 src/app/debug.d.ts)。依赖单向
// scenes → 本层 → settle → patrol,无环。
import { type Browser, type BrowserContext, type Page } from "@playwright/test";
// 键名单源:与 registry.ts 双门禁共用同一常量(playwright 侧对 src 路径的解析同 fixtures.ts)。
import { E2E_DEBUG_BRIDGE_KEY } from "../../src/app/fx/timings";
// op 联合 type-import(#1298):种植指令字段编译期校验单源=core/planter(桥内转发到
// 同一份实现,三层共用);只引类型,零运行时依赖。
import type { PlantOp } from "../../src/core/planter";
import { waitFxIdle } from "./settle";

/** 联机 spec 的裸 browser context 需自带调试桥键:双门禁(2026-09-25)下生产构建
 *  无键不注册 window.__dafung,而 fixtures 的注入只覆盖 fixture page——raw context
 *  页面(coreState/onlinePickCapitals 的两端)会拿到 undefined。master 上已断的接线,
 *  随 #253 e2e 迁移修通;只建 context,页面由调用方 newPage()。 */
export async function newBridgeContext(browser: Browser): Promise<BrowserContext> {
  const ctx = await browser.newContext();
  await ctx.addInitScript((key) => localStorage.setItem(key, "1"), E2E_DEBUG_BRIDGE_KEY);
  return ctx;
}

/** 等待 window.__dafung 挂载(地图异步 fetch 期间快照可能尚未就绪)。 */
export async function waitForEngine(page: Page): Promise<void> {
  await page.waitForFunction(() => !!(window as any).__dafung?.snapshot?.(), undefined, {
    timeout: 15_000,
  });
}

/** 强制引擎进入指定状态并同步 UI(测试专用通道;fn 内以 e 引用引擎)。
 *  #188:收口走控制器 sync(而非 __dafung.sync)——直改引擎后必须连派生量(interactive
 *  /viewSeat)一起重灌,决策卷轴按 interactive 门控;行军自动化后 quickStart 的停靠点
 *  不再保证 interactive=true(bot 回合动画窗内同样会停),漏刷会让强制相位永远不弹卷轴。
 *  #398/#400:单机统一后演出队列与引擎状态解耦(状态随下行拍即时落,动画排队播,
 *  fx.playing 锁语义与联机同构)——直写前后各等队列排空一次:写前等排空防
 *  「播放中 sync 重灌打断转场,表现队列永久挂起」(终局 e2e 实测:mid-playback 直写
 *  后 fx.playing 卡死 60s,对局照走、交互永锁);写后等排空保证交还调用方时点击
 *  不撞锁(旧锁步世界「settled 即可点」的假设不再成立)。 */
export async function force(page: Page, fn: string): Promise<void> {
  await waitFxIdle(page);
  await page.evaluate(
    `(() => { const e = window.__dafung.getEngine(); ${fn} window.__dafung.controller().sync(); })()`,
  );
  await waitFxIdle(page);
}

/** 种植件分发封装(#1298,#1295 种植件体系):op 经桥 `__dafung.plant` 转发到与单测
 *  同一份种植实现(core/planter,判词单源=各族种植件头注);时序纪律复用 force 现成
 *  脚手架(同款三拍:写前等演出排空 → 同一 evaluate 内 plant+controller().sync()
 *  重灌派生量 → 写后再排空,头注见 force)。op 是结构化对象走 evaluate 参数,不搞
 *  字符串脚本拼接;族 kind 与字段由 PlantOp 联合编译期校验(字段写错编译期红)。
 *  退役映射:塞指定锦囊族站点自本封装起迁入,force 本体待 #1303 收口退役。 */
export async function plant(page: Page, op: PlantOp): Promise<void> {
  await waitFxIdle(page);
  await page.evaluate((o) => {
    (window as any).__dafung.plant(o);
    (window as any).__dafung.controller().sync();
  }, op);
  await waitFxIdle(page);
}

/** 种局桥调用(#1211):裸开局,不推进不停靠——到站等待与沉降归调用方(settle)。
 *  quickStart stopAtOpeningHand 态的页内本体。 */
export function seedSolo(page: Page, opts: { seed?: number; mapId?: string }): Promise<void> {
  return page.evaluate((o) => (window as any).__dafung.seedSolo(o), opts);
}

/** 种局即冻结(preRoll 零竞速体,#1221):同一 evaluate 内 seedSolo→clockPause——
 *  evaluate 的 async 续延是微任务,worker 时钟回发(自动起摇到点通知)是宏任务——
 *  冻结必落在定时器点火前。quickStart preRoll 态的页内本体,拆 evaluate 即破性质。 */
export async function seedSoloFrozen(
  page: Page,
  opts: { seed?: number; mapId?: string },
): Promise<void> {
  await page.evaluate(async (o) => {
    const d = (window as any).__dafung;
    await d.seedSolo(o);
    d.clockPause();
  }, opts);
}

/** 推进桥调用(#1252 中盘构造器):桥内 seedSoloToRound——冻结时钟、页内经房间命令
 *  面逐拍应答真人决策点,推进至第 targetRound 回合边界后解冻。返回停靠态读数,沉降
 *  (waitFxIdle/waitSettled)归调用方(settle)。quickStart midGameRound 态的页内本体。 */
export function seedSoloToRound(
  page: Page,
  opts: { seed?: number; mapId?: string; targetRound: number; afterFirstRoll?: boolean },
): Promise<{ turnNumber: number; round: number; turnPhase: string }> {
  return page.evaluate((o) => (window as any).__dafung.seedSoloToRound(o), opts);
}

/** 首掷后停靠(postRoll 默认态本体,#1254 开口吸收,ADR-0059 决策 1):瞬空钉住包覆
 *  seedSoloToRound(targetRound=1 + afterFirstRoll,首掷已发生才停)一气呵成——快进
 *  期间演出出队一律吸附档(未播整块弃播、棋盘直切引擎终态),到站=首掷后的我方决策
 *  停靠(Awaiting*)。finally 解钉:快进抛错不留常开档污染本页后续演出(零兜底:不
 *  静默吞错,evaluate 照常上抛)。setSnapPin 与推进同 evaluate,钉/解钉不跨拍。 */
export async function seedSoloPastFirstRoll(
  page: Page,
  opts: { seed?: number; mapId?: string },
): Promise<void> {
  await page.evaluate(async (o) => {
    const d = (window as any).__dafung;
    d.setSnapPin(true);
    try {
      await d.seedSoloToRound({
        seed: o.seed,
        mapId: o.mapId,
        targetRound: 1,
        afterFirstRoll: true,
      });
    } finally {
      d.setSnapPin(false);
    }
  }, opts);
}
