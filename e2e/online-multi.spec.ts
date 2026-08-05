// 端到端联机对局:2 设备从头玩到终局,跨端同步。
// 完整的联机验证——证明多人类客户端能完整玩一局到分胜负。
// Helpers 在 e2e/multi-helpers.ts(createClients/driveToGameOver/playRounds)。
import { test, expect } from "@playwright/test";
import { createClients, driveToGameOver } from "./multi-helpers";

test("端到端联机对局:2 设备从头玩到终局,跨端同步", async ({ browser }) => {
  test.setTimeout(240_000);
  const { clients } = await createClients(browser, 2, { target: 3000 });
  const { actions, winner } = await driveToGameOver(clients);
  expect(winner).toBeTruthy();
  expect(actions).toBeGreaterThan(10); // 至少玩了 10 手
});
