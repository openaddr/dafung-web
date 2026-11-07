// ──────────────────────────── 沉降层 settle(ADR-0059 决策 5 四层之一,#1255)────────────────────────────
// 守什么:「等局面稳」的谓词族——演出排空(waitFxIdle)、快照稳定(waitSettled/
// waitForSnapChanged)、人类停靠(waitMyRollDone/waitMyPause/parkMyTurn)与时钟
// 冻结缝(freezeClock/unfreezeClock,parkMyTurn 冻结复核用)。
// 给谁用:全部 e2e spec;也是上层的到站收尾(scenes 五态出口、drivers.force 写前后
// 排空)。新代码直接 import 本模块;旧路径 e2e/react-helpers.ts 转门面逐名转出。
// 边界:只等不驱动——清决策点/应答代发归 patrol(本层读数与放行一律经
// patrol.snap/dismissJinnangIfUp,不设第二读口),回合推进/桥直写归 drivers,
// 场景编排归 scenes;依赖单向 scenes → drivers → 本层 → patrol,无环。
import { expect, type Page } from "@playwright/test";
import { TESTIDS } from "../../src/app/screens/game/testids";
import { SCROLL_TESTIDS } from "../../src/app/screens/game/scroll/testids";
import { dismissJinnangIfUp, snap } from "./patrol";

/** 等表现队列排空(fx.playing=false)。 */
export async function waitFxIdle(page: Page, timeout = 20_000): Promise<void> {
  await page.waitForFunction(
    () => {
      const fx = (window as any).__dafung.controller()?.fx;
      return fx == null || !fx.playing;
    },
    undefined,
    { timeout, polling: 100 },
  );
}

/** 等局面稳定:连续两次引擎快照一致(防在 bot 行动/动画中途读数)。
 *  #1221 L6 已否决并登记防重提:判读间隔 300ms 收紧到 150ms 实测否决——300ms 档
 *  (判定窗口)参与行走局用例的点击节拍,150ms 使 react-tutorial(脊柱⑤)的
 *  waitMyPause 捕到「行军拦检窗开着」的瞬态停靠,随后权威窗看门狗代发放行覆盖种植
 *  断言,4 跑 4 挂(串行复现,非负载);回 300ms 即绿。任何更紧窗口(含「一拍」)
 *  同样移动该节拍,同族风险,不再试。 */
export async function waitSettled(page: Page, timeout = 30_000): Promise<void> {
  await page.waitForFunction(
    async () => {
      const read = () => JSON.stringify((window as any).__dafung.snapshot());
      const a = read();
      await new Promise((r) => setTimeout(r, 300));
      return a === read();
    },
    undefined,
    { timeout, polling: 400 },
  );
}

/** 轮询等引擎快照相对 before(JSON 串)发生变化(TODO #13:固定等待改状态轮询)。
 *  全量并行负载下,掷骰/bot 推进/UI 刷新的到达时间抖动可达秒级,固定 sleep(200/300)
 *  在单跑够用、全量必抖。此处直接等"局面真的动了"再读数,超时 8s(约 5 倍余量)。
 *  调用方对超时可 .catch(() => {}):动作确实不改变局面时(如纯 UI 翻页)容忍不变。 */
export async function waitForSnapChanged(
  page: Page,
  before: string,
  timeout = 8_000,
): Promise<void> {
  await page.waitForFunction(
    (b) => JSON.stringify((window as any).__dafung.snapshot()) !== b,
    before,
    { timeout, polling: 250 },
  );
}

/** 等人类的当前一手自动走完(#188 行军自动化):「轮到人类掷骰」不再停留——锦囊卷轴
 *  放行后 ~1s(e2e 加速后 ~250ms)自动起摇。本助手轮询快照 + 逐拍放行锦囊卷轴,直到:
 *  决策方换人 / 我的回合推进过掷骰(落格抉择卷轴弹出)/ 对局终局,任一即视为走完。
 *  seat:单机=人类座位(0);联机=本端座位。「等下回合 / 等自动行军」断言一律走本助手,
 *  旧 expectRollEnabled(等 roll-button 可用)随行军按钮移除而退役。 */
export async function waitMyRollDone(page: Page, seat: number, timeout = 30_000): Promise<void> {
  await expect
    .poll(
      async () => {
        await dismissJinnangIfUp(page);
        const s = await snap(page);
        if (s.phase === "GameOver") return true;
        if (s.phase !== "Playing") return false;
        if (s.decisionOwner !== seat) return true;
        // 我的回合:AwaitingJinnang(卷轴可能尚未点掉)与 Roll(自动起摇在途)都算未走完
        return s.turnPhase !== "Roll" && s.turnPhase !== "AwaitingJinnang";
      },
      { timeout, message: `座位 ${seat} 的当前一手已自动走完(#188 自动行军)` },
    )
    .toBe(true);
}

