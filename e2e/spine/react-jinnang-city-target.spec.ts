// 地板名册(ADR-0062):脊柱补例×3(#1389 T3 棒2 锦囊城目标段选城回路钉+识破城份 e2e)。
// 判层自查:候选点亮(Tile data-city-target 标记)与选中实金停持环是真渲染视觉态(层④
// 禁像素/演出泵/几何,无真值);选火烧连营→点亮→点选/改选→动作条「出」→jinnangFireWall
// 逐城战报是「点击→命令→UI 更新」的完整回路(新交互首例,脊柱补例惯例),永留浏览器;
// 识破链=窗点牌→城份令牌选城→落印→「这一城免烧」战报+余城照烧,是真命令链结算面
// (respondReaction share=城格过帐)。布景=种植件(giveJinnang/grantProperty/armPhase/
// armReaction/pinDice,判词单源 src/core/planter.ts:手牌终态/授城/相位/凭空开窗/钉骰),
// 断言链操作段全真;候选=choices 城选项单源(fireWallCenterTargets),UI 只装配,本 spec
// 不自算谓词(计数读引擎板面真值,不镜像候选算式)。
// 截图 4 张随跑落 tmp/ui-shots/1389/(844×390 移动横屏标准档,主线亲审)。
import { test, expect } from "../fixtures";
import { quickStart, engineState, waitFxIdle } from "../react-helpers";
import { plant } from "../helpers/drivers";
import { TESTIDS } from "../../src/app/screens/game/testids";
import type { Page } from "@playwright/test";

/** 三连无主城选址(布景地形,读引擎现值不落数值):取「i/i+1/i+2 三格皆城且皆无主」
 *  的首处(环取模)。测试①用:f1/f2 授 bot 作受击城;测试②用:C/f1 授自机(受击城恒
 *  有主——识破份校验与链环争夺份结算都要求有主),f2 留无主作「免于火焰」锚行面。
 *  候选不足=响亮炸(seed/图漂移,重钉)。 */
async function pickUnownedTriple(page: Page): Promise<{
  center: number;
  f1: number;
  f2: number;
  pidC: string;
  pidF1: string;
  pidF2: string;
  nameC: string;
  nameF1: string;
  nameF2: string;
}> {
  const run: {
    center: number;
    f1: number;
    f2: number;
    pidC: string;
    pidF1: string;
    pidF2: string;
  } = await engineState(
    page,
    `(() => {
      const owned = new Set(e.players.flatMap((p) => p.properties.map((h) => h.propertyId)));
      const n = e.board.count;
      const free = (i) => {
        const t = e.board.at(((i % n) + n) % n);
        return t.propertyId != null && !owned.has(t.propertyId);
      };
      for (let i = 0; i < n; i++) {
        if (free(i) && free(i + 1) && free(i + 2)) {
          const t = (k) => e.board.at(((k % n) + n) % n);
          return {
            center: t(i).index, f1: t(i + 1).index, f2: t(i + 2).index,
            pidC: t(i).propertyId, pidF1: t(i + 1).propertyId, pidF2: t(i + 2).propertyId,
          };
        }
      }
      throw new Error("种植失败:三连无主城缺席(seed/图漂移,重钉)");
    })()`,
  );
  const names: { nameC: string; nameF1: string; nameF2: string } = await engineState(
    page,
    `(() => ({
      nameC: e.board.at(${run.center}).name,
      nameF1: e.board.at(${run.f1}).name,
      nameF2: e.board.at(${run.f2}).name,
    }))()`,
  );
  return { ...run, ...names };
}

/** 火烧连营反应窗种植(识破保城链用,userSeat=bot 真打出形):view.targetSeats=可拆份的
 *  受击城 tileIndex 清单、payload.targets=[中心城](城指向域窗形,#1389;battle-wiring
 *  huoshaoWindow 同款思路);被询问=仅自机。windowMs 显式给足(免与展示档赛跑的站点
 *  惯例:横幅视觉时长还过倍率缩放,选牌→选份→截图点击链要余量)。 */
function huoshaoWindow(userSeat: number, center: number, shares: number[]) {
  return [
    {
      kind: "armReaction" as const,
      view: {
        kind: "jinnang" as const,
        cardId: "火烧连营",
        userSeat,
        targetSeats: shares,
        queriedBySeat: [0],
        windowMs: 60000,
      },
      payload: { kind: "jinnang" as const, userSeat, cardId: "火烧连营", targets: [center] },
    },
  ];
}

