// React 重构 · e2e 共享工具(阶段 11):全部选择器走 data-testid,
// 相位推进用 window.__dafung 调试钩子强制(见 src/app/controllers/registry.ts)。
// 走 vite preview(4173)的 dist 产物——跑前需 npm run build;联机走 3010。
import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
// 键名单源:与 registry.ts 双门禁共用同一常量(playwright 侧对 src 路径的解析同 fixtures.ts)。
import { E2E_DEBUG_BRIDGE_KEY } from "../src/app/fx/timings";
import { TESTIDS } from "../src/app/screens/game/testids";

/** 联机 spec 的裸 browser context 需自带调试桥键:双门禁(2026-09-25)下生产构建
 *  无键不注册 window.__dafung,而 fixtures 的注入只覆盖 fixture page——raw context
 *  页面(coreState/onlinePickCapitals 的两端)会拿到 undefined。master 上已断的接线,
 *  随 #253 e2e 迁移修通;只建 context,页面由调用方 newPage()。 */
export async function newBridgeContext(browser: Browser): Promise<BrowserContext> {
  const ctx = await browser.newContext();
  await ctx.addInitScript((key) => localStorage.setItem(key, "1"), E2E_DEBUG_BRIDGE_KEY);
  return ctx;
}

/** 强制引擎进入指定状态并同步 UI(测试专用通道;fn 内以 e 引用引擎)。
 *  #188:收口走控制器 sync(而非 __dafung.sync)——直改引擎后必须连派生量(interactive
 *  /viewSeat)一起重灌,决策卷轴按 interactive 门控;行军自动化后 quickStart 的停靠点
 *  不再保证 interactive=true(bot 回合动画窗内同样会停),漏刷会让强制相位永远不弹卷轴。
 *  #398/#400:单机统一后演出队列与引擎状态解耦(状态随下行拍即时落,动画排队播,
 *  L42 的 fx.playing 锁语义与联机同构)——直写前后各等队列排空一次:写前等排空防
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

/** 军师窗态在场则「不出」放行(#122/T2;#256 军师幕弹窗退役,放行点迁动作条
 *  actionbar-pass,原 scroll-jinnang-pass 语义平移);无窗态零等待。
 *  各用例/驱动循环的放行点统一走此助手,勿再复制可见性探测块。 */
