// ──────────────────────────── 巡检层 patrol(ADR-0059 决策 5 四层之一,#1255)────────────────────────────
// 守什么:无副作用的局面读数(snap/engineState/fmtMoney)与决策点清理、应答代发
// (actIfCan/dismissJinnangIfUp/skipUntilNextSeat,及反应窗应答流程族)——「看」与
// 「替测试放行」,读数与点击,不改引擎、不等沉降。
// 给谁用:全部 e2e spec;也是其余三层的底座(settle 靠它读快照与代发放行,scenes
// 的选都链借放行件)。新代码直接 import 本模块;旧路径 e2e/react-helpers.ts 转门面
// 逐名转出,全部调用点零改动。
// 边界:不含等待/沉降语义(waitSettled/waitFxIdle 族在 settle.ts),不含桥直写
// (force/种局链在 drivers.ts)、场景编排(quickStart 五态在 scenes.ts);本层不
// import 其余三层,依赖单向 scenes → drivers → settle → 本层,无环。
import { expect, type Page } from "@playwright/test";
import { TESTIDS } from "../../src/app/screens/game/testids";
import { SCROLL_TESTIDS } from "../../src/app/screens/game/scroll/testids";

/** 读引擎快照(god view;结构与 store 的 GameSnapshot 同构)。 */
export function snap(page: Page): Promise<any> {
  return page.evaluate(() => (window as any).__dafung.snapshot());
}

// ──────────────────────────── 反应窗/指示线 spec 共享件(#284 去重单源)────────────────────────────
// 原本在 react-reaction.spec.ts / react-jinnang-use.spec.ts(墨线例 #305 已并入后者)
// 三处各持一份的种植/开局助手,收口于此(逐字同实现,语义零漂移)。

/** 读引擎态(god view 断言用)。 */
export function engineState(page: Page, pick: string): Promise<any> {
  return page.evaluate(`(() => {
    const e = window.__dafung.getEngine();
    return ${pick};
  })()`);
}

/** 货币格式化(与 core/money.formatMoney 同口径:唯一单位「两」,裸数 #745 千分位退役;≤0 → 「0 两」)。 */
export function fmtMoney(cash: number): string {
  if (cash <= 0) return "0 两";
  return `${cash} 两`;
}

/** 出牌阶段态在场则「不出」放行(#122/T2;#256 旧弹窗退役,放行点迁动作条
 *  actionbar-pass,原 scroll-jinnang-pass 语义平移);无窗态零等待。
 *  各用例/驱动循环的放行点统一走此助手,勿再复制可见性探测块。 */
export async function dismissJinnangIfUp(page: Page): Promise<void> {
  const jp = page.getByTestId(TESTIDS.actionbarPass);
  if (await jp.isVisible().catch(() => false)) await jp.click({ timeout: 5_000 }).catch(() => {});
}

/** 推进一步可用动作(卷轴内决策按钮);无可用动作返回 false。
 *  #188 行军自动化后掷骰不再是可点动作(自动起摇),本助手只负责「清决策点」:
 *  锦囊卷轴放行 / action-* 决策按钮 / 通配 scroll 分支。交互重构后所有决策按钮都住在
 *  卷轴里,testid 沿用 action-*——选择器不变,只是命中位置从侧栏搬进了弹层。
 *  每次点击自带 10s 上限(与 expect.timeout 同档):按钮被弹层遮罩/幽灵帧挡住的
 *  系统性破坏下,Playwright 会为 actionability 重试到测试超时(60-240s/次)——
 *  收敛为 10s 失败即 false,交还调用方的 stall 预算,快速失败并给出局面报告。
 *  行军自动化后对局自走,调用方的步进循环依赖本助手清决策点;无决策点返回 false 时
 *  局面仍在自动推进,循环侧按「快照变化即不算停滞」计预算(勿空转烧步数)。 */
