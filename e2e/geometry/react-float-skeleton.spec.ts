// 地板名册(ADR-0062):地板·几何钉×3——顶带 32×32/44px、亮收四沿对齐、签面组中线对齐,全几何腿
// 全浮层骨架(#700)专项:① 顶部浮层几何(#732 顶左行序:设置→详情两钮
// 避 safe-area,顶中让给知会横幅槽;#853 起「N 轮」chip 退役,顶中常驻件=回合
// 胶囊);② 锦囊手牌开关
// (#1006 建组;显隐 2026-11-07 改「回合联动+决策保底」:亮=我的回合∪决策窗在场∪
// 手动临时开;localStorage 持久偏好退役,记账/重进恢复断言随行删除);③ 设置弹层(音效开关接
// AudioProvider、战报›入口降级、版本戳、回到主页弃局离屏)。断言全走 testid 单源 +
// 调试钩子/快照,几何断言收进单次 evaluate。
// 原「核心几何不变量:满编 8 席」例已删(2026-11-08 唯一守环审计):四条断言(8 格/
// 格高 38/全列零滚动/末格下缘≤三圆钮上缘)逐条由 react-seat-cells「满编 8 席」与
// react-narrow「全浮层件就位」同阈值守;独占的「桌面→844×390 视口切换」到达路径是
// 纯 CSS 重排非 app 代码,且交付形态 APK 锁横屏、桌面 resize 为不设断言的失修面。
import { test, expect } from "../fixtures";
import { quickStart, dismissJinnangIfUp, snap } from "../react-helpers";
import { plant } from "../helpers/drivers";
import { TESTIDS } from "../../src/app/screens/game/testids";

