// React 重构 · e2e 共享工具(阶段 11):全部选择器走 data-testid,
// 相位推进用 window.__dafung 调试钩子强制(见 src/app/controllers/registry.ts)。
// 走 vite preview(4173)的 dist 产物——跑前需 npm run build;联机走 3010。
import { expect, type Page } from "@playwright/test";

/** 强制引擎进入指定状态并同步 UI(测试专用通道;fn 内以 e 引用引擎)。
 *  #188:收口走控制器 sync(而非 __dafung.sync)——直改引擎后必须连派生量(interactive
 *  /viewSeat)一起重灌,决策卷轴按 interactive 门控;行军自动化后 quickStart 的停靠点
 *  不再保证 interactive=true(bot 回合动画窗内同样会停),漏刷会让强制相位永远不弹卷轴。 */
export async function force(page: Page, fn: string): Promise<void> {
  await page.evaluate(`(() => { const e = window.__dafung.getEngine(); ${fn} window.__dafung.controller().sync(); })()`);
}

/** 读引擎快照(god view;结构与 store 的 GameSnapshot 同构)。 */
export function snap(page: Page): Promise<any> {
  return page.evaluate(() => (window as any).__dafung.snapshot());
}

/** UI 快速开局:goto(可选 ?seed=)→ 首页进单机配置页 → 起兵 → 点第一座可选城建都
 *  → 等开局放行并稳定。#188 行军自动化后人类回合不再停在「点行军」,本助手收口为:
 *  等人类的当前一手自动走完(waitMyRollDone:锦囊放行 → 自动起摇 → 推进到下一决策点
 *  /换人),再等局面稳定(连续两次快照一致)。 */
export async function quickStart(page: Page, seed?: number): Promise<void> {
  await page.goto(seed != null ? `/?seed=${seed}` : "/");
  await openSoloSetup(page);
  await page.getByTestId("start-game").click();
  await pickCapital(page);
  await waitMyRollDone(page, 0);
  await waitSettled(page);
}

/** 选都两步走(需求1):点城 → 「定都于此?」确认框 → 确认筑城。
 *  弹窗是新增交互,所有"点城即定都"的旧用例统一改走这里,防选择器散落漂移。
 *  #188:选都后的开局锦囊卷轴放行交给后续等待(waitMyRollDone 轮询体内逐拍
 *  dismissJinnangIfUp,卷轴异步挂载的竞速在轮询内自愈),此处只做一次即时探测。 */
export async function pickCapital(page: Page, nth = 0): Promise<void> {
  await page.locator(".bv-tile.bv-selectable").nth(nth).click();
  await page.getByTestId("confirm-capital-ok").click();
  await dismissJinnangIfUp(page);
}

/** 锦囊卷轴在场则「今不用」放行(#122/T2);无卷轴零等待。
 *  各用例/驱动循环的放行点统一走此助手,勿再复制可见性探测块。 */
export async function dismissJinnangIfUp(page: Page): Promise<void> {
  const jp = page.getByTestId("scroll-jinnang-pass");
  if (await jp.isVisible().catch(() => false)) await jp.click({ timeout: 5_000 }).catch(() => {});
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
        return s.phase === "Playing" && s.decisionOwner === seat && s.turnPhase.startsWith("Awaiting");
      },
      { timeout, message: `轮到座位 ${seat} 且停在其非 Roll 等待态` },
    )
    .toBe(true);
}

/** 首页 → 单机配置页(信息架构重构:起兵入口在次级页,所有开局链路先走这一步)。
 *  机遇归零(#126):存量 spec 的钉死断言不耐受随机机遇,起兵前把触发率与三档全部
 *  归 0(机遇关闭)。归零后复查一轮,抗设置屏默认值 fetch 竞态;机遇冒烟 spec 自行
 *  覆写非零参数。 */
export async function openSoloSetup(page: Page): Promise<void> {
  // 机遇默认值隔离(#126):路由拦截 jiyu.json 直接回全零,设置屏回落「内置默认」分支——
  // 归零不再与挂载期 fetch 竞态(全量偶发随机机遇污染钉死断言的根因)。机遇冒烟 spec
  // 自行覆写非零参数(route 对后续 fill 无影响)。
  await page.route("**/config/jiyu.json", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ triggerRate: 0, baseRates: { good: 0, neutral: 0, bad: 0 } }),
    }),
  );
  await page.getByTestId("home-solo").click();
  await page.getByTestId("solo-setup-screen").waitFor();
  await page.getByTestId("setup-encounter-toggle").click();
  for (const f of ["setup-encounter-trigger", "setup-encounter-good", "setup-encounter-neutral", "setup-encounter-bad"]) {
    await page.getByTestId(f).fill("0");
  }
}

/** 等局面稳定:连续两次引擎快照一致(防在 bot 行动/动画中途读数)。 */
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
export async function waitForSnapChanged(page: Page, before: string, timeout = 8_000): Promise<void> {
  await page.waitForFunction(
    (b) => JSON.stringify((window as any).__dafung.snapshot()) !== b,
    before,
    { timeout, polling: 250 },
  );
}

