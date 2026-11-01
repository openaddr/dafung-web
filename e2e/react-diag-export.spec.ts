// 诊断包导出冒烟(ADR-0047 帧诊通道):局中(不打完)开设置→点「性能诊断」→
// 下载 dafung-diag-*.json,载荷结构断言——设备画像/帧诊块/历史对局日志数组三段齐,
// kind/appVersion 归因字段真值。守住什么:导出通路 + 载荷 schema(消费端=判读表)。
// 对局日志本体完整性由 react-solo 终局导出例守,此处不重复。
import { readFileSync } from "node:fs";
import { test, expect } from "./fixtures";
import { quickStart, freezeClock } from "./react-helpers";
import { TESTIDS } from "../src/app/screens/game/testids";

test("局中导出诊断包:历史日志全量+帧诊+设备画像,不需打完(#973)", async ({ page }) => {
  test.slow();
  await quickStart(page);
  // 开自机托管把局面打成无人值守(购地/卷轴抉择自动放行——洪流推进到人类回合时
  // 决策模态罩住齿轮,click actionability 挂死;align spec 同款前置),再冻结消横幅。
  await page.getByTestId(TESTIDS.seatSelf).dispatchEvent("click");
  const sw = page.getByTestId(TESTIDS.seatPopAutopilot(0));
  await sw.waitFor({ timeout: 10_000 });
  if ((await sw.getAttribute("aria-checked")) !== "true") await sw.click();
  await page.keyboard.press("Escape");
  await freezeClock(page);
  await page.waitForTimeout(2500);
  await page.getByTestId(TESTIDS.settingsButton).click();
  const btn = page.getByTestId(TESTIDS.settingsDiagExport);
  await btn.waitFor({ timeout: 5_000 });
  const [download] = await Promise.all([page.waitForEvent("download"), btn.click()]);
  expect(download.suggestedFilename()).toMatch(/^dafung-diag-v[\d.]+\.(json)$/);
  const bundle = JSON.parse(readFileSync((await download.path())!, "utf-8"));
  expect(bundle.kind).toBe("dafung-diag");
  expect(bundle.schemaVersion).toBe(1);
  expect(String(bundle.appVersion)).toMatch(/^\d{4}\.\d{1,2}\.\d+$/); // CalVer
  expect(String(bundle.build)).toMatch(/^v\d{4}\./); // 构建戳(归因两把尺)
  expect(bundle.ua).toContain("Chrome"); // WebView/Chromium 画像
  // 帧诊块:对局屏挂载即采,此刻必有会话;LoAF 能力位如实(桌面 Chromium=true)
  expect(bundle.perf).not.toBeNull();
  expect(Array.isArray(bundle.perf.jank)).toBe(true);
  expect(bundle.perf.loafSupported).toBe(true);
  // 历史对局日志:quickStart 的本局(选都+掷骰推进)已增量归档,至少一局
  expect(Array.isArray(bundle.games)).toBe(true);
  expect(bundle.games.length).toBeGreaterThanOrEqual(1);
  expect(bundle.games[0].gameId).toBeTruthy();
});