test.describe("顶部浮层几何(#700 ①)", () => {
  test.use({ viewport: { width: 844, height: 390 } });

  // 真实段(ADR-0058):quickStart 真实开局链(谱内 seed 1486,seedSolo 直呼生产
  // 通路)走到首拍冻结,顶浮层四件(设置/详情/回合胶囊/三圆钮)真实挂载渲染的 DOM
  // 盒模型即被测环——单发 evaluate 读真渲染几何,无操作链。钉相位走 armPhase
  // (#1301,判词单源 src/core/planter.ts:钉 AwaitingDecision 空闲态=断言前提,
  // 引擎自转无「钉相位」公共命令);清落格投影(防决策卷轴遮顶栏)走 armLanding
  // (null)(#1303,投影族判词单源 src/core/planter.ts)。
  test("顶左行序 设置→详情:两钮 32×32 避 safe-area;回合胶囊顶中与钮行同排(#853 chip 退役);三圆钮 44px 贴右下,锦囊默认亮", async ({
    page,
  }) => {
    test.slow(); // 预算放宽同族口径(preRoll 后本例实跑 ~10s)
    // 波5b #1218 preRoll 评估采用(种植例):断言面=顶浮层几何,不依赖行军日志/
    // 已推进回合——落都即冻结(#1221 通路)替代「随机 seed+waitMyPause 自然停靠」,
    // 停靠点漂移与 bot 链竞速面归零(负载根治,几何族种植例同批换装)。
    await quickStart(page, 1486, { advance: "preRoll" });
    // 钉 AwaitingDecision 空闲态(preRoll 已冻,只清落格投影防决策卷轴遮顶栏)
    await plant(page, { kind: "armPhase", turnPhase: "AwaitingDecision" });
    await plant(page, { kind: "armLanding", landing: null });
    // #1181 诊断:本例是单发 evaluate 几何读数,满载下 quickStart 放行点与浮层首挂/
    // 回合胶囊重挂入场过渡仍有毫秒级竞速窗——读数幂等,整块包 toPass 轮询重试
    // (expect 超时窗内读到稳定正确才算过);阈值与断言语义不变。
    await expect(async () => {
      const geo = await page.evaluate(
        ({ overview, settings, capsule, buttons, toggle }) => {
          const rect = (id: string) => {
            const el = document.querySelector(`[data-testid="${id}"]`);
            if (el == null) return null;
            const r = el.getBoundingClientRect();
            return {
              x: r.x,
              y: r.y,
              w: r.width,
              h: r.height,
              cx: r.x + r.width / 2,
              cy: r.y + r.height / 2,
            };
          };
          const vw = document.documentElement.clientWidth;
          const on = document.querySelector(`[data-testid="${toggle}"]`)?.classList.contains("on");
          return {
            overview: rect(overview),
            settingsBtn: rect(settings),
            capsule: rect(capsule),
            buttons: rect(buttons),
            toggleOn: on,
            vw,
          };
        },
        {
          overview: TESTIDS.topbarOverview,
          settings: TESTIDS.settingsButton,
          capsule: TESTIDS.turnCapsule,
          buttons: TESTIDS.pileButtons,
          toggle: TESTIDS.jinnangToggle,
        },
      );
      // 顶左行序(#732):设置 ⚙ 最左,详情 ☰ 其次——两钮 32×32 贴左上
      // (测试环境 safe-area=0,实现口径 = safe + 8px),同一行(y 互齐)
      expect(geo.settingsBtn).not.toBeNull();
      expect(Math.abs(geo.settingsBtn!.w - 32)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(geo.settingsBtn!.h - 32)).toBeLessThanOrEqual(0.5);
      expect(geo.settingsBtn!.x).toBeLessThanOrEqual(9);
      expect(geo.settingsBtn!.y).toBeLessThanOrEqual(9);
      expect(geo.overview).not.toBeNull();
      expect(Math.abs(geo.overview!.w - 32)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(geo.overview!.h - 32)).toBeLessThanOrEqual(0.5);
      expect(geo.overview!.x).toBeGreaterThan(geo.settingsBtn!.x + geo.settingsBtn!.w);
      expect(Math.abs(geo.overview!.y - geo.settingsBtn!.y)).toBeLessThanOrEqual(1);
      // 回合胶囊(#853 chip 退役,轮次唯一落胶囊):顶中知会槽行,与钮行垂直居中
      // 互齐(槽 32px 行内 24px 胶囊居中,槽/钮行同锚 +8);cx 在顶中半场(胶囊
      // 可融合等待附加信息,宽度随内容,只守「中段、不与顶左两钮相侵」)
      expect(geo.capsule).not.toBeNull();
      expect(geo.capsule!.x).toBeGreaterThan(geo.overview!.x + geo.overview!.w);
      expect(Math.abs(geo.capsule!.cy - geo.settingsBtn!.cy)).toBeLessThanOrEqual(3);
      expect(geo.capsule!.cx).toBeGreaterThan(geo.vw / 4);
      expect(geo.capsule!.cx).toBeLessThan(geo.vw * 0.75);
      // 三圆钮:贴右下(44 + 8 右距 + 10 底距),锦囊钮默认亮(=显示)
      expect(Math.abs(geo.buttons!.h - 44)).toBeLessThanOrEqual(0.5);
      expect(geo.buttons!.y + geo.buttons!.h).toBeGreaterThanOrEqual(390 - 55);
      expect(geo.buttons!.x + geo.buttons!.w).toBeGreaterThanOrEqual(844 - 55);
      expect(geo.toggleOn).toBe(true);
    }).toPass();
  });
});

