// 诊断包导出冒烟(帧诊通道 ADR-0047,修订版):入口在主页,不绑对局屏——进一局、
// 弃局回主页、主页点「性能诊断」即下 `dafung-diag-<发版号>.json`。断言三段:设备画像
// 归因字段真值 / 帧诊=最近一局定格(弃局退出后仍非空,跨屏存活)/ IndexedDB 历史对局
// 日志全量(未打完的局也在)。守住什么:导出通路 + 载荷 schema + 停采定格语义。
// 对局日志本体完整性由 react-solo 终局断言守(胜利屏本体),此处不重复。
import { readFileSync } from "node:fs";
import { test, expect } from "./fixtures";
import { quickStart } from "./react-helpers";
import { TESTIDS } from "../src/app/screens/game/testids";
import { HOME_TID } from "../src/app/screens/home/testids";

test("退出对局后主页导出诊断包:历史日志全量+最近一局帧诊(#973)", async ({ page }) => {
  test.slow();
  await quickStart(page);
  // 开自机托管:洪流推进到人类回合时购地模态会罩住齿轮(决策模态全屏,click
  // actionability 挂死;align spec 同款前置)。托管后无人值守,弃局路径稳定。
  await page.getByTestId(TESTIDS.seatSelf).dispatchEvent("click");
  const sw = page.getByTestId(TESTIDS.seatPopAutopilot(0));
  await sw.waitFor({ timeout: 10_000 });
  if ((await sw.getAttribute("aria-checked")) !== "true") await sw.click();
  await page.keyboard.press("Escape");
  // 弃局回主页:设置 → 回到主页 → 确认(帧诊随对局屏卸载定格,历史日志早已增量归档)
  await page.getByTestId(TESTIDS.settingsButton).click();
  await page.getByTestId(TESTIDS.settingsHome).click();
  await page.getByRole("button", { name: "弃局回主页" }).click();
  await page.getByTestId(HOME_TID.screen).waitFor({ timeout: 10_000 });
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByTestId(HOME_TID.diagExport).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^dafung-diag-\d{4}\.\d{1,2}\.\d+\.json$/);
  const bundle = JSON.parse(readFileSync((await download.path())!, "utf-8"));
  expect(bundle.kind).toBe("dafung-diag");
  expect(bundle.schemaVersion).toBe(1);
  expect(String(bundle.appVersion)).toMatch(/^\d{4}\.\d{1,2}\.\d+$/); // CalVer 发版号(#952 起 build 字段退役)
  expect(bundle.ua).toContain("Chrome"); // WebView/Chromium 画像
  // 帧诊=最近一局定格(跨屏存活):弃局退出后仍非空,stoppedAt 已落
  expect(bundle.perf).not.toBeNull();
  expect(bundle.perf.stoppedAt).not.toBeNull();
  expect(Array.isArray(bundle.perf.jank)).toBe(true);
  expect(bundle.perf.loafSupported).toBe(true); // 桌面 Chromium 支持 LoAF
  // 历史对局日志:弃局的本局已增量归档,至少一局
  expect(Array.isArray(bundle.games)).toBe(true);
  expect(bundle.games.length).toBeGreaterThanOrEqual(1);
  expect(bundle.games[0].gameId).toBeTruthy();
});