test.describe("锦囊城目标段选城(#1389 T3 棒2,#417 城目标段形制复用)", () => {
  // 全链正路:出牌窗选火烧连营→出牌进目标段→候选=全图任意城无差别点亮(全城池制下
  // 恰=板面格数,含无主/己城——无主中心免伤是结算语义,UI 不设第二形制)→#417 三态
  //(首点选中/再点取消/点他格改选,中心=无主城)→「出」提交 useJinnang targets=[城格]
  // →逐城战报(中心无主免伤锚行+前方两城各降 1 防御)→账面(中心仍无主/受击城 4→3
  // /牌耗)。bot 手牌清形免识破窗(无人可识破=引擎不开窗直结算)。
  test("选火烧连营→候选全城点亮→点无主中心→出→逐城战报+无主免伤", async ({ page }) => {
    await page.setViewportSize({ width: 844, height: 390 });
    await quickStart(page, 67, { mapId: "guanzhong", stopAtOpeningHand: true });
    await plant(page, { kind: "giveJinnang", seat: 0, cards: ["火烧连营"] });
    await plant(page, { kind: "giveJinnang", seat: 1, cards: [] });
    await plant(page, { kind: "giveJinnang", seat: 2, cards: [] });
    await plant(page, { kind: "giveJinnang", seat: 3, cards: [] });
    const s = await pickUnownedTriple(page);
    await plant(page, { kind: "grantProperty", seat: 1, propertyId: s.pidF1, level: 1 });
    await plant(page, { kind: "grantProperty", seat: 2, propertyId: s.pidF2, level: 1 });
    const card = page.getByTestId(TESTIDS.jinnangCard("火烧连营"));
    await expect(card).toBeEnabled();
    await card.click();
    await page.getByTestId(TESTIDS.actionbarPlay).click();
    // 目标段进场:候选=全图任意城无差别点亮(恰=板面格数;tile 0=己城亦在列)
    await expect(page.getByTestId(TESTIDS.actionbarTarget)).toBeVisible();
    const cityCount: number = await engineState(page, `e.board.count`);
    await expect(page.locator(TESTIDS.cityTarget(s.center))).toBeVisible();
    await expect(page.locator(TESTIDS.cityTarget(s.f1))).toBeVisible();
    await expect(page.locator(TESTIDS.cityTarget(s.f2))).toBeVisible();
    await expect(page.locator(TESTIDS.cityTarget(0))).toBeVisible(); // 己城在候选内
    await expect(page.locator(TESTIDS.cityTargetAny)).toHaveCount(cityCount);
    await page.screenshot({ path: "tmp/ui-shots/1389/candidates-lit.png" });
    // #417 三态:首点选中(实金停持环+「出」点亮)→再点同格取消→再点回选→点他格改选
    await page.locator(TESTIDS.cityTarget(s.center)).click();
    await expect(page.locator(TESTIDS.cityTargetPicked(s.center))).toBeVisible();
    await expect(page.getByTestId(TESTIDS.actionbarTarget)).toBeEnabled();
    await page.locator(TESTIDS.cityTarget(s.center)).click();
    await expect(page.locator(TESTIDS.cityTargetPickedAny)).toHaveCount(0);
    await expect(page.getByTestId(TESTIDS.actionbarTarget)).toBeDisabled();
    await page.locator(TESTIDS.cityTarget(s.center)).click();
    await page.locator(TESTIDS.cityTarget(s.f1)).click();
    await expect(page.locator(TESTIDS.cityTargetPicked(s.f1))).toBeVisible();
    await expect(page.locator(TESTIDS.cityTargetPickedAny)).toHaveCount(1);
    // 改选回无主中心城,「出」提交(城指向域提交通道=targets=[中心城 tileIndex])
    await page.locator(TESTIDS.cityTarget(s.center)).click();
    await expect(page.locator(TESTIDS.cityTargetPicked(s.center))).toBeVisible();
    await page.screenshot({ path: "tmp/ui-shots/1389/picked-center.png" });
    await page.getByTestId(TESTIDS.actionbarTarget).click();
    // 结算留痕:恰三行 jinnangFireWall(中心无主免伤锚行+前方两城受击行,溅射序)
    await expect
      .poll(
        async () =>
          await engineState(
            page,
            `e.log.filter((l) => l.detail.includes("jinnangFireWall")).length`,
          ),
      )
      .toBe(3);
    const fireLines: string[] = await engineState(
      page,
      `e.log.filter((l) => l.detail.includes("jinnangFireWall")).map((l) => l.brief + "|" + l.detail)`,
    );
    expect(fireLines[0]).toContain(`「${s.nameC}」无主,免于火焰`); // 无主中心:自身免伤
    expect(fireLines[0]).toContain(`center=${s.center} tile=${s.center}`);
    expect(fireLines[1]).toContain(`「${s.nameF1}」防御值降至 3`); // 前方 1 格:Lv1 满防 4→3
    expect(fireLines[1]).toContain(`tile=${s.f1}`);
    expect(fireLines[2]).toContain(`「${s.nameF2}」防御值降至 3`); // 前方 2 格:同上
    expect(fireLines[2]).toContain(`tile=${s.f2}`);
    // 账面:中心仍无主;两受击城防御落账、等级不动;牌已耗(离手)
    const account = await engineState(
      page,
      `(() => {
        const h = (pid) => {
          const o = e.findOwner(pid);
          if (o == null) return null;
          const x = o.properties.find((p) => p.propertyId === pid);
          return { seat: e.players.indexOf(o), defense: x.defense, level: x.level };
        };
        return { c: h("${s.pidC}"), f1: h("${s.pidF1}"), f2: h("${s.pidF2}"), hand: e.players[0].jinnangHand };
      })()`,
    );
    expect(account.c).toBe(null);
    expect(account.f1).toMatchObject({ seat: 1, defense: 3, level: 1 });
    expect(account.f2).toMatchObject({ seat: 2, defense: 3, level: 1 });
    expect(account.hand).not.toContain("火烧连营");
  });

  // 识破保城链:bot 打出的火烧连营窗(battle-wiring 新形夹具同款思路,armReaction 种
  // 挂起态)→架金边点识破→城份令牌(份=受击城 tileIndex,笺文城名)未选份落印禁用→
  // 点中心令牌选中→落印→「这一城免烧」战报+余城照烧+无主锚行;账面=保城满防不动、
  // 余城 4→3、识破离手。双城份=按城拆份颗粒度的一眼面(保 C 则 C+1 照烧)。
  test("识破保城:窗点识破→城份令牌选城→落印→「这一城免烧」+余城照烧", async ({ page }) => {
    await page.setViewportSize({ width: 844, height: 390 });
    await quickStart(page, 67, { mapId: "guanzhong", stopAtOpeningHand: true, seats: 2 });
    await plant(page, { kind: "giveJinnang", seat: 0, cards: ["识破诡计"] });
    await plant(page, { kind: "giveJinnang", seat: 1, cards: [] });
    const s = await pickUnownedTriple(page);
    await plant(page, { kind: "grantProperty", seat: 0, propertyId: s.pidC, level: 1 });
    await plant(page, { kind: "grantProperty", seat: 0, propertyId: s.pidF1, level: 1 });
    await plant(page, { kind: "armPhase", activeIndex: 1 }); // bot 打出方回合内
    for (const op of huoshaoWindow(1, s.center, [s.center, s.f1])) await plant(page, op);
    await plant(page, { kind: "pinDice", channel: "march", values: [2] }); // 接棒 bot 少走,免掠城面
    // 窗已升起:目标括注=城名(城指向域,#1389);架上识破金边可点
    const banner = page.getByTestId(TESTIDS.reactionBanner);
    await expect(banner).toBeVisible();
    await expect(page.getByTestId(TESTIDS.reactionText)).toContainText(
      `使用【火烧连营】(对 ${s.nameC}、${s.nameF1})`,
    );
    const card = page.getByTestId(TESTIDS.jinnangCard("识破诡计"));
    await expect(card).toBeVisible();
    await card.click();
    // 城份令牌(testid=reaction-seat-<受击城 tileIndex>,笺文=城名):未选份=落印禁用
    const chipC = page.getByTestId(TESTIDS.reactionSeat(s.center));
    const chipF1 = page.getByTestId(TESTIDS.reactionSeat(s.f1));
    await expect(chipC).toContainText(s.nameC);
    await expect(chipF1).toContainText(s.nameF1);
    await expect(page.getByTestId(TESTIDS.reactionConfirm)).toBeDisabled();
    await chipC.click();
    await expect(chipC).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId(TESTIDS.reactionConfirm)).toBeEnabled();
    await page.screenshot({ path: "tmp/ui-shots/1389/counter-city-share.png" });
    // 落印:窗收+识破链结算(无人可反识破=链即站住,保城免烧、余城照烧)。留痕行
    // detail 前缀取「reactionCounter card=」全词(裸 reactionCounter 会被
    // reactionCounterAnnounce 链环宣布行子串误吞,账即成两行)。
    await page.getByTestId(TESTIDS.reactionConfirm).click();
    await expect
      .poll(
        async () =>
          await engineState(
            page,
            `e.log.filter((l) => l.detail.includes("reactionCounter card=")).length`,
          ),
        { timeout: 20_000 },
      )
      .toBe(1);
    expect(banner).toBeHidden();
    const logText: string = await engineState(
      page,
      `e.log.map((l) => l.brief + "|" + l.detail).join("\\n")`,
    );
    expect(logText).toContain(`识破【火烧连营】,「${s.nameC}」这一城免烧`);
    expect(logText).toContain(`「${s.nameF1}」防御值降至 3`); // 余城照烧(按城拆份颗粒度)
    expect(logText).toContain(`「${s.nameF2}」无主,免于火焰`); // 溅射锚行(无主面)
    const account = await engineState(
      page,
      `(() => {
        const h = (pid) => {
          const o = e.findOwner(pid);
          const x = o.properties.find((p) => p.propertyId === pid);
          return { defense: x.defense, level: x.level };
        };
        return { c: h("${s.pidC}"), f1: h("${s.pidF1}"), hand: e.players[0].jinnangHand };
      })()`,
    );
    expect(account.c).toMatchObject({ defense: 4, level: 1 }); // 保城:满防不动
    expect(account.f1).toMatchObject({ defense: 3, level: 1 });
    expect(account.hand).not.toContain("识破诡计"); // 识破离手(收窗即扣账)
    // 战报抽屉亲见(截图证据;等待演出排空后开抽屉)
    await waitFxIdle(page);
    await page.getByTestId(TESTIDS.settingsButton).click();
    await page.getByTestId(TESTIDS.settingsWarReport).click();
    await expect(page.getByTestId(TESTIDS.logDrawer)).toBeVisible();
    await expect(page.getByTestId(TESTIDS.logDrawer)).toContainText(`「${s.nameC}」这一城免烧`);
    // 免烧行滚入视口再拍(新在上序,免烧行早于受击行,自然折叠在下缘)
    await page
      .getByTestId(TESTIDS.logDrawer)
      .getByText(`「${s.nameC}」这一城免烧`)
      .scrollIntoViewIfNeeded();
    await page.screenshot({ path: "tmp/ui-shots/1389/counter-war-report.png" });
  });

  // 作罢路径一拍(#417 同一口径):目标段选中后「作罢」=收回此计牌不消耗——回卡牌段、
  // 点亮标记全撤、选中清空(「出牌」回禁用)、牌留架;引擎账=相位不动、无火攻战报、
  // 对局日志留「作罢【火烧连营】」行。
  test("作罢路径:退回出牌窗,牌不消耗、无火烧战报", async ({ page }) => {
    await page.setViewportSize({ width: 844, height: 390 });
    await quickStart(page, 67, { mapId: "guanzhong", stopAtOpeningHand: true });
    await plant(page, { kind: "giveJinnang", seat: 0, cards: ["火烧连营"] });
    const card = page.getByTestId(TESTIDS.jinnangCard("火烧连营"));
    await expect(card).toBeEnabled();
    await card.click();
    await page.getByTestId(TESTIDS.actionbarPlay).click();
    await expect(page.locator(TESTIDS.cityTarget(0))).toBeVisible();
    await page.locator(TESTIDS.cityTarget(0)).click(); // tile 0=己城,合法候选
    await expect(page.getByTestId(TESTIDS.actionbarTarget)).toBeEnabled();
    await page.getByTestId(TESTIDS.actionbarCancel).click(); // 作罢
    // 回卡牌段:目标段标记全撤、牌留架(不消耗)
    await expect(page.getByTestId(TESTIDS.actionbarPlay)).toBeVisible();
    await expect(page.getByTestId(TESTIDS.actionbarPlay)).toHaveAttribute("aria-disabled", "true");
    await expect(page.locator(TESTIDS.cityTargetAny)).toHaveCount(0);
    await expect(card).toBeVisible();
    const state = await engineState(
      page,
      `(() => ({
        turnPhase: e.turnPhase,
        hand: e.players[0].jinnangHand,
        fireLines: e.log.filter((l) => l.detail.includes("jinnangFireWall")).length,
        logText: e.log.map((l) => l.brief).join("\\n"),
      }))()`,
    );
    expect(state.turnPhase).toBe("AwaitingJinnang"); // 相位不动
    expect(state.hand).toContain("火烧连营"); // 牌未消耗
    expect(state.fireLines).toBe(0); // 无火烧战报
    expect(state.logText).toContain("作罢【火烧连营】");
  });
});