export async function dismissJinnangIfUp(page: Page): Promise<void> {
  const jp = page.getByTestId("actionbar-pass");
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
        return (
          s.phase === "Playing" && s.decisionOwner === seat && s.turnPhase.startsWith("Awaiting")
        );
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
  for (const f of [
    "setup-encounter-trigger",
    "setup-encounter-good",
    "setup-encounter-neutral",
    "setup-encounter-bad",
  ]) {
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

/** 等待 window.__dafung 挂载(地图异步 fetch 期间快照可能尚未就绪)。 */
export async function waitForEngine(page: Page): Promise<void> {
  await page.waitForFunction(() => !!(window as any).__dafung?.snapshot?.(), undefined, {
    timeout: 15_000,
  });
}

/** 货币格式化(与 core/money.formatMoney 同口径:唯一单位「两」,千分位;≤0 → 「0 两」)。 */
export function fmtMoney(cash: number): string {
  if (cash <= 0) return "0 两";
  return `${String(cash).replace(/\B(?=(\d{3})+(?!\d))/g, ",")} 两`;
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
  // 军师窗态(#256,原 scroll-jinnang-pass 放行点迁动作条):回合开始自动起摇前可能
  // 停在窗态——默认「不出」放行,绝不替测试用牌。必须先于通配 scroll 分支
  // (会误点第一张牌)。
  const jinnangPass = p.getByTestId("actionbar-pass");
  if (await jinnangPass.isVisible().catch(() => false)) {
    return jinnangPass.click({ timeout: 10_000 }).then(
      () => true,
      () => false,
    );
  }
  // 只匹配按钮(决策卷轴容器是 div,无 disabled 属性会误中导致空转)
  const inline = p.locator('button[data-testid^="action-"]:not([disabled])');
  if ((await inline.count()) > 0) {
    return inline
      .first()
      .click({ timeout: 10_000 })
      .then(
        () => true,
        () => false,
      );
  }
  const scrollPrimary = p.locator(
    '[data-testid^="scroll-"]:not([data-testid*="jinnang"]) button:not([disabled])',
  );
  if ((await scrollPrimary.count()) > 0) {
    return scrollPrimary
      .first()
      .click({ timeout: 10_000 })
      .then(
        () => true,
        () => false,
      );
  }
  return false;
}

/** 清当前座位的决策点直到轮到别人(#281 反应窗 spec 用):决策一律跳过(不买地不升级,
 *  保「bot 火烧目标恒定」类种植前提);骰由自动起摇,本助手只清卷轴/动作条。
 *  点击一律短时限+吞错(负载下卷轴随广播反复重挂,resolved→detached 循环口径同联机段)。 */
export async function skipUntilNextSeat(p: Page, seat: number, timeout = 30_000): Promise<void> {
  await expect
    .poll(
      async () => {
        const skip = p.getByTestId("action-skip");
        if (await skip.isVisible().catch(() => false)) {
          await skip.click({ timeout: 2_000 }).catch(() => {});
        } else {
          const jp = p.getByTestId("actionbar-pass");
          if (await jp.isVisible().catch(() => false)) {
            await jp.click({ timeout: 2_000 }).catch(() => {});
          } else {
            const any = p.locator('button[data-testid^="action-"]:not([disabled])');
            if ((await any.count()) > 0)
              await any
                .first()
                .click({ timeout: 2_000 })
                .catch(() => {});
          }
        }
        const s = await snap(p);
        return s.phase === "GameOver" || s.decisionOwner !== seat;
      },
      { timeout },
    )
    .toBe(true);
}

// ──────────────────────────── 反应窗/指示线 spec 共享件(#284 去重单源)────────────────────────────
// 原本在 react-reaction.spec.ts / react-jinnang-use.spec.ts(墨线例 #305 已并入后者)
// 三处各持一份的种植/开局助手,收口于此(逐字同实现,语义零漂移)。

/** 读引擎态(god view 断言用)。 */
export function engineState(page: Page, pick: string): Promise<any> {
  return page.evaluate(`(() => {
    const e = window.__dafung.getEngine();
    return ${pick};
  })()`);
}

/** 本 spec 反应窗倍率 0.5(横幅展示=权威窗长折半;权威窗长经 fixtures 注入的
 *  E2E_REACTION_MS=5000,不吃倍率):后挂 init 脚本覆盖 fixtures 注入的同键。 */
export async function useHalfScale(page: Page): Promise<void> {
  await page.addInitScript(() => localStorage.setItem("dafung-e2e-time-scale", "0.5"));
}

/** 开局(seed 7 离线核算:人类先手,起手火烧连营=可用牌):选图/起兵/定都后停稳在
 *  人类开局军师窗——引擎直写种植的稳定停靠点(内部自带 0.5 倍率)。 */
export async function startSolo(page: Page): Promise<void> {
  await useHalfScale(page);
  await page.goto("/?seed=7");
  await page.getByTestId("home-select-map").click();
  await page.getByTestId("map-item-sanguo").click();
  await page.getByTestId("map-confirm").click();
  await openSoloSetup(page);
  await page.getByTestId("start-game").click();
  await page.locator(".bv-tile.bv-selectable").first().click();
  await page.getByTestId("confirm-capital-ok").click();
  await expect(page.getByTestId(TESTIDS.actionbar)).toBeVisible();
}

/** 火烧目标确定性种植:人类挪入一座非都城(0 级)= 全场唯一「可失之城」(都城不可拆,
 *  demolishOnVictim 排除)——bot 火烧连营的 城最多者∩可拆 目标恒人类。 */
export async function plantDemolishableCity(page: Page): Promise<void> {
  await force(
    page,
    `
    {
      const capitals = new Set(e.players.map((p) => p.capitalIndex));
      let idx = -1;
      for (let k = 1; k < e.board.count - 1; k++) {
        const c = (e.players[0].capitalIndex + k) % e.board.count;
        const t = e.board.at(c);
        if (t?.propertyId && !capitals.has(c) && !e.findOwner(t.propertyId)) { idx = c; break; }
      }
      if (idx < 0) throw new Error("种植失败:无可挪城池格");
      const pid = e.board.at(idx).propertyId;
      e.players[0].properties.push({
        propertyId: pid, group: e.board.at(idx).group ?? "a",
        purchasePrice: 1000, level: 0, maxLevel: 3,
      });
    }
  `,
  );
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
      // bot 座位轮到:服务器自动代选,等快照推进即可。45s:4 worker 满载下服务器
      // 处理+广播的实测抖动可达 20s+(#370 后 reaction 三例 setup 连挂取证),20s 硬编码
      // 是安静机假设;外层 90s deadline 仍兜总预算。
      await pages[0].waitForFunction(
        (b) => JSON.stringify((window as any).__dafung.snapshot()) !== b,
        before,
        { timeout: 45_000, polling: 200 },
      );
      continue;
    }
    await expect(picker.locator(".bv-tile.bv-selectable")).toHaveCount(3, { timeout: 15_000 });
    for (const p of pages) {
      if (p !== picker) await expect(p.locator(".bv-tile.bv-selectable")).toHaveCount(0);
    }
    // 点城→确认两击走 toPass 整块重试:满载下单发点击可能被演出锁/重挂吞掉,确认框
    // 不出现会把本助手变成永久卡死(烧满整个测试预算,#381 secrecy 终局实测)。
    // 重试幂等:选都只在确认击提交(tile 点击只开详情卷轴),未选中前重点同城无害。
    await expect(async () => {
      await picker.locator(".bv-tile.bv-selectable").nth(0).click({ timeout: 5_000 });
      await picker.getByTestId("confirm-capital-ok").click({ timeout: 5_000 });
    }).toPass({ timeout: 30_000 });
    await pages[0].waitForFunction(
      (b) => JSON.stringify((window as any).__dafung.snapshot()) !== b,
      before,
      { timeout: 45_000, polling: 200 },
    );
  }
  throw new Error("联机选都超时未完成");
}