test.describe("锦囊手牌开关(#1006 建组;显隐回合联动+决策保底)", () => {
  test.use({ viewport: { width: 844, height: 390 } });

  // 新钉三问自答:守住什么=「收起是会话内临时态」全语义——收起即隐(手牌区整区
  // 卸载,签面随之)、再点回亮、收起跨他人回合持续(沿与沿之间手动态持续)、四枚
  // 规则沿自动对齐:亮沿=自回合开始/窗态开场(决策保底,#1006 原保证),收沿=
  // 回合交出/窗收且非我回合(决策毕架撤,2026-11-07 新增);持久偏好退役后这是
  // 开关的唯一契约。墙钟≈40s(单次 quickStart + 停车坪种植,无长链)。替代=原
  // #700 ③「收起/localStorage 记账/重进恢复」单例(记账与重进两段断言随持久偏好
  // 退役删除)。
  // 真实段(ADR-0058):开关显隐的 UI 响应链即被测环——toggle 真实点击(收起/再开/
  // 跨回合持续)与四枚沿(自回合开始/窗态开场/窗落交出)的真 DOM 挂载卸载全真。
  // 相位/活跃方种植走 armPhase(#1301,判词单源 src/core/planter.ts:四枚沿的驱动
  // 状态(回合交接/窗态升落)由引擎自转产生,无「指定下一行动方」「凭空开/落反应窗」
  // 公共命令——被测对象是 UI 对该状态的响应链,不是状态本身);清落格投影仍直写
  // (同上例内联判词)。
  test("收起即隐/再点回亮;跨他人回合持续;亮收四沿自动对齐(回合联动+决策保底)", async ({ page }) => {
    test.slow(); // 预算放宽同族口径(preRoll 后本例实跑 ~15s)
    // 波5b #1218 定 seed 根治(「他人回合收起」负载挂签名):原随机 seed+waitMyPause
    // 自然停靠,bot 回合询问期两类假停靠(反应窗询问/珍宝抉择,decisionOwner=我)会
    // 让钉相位与真链赛跑;改 preRoll 落都即冻结(#1221 通路,种植例评估采用
    // ——断言面=开关四沿 UI 响应,不依赖行军日志/回合数),停车与竞速面归零。
    await quickStart(page, 1486, { advance: "preRoll" });
    // 停车坪(pinRackIdle 同款钉法,配方出处 react-jinnang-rack):钉进 AwaitingDecision
    // 空闲态 + 清 pendingLand/落格投影——决策卷轴不拦顶栏命中,锦囊钮可点,状态
    // 无限期稳定(preRoll 已冻,无自动推进可竞速)。
    await plant(page, { kind: "armPhase", turnPhase: "AwaitingDecision" });
    await plant(page, { kind: "armLanding", landing: null });
    const zone = page.getByTestId(TESTIDS.handZone);
    const toggle = page.getByTestId(TESTIDS.jinnangToggle);
    // 默认亮:开场即挂载,钮亮态
    await expect(zone).toBeVisible();
    await expect(toggle).toHaveClass(/on/);
    // 收起:手牌区整区卸载(卸载零占位,战斗区最大化)、钮亮态退;无落盘
    // (localStorage 记账断言随持久偏好退役,会话内临时态不落盘)
    await toggle.click();
    await expect(zone).toHaveCount(0);
    await expect(toggle).not.toHaveClass(/on/);
    // 再点回亮
    await toggle.click();
    await expect(zone).toBeVisible();
    await expect(toggle).toHaveClass(/on/);
    // 收起跨他人回合持续(沿与沿之间手动态持续):钉进 bot 席位(#413 停车坪口径,
    // 种植不经房间编排,驱动链不触发,钉住的状态稳定)仍收着
    await toggle.click();
    await expect(zone).toHaveCount(0);
    const botIdx = (await snap(page)).players.findIndex((p: { isBot: boolean }) => p.isBot);
    await plant(page, { kind: "armPhase", activeIndex: botIdx });
    await expect(zone).toHaveCount(0);
    await expect(toggle).not.toHaveClass(/on/);
    // 亮沿①:自回合开始上升沿(activeIndex 回自席,false→true)自动弹回
    const myIdx = (await snap(page)).players.findIndex((p: { isBot: boolean }) => !p.isBot);
    await plant(page, { kind: "armPhase", activeIndex: myIdx });
    await expect(zone).toBeVisible();
    await expect(toggle).toHaveClass(/on/);
    // 亮沿②:窗态开场上升沿(出牌窗 junshiUp false→true)自动弹回
    await toggle.click();
    await expect(zone).toHaveCount(0);
    await plant(page, { kind: "armPhase", turnPhase: "AwaitingJinnang" });
    await expect(page.getByTestId(TESTIDS.actionbar)).toBeVisible();
    await expect(zone).toBeVisible();
    await expect(toggle).toHaveClass(/on/);
    // 收沿(回合联动新增):窗落且回合交出(一拍种植,两布尔同落)→ 架自动收,
    // 决策毕架撤,不再要求玩家每轮手动收
    await plant(page, {
      kind: "armPhase",
      turnPhase: "AwaitingDecision",
      activeIndex: botIdx,
    });
    await expect(page.getByTestId(TESTIDS.actionbar)).toHaveCount(0);
    await expect(zone).toHaveCount(0);
    await expect(toggle).not.toHaveClass(/on/);
  });
});

