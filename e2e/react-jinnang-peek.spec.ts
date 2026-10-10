// 军情密探热座窥探窗(#453,审计 #446/B1):窥探情报的呈现过滤必须绑「自我身份」
// (selfSeat:单机热座恒 0,联机=本座),不许绑「决策视角」(viewSeat=decisionOwner
// 随回合轮转)——误绑则窥探情报只在使用者自己决策时可见,「对手行动期间」全部落空。
// 断言全走可见 UI 态(#305 口径):席位卡手牌浮签(Tip)的「窥见:牌名」放行与否;
// 窥探结算/到期记账归 test/jinnang.test.ts,本 spec 只守呈现层座位绑定。
// 节奏控制(#421 时钟缝 + 单机形态实证):单机 bot 链在人类命令内同步跑完(delay=0,
// 不经时钟),decisionOwner≠0 只是链内瞬态、快照直达本座下一决策点——「对手回合」
// 的可观测形态有两块:
//   · 到期半场(真实引擎路径):出牌→窗零可用自动过→本座行军落格抉择清掉→bot 链
//     同步跑→轮回本座(引擎 endTurn 已清窥探,「至使用者下回合开始」)→ 停在 Roll
//     即冻结,断浮签收回 + 引擎账本已空;
//   · 可见半场(绑定判别):冻结后引擎直写一枚窥探账 + 决策方=bot 的停泊态——
//     决策视角(viewSeat=1)≠自我身份(selfSeat=0),此刻浮签放行窥见当且仅当
//     过滤绑 selfSeat,判别力最强且无竞速。
// 种子 7(react-jinnang-use 同款):人类先手,开局军师窗=稳定停靠点;军情密探目标门槛
// =对方有珍宝,给 bot1 挂一件进目标段;bot1 手牌钉成火烧连营(开局无非都城城,火烧
// 连营灰置不可出)——bot1 不会出牌,窥探观察窗不受干扰。
import { test, expect } from "./fixtures";
import { actIfCan, force, freezeClock, snap, startSolo } from "./react-helpers";
import { TESTIDS } from "../src/app/screens/game/testids";

test.describe("军情密探热座窥探(#453)", () => {
  test("窥探到期即收回;对手行动期间(决策方=bot)浮签放行窥见", async ({ page }) => {
    await startSolo(page); // 停稳在开局军师窗(AwaitingJinnang,人类先手)
    // 种植(jinnang-use 同款门槛):bot1 有珍宝=可被窥探;人类改持军情密探。
    await force(
      page,
      `
      e.players[1].treasures = [{ id: "gem-1", name: "夜明珠", level: 5 }];
      e.players[1].jinnangHand = ["火烧连营"];
      e.players[1].jinnangHandCount = 1;
      e.players[0].jinnangHand = ["军情密探"];
      e.players[0].jinnangHandCount = 1;
    `,
    );
    // 出牌进目标段,点 bot1 席位即出(免二次确认;jinnang-use 同款交互链)
    await page.getByTestId(TESTIDS.jinnangCard("军情密探")).click();
    await page.getByTestId(TESTIDS.actionbarPlay).click();
    await expect(page.getByTestId(TESTIDS.seatTarget(1))).toBeVisible();
    await page.getByTestId(TESTIDS.seatTarget(1)).click();
    await expect(page.getByTestId(TESTIDS.actionbarTarget)).toBeHidden();

    // 手牌浮签断言口:hover 席位卡手牌徽章,读当前开着的浮签(Base UI 关闭态仍挂 DOM,
    // data-open 才是「此刻展示中」的那份;正文本断言兜住浮签没开的假绿)。
    const handTipOf = async (): Promise<string> => {
      await page.getByTestId(TESTIDS.seatAttr(1, "hand")).hover();
      return (await page.locator('[data-testid="attr-tip"][data-open]').textContent()) ?? "";
    };

    // 基线:出牌当回合(自己决策中)窥见已放行
    expect(await handTipOf()).toContain("窥见:火烧连营");

    // ── 到期半场(真实引擎路径)──
    // 放行残窗/落格抉择,bot 链同步跑完,轮回本座(引擎 endTurn 已清窥探)即冻结
    // (自动起摇看门狗挂时钟,冻结后不再推进,#421)。回合门 = turnNumber 前进:
    // decisionOwner===0 且 Roll 在「出牌后窗自动过」的当回合也成立,不作门会空等假到期。
    const turnNoAtPlay = (await snap(page)).turnNumber;
    await expect
      .poll(
        async () => {
          await actIfCan(page);
          const s = await snap(page);
          if (s.turnNumber > turnNoAtPlay && s.decisionOwner === 0) {
            await freezeClock(page);
            return true;
          }
          return false;
        },
        { timeout: 60_000, message: "轮回本座(窥探到期)并冻结" },
      )
      .toBe(true);
    // 引擎账本:窥探已按「至使用者下回合开始」清除
    expect((await snap(page)).jinnangPeeks).toEqual([]);
    // 浮签收回:窥见不再放行,回「以牌背示意」口径
    const tip = await handTipOf();
    expect(tip).not.toContain("窥见:");
    expect(tip).toContain("以牌背示意");

    // ── 可见半场(绑定判别)──
    // 冻结中引擎直写:重植一枚窥探账 + 决策方切到 bot1 的停泊态(时钟冻结,看门狗
    // 不推进,状态钉死)。决策视角=viewSeat(=decisionOwner=1),自我身份=selfSeat=0
    // ——浮签放行窥见 ⇔ 过滤绑自我身份(#453/B1 的判别现场)。
    await force(
      page,
      `
      e.players[1].jinnangHand = ["火烧连营"];
      e.players[1].jinnangHandCount = 1;
      e.jinnangPeeks = [{ viewer: 0, target: 1 }];
      e.activeIndex = 1;
      e.currentDraftIndex = e.draftOrder.indexOf(1);
      e.turnPhase = "Roll";
    `,
    );
    expect((await snap(page)).decisionOwner).not.toBe(0); // 决策方=bot:确在「对手行动期间」
    expect(await handTipOf()).toContain("窥见:火烧连营");
  });
});