// ──────────────────────────── 反应窗应答流程(#291 决议 · #302 施工)────────────────────────────
// 「等窗开 → 选牌 → 点笺 → 确认/不用/静音 → 结算 poll」的共享单源:单机 react-reaction
// 与 react-reaction-online 的同语义场景(自保/超时/降噪口等)共用,引擎结算语义
// (窗收/应答留痕/现金缴支)只改这里一处。三段式:基线 → 应答 → 结算 poll,
// 用例按需组合;应答与结算之间可插瞬态采样(如出牌线 rAF 原子采样)。

/** 结算 poll 的对照基线:窗升起前后各座位现金(paid/unpaid 的参照系)。 */
export interface ReactionBaseline {
  cash: number[];
}

/** 结算期望(pollReactionSettled):窗必收是公理,其余按需勾选,只断言勾选项。 */
export interface ReactionSettle {
  /** 现金必降的座位(照缴的份)。 */
  paid?: number[];
  /** 现金不许降的座位(拆掉的份/免缴)。 */
  unpaid?: number[];
  /** 权威侧 use=0 应答留痕(不用/静音/超时代发同一条普通命令)。 */
  declined?: boolean;
  /** 识破拆招留痕(reactionCounter)。 */
  countered?: boolean;
}

/** 应答方式:counter=选牌(+选份笺)落印;decline=点「不用」;mute=点「本回合不再
 *  询问」;timeout=不应答,等横幅到点自动收回(windowMs=窗长,断言窗给 12s 负载余量
 *  ——横幅收回必发生在加长窗拍,旧短窗反而不满足)。 */
export type ReactionAnswer =
  | { mode: "counter"; card: string; seat?: number }
  | { mode: "decline" }
  | { mode: "mute" }
  | { mode: "timeout"; windowMs: number };

/** 等反应窗升起并记现金基线。基线先于窗升起读取(与结算事件间隔最小)。 */
export async function awaitReactionWindow(page: Page, timeout = 60_000): Promise<ReactionBaseline> {
  const s = await snap(page);
  const cash: number[] = s.players.map((p: any) => p.cash);
  await expect(page.getByTestId(TESTIDS.reactionBanner)).toBeVisible({ timeout });
  return { cash };
}

