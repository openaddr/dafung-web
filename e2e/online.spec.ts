// 联机 e2e:启动引擎服务器(3010,托管 dist + WS)→ 浏览器走 建房→开局→掷骰。
// 锁定 network-client ↔ server 的回归(snapshot 驱动渲染 + WS 命令往返)。
import { test, expect } from "@playwright/test";

// 引擎服务器(见 playwright.config.ts 第二个 webServer)。
const ONLINE = "http://localhost:3010";

test("联机:建房 vs bot → 开局 → 掷骰,snapshot 驱动渲染", async ({ page }) => {
  await page.goto(ONLINE + "/?online=1");

  // 建房:2 座,seat 1 为 bot(单人 vs bot)
  await page.getByPlaceholder("bot 座位号,逗号分隔(如 1,2)").fill("1");
  await page.getByRole("button", { name: "建房" }).click();

  // 进大厅:房间码 + 开局按钮
  await expect(page.getByRole("heading", { name: "大厅" })).toBeVisible();
  await page.getByRole("button", { name: "开局" }).click();

  // 开局后:autoSetup(选都)+ 可能的 bot 先手,都由服务器逐步广播;最终轮到我(行军启用)
  const rollBtn = page.getByRole("button", { name: "行军" });
  await expect(rollBtn).toBeEnabled({ timeout: 20_000 });

  // 行军前先记一下战报条数,用于断言"掷骰后战报增长"
  const warlogBefore = await page.locator("#warlog").textContent();

  await rollBtn.click();

  // 我的掷骰命令 → 服务器处理 → snapshot 回流 → 签面显示点数(一..六)
  await expect(page.locator("#dice-face")).toHaveText(/[一二三四五六]/, { timeout: 10_000 });

  // 战报增长了(我的抽签记录 + 可能的落格/bot 回合)
  await expect(page.locator("#warlog")).not.toHaveText(warlogBefore ?? "", { timeout: 10_000 });

  // 开局选都完成:紧凑玩家条(P4 renderOthers)显示某玩家 ≥1 城(都城算 1 城)
  await expect(page.locator("#players")).toContainText(/[1-9]\d*城/, { timeout: 10_000 });
});

test("联机:房间码拉起第二位玩家(模拟加入)", async ({ request }) => {
  // 直接打 REST:建房 → 加入,校验 seatToken/FCFS 占座语义(ADR-0004/0005)
  const created = await request.post(ONLINE + "/room/new", { data: { seats: 3, bot: "2", seed: 7 } });
  expect(created.ok()).toBeTruthy();
  const c = await created.json();
  expect(c.roomId).toMatch(/^[A-Z]{4}$/);
  expect(c.seat).toBe(0);
  expect(c.seatToken).toBeTruthy();
  expect(c.seats).toHaveLength(3);
  expect(c.seats[0].taken).toBe(true); // host 已占
  expect(c.seats[2].kind).toBe("bot");

  // 加入 → 占 seat 1
  const joined = await request.post(ONLINE + "/room/join", { data: { roomId: c.roomId } });
  const j = await joined.json();
  expect(j.seat).toBe(1);
  expect(j.seatToken).toBeTruthy();

  // 再加入 → 房间满(只剩 seat 1,已占)→ 409
  const full = await request.post(ONLINE + "/room/join", { data: { roomId: c.roomId } });
  expect(full.status()).toBe(409);
});
