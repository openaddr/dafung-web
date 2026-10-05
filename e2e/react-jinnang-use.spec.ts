// 锦囊使用回路(#122/T2;#256 军师窗态迁移;#281 免战金牌退役改写;#305 整备):
// 军师幕弹窗退役,出牌面上架手牌架——点牌=选中放大(放大态即详情态),动作条「出牌」=
// 确认、「不出」=今不用,目标段=席位即靶(金圈呼吸+棋盘 token 呼吸,点席位即出免二次确认)。
// #281:免战金牌随档 1 退役(预防开盾删除),原「出牌经军师幕」用例改写为「识破诡计
// 经反应窗打出」——架中反应牌呼吸金边,点牌选中,横幅落印确认。
// #305 整备两件事:①出牌指示线用例自 jinnang-play-line.spec.ts 并入(出牌→墨线同一
// 交互链,原文件删除);②引擎断言下沉——结算/留痕/记账归引擎层单测
// (test/jinnang.test.ts、test/reaction-window.test.ts、test/hero-skill.test.ts),
// 本 spec 只留交互接线,断言全走可见 UI 态(选中/禁用/印条/窗收/牌离架)。
// 断言覆盖拍板口径:反应窗出牌回路、再点同牌取消选中、出牌钮禁用/启用、灰置牌原因印条、
// 多标签牌(缓兵之计)双章、名将技卡(主动技,#360 起 HeroCardFace 紧凑档)、作罢路径、出牌墨线端点对准。
// 种子 7 离线核算(真实引擎流程离线核算:含 doDraftRoll 骰流):人类先手、起手火烧连营
// (开局军师窗=稳定停靠点)。不走 pickCapital 共享助手(其收尾会自动「不出」),本 spec
// 自行点城+确认以保留窗态。灰置/技卡局面走 force 引擎直写(#237 无天然种子同时凑齐)。
// 反应窗时长走 E2E_TIME_SCALE 缩放:本 spec 后挂 init 脚本把倍率提到 0.5(窗 1500ms,
// 点选从容;useHalfScale 共享助手);fixtures 先注入 0.25,后挂脚本覆盖同键。
import { test, expect } from "./fixtures";
import {
  force,
  waitMyRollDone,
  openSoloSetup,
  skipUntilNextSeat,
  useHalfScale,
  plantDemolishableCity,
} from "./react-helpers";
import { TESTIDS } from "../src/app/screens/game/testids";
import type { Page } from "@playwright/test";

async function startJunshi(page: Page, seed: number): Promise<void> {
  await useHalfScale(page);
  await page.goto(`/?seed=${seed}`);
  // 显式选图(#147 后地图是骰流变量):残留 localStorage 地图会改变候选城/发牌序列
  await page.getByTestId("home-select-map").click();
  await page.getByTestId("map-item-sanguo").click();
  await page.getByTestId("map-confirm").click();
  await openSoloSetup(page);
  await page.getByTestId("start-game").click();
  await page.locator(".bv-tile.bv-selectable").first().click();
  await page.getByTestId("confirm-capital-ok").click();
  // 军师窗态:动作条(卡牌段)就位 = 停稳在开局窗态
  await expect(page.getByTestId(TESTIDS.actionbar)).toBeVisible();
}

/** 给 bot 1 挪一座 1 级非都城(原 jinnang-play-line.spec.ts 随迁,#305):火烧连营的
 *  目标守卫(demolishTargetOk)要求「有 Lv>0 可降或有非都城城」,开局各座只有都城
 *  不达标——不种则目标段无候选席位。 */
async function plantBotCity(page: Page): Promise<void> {
  await force(
    page,
    `
    {
      const capitals = new Set(e.players.map((p) => p.capitalIndex));
      let idx = -1;
      for (let k = 1; k < e.board.count - 1; k++) {
        const c = (e.players[0].capitalIndex + k) % e.board.count;
        const t = e.board.at(c);
        if (t?.propertyId && !capitals.has(c) && !e.findOwner(t.propertyId)) { idx = c; break; }
      }
      if (idx < 0) throw new Error("种植失败:无可挪城池格");
      const pid = e.board.at(idx).propertyId;
      e.players[1].properties.push({
        propertyId: pid, group: e.board.at(idx).group ?? "a",
        purchasePrice: 1000, level: 1, maxLevel: 3,
      });
    }
  `,
  );
}

