// ──────────────────────────── 场景构造层 scenes(ADR-0059 决策 5 四层之一,#1255)────────────────────────────
// 守什么:「把浏览器带到被测场景起点」的编排件——quickStart 五态(journey 全 UI 旅程 /
// 默认 postRoll 首掷后停靠 / stopAtOpeningHand 起手停靠 / preRoll 落都即冻 /
// midGameRound 中盘构造器)与开局链(openSoloSetup/pickCapital/disableEncounters)、
// 倍率与种植件(useHalfScale/plantDemolishableCity)、联机选都(onlinePickCapitals)。
// 给谁用:全部 e2e spec。新代码直接 import 本模块;旧路径 e2e/react-helpers.ts 转门面
// 逐名转出,全部调用点零改动。
// 边界:本层=组合层,只编排不实现——桥调用链归 drivers(seedSolo 族/force)、到站
// 沉降归 settle(waitFxIdle/waitSettled/waitMyPause 族)、放行归 patrol
// (dismissJinnangIfUp);新场景入口一律住此,不许回退散装 spec 内联。依赖单向
// 本层 → drivers/settle/patrol,无环。
import { expect, type Page } from "@playwright/test";
import { TESTIDS } from "../../src/app/screens/game/testids";
import { HOME_TID } from "../../src/app/screens/home/testids";
import { TID as SETUP_TID } from "../../src/app/screens/setup/testids";
import { force, seedSolo, seedSoloFrozen, seedSoloPastFirstRoll, seedSoloToRound } from "./drivers";
import { waitFxIdle, waitMyPause, waitMyRollDone, waitSettled } from "./settle";
import { dismissJinnangIfUp } from "./patrol";

/** 机遇隔离 route 收编(#1010 家族一;#126 纪律):注册 jiyu.json 路由拦截回
 *  enabled:false——供不走 openSoloSetup 通路的 spec 调用(时机语义同其「先 route
 *  后进屏」:开局加载到的机遇配置即被归零,注册点留在调用方原位)。机遇冒烟 spec
 *  自行覆写非零参数,不经此口。 */
export async function disableEncounters(page: Page): Promise<void> {
  await page.route("**/config/jiyu.json", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ enabled: false }),
    }),
  );
}

/** 首页 → 单机配置页(信息架构重构:起兵入口在次级页,所有开局链路先走这一步)。
 *  机遇隔离(#126;ADR-0035 必出制):存量 spec 的钉死断言不耐受随机机遇,起兵前把机遇
 *  开关关掉。路由拦截 jiyu.json 直接回 enabled:false,设置屏回落「内置默认」分支——隔离
 *  不与挂载期 fetch 竞态;再等开关落到 aria-checked=false(挂载初值是内置默认「开」,
 *  fetch 竞态窗口内可能为真,等待收敛而非盲点),机遇冒烟 spec 自行覆写非零参数。 */
export async function openSoloSetup(page: Page): Promise<void> {
  await page.route("**/config/jiyu.json", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ enabled: false }),
    }),
  );
  await page.getByTestId(HOME_TID.solo).click();
  await page.getByTestId(SETUP_TID.screen).waitFor();
  await page.getByTestId(SETUP_TID.encounterToggle).click();
  await expect(page.getByTestId(SETUP_TID.encounterEnabled)).toHaveAttribute(
    "aria-checked",
    "false",
  );
}

/** 选都两步走(需求1):点城 → 「定都于此?」确认框 → 确认筑城。
 *  弹窗是新增交互,所有"点城即定都"的旧用例统一改走这里,防选择器散落漂移。
 *  #188:选都后的开局锦囊卷轴放行交给后续等待(waitMyRollDone 轮询体内逐拍
 *  dismissJinnangIfUp,卷轴异步挂载的竞速在轮询内自愈),此处只做一次即时探测。 */
export async function pickCapital(page: Page, nth = 0): Promise<void> {
  await page.locator(".bv-tile.bv-selectable").nth(nth).click();
  await page.getByTestId(TESTIDS.confirmCapitalOk).click();
  await dismissJinnangIfUp(page);
}

/** 演出倍率 0.5(横幅展示=权威窗长折半;权威窗长经 fixtures 注入的
 *  E2E_REACTION_MS=5000,不吃倍率):后挂 init 脚本覆盖 fixtures 注入的同键。 */
export async function useHalfScale(page: Page): Promise<void> {
  await page.addInitScript(() => localStorage.setItem("dafung-e2e-time-scale", "0.5"));
}

/** 火烧目标确定性种植:人类挪入一座非都城(0 级)= 全场唯一「可失之城」(都城不可拆,
 *  demolishOnVictim 排除)——bot 火烧连营的 城最多者∩可拆 目标恒人类。
 *  force 判词(#1215 棒2 审计,ADR-0058 红牌清偿):引擎无授城公共命令——购地命令
 *  受行军路线+现金约束到不了「指定格 0 级城」,断言面需该形态,直写挪入。 */