export async function actIfCan(p: Page): Promise<boolean> {
  // 招贤拍板收尾(#984 先看后选 → #987 根修):上一拍点候选卡开出的技能全览弹框,
  // 「收为麾下」是拍板唯一入口,不在任何既有分支的选择器集里——不补这条,清点循环
  // 点卡只反复开弹框、决策永不清(warlords ④ 打开不暂停实测挂点:actIfCan×10 后
  // 仍停 AwaitingHeroPick)。置顶:在途拍板先落锤,再谈开新决策。拍板钮只在招贤
  // 语境渲染(浏览语境不传 onPick 无钮),可见即招贤在途,命中无歧义。
  const glossaryPick = p.getByTestId(TESTIDS.skillGlossaryPick);
  if (await glossaryPick.isVisible().catch(() => false)) {
    return glossaryPick.click({ timeout: 10_000 }).then(
      () => true,
      () => false,
    );
  }
  // 出牌阶段态(#256,原 scroll-jinnang-pass 放行点迁动作条):回合开始自动起摇前可能
  // 停在窗态——默认「不出」放行,绝不替测试用牌。必须先于通配 scroll 分支
  // (会误点第一张牌)。
  const jinnangPass = p.getByTestId(TESTIDS.actionbarPass);
  if (await jinnangPass.isVisible().catch(() => false)) {
    return jinnangPass.click({ timeout: 10_000 }).then(
      () => true,
      () => false,
    );
  }
  // 只匹配按钮(决策卷轴容器是 div,无 disabled 属性会误中导致空转)
  const inline = p.locator('button[data-testid^="action-"]:not([disabled])');
  if ((await inline.count()) > 0) {
    return inline
      .first()
      .click({ timeout: 10_000 })
      .then(
        () => true,
        () => false,
      );
  }
  const scrollPrimary = p.locator(
    '[data-testid^="scroll-"]:not([data-testid*="jinnang"]) button:not([disabled])',
  );
  if ((await scrollPrimary.count()) > 0) {
    return scrollPrimary
      .first()
      .click({ timeout: 10_000 })
      .then(
        () => true,
        () => false,
      );
  }
  return false;
}

/** 清当前座位的决策点直到轮到别人(#281 反应窗 spec 用):决策一律跳过(不买地不升级,
 *  保「bot 火烧目标恒定」类种植前提);骰由自动起摇,本助手只清卷轴/动作条。
 *  点击一律短时限+吞错(负载下卷轴随广播反复重挂,resolved→detached 循环口径同联机段)。 */
export async function skipUntilNextSeat(p: Page, seat: number, timeout = 30_000): Promise<void> {
  await expect
    .poll(
      async () => {
        // 起手珍宝(#1172)涟漪承接(#1209):落他人城+城主有宝 → 珍宝抉择卷轴开给城主
        // (AwaitingTreasureOwner),不处理会永久阻塞 skip。见卷轴即代点「暂不交易」=
        // 引擎 resolveTreasureOwner skip 分支(托管同语义):不取宝不记账,局面与
        // 旧版一致。短时限+吞错(卷轴可能随批重挂或已收)。
        const tSkip = p.getByTestId(SCROLL_TESTIDS.treasureSkip);
        if (await tSkip.isVisible().catch(() => false))
          await tSkip.click({ timeout: 2_000 }).catch(() => {});
        const skip = p.getByTestId(TESTIDS.actionButton("skip"));
        if (await skip.isVisible().catch(() => false)) {
          await skip.click({ timeout: 2_000 }).catch(() => {});
        } else {
          const jp = p.getByTestId(TESTIDS.actionbarPass);
          if (await jp.isVisible().catch(() => false)) {
            await jp.click({ timeout: 2_000 }).catch(() => {});
          } else {
            const any = p.locator('button[data-testid^="action-"]:not([disabled])');
            if ((await any.count()) > 0)
              await any
                .first()
                .click({ timeout: 2_000 })
                .catch(() => {});
          }
        }
        const s = await snap(p);
        return s.phase === "GameOver" || s.decisionOwner !== seat;
      },
      { timeout },
    )
    .toBe(true);
}

// ──────────────────────────── 反应窗应答流程(#291 决议 · #302 施工)────────────────────────────
// 「等窗开 → 选牌 → 点笺 → 确认/不用/静音 → 结算 poll」的共享单源:单机 react-reaction
// 与 react-reaction-online 的同语义场景(自保/超时/降噪口等)共用,引擎结算语义
// (窗收/应答留痕/现金缴支)只改这里一处。三段式:基线 → 应答 → 结算 poll,
// 用例按需组合;应答与结算之间可插瞬态采样(如出牌线 rAF 原子采样)。

/** 结算 poll 的对照基线:窗升起前后各座位现金(paid/unpaid 的参照系)。 */
export interface ReactionBaseline {
  cash: number[];
}

/** 结算期望(pollReactionSettled):窗必收是公理,其余按需勾选,只断言勾选项。 */
export interface ReactionSettle {
  /** 现金必降的座位(照缴的份)。 */
  paid?: number[];
  /** 现金不许降的座位(拆掉的份/免缴)。 */
  unpaid?: number[];
  /** 权威侧 use=0 应答留痕(不用/静音/超时代发同一条普通命令)。 */
  declined?: boolean;
  /** 识破拆招留痕(reactionCounter)。 */
  countered?: boolean;
}

/** 应答方式:counter=选牌(+选份笺)落印;decline=点「不用」;mute=点「本回合不再
 *  询问」;timeout=不应答,等横幅到点自动收回(windowMs=窗长,断言窗给 12s 负载余量
 *  ——横幅收回必发生在加长窗拍,旧短窗反而不满足)。 */
