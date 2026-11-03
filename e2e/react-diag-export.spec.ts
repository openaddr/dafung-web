// 诊断包导出冒烟(帧诊通道 ADR-0047,#1053 双包版):入口在主页,不绑对局屏——
// 进一局、弃局回主页、主页点「性能诊断」开导出面板。面板三通路分平台:
//   复制帧诊(小包,帧诊+画像+省略局数)= Tauri/APK 主通路——全量包在安卓剪贴板
//   限长拒收+textarea 回退冻结主线程(真机「点了没反应+弹层关不掉」#1053 实锤);
//   复制全量 = 桌面剪贴板(大串走 Clipboard API);
//   下载文件 = 浏览器通路(Tauri 内不出现该钮)。
// 守住什么:三导出通路 + 载荷 schema(小包 gamesOmitted 语义/全量 games 真值)+
// 停采定格语义(弃局退出后 perf 仍非空)+ 显式关闭钮。对局日志本体完整性由
// react-solo 终局断言守,此处不重复。
import { readFileSync } from "node:fs";
import { test, expect } from "./fixtures";
import { quickStart } from "./react-helpers";
import { TESTIDS } from "../src/app/screens/game/testids";
import { HOME_TID } from "../src/app/screens/home/testids";

test("退出对局后主页导出诊断包:帧诊小包+全量复制+文件下载三通路(#973/#1053)", async ({
  page,
  context,
}) => {
  test.slow();
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
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

  // 通路一:帧诊小包(面板构建 → 写剪贴板 → 读回验载荷与省略数语义)
  await page.getByTestId(HOME_TID.diagExport).click();
  await page.getByTestId(HOME_TID.diagSheet).waitFor();
  await page.getByTestId(HOME_TID.diagCopy).click();
  await page.getByTestId(HOME_TID.diagSheet).getByText("已复制").waitFor();
  const perfJson = await page.evaluate(() => navigator.clipboard.readText());
  const perf = JSON.parse(perfJson);
  expect(perf.kind).toBe("dafung-diag");
  expect(String(perf.appVersion)).toMatch(/^\d{4}\.\d{1,2}\.\d+$/); // CalVer 发版号(#952 起 build 字段退役)
  expect(perf.ua).toContain("Chrome"); // WebView/Chromium 画像
  // 帧诊=最近一局定格(跨屏存活):弃局退出后仍非空,stoppedAt 已落
  expect(perf.perf).not.toBeNull();
  expect(perf.perf.stoppedAt).not.toBeNull();
  expect(perf.perf.loafSupported).toBe(true); // 桌面 Chromium 支持 LoAF
  // 小包语义:日志省略,省略数如实(gamesOmitted≥1=弃局的本局已增量归档)
  expect(Array.isArray(perf.games)).toBe(true);
  expect(perf.games.length).toBe(0);
  expect(perf.gamesOmitted).toBeGreaterThanOrEqual(1);
  // 显式关闭钮(#1053:真机点外被冻结期遮蔽的兜面)
  await page.getByTestId(HOME_TID.diagClose).click();
  await expect(page.getByTestId(HOME_TID.diagSheet)).toBeHidden();

  // 通路二:全量复制(桌面剪贴板;games 真值,无省略字段)
  await page.getByTestId(HOME_TID.diagExport).click();
  await page.getByTestId(HOME_TID.diagCopyFull).click();
  await page.getByTestId(HOME_TID.diagSheet).getByText("已复制").waitFor();
  const full = JSON.parse(await page.evaluate(() => navigator.clipboard.readText()));
  expect(Array.isArray(full.games)).toBe(true);
  expect(full.games.length).toBeGreaterThanOrEqual(1);
  expect(full.games[0].gameId).toBeTruthy();
  expect(full.gamesOmitted).toBeUndefined(); // 全量包未省略
  await page.getByTestId(HOME_TID.diagClose).click();
  await expect(page.getByTestId(HOME_TID.diagSheet)).toBeHidden();

  // 通路三:文件下载(浏览器面;Tauri 内无此钮——面板按 __TAURI_INTERNALS__ 分派)
  await page.getByTestId(HOME_TID.diagExport).click();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByTestId(HOME_TID.diagDownload).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^dafung-diag-\d{4}\.\d{1,2}\.\d+\.json$/);
  const file = JSON.parse(readFileSync((await download.path())!, "utf-8"));
  expect(file.kind).toBe("dafung-diag");
  expect(file.games.length).toBe(full.games.length); // 同一归档,两通路一致
});