test.describe("签面归组(#840 ④)", () => {
  test.use({ viewport: { width: 844, height: 390 } });

  // 真实段(ADR-0058):单张手牌真实挂载渲染的签面/牌行/架体盒模型几何即被测环。
  // 手牌种植经 giveJinnang(#1298,判词单源 src/core/planter.ts 头注:生产发牌只有
  // 牌堆顶随机抽,无「发指定牌」公共命令),断言面需单张特定牌形(hug 与全宽档差异
  // 放大到最大);冻结(preRoll 落都即冻结)是到达手段,非字段直改。
  test("签面与手牌架同组居中:签面贴牌行、组中线≈手牌区中线、架体收拢到内容实宽", async ({
    page,
  }) => {
    test.slow(); // 预算放宽同族口径(preRoll 后本例实跑 ~10s)
    // 波5b #1218 定 seed 根治(「起手 1 张」负载挂签名):原随机 seed+freezeClock,
    // 停靠点随骰走漂移、桥写与 bot 链赛跑;改 preRoll 落都即冻结(#1221 通路,
    // 种植例评估采用——断言面=单张签面几何,不依赖行军日志/回合数),零竞速。
    await quickStart(page, 1486, { advance: "preRoll" });
    // 钉单张手牌;单张把 hug 与旧全宽档的差异放到最大——叠加压缩态架体本就近乎
    // 吃满,断言无分辨力。
    await plant(page, { kind: "giveJinnang", seat: 0, cards: ["军情密探"] });
    type Geo = {
      gapSealToCard: number;
      groupCenterOffset: number;
      rackHugs: boolean;
      ok: boolean;
    } | null;
    let geo: Geo = null;
    // 反应横幅在场(:has 例外档回全宽,layout.css)或窗态拦顶时整块重试(状态轮询)
    await expect(async () => {
      await dismissJinnangIfUp(page);
      geo = await page.evaluate(
        ({ zone, seal }) => {
          const q = (t: string) => document.querySelector(`[data-testid="${t}"]`);
          const zoneEl = q(zone);
          const sealEl = q(seal);
          const rackEl = document.querySelector(".handzone .hand-rack");
          const cardEl = document.querySelector(".handzone .hand-rack button");
          if (!zoneEl || !sealEl || !rackEl || !cardEl) return null;
          const rect = (el: Element) => {
            const r = el.getBoundingClientRect();
            return {
              left: r.x,
              right: r.x + r.width,
              cx: r.x + r.width / 2,
              w: r.width,
            };
          };
          const z = rect(zoneEl);
          const s = rect(sealEl);
          const rk = rect(rackEl);
          const c = rect(cardEl);
          const gapSealToCard = c.left - s.right; // 签面右缘 → 首张牌左缘(组内贴邻)
          const groupCenterOffset = Math.abs((s.left + rk.right) / 2 - z.cx);
          const rackHugs = rk.w < z.w - 50; // hug 内容实宽(旧 flex:1 全宽吃满档不满足)
          return {
            gapSealToCard,
            groupCenterOffset,
            rackHugs,
            ok:
              !document.querySelector(".handzone .reaction-banner") &&
              rackHugs &&
              gapSealToCard >= 0 &&
              gapSealToCard <= 45 &&
              groupCenterOffset <= 3,
          };
        },
        { zone: TESTIDS.handZone, seal: TESTIDS.diceFace },
      );
      expect(geo).not.toBeNull();
      expect(geo!.ok).toBe(true);
    }).toPass({ timeout: 15_000 });
    // 终值逐项复述(失败信息直读几何差量)
    expect(geo!.gapSealToCard).toBeGreaterThanOrEqual(0);
    expect(geo!.gapSealToCard).toBeLessThanOrEqual(45);
    expect(geo!.groupCenterOffset).toBeLessThanOrEqual(3);
    expect(geo!.rackHugs).toBe(true);
  });
});

// 「设置弹层」复合例(音效/战报抽屉/版本戳/弃局离屏)已按 #987 删除:并行挂一次、
// 串行复验全绿 = 概率性不可靠,无一行确定性改造可根治(快照被同批慢池清场,无失败
// 签名可治)。注意:演出加速/版本行的 e2e 断言随例退场,此后无自动化覆盖(版本行
// 是静态发版号文本,#951/#952 交付时人工验讫)。
