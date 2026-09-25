// 布局冒烟(#253 三区骨架;前身为 react-sidebar.spec.ts——侧栏退役后改写):
// 三区可见(顶部条/席位竖卡列/底部仪表条)+ 席位卡字段 + 浮签(hover/长按/贴缘翻面)+
// 活跃光效 + 8 人局降档(右 3 + 左 3 + 顶行缩微)+ 战报抽屉/expandPile(#255 收口)。
import { test, expect } from "./fixtures";
import {
  quickStart,
  snap,
  fmtMoney,
  waitMyPause,
  openSoloSetup,
  pickCapital,
  waitSettled,
  dismissJinnangIfUp,
  actIfCan,
  force,
} from "./react-helpers";

test.describe("三区骨架", () => {
  test("三区可见,右栏退役零残留", async ({ page }) => {
    await quickStart(page);
    await expect(page.getByTestId("top-bar")).toBeVisible();
    await expect(page.getByTestId("seat-rail")).toBeVisible();
    await expect(page.getByTestId("dashboard-bar")).toBeVisible();
    // 退役容器零残留(#253 迁移清单:statusBar/hand/treasury/others/sidebar 系)
    for (const t of [
      "status-bar-panel",
      "hand-panel",
      "treasury-panel",
      "others-panel",
      "sidebar-panel",
      "sidebar-collapsed",
    ]) {
      await expect(page.locator(`[data-testid="${t}"]`)).toHaveCount(0);
    }
  });

  test("顶部条:回合 chip / 活跃方 / 目标身价 / 牌库弃牌计数与快照一致", async ({ page }) => {
    await quickStart(page);
    await expect
      .poll(async () => {
        const s = await snap(page);
        const round = await page.getByTestId("topbar-round").textContent();
        const target = await page.getByTestId("topbar-target").textContent();
        const deck = await page.getByTestId("topbar-deck").textContent();
        const discard = await page.getByTestId("topbar-discard").textContent();
        return (
          round === `第 ${s.round} 轮` &&
          target === `目标 ${fmtMoney(s.targetNetWorth)}` &&
          deck === String(s.jinnangDeckCount) &&
          discard === String(s.jinnangDiscard.length) &&
          (await page.getByTestId("topbar-active").textContent()) ===
            `${s.players[s.activeIndex].guohao}之回合`
        );
      })
      .toBe(true);
  });

  test("席位卡字段:对手有卡、自身无卡;现金/体力/徽章随快照;「你」印在仪表条", async ({ page }) => {
    await quickStart(page);
    await waitMyPause(page, 0);
    await waitSettled(page);
    // 自身(座位 0)不出卡,对手三席有卡
    await expect(page.getByTestId("seat-0")).toHaveCount(0);
    await expect
      .poll(async () => {
        const s = await snap(page);
        const ok = [];
        for (const seat of [1, 2, 3]) {
          const p = s.players[seat];
          const cash = await page.getByTestId(`seat-cash-${seat}`).textContent();
          const stam = await page.getByTestId(`seat-stamina-${seat}`).textContent();
          const warrant = await page
            .getByTestId(`seat-attr-warrant-${seat}`)
            .getAttribute("aria-label");
          ok.push(
            cash === fmtMoney(p.cash) &&
              stam === String(p.stamina) &&
              warrant === `委任状 ${p.warrants}`,
          );
        }
        return ok.every(Boolean);
      })
      .toBe(true);
    // 「你」印归仪表条身份头(自身不出席位卡)
    await expect(page.getByTestId("dashboard-bar").getByTestId("dash-you")).toBeVisible();
    await expect(page.getByTestId("seat-1").getByTestId("dash-you")).toHaveCount(0);
    // 现金大数全屏唯一
    await expect(page.getByTestId("dash-cash")).toHaveCount(1);
  });

  test("浮签:hover 显名词释义,离签即隐;长按 400ms 同效;贴右缘席位向左翻面", async ({ page }) => {
    await quickStart(page);
    const badge = page.getByTestId("seat-attr-warrant-1");
    const tip = page.getByTestId("attr-tip");
    // 对局自走会随时弹决策卷轴/骰子 overlay 抢走悬停——每步动作都带「清卷轴 + 重试」
    //(断言只依赖图标浮签机制本身,不依赖数值,推进无妨)。
    const clear = async () => {
      await dismissJinnangIfUp(page);
      await actIfCan(page).catch(() => false);
    };
    // hover:名词 + 一句话释义
    await expect(async () => {
      await clear();
      await badge.hover({ timeout: 3_000 });
      await expect(tip).toBeVisible();
      await expect(tip).toContainText("委任状");
    }).toPass({ timeout: 30_000 });
    await page.mouse.move(400, 400);
    await expect(tip).toBeHidden();
    // 长按(压住 ≥400ms)同效
    await expect(async () => {
      await clear();
      await badge.hover({ timeout: 3_000 });
      await page.mouse.down();
      await expect(tip).toBeVisible();
    }).toPass({ timeout: 30_000 });
    await page.mouse.up();
    await expect(tip).toBeHidden();
    // 贴右缘翻面:席位卡列在视口右缘,浮签整体翻到徽章左侧(不溢出视口)
    await expect(async () => {
      await clear();
      await badge.hover({ timeout: 3_000 });
      await expect(tip).toBeVisible();
    }).toPass({ timeout: 30_000 });
    const bb = (await badge.boundingBox())!;
    const tb = (await tip.boundingBox())!;
    expect(tb.x + tb.width).toBeLessThanOrEqual(bb.x + 4); // 浮签右缘不越过徽章左缘(留 4px 容差)
    expect(tb.x).toBeGreaterThanOrEqual(0);
  });

  test("活跃光效:活跃方席位卡挂 active 光效与「运筹中」微标(操作不限时,倒计时条已撤)", async ({
    page,
  }) => {
    await quickStart(page);
    await expect
      .poll(
        async () => {
          // #255 既有 flake 定性收口(无 seed 快停人类落购地格):人类停在决策点时
          // activeIndex 恒为自身,轮询体永不满足——轮询体内放行决策点,让活跃方轮到 bot
          //(口径对齐本文件浮签用例的 clear())。
          await dismissJinnangIfUp(page);
          await actIfCan(page).catch(() => false);
          const s = await snap(page);
          if (s.phase !== "Playing") return false;
          const active = s.players[s.activeIndex];
          if (!active.isBot) return false; // 等 bot 回合:光效/微标只在他人卡上,自身回合 viewSeat 无卡
          const card = page.getByTestId(`seat-${s.activeIndex}`);
          const cls = (await card.getAttribute("class")) ?? "";
          return (
            cls.includes("active") &&
            (await card.getByText("运筹中").count()) === 1 &&
            (await card.locator(".timerbar").count()) === 0
          );
        },
        { message: "活跃 bot 席位卡挂金圈光效 + 运筹中微标(无倒计时条,2026-09-25 拍板)" },
      )
      .toBe(true);
  });

  test("仪表条:现金大数随快照、签面驻留、托管入口在(单机)", async ({ page }) => {
    await quickStart(page);
    await expect
      .poll(async () => {
        const s = await snap(page);
        const me = s.players[0]; // 单机自局恒为座位 0(SoloSetup 首座真人)
        const cash = await page.getByTestId("dash-cash").textContent();
        return cash?.includes(fmtMoney(me.cash)) === true; // 触发元含「现金」标签,取包含
      })
      .toBe(true);
    await expect(page.getByTestId("dice-face")).toHaveText(/[签一二三四五六]/);
    await expect(page.getByTestId("autopilot-button")).toBeVisible();
    await expect(page.getByTestId("autopilot-speed")).toBeVisible();
    // 珍宝/名将计数徽章(#255 接展开,本票只做计数)
    await expect(page.getByTestId("dash-treasures")).toBeVisible();
    await expect(page.getByTestId("dash-heroes")).toHaveText(/\/3$/);
  });

  // ── #255 收口:战报抽屉 + expandPile ──
  test("战报抽屉:把手常驻,点开渲染对局日志,Esc 关闭后零占位", async ({ page }) => {
    await quickStart(page);
    // 收起零占位:只有把手,无抽屉
    await expect(page.getByTestId("log-tab")).toBeVisible();
    await expect(page.getByTestId("log-drawer")).toHaveCount(0);
    // 对局自走会随时弹决策卷轴/窗态抢交互——每步先清决策点再点把手(浮签用例同口径)
    await expect(async () => {
      await dismissJinnangIfUp(page);
      await actIfCan(page).catch(() => false);
      await page.getByTestId("log-tab").click({ timeout: 3_000 });
      await expect(page.getByTestId("log-drawer")).toBeVisible();
    }).toPass({ timeout: 30_000 });
    // 抽屉渲染对局日志(开局必有玩法事件;条目带「轮N」小签)
    await expect(page.getByTestId("log-drawer")).toContainText(/轮\d+/);
    // Esc 关闭(Base UI 底件行为),收起后零占位
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("log-drawer")).toHaveCount(0);
  });

  test("expandPile:点珍宝徽章明细展入牌架行,再点收起;空摞不可展开", async ({ page }) => {
    test.setTimeout(120_000); // 对局自走 + 三个 toPass 轮询,60s 默认档偏紧
    await quickStart(page);
    // 空摞(珍宝 0 张):点击零动作,不展开
    await expect(async () => {
      await dismissJinnangIfUp(page);
      await actIfCan(page).catch(() => false);
      await page.getByTestId("dash-treasures").click({ timeout: 3_000 });
      await expect(page.getByTestId("pile-row")).toHaveCount(0);
    }).toPass({ timeout: 30_000 });
    // 塞两件珍宝(force 通道:引擎直写 + 重灌快照),徽章展开 → 明细行落牌架
    await force(page, "e.players[0].treasures.push(e.treasureDeck[0], e.treasureDeck[1]);");
    await expect(async () => {
      await dismissJinnangIfUp(page);
      await actIfCan(page).catch(() => false);
      await page.getByTestId("dash-treasures").click({ timeout: 3_000 });
      await expect(page.getByTestId("pile-row")).toBeVisible();
    }).toPass({ timeout: 30_000 });
    // 对局自走中珍宝可能继续进账(宝物城拼点),签数对齐实时快照而非钉死
    await expect(async () => {
      const s = await snap(page);
      await expect(page.getByTestId("pile-row").locator(".pile-slip")).toHaveCount(
        s.players[0].treasures.length,
      );
    }).toPass({ timeout: 15_000 });
    // 再点收起飞回
    await expect(async () => {
      await dismissJinnangIfUp(page);
      await actIfCan(page).catch(() => false);
      await page.getByTestId("dash-treasures").click({ timeout: 3_000 });
      await expect(page.getByTestId("pile-row")).toHaveCount(0);
    }).toPass({ timeout: 30_000 });
  });
});

