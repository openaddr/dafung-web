// 扩展系统骨架 e2e(#378,ADR-0022):示例名将包(extensions/hero-taishici)全链路——
// 启动装载(权威贡献进名将池)→ 对局招贤可选到示例名将(渲染 hook:专属将旗上卡面)
// → 选定后被动技「义从」权威结算(+100 两)+ 动画 handler 播「义」字印与扩展文案浮字
// → 主动技「破阵」复用 warDrum 结算(步数 +1)+ 扩展浮字。
// 断言口径:状态断言走引擎 god view(与既有 spec 同款);动效是瞬态元素,单次 evaluate
// 内 rAF 轮询原子采样(react-jinnang-use 指示线先例)。
import { test, expect } from "./fixtures";
import { quickStart, force, snap, engineState, waitSettled, useHalfScale } from "./react-helpers";
import { TESTIDS } from "../src/app/screens/game/testids";
import { SCROLL_TESTIDS as T } from "../src/app/screens/game/scroll/testids";
import type { Page } from "@playwright/test";

/** 种植招贤候选(示例名将居中位)+ 摆 AwaitingHeroPick:候选取 heroDefs 全量定义
 *  (#378 调试钩子),按 #787 候选行形状 {def, skillIds(预掷授技)} 直写种植——
 *  种植者定预掷结果(e2e 给整池),引擎落定原样入槽不重掷。 */
async function plantHeroPick(page: Page): Promise<void> {
  await force(
    page,
    `
    {
      const defs = window.__dafung.heroDefs();
      const taishici = defs.find((h) => h.id === "taishici");
      if (!taishici) throw new Error("扩展包未装载:名将池无 taishici(#378 装载断言)");
      e.phase = "Playing";
      e.activeIndex = 0;
      const row = (id) => { const d = defs.find((h) => h.id === id); return { def: d, skillIds: [...d.skillPool] }; };
      e.offeredHeroes = [row("zhouyu"), row("taishici"), row("huatuo")];
      e.turnPhase = "AwaitingHeroPick";
    }
  `,
  );
}

/** 单次 evaluate 原子采样:rAF 轮询等扩展动效现身(浮字文案必查;印章字可选查),
 *  现身即在同一样本里回报;15s 封顶防死等。瞬态元素禁 locator 读(缺元素会挂到
 *  超时),仓库既有口径。 */
function sampleFx(
  page: Page,
  floaterText: string,
  sealChar?: string,
): Promise<{ seal: boolean | null; floater: boolean }> {
  return page.evaluate(
    `(async () => {
      const deadline = performance.now() + 15000;
      const wantSeal = ${JSON.stringify(sealChar ?? null)} != null;
      const needle = ${JSON.stringify(floaterText)};
      let seal = false;
      let floater = false;
      while (performance.now() < deadline) {
        floater = [...document.querySelectorAll(".fx-svg-floater")].some(
          (el) => (el.textContent ?? "").includes(needle),
        );
        seal = wantSeal
          ? [...document.querySelectorAll(".fx-svg-seal")].some(
              (el) => (el.textContent ?? "").includes(${JSON.stringify(sealChar ?? "")}),
            )
          : false;
        if (floater && (!wantSeal || seal)) break;
        await new Promise((r) => requestAnimationFrame(r));
      }
      return { seal: wantSeal ? seal : null, floater };
    })()`,
  );
}

