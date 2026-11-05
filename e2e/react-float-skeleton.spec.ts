// 全浮层骨架(#700)专项:① 顶部浮层几何(#732 顶左行序:设置→详情两钮
// 避 safe-area,顶中让给知会横幅槽;#853 起「N 轮」chip 退役,顶中常驻件=回合
// 胶囊);② 核心几何不变量(满编 8 席 @844×390 矮横屏:
// 第 8 格下缘 ≤ 右下三圆钮上缘,全列零滚动——spec #697 ③ 的交付判据);③ 锦囊手牌开关
// (#1006 重钉:会话内临时收起,唯二复位点=自回合开始/窗态开场弹回;localStorage
// 持久偏好退役,记账/重进恢复断言随行删除);④ 设置弹层(音效开关接
// AudioProvider、战报›入口降级、版本戳、回到主页弃局离屏)。断言全走 testid 单源 +
// 调试钩子/快照,几何断言收进单次 evaluate。
import { test, expect } from "./fixtures";
import {
  quickStart,
  openSoloSetup,
  pickCapital,
  waitMyPause,
  waitSettled,
  dismissJinnangIfUp,
  force,
  freezeClock,
} from "./react-helpers";
import { TESTIDS } from "../src/app/screens/game/testids";
import { TID as SETUP_TID } from "../src/app/screens/setup/testids";

test.describe("顶部浮层几何(#700 ①)", () => {
  test.use({ viewport: { width: 844, height: 390 } });

  test("顶左行序 设置→详情:两钮 32×32 避 safe-area;回合胶囊顶中与钮行同排(#853 chip 退役);三圆钮 44px 贴右下,锦囊默认亮", async ({
    page,
  }) => {
    test.slow(); // quickStart 全链(对局自走),预算放宽同族口径
    await quickStart(page);
    const geo = await page.evaluate(
      ({ overview, settings, capsule, buttons, toggle }) => {
        const rect = (id: string) => {
          const el = document.querySelector(`[data-testid="${id}"]`);
          if (el == null) return null;
          const r = el.getBoundingClientRect();
          return {
            x: r.x,
            y: r.y,
            w: r.width,
            h: r.height,
            cx: r.x + r.width / 2,
            cy: r.y + r.height / 2,
          };
        };
        const vw = document.documentElement.clientWidth;
        const on = document.querySelector(`[data-testid="${toggle}"]`)?.classList.contains("on");
        return {
          overview: rect(overview),
          settingsBtn: rect(settings),
          capsule: rect(capsule),
          buttons: rect(buttons),
          toggleOn: on,
          vw,
        };
      },
      {
        overview: TESTIDS.topbarOverview,
        settings: TESTIDS.settingsButton,
        capsule: TESTIDS.turnCapsule,
        buttons: TESTIDS.pileButtons,
        toggle: TESTIDS.jinnangToggle,
      },
    );
    // 顶左行序(#732):设置 ⚙ 最左,详情 ☰ 其次——两钮 32×32 贴左上
    // (测试环境 safe-area=0,实现口径 = safe + 8px),同一行(y 互齐)
    expect(geo.settingsBtn).not.toBeNull();
    expect(Math.abs(geo.settingsBtn!.w - 32)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(geo.settingsBtn!.h - 32)).toBeLessThanOrEqual(0.5);
    expect(geo.settingsBtn!.x).toBeLessThanOrEqual(9);
    expect(geo.settingsBtn!.y).toBeLessThanOrEqual(9);
    expect(geo.overview).not.toBeNull();
    expect(Math.abs(geo.overview!.w - 32)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(geo.overview!.h - 32)).toBeLessThanOrEqual(0.5);
    expect(geo.overview!.x).toBeGreaterThan(geo.settingsBtn!.x + geo.settingsBtn!.w);
    expect(Math.abs(geo.overview!.y - geo.settingsBtn!.y)).toBeLessThanOrEqual(1);
    // 回合胶囊(#853 chip 退役,轮次唯一落胶囊):顶中知会槽行,与钮行垂直居中
    // 互齐(槽 32px 行内 24px 胶囊居中,槽/钮行同锚 +8);cx 在顶中半场(胶囊
    // 可融合等待附加信息,宽度随内容,只守「中段、不与顶左两钮相侵」)
    expect(geo.capsule).not.toBeNull();
    expect(geo.capsule!.x).toBeGreaterThan(geo.overview!.x + geo.overview!.w);
    expect(Math.abs(geo.capsule!.cy - geo.settingsBtn!.cy)).toBeLessThanOrEqual(3);
    expect(geo.capsule!.cx).toBeGreaterThan(geo.vw / 4);
    expect(geo.capsule!.cx).toBeLessThan(geo.vw * 0.75);
    // 三圆钮:贴右下(44 + 8 右距 + 10 底距),锦囊钮默认亮(=显示)
    expect(Math.abs(geo.buttons!.h - 44)).toBeLessThanOrEqual(0.5);
    expect(geo.buttons!.y + geo.buttons!.h).toBeGreaterThanOrEqual(390 - 55);
    expect(geo.buttons!.x + geo.buttons!.w).toBeGreaterThanOrEqual(844 - 55);
    expect(geo.toggleOn).toBe(true);
  });
});

