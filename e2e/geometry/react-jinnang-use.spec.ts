// 地板名册(ADR-0062):地板·几何钉×2(异将同名=#817 载体装配拍板点名钉;出牌墨线=rAF 采样端点对准几何);可迁移余量×6 已随 #1315/#1317/#1318 迁尽
// 锦囊使用回路(#122/T2;#256 出牌阶段态迁移;#281 免战金牌退役改写;#305 整备;
// #417 目标选择统一)——**#1317 批T3 后本 spec 只余名册地板两例**:异将同名(#817
// 载体装配拍板点名钉:真渲染才抓得住的载体件归将断言)与出牌墨线(rAF 采样端点对准
// 几何,单次 evaluate 原子采样);可迁移余量 6 例(点选/取消、不出直发、求贤令点选、
// 目标段两步、作罢、灰置印条/多标签双章/技能卡)已下放接线层
// `test/wiring/battle-wiring.test.tsx`(ADR-0062 层④,断言面=DOM/store 语义),判词见该
// 文件头注。结算/留痕/记账归引擎层单测(test/jinnang.test.ts、
// test/reaction-window.test.ts、test/hero-skill.test.ts),本 spec 只留真渲染钉。
// 种子复算(#949 换图重钉;seed 67 × 关中图,进程内直扫复算):人类先手
// (draftOrder=[0,3,2,1]),选都候选取 DOM 首格=0 长安(bot 都:诸侯2=10 长沙、
// 诸侯3=20 卧龙岗、诸侯4=3 辽东),起手求贤令(自身域恒可用)
// → **开局出牌阶段=稳定停靠点保留**。到站形制(#1256 对账,ADR-0058 种局式直通):
// startJunshi 前置链=quickStart stopAtOpeningHand(seedSolo 桥路)——桥路与旧 UI 链
// 同 seed 同局(registry 选都口径统一:两路同 seed 必须同局),且 waitMyPause 不代发放行
// (其头注:AwaitingJinnang 本身就是合法停靠点)。两例均非旅程例(前门=react-setup/
// home-strip/tutorial 脊柱①⑤),种局式直通是本族应答。
// 种植判词归一(#1295):塞指定锦囊=giveJinnang #1298,挪城/授将=grantProperty/
// armHero #1300,判词单源 src/core/planter.ts 头注;断言链的操作段全真,前置种植只造
// 「断言面需要的牌形/布场」。
import { test, expect } from "../fixtures";
import { quickStart, snap, engineState, useHalfScale } from "../react-helpers";
import { plant } from "../helpers/drivers";
import { TESTIDS } from "../../src/app/screens/game/testids";
import type { Page } from "@playwright/test";
// 反应窗时长走 E2E_TIME_SCALE 缩放:本 spec 后挂 init 脚本把倍率提到 0.5(窗 1500ms,
// 点选从容;useHalfScale 共享助手);fixtures 先注入 0.25,后挂脚本覆盖同键。

async function startJunshi(page: Page, seed: number): Promise<void> {
  await useHalfScale(page);
  // 种局式直通到站(#1256,判词见头注):同 seed 同局停开局出牌阶段态,窗态保留。
  await quickStart(page, seed, { mapId: "guanzhong", stopAtOpeningHand: true });
  // 出牌阶段态:动作条(卡牌段)就位 = 停稳在开局窗态(seed 67 起手求贤令恒可用,窗必升起)
  await expect(page.getByTestId(TESTIDS.actionbar)).toBeVisible();
}

/** 给 bot 1 挪一座 1 级非都城(#305 自 jinnang-play-line 并入):火烧连营的
 *  目标守卫(demolishTargetOk)要求「有 Lv>0 可降或有非都城城」,开局各座只有都城
 *  不达标——不种则目标段无候选席位。
 *  #1300 收编:授城走 grantProperty 种植件(判词单源 src/core/planter.ts:引擎无授城
 *  公共命令,购地命令受行军路线+现金约束到不了指定格指定级;选址=测试侧读现值,
 *  种植件只收终态行),断言面需「bot 名下恰有一座可拆城」。 */
async function plantBotCity(page: Page): Promise<void> {
  const pid: string = await engineState(
    page,
    `(() => {
    const capitals = new Set(e.players.map((p) => p.capitalIndex));
    for (let k = 1; k < e.board.count - 1; k++) {
      const c = (e.players[0].capitalIndex + k) % e.board.count;
      const t = e.board.at(c);
      if (t.propertyId && !capitals.has(c) && !e.findOwner(t.propertyId)) return t.propertyId;
    }
    throw new Error("种植失败:无可挪城池格");
  })()`,
  );
  await plant(page, {
    kind: "grantProperty",
    seat: 1,
    propertyId: pid,
    level: 1,
  });
}

