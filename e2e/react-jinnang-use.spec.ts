// 锦囊使用回路(#122/T2;#256 出牌阶段态迁移;#281 免战金牌退役改写;#305 整备;#417 目标选择统一):
// 旧弹窗退役,出牌面上架手牌架——点牌=选中放大(放大态即详情态),动作条「出牌」=
// 确认、「不出」=今不用,目标段=席位即靶(金圈呼吸+棋盘 token 呼吸;#417 起点席位=
// 选中(实金停持 .picked),再点同席取消,动作条「出」钮打出——不再点席位即出)。
// #281:免战金牌随档 1 退役(预防开盾删除),原「出牌走旧弹窗」用例改写为「识破诡计
// 经反应窗打出」——架中反应牌呼吸金边,点牌选中,横幅落印确认。
// #305 整备两件事:①出牌指示线用例自 jinnang-play-line.spec.ts 并入(出牌→墨线同一
// 交互链,原文件删除);②引擎断言下沉——结算/留痕/记账归引擎层单测
// (test/jinnang.test.ts、test/reaction-window.test.ts、test/hero-skill.test.ts),
// 本 spec 只留交互接线,断言全走可见 UI 态(选中/禁用/印条/窗收/牌离架)。
// 断言覆盖拍板口径:反应窗出牌回路、再点同牌取消选中、出牌钮禁用/启用、灰置牌原因印条、
// 多标签牌(缓兵之计)双章、名将技能卡(主动技,#818 起 SkillCardFace 单技装配:载体+
// 主技名大字,同将双技双卡可辨、异将同名技载体可辨)、作罢路径、出牌墨线端点对准。
// 种子复算(#949 换图重钉;seed 67 × 关中图,进程内直扫复算):人类先手
// (draftOrder=[0,3,2,1]),选都候选取 DOM 首格=0 长安(bot 都:诸侯2=10 长沙、
// 诸侯3=20 卧龙岗、诸侯4=3 辽东),起手求贤令(自身域恒可用)
// → **开局出牌阶段=稳定停靠点保留**。灰置/技能卡局面走 force 引擎直写(#237 无天然
// 种子同时凑齐)。
// 到站形制(#1256 对账,ADR-0058 种局式直通):startJunshi 前置链从「goto→选图→起兵→
// 点城确认」UI 旅程换装 quickStart stopAtOpeningHand(seedSolo 桥路)——桥路与旧 UI 链
// 同 seed 同局(registry 选都口径统一:两路同 seed 必须同局),且 waitMyPause 不代发放行
// (其头注:AwaitingJinnang 本身就是合法停靠点),旧链「自行点城+确认以保留窗态」的
// 诉求由停靠语义直接满足;被测环=出牌/目标段/反应窗交互链,到站通路替换零断言改动。
// 8 例均非旅程例(前门=react-setup/home-strip/tutorial 脊柱①⑤),种局式直通是本族应答。
// 自然骰钉死(棒 2 口径:Bun 与浏览器 sort 比较器调用数不同,自然骰不可信):识破例放行后
// 人类自动行军以 marchSteps 钉「二」落 2 幽州无主城(plantDemolishableCity 的种植城=
// +1 晋阳,落格弹购地卷轴,skipUntilNextSeat 可清;钉「一」落 1 晋阳自家种植城,
// 升级决策同样可清)。
// #1215 棒2(ADR-0058 一环一真):全族 8 例真实段逐例头注声明;force 判词审计归类
// (#1300 后余下:marchQueue 行程骰 2(钉骰族 #1302)、jinnangUsedTags 标签额度 1、
// 防窗反应牌清除 2(归 #1301)——各在种植点/助手头注写一行「force 判词」,均为引擎
// 到不了的形态;塞指定锦囊站点已迁 giveJinnang #1298,挪城/授等级/名将候选站点已迁
// grantProperty/armHero #1300,判词单源 src/core/planter.ts 头注;本 spec 断言链的
// 操作段全真,前置种植只造「断言面需要的牌形/布场」)。
import { test, expect } from "./fixtures";
import {
  force,
  quickStart,
  waitMyRollDone,
  skipUntilNextSeat,
  useHalfScale,
  plantDemolishableCity,
  snap,
  freezeClock,
  engineState,
} from "./react-helpers";
import { plant } from "./helpers/drivers";
import { TESTIDS } from "../src/app/screens/game/testids";
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