/** 等轮到我且停稳在非 Roll 的等待态(锦囊卷轴/落格抉择等——引擎等输入,快照静止):
 *  用于需要在「人类回合内」做引擎直写或断言 viewSeat 的用例。#188 后 Roll 等待态只存在
 *  ~1s(自动起摇),不可再作停靠点;本助手不放行锦囊卷轴——AwaitingJinnang 本身就是
 *  合法停靠点(viewSeat=本座位),由调用方决定是否放行。 */
export async function waitMyPause(page: Page, seat: number, timeout = 30_000): Promise<void> {
  await expect
    .poll(
      async () => {
        const s = await snap(page);
        // 只认 Awaiting* 决策停靠态(#188 迁移):EndTurn 是引擎自推进的瞬态,
        // 停在那里做引擎直写会与推进竞速(stamina spec 的残余抖动根因)。
        return (
          s.phase === "Playing" && s.decisionOwner === seat && s.turnPhase.startsWith("Awaiting")
        );
      },
      { timeout, message: `轮到座位 ${seat} 且停在其非 Roll 等待态` },
    )
    .toBe(true);
}

/** 严格「我的回合空闲」停车(#1215 棒1 rack 本地助手,#1216 波3 上收共享):
 *  等待谓词比 waitMyPause 多钉一条 activeIndex===selfSeat(0)——两类 bot 回合中途态
 *  都长着「decisionOwner=我」的脸:①反应窗询问期(bot 火烧连营窗开在 bot 回合尾,
 *  waitMyPause 会当停靠:随后 5s 权威窗看门狗代发「不用」、bot 链走完,force+freeze
 *  锁进 bot 决策位,架随收沿已收,消费例 toggle/点牌语义整例反转);②珍宝抉择卷轴
 *  (起手珍宝访客落在人类城,卷轴开在 bot 回合里,引擎等人类输入、bot 链悬停,
 *  严格条件永不满足=等待死锁)。故轮询体内先代发放行(卷轴「暂不交易」/横幅「不用」
 *  ,窗看门狗到点同语义;短时限+吞错,skipUntilNextSeat 同款口径),再验严格条件。
 *  opts.freeze(缺省 true,几何测量类停车):停靠即 freeze,冻结后复核——「条件满足→
 *  冻结」的 gap 内若被同步链推走,解冻续等下一拍(冻结只钉时钟回调,命令同步链不受
 *  影响);页随测试灭、冻结随上下文销毁,无需解冻对称。流程续跑类停车(停完还要放行
 *  /等推进的用例,如反应族窗流)传 { freeze: false }——#188 自动起摇等时钟回调是后续
 *  流程的本体,冻结会死锁;停靠态本身引擎等输入无自推进,#118 停摆代驾 120s 不构成
 *  停靠后竞速,无冻结即无竞速面。seat 钉 0:单机人类座位(联机族不停车,窗流驱动)。 */
export async function parkMyTurn(
  page: Page,
  timeout = 90_000,
  opts?: { freeze?: boolean },
): Promise<void> {
  const freeze = opts?.freeze ?? true;
  const tSkip = page.getByTestId(SCROLL_TESTIDS.treasureSkip);
  const decline = page.getByTestId(TESTIDS.reactionDecline);
  const myPark = (s: any) =>
    s.phase === "Playing" &&
    s.activeIndex === 0 &&
    s.decisionOwner === 0 &&
    s.turnPhase.startsWith("Awaiting");
  await expect
    .poll(
      async () => {
        if (await tSkip.isVisible().catch(() => false))
          await tSkip.click({ timeout: 2_000 }).catch(() => {});
        if (await decline.isVisible().catch(() => false))
          await decline.click({ timeout: 2_000 }).catch(() => {});
        if (!myPark(await snap(page))) return false;
        if (!freeze) return true;
        await freezeClock(page);
        const s2 = await snap(page);
        if (myPark(s2)) return true;
        await unfreezeClock(page); // 冻结 gap 内被同步链推走:解冻续等下一拍
        return false;
      },
      { timeout, message: "轮到人类且停在其自身回合的 Awaiting 等待态(非 bot 回合询问期)" },
    )
    .toBe(true);
}

// ── #421/#423 时钟缝:冻结→种植→手术→断言→恢复 ──
// 房间时钟冻结闸(window.__dafung.clockPause/clockResume,#421 调试观测面):冻结期间
// #188 自动起摇与各组看门狗(含 #118 决策停摆代驾)的到点回调全部挂起(resume 按到点
// 序补放)。种植类用例先冻结再动刀,把对局钉死在当前停靠态——旧口径靠「种完手快」与
// 自动推进赛跑。注意冻结的边界:只钉时钟到点回调,钉不住命令自带的同步 bot 链
// (点击收尾 endTurn 即放链,delay=0 步进不经时钟)——点击后的断言须走结算留痕
// (日志行/链上不可变字段),不读活态(#421 诊断,react-stamina 同款口径)。
// 冻结期断言若仍失败 = 赛跑之外的真 bug,上报而非加睡(零兜底)。
export async function freezeClock(page: Page): Promise<void> {
  await page.evaluate(() => (window as any).__dafung.clockPause());
}
export async function unfreezeClock(page: Page): Promise<void> {
  await page.evaluate(() => (window as any).__dafung.clockResume());
}