test.describe("8 人局降档", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("7 对手 = 右列 3 + 左列 3 + 顶行缩微 1(顶行卡只留现金+血条|城/手牌四格)", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.goto("/");
    await openSoloSetup(page);
    for (let i = 4; i < 8; i++) await page.getByTestId("setup-seat-count-plus").click(); // X10 stepper:4 → 8
    await page.getByTestId("start-game").click();
    await pickCapital(page);
    // 8 人局人类首回合前最多 7 个 bot 回合,预算放宽(#191/#188 同口径)
    await waitMyPause(page, 0, 90_000);
    await waitSettled(page);
    const s = await snap(page);
    // 席位卡总数 = 对手数(自身不出卡);切分 = 右 3 + 左 3 + 顶行其余
    const seatCount = s.players.length;
    await expect(page.locator('[data-testid="seat-rail"] .seat')).toHaveCount(seatCount - 1);
    await expect(page.locator('[data-testid="seat-rail"] .seatcol:not(.left) .seat')).toHaveCount(
      3,
    );
    await expect(page.locator('[data-testid="seat-rail"] .seatcol.left .seat')).toHaveCount(3);
    await expect(page.locator('[data-testid="seat-rail"] .seatrow-top .seat')).toHaveCount(
      seatCount - 7,
    );
    // 顶行缩微卡只有 城/手牌 两枚徽章(四格形态),常态卡六枚
    const topCard = page.locator('[data-testid="seat-rail"] .seatrow-top .seat').first();
    await expect(topCard.locator(".ib")).toHaveCount(2);
    await expect(topCard.getByTestId(/^seat-attr-warrant-/)).toHaveCount(0);
  });
});