test.describe("核心几何不变量(#700 ②:满编 8 席全列零滚动)", () => {
  test("8 席 @844×390:第 8 格下缘 ≤ 三圆钮上缘(8×38+7×2=318 ≤ 326),格高 38", async ({ page }) => {
    test.slow(); // 人类首回合前最多 7 个 bot 回合,预算放宽(react-seat-cells 同口径)
    await page.goto("/");
    await openSoloSetup(page);
    for (let i = 4; i < 8; i++) await page.getByTestId(`${SETUP_TID.seatCount}-plus`).click(); // 4 → 8
    await page.getByTestId(SETUP_TID.startGame).click();
    await pickCapital(page);
    await waitMyPause(page, 0, 150_000);
    await waitSettled(page);
    // 配置与开局在桌面视口完成,再切矮横屏验收目标形态(真机即此重排路径)
    await page.setViewportSize({ width: 844, height: 390 });
    await page.getByTestId(TESTIDS.seatRail).waitFor();
    const geo = await page.evaluate((containerId) => {
      const col = document.querySelector(".seat-rail .seatcol")!;
      const cells = [...col.querySelectorAll<HTMLElement>(".seat")];
      const fab = document.querySelector(`[data-testid="${containerId}"]`)!;
      const fabTop = fab.getBoundingClientRect().top;
      const last = cells[cells.length - 1]!.getBoundingClientRect();
      return {
        count: cells.length,
        cellH: cells[0]!.getBoundingClientRect().height,
        lastBottom: last.bottom,
        fabTop,
        overflow: (col as HTMLElement).scrollHeight - (col as HTMLElement).clientHeight,
      };
    }, TESTIDS.pileButtons);
    expect(geo.count).toBe(8);
    expect(Math.abs(geo.cellH - 38)).toBeLessThanOrEqual(0.5);
    expect(geo.lastBottom).toBeLessThanOrEqual(geo.fabTop + 0.5); // 第 8 格下缘 ≤ 三圆钮上缘
    expect(geo.overflow).toBeLessThanOrEqual(0); // 全列零滚动
  });
});

test.describe("锦囊手牌开关(#1006 重钉:会话内临时收起,唯二复位点)", () => {
  test.use({ viewport: { width: 844, height: 390 } });

  // 新钉三问自答:守住什么=「收起是会话内临时态」全语义——收起即隐(手牌区整区
  // 卸载,签面随之)、再点回亮、收起跨他人回合持续(复位点之间收着)、自回合开始
  // (复位点①)与窗态开场(复位点②)两枚上升沿自动弹回;持久偏好退役后这是开关
  // 的唯一契约。墙钟≈40s(单次 quickStart + 停车坪 force,无长链)。替代=原 #700 ③
  // 「收起/localStorage 记账/重进恢复」单例(记账与重进两段断言随持久偏好退役删除)。
  test("收起即隐/再点回亮;跨他人回合持续;我回合与窗态开场弹回(#1006)", async ({ page }) => {
    test.slow(); // quickStart 全链(对局自走),预算放宽同族口径
    await quickStart(page);
    // 停车坪(pinRackIdle 同款钉法,配方出处 react-jinnang-rack):等人类停稳,钉进
    // AwaitingDecision 空闲态 + 清 pendingLand/落格投影——决策卷轴不拦顶栏命中,
    // 锦囊钮可点,状态无限期稳定。
    await waitMyPause(page, 0, 90_000);
    await force(
      page,
      `
      e.lastLandOutcome = null;
      e.pendingLand = null;
      e.turnPhase = "AwaitingDecision";
    `,
    );
    const zone = page.getByTestId(TESTIDS.handZone);
    const toggle = page.getByTestId(TESTIDS.jinnangToggle);
    // 默认亮:开场即挂载,钮亮态
    await expect(zone).toBeVisible();
    await expect(toggle).toHaveClass(/on/);
    // 收起:手牌区整区卸载(卸载零占位,战斗区最大化)、钮亮态退;无落盘
    // (localStorage 记账断言随持久偏好退役,会话内临时态不落盘)
    await toggle.click();
    await expect(zone).toHaveCount(0);
    await expect(toggle).not.toHaveClass(/on/);
    // 再点回亮
    await toggle.click();
    await expect(zone).toBeVisible();
    await expect(toggle).toHaveClass(/on/);
    // 收起跨他人回合持续(复位点之间收着):钉进 bot 席位(#413 停车坪口径,直写
    // 引擎不经房间编排,驱动链不触发,钉住的状态稳定)仍收着
    await toggle.click();
    await expect(zone).toHaveCount(0);
    await force(page, `e.activeIndex = e.players.findIndex((p) => p.isBot);`);
    await expect(zone).toHaveCount(0);
    await expect(toggle).not.toHaveClass(/on/);
    // 复位点①:自回合开始上升沿(activeIndex 回自席,false→true)自动弹回
    await force(page, `e.activeIndex = e.players.findIndex((p) => !p.isBot);`);
    await expect(zone).toBeVisible();
    await expect(toggle).toHaveClass(/on/);
    // 复位点②:窗态开场上升沿(出牌窗 junshiUp false→true)自动弹回
    await toggle.click();
    await expect(zone).toHaveCount(0);
    await force(page, `e.turnPhase = "AwaitingJinnang";`);
    await expect(page.getByTestId(TESTIDS.actionbar)).toBeVisible();
    await expect(zone).toBeVisible();
    await expect(toggle).toHaveClass(/on/);
  });
});