/** 行军骰队列(行程):接下来数次 rollAndMove 的行程骰依序取给定值,耗尽自还原
 *  (react-reaction.spec.ts 同款,局部确定性;patch 命中时不消耗种子 rng,还原后种子流
 *  无缝续走)。与拼点 rollDie 队列分属两个注入口互不串队——本 spec 只用行程队列。
 *  尾分号必备:单独作为 fn 传 force 时,表达式语句必须自终止,否则吃掉后续 sync()。
 *  force 判词:自然骰经种子仍受 sort 比较器调用数影响(#949,Bun 与浏览器调用数不同),
 *  停靠落格必须钉骰——骰值无公共设定通路,行程骰注入=确定性钉非兜底。 */
const marchQueue = (...values: number[]) => `
  (() => {
    const o = e.dice.roll.bind(e.dice);
    const q = [${values.join(", ")}];
    e.dice.roll = () => {
      const v = q.shift();
      if (q.length === 0) e.dice.roll = o;
      return { die: v ?? o().die };
    };
  })();`;

/** 给 bot 1 挪一座 1 级非都城(原 jinnang-play-line.spec.ts 随迁,#305):火烧连营的
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

test.describe("锦囊使用回路(T2,出牌阶段态;#281 识破诡计反应窗)", () => {
  // 真实段:反应窗全应答链真(对方真打出火烧连营→横幅升起→点牌选中/再点取消→落印
  // 确认→窗收牌离架),引擎结算(双牌皆耗/识破留痕)随之全真。前置种植判词见各种植点
  // (手牌无公共通路需特定牌形;挪城无授城公共命令;行程骰=确定性钉)。
  test("seed67 识破诡计:架上金边→点选/再点取消→落印→窗收牌耗", async ({ page }) => {
    await startJunshi(page, 67);
    // 种植:人类改持识破诡计 + 一座可失之城(plantDemolishableCity 挪 +1 晋阳@1,0 级);bot 全持
    // 火烧连营(首个行动 bot 回合开始即出,城最多者=人类);行程骰钉「二」:放行后自动
    // 行军落 2 幽州无主城弹购地卷轴(钉「一」落 +1 晋阳自家种植城,升级决策同可清)。
    // force 判词:手牌无公共通路(引擎无「发指定牌」公共命令),断言面需特定牌形;
    // 挪城/行程骰判词见 plantDemolishableCity 与 marchQueue 注。
    await plantDemolishableCity(page);
    await plant(page, { kind: "giveJinnang", seat: 0, cards: ["识破诡计"] });
    for (const seat of [1, 2, 3])
      await plant(page, { kind: "giveJinnang", seat, cards: ["火烧连营"] }); // bot 全持
    await force(page, marchQueue(2));
    await page.getByTestId(TESTIDS.actionbarPass).click();
    await waitMyRollDone(page, 0);
    await skipUntilNextSeat(page, 0);
    // 冻结推进(#987 确定性改造,定向复验实锤:权威窗 5s 与点选链赛跑,落印前窗被
    // 看门狗代发收走):窗期内看门狗挂起,点选/落印不再赌墙钟;落印确认与窗收牌耗
    // 结算仍走真引擎通路,#421 冻结闸语义(断言仍失败=真 bug)。冻结先例:react-jinnang-rack ③。
    await freezeClock(page);
    // 反应窗:架上识破诡计呼吸金边(.reactive);横幅就位(带目标括注 #921,火烧=one 域)
    const banner = page.getByTestId(TESTIDS.reactionBanner);
    await expect(banner).toBeVisible();
    const snap0 = await snap(page);
    await expect(banner.getByTestId(TESTIDS.reactionText)).toContainText(
      `使用【火烧连营】(对 ${snap0.players[0].guohao})`,
    );
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

  // 真实段:「不出」放行点击→窗收、牌留架的真命令通路与放行后自动行军接棒全真
  // (#188 通行链路)。前置:手牌直写判词=手牌无公共通路,断言面需任意可留架牌形;
  // 行程骰判词见 marchQueue 注(自然骰确定性钉)。
  test("seed67 不出直发:窗放行、牌留架(#188 自动行军接棒)", async ({ page }) => {
    await startJunshi(page, 67);
    // 直写钉牌(开局起手是横征暴敛,与本例无关——钉火烧连营验「任意手牌放行后留架」);
    // 行程骰钉「一」:放行后自动行军落 1 晋阳(0 长安 +1,自家种植城=升级决策停靠),
    // 断言全程不赌自然骰。(#188 自动起摇由通行链路全程走通——waitMyRollDone 家族全依赖它)
    await plant(page, { kind: "giveJinnang", seat: 0, cards: ["火烧连营"] });
    await force(page, marchQueue(1));
    // 「不出」:窗收(卡牌段离场),架常驻、牌仍在(不消耗;手牌记账归引擎层,
    // 放行后自动起摇由 #188 通行链路全程走通——waitMyRollDone 家族全依赖它)
    await page.getByTestId(TESTIDS.actionbarPass).click();
    await expect(page.getByTestId(TESTIDS.actionbarPass)).toBeHidden();
    await expect(page.getByTestId(TESTIDS.jinnangCard("火烧连营"))).toBeVisible();
  });

  // 真实段:出牌两击链全真(点牌选中→「出牌」点亮→打出→牌离架),消耗的 UI 表达
  // 随真命令通路走。force 判词:手牌无公共通路,断言面需 self 域恒可用牌形。
  test("求贤令:点牌→出牌点亮→出牌牌离架", async ({ page }) => {
    await startJunshi(page, 67);
    await plant(page, { kind: "giveJinnang", seat: 0, cards: ["求贤令"] });
    const opt = page.getByTestId(TESTIDS.jinnangCard("求贤令"));
    await expect(opt).toBeVisible();
    await opt.click();
    const play = page.getByTestId(TESTIDS.actionbarPlay);
    await expect(play).toBeEnabled(); // 点牌只选中,出牌点亮
    await play.click();
    // 出牌 → 牌离架(消耗的 UI 表达;招贤/折现结算与战报公开留痕归 test/jinnang.test.ts)
    await expect(opt).toHaveCount(0);
  });

  // 真实段:目标段两步链全真(出牌进目标段→点席位选中/再点取消→「出」钮打出→目标
  // 段收牌离架),金圈呼吸/token 呼吸挂点随真窗态。force 判词:手牌无公共通路需牌形;
  // 珍宝无授宝公共通路(交涉/探索命令到不了「指定座挂指定宝」),目标门槛需对方有宝。
  test("军情密探:出牌进目标段,点席位选中/再点取消,#417 「出」钮确认打出", async ({ page }) => {
    await startJunshi(page, 67);
    // 先停稳在开局出牌阶段态再种植:发牌在进 Playing 时落账,抢跑会被发牌覆盖。
    // 军情密探目标门槛=对方有珍宝:给 seat1 挂一件,目标段才有可用候选。
    // (塞牌经 giveJinnang #1298;珍宝经 giveTreasure #1299,判词单源 src/core/planter.ts)
    await plant(page, {
      kind: "giveTreasure",
      seat: 1,
      treasures: [{ id: "gem-1", name: "夜明珠", level: 5 }],
    });
    await plant(page, { kind: "giveJinnang", seat: 0, cards: ["军情密探"] });
    const opt = page.getByTestId(TESTIDS.jinnangCard("军情密探"));
    await expect(opt).toBeVisible();
    await opt.click();
    await page.getByTestId(TESTIDS.actionbarPlay).click();
    // 目标段:动作条切「选择目标(禁)/作罢」;候选席位卡金圈呼吸 + 棋盘 token 呼吸挂点
    const confirm = page.getByTestId(TESTIDS.actionbarTarget);
    await expect(confirm).toBeVisible();
    await expect(confirm).toBeDisabled(); // 未选中席:「选择目标」引导态
    await expect(page.getByTestId(TESTIDS.seat(1))).toHaveClass(/candidate/);
    await expect(page.locator(".bv-token-target-ring")).not.toHaveCount(0);
    // 点席位=选中(.picked 实金停持,呼吸停):确认钮点亮为「出」
    await page.getByTestId(TESTIDS.seatTarget(1)).click();
    await expect(page.getByTestId(TESTIDS.seat(1))).toHaveClass(/picked/);
    await expect(confirm).toBeEnabled();
    // 再点同席=取消选中(#417):picked 摘除、确认钮回禁用
    await page.getByTestId(TESTIDS.seatTarget(1)).click();
    await expect(page.getByTestId(TESTIDS.seat(1))).not.toHaveClass(/picked/);
    await expect(confirm).toBeDisabled();
    // 三点重选 → 「出」钮确认打出:目标段收、牌离架(#305:窥探结算与回收记账归
    // test/jinnang.test.ts「军情密探·窥探」)
    await page.getByTestId(TESTIDS.seatTarget(1)).click();
    await expect(confirm).toBeEnabled();
    await confirm.click();
    await expect(page.getByTestId(TESTIDS.actionbarTarget)).toBeHidden();
    await expect(opt).toHaveCount(0);
  });

  // 真实段:作罢链全真(进目标段→「作罢」→收回卡牌段、选中清空、牌未消耗的 UI 面)。
  // force 判词同上例(手牌无公共通路;珍宝无授宝公共通路,目标门槛需对方有宝)。
  test("军情密探作罢:目标段收回,回卡牌段选中清空、牌未消耗", async ({ page }) => {
    await startJunshi(page, 67);
    // (塞牌经 giveJinnang #1298;珍宝经 giveTreasure #1299,判词单源 src/core/planter.ts)
    await plant(page, {
      kind: "giveTreasure",
      seat: 1,
      treasures: [{ id: "gem-1", name: "夜明珠", level: 5 }],
    });
    await plant(page, { kind: "giveJinnang", seat: 0, cards: ["军情密探"] });
    const opt = page.getByTestId(TESTIDS.jinnangCard("军情密探"));
    await opt.click();
    await page.getByTestId(TESTIDS.actionbarPlay).click();
    await expect(page.getByTestId(TESTIDS.actionbarTarget)).toBeVisible();
    // 作罢:目标段收回,回到卡牌段窗态(#305:不消耗/不记冷却的记账归引擎层单测)
    await page.getByTestId(TESTIDS.actionbarCancel).click();
    const play = page.getByTestId(TESTIDS.actionbarPlay);
    await expect(play).toBeVisible();
    // 选中已清空(进/出目标段即清空重选);#751 B1:卡牌段禁用=aria-disabled 自门控
    await expect(play).toHaveAttribute("aria-disabled", "true");
    await expect(opt).toBeVisible(); // 牌回卡牌段(作罢语义的 UI 面)
  });

  // 真实段:点主技名开全览→关闭→点卡体选中→「出牌」打出→发技实例转灰置(引擎原因
  // 印条)的呈现/交互链全真,冷却判读读真技表。种植判词:手牌经 giveJinnang(#1298)、
  // 麾下名将经 armHero、bot 城防拉级经 grantProperty(均 #1300,判词单源
  // src/core/planter.ts);force 判词:标签额度(jinnangUsedTags)无公共通路(用牌
  // 记账面,招贤/发牌命令都到不了「本回合已用谋攻+攻」的布场),断言面需该特定布场。
  test("灰置牌印条/多标签双章/技能卡:双标签占额灰置、同将双技双卡可辨、发技转灰置", async ({
    page,
  }) => {
    await startJunshi(page, 67);
    // 种植(停稳已由 startJunshi 保证):缓兵之计(谋+攻)双标签名额已被占 →
    // 灰置带原因印条;麾下给周瑜双主动技(火攻+擂鼓,#818 同将双技=双卡各显各技)→
    // 实授只给主动技,池内被动疾行不授(全览弹框池对照的灰置行对照组);诸 bot 城防
    // 拉到 Lv1(火攻有可毁目标,卡面金边可用;开局各座唯都城 Lv0,拉级=都城格授
    // level 1);求贤令(援,标签未占)= 可用对照组。
    await plant(page, {
      kind: "giveJinnang",
      seat: 0,
      cards: ["缓兵之计", "求贤令"],
    });
    await plant(page, {
      kind: "armHero",
      seat: 0,
      heroId: "zhouyu",
      skillIds: ["huogong", "leigu"],
    });
    const botCapitalPids: string[] = await engineState(
      page,
      "e.players.slice(1).map((p) => e.board.at(p.capitalIndex).propertyId)",
    );
    for (let seat = 1; seat <= botCapitalPids.length; seat++)
      await plant(page, {
        kind: "grantProperty",
        seat,
        propertyId: botCapitalPids[seat - 1]!,
        level: 1,
      });
    await force(page, `e.jinnangUsedTags = ["谋", "攻"];`);
    // 灰置牌:下沉置灰(.off)+ 双标签章竖排 + 原因印条文案可见;不可选中(浏览器禁用契约)
    const huan = page.getByTestId(TESTIDS.jinnangCard("缓兵之计"));
    await expect(huan).toBeVisible();
    await expect(huan).toBeDisabled();
    await expect(huan.locator(".jinnang-card")).toHaveClass(/off/);
    await expect(huan.locator(".seal")).toHaveCount(2); // 多标签:谋+攻 章竖排双挂
    await expect(huan.locator(".reason")).toHaveText("本回合已用过〔谋〕〔攻〕");
    // 可用牌照常
    await expect(page.getByTestId(TESTIDS.jinnangCard("求贤令"))).toBeEnabled();
    // 名将技能卡(#818 新形制:技能为维度、名将为载体):同将双主动技 = 双卡,卡面 =
    // 载体(立绘+将名)+ 主技名大字——双卡凭主技名一眼可辨;每张卡只显本卡代表的技
    // (他卡技名/未授被动技名不上卡);冷却注读技表(冷却周期)。testid=选项 id 实例
    // 形状 skill:<heroId>:<skillId>(#817;布场属主周瑜)
    const huo = page.getByTestId(TESTIDS.jinnangCard("skill:zhouyu:huogong"));
    const lei = page.getByTestId(TESTIDS.jinnangCard("skill:zhouyu:leigu"));
    await expect(huo).toBeVisible();
    await expect(lei).toBeVisible();
    await expect(huo.locator(".hface")).toContainText("火攻");
    await expect(huo.locator(".hface")).toContainText("周瑜"); // 载体将名
    await expect(huo.locator(".hface .cd")).toHaveText("冷却 5 轮"); // 冷却注(技表单源)
    await expect(huo.locator(".hface")).not.toContainText("擂鼓"); // 兄弟技不上卡
    await expect(huo.locator(".hface")).not.toContainText("疾行"); // 未授被动不上卡
    await expect(lei.locator(".hface")).toContainText("擂鼓");
    await expect(lei.locator(".hface")).not.toContainText("火攻");
    // 技能全览(#605):点主技名=开全览弹框(不选中)——被点技高亮行、池全貌与已授
    // 对照(未授的疾行灰置行)、技效描述全文在场;关闭后卡体照常可选中(主技名点击
    // 不触发选中)
    await huo.locator(TESTIDS.skillChip("huogong")).click();
    const glossary = page.getByTestId(TESTIDS.skillGlossary);
    await expect(glossary).toBeVisible();
    // 浏览语境(麾下将/技能卡)只读无拍板钮——「收为麾下」仅招贤消费方传 onPick 在场
    await expect(glossary.getByTestId(TESTIDS.skillGlossaryPick)).toHaveCount(0);
    await expect(
      glossary.locator(`[data-testid="${TESTIDS.skillGlossaryRow("huogong")}"]`),
    ).toHaveClass(/is-hl/);
    await expect(
      glossary.locator(`[data-testid="${TESTIDS.skillGlossaryRow("jixing")}"]`),
    ).toHaveClass(/is-off/); // 池内未授:灰置行(池+已授对照)
    await expect(glossary).toContainText("擂鼓进军"); // 主动技描述全文(卡面上无描述,#605)
    await page.getByTestId(TESTIDS.modalClose).click();
    await expect(glossary).toHaveCount(0);
    await lei.click(); // 点卡体(中靶画心,避开主技名章)= 选中
    await expect(lei.locator(".hface")).toHaveClass(/sel/);
    await page.getByTestId(TESTIDS.actionbarPlay).click();
    // 发技 → 本实例卡转灰置并亮引擎原因(#305:冷却记账归 test/hero-skill.test.ts,
    // UI 只读 choices 展示;同将兄弟卡火攻不连坐,求贤令仍可用 → 相位留在出牌阶段态,
    // settleJinnangExit 口径)
    await expect(lei.locator(".hface")).toHaveClass(/off/);
    await expect(lei.locator(".reason")).toHaveText("冷却中(还差 4 轮)");
    await expect(huo.locator(".hface")).not.toHaveClass(/off/);
  });

  // 真实段:呈现态断言(同名技双卡独立实例 id、卡面载体件各归各将、他将不上卡)——
  // 无操作链,布场后的真实渲染即被测环。麾下将经 armHero 种植件(#1300,判词单源
  // src/core/planter.ts:无授将公共通路,招贤命令到不了「两槽各持指定技」,实授子集
  // 由 skillIds 显式给定);钉 AwaitingJinnang 走 armPhase(#1301,判词单源
  // src/core/planter.ts:断言前提(出牌窗态),引擎自转无「钉相位」公共命令)。
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
// 口径,#272)。出牌线因果由事件批直读(#385 event-extract:单机 engine.gameEvents 与
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