export async function plantDemolishableCity(page: Page): Promise<void> {
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
      e.players[0].properties.push({
        propertyId: pid, group: e.board.at(idx).group ?? "a",
        purchasePrice: 1000, level: 0, maxLevel: 3,
      });
    }
  `,
  );
}

/** 联机开局选都三选一(L41):pages 按座位序传入(页 i = 座位 i),轮流在「轮到选都」
 *  的端上点候选城 + 确认定都,直到快照离开 Setup(bot 座位由服务器自动代选,只等快照)。
 *  每次轮到断言:轮到端恰 3 座候选高亮、其余端 0 座(联机不越权弹选都交互)。 */
export async function onlinePickCapitals(pages: Page[]): Promise<void> {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const s = await pages[0].evaluate(() => (window as any).__dafung.snapshot());
    if (s.phase !== "Setup") return; // 全员选完 → Playing
    const picker: Page | undefined = pages[s.currentSetupPlayerIndex];
    const before = JSON.stringify(s);
    if (!picker) {
      // bot 座位轮到:服务器自动代选,等快照推进即可。45s:4 worker 满载下服务器
      // 处理+广播的实测抖动可达 20s+(#370 后 reaction 三例 setup 连挂取证),20s 硬编码
      // 是安静机假设;外层 90s deadline 仍兜总预算。
      await pages[0].waitForFunction(
        (b) => JSON.stringify((window as any).__dafung.snapshot()) !== b,
        before,
        { timeout: 45_000, polling: 200 },
      );
      continue;
    }
    await expect(picker.locator(".bv-tile.bv-selectable")).toHaveCount(3, { timeout: 15_000 });
    for (const p of pages) {
      if (p !== picker) await expect(p.locator(".bv-tile.bv-selectable")).toHaveCount(0);
    }
    // 点城→确认两击走 toPass 整块重试:满载下单发点击可能被演出锁/重挂吞掉,确认框
    // 不出现会把本助手变成永久卡死(烧满整个测试预算,#381 secrecy 终局实测)。
    // 重试幂等:选都只在确认击提交(tile 点击只开详情卷轴),未选中前重点同城无害。
    await expect(async () => {
      await picker.locator(".bv-tile.bv-selectable").nth(0).click({ timeout: 5_000 });
      await picker.getByTestId(TESTIDS.confirmCapitalOk).click({ timeout: 5_000 });
    }).toPass({ timeout: 30_000 });
    await pages[0].waitForFunction(
      (b) => JSON.stringify((window as any).__dafung.snapshot()) !== b,
      before,
      { timeout: 45_000, polling: 200 },
    );
  }
  throw new Error("联机选都超时未完成");
}

/** UI 快速开局(#1211 起;#1221 增 preRoll 行军前模式;#1252 增 midGameRound 中盘
 *  构造器;#1254 postRoll 改线构造器+瞬空)。五态通路一句话各:
 *  - journey:全 UI 旅程链(首页→单机设置→起兵→选都→等首手走完)——开局链本身
 *    被走查的用例专用(react-setup / react-home-strip / react-tutorial 同款全 UI 链)。
 *  - 默认(postRoll,#1254 开口吸收):桥内瞬空钉住 → seedSoloToRound 推进过首掷
 *    (targetRound=1 + afterFirstRoll)→ 解钉停靠——首掷链演出整块弃播、棋盘直切引擎
 *    终态(旧真播 waitMyRollDone 地板 3.3s 退役);返回态=首掷已发生,战报有行军行,
 *    到站=首掷后的我方决策停靠(Awaiting* 决策态,旧 postRoll 停靠语义守恒)。
 *  - stopAtOpeningHand(#1217 波4):seedSolo → 停开局第一停靠——起手牌可用 → 停在
 *    AwaitingJinnang 出牌阶段态等输入(setup-flow 入局直调 enterJinnangPhase);不可用
 *    → Roll 等待态 ~1s 自动起摇走局到首个 Awaiting 停靠(waitMyPause 两态通吃且不代
 *    发放行)。
 *  - preRoll(#1221 L1 行军前模式):seedSolo 落都后**在同一 evaluate 内立即
 *    clockPause**——选都命令的同步段(beginPlay:入局/发牌/进 Roll)到冻结只隔微任务
 *    续延,自动起摇定时器(AUTO_MARCH.rollAtMs≥sc(1000),worker 时钟回发=宏任务)
 *    冻在点火前,零竞速;跳过 waitMyRollDone/waitSettled 直接返回。
 *  - midGameRound(#1252 中盘构造器,ADR-0059 示导波):seedSolo 种局 → 桥内
 *    `seedSoloToRound` 冻结时钟、页内经房间命令面逐拍应答真人决策点(策略钉死:选项
 *    首个可用/反应窗「不用」/锦囊今不用/珍宝交涉不交易)推进至第 N 回合边界 → 解冻
 *    沉降(waitFxIdle+waitSettled,演出追帧/吸附自动排空)。回合数=turnNumber(无头
 *    driveToEnd 同款定界);真人决策只停真人座,N 落在 bot 座时到站=下一个人类停靠
 *    (turnNumber ≥ N);Roll 停靠不满足停靠谓词会被应答起摇(仍在同回合内),到站恒为
 *    Awaiting* 决策态(语义对齐 parkMyTurn 谓词)。同 seed 两跑到站逐位一致(守卫 spec
 *    react-midgame-constructor 钉 seed 守着)。
 *
 *  preRoll 与 postRoll(默认)返回态差异表:
 *  | 维度     | preRoll                                       | postRoll(默认)             |
 *  | 对局进度 | 第 1 回合、未掷骰(turnNumber=1)             | 首手已走完(≥1 次掷骰入账) |
 *  | 停靠相位 | AwaitingJinnang(起手牌可用)或 Roll(已冻) | 首手走完后的下一停靠态      |
 *  | 战报     | 无行军行(仅开局/发牌行)                     | 有首掷行军行                |
 *  | 时钟     | 已冻结(种植例免再 freezeClock)             | 未冻结                      |
 *  公共前提:首动者=draftOrder[0]——钉谱种子(1486/1217/20261105/67)=人类座位 0,
 *  即「对局第 1 回合人类回合」;bot 先手谱(1494/1497/1502)不适用该语义。种到
 *  「行军前一拍」就够的种植式用例(卷轴/系统族)用 preRoll 省掉首掷行军链(探针实测
 *  ~3.5s/例)与停靠等待;断言依赖行军日志/已推进回合的用例仍走 postRoll。选种需探
 *  「开局即停」谱(种子漂移按 how-to 种子重钓配方重钓,#1217 波4 实测口径同上)。
 *  种局本体(#1211):goto 前先挂 jiyu.json route 拦截(openSoloSetup 同款)→ 桥内
 *  `window.__dafung.seedSolo`(直呼生产开局通路 handleStart 三步 + 程序化选都;seed
 *  经 evaluate 参数传入,不拼 URL)。`{ mapId }` 显式钉图(seedSolo 直传,压过
 *  localStorage 记忆;#147 后地图是骰流变量)。advance 与 stopAtOpeningHand 同传时
 *  preRoll 优先(分支先行返回);midGameRound 与其余态同传时 midGameRound 优先。
 *  编排分层(#1255):桥链调用走 drivers(seedSolo/seedSoloFrozen/seedSoloToRound/
 *  seedSoloPastFirstRoll,页内 evaluate 结构逐字原样),到站沉降走 settle——本函数
 *  只做五态分派,页内本体见 drivers.ts 各封装头注。 */
export async function quickStart(
  page: Page,
  seed?: number,
  opts?: {
    journey?: boolean;
    mapId?: string;
    stopAtOpeningHand?: boolean;
    /** 缺省 "postRoll"(走完首手);"preRoll"=落都即冻结,返回态见头注差异表(#1221)。 */
    advance?: "postRoll" | "preRoll";
    /** 中盘构造器目标回合(#1252):快进到第 N 回合边界停靠,见头注五态说明。 */
    midGameRound?: number;
  },
): Promise<void> {
  if (opts?.journey) {
    await page.goto(seed != null ? `/?seed=${seed}` : "/");
    await openSoloSetup(page);
    await page.getByTestId(SETUP_TID.startGame).click();
    await pickCapital(page);
    await waitMyRollDone(page, 0);
    await waitSettled(page);
    return;
  }
  await disableEncounters(page);
  await page.goto("/");
  if (opts?.midGameRound != null) {
    // 中盘构造器(#1252):桥内 seedSolo→冻结→逐拍应答推进→解冻一气呵成,页外只补
    // 沉降(解冻后演出积压经追帧/吸附排空;上限放宽——到站成本实测与回合数弱相关,
    // 见 how-to「中盘构造器到站态」节)。
    await seedSoloToRound(page, {
      seed,
      mapId: opts?.mapId,
      targetRound: opts.midGameRound,
    });
    await waitFxIdle(page, 60_000);
    await waitSettled(page);
    return;
  }
  if (opts?.advance === "preRoll") {
    // 同一 evaluate 内 seedSolo→clockPause(零竞速性质,本体在 drivers.seedSoloFrozen)。
    await seedSoloFrozen(page, { seed, mapId: opts?.mapId });
    return;
  }
  if (opts?.stopAtOpeningHand) {
    await seedSolo(page, { seed, mapId: opts?.mapId });
    await waitMyPause(page, 0);
    await waitFxIdle(page);
    await waitSettled(page);
    return;
  }
  // postRoll 默认态(#1254 开口吸收,ADR-0059 决策 1):构造器推进过首掷 + 瞬空钉住
  // 一气呵成(本体在 drivers.seedSoloPastFirstRoll,瞬空钉/解钉与推进同 evaluate);
  // 到站=首掷后的我方决策停靠(Awaiting*,与旧 postRoll 停靠语义守恒)。
  await seedSoloPastFirstRoll(page, { seed, mapId: opts?.mapId });
  await waitFxIdle(page);
  await waitSettled(page);
}