export type ReactionAnswer =
  | { mode: "counter"; card: string; seat?: number }
  | { mode: "decline" }
  | { mode: "mute" }
  | { mode: "timeout"; windowMs: number };

/** 等反应窗升起并记现金基线。基线先于窗升起读取(与结算事件间隔最小)。 */
export async function awaitReactionWindow(page: Page, timeout = 60_000): Promise<ReactionBaseline> {
  const s = await snap(page);
  const cash: number[] = s.players.map((p: any) => p.cash);
  await expect(page.getByTestId(TESTIDS.reactionBanner)).toBeVisible({ timeout });
  return { cash };
}

/** 应答交互(不动结算):counter 模式顺手守「点笺接线」——带 seat 时候选笺随选牌展开
 *  (事件文案报的是进攻方牌,各场景各异,由调用方断言);落印钮未选中时禁用。
 *  #终局 e2e:点击链走页面内直派(单 evaluate 内 50ms 轮询)——CDP 逐击的
 *  actionability 往返在满载机器上可达秒级,与权威看门狗赛跑会误窗应答/超窗挂死;
 *  页面内直派照走真实 DOM 事件 → React 处理器(选中→落印的 UI 接线不变),只省
 *  跨进程往返。窗被看门狗收掉时轮询自愈到下一道窗(选牌状态随窗复位重选)。
 *  timeout 模式不做应答,仍走原等待。 */
export async function answerReactionWindow(page: Page, answer: ReactionAnswer): Promise<void> {
  const banner = page.getByTestId(TESTIDS.reactionBanner);
  if (answer.mode === "timeout") {
    await expect(banner).not.toBeVisible({ timeout: answer.windowMs + 12_000 });
    return;
  }
  await page.evaluate(
    ({ mode, card, seat, ids }) => {
      const click = (el: Element | null): boolean => {
        if (el == null) return false;
        el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
        return true;
      };
      return new Promise<void>((resolve, reject) => {
        const deadline = Date.now() + 30_000;
        let stage: "card" | "seat" | "confirm" = "card";
        let cardMisses = 0;
        const timer = setInterval(() => {
          if (Date.now() > deadline) {
            clearInterval(timer);
            reject(new Error("answerReactionWindow:30s 内未完成应答点击链"));
            return;
          }
          if (mode === "counter") {
            // counter 路径演出在播先不点(选牌→落印两段点击链被演出拖后会与权威
            // 看门狗赛跑;窗若在排空期间被代发收掉,轮询自愈到下一道窗,.sel 选中态
            // 随窗复位、选择段自动重来)。decline/mute 是单发命令应答,见下。
            const fx = (window as any).__dafung.controller()?.fx;
            if (fx != null && fx.playing) return;
            if (stage === "card") {
              const cardEl = document.querySelector(`[data-testid="jinnang-card-${card}"]`);
              if (cardEl?.classList.contains("sel")) {
                stage = seat == null ? "confirm" : "seat";
              } else {
                // 点击后等 .sel 落地再进下一段:React 未刷/选中被窗切换清空时重试,
                // 连续 3 拍未中才再点(防与「再点同牌取消」的 toggle 语义互踩)。
                cardMisses = cardEl == null ? 0 : cardMisses + 1;
                if (cardMisses >= 3) {
                  click(cardEl);
                  cardMisses = 0;
                }
              }
              return;
            }
            if (stage === "seat") {
              const chip = document.querySelector(`[data-testid="reaction-seat-${seat}"]`);
              if (chip?.classList.contains("picked") || click(chip)) stage = "confirm";
              return;
            }
            const confirm = document.querySelector<HTMLButtonElement>(
              `[data-testid="${ids.confirm}"]`,
            );
            if (confirm != null && !confirm.disabled && click(confirm)) {
              clearInterval(timer);
              resolve();
            }
            return;
          }
          // decline/mute 单发命令应答:横幅在即点(联机日常路径,命令触发的新批入队
          // 追平,不打断在途转场)——不等演出排空,5s 权威窗内必落地。
          const btn = document.querySelector(
            `[data-testid="${mode === "decline" ? ids.decline : ids.mute}"]`,
          );
          if (click(btn)) {
            clearInterval(timer);
            resolve();
          }
        }, 50);
      });
    },
    {
      mode: answer.mode,
      card: answer.mode === "counter" ? answer.card : "",
      seat: answer.mode === "counter" ? (answer.seat ?? null) : null,
      // 页面内直派的函数体序列化过墙,Node 侧闭包不随行——单源选择器走参数进去。
      ids: {
        confirm: TESTIDS.reactionConfirm,
        decline: TESTIDS.reactionDecline,
        mute: TESTIDS.reactionMute,
      },
    },
  );
}