test.describe("锦囊使用回路(T2,出牌阶段态;#1317 批T3 后=名册地板两例)", () => {
  // 真实段:呈现态断言(同名技双卡独立实例 id、卡面载体件各归各将、他将不上卡)——
  // 无操作链,布场后的真实渲染即被测环。#817 载体装配拍板点名钉:三层全绿漏网、只有
  // 真渲染抓得住的真 bug 钉(ADR-0062 迁移判据判例),永留浏览器。麾下将经 armHero
  // 种植件(#1300,判词单源 src/core/planter.ts:无授将公共通路,招贤命令到不了
  // 「两槽各持指定技」,实授子集由 skillIds 显式给定);钉 AwaitingJinnang 走 armPhase
  // (#1301,判词单源 src/core/planter.ts:断言前提(出牌窗态),引擎自转无「钉相位」
  // 公共命令)。
  test("异将同名技载体可辨:周瑜/张星彩各持擂鼓,两张擂鼓卡同名同技、载体各归各将", async ({
    page,
  }) => {
    await startJunshi(page, 67);
    // 种植:两槽各持擂鼓(同名技跨将互为独立实例,#817 选项 id=skill:<heroId>:
    // <skillId> → 两张卡不合并);张星彩槽的掷金是被动(DieRolled,无牌形)只作池填充,
    // 出牌窗即「横征暴敛 + 周瑜火攻 + 两张擂鼓」的混排架。
    await plant(page, {
      kind: "armHero",
      seat: 0,
      heroId: "zhouyu",
      skillIds: ["huogong", "leigu"],
    });
    await plant(page, {
      kind: "armHero",
      seat: 0,
      heroId: "zhangxingcai",
      skillIds: ["zhijin", "leigu"],
    });
    await plant(page, { kind: "armPhase", turnPhase: "AwaitingJinnang" });
    // 实例 id 各归各槽(#817),同名技 = 两张独立卡
    const leiZy = page.getByTestId(TESTIDS.jinnangCard("skill:zhouyu:leigu"));
    const leiZx = page.getByTestId(TESTIDS.jinnangCard("skill:zhangxingcai:leigu"));
    await expect(leiZy).toBeVisible();
    await expect(leiZx).toBeVisible();
    // 主技名同为「擂鼓」:同名半边——卡面文字层面两卡不可凭技名区分
    await expect(leiZy.locator(".zhang-ming")).toHaveText("擂鼓");
    await expect(leiZx.locator(".zhang-ming")).toHaveText("擂鼓");
    // 载体可辨半边:全将通有的载体件(画心立绘/名带/称号签)各显各将,异将同名技凭
    // 载体一眼分账。
    await expect(leiZy.locator(".lihui img")).toHaveAttribute(
      "src",
      "/assets/heroes/hero-zhouyu-sgs.png",
    );
    await expect(leiZx.locator(".lihui img")).toHaveAttribute(
      "src",
      "/assets/heroes/hero-zhangxingcai-sgs.png",
    );
    await expect(leiZy.locator(".m-name")).toHaveText("周瑜");
    await expect(leiZx.locator(".m-name")).toHaveText("张星彩");
    await expect(leiZy.locator(".hface")).not.toContainText("张星彩"); // 他将不上卡
    await expect(leiZx.locator(".hface")).not.toContainText("周瑜");
  });
});

