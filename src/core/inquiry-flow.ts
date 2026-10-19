// 定制问询流程域(#424,ADR-0022 交互 handler 的引擎消费挂点;ADR-0019 机制域轴):
// 发起(askInquiry)与应答(resolveInquiry)两段式,与机遇/招贤同构(相位 + 命令)。
// 与 choices 通路(ADR-0013)的咬合口径:handler 是选项集的上游生产者之一,不是旁路——
// 选项集计算在 choices.ts(inquiryChoices,PHASE_CHOICES.AwaitingInquiry 注册条目,
// 选项盖 inquiryId 章经 snapshot.choices 单通道透出),本域只管相位进出与应答回灌;
// 回合收口延期语义在 authority.ts endTurn(挂起问询挡收口,应答解挂后补完)。
// 开窗时机(#615):时机派发流中段(depth>0)发起只入队延期队列,开窗延迟到派发稳定点
// (endTurn 入口 / resolveInquiry 尾端两个排空点)——中途直接开窗会被外层流程把相位覆写
// 回去,破坏「pendingInquiry≠null ⟺ turnPhase=AwaitingInquiry」不变量。
import type { GameEngine } from "./authority";
import { computeChoices, type ChoiceOption } from "./choices";
import { extensionInquiries } from "./extension-registry";

/** 发起定制问询(#432 置挂起载荷,#424 升格相位入口;扩展效果函数经壳上公共方法调用):
 *  id 查无注册问询 = 调用方 bug(扩展未装载/id 拼写错),当场炸(零兜底,派发中发起同样
 *  发起即炸,延期只延开窗不延校验)。时机派发中(g.momentDispatchDepth>0,#615)一律入队
 *  deferredInquiries 返回——不置载荷不动相位,开窗延迟到排空点;深度 0(派发外稳定点)
 *  直接走开窗分流。开窗按 ADR-0013 口径先算选项集再分流:≥2 可用 → 置 AwaitingInquiry
 *  等应答(弹卷轴⇔选项集≥2 的单通道语义原样);=1 → 自动执行唯一可用项(战报+浮字,
 *  不进相位,先例 enterEncounterPhase);=0 → 问询作废(战报留痕)。自动执行/作废即刻清
 *  载荷并保持原相位,发起方流程无感续跑。 */
export function askInquiry(g: GameEngine, id: string, params: Record<string, number> = {}): void {
  const inquiry = extensionInquiries().find((q) => q.id === id);
  if (inquiry == null) throw new Error(`定制问询:「${id}」无注册问询(扩展未装载或 id 拼写错误)`);
  if (g.momentDispatchDepth > 0) {
    // 派发中(#615):只入队不开窗。选项集/结算都以排空开窗与应答时刻现算(askPlayer 是
    // 回调,队列只存 {id,params} 句柄),手牌等上下文以应答时刻为准,无陈旧快照。
    g.deferredInquiries.push({ id, params });
    return;
  }
  openInquiry(g, id, params);
}

/** 开窗主体(深度 0 发起与排空点共用):置挂起载荷 → ADR-0013 分流(≥2 开窗等应答 /
 *  ≤1 自动执行/作废即刻清账)。 */
function openInquiry(g: GameEngine, id: string, params: Record<string, number>): void {
  const name = extensionInquiries().find((q) => q.id === id)?.name ?? id; // 战报显示名(缺省退 id:展示缺省,非错误兜底)
  g.pendingInquiry = { id, params };
  const owner = g.activePlayer;
  const available = computeChoices(g, "AwaitingInquiry").filter((o) => o.available);
  if (available.length >= 2) {
    g.turnPhase = "AwaitingInquiry";
    g.logEvent(
      "system",
      owner.guohao,
      `${owner.guohao} 面临定制问询「${name}」:${available.length} 项抉择`,
      `inquiryAwait player=${owner.id} id=${id} options=${available.length}`,
    );
    return;
  }
  // ≤1 可用:不打扰——唯一项自动执行 / 零项作废,挂起载荷即刻清账
  g.pendingInquiry = null;
  const picked = available[0];
  if (picked == null) {
    g.logEvent(
      "system",
      owner.guohao,
      `${owner.guohao} 的问询「${name}」无可选项,作罢`,
      `inquiryVoid player=${owner.id} id=${id}`,
    );
    return;
  }
  settleInquiryAnswer(g, id, name, params, picked, true);
}