/** 行军拦检窗原子应答:页面内轮询 march 文案(火烧窗同形不同文,以文案过滤)→ 读
 *  pendingReaction.view.userSeat → 应答(counter=选牌落印;decline=点「不用」,牌不耗)
 *  ,单 evaluate 完成——读与答同一窗,无 CDP 往返竞速(读到的 mover 即应答的窗,权威
 *  看门狗赛跑由此免疫;窗被看门狗收掉则复位等下一道拦检窗)。返回被应答窗的行人座位,
 *  与 mover 断言配对。 */
export async function answerMarchCounter(
  page: Page,
  mode: "counter" | "decline" = "counter",
): Promise<number> {
  return page.evaluate(
    ({ mode, ids }) =>
      new Promise<number>((resolve, reject) => {
        const click = (el: Element | null): boolean => {
          if (el == null) return false;
          el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
          return true;
        };
        const deadline = Date.now() + 45_000;
        let stage: "wait" | "card" | "confirm" = "wait";
        let mover = -1;
        let cardMisses = 0;
        const timer = setInterval(() => {
          // 演出在播不读取不应答(与 answerReactionWindow 同口径):mover 读取与应答
          // 都落在演出排空后的当前窗上,读答一致性不受播放节奏影响。
          const fx = (window as any).__dafung.controller()?.fx;
          if (fx != null && fx.playing) return;
          const e = (window as any).__dafung.getEngine();
          if (Date.now() > deadline) {
            clearInterval(timer);
            reject(new Error("answerMarchCounter:45s 内行军拦检窗未应答完成"));
            return;
          }
          if (e.turnPhase !== "AwaitingReaction" || e.pendingReaction?.view?.kind !== "march") {
            stage = "wait"; // 窗已收(看门狗代发):复位等下一道拦检窗
            return;
          }
          if (
            stage === "wait" &&
            !document
              .querySelector(`[data-testid="${ids.text}"]`)
              ?.textContent?.includes("行军将过你的城池")
          )
            return; // 横幅未起或非 march 文案:继续等
          if (stage === "wait") {
            mover = e.pendingReaction.view.userSeat;
            stage = mode === "decline" ? "confirm" : "card";
          }
          if (stage === "card") {
            const cardEl = document.querySelector(`[data-testid="${ids.card}"]`);
            if (cardEl?.classList.contains("sel")) {
              stage = "confirm";
            } else {
              // 等 .sel 落地再进下一段(口径同 answerReactionWindow,防 toggle 互踩)
              cardMisses = cardEl == null ? 0 : cardMisses + 1;
              if (cardMisses >= 3) {
                click(cardEl);
                cardMisses = 0;
              }
            }
            return;
          }
          const btn =
            mode === "decline"
              ? document.querySelector(`[data-testid="${ids.decline}"]`)
              : document.querySelector<HTMLButtonElement>(`[data-testid="${ids.confirm}"]`);
          const ready =
            btn instanceof HTMLButtonElement && mode === "counter" ? !btn.disabled : btn != null;
          if (ready && click(btn)) {
            clearInterval(timer);
            resolve(mover);
          }
        }, 50);
      }),
    // 函数体序列化过墙,Node 侧闭包不随行——单源选择器走参数进去(口径同上)。
    {
      mode,
      ids: {
        text: TESTIDS.reactionText,
        card: TESTIDS.jinnangCard("半路杀出"),
        decline: TESTIDS.reactionDecline,
        confirm: TESTIDS.reactionConfirm,
      },
    },
  );
}

/** 结算 poll(引擎语义住此):窗收(turnPhase 离开 AwaitingReaction)+ 按勾选断言
 *  现金缴支与应答/识破留痕。观测键集与期望键集同源生成,toEqual 零漂移。 */
export async function pollReactionSettled(
  page: Page,
  before: ReactionBaseline,
  settle: ReactionSettle,
  timeout = 30_000,
): Promise<void> {
  const watched = [...new Set([...(settle.paid ?? []), ...(settle.unpaid ?? [])])];
  const expected: Record<string, boolean> = { up: false };
  if (settle.declined != null) expected.declined = settle.declined;
  if (settle.countered != null) expected.countered = settle.countered;
  for (const seat of watched) expected[`paid${seat}`] = (settle.paid ?? []).includes(seat);
  await expect
    .poll(
      async () => {
        const s = await snap(page);
        const log = JSON.stringify(s.log);
        const o: Record<string, boolean> = { up: s.turnPhase === "AwaitingReaction" };
        if (settle.declined != null)
          o.declined = log.includes("reactionRespond") && log.includes("use=0");
        if (settle.countered != null) o.countered = log.includes("reactionCounter");
        for (const seat of watched) o[`paid${seat}`] = s.players[seat].cash < before.cash[seat];
        return o;
      },
      { timeout, message: `反应窗结算未达预期:${JSON.stringify(settle)}` },
    )
    .toEqual(expected);
}