test.describe("锦囊使用回路(T2,军师窗态;#281 识破诡计反应窗)", () => {
  test("seed7 识破诡计:架上金边→点选/再点取消→落印→窗收牌耗", async ({ page }) => {
    await startJunshi(page, 7);
    // 种植:人类改持识破诡计 + 一座可失之城;bot 全持火烧连营(首个行动 bot 回合开始即出)
    await plantDemolishableCity(page);
    await force(
      page,
      `
      e.players[0].jinnangHand = ["识破诡计"];
      for (let i = 1; i < e.players.length; i++) e.players[i].jinnangHand = ["火烧连营"];
    `,
    );
    await page.getByTestId(TESTIDS.actionbarPass).click();
    await waitMyRollDone(page, 0);
    await skipUntilNextSeat(page, 0);
    // 反应窗:架上识破诡计呼吸金边(.reactive);横幅就位
    const banner = page.getByTestId(TESTIDS.reactionBanner);
    await expect(banner).toBeVisible();
    await expect(banner.getByTestId(TESTIDS.reactionText)).toContainText("使用【火烧连营】");
    const card = page.getByTestId(TESTIDS.jinnangCard("识破诡计"));
    await expect(card).toHaveClass(/reactive/);
    const confirm = banner.getByTestId(TESTIDS.reactionConfirm);
    // 点牌=选中(.sel,落印点亮);再点同牌=取消选中(选中可逆,落印回禁用)
    await card.click();
    await expect(card).toHaveClass(/sel/);
    await expect(confirm).toBeEnabled();
    await card.click();
    await expect(card).not.toHaveClass(/sel/);
    await expect(confirm).toBeDisabled();
    // 重新选中 → 落印确认(墨钮):窗收、牌离架(#305 引擎断言下沉:双牌皆耗与留痕
    // 归 test/reaction-window.test.ts「识破自保生效」钉死)
    await card.click();
    await confirm.click();
    await expect(banner).toBeHidden();
    await expect(page.getByTestId(TESTIDS.jinnangCard("识破诡计"))).toHaveCount(0);
  });

  test("seed7 不出直发:窗放行、牌留架(#188 自动行军接棒)", async ({ page }) => {
    await startJunshi(page, 7);
    // 直写钉牌(UI 选都路径的发牌与离线演算路径可能差一位骰流,钉牌免漂移)
    await force(page, `e.players[0].jinnangHand = ["火烧连营"];`);
    // 「不出」:窗收(卡牌段离场),架常驻、牌仍在(不消耗;手牌记账归引擎层,
    // 放行后自动起摇由 #188 通行链路全程走通——waitMyRollDone 家族全依赖它)
    await page.getByTestId(TESTIDS.actionbarPass).click();
    await expect(page.getByTestId(TESTIDS.actionbarPass)).toBeHidden();
    await expect(page.getByTestId(TESTIDS.jinnangCard("火烧连营"))).toBeVisible();
  });

  test("求贤令:点牌→出牌点亮→出牌牌离架", async ({ page }) => {
    await startJunshi(page, 7);
    await force(page, `e.players[0].jinnangHand = ["求贤令"];`);
    const opt = page.getByTestId(TESTIDS.jinnangCard("求贤令"));
    await expect(opt).toBeVisible();
    await opt.click();
    const play = page.getByTestId(TESTIDS.actionbarPlay);
    await expect(play).toBeEnabled(); // 点牌只选中,出牌点亮
    await play.click();
    // 出牌 → 牌离架(消耗的 UI 表达;招贤/折现结算与战报公开留痕归 test/jinnang.test.ts)
    await expect(opt).toHaveCount(0);
  });

  test("军情密探:出牌进目标段,候选席位金圈呼吸,点席位即出(免二次确认)", async ({ page }) => {
    await startJunshi(page, 7);
    // 先停稳在开局军师窗态再引擎直写:发牌在进 Playing 时落账,直写抢跑会被发牌覆盖。
    // 军情密探目标门槛=对方有珍宝:给 seat1 挂一件,目标段才有可用候选。
    await force(
      page,
      `
      e.players[1].treasures = [{ id: "gem-1", name: "夜明珠", level: 5 }];
      e.players[0].jinnangHand = ["军情密探"];
    `,
    );
    const opt = page.getByTestId(TESTIDS.jinnangCard("军情密探"));
    await expect(opt).toBeVisible();
    await opt.click();
    await page.getByTestId(TESTIDS.actionbarPlay).click();
    // 目标段:动作条切「选择目标/作罢」;候选席位卡金圈呼吸 + 棋盘 token 呼吸挂点
    await expect(page.getByTestId(TESTIDS.actionbarTarget)).toBeVisible();
    await expect(page.getByTestId("seat-1")).toHaveClass(/candidate/);
    await expect(page.locator(".bv-token-target-ring")).not.toHaveCount(0);
    // 点席位即出(免二次确认):目标段收、牌离架(#305:窥探结算与回收记账归
    // test/jinnang.test.ts「军情密探·窥探」)
    await page.getByTestId(TESTIDS.seatTarget(1)).click();
    await expect(page.getByTestId(TESTIDS.actionbarTarget)).toBeHidden();
    await expect(opt).toHaveCount(0);
  });

  test("军情密探作罢:目标段收回,回卡牌段选中清空、牌未消耗", async ({ page }) => {
    await startJunshi(page, 7);
    await force(
      page,
      `
      e.players[1].treasures = [{ id: "gem-1", name: "夜明珠", level: 5 }];
      e.players[0].jinnangHand = ["军情密探"];
    `,
    );
    const opt = page.getByTestId(TESTIDS.jinnangCard("军情密探"));
    await opt.click();
    await page.getByTestId(TESTIDS.actionbarPlay).click();
    await expect(page.getByTestId(TESTIDS.actionbarTarget)).toBeVisible();
    // 作罢:目标段收回,回到卡牌段窗态(#305:不消耗/不记冷却的记账归引擎层单测)
    await page.getByTestId(TESTIDS.actionbarCancel).click();
    const play = page.getByTestId(TESTIDS.actionbarPlay);
    await expect(play).toBeVisible();
    await expect(play).toBeDisabled(); // 选中已清空(进/出目标段即清空重选)
    await expect(opt).toBeVisible(); // 牌回卡牌段(作罢语义的 UI 面)
  });

  test("灰置牌印条/多标签双章/技卡:双标签占额灰置、技卡选中→出牌发技转灰置", async ({ page }) => {
    await startJunshi(page, 7);
    // 引擎直写(停稳已由 startJunshi 保证):缓兵之计(谋+攻)双标签名额已被占 →
    // 灰置带原因印条;麾下给真实主动技(张星彩·擂鼓,target=none,无冷却)→ 技卡可用可发;
    // 求贤令(援,标签未占)= 可用对照组。
    await force(
      page,
      `
      e.players[0].jinnangHand = ["缓兵之计", "求贤令"];
      e.jinnangUsedTags = ["谋", "攻"];
      e.players[0].heroes = [{ id: "zhangxingcai", name: "张星彩", title: "", desc: "", image: "", skills: [],
        active: { id: "zhangxingcai-leigu", name: "擂鼓", cooldown: 4,
          desc: "擂鼓进军:本回合你的下一次掷骰步数 +2(签面不变)。",
          target: "none", kind: "warDrum", params: { bonus: 2 } } }];
    `,
    );
    // 灰置牌:下沉置灰(.off)+ 双标签章竖排 + 原因印条文案可见;不可选中(浏览器禁用契约)
    const huan = page.getByTestId(TESTIDS.jinnangCard("缓兵之计"));
    await expect(huan).toBeVisible();
    await expect(huan).toBeDisabled();
    await expect(huan.locator(".jinnang-card")).toHaveClass(/off/);
    await expect(huan.locator(".seal")).toHaveCount(2); // 多标签:谋+攻 章竖排双挂
    await expect(huan.locator(".reason")).toHaveText("本回合已用过〔谋〕〔攻〕");
    // 可用牌照常
    await expect(page.getByTestId(TESTIDS.jinnangCard("求贤令"))).toBeEnabled();
    // 名将技卡(#360 换 HeroCardFace 紧凑档):技名 chips(◆擂鼓+●掷金=被动技名,T1
    // 数据)/名将名上卡面;点选=选中(.sel 挂卡面根),出牌点亮→发技(useHeroSkill)
    const ji = page.getByTestId(TESTIDS.jinnangCard("skill:zhangxingcai-leigu"));
    await expect(ji).toBeVisible();
    await expect(ji.locator(".hface")).toContainText("擂鼓");
    await expect(ji.locator(".hface")).toContainText("掷金"); // 被动技名(TriggerSkill.name)
    await expect(ji.locator(".hface")).toContainText("张星彩");
    await ji.click();
    await expect(ji.locator(".hface")).toHaveClass(/sel/);
    await page.getByTestId(TESTIDS.actionbarPlay).click();
    // 发技 → 技卡转灰置并亮引擎原因(#305:冷却记账归 test/hero-skill.test.ts,UI 只读
    // choices 展示;求贤令仍可用 → 相位留在军师窗态,settleJinnangExit 口径)
    await expect(ji.locator(".hface")).toHaveClass(/off/);
    await expect(ji.locator(".reason")).toHaveText("冷却中(还差 4 轮)");
  });
});

