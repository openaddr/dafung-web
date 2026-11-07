// 氛围层对位守卫(ADR-0039/0040):HTML 覆盖层装饰与 SVG 棋子槽位必须共用同一
// 世界→屏幕映射。背景:ambientMatrix 曾用 getBoundingClientRect(含 transform 视觉盒)
// 把祖先入场缩放烤进矩阵,装饰整体 1.12 倍错位固化——typecheck/build/单测/e2e 功能
// 断言全绿,纯视觉错位靠肉眼抓截图才定位(2026-10-31 实锤)。本例守该不变量:
//
//   间距比不变量:任取两枚棋子,其氛围层旗锚的屏幕间距 ÷ 棋子包围盒角点屏幕间距 ≈ 1。
//   (两点同受一个世界→屏幕映射,比值恒 1;矩阵系数错时比值=错误系数,与几何无关。)
//   #946 取景恒总览定格后,矩阵只在挂载/容器尺寸/换图/字体就绪重算、对局中恒量——
//   本例守静止态这一唯一形态的正确性(旧「滚轮缩放后再断一次」随平移缩放退役)。
//
// 对位走 data-amb-flag / data-token-player(非 testid 单源管辖:二者是引擎/动画层
// 的 DOM 契约钩子,非断言用 testid,check:e2e-testids 三类 flag 不覆盖此形态)。
import { test, expect } from "./fixtures";
import { freezeClock, quickStart, unfreezeClock } from "./react-helpers";

interface Measure {
  ratio: number | null; // 旗锚间距 ÷ 棋子间距(取相距最远的一对;null=旗锚不足两枚)
  pairDist: number; // 该对棋子角点间距(px)
  outside: string[]; // 旗锚落在自棋扩盒(×1.3)外的棋子 id(纯平移错位比值法抓不到,靠此条)
}

async function measure(page: import("@playwright/test").Page): Promise<Measure> {
  return page.evaluate(() => {
    const INFLATE = 0.3; // 扩盒系数:锚点本在盒内,矩阵错位(缩放/平移)会把远格旗锚挤出盒
    const tokens = [...document.querySelectorAll("[data-token-player]")].map((el) => ({
      id: el.getAttribute("data-token-player")!,
      r: el.getBoundingClientRect(),
    }));
    const flags = new Map(
      [...document.querySelectorAll("[data-amb-flag]")].map((el) => [
        el.getAttribute("data-amb-flag")!,
        el.getBoundingClientRect(),
      ]),
    );
    const outside: string[] = [];
    for (const t of tokens) {
      const f = flags.get(t.id);
      if (!f) continue;
      const mx = t.r.width * INFLATE;
      const my = t.r.height * INFLATE;
      if (f.x < t.r.x - mx || f.x > t.r.right + mx || f.y < t.r.y - my || f.y > t.r.bottom + my) {
        outside.push(t.id);
      }
    }
    const withFlag = tokens.filter((t) => flags.has(t.id));
    if (withFlag.length < 2) return { ratio: null, pairDist: 0, outside };
    // 取相距最远的一对(角点距离最大,抗小间距舍入噪声)
    let best = { a: withFlag[0], b: withFlag[0], dist: -1 };
    for (let i = 0; i < withFlag.length; i++) {
      for (let j = i + 1; j < withFlag.length; j++) {
        const d = Math.hypot(withFlag[j].r.x - withFlag[i].r.x, withFlag[j].r.y - withFlag[i].r.y);
        if (d > best.dist) best = { a: withFlag[i], b: withFlag[j], dist: d };
      }
    }
    const fa = flags.get(best.a.id)!;
    const fb = flags.get(best.b.id)!;
    const flagDist = Math.hypot(fb.x - fa.x, fb.y - fa.y);
    return {
      ratio: best.dist > 0 ? +(flagDist / best.dist).toFixed(4) : null,
      pairDist: Math.round(best.dist),
      outside,
    };
  });
}

/** 冻结态收敛等待:冻结后行军段消耗走 rAF 自终(新段才吃注入时钟),在途换装
 *  1~2s 内收会话,旗锚数必然收敛到=棋子数;不收敛=演出管线真断,当场炸出。 */
async function waitSettledFlags(page: import("@playwright/test").Page) {
  await page.waitForFunction(
    () =>
      document.querySelectorAll("[data-amb-flag]").length ===
      document.querySelectorAll("[data-token-player]").length,
    undefined,
    { timeout: 15_000, polling: 200 },
  );
}

test("氛围层装饰与棋子槽位像素对位(矩阵同步不变量,ADR-0039)", async ({ page }) => {
  test.slow(); // quickStart+冻结收敛,多次等待的预算余量(gesture 族同款)
  await quickStart(page);
  // 静止测量钉时钟:冻结后行军在途段走 rAF 自终,装饰收敛到全量在位再量
  // (不钉则 bot 行军换装期旗锚暂隐,量到半换装态=假挂;city-event 同款口径)。
  await freezeClock(page);
  await waitSettledFlags(page);

  // 静止态:间距比 ≈ 1(±3%:亚像素舍入在 ~200px 间距上 <1%),且全部锚点在自家扩盒内
  // #1181 诊断:满载下 waitSettledFlags 放行后仍有 ≤300ms 量级的瞬态未稳窗
  // (矩阵同步尾拍/换装回装的 ratio+outside 同帧违例,实测 10 轮满载 2 轮命中),
  // 单次取样会撞上——读数+断言整块包 toPass 在 expect 超时窗内轮询重试,
  // 读到稳定正确才算过;阈值与语义不变。
  await expect(async () => {
    const rest = await measure(page);
    expect(rest.ratio, "旗锚不足两枚(氛围层未渲染或换装态误判)").not.toBeNull();
    expect(rest.pairDist).toBeGreaterThan(50); // 取到的对必须真有间距,防全零坐标假绿
    expect(Math.abs(rest.ratio! - 1)).toBeLessThan(0.03);
    expect(rest.outside, `旗锚挤出自棋扩盒的棋子:${rest.outside.join(",")}`).toEqual([]);
  }).toPass();
  await unfreezeClock(page);
});