// ───────────────────────── 出牌指示线(#281 P2-E;#305 自 jinnang-play-line 并入)─────────────────────────
// 出牌阶段出牌后(#256 后出牌面=手牌架),棋盘出现「使用者 token → 目标 token」水墨墨线
// (fx-svg-jline,BoardFxLayer 渲染进 #bv-fx;三段 CSS 动画 200ms 生长 → 200ms 停持 →
// 300ms 淡出,store 清理窗随 E2E_TIME_SCALE 缩放)。指示线是条件性在场的瞬态元素:禁
// locator 读(缺元素会挂到超时),全程单次 page.evaluate 内 rAF 轮询原子采样(仓库既有
// 口径,#272)——**rAF 泵+端点几何=接线层禁面(ADR-0062 断言宪法),本例永留浏览器**。
// 出牌线因果由事件批直读(#385 event-extract:单机 engine.gameEvents 与
// 联机下行批同一直译函数,jinnangAnnounced/jinnangVoided/reactionAnswered → 同一
// jinnangPlayed 表现事件);反应窗出牌(识破/拦停)的联机端同款线归 react-reaction-online。
test.describe("出牌指示线(#281 P2-E)", () => {
  // 真实段:出牌目标两步链(点席位选中→「出」确认打出)与墨线端点对准几何全真
  // (rAF 原子采样对引擎现算坐标)。手牌无公共通路需火烧牌形;挪城判词见
  // plantBotCity(无授城公共命令,需 bot 名下可拆城);清他座反应牌=防窗控制走
  // giveJinnang 终态组合(见下内联判词)。
  test("火烧连营指定目标后,棋盘出现使用者→目标墨线,端点对准双方棋子", async ({ page }) => {
    await startJunshi(page, 67);
    // 种植:人类持火烧连营 + bot 1 有一座可拆城(plantBotCity 挪 +1 晋阳@1,挪入 level 1)。
    await plantBotCity(page);
    await plant(page, { kind: "giveJinnang", seat: 0, cards: ["火烧连营"] });
    // 清他座反应牌(不开反应窗,线在宣告点即出)=防窗控制(#1301 判词选择):读现值
    // 滤反应牌后走 giveJinnang 终态组合(handCount 随件重灌)——语义是「去指定牌」
    // 而非「给指定牌」,但终态件已能表达,不另设 kind。
    const hands = (await snap(page)).players as { jinnangHand: string[] }[];
    for (let seat = 1; seat < hands.length; seat++) {
      const rest = hands[seat]!.jinnangHand.filter((id) => id !== "识破诡计" && id !== "半路杀出");
      await plant(page, { kind: "giveJinnang", seat, cards: rest });
    }
    await expect(page.getByTestId(TESTIDS.jinnangCard("火烧连营"))).toBeEnabled();
    // 点牌选中 → 出牌进目标段 → 席位点层点候选目标选中 → 动作条「出」确认打出(#417 两步)
    await page.getByTestId(TESTIDS.jinnangCard("火烧连营")).click();
    await page.getByTestId(TESTIDS.actionbarPlay).click();
    // 目标段按 seats 全量装配(#417 口径:不可指定席也列槽)——#751 C 批起不可选槽
    // 不再 disabled(死区点按=轻晃+弹层 reason 印条),改 aria-disabled 挂点:
    // seat-target-0=自机槽恒不可选(不能指定自己),裸 `.first()` 命中它空转到
    // 超时(W4 实锤);候选=可选槽,首个即可(种植保证 bot 1 有可拆城)。
    const targetBtn = page
      .locator('[data-testid^="seat-target-"]:not([aria-disabled="true"])')
      .first();
    await expect(targetBtn).toBeVisible({ timeout: 15_000 });
    const targetTestid = await targetBtn.getAttribute("data-testid");
    const targetSeat = Number(targetTestid?.replace("seat-target-", ""));
    expect(Number.isInteger(targetSeat)).toBe(true);

    // 单次 evaluate 原子采样:rAF 轮询等指示线现身,现身即在同一样本里取端点并
    // 从引擎现算期望坐标(火烧连营不动人,出牌前后棋盘坐标一致)。15s 封顶防死等。
    const samplePromise = page.evaluate(`(async () => {
      const deadline = performance.now() + 15000;
      let el = null;
      while (performance.now() < deadline) {
        el = document.querySelector("[data-fx-jinnang-line]");
        if (el) break;
        await new Promise((r) => requestAnimationFrame(r));
      }
      const e = window.__dafung.getEngine();
      if (!el) return { found: false };
      const b = e.board;
      return {
        found: true,
        x1: Number(el.getAttribute("x1")),
        y1: Number(el.getAttribute("y1")),
        x2: Number(el.getAttribute("x2")),
        y2: Number(el.getAttribute("y2")),
        from: b.positionOf(e.players[0].position),
        to: b.positionOf(e.players[${targetSeat}].position),
      };
    })()`);
    // #417 两步:点席位只选中,动作条「出」钮才打出(墨线在打出后现身,sample 轮询覆盖)
    await targetBtn.click();
    await page.getByTestId(TESTIDS.actionbarTarget).click();
    const sample = (await samplePromise) as {
      found: boolean;
      x1?: number;
      y1?: number;
      x2?: number;
      y2?: number;
      from?: { x: number; y: number };
      to?: { x: number; y: number };
    };
    expect(sample.found).toBe(true);
    // 端点对准:起点=使用者格,终点=被指定者格
    expect(sample.x1).toBe(sample.from!.x);
    expect(sample.y1).toBe(sample.from!.y);
    expect(sample.x2).toBe(sample.to!.x);
    expect(sample.y2).toBe(sample.to!.y);
    // 收尾:对局继续推进(bot 回合接棒),不留悬窗——等人类下一决策点出现即可
    await expect
      .poll(async () => page.evaluate(`window.__dafung.getEngine().turnPhase`), { timeout: 30_000 })
      .not.toBe("AwaitingJinnang");
  });
});