/** 等待 window.__dafung 挂载(地图异步 fetch 期间快照可能尚未就绪)。 */
export async function waitForEngine(page: Page): Promise<void> {
  await page.waitForFunction(() => !!(window as any).__dafung?.snapshot?.(), undefined, { timeout: 15_000 });
}

/** 货币格式化(与 core/money.formatMoney 同口径:百进制 锭/两/分)。 */
export function fmtMoney(cash: number): string {
  if (cash <= 0) return "0分";
  const ding = Math.floor(cash / 10000);
  const rem = cash % 10000;
  const liang = Math.floor(rem / 100);
  const fen = rem % 100;
  const parts: string[] = [];
  if (ding) parts.push(`${ding}锭`);
  if (liang) parts.push(`${liang}两`);
  if (fen) parts.push(`${fen}分`);
  return parts.join("") || "0分";
}

/** 推进一步可用动作(卷轴内决策按钮);无可用动作返回 false。
 *  #188 行军自动化后掷骰不再是可点动作(自动起摇),本助手只负责「清决策点」:
 *  锦囊卷轴放行 / action-* 决策按钮 / 通配 scroll 分支。交互重构后所有决策按钮都住在
 *  卷轴里,testid 沿用 action-*——选择器不变,只是命中位置从侧栏搬进了弹层。
 *  每次点击自带 10s 上限(与 expect.timeout 同档):按钮被弹层遮罩/幽灵帧挡住的
 *  系统性破坏下,Playwright 会为 actionability 重试到测试超时(60-240s/次)——
 *  收敛为 10s 失败即 false,交还调用方的 stall 预算,快速失败并给出局面报告。
 *  行军自动化后对局自走,调用方的步进循环依赖本助手清决策点;无决策点返回 false 时
 *  局面仍在自动推进,循环侧按「快照变化即不算停滞」计预算(勿空转烧步数)。 */
export async function actIfCan(p: Page): Promise<boolean> {
  // 锦囊卷轴(#122/T2):回合开始自动起摇前可能弹出——默认「今不用」放行,绝不替测试用牌。
  // 必须先于通配 scroll 分支(会误点第一张牌)。
  const jinnangPass = p.getByTestId("scroll-jinnang-pass");
  if (await jinnangPass.isVisible().catch(() => false)) {
    return jinnangPass
      .click({ timeout: 10_000 })
      .then(() => true, () => false);
  }
  // 只匹配按钮(决策卷轴容器是 div,无 disabled 属性会误中导致空转)
  const inline = p.locator('button[data-testid^="action-"]:not([disabled])');
  if ((await inline.count()) > 0) {
    return inline
      .first()
      .click({ timeout: 10_000 })
      .then(() => true, () => false);
  }
  const scrollPrimary = p.locator('[data-testid^="scroll-"] button:not([disabled])');
  if ((await scrollPrimary.count()) > 0) {
    return scrollPrimary
      .first()
      .click({ timeout: 10_000 })
      .then(() => true, () => false);
  }
  return false;
}

// ──────────────────────────── 联机段(react-online* 共享)────────────────────────────

/** 联机开局选都三选一(L41):pages 按座位序传入(页 i = 座位 i),轮流在「轮到选都」
 *  的端上点候选城 + 确认定都,直到快照离开 Setup(bot 座位由服务器自动代选,只等快照)。
 *  每次轮到断言:轮到端恰 3 座候选高亮、其余端 0 座(联机不越权弹选都交互)。 */
export async function onlinePickCapitals(pages: Page[]): Promise<void> {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const s = await pages[0].evaluate(() => (window as any).__dafung.snapshot());
    if (s.phase !== "Setup") return; // 全员选完 → Playing
    const picker: Page | undefined = pages[s.currentSetupPlayerIndex];
    const before = JSON.stringify(s);
    if (!picker) {
      // bot 座位轮到:服务器自动代选,等快照推进即可
      await pages[0].waitForFunction(
        (b) => JSON.stringify((window as any).__dafung.snapshot()) !== b,
        before,
        { timeout: 20_000, polling: 200 },
      );
      continue;
    }
    await expect(picker.locator(".bv-tile.bv-selectable")).toHaveCount(3, { timeout: 15_000 });
    for (const p of pages) {
      if (p !== picker) await expect(p.locator(".bv-tile.bv-selectable")).toHaveCount(0);
    }
    await picker.locator(".bv-tile.bv-selectable").nth(0).click();
    await picker.getByTestId("confirm-capital-ok").click();
    await pages[0].waitForFunction(
      (b) => JSON.stringify((window as any).__dafung.snapshot()) !== b,
      before,
      { timeout: 20_000, polling: 200 },
    );
  }
  throw new Error("联机选都超时未完成");
}