test.describe("扩展系统骨架(#378 示例名将包全链)", () => {
  test("装包→装载→招贤可选→渲染 hook 将旗→选定结算+动画 handler", async ({ page }) => {
    await quickStart(page, 7);
    await plantHeroPick(page);

    // 渲染 hook(#378 三能力之三):招贤卡面挂示例包专属将旗(assets URL)
    const scroll = page.getByTestId(T.heroPickScroll);
    await expect(scroll).toBeVisible();
    const flag = scroll.getByTestId(TESTIDS.heroFlag("taishici"));
    await expect(flag).toHaveAttribute("src", "/extensions/hero-taishici/assets/flag.svg");

    // 选定太史慈(候选中位):被动技「义从」权威结算 +100 两
    const before = await snap(page);
    const cashBefore = before.players[0].cash;
    const samplePromise = sampleFx(page, "义从归心", "义");
    await scroll.locator(`[data-testid="${T.heroPickOption(1)}"]`).click();
    await expect(scroll).toBeHidden();
    await expect
      .poll(async () => engineState(page, "e.players[0].cash"), { timeout: 10_000 })
      .toBe(cashBefore + 100);
    expect(await engineState(page, "e.players[0].heroes.map((h) => h.heroId)")).toContain(
      "taishici",
    );
    // 动画 handler(#378 三能力之二):「义」字印 + 扩展文案浮字(瞬态采样)
    expect(await samplePromise).toEqual({ seal: true, floater: true });
    await waitSettled(page);
  });

  test("主动技「破阵」:出牌阶段可发,复用 warDrum 结算步数 +1,扩展浮字播报", async ({ page }) => {
    await useHalfScale(page); // 放缓演出:发技后自动起摇前留足断言窗(heroDiceBonus 消费前)
    await quickStart(page, 7);
    // 种植:人类麾下带示例名将,停出牌阶段(技卡承载 HeroCardFace compact 档,将旗同挂)
    await force(
      page,
      `
      {
        const taishici = window.__dafung.heroDefs().find((h) => h.id === "taishici");
        if (!taishici) throw new Error("扩展包未装载:名将池无 taishici");
        e.phase = "Playing";
        e.activeIndex = 0;
        // 麾下槽位行(#785):def 入槽 = {heroId, 已授技(全池), 冷却账},引擎直写种植是既有 e2e 口径
        e.players[0].heroes.push({ heroId: taishici.id, skillIds: [...taishici.skillPool], lastFired: {} });
        e.players[0].jinnangHand = [];
        e.players[0].jinnangHandCount = 0;
        e.turnPhase = "AwaitingJinnang";
      }
    `,
    );
    // testid=选项 id 实例形状 skill:<heroId>:<skillId>(#817)
    const ji = page.getByTestId(TESTIDS.jinnangCard("skill:taishici:taishici-pozhen"));
    await expect(ji).toBeVisible();
    // 渲染 hook 第二卡面:出牌阶段技卡(compact 档)同样挂将旗
    await expect(ji.getByTestId(TESTIDS.heroFlag("taishici"))).toHaveAttribute(
      "src",
      "/extensions/hero-taishici/assets/flag.svg",
    );
    const samplePromise = sampleFx(page, "破阵!擂鼓进军");
    await ji.click();
    await page.getByTestId(TESTIDS.actionbarPlay).click();
    // 权威结算复用 warDrum 案:本回合步数加成挂账;发技事件随同批产出
    // (自动起摇开启新批前的事件窗内采样,0.5 倍率下窗口充裕)
    await expect
      .poll(
        () =>
          engineState(
            page,
            "({ bonus: e.heroDiceBonus, fired: e.gameEvents.some((x) => x.kind === 'heroSkillActivated') })",
          ),
        { timeout: 10_000, intervals: [50] },
      )
      .toEqual({ bonus: 1, fired: true });
    // 动画 handler:破阵扩展浮字
    expect(await samplePromise).toEqual({ seal: null, floater: true });
  });

  test("定制问询「信义盲选」全链(#424):招贤触发→问询弹层牌背盲选→应答弃 1 摸 1 生效", async ({
    page,
  }) => {
    await quickStart(page, 7);
    // 种植:候选只放太史慈 + 手牌 2 张(≥2 可用才进问询相位;起手 1 张走引擎自动执行不弹)
    await force(
      page,
      `
      {
        const defs = window.__dafung.heroDefs();
        const taishici = defs.find((h) => h.id === "taishici");
        if (!taishici) throw new Error("扩展包未装载:名将池无 taishici");
        e.phase = "Playing";
        e.activeIndex = 0;
        e.offeredHeroes = [{ def: taishici, skillIds: [...taishici.skillPool] }];
        e.turnPhase = "AwaitingHeroPick";
        e.players[0].jinnangHand = ["连环计", "缓兵之计"];
        e.players[0].jinnangHandCount = 2;
      }
    `,
    );
    await page.getByTestId(T.heroPickScroll).getByTestId(T.heroPickOption(0)).click();

    // 问询弹层(#424 InquiryLayer):题名随呈现意图(信义盲选),牌背盲选——
    // 选项 label 是序号,牌面(连环计/缓兵之计)不得在任何可见文本里泄露
    const inquiry = page.getByTestId(TESTIDS.inquiryScroll);
    await expect(inquiry).toBeVisible();
    await expect(inquiry.getByTestId(T.scrollTitle)).toHaveText("信义盲选");
    const inquiryText = await inquiry.innerText();
    expect(inquiryText).not.toContain("连环计");
    expect(inquiryText).not.toContain("缓兵之计");
    expect(await engineState(page, "e.turnPhase")).toBe("AwaitingInquiry");

    // 应答:点第 1 张暗牌 → 引擎回灌扩展 resolve(弃「连环计」摸 1 张补位)→ 收口补完
    await inquiry.getByTestId(TESTIDS.inquiryOption(0)).click();
    await expect(inquiry).toBeHidden();
    await expect
      .poll(
        () =>
          engineState(
            page,
            "({ pending: e.pendingInquiry, handLen: e.players[0].jinnangHand.length, first: e.players[0].jinnangHand[0], recycled: e.jinnangDiscard.includes('连环计') })",
          ),
        { timeout: 10_000, intervals: [50] },
      )
      .toEqual({ pending: null, handLen: 2, first: "缓兵之计", recycled: true });
    // 战报双留痕(发起 + 应答)
    expect(
      await engineState(
        page,
        "e.log.some((l) => l.detail.includes('inquiryAwait')) && e.log.some((l) => l.detail.includes('inquiryResolve'))",
      ),
    ).toBe(true);
  });
});