/** 应答交互(不动结算):counter 模式顺手守「点笺接线」——带 seat 时候选笺随选牌展开
 *  (事件文案报的是进攻方牌,各场景各异,由调用方断言);落印钮未选中时禁用。
 *  #终局 e2e:点击链走页面内直派(单 evaluate 内 50ms 轮询)——CDP 逐击的
 *  actionability 往返在满载机器上可达秒级,与权威看门狗赛跑会误窗应答/超窗挂死;
 *  页面内直派照走真实 DOM 事件 → React 处理器(选中→落印的 UI 接线不变),只省
 *  跨进程往返。窗被看门狗收掉时轮询自愈到下一道窗(选牌状态随窗复位重选)。
 *  timeout 模式不做应答,仍走原等待。 */
export async function answerReactionWindow(page: Page, answer: ReactionAnswer): Promise<void> {
  const banner = page.getByTestId(TESTIDS.reactionBanner);
  if (answer.mode === "timeout") {
    await expect(banner).not.toBeVisible({ timeout: answer.windowMs + 12_000 });
    return;
  }
  await page.evaluate(
    ({ mode, card, seat }) => {
      const click = (el: Element | null): boolean => {
        if (el == null) return false;
        el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
        return true;
      };
      return new Promise<void>((resolve, reject) => {
        const deadline = Date.now() + 30_000;
        let stage: "card" | "seat" | "confirm" = "card";
        let cardMisses = 0;
        const timer = setInterval(() => {
          if (Date.now() > deadline) {
            clearInterval(timer);
            reject(new Error("answerReactionWindow:30s 内未完成应答点击链"));
            return;
          }
          if (mode === "counter") {
            // counter 路径演出在播先不点(选牌→落印两段点击链被演出拖后会与权威
            // 看门狗赛跑;窗若在排空期间被代发收掉,轮询自愈到下一道窗,.sel 选中态
            // 随窗复位、选择段自动重来)。decline/mute 是单发命令应答,见下。
            const fx = (window as any).__dafung.controller()?.fx;
            if (fx != null && fx.playing) return;
            if (stage === "card") {
              const cardEl = document.querySelector(`[data-testid="jinnang-card-${card}"]`);
              if (cardEl?.classList.contains("sel")) {
                stage = seat == null ? "confirm" : "seat";
              } else {
                // 点击后等 .sel 落地再进下一段:React 未刷/选中被窗切换清空时重试,
                // 连续 3 拍未中才再点(防与「再点同牌取消」的 toggle 语义互踩)。
                cardMisses = cardEl == null ? 0 : cardMisses + 1;
                if (cardMisses >= 3) {
                  click(cardEl);
                  cardMisses = 0;
                }
              }
              return;
            }
            if (stage === "seat") {
              const chip = document.querySelector(`[data-testid="reaction-seat-${seat}"]`);
              if (chip?.classList.contains("picked") || click(chip)) stage = "confirm";
              return;
            }
            const confirm = document.querySelector<HTMLButtonElement>(
              '[data-testid="reaction-confirm"]',
            );
            if (confirm != null && !confirm.disabled && click(confirm)) {
              clearInterval(timer);
              resolve();
            }
            return;
          }
          // decline/mute 单发命令应答:横幅在即点(联机日常路径,命令触发的新批入队
          // 追平,不打断在途转场)——不等演出排空,5s 权威窗内必落地。
          const btn = document.querySelector(
            `[data-testid="${mode === "decline" ? "reaction-decline" : "reaction-mute"}"]`,
          );
          if (click(btn)) {
            clearInterval(timer);
            resolve();
          }
        }, 50);
      });
    },
    {
      mode: answer.mode,
      card: answer.mode === "counter" ? answer.card : "",
      seat: answer.mode === "counter" ? (answer.seat ?? null) : null,
    },
  );
}

/** 行军拦检窗原子应答:页面内轮询 march 文案(火烧窗同形不同文,以文案过滤)→ 读
 *  pendingReaction.view.userSeat → 应答(counter=选牌落印;decline=点「不用」,牌不耗)
 *  ,单 evaluate 完成——读与答同一窗,无 CDP 往返竞速(读到的 mover 即应答的窗,权威
 *  看门狗赛跑由此免疫;窗被看门狗收掉则复位等下一道拦检窗)。返回被应答窗的行人座位,
 *  与 mover 断言配对。 */