test.describe("签面归组(#840 ④)", () => {
  test.use({ viewport: { width: 844, height: 390 } });

  test("签面与手牌架同组居中:签面贴牌行、组中线≈手牌区中线、架体收拢到内容实宽", async ({
    page,
  }) => {
    test.slow(); // quickStart 全链(对局自走),预算放宽同族口径
    await quickStart(page);
    // 冻结时钟再钉单张手牌(bot 链与偶发反应横幅不与几何读数赛跑,react-seat-cells
    // 挂点断言同款前提);单张把 hug 与旧全宽档的差异放到最大——叠加压缩态架体
    // 本就近乎吃满,断言无分辨力。
    await freezeClock(page);
    await force(page, `e.players[0].jinnangHand = ["军情密探"];`);
    type Geo = {
      gapSealToCard: number;
      groupCenterOffset: number;
      rackHugs: boolean;
      ok: boolean;
    } | null;
    let geo: Geo = null;
    // 反应横幅在场(:has 例外档回全宽,layout.css)或窗态拦顶时整块重试(状态轮询)
    await expect(async () => {
      await dismissJinnangIfUp(page);
      geo = await page.evaluate(
        ({ zone, seal }) => {
          const q = (t: string) => document.querySelector(`[data-testid="${t}"]`);
          const zoneEl = q(zone);
          const sealEl = q(seal);
          const rackEl = document.querySelector(".handzone .hand-rack");
          const cardEl = document.querySelector(".handzone .hand-rack button");
          if (!zoneEl || !sealEl || !rackEl || !cardEl) return null;
          const rect = (el: Element) => {
            const r = el.getBoundingClientRect();
            return { left: r.x, right: r.x + r.width, cx: r.x + r.width / 2, w: r.width };
          };
          const z = rect(zoneEl);
          const s = rect(sealEl);
          const rk = rect(rackEl);
          const c = rect(cardEl);
          const gapSealToCard = c.left - s.right; // 签面右缘 → 首张牌左缘(组内贴邻)
          const groupCenterOffset = Math.abs((s.left + rk.right) / 2 - z.cx);
          const rackHugs = rk.w < z.w - 50; // hug 内容实宽(旧 flex:1 全宽吃满档不满足)
          return {
            gapSealToCard,
            groupCenterOffset,
            rackHugs,
            ok:
              !document.querySelector(".handzone .reaction-banner") &&
              rackHugs &&
              gapSealToCard >= 0 &&
              gapSealToCard <= 45 &&
              groupCenterOffset <= 3,
          };
        },
        { zone: TESTIDS.handZone, seal: TESTIDS.diceFace },
      );
      expect(geo).not.toBeNull();
      expect(geo!.ok).toBe(true);
    }).toPass({ timeout: 15_000 });
    // 终值逐项复述(失败信息直读几何差量)
    expect(geo!.gapSealToCard).toBeGreaterThanOrEqual(0);
    expect(geo!.gapSealToCard).toBeLessThanOrEqual(45);
    expect(geo!.groupCenterOffset).toBeLessThanOrEqual(3);
    expect(geo!.rackHugs).toBe(true);
  });
});

// 「设置弹层」复合例(音效/战报抽屉/版本戳/弃局离屏)已按 #987 删除:并行挂一次、
// 串行复验全绿 = 概率性不可靠,无一行确定性改造可根治(快照被同批慢池清场,无失败
// 签名可治)。注意:演出加速/版本行的 e2e 断言随例退场,此后无自动化覆盖(版本行
// 是静态发版号文本,#951/#952 交付时人工验讫)。