// ───────────────────────── 出牌指示线(#281 P2-E;#305 自 jinnang-play-line 并入)─────────────────────────
// 军师幕出牌后(#256 后出牌面=手牌架),棋盘出现「使用者 token → 目标 token」水墨墨线
// (fx-svg-jline,BoardFxLayer 渲染进 #bv-fx;三段 CSS 动画 200ms 生长 → 200ms 停持 →
// 300ms 淡出,store 清理窗随 E2E_TIME_SCALE 缩放)。指示线是条件性在场的瞬态元素:禁
// locator 读(缺元素会挂到超时),全程单次 page.evaluate 内 rAF 轮询原子采样(仓库既有
// 口径,#272)。出牌线因果由事件批直读(#385 event-extract:单机 engine.gameEvents 与
// 联机下行批同一直译函数,jinnangAnnounced/jinnangVoided/reactionAnswered → 同一
// jinnangPlayed 表现事件);反应窗出牌(识破/拦停)的联机端同款线归 react-reaction-online。
test.describe("出牌指示线(#281 P2-E)", () => {
  test("火烧连营指定目标后,棋盘出现使用者→目标墨线,端点对准双方棋子", async ({ page }) => {
    await startJunshi(page, 7);
    // 种植:人类持火烧连营 + bot 1 有一座可拆城;清他座反应牌(不开反应窗,线在宣告点即出)
    await plantBotCity(page);
    await force(
      page,
      `
      e.players[0].jinnangHand = ["火烧连营"];
      e.players[0].jinnangHandCount = 1;
      for (let i = 1; i < e.players.length; i++) {
        e.players[i].jinnangHand = e.players[i].jinnangHand.filter(
          (id) => id !== "识破诡计" && id !== "半路杀出");
        e.players[i].jinnangHandCount = e.players[i].jinnangHand.length;
      }
    `,
    );
    await expect(page.getByTestId(TESTIDS.jinnangCard("火烧连营"))).toBeEnabled();
    // 点牌选中 → 出牌进目标段 → 席位点层点候选目标(点席位即出,免二次确认)
    await page.getByTestId(TESTIDS.jinnangCard("火烧连营")).click();
    await page.getByTestId(TESTIDS.actionbarPlay).click();
    const targetBtn = page.locator('[data-testid^="seat-target-"]').first();
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
    await targetBtn.click();
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
