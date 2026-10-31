// 选图弹层矮横屏钉底(#832):844×390 标准档首帧,确认/取消钮钉弹层可视底、
// 恒在视口内(审计 P0-1:按钮 y≈416-460 视口外、预览拦腰裁断,读作「弹层坏了」)。
// 哨兵式几何断言(react-popup-clamp 决策卷轴同口径):入场 scroll-anim-unroll
// 的瞬时盒由 toPass 吸收;点击型断言测不出滚出视口(Playwright 自动滚入遮蔽),
// 几何必须钉住;末尾补一次首帧位置实点,防「可见但被遮挡」的假绿。
// 入口走单机配置页「更换」:标准档首页挂的是 MapStrip 条带(#707 设计如此,
// 弹层不经首页),大厅入口与单机页共用本面板本体。
import { test, expect } from "./fixtures";
import { openSoloSetup } from "./react-helpers";
import { TID as SETUP_TID } from "../src/app/screens/setup/testids";

test.describe("选图弹层矮横屏钉底(#832)", () => {
  test.use({ viewport: { width: 844, height: 390 } });

  test("844×390 首帧:确认/取消/预览完整在视口内、预览不越 20vh、与拍板带不相交", async ({
    page,
  }) => {
    await page.goto("/");
    await openSoloSetup(page);
    await page.getByRole("button", { name: "更换" }).click();
    const panel = page.getByTestId(SETUP_TID.mapPanel);
    await expect(panel).toBeVisible();
    // 预选地图挂载即载预览(R3-A3),首帧即有预览可断
    await expect(page.getByTestId(SETUP_TID.mapPreview)).toBeVisible({ timeout: 10_000 });
    await expect(async () => {
      const shell = (await panel.boundingBox())!;
      // 壳夹高:86dvh 口径(390×0.86≈335.4;.5 容亚像素舍入)
      expect(shell.height).toBeLessThanOrEqual(390 * 0.86 + 0.5);
      const confirm = (await page.getByTestId(SETUP_TID.mapConfirm).boundingBox())!;
      const cancel = (await page.getByTestId(SETUP_TID.mapCancel).boundingBox())!;
      const preview = (await page.getByTestId(SETUP_TID.mapPreview).boundingBox())!;
      for (const [label, box] of [
        ["确认", confirm],
        ["取消", cancel],
        ["预览", preview],
      ] as const) {
        expect(box.x, `${label}左缘出视口`).toBeGreaterThanOrEqual(0);
        expect(box.y, `${label}上缘出视口`).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width, `${label}右缘出视口`).toBeLessThanOrEqual(844);
        expect(box.y + box.height, `${label}下缘出视口`).toBeLessThanOrEqual(390);
      }
      // 预览收幅 ≤20vh(#832:78px @390)
      expect(preview.height, "预览收幅超 20vh").toBeLessThanOrEqual(390 * 0.2 + 0.5);
      // 钉底带不得压住预览底缘(被盖住的预览不算完整可见)
      expect(confirm.y, "钉底带压住预览底缘").toBeGreaterThanOrEqual(
        preview.y + preview.height - 0.5,
      );
    }).toPass({ timeout: 5_000 });

    // 可点实证:首帧位置直接点确认,面板应关(几何断言防滚出视口,实点防遮挡)
    await page.getByTestId(SETUP_TID.mapConfirm).click();
    await expect(panel).toBeHidden();
  });
});