/** 应答定制问询(命令通路,UI/bot/联机同走;壳上 submitCommand 路由):相位+选项校验
 *  (未知/不可用 warn 拒绝,与 resolveEncounterChoice 同口径)→ 回灌扩展 resolve →
 *  留痕清载荷 → 排空延期队列(#615:开出新窗则收口继续延期)→ 补完被延期的回合收口
 *  (endTurn 入口的问询挡板已随载荷清除而放行)。 */
export function resolveInquiry(g: GameEngine, optionId: string): void {
  if (!g.assertPhase("AwaitingInquiry", "ResolveInquiry")) return;
  const pending = g.pendingInquiry;
  if (pending == null)
    throw new Error("定制问询:AwaitingInquiry 相位无挂起载荷(状态机 bug,不变量破坏)"); // 零兜底
  const opt = computeChoices(g, "AwaitingInquiry").find((o) => o.id === optionId);
  if (opt == null) {
    g.warn(`ResolveInquiry:问询「${pending.id}」无选项「${optionId}」`);
    return;
  }
  if (!opt.available) {
    g.warn(`ResolveInquiry:选项「${optionId}」不可用(${opt.reason ?? "原因不明"})`);
    return;
  }
  const name = extensionInquiries().find((q) => q.id === pending.id)?.name ?? pending.id;
  settleInquiryAnswer(g, pending.id, name, pending.params, opt, false);
  drainDeferredInquiries(g); // 排空积压(#615):开出新窗 = 收口继续延期,应答解挂后续完
  if (g.pendingInquiry != null) return;
  g.endTurn();
}

/** 排空延期队列(#615):循环取队首开窗——≥2 可用项开出窗口(载荷/相位就位)即中断
 *  返回,余量等下一稳定点;≤1 可用项走自动执行/作废后继续排空。挂两个稳定点:
 *  endTurn 入口(在挂起挡板之前,authority.ts)与本函数 resolveInquiry 尾端。
 *  队列空为常态(每回合两次廉价探测,无开销)。 */
export function drainDeferredInquiries(g: GameEngine): void {
  while (g.deferredInquiries.length > 0 && g.pendingInquiry == null) {
    const head = g.deferredInquiries.shift()!;
    openInquiry(g, head.id, head.params);
  }
}

/** 应答结算(自动执行与命令应答同路):回灌扩展 resolve(纯逻辑纪律同 EffectFn,经引擎
 *  公共方法改状态)→ 战报留痕(自动执行加浮字轻提示,ADR-0013 决议 2)→ 清挂起载荷。
 *  命令路的收口续跑(resolveInquiry 的尾端 endTurn)在载荷清除后自然放行。 */
function settleInquiryAnswer(
  g: GameEngine,
  id: string,
  name: string,
  params: Record<string, number>,
  opt: ChoiceOption,
  auto: boolean,
): void {
  const inquiry = extensionInquiries().find((q) => q.id === id);
  if (inquiry == null)
    throw new Error(`定制问询:应答时挂起 id「${id}」查无注册问询(已卸载或注册面 bug)`); // 零兜底
  const seat = g.decisionOwner;
  inquiry.resolve({ engine: g, seat, params }, opt.id);
  const p = g.players[seat];
  g.logEvent(
    "system",
    p.guohao,
    auto
      ? `${p.guohao} 的问询「${name}」唯一可选项自动执行:${opt.label}`
      : `${p.guohao} 应答问询「${name}」:${opt.label}`,
    `inquiryResolve player=${p.id} id=${id} option=${opt.id}${auto ? " auto" : ""}`,
  );
  if (auto) g.pushFloaterText(p, opt.label, p.position);
  g.pendingInquiry = null;
}
