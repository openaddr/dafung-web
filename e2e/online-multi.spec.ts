// 端到端联机对局:两个独立浏览器 context(=两台设备)同房,从开局玩到终局,
// 全程跨端同步。验证真实多人联机体验(不只机制,是完整一局)。
// 用低目标身价(3000)确保对局能在合理时间内终局(默认 8000 现金制可能僵持)。
import { test, expect, type Page } from "@playwright/test";

const ONLINE = "http://localhost:3010";

/** 在某端推进一个可用动作(掷骰 / 内嵌常规决策 / 卷轴复杂决策)。无可用动作返回 false。 */
async function actIfCan(p: Page): Promise<boolean> {
  if (await p.locator("#roll-btn").isEnabled().catch(() => false)) {
    await p.locator("#roll-btn").click();
    return true;
  }
  const inline = p.locator(".action-inline [data-action]:not([disabled])");
  if ((await inline.count()) > 0) {
    await inline.first().click();
    return true;
  }
  const scrollPrimary = p.locator(".scroll-overlay .btn-primary");
  if ((await scrollPrimary.count()) > 0) {
    await scrollPrimary.first().click();
    return true;
  }
  const scrollAny = p.locator(".scroll-overlay [data-action]");
  if ((await scrollAny.count()) > 0) {
    await scrollAny.first().click();
    return true;
  }
  return false;
}

async function statusOf(p: Page): Promise<string> {
  return ((await p.locator("#status-bar").textContent()) ?? "").trim();
}

test("端到端联机对局:2 设备从头玩到终局,跨端同步", async ({ browser }) => {
  test.setTimeout(240_000);
  const a = await (await browser.newContext()).newPage();
  const b = await (await browser.newContext()).newPage();

  // A 建房(2 座、无 bot、目标 3000)
  await a.goto(`${ONLINE}/?online=1`);
  await a.getByPlaceholder("目标身价(默认8000)").fill("3000");
  await a.getByRole("button", { name: "建房" }).click();
  await expect(a.getByRole("heading", { name: "大厅" })).toBeVisible({ timeout: 8000 });
  const code = ((await a.locator(".lobby-code").textContent()) ?? "").trim();
  expect(code).toMatch(/^[A-Z]{4}$/);

  // B 凭码加入 → A 开局
  await b.goto(`${ONLINE}/?online=1`);
  await b.getByPlaceholder("房间码").fill(code);
  await b.getByRole("button", { name: "加入" }).click();
  await expect(b.getByRole("heading", { name: "大厅" })).toBeVisible({ timeout: 8000 });
  await a.getByRole("button", { name: "开局" }).click();
  await expect(a.locator("#status-bar")).toContainText(/的回合/, { timeout: 20000 });
  await expect(b.locator("#status-bar")).toContainText(/的回合/, { timeout: 20000 });

  // 跑到终局:谁有可用动作谁推进,直到两端都出胜利层
  let stall = 0;
  let actions = 0;
  for (let i = 0; i < 800; i++) {
    const aOver = (await a.locator(".victory-overlay").count()) > 0;
    const bOver = (await b.locator(".victory-overlay").count()) > 0;
    if (aOver && bOver) break;
    const acted = (await actIfCan(a)) || (await actIfCan(b));
    if (acted) {
      actions++;
      stall = 0;
      // 每 20 步:settled 后两端状态条应一致(跨端同步巡检)
      if (actions % 20 === 0) {
        await a.waitForTimeout(150);
        const sa = await statusOf(a);
        const sb = await statusOf(b);
        if (sa && sb && !sa.includes("称帝")) expect(sb).toBe(sa);
      }
    } else {
      stall++;
      if (stall === 8) {
        for (const [p, name] of [[a, "A"], [b, "B"]] as const) {
          const d = await p.evaluate(() => {
            const df = (window as unknown as { __dafung?: { engine: any; seat: () => number; busy: () => boolean } }).__dafung;
            const e = df?.engine;
            const seat = df?.seat() ?? -1;
            const owner = e?.turnPhase === "AwaitingTreasureOwner" ? e?.treasureVisitor?.ownerIdx : e?.activeIndex;
            return {
              seat,
              phase: e?.phase ?? null,
              turnPhase: e?.turnPhase ?? null,
              activeIndex: e?.activeIndex ?? null,
              owner,
              myIsBot: e?.players?.[seat]?.isBot ?? null,
              myDecision: e?.phase === "Playing" && owner === seat && !(e?.players?.[seat]?.isBot ?? true),
              busy: df?.busy() ?? null,
              rollDisabled: document.querySelector<HTMLButtonElement>("#roll-btn")?.disabled ?? null,
            };
          });
          console.log(`STALL_${name}`, JSON.stringify(d));
        }
      }
      if (stall > 30) throw new Error("联机对局卡住:见 STALL_ 日志");
      await a.waitForTimeout(250);
    }
  }
  console.log("MULTI_ACTIONS", actions);

  // 终局断言:两端都到胜利层 + 同一胜者
  await expect(a.locator(".victory-overlay")).toBeVisible({ timeout: 10000 });
  await expect(b.locator(".victory-overlay")).toBeVisible({ timeout: 10000 });
  const aWin = ((await a.locator(".victory-sub").textContent()) ?? "").trim();
  const bWin = ((await b.locator(".victory-sub").textContent()) ?? "").trim();
  expect(bWin).toBe(aWin);
  console.log("MULTI_WINNER", aWin, "(actions:", actions + ")");
});