export async function answerMarchCounter(
  page: Page,
  mode: "counter" | "decline" = "counter",
): Promise<number> {
  return page.evaluate(
    (answerMode) =>
      new Promise<number>((resolve, reject) => {
        const click = (el: Element | null): boolean => {
          if (el == null) return false;
          el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
          return true;
        };
        const deadline = Date.now() + 45_000;
        let stage: "wait" | "card" | "confirm" = "wait";
        let mover = -1;
        let cardMisses = 0;
        const timer = setInterval(() => {
          // 演出在播不读取不应答(与 answerReactionWindow 同口径):mover 读取与应答
          // 都落在演出排空后的当前窗上,读答一致性不受播放节奏影响。
          const fx = (window as any).__dafung.controller()?.fx;
          if (fx != null && fx.playing) return;
          const e = (window as any).__dafung.getEngine();
          if (Date.now() > deadline) {
            clearInterval(timer);
            reject(new Error("answerMarchCounter:45s 内行军拦检窗未应答完成"));
            return;
          }
          if (e.turnPhase !== "AwaitingReaction" || e.pendingReaction?.view?.kind !== "march") {
            stage = "wait"; // 窗已收(看门狗代发):复位等下一道拦检窗
            return;
          }
          if (
            stage === "wait" &&
            !document
              .querySelector('[data-testid="reaction-text"]')
              ?.textContent?.includes("行军将过你的城池")
          )
            return; // 横幅未起或非 march 文案:继续等
          if (stage === "wait") {
            mover = e.pendingReaction.view.userSeat;
            stage = answerMode === "decline" ? "confirm" : "card";
          }
          if (stage === "card") {
            const cardEl = document.querySelector('[data-testid="jinnang-card-半路杀出"]');
            if (cardEl?.classList.contains("sel")) {
              stage = "confirm";
            } else {
              // 等 .sel 落地再进下一段(口径同 answerReactionWindow,防 toggle 互踩)
              cardMisses = cardEl == null ? 0 : cardMisses + 1;
              if (cardMisses >= 3) {
                click(cardEl);
                cardMisses = 0;
              }
            }
            return;
          }
          const btn =
            answerMode === "decline"
              ? document.querySelector('[data-testid="reaction-decline"]')
              : document.querySelector<HTMLButtonElement>('[data-testid="reaction-confirm"]');
          const ready =
            btn instanceof HTMLButtonElement && answerMode === "counter"
              ? !btn.disabled
              : btn != null;
          if (ready && click(btn)) {
            clearInterval(timer);
            resolve(mover);
          }
        }, 50);
      }),
    mode,
  );
}

/** 结算 poll(引擎语义住此):窗收(turnPhase 离开 AwaitingReaction)+ 按勾选断言
 *  现金缴支与应答/识破留痕。观测键集与期望键集同源生成,toEqual 零漂移。 */
export async function pollReactionSettled(
  page: Page,
  before: ReactionBaseline,
  settle: ReactionSettle,
  timeout = 30_000,
): Promise<void> {
  const watched = [...new Set([...(settle.paid ?? []), ...(settle.unpaid ?? [])])];
  const expected: Record<string, boolean> = { up: false };
  if (settle.declined != null) expected.declined = settle.declined;
  if (settle.countered != null) expected.countered = settle.countered;
  for (const seat of watched) expected[`paid${seat}`] = (settle.paid ?? []).includes(seat);
  await expect
    .poll(
      async () => {
        const s = await snap(page);
        const log = JSON.stringify(s.log);
        const o: Record<string, boolean> = { up: s.turnPhase === "AwaitingReaction" };
        if (settle.declined != null)
          o.declined = log.includes("reactionRespond") && log.includes("use=0");
        if (settle.countered != null) o.countered = log.includes("reactionCounter");
        for (const seat of watched) o[`paid${seat}`] = s.players[seat].cash < before.cash[seat];
        return o;
      },
      { timeout, message: `反应窗结算未达预期:${JSON.stringify(settle)}` },
    )
    .toEqual(expected);
}
